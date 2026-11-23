// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos en la base nueva (etapa G3, cuarta parte): reglas puras  v0.51.0
//  · Previred con la base nueva (lo mismo que SistemaFen.gs: cot_estado, cot_registrar, cot_lista) y la regla acordada:
//    el certificado COMPLETA el vencimiento de la obligación "Cotizaciones" del período (tipo documento con identificador
//    "previred", o cuyo nombre o ítem dice cotizaciones). Los gastos por trabajador se crean al PAGAR ese vencimiento
//    (Pagar o la cartola), no al subir el certificado. Sin esa obligación o sin su vencimiento abierto: como hoy (los
//    gastos al subir) y una nota que sugiere crear la obligación.
//  · Clasificar obligaciones (el fin de semana del cambio): una propuesta de tipo e identificador para cada obligación.
//  · Arreglo "siniva" (opcional, una vez): gastos de 2026 nacidos de pagar una obligación "Sin IVA" que quedaron como
//    bruto (neto = final / 1,19) → neto = final.
//  · v0.67.0: el "Comprobante de pago" de Previred (lo que pagó la empresa, con intereses y multas): un gasto "Multas e
//    intereses Previred <mes>" (sin IVA, contado, con la fecha de pago y un ítem financiero), el comprobante guardado en
//    previred_planillas/{AAAA-MM}.comprobante (el total de la planilla pasa a ser lo pagado) y el aviso de vencimiento
//    (día 13 del mes siguiente o el hábil que sigue).
//  · v0.67.5: reparto en % por trabajador (por ejemplo PAN 40 % y B2B 60 %): su gasto se parte en una línea por área (montos que
//    suman exacto, el resto al % más grande: gastos-abono.js montosPorAreas), todas con el mismo previred { periodo, rut } y la
//    misma observación. El reparto se recuerda por RUT (cotiz_trabajadores.areas; "area" sigue siendo la principal). El plan del
//    vencimiento lo lleva (los gastos nacen partidos al pagarlo). "Cambiar reparto" de un mes ya cargado: planCambioReparto.
//  Sin red: se prueba sola. Fechas aaaa-mm-dd (hora de Chile).
// ═══════════════════════════════════════════════
import * as B from './gastos-banco.js?v=0.138.0';
import { dia, huella, idLimpio } from './gastos-modelo.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import { FERIADOS } from './feriados-cl.js?v=0.138.0';
import * as FR from './finanzas-resultados.js?v=0.138.0';   // v0.67.1: una sola regla para "financiero" (tipoResultado)
import * as AB from './gastos-abono.js?v=0.138.0';   // v0.67.5: el reparto en % (el mismo de los abonos)

const s = v => String(v == null ? '' : v);
const sinTildes = t => s(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const mayus = t => sinTildes(t).toUpperCase();
const n = v => M.n(v);
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

// ═══ Previred ═══
export const ID_PREVIRED = 'previred';
export const esIdentPrevired = v => /^\s*previred\s*$/i.test(s(v));
export const RE_COTIZ = /COTIZ|PREVIRED|IMPOSIC/;
const pareceCotiz = d => RE_COTIZ.test(mayus(s(d.nombre) + ' ' + s(d.item)));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = periodo => { const [a, m] = s(periodo).split('-'); return MESES[+m - 1] ? `${MESES[+m - 1]} ${a}` : s(periodo); };
// Igual que sfCotTipo (SistemaFen.gs) y previred.js
export function tipoLinea(inst) {
  const t = s(inst).toUpperCase();
  if (/SEGURO SOCIAL|\(SIS\)/.test(t)) return { tipo: 'Seguro social', cargo: 'Empleador' };
  if (/SEGURIDAD LABORAL|\bISL\b|MUTUAL|ACHS|\bIST\b/.test(t)) return { tipo: 'Accidentes', cargo: 'Empleador' };
  if (/\(AFC\)|CESANT/.test(t)) return { tipo: 'AFC', cargo: 'Mixto' };
  if (/FONASA|ISAPRE|SALUD|BANMEDICA|COLMENA|CONSALUD|CRUZ BLANCA|MASVIDA|VIDA TRES|ESENCIAL/.test(t)) return { tipo: 'Salud', cargo: 'Trabajador' };
  if (/COTIZACION OBLIGATORIA|AHORRO|APV|CUENTA 2|VOLUNTARI/.test(t)) return { tipo: 'AFP', cargo: 'Trabajador' };
  return { tipo: 'Otro', cargo: 'Otro' };
}
export const claveLinea = (periodo, rut, inst, tipoPago, folio) => [periodo, s(rut).toUpperCase(), s(inst).toUpperCase(), tipoPago, folio].join('|');
// Ids como la copia G1 (gastos-modelo.js): así lo copiado de la planilla y lo nuevo se reconocen igual
export const idCotizacion = clave => 'c-' + huella(s(clave));
const rutClave = r => s(r).trim().toUpperCase().replace(/[^0-9K-]/g, '');
const rutN = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
export const rutCot = rutN;   // v0.67.5: el RUT sin puntos ni guion (para comparar)
export const idTrabajador = rut => idLimpio(rutClave(rut));
const rutOk = r => /^\d{1,2}\.?\d{3}\.?\d{3}-[\dK]$/.test(s(r).trim().toUpperCase());
const periodoDe = v => { const t = s(v).trim(); if (/^\d{4}-\d{2}$/.test(t)) return t; const d = dia(t); return d ? d.slice(0, 7) : ''; };
export const periodoCot = periodoDe;   // v0.67.0

// cot_estado: áreas e ítems recordados (por RUT) y qué claves pedidas ya estaban cargadas
export function estadoCot(cotizaciones, trabajadores, claves) {
  const config = {};
  (trabajadores || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.rut)).forEach(({ d }) => { config[s(d.rut).toUpperCase()] = { nombre: s(d.nombre), area: s(d.area), item: s(d.item), ...(s(d.afp) ? { afp: s(d.afp) } : {}),
    // v0.67.5: el reparto recordado y su fecha (para comparar con el de los abonos)
    ...(AB.repartoTrabajador(d, M.AREAS).length > 1 ? { areas: AB.repartoTrabajador(d, M.AREAS) } : {}), repartoEn: s(d.repartoEn), actualizado: s(d.actualizado) }; });
  const ya = new Set((cotizaciones || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.clave)).map(x => s(x.d.clave)));
  return { ok: true, config, afps: afpsPorRut(cotizaciones, trabajadores), yaCargadas: (Array.isArray(claves) ? claves.slice(0, 2000).map(String) : []).filter(k => ya.has(k)) };
}
// v0.67.3 · La AFP de cada RUT: la del mes cargado más reciente (de sus líneas de cotizaciones, en memoria); si no hay, la elegida
// antes y guardada en cotiz_trabajadores (afp). → { rutN: 'AFP …' }
export const AFPS = ['AFP CAPITAL', 'AFP CUPRUM', 'AFP HABITAT', 'AFP MODELO', 'AFP PLANVITAL', 'AFP PROVIDA', 'AFP UNO'];
export function afpDeInstitucion(inst) {
  const t = mayus(inst).replace(/A\.F\.P\.?/g, 'AFP');
  return (/\bAFP\b/.test(t) && AFPS.find(a => new RegExp('\\b' + a.slice(4) + '\\b').test(t))) || '';
}
export function afpsPorRut(cotizaciones, trabajadores) {
  const out = {}, per = {};
  (cotizaciones || []).filter(x => x.d && !x.d.quitadoEnPlanilla).forEach(({ d }) => {
    const a = afpDeInstitucion(d.institucion), k = rutN(d.rut), p = periodoDe(d.periodo);
    if (a && k && (!per[k] || p > per[k])) { per[k] = p; out[k] = a; }
  });
  (trabajadores || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.afp)).forEach(({ d }) => { const k = rutN(d.rut); if (k && !out[k] && AFPS.includes(s(d.afp))) out[k] = s(d.afp); });
  return out;
}

