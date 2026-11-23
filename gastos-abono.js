// ═══════════════════════════════════════════════
//  Sistema Fën — Área de cada abono (obligaciones libres: sueldos líquidos)  v0.63.1 (reglas puras, sin red)
//  Antes, cada abono tomaba el área (o el reparto) de la obligación: el sueldo de UNA persona abonado a
//  "REMUNERACION LIQUIDO" quedaba repartido entre áreas. Ahora cada abono lleva su propia área o reparto en %.
//  · claveDestinatario: a quién va el abono. Con la cartola, el RUT o la glosa del cargo (la misma clave de lo
//    aprendido: claveDe); a mano, el texto "Para quién". Id del documento en abono_destinatarios.
//  · trabajadorDe: el trabajador de Previred (cotiz_trabajadores) por RUT o por nombre (al menos 2 palabras del
//    nombre en el texto, y uno solo).
//  · areasPorDefecto: (a) lo recordado para ese destinatario, (b) el área de Previred del trabajador,
//    (c) el área o el reparto de la obligación.
//  · validarAreas / vistaConAreas: el reparto elegido (en %, suma 100) y las líneas del gasto (montos que suman exacto).
//  · v0.67.5 · Un solo reparto por persona, compartido con Previred: montosPorAreas (una sola regla para partir un monto: suma
//    exacta, el resto de los redondeos al % más grande), repartoTrabajador (cotiz_trabajadores.areas, o su área sola),
//    destinatarioDeTrabajador (el abono de la misma persona: por RUT o por nombre) y elegirReparto (lo más nuevo por fecha
//    entre lo guardado en Previred y en abonos; cada lado guarda solo en lo suyo).
// ═══════════════════════════════════════════════
import { claveDe, norm, rutNorm } from './gastos-cartola.js?v=0.138.0';

const s = v => String(v == null ? '' : v);
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const x = Number(s(v).replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(x) ? x : 0; };
export const MAX_AREAS = 4;
export const FUENTES = { recordado: 'Recordado para este destinatario', previred: 'Área de Previred', obligacion: 'Área de la cuenta recurrente', elegido: 'Elegido' };

