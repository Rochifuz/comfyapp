// Gestión de "grupos" (el equivalente a una casa/grupo de amigos que
// divide gastos entre sí). Cada usuario puede pertenecer a varios grupos;
// el "grupo activo" (con cuál se trabaja en division-de-gastos.html) se
// guarda en localStorage porque es solo una preferencia de navegación, no
// un dato que haga falta compartir ni sincronizar entre dispositivos.
//
// Cada grupo guarda dos cosas sobre sus miembros: `miembros` (array de
// uids — lo que usan las reglas de seguridad de Firestore para decidir
// quién puede leer/escribir) y `nombresPorUid` (mapa uid → nombre para
// mostrar, ej. en los selectores de "quién pagó"). Se guardan separadas
// porque las reglas de seguridad necesitan el array simple de uids.

import { db } from './firebase-config.js';
import { avisar, esc, copiarAlPortapapeles } from './ui.js';
import {
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    arrayUnion,
    serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const CLAVE_GRUPO_ID = 'grupoActivoId';
const CLAVE_GRUPO_NOMBRE = 'grupoActivoNombre';

function generarCodigoInvitacion() {
    // Sin caracteres ambiguos (0/O, 1/I/L) para que sea fácil de dictar o
    // tipear a mano cuando alguien comparte el código con su grupo.
    const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) {
        codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    }
    return codigo;
}

// crearGrupo() guarda el código directo en invitaciones/{codigo} con
// setDoc (sin merge) — sin este chequeo previo, un código repetido
// pisaría en silencio el de otro grupo ya existente, que se quedaría
// con una invitación apuntando al grupo equivocado. Con 32^6 (~1070
// millones) de combinaciones la chance real es mínima, pero es gratis
// de evitar del todo. El tope de intentos es solo para no colgarse en
// el caso patológico de que algo esté mal (ej. las reglas de Firestore
// bloqueando la lectura) — nunca debería hacer falta más de uno o dos.
async function generarCodigoInvitacionUnico() {
    for (let intento = 0; intento < 10; intento++) {
        const codigo = generarCodigoInvitacion();
        const yaExiste = (await getDoc(doc(db, 'invitaciones', codigo))).exists();
        if (!yaExiste) return codigo;
    }
    throw new Error('No se pudo generar un código de invitación único — probá de nuevo.');
}

function nombreDeUsuario(user) {
    return user.displayName || user.email || 'Sin nombre';
}

// Auto-reparación para grupos viejos, creados antes de que existiera
// nombresPorUid: si alguien entra a un grupo del que es miembro pero su
// nombre no está guardado ahí, se completa solo con su nombre actual. Así
// no queda ausente de los selectores de "quién pagó" para siempre.
export function asegurarNombrePropioEnGrupo(grupoId, user) {
    return updateDoc(doc(db, 'grupos', grupoId), {
        [`nombresPorUid.${user.uid}`]: nombreDeUsuario(user),
    });
}

// --- Integrantes "sin cuenta" ---
//
// Para anotar un gasto con alguien que no tiene (o no quiere) la app: se
// le suma a `nombresPorUid` con un id sintético en vez de un uid real de
// Firebase, así entra en los selectores de "quién pagó"/"se divide
// entre" y en el cálculo de balances exactamente igual que cualquier
// otro integrante — no hace falta ningún caso especial en esa lógica,
// ya funciona sobre claves de un mapa, no específicamente sobre uids.
//
// A propósito NO se lo agrega a `miembros` (el array que usan las reglas
// de seguridad): nunca va a poder loguearse para hacerlo por su cuenta,
// así que no tiene sentido tratarlo como si pudiera. Lo sigue
// administrando quien sí tiene la cuenta abierta.
const PREFIJO_INVITADO = 'invitado_';

export function esInvitado(uid) {
    return typeof uid === 'string' && uid.startsWith(PREFIJO_INVITADO);
}

export function agregarIntegranteInvitado(grupoId, nombre) {
    const id = PREFIJO_INVITADO + crypto.randomUUID();
    return updateDoc(doc(db, 'grupos', grupoId), {
        [`nombresPorUid.${id}`]: nombre.trim(),
    });
}

