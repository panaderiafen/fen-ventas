// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Resultados (F3 paso 1: clasificar para el estado de resultados)  v0.61.0
//  Partes: Clasificación (paso 0: áreas de los gastos; paso 1: tipo para resultados de cada ítem) · Créditos (interés y capital
//  de cada cuota) · Inversiones (vida útil y depreciación mensual por área).
//  Rutas: #finanzas/resultados/clasificacion · #finanzas/resultados/creditos[/{id}] · #finanzas/resultados/inversiones.
//  v0.62.0 (F3 paso 2): Estado de resultados (#finanzas/resultados, la primera parte) y Cierre de mes (#finanzas/resultados/cierre),
//  en vista-finanzas-eerr.js.
//  Reglas puras en finanzas-resultados.js; datos en finanzas.js (fen-gastos). No cambia ningún gasto.
//  ctx = { cab, error, conexion, sinBase } de vista-finanzas.js; H = ayudas de app.js.
// ═══════════════════════════════════════════════
import * as F from './finanzas.js?v=0.138.0';
import * as FR from './finanzas-resultados.js?v=0.138.0';
import * as FC from './finanzas-costos.js?v=0.138.0';
import * as VE from './vista-finanzas-eerr.js?v=0.138.0';

const RS = { datos: null, filtro: 'todos', q: '', msg: '', err: '', sel: null, anioDep: '' };
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL');
const pesos = v => FC.pesos(Math.round(Number(v) || 0));
const pct = (v, d = 1) => `${(Math.round((Number(v) || 0) * 10 ** d) / 10 ** d).toLocaleString('es-CL')} %`;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaTxt = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '—'; };
const mesTxt = m => { const [y, n] = String(m).split('-'); return `${MESES_L[Number(n) - 1] || n} ${y}`; };
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const partes = () => (location.hash || '').replace('#', '').split('/');
const PI = {
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', mas: '<path d="M12 5v14M5 12h14"/>', atras: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  revisar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', tabla: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  hist: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', archivo: '<rect x="4" y="5" width="16" height="4" rx="1"/><path d="M6 9v10h12V9M10 13h4"/>'
};
const ic = (n, t = 18) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PI[n] || ''}</svg>`;
const GRUPO_CHIP = { costo: 'c-azul', compra: 'c-verde', margen: 'c-lila', fuera: 'c-gris' };
const destinoTxt = d => FR.NOMBRE_AREA[d] || d;

// v0.102.0 · Con el catálogo de ítems, Clasificación se retira (el tipo sale de la cuenta del ítem, en Gastos → Ítems). Con el Gastos nuevo,
// Créditos también (desde octubre los créditos están en Gastos → Compromisos → Créditos). Sus rutas siguen: muestran dónde quedó cada cosa.
const conCatalogo = () => !!(RS.datos && RS.datos.gn && RS.datos.gn.D && (RS.datos.gn.D.catalogo || []).length);
function subRes(parte, n) {
  const pill = (k, href, txt, extra = '') => `<a class="pastilla" href="#finanzas/resultados${href}" aria-current="${parte === k ? 'page' : 'false'}" aria-pressed="${parte === k}">${txt}${extra}</a>`;
  const sinClasif = conCatalogo() && parte !== 'clasificacion', sinCred = F.gnActivo() && parte !== 'creditos';
  return `<div class="pastillas fin-sub" role="group" aria-label="Partes de Resultados">
    ${pill('eerr', '', 'Estado de resultados')}${pill('cierre', '/cierre', 'Cierre de mes')}${sinClasif ? '' : pill('clasificacion', '/clasificacion', 'Clasificación', n ? ` <span class="chip c-amarillo chip-chico" title="Ítems sin clasificar">${n}</span>` : '')}${sinCred ? '' : pill('creditos', '/creditos', 'Créditos')}${pill('inversiones', '/inversiones', 'Inversiones')}</div>`;
}
const TXT_RETIRADA_CLASIF = 'Desde la v0.102.0 cada ítem de Gastos apunta a una cuenta del plan de cuentas, y la cuenta dice dónde va en el estado de resultados. Ya no hace falta clasificar dos veces.\nLo que se guardó aquí queda como historial (no se borra), pero ya no cuenta.';

export async function pintarResultados(el, parte, H, ctx) {
  const base = cuerpo => ctx.cab('resultados') + subRes(parte, RS.datos ? sinClasificar().length : 0) + cuerpo;
  if (!RS.datos) el.innerHTML = base('<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo los gastos de 2026…</div></section>');
  try {
    const cx = await ctx.conexion();
    if (cx.gastos.estado !== 'ok') return ctx.sinBase(el, 'resultados', H);
    if (!RS.datos) RS.datos = await F.leerResultados();
  } catch (e) { el.innerHTML = base(`<section class="tarjeta"><p class="error" role="alert">${H.esc(ctx.error(e, H))}</p></section>`); return; }
  if (partes()[1] !== 'resultados') return;
  // v0.62.0 · Estado de resultados y Cierre de mes
  if (parte === 'eerr' || parte === 'cierre') {
    const R = { get datos() { return RS.datos; }, cabecera: () => ctx.cab('resultados') + subRes(parte, sinClasificar().length), releer: async () => { RS.datos = await F.leerResultados(true); } };
    return parte === 'cierre' ? VE.pintarCierre(el, H, ctx, R) : VE.pintarEERR(el, H, ctx, R);
  }
  dibujar(el, parte, H, ctx);
}
function dibujar(el, parte, H, ctx) {
  const p = partes();
  let html;
  if (parte === 'creditos' && p[3]) html = htmlCredito(decodeURIComponent(p[3]), H);
  else if (parte === 'clasificacion' && conCatalogo()) html = `<section class="tarjeta" aria-labelledby="t-r-ret"><h2 id="t-r-ret">La clasificación pasó a Gastos → Ítems ${H.info('Clasificación', TXT_RETIRADA_CLASIF)}</h2>
    <p>Cada ítem apunta a una cuenta del plan, y de ahí sale su lugar en el estado de resultados. Un ítem nuevo, o un cambio de cuenta, se hace en Gastos → Ítems.</p>
    <a class="btn" href="#gastos/catalogo">Ir a Gastos → Ítems</a></section>`;
  else html = (parte === 'creditos' && F.gnActivo() ? `<section class="tarjeta"><p class="aviso">Solo consulta. Desde octubre los créditos están en <a href="#gastos/compromisos">Gastos → Compromisos → Créditos</a>: ahí se anota el monto original y la tasa, y cada cuota se separa en interés y capital. Lo de aquí ya no entra al estado de resultados.</p></section>` : '')
    + (parte === 'creditos' ? htmlCreditos(H) : parte === 'inversiones' ? htmlInversiones(H) : htmlClasificacion(H));
  el.innerHTML = ctx.cab('resultados') + subRes(parte, sinClasificar().length) + html;
  const volver = () => dibujar(el, parte, H, ctx);
  const releer = $('r-releer');
  if (releer) releer.addEventListener('click', async () => {
    releer.disabled = true;
    try { RS.datos = await F.leerResultados(true); RS.msg = 'Gastos leídos de nuevo.'; RS.err = ''; } catch (e) { RS.err = ctx.error(e, H); }
    volver();
  });
  if (parte === 'creditos' && p[3]) conectarCredito(el, decodeURIComponent(p[3]), H, ctx, volver);
  else if (parte === 'creditos') conectarCreditos(el, H, ctx, volver);
  else if (parte === 'inversiones') conectarInversiones(el, H, ctx, volver);
  else if (!conCatalogo()) conectarClasificacion(el, H, ctx, volver);
}
const mapaAreas = () => (RS.datos.config && RS.datos.config.areasGasto) || {};
const resumen = () => FR.resumenItems(RS.datos.gastos, RS.datos.items, RS.datos.fin, { anio: FR.ANIO, mapa: mapaAreas() });
const sinClasificar = () => resumen().filter(f => f.n > 0 && !f.clasificado);
const mensajes = H => `<p class="ok-texto" id="r-msg" role="status">${H.esc(RS.msg)}</p><p class="error" id="r-err" role="alert">${H.esc(RS.err)}</p>`;
const fuente = H => `<div class="fin-mfuente"><span class="ayuda">${nf(RS.datos.gastos.length)} gastos leídos de la base de Gastos · ${H.esc(H.hace ? 'leídos ' + H.hace(new Date(RS.datos.leido)) : '')}</span>
  <button type="button" class="btn-sec btn-chico fin-mreleer" id="r-releer">${ic('revisar', 16)} Volver a leer</button></div>`;
const avisoMsg = (txt) => { RS.msg = txt; RS.err = ''; };

// ═══════════════ Clasificación ═══════════════
const TXT_AREAS = 'Cada gasto tiene un código de área (el que se eligió al registrarlo). Aquí dices a qué parte del estado de resultados va:\n· Área propia (Panadería, Bollería, Pastelería, Cafetería o Reventa): sus fijos y sueldos son "fijos propios" de esa área.\n· Común: Administración, Ventas y lo demás. Va al resultado del negocio sin repartir.\nLos gastos prorrateados ya se guardan en una línea por área (con su %), así que cada parte va a su área. Si una línea antigua dice "PRORRATEADO" con sus %, se reparte con esos %.\nPor defecto, las cuatro de producción y REVENTA son propias y el resto común. Las compras de reventa no son fijos: el ítem "PRODUCTOS DE REVENTA" se clasifica como "Compras de productos de reventa" (fuera del resultado).';
const TXT_CANAL = 'B2B y B2C son códigos de costo de canal: lo que cuesta atender a los clientes de ese canal, no lo que cuesta producir. B2B: atención de clientes, órdenes y despacho. B2C: la parte de los costos de las tiendas que es de la venta (por ejemplo, la parte de la luz y el agua de la sala de venta).\nSu lugar en el estado de resultados es una fila "costo de canal" de cada canal, que todavía no existe: llega con F3. Mientras tanto van a Común (sin repartir), igual que Administración y Ventas.\nB2C nunca entra sola en un reparto: solo si la eliges tú. No está en Cocina ni en Producción.';
const TXT_TIPOS = 'Un tipo para cada ítem de gasto, para armar el estado de resultados (todo en neto):\n· Compras de materias primas o de reventa: no son una línea de gasto (su costo ya está en el costo directo); se usan para la desviación.\n· Remuneraciones y gastos fijos: van al área del gasto (propio) o a común, según el mapa de áreas.\n· Ya en el margen: comisiones de tarjeta y despacho B2B (no se cuentan dos veces).\n· Financiero: intereses, multas (por ejemplo, las de Previred) y banco.\n· Fuera del resultado: capital de las cuotas (el interés va a financiero con la tabla del crédito), F29/IVA/PPM, inversiones (entran como depreciación), retiros y otros con motivo.\nLa propuesta sale de palabras del nombre del ítem y de su subtipo en Gastos (INVERSIÓN, FINANCIERO, PASIVO). Nada se guarda solo: tú aplicas o eliges.\nUn ítem con subtipo FINANCIERO en Gastos (Gastos → Ítems) que no clasificaste aquí ya cuenta como Financiero en el estado de resultados y en Previred (salvo que su nombre diga crédito, cuota o préstamo). Lo que eliges aquí siempre manda.';
function htmlClasificacion(H) {
  const areas = FR.areasDeGastos(RS.datos.gastos, FR.ANIO, mapaAreas());
  const res = resumen(), av = FR.avance(res);
  const con = res.filter(f => f.n > 0), sin = res.filter(f => f.n === 0 && !f.archivado);
  const opt = (v, sel, t) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${t}</option>`;
  const filaArea = a => `<div class="fin-compra fin-rarea" data-r-area-fila="${H.esc(a.codigo)}">
    <div><b>${H.esc(a.codigo)}</b><span class="ayuda">${nf(a.n)} ${a.n === 1 ? 'línea' : 'líneas'} en ${FR.ANIO}${a.deProrrateo ? ` · ${nf(a.deProrrateo)} de prorrateo` : ''}</span></div>
    <div><span>${pesos(a.neto)} neto</span>${a.guardado ? '' : `<span class="ayuda">Por defecto: ${H.esc(destinoTxt(a.defecto))}</span>`}${FR.CANALES_PENDIENTES[a.codigo] ? `<span class="ayuda">${H.esc(FR.CANALES_PENDIENTES[a.codigo])}: por ahora a Común ${H.info(FR.CANALES_PENDIENTES[a.codigo], TXT_CANAL)}</span>` : ''}</div>
    <div class="campo"><label for="r-ar-${H.esc(a.codigo)}" class="sr">Destino de ${H.esc(a.codigo)}</label><select id="r-ar-${H.esc(a.codigo)}" data-r-area="${H.esc(a.codigo)}">
      ${FR.AREAS.map(x => opt(x, a.destino, `Área propia: ${FR.NOMBRE_AREA[x]}`)).join('')}${opt('comun', a.destino, 'Común (sin repartir)')}${FR.CANALES_PENDIENTES[a.codigo] ? `<option value="" disabled>${H.esc(FR.CANALES_PENDIENTES[a.codigo])} · llega con F3</option>` : ''}</select></div></div>`;
  const ver = filtrarItems(con);
  const nProp = con.filter(puedeAplicar).length;
  return `<section class="tarjeta" aria-labelledby="t-r-areas">
    <div class="titulo-fila fin-titulo"><h2 id="t-r-areas">Paso 0 · Áreas de los gastos ${H.info('Áreas de los gastos', TXT_AREAS)}</h2></div>
    <p class="ayuda">Los códigos de área que tienen tus gastos de ${FR.ANIO} y a qué parte del resultado va cada uno.</p>
    ${mensajes(H)}
    ${fuente(H)}
    <div class="fin-compras" id="r-areas">${areas.length ? areas.map(filaArea).join('') : `<div class="vacio">No hay gastos de ${FR.ANIO} en la base de Gastos.</div>`}</div>
    ${areas.length ? '<div class="botones fin-rbot"><button type="button" class="btn" id="r-areas-guardar">Guardar áreas</button></div>' : ''}
  </section>
  <section class="tarjeta" aria-labelledby="t-r-clas">
    <div class="titulo-fila fin-titulo"><h2 id="t-r-clas">Paso 1 · Tipo para resultados de cada ítem ${H.info('Tipo para resultados', TXT_TIPOS)}</h2>
      <span class="chip ${av.n < av.m ? 'c-amarillo' : 'c-verde'}">${nf(av.m - av.n)} sin clasificar</span></div>
    <div class="fin-mcob" id="r-avance"><div class="fin-mcob-txt"><span><b>${nf(av.n)} de ${nf(av.m)} ítems clasificados</b> (${pct(av.pct)} del gasto ${FR.ANIO}) ${H.info('Avance', `Ítems con gastos en ${FR.ANIO} que ya tienen tipo, y qué parte del gasto neto de ${FR.ANIO} cubren (${pesos(av.netoClasificado)} de ${pesos(av.netoTotal)}).`)}</span></div>
      <div class="fin-mbarra" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, av.pct)).toFixed(1)}%"></span></div></div>
    <div class="fin-rleyenda">${['costo', 'compra', 'margen', 'fuera'].map(g => `<span class="chip ${GRUPO_CHIP[g]} chip-chico">${FR.NOMBRE_GRUPO[g]}</span>`).join('')}</div>
    <div class="filtros fin-rfiltros">
      <div class="chips" role="group" aria-label="Mostrar">${[['todos', 'Todos'], ['sin', 'Sin clasificar'], ['hechos', 'Clasificados'], ['distinta', 'Distinto a la propuesta']].map(([k, t]) => `<button type="button" class="chip-filtro" data-r-filtro="${k}" aria-pressed="${RS.filtro === k}">${t}</button>`).join('')}</div>
      <label class="sr" for="r-q">Buscar ítem</label><input type="search" id="r-q" placeholder="Buscar ítem" value="${H.esc(RS.q)}"></div>
    <div class="fin-rapl">
      <label class="check"><input type="checkbox" id="r-todas" ${nProp && ver.filter(puedeAplicar).every(f => RS.sel.has(f.clave)) ? 'checked' : ''} ${nProp ? '' : 'disabled'}> Marcar las propuestas que se ven</label>
      <button type="button" class="btn" id="r-aplicar" ${RS.sel.size ? '' : 'disabled'}>${ic('check', 16)} Aplicar propuestas (${nf(RS.sel.size)})</button></div>
    <div class="fin-compras" id="r-items">${ver.length ? ver.map(f => filaItem(f, H)).join('') : '<div class="vacio">Nada que mostrar con este filtro.</div>'}</div>
    ${sin.length ? `<details class="fin-sindet" id="r-sin-det"><summary>Ítems sin gastos en ${FR.ANIO} <span class="chip c-gris chip-chico">${nf(sin.length)}</span></summary>
      <div class="fin-compras">${sin.map(f => filaItem(f, H)).join('')}</div></details>` : ''}
    <p class="nota-i">Si un ítem mezcla cosas de distinta naturaleza (por ejemplo, "Mantención" con una reparación y un equipo nuevo), más adelante se podrá cambiar el tipo de un gasto puntual. Por ahora el tipo es por ítem.</p>
  </section>`;
}
const puedeAplicar = f => !!(f.propuesta.tipo && f.propuesta.tipo !== f.tipo && !(f.propuesta.tipo === 'otro_fuera'));
function filtrarItems(xs) {
  const q = FR.normalizar(RS.q);
  return xs.filter(f => (RS.filtro === 'sin' ? !f.clasificado : RS.filtro === 'hechos' ? f.clasificado : RS.filtro === 'distinta' ? f.distinta : true) && (!q || FR.normalizar(f.item).includes(q)));
}
function filaItem(f, H) {
  const t = f.tipo, g = t ? FR.TIPO[t].grupo : '';
  const dest = Object.entries(f.porDestino).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([d, v]) => `${destinoTxt(d)} ${pesos(v)}`).join(' · ');
  const ref = f.ref ? [f.ref.categoria, f.ref.subTipo].filter(Boolean).join(' · ') : 'no está en la lista de ítems';
  const sel = `<select id="r-t-${H.esc(f.clave)}" data-r-tipo="${H.esc(f.clave)}" aria-label="Tipo para resultados de ${H.esc(f.item)}"><option value="">Sin clasificar</option>${FR.TIPOS.map(x => `<option value="${x.k}" ${x.k === t ? 'selected' : ''}>${H.esc(x.t)}</option>`).join('')}</select>`;
  return `<div class="fin-compra fin-ritem ${f.clasificado ? '' : 'fin-rsin'}" data-r-item="${H.esc(f.clave)}">
    <div class="fin-rnom">${puedeAplicar(f) ? `<label class="check fin-rsel"><input type="checkbox" data-r-sel="${H.esc(f.clave)}" ${RS.sel.has(f.clave) ? 'checked' : ''}><span class="sr">Aplicar la propuesta a ${H.esc(f.item)}</span></label>` : '<span class="fin-rsel fin-rsel-vacio" aria-hidden="true"></span>'}
      <span><b>${H.esc(f.item)}</b><span class="ayuda">${H.esc(ref)}</span></span></div>
    <div><span>${f.n ? `<b>${pesos(f.neto)}</b> neto · ${nf(f.n)} ${f.n === 1 ? 'gasto' : 'gastos'}` : `Sin gastos en ${FR.ANIO}`}</span>${dest ? `<span class="ayuda">${H.esc(dest)}</span>` : ''}</div>
    <div>${f.propuesta.tipo ? `<span>Propuesta: <b>${H.esc(FR.TIPO[f.propuesta.tipo].corto)}</b></span>` : '<span class="ayuda">Sin propuesta</span>'}<span class="ayuda">${H.esc(f.propuesta.tipo ? f.propuesta.motivo : 'elígelo tú')}</span>${f.cuentaComo ? `<span class="ayuda fin-rcuenta" data-r-cuenta="${H.esc(f.clave)}">Mientras no lo clasifiques, ya cuenta como ${H.esc(FR.TIPO[f.cuentaComo].corto)} (subtipo FINANCIERO en Gastos)</span>` : ''}</div>
    <div class="fin-rtipo"><div class="campo">${sel}</div>
      <div class="fin-rmot ${t === 'otro_fuera' ? '' : 'oculto'}" data-r-mot-caja="${H.esc(f.clave)}"><label class="sr" for="r-m-${H.esc(f.clave)}">Motivo</label><input type="text" id="r-m-${H.esc(f.clave)}" maxlength="200" placeholder="Motivo (obligatorio)" value="${H.esc((f.guardado && f.guardado.motivo) || '')}">
        <button type="button" class="btn-sec btn-chico" data-r-mot="${H.esc(f.clave)}">Guardar</button></div>
      <span class="fin-rest">${t ? `<span class="chip ${GRUPO_CHIP[g]} chip-chico">${FR.NOMBRE_GRUPO[g]}</span>` : ''}${f.guardado ? `<button type="button" class="fin-mlink" data-r-hist="${H.esc(f.clave)}">Historial</button>` : ''}</span></div>
  </div>`;
}
function conectarClasificacion(el, H, ctx, volver) {
  const res = resumen(), por = k => res.find(f => f.clave === k);
  const guardar = async (lista, txt) => {
    try {
      const hechos = await F.guardarTipos(lista);
      H.registrar('Finanzas: clasificó ítems para resultados', lista.map(x => `${x.item} → ${FR.textoTipo(x.tipo, x.motivo)}`).join('; ').slice(0, 300));
      avisoMsg(txt || `${nf(hechos.length)} ${hechos.length === 1 ? 'ítem clasificado' : 'ítems clasificados'}.`);
      lista.forEach(x => RS.sel.delete(FR.claveItem(x.item)));
    } catch (e) { RS.err = ctx.error(e, H); RS.msg = ''; }
    volver();
  };
  // Paso 0: áreas
  const ga = $('r-areas-guardar');
  if (ga) ga.addEventListener('click', async () => {
    const m = {}; el.querySelectorAll('[data-r-area]').forEach(s => { m[s.dataset.rArea] = s.value; });
    ga.disabled = true; ga.textContent = 'Guardando…';
    try { const d = await F.guardarAreasGasto(m); RS.datos.config = d; H.registrar('Finanzas: guardó las áreas de los gastos', Object.entries(m).map(([k, v]) => `${k} → ${destinoTxt(v)}`).join(', ')); avisoMsg('Áreas guardadas.'); }
    catch (e) { RS.err = ctx.error(e, H); RS.msg = ''; }
    volver();
  });
  // Paso 1: filtros, buscador, marcar y aplicar
  el.querySelectorAll('[data-r-filtro]').forEach(b => b.addEventListener('click', () => { RS.filtro = b.dataset.rFiltro; RS.msg = ''; volver(); }));
  const q = $('r-q');
  if (q) q.addEventListener('input', () => {
    RS.q = q.value; const ver = filtrarItems(res.filter(f => f.n > 0));
    $('r-items').innerHTML = ver.length ? ver.map(f => filaItem(f, H)).join('') : '<div class="vacio">Nada que mostrar con este filtro.</div>';
    conectarFilas($('r-items'));
  });
  const todas = $('r-todas');
  if (todas) todas.addEventListener('change', () => {
    filtrarItems(res.filter(f => f.n > 0)).filter(puedeAplicar).forEach(f => { if (todas.checked) RS.sel.add(f.clave); else RS.sel.delete(f.clave); });
    el.querySelectorAll('[data-r-sel]').forEach(c => { c.checked = RS.sel.has(c.dataset.rSel); });
    contar();
  });
  const contar = () => { const b = $('r-aplicar'); if (!b) return; b.disabled = !RS.sel.size; b.lastChild.textContent = ` Aplicar propuestas (${nf(RS.sel.size)})`; };
  const ap = $('r-aplicar');
  if (ap) ap.addEventListener('click', async () => {
    const lista = [...RS.sel].map(por).filter(f => f && puedeAplicar(f)).map(f => ({ item: f.item, tipo: f.propuesta.tipo, origen: 'propuesta', propuesta: f.propuesta.tipo }));
    if (!lista.length) return;
    ap.disabled = true; ap.lastChild.textContent = ' Guardando…';
    await guardar(lista, `${nf(lista.length)} ${lista.length === 1 ? 'propuesta aplicada' : 'propuestas aplicadas'}.`);
  });
  const conectarFilas = raiz => {
    raiz.querySelectorAll('[data-r-sel]').forEach(c => c.addEventListener('change', () => { if (c.checked) RS.sel.add(c.dataset.rSel); else RS.sel.delete(c.dataset.rSel); contar(); }));
    raiz.querySelectorAll('[data-r-tipo]').forEach(s => s.addEventListener('change', () => {
      const f = por(s.dataset.rTipo); if (!f) return;
      const caja = raiz.querySelector(`[data-r-mot-caja="${CSS.escape(f.clave)}"]`);
      if (s.value === 'otro_fuera') { caja.classList.remove('oculto'); caja.querySelector('input').focus(); return; }
      if (caja) caja.classList.add('oculto');
      if (!s.value) { s.value = f.tipo || ''; return; }   // "Sin clasificar" no se guarda: se vuelve a lo que había
      s.disabled = true;
      guardar([{ item: f.item, tipo: s.value, origen: s.value === f.propuesta.tipo ? 'propuesta' : 'manual', propuesta: f.propuesta.tipo }], `${f.item} → ${FR.TIPO[s.value].t}.`);
    }));
    raiz.querySelectorAll('[data-r-mot]').forEach(b => b.addEventListener('click', () => {
      const f = por(b.dataset.rMot); if (!f) return;
      const motivo = raiz.querySelector(`#r-m-${CSS.escape(f.clave)}`).value.trim();
      if (!motivo) { $('r-err').textContent = 'Escribe el motivo (por qué queda fuera del resultado).'; return; }
      b.disabled = true;
      guardar([{ item: f.item, tipo: 'otro_fuera', motivo, origen: 'manual', propuesta: f.propuesta.tipo }], `${f.item} → ${FR.TIPO.otro_fuera.t}.`);
    }));
    raiz.querySelectorAll('[data-r-hist]').forEach(b => b.addEventListener('click', () => {
      const f = por(b.dataset.rHist); if (!f) return;
      const d = H.dialogo(`<div class="form-dialogo"><h2>Historial</h2><p class="fin-actual"><b>${H.esc(f.item)}</b> · ${H.esc(FR.textoTipo(f.tipo, f.guardado && f.guardado.motivo))}</p><div id="r-h-l"><p class="ayuda">Cargando…</p></div>
        <div class="botones"><button type="button" class="btn" id="r-h-ok">Cerrar</button></div></div>`);
      d.querySelector('#r-h-ok').addEventListener('click', () => d.close());
      F.historialTipo(f.clave).then(hs => {
        const c = d.querySelector('#r-h-l'); if (!c) return;
        c.innerHTML = hs.length ? `<ul class="fin-hist-lista">${hs.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${H.esc(FR.textoTipo(h.despues && h.despues.tipo, h.despues && h.despues.motivo))}</div><span class="ayuda">${h.antes ? `Antes: ${H.esc(FR.textoTipo(h.antes.tipo, h.antes.motivo))} · ` : ''}${h.origen === 'propuesta' ? 'propuesta aplicada · ' : ''}${H.esc(h.por || '')}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios.</p>';
      }).catch(e => { const c = d.querySelector('#r-h-l'); if (c) c.innerHTML = `<p class="error">${H.esc(ctx.error(e, H))}</p>`; });
    }));
  };
  conectarFilas(el);
}

// ═══════════════ Créditos ═══════════════
const TXT_CRED = 'Cada cuota de un crédito tiene dos partes: el interés (gasto financiero, entra al resultado) y el capital (devolver el préstamo: fuera del resultado, va al flujo de caja).\nAquí anotas cada crédito con su cuenta recurrente de Gastos (la que genera los vencimientos de las cuotas): con el monto, la tasa mensual y el número de cuotas se calcula la tabla (sistema francés: cuota fija, el interés es el saldo × la tasa, al peso; la última cuota ajusta el redondeo). Si el banco te dio la tabla, pégala tal cual (tabla manual).\nCada vencimiento pagado de la cuenta recurrente marca su cuota (la del mismo mes). Después, Resultados usa por mes: interés → financiero, capital → fuera.';
function filasCredito(c) {
  const pagos = FR.pagosDeObligacion(c.obligacionId, RS.datos.vencimientos, RS.datos.gastos);
  return FR.marcarPagos(c.tabla || [], pagos);
}
const obligacionesCredito = () => (RS.datos.obligaciones || []).filter(o => /\b(CREDITO|PRESTAMO|CUOTA|LEASING|FONDO ESPERANZA)\b/.test(FR.normalizar(`${o.nombre} ${o.item}`)));
function htmlCreditos(H) {
  const cs = (RS.datos.creditos || []).slice().sort((a, b) => (a.estado === 'archivado') - (b.estado === 'archivado') || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const usadas = new Set(cs.map(c => c.obligacionId).filter(Boolean));
  const sug = obligacionesCredito().filter(o => !usadas.has(o.id || o.idDoc));
  const porMes = {};
  cs.filter(c => c.estado !== 'archivado').forEach(c => { Object.entries(FR.creditoPorMes(filasCredito(c).filas)).forEach(([m, x]) => { const y = porMes[m] || (porMes[m] = { interes: 0, capital: 0, cuotas: 0 }); y.interes += x.interes; y.capital += x.capital; y.cuotas += x.cuotas; }); });
  const meses = Object.keys(porMes).sort().reverse();
  const fila = c => {
    const r = filasCredito(c).resumen;
    return `<div class="fin-compra fin-rcred" data-r-cred="${H.esc(c.id)}">
      <div><b>${H.esc(c.nombre)}</b><span class="ayuda">${c.obligacionNombre ? `Cuenta recurrente: ${H.esc(c.obligacionNombre)}` : 'Sin cuenta recurrente vinculada'}${c.estado === 'archivado' ? ' · archivado' : ''}</span></div>
      <div><span>${pesos(c.monto)} · ${c.tasa !== null && c.tasa !== undefined ? pct(c.tasa, 2) + ' mensual' : 'tasa de la tabla'}</span><span class="ayuda">${nf(c.n)} cuotas de ${pesos(c.cuota)} · ${c.modo === 'manual' ? 'tabla manual' : 'sistema francés'}</span></div>
      <div><span><b>${nf(r.pagadas)} de ${nf(c.n)}</b> pagadas</span><span class="ayuda">Interés ${pesos(r.interes)} · capital ${pesos(r.capital)} · saldo ${pesos(r.saldo)}</span></div>
      <div class="acciones fin-c-acc"><a class="btn-sec" href="#finanzas/resultados/creditos/${encodeURIComponent(c.id)}">${ic('tabla', 16)} Ver tabla</a></div></div>`;
  };
  return `<section class="tarjeta" aria-labelledby="t-r-cred">
    <div class="titulo-fila fin-titulo"><h2 id="t-r-cred">Créditos ${H.info('Créditos', TXT_CRED)}</h2><button type="button" class="btn" id="r-cr-nuevo">${ic('mas', 16)} Nuevo crédito</button></div>
    <p class="ayuda">Interés y capital de cada cuota, para que en el resultado solo cuente el interés.</p>
    ${mensajes(H)}
    ${fuente(H)}
    <div class="fin-compras" id="r-creditos">${cs.length ? cs.map(fila).join('') : '<div class="vacio">Todavía no hay créditos anotados.</div>'}</div>
    ${sug.length ? `<div class="fin-mcat fin-rsug"><span>${nf(sug.length)} ${sug.length === 1 ? 'cuenta recurrente parece' : 'cuentas recurrentes parecen'} un crédito: ${sug.map(o => `<b>${H.esc(o.nombre)}</b>`).join(', ')}. ${H.info('Cuentas recurrentes que parecen créditos', 'Cuentas recurrentes de Gastos cuyo nombre o ítem dice crédito, préstamo, cuota, leasing o Fondo Esperanza y que todavía no tienen su crédito anotado aquí.')}</span>
      <div class="acciones">${sug.slice(0, 4).map(o => `<button type="button" class="btn-sec" data-r-cr-de="${H.esc(o.id || '')}">Anotar ${H.esc(o.nombre)}</button>`).join('')}</div></div>` : ''}
  </section>
  ${meses.length ? `<section class="tarjeta" aria-labelledby="t-r-crmes"><div class="titulo-fila fin-titulo"><h2 id="t-r-crmes">Cuotas pagadas por mes ${H.info('Cuotas por mes', 'Por mes de pago, de todos los créditos activos: el interés irá a gasto financiero y el capital queda fuera del resultado.')}</h2></div>
    <div class="tabla-b2b"><table class="tabla-tiempos tabla-cel-tarjetas fin-rtab" id="r-cr-mes"><thead><tr><th scope="col">Mes</th><th scope="col" style="text-align:right">Cuotas</th><th scope="col" style="text-align:right">Interés (financiero)</th><th scope="col" style="text-align:right">Capital (fuera)</th></tr></thead><tbody>
      ${meses.map(m => `<tr><td>${H.esc(mesTxt(m))}</td><td data-et="Cuotas" style="text-align:right">${nf(porMes[m].cuotas)}</td><td data-et="Interés (financiero)" style="text-align:right">${pesos(porMes[m].interes)}</td><td data-et="Capital (fuera)" style="text-align:right">${pesos(porMes[m].capital)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}
function conectarCreditos(el, H, ctx, volver) {
  const n = $('r-cr-nuevo'); if (n) n.addEventListener('click', () => dialogoCredito(null, H, ctx, volver));
  el.querySelectorAll('[data-r-cr-de]').forEach(b => b.addEventListener('click', () => {
    const o = (RS.datos.obligaciones || []).find(x => (x.id || '') === b.dataset.rCrDe);
    dialogoCredito(null, H, ctx, volver, o ? { nombre: o.nombre, obligacionId: o.id, cuota: Number(o.montoEstimado) || '' } : null);
  }));
}
function htmlCredito(id, H) {
  const c = (RS.datos.creditos || []).find(x => x.id === id);
  if (!c) return `<section class="tarjeta"><a class="btn-sec fin-volver" href="#finanzas/resultados/creditos">${ic('atras', 16)} Volver a Créditos</a><div class="vacio">Ese crédito no existe.</div></section>`;
  const m = filasCredito(c), r = m.resumen, hoy = hoyTxt();
  const cifra = (t, v, nota = '') => `<div class="tarjeta cifra"><span class="rotulo">${t}</span><span class="valor">${v}</span>${nota ? `<span class="nota">${nota}</span>` : ''}</div>`;
  return `<section class="tarjeta" aria-labelledby="t-r-c1">
    <a class="btn-sec fin-volver" href="#finanzas/resultados/creditos">${ic('atras', 16)} Volver a Créditos</a>
    <div class="titulo-fila fin-titulo"><h2 id="t-r-c1">${H.esc(c.nombre)} ${H.info('Tabla del crédito', TXT_CRED)}</h2>
      <div class="acciones fin-racc"><button type="button" class="btn-sec" id="r-c-editar">${ic('editar', 16)} Editar</button><button type="button" class="btn-sec" id="r-c-arch">${ic('archivo', 16)} ${c.estado === 'archivado' ? 'Reactivar' : 'Archivar'}</button></div></div>
    <p class="ayuda">${c.obligacionNombre ? `Cuenta recurrente: <b>${H.esc(c.obligacionNombre)}</b>` : 'Sin cuenta recurrente vinculada: las cuotas no se marcan solas.'} · ${c.modo === 'manual' ? 'Tabla manual' : 'Sistema francés'}${c.cuotaManual ? ' con la cuota del banco' : ''}${c.nota ? ` · ${H.esc(c.nota)}` : ''}</p>
    ${mensajes(H)}
    <div class="cifras fin-dcifras">
      ${cifra('Monto', pesos(c.monto))}${cifra('Cuota', pesos(c.cuota), `${nf(c.n)} cuotas${c.tasa !== null && c.tasa !== undefined ? ' · ' + pct(c.tasa, 2) + ' mensual' : ''}`)}
      ${cifra('Pagadas', `${nf(r.pagadas)} de ${nf(c.n)}`)}${cifra('Interés pagado', pesos(r.interes), 'gasto financiero')}${cifra('Capital pagado', pesos(r.capital), 'fuera del resultado')}${cifra('Saldo', pesos(r.saldo))}</div>
    ${m.sobran ? `<p class="aviso">${nf(m.sobran)} ${m.sobran === 1 ? 'pago' : 'pagos'} de la cuenta recurrente no calzan con ninguna cuota (hay más pagos que cuotas): revisa la tabla.</p>` : ''}
    ${r.pagadas && Math.abs(r.dif) > r.pagadas * 2 ? `<p class="aviso">Lo pagado difiere de las cuotas de la tabla en ${pesos(r.dif)} en total (por ejemplo, intereses de mora o seguro). ${H.info('Diferencia con lo pagado', 'La tabla dice cuánto es interés y capital de cada cuota. Si pagaste más (mora, seguros, comisiones), esa diferencia no está en la tabla: más adelante se podrá clasificar aparte.')}</p>` : ''}
    <div class="tabla-b2b" style="margin-top:12px"><table class="tabla-tiempos tabla-cel-tarjetas fin-rtab" id="r-tabla"><thead><tr><th scope="col">N°</th><th scope="col">Fecha</th><th scope="col" style="text-align:right">Cuota</th><th scope="col" style="text-align:right">Interés</th><th scope="col" style="text-align:right">Capital</th><th scope="col" style="text-align:right">Saldo</th><th scope="col">Pago</th></tr></thead><tbody>
      ${m.filas.map(f => `<tr class="${f.pago ? 'fin-rpag' : ''}"><td>${nf(f.n)}</td><td data-et="Fecha">${fechaTxt(f.fecha)}</td><td data-et="Cuota" style="text-align:right">${pesos(f.cuota)}</td><td data-et="Interés" style="text-align:right">${pesos(f.interes)}</td><td data-et="Capital" style="text-align:right">${pesos(f.capital)}</td><td data-et="Saldo" style="text-align:right">${f.saldo === null ? '—' : pesos(f.saldo)}</td>
        <td data-et="Pago">${f.pago ? `<span class="chip c-verde chip-chico">Pagada ${fechaTxt(f.pago.fechaPago)}</span><span class="ayuda fin-rpago"> ${pesos(f.pago.monto)} · interés → financiero, capital → fuera${f.pago.porOrden ? ' · por orden' : ''}</span>` : f.fecha < hoy ? '<span class="chip c-amarillo chip-chico">Sin pago</span>' : '<span class="ayuda">—</span>'}</td></tr>`).join('')}</tbody></table></div>
    <details class="fin-sindet" id="r-c-hist"><summary>${ic('hist', 16)} Historial</summary><div id="r-c-hl"><p class="ayuda">Cargando…</p></div></details>
  </section>`;
}
function conectarCredito(el, id, H, ctx, volver) {
  const c = (RS.datos.creditos || []).find(x => x.id === id); if (!c) return;
  $('r-c-editar').addEventListener('click', () => dialogoCredito(c, H, ctx, volver));
  $('r-c-arch').addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try { await F.archivarCredito(id, c.estado !== 'archivado'); H.registrar(`Finanzas: ${c.estado !== 'archivado' ? 'archivó' : 'reactivó'} un crédito`, c.nombre); avisoMsg(c.estado !== 'archivado' ? 'Crédito archivado (no cuenta en los meses que vienen).' : 'Crédito reactivado.'); }
    catch (e) { RS.err = ctx.error(e, H); }
    volver();
  });
  const det = $('r-c-hist');
  det.addEventListener('toggle', () => {
    if (!det.open || det.dataset.cargado) return; det.dataset.cargado = '1';
    F.historialCredito(id).then(hs => { $('r-c-hl').innerHTML = hs.length ? `<ul class="fin-hist-lista">${hs.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${H.esc({ nuevo: 'Creado', cambio: 'Cambiado', archivado: 'Archivado', reactivado: 'Reactivado' }[h.accion] || h.accion)}</div><span class="ayuda">${h.despues ? `${pesos(h.despues.monto)} · ${nf(h.despues.n)} cuotas de ${pesos(h.despues.cuota)} · ` : ''}${H.esc(h.por || '')}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios.</p>'; })
      .catch(e => { $('r-c-hl').innerHTML = `<p class="error">${H.esc(ctx.error(e, H))}</p>`; });
  });
}
function dialogoCredito(c, H, ctx, volver, pre) {
  const v = c || pre || {}, modo0 = (c && c.modo) || 'frances';
  const obls = (RS.datos.obligaciones || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const pareceCred = new Set(obligacionesCredito().map(o => o.id));
  const val = x => (x === null || x === undefined ? '' : H.esc(String(x)));
  const textoTabla = c && c.modo === 'manual' ? (c.tabla || []).map(f => [f.n, f.fecha, f.cuota, f.interes, f.capital, f.saldo === null ? '' : f.saldo].join('\t')).join('\n') : '';
  const d = H.dialogo(`<form class="form-dialogo" id="r-cf" novalidate>
    <h2>${c ? 'Editar crédito' : 'Nuevo crédito'}</h2>
    <div class="campo"><label for="r-c-nom">Nombre</label><input id="r-c-nom" type="text" maxlength="120" value="${val(v.nombre)}" placeholder="Crédito Banco Estado 2026"></div>
    <div class="campo"><label for="r-c-obl">Cuenta recurrente de Gastos ${H.info('Cuenta recurrente vinculada', 'La cuenta recurrente que genera los vencimientos de las cuotas (por ejemplo, CREDITO PAC BANCO ESTADO o FONDO ESPERANZA). Cada vencimiento pagado marca su cuota en la tabla.')}</label>
      <select id="r-c-obl"><option value="">Sin cuenta recurrente</option>${obls.map(o => `<option value="${H.esc(o.id || '')}" ${(o.id || '') === v.obligacionId ? 'selected' : ''}>${H.esc(o.nombre)}${pareceCred.has(o.id) ? ' · crédito' : ''}${String(o.estado || '').toUpperCase() === 'ARCHIVADA' ? ' (archivada)' : ''}</option>`).join('')}</select></div>
    <fieldset class="fin-as-tipo"><legend class="sr">Cómo se arma la tabla</legend>
      <label class="check"><input type="radio" name="r-c-modo" value="frances" ${modo0 === 'frances' ? 'checked' : ''}> Calcular (cuota fija, sistema francés)</label>
      <label class="check"><input type="radio" name="r-c-modo" value="manual" ${modo0 === 'manual' ? 'checked' : ''}> Pegar la tabla del banco</label></fieldset>
    <div id="r-c-fr" class="${modo0 === 'frances' ? '' : 'oculto'}"><div class="grilla-montos">
      <div class="campo"><label for="r-c-monto">Monto del crédito</label><input id="r-c-monto" type="number" inputmode="numeric" min="0" step="1" value="${val(v.monto)}"></div>
      <div class="campo"><label for="r-c-tasa">Tasa mensual % ${H.info('Tasa mensual', 'La tasa de interés mensual del crédito (por ejemplo 1,5). Si el banco te dio la tasa anual, divide por 12 o mejor pega la tabla.')}</label><input id="r-c-tasa" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" max="20" step="any" value="${val(v.tasa)}"></div>
      <div class="campo"><label for="r-c-n">N° de cuotas</label><input id="r-c-n" type="number" inputmode="numeric" min="1" max="600" step="1" value="${val(v.n)}"></div>
      <div class="campo"><label for="r-c-f1">Primera cuota</label><input id="r-c-f1" type="date" value="${val(v.fechaPrimera)}"></div>
      <div class="campo"><label for="r-c-cuota">Cuota del banco (opcional) ${H.info('Cuota', 'Vacía: se calcula con la fórmula del sistema francés y se redondea al peso. Si el banco cobra otra (por seguros o redondeo), escríbela: el interés se calcula igual y la última cuota ajusta.')}</label><input id="r-c-cuota" type="number" inputmode="numeric" min="0" step="1" value="${c && c.cuotaManual ? val(c.cuota) : val(pre && pre.cuota)}"></div></div>
      <div class="fin-rtasa"><button type="button" class="btn-sec btn-chico" id="r-c-tasa-calc">Calcular la tasa desde la cuota</button> ${H.info('Tasa desde la cuota', 'Si el banco te dio el monto, el número de cuotas y el valor de la cuota pero no la tasa: escribe esos tres datos (la cuota en "Cuota del banco") y toca este botón. Se busca la tasa mensual del sistema francés que da exactamente esa cuota (método numérico, siempre llega a una sola respuesta) y se arma la tabla.\nTasa anual equivalente = (1 + tasa mensual)^12 − 1. Si la cuota del banco incluye seguros, la tasa sale un poco más alta que la del contrato: mejor pega la tabla del banco.')}
        <p class="fin-calc" id="r-c-tasa-res" role="status"></p></div>
      <p class="fin-calc" id="r-c-calc" role="status"></p></div>
    <div id="r-c-man" class="${modo0 === 'manual' ? '' : 'oculto'}"><div class="campo"><label for="r-c-txt">Tabla ${H.info('Tabla manual', 'Copia la tabla del banco (de la planilla o del PDF) y pégala: una cuota por línea con N°, fecha, cuota, interés, capital y saldo, separados por tabulador o punto y coma. Los encabezados se saltan. Montos como 1.234.567 o $ 12.345; fechas 05/03/2026 o 2026-03-05.')}</label>
      <textarea id="r-c-txt" rows="6" placeholder="1\t05/03/2026\t95.000\t30.000\t65.000\t1.935.000">${H.esc(textoTabla)}</textarea></div>
      <div class="campo"><label for="r-c-montom">Monto del crédito (opcional)</label><input id="r-c-montom" type="number" inputmode="numeric" min="0" step="1" value="${c && c.modo === 'manual' ? val(c.monto) : ''}"></div>
      <p class="fin-calc" id="r-c-prev" role="status"></p></div>
    <div class="campo"><label for="r-c-nota">Nota (opcional)</label><input id="r-c-nota" type="text" maxlength="300" value="${val(c && c.nota)}"></div>
    <p class="error" id="r-c-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="r-c-no">Cancelar</button><button type="submit" class="btn" id="r-c-si">Guardar</button></div>
  </form>`);
  const q = s => d.querySelector(s), modo = () => d.querySelector('input[name="r-c-modo"]:checked').value;
  q('#r-c-no').addEventListener('click', () => d.close());
  const datos = () => {
    const o = obls.find(x => (x.id || '') === q('#r-c-obl').value);
    return modo() === 'manual'
      ? { modo: 'manual', nombre: q('#r-c-nom').value, obligacionId: q('#r-c-obl').value, obligacionNombre: o ? o.nombre : '', texto: q('#r-c-txt').value, monto: q('#r-c-montom').value, nota: q('#r-c-nota').value }
      : { modo: 'frances', nombre: q('#r-c-nom').value, obligacionId: q('#r-c-obl').value, obligacionNombre: o ? o.nombre : '', monto: q('#r-c-monto').value, tasa: FC.casilla(q('#r-c-tasa')), n: q('#r-c-n').value, fechaPrimera: q('#r-c-f1').value, cuota: q('#r-c-cuota').value, nota: q('#r-c-nota').value };
  };
  const calc = () => {
    if (modo() === 'manual') {
      const p = FR.parsearTabla(q('#r-c-txt').value);
      q('#r-c-prev').textContent = p.filas.length ? `${nf(p.filas.length)} cuotas leídas · intereses ${pesos(p.filas.reduce((a, f) => a + f.interes, 0))} · capital ${pesos(p.filas.reduce((a, f) => a + f.capital, 0))}${p.avisos.length ? ' · Revisa: ' + p.avisos.slice(0, 3).join('; ') : ''}` : '';
      return;
    }
    const x = datos();
    try { const t = FR.tablaFrancesa(x); q('#r-c-calc').textContent = `Cuota ${pesos(t[0].cuota)}${Number(x.cuota) > 0 ? '' : ' (calculada)'} · última ${pesos(t[t.length - 1].cuota)} · intereses en total ${pesos(t.reduce((a, f) => a + f.interes, 0))}`; }
    catch (e) { q('#r-c-calc').textContent = ''; }
  };
  // v0.62.0 · La tasa desde la cuota (monto, n° de cuotas y cuota del banco)
  q('#r-c-tasa-calc').addEventListener('click', () => {
    const out = q('#r-c-tasa-res'), err = q('#r-c-err'); err.textContent = '';
    try {
      const t = FR.tasaDesdeCuota(q('#r-c-monto').value, q('#r-c-n').value, q('#r-c-cuota').value);
      q('#r-c-tasa').value = String(Math.round(t.tasa * 1e6) / 1e6);
      out.textContent = `Tasa mensual ${pct(t.tasa, 4)} · anual equivalente ${pct(t.anual, 2)}`;
      calc();
    } catch (e) { out.textContent = ''; err.textContent = e.message; }
  });
  d.querySelectorAll('input[name="r-c-modo"]').forEach(r => r.addEventListener('change', () => { q('#r-c-fr').classList.toggle('oculto', modo() !== 'frances'); q('#r-c-man').classList.toggle('oculto', modo() !== 'manual'); calc(); }));
  d.querySelectorAll('input, textarea').forEach(x => x.addEventListener('input', calc));
  calc();
  q('#r-cf').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = q('#r-c-err'), b = q('#r-c-si'), x = datos(); err.textContent = '';
    try { FR.validarCredito(x); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await F.guardarCredito(c ? c.id : null, x);
      H.registrar(c ? 'Finanzas: cambió un crédito' : 'Finanzas: anotó un crédito', `${r.nombre} · ${r.n} cuotas de ${r.cuota}`);
      avisoMsg(`${r.nombre}: tabla de ${nf(r.n)} cuotas guardada.`);
      d.close();
      if (!c) { location.hash = '#finanzas/resultados/creditos/' + encodeURIComponent(r.id); return; }
      volver();
    } catch (e) { err.textContent = ctx.error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
}

// ═══════════════ Inversiones ═══════════════
const TXT_INV = 'Una inversión (equipo, maquinaria, mueble, computador, remodelación) no entra entera al resultado del mes en que se compra: se reparte en su vida útil como depreciación mensual = valor neto ÷ meses de vida útil, desde el mes de la compra.\nVida útil por defecto según el nombre: computación 36 meses, equipos 60, muebles 84, remodelación 120. Se puede cambiar.\nAquí aparecen los gastos cuyo ítem está clasificado como Inversión (Clasificación). Cada uno va al área de su gasto (según el mapa de áreas).';
function htmlInversiones(H) {
  const invs = FR.inversiones(RS.datos.gastos, RS.datos.fin, RS.datos.invGuardadas, mapaAreas());
  const hoy = hoyTxt(), mesHoy = hoy.slice(0, 7);
  const anios = [...new Set(invs.flatMap(i => { const a = Number(i.inicio.slice(0, 4)), b = Number(i.fin.slice(0, 4)); const r = []; for (let y = a; y <= Math.min(b, a + 15); y++) r.push(String(y)); return r; }))].sort();
  if (!RS.anioDep || !anios.includes(RS.anioDep)) RS.anioDep = anios.includes(String(FR.ANIO)) ? String(FR.ANIO) : (anios[anios.length - 1] || String(FR.ANIO));
  const meses = Array.from({ length: 12 }, (_, k) => `${RS.anioDep}-${String(k + 1).padStart(2, '0')}`);
  const tab = FR.depreciacionPorMes(invs, meses), tot = tab.reduce((a, f) => a + f.total, 0);
  const deEste = FR.depreciacionPorMes(invs, [mesHoy])[0];
  const itemsInv = conCatalogo() ? RS.datos.gn.D.catalogo.filter(x => x.estado !== 'archivado' && FR.tipoDeGasto({ catalogo: true, cuenta: x.cuenta }) === 'inversion').length : Object.values(RS.datos.fin || {}).filter(x => x.tipo === 'inversion').length;
  const cifra = (t, v, nota = '') => `<div class="tarjeta cifra"><span class="rotulo">${t}</span><span class="valor">${v}</span>${nota ? `<span class="nota">${nota}</span>` : ''}</div>`;
  const cols = FR.AREAS.filter(a => a !== 'REVENTA' || tab.some(f => f.REVENTA)).concat('comun');   // v0.69.1: Reventa solo si tiene depreciación
  const fila = i => `<div class="fin-compra fin-rinv" data-r-inv="${H.esc(i.id)}">
    <div><b>${H.esc(i.item)}</b><span class="ayuda">${fechaTxt(i.fecha)}${i.proveedor ? ' · ' + H.esc(i.proveedor) : ''}${i.detalle ? ' · ' + H.esc(i.detalle) : ''}</span></div>
    <div><span><b>${pesos(i.valor)}</b> neto</span><span class="ayuda">${H.esc(i.lineas.map(l => `${l.area} → ${destinoTxt(l.destino)}`).join(' · '))}</span></div>
    <div class="fin-rvida"><div class="campo"><label for="r-v-${H.esc(i.id)}">Vida útil (meses)</label><input id="r-v-${H.esc(i.id)}" type="number" inputmode="numeric" min="1" max="600" step="1" value="${i.meses}" data-r-vida="${H.esc(i.id)}"></div>
      <span class="ayuda">${i.porDefecto ? `Por defecto (${H.esc(i.defecto.nombre.toLowerCase())}) · ` : ''}de ${H.esc(mesTxt(i.inicio.slice(0, 7)))} a ${H.esc(mesTxt(i.fin))}</span></div>
    <div class="fin-c-acc"><span><b data-r-mens="${H.esc(i.id)}">${pesos(i.mensual)}</b> al mes</span><button type="button" class="btn-sec btn-chico" data-r-inv-g="${H.esc(i.id)}">Guardar</button></div></div>`;
  return `<section class="tarjeta" aria-labelledby="t-r-inv">
    <div class="titulo-fila fin-titulo"><h2 id="t-r-inv">Inversiones ${H.info('Inversiones y depreciación', TXT_INV)}</h2></div>
    <p class="ayuda">Los gastos clasificados como inversión, su vida útil y cuánto entra al resultado cada mes.</p>
    ${mensajes(H)}
    ${fuente(H)}
    <div class="cifras fin-dcifras" id="r-inv-cifras">${cifra('Inversiones', nf(invs.length), `${nf(itemsInv)} ${itemsInv === 1 ? 'ítem' : 'ítems'} de inversión`)}${cifra('Valor neto', pesos(invs.reduce((a, i) => a + i.valor, 0)))}${cifra('Depreciación de este mes', pesos(deEste.total), H.esc(mesTxt(mesHoy)))}${cifra(`Depreciación ${H.esc(RS.anioDep)}`, pesos(tot))}</div>
    <div class="fin-compras" id="r-invs">${invs.length ? invs.map(fila).join('') : `<div class="vacio">${conCatalogo() ? 'No hay gastos con un ítem de inversión (Equipos y maquinaria, Habilitación de locales o Activo intangible, en <a href="#gastos/catalogo">Gastos → Ítems</a>).' : `No hay gastos clasificados como inversión. ${itemsInv ? '' : 'Marca sus ítems como "Inversión" en '}<a href="#finanzas/resultados/clasificacion">Clasificación</a>.`}</div>`}</div>
  </section>
  ${invs.length ? `<section class="tarjeta" aria-labelledby="t-r-dep">
    <div class="titulo-fila fin-titulo"><h2 id="t-r-dep">Depreciación mensual por área ${H.info('Depreciación por área', 'Cada inversión se deprecia en partes iguales cada mes de su vida útil, y va al área de su gasto (si el gasto se prorrateó, a cada área en su %). Común = Administración, Ventas y lo demás, según el mapa de áreas.')}</h2></div>
    ${anios.length > 1 ? `<div class="chips" role="group" aria-label="Año">${anios.map(a => `<button type="button" class="chip-filtro" data-r-anio="${a}" aria-pressed="${a === RS.anioDep}">${a}</button>`).join('')}</div>` : ''}
    <div class="tabla-b2b"><table class="tabla-tiempos fin-rtab fin-rdep" id="r-dep"><thead><tr><th scope="col">Mes</th>${cols.map(a => `<th scope="col" style="text-align:right">${FR.NOMBRE_AREA[a]}</th>`).join('')}<th scope="col" style="text-align:right">Total</th></tr></thead><tbody>
      ${tab.map(f => `<tr${f.mes === mesHoy ? ' class="fin-rhoy"' : ''}><td>${H.esc(mesTxt(f.mes))}</td>${cols.map(a => `<td style="text-align:right">${f[a] ? pesos(f[a]) : '—'}</td>`).join('')}<td style="text-align:right"><b>${pesos(f.total)}</b></td></tr>`).join('')}
      <tr class="fin-rtot"><td><b>Total ${H.esc(RS.anioDep)}</b></td>${cols.map(a => { const v = tab.reduce((x, f) => x + f[a], 0); return `<td style="text-align:right"><b>${v ? pesos(v) : '—'}</b></td>`; }).join('')}<td style="text-align:right"><b>${pesos(tot)}</b></td></tr></tbody></table></div>
  </section>` : ''}`;
}
function conectarInversiones(el, H, ctx, volver) {
  const invs = FR.inversiones(RS.datos.gastos, RS.datos.fin, RS.datos.invGuardadas, mapaAreas());
  el.querySelectorAll('[data-r-anio]').forEach(b => b.addEventListener('click', () => { RS.anioDep = b.dataset.rAnio; RS.msg = ''; volver(); }));
  el.querySelectorAll('[data-r-vida]').forEach(inp => inp.addEventListener('input', () => {
    const i = invs.find(x => x.id === inp.dataset.rVida), m = Math.round(Number(inp.value));
    const o = el.querySelector(`[data-r-mens="${CSS.escape(inp.dataset.rVida)}"]`);
    if (i && o) o.textContent = m > 0 ? pesos(i.valor / m) : '—';
  }));
  el.querySelectorAll('[data-r-inv-g]').forEach(b => b.addEventListener('click', async () => {
    const i = invs.find(x => x.id === b.dataset.rInvG); if (!i) return;
    const v = el.querySelector(`[data-r-vida="${CSS.escape(i.id)}"]`).value;
    try { FR.validarInversion({ vidaUtilMeses: v }); } catch (e) { $('r-err').textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await F.guardarInversion(i.id, { vidaUtilMeses: v, fechaInicio: i.inicio }, { item: i.item, valor: i.valor });
      H.registrar('Finanzas: vida útil de una inversión', `${i.item} (${i.fecha}) → ${v} meses`);
      avisoMsg(`${i.item}: ${v} meses de vida útil.`);
    } catch (e) { RS.err = ctx.error(e, H); RS.msg = ''; }
    volver();
  }));
}

// Al entrar a Resultados desde otra pestaña se vuelve a leer (lo de Gastos pudo cambiar)
export function olvidar() { RS.datos = null; RS.msg = ''; RS.err = ''; F.olvidarResultados(); VE.olvidar(); }
RS.sel = new Set();
