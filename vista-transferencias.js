// ═══════════════════════════════════════════════
//  Sistema Fën — Ventas en tienda → Transferencias  v0.125.1
//  El cuadre de cada día entre lo que la caja cobró por transferencia y lo que llegó al banco como venta de la tienda
//  (los abonos marcados "Es venta de la tienda" en la conciliación). Abajo, lo que no cuadra y qué hacer:
//  · una venta sin su abono (pasados 3 días): "Fue con otro medio" (corrige la venta y los totales de su caja, como en la
//    caja; si ya cerró, rehace su resumen) o "Llegó a otra cuenta" (queda anotado, no cambia montos);
//  · un abono de la tienda sin venta, o con otro monto: se ve con su nota; se corrige en la conciliación (Lo conciliado).
//  Lecturas: las ventas por transferencia (1 consulta, fen-ventas) y los abonos de la tienda (1 consulta, fen-b2b), 2 minutos en memoria.
// ═══════════════════════════════════════════════
import * as Caja from './caja.js?v=0.138.0';
import * as B2b from './b2b.js?v=0.138.0';
import * as TT from './transf-tienda.js?v=0.138.0';

const PERIODOS = [['14', 'Últimos 14 días'], ['30', 'Últimos 30 días'], ['60', 'Últimos 60 días']];
const ST = { periodo: '30', msg: '', err: '' };
export function olvidar() { ST.msg = ''; ST.err = ''; }

// La cuenta para la pestaña (cuántas cosas no cuadran), sin pintar nada; null si no se pudo leer
export async function contarNoCuadran() {
  try { const [v, a] = await Promise.all([Caja.ventasTransferencia(), B2b.abonosTienda()]); return TT.cuadre({ ventas: v, abonos: a, hoy: TT.diaDe(new Date()) }).noCuadran; }
  catch (_) { return null; }
}

