// ═══════════════════════════════════════════════
//  Sistema Fën — Boletas de luz y agua (CGE, ESSBIO) y cuentas recurrentes que nacen de su boleta  v0.70.0
//  Puro: sin red ni pantalla (se prueba solo, con líneas como las arma previred.js → lineasDelPdf).
//
//  Nombres (solo en la pantalla; la base no cambia):
//   · Cuenta recurrente = la ficha de algo que pagas seguido (colección "obligaciones").
//   · Por pagar = cada cobro, con su fecha y su monto (colección "vencimientos").
//  Los arriendos (sin documento) se crean solos cada mes; luz y agua nacen de su boleta (esta lectura).
//
//  1. leerBoleta(lineas): UN lector para las dos empresas. Cada dato se busca por su etiqueta, al inicio de una celda (las celdas
//     vienen separadas por dos espacios); lo que no viene es opcional (intereses, saldo anterior, ajustes, vencimiento, corte).
//     Cruce que bloquea: boleta del período + saldo anterior + ajustes chicos (±$100) = total a pagar. Si no, un aviso preciso.
//  2. Regla del mes: el gasto de una boleta es del mes en que TERMINA su período, con fecha del último día de ese mes
//     (16 ago – 15 sep → septiembre; 8 sep – 7 oct → octubre).
//  3. planBoleta: el "por pagar" del período (con la boleta + ajustes), sus gastos (los intereses aparte, como financiero; el resto
//     al ítem de la cuenta con su reparto; sin IVA: una boleta no da crédito fiscal), y el saldo anterior comparado con lo que sigue
//     por pagar de esa cuenta (calza ±$100, o "Registrar saldo anterior sin boleta" en el mes que eliges). Nunca se cuenta dos veces.
//  4. Pagar: lo más antiguo primero (planOrden). En la cartola, un cargo igual al total a pagar de una boleta paga todo lo que cubre.
//  5. Esperando boleta: mientras una cuenta de boleta no tiene la boleta del mes, un estimado (promedio de las últimas 3). No es gasto.
//  6. Corte: el aviso urgente en Hoy hasta que se pague lo que la boleta dice que falta.
// ═══════════════════════════════════════════════
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';

