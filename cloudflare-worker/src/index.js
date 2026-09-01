// Proxy chico para APIs externas que no dejan que un navegador les pegue
// directo desde otra web (no mandan Access-Control-Allow-Origin), o que
// necesitan un secreto que no puede vivir en JS del lado del cliente —
// arrancó siendo solo para Steam, y fue sumando rutas nuevas por motivos
// parecidos: /noticias (GNews + NewsData, ver más abajo) por la falta de
// CORS, /calendar-token (AgendaApp) porque el intercambio de tokens de
// Google necesita el Client Secret. Este Worker:
//   1) Guarda 4 secretos — nunca en el código, nunca visibles para quien
//      mire el JS de las apps — cargados con `wrangler secret put
//      NOMBRE`, ver README.md de esta carpeta:
//        - STEAM_API_KEY       (GamingApp — perfil/biblioteca de Steam)
//        - GNEWS_API_KEY       (ComfyApp — noticias, proveedor 1)
//        - NEWSDATA_API_KEY    (ComfyApp — noticias, proveedor 2)
//        - GOOGLE_CLIENT_SECRET (AgendaApp — conectar Google Calendar)
//        - RIOT_API_KEY         (GamingApp — Tracker de League of Legends/TFT)
//   2) Le pega a esas APIs en tu nombre y devuelve la respuesta con los
//      headers CORS que hacen falta para que GastosApp/ComfyApp/
//      GamingApp/AgendaApp la puedan leer.
//   3) Solo responde con esos headers a los orígenes de la lista de abajo
//      — cualquier otra web que intente usar este Worker se queda sin
//      poder leer la respuesta (el pedido en sí no se bloquea, pero el
//      navegador de quien lo haga descarta la respuesta).
//
// Nota sobre /noticias: el primer intento fue pedirle el RSS directo a
// Google News (sin API key, "gratis" de verdad) — pero Google (y después
// se probó con Infobae y La Nación) bloquea el pool de IPs compartido de
// Cloudflare Workers con 403/503, sin importar qué headers se manden. No
// es algo arreglable desde acá: los sitios de noticias con protección
// antibots tratan a Cloudflare Workers como tráfico sospechoso. Por eso
// /noticias usa GNews + NewsData, pensadas para consumirse programáticamente.
//
// Gratis en el plan Free de Cloudflare Workers (100.000 pedidos/día) —
// no hace falta tarjeta para darlo de alta.

const ORIGENES_PERMITIDOS = [
    'https://tu-proyecto.web.app', // reemplazar por tu dominio real de Firebase Hosting
    'http://localhost:8080', // npm start, para probar en local
];

function headersCors(origin) {
    const permitido = ORIGENES_PERMITIDOS.includes(origin);
    return {
        'Access-Control-Allow-Origin': permitido ? origin : 'null',
        // GET para todo lo de siempre (Steam/noticias) — POST sumado acá
        // solo para /calendar-token (ver más abajo), que manda el código/
        // refresh_token en el body en vez de la URL.
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
    };
}

