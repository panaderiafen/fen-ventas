// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Flujo de caja · reglas puras, sin red  v0.124.0
//  Aprobado por Emmanuel el 1 nov 2026 (boceto "Boceto · Flujo de caja"; hoja de ruta, paso 13).
//  Percibido: cuenta la fecha en que la plata entra o sale (cargo, abono, pago en efectivo, venta del día). Semanas de lunes a
//  domingo (fechas de Chile, texto 'AAAA-MM-DD'). Las pasadas son REALES; la de hoy es real hasta hoy y esperada hasta el domingo;
//  las que vienen son ESPERADAS.
//  · Cuentas: cc (BancoEstado cuenta corriente), chequera, mp (Mercado Pago) y efectivo (cajas de venta + caja de administración +
//    lo que va de una a otra). Un TRASPASO entre cuentas propias (Mercado Pago → banco, depósito de efectivo, chequera → cuenta,
//    retiro de una caja a la caja de administración, sencillo) no es entrada ni salida: mueve la plata de cuenta. Si llegó un lado
//    y el otro todavía no (por ejemplo, el retiro de Mercado Pago sin la cartola del banco), la diferencia queda "en camino".
//  · Tarjeta de crédito = deuda: lo que se compra con ella no sale; sale el pago de la tarjeta.
//  · Lo esperado: documentos por pagar de Gastos, compromisos, cuotas de crédito, sueldos, Previred, F29 estimado, cobros de
//    empresas y ventas de las tiendas (promedio de 4 semanas o la meta). "Mover fecha" y lo anotado a mano son ajustes aparte:
//    el documento original no cambia.
//  Lo prueban pruebas/caja30/flujo-v01240.test.mjs (y la app completa, flujo-app-v01240.test.js).
// ═══════════════════════════════════════════════
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as GI from './gn-items.js?v=0.138.0';
import * as PC from './plan-cuentas.js?v=0.138.0';
import { FERIADOS } from './feriados-cl.js?v=0.138.0';

const s = v => String(v == null ? '' : v).trim();
const ent = v => { const x = Math.round(Number(v)); return isFinite(x) ? x : 0; };
const N = t => s(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const msDe = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : t && typeof t.seconds === 'number' ? t.seconds * 1000 : t && typeof t.__ts === 'number' ? t.__ts : 0);

export const INICIO = '2026-10-01';
// Saldos al empezar (30-09-2026, de claude/balance-apertura-insumos.md): $3.123.980 en total
export const APERTURA_DEF = { fecha: INICIO, chequera: 1714505, cc: 485437, mp: 630538, efectivo: 293500 };
export const CUENTAS = { cc: 'BancoEstado cuenta corriente', chequera: 'BancoEstado chequera', mp: 'Mercado Pago', efectivo: 'Efectivo' };
export const ORDEN_CUENTAS = ['chequera', 'cc', 'mp', 'efectivo'];
export const CONFIG_DEF = { apertura: APERTURA_DEF, mpDias: 0, adelante: 6 };
// Respaldo de la cuota del crédito Fogape (si Gastos → Créditos no tiene ningún crédito activo): día 20, el hábil siguiente
export const CREDITO_RESPALDO = { nombre: 'Crédito Fogape BancoEstado', monto: 334868, dia: 20, desde: { n: 15, fecha: '2026-11-20' } };
export const TOL_CUADRE = 1000;   // una diferencia de hasta $1.000 en una semana se toma como cuadrada (redondeos, comisiones)
export const DIAS_SIN_CONTAR = 7;

// Las filas (en este orden). Las de "sale" se muestran en positivo.
export const ENTRA = [['ventas', 'Ventas en tienda'], ['cobros', 'Cobros de empresas'], ['otros_in', 'Otros ingresos']];
export const SALE = [['proveedores', 'Proveedores'], ['sueldos', 'Sueldos y Previred'], ['impuestos', 'Impuestos (F29)'], ['arriendos', 'Arriendos y servicios'],
  ['credito', 'Crédito (cuota)'], ['tarjeta', 'Tarjeta de crédito (pago)'], ['retiros', 'Retiros del dueño'], ['inversiones', 'Inversiones'],
  ['difcaja', 'Diferencias de caja'], ['ajuste_ef', 'Efectivo sin anotar (conteo inicial)'], ['otros_out', 'Otros pagos']];
export const FILAS = Object.fromEntries([...ENTRA, ...SALE]);
export const esEntra = k => ENTRA.some(x => x[0] === k);
export const SUCURSALES = [['barros_arana', 'Barros Arana'], ['ainavillo', 'Ainavillo']];
export const textoSuc = k => (SUCURSALES.find(x => x[0] === k) || [])[1] || s(k);

// ═══════════════ Fechas ═══════════════
export const esDia = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
export function aDia(f) {
  const t = s(f); if (esDia(t)) return t;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[0];
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
const U = f => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
export const sumarDias = (f, n) => new Date(U(f) + n * 864e5).toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((U(b) - U(a)) / 864e5);
export const diaSemana = f => (new Date(U(f)).getUTCDay() + 6) % 7;   // 0 = lunes … 6 = domingo
export const lunesDe = f => sumarDias(f, -diaSemana(f));
export const hoyChile = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
export const esHabil = f => { const w = new Date(U(f)).getUTCDay(); return w !== 0 && w !== 6 && !FERIADOS.has(f); };
export const habilDesde = f => { let x = f; for (let i = 0; i < 12 && !esHabil(x); i++) x = sumarDias(x, 1); return x; };
export const habilAntes = f => { let x = f; for (let i = 0; i < 12 && !esHabil(x); i++) x = sumarDias(x, -1); return x; };
export const sigMes = m => { const [y, n] = m.split('-').map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };
export const mesAnt = m => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };
export const ultimoDia = m => { const [y, n] = m.split('-').map(Number); return new Date(Date.UTC(y, n, 0)).toISOString().slice(0, 10); };
const diaDelMes = (m, d) => `${m}-${String(Math.min(d, Number(ultimoDia(m).slice(8)))).padStart(2, '0')}`;
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const diaTxt = f => (esDia(f) ? `${Number(f.slice(8))} ${MESES[Number(f.slice(5, 7)) - 1]}` : '');
export const diaLargo = f => (esDia(f) ? `${DIAS[diaSemana(f)]} ${diaTxt(f)}` : '');
export const mesTxt = m => MESES_LARGOS[Number(String(m).slice(5, 7)) - 1] || s(m);
// "24–30 nov" · "27 oct–2 nov"
export function etiquetaSemana(desde, hasta) {
  const m1 = desde.slice(5, 7), m2 = hasta.slice(5, 7);
  return m1 === m2 ? `${Number(desde.slice(8))}–${Number(hasta.slice(8))} ${MESES[Number(m2) - 1]}` : `${diaTxt(desde)}–${diaTxt(hasta)}`;
}

// Las semanas que se ven: desde el inicio (o las últimas `atras` pasadas) hasta `adelante` semanas después de la de hoy
export function semanas({ hoy, inicio = INICIO, atras = 4, adelante = 6 } = {}) {
  const lHoy = lunesDe(hoy), lIni = lunesDe(inicio);
  let l = sumarDias(lHoy, -7 * Math.max(0, atras)); if (l < lIni) l = lIni;
  const fin = sumarDias(lHoy, 7 * Math.max(0, adelante)), out = [];
  for (; l <= fin; l = sumarDias(l, 7)) {
    const dom = sumarDias(l, 6), desde = l < inicio ? inicio : l;
    out.push({ lunes: l, domingo: dom, desde, tipo: dom < hoy ? 'pasada' : l > hoy ? 'futura' : 'actual', etiqueta: etiquetaSemana(desde, dom) });
  }
  return { lista: out, hayAntes: out.length > 0 && out[0].lunes > lIni };
}

