// Persistencia de los gastos personales (sección "Gastos personales") en Firestore,
// bajo usuarios/{uid}/pagos — cada usuario ve solo los suyos.
//
// Antes esto guardaba todo en localStorage como un único objeto agrupado
// por mes que se reescribía entero en cada cambio. Ahora cada pago es un
// documento propio: los borrados usan su id de documento (no un índice de
// array, que era la fuente del bug de "se borra el pago equivocado" que
// tenía payments.html) y escucharPagos() empuja actualizaciones en tiempo
// real — si el mismo usuario tiene la app abierta en dos pestañas o
// dispositivos, ambas quedan sincronizadas solas.

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

function coleccionPagos(uid) {
    return collection(db, 'usuarios', uid, 'pagos');
}

// Llama a `callback` con la lista completa de pagos cada vez que cambia
// (alta, baja, o carga inicial). Devuelve la función para dejar de
// escuchar (útil si la página se desmonta, aunque acá no hace falta).
export function escucharPagos(uid, callback) {
    const q = query(coleccionPagos(uid), orderBy('date'));
    return onSnapshot(q, snapshot => {
        const pagos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(pagos);
    });
}

export function agregarPago(uid, pago) {
    return addDoc(coleccionPagos(uid), pago);
}

export function actualizarPago(uid, pagoId, datos) {
    return updateDoc(doc(db, 'usuarios', uid, 'pagos', pagoId), datos);
}

export function eliminarPago(uid, pagoId) {
    return deleteDoc(doc(db, 'usuarios', uid, 'pagos', pagoId));
}
