// ═══════════════════════════════════════════════════════════════════════
//  Sistema Fën — Finanzas → Plata hoy (pantalla)  v0.128.0
//  Lo que hay, lo que viene y lo que queda. Reglas en plata-hoy.js; datos de flujo-fs.js (los mismos del Flujo de caja).
//  H = ayudas de app.js { esc, info, mensajeError }. Guarda un resumen corto en este equipo para la tarjeta de Hoy.
// ═══════════════════════════════════════════════════════════════════════
import * as M from './flujo-modelo.js?v=0.138.0';
import * as FF from './flujo-fs.js?v=0.138.0';
import * as P from './plata-hoy.js?v=0.138.0';

export const K_RESUMEN = 'fen_plata_hoy';
const $ = id => document.getElementById(id);
const pesos = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− $' : '$') + Math.abs(v).toLocaleString('es-CL'); };
const enPlata = () => /^#finanzas\/plata/.test(location.hash || '');
const TXT = 'Lo que hay: el saldo de cada cuenta en su última cartola o reporte (con su fecha), lo que debería haber en la caja de administración, el fondo que quedó en cada caja y los retiros de cierre que todavía no se reciben.\nLo que viene: los folios por cobrar de Ventas a empresas y los documentos por pagar de Gastos, por su fecha (vencido, esta semana, más adelante). Las cuotas de crédito, arriendos, sueldos, Previred y F29 que aún no tienen documento entran estimados hasta 30 días (como en el Flujo de caja). La tarjeta: compras anotadas menos sus pagos.\nLo que queda: lo que hay + lo que viene.\nLa cuenta con el dueño se muestra aparte y no se suma. Un cargo o un abono sin conciliar puede hacer ver una factura como por pagar o un folio como por cobrar: concilie para que los totales sean reales.';

export async function pintar(el, H, ctx) {
  el.innerHTML = ctx.cab('plata') + '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Calculando la plata de hoy…</div></section>';
  let d;
  try { d = await FF.cargar(); }
  catch (e) {
    if (!enPlata()) return;
    el.innerHTML = ctx.cab('plata') + `<section class="tarjeta"><p class="error" role="alert">No se pudo leer (${H.esc(ctx.error ? ctx.error(e, H) : H.mensajeError(e))}).</p><button type="button" class="btn-sec" id="pl-act">Intentar de nuevo</button></section>`;
    const b = $('pl-act'); if (b) b.onclick = () => { FF.olvidar(); pintar(el, H, ctx); };
    return;
  }
  if (!enPlata()) return;
  let R; try { R = P.calcular(d); } catch (e) { console.error('Plata hoy', e); el.innerHTML = ctx.cab('plata') + `<section class="tarjeta"><p class="error" role="alert">No se pudo calcular (${H.esc(e.message || String(e))}).</p></section>`; return; }
  try { localStorage.setItem(K_RESUMEN, JSON.stringify(P.resumenCorto(R))); } catch (e) {}
  el.innerHTML = ctx.cab('plata') + html(R, H);
  const b = $('pl-act'); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Actualizando…'; FF.olvidar(); await pintar(el, H, ctx); };
}

