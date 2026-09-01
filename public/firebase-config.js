// Configuración e inicialización de Firebase.
//
// Los valores de abajo son PLACEHOLDERS — hay que reemplazarlos por los
// reales del proyecto de Firebase (Consola → ⚙️ Configuración del proyecto
// → "Tus apps" → app web → "Configuración del SDK"). Ver README.md,
// sección "Configurar Firebase", para el paso a paso completo.
//
// Estos valores (apiKey incluido) NO son secretos: quedan visibles en el
// navegador de cualquiera que use la app. La seguridad real de los datos la
// dan las reglas de Firestore (firestore.rules), no ocultar esta config.
const firebaseConfig = {
    apiKey: 'TU_API_KEY',
    authDomain: 'tu-proyecto.firebaseapp.com',
    projectId: 'tu-proyecto',
    storageBucket: 'tu-proyecto.firebasestorage.app',
    messagingSenderId: 'TU_MESSAGING_SENDER_ID',
    appId: 'TU_APP_ID',
};

// SDK modular de Firebase servido desde CDN como módulos ES — no hace falta
// npm install ni paso de build, se mantiene la filosofía del proyecto.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
