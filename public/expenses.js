// Persistencia de la sección "División de Gastos" en Firestore, bajo
// grupos/{grupoId}/expenses y grupos/{grupoId}/pagosDeuda. A diferencia de
// los pagos personales (storage.js), esto es compartido: todos los
// miembros del grupo leen y escriben la misma colección, y con
// onSnapshot cada uno ve en vivo lo que cargan los demás.

import { db } from './firebase-config.js';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function coleccionGastos(grupoId) {
    return collection(db, 'grupos', grupoId, 'expenses');
}

function coleccionPagosDeuda(grupoId) {
    return collection(db, 'grupos', grupoId, 'pagosDeuda');
}

export function escucharGastos(grupoId, callback) {
    const q = query(coleccionGastos(grupoId), orderBy('creadoEn', 'desc'));
    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function agregarGasto(grupoId, gasto) {
    return addDoc(coleccionGastos(grupoId), gasto);
}

export function actualizarGasto(grupoId, gastoId, datos) {
    return updateDoc(doc(db, 'grupos', grupoId, 'expenses', gastoId), datos);
}

export function eliminarGasto(grupoId, gastoId) {
    return deleteDoc(doc(db, 'grupos', grupoId, 'expenses', gastoId));
}

export function escucharPagosDeuda(grupoId, callback) {
    const q = query(coleccionPagosDeuda(grupoId), orderBy('creadoEn', 'desc'));
    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function agregarPagoDeuda(grupoId, pago) {
    return addDoc(coleccionPagosDeuda(grupoId), pago);
}

export function eliminarPagoDeuda(grupoId, pagoId) {
    return deleteDoc(doc(db, 'grupos', grupoId, 'pagosDeuda', pagoId));
}
