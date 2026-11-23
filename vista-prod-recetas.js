// ═══════════════════════════════════════════════
//  Sistema Fën — Producción → Recetas (solo para mirar)  v0.77.1
//  Las recetas aprobadas de la base de Cocina por área, con su rendimiento, versión, quién y cuándo se aprobó y su costo por
//  unidad (el último cálculo de Finanzas → Costos → Productos) con la variación contra el costo anterior. Al abrir una: ingredientes
//  (g y %), insumos, pasos, notas y las versiones anteriores (versiones/{id}_v{n}, se leen solo al pedirlas) comparadas con la vigente.
//  Rutas: #produccion/recetas · #produccion/recetas/{recetaId}. Se crean y se cambian en Cocina (las jefas) y se aprueban en Por revisar.
//  Lecturas: las recetas y los costos salen de la memoria compartida (Hoy, Producción, Finanzas); las versiones, al pedirlas.
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, hace, dialogo }
// ═══════════════════════════════════════════════
import * as P from './produccion.js?v=0.138.0';
import * as RV from './recetas-ver-modelo.js?v=0.138.0';

const S = { area: 'todas', tipo: 'todas', q: '', archivadas: false, recetas: null, costos: null, costosErr: '', err: '', vers: {}, comparar: {} };
const $ = id => document.getElementById(id);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : ''; };
const ic = (d, t = 16) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const IC = { sube: '<path d="M12 19V5M6 11l6-6 6 6"/>', baja: '<path d="M12 5v14M6 13l6 6 6-6"/>', lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', atras: '<path d="M19 12H5M11 6l-6 6 6 6"/>', fuera: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' };

export const TXT_COSTO = 'Si sube o baja el costo de una receta, se ve en tres lugares:\n· Hoy: el aviso "Subió el costo de N productos" (de Finanzas), cuando sube más del % de aviso contra el mes anterior.\n· Aquí, en Producción → Recetas: cada receta con su costo por unidad y la flecha con el % contra su costo anterior (y desde cuándo valía ese costo).\n· Finanzas → Costos → Productos: el análisis completo (qué materia prima lo movió, el historial y el detalle por ingrediente). "Ver en Finanzas" lleva directo.\nEl costo es neto (sin IVA) y es el del último cálculo de Finanzas: se calcula al abrir Finanzas → Costos y al cambiar un precio.';
const TXT_RECETAS = 'Las recetas aprobadas de la base de Cocina (la maestra), solo para mirar. Las jefas las crean y las cambian en Cocina; cada cambio llega a Por revisar y la receta de aquí sigue igual hasta que lo apruebas.\nCada aprobación guarda la versión anterior: ábrela en "Versiones anteriores" para compararla con la vigente.\nArchivar o reactivar una receta se hace en el Catálogo (Qué está vivo).';

