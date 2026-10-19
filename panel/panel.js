(() => {
  'use strict';

  // Todo texto que viene de los datos se inserta con textContent, nunca con innerHTML.
  const $ = (id) => document.getElementById(id);
  const ACTUALIZAR_CADA = 60 * 1000;
  const ZONA = 'America/Bogota';
  const fechaHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const soloHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const diaClave = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
  const diaTexto = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

  let filas = [];
  let cargando = false;

  function el(tag, clase, texto) {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
    return nodo;
  }
  const fecha = (iso) => (iso ? fechaHora.format(new Date(iso)) : '');
  const esConfirmado = (r) => r.respuesta === 'Confirmado';
  const personas = (r) => Number(r.personas) || 0;

  // ---------- cifras ----------
  function cifra(titulo, filtro, valor) {
    const total = valor(filas.filter(filtro));
    const actual = valor(filas.filter((r) => filtro(r) && r.version === 'Actual'));
    const potencial = valor(filas.filter((r) => filtro(r) && r.version === 'Potencial'));
    const sinVersion = total - actual - potencial; // registros anteriores a las dos versiones
    const tarjeta = el('div', 'cifra');
    tarjeta.append(el('p', 'cifra-titulo', titulo), el('p', 'cifra-numero', total));
    const desglose = el('p', 'cifra-desglose');
    desglose.textContent = `Actual ${actual} · Potencial ${potencial}` + (sinVersion ? ` · Sin versión ${sinVersion}` : '');
    tarjeta.append(desglose);
    return tarjeta;
  }
  function pintarCifras() {
    const contar = (lista) => lista.length;
    $('cifras').replaceChildren(
      cifra('Respuestas recibidas', () => true, contar),
      cifra('Confirmados', esConfirmado, contar),
      cifra('Personas confirmadas', esConfirmado, (lista) => lista.reduce((s, r) => s + personas(r), 0)),
      cifra('Acompañantes', (r) => esConfirmado(r) && personas(r) === 2, contar),
      cifra('Declinaron', (r) => r.respuesta === 'Declinó', contar),
    );
  }

  // ---------- respuestas por día (barras con HTML/CSS) ----------
  function pintarDias() {
    const porDia = new Map();
    filas.forEach((r) => {
      if (!r.fecha) return;
      const dia = diaClave.format(new Date(r.fecha));
      const d = porDia.get(dia) || { confirmado: 0, declino: 0 };
      if (esConfirmado(r)) d.confirmado++; else d.declino++;
      porDia.set(dia, d);
    });
    const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b));
    const maximo = Math.max(1, ...dias.map(([, d]) => d.confirmado + d.declino));
    const contenedor = $('dias');
    if (!dias.length) return contenedor.replaceChildren(el('p', 'vacio', 'Todavía no hay respuestas.'));
    contenedor.replaceChildren(...dias.map(([dia, d]) => {
      const total = d.confirmado + d.declino;
      const fila = el('div', 'dia');
      const etiqueta = diaTexto.format(new Date(dia + 'T12:00:00Z'));
      fila.append(el('span', 'dia-fecha', etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)));
      const barra = el('span', 'dia-barra');
      barra.setAttribute('role', 'img');
      barra.setAttribute('aria-label', `${total} respuestas: ${d.confirmado} confirmados, ${d.declino} declinaron`);
      const conf = el('span', 'dia-confirmado');
      conf.style.width = `${(d.confirmado / maximo) * 100}%`;
      const dec = el('span', 'dia-declino');
      dec.style.width = `${(d.declino / maximo) * 100}%`;
      barra.append(conf, dec);
      fila.append(barra, el('span', 'dia-total', total));
      return fila;
    }));
  }

  // ---------- tablas (en celular cada fila es una tarjeta) ----------
  function tabla(columnas, lista, vacio) {
    if (!lista.length) return el('p', 'vacio', vacio);
    const marco = el('div', 'tabla-marco');
    const t = el('table', 'tabla');
    marco.append(t);
    const encabezado = el('tr');
    columnas.forEach((c) => encabezado.append(el('th', null, c.titulo)));
    const thead = el('thead');
    thead.append(encabezado);
    t.append(thead);
    const cuerpo = el('tbody');
    lista.forEach((r) => {
      const tr = el('tr');
      columnas.forEach((c) => {
        const td = el('td');
        td.setAttribute('data-label', c.titulo);
        const v = c.valor(r);
        if (v instanceof Node) td.append(v); else td.textContent = v ?? '';
        if (c.clase) td.className = c.clase;
        tr.append(td);
      });
      cuerpo.append(tr);
    });
    t.append(cuerpo);
    return marco;
  }

  function pintarAlergias() {
    const lista = [];
    filas.filter(esConfirmado).forEach((r) => {
      if (r.alergia) lista.push({ persona: r.nombre, empresa: r.empresa, tipo: 'Invitado', alergia: r.alergia });
      if (r.acompanante_alergia) {
        lista.push({ persona: r.acompanante_nombre, empresa: r.acompanante_cargo_empresa, tipo: `Acompañante de ${r.nombre}`, alergia: r.acompanante_alergia });
      }
    });
    $('alergias').replaceChildren(tabla([
      { titulo: 'Persona', valor: (a) => a.persona },
      { titulo: 'Empresa', valor: (a) => a.empresa },
      { titulo: 'Invitado o acompañante', valor: (a) => a.tipo },
      { titulo: 'Alergia', valor: (a) => a.alergia, clase: 'destacado' },
    ], lista, 'Nadie ha reportado alergias.'));
  }

  function pintarCoordinar() {
    const lista = filas.filter((r) => r.respuesta === 'Declinó' && r.coordinar_otro_espacio === 'Sí')
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    $('coordinar').replaceChildren(tabla([
      { titulo: 'Nombre', valor: (r) => r.nombre },
      { titulo: 'Empresa', valor: (r) => r.empresa },
      { titulo: 'Versión', valor: (r) => r.version },
      { titulo: 'Fecha', valor: (r) => fecha(r.fecha) },
    ], lista, 'Nadie lo ha pedido todavía.'));
  }

  function marcas(r) {
    const contenedor = el('span', 'marcas');
    const veces = Number(r.respuestas_mismo_id) || 0;
    if (veces > 1) contenedor.append(el('span', 'marca-aviso', `Enlace usado ${veces} veces`));
    if (r.posible_spam === 'Sí') contenedor.append(el('span', 'marca-aviso marca-spam', 'Posible spam'));
    return contenedor;
  }

  function pintarTodas() {
    const texto = $('buscar').value.trim().toLowerCase();
    const respuesta = $('filtro-respuesta').value;
    const version = $('filtro-version').value;
    const lista = filas
      .filter((r) => !respuesta || r.respuesta === respuesta)
      .filter((r) => !version || r.version === version)
      .filter((r) => !texto || [r.nombre, r.empresa, r.cargo, r.celular, r.correo, r.id_invitado, r.acompanante_nombre, r.acompanante_cargo_empresa]
        .some((v) => String(v || '').toLowerCase().includes(texto)))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))); // la más reciente primero
    $('conteo').textContent = `${lista.length} de ${filas.length} respuestas`;
    $('todas').replaceChildren(tabla([
      { titulo: 'Fecha', valor: (r) => fecha(r.fecha), clase: 'corto' },
      {
        titulo: 'Respuesta',
        valor: (r) => {
          const nodo = el('span', null);
          nodo.append(el('span', r.respuesta === 'Confirmado' ? 'etiqueta-ok' : 'etiqueta-no', r.respuesta), marcas(r));
          return nodo;
        },
      },
      { titulo: 'Versión', valor: (r) => r.version || 'Sin versión', clase: 'corto' },
      { titulo: 'Id', valor: (r) => r.id_invitado, clase: 'corto' },
      { titulo: 'Personas', valor: (r) => r.personas, clase: 'corto' },
      { titulo: 'Nombre', valor: (r) => r.nombre, clase: 'destacado' },
      { titulo: 'Empresa', valor: (r) => r.empresa },
      { titulo: 'Cargo', valor: (r) => r.cargo },
      { titulo: 'Celular', valor: (r) => r.celular, clase: 'corto' },
      { titulo: 'Correo', valor: (r) => r.correo },
      { titulo: 'Acompañante', valor: (r) => [r.acompanante_nombre, r.acompanante_cargo_empresa].filter(Boolean).join(' · ') },
    ], lista, 'No hay respuestas con estos filtros.'));
  }

  function pintar() {
    pintarCifras();
    pintarDias();
    pintarAlergias();
    pintarCoordinar();
    pintarTodas();
  }

  // ---------- datos ----------
  async function cargar() {
    if (cargando) return;
    cargando = true;
    const boton = $('actualizar');
    boton.disabled = true;
    try {
      const pruebas = $('mostrar-pruebas').checked ? '1' : '0';
      const r = await fetch(`/api/panel/datos?pruebas=${pruebas}`, { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { location.reload(); return; } // la sesión venció: vuelve a pedir la clave
      const datos = await r.json();
      if (!r.ok || !datos.ok) throw new Error(datos.mensaje || 'error');
      filas = datos.agrupadas;
      pintar();
      $('aviso').hidden = true;
      $('actualizado').textContent = `Actualizado a las ${soloHora.format(new Date(datos.generado))} · ${datos.auditoria.length} filas en auditoría`;
    } catch {
      $('aviso').hidden = false;
      $('aviso').textContent = 'No se pudieron cargar los datos. Se reintenta en un minuto.';
    } finally {
      cargando = false;
      boton.disabled = false;
    }
  }

  $('actualizar').addEventListener('click', cargar);
  $('mostrar-pruebas').addEventListener('change', cargar);
  $('buscar').addEventListener('input', pintarTodas);
  ['filtro-respuesta', 'filtro-version'].forEach((id) => $(id).addEventListener('change', pintarTodas));
  window.setInterval(cargar, ACTUALIZAR_CADA);
  cargar();
})();
