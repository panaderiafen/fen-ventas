// ═══════════════════════════════════════════════
//  Sistema Fën — pantalla Catálogo  v0.72.0
//  Etapa 0 "Qué está vivo" (#catalogo): recetas por área, productos de la caja y productos B2B, con lo que se vendió en
//  60 días, quién usa cada receta y qué se sugiere archivar. Marcar "Vivo", archivar (se deshace con "Reactivar") y
//  archivar las sugeridas de una vez, con confirmación en la página. Las reglas puras están en catalogo-modelo.js y las
//  lecturas y escrituras en catalogo.js. Queda espacio para las próximas pestañas del catálogo (una sola lista de productos).
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, hace, dialogo }
// ═══════════════════════════════════════════════
import * as C from './catalogo.js?v=0.138.0';
import * as CM from './catalogo-modelo.js?v=0.138.0';

const st = { D: null, filtro: 'por_decidir', q: '', msg: '', err: '', cargando: false, ocupado: false };
export const estado = st;
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 });
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaTxt = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : ''; };
const GRUPOS = { recetas: 'Receta', caja: 'Producto de la caja', b2b: 'Producto B2B' };
const CANAL = { caja: 'caja', b2b: 'B2B' };
let H = null;

const TXT_ETAPA = 'Hoy Fën produce solo lo base (pan, croissant, pan de chocolate y café) y algo de reventa. Pastelería y los croissants rellenos están en pausa.\nEsta etapa es para limpiar antes de armar un solo catálogo de productos: marca "Vivo" lo que sigue y archiva lo demás.\nArchivar esconde la receta o el producto en Cocina, en la caja y en B2B, pero guarda toda su historia (ventas, costos, planes) y se deshace con "Reactivar". Nada se borra.';
const TXT_SUG = 'Sugerido archivar:\n· un producto que no se vendió en los últimos 60 días;\n· una receta que no usa ninguna receta viva (como ingrediente) y que no se vendió en 60 días por ningún producto. Una sub receta que solo usan recetas también sugeridas, también se sugiere.\nEs solo una sugerencia: revisa la lista y desmarca lo que quieras dejar.';
const TXT_REVENTA = 'Reventa es lo que se compra hecho para venderlo tal cual. Desde la v0.73.0 tiene su propia pestaña en el Catálogo (Reventa), con su ID, su costo y su proveedor; en los productos de la caja y de B2B se ve con la marca "Reventa" (el vínculo de Finanzas → Márgenes → Asociar productos).\nArriba, Vivo y Archivado cuentan también la reventa (activa = vivo).';
const TXT_LECTURAS = 'Lo que se leyó de cada base al abrir esta pantalla (documentos). Las ventas de 60 días (resúmenes de cierre de la caja y órdenes de B2B) quedan resumidas 6 horas, también en este navegador; las recetas, los productos y los vínculos usan la misma memoria de Producción y Finanzas.\nCambiar el filtro o buscar: 0 lecturas. "Actualizar" vuelve a leer todo.';

let pestana = '';
// v0.74.0: pestañas Productos (el catálogo único) y Armar el catálogo (una vez), además de Qué está vivo y Reventa
const PESTANAS = [['', '#catalogo', 'Qué está vivo'], ['productos', '#catalogo/productos', 'Productos'], ['armar', '#catalogo/armar', 'Armar el catálogo'], ['reventa', '#catalogo/reventa', 'Reventa']];
const cab = (extra = '') => `<div class="cabecera"><div><h1 id="t-catalogo">Catálogo</h1><p>Recetas, productos y reventa de Fën</p></div>
  ${pestana === '' ? `<div class="botones" style="margin:0;align-items:center"><button type="button" class="btn-sec btn-chico" id="cat-actualizar">Actualizar</button>${H.info('Actualizar', TXT_LECTURAS)}</div>` : extra}</div>
  <nav class="pestanas" role="tablist" aria-label="Partes del Catálogo">${PESTANAS.map(([k, href, t]) => `<a role="tab" href="${href}" aria-selected="${pestana === k}">${t}</a>`).join('')}</nav>`;

