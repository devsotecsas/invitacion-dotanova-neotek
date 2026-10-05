/**
 * Servidor de la invitación DOTANOVA + NEOTEK.
 * Sin dependencias: solo módulos de Node (http, fs, path, crypto).
 *
 * Variables de entorno (Railway → Variables):
 *   PORT         Lo pone Railway solo.
 *   DATA_DIR     Carpeta donde se guardan las confirmaciones. En Railway debe
 *                apuntar a un Volume (ej. /data); si no, se pierden en cada deploy.
 *   ADMIN_TOKEN  Clave para descargar el CSV en /api/confirmaciones.csv?token=...
 *                Si no está definida, la descarga queda deshabilitada.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'confirmaciones.jsonl');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

// ---------- utilidades ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || '').trim();
}
function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${req.headers.host}`;
}
function readBody(req, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Límite simple de envíos por IP (en memoria): 8 cada 10 minutos.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 8;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (list.every((t) => now - t > 10 * 60 * 1000)) hits.delete(ip);
}, 5 * 60 * 1000).unref();

// ---------- validación ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function clean(v, max = 120) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validar(input) {
  const datos = {
    nombre: clean(input.nombre),
    empresa: clean(input.empresa),
    cargo: clean(input.cargo),
    celular: clean(input.celular, 30),
    correo: clean(input.correo, 160).toLowerCase(),
    alergia: clean(input.alergia, 200), // opcional (dato sensible, Ley 1581)
    acepta: input.acepta === true,
  };
  const errores = {};
  if (datos.nombre.length < 3) errores.nombre = 'Escribe tu nombre completo.';
  if (datos.empresa.length < 2) errores.empresa = 'Escribe el nombre de tu empresa.';
  if (datos.cargo.length < 2) errores.cargo = 'Escribe tu cargo.';
  const digitos = datos.celular.replace(/[^\d]/g, '');
  if (digitos.length < 7 || digitos.length > 15) errores.celular = 'Escribe un número de celular válido.';
  if (!EMAIL_RE.test(datos.correo)) errores.correo = 'Escribe un correo válido, ej. nombre@empresa.com.';
  if (!datos.acepta) errores.acepta = 'Necesitamos tu autorización para registrar tu asistencia.';
  return { datos, errores };
}

// ---------- almacenamiento ----------
async function leerConfirmaciones() {
  let raw = '';
  try { raw = await fsp.readFile(DATA_FILE, 'utf8'); } catch { return []; }
  const porCorreo = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      porCorreo.set(r.correo, r); // si alguien confirma dos veces, queda el registro más reciente
    } catch { /* línea dañada: se ignora */ }
  }
  return [...porCorreo.values()];
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- rutas ----------
async function handleApi(req, res, url) {
  if (url.pathname === '/api/confirmaciones' && req.method === 'POST') {
    if (rateLimited(clientIp(req))) return sendJson(res, 429, { ok: false, mensaje: 'Recibimos muchos envíos desde esta conexión. Intenta de nuevo en unos minutos.' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { ok: false, mensaje: 'No pudimos leer el formulario. Recarga la página e intenta de nuevo.' }); }
    if (body.sitio) return sendJson(res, 200, { ok: true }); // trampa para bots
    const { datos, errores } = validar(body);
    if (Object.keys(errores).length) return sendJson(res, 422, { ok: false, errores });
    const registro = {
      id: crypto.randomUUID(),
      fecha: new Date().toISOString(),
      ...datos,
      autorizacion_texto: clean(body.autorizacionVersion, 40) || 'v1',
    };
    await fsp.appendFile(DATA_FILE, JSON.stringify(registro) + '\n', 'utf8');
    return sendJson(res, 201, { ok: true, nombre: datos.nombre.split(' ')[0] });
  }

  if (url.pathname === '/api/confirmaciones.csv' && req.method === 'GET') {
    if (!ADMIN_TOKEN) return send(res, 404, 'No encontrado');
    const token = url.searchParams.get('token') || '';
    const ok = token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
    if (!ok) return send(res, 401, 'Token inválido');
    const filas = await leerConfirmaciones();
    const cols = ['fecha', 'nombre', 'empresa', 'cargo', 'celular', 'correo', 'alergia', 'acepta', 'autorizacion_texto'];
    const csv = '\uFEFF' + [cols.join(';'), ...filas.map((f) => cols.map((c) => csvCell(f[c])).join(';'))].join('\r\n');
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="confirmaciones-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  return sendJson(res, 404, { ok: false, mensaje: 'Ruta no encontrada' });
}

let indexTemplate = null;
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Prohibido');

  if (rel === '/index.html') {
    if (!indexTemplate || process.env.NODE_ENV !== 'production') indexTemplate = await fsp.readFile(file, 'utf8');
    const html = indexTemplate.replaceAll('{{URL_BASE}}', baseUrl(req));
    return send(res, 200, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }

  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('no file');
    const ext = path.extname(file).toLowerCase();
    // CSS y JS se revalidan siempre (como index.html), para que nunca se mezcle un HTML
    // nuevo con un app.js viejo; Last-Modified + 304 evita volver a descargarlos.
    if (ext === '.css' || ext === '.js') {
      const modificado = stat.mtime.toUTCString();
      const cache = { 'Cache-Control': 'no-cache', 'Last-Modified': modificado };
      const desde = Date.parse(req.headers['if-modified-since'] || '');
      if (desde >= Date.parse(modificado)) return send(res, 304, null, cache);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext], 'Content-Length': stat.size, ...cache });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=604800' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/salud') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, mensaje: 'Error en el servidor. Intenta de nuevo.' });
  }
});

server.listen(PORT, () => {
  console.log(`Invitación lista en http://localhost:${PORT}`);
  console.log(`Confirmaciones en: ${DATA_FILE}`);
  if (!process.env.DATA_DIR) console.warn('Aviso: DATA_DIR no está definido. En Railway monta un Volume y define DATA_DIR=/data o los registros se pierden en cada deploy.');
  if (!ADMIN_TOKEN) console.warn('Aviso: ADMIN_TOKEN no está definido; la descarga del CSV está deshabilitada.');
});
