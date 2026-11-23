// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos en la base nueva (etapa G3, segunda parte): reglas puras  v0.49.0 · v0.51.0 (identificador "previred")
//  La forma de trabajar acordada con Emmanuel (solo con la base nueva; con la planilla nada cambia):
//  · Obligación (la regla) con TIPO: "fijo" (monto fijo: arriendo, cuotas), "documento" (el monto y la fecha real
//    vienen de la boleta del mes o de la factura del SII: luz, agua, internet, gas) o "libre" (sin monto de antes;
//    se paga con varias transferencias = abonos: sueldos líquidos). Y un IDENTIFICADOR (N° de cliente de la boleta
//    o RUT del proveedor del SII) para encontrarla cuando llega su documento. Sin tipo (copiadas de la planilla) =
//    se comporta como "fijo" y se marca "sin clasificar". Campo en la base: tipoObligacion (el campo "tipo" ya es
//    DIRECTO / INDIRECTO del ítem).
//  · Vencimiento = un pago concreto de un período. Estado (campo "estado"): esperando_documento, por_pagar,
//    con_abonos, pagado, anulado. Los copiados de la planilla traen PENDIENTE / VENCIDA / PAGADO / ANULADO: se leen
//    igual (VENCIDA = por pagar con la fecha pasada) y a la planilla se pasa el valor que la app antigua entiende.
//  · Vencimiento suelto: un pago de una vez sin obligación (patente). Recordatorio "Subir boleta de …": se calcula
//    (no se guarda) mientras un vencimiento de tipo documento espera su boleta.
//  · Leer una boleta (luz, agua): N° de cliente, total a pagar y fecha de vencimiento, con formatos chilenos.
//  · v0.53.0: la factura del SII deja en el vencimiento su neto, IVA, exento y total (montosSii); al pagarlo, el gasto
//    toma el neto de la factura (netoFactura / conNetoSii).
//  Sin red: se prueba sola. Fechas aaaa-mm-dd (hora de Chile).
// ═══════════════════════════════════════════════
import { dia } from './gastos-modelo.js?v=0.138.0';

export const TIPOS_OBLIGACION = ['fijo', 'documento', 'libre'];
export const NOMBRE_TIPO = { fijo: 'Monto fijo', documento: 'Según documento del mes', libre: 'Libre (abonos)' };
export const ESTADOS = ['esperando_documento', 'por_pagar', 'con_abonos', 'pagado', 'anulado'];
export const NOMBRE_ESTADO = { esperando_documento: 'Esperando documento', por_pagar: 'Por pagar', con_abonos: 'Con abonos', pagado: 'Pagado', anulado: 'Anulado' };
export const DIAS_AVISO = 3;                 // "Subir boleta" N días antes de la fecha estimada (se puede cambiar por obligación)
export const ANTELACION_DOCUMENTO = 20;      // un vencimiento de tipo documento se crea 20 días antes (la boleta llega antes)
export const ESTADOS_DOC_PEND = ['pendiente', 'asignado', 'gasto', 'obligacion', 'descartado'];

const s = v => String(v == null ? '' : v);
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const x = Number(String(v || '').replace(/[^0-9-]/g, '')); return isFinite(x) ? x : 0; };
const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
const isoUTC = ms => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return isoUTC(Date.UTC(y, m - 1, d + n)); };
const diasEntre = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(...a.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))) / 864e5);

