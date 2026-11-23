// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo → Productos y Armar el catálogo  v0.74.0 (Etapa 2: un solo catálogo)
//  #catalogo/productos[/PR0001]: el catálogo único. Crear (desde una receta aprobada, una reventa o un cargo), cambiar los precios de
//   cada canal, habilitar o deshabilitar la caja y B2B, archivar y reactivar, y los pedidos de logística y de la caja. Diálogos en la página.
//  #catalogo/armar: una sola vez, une lo vivo de la caja y de B2B en productos del catálogo (juntando los que llevan a la misma receta).
//  Datos en catalogo-productos.js; reglas puras en catalogo-productos-modelo.js. H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, dialogo }
// ═══════════════════════════════════════════════
import * as C from './catalogo-productos.js?v=0.138.0';
import * as CPM from './catalogo-productos-modelo.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';
import * as LMP from './listas-precios-modelo.js?v=0.138.0';

const st = { D: null, cargando: null, filtro: { estado: 'activo', canal: 'todos', tipo: 'todos', q: '', falta: false }, msg: '', err: '', grupos: null, gmsg: '', gerr: '', ocupado: false };
export const estado = st;
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL', { maximumFractionDigits: 3 });
const pesos = v => (v === null || v === undefined || !(Number(v) > 0) ? '—' : '$' + Math.round(Number(v)).toLocaleString('es-CL'));
const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const sucTxt = x => (/ainavillo/i.test(x || '') ? 'Ainavillo' : /barros/i.test(x || '') ? 'Barros Arana' : String(x || ''));
const diaCorto = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[3])} ${MESC[Number(m[2]) - 1]} ${m[1]}` : ''; };
let H = null, ctx = null, pestana = 'productos';

const TXT_PRODUCTOS = 'El catálogo único de Fën: cada producto que se vende, una sola vez, con su ID (PR…).\nSale siempre de una receta aprobada en Cocina, de una reventa (Catálogo → Reventa) o es un cargo (por ejemplo Despacho, que se cobra solo a B2B para recuperar la bencina).\nTú lo habilitas en cada canal (la caja y/o B2B) con su precio, y Sistema Fën escribe la copia en la caja y en B2B: nadie más crea productos. La caja y logística solo los piden.\nArchivar lo saca de los canales; su historia (ventas, costos) queda y se deshace con "Reactivar". Nada se borra.';
const TXT_SIN_CANAL = 'Un producto activo que no está habilitado en la caja ni en B2B: nadie lo puede vender. Habilítalo en un canal o archívalo.';
const TXT_PEDIDOS = 'Lo que piden logística (Solicitudes → Producto nuevo, de la lista que publica el Catálogo) y la caja (Pedir producto, caja v2.3.0).\nResolver = crear el producto (desde su receta o reventa) o habilitarlo en ese canal, con el precio que decidas. El pedido queda aprobado y le llega la respuesta.\nRechazar pide un motivo, que también le llega.';
const TXT_REGLAS_CAJA = 'Los pedidos de la caja (fen-ventas solicitudes_producto) los escribe la caja v2.3.0 (Pedir producto). Para leerlos, publica las reglas de fen-ventas v1.5.0 (ver README). Mientras tanto aquí solo salen los de logística.';
const TXT_CAJA = 'Lo que ve la cajera. Con control de stock, un precio por tarjeta (hoy, ayer, antes de ayer, 4° día y última oferta; con IVA); si una va en 0, la caja usa la anterior. Sin control de stock, un precio único.\nPestaña: en qué área de la caja aparece (Panadería, Bollería, Pastelería, Cafetería o Reventa; las mismas de Sistema Fën). Una reventa va siempre a la pestaña Reventa.\nExcepción horaria: el pan de ayer se vende al precio de hoy antes de las 15:00. Se elimina solo: al pasar los días sale de la vitrina (si no, es permanente).';
const TXT_B2B = 'El precio base neto (sin IVA) es el que paga un cliente B2B sin precio especial. Los precios especiales se piden y se aprueban como siempre (Ventas a empresas → Clientes).\nUn producto de B2B que ya existía conserva su nombre en B2B (las órdenes antiguas y los precios especiales lo usan).';
const TXT_ORIGEN = 'Receta: solo las aprobadas en Cocina (las que están en revisión o en prueba no se pueden elegir; una sub receta solo si "vende directo").\nReceta pendiente: un producto que se vende hoy, pero cuya receta todavía no está aprobada o no existe. Es temporal: ver "Receta pendiente".\nReventa: la lista de Catálogo → Reventa.\nCargo: algo que se cobra y no es un producto (Despacho). En el estado de resultados va como un ingreso aparte del canal B2B, no como margen de un producto.';
// v0.80.1 · Receta pendiente
const TXT_PENDIENTE = 'Úsala solo mientras tanto, para un producto que hoy se vende pero cuya receta todavía no está aprobada en Cocina (o no existe).\nEl producto sigue en la caja y en B2B con sus precios, y sus ventas van al área que elijas. Mientras esté pendiente no tiene costo directo ni margen: en Finanzas aparece como "sin costo (receta pendiente)".\nCuando la receta esté lista: apruébala (o créala) en Cocina y vuelve aquí: "Unir con su receta" la elige, y desde ahí tiene costo y margen. Queda en su historial.\n"Qué receta falta" es una nota para acordarte (opcional).';
const TXT_FALTA = 'Los productos que se venden con la receta pendiente (todavía sin receta aprobada). No tienen costo ni margen hasta que los unas con su receta.\nApruébala o créala en Cocina y toca "Unir con su receta" en cada uno.';
const TXT_UNIR = 'Elige su receta, ya aprobada en Cocina. Se proponen las de su área; marca "Ver todas las áreas" si es de otra (el área pasa a ser la de la receta).\nCambia la receta del producto en el Catálogo, en la caja y en B2B (sus precios no cambian) y el vínculo de Finanzas, como al crear un producto desde una receta. Desde ahí sus ventas tienen costo y margen. Queda en el historial.\nSi la receta todavía no aparece, apruébala primero en Producción (o pide que la propongan desde Cocina).';
const TXT_UPV = 'Cuántas unidades de la receta (o de la reventa) lleva una venta. Casi siempre 1; una "caja de 6" = 6.';
const TXT_ARMAR = 'Una sola vez: une lo que hoy está vivo en la caja y en B2B en productos del catálogo, para que todo quede unido por ID y no por nombre.\n1) Se proponen grupos: un producto de la caja y uno de B2B que llevan a la misma receta (o reventa) quedan juntos (por el vínculo de Finanzas → Asociar productos; si no hay, por el ID de receta de la caja o de B2B).\n2) Revisa cada grupo: el nombre, de dónde sale (receta aprobada, reventa, cargo) y sus canales. "Separar" deja la caja y B2B en productos distintos; "Juntar con" une dos.\n3) Lo que no tiene receta ni reventa hay que resolverlo antes de guardar: elige una receta, una reventa, cargo o "Archivar". Si se sigue vendiendo pero su receta todavía no está aprobada (o no existe), elige "Receta pendiente" con su área: se guarda y se sigue vendiendo, sin costo hasta que lo unas con su receta (Productos → Falta receta).\n4) Guardar crea los productos (PR0001…), escribe su ID en los documentos de la caja y de B2B que ya existían (conservan su ID: la historia de ventas está guardada con él) y deja el vínculo de Finanzas donde no había uno.\nLos precios no cambian: se copian de la caja y de B2B tal cual.';
const TXT_ENCUADRE = 'El marco tiene la forma de la foto en cada tarjeta de la lista de precios. Arrastra la foto (con el mouse o el dedo) para elegir qué parte se ve, y usa la barra para acercarla. "Centrar" la deja como estaba. Se guarda con "Guardar cambios" y no vuelve a subir la foto.';
const TXT_FICHA = 'Lo que sale en las listas de precios de Ventas a empresas (no cambia nada en la caja).\nFormato: cómo se vende (por ejemplo "800 g", "Unidad" o "Caja 10 un"). Descripción corta: una frase, hasta 140 letras.\nLa foto se achica en este equipo antes de subirla (hasta 900 px y 90 KB, más una miniatura de 240 px) y se guarda aparte del catálogo: abrir el Catálogo no carga imágenes. Se sube al guardar. Quitar la foto la saca de las listas y queda anotado en el historial.';
const TXT_LECTURAS = 'Lo que se leyó de cada base al abrir (documentos). El catálogo, la reventa y los vínculos usan la memoria de Gastos y Finanzas; las recetas, la memoria compartida con Producción; los productos de la caja y de B2B, una vez por sesión (los mismos de Finanzas).\nFiltrar y buscar: 0 lecturas. "Actualizar" vuelve a leer.';

export async function pintar(el, sub, h, c) {
  H = h; ctx = c; pestana = sub;
  if (!el.dataset.prEventos) { el.dataset.prEventos = '1'; conectar(el); }
  const extra = `<div class="botones" style="margin:0;align-items:center"><button type="button" class="btn-sec btn-chico" id="pr-actualizar">Actualizar</button>${H.info('Lecturas', TXT_LECTURAS)}</div>`;
  st.cab = () => ctx.cab(extra);
  el.innerHTML = st.cab() + `<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo el catálogo…</div></section>`;
  try { if (!st.D || st.forzar) st.D = await C.cargar({ forzar: !!st.forzar }); }
  catch (e) { st.forzar = false; el.innerHTML = st.cab() + `<section class="tarjeta"><p class="error" role="alert">${H.esc(error(e))}</p></section>`; return; }
  st.forzar = false;
  if (!location.hash.startsWith('#catalogo/' + pestana)) return;
  if (st.D.estados.gastos !== 'ok') { el.innerHTML = st.cab() + `<section class="tarjeta"><p class="aviso">El catálogo se guarda en la base de Gastos y Finanzas (fen-gastos), que no está conectada en este equipo. Conéctala en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>.</p></section>`; return; }
  if (pestana === 'armar') { st.grupos = null; return dibujarArmar(el); }
  if ((location.hash.split('/')[2] || '') === 'falta-receta') { st.filtro.falta = true; st.filtro.estado = 'activo'; }
  dibujar(el);
  // #catalogo/productos/PR0001 abre ese producto
  const id = (location.hash.split('/')[2] || '').trim();
  if (id === 'falta-receta') return;   // v0.80.1: #catalogo/productos/falta-receta (desde Hoy, Finanzas y el Plan de Panadería)
  if (id) { const p = st.D.maestro.find(x => x.id === id); if (p) dialogoProducto(el, p); }
}
const error = e => (e && e.code === 'cuota-agotada') ? e.message : (e && e.message) || H.mensajeError(e);
async function conOcupado(fn) { st.ocupado = true; document.body.classList.add('cat-ocupado'); try { return await fn(); } finally { st.ocupado = false; document.body.classList.remove('cat-ocupado'); } }

// ═══════════════ Productos ═══════════════
const recetaDe = id => (st.D.recetas || []).find(r => r.id === id) || null;
const reventaDe = id => (st.D.reventa || []).find(r => r.id === id) || null;
function saleDe(p) {
  if (CPM.recetaPendiente(p)) return `<span class="pr-pend-txt">Receta pendiente</span>${p.notaReceta ? ` <span class="ayuda">falta: ${H.esc(p.notaReceta)}</span>` : ' <span class="ayuda">sin costo hasta unirla</span>'}`;   // v0.80.1
  if (p.tipo === 'receta') { const r = recetaDe(p.recetaId); return `${H.esc(r ? r.nombre : p.recetaId)} <span class="ayuda">${H.esc(p.recetaId)}${r && !CPM.recetaAprobada(r) ? ' · ' + H.esc(CPM.textoEstadoReceta(r)) : ''}</span>`; }
  if (p.tipo === 'reventa') { const r = reventaDe(p.reventaId); return `${H.esc(r ? r.nombre : p.reventaId)} <span class="ayuda">${H.esc(p.reventaId)}</span>`; }
  if (p.tipo === 'cargo') return `Cargo <span class="ayuda">${p.area ? H.esc(AR.NOMBRE[p.area] || p.area) : 'sin canal de costo'}</span>`;
  return H.esc(CPM.TIPOS[p.tipo] || p.tipo);
}
function canalTxt(p, cn) {
  const c = (p.canales || {})[cn] || {};
  if (!CPM.habilitado(p, cn)) return `<span class="ayuda">${c.docId ? 'Deshabilitado' : '—'}</span>`;
  if (cn === 'caja') { const pr = CPM.preciosCaja(c), tab = p.tipo === 'reventa' ? AR.REVENTA : c.areaCaja; return `<b>${pesos(pr.hoy)}</b> <span class="ayuda">con IVA${c.controlStock === false ? ' · precio único' : ''} · ${H.esc(tab || '')}</span>`; }
  return `<b>${pesos(c.precioBase)}</b> <span class="ayuda">neto</span>`;
}
function fila(p) {
  const arch = p.estado === 'archivado', sin = CPM.sinCanal(p);
  return `<div class="cat-fila${arch ? ' cat-archivada' : ''}" data-pr-fila="${H.esc(p.id)}">
    <div class="cat-info"><div class="cat-nombre"><b>${H.esc(p.nombre)}</b></div><small class="cat-id">${H.esc(p.id)}${Number(p.unidadesPorVenta) > 1 ? ` · ${nf(p.unidadesPorVenta)} un por venta` : ''}</small>
      <div class="cat-chips"><span class="chip chip-chico ${p.tipo === 'receta' ? 'c-verde' : p.tipo === 'reventa' ? 'c-azul' : 'c-lila'}">${H.esc(CPM.TIPOS[p.tipo] || p.tipo)}</span>${arch ? '<span class="chip chip-chico c-gris">Archivado</span>' : ''}${sin ? `<span class="chip chip-chico c-amarillo" data-pr-sincanal>Sin canal</span>` : ''}${!arch && CPM.recetaPendiente(p) ? '<span class="chip chip-chico c-amarillo" data-pr-pendiente>Receta pendiente</span>' : ''}${p.foto && p.foto.en ? `<span class="chip chip-chico c-gris" data-pr-confoto>${H.icono('foto', 12)} Con foto</span>` : ''}</div></div>
    <dl class="cat-datos">
      <div><dt>Sale de</dt><dd>${saleDe(p)}</dd></div>
      <div><dt>Área</dt><dd>${H.esc(p.area ? AR.NOMBRE[p.area] || p.area : '—')}</dd></div>
      <div><dt>Caja</dt><dd>${canalTxt(p, 'caja')}</dd></div>
      <div><dt>B2B</dt><dd>${canalTxt(p, 'b2b')}</dd></div>
    </dl>
    <div class="cat-acc">${arch ? `<button type="button" class="btn-sec btn-chico" data-pr-react="${H.esc(p.id)}" aria-label="Reactivar ${H.esc(p.nombre)}">Reactivar</button>`
      : `${CPM.recetaPendiente(p) ? `<button type="button" class="btn btn-chico" data-pr-unir="${H.esc(p.id)}" aria-label="Unir ${H.esc(p.nombre)} con su receta">${H.icono('enlace', 16)} Unir con su receta</button>` : ''}<button type="button" class="btn-sec btn-chico" data-pr-editar="${H.esc(p.id)}" aria-label="Cambiar ${H.esc(p.nombre)}">Cambiar</button><button type="button" class="btn-sec btn-chico btn-peligro" data-pr-arch="${H.esc(p.id)}" aria-label="Archivar ${H.esc(p.nombre)}">Archivar</button>`}</div></div>`;
}
function htmlPedidos() {
  const ps = C.pedidos(st.D), sinReglas = st.D.solicitudes.cajaEstado === 'sin_reglas';
  if (!ps.length && !sinReglas) return '';
  const quien = pd => pd.origen === 'caja' ? `Caja${pd.sucursal ? ' · ' + H.esc(sucTxt(pd.sucursal)) : ''}` : `Logística${pd.cliente ? ' · para ' + H.esc(pd.cliente) : ''}`;
  const acc = { habilitar: 'Habilitar', crear: 'Crear', ya: 'Ya está: aprobar', elegir: 'Resolver' };
  return `<section class="tarjeta" aria-labelledby="t-pr-ped" id="pr-pedidos">
    <div class="titulo-fila"><h2 id="t-pr-ped">Pedidos de productos ${H.info('Pedidos de productos', TXT_PEDIDOS)}</h2><span class="chip ${ps.length ? 'c-amarillo' : 'c-verde'}">${nf(ps.length)}</span></div>
    ${ps.length ? ps.map(pd => `<div class="cat-fila pr-pedido" data-pr-ped="${H.esc(pd.origen + ':' + pd.id)}">
      <div class="cat-info"><div class="cat-nombre"><b>${H.esc(pd.nombre || 'Sin nombre')}</b></div><small class="cat-id">${quien(pd)}${pd.por ? ' · ' + H.esc(pd.por) : ''}</small>
        <div class="cat-chips">${pd.prod ? `<span class="chip chip-chico c-verde">En el catálogo: ${H.esc(pd.prod.id)}</span>` : pd.recetaId ? `<span class="chip chip-chico c-azul">Receta ${H.esc(pd.recetaId)}</span>` : pd.reventaId ? `<span class="chip chip-chico c-azul">Reventa ${H.esc(pd.reventaId)}</span>` : ''}</div></div>
      <dl class="cat-datos"><div><dt>Precio propuesto</dt><dd>${pd.precio ? `${pesos(pd.precio)} <span class="ayuda">${pd.origen === 'caja' ? 'con IVA' : 'neto'}</span>` : '—'}</dd></div><div><dt>Nota</dt><dd>${pd.nota ? H.esc(pd.nota) : '<span class="ayuda">—</span>'}</dd></div></dl>
      <div class="cat-acc"><button type="button" class="btn-sec btn-chico btn-peligro" data-pr-rech="${H.esc(pd.origen + ':' + pd.id)}">Rechazar</button><button type="button" class="btn btn-chico" data-pr-resolver="${H.esc(pd.origen + ':' + pd.id)}">${acc[pd.accion]}</button></div></div>`).join('') : '<div class="vacio" style="border:0">No hay pedidos pendientes.</div>'}
    ${sinReglas ? `<p class="nota-i" id="pr-sin-reglas">Pedidos de la caja ${H.info('Pedidos de la caja', TXT_REGLAS_CAJA)}</p>` : ''}
  </section>`;
}
function dibujar(el) {
  const D = st.D, r = CPM.resumen(D.maestro), f = st.filtro, xs = CPM.filtrar(D.maestro, f), u = D.uso;
  const armado = D.config && D.config.armadoEn;
  const chips = (k, lista) => lista.map(([v, t]) => `<button type="button" class="chip-filtro" data-pr-f="${k}" data-v="${v}" aria-pressed="${f[k] === v}">${t}</button>`).join('');
  el.innerHTML = st.cab() + htmlPedidos() + `
    <section class="tarjeta" aria-labelledby="t-pr">
      <div class="titulo-fila"><h2 id="t-pr">Productos ${H.info('Productos', TXT_PRODUCTOS)}</h2><button type="button" class="btn" id="pr-nuevo">${H.icono('mas', 16)} Nuevo producto</button></div>
      ${armado ? '' : `<p class="aviso" id="pr-sin-armar">Todavía no armas el catálogo: los productos que ya existen en la caja y en B2B se unen en <a href="#catalogo/armar">Armar el catálogo</a> (una vez). Mientras, puedes crear productos nuevos aquí.</p>`}
      ${D.estados.b2b !== 'ok' ? '<p class="aviso">B2B (fen-b2b) no está conectada en este equipo: se ve lo del catálogo, pero no se puede habilitar ni cambiar el canal B2B. Conéctala en <a href="#b2b">Ventas a empresas</a>.</p>' : ''}
      ${D.estados.cocina !== 'ok' ? '<p class="aviso">Cocina (fen-produccion) no está conectada: sin la lista de recetas aprobadas. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : ''}
      <div class="cat-resumen" role="group" aria-label="Resumen"><span class="chip c-verde" id="pr-n-activos">Activos ${nf(r.activos)}</span><span class="chip c-gris">En la caja ${nf(r.caja)}</span><span class="chip c-gris">En B2B ${nf(r.b2b)}</span>${r.sinCanal ? `<span class="chip c-amarillo" id="pr-n-sincanal">Sin canal ${nf(r.sinCanal)}</span>${H.info('Sin canal', TXT_SIN_CANAL)}` : ''}<span class="chip c-gris">Archivados ${nf(r.archivados)}</span>${r.faltaReceta || f.falta ? `<button type="button" class="chip-filtro pr-falta" id="pr-n-faltareceta" data-pr-falta aria-pressed="${!!f.falta}">Falta receta (${nf(r.faltaReceta)})</button>${H.info('Falta receta', TXT_FALTA)}` : ''}</div>
      <div class="cat-filtros">
        <div class="chips" role="group" aria-label="Estado">${chips('estado', CPM.FILTROS_ESTADO)}</div>
        <div class="chips" role="group" aria-label="Canal">${chips('canal', CPM.FILTROS_CANAL)}</div>
        <div class="chips" role="group" aria-label="De dónde sale">${chips('tipo', [['todos', 'Todo'], ['receta', 'Receta'], ['reventa', 'Reventa'], ['cargo', 'Cargo']])}</div>
        <div class="fin-buscar">${H.icono('lupa', 18)}<label class="sr" for="pr-q">Buscar producto</label><input type="search" id="pr-q" placeholder="Buscar por nombre, ID o receta…" autocomplete="off" spellcheck="false" value="${H.esc(f.q)}"></div>
      </div>
      <p class="ok-texto" id="pr-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="pr-err" role="alert">${H.esc(st.err)}</p>
      <div id="pr-lista" class="rev-lista">${xs.length ? xs.map(fila).join('') : `<div class="vacio">${f.falta ? 'Ningún producto con la receta pendiente: todos tienen su receta.' : D.maestro.length ? 'Nada con este filtro.' : 'Todavía no hay productos en el catálogo.'}</div>`}</div>
      <p class="ayuda" id="pr-lecturas">Lecturas al abrir: Gastos y Finanzas ${nf(u.gastos)} · caja ${nf(u.caja)} · B2B ${nf(u.b2b)} · Cocina ${nf(u.cocina)}</p>
    </section>`;
}
function pintarLista() { const c = $('pr-lista'); if (!c) return; const xs = CPM.filtrar(st.D.maestro, st.filtro); c.innerHTML = xs.length ? xs.map(fila).join('') : `<div class="vacio">${st.filtro.falta ? 'Ningún producto con la receta pendiente: todos tienen su receta.' : 'Nada con este filtro.'}</div>`; }

function conectar(el) {
  el.addEventListener('click', async ev => {
    const t = ev.target.closest('button'); if (!t || st.ocupado || !st.D) return;
    if (t.id === 'pr-actualizar') { st.forzar = true; st.msg = ''; st.gmsg = ''; return pintar(el, pestana, H, ctx); }
    if (t.dataset.prF) { st.filtro[t.dataset.prF] = t.dataset.v; el.querySelectorAll(`[data-pr-f="${t.dataset.prF}"]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === t.dataset.v))); return pintarLista(); }
    if (t.id === 'pr-nuevo') return dialogoProducto(el, null);
    if (t.dataset.prFalta !== undefined && t.id === 'pr-n-faltareceta') { st.filtro.falta = !st.filtro.falta; t.setAttribute('aria-pressed', String(st.filtro.falta)); if (!st.filtro.falta && location.hash.split('/')[2] === 'falta-receta') history.replaceState(null, '', '#catalogo/productos'); return pintarLista(); }
    if (t.dataset.prUnir) return dialogoUnir(el, st.D.maestro.find(p => p.id === t.dataset.prUnir));
    if (t.dataset.prEditar) return dialogoProducto(el, st.D.maestro.find(p => p.id === t.dataset.prEditar));
    if (t.dataset.prArch) return dialogoArchivar(el, st.D.maestro.find(p => p.id === t.dataset.prArch), true);
    if (t.dataset.prReact) return dialogoArchivar(el, st.D.maestro.find(p => p.id === t.dataset.prReact), false);
    if (t.dataset.prResolver) return resolverPedido(el, pedidoDe(t.dataset.prResolver));
    if (t.dataset.prRech) return rechazarPedido(el, pedidoDe(t.dataset.prRech));
    // Armar el catálogo
    if (t.dataset.gSeparar) { separar(t.dataset.gSeparar); return dibujarArmar(el); }
    if (t.id === 'g-guardar') return confirmarArmar(el);
    if (t.id === 'g-terminar') return terminar(el);
  });
  el.addEventListener('input', ev => {
    if (ev.target.id === 'pr-q') { st.filtro.q = ev.target.value; pintarLista(); }
    if (ev.target.dataset.gNombre) { const g = grupo(ev.target.dataset.gNombre); if (g) { g.nombre = ev.target.value; revisarGrupo(g); } }
    if (ev.target.dataset.gNota) { const g = grupo(ev.target.dataset.gNota); if (g) { g.notaReceta = ev.target.value; revisarGrupo(g); } }   // v0.80.1
    if (ev.target.dataset.gUpv) { const g = grupo(ev.target.dataset.gUpv); if (g) { g.unidadesPorVenta = ev.target.value; revisarGrupo(g); } }
  });
  el.addEventListener('change', ev => {
    const x = ev.target;
    if (x.dataset.gTipo) { const g = grupo(x.dataset.gTipo); if (g) { if (x.value === 'archivar') g.accion = 'archivar'; else if (x.value === 'pendiente') { g.accion = 'crear'; g.tipo = 'receta'; g.recetaPendiente = true; if (!AR.PRODUCCION.includes(g.area)) g.area = areaPropuesta(g); } else { g.accion = 'crear'; g.tipo = x.value || null; if (g.recetaPendiente) { g.recetaPendiente = false; const r = recetaDe(g.recetaId); g.area = g.tipo === 'receta' ? CPM.areaCodigo(r && r.area) : g.area; } } return dibujarArmar(el); } }
    if (x.dataset.gArea) { const g = grupo(x.dataset.gArea); if (g) { g.area = x.value || ''; revisarGrupo(g); } }   // v0.80.1: el área de la receta pendiente
    if (x.dataset.gReceta) { const g = grupo(x.dataset.gReceta); if (g) { g.recetaId = x.value || null; const r = recetaDe(g.recetaId); g.area = CPM.areaCodigo(r && r.area); revisarGrupo(g); } }
    if (x.dataset.gReventa) { const g = grupo(x.dataset.gReventa); if (g) { g.reventaId = x.value || null; g.area = AR.REVENTA; revisarGrupo(g); } }
    if (x.dataset.gJuntar) { if (x.value) { juntar(x.dataset.gJuntar, x.value); dibujarArmar(el); } }
  });
}
const pedidoDe = k => { const [o, ...r] = k.split(':'); const id = r.join(':'); return C.pedidos(st.D).find(x => x.origen === o && x.id === id) || null; };

