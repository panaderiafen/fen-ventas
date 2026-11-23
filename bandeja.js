// ═══════════════════════════════════════════════
//  Sistema Fën · bandeja.js · v0.68.0 · v0.69.0 (las propuestas de una regla y el puntaje junto a la etiqueta)
//  Gastos → Bandeja como bandeja de entrada (Entrega A del rediseño):
//  · el estado de cada movimiento pendiente (Listo, Revisar, Sin coincidencia) con su etiqueta;
//  · la propuesta en una línea, "Qué es" y "Qué propongo y por qué";
//  · lo registrado en Gastos (gastos y vencimientos de la memoria) con su estado real: si ya está pagado y con qué;
//  · las facturas de un cliente de B2B (abiertas y pagadas recientes) y la búsqueda de facturas.
//  Todo es puro: sale de lo que la pantalla ya tiene leído (0 lecturas).
// ═══════════════════════════════════════════════
import * as PM from './pagos-mixtos.js?v=0.138.0';   // v0.69.2: el historial de pagos de un documento pagado en partes
const s = v => String(v == null ? '' : v);
const n = v => Number(v) || 0;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const esIso = f => /^\d{4}-\d{2}-\d{2}/.test(s(f));
export const dia = f => (esIso(f) ? s(f).slice(0, 10) : '');
export const diaTxt = f => (esIso(f) ? `${Number(s(f).slice(8, 10))} ${MESES[Number(s(f).slice(5, 7)) - 1]}` : '');
export const pesos = v => { const x = Math.round(n(v)); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('es-CL'); };
// Sin emojis ni símbolos al comienzo (los nombres de vencimientos del SII traen uno de la planilla antigua)
export const limpio = t => s(t).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').replace(/\s{2,}/g, ' ').trim();
export const norm = t => s(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const diasEntre = (a, b) => (esIso(a) && esIso(b) ? Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5) : null);
// "2 días después de la factura" · "el mismo día de la factura" · "3 días antes del vencimiento"
export function diasTxt(ref, f, de) {
  const d = diasEntre(ref, f); if (d === null) return '';
  if (d === 0) return `el mismo día ${de}`;
  const k = Math.abs(d); return `${k} ${k === 1 ? 'día' : 'días'} ${d > 0 ? 'después' : 'antes'} ${de}`;
}

// ═══ Estado de cada movimiento ═══
export const ESTADOS = ['listo', 'revisar', 'sin'];
export const ETIQUETA = { listo: 'Listo', revisar: 'Revisar', sin: 'Sin coincidencia', hecho: 'Conciliado', gris: 'Revisado' };
// Cargo: Listo = el mismo conjunto que "Listos para confirmar"; Revisar = hay propuesta (probable, con dudas, aprendida no exacta)
// o parece repetido; Sin coincidencia = nada calza.
export function claseCargo(c, p, listo) {
  if (listo) return 'listo';
  if ((c && c.repetidoProp && (c.repetidoProp.candidatos || []).length) || p) return 'revisar';
  return 'sin';
}
// Abono: el grupo que ya arma la conciliación de B2B (auto = Listos para confirmar)
export const claseAbono = grupo => (grupo === 'auto' ? 'listo' : grupo === 'sinCliente' ? 'sin' : 'revisar');
export function contar(clases) { const k = { listo: 0, revisar: 0, sin: 0 }; (clases || []).forEach(x => { if (x in k) k[x]++; }); return k; }

// ═══ Buscar (monto con o sin $, glosa, proveedor o cliente) ═══
// → { texto, monto } (monto: los dígitos, si la búsqueda es un monto)
export function parseQ(q) {
  const t = s(q).trim(), dig = t.replace(/[$.\s,]/g, '');
  return { texto: norm(t), monto: /^\d{2,}$/.test(dig) ? Number(dig) : null, conPeso: /^\s*\$/.test(t) };
}
// x = { texto (normalizado), montos: [números] }
export function coincide(q, x) {
  const Q = typeof q === 'string' ? parseQ(q) : q;
  if (!Q.texto) return true;
  if (Q.monto !== null) {
    const ms = (x.montos || []).map(v => Math.abs(Math.round(n(v))));
    // Con "$": el monto exacto (±$1). Sin "$": también los que empiezan con esos dígitos (desde 3)
    if (ms.some(v => Math.abs(v - Q.monto) <= 1 || (!Q.conPeso && String(Q.monto).length >= 3 && String(v).startsWith(String(Q.monto))))) return true;
    if (Q.conPeso) return false;
  }
  return s(x.texto).includes(Q.texto);
}

