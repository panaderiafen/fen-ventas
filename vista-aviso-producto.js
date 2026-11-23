// ═══════════════════════════════════════════════
//  Sistema Fën — Ventas a empresas → Listas de precios → Avisos de producto nuevo  v0.138.0
//  Boceto "Aviso de producto nuevo" (aprobado por Emmanuel el 23 nov).
//  #b2b/listas: la sección "Avisos de producto nuevo" (los guardados y "Nuevo aviso").
//  #b2b/listas/avisos/nuevo: armar uno (producto del catálogo, tipo, fotos, texto) con la vista previa del PDF al lado.
//  #b2b/listas/avisos/{id}: la vista previa, Descargar PDF, Enviar por WhatsApp y Cambiar. #b2b/listas/avisos/{id}/cambiar.
//  Reglas en aviso-producto-modelo.js, datos en avisos-producto.js, PDF en pdf-aviso-producto.js.
//  ctx = { H, X, universo() (productos del catálogo habilitados en B2B), cfg() (config/listasPrecios), leerFoto(catalogoId) }
// ═══════════════════════════════════════════════
import * as A from './avisos-producto.js?v=0.138.0';
import * as AM from './aviso-producto-modelo.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';

let C = null, EL = null;
const st = { ed: null, msg: '', err: '', listos: new Map() };
const $ = id => document.getElementById(id);
const esc = v => C.H.esc(v);
const error = e => (e && e.message) || C.H.mensajeError(e);
const hoyTxt = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const TXT_AVISOS = 'Un aviso de producto nuevo es un PDF de una hoja, sin cliente, para mandárselo a cualquier cliente: el producto del catálogo con su foto, descripción, características y precio base neto + IVA, y las condiciones y el contacto de las listas de precios.\nDos tipos: "Se vende tal cual", o "Para rellenar o agregar valor", que suma hasta 3 fotos de ejemplo de rellenos, cada una con su texto.';
const TXT_FOTOS = 'La foto principal puede ser la del catálogo (Catálogo → Productos → Foto y ficha) u otra que suba aquí. Las fotos se achican en este equipo antes de guardarlas (hasta 900 px y 90 KB).';

// ── La sección en #b2b/listas ──
export async function seccion(ctx) {
  C = ctx;
  const caja = $('lp-avisos'); if (!caja) return;
  let ls;
  try { ls = await A.leerAvisos(); } catch (e) { caja.innerHTML = `<section class="tarjeta"><h2>Avisos de producto nuevo</h2><p class="error">${esc(error(e))}</p></section>`; return; }
  const filas = ls.map(a => { const e = AM.estadoAviso(a);
    return `<tr><td><b>${esc(a.nombre)}</b></td><td data-et="Tipo">${esc(AM.TIPOS[a.tipo] || '')}</td><td data-et="Fecha">${esc(LM.fechaCorta(a.fecha))}</td><td data-et="Precio">${esc(LM.precioTxt(a.precio))}</td>
      <td data-et="Estado"><span class="chip chip-chico ${e.c}">${esc(e.t)}</span></td><td><a class="btn-sec btn-chico btn-enlace" href="#b2b/listas/avisos/${encodeURIComponent(a.id)}">Abrir</a></td></tr>`; }).join('');
  caja.innerHTML = `<section class="tarjeta" aria-labelledby="t-av">
    <div class="titulo-fila"><h2 id="t-av">Avisos de producto nuevo ${C.H.info('Avisos de producto nuevo', TXT_AVISOS)}</h2><a class="btn btn-chico btn-enlace" href="#b2b/listas/avisos/nuevo" id="av-nuevo">${C.H.icono('mas', 16)} Nuevo aviso</a></div>
    ${ls.length ? `<div class="tabla-b2b"><table class="tabla-tiempos tabla-cel-tarjetas lp-tabla" id="av-tabla"><thead><tr><th scope="col">Producto</th><th scope="col">Tipo</th><th scope="col">Fecha</th><th scope="col">Precio</th><th scope="col">Estado</th><th scope="col"><span class="sr">Abrir</span></th></tr></thead><tbody>${filas}</tbody></table></div>`
      : '<div class="vacio" id="av-vacio">Todavía no hay avisos. Toque "Nuevo aviso" para armar el primero.</div>'}</section>`;
}

