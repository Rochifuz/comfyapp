// Tracker de League of Legends/TFT (GamingApp) — datos PERSONALES (rango,
// win rate, KDA, últimas partidas) vía la API oficial de Riot, a través
// del mismo Worker de Cloudflare que ya usa la conexión con Steam (ver
// cloudflare-worker/README.md — necesita el secreto RIOT_API_KEY
// cargado ahí, y ojo que la key "de desarrollo" vence cada 24hs si Roy
// todavía no consiguió la Personal API Key permanente).
//
// Lo que NO vive acá: las recomendaciones de build/runas/composiciones
// "meta" (qué está fuerte en el parche actual) — eso es una tabla
// curada a mano en metaCurada.js, no viene de la API de Riot (que no
// publica esos datos) ni se scrapea de op.gg/metatft.com en vivo — ver
// el comentario grande ahí sobre por qué.

import { db } from '../firebase-config.js';
import {
    doc, getDoc, setDoc, deleteField,
    collection, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Misma URL que PROXY_STEAM en conexiones.html — un solo Worker para
// todo el mega sistema (ver cloudflare-worker/README.md).
const PROXY_RIOT = 'https://tu-worker.tu-subdominio.workers.dev';

// Plataformas ("servidores") que ofrecemos en el selector de conectar
// cuenta — no hace falta la lista completa de Riot, alcanza con las que
// un jugador de habla hispana realmente usaría. `region` es el ruteo
// REGIONAL que le corresponde a cada una (para match-v5/tft-match-v1),
// ver el comentario grande en cloudflare-worker/src/index.js.
export const PLATAFORMAS_LOL = [
    { valor: 'la2', etiqueta: 'LAS — Latinoamérica Sur', region: 'americas' },
    { valor: 'la1', etiqueta: 'LAN — Latinoamérica Norte', region: 'americas' },
    { valor: 'na1', etiqueta: 'NA — Norteamérica', region: 'americas' },
    { valor: 'br1', etiqueta: 'BR — Brasil', region: 'americas' },
    { valor: 'euw1', etiqueta: 'EUW — Europa Oeste', region: 'europe' },
    { valor: 'eun1', etiqueta: 'EUNE — Europa Nórdica/Este', region: 'europe' },
    { valor: 'tr1', etiqueta: 'TR — Turquía', region: 'europe' },
    { valor: 'kr', etiqueta: 'KR — Corea', region: 'asia' },
    { valor: 'jp1', etiqueta: 'JP — Japón', region: 'asia' },
    { valor: 'oc1', etiqueta: 'OCE — Oceanía', region: 'sea' },
];

function regionDePlataforma(platform) {
    return PLATAFORMAS_LOL.find(p => p.valor === platform)?.region || 'americas';
}

async function pedirAlProxy(ruta) {
    const respuesta = await fetch(`${PROXY_RIOT}${ruta}`);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok || datos.error) {
        throw new Error(datos.error || `El proxy respondió ${respuesta.status}.`);
    }
    return datos;
}

// --- Conectar/desconectar la cuenta de Riot ---
//
// A diferencia del SteamID de GamingApp (que vive en localStorage, por
// dispositivo), esto se guarda en Firestore (gaming/{uid}.riotId) — el
// Tracker tiene sentido verlo desde cualquier dispositivo con la misma
// cuenta, no solo desde el que lo conectó.
export async function obtenerCuentaRiotVinculada(uid) {
    const snap = await getDoc(doc(db, 'gaming', uid));
    return snap.exists() ? (snap.data().riotId || null) : null;
}

