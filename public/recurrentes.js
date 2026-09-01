// Recurrentes personales: plantillas que se guardan una vez y se
// recuerdan cada mes, en vez de tener que cargar lo mismo a mano todos
// los meses. Dos tipos, mismo mecanismo (`tipo: 'gasto' | 'ingreso'` —
// ausente = 'gasto', para los que ya existían antes de este campo):
// gastos fijos (alquiler, suscripciones, servicios) que se recuerdan
// contra usuarios/{uid}/pagos, e ingresos fijos (sueldo u otro) que se
// recuerdan contra usuarios/{uid}/ingresos. Viven los dos en
// usuarios/{uid}/recurrentes — cada uno es solo la "receta" (descripción,
// monto, día del mes aproximado, y para los gastos también categoría/
// moneda/método de pago); el movimiento real de cada mes se sigue
// cargando a mano como un pago o ingreso normal, no hay magia de "se
// crea solo" — ver recurrentesPendientes() más abajo, que es la que
// decide si hay que recordarle al usuario.

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

function coleccionRecurrentes(uid) {
    return collection(db, 'usuarios', uid, 'recurrentes');
}

export function escucharRecurrentes(uid, callback) {
    const q = query(coleccionRecurrentes(uid), orderBy('diaDelMes'));
    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function agregarRecurrente(uid, datos) {
    return addDoc(coleccionRecurrentes(uid), datos);
}

export function actualizarRecurrente(uid, id, datos) {
    return updateDoc(doc(db, 'usuarios', uid, 'recurrentes', id), datos);
}

export function eliminarRecurrente(uid, id) {
    return deleteDoc(doc(db, 'usuarios', uid, 'recurrentes', id));
}

// ¿Ya hay, entre las descripciones de este mes, algo que se pueda
// considerar "la misma compra/ingreso" que el recurrente? Antes exigía
// una igualdad EXACTA (sin mayúsculas ni espacios de más) — muy frágil:
// un recurrente "Alquiler" no reconocía un pago cargado como "Alquiler
// Agosto" o "Alquiler - depto", aunque para cualquier persona sea
// obviamente lo mismo, y seguía avisando "pendiente" pese a estar
// cargado. Ahora alcanza con que una contenga a la otra (en cualquier
// sentido) — sigue sin ser mágico (un "Netflix" no reconocería un pago
// cargado como "Suscripción streaming"), pero cubre el caso real y común
// de agregarle una palabra de más a la descripción de siempre.
function hayDescripcionParecida(descripcionesDelMes, descripcionRecurrente) {
    if (!descripcionRecurrente) return false;
    return descripcionesDelMes.some(d => d && (d.includes(descripcionRecurrente) || descripcionRecurrente.includes(d)));
}

// ¿Cuáles de los recurrentes activos todavía no se cargaron este mes
// calendario? Se detecta por descripción (ver hayDescripcionParecida,
// arriba) contra los pagos o ingresos personales del mes según el tipo.
//
// Caso especial para "Alquiler": esa categoría es prácticamente un solo
// gasto por mes (a diferencia de "Comida" o "Transporte", que tienen
// muchos gastos distintos) — si ya se cargó CUALQUIER gasto con
// categoría "alquiler" este mes, cuenta como hecho sin importar la
// descripción. A propósito no se generaliza a otras categorías: ahí sí
// "taparía" sin querer un recurrente que en realidad sigue pendiente
// (cualquier compra de comida marcaría como cargado un recurrente de
// "Comida" que no tiene nada que ver).
export function recurrentesPendientes(recurrentes, gastosPersonales, ingresosPersonales = []) {
    const hoy = new Date();
    const mesActual = hoy.toISOString().slice(0, 7);
    const diaActual = hoy.getDate();
    // Un recurrente con diaDelMes=31 nunca "llegaba" en febrero o en
    // cualquier mes de 30 días (diaActual jamás alcanza 31) — el aviso no
    // disparaba nunca esos meses. Se acota al último día real del mes
    // actual, así "31" se interpreta como "fin de mes" cuando corresponda.
    const diasEnEsteMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

    const gastosDelMes = gastosPersonales.filter(g => g.date && g.date.slice(0, 7) === mesActual);
    const descripcionesGastoDelMes = gastosDelMes.map(g => (g.description || '').trim().toLowerCase());
    const hayAlquilerCargadoEsteMes = gastosDelMes.some(g => g.categoria === 'alquiler');

    const descripcionesIngresoDelMes = ingresosPersonales
        .filter(i => i.date && i.date.slice(0, 7) === mesActual)
        .map(i => (i.description || '').trim().toLowerCase());

    return recurrentes.filter(r => {
        if (r.activo === false) return false;
        const diaEsperado = Math.min(r.diaDelMes || 1, diasEnEsteMes);
        if (diaActual < diaEsperado) return false; // todavía no llegó el día
        if (r.tipo !== 'ingreso' && r.categoria === 'alquiler' && hayAlquilerCargadoEsteMes) return false;
        const descripcionesDelMes = r.tipo === 'ingreso' ? descripcionesIngresoDelMes : descripcionesGastoDelMes;
        return !hayDescripcionParecida(descripcionesDelMes, (r.descripcion || '').trim().toLowerCase());
    });
}

// Registra un aumento porcentual sobre un recurrente (pensado sobre
// todo para el sueldo, pero sirve para cualquier ingreso o gasto
// recurrente) — calcula el nuevo monto y lo deja como el vigente, más
// un historial chico para poder consultarlo después (ej. comparar los
// aumentos de sueldo contra la inflación acumulada en el mismo período).
export function registrarAumento(uid, recurrente, porcentaje, fecha) {
    const montoAnterior = recurrente.monto;
    const montoNuevo = Math.round(montoAnterior * (1 + porcentaje / 100) * 100) / 100;
    const historial = [...(recurrente.historialAumentos || []), { fecha, porcentaje, montoAnterior, montoNuevo }];
    return actualizarRecurrente(uid, recurrente.id, { monto: montoNuevo, historialAumentos: historial });
}

// ---------- Recurrentes de un GRUPO (alquiler compartido, servicios de
// la casa, etc.) ----------
//
// Mismo mecanismo que los personales, pero viven en
// grupos/{grupoId}/recurrentes — todos los miembros del grupo los ven y
// los editan en tiempo real (igual que grupos/{grupoId}/expenses), en
// vez de pertenecerle a quien los creó. Cada uno guarda también
// `divididoEntre` (y opcionalmente `partes`, para un reparto desigual)
// con el mismo formato que un gasto grupal — "Cargar ahora" en
// división-de-gastos.html precarga el formulario "Agregar gasto" con
// esos datos, así no hay que volver a elegir entre quiénes se divide
// cada mes.
function coleccionRecurrentesGrupo(grupoId) {
    return collection(db, 'grupos', grupoId, 'recurrentes');
}

export function escucharRecurrentesGrupo(grupoId, callback) {
    const q = query(coleccionRecurrentesGrupo(grupoId), orderBy('diaDelMes'));
    return onSnapshot(q, snapshot => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function agregarRecurrenteGrupo(grupoId, datos) {
    return addDoc(coleccionRecurrentesGrupo(grupoId), datos);
}

export function actualizarRecurrenteGrupo(grupoId, id, datos) {
    return updateDoc(doc(db, 'grupos', grupoId, 'recurrentes', id), datos);
}

export function eliminarRecurrenteGrupo(grupoId, id) {
    return deleteDoc(doc(db, 'grupos', grupoId, 'recurrentes', id));
}

// Mismo criterio que recurrentesPendientes() — se compara contra
// `fecha` (la fecha que se eligió al cargar el gasto, no contra
// `creadoEn`, que es solo cuándo quedó guardado en la base). Así, un
// gasto de agosto cargado recién en septiembre sigue contando como "de
// agosto" y no tapa sin querer el aviso de septiembre. También aplica
// el mismo caso especial de "Alquiler" por categoría (ver el comentario
// grande en recurrentesPendientes) — muy útil acá porque el alquiler
// compartido es justo el ejemplo que motivó este recurrente grupal.
export function recurrentesGrupoPendientes(recurrentesGrupo, gastosGrupo) {
    const hoy = new Date();
    const mesActual = hoy.toISOString().slice(0, 7);
    const diaActual = hoy.getDate();
    const diasEnEsteMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();

    const gastosDelMes = gastosGrupo.filter(g => g.fecha && g.fecha.slice(0, 7) === mesActual);
    const descripcionesDelMes = gastosDelMes.map(g => (g.descripcion || '').trim().toLowerCase());
    const hayAlquilerCargadoEsteMes = gastosDelMes.some(g => g.categoria === 'alquiler');

    return recurrentesGrupo.filter(r => {
        if (r.activo === false) return false;
        const diaEsperado = Math.min(r.diaDelMes || 1, diasEnEsteMes);
        if (diaActual < diaEsperado) return false;
        if (r.categoria === 'alquiler' && hayAlquilerCargadoEsteMes) return false;
        return !hayDescripcionParecida(descripcionesDelMes, (r.descripcion || '').trim().toLowerCase());
    });
}