// ── Tipo de una obligación ──
// Sin tipo (copiada de la planilla): se comporta como "fijo" y aparece "sin clasificar"
export const tipoDe = p => (TIPOS_OBLIGACION.includes(s(p && p.tipoObligacion)) ? s(p.tipoObligacion) : 'fijo');
export const sinClasificar = p => !TIPOS_OBLIGACION.includes(s(p && p.tipoObligacion));
// N° de cliente o RUT, para comparar: solo dígitos y K, sin ceros a la izquierda ("0012.345-6" = "123456")
export const normIdent = v => s(v).toUpperCase().replace(/[^0-9K]/g, '').replace(/^0+/, '');
export const diasAvisoDe = p => { const x = parseInt(p && p.diasAviso, 10); return x >= 0 && x <= 60 ? x : DIAS_AVISO; };
// Lo del formulario de la obligación (solo con la base nueva). Devuelve { error } o { campos }
export function clasificacionDesdeForm(p) {
  const tipo = s(p.tipoObligacion);
  if (!TIPOS_OBLIGACION.includes(tipo)) return { error: 'Elige el tipo de la cuenta recurrente' };
  let ident = s(p.identificador).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40).replace(/^[=+\-@\s]+/, '');
  // v0.51.0: "previred" marca la obligación de Cotizaciones (la completa el certificado de Previred)
  if (/^previred$/i.test(ident)) ident = 'previred';
  else if (ident && !normIdent(ident)) return { error: 'El N° de cliente o RUT debe tener números' };
  const dias = p.diasAviso === '' || p.diasAviso == null ? DIAS_AVISO : parseInt(p.diasAviso, 10);
  if (!(dias >= 0 && dias <= 60)) return { error: 'El aviso va de 0 a 60 días antes' };
  // v0.63.1: "Se paga por" (banco, efectivo o tarjeta), si el formulario lo trae
  const sp = ['banco', 'efectivo', 'tarjeta'].includes(s(p.sePagaPor)) ? s(p.sePagaPor) : '';
  return { campos: { tipoObligacion: tipo, identificador: tipo === 'documento' ? ident : '', diasAviso: tipo === 'documento' ? dias : '', ...(sp ? { sePagaPor: sp } : {}) } };
}

// ── Estado de un vencimiento ──
// El de la base (nuevo), también para lo copiado de la planilla
export function estadoBase(d) {
  const e = s(d && d.estado);
  if (ESTADOS.includes(e)) return e;
  const u = e.toUpperCase();
  if (u === 'PAGADO') return 'pagado';
  if (u === 'ANULADO') return 'anulado';
  return (Array.isArray(d && d.abonos) && d.abonos.length) ? 'con_abonos' : 'por_pagar';   // PENDIENTE, VENCIDA o vacío
}
export const abierto = d => ['esperando_documento', 'por_pagar', 'con_abonos'].includes(estadoBase(d));
// Lo que va en la columna Estado de la planilla (la app antigua entiende solo estos)
export function estadoPlanilla(e) {
  const x = s(e);
  if (x === 'pagado') return 'PAGADO';
  if (x === 'anulado') return 'ANULADO';
  if (x === 'esperando_documento' || x === 'por_pagar' || x === 'con_abonos') return 'PENDIENTE';
  return x;    // ya viene en el formato de la planilla
}
// La fecha que vale: la del documento (fecha real) si llegó; si no, la de la obligación (estimada)
// v0.64.0: un vencimiento con abonos (pago parcial) cuyo saldo se reagendó vale por la fecha nueva del saldo
export const fechaReal = d => (d && dia(d.fechaSaldo) && estadoBase(d) === 'con_abonos' ? dia(d.fechaSaldo) : '') || dia(d && d.fechaDocumento) || dia(d && d.fechaVencimiento) || s(d && d.fechaVencimiento);
// Para las pantallas de siempre (Vencimientos, Hoy, Agenda): PENDIENTE / VENCIDA / PAGADO / ANULADO
export function estadoVista(d, hoy) {
  const e = estadoBase(d);
  if (e === 'pagado') return 'PAGADO';
  if (e === 'anulado') return 'ANULADO';
  const f = fechaReal(d);
  return f && hoy && f < hoy ? 'VENCIDA' : 'PENDIENTE';
}
// Estado de un vencimiento recién creado (generado por su obligación, suelto, de una compra a crédito o del SII)
export function alCrear(d, obligacion) {
  const tipo = obligacion ? tipoDe(obligacion) : '';
  const out = { ...d, estado: obligacion && tipo === 'documento' ? 'esperando_documento' : 'por_pagar' };
  if (obligacion && !sinClasificar(obligacion)) {
    out.tipoObligacion = tipo;
    if (tipo === 'documento') { out.fechaEstimada = s(d.fechaVencimiento); out.diasAviso = diasAvisoDe(obligacion); }
  }
  return out;
}
// Al clasificar una obligación: sus vencimientos abiertos sin documento ni abonos toman el tipo nuevo.
// vencs: { id, d }. Devuelve [{ id, campos }]
export function reclasificar(vencs, oblId, clasif) {
  const out = [];
  (vencs || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.plantillaID) === oblId).forEach(({ id, d }) => {
    const e = estadoBase(d);
    if (!['esperando_documento', 'por_pagar'].includes(e) || d.documento || (Array.isArray(d.abonos) && d.abonos.length)) return;
    const c = { tipoObligacion: clasif.tipoObligacion };
    if (clasif.tipoObligacion === 'documento') Object.assign(c, { estado: 'esperando_documento', fechaEstimada: s(d.fechaEstimada) || s(d.fechaVencimiento), diasAviso: clasif.diasAviso === '' ? DIAS_AVISO : clasif.diasAviso });
    else c.estado = 'por_pagar';
    if (c.estado === d.estado && c.tipoObligacion === d.tipoObligacion) return;
    out.push({ id, campos: c });
  });
  return out;
}

