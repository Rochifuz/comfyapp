// Burbuja de ayuda flotante ("Gastón", abajo a la derecha en todas las
// páginas) — un asistente GUIADO, no un chat con IA libre: botones con
// las dudas o tareas más comunes, que responden con texto fijo y un link
// directo a la sección correspondiente, más formularios para reportar
// bugs y mandar ideas de mejora. Se decidió así (en vez de conectar una
// IA de verdad) para que siga siendo 100% gratis — un chat que "entienda"
// cualquier pregunta necesitaría un backend (Firebase Functions, plan
// pago) que rompería con el "gratis, sin tarjeta" que define todo el
// proyecto.

import { reportarBug, enviarSugerencia, haySesion } from './analitica.js';
import { avisar } from './ui.js';

// El texto de "respuesta" es HTML fijo escrito acá mismo (no viene de
// ningún usuario ni de Firestore), así que no hace falta esc() en esa
// parte — si en algún momento se arma con datos externos, ahí sí.
//
// `requiereSesion`: la respuesta manda a una página que pide login
// (requerirSesion la rebota a Inicio si no hay sesión) — no tiene sentido
// ofrecerla antes de saber que hay una. `soloSinSesion`: al revés, solo
// tiene sentido preguntarlo si TODAVÍA no iniciaste sesión.
const OPCIONES = [
    {
        pregunta: '🔑 ¿Cómo inicio sesión?',
        respuesta: 'Podés entrar con tu cuenta de <strong>Google</strong> (un solo toque) o con <strong>email y contraseña</strong> — las dos opciones están en Inicio.',
        link: null,
        soloSinSesion: true,
    },
    {
        pregunta: '🧾 ¿Cómo agrego un gasto?',
        respuesta: 'Andá a <strong>Gastos personales</strong> y tocá la tarjeta "Agregar gasto" — se abre un formulario con fecha, monto, categoría y método de pago (con cuotas, si es crédito).',
        link: { texto: 'Ir a Gastos personales', href: 'payments.html' },
        requiereSesion: true,
        seccionApp: true,
    },
    {
        pregunta: '👥 ¿Cómo creo o me uno a un grupo?',
        respuesta: 'Desde <strong>Grupos</strong> podés crear uno nuevo o unirte a uno existente con un código de invitación, arriba de todo.',
        link: { texto: 'Ir a Grupos', href: 'division-de-gastos.html' },
        requiereSesion: true,
        seccionApp: true,
    },
    {
        pregunta: '📊 ¿Dónde veo mis estadísticas?',
        respuesta: 'En <strong>Más datos</strong> tenés gráficos por categoría, por mes y por día de la semana, el top 5 de gastos y las compras que se repiten.',
        link: { texto: 'Ir a Más datos', href: 'estadisticas.html' },
        requiereSesion: true,
        seccionApp: true,
    },
    {
        pregunta: '💳 ¿Cómo cambio el día de cierre de mi tarjeta?',
        respuesta: 'En <strong>Gastos personales</strong>, en la tarjeta "Próximo resumen", tocá "✏️ Editar cierre". También se puede desde Cuenta → Tarjeta de crédito.',
        link: { texto: 'Ir a Gastos personales', href: 'payments.html' },
        requiereSesion: true,
        seccionApp: true,
    },
    {
        pregunta: '🔒 ¿Cómo cambio mi contraseña o activo la verificación en dos pasos?',
        respuesta: 'Todo eso está en <strong>Cuenta</strong>, en las secciones "Seguridad" y "Verificación en dos pasos".',
        link: { texto: 'Ir a Cuenta', href: 'cuenta.html' },
        requiereSesion: true,
        seccionApp: true,
    },
    {
        pregunta: '🌙 ¿Cómo cambio el tema oscuro/claro?',
        respuesta: 'Abrí el menú ☰ (arriba a la derecha) y usá el switch de "Tema oscuro".',
        link: null,
        // Ni requiereSesion ni soloSinSesion: el switch de tema está
        // siempre visible, con o sin sesión.
    },
];

// Se fija desde iniciarAsistente() — en páginas que no son "de adentro"
// de GastosApp (por ahora, sistema.html) las opciones que llevan a una
// sección de GastosApp (Gastos personales, Grupos, etc.) no tienen
// sentido: no hay forma de "ir a Gastos personales" desde el inicio del
// sistema completo sin antes elegir GastosApp como app.
let ocultarSeccionesApp = false;

