// Autenticación: login con Google, login con email/contraseña (para quien
// no tiene o no quiere usar Gmail), vinculación de contraseña a una cuenta
// de Google existente, y reseteo de contraseña por mail. Más el widget de
// sesión compartido entre las páginas, siguiendo el mismo patrón que
// nav.js: cada página solo dice "quién soy" y este módulo arma el HTML.

import { auth } from './firebase-config.js';
import { avisar, esc } from './ui.js';
import { limpiarGrupoActivo } from './grupos.js';
import { obtenerFotoPerfil } from './perfil.js';
import {
    GoogleAuthProvider,
    EmailAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    linkWithCredential,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile,
    signOut,
    onAuthStateChanged,
    multiFactor,
    TotpMultiFactorGenerator,
    getMultiFactorResolver,
    reauthenticateWithPopup,
    reauthenticateWithCredential,
    deleteUser,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const proveedorGoogle = new GoogleAuthProvider();

export function iniciarSesionConGoogle() {
    return signInWithPopup(auth, proveedorGoogle);
}

export function iniciarSesionConEmail(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export function crearCuentaConEmail(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
}

// Para "olvidé mi contraseña" (todavía no hay sesión) y para "cambiar mi
// contraseña" desde la pantalla de Cuenta (ya con sesión) — es el mismo
// mecanismo: Firebase manda un mail con un link para elegir una nueva.
export function enviarEmailDeReseteo(email) {
    return sendPasswordResetEmail(auth, email);
}

// Le agrega un login por contraseña a la cuenta ya iniciada (por Google,
// normalmente) — mismo uid, mismos grupos y gastos, ahora con una forma
// más de entrar. Es distinto de crearCuentaConEmail(), que arma una cuenta
// nueva separada.
export function vincularContrasena(password) {
    const credencial = EmailAuthProvider.credential(auth.currentUser.email, password);
    return linkWithCredential(auth.currentUser, credencial);
}

export function obtenerMetodosVinculados() {
    if (!auth.currentUser) return [];
    return auth.currentUser.providerData.map(p => p.providerId);
}

export function actualizarNombrePerfil(nombre) {
    return updateProfile(auth.currentUser, { displayName: nombre });
}

export function cerrarSesion() {
    // Si no se limpia, en una compu compartida la próxima persona que
    // inicie sesión arrancaría apuntando al último grupo de quien cerró
    // sesión (aunque no sea miembro — Firestore se lo negaría, pero la
    // pantalla quedaría rota/vacía sin explicación).
    limpiarGrupoActivo();
    return signOut(auth);
}

// --- Eliminar cuenta ---
//
// Firebase exige un login "reciente" para operaciones sensibles como
// borrar la cuenta — si la sesión actual ya tiene un rato, deleteUser()
// de acá abajo tira auth/requires-recent-login en vez de borrar. Por eso
// se pide reautenticarse justo antes: con Google (un popup, sin pedir
// nada más) si la cuenta lo tiene vinculado, o con la contraseña si no.
export async function reautenticar(password) {
    const metodos = obtenerMetodosVinculados();
    if (metodos.includes('google.com')) {
        await reauthenticateWithPopup(auth.currentUser, proveedorGoogle);
        return;
    }
    if (!password) {
        throw new Error('Ingresá tu contraseña para confirmar.');
    }
    const credencial = EmailAuthProvider.credential(auth.currentUser.email, password);
    await reauthenticateWithCredential(auth.currentUser, credencial);
}

// Borra la cuenta de Firebase Auth en sí — SOLO la sesión/login, no los
// datos de las apps (eso es borrarTodosLosDatos(), en eliminarCuenta.js).
// Llamar siempre DESPUÉS de reautenticar() y de borrarTodosLosDatos(),
// nunca antes: en cuanto esto termina, el token de sesión deja de ser
// válido y ningún otro pedido a Firestore con la sesión vieja va a
// funcionar más.
export function eliminarCuentaAuth() {
    return deleteUser(auth.currentUser);
}

// --- Verificación de email (requisito de Firebase para poder activar 2FA) ---

export function estaEmailVerificado() {
    return !!auth.currentUser && auth.currentUser.emailVerified;
}

export function enviarVerificacionEmail() {
    return sendEmailVerification(auth.currentUser);
}

// --- 2FA con TOTP (Google Authenticator, Authy, etc.) ---
//
// Flujo de alta (ver cuenta.html): 1) generarSecreto2FA() pide una clave
// nueva; 2) la persona la carga en su app autenticadora y escribe el
// código de 6 dígitos que le aparece; 3) confirmarAlta2FA() valida ese
// código y recién ahí queda activado — así nunca se activa un segundo
// factor que la persona no haya podido configurar de verdad.

export async function generarSecreto2FA() {
    const sesion = await multiFactor(auth.currentUser).getSession();
    return TotpMultiFactorGenerator.generateSecret(sesion);
}

export function confirmarAlta2FA(totpSecret, codigo, nombreFactor) {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, codigo);
    return multiFactor(auth.currentUser).enroll(assertion, nombreFactor);
}

export function obtenerFactoresInscriptos() {
    if (!auth.currentUser) return [];
    return multiFactor(auth.currentUser).enrolledFactors;
}

export function quitar2FA(factorUid) {
    return multiFactor(auth.currentUser).unenroll(factorUid);
}

// Cuando alguien con 2FA activado inicia sesión (con Google o con
// contraseña), Firebase no completa el login: tira un error especial con
// un "resolver" para pedir el segundo factor. Estas tres funciones envuelven
// ese mecanismo para usarlo desde index.html sin repetir la lógica ahí.

export function requiere2FA(error) {
    return error && error.code === 'auth/multi-factor-auth-required';
}

export function obtenerResolver2FA(error) {
    return getMultiFactorResolver(auth, error);
}

export function completarSesionCon2FA(resolver, codigo) {
    const factorInscripto = resolver.hints[0]; // hoy solo soportamos un factor TOTP por cuenta
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(factorInscripto.uid, codigo);
    return resolver.resolveSignIn(assertion);
}

// Firebase tarda un rato corto (unos cientos de ms) en confirmar si ya
// había una sesión guardada — hasta que contesta, cada página muestra lo
// que tenga puesto por defecto en el HTML (ej. el cartel de login en
// Inicio), aunque en realidad SÍ haya sesión. Eso se veía como un flash
// de la pantalla equivocada un instante antes de acomodarse solo. Por
// eso cada página arranca con #pantalla-carga (ver main.css) tapando
// todo, y se saca recién acá, en cuanto Firebase da una respuesta
// definitiva (haya o no sesión) — como esto envuelve a alCambiarSesion,
// alcanza con esto para que valga para todas las páginas que lo usan
// (directo, o a través de requerirSesion).
function ocultarPantallaDeCarga() {
    const pantalla = document.getElementById('pantalla-carga');
    if (!pantalla) return;
    pantalla.classList.add('oculta');
    setTimeout(() => pantalla.remove(), 250);
}

// Avisa cada vez que cambia el estado de sesión (login, logout, o al cargar
// la página con una sesión ya guardada por Firebase). `callback` recibe el
// objeto `user` de Firebase, o `null` si no hay sesión.
export function alCambiarSesion(callback) {
    return onAuthStateChanged(auth, user => {
        ocultarPantallaDeCarga();
        callback(user);
    });
}

// Redirige a index.html si no hay sesión iniciada. Se usa al principio de
// payments.html, division-de-gastos.html, estadisticas.html y cuenta.html:
// esas páginas necesitan un usuario autenticado, así que no tiene sentido
// mostrarlas sin sesión.
//
// A propósito NO usa alCambiarSesion (que ya saca la pantalla de carga):
// acá hay un caso extra — si NO hay sesión, esta página no es la que
// termina mostrándose (se redirige a index.html). Sacar la pantalla de
// carga en ese instante dejaría ver, un parpadeo, el contenido de ESTA
// página protegida mientras la navegación todavía no terminó. Se la deja
// puesta nada más para ese caso; index.html trae la suya propia.
export function requerirSesion(callback) {
    return onAuthStateChanged(auth, user => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        ocultarPantallaDeCarga();
        callback(user);
    });
}

