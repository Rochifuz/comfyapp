// Barra de navegación superior + menú lateral, compartidos entre las
// páginas. En pantallas chicas (celular/tablet) la navegación entre
// secciones vive solo en el menú lateral (<sl-drawer>, de Shoelace) que
// se abre con el botón ☰; en pantallas grandes (PC) esas mismas 4
// secciones también se muestran como links horizontales en la navbar
// (ver el @media en main.css que los esconde por debajo de 900px), y el
// ☰ se mantiene siempre visible porque el menú también tiene Tema,
// Opciones y Cerrar sesión, no solo los links. Shoelace resuelve el
// overlay del drawer, la animación de deslizado, el cierre con Esc/clic
// afuera y el foco atrapado; acá solo se arma el contenido, que es HTML
// nuestro de siempre (ver los estilos .drawer-*/.navbar-links en main.css).
//
// De paso, iniciarNavbar() es el único lugar que se llama igual desde
// todas las páginas de la app — por eso también arrancan acá la
// traducción de emojis, la recolección de datos de uso y la burbuja de
// ayuda (ver emoji.js/analitica.js/asistente.js), en vez de tener que
// agregar el llamado a mano en cada página nueva que se cree.

import { obtenerTema, aplicarTema } from './tema.js';
import { iniciarEmojis } from './emoji.js';
import { iniciarAnalitica } from './analitica.js';
import { iniciarAsistente } from './asistente.js';
import { alCambiarSesion } from './auth.js';
import { iniciarCampanita } from './notificacionesCentro.js';

// `textoCorto` es solo para la barra inferior (celular) — con 4
// secciones en fila no entra "Gastos personales"/"Más datos" completo,
// así que ahí se usa una versión más corta; el menú lateral y la navbar
// de escritorio siguen mostrando el nombre completo de siempre.
const SECCIONES = [
    { href: 'index.html', icono: '🏠', texto: 'Inicio', textoCorto: 'Inicio' },
    { href: 'payments.html', icono: '🧾', texto: 'Gastos personales', textoCorto: 'Gastos' },
    { href: 'division-de-gastos.html', icono: '👥', texto: 'Grupos', textoCorto: 'Grupos' },
    { href: 'estadisticas.html', icono: '📊', texto: 'Más datos', textoCorto: 'Datos' },
];