// ═══ Cargos: la propuesta en una línea, qué es y por qué ═══
const POR_CARGO = { aprendido: 'lo aprendiste al conciliar esta glosa antes', rut: 'mismo RUT del proveedor y monto exacto', proveedor: 'el proveedor reconocido y monto exacto', monto: 'solo calza el monto: nada dice quién es',
  'monto fijo': 'monto fijo exacto de la cuenta recurrente', documento: 'mismo monto del documento (boleta o factura)', glosa: 'la glosa lo dice', saldo: 'es el saldo exacto de un vencimiento con abonos',
  sii: 'la factura del SII ya está registrada y es del mismo monto', combinacion: 'mismo proveedor y la suma calza exacto', regla: 'lo dice una regla tuya' };
export function resumenCargo(p, c) {
  if (c && c.repetidoProp && (c.repetidoProp.candidatos || []).length) return 'Parece repetido de otra cartola';
  if (!p) return 'Sin coincidencia';
  if (p.sinPropuesta) return limpio(`Elige cuál paga: ${(p.opciones || []).map(o => o.nombre).join(' o ') || p.texto || ''}`);
  const t = limpio(p.texto);
  switch (p.tipo) {
    case 'vencimientos': return /^Paga\b/.test(t) ? t : 'Paga ' + t;
    case 'gasto': return /^Ya (está )?en Gastos/.test(t) ? t : 'Ya en Gastos: ' + t;
    case 'nuevo': return 'Gasto nuevo: ' + (s(p.item) || t) + (p.area && !/^\{/.test(s(p.area)) ? ' · ' + p.area : '');
    case 'sii_pend': return 'Factura por clasificar: ' + t;
    case 'abono': return 'Abono de sueldo: ' + t;
    case 'abono_parcial': return 'Abono al ' + t + (p.saldoDoc ? ' · queda pagado' : '');
    case 'pago_parcial': return t;   // v0.69.2: "Pago parcial: $113.780 de $125.000 · falta $11.220 · …
    case 'previred': return 'Pago de Previred: ' + t;
    case 'pago_tarjeta': return t && !/^Pago de tarjeta de cr/.test(t) ? 'Pago de tarjeta: ' + t : 'Pago de tarjeta de crédito';
    case 'traspaso': return 'Traspaso entre cuentas propias' + (p.nota ? ': ' + limpio(p.nota) : '');
    case 'ignorar': return 'No es gasto: ' + s(p.motivo);
    default: return t || 'Revisar';
  }
}
// Cómo se llegó a la propuesta, en corto (va entre paréntesis en la fila)
const POR_CORTO = { regla: 'por tu regla', aprendido: 'aprendido', rut: 'por el RUT', proveedor: 'por el proveedor', monto: 'por el monto', 'monto fijo': 'monto fijo exacto', documento: 'por el monto del documento', glosa: 'por la glosa', saldo: 'el monto del saldo' };
export const porCorto = p => (p && !p.sinPropuesta && POR_CORTO[p.por]) || '';
// "Qué es": a quién se pagó, según lo que se sabe del cargo
export function queEsCargo(c, ctx = {}) {
  const cuenta = ctx.cuenta || '';
  const base = `Cargo de ${pesos(c.monto)} del ${diaTxt(c.fecha)}${cuenta ? ' en la ' + cuenta : ''}`;
  if (c.tef && c.tef.nombre) return `${base}: transferencia que hiciste a ${c.tef.nombre}${c.tef.rutTxt ? ' (RUT ' + c.tef.rutTxt + ')' : ''}${c.tef.banco ? ', ' + c.tef.banco : ''}.`;
  if (c.proveedor && c.proveedor.nombre) return `${base}: pago a ${c.proveedor.nombre} (proveedor reconocido).`;
  if (ctx.previred) return `${base}: pago a Previred (cotizaciones).`;
  if (c.rut) return `${base}: pago a RUT ${s(c.rut).replace(/^(\d+)(\w)$/, '$1-$2')}.`;
  return `${base}: «${s(c.descripcion)}» (sin RUT en la glosa).`;
}
// "Qué propongo y por qué": la propuesta y su razón (con los días respecto de la factura o el vencimiento, si se sabe)
export function porQueCargo(c, p, D = {}) {
  if (c.repetidoProp && (c.repetidoProp.candidatos || []).length) {
    const o = c.repetidoProp.candidatos[0];
    return { que: c.repetidoProp.candidatos.length > 1 ? 'Ver si es el mismo movimiento que uno de otra cartola' : 'Marcarlo como repetido de otra cartola', porque: o.fuerte ? 'mismo monto, fecha a ±1 día y la misma glosa, RUT u operación' : 'solo coinciden la fecha (±1 día) y el monto: mira la glosa' };
  }
  if (!p) return { que: 'Nada en Gastos calza con este cargo', porque: 'ningún gasto, vencimiento ni factura del SII sin pagar es de este monto en su ventana de fechas. Búscalo abajo o elige qué es' };
  let porque = POR_CARGO[p.por] || '';
  let ref = '';
  if (p.tipo === 'vencimientos' && (p.pagos || []).length === 1) { const v = (D.vencimientos || []).find(x => x.id === p.pagos[0].id); if (v && v.fecha) ref = diasTxt(v.fecha, c.fecha, v.folio ? 'del vencimiento de la factura' : 'del vencimiento'); }
  if (p.tipo === 'gasto' && p.gasto && p.gasto.fecha) ref = diasTxt(p.gasto.fecha, c.fecha, p.gasto.folio ? 'de la factura' : 'del gasto');
  if (p.tipo === 'sii_pend') { const v = (D.siiPendientes || []).find(x => x.id === p.docId); porque = p.conf === 'seguro' ? 'mismo RUT y monto exacto' : 'mismo monto; el RUT no se sabe'; if (v && v.fecha) ref = diasTxt(v.fecha, c.fecha, 'de la factura'); }
  if (p.tipo === 'gasto' && p.combo) porque = (p.conf === 'seguro' ? 'mismo proveedor (RUT confirmado)' : 'mismo proveedor') + ' y la suma calza exacto';
  // v0.69.2 · Pagos mixtos
  if (p.tipo === 'abono_parcial' && p.saldoDoc) porque = `es el saldo exacto de un documento que ya tiene ${p.partes} ${p.partes === 1 ? 'pago' : 'pagos'}${p.quien ? (p.quien === 'rut' ? ', con el mismo RUT' : ', del proveedor reconocido') : ''}`;
  if (p.tipo === 'pago_parcial') porque = `el proveedor ${p.por === 'rut' ? '(por el RUT)' : 'reconocido'} tiene un documento por pagar mayor que el cargo: este cargo paga solo una parte`;
  if (p.sinPropuesta) porque = s(p.duda) || 'hay más de una opción';
  if (p.duda && !p.sinPropuesta) porque = [porque, s(p.duda)].filter(Boolean).join('. ');
  if (p.por === 'regla' && p.fraseRegla) porque = `lo dice tu regla «${limpio(p.fraseRegla)}»`;
  return { que: resumenCargo(p, c), porque: [porque, ref].filter(Boolean).join(', ') };
}

// ═══ Lo registrado en Gastos, con su estado real (para "Buscar en Gastos" y los candidatos) ═══
// gastos: [{ id, d }] (los de 150 días que la lista ya leía); vencs: [{ id, d }] (todos los vencimientos, ya leídos)
// → [{ tipo: 'gasto'|'venc', ids, fecha, items, areas, monto, folio, razon, rut, obs, estado, cargoId, fechaPago, medio, nombre, vence }]
const CC_RE = /\[(cc[0-9a-f]{10})\]/;
export function estadoGastoDoc(d) {
  // v0.69.2 · Pagado en partes: "Pagado: $X banco (cargo dd-mm) + $Z efectivo (dd-mm, cobros B2B)"
  if (d.pagoMixto && Array.isArray(d.pagoMixto.partes) && d.pagoMixto.partes.length) return { estado: 'partes', fechaPago: dia(d.fechaPago), cargoId: s(d.cartolaCargo), partes: d.pagoMixto.partes, totalDoc: n(d.pagoMixto.total) };
  if (d.enPartes === true && !dia(d.fechaPago)) return { estado: 'con_abonos', fechaPago: '' };
  const cargo = s(d.cartolaCargo) || ((CC_RE.exec(s(d.cartola)) || [])[1] || '');
  if (cargo) return { estado: 'cargo', cargoId: cargo, fechaPago: dia(d.fechaPago) };
  const sb = d.pagoSinBanco || null, forma = s(d.formaPago || 'contado');
  if ((sb && sb.medio === 'tarjeta') || forma === 'tarjeta') return { estado: 'tarjeta', fechaPago: dia((sb && sb.fecha) || d.fechaPago) };
  if ((sb && sb.medio === 'efectivo') || s(d.medioPago) === 'efectivo' || s(d.origenDetalle && d.origenDetalle.medio) === 'efectivo') return { estado: 'efectivo', fechaPago: dia((sb && sb.fecha) || d.fechaPago) };
  if (sb && (sb.medio === 'mercadopago' || sb.medio === 'personal')) return { estado: sb.medio, fechaPago: dia(sb.fecha || d.fechaPago) };   // v0.81.0
  if (d.esperaCargo === true) return { estado: 'espera', fechaPago: dia(d.fechaPago) };
  if (forma === 'proveedor') return dia(d.fechaPago) ? { estado: 'pagado', fechaPago: dia(d.fechaPago) } : { estado: 'credito', fechaPago: '' };
  return { estado: 'sin_cargo', fechaPago: dia(d.fechaPago) };
}
export function registradosGastos(gastos, vencs, hoy, diasAtras = 150) {
  const corte = sumarDias(hoy, -diasAtras), grupos = {}, out = [];
  (gastos || []).forEach(({ id, d }) => {
    if (!d || d.estado !== 'vigente' || d.quitadoEnPlanilla) return;
    const f = dia(d.fecha); if (!f || f < corte) return;
    const e = estadoGastoDoc(d), m = /^(F|NC)\.\s*(\d+)/.exec(s(d.observacion)), folio = s(d.folio) || (m ? m[2] : '') || s(d.siiDoc && d.siiDoc.folio);
    const k = [f, s(d.hora), s(d.observacion), s(d.rutProveedor), s(d.vencimientoId), e.cargoId || '', folio].join('|');
    let x = grupos[k];
    if (!x) { x = grupos[k] = { tipo: 'gasto', ids: [], fecha: f, items: [], areas: [], monto: 0, folio, razon: s(d.razonSocial), rut: s(d.rutProveedor).toUpperCase().replace(/[^0-9K]/g, ''), obs: s(d.observacion), ...e, nc: false }; out.push(x); }
    if (x.ids.length >= 40) return;
    x.ids.push(id); x.monto += n(d.montoFinal);
    if (s(d.itemGasto) && !x.items.includes(s(d.itemGasto))) x.items.push(s(d.itemGasto));
    if (s(d.area) && !x.areas.includes(s(d.area))) x.areas.push(s(d.area));
    if (n(d.montoFinal) < 0) x.nc = true;
  });
  (vencs || []).forEach(({ id, d }) => {
    if (!d || d.quitadoEnPlanilla) return;
    const est = s(d.estado).toLowerCase(); if (est === 'anulado') return;
    const vence = dia(d.fechaVencimiento) || dia(d.fechaEstimada), fp = dia(d.fechaPago), ref = fp || vence;
    if (!ref || ref < corte) return;
    const pagado = est === 'pagado', cargo = s(d.cartolaCargo) || ((CC_RE.exec(s(d.cartola)) || [])[1] || '');
    const monto = pagado && n(d.montoPago) ? n(d.montoPago) : (n(d.montoDocumento) || n(d.montoEstimado));
    const m = /^\s*\S*\s*(.*?)\s+F\.(\d+)\s*$/.exec(s(d.nombre));
    const partes = PM.partesDe(d), total = n(d.montoDocumento) || n(d.montoEstimado);
    out.push({ tipo: 'venc', ids: [id], fecha: vence, vence, nombre: limpio(d.nombre), items: s(d.item) ? [s(d.item)] : [], areas: s(d.area) ? [s(d.area)] : [], monto, folio: m ? m[2] : s(d.folio), razon: m ? m[1].trim() : s(d.razonSocial),
      // v0.69.2: con partes (abonos), su historial y lo que falta
      estado: pagado ? (partes.length > 1 || partes.some(x => x.medio !== 'banco') ? 'partes' : cargo ? 'cargo' : 'pagado') : partes.length ? 'con_abonos' : 'por_pagar', cargoId: cargo, fechaPago: fp, rut: '',
      ...(partes.length ? { partes, totalDoc: total, falta: Math.max(0, total - partes.reduce((a, x) => a + x.monto, 0)) } : {}) });
  });
  return out.sort((a, b) => s(b.fecha).localeCompare(s(a.fecha))).slice(0, 1200);
}
function sumarDias(f, k) { if (!esIso(f)) return '0000-00-00'; const d = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + k)); return d.toISOString().slice(0, 10); }
// El estado en palabras y su tono. cargoTxt(id) → "12 oct · $52.000 · COMPRA FICTICIA" (o '' si no está en la memoria)
const CLASE_SIN = { sii: 'Factura del SII registrada: espera su pago por banco', espera: 'Pagado por banco a mano: espera su cargo', vencimiento: 'Pago de vencimiento registrado: espera su cargo',
  efectivo: 'Registrado en efectivo (sin cargo de la cartola)', contado: 'Al contado: todavía sin cargo de la cartola' };