// Un grupo "de verdad" se recuerda siempre (localStorage, sobrevive a
// cerrar el navegador) — una Cuenta rápida solo se recuerda mientras dure
// la pestaña (sessionStorage): es "para el momento", no tiene sentido
// que te reciba una cuenta rápida de hace dos semanas cada vez que
// volvés a abrir la app.
export function guardarGrupoActivo(id, nombre, { esCuentaRapida = false } = {}) {
    if (esCuentaRapida) {
        sessionStorage.setItem(CLAVE_GRUPO_ID, id);
        sessionStorage.setItem(CLAVE_GRUPO_NOMBRE, nombre);
        return;
    }
    // Elegir un grupo de verdad reemplaza a una cuenta rápida que
    // hubiera quedado activa en esta pestaña — si no, como
    // obtenerGrupoActivo() prioriza sessionStorage, seguiría ganando la
    // cuenta rápida vieja en la próxima recarga.
    sessionStorage.removeItem(CLAVE_GRUPO_ID);
    sessionStorage.removeItem(CLAVE_GRUPO_NOMBRE);
    localStorage.setItem(CLAVE_GRUPO_ID, id);
    localStorage.setItem(CLAVE_GRUPO_NOMBRE, nombre);
}

export function obtenerGrupoActivo() {
    const idSesion = sessionStorage.getItem(CLAVE_GRUPO_ID);
    if (idSesion) return { id: idSesion, nombre: sessionStorage.getItem(CLAVE_GRUPO_NOMBRE) };
    const id = localStorage.getItem(CLAVE_GRUPO_ID);
    const nombre = localStorage.getItem(CLAVE_GRUPO_NOMBRE);
    return id ? { id, nombre } : null;
}

export function limpiarGrupoActivo() {
    sessionStorage.removeItem(CLAVE_GRUPO_ID);
    sessionStorage.removeItem(CLAVE_GRUPO_NOMBRE);
    localStorage.removeItem(CLAVE_GRUPO_ID);
    localStorage.removeItem(CLAVE_GRUPO_NOMBRE);
}

async function agregarGrupoAlUsuario(uid, grupo) {
    // merge: true porque puede ser la primera vez que este usuario escribe
    // en usuarios/{uid} (recién se está creando el documento).
    const refUsuario = doc(db, 'usuarios', uid);
    const snap = await getDoc(refUsuario);
    if (snap.exists()) {
        await updateDoc(refUsuario, { grupos: arrayUnion(grupo) });
    } else {
        await setDoc(refUsuario, { grupos: [grupo] });
    }
}

// `guardarEnMisGrupos: false` es lo que usa crearCuentaRapida() más abajo:
// el grupo se crea igual que cualquier otro (con su código de invitación,
// en tiempo real, invitable), pero no queda anotado en usuarios/{uid} —
// así no aparece en "Tus grupos" ni acá ni en el inicio. Sigue existiendo
// en Firestore y se puede volver a entrar con el código, pero no queda
// "guardado" para la próxima vez.
export async function crearGrupo(user, nombre, { guardarEnMisGrupos = true } = {}) {
    const refGrupo = doc(collection(db, 'grupos'));
    const codigoInvitacion = await generarCodigoInvitacionUnico();

    await setDoc(refGrupo, {
        nombre,
        miembros: [user.uid],
        nombresPorUid: { [user.uid]: nombreDeUsuario(user) },
        creadoPor: user.uid,
        codigoInvitacion,
        esCuentaRapida: !guardarEnMisGrupos,
        creadoEn: serverTimestamp(),
    });
    // Mapeo código → grupo para que unirseAGrupo() lo encuentre sin tener
    // que hacer una query (evita depender de índices compuestos).
    await setDoc(doc(db, 'invitaciones', codigoInvitacion), { grupoId: refGrupo.id });

    const grupo = { id: refGrupo.id, nombre };
    if (guardarEnMisGrupos) {
        await agregarGrupoAlUsuario(user.uid, grupo);
    }
    return { ...grupo, codigoInvitacion };
}

// Grupo real y compartible (código de invitación, tiempo real, todo lo de
// un grupo normal) pero pensado para usar y tirar: no se guarda en "Tus
// grupos". Útil para repartir algo puntual con gente que no va a volver a
// usar la app — no necesitan más que el código para sumarse en el momento.
export function crearCuentaRapida(user, nombre) {
    return crearGrupo(user, nombre, { guardarEnMisGrupos: false });
}