// ═══════════════ De qué fila es un documento de Gastos (por su cuenta) ═══════════════
export function filaDeCuenta(c) {
  const x = s(c);
  if (!x) return '';
  if (x === '6.1' || x.startsWith('6.1.') || x === '2.8' || x === '2.3' || x === '2.4') return 'sueldos';
  if (x === '6.2' || x === '6.3') return 'arriendos';
  if (x.startsWith('2.5') || x.startsWith('1.3') || x === '2.9') return 'impuestos';
  if (x === '2.6' || x === '7.1') return 'credito';
  if (x.startsWith('1.5')) return 'inversiones';
  if (x === '2.2') return 'tarjeta';
  if (x === '7.2' || x === '7.3') return 'otros_out';
  return 'proveedores';
}
const RX_NOMBRE = [[/SUELDO|LIQUIDACION|PREVIRED|COTIZAC|HONORARIO|FINIQUITO/, 'sueldos'], [/ARRIENDO|PATENTE|LUZ|AGUA|GAS\b|INTERNET|TELEFON|CGE|ESSBIO/, 'arriendos'],
  [/F29|IMPUESTO|IVA|PPM|TGR|TESORERIA/, 'impuestos'], [/CREDITO|CUOTA|FOGAPE/, 'credito'], [/RETIRO DEL DUENO/, 'retiros']];
// ctx: { catalogo, provs, repartos } (lo de gn-fs.leer). → la fila de "sale"
export function filaDeDoc(d, ctx = {}) {
  if (!d) return 'proveedores';
  const o = s(d.origen);
  if (o === 'liquidacion' || o === 'previred' || o === 'bte') return 'sueldos';
  if (o === 'f29') return 'impuestos';
  if (o === 'credito') return 'credito';
  let partes = [];
  try { const c = GB.clasifDe(d, ctx.provs || {}, ctx.repartos || {}); partes = (c && c.partes) || []; } catch (e) { partes = []; }
  const I = ctx.I || (GI.activo(ctx.catalogo) ? GI.indice(ctx.catalogo) : null);
  const peso = {};
  partes.forEach(p => {
    const r = I ? GI.resolver(p.item, I) : null;
    let f = r && r.ok ? filaDeCuenta(r.cuenta) : '';
    if (!f) { const n = N(p.item); f = (RX_NOMBRE.find(([rx]) => rx.test(n)) || [])[1] || 'proveedores'; }
    peso[f] = (peso[f] || 0) + Math.abs(ent(p.monto));
  });
  const l = Object.entries(peso).sort((a, b) => b[1] - a[1]);
  if (l.length) return l[0][0];
  const n = N(d.razon + ' ' + d.tipoTexto);
  return (RX_NOMBRE.find(([rx]) => rx.test(n)) || [])[1] || 'proveedores';
}
const textoDoc = d => (d ? `${s(d.tipoTexto) || 'Documento'}${d.folio && d.origen !== 'credito' ? ' N° ' + s(d.folio) : ''} · ${s(d.razon) || 'sin nombre'}` : 'Documento');

// ═══════════════ Lo REAL (percibido) ═══════════════
// F: { gn: { docs, movs, pagos, catalogo, provs, repartos }, abonos, evals, cmovs, efmovs, mpVentas }
// cfg: { inicio, mpDias, apertura }. → { movs: [{ id, fecha, cuenta, monto (+ entra, − sale), fila|null (null = traspaso), texto, link, ... }], info }
const RUT_PROPIO = '77087176';
const pareceTraspaso = a => { const g = N(a.descripcion || a.descNorm); return g.replace(/\s/g, '').includes(RUT_PROPIO) || /MERCADO ?PAGO|MERCADOPAGO/.test(g); };
export function cierresUnicos(evals) {
  const ult = {};
  (evals || []).forEach(e => { const k = e.cajaId || e.id; if (!ult[k] || msDe(e.cierre) >= msDe(ult[k].cierre)) ult[k] = e; });
  return Object.values(ult);
}
export function pctComisionMp(mpVentas) {
  const b = (mpVentas || []).reduce((a, x) => a + ent(x.bruto), 0), c = (mpVentas || []).reduce((a, x) => a + ent(x.comision), 0);
  return b > 0 ? c / b : 0;
}
export const tarjetaDe = e => ent(e.sistDebito) + ent(e.sistCredito);

