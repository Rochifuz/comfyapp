// Exportar movimientos a CSV (que Excel/Sheets/Numbers abren nativos —
// no hizo falta sumar una librería nueva solo para generar un .xlsx de
// verdad) y armar un resumen para mandar por mail.
//
// Lo de "mandarlo por mail" tiene un límite real: un link mailto: puede
// abrir el cliente de correo con un asunto y un cuerpo ya escritos, pero
// el navegador NO puede adjuntarle un archivo solo (por seguridad, ningún
// sitio puede armar adjuntos en tu mail sin que vos lo hagas a mano) —
// así que el mail sale con un RESUMEN en texto (total + por categoría),
// no la planilla completa. Para mandar el detalle línea por línea, la
// idea es descargar el CSV acá al lado y adjuntarlo a mano.

import { simboloDeMoneda } from './monedas.js';

function escaparCSV(valor) {
    let texto = String(valor ?? '');
    // "CSV injection": si una descripción (que puede haberla escrito
    // cualquier integrante de un grupo compartido, no solo uno mismo)
    // empieza con =, +, - o @, Excel/Sheets puede llegar a interpretarla
    // como una fórmula al abrir el CSV — anteponerle un apóstrofe es el
    // mitigation estándar, y no cambia cómo se ve el dato en una lectura
    // normal (los lectores de CSV lo ignoran, no queda visible).
    if (/^[=+\-@]/.test(texto)) {
        texto = `'${texto}`;
    }
    // Si tiene coma, comillas o salto de línea, hay que encerrarlo entre
    // comillas y duplicar las comillas internas — así lo pide el formato
    // CSV para que Excel no lo interprete como columnas de más.
    if (/[",\n]/.test(texto)) {
        return `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
}

// `movimientos`: mismo shape que arma movimientos.js (date, description,
// categoria, metodoPago, amount, moneda, amountARS, origen, grupoNombre).
export function generarCSV(movimientos) {
    const encabezado = ['Fecha', 'Descripción', 'Categoría', 'Método de pago', 'Origen', 'Moneda', 'Monto', 'Monto en pesos'];
    const filas = movimientos.map(m => [
        m.date,
        m.description || '',
        m.categoria || '',
        m.metodoPago || '',
        m.origen === 'grupo' ? `Grupo: ${m.grupoNombre || ''}` : 'Personal',
        m.moneda || 'ARS',
        m.amount.toFixed(2),
        (m.amountARS ?? m.amount).toFixed(2),
    ]);

    // BOM al principio: sin esto, Excel en Windows suele abrir los
    // acentos/ñ como caracteres raros en vez de UTF-8 bien leído.
    const BOM = '﻿';
    return BOM + [encabezado, ...filas]
        .map(fila => fila.map(escaparCSV).join(','))
        .join('\r\n');
}

// Dispara la descarga en el navegador — no hace falta ningún backend,
// es el mismo truco de siempre: un link invisible con un blob: URL y
// un click programado.
export function descargarCSV(nombreArchivo, contenidoCSV) {
    const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Si TODO lo que se exporta es de una sola moneda (ej. se filtró a "Solo
// dólares" antes de exportar), se suma nativo y se muestra con el
// símbolo de esa moneda — nada se convierte. Si está mezclado, se sigue
// sumando en pesos (amountARS), porque ahí sí hace falta un común
// denominador para poder dar un solo total.
function monedaUnicaDe(movimientos) {
    const monedas = new Set(movimientos.map(m => m.moneda || 'ARS'));
    return monedas.size === 1 ? [...monedas][0] : null;
}

// Arma el texto del cuerpo del mail: total, cantidad de movimientos y un
// desglose por categoría — no el detalle línea por línea (los clientes
// de mail suelen cortar links mailto: muy largos, y esto igual alcanza
// para un pantallazo rápido del período).
function generarResumenTexto(movimientos, etiquetaPeriodo) {
    const monedaUnica = monedaUnicaDe(movimientos);
    const campoMonto = monedaUnica ? 'amount' : 'amountARS';
    const formatearMoneda = (v) => `${monedaUnica ? simboloDeMoneda(monedaUnica) : '$'}${v.toFixed(2)}`;

    const total = movimientos.reduce((suma, m) => suma + (m[campoMonto] ?? m.amount), 0);

    const porCategoria = {};
    movimientos.forEach(m => {
        const clave = m.categoria || 'Sin categoría';
        porCategoria[clave] = (porCategoria[clave] || 0) + (m[campoMonto] ?? m.amount);
    });
    const lineasCategoria = Object.entries(porCategoria)
        .sort((a, b) => b[1] - a[1])
        .map(([categoria, monto]) => `- ${categoria}: ${formatearMoneda(monto)}`)
        .join('\n');

    return [
        `Resumen de gastos — ${etiquetaPeriodo}`,
        '',
        `Total: ${formatearMoneda(total)}`,
        `Movimientos: ${movimientos.length}`,
        '',
        'Por categoría:',
        lineasCategoria || '(sin movimientos)',
        '',
        'Generado desde GastosApp.',
    ].join('\n');
}

// Abre el cliente de mail del usuario con el resumen ya escrito — la
// persona elige a quién mandárselo y si adjunta el CSV a mano.
export function abrirMailConResumen(movimientos, etiquetaPeriodo) {
    const asunto = encodeURIComponent(`Gastos ${etiquetaPeriodo}`);
    const cuerpo = encodeURIComponent(generarResumenTexto(movimientos, etiquetaPeriodo));
    window.location.href = `mailto:?subject=${asunto}&body=${cuerpo}`;
}
