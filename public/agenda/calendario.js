// Integración con Google Calendar — Fase 1 (ver el plan guardado en
// memoria de Claude, agendaapp-plan.md): conectar la cuenta, ver/crear/
// editar/borrar eventos del calendario principal ("primary").
//
// A diferencia de GastosApp/GamingApp, acá NO hay datos propios en
// Firestore — los eventos viven SOLO en Google Calendar (se llama
// directo desde el navegador a www.googleapis.com, que sí tiene CORS,
// a diferencia de Steam/GNews/NewsData). Lo único que se guarda en
// Firestore es el refresh_token de Calendar, en el propio documento del
// usuario (usuarios/{uid}.googleCalendarRefreshToken) — mismas reglas de
// siempre (solo el dueño lo lee/escribe).
//
// El re-login cada 1 hora se evita reusando el Worker de Cloudflare que
// ya existe para Steam/noticias (ver cloudflare-worker/src/index.js,
// ruta /calendar-token): la persona conecta Calendar UNA vez (ve el
// consentimiento de Google una sola vez), y de ahí en más este módulo
// renueva el access_token solo, por atrás, con el refresh_token guardado.

import { auth, db } from '../firebase-config.js';
import { doc, getDoc, setDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// No es secreto — viaja igual en la URL de autorización que arma el
// navegador. El Client Secret (el que sí es secreto) vive SOLO en el
// Worker (GOOGLE_CLIENT_SECRET), nunca acá.
const GOOGLE_CLIENT_ID = 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar';
const PROXY_CALENDAR_TOKEN = 'https://tu-worker.tu-subdominio.workers.dev/calendar-token';

// Cache en memoria del access_token actual — evita pedir uno nuevo en
// cada llamada a la API si el que ya se tiene todavía es válido. Se
// pierde al recargar la página (a propósito: no hace falta persistirlo,
// es más simple pedir uno nuevo con el refresh_token que sí está guardado).
let accessTokenActual = null;
let accessTokenVenceEn = 0; // timestamp en ms

function docUsuario() {
    return doc(db, 'usuarios', auth.currentUser.uid);
}

async function guardarRefreshToken(refreshToken) {
    await setDoc(docUsuario(), { googleCalendarRefreshToken: refreshToken }, { merge: true });
}

async function obtenerRefreshTokenGuardado() {
    const snap = await getDoc(docUsuario());
    return snap.exists() ? (snap.data().googleCalendarRefreshToken || null) : null;
}

// ¿Esta cuenta ya conectó Calendar alguna vez? (No confirma que el
// refresh_token siga siendo válido — eso se descubre recién al intentar
// usarlo, ver obtenerAccessTokenValido.)
export async function estaConectado() {
    return !!(await obtenerRefreshTokenGuardado());
}

// Por si la persona quiere desconectar Calendar de AgendaApp (no revoca
// el permiso del lado de Google — eso lo puede hacer desde
// myaccount.google.com/permissions si quiere sacarlo del todo — acá solo
// se olvida el refresh_token guardado).
export async function desconectarCalendar() {
    await setDoc(docUsuario(), { googleCalendarRefreshToken: deleteField() }, { merge: true });
    accessTokenActual = null;
    accessTokenVenceEn = 0;
}

async function intercambiarConWorker(cuerpo) {
    const respuesta = await fetch(PROXY_CALENDAR_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo conectar con Google Calendar.');
    return datos;
}

// Abre el popup de consentimiento de Google, espera a que la persona
// acepte (o cancele), y guarda el refresh_token resultante. Se arma la
// URL de autorización a mano (en vez de usar la librería de Google
// Identity Services) para tener control total sobre access_type=offline
// + prompt=consent, que es lo que hace que Google mande un refresh_token
// de verdad — sin esos dos parámetros, Google en general NO lo manda.
export function conectarCalendar() {
    return new Promise((resolve, reject) => {
        const redirectUri = `${window.location.origin}/agenda/callback.html`;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', SCOPE_CALENDAR);
        url.searchParams.set('access_type', 'offline');
        // "consent" fuerza a que Google vuelva a mandar el refresh_token
        // incluso si esta cuenta ya había conectado antes — sin esto,
        // reconectar después de desconectarCalendar() no traería uno
        // nuevo (Google asume que ya lo tenías).
        url.searchParams.set('prompt', 'consent');

        const popup = window.open(url.toString(), 'conectar-google-calendar', 'width=500,height=650');
        if (!popup) {
            reject(new Error('El navegador bloqueó la ventana — permití popups para este sitio e intentá de nuevo.'));
            return;
        }

        function limpiar() {
            window.removeEventListener('message', alRecibirMensaje);
            clearInterval(chequeoCerrado);
        }

        function alRecibirMensaje(evento) {
            if (evento.origin !== window.location.origin) return;
            if (!evento.data || evento.data.tipo !== 'google-calendar-callback') return;
            limpiar();

            if (evento.data.error) {
                reject(new Error('Google no dio el permiso: ' + evento.data.error));
                return;
            }
            if (!evento.data.code) {
                reject(new Error('No llegó el código de autorización.'));
                return;
            }

            intercambiarConWorker({ code: evento.data.code, redirectUri })
                .then(async (tokens) => {
                    await guardarRefreshToken(tokens.refresh_token);
                    accessTokenActual = tokens.access_token;
                    accessTokenVenceEn = Date.now() + tokens.expires_in * 1000 - 60000; // 1 min de margen
                    resolve();
                })
                .catch(reject);
        }
        window.addEventListener('message', alRecibirMensaje);

        // Si la persona cierra el popup a mano sin terminar, no se queda
        // esperando para siempre — se corta con un error claro.
        const chequeoCerrado = setInterval(() => {
            if (popup.closed) {
                limpiar();
                reject(new Error('Se cerró la ventana antes de terminar.'));
            }
        }, 500);
    });
}

// Devuelve un access_token válido, renovándolo con el refresh_token
// guardado si hace falta — nunca abre un popup ni pide loguearse de
// nuevo (salvo que la conexión se haya revocado del lado de Google, en
// cuyo caso tira un error y quien llama debe ofrecer reconectar).
async function obtenerAccessTokenValido() {
    if (accessTokenActual && Date.now() < accessTokenVenceEn) return accessTokenActual;

    const refreshToken = await obtenerRefreshTokenGuardado();
    if (!refreshToken) throw new Error('Calendar no está conectado todavía.');

    const tokens = await intercambiarConWorker({ refreshToken });
    accessTokenActual = tokens.access_token;
    accessTokenVenceEn = Date.now() + tokens.expires_in * 1000 - 60000;
    return accessTokenActual;
}

// --- Llamados a la Google Calendar API (directo, con CORS propio) ---

async function llamarCalendar(ruta, opciones = {}) {
    const token = await obtenerAccessTokenValido();
    const respuesta = await fetch(`https://www.googleapis.com/calendar/v3${ruta}`, {
        ...opciones,
        headers: { ...opciones.headers, Authorization: `Bearer ${token}` },
    });
    if (!respuesta.ok) {
        const cuerpoError = await respuesta.json().catch(() => ({}));
        throw new Error(cuerpoError.error?.message || `Google Calendar respondió ${respuesta.status}`);
    }
    if (respuesta.status === 204) return null; // borrar no devuelve body
    return respuesta.json();
}

// --- Varios calendarios (Fase 3) ---
//
// Google no tiene un solo pedido para "traeme los eventos de estos 5
// calendarios juntos" (fuera de la API de FreeBusy, que no da los datos
// completos del evento) — hay que pedir calendario por calendario y
// mezclar del lado de acá. Por eso cada función de abajo que toca
// eventos pide explícitamente EN QUÉ calendario ("calendarId").

// Calendario público de feriados de Argentina que ofrece Google — no
// hace falta "agregarlo" a la cuenta ni que aparezca en
// listarCalendarios() (los públicos se leen directo por id, con la
// sesión de cualquiera). Confirmado a mano que es el real ("Festivos en
// Argentina") antes de hardcodearlo. Es de SOLO LECTURA — se lista
// aparte, nunca se ofrece como destino al crear un evento (ver
// index.html, que lo trata distinto de calendariosDisponibles).
export const FERIADOS_ARGENTINA = {
    id: 'es.ar#holiday@group.v.calendar.google.com',
    nombre: 'Feriados de Argentina',
    color: '#0B8043',
    soloLectura: true,
};

// Lista de calendarios de la cuenta en los que se puede escribir (se
// descartan los de "solo lectura" — ej. "Cumpleaños", "Feriados de
// Argentina" — no tendría sentido ofrecerlos para crear un evento ahí,
// Google los rechazaría). El principal ("primary") es el mismo de
// siempre, ahora es uno más de la lista en vez de estar hardcodeado.
export async function listarCalendarios() {
    const datos = await llamarCalendar('/users/me/calendarList');
    return (datos.items || [])
        .filter(cal => cal.accessRole === 'owner' || cal.accessRole === 'writer')
        .map(cal => ({
            id: cal.id,
            nombre: cal.summary,
            color: cal.backgroundColor || '#4285F4',
            esPrincipal: !!cal.primary,
        }));
}

// Crear un calendario nuevo lo agrega solo a la cuenta (Google lo suma a
// la calendarList automáticamente al ser la dueña) — no hace falta un
// segundo pedido para "activarlo".
export function crearCalendario(nombre) {
    return llamarCalendar('/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: nombre }),
    });
}

// --- Colores de evento ("categorías", a pedido de Roy) ---
//
// Google Calendar tiene, además del color de cada CALENDARIO (el que ya
// se usa para diferenciar, por ejemplo, Feriados de Argentina del resto),
// un color propio por EVENTO — 11 opciones fijas ("Tomate", "Arándano",
// etc., colorId del 1 al 11) que funcionan como categorías: un evento sin
// colorId toma el color de su calendario, uno CON colorId lo pisa. Se
// piden en vivo (en vez de hardcodear los 11 hex acá) para no tener que
// mantenerlos a mano si Google los cambia — es un pedido liviano, sin
// parámetros, y el resultado no cambia entre pedidos.
export async function listarColoresDeEvento() {
    const datos = await llamarCalendar('/colors');
    return datos.event || {}; // { "1": { background: "#...", foreground: "#..." }, "2": {...}, ... }
}

// Eventos de VARIOS calendarios a la vez (los que estén tildados en el
// filtro, ver index.html) entre dos fechas — para las vistas de semana/
// mes/año, todo el rango visible (incluyendo días de relleno de meses
// vecinos); para el buscador, el rango elegido (o uno amplio por
// defecto). `query` es opcional: búsqueda de texto libre de Google
// (título, descripción, invitados...), la misma que ofrece Google
// Calendar de verdad. Cada evento devuelto queda marcado con
// `_calendarId` (de qué calendario vino) — hace falta para poder
// editarlo/borrarlo después sabiendo dónde buscarlo.
export async function listarEventos(calendarIds, desde, hasta, query) {
    const porCalendario = await Promise.all(calendarIds.map(async (calendarId) => {
        const parametros = new URLSearchParams({
            timeMin: desde.toISOString(),
            timeMax: hasta.toISOString(),
            singleEvents: 'true', // expande eventos recurrentes en instancias individuales
            orderBy: 'startTime',
            maxResults: '250',
        });
        if (query) parametros.set('q', query);
        try {
            const datos = await llamarCalendar(`/calendars/${encodeURIComponent(calendarId)}/events?${parametros}`);
            return (datos.items || []).map(evento => ({ ...evento, _calendarId: calendarId }));
        } catch {
            // Un calendario con problemas (ej. se borró desde otro
            // lado, se perdió el acceso) no debería tirar abajo la
            // vista entera si los demás sí contestan bien.
            return [];
        }
    }));
    return porCalendario.flat();
}

// evento: { titulo, descripcion, inicio: Date, fin: Date, conMeet?, colorId? }
//
// Bug real encontrado al revisar (2026-08-25): descripcion y colorId
// mandaban `undefined` cuando estaban vacíos — eso hace que el campo NI
// SIQUIERA VIAJE en el body, y Google (con PATCH, semántica de "parche":
// lo que no se manda queda como estaba) entonces NO borraba una
// descripción o un color que el evento ya tenía. Si alguien editaba un
// evento para vaciar la descripción o volver a "sin color propio", el
// valor viejo quedaba pegado en Google Calendar sin que se notara acá.
// La forma correcta de "vaciar" un campo con PATCH es mandar `null`
// explícito, no omitirlo — por eso `|| null` en vez de `|| undefined`
// (con crearEvento no cambia nada: ahí no hay nada previo que limpiar).
function cuerpoEvento(evento) {
    const cuerpo = {
        summary: evento.titulo,
        description: evento.descripcion || null,
        start: { dateTime: evento.inicio.toISOString() },
        end: { dateTime: evento.fin.toISOString() },
        colorId: evento.colorId || null,
    };
    if (evento.conMeet) {
        // requestId tiene que ser único por pedido (lo exige la API) —
        // si Google reintentara este mismo pedido de red, un id repetido
        // le permite reconocer "ah, esto ya lo hice" en vez de crear un
        // segundo Meet de casualidad.
        cuerpo.conferenceData = {
            createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
        };
    }
    return cuerpo;
}

// conferenceDataVersion=1 en la URL es obligatorio para que Google
// procese conferenceData del body — sin ese parámetro, lo ignora en
// silencio y el evento se crea sin Meet aunque se lo hayamos pedido.
function conParametroDeMeet(ruta, evento) {
    return evento.conMeet ? `${ruta}?conferenceDataVersion=1` : ruta;
}

export function crearEvento(calendarId, evento) {
    return llamarCalendar(conParametroDeMeet(`/calendars/${encodeURIComponent(calendarId)}/events`, evento), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoEvento(evento)),
    });
}

// Nota: esto SUMA un Meet nuevo si evento.conMeet es true (para eventos
// que todavía no tenían uno) — no se usa para sacarle el Meet a un
// evento que ya lo tiene (la semántica de "borrar" un conferenceData ya
// creado es más rara — requeriría mandar un valor especial en vez de
// simplemente omitirlo — así que por ahora el modal de edición no ofrece
// esa opción, ver index.html).
export function editarEvento(calendarId, eventId, evento) {
    return llamarCalendar(conParametroDeMeet(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, evento), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoEvento(evento)),
    });
}

export function borrarEvento(calendarId, eventId) {
    return llamarCalendar(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
    });
}
