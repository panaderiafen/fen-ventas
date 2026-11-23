// ═══════════════════════════════════════════════
//  Sistema Fën — Ventas B2B → Listas de precios (#b2b/listas)  v0.80.0
//  #b2b/listas: las listas guardadas (cliente, fecha, n° de productos, vigencia, estado) y "Portada, condiciones y contacto".
//  #b2b/listas/nueva: armar una lista (cliente o cliente nuevo; productos del Catálogo habilitados en B2B; precio de esta lista,
//   que parte del precio especial del cliente o del base; orden por área y nombre, con subir y bajar; condiciones).
//  #b2b/listas/{id}: la vista previa del PDF, Descargar PDF, Enviar por WhatsApp, Usar como precios especiales, Duplicar y Cambiar.
//  #b2b/listas/{id}/cambiar: lo mismo que "nueva", con la lista guardada.
//  Datos en listas-precios.js; reglas en listas-precios-modelo.js; el PDF en pdf-lista-precios.js.
//  H = ayudas de app.js { esc, info, icono, registrar, mensajeError, dialogo }; X = { cab(), datos(), errorB2b, abrirWhatsapp, esCelular, copiarTexto }
// ═══════════════════════════════════════════════
import * as L from './listas-precios.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';
import * as VA from './vista-aviso-producto.js?v=0.138.0';   // v0.138.0: avisos de producto nuevo

const st = { ed: null, maestro: null, ocupado: false, listos: new Map(), aviso: null };   // maestro: se vuelve a pedir en cada apertura (la memoria de Gastos y Finanzas solo trae lo que cambió)
export const estado = st;
let H = null, X = null, EL = null;
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL');
const pesos = v => (Number(v) > 0 ? '$' + Math.round(Number(v)).toLocaleString('es-CL') : '—');
const entero = v => Math.round(Number(String(v ?? '').replace(/[^\d]/g, '')) || 0);
const areaNombre = a => AR.NOMBRE[a] || a || 'Otros';

const TXT_LISTAS = 'Una lista de precios es un PDF para un cliente (o uno nuevo): sus productos con foto, formato, descripción corta y precio neto + IVA, las condiciones (despacho, formas de pago, vigencia) y tu contacto.\nEl precio de cada producto en la lista es solo para esa lista: no cambia el Catálogo ni los precios del cliente. Si el cliente acepta, "Usar como precios especiales" los deja como sus precios especiales (con su historial).\nLas listas quedan guardadas en la base de B2B; logística no las ve.';
const TXT_CONFIG = 'La portada es la imagen grande de la primera hoja (una foto del local, del pan o de la vitrina). Se achica en este equipo antes de subirla (hasta 1.600 px y 250 KB), así el PDF queda liviano.\nLas condiciones y el contacto se proponen en cada lista nueva; en cada lista los puedes cambiar.\nNo hay pedido mínimo: lo ajustas con cada cliente según su rotación y cobras el despacho. Si alguna vez quieres decir algo más, usa "Otras condiciones".';
const TXT_FOTOS = 'Las fotos se suben en Catálogo → Productos → Cambiar (Foto y ficha para las listas). Aquí se leen solo las de los productos que marcas: 1 lectura por producto con foto, y quedan en memoria mientras la app está abierta.';
const TXT_PRECIO = 'Parte del precio especial del cliente (si tiene) o del precio base del Catálogo. Lo que escribas vale solo para esta lista: el Catálogo y los precios del cliente no cambian.';
const TXT_APLICAR = 'Deja los precios de esta lista como precios especiales del cliente, por el ID de cada producto.\nSolo cambian los productos cuyo precio en la lista es distinto del precio base (y distinto de su precio especial actual). Los demás precios especiales del cliente quedan igual; nada se borra.\nCada cambio queda en el historial de precios del cliente (Ventas a empresas → Clientes) y la lista queda "Aplicada".';
const TXT_LECTURAS = 'Lecturas de esta pantalla en la sesión. B2B: las listas guardadas (1 por lista, hasta 60) y la configuración (1), una vez. Gastos: 1 por foto de producto marcado (después, de la memoria). Los clientes y productos de B2B ya están en vivo (0).';

// ═══════════════ Entrada ═══════════════
export async function pintar(el, h, x) {
  H = h; X = x; EL = el; st.maestro = null; olvidarAviso();
  if (!el.dataset.lpEventos) { el.dataset.lpEventos = '1'; conectar(el); }
  const p = location.hash.split('/'), a = decodeURIComponent(p[2] || ''), b = p[3] || '';
  el.innerHTML = X.cab() + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo las listas de precios…</div></section>';
  try { await Promise.all([L.leerListas(), L.leerConfig()]); }
  catch (e) { if (e && e.code === 'sin_reglas') return sinReglas(el, e); return falla(el, e); }
  if (!enListas()) return;
  if (a === 'avisos') return VA.pintar(el, ctxAviso(), decodeURIComponent(b), p[4] || '');   // v0.138.0
  if (a === 'nueva') { if (!st.ed || st.ed.id) st.ed = await nuevoEditor(); return pintarEditor(el); }
  if (a && b === 'cambiar') { const l = L.listaEnMemoria(a); if (!l) return noEsta(el); if (!st.ed || st.ed.id !== a) st.ed = await editorDe(l); return pintarEditor(el); }
  if (a) { const l = L.listaEnMemoria(a); if (!l) return noEsta(el); return pintarDetalle(el, l); }
  st.ed = null;
  pintarInicio(el);
}
const enListas = () => /^#b2b\/listas(\/|$)/.test(location.hash);
const ctxAviso = () => ({ H, X, universo, cfg: () => L.leerConfig(), leerFoto: id => L.leerFoto(id) });
// El mensaje de lo último que hiciste se muestra en la pantalla donde quedaste (y se olvida al ir a otra)
const avisar = (t, h = location.hash, err = false) => { st.aviso = { h, t, err }; };
const avisoDe = err => (st.aviso && st.aviso.h === location.hash && !!st.aviso.err === err ? st.aviso.t : '');
const olvidarAviso = () => { if (st.aviso && st.aviso.h !== location.hash) st.aviso = null; };
const error = e => (e && e.message) || H.mensajeError(e);
function falla(el, e) { el.innerHTML = X.cab() + `<section class="tarjeta"><p class="error" role="alert">${H.esc(X.errorB2b ? X.errorB2b(e) : error(e))}</p></section>`; }
function sinReglas(el, e) {
  el.innerHTML = X.cab() + `<section class="tarjeta" aria-labelledby="t-lp-reglas"><h2 id="t-lp-reglas">Listas de precios</h2>
    <p class="aviso" id="lp-sin-reglas">${H.esc(e.message)}</p>
    <p class="ayuda">En la consola de Firebase → proyecto <b>fen-b2b</b> → Firestore Database → Reglas → pega <code>firestore-b2b.rules</code> (arriba dice v1.8.0) → Publicar. Después recarga esta página.</p></section>`;
}
function noEsta(el) { el.innerHTML = X.cab() + `<section class="tarjeta"><p class="aviso">Esa lista ya no está (o es de hace más de 60 listas). <a href="#b2b/listas">Volver a las listas</a></p></section>`; }
async function maestro() {
  if (st.maestro) return st.maestro;
  const F = await import('./finanzas.js?v=0.138.0');
  const m = await F.leerMaestro();
  st.maestro = m.lista || [];
  return st.maestro;
}
async function universo() {
  let lista = [];
  try { lista = await maestro(); } catch (e) { throw new Error('Los productos salen del Catálogo, que se guarda en la base de Gastos y Finanzas (fen-gastos): conéctala en Gastos → Configuración → Base nueva.'); }
  return LM.ordenar(LM.elegibles(lista, (X.datos() || {}).productos || []));
}
const clientes = () => ((X.datos() || {}).clientes || []).filter(c => c.estado !== 'archivado').slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
const clienteDe = id => ((X.datos() || {}).clientes || []).find(c => c.id === id) || null;
const lecturasTxt = () => `Lecturas en esta sesión: B2B ${nf(L.uso.b2b)} · fotos (Gastos) ${nf(L.uso.fotos)} · escrituras ${nf(L.uso.escrituras)}`;
async function conOcupado(fn) { st.ocupado = true; try { return await fn(); } finally { st.ocupado = false; } }

