# Proxy de Steam + noticias + Google Calendar (Cloudflare Workers)

Por qué existe esto: varias APIs externas o no dejan que un navegador les
pegue directo desde otra web (`api.steampowered.com`, `store.steampowered.com`,
`gnews.io`, `newsdata.io` — sin CORS habilitado, comprobado con `curl` antes
de armar esto, no es una suposición), o necesitan un secreto que no puede
vivir en JS del lado del navegador (`oauth2.googleapis.com`, para renovar
el token de Google Calendar). Sin este Worker en el medio, GamingApp no
puede leer nada de Steam, ComfyApp no podría mostrar los titulares del
día, y AgendaApp no podría conectar Google Calendar sin pedir el login de
nuevo cada 1 hora. Es gratis (plan Free de Cloudflare Workers, 100.000
pedidos/día) y **no pide tarjeta** para darlo de alta.

**Nota sobre /noticias**: el primer intento fue pedirle el RSS directo a
Google News, sin API key — pero Google (y después Infobae y La Nación,
probados como alternativa) bloquean con 403/503 cualquier pedido que venga
del pool de IPs compartido de Cloudflare Workers, sin importar qué headers
se manden. No es arreglable desde acá — los sitios de noticias con
protección antibots tratan a Cloudflare Workers como tráfico sospechoso.
Por eso se terminó usando GNews + NewsData (gnews.io / newsdata.io), que sí
están pensadas para consumirse desde un backend — se combinan las dos (ver
`obtenerNoticias()` en `src/index.js`) para tener redundancia gratis: si
una falla, la otra sigue aportando resultados.

## Paso a paso (una sola vez)

1. **Conseguir una Steam API key** (gratis, con cualquier cuenta de Steam):
   entrá a https://steamcommunity.com/dev/apikey, iniciá sesión, y pedí una
   — te va a tirar una clave larga de texto.

2. **Crear una cuenta en Cloudflare** (gratis, sin tarjeta): https://dash.cloudflare.com/sign-up

3. **Instalar Wrangler** (la herramienta de línea de comandos de Cloudflare
   — ya está en `package.json` de esta carpeta, así que alcanza con):
   ```
   cd cloudflare-worker
   npm install
   ```
   y loguear la CLI con tu cuenta de Cloudflare (abre el navegador para
   que lo autorices):
   ```
   npx wrangler login
   ```

