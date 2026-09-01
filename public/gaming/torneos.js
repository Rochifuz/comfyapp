// Torneos de GamingApp — mismo patrón que los grupos de GastosApp (código
// de invitación, participantes/nombresPorUid denormalizados, "unirse" es
// agregar el propio uid) pero en su propia colección (torneos/{codigo}),
// separada de todo lo de GastosApp — GamingApp es independiente, no
// comparte datos con la otra app, solo el login (ver firebase-config.js).
//
// A diferencia de grupos.js (que usa invitaciones/{codigo} como mapeo
// aparte hacia un grupoId), acá el código ES directamente el id del
// documento en torneos/ — un torneo menos por medio, y "unirse con
// código" es un solo getDoc en vez de dos.

import { db } from '../firebase-config.js';
import { notificarA } from '../notificacionesCentro.js';
import {
    doc, setDoc, getDoc, updateDoc, arrayUnion, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// --- Preferencia de "avisarme cuando alguien se una a mi torneo" ---
//
// Vive en gaming/{uid} (el mismo doc que guarda "Mis torneos") — a
// diferencia de "deudaSaldada" en GastosApp, acá NO hace falta
// denormalizar nada en cada torneo por separado en tiempo real: el valor
// se copia una sola vez, al CREAR el torneo (`avisarUnionAlCreador`, ver
// crearTorneo), como una fotito de la preferencia en ese momento. Si
// después cambiás la preferencia general, no afecta a torneos que ya
// creaste — es una limitación menor y a propósito, para no tener que
// salir a actualizar todos los torneos activos cada vez que se toca el
// switch (a diferencia de un grupo de GastosApp, que dura meses, un
// torneo es algo de corta duración).
export async function obtenerPreferenciaAvisoUnionTorneo(uid) {
    const snap = await getDoc(doc(db, 'gaming', uid));
    return snap.exists() && snap.data().avisarUnionTorneo === false ? false : true;
}

export function guardarPreferenciaAvisoUnionTorneo(uid, avisar) {
    return setDoc(doc(db, 'gaming', uid), { avisarUnionTorneo: !!avisar }, { merge: true });
}

// Lista curada de los juegos más populares para elegir al crear un
// torneo — con "Otro" al final para no dejar afuera nada que no esté
// acá (ahí se escribe el nombre a mano).
export const JUEGOS_POPULARES = [
    { valor: 'lol', nombre: 'League of Legends', icono: '⚔️' },
    { valor: 'valorant', nombre: 'Valorant', icono: '🎯' },
    { valor: 'cs2', nombre: 'Counter-Strike 2', icono: '🔫' },
    { valor: 'fortnite', nombre: 'Fortnite', icono: '🪂' },
    { valor: 'fifa', nombre: 'EA FC / FIFA', icono: '⚽' },
    { valor: 'rocket-league', nombre: 'Rocket League', icono: '🚗' },
    { valor: 'overwatch', nombre: 'Overwatch 2', icono: '🦾' },
    { valor: 'cod', nombre: 'Call of Duty', icono: '🪖' },
    { valor: 'minecraft', nombre: 'Minecraft', icono: '⛏️' },
    { valor: 'among-us', nombre: 'Among Us', icono: '🚀' },
    { valor: 'smash', nombre: 'Super Smash Bros', icono: '🥊' },
    { valor: 'otro', nombre: 'Otro', icono: '🎮' },
];

// Para los juegos de la lista curada, el ícono es siempre el mismo
// (parte de JUEGOS_POPULARES) — pero para "Otro" no hay forma de
// adivinar un ícono que tenga sentido, así que ahí se usa el que la
// propia persona eligió al crear el torneo (torneo.juegoIcono), con 🎮
// de respaldo si por lo que sea no cargó ninguno.
export function iconoDeJuego(torneo) {
    if (torneo.juego === 'otro') return torneo.juegoIcono || '🎮';
    return JUEGOS_POPULARES.find(j => j.valor === torneo.juego)?.icono || '🎮';
}

// El torneo guarda la CLAVE (ej. "lol"), no el nombre — mismo criterio
// que categorias.js con los gastos. Para "otro" no hay nombre fijo en
// JUEGOS_POPULARES, así que ahí se usa lo que la persona escribió a
// mano (torneo.juegoOtro).
export function etiquetaDeJuego(torneo) {
    if (torneo.juego === 'otro') return torneo.juegoOtro || 'Otro';
    return JUEGOS_POPULARES.find(j => j.valor === torneo.juego)?.nombre || torneo.juego;
}

// Sin caracteres ambiguos (0/O, 1/I/L) — mismo alfabeto que
// generarCodigoInvitacion() en grupos.js, para que sea fácil de dictar o
// tipear a mano.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generarCodigo() {
    let codigo = '';
    for (let i = 0; i < 6; i++) {
        codigo += ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)];
    }
    return codigo;
}

