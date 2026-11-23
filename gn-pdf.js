// Sistema Fën · Gastos nuevo · Etapa 3: documentos que llegan en PDF (fuera del SII de compras)
// Puro (sin Firebase ni pantalla): lee las líneas que entrega previred.lineasDelPdf (celdas separadas por dos espacios) y arma el documento.
//  · Liquidación de sueldo (la del contador, una por trabajador y mes): lo que se le debe al trabajador = líquido + anticipos (los anticipos
//    ya salieron en otra transferencia: los dos pagos se unen con la misma liquidación). Las cotizaciones entran por Previred; el impuesto
//    único, por el F29. Los datos se buscan por su etiqueta (toleran bonos, colación, transporte y cambios menores de formato).
//  · F29 (formulario completo o certificado): el pago del mes con su reparto por código: IVA y PPM (fuera del resultado), retención de
//    boletas de terceros (costo de los practicantes), impuesto único (costo de los sueldos), multas e intereses (financiero).
import { idDoc, rutN, rutTexto, esIso, mesDe } from './gn-modelo.js?v=0.138.0';

const s = v => (v === null || v === undefined ? '' : String(v));
const celdas = l => s(l).split(/\s{2,}/).map(x => x.trim()).filter(Boolean);
const num = v => { const t = s(v).replace(/[$\s]/g, ''); if (!/^-?[\d.]+(,\d+)?$/.test(t)) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return isFinite(n) ? Math.round(n) : null; };
const norm = v => s(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const mesDeTexto = t => { const m = /([A-Za-zÁÉÍÓÚáéíóú]+)\s+(?:DE\s+)?(\d{4})/i.exec(norm(t)); if (!m) return ''; const i = MESES.indexOf(m[1].replace('SETIEMBRE', 'SEPTIEMBRE')); return i < 0 ? '' : `${m[2]}-${String(i + 1).padStart(2, '0')}`; };
const ultimoDia = mes => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const mesSiguiente = mes => { const [y, m] = mes.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const dmyIso = t => { const m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s(t)); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const textoMes = mes => (/^\d{4}-\d{2}$/.test(mes) ? `${NOMBRE_MES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}` : s(mes));

// ¿Qué PDF es? (las boletas de luz y agua las reconoce boletas.leerBoleta)
export function tipoPdf(lineas) {
  const T = norm((lineas || []).slice(0, 40).join('\n'));
  if (/LIQUIDACION DE (SUELDO|REMUNERACION)/.test(T)) return 'liquidacion';
  if (/FORMULARIO 29|DECLARACION MENSUAL Y PAGO SIMULTANEO/.test(T)) return 'f29';
  if (/PRESTACION DE\s+(?:\n)?\s*SERVICIOS DE TERCEROS|SERVICIOS DE TERCEROS/.test(T) && /IMPUESTO RETENIDO/.test(norm((lineas || []).join('\n')))) return 'bte';
  return '';
}

// ═══════════════ Liquidación de sueldo ═══════════════
// La celda que sigue a una etiqueta (en cualquier línea desde "desde")
function tras(lineas, re, desde = 0) {
  for (let i = desde; i < lineas.length; i++) { const c = celdas(lineas[i]); const k = c.findIndex(x => re.test(norm(x))); if (k >= 0 && c[k + 1] !== undefined) return c[k + 1]; }
  return '';
}
// El monto de una línea que empieza con su etiqueta (la última celda)
function montoDe(lineas, re) { for (const l of lineas) { const c = celdas(l); if (c.length >= 2 && re.test(norm(c[0]))) { const v = num(c[c.length - 1]); if (v !== null) return v; } } return null; }
// Las líneas con monto entre dos marcas (sin las de subtotal)
function seccion(lineas, ini, fin) {
  const a = lineas.findIndex(l => ini.test(norm(celdas(l)[0] || ''))); if (a < 0) return [];
  const out = [];
  for (let i = a + 1; i < lineas.length; i++) {
    const c = celdas(lineas[i]), et = norm(c[0] || '');
    if (fin.test(et)) break;
    if (c.length < 2 || /^TOTAL|^SUBTOTAL|^IMPONIBLES?$|^NO IMPONIBLES?$/.test(et)) continue;
    const v = num(c[c.length - 1]); if (v === null) continue;
    out.push({ concepto: c.slice(0, -1).join(' ').slice(0, 80), monto: v });
  }
  return out;
}
export function leerLiquidacion(lineas0) {
  const lineas = (lineas0 || []).map(l => s(l).replace(/ /g, ' ')).filter(l => l.trim());
  const r = { tipo: 'liquidacion', nombre: '', rut: '', periodo: '', haberes: [], descuentos: [], totalHaberes: 0, totalDescuentos: 0, liquido: 0, anticipos: 0, impuestoUnico: 0, errores: [], avisos: [] };
  const dt = Math.max(0, lineas.findIndex(l => /DATOS DEL TRABAJADOR/.test(norm(l))));
  r.nombre = tras(lineas, /^NOMBRES?( DEL TRABAJADOR)?$/, dt).slice(0, 100);
  const rt = tras(lineas, /^RUT( TRABAJADOR)?$/, dt); r.rut = /\d/.test(rt) ? rutTexto(rt) : '';
  r.periodo = mesDeTexto(tras(lineas, /^PERIODO$|^MES$/));
  r.haberes = seccion(lineas, /^HABERES$/, /^TOTAL HABERES$/);
  r.descuentos = seccion(lineas, /^DESCUENTOS$/, /^TOTAL DESCUENTOS$/);
  r.totalHaberes = montoDe(lineas, /^TOTAL HABERES$/) || 0;
  r.totalDescuentos = montoDe(lineas, /^TOTAL DESCUENTOS$/) || 0;
  // v0.124.1 · Un líquido de $0 también es una liquidación (por ejemplo, un mes sin sueldo que pagar): se acepta si la etiqueta está y
  // viene en 0, o sin monto pero con haberes menos descuentos en 0. Deja al trabajador en Equipo (su área, para Previred).
  const RE_LIQ = /^(LIQUIDO A PAGAR|ALCANCE LIQUIDO|LIQUIDO A RECIBIR|SUELDO LIQUIDO|LIQUIDO)$/;
  const liq = montoDe(lineas, RE_LIQ), conEtiqueta = lineas.some(l => RE_LIQ.test(norm(celdas(l)[0] || '')));
  r.liquido = liq || 0;
  r.liquidoCero = liq === 0 || (liq === null && conEtiqueta && r.totalHaberes - r.totalDescuentos <= 0);
  r.anticipos = r.descuentos.filter(x => /ANTICIPO/.test(norm(x.concepto))).reduce((a, x) => a + x.monto, 0);
  r.impuestoUnico = r.descuentos.filter(x => /IMPUESTO/.test(norm(x.concepto))).reduce((a, x) => a + x.monto, 0);
  if (!r.rut) r.errores.push('No se encontró el RUT del trabajador.');
  if (!r.periodo) r.errores.push('No se encontró el período (mes y año).');
  if (!(r.liquido > 0) && !r.liquidoCero) r.errores.push('No se encontró el líquido a pagar.');
  if (r.liquidoCero && !r.anticipos) r.avisos.push('Líquido $0: no hay sueldo que pagar este mes. Queda el trabajador en Gastos → Equipo; lo que se paga como empleador llega por Previred.');
  if (r.totalHaberes && r.liquido && Math.abs(r.totalHaberes - r.totalDescuentos - r.liquido) > 2) r.avisos.push(`Total haberes − total descuentos no da el líquido: revise el PDF.`);
  r.bloquea = r.errores.length > 0;
  return r;
}
// Documento: lo que se le debe al trabajador en el mes (líquido + anticipos), en el mes de la liquidación (fecha: su último día)
export function docDeLiquidacion(r, cargaId) {
  const total = r.liquido + r.anticipos, fecha = ultimoDia(r.periodo);
  const detalle = [{ descripcion: 'SUELDO LIQUIDO', cantidad: 0, unidad: '', monto: r.liquido }].concat(r.anticipos ? [{ descripcion: 'ANTICIPOS', cantidad: 0, unidad: '', monto: r.anticipos }] : []);
  return { id: idDoc(r.rut, 'liq', r.periodo.replace('-', '')), origen: 'liquidacion', formato: 'pdf', tipo: 'liq', tipoTexto: 'Liquidación de sueldo', nc: false,
    rut: rutTexto(r.rut), rutN: rutN(r.rut), razon: s(r.nombre).slice(0, 120) || rutTexto(r.rut), folio: '', fecha, mes: r.periodo, neto: total, exento: 0, iva: 0, otroImp: 0, total,
    vence: '', formaPago: '', referencias: [], detalle, descuadre: '', cargaId: s(cargaId), cliente: '', direccion: '', periodo: { desde: r.periodo + '-01', hasta: fecha },
    liquidacion: { haberes: r.haberes.slice(0, 30), descuentos: r.descuentos.slice(0, 30), totalHaberes: r.totalHaberes, totalDescuentos: r.totalDescuentos, liquido: r.liquido, anticipos: r.anticipos, impuestoUnico: r.impuestoUnico } };
}

// ═══════════════ F29 ═══════════════
export const RUT_SII = '60.803.000-K';
// Los ítems del reparto del F29 (Finanzas, Etapa 4: IVA y PPM fuera del resultado; retención = costo de practicantes; impuesto único = sueldos)
export const ITEMS_F29 = { iva: 'IVA (F29)', ppm: 'PPM (F29)', retencion: 'RETENCION BOLETAS DE TERCEROS (F29)', unico: 'IMPUESTO UNICO TRABAJADORES (F29)', otros: 'OTROS IMPUESTOS (F29)', recargos: 'MULTAS E INTERESES (F29)', total: 'IMPUESTOS (F29)' };
export function leerF29(lineas0) {
  const lineas = (lineas0 || []).map(l => s(l).replace(/ /g, ' ')).filter(l => l.trim()), T = norm(lineas.join('\n'));
  const r = { tipo: 'f29', formato: /CERTIFICADO DECLARACION/.test(T) ? 'certificado' : 'formulario', periodo: '', folio: '', presentado: '', codigos: {}, total: 0, errores: [], avisos: [] };
  if (r.formato === 'certificado') {
    for (const l of lineas) { const re = /C[oó]digo\s+(\d{1,4})\s*:\s*([\d.]+)/gi; let m; while ((m = re.exec(l))) r.codigos[Number(m[1])] = num(m[2]); }
    r.periodo = mesDeTexto((/per[ií]odo\s+([A-Za-zÁÉÍÓÚáéíóú]+\s+\d{4})/i.exec(lineas.join(' ')) || [])[1]);
    r.presentado = dmyIso((/presentada con fecha\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(lineas.join(' ')) || [])[1]);
    r.folio = (/Folio Declaraci[oó]n N[°º]?\s*:?\s*(\d{4,})/i.exec(lineas.join(' ')) || [])[1] || '';
  } else {
    lineas.forEach(l => {
      const c = celdas(l);
      for (let i = 0; i < c.length - 1; i++) {
        if (!/^\d{2,4}$/.test(c[i])) continue;
        const cod = Number(c[i]);
        // código · glosa · valor (el valor no puede ser el código de la glosa que sigue)   o   glosa · código · valor
        if (c[i + 2] !== undefined && !/^\d/.test(c[i + 1]) && num(c[i + 2]) !== null && (c[i + 3] === undefined || /^\d{2,4}$/.test(c[i + 3]) || /^[+=-]$/.test(c[i + 3]))) { r.codigos[cod] = num(c[i + 2]); i += 2; }
        else if (i > 0 && !/^\d/.test(c[i - 1]) && num(c[i + 1]) !== null && !/^\[/.test(c[i - 1])) { r.codigos[cod] = num(c[i + 1]); i += 1; }
      }
      const p = /PERIODO\s+\[15\]\s+(\d{6})/.exec(norm(l)); if (p) r.periodo = `${p[1].slice(0, 4)}-${p[1].slice(4)}`;
      const f = /FOLIO\s+\[07\]\s+(\d{4,})/.exec(norm(l)); if (f) r.folio = f[1];
    });
    const fp = lineas.findIndex(l => /FECHA DE PRESENTACION/.test(norm(l))); if (fp >= 0) r.presentado = dmyIso(lineas.slice(fp, fp + 3).join(' '));
  }
  const c = r.codigos;
  r.total = c[91] || c[547] || 0;
  if (!r.periodo) r.errores.push('No se encontró el período del F29.');
  if (!(r.total > 0)) r.errores.push('No se encontró el total a pagar (código 91).');
  r.bloquea = r.errores.length > 0;
  return r;
}
// El reparto del pago por código. Formulario: IVA (089 menos los créditos y anticipos que se imputan: 543), PPM (062), retención (151),
// impuesto único (048), lo demás del subtotal (595) como otros impuestos, y los recargos (93). Certificado: un solo monto.
export function partesF29(r) {
  const c = r.codigos, P = (k, monto) => ({ item: ITEMS_F29[k], area: 'ADMIN', monto: Math.round(monto) });
  if (r.formato === 'certificado' || c[89] === undefined) return [P('total', r.total)];
  const iva = (c[89] || 0) - (c[543] || 0), ppm = c[62] || 0, ret = c[151] || 0, unico = c[48] || 0, recargos = c[93] || ((c[931] || 0) + (c[932] || 0));
  const otros = (c[595] || 0) ? (c[595] - (c[89] || 0) - ppm - ret - unico) : 0;
  const l = [P('iva', iva), P('ppm', ppm), P('retencion', ret), P('unico', unico), P('otros', otros), P('recargos', recargos)].filter(x => x.monto !== 0);
  const dif = r.total - l.reduce((a, x) => a + x.monto, 0);
  if (dif) { const o = l.find(x => x.item === ITEMS_F29.otros); if (o) o.monto += dif; else l.push(P('otros', dif)); r.avisos.push(`El reparto por código no suma el total: ${dif > 0 ? 'faltan' : 'sobran'} $${Math.abs(dif).toLocaleString('es-CL')} (van a "otros impuestos").`); }
  return l;
}
// Documento: el pago del F29 del período. Fecha: la de presentación (si no viene, el 20 del mes siguiente). Ya clasificado (su reparto por código).
export function docDeF29(r, cargaId) {
  const fecha = esIso(r.presentado) ? r.presentado : `${mesSiguiente(r.periodo)}-20`, partes = partesF29(r);
  return { id: idDoc(RUT_SII, 'f29', r.periodo.replace('-', '')), origen: 'f29', formato: r.formato, tipo: 'f29', tipoTexto: 'F29 ' + textoMes(r.periodo), nc: false,
    rut: rutTexto(RUT_SII), rutN: rutN(RUT_SII), razon: 'SII · Formulario 29', folio: s(r.folio), fecha, mes: r.periodo, neto: r.total, exento: 0, iva: 0, otroImp: 0, total: r.total,
    vence: '', formaPago: '', referencias: [], detalle: partes.map(p => ({ descripcion: p.item, cantidad: 0, unidad: '', monto: p.monto })), descuadre: '', cargaId: s(cargaId), cliente: '', direccion: '', periodo: null,
    f29: { codigos: r.codigos, formato: r.formato, presentado: r.presentado },
    clasif: { item: partes.length === 1 ? ITEMS_F29.total : ITEMS_F29.iva, areas: [{ area: 'ADMIN', pct: 100 }], repartoId: '', partes, porLineas: false, separado: partes.length > 1, lineas: [], de: 'sistema' } };
}

// Una carga de un PDF: nueva, ya estaba, ya estaba distinta (no se pisa) o completa (el F29 que estaba como certificado y llega el formulario)
// ═══════════════ v0.97.0 · Boleta de prestación de servicios de terceros (la que emite la empresa por un practicante) ═══════════════
// El documento es lo que se le paga a la persona (el líquido); la retención se paga en el F29 (código 151). El costo completo es el bruto.
const MESES_TXT = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
export function leerBTE(lineas0) {
  const lineas = (lineas0 || []).map(l => s(l).replace(/\u00a0/g, ' ')).filter(l => l.trim()), T = lineas.join('\n');
  const r = { tipo: 'bte', numero: '', fecha: '', nombre: '', rut: '', prestacion: '', bruto: 0, retencion: 0, tasa: '', liquido: 0, errores: [], avisos: [] };
  r.numero = (/N[°º]\s*(\d{1,10})\b/.exec(T) || [])[1] || '';
  const f = /Fecha:\s+(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+del?\s+(\d{4})/i.exec(T); if (f && MESES_TXT[norm(f[2])]) r.fecha = `${f[3]}-${String(MESES_TXT[norm(f[2])]).padStart(2, '0')}-${f[1].padStart(2, '0')}`;
  const se = /Se[ñn]or(?:es|\(es\))?:\s+(.+?)\s{2,}Rut:\s+([\d.]+\s*-\s*[\dkK])/i.exec(T); if (se) { r.nombre = se[1].trim().slice(0, 100); r.rut = rutTexto(se[2].replace(/\s/g, '')); }
  const pi = lineas.findIndex(l => /^Prestaci[oó]n\s{2,}Valor/i.test(l.trim())); if (pi >= 0) r.prestacion = lineas.slice(pi + 1, pi + 4).filter(l => !/^[\d.]+$/.test(l.trim()) && !/^Total/i.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  const m = re => { const x = re.exec(T); return x ? num(x[1]) || 0 : 0; };
  r.bruto = m(/Total Honorarios:\s+([\d.]+)/i); r.retencion = m(/Impuesto Retenido:\s+([\d.]+)/i); r.liquido = m(/\bTotal:\s+([\d.]+)/);
  r.tasa = (/([\d.,]+\s*%)\s*Impuesto Retenido/i.exec(T) || [])[1] || '';
  if (!r.numero) r.errores.push('No se encontró el N° de la boleta.');
  if (!r.rut) r.errores.push('No se encontró el RUT de la persona.');
  if (!r.fecha) r.errores.push('No se encontró la fecha de la boleta.');
  if (!(r.bruto > 0)) r.errores.push('No se encontró el total de honorarios.');
  if (r.bruto && Math.abs(r.bruto - r.retencion - r.liquido) > 1) r.errores.push('Honorarios − retención no da el total líquido: revise el PDF.');
  r.bloquea = r.errores.length > 0;
  return r;
}
export function docDeBTE(r, cargaId) {
  return { id: idDoc(r.rut, 'bte', r.numero), origen: 'bte', formato: 'pdf', tipo: 'bte', tipoTexto: 'Boleta de terceros', nc: false, rut: rutTexto(r.rut), rutN: rutN(r.rut), razon: r.nombre || rutTexto(r.rut),
    folio: r.numero, fecha: r.fecha, mes: mesDe(r.fecha), neto: r.liquido, exento: 0, iva: 0, otroImp: 0, total: r.liquido, vence: '', formaPago: '', referencias: [],
    detalle: [{ descripcion: 'HONORARIOS LIQUIDOS', cantidad: 0, unidad: '', monto: r.liquido }], descuadre: '', cargaId: s(cargaId), cliente: '', direccion: '', periodo: null,
    bte: { bruto: r.bruto, retencion: r.retencion, tasa: r.tasa, liquido: r.liquido, prestacion: r.prestacion } };
}

// ═══════════════ v0.97.0 · Previred (CSV de la nómina o comprobante de pago: lo que entregan previred.leerCsv / leerComprobante) ═══════════════
// Un documento por mes: las cotizaciones de todos los trabajadores (lo descontado + el aporte del empleador) y, con el comprobante, las multas
// e intereses. Fecha: la de pago (comprobante) o el vencimiento del mes (día 13 del siguiente, o el hábil que sigue). Se clasifica por
// trabajador con la ficha de cada uno (la de su liquidación): ver gn-bandeja.clasifPrevired.
export const ID_PREVIRED = mes => `d_previred_prev_${mes.replace('-', '')}`;
export const ITEMS_PREVIRED = { cotizaciones: 'COTIZACIONES PREVISIONALES', recargos: 'MULTAS E INTERESES PREVIRED' };
export function docDePrevired(r, vence, cargaId) {
  const comp = r.tipoDoc === 'comprobante', trab = (r.trabajadores || []).map(t => ({ rut: rutTexto(t.rut), rutN: rutN(t.rut), nombre: s(t.nombre).slice(0, 100), total: Math.round(t.total || 0) })).filter(t => t.total > 0);
  const cot = trab.reduce((a, t) => a + t.total, 0), recargos = comp ? Math.round(r.totalRecargos || 0) : 0, total = comp ? Math.round(r.totalPagado || cot + recargos) : cot;
  const fecha = comp && esIso(r.fechaPago) ? r.fechaPago : esIso(vence) ? vence : `${mesSiguiente(r.periodo)}-13`;
  return { id: ID_PREVIRED(r.periodo), origen: 'previred', formato: comp ? 'pdf' : 'csv', tipo: 'prev', tipoTexto: 'Previred ' + textoMes(r.periodo), nc: false, rut: '', rutN: '', razon: 'PREVIRED',
    folio: '', fecha, mes: r.periodo, neto: total, exento: 0, iva: 0, otroImp: 0, total, vence: esIso(vence) ? vence : '', formaPago: '', referencias: [],
    detalle: trab.map(t => ({ descripcion: 'COTIZACIONES ' + t.nombre, cantidad: 0, unidad: '', monto: t.total })).concat(recargos ? [{ descripcion: 'MULTAS E INTERESES', cantidad: 0, unidad: '', monto: recargos }] : []),
    descuadre: '', cargaId: s(cargaId), cliente: '', direccion: '', periodo: { desde: r.periodo + '-01', hasta: ultimoDia(r.periodo) },
    previred: { formato: comp ? 'comprobante' : r.tipoDoc === 'certificado' ? 'certificado' : 'csv', trabajadores: trab, cotizaciones: cot, recargos, fechaPago: comp ? s(r.fechaPago) : '', fueraDePlazo: !!r.fueraDePlazo } };
}

// ═══════════════ v0.97.0 · Créditos (el "Detalle Crédito" de BancoEstado en Excel: cuota, estado, vencimiento, monto) ═══════════════
// filas: las de la hoja "Datos" (sheet_to_json con header: 1). El crédito se reconoce por su primera cuota y su número de cuotas.
export function esDetalleCredito(filas) { const h = (filas && filas[0] || []).map(norm); return h[0] === 'CUOTAS' && h.includes('ESTADO') && h.some(x => /FECHA VENCIMIENTO/.test(x)) && h.some(x => /^MONTO CUOTA$/.test(x)); }
export function leerCredito(filas, encabezado) {
  const h = (filas[0] || []).map(norm), iE = h.indexOf('ESTADO'), iF = h.findIndex(x => /FECHA VENCIMIENTO/.test(x)), iM = h.findIndex(x => /^MONTO CUOTA$/.test(x));
  const cuotas = filas.slice(1).filter(f => f && /^\d+$/.test(s(f[0]).trim())).map(f => ({ n: Number(f[0]), estado: s(f[iE]).trim(), fecha: dmyIso(s(f[iF])), monto: num(s(f[iM])) || 0 })).filter(c => c.fecha && c.monto > 0);
  const r = { tipo: 'credito', banco: /BANCOESTADO|BANCO ESTADO/.test(norm(encabezado)) ? 'BancoEstado' : 'Banco', cuotas, errores: [] };
  if (!cuotas.length) r.errores.push('No se encontraron cuotas en el detalle del crédito.');
  const fr = {}; cuotas.forEach(c => { fr[c.monto] = (fr[c.monto] || 0) + 1; });
  r.cuota = Number(Object.entries(fr).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
  r.dia = cuotas.length ? Number(cuotas[Math.min(2, cuotas.length - 1)].fecha.slice(8)) : 0;
  r.nombre = `Crédito ${r.banco} · ${cuotas.length} cuotas de $${r.cuota.toLocaleString('es-CL')}`;
  r.bloquea = r.errores.length > 0;
  return r;
}
// ═══════════════ v0.124.5 · La "Tabla de amortización Fën" (planilla propia: el crédito y sus cuotas con capital, interés y otros) ═══════════════
export const MARCA_TABLA = 'TABLA DE AMORTIZACION FEN';
export const HOJAS_TABLA = { credito: 'Credito', cuotas: 'Cuotas' };
// wb.SheetNames y la primera celda de la hoja Crédito
export const esTablaFen = (nombres, celdaA1) => (nombres || []).some(n => norm(n) === 'CREDITO') && (nombres || []).some(n => norm(n) === 'CUOTAS') && norm(celdaA1).startsWith(MARCA_TABLA);
const fechaCelda = v => { if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10); const t = s(v); return esIso(t) ? t : dmyIso(t); };
const numCelda = v => { if (typeof v === 'number') return Math.round(v); const t = s(v); if (!t) return null; const n = num(t); return n === null ? null : n; };
// fCred: filas de la hoja Crédito [[etiqueta, valor]]; fCuotas: filas de la hoja Cuotas (la primera, encabezados)
export function leerTablaFen(fCred, fCuotas) {
  const r = { tipo: 'credito', fuente: 'tabla', banco: '', operacion: '', nombre: '', montoOriginal: 0, tasa: 0, nCuotas: 0, cuotas: [], errores: [], avisos: [] };
  const dato = re => { const f = (fCred || []).find(x => x && re.test(norm(x[0]))); return f ? f[1] : ''; };
  r.banco = s(dato(/^BANCO/)).slice(0, 40) || 'Banco'; r.operacion = s(dato(/^N. DE OPERACION|^NUMERO DE OPERACION|^OPERACION/)).replace(/\D/g, '').slice(0, 20);
  r.nombre = s(dato(/^NOMBRE/)).slice(0, 100); r.montoOriginal = Math.max(0, numCelda(dato(/^CAPITAL OTORGADO|^MONTO ORIGINAL/)) || 0);
  const tz = s(dato(/^TASA/)).replace('%', '').replace(',', '.'); r.tasa = Number(tz) || (typeof dato(/^TASA/) === 'number' ? Number(dato(/^TASA/)) : 0);
  if (r.tasa > 0 && r.tasa < 0.2) r.tasa = Math.round(r.tasa * 10000) / 100;   // 0,0106 escrito como fracción → 1,06 %
  r.nCuotas = Math.round(numCelda(dato(/^N. DE CUOTAS|^CUOTAS ORIGINALES|^NUMERO DE CUOTAS/)) || 0);
  const h = ((fCuotas || [])[0] || []).map(norm), col = re => h.findIndex(x => re.test(x));
  const iN = col(/^CUOTA$|^N. CUOTA|^N.$/), iV = col(/^VENCIMIENTO|^FECHA DE VENC/), iP = col(/^FECHA DE PAGO|^PAGADA EL/), iCap = col(/^CAPITAL/), iInt = col(/^INTERES$|^INTERESES PACTADOS|^INTERES PACTADO/),
    iRet = col(/ATRASO|RETARDO/), iOtr = col(/^OTROS/), iTot = col(/^TOTAL/);
  if (iN < 0 || iV < 0 || iTot < 0) { r.errores.push('La hoja Cuotas debe tener las columnas Cuota, Vencimiento y Total.'); r.bloquea = true; return r; }
  (fCuotas || []).slice(1).forEach((f, k) => {
    if (!f || !s(f[iN])) return;
    const n = Number(s(f[iN]).replace(/\D/g, '')); if (!(n > 0)) return;
    const fecha = fechaCelda(f[iV]), total = numCelda(f[iTot]);
    if (!fecha || !(total > 0)) { r.errores.push(`Cuota ${n}: falta el vencimiento o el total.`); return; }
    const cap = iCap >= 0 ? numCelda(f[iCap]) : null, int = iInt >= 0 ? numCelda(f[iInt]) : null, ret = iRet >= 0 ? numCelda(f[iRet]) || 0 : 0, otr = iOtr >= 0 ? numCelda(f[iOtr]) || 0 : 0;
    const c = { n, fecha, monto: total, fechaPago: iP >= 0 ? fechaCelda(f[iP]) : '' };
    if (cap !== null && int !== null) {
      if (Math.abs(cap + int + ret + otr - total) > 1) r.errores.push(`Cuota ${n}: capital + interés + atraso + otros (${cap + int + ret + otr}) no da el total (${total}).`);
      Object.assign(c, { capital: cap, interes: int, retardo: ret, otros: otr, real: true });
    }
    r.cuotas.push(c);
  });
  r.cuotas.sort((a, b) => a.n - b.n);
  if (!r.cuotas.length) r.errores.push('No se encontraron cuotas en la hoja Cuotas.');
  if (!r.nCuotas) r.nCuotas = r.cuotas.length ? r.cuotas[r.cuotas.length - 1].n : 0;
  if (new Set(r.cuotas.map(c => c.n)).size !== r.cuotas.length) r.errores.push('Hay cuotas repetidas.');
  const fr = {}; r.cuotas.forEach(c => { fr[c.monto] = (fr[c.monto] || 0) + 1; });
  r.cuota = Number(Object.entries(fr).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
  r.dia = r.cuotas.length ? Number(r.cuotas[Math.min(2, r.cuotas.length - 1)].fecha.slice(8)) : 0;
  if (!r.nombre) r.nombre = `Crédito ${r.banco}${r.operacion ? ' N° ' + r.operacion : ''}`;
  r.reales = r.cuotas.filter(c => c.real).length;
  r.bloquea = r.errores.length > 0;
  return r;
}
// Interés y capital de cada cuota (sistema francés) con el monto original y la tasa mensual: interés = saldo × tasa; capital = cuota − interés.
// La última cuota cierra el saldo. Sin esos datos, la cuota va completa.
// v0.124.5 · Una cuota con la tabla del banco (real: capital, interés, interés por atraso y otros) usa esos montos; las demás se
// estiman desde el saldo que va quedando. Sin monto o tasa, solo las reales se separan.
const tieneReal = c => !!c && c.real === true && Number.isFinite(Number(c.capital)) && Number.isFinite(Number(c.interes));
export function separarCuotas(cuotas, montoOriginal, tasaMensualPct) {
  const P = Number(montoOriginal) || 0, i = (Number(tasaMensualPct) || 0) / 100, calcula = P > 0 && i > 0;
  let saldo = P;
  return cuotas.map((c, k) => {
    if (tieneReal(c)) { saldo -= Math.round(Number(c.capital)); return { ...c, capital: Math.round(Number(c.capital)), interes: Math.round(Number(c.interes)), retardo: Math.round(Number(c.retardo) || 0), otros: Math.round(Number(c.otros) || 0), real: true }; }
    if (!calcula) return { ...c, interes: null, capital: null };
    const interes = Math.max(0, Math.round(saldo * i)), capital = k === cuotas.length - 1 ? Math.round(saldo) : Math.min(Math.round(saldo), c.monto - interes); saldo -= capital;
    return { ...c, interes: k === cuotas.length - 1 ? c.monto - capital : interes, capital, real: false };
  });
}
// v0.124.5 · El total de una cuota con su tabla real (lo que de verdad se paga: puede traer interés por atraso)
export const totalCuota = c => (tieneReal(c) ? Math.round(Number(c.capital) + Number(c.interes) + (Number(c.retardo) || 0) + (Number(c.otros) || 0)) : Math.round(Number(c.monto) || 0));
export const ITEMS_CREDITO = { cuota: 'CUOTA DE CREDITO', interes: 'INTERESES DE CREDITO', capital: 'CAPITAL DE CREDITO', otros: 'COMISIONES BANCARIAS', retardo: 'MULTAS E INTERESES' };
export const partesCuota = c => (tieneReal(c) ? [{ item: ITEMS_CREDITO.interes, area: 'ADMIN', monto: Math.round(c.interes) }, { item: ITEMS_CREDITO.otros, area: 'ADMIN', monto: Math.round(Number(c.otros) || 0) },
  { item: ITEMS_CREDITO.retardo, area: 'ADMIN', monto: Math.round(Number(c.retardo) || 0) }, { item: ITEMS_CREDITO.capital, area: 'ADMIN', monto: Math.round(c.capital) }].filter(p => p.monto > 0)
  : c.interes !== null && c.interes !== undefined ? [{ item: ITEMS_CREDITO.interes, area: 'ADMIN', monto: c.interes }, { item: ITEMS_CREDITO.capital, area: 'ADMIN', monto: c.capital }].filter(p => p.monto > 0) : [{ item: ITEMS_CREDITO.cuota, area: 'ADMIN', monto: c.monto }]);

export function planPdf(d, existentes, inicio) {
  const e = (existentes || []).find(x => x.id === d.id);
  if (e) {
    if (d.origen === 'previred' && e.previred && e.previred.formato !== 'comprobante' && d.previred.formato === 'comprobante')
      return { que: 'completar', cambios: { previred: d.previred, detalle: d.detalle, total: d.total, neto: d.total, fecha: d.fecha } };
    if (d.origen === 'f29' && e.f29 && e.f29.formato === 'certificado' && d.formato === 'formulario') return { que: 'completar', cambios: { f29: d.f29, detalle: d.detalle, clasif: d.clasif, formato: d.formato, folio: d.folio || e.folio } };
    return { que: Math.abs((e.total || 0) - d.total) > 1 ? 'distinta' : 'ya', antes: e.total };
  }
  const ini = esIso(inicio) ? inicio : '2026-10-01', anterior = (Number(ini.slice(0, 4)) - 1) + ini.slice(4, 8) + '01';
  if (!d.fecha) return { que: 'sin_fecha' };
  if (d.fecha < anterior) return { que: 'antigua' };
  return { que: d.fecha < ini ? 'anterior' : 'nueva', doc: d.fecha < ini ? { ...d, anterior: true } : d };
}
export const textoPlanPdf = P => ({ nueva: 'nueva', anterior: 'entró como deuda anterior (es de antes del inicio)', ya: 'ya estaba (no se repite)', distinta: 'ya estaba con otro monto: no se reemplazó (revísela)', completar: 'ya estaba: se completó con el detalle (formulario o comprobante)', antigua: 'es de hace más de un año (no entra)', sin_fecha: 'no tiene fecha (no entra)' }[P.que] || P.que);
export { mesDe };