export async function pintar(el, sub, h) {
  H = h;
  pestana = ['reventa', 'productos', 'armar'].includes(sub) ? sub : '';
  // v0.73.0: pestaña Reventa (cat_reventa en fen-gastos). Usa lo que "Qué está vivo" ya tiene en memoria (vínculos y productos) si está.
  if (pestana === 'reventa') { const VR = await import('./vista-reventa.js?v=0.138.0'); return VR.pintar(el, h, { cab, datos: () => st.D }); }
  // v0.74.0: Productos y Armar el catálogo (vista-productos.js)
  if (pestana === 'productos' || pestana === 'armar') { const VP = await import('./vista-productos.js?v=0.138.0'); return VP.pintar(el, pestana, h, { cab }); }
  if (!el.dataset.catEventos) { el.dataset.catEventos = '1'; conectar(el); }
  // Cada apertura arma con lo que está en memoria (las ventas de 60 días quedan 6 horas; lo demás, la memoria de siempre)
  el.innerHTML = cab() + '<section class="tarjeta"><div class="vacio" style="border:0">Leyendo recetas, productos y ventas de 60 días…</div></section>';
  try { st.D = await C.cargar({ forzar: !!st.forzar }); st.err = ''; }
  catch (e) { st.forzar = false; el.innerHTML = cab() + `<section class="tarjeta"><p class="error">${H.esc((e && e.message) || H.mensajeError(e))}</p></section>`; return; }
  st.forzar = false;
  pintarTodo(el);
}

function avisos(D) {
  const a = [];
  if (D.estados.cocina !== 'ok') a.push('Cocina (fen-produccion) no está conectada: no se ven las recetas. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.');
  if (D.estados.gastos !== 'ok') a.push('Finanzas (fen-gastos) no está conectada: sin los vínculos producto → receta ni la marca "Vivo". Conéctala en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>.');
  if (D.estados.b2b !== 'ok') a.push('B2B (fen-b2b) no está conectada: no se ven sus productos ni sus ventas. Conéctala en <a href="#b2b">Ventas a empresas</a>.');
  return a.map(x => `<p class="aviso">${x}</p>`).join('');
}

function pintarTodo(el) {
  const D = st.D, V = D.vista, r = V.resumen, u = D.uso;
  el.innerHTML = cab() + `
    <section class="tarjeta" aria-labelledby="t-cat-vivo">
      <div class="titulo-fila"><h2 id="t-cat-vivo">Etapa 0 · Qué está vivo ${H.info('Qué está vivo', TXT_ETAPA)}</h2><span class="ayuda">Ventas del ${H.esc(fechaTxt(D.desde))} al ${H.esc(fechaTxt(D.hoy))} (60 días)</span></div>
      <p class="ayuda">Marca lo que sigue vivo y archiva lo que ya no se usa. Archivar lo esconde en Cocina, la caja y B2B, pero guarda su historia y se puede deshacer.</p>
      ${avisos(D)}
      <div class="cat-resumen" role="group" aria-label="Resumen">
        <span class="chip c-amarillo" id="cat-n-por_decidir">Por decidir ${nf(r.por_decidir)}</span><span class="chip c-verde" id="cat-n-vivo">Vivo ${nf(r.vivo)}</span><span class="chip c-gris" id="cat-n-archivado">Archivado ${nf(r.archivado)}</span>
        <button type="button" class="btn-sec cat-btn-sug" id="cat-sugeridas" ${V.nSugeridas ? '' : 'disabled'}>${H.icono('cajon', 16)} ${V.nSugeridas === 1 ? 'Archivar la sugerida' : `Archivar las ${nf(V.nSugeridas)} sugeridas`}</button>${H.info('Sugerido archivar', TXT_SUG)}
      </div>
      <div class="cat-filtros">
        <div class="chips" role="group" aria-label="Mostrar">${CM.FILTROS.map(([k, t]) => `<button type="button" class="chip-filtro" data-cat-filtro="${k}" aria-pressed="${st.filtro === k}">${t}</button>`).join('')}</div>
        <div class="fin-buscar">${H.icono('lupa', 18)}<label class="sr" for="cat-q">Buscar por nombre o ID</label><input type="search" id="cat-q" placeholder="Buscar por nombre o ID…" autocomplete="off" spellcheck="false" value="${H.esc(st.q)}"></div>
      </div>
      <p class="ok-texto" id="cat-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="cat-err" role="alert">${H.esc(st.err)}</p>
      ${V.reventa && (V.reventa.activos || V.reventa.archivados) ? `<p class="ayuda" id="cat-reventa-n">Incluye la reventa: ${nf(V.reventa.activos)} ${V.reventa.activos === 1 ? 'activa' : 'activas'} (vivo) · ${nf(V.reventa.archivados)} ${V.reventa.archivados === 1 ? 'archivada' : 'archivadas'} · <a href="#catalogo/reventa">ver Reventa</a></p>` : ''}
      <p class="ayuda" id="cat-lecturas">Lecturas al abrir: caja ${nf(u.caja)} · B2B ${nf(u.b2b)} · Cocina ${nf(u.cocina)} · Finanzas ${nf(u.finanzas)}</p>
    </section>
    <div id="cat-listas" class="cat-listas"></div>`;
  pintarListas();
}

