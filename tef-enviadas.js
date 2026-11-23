// ═══════════════════════════════════════════════
//  Sistema Fën — Transferencias ENVIADAS (BancoEstado)  v0.64.0 (reglas puras, sin red)
//  El archivo "TefSimpleConsultaEnviadas_<rut>_<fecha>.xlsx" de BancoEstado trae lo que la cartola no tiene de un cargo
//  por transferencia: a quién se pagó (nombre completo y RUT), su banco y cuenta, la hora y el concepto que escribiste.
//  · Hoja "Encabezado": filas rótulo / valor ('Cuenta Origen' → '53372177809 | Chequera Electrónica', 'Fecha Desde',
//    'Fecha Hasta' dd/mm/aaaa, 'Estado' 'Autorizadas').
//  · Hoja "Transferencias": encabezado N° de Operación · Fecha de Ejecución ('13/10/2026 21:49') · Rut Destino
//    ('77.909.122-8') · Nombre Destino · Cuenta Destino · Banco Destino · Concepto · Monto (número); filas vacías al final.
//  Se reconoce por los encabezados (en cualquier hoja y fila), no por el nombre del archivo.
//  Cruce con los CARGOS de la cartola: misma cuenta (últimos dígitos de la cuenta de origen), mismo monto exacto y la
//  ventana de la v0.63.4 (desde 1 día antes hasta 3 días hábiles después; feriados-cl.js). Una transferencia nunca queda
//  en dos cargos: se asigna primero el par más cercano de todos.
// ═══════════════════════════════════════════════
import { distanciaTef } from './feriados-cl.js?v=0.138.0';

