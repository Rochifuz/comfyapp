// Chat de un grupo — grupos/{grupoId}/mensajes. Mismo patrón que
// expenses.js (gastos) y pagosDeuda: una subcolección más del grupo,
// visible/escribible solo para sus miembros (ver esMiembro() en
// firestore.rules).
//
// A propósito solo texto — nada de fotos ni adjuntos, así se mantiene
// gratis (no hace falta Firebase Storage, que es plan pago). Se pide de
// a tandas (últimos 50 mensajes) en vez de todo el historial de una vez:
// un chat activo genera muchos más documentos que los gastos, y cargar
// todo siempre terminaría gastando de más la cuota diaria de lecturas
// del plan gratis de Firestore.

import { db } from './firebase-config.js';
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    limit,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const TANDA = 50;

function coleccionMensajes(grupoId) {
    return collection(db, 'grupos', grupoId, 'mensajes');
}

// Los últimos TANDA mensajes, ordenados del más viejo al más nuevo (como
// se lee un chat) — se pide en orden descendente porque limit() necesita
// ir de lo más nuevo hacia atrás para agarrar los ÚLTIMOS y no los
// primeros, y se da vuelta antes de entregarlo.
export function escucharMensajes(grupoId, callback) {
    const q = query(coleccionMensajes(grupoId), orderBy('creadoEn', 'desc'), limit(TANDA));
    return onSnapshot(q, snapshot => {
        const mensajes = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
        callback(mensajes);
    });
}

export function enviarMensaje(grupoId, autorUid, texto) {
    return addDoc(coleccionMensajes(grupoId), { autorUid, texto, creadoEn: serverTimestamp() });
}

// Solo el último mensaje de un grupo — para previews (ej. el carrusel de
// chats de Inicio), donde no hace falta cargar toda la conversación, solo
// saber "qué se dijo por última vez". Una sola lectura por grupo en vez
// de hasta 50 — importa cuando esto se llama una vez por cada grupo del
// usuario en Inicio, no una vez sola como en División de gastos.
export function escucharUltimoMensaje(grupoId, callback) {
    const q = query(coleccionMensajes(grupoId), orderBy('creadoEn', 'desc'), limit(1));
    return onSnapshot(q, snapshot => {
        callback(snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
    });
}

// Solo el propio autor puede borrar su mensaje (ver firestore.rules) —
// a diferencia de gastos/pagos, acá no tiene sentido que cualquier
// integrante pueda borrar lo que escribió otro.
export function eliminarMensaje(grupoId, mensajeId) {
    return deleteDoc(doc(db, 'grupos', grupoId, 'mensajes', mensajeId));
}