4. **Cargar los 5 secretos** (nunca van en un archivo del repo — Wrangler
   los manda directo a Cloudflare). Un comando por cada uno, te va a pedir
   que pegues el valor ahí mismo en la terminal:

   ```
   npx wrangler secret put STEAM_API_KEY
   ```
   La que conseguiste en el paso 1.

   ```
   npx wrangler secret put GNEWS_API_KEY
   ```
   Gratis, sin tarjeta: registrate en https://gnews.io/register y copiá la
   key de tu panel (https://gnews.io/dashboard). Plan free: 100 pedidos/día.

   ```
   npx wrangler secret put NEWSDATA_API_KEY
   ```
   Gratis, sin tarjeta: registrate en https://newsdata.io/register y copiá
   la key de tu panel. Plan free: ~200 pedidos/día.

   ```
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   Para AgendaApp (conectar Google Calendar). Se consigue en
   https://console.cloud.google.com/ → habilitar la Google Calendar API →
   pantalla de consentimiento OAuth en modo **Testing** (agregando ahí, a
   mano, las cuentas de Google que van a poder usar Calendar — hasta 100)
   → crear un OAuth Client ID de tipo "Web application", con
   `https://TU-DOMINIO.web.app` en "Authorized JavaScript origins" y
   `https://TU-DOMINIO.web.app/agenda/callback.html` (más
   `http://localhost:8080/agenda/callback.html` si vas a probar en local)
   en "Authorized redirect URIs". El Client ID resultante (no es secreto)
   va hardcodeado en `src/index.js` (`GOOGLE_CLIENT_ID`) y en
   `public/agenda/calendario.js` — hay que actualizarlo a mano en los dos
   lugares si alguna vez se recrea el cliente OAuth. El Client Secret sí
   es sensible: es lo que se carga acá.

   ```
   npx wrangler secret put RIOT_API_KEY
   ```
   Para el Tracker de GamingApp (League of Legends/TFT). Gratis, sin
   tarjeta: entrá a https://developer.riotgames.com con tu cuenta de
   Riot y generá una key. **Ojo con esto**: la key "de desarrollo" que
   te da al toque VENCE cada 24hs y hay que volver a generarla y
   recargarla acá a mano — para que el Tracker no se corte solo cada
   día, conviene aplicar a una "Personal API Key" (mismo lugar, un
   formulario simple) — es permanente, pero tarda unos días en
   aprobarse. Mientras tanto, la de desarrollo sirve para probar que
   todo funciona.

   No hace falta pedir ninguno de estos de nuevo salvo que se revoque o
   venza (la de Riot si es la de desarrollo, cada 24hs) — quedan
   guardados del lado de Cloudflare para siempre.

5. **Deployar el Worker**:
   ```
   npx wrangler deploy
   ```
   Al terminar te va a mostrar la URL pública del Worker, algo como
   `https://gastosapp-steam-proxy.TU-USUARIO.workers.dev` — esa URL ya está
   hardcodeada en `gaming/conexiones.html`, `gaming/riot.js`,
   `sistema.html` y `agenda/calendario.js` (constantes
   `PROXY_STEAM`/`PROXY_RIOT`/`PROXY_NOTICIAS`/`PROXY_CALENDAR_TOKEN`) —
   si el Worker se recrea con otro nombre/URL, hay que actualizarla en
   los cuatro lugares.

## Actualizar el Worker más adelante

Si en algún momento se edita `src/index.js` (nueva ruta, cambio de lógica),
alcanza con volver a correr `npx wrangler deploy` desde esta carpeta — no
hace falta tocar los secretos de nuevo, esos quedan guardados del lado de
Cloudflare.

## Rutas que expone

| Ruta | Método | Parámetro | Para qué |
|---|---|---|---|
| `/noticias` | GET | `?q=` o `?categoria=` (opcionales) | Titulares del día (GNews + NewsData combinadas, Argentina) — los usa ComfyApp. Necesita `GNEWS_API_KEY`/`NEWSDATA_API_KEY` (al menos una de las dos para no devolver vacío). |
| `/calendar-token` | POST | `{code, redirectUri}` o `{refreshToken}` en el body | Conecta/renueva el acceso a Google Calendar — lo usa AgendaApp. Necesita `GOOGLE_CLIENT_SECRET`. |
| `/resolve` | GET | `?vanity=nombreDePerfil` | Convierte una URL de perfil de Steam ("steamcommunity.com/id/ESTO") en el SteamID64 de 17 dígitos que piden las otras rutas de Steam. |
| `/profile` | GET | `?steamid=...` | Nombre y avatar del perfil de Steam. |
| `/owned-games` | GET | `?steamid=...` | Biblioteca completa de Steam (juegos + horas jugadas). |
| `/openid-verify` | GET | parámetros `openid.*` que reenvía Steam | Paso de atrás del login "Iniciar sesión con Steam" — confirma con Steam que el login es legítimo. |
| `/riot-account` | GET | `?gameName=&tagLine=&region=` | Resuelve un Riot ID ("Nombre#TAG") al `puuid` que piden el resto de las rutas de Riot. `region` es el ruteo regional (`americas`/`europe`/`asia`/`sea`). Necesita `RIOT_API_KEY`. |
| `/riot-league` | GET | `?puuid=&platform=` | Rango actual de Solo/Duo en League of Legends. `platform` es el ruteo de servidor (`la2`, `na1`, `euw1`...). |
| `/tft-league` | GET | `?puuid=&platform=` | Igual que `/riot-league`, pero el rango de TFT. |
| `/riot-matches` | GET | `?puuid=&region=&count=` (count opcional, tope 15) | Últimas partidas de League of Legends, ya con el detalle de cada una (dos pasos contra Riot resueltos acá adentro, no en el navegador). |
| `/tft-matches` | GET | `?puuid=&region=&count=` (count opcional, tope 15) | Igual que `/riot-matches`, pero de TFT. |

## Sobre la privacidad del perfil de Steam

Las rutas de Steam solo devuelven datos si el perfil de esa persona está
configurado como público (Steam → Editar perfil → Privacidad del juego).
Si está privado, Steam va a devolver una lista vacía en vez de un error —
GamingApp debería avisarlo así, no como si hubiera fallado el pedido.
