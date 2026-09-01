// Clima actual — usa Open-Meteo (https://open-meteo.com): gratis, sin API
// key, sin tarjeta, y a diferencia de la API de Steam/noticias, SÍ manda
// los headers CORS que hacen falta, así que se pide directo desde el
// navegador sin pasar por ningún proxy propio.

// Buenos Aires — respaldo cuando no hay geolocalización real (la persona
// la denegó, el navegador no la soporta, o tardó demasiado en contestar).
const BUENOS_AIRES = { lat: -34.6037, lon: -58.3816 };

// Códigos WMO de weather_code (los devuelve Open-Meteo tal cual) → emoji +
// descripción en criollo. Se agrupan variantes parecidas entre sí (todas
// las intensidades de llovizna caen en "Llovizna", etc.) — para un vistazo
// rápido no hace falta distinguir cada matiz que documenta el estándar.
const CODIGOS_CLIMA = {
    0: ['☀️', 'Despejado'],
    1: ['🌤️', 'Mayormente despejado'],
    2: ['⛅', 'Parcialmente nublado'],
    3: ['☁️', 'Nublado'],
    45: ['🌫️', 'Niebla'], 48: ['🌫️', 'Niebla'],
    51: ['🌦️', 'Llovizna'], 53: ['🌦️', 'Llovizna'], 55: ['🌦️', 'Llovizna'],
    56: ['🌦️', 'Llovizna helada'], 57: ['🌦️', 'Llovizna helada'],
    61: ['🌧️', 'Lluvia'], 63: ['🌧️', 'Lluvia'], 65: ['🌧️', 'Lluvia fuerte'],
    66: ['🌧️', 'Lluvia helada'], 67: ['🌧️', 'Lluvia helada'],
    71: ['🌨️', 'Nieve'], 73: ['🌨️', 'Nieve'], 75: ['🌨️', 'Nieve fuerte'],
    77: ['🌨️', 'Granos de nieve'],
    80: ['🌦️', 'Chaparrones'], 81: ['🌦️', 'Chaparrones'], 82: ['⛈️', 'Chaparrones fuertes'],
    85: ['🌨️', 'Chaparrones de nieve'], 86: ['🌨️', 'Chaparrones de nieve'],
    95: ['⛈️', 'Tormenta'], 96: ['⛈️', 'Tormenta con granizo'], 99: ['⛈️', 'Tormenta con granizo'],
};

export function descripcionClima(weatherCode) {
    return CODIGOS_CLIMA[weatherCode] || ['🌡️', 'Sin datos'];
}

// --- Elegir la ubicación a mano ---
//
// Además de la detección automática de más abajo, se puede buscar y
// elegir una ciudad puntual — la elección se guarda en sessionStorage
// (NO localStorage) a propósito: "por sesión", se olvida sola al cerrar
// la pestaña, en vez de quedar pegada para siempre como pasaría con una
// preferencia de cuenta. Mismo criterio que el grupo activo de "Cuenta
// rápida" en grupos.js.
const CLAVE_UBICACION_SESION = 'clima-ubicacion-elegida';

export function guardarUbicacionElegida(ubicacion) {
    // ubicacion: { lat, lon, nombre } — nombre es lo que se muestra en la
    // card (ej. "Córdoba"), ya armado por quien llama (ver
    // buscarCiudades() más abajo).
    sessionStorage.setItem(CLAVE_UBICACION_SESION, JSON.stringify(ubicacion));
    borrarCacheClima(); // la ubicación cambió — el clima cacheado (si había) es de OTRO lugar, no sirve
}

// Para volver a la detección automática (botón "Usar mi ubicación actual").
export function borrarUbicacionElegida() {
    sessionStorage.removeItem(CLAVE_UBICACION_SESION);
    borrarCacheClima();
}

export function hayUbicacionElegida() {
    return !!sessionStorage.getItem(CLAVE_UBICACION_SESION);
}

// Geocodificación de Open-Meteo (mismo servicio que el pronóstico —
// sin API key, sin tarjeta, con CORS habilitado) — busca ciudades por
// nombre. Devuelve como mucho 6 resultados, cada uno con lo necesario
// para mostrarlo en una lista (nombre, provincia/región, país) y para
// pedir después el clima (lat/lon). Nunca rechaza la promesa — sin
// resultados (ciudad rara, sin conexión, API caída) devuelve una lista
// vacía y quien llama decide qué mostrar.
export async function buscarCiudades(consulta) {
    const texto = consulta.trim();
    if (!texto) return [];
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(texto)}&count=6&language=es&format=json`;
        const respuesta = await fetch(url);
        if (!respuesta.ok) return [];
        const datos = await respuesta.json();
        return (datos.results || []).map(r => ({
            nombre: r.name,
            region: r.admin1 || null,
            pais: r.country || null,
            lat: r.latitude,
            lon: r.longitude,
        }));
    } catch {
        return [];
    }
}

// Geocodificación INVERSA (coordenadas → nombre de ciudad) — Open-Meteo
// no ofrece esto, así que se usa BigDataCloud
// (api.bigdatacloud.net/data/reverse-geocode-client), pensada
// específicamente para pedirse desde el navegador: gratis, sin API key,
// sin tarjeta, con CORS habilitado. Devuelve null (nunca rechaza la
// promesa) si no hay ciudad para esas coordenadas o la API no contesta.
async function nombreDeCiudad(lat, lon) {
    try {
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`;
        const respuesta = await fetch(url);
        if (!respuesta.ok) return null;
        const datos = await respuesta.json();
        return datos.city || datos.locality || null;
    } catch {
        return null;
    }
}

