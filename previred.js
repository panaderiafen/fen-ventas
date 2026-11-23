// ═══════════════════════════════════════════════
//  Sistema Fën — Cotizaciones de Previred  v0.10.1
//  Lee en el navegador el PDF de "Certificado de Pagos de Cotizaciones Previsionales"
//  (uno o el lote con todos los trabajadores). El PDF no sale del equipo hasta que se
//  guarda: entonces va al Apps Script de Gastos (SistemaFen.gs v1.4.0), que lo revisa
//  y lo deja en Drive como comprobante.
//  Lectura del PDF: pdf.js 3.11.174 (cdnjs), solo texto (isEvalSupported: false).
//  v0.51.0: con Gastos en la base nueva, estado, registrar y lista van a fen-gastos (gastos-g3d-fs.js), con las mismas
//  respuestas. El estado dice además a dónde va el certificado (destino): al vencimiento de la obligación "Cotizaciones"
//  (los gastos por trabajador se crean al pagarlo) o, si no hay, como siempre (los gastos al guardar) con una nota.
//  v0.67.0: también el "Comprobante de pago" de Previred (CtrlPdf: una sección por institución, con su resumen y su detalle por
//  trabajador): leerComprobante() da los trabajadores con la misma forma que leer() y, además, lo que pagó la empresa por
//  institución (cotización, intereses y multas) y si se pagó fuera de plazo. Las páginas giradas (apaisadas) se leen
//  derechas: lineasDelPdf usa la posición en la página como se ve (con su giro), igual que antes en las no giradas.
// ═══════════════════════════════════════════════
import * as Gastos from './gastos.js?v=0.138.0';
import { venceDe } from './gastos-g3d.js?v=0.138.0';

export const VERSION_MINIMA = '2.5.0';
// v0.51.0: con la base nueva, a fen-gastos (las escrituras antiguas de Previred en la planilla las rechaza el script v2.17.0)
const llamar = async (op, datos, idem) => ((await Gastos.enBase()) ? Gastos.cotBase(op, datos, idem) : Gastos.llamar(op, datos, idem, VERSION_MINIMA));
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let cargaPdfjs = null;
function pdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!cargaPdfjs) cargaPdfjs = new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => { cargaPdfjs = null; no(new Error('No se pudo cargar el lector de PDF (revisa internet).')); };
    document.head.appendChild(s);
  });
  return cargaPdfjs;
}

// Texto del PDF en líneas: se agrupan los trozos por altura y se ordenan de izquierda a derecha.
// Las celdas quedan separadas por dos espacios, como en la tabla.
// v0.67.0: la posición es la de la página como se ve (con su giro: el comprobante de Previred viene apaisado). En una página sin
// giro es lo mismo de antes (la altura se mide desde arriba en vez de desde abajo).
const porMatriz = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export function lineasDePagina(items, vista) {
  const filas = [];
  (items || []).filter(i => i.str && i.str.trim()).forEach(i => {
    const t = vista ? porMatriz(vista, i.transform) : [1, 0, 0, 1, i.transform[4], -i.transform[5]], y = t[5], x = t[4];
    let f = filas.find(r => Math.abs(r.y - y) < 2.5);
    if (!f) { f = { y, celdas: [] }; filas.push(f); }
    f.celdas.push({ x, t: i.str.trim() });
  });
  return filas.sort((a, b) => a.y - b.y).map(f => f.celdas.sort((a, b) => a.x - b.x).map(c => c.t).join('  '));
}
export async function lineasDelPdf(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const lineas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pag = await doc.getPage(p);
    lineasDePagina((await pag.getTextContent()).items, pag.getViewport({ scale: 1 }).transform).forEach(l => lineas.push(l));
  }
  return lineas;
}

// Qué es cada línea y quién la paga (igual que el servidor, sfCotTipo)
export function tipoDe(inst) {
  const t = String(inst || '').toUpperCase();
  if (/SEGURO SOCIAL|\(SIS\)/.test(t)) return { tipo: 'Seguro social', cargo: 'Empleador' };
  if (/SEGURIDAD LABORAL|\bISL\b|MUTUAL|ACHS|\bIST\b/.test(t)) return { tipo: 'Accidentes', cargo: 'Empleador' };
  if (/\(AFC\)|CESANT/.test(t)) return { tipo: 'AFC', cargo: 'Mixto' };
  if (/FONASA|ISAPRE|SALUD|BANMEDICA|COLMENA|CONSALUD|CRUZ BLANCA|MASVIDA|VIDA TRES|ESENCIAL/.test(t)) return { tipo: 'Salud', cargo: 'Trabajador' };
  if (/COTIZACION OBLIGATORIA|AHORRO|APV|CUENTA 2|VOLUNTARI/.test(t)) return { tipo: 'AFP', cargo: 'Trabajador' };
  return { tipo: 'Otro', cargo: 'Otro' };
}

const pesosNum = s => Number(String(s || '').replace(/[^0-9]/g, '')) || 0;
const RE_LINEA = /^(.+?)\s{2,}([A-Za-zÁÉÍÓÚáéíóú]+\s+\d{4})\s+(REM|GRA|RET|LEY)\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{6,20})\s*$/;