export function reales(F, cfg = {}) {
  const ini = cfg.inicio || INICIO, mpDias = Math.max(0, ent(cfg.mpDias)), out = [], info = { sinRevisarCargos: [], abonosPendientes: [], cardEstimada: 0, conteoInicial: null };
  const gn = F.gn || {}, docs = gn.docs || [], porId = Object.fromEntries(docs.map(d => [d.id, d]));
  const ctx = { catalogo: gn.catalogo, provs: gn.provs, repartos: gn.repartos }; ctx.I = GI.activo(ctx.catalogo) ? GI.indice(ctx.catalogo) : null;
  const filaDoc = id => filaDeDoc(porId[id], ctx);
  const I = GB.indicePagos(gn.pagos || []);
  const trabajadores = new Set(docs.filter(d => d.origen === 'liquidacion' || d.origen === 'bte').map(d => s(d.rutN)).filter(Boolean));
  const add = m => { if (m.monto && esDia(m.fecha) && m.fecha >= ini) out.push(m); };

  // 1. Cargos del banco y de Mercado Pago (Gastos). La tarjeta de crédito (tc) no: es deuda.
  const traspasosCargo = [];
  (gn.movs || []).forEach(m => {
    if (m.anterior || !['cc', 'chequera', 'mp'].includes(m.cuenta) || !esDia(m.fecha) || m.fecha < ini) return;
    const monto = ent(m.monto); if (!(monto > 0)) return;
    const base = { fecha: m.fecha, cuenta: m.cuenta, ref: m.id, glosa: s(m.glosa), link: '#gastos' };
    if (m.estado === 'no_va') {
      const mot = s(m.noVa && m.noVa.motivo); if (mot === 'repetido') return;
      add({ ...base, id: 'c_' + m.id, monto: -monto, fila: mot === 'no_empresa' ? 'retiros' : 'otros_out', texto: `${s(m.glosa)} · marcado "${GB.MOTIVOS_NO_VA[mot] || 'Esto no va'}"` });
      return;
    }
    const nat = s(m.naturaleza);
    if (nat === 'traspaso') { const x = { ...base, id: 'c_' + m.id, monto: -monto, fila: null, texto: `Traspaso entre cuentas propias · ${s(m.glosa)}` }; add(x); traspasosCargo.push(x); return; }
    if (nat === 'tarjeta') return add({ ...base, id: 'c_' + m.id, monto: -monto, fila: 'tarjeta', texto: `Pago de la tarjeta de crédito · ${s(m.glosa)}` });
    if (nat === 'retiro' || nat === 'devolucion' || nat === 'gasto_dueno') return add({ ...base, id: 'c_' + m.id, monto: -monto, fila: 'retiros', texto: `${GB.NO_GASTO[nat]} · ${s(m.glosa)}` });
    if (nat === 'otro') return add({ ...base, id: 'c_' + m.id, monto: -monto, fila: 'otros_out', texto: `${s(m.naturalezaNota) || 'Otro (no es gasto)'} · ${s(m.glosa)}` });
    if (nat === 'acuenta') { const a = m.aCuenta || {}; return add({ ...base, id: 'c_' + m.id, monto: -monto, fila: trabajadores.has(s(a.rut).toUpperCase().replace(/[^0-9K]/g, '')) ? 'sueldos' : 'proveedores', texto: `Pago a cuenta · ${s(a.razon || a.rut) || s(m.glosa)}` }); }
    const ps = I.porMov[m.id] || []; let usado = 0;
    ps.forEach((p, k) => { const v = ent(p.monto); usado += v; add({ ...base, id: `c_${m.id}_${k}`, monto: -v, fila: filaDoc(p.docId), texto: textoDoc(porId[p.docId]), docId: p.docId }); });
    const libre = monto - usado;
    if (libre > GB.TOLERANCIA || (libre > 0 && !ps.length)) { const x = { ...base, id: `c_${m.id}_libre`, monto: -libre, fila: 'otros_out', texto: `Sin revisar en Gastos · ${s(m.glosa)}`, sinRevisar: true }; add(x); info.sinRevisarCargos.push(x); }
    else if (libre && ps.length) { const u = out.filter(x => x.ref === m.id).pop(); if (u) u.monto -= libre; }   // redondeo de hasta $5: va con el último pago
  });

  // 2. Pagos en efectivo registrados en Gastos sin su movimiento en Efectivo (antes de Efectivo, o "Gasto sin banco" sin unir)
  (gn.pagos || []).forEach(p => {
    if (p.estado === 'deshecho' || p.medio !== 'efectivo' || p.efectivo || p.movId) return;
    const f = aDia(p.fecha); if (!f) return;
    add({ id: 'gp_' + (p.id || p.docId + f), fecha: f, cuenta: 'efectivo', monto: -ent(p.monto), fila: filaDoc(p.docId), texto: `${textoDoc(porId[p.docId])} · pagado en efectivo (Gastos)`, docId: p.docId, link: '#gastos', pagoGastos: true });
  });

  // 3. Abonos de la cartola (Ventas a empresas → Conciliación)
  const abonos = (F.abonos || []).filter(a => a && !a.quitadoEnPlanilla && a.estado !== 'repetido' && esDia(aDia(a.fecha)) && aDia(a.fecha) >= ini && ent(a.monto) > 0)
    .map(a => ({ ...a, fecha: aDia(a.fecha), cuenta: a.cuenta === 'cc' ? 'cc' : 'chequera' }));
  const parTraspaso = new Map(), usados = new Set();
  traspasosCargo.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(c => {
    const cand = abonos.filter(a => !usados.has(a.id) && !['conciliado', 'revisado'].includes(a.estado) && a.naturaleza !== 'deposito_efectivo' && ent(a.monto) === -c.monto && a.cuenta !== c.cuenta
      && diasEntre(c.fecha, a.fecha) >= 0 && diasEntre(c.fecha, a.fecha) <= 3).sort((x, y) => diasEntre(c.fecha, x.fecha) - diasEntre(c.fecha, y.fecha));
    if (cand.length) { usados.add(cand[0].id); parTraspaso.set(cand[0].id, c); }
  });
  abonos.forEach(a => {
    const monto = ent(a.monto), base = { id: 'a_' + a.id, ref: a.id, fecha: a.fecha, cuenta: a.cuenta, glosa: s(a.descripcion), link: '#b2b/conciliacion' };
    if (a.naturaleza === 'deposito_efectivo') return add({ ...base, monto, fila: null, texto: `Depósito de efectivo · ${s(a.descripcion)}` });
    if (a.estado === 'conciliado' || a.estado === 'revisado') return add({ ...base, monto, fila: 'cobros', texto: `${s(a.cliente) || 'Cliente B2B'} · ${s(a.descripcion)}` });
    if (parTraspaso.has(a.id) || pareceTraspaso(a)) return add({ ...base, monto, fila: null, texto: `Traspaso entre cuentas propias · ${s(a.descripcion)}` });
    const x = { ...base, monto, fila: 'otros_in', texto: `${s(a.descripcion)}${a.estado === 'pendiente' ? ' · sin revisar en Conciliación' : ''}`, sinRevisar: a.estado === 'pendiente' };
    add(x); if (a.estado === 'pendiente') info.abonosPendientes.push(x);
  });

  // 4. Ventas de las tiendas: efectivo (cada cierre), tarjeta (reporte de Mercado Pago por día; si no está, la caja menos la comisión
  //    promedio) y descuadres. La transferencia no: llega como abono al banco.
  const cierres = cierresUnicos(F.evals).map(e => ({ ...e, dia: aDia(e.fecha) })).filter(e => esDia(e.dia) && e.dia >= ini);
  const pct = pctComisionMp(F.mpVentas), mpDia = new Map((F.mpVentas || []).filter(x => esDia(x.fecha)).map(x => [x.fecha, x]));
  cierres.forEach(e => {
    const suc = textoSuc(e.sucursal), ef = ent(e.sistEfectivo);
    if (ef) add({ id: 'v_' + (e.cajaId || e.id), fecha: e.dia, cuenta: 'efectivo', monto: ef, fila: 'ventas', texto: `Ventas en efectivo · ${suc}`, sucursal: e.sucursal, link: '#caja' });
    const dif = ent(e.difEfectivo);
    if (dif && !e.sinArqueo) add({ id: 'dv_' + (e.cajaId || e.id), fecha: e.dia, cuenta: 'efectivo', monto: dif, fila: 'difcaja', texto: `${dif < 0 ? 'Faltó' : 'Sobró'} efectivo al cerrar · ${suc}${e.motivoDescuadre ? ' · ' + s(e.motivoDescuadre) : ''}`, link: '#efectivo/semana' });
    const tj = tarjetaDe(e);
    if (tj && !mpDia.has(e.dia)) { const neto = Math.round(tj * (1 - pct)); info.cardEstimada += neto; add({ id: 'vt_' + (e.cajaId || e.id), fecha: sumarDias(e.dia, mpDias), cuenta: 'mp', monto: neto, fila: 'ventas', texto: `Ventas con tarjeta · ${suc} (de la caja, menos la comisión promedio)`, sucursal: e.sucursal, venta: e.dia, link: '#caja' }); }
  });
  mpDia.forEach((x, f) => { if (f >= ini) add({ id: 'mp_' + f, fecha: sumarDias(f, mpDias), cuenta: 'mp', monto: ent(x.neto), fila: 'ventas', texto: `Ventas con tarjeta del ${diaTxt(f)} (reporte de Mercado Pago, sin comisión)`, venta: f, link: '#gastos' }); });

  // 5. Con la caja abierta (caja_movimientos): lo que sale o entra de afuera. Retiros a la caja de administración y sencillo: no.
  const efPorId = Object.fromEntries((F.efmovs || []).map(m => [m.id, m]));
  (F.cmovs || []).forEach(x => {
    if (x.anulado || !esDia(x.dia)) return;
    const monto = ent(x.monto), suc = textoSuc(x.sucursal), base = { id: 'cm_' + x.id, fecha: x.dia, cuenta: 'efectivo', link: '#efectivo' };
    if (x.tipo === 'retiro' && x.motivo === 'pago_proveedor') return add({ ...base, monto: -monto, fila: x.unido && x.unido.docId ? filaDoc(x.unido.docId) : 'proveedores', texto: `Pago desde la caja ${suc} · ${s(x.detalle) || 'proveedor'}${x.unido ? ' · ' + s(x.unido.documento) : ''}`, porUnir: x.estado === 'por_unir' });
    if (x.tipo === 'retiro' && !['cierre', 'caja_admin'].includes(x.motivo)) return add({ ...base, monto: -monto, fila: 'otros_out', texto: `Retiro de la caja ${suc} · ${s(x.detalle || x.nota) || 'otro'}` });
    if (x.tipo === 'ingreso' && x.motivo !== 'sencillo_admin') return add({ ...base, monto, fila: 'otros_in', texto: `${x.motivo === 'aporte_dueno' ? 'Aporte del dueño' : 'Ingreso'} en la caja ${suc}${x.detalle || x.nota ? ' · ' + s(x.detalle || x.nota) : ''}` });
  });

  // 6. Caja de administración (Efectivo). El conteo inicial ajusta el efectivo del sistema a lo contado (ver ajusteConteoInicial).
  const efs = (F.efmovs || []).filter(m => !m.anulado && esDia(m.dia) && (m.cuenta === undefined || m.cuenta === 'caja_admin'));
  const inicial = conteoInicial(efs);
  efs.forEach(m => {
    const monto = ent(m.monto), base = { id: 'ef_' + m.id, fecha: m.dia, cuenta: 'efectivo', link: '#efectivo' };
    if (m.tipo === 'conteo') {
      if (inicial && m.id === inicial.id) return;
      const dif = m.diferencia != null ? ent(m.diferencia) : 0;
      if (dif) add({ ...base, monto: dif, fila: 'difcaja', texto: `Conteo de la caja de administración: ${dif < 0 ? 'faltó' : 'sobró'}${m.corrige ? ' (corrige un conteo)' : ''}` });
      return;
    }
    if (m.tipo === 'ingreso') {
      if (m.motivo === 'retiro_caja') return;
      return add({ ...base, monto, fila: m.motivo === 'efectivo_b2b' ? 'cobros' : 'otros_in', texto: `${m.motivo === 'efectivo_b2b' ? 'Efectivo de cliente B2B' : m.motivo === 'aporte_dueno' ? 'Aporte del dueño' : 'Otro ingreso'}${m.detalle ? ' · ' + s(m.detalle) : ''}` });
    }
    if (m.tipo === 'salida') {
      if (m.motivo === 'sencillo_caja') return;
      if (m.motivo === 'deposito') return add({ ...base, monto: -monto, fila: null, texto: `Depósito al banco${m.unido ? '' : ' (todavía sin su abono)'}`, deposito: true });
      const fila = m.motivo === 'pago' ? (m.unido && m.unido.docId ? filaDoc(m.unido.docId) : 'proveedores') : m.motivo === 'retiro_dueno' ? 'retiros' : m.motivo === 'faltante' ? 'difcaja' : 'otros_out';
      return add({ ...base, monto: -monto, fila, texto: `${m.motivo === 'pago' ? 'Pago en efectivo' : m.motivo === 'retiro_dueno' ? 'Retiro del dueño' : m.motivo === 'faltante' ? 'Faltó al recibir' : 'Otra salida'}${m.detalle ? ' · ' + s(m.detalle) : ''}${m.unido && m.unido.documento ? ' · ' + s(m.unido.documento) : ''}`, porUnir: m.estado === 'por_unir' });
    }
  });
  if (inicial && inicial.dia >= ini) {
    const A = ajusteConteoInicial({ movs: out, apertura: cfg.apertura || APERTURA_DEF, inicial, efmovs: efs, evals: cierres, cmovs: F.cmovs || [] });
    info.conteoInicial = { dia: inicial.dia, monto: ent(inicial.monto), ajuste: A };
    if (A) out.push({ id: 'ef_inicial_' + inicial.id, fecha: inicial.dia, cuenta: 'efectivo', monto: A, fila: 'ajuste_ef', texto: 'Ajuste al conteo inicial de la caja de administración: el efectivo del sistema queda igual a lo contado (lo de antes que no quedó anotado)', ajusteInicial: true, link: '#efectivo' });
  }
  return { movs: out.sort((a, b) => a.fecha.localeCompare(b.fecha)), info };
}

