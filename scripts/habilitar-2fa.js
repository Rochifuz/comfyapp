// Script de configuración de UNA SOLA VEZ: habilita TOTP (apps
// autenticadoras tipo Google Authenticator/Authy) como segundo factor de
// login para todo el proyecto de Firebase.
//
// No hay ningún botón en la consola de Firebase para esto — Google solo
// lo expone vía el Admin SDK o la API REST — así que este script lo hace
// una vez y no hace falta volver a correrlo (salvo que crees un proyecto
// de Firebase nuevo).
//
// Antes de correrlo:
//   1. Consola de Firebase → ⚙️ Configuración del proyecto → pestaña
//      "Cuentas de servicio" → botón "Generar nueva clave privada".
//      Se descarga un .json — guardalo en la raíz del proyecto con el
//      nombre exacto "service-account-key.json" (ya está en .gitignore,
//      NUNCA lo subas a git: le da acceso administrativo total a tu
//      proyecto de Firebase).
//   2. npm install (para tener firebase-admin, ya está en package.json).
//
// Correr con: npm run habilitar-2fa

const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

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

getAuth().projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
        providerConfigs: [{
            state: 'ENABLED',
            totpProviderConfig: {
                adjacentIntervals: 5, // valor por defecto recomendado por Firebase
            },
        }],
    },
}).then(() => {
    console.log('✅ TOTP habilitado como segundo factor para el proyecto.');
    console.log('   Ya podés activar la verificación en dos pasos desde cuenta.html.');
    process.exit(0);
}).catch(error => {
    console.error('❌ No se pudo habilitar:', error.message);
    process.exit(1);
});