// ── Documento del mes (boleta o factura) ──
// doc = { tipo: 'boleta'|'sii'|'previred', url, nombreArchivo, numero, rut, cliente, monto, fechaVencimiento }
export function completarDocumento(d, doc, quien, en) {
  const e = estadoBase(d);
  if (e === 'pagado') return { error: 'Ese vencimiento ya está pagado' };
  if (e === 'anulado') return { error: 'Ese vencimiento fue anulado' };
  if (e === 'con_abonos') return { error: 'Ese vencimiento ya tiene abonos' };
  const monto = Math.round(num(doc.monto));
  if (!(monto > 0)) return { error: 'Falta el monto del documento' };
  if (!esIso(doc.fechaVencimiento)) return { error: 'Falta la fecha de vencimiento del documento' };
  const tipo = ['boleta', 'sii', 'previred'].includes(doc.tipo) ? doc.tipo : 'boleta';
  return { campos: {
    estado: 'por_pagar', montoDocumento: monto, fechaDocumento: doc.fechaVencimiento, fechaEstimada: s(d.fechaEstimada) || s(d.fechaVencimiento),
    documento: { tipo, url: s(doc.url), nombreArchivo: s(doc.nombreArchivo).slice(0, 120), numero: s(doc.numero).slice(0, 40), rut: s(doc.rut).slice(0, 20), cliente: s(doc.cliente).slice(0, 40),
      pendienteId: s(doc.pendienteId), por: s(quien), en: s(en), ...(tipo === 'sii' ? { folio: s(doc.folio || doc.numero).slice(0, 20), razonSocial: s(doc.razonSocial).slice(0, 120), siiDocId: s(doc.siiDocId).slice(0, 80), ...montosSii(doc) } : {}) }
  } };
}
// v0.53.0 · Los montos exactos de la factura del SII que completa un vencimiento: neto, IVA, exento, otros impuestos
// (impuesto adicional, harina), total y tipo de documento. {} si no los trae (los vencimientos antiguos siguen igual).
const esNumero = v => v !== '' && v != null && isFinite(Number(v));
export function montosSii(doc) {
  const x = doc || {};
  if (!esNumero(x.neto) || !esNumero(x.total) || !(Number(x.total) > 0)) return {};
  const r = v => (esNumero(v) ? Math.round(Number(v)) : 0);
  return { neto: r(x.neto), iva: r(x.iva), exento: r(x.exento), otroImpuesto: r(x.otroImpuesto), total: r(x.total), tipoDoc: /^\d{2,3}$/.test(s(x.tipoDoc)) ? s(x.tipoDoc) : '33', esHarina: !!x.esHarina };
}
// ¿El documento del vencimiento trae el neto exacto de la factura?
export const conNetoFactura = doc => !!(doc && doc.tipo === 'sii' && esNumero(doc.neto) && esNumero(doc.total) && Number(doc.total) > 0);
// Neto del pago según la factura: si se paga el total, el neto de la factura; si se paga otro monto, el neto en la misma
// proporción (redondeado) y una nota para la observación. null = sin factura con montos (se calcula como siempre).
// El neto es el "Monto neto" de la factura (sin el exento ni otros impuestos), igual que al importar una factura del SII.
export function netoFactura(doc, montoPagado) {
  if (!conNetoFactura(doc)) return null;
  const total = Math.round(Number(doc.total)), neto = Math.round(Number(doc.neto)), pagado = Math.round(Number(montoPagado) || 0);
  if (pagado === total) return { neto, exacto: true, nota: '' };
  const fmt = v => '$' + Math.round(v).toLocaleString('es-CL');
  return { neto: Math.round(neto * pagado / total), exacto: false, nota: `Neto proporcional a la F.${s(doc.folio)} (pagado ${fmt(pagado)} de ${fmt(total)})` };
}
// Aplica el neto de la factura a las líneas de un pago (calculadas como bruto): el neto se reparte según el monto de cada
// línea y la última se lleva el resto (la suma es exacta). Sin factura con montos, las líneas quedan igual.
export function conNetoSii(lineas, doc, montoPagado) {
  const r = netoFactura(doc, montoPagado);
  if (!r || !Array.isArray(lineas) || !lineas.length) return lineas;
  const totalF = lineas.reduce((x, l) => x + (Number(l.montoFinal) || 0), 0);
  if (!totalF) return lineas;
  let resto = r.neto;
  return lineas.map((l, i) => {
    const neto = i === lineas.length - 1 ? resto : Math.round(r.neto * (Number(l.montoFinal) || 0) / totalF);
    resto -= neto;
    const obs = r.exacto || s(l.observacion).indexOf(r.nota) !== -1 ? s(l.observacion) : (s(l.observacion) + ' · ' + r.nota).replace(/^ · /, '').slice(0, 300);
    return { ...l, tipoMonto: 'bruto', montoNeto: neto, esHarina: doc.esHarina ? 'Sí' : 'No', observacion: obs };
  });
}
// v0.50.0 · Al pagar un vencimiento cuyo documento es una factura del SII (internet, gas, teléfono), sus gastos quedan
// con el RUT, la razón social y "F.<folio>" en la observación (como un gasto importado del SII: así cuenta para el IVA y
// el documento queda como ya importado). lineas: documentos de gasto (docGasto); d: el vencimiento.
export function conDocumentoSii(lineas, d) {
  const x = d && d.documento;
  if (!x || x.tipo !== 'sii' || !s(x.rut) || !s(x.folio)) return lineas;
  return lineas.map(l => { const obs = s(l.observacion).indexOf('F.' + x.folio) === -1 ? ('F.' + x.folio + ' ' + s(l.observacion)).trim() : s(l.observacion);
    return { ...l, rutProveedor: s(x.rut), razonSocial: s(x.razonSocial), observacion: obs, folio: s(x.folio), esNC: false, siiDoc: { id: s(x.siiDocId), rut: s(x.rut), folio: s(x.folio), tipo: s(x.tipoDoc) || '33' } }; });
}
// Fecha de pago de una factura del SII que va a un vencimiento: la de vencimiento del documento o, si no trae, 30 días después
export const fechaFacturaSii = (fechaVenc, fechaDocto) => (esIso(fechaVenc) ? fechaVenc : esIso(fechaDocto) ? sumarDias(fechaDocto, 30) : '');