// ── El efectivo contado ──
export function conteoInicial(efmovs) {
  const l = (efmovs || []).filter(m => !m.anulado && m.tipo === 'conteo' && m.inicial && !m.corrige).sort((a, b) => s(a.dia).localeCompare(s(b.dia)) || msDe(a.creado) - msDe(b.creado));
  return l[0] || null;
}
// El saldo de la caja de administración al terminar un día, como lo lleva Efectivo (desde su conteo inicial): { saldo, conteo } | null
export function libroAdminAl(efmovs, dia) {
  const ini = conteoInicial(efmovs); if (!ini || ini.dia > dia) return null;
  const l = (efmovs || []).filter(m => !m.anulado && esDia(m.dia) && m.dia <= dia).sort((a, b) => s(a.dia).localeCompare(s(b.dia)) || msDe(a.creado) - msDe(b.creado));
  let saldo = 0, conteo = null, empezo = false;
  l.forEach(m => {
    if (m.id === ini.id) { empezo = true; saldo = ent(m.monto); conteo = { dia: m.dia, monto: ent(m.monto) }; return; }
    if (!empezo) return;
    if (m.tipo === 'conteo') { saldo = ent(m.monto); conteo = { dia: m.dia, monto: ent(m.monto) }; return; }
    saldo += m.tipo === 'ingreso' ? ent(m.monto) : m.tipo === 'salida' ? -ent(m.monto) : 0;
  });
  return { saldo, conteo };
}
// El fondo que quedó en cada caja de venta en su último cierre hasta ese día
export function fondosAl(cierres, dia) {
  const out = {};
  cierresUnicos(cierres).map(e => ({ ...e, dia: e.dia || aDia(e.fecha) })).filter(e => esDia(e.dia) && e.dia <= dia).sort((a, b) => a.dia.localeCompare(b.dia) || msDe(a.cierre) - msDe(b.cierre))
    .forEach(e => { const f = e.fondo != null ? e.fondo : e.saldoSiguiente; out[e.sucursal] = { monto: f == null ? 0 : ent(f), dia: e.dia, sabido: f != null }; });
  return out;
}
// Lo que salió de una caja hacia la caja de administración hasta ese día y todavía no se recibía ese día
export function transitoAl(cmovs, efmovs, dia) {
  const recibido = {};
  (efmovs || []).forEach(m => { if (!m.anulado && m.tipo === 'ingreso' && m.motivo === 'retiro_caja' && m.origen && m.origen.cajaMovId) recibido[m.origen.cajaMovId] = m.dia; });
  return (cmovs || []).filter(x => !x.anulado && x.tipo === 'retiro' && ['cierre', 'caja_admin'].includes(x.motivo) && esDia(x.dia) && x.dia <= dia && !(recibido[x.id] && recibido[x.id] <= dia))
    .reduce((a, x) => a + ent(x.monto), 0);
}
// Ajuste del conteo inicial: (lo contado + lo anotado ese día después + fondos de las cajas + lo en camino) − el efectivo del sistema ese día
export function ajusteConteoInicial({ movs, apertura, inicial, efmovs, evals, cmovs }) {
  const D = inicial.dia, t0 = msDe(inicial.creado);
  const pool = ent(apertura.efectivo) + (movs || []).filter(m => m.cuenta === 'efectivo' && m.fecha <= D && !m.ajusteInicial).reduce((a, m) => a + m.monto, 0);
  let admin = ent(inicial.monto);
  (efmovs || []).filter(m => !m.anulado && m.dia === D && m.id !== inicial.id && msDe(m.creado) > t0).sort((a, b) => msDe(a.creado) - msDe(b.creado))
    .forEach(m => { admin = m.tipo === 'conteo' ? ent(m.monto) : admin + (m.tipo === 'ingreso' ? ent(m.monto) : m.tipo === 'salida' ? -ent(m.monto) : 0); });
  const fondos = Object.values(fondosAl(evals, D)).reduce((a, f) => a + f.monto, 0);
  return admin + fondos + transitoAl(cmovs, efmovs, D) - pool;
}

