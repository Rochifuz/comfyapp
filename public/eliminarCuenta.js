// Eliminar cuenta — borra TODO lo que le pertenece a la persona en las 5
// apps del mega sistema (GastosApp, ComfyApp, GamingApp, AgendaApp,
// TareasApp — comparten un solo login de Firebase Auth, así que no
// tendría sentido borrar la sesión pero dejar datos huérfanos atrás en
// alguna de las otras). Se llama desde cuenta.html, con reautenticación
// ya hecha antes (ver reautenticar(), en auth.js) — Firebase exige un
// login reciente para poder borrar la cuenta de Auth en sí, que se hace
// aparte, DESPUÉS de esto (ver eliminarCuentaAuth(), en auth.js).
//
// Todo esto corre desde el propio navegador de quien se está borrando,
// con su propia sesión, respetando las reglas de siempre de
// firestore.rules — no hay backend propio (Cloud Functions necesitaría
// el plan pago de Firebase) que pueda hacerlo por atrás.
//
// Limitación conocida, a propósito (mismo criterio que ya se documenta
// en eliminarGrupo(), grupos.js): a la persona SÍ se la puede sacar de
// sus grupos y grupos de tareas (las reglas de esas colecciones dejan
// que cualquier miembro edite el documento), pero NO de
// torneos/{codigo}.participantes — ahí las reglas solo dejan que el
// creador edite el torneo o que alguien se sume a sí mismo, no hay una
// regla para "salir" de uno ya unido. Le queda el nombre en torneos
// viejos de otra gente — no es un dato sensible (un nombre nada más),
// así que no pareció motivo suficiente para sumar una regla nueva.

import { db } from './firebase-config.js';
import { obtenerMisGrupos } from './grupos.js';
import { obtenerMisGruposTareas } from './tareas/tareas.js';
import {
    collection, doc, getDocs, deleteDoc, updateDoc, arrayRemove, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

async function borrarColeccion(ref) {
    const snap = await getDocs(ref);
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// Saca a `uid` de un grupo de GastosApp sin borrar el grupo — sigue
// existiendo para el resto de sus integrantes. Si el grupo ya no existe
// (o algo falla), no bloquea el resto del borrado.
async function salirDeGrupo(grupoId, uid) {
    await updateDoc(doc(db, 'grupos', grupoId), {
        miembros: arrayRemove(uid),
        [`nombresPorUid.${uid}`]: deleteField(),
        [`fotosPorUid.${uid}`]: deleteField(),
        [`aliasesPorUid.${uid}`]: deleteField(),
        [`preferenciasPorUid.${uid}`]: deleteField(),
    }).catch(() => {});
}

async function salirDeGrupoTareas(codigo, uid) {
    await updateDoc(doc(db, 'tareasGrupos', codigo), {
        miembros: arrayRemove(uid),
        [`nombresPorUid.${uid}`]: deleteField(),
        [`preferenciasPorUid.${uid}`]: deleteField(),
    }).catch(() => {});
}

// Borra todos los datos de las 5 apps asociados a `uid`. NO borra la
// cuenta de Firebase Auth en sí — eso lo hace cuenta.html aparte, con
// eliminarCuentaAuth() (auth.js), justo después de llamar a esto.
export async function borrarTodosLosDatos(uid) {
    // "Mis grupos"/"mis grupos de tareas" viven DENTRO de los documentos
    // que se borran más abajo (usuarios/{uid}.grupos,
    // tareasPersonales/{uid}.grupos) — hay que leerlos ANTES de borrar
    // nada, si no ya no habría forma de saber de qué grupos salir.
    const [misGrupos, misGruposTareas] = await Promise.all([
        obtenerMisGrupos(uid).catch(() => []),
        obtenerMisGruposTareas(uid).catch(() => []),
    ]);
    await Promise.all([
        ...misGrupos.map(g => salirDeGrupo(g.id, uid)),
        ...misGruposTareas.map(g => salirDeGrupoTareas(g.codigo, uid)),
    ]);

    // GastosApp: perfil + subcolecciones personales. De paso borra
    // googleCalendarRefreshToken de AgendaApp, que vive en este MISMO
    // documento (usuarios/{uid}) — ver calendario.js — así que no hace
    // falta ningún paso aparte para "desconectar" Calendar.
    await Promise.all([
        borrarColeccion(collection(db, 'usuarios', uid, 'pagos')),
        borrarColeccion(collection(db, 'usuarios', uid, 'pagosTarjeta')),
        borrarColeccion(collection(db, 'usuarios', uid, 'ingresos')),
        borrarColeccion(collection(db, 'usuarios', uid, 'recurrentes')),
        borrarColeccion(collection(db, 'usuarios', uid, 'notificaciones')),
    ]);
    await deleteDoc(doc(db, 'usuarios', uid)).catch(() => {});

    // TareasApp: perfil + subcolección de tareas personales.
    await borrarColeccion(collection(db, 'tareasPersonales', uid, 'tareas'));
    await deleteDoc(doc(db, 'tareasPersonales', uid)).catch(() => {});

    // GamingApp: perfil — no tiene subcolecciones propias (solo la lista
    // "torneos", guardada dentro del documento en sí).
    await deleteDoc(doc(db, 'gaming', uid)).catch(() => {});
}
