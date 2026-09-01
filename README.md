# ComfyApp — mega sistema de 5 apps

Un sistema de 5 apps web integradas, compartiendo login y sistema de diseño,
construido sin ningún framework de frontend ni paso de build: HTML/CSS/JS
plano servido tal cual, con Firebase como backend.

Este repositorio es una **versión limpia para portfolio** de una app en
producción real, con datos y credenciales propias removidos — ver
[Sobre este repo](#sobre-este-repo) más abajo.

## Las 5 apps

- **💰 GastosApp** — gastos personales y grupales, división de gastos entre
  amigos con saldos automáticos, gastos recurrentes, presupuesto por
  categoría, multi-moneda (ARS/USD/EUR) con cotización en vivo, exportar a
  CSV, y un asistente conversacional simple ("Gastón") para preguntas sobre
  los propios datos.
- **🛋️ ComfyApp** — el hub de entrada al sistema: login, selector de apps,
  clima y noticias.
- **🎮 GamingApp** — login con Steam (OpenID), biblioteca de juegos,
  torneos propios con código de invitación (liga / eliminación / grupos),
  y un tracker de League of Legends/TFT: rango y partidas en vivo (API
  oficial de Riot), historial de rango en el tiempo, guías de build/runas
  por campeón y por rol, y un armador visual de composiciones de TFT.
- **🗓️ AgendaApp** — calendario conectado en vivo a Google Calendar (sin
  copiar los eventos a una base propia), con Google Meet, búsqueda y varios
  calendarios en paralelo.
- **🗒️ TareasApp** — tareas personales y de grupo, con avisos de
  vencimiento configurables.

Todas comparten sesión (Firebase Auth), un centro de notificaciones común,
y un **sistema de permisos por app**: una cuenta nueva arranca solo con
GastosApp, y un panel de administración permite habilitar las demás app
por app.

## Stack técnico

- **Frontend**: HTML/CSS/JS sin build — ES modules importados directo
  desde el navegador (Firebase SDK vía CDN). Sin React/Vue/npm de por
  medio para el frontend.
- **Backend**: Firebase (Auth + Firestore), con reglas de seguridad
  declarativas (`firestore.rules`) como única capa de protección de datos.
- **Proxy serverless**: un Cloudflare Worker (`cloudflare-worker/`) para
  las llamadas a APIs de terceros que necesitan CORS o una API key que no
  puede vivir en el navegador (Steam, Riot Games, noticias).
- **PWA**: instalable, con service worker para cachear el "shell" de la
  app (código, no datos).
- **2FA**: verificación en dos pasos vía TOTP (apps autenticadoras).

## Estructura

```
public/              → todo el frontend (una carpeta por app secundaria)
  gaming/, agenda/, tareas/
cloudflare-worker/    → el proxy serverless
firestore.rules       → reglas de seguridad de la base de datos
firebase.json         → hosting, headers de seguridad, CSP
scripts/              → scripts puntuales de administración (Admin SDK)
```

## Poner esto a andar

No es un producto "un click y anda" — es una app real, así que hace falta
tu propio proyecto de Firebase y (para algunas apps) tus propias
credenciales de API, todas gratis y sin pedir tarjeta. GastosApp/ComfyApp/
TareasApp andan solo con Firebase (pasos 1-4); GamingApp y AgendaApp
necesitan además el Worker de Cloudflare (paso 5).

### 1. Requisitos

- [Node.js](https://nodejs.org) (para `npx`/`npm`) y una cuenta de Google
  (para Firebase).
- `npm install` en la raíz del repo (instala `firebase-tools` y
  `http-server`, ya en `package.json`).

### 2. Crear el proyecto de Firebase

1. [Firebase Console](https://console.firebase.google.com) → crear
   proyecto nuevo (plan **Spark**, el gratuito, alcanza de sobra).
2. **Authentication** → pestaña "Sign-in method" → habilitar los
   proveedores **Google** y **Email/contraseña**.
3. **Firestore Database** → crear base de datos (modo producción, la
   región que prefieras).
4. **Configuración del proyecto** (⚙️) → "Tus apps" → agregar una app
   **Web** (</> ) → copiá el objeto `firebaseConfig` que te muestra.

### 3. Conectar el código a tu proyecto

1. Pegá esos valores en `public/firebase-config.js` (reemplazando los
   placeholders `TU_API_KEY`, `tu-proyecto`, etc.).
2. `.firebaserc` → cambiá `"default": "tu-proyecto-de-firebase"` por el
   ID real de tu proyecto.
3. En `firestore.rules`, buscá `TU_UID_DE_FIREBASE` (dentro de la función
   `esAdmin()`) y reemplazalo por tu propio UID — te logueás una vez en
   la app, y lo copiás de Firebase Console → Authentication → Users →
   columna "User UID". Sin este paso, igual anda todo excepto el panel
   de administración (`admin.html`).

### 4. Correr o desplegar

```bash
npx firebase login                              # una sola vez
npx firebase deploy --only firestore:rules      # sube las reglas de seguridad

npm start                                       # probar en local, http://localhost:8080
# — o bien —
npx firebase deploy --only hosting              # publicarla de verdad (te da una URL tipo tu-proyecto.web.app)
```

Con esto ya andan GastosApp, ComfyApp (sin clima/noticias todavía) y
TareasApp — podés crear una cuenta y probarlas.

### 5. Opcional: el Worker de Cloudflare (GamingApp, AgendaApp, clima/noticias)

Estas funciones necesitan un pequeño proxy (gratis, plan Free de
Cloudflare Workers, sin tarjeta) porque dependen de una API key que no
puede vivir en el navegador, o de un servicio sin CORS habilitado:

- 🎮 **GamingApp**: login con Steam, biblioteca de Steam, y el Tracker de
  League of Legends/TFT (necesita una API key de Riot Games).
- 🗓️ **AgendaApp**: conectar Google Calendar (necesita un cliente OAuth
  de Google Cloud).
- 🌤️ **ComfyApp**: noticias (clima funciona sin esto, es una API pública
  sin key).

La guía completa, paso a paso — conseguir cada API key gratis, cargarlas
como secretos con Wrangler, crear el cliente OAuth de Google, deployar el
Worker — está en **[`cloudflare-worker/README.md`](cloudflare-worker/README.md)**.
Al terminar esos pasos vas a tener que actualizar 2 placeholders más en
el código con tus propios valores (el mismo README te dice exactamente
en qué archivos): la URL de tu Worker ya deployado (reemplaza
`tu-worker.tu-subdominio.workers.dev`, aparece en 4 archivos) y el
Client ID de OAuth de Google que crees (reemplaza `TU_GOOGLE_CLIENT_ID`,
en 2 archivos).

### Scripts sueltos (`scripts/`, opcionales)

- `npm run habilitar-2fa` — habilita TOTP como segundo factor de login
  para el proyecto (una sola vez).
- `npm run backfill-nombres` — completa nombre/email de las cuentas ya
  existentes en el panel de admin, sin esperar a que cada quien vuelva a
  loguearse.

Los dos necesitan una clave de servicio de Firebase Admin SDK (Firebase
Console → ⚙️ Configuración del proyecto → "Cuentas de servicio" →
"Generar nueva clave privada") guardada como `service-account-key.json`
en la raíz del repo — **nunca se sube a git** (ya está en `.gitignore`),
le da acceso administrativo total a tu proyecto.

## Sobre este repo

Esto es una copia derivada de una app real en producción (Alpha privada
con usuarios reales). Para publicarla:

- Se sacaron todos los secretos (claves de API, tokens) — nunca vivieron
  en el repo original tampoco, siempre en variables de entorno/secretos
  de Cloudflare, así que no hizo falta reescribir historial.
- Se reemplazaron por placeholders: los valores de configuración de
  Firebase, el UID de admin, la URL del Worker de Cloudflare, el Client
  ID de OAuth de Google, y el email de contacto de las páginas de
  Privacidad/Términos.
- Se sacó cualquier dato de usuarios reales (que de todas formas nunca
  vive en el repo — Firestore es la única base de datos).

No es un proyecto open source mantenido activamente ni pensado para
recibir contribuciones — es una foto del código y la arquitectura reales
detrás de una app en producción, pensada para portfolio. Los pasos de
arriba alcanzan para levantarla con tu propio proyecto de Firebase si
querés probarla en serio.