function json(datos, status, cors) {
    return new Response(JSON.stringify(datos), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

// Cuando la Steam API key es inválida (vacía, mal copiada, revocada...)
// Steam no devuelve un JSON con un mensaje de error — devuelve un 401 o
// 403 con una paginita HTML. Antes este Worker reenviaba esa respuesta
// tal cual con Content-Type: application/json (mintiendo sobre el
// formato), así que GamingApp intentaba hacer .json() sobre HTML y
// explotaba con un error confuso ("Unexpected token '<'..."). Esta
// función arma SIEMPRE una respuesta JSON de verdad — si Steam contestó
// mal, se lo dice clarito en vez de reenviar la basura.
async function reenviarDeSteam(steamUrl, cors) {
    const respuesta = await fetch(steamUrl);
    const texto = await respuesta.text();

    if (!respuesta.ok) {
        // 401/403 en Steam casi siempre es la API key — se lo dice
        // explícito para no hacer perder tiempo adivinando.
        const pista = (respuesta.status === 401 || respuesta.status === 403)
            ? ' — revisá que STEAM_API_KEY esté bien cargada (ver README.md, "wrangler secret put STEAM_API_KEY").'
            : '';
        return json({ error: `Steam respondió ${respuesta.status}${pista}` }, 502, cors);
    }

    try {
        // Se re-empaqueta (parsear y volver a stringificar) en vez de
        // reenviar el texto tal cual — así, si alguna vez Steam devuelve
        // 200 con algo que no es JSON de verdad, se detecta acá y no
        // más adelante en el navegador.
        return json(JSON.parse(texto), 200, cors);
    } catch {
        return json({ error: 'Steam devolvió una respuesta con un formato inesperado.' }, 502, cors);
    }
}

// SteamID64 son siempre 17 dígitos — chequeo simple para no reenviar a
// Steam un parámetro claramente inválido.
const ES_STEAMID64 = /^\d{17}$/;

// --- Tracker de League of Legends/TFT (GamingApp) ---
//
// Riot separa sus endpoints en dos "ruteos" distintos según la API (ver
// https://developer.riotgames.com/docs/lol#routing-values):
//  - "Regional" (americas/europe/asia/sea): account-v1 (resolver un Riot
//    ID a un puuid) y match-v5/tft-match-v1 (historial de partidas).
//  - "Plataforma" (la2, na1, euw1...): league-v4/tft-league-v1 (rango
//    actual), específico de en qué servidor jugás.
// Los dos valores vienen del navegador como query param — SIN validarlos
// contra una lista fija, alguien podría mandar algo como
// "algo.com/redirect?x=" y lograr que este Worker le pegue a un host
// cualquiera en vez de a Riot (se arma la URL pegando el string
// directo, no hay forma de "escapar" un parámetro para que solo pueda
// ser un subdominio). Por eso las dos listas de abajo.
const REGIONES_RIOT = new Set(['americas', 'europe', 'asia', 'sea']);
const PLATAFORMAS_RIOT = new Set([
    'na1', 'euw1', 'eun1', 'kr', 'jp1', 'br1', 'la1', 'la2',
    'oc1', 'tr1', 'ru', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
]);

// Mismo espíritu que reenviarDeSteam: Riot también puede devolver algo
// que no es JSON (o un 403/404 con una key mal cargada o un Riot ID que
// no existe) — se arma SIEMPRE una respuesta JSON de verdad en vez de
// reenviar lo que sea que haya contestado.
async function reenviarDeRiot(riotUrl, env, cors) {
    if (!env.RIOT_API_KEY) {
        return json({ error: 'Falta configurar el secreto RIOT_API_KEY (ver README.md, "wrangler secret put RIOT_API_KEY").' }, 500, cors);
    }
    const respuesta = await fetch(riotUrl, { headers: { 'X-Riot-Token': env.RIOT_API_KEY } });
    const texto = await respuesta.text();

    if (!respuesta.ok) {
        if (respuesta.status === 404) {
            // No es un error de verdad — solo no existe (Riot ID mal
            // escrito, o el puuid no tiene partidas rankeadas todavía).
            return json({ notFound: true }, 200, cors);
        }
        const pista = (respuesta.status === 401 || respuesta.status === 403)
            ? ' — revisá que RIOT_API_KEY esté bien cargada y no haya vencido (las keys de desarrollo duran 24hs, ver README.md).'
            : (respuesta.status === 429 ? ' — demasiados pedidos seguidos a Riot, probá de nuevo en un momento.' : '');
        return json({ error: `Riot respondió ${respuesta.status}${pista}` }, 502, cors);
    }

    try {
        return json(JSON.parse(texto), 200, cors);
    } catch {
        return json({ error: 'Riot devolvió una respuesta con un formato inesperado.' }, 502, cors);
    }
}

// --- /calendar-token — renovación del token de Google Calendar (AgendaApp) ---
//
// El Client ID NO es secreto (viaja igual en la URL de autorización que
// arma el navegador) — el Client Secret sí, y por eso este intercambio
// tiene que pasar por acá (un fetch desde el navegador directo a
// oauth2.googleapis.com necesitaría mandar el secreto en JS, visible
// para cualquiera). Mismo Client ID que usa public/agenda/calendario.js.
const GOOGLE_CLIENT_ID = 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

// Dos casos, según qué mande el navegador:
//  - `code` + `redirectUri`: primera conexión — recién autorizada por la
//    persona en el popup de Google (ver conectarCalendar() en
//    calendario.js). Devuelve un access_token (dura ~1h) Y un
//    refresh_token (no expira solo) — el refresh_token se guarda en
//    Firestore del lado del navegador, este Worker no lo persiste.
//  - `refreshToken`: renovación — el navegador ya tiene un refresh_token
//    guardado (de una conexión anterior) y solo necesita un access_token
//    nuevo porque el que tenía venció. No pide consentimiento de nuevo,
//    no abre ningún popup — pasa transparente para quien usa AgendaApp.
async function intercambiarTokenGoogle(env, { code, redirectUri, refreshToken }) {
    if (!env.GOOGLE_CLIENT_SECRET) {
        throw new Error('Falta configurar el secreto GOOGLE_CLIENT_SECRET (ver README.md de esta carpeta).');
    }

    const parametros = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
    });
    if (refreshToken) {
        parametros.set('refresh_token', refreshToken);
        parametros.set('grant_type', 'refresh_token');
    } else if (code && redirectUri) {
        parametros.set('code', code);
        parametros.set('redirect_uri', redirectUri); // tiene que ser IDÉNTICO al que se usó para pedir el código
        parametros.set('grant_type', 'authorization_code');
    } else {
        throw new Error('Falta code+redirectUri, o refreshToken.');
    }

    const respuesta = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: parametros.toString(),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) {
        // Google manda un JSON de verdad ante un error (a diferencia de
        // Steam) — se reenvía su propio mensaje, ya viene claro.
        throw new Error(datos.error_description || datos.error || `Google respondió ${respuesta.status}`);
    }
    // { access_token, refresh_token (solo en el caso de "code"), expires_in, scope, token_type }
    return datos;
}