// cot_registrar: revisa como sfCotRegistrar. items: ítems vigentes (lista). Devuelve { error, code } o { limpios, total, lineas }
export function revisarRegistro(p, items, cotizaciones) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s(p.periodo))) return { error: 'Falta el período', code: 'datos' };
  if (!M.esIso(p.fechaPago) || !M.esIso(p.fecha)) return { error: 'Faltan las fechas', code: 'datos' };
  const T = Array.isArray(p.trabajadores) ? p.trabajadores : [];
  if (!T.length || T.length > 80) return { error: 'El PDF no trae trabajadores', code: 'datos' };
  const lista = {}; (items || []).forEach(i => { lista[i.item] = i; });
  const ya = new Set((cotizaciones || []).filter(x => x.d && !x.d.quitadoEnPlanilla).map(x => s(x.d.clave)));
  const limpios = [], repetidos = [], vistas = new Set();
  for (const t of T) {
    const rut = s(t && t.rut).trim().toUpperCase(), nombre = M.texto(t && t.nombre, 80);
    if (!rutOk(rut) || !nombre) return { error: 'Trabajador no válido', code: 'datos' };
    // v0.67.5: un área, o un reparto en % (areas: [{ area, pct }], suman 100): el área principal es la de mayor %
    let areas = [{ area: s(t.area), pct: 100 }];
    if (Array.isArray(t.areas) && t.areas.length > 1) { const x = AB.validarAreas(t.areas, M.AREAS); if (x.error) return { error: nombre + ': ' + x.error, code: 'datos' }; areas = x.areas; }
    else if (Array.isArray(t.areas) && t.areas.length === 1) areas = [{ area: s(t.areas[0] && t.areas[0].area).toUpperCase(), pct: 100 }];
    if (!areas.every(a => M.AREAS.includes(a.area))) return { error: nombre + ': elige el área', code: 'datos' };
    const ref = lista[s(t.item)];
    if (!ref) return { error: nombre + ': el ítem no está en la lista de ítems', code: 'datos' };
    const L = Array.isArray(t.lineas) ? t.lineas : [];
    if (!L.length || L.length > 40) return { error: nombre + ': sin líneas', code: 'datos' };
    const lineas = [];
    for (const l of L) {
      const inst = M.texto(l && l.institucion, 80), tp = s(l && l.tipoPago), folio = s(l && l.folio), monto = Math.round(n(l && l.monto)), imp = Math.round(n(l && l.imponible));
      if (!inst || !['REM', 'GRA', 'RET', 'LEY'].includes(tp) || !/^\d{1,20}$/.test(folio) || !(monto >= 0) || !(imp >= 0)) return { error: nombre + ': una línea no es válida', code: 'datos' };
      const clave = claveLinea(p.periodo, rut, inst, tp, folio);
      if (vistas.has(clave)) return { error: nombre + ': una línea viene dos veces', code: 'datos' };
      vistas.add(clave);
      if (ya.has(clave) && !repetidos.includes(nombre)) repetidos.push(nombre);
      lineas.push({ institucion: inst, tipoPago: tp, folio, monto, imponible: imp, clave, ...tipoLinea(inst) });
    }
    const afp = AFPS.includes(s(t.afp)) ? s(t.afp) : '';   // v0.67.3: la AFP elegida (CSV) se recuerda por RUT
    limpios.push({ rut, nombre, area: AB.principal(areas), areas, ref, lineas, total: lineas.reduce((x, l) => x + l.monto, 0), ...(afp ? { afp } : {}) });
  }
  if (repetidos.length) return { error: 'Ese período ya estaba cargado para: ' + repetidos.join(', ') + '. No se guardó nada.', code: 'duplicado' };
  return { limpios, total: limpios.reduce((x, t) => x + t.total, 0), lineas: limpios.reduce((x, t) => x + t.lineas.length, 0) };
}
// La observación del gasto de cada trabajador (como el script)
export function obsTrabajador(periodo, t) {
  const suma = tipo => t.lineas.filter(l => l.tipo === tipo).reduce((x, l) => x + l.monto, 0);
  const emp = t.lineas.filter(l => l.cargo === 'Empleador').reduce((x, l) => x + l.monto, 0);
  return 'Previred ' + nombreMes(periodo) + ' · ' + t.nombre + ' · AFP $' + suma('AFP') + ' · Salud $' + suma('Salud') + ' · AFC $' + suma('AFC') + ' · Empleador $' + emp + (suma('Otro') ? ' · Otros $' + suma('Otro') : '');
}
// Documentos de la hoja "Cotizaciones" (una por línea), con los nombres de campo de la copia G1
export const docsCotizacion = (p, limpios, url, en, por, extra = {}) => limpios.flatMap(t => t.lineas.map(l => ({ id: idCotizacion(l.clave), d: {
  periodo: p.periodo, fechaPago: p.fechaPago, rut: t.rut, nombre: t.nombre, institucion: l.institucion, tipo: l.tipo, cargo: l.cargo, tipoPago: l.tipoPago,
  imponible: l.imponible, monto: l.monto, folioPlanilla: l.folio, area: t.area, item: t.ref.item, archivo: s(url), cargadoEl: s(en), cargadoPor: s(por) || 'Sistema Fën', clave: l.clave, ...extra } })));
