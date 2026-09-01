// Configuración de perfil que no es ni "cuenta de Firebase Auth" ni
// "grupo": por ahora, el día de cierre de la tarjeta de crédito (para
// calcular el resumen que viene en Gastos personales). Vive en el mismo
// documento usuarios/{uid} que ya usa grupos.js para la lista de grupos.

import { db } from './firebase-config.js';
import {
    doc,
    getDoc,
    setDoc,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export async function obtenerDiaCierreTarjeta(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().diaCierreTarjeta || null) : null;
}

export function guardarDiaCierreTarjeta(uid, diaCierre) {
    // merge: true porque no queremos pisar el resto del documento (ej. la
    // lista de grupos que guarda grupos.js ahí mismo).
    return setDoc(doc(db, 'usuarios', uid), { diaCierreTarjeta: diaCierre }, { merge: true });
}

// Presupuesto mensual (un solo monto general, no por categoría todavía) y
// día del mes en que cobrás el sueldo (opcional, solo informativo por
// ahora). Los dos se piden juntos porque se configuran desde la misma
// tarjeta en cuenta.html.
export async function obtenerPresupuesto(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    if (!snap.exists()) return { presupuestoMensual: null, diaSueldo: null };
    const datos = snap.data();
    return {
        presupuestoMensual: datos.presupuestoMensual || null,
        diaSueldo: datos.diaSueldo || null,
    };
}

export function guardarPresupuesto(uid, presupuestoMensual, diaSueldo) {
    return setDoc(doc(db, 'usuarios', uid), { presupuestoMensual, diaSueldo }, { merge: true });
}

// Presupuesto por categoría (opcional, además del mensual general de
// arriba) — mapa { comida: 80000, transporte: 30000, ... }, solo con las
// categorías que el usuario decidió limitar. Vive en el mismo documento.
export async function obtenerPresupuestosPorCategoria(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().presupuestosPorCategoria || {}) : {};
}

export function guardarPresupuestosPorCategoria(uid, mapa) {
    return setDoc(doc(db, 'usuarios', uid), { presupuestosPorCategoria: mapa }, { merge: true });
}

// --- Preferencias de notificaciones (campanita 🔔, ver
// notificacionesCentro.js) ---
//
// Cada tipo de aviso automático de GastosApp se puede prender/apagar
// por separado, y el de cierre de tarjeta además permite
// elegir con cuánta anticipación (mismo espíritu que el aviso
// configurable de TareasApp — ver tareas/tareas.js). Se guardan todas
// juntas en un solo campo (en vez de uno suelto por preferencia) para no
// llenar usuarios/{uid} de campos sueltos.
//
// `deudaSaldada` es la única que hace falta que OTRO usuario pueda leer
// (quien te salda una deuda, para saber si corresponde avisarte) — por
// eso se denormaliza una copia en cada grupo del que formás parte, ver
// actualizarPreferenciasNotifEnMisGrupos() en grupos.js. Las demás son
// autoavisos (nadie más las necesita leer).
const PREFERENCIAS_NOTIF_DEFAULT = {
    deudaSaldada: true,
    cierreTarjeta: true,
    cierreTarjetaDiasAntes: 3,
    presupuesto: true,
    recurrentes: true,
};

export async function obtenerPreferenciasNotif(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    const guardadas = snap.exists() ? (snap.data().preferenciasNotif || {}) : {};
    // Se combinan con los valores por defecto en vez de devolver
    // "guardadas" tal cual — así una preferencia agregada en una versión
    // futura de la app no queda "undefined" (que en un `if` se comporta
    // distinto a `false`) para cuentas que nunca volvieron a guardar.
    return { ...PREFERENCIAS_NOTIF_DEFAULT, ...guardadas };
}

export function guardarPreferenciasNotif(uid, preferencias) {
    return setDoc(doc(db, 'usuarios', uid), { preferenciasNotif: preferencias }, { merge: true });
}

// Foto de perfil — un avatar chico ya recortado y comprimido (ver
// imagen.js), guardado como data URI directo en el documento en vez de
// subirlo a un storage de archivos aparte (que en Firebase pide plan
// pago). `null` significa "no tiene, mostrar el 😊 de siempre".
export async function obtenerFotoPerfil(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().fotoPerfil || null) : null;
}

export function guardarFotoPerfil(uid, fotoDataURI) {
    return setDoc(doc(db, 'usuarios', uid), { fotoPerfil: fotoDataURI }, { merge: true });
}

// Alias, CVU o link de cobro de Mercado Pago — opcional, lo carga cada
// quien en cuenta.html para que el resto del grupo le pueda pagar sus
// deudas más rápido (ver botón "Pagar con Mercado Pago" en
// division-de-gastos.html). Es un campo de texto libre a propósito: no
// hay forma gratis y sin backend propio de generar un cobro con monto
// exacto desde acá (eso requiere el Access Token de Mercado Pago, que es
// secreto y no puede vivir en código que corre en el navegador de
// cualquiera) — así que en vez de "cobrar automático", esto es "decirle
// a quién pagarle" lo más rápido posible: uno pega su alias/CVU, o el
// link de cobro que ya generó desde su propia app de Mercado Pago.
export async function obtenerAliasMercadoPago(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().aliasMercadoPago || null) : null;
}

export function guardarAliasMercadoPago(uid, alias) {
    return setDoc(doc(db, 'usuarios', uid), { aliasMercadoPago: alias || null }, { merge: true });
}

// El "ciclo actual" es el período de gastos que todavía no cerró y que por
// lo tanto va a aparecer en el PRÓXIMO resumen. Ej: si la tarjeta cierra el
// día 10 y hoy es 25 de agosto, el ciclo actual va del 11 de agosto al 10
// de septiembre — lo que se cargue en esos días es lo que se paga en
// octubre.
export function calcularCicloDeTarjeta(diaCierre, fechaReferencia = new Date()) {
    let cierre = new Date(fechaReferencia.getFullYear(), fechaReferencia.getMonth(), diaCierre);

    if (fechaReferencia > cierre) {
        cierre = new Date(fechaReferencia.getFullYear(), fechaReferencia.getMonth() + 1, diaCierre);
    }

    const inicio = new Date(cierre);
    inicio.setMonth(inicio.getMonth() - 1);
    inicio.setDate(inicio.getDate() + 1);

    return { inicio, cierre };
}