// De las líneas a { periodo, fechaPago, trabajadores: [{ rut, nombre, lineas: [...] }], avisos }
export function leer(lineas) {
  const texto = lineas.join('\n');
  if (!/Certificado de Pagos de Cotizaciones Previsionales/i.test(texto)) throw new Error('No parece un certificado de cotizaciones de Previred.');
  const bloques = texto.split(/Certificado de Pagos de Cotizaciones Previsionales/i).slice(1);
  const porRut = {}, avisos = [], periodos = new Set(), fechas = new Set();
  bloques.forEach((b, n) => {
    const m = b.replace(/\s+/g, ' ').match(/Sr\.\(a\)\s+(.+?),\s*Rut:\s*([\d.]+-[\dkK])/);
    if (!m) { avisos.push(`Certificado ${n + 1}: no se encontró el nombre y RUT del trabajador.`); return; }
    const rut = m[2].toUpperCase(), nombre = m[1].trim();
    const t = porRut[rut] || (porRut[rut] = { rut, nombre, lineas: [] });
    let tabla = 0, leidas = 0;
    b.split('\n').forEach(l => {
      const r = l.trim().match(RE_LINEA);
      if (/\$/.test(l) && /\d{2}\/\d{2}\/\d{4}/.test(l)) tabla++;   // toda línea con montos y fecha cuenta, se lea o no
      if (!r) return;
      leidas++;
      const [mesTxt, anio] = r[2].toLowerCase().split(/\s+/);
      const mes = MESES.indexOf(mesTxt.normalize('NFD').replace(/[̀-ͯ]/g, ''));
      if (mes < 0) { avisos.push(`${nombre}: mes "${r[2]}" no reconocido.`); return; }
      const periodo = `${anio}-${String(mes + 1).padStart(2, '0')}`, [d, mm, y] = r[6].split('/');
      periodos.add(periodo); fechas.add(`${y}-${mm}-${d}`);
      t.lineas.push({ institucion: r[1].replace(/\s+/g, ' ').trim(), periodo, tipoPago: r[3], imponible: pesosNum(r[4]), monto: pesosNum(r[5]), fechaPago: `${y}-${mm}-${d}`, folio: r[7], ...tipoDe(r[1]) });
    });
    // Cada línea de la tabla con montos debe haberse leído: si no, se avisa (nunca se descarta en silencio)
    if (tabla !== leidas) avisos.push(`${nombre}: el PDF tiene ${tabla} líneas con montos y se leyeron ${leidas}. Revisa este trabajador.`);
  });
  const trabajadores = Object.values(porRut).map(t => ({ ...t, total: t.lineas.reduce((s, l) => s + l.monto, 0) })).filter(t => t.lineas.length);
  if (!trabajadores.length) throw new Error('No se encontraron líneas de cotizaciones en el PDF.');
  if (periodos.size > 1) throw new Error(`El PDF trae varios períodos (${[...periodos].join(', ')}): descarga uno por mes.`);
  if (fechas.size > 1) avisos.push(`Hay varias fechas de pago (${[...fechas].join(', ')}); se usa la más reciente.`);
  // bloquea: cualquier aviso menos el de varias fechas de pago (ahí solo se usa la más reciente)
  return { periodo: [...periodos][0], fechaPago: [...fechas].sort().pop(), trabajadores, avisos, bloquea: avisos.some(a => !/varias fechas de pago/.test(a)) };
}