// v0.67.5: con su reparto (areas; "area" es la principal). La fecha del reparto (repartoEn) la pone la transacción si cambió.
export const docTrabajador = (t, hoy) => ({ id: idTrabajador(t.rut), d: { rut: t.rut, nombre: t.nombre, area: t.area, areas: repartoDe(t), item: t.ref.item, ...(t.afp ? { afp: t.afp } : {}), actualizado: s(hoy) } });
const repartoDe = t => (Array.isArray(t.areas) && t.areas.length ? t.areas.map(a => ({ area: s(a.area), pct: Number(a.pct) })) : [{ area: s(t.area), pct: 100 }]);
// ¿Cambió el reparto recordado? (lo guardado: areas, o su área sola)
export const repartoCambio = (antes, despues) => !AB.iguales(AB.repartoTrabajador(antes), repartoDe(despues));
// El plan de gastos por trabajador que guarda el vencimiento (se usan al pagarlo)
// v0.67.5: con el reparto (areas) si son dos o más áreas: los gastos nacen partidos al pagar el vencimiento
export const planTrabajadores = (p, limpios) => limpios.map(t => ({ rut: t.rut, nombre: t.nombre, area: t.area, ...(repartoDe(t).length > 1 ? { areas: repartoDe(t) } : {}), item: t.ref.item, categoria: s(t.ref.categoria), tipo: s(t.ref.tipo), subTipo: s(t.ref.subTipo), total: t.total, obs: obsTrabajador(p.periodo, t) }));
// Un gasto por trabajador (sin IVA, contado). plan = documento.previred = { periodo, fecha, trabajadores }
// v0.67.0: con el comprobante, además el gasto de multas e intereses (plan.recargos), con la fecha de pago de Previred
// v0.67.5: un trabajador con reparto en % da una línea por área (montos que suman su total exacto, el resto al % más grande), con
// la misma observación y el mismo previred { periodo, rut }: lo que busca por RUT o por mes sigue igual.
export const partesTrabajador = t => (Array.isArray(t.areas) && t.areas.length > 1 ? AB.montosPorAreas(n(t.total), t.areas) : [{ area: s(t.area), pct: 100, monto: n(t.total) }]);
export function lineasPrevired(plan, fechaPago, url, hora, extra = {}) {
  const l = (plan.trabajadores || []).flatMap(t => partesTrabajador(t).map(a => M.docGasto({ fecha: plan.fecha, hora, itemGasto: t.item, categoria: t.categoria, tipo: t.tipo, subTipo: t.subTipo, area: a.area,
    tipoMonto: 'siniva', montoNeto: a.monto, montoFinal: a.monto, esHarina: 'No', formaPago: 'contado', fechaPago, archivo: '', observacion: t.obs, urlFoto: s(url) },
  { ...extra, previred: { periodo: s(plan.periodo), rut: s(t.rut) } })));
  if (plan.recargos && n(plan.recargos.monto) > 0) l.push(lineaRecargos(plan.recargos, plan.recargos.url || url, hora, extra));
  return l;
}

// La obligación "Cotizaciones": activa, de tipo documento, con identificador "previred" (primero) o con cotizaciones en el
// nombre o el ítem. Devuelve { obl } o { motivo } (ninguna o más de una).
export function obligacionCotizaciones(plantillas) {
  const act = (plantillas || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.estado || 'ACTIVA') === 'ACTIVA');
  const conId = act.filter(x => esIdentPrevired(x.d.identificador));
  if (conId.length === 1) return { obl: conId[0] };
  if (conId.length > 1) return { motivo: `Hay ${conId.length} cuentas recurrentes con identificador Previred` };
  const porNombre = act.filter(x => s(x.d.tipoObligacion) === 'documento' && pareceCotiz(x.d));
  if (porNombre.length === 1) return { obl: porNombre[0] };
  if (porNombre.length > 1) return { motivo: `Hay ${porNombre.length} cuentas recurrentes de cotizaciones según documento` };
  return { motivo: 'No hay una cuenta recurrente de Cotizaciones según documento' };
}
export const DIAS_VENTANA = 45;   // el vencimiento debe estar a menos de 45 días de la fecha de pago del certificado
// El vencimiento que completa el certificado: abierto, sin documento ni abonos, el más cercano a la fecha de pago
export function destinoCertificado(plantillas, vencs, fechaPago) {
  const o = obligacionCotizaciones(plantillas);
  if (!o.obl) return { motivo: o.motivo };
  const pid = s(o.obl.d.id) || o.obl.id, v = G3.elegirVencimiento(vencs, pid, fechaPago);
  if (!v || Math.abs(diasEntre(dia(v.d.fechaVencimiento) || fechaPago, fechaPago)) > DIAS_VENTANA)
    return { obl: o.obl, motivo: `"${s(o.obl.d.nombre)}" no tiene un vencimiento por completar cerca del ${fechaPago.split('-').reverse().join('-')}` };
  return { obl: o.obl, venc: v };
}
// Lo que el certificado deja en el vencimiento (completarDocumento con tipo "previred")
// v0.67.0: con el comprobante, el monto incluye las multas e intereses (rec)
export function documentoPrevired(p, limpios, url, nombreArchivo, clave, rec) {
  return { tipo: 'previred', monto: limpios.reduce((x, t) => x + t.total, 0) + Math.round(n(rec && rec.monto)), fechaVencimiento: p.fechaPago, url: s(url), nombreArchivo: s(nombreArchivo), numero: nombreMes(p.periodo), clave: s(clave) };
}
// Al pagar: las líneas de un vencimiento. Con el certificado de Previred, un gasto por trabajador (el total debe ser el del
// certificado); si no, las de siempre (con la factura del SII, si la tiene). v: vistaVencimiento; a: el documento de la base.
export function lineasDelPago(v, a, monto, fechaPago, obs, url, tipoMonto, hora) {
  const doc = a && a.documento;
  if (doc && doc.tipo === 'previred' && doc.previred && Array.isArray(doc.previred.trabajadores)) {
    const total = totalPlan(doc.previred);   // v0.67.0: con las multas e intereses del comprobante
    if (Math.round(n(monto)) !== total) return { error: `El pago de Previred debe ser el total ${doc.previred.recargos ? 'del comprobante' : 'del certificado'} ($${total.toLocaleString('es-CL')}).` };
    return { lineas: lineasPrevired(doc.previred, fechaPago, url, hora, { vencimientoId: v.id }) };
  }
  // v0.53.0: con la factura del SII y sus montos, el pago va como bruto y el neto sale de la factura
  if (G3.conNetoFactura(doc)) return { lineas: G3.conNetoSii(G3.conDocumentoSii(M.lineasPago(v, monto, fechaPago, obs, url, 'bruto', hora), a), doc, monto) };
  return { lineas: G3.conDocumentoSii(M.lineasPago(v, monto, fechaPago, obs, url, tipoMonto, hora), a) };
}

