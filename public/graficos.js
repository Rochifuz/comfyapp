// Gráficos con Chart.js (vía CDN, como ya hacíamos con la librería del QR
// en 2FA) en vez de dibujar el SVG a mano: maneja mejor el tamaño real en
// pantalla (acá se lo fija explícito, en vez de calcularlo del contenido
// como pasaba antes), el tooltip al pasar el mouse, y el resize.
//
// Los colores se leen de las variables CSS del tema en el momento de
// dibujar, así los gráficos salen bien en oscuro/claro y con los colores
// personalizados de cada grupo — la única limitación es que si cambiás de
// tema con el gráfico ya dibujado, no se recolorea solo (el canvas no
// reacciona a CSS como el SVG); se actualiza en el próximo render (cambiar
// un filtro, o refrescar la página).

import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm';
import { esc } from './ui.js';

const instancias = {}; // contenedorId -> instancia de Chart, para destruirla antes de redibujar
const observadores = {}; // contenedorId -> ResizeObserver, uno solo por contenedor (ver más abajo)

function variableCss(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function destruirSiExiste(contenedorId) {
    if (instancias[contenedorId]) {
        instancias[contenedorId].destroy();
        delete instancias[contenedorId];
    }
}

// Chart.js calcula el ancho del canvas a partir de su contenedor en el
// momento en que se crea el gráfico — si en ese instante el contenedor
// todavía no tiene su tamaño final (ej. está dentro de una slide de un
// carrusel que arranca fuera de vista, o hay otras tarjetas cargándose
// arriba que todavía van a correr el layout — más común en celular, con
// más tarjetas apiladas antes del carrusel) el gráfico puede quedar
// dibujado chico o roto para siempre, aunque los datos estén bien.
//
// Antes esto se corregía solo al cambiar de slide del carrusel (ver
// "sl-slide-change" en index.html) — cubría ESE caso puntual, pero no
// cualquier otro motivo por el que el contenedor cambiara de tamaño
// después de dibujado. Un ResizeObserver por contenedor es la forma
// genérica de cubrir todos los casos a la vez: se dispara solo cada vez
// que el tamaño real del contenedor cambia, sea cual sea el motivo, y
// llama a resize() del gráfico que esté ahí en ese momento (se lee
// `instancias[contenedorId]` recién al dispararse, no al crear el
// observer, así que sigue funcionando bien aunque el gráfico se haya
// redibujado varias veces desde que se empezó a observar).
function observarRedimension(contenedorId) {
    if (observadores[contenedorId] || typeof ResizeObserver === 'undefined') return;
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return;
    const observer = new ResizeObserver(() => {
        instancias[contenedorId]?.resize();
    });
    observer.observe(contenedor);
    observadores[contenedorId] = observer;
}

// Se deja como estaba (llamarla a mano en algún momento puntual sigue
// sirviendo, ej. justo después de un cambio de slide) — ahora es un
// refuerzo más, no la única forma de corregirse.
export function redimensionarGraficos() {
    Object.values(instancias).forEach(chart => chart.resize());
}

function sinDatos(contenedorId, mensaje) {
    destruirSiExiste(contenedorId);
    const contenedor = document.getElementById(contenedorId);
    if (contenedor) {
        contenedor.innerHTML = `<p class="texto-muted" style="font-size:.85rem; text-align:center; padding: var(--space-4) 0;">${esc(mensaje)}</p>`;
    }
}

function prepararCanvas(contenedorId, alturaPx) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return null;
    destruirSiExiste(contenedorId);
    contenedor.innerHTML = `<div style="height:${alturaPx}px;"><canvas></canvas></div>`;
    observarRedimension(contenedorId);
    return contenedor.querySelector('canvas');
}

