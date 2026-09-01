// Tema oscuro (negro/dorado, el look por defecto de la app) con opción a
// modo claro. Se guarda en localStorage porque es una preferencia del
// dispositivo, no un dato de cuenta.
//
// El <head> de cada página llama a aplicarTemaInicial() en un <script>
// SIN type="module" y ANTES de cargar el CSS/resto de la página, para que
// el tema correcto quede puesto desde el primer frame (si se hiciera
// después, se vería un flash con el tema equivocado un instante).

const CLAVE_TEMA = 'tema';

export function obtenerTema() {
    return localStorage.getItem(CLAVE_TEMA) || 'oscuro';
}

export function aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    // sl-theme-dark es la clase que usan los componentes de Shoelace
    // (el menú lateral, su switch de tema) para pasar a modo oscuro —
    // se mantiene sincronizada con nuestro propio data-tema.
    document.documentElement.classList.toggle('sl-theme-dark', tema === 'oscuro');
    localStorage.setItem(CLAVE_TEMA, tema);

    // Puede haber más de un control de tema visible a la vez en la misma
    // página (el switch del menú lateral + los tabs de Cuenta > Apariencia,
    // por ejemplo) — antes cada uno solo se actualizaba a sí mismo al
    // tocarlo, así que cambiar uno dejaba al otro mostrando el valor
    // viejo. Avisando acá con un evento, cualquier control que escuche
    // "tema-cambiado" se mantiene al día sin importar cuál lo disparó.
    document.dispatchEvent(new CustomEvent('tema-cambiado', { detail: { tema } }));
}

// Se llama inline, ver comentario de arriba.
export function aplicarTemaInicial() {
    aplicarTema(obtenerTema());
}