// cot_lista: períodos cargados (últimos 24), con el costo por trabajador (como sfCotLista)
export function listaCot(cotizaciones) {
  const per = {};
  (cotizaciones || []).filter(x => x.d && !x.d.quitadoEnPlanilla).forEach(({ d }) => {
    const pk = periodoDe(d.periodo); if (!pk) return;
    const P = per[pk] || (per[pk] = { periodo: pk, fechaPago: dia(d.fechaPago) || s(d.fechaPago), archivo: s(d.archivo), total: 0, trabajadores: {}, vencimientoId: '' });
    if (!P.archivo && d.archivo) P.archivo = s(d.archivo);
    if (d.vencimientoId) P.vencimientoId = s(d.vencimientoId);
    if (d.deCsv) P.porCsv = true;   // v0.67.3: el mes se cargó con el CSV de la nómina
    const rut = s(d.rut), T = P.trabajadores[rut] || (P.trabajadores[rut] = { rut, nombre: s(d.nombre), area: s(d.area), imponible: 0, afp: 0, salud: 0, afc: 0, empleador: 0, otro: 0, total: 0 });
    const m = n(d.monto), tipo = s(d.tipo), cargo = s(d.cargo);
    T.total += m; P.total += m; T.imponible = Math.max(T.imponible, n(d.imponible));
    if (tipo === 'AFP') T.afp += m; else if (tipo === 'Salud') T.salud += m; else if (tipo === 'AFC') T.afc += m; else if (cargo === 'Empleador') T.empleador += m; else T.otro += m;
  });
  return { ok: true, periodos: Object.keys(per).sort().reverse().slice(0, 24).map(k => ({ ...per[k], trabajadores: Object.values(per[k].trabajadores) })) };
}

// ═══ v0.67.5 · Reparto de los gastos ya cargados ═══
// El período de un gasto de Previred (aaaa-mm; lo copiado de la planilla puede venir como aaaamm)
export const perGasto = g => { const p = s(g && g.previred && g.previred.periodo); return /^\d{6}$/.test(p) ? p.slice(0, 4) + '-' + p.slice(4) : p.slice(0, 7); };
// ¿Es una línea de trabajador de Previred (no las multas e intereses) vigente?
export const esLineaTrabajador = g => !!(g && g.previred && !g.previred.recargos && s(g.previred.rut) && g.estado === 'vigente' && !g.quitadoEnPlanilla);
// Las líneas vigentes de cada trabajador por mes: { 'aaaa-mm|RUTN': [{ id, d }] } (ordenadas por id)
export function gastosPorTrabajador(gastos) {
  const out = {};
  (gastos || []).filter(x => esLineaTrabajador(x.d)).forEach(x => { const k = perGasto(x.d) + '|' + rutN(x.d.previred.rut); (out[k] = out[k] || []).push(x); });
  Object.values(out).forEach(l => l.sort((a, b) => a.id.localeCompare(b.id)));
  return out;
}
// El reparto que muestran las líneas de un trabajador en un mes: [{ area, pct, monto }] (los % redondeados, que suman 100)
export function repartoDeLineas(lineas) {
  const por = {}; let tot = 0;
  (lineas || []).forEach(x => { const a = s(x.d.area), m = r0(x.d.montoFinal); por[a] = (por[a] || 0) + m; tot += m; });
  const l = Object.entries(por).map(([area, monto]) => ({ area, monto })).sort((a, b) => b.monto - a.monto);
  let resto = 100;
  l.forEach((a, i) => { a.pct = i === l.length - 1 ? resto : tot ? Math.round(a.monto * 100 / tot) : 0; resto -= a.pct; });
  return { areas: l, total: tot };
}
// Lo que hay que hacer en las líneas de un trabajador en un mes para que queden con el reparto nuevo. Se usa el camino de siempre:
// corregir (área y monto) las que sirven, anular las que sobran y crear las que faltan (copias de la primera). Nada se borra.
// lineas: [{ id, d }] vigentes; areas: el reparto validado. → { total, corregir: [{ id, area, monto }], anular: [ids], crear: [{ area, monto }], igual }
export function planCambioReparto(lineas, areas) {
  const L = (lineas || []).slice(), total = L.reduce((t, x) => t + r0(x.d.montoFinal), 0), nuevas = AB.montosPorAreas(total, areas);
  const libres = new Set(L.map(x => x.id)), asignar = {};
  // 1) cada área nueva toma una línea que ya es de esa área (así cambia lo menos posible)
  nuevas.forEach((a, i) => { const x = L.find(y => libres.has(y.id) && s(y.d.area) === a.area); if (x) { asignar[i] = x; libres.delete(x.id); } });
  // 2) las áreas sin línea toman las que sobran (cambian de área); 3) lo que sobra se anula y lo que falta se crea
  nuevas.forEach((a, i) => { if (asignar[i]) return; const x = L.find(y => libres.has(y.id)); if (x) { asignar[i] = x; libres.delete(x.id); } });
  const corregir = [], crear = [];
  nuevas.forEach((a, i) => { const x = asignar[i]; if (!x) crear.push({ area: a.area, monto: a.monto }); else if (s(x.d.area) !== a.area || r0(x.d.montoFinal) !== a.monto) corregir.push({ id: x.id, area: a.area, monto: a.monto }); });
  const anular = [...libres];
  return { total, nuevas, corregir, anular, crear, igual: !corregir.length && !anular.length && !crear.length };
}
// Un gasto nuevo del reparto: copia de la línea base (misma fecha, ítem, observación, fecha de pago, previred, vencimiento y
// cartola), con su área y su monto. El origen y el historial los pone nuevo().
const SIN_COPIAR = ['historial', 'version', 'creado', '_m', 'planillaPendiente', 'planillaEn', 'hechoEnBase', 'anulado', 'filaOriginal', 'idPlanilla', 'fila', 'origen', 'origenDetalle'];
export function lineaReparto(base, area, monto, detalle) {
  const d = {}; Object.keys(base || {}).filter(k => !SIN_COPIAR.includes(k)).forEach(k => { d[k] = base[k]; });
  const neto = s(base.tipoMonto) === 'siniva' || !n(base.montoFinal) ? monto : Math.round(n(base.montoNeto) * monto / n(base.montoFinal));
  return { ...d, area, montoFinal: monto, montoNeto: neto, estado: 'vigente', origenDetalle: { tipo: 'previred', reparto: true, ...detalle } };
}
// El mes de Finanzas está cerrado (fin_cierres/{aaaa-mm} con estado "cerrado"; reabierto no cuenta)
export const mesCerrado = c => !!(c && s(c.estado || 'cerrado') === 'cerrado');