function opcionesVisibles() {
    const logueado = haySesion();
    return OPCIONES
        .map((o, indice) => ({ ...o, indice }))
        .filter(o => (!o.requiereSesion || logueado) && (!o.soloSinSesion || !logueado) && (!o.seccionApp || !ocultarSeccionesApp));
}

// Se guarda una vez por pestaña/ventana (no una vez por página vista,
// como "sesiones" en analitica.js) para no mostrarlo de nuevo en cada
// link que se toca dentro de la misma visita.
const CLAVE_CALLOUT = 'asistente-callout-mostrado';

// Si alguien prefiere no tener la burbuja completa siempre encima (ej.
// en celular, donde ocupa una porción real de pantalla todo el tiempo),
// puede minimizarla a un círculo chico con el mismo emoji — nunca
// desaparece del todo, así que sigue siendo el propio botón "visible en
// todas las páginas" para volver a abrirla o agrandarla, sin necesitar
// un switch aparte en ningún menú. Se guarda en localStorage (no
// sessionStorage: la idea es que se acuerde entre visitas, no solo
// dentro de la misma pestaña).
const CLAVE_MINIMIZADO = 'asistente-minimizado';

export function asistenteEstaMinimizado() {
    return localStorage.getItem(CLAVE_MINIMIZADO) === '1';
}

function guardarMinimizado(minimizado) {
    if (minimizado) localStorage.setItem(CLAVE_MINIMIZADO, '1');
    else localStorage.removeItem(CLAVE_MINIMIZADO);
}