// ═══ v0.67.0 · Comprobante de pago de Previred (lo que pagó la empresa, con intereses y multas) ═══
// v0.67.3 · UN solo lector para todos los formatos (no uno por situación):
//  · cada sección se reconoce por su título, en cualquier orden (el de agosto trae primero el ISL; el de septiembre, las AFP);
//    el título de la AFP puede decir "…PREVISIONALES FONDO DE PENSIONES…" o "…PREVISIONALES Y DEPOSITOS DE AHORRO VOLUNTARIO
//    FONDO DE PENSIONES…" (y si se corta en dos líneas, se mira la siguiente);
//  · lo opcional es opcional: las líneas de reajustes, intereses, recargos, multas y costas que no vienen valen 0 (pagado en plazo,
//    el ISL solo trae "TOTAL A PAGAR A LA MUTUAL"); las columnas de movimiento de personal y sus fechas pueden estar o no; el
//    orden de los nombres cambia;
//  · los cruces siguen estrictos: por institución, las filas de los trabajadores suman la cotización, y cotización + intereses +
//    multas = total. La cotización sale de su subtotal y, si el PDF no lo trae, de sus partes (nunca del total menos lo que falta);
//  · si algo no calza, un aviso que dice la sección y el cruce que falló (nunca un error genérico);
//  · una sección que todavía no se lee (isapre, caja de compensación u otra) bloquea con el aviso de cargar el mes con el CSV:
//    nunca se adivinan montos.
const TITULOS = [
  ['afpDet', /DETALLE DE PAGO DE COTIZACIONES PREVISIONALES\b.*FONDO DE PENSIONES/i],
  ['afpRes', /COMPROBANTE DE PAGO DE COTIZACIONES PREVISIONALES\b.*FONDO DE PENSIONES/i],
  ['islDet', /DETALLE DE COMPROBANTE PAGO DE COTIZACIONES PREVISIONALES/i],
  ['islRes', /COMPROBANTE DE PAGO DE COTIZACIONES PREVISIONALES/i],
  ['fonasa', /PLANILLA DE DECLARACION Y PAGO SIMULTANEO DE OBLIGACIONES PREVISIONALES/i],
  ['ss', /FORMULARIO DE COTIZACIONES PREVISIONALES\s*\S?\s*SEGURO SOCIAL PREVISIONAL/i]
];
// Un título que no es de los conocidos (una sección nueva: isapre, caja de compensación…): en mayúsculas, "COMPROBANTE DE PAGO…",
// "PLANILLA DE…", "FORMULARIO DE…", "DETALLE DE…"
const RE_TIT_OTRO = /^\s*(COMPROBANTE|PLANILLA|FORMULARIO|DETALLE|DECLARACI[ÓO]N)\s+DE\s+(PAGO|COTIZACI|DECLARACI|COMPROBANTE|SALUD)/;
const esMayus = l => { const t = String(l).replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ''); return t.length >= 12 && t === t.toUpperCase(); };
function tituloDe(l, sig) {
  const t = (TITULOS.find(([, re]) => re.test(l)) || [])[0] || '';
  // El título largo de la AFP cortado en dos líneas: "…PREVISIONALES Y DEPOSITOS…" / "FONDO DE PENSIONES, …"
  if ((t === 'islRes' || t === 'islDet') && /^\s*FONDO DE PENSIONES\b/i.test(String(sig || ''))) return t === 'islRes' ? 'afpRes' : (/^DETALLE DE PAGO/i.test(l.trim()) ? 'afpDet' : t);
  if (t) return t;
  return RE_TIT_OTRO.test(l) && esMayus(l) ? 'otra' : '';
}
// Isapres (y su nombre en el PDF): una sección de isapre todavía no se lee
const RE_ISAPRE = /\bISAPRE\b|BANM[EÉ]DICA|COLMENA|CONSALUD|CRUZ BLANCA|NUEVA ?MAS ?VIDA|VIDA TRES|\bESENCIAL\b|CRUZ DEL NORTE|FUNDACI[OÓ]N BANCO ?ESTADO|\bISALUD\b/i;
const RE_MUTUAL = /MUTUAL DE SEGURIDAD|\bACHS\b|ASOCIACI[OÓ]N CHILENA DE SEGURIDAD|\bIST\b|INSTITUTO DE SEGURIDAD DEL TRABAJO/i;
export const esComprobante = lineas => { const t = (lineas || []).join('\n'); return !/Certificado de Pagos de Cotizaciones Previsionales/i.test(t) && (lineas || []).some(l => (TITULOS.find(([, re]) => re.test(l)) || [])[0]); };
export const esCertificado = lineas => /Certificado de Pagos de Cotizaciones Previsionales/i.test((lineas || []).join('\n'));
const RE_RUT = /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/;
const RE_NUM = /^\$?\s?(\d{1,3}(?:\.\d{3})+|\d+)$/;
const esNum = c => RE_NUM.test(String(c).trim());
const aNum = c => Number(String(c).replace(/[^0-9]/g, '')) || 0;
const NUM = String.raw`\$?[ \t]*(\d{1,3}(?:\.\d{3})+|\d+)(?![\d,%/:])`;
const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// La cifra de un rótulo: el rótulo al inicio de la línea o después de dos espacios (otra celda), y el primer número que le sigue
// en la misma línea. null si no está.
function cifra(txt, rotulo) {
  const r = typeof rotulo === 'string' ? escRe(rotulo) : rotulo.source;
  const m = String(txt || '').match(new RegExp(String.raw`(?:^|[ \t]{2})(?:${r})[^\n\d$]*?[ \t]` + NUM, 'im'));
  return m ? aNum(m[1]) : null;
}
// Suma de cifras opcionales (las que no están valen 0)
const opc = (txt, rotulos) => rotulos.reduce((t, r) => t + (cifra(txt, r) || 0), 0);
// El trozo entre dos rótulos (incluida la línea del segundo)
function tramo(txt, desde, hasta) {
  const i = txt.search(desde); if (i < 0) return '';
  const resto = txt.slice(i), j = resto.search(hasta); if (j < 0) return '';
  const fin = resto.indexOf('\n', j);
  return resto.slice(0, fin < 0 ? resto.length : fin);
}
const MES_RE = new RegExp(String.raw`\b(${MESES.join('|')})\s+(\d{4})\b`, 'i');
const sinTildesT = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function periodoDe(txt) {
  let m = txt.match(/Per[ií]odo de Remuneraciones:\s*(\d{2})\/(\d{4})/i) || txt.match(/\bPeriodo\s+(\d{2})\/(\d{4})/i) || txt.match(/PERIODO DE REMUNERACI[ÓO]N\s+(\d{2})\s+(\d{4})/i)
    || txt.match(/^(0[1-9]|1[0-2])\s+(20\d{2})\s+\|/m);
  if (m) return `${m[2]}-${m[1]}`;
  m = sinTildesT(txt).match(MES_RE);
  return m ? `${m[2]}-${String(MESES.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}` : '';
}
// La fecha y hora del pago (el timbre de Previred): una fecha con una hora "8:12 PM" en la misma línea o hasta dos líneas después
function pagosDe(lineas) {
  const out = [];
  lineas.forEach((l, i) => {
    const f = l.match(/(\d{2})\/(\d{2})\/(\d{4})(?!.*\d{2}\/\d{2}\/\d{4})/);
    if (!f) return;
    const cerca = [l.slice(l.indexOf(f[0]) + f[0].length)].concat(lineas.slice(i + 1, i + 3)).join('\n'), h = cerca.match(/(\d{1,2}:\d{2})\s*([AP]M)/i);
    if (h) out.push({ fecha: `${f[3]}-${f[2]}-${f[1]}`, hora: `${h[1]} ${h[2].toUpperCase()}` });
  });
  return out;
}
const folioDe = txt => { const m = txt.match(/N[úu]mero de Folio:\s*(\d{6,20})/i) || txt.match(/N[ÚU]MERO DE SERIE:\s*(\d{6,20})/i); return m ? m[1] : ''; };
const afpDe = lineas => { for (const l of lineas) { const m = l.match(/^(AFP\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s[A-Za-zÁÉÍÓÚÑáéíóúñ]+)*?)(?:\s{2,}|$)/); if (m) return m[1].trim(); } return ''; };
const mayusSin = t => sinTildesT(t).toUpperCase().replace(/\s+/g, ' ').trim();
// La primera celda de la cabecera (primeras líneas) que calza con re: el nombre de la institución
const nombreEn = (lineas, re) => { for (const l of lineas.slice(0, 10)) { const c = String(l).split(/\s{2,}/).find(x => re.test(x)); if (c) return c.trim().slice(0, 80); } return ''; };
// Una fila de trabajador: el RUT (primera o segunda celda), el nombre (las celdas de texto) y lo que sigue. null si no es fila.
function filaDe(l) {
  const c = String(l).split(/\s{2,}/).map(x => x.trim()).filter(Boolean);
  const k = c.findIndex(x => RE_RUT.test(x));
  if (k < 0 || k > 1 || (k === 1 && !/^\d{1,3}$/.test(c[0]))) return null;   // la segunda celda solo con el N° de fila antes
  const resto = c.slice(k + 1), j = resto.findIndex(esNum);
  if (j < 1) return { rut: c[k].toUpperCase(), nombre: '', celdas: resto, malo: true };
  return { rut: c[k].toUpperCase(), nombre: resto.slice(0, j).join(' ').replace(/\s+/g, ' ').trim(), celdas: resto.slice(j) };
}
// Los números seguidos desde el comienzo (paran en el primer texto: "JC", una fecha "14/09/2026")
const numsHastaTexto = celdas => { const out = []; for (const c of celdas) { if (!esNum(c)) break; out.push(aNum(c)); } return out; };
export const AVISO_SECCION_NUEVA = n => `Este PDF trae una sección que Sistema Fën todavía no lee (${n}): carga el mes con el archivo CSV de la nómina.`;