// Mismo motivo que generarCodigoInvitacionUnico() en grupos.js: sin este
// chequeo, un código repetido pisaría en silencio el torneo de otra
// persona. Tope de intentos solo para no colgarse en un caso patológico.
async function generarCodigoUnico() {
    for (let intento = 0; intento < 10; intento++) {
        const codigo = generarCodigo();
        const yaExiste = (await getDoc(doc(db, 'torneos', codigo))).exists();
        if (!yaExiste) return codigo;
    }
    throw new Error('No se pudo generar un código de torneo único — probá de nuevo.');
}

function nombreDeUsuario(user) {
    return user.displayName || user.email || 'Sin nombre';
}

// `datos`: { nombre, juego (una de las claves de JUEGOS_POPULARES),
// juegoOtro (texto libre, solo si juego === 'otro'), juegoIcono (un
// emoji, solo si juego === 'otro'), premios ({primero, segundo, tercero},
// cada uno string u null), fecha (string u null), maxParticipantes
// (number u null), formato ('liga' | 'eliminacion' | 'grupos_eliminacion'),
// puntosVictoria/puntosEmpate (para 'liga' y 'grupos_eliminacion' — ver
// más abajo) }
//
// Los detalles de CÓMO se juega cada formato (mejor-de-cuántos por
// ronda en eliminación, cantidad de grupos en grupos+eliminación) recién
// se terminan de configurar más adelante, con generarPartidosLiga() /
// generarBracketEliminacion() / generarFaseDeGrupos() — a esta altura
// (recién creado, sin nadie más que el propio creador todavía) ni
// siquiera se sabe cuánta gente va a terminar anotándose, así que no
// tiene sentido pedir esos datos ahora.
export async function crearTorneo(user, datos) {
    const codigo = await generarCodigoUnico();
    const usaPuntos = datos.formato === 'liga' || datos.formato === 'grupos_eliminacion';
    const premios = {
        primero: datos.premios?.primero || null,
        segundo: datos.premios?.segundo || null,
        tercero: datos.premios?.tercero || null,
    };
    // Fotito de la preferencia actual del creador — ver el comentario
    // grande más arriba (obtenerPreferenciaAvisoUnionTorneo).
    const avisarUnionAlCreador = await obtenerPreferenciaAvisoUnionTorneo(user.uid);
    await setDoc(doc(db, 'torneos', codigo), {
        nombre: datos.nombre,
        juego: datos.juego,
        juegoOtro: datos.juego === 'otro' ? (datos.juegoOtro || null) : null,
        juegoIcono: datos.juego === 'otro' ? (datos.juegoIcono || null) : null,
        creadoPor: user.uid,
        participantes: [user.uid],
        nombresPorUid: { [user.uid]: nombreDeUsuario(user) },
        tienePremio: !!(premios.primero || premios.segundo || premios.tercero),
        premios,
        fecha: datos.fecha || null,
        maxParticipantes: datos.maxParticipantes || null,
        formato: datos.formato,
        fase: datos.formato === 'grupos_eliminacion' ? 'grupos' : null,
        puntosVictoria: usaPuntos ? datos.puntosVictoria : null,
        puntosEmpate: usaPuntos ? datos.puntosEmpate : null,
        partidos: [],
        estado: 'abierto', // abierto → en curso (al generar los partidos/el cuadro) → finalizado
        avisarUnionAlCreador,
        creadoEn: serverTimestamp(),
    });
    await agregarTorneoAlUsuario(user.uid, { codigo, nombre: datos.nombre });
    return codigo;
}