const s = v => String(v == null ? '' : v);
const num = v => (typeof v === 'number' ? (isFinite(v) ? v : 0) : (isFinite(Number(v)) ? Number(v) : 0));
const r0 = v => Math.round(num(v));
export const pesos = v => { const x = r0(v); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('es-CL'); };
const sinTildes = t => s(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const RUT_FEN = '77087176';   // la empresa (sin dígito verificador)
const norm = t => sinTildes(t).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
const rutNorm = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
// La misma regla que gastos-abono.js (montosPorAreas): montos proporcionales que suman exacto; el resto de los redondeos va al área
// con el % más grande (si empatan, la primera). Copiada aquí para no importar gastos-abono.js (que importa la cartola).
const AB = { montosPorAreas(monto, areas) {
  const m = Math.round(num(monto)), l = (areas || []).map(a => ({ area: s(a.area), pct: num(a.pct) }));
  if (!l.length) return [];
  let k = 0; l.forEach((a, i) => { if (a.pct > l[k].pct) k = i; });
  let resto = m;
  const out = l.map((a, i) => { if (i === k) return null; const x = Math.trunc(m * a.pct / 100); resto -= x; return { ...a, monto: x }; });
  out[k] = { ...l[k], monto: resto };
  return out;
} };

export const TOL_CRUCE = 100;            // ajustes chicos (redondeo, "Otros") que se aceptan entre la boleta y el total a pagar
export const TOL_SALDO = 100;            // saldo anterior contra lo que sigue por pagar
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_TXT = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
export const nombreMes = mes => { const m = /^(\d{4})-(\d{2})/.exec(s(mes)); return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : s(mes); };
export const soloMes = mes => { const m = /^(\d{4})-(\d{2})/.exec(s(mes)); return m ? MESES[Number(m[2]) - 1] : s(mes); };
export const diaCorto = f => (esIso(f) ? `${Number(f.slice(8, 10))} ${MESES_CORTO[Number(f.slice(5, 7)) - 1]}` : '');
export const dma = f => (esIso(f) ? f.split('-').reverse().join('-') : s(f));
export const ultimoDia = mes => { const [y, m] = s(mes).split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const mesAnterior = mes => { const [y, m] = s(mes).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
export const mesSiguiente = mes => { const [y, m] = s(mes).split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const difMeses = (a, b) => { const [ya, ma] = s(a).split('-').map(Number), [yb, mb] = s(b).split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
const sumarMeses = (mes, k) => { let x = mes; for (let i = 0; i < Math.abs(k); i++) x = k > 0 ? mesSiguiente(x) : mesAnterior(x); return x; };

// ═══════════════ Las empresas ═══════════════
// Se reconocen por el RUT del emisor (arriba de la boleta) o, si no está, por su nombre en el texto.
export const EMPRESAS = {
  CGE: { id: 'CGE', nombre: 'CGE', servicio: 'luz', rut: '76.411.321-7', texto: /\bCGE\b|COMPA[NÑ]IA GENERAL DE ELECTRICIDAD/, glosa: /\bCGE\b/ },
  ESSBIO: { id: 'ESSBIO', nombre: 'ESSBIO', servicio: 'agua', rut: '76.833.300-9', texto: /\bESSBIO\b/, glosa: /\bESSBIO\b/ }
};
export const NOMBRE_SERVICIO = { luz: 'Luz', agua: 'Agua' };
export const empresaDeRut = rut => Object.values(EMPRESAS).find(e => rutNorm(e.rut) === rutNorm(rut)) || null;
// ¿La glosa del banco dice la empresa? (CGE, ESSBIO)
export const empresaDeGlosa = desc => { const t = norm(desc); return (Object.values(EMPRESAS).find(e => e.glosa.test(t)) || {}).id || ''; };

// ═══════════════ 1 · Leer la boleta ═══════════════
// Montos chilenos: "$ 28.800", "$28.800", "28.800", "$ - 5", "$ -40", "-4". Debe venir justo después de la etiqueta.
const RE_MONTO = /^\s*:?\s*(\$\s*)?(-\s*)?(\$\s*)?(-\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?![\d\/]|,\d|\s*%|\s*kWh|\s*m3)/i;
function montoTras(resto) {
  const m = RE_MONTO.exec(resto); if (!m) return null;
  const v = Number(m[5].replace(/\./g, '')); return (m[2] || m[4]) ? -v : v;
}
// Una etiqueta al inicio de una celda (comienzo de línea, dos espacios o una coma antes) y el monto justo después
function montosDe(lineas, re) {
  const out = [], g = new RegExp('(^|\\s{2,}|,\\s*)(?:' + re.source + ')', 'gi');
  lineas.forEach((l, i) => { let m; g.lastIndex = 0; while ((m = g.exec(l))) { const v = montoTras(l.slice(m.index + m[0].length)); if (v !== null) out.push({ v, i }); } });
  return out;
}
const primero = (lineas, re) => { const l = montosDe(lineas, re); return l.length ? l[0].v : null; };
// Fechas: "15 Sep 2026", "05 Oct 2026", "15/OCT/2026", "07/09/2026", "15 de octubre de 2026", "15-09-2026"
function fechaDe(t) {
  let m = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})(?!\d)/.exec(t);
  if (m) { const d = +m[1], mo = +m[2]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  m = /(\d{1,2})\s*(?:[\/\-. ]|\s+de\s+)\s*([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?\s*(?:[\/\-. ]|\s+de\s+|\s+del\s+)\s*(\d{4})/.exec(t);
  if (m) { const mo = MES_TXT[sinTildes(m[2]).toLowerCase().slice(0, 3)]; if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  return '';
}
// Una fecha justo después de la etiqueta (en la misma línea)
function fechaTras(lineas, re) {
  const g = new RegExp('(?:' + re.source + ')\\s*:?\\s*', 'i');
  for (const l of lineas) { const m = g.exec(l); if (!m) continue; const f = fechaDe(l.slice(m.index + m[0].length, m.index + m[0].length + 40)); if (f) return f; }
  return '';
}
// Día y mes sin año ("15 AGO") → aaaa-mm-dd con el año de la referencia (si queda después de la emisión, del año anterior)
function diaMesConAnio(t, ref) {
  const m = /(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3,10})/.exec(t); if (!m || !esIso(ref)) return '';
  const mo = MES_TXT[sinTildes(m[2]).toLowerCase().slice(0, 3)]; if (!mo) return '';
  let y = Number(ref.slice(0, 4)); const f = `${y}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  if (f > ref) y -= 1;
  return `${y}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}
// El N° de cliente o de servicio: con su etiqueta; si no, el número del cupón de pago (número + fecha de vencimiento) o el número
// solo arriba de la boleta (así viene en CGE).
function clienteDe(lineas) {
  const etq = [/n[°ºo]\.?\s*(?:de\s+)?(?:cliente|servicio|suministro)\s*:?\s*([0-9][0-9.\-]{2,20}[0-9kK])/i, /n[uú]mero\s+de\s+(?:cliente|servicio|suministro)(?:\s+es)?\s*:?\s*([0-9][0-9.\-]{2,20}[0-9kK])/i,
    /(?:cliente|servicio)\s*n[°ºo]\.?\s*:?\s*([0-9][0-9.\-]{2,20}[0-9kK])/i];
  for (const re of etq) for (const l of lineas) { const m = re.exec(l); if (m) return m[1].replace(/\.(?=\d{3})/g, ''); }
  for (const l of lineas) { const m = /^(\d{5,10})\s{2,}(\d{1,2}\s+[A-Za-z]{3}\.?\s+\d{4})$/.exec(l.trim()); if (m) return m[1]; }
  for (const l of lineas.slice(0, 15)) { const m = /^(\d{5,10})$/.exec(l.trim()); if (m) return m[1]; }
  return '';
}
// Las líneas → la boleta. Devuelve siempre un objeto: { reconocida, empresa, …, errores, avisos, bloquea }
export function leerBoleta(lineas0) {
  const lineas = (lineas0 || []).map(l => s(l).replace(/ /g, ' ').replace(/\s+$/, '')).filter(l => l.trim());
  const texto = lineas.join('\n'), T = norm(texto);
  const r = { reconocida: false, tipoDoc: '', empresa: '', rutEmisor: '', numero: '', cliente: '', emision: '', desde: '', hasta: '', vence: '', boleta: 0, intereses: 0, neto: 0, iva: 0, exento: 0,
    saldoAnterior: 0, saldoDetalle: [], ajuste: 0, ajusteLeido: null, totalPagar: 0, corte: { enTramite: false, desde: '', monto: 0 }, mes: '', fechaGasto: '', errores: [], avisos: [], bloquea: true };
  // Emisor: el RUT arriba (las primeras líneas) y el nombre
  for (const l of lineas.slice(0, 8)) { const m = /R\.?\s*U\.?\s*T\.?\s*:?\s*(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])/i.exec(l); if (m) { r.rutEmisor = m[1].replace(/\s/g, ''); break; } }
  const porRut = empresaDeRut(r.rutEmisor), porNombre = Object.values(EMPRESAS).find(e => e.texto.test(T)) || null;
  const emp = porRut || porNombre;
  r.tipoDoc = /BOLETA ELECTRONICA/.test(T) ? 'boleta' : /FACTURA ELECTRONICA/.test(T) ? 'factura' : '';
  if (!emp) { r.errores.push('No se reconoce la empresa de la boleta (se buscan CGE y ESSBIO por su RUT o su nombre).'); return r; }
  r.reconocida = true; r.empresa = emp.id; r.servicio = emp.servicio; r.porRut = !!porRut;
  // v0.124.15 · Una factura a nombre de OTRO RUT (la luz de un local arrendado) no llega por el SII: se lee como boleta (sin crédito de IVA).
  //  Solo la factura a nombre de Fën se rechaza (esa llega con las compras del SII y quedaría dos veces).
  if (r.tipoDoc === 'factura') {
    let rutRec = ''; for (const l of lineas.slice(0, 20)) { const m = /(?:^|\s)rut\s*:?\s*(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])/i.exec(l); if (m && m[1].replace(/[^0-9kK]/g, '').toUpperCase() !== s(r.rutEmisor).replace(/[^0-9kK]/g, '').toUpperCase()) { rutRec = m[1].replace(/[^0-9kK]/g, '').toUpperCase(); break; } }
    if (!rutRec || rutRec.slice(0, -1) === RUT_FEN) { r.errores.push(`Es una factura de ${emp.nombre} a nombre de Fën, no una boleta: súbela con el SII (Gastos → Bandeja → Subir archivo).`); return r; }
    r.esFactura = true; r.avisos.push('Es una factura a nombre de otro RUT (no llega por el SII): se guarda como boleta, sin crédito de IVA.');
  }
  // N° de la boleta
  for (const l of lineas.slice(0, 10)) { const m = /^\s*N\s*[º°o]\.?\s*(\d{4,12})\s*$/i.exec(l); if (m) { r.numero = m[1]; break; } }
  if (!r.numero) for (const l of lineas) { const m = /(?:copia\s+boleta|n[°º]\s*(?:de\s+)?boleta|boleta\s+n[°º])\s*:?\s*(\d{4,12})/i.exec(l); if (m) { r.numero = m[1]; break; } }
  r.cliente = clienteDe(lineas);
  // Fechas
  r.emision = fechaTras(lineas, /fecha\s+de\s+emisi[oó]n|boleta\s+emitida|fecha\s+emisi[oó]n|emitida/);
  for (const l of lineas) { const m = /per[ií]odo(?:\s+de\s+lectura|\s+de\s+consumo|\s+facturado)?\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\s*(?:-|al|a)\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i.exec(l); if (m) { r.desde = fechaDe(m[1]); r.hasta = fechaDe(m[2]); break; } }
  if (!r.hasta) { const a = fechaTras(lineas, /lectura\s+anterior/), b = fechaTras(lineas, /lectura\s+actual/); if (a && b) { r.desde = a; r.hasta = b; } }
  if (!r.hasta) for (const l of lineas) { const m = /per[ií]odo\s+(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]{3,10})\s*-\s*(\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]{3,10})/i.exec(l); if (m && r.emision) { r.hasta = diaMesConAnio(m[2], r.emision); r.desde = diaMesConAnio(m[1], r.hasta || r.emision); break; } }
  r.vence = fechaTras(lineas, /fecha\s+de\s+vencimiento|fecha\s+l[ií]mite\s+de\s+pago|pagar\s+hasta|^vencimiento|\s{2}vence|^vence/);
  // Montos (cada uno por su etiqueta al inicio de una celda)
  r.boleta = r0(primero(lineas, /total\s+boleta|total\s+emisi[oó]n|monto\s+total|total\s+del\s+(?:mes|per[ií]odo)|total\s+per[ií]odo/));
  r.intereses = r0(primero(lineas, /inter[eé]s(?:es)?(?:\s+por\s+mora)?/));
  r.neto = r0(primero(lineas, /(?:total\s+)?neto/));
  r.iva = r0(primero(lineas, /(?:19\s*%\s*)?iva/));
  r.exento = r0(primero(lineas, /total\s+exento|exento/));
  r.saldoAnterior = r0(primero(lineas, /saldo\s+anterior/));
  r.saldoDetalle = montosDe(lineas, /saldo\s+anterior\s+[a-záéíóú][a-záéíóú ]{2,40}?(?=\s+\$|\s{2})|otro\s+saldo\s+anterior/).map(x => ({ texto: lineas[x.i].replace(/\s*\$?\s*-?\s*[\d.]+\s*$/, '').trim().slice(0, 60), monto: r0(x.v) }));
  const aj = primero(lineas, /otros(?!\s+cargos)/); r.ajusteLeido = aj === null ? null : r0(aj);
  const tps = [...new Set(montosDe(lineas, /total\s+a\s+pagar/).map(x => r0(x.v)))];
  r.totalPagar = tps.length ? tps[0] : 0;
  // Corte: "Corte en trámite" y "Fecha de corte desde el 05/11/2026"
  r.corte.enTramite = /CORTE EN TRAMITE/.test(T);
  r.corte.desde = fechaTras(lineas, /fecha\s+de\s+corte\s+desde\s+el|corte\s+desde\s+el|corte\s+a\s+partir\s+de/);
  const deuda = /deuda vencida[\s\S]{0,200}?cantidad\s*(?:de)?\s*\$?\s*([\d.]+)/i.exec(texto);
  r.corte.monto = deuda ? Number(deuda[1].replace(/\./g, '')) : 0;
  // El mes del gasto: el del fin del período (si no se lee el período, el de la emisión, con aviso)
  const fin = r.hasta || r.emision;
  r.mes = fin ? fin.slice(0, 7) : ''; r.fechaGasto = r.mes ? ultimoDia(r.mes) : '';
  if (!r.hasta && r.emision) r.avisos.push('No se leyó el período: el gasto queda en el mes de la emisión. Revísalo.');
  // ── Lo que tiene que estar ──
  const falta = (cond, t) => { if (!cond) r.errores.push(t); };
  falta(r.cliente, `No se encontró el N° de ${emp.servicio === 'agua' ? 'servicio' : 'cliente'} en la boleta.`);
  falta(r.totalPagar > 0, 'No se encontró el "Total a pagar".');
  falta(r.boleta > 0, `No se encontró el monto de la boleta del período (se busca "Total boleta" o "Monto Total").`);
  falta(r.mes, 'No se encontró el período ni la fecha de emisión.');
  if (tps.length > 1) r.errores.push(`El "Total a pagar" aparece con montos distintos (${tps.map(pesos).join(' y ')}): revisa el PDF.`);
  if (r.intereses > r.boleta && r.boleta > 0) r.errores.push(`Los intereses (${pesos(r.intereses)}) son más que la boleta del período (${pesos(r.boleta)}).`);
  // ── El cruce: boleta + saldo anterior + ajustes chicos = total a pagar ──
  if (r.boleta > 0 && r.totalPagar > 0) {
    const dif = r.totalPagar - r.boleta - r.saldoAnterior;
    if (Math.abs(dif) <= TOL_CRUCE) r.ajuste = dif;
    else r.errores.push(`No cuadra: boleta del período ${pesos(r.boleta)} + saldo anterior ${pesos(r.saldoAnterior)} = ${pesos(r.boleta + r.saldoAnterior)}, pero el total a pagar dice ${pesos(r.totalPagar)} (diferencia ${pesos(dif)}, más de ${pesos(TOL_CRUCE)}). No se guarda: revisa el PDF.`);
    if (r.ajusteLeido !== null && Math.abs(r.ajusteLeido - r.ajuste) > 1 && !r.errores.length) r.avisos.push(`La boleta dice "Otros" ${pesos(r.ajusteLeido)} y la diferencia es ${pesos(r.ajuste)}.`);
  }
  if (r.saldoDetalle.length && r.saldoAnterior) { const t = r.saldoDetalle.reduce((a, x) => a + x.monto, 0); if (Math.abs(t - r.saldoAnterior) > 1) r.avisos.push(`El detalle del saldo anterior suma ${pesos(t)} y el saldo anterior dice ${pesos(r.saldoAnterior)}.`); }
  if (r.neto && r.iva && r.boleta && Math.abs(r.neto + r.iva + r.exento - r.boleta) > TOL_CRUCE) r.avisos.push(`Neto + IVA + exento (${pesos(r.neto + r.iva + r.exento)}) no es la boleta del período (${pesos(r.boleta)}).`);
  r.bloquea = r.errores.length > 0;
  r.clave = claveBoleta(r);
  return r;
}
// Lo que llega de la pantalla (lo leído, que el dueño pudo corregir): se limpia y se vuelve a cruzar. → la misma forma que leerBoleta
export function revisarBoleta(x) {
  const e = EMPRESAS[s(x && x.empresa)];
  const f = k => (esIso(s(x && x[k])) ? s(x[k]) : '');
  const r = { reconocida: !!e, tipoDoc: 'boleta', empresa: e ? e.id : '', servicio: e ? e.servicio : '', rutEmisor: s(x && x.rutEmisor).slice(0, 20), numero: s(x && x.numero).replace(/[^0-9]/g, '').slice(0, 14),
    cliente: s(x && x.cliente).replace(/[^0-9kK.\-]/g, '').slice(0, 24), emision: f('emision'), desde: f('desde'), hasta: f('hasta'), vence: f('vence'), boleta: r0(x && x.boleta), intereses: Math.max(0, r0(x && x.intereses)),
    neto: r0(x && x.neto), iva: r0(x && x.iva), exento: r0(x && x.exento), saldoAnterior: Math.max(0, r0(x && x.saldoAnterior)), saldoDetalle: [], ajuste: 0, ajusteLeido: null, totalPagar: r0(x && x.totalPagar),
    corte: { enTramite: !!(x && x.corte && x.corte.enTramite), desde: esIso(s(x && x.corte && x.corte.desde)) ? s(x.corte.desde) : '', monto: Math.max(0, r0(x && x.corte && x.corte.monto)) }, errores: [], avisos: [], bloquea: true };
  if (!e) { r.errores.push('Falta la empresa de la boleta (CGE o ESSBIO).'); return r; }
  const fin = r.hasta || r.emision; r.mes = fin ? fin.slice(0, 7) : ''; r.fechaGasto = r.mes ? ultimoDia(r.mes) : '';
  if (!G3.normIdent(r.cliente)) r.errores.push(`Falta el N° de ${e.servicio === 'agua' ? 'servicio' : 'cliente'}.`);
  if (!(r.totalPagar > 0)) r.errores.push('Falta el total a pagar.');
  if (!(r.boleta > 0)) r.errores.push('Falta el monto de la boleta del período.');
  if (!r.mes) r.errores.push('Falta el período (o la fecha de emisión).');
  if (r.desde && r.hasta && r.desde > r.hasta) r.errores.push('El período empieza después de terminar.');
  if (r.intereses > r.boleta && r.boleta > 0) r.errores.push(`Los intereses (${pesos(r.intereses)}) son más que la boleta del período (${pesos(r.boleta)}).`);
  if (r.boleta > 0 && r.totalPagar > 0) {
    const dif = r.totalPagar - r.boleta - r.saldoAnterior;
    if (Math.abs(dif) <= TOL_CRUCE) r.ajuste = dif;
    else r.errores.push(`No cuadra: boleta del período ${pesos(r.boleta)} + saldo anterior ${pesos(r.saldoAnterior)} = ${pesos(r.boleta + r.saldoAnterior)}, pero el total a pagar dice ${pesos(r.totalPagar)} (diferencia ${pesos(dif)}, más de ${pesos(TOL_CRUCE)}). No se guarda: revisa el PDF.`);
  }
  r.bloquea = r.errores.length > 0; r.clave = claveBoleta(r);
  return r;
}
// ¿Estas líneas son una boleta de luz o agua que se lee aquí? (para "Subir archivo" en Conciliación)
export const esBoletaServicio = lineas => { const r = leerBoleta(lineas); return r.reconocida && r.tipoDoc !== 'factura'; };
// La clave de una boleta (para no registrarla dos veces): empresa + N° de boleta (o, sin número, cliente + fin del período + total)
export const claveBoleta = b => (b.numero ? `${b.empresa}-${b.numero}` : `${b.empresa}-${rutNorm(b.cliente)}-${s(b.hasta || b.emision).replace(/-/g, '')}-${r0(b.totalPagar)}`).replace(/[^A-Za-z0-9-]/g, '');
export const idPorPagar = b => 'bo-' + claveBoleta(b);
// La fecha que vale para pagar: la del vencimiento; sin vencimiento (corte en trámite), la de la emisión
export const fechaPagoDe = b => s(b.vence) || s(b.emision) || s(b.fechaGasto);

// ═══════════════ 2 · De dónde viene cada "por pagar" ═══════════════
export const ORIGENES = { fijo: 'Fijo', boleta: 'Boleta', factura: 'Factura SII', archivo: 'Archivo', tabla: 'Tabla', saldo_anterior: 'Boleta (saldo anterior)', compra: 'Compra a crédito', suelto: 'Suelto' };
export const AYUDA_ORIGEN = {
  fijo: 'Se crea solo cada mes, con el monto de su cuenta recurrente (arriendos, sueldos).',
  boleta: 'Nació de su boleta en PDF (luz, agua): el monto y la fecha son los de la boleta.',
  factura: 'Nació de una factura del SII.',
  archivo: 'Nació de un archivo: el comprobante o el CSV de Previred (y más adelante, el de remuneraciones).',
  tabla: 'Nació de una tabla de cuotas (crédito o cuponera).',
  saldo_anterior: 'Lo que una boleta dice que se debía de antes y que no tenía su propia boleta en Gastos.',
  compra: 'Una compra a crédito o con tarjeta registrada a mano.',
  suelto: 'Un pago de una sola vez, sin cuenta recurrente.'
};
// v: el por pagar (documento de la base o como lo ve la pantalla); p: su cuenta recurrente (o null)
export function origenDe(v, p) {
  const d = v || {}, doc = d.documento || {}, nombre = s(d.nombre);
  if (d.boleta && d.boleta.esSaldo === true) return 'saldo_anterior';
  if (d.boleta || doc.tipo === 'boleta') return 'boleta';
  if (doc.tipo === 'previred' || /^previred$/i.test(s(p && p.identificador))) return 'archivo';
  if (doc.tipo === 'sii' || s(d.origen) === 'sii' || s(d.origen) === 'partes' || /^\s*📋\s*.+\s+F\.\d+\s*$/.test(nombre) || d.siiDocId) return 'factura';
  if (d.suelto === true) return 'suelto';
  const pid = s(d.plantillaID || d.plantillaId);
  if (!pid) return 'compra';
  if (p && s(p.frecuencia) === 'cuponera') return 'tabla';
  // Una cuenta "según documento" que todavía espera el suyo: la boleta (o, si su identificador es un RUT, la factura del SII)
  if (s(d.tipoObligacion || (p && p.tipoObligacion)) === 'documento') return /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(s(p && p.identificador).trim()) ? 'factura' : 'boleta';
  return 'fijo';
}
export const TXT_MODELO = 'Cuenta recurrente = la ficha de algo que pagas seguido. Por pagar = cada cobro, con su fecha y monto. Los arriendos (sin documento) se crean solos cada mes; luz, agua, internet, Previred y créditos nacen de su documento o tabla.';
export const TXT_MES_BOLETA = 'El gasto de una boleta es del mes en que termina su período, con fecha del último día de ese mes: 16 ago – 15 sep es de septiembre; 8 sep – 7 oct es de octubre. Una boleta no da crédito de IVA: su costo es el total. Los intereses van aparte, como gasto financiero.';

// ═══════════════ 3 · Cuentas que nacen de su boleta ═══════════════
// Una cuenta recurrente "de boleta": tiene su empresa (CGE, ESSBIO). No se crea sola cada mes: nace de su boleta.
export const esDeBoleta = p => !!(p && EMPRESAS[s(p.empresa)]);
export const naceDelDocumento = esDeBoleta;
// El reparto en % de la cuenta (repartoPct), validado: [{ area, pct }] que suman 100
export function validarReparto(lista, areas = AR.GASTO) {
  const l = (Array.isArray(lista) ? lista : []).map(x => ({ area: s(x && x.area).toUpperCase(), pct: Math.round(num(x && x.pct) * 100) / 100 })).filter(x => x.area || x.pct);
  if (!l.length) return { error: 'Agrega al menos un área con su %' };
  if (l.some(x => !areas.includes(x.area))) return { error: 'Un área del reparto no es válida' };
  if (new Set(l.map(x => x.area)).size !== l.length) return { error: 'Cada área una sola vez en el reparto' };
  if (l.some(x => !(x.pct > 0))) return { error: 'Cada área del reparto necesita su %' };
  if (Math.abs(l.reduce((a, x) => a + x.pct, 0) - 100) > 0.01) return { error: 'El reparto debe sumar 100 %' };
  return { reparto: l };
}
export const textoReparto = l => (Array.isArray(l) ? l : []).map(x => `${x.area} ${String(x.pct).replace('.', ',')}%`).join(' · ');
const vivo = x => x && x.d && !x.d.quitadoEnPlanilla;
const activa = x => vivo(x) && s(x.d.estado || 'ACTIVA') === 'ACTIVA';
const pidDe = x => s(x.d.id) || x.id;
// La cuenta de una boleta: la de esa empresa con ese N° (o, sin empresa guardada, la de ese N°). Si no hay, las de esa empresa que
// todavía no tienen su N° (para elegir una y aprenderlo). → { cuenta, como: 'numero' } | { opciones, como: 'sin_numero' } | { ninguna: true }
export function cuentaDeBoleta(plantillas, empresa, cliente) {
  const k = G3.normIdent(cliente), act = (plantillas || []).filter(activa);
  const conNum = k ? act.filter(x => G3.normIdent(x.d.identificador) === k && (!s(x.d.empresa) || s(x.d.empresa) === empresa)) : [];
  if (conNum.length === 1) return { cuenta: conNum[0], como: 'numero' };
  if (conNum.length > 1) return { opciones: conNum, como: 'varias', duda: `Hay ${conNum.length} cuentas recurrentes con el N° ${cliente}: elige cuál es.` };
  const sinNum = act.filter(x => s(x.d.empresa) === empresa && !G3.normIdent(x.d.identificador));
  if (sinNum.length) return { opciones: sinNum, como: 'sin_numero' };
  return { ninguna: true };
}

// ═══════════════ 4 · El por pagar de una boleta y sus gastos ═══════════════
// Los por pagar de una cuenta (documentos de la base { id, d }), sin anulados
export const deCuenta = (vencs, pid) => (vencs || []).filter(x => vivo(x) && s(x.d.plantillaID) === pid && G3.estadoBase(x.d) !== 'anulado');
const mesDe = d => s((d.boleta && d.boleta.mes) || d.periodoKey || s(d.fechaVencimiento).slice(0, 7));
const orden = (a, b) => mesDe(a.d).localeCompare(mesDe(b.d)) || s(G3.fechaReal(a.d)).localeCompare(s(G3.fechaReal(b.d))) || a.id.localeCompare(b.id);
// Lo que sigue por pagar de la cuenta ANTES del mes de esta boleta (lo que el saldo anterior debería ser)
export function abiertosAntes(vencs, pid, mes, excluir = []) {
  return deCuenta(vencs, pid).filter(x => G3.abierto(x.d) && !excluir.includes(x.id) && mesDe(x.d) < mes && !(x.d.boleta && x.d.boleta.reemplazadoPor)).sort(orden);
}
// El saldo anterior contra lo que sigue por pagar: { estado: 'sin_saldo'|'calza'|'no_calza', abiertos, suma, dif, periodos }
export function compararSaldo(b, abiertos) {
  const suma = (abiertos || []).reduce((a, x) => a + G3.saldoVenc(x.d), 0), sa = r0(b.saldoAnterior);
  const periodos = (abiertos || []).map(x => nombreMes(mesDe(x.d)));
  if (!(sa > 0)) return { estado: 'sin_saldo', abiertos: [], suma, dif: -suma, periodos: [] };
  const dif = sa - suma;
  if (abiertos.length && Math.abs(dif) <= TOL_SALDO) return { estado: 'calza', abiertos, suma, dif, periodos };
  return { estado: 'no_calza', abiertos, suma, dif, periodos };
}
export const textoCalza = c => `El saldo anterior son: ${c.periodos.join(', ')}${c.dif ? ` (diferencia ${pesos(c.dif)}, va como ajuste de esta boleta)` : ''}.`;
export const textoNoCalza = (b, c) => c.suma
  ? `El saldo anterior de la boleta es ${pesos(b.saldoAnterior)} y en Gastos sigue por pagar ${pesos(c.suma)} de esta cuenta (${c.periodos.join(', ')}): faltan ${pesos(c.dif)}.`
  : `El saldo anterior de la boleta es ${pesos(b.saldoAnterior)} y en Gastos no hay nada por pagar de antes de esta cuenta.`;
// Las líneas de gasto de un monto con el reparto de la cuenta: [{ area, monto }] que suman exacto (el último % se lleva el redondeo)
export function lineasReparto(monto, cuenta) {
  const c = cuenta || {}, rep = validarReparto(c.repartoPct);
  if (!rep.error) return AB.montosPorAreas(r0(monto), rep.reparto).map(x => ({ area: x.area, monto: x.monto, pct: x.pct }));
  if (s(c.area) === 'PRORRATEADO') {
    const l = [1, 2, 3].map(k => ({ area: s(c['pArea' + k]), pct: num(c['pPct' + k]) })).filter(x => x.area && x.pct > 0);
    if (l.length) return AB.montosPorAreas(r0(monto), l).map(x => ({ area: x.area, monto: x.monto, pct: x.pct }));
  }
  // Una cuenta de antes con montos por área (multiArea): en la misma proporción
  let ma = c.multiArea; if (typeof ma === 'string') { try { ma = ma ? JSON.parse(ma) : null; } catch (e) { ma = null; } }
  if (Array.isArray(ma) && ma.length) {
    const tot = ma.reduce((a, x) => a + num(x.monto), 0);
    if (tot > 0) { const l = ma.filter(x => AR.GASTO.includes(s(x.area)) && num(x.monto) > 0).map(x => ({ area: s(x.area), pct: Math.round(num(x.monto) / tot * 10000) / 100 })); if (l.length) return AB.montosPorAreas(r0(monto), l).map(x => ({ area: x.area, monto: x.monto, pct: x.pct })); }
  }
  if (s(c.area) && AR.GASTO.includes(s(c.area))) return [{ area: s(c.area), monto: r0(monto), pct: 100 }];
  return [];
}
// El gasto de una línea (sin IVA: una boleta no da crédito; a crédito del proveedor hasta que se pague)
export function lineaGasto(o) {
  const m = r0(o.monto), f = s(o.fecha);
  return { fecha: f, hora: s(o.hora), itemGasto: s(o.item && o.item.item), categoria: s(o.item && o.item.categoria), tipo: s(o.item && o.item.tipo), subTipo: s(o.item && o.item.subTipo), area: s(o.area),
    tipoMonto: 'siniva', montoNeto: m, montoFinal: m, esHarina: 'No', formaPago: 'proveedor', fechaPago: '', archivo: s(o.archivo).slice(0, 120), observacion: s(o.obs).slice(0, 500), urlFoto: s(o.url),
    estado: 'vigente', mes: f.slice(0, 7), anio: f ? Number(f.slice(0, 4)) : null, folio: '', esNC: false,
    vencimientoId: s(o.vencId), boleta: { empresa: s(o.b.empresa), numero: s(o.b.numero), cliente: s(o.b.cliente), mes: f.slice(0, 7), parte: s(o.parte) },
    cuentaRecurrente: { id: s(o.cuenta.id), nombre: s(o.cuenta.nombre), local: s(o.cuenta.local) } };
}
// El plan de una boleta. b: leerBoleta (revisada en pantalla); cuenta: { id, d } de la cuenta; vencs: todos ({ id, d }); items: los vigentes.
// op = { item, itemIntereses, areaIntereses, saldoSinBoleta: { registrar, mes, item } , url, nombreArchivo, hora, vencIdEspera }
// → { error } | { id, venc, lineas: [{ d, para: 'boleta'|'sa' }], sa: { id, venc } | null, comparacion, anular: [{ id, campos }], repetido }
export function planBoleta(b, cuenta, vencs, items, op = {}) {
  if (!b || b.bloquea) return { error: (b && b.errores && b.errores[0]) || 'La boleta no se pudo leer' };
  if (!cuenta || !cuenta.d) return { error: 'Elige la cuenta recurrente de esta boleta' };
  const pid = pidDe(cuenta), c = { ...cuenta.d, id: pid }, id = idPorPagar(b);
  // ¿Ya está? (la misma boleta dos veces no duplica)
  const ya = (vencs || []).find(x => vivo(x) && (x.id === id || (x.d.boleta && s(x.d.boleta.clave) === claveBoleta(b))) && G3.estadoBase(x.d) !== 'anulado');
  if (ya) return { repetido: true, id: ya.id, venc: ya.d };
  const it = (items || []).find(i => i.item === s(op.item || c.item));
  if (!it) return { error: 'Elige el ítem de gasto de esta cuenta (luz o agua)' };
  const rep = lineasReparto(1000, c);
  if (!rep.length) return { error: `La cuenta "${s(c.nombre)}" no tiene reparto por área: edítala (Cuentas recurrentes → Editar).` };
  const intereses = r0(b.intereses);
  const itI = intereses > 0 ? (items || []).find(i => i.item === s(op.itemIntereses)) : null;
  if (intereses > 0 && !itI) return { error: 'Intereses: elige el ítem (uno de tipo financiero).' };
  const areaI = s(op.areaIntereses) || 'ADMIN';
  if (intereses > 0 && !AR.GASTO.includes(areaI)) return { error: 'Intereses: elige el área.' };
  // Una boleta antigua que llega después de haber registrado su mes como "saldo anterior sin boleta": la reemplaza (si no tiene pagos)
  const anular = [];
  const saViejo = deCuenta(vencs, pid).find(x => x.d.boleta && x.d.boleta.esSaldo === true && s(x.d.boleta.mes) === b.mes && !x.d.boleta.reemplazadoPor);
  if (saViejo) {
    const e = G3.estadoBase(saViejo.d);
    if (e === 'pagado' || (Array.isArray(saViejo.d.abonos) && saViejo.d.abonos.length))
      return { error: `El mes ${nombreMes(b.mes)} de esta cuenta ya está registrado como "saldo anterior sin boleta" y tiene pagos: esta boleta no se registra, para no contar dos veces.` };
    anular.push({ id: saViejo.id, gastos: Array.isArray(saViejo.d.gastosDoc) ? saViejo.d.gastosDoc : [] });
  }
  // El saldo anterior contra lo que sigue por pagar (antes del mes de esta boleta)
  const abiertos = abiertosAntes(vencs, pid, b.mes, anular.map(x => x.id));
  const cmp = compararSaldo(b, abiertos);
  let ajuste = r0(b.ajuste), sa = null;
  const cubre = [];
  if (cmp.estado === 'calza') { ajuste += r0(cmp.dif); cmp.abiertos.forEach(x => cubre.push(x.id)); }
  else if (cmp.estado === 'no_calza') {
    cmp.abiertos.forEach(x => cubre.push(x.id));
    const sb = op.saldoSinBoleta || {};
    if (sb.registrar && cmp.dif > 0) {
      const mesSA = /^\d{4}-\d{2}$/.test(s(sb.mes)) ? s(sb.mes) : mesAnterior(b.mes);
      if (mesSA >= b.mes) return { error: 'El saldo anterior sin boleta tiene que ser de un mes anterior al de esta boleta.' };
      const itSA = (items || []).find(i => i.item === s(sb.item || it.item));
      if (!itSA) return { error: 'Saldo anterior: elige el ítem.' };
      sa = { id: id + '-sa', mes: mesSA, monto: r0(cmp.dif), item: itSA };
      cubre.push(sa.id);
    } else ajuste += 0;   // queda sin registrar: el aviso lo dice; el total a pagar no se cubre con lo de Gastos
  }
  const total = r0(b.boleta) + ajuste;
  if (!(total > 0)) return { error: 'La boleta del período queda en $0 o menos: revisa los montos.' };
  const fechaPago = fechaPagoDe(b), por = s(op.por), en = s(op.en);
  const base = { b, cuenta: c, url: s(op.url), archivo: s(op.nombreArchivo), hora: s(op.hora) };
  const obs = `Boleta ${EMPRESAS[b.empresa].nombre}${b.numero ? ' N° ' + b.numero : ''} · ${s(c.nombre)} · período ${b.desde ? dma(b.desde) + ' al ' : ''}${dma(b.hasta || b.emision)}`;
  const idV = op.vencIdEspera || id;
  const lineas = [];
  const resto = total - intereses;
  lineasReparto(resto, c).forEach(x => lineas.push({ para: 'boleta', d: lineaGasto({ ...base, item: it, area: x.area, monto: x.monto, fecha: b.fechaGasto, obs, vencId: idV, parte: 'consumo' }) }));
  if (intereses > 0) lineas.push({ para: 'boleta', d: lineaGasto({ ...base, item: itI, area: areaI, monto: intereses, fecha: b.fechaGasto, obs: `Intereses · ${obs}`, vencId: idV, parte: 'intereses' }) });
  const reparto = lineasReparto(total, c);
  const nombre = `${s(c.nombre)} · ${nombreMes(b.mes)}`;
  const docBoleta = { tipo: 'boleta', url: s(op.url), nombreArchivo: s(op.nombreArchivo).slice(0, 120), numero: s(b.numero), cliente: s(b.cliente), empresa: s(b.empresa), rut: s(b.rutEmisor), por, en, clave: claveBoleta(b) };
  const venc = { plantillaID: pid, nombre, item: it.item, categoria: s(it.categoria), tipo: s(it.tipo), subTipo: s(it.subTipo), periodoKey: b.mes, fechaVencimiento: fechaPago, montoEstimado: '', obs: '',
    area: reparto.length === 1 ? reparto[0].area : 'MULTI', multiArea: reparto.length > 1 ? JSON.stringify(reparto.map(x => ({ area: x.area, monto: x.monto }))) : '',
    pArea1: '', pPct1: '', pArea2: '', pPct2: '', pArea3: '', pPct3: '', fechaCompra: '', tipoMonto: 'siniva', estado: 'por_pagar', fechaPago: '', montoPago: '', obsPago: '', urlComprobante: '',
    tipoObligacion: 'documento', montoDocumento: total, fechaDocumento: fechaPago, fechaEstimada: fechaPago, documento: docBoleta, devengado: true, origenPorPagar: 'boleta',
    boleta: { clave: claveBoleta(b), empresa: s(b.empresa), numero: s(b.numero), cliente: s(b.cliente), emision: s(b.emision), desde: s(b.desde), hasta: s(b.hasta), vence: s(b.vence), mes: b.mes, fechaGasto: b.fechaGasto,
      boleta: r0(b.boleta), intereses, ajuste, saldoAnterior: r0(b.saldoAnterior), totalPagar: r0(b.totalPagar), neto: r0(b.neto), iva: r0(b.iva), exento: r0(b.exento), cubre, calce: cmp.estado,
      corte: { enTramite: !!(b.corte && b.corte.enTramite), desde: s(b.corte && b.corte.desde), monto: r0(b.corte && b.corte.monto) }, ...(anular.length ? { reemplaza: anular[0].id } : {}) } };
  let saPlan = null;
  if (sa) {
    const obsSA = `Saldo anterior sin boleta de ${nombreMes(sa.mes)} · ${s(c.nombre)} (lo dice la boleta${b.numero ? ' N° ' + b.numero : ''} de ${nombreMes(b.mes)})`;
    const fSA = ultimoDia(sa.mes), repSA = lineasReparto(sa.monto, c);
    repSA.forEach(x => lineas.push({ para: 'sa', d: lineaGasto({ ...base, item: sa.item, area: x.area, monto: x.monto, fecha: fSA, obs: obsSA, vencId: sa.id, parte: 'saldo_anterior' }) }));
    saPlan = { id: sa.id, venc: { ...venc, nombre: `${s(c.nombre)} · saldo anterior (${nombreMes(sa.mes)})`, item: sa.item.item, categoria: s(sa.item.categoria), tipo: s(sa.item.tipo), subTipo: s(sa.item.subTipo), periodoKey: sa.mes,
      area: repSA.length === 1 ? repSA[0].area : 'MULTI', multiArea: repSA.length > 1 ? JSON.stringify(repSA.map(x => ({ area: x.area, monto: x.monto }))) : '', montoDocumento: sa.monto, origenPorPagar: 'saldo_anterior',
      documento: { ...docBoleta, esSaldo: true }, boleta: { clave: claveBoleta(b) + '-sa', empresa: s(b.empresa), numero: s(b.numero), cliente: s(b.cliente), mes: sa.mes, fechaGasto: fSA, esSaldo: true, saldoAnterior: 0, deBoleta: idV, boleta: sa.monto, intereses: 0, ajuste: 0, totalPagar: sa.monto } } };
  }
  return { id: idV, venc, lineas, sa: saPlan, comparacion: cmp, anular, total, ajuste, cubre };
}

// ═══════════════ 5 · Esperando boleta (estimado, nunca un gasto) ═══════════════
// Las boletas ya registradas de una cuenta (sin las de saldo anterior), de la más nueva a la más antigua
export const boletasDe = (vencs, pid) => deCuenta(vencs, pid).filter(x => x.d.boleta && x.d.boleta.esSaldo !== true).sort((a, b) => orden(b, a));
export function estimado(vencs, pid, fallback) {
  const l = boletasDe(vencs, pid).slice(0, 3).map(x => r0(x.d.boleta.boleta || x.d.montoDocumento)).filter(v => v > 0);
  if (l.length) return { monto: Math.round(l.reduce((a, v) => a + v, 0) / l.length), n: l.length, de: 'promedio' };
  const f = r0(fallback);
  return f > 0 ? { monto: f, n: 0, de: 'cuenta' } : { monto: 0, n: 0, de: 'sin' };
}
// Para cada cuenta de boleta activa sin la boleta del mes en curso: { id, cuentaId, nombre, mes, fecha, estimado, n, de, texto }
export function esperandoBoleta(plantillas, vencs, hoy) {
  const mes = s(hoy).slice(0, 7), out = [];
  (plantillas || []).filter(activa).filter(x => esDeBoleta(x.d)).forEach(x => {
    const pid = pidDe(x), bs = boletasDe(vencs, pid);
    if (bs.some(v => s(v.d.boleta.mes) >= mes)) return;
    const e = estimado(vencs, pid, x.d.montoEstimado), ult = bs[0];
    let fecha = ultimoDia(mes);
    if (ult) {
      const fv = fechaPagoDe(ult.d.boleta) || s(ult.d.fechaVencimiento);
      if (esIso(fv)) { const k = difMeses(ult.d.boleta.mes, fv.slice(0, 7)), m2 = sumarMeses(mes, k), dd = Math.min(Number(fv.slice(8, 10)), Number(ultimoDia(m2).slice(8, 10))); fecha = `${m2}-${String(dd).padStart(2, '0')}`; }
    }
    out.push({ id: `eb-${pid}-${mes}`, cuentaId: pid, nombre: s(x.d.nombre), mes, fecha, estimado: e.monto, n: e.n, de: e.de, esEstimado: true, empresa: s(x.d.empresa),
      texto: `Esperando boleta de ${soloMes(mes)}`, detalle: e.de === 'promedio' ? `estimado ${pesos(e.monto)} (promedio de ${e.n === 1 ? 'la última boleta' : `las últimas ${e.n}`})` : e.de === 'cuenta' ? `estimado ${pesos(e.monto)} (el de la cuenta)` : 'sin estimado todavía' });
  });
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
}
// En la Agenda: el estimado, con borde punteado (no es un pago ni un gasto)
export const agendaEsperando = (lista, desde, hasta) => (lista || []).filter(x => x.fecha >= desde && x.fecha <= hasta).map(x => ({ auto: true, cat: 'pago', tipo: 'fen', fecha: x.fecha, hora: '', estimado: true, proyectado: true,
  titulo: `${x.texto}: ${x.nombre}`, origen: `Desde Gastos · ${x.detalle} · es un estimado, no un gasto`, monto: x.estimado, url: '#gastos/por-pagar', ebId: x.id }));

// ═══════════════ 6 · Corte de suministro: aviso urgente en Hoy ═══════════════
// Lo que cubre una boleta (su saldo anterior), con los reemplazos (un saldo sin boleta que después llegó con su boleta)
function cubiertos(x, porId) {
  const ids = (x.d.boleta.cubre || []).map(id => { const v = porId[id]; return v && v.d.boleta && v.d.boleta.reemplazadoPor ? s(v.d.boleta.reemplazadoPor) : id; });
  return ids.map(id => porId[id]).filter(Boolean);
}
// → [{ id, cuentaId, nombre, titulo, detalle, monto, desde, enTramite }]
export function avisosCorte(vencs, plantillas) {
  const porId = {}; (vencs || []).filter(vivo).forEach(x => { porId[x.id] = x; });
  const nombres = {}; (plantillas || []).filter(vivo).forEach(x => { nombres[pidDe(x)] = s(x.d.nombre); });
  const ult = {};
  Object.values(porId).filter(x => x.d.boleta && x.d.boleta.esSaldo !== true && G3.estadoBase(x.d) !== 'anulado').forEach(x => {
    const pid = s(x.d.plantillaID), u = ult[pid]; if (!u || orden(x, u) > 0) ult[pid] = x;
  });
  const out = [];
  Object.values(ult).forEach(x => {
    const c = x.d.boleta.corte || {}; if (!c.enTramite && !c.desde) return;
    const cub = cubiertos(x, porId), rel = cub.length ? cub : [x], abiertos = rel.filter(v => G3.abierto(v.d));
    if (!abiertos.length) return;
    const monto = cub.length ? abiertos.reduce((a, v) => a + G3.saldoVenc(v.d), 0) : (r0(c.monto) || r0(x.d.boleta.saldoAnterior) || G3.saldoVenc(x.d));
    const nombre = nombres[s(x.d.plantillaID)] || s(x.d.nombre).replace(/\s·.*$/, '');
    out.push({ id: 'corte-' + x.id, vencId: x.id, cuentaId: s(x.d.plantillaID), nombre, monto, desde: s(c.desde), enTramite: !!c.enTramite, ids: abiertos.map(v => v.id),
      titulo: `${nombre}: corte ${c.desde ? 'desde el ' + diaCorto(c.desde) : 'en trámite'} si no se paga ${pesos(monto)}`,
      detalle: `Lo dice la boleta de ${nombreMes(x.d.boleta.mes)}${x.d.boleta.numero ? ' (N° ' + x.d.boleta.numero + ')' : ''}. Págalo y concilia el cargo: el aviso se va solo.` });
  });
  return out.sort((a, b) => (a.desde || '9999').localeCompare(b.desde || '9999') || a.nombre.localeCompare(b.nombre));
}

// ═══════════════ 7 · Pagar: lo más antiguo primero ═══════════════
// items: por pagar abiertos de una cuenta ({ id, d } o vistas con saldo). → { pagos: [{ id, monto, completo, saldo }], sobra, total }
export function planOrden(items, monto) {
  const l = (items || []).map(x => (x.d ? { id: x.id, mes: mesDe(x.d), fecha: s(G3.fechaReal(x.d)), saldo: G3.saldoVenc(x.d) } : { id: x.id, mes: s(x.mes || (x.boleta && x.boleta.mes) || x.periodo), fecha: s(x.fecha), saldo: r0(x.saldo !== undefined ? x.saldo : x.monto) }))
    .filter(x => x.saldo > 0).sort((a, b) => a.mes.localeCompare(b.mes) || a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  let resto = r0(monto); const pagos = [];
  for (const x of l) { if (resto <= 0) break; const m = Math.min(resto, x.saldo); pagos.push({ id: x.id, monto: m, completo: m === x.saldo, saldo: x.saldo }); resto -= m; }
  return { pagos, sobra: Math.max(0, resto), total: l.reduce((a, x) => a + x.saldo, 0) };
}
export const textoOrden = (plan, nombres = {}) => plan.pagos.map(p => `${nombres[p.id] || p.id}: ${p.completo ? 'pagado ' + pesos(p.monto) : `abono ${pesos(p.monto)} (queda ${pesos(p.saldo - p.monto)})`}`).join(' · ');

// ═══════════════ 8 · La cartola: el total a pagar de una boleta, su saldo anterior, o un pago parcial ═══════════════
// vencs: vencimientosAbiertos (gastos-cartola.js), con boleta, devengado, saldo y plantillaId. regla: la aprendida de esa glosa.
// → la propuesta { tipo: 'vencimientos', pagos, texto, por: 'boleta', seguro, empresa, empresaEnGlosa, boletaId, que } | null
export function propuestaBoleta(c, vencs, regla) {
  const porId = {}; (vencs || []).forEach(v => { porId[v.id] = v; });
  const deCuentaV = pid => (vencs || []).filter(v => v.plantillaId === pid && v.devengado && v.saldo > 0);
  const ordenV = (a, b) => s(a.mesBoleta).localeCompare(s(b.mesBoleta)) || s(a.fecha).localeCompare(s(b.fecha)) || a.id.localeCompare(b.id);
  const emp = empresaDeGlosa(c.descripcion), aprendidoP = regla && s(regla.vencimiento).startsWith('p:') ? s(regla.vencimiento).slice(2) : '';
  const seguroDe = v => (emp && emp === s(v.empresa)) || (aprendidoP && aprendidoP === v.plantillaId);
  const cands = [];
  (vencs || []).filter(v => v.devengado && v.boleta && v.boleta.esSaldo !== true).forEach(v => {
    const cub = (v.boleta.cubre || []).map(id => porId[id]).filter(x => x && x.saldo > 0).sort(ordenV);
    const conEsta = v.saldo > 0 ? cub.concat([v]) : cub, tot = conEsta.reduce((a, x) => a + x.saldo, 0), tAnt = cub.reduce((a, x) => a + x.saldo, 0);
    if (conEsta.length > 1 && tot === c.monto) cands.push({ v, l: conEsta, que: 'total' });
    else if (cub.length && tAnt === c.monto) cands.push({ v, l: cub, que: 'saldo' });
  });
  if (cands.length === 1) {
    const { v, l, que } = cands[0];
    return { tipo: 'vencimientos', seguro: !!seguroDe(v), pagos: l.map(x => ({ id: x.id, monto: x.saldo })), por: 'boleta', empresa: s(v.empresa), empresaEnGlosa: !!emp && emp === s(v.empresa), boletaId: v.id, que,
      texto: que === 'total' ? `${s(v.cuentaNombre) || v.nombre}: total a pagar de la boleta de ${soloMes(v.boleta.mes)} (${l.length} por pagar, lo más antiguo primero)` : `${s(v.cuentaNombre) || v.nombre}: el saldo anterior de la boleta de ${soloMes(v.boleta.mes)} (${l.map(x => soloMes(x.mesBoleta)).join(', ')})` };
  }
  return null;
}
// Un cargo de una cuenta reconocida (por la glosa o lo aprendido) que no calza con un total: paga lo más antiguo y el resto queda
// como abono (siempre se revisa)
export function propuestaOrden(c, vencs, regla) {
  const emp = empresaDeGlosa(c.descripcion), aprendidoP = regla && s(regla.vencimiento).startsWith('p:') ? s(regla.vencimiento).slice(2) : '';
  const abiertos = (vencs || []).filter(v => v.devengado && v.saldo > 0);
  const pids = [...new Set(abiertos.filter(v => (aprendidoP && v.plantillaId === aprendidoP) || (emp && s(v.empresa) === emp)).map(v => v.plantillaId))];
  if (pids.length !== 1) return null;
  const l = abiertos.filter(v => v.plantillaId === pids[0]), plan = planOrden(l.map(v => ({ id: v.id, mes: v.mesBoleta, fecha: v.fecha, saldo: v.saldo })), c.monto);
  if (!plan.pagos.length || plan.sobra > 0 || plan.total === c.monto) return null;
  const nombres = Object.fromEntries(l.map(v => [v.id, soloMes(v.mesBoleta)])), cta = s(l[0].cuentaNombre) || l[0].nombre;
  return { tipo: 'vencimientos', seguro: false, pagos: plan.pagos.map(p => ({ id: p.id, monto: p.monto })), por: 'boleta', empresa: s(l[0].empresa), empresaEnGlosa: !!emp, que: 'orden', duda: `Paga una parte: lo más antiguo primero; lo que no alcanza queda como abono.`,
    texto: `${cta}: ${textoOrden(plan, nombres)}` };
}

// ═══════════════ 9 · "Crear cuentas de luz y agua" (una vez) ═══════════════
// Los N° de cliente NO van aquí: se aprenden de la primera boleta o los escribe el dueño.
export const CUENTAS_LUZ_AGUA = [
  { clave: 'luz-ainavillo', nombre: 'Luz Ainavillo', empresa: 'CGE', servicio: 'luz', local: 'Ainavillo', reparto: [{ area: 'PAN', pct: 40 }, { area: 'BOL', pct: 40 }, { area: 'PAS', pct: 10 }, { area: 'B2C', pct: 10 }] },
  { clave: 'agua-ainavillo', nombre: 'Agua Ainavillo', empresa: 'ESSBIO', servicio: 'agua', local: 'Ainavillo', reparto: [{ area: 'PAN', pct: 40 }, { area: 'BOL', pct: 40 }, { area: 'PAS', pct: 10 }, { area: 'B2C', pct: 10 }] },
  { clave: 'luz-barros', nombre: 'Luz Barros Arana', empresa: 'CGE', servicio: 'luz', local: 'Barros Arana', reparto: [{ area: 'CAF', pct: 70 }, { area: 'B2C', pct: 30 }] },
  { clave: 'agua-barros', nombre: 'Agua Barros Arana', empresa: 'ESSBIO', servicio: 'agua', local: 'Barros Arana', reparto: [{ area: 'CAF', pct: 80 }, { area: 'B2C', pct: 20 }] }
];
const RE_SERV = { luz: /\bLUZ\b|ELECTRIC|ENERGIA ELECTRICA|\bCGE\b/, agua: /\bAGUA\b|ESSBIO|SANITARIA/ };
const RE_LOCAL = { Ainavillo: /AINAVILLO/, 'Barros Arana': /BARROS/ };
// El ítem propuesto para un servicio: el que se llama LUZ / ELECTRICIDAD (o AGUA), si existe
export function itemPara(items, servicio) {
  const l = (items || []).filter(i => i && i.item && !i.archivado && RE_SERV[servicio].test(norm(i.item)) && !/\bCGE\b|ESSBIO/.test(norm(i.item)));
  const exacto = l.find(i => (servicio === 'luz' ? /^(LUZ|ELECTRICIDAD|ENERGIA ELECTRICA)$/ : /^AGUA( POTABLE)?$/).test(norm(i.item)));
  return (exacto || l[0] || {}).item || '';
}
// El plan: para cada una de las 4, si ya existe (misma empresa y local), las de luz o agua que ya había (para usarlas en vez de
// crear otra) y el ítem propuesto. → [{ def, existe: { id, nombre } | null, candidatas: [{ id, nombre, item }], item }]
export function planCuentas(plantillas, items) {
  const act = (plantillas || []).filter(activa);
  return CUENTAS_LUZ_AGUA.map(def => {
    const ex = act.find(x => s(x.d.empresa) === def.empresa && s(x.d.local) === def.local) || null;
    const cand = ex ? [] : act.filter(x => !esDeBoleta(x.d) && (RE_SERV[def.servicio].test(norm(x.d.nombre)) || RE_SERV[def.servicio].test(norm(x.d.item))))
      .map(x => ({ id: pidDe(x), docId: x.id, nombre: s(x.d.nombre), item: s(x.d.item), local: RE_LOCAL[def.local].test(norm(x.d.nombre)) }))
      .sort((a, b) => Number(b.local) - Number(a.local) || a.nombre.localeCompare(b.nombre));
    return { def, existe: ex ? { id: pidDe(ex), nombre: s(ex.d.nombre) } : null, candidatas: cand, item: itemPara(items, def.servicio) };
  });
}
// Lo que se guarda en una cuenta (nueva o una que ya existía y se usa): solo los campos de la cuenta de boleta.
export function camposCuenta(def, it) {
  return { empresa: def.empresa, servicio: def.servicio, local: def.local, repartoPct: def.reparto.map(x => ({ ...x })), tipoObligacion: 'documento', sePagaPor: 'banco', diasAviso: G3.DIAS_AVISO,
    ...(it ? { item: it.item, categoria: s(it.categoria), tipo: s(it.tipo), subTipo: s(it.subTipo) } : {}) };
}
export function docCuentaNueva(id, def, it, hoy, clave) {
  return { id, nombre: def.nombre, item: it ? it.item : '', frecuencia: 'mensual_ultimo', dia: '', fechaEsp: '', montoEstimado: '', obs: `Nace de su boleta (${def.empresa}). Creada con "Crear cuentas de luz y agua".`,
    area: '', categoria: it ? s(it.categoria) : '', tipo: it ? s(it.tipo) : '', subTipo: it ? s(it.subTipo) : '', pArea1: '', pPct1: '', pArea2: '', pPct2: '', pArea3: '', pPct3: '', multiArea: '', tipoMonto: 'siniva',
    estado: 'ACTIVA', fechaCreacion: hoy, cuotas: '', identificador: '', clave, ...camposCuenta(def, it) };
}