// Traduce los códigos de error de Firebase Auth más comunes a mensajes en
// criollo — los mensajes por defecto vienen en inglés y son bastante
// técnicos para mostrárselos tal cual a alguien cargando un formulario.
export function mensajeDeError(error) {
    const mensajes = {
        'auth/email-already-in-use': 'Ya existe una cuenta con ese email.',
        'auth/invalid-email': 'El email no es válido.',
        'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
        'auth/wrong-password': 'Contraseña incorrecta.',
        'auth/invalid-credential': 'Email o contraseña incorrectos.',
        'auth/user-not-found': 'No existe una cuenta con ese email.',
        'auth/credential-already-in-use': 'Esa contraseña ya está vinculada a otra cuenta.',
        'auth/requires-recent-login': 'Por seguridad, cerrá sesión y volvé a entrar antes de hacer este cambio.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
        'auth/invalid-verification-code': 'El código no es válido o ya venció. Fijate la hora de tu celular y probá con el código actual.',
        'auth/second-factor-already-in-use': 'Esa verificación en dos pasos ya está activada.',
        'auth/unsupported-first-factor': 'Este tipo de cuenta no admite verificación en dos pasos.',
        // Sumados a raíz de un reporte real: un tester tocó "Cambiar
        // contraseña por mail" y le dio error — lo más probable es que
        // haya sido este primero (Firebase bloquea unos minutos después
        // de pedir el mail más de una vez seguida), pero como ninguno de
        // los dos tenía traducción, cualquiera de los dos se veía como
        // un mensaje técnico en inglés sin explicación — se agregan los
        // dos por las dudas.
        'auth/too-many-requests': 'Probaste demasiadas veces seguidas — esperá unos minutos y volvé a intentar.',
        'auth/network-request-failed': 'No se pudo conectar. Revisá tu conexión a internet e intentá de nuevo.',
        'auth/user-disabled': 'Esta cuenta fue deshabilitada.',
        'auth/user-token-expired': 'Tu sesión venció — cerrá sesión y volvé a entrar.',
    };
    return mensajes[error.code] || error.message;
}