// Vencimiento de la obligación que completa un documento: el abierto, sin documento ni abonos, más cercano a la fecha del
// documento (primero los que esperan documento). vistas: vencimientos { id, d }. null = hay que crear el del período.
export function elegirVencimiento(vencs, oblId, fechaDoc) {
  const c = (vencs || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.plantillaID) === oblId && ['esperando_documento', 'por_pagar'].includes(estadoBase(x.d)) && !x.d.documento && !(Array.isArray(x.d.abonos) && x.d.abonos.length));
  if (!c.length) return null;
  const dist = x => Math.abs(diasEntre(dia(x.d.fechaVencimiento) || fechaDoc, fechaDoc));
  c.sort((a, b) => (estadoBase(a.d) === 'esperando_documento' ? 0 : 1) - (estadoBase(b.d) === 'esperando_documento' ? 0 : 1) || dist(a) - dist(b) || a.id.localeCompare(b.id));
  return c[0];
}
// Obligaciones activas con ese identificador
export const obligacionesDe = (plantillas, ident) => { const k = normIdent(ident); return k ? (plantillas || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.estado || 'ACTIVA') === 'ACTIVA' && normIdent(x.d.identificador) === k) : []; };

// ── Abonos (tipo libre) ──
export const totalAbonos = d => (Array.isArray(d && d.abonos) ? d.abonos : []).reduce((t, a) => t + num(a.monto), 0);
export const textoAbonos = (abonos, pesos) => { const l = Array.isArray(abonos) ? abonos : []; if (!l.length) return ''; const f = pesos || (x => '$' + Math.round(x).toLocaleString('es-CL'));
  return `${l.length} ${l.length === 1 ? 'abono' : 'abonos'}: ${l.map((a, i) => `ab. ${i + 1} ${f(num(a.monto))}`).join(' · ')} · total ${f(l.reduce((t, a) => t + num(a.monto), 0))}`; };