// ═══════════════ Inicio: listas guardadas + portada, condiciones y contacto ═══════════════
async function pintarInicio(el) {
  const ls = await L.leerListas(), cfg = await L.leerConfig(), hoy = L.hoyTxt();
  const filas = ls.map(l => { const e = LM.estadoLista(l), venc = LM.vencida(l, hoy);
    return `<tr data-lp-lista="${H.esc(l.id)}"><td><b>${H.esc(l.cliente.nombre)}</b>${l.cliente.id ? '' : ' <span class="chip chip-chico c-lila">Cliente nuevo</span>'}</td><td data-et="Fecha">${H.esc(LM.fechaCorta(l.fecha))}</td><td data-et="Productos">${nf(l.n || (l.items || []).length)}</td>
      <td data-et="Vigencia">hasta ${H.esc(LM.fechaCorta(l.vigenciaHasta))}${venc ? ' <span class="chip chip-chico c-amarillo">Vencida</span>' : ''}</td><td data-et="Estado"><span class="chip chip-chico ${e.c}">${H.esc(e.t)}</span></td>
      <td><div class="lp-acc"><a class="btn-sec btn-chico btn-enlace" href="#b2b/listas/${encodeURIComponent(l.id)}" data-lp-abrir="${H.esc(l.id)}">Abrir</a><button type="button" class="btn-sec btn-chico" data-lp-dup="${H.esc(l.id)}">${H.icono('copias', 16)} Duplicar</button></div></td></tr>`; }).join('');
  el.innerHTML = X.cab() + `
    <section class="tarjeta" aria-labelledby="t-lp">
      <div class="titulo-fila"><h2 id="t-lp">Listas de precios ${H.info('Listas de precios', TXT_LISTAS)}</h2><a class="btn btn-chico btn-enlace" href="#b2b/listas/nueva" id="lp-nueva">${H.icono('mas', 16)} Nueva lista</a></div>
      <p class="ok-texto" id="lp-msg" role="status">${H.esc(avisoDe(false))}</p><p class="error" id="lp-err" role="alert">${H.esc(avisoDe(true))}</p>
      ${ls.length ? `<div class="tabla-b2b"><table class="tabla-tiempos tabla-cel-tarjetas lp-tabla" id="lp-tabla"><thead><tr><th scope="col">Cliente</th><th scope="col">Fecha</th><th scope="col">Productos</th><th scope="col">Vigencia</th><th scope="col">Estado</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead><tbody>${filas}</tbody></table></div>`
        : '<div class="vacio" id="lp-vacio">Todavía no hay listas. Toca "Nueva lista" para armar la primera.</div>'}
      ${ls.length >= L.LIMITE_LISTAS ? `<p class="ayuda">Se muestran las últimas ${L.LIMITE_LISTAS}.</p>` : ''}
    </section>
    <div id="lp-avisos"></div>
    ${htmlConfig(cfg)}
    <p class="ayuda" id="lp-lecturas">${lecturasTxt()} ${H.info('Lecturas', TXT_LECTURAS)}</p>`;
  VA.seccion(ctxAviso());   // v0.138.0
}
function camposCondiciones(c, pre) {
  const ct = c.contacto || {};
  return `<div class="lp-cond-campos">
    ${LM.CONDICIONES.filter(([k]) => k !== 'otras').map(([k, t, ph]) => `<div class="campo"><label for="${pre}-${k}">${t}</label><input id="${pre}-${k}" data-lp-cond="${k}" maxlength="${k === 'formasPago' ? 200 : 160}" value="${H.esc(c[k] || '')}" placeholder="${H.esc(ph)}"></div>`).join('')}
    <div class="campo"><label for="${pre}-vigenciaDias">Vigencia de los precios (días)</label><input id="${pre}-vigenciaDias" data-lp-cond="vigenciaDias" inputmode="numeric" maxlength="3" value="${H.esc(c.vigenciaDias || 30)}"><span class="ayuda" id="${pre}-vig-txt"></span></div>
    <div class="campo lp-campo-ancho"><label for="${pre}-otras">Otras condiciones (opcional)</label><textarea id="${pre}-otras" data-lp-cond="otras" rows="2" maxlength="300" placeholder="Déjalo vacío si no hace falta">${H.esc(c.otras || '')}</textarea></div>
    <div class="campo"><label for="${pre}-cnombre">Contacto: nombre</label><input id="${pre}-cnombre" data-lp-ct="nombre" maxlength="80" value="${H.esc(ct.nombre || '')}"></div>
    <div class="campo"><label for="${pre}-ctel">Contacto: teléfono</label><input id="${pre}-ctel" data-lp-ct="telefono" inputmode="tel" maxlength="40" value="${H.esc(ct.telefono || '')}"></div>
    <div class="campo"><label for="${pre}-ccorreo">Contacto: correo</label><input id="${pre}-ccorreo" data-lp-ct="correo" type="email" maxlength="80" value="${H.esc(ct.correo || '')}"></div>
  </div>`;
}
const leerCondiciones = (raiz, pre) => {
  const v = id => (raiz.querySelector('#' + pre + '-' + id) || {}).value || '';
  return { diasDespacho: v('diasDespacho'), costoDespacho: v('costoDespacho'), formasPago: v('formasPago'), vigenciaDias: v('vigenciaDias'), otras: v('otras'), contacto: { nombre: v('cnombre'), telefono: v('ctel'), correo: v('ccorreo') } };
};
function htmlConfig(cfg) {
  return `<section class="tarjeta" aria-labelledby="t-lp-cfg" id="lp-config">
    <details class="lp-pliegue" id="lp-config-d" ${!cfg.existe || st.cfgAbierta ? 'open' : ''}><summary><h2 id="t-lp-cfg">Portada, condiciones y contacto ${H.info('Portada, condiciones y contacto', TXT_CONFIG)}</h2><span class="ayuda">${cfg.portada ? 'Con portada' : 'Sin portada'}${cfg.en ? ' · cambiado el ' + H.esc(LM.fechaCorta(cfg.en.slice(0, 10))) : ''}</span></summary>
    <div class="lp-portada-fila">
      <div class="lp-portada-ver" id="lp-portada-ver">${cfg.portada ? `<img src="${cfg.portada}" alt="Portada de las listas de precios">` : `<div class="lp-portada-vacia">${H.icono('foto', 28)}<span>Sin portada</span></div>`}</div>
      <div class="lp-portada-acc"><p class="ayuda" id="lp-portada-info">${cfg.portada ? `${nf(cfg.portadaAncho)} × ${nf(cfg.portadaAlto)} px · ${nf(Math.round((cfg.portadaBytes || 0) / 1024))} KB` : 'Una foto horizontal se ve mejor (por ejemplo, la vitrina o el pan recién horneado).'}</p>
        <div class="botones" style="justify-content:flex-start"><label class="btn-sec btn-chico lp-subir" for="lp-portada-arch">${H.icono('subir', 16)} ${cfg.portada ? 'Cambiar portada' : 'Subir portada'}</label><input type="file" id="lp-portada-arch" accept="image/*" class="sr">
        ${cfg.portada ? '<button type="button" class="btn-sec btn-chico btn-peligro" id="lp-portada-quitar">Quitar portada</button>' : ''}</div></div></div>
    <h3 class="lp-h3">Condiciones y contacto (se proponen en cada lista nueva)</h3>
    ${camposCondiciones(cfg.condiciones, 'lpc')}
    <p class="error" id="lpc-err" role="alert"></p><p class="ok-texto" id="lpc-msg" role="status"></p>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn btn-chico" id="lpc-guardar">Guardar condiciones</button></div>
    </details></section>`;
}

