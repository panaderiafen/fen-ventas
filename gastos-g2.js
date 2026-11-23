// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos en la base nueva (etapa G2): reglas puras  v0.47.0 · v0.49.0
//  Lo mismo que hace hoy el script de Gastos (Code.gs v2.5.0 y SistemaFen.gs v1.10.0), escrito para la base nueva:
//  · Registrar (sfItemsLimpios + registrarGasto): una línea por ítem y área, neto/IVA con la harina (19% + 12%);
//    a crédito, UN vencimiento por compra (como hoy).
//  · Pagar (crearGastosPorPagoVencimiento): las líneas del gasto, con el reparto de la obligación (PArea/PPct o MultiArea).
//  · Vencimientos de las obligaciones (calcularOcurrenciaDesde + generarVencimientos): 3 días antes, con un id fijo
//    "<obligación>_<aaaa-mm-dd>" (el período y el día): generar dos veces, o en dos pestañas, no duplica.
//  · Corregir (sfGEditar): qué campos cambian, con el antes y el después para el historial.
//  · De documento a lo que esperan las pantallas (la misma forma que entrega el script).
//  v0.47.0 (G2, tercera parte): obligaciones (sfOblGuardar + savePlantilla, archivar, activar, getPlantillas con la
//  próxima fecha, getHistorialPagos), ítems (sfItemGuardar + saveItem, moverItem, sfItemArchivar, sfItemsTodos) y las
//  cuentas del Análisis (las mismas que hacía app.js con la lista del script).
//  v0.49.0 (G3, segunda parte): los vencimientos con el estado nuevo (gastos-g3.js) se ven en las pantallas de siempre
//  como PENDIENTE / VENCIDA / PAGADO / ANULADO (estadoBase lleva el nuevo); lo copiado de la planilla se ve igual que antes.
//  generarVencimientos acepta la antelación por obligación (tipo documento: antes, para esperar la boleta).
//  Sin red: se prueba sola. Fechas y horas en hora de Chile (America/Santiago).
// ═══════════════════════════════════════════════
import { dia, numero, idLimpio } from './gastos-modelo.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';

// v0.63.1: B2B (costos del canal B2B: atención de clientes, órdenes y despacho)
// v0.69.1: REVENTA (lo que se compra hecho y se vende tal cual). La lista sale de areas.js (una sola para toda la app).
export const AREAS = AR.GASTO;
export const ANTELACION_DIAS = 3;          // un vencimiento se crea 3 días antes (como el script)
export const DIAS_MOSTRAR_PAGADOS = 7;
export const ZONA = 'America/Santiago';
const RE_FOLIO_OBS = /(?:^|[^A-Za-z])(NC|F)\.(\d+)/;

// ── Fechas (hora de Chile) ──────────────────────────
export function ahoraChile(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const diaTxt = `${p.year}-${p.month}-${p.day}`, hora = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  return { dia: diaTxt, hora, texto: `${diaTxt} ${hora}` };
}
export const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const isoUTC = ms => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return isoUTC(Date.UTC(y, m - 1, d + n)); };
export const dmaDeIso = iso => { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : String(iso || ''); };

// ── Textos y números ────────────────────────────────
// Igual que sfTexto del script: sin caracteres de control y sin "=", "+", "-" ni "@" al inicio
export const texto = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).replace(/^[=+\-@\s]+/, '').trim();
// Observación libre (como registrarGasto y el pago): solo se quitan los signos del inicio
export const obsLibre = (v, max = 500) => String(v == null ? '' : v).slice(0, max).replace(/^[=+\-@]+/, '');
export const n = v => (typeof v === 'number' ? (isFinite(v) ? v : 0) : numero(v));
const s = v => String(v || '');          // como String(x || '') del script (0 → '')
const areaOk = a => AREAS.includes(String(a));
export const factorDe = esHarina => (esHarina ? 1.31 : 1.19);
export const tipoMontoOk = t => (['bruto', 'neto', 'siniva'].includes(t) ? t : 'bruto');