// ═══════════════ Lo ESPERADO ═══════════════
// Cada uno: { clave, fecha ('' = sin fecha), monto (> 0), sentido 'entra'|'sale', fila, que, deDonde, estado 'fecha'|'estimado'|'movido',
//   fuente, link, nota?, noMover?, revisar? }
const item = x => ({ estado: 'fecha', deDonde: 'Banco', nota: '', ...x, monto: Math.max(0, ent(x.monto)) });
// Plazo de pago de cada proveedor (en días), de lo que ya se pagó: la mediana entre la fecha del documento y la de su pago
export function plazosProveedores(docs, pagos) {
  const porDoc = Object.fromEntries((docs || []).map(d => [d.id, d])), dias = {};
  (pagos || []).filter(p => p.estado !== 'deshecho' && esDia(aDia(p.fecha))).forEach(p => { const d = porDoc[p.docId]; if (!d || !esDia(d.fecha) || !s(d.rutN)) return; const k = diasEntre(d.fecha, aDia(p.fecha)); if (k >= 0 && k <= 120) (dias[d.rutN] = dias[d.rutN] || []).push(k); });
  const out = {}; Object.entries(dias).forEach(([r, l]) => { if (l.length >= 2) { l.sort((a, b) => a - b); out[r] = l[Math.floor(l.length / 2)]; } });
  return out;
}
// 1. Documentos de Gastos con saldo por pagar
export function esperadosDocs(gn, { hoy } = {}) {
  const docs = gn.docs || [], I = GB.indicePagos(gn.pagos || []), plazos = plazosProveedores(docs, gn.pagos || []), out = [];
  const ctx = { catalogo: gn.catalogo, provs: gn.provs, repartos: gn.repartos }; ctx.I = GI.activo(ctx.catalogo) ? GI.indice(ctx.catalogo) : null;
  const porId = Object.fromEntries(docs.map(d => [d.id, d])), ultCuenta = {};
  (gn.pagos || []).filter(p => p.estado !== 'deshecho').forEach(p => { const d = porId[p.docId]; if (d && s(d.rutN)) ultCuenta[d.rutN] = p.medio === 'efectivo' ? 'Efectivo' : p.cuenta === 'mp' ? 'Mercado Pago' : 'Banco'; });
  docs.forEach(d => {
    if (d.estado === 'no_va' || d.nc || ent(d.total) <= 0) return;
    const e = GB.estadoDoc(d, I); if (!(e.saldo > GB.TOLERANCIA)) return;
    let fecha = esDia(d.vence) ? d.vence : '', como = 'vence';
    if (!fecha && plazos[d.rutN] != null && esDia(d.fecha)) { fecha = sumarDias(d.fecha, plazos[d.rutN]); como = 'plazo'; }
    if (!fecha && (d.origen === 'compromiso' || d.origen === 'credito' || d.origen === 'previred' || d.origen === 'f29' || d.origen === 'liquidacion') && esDia(d.fecha)) { fecha = d.fecha; como = 'fecha'; }
    out.push(item({ clave: 'doc:' + d.id, fecha, monto: e.saldo, sentido: 'sale', fila: filaDeDoc(d, ctx), que: `${textoDoc(d)}${e.estado === 'a_medias' ? ' (queda por pagar)' : ''}${d.anterior ? ' · deuda anterior' : ''}`,
      deDonde: ultCuenta[d.rutN] || 'Banco', fuente: { tipo: 'doc', id: d.id, como, plazo: plazos[d.rutN] }, link: '#gastos' }));
  });
  return out;
}
// 2. Compromisos (arriendos, patentes, seguros) de los meses que vienen (los del mes en curso ya son documentos)
export function esperadosCompromisos(comps, docs, { hoy, hasta, ctx = {} } = {}) {
  const ya = new Set((docs || []).map(d => d.id)), out = [];
  (comps || []).filter(c => c.estado !== 'archivado' && ent(c.monto) > 0).forEach(c => {
    const meses = GB.mesesDe(c);
    for (let m = hoy.slice(0, 7); m <= hasta.slice(0, 7); m = sigMes(m)) {
      if (meses && !meses.includes(Number(m.slice(5)))) continue;
      if (s(c.desde) && s(c.desde).slice(0, 7) > m) continue;
      const d = GB.docDeCompromiso(c, m); if (ya.has(d.id) || d.fecha < hoy || d.fecha > hasta) continue;
      out.push(item({ clave: 'cmp:' + c.id + ':' + m, fecha: d.fecha, monto: d.total, sentido: 'sale', fila: filaDeDoc({ ...d, clasif: c.item ? { item: c.item, partes: [{ item: c.item, area: 'ADMIN', monto: d.total }] } : null }, ctx), que: `${s(c.nombre) || 'Compromiso'}${s(c.aQuien) ? ' · ' + s(c.aQuien) : ''}`, deDonde: 'Banco', fuente: { tipo: 'compromiso', id: c.id, mes: m }, link: '#gastos/porpagar' }));
    }
  });
  return out;
}
// 3. Cuotas de crédito (Gastos → Créditos); si no hay ninguno activo, el respaldo (Fogape, día 20)
export function esperadosCuotas(creds, docs, { hoy, hasta, respaldo = CREDITO_RESPALDO } = {}) {
  const ya = new Set((docs || []).map(d => d.id)), out = [], activos = (creds || []).filter(c => c.estado !== 'archivado' && (c.cuotas || []).length);
  activos.forEach(cr => (cr.cuotas || []).forEach(c => {
    const f = aDia(c.fecha); if (!esDia(f) || f < hoy || f > hasta || ya.has(GB.idCuotaDoc(cr.id, c.n))) return;
    out.push(item({ clave: `cuota:${cr.id}:${c.n}`, fecha: f, monto: c.monto, sentido: 'sale', fila: 'credito', que: `Cuota ${c.n} de ${cr.cuotas.length} · ${s(cr.nombre) || 'Crédito'}`, fuente: { tipo: 'cuota', id: cr.id, n: c.n }, link: '#gastos' }));
  }));
  if (!activos.length && respaldo && ent(respaldo.monto) > 0) {
    let n = respaldo.desde.n, m = respaldo.desde.fecha.slice(0, 7);
    for (let i = 0; i < 24 && m <= hasta.slice(0, 7); i++, n++, m = sigMes(m)) {
      const f = habilDesde(diaDelMes(m, respaldo.dia)); if (f < hoy || f > hasta) continue;
      out.push(item({ clave: `cuota:respaldo:${n}`, fecha: f, monto: respaldo.monto, sentido: 'sale', fila: 'credito', estado: 'estimado', que: `Cuota ${n} · ${respaldo.nombre} (no está en Gastos → Créditos)`, fuente: { tipo: 'cuota_respaldo', n }, link: '#gastos' }));
    }
  }
  return out;
}
// 4. Sueldos: lo que se le pagó a cada trabajador el mes anterior (su última liquidación), el último día hábil del mes.
//    Desde el 25: "Revisar sueldos de <mes>". 5. Previred: el 13 (hábil), lo del mes anterior.
export function esperadosSueldos(docs, { hoy, hasta } = {}) {
  const liqs = (docs || []).filter(d => d.origen === 'liquidacion' && d.estado !== 'no_va' && /^\d{4}-\d{2}$/.test(s(d.mes)));
  const out = [];
  for (let m = hoy.slice(0, 7); m <= hasta.slice(0, 7); m = sigMes(m)) {
    const f = habilAntes(ultimoDia(m)); if (f < hoy || f > hasta) continue;
    const porRut = {};
    liqs.filter(d => d.mes < m && d.mes >= mesAnt(mesAnt(m))).forEach(d => { const k = s(d.rutN) || s(d.razon); if (!porRut[k] || d.mes > porRut[k].mes) porRut[k] = d; });
    const ya = new Set(liqs.filter(d => d.mes === m).map(d => s(d.rutN) || s(d.razon)));
    const l = Object.entries(porRut).filter(([k]) => !ya.has(k)).map(([, d]) => d);
    if (!l.length) continue;
    const total = l.reduce((a, d) => a + ent(d.total), 0);
    out.push(item({ clave: 'sueldos:' + m, fecha: f, monto: total, sentido: 'sale', fila: 'sueldos', estado: 'estimado', que: `Sueldos de ${mesTxt(m)} · ${l.length} ${l.length === 1 ? 'persona' : 'personas'} (como la última liquidación)`,
      fuente: { tipo: 'sueldos', mes: m, personas: l.map(d => ({ nombre: s(d.razon), monto: ent(d.total), mes: d.mes })) }, link: '#gastos/equipo', revisar: hoy >= `${m}-25` ? m : '' }));
  }
  return out;
}
export function esperadosPrevired(docs, { hoy, hasta } = {}) {
  const prs = (docs || []).filter(d => d.origen === 'previred' && d.estado !== 'no_va' && /^\d{4}-\d{2}$/.test(s(d.mes))), out = [];
  for (let m = mesAnt(hoy.slice(0, 7)); m <= hasta.slice(0, 7); m = sigMes(m)) {
    const f = habilDesde(`${sigMes(m)}-13`); if (f < hoy || f > hasta || prs.some(d => d.mes === m)) continue;
    const ant = prs.filter(d => d.mes < m).sort((a, b) => b.mes.localeCompare(a.mes))[0];
    if (!ant) { out.push(item({ clave: 'previred:' + m, fecha: f, monto: 0, sentido: 'sale', fila: 'sueldos', estado: 'estimado', que: `Previred de ${mesTxt(m)} · sin datos (no hay un Previred anterior)`, sinDatos: true, fuente: { tipo: 'previred', mes: m }, link: '#gastos/previred' })); continue; }
    out.push(item({ clave: 'previred:' + m, fecha: f, monto: ant.total, sentido: 'sale', fila: 'sueldos', estado: 'estimado', que: `Previred de ${mesTxt(m)} (como el de ${mesTxt(ant.mes)})`, fuente: { tipo: 'previred', mes: m }, link: '#gastos/previred' }));
  }
  return out;
}
// 6. F29: IVA del mes (débito − crédito, sin bajar de 0) + lo fijo del último F29 (PPM, retención, impuesto único). Se paga el 20 (hábil).
//    Un mes que no ha terminado usa el último mes completo. Se reemplaza solo cuando el F29 real está en Gastos.
export const ITEMS_F29_FIJOS = ['PPM (F29)', 'RETENCION BOLETAS DE TERCEROS (F29)', 'IMPUESTO UNICO TRABAJADORES (F29)'];
export function ivaDelMes(mes, { cierres = [], ordenes = [], docs = [] } = {}) {
  const bruto = cierresUnicos(cierres).filter(e => aDia(e.fecha).slice(0, 7) === mes).reduce((a, e) => a + ent(e.sistTotal), 0);
  const b2b = (ordenes || []).filter(o => o.estado !== 'anulada' && aDia(o.fecha).slice(0, 7) === mes).reduce((a, o) => a + Math.max(0, ent(o.total) - ent(o.neto)), 0);
  const credito = (docs || []).filter(d => d.origen === 'sii' && d.estado !== 'no_va' && s(d.mes) === mes).reduce((a, d) => a + ent(d.iva), 0);
  const debito = Math.round(bruto * 19 / 119) + b2b;
  return { mes, debito, credito, iva: Math.max(0, debito - credito), hayVentas: bruto > 0 || b2b > 0 };
}
export function esperadosF29(docs, { hoy, hasta, cierres = [], ordenes = [] } = {}) {
  const f29s = (docs || []).filter(d => d.origen === 'f29' && d.estado !== 'no_va' && /^\d{4}-\d{2}$/.test(s(d.mes))), out = [];
  const ult = f29s.slice().sort((a, b) => b.mes.localeCompare(a.mes))[0];
  const fijo = ult ? ((ult.clasif && ult.clasif.partes) || []).filter(p => ITEMS_F29_FIJOS.includes(s(p.item))).reduce((a, p) => a + ent(p.monto), 0) : 0;
  const mesHoy = hoy.slice(0, 7);
  for (let m = mesAnt(mesHoy); m <= hasta.slice(0, 7); m = sigMes(m)) {
    const f = habilDesde(`${sigMes(m)}-20`); if (f < hoy || f > hasta || f29s.some(d => d.mes === m) || m < INICIO.slice(0, 7)) continue;
    const base = m < mesHoy ? m : mesAnt(mesHoy) >= INICIO.slice(0, 7) ? mesAnt(mesHoy) : m;
    const iv = ivaDelMes(base, { cierres, ordenes, docs });
    if (!iv.hayVentas) { out.push(item({ clave: 'f29:' + m, fecha: f, monto: 0, sentido: 'sale', fila: 'impuestos', estado: 'estimado', que: `F29 de ${mesTxt(m)} · sin datos para estimar`, sinDatos: true, fuente: { tipo: 'f29', mes: m }, link: '#gastos' })); continue; }
    out.push(item({ clave: 'f29:' + m, fecha: f, monto: iv.iva + fijo, sentido: 'sale', fila: 'impuestos', estado: 'estimado',
      que: `F29 de ${mesTxt(m)}: IVA ${base === m ? 'del mes' : 'como ' + mesTxt(base)} (débito $${iv.debito.toLocaleString('es-CL')} − crédito $${iv.credito.toLocaleString('es-CL')})${ult ? ` + PPM y retenciones como ${mesTxt(ult.mes)}` : ' · sin PPM (no hay un F29 anterior)'}`,
      fuente: { tipo: 'f29', mes: m, base, ...iv, fijo }, link: '#gastos' }));
  }
  return out;
}
// 7. Cobros de empresas: cada folio por cobrar con su vencimiento (fecha + días acordados); "4 pagos semanales": 4 pagos en las 4
//    primeras semanas del mes siguiente a la factura. Un cobro atrasado va a hoy.
export const PLAZO = { diaria: 0, semanal: 0, mensual: 0, '30dias': 30, '4 pagos semanales': 30 };
export const cuotasSemanales = total => { const t = ent(total), resto = Math.floor(t / 4); return [t - 3 * resto, resto, resto, resto]; };
export function esperadosCobros(porCliente, clientes, { hoy } = {}) {
  const out = [], cli = Object.fromEntries((clientes || []).map(c => [c.id, c]));
  Object.entries(porCliente || {}).forEach(([cid, folios]) => (folios || []).forEach(f => {
    const c = cli[cid] || {}, frec = s(c.frecuenciaPago).toLowerCase(), base = { sentido: 'entra', fila: 'cobros', deDonde: 'Banco', link: '#b2b/cobranza', fuente: { tipo: 'folio', folio: f.folio, cliente: cid } };
    if (!esDia(f.fecha)) { out.push(item({ ...base, clave: 'folio:' + f.folio, fecha: '', monto: f.saldo, que: `Folio ${f.folio} · ${s(c.nombre || f.cliente)}` })); return; }
    if (frec === '4 pagos semanales') {
      const ini = `${sigMes(f.fecha.slice(0, 7))}-01`; let pagado = ent(f.abonado);
      cuotasSemanales(f.total).forEach((q, i) => { const r = Math.max(0, q - pagado); pagado = Math.max(0, pagado - q); if (r > 0) out.push(item({ ...base, clave: `folio:${f.folio}:${i + 1}`, fecha: sumarDias(ini, 7 * i), monto: r, que: `Folio ${f.folio} · ${s(c.nombre || f.cliente)} · pago ${i + 1} de 4` })); });
      return;
    }
    out.push(item({ ...base, clave: 'folio:' + f.folio, fecha: sumarDias(f.fecha, PLAZO[frec] || 0), monto: f.saldo, que: `Folio ${f.folio} · ${s(c.nombre || f.cliente)}` }));
  }));
  return out;
}
// 8. Ventas de las tiendas que vienen: por tienda y semana, el promedio del mismo día de la semana de las últimas 4 semanas
//    (efectivo + tarjeta menos la comisión), o la meta de la semana (repartida como el promedio). Un día ya cerrado no se espera.
export function ventasDiarias(cierres, mpVentas) {
  const pct = pctComisionMp(mpVentas), out = {};
  cierresUnicos(cierres).forEach(e => { const d = aDia(e.fecha); if (!esDia(d) || !e.sucursal) return; const k = e.sucursal + '|' + d; out[k] = (out[k] || 0) + ent(e.sistEfectivo) + Math.round(tarjetaDe(e) * (1 - pct)); });
  return out;
}
export function promedioDia(diarias, suc, dow, { hoy, inicio = INICIO } = {}) {
  let d = sumarDias(hoy, -1); while (diaSemana(d) !== dow) d = sumarDias(d, -1);
  const xs = []; for (let i = 0; i < 4 && d >= inicio; i++, d = sumarDias(d, -7)) xs.push(diarias[suc + '|' + d] || 0);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}