export async function obtenerTorneo(codigo) {
    const snap = await getDoc(doc(db, 'torneos', codigo));
    return snap.exists() ? { codigo, ...snap.data() } : null;
}

export async function unirseATorneo(user, codigoIngresado) {
    const codigo = codigoIngresado.trim().toUpperCase();
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('No existe ningún torneo con ese código.');

    const torneo = snap.data();
    if (torneo.participantes.includes(user.uid)) {
        // Ya está adentro (ej. volvió a poner el mismo código) — no hay
        // nada que hacer, pero tampoco es un error.
        return { codigo, nombre: torneo.nombre };
    }
    if (torneo.estado !== 'abierto') {
        throw new Error('Este torneo ya no está abierto para sumar participantes.');
    }
    if (torneo.maxParticipantes && torneo.participantes.length >= torneo.maxParticipantes) {
        throw new Error('Este torneo ya llegó al cupo máximo de participantes.');
    }

    await updateDoc(ref, {
        participantes: arrayUnion(user.uid),
        [`nombresPorUid.${user.uid}`]: nombreDeUsuario(user),
    });
    await agregarTorneoAlUsuario(user.uid, { codigo, nombre: torneo.nombre });

    // Le avisa al creador (campanita 🔔) si no apagó esta preferencia —
    // ver crearTorneo(), más arriba. Un error acá (ej. sin conexión) no
    // debería tirar abajo el "unirse" ya confirmado, por eso el try/catch
    // en vez de dejarlo explotar.
    if (torneo.avisarUnionAlCreador !== false && torneo.creadoPor !== user.uid) {
        try {
            await notificarA(torneo.creadoPor, {
                tipo: 'union-torneo',
                titulo: '🏆 Nuevo participante',
                cuerpo: `${nombreDeUsuario(user)} se unió a "${torneo.nombre}"`,
                destino: '/gaming/torneos.html',
                grupoId: codigo,
            });
        } catch (error) {
            console.error('No se pudo avisar de la nueva unión al torneo:', error);
        }
    }
    return { codigo, nombre: torneo.nombre };
}

// Denormalizado en gaming/{uid} (mismo motivo que usuarios/{uid}.grupos
// en GastosApp): mostrar "Mis torneos" sin tener que guardar/consultar
// una lista de TODOS los torneos y filtrar del lado del cliente.
async function agregarTorneoAlUsuario(uid, torneo) {
    const ref = doc(db, 'gaming', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
        await updateDoc(ref, { torneos: arrayUnion(torneo) });
    } else {
        await setDoc(ref, { torneos: [torneo] });
    }
}

export async function obtenerMisTorneos(uid) {
    const snap = await getDoc(doc(db, 'gaming', uid));
    return snap.exists() ? (snap.data().torneos || []) : [];
}

// Todos contra todos una vez (round-robin simple, sin ida y vuelta) —
// función interna pura (no toca Firestore), reutilizada tanto por Liga
// como por la fase de grupos de Grupos+Eliminación.
function construirRoundRobin(participantesEnJuego, prefijoId) {
    const partidos = [];
    for (let i = 0; i < participantesEnJuego.length; i++) {
        for (let j = i + 1; j < participantesEnJuego.length; j++) {
            partidos.push({
                // id propio (no el id del documento) porque viven todos
                // adentro del mismo array — hace falta algo para poder
                // encontrar "este partido puntual" al cargar un resultado.
                id: `${prefijoId}-${i}-${j}`,
                jugadorA: participantesEnJuego[i],
                jugadorB: participantesEnJuego[j],
                resultado: null, // 'A' | 'B' | 'empate' | null (todavía no jugado)
            });
        }
    }
    return partidos;
}

// ---------- Formato Liga ----------
// El creador la arranca cuando ya se anotó todo el mundo. A partir de
// acá el torneo pasa a "en curso" y ya no se pueden sumar más
// participantes (evita el caso raro de alguien uniéndose después de que
// ya se jugaron partidos, con una tabla de posiciones a medio armar).
export async function generarPartidosLiga(codigo) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    if (torneo.participantes.length < 2) {
        throw new Error('Hacen falta al menos 2 participantes para generar los partidos.');
    }

    const partidos = construirRoundRobin(torneo.participantes, codigo);
    await updateDoc(ref, { partidos, estado: 'en curso' });
}

