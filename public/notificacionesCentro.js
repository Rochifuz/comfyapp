// Centro de notificaciones — compartido por las 4 apps del mega sistema
// (se le agrega el ícono 🔔 a cada navbar llamando a iniciarCampanita()
// desde nav.js/gaming/nav-gaming.js/agenda/nav-agenda.js).
//
// A diferencia de notificaciones.js (avisos efímeros del navegador,
// GastosApp-only, que no quedan guardados en ningún lado), esto SÍ
// persiste en Firestore — usuarios/{uid}/notificaciones — así se ven
// aunque no hayas estado mirando ninguna app en el momento en que se
// generaron, con contador de no leídas y clic para ir directo a donde
// hay que resolver el tema.
//
// Limitación real, sin vueltas: sigue sin ser una notificación push de
// verdad — no llega con el celular bloqueado ni con todas las pestañas
// cerradas (eso necesitaría un servidor propio corriendo todo el tiempo,
// plan pago). Como no hay servidor, cada notificación se genera en el
// momento en que ALGUIEN hace, desde su propio navegador, la acción que
// la dispara (ver notificarA) — o la revisa uno mismo al entrar a alguna
// app (ver notificarme, para avisos que no dependen de nadie más).

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
    collection, addDoc, doc, updateDoc, query, orderBy, limit, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { esc } from './ui.js';

const MAX_NOTIFICACIONES = 30; // no hace falta traer/mostrar el historial entero, con las últimas alcanza

function coleccionDe(uid) {
    return collection(db, 'usuarios', uid, 'notificaciones');
}

// `destino` en las dos funciones de acá abajo tiene que ser una ruta
// ABSOLUTA desde la raíz del sitio (ej. "/division-de-gastos.html", con
// la barra adelante) — nunca relativa: la notificación se puede tocar
// desde el navbar de CUALQUIER app (GamingApp/AgendaApp viven en
// subcarpetas), así que "index.html" a secas navegaría mal si se toca
// desde /gaming/ o /agenda/.

// Le crea una notificación a OTRO usuario (ej. avisarle que le saldaste
// una deuda) — grupoId es obligatorio para este caso, lo exige
// firestore.rules para confirmar que de verdad son compañeros de un
// mismo grupo (si no, cualquiera podría mandarle notificaciones a
// cualquiera inventando un grupoId cualquiera).
export async function notificarA(uidDestino, { tipo, titulo, cuerpo, destino, grupoId }) {
    await addDoc(coleccionDe(uidDestino), {
        tipo, titulo, cuerpo, destino, grupoId,
        leida: false,
        creadaEn: serverTimestamp(),
    });
}

// Notificación para uno mismo (ej. "tu tarjeta cierra pronto", "tenés un
// evento por empezar") — no necesita grupoId, ya está cubierto por la
// regla de "el dueño puede escribir lo suyo" (ver firestore.rules).
export async function notificarme({ tipo, titulo, cuerpo, destino }) {
    if (!auth.currentUser) return;
    await addDoc(coleccionDe(auth.currentUser.uid), {
        tipo, titulo, cuerpo, destino,
        leida: false,
        creadaEn: serverTimestamp(),
    });
}

