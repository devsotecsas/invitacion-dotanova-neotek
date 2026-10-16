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

// Límite simple de envíos por IP (en memoria): 30 cada 10 minutos.
// Holgado porque los operadores móviles comparten una IP entre muchas personas.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (list.every((t) => now - t > 10 * 60 * 1000)) hits.delete(ip);
}, 5 * 60 * 1000).unref();

// ---------- validación ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID_RE = /^[A-Za-z0-9-]{1,20}$/;
// Versión del texto de autorización que acepta la persona, según el tipo de respuesta.
const AUTORIZACION = { Confirmado: 'v3-reserva-2026-10', 'Declinó': 'v1-declina-2026-10' };

function clean(v, max = 120) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validar(input) {
  const respuesta = input.respuesta === 'Confirmado' || input.respuesta === 'Declinó' ? input.respuesta : '';
  const idInvitado = String(input.id_invitado ?? '');
  const datos = {
    respuesta,
    version: input.version === 'Actual' ? 'Actual' : 'Potencial',
    id_invitado: ID_RE.test(idInvitado) ? idInvitado : '',
    personas: 0,
    nombre: clean(input.nombre),
    empresa: clean(input.empresa),
    cargo: '',
    celular: '',
    correo: '',
    alergia: '',
    acompanante_nombre: '',
    acompanante_cargo_empresa: '',
    acompanante_alergia: '',
    coordinar_otro_espacio: '',
    acepta: input.acepta === true,
  };
  const errores = {};
  if (datos.nombre.length < 3) errores.nombre = 'Falta el nombre completo.';
  if (datos.empresa.length < 2) errores.empresa = 'Falta el nombre de la empresa.';

  if (respuesta === 'Confirmado') {
    const personas = Number(input.personas);
    const conAcompanante = personas === 2;
    Object.assign(datos, {
      personas,
      cargo: clean(input.cargo),
      celular: clean(input.celular, 30),
      correo: clean(input.correo, 160).toLowerCase(),
      alergia: clean(input.alergia, 200), // opcional (dato sensible, Ley 1581)
      // Los datos del acompañante solo se guardan si asiste con acompañante.
      acompanante_nombre: conAcompanante ? clean(input.acompanante_nombre) : '',
      acompanante_cargo_empresa: conAcompanante ? clean(input.acompanante_cargo_empresa, 160) : '',
      acompanante_alergia: conAcompanante ? clean(input.acompanante_alergia, 200) : '',
    });
    if (datos.cargo.length < 2) errores.cargo = 'Falta el cargo.';
    const digitos = datos.celular.replace(/[^\d]/g, '');
    if (digitos.length < 7 || digitos.length > 15) errores.celular = 'El número de celular no es válido.';
    if (!EMAIL_RE.test(datos.correo)) errores.correo = 'El correo no es válido. Ejemplo: nombre@empresa.com';
    if (personas !== 1 && personas !== 2) errores.personas = 'Falta elegir: asistir solo o con un acompañante.';
    if (conAcompanante && datos.acompanante_nombre.length < 3) errores.acompanante_nombre = 'Falta el nombre completo del acompañante.';
    if (conAcompanante && datos.acompanante_cargo_empresa.length < 2) errores.acompanante_cargo_empresa = 'Faltan el cargo y la empresa del acompañante.';
    if (!datos.acepta) errores.acepta = 'Falta la autorización de tratamiento de datos.';
  } else {
    datos.coordinar_otro_espacio = input.coordinar === true ? 'Sí' : 'No';
    if (!datos.acepta) errores.acepta = 'Falta la autorización de tratamiento de datos.';
  }
  return { datos, errores };
}

// ---------- almacenamiento ----------
const COLUMNAS = [
  'fecha', 'respuesta', 'version', 'id_invitado', 'personas', 'nombre', 'empresa', 'cargo', 'celular', 'correo',
  'alergia', 'acompanante_nombre', 'acompanante_cargo_empresa', 'acompanante_alergia', 'coordinar_otro_espacio',
  'autorizacion_texto', 'posible_spam',
];