export async function pintarTransferencias(el, H) {
  const { esc, pesos, sucursal, diaTexto, registrar, dialogo, repintar, mensajeError } = H;
  const hoy = TT.diaDe(new Date()), desde = TT.sumarDias(hoy, -(Number(ST.periodo) - 1));
  let ventas = [], abonos = [], errB2b = '';
  ventas = await Caja.ventasTransferencia();
  try { abonos = await B2b.abonosTienda(); } catch (e) { errB2b = mensajeError(e); }
  const C = TT.cuadre({ ventas, abonos, hoy, desde, hasta: hoy });
  const T = C.totales;
  const ventaTxt = v => `${diaTexto(TT.diaVenta(v))} · ${TT.horaVenta(v)} · ${sucursal(v.sucursal)}${v.usuario ? ' · ' + String(v.usuario).split('@')[0] : ''}`;
  const lineasTxt = v => (v.lineas || []).map(x => `${x.cantidad} ${x.nombre}`).join(', ').slice(0, 90);
  const chip = e => { const [t, c] = TT.ESTADO_DIA[e] || [e, 'c-gris']; return `<span class="chip ${c} chip-chico">${esc(t)}</span>`; };
  const filaDia = x => `<tr><th scope="row">${esc(diaTexto(x.dia))}<span class="tt-est-cel">${chip(x.estado)}</span></th><td class="num" data-l="Caja">${pesos(x.caja)}</td><td class="num" data-l="Banco">${pesos(x.banco)}${x.fuera ? `<small> + ${pesos(x.fuera)} otra cuenta</small>` : ''}</td>
      <td class="num" data-l="Diferencia">${x.dif ? `<b>${x.dif > 0 ? '+' : '−'}${pesos(Math.abs(x.dif))}</b>` : '$0'}</td><td class="tt-est">${chip(x.estado)}</td></tr>`;
  const sinAbono = v => `<div class="fila-caja tt-fila"><div class="txt"><b>Venta del ${esc(ventaTxt(v))}</b><span>${esc(lineasTxt(v))}</span>
      <span class="tt-motivo">Cobrada por transferencia, pero no llegó su abono a la cuenta de la cartola entre el ${esc(diaTexto(TT.diaVenta(v)))} y el ${esc(diaTexto(TT.sumarDias(TT.diaVenta(v), TT.DIAS_ANTES)))}.${v.transferNombre ? ' Transfiere: ' + esc(v.transferNombre) + '.' : ''}</span></div>
      <div class="acciones"><b class="tt-monto">${pesos(TT.montoTransfer(v))}</b><button type="button" class="btn-sec btn-chico" data-tt-medio="${esc(v.id)}">Fue con otro medio</button>
        <button type="button" class="btn-sec btn-chico" data-tt-otra="${esc(v.id)}">Llegó a otra cuenta</button><a class="btn-sec btn-chico" href="#b2b/conciliacion">Buscar su abono</a></div></div>`;
  const dif = ({ venta: v, abono: a, dif: d }) => `<div class="fila-caja tt-fila"><div class="txt"><b>Abono del ${esc(diaTexto(a.fecha))} · ${esc(a.descripcion || '')}</b>
      <span class="tt-motivo">Unido a la venta del ${esc(ventaTxt(v))} de ${pesos(TT.montoTransfer(v))} · llegó ${d > 0 ? pesos(d) + ' más' : pesos(-d) + ' menos'}${a.nota ? ' · nota: ' + esc(a.nota) : ' · sin nota'}</span></div>
      <div class="acciones"><b class="tt-monto">${pesos(a.monto)}</b></div></div>`;
  const sinVenta = a => `<div class="fila-caja tt-fila"><div class="txt"><b>Abono del ${esc(diaTexto(a.fecha))} · ${esc(a.descripcion || '')}</b>
      <span class="tt-motivo">Marcado como venta de la tienda, sin venta de la caja${a.nota ? ' · nota: ' + esc(a.nota) : ''}. Si la venta quedó con otro medio en la caja, corríjala allá a Transferencia; si no era de la tienda, deshágalo en Conciliación → Lo conciliado.</span></div>
      <div class="acciones"><b class="tt-monto">${pesos(a.monto)}</b></div></div>`;
  const fuera = v => `<div class="fila-caja tt-fila"><div class="txt"><b>Venta del ${esc(ventaTxt(v))}</b><span class="tt-motivo">Llegó a otra cuenta${v.transfRevision && v.transfRevision.nota ? ': ' + esc(v.transfRevision.nota) : ''}${v.transfRevision && v.transfRevision.por ? ' · ' + esc(String(v.transfRevision.por).split('@')[0]) : ''}</span></div>
      <div class="acciones"><b class="tt-monto">${pesos(TT.montoTransfer(v))}</b><button type="button" class="btn-link" data-tt-quitar="${esc(v.id)}">Quitar</button></div></div>`;
  const nNo = C.noCuadran;
  const ph = el.querySelector(':scope > .tarjeta'); if (ph) ph.remove();   // el "Cargando…" de pintarCaja
  el.insertAdjacentHTML('beforeend', `
    ${ST.msg || ST.err ? `<div class="${ST.err ? 'error' : 'aviso-ok'}" role="status">${esc(ST.err || ST.msg)}</div>` : ''}
    ${errB2b ? `<div class="error" role="alert">No se pudieron leer los abonos de la cartola (${esc(errB2b)}). Se muestra solo lo de la caja.</div>` : ''}
    <section class="tarjeta" aria-labelledby="t-tt"><div class="titulo-fila"><h2 id="t-tt">Transferencias de la tienda</h2>
      <label class="tt-per"><span class="sr">Período</span><select id="tt-periodo">${PERIODOS.map(([k, t]) => `<option value="${k}" ${ST.periodo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <div class="tt-cifras">
        <div class="tt-cifra"><span>La caja cobró por transferencia</span><b>${pesos(T.caja)}</b><small>${T.nCaja} ${T.nCaja === 1 ? 'venta' : 'ventas'}</small></div>
        <div class="tt-cifra"><span>Llegó al banco como venta de la tienda</span><b>${pesos(T.banco)}</b><small>${T.nBanco} ${T.nBanco === 1 ? 'abono' : 'abonos'}${T.fuera ? ` · ${pesos(T.fuera)} a otra cuenta` : ''}</small></div>
        <div class="tt-cifra${nNo ? ' tt-alerta' : ''}"><span>No cuadran</span><b>${nNo}</b><small>${C.ventasSinAbono.length} ${C.ventasSinAbono.length === 1 ? 'venta' : 'ventas'} sin abono · ${C.abonosSinVenta.length} ${C.abonosSinVenta.length === 1 ? 'abono' : 'abonos'} sin venta</small></div>
        <div class="tt-cifra"><span>Esperando el banco</span><b>${C.esperando.length}</b><small>ventas de los últimos ${TT.DIAS_ESPERA} días</small></div>
      </div>
      <p class="ayuda">Caja = lo cobrado por transferencia según la caja. Banco = los abonos marcados "Es venta de la tienda" en Ventas a empresas → Conciliación. Un pago dividido con una parte en transferencia cuenta en la caja, pero se une a mano.</p>
    </section>
    <section class="tarjeta" aria-labelledby="t-tt-dias"><div class="titulo-fila"><h2 id="t-tt-dias">Cada día</h2><span>${C.dias.length} ${C.dias.length === 1 ? 'día' : 'días'} con transferencias</span></div>
      ${C.dias.length ? `<div class="tt-tabla-caja"><table class="tt-tabla"><thead><tr><th scope="col">Día</th><th scope="col" class="num">Caja</th><th scope="col" class="num">Banco</th><th scope="col" class="num">Diferencia</th><th scope="col" class="tt-est">Estado</th></tr></thead>
        <tbody>${C.dias.map(filaDia).join('')}</tbody></table></div>` : '<div class="vacio" style="border:0">No hubo ventas por transferencia ni abonos de la tienda en este período.</div>'}
    </section>
    <section class="tarjeta" aria-labelledby="t-tt-no"><div class="titulo-fila"><h2 id="t-tt-no">Lo que no cuadra</h2><span>${nNo} por resolver${C.diferencias.length ? ` · ${C.diferencias.length} con diferencia` : ''}</span></div>
      ${C.ventasSinAbono.map(sinAbono).join('')}${C.abonosSinVenta.map(sinVenta).join('')}${C.diferencias.map(dif).join('')}
      ${nNo + C.diferencias.length ? '' : '<div class="vacio" style="border:0">Todo cuadra.</div>'}
      ${C.fueraDelBanco.length ? `<details class="tt-fuera"><summary>Llegaron a otra cuenta (${C.fueraDelBanco.length})</summary>${C.fueraDelBanco.map(fuera).join('')}</details>` : ''}
    </section>`);
  ST.msg = ''; ST.err = '';
  const hecho = async (fn, msg) => { try { await fn(); ST.msg = msg; } catch (e) { ST.err = mensajeError(e); } Caja.olvidarVentasTransferencia(); repintar(); };
  el.querySelector('#tt-periodo').addEventListener('change', e => { ST.periodo = e.target.value; repintar(); });
  el.querySelectorAll('[data-tt-medio]').forEach(b => b.addEventListener('click', () => {
    const v = ventas.find(x => x.id === b.dataset.ttMedio); if (!v) return;
    const dlg = dialogo(`<form class="form-dialogo" novalidate><h2>Fue con otro medio</h2>
      <p class="ayuda">Venta del ${esc(ventaTxt(v))} · ${pesos(TT.montoTransfer(v))}</p>
      <fieldset class="campo"><legend>¿Con qué se pagó?</legend><div class="radios">${[['efectivo', 'Efectivo'], ['debito', 'Débito'], ['credito', 'Crédito']].map(([k, t]) => `<label class="check-linea"><input type="radio" name="tt-m" value="${k}"> ${t}</label>`).join('')}</div></fieldset>
      <p class="ayuda">La venta cambia de medio de pago (queda quién y cuándo, como en la caja) y los totales de su caja se corrigen. Si la caja ya cerró, su resumen se rehace. El arqueo de ese día no cambia: queda como se contó.</p>
      <p class="error" id="tt-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="tt-no">Cancelar</button><button type="submit" class="btn">Cambiar el medio</button></div></form>`);
    dlg.querySelector('#tt-no').onclick = () => dlg.close();
    dlg.querySelector('form').addEventListener('submit', ev => { ev.preventDefault();
      const m = (dlg.querySelector('input[name="tt-m"]:checked') || {}).value; if (!m) { dlg.querySelector('#tt-err').textContent = 'Elija el medio de pago.'; return; }
      dlg.close();
      hecho(async () => { await Caja.cambiarMedioVenta(v.id, m); registrar('Cambió el medio de pago de una venta (Transferencias)', `${v.id} · ${pesos(TT.montoTransfer(v))} · transferencia → ${m}`); },
        `Listo: la venta del ${diaTexto(TT.diaVenta(v))} quedó pagada con ${m === 'efectivo' ? 'efectivo' : m === 'debito' ? 'débito' : 'crédito'}.`);
    });
  }));
  el.querySelectorAll('[data-tt-otra]').forEach(b => b.addEventListener('click', () => {
    const v = ventas.find(x => x.id === b.dataset.ttOtra); if (!v) return;
    const dlg = dialogo(`<form class="form-dialogo" novalidate><h2>Llegó a otra cuenta</h2>
      <p class="ayuda">Venta del ${esc(ventaTxt(v))} · ${pesos(TT.montoTransfer(v))}</p>
      <div class="campo"><label for="tt-nota">¿A qué cuenta llegó?</label><input id="tt-nota" maxlength="200" placeholder="Ej: a la cuenta personal, por error del cliente"></div>
      <p class="ayuda">Queda anotado en la venta y deja de esperar su abono. No cambia montos.</p>
      <p class="error" id="tt-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="tt-no">Cancelar</button><button type="submit" class="btn">Anotar</button></div></form>`);
    dlg.querySelector('#tt-no').onclick = () => dlg.close();
    dlg.querySelector('form').addEventListener('submit', ev => { ev.preventDefault();
      const n = dlg.querySelector('#tt-nota').value.trim(); if (!n) { dlg.querySelector('#tt-err').textContent = 'Escriba a qué cuenta llegó.'; return; }
      dlg.close();
      hecho(async () => { await Caja.ventaOtraCuenta(v.id, n); registrar('Venta por transferencia: llegó a otra cuenta', `${v.id} · ${pesos(TT.montoTransfer(v))} · ${n}`); }, 'Listo: quedó anotado que llegó a otra cuenta.');
    });
  }));
  el.querySelectorAll('[data-tt-quitar]').forEach(b => b.addEventListener('click', () => {
    const v = ventas.find(x => x.id === b.dataset.ttQuitar); if (!v) return;
    hecho(async () => { await Caja.quitarOtraCuenta(v.id); registrar('Venta por transferencia: quitó "llegó a otra cuenta"', v.id); }, 'Listo: la venta vuelve a esperar su abono.');
  }));
}