export async function pintar(el, H, { sub = '' } = {}) {
  el.innerHTML = '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Abriendo las recetas…</div></section>';
  try {
    const [recetas, costos] = await Promise.all([P.recetasCatalogo(), import('./finanzas.js?v=0.138.0').then(F => F.costosRecetas()).catch(e => { S.costosErr = (e && e.message) || ''; return null; })]);
    S.recetas = recetas; S.costos = costos; S.err = '';
  } catch (e) { S.err = (e && e.message) || H.mensajeError(e); }
  if (!/^#produccion\/recetas/.test(location.hash)) return;
  if (S.err && !S.recetas) { el.innerHTML = `<section class="tarjeta"><p class="error" role="alert">${H.esc(S.err)}</p></section>`; return; }
  const id = sub ? decodeURIComponent(sub) : '';
  if (id) return pintarDetalle(el, id, H);
  pintarLista(el, H);
}

// ── Lista ──
function costoCelda(r, H) {
  if (!S.costos) return '<span class="ayuda">sin costo</span>';
  const c = RV.costoDe(r.id, S.costos.docs, S.costos.hist);
  if (!c) return '<span class="ayuda">sin costo calculado</span>';
  const v = c.variacion;
  const flecha = v && v.dir !== 'igual' ? `<span class="fin-var ${v.dir === 'sube' ? 'fin-sube' : 'fin-baja'}">${ic(IC[v.dir], 13)}${H.esc(RV.signoPct(v.pct))}<span class="sr">${v.dir === 'sube' ? 'subió' : 'bajó'} contra el costo anterior</span></span>` : v ? '<span class="ayuda">igual</span>' : '';
  const ant = c.anterior ? `<span class="ayuda rv-ant">antes ${H.esc(c.lectura.por === 'kg' ? RV.pesos(c.anterior.valor * 1000) : RV.pesosD(c.anterior.valor))}${c.anterior.desde ? ` (desde el ${H.esc(fecha(c.anterior.desde))})` : ''}</span>` : '';
  return `<b>${H.esc(RV.lecturaTxt(c))}</b>${c.incompleto ? ' <span class="chip c-amarillo chip-chico">incompleto</span>' : ''} ${flecha}${ant}`;
}
function fila(r, H) {
  const ap = RV.aprobacion(r);
  return `<a class="rv-fila" href="#produccion/recetas/${encodeURIComponent(r.id)}" data-rv="${H.esc(r.id)}">
    <span class="rv-nombre"><b>${H.esc(r.nombre || r.id)}</b><span class="ayuda">${H.esc(RV.AREAS[r.area] || r.area || '')} · ${RV.esSub(r) ? 'masa o sub receta' : 'producto'}${RV.esArchivada(r) ? ' · <span class="chip c-gris chip-chico">archivada</span>' : ''}</span></span>
    <span class="rv-dato"><span class="fin-et">Rinde</span>${H.esc(RV.rindeTxt(r))}</span>
    <span class="rv-dato"><span class="fin-et">Versión</span>v${H.esc(String(r.version || 1))}</span>
    <span class="rv-dato"><span class="fin-et">Aprobada</span>${ap ? H.esc(ap) : '<span class="ayuda">desde la planilla</span>'}</span>
    <span class="rv-dato rv-costo"><span class="fin-et">Costo neto</span>${costoCelda(r, H)}</span></a>`;
}
function pintarFilas(H) {
  const c = $('rv-filas'); if (!c) return;
  const xs = RV.filtrar(S.recetas, S);
  c.innerHTML = xs.length ? xs.map(r => fila(r, H)).join('') : '<div class="vacio">Nada con ese filtro.</div>';
  const n = $('rv-n'); if (n) n.textContent = `${xs.length} ${xs.length === 1 ? 'receta' : 'recetas'}`;
}
function pintarLista(el, H) {
  const k = RV.conteos(S.recetas);
  const chips = (nombre, lista, sel) => `<div class="chips" role="group" aria-label="${nombre}">${lista.map(([v, t]) => `<button type="button" class="chip-filtro" data-rv-${nombre === 'Área' ? 'area' : 'tipo'}="${v}" aria-pressed="${sel === v}">${H.esc(t)}</button>`).join('')}</div>`;
  el.innerHTML = `<section class="tarjeta" aria-labelledby="t-rv">
    <div class="titulo-fila fin-titulo"><h2 id="t-rv">Recetas aprobadas ${H.info('Recetas', TXT_RECETAS)}</h2>
      <span class="ayuda rv-donde">Si cambia el costo, ¿dónde se ve? ${H.info('Si cambia el costo, ¿dónde se ve?', TXT_COSTO)}</span></div>
    <p class="ayuda" id="rv-resumen">En la base de Cocina: ${k.productos} ${k.productos === 1 ? 'producto' : 'productos'} y ${k.subs} ${k.subs === 1 ? 'masa o sub receta' : 'masas y sub recetas'} (${Object.entries(k.porArea).map(([a, x]) => `${RV.AREAS[a]} ${x}`).join(' · ')})${k.archivadas ? ` · ${k.archivadas} ${k.archivadas === 1 ? 'archivada' : 'archivadas'}` : ''}.</p>
    ${!S.costos ? `<p class="aviso" id="rv-sin-costos">Sin costos: la base de Gastos y Finanzas no está conectada${S.costosErr ? ` (${H.esc(S.costosErr)})` : ''}. Se conecta en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>.</p>` : ''}
    <div class="filtros fin-filtros rv-filtros">
      <div class="fin-buscar">${ic(IC.lupa, 18)}<label class="sr" for="rv-q">Buscar receta</label><input type="search" id="rv-q" placeholder="Buscar por nombre…" autocomplete="off" spellcheck="false" value="${H.esc(S.q)}"></div>
      ${chips('Área', [['todas', 'Todas las áreas'], ...Object.entries(RV.AREAS)], S.area)}
      ${chips('Tipo', RV.TIPOS, S.tipo)}
      <label class="check rv-arch"><input type="checkbox" id="rv-archivadas" ${S.archivadas ? 'checked' : ''}> Ver solo las archivadas</label>
    </div>
    <p class="ayuda" id="rv-n" role="status"></p>
    <div class="rv-tabla" aria-label="Recetas">
      <div class="rv-fila rv-cab" aria-hidden="true"><span>Receta</span><span>Rinde</span><span>Versión</span><span>Aprobada</span><span>Costo neto</span></div>
      <div id="rv-filas"></div></div>
  </section>`;
  pintarFilas(H);
  const q = $('rv-q');
  q.addEventListener('input', () => { S.q = q.value; pintarFilas(H); });
  q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; S.q = ''; pintarFilas(H); } });
  el.querySelectorAll('[data-rv-area]').forEach(b => b.addEventListener('click', () => { S.area = b.dataset.rvArea; el.querySelectorAll('[data-rv-area]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarFilas(H); }));
  el.querySelectorAll('[data-rv-tipo]').forEach(b => b.addEventListener('click', () => { S.tipo = b.dataset.rvTipo; el.querySelectorAll('[data-rv-tipo]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarFilas(H); }));
  $('rv-archivadas').addEventListener('change', e => { S.archivadas = e.target.checked; pintarFilas(H); });
}

// ── Una receta ──
function tablaIngredientes(r, H) {
  const pct = RV.panadero(r), conPct = Object.values(pct).some(x => x !== null);
  const ings = r.ingredientes || [];
  if (!ings.length) return '<p class="ayuda">Sin ingredientes.</p>';
  return `<div class="tabla-b2b"><table class="tabla-tiempos" id="rv-ingredientes"><thead><tr><th scope="col">Ingrediente</th><th scope="col" style="text-align:right">Cantidad</th>${conPct ? `<th scope="col" style="text-align:right">% ${H.info('% de panadero', 'Cada ingrediente sobre el total de harina de la receta (harina = 100 %), igual que en Cocina. Solo en las recetas con harina.')}</th>` : ''}</tr></thead><tbody>
    ${ings.map(i => `<tr><td>${H.esc(i.nombre || i.id)} <span class="ayuda">${H.esc(i.id || '')}</span></td><td style="text-align:right">${H.esc(RV.cantTxt({ g: Number(i.gramos) || 0, u: i.unidades === null || i.unidades === undefined || i.unidades === '' ? null : Number(i.unidades) }))}</td>${conPct ? `<td style="text-align:right">${H.esc(RV.pctTxt(pct[i.id]))}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}
function comparacion(antes, ahora, H) {
  const fs = RV.filasIngredientes(antes, ahora), cs = RV.cambios(antes, ahora);
  const c = x => (x ? `${H.esc(RV.cantTxt(x))}${x.pct !== null ? ` <span class="ayuda">${H.esc(RV.pctTxt(x.pct))}</span>` : ''}` : '—');
  return `<ul class="rv-cambios" id="rv-cambios">${cs.length ? cs.map(x => `<li>${H.esc(x)}</li>`).join('') : '<li>Sin cambios en los ingredientes, el rendimiento ni los pasos.</li>'}</ul>
    <div class="tabla-b2b"><table class="tabla-tiempos" id="rv-comparar"><thead><tr><th scope="col">Ingrediente</th><th scope="col" style="text-align:right">v${H.esc(String(antes.version || '?'))}</th><th scope="col" style="text-align:right">Vigente (v${H.esc(String(ahora.version || 1))})</th></tr></thead><tbody>
    ${fs.map(f => `<tr${f.cambio === 'igual' ? '' : ' class="cambio"'}><td>${H.esc(f.nombre)}${f.cambio === 'nuevo' ? ' <span class="chip c-verde chip-chico">nuevo</span>' : f.cambio === 'sale' ? ' <span class="chip c-rojo chip-chico">sale</span>' : ''}</td><td style="text-align:right">${c(f.antes)}</td><td style="text-align:right">${c(f.ahora)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function bloqueVersiones(r, H) {
  const n = (Number(r.version) || 1) - 1, v = S.vers[r.id];
  if (n < 1) return '<p class="ayuda">Es la primera versión: no hay versiones anteriores.</p>';
  if (!v) return `<div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="rv-ver-versiones">Ver ${n === 1 ? 'la versión anterior' : `las ${n} versiones anteriores`}</button></div>`;
  if (v.cargando) return '<p class="ayuda" role="status">Leyendo las versiones anteriores…</p>';
  if (v.error) return `<p class="error" role="alert">${H.esc(v.error)}</p>`;
  if (!v.lista.length) return '<p class="ayuda">No se encontraron versiones anteriores guardadas (las recetas que venían de la planilla no guardaban la versión anterior).</p>';
  const sel = S.comparar[r.id] || v.lista[0].version, ver = v.lista.find(x => x.version === sel) || v.lista[0];
  return `<div class="rv-versiones" role="group" aria-label="Versiones anteriores">${v.lista.map(x => `<button type="button" class="chip-filtro" data-rv-version="${x.version}" aria-pressed="${x.version === ver.version}">v${x.version}${x.aprobadaEn ? ` · ${H.esc(fecha(x.aprobadaEn))}` : ''}</button>`).join('')}</div>
    <p class="ayuda">v${ver.version}${RV.aprobacion(ver) ? ` · aprobada por ${H.esc(RV.aprobacion(ver))}` : ''} · rinde ${H.esc(RV.rindeTxt(ver))} · comparada con la vigente:</p>
    ${comparacion(ver, r, H)}`;
}
function pintarDetalle(el, id, H) {
  const r = (S.recetas || []).find(x => x.id === id);
  const volver = `<a class="btn-sec fin-enlace fin-volver" href="#produccion/recetas">${ic(IC.atras, 16)} Recetas</a>`;
  if (!r) { el.innerHTML = `<section class="tarjeta">${volver}<p class="aviso" style="margin-top:12px">La receta ${H.esc(id)} no está en la base de Cocina. Toca Actualizar.</p></section>`; return; }
  const c = S.costos ? RV.costoDe(id, S.costos.docs, S.costos.hist) : null, ap = RV.aprobacion(r);
  const pasos = (r.pasos || []).map(p => (typeof p === 'object' && p ? p.texto : p)).filter(Boolean);
  el.innerHTML = `<section class="tarjeta" aria-labelledby="t-rv-det">${volver}
    <div class="titulo-fila" style="margin-top:12px"><h2 id="t-rv-det">${H.esc(r.nombre || id)}</h2><span class="chip c-azul">${H.esc(RV.AREAS[r.area] || r.area || '')}</span></div>
    <p class="ayuda" id="rv-datos">${RV.esSub(r) ? 'Masa o sub receta' : 'Producto'} · ${H.esc(id)} · v${H.esc(String(r.version || 1))} · ${ap ? `aprobada por ${H.esc(ap)}` : 'desde la planilla'} · rinde <b>${H.esc(RV.rindeTxt(r))}</b>${r.pesoUnidad ? ` · ${H.esc(RV.gTxt(r.pesoUnidad))} por unidad` : ''}${r.clasificacion ? ` · ${H.esc(r.clasificacion)}` : ''}${RV.esArchivada(r) ? ' · <span class="chip c-gris chip-chico">archivada</span>' : ''}</p>
    <div class="cifras rv-cifras">
      <div class="tarjeta cifra"><span class="rotulo">Costo neto ${H.info('Si cambia el costo, ¿dónde se ve?', TXT_COSTO)}</span><span class="valor" id="rv-costo">${c ? H.esc(RV.lecturaTxt(c)) : '—'}</span>
        <span class="nota">${c ? `${c.variacion && c.variacion.dir !== 'igual' ? `<span class="fin-var ${c.variacion.dir === 'sube' ? 'fin-sube' : 'fin-baja'}">${ic(IC[c.variacion.dir], 13)}${H.esc(RV.signoPct(c.variacion.pct))}</span> contra ${H.esc(c.lectura.por === 'kg' ? RV.pesos(c.anterior.valor * 1000) : RV.pesosD(c.anterior.valor))}${c.anterior.desde ? ` (desde el ${H.esc(fecha(c.anterior.desde))})` : ''}` : 'sin cambios desde que se calculó'} · cálculo del ${H.esc(fecha(c.fecha))}${c.incompleto ? ' · incompleto' : ''}` : S.costos ? 'sin costo calculado todavía' : 'sin la base de Gastos y Finanzas'}</span></div>
    </div>
    <p><a class="btn-sec btn-chico btn-enlace" id="rv-ir-finanzas" href="#finanzas/costos/productos/r/${encodeURIComponent(id)}">${ic(IC.fuera, 16)} Ver en Finanzas → Costos → Productos</a></p>
    <h3 class="rv-h3">Ingredientes</h3>${tablaIngredientes(r, H)}
    ${(r.insumos || []).length ? `<h3 class="rv-h3">Insumos</h3><ul class="rv-lista" id="rv-insumos">${r.insumos.map(i => `<li>${H.esc(i.nombre || i.id)} · ${H.esc(RV.numTxt(i.cantidad ?? i.unidades, 2))} un</li>`).join('')}</ul>` : ''}
    <h3 class="rv-h3">Pasos</h3>${pasos.length ? `<ol class="rv-lista" id="rv-pasos">${pasos.map(p => `<li>${H.esc(p)}</li>`).join('')}</ol>` : '<p class="ayuda">Sin pasos escritos.</p>'}
    ${String(r.notas || '').trim() ? `<h3 class="rv-h3">Notas</h3><p class="rv-notas" id="rv-notas">${H.esc(r.notas)}</p>` : ''}
    <h3 class="rv-h3">Versiones anteriores ${H.info('Versiones anteriores', 'Cada vez que apruebas un cambio, la versión que estaba vigente queda guardada en la base de Cocina (no se borra).\nElige una para ver qué cambió contra la vigente: ingredientes (g y %), rendimiento y pasos.\nSe leen solo al tocar el botón (1 lectura por versión).')}</h3>
    <div id="rv-versiones">${bloqueVersiones(r, H)}</div>
  </section>`;
  conectarVersiones(el, r, H);
}
function conectarVersiones(el, r, H) {
  const caja = $('rv-versiones'); if (!caja) return;
  const b = $('rv-ver-versiones');
  if (b) b.addEventListener('click', async () => {
    S.vers[r.id] = { cargando: true }; caja.innerHTML = bloqueVersiones(r, H);
    try { S.vers[r.id] = { lista: await P.versionesReceta(r.id, r.version) }; } catch (e) { S.vers[r.id] = { error: (e && e.message) || H.mensajeError(e) }; }
    if ($('rv-versiones')) { $('rv-versiones').innerHTML = bloqueVersiones(r, H); conectarVersiones(el, r, H); }
  });
  caja.querySelectorAll('[data-rv-version]').forEach(x => x.addEventListener('click', () => { S.comparar[r.id] = Number(x.dataset.rvVersion); caja.innerHTML = bloqueVersiones(r, H); conectarVersiones(el, r, H); }));
}
export function olvidar() { S.vers = {}; S.recetas = null; S.costos = null; }
