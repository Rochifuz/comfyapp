// Dos colecciones personales más, además de los gastos (storage.js):
// pagos hechos a la tarjeta de crédito (para saber el saldo real que
// debés, no solo lo que se viene en el próximo resumen) e ingresos/sueldo
// (para poder comparar cuánto entra contra cuánto sale).

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

function coleccion(uid, nombre) {
    return collection(db, 'usuarios', uid, nombre);
}

function escuchar(uid, nombre, callback) {
    const q = query(coleccion(uid, nombre), orderBy('date'));
    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// --- Pagos de tarjeta ---

export function escucharPagosTarjeta(uid, callback) {
    return escuchar(uid, 'pagosTarjeta', callback);
}

export function agregarPagoTarjeta(uid, pago) {
    return addDoc(coleccion(uid, 'pagosTarjeta'), pago);
}

export function actualizarPagoTarjeta(uid, id, datos) {
    return updateDoc(doc(db, 'usuarios', uid, 'pagosTarjeta', id), datos);
}

export function eliminarPagoTarjeta(uid, id) {
    return deleteDoc(doc(db, 'usuarios', uid, 'pagosTarjeta', id));
}

// --- Ingresos / sueldo ---

export function escucharIngresos(uid, callback) {
    return escuchar(uid, 'ingresos', callback);
}

export function agregarIngreso(uid, ingreso) {
    return addDoc(coleccion(uid, 'ingresos'), ingreso);
}

export function actualizarIngreso(uid, id, datos) {
    return updateDoc(doc(db, 'usuarios', uid, 'ingresos', id), datos);
}

export function eliminarIngreso(uid, id) {
    return deleteDoc(doc(db, 'usuarios', uid, 'ingresos', id));
}