// a = { monto, fecha, origen ('mano'|'cartola'), cargoId, clave, gastoIds, url, por, en }. Devuelve { error } | { repetido } | { campos, abono }
export function agregarAbono(d, a) {
  const e = estadoBase(d);
  if (e === 'pagado') return { error: 'Ese vencimiento ya está cerrado (pagado)' };
  if (e === 'anulado') return { error: 'Ese vencimiento fue anulado' };
  const monto = Math.round(num(a.monto));
  if (!(monto > 0)) return { error: 'El monto del abono debe ser mayor que 0' };
  if (!esIso(a.fecha)) return { error: 'Falta la fecha del abono' };
  const lista = Array.isArray(d.abonos) ? d.abonos : [];
  if (a.clave && lista.some(x => x.clave === a.clave)) return { repetido: true };
  if (a.cargoId && lista.some(x => x.cargoId && x.cargoId === a.cargoId)) return { repetido: true };
  const abono = { monto, fecha: a.fecha, origen: a.origen === 'cartola' ? 'cartola' : 'mano', cargoId: s(a.cargoId), clave: s(a.clave), gastoIds: Array.isArray(a.gastoIds) ? a.gastoIds : [], url: s(a.url), por: s(a.por), en: s(a.en),
    // v0.63.1: el área (o reparto en %) de este abono y a quién fue
    ...(Array.isArray(a.areas) && a.areas.length ? { areas: a.areas.map(x => ({ area: s(x.area), pct: num(x.pct) })), fuenteArea: s(a.fuenteArea) } : {}),
    ...(a.destinatario && a.destinatario.clave ? { destinatario: { clave: s(a.destinatario.clave), nombre: s(a.destinatario.nombre) } } : {}) };
  return { abono, campos: { abonos: lista.concat([abono]), estado: 'con_abonos' } };
}
// ═══ v0.64.0 · Abonos a vencimientos de factura, documento o monto fijo (pagos parciales) ═══
// Lo acordado: el gasto es el del documento completo (lo devengado); los abonos solo registran la caja (fecha, monto, cargo).
//  · Vencimiento de una obligación (fijo, documento, sin clasificar) o suelto: el gasto se crea COMPLETO con el primer abono.
//  · Factura del SII o compra a crédito: su gasto ya existe (se creó al importar o registrar); los abonos no crean gastos y el
//    último le pone la fecha de pago.
//  · Previred no acepta abonos (el certificado se paga completo); las obligaciones libres siguen con su propio abono.
// Total del vencimiento: el del documento (boleta o factura) o, si no llegó, el estimado (con su reparto por área)
export function totalVenc(d) {
  if (num(d && d.montoDocumento) > 0) return num(d.montoDocumento);
  let ma = d && d.multiArea; if (typeof ma === 'string') { try { ma = JSON.parse(ma); } catch (e) { ma = null; } }
  if (Array.isArray(ma) && ma.length) return ma.reduce((t, a) => t + num(a.monto), 0);
  return num(d && d.montoEstimado);
}
export const saldoVenc = d => Math.max(0, totalVenc(d) - totalAbonos(d));
export const esLibre = d => s(d && d.tipoObligacion) === 'libre';
export const esPrevired = d => !!(d && d.documento && d.documento.tipo === 'previred');
// ¿Crea sus gastos al pagarse? (obligación o suelto). Las facturas del SII y compras a crédito ya tienen su gasto.
// v0.70.0 · Un por pagar "devengado" (nació de su boleta: luz, agua) ya tiene sus gastos desde que se subió la boleta (del mes del
// período): al pagarlo no se crean líneas, solo se les pone la fecha de pago (como una factura del SII). Nunca se cuenta dos veces.
export const esDevengado = d => !!(d && d.devengado === true && Array.isArray(d.gastosDoc) && d.gastosDoc.length);
export const conLineas = d => !esDevengado(d) && !!(s(d && (d.plantillaID || d.plantillaId)) || (d && d.suelto === true));
// a = { monto, fecha, origen, cargoId, clave, por, en, gastoIds }. Devuelve { error } | { repetido } | { campos, abono, final, saldo, total, primero }
export function abonoParcial(d, a) {
  if (esLibre(d)) return { error: 'Es una cuenta recurrente libre: usa "Agregar abono"' };
  if (esPrevired(d)) return { error: 'Previred se paga completo (el total del certificado): en la cartola usa "Pago de Previred".' };
  const e = estadoBase(d);
  if (e === 'pagado') return { error: 'Ese vencimiento ya está pagado' };
  if (e === 'anulado') return { error: 'Ese vencimiento fue anulado' };
  const monto = Math.round(num(a.monto)), total = totalVenc(d);
  if (!(monto > 0)) return { error: 'El monto del abono debe ser mayor que 0' };
  if (!esIso(a.fecha)) return { error: 'Falta la fecha del abono' };
  if (!(total > 0)) return { error: 'Este vencimiento no tiene monto: págalo completo.' };
  const lista = Array.isArray(d.abonos) ? d.abonos : [];
  if (a.clave && lista.some(x => x.clave === a.clave)) return { repetido: true };
  if (a.cargoId && lista.some(x => x.cargoId && x.cargoId === a.cargoId)) return { repetido: true };
  const saldo0 = total - totalAbonos(d);
  if (monto > saldo0) return { error: `El abono (${fmt(monto)}) es mayor que el saldo (${fmt(saldo0)})` };
  const abono = { monto, fecha: a.fecha, origen: a.origen === 'cartola' ? 'cartola' : 'mano', cargoId: s(a.cargoId), clave: s(a.clave), gastoIds: Array.isArray(a.gastoIds) ? a.gastoIds : [], url: s(a.url), por: s(a.por), en: s(a.en), parcial: true,
    // v0.69.2 · Pagos mixtos: el medio de esta parte (banco, efectivo o tarjeta), de dónde salió el efectivo, su registro en
    // sii_pagos (pagoId) y el cargo con el que se registró (conCargo: el resto de un cargo, para deshacerlo junto con él)
    ...(['banco', 'efectivo', 'tarjeta'].includes(s(a.medio)) ? { medio: s(a.medio) } : a.origen === 'cartola' ? { medio: 'banco' } : {}),
    ...(s(a.medio) === 'efectivo' ? { origenEfectivo: s(a.origenEfectivo) || 'cobros_b2b', ...(s(a.origenEfectivo) === 'otro' ? { origenTexto: s(a.origenTexto).slice(0, 120) } : {}) } : {}),
    ...(a.pagoId ? { pagoId: s(a.pagoId) } : {}), ...(a.conCargo ? { conCargo: s(a.conCargo) } : {}), ...(a.obs ? { obs: s(a.obs).slice(0, 200) } : {}) };
  const abonos = lista.concat([abono]), saldo = saldo0 - monto, final = saldo === 0;
  // v0.69.2: la fecha de pago es la de la última parte (por fecha), no la del último abono registrado
  const ultima = abonos.map(x => s(x.fecha)).filter(esIso).sort().pop() || a.fecha;
  const campos = final ? { abonos, estado: 'pagado', fechaPago: ultima, montoPago: String(total), fechaSaldo: '' } : { abonos, estado: 'con_abonos' };
  return { campos, abono, final, saldo, total, primero: !lista.length };
}
// Quitar el abono de un cargo (deshacer): { error } | { campos, quedan, eraPrimero, cerraba }
export function quitarAbonoParcial(d, cargoId, quitado) {
  const l = Array.isArray(d.abonos) ? d.abonos : [], k = l.findIndex(x => x.cargoId && x.cargoId === cargoId);
  if (k < 0) return { error: 'El abono ya no estaba' };
  const quedan = l.filter((x, i) => i !== k), eraPrimero = k === 0 && !!(l[k].gastoIds || []).length, cerraba = estadoBase(d) === 'pagado';
  if (eraPrimero && quedan.length) return { error: `"${s(d.nombre)}" tiene otros abonos después de este: deshaz primero esos cargos.` };
  const espera = s(d.tipoObligacion) === 'documento' && !d.documento;
  return { quedan, eraPrimero, cerraba, campos: { abonos: quedan, estado: quedan.length ? 'con_abonos' : (espera ? 'esperando_documento' : 'por_pagar'), fechaPago: '', montoPago: '',
    abonosQuitados: (Array.isArray(d.abonosQuitados) ? d.abonosQuitados : []).concat([{ ...l[k], quitado }]) } };
}
// "Con abonos · saldo $X" (para las listas)
export const textoSaldo = (d, pesos) => { const f = pesos || fmt; return `Con abonos · saldo ${f(saldoVenc(d))}`; };
const fmt = x => '$' + Math.round(x).toLocaleString('es-CL');

