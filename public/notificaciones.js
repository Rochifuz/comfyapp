// Avisos de "tu tarjeta cierra pronto" y "estás por pasarte del
// presupuesto" — usando la Notification API del navegador, mostrados
// nada más mientras la app está abierta (no es una notificación push de
// verdad, que llegaría con la app cerrada: eso necesitaría un servicio
// en un servidor propio, plan pago). Es la versión gratis: cada vez que
// se abre Gastos personales con la app teniendo permiso concedido, se
// fija si corresponde avisar y muestra una notificación del sistema
// (fuera de la pestaña, con ícono y todo); si no se dio permiso, cae
// a un aviso common y silvestre (avisar(), el toast de siempre).
//
// Para no repetir el mismo aviso una y otra vez cada vez que se entra en
// el mismo día, se guarda en localStorage qué ya se avisó hoy.

import { avisar } from './ui.js';
import { notificarme } from './notificacionesCentro.js';

const CLAVE_ACTIVADAS = 'notificaciones-activadas';

export function notificacionesSoportadas() {
    return 'Notification' in window;
}

export function notificacionesActivadas() {
    return notificacionesSoportadas()
        && localStorage.getItem(CLAVE_ACTIVADAS) === 'si'
        && Notification.permission === 'granted';
}

// Devuelve true si quedaron activadas. Tiene que llamarse desde un click
// (el navegador exige un gesto del usuario para preguntar el permiso).
export async function activarNotificaciones() {
    if (!notificacionesSoportadas()) {
        throw new Error('Tu navegador no soporta notificaciones.');
    }
    const permiso = await Notification.requestPermission();
    localStorage.setItem(CLAVE_ACTIVADAS, permiso === 'granted' ? 'si' : 'no');
    return permiso === 'granted';
}

export function desactivarNotificaciones() {
    localStorage.setItem(CLAVE_ACTIVADAS, 'no');
}

function hoyTexto() {
    return new Date().toISOString().slice(0, 10);
}

function yaAvisadoHoy(clave) {
    return localStorage.getItem(`${clave}-${hoyTexto()}`) === 'si';
}

function marcarAvisadoHoy(clave) {
    localStorage.setItem(`${clave}-${hoyTexto()}`, 'si');
}

function notificar(titulo, cuerpo) {
    if (notificacionesActivadas()) {
        try {
            new Notification(titulo, { body: cuerpo, icon: 'icon.svg' });
            return;
        } catch {
            // Algunos navegadores (ej. varios en Android) no dejan crear
            // Notification directo así, piden pasar por un service
            // worker — en vez de fallar en silencio, se cae al toast.
        }
    }
    avisar(`${titulo} — ${cuerpo}`, 'info');
}

// `cierre`: Date del cierre del ciclo actual (ver calcularCicloDeTarjeta,
// en perfil.js). `diasAntes`: con cuánta anticipación avisar (0 a 7,
// configurable en cuenta.html — ver preferenciasNotif en perfil.js;
// antes era un 3 fijo). Se avisa una vez por día mientras siga dentro de
// esa ventana. Quien llama (payments.html) ya se fija que la preferencia
// "cierreTarjeta" esté prendida antes de invocar esto — acá no hace
// falta repetir ese chequeo.
export function avisarSiCierreProximo(cierre, diasAntes = 3) {
    const hoy = new Date();
    const dias = Math.ceil((cierre - hoy) / 86400000);
    if (dias < 0 || dias > diasAntes) return;
    if (yaAvisadoHoy('notif-cierre')) return;
    marcarAvisadoHoy('notif-cierre');

    const cuerpo = dias === 0 ? 'Tu tarjeta cierra hoy.' : `Tu tarjeta cierra en ${dias} día${dias === 1 ? '' : 's'}.`;
    notificar('💳 Cierre de tarjeta', cuerpo);
    // A diferencia del toast/Notification de acá arriba (que solo se ve
    // en el momento, si la app está abierta), esto además queda guardado
    // en la campanita 🔔 — así se sigue viendo el aviso aunque se cierre
    // la pestaña antes de leerlo. Un error acá (ej. sin conexión) no
    // debería romper el resto del aviso, por eso no se espera (no hace
    // falta el resultado) ni se deja sin atrapar.
    notificarme({
        tipo: 'cierre-tarjeta',
        titulo: '💳 Cierre de tarjeta',
        cuerpo,
        destino: '/payments.html',
    }).catch(error => console.error('No se pudo guardar la notificación de cierre de tarjeta:', error));
}

// `gastadoDelMes`/`presupuesto`: en pesos, del mes calendario actual real
// (no del período que el usuario esté navegando en la página) — se avisa
// a partir del 90%, una vez por día mientras siga así. Mismo criterio que
// arriba: quien llama ya filtró por la preferencia "presupuesto".
export function avisarSiPresupuestoAlLimite(gastadoDelMes, presupuesto) {
    if (!presupuesto || presupuesto <= 0) return;
    const porcentaje = (gastadoDelMes / presupuesto) * 100;
    if (porcentaje < 90) return;
    if (yaAvisadoHoy('notif-presupuesto')) return;
    marcarAvisadoHoy('notif-presupuesto');

    const cuerpo = porcentaje >= 100
        ? `Ya superaste tu presupuesto mensual ($${gastadoDelMes.toFixed(2)} de $${presupuesto.toFixed(2)}).`
        : `Llevás gastado el ${Math.round(porcentaje)}% de tu presupuesto mensual.`;
    notificar('🎯 Presupuesto', cuerpo);
    // Igual que el de cierre de tarjeta — queda guardado en la campanita
    // 🔔, no solo como aviso efímero.
    notificarme({
        tipo: 'presupuesto',
        titulo: '🎯 Presupuesto',
        cuerpo,
        destino: '/payments.html',
    }).catch(error => console.error('No se pudo guardar la notificación de presupuesto:', error));
}

// `pendientes`: lista de recurrentes (ver recurrentes.js) que todavía no
// se cargaron este mes — se avisa una vez por día mientras sigan
// pendientes, agrupados en un solo aviso (no uno por cada uno, para no
// llenar de notificaciones a alguien con varios gastos fijos). Mismo
// criterio: quien llama ya filtró por la preferencia "recurrentes".
export function avisarSiRecurrentesPendientes(pendientes) {
    if (!pendientes || pendientes.length === 0) return;
    if (yaAvisadoHoy('notif-recurrentes')) return;
    marcarAvisadoHoy('notif-recurrentes');

    const cuerpo = pendientes.length === 1
        ? `Todavía no cargaste "${pendientes[0].descripcion}" este mes.`
        : `Tenés ${pendientes.length} gastos recurrentes sin cargar este mes.`;
    notificar('🔁 Gasto recurrente', cuerpo);
    notificarme({
        tipo: 'recurrente-pendiente',
        titulo: '🔁 Gasto recurrente',
        cuerpo,
        destino: '/payments.html',
    }).catch(error => console.error('No se pudo guardar la notificación de recurrente pendiente:', error));
}