const etiquetaVieja = x => x.viejo ? ` <span class="chip c-amarillo chip-chico">hace ${x.dias} días</span>` : '';
function filaHay(x, H) {
  const sub = x.k === 'mp' && x.exacto ? `saldo del reporte al ${M.diaTxt(x.fecha)}${x.hora ? ' ' + x.hora : ''}` : x.k === 'admin' ? `debería haber${x.conteo ? ' · último conteo ' + M.diaTxt(x.conteo) : ''}` : x.de ? (x.fecha ? `${x.de} hasta el ${M.diaTxt(x.fecha)}` : `sin ${x.de}`) : (x.detalle || '');
  return `<div class="pl-fila"><span><a href="${x.link}">${H.esc(x.nombre)}</a> <small>· ${H.esc(sub)}</small>${etiquetaVieja(x)}</span><span class="pl-m">${x.monto == null ? '<span class="gn-sug">sin dato</span>' : pesos(x.monto)}</span></div>`;
}
const TRAMOS = [['vencido', 'Vencido'], ['semana', 'Esta semana'], ['adelante', 'Más adelante']];
function filaTramo(g, k, t, neg, H) {
  const l = g[k]; if (!l.length) return `<div class="pl-fila"><span>${t} <small>· nada</small></span><span class="pl-m">$0</span></div>`;
  const est = l.filter(x => x.estado === 'estimado').length;
  return `<details class="pl-det"><summary class="pl-fila"><span>${t} <small>· ${l.length}${est ? ` · ${est} estimado${est === 1 ? '' : 's'}` : ''}</small></span><span class="pl-m">${neg ? '− ' : ''}${pesos(g.tot[k])}</span></summary>
    <ul class="pl-items">${l.map(x => `<li><span>${x.fecha ? H.esc(M.diaTxt(x.fecha)) : 'sin fecha'} · ${H.esc(x.que)}${x.estado === 'estimado' ? ' <span class="chip c-amarillo chip-chico">estimado</span>' : ''}</span><span class="pl-m">${pesos(x.monto)}</span></li>`).join('')}</ul></details>`;
}
function html(R, H) {
  const { hay, viene } = R, n = R.sinConciliar;
  const total = (t, m, cls = '') => `<div class="pl-total ${cls}"><b>${t}</b><b class="pl-m">${pesos(m)}</b></div>`;
  return `<section class="pl-intro"><div><h2 id="t-plata">Plata de Fën hoy ${H.info('Plata de Fën hoy', TXT)}</h2><p class="ayuda">${H.esc(M.diaLargo(R.hoy))} · cada número con la fecha de su último dato</p></div><button type="button" class="btn-sec btn-chico" id="pl-act">Actualizar</button></section>
  <div class="pl-tres">
    <div class="tarjeta pl-kpi pl-kpi-hay"><span class="pl-k">Lo que hay</span><b>${pesos(hay.total)}</b><small>bancos, Mercado Pago y efectivo</small></div>
    <div class="tarjeta pl-kpi"><span class="pl-k">Lo que viene</span><b>${pesos(viene.total)}</b><small>por cobrar ${pesos(viene.cobrar.total)} · por pagar ${pesos(viene.pagar.total + viene.tarjeta.monto)}</small></div>
    <div class="tarjeta pl-kpi pl-kpi-queda"><span class="pl-k">Lo que queda</span><b>${pesos(R.queda)}</b><small>si todo se cobra y se paga</small></div>
  </div>
  ${n.cargos || n.abonos ? `<p class="aviso pl-aviso" role="note">Hay ${n.cargos ? `<a href="#gastos">${n.cargos} ${n.cargos === 1 ? 'cargo' : 'cargos'}</a>` : ''}${n.cargos && n.abonos ? ' y ' : ''}${n.abonos ? `<a href="#b2b/conciliacion">${n.abonos} ${n.abonos === 1 ? 'abono' : 'abonos'}</a>` : ''} sin conciliar: estos totales pueden cambiar.</p>` : ''}
  ${hay.faltan.length || R.faltanDatos.length ? `<p class="aviso" role="note">${hay.faltan.length ? `Sin dato: ${H.esc(hay.faltan.join(', '))}. ` : ''}${R.faltanDatos.length ? 'Algunos datos no se pudieron leer en este equipo (Ventas a empresas o las cajas): presione Actualizar.' : ''}</p>` : ''}
  <div class="pl-dos">
    <section class="tarjeta pl-col" aria-labelledby="t-pl-hay"><h3 id="t-pl-hay">Lo que hay</h3>${hay.lista.map(x => filaHay(x, H)).join('')}${total('Total que hay', hay.total)}</section>
    <section class="tarjeta pl-col" aria-labelledby="t-pl-viene"><h3 id="t-pl-viene">Lo que viene</h3>
      <span class="pl-k">Por cobrar · <a href="#b2b/cobranza">clientes de Ventas a empresas</a></span>
      ${TRAMOS.map(([k, t]) => filaTramo(viene.cobrar, k, t, false, H)).join('')}
      <span class="pl-k">Por pagar · <a href="#gastos/porpagar">Gastos</a></span>
      ${TRAMOS.map(([k, t]) => filaTramo(viene.pagar, k, k === 'adelante' ? `Hasta el ${M.diaTxt(viene.hasta)}` : t, true, H)).join('')}
      ${viene.anterior.total ? `<details class="pl-det"><summary class="pl-fila pl-info"><span>Deuda de antes del 1 oct <small>· ${viene.anterior.lista.length} documentos · no se suma: casi siempre se pagó antes del corte (revísela en Gastos → Por pagar)</small></span><span class="pl-m">${pesos(viene.anterior.total)}</span></summary><ul class="pl-items">${viene.anterior.lista.map(x => `<li><span>${H.esc(x.que)}</span><span class="pl-m">${pesos(x.monto)}</span></li>`).join('')}</ul></details>` : ''}
      <div class="pl-fila"><span>Tarjeta de crédito usada <small>· compras anotadas ${pesos(viene.tarjeta.compras)} − pagos ${pesos(viene.tarjeta.pagos)}</small></span><span class="pl-m">− ${pesos(viene.tarjeta.monto)}</span></div>
      ${total('Total que viene', viene.total, 'pl-total-viene')}
      <p class="ayuda pl-pie">Por pagar: lo vencido y lo que vence hasta el ${H.esc(M.diaTxt(viene.hasta))} (fin de mes; desde 7 días antes de que termine, también el mes que viene).${viene.despues.n ? ` Después de esa fecha hay ${viene.despues.n} más por ${pesos(viene.despues.total)}: no se suman.` : ''} Lo estimado (sueldos, Previred, F29, cuotas y arriendos sin documento) aparece con su etiqueta. ${R.dueno.saldo ? `Cuenta con el dueño: la empresa ${R.dueno.saldo > 0 ? 'le debe' : 'le prestó'} ${pesos(Math.abs(R.dueno.saldo))} <small>(no se suma)</small>.` : ''}</p>
    </section>
  </div>
  <section class="tarjeta pl-final">${total('Lo que queda si todo se cobra y se paga', R.queda)}<p class="ayuda">Lo que hay ${pesos(hay.total)} + lo que viene ${pesos(viene.total)}.</p></section>`;
}
// La tarjeta de Hoy: el último cálculo de este equipo (no lee nada)
export function tarjetaHoyHtml(esc) {
  let r = null; try { r = JSON.parse(localStorage.getItem(K_RESUMEN) || 'null'); } catch (e) {}
  const mm = n => { const v = Math.round(Number(n) || 0), a = Math.abs(v); return (v < 0 ? '− ' : '') + (a >= 1e6 ? '$' + (a / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 2 }) + ' MM' : '$' + a.toLocaleString('es-CL')); };
  if (!r) return `<a class="tarjeta pl-hoy" href="#finanzas/plata"><span class="pl-hoy-t"><b>Plata de Fën</b><span>Calcular</span></span><small>Lo que hay, lo que viene y lo que queda.</small></a>`;
  const hora = new Date(r.en), cuando = r.hoy === M.hoyChile() ? `hoy ${hora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : M.diaTxt(r.hoy);
  return `<a class="tarjeta pl-hoy" href="#finanzas/plata"><span class="pl-hoy-t"><b>Plata de Fën</b><span>Ver</span></span>
    <span class="pl-hoy-3"><span><small>Hay</small><b>${mm(r.hay)}</b></span><span><small>Viene</small><b>${mm(r.viene)}</b></span><span><small>Queda</small><b>${mm(r.queda)}</b></span></span>
    <small>Calculado ${esc(cuando)}${(r.viejos || []).length ? ' · ' + esc(r.viejos.map(v => `${v.nombre}: dato de hace ${v.dias} días`).join(' · ')) : ''}</small></a>`;
}
