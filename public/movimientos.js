// "Movimientos unificados": junta los gastos personales con lo que pagué
// (o cobré) en mis grupos, en una sola lista — el cálculo que necesitan
// Gastos personales, Más datos e Inicio para saber "cuánto gasto en
// total", cada una mostrándolo a su manera (historial completo, gráficos,
// carrusel). Antes cada página lo calculaba por su cuenta: funcionaba en
// las 3, pero si en algún momento cambiaba el criterio en una y no en las
// otras, hubiera quedado inconsistente sin que nadie lo notara. Ahora las
// 3 llaman a esto.
//
// Cada gasto puede estar cargado en pesos, dólares o euros (ver
// monedas.js) — `amount` siempre queda en la moneda ORIGINAL en la que se
// cargó (para mostrarlo tal cual), y `amountARS` es el equivalente en
// pesos usando la cotización del momento (para poder sumar cosas de
// distinta moneda sin comparar peras con manzanas). Si no se pasan
// `cotizaciones` (todavía no cargaron, o falló la API y tampoco hay
// caché), `amountARS` queda igual a `amount` — asume que todo es peso,
// que es lo correcto para el caso más común (nadie cargó otra moneda).
// Si el gasto/pago tiene una cotización MANUAL guardada (la persona
// escribió a cuánto pagó, en vez de dejar que se calcule solo), esa gana
// siempre sobre la automática — ver montoEnARS en monedas.js.

import { montoEnARS as convertirItemAARS } from './monedas.js';

// Los gastos/pagos de grupo guardan `creadoEn` como Timestamp de
// Firestore (no una fecha YYYY-MM-DD como los personales) — hay que
// convertirlo para poder agruparlos por fecha junto con el resto.
export function fechaDeMovimientoGrupal(item) {
    if (item.creadoEn && typeof item.creadoEn.toDate === 'function') {
        return item.creadoEn.toDate().toISOString().slice(0, 10);
    }
    // Todavía no confirmado por el servidor (escritura optimista) — hoy
    // es la mejor aproximación mientras tanto.
    return new Date().toISOString().slice(0, 10);
}