// `opciones.ocultarSecciones`: para páginas que no son "de adentro" de
// GastosApp (por ahora, sistema.html — el inicio del mega sistema) pero
// igual quieren el mismo desplegable (Tema/Cerrar sesión) y la misma
// burbuja de Gastón que el resto de la app, sin mostrar los links a
// Gastos personales/Grupos/Más datos (que son secciones DE GastosApp, no
// del sistema en general).
export function iniciarNavbar(paginaActual, opciones = {}) {
    const contenedor = document.getElementById('navbar-placeholder');
    if (!contenedor) return;

    // `opciones.marca`: para páginas que no son GastosApp en sí (por
    // ahora, sistema.html — el inicio del mega sistema, "ComfyApp") y
    // necesitan otro nombre/emoji/link arriba a la izquierda en vez del
    // de GastosApp.
    const marca = opciones.marca || { href: 'index.html', texto: '💸 GastosApp' };

    // Atajo "🛋️" para volver a ComfyApp sin abrir el desplegable — para
    // no tener que ir hasta "Otras apps" del menú ☰ cada vez. No se
    // muestra en la propia sistema.html (ya estás ahí,
    // "volver a donde ya estás" no tendría sentido).
    const botonVolverHtml = paginaActual === 'sistema.html'
        ? ''
        : '<a class="boton-navbar-icono" href="sistema.html" title="Volver a ComfyApp" aria-label="Volver a ComfyApp">🛋️</a>';

    contenedor.innerHTML = `
        <a class="navbar-brand" href="${marca.href}">${marca.texto}</a>
        <ul class="navbar-links" id="navbar-links"></ul>
        <div class="navbar-auth">
            <span id="auth-placeholder"></span>
            <span id="campanita-placeholder"></span>
            ${botonVolverHtml}
            <button type="button" id="boton-menu" class="boton-navbar-icono" title="Menú" aria-label="Abrir menú">☰</button>
        </div>
        <sl-drawer id="drawer-menu" label="Menú" placement="end" class="drawer-menu">
            <nav class="drawer-nav" id="drawer-nav"></nav>
            <div class="drawer-separador"></div>
            <p class="texto-muted" style="font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; margin: 0 0 var(--space-1);">Otras apps</p>
            <nav class="drawer-nav">
                <a href="sistema.html" class="drawer-link ${paginaActual === 'sistema.html' ? 'activo' : ''}">🛋️ ComfyApp</a>
                <a href="gaming/index.html" class="drawer-link ${paginaActual === 'gaming/index.html' ? 'activo' : ''}">🎮 GamingApp</a>
                <a href="agenda/index.html" class="drawer-link ${paginaActual === 'agenda/index.html' ? 'activo' : ''}">🗓️ AgendaApp</a>
                <a href="tareas/index.html" class="drawer-link ${paginaActual === 'tareas/index.html' ? 'activo' : ''}">🗒️ TareasApp</a>
            </nav>
            <div class="drawer-separador"></div>
            ${opciones.ocultarSwitchTema ? '' : `
                <div class="drawer-item">
                    <span>🌙 Tema oscuro</span>
                    <sl-switch id="drawer-switch-tema" ${obtenerTema() === 'oscuro' ? 'checked' : ''}></sl-switch>
                </div>
                <div class="drawer-separador"></div>
            `}
            <div id="drawer-auth-placeholder"></div>
        </sl-drawer>
    `;
    document.body.insertAdjacentHTML('beforeend', '<nav class="bottom-nav" id="bottom-nav"></nav>');

    // Payments/Grupos/Más datos piden sesión (requerirSesion redirige a
    // Inicio si no hay) — mostrarlas como links antes de saber si hay
    // sesión era confuso: alguien sin loguearse las veía todas, las
    // tocaba, y terminaba rebotado a Inicio sin entender por qué. Ahora
    // el menú arranca mostrando solo Inicio, y recién se completa con el
    // resto apenas se confirma que hay sesión — Tema/Opciones/Cerrar
    // sesión (más abajo en el drawer) no dependen de esto, se quedan
    // igual que siempre.
    function renderSecciones(haySesion) {
        const secciones = opciones.ocultarSecciones
            ? []
            : (haySesion ? SECCIONES : SECCIONES.filter(s => s.href === 'index.html'));
        document.getElementById('navbar-links').innerHTML = secciones
            .map(s => `<li><a href="${s.href}" class="${s.href === paginaActual ? 'activo' : ''}">${s.icono} ${s.texto}</a></li>`)
            .join('');
        document.getElementById('drawer-nav').innerHTML = secciones
            .map(s => `<a href="${s.href}" class="drawer-link ${s.href === paginaActual ? 'activo' : ''}">${s.icono} ${s.texto}</a>`)
            .join('');
        // La barra inferior solo tiene sentido con más de una sección para
        // elegir — sin sesión (solo "Inicio") no se muestra, para no
        // ocupar una franja entera de pantalla mostrando un único botón.
        document.getElementById('bottom-nav').innerHTML = haySesion
            ? secciones.map(s => `
                <a href="${s.href}" class="${s.href === paginaActual ? 'activo' : ''}">
                    <span class="bottom-nav-icono">${s.icono}</span>
                    <span>${s.textoCorto}</span>
                </a>
            `).join('')
            : '';
    }
    renderSecciones(false);
    alCambiarSesion(user => renderSecciones(!!user));

    const drawer = document.getElementById('drawer-menu');
    // Se abre poniendo la propiedad "open" (no llamando a .show(), que es
    // un método del componente y todavía podría no existir si el navegador
    // no terminó de definir el custom element en ese instante exacto) —
    // así funciona sin importar si Shoelace ya cargó del todo o no.
    document.getElementById('boton-menu').addEventListener('click', () => {
        drawer.open = true;
    });

    // Sin switch (ver opciones.ocultarSwitchTema) no hay nada que
    // sincronizar — páginas con un tema fijo propio (ComfyApp, más abajo)
    // no deberían ni mostrar ni dejar tocar el oscuro/claro de GastosApp:
    // ese switch escribe en el mismo localStorage que comparten todas las
    // páginas, así que tocarlo desde acá cambiaría el tema del resto de
    // la app sin querer.
    const switchTema = document.getElementById('drawer-switch-tema');
    if (switchTema) {
        switchTema.addEventListener('sl-change', (evento) => {
            aplicarTema(evento.target.checked ? 'oscuro' : 'claro');
        });
        // Si el tema cambia desde otro lado (ej. los tabs de Cuenta >
        // Apariencia), este switch tiene que reflejarlo también — sin esto
        // quedaba desactualizado hasta recargar la página. Poner .checked acá
        // no dispara 'sl-change' de nuevo (Shoelace solo lo emite ante una
        // interacción real), así que no hay riesgo de loop.
        document.addEventListener('tema-cambiado', (evento) => {
            switchTema.checked = evento.detail.tema === 'oscuro';
        });
    }

    iniciarEmojis();
    iniciarAnalitica();
    iniciarAsistente({ ocultarSeccionesApp: opciones.ocultarSecciones });
    iniciarCampanita('campanita-placeholder');
    registrarServiceWorker();
}

// PWA: registra el service worker (ver sw.js) — lo que la hace
// "instalable" (Chrome/Android ofrecen agregarla a la pantalla de
// inicio) y cachea el shell de la app para que cargue más rápido en
// visitas siguientes. Si el navegador no lo soporta (Safari viejo, algún
// navegador de escritorio raro), simplemente no pasa nada — el resto de
// la app funciona igual, no depende de esto.
function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