// `resultado`: 'A' | 'B' | 'empate'. Lee-modifica-escribe todo el array
// (Firestore no deja actualizar un elemento de un array por índice) —
// para la cantidad de partidos de un torneo de amigos (unas pocas
// decenas como mucho) esto no pesa nada.
export async function registrarResultadoLiga(codigo, partidoId, resultado) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    const partidos = (torneo.partidos || []).map(p =>
        p.id === partidoId ? { ...p, resultado } : p
    );
    await updateDoc(ref, { partidos });
}

export async function finalizarLiga(codigo) {
    await updateDoc(doc(db, 'torneos', codigo), { estado: 'finalizado' });
}

// Tabla de posiciones — se recalcula siempre a partir de los partidos en
// vez de guardar un puntaje aparte, así nunca puede desincronizarse de
// los resultados cargados (si alguien corrige un resultado, la tabla ya
// sale bien sola, no hay nada más que actualizar).
export function calcularTablaLiga(torneo) {
    const fila = () => ({ puntos: 0, victorias: 0, empates: 0, derrotas: 0 });
    const tabla = {};
    torneo.participantes.forEach(uid => { tabla[uid] = fila(); });

    (torneo.partidos || []).forEach(p => {
        if (!p.resultado || !tabla[p.jugadorA] || !tabla[p.jugadorB]) return;
        if (p.resultado === 'empate') {
            tabla[p.jugadorA].puntos += torneo.puntosEmpate || 0;
            tabla[p.jugadorB].puntos += torneo.puntosEmpate || 0;
            tabla[p.jugadorA].empates++;
            tabla[p.jugadorB].empates++;
        } else {
            const ganador = p.resultado === 'A' ? p.jugadorA : p.jugadorB;
            const perdedor = p.resultado === 'A' ? p.jugadorB : p.jugadorA;
            tabla[ganador].puntos += torneo.puntosVictoria;
            tabla[ganador].victorias++;
            tabla[perdedor].derrotas++;
        }
    });

    return torneo.participantes
        .map(uid => ({ uid, ...tabla[uid] }))
        .sort((a, b) => b.puntos - a.puntos);
}

// ---------- Formato Eliminación ----------
// Bracket clásico: cada cruce se juega al mejor de N (elegido por
// ronda), quien gana avanza SOLO al siguiente cruce, hasta la final. La
// cantidad de rondas la decide la cantidad de participantes (no se
// puede elegir un número de rondas distinto al que corresponde — ver
// nombresDeRondas), así nunca queda un cuadro de más con huecos raros.

function mezclar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function siguientePotenciaDeDos(n) {
    let potencia = 1;
    while (potencia < n) potencia *= 2;
    return potencia;
}

// Cuántas rondas hacen falta para "cantidadParticipantes" jugadores —
// lo mismo que log2(siguiente potencia de 2), pero sin depender de que
// Math.log2 dé un número exacto por errores de redondeo.
export function cantidadDeRondas(cantidadParticipantes) {
    let rondas = 0;
    let tamano = 1;
    while (tamano < Math.max(cantidadParticipantes, 2)) {
        tamano *= 2;
        rondas++;
    }
    return rondas;
}

// Nombres estándar de torneo, de la ÚLTIMA ronda (la final) para atrás
// — "Ronda 1", "Ronda 2"... para cuadros tan grandes que se quedan sin
// nombre conocido (rarísimo en un torneo de amigos, pero por las dudas).
const NOMBRES_DESDE_LA_FINAL = ['Final', 'Semifinal', 'Cuartos de Final', 'Octavos de Final', 'Dieciseisavos de Final'];

export function nombreDeRonda(indiceRonda, totalRondas) {
    const desdeElFinal = totalRondas - 1 - indiceRonda;
    return NOMBRES_DESDE_LA_FINAL[desdeElFinal] || `Ronda ${indiceRonda + 1}`;
}