// --- /noticias — titulares del día (GNews + NewsData, Argentina) ---
//
// Se combinan DOS proveedores (a pedido de Roy, "para ofrecer lo mejor")
// en vez de uno solo — GNews (https://gnews.io) y NewsData
// (https://newsdata.io), ambas pensadas para consumirse desde un backend
// como este (a diferencia del RSS de un medio, que varios ya bloquean si
// detectan que el pedido viene de Cloudflare — ver el comentario grande
// del principio del archivo). De paso, dos proveedores dan cierta
// redundancia gratis: si uno falla o está caído, igual se muestran los
// resultados del otro en vez de nada.
//
// Cada plan free es por DÍA en total (no por persona que entra a
// ComfyApp) — por eso el cache de acá abajo: como mucho se le pide un
// titular nuevo a cada API una vez cada 30 minutos POR combinación de
// tema/categoría, sin importar cuánta gente esté mirando ComfyApp
// mientras tanto.
//
// `query`: búsqueda libre por palabra clave (ej. "Boca", "Dólar").
// `categoria`: una de CATEGORIAS_COMPARTIDAS de abajo — los "temas
// sugeridos" que ofrece ComfyApp para no tener que escribir nada. Si se
// pasan los dos, `query` gana (categoria se ignora).
const CATEGORIAS_COMPARTIDAS = {
    general: { gnews: 'general', newsdata: 'top' },
    deportes: { gnews: 'sports', newsdata: 'sports' },
    tecnologia: { gnews: 'technology', newsdata: 'technology' },
    economia: { gnews: 'business', newsdata: 'business' },
    entretenimiento: { gnews: 'entertainment', newsdata: 'entertainment' },
    salud: { gnews: 'health', newsdata: 'health' },
    ciencia: { gnews: 'science', newsdata: 'science' },
};

// Nunca tira error — si GNews falla (sin key, caído, lo que sea), se
// devuelve una lista vacía y NewsData sigue aportando lo suyo igual (y
// viceversa, ver obtenerDeNewsData). Así un solo proveedor caído no tira
// abajo toda la card de noticias.
async function obtenerDeGNews(env, query, categoria) {
    if (!env.GNEWS_API_KEY) return [];
    try {
        const url = query
            ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=es&country=ar&max=8&apikey=${env.GNEWS_API_KEY}`
            : `https://gnews.io/api/v4/top-headlines?category=${CATEGORIAS_COMPARTIDAS[categoria]?.gnews || 'general'}&lang=es&country=ar&max=8&apikey=${env.GNEWS_API_KEY}`;
        const respuesta = await fetch(url);
        if (!respuesta.ok) return [];
        const datos = await respuesta.json();
        return (datos.articles || [])
            .filter(a => a.title && a.url && a.url.startsWith('https://'))
            .map(a => ({ titulo: a.title, link: a.url, fecha: a.publishedAt || null, fuente: a.source?.name || null }));
    } catch {
        return [];
    }
}

