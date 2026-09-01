// Sistema de permisos por app del mega sistema (GastosApp/ComfyApp
// siempre disponibles, GamingApp/AgendaApp/TareasApp opcionales) —
// permite controlar el onboarding de gente nueva sin darle acceso a
// todo de entrada.
//
// Modelo de datos: `usuarios/{uid}.appsPermitidas` (array de strings,
// valores 'gaming'/'agenda'/'tareas'). Dos casos:
//   - El campo NO EXISTE -> acceso TOTAL. A propósito: así los
//     usuarios de antes de este sistema (toda la Alpha hasta ahora)
//     quedan con acceso a todo sin necesitar ninguna migración — la
//     AUSENCIA del campo es justamente el estado "todavía no se le
//     restringió nada".
//   - El campo SÍ EXISTE (array, puede ser vacío) -> se respeta tal
//     cual. Un usuario nuevo (primer login de su vida) se crea
//     explícitamente con `appsPermitidas: []` (ver marcarLoginYPermisos
//     más abajo) — arranca solo con GastosApp hasta que se le sume
//     algo desde el panel de admin.
//
// Este gate es de PRODUCTO/onboarding, no de seguridad de datos: por
// eso se resuelve acá (cliente) y en las funciones requerirSesion* de
// cada app, NO en firestore.rules — sería la propia cuenta viendo sus
// propios datos un poco antes de lo que "debería", no una fuga real de
// información de otra persona. Mantenerlo así de simple evita reglas
// más frágiles para un caso que no lo amerita.
import { db } from './firebase-config.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export const APPS = ['gaming', 'agenda', 'tareas'];

// null = acceso total (usuario viejo, sin el campo) — se distingue
// explícitamente de un array vacío real (usuario nuevo, sin nada
// habilitado todavía).
export async function obtenerAppsPermitidas(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    const datos = snap.data();
    if (!datos || datos.appsPermitidas === undefined) return null;
    return datos.appsPermitidas;
}

export function tienePermiso(appsPermitidas, app) {
    if (appsPermitidas === null) return true; // acceso total (usuario viejo)
    return appsPermitidas.includes(app);
}

// Se llama una vez por sesión, apenas hay usuario autenticado (desde
// sistema.html, el punto de entrada del mega sistema — ver
// "Login siempre termina en ComfyApp" en la memoria del proyecto).
// Hace 2 cosas de una:
//   1) Si es la primerísima vez que esta cuenta inicia sesión (Firebase
//      Auth expone esto comparando creationTime con lastSignInTime —
//      truco estándar, no hace falta guardar un flag propio), le fija
//      appsPermitidas:[] explícito -> arranca solo con GastosApp.
//   2) Guarda nombre/email de display en el perfil — hoy `usuarios/
//      {uid}` no tiene ninguno de los dos (todo lo demás se identifica
//      por UID), así que el panel de admin no tenía forma de mostrar
//      "quién es quién" sin ir a buscarlo a mano a Firebase Console.
//      Se pisa en CADA login (no solo el primero) para que quede
//      actualizado si la persona cambia su nombre en Google, por ej.
export async function marcarLoginYPermisos(user) {
    const esPrimeraVezDeSuVida = user.metadata.creationTime === user.metadata.lastSignInTime;
    const datos = {
        nombreMostrar: user.displayName || null,
        email: user.email || null,
    };
    if (esPrimeraVezDeSuVida) datos.appsPermitidas = [];
    await setDoc(doc(db, 'usuarios', user.uid), datos, { merge: true });
}