// Solo lo que pagué yo (personal o en mis grupos) — es "cuánto gasto", no
// todo lo que se carga en un grupo del que soy parte (eso ya se ve
// completo desde Grupos). `datosGrupos` es un mapa grupoId -> { nombre,
// nombresPorUid } (de escucharGrupo/obtenerGrupoUnaVez, en grupos.js) —
// opcional: si no se pasa, se usa el nombre que ya trae `misGrupos`.
// `incluirPagosDeuda` solo hace falta en Gastos personales, que también
// muestra los pagos entre integrantes en su historial; Más datos e
// Inicio no lo necesitan.
//
// Cada movimiento sale con `tipo` (personal / grupo-gasto /
// grupo-pago-enviado / grupo-pago-recibido, detallado) Y `origen`
// (personal / grupo, resumido) — así cada página puede filtrar con el
// nivel de detalle que le haga falta sin tener que repetir el mapeo.
export function construirMovimientosUnificados({
    uid, gastosPersonales = [], misGrupos = [], gastosGrupales = {},
    pagosGrupales = {}, datosGrupos = {}, incluirPagosDeuda = false, cotizaciones = null,
}) {
    const aARS = (monto, moneda, cotizacionManual) => convertirItemAARS(monto, moneda, cotizacionManual, cotizaciones);

    const movimientos = gastosPersonales.map(p => {
        const moneda = p.moneda || 'ARS';
        const amount = parseFloat(p.amount);
        return {
            tipo: 'personal', origen: 'personal', id: p.id, date: p.date, amount, moneda,
            amountARS: aARS(amount, moneda, p.cotizacionManual),
            description: p.description, categoria: p.categoria, metodoPago: p.metodoPago,
            // Solo tiene sentido para gastos con tarjeta (ver "Marcar
            // como pagada" en payments.html) — se llevan igual para
            // cualquier método, total quedan sin usar si no aplica.
            pagado: p.pagado || false, pagoTarjetaId: p.pagoTarjetaId || null,
            grupoId: null, grupoNombre: null,
        };
    });

    misGrupos.forEach(g => {
        const datos = datosGrupos[g.id];
        const nombresDelGrupo = (datos && datos.nombresPorUid) || {};
        const grupoNombre = (datos && datos.nombre) || g.nombre;
        const nombreDe = (otroUid) => nombresDelGrupo[otroUid] || 'alguien';

        (gastosGrupales[g.id] || []).forEach(gasto => {
            if (gasto.pagadoPor !== uid) return;
            const moneda = gasto.moneda || 'ARS';
            movimientos.push({
                tipo: 'grupo-gasto', origen: 'grupo', id: gasto.id, date: fechaDeMovimientoGrupal(gasto),
                amount: gasto.monto, moneda, amountARS: aARS(gasto.monto, moneda, gasto.cotizacionManual),
                description: gasto.descripcion, categoria: gasto.categoria,
                grupoId: g.id, grupoNombre,
            });
        });

        if (!incluirPagosDeuda) return;

        (pagosGrupales[g.id] || []).forEach(pago => {
            const moneda = pago.moneda || 'ARS';
            if (pago.pagadoPor === uid) {
                movimientos.push({
                    tipo: 'grupo-pago-enviado', origen: 'grupo', id: pago.id, date: fechaDeMovimientoGrupal(pago),
                    amount: pago.monto, moneda, amountARS: aARS(pago.monto, moneda, pago.cotizacionManual),
                    description: `Pago a ${nombreDe(pago.recibidoPor)}`,
                    grupoId: g.id, grupoNombre, categoria: null,
                });
            }
            if (pago.recibidoPor === uid) {
                movimientos.push({
                    tipo: 'grupo-pago-recibido', origen: 'grupo', id: pago.id, date: fechaDeMovimientoGrupal(pago),
                    amount: pago.monto, moneda, amountARS: aARS(pago.monto, moneda, pago.cotizacionManual),
                    description: `Cobro de ${nombreDe(pago.pagadoPor)}`,
                    grupoId: g.id, grupoNombre, categoria: null,
                });
            }
        });
    });

    return movimientos;
}

// Cuánto le deben (positivo) o debe (negativo) UN usuario en UN grupo —
// mismo cálculo que calcularBalances() en división-de-gastos.html, pero
// reducido a un solo número (el propio) en vez de armar el balance de
// todos los integrantes. Pensado para Inicio, donde hace falta sumar el
// balance del usuario a través de TODOS sus grupos sin necesitar los
// nombres de los demás integrantes de cada uno.
export function balancePropioEnGrupo(uid, gastos = [], pagos = [], cotizaciones = null) {
    let balance = 0;

    gastos.forEach(gasto => {
        const participantes = (gasto.divididoEntre && gasto.divididoEntre.length)
            ? gasto.divididoEntre
            : [gasto.pagadoPor];
        const montoARS = convertirItemAARS(gasto.monto, gasto.moneda || 'ARS', gasto.cotizacionManual, cotizaciones);

        if (gasto.pagadoPor === uid) balance += montoARS;
        if (participantes.includes(uid)) {
            // Montos distintos por persona (ver "Dividir en montos
            // distintos" en división-de-gastos.html) — misma proporción
            // que en calcularBalances(), no partes iguales.
            const parte = gasto.partes
                ? montoARS * (gasto.monto > 0 ? (gasto.partes[uid] || 0) / gasto.monto : 0)
                : montoARS / participantes.length;
            balance -= parte;
        }
    });

    pagos.forEach(pago => {
        const montoARS = convertirItemAARS(pago.monto, pago.moneda || 'ARS', pago.cotizacionManual, cotizaciones);
        if (pago.pagadoPor === uid) balance += montoARS;
        if (pago.recibidoPor === uid) balance -= montoARS;
    });

    return balance;
}
