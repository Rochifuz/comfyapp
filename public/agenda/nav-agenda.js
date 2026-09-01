// Navbar + desplegable (☰) de AgendaApp — mismo patrón que
// gaming/nav-gaming.js (independiente de nav.js de GastosApp: comparte
// login y sistema de diseño, no datos ni analítica). Fase 1 es una sola
// pantalla (Inicio, con el calendario mensual), así que no hay
// SECCIONES/bottom-nav todavía — se suman cuando haya más de una página
// real (Fase 2: filtros/varios calendarios podría ganar una pantalla
// aparte).

import { auth } from '../firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { desconectarCalendar } from './calendario.js';
import { iniciarCampanita } from '../notificacionesCentro.js';
import { obtenerAppsPermitidas, tienePermiso } from '../permisos.js';

// Tema propio de AgendaApp ("terracota", ver main.css) — clave de
// localStorage APARTE de la que comparten GastosApp/GamingApp ("tema") o
// la que usa ComfyApp ("tema-comfy"). Por eso NO se importa tema.js acá
// (ese es el de GastosApp/GamingApp) — esta app tiene su propio par de
// funciones, mismo patrón que tema.js pero apuntando a "agenda"/
// "agenda-oscura" en vez de "oscuro"/"claro" a secas.
const CLAVE_TEMA_AGENDA = 'tema-agenda';

// Exportadas (antes no hacía falta) para que cuenta.html — el "Opciones"
// general del mega sistema, ver el comentario grande ahí — pueda
// mostrar/tocar el tema de AgendaApp cuando se abre con ?app=agenda.
export function obtenerTemaAgenda() {
    return localStorage.getItem(CLAVE_TEMA_AGENDA) || 'claro';
}

export function aplicarTemaAgenda(tema) {
    document.documentElement.setAttribute('data-tema', tema === 'oscuro' ? 'agenda-oscura' : 'agenda');
    // A diferencia de ComfyApp, acá SÍ se sincroniza sl-theme-dark — ver
    // el comentario del <head> de index.html.
    document.documentElement.classList.toggle('sl-theme-dark', tema === 'oscuro');
    localStorage.setItem(CLAVE_TEMA_AGENDA, tema);
}

// --- Preferencia de "avisar eventos por comenzar" ---
//
// A diferencia de GastosApp/GamingApp/TareasApp (que guardan esto en
// Firestore), acá alcanza con localStorage — AgendaApp a propósito no
// tiene Firestore como fuente de verdad de nada relacionado a eventos
// (ver el comentario grande de calendario.js), y esta preferencia la
// consulta el propio navegador que la generó (avisarEventosPorComenzar
// en index.html), nunca otro usuario. Exportadas para que index.html
// las use al revisar qué eventos avisar.
const CLAVE_AVISOS_ACTIVADOS = 'agenda-avisos-activados';
const CLAVE_AVISOS_MINUTOS = 'agenda-avisos-minutos';

export function avisosDeEventosActivados() {
    return localStorage.getItem(CLAVE_AVISOS_ACTIVADOS) !== 'no'; // default: activado
}

export function minutosAntesDeAviso() {
    return Number(localStorage.getItem(CLAVE_AVISOS_MINUTOS)) || 30;
}

export function guardarAvisosActivados(activado) {
    localStorage.setItem(CLAVE_AVISOS_ACTIVADOS, activado ? 'si' : 'no');
}

export function guardarMinutosAntesDeAviso(minutos) {
    localStorage.setItem(CLAVE_AVISOS_MINUTOS, String(minutos));
}