// De las líneas del comprobante a { tipoDoc: 'comprobante', periodo, fechaPago, horaPago, vence, fueraDePlazo, fueraDePlazoPor,
// instituciones: [{ clave, nombre, tipo, folio, cotizacion, intereses, multas, compensacion, total, trabajadores }],
// trabajadores (la forma de leer()), totalCotizaciones, totalRecargos, totalPagado, folios, avisos, bloquea, seccionNueva }
// intereses incluye los reajustes; multas incluye recargos y costas de cobranza. Cada cruce que no calza es un aviso que bloquea.
export function leerComprobante(lineas) {
  const L = (lineas || []).map(l => String(l || ''));
  if (!esComprobante(L)) throw new Error('No parece un comprobante de pago de Previred.');
  const secs = [];
  L.forEach((l, k) => { const t = tituloDe(l, L[k + 1]); if (t) secs.push({ tipo: t, titulo: l.trim(), lineas: [l] }); else if (secs.length) secs[secs.length - 1].lineas.push(l); });
  secs.forEach(x => {
    x.texto = x.lineas.join('\n');
    const cab = x.lineas.slice(0, 10).join('\n');
    if (x.tipo === 'fonasa') x.tipo = /ANEXOS DE DETALLE/i.test(x.texto) ? 'fonasaDet' : 'fonasaRes';
    if (x.tipo === 'ss') x.tipo = /Identificaci[óo]n del Trabajador/i.test(x.texto) ? 'ssDet' : 'ssRes';
    // ¿De qué institución es? Una isapre (aunque el título sea el de FONASA o el del ISL) o una sección que no se conoce
    if (/^fonasa/.test(x.tipo) && !/FONASA/i.test(x.texto) && RE_ISAPRE.test(x.texto)) { x.nueva = nombreEn(x.lineas.slice(1), RE_ISAPRE) || 'isapre'; }
    if (/^isl/.test(x.tipo)) {
      if (RE_ISAPRE.test(cab)) x.nueva = nombreEn(x.lineas.slice(1), RE_ISAPRE) || 'isapre';
      else if (/Instituto de Seguridad Laboral/i.test(cab)) x.inst = 'Instituto de Seguridad Laboral (ISL)';
      else if (RE_MUTUAL.test(cab)) x.inst = nombreEn(x.lineas, RE_MUTUAL);
      else x.nueva = nombreEn(x.lineas.slice(1), /^[A-Za-zÁÉÍÓÚÑáéíóúñ][^:]{3,}$/) || x.titulo.slice(0, 80);
    }
    if (x.tipo === 'otra') x.nueva = (RE_ISAPRE.test(cab) ? nombreEn(x.lineas.slice(1), RE_ISAPRE) : '') || x.titulo.slice(0, 80);
    x.folio = folioDe(x.texto); x.periodo = periodoDe(x.texto);
  });
  const avisos = [], bloquean = [], inst = [], periodos = new Set(), pagos = [];
  const blo = t => { if (!avisos.includes(t)) { avisos.push(t); bloquean.push(t); } };
  // Secciones que todavía no se leen: bloquean (no se adivinan montos)
  const nuevas = [...new Set(secs.filter(x => x.nueva).map(x => x.nueva))];
  nuevas.forEach(n => blo(AVISO_SECCION_NUEVA(n)));
  const leibles = secs.filter(x => !x.nueva);
  leibles.forEach(x => { if (x.periodo) periodos.add(x.periodo); pagosDe(x.lineas).forEach(p => pagos.push(p)); });
  const porRut = {};
  const trab = (f) => { const t = porRut[f.rut] || (porRut[f.rut] = { rut: f.rut, nombre: f.nombre, lineas: [] }); if (f.nombre.length > t.nombre.length) t.nombre = f.nombre; return t; };
  const ag = (i, f, institucion, monto, imponible) => { i.det.push({ rut: f.rut, monto }); if (monto > 0) trab(f).lineas.push({ institucion, monto, imponible, folio: i.folio, inst: i.clave }); else trab(f); };
  const nueva = (clave, nombre, tipo, folio, x) => { const i = { clave, nombre, tipo, folio, det: [], filas: 0, leidas: 0, ...x }; inst.push(i); return i; };
  const leerFilas = (sec, i, fn, nombreSec) => {
    sec.lineas.forEach(l => {
      const f = filaDe(l); if (!f) return;
      i.filas++;
      const ok = !f.malo && fn(f);
      if (ok) i.leidas++; else blo(`${nombreSec}: no se pudo leer la fila del RUT ${f.rut} (detalle por trabajador).`);
    });
  };
  const sinTotal = (n, rotulo) => blo(`${n}: no se encontró su total ("${rotulo}") en el resumen.`);
  const sinCot = (n, rotulo) => blo(`${n}: no se encontró su cotización ("${rotulo}") en el resumen.`);
  const det = (tipo, folio) => leibles.filter(y => y.tipo === tipo && y.folio === folio);
  // Accidentes del trabajo: ISL o mutual. El subtotal puede no venir (pagado en plazo, sin recargos: solo el total)
  leibles.filter(x => x.tipo === 'islRes').forEach(x => {
    const n = x.inst || 'Instituto de Seguridad Laboral (ISL)', tot = cifra(x.texto, /TOTAL (?:A )?PAGAR A LA MUTUAL/i), sub = cifra(x.texto, /SUBTOTAL A PAGAR A LA MUTUAL/i);
    const int = opc(x.texto, ['Reajustes', 'Intereses']), mu = opc(x.texto, ['Multas', /Recargos?/, /Costas( de)? Cobranza/]);
    if (tot === null) sinTotal(n, 'TOTAL A PAGAR A LA MUTUAL');
    // Sin subtotal: la cotización es lo que suman sus trabajadores (cruce aparte: más lo que falta debe dar el total)
    const i = nueva('isl-' + x.folio, n, 'Accidentes', x.folio, { cotizacion: sub, intereses: int, multas: mu, total: tot || 0 });
    const instTrab = x.inst ? mayusSin(x.inst) : 'INSTITUTO DE SEGURIDAD LABORAL (ISL)';
    det('islDet', x.folio).forEach(y => leerFilas(y, i, f => { const v = numsHastaTexto(f.celdas); if (v.length < 2) return false; ag(i, f, instTrab, v[1], v[0]); return true; }, n));
  });
  // FONASA
  leibles.filter(x => x.tipo === 'fonasaRes').forEach(x => {
    const n = 'FONASA', cot = cifra(x.texto, 'Cotiz. Legal'), int = opc(x.texto, [/Reajuste/, /Inter[ée]s/]), mu = opc(x.texto, ['Multas', /Recargos?/]), comp = cifra(x.texto, /Compensaci[óo]n Asignaci[óo]n Familiar/), tot = cifra(x.texto, 'MONTO PAGADO');
    if (tot === null) sinTotal(n, 'MONTO PAGADO');
    if (cot === null) sinCot(n, 'Cotiz. Legal');
    if (comp) blo(`FONASA descuenta ${fmtP(comp)} de compensación de asignación familiar: Sistema Fën todavía no la registra. Carga el mes con el archivo CSV de la nómina o avísame.`);
    const i = nueva('fonasa-' + x.folio, n, 'Salud', x.folio, { cotizacion: cot || 0, intereses: int, multas: mu, compensacion: comp || 0, total: tot || 0 });
    det('fonasaDet', x.folio).forEach(y => leerFilas(y, i, f => {
      const c = f.celdas; if (!esNum(c[0])) return false;
      const r = esNum(c[1]) ? c.slice(1) : c.slice(2), v = numsHastaTexto(r);
      if (v.length < 2) return false; ag(i, f, 'FONASA', v[1], v[0]); return true; }, n));
  });
  // Cada AFP: fondo de pensiones y seguro de cesantía (dos instituciones)
  const PARTES_PEN = ['Cotización Obligatoria', /Seguro Invalidez y Sobrevivencia/, /Cotizaci[óo]n Voluntaria/, /Dep[óo]sito Convenido/, /Dep[óo]sito en Cuenta de Ahorro/, /Aportes de Indemnizaci[óo]n/,
    /Cotizaci[óo]n por Trabajos Pesados/, /APV Colectivo Empleador/, /APV Colectivo Trabajador/, /Monto Capitalizaci[óo]n Voluntaria/, /Monto Ahorro Voluntario/];
  leibles.filter(x => x.tipo === 'afpRes').forEach(x => {
    const afp = afpDe(x.lineas) || 'AFP', A = mayusSin(afp), nP = afp + ' · fondo de pensiones', nC = afp + ' · seguro de cesantía';
    // Reajustes, intereses, recargos y costas: solo dentro de su resumen (si no hay resumen, no hubo: valen 0)
    const pen = tramo(x.texto, /RESUMEN DE REAJUSTE E INTERESES DEL FONDO DE PENSIONES/i, /TOTAL A PAGAR FONDO DE PENSIONES/i);
    const ces = tramo(x.texto, /RESUMEN DE REAJUSTE E INTERESES FONDO DE CESANTIA/i, /TOTAL A PAGAR AL FONDO DE CESANTIA/i);
    const totP = cifra(x.texto, /TOTAL A PAGAR FONDO DE PENSIONES/i), totC = cifra(x.texto, /TOTAL A PAGAR AL FONDO DE CESANTIA/i);
    const subP = cifra(x.texto, /Sub TOTAL A PAGAR FONDO DE PENSIONES/i), subC = cifra(x.texto, /Sub TOTAL A PAGAR AL FONDO DE CESANTIA/i);
    const oblP = cifra(x.texto, 'Cotización Obligatoria'), afilC = cifra(x.texto, /Cotizaci[óo]n Afiliados/), empC = cifra(x.texto, /Cotizaci[óo]n Empleador/);
    const cotP = subP !== null ? subP : oblP !== null ? opc(x.texto, PARTES_PEN) : null;
    const cotC = subC !== null ? subC : afilC !== null || empC !== null ? (afilC || 0) + (empC || 0) : null;
    if (totP === null) sinTotal(nP, 'TOTAL A PAGAR FONDO DE PENSIONES'); if (cotP === null) sinCot(nP, 'Cotización Obligatoria');
    if (totC === null) sinTotal(nC, 'TOTAL A PAGAR AL FONDO DE CESANTIA'); if (cotC === null) sinCot(nC, 'Cotización Afiliados y Cotización Empleador');
    const iP = nueva('afp-' + x.folio, nP, 'AFP', x.folio, { afp, cotizacion: cotP || 0, intereses: opc(pen, ['Reajustes', /Inter[ée]s y Recargo Beneficio Afiliado/, /Inter[ée]s - Reajuste/]), multas: opc(pen, [/Recargo/, /Costas Cobranza/]), total: totP || 0 });
    const iC = nueva('afc-' + x.folio, nC, 'AFC', x.folio, { afp, cotizacion: cotC || 0, intereses: opc(ces, [/Inter[ée]s - Reajuste/]), multas: opc(ces, [/Recargo/, /Costas Cobranza/]), total: totC || 0 });
    det('afpDet', x.folio).forEach(y => leerFilas(y, iP, f => {
      // Columnas: remuneración, obligatoria, SIS, APVI, [N° contrato APVI], convenido, ahorro, remuneración cesantía, afiliado,
      // empleador, [código de movimiento y sus fechas]. Con el N° de contrato vienen 11 o más números.
      let v = numsHastaTexto(f.celdas);
      if (v.length >= 11) v = v.slice(0, 4).concat(v.slice(5));
      if (v.length < 9) return false;
      const [rem, obl, sis, apvi, conv, aho, impC, afil, emp] = v;
      ag(iP, f, `${A} COTIZACION OBLIGATORIA`, obl, rem);
      if (sis > 0) ag(iP, f, `${A} (SIS)`, sis, rem);
      if (apvi + conv + aho > 0) ag(iP, f, `${A} AHORRO VOLUNTARIO`, apvi + conv + aho, rem);
      ag(iC, f, `${A} SEGURO DE CESANTIA (AFC)`, afil + emp, impC);
      return true;
    }, afp));
    iC.filas = iP.filas; iC.leidas = iP.leidas;
  });
  // Seguro Social (seguro social + rentabilidad protegida + SIS). La "Renta Imponible Anterior" (licencias) puede venir o no
  leibles.filter(x => x.tipo === 'ssRes').forEach(x => {
    const n = 'Seguro Social', tot = cifra(x.texto, 'MONTO PAGADO'), sub = cifra(x.texto, /Subtotal:?/), ssp = cifra(x.texto, 'Seguro Social Previsional');
    const cot = sub !== null ? sub : ssp !== null ? opc(x.texto, ['Seguro Social Previsional', 'Rentabilidad Protegida', /Seguro de Invalidez y Sobrevivencia/]) : null;
    if (tot === null) sinTotal(n, 'MONTO PAGADO'); if (cot === null) sinCot(n, 'Subtotal');
    const i = nueva('ss-' + x.folio, n, 'Seguro social', x.folio, { cotizacion: cot || 0, intereses: opc(x.texto, [/Inter[ée]s - Reajuste/]), multas: opc(x.texto, [/Recargo/, /Costas Cobranza/]), total: tot || 0,
      seguroSocial: ssp, rentabilidad: cifra(x.texto, 'Rentabilidad Protegida'), sis: cifra(x.texto, /Seguro de Invalidez y Sobrevivencia/) });
    det('ssDet', x.folio).forEach(y => {
      const conAnt = /Renta Imponible\s+Renta Imponible|Imponible Anterior/i.test(y.texto), k = conAnt ? 5 : 4;
      leerFilas(y, i, f => { const v = numsHastaTexto(f.celdas); if (v.length < k) return false;
        const [imp, impAnt, ss, rent, sis] = conAnt ? v : [v[0], 0, v[1], v[2], v[3]];
        ag(i, f, 'SEGURO SOCIAL PREVISIONAL', ss + rent + sis, imp || impAnt); return true; }, n);
    });
  });
  // Detalles sin su resumen (no se descarta nada en silencio)
  const RES = { islDet: 'islRes', fonasaDet: 'fonasaRes', afpDet: 'afpRes', ssDet: 'ssRes' };
  leibles.filter(x => RES[x.tipo]).forEach(y => { if (!leibles.some(x => x.tipo === RES[y.tipo] && x.folio === y.folio)) blo(`Hay un detalle sin su resumen (${y.titulo.slice(0, 60)}…, folio ${y.folio || 'sin folio'}): descarga el comprobante completo.`); });
  if (!inst.length && !nuevas.length) throw new Error('No se encontraron instituciones en el comprobante.');
  // Cruces: el detalle por trabajador suma la cotización; cotización + intereses + multas (− compensación) = total
  inst.forEach(i => {
    const sd = i.det.reduce((t, x) => t + x.monto, 0);
    if (i.cotizacion === null) i.cotizacion = sd;   // accidentes sin subtotal: lo que suman sus trabajadores (el cruce de abajo lo controla)
    else if (sd !== i.cotizacion) blo(`${i.nombre}: el detalle por trabajador suma ${fmtP(sd)} y la cotización dice ${fmtP(i.cotizacion)} (cruce: detalle = cotización).`);
    if (i.cotizacion + i.intereses + i.multas - (i.compensacion || 0) !== i.total) blo(`${i.nombre}: cotización ${fmtP(i.cotizacion)} + intereses ${fmtP(i.intereses)} + multas ${fmtP(i.multas)} no da el total ${fmtP(i.total)} (cruce: cotización + intereses + multas = total).`);
    if (i.cotizacion > 0 && !i.filas) blo(`${i.nombre}: no se encontró su detalle por trabajador.`);
    i.trabajadores = new Set(i.det.map(x => x.rut)).size;
  });
  if (periodos.size !== 1 && inst.length) blo(periodos.size ? `El comprobante trae varios períodos (${[...periodos].sort().join(', ')}): descarga uno por mes.` : 'No se encontró el período de remuneraciones.');
  const fechas = [...new Set(pagos.map(p => p.fecha))].sort();
  if (!fechas.length && inst.length) blo('No se encontró la fecha de pago (el timbre de Previred con fecha y hora).');
  if (fechas.length > 1) avisos.push(`Hay varias fechas de pago (${fechas.join(', ')}); se usa la más reciente.`);
  const periodo = [...periodos].sort().pop() || '', fechaPago = fechas[fechas.length - 1] || '', horaPago = (pagos.filter(p => p.fecha === fechaPago)[0] || {}).hora || '';
  const vence = periodo ? venceDe(periodo) : '', etiqueta = /FUERA DE PLAZO/i.test(L.join('\n'));
  const trabajadores = Object.values(porRut).map(t => ({ rut: t.rut, nombre: t.nombre, lineas: t.lineas.map(l => ({ institucion: l.institucion, periodo, tipoPago: 'REM', imponible: l.imponible, monto: l.monto, fechaPago, folio: l.folio, ...tipoDe(l.institucion) })) }))
    .map(t => ({ ...t, total: t.lineas.reduce((x, l) => x + l.monto, 0) }));
  // Un trabajador sin ningún monto (por ejemplo, licencia todo el mes sin cotizaciones): no se registra, pero se dice
  trabajadores.filter(t => !t.lineas.length).forEach(t => avisos.push(`${t.nombre || t.rut} aparece en el comprobante sin montos este mes: no se registra.`));
  const tot = k => inst.reduce((t, i) => t + (i[k] || 0), 0);
  const instituciones = inst.map(({ det, filas, leidas, ...i }) => ({ ...i, recargos: i.intereses + i.multas }));
  return { tipoDoc: 'comprobante', periodo, fechaPago, horaPago, vence, fueraDePlazo: etiqueta || (!!vence && !!fechaPago && fechaPago > vence), fueraDePlazoPor: etiqueta ? 'etiqueta' : (vence && fechaPago > vence ? 'fecha' : ''),
    instituciones, trabajadores: trabajadores.filter(t => t.lineas.length), totalCotizaciones: tot('cotizacion'), totalRecargos: tot('intereses') + tot('multas'), totalPagado: tot('total'),
    folios: [...new Set(inst.map(i => i.folio).filter(Boolean))].sort(), avisos, bloquea: bloquean.length > 0, seccionNueva: nuevas };
}
const fmtP = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
// Certificado o comprobante, según el PDF
export function leerPdf(lineas) {
  if (esCertificado(lineas)) return { tipoDoc: 'certificado', ...leer(lineas) };
  if (esComprobante(lineas)) return leerComprobante(lineas);
  throw new Error('No parece un certificado de cotizaciones de Previred ni un comprobante de pago. Sirven el "Comprobante de pago" (recomendado) o el "Certificado de Pagos de Cotizaciones Previsionales".');
}
// Clave del comprobante: el período y sus folios (el mismo PDF descargado de nuevo da la misma)
export async function claveComprobante(r) {
  const txt = 'comp#' + r.periodo + '#' + (r.folios || []).slice().sort().join(',');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return 'pc-' + [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ═══ v0.67.3 · Archivo CSV de la nómina del mes (Previred, "formato largo variable por separador") ═══
// Una fila por trabajador, campos separados por ";", sin encabezado, en UTF-8 o Latin-1. Campos (desde 1) que se usan:
// 1 RUT, 2 DV, 3 apellido paterno, 4 apellido materno, 5 nombres, 8 tipo de pago (1 = remuneraciones), 9 y 10 período desde y
// hasta (MMAAAA), 26 código AFP (si viene), 28 AFP cotización obligatoria, 29 SIS, 70 FONASA, 71 accidentes ISL (formato
// clásico), 75 código de salud (si viene), 80 y 81 isapre obligatoria y adicional, 94 Seguro Social, 95 Rentabilidad Protegida,
// 98 accidentes (ISL), 102 seguro de cesantía (AFC), 106 renta imponible.
// No trae multas ni intereses ni fecha de pago, y casi siempre no dice la AFP (código 0): la AFP sale del último mes cargado de
// ese RUT o se pregunta una vez.
export const CSV = { rut: 1, dv: 2, paterno: 3, materno: 4, nombres: 5, tipoPago: 8, desde: 9, hasta: 10, codAfp: 26, afp: 28, sis: 29, fonasa: 70, islClasico: 71, codSalud: 75, isapreObl: 80, isapreAdic: 81, ss: 94, rp: 95, isl: 98, afc: 102, imponible: 106 };
export const AFPS = ['AFP CAPITAL', 'AFP CUPRUM', 'AFP HABITAT', 'AFP MODELO', 'AFP PLANVITAL', 'AFP PROVIDA', 'AFP UNO'];
const COD_AFP = { 3: 'AFP CUPRUM', 5: 'AFP HABITAT', 8: 'AFP PROVIDA', 29: 'AFP PLANVITAL', 33: 'AFP CAPITAL', 34: 'AFP MODELO', 35: 'AFP UNO' };
const COD_SALUD = { 1: 'ISAPRE BANMEDICA', 2: 'ISAPRE CONSALUD', 3: 'ISAPRE VIDA TRES', 4: 'ISAPRE COLMENA', 5: 'ISAPRE CRUZ BLANCA', 10: 'ISAPRE NUEVA MASVIDA', 11: 'ISAPRE DE CODELCO', 12: 'ISAPRE BANCO ESTADO', 25: 'ISAPRE CRUZ DEL NORTE', 28: 'ISAPRE ESENCIAL' };
// Conceptos del CSV: código del folio (dos dígitos), la línea que se registra (con la misma forma que el certificado y el comprobante)
const CONCEPTOS = { afp: '01', sis: '02', salud: '03', ss: '04', isl: '05', afc: '06' };
// Texto del archivo: UTF-8 si se puede leer así; si no, Latin-1 (Windows-1252)
export function textoDeArchivo(buf) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); } }
const filasCsv = t => String(t || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()).map(l => l.split(';'));
const campoCsv = (f, k) => String(f[CSV[k] - 1] == null ? '' : f[CSV[k] - 1]).trim();
// ¿Es el CSV de la nómina? Filas con ";" y unos 105–106 campos, con RUT, dígito y período
export function esCsvNomina(texto) {
  const F = filasCsv(texto).slice(0, 60);
  return F.length > 0 && F.every(f => f.length >= 100 && f.length <= 110) && F.some(f => /^\d{6,8}$/.test(campoCsv(f, 'rut')) && /^[\dkK]$/.test(campoCsv(f, 'dv')) && /^(0[1-9]|1[0-2])\d{4}$/.test(campoCsv(f, 'desde')));
}
const dvDe = cuerpo => { let s = 0, m = 2; for (const c of String(cuerpo).split('').reverse()) { s += Number(c) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); };
const rutConPuntos = (cuerpo, dv) => String(Number(cuerpo)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
// El folio de una línea del CSV (no hay folio real): período + concepto + RUT. Estable: subir el mismo CSV da las mismas claves.
export const folioCsv = (periodo, rut, concepto) => String(periodo).replace('-', '') + CONCEPTOS[concepto] + String(rut).toUpperCase().replace(/[^0-9K]/g, '').replace(/K$/, '0').padStart(9, '0');
// De las filas a { tipoDoc: 'csv', periodo, trabajadores: [{ rut, nombre, imponible, c: { afp, sis, salud, ss, isl, afc }, salud, afpCsv,
// necesitaAfp, total }], totales, avisos, bloquea }. Las líneas por trabajador se arman con su AFP (lineasCsv / conAfps).
export function leerCsv(texto) {
  const F = filasCsv(texto);
  if (!F.length || !esCsvNomina(texto)) throw new Error('No parece el archivo CSV de la nómina de Previred (filas con ";" y unos 105 campos, con RUT y período).');
  const avisos = [], bloquean = [], periodos = new Set(), vistos = new Set(), trabajadores = [];
  const blo = t => { avisos.push(t); bloquean.push(t); };
  const num = (f, k, fila) => { const v = campoCsv(f, k); if (v === '') return 0; if (!/^-?\d+$/.test(v)) { blo(`Fila ${fila}: el campo ${CSV[k]} (${k}) no es un número ("${v.slice(0, 12)}").`); return 0; } return Number(v); };
  F.forEach((f, i) => {
    const fila = i + 1;
    if (f.length < 100 || f.length > 110) { blo(`Fila ${fila}: tiene ${f.length} campos (se esperan 105 o 106).`); return; }
    const cuerpo = campoCsv(f, 'rut'), dv = campoCsv(f, 'dv').toUpperCase();
    if (!/^\d{6,8}$/.test(cuerpo) || dvDe(cuerpo) !== dv) { blo(`Fila ${fila}: el RUT ${cuerpo}-${dv} no es válido (dígito verificador).`); return; }
    const rut = rutConPuntos(cuerpo, dv), nombre = [campoCsv(f, 'paterno'), campoCsv(f, 'materno'), campoCsv(f, 'nombres')].filter(Boolean).join(' ').replace(/\s+/g, ' ').toUpperCase();
    const tp = campoCsv(f, 'tipoPago');
    if (tp !== '1') { blo(`Fila ${fila} (${nombre || rut}): tipo de pago ${tp || 'vacío'} (no es remuneración del mes): Sistema Fën todavía no lo lee. Carga el mes con el comprobante de pago en PDF.`); return; }
    const d = campoCsv(f, 'desde'), h = campoCsv(f, 'hasta') || d;
    if (!/^(0[1-9]|1[0-2])\d{4}$/.test(d) || d !== h) { blo(`Fila ${fila} (${nombre || rut}): el período "${d}" a "${h}" no es de un solo mes.`); return; }
    periodos.add(`${d.slice(2)}-${d.slice(0, 2)}`);
    if (vistos.has(rut)) { blo(`El RUT ${rut} viene dos veces en el CSV.`); return; }
    vistos.add(rut);
    const codSalud = num(f, 'codSalud', fila), isapre = codSalud && codSalud !== 7 ? num(f, 'isapreObl', fila) + num(f, 'isapreAdic', fila) : 0;
    const c = { afp: num(f, 'afp', fila), sis: num(f, 'sis', fila), salud: num(f, 'fonasa', fila) + isapre, ss: num(f, 'ss', fila) + num(f, 'rp', fila), isl: num(f, 'isl', fila) + num(f, 'islClasico', fila), afc: num(f, 'afc', fila) };
    const total = Object.values(c).reduce((a, b) => a + b, 0), codAfp = num(f, 'codAfp', fila);
    if (Object.values(c).some(v => v < 0)) { blo(`Fila ${fila} (${nombre}): trae un monto negativo.`); return; }
    if (!total) { avisos.push(`${nombre} aparece en el CSV sin montos este mes: no se registra.`); return; }
    trabajadores.push({ rut, nombre, imponible: num(f, 'imponible', fila), c, salud: isapre && !num(f, 'fonasa', fila) ? (COD_SALUD[codSalud] || `ISAPRE (código ${codSalud})`) : 'FONASA',
      afpCsv: COD_AFP[codAfp] || '', necesitaAfp: c.afp + c.afc > 0, total });
  });
  if (periodos.size > 1) blo(`El CSV trae varios períodos (${[...periodos].sort().join(', ')}): descarga uno por mes.`);
  if (!trabajadores.length && !bloquean.length) throw new Error('El CSV no trae trabajadores con montos.');
  const sum = k => trabajadores.reduce((t, x) => t + x.c[k], 0);
  const totales = { afp: sum('afp'), sis: sum('sis'), salud: sum('salud'), ss: sum('ss'), isl: sum('isl'), afc: sum('afc'), imponible: trabajadores.reduce((t, x) => t + x.imponible, 0) };
  totales.total = totales.afp + totales.sis + totales.salud + totales.ss + totales.isl + totales.afc;
  return { tipoDoc: 'csv', periodo: [...periodos][0] || '', fechaPago: '', trabajadores, totales, avisos, bloquea: bloquean.length > 0 };
}
// Las líneas de un trabajador del CSV, con su AFP (la misma forma que leer() y leerComprobante()):
// AFP → AFP/Trabajador; SIS y Seguro Social (+ rentabilidad) → Seguro social/Empleador; salud → Salud/Trabajador;
// ISL → Accidentes/Empleador; AFC → AFC/Mixto. Sin las de $0.
export function lineasCsv(periodo, t, afp, fechaPago = '') {
  const A = mayusSin(afp || t.afpCsv || ''), L = [];
  const ag = (concepto, institucion, monto) => { if (monto > 0) L.push({ institucion, periodo, tipoPago: 'REM', imponible: t.imponible, monto, fechaPago, folio: folioCsv(periodo, t.rut, concepto), ...tipoDe(institucion) }); };
  ag('afp', `${A} COTIZACION OBLIGATORIA`, t.c.afp);
  ag('sis', 'SEGURO DE INVALIDEZ Y SOBREVIVENCIA (SIS)', t.c.sis);
  ag('salud', t.salud || 'FONASA', t.c.salud);
  ag('ss', 'SEGURO SOCIAL PREVISIONAL', t.c.ss);
  ag('isl', 'INSTITUTO DE SEGURIDAD LABORAL (ISL)', t.c.isl);
  ag('afc', `${A} SEGURO DE CESANTIA (AFC)`, t.c.afc);
  return L;
}
// La AFP de cada trabajador: la elegida, la del CSV (si trae el código) o la del último mes cargado. afps: { rutN → 'AFP …' }
export const rutN = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '');
export function conAfps(r, afps, fechaPago = '') {
  r.trabajadores.forEach(t => {
    t.afp = t.afp || t.afpCsv || (afps || {})[rutN(t.rut)] || '';
    t.faltaAfp = t.necesitaAfp && !t.afp;
    t.lineas = t.faltaAfp ? [] : lineasCsv(r.periodo, t, t.afp, fechaPago);
  });
  return r;
}
// La AFP de una línea ya cargada ("AFP UNO COTIZACION OBLIGATORIA", "AFP MODELO SEGURO DE CESANTIA (AFC)", "A.F.P. CAPITAL S.A.")
export function afpDeInstitucion(inst) {
  const t = mayusSin(inst).replace(/A\.F\.P\.?/g, 'AFP');
  const k = AFPS.find(a => new RegExp('\\b' + a.slice(4) + '\\b').test(t) && /\bAFP\b/.test(t));
  return k || '';
}