// Arma el array COMPLETO de cruces de un bracket (con los byes ya
// resueltos) a partir de una lista de participantes — función interna
// pura (no toca Firestore), reutilizada tanto por Eliminación pura como
// por la fase eliminatoria de Grupos+Eliminación (ahí "participantesEnJuego"
// no es participantes.length, es la lista de clasificados de los grupos).
function construirBracket(participantesEnJuego, mejoresDe, prefijoId) {
    const totalRondas = mejoresDe.length;
    const tamano = siguientePotenciaDeDos(participantesEnJuego.length);
    const cantidadDeByes = tamano - participantesEnJuego.length;
    const jugadores = mezclar(participantesEnJuego); // seed al azar, no por ranking

    // Arma los "slots" de la primera ronda intercalando los byes (un
    // cruce libre cada vez que hace falta, nunca dos en el mismo cruce
    // — como cantidadDeByes siempre es MENOR a la mitad de los cruces
    // de la ronda 0, con uno por cruce alcanza y sobra).
    const slots = [];
    let indiceJugador = 0;
    for (let cruce = 0; cruce < tamano / 2; cruce++) {
        slots.push(jugadores[indiceJugador++]);
        slots.push(cruce < cantidadDeByes ? null : jugadores[indiceJugador++]);
    }

    // Arma TODAS las rondas de una — las que no son la primera arrancan
    // vacías (null de los dos lados) y se van completando solas a
    // medida que hay ganadores (ver avanzarGanador más abajo).
    const partidos = [];
    for (let ronda = 0; ronda < totalRondas; ronda++) {
        const cantidadEnRonda = tamano / 2 ** (ronda + 1);
        for (let posicion = 0; posicion < cantidadEnRonda; posicion++) {
            partidos.push({
                id: `${prefijoId}-r${ronda}-p${posicion}`,
                ronda,
                posicion,
                jugadorA: ronda === 0 ? slots[posicion * 2] : null,
                jugadorB: ronda === 0 ? slots[posicion * 2 + 1] : null,
                mejorDe: mejoresDe[ronda],
                resultados: [],
                ganador: null,
            });
        }
    }

    // Los cruces de la ronda 0 que salieron con un solo jugador (bye)
    // avanzan solos, sin que nadie tenga que cargar nada — se resuelven
    // ahora, antes de guardar, así el cuadro ya nace consistente.
    partidos
        .filter(p => p.ronda === 0 && (p.jugadorA === null) !== (p.jugadorB === null))
        .forEach(p => {
            p.ganador = p.jugadorA || p.jugadorB;
            avanzarGanador(partidos, p, totalRondas);
        });

    return { partidos, totalRondas };
}

// `mejoresDe`: array con un número (1, 3, 5 o 7) por cada ronda, en
// orden — mejoresDe[0] es la primera ronda, mejoresDe[mejoresDe.length-1]
// es la final. Tiene que tener exactamente cantidadDeRondas(participantes)
// elementos (se valida acá, para no terminar con un cuadro incompleto).
export async function generarBracketEliminacion(codigo, mejoresDe) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    if (torneo.participantes.length < 2) {
        throw new Error('Hacen falta al menos 2 participantes para generar el cuadro.');
    }
    const totalRondasNecesarias = cantidadDeRondas(torneo.participantes.length);
    if (mejoresDe.length !== totalRondasNecesarias) {
        throw new Error(`Este cuadro tiene ${totalRondasNecesarias} ronda${totalRondasNecesarias === 1 ? '' : 's'} — falta configurar el "mejor de" de alguna.`);
    }

    const { partidos, totalRondas } = construirBracket(torneo.participantes, mejoresDe, codigo);
    await updateDoc(ref, { partidos, totalRondas, estado: 'en curso' });
}

// Ubica el próximo cruce (ronda+1, en la posición que le corresponde) y
// le completa el lado que faltaba con el ganador de este — el mismo
// cruce que arrancó "vacío" al generar el bracket. No hace nada en la
// final (no hay ronda siguiente a la que avanzar).
function avanzarGanador(partidos, partido, totalRondas) {
    if (partido.ronda + 1 >= totalRondas) return;
    const siguiente = partidos.find(p => p.ronda === partido.ronda + 1 && p.posicion === Math.floor(partido.posicion / 2));
    if (!siguiente) return;
    if (partido.posicion % 2 === 0) siguiente.jugadorA = partido.ganador;
    else siguiente.jugadorB = partido.ganador;
}