// ── Entrada: #b2b/listas/avisos/... ──
export async function pintar(el, ctx, id, sub) {
  C = ctx; EL = el;
  if (!el.dataset.avEventos) { el.dataset.avEventos = '1'; conectar(el); }
  try {
    if (id === 'nuevo') { if (!st.ed || st.ed.id) st.ed = await editorNuevo(); return pintarEditor(); }
    const a = await A.avisoDe(id);
    if (!a) { el.innerHTML = C.X.cab() + '<section class="tarjeta"><p class="aviso">Ese aviso ya no está. <a href="#b2b/listas">Volver a las listas</a></p></section>'; return; }
    if (sub === 'cambiar') { if (!st.ed || st.ed.id !== id) st.ed = await editorDe(a); return pintarEditor(); }
    st.ed = null;
    return pintarDetalle(a);
  } catch (e) { el.innerHTML = C.X.cab() + `<section class="tarjeta"><p class="error" role="alert">${esc(error(e))}</p></section>`; }
}

// ── El editor ──
async function editorNuevo() {
  const u = await C.universo(), cfg = await C.cfg();
  return { id: null, u, tipo: 'talcual', catalogoId: '', descripcion: '', caract: ['', '', ''], fotoCatalogo: true, fotoCat: null, principal: null,
    rellenos: [], fecha: hoyTxt(), condiciones: LM.normalizarCondiciones(cfg.condiciones) };
}
async function editorDe(a) {
  const [u, f, cfg] = await Promise.all([C.universo(), A.leerFotos(a.id), C.cfg()]);
  const ed = { id: a.id, u, tipo: a.tipo, catalogoId: a.catalogoId, descripcion: a.descripcion, caract: [...(a.caracteristicas || []), '', '', ''].slice(0, 3),
    fotoCatalogo: !!a.fotoCatalogo, fotoCat: null, principal: a.fotoCatalogo ? null : f.principal, rellenos: (a.rellenos || []).map((r, i) => ({ texto: r.texto, foto: f.rellenos[i] || null })),
    fecha: hoyTxt(), condiciones: LM.normalizarCondiciones(cfg.condiciones) };
  if (ed.fotoCatalogo) ed.fotoCat = await fotoCatalogoDe(ed.catalogoId);
  return ed;
}
const itemDe = (ed, id) => (ed.u || []).find(x => x.catalogoId === id) || null;
const docEditor = ed => AM.armarAviso({ tipo: ed.tipo, item: itemDe(ed, ed.catalogoId), descripcion: ed.descripcion, caracteristicas: ed.caract, fecha: ed.fecha, condiciones: ed.condiciones,
  fotoCatalogo: ed.fotoCatalogo && !!ed.fotoCat, fotoPropia: !ed.fotoCatalogo && !!ed.principal, rellenos: ed.rellenos.map(r => ({ texto: r.texto, conFoto: !!r.foto })) });
const fotosEditor = ed => ({ principal: ed.fotoCatalogo ? ed.fotoCat : ed.principal, rellenos: ed.rellenos.map(r => r.foto) });

