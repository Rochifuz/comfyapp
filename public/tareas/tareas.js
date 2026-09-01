// TareasApp — 5ta app del mega sistema. A propósito INDEPENDIENTE de
// GastosApp (no reutiliza grupos.js ni sus colecciones de Firestore): sus
// propios grupos ("tareasGrupos"), su propia lista personal
// ("tareasPersonales"). El único punto en común con el resto del sistema
// es la sesión de Firebase Auth (compartida sola, por dominio) y el
// centro de notificaciones (ver notificacionesCentro.js — acá se usa
// para avisar "te asignaron una tarea"/"la completaron").
//
// Cada tarea (personal o de grupo) tiene la misma forma:
// { titulo, descripcion, fechaVencimiento (string "YYYY-MM-DD" u null),
//   completada, completadaEn, creadaEn, avisar, avisarDiasAntes,
//   avisarRepetir, ultimoAvisoEn }. Las de grupo suman además
// `asignadoA` (uid de un miembro, o null = "cualquiera") y `creadaPor`.
//
// El aviso de "esta tarea está por vencer" es OPCIONAL y configurable
// (a pedido de Roy — cada tarea decide si lo quiere, con cuánta
// anticipación, y si una sola vez o repetido — no es automático como
// "te asignaron"/"la completaron"):
//   - `avisar`: prendido/apagado, lo tilda quien crea/edita la tarea.
//   - `avisarDiasAntes`: 0 = el mismo día que vence, 1/2/3/7 = esa
//     cantidad de días antes.
//   - `avisarRepetir`: false = un solo aviso; true = uno por día (como
//     mucho) desde que se cumple avisarDiasAntes hasta que se completa.
//   - `ultimoAvisoEn`: campo interno (nunca se toca desde la UI), la
//     fecha ("YYYY-MM-DD", hora LOCAL) del último aviso mandado — se
//     guarda en la propia tarea, en Firestore (no en localStorage como
//     en AgendaApp), para que no dependa de qué dispositivo la revisa
//     primero. Ver avisarTareasPorVencer(), más abajo.