// --- Cache corto del resultado ya armado ---
//
// Antes, CADA carga de página repetía las 3 esperas de punta a punta (GPS
// → nombre de ciudad → clima), aunque hubiera sido la página anterior la
// que ya las hizo hace 10 segundos — de ahí la demora perceptible al
// entrar a ComfyApp. Se guarda acá el resultado ya armado de
// obtenerClima() por un rato corto (mismos 10 min que ya se le daban de
// margen al GPS más abajo, `maximumAge`) — dentro de esa ventana, entrar
// a otra página del mega sistema (misma pestaña, así que sessionStorage
// se mantiene) muestra el clima al toque, sin ningún pedido de red.
//
// Se invalida (se borra) apenas cambia la ubicación — ver
// guardarUbicacionElegida()/borrarUbicacionElegida() más arriba — para
// nunca mostrar por accidente el clima de un lugar viejo.
const CLAVE_CACHE_CLIMA = 'clima-cache';
const DURACION_CACHE_MS = 10 * 60 * 1000;

function climaCacheado() {
    try {
        const guardado = JSON.parse(sessionStorage.getItem(CLAVE_CACHE_CLIMA) || 'null');
        if (!guardado || Date.now() - guardado.momento > DURACION_CACHE_MS) return null;
        return guardado.clima;
    } catch {
        return null;
    }
}

function guardarClimaEnCache(clima) {
    try {
        sessionStorage.setItem(CLAVE_CACHE_CLIMA, JSON.stringify({ clima, momento: Date.now() }));
    } catch {
        // sessionStorage lleno o deshabilitado (raro) — no es grave, sencillamente no queda cacheado esta vez
    }
}

function borrarCacheClima() {
    sessionStorage.removeItem(CLAVE_CACHE_CLIMA);
}

// Devuelve la ubicación elegida a mano (si hay una guardada), o la
// posición del navegador si la persona da permiso, o Buenos Aires si lo
// deniega/no responde a tiempo/el navegador no la soporta — a propósito
// nunca rechaza la promesa, para que obtenerClima() no tenga que manejar
// ese caso aparte del de "Open-Meteo no contestó".
//
// A diferencia de antes, acá NO se pide el nombre de la ciudad todavía
// cuando viene del GPS (queda `nombre: null`) — se pide en paralelo con
// el clima, no antes, ver obtenerClima() más abajo.
function obtenerUbicacion() {
    const elegida = sessionStorage.getItem(CLAVE_UBICACION_SESION);
    if (elegida) {
        try {
            return Promise.resolve(JSON.parse(elegida));
        } catch {
            sessionStorage.removeItem(CLAVE_UBICACION_SESION); // quedó algo corrupto — se descarta y sigue con la detección normal
        }
    }

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve({ ...BUENOS_AIRES, nombre: 'Buenos Aires', esUbicacionReal: false });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (posicion) => resolve({
                lat: posicion.coords.latitude,
                lon: posicion.coords.longitude,
                nombre: null,
                esUbicacionReal: true,
            }),
            () => resolve({ ...BUENOS_AIRES, nombre: 'Buenos Aires', esUbicacionReal: false }),
            { timeout: 8000, maximumAge: 600000 }, // cache de 10 min — no hace falta el GPS exacto cada vez
        );
    });
}

// Clima actual + mínima/máxima de hoy + pronóstico de los próximos 7 días,
// en la ubicación real de quien mira (si dio permiso) o en Buenos Aires
// (si no). Devuelve null si Open-Meteo no contesta — sin key ni tarjeta de
// por medio, pero sigue siendo una API externa que puede estar caída;
// quien llama decide qué mostrar en ese caso.
//
// No hace falta pedir "forecast_days=7" a propósito — es el valor por
// defecto de Open-Meteo cuando no se especifica, así que `daily` ya viene
// con 7 días (hoy + 6 más) sin ningún parámetro extra.
export async function obtenerClima() {
    const cacheado = climaCacheado();
    if (cacheado) return cacheado;

    const ubicacion = await obtenerUbicacion();
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${ubicacion.lat}&longitude=${ubicacion.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`;
        // El nombre de la ciudad (cuando hace falta pedirlo — ver el
        // `nombre: null` de acá arriba) y el clima en sí son pedidos
        // independientes: antes se esperaba uno para recién arrancar el
        // otro, ahora van EN PARALELO — es la mejora más grande a la
        // demora total, ya que son dos pedidos de red que antes se
        // sumaban en vez de superponerse.
        const [respuesta, nombre] = await Promise.all([
            fetch(url),
            ubicacion.nombre ? Promise.resolve(ubicacion.nombre) : nombreDeCiudad(ubicacion.lat, ubicacion.lon).then(n => n || 'Tu ubicación'),
        ]);
        if (!respuesta.ok) return null;
        const datos = await respuesta.json();
        const clima = {
            nombre,
            actual: Math.round(datos.current.temperature_2m),
            minima: Math.round(datos.daily.temperature_2m_min[0]),
            maxima: Math.round(datos.daily.temperature_2m_max[0]),
            weatherCode: datos.current.weather_code,
            // Un elemento por día ("YYYY-MM-DD" tal cual lo manda
            // Open-Meteo, ya en la zona horaria del lugar gracias a
            // timezone=auto) — el día 0 es hoy, coincide con
            // actual/minima/maxima de arriba.
            pronostico: datos.daily.time.map((fecha, i) => ({
                fecha,
                minima: Math.round(datos.daily.temperature_2m_min[i]),
                maxima: Math.round(datos.daily.temperature_2m_max[i]),
                weatherCode: datos.daily.weather_code[i],
            })),
        };
        guardarClimaEnCache(clima);
        return clima;
    } catch {
        return null;
    }
}