// Todas las respuestas, en orden de fecha. Los registros anteriores a las dos versiones
// (sin respuesta ni versión) eran confirmaciones de una persona.
async function leerRespuestas() {
  let raw = '';
  try { raw = await fsp.readFile(DATA_FILE, 'utf8'); } catch { return []; }
  const filas = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const respuesta = r.respuesta || 'Confirmado';
      filas.push({
        ...r,
        respuesta,
        version: r.version || '',
        id_invitado: r.id_invitado || '',
        personas: r.personas ?? (respuesta === 'Declinó' ? 0 : 1),
        coordinar_otro_espacio: r.coordinar_otro_espacio || '',
        posible_spam: r.posible_spam || 'No',
      });
    } catch { /* línea dañada: se ignora */ }
  }
  return filas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// Ids de prueba (PRUEBA-001…): solo salen en la exportación de auditoría.
const esPrueba = (r) => /^PRUEBA-/i.test(r.id_invitado);

// Si alguien responde varias veces queda la respuesta más reciente: por id de invitado,
// si no hay id por correo, y si no hay ninguno (declinaciones sin id) se conservan todas.
// respuestas_mismo_id cuenta las respuestas de ese id (más de una puede ser un enlace reenviado).
function agruparRespuestas(todas) {
  const filas = todas.filter((r) => !esPrueba(r));
  const porId = new Map();
  filas.forEach((r) => { if (r.id_invitado) porId.set(r.id_invitado, (porId.get(r.id_invitado) || 0) + 1); });
  const ultimas = new Map();
  filas.forEach((r, i) => {
    const clave = r.id_invitado ? `id:${r.id_invitado}` : r.correo ? `correo:${String(r.correo).toLowerCase()}` : `fila:${i}`;
    ultimas.delete(clave);
    ultimas.set(clave, r);
  });
  return [...ultimas.values()]
    .map((r) => ({ ...r, respuestas_mismo_id: r.id_invitado ? porId.get(r.id_invitado) : '' }))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- calendario ----------
const EVENTO = {
  uid: 'cena-dotanova-neotek-20261124@invitacion',
  secuencia: 1, // subirla cada vez que cambie el evento, para que los calendarios lo actualicen
  dia: '20261124',
  diaSiguiente: '20261125',
  // HORAS PENDIENTES: sin hora confirmada el evento es de día completo, para que nadie quede
  // con una hora equivocada. Al confirmarla: horas en HHMMSS (hora de Colombia), nueva
  // descripción y secuencia + 1.
  horaInicio: null,
  horaFin: null,
  resumen: 'Cena Dotanova × Neotek · Cartagena',
  lugar: 'Cartagena, Colombia',
  descripcion: 'Hora y lugar por confirmar. Enviaremos los detalles por correo.',
};
function icsTexto(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsLinea(linea) {
  // RFC 5545: líneas de máximo 75 octetos; las siguientes empiezan con un espacio.
  const partes = [];
  let actual = '';
  for (const ch of linea) {
    if (Buffer.byteLength(actual + ch, 'utf8') > (partes.length ? 74 : 75)) { partes.push(actual); actual = ''; }
    actual += ch;
  }
  partes.push(actual);
  return partes.join('\r\n ');
}
function calendarioIcs() {
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const conHora = Boolean(EVENTO.horaInicio && EVENTO.horaFin);
  const zonaHoraria = conHora ? [
    'BEGIN:VTIMEZONE',
    'TZID:America/Bogota',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'TZNAME:-05',
    'END:STANDARD',
    'END:VTIMEZONE',
  ] : [];
  const fechas = conHora ? [
    `DTSTART;TZID=America/Bogota:${EVENTO.dia}T${EVENTO.horaInicio}`,
    `DTEND;TZID=America/Bogota:${EVENTO.dia}T${EVENTO.horaFin}`,
  ] : [
    `DTSTART;VALUE=DATE:${EVENTO.dia}`,
    `DTEND;VALUE=DATE:${EVENTO.diaSiguiente}`, // DTEND es exclusivo: el evento ocupa solo el 24
  ];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DOTANOVA NEOTEK//Invitacion cena 2026//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...zonaHoraria,
    'BEGIN:VEVENT',
    `UID:${EVENTO.uid}`,
    `SEQUENCE:${EVENTO.secuencia}`,
    `DTSTAMP:${sello}`,
    ...fechas,
    `SUMMARY:${icsTexto(EVENTO.resumen)}`,
    `LOCATION:${icsTexto(EVENTO.lugar)}`,
    `DESCRIPTION:${icsTexto(EVENTO.descripcion)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(icsLinea).join('\r\n') + '\r\n';
}

// ---------- rutas ----------
function tokenValido(url) {
  const token = url.searchParams.get('token') || '';
  return token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
}

const EXPORTACIONES = {
  '/api/confirmaciones.csv': { archivo: 'confirmaciones', filas: agruparRespuestas, columnas: [...COLUMNAS, 'respuestas_mismo_id'] },
  // auditoría: todas las filas, sin agrupar y con los ids de prueba
  '/api/confirmaciones-todas.csv': { archivo: 'confirmaciones-todas', filas: (todas) => todas, columnas: COLUMNAS },
};

async function handleApi(req, res, url) {
  if (url.pathname === '/api/confirmaciones' && req.method === 'POST') {
    if (rateLimited(clientIp(req))) return sendJson(res, 429, { ok: false, mensaje: 'Se recibieron demasiados envíos desde esta conexión. En unos minutos se puede intentar de nuevo.' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = null; }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, mensaje: 'No se pudo leer el formulario. Hay que recargar la página e intentar de nuevo.' });
    const { datos, errores } = validar(body);
    // Sin tipo de respuesta: es una versión vieja de la página guardada en el navegador.
    if (!datos.respuesta) return sendJson(res, 400, { ok: false, mensaje: 'La página se actualizó. Hay que recargarla e intentar de nuevo.' });
    if (Object.keys(errores).length) return sendJson(res, 422, { ok: false, errores });
    const registro = {
      id: crypto.randomUUID(),
      fecha: new Date().toISOString(),
      ...datos,
      autorizacion_texto: AUTORIZACION[datos.respuesta],
      // Trampa para bots: no se descarta, porque el autocompletado puede llenarla a una persona real.
      posible_spam: clean(body.sitio) ? 'Sí' : 'No',
    };
    await fsp.appendFile(DATA_FILE, JSON.stringify(registro) + '\n', 'utf8');
    return sendJson(res, 201, { ok: true, nombre: datos.nombre.split(' ')[0] });
  }

  const exportacion = EXPORTACIONES[url.pathname];
  if (exportacion && req.method === 'GET') {
    if (!ADMIN_TOKEN) return send(res, 404, 'No encontrado');
    if (!tokenValido(url)) return send(res, 401, 'Token inválido');
    const filas = exportacion.filas(await leerRespuestas());
    const { columnas } = exportacion;
    const csv = '\uFEFF' + [columnas.join(';'), ...filas.map((f) => columnas.map((c) => csvCell(f[c])).join(';'))].join('\r\n');
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportacion.archivo}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  return sendJson(res, 404, { ok: false, mensaje: 'Ruta no encontrada' });
}

// ---------- dos versiones de la invitación ----------
// La ruta decide la versión: / → Potencial, /DotanovaNeotek → Actual.
// Los enlaces viejos con ?p= redirigen (301) a la dirección de su versión.
const TITULO_CENA = 'Cena privada Dotanova × Neotek · Cartagena, 24 de noviembre de 2026';
const VERSIONES = {
  Actual: {
    ruta: '/DotanovaNeotek',
    imagen: '/assets/og-invitacion.jpg', // IMAGEN PENDIENTE: og-actuales-v2.jpg
    textoCentral: 'La manera en que las empresas visten y protegen a su gente está cambiando, y queremos hablar de ese cambio con quienes han estado a nuestro lado. Por eso, nos encantaría que nos acompañaran a una cena privada para conversar, entre aliados, sobre lo que viene.',
    cierre: 'Queremos que esta conversación sea con ustedes.',
    evento: 'Cartagena, 24 de noviembre de 2026.',
  },
  Potencial: {
    ruta: '/',
    imagen: '/assets/og-invitacion.jpg', // IMAGEN PENDIENTE: og-potenciales-v2.jpg
    textoCentral: 'Dotanova y Neotek los invitan a una cena privada en Cartagena para líderes que deciden cómo se ven, se protegen y trabajan sus equipos: los mismos equipos que construyen el país. Por ellos, este año nos sumamos a una iniciativa de la Fundación CCI para apoyar a los futuros líderes de Colombia.',
    cierre: 'Nos gustaría contar con ustedes en esa mesa.',
    evento: 'Cartagena, 24 de noviembre de 2026.',
  },
};
function escaparHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const RUTA_ACTUAL = '/DotanovaNeotek';
const ID_VALIDO = /^[A-Za-z0-9-]{1,20}$/;
// Devuelve la dirección a la que hay que redirigir (301) o null si la URL ya es la limpia.
function redireccionVersion(url) {
  const ruta = url.pathname;
  const esActual = ruta.toLowerCase().replace(/\/+$/, '') === RUTA_ACTUAL.toLowerCase();
  const p = url.searchParams.get('p');
  if (!esActual && ruta !== '/' && ruta !== '/index.html') return null;
  if (p === null && (ruta === '/' || ruta === RUTA_ACTUAL)) return null;
  let destino = esActual ? RUTA_ACTUAL : '/';
  if (p !== null) destino = p === 'actuales' ? RUTA_ACTUAL : '/';
  else if (ruta === '/index.html') destino = '/';
  const id = url.searchParams.get('id');
  return destino + (id !== null && ID_VALIDO.test(id) ? `?id=${id}` : '');
}
function renderIndex(plantilla, req, url) {
  const version = url.pathname === RUTA_ACTUAL ? 'Actual' : 'Potencial';
  const v = VERSIONES[version];
  const valores = {
    VERSION: version,
    TITULO: TITULO_CENA,
    DESCRIPCION: v.cierre,
    OG_IMAGEN: v.imagen,
    RUTA: v.ruta,
    TEXTO_CENTRAL: v.textoCentral,
    CIERRE: v.cierre,
    EVENTO: v.evento,
    URL_BASE: baseUrl(req),
  };
  return plantilla.replace(/\{\{([A-Z_]+)\}\}/g, (marca, clave) => (clave in valores ? escaparHtml(valores[clave]) : marca));
}

let indexTemplate = null;
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '' || rel === RUTA_ACTUAL) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Prohibido');

  if (rel === '/index.html') {
    if (!indexTemplate || process.env.NODE_ENV !== 'production') indexTemplate = await fsp.readFile(file, 'utf8');
    return send(res, 200, renderIndex(indexTemplate, req, url), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
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
    if (url.pathname === '/cena.ics' && (req.method === 'GET' || req.method === 'HEAD')) {
      return send(res, 200, req.method === 'HEAD' ? null : calendarioIcs(), {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="cena-dotanova-neotek.ics"',
        'Cache-Control': 'no-cache',
      });
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    const destino = redireccionVersion(url);
    if (destino) return send(res, 301, null, { Location: destino, 'Cache-Control': 'no-cache' });
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, mensaje: 'Hubo un error en el servidor. Se puede intentar de nuevo en un momento.' });
  }
});

server.listen(PORT, () => {
  console.log(`Invitación lista en http://localhost:${PORT}`);
  console.log(`Confirmaciones en: ${DATA_FILE}`);
  if (!process.env.DATA_DIR) console.warn('Aviso: DATA_DIR no está definido. En Railway monta un Volume y define DATA_DIR=/data o los registros se pierden en cada deploy.');
  if (!ADMIN_TOKEN) console.warn('Aviso: ADMIN_TOKEN no está definido; la descarga del CSV está deshabilitada.');
});