// ═══════════════ Editor ═══════════════
async function nuevoEditor() {
  const cfg = await L.leerConfig();
  return { id: null, cliente: { id: '', nombre: '', nuevo: false }, fecha: L.hoyTxt(), sel: new Map(), orden: [], ordenManual: false, condiciones: JSON.parse(JSON.stringify(cfg.condiciones)), guardarDefault: false,
    filtro: { area: '', categoria: '', q: '' }, duplicadaDe: null };
}
async function editorDe(l, { duplicar = false } = {}) {
  const base = duplicar ? LM.duplicar(l, L.hoyTxt()) : l;
  const sel = new Map();
  (base.items || []).forEach(it => sel.set(it.catalogoId, { precio: it.precio, tocado: true, snap: it }));
  return { id: duplicar ? null : l.id, cliente: duplicar ? { id: '', nombre: '', nuevo: false } : { id: l.cliente.id || '', nombre: l.cliente.nombre, nuevo: !l.cliente.id }, fecha: duplicar ? L.hoyTxt() : l.fecha,
    sel, orden: (base.items || []).map(it => it.catalogoId), ordenManual: true, condiciones: JSON.parse(JSON.stringify(base.condiciones || {})), guardarDefault: false, filtro: { area: '', categoria: '', q: '' },
    duplicadaDe: duplicar ? l.id : null };
}
// El universo del editor: lo elegible ahora + lo que la lista ya tenía (si algo dejó de estar en B2B, se marca)
let U = [];
const itemDe = id => U.find(x => x.catalogoId === id) || null;
async function prepararUniverso() {
  const u = await universo(), ids = new Set(u.map(x => x.catalogoId));
  const fuera = [...st.ed.sel.entries()].filter(([id]) => !ids.has(id)).map(([, s]) => ({ ...s.snap, areaNombre: areaNombre(s.snap.area), fuera: true, conFoto: true }));
  U = [...u, ...fuera];
}
async function pintarEditor(el) {
  el.innerHTML = X.cab() + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo el Catálogo…</div></section>';
  try { await prepararUniverso(); } catch (e) { el.innerHTML = X.cab() + `<section class="tarjeta"><p class="aviso">${H.esc(error(e))}</p><p><a href="#b2b/listas">Volver a las listas</a></p></section>`; return; }
  if (!enListas()) return;
  const e = st.ed, cls = clientes(), editando = !!e.id;
  el.innerHTML = X.cab() + `
    <section class="tarjeta lp-editor" aria-labelledby="t-lp-ed">
      <div class="titulo-fila"><h2 id="t-lp-ed">${editando ? 'Cambiar la lista' : e.duplicadaDe ? 'Nueva lista (duplicada)' : 'Nueva lista de precios'} ${H.info('Listas de precios', TXT_LISTAS)}</h2><a class="btn-link" href="#b2b/listas">Volver a las listas</a></div>
      ${e.duplicadaDe ? '<p class="aviso" id="lp-dup-aviso">Copiaste los productos, precios, orden y condiciones de otra lista. Elige el cliente: los precios no cambian solos (revísalos).</p>' : ''}
      <fieldset class="lp-paso"><legend><span class="lp-n">1</span> Para quién</legend>
        <div class="fila-campos"><div class="campo"><label for="lp-cliente">Cliente</label><select id="lp-cliente"><option value="">Elige…</option>${cls.map(c => `<option value="${H.esc(c.id)}" ${c.id === e.cliente.id ? 'selected' : ''}>${H.esc(c.nombre)}${(c.precios || []).length ? ` · ${(c.precios || []).length} precios especiales` : ''}</option>`).join('')}<option value="__nuevo" ${e.cliente.nuevo ? 'selected' : ''}>Cliente nuevo (todavía no está en B2B)</option></select></div>
          <div class="campo ${e.cliente.nuevo ? '' : 'oculto'}" id="lp-nuevo-c"><label for="lp-cliente-nombre">Nombre del cliente nuevo</label><input id="lp-cliente-nombre" maxlength="120" value="${H.esc(e.cliente.nuevo ? e.cliente.nombre : '')}" placeholder="Ej.: Café de la esquina" autocomplete="off"></div></div>
      </fieldset>
      <fieldset class="lp-paso"><legend><span class="lp-n">2</span> Productos ${H.info('Fotos de los productos', TXT_FOTOS)}</legend>
        <p class="ayuda lp-ayuda-precio">Solo los productos del Catálogo habilitados en B2B. El precio parte del precio especial del cliente o del base ${H.info('Precio en esta lista', TXT_PRECIO)}</p>
        <div class="lp-filtros">
          <div class="chips" role="group" aria-label="Área" id="lp-areas"></div>
          <div class="lp-filtros-fila"><div class="campo lp-cat"><label class="sr" for="lp-categoria">Categoría</label><select id="lp-categoria"><option value="">Todas las categorías</option>${LM.categoriasDe(U).map(k => `<option ${k === e.filtro.categoria ? 'selected' : ''}>${H.esc(k)}</option>`).join('')}</select></div>
          <div class="fin-buscar">${H.icono('lupa', 18)}<label class="sr" for="lp-q">Buscar producto</label><input type="search" id="lp-q" placeholder="Buscar por nombre o formato…" autocomplete="off" value="${H.esc(e.filtro.q)}"></div>
          <button type="button" class="btn-sec btn-chico" id="lp-todos">Marcar los que se ven</button></div>
        </div>
        <div id="lp-prods" class="lp-prods"></div>
      </fieldset>
      <fieldset class="lp-paso"><legend><span class="lp-n">3</span> Orden en el PDF <span class="chip chip-chico c-gris" id="lp-n-sel"></span></legend>
        <p class="ayuda">Por área y nombre. Puedes subir o bajar un producto.</p>
        <div id="lp-orden" class="lp-orden"></div>
      </fieldset>
      <fieldset class="lp-paso"><legend><span class="lp-n">4</span> Condiciones</legend>
        <div class="fila-campos"><div class="campo"><label for="lp-fecha">Fecha de la lista</label><input type="date" id="lp-fecha" value="${H.esc(e.fecha)}"></div><div></div></div>
        ${camposCondiciones(e.condiciones, 'lpe')}
        <label class="check-linea"><input type="checkbox" id="lp-default" ${e.guardarDefault ? 'checked' : ''}> Guardar estas condiciones como las predeterminadas</label>
      </fieldset>
      <p class="error" id="lp-err" role="alert"></p>
      <div class="botones lp-barra"><button type="button" class="btn-sec" id="lp-previa">Vista previa</button><button type="button" class="btn" id="lp-guardar">${H.icono('check', 16)} ${editando ? 'Guardar cambios' : 'Guardar lista'}</button></div>
      <p class="ayuda" id="lp-lecturas">${lecturasTxt()} ${H.info('Lecturas', TXT_LECTURAS)}</p>
    </section>`;
  pintarAreas(); pintarProductos(); pintarOrden(); vigenciaTxt('lpe');
}
function pintarAreas() {
  const c = $('lp-areas'); if (!c) return;
  const f = st.ed.filtro;
  c.innerHTML = [['', 'Todas'], ...LM.areasDe(U)].map(([a, t]) => `<button type="button" class="chip-filtro" data-lp-area="${H.esc(a)}" aria-pressed="${f.area === a}">${H.esc(t)}</button>`).join('');
}
const miniHtml = (it, tam = 56) => {
  const f = L.fotoEnMemoria(it.catalogoId);
  if (f && f.mini) return `<img class="lp-mini" src="${f.mini}" alt="" width="${tam}" height="${tam}">`;
  return `<span class="lp-mini lp-mini-vacia" aria-hidden="true">${H.esc((it.nombre || 'F').charAt(0).toUpperCase())}</span>`;
};
function precioRef(it) {
  const cl = st.ed.cliente.id ? clienteDe(st.ed.cliente.id) : null, a = LM.precioActual(cl, it);
  return a.especial ? `<span class="lp-ref"><span class="chip chip-chico c-azul">Especial ${pesos(a.precio)}</span> base ${pesos(it.precioBase)}</span>` : `<span class="lp-ref">Base ${pesos(it.precioBase)}</span>`;
}
function filaProd(it) {
  const s = st.ed.sel.get(it.catalogoId), on = !!s;
  return `<div class="lp-fila${on ? ' lp-on' : ''}" data-lp-fila="${H.esc(it.catalogoId)}">
    <label class="lp-check"><input type="checkbox" data-lp-sel="${H.esc(it.catalogoId)}" ${on ? 'checked' : ''}><span class="sr">Incluir ${H.esc(it.nombre)}</span></label>
    ${miniHtml(it)}
    <div class="lp-info"><b>${H.esc(it.nombre)}</b><small>${H.esc([it.formato || 'Sin formato', it.areaNombre].filter(Boolean).join(' · '))}${it.conFoto ? '' : ' · sin foto'}${it.fuera ? ' <span class="chip chip-chico c-amarillo">Ya no está en B2B</span>' : ''}</small>${precioRef(it)}</div>
    <div class="campo lp-precio-c"><label for="lp-p-${H.esc(it.catalogoId)}">Precio neto en esta lista</label><input id="lp-p-${H.esc(it.catalogoId)}" data-lp-precio="${H.esc(it.catalogoId)}" inputmode="numeric" value="${on ? H.esc(s.precio) : ''}" ${on ? '' : 'disabled'} placeholder="${on ? '' : 'Márcalo primero'}"></div>
  </div>`;
}
const visibles = () => LM.filtrar(U, st.ed.filtro);
function pintarProductos() {
  const c = $('lp-prods'); if (!c) return;
  const xs = visibles();
  c.innerHTML = xs.length ? xs.map(filaProd).join('') : `<div class="vacio">${U.length ? 'Nada con este filtro.' : 'No hay productos del Catálogo habilitados en B2B.'}</div>`;
}
function pintarOrden() {
  const c = $('lp-orden'), n = $('lp-n-sel'); if (!c) return;
  const e = st.ed;
  if (n) n.textContent = `${nf(e.orden.length)} ${e.orden.length === 1 ? 'producto' : 'productos'}`;
  c.innerHTML = e.orden.length ? `<ol class="lp-orden-lista">${e.orden.map((id, i) => { const it = itemDe(id) || (e.sel.get(id) || {}).snap || { nombre: id }; const s = e.sel.get(id) || {};
    return `<li data-lp-o="${H.esc(id)}">${miniHtml(it, 40)}<span class="lp-o-n"><b>${H.esc(it.nombre)}</b><small>${H.esc(areaNombre(it.area))} · ${pesos(s.precio)} + IVA</small></span>
      <span class="lp-o-acc"><button type="button" class="btn-sec btn-chico btn-icono" data-lp-subir="${H.esc(id)}" aria-label="Subir ${H.esc(it.nombre)}" ${i ? '' : 'disabled'}>${H.icono('arriba', 16)}</button><button type="button" class="btn-sec btn-chico btn-icono" data-lp-bajar="${H.esc(id)}" aria-label="Bajar ${H.esc(it.nombre)}" ${i < e.orden.length - 1 ? '' : 'disabled'}>${H.icono('abajo', 16)}</button></span></li>`; }).join('')}</ol>
    ${e.ordenManual ? '<button type="button" class="btn-link" id="lp-reordenar">Volver a ordenar por área y nombre</button>' : ''}` : '<div class="vacio" style="border:0">Marca productos arriba.</div>';
}
function vigenciaTxt(pre) {
  const t = $(pre + '-vig-txt'), v = $(pre + '-vigenciaDias'); if (!t || !v) return;
  const dias = entero(v.value) || 30, f = ($('lp-fecha') || {}).value || L.hoyTxt();
  t.textContent = `Precios válidos hasta el ${LM.fechaLarga(LM.vigenciaHasta(f, dias))}`;
}
function ordenarSel() { const e = st.ed; e.orden = LM.ordenar(e.orden.map(id => itemDe(id) || { catalogoId: id, nombre: id })).map(x => x.catalogoId); }
function marcar(id, on) {
  const e = st.ed, it = itemDe(id); if (!it) return;
  if (on && !e.sel.has(id)) {
    const cl = e.cliente.id ? clienteDe(e.cliente.id) : null;
    e.sel.set(id, { precio: LM.precioActual(cl, it).precio, tocado: false, snap: it });
    e.orden.push(id); if (!e.ordenManual) ordenarSel();
    if (it.conFoto && L.fotoEnMemoria(id) === undefined) L.leerFoto(id).then(() => { if (st.ed === e) { const f = document.querySelector(`[data-lp-fila="${CSS.escape(id)}"]`); if (f) f.outerHTML = filaProd(it); pintarOrden(); actLecturas(); } }).catch(() => {});
  } else if (!on && e.sel.has(id)) { e.sel.delete(id); e.orden = e.orden.filter(x => x !== id); }
  const a = document.activeElement, foco = a && a.dataset && a.dataset.lpSel === id;
  const f = document.querySelector(`[data-lp-fila="${CSS.escape(id)}"]`); if (f) f.outerHTML = filaProd(it);
  if (foco) { const c = document.querySelector(`[data-lp-sel="${CSS.escape(id)}"]`); if (c) c.focus(); }
  pintarOrden();
}
const actLecturas = () => { const p = $('lp-lecturas'); if (p && p.firstChild) p.firstChild.textContent = lecturasTxt() + ' '; };
// Cliente elegido: los precios no tocados a mano parten de su precio especial o del base
function cambiarCliente(v) {
  const e = st.ed;
  if (v === '__nuevo') e.cliente = { id: '', nombre: ($('lp-cliente-nombre') || {}).value || '', nuevo: true };
  else { const c = clienteDe(v); e.cliente = { id: v, nombre: c ? c.nombre : '', nuevo: false }; }
  $('lp-nuevo-c').classList.toggle('oculto', !e.cliente.nuevo);
  const cl = e.cliente.id ? clienteDe(e.cliente.id) : null;
  e.sel.forEach((s, id) => { if (!s.tocado) { const it = itemDe(id); if (it) s.precio = LM.precioActual(cl, it).precio; } });
  pintarProductos(); pintarOrden();
}
function leerEditor() {
  const e = st.ed;
  e.condiciones = leerCondiciones(EL, 'lpe');
  e.fecha = ($('lp-fecha') || {}).value || e.fecha;
  e.guardarDefault = !!($('lp-default') || {}).checked;
  if (e.cliente.nuevo) e.cliente.nombre = ($('lp-cliente-nombre') || {}).value || '';
  const items = e.orden.map(id => { const it = itemDe(id) || (e.sel.get(id) || {}).snap; return { ...it, precio: (e.sel.get(id) || {}).precio }; });
  return { cliente: { id: e.cliente.nuevo ? null : e.cliente.id, nombre: e.cliente.nombre, nuevo: e.cliente.nuevo }, fecha: e.fecha, items, condiciones: e.condiciones, duplicadaDe: e.duplicadaDe };
}
async function guardarEditor() {
  const err = $('lp-err'), b = $('lp-guardar'); err.textContent = '';
  let ed; try { ed = leerEditor(); LM.armarLista(ed); } catch (x) { err.textContent = x.message; return; }
  b.disabled = true;
  await conOcupado(async () => {
    try {
      const l = await L.guardarLista(ed, st.ed.id);
      const destino = '#b2b/listas/' + encodeURIComponent(l.id);
      H.registrar(st.ed.id ? 'Listas de precios: cambió una lista' : 'Listas de precios: guardó una lista', `${l.cliente.nombre} · ${l.n} productos${l.duplicadaDe ? ' · duplicada' : ''}`);
      avisar(st.ed.id ? 'Lista guardada.' : `Lista guardada: ${l.cliente.nombre}, ${l.n} ${l.n === 1 ? 'producto' : 'productos'}.`, destino);
      if (st.ed.guardarDefault) { try { await L.guardarConfig({ condiciones: ed.condiciones }); } catch (x) { avisar('La lista quedó guardada, pero no las condiciones predeterminadas: ' + error(x), destino, true); } }
      st.ed = null;
      location.hash = destino;
    } catch (x) { err.textContent = error(x); b.disabled = false; }
  });
}

