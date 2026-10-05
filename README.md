# Invitación DOTANOVA + NEOTEK — 24 de noviembre, Cartagena

Página de una sola URL: portada "Save the date" → (animación del engranaje) → invitación → formulario de confirmación.
Node puro, **sin dependencias** (no hay `npm install` que falle).

```
server.js            servidor + API de confirmaciones
public/index.html    portada, invitación y formulario
public/styles.css    estilos (Carbon #212120, Amber #FBCB00, Fjalla One + Fira Sans)
public/app.js        transición, logos y envío del formulario
public/assets/       fotos optimizadas (webp), imagen para WhatsApp, logos/
```

## Probar en local
```bash
npm start            # http://localhost:3000
```
Las confirmaciones quedan en `data/confirmaciones.jsonl`.

## Subir a Railway
1. Sube esta carpeta a un repo de GitHub y en Railway: **New Project → Deploy from GitHub repo**.
   (O con la CLI: `railway init` y `railway up` dentro de la carpeta.)
2. Railway detecta Node y corre `npm start`. No hay que configurar el puerto.
3. **Volume (obligatorio para no perder registros):** en el servicio → *Settings / Volumes* → *Add Volume*, mount path `/data`.
4. **Variables** del servicio:
   - `DATA_DIR=/data`
   - `ADMIN_TOKEN=` una clave larga (ej. generada con `openssl rand -hex 24`)
   - `NODE_ENV=production`
5. *Settings → Networking → Generate Domain* (o conecta un dominio propio).
6. Healthcheck opcional: ruta `/salud`.

## Descargar las confirmaciones
`https://TU-DOMINIO/api/confirmaciones.csv?token=TU_ADMIN_TOKEN`
CSV separado por `;` con BOM, abre directo en Excel. Si una persona confirma dos veces con el mismo correo, queda el registro más reciente.

## Enlaces útiles
- Enlace directo al formulario, sin portada: `https://TU-DOMINIO/#confirmar`
- La vista previa en WhatsApp usa `public/assets/og-invitacion.jpg` y el dominio real automáticamente.

## Antes de enviar la invitación
- Logos oficiales en `public/assets/logos/` (ver LEEME.txt).
- Texto de autorización de datos: razón social y enlace real a la política de tratamiento (en `index.html`, busca "TEXTO LEGAL").
- Tiempo de la portada: `ESPERA_AUTOMATICA` en `public/app.js` (3,4 s).
