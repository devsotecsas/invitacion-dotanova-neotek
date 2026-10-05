(() => {
  'use strict';

  const body = document.body;
  const portada = document.getElementById('portada');
  const engranaje = portada.querySelector('.engranaje');
  const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------
  // 1. Portada → invitación
  //    Pasa sola a los ~3,4 s, o antes si la persona toca, hace scroll o pulsa una tecla.
  // ------------------------------------------------------------
  const ESPERA_AUTOMATICA = 3400; // ms que se queda la portada
  const MINIMO_ANTES_DE_SALTAR = 700; // evita saltarla por un toque accidental al abrir
  const inicio = performance.now();
  let saliendo = false;

  function calcularZoom() {
    // El engranaje debe crecer hasta que su parte más angosta (fondo de los dientes,
    // ~41% del ancho) cubra toda la pantalla.
    const ancho = engranaje.getBoundingClientRect().width || 300;
    const mitadDiagonal = Math.hypot(window.innerWidth, window.innerHeight) / 2;
    return ((mitadDiagonal / (ancho * 0.41)) * 1.08).toFixed(2);
  }

  function mostrarInvitacion() {
    body.classList.remove('bloqueado');
    body.classList.add('listo');
    portada.remove();
  }

  function salir() {
    if (saliendo) return;
    saliendo = true;
    portada.style.setProperty('--zoom', calcularZoom());
    // forzar layout para que la transición arranque desde el estado actual
    void portada.offsetWidth;
    portada.classList.add('saliendo');
    body.classList.add('listo');
    window.setTimeout(mostrarInvitacion, reducido ? 450 : 1150);
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
    requestAnimationFrame(() => document.getElementById('confirmar').scrollIntoView());
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
  // 2. Logos oficiales: si existen en /assets/logos/, reemplazan a los de respaldo
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
  // 3. Botón "Confirma tu asistencia" → formulario
  // ------------------------------------------------------------
  const seccionConfirmar = document.getElementById('confirmar');
  document.getElementById('ir-a-confirmar').addEventListener('click', (e) => {
    e.preventDefault();
    seccionConfirmar.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('nombre').focus({ preventScroll: true }), reducido ? 0 : 700);
  });

  // ------------------------------------------------------------
  // 4. Formulario
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
      acepta: form.acepta.checked,
      sitio: form.sitio.value,
      autorizacionVersion: 'v1-2026-10',
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