export function metaDe(metas, suc, lunes) {
  const l = ((metas || {})[suc] || []).filter(x => s(x.desde) <= lunes).sort((a, b) => s(a.desde).localeCompare(s(b.desde)) || msDe(a.en) - msDe(b.en) || s(a.en).localeCompare(s(b.en)));
  const u = l[l.length - 1]; return u && ent(u.monto) > 0 ? ent(u.monto) : 0;
}
export function esperadosVentas(cierres, mpVentas, { hoy, hasta, metas = {}, modo = 'estimado', inicio = INICIO } = {}) {
  const diarias = ventasDiarias(cierres, mpVentas), cerrado = new Set(cierresUnicos(cierres).map(e => e.sucursal + '|' + aDia(e.fecha))), out = [];
  for (let l = lunesDe(hoy); l <= hasta; l = sumarDias(l, 7)) {
    const dom = sumarDias(l, 6);
    SUCURSALES.forEach(([suc, nombre]) => {
      const prom = [0, 1, 2, 3, 4, 5, 6].map(k => promedioDia(diarias, suc, k, { hoy, inicio }));
      const semana = prom.reduce((a, x) => a + (x || 0), 0), dias = [];
      for (let d = l < hoy ? hoy : l; d <= dom; d = sumarDias(d, 1)) if (!cerrado.has(suc + '|' + d)) dias.push(d);
      if (!dias.length) return;
      const est = dias.reduce((a, d) => a + (prom[diaSemana(d)] || 0), 0), meta = metaDe(metas, suc, l);
      if (modo === 'meta' && meta) {
        const parte = semana > 0 ? est / semana : dias.length / 7, monto = Math.round(meta * parte);
        out.push(item({ clave: `ventas:${suc}:${l}`, fecha: dias[0], hastaDia: dom, monto, sentido: 'entra', fila: 'ventas', estado: 'estimado', deDonde: 'Efectivo y Mercado Pago', noMover: true,
          que: `Ventas en tienda ${nombre} · meta${dias.length < 7 ? ' (la parte de ' + dias.length + (dias.length === 1 ? ' día)' : ' días)') : ''} (promedio $${est.toLocaleString('es-CL')})`, fuente: { tipo: 'ventas', suc, lunes: l, meta, promedio: est }, link: '#caja' }));
        return;
      }
      if (!(est > 0)) return;
      out.push(item({ clave: `ventas:${suc}:${l}`, fecha: dias[0], hastaDia: dom, monto: est, sentido: 'entra', fila: 'ventas', estado: 'estimado', deDonde: 'Efectivo y Mercado Pago', noMover: true,
        que: `Ventas en tienda ${nombre} · promedio de 4 semanas${dias.length < 7 ? ' (' + dias.length + (dias.length === 1 ? ' día)' : ' días)') : ''}${meta ? ` (meta $${meta.toLocaleString('es-CL')})` : ''}`, fuente: { tipo: 'ventas', suc, lunes: l, meta, promedio: est }, link: '#caja' }));
    });
  }
  return out;
}
// Ajustes guardados (fin_flujo_ajustes): "mover" (otra fecha y/o monto, sin tocar el documento) y "manual" (un pago o cobro anotado)
export function aplicarAjustes(items, ajustes) {
  const vivos = (ajustes || []).filter(a => a && a.estado !== 'anulado'), mover = {};
  vivos.filter(a => a.tipo === 'mover').forEach(a => { const p = mover[a.clave]; if (!p || s(a.en) >= s(p.en)) mover[a.clave] = a; });
  const out = (items || []).map(x => {
    const a = mover[x.clave]; if (!a) return x;
    const y = { ...x, ajuste: { id: a.id, nota: s(a.nota), por: s(a.por), en: s(a.en) }, estado: 'movido', fechaOriginal: x.fecha, montoOriginal: x.monto };
    if (esDia(a.fecha)) y.fecha = a.fecha;
    if (a.monto !== undefined && a.monto !== null && a.monto !== '') { y.monto = Math.max(0, ent(a.monto)); y.revisado = true; }
    return y;
  });
  vivos.filter(a => a.tipo === 'manual').forEach(a => out.push(item({ clave: 'manual:' + a.id, fecha: esDia(a.fecha) ? a.fecha : '', monto: a.monto, sentido: a.sentido === 'entra' ? 'entra' : 'sale',
    fila: FILAS[a.fila] && esEntra(a.fila) === (a.sentido === 'entra') ? a.fila : a.sentido === 'entra' ? 'otros_in' : 'otros_out', que: `${s(a.que) || 'Anotado a mano'} · anotado a mano`, deDonde: s(a.deDonde) || 'Banco',
    nota: s(a.nota), manual: true, fuente: { tipo: 'manual', id: a.id }, ajuste: { id: a.id, nota: s(a.nota), por: s(a.por), en: s(a.en) } })));
  return out;
}