// ── Registrar (sfItemsLimpios) ──────────────────────
// catalogo: ítems vigentes (no archivados) con esObligacionRecurrente
export function limpiarItems(items, catalogo) {
  const lista = {}, recurrentes = {};
  (catalogo || []).forEach(i => { if (i.esObligacionRecurrente) recurrentes[i.item] = true; else lista[i.item] = i; });
  const limpios = [];
  for (const x0 of items || []) {
    const x = x0 || {}, ref = lista[x.item];
    if (!ref) return { error: recurrentes[x.item] ? `"${x.item}" es una cuenta recurrente: se paga desde sus vencimientos` : `El ítem "${x.item}" no está en la lista de ítems` };
    const it = { item: ref.item, categoria: ref.categoria, tipo: ref.tipo, subTipo: ref.subTipo, area: ref.area, esHarina: !!x.esHarina && ref.item === 'MATERIA PRIMA', areas: [], prorrateo: null, montoTotal: 0 };
    if (ref.area === 'PRORRATEADO') {
      const q = x.prorrateo || {}, pct = v => Math.round(n(v));
      const pcts = [pct(q.pct1), pct(q.pct2)].concat(q.area3 ? [pct(q.pct3)] : []);
      const usadas = [q.area1, q.area2].concat(q.area3 ? [q.area3] : []);
      if (!areaOk(q.area1) || !areaOk(q.area2) || (q.area3 && !areaOk(q.area3))) return { error: ref.item + ': área no válida' };
      if (usadas.some((a, i) => usadas.indexOf(a) !== i)) return { error: ref.item + ': cada área una sola vez' };
      if (pcts.some(v => v <= 0 || v > 100) || pcts.reduce((a, b) => a + b, 0) !== 100) return { error: ref.item + ': los porcentajes deben sumar 100%' };
      it.prorrateo = { area1: q.area1, pct1: pct(q.pct1), area2: q.area2, pct2: pct(q.pct2), area3: q.area3 || '', pct3: q.area3 ? pct(q.pct3) : 0 };
      it.montoTotal = n(x.montoTotal);
    } else if (ref.area === 'SELECCIONAR') {
      it.areas = (x.areas || []).filter(a => a && a.area && n(a.monto) > 0).map(a => ({ area: String(a.area), monto: n(a.monto) }));
      if (it.areas.some(a => !areaOk(a.area))) return { error: ref.item + ': área no válida' };
      it.montoTotal = it.areas.reduce((t, a) => t + a.monto, 0);
    } else {
      it.montoTotal = n(x.montoTotal);
      it.areas = [{ area: ref.area, monto: it.montoTotal }];
    }
    if (!(it.montoTotal > 0)) return { error: ref.item + ': falta el monto' };
    limpios.push(it);
  }
  return { limpios };
}
// Neto y final de un monto, como cada línea de registrarGasto
export function netoFinal(monto, tipoMonto, factor) {
  const m = Number(monto) || 0;
  if (tipoMonto === 'neto') return { neto: m, final: Math.round(m * factor) };
  if (tipoMonto === 'siniva') return { neto: m, final: m };
  return { neto: Math.round(m / factor), final: m };
}
// Documento de gasto con los mismos nombres que arma G1 (gastos-modelo.armar): columnas de Registro Gasto + estado, mes, año, folio
export function docGasto(c, extra = {}) {
  const f = dia(c.fecha), obs = String(c.observacion || ''), m = obs.match(RE_FOLIO_OBS);
  return {
    fecha: f, hora: c.hora || '', itemGasto: c.itemGasto || '', categoria: c.categoria || '', tipo: c.tipo || '', subTipo: c.subTipo || '', area: c.area || '',
    tipoMonto: c.tipoMonto || 'bruto', montoNeto: Number(c.montoNeto) || 0, montoFinal: Number(c.montoFinal) || 0, esHarina: c.esHarina || 'No',
    formaPago: c.formaPago || 'contado', fechaPago: c.fechaPago || '', archivo: c.archivo || '', observacion: obs, urlFoto: c.urlFoto || '',
    estado: 'vigente', mes: f ? f.slice(0, 7) : '', anio: f ? Number(f.slice(0, 4)) : null, folio: m ? m[2] : '', esNC: m ? (m[1] === 'NC' || Number(c.montoFinal) < 0) : false,
    ...extra
  };
}
// Líneas de una compra, en el orden en que registrarGasto las inserta arriba de la planilla (la primera insertada
// queda más abajo). La copia a la planilla las pasa en el orden de su id, así que quedan igual que hoy.
// e = { fecha (aaaa-mm-dd), hora, tipoMonto, formaPago, fechaPago, observacion, archivo, urlFoto }
export function lineasCompra(e, limpios) {
  const out = [], tipoMonto = e.tipoMonto || 'bruto';
  limpios.forEach(it => {
    const factor = factorDe(it.esHarina);
    if (it.area === 'PRORRATEADO' && it.prorrateo) {
      // Como el script: el neto y el final del total, y cada área su % redondeado
      const p = it.prorrateo, nf = netoFinal(it.montoTotal, tipoMonto, factor);
      const parte = (area, pct) => ({ it, area, neto: Math.round(nf.neto * pct / 100), final: Math.round(nf.final * pct / 100) });
      if (p.area3 && p.pct3) out.push(parte(p.area3, p.pct3));
      out.push(parte(p.area2, p.pct2));
      out.push(parte(p.area1, p.pct1));
    } else if (it.areas && it.areas.length) {
      for (let ai = it.areas.length - 1; ai >= 0; ai--) {
        const a = it.areas[ai], nf = netoFinal(a.monto, tipoMonto, factor);
        out.push({ it, area: a.area, neto: nf.neto, final: nf.final });
      }
    }
  });
  return out.map(l => docGasto({
    fecha: e.fecha, hora: e.hora || '', itemGasto: l.it.item, categoria: l.it.categoria || '', tipo: l.it.tipo || '', subTipo: l.it.subTipo || '',
    area: l.area, tipoMonto, montoNeto: l.neto, montoFinal: l.final, esHarina: l.it.esHarina ? 'Sí' : 'No', formaPago: e.formaPago || 'contado',
    fechaPago: e.fechaPago || '', archivo: e.archivo || '', observacion: obsLibre(e.observacion), urlFoto: e.urlFoto || ''
  }));
}
// Documento de vencimiento con los nombres de G1 (columnas de la hoja Vencimientos)
export function docVencimiento(c) {
  return { id: c.id || '', plantillaID: c.plantillaID || '', nombre: c.nombre || '', item: c.item || '', periodoKey: c.periodoKey || '', fechaVencimiento: c.fechaVencimiento || '',
    montoEstimado: c.montoEstimado === undefined ? '' : c.montoEstimado, obs: c.obs || '', area: c.area || '', categoria: c.categoria || '', tipo: c.tipo || '', subTipo: c.subTipo || '',
    multiArea: c.multiArea || '', estado: c.estado || 'PENDIENTE', fechaPago: '', montoPago: '', obsPago: '', urlComprobante: c.urlComprobante || '',
    pArea1: c.pArea1 || '', pPct1: c.pPct1 || '', pArea2: c.pArea2 || '', pPct2: c.pPct2 || '', pArea3: c.pArea3 || '', pPct3: c.pPct3 || '',
    fechaCompra: c.fechaCompra || '', tipoMonto: c.tipoMonto || '' };
}
// Vencimiento de una compra a crédito (UNO por compra, como registrarGasto). hoy: aaaa-mm-dd
export function vencimientoCredito(e, limpios, hoy) {
  if (!(e.formaPago === 'tarjeta' || e.formaPago === 'proveedor') || !e.fechaPago || !limpios.length) return null;
  const tipoMonto = e.tipoMonto || 'bruto';
  let total = 0; const todas = [];
  limpios.forEach(it => {
    const factor = factorDe(it.esHarina);
    if (it.areas && it.areas.length) it.areas.forEach(a => { const m = Number(a.monto) || 0, b = tipoMonto === 'neto' ? Math.round(m * factor) : m; total += b; todas.push({ area: a.area, monto: b }); });
    else if (it.prorrateo) { const m = Number(it.montoTotal) || 0; total += tipoMonto === 'neto' ? Math.round(m * factor) : m; }
  });
  const uno = limpios.length === 1 ? limpios[0] : null;
  return docVencimiento({
    nombre: (e.formaPago === 'tarjeta' ? '💳 Tarjeta: ' : '📋 Crédito: ') + limpios.map(i => i.item || '').join(' + '),
    item: uno ? uno.item : '', periodoKey: e.fechaPago.slice(0, 7), fechaVencimiento: e.fechaPago, montoEstimado: total, obs: obsLibre(e.observacion),
    area: todas.length === 1 ? todas[0].area : todas.length > 1 ? 'MULTI' : '', categoria: uno ? uno.categoria || '' : '', tipo: uno ? uno.tipo || '' : '', subTipo: uno ? uno.subTipo || '' : '',
    multiArea: todas.length > 1 ? JSON.stringify(todas) : '', estado: e.fechaPago < hoy ? 'VENCIDA' : 'PENDIENTE', urlComprobante: e.urlFoto || '', fechaCompra: dmaDeIso(e.fecha)
  });
}