function pintarEditor() {
  const ed = st.ed, it = itemDe(ed, ed.catalogoId), rell = ed.tipo === 'rellenar';
  const opciones = ed.u.map(x => `<option value="${esc(x.catalogoId)}" ${x.catalogoId === ed.catalogoId ? 'selected' : ''}>${esc(x.nombre)} · ${esc(x.catalogoId)} · ${x.precioBase ? esc(LM.precioTxt(x.precioBase)) : 'sin precio base'}</option>`).join('');
  const fp = ed.fotoCatalogo ? ed.fotoCat : ed.principal;
  EL.innerHTML = C.X.cab() + `
  <div class="av-ed">
    <section class="tarjeta av-ed-form" aria-labelledby="t-av-ed">
      <div class="titulo-fila"><h2 id="t-av-ed">${ed.id ? 'Cambiar aviso' : 'Nuevo aviso de producto'}</h2><a class="btn-link" href="${ed.id ? '#b2b/listas/avisos/' + encodeURIComponent(ed.id) : '#b2b/listas'}">Volver</a></div>
      <fieldset class="lp-paso"><legend><span class="lp-n">1</span> El producto</legend>
        <div class="campo"><label for="av-prod">Producto del catálogo (habilitado en B2B)</label><select id="av-prod"><option value="">Elegir…</option>${opciones}</select></div>
        <div class="chips" role="radiogroup" aria-label="Tipo de aviso">${Object.entries(AM.TIPOS).map(([k, t]) => `<label class="chip-radio"><input type="radio" name="av-tipo" value="${k}" ${ed.tipo === k ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
        <p class="ayuda">Precio: el precio base neto de B2B${it && it.precioBase ? ` (<b>${esc(LM.precioTxt(it.precioBase))}</b>)` : ''}. Se cambia en Catálogo → Productos.</p>
      </fieldset>
      <fieldset class="lp-paso"><legend><span class="lp-n">2</span> Fotos ${C.H.info('Fotos', TXT_FOTOS)}</legend>
        <div class="av-fotos">
          <div class="av-fp"><div class="av-mini" style="${fp ? `background-image:url('${fp}')` : ''}">${fp ? '' : 'Sin foto'}</div>
            <label class="check"><input type="checkbox" id="av-usar-cat" ${ed.fotoCatalogo ? 'checked' : ''}> Usar la foto del catálogo</label>
            ${ed.fotoCatalogo && ed.catalogoId && !ed.fotoCat ? '<p class="ayuda">Este producto no tiene foto en el catálogo: suba una.</p>' : ''}
            <label class="btn-sec btn-chico av-subir" ${ed.fotoCatalogo ? 'hidden' : ''}>Subir foto principal<input type="file" accept="image/*" id="av-arch-p" hidden></label></div>
          ${rell ? `<div class="av-rell"><b>Ideas para rellenar (hasta ${AM.MAX_RELLENOS}, con su texto)</b><div class="av-rell-g">
            ${ed.rellenos.map((r, i) => `<div class="av-r"><div class="av-mini" style="${r.foto ? `background-image:url('${r.foto}')` : ''}">${r.foto ? '' : 'Sin foto'}</div>
              <label class="btn-sec btn-chico av-subir">${r.foto ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" data-av-arch="${i}" hidden></label>
              <label class="sr" for="av-rt-${i}">Texto del relleno ${i + 1}</label><input id="av-rt-${i}" data-av-texto="${i}" maxlength="${AM.LARGO.relleno}" value="${esc(r.texto)}" placeholder="Ej.: Jamón y queso">
              <button type="button" class="btn-link btn-chico" data-av-quitar="${i}">Quitar</button></div>`).join('')}
            ${ed.rellenos.length < AM.MAX_RELLENOS ? '<button type="button" class="av-agregar" id="av-mas">+ Agregar foto</button>' : ''}</div></div>` : ''}
        </div>
      </fieldset>
      <fieldset class="lp-paso"><legend><span class="lp-n">3</span> Texto</legend>
        <div class="campo"><label for="av-desc">Descripción (parte con la del catálogo)</label><textarea id="av-desc" rows="3" maxlength="${AM.LARGO.descripcion}">${esc(ed.descripcion)}</textarea></div>
        <div class="av-car-g">${ed.caract.map((c, i) => `<div class="campo"><label for="av-c-${i}">Característica ${i + 1}</label><input id="av-c-${i}" data-av-car="${i}" maxlength="${AM.LARGO.caracteristica}" value="${esc(c)}" placeholder="${i === 0 ? 'Formato: unidad · 80 g' : i === 1 ? 'Se entrega: horneado, del día' : 'Conservación: …'}"></div>`).join('')}</div>
        <p class="ayuda">Las condiciones y el contacto son los de las listas de precios (se cambian en "Portada, condiciones y contacto").</p>
      </fieldset>
      <p class="error" id="av-err" role="alert"></p>
      <div class="botones"><a class="btn-sec btn-enlace" href="${ed.id ? '#b2b/listas/avisos/' + encodeURIComponent(ed.id) : '#b2b/listas'}">Cancelar</a><button type="button" class="btn" id="av-guardar">Guardar aviso</button></div>
    </section>
    <section class="tarjeta av-ed-previa" aria-labelledby="t-av-previa"><h2 id="t-av-previa">Vista previa del PDF</h2><div id="av-previa-c"></div></section>
  </div>`;
  previa();
}
// La vista previa con lo que hay (si falta algo, dice qué)
let tPrevia = 0;
function previa(diferida = false) {
  clearTimeout(tPrevia);
  if (diferida) { tPrevia = setTimeout(() => previa(false), 350); return; }
  const c = $('av-previa-c'); if (!c || !st.ed) return;
  let doc; try { doc = docEditor(st.ed); } catch (e) { c.innerHTML = `<p class="ayuda" id="av-falta">${esc(e.message)}</p>`; return; }
  mostrarHoja(c, doc, fotosEditor(st.ed));
}
async function mostrarHoja(c, doc, fotos) {
  const P = await import('./pdf-aviso-producto.js?v=0.138.0');
  const h = P.paginasHtml(doc, { fotos })[0];
  c.innerHTML = `<style>${P.CSS}</style><div class="lp-previa" id="av-previa"><div class="lp-hoja" aria-label="La hoja del PDF">${h.html}</div></div>`;
  escalar(c);
}
function escalar(c) {
  const w = Math.min(c.clientWidth || 0, 560), f = w / 794;
  c.querySelectorAll('.lp-hoja').forEach(x => { x.style.width = w + 'px'; x.style.height = Math.round(1123 * f) + 'px'; const p = x.querySelector('.lp-pag'); if (p) p.style.transform = `scale(${f})`; });
}
async function subirFoto(archivo, i) {
  const err = $('av-err'); err.textContent = 'Achicando la foto…';
  try {
    const IM = await import('./imagenes.js?v=0.138.0');
    const f = await IM.fotoProducto(archivo);
    if (i === 'p') st.ed.principal = f.foto; else st.ed.rellenos[i].foto = f.foto;
    err.textContent = ''; pintarEditor();
  } catch (e) { err.textContent = error(e); }
}
async function guardar() {
  const err = $('av-err'), b = $('av-guardar'); err.textContent = '';
  let doc; try { doc = docEditor(st.ed); } catch (e) { err.textContent = e.message; return; }
  b.disabled = true; b.textContent = 'Guardando…';
  try {
    const f = fotosEditor(st.ed), id = await A.guardarAviso(doc, { principal: st.ed.fotoCatalogo ? null : f.principal, rellenos: f.rellenos }, st.ed.id);
    C.H.registrar(st.ed.id ? 'Avisos de producto: cambió un aviso' : 'Avisos de producto: creó un aviso', `${doc.nombre} · ${AM.TIPOS[doc.tipo]}`);
    st.msg = 'Aviso guardado. Descárguelo o envíelo por WhatsApp.'; st.ed = null; st.listos.delete(id);
    location.hash = '#b2b/listas/avisos/' + encodeURIComponent(id);
  } catch (e) { err.textContent = error(e); b.disabled = false; b.textContent = 'Guardar aviso'; }
}

// ── Un aviso guardado ──
async function fotosDe(a) {
  const f = await A.leerFotos(a.id);
  return { principal: a.fotoCatalogo ? await fotoCatalogoDe(a.catalogoId) : f.principal, rellenos: f.rellenos };
}
async function fotoCatalogoDe(id) { try { const f = await C.leerFoto(id); return f && f.foto ? f.foto : null; } catch (e) { return null; } }
async function pintarDetalle(a) {
  const e = AM.estadoAviso(a);
  EL.innerHTML = C.X.cab() + `
    <section class="tarjeta" aria-labelledby="t-av-det">
      <div class="titulo-fila"><h2 id="t-av-det">Aviso: ${esc(a.nombre)}</h2><a class="btn-link" href="#b2b/listas">Volver a las listas</a></div>
      <p class="ayuda">${esc(AM.TIPOS[a.tipo] || '')} · ${esc(LM.fechaLarga(a.fecha))} · ${esc(LM.precioTxt(a.precio))} · <span class="chip chip-chico ${e.c}" id="av-estado">${esc(e.t)}</span></p>
      <p class="ok-texto" id="av-msg" role="status">${esc(st.msg)}</p><p class="error" id="av-err" role="alert"></p>
      <div class="botones lp-det-acc">
        <button type="button" class="btn" id="av-wsp">${C.H.icono('compartir', 16)} Enviar por WhatsApp</button>
        <button type="button" class="btn-sec" id="av-pdf">${C.H.icono('bajar', 16)} Descargar PDF</button>
        <a class="btn-sec btn-enlace" href="#b2b/listas/avisos/${encodeURIComponent(a.id)}/cambiar" id="av-cambiar">Cambiar</a>
      </div>
      <p class="nota-i">El precio y las condiciones quedan como estaban al guardarlo. Si cambian, toque "Cambiar" y guárdelo de nuevo.</p>
    </section>
    <section class="tarjeta" aria-labelledby="t-av-previa"><h2 id="t-av-previa">Vista previa del PDF</h2><div id="av-previa-c"><p class="ayuda" role="status">Armando la hoja…</p></div></section>`;
  st.msg = '';
  try { await mostrarHoja($('av-previa-c'), a, await fotosDe(a)); } catch (x) { const c = $('av-previa-c'); if (c) c.innerHTML = `<p class="error">${esc(error(x))}</p>`; }
}
async function pdfDe(a) { const P = await import('./pdf-aviso-producto.js?v=0.138.0'); return P.generar(a, { fotos: await fotosDe(a) }); }
async function descargar(a, b) {
  const t = b.innerHTML; b.disabled = true; b.textContent = 'Generando…'; $('av-err').textContent = '';
  try { const P = await import('./pdf-aviso-producto.js?v=0.138.0'); const r = await pdfDe(a); P.bajar(r.blob, r.nombre); window.__avUltimoPdf = { bytes: r.bytes, paginas: r.paginas, nombre: r.nombre };
    C.H.registrar('Avisos de producto: descargó el PDF', a.nombre); $('av-msg').textContent = `PDF descargado (${Math.round(r.bytes / 1024).toLocaleString('es-CL')} KB).`; }
  catch (x) { $('av-err').textContent = 'No se pudo hacer el PDF: ' + error(x); }
  b.disabled = false; b.innerHTML = t;
}
async function enviar(a, b) {
  const t = `${C.H.icono('compartir', 16)} Enviar por WhatsApp`, err = $('av-err'), msg = $('av-msg'); err.textContent = '';
  const texto = AM.mensajeWsp(a);
  let archivo = st.listos.get(a.id);
  b.disabled = true; b.textContent = 'Generando…';
  try {
    if (!archivo) { const r = await pdfDe(a); archivo = new File([r.blob], r.nombre, { type: 'application/pdf' }); }
    let como = 'descarga';
    if (C.X.esCelular() && navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], text: texto }); st.listos.delete(a.id); como = 'compartir'; }
      catch (x) {
        if (x && x.name === 'AbortError') { st.listos.delete(a.id); b.disabled = false; b.innerHTML = t; return; }
        if (x && x.name === 'NotAllowedError') { st.listos.set(a.id, archivo); b.disabled = false; b.textContent = 'Tocar para enviar'; return; }
        throw x;
      }
    } else {
      const P = await import('./pdf-aviso-producto.js?v=0.138.0');
      P.bajar(archivo, archivo.name);
      await C.X.abrirWhatsapp({}, texto);
      msg.textContent = 'PDF descargado: adjúntelo en el chat de WhatsApp que se abrió (elija el cliente).';
    }
    const na = await A.marcarEnviado(a, como);
    C.H.registrar('Avisos de producto: envió un aviso', `${a.nombre} · ${como === 'compartir' ? 'compartido desde el celular' : 'PDF descargado y WhatsApp abierto'}`);
    const e = AM.estadoAviso(na), ch = $('av-estado'); if (ch) { ch.className = `chip chip-chico ${e.c}`; ch.textContent = e.t; }
  } catch (x) { err.textContent = 'No se pudo enviar: ' + error(x); }
  b.disabled = false; b.innerHTML = t;
}

// ── Eventos ──
const enAvisos = () => /^#b2b\/listas\/avisos\//.test(location.hash);
const idActual = () => decodeURIComponent(location.hash.split('/')[3] || '');
function conectar(el) {
  el.addEventListener('click', async ev => {
    if (!enAvisos()) return;
    const t = ev.target.closest('button'); if (!t) return;
    if (t.id === 'av-pdf' || t.id === 'av-wsp') { const a = await A.avisoDe(idActual()); if (!a) return; return t.id === 'av-pdf' ? descargar(a, t) : enviar(a, t); }
    if (!st.ed) return;
    if (t.id === 'av-guardar') return guardar();
    if (t.id === 'av-mas') { if (st.ed.rellenos.length < AM.MAX_RELLENOS) st.ed.rellenos.push({ texto: '', foto: null }); return pintarEditor(); }
    if (t.dataset.avQuitar !== undefined) { st.ed.rellenos.splice(Number(t.dataset.avQuitar), 1); return pintarEditor(); }
  });
  el.addEventListener('change', async ev => {
    if (!enAvisos() || !st.ed) return;
    const x = ev.target, ed = st.ed;
    if (x.id === 'av-prod') {
      ed.catalogoId = x.value; const it = itemDe(ed, x.value);
      ed.descripcion = it ? it.descripcion || '' : ''; ed.caract = AM.caracteristicasIniciales(it);
      ed.fotoCat = ed.catalogoId ? await fotoCatalogoDe(ed.catalogoId) : null;
      if (!ed.fotoCat) ed.fotoCatalogo = false;
      return pintarEditor();
    }
    if (x.name === 'av-tipo') { ed.tipo = x.value; if (ed.tipo === 'rellenar' && !ed.rellenos.length) ed.rellenos.push({ texto: '', foto: null }); return pintarEditor(); }
    if (x.id === 'av-usar-cat') { ed.fotoCatalogo = x.checked; if (x.checked && !ed.fotoCat && ed.catalogoId) ed.fotoCat = await fotoCatalogoDe(ed.catalogoId); return pintarEditor(); }
    if (x.id === 'av-arch-p' && x.files && x.files[0]) return subirFoto(x.files[0], 'p');
    if (x.dataset.avArch !== undefined && x.files && x.files[0]) return subirFoto(x.files[0], Number(x.dataset.avArch));
  });
  el.addEventListener('input', ev => {
    if (!enAvisos() || !st.ed) return;
    const x = ev.target, ed = st.ed;
    if (x.id === 'av-desc') ed.descripcion = x.value;
    else if (x.dataset.avCar !== undefined) ed.caract[Number(x.dataset.avCar)] = x.value;
    else if (x.dataset.avTexto !== undefined) ed.rellenos[Number(x.dataset.avTexto)].texto = x.value;
    else return;
    previa(true);
  });
  window.addEventListener('resize', () => { const c = $('av-previa-c'); if (c && enAvisos()) escalar(c); });
}