export const nombreMes = periodo => { const [a, m] = String(periodo).split('-'); return `${MESES[+m - 1]} ${a}`; };
export const resumen = t => {
  const s = f => t.lineas.filter(f).reduce((x, l) => x + l.monto, 0);
  return { afp: s(l => l.tipo === 'AFP'), salud: s(l => l.tipo === 'Salud'), afc: s(l => l.tipo === 'AFC'), empleador: s(l => l.cargo === 'Empleador'), otro: s(l => l.tipo === 'Otro'), imponible: Math.max(0, ...t.lineas.map(l => l.imponible)) };
};
export const clave = (periodo, t, l) => [periodo, t.rut.toUpperCase(), l.institucion.toUpperCase(), l.tipoPago, l.folio].join('|');

const base64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file); });
// v0.51.0: también el período y la fecha de pago (con la base nueva, para saber a qué vencimiento va; el script los ignora)
export const estado = (periodo, trabajadores, fechaPago) => llamar('cot_estado', { claves: trabajadores.flatMap(t => t.lineas.map(l => clave(periodo, t, l))), periodo, fechaPago: fechaPago || '' });
// Clave del envío según el contenido: el mismo lote siempre lleva la misma (reabrirlo no la cambia)
export async function claveDeEnvio(periodo, trabajadores) {
  const txt = periodo + '#' + trabajadores.flatMap(t => t.lineas.map(l => clave(periodo, t, l))).sort().join(';');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return 'prev-' + [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function registrar(datos, file, idem) {
  // v0.67.3: el CSV de la nómina solo con la base nueva (marca csv: sus líneas quedan con deCsv)
  if (datos && datos.csv && !(await Gastos.enBase())) throw new Error('El CSV de la nómina se guarda con Gastos en la base nueva (Gastos → Configuración → Base nueva).');
  const r = await llamar('cot_registrar', { ...datos, archivoBase64: file && file.size <= 8 * 1024 * 1024 ? await base64(file) : '', nombreArchivo: file ? file.name : '' }, idem);
  Gastos.olvidarTodo();
  return r;
}
export const lista = () => llamar('cot_lista');
// v0.67.0 · Mes que ya tiene sus cotizaciones (certificado): solo las multas e intereses y el comprobante en la planilla (solo con la base nueva)
export async function registrarComprobante(datos, file, idem) {
  if (!(await Gastos.enBase())) throw new Error('El comprobante de Previred se guarda con Gastos en la base nueva.');
  const r = await Gastos.cotBase('cot_comprobante', { ...datos, archivoBase64: file && file.size <= 8 * 1024 * 1024 ? await base64(file) : '', nombreArchivo: file ? file.name : '' }, idem);
  Gastos.olvidarTodo();
  return r;
}
export async function quitarComprobante(periodo, motivo, idem) { const r = await Gastos.cotBase('cot_quitar_comprobante', { periodo, motivo }, idem); Gastos.olvidarTodo(); return r; }
// v0.67.3 · Quitar la diferencia del banco registrada como multas e intereses (anula el gasto; la planilla vuelve a sus cotizaciones)
// v0.67.5 · Cambiar el reparto de un trabajador en un mes ya cargado (y, si se pide, en sus otros meses). Solo con la base nueva.
export async function cambiarReparto(datos, idem) { const r = await Gastos.cotBase('cot_reparto', datos, idem); Gastos.olvidarTodo(); return r; }
export async function quitarDifMultas(periodo, motivo, idem) { const r = await Gastos.cotBase('cot_quitar_dif', { periodo, motivo }, idem); Gastos.olvidarTodo(); return r; }