// ── Diálogo del producto (crear o cambiar) ──
const opcionesRecetas = sel => {
  const ok = CPM.recetasElegibles(st.D.recetas), porArea = {};
  ok.forEach(r => { const a = CPM.areaCodigo(r.area) || 'otra'; (porArea[a] || (porArea[a] = [])).push(r); });
  const actual = sel && !ok.some(r => r.id === sel) ? recetaDe(sel) : null;
  return `<option value="">Elige…</option>${actual ? `<option value="${H.esc(actual.id)}" selected>${H.esc(actual.nombre)} · ${H.esc(CPM.textoEstadoReceta(actual))}</option>` : ''}`
    + [...AR.PRODUCCION, 'otra'].filter(a => porArea[a]).map(a => `<optgroup label="${H.esc(AR.NOMBRE[a] || 'Otra')}">${porArea[a].map(r => `<option value="${H.esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${H.esc(r.nombre)} · ${H.esc(r.id)}</option>`).join('')}</optgroup>`).join('');
};
const opcionesReventa = sel => {
  const ok = CPM.reventasElegibles(st.D.reventa), actual = sel && !ok.some(r => r.id === sel) ? reventaDe(sel) : null;
  return `<option value="">${ok.length ? 'Elige…' : 'La lista de reventa está vacía (Catálogo → Reventa)'}</option>${actual ? `<option value="${H.esc(actual.id)}" selected>${H.esc(actual.nombre)} · archivada</option>` : ''}` + ok.map(r => `<option value="${H.esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${H.esc(r.nombre)} · ${H.esc(r.id)}</option>`).join('');
};
function categoriasCaja(area) { return [...new Set(Object.values(st.D.cat.caja || {}).filter(p => !area || p.area === area).map(p => String(p.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')); }
function categoriasB2b() { return [...new Set(Object.values(st.D.cat.b2b || {}).map(p => String(p.categoria || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')); }
const vNum = v => (v === null || v === undefined || !(Number(v) > 0) ? '' : String(v));
function formProducto(p, base) {
  const x = base || p || {}, c = (x.canales && x.canales.caja) || {}, b = (x.canales && x.canales.b2b) || {}, tipo = CPM.recetaPendiente(x) ? 'pendiente' : x.tipo || 'receta';
  const pr = c.precios || {}, stock = c.controlStock !== false;
  const habC = x.canales ? !!c.habilitado && (!p || p.estado !== 'archivado') : false, habB = x.canales ? !!b.habilitado : false;
  const docB = p && p.canales && p.canales.b2b && p.canales.b2b.docId ? st.D.cat.b2b[p.canales.b2b.docId] : null;
  const areaCaja = (c.areaCaja && c.areaCaja !== AR.REVENTA ? c.areaCaja : '') || (AR.PRODUCCION.includes(x.area) ? x.area : '');
  return `<form class="form-dialogo cat-dialogo pr-dialogo" id="pr-form" novalidate>
    <h2>${p ? `Cambiar ${H.esc(p.nombre)}` : 'Nuevo producto'}</h2>
    ${p ? `<p class="ayuda">ID ${H.esc(p.id)} (no cambia)</p>` : '<p class="ayuda">El ID (PR…) se pone solo: el número que sigue.</p>'}
    <div class="campo"><label for="pr-nombre">Nombre</label><input id="pr-nombre" maxlength="120" value="${H.esc(x.nombre || '')}" autocomplete="off"></div>
    <fieldset class="fin-as-tipo pr-tipo"><legend>De dónde sale ${H.info('De dónde sale', TXT_ORIGEN)}</legend>
      ${[...CPM.TIPOS_PANTALLA.slice(0, 1), 'pendiente', ...CPM.TIPOS_PANTALLA.slice(1)].map(t => `<label class="check"><input type="radio" name="pr-tipo" value="${t}" ${tipo === t ? 'checked' : ''}> ${t === 'receta' ? 'Una receta aprobada' : t === 'pendiente' ? 'Receta pendiente (se vende, pero su receta todavía no está aprobada o no existe)' : t === 'reventa' ? 'Una reventa' : 'Un cargo (por ejemplo Despacho)'}</label>`).join('')}</fieldset>
    <div class="campo pr-si-receta ${tipo === 'receta' ? '' : 'oculto'}"><label for="pr-receta">Receta (solo las aprobadas)</label><select id="pr-receta">${opcionesRecetas(x.recetaId)}</select></div>
    <div class="pr-si-pendiente ${tipo === 'pendiente' ? '' : 'oculto'}" id="pr-pend"><p class="nota-i pr-pend-cab"><span>Receta pendiente: temporal, sin costo ni margen hasta unirla con su receta</span> ${H.info('Receta pendiente', TXT_PENDIENTE)}</p>
      <div class="fila-campos rev-campos"><div class="campo"><label for="pr-pend-area">Área que lo produce</label><select id="pr-pend-area"><option value="">Elige…</option>${AR.PRODUCCION.map(a => `<option value="${a}" ${x.area === a ? 'selected' : ''}>${H.esc(AR.NOMBRE[a] || a)}</option>`).join('')}</select></div>
        <div class="campo"><label for="pr-pend-nota">Qué receta falta (opcional) <span class="ayuda" id="pr-pend-n">${String(x.notaReceta || '').length}/${CPM.NOTA_RECETA_MAX}</span></label><input id="pr-pend-nota" maxlength="${CPM.NOTA_RECETA_MAX}" value="${H.esc(x.notaReceta || '')}" placeholder="Ej.: la jefa la está probando; falta aprobarla" autocomplete="off"></div></div></div>
    <div class="campo pr-si-reventa ${tipo === 'reventa' ? '' : 'oculto'}"><label for="pr-reventa">Reventa</label><select id="pr-reventa">${opcionesReventa(x.reventaId)}</select></div>
    <div class="campo pr-si-cargo ${tipo === 'cargo' ? '' : 'oculto'}"><label for="pr-cargo-area">Costo de canal</label><select id="pr-cargo-area"><option value="">Ninguno</option>${AR.CANAL.map(a => `<option value="${a}" ${x.area === a || (!p && a === 'B2B') ? 'selected' : ''}>${H.esc(AR.NOMBRE[a])}</option>`).join('')}</select></div>
    <div class="campo pr-no-cargo ${tipo === 'cargo' ? 'oculto' : ''}"><label for="pr-upv">Unidades por venta ${H.info('Unidades por venta', TXT_UPV)}</label><input id="pr-upv" type="text" inputmode="decimal" value="${H.esc(String(x.unidadesPorVenta ?? 1).replace('.', ','))}"></div>
    <fieldset class="pr-canal" id="pr-c-caja"><legend><label class="check"><input type="checkbox" id="pr-caja" ${habC ? 'checked' : ''}> Se vende en la caja</label> ${H.info('La caja', TXT_CAJA)}</legend>
      <div class="pr-canal-cuerpo ${habC ? '' : 'oculto'}">
        <div class="fila-campos rev-campos"><div class="campo pr-no-reventa ${tipo === 'reventa' ? 'oculto' : ''}"><label for="pr-areacaja">Pestaña de la caja</label><select id="pr-areacaja"><option value="">Elige…</option>${(st.D.areasCaja || []).filter(a => a !== AR.REVENTA).map(a => `<option value="${H.esc(a)}" ${a === areaCaja ? 'selected' : ''}>${H.esc(AR.NOMBRE[a] || a)}</option>`).join('')}</select></div>
          <div class="campo pr-si-reventa ${tipo === 'reventa' ? '' : 'oculto'}" id="pr-areacaja-rev"><span class="etiqueta-fija">Pestaña de la caja</span><p class="ayuda" style="margin:6px 0 0"><b>Reventa</b> · una reventa va siempre ahí</p></div>
          <div class="campo"><label for="pr-catcaja">Categoría (opcional)</label><input id="pr-catcaja" list="pr-catcaja-l" maxlength="60" value="${H.esc(c.categoria || '')}"><datalist id="pr-catcaja-l">${categoriasCaja(areaCaja).map(k => `<option value="${H.esc(k)}">`).join('')}</datalist></div></div>
        <label class="check"><input type="checkbox" id="pr-stock" ${stock ? 'checked' : ''}> Con control de stock (precio por tarjeta)</label>
        <div class="pr-precios ${stock ? '' : 'oculto'}" id="pr-precios">${CPM.TARJETAS.map(([k, t]) => `<div class="campo"><label for="pr-p-${k}">${t}</label><input id="pr-p-${k}" type="text" inputmode="numeric" value="${H.esc(vNum(pr[k]))}" placeholder="${k === 'hoy' ? 'con IVA' : 'igual'}"></div>`).join('')}</div>
        <div class="campo ${stock ? 'oculto' : ''}" id="pr-unico-c"><label for="pr-unico">Precio (con IVA)</label><input id="pr-unico" type="text" inputmode="numeric" value="${H.esc(vNum(c.precioUnico || (!stock ? pr.hoy : '')))}"></div>
        <div class="pr-opciones ${stock ? '' : 'oculto'}" id="pr-opc"><label class="check"><input type="checkbox" id="pr-exc" ${c.excepcionHoraria ? 'checked' : ''}> Excepción horaria (antes de las 15:00, el de ayer al precio de hoy)</label>
          <label class="check"><input type="checkbox" id="pr-auto" ${c.autoEliminar !== false ? 'checked' : ''}> Se elimina solo al pasar los días</label></div>
      </div></fieldset>
    <fieldset class="pr-canal" id="pr-c-b2b"><legend><label class="check"><input type="checkbox" id="pr-b2b" ${habB ? 'checked' : ''} ${st.D.estados.b2b !== 'ok' ? 'disabled' : ''}> Se vende en B2B</label> ${H.info('B2B', TXT_B2B)}</legend>
      <div class="pr-canal-cuerpo ${habB ? '' : 'oculto'}">
        <div class="fila-campos rev-campos"><div class="campo"><label for="pr-pb">Precio base neto</label><input id="pr-pb" type="text" inputmode="numeric" value="${H.esc(vNum(b.precioBase))}"></div>
          <div class="campo"><label for="pr-catb2b">Categoría (opcional)</label><input id="pr-catb2b" list="pr-catb2b-l" maxlength="60" value="${H.esc(b.categoria || '')}"><datalist id="pr-catb2b-l">${categoriasB2b().map(k => `<option value="${H.esc(k)}">`).join('')}</datalist></div></div>
        ${docB && docB.nombre && docB.nombre !== x.nombre ? `<p class="ayuda">En B2B se llama "${H.esc(docB.nombre)}" (ese nombre no cambia).</p>` : ''}
      </div></fieldset>
    <fieldset class="pr-canal pr-ficha" id="pr-c-ficha"><legend>Foto y ficha para las listas de precios ${H.info('Foto y ficha para las listas', TXT_FICHA)}</legend>
      <div class="pr-foto-fila"><div class="pr-foto-col"><div class="pr-foto-ver" id="pr-foto-ver">${x.foto && x.foto.en ? '<span class="pr-foto-vacia" role="status">Cargando la foto…</span>' : `<span class="pr-foto-vacia">${H.icono('foto', 24)}<span>Sin foto</span></span>`}</div>
          <div class="pr-encuadre oculto" id="pr-encuadre"><label for="pr-foto-zoom" class="pr-zoom">${H.icono('lupa', 14)}<span class="sr">Acercar la foto</span><input type="range" id="pr-foto-zoom" min="1" max="${LMP.ZOOM_MAX}" step="0.05" value="1"></label>
            <button type="button" class="btn-link" id="pr-foto-centrar">Centrar</button> ${H.info('Encuadrar la foto', TXT_ENCUADRE)}</div></div>
        <div class="pr-foto-acc"><p class="ayuda" id="pr-foto-info">${x.foto && x.foto.en ? `${nf(x.foto.ancho)} × ${nf(x.foto.alto)} px` : 'JPG, PNG o WebP. Se achica sola antes de subir.'}</p>
          <div class="botones" style="justify-content:flex-start"><label class="btn-sec btn-chico pr-foto-subir" for="pr-foto-arch">${H.icono('subir', 16)} <span id="pr-foto-subir-t">${x.foto && x.foto.en ? 'Cambiar foto' : 'Subir foto'}</span></label><input type="file" id="pr-foto-arch" accept="image/*" class="sr">
          <button type="button" class="btn-sec btn-chico btn-peligro ${x.foto && x.foto.en ? '' : 'oculto'}" id="pr-foto-quitar">Quitar foto</button></div></div></div>
      <div class="fila-campos rev-campos"><div class="campo"><label for="pr-formato">Formato</label><input id="pr-formato" maxlength="40" value="${H.esc(x.formato || '')}" placeholder="Ej.: 800 g · Unidad · Caja 10 un" autocomplete="off"></div><div></div></div>
      <div class="campo"><label for="pr-desc">Descripción corta <span class="ayuda" id="pr-desc-n">${String(x.descripcionCorta || '').length}/140</span></label><textarea id="pr-desc" rows="2" maxlength="140" placeholder="Ej.: Masa madre, 24 horas de fermentación, corteza crujiente.">${H.esc(x.descripcionCorta || '')}</textarea></div>
    </fieldset>
    <p class="error" id="pr-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-dlg-no">Cancelar</button><button type="submit" class="btn" id="pr-dlg-si">${p ? 'Guardar cambios' : 'Crear producto'}</button></div>
    ${p && (p.historial || []).length ? `<details class="fin-hist"><summary>Historial</summary><ul class="fin-hist-lista">${[...p.historial].reverse().slice(0, 12).map(h => `<li><div><b>${H.esc(diaCorto(h.en))}</b> · ${H.esc(h.accion || '')}</div><span class="ayuda">${H.esc(h.por || '')}${h.nota ? ' · ' + H.esc(h.nota) : ''}${h.cambios ? ' · ' + H.esc(Object.keys(h.cambios).join(', ')) : ''}</span></li>`).join('')}</ul></details>` : ''}
  </form>`;
}
function leerForm(d) {
  const v = id => d.querySelector('#' + id).value, ch = id => d.querySelector('#' + id).checked;
  const t0 = (d.querySelector('input[name="pr-tipo"]:checked') || {}).value || '', pend = t0 === 'pendiente', tipo = pend ? 'receta' : t0;
  return { nombre: v('pr-nombre'), tipo, recetaId: pend ? null : v('pr-receta'), reventaId: v('pr-reventa'), area: tipo === 'cargo' ? v('pr-cargo-area') : pend ? v('pr-pend-area') : '',
    ...(pend ? { recetaPendiente: true, notaReceta: v('pr-pend-nota') } : {}),   // v0.80.1
    unidadesPorVenta: v('pr-upv'), formato: v('pr-formato'), descripcionCorta: v('pr-desc'),
    canales: { caja: { habilitado: ch('pr-caja'), areaCaja: v('pr-areacaja'), categoria: v('pr-catcaja'), controlStock: ch('pr-stock'), precios: Object.fromEntries(CPM.TARJETAS.map(([k]) => [k, v('pr-p-' + k)])), precioUnico: v('pr-unico'), excepcionHoraria: ch('pr-exc'), autoEliminar: ch('pr-auto') },
      b2b: { habilitado: ch('pr-b2b'), precioBase: v('pr-pb'), categoria: v('pr-catb2b') } } };
}
// p: el producto (o null); base: datos para precargar (un pedido); al guardar → onOk(resultado)
function dialogoProducto(el, p, { base = null, titulo = '', onGuardar = null, nota = '' } = {}) {
  const d = H.dialogo(formProducto(p, base));
  if (titulo) d.querySelector('h2').textContent = titulo;
  if (nota) d.querySelector('h2').insertAdjacentHTML('afterend', `<p class="aviso" id="pr-dlg-nota">${nota}</p>`);
  const vis = () => {
    const t = (d.querySelector('input[name="pr-tipo"]:checked') || {}).value;
    d.querySelector('.pr-si-receta').classList.toggle('oculto', t !== 'receta'); d.querySelector('.pr-si-pendiente').classList.toggle('oculto', t !== 'pendiente'); d.querySelectorAll('.pr-si-reventa').forEach(x => x.classList.toggle('oculto', t !== 'reventa'));
    d.querySelector('.pr-no-reventa').classList.toggle('oculto', t === 'reventa');   // v0.75.1: la reventa no elige pestaña
    d.querySelector('.pr-si-cargo').classList.toggle('oculto', t !== 'cargo'); d.querySelector('.pr-no-cargo').classList.toggle('oculto', t === 'cargo');
    d.querySelector('#pr-c-caja .pr-canal-cuerpo').classList.toggle('oculto', !d.querySelector('#pr-caja').checked);
    d.querySelector('#pr-c-b2b .pr-canal-cuerpo').classList.toggle('oculto', !d.querySelector('#pr-b2b').checked);
    const stock = d.querySelector('#pr-stock').checked;
    d.querySelector('#pr-precios').classList.toggle('oculto', !stock); d.querySelector('#pr-opc').classList.toggle('oculto', !stock); d.querySelector('#pr-unico-c').classList.toggle('oculto', stock);
  };
  d.addEventListener('change', ev => {
    vis();
    // Nombre propuesto desde la receta o la reventa (si está vacío)
    if (ev.target.id === 'pr-receta' || ev.target.id === 'pr-reventa') {
      const n = d.querySelector('#pr-nombre'); const r = ev.target.id === 'pr-receta' ? recetaDe(ev.target.value) : reventaDe(ev.target.value);
      if (r && !n.value.trim()) n.value = r.nombre;
      if (ev.target.id === 'pr-receta' && r && !d.querySelector('#pr-areacaja').value && (st.D.areasCaja || []).includes(CPM.areaCodigo(r.area))) d.querySelector('#pr-areacaja').value = CPM.areaCodigo(r.area);
    }
    // v0.80.1: la pestaña de la caja se propone desde el área de la receta pendiente
    if (ev.target.id === 'pr-pend-area' && ev.target.value && !d.querySelector('#pr-areacaja').value && (st.D.areasCaja || []).includes(ev.target.value)) d.querySelector('#pr-areacaja').value = ev.target.value;
  });
  d.querySelector('#pr-dlg-no').addEventListener('click', () => d.close());
  // v0.80.0 · Foto y ficha para las listas de precios: la foto se achica al elegirla y se sube al guardar
  // v0.80.2 · Encuadre: la vista tiene la forma de la foto en la tarjeta del PDF; se arrastra para moverla y la barra la acerca
  const foto = { nueva: null, quitar: false, enc: LMP.encuadre(), enc0: LMP.encuadre(), dims: null };
  const marco = d.querySelector('#pr-foto-ver'), panelEnc = d.querySelector('#pr-encuadre'), zoom = d.querySelector('#pr-foto-zoom');
  const pintarEnc = () => { const im = marco.querySelector('.pr-foto-img'); if (!im || !foto.dims) return; im.setAttribute('style', `background-image:url('${foto.dims.url}');` + LMP.fondoFoto({ ...foto.dims, encuadre: foto.enc }, marco.clientWidth || 240, marco.clientHeight || 106)); zoom.value = foto.enc.zoom; };
  const verFoto = (url, info, dims) => {
    foto.dims = url && dims ? { url, ancho: dims.ancho, alto: dims.alto } : null;
    marco.innerHTML = url ? `<div class="pr-foto-img" role="img" aria-label="Foto de ${H.esc((p || {}).nombre || 'el producto')}. Arrastra para encuadrarla."></div>` : `<span class="pr-foto-vacia">${H.icono('foto', 24)}<span>Sin foto</span></span>`;
    marco.classList.toggle('con-foto', !!url); panelEnc.classList.toggle('oculto', !url); pintarEnc();
    if (info !== undefined) d.querySelector('#pr-foto-info').textContent = info;
  };
  // Arrastrar (mouse o dedo): mover la foto dentro del marco
  let arr = null;
  marco.addEventListener('pointerdown', ev => { if (!foto.dims) return; ev.preventDefault(); marco.setPointerCapture(ev.pointerId); arr = { x: ev.clientX, y: ev.clientY, e: { ...foto.enc } }; marco.classList.add('arrastrando'); });
  marco.addEventListener('pointermove', ev => {
    if (!arr || !foto.dims) return;
    const w = marco.clientWidth, h = marco.clientHeight, t = LMP.tamFoto(foto.dims.ancho, foto.dims.alto, w, h, foto.enc.zoom);
    const nx = t.w - w > 0.5 ? arr.e.x - (ev.clientX - arr.x) / (t.w - w) * 100 : arr.e.x, ny = t.h - h > 0.5 ? arr.e.y - (ev.clientY - arr.y) / (t.h - h) * 100 : arr.e.y;
    foto.enc = LMP.encuadre({ ...foto.enc, x: nx, y: ny }); pintarEnc();
  });
  const soltar = () => { arr = null; marco.classList.remove('arrastrando'); };
  marco.addEventListener('pointerup', soltar); marco.addEventListener('pointercancel', soltar);
  // Teclado: flechas mueven, + y - acercan
  marco.tabIndex = 0;
  marco.addEventListener('keydown', ev => {
    if (!foto.dims) return; const k = ev.key, e = { ...foto.enc };
    if (k === 'ArrowLeft') e.x -= 5; else if (k === 'ArrowRight') e.x += 5; else if (k === 'ArrowUp') e.y -= 5; else if (k === 'ArrowDown') e.y += 5; else if (k === '+') e.zoom += 0.1; else if (k === '-') e.zoom -= 0.1; else return;
    ev.preventDefault(); foto.enc = LMP.encuadre(e); pintarEnc();
  });
  zoom.addEventListener('input', () => { foto.enc = LMP.encuadre({ ...foto.enc, zoom: zoom.value }); pintarEnc(); });
  d.querySelector('#pr-foto-centrar').addEventListener('click', () => { foto.enc = LMP.encuadre(); pintarEnc(); });
  if (p && p.foto && p.foto.en) import('./listas-precios.js?v=0.138.0').then(L => L.leerFoto(p.id)).then(f => { if (foto.nueva || foto.quitar) return; if (f) { foto.enc = foto.enc0 = LMP.encuadre(f.encuadre); } verFoto(f && f.mini, undefined, f); }).catch(() => verFoto(null, 'No se pudo leer la foto.'));
  d.querySelector('#pr-desc').addEventListener('input', ev => { d.querySelector('#pr-desc-n').textContent = `${ev.target.value.length}/140`; });
  d.querySelector('#pr-pend-nota').addEventListener('input', ev => { d.querySelector('#pr-pend-n').textContent = `${ev.target.value.length}/${CPM.NOTA_RECETA_MAX}`; });
  d.querySelector('#pr-foto-arch').addEventListener('change', async ev => {
    const a = ev.target.files && ev.target.files[0]; if (!a) return;
    const err = d.querySelector('#pr-dlg-err'); err.textContent = ''; verFoto(null, 'Achicando la foto…');
    try {
      const IM = await import('./imagenes.js?v=0.138.0'), r = await IM.fotoProducto(a);
      foto.nueva = r; foto.quitar = false; foto.enc = LMP.encuadre(); verFoto(r.mini, `${nf(r.ancho)} × ${nf(r.alto)} px · ${nf(Math.round(r.bytes / 1024))} KB (la original: ${nf(Math.round(a.size / 1024))} KB). Se sube al guardar.`, r);
      d.querySelector('#pr-foto-quitar').classList.remove('oculto'); d.querySelector('#pr-foto-subir-t').textContent = 'Cambiar foto';
    } catch (e) { err.textContent = e.message; verFoto(null, ''); }
    ev.target.value = '';
  });
  d.querySelector('#pr-foto-quitar').addEventListener('click', () => { foto.nueva = null; foto.quitar = !!(p && p.foto && p.foto.en); verFoto(null, foto.quitar ? 'La foto se quita al guardar.' : ''); d.querySelector('#pr-foto-quitar').classList.add('oculto'); d.querySelector('#pr-foto-subir-t').textContent = 'Subir foto'; });
  d.querySelector('#pr-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#pr-dlg-err'), b = d.querySelector('#pr-dlg-si'), txt = b.textContent; err.textContent = '';
    const datos = leerForm(d);
    try { CPM.validar(datos, { recetas: st.D.recetas, reventa: st.D.reventa, lista: st.D.maestro, prev: p, areasCaja: st.D.areasCaja }); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    await conOcupado(async () => {
      try {
        const r = onGuardar ? await onGuardar(datos) : await C.guardar(st.D, datos, p ? p.id : null);
        const x = r.producto, cs = CPM.canalesDe(x).map(c => CPM.NOMBRE_CANAL[c]).join(' y ');
        H.registrar(p ? 'Catálogo: cambió un producto' : 'Catálogo: creó un producto', `${x.nombre} · ${x.id} · ${cs || 'sin canal'}`);
        st.msg = p ? `${x.nombre}: guardado${cs ? ' (' + cs + ')' : ''}.` : `${x.nombre} creado (${x.id})${cs ? ' · en ' + cs : ''}.`; st.err = '';
        if (!foto.nueva && !foto.quitar && foto.dims && !LMP.encuadreIgual(foto.enc, foto.enc0)) {   // v0.80.2: solo cambió el encuadre
          try { const L = await import('./listas-precios.js?v=0.138.0'); await L.guardarEncuadre(x.id, foto.enc); H.registrar('Catálogo: encuadró la foto', `${x.nombre} · ${x.id}`); st.msg += ' Encuadre de la foto guardado.'; }
          catch (e) { st.err = `${x.nombre} quedó guardado, pero no el encuadre de la foto: ${error(e)} Vuelve a intentarlo.`; }
        }
        if (foto.nueva || foto.quitar) {
          try {
            const L = await import('./listas-precios.js?v=0.138.0'), rf = await L.guardarFoto(x.id, foto.nueva, foto.enc);
            if (rf.accion) { const i = st.D.maestro.findIndex(y => y.id === x.id); if (i >= 0) st.D.maestro[i] = { ...st.D.maestro[i], foto: rf.p.foto, historial: rf.p.historial }; H.registrar('Catálogo: ' + rf.accion, `${x.nombre} · ${x.id}`); st.msg += foto.nueva ? ' Foto guardada.' : ' Foto quitada.'; }
          } catch (e) { st.err = `${x.nombre} quedó guardado, pero no la foto: ${error(e)} Vuelve a intentarlo.`; }
        }
        d.close(); if (location.hash.split('/')[2]) history.replaceState(null, '', '#catalogo/productos'); dibujar(el);
      } catch (e) { err.textContent = error(e); b.disabled = false; b.textContent = txt; if (e.producto) { st.err = err.textContent; } }
    });
  });
}
function dialogoArchivar(el, p, arch) {
  if (!p) return;
  const cs = CPM.canalesDe(p).map(c => CPM.NOMBRE_CANAL[c]);
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" method="dialog" novalidate>
    <h2>${arch ? 'Archivar' : 'Reactivar'} ${H.esc(p.nombre)}</h2>
    <p class="ayuda">${arch ? `Sale de ${cs.length ? cs.join(' y ') : 'los canales'} (en la caja queda inactivo; en B2B, archivado) y de la lista de logística. Sus ventas y costos pasados siguen contando y se deshace con "Reactivar".` : 'Vuelve al catálogo sin canales: habilítalo después en la caja o en B2B, con su precio (Cambiar).'}</p>
    <p class="error" id="pr-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-dlg-no">Cancelar</button><button type="submit" class="btn${arch ? ' btn-peligro-lleno' : ''}" id="pr-dlg-si">${arch ? 'Archivar' : 'Reactivar'}</button></div></form>`);
  d.querySelector('#pr-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#pr-dlg-si'); b.disabled = true;
    await conOcupado(async () => {
      try { await C.archivar(st.D, p.id, arch); H.registrar(arch ? 'Catálogo: archivó un producto' : 'Catálogo: reactivó un producto', `${p.nombre} · ${p.id}`); st.msg = `${p.nombre}: ${arch ? 'archivado' : 'reactivado'}.`; st.err = ''; d.close(); dibujar(el); }
      catch (e) { d.querySelector('#pr-dlg-err').textContent = error(e); b.disabled = false; }
    });
  });
}
// ── v0.80.1 · Unir con su receta (un producto con la receta pendiente) ──
function dialogoUnir(el, p) {
  if (!p) return;
  const opciones = todas => { const xs = CPM.recetasParaUnir(st.D.recetas, p.area, todas), porArea = {};
    xs.forEach(r => { const a = CPM.areaCodigo(r.area) || 'otra'; (porArea[a] || (porArea[a] = [])).push(r); });
    return `<option value="">${xs.length ? 'Elige…' : todas ? 'No hay recetas aprobadas' : 'No hay recetas aprobadas de esta área (marca "Ver todas las áreas")'}</option>` + [...AR.PRODUCCION, 'otra'].filter(a => porArea[a]).map(a => `<optgroup label="${H.esc(AR.NOMBRE[a] || 'Otra')}">${porArea[a].map(r => `<option value="${H.esc(r.id)}">${H.esc(r.nombre)} · ${H.esc(r.id)}</option>`).join('')}</optgroup>`).join(''); };
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" id="pr-unir-form" novalidate>
    <h2>Unir ${H.esc(p.nombre)} con su receta ${H.info('Unir con su receta', TXT_UNIR)}</h2>
    <p class="ayuda">${H.esc(p.id)} · ${H.esc(AR.NOMBRE[p.area] || p.area || 'Sin área')} · ${CPM.canalesDe(p).map(c => CPM.NOMBRE_CANAL[c]).join(' y ') || 'sin canal'}${p.notaReceta ? ` · faltaba: ${H.esc(p.notaReceta)}` : ''}</p>
    <div class="campo"><label for="pr-unir-receta">Receta aprobada</label><select id="pr-unir-receta">${opciones(false)}</select></div>
    <label class="check"><input type="checkbox" id="pr-unir-todas"> Ver todas las áreas</label>
    ${st.D.estados.cocina !== 'ok' ? '<p class="aviso">Cocina (fen-produccion) no está conectada: sin la lista de recetas. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : ''}
    <p class="error" id="pr-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-dlg-no">Cancelar</button><button type="submit" class="btn" id="pr-dlg-si">${H.icono('enlace', 16)} Unir con esta receta</button></div></form>`);
  d.querySelector('#pr-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('#pr-unir-todas').addEventListener('change', ev => { d.querySelector('#pr-unir-receta').innerHTML = opciones(ev.target.checked); });
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#pr-dlg-err'), b = d.querySelector('#pr-dlg-si'), rid = d.querySelector('#pr-unir-receta').value; err.textContent = '';
    if (!rid) { err.textContent = 'Elige la receta (solo las aprobadas).'; return; }
    b.disabled = true;
    await conOcupado(async () => {
      try {
        const r = await C.unirReceta(st.D, p.id, rid), x = r.producto, rec = recetaDe(rid);
        H.registrar('Catálogo: unió un producto con su receta', `${x.nombre} · ${x.id} → ${rec ? rec.nombre : rid} (${rid})`);
        st.msg = `${x.nombre} quedó unido con su receta ${rec ? rec.nombre : rid}: desde ahora tiene costo y margen.`; st.err = '';
        d.close(); dibujar(el);
      } catch (e) { err.textContent = error(e); b.disabled = false; if (e.producto) { st.err = err.textContent; } }
    });
  });
}
// ── Pedidos ──
function resolverPedido(el, pd) {
  if (!pd) return;
  const { id, datos } = CPM.datosPedido(pd, { recetas: st.D.recetas });
  const p = id ? st.D.maestro.find(x => x.id === id) : null;
  const quien = pd.origen === 'caja' ? `la caja${pd.sucursal ? ' (' + H.esc(sucTxt(pd.sucursal)) + ')' : ''}` : `logística${pd.cliente ? ' para ' + H.esc(pd.cliente) : ''}`;
  const nota = `Lo pide ${quien}${pd.por ? ' · ' + H.esc(pd.por) : ''}${pd.precio ? ` · propone ${pesos(pd.precio)} ${pd.origen === 'caja' ? 'con IVA' : 'neto'}` : ''}${pd.nota ? ` · "${H.esc(pd.nota)}"` : ''}. ${p ? `Ya está en el catálogo: se habilita en ${pd.origen === 'caja' ? 'la caja' : 'B2B'}.` : 'Se crea en el catálogo.'}`;
  dialogoProducto(el, p, { base: datos, titulo: p ? `Habilitar ${p.nombre}` : 'Crear producto pedido', nota, onGuardar: async dt => {
    const r = await C.resolverPedido(st.D, pd, dt, p ? p.id : null);
    H.registrar('Catálogo: resolvió un pedido de producto', `${r.producto.nombre} · ${r.producto.id} · ${pd.origen === 'caja' ? 'caja' : 'logística'}`);
    return r;
  } });
}
function rechazarPedido(el, pd) {
  if (!pd) return;
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" novalidate><h2>Rechazar el pedido</h2>
    <p class="ayuda"><b>${H.esc(pd.nombre)}</b> · ${pd.origen === 'caja' ? 'Caja' : 'Logística'}${pd.por ? ' · ' + H.esc(pd.por) : ''}. El motivo le llega como respuesta.</p>
    <div class="campo"><label for="pr-motivo">Motivo</label><input id="pr-motivo" maxlength="300" autocomplete="off"></div>
    <p class="error" id="pr-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-dlg-no">Cancelar</button><button type="submit" class="btn btn-peligro-lleno" id="pr-dlg-si">Rechazar</button></div></form>`);
  d.querySelector('#pr-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#pr-dlg-si'), m = d.querySelector('#pr-motivo').value; b.disabled = true;
    try { await C.rechazarPedido(st.D, pd, m); H.registrar('Catálogo: rechazó un pedido de producto', `${pd.nombre} · ${m}`); st.msg = `Pedido rechazado: ${pd.nombre}.`; d.close(); dibujar(el); }
    catch (e) { d.querySelector('#pr-dlg-err').textContent = error(e); b.disabled = false; }
  });
}

// ═══════════════ Armar el catálogo ═══════════════
const grupo = gid => (st.grupos || []).find(g => g.gid === gid) || null;
const ctxG = () => ({ recetas: st.D.recetas, reventa: st.D.reventa });
function proponer() {
  const D = st.D;
  st.grupos = CPM.proponerGrupos({ caja: Object.values(D.cat.caja), b2b: Object.values(D.cat.b2b), vinculos: D.vinculos, recetas: D.recetas, reventa: D.reventa, maestro: D.maestro });
}
function separar(gid) {
  const g = grupo(gid); if (!g || !g.caja || !g.b2b) return;
  const i = st.grupos.indexOf(g), nb = { ...g, gid: g.gid + '·b2b', caja: null, nombre: g.b2b.nombre, avisos: g.b2b.aviso ? [g.b2b.aviso] : [] };
  g.b2b = null; g.avisos = g.caja.aviso ? [g.caja.aviso] : [];
  if (nb.tipo === 'cargo') nb.area = 'B2B';
  st.grupos.splice(i + 1, 0, nb);
}
function juntar(gidA, gidB) {
  const a = grupo(gidA), b = grupo(gidB); if (!a || !b || a === b) return;
  if ((a.caja && b.caja) || (a.b2b && b.b2b)) return;
  a.caja = a.caja || b.caja; a.b2b = a.b2b || b.b2b;
  if (!a.tipo && b.tipo) Object.assign(a, { tipo: b.tipo, recetaId: b.recetaId, reventaId: b.reventaId, area: b.area, unidadesPorVenta: b.unidadesPorVenta });
  a.avisos = [...new Set([...(a.avisos || []), ...(b.avisos || [])])];
  st.grupos.splice(st.grupos.indexOf(b), 1);
}
// v0.80.1 · El área que se propone para una receta pendiente: la de la receta que ya tenía (aunque no esté aprobada) o la pestaña de la caja
function areaPropuesta(g) {
  const r = recetaDe(g.recetaId), a = CPM.areaCodigo(r && r.area);
  if (AR.PRODUCCION.includes(a)) return a;
  const c = CPM.areaCodigo(g.caja && g.caja.doc && g.caja.doc.area), b = CPM.areaCodigo(g.b2b && g.b2b.doc && g.b2b.doc.area);
  return AR.PRODUCCION.includes(c) ? c : AR.PRODUCCION.includes(b) ? b : '';
}
function revisarGrupo(g) {
  const f = CPM.faltaGrupo(g, ctxG()), el = document.querySelector(`[data-g="${CSS.escape(g.gid)}"] .g-estado`);
  if (el) { el.className = `chip chip-chico g-estado ${g.accion === 'archivar' ? 'c-gris' : f ? 'c-amarillo' : 'c-verde'}`; el.textContent = g.accion === 'archivar' ? 'Se archiva' : f ? 'Falta' : 'Listo'; el.title = f; }
  const m = document.querySelector(`[data-g="${CSS.escape(g.gid)}"] .g-falta`); if (m) m.textContent = g.accion === 'archivar' ? '' : f;
  resumenArmar();
}
function resumenArmar() {
  const gs = st.grupos || [], ctx0 = ctxG();
  const archivar = gs.filter(g => g.accion === 'archivar').length, falta = gs.filter(g => g.accion !== 'archivar' && CPM.faltaGrupo(g, ctx0)).length, listos = gs.length - archivar - falta;
  const rep = CPM.repetidos(gs, st.D.maestro).length;
  const pend = gs.filter(g => g.accion !== 'archivar' && g.tipo === 'receta' && g.recetaPendiente).length;   // v0.80.1
  const r = $('g-resumen'); if (r) r.innerHTML = `<span class="chip c-verde">Listos ${nf(listos)}</span>${pend ? `<span class="chip c-amarillo" id="g-n-pend">Con receta pendiente ${nf(pend)}</span>` : ''}<span class="chip ${falta ? 'c-amarillo' : 'c-gris'}">Por resolver ${nf(falta)}</span><span class="chip c-gris">A archivar ${nf(archivar)}</span>${rep ? `<span class="chip c-rojo">Nombres repetidos ${nf(rep)}</span>` : ''}`;
  const b = $('g-guardar'); if (b) { b.disabled = !!falta || !!rep || !gs.length; b.lastChild.textContent = ` Guardar el catálogo (${nf(listos)} ${listos === 1 ? 'producto' : 'productos'}${archivar ? ` · archivar ${nf(archivar)}` : ''})`; }
}
function itemTxt(it) {
  if (!it) return '<span class="ayuda">—</span>';
  const d = it.doc || {};
  const precio = it.canal === 'caja' ? `${pesos(d.precioHoy || d.precio)} con IVA` : `${pesos(d.precioBase)} neto`;
  return `${H.esc(it.nombre)} <span class="ayuda">${H.esc(it.docId)} · ${precio}${it.origen === 'finanzas' ? ' · vínculo de Finanzas' : it.origen === 'catalogo' ? ' · ID de receta del catálogo' : ''}</span>`;
}
function filaGrupo(g) {
  const f = g.accion === 'archivar' ? '' : CPM.faltaGrupo(g, ctxG()), tipo = g.accion === 'archivar' ? 'archivar' : g.tipo === 'receta' && g.recetaPendiente ? 'pendiente' : g.tipo || '';
  const solo = !(g.caja && g.b2b), mio = g.caja ? 'caja' : 'b2b', falta = mio === 'caja' ? 'b2b' : 'caja';
  const otros = solo && g.accion !== 'archivar' ? st.grupos.filter(x => x !== g && x[falta] && !x[mio] && x.accion !== 'archivar') : [];
  return `<div class="g-fila" data-g="${H.esc(g.gid)}">
    <div class="g-cab"><span class="chip chip-chico g-estado ${g.accion === 'archivar' ? 'c-gris' : f ? 'c-amarillo' : 'c-verde'}" title="${H.esc(f)}">${g.accion === 'archivar' ? 'Se archiva' : f ? 'Falta' : 'Listo'}</span>
      <div class="campo g-nombre"><label for="g-n-${H.esc(g.gid)}" class="sr">Nombre</label><input id="g-n-${H.esc(g.gid)}" data-g-nombre="${H.esc(g.gid)}" maxlength="120" value="${H.esc(g.nombre)}" ${g.accion === 'archivar' ? 'disabled' : ''}></div></div>
    <div class="g-cuerpo">
      <div class="campo"><label for="g-t-${H.esc(g.gid)}">Sale de</label><select id="g-t-${H.esc(g.gid)}" data-g-tipo="${H.esc(g.gid)}"><option value="">Elige…</option><option value="receta" ${tipo === 'receta' ? 'selected' : ''}>Receta aprobada</option><option value="pendiente" ${tipo === 'pendiente' ? 'selected' : ''}>Receta pendiente (se vende, sin receta aprobada)</option><option value="reventa" ${tipo === 'reventa' ? 'selected' : ''}>Reventa</option><option value="cargo" ${tipo === 'cargo' ? 'selected' : ''}>Cargo (Despacho)</option><option value="archivar" ${tipo === 'archivar' ? 'selected' : ''}>Archivar (ya no se vende)</option></select></div>
      ${tipo === 'receta' ? `<div class="campo"><label for="g-r-${H.esc(g.gid)}">Receta</label><select id="g-r-${H.esc(g.gid)}" data-g-receta="${H.esc(g.gid)}">${opcionesRecetas(g.recetaId)}</select></div>` : ''}
      ${tipo === 'pendiente' ? `<div class="campo"><label for="g-a-${H.esc(g.gid)}">Área que lo produce</label><select id="g-a-${H.esc(g.gid)}" data-g-area="${H.esc(g.gid)}"><option value="">Elige…</option>${AR.PRODUCCION.map(a => `<option value="${a}" ${g.area === a ? 'selected' : ''}>${H.esc(AR.NOMBRE[a] || a)}</option>`).join('')}</select></div>
        <div class="campo"><label for="g-o-${H.esc(g.gid)}">Qué receta falta (opcional)</label><input id="g-o-${H.esc(g.gid)}" data-g-nota="${H.esc(g.gid)}" maxlength="${CPM.NOTA_RECETA_MAX}" value="${H.esc(g.notaReceta || '')}" autocomplete="off"></div>` : ''}
      ${tipo === 'reventa' ? `<div class="campo"><label for="g-v-${H.esc(g.gid)}">Reventa</label><select id="g-v-${H.esc(g.gid)}" data-g-reventa="${H.esc(g.gid)}">${opcionesReventa(g.reventaId)}</select></div>` : ''}
      ${tipo === 'receta' || tipo === 'pendiente' || tipo === 'reventa' ? `<div class="campo g-upv"><label for="g-u-${H.esc(g.gid)}">Un. por venta</label><input id="g-u-${H.esc(g.gid)}" data-g-upv="${H.esc(g.gid)}" inputmode="decimal" value="${H.esc(String(g.unidadesPorVenta ?? 1))}"></div>` : ''}
    </div>
    <dl class="cat-datos g-canales"><div><dt>Caja</dt><dd>${itemTxt(g.caja)}</dd></div><div><dt>B2B</dt><dd>${itemTxt(g.b2b)}</dd></div></dl>
    <p class="ayuda g-falta">${H.esc(f)}</p>
    <div class="cat-acc">${g.caja && g.b2b ? `<button type="button" class="btn-sec btn-chico" data-g-separar="${H.esc(g.gid)}">Separar caja y B2B</button>` : ''}
      ${solo && otros.length ? `<div class="campo g-juntar"><label for="g-j-${H.esc(g.gid)}" class="sr">Juntar con</label><select id="g-j-${H.esc(g.gid)}" data-g-juntar="${H.esc(g.gid)}"><option value="">Juntar con…</option>${otros.map(x => `<option value="${H.esc(x.gid)}">${H.esc(x.nombre)} (${x.caja ? 'caja' : 'B2B'})</option>`).join('')}</select></div>` : ''}</div>
  </div>`;
}
function dibujarArmar(el) {
  const D = st.D, cfg = D.config || {}, u = D.uso;
  if (!st.grupos) proponer();
  const pend = C.porTerminar(D);
  el.innerHTML = st.cab() + `
    <section class="tarjeta" aria-labelledby="t-g">
      <div class="titulo-fila"><h2 id="t-g">Armar el catálogo ${H.info('Cómo armar el catálogo', TXT_ARMAR)}</h2>${cfg.armadoEn ? `<span class="ayuda" id="g-armado">Armado el ${H.esc(diaCorto(cfg.armadoEn))}${cfg.armadoPor ? ' por ' + H.esc(cfg.armadoPor) : ''} · ${nf(D.maestro.length)} productos</span>` : ''}</div>
      <p class="ayuda">${cfg.armadoEn ? 'Lo vivo de la caja y de B2B que todavía no está unido a un producto del catálogo.' : 'Une lo vivo de la caja y de B2B en productos del catálogo. Revisa cada grupo y guarda una vez: los precios no cambian.'}</p>
      ${D.estados.b2b !== 'ok' ? '<p class="aviso">B2B (fen-b2b) no está conectada en este equipo: arma el catálogo cuando esté conectada (si no, quedan fuera los productos de B2B). Conéctala en <a href="#b2b">Ventas a empresas</a>.</p>' : ''}
      ${D.estados.cocina !== 'ok' ? '<p class="aviso">Cocina (fen-produccion) no está conectada: sin la lista de recetas. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : ''}
      ${pend.length ? `<div class="aviso" id="g-pendientes">${nf(pend.length)} ${pend.length === 1 ? 'documento de la caja o de B2B no quedó' : 'documentos de la caja o de B2B no quedaron'} unidos (el guardado se cortó). <button type="button" class="btn-sec btn-chico" id="g-terminar">Terminar de unir</button></div>` : ''}
      <div class="cat-resumen" id="g-resumen" role="group" aria-label="Resumen"></div>
      <p class="ok-texto" id="g-msg" role="status">${H.esc(st.gmsg)}</p><p class="error" id="g-err" role="alert">${H.esc(st.gerr)}</p>
      <div id="g-lista" class="g-lista">${st.grupos.length ? st.grupos.map(filaGrupo).join('') : `<div class="vacio">${cfg.armadoEn ? 'Todo lo vivo de la caja y de B2B está unido al catálogo.' : 'No hay productos vivos en la caja ni en B2B.'}</div>`}</div>
      ${st.grupos.length ? `<div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="g-guardar">${H.icono('check', 16)} Guardar el catálogo</button></div>` : ''}
      <p class="ayuda" id="g-lecturas">Lecturas al abrir: Gastos y Finanzas ${nf(u.gastos)} · caja ${nf(u.caja)} · B2B ${nf(u.b2b)} · Cocina ${nf(u.cocina)} · Guardar: ${nf(st.grupos.length)} productos en 1 lote, 1 escritura por documento de la caja y 1 lote en B2B</p>
    </section>`;
  resumenArmar();
}
function confirmarArmar(el) {
  const gs = st.grupos || [], crear = gs.filter(g => g.accion !== 'archivar'), arch = gs.filter(g => g.accion === 'archivar');
  const nCaja = crear.filter(g => g.caja).length, nB2b = crear.filter(g => g.b2b).length;
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" novalidate><h2>Guardar el catálogo</h2>
    <ul class="cat-dlg-lista"><li><b>${nf(crear.length)}</b> ${crear.length === 1 ? 'producto nuevo' : 'productos nuevos'} en el catálogo (PR…)</li>${crear.some(g => g.tipo === 'receta' && g.recetaPendiente) ? `<li><b>${nf(crear.filter(g => g.tipo === 'receta' && g.recetaPendiente).length)}</b> con la receta pendiente: se siguen vendiendo, sin costo hasta unirlos con su receta (Productos → Falta receta)</li>` : ''}<li>Su ID en <b>${nf(nCaja)}</b> ${nCaja === 1 ? 'producto' : 'productos'} de la caja y <b>${nf(nB2b)}</b> de B2B (conservan su ID y su precio)</li>${arch.length ? `<li><b>${nf(arch.length)}</b> ${arch.length === 1 ? 'se archiva' : 'se archivan'} en su canal (se deshace con "Reactivar" en Qué está vivo)</li>` : ''}<li>El vínculo de Finanzas donde no había uno (los que ya tenías asociados quedan para los meses anteriores)</li></ul>
    <p class="ayuda">Desde este mes, Finanzas y el Plan de Panadería toman la receta de cada producto del catálogo. Los meses cerrados no cambian.</p>
    <p class="error" id="pr-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-dlg-no">Cancelar</button><button type="submit" class="btn" id="pr-dlg-si">Guardar</button></div></form>`);
  d.querySelector('#pr-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#pr-dlg-si'); b.disabled = true; b.textContent = 'Guardando…';
    await conOcupado(async () => {
      try {
        const r = await C.armar(st.D, gs);
        H.registrar('Catálogo: armó el catálogo', `${r.creados} productos · ${r.archivados} archivados · ${r.vinculos} vínculos de Finanzas${r.distintos ? ` · ${r.distintos} vínculos antiguos distintos (se dejan)` : ''}`);
        st.gmsg = `Listo: ${nf(r.creados)} ${r.creados === 1 ? 'producto' : 'productos'} en el catálogo${r.archivados ? `, ${nf(r.archivados)} archivados` : ''}.${r.distintos ? ` ${nf(r.distintos)} ${r.distintos === 1 ? 'producto tenía' : 'productos tenían'} en Finanzas una asociación distinta: queda para los meses anteriores.` : ''}`; st.gerr = '';
        st.grupos = null; d.close(); dibujarArmar(el);
      } catch (e) { d.querySelector('#pr-dlg-err').textContent = error(e); b.disabled = false; b.textContent = 'Guardar'; }
    });
  });
}
async function terminar(el) {
  await conOcupado(async () => {
    try { const n = await C.terminar(st.D); H.registrar('Catálogo: terminó de unir', `${n} documentos`); st.gmsg = `Unidos ${nf(n)}.`; st.gerr = ''; }
    catch (e) { st.gerr = error(e); }
    st.grupos = null; dibujarArmar(el);
  });
}
