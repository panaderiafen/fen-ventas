// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Flujo de caja (pantalla)  v0.124.0
//  Tres pestañas: Semanas (#finanzas/flujo), Lo que viene (#finanzas/flujo/viene) y Cuadre (#finanzas/flujo/cuadre).
//  Reglas en flujo-modelo.js; datos y escrituras en flujo-fs.js. H = ayudas de app.js { esc, info, registrar, mensajeError, dialogo }.
// ═══════════════════════════════════════════════
import * as M from './flujo-modelo.js?v=0.138.0';
import * as FF from './flujo-fs.js?v=0.138.0';

const K_MODO = 'fen_flujo_modo';
const leerModo = () => { try { return localStorage.getItem(K_MODO) === 'meta' ? 'meta' : 'estimado'; } catch (e) { return 'estimado'; } };
const st = { atras: 4, modo: leerModo(), d: null, err: '', msg: '' };
const $ = id => document.getElementById(id);
const pesos = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-CL'); };
const enFlujo = () => /^#finanzas\/flujo/.test(location.hash || '');
const ESTADO = { fecha: ['Por fecha', 'c-gris'], estimado: ['Estimado', 'c-amarillo'], movido: ['Movido', 'c-azul'] };
const TXT_INFO = 'Real: lo que ya entró o salió (cargos y abonos de las cartolas, Mercado Pago, las ventas de cada cierre y el efectivo). Esperado: lo que viene (documentos por pagar, compromisos, sueldos, Previred, F29, cuotas del crédito, cobros de empresas y ventas estimadas).\nLa semana de hoy junta lo real hasta hoy y lo esperado hasta el domingo. Lo atrasado (un pago o cobro con fecha pasada que todavía no pasa) se cuenta hoy.\nLos traspasos entre cuentas propias no son entrada ni salida: de Mercado Pago al banco, los depósitos de efectivo, de la chequera a la cuenta corriente, el retiro de una caja a la caja de administración y el sencillo.\nLa tarjeta de crédito es deuda: lo que se compra con ella no sale; sale el pago de la tarjeta.\nLas ventas por transferencia en la tienda llegan como abono al banco (Otros ingresos).\nMercado Pago: las ventas con tarjeta quedan disponibles el mismo día (se puede cambiar en Configuración). Se usa el reporte de Mercado Pago (sin la comisión); un día sin reporte usa la caja menos la comisión promedio.';

export async function pintar(el, parte, H, ctx) {
  el.innerHTML = ctx.cab('flujo') + cabFlujo(parte, H) + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Abriendo el flujo de caja…</div></section>';
  try { st.d = await FF.cargar(); st.err = ''; }
  catch (e) {
    if (!enFlujo()) return;
    if (e && e.code === 'sin_base') { el.innerHTML = ctx.cab('flujo') + cabFlujo(parte, H) + `<section class="tarjeta"><h2>El flujo de caja usa la base nueva de Gastos</h2><p class="ayuda">Se conecta en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>; después vuelva aquí.</p></section>`; return; }
    el.innerHTML = ctx.cab('flujo') + cabFlujo(parte, H) + `<section class="tarjeta"><p class="error" role="alert">No se pudo abrir el flujo de caja (${H.esc(ctx.error(e, H))}). Revise la conexión y presione Actualizar.</p><button type="button" class="btn-sec" id="fl-act">Actualizar</button></section>`;
    const b = $('fl-act'); if (b) b.onclick = () => { FF.olvidar(); pintar(el, parte, H, ctx); };
    return;
  }
  if (!enFlujo()) return;
  dibujar(el, parte, H, ctx);
}
const parteDeHash = () => { const p = (location.hash || '').split('/'); return p[2] === 'viene' ? 'viene' : p[2] === 'cuadre' ? 'cuadre' : 'semanas'; };
function cabFlujo(parte, H) {
  const p = (k, href, t) => `<a class="pastilla" href="${href}" aria-current="${parte === k ? 'page' : 'false'}" aria-pressed="${parte === k}">${t}</a>`;
  return `<section class="fl-intro" aria-labelledby="t-flujo"><div class="fl-tit"><h2 id="t-flujo">Flujo de caja ${H.info('Flujo de caja', TXT_INFO)}</h2>
    <p class="ayuda">La plata que entra y sale, semana a semana: lo real y lo que viene.</p></div>
    <div class="pastillas fin-sub" role="group" aria-label="Partes del flujo de caja">${p('semanas', '#finanzas/flujo', 'Semanas')}${p('viene', '#finanzas/flujo/viene', 'Lo que viene')}${p('cuadre', '#finanzas/flujo/cuadre', 'Cuadre')}</div></section>`;
}

// ── El cálculo (de lo ya leído: no gasta lecturas) ──
function calcular({ atras = st.atras } = {}) {
  const d = st.d, hoy = M.hoyChile(), cfg = d.config, ini = d.ini;
  const { lista, hayAntes } = M.semanas({ hoy, inicio: ini, atras, adelante: cfg.adelante });
  const R = M.reales({ gn: d.gn, abonos: d.abonos, evals: d.evals, cmovs: d.cmovs, efmovs: d.efmovs, mpVentas: d.mpVentas }, { inicio: ini, mpDias: cfg.mpDias, apertura: cfg.apertura });
  const hasta = lista[lista.length - 1].domingo, gn = d.gn, ctxDoc = { catalogo: gn.catalogo, provs: gn.provs, repartos: gn.repartos };
  let esp = [].concat(
    M.esperadosDocs(gn, { hoy }), M.esperadosCompromisos(gn.compromisos, gn.docs, { hoy, hasta, ctx: ctxDoc }), M.esperadosCuotas(gn.creditos, gn.docs, { hoy, hasta }),
    M.esperadosSueldos(gn.docs, { hoy, hasta }), M.esperadosPrevired(gn.docs, { hoy, hasta }), M.esperadosF29(gn.docs, { hoy, hasta, cierres: d.evals, ordenes: d.ordenes }),
    M.esperadosCobros(d.porCliente, d.clientes, { hoy }), M.esperadosVentas(d.evals, d.mpVentas, { hoy, hasta, metas: d.metas, modo: st.modo, inicio: ini }));
  esp = M.aplicarAjustes(esp, d.ajustes);
  const A = M.armar({ apertura: cfg.apertura, reales: R.movs, esperados: esp, hoy, lista, metas: d.metas });
  return { hoy, lista, hayAntes, R, A, esp };
}

