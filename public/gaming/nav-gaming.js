// Navbar + desplegable (☰) + barra inferior de GamingApp — mismo look que
// nav.js de GastosApp (reutiliza las mismas clases de main.css: .navbar,
// .drawer-menu, .bottom-nav) pero es su PROPIO módulo, separado de nav.js.
// GamingApp es independiente de GastosApp (no comparte datos, solo el
// login y el sistema de diseño) — por eso no reutiliza nav.js tal cual,
// para no atarse a nada específico de GastosApp (Gastón, su analítica,
// sus 4 secciones fijas). También centraliza acá el "requiere sesión"
// que antes cada página de GamingApp repetía a mano.

import { auth } from '../firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { obtenerTema, aplicarTema } from '../tema.js';
import { iniciarCampanita } from '../notificacionesCentro.js';
import { obtenerPreferenciaAvisoUnionTorneo, guardarPreferenciaAvisoUnionTorneo } from './torneos.js';
import { obtenerAppsPermitidas, tienePermiso } from '../permisos.js';

const SECCIONES = [
    { href: 'index.html', icono: '🏠', texto: 'Inicio', textoCorto: 'Inicio' },
    { href: 'torneos.html', icono: '🏆', texto: 'Torneos', textoCorto: 'Torneos' },
    { href: 'tracker.html', icono: '🎯', texto: 'Tracker', textoCorto: 'Tracker' },
    { href: 'conexiones.html', icono: '🔌', texto: 'Conexiones', textoCorto: 'Conex.' },
    { href: 'estadisticas.html', icono: '📊', texto: 'Más datos', textoCorto: 'Datos' },
];