// Carga el resultado de UN juego dentro de un cruce (no del cruce
// entero — un cruce al mejor de 3 necesita 2 o 3 llamadas a esto antes
// de tener un ganador). Lee-modifica-escribe todo el array de partidos,
// mismo motivo que registrarResultadoLiga.
export async function registrarResultadoEliminacion(codigo, partidoId, resultadoDeJuego) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();
    const partidos = torneo.partidos || [];

    const partido = partidos.find(p => p.id === partidoId);
    if (!partido) throw new Error('Ese cruce no existe.');
    if (partido.ganador) throw new Error('Este cruce ya tiene ganador.');
    if (!partido.jugadorA || !partido.jugadorB) throw new Error('Todavía falta que se defina algún lado de este cruce.');

    partido.resultados = [...(partido.resultados || []), resultadoDeJuego];
    const ganadosA = partido.resultados.filter(r => r === 'A').length;
    const ganadosB = partido.resultados.filter(r => r === 'B').length;
    const mayoria = Math.ceil(partido.mejorDe / 2);

    let torneoFinalizado = false;
    if (ganadosA >= mayoria || ganadosB >= mayoria) {
        partido.ganador = ganadosA >= mayoria ? partido.jugadorA : partido.jugadorB;
        if (partido.ronda + 1 >= torneo.totalRondas) {
            torneoFinalizado = true; // era la final — ya hay campeón
        } else {
            avanzarGanador(partidos, partido, torneo.totalRondas);
        }
    }

    await updateDoc(ref, torneoFinalizado
        ? { partidos, estado: 'finalizado', campeon: partido.ganador }
        : { partidos });
}

// Quién queda en cada puesto — funciona para cualquier formato que
// termine en un cuadro de eliminación (eliminación pura, o la fase
// final de grupos+eliminación) y también para liga. El 3er puesto en un
// cuadro de eliminación es ambiguo sin un "partido por el tercer
// puesto" aparte (que este sistema no arma, sería sumarle otro cruce
// más a configurar) — la convención que se usa acá es "bronce
// compartido": los dos que perdieron la semifinal quedan los dos en
// tercer puesto, como en varios torneos reales que tampoco juegan esa
// definición.
export function calcularPodio(torneo) {
    if (torneo.formato === 'liga') {
        const tabla = calcularTablaLiga(torneo);
        return {
            primero: tabla[0]?.uid || null,
            segundo: tabla[1]?.uid || null,
            terceros: tabla[2] ? [tabla[2].uid] : [],
        };
    }

    // eliminación pura, o la fase eliminatoria de grupos+eliminación
    const totalRondas = torneo.totalRondas;
    if (!totalRondas) return { primero: null, segundo: null, terceros: [] };

    const final = (torneo.partidos || []).find(p => p.ronda === totalRondas - 1);
    const segundo = final?.ganador
        ? (final.ganador === final.jugadorA ? final.jugadorB : final.jugadorA)
        : null;
    const semis = (torneo.partidos || []).filter(p => p.ronda === totalRondas - 2 && p.ganador);
    const terceros = semis
        .map(p => (p.ganador === p.jugadorA ? p.jugadorB : p.jugadorA))
        .filter(Boolean);

    return { primero: torneo.campeon || null, segundo, terceros };
}

// ---------- Formato Grupos + Eliminación ----------
// Fase 1 ("grupos"): se reparten los participantes en grupos parejos y
// cada grupo juega una liga chica (mismo motor que el formato Liga,
// reutilizado con construirRoundRobin). Fase 2 ("eliminacion"): el
// creador junta a los que clasificaron de cada grupo y arma un bracket
// con ellos (mismo motor que Eliminación, reutilizado con
// construirBracket) — de ahí en más se juega y se carga igual que un
// torneo de eliminación pura.

// Reparte los participantes en "cantidadGrupos" grupos lo más parejos
// posible (mezclados al azar primero, así no queda ningún patrón raro
// tipo "los primeros en anotarse todos en el grupo A").
function repartirEnGrupos(participantes, cantidadGrupos) {
    const mezclados = mezclar(participantes);
    const grupos = Array.from({ length: cantidadGrupos }, () => []);
    mezclados.forEach((uid, indice) => grupos[indice % cantidadGrupos].push(uid));
    return grupos;
}