// ═══════════════ Vista previa (las mismas hojas del PDF, achicadas) ═══════════════
async function hojas(lista) {
  const PDF = await import('./pdf-lista-precios.js?v=0.138.0');
  const [fotos, cfg] = await Promise.all([L.leerFotos(lista.items.map(it => ({ catalogoId: it.catalogoId, conFoto: (itemDe(it.catalogoId) || {}).conFoto !== false }))), L.leerConfig()]);
  return { PDF, fotos, portada: cfg.portada, html: PDF.paginasHtml(lista, { fotos, portada: cfg.portada, areaNombre }) };
}
function escalarPrevia(c) {
  if (!c) return;
  const w = Math.min(c.clientWidth || 0, 560), f = w / 794;
  c.querySelectorAll('.lp-hoja').forEach(h => { h.style.width = w + 'px'; h.style.height = Math.round(1123 * f) + 'px'; const p = h.querySelector('.lp-pag'); if (p) p.style.transform = `scale(${f})`; });
}
async function previaHtml(lista) {
  const r = await hojas(lista);
  return `<style>${r.PDF.CSS}</style><div class="lp-previa" id="lp-previa">${r.html.map((p, i) => `<div class="lp-hoja" aria-label="Hoja ${i + 1} de ${r.html.length}">${p.html}</div>`).join('')}</div>`;
}
async function abrirPrevia() {
  const err = $('lp-err'); err.textContent = '';
  let ed; try { ed = LM.armarLista(leerEditor()); } catch (x) { err.textContent = x.message; return; }
  const d = H.dialogo(`<div class="form-dialogo lp-dlg-previa"><h2>Vista previa</h2><div id="lp-dlg-previa-c"><p class="ayuda" role="status">Armando las hojas…</p></div><div class="botones"><button type="button" class="btn" id="lp-dlg-cerrar">Cerrar</button></div></div>`);
  d.classList.add('dialogo-ancho');
  d.querySelector('#lp-dlg-cerrar').addEventListener('click', () => d.close());
  try { const c = d.querySelector('#lp-dlg-previa-c'); c.innerHTML = await previaHtml(ed); escalarPrevia(c.querySelector('#lp-previa')); actLecturas(); }
  catch (x) { d.querySelector('#lp-dlg-previa-c').innerHTML = `<p class="error">${H.esc(error(x))}</p>`; }
}