export function estadoTxt(r, cargoTxt) {
  const ct = r.cargoId && cargoTxt ? cargoTxt(r.cargoId) : '';
  switch (r.estado) {
    case 'cargo': return { texto: `Pagado con el cargo ${ct || 'de otra cartola'}`, tono: 'verde', corto: 'Conciliado' };
    case 'efectivo': return { texto: `Pagado en efectivo${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}`, tono: 'gris', corto: 'Efectivo' };
    case 'tarjeta': return { texto: `Pagado con tarjeta de crédito${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}`, tono: 'gris', corto: 'Tarjeta' };
    case 'mercadopago': return { texto: `Pagado o descontado en Mercado Pago${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}`, tono: 'gris', corto: 'Mercado Pago' };
    case 'personal': return { texto: `Pagado por el dueño con plata personal${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}`, tono: 'gris', corto: 'Plata personal' };
    case 'espera': return { texto: 'Pagado por banco a mano: espera su cargo', tono: 'azul', corto: 'Espera su cargo' };
    case 'credito': return { texto: 'A crédito: todavía por pagar', tono: 'amarillo', corto: 'Por pagar' };
    case 'pagado': return { texto: `Pagado${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''} (registrado a mano, sin cargo de la cartola)`, tono: 'gris', corto: 'Pagado' };
    case 'por_pagar': return { texto: `Vencimiento por pagar${r.vence ? ' · vence el ' + diaTxt(r.vence) : ''}`, tono: 'amarillo', corto: 'Por pagar' };
    case 'sin_cargo': return { texto: CLASE_SIN[r.clase] || 'Registrado: todavía sin cargo de la cartola', tono: 'azul', corto: 'Espera su cargo' };
    case 'por_clasificar': return { texto: 'Factura del SII por clasificar: todavía no está en Gastos', tono: 'amarillo', corto: 'Por clasificar' };
    // v0.69.2 · Pagos mixtos
    case 'partes': return { texto: PM.textoPagado(r.partes || [], r.totalDoc, cargoFechaDe(cargoTxt)) || 'Pagado en partes', tono: 'verde', corto: 'Pagado en partes' };
    case 'con_abonos': return { texto: r.partes && r.partes.length ? PM.textoPagado(r.partes, r.totalDoc, cargoFechaDe(cargoTxt)) : 'Con pagos parciales: todavía tiene saldo', tono: 'amarillo', corto: 'Con saldo' };
    default: return { texto: '', tono: 'gris', corto: '' };
  }
}