// ── Pagar (crearGastosPorPagoVencimiento) ──────────
// v: vencimiento como lo ven las pantallas (vistaVencimiento). Fecha del gasto = la del vencimiento (devengado).
export function lineasPago(v, montoPago, fechaPago, obsPago, url, tipoMonto, hora) {
  tipoMonto = tipoMonto || 'bruto';
  const total = parseFloat(montoPago) || 0, obs = obsPago || v.obs || '';
  const linea = (area, monto) => {
    let neto, final;
    if (tipoMonto === 'neto') { neto = monto; final = Math.round(neto * 1.19); }
    else if (tipoMonto === 'siniva') { neto = monto; final = monto; }
    else { final = monto; neto = Math.round(final / 1.19); }
    return { area, neto, final };
  };
  const filas = [];
  if (v.area === 'PRORRATEADO' && v.pArea1 && v.pPct1) {
    const p1 = parseFloat(v.pPct1) || 0, p2 = parseFloat(v.pPct2) || 0, p3 = parseFloat(v.pPct3) || 0;
    filas.push(linea(v.pArea1, Math.round(total * p1 / 100)));
    if (v.pArea2 && p2) filas.push(linea(v.pArea2, Math.round(total * p2 / 100)));
    if (v.pArea3 && p3) filas.push(linea(v.pArea3, Math.round(total * p3 / 100)));
  } else if (v.multiArea && v.multiArea.length) v.multiArea.forEach(a => filas.push(linea(a.area, parseFloat(a.monto) || 0)));
  else filas.push(linea(v.area || '', total));
  return filas.map(f => docGasto({ fecha: v.fecha, hora, itemGasto: v.item || '', categoria: v.categoria || '', tipo: v.tipo || '', subTipo: v.subTipo || '',
    area: f.area, tipoMonto, montoNeto: f.neto, montoFinal: f.final, esHarina: 'No', formaPago: 'contado', fechaPago, archivo: '', observacion: obs, urlFoto: url || '' },
  { vencimientoId: v.id }));
}
// Compra a crédito: qué gastos completa el pago (como registrarPagoVencimiento: mismo ítem, a crédito, sin fecha de pago y,
// si el vencimiento guarda la fecha de compra, esa fecha; sin ella, solo el primero). Sin ítem (varios ítems), ninguno.
// gastos: [{ id, d }] de la base, del más nuevo al más antiguo (como la planilla, de arriba hacia abajo)
export function gastosDelCredito(v, gastos) {
  if (v.plantillaId || !v.item) return [];
  const fc = dia(v.fechaCompra), out = [];
  for (const x of gastos || []) {
    const d = x.d;
    if (d.estado !== 'vigente' || d.quitadoEnPlanilla) continue;
    if (s(d.itemGasto).toLowerCase() !== v.item.toLowerCase() || s(d.fechaPago) || !['proveedor', 'tarjeta'].includes(s(d.formaPago))) continue;
    if (fc && dia(d.fecha) !== fc) continue;
    out.push(x);
    if (!fc) break;
  }
  return out;
}

// ── Vencimientos de las obligaciones (calcularOcurrenciaDesde + generarVencimientos) ──
// Mismo cálculo que el script con fechas aaaa-mm-dd (incluido "Dia" 29, 30 o 31 en un mes más corto:
// pasa a los primeros días del mes siguiente, como new Date(año, mes, 31)).
export function ocurrenciaDesde(frecuencia, diaMes, ref) {
  if (!esIso(ref)) return null;
  const [y, m, d0] = ref.split('-').map(Number), mo = m - 1, r = isoUTC(Date.UTC(y, mo, d0));
  if (frecuencia === 'mensual_dia') {
    const d = parseInt(diaMes, 10); if (!(d >= 1)) return null;
    let f = isoUTC(Date.UTC(y, mo, d)); if (f < r) f = isoUTC(Date.UTC(y, mo + 1, d)); return f;
  }
  if (frecuencia === 'mensual_ultimo') { let f = isoUTC(Date.UTC(y, mo + 1, 0)); if (f < r) f = isoUTC(Date.UTC(y, mo + 2, 0)); return f; }
  if (frecuencia === 'quincenal') return [Date.UTC(y, mo, 1), Date.UTC(y, mo, 15), Date.UTC(y, mo + 1, 1), Date.UTC(y, mo + 1, 15)].map(isoUTC).find(f => f >= r) || null;
  return null;
}
// Id fijo de un vencimiento generado: "<obligación>_<aaaa-mm-dd>" (período + día). Con el día y no solo el mes, porque
// un "Dia 31" deja dos en un mismo mes (31 de octubre → 1 de diciembre → 31 de diciembre) y la quincenal tiene dos por mes.
export const idVencimiento = (plantillaId, fecha) => `${idLimpio(plantillaId) || 'sin-id'}_${fecha}`;
const vivo = d => d && !d.quitadoEnPlanilla;
// plantillas / vencs: { id, d } (documentos de la base). hoy: aaaa-mm-dd.
// Devuelve { nuevos: [{ id, d }], archivar: [id de la obligación] }. Idempotente: con lo ya generado no crea nada.
// opciones.antelacion(p): días antes para esa obligación (sin opciones: 3, como el script)
export const docVencDeObligacion = (pid, p, fecha, estado) => { const id = idVencimiento(pid, fecha);
  return { id, d: docVencimiento({ id, plantillaID: pid, nombre: p.nombre || '', item: p.item || '', periodoKey: fecha.slice(0, 7), fechaVencimiento: fecha, montoEstimado: p.montoEstimado || '',
    obs: p.obs || '', area: p.area || '', categoria: p.categoria || '', tipo: p.tipo || '', subTipo: p.subTipo || '', multiArea: typeof p.multiArea === 'string' ? p.multiArea : (p.multiArea ? JSON.stringify(p.multiArea) : ''), estado,
    pArea1: p.pArea1 || '', pPct1: p.pPct1 || '', pArea2: p.pArea2 || '', pPct2: p.pPct2 || '', pArea3: p.pArea3 || '', pPct3: p.pPct3 || '', tipoMonto: p.tipoMonto || '' }) }; };
export function generarVencimientos(plantillas, vencs, hoy, opciones) {
  const limite0 = sumarDias(hoy, ANTELACION_DIAS), nuevos = [], archivar = [];
  const porPlantilla = {};
  (vencs || []).filter(x => vivo(x.d)).forEach(x => { const p = s(x.d.plantillaID); if (p) (porPlantilla[p] = porPlantilla[p] || []).push(x.d); });
  const ids = new Set((vencs || []).map(x => x.id));
  (plantillas || []).filter(x => vivo(x.d)).forEach(({ id: docId, d: p }) => {
    const pid = s(p.id) || docId;
    if (s(p.estado) !== 'ACTIVA') return;
    const frec = s(p.frecuencia), existentes = porPlantilla[pid] || [];
    const limite = opciones && opciones.antelacion ? sumarDias(hoy, Math.max(ANTELACION_DIAS, opciones.antelacion(p) || 0)) : limite0;
    const poner = (fecha, estado) => {
      const id = idVencimiento(pid, fecha); if (ids.has(id)) return; ids.add(id);
      // Cada valor tal cual viene de la obligación (como row[col]||'' del script: un número sigue siendo número)
      nuevos.push({ ...docVencDeObligacion(pid, p, fecha, estado), plantillaDocId: docId });
    };
    if (frec === 'variable') {
      if (existentes.length) return;                        // ya se generó su único vencimiento
      const fe = dia(p.fechaEsp); if (!fe || fe > limite) return;
      poner(fe, fe < hoy ? 'VENCIDA' : 'PENDIENTE'); archivar.push(docId);   // de una sola vez: se archiva sola
      return;
    }
    let ultima = null;
    existentes.forEach(v => { const f = dia(v.fechaVencimiento); if (f && (!ultima || f > ultima)) ultima = f; });
    const ancla = ultima ? sumarDias(ultima, 1) : (dia(p.fechaCreacion) || hoy);
    let actual = ocurrenciaDesde(frec, p.dia, ancla), guard = 0;
    while (actual && actual <= limite && guard < 36) { poner(actual, actual < hoy ? 'VENCIDA' : 'PENDIENTE'); actual = ocurrenciaDesde(frec, p.dia, sumarDias(actual, 1)); guard++; }
  });
  return { nuevos, archivar };
}
// Estados al día (actualizarEstadosVencidos): PENDIENTE con fecha pasada → VENCIDA, y al revés
export function cambiosDeEstado(vencs, hoy) {
  const out = [];
  (vencs || []).filter(x => vivo(x.d)).forEach(({ id, d }) => {
    const e = s(d.estado), f = dia(d.fechaVencimiento); if (!f) return;
    if (e === 'PENDIENTE' && f < hoy) out.push({ id, estado: 'VENCIDA' });
    else if (e === 'VENCIDA' && f >= hoy) out.push({ id, estado: 'PENDIENTE' });
  });
  return out;
}

