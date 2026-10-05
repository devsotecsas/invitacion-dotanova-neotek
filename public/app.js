(() => {
  'use strict';

  const body = document.body;
  const portada = document.getElementById('portada');
  const engranaje = portada.querySelector('.engranaje');
  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------
  // 1. Portada → invitación
  //    Entrada (1,2 s, en styles.css) + lectura (5,5 s) y pasa sola.
  //    Tocar, hacer scroll o pulsar una tecla adelanta la salida, pero la salida
  //    dura siempre lo mismo.
  // ------------------------------------------------------------
  const ENTRADA = 1200;
  const LECTURA = 5500;
  const ESPERA_AUTOMATICA = ENTRADA + LECTURA; // 6,7 s hasta que empieza la salida
  const MINIMO_ANTES_DE_SALTAR = ENTRADA; // evita saltarla por un toque accidental al abrir

  // Salida: el texto se desvanece, luego zoom lento del engranaje y, en el último 40 %,
  // fundido hacia la invitación. Con movimiento reducido: solo fundidos.
  const SALIDA = reducido ? 1600 : 2800;
  const SALIDA_TEXTO = 600;
  const SALIDA_ZOOM_DESDE = 300;
  const SALIDA_FUNDIDO_DESDE = reducido ? SALIDA_TEXTO : SALIDA * 0.6;
  const curvaZoom = cubicBezier(0.45, 0, 0.25, 1);

  const inicio = performance.now();
  let saliendo = false;

  function cubicBezier(x1, y1, x2, y2) {
    const curva = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) {
        const t = (lo + hi) / 2;
        if (curva(x1, x2, t) < x) lo = t; else hi = t;
      }
      return curva(y1, y2, (lo + hi) / 2);
    };
  }

  function escalaQueCubre() {
    // El engranaje debe crecer hasta que su parte más angosta (fondo de los dientes,
    // 41% del ancho) llegue a la esquina de la pantalla más lejana a su centro.
    const r = engranaje.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const lejos = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
    return (lejos / ((r.width || 300) * 0.41)) * 1.06;
  }

  function animarZoomEngranaje() {
    const cubre = escalaQueCubre();
    // Cuando empieza el fundido el engranaje ya debe cubrir la pantalla (nunca se ven sus bordes).
    const duracion = SALIDA - SALIDA_ZOOM_DESDE;
    const avanceAlFundido = curvaZoom((SALIDA_FUNDIDO_DESDE - SALIDA_ZOOM_DESDE) / duracion);
    const final = Math.max(cubre * 1.6, cubre ** (1 / avanceAlFundido) * 1.02);
    // Interpolación en escala logarítmica: el acercamiento se percibe parejo, sin acelerones.
    const pasos = 48;
    const fotogramas = [];
    for (let i = 0; i <= pasos; i++) {
      fotogramas.push({ transform: `scale(${(final ** curvaZoom(i / pasos)).toFixed(4)})` });
    }
    engranaje.animate(fotogramas, { delay: SALIDA_ZOOM_DESDE, duration: duracion, easing: 'linear', fill: 'forwards' });
  }

  function mostrarInvitacion() {
    body.classList.remove('bloqueado');
    body.classList.add('listo');
    portada.remove();
  }

  function salir() {
    if (saliendo) return;
    saliendo = true;
    portada.classList.add('saliendo');

    portada.querySelectorAll('.portada-titulo, .portada-pie').forEach((el) => {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SALIDA_TEXTO, easing: 'ease-in-out', fill: 'forwards' });
    });
    if (!reducido) animarZoomEngranaje();

    const fundido = portada.animate([{ opacity: 1 }, { opacity: 0 }], {
      delay: SALIDA_FUNDIDO_DESDE,
      duration: SALIDA - SALIDA_FUNDIDO_DESDE,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    // El contenido de la invitación empieza a entrar cuando arranca el fundido.
    window.setTimeout(() => body.classList.add('listo'), SALIDA_FUNDIDO_DESDE);
    fundido.finished.then(mostrarInvitacion, mostrarInvitacion);
  }

  function intentarSalir() {
    if (performance.now() - inicio < MINIMO_ANTES_DE_SALTAR) return;
    salir();
  }

  // Enlace directo al formulario (ej. https://.../#confirmar): sin portada.
  if (location.hash === '#confirmar') {
    portada.remove();
    body.classList.remove('bloqueado');
    body.classList.add('listo');
    requestAnimationFrame(() => {
      pedirTextura();
      // salto directo (sin el scroll suave del CSS) para abrir con el fondo en su estado final
      const html = document.documentElement;
      html.style.scrollBehavior = 'auto';
      seccionConfirmar.scrollIntoView();
      html.style.scrollBehavior = '';
      remedir();
    });
  } else {
    window.setTimeout(salir, ESPERA_AUTOMATICA);
    portada.addEventListener('click', intentarSalir);
    window.addEventListener('wheel', intentarSalir, { passive: true, once: false });
    window.addEventListener('touchmove', intentarSalir, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!saliendo && ['Enter', ' ', 'ArrowDown', 'PageDown', 'Escape'].includes(e.key)) {
        e.preventDefault();
        intentarSalir();
      }
    });
  }

  // ------------------------------------------------------------
  // 2. Fondo continuo: al bajar de la invitación al formulario la foto sube un poco
  //    (la cámara desciende por la escalera) y se funde en la versión con textura.
  //    Solo transform/opacity desde un listener pasivo + requestAnimationFrame.
  // ------------------------------------------------------------
  const fondo = document.querySelector('.fondo');
  const seccionConfirmar = document.getElementById('confirmar');
  // misma consulta que en styles.css para elegir las fotos de 2400 px
  const FOTO_GRANDE = window.matchMedia('(min-width: 900px), (min-resolution: 2dppx) and (min-width: 600px)').matches;
  let recorrido = 1;
  let pintadoPendiente = false;
  let texturaPedida = false;

  function pedirTextura() {
    if (texturaPedida) return;
    texturaPedida = true;
    const img = new Image();
    img.onload = img.onerror = () => fondo.classList.add('con-textura');
    img.src = `/assets/foto-textura-${FOTO_GRANDE ? 2400 : 1200}.webp`;
  }

  function medirRecorrido() {
    recorrido = Math.max(1, seccionConfirmar.offsetTop);
  }

  function suavizar(desde, hasta, x) {
    const t = Math.min(1, Math.max(0, (x - desde) / (hasta - desde)));
    return t * t * (3 - 2 * t);
  }

  function pintarFondo() {
    pintadoPendiente = false;
    const p = Math.min(1, Math.max(0, window.scrollY / recorrido));
    if (p > 0) pedirTextura();
    fondo.style.setProperty('--p', p.toFixed(4));
    fondo.style.setProperty('--t', suavizar(0.1, 0.95, p).toFixed(3));
  }

  function pedirPintado() {
    if (pintadoPendiente) return;
    pintadoPendiente = true;
    requestAnimationFrame(pintarFondo);
  }

  function remedir() {
    medirRecorrido();
    pedirPintado();
  }

  medirRecorrido();
  pintarFondo();
  window.addEventListener('scroll', pedirPintado, { passive: true });
  window.addEventListener('resize', remedir, { passive: true });
  window.addEventListener('load', remedir);
  if ('ResizeObserver' in window) new ResizeObserver(remedir).observe(document.querySelector('main'));

  // ------------------------------------------------------------
  // 3. Logos oficiales: si existen en /assets/logos/, reemplazan a los de respaldo
  // ------------------------------------------------------------
  document.querySelectorAll('[data-logo]').forEach((contenedor) => {
    const img = new Image();
    img.onload = () => {
      img.className = 'logo-oficial';
      img.alt = contenedor.getAttribute('aria-label') || '';
      contenedor.removeAttribute('role');
      contenedor.removeAttribute('aria-label');
      contenedor.replaceChildren(img);
    };
    img.src = contenedor.dataset.logo;
  });

  // ------------------------------------------------------------
  // 4. Botón "Confirma tu asistencia" → formulario
  // ------------------------------------------------------------
  document.getElementById('ir-a-confirmar').addEventListener('click', (e) => {
    e.preventDefault();
    pedirTextura();
    seccionConfirmar.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('nombre').focus({ preventScroll: true }), reducido ? 0 : 700);
  });

  // ------------------------------------------------------------
  // 5. Formulario
  // ------------------------------------------------------------
  const form = document.getElementById('formulario');
  const enviar = document.getElementById('enviar');
  const estado = document.getElementById('estado');
  const CAMPOS = ['nombre', 'empresa', 'cargo', 'celular', 'correo'];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validarLocal(d) {
    const e = {};
    if (d.nombre.length < 3) e.nombre = 'Escribe tu nombre completo.';
    if (d.empresa.length < 2) e.empresa = 'Escribe el nombre de tu empresa.';
    if (d.cargo.length < 2) e.cargo = 'Escribe tu cargo.';
    const dig = d.celular.replace(/\D/g, '');
    if (dig.length < 7 || dig.length > 15) e.celular = 'Escribe un número de celular válido.';
    if (!EMAIL_RE.test(d.correo)) e.correo = 'Escribe un correo válido, ej. nombre@empresa.com.';
    if (!d.acepta) e.acepta = 'Necesitamos tu autorización para registrar tu asistencia.';
    return e;
  }

  function pintarErrores(errores) {
    let primero = null;
    [...CAMPOS, 'acepta'].forEach((c) => {
      const msg = errores[c] || '';
      document.getElementById('error-' + c).textContent = msg;
      const input = document.getElementById(c);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) input.setAttribute('aria-describedby', 'error-' + c);
      else input.removeAttribute('aria-describedby');
      const campo = input.closest('.campo');
      if (campo) campo.classList.toggle('invalido', Boolean(msg));
      if (msg && !primero) primero = input;
    });
    return primero;
  }

  // Limpia el error de un campo apenas la persona lo corrige
  form.addEventListener('input', (e) => {
    const id = e.target.id;
    if (![...CAMPOS, 'acepta'].includes(id)) return;
    const err = document.getElementById('error-' + id);
    if (err && err.textContent) {
      err.textContent = '';
      e.target.setAttribute('aria-invalid', 'false');
      e.target.closest('.campo')?.classList.remove('invalido');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    estado.textContent = '';

    const datos = {
      nombre: form.nombre.value.trim(),
      empresa: form.empresa.value.trim(),
      cargo: form.cargo.value.trim(),
      celular: form.celular.value.trim(),
      correo: form.correo.value.trim(),
      alergia: form.alergia.value.trim(), // opcional
      acepta: form.acepta.checked,
      sitio: form.sitio.value,
      autorizacionVersion: 'v2-2026-10', // cambió el texto de autorización (alergias)
    };

    const primero = pintarErrores(validarLocal(datos));
    if (primero) { primero.focus(); return; }

    enviar.disabled = true;
    enviar.textContent = 'Enviando…';

    try {
      const r = await fetch('/api/confirmaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const resp = await r.json().catch(() => ({}));

      if (r.ok && resp.ok) {
        const nombre = resp.nombre || datos.nombre.split(' ')[0];
        document.getElementById('gracias-titulo').textContent = `¡Te esperamos, ${nombre}!`;
        document.getElementById('gracias-texto').textContent =
          `Tu asistencia quedó confirmada. Te enviaremos los detalles completos a ${datos.correo}.`;
        document.getElementById('campos').hidden = true;
        const gracias = document.getElementById('gracias');
        gracias.hidden = false;
        form.classList.add('enviado');
        gracias.focus({ preventScroll: true });
        gracias.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'center' });
        return;
      }

      if (resp.errores) {
        const p = pintarErrores(resp.errores);
        if (p) p.focus();
      } else {
        estado.textContent = resp.mensaje || 'No pudimos registrar tu confirmación. Intenta de nuevo en un momento.';
      }
    } catch {
      estado.textContent = 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
    } finally {
      enviar.disabled = false;
      enviar.textContent = 'Enviar confirmación';
    }
  });
})();
