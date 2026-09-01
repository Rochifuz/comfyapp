// Navbar + desplegable (☰) de TareasApp — mismo patrón que
// gaming/nav-gaming.js/agenda/nav-agenda.js (independiente de nav.js de
// GastosApp: comparte login y sistema de diseño, no datos). Sin
// SECCIONES/bottom-nav (como AgendaApp Fase 1): por ahora es "Mis
// tareas" (index.html) más la página de detalle de un grupo puntual
// (grupo.html, a la que se llega desde ahí, no desde el menú) — no hay
// más de una sección real todavía.

import { auth } from '../firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { iniciarCampanita } from '../notificacionesCentro.js';
import { obtenerAppsPermitidas, tienePermiso } from '../permisos.js';

// Tema propio de TareasApp ("mostaza", ver main.css) — clave de
// localStorage APARTE de la que comparten GastosApp/GamingApp ("tema"),
// de la de ComfyApp ("tema-comfy") y de la de AgendaApp ("tema-agenda").
// Por eso NO se importa tema.js acá — esta app tiene su propio par de
// funciones, mismo patrón que nav-agenda.js pero apuntando a "tareas"/
// "tareas-oscura" en vez de "agenda"/"agenda-oscura".
const CLAVE_TEMA_TAREAS = 'tema-tareas';

// Exportadas para que cuenta.html (el "Opciones" general del mega
// sistema, ver el comentario grande ahí) pueda mostrar/tocar el tema de
// TareasApp cuando se abre con ?app=tareas.
export function obtenerTemaTareas() {
    return localStorage.getItem(CLAVE_TEMA_TAREAS) || 'claro';
}

export function aplicarTemaTareas(tema) {
    document.documentElement.setAttribute('data-tema', tema === 'oscuro' ? 'tareas-oscura' : 'tareas');
    // A diferencia de ComfyApp, acá SÍ se sincroniza sl-theme-dark — ver
    // el comentario del <head> de index.html.
    document.documentElement.classList.toggle('sl-theme-dark', tema === 'oscuro');
    localStorage.setItem(CLAVE_TEMA_TAREAS, tema);
}

export function iniciarNavbarTareas() {
    const contenedor = document.getElementById('navbar-placeholder');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <a class="navbar-brand" href="index.html">🗒️ TareasApp</a>
        <ul class="navbar-links" id="navbar-links"></ul>
        <div class="navbar-auth">
            <span id="auth-placeholder"></span>
            <span id="campanita-placeholder"></span>
            <!-- Atajo para volver a ComfyApp sin abrir el desplegable —
                 mismo pedido de Roy que en nav.js/nav-gaming.js/nav-agenda.js. -->
            <a class="boton-navbar-icono" href="../sistema.html" title="Volver a ComfyApp" aria-label="Volver a ComfyApp">🛋️</a>
            <button type="button" id="boton-menu" class="boton-navbar-icono" title="Menú" aria-label="Abrir menú">☰</button>
        </div>
        <sl-drawer id="drawer-menu" label="Menú" placement="end" class="drawer-menu">
            <div class="drawer-item">
                <span>🌙 Tema oscuro</span>
                <sl-switch id="drawer-switch-tema" ${obtenerTemaTareas() === 'oscuro' ? 'checked' : ''}></sl-switch>
            </div>
            <div class="drawer-separador"></div>
            <p class="texto-muted" style="font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; margin: 0 0 var(--space-1);">Otras apps</p>
            <nav class="drawer-nav">
                <a href="../sistema.html" class="drawer-link">🛋️ ComfyApp</a>
                <a href="../index.html" class="drawer-link">💸 GastosApp</a>
                <a href="../gaming/index.html" class="drawer-link">🎮 GamingApp</a>
                <a href="../agenda/index.html" class="drawer-link">🗓️ AgendaApp</a>
            </nav>
            <div class="drawer-separador"></div>
            <!-- "Opciones" general del mega sistema (perfil, seguridad,
                 eliminar cuenta...) — ?app=tareas es lo que hace que se
                 abra con el tema de TareasApp y muestre las
                 notificaciones de esta app. Ver el comentario grande en
                 cuenta.html. -->
            <a href="../cuenta.html?app=tareas" class="drawer-link">⚙ Opciones</a>
            <button type="button" class="drawer-link peligro" id="boton-logout-tareas">⏻ Cerrar sesión</button>
        </sl-drawer>
    `;

    const drawer = document.getElementById('drawer-menu');
    document.getElementById('boton-menu').addEventListener('click', () => {
        drawer.open = true;
    });

    // Sin listener de "tema-cambiado" acá (a diferencia de nav.js/
    // nav-gaming.js) — ese evento lo dispara tema.js, el módulo
    // COMPARTIDO que esta app ya no usa; como este switch es el único
    // control de tema de toda TareasApp, no hay ningún otro lugar con el
    // que mantenerlo sincronizado.
    document.getElementById('drawer-switch-tema').addEventListener('sl-change', (evento) => {
        aplicarTemaTareas(evento.target.checked ? 'oscuro' : 'claro');
    });

    document.getElementById('boton-logout-tareas').addEventListener('click', () => signOut(auth));

    iniciarCampanita('campanita-placeholder');
    registrarServiceWorker();
}

// Mismo service worker que el resto del mega sistema (ver el comentario
// equivalente en gaming/nav-gaming.js).
function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('../sw.js').catch(() => {});
}

// Sin sesión, manda a sistema.html (el punto de entrada del mega
// sistema) con "volver" para no perder el camino de vuelta a TareasApp.
// Además (2026-08-30), si la cuenta no tiene el permiso de TareasApp
// habilitado (ver permisos.js), rebota igual, con "sinPermiso" en vez
// de "volver" para que sistema.html muestre un aviso en vez de un loop.
export function requerirSesionTareas(paginaActual, callback) {
    return onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = `../sistema.html?volver=${encodeURIComponent(`tareas/${paginaActual}`)}`;
            return;
        }
        const appsPermitidas = await obtenerAppsPermitidas(user.uid);
        if (!tienePermiso(appsPermitidas, 'tareas')) {
            window.location.href = '../sistema.html?sinPermiso=tareas';
            return;
        }
        callback(user);
    });
}
