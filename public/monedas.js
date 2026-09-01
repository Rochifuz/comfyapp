// Soporte de multi-moneda: por ahora 3 (peso argentino, dólar, euro).
// El peso argentino es la "moneda base" de la app — todos los totales,
// presupuestos y balances de grupo se calculan convertidos a pesos, y cada
// gasto se sigue mostrando en la moneda en la que se cargó.
//
// Las cotizaciones vienen de una API gratuita sin API key (open.er-api.com,
// base USD) y se cachean en localStorage por 12 horas — ni hace falta pedir
// tarjeta ni pegarle a la API en cada carga de página. Si la API falla y no
// hay nada cacheado, se usan valores de emergencia (desactualizados a
// propósito, mejor que romper la app) marcados con `desactualizado: true`.

export const MONEDAS = [
    { valor: 'ARS', simbolo: '$', texto: 'Peso argentino' },
    { valor: 'USD', simbolo: 'US$', texto: 'Dólar' },
    { valor: 'EUR', simbolo: '€', texto: 'Euro' },
];

export function opcionesDeMonedas() {
    return MONEDAS.map(m => `<option value="${m.valor}">${m.simbolo} ${m.texto}</option>`).join('');
}

export function simboloDeMoneda(valor) {
    return (MONEDAS.find(m => m.valor === valor) || MONEDAS[0]).simbolo;
}

const CLAVE_CACHE = 'cotizaciones-cache';
const DOCE_HORAS_MS = 12 * 60 * 60 * 1000;

// Valores de emergencia — solo se usan si la API falla Y no hay nada
// cacheado todavía (ej. primera vez que se abre la app sin internet). Son
// aproximados a propósito de agosto 2026, van a quedar desactualizados con
// el tiempo, pero es mejor que un $0 roto.
const RESPALDO_EMERGENCIA = { ARS: 1350, USD: 1, EUR: 0.92 };

// Devuelve { ARS, USD, EUR, actualizado, desactualizado }, donde cada valor
// es "cuántas unidades de esa moneda equivalen a 1 USD" (USD siempre 1).
export async function obtenerCotizaciones() {
    const cacheTexto = localStorage.getItem(CLAVE_CACHE);
    const cache = cacheTexto ? JSON.parse(cacheTexto) : null;

    if (cache && (Date.now() - cache.guardadoEn) < DOCE_HORAS_MS) {
        return { ...cache.tasas, actualizado: cache.actualizado, desactualizado: false };
    }

    try {
        const respuesta = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!respuesta.ok) throw new Error('Respuesta no OK');
        const datos = await respuesta.json();
        if (datos.result !== 'success' || !datos.rates || !datos.rates.ARS || !datos.rates.EUR) {
            throw new Error('Formato inesperado');
        }
        const tasas = { ARS: datos.rates.ARS, USD: 1, EUR: datos.rates.EUR };
        const actualizado = datos.time_last_update_utc || new Date().toISOString();
        localStorage.setItem(CLAVE_CACHE, JSON.stringify({ tasas, actualizado, guardadoEn: Date.now() }));
        return { ...tasas, actualizado, desactualizado: false };
    } catch {
        // Si falló pero había algo cacheado (aunque tenga más de 12hs), es
        // mejor usar eso desactualizado que la peor alternativa (romper el
        // cálculo o mostrar $0) — se marca `desactualizado` para que la UI
        // pueda avisar si quiere.
        if (cache) {
            return { ...cache.tasas, actualizado: cache.actualizado, desactualizado: true };
        }
        return { ...RESPALDO_EMERGENCIA, actualizado: null, desactualizado: true };
    }
}

// Convierte un monto de una moneda a otra usando el USD como pivote (así
// alcanza con tener la tasa de cada moneda contra USD, no todas contra
// todas). Si el origen y destino son la misma moneda, devuelve el monto tal
// cual sin pasar por ninguna cuenta (evita arrastrar error de redondeo).
export function convertir(monto, monedaOrigen, monedaDestino, cotizaciones) {
    if (!monto || monedaOrigen === monedaDestino) return monto;
    const tasaOrigen = cotizaciones[monedaOrigen] || 1;
    const tasaDestino = cotizaciones[monedaDestino] || 1;
    const montoEnUSD = monto / tasaOrigen;
    return montoEnUSD * tasaDestino;
}

// Atajo para el caso más común de la app: convertir a la moneda base (ARS)
// para poder sumar cosas cargadas en distintas monedas.
export function convertirABase(monto, moneda, cotizaciones) {
    return convertir(monto, moneda || 'ARS', 'ARS', cotizaciones);
}