// ═══════════════ La tabla de semanas ═══════════════
// apertura: { fecha, cc, chequera, mp, efectivo }; reales: los movs de reales(); esperados: los items (ya con ajustes)
export const totalApertura = a => ORDEN_CUENTAS.reduce((x, k) => x + ent((a || {})[k]), 0);
export function armar({ apertura = APERTURA_DEF, reales: R = [], esperados = [], hoy, lista, metas = {} }) {
  const ap = apertura || APERTURA_DEF, desde0 = ap.fecha || INICIO;
  const reales = R.filter(m => m.fecha >= desde0);
  const hasta = lista.length ? lista[lista.length - 1].domingo : hoy;
  // Lo real con fecha después de hoy (Mercado Pago que libera después) pasa a esperado
  const futuros = reales.filter(m => m.fecha > hoy && m.fila).map(m => item({ clave: 'real:' + m.id, fecha: m.fecha, monto: Math.abs(m.monto), sentido: m.monto > 0 ? 'entra' : 'sale', fila: m.fila, que: m.texto + ' · por liberar', deDonde: CUENTAS[m.cuenta], noMover: true, fuente: { tipo: 'real' } }));
  const hechos = reales.filter(m => m.fecha <= hoy);
  const esp = esperados.concat(futuros).map(x => ({ ...x, fechaEf: !esDia(x.fecha) ? '' : x.fecha < hoy ? hoy : x.fecha, atrasado: esDia(x.fecha) && x.fecha < hoy }));
  const sinFecha = esp.filter(x => !x.fechaEf), conFecha = esp.filter(x => x.fechaEf && x.fechaEf <= hasta && x.monto > 0);
  let saldo = totalApertura(ap) + hechos.filter(m => lista.length && m.fecha < lista[0].desde && m.fila).reduce((a, m) => a + m.monto, 0);
  const semanasOut = lista.map(w => {
    const filas = {}; [...ENTRA, ...SALE].forEach(([k]) => { filas[k] = { real: 0, esp: 0, movs: [], items: [] }; });
    hechos.filter(m => m.fila && m.fecha >= w.desde && m.fecha <= w.domingo).forEach(m => { const f = filas[m.fila]; f.real += esEntra(m.fila) ? m.monto : -m.monto; f.movs.push(m); });
    conFecha.filter(x => x.fechaEf >= w.lunes && x.fechaEf <= w.domingo && x.fechaEf >= hoy).forEach(x => { const f = filas[x.fila]; f.esp += x.monto; f.items.push(x); });
    const ini = saldo;
    const entra = ENTRA.reduce((a, [k]) => a + filas[k].real + filas[k].esp, 0), sale = SALE.reduce((a, [k]) => a + filas[k].real + filas[k].esp, 0);
    saldo = ini + entra - sale;
    const meta = SUCURSALES.reduce((a, [k]) => a + metaDe(metas, k, w.lunes), 0);
    return { ...w, ini, fin: saldo, entra, sale, filas, meta, enRojo: saldo < 0 };
  });
  const visibles = [...ENTRA, ...SALE].map(([k]) => k).filter(k => semanasOut.some(w => w.filas[k].real || w.filas[k].esp || w.filas[k].movs.length || w.filas[k].items.length));
  // Plata disponible hoy, por cuenta (con los traspasos) y lo que va en camino entre cuentas
  const porCuenta = {}; ORDEN_CUENTAS.forEach(k => { porCuenta[k] = ent(ap[k]); });
  let camino = 0;
  hechos.forEach(m => { porCuenta[m.cuenta] = (porCuenta[m.cuenta] || 0) + m.monto; if (!m.fila) camino -= m.monto; });
  const dentro = conFecha.filter(x => x.fechaEf >= hoy);
  const actual = semanasOut.find(w => w.tipo === 'actual');
  const rojo = semanasOut.find(w => w.tipo !== 'pasada' && w.enRojo) || null;
  return { semanas: semanasOut, visibles, sinFecha, esperados: dentro.sort((a, b) => a.fechaEf.localeCompare(b.fechaEf) || b.monto - a.monto), hoy,
    disponible: { porCuenta, camino, total: ORDEN_CUENTAS.reduce((a, k) => a + porCuenta[k], 0) + camino, banco: porCuenta.cc + porCuenta.chequera },
    porCobrar: dentro.filter(x => x.fila === 'cobros').reduce((a, x) => a + x.monto, 0), porPagar: dentro.filter(x => x.sentido === 'sale').reduce((a, x) => a + x.monto, 0),
    rojo: rojo ? { semana: rojo, razon: razonRojo(rojo) } : null, actual };
}
export function razonRojo(w) {
  const mayor = SALE.map(([k, t]) => ({ k, t, v: w.filas[k].real + w.filas[k].esp })).sort((a, b) => b.v - a.v)[0];
  const neto = w.entra - w.sale;
  const base = neto < 0 ? `Sale $${Math.abs(neto).toLocaleString('es-CL')} más de lo que entra` : `Empieza con $${w.ini.toLocaleString('es-CL')}`;
  return mayor && mayor.v > 0 ? `${base}; lo más grande: ${mayor.t} $${mayor.v.toLocaleString('es-CL')}.` : base + '.';
}