function dibujar(el, parte, H, ctx) {
  let C; try { C = calcular(); } catch (e) { console.error('Flujo de caja', e); el.innerHTML = ctx.cab('flujo') + cabFlujo(parte, H) + `<section class="tarjeta"><p class="error" role="alert">No se pudo calcular el flujo (${H.esc(e.message || String(e))}).</p></section>`; return; }
  const cuerpo = parte === 'viene' ? htmlViene(C, H) : parte === 'cuadre' ? htmlCuadre(C, H) : htmlSemanas(C, H);
  el.innerHTML = ctx.cab('flujo') + cabFlujo(parte, H) + (st.msg ? `<p class="ok-texto fl-msg" role="status">${H.esc(st.msg)}</p>` : '') + cuerpo;
  st.msg = '';
  const volver = () => dibujar(el, parteDeHash(), H, ctx);
  const act = $('fl-act'); if (act) act.onclick = async () => { act.disabled = true; act.textContent = 'Actualizando…'; FF.olvidar(); await pintar(el, parteDeHash(), H, ctx); };
  const cf = $('fl-config'); if (cf) cf.onclick = () => dialogoConfig(H, volver);
  if (parte === 'semanas') conectarSemanas(el, C, H, volver);
  if (parte === 'viene') conectarViene(el, C, H, volver);
  if (parte === 'cuadre') conectarCuadre(el, C, H);
}
const barra = (H, extra = '') => `<div class="fl-barra">${extra}<span class="fl-barra-der"><button type="button" class="btn-sec btn-chico" id="fl-act">Actualizar</button><button type="button" class="btn-sec btn-chico" id="fl-config">Configuración</button></span></div>`;