// ═══════════════ Una lista guardada ═══════════════
async function pintarDetalle(el, l) {
  const e = LM.estadoLista(l), hoy = L.hoyTxt(), cl = l.cliente.id ? clienteDe(l.cliente.id) : null, aplicada = e.k === 'aplicada';
  el.innerHTML = X.cab() + `
    <section class="tarjeta" aria-labelledby="t-lp-det">
      <div class="titulo-fila"><h2 id="t-lp-det">Lista para ${H.esc(l.cliente.nombre)}</h2><a class="btn-link" href="#b2b/listas">Volver a las listas</a></div>
      <p class="ayuda lp-det-datos">${H.esc(LM.fechaLarga(l.fecha))} · ${nf(l.n)} ${l.n === 1 ? 'producto' : 'productos'} · válida hasta el ${H.esc(LM.fechaLarga(l.vigenciaHasta))}${LM.vencida(l, hoy) ? ' <span class="chip chip-chico c-amarillo">Vencida</span>' : ''} · <span class="chip chip-chico ${e.c}" id="lp-estado">${H.esc(e.t)}</span>${l.cliente.id ? '' : ' <span class="chip chip-chico c-lila">Cliente nuevo</span>'}</p>
      ${l.enviadaEn ? `<p class="ayuda">Enviada el ${H.esc(LM.fechaCorta(l.enviadaEn.slice(0, 10)))}${(l.envios || []).length > 1 ? ` (${l.envios.length} veces)` : ''}.</p>` : ''}
      ${aplicada ? `<p class="ayuda" id="lp-aplicada-txt">Aplicada como precios especiales el ${H.esc(LM.fechaCorta(l.aplicada.en.slice(0, 10)))} por ${H.esc(l.aplicada.por || '')} (${nf(l.aplicada.n)} ${l.aplicada.n === 1 ? 'precio' : 'precios'}).</p>` : ''}
      <p class="ok-texto" id="lp-msg" role="status">${H.esc(avisoDe(false))}</p><p class="error" id="lp-err" role="alert">${H.esc(avisoDe(true))}</p>
      <div class="botones lp-det-acc">
        <button type="button" class="btn" id="lp-wsp">${H.icono('compartir', 16)} Enviar por WhatsApp</button>
        <button type="button" class="btn-sec" id="lp-pdf">${H.icono('bajar', 16)} Descargar PDF</button>
        ${!aplicada && l.cliente.id ? `<button type="button" class="btn-sec" id="lp-aplicar">${H.icono('etiqueta', 16)} Usar como precios especiales</button>${H.info('Usar como precios especiales', TXT_APLICAR)}` : ''}
        <button type="button" class="btn-sec" data-lp-dup="${H.esc(l.id)}">${H.icono('copias', 16)} Duplicar para otro cliente</button>
        ${!aplicada ? `<a class="btn-sec btn-enlace" href="#b2b/listas/${encodeURIComponent(l.id)}/cambiar" id="lp-cambiar">Cambiar</a>` : ''}
      </div>
      ${!l.cliente.id ? '<p class="nota-i">Es para un cliente nuevo: cuando lo crees en Clientes, duplica la lista para él y podrás usarla como sus precios especiales.</p>' : ''}
      ${cl && (cl.whatsapp || cl.grupoWhatsapp) ? '' : '<p class="nota-i">Este cliente no tiene WhatsApp guardado: al enviar eliges el chat.</p>'}
    </section>
    <section class="tarjeta" aria-labelledby="t-lp-previa"><h2 id="t-lp-previa">Vista previa del PDF</h2><div id="lp-previa-c"><p class="ayuda" role="status">Armando las hojas…</p></div></section>
    <p class="ayuda" id="lp-lecturas">${lecturasTxt()} ${H.info('Lecturas', TXT_LECTURAS)}</p>`;
  try { await maestro().then(() => prepararDesdeLista(l)).catch(() => {}); const c = $('lp-previa-c'); if (!c) return; c.innerHTML = await previaHtml(l); escalarPrevia($('lp-previa')); actLecturas(); }
  catch (x) { const c = $('lp-previa-c'); if (c) c.innerHTML = `<p class="error">${H.esc(error(x))}</p>`; }
}
// Para saber qué productos tienen foto (y no leer los que no tienen)
function prepararDesdeLista(l) {
  const u = LM.elegibles(st.maestro || [], (X.datos() || {}).productos || []), m = new Map(u.map(x => [x.catalogoId, x]));
  U = (l.items || []).map(it => ({ ...it, conFoto: m.has(it.catalogoId) ? m.get(it.catalogoId).conFoto : (st.maestro || []).some(p => p.id === it.catalogoId && p.foto && p.foto.en) }));
}
async function pdfDe(l) {
  const r = await hojas(l);
  return r.PDF.generar(l, { fotos: r.fotos, portada: r.portada, areaNombre });
}
async function descargar(l, b) {
  const t = b.innerHTML; b.disabled = true; b.textContent = 'Generando…'; $('lp-err').textContent = '';
  try { const PDF = await import('./pdf-lista-precios.js?v=0.138.0'); const r = await pdfDe(l); PDF.bajar(r.blob, r.nombre); window.__lpUltimoPdf = { bytes: r.bytes, paginas: r.paginas, nombre: r.nombre };
    H.registrar('Listas de precios: descargó el PDF', `${l.cliente.nombre} · ${r.paginas} hojas`); $('lp-msg').textContent = `PDF descargado (${r.paginas} hojas, ${nf(Math.round(r.bytes / 1024))} KB).`; }
  catch (x) { $('lp-err').textContent = 'No se pudo hacer el PDF: ' + error(x); }
  b.disabled = false; b.innerHTML = t;
}
// WhatsApp: en el celular, "Compartir" con el PDF y el mensaje; en el computador, se descarga el PDF y se abre WhatsApp con el mensaje
async function enviar(l, b) {
  const t = `${H.icono('compartir', 16)} Enviar por WhatsApp`, err = $('lp-err'), msg = $('lp-msg'); err.textContent = '';
  const texto = LM.mensajeWsp(l), cl = l.cliente.id ? clienteDe(l.cliente.id) : null;
  let archivo = st.listos.get(l.id);
  b.disabled = true; b.textContent = 'Generando…';
  try {
    if (!archivo) { const r = await pdfDe(l); archivo = new File([r.blob], r.nombre, { type: 'application/pdf' }); window.__lpUltimoPdf = { bytes: r.bytes, paginas: r.paginas, nombre: r.nombre }; }
    let como = 'descarga';
    if (X.esCelular() && navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], text: texto }); st.listos.delete(l.id); como = 'compartir'; }
      catch (x) {
        if (x && x.name === 'AbortError') { st.listos.delete(l.id); b.disabled = false; b.innerHTML = t; return; }
        if (x && x.name === 'NotAllowedError') { st.listos.set(l.id, archivo); b.disabled = false; b.textContent = 'Tocar para enviar'; return; }
        throw x;
      }
    } else {
      const PDF = await import('./pdf-lista-precios.js?v=0.138.0');
      PDF.bajar(archivo, archivo.name);
      const r = await X.abrirWhatsapp(cl || {}, texto);
      msg.textContent = r === 'grupo' ? 'PDF descargado y mensaje copiado: en el grupo, pega el mensaje y adjunta el PDF.' : 'PDF descargado: adjúntalo en el chat de WhatsApp que se abrió.';
    }
    const nl = await L.marcarEnviada(l, como);
    H.registrar('Listas de precios: envió una lista', `${l.cliente.nombre} · ${como === 'compartir' ? 'compartida desde el celular' : 'PDF descargado y WhatsApp abierto'}`);
    const e = LM.estadoLista(nl), ch = $('lp-estado'); if (ch) { ch.className = `chip chip-chico ${e.c}`; ch.textContent = e.t; }
  } catch (x) { err.textContent = 'No se pudo enviar: ' + error(x); }
  b.disabled = false; b.innerHTML = t;
}
function aplicar(l) {
  const cl = clienteDe(l.cliente.id);
  if (!cl) { $('lp-err').textContent = 'El cliente ya no está en Ventas a empresas → Clientes.'; return; }
  const cambios = LM.diffEspeciales(l, cl, (X.datos() || {}).productos || []);
  const iguales = (l.items || []).length - cambios.length;
  const d = H.dialogo(`<form class="form-dialogo" novalidate id="lp-aplicar-f"><h2>Usar como precios especiales</h2>
    <p class="ayuda"><b>${H.esc(cl.nombre)}</b> · ${cambios.length ? `${nf(cambios.length)} ${cambios.length === 1 ? 'precio cambia' : 'precios cambian'}` : 'nada cambia'}${iguales ? ` · ${nf(iguales)} ${iguales === 1 ? 'queda' : 'quedan'} igual (precio base o ya es su precio especial)` : ''}.</p>
    ${cambios.length ? `<div class="tabla-b2b lp-diff"><table class="tabla-tiempos" id="lp-diff"><thead><tr><th scope="col">Producto</th><th scope="col">Ahora</th><th scope="col">Nuevo</th></tr></thead><tbody>
      ${cambios.map(c => `<tr><td>${H.esc(c.producto)}</td><td>${c.actualEspecial ? `Especial ${pesos(c.actual)}` : `Base ${pesos(c.actual)}`}</td><td><b>${pesos(c.nuevo)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
    <p class="ayuda">Los demás precios especiales del cliente quedan igual; nada se borra. Cada cambio queda en su historial de precios.</p>
    <p class="error" id="lp-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="lp-dlg-no">Cancelar</button><button type="submit" class="btn" id="lp-dlg-si" ${cambios.length ? '' : 'disabled'}>${cambios.length ? `Usar ${nf(cambios.length)} ${cambios.length === 1 ? 'precio' : 'precios'}` : 'Nada que cambiar'}</button></div></form>`);
  d.querySelector('#lp-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#lp-dlg-si'); b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await L.aplicarComoEspeciales(l, cambios);
      H.registrar('Listas de precios: usó una lista como precios especiales', `${cl.nombre} · ${r.n} precios`);
      avisar(`Listo: ${nf(r.n)} ${r.n === 1 ? 'precio especial quedó' : 'precios especiales quedaron'} para ${cl.nombre}.`);
      d.close(); pintarDetalle(EL, r.lista);
    } catch (x) { d.querySelector('#lp-dlg-err').textContent = error(x); b.disabled = false; b.textContent = 'Reintentar'; }
  });
}
async function duplicarLista(id) {
  const l = L.listaEnMemoria(id); if (!l) return;
  st.ed = await editorDe(l, { duplicar: true });
  if (location.hash === '#b2b/listas/nueva') pintarEditor(EL); else location.hash = '#b2b/listas/nueva';
}