export async function generarFaseDeGrupos(codigo, cantidadGrupos, clasificadosPorGrupo) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    if (torneo.participantes.length < cantidadGrupos * 2) {
        throw new Error(`Con ${cantidadGrupos} grupos hacen falta al menos ${cantidadGrupos * 2} participantes (2 por grupo como mínimo).`);
    }
    if (clasificadosPorGrupo < 1) {
        throw new Error('Tiene que clasificar al menos 1 de cada grupo.');
    }

    const grupos = repartirEnGrupos(torneo.participantes, cantidadGrupos);
    const gruposDe = {};
    grupos.forEach((grupo, numeroGrupo) => {
        grupo.forEach(uid => { gruposDe[uid] = numeroGrupo; });
    });

    const partidosGrupos = grupos.flatMap((grupo, numeroGrupo) =>
        construirRoundRobin(grupo, `${codigo}-g${numeroGrupo}`).map(p => ({ ...p, grupo: numeroGrupo }))
    );

    await updateDoc(ref, {
        cantidadGrupos,
        clasificadosPorGrupo,
        gruposDe,
        partidosGrupos,
        fase: 'grupos',
        estado: 'en curso',
    });
}

// Mismo mecanismo que registrarResultadoLiga, pero sobre
// "partidosGrupos" en vez de "partidos" (ese campo queda reservado para
// cuando arranque la fase eliminatoria, más abajo).
export async function registrarResultadoGrupo(codigo, partidoId, resultado) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    const partidosGrupos = (torneo.partidosGrupos || []).map(p =>
        p.id === partidoId ? { ...p, resultado } : p
    );
    await updateDoc(ref, { partidosGrupos });
}

// Tabla de posiciones de UN grupo puntual — mismo cálculo que
// calcularTablaLiga, pero filtrado a los participantes y partidos de
// ese grupo nomás.
export function calcularTablaGrupo(torneo, numeroGrupo) {
    const participantesDelGrupo = torneo.participantes.filter(uid => torneo.gruposDe?.[uid] === numeroGrupo);
    const partidosDelGrupo = (torneo.partidosGrupos || []).filter(p => p.grupo === numeroGrupo);
    return calcularTablaLiga({
        participantes: participantesDelGrupo,
        partidos: partidosDelGrupo,
        puntosVictoria: torneo.puntosVictoria,
        puntosEmpate: torneo.puntosEmpate,
    });
}

// Junta a los "clasificadosPorGrupo" mejores de cada grupo (por tabla
// de posiciones) y arma el bracket de la fase eliminatoria con ellos —
// de acá en más el torneo se juega y se carga exactamente igual que
// Eliminación pura (registrarResultadoEliminacion no necesita saber si
// viene de acá o de un torneo de eliminación directa).
export async function generarFaseEliminatoriaDeGrupos(codigo, mejoresDe) {
    const ref = doc(db, 'torneos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Ese torneo ya no existe.');
    const torneo = snap.data();

    if (torneo.fase !== 'grupos') throw new Error('Este torneo no está en la fase de grupos.');

    const clasificados = Array.from({ length: torneo.cantidadGrupos }, (_, numeroGrupo) =>
        calcularTablaGrupo(torneo, numeroGrupo).slice(0, torneo.clasificadosPorGrupo).map(fila => fila.uid)
    ).flat();

    if (clasificados.length < 2) {
        throw new Error('Hacen falta al menos 2 clasificados para armar la fase eliminatoria.');
    }
    const totalRondasNecesarias = cantidadDeRondas(clasificados.length);
    if (mejoresDe.length !== totalRondasNecesarias) {
        throw new Error(`Con ${clasificados.length} clasificados el cuadro tiene ${totalRondasNecesarias} ronda${totalRondasNecesarias === 1 ? '' : 's'} — falta configurar el "mejor de" de alguna.`);
    }

    const { partidos, totalRondas } = construirBracket(clasificados, mejoresDe, codigo);
    await updateDoc(ref, { partidos, totalRondas, fase: 'eliminacion' });
}