// Resuelve el Riot ID contra la API (así se detecta un nombre mal
// escrito ANTES de guardarlo) y recién ahí lo persiste.
export async function conectarCuentaRiot(uid, gameName, tagLine, platform) {
    const region = regionDePlataforma(platform);
    const cuenta = await pedirAlProxy(`/riot-account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}&region=${region}`);
    if (!cuenta.puuid) {
        throw new Error(`No se encontró ninguna cuenta de Riot "${gameName}#${tagLine}" — revisá que esté bien escrito (el Riot ID completo, no el nombre de invocador).`);
    }
    const riotId = { gameName: cuenta.gameName || gameName, tagLine: cuenta.tagLine || tagLine, puuid: cuenta.puuid, platform, region };
    await setDoc(doc(db, 'gaming', uid), { riotId }, { merge: true });
    return riotId;
}

export function desconectarCuentaRiot(uid) {
    return setDoc(doc(db, 'gaming', uid), { riotId: deleteField() }, { merge: true });
}

// --- League of Legends ---

// null si nunca jugó Solo/Duo rankeado (no es un error, es un estado
// legítimo — alguien recién conectado o que solo juega normales).
export async function obtenerRangoLoL(riotId) {
    const datos = await pedirAlProxy(`/riot-league?puuid=${riotId.puuid}&platform=${riotId.platform}`);
    const entradas = Array.isArray(datos) ? datos : [];
    const solo = entradas.find(e => e.queueType === 'RANKED_SOLO_5x5');
    if (!solo) return null;
    return {
        tier: solo.tier, rank: solo.rank, puntos: solo.leaguePoints,
        victorias: solo.wins, derrotas: solo.losses,
    };
}