export function cerrar(d, quien, en) {
  const e = estadoBase(d);
  if (e === 'pagado') return { yaEstaba: true };
  if (e === 'anulado') return { error: 'Ese vencimiento fue anulado' };
  const l = Array.isArray(d.abonos) ? d.abonos : [];
  if (!l.length) return { error: 'Agrega al menos un abono antes de cerrar' };
  const ultima = l.map(a => a.fecha).sort().pop();
  return { campos: { estado: 'pagado', fechaPago: ultima, montoPago: String(totalAbonos(d)), cerrado: { por: s(quien), en: s(en) } } };
}

// ── Vencimiento suelto (sin obligación: una patente) ──
// p = { nombre, item, areas: [{area, monto}] | monto, fecha, tipoMonto, obs }; items: ítems vigentes
export function vencimientoSuelto(p, items, hoy) {
  const nombre = s(p.nombre).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80).replace(/^[=+\-@\s]+/, '');
  if (!nombre) return { error: 'Falta el nombre' };
  if (!esIso(p.fecha)) return { error: 'Falta la fecha de vencimiento' };
  const it = (items || []).find(i => i.item === p.item);
  if (!it) return { error: 'Elige el ítem de gasto' };
  const tipoMonto = ['bruto', 'neto', 'siniva'].includes(p.tipoMonto) ? p.tipoMonto : 'bruto';
  const d = { nombre, item: it.item, categoria: it.categoria || '', tipo: it.tipo || '', subTipo: it.subTipo || '', periodoKey: p.fecha.slice(0, 7), fechaVencimiento: p.fecha,
    obs: s(p.obs).slice(0, 300).replace(/^[=+\-@]+/, ''), tipoMonto, suelto: true, plantillaID: '', fechaCompra: '' };
  if (it.area === 'SELECCIONAR') {
    const a = (p.areas || []).filter(x => x && x.area && num(x.monto) > 0).map(x => ({ area: s(x.area), monto: Math.round(num(x.monto)) }));
    if (!a.length) return { error: 'Agrega al menos un área con monto' };
    Object.assign(d, { area: a.length === 1 ? a[0].area : 'MULTI', multiArea: a.length > 1 ? JSON.stringify(a) : '', montoEstimado: a.reduce((t, x) => t + x.monto, 0) });
  } else if (it.area === 'PRORRATEADO') {
    const pc = [1, 2, 3].map(k => [s(p['pArea' + k]), parseInt(p['pPct' + k], 10) || 0]).filter(x => x[0]);
    if (pc.length < 2 || pc.reduce((t, x) => t + x[1], 0) !== 100 || new Set(pc.map(x => x[0])).size !== pc.length) return { error: 'Reparto: al menos 2 áreas distintas que sumen 100%' };
    const m = Math.round(num(p.monto)); if (!(m > 0)) return { error: 'Falta el monto' };
    Object.assign(d, { area: 'PRORRATEADO', montoEstimado: m });
    pc.forEach((x, i) => { d['pArea' + (i + 1)] = x[0]; d['pPct' + (i + 1)] = x[1]; });
  } else {
    const m = Math.round(num(p.monto)); if (!(m > 0)) return { error: 'Falta el monto' };
    Object.assign(d, { area: it.area, montoEstimado: m });
  }
  return { d: { ...d, estado: 'por_pagar' } };
}