const s = v => String(v == null ? '' : v);
export const norm = t => s(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const normRut = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
// "77.909.122-8" (con puntos y guion) desde lo que venga
export const rutTexto = r => { const x = normRut(r); if (x.length < 2) return s(r); const c = x.slice(0, -1), dv = x.slice(-1); return c.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv; };
const monto = v => { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return Math.round(v); const n = parseFloat(s(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : Math.round(n); };
const pad = n => String(n).padStart(2, '0');
function fechaHora(x) {
  if (x instanceof Date && !isNaN(x)) return { f: `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`, h: x.getHours() || x.getMinutes() ? `${pad(x.getHours())}:${pad(x.getMinutes())}` : '' };
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s(x));
  return m ? { f: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, h: m[4] ? `${pad(m[4])}:${m[5]}` : '' } : { f: '', h: '' };
}
// Encabezado de la tabla de enviadas: necesita RUT de destino, monto y fecha
export const COLS_ENV = { op: ['N DE OPERACION', 'N OPERACION', 'NRO OPERACION', 'NUMERO DE OPERACION', 'NUMERO OPERACION', 'OPERACION'], fecha: ['FECHA DE EJECUCION', 'FECHA EJECUCION', 'FECHA'],
  rut: ['RUT DESTINO', 'RUT DE DESTINO', 'RUT DESTINATARIO', 'RUT BENEFICIARIO'], nombre: ['NOMBRE DESTINO', 'NOMBRE DE DESTINO', 'NOMBRE DESTINATARIO', 'NOMBRE BENEFICIARIO'],
  cuenta: ['CUENTA DESTINO', 'CUENTA DE DESTINO'], banco: ['BANCO DESTINO', 'BANCO DE DESTINO'], concepto: ['CONCEPTO', 'GLOSA', 'MENSAJE', 'COMENTARIO'], monto: ['MONTO', 'MONTO TRANSFERIDO'] };
export function encabezadoEnviadas(fila) {
  const n = (fila || []).map(norm), idx = {};
  Object.entries(COLS_ENV).forEach(([k, al]) => { const i = n.findIndex(x => al.includes(x)); if (i >= 0) idx[k] = i; });
  return idx.rut !== undefined && idx.monto !== undefined && idx.fecha !== undefined ? idx : null;
}
// La cuenta de origen: '53372177809 | Chequera Electrónica' → { numero, tipo: chequera | cc, fin: últimos 4 }
export function cuentaOrigen(txt) {
  const t = s(txt), numero = (t.match(/\d{6,}/) || [''])[0], tipo = /corriente/i.test(t) ? 'cc' : 'chequera';
  return { numero, tipo, fin: numero.slice(-4), texto: t.trim().slice(0, 80) };
}
const rotulo = (filas, et) => { for (const f of filas) { if (norm(f[0]) === norm(et)) { const v = f.find((c, i) => i > 0 && s(c).trim()); if (v !== undefined) return v; } } return ''; };
// wb: libro leído con SheetJS. null si no es el archivo de transferencias enviadas.
// Devuelve { cuenta: { numero, tipo, fin, texto }, desde, hasta, estado, filas: [{ op, fecha, hora, rut, rutTxt, nombre, cuentaDest, banco, concepto, monto }] }
export function leerEnviadas(wb, XLSX) {
  let enc = [];
  const hojaEnc = (wb.SheetNames || []).find(n => norm(n) === 'ENCABEZADO');
  if (hojaEnc) enc = XLSX.utils.sheet_to_json(wb.Sheets[hojaEnc], { header: 1, defval: '' });
  for (const nombre of wb.SheetNames || []) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' });
    const h = filas.slice(0, 40).findIndex(f => encabezadoEnviadas(f));
    if (h < 0) continue;
    const ix = encabezadoEnviadas(filas[h]), v = (r, k) => (ix[k] === undefined ? '' : r[ix[k]]);
    // El encabezado puede venir en la misma hoja, arriba de la tabla
    const rotulos = enc.length ? enc : filas.slice(0, h);
    const cuenta = cuentaOrigen(rotulo(rotulos, 'Cuenta Origen'));
    const lista = filas.slice(h + 1).map(r => {
      const fh = fechaHora(v(r, 'fecha')), rut = normRut(v(r, 'rut'));
      return { op: s(v(r, 'op')).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 20), fecha: fh.f, hora: fh.h, rut, rutTxt: s(v(r, 'rut')).trim().slice(0, 14) || rutTexto(rut),
        nombre: s(v(r, 'nombre')).trim().replace(/\s+/g, ' ').slice(0, 80), cuentaDest: s(v(r, 'cuenta')).trim().slice(0, 30), banco: s(v(r, 'banco')).trim().slice(0, 40),
        concepto: s(v(r, 'concepto')).trim().replace(/\s+/g, ' ').slice(0, 120), monto: monto(v(r, 'monto')) };
    }).filter(t => t.fecha && t.monto > 0 && (t.rut || t.nombre));
    return { cuenta, desde: fechaHora(rotulo(rotulos, 'Fecha Desde')).f, hasta: fechaHora(rotulo(rotulos, 'Fecha Hasta')).f, estado: s(rotulo(rotulos, 'Estado')).trim().slice(0, 40), filas: lista };
  }
  return null;
}
// Id del documento: tef_enviadas/{cuenta}_{operación} (sin operación: fecha, hora, monto y RUT). Subir el mismo archivo no repite.
export const idEnviada = (cuentaNum, t) => `${s(cuentaNum).replace(/\D/g, '') || 'x'}_${t.op || [t.fecha, s(t.hora).replace(':', ''), t.monto, t.rut].join('-')}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
// Solo los últimos 180 días
export const DIAS_GUARDAR = 180;

// ── Cruce con los cargos ──
// El cargo de la cartola y la transferencia son de la misma cuenta: mismo tipo y, si los dos lo traen, los mismos últimos 4 dígitos
export const mismaCuenta = (c, t) => (s(c.cuenta) || 'chequera') === (s(t.cuentaTipo) || 'chequera') && (!s(c.cuentaN) || !s(t.cuentaFin) || s(c.cuentaN).slice(-4) === s(t.cuentaFin).slice(-4));
const PREF = /^(TEF( A)?( RUT)?|TRANSF(ERENCIA)?( A)?|PAGO( A)?)\s+/;
const nombreCalza = (c, t) => { const g = norm(c.descripcion).replace(PREF, '').replace(/\d+/g, ' ').trim(), n = norm(t.nombre); return !!(g && n && g.length >= 4 && (n.startsWith(g.slice(0, 12)) || g.startsWith(n.slice(0, 12)))); };
// cargos: [{ id, fecha, monto, cuenta, cuentaN, descripcion }]; tefs: [{ id, fecha, monto, cuentaTipo, cuentaFin, nombre, … }].
// Devuelve Map(cargo.id → transferencia).
export function asignarEnviadas(cargos, tefs) {
  const out = new Map(), libres = new Set(tefs || []), porMonto = new Map();
  libres.forEach(t => { const k = String(t.monto); if (!porMonto.has(k)) porMonto.set(k, []); porMonto.get(k).push(t); });
  const cands = new Map();
  (cargos || []).forEach(c => {
    const l = (porMonto.get(String(c.monto)) || []).filter(t => mismaCuenta(c, t)).map(t => ({ t, d: distanciaTef(t.fecha, c.fecha) })).filter(x => x.d !== null);
    if (l.length) cands.set(c, l);
  });
  for (;;) {
    let mejor = null;
    [...cands.keys()].forEach((c, orden) => {
      const l = cands.get(c).filter(x => libres.has(x.t));
      if (!l.length) { cands.delete(c); return; }
      const dmin = Math.min(...l.map(x => x.d)), tramo = l.filter(x => x.d === dmin);
      let elegida = null, porNombre = false;
      const mismoRut = l2 => l2.every(x => x.t.rut && x.t.rut === l2[0].t.rut);
      if (tramo.length === 1 || mismoRut(tramo)) { elegida = tramo[0].t; porNombre = nombreCalza(c, elegida); }
      else { const n = tramo.filter(x => nombreCalza(c, x.t)); if (n.length === 1 || (n.length > 1 && mismoRut(n))) { elegida = n[0].t; porNombre = true; } }
      if (!elegida) return;
      const clave = [dmin, porNombre ? 0 : 1, orden];
      if (!mejor || clave[0] < mejor.clave[0] || (clave[0] === mejor.clave[0] && (clave[1] < mejor.clave[1] || (clave[1] === mejor.clave[1] && clave[2] < mejor.clave[2])))) mejor = { c, t: elegida, clave };
    });
    if (!mejor) break;
    out.set(mejor.c.id, mejor.t); libres.delete(mejor.t); cands.delete(mejor.c);
  }
  return out;
}
// "Pagaste a: NOMBRE · RUT 77.909.122-8 · Banco · 21:49 · concepto"
export function textoPagaste(t) {
  if (!t) return '';
  return 'Pagaste a: ' + [t.nombre || 'sin nombre', t.rut ? 'RUT ' + (t.rutTxt || rutTexto(t.rut)) : '', t.banco, t.hora, t.concepto ? '«' + t.concepto + '»' : ''].filter(Boolean).join(' · ');
}
// Vista de un documento guardado (tef_enviadas/{id})
export const vistaEnviada = (id, d) => ({ id, op: s(d.op), fecha: s(d.fecha).slice(0, 10), hora: s(d.hora), rut: normRut(d.rut), rutTxt: s(d.rutTxt), nombre: s(d.nombre), banco: s(d.banco), cuentaDest: s(d.cuentaDest),
  concepto: s(d.concepto), monto: Number(d.monto) || 0, cuentaTipo: s(d.cuentaTipo) || 'chequera', cuentaFin: s(d.cuentaFin), cuentaNum: s(d.cuentaNum), archivo: s(d.archivo), subida: s(d.subida) });