export function iniciarAsistente(opciones = {}) {
    ocultarSeccionesApp = !!opciones.ocultarSeccionesApp;
    if (document.getElementById('burbuja-asistente')) return; // por si se llama dos veces

    document.body.insertAdjacentHTML('beforeend', `
        <div id="callout-asistente" class="callout-asistente" role="button" tabindex="0">
            <button type="button" id="cerrar-callout" class="callout-cerrar" aria-label="Cerrar">✕</button>
            <p>¿Deseás hablar con <strong>Gastón</strong>? Tu asistente de GastosApp.</p>
        </div>
        <div id="burbuja-asistente-contenedor" class="burbuja-asistente-contenedor ${asistenteEstaMinimizado() ? 'minimizada' : ''}">
            <button type="button" id="burbuja-asistente" class="burbuja-asistente" title="Hablar con Gastón" aria-label="Abrir chat con Gastón">
                <span class="burbuja-asistente-emoji">💬</span><span class="burbuja-asistente-texto"> Gastón</span>
            </button>
            <button type="button" id="minimizar-asistente-burbuja" class="minimizar-asistente-burbuja" title="Minimizar a Gastón" aria-label="Minimizar a Gastón">−</button>
        </div>
        <div id="panel-asistente" class="panel-asistente" style="display:none;">
            <div class="panel-asistente-header">
                <span>💬 Gastón</span>
                <button type="button" id="cerrar-asistente" class="icono" aria-label="Cerrar ayuda">✕</button>
            </div>
            <div class="panel-asistente-cuerpo" id="asistente-cuerpo"></div>
        </div>
    `);

    const burbuja = document.getElementById('burbuja-asistente');
    const contenedor = document.getElementById('burbuja-asistente-contenedor');
    const panel = document.getElementById('panel-asistente');
    const cuerpo = document.getElementById('asistente-cuerpo');
    const callout = document.getElementById('callout-asistente');
    const botonMinimizar = document.getElementById('minimizar-asistente-burbuja');

    function actualizarBotonMinimizar() {
        const minimizado = contenedor.classList.contains('minimizada');
        botonMinimizar.textContent = minimizado ? '+' : '−';
        botonMinimizar.title = minimizado ? 'Mostrar a Gastón completo' : 'Minimizar a Gastón';
        botonMinimizar.setAttribute('aria-label', botonMinimizar.title);
    }

    botonMinimizar.addEventListener('click', (evento) => {
        evento.stopPropagation(); // no abrir el chat al tocar el −/+
        const minimizado = !contenedor.classList.contains('minimizada');
        contenedor.classList.toggle('minimizada', minimizado);
        guardarMinimizado(minimizado);
        actualizarBotonMinimizar();
        if (minimizado) callout.classList.remove('visible');
    });
    actualizarBotonMinimizar();

    function ocultarCallout() {
        callout.classList.remove('visible');
    }

    function abrirPanel() {
        ocultarCallout();
        panel.style.display = 'flex';
        mostrarMenu();
    }

    function cerrarPanel() {
        panel.style.display = 'none';
    }

    function mostrarMenu() {
        const logueado = haySesion();
        // Reportar un bug o mandar una sugerencia necesitan guardar quién
        // lo mandó — sin sesión, esos dos formularios no tienen a quién
        // atribuírselos, así que ni se ofrecen (mejor que mostrarlos y
        // que fallen al enviar).
        cuerpo.innerHTML = `
            <p class="asistente-saludo">¿En qué te ayudo?</p>
            ${opcionesVisibles().map(o => `<button type="button" class="asistente-opcion" data-opcion="${o.indice}">${o.pregunta}</button>`).join('')}
            ${logueado ? `
                <button type="button" class="asistente-opcion" data-opcion="bug">🐛 Quiero reportar un problema</button>
                <button type="button" class="asistente-opcion" data-opcion="sugerencia">💡 Dinos qué mejora podemos hacerle a GastosApp</button>
            ` : ''}
        `;

        cuerpo.querySelectorAll('[data-opcion]').forEach((boton) => {
            boton.addEventListener('click', () => {
                const clave = boton.dataset.opcion;
                if (clave === 'bug') {
                    mostrarFormulario({
                        intro: 'Contanos qué pasó — se guarda junto con la página en la que estabas, para poder revisarlo después.',
                        placeholder: 'Ej: al tocar Guardar no pasa nada...',
                        boton: 'Enviar reporte',
                        enviar: reportarBug,
                        exito: '¡Gracias! Reporte enviado.',
                    });
                } else if (clave === 'sugerencia') {
                    mostrarFormulario({
                        intro: 'Contanos qué se te ocurre — toda idea suma para mejorar la app.',
                        placeholder: 'Ej: estaría bueno poder...',
                        boton: 'Enviar idea',
                        enviar: enviarSugerencia,
                        exito: '¡Gracias por la idea!',
                    });
                } else {
                    mostrarRespuesta(OPCIONES[parseInt(clave, 10)]);
                }
            });
        });
    }

    function mostrarRespuesta(opcion) {
        cuerpo.innerHTML = `
            <button type="button" class="asistente-opcion" id="asistente-volver">← Volver</button>
            <p class="asistente-respuesta">${opcion.respuesta}</p>
            ${opcion.link ? `<a href="${opcion.link.href}">${opcion.link.texto} →</a>` : ''}
        `;
        document.getElementById('asistente-volver').addEventListener('click', mostrarMenu);
    }

    // Formulario de texto libre reutilizado por "reportar un bug" y por
    // "sugerir una mejora" — solo cambia el texto y a dónde se manda.
    function mostrarFormulario({ intro, placeholder, boton, enviar, exito }) {
        cuerpo.innerHTML = `
            <button type="button" class="asistente-opcion" id="asistente-volver">← Volver</button>
            <p class="asistente-respuesta">${intro}</p>
            <form id="form-asistente-texto">
                <textarea id="asistente-texto" class="asistente-textarea" rows="4" placeholder="${placeholder}" required></textarea>
                <button type="submit" style="width:100%;">${boton}</button>
            </form>
        `;
        document.getElementById('asistente-volver').addEventListener('click', mostrarMenu);

        document.getElementById('form-asistente-texto').addEventListener('submit', async (evento) => {
            evento.preventDefault();
            const texto = document.getElementById('asistente-texto').value.trim();
            if (!texto) return;
            try {
                await enviar(texto);
                avisar(exito, 'exito');
                cerrarPanel();
            } catch {
                avisar('No se pudo enviar. ¿Iniciaste sesión?', 'error');
            }
        });
    }

    burbuja.addEventListener('click', () => {
        if (panel.style.display === 'none') abrirPanel();
        else cerrarPanel();
    });

    document.getElementById('cerrar-asistente').addEventListener('click', cerrarPanel);

    // Clic en cualquier parte del cartelito abre el chat, menos en la ✕.
    callout.addEventListener('click', (evento) => {
        if (evento.target.id === 'cerrar-callout') {
            ocultarCallout();
            return;
        }
        abrirPanel();
    });

    // --- Cartelito de invitación, una vez por sesión de navegador ---
    // Si ya la minimizó a propósito, no tiene sentido insistir con el
    // cartelito invitando a hablar con alguien que prefirió bajarle el
    // perfil a la burbuja.
    if (!sessionStorage.getItem(CLAVE_CALLOUT) && !asistenteEstaMinimizado()) {
        sessionStorage.setItem(CLAVE_CALLOUT, '1');
        setTimeout(() => {
            if (panel.style.display !== 'none') return; // ya lo abrieron solos
            callout.classList.add('visible');
            setTimeout(ocultarCallout, 9000);
        }, 1200);
    }
}