// Dibuja el saludo "😊 Fulano" en #auth-placeholder (arriba, junto al ☰) y
// las opciones "⚙ Opciones" / "⏻ Cerrar sesión" en #drawer-auth-placeholder
// (dentro del menú lateral) — ambos creados por nav.js. Si no hay sesión,
// deja el saludo vacío y pone un link "Iniciar sesión" en el menú.
//
// Se separó del listener de abajo (en vez de estar los dos juntos) porque
// hace falta poder volver a dibujar esto SIN que haya un cambio real de
// sesión: updateProfile() (actualizarNombrePerfil, en cuenta.html) cambia
// el nombre en el momento pero no dispara onAuthStateChanged — sin
// refrescarWidgetDeSesion(), el saludo se quedaba mostrando el nombre
// viejo hasta recargar la página.
async function dibujarWidgetDeSesion(paginaActual, user) {
    const saludo = document.getElementById('auth-placeholder');
    const opcionesDrawer = document.getElementById('drawer-auth-placeholder');
    if (!saludo && !opcionesDrawer) return;

    if (!user) {
        if (saludo) saludo.innerHTML = '';
        if (opcionesDrawer) {
            opcionesDrawer.innerHTML = paginaActual === 'index.html'
                ? ''
                : '<a href="index.html" class="drawer-link">Iniciar sesión</a>';
        }
        return;
    }

    if (saludo) {
        // La foto vive en Firestore (usuarios/{uid}.fotoPerfil), no en el
        // `user` de Firebase Auth que llega acá — por eso la lectura
        // aparte. Si todavía no cargó (o no tiene), se ve el 😊 de
        // siempre mientras tanto: no hay flash raro, solo un instante más
        // sin foto en la primera carga de la página.
        const foto = await obtenerFotoPerfil(user.uid).catch(() => null);
        // esc() acá no es solo por las dudas: fotoPerfil es un campo que
        // cualquiera podría escribir directo en su propio documento (no
        // hay forma de que las reglas de Firestore validen que es
        // realmente una imagen) — sin escaparlo, alguien podría guardar
        // ahí HTML/JS que se ejecutaría en la pantalla de sus compañeros
        // de grupo al verlo.
        const avatar = foto
            ? `<img src="${esc(foto)}" class="avatar-chico" alt="">`
            : '😊';
        saludo.innerHTML = `${avatar} ${esc(user.displayName || user.email)}`;
    }

    if (opcionesDrawer) {
        // ?app=comfy nada más para sistema.html (ComfyApp) — así
        // cuenta.html sabe abrirse con SU tema propio y mostrar sus
        // notificaciones (que por ahora no tiene ninguna propia, ver el
        // comentario grande en cuenta.html). El resto de las páginas de
        // GastosApp no necesitan el parámetro — "gastos" ya es el valor
        // por defecto de cuenta.html.
        const linkCuenta = paginaActual === 'cuenta.html'
            ? ''
            : paginaActual === 'sistema.html'
                ? '<a href="cuenta.html?app=comfy" class="drawer-link">⚙ Opciones</a>'
                : '<a href="cuenta.html" class="drawer-link">⚙ Opciones</a>';

        opcionesDrawer.innerHTML = `
            ${linkCuenta}
            <button type="button" id="boton-logout" class="drawer-link peligro">⏻ Cerrar sesión</button>
        `;
        document.getElementById('boton-logout').addEventListener('click', () => cerrarSesion());
    }
}

let paginaDelWidget = null;

export function iniciarWidgetDeSesion(paginaActual) {
    paginaDelWidget = paginaActual;
    alCambiarSesion(user => dibujarWidgetDeSesion(paginaActual, user));
}

// La llama cuenta.html después de guardar un nombre nuevo, para que el
// saludo de arriba quede al día sin esperar a la próxima navegación.
export function refrescarWidgetDeSesion() {
    if (!paginaDelWidget) return;
    dibujarWidgetDeSesion(paginaDelWidget, auth.currentUser);
}