export function iniciarNavbarGaming(paginaActual) {
    const contenedor = document.getElementById('navbar-placeholder');
    if (!contenedor) return;

    // "drawer-link" es la misma clase que usa nav.js para las secciones
    // de GastosApp en su propio ☰ (y la que ya usaba acá abajo la sección
    // "Otras apps") — sin ella estos 4 links quedaban como texto plano,
    // sin el padding/fondo redondeado al tocar ni la marca de "activo"
    // que sí tenían el resto de los botones del menú.
    const seccionesHtml = SECCIONES
        .map(s => `<a href="${s.href}" class="drawer-link ${s.href === paginaActual ? 'activo' : ''}">${s.icono} ${s.texto}</a>`);

    contenedor.innerHTML = `
        <a class="navbar-brand" href="index.html">🎮 GamingApp</a>
        <ul class="navbar-links" id="navbar-links">
            ${SECCIONES.map(s => `<li><a href="${s.href}" class="${s.href === paginaActual ? 'activo' : ''}">${s.icono} ${s.texto}</a></li>`).join('')}
        </ul>
        <div class="navbar-auth">
            <span id="auth-placeholder"></span>
            <span id="campanita-placeholder"></span>
            <!-- Atajo para volver a ComfyApp sin abrir el desplegable —
                 mismo criterio que en nav.js/nav-agenda.js. -->
            <a class="boton-navbar-icono" href="../sistema.html" title="Volver a ComfyApp" aria-label="Volver a ComfyApp">🛋️</a>
            <button type="button" id="boton-menu" class="boton-navbar-icono" title="Menú" aria-label="Abrir menú">☰</button>
        </div>
        <sl-drawer id="drawer-menu" label="Menú" placement="end" class="drawer-menu">
            <nav class="drawer-nav">${seccionesHtml.join('')}</nav>
            <div class="drawer-separador"></div>
            <div class="drawer-item">
                <span>🌙 Tema oscuro</span>
                <sl-switch id="drawer-switch-tema" ${obtenerTema() === 'oscuro' ? 'checked' : ''}></sl-switch>
            </div>
            <div class="drawer-item">
                <span>🏆 Avisarme si se unen a mis torneos</span>
                <sl-switch id="drawer-switch-aviso-union"></sl-switch>
            </div>
            <div class="drawer-separador"></div>
            <p class="texto-muted" style="font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; margin: 0 0 var(--space-1);">Otras apps</p>
            <nav class="drawer-nav">
                <a href="../sistema.html" class="drawer-link">🛋️ ComfyApp</a>
                <a href="../index.html" class="drawer-link">💸 GastosApp</a>
                <a href="../agenda/index.html" class="drawer-link">🗓️ AgendaApp</a>
                <a href="../tareas/index.html" class="drawer-link">🗒️ TareasApp</a>
            </nav>
            <div class="drawer-separador"></div>
            <!-- "Opciones" general del mega sistema (perfil, seguridad,
                 eliminar cuenta...) — ver el comentario grande en
                 cuenta.html. GamingApp comparte tema con GastosApp, así
                 que ?app=gaming no cambia el CSS, solo qué notificación
                 se muestra en la sección de Notificaciones. -->
            <a href="../cuenta.html?app=gaming" class="drawer-link">⚙ Opciones</a>
            <button type="button" class="drawer-link peligro" id="boton-logout-gaming">⏻ Cerrar sesión</button>
        </sl-drawer>
    `;
    document.body.insertAdjacentHTML('beforeend', '<nav class="bottom-nav" id="bottom-nav"></nav>');
    document.getElementById('bottom-nav').innerHTML = SECCIONES.map(s => `
        <a href="${s.href}" class="${s.href === paginaActual ? 'activo' : ''}">
            <span class="bottom-nav-icono">${s.icono}</span>
            <span>${s.textoCorto}</span>
        </a>
    `).join('');

    const drawer = document.getElementById('drawer-menu');
    document.getElementById('boton-menu').addEventListener('click', () => {
        drawer.open = true;
    });

    const switchTema = document.getElementById('drawer-switch-tema');
    switchTema.addEventListener('sl-change', (evento) => {
        aplicarTema(evento.target.checked ? 'oscuro' : 'claro');
    });
    document.addEventListener('tema-cambiado', (evento) => {
        switchTema.checked = evento.detail.tema === 'oscuro';
    });

    document.getElementById('boton-logout-gaming').addEventListener('click', () => signOut(auth));

    // Este switch necesita el uid, y acá todavía no se sabe si ya hay
    // sesión resuelta (requerirSesionGaming es aparte, por página) —
    // usa su propio onAuthStateChanged, mismo criterio que
    // iniciarCampanita() en notificacionesCentro.js.
    const switchAvisoUnion = document.getElementById('drawer-switch-aviso-union');
    onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        switchAvisoUnion.checked = await obtenerPreferenciaAvisoUnionTorneo(user.uid);
    });
    switchAvisoUnion.addEventListener('sl-change', () => {
        if (!auth.currentUser) return;
        guardarPreferenciaAvisoUnionTorneo(auth.currentUser.uid, switchAvisoUnion.checked).catch(() => {});
    });

    iniciarCampanita('campanita-placeholder');
    registrarServiceWorker();
}

// Mismo service worker que GastosApp (sw.js, registrado con scope raíz
// "/") — antes solo se registraba desde nav.js, así que quien entraba
// directo a una página de GamingApp sin haber pasado nunca por GastosApp
// se quedaba sin el cacheo del shell ni la app "instalable" hasta su
// primera visita a GastosApp. Registrarlo también acá lo deja
// consistente sin importar por dónde se entre primero.
function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('../sw.js').catch(() => {});
}

// GamingApp es de cualquier usuario logueado (ya no admin-only) — sin
// sesión, manda a sistema.html (el punto de entrada del mega sistema)
// con "volver" para no perder el camino de vuelta a esta misma página.
// Además (2026-08-30), si SÍ hay sesión pero la cuenta no tiene el
// permiso de GamingApp habilitado (ver permisos.js), rebota igual —
// con "sinPermiso" en vez de "volver", para que sistema.html muestre
// un aviso en vez de intentar volver a mandarla para acá en loop.
export function requerirSesionGaming(paginaActual, callback) {
    return onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = `../sistema.html?volver=${encodeURIComponent(`gaming/${paginaActual}`)}`;
            return;
        }
        const appsPermitidas = await obtenerAppsPermitidas(user.uid);
        if (!tienePermiso(appsPermitidas, 'gaming')) {
            window.location.href = '../sistema.html?sinPermiso=gaming';
            return;
        }
        callback(user);
    });
}
