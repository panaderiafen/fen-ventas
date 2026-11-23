// ═══════════════════════════════════════════════
//  Sistema Fën — Producción → Plan de Panadería (Etapa 1)  v0.73.0 (sábado → lunes; masa madre del martes: el domingo, la hace el dueño)
//  Rutas: #produccion/plan-pan (Propuesta próxima semana) · #produccion/plan-pan/como (Cómo nos fue) · #produccion/plan-pan/fijos
//  (Ainavillo y pisos). Solo administración. Solo lectura, salvo la tabla fija de Ainavillo y los pisos (config/planPanaderia
//  en fen-ventas, con historial). "Copiar como texto" y la hoja para imprimir (viernes).
//  v0.77.1: pestaña de Producción (Producción → Plan de Panadería); se dibuja dentro de #prod-tab.
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, hace }
// ═══════════════════════════════════════════════
import * as PP from './plan-pan.js?v=0.138.0';
import * as PM from './plan-pan-modelo.js?v=0.138.0';

const S = { D: null, prop: null, dia: 0, semana: '', suc: 'todas', abiertos: new Set(), msg: '', err: '', editSuc: 'barros', cargando: false, extra: [] };
const $ = id => document.getElementById(id);
const n = v => (v === null || v === undefined ? '—' : Math.round(Number(v) || 0).toLocaleString('es-CL'));
const pct = v => (v === null || v === undefined ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('es-CL')} %`);
const pesos = v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL');
const g = v => `${Math.round(Number(v) || 0).toLocaleString('es-CL')} g`;
const signo = v => (v < 0 ? '−' + Math.abs(v) : '+' + v);
const TABS = [['', 'Propuesta próxima semana'], ['como', 'Cómo nos fue'], ['fijos', 'Ainavillo y pisos']];
const tabActual = () => { const p = (location.hash || '').split('/'); return ['como', 'fijos'].includes(p[2]) ? p[2] : ''; };

const TXT = {
  proceso: 'Masa madre: la tarde antes del amasado, a las 19:00 (Panadería). Amasado: al día siguiente. Horneado y venta: el día después del amasado.\nEl domingo no hay producción: lo amasado el sábado se hornea el lunes, con la masa madre del viernes en la tarde. El amasado del lunes (para el martes) usa la masa madre del domingo en la tarde, que haces tú (el domingo no trabaja Panadería).\nLa masa madre fija el techo de lo que se puede hornear: el día del amasado las cantidades solo se pueden bajar.\nPor eso la propuesta se mira el viernes: esa tarde se hace la masa madre para el lunes.\nEl domingo no se hornea: no lleva propuesta.',
  mm: 'Gramos de masa madre (blanca e integral) que piden las recetas de lo propuesto para ese horneado, con la misma búsqueda que usa Cocina para el pie de masa madre (las sub recetas "masa madre" dentro de cada receta, con los ajustes de harina y agua vigentes).\nEs la masa madre lista para usar en el amasado; el pie para hacerla lo sigue calculando Cocina.',
  b2b: 'Por cliente y tipo de pan, en los 4 mismos días anteriores (los últimos 4 lunes, si es lunes):\n· veces = en cuántos de esos 4 días pidió;\n· cantidad usual = la mediana de lo que pidió los días que pidió.\nEstimado = suma de la cantidad usual de los clientes que pidieron 3 o 4 veces + (veces ÷ 4) × cantidad usual de los demás.\nSi ya hay órdenes para ese día, manda lo pedido cuando es más.\nLa fecha de la orden es el día de entrega, o sea, el día de horneado.\nActivos = clientes que pidieron pan al menos una vez en los últimos 28 días.',
  barros: 'Mediana de lo VENDIDO por lote (recibido − merma − lo que queda) en los 4 mismos días de horneado anteriores.\nAjustes, solo con datos exactos (se suman y quedan entre −20 % y +20 %):\n· merma: mediana del % de merma sobre 10 % → −5 %; sobre 20 % → −10 %;\n· rebajado (días con caja v2.2.0, al menos 2): mediana del % vendido rebajado sobre 15 % → −5 %; sobre 30 % → −10 %;\n· agotado (días con caja v2.2.0): se agotó 2 o más veces → +10 %; 2 o más veces antes de las 13:00 → +15 %.\nSi hay piso para ese día, la propuesta no baja del piso.\nToca un número para ver sus referencias: la semana pasada, las 4 semanas, la misma semana del mes anterior y la misma del año pasado (se muestra cuando haya datos, desde junio de 2027).',
  aina: 'Ainavillo aún no registra ventas: cantidades fijas.\nSalen de la tabla de "Ainavillo y pisos" (por día y tipo de pan); si no hay nada, 0. Cuando Ainavillo empiece a ingresar su pan en la caja, se podrá calcular como Barros.',
  lote: 'Contabilidad por lote, exacta: un lote es lo que recibió la tienda ese día (ingresos de stock en la caja).\nVendido = recibido − merma de ese lote − lo que aún queda de él. Incluye lo vendido los días siguientes con precio rebajado.\nMerma: la registrada (dice su lote) más la enviada a merma en la caja y aún sin registrar. Si una merma junta varios lotes, va al más antiguo; lo que pasa de lo que ese lote tenía se corre al lote siguiente.',
  tarjetas: 'Fresco: lo vendido con la tarjeta "Hoy" el mismo día del lote. Rebajado: lo demás vendido de ese lote (ayer, antes de ayer, cuarto día, última oferta).\nSolo aparece en los días que la caja ya registra la tarjeta (caja v2.2.0). Antes no se muestra: no se estima por precio.',
  agotado: 'Hora en que se vendió lo último del lote de hoy (caja v2.2.0). Si después se volvió a ingresar y se agotó de nuevo, la segunda hora.',
  costo: 'Costo directo de la receta (Finanzas → Costos → Productos, neto por unidad) por las unidades. Solo administración.',
  pisos: 'Un mínimo opcional por tienda, día y tipo de pan: la propuesta de esa tienda no baja de ese número.\nVacío = sin piso. Cada cambio queda en el historial (quién, cuándo, antes → después).\nEl sistema avisa cuando los datos sugieren cambiarlo:\n· subir: en 2 o más de las últimas 4 semanas se vendió todo (o se agotó) con el piso o menos;\n· bajar: el piso pasa la mediana de lo vendido y en 3 o más semanas la merma fue de 20 % o más.',
  lecturas: 'Lo leído para armar esta pantalla, por base (documentos). Queda en memoria mientras la app está abierta (hasta 6 horas): cambiar de pestaña o de semana no vuelve a leer. "Actualizar" lo lee de nuevo.\nLo de Cocina y Finanzas usa la memoria compartida con Producción y Finanzas: lo que ya leyeron no se vuelve a leer.',
  sinAsociar: 'Productos de la caja con área Panadería y productos de B2B pedidos en estas semanas que no tienen vínculo en Finanzas. Mientras no se asocien no entran en el plan.\n"Asociar" abre Finanzas → Márgenes → Asociar productos con ese producto.\nLos que dicen "Receta pendiente" son productos del Catálogo de Panadería que se venden sin receta aprobada todavía: son pan sin tipo (no se sabe de qué receta), así que no entran en el plan. "Unir con su receta" los lleva al Catálogo.'
};

// v0.77.1: es una pestaña de Producción (la cabecera y las pestañas de Producción van arriba); aquí, su título y sus botones
const cab = H => `<div class="titulo-fila pp-cab"><div><h2 id="t-planpan">Plan de Panadería ${H.info('Plan de Panadería', 'Etapa 1: solo lectura, salvo la tabla de Ainavillo y los pisos. La propuesta de la semana se mira el viernes (esa tarde se hace la masa madre para el lunes).')}</h2><p class="ayuda" style="margin:2px 0 0">Etapa 1 · solo lectura, salvo la tabla de Ainavillo y los pisos</p></div>
  <div class="botones pp-acc" style="margin:0"><button type="button" class="btn-sec btn-chico" id="pp-actualizar">Actualizar</button>
  <button type="button" class="btn-sec btn-chico" id="pp-copiar">${H.icono('copias', 16)} Copiar como texto</button>
  <button type="button" class="btn-sec btn-chico" id="pp-imprimir">${H.icono('nota', 16)} Imprimir (viernes)</button></div></div>`;
const pestanas = () => `<nav class="pp-tabs" aria-label="Plan de Panadería">${TABS.map(([k, t]) => `<a class="bj-filtro" href="#produccion/plan-pan${k ? '/' + k : ''}" ${tabActual() === k ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

export async function pintar(el, H) {
  if (!el.dataset.pp) { el.dataset.pp = '1'; el.addEventListener('click', ev => clic(ev, el, H)); el.addEventListener('change', ev => cambio(ev, el, H)); }
  if (S.D && !S.cargando) return dibujar(el, H);
  el.innerHTML = cab(H) + pestanas() + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo la caja, B2B, Cocina y Finanzas…</div></section>';
  await cargar(el, H, false);
}
async function cargar(el, H, forzar) {
  S.cargando = true; S.err = '';
  try {
    if (forzar) PP.reiniciarUso();
    S.D = await PP.cargar({ forzar, lunesExtra: S.extra });
    S.prop = PP.propuesta(S.D);
    if (!S.semana) S.semana = PM.sumarDias(PM.lunesDe(S.D.hoy), -7);
    S.dia = Math.max(0, Math.min(6, S.dia));
  } catch (e) { S.err = (e && e.message) || H.mensajeError(e); }
  S.cargando = false;
  if (!/^#produccion\/plan-pan/.test(location.hash)) return;
  if (!S.D) { el.innerHTML = cab(H) + pestanas() + `<section class="tarjeta"><p class="error" role="alert">${H.esc(S.err)}</p></section>`; return; }
  dibujar(el, H);
}

function avisos(H) {
  const D = S.D, a = [];
  if (D.estados.gastos !== 'ok') a.push('Finanzas (fen-gastos) no está conectada: sin los vínculos producto → receta no se puede armar el plan. Conéctala en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>.');
  if (D.estados.b2b !== 'ok') a.push('B2B (fen-b2b) no está conectada: la columna B2B va en 0. Conéctala en <a href="#b2b/base">Ventas a empresas → Base nueva</a>.');
  if (D.estados.cocina !== 'ok') a.push('Cocina (fen-produccion) no está conectada: sin lo producido ni la masa madre. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.');
  if (S.err) a.push(H.esc(S.err));
  return a.map(x => `<p class="aviso">${x}</p>`).join('');
}
function pieLecturas(H) {
  const u = S.D.uso;
  return `<p class="ayuda pp-lect" id="pp-lecturas">Lecturas para armar esta pantalla: caja ${n(u.ventas)} · B2B ${n(u.b2b)} · Cocina ${n(u.produccion)} · Finanzas ${n(u.gastos)} ${H.info('Lecturas', TXT.lecturas)}</p>`;
}
function dibujar(el, H) {
  const t = tabActual();
  const cuerpo = t === 'como' ? htmlComo(H) : t === 'fijos' ? htmlFijos(H) : htmlPropuesta(H);
  el.innerHTML = cab(H) + pestanas() + avisos(H) + (S.msg ? `<p class="ok-texto" role="status" id="pp-msg">${H.esc(S.msg)}</p>` : '') + cuerpo + pieLecturas(H);
  S.msg = '';
}

// ═══ Días (pastillas) ═══
const pastillasDias = (fechas, extra) => `<div class="pp-dias" role="group" aria-label="Día">${fechas.map((f, i) => `<button type="button" class="bj-filtro pp-dia-b" data-pp-dia="${i}" aria-pressed="${S.dia === i}"><span>${PM.DIAS_CORTOS[i]} ${+f.slice(8, 10)}</span>${extra ? `<span class="bj-num">${extra(i)}</span>` : ''}</button>`).join('')}</div>`;

// ═══ Propuesta próxima semana ═══
function htmlPropuesta(H) {
  const { semana, mm } = S.prop, d = semana[S.dia], m = mm.porDia[d.fecha];
  const nombre = r => H.esc(S.D.nombres[r] || r);
  const b = d.b2b, abierto = k => S.abiertos.has(k);
  const celda = (f, col, v, extra = '') => `<button type="button" class="pp-num" data-pp-ver="${H.esc(f.receta)}|${col}" aria-expanded="${abierto(f.receta + '|' + col)}" aria-label="Ver de dónde sale: ${nombre(f.receta)}, ${col}">${n(v)}</button>${extra}`;
  const filas = d.filas.map(f => {
    const ab = ['b2b', 'barros', 'ainavillo', 'total'].find(c => abierto(f.receta + '|' + c));
    const marca = f.porPisoBarros ? ' <span class="bj-et" title="Manda el piso">piso</span>' : f.sugerencia && f.sugerencia.accion ? ` <span class="bj-et bj-et-revisar" title="${H.esc(f.sugerencia.texto)}">${f.sugerencia.accion === 'subir' ? 'subir piso' : 'bajar piso'}</span>` : '';
    return `<tr data-pp-fila="${H.esc(f.receta)}"><th scope="row">${nombre(f.receta)}</th><td>${celda(f, 'b2b', f.b2b, f.b2bPedido && f.b2bPedido >= f.b2bEstimado ? ' <span class="bj-et bj-et-listo">pedido</span>' : '')}</td><td>${celda(f, 'barros', f.barros, marca)}</td><td>${celda(f, 'ainavillo', f.ainavillo)}</td><td class="pp-tot">${celda(f, 'total', f.total)}</td></tr>
      ${ab ? `<tr class="pp-det"><td colspan="5">${detalle(f, ab, d, H)}</td></tr>` : ''}`;
  }).join('');
  const sum = k => d.filas.reduce((a, f) => a + f[k], 0);
  const mmTxt = !mm.disponible ? 'sin datos de Cocina' : m && (m.blanca || m.integral) ? [m.blanca ? `blanca <b>${g(m.blanca)}</b>` : '', m.integral ? `integral <b>${g(m.integral)}</b>` : ''].filter(Boolean).join(' · ') : 'no lleva';
  return `<section class="tarjeta pp-tarjeta" aria-labelledby="t-pp-dia">
    <div class="pp-barra"><span class="ayuda">Semana del ${H.esc(PM.semanaTxt(semana[0].fecha))} · por día de horneado</span>${pastillasDias(semana.map(x => x.fecha), i => semana[i].sinProduccion ? '—' : n(semana[i].total))}</div>
    <div class="pp-cuerpo">
      <h2 id="t-pp-dia">${H.esc(PM.fechaLarga(d.fecha))}</h2>
      ${d.sinProduccion ? `<p class="pp-pasos">${H.icono('reloj', 16)} El domingo no hay producción: no se hornea. Lo amasado el sábado se hornea el lunes. ${H.info('Proceso', TXT.proceso)}</p>
      ${d.pedidosDomingo ? `<p class="aviso" role="status">Hay órdenes B2B con fecha domingo (${n(d.pedidosDomingo)} panes). Revisa su fecha de entrega en Ventas a empresas.</p>` : ''}`
      : `<p class="pp-pasos">${H.icono('reloj', 16)} Masa madre ${H.esc(PM.fechaCorta(d.masaMadre))}, 19:00${PM.masaMadrePorDueno(d.masaMadre) ? ' (la haces tú)' : ''} · Amasado ${H.esc(PM.fechaCorta(d.amasado))} · Horneado ${H.esc(PM.fechaCorta(d.fecha))} ${H.info('Proceso', TXT.proceso)}</p>
      <p class="pp-mm" id="pp-mm">Masa madre del ${H.esc(PM.fechaCorta(d.masaMadre))}: ${mmTxt} ${H.info('Masa madre', TXT.mm)}</p>`}
      ${d.sinProduccion ? '' : `<details class="pp-clientes" id="pp-clientes" ${S.abiertos.has('clientes') ? 'open' : ''}><summary>De ${n(b.activos)} ${b.activos === 1 ? 'cliente activo' : 'clientes activos'}, se ${b.esperados === 1 ? 'espera' : 'esperan'} ${n(b.esperados)} el ${H.esc(PM.DIAS[d.indice].toLowerCase())} ${H.info('B2B estimado', TXT.b2b)}</summary>
        ${b.clientes.length ? `<ul class="pp-lista">${b.clientes.map(c => `<li><div><b>${H.esc(c.nombre)}</b> <span class="bj-et ${c.seguro ? 'bj-et-listo' : ''}">${c.veces} de 4</span></div><span class="ayuda">${c.recetas.map(r => `${nombre(r.receta)}: usual ${n(r.usual)}${r.veces < 3 ? ` → ${(Math.round(r.estimado * 10) / 10).toLocaleString('es-CL')}` : ''}`).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="ayuda">Ningún cliente pidió pan estos días.</p>'}
        <p class="ayuda">Días mirados: ${b.refs.map(f => H.esc(PM.fechaCorta(f))).join(', ')}.</p></details>`}
      ${d.filas.length ? `<div class="tabla-b2b pp-tw"><table class="tabla-tiempos pp-tabla pp-fija" id="pp-tabla"><colgroup><col class="pp-c-pan"><col><col><col><col class="pp-c-tot"></colgroup><thead><tr><th scope="col">Pan</th><th scope="col"><span class="pp-larga">B2B estimado</span><span class="pp-corta" aria-hidden="true">B2B</span> ${H.info('B2B estimado', TXT.b2b)}</th><th scope="col"><span class="pp-larga">B2C Barros</span><span class="pp-corta" aria-hidden="true">Barros</span> ${H.info('B2C Barros', TXT.barros)}</th><th scope="col"><span class="pp-larga">B2C Ainavillo (fijo)</span><span class="pp-corta" aria-hidden="true">Ainav. fijo</span> ${H.info('B2C Ainavillo', TXT.aina)}</th><th scope="col">Total</th></tr></thead>
        <tbody>${filas}</tbody><tfoot><tr><th scope="row">Total</th><td>${n(sum('b2b'))}</td><td>${n(sum('barros'))}</td><td>${n(sum('ainavillo'))}</td><td class="pp-tot">${n(d.total)}</td></tr></tfoot></table></div>`
        : d.sinProduccion ? '' : '<div class="vacio">Sin pan para este día: no hay ventas ni pedidos en las 4 semanas anteriores, ni cantidades fijas.</div>'}
      <p class="ayuda">Ainavillo aún no registra ventas: cantidades fijas. ${S.D.lotesInfo.corridas ? `· ${n(S.D.lotesInfo.corridas)} ${S.D.lotesInfo.corridas === 1 ? 'merma se corrió' : 'mermas se corrieron'} al lote siguiente ${H.info('Lotes', TXT.lote)}` : ''}</p>
    </div></section>`;
}
const filaRef = (et, x, H) => {
  if (!x || x.sinDatos) return `<tr><th scope="row">${et}</th><td>${x ? H.esc(PM.fechaCorta(x.fecha)) : '—'}</td><td colspan="5" class="ayuda">Sin datos</td></tr>`;
  return `<tr><th scope="row">${et}</th><td>${H.esc(PM.fechaCorta(x.fecha))}</td><td>${n(x.recibido)}</td><td><b>${n(x.vendido)}</b>${x.abierto ? ' <span class="ayuda">(quedan ' + n(x.quedo + x.mermaPend) + ')</span>' : ''}</td><td>${n(x.merma)} <span class="ayuda">(${pct(x.mermaPct)})</span></td>
    <td>${x.registrado ? `${n(x.fresco)} / ${n(x.rebajado)}` : '<span class="ayuda">—</span>'}</td><td>${x.registrado ? (x.agotado ? H.esc(x.agotado) : 'no') : '<span class="ayuda">—</span>'}</td></tr>`;
};
function detalle(f, col, d, H) {
  const nombre = H.esc(S.D.nombres[f.receta] || f.receta);
  if (col === 'b2b') {
    const cs = d.b2b.clientes.map(c => ({ c, r: c.recetas.find(r => r.receta === f.receta) })).filter(x => x.r);
    return `<div class="pp-ref"><p><b>${nombre} · B2B</b>: estimado ${n(f.b2bEstimado)}${f.b2bPedido ? ` · ya pedido ${n(f.b2bPedido)}` : ''}</p>
      ${cs.length ? `<table class="tabla-tiempos"><thead><tr><th scope="col">Cliente</th><th scope="col">Veces</th>${d.b2b.refs.map(x => `<th scope="col">${H.esc(PM.fechaCorta(x))}</th>`).join('')}<th scope="col">Usual</th><th scope="col">Aporta</th></tr></thead><tbody>
        ${cs.map(({ c, r }) => `<tr><th scope="row">${H.esc(c.nombre)}</th><td>${r.veces} de 4</td>${r.cantidades.map(q => `<td>${q === null ? '—' : n(q)}</td>`).join('')}<td>${n(r.usual)}</td><td>${(Math.round(r.estimado * 10) / 10).toLocaleString('es-CL')}</td></tr>`).join('')}</tbody></table>` : '<p class="ayuda">Ningún cliente pidió este pan esos días.</p>'}
      <p class="ayuda">Estimado = suma de "usual" de quienes pidieron 3 o 4 veces + (veces ÷ 4) × usual de los demás.</p></div>`;
  }
  if (col === 'barros') {
    const x = f.detalleBarros, aj = x.ajustes.length ? x.ajustes.map(a => `${signo(a.pct)} % ${H.esc(a.texto.toLowerCase())}`).join(' · ') : 'sin ajustes';
    const cmp = x.comparaMes === null ? '' : ` · ${x.comparaMes < 0 ? '−' + pct(-x.comparaMes) : '+' + pct(x.comparaMes)} frente al mes anterior`;
    const sinReg = x.cuatro.every(r => r.sinDatos || !r.registrado);
    return `<div class="pp-ref"><p><b>${nombre} · Barros Arana</b>: mediana ${x.base === null ? '—' : n(x.base)} (${x.conDatos} de 4 días con datos) · ${aj}${x.pct && x.ajustes.length > 1 ? ` = ${signo(x.pct)} %` : ''} → <b>${x.estimado === null ? '—' : n(x.estimado)}</b>${f.pisoBarros !== null ? ` · piso ${n(f.pisoBarros)}${f.porPisoBarros ? ' (manda el piso)' : ''}` : ''}${cmp}</p>
      <div class="tabla-b2b"><table class="tabla-tiempos pp-reft"><thead><tr><th scope="col">Referencia</th><th scope="col">Día</th><th scope="col">Recibido</th><th scope="col">Vendido ${H.info('Lote', TXT.lote)}</th><th scope="col">Merma</th><th scope="col">Fresco / rebajado ${H.info('Fresco y rebajado', TXT.tarjetas)}</th><th scope="col">Agotado ${H.info('Agotado', TXT.agotado)}</th></tr></thead><tbody>
        ${filaRef('Semana pasada', x.cuatro[0], H)}${x.cuatro.slice(1).map((r, i) => filaRef(`Hace ${i + 2} semanas`, r, H)).join('')}
        ${filaRef('Mes anterior (misma semana)', x.mes, H)}${x.anio ? filaRef('Hace un año', x.anio, H) : ''}</tbody></table></div>
      ${sinReg ? '<p class="ayuda">Fresco y rebajado se verán desde que la caja v2.2.0 esté instalada (solo datos exactos).</p>' : ''}
      ${f.sugerencia && f.sugerencia.accion ? `<p class="aviso">${H.esc(f.sugerencia.texto)} <a href="#produccion/plan-pan/fijos">Revisar pisos</a></p>` : ''}</div>`;
  }
  if (col === 'ainavillo') return `<div class="pp-ref"><p><b>${nombre} · Ainavillo</b>: cantidad fija ${n(f.fijo)}${f.pisoAinavillo !== null ? ` · piso ${n(f.pisoAinavillo)}` : ''}.</p><p class="ayuda">Ainavillo aún no registra ventas: cantidades fijas. Se cambian en <a href="#produccion/plan-pan/fijos">Ainavillo y pisos</a>.</p></div>`;
  return `<div class="pp-ref"><p><b>${nombre}</b>: B2B ${n(f.b2b)} + Barros ${n(f.barros)} + Ainavillo ${n(f.ainavillo)} = <b>${n(f.total)}</b></p></div>`;
}

// ═══ Cómo nos fue ═══
function datosSemana() { return { lotes: S.D.lotes, tarjetas: S.D.tarjetas, producido: S.D.producido, b2b: S.D.b2b, costos: S.D.costos }; }
function htmlComo(H) {
  const D = S.D, sw = PM.semanaPasada(S.semana, datosSemana()), sucs = S.suc === 'todas' ? PM.SUCS : [S.suc];
  const nombre = r => H.esc(D.nombres[r] || r);
  const sumT = (tot, k) => sucs.reduce((a, s) => a + (tot.tiendas[s][k] || 0), 0);
  const filas = sw.filas.map(f => {
    const rec = sumT(f.tot, 'recibido'), mer = sumT(f.tot, 'merma'), ven = sumT(f.tot, 'vendido'), reg = sumT(f.tot, 'diasReg'), fre = sumT(f.tot, 'fresco'), reb = sumT(f.tot, 'rebajado'), ag = sumT(f.tot, 'agotados');
    return { f, rec, mer, ven, reg, fre, reb, ag };
  }).filter(x => x.rec || x.f.tot.producido || x.f.tot.b2b).sort((a, b) => b.rec - a.rec || (D.nombres[a.f.receta] || '').localeCompare(D.nombres[b.f.receta] || '', 'es'));
  const T = filas.reduce((a, x) => ({ rec: a.rec + x.rec, mer: a.mer + x.mer, ven: a.ven + x.ven, reb: a.reb + x.reb, venReg: a.venReg + (x.reg ? sucs.reduce((s, k) => s + x.f.tot.tiendas[k].vendidoReg, 0) : 0), reg: a.reg + x.reg, cm: a.cm + x.f.tot.costoMerma, cp: a.cp + x.f.tot.costoProducido, prod: a.prod + x.f.tot.producido, b2b: a.b2b + x.f.tot.b2b }), { rec: 0, mer: 0, ven: 0, reb: 0, venReg: 0, reg: 0, cm: 0, cp: 0, prod: 0, b2b: 0 });
  const semanas = []; for (let i = 1; i <= 8; i++) semanas.push(PM.sumarDias(PM.lunesDe(D.hoy), -7 * i));
  if (!semanas.includes(S.semana)) semanas.push(S.semana);
  const cifra = (t, v, sub = '', info = '') => `<div class="pp-cifra"><span>${t}${info}</span><b>${v}</b>${sub ? `<span class="ayuda">${sub}</span>` : ''}</div>`;
  const tabla = filas.length ? `<div class="tabla-b2b pp-tw"><table class="tabla-tiempos pp-tabla pp-como" id="pp-como"><thead><tr><th scope="col">Pan</th><th scope="col">Recibido</th><th scope="col">Vendido ${H.info('Lote', TXT.lote)}</th><th scope="col">Merma</th><th scope="col">Fresco / rebajado ${H.info('Fresco y rebajado', TXT.tarjetas)}</th><th scope="col">Agotado ${H.info('Agotado', TXT.agotado)}</th><th scope="col">Producido</th><th scope="col">B2B</th><th scope="col">Costo merma ${H.info('Costo', TXT.costo)}</th></tr></thead><tbody>
    ${filas.map(x => { const k = 'como|' + x.f.receta; return `<tr><th scope="row"><button type="button" class="pp-linkb" data-pp-abrir="${H.esc(k)}" aria-expanded="${S.abiertos.has(k)}">${nombre(x.f.receta)}</button></th><td>${n(x.rec)}</td><td><b>${n(x.ven)}</b></td><td>${n(x.mer)} <span class="ayuda">(${pct(x.rec ? x.mer / x.rec * 100 : null)})</span></td>
      <td>${x.reg ? `${n(x.fre)} / ${n(x.reb)}` : '<span class="ayuda">—</span>'}</td><td>${x.reg ? `${x.ag} de ${x.reg} ${x.reg === 1 ? 'día' : 'días'}` : '<span class="ayuda">—</span>'}</td><td>${x.f.tot.producido ? n(x.f.tot.producido) : '<span class="ayuda">—</span>'}</td><td>${n(x.f.tot.b2b)}</td><td>${x.f.tot.conCosto ? pesos(x.f.tot.costoMerma) : '<span class="ayuda">—</span>'}</td></tr>
      ${S.abiertos.has(k) ? `<tr class="pp-det"><td colspan="9">${porDia(x.f, sucs, H)}</td></tr>` : ''}`; }).join('')}</tbody>
    <tfoot><tr><th scope="row">Total</th><td>${n(T.rec)}</td><td>${n(T.ven)}</td><td>${n(T.mer)} <span class="ayuda">(${pct(T.rec ? T.mer / T.rec * 100 : null)})</span></td><td>${T.reg ? n(T.reb) + ' rebajado' : '—'}</td><td></td><td>${n(T.prod)}</td><td>${n(T.b2b)}</td><td>${pesos(T.cm)}</td></tr></tfoot></table></div>`
    : '<div class="vacio">Sin datos de pan para esta semana.</div>';
  const tend = PM.tendencia(semanas.filter(l => l >= D.desde).sort(), datosSemana());   // solo las semanas ya leídas
  const maxM = Math.max(10, ...tend.map(t => t.mermaPct || 0));
  return `<section class="tarjeta pp-tarjeta" aria-labelledby="t-pp-como">
    <div class="pp-barra"><div class="pp-fila"><label for="pp-semana" class="sr">Semana</label><select id="pp-semana">${semanas.sort().reverse().map(l => `<option value="${l}" ${l === S.semana ? 'selected' : ''}>Semana del ${H.esc(PM.semanaTxt(l))}</option>`).join('')}</select>
      <div class="pp-dias" role="group" aria-label="Tienda">${[['todas', 'Las dos tiendas'], ['barros', 'Barros Arana'], ['ainavillo', 'Ainavillo']].map(([k, t]) => `<button type="button" class="bj-filtro" data-pp-suc="${k}" aria-pressed="${S.suc === k}">${t}</button>`).join('')}</div></div></div>
    <div class="pp-cuerpo"><h2 id="t-pp-como">Cómo nos fue · semana del ${H.esc(PM.semanaTxt(S.semana))}</h2>
      <div class="pp-cifras">${cifra('Recibido en tiendas', n(T.rec))}${cifra('Vendido', n(T.ven), T.rec ? pct(T.ven / T.rec * 100) + ' de lo recibido' : '')}${cifra('Merma', pct(T.rec ? T.mer / T.rec * 100 : null), n(T.mer) + ' unidades')}
        ${cifra('Vendido rebajado', T.reg ? pct(T.venReg ? T.reb / T.venReg * 100 : null) : '—', T.reg ? 'días con caja v2.2.0' : 'desde la caja v2.2.0', H.info('Fresco y rebajado', TXT.tarjetas))}${cifra('Costo de la merma', pesos(T.cm), 'producido ' + pesos(T.cp), H.info('Costo', TXT.costo))}</div>
      ${T.reg ? '' : '<p class="ayuda pp-nota" id="pp-nota-tarjetas">Fresco y rebajado se separan desde que la caja v2.2.0 está instalada. Antes, solo los datos exactos por lote: recibido, vendido y merma.</p>'}
      ${S.suc !== 'barros' && !filas.some(x => x.f.tot.tiendas.ainavillo.recibido) ? '<p class="ayuda">Ainavillo aún no ingresa en su caja el pan que recibe: no tiene datos de lotes.</p>' : ''}
      ${tabla}
      <p class="ayuda">Producido: el plan de Cocina de Panadería (lo amasado un día se hornea al siguiente; lo del sábado, el lunes); "hecho" cuando la jefa lo marcó terminado.</p></div></section>
    <section class="tarjeta" aria-labelledby="t-pp-tend"><h2 id="t-pp-tend">Tendencia semanal ${H.info('Tendencia', '% de merma = merma ÷ recibido en las dos tiendas, por semana (lotes recibidos esa semana).\n% rebajado = lo vendido rebajado ÷ lo vendido, solo en los días con caja v2.2.0.')}</h2>
      <div class="tabla-b2b"><table class="tabla-tiempos pp-tend" id="pp-tend"><thead><tr><th scope="col">Semana</th><th scope="col">% merma</th><th scope="col">% rebajado</th></tr></thead><tbody>
      ${tend.slice().reverse().map(t => `<tr><th scope="row">${H.esc(PM.semanaTxt(t.lunes))}</th><td><span class="pp-barra-h" style="--w:${t.mermaPct === null ? 0 : Math.min(100, t.mermaPct / maxM * 100)}%"></span>${t.recibido ? pct(t.mermaPct) : '<span class="ayuda">sin datos</span>'}</td><td>${t.rebajadoPct === null ? '<span class="ayuda">—</span>' : pct(t.rebajadoPct)}</td></tr>`).join('')}</tbody></table></div></section>
    ${htmlSinAsociar(H)}`;
}
function porDia(f, sucs, H) {
  return `<div class="tabla-b2b"><table class="tabla-tiempos pp-reft"><thead><tr><th scope="col">Día</th><th scope="col">Producido</th><th scope="col">B2B</th>${sucs.length > 1 ? '<th scope="col">Tienda</th>' : ''}<th scope="col">Recibido</th><th scope="col">Vendido</th><th scope="col">Merma</th><th scope="col">Quedó</th><th scope="col">Fresco / rebajado</th><th scope="col">Agotado</th></tr></thead><tbody>
    ${f.porDia.map(d => sucs.map((s, i) => { const x = d.tiendas[s]; return `<tr>${i === 0 ? `<th scope="row" rowspan="${sucs.length}">${H.esc(PM.fechaCorta(d.fecha))}</th><td rowspan="${sucs.length}">${d.producido === null ? '—' : n(d.producido) + (d.hecho ? ' <span class="bj-et bj-et-hecho">hecho</span>' : '')}</td><td rowspan="${sucs.length}">${n(d.b2b)}</td>` : ''}${sucs.length > 1 ? `<td>${PM.NOMBRE_SUC[s]}</td>` : ''}
      ${x ? `<td>${n(x.recibido)}</td><td>${n(x.vendido)}${x.abierto ? ' <span class="ayuda">(abierto)</span>' : ''}</td><td>${n(x.merma)} <span class="ayuda">(${pct(x.mermaPct)})</span>${x.corrida ? ' <span class="ayuda">(corrida)</span>' : ''}</td><td>${n(x.quedo)}</td><td>${x.registrado ? `${n(x.fresco)} / ${n(x.rebajado)}` : '—'}</td><td>${x.registrado ? (x.agotado ? H.esc(x.agotado) + (x.reagotado ? ' y ' + H.esc(x.reagotado) : '') : 'no') : '—'}</td>` : '<td colspan="6" class="ayuda">Sin ingreso</td>'}</tr>`; }).join('')).join('')}</tbody></table></div>`;
}
function htmlSinAsociar(H) {
  const l = S.D.sinAsociar;
  return `<section class="tarjeta" aria-labelledby="t-pp-sin" id="pp-sin"><h2 id="t-pp-sin">Productos sin asociar <span class="chip ${l.length ? 'c-amarillo' : 'c-verde'} chip-chico">${n(l.length)}</span> ${H.info('Productos sin asociar', TXT.sinAsociar)}</h2>
    ${l.some(p => p.pendiente) ? `<p class="ayuda" id="pp-sin-pend">${n(l.filter(p => p.pendiente).length)} con la receta pendiente: pan sin tipo, no entran en el plan hasta que los unas con su receta en el Catálogo.</p>` : ''}
    ${l.length ? `<ul class="pp-lista">${l.map(p => `<li${p.pendiente ? ' data-pp-pend' : ''}><div><b>${H.esc(p.nombre)}</b>${p.pendiente ? ' <span class="chip c-amarillo chip-chico">Receta pendiente</span>' : ''} <span class="ayuda">${p.canal === 'b2b' ? 'B2B' : 'Caja'} · ${H.esc(p.productoId)}${p.cantidad ? ` · ${n(p.cantidad)} vendidos` : ''}</span></div>${p.pendiente ? '<a class="btn-sec btn-chico" href="#catalogo/productos/falta-receta">Unir con su receta</a>' : `<a class="btn-sec btn-chico" href="#finanzas/margenes/asociar/${encodeURIComponent(p.clave)}">${'Asociar'}</a>`}</li>`).join('')}</ul>` : '<p class="ok-texto">Todo el pan vendido y pedido está asociado a su receta.</p>'}</section>`;
}

// ═══ Ainavillo y pisos ═══
function htmlFijos(H) {
  const D = S.D, cfg = D.cfg || {}, rs = D.recetasPan, i = S.dia, fechas = PM.semanaDe(D.lunesProx);
  const semana = S.prop.semana, dia = semana[i];
  const hist = (cfg.historial || []).slice().reverse();
  const sug = r => { const f = dia.filas.find(x => x.receta === r.id); return S.editSuc === 'barros' && f && f.sugerencia && f.sugerencia.accion ? `<span class="bj-et bj-et-revisar">${f.sugerencia.accion === 'subir' ? 'Subir' : 'Bajar'} a ${n(f.sugerencia.sugerido)}</span>` : ''; };
  const sugTxt = r => { const f = dia.filas.find(x => x.receta === r.id); return S.editSuc === 'barros' && f && f.sugerencia && f.sugerencia.accion ? `<span class="ayuda">${H.esc(f.sugerencia.texto)}</span>` : ''; };
  return `<section class="tarjeta pp-tarjeta" aria-labelledby="t-pp-aina">
    <div class="pp-barra">${pastillasDias(fechas)}</div>
    <div class="pp-cuerpo"><h2 id="t-pp-aina">Ainavillo: cantidades fijas · ${H.esc(PM.DIAS[i])} ${H.info('Ainavillo', TXT.aina)}</h2>
      <p class="aviso">Ainavillo aún no registra ventas: cantidades fijas.</p>
      ${rs.length ? `<form id="pp-f-aina" class="pp-form">${rs.map(r => `<div class="pp-in"><label for="pp-a-${H.esc(r.id)}">${H.esc(r.nombre)}</label><input id="pp-a-${H.esc(r.id)}" type="number" min="0" step="1" inputmode="numeric" data-pp-aina="${H.esc(r.id)}" value="${PM.fijoAinavillo(cfg, i, r.id)}"></div>`).join('')}
        <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn" id="pp-g-aina">Guardar Ainavillo (${H.esc(PM.DIAS[i].toLowerCase())})</button></div></form>` : '<div class="vacio">Sin tipos de pan: asocia los productos en Finanzas.</div>'}
    </div></section>
    <section class="tarjeta pp-tarjeta" aria-labelledby="t-pp-pisos">
    <div class="pp-cuerpo"><h2 id="t-pp-pisos">Pisos · ${H.esc(PM.DIAS[i])} ${H.info('Pisos', TXT.pisos)}</h2>
      <div class="pp-dias" role="group" aria-label="Tienda">${PM.SUCS.map(s => `<button type="button" class="bj-filtro" data-pp-esuc="${s}" aria-pressed="${S.editSuc === s}">${PM.NOMBRE_SUC[s]}</button>`).join('')}</div>
      ${rs.length ? `<form id="pp-f-pisos" class="pp-form">${rs.map(r => { const v = PM.pisoDe(cfg, S.editSuc, i, r.id); return `<div class="pp-in"><label for="pp-p-${H.esc(r.id)}">${H.esc(r.nombre)} ${sug(r)}</label><input id="pp-p-${H.esc(r.id)}" type="number" min="0" step="1" inputmode="numeric" placeholder="Sin piso" data-pp-piso="${H.esc(r.id)}" value="${v === null ? '' : v}">${sugTxt(r)}</div>`; }).join('')}
        <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn" id="pp-g-pisos">Guardar pisos de ${H.esc(PM.NOMBRE_SUC[S.editSuc])} (${H.esc(PM.DIAS[i].toLowerCase())})</button></div></form>` : ''}
      <p class="error" id="pp-f-err" role="alert"></p>
    </div></section>
    <section class="tarjeta" aria-labelledby="t-pp-hist"><details id="pp-hist"><summary><h2 id="t-pp-hist" style="display:inline">Historial <span class="chip c-gris chip-chico">${n(hist.length)}</span></h2></summary>
      ${hist.length ? `<ul class="pp-lista">${hist.slice(0, 60).map(h => `<li><div><b>${h.tipo === 'ainavillo' ? 'Ainavillo (fijo)' : 'Piso ' + H.esc(PM.NOMBRE_SUC[h.suc] || h.suc)}</b> · ${H.esc(PM.DIAS[h.dia] || '')} · ${H.esc(D.nombres[h.receta] || h.receta)}: ${h.antes === null ? 'sin piso' : n(h.antes)} → ${h.despues === null ? 'sin piso' : n(h.despues)}</div><span class="ayuda">${H.esc(h.por)} · ${H.esc(String(h.en || '').slice(0, 16).replace('T', ' '))}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios todavía.</p>'}</details></section>`;
}
async function guardar(form, tipo, el, H) {
  const D = S.D, i = S.dia, cambios = [];
  form.querySelectorAll(tipo === 'ainavillo' ? '[data-pp-aina]' : '[data-pp-piso]').forEach(inp => {
    const r = tipo === 'ainavillo' ? inp.dataset.ppAina : inp.dataset.ppPiso, v = inp.value.trim();
    if (v !== '' && !(Number(v) >= 0)) return;
    const actual = tipo === 'ainavillo' ? PM.fijoAinavillo(D.cfg, i, r) : PM.pisoDe(D.cfg, S.editSuc, i, r);
    const nuevo = v === '' ? (tipo === 'ainavillo' ? 0 : null) : Math.round(Number(v));
    if (nuevo !== actual) cambios.push({ tipo, suc: S.editSuc, dia: i, receta: r, valor: nuevo });
  });
  const err = $('pp-f-err'); if (err) err.textContent = '';
  if (!cambios.length) { S.msg = 'No había cambios.'; dibujar(el, H); return; }
  const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const entradas = await PP.guardarCambios(cambios);
    H.registrar(tipo === 'ainavillo' ? 'Plan de Panadería: cambió la tabla de Ainavillo' : 'Plan de Panadería: cambió los pisos', entradas.map(e => `${PM.DIAS_CORTOS[e.dia]} ${D.nombres[e.receta] || e.receta}: ${e.antes === null ? '—' : e.antes} → ${e.despues === null ? '—' : e.despues}`).join(' · '));
    D.cfg = await PP.leerConfig(true);
    S.prop = PP.propuesta(D);
    S.msg = `Guardado: ${entradas.length} ${entradas.length === 1 ? 'cambio' : 'cambios'} (quedan en el historial).`;
    dibujar(el, H);
  } catch (e) { btn.disabled = false; btn.textContent = 'Guardar'; const er = $('pp-f-err'); if (er) er.textContent = /permission/i.test((e && e.code) || '') ? 'La caja (fen-ventas) no dejó guardar: tu cuenta tiene que estar en admins.' : ((e && e.message) || H.mensajeError(e)); }
}

// ═══ Copiar e imprimir ═══
async function copiar(H, btn) {
  const txt = PM.textoPropuesta(S.prop.semana, S.D.nombres, S.prop.mm);
  let ok = false;
  window.__ppTexto = txt;
  try { await Promise.race([navigator.clipboard.writeText(txt), new Promise((_, no) => setTimeout(() => no(new Error('sin respuesta')), 1500))]); ok = true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (x) { ok = false; }
  }
  btn.lastChild.textContent = ok ? ' Copiado' : ' No se pudo copiar';
  setTimeout(() => { if (btn.isConnected) btn.lastChild.textContent = ' Copiar como texto'; }, 2500);
}
export function htmlImprimir(H) {
  const { semana, mm } = S.prop, nombre = r => H.esc(S.D.nombres[r] || r);
  return `<div class="pp-hoja"><h1>Plan de Panadería · semana del ${H.esc(PM.semanaTxt(semana[0].fecha))}</h1><p>Propuesta (Etapa 1) · impreso el ${H.esc(PM.fechaLarga(S.D.hoy))} · Ainavillo: cantidades fijas</p>
    ${semana.map(d => { const m = mm.porDia[d.fecha]; if (d.sinProduccion) return `<section class="pp-hoja-dia"><h2>${H.esc(PM.fechaLarga(d.fecha))} <small>sin horneado (el domingo no hay producción)</small></h2></section>`; return `<section class="pp-hoja-dia"><h2>${H.esc(PM.fechaLarga(d.fecha))} <small>amasado ${H.esc(PM.fechaCorta(d.amasado))} · masa madre ${H.esc(PM.fechaCorta(d.masaMadre))} 19:00${PM.masaMadrePorDueno(d.masaMadre) ? ` (${PM.QUIEN_DOMINGO})` : ''}${m && (m.blanca || m.integral) ? `: ${m.blanca ? 'blanca ' + g(m.blanca) : ''}${m.blanca && m.integral ? ' · ' : ''}${m.integral ? 'integral ' + g(m.integral) : ''}` : ''}</small></h2>
      ${d.filas.length ? `<table><thead><tr><th>Pan</th><th>B2B</th><th>Barros</th><th>Ainavillo</th><th>Total</th></tr></thead><tbody>${d.filas.map(f => `<tr><td>${nombre(f.receta)}</td><td>${n(f.b2b)}</td><td>${n(f.barros)}</td><td>${n(f.ainavillo)}</td><td><b>${n(f.total)}</b></td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td></td><td></td><td></td><td><b>${n(d.total)}</b></td></tr></tfoot></table>` : '<p>Sin pan propuesto.</p>'}</section>`; }).join('')}</div>`;
}
function imprimir(H) {
  let c = $('pp-imprimir-hoja');
  if (!c) { c = document.createElement('div'); c.id = 'pp-imprimir-hoja'; document.body.appendChild(c); }
  c.innerHTML = htmlImprimir(H);
  document.body.classList.add('pp-imprimiendo');
  const fin = () => { document.body.classList.remove('pp-imprimiendo'); window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  try { window.print(); } catch (e) {}
  if (window.__ppSinImprimir) return;   // pruebas: dejan la hoja puesta para revisarla
  setTimeout(fin, 1000);
}

// ═══ Eventos ═══
async function clic(ev, el, H) {
  const t = ev.target.closest('button, a'); if (!t || !el.contains(t)) return;
  if (t.id === 'pp-actualizar') { el.innerHTML = cab(H) + pestanas() + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Leyendo de nuevo…</div></section>'; await cargar(el, H, true); return; }
  if (!S.D) return;
  if (t.id === 'pp-copiar') return copiar(H, t);
  if (t.id === 'pp-imprimir') return imprimir(H);
  if (t.dataset.ppDia !== undefined) { S.dia = +t.dataset.ppDia; return dibujar(el, H); }
  if (t.dataset.ppSuc) { S.suc = t.dataset.ppSuc; return dibujar(el, H); }
  if (t.dataset.ppEsuc) { S.editSuc = t.dataset.ppEsuc; return dibujar(el, H); }
  if (t.dataset.ppVer) {
    const [r] = t.dataset.ppVer.split('|'), k = t.dataset.ppVer, ya = S.abiertos.has(k);
    ['b2b', 'barros', 'ainavillo', 'total'].forEach(c => S.abiertos.delete(r + '|' + c));
    if (!ya) S.abiertos.add(k);
    dibujar(el, H); const b = el.querySelector(`[data-pp-ver="${CSS.escape(k)}"]`); if (b) b.focus(); return;
  }
  if (t.dataset.ppAbrir) { const k = t.dataset.ppAbrir; if (S.abiertos.has(k)) S.abiertos.delete(k); else S.abiertos.add(k); dibujar(el, H); const b = el.querySelector(`[data-pp-abrir="${CSS.escape(k)}"]`); if (b) b.focus(); }
}
async function cambio(ev, el, H) {
  const t = ev.target;
  if (t.id === 'pp-semana') {
    S.semana = t.value;
    if (S.semana < S.D.desde) { S.extra = [S.semana]; el.querySelector('.pp-cuerpo').innerHTML = '<div class="vacio" role="status">Leyendo esa semana…</div>'; await cargar(el, H, false); return; }
    dibujar(el, H);
  }
}
document.addEventListener('submit', ev => {
  const f = ev.target; if (!f || (f.id !== 'pp-f-aina' && f.id !== 'pp-f-pisos')) return;
  ev.preventDefault();
  const el = document.getElementById('v-produccion');
  guardar(f, f.id === 'pp-f-aina' ? 'ainavillo' : 'piso', el, window.__ppH);
});
export function fijarH(H) { window.__ppH = H; }
// "Clientes" abierto o cerrado se recuerda al volver a dibujar
document.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'pp-clientes') { if (ev.target.open) S.abiertos.add('clientes'); else S.abiertos.delete('clientes'); } }, true);
export const estado = S;