function opcionesComunes(formatearValor, ejeValores) {
    const colorSuperficie = variableCss('--color-surface');
    const colorBorde = variableCss('--color-border');

    return {
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
            legend: { display: false }, // una sola serie: el título de la tarjeta ya dice qué es
            tooltip: {
                backgroundColor: colorSuperficie,
                borderColor: colorBorde,
                borderWidth: 1,
                titleColor: variableCss('--color-text'),
                bodyColor: variableCss('--color-text'),
                padding: 8,
                callbacks: {
                    label: (contexto) => formatearValor(ejeValores === 'x' ? contexto.parsed.x : contexto.parsed.y),
                },
            },
        },
    };
}

// datos: [{ etiqueta, valor }]
export function graficoBarrasHorizontal(contenedorId, datos, formatearValor = (v) => `$${v.toFixed(2)}`) {
    if (!datos.length || datos.every(d => d.valor <= 0)) {
        sinDatos(contenedorId, 'Sin datos para este período.');
        return;
    }

    // Altura chica y fija por fila — la spec anterior calculaba mal el
    // alto del contenedor y por eso los gráficos salían enormes.
    const altura = Math.min(Math.max(datos.length * 30, 90), 260);
    const canvas = prepararCanvas(contenedorId, altura);
    if (!canvas) return;

    const colorTexto = variableCss('--color-text-muted');
    const colorGrilla = variableCss('--color-border');

    instancias[contenedorId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: datos.map(d => d.etiqueta),
            datasets: [{
                data: datos.map(d => d.valor),
                backgroundColor: variableCss('--color-primary'),
                borderRadius: 4,
                maxBarThickness: 18,
            }],
        },
        options: {
            ...opcionesComunes(formatearValor, 'x'),
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: colorTexto, font: { size: 10 }, callback: (v) => formatearValor(v) },
                    grid: { color: colorGrilla },
                },
                y: {
                    ticks: { color: colorTexto, font: { size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

// datos: [{ etiqueta, valor }], en el orden en que se deben mostrar (no se
// reordenan solas — para "por mes" o "por día" el orden cronológico importa).
export function graficoBarrasVertical(contenedorId, datos, formatearValor = (v) => `$${v.toFixed(0)}`) {
    if (!datos.length || datos.every(d => d.valor <= 0)) {
        sinDatos(contenedorId, 'Sin datos para este período.');
        return;
    }

    const canvas = prepararCanvas(contenedorId, 170);
    if (!canvas) return;

    const colorTexto = variableCss('--color-text-muted');
    const colorGrilla = variableCss('--color-border');

    instancias[contenedorId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: datos.map(d => d.etiqueta),
            datasets: [{
                data: datos.map(d => d.valor),
                backgroundColor: variableCss('--color-primary'),
                borderRadius: 4,
                maxBarThickness: 26,
            }],
        },
        options: {
            ...opcionesComunes(formatearValor, 'y'),
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: colorTexto, font: { size: 10 }, callback: (v) => formatearValor(v) },
                    grid: { color: colorGrilla },
                },
                x: {
                    ticks: { color: colorTexto, font: { size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

// Dos series en el mismo gráfico (ej. ingresos vs. gastos por mes) — a
// diferencia de los de arriba, acá SÍ hace falta la leyenda (el título
// de la tarjeta ya no alcanza para distinguir cuál barra es cuál).
// `etiquetas`: nombres del eje X (ej. los meses); `serieA`/`serieB`:
// arrays de números, mismo orden y largo que `etiquetas`.
export function graficoBarrasComparativo(contenedorId, etiquetas, serieA, nombreA, serieB, nombreB, formatearValor = (v) => `$${v.toFixed(0)}`) {
    if (!etiquetas.length || (serieA.every(v => v <= 0) && serieB.every(v => v <= 0))) {
        sinDatos(contenedorId, 'Sin datos para este período.');
        return;
    }

    const canvas = prepararCanvas(contenedorId, 190);
    if (!canvas) return;

    const colorTexto = variableCss('--color-text-muted');
    const colorGrilla = variableCss('--color-border');
    const colorSuperficie = variableCss('--color-surface');
    const colorBorde = variableCss('--color-border');

    instancias[contenedorId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [
                { label: nombreA, data: serieA, backgroundColor: variableCss('--color-success'), borderRadius: 4, maxBarThickness: 22 },
                { label: nombreB, data: serieB, backgroundColor: variableCss('--color-danger'), borderRadius: 4, maxBarThickness: 22 },
            ],
        },
        options: {
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
                legend: { position: 'top', labels: { color: colorTexto, font: { size: 11 }, boxWidth: 12 } },
                tooltip: {
                    backgroundColor: colorSuperficie,
                    borderColor: colorBorde,
                    borderWidth: 1,
                    titleColor: variableCss('--color-text'),
                    bodyColor: variableCss('--color-text'),
                    padding: 8,
                    callbacks: { label: (contexto) => `${contexto.dataset.label}: ${formatearValor(contexto.parsed.y)}` },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: colorTexto, font: { size: 10 }, callback: (v) => formatearValor(v) },
                    grid: { color: colorGrilla },
                },
                x: {
                    ticks: { color: colorTexto, font: { size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

// Serie en el tiempo (ej. LP/rango de GamingApp a lo largo de las últimas
// partidas) — a diferencia de las barras de arriba, acá el ORDEN
// cronológico es el dato en sí, así que se dibuja como línea con los
// puntos ya en el orden que se pasen (no se reordenan solos).
// `etiquetas`/`valores`: mismo criterio que graficoBarrasVertical.
export function graficoLinea(contenedorId, etiquetas, valores, formatearValor = (v) => `${v}`) {
    if (!etiquetas.length) {
        sinDatos(contenedorId, 'Sin datos para este período.');
        return;
    }

    const canvas = prepararCanvas(contenedorId, 170);
    if (!canvas) return;

    const colorTexto = variableCss('--color-text-muted');
    const colorGrilla = variableCss('--color-border');
    const colorPrimario = variableCss('--color-primary');

    instancias[contenedorId] = new Chart(canvas, {
        type: 'line',
        data: {
            labels: etiquetas,
            datasets: [{
                data: valores,
                borderColor: colorPrimario,
                backgroundColor: colorPrimario,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.25,
                fill: false,
            }],
        },
        options: {
            ...opcionesComunes(formatearValor, 'y'),
            scales: {
                y: {
                    ticks: { color: colorTexto, font: { size: 10 }, callback: (v) => formatearValor(v) },
                    grid: { color: colorGrilla },
                },
                x: {
                    ticks: { color: colorTexto, font: { size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

// El "gemelo accesible" de cada gráfico: un botón que muestra/oculta una
// tabla simple con los mismos datos. Se puede llamar de nuevo cada vez que
// cambian los filtros (reemplaza el bloque anterior en vez de acumular
// uno nuevo al lado del gráfico).
export function agregarVistaDeTabla(contenedorId, datos, etiquetaColumna, formatearValor = (v) => `$${v.toFixed(2)}`) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return;

    const idPie = `${contenedorId}-pie`;
    document.getElementById(idPie)?.remove();
    if (!datos.length) return;

    const idTabla = `${contenedorId}-tabla`;
    const filas = datos.map(d => `<tr><td>${esc(d.etiqueta)}</td><td class="monto">${esc(formatearValor(d.valor))}</td></tr>`).join('');

    contenedor.insertAdjacentHTML('afterend', `
        <div id="${idPie}">
            <div class="grafico-pie">
                <button type="button" class="secundario" id="${idTabla}-boton">Ver como tabla</button>
            </div>
            <div class="tabla-wrap" id="${idTabla}" style="display:none; margin-top: var(--space-2);">
                <table>
                    <thead><tr><th>${esc(etiquetaColumna)}</th><th>Valor</th></tr></thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
        </div>
    `);

    const boton = document.getElementById(`${idTabla}-boton`);
    const tabla = document.getElementById(idTabla);
    boton.addEventListener('click', () => {
        const abrir = tabla.style.display === 'none';
        tabla.style.display = abrir ? 'block' : 'none';
        boton.textContent = abrir ? 'Ocultar tabla' : 'Ver como tabla';
    });
}
