// Notificaciones tipo "toast" en vez de alert()/confirm() del navegador —
// los popups nativos son feos, bloquean la página y en el celular tapan
// todo. Esto se usa en las 3 páginas para avisos ("gasto agregado",
// "no se pudo unir al grupo", etc).

// La entrada del toast y del modal ya la resuelve una animación CSS simple
// (ver .toast/.modal-overlay en main.css) — Motion One se usa solo para la
// SALIDA (que CSS no puede animar solo: hay que esperar a que termine para
// recién ahí sacar el elemento del DOM), con una curva con un poquito de
// resorte en vez de algo lineal. Se importa acá nomás, con el mismo
// patrón de CDN que ya usábamos para Chart.js en graficos.js.
import { animate } from 'https://cdn.jsdelivr.net/npm/motion@13.1.0/+esm';

function contenedorDeToasts() {
    let contenedor = document.getElementById('toast-contenedor');
    if (!contenedor) {
        contenedor = document.createElement('div');
        contenedor.id = 'toast-contenedor';
        document.body.appendChild(contenedor);
    }
    return contenedor;
}

// tipo: 'info' | 'exito' | 'error'
export function avisar(mensaje, tipo = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensaje;
    contenedorDeToasts().appendChild(toast);

    setTimeout(() => {
        animate(toast, { opacity: 0, x: 24 }, { duration: .2, ease: 'easeIn' })
            .then(() => toast.remove());
    }, 4000);
}

// Confirmación simple pero no bloqueante no es posible sin un modal propio;
// mantenemos confirm() nativo solo para "¿estás seguro?" en los borrados
// (es la única interrupción que de verdad conviene que sea bloqueante,
// para no borrar algo por error de doble click).
export function confirmar(mensaje) {
    return window.confirm(mensaje);
}

// Escapa texto para insertarlo de forma segura dentro de HTML armado con
// template literals (sirve tanto para texto como para atributos entre
// comillas dobles) — sin esto, cualquier texto que carga un usuario
// (nombre de grupo, descripción de un gasto, su nombre de perfil...)
// podría inyectar HTML/JS que se ejecute en la pantalla de otro usuario
// que lo vea (XSS). Se usa en cada interpolación dentro de innerHTML;
// nunca hace falta al asignar a .value o .textContent, esos ya tratan
// todo como texto plano siempre.
export function esc(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function copiarAlPortapapeles(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        avisar('Copiado al portapapeles', 'exito');
    } catch {
        avisar('No se pudo copiar. Valor: ' + texto, 'info');
    }
}

// Modal genérico (overlay + tarjeta centrada) para formularios de edición
// — a diferencia de los paneles desplegables (que empujan el resto de la
// página), esto "salta" arriba de todo, que es lo que pidieron para
// editar un gasto/ingreso puntual sin perder de vista dónde estabas.
function alCerrarConEscape(evento) {
    if (evento.key === 'Escape') cerrarModal();
}

export function abrirModal(html) {
    cerrarModal(); // por si ya había uno abierto

    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-caja">${html}</div>`;
    overlay.addEventListener('click', (evento) => {
        if (evento.target === overlay) cerrarModal();
    });

    document.body.appendChild(overlay);
    animate(overlay.querySelector('.modal-caja'), { opacity: [0, 1], scale: [.94, 1] }, { duration: .2, ease: [.2, .8, .2, 1] });
    document.addEventListener('keydown', alCerrarConEscape);
    return overlay;
}

// No es async a propósito (nada de lo que la llama espera el resultado):
// dispara la animación de salida y, cuando termina, recién ahí saca el
// modal del DOM.
export function cerrarModal() {
    const existente = document.getElementById('modal-overlay');
    if (existente) {
        const caja = existente.querySelector('.modal-caja');
        if (caja) {
            animate(caja, { opacity: 0, scale: .96 }, { duration: .12, ease: 'easeIn' })
                .then(() => existente.remove());
        } else {
            existente.remove();
        }
    }
    document.removeEventListener('keydown', alCerrarConEscape);
}
