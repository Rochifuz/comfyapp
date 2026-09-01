// Filtro avanzado reutilizable para historiales: una lista de
// condiciones (campo + operador + valor) combinadas con un único modo
// GLOBAL — "todas" (Y / AND) o "cualquiera" (O / OR) — en vez de dejar
// armar lógica anidada tipo "(A Y B) O C". Eso sería mucho más potente,
// pero también mucho más difícil de entender y de armar para alguien
// sin experiencia con bases de datos — un solo interruptor Y/O que
// aplica a todas las condiciones cubre el caso real de uso (cruzar 2 o
// 3 condiciones simples, ej. "Categoría es Comida Y Monto es mayor que
// 5000") sin la complejidad de un constructor de consultas de verdad.
//
// Cada condición se arma con tres partes en fila (campo, operador,
// valor) — se lee casi como una oración, no hace falta escribir nada
// parecido a una fórmula.

import { esc } from './ui.js';

// `campos`: array de { valor, texto, tipo: 'texto-igual' | 'numero',
// opciones? } — 'texto-igual' arma un <select> con `opciones` (array de
// {valor,texto}) y ofrece "es"/"no es"; 'numero' arma un <input
// type="number"> y ofrece "es mayor que"/"es menor que"/"es igual a".
// `item[condicion.campo]` es lo que se compara — por eso `valor` de
// cada campo tiene que coincidir con el nombre real de esa propiedad en
// los objetos que después se van a filtrar (ver cumpleCondiciones).
export function iniciarFiltroAvanzado({ contenedorCondiciones, selectModo, botonAgregar, campos, onCambio }) {
    let condiciones = [];

    function campoPorValor(valor) {
        return campos.find(c => c.valor === valor) || campos[0];
    }

    function operadoresDeCampo(campo) {
        return campo.tipo === 'numero'
            ? [{ valor: 'mayor', texto: 'es mayor que' }, { valor: 'menor', texto: 'es menor que' }, { valor: 'igual', texto: 'es igual a' }]
            : [{ valor: 'es', texto: 'es' }, { valor: 'no-es', texto: 'no es' }];
    }

    function agregarCondicion() {
        const campoInicial = campos[0];
        condiciones.push({ campo: campoInicial.valor, operador: operadoresDeCampo(campoInicial)[0].valor, valor: '' });
        render();
    }

    function quitarCondicion(indice) {
        condiciones.splice(indice, 1);
        render();
    }

    function render() {
        contenedorCondiciones.innerHTML = condiciones.map((cond, indice) => {
            const campo = campoPorValor(cond.campo);
            const operadores = operadoresDeCampo(campo);
            const valorCampo = campo.tipo === 'numero'
                ? `<input type="number" step="0.01" class="condicion-valor" data-indice="${indice}" placeholder="Monto" value="${esc(cond.valor)}">`
                : `<select class="condicion-valor" data-indice="${indice}">
                        <option value="">Elegí una opción...</option>
                        ${(campo.opciones || []).map(o => `<option value="${esc(o.valor)}" ${o.valor === cond.valor ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}
                   </select>`;

            return `
                <div class="fila-condicion-filtro">
                    <select class="condicion-campo" data-indice="${indice}">
                        ${campos.map(c => `<option value="${c.valor}" ${c.valor === cond.campo ? 'selected' : ''}>${esc(c.texto)}</option>`).join('')}
                    </select>
                    <select class="condicion-operador" data-indice="${indice}">
                        ${operadores.map(o => `<option value="${o.valor}" ${o.valor === cond.operador ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}
                    </select>
                    ${valorCampo}
                    <button type="button" class="icono condicion-quitar" data-indice="${indice}" title="Quitar esta condición">🗑️</button>
                </div>
            `;
        }).join('');

        contenedorCondiciones.querySelectorAll('.condicion-campo').forEach(select => {
            select.addEventListener('change', () => {
                const indice = parseInt(select.dataset.indice, 10);
                const nuevoCampo = campoPorValor(select.value);
                // Cambiar de campo (ej. de "Categoría" a "Monto") puede
                // cambiar de tipo (texto→número) — el operador y el
                // valor de antes ya no tendrían sentido, se resetean.
                condiciones[indice] = { campo: nuevoCampo.valor, operador: operadoresDeCampo(nuevoCampo)[0].valor, valor: '' };
                render();
                disparar();
            });
        });
        contenedorCondiciones.querySelectorAll('.condicion-operador').forEach(select => {
            select.addEventListener('change', () => {
                condiciones[parseInt(select.dataset.indice, 10)].operador = select.value;
                disparar();
            });
        });
        contenedorCondiciones.querySelectorAll('.condicion-valor').forEach(campo => {
            const evento = campo.tagName === 'SELECT' ? 'change' : 'input';
            campo.addEventListener(evento, () => {
                condiciones[parseInt(campo.dataset.indice, 10)].valor = campo.value;
                disparar();
            });
        });
        contenedorCondiciones.querySelectorAll('.condicion-quitar').forEach(boton => {
            boton.addEventListener('click', () => {
                quitarCondicion(parseInt(boton.dataset.indice, 10));
                disparar();
            });
        });
    }

    // Una condición recién agregada (valor todavía vacío) no filtra
    // nada hasta que se complete — así que no hace falta esperar a que
    // el usuario la termine de cargar para poder seguir viendo el resto
    // de la lista.
    function disparar() {
        onCambio(condiciones.filter(c => c.valor !== ''), selectModo.value);
    }

    botonAgregar.addEventListener('click', () => { agregarCondicion(); disparar(); });
    selectModo.addEventListener('change', disparar);
}

// Evalúa una condición contra un item genérico — `item[condicion.campo]`
// es lo que se compara, así que el nombre de campo elegido al definir
// los `campos` (ver iniciarFiltroAvanzado) tiene que coincidir con el
// nombre real de esa propiedad en los items que se van a filtrar.
function cumpleCondicion(item, condicion, campos) {
    const definicion = campos.find(c => c.valor === condicion.campo);
    const valorItem = item[condicion.campo];

    if (definicion && definicion.tipo === 'numero') {
        const numero = parseFloat(condicion.valor);
        const valorNumerico = parseFloat(valorItem);
        if (isNaN(numero) || isNaN(valorNumerico)) return false;
        if (condicion.operador === 'mayor') return valorNumerico > numero;
        if (condicion.operador === 'menor') return valorNumerico < numero;
        return valorNumerico === numero;
    }

    const coincide = String(valorItem || '') === condicion.valor;
    return condicion.operador === 'no-es' ? !coincide : coincide;
}

// `condiciones` ya viene sin las que todavía no tienen valor cargado
// (ver disparar() de arriba) — con la lista vacía, no filtra nada.
export function cumpleFiltroAvanzado(item, condiciones, modo, campos) {
    if (condiciones.length === 0) return true;
    const resultados = condiciones.map(c => cumpleCondicion(item, c, campos));
    return modo === 'OR' ? resultados.some(Boolean) : resultados.every(Boolean);
}