// ── Clave del destinatario ──
// x = { rut, descripcion, nombre }. Devuelve { clave, id, nombre } o null si no hay nada con qué reconocerlo.
export function claveDestinatario(x) {
  const o = x || {}, rut = rutNorm(o.rut), desc = s(o.descripcion).trim(), nom = norm(o.nombre);
  let clave = '';
  if (rut.length >= 7) clave = 'rut:' + rut;
  else if (desc) clave = claveDe(desc);
  else if (nom.length >= 3) clave = 'nom:' + nom.slice(0, 80);
  if (!clave || clave === 'txt:') return null;
  return { clave, id: idDestinatario(clave), nombre: s(o.nombre).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80).replace(/^[=+\-@\s]+/, '') };
}
// Id de Firestore (sin "/" ni puntos): "ad-rut-12345678K", "ad-txt-TRANSF_A_LUCIA_VELASQUEZ"
export const idDestinatario = clave => 'ad-' + s(clave).replace(':', '-').replace(/[^A-Za-z0-9#-]/g, '_').replace(/#/g, 'N').slice(0, 140);

// Lo recordado para un destinatario: por su clave; si no, por el mismo nombre (lo recordado desde la cartola
// sirve para el abono a mano "Para quién", y al revés)
export function recordadoDe(lista, dest, nombre) {
  const L = Array.isArray(lista) ? lista : [];
  const r = dest ? L.find(x => x && x.clave === dest.clave) : null;
  if (r) return r;
  const n = norm(nombre);
  return n.length >= 3 ? L.find(x => x && norm(x.nombre) === n) || null : null;
}

// ── Trabajador de Previred ──
// trabajadores: [{ rut, nombre, area }] (cotiz_trabajadores). texto: glosa del cargo o "Para quién".
const palabras = t => norm(t).split(' ').filter(w => w.length >= 3);
export function trabajadorDe(trabajadores, texto, rut) { return buscarPersona((trabajadores || []).filter(t => t && s(t.area)), texto, rut); }
function buscarPersona(L, texto, rut) {
  const r = rutNorm(rut);
  if (r) { const t = L.find(x => rutNorm(x.rut) === r); if (t) return t; }
  const w = new Set(palabras(texto));
  if (w.size < 2) return null;
  let mejor = null, n = 0, empate = false;
  L.forEach(t => {
    const p = palabras(t.nombre); if (p.length < 2) return;
    const k = p.filter(x => w.has(x)).length;
    if (k < 2) return;
    if (k > n) { mejor = t; n = k; empate = false; } else if (k === n) empate = true;
  });
  return empate ? null : mejor;
}

// ── Área de la obligación como reparto en % ──
// v: vencimiento (vistaVencimiento o vencimientosAbiertos): area, pArea1..3/pPct1..3, multiArea [{ area, monto }]
export function areasDeObligacion(v) {
  const x = v || {};
  if (x.area === 'PRORRATEADO' && x.pArea1) {
    const l = [1, 2, 3].map(k => ({ area: s(x['pArea' + k]), pct: Math.round(num(x['pPct' + k])) })).filter(a => a.area && a.pct > 0);
    if (l.length) return l;
  }
  const ma = Array.isArray(x.multiArea) ? x.multiArea : [];
  if (ma.length) {
    const tot = ma.reduce((t, a) => t + num(a.monto), 0);
    if (tot > 0) {
      let resto = 100;
      const l = ma.map((a, i) => { const p = i === ma.length - 1 ? resto : Math.round(num(a.monto) * 100 / tot); resto -= p; return { area: s(a.area), pct: p }; }).filter(a => a.area && a.pct > 0);
      if (l.length) return l;
    }
  }
  return x.area && !['PRORRATEADO', 'MULTI', 'SELECCIONAR'].includes(x.area) ? [{ area: s(x.area), pct: 100 }] : [];
}

// ── Orden por defecto: recordado → Previred → obligación ──
// recordado: el documento de abono_destinatarios (o null); trabajador: el de trabajadorDe (o null); v: el vencimiento
// v0.67.5 · Entre lo recordado para el destinatario y el reparto de Previred del trabajador, manda el más nuevo (por fecha); si
// tienen la misma fecha (o ninguna), lo recordado, como antes.
export function areasPorDefecto({ recordado, trabajador, v, areas }) {
  const x = elegirReparto({ abono: recordado, trabajador, areas, preferir: 'abono' });
  if (x) return x.fuente === 'abono' ? { areas: x.areas, fuente: 'recordado', texto: FUENTES.recordado + (recordado.nombre ? ` (${recordado.nombre})` : '') }
    : { areas: x.areas, fuente: 'previred', texto: `${x.areas.length > 1 ? 'Reparto de Previred' : FUENTES.previred}: ${s(trabajador.nombre)}` };
  const ob = areasDeObligacion(v);
  return { areas: ob, fuente: 'obligacion', texto: FUENTES.obligacion };
}

// ═══ v0.67.5 · Un solo reparto por persona (Previred y abonos) ═══
const repartoOk = (l, areas) => { const x = validarAreas(l, areas); return x.error ? [] : x.areas; };
// El reparto guardado en Previred (cotiz_trabajadores): areas [{ area, pct }] si es válido; si no, su área sola (100 %)
export function repartoTrabajador(t, areas) {
  if (!t) return [];
  const l = Array.isArray(t.areas) && t.areas.length ? repartoOk(t.areas.map(a => ({ area: s(a && a.area), pct: Math.round(num(a && a.pct)) })), areas) : [];
  if (l.length) return l;
  return s(t.area) && (!areas || areas.includes(s(t.area))) ? [{ area: s(t.area), pct: 100 }] : [];
}
// El área principal de un reparto (la de mayor %; si empatan, la primera): es la que queda en "area" (compatibilidad)
export const principal = l => (Array.isArray(l) && l.length ? l.reduce((m, a) => (num(a.pct) > num(m.pct) ? a : m), l[0]).area : '');
// Fecha (texto que se ordena: "aaaa-mm-dd hh:mm") en que se eligió el reparto. Trabajador: repartoEn; si no, actualizado (el último
// mes cargado de Previred). Destinatario del abono: repartoEn; si no, el último abono.
export const fechaRepTrabajador = t => s(t && (t.repartoEn || t.actualizado));
export const fechaRepDestinatario = d => s(d && (d.repartoEn || (d.ultimo && d.ultimo.en) || d.ultimoEn));
// Lo más nuevo entre Previred (trabajador) y el abono (destinatario). preferir: quién gana si tienen la misma fecha.
// → { areas, fuente: 'previred' | 'abono', en } o null si ninguno tiene un reparto válido
export function elegirReparto({ trabajador, abono, areas, preferir = 'previred' }) {
  const tr = repartoTrabajador(trabajador, areas);
  const ab = abono && Array.isArray(abono.areas) ? repartoOk(abono.areas.map(a => ({ area: s(a && a.area), pct: Math.round(num(a && a.pct)) })), areas) : [];
  if (!tr.length && !ab.length) return null;
  const fT = fechaRepTrabajador(trabajador), fA = fechaRepDestinatario(abono);
  const ganaAbono = ab.length && (!tr.length || fA > fT || (fA === fT && preferir === 'abono'));
  return ganaAbono ? { areas: ab, fuente: 'abono', en: fA } : { areas: tr, fuente: 'previred', en: fT };
}
// El destinatario de abonos que es este trabajador: por RUT (la clave del destinatario); si no, por su nombre (o la glosa
// recordada), con la misma regla de trabajadorDe (2 palabras del nombre, uno solo entre los trabajadores). Si hay varios, el más nuevo.
// destinatarios: [{ clave, nombre, areas, repartoEn, ultimo }]; t: { rut, nombre }; trabajadores: todos (para no confundir a dos)
export function destinatarioDeTrabajador(destinatarios, t, trabajadores) {
  if (!t) return null;
  const r = rutNorm(t.rut), L = (destinatarios || []).filter(d => d && Array.isArray(d.areas) && d.areas.length);
  const porRut = r ? L.filter(d => s(d.clave) === 'rut:' + r) : [];
  const todosT = (trabajadores || []).concat(r && !(trabajadores || []).some(x => rutNorm(x.rut) === r) ? [t] : []);
  const cand = porRut.length ? porRut : L.filter(d => !/^rut:/.test(s(d.clave))).filter(d => {
    const x = buscarPersona(todosT, s(d.nombre) || s(d.clave).replace(/^[a-z]+:/, ''), '');
    return x && rutNorm(x.rut) === r;
  });
  return cand.sort((a, b) => fechaRepDestinatario(b).localeCompare(fechaRepDestinatario(a)))[0] || null;
}
// ── Una sola regla para partir un monto en áreas: montos proporcionales que suman exacto; el resto de los redondeos va al área
// con el % más grande (si empatan, la primera). → [{ area, pct, monto }]
export function montosPorAreas(monto, areas) {
  const m = Math.round(num(monto)), l = (areas || []).map(a => ({ area: s(a.area), pct: num(a.pct) }));
  if (!l.length) return [];
  let k = 0; l.forEach((a, i) => { if (a.pct > l[k].pct) k = i; });
  let resto = m;
  const out = l.map((a, i) => { if (i === k) return null; const x = Math.trunc(m * a.pct / 100); resto -= x; return { ...a, monto: x }; });
  out[k] = { ...l[k], monto: resto };
  return out;
}

// ── Reparto elegido: áreas distintas, % enteros mayores que 0 que suman 100 ──
export function validarAreas(lista, areas) {
  const l = (Array.isArray(lista) ? lista : []).map(a => ({ area: s(a && a.area).trim().toUpperCase(), pct: num(a && a.pct) })).filter(a => a.area || a.pct);
  if (!l.length) return { error: 'Elige el área de este abono' };
  if (l.length > MAX_AREAS) return { error: `Hasta ${MAX_AREAS} áreas por abono` };
  if (l.some(a => !a.area)) return { error: 'Elige el área de cada parte' };
  if (areas && l.some(a => !areas.includes(a.area))) return { error: 'Área no válida' };
  if (new Set(l.map(a => a.area)).size !== l.length) return { error: 'Cada área va una sola vez' };
  if (l.some(a => !(a.pct > 0) || Math.round(a.pct) !== a.pct)) return { error: 'Los % van en números enteros mayores que 0' };
  const t = l.reduce((x, a) => x + a.pct, 0);
  if (t !== 100) return { error: `Los % deben sumar 100 (suman ${t})` };
  return { areas: l };
}
// El vencimiento como lo usa lineasPago, con las áreas del abono: una sola área, o multiArea con montos que suman exacto
export function vistaConAreas(v, areas, monto) {
  const m = Math.round(num(monto));
  if (areas.length === 1) return { ...v, area: areas[0].area, multiArea: [], pArea1: '', pPct1: '', pArea2: '', pPct2: '', pArea3: '', pPct3: '' };
  const ma = montosPorAreas(m, areas).map(a => ({ area: a.area, monto: a.monto }));   // v0.67.5: la misma regla que Previred
  return { ...v, area: 'MULTI', multiArea: ma, pArea1: '', pPct1: '', pArea2: '', pPct2: '', pArea3: '', pPct3: '' };
}
export const textoAreas = l => (Array.isArray(l) ? l : []).map(a => (l.length === 1 ? a.area : `${a.area} ${a.pct}%`)).join(' · ');
export const iguales = (a, b) => JSON.stringify((a || []).map(x => [x.area, Number(x.pct)])) === JSON.stringify((b || []).map(x => [x.area, Number(x.pct)]));
