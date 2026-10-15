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

  // Salida (2,8 s): el texto se desvanece (0,6 s); el engranaje se acerca de 1 a 1,3 en
  // toda la salida, a velocidad constante; desde 0,8 s la portada entera se disuelve
  // hacia la invitación. Con movimiento reducido: solo fundidos.
  const SALIDA = reducido ? 1600 : 2800;
  const SALIDA_TEXTO = 600;
  const SALIDA_FUNDIDO_DESDE = reducido ? SALIDA_TEXTO : 800;
  const ZOOM_ENGRANAJE = 1.3;

  const inicio = performance.now();
  let saliendo = false;

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
    if (!reducido) {
      engranaje.animate([{ transform: 'scale(1)' }, { transform: `scale(${ZOOM_ENGRANAJE})` }], {
        duration: SALIDA,
        easing: 'linear',
        fill: 'forwards',
      });
    }

    const fundido = portada.animate([{ opacity: 1 }, { opacity: 0 }], {
      delay: SALIDA_FUNDIDO_DESDE,
      duration: SALIDA - SALIDA_FUNDIDO_DESDE,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    // Con el fundido entran el contenido de la invitación y el acercamiento de su foto (styles.css).
    window.setTimeout(() => body.classList.add('listo'), SALIDA_FUNDIDO_DESDE);
    fundido.finished.then(mostrarInvitacion, mostrarInvitacion);
  }

  function intentarSalir() {
    if (performance.now() - inicio < MINIMO_ANTES_DE_SALTAR) return;
    salir();
  }

  // Enlaces directos a los formularios (ej. https://.../?p=actuales&id=A-001#confirmar
  // o #declinar): sin portada.
  const modoDirecto = { '#confirmar': 'reserva', '#declinar': 'declina' }[location.hash];
  if (modoDirecto) {
    portada.remove();
    body.classList.remove('bloqueado');
    document.querySelector('.fondo').classList.add('directo');
    body.classList.add('listo');
    // Lo que usa variables declaradas más abajo (fondo, textura, formularios) va dentro del rAF:
    // llamarlo aquí lanza un ReferenceError y deja el formulario sin su manejador de envío.
    requestAnimationFrame(() => {
      mostrarFormulario(modoDirecto);
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
  // 4. Botones de la invitación → formulario de reserva o de declinación
  //    (con el mismo descenso); "Volver a la invitación" sube de nuevo.
  // ------------------------------------------------------------
  const formReserva = document.getElementById('form-reserva');
  const formDeclina = document.getElementById('form-declina');
  const panelRespuesta = document.getElementById('respuesta');
  const tituloSeccion = document.getElementById('titulo-confirmar');

  // La versión la pone el servidor en <body>; el id del invitado viene en la URL (&id=XXX).
  const VERSION = body.dataset.version === 'Actual' ? 'Actual' : 'Potencial';
  const ID_INVITADO = (() => {
    const id = new URLSearchParams(location.search).get('id') || '';
    return /^[A-Za-z0-9-]{1,20}$/.test(id) ? id : '';
  })();

  function mostrarFormulario(modo) {
    if (!panelRespuesta.hidden) {
      // Ya respondió: al volver a elegir, empieza con el formulario limpio.
      panelRespuesta.hidden = true;
      [formReserva, formDeclina].forEach((f) => { f.reset(); limpiarErrores(f); });
      actualizarAcompanante();
    }
    formReserva.hidden = modo === 'declina';
    formDeclina.hidden = modo !== 'declina';
    tituloSeccion.textContent = modo === 'declina' ? 'No podré asistir' : 'Reservar mi lugar';
    return modo === 'declina' ? formDeclina : formReserva;
  }

  function irAFormulario(modo) {
    const form = mostrarFormulario(modo);
    pedirTextura();
    seccionConfirmar.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => form.querySelector('input').focus({ preventScroll: true }), reducido ? 0 : 700);
  }

  document.getElementById('ir-a-confirmar').addEventListener('click', (e) => { e.preventDefault(); irAFormulario('reserva'); });
  document.getElementById('ir-a-declinar').addEventListener('click', (e) => { e.preventDefault(); irAFormulario('declina'); });

  document.querySelectorAll('.volver').forEach((enlace) => {
    enlace.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reducido ? 'auto' : 'smooth' });
      document.getElementById('titulo-invitacion').focus({ preventScroll: true });
    });
  });

  // ------------------------------------------------------------
  // 5. Formularios
  // ------------------------------------------------------------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const TIEMPO_LIMITE_ENVIO = 20000; // ms
  const texto = (form, nombre) => (form.elements[nombre] ? form.elements[nombre].value.trim() : '');

  function personasElegidas() {
    const elegido = formReserva.querySelector('input[name="personas"]:checked');
    return elegido ? Number(elegido.value) : 0;
  }

  // Los campos del acompañante solo existen si elige "Asistiré con un acompañante";
  // si vuelve a "solo" se ocultan, se desactivan y se vacían.
  function actualizarAcompanante() {
    const con = personasElegidas() === 2;
    formReserva.querySelectorAll('[data-acompanante]').forEach((campo) => {
      campo.hidden = !con;
      campo.querySelectorAll('input').forEach((input) => {
        input.disabled = !con;
        if (!con) input.value = '';
      });
      if (!con) limpiarErrores(campo);
    });
  }

  const FORMULARIOS = {
    reserva: {
      form: formReserva,
      prefijo: '',
      campos: ['nombre', 'empresa', 'cargo', 'celular', 'correo', 'personas', 'acompanante_nombre', 'acompanante_cargo_empresa', 'acepta'],
      textoBoton: 'Confirmar asistencia',
      datos() {
        const f = formReserva;
        const personas = personasElegidas();
        const con = personas === 2;
        return {
          respuesta: 'Confirmado',
          version: VERSION,
          id_invitado: ID_INVITADO,
          nombre: texto(f, 'nombre'),
          empresa: texto(f, 'empresa'),
          cargo: texto(f, 'cargo'),
          celular: texto(f, 'celular'),
          correo: texto(f, 'correo'),
          personas: personas || null,
          acompanante_nombre: con ? texto(f, 'acompanante_nombre') : '',
          acompanante_cargo_empresa: con ? texto(f, 'acompanante_cargo_empresa') : '',
          acompanante_alergia: con ? texto(f, 'acompanante_alergia') : '', // opcional
          alergia: texto(f, 'alergia'), // opcional
          acepta: f.elements.acepta.checked,
          sitio: f.elements.sitio.value,
          autorizacionVersion: 'v3-reserva-2026-10',
        };
      },
      validar(d) {
        const e = {};
        if (d.nombre.length < 3) e.nombre = 'Falta el nombre completo.';
        if (d.empresa.length < 2) e.empresa = 'Falta el nombre de la empresa.';
        if (d.cargo.length < 2) e.cargo = 'Falta el cargo.';
        const dig = d.celular.replace(/\D/g, '');
        if (dig.length < 7 || dig.length > 15) e.celular = 'El número de celular no es válido.';
        if (!EMAIL_RE.test(d.correo)) e.correo = 'El correo no es válido. Ejemplo: nombre@empresa.com';
        if (d.personas !== 1 && d.personas !== 2) e.personas = 'Falta elegir: asistir solo o con un acompañante.';
        if (d.personas === 2 && d.acompanante_nombre.length < 3) e.acompanante_nombre = 'Falta el nombre completo del acompañante.';
        if (d.personas === 2 && d.acompanante_cargo_empresa.length < 2) e.acompanante_cargo_empresa = 'Faltan el cargo y la empresa del acompañante.';
        if (!d.acepta) e.acepta = 'Falta la autorización de tratamiento de datos.';
        return e;
      },
    },
    declina: {
      form: formDeclina,
      prefijo: 'd-',
      campos: ['nombre', 'empresa', 'acepta'],
      textoBoton: 'Enviar respuesta',
      datos() {
        const f = formDeclina;
        return {
          respuesta: 'Declinó',
          version: VERSION,
          id_invitado: ID_INVITADO,
          nombre: texto(f, 'nombre'),
          empresa: texto(f, 'empresa'),
          coordinar: f.elements.coordinar.checked,
          acepta: f.elements.acepta.checked,
          sitio: f.elements.sitio.value,
          autorizacionVersion: 'v1-declina-2026-10',
        };
      },
      validar(d) {
        const e = {};
        if (d.nombre.length < 3) e.nombre = 'Falta el nombre completo.';
        if (d.empresa.length < 2) e.empresa = 'Falta el nombre de la empresa.';
        if (!d.acepta) e.acepta = 'Falta la autorización de tratamiento de datos.';
        return e;
      },
    },
  };

  function marcarCampo(elemento, error, msg) {
    error.textContent = msg;
    elemento.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (elemento.matches('input:not([type="checkbox"])') || elemento.matches('[role="radiogroup"]')) {
      if (msg) elemento.setAttribute('aria-describedby', error.id);
      else if (elemento.getAttribute('aria-describedby') === error.id) elemento.removeAttribute('aria-describedby');
    }
    elemento.closest('.campo')?.classList.toggle('invalido', Boolean(msg));
  }

  function pintarErrores(conf, errores) {
    let primero = null;
    conf.campos.forEach((c) => {
      const elemento = document.getElementById(conf.prefijo + c);
      const error = document.getElementById('error-' + conf.prefijo + c);
      if (!elemento || !error) return;
      const msg = errores[c] || '';
      marcarCampo(elemento, error, msg);
      if (msg && !primero) primero = elemento.matches('input') ? elemento : elemento.querySelector('input');
    });
    return primero;
  }

  function limpiarErrores(contenedor) {
    contenedor.querySelectorAll('.campo-error').forEach((error) => {
      const elemento = document.getElementById(error.id.replace(/^error-/, ''));
      if (elemento) marcarCampo(elemento, error, '');
      else error.textContent = '';
    });
  }

  function mostrarRespuesta(modo, d, nombreServidor) {
    const nombre = nombreServidor || d.nombre.split(' ')[0];
    const titulo = document.getElementById('gracias-titulo');
    const textoRespuesta = document.getElementById('gracias-texto');
    const calendario = document.getElementById('calendario');
    // textContent: los nombres nunca se insertan como HTML
    if (modo === 'declina') {
      titulo.textContent = `Gracias por avisarnos, ${nombre}.`;
      textoRespuesta.textContent = 'Lamentamos no coincidir esta vez. Seguiremos en contacto, y esperamos encontrarnos pronto.';
      calendario.hidden = true;
    } else if (d.personas === 2) {
      titulo.textContent = `Gracias, ${nombre}. Quedaron reservados dos lugares.`;
      textoRespuesta.textContent = `Uno de ellos a nombre de ${d.acompanante_nombre}. Muy pronto enviaremos por correo la hora, el lugar y los detalles de la noche.`;
      calendario.hidden = false;
    } else {
      titulo.textContent = `Gracias, ${nombre}. El lugar quedó reservado.`;
      textoRespuesta.textContent = 'Nos vemos en Cartagena el 24 de noviembre. Muy pronto enviaremos por correo la hora, el lugar y los detalles de la noche.';
      calendario.hidden = false;
    }
    formReserva.hidden = true;
    formDeclina.hidden = true;
    panelRespuesta.hidden = false;
    const gracias = document.getElementById('gracias');
    gracias.focus({ preventScroll: true });
    gracias.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'center' });
  }

  Object.entries(FORMULARIOS).forEach(([modo, conf]) => {
    const { form } = conf;
    const boton = form.querySelector('button[type="submit"]');
    const estado = form.querySelector('.formulario-estado');

    // Limpia el error de un campo apenas la persona lo corrige
    form.addEventListener('input', (e) => {
      const campo = e.target.name === 'personas' ? 'personas' : e.target.id.slice(conf.prefijo.length);
      if (!conf.campos.includes(campo)) return;
      const elemento = document.getElementById(conf.prefijo + campo);
      const error = document.getElementById('error-' + conf.prefijo + campo);
      if (elemento && error && error.textContent) marcarCampo(elemento, error, '');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      estado.textContent = '';
      const datos = conf.datos();
      const primero = pintarErrores(conf, conf.validar(datos));
      if (primero) { primero.focus(); return; }

      boton.disabled = true;
      boton.textContent = 'Enviando…';
      // Si la conexión se cuelga, a los 20 s se corta para que el botón no quede en "Enviando…".
      // El servidor pudo haber guardado la respuesta igual; reenviar no duplica en el CSV
      // agrupado, que se queda con la más reciente por id o correo.
      const control = new AbortController();
      const limite = window.setTimeout(() => control.abort(), TIEMPO_LIMITE_ENVIO);
      try {
        const r = await fetch('/api/confirmaciones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos),
          signal: control.signal,
        });
        // una respuesta que no es JSON (p. ej. un error del proxy) se trata como fallo del servidor
        const resp = await r.json().catch((err) => { if (err.name === 'AbortError') throw err; return {}; });
        if (r.ok && resp.ok) {
          mostrarRespuesta(modo, datos, resp.nombre);
          return;
        }
        if (resp.errores) {
          const p = pintarErrores(conf, resp.errores);
          if (p) p.focus();
        } else {
          estado.textContent = resp.mensaje || 'No se pudo registrar la respuesta. Se puede intentar de nuevo en un momento.';
        }
      } catch (err) {
        estado.textContent = err.name === 'AbortError'
          ? 'La conexión tardó demasiado. Hay que intentar de nuevo.'
          : 'No hay conexión con el servidor. Conviene revisar el internet e intentar de nuevo.';
      } finally {
        window.clearTimeout(limite);
        boton.disabled = false;
        boton.textContent = conf.textoBoton;
      }
    });
  });

  formReserva.addEventListener('change', (e) => {
    if (e.target.name === 'personas') actualizarAcompanante();
  });
})();