// ── Listas ──
const chipEstadoReceta = f => {
  const c = f.estadoReceta === 'consolidada' || f.estadoReceta === 'aprobada' ? 'c-verde' : f.estadoReceta === 'archivada' ? 'c-gris' : f.estadoReceta === 'anulada' ? 'c-rojo' : 'c-azul';
  return `<span class="chip chip-chico ${c}">${H.esc(f.estadoTxt)}</span>`;
};
const chipDecision = f => `<span class="chip chip-chico ${{ por_decidir: 'c-amarillo', vivo: 'c-verde', archivado: 'c-gris' }[f.estado]}" data-cat-estado="${f.estado}">${CM.DECISIONES[f.estado]}</span>`;
const chipSug = f => f.sugerido ? `<span class="chip chip-chico c-naranja">Sugerido archivar</span>` : '';
const vendido = (cant, ultima, unidad = '') => cant > 0 ? `<b>${nf(cant)}</b>${unidad}${ultima ? ` · última ${H.esc(fechaTxt(ultima))}` : ''}` : '<span class="ayuda">0 en 60 días</span>';
function acciones(f) {
  const nom = H.esc(f.nombre);
  if (f.catalogoId) return `<a class="btn-sec btn-chico" href="#catalogo/productos/${H.esc(f.catalogoId)}" aria-label="Ver ${nom} en Productos">En Productos (${H.esc(f.catalogoId)})</a>`;   // v0.74.0
  if (f.archivado) return `<button type="button" class="btn-sec btn-chico" data-cat-react="${H.esc(f.clave)}" aria-label="Reactivar ${nom}">Reactivar</button>`;
  const sinGastos = st.D.estados.gastos !== 'ok';
  return `${f.decision ? '' : `<button type="button" class="btn-sec btn-chico" data-cat-vivo="${H.esc(f.clave)}" aria-label="Marcar vivo: ${nom}" ${sinGastos ? 'disabled' : ''}>${H.icono('check', 16)} Vivo</button>`}
    <button type="button" class="btn-sec btn-chico btn-peligro" data-cat-arch="${H.esc(f.clave)}" aria-label="Archivar ${nom}">Archivar</button>`;
}
const listaNombres = xs => xs.length ? xs.map(x => H.esc(x)).join(', ') : '<span class="ayuda">—</span>';
function filaReceta(f) {
  const vende = f.seVende.map(p => `${H.esc(p.nombre)} <span class="ayuda">(${CANAL[p.grupo]}${p.archivado ? ', archivado' : ''})</span>`);
  return `<div class="cat-fila${f.archivado ? ' cat-archivada' : ''}" data-cat-fila="${H.esc(f.clave)}">
    <div class="cat-info"><div class="cat-nombre"><b>${H.esc(f.nombre)}</b>${f.sub ? ' <span class="chip chip-chico c-lila">sub receta</span>' : ''}</div>
      <small class="cat-id">${H.esc(f.id)}${f.mpId ? ' · ' + H.esc(f.mpId) : ''}</small>
      <div class="cat-chips">${chipEstadoReceta(f)}${chipDecision(f)}${chipSug(f)}</div>
      ${f.archivadoInfo && f.archivadoInfo.por ? `<small class="ayuda">Archivada por ${H.esc(f.archivadoInfo.por)}${f.estadoAntes ? ` · antes: ${H.esc(CM.ESTADOS_RECETA[f.estadoAntes] || f.estadoAntes)}` : ''}</small>` : ''}</div>
    <dl class="cat-datos">
      <div><dt>Se usa en</dt><dd>${listaNombres(f.usadaEn.map(x => x.nombre))}</dd></div>
      <div><dt>Se vende como</dt><dd>${vende.length ? vende.join(', ') : '<span class="ayuda">—</span>'}</dd></div>
      <div><dt>Vendido en 60 días</dt><dd>${vendido(f.unidades, f.ultima, ' un')}</dd></div>
    </dl>
    <div class="cat-acc">${acciones(f)}</div></div>`;
}
function filaProducto(f) {
  return `<div class="cat-fila${f.archivado ? ' cat-archivada' : ''}" data-cat-fila="${H.esc(f.clave)}">
    <div class="cat-info"><div class="cat-nombre"><b>${H.esc(f.nombre)}</b>${f.reventa ? ' <span class="chip chip-chico c-azul">Reventa</span>' : ''}</div>
      <small class="cat-id">${H.esc(f.id)}</small>
      <div class="cat-chips"><span class="chip chip-chico ${f.archivado ? 'c-gris' : 'c-verde'}">${f.archivado ? 'Archivado' : 'Activo'}</span>${chipDecision(f)}${chipSug(f)}</div></div>
    <dl class="cat-datos">
      <div><dt>Área</dt><dd>${f.areaTxt ? H.esc(CM.nombreArea(f.areaTxt)) : '<span class="ayuda">—</span>'}</dd></div>
      <div><dt>Vínculo</dt><dd>${H.esc(f.vinculoTxt)}${f.vinculo.tipo === 'sin' && f.vinculo.catalogo ? ` <span class="ayuda">(catálogo: ${H.esc(f.vinculo.catalogo)})</span>` : ''}</dd></div>
      <div><dt>Vendido en 60 días</dt><dd>${vendido(f.cantidad, f.ultima)}</dd></div>
    </dl>
    <div class="cat-acc">${acciones(f)}</div></div>`;
}
function pintarListas() {
  const c = $('cat-listas'); if (!c) return;
  const V = st.D.vista, f = st.filtro, q = st.q;
  const vacio = t => `<div class="vacio">${t}</div>`;
  const nadaFiltro = () => vacio(q ? 'Nada con esa búsqueda.' : f === 'por_decidir' ? 'Nada por decidir aquí.' : 'Nada con este filtro.');
  // A · Recetas por área
  const rs = CM.filtrar(V.recetas, f, q);
  const areas = [...CM.ORDEN_AREAS, ...[...new Set(rs.map(x => x.area))].filter(a => !CM.ORDEN_AREAS.includes(a))];
  const porArea = areas.map(a => [a, rs.filter(x => x.area === a)]).filter(([, l]) => l.length);
  const recetasHtml = st.D.estados.cocina !== 'ok' ? '' : `<section class="tarjeta" aria-labelledby="t-cat-rec">
      <div class="titulo-fila"><h2 id="t-cat-rec">Recetas ${H.info('Recetas', 'Las recetas de Cocina (fen-produccion), por área. Las sub recetas (masas, masa madre, cremas) dicen "sub receta".\nSe usa en: las recetas vivas que la llevan como ingrediente. Una sub receta que usa una receta viva no se puede archivar sola: archívalas juntas.\nSe vende como: los productos de la caja y de B2B que llevan a esta receta (por el vínculo de Finanzas o por el ID de receta del catálogo), con lo vendido en 60 días en unidades de la receta.\nArchivar una receta la esconde en Cocina (listas, planificación, buscador del editor) y en Finanzas (propuestas, costos de Productos). Sus números de meses pasados siguen contando.')}</h2><span class="ayuda">${nf(rs.length)} de ${nf(V.recetas.length)}</span></div>
      ${porArea.length ? porArea.map(([a, l]) => `<div class="cat-area"><h3>${H.esc(CM.AREAS[a] || a || 'Sin área')} <span class="ayuda">${nf(l.length)}</span></h3>${l.map(filaReceta).join('')}</div>`).join('') : nadaFiltro()}
    </section>`;
  const prods = (grupo, titulo, ayuda, est) => {
    const xs = CM.filtrar(V[grupo], f, q);
    return `<section class="tarjeta" aria-labelledby="t-cat-${grupo}">
      <div class="titulo-fila"><h2 id="t-cat-${grupo}">${titulo} ${H.info(titulo, ayuda)}</h2><span class="ayuda">${nf(xs.length)} de ${nf(V[grupo].length)}</span></div>
      ${est !== 'ok' ? '' : xs.length ? xs.map(filaProducto).join('') : nadaFiltro()}
      ${grupo === 'caja' ? `<p class="nota-i">Reventa ${H.info('Reventa', TXT_REVENTA)}</p>` : ''}
    </section>`;
  };
  c.innerHTML = recetasHtml
    + prods('caja', 'Productos de la caja', 'Los productos de la caja (fen-ventas), con lo vendido en los últimos 60 días en las dos sucursales (de los resúmenes de cierre) y su última venta.\nVínculo: lo que dice Finanzas → Márgenes → Asociar productos (la receta, Reventa o "No es producto"); sin vínculo, "Sin asociar".\nArchivar = lo mismo que "inactivo" en la caja: deja de aparecer para vender y su historia queda. Reactivar lo vuelve a poner a la venta.', 'ok')
    + (st.D.estados.b2b === 'ok' ? prods('b2b', 'Productos B2B', 'Los productos de B2B (fen-b2b), con lo vendido en los últimos 60 días (órdenes que no están anuladas) y su última venta.\nArchivar = lo mismo que archivar un producto en Ventas a empresas: deja de ofrecerse en las órdenes nuevas y su historia queda.', 'ok') : '');
}