// ── Lo que ven las pantallas (la misma forma que entrega el script) ──
const json = v => { if (Array.isArray(v) || (v && typeof v === 'object')) return v; try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
// v0.49.0: "estado" para las pantallas de siempre (lo nuevo se traduce; lo de la planilla queda tal cual) y, si el
// vencimiento ya usa lo nuevo, sus datos: estadoBase, tipo de la obligación, documento, abonos, fecha estimada.
const G3_CAMPOS = ['tipoObligacion', 'montoDocumento', 'fechaDocumento', 'documento', 'abonos', 'fechaEstimada', 'suelto', 'cerrado', 'diasAviso', 'boleta'];
export function vistaVencimiento(id, d, hoy) {
  const nuevo = G3.ESTADOS.includes(s(d.estado)) || G3_CAMPOS.some(k => d[k] !== undefined && d[k] !== '');
  const v = vistaVencimiento0(id, d);
  if (!nuevo) return v;
  return { ...v, estado: G3.estadoVista(d, hoy || ahoraChile().dia), estadoBase: G3.estadoBase(d), fecha: G3.fechaReal(d), fechaEstimada: dia(d.fechaEstimada) || '',
    tipoObligacion: s(d.tipoObligacion), montoDocumento: d.montoDocumento === undefined ? '' : s(d.montoDocumento), fechaDocumento: dia(d.fechaDocumento) || '',
    documento: d.documento && typeof d.documento === 'object' ? d.documento : null, abonos: Array.isArray(d.abonos) ? d.abonos : [], suelto: d.suelto === true,
    cerrado: d.cerrado || null, diasAviso: d.diasAviso === undefined ? '' : d.diasAviso, fechaSaldo: dia(d.fechaSaldo) || '',   // v0.64.0: saldo reagendado
    // v0.70.0 · Nació de su boleta (luz, agua): sus gastos ya existen (devengado) y sus datos de la boleta
    ...(d.boleta && typeof d.boleta === 'object' ? { boleta: d.boleta, devengado: d.devengado === true, gastosDoc: Array.isArray(d.gastosDoc) ? d.gastosDoc : [], origenPorPagar: s(d.origenPorPagar) } : {}) };
}
function vistaVencimiento0(id, d) {
  return { id, plantillaId: s(d.plantillaID), nombre: s(d.nombre), item: s(d.item), periodoKey: s(d.periodoKey), fecha: dia(d.fechaVencimiento) || s(d.fechaVencimiento),
    montoEstimado: s(d.montoEstimado), obs: s(d.obs), area: s(d.area), categoria: s(d.categoria), tipo: s(d.tipo), subTipo: s(d.subTipo), multiArea: json(d.multiArea),
    estado: s(d.estado), fechaPago: dia(d.fechaPago), montoPago: s(d.montoPago), obsPago: s(d.obsPago), urlComprobante: s(d.urlComprobante),
    pArea1: s(d.pArea1), pPct1: s(d.pPct1), pArea2: s(d.pArea2), pPct2: s(d.pPct2), pArea3: s(d.pArea3), pPct3: s(d.pPct3), fechaCompra: s(d.fechaCompra), tipoMonto: s(d.tipoMonto) };
}
// Vencimientos para "datos" (getVencimientos): sin anulados ni pagados de hace más de 7 días
export function vencimientosVisibles(vencs, hoy) {
  const corte = sumarDias(hoy, -DIAS_MOSTRAR_PAGADOS);
  return (vencs || []).filter(x => vivo(x.d)).map(x => vistaVencimiento(x.id, x.d, hoy))
    .filter(v => v.id && v.estado !== 'ANULADO' && (v.estado !== 'PAGADO' || v.fechaPago >= corte));
}
// Pendientes para Hoy (sfPendientes): atrasados y próximos 7 días, de los vencimientos PENDIENTE o VENCIDA
export function pendientesHoy(vencs, hoy) {
  const en7 = sumarDias(hoy, 7), atrasados = [], semana = [];
  (vencs || []).filter(x => vivo(x.d)).forEach(({ id, d }) => {
    if (!G3.abierto(d)) return;              // v0.49.0: PENDIENTE, VENCIDA o los estados nuevos abiertos
    const f = dia(G3.fechaReal(d)); if (!f) return;
    const v = { id, nombre: s(d.nombre), fecha: f, monto: n(d.montoDocumento) || n(d.montoEstimado) };
    if (f < hoy) atrasados.push(v); else if (f <= en7) semana.push(v);
  });
  atrasados.sort((a, b) => a.fecha.localeCompare(b.fecha)); semana.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const suma = l => l.reduce((a, v) => a + v.monto, 0);
  return [{ clave: 'atrasados', cantidad: atrasados.length, monto: suma(atrasados), detalle: atrasados.slice(0, 5) },
    { clave: 'semana', cantidad: semana.length, monto: suma(semana), detalle: semana.slice(0, 30) }];
}
// Ítems de las obligaciones recurrentes activas (no se registran a mano: se pagan desde sus vencimientos)
export function recurrentes(plantillas) {
  const r = {};
  (plantillas || []).filter(x => vivo(x.d)).forEach(({ d }) => { const it = s(d.item).trim().toUpperCase(); if (it && s(d.frecuencia) && d.frecuencia !== 'variable' && s(d.estado) === 'ACTIVA') r[it] = true; });
  return r;
}
export function vistaItem(id, d, rec) {
  return { id, item: s(d.item), categoria: s(d.categoria), tipo: s(d.tipo), subTipo: s(d.subTipo), area: s(d.area), orden: parseFloat(d.orden) || 0,
    archivado: d.archivado === true || s(d.estado).trim().toUpperCase() === 'ARCHIVADO', esObligacionRecurrente: !!(rec || {})[s(d.item).trim().toUpperCase()] };
}
// Orden como la hoja: por "Orden" y, si empatan, por la fila de la planilla (G1) y el id
const porFila = (a, b) => (Number(a.d.fila) || 1e9) - (Number(b.d.fila) || 1e9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const itemsOrdenados = (items, plantillas) => { const rec = recurrentes(plantillas); return (items || []).filter(x => vivo(x.d) && s(x.d.item)).slice().sort(porFila).map(x => vistaItem(x.id, x.d, rec)).sort((a, b) => a.orden - b.orden); };
// Gasto como lo entrega g_lista (sfLeerFila), con su vencimiento si es a crédito. k: número de línea en pantalla (hace de "fila")
export function vistaGasto(id, d, k, creditos) {
  const obs = s(d.observacion), m = obs.match(RE_FOLIO_OBS), monto = n(d.montoFinal), fecha = dia(d.fecha);
  const version = Number(d.version) || 0;
  const g = { id, fila: k, huella: id + ':' + version, version, fecha, hora: s(d.hora).slice(0, 5), item: s(d.itemGasto), categoria: s(d.categoria), tipo: s(d.tipo),
    subTipo: s(d.subTipo), area: s(d.area), tipoMonto: s(d.tipoMonto), neto: n(d.montoNeto), monto, esHarina: s(d.esHarina) === 'Sí', formaPago: s(d.formaPago), fechaPago: dia(d.fechaPago),
    obs, urlFoto: s(d.urlFoto), rut: s(d.rutProveedor).trim(), razonSocial: s(d.razonSocial), folio: m ? m[2] : '', esNC: m ? (m[1] === 'NC' || monto < 0) : false, vencimientoId: s(d.vencimientoId),
    // v0.63.1: pagado por banco a mano y todavía sin su cargo de la cartola; efectivo o banco; si ya tiene su cargo
    esperaCargo: d.esperaCargo === true, medioPago: s(d.medioPago), conCartola: !!(s(d.cartolaCargo) || /\[cc[0-9a-f]{10}\]/.test(s(d.cartola))),
    siiDocId: s(d.siiDoc && d.siiDoc.id) };   // v0.67.2: su documento del SII (para "Volver a clasificar")
  if ((g.formaPago === 'tarjeta' || g.formaPago === 'proveedor') && creditos) {
    const v = (g.vencimientoId && creditos.porId[g.vencimientoId]) || creditos.porClave[g.item.trim().toUpperCase() + '|' + g.fecha] || creditos.porClave['|' + g.fecha];
    if (v) { g.vencimiento = v.fecha; g.estadoVencimiento = v.estado; }
  }
  return g;
}
// Vencimientos de compras a crédito (sin obligación), por ítem y fecha de compra (como sfGLista) y por id
export function mapaCreditos(vencs) {
  const porClave = {}, porId = {};
  (vencs || []).filter(x => vivo(x.d)).forEach(({ id, d }) => {
    if (s(d.plantillaID)) return;
    const v = { id, fecha: dia(d.fechaVencimiento), estado: G3.ESTADOS.includes(s(d.estado)) ? G3.estadoVista(d, ahoraChile().dia) : s(d.estado) };
    porId[id] = v;
    const fc = dia(d.fechaCompra); if (fc) porClave[s(d.item).trim().toUpperCase() + '|' + fc] = v;
  });
  return { porClave, porId };
}
// Al anular: vencimientos que podrían quedar sin su gasto (sfGAnular). gs: vistas de gasto; vencs: { id, d }
export function relacionadosAnular(gs, vencs) {
  const V = (vencs || []).filter(x => vivo(x.d)).map(x => vistaVencimiento(x.id, x.d)), pagados = [], relacionados = [];
  const agregar = (l, x) => { if (!l.some(y => y.id === x.id)) l.push(x); };
  gs.forEach(g => {
    if (g.formaPago !== 'contado' || !g.fechaPago) return;
    V.forEach(v => {
      if (!v.plantillaId || v.estado !== 'PAGADO' || v.fecha !== g.fecha || v.fechaPago !== g.fechaPago || v.item.trim().toUpperCase() !== g.item.trim().toUpperCase()) return;
      agregar(pagados, { id: v.id, nombre: v.nombre, monto: n(v.montoPago), fecha: v.fecha, fechaPago: v.fechaPago });
    });
  });
  gs.forEach(g => {
    if (g.formaPago !== 'tarjeta' && g.formaPago !== 'proveedor') return;
    V.forEach(v => {
      if (v.plantillaId || (v.estado !== 'PENDIENTE' && v.estado !== 'VENCIDA') || dia(v.fechaCompra) !== g.fecha) return;
      const it = v.item.trim().toUpperCase(); if (it && it !== g.item.trim().toUpperCase()) return;
      agregar(relacionados, { id: v.id, nombre: v.nombre, monto: n(v.montoEstimado), fecha: v.fecha });
    });
  });
  return { pagados, vencimientos: relacionados };
}

// ── Corregir un gasto (sfGEditar) ───────────────────
// d: documento; p: { fecha, item, area, monto, obs }; catalogo: ítems (también los de obligaciones). Devuelve { error } o { campos, antes, despues }
export function corregirGasto(d, p, catalogo) {
  const g = vistaGasto('', d, 0, null);
  const lista = {}; (catalogo || []).forEach(i => { lista[i.item] = i; });
  const item = String(p.item || g.item), ref = lista[item];
  if (item !== g.item && !ref) return { error: `El ítem "${texto(item, 60)}" no está en la lista de ítems` };
  const area = String(p.area || g.area);
  const fija = ref && ref.area !== 'SELECCIONAR' && ref.area !== 'PRORRATEADO' ? ref.area : null;
  if ((item !== g.item || area !== g.area) && (fija ? area !== fija : !areaOk(area))) return { error: 'Área no válida' + (fija ? ` (el ítem ${item} es de ${fija})` : '') };
  if (!esIso(p.fecha)) return { error: 'Falta la fecha' };
  const monto = Math.round(Number(p.monto));
  if (isNaN(monto) || !monto || (monto < 0) !== (g.monto < 0)) return { error: g.monto < 0 ? 'Es una nota de crédito: el monto va en negativo' : 'El monto debe ser mayor que 0' };
  let obs = texto(p.obs, 500);
  // El folio del SII ("F.123" / "NC.123") se mantiene: sin él, el documento volvería a aparecer como pendiente
  const marca = String(g.obs).match(RE_FOLIO_OBS);
  if (marca && !String(obs).match(RE_FOLIO_OBS)) obs = (marca[1] + '.' + marca[2] + ' ' + obs).trim();
  const campos = {};
  if (p.fecha !== g.fecha) Object.assign(campos, { fecha: p.fecha, mes: p.fecha.slice(0, 7), anio: Number(p.fecha.slice(0, 4)) });
  if (item !== g.item) Object.assign(campos, { itemGasto: ref.item, categoria: ref.categoria || '', tipo: ref.tipo || '', subTipo: ref.subTipo || '' });
  if (area !== g.area) campos.area = area;
  if (monto !== g.monto) Object.assign(campos, { montoFinal: monto, montoNeto: g.tipoMonto === 'siniva' ? monto : Math.round(monto / factorDe(g.esHarina)) });
  if (obs !== g.obs) { const m = obs.match(RE_FOLIO_OBS); Object.assign(campos, { observacion: obs, folio: m ? m[2] : '', esNC: m ? (m[1] === 'NC' || monto < 0) : false }); }
  return { campos, antes: { fecha: g.fecha, item: g.item, area: g.area, monto: g.monto, obs: g.obs }, despues: { fecha: p.fecha, item, area, monto, obs } };
}
// Qué cambió en un documento: { campo: { antes, despues } } solo de los campos que cambian de verdad (para el historial)
export function diferencias(antes, campos) {
  const out = {};
  Object.keys(campos || {}).sort().forEach(k => {
    const a = antes ? antes[k] : undefined, b = campos[k];
    if (JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)) return;
    out[k] = { antes: a === undefined ? null : a, despues: b === undefined ? null : b };
  });
  return out;
}
// Entrada nueva del historial (se guardan las últimas 50)
export function conHistorial(hist, entrada) { return (Array.isArray(hist) ? hist.slice(-49) : []).concat([entrada]); }

// ── Ids nuevos ──────────────────────────────────────
// Gasto: "g-<marca de tiempo en base 36>-<azar>-<nn>" (nn en el orden de la planilla: la copia los pasa así).
// Un reintento del mismo envío usa la misma marca (gastos.js la recuerda por clave): no se duplica.
export const marcaNueva = (ms = Date.now(), azar = Math.random) => ({ t: ms.toString(36), r: Math.floor(azar() * 36 ** 5).toString(36).padStart(5, '0') });
export const idsLineas = (prefijo, marca, k) => Array.from({ length: k }, (_, i) => `${prefijo}-${marca.t}-${marca.r}-${String(i + 1).padStart(2, '0')}`);
export const idVencCredito = marca => `vc-${marca.t}-${marca.r}`;

// ═══════════════════════════════════════════════
//  v0.47.0 · Obligaciones (las reglas que crean los vencimientos)
// ═══════════════════════════════════════════════
export const FRECUENCIAS = ['mensual_dia', 'mensual_ultimo', 'quincenal', 'variable', 'cuponera'];
export const CATEGORIAS = ['FIJO', 'VARIABLE'], TIPOS = ['DIRECTO', 'INDIRECTO'];
export const SUBTIPOS = ['OPERATIVO', 'INVERSIÓN', 'COMERCIAL', 'FINANCIERO', 'PASIVO'];
export const AREAS_ITEM = ['SELECCIONAR', 'PRORRATEADO'].concat(AREAS);
const sfNum = v => { const x = Number(v); return isFinite(x) ? x : NaN; };
// Lo que la hoja deja como número ("300000" → 300000), como lo lee la copia G1; vacío sigue vacío
const numOVacio = v => (v === '' || v == null ? '' : (isFinite(Number(v)) ? Number(v) : v));

// Obligación como la entrega obl_plantillas (getPlantillas), con su próxima fecha:
// el vencimiento abierto más próximo o, si no hay, el período siguiente al último generado (o desde su creación).
export function vistaPlantilla(docId, d, vencs, hoy) {
  const id = s(d.id) || docId, frecuencia = s(d.frecuencia), estado = s(d.estado) || 'ACTIVA';
  let abierta = null, ultima = null;
  (vencs || []).filter(x => vivo(x.d) && s(x.d.plantillaID) === id).forEach(({ d: v }) => {
    const f = dia(v.fechaVencimiento); if (!f) return;
    if (G3.abierto(v) && (!abierta || f < abierta)) abierta = f;
    if (!ultima || f > ultima) ultima = f;
  });
  let proxima = abierta;
  if (!proxima && estado === 'ACTIVA') {
    if (frecuencia === 'variable') proxima = dia(d.fechaEsp);
    else if (frecuencia) proxima = ocurrenciaDesde(frecuencia, d.dia, ultima ? sumarDias(ultima, 1) : (dia(d.fechaCreacion) || hoy));
  }
  return { id, nombre: s(d.nombre), item: s(d.item), frecuencia, dia: s(d.dia), fechaEsp: dia(d.fechaEsp), montoEstimado: s(d.montoEstimado), obs: s(d.obs),
    area: s(d.area), categoria: s(d.categoria), tipo: s(d.tipo), subTipo: s(d.subTipo),
    pArea1: s(d.pArea1), pPct1: s(d.pPct1), pArea2: s(d.pArea2), pPct2: s(d.pPct2), pArea3: s(d.pArea3), pPct3: s(d.pPct3),
    multiArea: json(d.multiArea), estado, fechaCreacion: dia(d.fechaCreacion), tipoMonto: s(d.tipoMonto), cuotas: json(d.cuotas), proximaFecha: proxima || '',
    // v0.49.0: tipo e identificador (solo si ya está clasificada: lo copiado de la planilla se ve igual que antes)
    ...(d.tipoObligacion !== undefined ? { tipoObligacion: s(d.tipoObligacion), identificador: s(d.identificador), diasAviso: d.diasAviso === undefined ? '' : d.diasAviso } : {}),
    // v0.63.1: cómo se paga (sin el campo = banco: se ve como "banco" pero no se guarda hasta que se edite)
    ...(d.sePagaPor !== undefined ? { sePagaPor: s(d.sePagaPor) } : {}),
    // v0.70.0 · Cuenta de boleta (luz, agua): su empresa, servicio, local y reparto en %
    ...(d.empresa !== undefined ? { empresa: s(d.empresa), servicio: s(d.servicio), local: s(d.local), repartoPct: Array.isArray(d.repartoPct) ? d.repartoPct : [] } : {}) };
}
export const plantillasVista = (plantillas, vencs, hoy) => (plantillas || []).filter(x => vivo(x.d)).map(x => vistaPlantilla(x.id, x.d, vencs, hoy)).filter(p => p.id);

// Historial de pagos (obl_historial / getHistorialPagos): los PAGADOS, del pago más nuevo al más antiguo
export function historialPagos(vencs, p = {}) {
  let mes = null, anio = null;
  if (p.mes) { const m = parseInt(p.mes, 10); if (!(m >= 1 && m <= 12)) return { error: 'Mes no válido' }; mes = String(m).padStart(2, '0'); }
  if (p.anio) { const a = parseInt(p.anio, 10); if (!(a >= 2020 && a <= 2100)) return { error: 'Año no válido' }; anio = String(a); }
  const historial = (vencs || []).filter(x => vivo(x.d)).map(x => vistaVencimiento(x.id, x.d))
    .filter(v => v.id && v.estado === 'PAGADO' && v.fechaPago && (!anio || v.fechaPago.slice(0, 4) === anio) && (!mes || v.fechaPago.slice(5, 7) === mes))
    .sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
  return { historial };
}

// Revisar lo que llega del formulario (sfOblGuardar). existente: la obligación como la ve la pantalla (o null);
// items: los ítems vigentes. Devuelve { error } o { d } (los datos que savePlantilla escribe en la fila).
export function obligacionDesdeForm(p, existente, items) {
  const nombre = texto(p.nombre, 80);
  if (!nombre) return { error: 'Falta el nombre' };
  const frec = String(p.frecuencia || '');
  if (!FRECUENCIAS.includes(frec)) return { error: 'Elige la frecuencia' };
  const id = p.id ? String(p.id) : '';
  if (id && !existente) return { error: 'Esa cuenta recurrente ya no existe' };
  if (existente && (existente.frecuencia === 'cuponera') !== (frec === 'cuponera')) return { error: 'Una cuponera no se puede cambiar a otra frecuencia (ni al revés): crea una nueva' };
  const d = { id: id || null, nombre, frecuencia: frec, dia: '', fechaEsp: '', obs: texto(p.obs, 300), item: '', area: '', categoria: '', tipo: '', subTipo: '',
    pArea1: '', pPct1: '', pArea2: '', pPct2: '', pArea3: '', pPct3: '', multiArea: null, cuotas: null,
    tipoMonto: ['', 'bruto', 'neto', 'siniva'].includes(String(p.tipoMonto || '')) ? String(p.tipoMonto || '') : '' };
  if (frec === 'mensual_dia') { const x = parseInt(p.dia, 10); if (!(x >= 1 && x <= 31)) return { error: 'El día del mes va de 1 a 31' }; d.dia = String(x); }
  if (frec === 'variable') { if (!esIso(p.fechaEsp)) return { error: 'Falta la fecha' }; d.fechaEsp = p.fechaEsp; }
  if (frec === 'cuponera' && !id) {
    const c = Array.isArray(p.cuotas) ? p.cuotas.filter(x => x && x.fecha) : [];
    if (!c.length || c.length > 120) return { error: 'Agrega las cuotas con su fecha' };
    if (c.some(x => !esIso(x.fecha) || (x.monto !== '' && x.monto != null && !(sfNum(x.monto) >= 0)))) return { error: 'Revisa las fechas y montos de las cuotas' };
    d.cuotas = c.map(x => ({ fecha: x.fecha, monto: x.monto === '' || x.monto == null ? '' : String(Math.round(sfNum(x.monto))) }));
  }
  const monto = p.montoEstimado === '' || p.montoEstimado == null ? '' : Math.round(sfNum(p.montoEstimado));
  if (monto !== '' && !(monto >= 0)) return { error: 'Monto estimado no válido' };
  d.montoEstimado = monto === '' ? '' : String(monto);
  if (p.item) {
    // Un ítem archivado sigue sirviendo para la obligación que ya lo tenía (se toman sus datos de la propia obligación)
    const ref = (items || []).find(i => i.item === p.item) ||
      (existente && existente.item === p.item ? { item: existente.item, categoria: existente.categoria, tipo: existente.tipo, subTipo: existente.subTipo,
        area: existente.area === 'MULTI' ? 'SELECCIONAR' : existente.area === 'PRORRATEADO' ? 'PRORRATEADO' : existente.area } : null);
    if (!ref) return { error: 'El ítem no está en la lista de ítems' };
    d.item = ref.item; d.categoria = ref.categoria || ''; d.tipo = ref.tipo || ''; d.subTipo = ref.subTipo || '';
    if (ref.area === 'SELECCIONAR') {
      const m = Array.isArray(p.multiArea) ? p.multiArea.filter(a => a && a.area && sfNum(a.monto) > 0) : [];
      if (!m.length) return { error: 'Agrega al menos un área con monto' };
      if (m.some(a => !areaOk(a.area))) return { error: 'Área no válida' };
      d.area = 'MULTI'; d.multiArea = m.map(a => ({ area: String(a.area), monto: Math.round(sfNum(a.monto)) }));
    } else if (ref.area === 'PRORRATEADO') {
      const tres = !!(p.pArea3 || p.pPct3);
      const usadas = [p.pArea1, p.pArea2].concat(tres ? [p.pArea3] : []);
      const pcts = [p.pPct1, p.pPct2].concat(tres ? [p.pPct3] : []).map(x => parseInt(x, 10));
      if (usadas.some(a => !areaOk(a))) return { error: 'Completa al menos 2 áreas válidas' };
      if (usadas.some((a, i) => usadas.indexOf(a) !== i)) return { error: 'Cada área una sola vez' };
      if (pcts.some(x => !(x > 0 && x <= 100)) || pcts.reduce((a, b) => a + b, 0) !== 100) return { error: 'Los porcentajes deben sumar 100%' };
      d.area = 'PRORRATEADO'; d.pArea1 = usadas[0]; d.pPct1 = String(pcts[0]); d.pArea2 = usadas[1]; d.pPct2 = String(pcts[1]);
      if (tres) { d.pArea3 = usadas[2]; d.pPct3 = String(pcts[2]); }
    } else d.area = ref.area;
  }
  return { d };
}
// Lo que savePlantilla escribe al EDITAR (columnas Nombre … MultiArea y TipoMonto). No toca Estado, FechaCreacion ni Cuotas,
// y no toca ningún vencimiento ya creado (pagado o por pagar: siguen con los datos que tenían). Los siguientes
// vencimientos se generan con los datos nuevos, desde el día siguiente al último ya generado.
export function camposPlantilla(d) {
  return { nombre: d.nombre, item: d.item || '', frecuencia: d.frecuencia, dia: numOVacio(d.dia || ''), fechaEsp: d.fechaEsp || '', montoEstimado: numOVacio(d.montoEstimado || ''),
    obs: d.obs || '', area: d.area || '', categoria: d.categoria || '', tipo: d.tipo || '', subTipo: d.subTipo || '',
    pArea1: d.pArea1 || '', pPct1: numOVacio(d.pPct1 || ''), pArea2: d.pArea2 || '', pPct2: numOVacio(d.pPct2 || ''), pArea3: d.pArea3 || '', pPct3: numOVacio(d.pPct3 || ''),
    multiArea: d.multiArea ? JSON.stringify(d.multiArea) : '', tipoMonto: d.tipoMonto || '' };
}
// Obligación NUEVA (savePlantilla, rama nueva): ACTIVA, creada hoy, con sus cuotas si es cuponera
export const docPlantillaNueva = (id, d, hoy) => ({ id, ...camposPlantilla(d), estado: 'ACTIVA', fechaCreacion: hoy,
  cuotas: d.frecuencia === 'cuponera' && d.cuotas ? JSON.stringify(d.cuotas) : '' });
// Id de una obligación nueva: "P" + milisegundos, como el script ('P' + Date.now())
export const idPlantilla = marca => 'P' + parseInt(marca.t, 36);
// Cuponera (generarCuponera): todos sus vencimientos de una vez, sin esperar los 3 días. Id fijo "<obligación>_<fecha>"
// (si dos cuotas caen el mismo día: "_<fecha>-2"…). hoy: aaaa-mm-dd
export function vencimientosCuponera(pid, d, hoy) {
  const usados = new Set();
  return (d.cuotas || []).filter(c => c && c.fecha).map(c => {
    let id = idVencimiento(pid, c.fecha), k = 2;
    while (usados.has(id)) id = idVencimiento(pid, c.fecha) + '-' + k++;
    usados.add(id);
    return { id, d: docVencimiento({ id, plantillaID: pid, nombre: d.nombre, item: d.item || '', periodoKey: c.fecha.slice(0, 7), fechaVencimiento: c.fecha, montoEstimado: numOVacio(c.monto || ''),
      obs: d.obs || '', area: d.area || '', categoria: d.categoria || '', tipo: d.tipo || '', subTipo: d.subTipo || '', multiArea: d.multiArea ? JSON.stringify(d.multiArea) : '',
      estado: c.fecha < hoy ? 'VENCIDA' : 'PENDIENTE', pArea1: d.pArea1 || '', pPct1: numOVacio(d.pPct1 || ''), pArea2: d.pArea2 || '', pPct2: numOVacio(d.pPct2 || ''),
      pArea3: d.pArea3 || '', pPct3: numOVacio(d.pPct3 || ''), tipoMonto: d.tipoMonto || '' }) };
  });
}
// Archivar / reactivar (archivarPlantilla / activarPlantilla). Reactivar deja la fecha de creación en hoy
// (el script lo hace así; si ya tenía vencimientos, sigue desde el día siguiente al último, igual que el script).
export function estadoPlantilla(id, activar, hoy) {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(id || ''))) return { error: 'Falta la cuenta recurrente' };
  return { campos: activar ? { estado: 'ACTIVA', fechaCreacion: hoy } : { estado: 'ARCHIVADA' } };
}

