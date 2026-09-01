// Carrusel simple para tarjetas de números y gráficos chicos — con
// scroll horizontal nativo (CSS scroll-snap) en vez de un componente
// de terceros. Reemplaza los <sl-carousel> que se usaban antes para
// esto: ese componente calcula su alto internamente (Shadow DOM, no
// controlable del todo desde afuera) a partir del ANCHO disponible, y
// terminaba recortando contenido en vez de mostrarlo entero — pasó en
// celular y hasta en PC. Acá cada slide es un <div> normal, sin Shadow
// DOM de por medio: el alto lo decide el propio contenido (con flex
// stretch, todos los slides quedan altos como el más alto) y no hay
// ningún cálculo raro que pueda salir mal.
//
// Estructura HTML esperada:
//   <div class="mini-carrusel">
//     <button class="mini-carrusel-anterior">‹</button>
//     <button class="mini-carrusel-siguiente">›</button>
//     <div class="mini-carrusel-pista">
//       <div class="mini-carrusel-slide">...</div>
//       ...
//     </div>
//     <div class="mini-carrusel-puntos"></div>
//   </div>
// Los botones y los puntos son opcionales — si el contenedor no los
// tiene, esta función simplemente no hace nada con ellos.

export function iniciarMiniCarrusel(contenedor) {
    if (!contenedor) return null;
    const pista = contenedor.querySelector('.mini-carrusel-pista');
    if (!pista) return null;
    const puntosContenedor = contenedor.querySelector('.mini-carrusel-puntos');

    // El slide "activo" es el más cercano al borde izquierdo visible —
    // alcanza con comparar posiciones de scroll, no hace falta nada
    // más sofisticado (IntersectionObserver, etc.) para algo así de
    // simple.
    function indiceActivo() {
        const slides = Array.from(pista.children);
        let indice = 0;
        let distanciaMinima = Infinity;
        slides.forEach((slide, i) => {
            const distancia = Math.abs(slide.offsetLeft - pista.scrollLeft);
            if (distancia < distanciaMinima) {
                distanciaMinima = distancia;
                indice = i;
            }
        });
        return indice;
    }

    // `comportamiento`: 'smooth' desliza (lo normal, entre slides
    // vecinos); 'instant' salta sin animación — se usa solo para el
    // loop (último → primero o primero → último), porque animar ESE
    // salto de punta a punta se vería como si retrocediera por todos
    // los slides del medio en vez de dar la vuelta.
    function irASlide(indice, comportamiento = 'smooth') {
        const slide = pista.children[indice];
        if (slide) pista.scrollTo({ left: slide.offsetLeft, behavior: comportamiento });
    }

    function marcarPuntoActivo() {
        if (!puntosContenedor) return;
        const activo = indiceActivo();
        puntosContenedor.querySelectorAll('.mini-carrusel-punto').forEach((boton, i) => {
            boton.classList.toggle('activo', i === activo);
        });
    }

    // Arma los puntitos de paginación según cuántos slides haya AHORA
    // — se expone como `actualizar()` para cuando el contenido se arma
    // por JS y puede cambiar de cantidad (ej. el carrusel de Período,
    // con un par de slides por cada moneda que tenga gastos cargados).
    function armarPuntos() {
        if (!puntosContenedor) return;
        const cantidad = pista.children.length;
        puntosContenedor.innerHTML = cantidad > 1
            ? Array.from({ length: cantidad }, (_, i) => `
                <button type="button" class="mini-carrusel-punto" data-indice="${i}" aria-label="Ir a la diapositiva ${i + 1}"></button>
            `).join('')
            : '';
        puntosContenedor.querySelectorAll('.mini-carrusel-punto').forEach(boton => {
            boton.addEventListener('click', () => irASlide(parseInt(boton.dataset.indice, 10)));
        });
        marcarPuntoActivo();
    }

    // Debounce chico: mientras se desliza, el evento 'scroll' dispara
    // muchísimas veces por segundo — no hace falta recalcular el punto
    // activo en cada una, alcanza con la posición final.
    let temporizador = null;
    pista.addEventListener('scroll', () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(marcarPuntoActivo, 100);
    });

    // Loop: de la última slide, "siguiente" vuelve a la primera (y al
    // revés con "anterior") — como no hay que clonar nada (a diferencia
    // de Shoelace, que clonaba el primer/último slide para este mismo
    // efecto y eso duplicaba ids), no hay riesgo de que un gráfico se
    // dibuje adentro de un clon en vez del slide real.
    contenedor.querySelector('.mini-carrusel-anterior')?.addEventListener('click', () => {
        const total = pista.children.length;
        const actual = indiceActivo();
        const esVueltaDeLoop = actual === 0;
        irASlide((actual - 1 + total) % total, esVueltaDeLoop ? 'instant' : 'smooth');
    });
    contenedor.querySelector('.mini-carrusel-siguiente')?.addEventListener('click', () => {
        const total = pista.children.length;
        const actual = indiceActivo();
        const esVueltaDeLoop = actual === total - 1;
        irASlide((actual + 1) % total, esVueltaDeLoop ? 'instant' : 'smooth');
    });

    armarPuntos();
    return { actualizar: armarPuntos };
}

// Autoplay opcional: avanza un slide cada `intervaloMs`, dando la
// vuelta al llegar al final (de la última vuelve a la primera, sin
// animar ESE salto puntual — ver el comentario de irASlide más arriba
// sobre por qué). Se corta apenas alguien toca el carrusel a mano
// (arrastra, clickea una flecha o un puntito), para no pisarle la
// navegación a quien ya está mirando algo puntual.
export function iniciarAutoplay(contenedor, intervaloMs) {
    const pista = contenedor.querySelector('.mini-carrusel-pista');
    if (!pista) return;

    function siguienteSlide() {
        const slides = Array.from(pista.children);
        if (slides.length < 2) return;
        let indice = 0;
        let distanciaMinima = Infinity;
        slides.forEach((slide, i) => {
            const distancia = Math.abs(slide.offsetLeft - pista.scrollLeft);
            if (distancia < distanciaMinima) { distanciaMinima = distancia; indice = i; }
        });
        const esVueltaDeLoop = indice === slides.length - 1;
        const siguiente = slides[esVueltaDeLoop ? 0 : indice + 1];
        pista.scrollTo({ left: siguiente.offsetLeft, behavior: esVueltaDeLoop ? 'instant' : 'smooth' });
    }

    const intervalo = setInterval(siguienteSlide, intervaloMs);
    const detener = () => clearInterval(intervalo);
    // 'wheel' cubre el trackpad; 'pointerdown' cubre touch, mouse y
    // los clics en las flechas/puntitos (son hijos de este mismo
    // contenedor, el evento burbujea).
    contenedor.addEventListener('pointerdown', detener, { once: true });
    contenedor.addEventListener('wheel', detener, { once: true });
}