// ═══ v0.67.0 · Comprobante de pago de Previred ═══
// Lo que se paga con el plan de un vencimiento: los trabajadores + las multas e intereses (si vienen del comprobante)
export const totalPlan = plan => (plan && Array.isArray(plan.trabajadores) ? plan.trabajadores.reduce((x, t) => x + n(t.total), 0) : 0) + Math.round(n(plan && plan.recargos && plan.recargos.monto));
const r0 = v => Math.round(n(v));
const fmt = v => '$' + r0(v).toLocaleString('es-CL');
const fechaDmy = f => s(f).split('-').reverse().join('-');
// El gasto de multas e intereses: sin IVA, al contado, con la fecha de pago de Previred (la multa nace al pagar)
export function lineaRecargos(rec, url, hora, extra = {}) {
  return M.docGasto({ fecha: rec.fecha, hora, itemGasto: rec.item, categoria: rec.categoria, tipo: rec.tipo, subTipo: rec.subTipo, area: rec.area, tipoMonto: 'siniva',
    montoNeto: r0(rec.monto), montoFinal: r0(rec.monto), esHarina: 'No', formaPago: 'contado', fechaPago: rec.fecha, archivo: s(rec.nombreArchivo).slice(0, 120), observacion: s(rec.obs).slice(0, 500), urlFoto: s(url) },
  { ...extra, previred: { periodo: s(rec.periodo), recargos: true, clave: s(rec.clave) } });
}
export const nombreRecargos = periodo => 'Multas e intereses Previred ' + nombreMes(periodo);
export function obsRecargos(periodo, inst, c) {
  const det = (inst || []).filter(i => i.intereses + i.multas > 0).map(i => `${i.nombre} ${fmt(i.intereses + i.multas)}`).join(' · ');
  return `${nombreRecargos(periodo)} · pagado el ${fechaDmy(c.fechaPago)}${c.fueraDePlazo ? ' (fuera de plazo)' : ''} · ${det}`.slice(0, 500);
}
// El comprobante que llega de la pantalla, revisado. items: los vigentes. → { error, code } o { limpio, rec }
// limpio: lo que se guarda en previred_planillas/{mes}.comprobante; rec: el plan del gasto de multas e intereses (null si son $0)
export function revisarComprobante(c, items, periodo) {
  if (!c || typeof c !== 'object') return { error: 'Falta el comprobante', code: 'datos' };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s(periodo))) return { error: 'Falta el período', code: 'datos' };
  const lista = Array.isArray(c.instituciones) ? c.instituciones.slice(0, 40) : [];
  if (!lista.length) return { error: 'El comprobante no trae instituciones', code: 'datos' };
  const I = lista.map(i => ({ nombre: M.texto(i && i.nombre, 80), tipo: M.texto(i && i.tipo, 30), folio: s(i && i.folio).replace(/\D/g, '').slice(0, 20), cotizacion: r0(i && i.cotizacion), intereses: r0(i && i.intereses),
    multas: r0(i && i.multas), compensacion: r0(i && i.compensacion), total: r0(i && i.total) }));
  if (I.some(i => !i.nombre || [i.cotizacion, i.intereses, i.multas, i.total].some(v => !(v >= 0)) || i.cotizacion + i.intereses + i.multas - i.compensacion !== i.total))
    return { error: 'Una institución del comprobante no cuadra (cotización + intereses + multas = total). No se guardó nada.', code: 'datos' };
  const totalCotizaciones = I.reduce((t, i) => t + i.cotizacion, 0), totalRecargos = I.reduce((t, i) => t + i.intereses + i.multas, 0), totalPagado = I.reduce((t, i) => t + i.total, 0);
  if (r0(c.totalCotizaciones) !== totalCotizaciones || r0(c.totalRecargos) !== totalRecargos || r0(c.totalPagado) !== totalPagado) return { error: 'Los totales del comprobante no cuadran con sus instituciones. No se guardó nada.', code: 'datos' };
  if (!M.esIso(c.fechaPago)) return { error: 'Falta la fecha de pago del comprobante', code: 'datos' };
  const clave = s(c.clave);
  if (!/^pc-[0-9a-f]{32}$/.test(clave)) return { error: 'Falta la clave del comprobante', code: 'datos' };
  const limpio = { clave, instituciones: I, totalCotizaciones, totalRecargos, totalPagado, fueraDePlazo: !!c.fueraDePlazo, fechaPago: s(c.fechaPago), horaPago: M.texto(c.horaPago, 10), vence: M.esIso(c.vence) ? s(c.vence) : '',
    folios: [...new Set(I.map(i => i.folio).filter(Boolean))].sort() };
  let rec = null;
  if (totalRecargos > 0) {
    const ref = (items || []).find(i => i.item === s(c.recargos && c.recargos.item));
    if (!ref) return { error: 'Multas e intereses: elige el ítem (uno de tipo financiero).', code: 'datos' };
    const area = s(c.recargos && c.recargos.area);
    if (!M.AREAS.includes(area)) return { error: 'Multas e intereses: elige el área.', code: 'datos' };
    rec = { periodo, clave, monto: totalRecargos, fecha: limpio.fechaPago, item: ref.item, categoria: s(ref.categoria), tipo: s(ref.tipo), subTipo: s(ref.subTipo), area, obs: obsRecargos(periodo, I, limpio) };
  }
  return { limpio, rec };
}
// El comprobante como queda en la planilla del mes
export const docComprobante = (limpio, url, nombreArchivo, en, por, gastoRecargosId, extra = {}) => ({ ...limpio, archivo: s(url), nombreArchivo: s(nombreArchivo).slice(0, 120), cargadoEl: s(en), cargadoPor: s(por) || 'Sistema Fën',
  gastoRecargosId: s(gastoRecargosId), ...extra });
