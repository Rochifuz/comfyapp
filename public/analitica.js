// Recolección de datos de uso, 100% del lado del cliente (sin backend
// propio) — cada usuario escribe sus propios datos a Firestore, y las
// reglas de seguridad (firestore.rules) solo dejan CREAR — nadie, ni
// siquiera el dueño, puede leer esto de vuelta desde la app: es para que
// se revise después desde la consola de Firebase, no para mostrarlo en
// pantalla.
//
// Qué se guarda, y dónde:
//  - usuarios/{uid}: contadores agregados en el mismo documento de
//    perfil de cada quien — sesiones, última vez que entró, cuántas
//    veces vio cada página, cuántas veces tocó cada botón/sección. Un
//    solo documento por persona: barato de escribir y de leer después
//    (no hace falta sumar miles de registros para saber "qué usa más").
//  - eventos/{id}: un registro por error de JavaScript que ocurre solo,
//    sin que el usuario haga nada — para encontrar bugs que nadie llegó
//    a reportar a mano.
//  - reportesBugs/{id}: lo que el usuario cuenta a mano desde 💬 (ver
//    reportarBug(), usado por asistente.js).

import { db, auth } from './firebase-config.js';
import {
    doc, updateDoc, setDoc, addDoc, collection,
    increment, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

let uidActual = null;
let nombreActual = null;

// Los nombres de página/clave se usan como CLAVE dentro de un mapa (ej.
// "visitas.payments_html") — un "." literal en la clave se leería como
// otro nivel de anidamiento (visitas → payments → html) en vez de una
// sola clave "payments.html", así que se reemplaza antes de armar la ruta.
function comoClave(texto) {
    return String(texto).replace(/[.$#[\]/]/g, '_').slice(0, 60) || 'sin_nombre';
}

function paginaActual() {
    return comoClave(location.pathname.split('/').pop() || 'index.html');
}

// Clave de semana = el lunes de esa semana, como texto ("2026-08-17")
// — más simple que un número de semana ISO de verdad (que tiene casos
// raros en el cambio de año) y de paso ordena bien alfabéticamente,
// que es todo lo que hace falta para armar un gráfico de "actividad
// por semana" en el admin.
function claveDeSemana(fecha = new Date()) {
    const inicioSemana = new Date(fecha);
    const dia = (inicioSemana.getDay() + 6) % 7; // 0 = lunes
    inicioSemana.setDate(inicioSemana.getDate() - dia);
    return inicioSemana.toISOString().slice(0, 10);
}

// updateDoc() entiende rutas con "." para tocar un solo campo anidado sin
// pisar el resto del mapa (ej. sumar una sola página dentro de "visitas"
// sin borrar las demás) — pero falla si el documento todavía no existe
// (usuario nuevo, primera escritura de su vida en usuarios/{uid}). Para
// ese caso se lo crea vacío y se reintenta: como ahí no hay nada previo
// que se pueda perder, no importa cómo mergee setDoc los mapas anidados.
async function actualizarConRutas(ref, datos) {
    try {
        await updateDoc(ref, datos);
    } catch {
        await setDoc(ref, {}, { merge: true }).catch(() => {});
        await updateDoc(ref, datos).catch(() => {});
    }
}

// --- Sesiones y vistas de página ---

const CLAVE_SESSION_STORAGE = 'analitica-sesion-contada';

function registrarSesionYVisita() {
    if (!uidActual) return;
    const ref = doc(db, 'usuarios', uidActual);

    // "Sesión" = una vez por pestaña/ventana del navegador, no una vez
    // por página vista — sessionStorage se borra solo al cerrar la
    // pestaña, así que sirve para no contar de más al navegar entre
    // Inicio, Gastos personales, etc. dentro de la misma visita.
    const esSesionNueva = sessionStorage.getItem(CLAVE_SESSION_STORAGE) !== uidActual;
    if (esSesionNueva) sessionStorage.setItem(CLAVE_SESSION_STORAGE, uidActual);

    const datos = { [`visitas.${paginaActual()}`]: increment(1) };
    if (esSesionNueva) {
        datos.sesiones = increment(1);
        datos.ultimoIngreso = serverTimestamp();
        // Para el admin: "usuarios activos por semana" — arranca a
        // juntarse desde que se agregó esto, no hay manera de
        // reconstruirlo para atrás con lo que ya había.
        datos[`sesionesPorSemana.${comoClave(claveDeSemana())}`] = increment(1);
    }
    actualizarConRutas(ref, datos);
}

// --- Categoría usada / primer gasto cargado (para el admin) ---
//
// Dos cosas juntas porque las pide siempre el mismo llamado (justo
// después de guardar un gasto personal, ver el submit en
// payments.html): cuántas veces se usó cada categoría entre todos los
// usuarios, y si esta persona ya cargó al menos un gasto alguna vez
// (para el embudo cuentas → grupos → primer gasto). Mismo criterio de
// privacidad que el resto de este archivo: se guarda un CONTADOR, no
// el gasto en sí — el admin nunca ve montos ni descripciones de nadie.
export function registrarGastoPersonalCargado(categoria) {
    if (!uidActual) return;
    const ref = doc(db, 'usuarios', uidActual);
    actualizarConRutas(ref, {
        [`categoriasUsadas.${comoClave(categoria || 'otros')}`]: increment(1),
        totalGastosPersonales: increment(1),
    });
}

// --- Clics ---

function claveDeElemento(el) {
    if (el.dataset.track) return comoClave(el.dataset.track);
    if (el.id) return comoClave(el.id);
    const texto = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return comoClave(texto || el.tagName.toLowerCase());
}

function registrarClic(clave) {
    if (!uidActual) return;
    const ref = doc(db, 'usuarios', uidActual);
    actualizarConRutas(ref, { [`clics.${clave}`]: increment(1) });
}

function iniciarSeguimientoDeClics() {
    document.addEventListener('click', (evento) => {
        const el = evento.target.closest('[data-track], button, a, .card-accion, .tab');
        if (!el) return;
        registrarClic(claveDeElemento(el));
    });
}

// --- Errores automáticos (sin que el usuario haga nada) ---

function registrarError(mensaje, origen) {
    if (!uidActual) return;
    addDoc(collection(db, 'eventos'), {
        uid: uidActual,
        tipo: 'error',
        detalle: String(mensaje || '').slice(0, 500),
        origen: origen || null,
        pagina: paginaActual(),
        creadoEn: serverTimestamp(),
    }).catch(() => {});
}

function iniciarCapturaDeErrores() {
    window.addEventListener('error', (evento) => {
        registrarError(evento.message, evento.filename ? `${evento.filename}:${evento.lineno}` : null);
    });
    window.addEventListener('unhandledrejection', (evento) => {
        const razon = evento.reason;
        registrarError(razon && razon.message ? razon.message : String(razon), 'promise');
    });
}

// --- Reporte de bug e ideas de mejora, a mano — los llama asistente.js ---

export async function reportarBug(mensaje) {
    if (!uidActual) throw new Error('No hay sesión iniciada.');
    await addDoc(collection(db, 'reportesBugs'), {
        uid: uidActual,
        nombre: nombreActual,
        mensaje: String(mensaje).slice(0, 1000),
        pagina: paginaActual(),
        creadoEn: serverTimestamp(),
    });
}

export async function enviarSugerencia(mensaje) {
    if (!uidActual) throw new Error('No hay sesión iniciada.');
    await addDoc(collection(db, 'sugerencias'), {
        uid: uidActual,
        nombre: nombreActual,
        mensaje: String(mensaje).slice(0, 1000),
        pagina: paginaActual(),
        creadoEn: serverTimestamp(),
    });
}

// Lo usa asistente.js para decidir qué preguntas mostrar (las que llevan
// a una página que pide sesión no tienen sentido mostrarlas si todavía
// no hay una) — reusa el mismo estado que ya se trackea acá arriba, en
// vez de sumar otro listener de auth más.
export function haySesion() {
    return !!uidActual;
}

// --- Arranque — se llama una vez desde nav.js, en cada página ---

let iniciado = false;

export function iniciarAnalitica() {
    if (iniciado) return;
    iniciado = true;

    iniciarSeguimientoDeClics();
    iniciarCapturaDeErrores();

    onAuthStateChanged(auth, (user) => {
        uidActual = user ? user.uid : null;
        nombreActual = user ? (user.displayName || user.email) : null;
        if (user) registrarSesionYVisita();
    });
}
