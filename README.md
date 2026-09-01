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

## Poner esto a andar (opcional)

Este repo no es un producto "un click y anda" — necesita tu propio
proyecto de Firebase y, para algunas apps, tus propias credenciales de
API. Para probarlo:

1. Creá un proyecto en [Firebase Console](https://console.firebase.google.com),
   habilitá Authentication (Google + Email/contraseña) y Firestore.
2. Copiá la configuración del SDK web a `public/firebase-config.js`
   (los valores de acá vienen vacíos a propósito).
3. Reemplazá `TU_UID_DE_FIREBASE` en `firestore.rules` por tu propio UID
   (Firebase Console → Authentication → Users) y desplegalas:
   `npx firebase deploy --only firestore:rules`.
4. `npx firebase deploy --only hosting` (o `npm start` para probar local
   con `http-server`).
5. Opcional — GamingApp/AgendaApp necesitan además: una cuenta de
   Cloudflare Workers gratis (ver `cloudflare-worker/README.md`), una API
   key de Riot Games, y un cliente OAuth de Google Calendar.

## Sobre este repo

Esto es una copia derivada de una app real en producción (Alpha privada
con usuarios reales). Para publicarla:

- Se sacaron todos los secretos (claves de API, tokens) — nunca vivieron
  en el repo original tampoco, siempre en variables de entorno/secretos
  de Cloudflare, así que no hizo falta reescribir historial.
- Se reemplazaron los valores de configuración de Firebase, el UID de
  admin, y la URL del Worker de Cloudflare por placeholders.
- Se sacó cualquier dato de usuarios reales (que de todas formas nunca
  vive en el repo — Firestore es la única base de datos).

No es un template pensado para que cualquiera lo clone y tenga la app
andando en 5 minutos — es una muestra del código y la arquitectura reales
detrás de una app en producción.