import { db } from '../firebase-config.js';
import { notificarA, notificarme } from '../notificacionesCentro.js';
import {
    collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, orderBy, onSnapshot, arrayUnion, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function nombreDeUsuario(user) {
    return user.displayName || user.email || 'Sin nombre';
}

// --- Tareas personales (tareasPersonales/{uid}/tareas) ---

function coleccionTareasPersonales(uid) {
    return collection(db, 'tareasPersonales', uid, 'tareas');
}

export function agregarTareaPersonal(uid, datos) {
    return addDoc(coleccionTareasPersonales(uid), {
        titulo: datos.titulo,
        descripcion: datos.descripcion || null,
        fechaVencimiento: datos.fechaVencimiento || null,
        avisar: !!datos.avisar,
        avisarDiasAntes: datos.avisar ? (datos.avisarDiasAntes || 0) : 0,
        avisarRepetir: datos.avisar ? !!datos.avisarRepetir : false,
        ultimoAvisoEn: null,
        completada: false,
        creadaEn: serverTimestamp(),
        completadaEn: null,
    });
}

// Editar la tarea "rearma" el aviso (ultimoAvisoEn vuelve a null) — así
// si alguien cambia la fecha de vencimiento después de que ya se avisó,
// vuelve a avisar en la fecha nueva en vez de quedarse callado para
// siempre.
export function actualizarTareaPersonal(uid, tareaId, datos) {
    return updateDoc(doc(db, 'tareasPersonales', uid, 'tareas', tareaId), {
        titulo: datos.titulo,
        descripcion: datos.descripcion || null,
        fechaVencimiento: datos.fechaVencimiento || null,
        avisar: !!datos.avisar,
        avisarDiasAntes: datos.avisar ? (datos.avisarDiasAntes || 0) : 0,
        avisarRepetir: datos.avisar ? !!datos.avisarRepetir : false,
        ultimoAvisoEn: null,
    });
}

export function marcarTareaPersonalCompletada(uid, tareaId, completada) {
    return updateDoc(doc(db, 'tareasPersonales', uid, 'tareas', tareaId), {
        completada,
        completadaEn: completada ? serverTimestamp() : null,
    });
}

export function eliminarTareaPersonal(uid, tareaId) {
    return deleteDoc(doc(db, 'tareasPersonales', uid, 'tareas', tareaId));
}

export function escucharTareasPersonales(uid, callback) {
    const q = query(coleccionTareasPersonales(uid), orderBy('creadaEn', 'desc'));
    return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// --- Grupos de TareasApp (tareasGrupos/{codigo}) ---
//
// El código de invitación (6 caracteres) ES el id del documento — mismo
// criterio que torneos/{codigo} de GamingApp, no hace falta una
// colección de mapeo aparte como invitaciones/{codigo} de GastosApp.

const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L, para que sea fácil de dictar o tipear

function generarCodigo() {
    let codigo = '';
    for (let i = 0; i < 6; i++) {
        codigo += ALFABETO_CODIGO[Math.floor(Math.random() * ALFABETO_CODIGO.length)];
    }
    return codigo;
}

// Sin este chequeo, un código repetido pisaría en silencio el grupo de
// otra persona. El tope de intentos es solo para no colgarse en el caso
// patológico de que algo esté mal — nunca debería hacer falta más de uno.
async function generarCodigoUnico() {
    for (let intento = 0; intento < 10; intento++) {
        const codigo = generarCodigo();
        const yaExiste = (await getDoc(doc(db, 'tareasGrupos', codigo))).exists();
        if (!yaExiste) return codigo;
    }
    throw new Error('No se pudo generar un código de grupo único — probá de nuevo.');
}

// Denormalizado en tareasPersonales/{uid}.grupos (mismo motivo que
// usuarios/{uid}.grupos en GastosApp): mostrar "Tus grupos" sin tener
// que guardar/consultar todos los grupos de tareas que existen.
async function agregarGrupoAlUsuario(uid, grupo) {
    const ref = doc(db, 'tareasPersonales', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
        await updateDoc(ref, { grupos: arrayUnion(grupo) });
    } else {
        await setDoc(ref, { grupos: [grupo] });
    }
}

export async function crearGrupoTareas(user, nombre) {
    const codigo = await generarCodigoUnico();
    await setDoc(doc(db, 'tareasGrupos', codigo), {
        nombre,
        miembros: [user.uid],
        nombresPorUid: { [user.uid]: nombreDeUsuario(user) },
        creadoPor: user.uid,
        creadoEn: serverTimestamp(),
    });
    await agregarGrupoAlUsuario(user.uid, { codigo, nombre });
    return codigo;
}

export async function unirseAGrupoTareas(user, codigoIngresado) {
    const codigo = codigoIngresado.trim().toUpperCase();
    const ref = doc(db, 'tareasGrupos', codigo);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('No existe ningún grupo de tareas con ese código.');

    const grupo = snap.data();
    if (grupo.miembros.includes(user.uid)) {
        // Ya está adentro (ej. volvió a poner el mismo código) — no hay
        // nada que hacer, pero tampoco es un error.
        return { codigo, nombre: grupo.nombre };
    }
    await updateDoc(ref, {
        miembros: arrayUnion(user.uid),
        [`nombresPorUid.${user.uid}`]: nombreDeUsuario(user),
    });
    await agregarGrupoAlUsuario(user.uid, { codigo, nombre: grupo.nombre });
    return { codigo, nombre: grupo.nombre };
}

export async function obtenerMisGruposTareas(uid) {
    const snap = await getDoc(doc(db, 'tareasPersonales', uid));
    return snap.exists() ? (snap.data().grupos || []) : [];
}

// --- Preferencias de notificaciones "te asignaron"/"la completaron" ---
//
// Mismo espíritu que las de GastosApp (ver perfil.js/cuenta.html):
// prendidas por defecto, configurables desde tareas/index.html. Al
// "asignada" y "completada" las dispara OTRO integrante del grupo, así
// que hace falta la misma denormalización que "deudaSaldada" en
// GastosApp — se copian en `preferenciasPorUid.{uid}` de CADA grupo de
// tareas del que formás parte (ver actualizarPreferenciasNotifEnMisGruposTareas).
const PREFERENCIAS_NOTIF_TAREAS_DEFAULT = { tareaAsignada: true, tareaCompletada: true };

export async function obtenerPreferenciasNotifTareas(uid) {
    const snap = await getDoc(doc(db, 'tareasPersonales', uid));
    const guardadas = snap.exists() ? (snap.data().preferenciasNotif || {}) : {};
    return { ...PREFERENCIAS_NOTIF_TAREAS_DEFAULT, ...guardadas };
}

export async function guardarPreferenciasNotifTareas(uid, preferencias) {
    await setDoc(doc(db, 'tareasPersonales', uid), { preferenciasNotif: preferencias }, { merge: true });
    // Se propaga a cada grupo — mismo motivo que
    // actualizarPreferenciaDeudaSaldadaEnMisGrupos() en grupos.js: quien
    // te asigna/completa una tarea es otro usuario, y sus reglas de
    // Firestore no le dejan leer tu tareasPersonales/{uid} privado.
    const grupos = await obtenerMisGruposTareas(uid);
    await Promise.all(grupos.map(g =>
        updateDoc(doc(db, 'tareasGrupos', g.codigo), { [`preferenciasPorUid.${uid}`]: preferencias })
    ));
}

export async function obtenerGrupoTareas(codigo) {
    const snap = await getDoc(doc(db, 'tareasGrupos', codigo));
    return snap.exists() ? { codigo, ...snap.data() } : null;
}

// Tiempo real (nombre, miembros) — avisa con null si el grupo no existe
// (se borró) en vez de quedarse calladito, mismo criterio que
// escucharGrupo() de grupos.js.
export function escucharGrupoTareas(codigo, callback) {
    return onSnapshot(doc(db, 'tareasGrupos', codigo), snap => {
        callback(snap.exists() ? { codigo, ...snap.data() } : null);
    });
}

// Saca un grupo de "Tus grupos" sin tocar el grupo en sí — mismo criterio
// que quitarGrupoDeMisGrupos() de grupos.js, para cuando se descubre que
// un grupo guardado ya no existe.
export async function quitarGrupoDeMisGruposTareas(uid, codigo) {
    const grupos = await obtenerMisGruposTareas(uid);
    const nuevos = grupos.filter(g => g.codigo !== codigo);
    if (nuevos.length === grupos.length) return;
    await updateDoc(doc(db, 'tareasPersonales', uid), { grupos: nuevos });
}

// Borra el grupo entero: sus tareas y el documento del grupo en sí.
// Cualquier integrante puede hacerlo (mismo nivel de confianza que el
// resto del mega sistema). OJO: a los demás miembros no se les puede
// sacar de su propia lista "Tus grupos" desde acá (las reglas no dejan
// editar el tareasPersonales/{uid} de otra persona) — les queda una
// entrada que ya no funciona hasta que la abran y se limpie sola (ver
// quitarGrupoDeMisGruposTareas, más arriba).
export async function eliminarGrupoTareas(codigo) {
    const tareasSnap = await getDocs(collection(db, 'tareasGrupos', codigo, 'tareas'));
    await Promise.all(tareasSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'tareasGrupos', codigo));
}

// --- Tareas de grupo (tareasGrupos/{codigo}/tareas) ---

function coleccionTareasGrupo(codigo) {
    return collection(db, 'tareasGrupos', codigo, 'tareas');
}

// Le avisa al miembro asignado (campanita 🔔, ver notificacionesCentro.js)
// — un error acá (ej. sin conexión) no debería tirar abajo la
// creación/edición de la tarea ya guardada, por eso el try/catch en vez
// de dejarlo explotar.
async function avisarTareaAsignada(codigo, uidAsignado, tituloTarea, usuarioActual) {
    try {
        const grupo = await obtenerGrupoTareas(codigo);
        // Respeta la preferencia de quien RECIBE la asignación
        // (configurable en tareas/index.html) — "!== false" porque
        // grupos viejos, o alguien que nunca la tocó, todavía no tienen
        // este campo guardado: por defecto avisa igual.
        if (grupo?.preferenciasPorUid?.[uidAsignado]?.tareaAsignada === false) return;
        await notificarA(uidAsignado, {
            tipo: 'tarea-asignada',
            titulo: '📋 Te asignaron una tarea',
            cuerpo: `${nombreDeUsuario(usuarioActual)} te asignó "${tituloTarea}" en ${grupo?.nombre || 'un grupo'}`,
            destino: `/tareas/grupo.html?codigo=${codigo}`,
            grupoId: codigo,
        });
    } catch (error) {
        console.error('No se pudo avisar de la tarea asignada:', error);
    }
}

export async function agregarTareaGrupo(codigo, datos, usuarioActual) {
    const ref = await addDoc(coleccionTareasGrupo(codigo), {
        titulo: datos.titulo,
        descripcion: datos.descripcion || null,
        fechaVencimiento: datos.fechaVencimiento || null,
        asignadoA: datos.asignadoA || null,
        avisar: !!datos.avisar,
        avisarDiasAntes: datos.avisar ? (datos.avisarDiasAntes || 0) : 0,
        avisarRepetir: datos.avisar ? !!datos.avisarRepetir : false,
        ultimoAvisoEn: null,
        completada: false,
        creadaPor: usuarioActual.uid,
        creadaEn: serverTimestamp(),
        completadaEn: null,
    });
    if (datos.asignadoA && datos.asignadoA !== usuarioActual.uid) {
        await avisarTareaAsignada(codigo, datos.asignadoA, datos.titulo, usuarioActual);
    }
    return ref.id;
}

// `tareaAnterior`: la tarea tal cual estaba ANTES de este cambio (ya la
// tiene quien llama, del listener de escucharTareasGrupo) — se usa nada
// más para no volver a avisar "te asignaron" si asignadoA no cambió de
// verdad (ej. se editó solo la descripción). Igual que en las
// personales, editar rearma el aviso de vencimiento (ultimoAvisoEn
// vuelve a null).
export async function actualizarTareaGrupo(codigo, tareaAnterior, datos, usuarioActual) {
    await updateDoc(doc(db, 'tareasGrupos', codigo, 'tareas', tareaAnterior.id), {
        titulo: datos.titulo,
        descripcion: datos.descripcion || null,
        fechaVencimiento: datos.fechaVencimiento || null,
        asignadoA: datos.asignadoA || null,
        avisar: !!datos.avisar,
        avisarDiasAntes: datos.avisar ? (datos.avisarDiasAntes || 0) : 0,
        avisarRepetir: datos.avisar ? !!datos.avisarRepetir : false,
        ultimoAvisoEn: null,
    });
    if (datos.asignadoA && datos.asignadoA !== tareaAnterior.asignadoA && datos.asignadoA !== usuarioActual.uid) {
        await avisarTareaAsignada(codigo, datos.asignadoA, datos.titulo, usuarioActual);
    }
}

// Le avisa a quien CREÓ la tarea que ya se completó (si no fue ella
// misma quien la completó) — mismo espíritu que el aviso de "deuda
// saldada" de GastosApp: quien pidió que se haga algo se entera solo,
// sin tener que estar revisando el grupo.
export async function marcarTareaGrupoCompletada(codigo, tarea, completada, usuarioActual) {
    await updateDoc(doc(db, 'tareasGrupos', codigo, 'tareas', tarea.id), {
        completada,
        completadaEn: completada ? serverTimestamp() : null,
    });
    if (completada && tarea.creadaPor && tarea.creadaPor !== usuarioActual.uid) {
        try {
            const grupo = await obtenerGrupoTareas(codigo);
            // Mismo criterio que avisarTareaAsignada(): respeta la
            // preferencia de quien creó la tarea.
            if (grupo?.preferenciasPorUid?.[tarea.creadaPor]?.tareaCompletada === false) return;
            await notificarA(tarea.creadaPor, {
                tipo: 'tarea-completada',
                titulo: '✅ Tarea completada',
                cuerpo: `${nombreDeUsuario(usuarioActual)} completó "${tarea.titulo}" en ${grupo?.nombre || 'un grupo'}`,
                destino: `/tareas/grupo.html?codigo=${codigo}`,
                grupoId: codigo,
            });
        } catch (error) {
            console.error('No se pudo avisar de la tarea completada:', error);
        }
    }
}

export function eliminarTareaGrupo(codigo, tareaId) {
    return deleteDoc(doc(db, 'tareasGrupos', codigo, 'tareas', tareaId));
}

export function escucharTareasGrupo(codigo, callback) {
    const q = query(coleccionTareasGrupo(codigo), orderBy('creadaEn', 'desc'));
    return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// --- Para el widget de notitas de ComfyApp (ver sistema.html) ---
//
// Junta en una sola lista TODAS las tareas pendientes de esta persona:
// las personales, más las de cada grupo del que forma parte que estén
// SIN asignar o asignadas a ella (nunca las asignadas a otro miembro —
// esas no son "lo mío"). Es una lectura de una sola vez (no en tiempo
// real): el widget se arma al entrar a ComfyApp, no hace falta que se
// actualice sola mientras se lo mira.
export async function obtenerTareasPendientes(uid) {
    const personalesSnap = await getDocs(query(coleccionTareasPersonales(uid), where('completada', '==', false)));
    const personales = personalesSnap.docs.map(d => ({
        id: d.id, ...d.data(), origen: 'personal', origenNombre: 'Personal', origenCodigo: null,
    }));

    const misGrupos = await obtenerMisGruposTareas(uid);
    const porGrupo = await Promise.all(misGrupos.map(async (g) => {
        try {
            const snap = await getDocs(query(coleccionTareasGrupo(g.codigo), where('completada', '==', false)));
            return snap.docs
                .map(d => ({ id: d.id, ...d.data(), origen: 'grupo', origenNombre: g.nombre, origenCodigo: g.codigo }))
                .filter(t => !t.asignadoA || t.asignadoA === uid);
        } catch {
            return []; // grupo borrado o sin acceso — no debería tirar abajo el resto del widget
        }
    }));

    const todas = [...personales, ...porGrupo.flat()];
    // Las que tienen fecha de vencimiento van primero (la más próxima
    // primero) — las sin fecha, al final, en el orden en que se cargaron.
    todas.sort((a, b) => {
        if (a.fechaVencimiento && b.fechaVencimiento) return a.fechaVencimiento.localeCompare(b.fechaVencimiento);
        if (a.fechaVencimiento) return -1;
        if (b.fechaVencimiento) return 1;
        return 0;
    });
    return todas;
}

// --- Aviso opcional de "esta tarea está por vencer" ---
//
// Solo revisa las tareas con `avisar: true` (tildado a mano al crear/
// editar, ver tareas/index.html y grupo.html) — a diferencia de "te
// asignaron"/"la completaron" (que son inmediatos y siempre activos),
// este es opcional Y configurable: cada quien decide, tarea por tarea,
// si lo quiere, con cuánta anticipación (avisarDiasAntes) y si una sola
// vez o repetido todos los días (avisarRepetir).
//
// "YYYY-MM-DD" en horario LOCAL — mismo motivo que en el resto de la
// app (new Date("YYYY-MM-DD") a secas se toma como UTC, corriendo un
// día en Argentina).
function hoyTextoLocal() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function corresponeAvisarHoy(tarea) {
    if (!tarea.avisar || tarea.completada || !tarea.fechaVencimiento) return false;

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const umbral = new Date(tarea.fechaVencimiento + 'T00:00:00');
    umbral.setDate(umbral.getDate() - (tarea.avisarDiasAntes || 0));
    if (umbral > hoy) return false; // todavía no llegó el momento de avisar

    if (!tarea.avisarRepetir) {
        // Una sola vez: si ya se avisó alguna vez, no de nuevo. El "||
        // tarea.avisoEnviado" es compatibilidad con tareas creadas antes
        // de que existiera avisarDiasAntes/avisarRepetir (ese campo viejo
        // ya no se escribe, pero las tareas de ese momento lo tienen).
        return !(tarea.ultimoAvisoEn || tarea.avisoEnviado);
    }
    return tarea.ultimoAvisoEn !== hoyTextoLocal(); // repetido: como mucho un aviso por día
}

// "vence hoy" / "vence en 2 días" (si se está avisando con anticipación)
// / "venció hace 1 día" (si nadie la completó después de vencida y el
// aviso sigue repitiendo) — más claro que un "vence hoy" fijo ahora que
// el aviso puede llegar en cualquiera de esas tres situaciones.
function textoDiasVencimiento(tarea) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(tarea.fechaVencimiento + 'T00:00:00');
    const dias = Math.round((fecha - hoy) / 86400000);
    if (dias === 0) return 'vence hoy';
    if (dias > 0) return `vence en ${dias} día${dias === 1 ? '' : 's'}`;
    const atraso = -dias;
    return `venció hace ${atraso} día${atraso === 1 ? '' : 's'}`;
}

// Se llama una vez al entrar a TareasApp (index.html/grupo.html) o al
// widget de notitas de ComfyApp — revisa personales + las de cada grupo,
// y por cada una que corresponda avisar hoy, manda el aviso y guarda
// hoy en `ultimoAvisoEn` (en la propia tarea, en Firestore, para que no
// dependa de qué dispositivo la revisó primero ni se repita de más).
export async function avisarTareasPorVencer(uid) {
    const hoyTexto = hoyTextoLocal();

    const personalesSnap = await getDocs(query(coleccionTareasPersonales(uid), where('completada', '==', false)));
    for (const d of personalesSnap.docs) {
        const tarea = { id: d.id, ...d.data() };
        if (!corresponeAvisarHoy(tarea)) continue;
        try {
            await notificarme({
                tipo: 'tarea-por-vencer',
                titulo: '🗒️ Tarea por vencer',
                cuerpo: `"${tarea.titulo}" ${textoDiasVencimiento(tarea)}`,
                destino: '/tareas/index.html',
            });
            await updateDoc(d.ref, { ultimoAvisoEn: hoyTexto });
        } catch (error) {
            console.error('No se pudo avisar del vencimiento de una tarea personal:', error);
        }
    }

    const misGrupos = await obtenerMisGruposTareas(uid);
    for (const g of misGrupos) {
        let snap;
        try {
            snap = await getDocs(query(coleccionTareasGrupo(g.codigo), where('completada', '==', false)));
        } catch {
            continue; // grupo borrado o sin acceso — no debería tirar abajo el resto
        }
        for (const d of snap.docs) {
            const tarea = { id: d.id, ...d.data() };
            if (!corresponeAvisarHoy(tarea)) continue;
            // Le corresponde a quien está asignada, o a quien la creó si
            // es "para cualquiera" — y solo SI ese soy yo: así cada
            // integrante dispara (y paga) su propio aviso al entrar a la
            // app, en vez de que uno solo termine avisando por todos los
            // demás miembros del grupo.
            const destinatario = tarea.asignadoA || tarea.creadaPor;
            if (destinatario !== uid) continue;
            try {
                await notificarme({
                    tipo: 'tarea-por-vencer',
                    titulo: '🗒️ Tarea por vencer',
                    cuerpo: `"${tarea.titulo}" ${textoDiasVencimiento(tarea)} en ${g.nombre}`,
                    destino: `/tareas/grupo.html?codigo=${g.codigo}`,
                });
                await updateDoc(d.ref, { ultimoAvisoEn: hoyTexto });
            } catch (error) {
                console.error('No se pudo avisar del vencimiento de una tarea de grupo:', error);
            }
        }
    }
}