// ═══════════════ Portada y condiciones predeterminadas ═══════════════
async function subirPortada(archivo) {
  const info = $('lp-portada-info'), err = $('lpc-err'); err.textContent = ''; info.textContent = 'Achicando la imagen…';
  try {
    const IM = await import('./imagenes.js?v=0.138.0');
    const p = await IM.portada(archivo);
    info.textContent = 'Guardando…';
    await L.guardarConfig({ portada: p });
    H.registrar('Listas de precios: cambió la portada', `${p.ancho} × ${p.alto} px · ${Math.round(p.bytes / 1024)} KB`);
    avisar(`Portada guardada (${nf(p.ancho)} × ${nf(p.alto)} px, ${nf(Math.round(p.bytes / 1024))} KB; la original pesaba ${nf(Math.round(p.original.bytes / 1024))} KB).`);
    pintarInicio(EL);
  } catch (x) { err.textContent = error(x); info.textContent = ''; }
}
function quitarPortada() {
  const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Quitar la portada</h2><p class="ayuda">Las listas nuevas salen con la portada sin foto (el logo sobre el color salvia). Puedes subir otra cuando quieras.</p>
    <p class="error" id="lp-dlg-err" role="alert"></p><div class="botones"><button type="button" class="btn-sec" id="lp-dlg-no">Cancelar</button><button type="submit" class="btn btn-peligro-lleno" id="lp-dlg-si">Quitar</button></div></form>`);
  d.querySelector('#lp-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    try { await L.guardarConfig({ portada: null }); H.registrar('Listas de precios: quitó la portada', ''); avisar('Portada quitada.'); d.close(); pintarInicio(EL); }
    catch (x) { d.querySelector('#lp-dlg-err').textContent = error(x); }
  });
}
async function guardarCondiciones() {
  const err = $('lpc-err'), msg = $('lpc-msg'), b = $('lpc-guardar'); err.textContent = ''; msg.textContent = '';
  const c = leerCondiciones(EL, 'lpc');
  try { LM.normalizarCondiciones(c); } catch (x) { err.textContent = x.message; return; }
  b.disabled = true;
  try { await L.guardarConfig({ condiciones: c }); H.registrar('Listas de precios: cambió las condiciones', ''); msg.textContent = 'Condiciones guardadas: se proponen en cada lista nueva.'; }
  catch (x) { err.textContent = error(x); }
  b.disabled = false;
}

// ═══════════════ Eventos ═══════════════
function conectar(el) {
  el.addEventListener('click', ev => {
    if (!enListas()) return;
    const t = ev.target.closest('button'); if (!t || st.ocupado) return;
    if (t.dataset.lpDup) return duplicarLista(t.dataset.lpDup);
    if (t.id === 'lpc-guardar') return guardarCondiciones();
    if (t.id === 'lp-portada-quitar') return quitarPortada();
    const l = L.listaEnMemoria(decodeURIComponent(location.hash.split('/')[2] || ''));
    if (t.id === 'lp-pdf' && l) return descargar(l, t);
    if (t.id === 'lp-wsp' && l) return enviar(l, t);
    if (t.id === 'lp-aplicar' && l) return aplicar(l);
    if (!st.ed) return;
    if (t.dataset.lpArea !== undefined) { st.ed.filtro.area = t.dataset.lpArea; pintarAreas(); return pintarProductos(); }
    if (t.id === 'lp-todos') { visibles().filter(it => !it.fuera).forEach(it => marcar(it.catalogoId, true)); return pintarProductos(); }
    if (t.dataset.lpSubir || t.dataset.lpBajar) {
      const id = t.dataset.lpSubir || t.dataset.lpBajar, o = st.ed.orden, i = o.indexOf(id), j = t.dataset.lpSubir ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]]; st.ed.ordenManual = true; pintarOrden();
      const otro = document.querySelector(`[data-lp-${t.dataset.lpSubir ? 'subir' : 'bajar'}="${CSS.escape(id)}"]`); if (otro && !otro.disabled) otro.focus();
      return;
    }
    if (t.id === 'lp-reordenar') { st.ed.ordenManual = false; ordenarSel(); return pintarOrden(); }
    if (t.id === 'lp-previa') return abrirPrevia();
    if (t.id === 'lp-guardar') return guardarEditor();
  });
  el.addEventListener('change', ev => {
    const x = ev.target;
    if (x.id === 'lp-portada-arch' && x.files && x.files[0]) return subirPortada(x.files[0]);
    if (!st.ed) return;
    if (x.dataset.lpSel) return marcar(x.dataset.lpSel, x.checked);
    if (x.id === 'lp-cliente') return cambiarCliente(x.value);
    if (x.id === 'lp-categoria') { st.ed.filtro.categoria = x.value; return pintarProductos(); }
    if (x.id === 'lp-fecha') return vigenciaTxt('lpe');
  });
  el.addEventListener('input', ev => {
    const x = ev.target;
    if (x.dataset.lpCond === 'vigenciaDias') vigenciaTxt(x.id.split('-')[0]);
    if (!st.ed) return;
    if (x.id === 'lp-q') { st.ed.filtro.q = x.value; return pintarProductos(); }
    if (x.id === 'lp-cliente-nombre') { st.ed.cliente.nombre = x.value; return; }
    if (x.dataset.lpPrecio) {
      const s = st.ed.sel.get(x.dataset.lpPrecio); if (!s) return;
      s.precio = entero(x.value); s.tocado = true;
      const li = document.querySelector(`[data-lp-o="${CSS.escape(x.dataset.lpPrecio)}"] small`); if (li) { const it = itemDe(x.dataset.lpPrecio) || s.snap; li.textContent = `${areaNombre(it.area)} · ${pesos(s.precio)} + IVA`; }
    }
  });
  el.addEventListener('toggle', ev => { if (ev.target.id === 'lp-config-d') st.cfgAbierta = ev.target.open; }, true);   // se recuerda abierto o cerrado
  window.addEventListener('resize', () => { const c = $('lp-previa'); if (c && enListas()) escalarPrevia(c); });
}
