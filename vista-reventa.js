// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo → pestaña Reventa (#catalogo/reventa)  v0.73.0
//  Lo que se compra hecho y se vende tal cual (chocolates, té, infusiones…). Vive en Sistema Fën y lo ingresa el dueño, con su
//  ID para la caja y B2B. Crear, cambiar, archivar y reactivar con diálogos en la página; "Traer reventa de la planilla" una vez.
//  Datos en reventa.js; reglas en reventa-modelo.js. H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, dialogo }
// ═══════════════════════════════════════════════
import * as R from './reventa.js?v=0.138.0';
import * as RV from './reventa-modelo.js?v=0.138.0';

const st = { lista: null, meta: null, usos: {}, filtro: 'activo', q: '', msg: '', err: '', ocupado: false, sinGastos: false };
export const estado = st;
const $ = id => document.getElementById(id);
const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaCorto = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[3])} ${MESC[Number(m[2]) - 1]} ${m[1]}` : ''; };
const pesos = v => (v === null || v === undefined || !isFinite(v) ? '—' : '$' + (Math.round(Number(v) * 100) / 100).toLocaleString('es-CL'));
let H = null, ctxCat = null;

const TXT_REV = 'Reventa es lo que Fën compra hecho para venderlo tal cual (chocolates, té, infusiones…). No tiene receta ni pasa por Cocina: la ingresas tú, porque tú decides qué se compra.\nCada una tiene su ID (REV…) para la caja y B2B, su costo neto por unidad (sin IVA) y, si quieres, su proveedor.\nEn Finanzas → Asociar productos eliges "Es reventa" y la reventa de esta lista: el costo se copia solo (lo puedes cambiar en cada producto).\nArchivar la esconde de la lista para asociar; su historia queda y se deshace con "Reactivar". Nada se borra.';
const TXT_TRAER = 'Una sola vez: lee la lista de recetas publicada desde la planilla (la misma que lee la caja) y trae las filas con código de área REV, con su mismo ID (así la caja y B2B siguen calzando).\nEl costo se propone desde Finanzas → Asociar productos (los productos ya asociados como reventa). Revisa y corrige antes de guardar; lo que desmarques no se trae.\nDespués, la reventa nueva la creas aquí con "Agregar reventa".';
const TXT_COSTO = 'Lo que pagas por una unidad, sin IVA. Si lo copias de una boleta o factura con IVA, marca "Lo escribo con IVA" y se guarda el neto.\nEs el costo que se propone en Finanzas → Asociar productos para los productos de esta reventa (en cada producto se puede cambiar).';

export async function pintar(el, h, ctx) {
  H = h; ctxCat = ctx;
  el.innerHTML = ctx.cab() + '<section class="tarjeta"><div class="vacio" style="border:0">Leyendo la reventa…</div></section>';
  if (!(await R.conectada())) { st.sinGastos = true; el.innerHTML = ctx.cab() + `<section class="tarjeta"><p class="aviso">La reventa se guarda en la base de Gastos y Finanzas (fen-gastos), que no está conectada en este equipo. Conéctala en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>.</p></section>`; return; }
  try { const r = await R.leer(); st.lista = r.lista; st.meta = r.meta; st.err = ''; }
  catch (e) { el.innerHTML = ctx.cab() + `<section class="tarjeta"><p class="error">${H.esc((e && e.message) || H.mensajeError(e))}</p></section>`; return; }
  // "Se vende como": los vínculos de Finanzas y los productos de la caja y B2B (de "Qué está vivo" si ya se abrió; si no, de la memoria de Finanzas)
  try {
    const D = ctx.datos();
    let vinc, cat;
    if (D) { vinc = D.datos.vinculos; cat = { caja: Object.fromEntries((D.datos.caja || []).map(p => [p.id, p])), b2b: Object.fromEntries((D.datos.b2b || []).map(p => [p.id, p])) }; }
    else { const F = await import('./finanzas.js?v=0.138.0'); [vinc, cat] = await Promise.all([F.leerVinculos().catch(() => ({})), F.catalogosVenta().catch(() => ({ caja: {}, b2b: {} }))]); }
    st.vinc = vinc || {}; st.cat = cat || null;
  } catch (e) { st.vinc = {}; st.cat = null; }
  dibujar(el);
}

function dibujar(el) {
  st.usos = RV.usos(st.lista, st.vinc || {}, st.cat);
  const r = RV.resumen(st.lista), xs = RV.filtrar(st.lista, st.filtro, st.q);
  const traer = !st.meta;
  el.innerHTML = ctxCat.cab() + `
    <section class="tarjeta" aria-labelledby="t-cat-rev">
      <div class="titulo-fila"><h2 id="t-cat-rev">Reventa ${H.info('Reventa', TXT_REV)}</h2><span class="ayuda" id="rev-resumen">Activos ${r.activos.toLocaleString('es-CL')} · Archivados ${r.archivados.toLocaleString('es-CL')}</span></div>
      <p class="ayuda">Lo que se compra hecho y se vende tal cual, con su ID para la caja y B2B y su costo neto por unidad.</p>
      <div class="botones rev-botones" style="justify-content:flex-start">
        <button type="button" class="btn" id="rev-nuevo">${H.icono('mas', 16)} Agregar reventa</button>
        ${traer ? `<button type="button" class="btn-sec" id="rev-traer">${H.icono('bajar', 16)} Traer reventa de la planilla</button>${H.info('Traer reventa de la planilla', TXT_TRAER)}` : `<span class="ayuda" id="rev-traida">Traída de la planilla el ${H.esc(diaCorto(st.meta.importadoEn))} (${Number(st.meta.n || 0).toLocaleString('es-CL')})</span>`}
      </div>
      <div class="cat-filtros">
        <div class="chips" role="group" aria-label="Mostrar">${[['activo', 'Activos'], ['archivado', 'Archivados'], ['todo', 'Todo']].map(([k, t]) => `<button type="button" class="chip-filtro" data-rev-filtro="${k}" aria-pressed="${st.filtro === k}">${t}</button>`).join('')}</div>
        <div class="fin-buscar">${H.icono('lupa', 18)}<label class="sr" for="rev-q">Buscar reventa</label><input type="search" id="rev-q" placeholder="Buscar por nombre, ID o proveedor…" autocomplete="off" spellcheck="false" value="${H.esc(st.q)}"></div>
      </div>
      <p class="ok-texto" id="rev-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="rev-err" role="alert">${H.esc(st.err)}</p>
      <div id="rev-lista" class="rev-lista">${xs.length ? xs.map(fila).join('') : `<div class="vacio">${st.lista.length ? 'Nada con este filtro.' : 'Todavía no hay reventa. Tráela de la planilla (una vez) o agrégala.'}</div>`}</div>
      <p class="ayuda" id="rev-lecturas">Lecturas al abrir: ${st.lista.length ? 'la lista una vez (después, la memoria)' : '1'} · Escrituras: 1 por cambio</p>
    </section>`;
  conectar(el);
}
function fila(x) {
  const u = st.usos[x.id] || [], arch = x.estado === 'archivado';
  const prov = x.proveedor && (x.proveedor.razon || x.proveedor.rut) ? `${H.esc(x.proveedor.razon || '')}${x.proveedor.rut ? ` <span class="ayuda">${H.esc(x.proveedor.rut)}</span>` : ''}` : '<span class="ayuda">—</span>';
  return `<div class="cat-fila${arch ? ' cat-archivada' : ''}" data-rev-fila="${H.esc(x.id)}">
    <div class="cat-info"><div class="cat-nombre"><b>${H.esc(x.nombre)}</b></div><small class="cat-id">${H.esc(x.id)}</small>
      <div class="cat-chips"><span class="chip chip-chico ${arch ? 'c-gris' : 'c-verde'}">${RV.ESTADOS[x.estado] || 'Activo'}</span>${x.origen === 'planilla' ? '<span class="chip chip-chico c-azul">de la planilla</span>' : ''}</div></div>
    <dl class="cat-datos">
      <div><dt>Costo neto</dt><dd><b>${pesos(x.costoNeto)}</b> / ${H.esc(x.unidad || 'un')}</dd></div>
      <div><dt>Proveedor</dt><dd>${prov}</dd></div>
      <div><dt>Se vende como</dt><dd>${u.length ? u.map(p => `${H.esc(p.nombre)} <span class="ayuda">(${p.canal === 'b2b' ? 'B2B' : 'caja'})</span>`).join(', ') : '<span class="ayuda">—</span>'}</dd></div>
    </dl>
    <div class="cat-acc">${arch ? `<button type="button" class="btn-sec btn-chico" data-rev-react="${H.esc(x.id)}" aria-label="Reactivar ${H.esc(x.nombre)}">Reactivar</button>`
      : `<button type="button" class="btn-sec btn-chico" data-rev-editar="${H.esc(x.id)}" aria-label="Cambiar ${H.esc(x.nombre)}">Cambiar</button><button type="button" class="btn-sec btn-chico btn-peligro" data-rev-arch="${H.esc(x.id)}" aria-label="Archivar ${H.esc(x.nombre)}">Archivar</button>`}</div></div>`;
}
const error = e => (e && e.code === 'cuota-agotada') ? e.message : (e && e.message) || H.mensajeError(e);
function conectar(el) {
  el.querySelectorAll('[data-rev-filtro]').forEach(b => b.addEventListener('click', () => { st.filtro = b.dataset.revFiltro; dibujar(el); }));
  const q = $('rev-q'); if (q) q.addEventListener('input', () => { st.q = q.value; const c = $('rev-lista'); const xs = RV.filtrar(st.lista, st.filtro, st.q); c.innerHTML = xs.length ? xs.map(fila).join('') : '<div class="vacio">Nada con esta búsqueda.</div>'; conectarFilas(el); });
  $('rev-nuevo').addEventListener('click', () => dialogo(el, null));
  const t = $('rev-traer'); if (t) t.addEventListener('click', () => dialogoTraer(el));
  conectarFilas(el);
}
function conectarFilas(el) {
  el.querySelectorAll('[data-rev-editar]').forEach(b => b.addEventListener('click', () => dialogo(el, st.lista.find(x => x.id === b.dataset.revEditar))));
  el.querySelectorAll('[data-rev-arch]').forEach(b => b.addEventListener('click', () => archivar(el, st.lista.find(x => x.id === b.dataset.revArch), true)));
  el.querySelectorAll('[data-rev-react]').forEach(b => b.addEventListener('click', () => archivar(el, st.lista.find(x => x.id === b.dataset.revReact), false)));
}
function poner(doc) { const i = st.lista.findIndex(x => x.id === doc.id); if (i >= 0) st.lista[i] = doc; else st.lista.push(doc); }

function dialogo(el, x) {
  const p = (x && x.proveedor) || {};
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" id="rev-form" novalidate>
    <h2>${x ? `Cambiar ${H.esc(x.nombre)}` : 'Agregar reventa'}</h2>
    ${x ? `<p class="ayuda">ID ${H.esc(x.id)} (no cambia)</p>` : '<p class="ayuda">El ID (REV…) se pone solo: el número que sigue.</p>'}
    <div class="campo"><label for="rev-nombre">Nombre</label><input id="rev-nombre" maxlength="120" value="${H.esc((x && x.nombre) || '')}" autocomplete="off"></div>
    <div class="fila-campos rev-campos">
      <div class="campo"><label for="rev-costo">Costo neto por unidad ($) ${H.info('Costo neto', TXT_COSTO)}</label><input id="rev-costo" type="text" inputmode="decimal" value="${x && x.costoNeto !== null && x.costoNeto !== undefined ? H.esc(String(x.costoNeto).replace('.', ',')) : ''}"></div>
      <div class="campo"><label for="rev-unidad">Unidad</label><input id="rev-unidad" maxlength="20" list="rev-unidades" value="${H.esc((x && x.unidad) || 'un')}"><datalist id="rev-unidades">${RV.UNIDADES.map(u => `<option value="${u}">`).join('')}</datalist></div>
    </div>
    <label class="check fin-check"><input type="checkbox" id="rev-iva"> Lo escribo con IVA (19 %)</label>
    <div class="fila-campos rev-campos">
      <div class="campo"><label for="rev-razon">Proveedor (opcional)</label><input id="rev-razon" maxlength="120" value="${H.esc(p.razon || '')}" placeholder="Razón social"></div>
      <div class="campo"><label for="rev-rut">RUT del proveedor (opcional)</label><input id="rev-rut" maxlength="14" value="${H.esc(p.rut || '')}" placeholder="76.123.456-7"></div>
    </div>
    <p class="error" id="rev-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="rev-dlg-no">Cancelar</button><button type="submit" class="btn" id="rev-dlg-si">${x ? 'Guardar cambios' : 'Agregar'}</button></div>
    ${x && (x.historial || []).length ? `<div class="fin-hist"><h3>Historial</h3><ul class="fin-hist-lista">${[...x.historial].reverse().slice(0, 10).map(hh => `<li><div><b>${H.esc(String(hh.en || '').slice(0, 10))}</b> · ${H.esc(hh.accion || '')}</div><span class="ayuda">${H.esc(hh.por || '')}${hh.cambios ? ' · ' + H.esc(Object.entries(hh.cambios).map(([k, c]) => `${k}: ${typeof c.antes === 'object' ? JSON.stringify(c.antes) : c.antes} → ${typeof c.despues === 'object' ? JSON.stringify(c.despues) : c.despues}`).join(' · ')) : ''}</span></li>`).join('')}</ul></div>` : ''}
  </form>`);
  d.querySelector('#rev-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('#rev-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#rev-dlg-err'), b = d.querySelector('#rev-dlg-si'); err.textContent = '';
    const datos = { nombre: d.querySelector('#rev-nombre').value, costoNeto: d.querySelector('#rev-costo').value, conIva: d.querySelector('#rev-iva').checked, unidad: d.querySelector('#rev-unidad').value, razon: d.querySelector('#rev-razon').value, rut: d.querySelector('#rev-rut').value };
    try { RV.validar(datos, st.lista, x ? x.id : ''); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const doc = await R.guardar(x ? x.id : null, datos, st.lista);
      poner(doc);
      H.registrar(x ? 'Catálogo: cambió una reventa' : 'Catálogo: agregó una reventa', `${doc.nombre} · ${doc.id} · ${pesos(doc.costoNeto)} neto / ${doc.unidad}`);
      st.msg = x ? `${doc.nombre}: guardado.` : `${doc.nombre} agregada (${doc.id}).`; st.err = '';
      d.close(); dibujar(el);
    } catch (e) { err.textContent = error(e); b.disabled = false; b.textContent = x ? 'Guardar cambios' : 'Agregar'; }
  });
}
function archivar(el, x, arch) {
  if (!x) return;
  const u = st.usos[x.id] || [];
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo" method="dialog" novalidate>
    <h2>${arch ? 'Archivar' : 'Reactivar'} ${H.esc(x.nombre)}</h2>
    <p class="ayuda">${arch ? 'Deja de ofrecerse en Finanzas → Asociar productos. Su historia queda y se deshace con "Reactivar".' : 'Vuelve a ofrecerse en Finanzas → Asociar productos.'}</p>
    ${arch && u.length ? `<p class="aviso">Hay productos que la usan: ${u.map(p => H.esc(p.nombre)).join(', ')}. Siguen asociados (con su costo) y siguen a la venta; archívalos en "Qué está vivo" si ya no se venden.</p>` : ''}
    <p class="error" id="rev-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="rev-dlg-no">Cancelar</button><button type="submit" class="btn${arch ? ' btn-peligro-lleno' : ''}" id="rev-dlg-si">${arch ? 'Archivar' : 'Reactivar'}</button></div></form>`);
  d.querySelector('#rev-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#rev-dlg-si'); b.disabled = true;
    try {
      const doc = await R.archivar(x.id, arch); poner(doc);
      H.registrar(arch ? 'Catálogo: archivó una reventa' : 'Catálogo: reactivó una reventa', `${x.nombre} · ${x.id}`);
      st.msg = `${x.nombre}: ${arch ? 'archivada' : 'reactivada'}.`; st.err = ''; d.close(); dibujar(el);
    } catch (e) { d.querySelector('#rev-dlg-err').textContent = error(e); b.disabled = false; }
  });
}
async function dialogoTraer(el) {
  const b = $('rev-traer'); b.disabled = true; b.lastChild.textContent = ' Leyendo la planilla…';
  let cand;
  try { cand = await R.prepararImportacion(st.lista); } catch (e) { st.err = error(e); b.disabled = false; dibujar(el); return; }
  b.disabled = false; b.lastChild.textContent = ' Traer reventa de la planilla';
  const nuevos = cand.filter(c => !c.ya);
  const d = H.dialogo(`<form class="form-dialogo cat-dialogo rev-traer-dlg" id="rev-traer-form" novalidate>
    <h2>Traer reventa de la planilla</h2>
    <p class="ayuda">${cand.length ? `${nuevos.length.toLocaleString('es-CL')} de ${cand.length.toLocaleString('es-CL')} con código de área REV en la lista publicada${cand.length - nuevos.length ? ` (${(cand.length - nuevos.length).toLocaleString('es-CL')} ya están aquí)` : ''}. Revisa el costo neto por unidad y desmarca lo que no se vende.` : 'La lista publicada no tiene filas con código de área REV.'} ${H.info('Traer reventa de la planilla', TXT_TRAER)}</p>
    <div class="rev-traer-lista">${nuevos.map((c, i) => `<div class="rev-traer-fila" data-rev-cand="${H.esc(c.id)}">
      <label class="check cat-check"><input type="checkbox" value="${H.esc(c.id)}" checked><span><b>${H.esc(c.nombre)}</b> <span class="ayuda">${H.esc(c.id)}</span></span></label>
      <div class="campo"><label for="rev-c-${i}">Costo neto ($)</label><input id="rev-c-${i}" data-rev-costo="${H.esc(c.id)}" type="text" inputmode="decimal" value="${c.costoNeto !== null ? H.esc(String(Math.round(c.costoNeto * 100) / 100).replace('.', ',')) : ''}" placeholder="sin costo"></div>
      <small class="ayuda">${c.costoDe ? 'Costo de Finanzas · ' + H.esc(c.costoDe) : 'Sin costo en Finanzas: escríbelo o déjalo en 0 y cámbialo después.'}</small></div>`).join('')}</div>
    <p class="error" id="rev-dlg-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="rev-dlg-no">Cancelar</button><button type="submit" class="btn" id="rev-dlg-si" ${nuevos.length ? '' : 'disabled'}>Guardar ${nuevos.length.toLocaleString('es-CL')}</button></div></form>`);
  const contar = () => { const n = d.querySelectorAll('.rev-traer-lista input[type=checkbox]:checked').length; d.querySelector('#rev-dlg-si').textContent = `Guardar ${n.toLocaleString('es-CL')}`; d.querySelector('#rev-dlg-si').disabled = !n; };
  d.addEventListener('change', contar);
  d.querySelector('#rev-dlg-no').addEventListener('click', () => d.close());
  d.querySelector('#rev-traer-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#rev-dlg-err'), bt = d.querySelector('#rev-dlg-si'); err.textContent = '';
    const sel = [...d.querySelectorAll('.rev-traer-lista input[type=checkbox]:checked')].map(i => i.value);
    const items = sel.map(id => { const c = nuevos.find(x => x.id === id), v = d.querySelector(`[data-rev-costo="${id}"]`).value.trim(); return { id, nombre: c.nombre, costoNeto: v === '' ? 0 : v, unidad: 'un' }; });
    try { items.forEach(it => RV.validar(it, [], it.id)); } catch (e) { err.textContent = e.message; return; }
    bt.disabled = true; bt.textContent = 'Guardando…';
    try {
      const hechos = await R.importar(items, st.lista);
      hechos.forEach(poner); st.meta = { importadoEn: new Date().toISOString(), n: hechos.length };
      H.registrar('Catálogo: trajo la reventa de la planilla', `${hechos.length} · ${hechos.map(x => x.id).join(', ').slice(0, 1200)}`);
      st.msg = `Traídas ${hechos.length.toLocaleString('es-CL')} reventas de la planilla.`; st.err = ''; d.close(); dibujar(el);
    } catch (e) { err.textContent = error(e); bt.disabled = false; contar(); }
  });
}