export async function unirseAGrupo(user, codigoInvitacion) {
    const codigo = codigoInvitacion.trim().toUpperCase();
    const refInvitacion = doc(db, 'invitaciones', codigo);
    const snapInvitacion = await getDoc(refInvitacion);
    if (!snapInvitacion.exists()) {
        throw new Error('Ese código de invitación no existe.');
    }

    const { grupoId } = snapInvitacion.data();
    const refGrupo = doc(db, 'grupos', grupoId);
    await updateDoc(refGrupo, {
        miembros: arrayUnion(user.uid),
        [`nombresPorUid.${user.uid}`]: nombreDeUsuario(user),
    });

    const snapGrupo = await getDoc(refGrupo);
    const grupo = { id: grupoId, nombre: snapGrupo.data().nombre };
    await agregarGrupoAlUsuario(user.uid, grupo);
    return grupo;
}

export async function obtenerMisGrupos(uid) {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? (snap.data().grupos || []) : [];
}

// Saca un grupo de "Tus grupos" sin necesidad de tocar el grupo en sí —
// lo usa division-de-gastos.html cuando descubre que un grupo guardado ya
// no existe (se borró): cada quien solo puede editar su propio
// usuarios/{uid} (por seguridad), así que esto es lo único que se puede
// limpiar automáticamente para uno mismo — a los DEMÁS integrantes que
// también lo tenían guardado les queda la entrada vieja hasta que a
// ellos también les toque descubrirlo (ver el comentario en
// eliminarGrupo, más abajo).
export async function quitarGrupoDeMisGrupos(uid, grupoId) {
    const grupos = await obtenerMisGrupos(uid);
    const nuevosGrupos = grupos.filter(g => g.id !== grupoId);
    if (nuevosGrupos.length === grupos.length) return; // no estaba, nada que hacer
    await updateDoc(doc(db, 'usuarios', uid), { grupos: nuevosGrupos });
}

// Cuando alguien cambia su nombre para mostrar (desde cuenta.html), hay
// que reflejarlo en el `nombresPorUid` de cada grupo del que forma parte
// — es una copia denormalizada a propósito (para no tener que resolver
// nombres con una lectura extra en cada render de división de gastos), así
// que hay que mantenerla sincronizada a mano en este único lugar.
export async function actualizarNombreEnMisGrupos(uid, nuevoNombre) {
    const grupos = await obtenerMisGrupos(uid);
    await Promise.all(grupos.map(g =>
        updateDoc(doc(db, 'grupos', g.id), { [`nombresPorUid.${uid}`]: nuevoNombre })
    ));
}

// Mismo mecanismo que el nombre, pero para la foto de perfil (ver
// imagen.js/perfil.js) — se llama desde cuenta.html después de guardarla,
// así el resto de cada grupo la ve sin tener que leer usuarios/{uid} de
// cada integrante (que además sus reglas de seguridad no lo permitirían:
// ese documento es privado, solo lo lee su dueño).
export async function actualizarFotoEnMisGrupos(uid, fotoDataURI) {
    const grupos = await obtenerMisGrupos(uid);
    await Promise.all(grupos.map(g =>
        updateDoc(doc(db, 'grupos', g.id), { [`fotosPorUid.${uid}`]: fotoDataURI })
    ));
}

// Mismo mecanismo, pero para el alias/CVU/link de Mercado Pago (ver
// perfil.js) — sin esto, el resto del grupo no tendría forma de verlo: las
// reglas de Firestore no dejan leer usuarios/{uid} de nadie más que uno
// mismo (más el admin), así que division-de-gastos.html no podría mostrar
// el botón "Pagar con Mercado Pago" sin esta copia denormalizada.
export async function actualizarAliasMercadoPagoEnMisGrupos(uid, alias) {
    const grupos = await obtenerMisGrupos(uid);
    await Promise.all(grupos.map(g =>
        updateDoc(doc(db, 'grupos', g.id), { [`aliasesPorUid.${uid}`]: alias || null })
    ));
}

// Mismo mecanismo, pero para "¿querés que te avise si te saldan una
// deuda?" (ver perfil.js) — quien salda la deuda es OTRO usuario, y las
// reglas de Firestore no dejan leer el usuarios/{uid} de nadie más que
// uno mismo, así que division-de-gastos.html no tendría forma de saber
// si corresponde avisarte sin esta copia denormalizada. Solo se guarda
// este único booleano acá (no toda `preferenciasNotif`) — es la única de
// las 5 preferencias que hace falta que otro usuario pueda leer.
export async function actualizarPreferenciaDeudaSaldadaEnMisGrupos(uid, avisar) {
    const grupos = await obtenerMisGrupos(uid);
    await Promise.all(grupos.map(g =>
        updateDoc(doc(db, 'grupos', g.id), { [`preferenciasPorUid.${uid}.deudaSaldada`]: !!avisar })
    ));
}