// Cuánto vale 1 unidad de `moneda` en pesos, según la cotización
// automática (API) — para mostrar como referencia al lado del campo de
// "usar otro valor de cambio" (ver cuentaEnARS más abajo). null si la
// moneda es ARS (no aplica) o todavía no cargaron las cotizaciones.
export function cotizacionActual(moneda, cotizaciones) {
    if (!cotizaciones || !moneda || moneda === 'ARS') return null;
    return convertirABase(1, moneda, cotizaciones);
}

// El cálculo que se usa en toda la app para pasar un monto a pesos: si el
// gasto/pago tiene una cotización MANUAL guardada (la persona escribió "a
// cuánto" pagó, ej. dólar blue pactado entre los del grupo), esa gana
// siempre — es la fuente más confiable porque es la que de verdad se
// usó. Si no hay manual, se cae a la automática (API); si tampoco hay
// cotizaciones cargadas todavía, se devuelve el monto tal cual (asume
// que es peso, ver movimientos.js).
export function montoEnARS(monto, moneda, cotizacionManual, cotizaciones) {
    if (!moneda || moneda === 'ARS') return monto;
    if (cotizacionManual > 0) return monto * cotizacionManual;
    return cotizaciones ? convertirABase(monto, moneda, cotizaciones) : monto;
}

// --- Dólar en Argentina (oficial / MEP / blue), solo para MOSTRAR en
// Inicio como referencia — no se usa en ningún cálculo de la app (eso es
// obtenerCotizaciones() de arriba, un solo dólar "de mercado" tomado de
// otra API). Viene de dolarapi.com (gratis, sin key, la usan un montón de
// apps argentinas) — devuelve compra/venta de cada tipo de cambio, que en
// Argentina pueden diferir bastante entre sí. Cache de 30 minutos: estos
// valores se mueven más seguido en el día que USD/EUR "de libro".
const CLAVE_CACHE_DOLARES = 'dolares-ar-cache';
const TREINTA_MIN_MS = 30 * 60 * 1000;

export async function obtenerDolaresArgentina() {
    const cacheTexto = localStorage.getItem(CLAVE_CACHE_DOLARES);
    const cache = cacheTexto ? JSON.parse(cacheTexto) : null;

    if (cache && (Date.now() - cache.guardadoEn) < TREINTA_MIN_MS) {
        return { ...cache.datos, desactualizado: false };
    }

    try {
        const respuesta = await fetch('https://dolarapi.com/v1/dolares');
        if (!respuesta.ok) throw new Error('Respuesta no OK');
        const lista = await respuesta.json();
        const buscar = (casa) => lista.find(d => d.casa === casa) || null;
        // "bolsa" es como dolarapi.com le dice internamente al dólar MEP.
        const datos = { oficial: buscar('oficial'), blue: buscar('blue'), mep: buscar('bolsa') };
        localStorage.setItem(CLAVE_CACHE_DOLARES, JSON.stringify({ datos, guardadoEn: Date.now() }));
        return { ...datos, desactualizado: false };
    } catch {
        if (cache) return { ...cache.datos, desactualizado: true };
        return { oficial: null, blue: null, mep: null, desactualizado: true };
    }
}

// Mismo criterio que el dólar de arriba, pero para el euro — a
// diferencia del dólar, en Argentina el euro no tiene variantes "blue"
// ni "MEP" propias, así que dolarapi.com solo ofrece un tipo de cambio
// (el oficial), con su compra y venta.
const CLAVE_CACHE_EURO = 'euro-ar-cache';

export async function obtenerEuroArgentina() {
    const cacheTexto = localStorage.getItem(CLAVE_CACHE_EURO);
    const cache = cacheTexto ? JSON.parse(cacheTexto) : null;

    if (cache && (Date.now() - cache.guardadoEn) < TREINTA_MIN_MS) {
        return { ...cache.datos, desactualizado: false };
    }

    try {
        const respuesta = await fetch('https://dolarapi.com/v1/cotizaciones/eur');
        if (!respuesta.ok) throw new Error('Respuesta no OK');
        const datos = await respuesta.json();
        localStorage.setItem(CLAVE_CACHE_EURO, JSON.stringify({ datos, guardadoEn: Date.now() }));
        return { ...datos, desactualizado: false };
    } catch {
        if (cache) return { ...cache.datos, desactualizado: true };
        return { compra: null, venta: null, desactualizado: true };
    }
}