// Los campos de la planilla del mes (previred_planillas/{AAAA-MM}) con su comprobante: el total pasa a ser lo pagado
// a: la planilla (o null); unidoVenc: lo pagado con la cartola por su vencimiento (no está en a.pagos)
export function planillaConComprobante(a, comp, periodo, nTrab, fechaPagoCert, unidoVenc = 0) {
  const pagos = Array.isArray(a && a.pagos) ? a.pagos : [], unido = pagos.reduce((t, x) => t + r0(x.monto), 0) + r0(unidoVenc), total = r0(comp.totalPagado), falta = total - unido;
  const completa = unido > 0 && Math.abs(falta) <= 10;
  return { periodo, total, fechaPago: s(fechaPagoCert) || s(a && a.fechaPago) || comp.fechaPago, trabajadores: Number(a && a.trabajadores) || nTrab, comprobante: comp, unido, falta,
    estado: completa ? 'pagada_conciliada' : unido ? 'parcial' : 'sin_pagos', ...(completa ? {} : { conciliadaEl: '', conciliadaPor: '' }) };
}
// Ítems para las multas e intereses: los vigentes, primero los de tipo financiero cuyo nombre dice multa o interés, después los
// demás financieros y al final el resto. fin: fin_items por clave.
// v0.67.1: "financiero" es lo mismo que en Finanzas (FR.tipoResultado): lo guardado en Finanzas → Resultados → Clasificación
// manda; sin clasificar, el subtipo FINANCIERO del ítem en Gastos. Cada ítem trae el aviso de dónde se arregla (aviso).
export function itemsRecargos(items, fin) {
  const F = fin || {}, dice = i => /multa|inter[eé]s/i.test(s(i.item));
  const l = (items || []).filter(i => i && i.item && !i.archivado).map(i => ({ item: i.item, financiero: FR.esFinanciero(i.item, F, i), dice: dice(i) }));
  const orden = x => (x.financiero ? (x.dice ? 0 : 1) : 2);
  const ord = l.slice().sort((a, b) => orden(a) - orden(b));
  const f = ord.filter(x => x.financiero);
  return { lista: ord, propuesto: f.length ? f[0].item : '', hayFinanciero: f.length > 0 };
}
// v0.67.1 · Para cada ítem que no es financiero, dónde se arregla: { item: texto }
export function avisosRecargos(items, fin) {
  const out = {};
  (items || []).filter(i => i && i.item && !i.archivado).forEach(i => { const t = FR.avisoNoFinanciero(i.item, fin || {}, i); if (t) out[i.item] = t; });
  return out;
}
// El área de las multas e intereses: ADMIN (común) si existe
export const areaRecargos = () => (M.AREAS.includes('ADMIN') ? 'ADMIN' : M.AREAS[0]);
// Comprobante contra lo ya cargado (certificado) por RUT. cot: líneas de cotizaciones del mes (vigentes)
export function compararPorRut(trabajadores, cot) {
  const cargado = {}, nombres = {};
  (cot || []).forEach(x => { const d = x.d || x; const k = rutN(d.rut); cargado[k] = (cargado[k] || 0) + r0(d.monto); nombres[k] = nombres[k] || s(d.nombre); });
  const filas = [], vistos = new Set();
  (trabajadores || []).forEach(t => { const k = rutN(t.rut); vistos.add(k); const c = r0(t.total); filas.push({ rut: t.rut, nombre: t.nombre, comprobante: c, cargado: cargado[k] || 0, dif: c - (cargado[k] || 0) }); });
  Object.keys(cargado).filter(k => !vistos.has(k)).forEach(k => filas.push({ rut: k, nombre: nombres[k], comprobante: 0, cargado: cargado[k], dif: -cargado[k] }));
  const tc = filas.reduce((t, f) => t + f.comprobante, 0), tg = filas.reduce((t, f) => t + f.cargado, 0);
  return { filas, totalComprobante: tc, totalCargado: tg, dif: tc - tg, iguales: filas.every(f => f.dif === 0) };
}

// ═══ v0.67.3 · La diferencia del banco como multas e intereses (planilla sin comprobante de pago) ═══
// Al unir los cargos del banco a una planilla sin comprobante, si suman más que sus cotizaciones (más de $10), la diferencia se
// registra (con el visto bueno de Emmanuel) como el mismo gasto "Multas e intereses Previred <mes>" del comprobante: sin IVA, al
// contado, área ADMIN, un ítem financiero, con la fecha del último cargo unido. La planilla queda en previred_planillas/{mes}.difMultas
// y su total pasa a ser lo del banco. Quitarla anula el gasto (no se borra) y la deja en difMultasQuitadas.
export const difVigente = doc => (doc && doc.difMultas && !doc.difMultas.quitado ? doc.difMultas : null);
export function recDiferencia(periodo, cotizaciones, banco, fecha, ref, area, clave) {
  return { periodo: s(periodo), clave: s(clave), monto: r0(banco) - r0(cotizaciones), fecha: s(fecha), item: ref.item, categoria: s(ref.categoria), tipo: s(ref.tipo), subTipo: s(ref.subTipo), area: s(area),
    obs: `${nombreRecargos(periodo)} · diferencia entre lo pagado en el banco (${fmt(banco)}) y las cotizaciones de la planilla (${fmt(cotizaciones)}), sin comprobante de pago`.slice(0, 500) };
}

// ═══ v0.67.0 · Vencimiento de Previred: el día 13 del mes siguiente al de las remuneraciones; si cae sábado, domingo o
// feriado (feriados-cl.js), el hábil que sigue. El aviso sale desde el día 10 hasta que el mes queda registrado. ═══
export const DIA_VENCE_PREVIRED = 13, DIA_AVISO_PREVIRED = 10;
const mesMas = (per, k) => { let [y, m] = s(per).split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const esHabilCon = (f, feriados) => { const w = new Date(f + 'T12:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && !feriados.has(f); };
export function venceDe(periodo, feriados = FERIADOS) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s(periodo))) return '';
  let f = mesMas(periodo, 1) + '-' + String(DIA_VENCE_PREVIRED).padStart(2, '0');
  for (let i = 0; i < 15 && !esHabilCon(f, feriados); i++) f = G3.sumarDias(f, 1);
  return f;
}
const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const fechaLarga = f => { const [y, m, d] = s(f).split('-').map(Number); return `${DIAS_SEM[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} de ${MESES[m - 1]}`; };
// registrados: los meses (AAAA-MM) con cotizaciones o comprobante cargados. → [{ periodo, vence, estado: pronto|hoy|atrasado, titulo, detalle }]
// Se miran el mes anterior y el de antes (este último solo si ya hay meses registrados antes: la app ya se usaba).
export function avisosPrevired(hoy, registrados, feriados = FERIADOS) {
  if (!M.esIso(hoy)) return [];
  const reg = new Set(registrados || []), out = [];
  [2, 1].forEach(k => {
    const per = mesMas(hoy.slice(0, 7), -k), desde = mesMas(per, 1) + '-' + String(DIA_AVISO_PREVIRED).padStart(2, '0');
    if (reg.has(per) || hoy < desde) return;
    if (k === 2 && ![...reg].some(x => x < per)) return;
    const vence = venceDe(per, feriados), estado = hoy < vence ? 'pronto' : hoy === vence ? 'hoy' : 'atrasado', mes = MESES[+per.slice(5) - 1];
    const titulo = estado === 'pronto' ? `Previred de ${mes} vence el ${fechaLarga(vence)}` : estado === 'hoy' ? `Previred de ${mes} vence hoy, ${fechaLarga(vence)}` : `Previred de ${mes} venció el ${fechaLarga(vence)}: atrasado, se cobran multas`;
    const detalle = estado === 'atrasado' ? `Págalo cuanto antes y sube el comprobante de pago (Gastos → Previred): las multas e intereses quedan como gasto.`
      : `Pagar en Previred y subir el comprobante de pago en Gastos → Previred${estado === 'hoy' ? ' (después de hoy se cobran multas)' : ''}.`;
    out.push({ periodo: per, vence, estado, dias: diasEntre(hoy, vence), titulo, detalle });
  });
  return out;
}