// ═══════════════ Semanas ═══════════════
function htmlSemanas(C, H) {
  const A = C.A, d = A.disponible, n = st.d.config.adelante;
  const cifra = (rot, val, nota, cls = '') => `<div class="cifra tarjeta fl-cifra ${cls}"><span class="rotulo">${rot}</span><span class="valor">${val}</span><span class="nota">${nota}</span></div>`;
  const cifras = `<div class="cifras cifras-4 fl-cifras">
    ${cifra('Plata disponible hoy', pesos(d.total), `Banco ${pesos(d.banco)} · Mercado Pago ${pesos(d.porCuenta.mp)} · Efectivo ${pesos(d.porCuenta.efectivo)}${d.camino ? ` · en camino ${pesos(d.camino)}` : ''}`)}
    ${cifra('Por cobrar a empresas', pesos(A.porCobrar), `En las próximas ${n} semanas (con lo atrasado)`)}
    ${cifra('Por pagar', pesos(A.porPagar), `En las próximas ${n} semanas (con lo atrasado)`)}
    ${A.rojo ? cifra('Primera semana en rojo', H.esc(A.rojo.semana.etiqueta), `Termina con ${pesos(A.rojo.semana.fin)}. ${H.esc(A.rojo.razon)}`, 'fl-cifra-rojo') : cifra('Primera semana en rojo', 'Ninguna', `Ninguna semana termina bajo $0 en las próximas ${n}.`)}</div>`;
  const modo = `<div class="pastillas fl-modo" role="group" aria-label="Ventas que vienen"><span class="fl-modo-t">Ventas que vienen:</span>
    <button type="button" class="pastilla" data-fl-modo="estimado" aria-pressed="${st.modo === 'estimado'}">Estimado</button><button type="button" class="pastilla" data-fl-modo="meta" aria-pressed="${st.modo === 'meta'}">Meta</button>
    ${H.info('Ventas que vienen', 'Estimado: por tienda, el promedio del mismo día de la semana de las últimas 4 semanas (efectivo más tarjeta, sin la comisión).\nMeta: la meta de venta de la semana de cada tienda (se pone en Lo que viene), repartida en los días como el promedio. Si una tienda no tiene meta, se usa el promedio.')}</div>`;
  const antes = C.hayAntes ? `<button type="button" class="btn-sec btn-chico" id="fl-antes">Ver 4 semanas antes</button>` : '';
  return `${cifras}<section class="tarjeta fl-semanas" aria-labelledby="t-fl-sem"><div class="titulo-fila"><h2 id="t-fl-sem">Semana a semana</h2><span>Lunes a domingo</span></div>
    ${barra(H, modo + antes)}${tablaSemanas(C, H)}${notasDatos(C, H)}</section>`;
}
function tablaSemanas(C, H) {
  const W = C.A.semanas, vis = C.A.visibles, sub = { pasada: 'real', actual: 'esta semana', futura: 'esperado' };
  const celda = (w, i, k) => { const f = w.filas[k], v = f.real + f.esp, hay = f.movs.length || f.items.length;
    const meta = k === 'ventas' && w.meta && w.tipo !== 'futura' ? `<small class="fl-meta">meta ${pesos(w.meta)}</small>` : '';
    return `<td class="fl-${w.tipo}">${hay ? `<button type="button" class="fl-celda" data-fl-c="${i}|${k}" aria-label="${H.esc(M.FILAS[k])}, ${H.esc(w.etiqueta)}: ${pesos(v)}. Ver el detalle">${pesos(v)}</button>` : '<span class="fl-cero">—</span>'}${meta}</td>`; };
  const filas = (lado, t) => { const ks = lado.map(x => x[0]).filter(k => vis.includes(k)); if (!ks.length) return '';
    return `<tr class="fl-grupo"><th scope="row">${t}</th>${W.map(w => `<td class="fl-${w.tipo}"><b>${pesos(lado === M.ENTRA ? w.entra : w.sale)}</b></td>`).join('')}</tr>`
      + ks.map(k => `<tr><th scope="row" class="fl-fila">${H.esc(M.FILAS[k])}</th>${W.map((w, i) => celda(w, i, k)).join('')}</tr>`).join(''); };
  return `<div class="tabla-b2b fl-tabla-c" tabindex="0" role="region" aria-label="Flujo semana a semana (se desliza de lado)"><table class="tabla-tiempos fin-estado fl-tabla" id="fl-tabla"><caption class="sr">Flujo de caja por semana</caption>
    <thead><tr><th scope="col">Semana</th>${W.map(w => `<th scope="col" class="fl-${w.tipo}"><span>${H.esc(w.etiqueta)}</span><small>${sub[w.tipo]}</small></th>`).join('')}</tr></thead>
    <tbody><tr class="fl-saldo"><th scope="row">Saldo al empezar</th>${W.map(w => `<td class="fl-${w.tipo}${w.ini < 0 ? ' fl-neg' : ''}">${pesos(w.ini)}</td>`).join('')}</tr>
    ${filas(M.ENTRA, 'Entra')}${filas(M.SALE, 'Sale')}
    <tr class="fl-saldo fl-fin"><th scope="row">Saldo al terminar</th>${W.map(w => `<td class="fl-${w.tipo}${w.fin < 0 ? ' fl-neg' : ''}"><b>${pesos(w.fin)}</b></td>`).join('')}</tr></tbody></table></div>`;
}
function notasDatos(C, H) {
  const f = st.d.faltan || {}, l = [], R = C.R.info;
  if (f.b2b) l.push(`Ventas a empresas: sin datos (${H.esc(f.b2b)}). Los abonos y los cobros que vienen no están.`);
  else if (f.cobros) l.push(H.esc(f.cobros));
  if (f.ventas) l.push(`La caja y Efectivo: sin datos (${H.esc(f.ventas)}).`);
  if (f.mp) l.push('El reporte de Mercado Pago no se pudo leer: la tarjeta sale de la caja menos la comisión promedio.');
  if (R.cardEstimada) l.push(`${pesos(R.cardEstimada)} de ventas con tarjeta salen de la caja (días sin el reporte de Mercado Pago), menos la comisión promedio.`);
  if (R.conteoInicial && R.conteoInicial.ajuste) l.push(`El conteo inicial de la caja de administración (${M.diaTxt(R.conteoInicial.dia)}) dejó el efectivo del sistema igual a lo contado: ${pesos(R.conteoInicial.ajuste)} en "Efectivo sin anotar" (lo de antes que no quedó anotado: retiros, depósitos o pagos en efectivo de octubre).`);
  const sd = C.esp.filter(x => x.sinDatos); if (sd.length) l.push(`Sin datos para estimar: ${sd.map(x => H.esc(x.que.split(' · ')[0])).join(', ')}.`);
  if (C.A.sinFecha.length) l.push(`${C.A.sinFecha.length} ${C.A.sinFecha.length === 1 ? 'pago o cobro esperado no tiene' : 'pagos o cobros esperados no tienen'} fecha (${pesos(C.A.sinFecha.reduce((a, x) => a + x.monto, 0))}): no suman en las semanas. Están en <a href="#finanzas/flujo/viene">Lo que viene</a>.`);
  if (R.sinRevisarCargos.length) l.push(`${R.sinRevisarCargos.length} ${R.sinRevisarCargos.length === 1 ? 'cargo sin revisar' : 'cargos sin revisar'} en Gastos van en Otros pagos.`);
  if (R.abonosPendientes.length) l.push(`${R.abonosPendientes.length} ${R.abonosPendientes.length === 1 ? 'abono sin revisar' : 'abonos sin revisar'} en Conciliación van en Otros ingresos.`);
  return l.length ? `<ul class="fl-notas">${l.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
}
function conectarSemanas(el, C, H, volver) {
  el.querySelectorAll('[data-fl-modo]').forEach(b => b.addEventListener('click', () => { st.modo = b.dataset.flModo; try { localStorage.setItem(K_MODO, st.modo); } catch (e) {} volver(); }));
  const an = $('fl-antes'); if (an) an.onclick = () => { st.atras += 4; volver(); };
  // La tabla parte mostrando la semana de hoy (en el celular, las pasadas quedan a la izquierda: se deslizan)
  const caja = el.querySelector('.fl-semanas .fl-tabla-c'), th = caja && caja.querySelector('thead th.fl-actual'), th0 = caja && caja.querySelector('thead th');
  if (caja && th && th0 && caja.scrollWidth > caja.clientWidth) caja.scrollLeft = Math.max(0, th.offsetLeft - th0.offsetWidth - (th.previousElementSibling ? th.previousElementSibling.offsetWidth : 0));
  el.querySelectorAll('[data-fl-c]').forEach(b => b.addEventListener('click', () => { const [i, k] = b.dataset.flC.split('|'); dialogoCelda(C.A.semanas[Number(i)], k, H); }));
}
const lineaMov = (m, H) => `<li><span><b>${H.esc(M.diaTxt(m.fecha))}</b> · ${H.esc(m.texto)} <small>${H.esc(M.CUENTAS[m.cuenta] || '')}</small>${m.link ? ` <a href="${m.link}">Ver</a>` : ''}</span><b class="nowrap">${pesos(M.esEntra(m.fila) ? m.monto : -m.monto)}</b></li>`;
const chipEstado = x => { const e = ESTADO[x.estado] || ESTADO.fecha; return `<span class="chip ${e[1]}">${e[0]}</span>${x.atrasado ? ' <span class="chip c-rojo">Atrasado</span>' : ''}`; };
const lineaEsp = (x, H) => `<li><span><b>${H.esc(x.fechaEf ? M.diaTxt(x.fechaEf) : 'sin fecha')}</b> · ${H.esc(x.que)}${x.atrasado ? ` <small>(era el ${H.esc(M.diaTxt(x.fecha))})</small>` : ''} ${chipEstado(x)}</span><b class="nowrap">${pesos(x.monto)}</b></li>`;
function dialogoCelda(w, k, H) {
  const f = w.filas[k], tot = f.real + f.esp;
  const d = H.dialogo(`<div class="form-dialogo fl-det"><h2>${H.esc(M.FILAS[k])} · ${H.esc(w.etiqueta)}</h2>
    ${f.movs.length ? `<h3>Real <small>${pesos(f.real)}</small></h3><ul class="fl-lista">${f.movs.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(m => lineaMov(m, H)).join('')}</ul>` : ''}
    ${f.items.length ? `<h3>Esperado <small>${pesos(f.esp)}</small></h3><ul class="fl-lista">${f.items.map(x => lineaEsp(x, H)).join('')}</ul><p class="ayuda">Para mover una fecha o anotar algo, vaya a <a href="#finanzas/flujo/viene">Lo que viene</a>.</p>` : ''}
    <p class="fl-det-tot">Total <b>${pesos(tot)}</b></p>
    <div class="botones"><button type="button" class="btn" id="fl-det-ok">Cerrar</button></div></div>`);
  d.querySelector('#fl-det-ok').onclick = () => d.close();
  d.querySelectorAll('a').forEach(a => a.addEventListener('click', () => d.close()));
}

// ═══════════════ Lo que viene ═══════════════
function htmlViene(C, H) {
  const A = C.A, W = A.semanas.filter(w => w.tipo !== 'pasada'), porSem = {};
  A.esperados.forEach(x => { const l = M.lunesDe(x.fechaEf); (porSem[l] = porSem[l] || []).push(x); });
  const rev = C.esp.filter(x => x.revisar && !x.revisado && x.fecha >= C.hoy);
  const aviso = rev.map(x => `<div class="aviso fl-revisar"><b>Revisar sueldos de ${H.esc(M.mesTxt(x.revisar))}</b>: ${pesos(x.monto)} esperado el ${H.esc(M.diaLargo(x.fecha))}, como la última liquidación. Ajuste bonos, horas extra, entradas y salidas. <button type="button" class="btn-sec btn-chico" data-fl-rev="${H.esc(x.clave)}">Revisar</button></div>`).join('');
  const grupo = w => {
    const l = porSem[w.lunes] || [];
    return `<section class="fl-semana${w.enRojo ? ' fl-semana-roja' : ''}" aria-labelledby="fl-s-${w.lunes}"><h3 id="fl-s-${w.lunes}">Semana del ${H.esc(M.diaLargo(w.lunes))} al ${H.esc(M.diaLargo(w.domingo))}${w.tipo === 'actual' ? ' · esta semana' : ''}
      <span class="fl-semana-fin">termina con <b class="${w.fin < 0 ? 'fl-neg' : ''}">${pesos(w.fin)}</b></span></h3>
      ${l.length ? tablaItems(l, H) : '<p class="vacio">Nada esperado.</p>'}</section>`;
  };
  const sinF = A.sinFecha.filter(x => x.monto > 0);
  return `${aviso}<section class="tarjeta" aria-labelledby="t-fl-viene"><div class="titulo-fila"><h2 id="t-fl-viene">La agenda de la plata ${H.info('Lo que viene', 'Lo que se espera pagar y cobrar, por semana, con su fecha y de dónde sale.\nPor fecha: tiene fecha de vencimiento (o el plazo de pago de ese proveedor, de lo que ya se le pagó). Estimado: sueldos, Previred, F29, ventas y cuotas que todavía no tienen documento. Movido: usted le cambió la fecha (o el monto); el documento original no cambia.\n"Mover fecha" y "Anotar un pago o cobro" quedan con su historial; para deshacerlos se anulan (nada se borra).')}</h2></div>
    ${barra(H, `<button type="button" class="btn btn-chico" id="fl-anotar">+ Anotar un pago o cobro esperado</button>`)}
    ${W.map(grupo).join('')}
    ${sinF.length ? `<section class="fl-semana" aria-labelledby="fl-s-sin"><h3 id="fl-s-sin">Sin fecha <span class="fl-semana-fin">no suman en las semanas</span></h3>${tablaItems(sinF, H)}</section>` : ''}</section>
    ${htmlMetas(C, H)}`;
}
function tablaItems(l, H) {
  return `<div class="tabla-b2b fl-tabla-c" tabindex="0" role="region" aria-label="Pagos y cobros esperados (se desliza de lado)"><table class="tabla-tiempos fin-estado fl-items"><thead><tr><th scope="col">Fecha</th><th scope="col">Qué</th><th scope="col">De dónde sale</th><th scope="col" class="fl-num">Monto</th><th scope="col">Estado</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead><tbody>
    ${l.map(x => `<tr${x.atrasado ? ' class="fl-atrasado"' : ''}><th scope="row">${x.fechaEf ? H.esc(M.diaLargo(x.fechaEf)) : 'Sin fecha'}${x.hastaDia && x.hastaDia !== x.fechaEf ? `<small> a ${H.esc(M.diaLargo(x.hastaDia))}</small>` : ''}</th>
      <td class="fl-que">${H.esc(x.que)}${x.atrasado ? `<small> · venció el ${H.esc(M.diaTxt(x.fecha))}</small>` : ''}${x.estado === 'movido' && x.fechaOriginal && x.fechaOriginal !== x.fecha ? `<small> · era el ${H.esc(M.diaTxt(x.fechaOriginal) || 'sin fecha')}</small>` : ''}${x.revisado ? `<small> · revisado (antes ${pesos(x.montoOriginal)})</small>` : ''}${x.ajuste && x.ajuste.nota ? `<small> · ${H.esc(x.ajuste.nota)}</small>` : ''}</td>
      <td>${H.esc(x.deDonde)}</td><td class="fl-num${x.sentido === 'entra' ? ' fl-entra' : ''}">${x.sentido === 'entra' ? '+' : ''}${pesos(x.monto)}</td><td>${chipEstado(x)}</td>
      <td class="fl-acc">${x.noMover ? '' : `<button type="button" class="btn-link" data-fl-mover="${H.esc(x.clave)}">Mover fecha</button>`}${x.fuente && x.fuente.tipo === 'sueldos' ? ` <button type="button" class="btn-link" data-fl-rev="${H.esc(x.clave)}">Revisar</button>` : ''}${x.manual ? ` <button type="button" class="btn-link" data-fl-anular="${H.esc(x.fuente.id)}">Anular</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function htmlMetas(C, H) {
  const lunes = M.lunesDe(C.hoy), m = st.d.metas || {};
  const fila = ([k, t]) => { const v = M.metaDe(m, k, lunes), hist = (m[k] || []).slice().reverse().slice(0, 8);
    return `<li><span><b>${H.esc(t)}</b> · ${v ? `${pesos(v)} por semana` : 'sin meta'}</span><button type="button" class="btn-sec btn-chico" data-fl-meta="${k}">${v ? 'Cambiar' : 'Poner meta'}</button>
      ${hist.length ? `<details class="fl-hist"><summary>Historial</summary><ul>${hist.map(h => `<li>Desde el ${H.esc(M.diaTxt(h.desde))}: ${h.monto ? pesos(h.monto) : 'sin meta'}${h.nota ? ' · ' + H.esc(h.nota) : ''} <small>${H.esc(h.por || '')}</small></li>`).join('')}</ul></details>` : ''}</li>`; };
  return `<section class="tarjeta" aria-labelledby="t-fl-metas"><div class="titulo-fila"><h2 id="t-fl-metas">Metas de venta por semana ${H.info('Metas', 'La venta que se propone cada tienda por semana (efectivo y tarjeta). Con "Ventas que vienen: Meta", las semanas que vienen usan la meta; las pasadas muestran la meta bajo lo vendido.\nCada cambio rige desde la semana que elija y queda en el historial. Una meta en $0 la quita.')}</h2></div>
    <ul class="fl-metas">${M.SUCURSALES.map(fila).join('')}</ul></section>`;
}
function conectarViene(el, C, H, volver) {
  const porClave = Object.fromEntries(C.A.esperados.concat(C.A.sinFecha).map(x => [x.clave, x]));
  C.esp.forEach(x => { if (!porClave[x.clave]) porClave[x.clave] = x; });
  el.querySelectorAll('[data-fl-mover]').forEach(b => b.addEventListener('click', () => dialogoMover(porClave[b.dataset.flMover], H, volver)));
  el.querySelectorAll('[data-fl-rev]').forEach(b => b.addEventListener('click', () => dialogoSueldos(porClave[b.dataset.flRev], H, volver)));
  el.querySelectorAll('[data-fl-anular]').forEach(b => b.addEventListener('click', () => dialogoAnular(b.dataset.flAnular, 'Anular lo anotado', 'Deja de contar en el flujo. Queda en el historial.', H, volver)));
  el.querySelectorAll('[data-fl-meta]').forEach(b => b.addEventListener('click', () => dialogoMeta(b.dataset.flMeta, C, H, volver)));
  const an = $('fl-anotar'); if (an) an.onclick = () => dialogoAnotar(C, H, volver);
}
const errorDe = (e, H) => (e && e.message) || H.mensajeError(e);
function dialogoMover(x, H, volver) {
  if (!x) return;
  const d = H.dialogo(`<form class="form-dialogo" id="fl-mv" novalidate><h2>Mover fecha</h2>
    <p class="fl-actual"><b>${H.esc(x.que)}</b> · ${pesos(x.monto)}</p>
    <p class="ayuda">Fecha ${x.estado === 'movido' ? 'original' : 'de hoy'}: ${H.esc((x.fechaOriginal || x.fecha) ? M.diaLargo(x.fechaOriginal || x.fecha) : 'sin fecha')}. Solo cambia aquí, en el flujo: el documento no se toca.</p>
    <div class="campo"><label for="fl-mv-f">Nueva fecha</label><input id="fl-mv-f" type="date" value="${H.esc(x.fecha || '')}"></div>
    <div class="campo"><label for="fl-mv-n">Nota</label><input id="fl-mv-n" type="text" maxlength="200" placeholder="Por ejemplo: el proveedor espera hasta el viernes"></div>
    <p class="error" id="fl-mv-err" role="alert"></p>
    <div class="botones">${x.ajuste && !x.manual ? '<button type="button" class="btn-sec" id="fl-mv-orig">Volver a la fecha original</button>' : ''}<button type="button" class="btn-sec" id="fl-mv-no">Cancelar</button><button type="submit" class="btn" id="fl-mv-si">Guardar</button></div></form>`);
  const q = s => d.querySelector(s);
  q('#fl-mv-no').onclick = () => d.close();
  if (q('#fl-mv-orig')) q('#fl-mv-orig').onclick = () => { d.close(); dialogoAnular(x.ajuste.id, 'Volver a la fecha original', 'El cambio de fecha queda anulado (en el historial) y vuelve la fecha del documento.', H, volver); };
  q('#fl-mv').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-mv-si'); b.disabled = true; q('#fl-mv-err').textContent = '';
    try { await FF.mover(x, { fecha: q('#fl-mv-f').value, nota: q('#fl-mv-n').value }); H.registrar('Movió una fecha del flujo de caja', `${x.que} · ${q('#fl-mv-f').value}`); st.msg = 'Listo: la fecha quedó movida en el flujo.'; d.close(); volver(); }
    catch (e) { q('#fl-mv-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
function dialogoSueldos(x, H, volver) {
  if (!x) return;
  const ps = (x.fuente && x.fuente.personas) || [];
  const d = H.dialogo(`<form class="form-dialogo" id="fl-su" novalidate><h2>Revisar sueldos de ${H.esc(M.mesTxt(x.fuente.mes))}</h2>
    <p class="ayuda">Esperado el ${H.esc(M.diaLargo(x.fecha))}. Sale de la última liquidación de cada persona${x.revisado ? `; antes de su revisión era ${pesos(x.montoOriginal)}` : ''}:</p>
    <ul class="fl-lista">${ps.map(p => `<li><span>${H.esc(p.nombre)} <small>${H.esc(M.mesTxt(p.mes))}</small></span><b class="nowrap">${pesos(p.monto)}</b></li>`).join('')}</ul>
    <div class="campo"><label for="fl-su-m">Total de sueldos esperado</label><input id="fl-su-m" type="text" inputmode="numeric" value="${Math.round(x.monto)}"></div>
    <div class="campo"><label for="fl-su-n">Nota</label><input id="fl-su-n" type="text" maxlength="200" placeholder="Por ejemplo: bono de Navidad, una persona nueva"></div>
    <p class="error" id="fl-su-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fl-su-no">Cancelar</button><button type="submit" class="btn" id="fl-su-si">Guardar</button></div></form>`);
  const q = s => d.querySelector(s);
  q('#fl-su-no').onclick = () => d.close();
  q('#fl-su').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-su-si'); b.disabled = true; q('#fl-su-err').textContent = '';
    try { await FF.mover(x, { monto: q('#fl-su-m').value, nota: q('#fl-su-n').value }); H.registrar('Revisó los sueldos del flujo de caja', `${M.mesTxt(x.fuente.mes)} · ${q('#fl-su-m').value}`); st.msg = 'Listo: los sueldos quedaron revisados.'; d.close(); volver(); }
    catch (e) { q('#fl-su-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
function dialogoAnular(id, titulo, texto, H, volver) {
  const d = H.dialogo(`<form class="form-dialogo" id="fl-an" novalidate><h2>${H.esc(titulo)}</h2><p class="ayuda">${H.esc(texto)}</p>
    <div class="campo"><label for="fl-an-m">Motivo</label><input id="fl-an-m" type="text" maxlength="200"></div><p class="error" id="fl-an-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fl-an-no">Cancelar</button><button type="submit" class="btn" id="fl-an-si">Anular</button></div></form>`);
  const q = s => d.querySelector(s);
  q('#fl-an-no').onclick = () => d.close();
  q('#fl-an').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-an-si'); b.disabled = true; q('#fl-an-err').textContent = '';
    try { await FF.anular(id, q('#fl-an-m').value); H.registrar('Anuló un ajuste del flujo de caja', q('#fl-an-m').value); st.msg = 'Listo: quedó anulado (sigue en el historial).'; d.close(); volver(); }
    catch (e) { q('#fl-an-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
function dialogoAnotar(C, H, volver) {
  const ops = l => l.map(([k, t]) => `<option value="${k}">${H.esc(t)}</option>`).join('');
  const d = H.dialogo(`<form class="form-dialogo" id="fl-ma" novalidate><h2>Anotar un pago o cobro esperado</h2>
    <p class="ayuda">Por ejemplo, un retiro del dueño o un cobro que no está en el sistema. Solo cuenta en el flujo.</p>
    <fieldset><legend class="sr">Qué es</legend><label class="check"><input type="radio" name="fl-ma-s" value="sale" checked> Un pago (sale)</label><label class="check"><input type="radio" name="fl-ma-s" value="entra"> Un cobro (entra)</label></fieldset>
    <div class="campo"><label for="fl-ma-q">Qué es</label><input id="fl-ma-q" type="text" maxlength="120" placeholder="Retiro del dueño"></div>
    <div class="grilla-montos"><div class="campo"><label for="fl-ma-f">Fecha</label><input id="fl-ma-f" type="date" value="${H.esc(C.hoy)}"></div>
    <div class="campo"><label for="fl-ma-m">Monto</label><input id="fl-ma-m" type="text" inputmode="numeric" placeholder="150000"></div></div>
    <div class="campo"><label for="fl-ma-fi">Fila</label><select id="fl-ma-fi">${ops(M.SALE.filter(x => !['difcaja', 'ajuste_ef'].includes(x[0])))}</select></div>
    <div class="campo"><label for="fl-ma-d">De dónde sale o adónde entra</label><select id="fl-ma-d"><option>Banco</option><option>Mercado Pago</option><option>Efectivo</option></select></div>
    <div class="campo"><label for="fl-ma-n">Nota (opcional)</label><input id="fl-ma-n" type="text" maxlength="200"></div>
    <p class="error" id="fl-ma-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fl-ma-no">Cancelar</button><button type="submit" class="btn" id="fl-ma-si">Anotar</button></div></form>`);
  const q = s => d.querySelector(s), sentido = () => d.querySelector('input[name="fl-ma-s"]:checked').value;
  d.querySelectorAll('input[name="fl-ma-s"]').forEach(r => r.addEventListener('change', () => { q('#fl-ma-fi').innerHTML = sentido() === 'entra' ? ops(M.ENTRA) : ops(M.SALE.filter(x => !['difcaja', 'ajuste_ef'].includes(x[0]))); if (sentido() === 'sale') q('#fl-ma-fi').value = 'retiros'; }));
  q('#fl-ma-fi').value = 'retiros';
  q('#fl-ma-no').onclick = () => d.close();
  q('#fl-ma').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-ma-si'); b.disabled = true; q('#fl-ma-err').textContent = '';
    try { const x = await FF.anotar({ sentido: sentido(), fecha: q('#fl-ma-f').value, monto: q('#fl-ma-m').value, que: q('#fl-ma-q').value, fila: q('#fl-ma-fi').value, deDonde: q('#fl-ma-d').value, nota: q('#fl-ma-n').value });
      H.registrar('Anotó un esperado en el flujo de caja', `${x.que} · ${pesos(x.monto)} · ${x.fecha}`); st.msg = 'Listo: quedó anotado.'; d.close(); volver(); }
    catch (e) { q('#fl-ma-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
function dialogoMeta(suc, C, H, volver) {
  const lunes = M.lunesDe(C.hoy), act = M.metaDe(st.d.metas, suc, lunes);
  const d = H.dialogo(`<form class="form-dialogo" id="fl-me" novalidate><h2>Meta de venta · ${H.esc(M.textoSuc(suc))}</h2>
    <p class="ayuda">Por semana, de lunes a domingo (efectivo y tarjeta). ${act ? `Hoy rige ${pesos(act)}.` : 'Hoy no tiene meta.'} Promedio de las últimas 4 semanas: ${pesos(promedioSemana(suc, C))}.</p>
    <div class="grilla-montos"><div class="campo"><label for="fl-me-m">Meta por semana</label><input id="fl-me-m" type="text" inputmode="numeric" value="${act || ''}" placeholder="0 la quita"></div>
    <div class="campo"><label for="fl-me-d">Rige desde la semana del</label><input id="fl-me-d" type="date" value="${H.esc(lunes)}"></div></div>
    <div class="campo"><label for="fl-me-n">Nota (opcional)</label><input id="fl-me-n" type="text" maxlength="200"></div>
    <p class="error" id="fl-me-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fl-me-no">Cancelar</button><button type="submit" class="btn" id="fl-me-si">Guardar</button></div></form>`);
  const q = s => d.querySelector(s);
  q('#fl-me-no').onclick = () => d.close();
  q('#fl-me').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-me-si'); b.disabled = true; q('#fl-me-err').textContent = '';
    try { const desde = M.esDia(q('#fl-me-d').value) ? M.lunesDe(q('#fl-me-d').value) : ''; await FF.guardarMeta(suc, desde, q('#fl-me-m').value, q('#fl-me-n').value);
      H.registrar('Cambió la meta de venta semanal', `${M.textoSuc(suc)} · ${q('#fl-me-m').value} desde ${desde}`); st.msg = 'Listo: la meta quedó guardada.'; d.close(); volver(); }
    catch (e) { q('#fl-me-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
function promedioSemana(suc, C) {
  const di = M.ventasDiarias(st.d.evals, st.d.mpVentas);
  return [0, 1, 2, 3, 4, 5, 6].reduce((a, k) => a + (M.promedioDia(di, suc, k, { hoy: C.hoy, inicio: st.d.ini }) || 0), 0);
}

// ═══════════════ Cuadre ═══════════════
const ESTADO_C = { cuadra: ['Cuadra', 'c-verde'], falta: ['Falta registrar', 'c-rojo'], sin_datos: ['Sin datos', 'c-gris'] };
function datosCuadre(C) {
  const d = st.d;
  return { apertura: d.config.apertura, reales: C.R.movs, puntos: d.puntos, finales: d.finales, cobertura: d.cobertura, movsMp: d.movsMp, mpVentas: d.mpVentas, mpDias: d.config.mpDias, efmovs: d.efmovs, cierres: d.evals, cmovs: d.cmovs, gn: d.gn, abonos: d.abonos };
}
function htmlCuadre(C, H) {
  const todas = M.semanas({ hoy: C.hoy, inicio: st.d.ini, atras: 520, adelante: 0 }).lista;
  const Q = M.cuadre(todas, C.hoy, datosCuadre(C)); st.cuadre = Q;
  const fila = (q, i) => { const e = ESTADO_C[q.estado];
    return `<tr><th scope="row"><button type="button" class="fl-celda" data-fl-q="${i}">${H.esc(q.etiqueta)}</button></th><td class="fl-num">${pesos(q.sistema)}</td>
      <td class="fl-num">${cartolasTxt(q)}</td>
      <td class="fl-num">${q.real.efectivo === null ? '<span class="ayuda">sin conteo</span>' : pesos(q.efectivo)}</td><td class="fl-num${Math.abs(q.dif) > M.TOL_CUADRE ? ' fl-neg' : ''}">${q.dif > 0 ? '+' : ''}${pesos(q.dif)}</td><td><span class="chip ${e[1]}">${e[0]}</span></td></tr>`; };
  const faltas = Q.filter(q => q.falta.length).map((q, i) => `<div class="fl-falta"><h3>Semana ${H.esc(q.etiqueta)}: lo que falta</h3><ul>${q.falta.map(f => `<li><span>${H.esc(f.texto)}</span><a class="btn-sec btn-chico" href="${f.link}">${H.esc(f.boton)}</a></li>`).join('')}</ul></div>`).join('');
  return `<section class="tarjeta" aria-labelledby="t-fl-cuadre"><div class="titulo-fila"><h2 id="t-fl-cuadre">Cuadre de cada semana cerrada ${H.info('Cuadre', `Según el sistema: el saldo de partida más lo real que entró menos lo que salió, hasta el domingo.\nCartolas: el saldo de cada cuenta al domingo según su última cartola (BancoEstado: el saldo de sus movimientos o el cuadre de la cartola; Mercado Pago: el saldo después del último pago más las ventas liberadas después, aproximado). Si la cartola no llega al domingo, dice "sin cartola".\nEfectivo contado: la caja de administración según su último conteo y lo anotado después, más el fondo que quedó en cada caja al cerrar y lo que va de una caja a la caja de administración.\nDiferencia: lo de las cartolas y el efectivo contado menos lo del sistema, cuenta por cuenta (lo que va en camino entre cuentas se avisa aparte). Hasta $${M.TOL_CUADRE.toLocaleString('es-CL')} se toma como cuadrado.`)}</h2></div>
    ${barra(H)}
    ${Q.length ? `<div class="tabla-b2b fl-tabla-c" tabindex="0" role="region" aria-label="Cuadre por semana (se desliza de lado)"><table class="tabla-tiempos fin-estado fl-cuadre"><thead><tr><th scope="col">Semana</th><th scope="col" class="fl-num">Según el sistema</th><th scope="col" class="fl-num">Cartolas</th><th scope="col" class="fl-num">Efectivo contado</th><th scope="col" class="fl-num">Diferencia</th><th scope="col">Estado</th></tr></thead>
      <tbody>${Q.map(fila).join('')}</tbody></table></div>` : '<p class="vacio">Todavía no hay una semana cerrada desde el inicio.</p>'}
    ${faltas}</section>`;
}
function cartolasTxt(q) {
  const sin = q.faltan.filter(k => k !== 'efectivo');
  if (sin.length === 3) return '<span class="ayuda">sin cartola</span>';
  return `${sin.length ? `<span class="ayuda">sin ${sin.map(k => k === 'mp' ? 'Mercado Pago' : k === 'cc' ? 'cta. cte.' : 'chequera').join(' ni ')}</span> ` : ''}${pesos(q.cartolas)}`;
}
function conectarCuadre(el, C, H) {
  el.querySelectorAll('[data-fl-q]').forEach(b => b.addEventListener('click', () => dialogoCuadre(st.cuadre[Number(b.dataset.flQ)], H)));
}
function dialogoCuadre(q, H) {
  const f = k => `<tr><th scope="row">${H.esc(M.CUENTAS[k])}</th><td class="fl-num">${pesos(q.sis[k])}</td><td class="fl-num">${q.real[k] === null ? `<span class="ayuda">${k === 'efectivo' ? 'sin conteo' : 'sin cartola'}</span>` : pesos(q.real[k])}</td><td class="fl-num">${q.real[k] === null ? '—' : pesos(q.real[k] - q.sis[k])}</td></tr>`;
  const fondos = Object.entries(q.fondos || {}).map(([k, x]) => `${M.textoSuc(k)} ${pesos(x.monto)}${x.sabido ? '' : ' (sin dato)'}`).join(' · ');
  const d = H.dialogo(`<div class="form-dialogo fl-det"><h2>Cuadre · ${H.esc(q.etiqueta)}</h2>
    <div class="tabla-b2b"><table class="tabla-tiempos fin-estado"><thead><tr><th scope="col">Cuenta</th><th scope="col" class="fl-num">Sistema</th><th scope="col" class="fl-num">Cartola o contado</th><th scope="col" class="fl-num">Diferencia</th></tr></thead><tbody>${M.ORDEN_CUENTAS.map(f).join('')}</tbody></table></div>
    ${q.libro ? `<p class="ayuda">Efectivo contado: caja de administración ${pesos(q.libro.saldo)} (último conteo el ${H.esc(M.diaTxt(q.libro.conteo.dia))}, ${pesos(q.libro.conteo.monto)}) · fondos de las cajas: ${H.esc(fondos || 'ninguno')} · de una caja a la caja de administración ${pesos(q.transito)}.</p>` : '<p class="ayuda">La caja de administración todavía no tenía conteo inicial.</p>'}
    ${q.camino ? `<p class="ayuda">En camino entre cuentas: ${pesos(q.camino)} (un traspaso o depósito con un solo lado registrado).</p>` : ''}
    <div class="botones"><button type="button" class="btn" id="fl-q-ok">Cerrar</button></div></div>`);
  d.querySelector('#fl-q-ok').onclick = () => d.close();
}

// ═══════════════ Configuración ═══════════════
function dialogoConfig(H, volver) {
  const c = st.d.config, ap = c.apertura, hist = (c.historial || []).slice().reverse().slice(0, 10);
  const campo = k => `<div class="campo"><label for="fl-cf-${k}">${H.esc(M.CUENTAS[k])}</label><input id="fl-cf-${k}" type="text" inputmode="numeric" value="${Math.round(ap[k] || 0)}"></div>`;
  const d = H.dialogo(`<form class="form-dialogo" id="fl-cf" novalidate><h2>Configuración del flujo de caja</h2>
    <fieldset><legend>Saldos al empezar (1 de octubre de 2026) ${H.info('Saldos al empezar', 'Los saldos al 30 de septiembre de 2026 (balance de apertura): de ahí parte el flujo. Cambiarlos cambia todas las semanas.')}</legend><div class="grilla-montos">${M.ORDEN_CUENTAS.map(campo).join('')}</div>
      <p class="ayuda" id="fl-cf-tot">Total ${pesos(M.totalApertura(ap))}</p></fieldset>
    <fieldset><legend>Mercado Pago libera las ventas con tarjeta</legend>
      <label class="check"><input type="radio" name="fl-cf-mp" value="0" ${Number(c.mpDias) ? '' : 'checked'}> Al instante (el mismo día)</label>
      <label class="check"><input type="radio" name="fl-cf-mp" value="n" ${Number(c.mpDias) ? 'checked' : ''}> A <input id="fl-cf-mpn" type="number" min="1" max="60" step="1" value="${Number(c.mpDias) || 10}" class="fl-cf-n" aria-label="Días"> días</label></fieldset>
    <div class="campo"><label for="fl-cf-ad">Semanas que vienen en la tabla</label><input id="fl-cf-ad" type="number" min="2" max="16" step="1" value="${Number(c.adelante) || 6}"></div>
    <div class="campo"><label for="fl-cf-no">Nota del cambio (opcional)</label><input id="fl-cf-no" type="text" maxlength="200"></div>
    ${hist.length ? `<details class="fl-hist"><summary>Historial</summary><ul>${hist.map(h => `<li>${H.esc(String(h.en || '').slice(0, 10))} · ${H.esc(h.por || '')}${h.nota ? ' · ' + H.esc(h.nota) : ''}${h.antes && h.antes.apertura ? ` · antes: total ${pesos(M.totalApertura(h.antes.apertura))}, Mercado Pago ${h.antes.mpDias ? 'a ' + h.antes.mpDias + ' días' : 'al instante'}` : ''}</li>`).join('')}</ul></details>` : ''}
    ${c.sinGuardar ? '<p class="aviso">Estos valores todavía no están guardados en la base: se guardan al presionar Guardar.</p>' : ''}
    <p class="error" id="fl-cf-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fl-cf-cancelar">Cancelar</button><button type="submit" class="btn" id="fl-cf-si">Guardar</button></div></form>`);
  const q = s => d.querySelector(s);
  const tot = () => { q('#fl-cf-tot').textContent = 'Total ' + pesos(M.ORDEN_CUENTAS.reduce((a, k) => a + (Number(String(q('#fl-cf-' + k).value).replace(/[$.\s]/g, '')) || 0), 0)); };
  M.ORDEN_CUENTAS.forEach(k => q('#fl-cf-' + k).addEventListener('input', tot));
  q('#fl-cf-mpn').addEventListener('focus', () => { d.querySelector('input[name="fl-cf-mp"][value="n"]').checked = true; });
  q('#fl-cf-cancelar').onclick = () => d.close();
  q('#fl-cf').addEventListener('submit', async ev => {
    ev.preventDefault(); const b = q('#fl-cf-si'); b.disabled = true; q('#fl-cf-err').textContent = '';
    const mp = d.querySelector('input[name="fl-cf-mp"]:checked').value === '0' ? 0 : q('#fl-cf-mpn').value;
    try { await FF.guardarConfig({ apertura: Object.fromEntries(M.ORDEN_CUENTAS.map(k => [k, q('#fl-cf-' + k).value])), mpDias: mp, adelante: q('#fl-cf-ad').value }, q('#fl-cf-no').value);
      H.registrar('Cambió la configuración del flujo de caja', `Mercado Pago ${Number(mp) ? 'a ' + mp + ' días' : 'al instante'}`); st.msg = 'Listo: la configuración quedó guardada.'; d.close(); volver(); }
    catch (e) { q('#fl-cf-err').textContent = errorDe(e, H); b.disabled = false; }
  });
}