// ═══════════════ Cuadre de cada semana cerrada ═══════════════
// El saldo de un banco al terminar un día, de los saldos de cada movimiento (cargos y abonos de la cartola). Dentro de un día el orden no
// se sabe: el último es el saldo que no es "saldo anterior" de ningún otro movimiento de ese día.
export function saldoFinDia(movsDia) {
  const l = (movsDia || []).filter(m => m.saldo !== undefined && m.saldo !== null && m.saldo !== ''); if (!l.length) return null;
  const antes = new Set(l.map(m => ent(m.saldo) - ent(m.abono) + ent(m.cargo)));
  const fin = l.filter(m => !antes.has(ent(m.saldo)));
  return ent((fin.length ? fin : l)[(fin.length ? fin : l).length - 1].saldo);
}
// puntos: { cuenta: [{ fecha, saldo, cargo, abono }] }; finales: { cuenta: [{ hasta, final }] } (cuadre de cada cartola); cobertura: { cuenta: hasta }
export function saldoCartolaAl(cuenta, dia, { puntos = {}, finales = {}, cobertura = {} } = {}) {
  if (!(s(cobertura[cuenta]) >= dia)) return null;
  const l = (puntos[cuenta] || []).filter(p => esDia(p.fecha) && p.fecha <= dia);
  const fin = (finales[cuenta] || []).filter(k => esDia(k.hasta) && k.hasta <= dia && k.final !== undefined && k.final !== null).sort((a, b) => a.hasta.localeCompare(b.hasta)).pop();
  const ult = l.map(p => p.fecha).sort().pop();
  if (fin && (!ult || fin.hasta >= ult)) return ent(fin.final);
  if (!ult) {   // sin movimientos hasta ese día: el saldo inicial de una cartola que ya había empezado
    const ini = (finales[cuenta] || []).filter(k => esDia(k.desde) && k.desde <= dia && s(k.hasta) >= dia && k.inicial !== undefined && k.inicial !== null).sort((a, b) => a.desde.localeCompare(b.desde))[0];
    return ini ? ent(ini.inicial) : null;
  }
  return saldoFinDia(l.filter(p => p.fecha === ult));
}
// Mercado Pago: el saldo después del último pago con su saldo + las ventas que se liberaron después (aproximado)
export function saldoMpAl(dia, { movsMp = [], mpVentas = [], cobertura = '' , mpDias = 0 } = {}) {
  if (!(s(cobertura) >= dia)) return null;
  const l = movsMp.filter(m => esDia(m.fecha) && m.fecha <= dia && m.saldo !== undefined && m.saldo !== null).sort((a, b) => a.fecha.localeCompare(b.fecha) || s(a.hora).localeCompare(s(b.hora)));
  const u = l[l.length - 1]; if (!u) return null;
  return ent(u.saldo) + (mpVentas || []).filter(x => esDia(x.fecha) && sumarDias(x.fecha, mpDias) > u.fecha && sumarDias(x.fecha, mpDias) <= dia).reduce((a, x) => a + ent(x.neto), 0);
}
// datos: { apertura, reales, puntos, finales, cobertura, movsMp, mpVentas, mpDias, efmovs, cierres, cmovs, gn, abonos }
export function cuadre(lista, hoy, datos) {
  const ap = datos.apertura || APERTURA_DEF, R = (datos.reales || []).filter(m => m.fecha >= (ap.fecha || INICIO));
  return lista.filter(w => w.domingo < hoy).map(w => {
    const dom = w.domingo, hasta = R.filter(m => m.fecha <= dom);
    const sis = {}; ORDEN_CUENTAS.forEach(k => { sis[k] = ent(ap[k]) + hasta.filter(m => m.cuenta === k).reduce((a, m) => a + m.monto, 0); });
    const camino = -hasta.filter(m => !m.fila).reduce((a, m) => a + m.monto, 0);
    const sistema = ORDEN_CUENTAS.reduce((a, k) => a + sis[k], 0) + camino;
    const real = { cc: saldoCartolaAl('cc', dom, datos), chequera: saldoCartolaAl('chequera', dom, datos), mp: saldoMpAl(dom, { movsMp: datos.movsMp, mpVentas: datos.mpVentas, cobertura: (datos.cobertura || {}).mp, mpDias: datos.mpDias }) };
    const libro = libroAdminAl(datos.efmovs, dom), fondos = fondosAl(datos.cierres, dom), transito = transitoAl(datos.cmovs, datos.efmovs, dom);
    const fondoTotal = Object.values(fondos).reduce((a, f) => a + f.monto, 0);
    real.efectivo = libro ? libro.saldo + fondoTotal + transito : null;
    const cartolas = ['cc', 'chequera', 'mp'].reduce((a, k) => a + (real[k] || 0), 0), efectivo = real.efectivo || 0;
    const faltan = ORDEN_CUENTAS.filter(k => real[k] === null);
    const dif = ORDEN_CUENTAS.filter(k => real[k] !== null).reduce((a, k) => a + (real[k] - sis[k]), 0);
    const diasSinContar = libro && libro.conteo ? diasEntre(libro.conteo.dia, dom) : null;
    const estado = faltan.length ? 'sin_datos' : Math.abs(dif) <= TOL_CUADRE ? 'cuadra' : 'falta';
    return { ...w, sistema, sis, camino, real, cartolas, efectivo, dif, faltan, estado, libro, fondos, transito, diasSinContar, falta: estado === 'cuadra' ? [] : queFalta(w, datos, { libro, diasSinContar, faltan, camino }) };
  }).reverse();
}
const enSemana = (f, w) => esDia(f) && f >= w.desde && f <= w.domingo;
export function queFalta(w, datos, { libro, diasSinContar, faltan = [], camino = 0 } = {}) {
  const out = [], gn = datos.gn || {}, I = GB.indicePagos(gn.pagos || []);
  const cargos = (gn.movs || []).filter(m => !m.anterior && ['cc', 'chequera', 'mp'].includes(m.cuenta) && enSemana(m.fecha, w) && m.estado !== 'no_va' && !m.naturaleza && GB.libreMov(m, I) > GB.TOLERANCIA);
  if (cargos.length) out.push({ k: 'cargos', texto: `${cargos.length} ${cargos.length === 1 ? 'cargo' : 'cargos'} del banco o Mercado Pago sin conciliar ($${cargos.reduce((a, m) => a + GB.libreMov(m, I), 0).toLocaleString('es-CL')})`, link: '#gastos', boton: 'Ir a la Bandeja' });
  const ab = (datos.abonos || []).filter(a => a.estado === 'pendiente' && enSemana(aDia(a.fecha), w));
  if (ab.length) out.push({ k: 'abonos', texto: `${ab.length} ${ab.length === 1 ? 'abono' : 'abonos'} de la cartola sin conciliar ($${ab.reduce((a, x) => a + ent(x.monto), 0).toLocaleString('es-CL')})`, link: '#b2b/conciliacion', boton: 'Ir a Conciliación' });
  const pu = (datos.efmovs || []).filter(m => !m.anulado && m.estado === 'por_unir' && enSemana(m.dia, w)).concat((datos.cmovs || []).filter(m => !m.anulado && m.estado === 'por_unir' && enSemana(m.dia, w)));
  if (pu.length) out.push({ k: 'porunir', texto: `${pu.length} ${pu.length === 1 ? 'pago o depósito en efectivo' : 'pagos o depósitos en efectivo'} por unir`, link: '#efectivo', boton: 'Ir a Efectivo' });
  const gp = (gn.pagos || []).filter(p => p.estado !== 'deshecho' && p.medio === 'efectivo' && !p.efectivo && !p.movId && enSemana(aDia(p.fecha), w) && libro);
  if (gp.length) out.push({ k: 'gastosef', texto: `${gp.length} ${gp.length === 1 ? 'pago en efectivo de Gastos' : 'pagos en efectivo de Gastos'} sin su movimiento en Efectivo`, link: '#efectivo', boton: 'Ir a Efectivo' });
  if (!libro) out.push({ k: 'sinconteo', texto: 'La caja de administración no tiene conteo inicial a esa fecha', link: '#efectivo', boton: 'Contar el efectivo' });
  else if (diasSinContar !== null && diasSinContar > DIAS_SIN_CONTAR) out.push({ k: 'conteo', texto: `El efectivo no se cuenta hace ${diasSinContar} días`, link: '#efectivo', boton: 'Contar el efectivo' });
  faltan.filter(k => k !== 'efectivo').forEach(k => out.push({ k: 'cartola_' + k, texto: `Sin cartola de ${CUENTAS[k]} hasta el ${diaTxt(w.domingo)}`, link: '#gastos', boton: 'Subir la cartola' }));
  if (Math.abs(camino) > 0) out.push({ k: 'camino', texto: `$${Math.abs(camino).toLocaleString('es-CL')} en camino entre cuentas: un traspaso o depósito sin su otro lado`, link: '#gastos', boton: 'Ver traspasos' });
  return out;
}
