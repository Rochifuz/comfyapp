// Reemplaza los emojis "de toda la vida" (que Windows, Mac, Android y cada
// navegador dibujan un poquito distinto, con su propia tipografía) por los
// de Twemoji — el set que usa Twitter/X — así se ven exactamente iguales
// para todos los que entren a la app, sin importar desde dónde.
//
// No hace falta tocar ningún emoji del código: siguen siendo el mismo
// carácter Unicode de siempre (🧾👥📊🌙😊...) en cada template literal.
// twemoji.parse() los busca dentro del texto ya renderizado y los
// reemplaza por <img> apuntando al dibujo correspondiente — el trabajo es
// puramente visual, después de que el HTML ya está armado.
//
// El truco es MANTENERLO al día: casi todo en esta app se re-arma todo el
// tiempo con innerHTML (historiales en vivo, toasts, modales...), así que
// no alcanza con llamarlo una sola vez al cargar la página. Un
// MutationObserver sobre <body> se encarga de volver a pasarlo por
// cualquier contenido nuevo que aparezca, sin tener que acordarse de
// llamarlo a mano en cada lugar que hace innerHTML = ... en toda la app.

function reemplazarEmojisEn(nodo) {
    if (window.twemoji) window.twemoji.parse(nodo, { folder: 'svg', ext: '.svg' });
}

let iniciado = false;

export function iniciarEmojis() {
    if (iniciado) return; // por si iniciarNavbar() se llamara más de una vez
    iniciado = true;

    reemplazarEmojisEn(document.body);

    new MutationObserver((mutaciones) => {
        mutaciones.forEach((mutacion) => {
            mutacion.addedNodes.forEach((nodo) => {
                if (nodo.nodeType === Node.ELEMENT_NODE) reemplazarEmojisEn(nodo);
            });
        });
    }).observe(document.body, { childList: true, subtree: true });
}