// La fecha de un cargo (para "banco (cargo dd-mm)"): cargoTxt puede traer .fecha(id); si no, la de la parte
const cargoFechaDe = cargoTxt => (cargoTxt && typeof cargoTxt.fecha === 'function' ? cargoTxt.fecha : null);
// v0.69.2 · El historial de pagos de un documento: una línea por parte (medio, fecha, cargo u origen) y lo que falta
export function historialPagos(partes, total, cargoFecha) {
  const l = (partes || []).filter(p => p && p.monto > 0); if (!l.length) return null;
  const pagado = l.reduce((a, p) => a + p.monto, 0), falta = Math.max(0, Math.round(n(total) - pagado));
  return { lineas: l.map(p => PM.textoParte(p, cargoFecha)), pagado, falta, total: Math.round(n(total)), texto: PM.textoPagado(l, total, cargoFecha) };
}
// "Buscar en Gastos": gastos sin cargo (se pueden elegir: "Ya está en Gastos"), vencimientos por pagar (se pueden pagar),
// facturas del SII por clasificar y lo ya pagado (solo se muestra: con qué cargo, en efectivo o con tarjeta).
// D = cart.d (la lista de Gastos en la memoria); c = el cargo. Sin búsqueda: lo del mismo monto (±$1).
// → [{ fuente: 'gasto'|'venc'|'sii'|'reg', clave, titulo, sub, monto, estado: { texto, tono, corto }, accion: 'gasto'|'venc'|'sii'|'', cargoId, id }]
export function buscarGastos(q, D, c, opc = {}) {
  const Q = parseQ(q), out = [], vistos = new Set(), max = opc.max || 12;
  const mismo = x => Math.abs(Math.abs(Math.round(n(x))) - Math.round(n(c && c.monto))) <= 1;
  const pasa = (texto, monto) => (Q.texto ? coincide(Q, { texto, montos: [monto] }) : mismo(monto));
  const claveG = x => [x.fecha, x.hora, x.monto, x.filas[0].fila].join('|');
  (D.gastos || []).concat(D.notasCredito || []).forEach(g => {
    const texto = norm([g.razon, g.items.join(' '), g.folio, g.obs, g.rut, g.chip].join(' '));
    g.filas.forEach(f => vistos.add(f.id));
    if (!pasa(texto, g.monto)) return;
    out.push({ fuente: 'gasto', clave: claveG(g), titulo: `${g.items.join(' + ')}${g.razon ? ' · ' + g.razon : ''}`, sub: [diaTxt(g.fecha), g.folio ? (g.monto < 0 ? 'NC ' : 'F.') + g.folio : '', (g.filas || []).map(f => f.area).filter((a, i, l) => a && l.indexOf(a) === i).join(', '), g.chip].filter(Boolean).join(' · '),
      monto: g.monto, fecha: g.fecha, estado: estadoTxt({ estado: 'sin_cargo', clase: g.clase }), accion: g.monto > 0 ? 'gasto' : '', ids: g.filas.map(f => f.id) });
  });
  (D.vencimientos || []).forEach(v => {
    vistos.add(v.id);
    const monto = v.estadoBase === 'con_abonos' && v.saldo ? v.saldo : v.monto, texto = norm([v.nombre, v.item, v.folio, v.razon, v.rut].join(' '));
    if (!pasa(texto, monto) && !(Q.texto && coincide(Q, { texto, montos: [v.monto, v.total] }))) return;
    out.push({ fuente: 'venc', clave: v.id, id: v.id, titulo: limpio(v.nombre), sub: [v.item, v.area, v.estadoBase === 'con_abonos' ? 'con abonos · saldo ' + pesos(v.saldo) : ''].filter(Boolean).join(' · '), monto, fecha: v.fecha,
      estado: estadoTxt({ estado: 'por_pagar', vence: v.fecha }), accion: v.tipoObligacion === 'libre' ? '' : 'venc' });
  });
  (D.siiPendientes || []).forEach(v => {
    const texto = norm([v.razonSocial || v.razon, v.folio, v.rut].join(' '));
    if (!pasa(texto, v.total)) return;
    out.push({ fuente: 'sii', clave: v.id, id: v.id, titulo: `${v.esNC ? 'Nota de crédito' : 'Factura'} F.${s(v.folio)} · ${s(v.razonSocial || v.razon)}`, sub: diaTxt(v.fecha), monto: v.total, fecha: v.fecha, estado: estadoTxt({ estado: 'por_clasificar' }), accion: 'sii' });
  });
  (D.registrados || []).forEach(r => {
    if (r.ids.some(id => vistos.has(id))) return;   // ya está arriba (sin cargo o por pagar)
    const texto = norm([r.razon, r.nombre, r.items.join(' '), r.folio, r.obs, r.rut].join(' '));
    if (!pasa(texto, r.monto)) return;
    out.push({ fuente: 'reg', clave: (r.tipo === 'venc' ? 'v:' : 'g:') + r.ids[0], titulo: r.tipo === 'venc' ? r.nombre : `${r.items.join(' + ') || 'Gasto'}${r.razon ? ' · ' + r.razon : ''}`,
      sub: [r.tipo === 'venc' ? (r.vence ? 'vence el ' + diaTxt(r.vence) : '') : diaTxt(r.fecha), r.folio ? 'F.' + r.folio : '', r.areas.join(', ')].filter(Boolean).join(' · '), monto: r.monto, fecha: r.fecha,
      estado: estadoTxt(r, opc.cargoTxt), accion: '', cargoId: r.cargoId || '', ids: r.ids });
  });
  // Lo del mismo monto primero; después lo más cercano a la fecha del cargo
  const d0 = x => Math.abs(diasEntre(x.fecha || '', (c && c.fecha) || '') || 9999);
  return out.sort((a, b) => (mismo(b.monto) - mismo(a.monto)) || d0(a) - d0(b)).slice(0, max);
}