// ── Agenda con la base nueva: solo los vencimientos que existen + "Subir boleta" (calculado, no guardado) ──
// vistas: vencimientos como los entrega datos() (vistaVencimiento). Devuelve los elementos automáticos de la agenda.
export function agendaBase(vistas, desde, hasta, hoy) {
  const out = [];
  (vistas || []).forEach(v => {
    const eb = v.estadoBase || estadoBase(v);
    if (eb === 'anulado') return;
    const f = v.fecha;
    if (f && f >= desde && f <= hasta) {
      const pagado = eb === 'pagado', espera = eb === 'esperando_documento';
      out.push({ auto: true, cat: 'pago', tipo: 'fen', fecha: f, hora: '', titulo: `Pago de ${v.nombre}`, vencId: v.id, pagado, vencido: !pagado && f < hoy,
        origen: pagado ? 'Desde Gastos · pagado' : espera ? 'Desde Gastos · fecha estimada, falta la boleta' : eb === 'con_abonos' ? 'Desde Gastos · ' + textoAbonos(v.abonos) : 'Desde Gastos',
        monto: pagado ? num(v.montoPago) : num(v.montoDocumento) || num(v.montoEstimado) });
    }
    if (eb === 'esperando_documento') {
      const base = v.fechaEstimada || f; if (!base) return;
      let fr = sumarDias(base, -diasAvisoDe(v));
      if (fr < hoy) fr = hoy;              // atrasado: se sigue mostrando hoy hasta que se suba
      if (fr >= desde && fr <= hasta) out.push({ auto: true, cat: 'recordatorio', tipo: 'fen', fecha: fr, hora: '', titulo: `Subir boleta de ${v.nombre}`, origen: 'Recordatorio de Gastos', sub: `Vence cerca del ${base.split('-').reverse().join('-')} (fecha estimada)`, url: '#gastos/por-pagar', vencIdBoleta: v.id });
    }
  });
  return out;
}