// ═══════════════════════════════════════════════
//  v0.47.0 · Ítems (en Sistema Fën no se borran: se archivan)
// ═══════════════════════════════════════════════
const mayus = v => String(v == null ? '' : v).trim().toUpperCase();
// items_todos (sfItemsTodos): todos, también los archivados; "se paga desde Obligaciones" solo en los vigentes
export const itemsTodos = (items, plantillas) => itemsOrdenados(items, plantillas).map(i => (i.archivado ? { ...i, esObligacionRecurrente: false } : i));
// Revisar lo que llega del formulario (sfItemGuardar)
export function itemDesdeForm(p) {
  const nombre = texto(p.nombre, 60).toUpperCase();
  if (nombre.length < 2) return { error: 'Falta el nombre' };
  const d = { nombreOriginal: p.nombreOriginal ? String(p.nombreOriginal) : '', nombre, categoria: String(p.categoria || ''), tipo: String(p.tipo || ''), subTipo: String(p.subTipo || ''), area: String(p.area || '') };
  if (!CATEGORIAS.includes(d.categoria) || !TIPOS.includes(d.tipo) || !SUBTIPOS.includes(d.subTipo) || !AREAS_ITEM.includes(d.area)) return { error: 'Completa categoría, tipo, subtipo y área' };
  return { d };
}
// Guardar (saveItem). items: { id, d } de la base. Devuelve { error }, { editar: { id, campos } } o { crear: { id, doc } }.
// Cambiar el nombre NO cambia los gastos ya registrados ni las obligaciones que lo usan (igual que el script).
export function planGuardarItem(items, d) {
  const L = (items || []).filter(x => vivo(x.d) && s(x.d.item));
  const orig = mayus(d.nombreOriginal), nuevo = mayus(d.nombre);
  if (orig && orig !== nuevo && L.some(x => mayus(x.d.item) === nuevo)) return { error: 'Ya existe un ítem con ese nombre' };
  const campos = { item: nuevo, categoria: d.categoria || '', tipo: d.tipo || '', subTipo: d.subTipo || '', area: d.area || '' };
  if (orig) {
    const x = L.find(y => mayus(y.d.item) === orig);
    if (!x) return { error: 'Ítem no encontrado' };
    return { editar: { id: x.id, campos } };
  }
  if (L.some(x => mayus(x.d.item) === nuevo)) return { error: 'Ya existe un ítem con ese nombre' };
  const maxOrden = L.reduce((m, x) => Math.max(m, parseFloat(x.d.orden) || 0), 0);
  // Id como la copia G1: el nombre en minúsculas y sin tildes (si ese id ya lo usa otro ítem renombrado: -2, -3…)
  const ids = new Set((items || []).map(x => x.id)), base = idLimpio(nuevo).toLowerCase() || 'item';
  let id = base, k = 2; while (ids.has(id)) id = base + '-' + k++;
  return { crear: { id, doc: { ...campos, orden: maxOrden + 10, estado: '', archivado: false } } };
}
// Subir o bajar (moverItem): intercambia "Orden" con el vecino; los archivados no cuentan. { error } o { cambios: [{ id, orden }] }
export function planMoverItem(items, nombre, direccion) {
  if (!['arriba', 'abajo'].includes(direccion)) return { error: 'Dirección no válida' };
  const lista = (items || []).filter(x => vivo(x.d) && s(x.d.item)).slice().sort(porFila)
    .filter(x => mayus(x.d.estado) !== 'ARCHIVADO' && x.d.archivado !== true).map(x => ({ id: x.id, nombre: mayus(x.d.item), orden: parseFloat(x.d.orden) || 0 }))
    .sort((a, b) => a.orden - b.orden);
  const i = lista.findIndex(x => x.nombre === mayus(nombre));
  if (i < 0) return { error: 'Ítem no encontrado' };
  const j = direccion === 'arriba' ? i - 1 : i + 1;
  if (j < 0 || j >= lista.length) return { cambios: [] };   // ya está en el extremo
  return { cambios: [{ id: lista[i].id, orden: lista[j].orden }, { id: lista[j].id, orden: lista[i].orden }] };
}
// Archivar o reactivar (sfItemArchivar): Estado = ARCHIVADO o vacío
export function planArchivarItem(items, nombre, archivar) {
  const x = (items || []).filter(y => vivo(y.d)).find(y => mayus(y.d.item) === mayus(nombre));
  if (!x) return { error: 'Ítem no encontrado' };
  return { id: x.id, campos: { estado: archivar ? 'ARCHIVADO' : '', archivado: !!archivar } };
}

