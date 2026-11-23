// ═══════════════════════════════════════════════
//  Sistema Fën — Hoy → "Cobro del Point pagado sin venta"  v0.123.0
//  Aprobado por Emmanuel el 1 nov (boceto; incidente del 31 oct: un débito pagado en el Point que la caja no registró).
//  Al abrir Hoy se piden UNA vez los cobros recientes al servidor de cobros (el mismo de Ventas en tienda → Point; el Worker revisa
//  que la cuenta sea de administración). Cada cobro "pagado" de una tienda se busca en las ventas por su referencia
//  (ventas.pagoPoint.referencia, lo que guarda la caja v2.4.0 en adelante). Lo que no tiene venta ni revisión aparece en Pendientes.
//  Lecturas: 1 consulta a ventas (la referencia "in", hasta 30) + 1 a point_revisiones; se guarda 5 minutos. Sin cobros pagados: 0.
//  "Revisar" guarda la resolución en point_revisiones/{referencia} (solo se crea; no se cambia ni se borra: reglas v1.9.0):
//   · manual: ya se registró a mano (la venta elegida, o una nota);
//   · descuadre: se cerró como descuadre (la caja de ese día): Finanzas lo cuenta como venta de esa tienda y deja de ser faltante;
//   · devuelto: se devolvió en Mercado Pago.
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, getDocs, query, where, Timestamp, runTransaction } from './firebase.js?v=0.138.0';