// ═══════════════════════════════════════════════
//  Leer una boleta (texto del PDF): N° de cliente, total a pagar y fecha de vencimiento
//  Tolerante: "$35.000", "35.000", "$ 35.420", "dd-mm-aaaa", "dd/mm/aaaa", "dd.mm.aaaa", "15 de octubre de 2026".
//  Devuelve { cliente, monto, fechaVencimiento (aaaa-mm-dd), empresa } con lo que encontró ('' / 0 si no).
// ═══════════════════════════════════════════════
const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
function fechaDe(txt) {
  let m = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(txt);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo = Number(m[2]), d = Number(m[1]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  m = /(\d{1,2})\s*(?:de\s+)?([a-záéíóú]{3,10})\.?\s*(?:de\s+|del\s+)?(\d{4})/i.exec(txt);
  if (m) { const mo = MESES[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3)]; if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`; }
  return '';
}
const montoDe = txt => { const m = /\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/.exec(txt); return m ? Number(m[1].replace(/\./g, '')) : 0; };
export function parsearBoleta(texto) {
  const t = s(texto).replace(/\r/g, '').replace(/[ \t ]+/g, ' ');
  const lineas = t.split('\n').map(x => x.trim()).filter(Boolean);
  const plano = lineas.join('\n');
  const r = { cliente: '', monto: 0, fechaVencimiento: '', empresa: lineas[0] ? lineas[0].slice(0, 80) : '' };
  // N° de cliente: "N° Cliente", "Nº de cliente", "Número de cliente", "Cliente N°", "Servicio N°", "N° de servicio"
  const reCli = /(?:n(?:[°ºo]|ro\.?|um\.?|úmero|umero)\s*\.?\s*(?:de\s+)?(?:cliente|servicio|suministro)|(?:cliente|servicio|suministro)\s*n(?:[°ºo]|ro\.?|úmero|umero)\.?)\s*[:#]?\s*\n?\s*([0-9][0-9.\- ]{2,20}[0-9Kk])/i;
  let m = reCli.exec(plano);
  if (m) r.cliente = m[1].replace(/\s+/g, '').replace(/\.(?=\d{3})/g, '');
  // Total a pagar (el primero con número cerca), si no "Monto a pagar", "Total boleta", "Total"
  const etiquetasMonto = [/total\s+a\s+pagar/i, /monto\s+(?:total\s+)?a\s+pagar/i, /total\s+(?:boleta|factura|del\s+mes|cuenta)/i, /\btotal\b/i];
  for (const re of etiquetasMonto) {
    for (let i = 0; i < lineas.length && !r.monto; i++) {
      const k = lineas[i].search(re); if (k < 0) continue;
      const resto = lineas[i].slice(k).replace(re, '');
      let x = /\d/.test(resto) ? montoDe(resto.replace(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g, '')) : 0;
      if (!x && lineas[i + 1] && /^\$?\s*[\d.]+(,\d+)?$/.test(lineas[i + 1])) x = montoDe(lineas[i + 1]);
      if (x > 0) r.monto = x;
    }
    if (r.monto) break;
  }
  // Fecha de vencimiento: "Fecha de vencimiento", "Vencimiento", "Vence", "Pagar hasta", "Fecha límite de pago"
  const etiquetasFecha = [/fecha\s+(?:de\s+)?vencimiento/i, /vencimiento/i, /\bvence\b/i, /pagar\s+hasta/i, /fecha\s+l[ií]mite(?:\s+de\s+pago)?/i];
  for (const re of etiquetasFecha) {
    for (let i = 0; i < lineas.length && !r.fechaVencimiento; i++) {
      const k = lineas[i].search(re); if (k < 0) continue;
      const f = fechaDe(lineas[i].slice(k)) || (lineas[i + 1] ? fechaDe(lineas[i + 1]) : '');
      if (f) r.fechaVencimiento = f;
    }
    if (r.fechaVencimiento) break;
  }
  return r;
}