// Nombres de campeón vienen de Riot en PascalCase pegado (ej.
// "MonkeyKing", "Kaisa") — esto separa por mayúscula como aproximación
// legible; no queda perfecto para todos (los que llevan apóstrofe en el
// nombre real, tipo Kai'Sa o Vel'Koz, se ven sin él), pero es preferible
// a mostrar el nombre interno tal cual.
function formatearNombreCampeon(championName) {
    return (championName || '?').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// Cada partida, reducida a lo que le importa a QUIEN la jugó (Riot
// manda los 10 participantes completos, no hace falta guardar/mostrar
// el resto).
export async function obtenerPartidasRecientesLoL(riotId, cantidad = 10) {
    const datos = await pedirAlProxy(`/riot-matches?puuid=${riotId.puuid}&region=${riotId.region}&count=${cantidad}`);
    return (datos.partidas || []).map(partida => {
        const yo = (partida.info?.participants || []).find(p => p.puuid === riotId.puuid);
        if (!yo) return null;
        return {
            campeon: formatearNombreCampeon(yo.championName),
            // ID interno de Riot tal cual (ej. "MonkeyKing", "Khazix") — mismo
            // formato que CAMPEONES_LOL[].alias / claves de LOL_BUILDS, para
            // poder saltar directo a la build del campeón desde esta partida.
            campeonAlias: yo.championName,
            gano: !!yo.win,
            kills: yo.kills || 0,
            deaths: yo.deaths || 0,
            assists: yo.assists || 0,
            duracionMin: Math.round((partida.info?.gameDuration || 0) / 60),
            fecha: partida.info?.gameEndTimestamp || partida.info?.gameCreation || null,
        };
    }).filter(Boolean);
}

// --- TFT ---

export async function obtenerRangoTFT(riotId) {
    const datos = await pedirAlProxy(`/tft-league?puuid=${riotId.puuid}&platform=${riotId.platform}`);
    const entradas = Array.isArray(datos) ? datos : [];
    const rankeada = entradas.find(e => (e.queueType || '').includes('RANKED_TFT')) || entradas[0];
    if (!rankeada) return null;
    return {
        tier: rankeada.tier, rank: rankeada.rank, puntos: rankeada.leaguePoints,
        victorias: rankeada.wins, derrotas: rankeada.losses,
    };
}

export async function obtenerPartidasRecientesTFT(riotId, cantidad = 10) {
    const datos = await pedirAlProxy(`/tft-matches?puuid=${riotId.puuid}&region=${riotId.region}&count=${cantidad}`);
    return (datos.partidas || []).map(partida => {
        const yo = (partida.info?.participants || []).find(p => p.puuid === riotId.puuid);
        if (!yo) return null;
        return {
            colocacion: yo.placement || null,
            nivel: yo.level || null,
            duracionMin: Math.round((partida.info?.game_length || 0) / 60),
            fecha: partida.info?.game_datetime || null,
            set: partida.info?.tft_set_number || null,
        };
    }).filter(Boolean);
}

// --- Historial de rango, para graficar el progreso en el tiempo ---
//
// Riot NO da un histórico de LP por partida (lo sacaron de la API
// pública hace años) — league-v4/tft-league-v1 solo dan el rango DE
// AHORA. La única forma honesta de armar un gráfico de progreso es ir
// guardando una foto nosotros mismos cada vez que se entra al Tracker —
// con el tiempo se arma un historial real, sin inventar nada.
const TIER_VALOR = {
    IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5,
    DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};
const RANK_VALOR = { IV: 0, III: 1, II: 2, I: 3 };

// Un solo número que ordena bien "cuánto se avanzó" (para el eje Y del
// gráfico) — de Master para arriba no hay I/II/III/IV, así que ahí
// RANK_VALOR da undefined y se trata como 0 (no afecta el orden: a esa
// altura ya lo que importa es el PL, que sigue sumando).
export function valorDeRango(tier, rank, puntos) {
    if (!tier) return 0;
    return (TIER_VALOR[tier] ?? 0) * 400 + (RANK_VALOR[rank] ?? 0) * 100 + (puntos || 0);
}

function coleccionHistorialRango(uid, juego) {
    return collection(db, 'gaming', uid, juego === 'tft' ? 'rangoHistorialTFT' : 'rangoHistorialLoL');
}

// Se llama cada vez que se carga con éxito la sección "Mi progreso" —
// el id del documento es la fecha de hoy (YYYY-MM-DD, hora local), así
// que entrar varias veces el mismo día pisa la foto de ese día en vez
// de acumular duplicados.
export async function registrarSnapshotRango(uid, juego, rango) {
    if (!rango) return; // sin rango (nunca jugó rankeada) no hay nada que registrar
    const hoy = new Date();
    const fechaId = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    await setDoc(doc(coleccionHistorialRango(uid, juego), fechaId), {
        tier: rango.tier, rank: rango.rank || null, puntos: rango.puntos,
        valor: valorDeRango(rango.tier, rango.rank, rango.puntos),
    });
}

export async function obtenerHistorialRango(uid, juego) {
    const snap = await getDocs(query(coleccionHistorialRango(uid, juego), orderBy('__name__', 'asc')));
    return snap.docs.map(d => ({ fecha: d.id, ...d.data() }));
}

// --- Composiciones propias de TFT (gaming/{uid}/tftComps) ---
//
// A pedido de Roy: guardadas por "temporada" (campo de texto libre, no
// una lista fija de sets a mantener — ver metaCurada.js sobre por qué
// se evita eso) para poder compararlas cuando cambia el set sin perder
// las viejas.

function coleccionComps(uid) {
    return collection(db, 'gaming', uid, 'tftComps');
}

export async function obtenerMisComposicionesTFT(uid) {
    const snap = await getDocs(query(coleccionComps(uid), orderBy('creadaEn', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// `datos`: { nombre, temporada, campeones: [{nombre, items:[...]}], notas }
export function guardarComposicionTFT(uid, datos) {
    return addDoc(coleccionComps(uid), { ...datos, creadaEn: serverTimestamp() });
}

export function actualizarComposicionTFT(uid, compId, cambios) {
    return updateDoc(doc(db, 'gaming', uid, 'tftComps', compId), cambios);
}

export function eliminarComposicionTFT(uid, compId) {
    return deleteDoc(doc(db, 'gaming', uid, 'tftComps', compId));
}