// ── Eventos ──
const filaDe = clave => { const V = st.D.vista; return [...V.recetas, ...V.caja, ...V.b2b].find(f => f.clave === clave) || null; };
function rearmar(msg) { st.D = C.rearmar(st.D); st.msg = msg || ''; st.err = ''; const el = $('v-catalogo'); if (el) pintarTodo(el); }
function conectar(el) {
  el.addEventListener('click', async ev => {
    const t = ev.target.closest('button'); if (!t || st.ocupado) return;
    if (t.id === 'cat-actualizar') { st.forzar = true; st.msg = ''; return pintar(el, '', H); }
    if (t.dataset.catFiltro) { st.filtro = t.dataset.catFiltro; el.querySelectorAll('[data-cat-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.catFiltro === st.filtro))); return pintarListas(); }
    if (t.id === 'cat-sugeridas') return dialogoSugeridas();
    if (t.dataset.catVivo) return marcarVivo(filaDe(t.dataset.catVivo));
    if (t.dataset.catArch) { const f = filaDe(t.dataset.catArch); if (f) return f.grupo === 'recetas' ? archivarReceta(f) : archivarProducto(f); }
    if (t.dataset.catReact) { const f = filaDe(t.dataset.catReact); if (f) return reactivar(f); }
  });
  el.addEventListener('input', ev => { if (ev.target.id === 'cat-q') { st.q = ev.target.value; pintarListas(); } });
}
const error = e => (e && e.code === 'cuota-agotada') ? e.message : (e && e.message) || H.mensajeError(e);
async function conOcupado(fn) {
  st.ocupado = true; document.body.classList.add('cat-ocupado');
  try { return await fn(); } finally { st.ocupado = false; document.body.classList.remove('cat-ocupado'); }
}
async function marcarVivo(f) {
  if (!f) return;
  await conOcupado(async () => {
    try { await C.marcarVivo(st.D, [f]); H.registrar(`Catálogo: marcó vivo (${GRUPOS[f.grupo].toLowerCase()})`, `${f.nombre} · ${f.id}`); rearmar(`${f.nombre}: vivo.`); }
    catch (e) { st.err = error(e); const x = $('cat-err'); if (x) x.textContent = st.err; }
  });
}

// Diálogo de confirmación en la página. cuerpo: HTML; ok: texto del botón; → Promise<FormData-like (el diálogo) | null>
function confirmar(titulo, cuerpo, ok, { peligro = true, validar = null } = {}) {
  return new Promise(resolve => {
    const d = H.dialogo(`<form class="form-dialogo cat-dialogo" method="dialog" novalidate>
      <h2>${H.esc(titulo)}</h2>${cuerpo}
      <p class="error" id="cat-dlg-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" value="no" id="cat-dlg-no">Cancelar</button><button type="submit" class="btn${peligro ? ' btn-peligro-lleno' : ''}" id="cat-dlg-si">${H.esc(ok)}</button></div></form>`);
    let listo = false;
    const fin = v => { if (listo) return; listo = true; resolve(v); try { d.close(); } catch (e) {} };
    const revisar = () => { if (!validar) return true; const m = validar(d); d.querySelector('#cat-dlg-err').textContent = m || ''; d.querySelector('#cat-dlg-si').disabled = !!m; return !m; };
    d.querySelector('#cat-dlg-no').addEventListener('click', () => fin(null));
    d.addEventListener('change', revisar);
    d.addEventListener('close', () => fin(null));
    d.querySelector('form').addEventListener('submit', ev => { ev.preventDefault(); if (revisar()) { const sel = [...d.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value); fin({ sel }); } });
    revisar();
  });
}
const casilla = (valor, texto, marcado = true, extra = '') => `<label class="check cat-check"><input type="checkbox" value="${H.esc(valor)}" ${marcado ? 'checked' : ''}><span>${texto}${extra}</span></label>`;

async function ejecutar(filas, archivar, accion) {
  await conOcupado(async () => {
    try {
      const h = await C.archivar(st.D, filas, archivar);
      const n = h.recetas.length + h.caja.length + h.b2b.length;
      const nombres = filas.map(f => `${f.nombre} (${GRUPOS[f.grupo].toLowerCase()})`).join(', ');
      if (n) H.registrar(`Catálogo: ${accion}`, nombres.slice(0, 1500));
      rearmar(n ? `${archivar ? 'Archivado' : 'Reactivado'}: ${n} ${n === 1 ? 'cosa' : 'cosas'}.` : 'No había nada que cambiar.');
    } catch (e) { const m = error(e); rearmar(''); st.err = m; const x = $('cat-err'); if (x) x.textContent = m; }
  });
}

// Archivar una receta: el guardia de sub recetas (o "archivar juntas") y los productos activos que llevan a ella
async function archivarReceta(f) {
  const recetas = st.D.datos.recetas, U = st.D.vista.usos;
  let ids = [f.id];
  const bl = CM.bloqueos(ids, recetas, U);
  if (bl.length) {
    const juntas = CM.conUsuarios(f.id, recetas, U), porId = Object.fromEntries(st.D.vista.recetas.map(x => [x.id, x]));
    const r = await confirmar(`No se puede archivar sola: ${f.nombre}`, `<p>${H.esc(CM.textoBloqueo(bl[0]))}</p>
      <p class="ayuda">Una sub receta que usa una receta viva no se archiva sola (Cocina no podría hacer esa receta). Puedes archivarlas todas juntas:</p>
      <ul class="cat-dlg-lista">${juntas.map(id => `<li>${H.esc((porId[id] || {}).nombre || id)}${id === f.id ? '' : ` <span class="ayuda">(la usa)</span>`}</li>`).join('')}</ul>`, `Archivar las ${juntas.length} juntas`);
    if (!r) return;
    ids = juntas;
  }
  const filas = ids.map(id => st.D.vista.recetas.find(x => x.id === id)).filter(Boolean);
  const prods = []; filas.forEach(x => CM.productosActivos(x).forEach(p => { if (!prods.some(y => y.clave === p.clave)) prods.push(p); }));
  const r = await confirmar(filas.length > 1 ? `Archivar ${filas.length} recetas` : `Archivar ${f.nombre}`, `
    <ul class="cat-dlg-lista">${filas.map(x => `<li><b>${H.esc(x.nombre)}</b> <span class="ayuda">${H.esc(x.id)}${x.sub ? ' · sub receta' : ''}</span></li>`).join('')}</ul>
    <p class="ayuda">Deja de verse en Cocina (listas, planificación nueva y el buscador del editor) y no se propone en Finanzas. Un plan que ya la tiene conserva sus números con la nota "receta archivada". Su historia queda y se deshace con "Reactivar".</p>
    ${prods.length ? `<div class="aviso">${prods.length === 1 ? 'Este producto sigue a la venta y lleva' : 'Estos productos siguen a la venta y llevan'} a ${filas.length === 1 ? 'esta receta' : 'estas recetas'}. ¿Archivarlos también?</div>
      <div class="cat-dlg-lista">${prods.map(p => casilla('p|' + p.clave, `${H.esc(p.nombre)} <span class="ayuda">(${CANAL[p.grupo]} · ${p.cantidad > 0 ? nf(p.cantidad) + ' vendidos en 60 días' : 'sin ventas en 60 días'})</span>`, p.cantidad <= 0)).join('')}</div>` : ''}`,
    filas.length > 1 ? `Archivar ${filas.length}` : 'Archivar');
  if (!r) return;
  const extra = r.sel.filter(v => v.startsWith('p|')).map(v => filaDe(v.slice(2))).filter(Boolean);
  await ejecutar([...extra, ...filas], true, filas.length > 1 || extra.length ? `archivó ${filas.length + extra.length}` : 'archivó una receta');
}
async function archivarProducto(f) {
  const r = await confirmar(`Archivar ${f.nombre}`, `<p class="ayuda">${f.grupo === 'caja' ? 'Queda inactivo en la caja: deja de aparecer para vender.' : 'Queda archivado en B2B: deja de ofrecerse en las órdenes nuevas.'} Sus ventas pasadas siguen contando y se deshace con "Reactivar".</p>
    <p>${f.cantidad > 0 ? `Se vendió ${nf(f.cantidad)} en los últimos 60 días (última: ${H.esc(fechaTxt(f.ultima))}).` : 'No se vendió en los últimos 60 días.'}</p>`, 'Archivar');
  if (!r) return;
  await ejecutar([f], true, `archivó un ${GRUPOS[f.grupo].toLowerCase()}`);
}
async function reactivar(f) {
  let filas = [f], cuerpo = '';
  if (f.grupo === 'recetas') {
    // Sus sub recetas archivadas (si no, Cocina no podría hacerla): se ofrecen marcadas
    const r = st.D.datos.recetas.find(x => x.id === f.id) || {}, porClave = {};
    st.D.datos.recetas.forEach(x => { porClave[x.id] = x; if (x.mpId) porClave[x.mpId] = x; });
    const subs = [...new Set((r.ingredientes || []).map(i => porClave[i && i.id]).filter(x => x && x.id !== f.id && CM.recetaArchivada(x)).map(x => x.id))];
    cuerpo = `<p class="ayuda">Vuelve a ${H.esc(CM.ESTADOS_RECETA[f.estadoAntes] || f.estadoAntes || 'Aprobada')} y se ve otra vez en Cocina y en Finanzas.</p>`
      + (subs.length ? `<div class="aviso">Usa sub recetas archivadas. ¿Reactivarlas también?</div><div class="cat-dlg-lista">${subs.map(id => casilla('r|' + id, H.esc(porClave[id].nombre || id))).join('')}</div>` : '');
  } else {
    const rec = f.vinculo.tipo === 'receta' && st.D.datos.recetas.find(x => x.id === f.vinculo.receta);
    cuerpo = `<p class="ayuda">${f.grupo === 'caja' ? 'Vuelve a aparecer para vender en la caja.' : 'Vuelve a ofrecerse en las órdenes de B2B.'}</p>${rec && CM.recetaArchivada(rec) ? `<p class="aviso">Su receta (${H.esc(rec.nombre)}) está archivada: reactívala también si se vuelve a hacer.</p>` : ''}`;
  }
  const r = await confirmar(`Reactivar ${f.nombre}`, cuerpo, 'Reactivar', { peligro: false });
  if (!r) return;
  r.sel.filter(v => v.startsWith('r|')).forEach(v => { const x = st.D.vista.recetas.find(y => y.id === v.slice(2)); if (x) filas.push(x); });
  await ejecutar(filas, false, filas.length > 1 ? `reactivó ${filas.length}` : `reactivó ${f.grupo === 'recetas' ? 'una receta' : 'un ' + GRUPOS[f.grupo].toLowerCase()}`);
}

// Archivar las sugeridas: lista con casillas (se pueden desmarcar); el guardia de sub recetas se revisa al cambiar
async function dialogoSugeridas() {
  const S = st.D.vista.sugeridas, todas = [...S.recetas, ...S.caja, ...S.b2b];
  if (!todas.length) return;
  const recetas = st.D.datos.recetas, U = st.D.vista.usos;
  const grupo = (t, xs) => xs.length ? `<h3>${t} <span class="ayuda">${nf(xs.length)}</span></h3><div class="cat-dlg-lista">${xs.map(f => casilla(f.clave, `<b>${H.esc(f.nombre)}</b> <span class="ayuda">${H.esc(f.id)}${f.sub ? ' · sub receta' : ''}${f.grupo !== 'recetas' && f.reventa ? ' · Reventa' : ''}</span>`)).join('')}</div>` : '';
  const elegidas = d => [...d.querySelectorAll('input[type=checkbox]:checked')].map(x => filaDe(x.value)).filter(Boolean);
  const validar = d => {
    const xs = elegidas(d);
    if (!xs.length) return 'Marca al menos una.';
    const bl = CM.bloqueos(xs.filter(f => f.grupo === 'recetas').map(f => f.id), recetas, U);
    const ok = d.querySelector('#cat-dlg-si'); if (ok) ok.textContent = `Archivar ${xs.length}`;
    return bl.length ? bl.map(b => `${b.nombre}: ${CM.textoBloqueo(b)}`).join(' ') : '';
  };
  const r = await confirmar(todas.length === 1 ? 'Archivar la sugerida' : `Archivar las ${todas.length} sugeridas`, `<p class="ayuda">Sin ventas en 60 días y sin recetas vivas que las usen. Desmarca lo que quieras dejar. Todo se puede reactivar después.</p>
    <div class="cat-dlg-grupos">${grupo('Recetas', S.recetas)}${grupo('Productos de la caja', S.caja)}${grupo('Productos B2B', S.b2b)}</div>`, `Archivar ${todas.length}`, { validar });
  if (!r) return;
  const filas = r.sel.map(filaDe).filter(Boolean);
  await ejecutar(filas, true, `archivó ${filas.length} sugeridas`);
}