export function iniciarNavbarAgenda() {
    const contenedor = document.getElementById('navbar-placeholder');
    if (!contenedor) return;

    contenedor.innerHTML = `
        <a class="navbar-brand" href="index.html">🗓️ AgendaApp</a>
        <ul class="navbar-links" id="navbar-links"></ul>
        <div class="navbar-auth">
            <span id="auth-placeholder"></span>
            <span id="campanita-placeholder"></span>
            <!-- Atajo para volver a ComfyApp sin abrir el desplegable —
                 mismo pedido de Roy que en nav.js/nav-gaming.js. -->
            <a class="boton-navbar-icono" href="../sistema.html" title="Volver a ComfyApp" aria-label="Volver a ComfyApp">🛋️</a>
            <button type="button" id="boton-menu" class="boton-navbar-icono" title="Menú" aria-label="Abrir menú">☰</button>
        </div>
        <sl-drawer id="drawer-menu" label="Menú" placement="end" class="drawer-menu">
            <div class="drawer-item">
                <span>🌙 Tema oscuro</span>
                <sl-switch id="drawer-switch-tema" ${obtenerTemaAgenda() === 'oscuro' ? 'checked' : ''}></sl-switch>
            </div>
            <div class="drawer-item">
                <span>🔔 Avisar eventos por comenzar</span>
                <sl-switch id="drawer-switch-avisos" ${avisosDeEventosActivados() ? 'checked' : ''}></sl-switch>
            </div>
            <div class="drawer-item" id="fila-avisos-minutos" style="${avisosDeEventosActivados() ? '' : 'display:none;'}">
                <span style="font-weight:400; font-size:.85rem; color:var(--color-text-muted);">¿Con cuánta anticipación?</span>
                <select id="select-avisos-minutos" style="width:auto;">
                    <option value="15" ${minutosAntesDeAviso() === 15 ? 'selected' : ''}>15 min</option>
                    <option value="30" ${minutosAntesDeAviso() === 30 ? 'selected' : ''}>30 min</option>
                    <option value="60" ${minutosAntesDeAviso() === 60 ? 'selected' : ''}>1 hora</option>
                    <option value="120" ${minutosAntesDeAviso() === 120 ? 'selected' : ''}>2 horas</option>
                </select>
            </div>
            <div class="drawer-separador"></div>
            <p class="texto-muted" style="font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; margin: 0 0 var(--space-1);">Otras apps</p>
            <nav class="drawer-nav">
                <a href="../sistema.html" class="drawer-link">🛋️ ComfyApp</a>
                <a href="../index.html" class="drawer-link">💸 GastosApp</a>
                <a href="../gaming/index.html" class="drawer-link">🎮 GamingApp</a>
                <a href="../tareas/index.html" class="drawer-link">🗒️ TareasApp</a>
            </nav>
            <div class="drawer-separador"></div>
            <!-- No hace falta esperar a saber si ya está conectado para
               mostrar esto (evitaría un ida y vuelta a Firestore antes
               de poder dibujar el desplegable) — si no había ninguna
               conexión guardada, desconectarCalendar() no rompe nada,
               simplemente no había nada que borrar. -->
            <button type="button" class="drawer-link" id="boton-desconectar-calendar">🔌 Desconectar Calendar</button>
            <div class="drawer-separador"></div>
            <!-- "Opciones" general del mega sistema (perfil, seguridad,
                 eliminar cuenta...) — ?app=agenda es lo que hace que se
                 abra con el tema de AgendaApp y muestre las
                 notificaciones de esta app. Ver el comentario grande en
                 cuenta.html. -->
            <a href="../cuenta.html?app=agenda" class="drawer-link">⚙ Opciones</a>
            <button type="button" class="drawer-link peligro" id="boton-logout-agenda">⏻ Cerrar sesión</button>
        </sl-drawer>
    `;

    const drawer = document.getElementById('drawer-menu');
    document.getElementById('boton-menu').addEventListener('click', () => {
        drawer.open = true;
    });

    // Sin listener de "tema-cambiado" acá (a diferencia de nav.js/
    // nav-gaming.js) — ese evento lo dispara tema.js, el módulo
    // COMPARTIDO que esta app ya no usa; como este switch es el único
    // control de tema de toda AgendaApp, no hay ningún otro lugar con el
    // que mantenerlo sincronizado.
    document.getElementById('drawer-switch-tema').addEventListener('sl-change', (evento) => {
        aplicarTemaAgenda(evento.target.checked ? 'oscuro' : 'claro');
    });

    const filaAvisosMinutos = document.getElementById('fila-avisos-minutos');
    document.getElementById('drawer-switch-avisos').addEventListener('sl-change', (evento) => {
        guardarAvisosActivados(evento.target.checked);
        filaAvisosMinutos.style.display = evento.target.checked ? 'flex' : 'none';
    });
    document.getElementById('select-avisos-minutos').addEventListener('change', (evento) => {
        guardarMinutosAntesDeAviso(evento.target.value);
    });

    document.getElementById('boton-desconectar-calendar').addEventListener('click', async () => {
        if (!confirm('¿Desconectar Google Calendar de AgendaApp? Vas a tener que volver a conectarlo para seguir usándola. Esto no borra ningún evento ni afecta tu cuenta de Google.')) return;
        await desconectarCalendar();
        window.location.reload(); // más simple que armar un segundo camino de "recargar el estado sin recargar la página" para algo tan poco frecuente
    });

    document.getElementById('boton-logout-agenda').addEventListener('click', () => signOut(auth));

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
// sistema) con "volver" para no perder el camino de vuelta a AgendaApp.
// Además (2026-08-30), si la cuenta no tiene el permiso de AgendaApp
// habilitado (ver permisos.js), rebota igual, con "sinPermiso" en vez
// de "volver" para que sistema.html muestre un aviso en vez de un loop.
export function requerirSesionAgenda(paginaActual, callback) {
    return onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = `../sistema.html?volver=${encodeURIComponent(`agenda/${paginaActual}`)}`;
            return;
        }
        const appsPermitidas = await obtenerAppsPermitidas(user.uid);
        if (!tienePermiso(appsPermitidas, 'agenda')) {
            window.location.href = '../sistema.html?sinPermiso=agenda';
            return;
        }
        callback(user);
    });
}