// ═══ Abonos (B2B) ═══
const POR_ABONO = { transferencia: 'el RUT de la transferencia recibida', rut: 'el RUT en la glosa', aprendido: 'lo aprendiste antes con esta glosa', manual: 'elegiste tú el cliente', nombre: 'la glosa trae su nombre completo',
  'nombre-parcial': 'la glosa se parece a su nombre', monto: 'solo calza el monto exacto con lo que debe', regla: 'una regla tuya dice el cliente' };
// v0.125.2 · Etapa 2: el motivo de la propuesta de un abono, en corto y con su tono (verde: seguro · amarillo: revíselo)
const MOTIVO_AB = { transferencia: ['mismo RUT', 'verde'], rut: ['mismo RUT', 'verde'], aprendido: ['lo aprendido', 'verde'], manual: ['elegido por usted', 'verde'],
  nombre: ['su nombre en la glosa', 'verde'], 'nombre-parcial': ['se parece al nombre', 'amarillo'], monto: ['solo el monto', 'amarillo'], regla: ['su regla', 'verde'] };
export function motivoAbono(p, rep) {
  if (rep) return { txt: 'repetido', tono: 'amarillo' };
  if (!p || p.tipo === 'sinCliente') return null;
  if (p.accion === 'noB2B' || p.accion === 'revisado') return { txt: 'su regla', tono: 'verde' };
  if (p.por === 'regla' && p.soloProponer) return { txt: 'su regla (solo propone)', tono: 'amarillo' };
  const x = MOTIVO_AB[p.por];
  return x ? { txt: x[0], tono: x[1] } : null;
}
// Cuando no hay propuesta, se dice en palabras (en vez de dejar el espacio vacío)
export const PROPONE_NADA = 'Nada: ningún monto calza y no se reconoce quién pagó.';
export const sinPropuestaAbono = (p, rep) => !rep && (!p || p.tipo === 'sinCliente') ;
export function resumenAbono(p, rep) {
  if (rep) return 'Parece repetido de otra cartola';
  if (!p || p.tipo === 'sinCliente') return 'Sin coincidencia';
  if (p.accion === 'noB2B') return 'No es de B2B (tu regla)';
  if (p.accion === 'revisado') return `Ya lo anoté a mano${p.cliente ? ' · ' + p.cliente : ''} (tu regla)`;
  const fs = (p.asignaciones || []).filter(a => n(a.monto) > 0).map(a => 'F.' + a.folio);
  if (fs.length) return `Paga ${fs.join(' + ')} · ${p.cliente}`;
  if (p.yaPagado) return `Parece un pago ya registrado · ${p.cliente}`;
  return `${p.cliente}: elige el folio`;
}
export function queEsAbono(m, p, ctx = {}) {
  const base = `Abono de ${pesos(m.monto)} del ${diaTxt(m.fecha)}${ctx.cuenta ? ' en la ' + ctx.cuenta : ''}`;
  const t = p && p.tef;
  if (t && t.nombre) return `${base}: transferencia recibida de ${t.nombre}${t.rutTxt || t.rut ? ' (RUT ' + (t.rutTxt || t.rut) + ')' : ''}${t.banco ? ', ' + t.banco : ''}.`;
  if (p && p.cliente && p.confianza === 'seguro') return `${base}: es de ${p.cliente} (por ${POR_ABONO[p.por] || 'lo que dice la glosa'}).`;
  return `${base}. La glosa no dice con seguridad quién pagó: «${s(m.descripcion)}».`;
}
// folios: los por cobrar de ese cliente (para la fecha de la factura)
export function porQueAbono(m, p, folios, rep) {
  if (rep) return { que: 'Marcarlo como repetido de otra cartola', porque: 'mismo monto y fecha a ±1 día que un abono de otra cartola' };
  if (p && (p.accion === 'noB2B' || p.accion === 'revisado')) return { que: resumenAbono(p), porque: `lo dice tu regla «${limpio(p.fraseRegla || '')}»` };
  if (!p || p.tipo === 'sinCliente') return { que: 'Nada calza con este abono', porque: 'no se sabe quién pagó y el monto no calza exacto con lo que debe ningún cliente. Busca la factura abajo o márcalo "No es de B2B"' };
  const as = (p.asignaciones || []).filter(a => n(a.monto) > 0), sobra = n(p.sobra);
  const partes = [POR_ABONO[p.por] || ''];
  if (as.length) partes.push(sobra === 0 ? 'monto exacto' : `sobran ${pesos(sobra)}`);
  if (as.length === 1) { const f = (folios || []).find(x => x.folio === as[0].folio); if (f && f.fecha) partes.push(diasTxt(f.fecha, m.fecha, 'de la factura')); }
  if (p.yaPagado) partes.push(`el folio ${p.yaPagado.folio} ya se registró pagado`);
  if (p.tipo === 'revisar' && p.confianza === 'probable') partes.push('nunca se confirma solo');
  return { que: resumenAbono(p), porque: partes.filter(Boolean).join(', ') };
}
// Las facturas de un cliente: abiertas (por cobrar) y pagadas recientes (de las órdenes en la memoria)
// porCobrar: los folios por cobrar del cliente; ordenes: todas las de la memoria; abonos: los registros de abonos; movDe(folio): el abono de la cartola que lo pagó
export function facturasCliente(clienteId, cliente, porCobrar, ordenes, abonos, movDe, opc = {}) {
  const abiertas = (porCobrar || []).map(f => ({ folio: f.folio, fecha: f.fecha, total: f.total, saldo: f.saldo, abonado: f.abonado || 0,
    abonos: (abonos || []).filter(a => s(a.folio) === f.folio).map(a => ({ fecha: dia(a.fecha), monto: n(a.monto), movimiento: s(a.movimiento) })) }));
  const nombreN = norm(cliente), F = {}, vistos = new Set();
  (ordenes || []).forEach(o => {
    if (vistos.has(s(o.n))) return; vistos.add(s(o.n));
    if (!o.folio || o.estado === 'anulada' || o.quitadoEnPlanilla || !/PAGADO/.test(s(o.estadoPago).toUpperCase())) return;
    if (!(o.clienteId === clienteId || (!o.clienteId && norm(o.cliente) === nombreN))) return;
    const k = s(o.folio), f = F[k] || (F[k] = { folio: k, fecha: dia(o.fechaFolio) || dia(o.fecha), total: 0, fechaPago: '', medio: '' });
    f.total += n(o.total); if (dia(o.fechaPago) > f.fechaPago) f.fechaPago = dia(o.fechaPago); if (o.medioPago) f.medio = s(o.medioPago);
    if (n(o.totalFactura) > 0) f.totalFactura = n(o.totalFactura);
  });
  const pagadas = Object.values(F).map(f => {
    const mv = movDe ? movDe(f.folio) : null, ab = (abonos || []).filter(a => s(a.folio) === f.folio);
    const conQue = mv ? `con el abono de la cartola del ${diaTxt(mv.fecha)} (${pesos(mv.monto)})` : /cartola/i.test(f.medio) ? `con un abono de la cartola del ${diaTxt(f.fechaPago)}` : f.medio ? `${f.medio.toLowerCase()}` : 'registrado a mano en Por cobrar';
    return { folio: f.folio, fecha: f.fecha, total: Math.round(f.totalFactura || f.total), saldo: 0, fechaPago: f.fechaPago, conQue, movId: mv ? mv.id : '', abonos: ab.map(a => ({ fecha: dia(a.fecha), monto: n(a.monto) })) };
  }).sort((a, b) => s(b.fechaPago).localeCompare(s(a.fechaPago)) || Number(b.folio) - Number(a.folio)).slice(0, opc.max || 5);
  return { abiertas, pagadas };
}
// "Buscar facturas" (folio, cliente o monto): las abiertas de todos los clientes y las pagadas de la memoria
// porCobrar: { clienteId: [folios] }; clientes: [{ id, nombre }]; ordenes: las de la memoria
export function buscarFacturas(q, porCobrar, clientes, ordenes, opc = {}) {
  const Q = parseQ(q); if (!Q.texto) return [];
  const nom = {}; (clientes || []).forEach(c => { nom[c.id] = c.nombre; });
  const out = [], abiertos = new Set();
  Object.entries(porCobrar || {}).forEach(([cid, l]) => l.forEach(f => {
    abiertos.add(f.folio);
    const texto = norm(['f' + f.folio, f.folio, nom[cid] || f.cliente].join(' '));
    if (!coincide(Q, { texto, montos: [f.saldo, f.total] })) return;
    out.push({ abierta: true, folio: f.folio, clienteId: cid, cliente: nom[cid] || f.cliente, fecha: f.fecha, total: f.total, saldo: f.saldo });
  }));
  const F = {}, vistos = new Set();
  (ordenes || []).forEach(o => {
    if (vistos.has(s(o.n))) return; vistos.add(s(o.n));
    if (!o.folio || abiertos.has(s(o.folio)) || o.estado === 'anulada' || o.quitadoEnPlanilla || !/PAGADO/.test(s(o.estadoPago).toUpperCase())) return;
    const k = s(o.folio), f = F[k] || (F[k] = { abierta: false, folio: k, clienteId: o.clienteId || '', cliente: o.cliente || nom[o.clienteId] || '', fecha: dia(o.fechaFolio) || dia(o.fecha), total: 0, saldo: 0, fechaPago: '' });
    f.total += n(o.total); if (n(o.totalFactura) > 0) f.tf = n(o.totalFactura); if (dia(o.fechaPago) > f.fechaPago) f.fechaPago = dia(o.fechaPago);
  });
  Object.values(F).forEach(f => { if (f.tf) f.total = f.tf; delete f.tf; f.total = Math.round(f.total); if (coincide(Q, { texto: norm(['f' + f.folio, f.folio, f.cliente].join(' ')), montos: [f.total] })) out.push(f); });
  return out.sort((a, b) => (b.abierta - a.abierta) || s(b.fecha).localeCompare(s(a.fecha))).slice(0, opc.max || 12);
}

// ═══ Avanzar: el siguiente pendiente de la lista visible (o el anterior, si era el último) ═══
export function siguiente(orden, id) {
  const l = (orden || []).filter(Boolean), i = l.indexOf(id);
  if (i < 0) return l[0] || '';
  return l[i + 1] || l[i - 1] || '';
}