// ═══════════════════════════════════════════════
//  v0.47.0 · Análisis (Gastos → Análisis): las mismas cuentas con la lista del script o la de la base
//  L: gastos como los entrega g_lista (vigentes; los anulados no vienen). mes: aaaa-mm; modo: devengado | caja;
//  mesHoy: aaaa-mm (siempre aparece en la lista de meses).
// ═══════════════════════════════════════════════
export const SUBTIPOS_COSTO = ['OPERATIVO', 'COMERCIAL', 'SIN CLASIFICAR'];
const mesAntes = (mes, k) => { const [y, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export function resumenAnalisis(L, mes, modo, mesHoy) {
  const fechaDe = g => (modo === 'caja' && g.fechaPago ? g.fechaPago : g.fecha) || '';
  const meses = [...new Set((L || []).map(g => fechaDe(g).slice(0, 7)).concat([mesHoy]))].filter(Boolean).sort().reverse();
  const sub = g => String(g.subTipo || '').toUpperCase().trim() || 'SIN CLASIFICAR';
  const esCosto = g => SUBTIPOS_COSTO.includes(sub(g));
  const delMes = (L || []).filter(g => fechaDe(g).slice(0, 7) === mes);
  const costo = delMes.filter(esCosto), fuera = delMes.filter(g => !esCosto(g));
  const suma = l => l.reduce((t, g) => t + (Number(g.monto) || 0), 0);
  const agrupar = (l, f) => { const m = {}; l.forEach(g => { const k = f(g) || 'Sin dato'; m[k] = (m[k] || 0) + (Number(g.monto) || 0); }); return Object.entries(m).map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor); };
  return {
    meses, lineas: costo.length, total: suma(costo),
    fijos: suma(costo.filter(g => String(g.categoria || '').toUpperCase() === 'FIJO')), variables: suma(costo.filter(g => String(g.categoria || '').toUpperCase() === 'VARIABLE')),
    fuera: suma(fuera), totalMes: suma(delMes),
    porArea: agrupar(costo, g => g.area), porItem: agrupar(costo, g => g.item).slice(0, 8), porTipo: agrupar(costo, g => String(g.tipo || '').toUpperCase()), porSubtipo: agrupar(delMes, sub),
    evol: [5, 4, 3, 2, 1, 0].map(k => { const key = mesAntes(mes, k); return { mes: key, valor: suma((L || []).filter(g => esCosto(g) && fechaDe(g).slice(0, 7) === key)) }; })
  };
}