// Escucha en vivo las notificaciones propias (las más nuevas primero) —
// devuelve la función para dejar de escuchar, mismo patrón que el resto
// de los "escuchar..." de la app (ver expenses.js, grupos.js). Sin
// sesión, no escucha nada (devuelve un "dejar de escuchar" que no hace
// nada, para no obligar a quien llama a chequear el caso aparte).
export function escucharNotificaciones(callback) {
    if (!auth.currentUser) return () => {};
    const q = query(coleccionDe(auth.currentUser.uid), orderBy('creadaEn', 'desc'), limit(MAX_NOTIFICACIONES));
    return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

export function marcarComoLeida(notifId) {
    if (!auth.currentUser) return Promise.resolve();
    return updateDoc(doc(db, 'usuarios', auth.currentUser.uid, 'notificaciones', notifId), { leida: true });
}

// Hace cuánto fue, en criollo y corto ("ahora", "5m", "3h", "2d") — para
// no ocupar mucho lugar en la lista desplegable.
function haceCuanto(fecha) {
    if (!fecha) return '';
    const ms = Date.now() - fecha.toDate().getTime();
    const minutos = Math.floor(ms / 60000);
    if (minutos < 1) return 'ahora';
    if (minutos < 60) return `${minutos}m`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `${horas}h`;
    return `${Math.floor(horas / 24)}d`;
}

// Arma el ícono 🔔 + contador + panel desplegable dentro del contenedor
// indicado, y lo deja funcionando (abrir/cerrar, marcar leída al tocar
// una, ir al destino). Se llama una vez desde cada navbar — ver
// nav.js/gaming/nav-gaming.js/agenda/nav-agenda.js.
export function iniciarCampanita(idContenedor) {
    const contenedor = document.getElementById(idContenedor);
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div style="position:relative;">
            <button type="button" class="boton-navbar-icono" id="boton-campanita" title="Notificaciones" aria-label="Notificaciones" style="position:relative;">
                🔔
                <span id="campanita-contador" class="campanita-contador" style="display:none;"></span>
            </button>
            <div id="campanita-panel" class="campanita-panel" style="display:none;">
                <div class="campanita-panel-header">
                    <strong>Notificaciones</strong>
                    <button type="button" id="campanita-marcar-todas" class="secundario" style="width:auto; padding: 3px 8px; font-size:.72rem;">Marcar todas leídas</button>
                </div>
                <div id="campanita-lista"></div>
            </div>
        </div>
    `;

    const botonCampanita = document.getElementById('boton-campanita');
    const panel = document.getElementById('campanita-panel');
    const contador = document.getElementById('campanita-contador');
    const lista = document.getElementById('campanita-lista');
    let notificacionesActuales = [];

    function renderizarLista(notificaciones) {
        notificacionesActuales = notificaciones;
        const noLeidas = notificaciones.filter(n => !n.leida).length;
        contador.style.display = noLeidas > 0 ? 'flex' : 'none';
        contador.textContent = noLeidas > 9 ? '9+' : String(noLeidas);

        lista.innerHTML = notificaciones.length === 0
            ? '<p class="texto-muted" style="font-size:.85rem; padding: var(--space-3); text-align:center; margin:0;">No tenés notificaciones.</p>'
            : notificaciones.map(n => `
                <button type="button" class="campanita-item${n.leida ? '' : ' no-leida'}" data-id="${esc(n.id)}" data-destino="${esc(n.destino || '')}">
                    <span class="campanita-item-titulo">${esc(n.titulo)}</span>
                    <span class="campanita-item-cuerpo">${esc(n.cuerpo)}</span>
                    <span class="campanita-item-fecha">${haceCuanto(n.creadaEn)}</span>
                </button>
            `).join('');
    }

    botonCampanita.addEventListener('click', (evento) => {
        evento.stopPropagation(); // si no, el listener de "click afuera" de acá abajo lo cerraría en el mismo click que lo abre
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });

    // Cerrar al tocar afuera del panel — mismo criterio que cualquier
    // desplegable/menú (Shoelace lo resuelve solo para sl-drawer, pero
    // este panel es un <div> común, así que se maneja a mano).
    document.addEventListener('click', (evento) => {
        if (panel.style.display === 'block' && !panel.contains(evento.target) && evento.target !== botonCampanita) {
            panel.style.display = 'none';
        }
    });

    // BUG REAL encontrado y corregido: acá se disparaba marcarComoLeida()
    // (una escritura a Firestore) y, en la misma línea siguiente, se
    // navegaba a otra página — sin esperar a que la escritura terminara.
    // La navegación puede cortar en seco un pedido de red todavía en
    // vuelo, así que el "marcar como leída" a veces ni llegaba a
    // guardarse: la notificación quedaba con leida:false para siempre, y
    // volvía a aparecer resaltada cada vez que se abría la campanita de
    // nuevo, sin importar cuántas veces se tocara. Ahora se espera (await)
    // a que la escritura termine (o falle) ANTES de navegar.
    lista.addEventListener('click', async (evento) => {
        const item = evento.target.closest('.campanita-item');
        if (!item) return;
        await marcarComoLeida(item.dataset.id).catch(() => {});
        if (item.dataset.destino) window.location.href = item.dataset.destino;
    });

    document.getElementById('campanita-marcar-todas').addEventListener('click', () => {
        notificacionesActuales.filter(n => !n.leida).forEach(n => marcarComoLeida(n.id));
    });

    let dejarDeEscuchar = () => {};
    onAuthStateChanged(auth, (user) => {
        dejarDeEscuchar(); // por si había una sesión anterior escuchada (cambio de cuenta, poco común pero por las dudas)
        if (!user) {
            renderizarLista([]);
            dejarDeEscuchar = () => {};
            return;
        }
        dejarDeEscuchar = escucharNotificaciones(renderizarLista);
    });
}