async function obtenerDeNewsData(env, query, categoria) {
    if (!env.NEWSDATA_API_KEY) return [];
    try {
        const parametros = new URLSearchParams({ apikey: env.NEWSDATA_API_KEY, country: 'ar', language: 'es' });
        if (query) parametros.set('q', query);
        else parametros.set('category', CATEGORIAS_COMPARTIDAS[categoria]?.newsdata || 'top');
        const respuesta = await fetch(`https://newsdata.io/api/1/latest?${parametros}`);
        if (!respuesta.ok) return [];
        const datos = await respuesta.json();
        return (datos.results || [])
            .filter(a => a.title && a.link && a.link.startsWith('https://'))
            .map(a => ({
                titulo: a.title,
                link: a.link,
                // NewsData manda la fecha como "2026-08-23 14:43:32" (UTC,
                // sin indicarlo en el string) — se arma un ISO 8601 real
                // para que new Date(...) del lado de ComfyApp la entienda
                // igual que las de GNews.
                fecha: a.pubDate ? a.pubDate.replace(' ', 'T') + 'Z' : null,
                fuente: a.source_name || null,
            }));
    } catch {
        return [];
    }
}

async function obtenerNoticias(env, query, categoria) {
    // El Cache API de Workers (gratis, sin binding/config extra) guarda
    // la respuesta ya combinada — una entrada por tema/categoría,
    // compartida entre TODOS los que pidan lo mismo mientras dure el
    // cache, en vez de una por persona/origen.
    const cache = caches.default;
    const claveTexto = query ? `q:${query.toLowerCase()}` : `cat:${categoria || 'general'}`;
    const claveCache = new Request(`https://cache-interno.invalid/noticias?${encodeURIComponent(claveTexto)}`);
    const enCache = await cache.match(claveCache);
    if (enCache) return await enCache.json();

    const [deGNews, deNewsData] = await Promise.all([
        obtenerDeGNews(env, query, categoria),
        obtenerDeNewsData(env, query, categoria),
    ]);

    // Se intercalan (una de cada fuente, alternando) en vez de pegar
    // todo GNews primero y todo NewsData después — así se ve realmente
    // una mezcla de las dos, no una lista con la segunda fuente relegada
    // al final.
    const mezcladas = [];
    const masLarga = Math.max(deGNews.length, deNewsData.length);
    for (let i = 0; i < masLarga; i++) {
        if (deGNews[i]) mezcladas.push(deGNews[i]);
        if (deNewsData[i]) mezcladas.push(deNewsData[i]);
    }

    // Puede pasar que las dos fuentes traigan la misma nota (una agencia
    // compartida, por ejemplo) — se descartan duplicados comparando el
    // título normalizado, quedándose con la primera aparición.
    const vistos = new Set();
    const noticias = [];
    for (const noticia of mezcladas) {
        const clave = noticia.titulo.trim().toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        noticias.push(noticia);
        if (noticias.length >= 10) break; // un poco más que antes (8) — ahora hay dos fuentes de sobra
    }

    await cache.put(claveCache, new Response(JSON.stringify(noticias), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1800' }, // 30 min
    }));
    return noticias;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const cors = headersCors(origin);

        try {
            // Preflight de CORS — el navegador lo manda solo antes del
            // GET real, no hace falta que GamingApp haga nada especial.
            if (request.method === 'OPTIONS') {
                return new Response(null, { headers: cors });
            }

            const url = new URL(request.url);

            // /calendar-token — la única ruta POST de todo este Worker
            // (todas las demás son GET con parámetros en la URL, ver más
            // abajo) — manda el código/refresh_token en el body porque
            // pueden ser largos y no tiene sentido exponerlos en una URL
            // que puede quedar guardada en logs.
            if (url.pathname === '/calendar-token') {
                if (request.method !== 'POST') {
                    return json({ error: 'Método no soportado.' }, 405, cors);
                }
                const cuerpo = await request.json().catch(() => ({}));
                const tokens = await intercambiarTokenGoogle(env, {
                    code: cuerpo.code,
                    redirectUri: cuerpo.redirectUri,
                    refreshToken: cuerpo.refreshToken,
                });
                return json(tokens, 200, cors);
            }

            if (request.method !== 'GET') {
                return json({ error: 'Método no soportado.' }, 405, cors);
            }

            // /openid-verify — el paso de atrás de "Iniciar sesión con
            // Steam" (ver gaming/index.html): Steam redirige de vuelta
            // con un montón de parámetros openid.* después de que la
            // persona se loguea ahí (con usuario/contraseña, o
            // escaneando el QR que Steam mismo ofrece con la app del
            // celular — ese QR es 100% de Steam, acá no se genera ni se
            // maneja nada de eso). Esos parámetros hay que
            // CONFIRMARLOS con Steam antes de creerles (si no,
            // cualquiera podría armar una URL de vuelta a mano y
            // "probar" ser el dueño de cualquier cuenta) — eso es lo
            // que hace este endpoint: reenvía los mismos parámetros con
            // openid.mode=check_authentication, que es un pedido
            // servidor-a-servidor (no necesita CORS, por eso puede
            // vivir acá aunque las otras rutas sean simples GET). No
            // usa la Steam API key para nada, OpenID es un mecanismo
            // aparte.
            if (url.pathname === '/openid-verify') {
                const parametrosVerificacion = new URLSearchParams(url.search);
                parametrosVerificacion.set('openid.mode', 'check_authentication');

                const respuestaSteam = await fetch('https://steamcommunity.com/openid/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: parametrosVerificacion.toString(),
                });
                const texto = await respuestaSteam.text();
                const esValido = /is_valid\s*:\s*true/.test(texto);
                if (!esValido) return json({ valid: false }, 200, cors);

                // claimed_id viene como
                // "https://steamcommunity.com/openid/id/76561198xxxxxxxxx"
                // — los últimos 17 dígitos son el SteamID64.
                const claimedId = url.searchParams.get('openid.claimed_id') || '';
                const coincidencia = claimedId.match(/(\d{17})$/);
                return json({ valid: !!coincidencia, steamid: coincidencia ? coincidencia[1] : null }, 200, cors);
            }

            // /noticias?q=palabra o /noticias?categoria=deportes —
            // titulares del día (GNews + NewsData, Argentina), filtrados
            // por búsqueda libre o por una categoría sugerida. Sin
            // ninguno de los dos, trae los generales. Va antes que todo
            // lo de Steam de acá abajo porque no depende de steamid.
            if (url.pathname === '/noticias') {
                const query = (url.searchParams.get('q') || '').trim();
                const categoria = (url.searchParams.get('categoria') || '').trim();
                return json({ noticias: await obtenerNoticias(env, query || null, categoria || null) }, 200, cors);
            }

            // --- Riot (League of Legends/TFT) — Tracker de GamingApp ---
            //
            // /riot-account?gameName=X&tagLine=Y&region=americas — primer
            // paso siempre: resuelve un Riot ID ("Nombre#TAG") al puuid
            // que piden el resto de los endpoints. `region` es el ruteo
            // REGIONAL (americas/europe/asia/sea, ver la lista de arriba).
            if (url.pathname === '/riot-account') {
                const gameName = url.searchParams.get('gameName');
                const tagLine = url.searchParams.get('tagLine');
                const region = url.searchParams.get('region');
                if (!gameName || !tagLine) return json({ error: 'Faltan gameName/tagLine.' }, 400, cors);
                if (!REGIONES_RIOT.has(region)) return json({ error: 'region inválida.' }, 400, cors);
                const riotUrl = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
                return await reenviarDeRiot(riotUrl, env, cors);
            }

            // /riot-league?puuid=X&platform=la2 — rango actual de Solo/Duo
            // en League of Legends. `platform` es el ruteo de SERVIDOR
            // (la2, na1, euw1...), no el regional.
            if (url.pathname === '/riot-league') {
                const puuid = url.searchParams.get('puuid');
                const platform = url.searchParams.get('platform');
                if (!puuid) return json({ error: 'Falta puuid.' }, 400, cors);
                if (!PLATAFORMAS_RIOT.has(platform)) return json({ error: 'platform inválida.' }, 400, cors);
                const riotUrl = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
                return await reenviarDeRiot(riotUrl, env, cors);
            }

            // /tft-league?puuid=X&platform=la2 — mismo que /riot-league,
            // pero el rango de TFT.
            if (url.pathname === '/tft-league') {
                const puuid = url.searchParams.get('puuid');
                const platform = url.searchParams.get('platform');
                if (!puuid) return json({ error: 'Falta puuid.' }, 400, cors);
                if (!PLATAFORMAS_RIOT.has(platform)) return json({ error: 'platform inválida.' }, 400, cors);
                const riotUrl = `https://${platform}.api.riotgames.com/tft/league/v1/entries/by-puuid/${encodeURIComponent(puuid)}`;
                return await reenviarDeRiot(riotUrl, env, cors);
            }

            // /riot-matches?puuid=X&region=americas&count=10 — a
            // diferencia de las de arriba, esta hace DOS pasos contra
            // Riot (lista de ids de las últimas partidas, y después el
            // detalle de cada una) y los combina en una sola respuesta —
            // así el navegador hace un solo pedido en vez de 1+N, y todo
            // el ida y vuelta con Riot pasa por la red rápida de
            // Cloudflare en vez de la conexión de quien esté mirando el
            // Tracker.
            if (url.pathname === '/riot-matches' || url.pathname === '/tft-matches') {
                const esTft = url.pathname === '/tft-matches';
                const puuid = url.searchParams.get('puuid');
                const region = url.searchParams.get('region');
                // Tope duro en 15 sin importar lo que pida el navegador —
                // ni hace falta más para "últimas partidas", y evita que
                // un pedido mal armado dispare 100 fetches en cascada.
                const count = Math.min(Math.max(parseInt(url.searchParams.get('count'), 10) || 10, 1), 15);
                if (!puuid) return json({ error: 'Falta puuid.' }, 400, cors);
                if (!REGIONES_RIOT.has(region)) return json({ error: 'region inválida.' }, 400, cors);
                if (!env.RIOT_API_KEY) {
                    return json({ error: 'Falta configurar el secreto RIOT_API_KEY (ver README.md).' }, 500, cors);
                }

                const base = esTft
                    ? `https://${region}.api.riotgames.com/tft/match/v1/matches`
                    : `https://${region}.api.riotgames.com/lol/match/v5/matches`;
                const cabeceras = { headers: { 'X-Riot-Token': env.RIOT_API_KEY } };

                const respuestaIds = await fetch(`${base}/by-puuid/${encodeURIComponent(puuid)}/ids?count=${count}`, cabeceras);
                if (!respuestaIds.ok) {
                    if (respuestaIds.status === 404) return json({ partidas: [] }, 200, cors);
                    return json({ error: `Riot respondió ${respuestaIds.status} al pedir la lista de partidas.` }, 502, cors);
                }
                const ids = await respuestaIds.json().catch(() => []);

                // Si UNA partida puntual falla (Riot devuelve un error
                // raro para ese id, un 429 justo en esa vuelta...) se
                // descarta esa sola en vez de tirar abajo la respuesta
                // entera — GamingApp recibe una lista más corta de lo
                // pedido en vez de un error, que para "últimas partidas"
                // es preferible.
                const partidas = await Promise.all(ids.map(async (id) => {
                    const r = await fetch(`${base}/${encodeURIComponent(id)}`, cabeceras);
                    if (!r.ok) return null;
                    return await r.json().catch(() => null);
                }));
                return json({ partidas: partidas.filter(Boolean) }, 200, cors);
            }

            // /resolve?vanity=nombreDePerfil — para quien no sabe su
            // SteamID64 de memoria (nadie lo sabe), solo su URL de
            // perfil (steamcommunity.com/id/ESTO). Con el login de
            // arriba ya no hace falta para el flujo principal, pero se
            // deja como alternativa para quien prefiera no pasar por el
            // login de Steam y solo mirar un perfil público por nombre.
            if (url.pathname === '/resolve') {
                const vanity = url.searchParams.get('vanity');
                if (!vanity) return json({ error: 'Falta el parámetro vanity.' }, 400, cors);
                const steamUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanity)}&format=json`;
                return await reenviarDeSteam(steamUrl, cors);
            }

            const steamid = url.searchParams.get('steamid');
            if (!steamid || !ES_STEAMID64.test(steamid)) {
                return json({ error: 'Falta o es inválido el parámetro steamid (tienen que ser 17 dígitos — si tenés la URL con nombre, usá /resolve primero).' }, 400, cors);
            }

            let steamUrl;
            if (url.pathname === '/owned-games') {
                steamUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_API_KEY}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1&format=json`;
            } else if (url.pathname === '/profile') {
                steamUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${steamid}&format=json`;
            } else {
                return json({ error: 'Ruta no reconocida. Usá /noticias, /resolve, /profile, /owned-games, /riot-account, /riot-league, /riot-matches, /tft-league o /tft-matches.' }, 404, cors);
            }

            return await reenviarDeSteam(steamUrl, cors);
        } catch (error) {
            // Red de seguridad final: cualquier excepción no prevista
            // (Steam no responde, un bug nuevo, lo que sea) sale como
            // JSON con estos mismos headers CORS — nunca como la
            // paginita de error de Cloudflare (HTML), que es lo que
            // rompía el .json() del lado de GamingApp.
            return json({ error: 'Error inesperado en el proxy: ' + error.message }, 500, cors);
        }
    },
};