// Lectura de una sola vez (no en tiempo real) del nombre y los miembros de
// un grupo — la usa Gastos personales para poder mostrar "de qué grupo" es
// cada movimiento sin necesidad de una suscripción en vivo por grupo.
export async function obtenerGrupoUnaVez(grupoId) {
    const snap = await getDoc(doc(db, 'grupos', grupoId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Colores personalizados del grupo (fondo y borde de las tarjetas en
// division-de-gastos.html). `null` en cualquiera de los dos vuelve a los
// colores del tema general.
export function actualizarColoresGrupo(grupoId, colorFondo, colorBorde) {
    return updateDoc(doc(db, 'grupos', grupoId), { colorFondo, colorBorde });
}

// Borra el grupo entero: sus gastos, sus pagos de deuda, el código de
// invitación, y el documento del grupo en sí. Lo puede hacer cualquier
// integrante (mismo nivel de confianza que el resto de las acciones del
// grupo — pensado para grupos chicos de gente conocida, no para un
// lanzamiento público masivo, ver el comentario grande en
// firestore.rules).
//
// Firestore no borra subcolecciones solo con borrar el documento padre
// — hay que hacerlo a mano, documento por documento.
//
// OJO con los DEMÁS integrantes: no hay forma de sacarles el grupo de su
// propia lista "Tus grupos" desde acá (las reglas de seguridad no dejan
// editar el usuarios/{uid} de otra persona) — les va a quedar una
// entrada que ya no funciona hasta que ellos mismos entren; ahí
// division-de-gastos.html la detecta sola (escucharGrupo avisa con null)
// y se limpia con quitarGrupoDeMisGrupos.
export async function eliminarGrupo(grupoId, codigoInvitacion) {
    const [gastosSnap, pagosSnap, mensajesSnap] = await Promise.all([
        getDocs(collection(db, 'grupos', grupoId, 'expenses')),
        getDocs(collection(db, 'grupos', grupoId, 'pagosDeuda')),
        getDocs(collection(db, 'grupos', grupoId, 'mensajes')),
    ]);
    await Promise.all([
        ...gastosSnap.docs.map(d => deleteDoc(d.ref)),
        ...pagosSnap.docs.map(d => deleteDoc(d.ref)),
        ...mensajesSnap.docs.map(d => deleteDoc(d.ref)),
    ]);
    if (codigoInvitacion) {
        await deleteDoc(doc(db, 'invitaciones', codigoInvitacion)).catch(() => {});
    }
    await deleteDoc(doc(db, 'grupos', grupoId));
}

// Escucha en tiempo real los datos del grupo activo (nombre, miembros,
// código de invitación). Se usa en division-de-gastos.html tanto para
// mostrar esa info como para poblar los selectores de "quién pagó" — si
// alguien se une al grupo mientras la página está abierta, el selector se
// actualiza solo.
// Avisa con `null` si el grupo no existe (se borró, o el id ya no es
// válido) en vez de quedarse calladito — así quien esté escuchando
// (ej. division-de-gastos.html) se puede dar cuenta y reaccionar, en vez
// de quedar mostrando la pantalla de un grupo que ya no está.
export function escucharGrupo(grupoId, callback) {
    return onSnapshot(doc(db, 'grupos', grupoId), snap => {
        callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
}

export { copiarAlPortapapeles };

// Dibuja en #grupos-placeholder la lista de grupos del usuario más los
// formularios para crear uno nuevo o unirse con un código. Elegir un grupo
// lo marca como activo y manda a la página de división de gastos.
export function iniciarSelectorDeGrupos(user) {
    const contenedor = document.getElementById('grupos-placeholder');
    if (!contenedor) return;

    async function render() {
        contenedor.innerHTML = '<p>Cargando tus grupos...</p>';
        const grupos = await obtenerMisGrupos(user.uid);

        const listaHtml = grupos.length
            ? grupos.map(g => `
                <button type="button" class="boton-grupo" data-id="${g.id}" data-nombre="${esc(g.nombre)}" style="width: 100%; justify-content: space-between; margin-bottom: 8px;">
                    <span>👥 ${esc(g.nombre)}</span>
                    <span aria-hidden="true">→</span>
                </button>
            `).join('')
            : `<div class="estado-vacio">
                <span class="icono-grande">👥</span>
                Todavía no formás parte de ningún grupo. Creá uno o unite con un código arriba ↑
            </div>`;

        // Las dos tarjetas grandes son el punto de entrada principal; el
        // formulario de cada una arranca oculto y se despliega al tocar la
        // tarjeta (solo uno abierto a la vez, para no saturar la pantalla
        // de bienvenida con dos formularios completos desde el arranque).
        contenedor.innerHTML = `
            <div class="grid-acciones">
                <div class="card-accion" id="tarjeta-crear" tabindex="0" role="button">
                    <span class="icono-accion">✨</span>
                    <h3>Crear grupo</h3>
                    <p>Armá un grupo nuevo para empezar a repartir gastos</p>
                </div>
                <div class="card-accion" id="tarjeta-unirse" tabindex="0" role="button">
                    <span class="icono-accion">🔑</span>
                    <h3>Unirme a un grupo</h3>
                    <p>Sumate a uno existente con su código de invitación</p>
                </div>

                <div class="card panel-expandible" id="panel-crear" style="display:none;">
                    <div class="card-header"><h3 style="margin:0;">Crear un grupo nuevo</h3></div>
                    <form id="form-crear-grupo" class="form">
                        <div class="campo-ancho">
                            <label for="nombre-grupo-nuevo">Nombre del grupo</label>
                            <input type="text" id="nombre-grupo-nuevo" placeholder="Ej: Depto con Juan" required>
                        </div>
                        <button type="submit" class="campo-ancho">Crear grupo</button>
                    </form>
                </div>

                <div class="card panel-expandible" id="panel-unirse" style="display:none;">
                    <div class="card-header"><h3 style="margin:0;">Unirme a un grupo existente</h3></div>
                    <form id="form-unirse-grupo" class="form">
                        <div class="campo-ancho">
                            <label for="codigo-invitacion">Código de invitación</label>
                            <input type="text" id="codigo-invitacion" placeholder="Ej: AB3XQ9" required>
                        </div>
                        <button type="submit" class="campo-ancho secundario">Unirme</button>
                    </form>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><h3 style="margin:0;">Tus grupos</h3></div>
                ${listaHtml}
            </div>
        `;

        const tarjetaCrear = document.getElementById('tarjeta-crear');
        const tarjetaUnirse = document.getElementById('tarjeta-unirse');
        const panelCrear = document.getElementById('panel-crear');
        const panelUnirse = document.getElementById('panel-unirse');

        function alternarPanel(tarjeta, panel, otraTarjeta, otroPanel) {
            const abrir = panel.style.display === 'none';
            panel.style.display = abrir ? 'block' : 'none';
            tarjeta.classList.toggle('activa', abrir);
            otroPanel.style.display = 'none';
            otraTarjeta.classList.remove('activa');
            if (abrir) panel.querySelector('input').focus();
        }

        tarjetaCrear.addEventListener('click', () => alternarPanel(tarjetaCrear, panelCrear, tarjetaUnirse, panelUnirse));
        tarjetaUnirse.addEventListener('click', () => alternarPanel(tarjetaUnirse, panelUnirse, tarjetaCrear, panelCrear));

        contenedor.querySelectorAll('.boton-grupo').forEach(boton => {
            boton.addEventListener('click', () => {
                guardarGrupoActivo(boton.dataset.id, boton.dataset.nombre);
                window.location.href = 'division-de-gastos.html';
            });
        });

        document.getElementById('form-crear-grupo').addEventListener('submit', async (evento) => {
            evento.preventDefault();
            const nombre = document.getElementById('nombre-grupo-nuevo').value.trim();
            if (!nombre) return;
            try {
                const grupo = await crearGrupo(user, nombre);
                avisar(`Grupo "${grupo.nombre}" creado`, 'exito');
                guardarGrupoActivo(grupo.id, grupo.nombre);
                window.location.href = 'division-de-gastos.html';
            } catch (error) {
                avisar('No se pudo crear el grupo: ' + error.message, 'error');
            }
        });

        document.getElementById('form-unirse-grupo').addEventListener('submit', async (evento) => {
            evento.preventDefault();
            const codigo = document.getElementById('codigo-invitacion').value.trim();
            if (!codigo) return;
            try {
                const grupo = await unirseAGrupo(user, codigo);
                avisar(`Te uniste a "${grupo.nombre}"`, 'exito');
                guardarGrupoActivo(grupo.id, grupo.nombre);
                window.location.href = 'division-de-gastos.html';
            } catch (error) {
                avisar('No se pudo unir al grupo: ' + error.message, 'error');
            }
        });
    }

    render();
}
