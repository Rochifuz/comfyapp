// Script de UNA SOLA VEZ: completa nombreMostrar/email en usuarios/{uid}
// para todas las cuentas que YA existen, sin esperar a que cada quien
// vuelva a loguearse — permisos.js (marcarLoginYPermisos) ya guarda estos
// 2 campos en cada login nuevo de acá en más, pero alguien que no volvió
// a entrar desde que se agregó eso (2026-08-30) todavía no los tiene —
// esto los completa de una, para verlos ya en el panel de admin.
//
// Mismos requisitos que scripts/habilitar-2fa.js (service-account-key.json
// en la raíz, con acceso administrativo total — nunca se sube a git).
// Correr con: npm run backfill-nombres

const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const rutaClave = path.join(__dirname, '..', 'service-account-key.json');

if (!fs.existsSync(rutaClave)) {
    console.error(
        '❌ Falta service-account-key.json en la raíz del proyecto.\n' +
        '   Consola de Firebase → ⚙️ Configuración del proyecto → Cuentas de servicio\n' +
        '   → "Generar nueva clave privada" → guardar el archivo con ese nombre acá.'
    );
    process.exit(1);
}

initializeApp({ credential: cert(require(rutaClave)) });
const db = getFirestore();

async function listarTodosLosUsuarios() {
    const usuarios = [];
    let pageToken;
    do {
        const resultado = await getAuth().listUsers(1000, pageToken);
        usuarios.push(...resultado.users);
        pageToken = resultado.pageToken;
    } while (pageToken);
    return usuarios;
}

async function main() {
    const usuariosAuth = await listarTodosLosUsuarios();
    console.log(`Cuentas encontradas en Firebase Auth: ${usuariosAuth.length}`);

    let actualizados = 0;
    let sinDatos = 0;
    for (const u of usuariosAuth) {
        if (!u.displayName && !u.email) { sinDatos++; continue; }
        // merge:true: solo toca estos 2 campos, no pisa nada más del
        // perfil (presupuesto, grupos, appsPermitidas, etc.) — mismo
        // criterio que marcarLoginYPermisos en permisos.js.
        await db.collection('usuarios').doc(u.uid).set({
            nombreMostrar: u.displayName || null,
            email: u.email || null,
        }, { merge: true });
        actualizados++;
    }

    console.log(`✅ Actualizados: ${actualizados}`);
    console.log(`Sin nombre ni email en Firebase Auth (quedan con UID nomás): ${sinDatos}`);
    process.exit(0);
}

main().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
