// Service worker mínimo — solo para que la PWA sea instalable (Chrome/
// Android exigen uno con un manejador de "fetch" para ofrecer "Agregar a
// la pantalla de inicio") y para que las páginas/estilos/scripts propios
// carguen más rápido en visitas siguientes.
//
// A propósito NO intenta un "modo offline" de verdad: esta app depende
// de estar online para todo lo que importa (gastos, grupos, login, todo
// vive en Firestore/Firebase Auth) — prometer que funciona sin conexión
// sería mentira. Lo único que cachea es el "shell" (el HTML/CSS/JS de la
// app en sí, no los datos), y ni se acerca a Firebase ni a ningún CDN
// externo (Shoelace, Chart.js, etc.) — esos siguen pidiéndose a la red
// siempre, tal cual como si no hubiera service worker.
const CACHE = 'gastosapp-shell-v1';

// Mejora agregada 2026-08-25 (detectada al revisar AgendaApp): esta
// lista solo tenía los archivos de GastosApp — ComfyApp/
// GamingApp/AgendaApp quedaban afuera. No era un bug (una vez que se
// visita una página online, igual queda cacheada para la próxima vez sin
// conexión — ver el "fetch" más abajo, que cachea CUALQUIER pedido
// exitoso, no solo los de esta lista) — solo afectaba la primerísima
// visita SIN conexión a esas apps, antes de haberlas abierto nunca
// online. Se suman acá para que las 4 apps del mega sistema arranquen
// igual de bien "en frío".
const ARCHIVOS_DEL_SHELL = [
    // GastosApp
    'index.html', 'payments.html', 'division-de-gastos.html', 'estadisticas.html', 'cuenta.html',
    'styles/main.css',
    'nav.js', 'auth.js', 'tema.js', 'ui.js', 'emoji.js', 'analitica.js', 'asistente.js',
    'notificaciones.js', 'movimientos.js', 'exportar.js', 'imagen.js',
    'grupos.js', 'expenses.js', 'storage.js', 'finanzas.js', 'perfil.js', 'categorias.js', 'eliminarCuenta.js',
    'graficos.js', 'firebase-config.js', 'monedas.js', 'recurrentes.js', 'mensajes.js',
    'alquiler.js', 'filtroAvanzado.js', 'miniCarrusel.js',
    'manifest.json', 'icon.svg',
    // ComfyApp — punto de entrada del mega sistema
    'sistema.html', 'clima.js',
    // GamingApp
    'gaming/index.html', 'gaming/torneos.html', 'gaming/conexiones.html', 'gaming/estadisticas.html', 'gaming/tracker.html',
    'gaming/nav-gaming.js', 'gaming/torneos.js', 'gaming/riot.js', 'gaming/metaCurada.js', 'gaming/campeonesLoL.js',
    // AgendaApp (callback.html no — es un popup invisible, no hace
    // falta que cargue rápido ni que ande offline)
    'agenda/index.html', 'agenda/nav-agenda.js', 'agenda/calendario.js',
    // TareasApp
    'tareas/index.html', 'tareas/grupo.html', 'tareas/nav-tareas.js', 'tareas/tareas.js',
    'notificacionesCentro.js',
];

self.addEventListener('install', (evento) => {
    evento.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(ARCHIVOS_DEL_SHELL))
            // Si un solo archivo de la lista fallara (typo, archivo movido),
            // que no tumbe la instalación del service worker entero — mejor
            // una PWA sin todo pre-cacheado que ninguna PWA instalable.
            .catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil(
        caches.keys().then(nombres => Promise.all(
            nombres.filter(nombre => nombre !== CACHE).map(nombre => caches.delete(nombre))
        ))
    );
    self.clients.claim();
});

// Red primero: así nunca se ve una versión vieja del código sin querer
// (importa mucho acá — ya nos pasó una vez con caché del navegador). Si
// no hay conexión, recién ahí se usa lo que haya guardado.
self.addEventListener('fetch', (evento) => {
    if (evento.request.method !== 'GET') return;

    const url = new URL(evento.request.url);
    if (url.origin !== self.location.origin) return; // no tocar CDNs externos

    evento.respondWith(
        fetch(evento.request)
            .then(respuesta => {
                const copia = respuesta.clone();
                caches.open(CACHE).then(cache => cache.put(evento.request, copia));
                return respuesta;
            })
            // ignoreSearch: true para que variantes con query string (p. ej.
            // cuenta.html?app=agenda, el "Opciones" general abierto desde
            // otra app) puedan caer al mismo cuenta.html cacheado del shell
            // aunque esa combinación puntual nunca se haya visitado offline.
            .catch(() => caches.match(evento.request, { ignoreSearch: true }))
    );
});
