// Seguimiento del alquiler: guarda cuándo empezó el contrato, cada
// cuántos meses se ajusta, y (si el usuario elige un índice automático)
// calcula el aumento sugerido según el índice acumulado desde el último
// ajuste — así no hay que ir a buscar el número a mano cada vez que toca
// renovar.
//
// Se guarda en usuarios/{uid} (mismo documento que perfil.js) — es
// información personal, no de un grupo.
//
// Dos índices automáticos disponibles: IPC (inflación general, vía
// argentinadatos.com) e ICL (Índice para Contratos de Locación del
// BCRA, el "oficial" para alquileres — su endpoint viejo (v3.0) había
// dejado de responder, pero la v4.0 (api.bcra.gob.ar/estadisticas/
// v4.0/monetarias/40) sí funciona, es gratis, sin API key y con CORS
// abierto). Además queda "Manual" para quien haya pactado otro índice
// (dólar, UVA, etc.) y prefiera cargar el monto a mano.

import { db } from './firebase-config.js';
import {
    doc,
    getDoc,
    setDoc,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export async function obtenerAlquiler(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().alquiler || null) : null;
}

// `datos`: { fechaInicio, indice ('ipc'|'icl'|'manual'), frecuenciaMeses,
// montoActual, fechaUltimoAjuste (null si nunca se ajustó todavía) }.
export function guardarAlquiler(uid, datos) {
    return setDoc(doc(db, 'usuarios', uid), { alquiler: datos }, { merge: true });
}

// Cuánto acumuló el IPC entre dos fechas (inclusive), compuesto mes a
// mes — no es una simple suma: cada mes es "más caro sobre el mes
// anterior ya aumentado", así que hay que multiplicar los factores, no
// sumar los porcentajes. Fuente: argentinadatos.com (gratis, sin key).
//
// Separada en dos: `obtenerSerieInflacion()` pide el dato una sola vez
// (útil cuando hay que calcular varios períodos distintos, ej. varias
// cuotas de una misma compra — sin esto, cada llamada a
// obtenerInflacionAcumulada() volvía a pedir TODO el historial de
// nuevo) y `obtenerInflacionAcumulada()` sigue siendo el atajo para el
// caso de un solo período (la usa Cuenta > Alquiler).
export async function obtenerSerieInflacion() {
    const respuesta = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
    if (!respuesta.ok) throw new Error('No se pudo consultar el índice de inflación.');
    return respuesta.json();
}

export function inflacionAcumuladaDeSerie(serie, desde, hasta) {
    const desdeTexto = desde.toISOString().slice(0, 10);
    const hastaTexto = hasta.toISOString().slice(0, 10);
    const relevantes = serie.filter(d => d.fecha >= desdeTexto && d.fecha <= hastaTexto);
    const factorAcumulado = relevantes.reduce((factor, d) => factor * (1 + d.valor / 100), 1);
    return (factorAcumulado - 1) * 100; // % acumulado en el período
}

export async function obtenerInflacionAcumulada(desde, hasta) {
    const serie = await obtenerSerieInflacion();
    return inflacionAcumuladaDeSerie(serie, desde, hasta);
}

// El ICL es un número índice (no un % mensual como el IPC), así que el
// aumento entre dos fechas es directamente la variación del índice:
// (valor_final / valor_inicial - 1) * 100 — sin componer nada mes a mes.
//
// El BCRA solo publica en días hábiles, así que una fecha exacta puede
// no tener valor (fin de semana/feriado) — se busca hasta 10 días hacia
// atrás y se toma el más reciente encontrado.
async function obtenerValorIcl(fecha) {
    const hasta = fecha.toISOString().slice(0, 10);
    const desde = new Date(fecha);
    desde.setDate(desde.getDate() - 10);
    const desdeTexto = desde.toISOString().slice(0, 10);

    const respuesta = await fetch(`https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/40?desde=${desdeTexto}&hasta=${hasta}`);
    if (!respuesta.ok) throw new Error('No se pudo consultar el ICL.');
    const datos = await respuesta.json();

    // El detalle viene ordenado del más reciente al más viejo — el
    // primero es el más cercano (hacia atrás) a la fecha pedida.
    const detalle = datos.results?.[0]?.detalle || [];
    if (detalle.length === 0) throw new Error('El BCRA no tiene valores de ICL publicados para esa fecha.');
    return detalle[0].valor;
}