// v0.69.5 · "Es lo que falta para cerrar <mes>": el Previred de un mes es lo último que se carga antes de cerrarlo (Finanzas →
// Cierre de mes lo pide). cierres = { AAAA-MM: { estado } } (fin_cierres) si ya está en la memoria; null si no se sabe: entonces
// no se agrega nada (no se lee para esto). Solo si ese mes NO está cerrado.
export function conCierre(avisos, cierres) {
  if (!cierres) return avisos || [];
  return (avisos || []).map(a => {
    const c = cierres[a.periodo];
    return c && c.estado === 'cerrado' ? a : { ...a, cierre: `Es lo que falta para cerrar ${MESES[+s(a.periodo).slice(5, 7) - 1] || a.periodo}` };
  });
}

// ═══ Clasificar obligaciones ═══
const RE_SUELDO = /REMUNERAC|SUELDO|LIQUIDO|HONORARIO/;
const RE_SERVICIO = /\bLUZ\b|\bAGUA\b|\bGAS\b|INTERNET|TELEFON|CELULAR|\bCGE\b|ESSBIO|\bENEL\b|CHILQUINTA|SAESA|FRONTEL|METROGAS|LIPIGAS|ABASTIBLE|GASCO|MOVISTAR|ENTEL|\bCLARO\b|\bVTR\b|\bWOM\b|\bGTD\b|TELSUR|ELECTRIC|NUEVOSUR|AGUAS /;
// Palabras que no sirven para reconocer un proveedor
const GENERICAS = new Set(['SPA', 'LTDA', 'LIMITADA', 'SOCIEDAD', 'EMPRESA', 'EMPRESAS', 'CHILE', 'SERVICIOS', 'SERVICIO', 'COMERCIAL', 'COMERCIALIZADORA', 'INVERSIONES', 'ANONIMA', 'DISTRIBUIDORA', 'DISTRIBUCION', 'PAGO', 'CUENTA', 'MENSUAL', 'PRUEBA', 'CUOTA', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'S', 'A', 'SA', 'EIRL']);
const palabras = t => mayus(t).replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !GENERICAS.has(w) && !/^\d+$/.test(w));
// Números del nombre que parecen N° de cliente (5 o más dígitos; "1.112.223" cuenta como 1112223)
export function numerosDelNombre(nombre) {
  const out = [];
  (s(nombre).match(/\d[\d.\-]{3,}\d/g) || []).forEach(x => { const d = x.replace(/[.\-]/g, ''); if (d.length >= 5 && d.length <= 20 && !out.includes(d)) out.push(d); });
  return out;
}
// Proveedores del SII cuyo nombre calza con el de la obligación (una palabra distintiva en común)
export function proveedoresQueCalzan(p, proveedores) {
  const mias = new Set(palabras(s(p.nombre) + ' ' + s(p.item)));
  if (!mias.size) return [];
  return (proveedores || []).filter(x => s(x.rut) && palabras(x.razonSocial).some(w => mias.has(w)));
}
// pagos: [{ fecha, monto }] del más reciente al más antiguo. Devuelve { tipo, identificador, opciones, motivo, segura }
export function proponer(p, pagos, proveedores) {
  const txt = mayus(s(p.nombre) + ' ' + s(p.item)), montos = (pagos || []).map(x => Math.round(n(x.monto))).filter(x => x > 0);
  const nums = numerosDelNombre(p.nombre), actual = s(p.identificador).trim();
  const conActual = l => (actual && !l.includes(actual) ? [actual].concat(l) : l);
  if (RE_COTIZ.test(txt)) return { tipo: 'documento', identificador: ID_PREVIRED, opciones: [ID_PREVIRED], motivo: 'Cotizaciones: el certificado de Previred completa su vencimiento', segura: true };
  if (RE_SUELDO.test(txt)) return { tipo: 'libre', identificador: '', opciones: [], motivo: 'Sueldo: se paga con abonos (transferencias)', segura: true };
  if (RE_SERVICIO.test(txt)) {
    const prov = proveedoresQueCalzan(p, proveedores), ops = conActual(nums.concat(prov.map(x => s(x.rut))).filter((x, i, a) => a.indexOf(x) === i));
    return { tipo: 'documento', identificador: actual || ops[0] || '', opciones: ops, motivo: 'Cuenta de servicio (luz, agua, gas, internet o teléfono)' + (ops.length > 1 ? ': elige el N° de cliente' : !ops.length ? ': falta el N° de cliente' : ''), segura: true };
  }
  const prov = proveedoresQueCalzan(p, proveedores);
  if (prov.length) {
    const ops = conActual(prov.map(x => s(x.rut)));
    return { tipo: 'documento', identificador: actual || ops[0], opciones: ops, motivo: `El SII tiene facturas de ${prov.map(x => s(x.razonSocial)).slice(0, 2).join(', ')}`, segura: prov.length === 1 };
  }
  const u3 = montos.slice(0, 3);
  if (u3.length === 3 && u3.every(x => x === u3[0])) return { tipo: 'fijo', identificador: '', opciones: [], motivo: `Los últimos 3 pagos fueron de $${u3[0].toLocaleString('es-CL')}`, segura: true };
  if (montos.length >= 3) {
    const prom = montos.reduce((a, b) => a + b, 0) / montos.length, var_ = Math.max(...montos) / Math.min(...montos);
    if (var_ >= 1.5 || montos.some(x => Math.abs(x - prom) / prom > 0.3)) return { tipo: 'libre', identificador: '', opciones: [], motivo: 'Los montos pagados cambian mucho', segura: false };
    return { tipo: 'documento', identificador: actual || nums[0] || '', opciones: conActual(nums), motivo: 'Los montos cambian un poco cada mes (como una cuenta)', segura: false };
  }
  return { tipo: 'fijo', identificador: '', opciones: nums, motivo: montos.length ? 'Pocos pagos para comparar' : 'Sin pagos para comparar', segura: false };
}
// Pagos de cada obligación (vencimientos pagados), del más reciente al más antiguo
export function pagosPorObligacion(vencs) {
  const out = {};
  (vencs || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.plantillaID) && G3.estadoBase(x.d) === 'pagado').forEach(({ d }) => {
    const m = Math.round(n(d.montoPago)); if (!(m > 0)) return;
    (out[s(d.plantillaID)] = out[s(d.plantillaID)] || []).push({ fecha: dia(d.fechaPago) || dia(d.fechaVencimiento), monto: m });
  });
  Object.values(out).forEach(l => l.sort((a, b) => s(b.fecha).localeCompare(s(a.fecha))));
  return out;
}
// Proveedores del SII (de sii_docs y de las fichas), sin repetir RUT
export function proveedoresSii(siiDocs, fichas) {
  const m = new Map();
  (siiDocs || []).forEach(({ d }) => { const r = s(d && (d.rut || d.rutProveedor)).trim(); if (r && !m.has(r.toUpperCase())) m.set(r.toUpperCase(), { rut: r, razonSocial: s(d.razonSocial) }); });
  (fichas || []).forEach(({ id, d }) => { const r = s(d && d.rutTexto) || id; if (r && !m.has(r.toUpperCase())) m.set(r.toUpperCase(), { rut: r, razonSocial: s(d && d.razonSocial) }); });
  return [...m.values()];
}
// Lista para la pantalla: obligaciones activas con sus pagos y la propuesta
// v0.63.1: también "Se paga por" (lo guardado; sin el campo = banco) y su propuesta desde el historial (gastos: [{ id, d }], opcional)
export function listaClasificar(plantillas, vencs, proveedores, hoy, gastos) {
  const pagos = pagosPorObligacion(vencs);
  return (plantillas || []).filter(x => x.d && !x.d.quitadoEnPlanilla && s(x.d.estado || 'ACTIVA') === 'ACTIVA').map(x => {
    const v = M.vistaPlantilla(x.id, x.d, vencs, hoy), pg = pagos[v.id] || [];
    return { id: v.id, nombre: v.nombre, item: v.item, montoEstimado: n(v.montoEstimado), tipoMonto: v.tipoMonto, tipoObligacion: s(x.d.tipoObligacion), identificador: s(x.d.identificador), diasAviso: x.d.diasAviso === undefined ? '' : x.d.diasAviso,
      sinClasificar: G3.sinClasificar(x.d), pagos: pg.slice(0, 6), propuesta: proponer(v, pg, proveedores),
      sePagaPor: B.sePagaPorOk(x.d.sePagaPor), propuestaSePaga: B.propuestaSePagaPor(v.id, vencs, gastos || []) };
  }).sort((a, b) => (a.sinClasificar === b.sinClasificar ? 0 : a.sinClasificar ? -1 : 1) || a.nombre.localeCompare(b.nombre));
}