export const RESOLUCIONES = { manual: 'Ya se registró a mano', descuadre: 'Se cerró como descuadre', devuelto: 'Se devolvió en Mercado Pago' };
export const TIENDAS = { barros_arana: 'Barros Arana', ainavillo: 'Ainavillo' };
export const ESPERA_MS = 10 * 60000;   // un cobro de hace menos de 10 minutos puede estar registrándose todavía
const TIPO = { debito: 'Débito', credito: 'Crédito', prepago: 'Prepago', dinero_en_cuenta: 'Dinero en cuenta (QR)', otro: 'Otro' };
export const tipoPagoTxt = t => TIPO[t] || 'Tarjeta';
const medioTxt = m => ({ efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia' })[m] || String(m || '');
const correo = () => (auth.currentUser && auth.currentUser.email) || '';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const diaCorto = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}` : '');

// ── Puro ──
// El día y la hora de Chile de un cobro (creada: ISO)
export function diaHora(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { dia: '', hora: '' };
  return { dia: d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }), hora: d.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }) };
}
// cobros: los del servidor; conVenta y revisados: Set de referencias. → los pagados de una tienda sin venta ni revisión, del más nuevo al más viejo
export function sinVenta(cobros, conVenta, revisados, ahoraMs = Date.now()) {
  const vistos = new Set();
  return (cobros || []).filter(c => {
    if (!c || c.estado !== 'pagado' || !TIENDAS[c.sucursal] || !c.referencia || vistos.has(c.referencia)) return false;
    vistos.add(c.referencia);
    const ms = Date.parse(c.creada || '');
    if (ms && ahoraMs - ms < ESPERA_MS) return false;
    return !conVenta.has(c.referencia) && !revisados.has(c.referencia);
  }).map(c => ({ ...c, monto: Math.round(Number(c.monto) || 0), ...diaHora(c.creada) }))
    .sort((a, b) => String(b.creada || '').localeCompare(String(a.creada || '')));
}
const trozos = (l, n = 30) => { const out = []; for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n)); return out; };
// Ventas candidatas para "Ya se registró a mano": las de esa tienda y ese día, no anuladas; las del mismo total primero
export function candidatasVenta(ventas, cobro) {
  return (ventas || []).filter(v => v.sucursal === cobro.sucursal && v.anulada !== true && !(v.pagoPoint && v.pagoPoint.referencia))
    .map(v => ({ ...v, calza: Math.round(Number(v.total) || 0) === cobro.monto, hora: v.fecha && v.fecha.toDate ? v.fecha.toDate().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }) : '' }))
    .sort((a, b) => (b.calza - a.calza) || String(a.hora).localeCompare(String(b.hora)));
}
// Una resolución → el documento de point_revisiones (sin quién ni cuándo) o { error }
export function revisarResolucion(cobro, r) {
  if (!RESOLUCIONES[r && r.resolucion]) return { error: 'Elija qué pasó con este cobro.' };
  const nota = String((r && r.nota) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const base = { referencia: cobro.referencia, monto: cobro.monto, sucursal: cobro.sucursal, dia: cobro.dia, mes: String(cobro.dia || '').slice(0, 7), hora: cobro.hora || '', tipoPago: cobro.tipoPago || '', creada: String(cobro.creada || ''), resolucion: r.resolucion, nota };
  if (r.resolucion === 'manual') {
    if (!r.ventaId && nota.length < 3) return { error: 'Elija la venta o escriba en la nota cómo se registró.' };
    return { doc: { ...base, ...(r.ventaId ? { ventaId: String(r.ventaId) } : {}) } };
  }
  if (r.resolucion === 'descuadre') {
    if (!r.cajaId) return { error: 'Elija el cierre de caja de ese día.' };
    return { doc: { ...base, cajaId: String(r.cajaId) } };
  }
  return { doc: base };
}

// ── Firestore ──
let mem = null;
export function olvidar() { mem = null; }
// → [cobros pagados sin venta] (null si no se pudo preguntar al servidor de cobros)
export async function paraHoy({ forzar = false } = {}) {
  if (mem && !forzar && Date.now() - mem.t < 300000) return mem.lista.filter(c => !mem.hechos.has(c.referencia));
  const { api } = await import('./vista-point.js?v=0.138.0');
  const cobros = (await api({ accion: 'cobros_recientes' })).cobros || [];
  const refs = [...new Set(cobros.filter(c => c.estado === 'pagado' && TIENDAS[c.sucursal] && c.referencia).map(c => c.referencia))];
  const conVenta = new Set(), revisados = new Set();
  for (const t of trozos(refs)) {
    const [v, r] = await Promise.all([getDocs(query(collection(db, 'ventas'), where('pagoPoint.referencia', 'in', t))), getDocs(query(collection(db, 'point_revisiones'), where('referencia', 'in', t)))]);
    v.docs.forEach(d => { const x = d.data(); if (x.anulada !== true && x.pagoPoint) conVenta.add(x.pagoPoint.referencia); });
    r.docs.forEach(d => revisados.add(d.id));
  }
  mem = { t: Date.now(), lista: sinVenta(cobros, conVenta, revisados), hechos: new Set() };
  return mem.lista;
}
// Las ventas de esa tienda ese día (una consulta por la hora de la venta, solo al abrir "Ya se registró a mano")
export async function ventasDelDia(cobro) {
  const [y, m, d] = cobro.dia.split('-').map(Number);
  const sn = await getDocs(query(collection(db, 'ventas'), where('fecha', '>=', Timestamp.fromDate(new Date(y, m - 1, d))), where('fecha', '<', Timestamp.fromDate(new Date(y, m - 1, d + 1)))));
  return candidatasVenta(sn.docs.map(x => ({ id: x.id, ...x.data() })), cobro);
}
// Los cierres de esa tienda ese día (evaluacion_caja; uno por caja)
export async function cierresDelDia(cobro) {
  const dmy = cobro.dia.split('-').reverse().join('-');
  const sn = await getDocs(query(collection(db, 'evaluacion_caja'), where('fecha', 'in', [cobro.dia, dmy])));
  const porCaja = {};
  sn.docs.map(x => ({ id: x.id, ...x.data() })).filter(e => e.sucursal === cobro.sucursal).forEach(e => { porCaja[e.cajaId || e.id] = e; });
  return Object.values(porCaja);
}
export async function guardar(cobro, r) {
  const x = revisarResolucion(cobro, r);
  if (x.error) throw new Error(x.error);
  const ref = doc(db, 'point_revisiones', cobro.referencia);
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (sn.exists()) throw new Error('Ese cobro ya estaba revisado.');
    tx.set(ref, { ...x.doc, por: correo(), en: Timestamp.now() });
  });
  if (mem) mem.hechos.add(cobro.referencia);
  return x.doc;
}

// ── Pantalla: la línea de Pendientes y el diálogo "Revisar" ──
export function pendiente(c, pesos) {
  return { orden: 0.15, color: 'rojo', icono: 'alerta', chip: 'Revisar', origen: 'Point', titulo: 'Cobro del Point pagado sin venta', id: 'pt-rev-' + c.referencia.replace(/[^A-Za-z0-9_-]/g, ''),
    detalle: `${TIENDAS[c.sucursal]} · ${diaCorto(c.dia)} ${c.hora} · ${pesos(c.monto)} · ${tipoPagoTxt(c.tipoPago)} · ref. ${c.referencia}`, boton: { attr: 'data-point-rev', valor: c.referencia, texto: 'Revisar' } };
}
export function dialogoRevisar(cobro, H, alListo) {
  const { esc, pesos } = H;
  const d = H.dialogo(`<form class="form-dialogo pr-rev" novalidate><h2>Cobro del Point pagado sin venta</h2>
    <p class="ayuda"><b>${pesos(cobro.monto)} · ${esc(TIENDAS[cobro.sucursal])}</b> · ${esc(diaCorto(cobro.dia))} ${esc(cobro.hora)} · ${esc(tipoPagoTxt(cobro.tipoPago))}<br><small>Referencia ${esc(cobro.referencia)}</small></p>
    <p class="ayuda">Mercado Pago dice que se pagó, pero no hay una venta con este cobro. ¿Qué pasó?</p>
    <fieldset class="campo"><legend class="sr">Qué pasó</legend><div class="pr-opciones">
      ${Object.entries(RESOLUCIONES).map(([k, t]) => `<label class="eu-doc"><input type="radio" name="pr-res" value="${k}"><span class="eu-doc-t"><b>${esc(t)}</b><small>${esc({ manual: 'La venta se registró a mano (por ejemplo, con Débito sin la integración). Elija cuál.', descuadre: 'No se registró la venta y la caja cerró con esa diferencia. Finanzas la cuenta como venta de ese día y deja de ser faltante.', devuelto: 'El cobro se devolvió al cliente desde Mercado Pago.' }[k])}</small></span></label>`).join('')}
    </div></fieldset>
    <div id="pr-extra"></div>
    <div class="campo"><label for="pr-nota">Nota (opcional)</label><input id="pr-nota" maxlength="300"></div>
    <p class="ayuda">Queda guardado y no vuelve a aparecer. No se puede cambiar después.</p>
    <p class="error" id="pr-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="pr-no">Cancelar</button><button type="submit" class="btn" id="pr-si">Guardar</button></div></form>`);
  const extra = d.querySelector('#pr-extra'), err = d.querySelector('#pr-err'), b = d.querySelector('#pr-si');
  const cache = {};
  const pintarExtra = async res => {
    err.textContent = '';
    if (res === 'devuelto') { extra.innerHTML = ''; return; }
    extra.innerHTML = '<div class="vacio" style="border:0">Buscando…</div>';
    try {
      if (res === 'manual') {
        const l = cache.v || (cache.v = await ventasDelDia(cobro));
        if (d.querySelector('input[name="pr-res"]:checked').value !== res) return;
        extra.innerHTML = `<fieldset class="campo"><legend>La venta de ${esc(TIENDAS[cobro.sucursal])} de ese día</legend><div class="pr-lista">${l.slice(0, 40).map((v, i) => `<label class="eu-doc"><input type="radio" name="pr-venta" value="${esc(v.id)}" ${i === 0 && v.calza ? 'checked' : ''}><span class="eu-doc-t"><span class="gn-fila"><b>${pesos(v.total)} · ${esc(v.hora)}</b>${v.calza ? '<span class="chip c-verde chip-chico">Calza</span>' : ''}</span><small>${esc((v.lineas || []).slice(0, 3).map(x => x.nombre).join(', '))} · ${esc(v.medioPago ? medioTxt(v.medioPago) : (v.pagos || []).map(p => medioTxt(p.medio)).join(' + '))}</small></span></label>`).join('') || '<div class="vacio">No hay ventas de esa tienda ese día. Escriba en la nota cómo se registró.</div>'}</div></fieldset>`;
      } else {
        const l = cache.c || (cache.c = await cierresDelDia(cobro));
        if (d.querySelector('input[name="pr-res"]:checked').value !== res) return;
        extra.innerHTML = `<fieldset class="campo"><legend>El cierre de ${esc(TIENDAS[cobro.sucursal])} de ese día</legend><div class="pr-lista">${l.map((e, i) => `<label class="eu-doc"><input type="radio" name="pr-caja" value="${esc(e.cajaId || e.id)}" ${i === 0 && l.length === 1 ? 'checked' : ''}><span class="eu-doc-t"><b>Caja de ${esc(e.usuario || e.cerradoPor || '—')}</b><small>Diferencia en efectivo ${pesos(e.difEfectivo || 0)} · total ${pesos(e.difTotal || 0)}</small></span></label>`).join('') || '<div class="vacio">No hay cierres de esa tienda ese día. Si la caja sigue abierta, ciérrela primero.</div>'}</div></fieldset>`;
      }
    } catch (e) { extra.innerHTML = `<p class="error">${esc(e.message || H.mensajeError(e))}</p>`; }
  };
  d.querySelectorAll('input[name="pr-res"]').forEach(x => x.addEventListener('change', () => pintarExtra(x.value)));
  d.querySelector('#pr-no').onclick = () => d.close();
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); err.textContent = '';
    const val = n => (d.querySelector(`input[name="${n}"]:checked`) || {}).value || '';
    const r = { resolucion: val('pr-res'), ventaId: val('pr-venta'), cajaId: val('pr-caja'), nota: d.querySelector('#pr-nota').value };
    const x = revisarResolucion(cobro, r);
    if (x.error) { err.textContent = x.error; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await guardar(cobro, r);
      H.registrar('Point: revisó un cobro pagado sin venta', `${pesos(cobro.monto)} · ${TIENDAS[cobro.sucursal]} · ${cobro.dia} ${cobro.hora} · ${RESOLUCIONES[r.resolucion]} · ${cobro.referencia}`);
      d.close(); if (alListo) alListo(r);
    } catch (e) { err.textContent = e.message || H.mensajeError(e); b.disabled = false; b.textContent = 'Guardar'; }
  });
}