export async function obtenerAumentoIcl(desde, hasta) {
    const [valorInicio, valorFin] = await Promise.all([
        obtenerValorIcl(desde),
        obtenerValorIcl(hasta),
    ]);
    return (valorFin / valorInicio - 1) * 100; // % acumulado en el período
}

// Suma `n` meses a una fecha sin desbordarse en meses de menos días
// (mismo criterio que sumarMeses en payments.html, para las cuotas).
function sumarMeses(fecha, n) {
    const resultado = new Date(fecha);
    const diaOriginal = resultado.getDate();
    resultado.setMonth(resultado.getMonth() + n);
    // Si el mes destino tiene menos días (ej. 31 de enero + 1 mes),
    // JS lo empuja al mes siguiente en vez de recortarlo al último día
    // — se corrige llevándolo al último día del mes destino.
    if (resultado.getDate() !== diaOriginal) {
        resultado.setDate(0);
    }
    return resultado;
}

// Encuentra el inicio del período actual (el último ajuste, o el inicio
// del contrato si todavía no hubo ninguno) y la fecha del próximo
// ajuste — avanzando de a `frecuenciaMeses` desde ahí hasta pasarse de
// hoy.
function periodoActual(alquiler) {
    const hoy = new Date();
    const inicio = new Date(`${alquiler.fechaUltimoAjuste || alquiler.fechaInicio}T00:00:00`);

    let inicioPeriodo = inicio;
    let proximoAjuste = sumarMeses(inicio, alquiler.frecuenciaMeses);
    while (proximoAjuste <= hoy) {
        inicioPeriodo = proximoAjuste;
        proximoAjuste = sumarMeses(proximoAjuste, alquiler.frecuenciaMeses);
    }
    return { inicioPeriodo, proximoAjuste };
}

// Todo lo que hace falta para mostrar el recordatorio: cuándo es el
// próximo ajuste, cuántos días faltan, y (si el índice es automático —
// IPC o ICL) el aumento acumulado y el monto sugerido. Si el índice es
// "manual", esos dos últimos quedan en null — el usuario ya sabe que
// tiene que consultarlo por su cuenta.
export async function calcularAjuste(alquiler) {
    const { inicioPeriodo, proximoAjuste } = periodoActual(alquiler);
    const diasParaAjuste = Math.ceil((proximoAjuste - new Date()) / 86400000);

    if (alquiler.indice !== 'ipc' && alquiler.indice !== 'icl') {
        return { proximoAjuste, diasParaAjuste, inflacionAcumulada: null, montoSugerido: null };
    }

    const inflacionAcumulada = alquiler.indice === 'icl'
        ? await obtenerAumentoIcl(inicioPeriodo, new Date())
        : await obtenerInflacionAcumulada(inicioPeriodo, new Date());
    const montoSugerido = alquiler.montoActual * (1 + inflacionAcumulada / 100);
    return { proximoAjuste, diasParaAjuste, inflacionAcumulada, montoSugerido };
}

// Se llama cuando el usuario confirma que ya aplicó el ajuste — actualiza
// el monto vigente y arranca el conteo del próximo período desde hoy.
export function aplicarAjuste(uid, alquiler, montoNuevo) {
    return guardarAlquiler(uid, {
        ...alquiler,
        montoActual: montoNuevo,
        fechaUltimoAjuste: new Date().toISOString().slice(0, 10),
    });
}