// ═══ Arreglo "siniva" (opcional, una vez, después del cambio) ═══
// Gastos de un año (2026) nacidos de pagar una obligación con Tipo Monto "siniva" que quedaron como bruto:
// tipo "bruto" y neto = round(final / 1,19). Se reconocen por su vencimiento (vencimientoId) o, lo copiado de la planilla
// (la app antigua no guardaba el vencimiento), por el vencimiento pagado de esa obligación con el mismo ítem, la misma
// fecha (la del vencimiento) y la misma fecha de pago, sin pasarse de su monto pagado.
export function planSiniva(gastos, vencs, plantillas, anio = 2026) {
  const obl = {}; (plantillas || []).filter(x => x.d && !x.d.quitadoEnPlanilla).forEach(x => { obl[s(x.d.id) || x.id] = x.d; });
  const venc = {}; (vencs || []).filter(x => x.d && !x.d.quitadoEnPlanilla).forEach(x => { venc[x.id] = x.d; if (s(x.d.id)) venc[s(x.d.id)] = x.d; });
  const esSiniva = v => v && s(v.plantillaID) && (s((obl[s(v.plantillaID)] || {}).tipoMonto) === 'siniva');
  const candidato = g => g.estado === 'vigente' && !g.quitadoEnPlanilla && s(g.fecha).slice(0, 4) === String(anio) && s(g.tipoMonto || 'bruto') === 'bruto' && s(g.esHarina) !== 'Sí'
    && n(g.montoFinal) > 0 && n(g.montoNeto) === Math.round(n(g.montoFinal) / 1.19) && n(g.montoNeto) !== n(g.montoFinal) && s(g.formaPago || 'contado') === 'contado';
  const out = [], usados = {};
  // Vencimientos pagados de obligaciones sin IVA, por ítem + fecha + fecha de pago (para lo copiado de la planilla)
  const porClave = {};
  Object.entries(venc).forEach(([id, v]) => {
    if (!esSiniva(v) || G3.estadoBase(v) !== 'pagado' || id !== (s(v.id) || id)) return;
    const k = mayus(v.item) + '|' + dia(v.fechaVencimiento) + '|' + dia(v.fechaPago);
    (porClave[k] = porClave[k] || []).push({ id, v, resto: Math.round(n(v.montoPago)) });
  });
  (gastos || []).slice().sort((a, b) => a.id.localeCompare(b.id)).forEach(({ id, d: g }) => {
    if (!candidato(g)) return;
    let v = null, vid = '';
    if (s(g.vencimientoId)) { vid = s(g.vencimientoId); v = venc[vid]; if (!esSiniva(v)) return; }
    else {
      const l = porClave[mayus(g.itemGasto) + '|' + dia(g.fecha) + '|' + dia(g.fechaPago)] || [];
      const x = l.find(y => y.resto >= Math.round(n(g.montoFinal)));
      if (!x) return;
      x.resto -= Math.round(n(g.montoFinal)); v = x.v; vid = x.id;
    }
    if (usados[id]) return; usados[id] = true;
    const final = Math.round(n(g.montoFinal));
    out.push({ id, fecha: dia(g.fecha), item: s(g.itemGasto), area: s(g.area), obligacion: s((obl[s(v.plantillaID)] || {}).nombre || v.nombre), vencimientoId: vid,
      montoFinal: final, netoAntes: Math.round(n(g.montoNeto)), netoNuevo: final, diferencia: final - Math.round(n(g.montoNeto)), version: Number(g.version) || 0 });
  });
  return { lista: out, total: out.reduce((x, y) => x + y.diferencia, 0), n: out.length };
}
// Los campos que cambia el arreglo en un gasto (si sigue igual que en la vista previa)
export function camposSiniva(g) {
  const final = Math.round(n(g.montoFinal));
  if (s(g.tipoMonto || 'bruto') !== 'bruto' || n(g.montoNeto) !== Math.round(final / 1.19)) return null;
  return { tipoMonto: 'siniva', montoNeto: final };
}
