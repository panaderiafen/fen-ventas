// ═══════════════════════════════════════════════
//  Sistema Fën — acceso a fen-gastos con memoria y cuidado de la cuota  v0.63.2
//  Todo lo de fen-gastos (Gastos, Conciliación de cargos, Finanzas) pasa por aquí (antes iba directo a firebase-gastos.js).
//  El plan gratuito de Firestore (Spark) da 50.000 lecturas y 20.000 escrituras al día por proyecto. Antes, cada pantalla
//  volvía a leer colecciones enteras (3.000 gastos, 500 vencimientos, 1.500 cargos…) cada vez que se abría.
//  · _m: cada escritura hecha desde aquí lleva _m (hora del servidor). Con eso se puede preguntar "¿qué cambió desde…?"
//    (una condición sobre un solo campo: usa el índice simple que Firestore crea solo, no pide índices compuestos).
//  · Memoria de la sesión: una colección leída entera queda en memoria mientras la app está abierta; las consultas
//    (where ==, >=, <=, in, limit) se responden desde la memoria. Se refresca solo lo que cambió (_m) si pasaron más de
//    2 minutos o si se escribió algo en esa colección. Cambiar de pestaña no vuelve a leer.
//  · Paquetes: las colecciones grandes se guardan también resumidas en pocos documentos (cache_paquetes/{col}~k y, los
//    gastos, uno por mes en fin_gastos_mes/{AAAA-MM} con sus totales por ítem y área). Al abrir la app se leen esos pocos
//    documentos + lo que cambió desde que se armaron + un conteo (para notar algo que entró sin _m). Si el conteo no
//    calza, o pasaron 7 días, se vuelve a leer todo y se arman de nuevo.
//  · Lo que el script de Gastos cambia por su cuenta (planillaPendiente, planillaEn) no lleva _m: esas consultas van
//    siempre a la base.
//  · Cuota agotada (resource-exhausted): se avisa con un letrero y no se intenta escribir hasta que vuelva (≈ 4:00 de Chile).
//  · Uso de hoy: lecturas y escrituras hechas desde este navegador (Configuración). La lectura de un documento cuenta 1;
//    una consulta vacía cuenta 1; además, cada pedido cuenta 1 por la regla de seguridad (exists de admins).
// ═══════════════════════════════════════════════
import * as FB from './firebase-gastos.js?v=0.138.0';
import { diaCuota, proximoReinicio, horaChile, esCuota, mensajeCuota, anotar, contarMemoria, usoHoy, reiniciarUso, cuota, alCambiarCuota, marcarAgotada, marcarViva, olvidarCuota, errorCuota } from './fs-cuota.js?v=0.138.0';
export { diaCuota, proximoReinicio, horaChile, esCuota, mensajeCuota, usoHoy, reiniciarUso, cuota, alCambiarCuota, olvidarCuota };

export const VERSION_PAQUETES = 1;
const TTL = 120000;                 // refresco de lo que cambió: cada 2 minutos como máximo (o después de escribir)
// "Lo que cambió" se pregunta con _m > la marca más nueva vista (segundos y nanosegundos, sin redondear a milisegundos).
// Firestore es consistente: lo que una consulta no alcanzó a ver se confirma después, con una hora de servidor posterior (y _m es esa hora).
const DIAS_RECONSTRUIR = 7;         // los paquetes se rearman leyendo todo cada 7 días (por si algo cambió sin _m, p. ej. en la consola)
const MAX_PARTE = 600000;           // bytes de texto por documento de paquete (Firestore acepta hasta 1 MB)
const PERSISTIR_DESDE = 20;         // cambios acumulados desde el paquete que justifican reescribirlo
export const PAQUETES = ['gastos', 'vencimientos', 'obligaciones', 'items', 'cartola_cargos', 'cartolas', 'cartola_reglas', 'sii_docs', 'cotizaciones', 'cotiz_trabajadores',
  'abono_destinatarios', 'proveedores', 'tef_enviadas', 'costos_mp', 'costos_recetas', 'costos_recetas_hist', 'costos_asoc', 'costos_sii_procesadas', 'fin_items', 'fin_productos'];
const VOLATILES = new Set(['planillaPendiente', 'planillaEn']);
const SIN_MEMORIA = new Set(['admins', 'migracion', 'cache_paquetes', 'fin_gastos_mes']);
const COL_PAQ = 'cache_paquetes', COL_MES = 'fin_gastos_mes';

// ═══════════════ Cuota agotada (el estado vive en fs-cuota.js, que también lee la pantalla) ═══════════════
async function conCuota(fn, escribe) {
  if (escribe && cuota().agotada) throw errorCuota();
  try { const r = await fn(); marcarViva(escribe ? 'escritura' : 'lectura'); return r; }
  catch (e) { if (esCuota(e)) { marcarAgotada(escribe ? 'escritura' : 'lectura'); throw Object.assign(errorCuota(), { original: e }); } throw e; }
}

// ═══════════════ Referencias (se puede ver la colección y las condiciones) ═══════════════
const colDe = ref => (ref && (ref.col || (ref.parent && ref.parent.id))) || '';
export function collection(db, col) { return { __fs: 'c', col, db, raw: FB.collection(db, col) }; }
export const doc = (db, col, id) => FB.doc(db, col, id);
export const where = (campo, op, valor) => ({ __fs: 'w', campo, op, valor, raw: FB.where(campo, op, valor) });
export const orderBy = (campo, dir = 'asc') => ({ __fs: 'o', campo, dir, raw: FB.orderBy(campo, dir) });
export const limit = n => ({ __fs: 'l', n, raw: FB.limit(n) });
export function query(c, ...partes) { return { __fs: 'q', col: c.col, db: c.db, partes: (c.partes || []).concat(partes), raw: FB.query(c.raw, ...partes.map(p => p.raw)) }; }
export const { serverTimestamp, count, sum, conectar, conectado, entrar, idToken, Timestamp } = FB;
export async function salir() { olvidarTodo(); return FB.salir(); }

// ═══════════════ Valores: copia, comparación, texto ═══════════════
const esTs = v => !!v && typeof v === 'object' && typeof v.toMillis === 'function';
const msDe = v => (esTs(v) ? v.toMillis() : v && typeof v === 'object' && typeof v.__ts === 'number' ? v.__ts : null);
// Marca de tiempo exacta { s, n } (segundos y nanosegundos) de un _m; null si no tiene
function marcaDe(v) {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') return { s: v.seconds, n: v.nanoseconds };
  const ms = msDe(v); return ms === null ? null : { s: Math.floor(ms / 1000), n: (ms % 1000) * 1e6 };
}
const marcaOk = x => !!x && typeof x === 'object' && typeof x.s === 'number' && typeof x.n === 'number';
const cmpM = (a, b) => (a.s - b.s) || (a.n - b.n);
const tsM = x => (typeof FB.Timestamp === 'function' ? new FB.Timestamp(x.s, x.n) : FB.Timestamp.fromMillis(x.s * 1000 + Math.floor(x.n / 1e6)));
const msM = x => (x ? x.s * 1000 + Math.floor(x.n / 1e6) : 0);
function copia(v) {
  if (Array.isArray(v)) return v.map(copia);
  if (v && typeof v === 'object' && !esTs(v) && Object.getPrototypeOf(v) === Object.prototype) { const o = {}; for (const k in v) o[k] = copia(v[k]); return o; }
  return v;
}
const campo = (d, ruta) => ruta.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
const tipoDe = v => (v === null ? 'null' : esTs(v) ? 'ts' : typeof v);
// Como Firestore: solo se comparan valores del mismo tipo (número con número, texto con texto, fecha con fecha)
function cmp(a, b) {
  const ta = tipoDe(a), tb = tipoDe(b);
  if (ta !== tb) return null;
  if (ta === 'ts') { const x = a.toMillis(), y = b.toMillis(); return x < y ? -1 : x > y ? 1 : 0; }
  if (ta === 'number' || ta === 'string' || ta === 'boolean') return a < b ? -1 : a > b ? 1 : 0;
  return JSON.stringify(a) === JSON.stringify(b) ? 0 : null;
}
function cumple(d, w) {
  const a = campo(d, w.campo);
  if (a === undefined) return false;
  switch (w.op) {
    case '==': return cmp(a, w.valor) === 0;
    case '!=': return cmp(a, w.valor) !== 0;
    case '>=': { const c = cmp(a, w.valor); return c !== null && c >= 0; }
    case '>': { const c = cmp(a, w.valor); return c !== null && c > 0; }
    case '<=': { const c = cmp(a, w.valor); return c !== null && c <= 0; }
    case '<': { const c = cmp(a, w.valor); return c !== null && c < 0; }
    case 'in': return (w.valor || []).some(v => cmp(a, v) === 0);
    case 'not-in': return !(w.valor || []).some(v => cmp(a, v) === 0);
    case 'array-contains': return Array.isArray(a) && a.some(v => cmp(v, w.valor) === 0);
    case 'array-contains-any': return Array.isArray(a) && a.some(v => (w.valor || []).some(x => cmp(v, x) === 0));
    default: return null;
  }
}
const OPS = new Set(['==', '!=', '>=', '>', '<=', '<', 'in', 'not-in', 'array-contains', 'array-contains-any']);
// Fechas de Firestore en texto: { __t: ms } y, si las trae, sus nanosegundos { __ns } (para no perder precisión en _m)
const aTexto = d => JSON.stringify(d, (k, v) => (esTs(v) ? (typeof v.nanoseconds === 'number' ? { __t: v.toMillis(), __ns: v.nanoseconds } : { __t: v.toMillis() })
  : v && typeof v === 'object' && typeof v.__ts === 'number' && Object.keys(v).length === 1 ? { __t: v.__ts } : v));
const deTexto = t => JSON.parse(t, (k, v) => {
  if (!v || typeof v !== 'object' || typeof v.__t !== 'number') return v;
  const ks = Object.keys(v);
  if (ks.length === 1) return FB.Timestamp.fromMillis(v.__t);
  if (ks.length === 2 && typeof v.__ns === 'number') return typeof FB.Timestamp === 'function' ? new FB.Timestamp(Math.floor(v.__t / 1000), v.__ns) : FB.Timestamp.fromMillis(v.__t);
  return v;
});
// Huella corta para repartir ids en partes
function hash(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const snapDe = (id, d) => ({ id, exists: () => d !== undefined && d !== null, data: () => (d === undefined || d === null ? undefined : copia(d)), get: k => copia(campo(d, k)) });
const resultado = filas => ({ size: filas.length, empty: !filas.length, docs: filas, forEach: fn => filas.forEach(fn) });

// ═══════════════ Memoria de la sesión ═══════════════
// M[col] = { docs: Map(id → datos), cargado, marca ({ s, n } del _m más nuevo visto; la memoria está al día hasta ahí), ultimo (ms, para mirar), leidoEn, sucio, pend (promesa), cambiados (Set de ids
//          desde el paquete), paq (índice del paquete o null) }
const M = {};
export function olvidarTodo() { Object.keys(M).forEach(k => delete M[k]); }
export const estadoMemoria = () => Object.fromEntries(Object.entries(M).map(([k, m]) => [k, { n: m.docs.size, ultimo: m.ultimo, leidoEn: m.leidoEn, sucio: m.sucio, cambiados: m.cambiados.size, paq: !!m.paq }]));
export const enMemoria = () => Object.fromEntries(Object.entries(M).filter(([, m]) => m.cargado).map(([k, m]) => [k, m.docs.size]));
if (typeof window !== 'undefined') window.__fsMemoria = enMemoria;
// v0.69.5 · Lo que ya está en la memoria de la sesión, SIN leer nada (ni el refresco de lo que cambió): los documentos de una
// colección ya cargada y sin escrituras propias pendientes de refresco ([{ id, d }]); null si no está (o si se escribió en ella).
// Para revisiones que no deben gastar lecturas (Cierre de mes: Previred; Hoy: si el mes ya está cerrado).
export function enMemoriaDocs(col) {
  const m = M[col];
  if (!m || !m.cargado || m.sucio || m.pend) return null;
  contarMemoria();
  return [...m.docs.entries()].map(([id, d]) => ({ id, d: copia(d) }));
}   // para Configuración → Uso de la base hoy
const memo = col => (M[col] = M[col] || { docs: new Map(), cargado: false, marca: null, ultimo: 0, leidoEn: 0, sucio: false, pend: null, cambiados: new Set(), paq: null });
function absorber(m, id, d) {
  m.docs.set(id, d);
  const k = marcaDe(d && d._m); if (k && (!m.marca || cmpM(k, m.marca) > 0)) { m.marca = k; m.ultimo = msM(k); }
}
async function leerServidor(q, col) {
  const sn = await conCuota(() => FB.getDocs(q));
  anotar(col, Math.max(1, sn.docs.length), 0);
  return sn;
}
async function getDocServidor(ref) {
  const sn = await conCuota(() => FB.getDoc(ref));
  anotar(colDe(ref), 1, 0);
  return sn;
}
// Lo que cambió desde la marca (_m > marca; sin marca, todo lo que tiene _m)
async function refrescar(db, col, m) {
  const w = m.marca ? FB.where('_m', '>', tsM(m.marca)) : FB.where('_m', '>=', FB.Timestamp.fromMillis(0));
  const sn = await leerServidor(FB.query(FB.collection(db, col), w), col);
  sn.docs.forEach(x => { const d = x.data(), antes = m.docs.get(x.id); absorber(m, x.id, d); if (!antes || aTexto(antes) !== aTexto(d)) m.cambiados.add(x.id); });
  m.leidoEn = Date.now(); m.sucio = false;
  return sn.docs.length;
}
async function leerEntera(db, col, m) {
  const sn = await leerServidor(FB.collection(db, col), col);
  m.docs = new Map(); m.marca = null; m.ultimo = 0; m.cambiados = new Set();
  sn.docs.forEach(x => absorber(m, x.id, x.data()));
  m.cargado = true; m.leidoEn = Date.now(); m.sucio = false;
}
// Carga una colección entera a la memoria (una sola vez; dos pantallas a la vez esperan la misma lectura)
async function cargar(db, col, forzar) {
  const m = memo(col);
  if (m.pend) return m.pend.then(() => m);
  if (m.cargado && !forzar) {
    if (m.sucio || Date.now() - m.leidoEn > TTL) {
      m.pend = (async () => { await refrescar(db, col, m); if (PAQUETES.includes(col)) await persistir(db, col, m).catch(e => console.warn('Paquete sin guardar', col, e)); })().finally(() => { m.pend = null; });
      await m.pend;
    }
    return m;
  }
  m.pend = (async () => {
    if (PAQUETES.includes(col)) await cargarPaquete(db, col, m, forzar);
    else await leerEntera(db, col, m);
  })().finally(() => { m.pend = null; });
  await m.pend;
  return m;
}

// ═══════════════ Paquetes ═══════════════
// Índice: cache_paquetes/{col} = { v, construido (ms), total, hasta { grupo: ms }, partes { grupo: n } }
// Partes: gastos → fin_gastos_mes/{AAAA-MM} y {AAAA-MM}~k (con totales del mes); otras → cache_paquetes/{col}~k
const grupoDe = (col, id, d) => (col === 'gastos' ? (/^\d{4}-\d{2}/.test(String(d && d.fecha || '')) ? String(d.fecha).slice(0, 7) : 'sin-fecha') : 'todo');
const idParte = (col, g, k) => (col === 'gastos' ? (k ? `${g}~${k}` : g) : `${col}~${g}~${k}`);
const colParte = col => (col === 'gastos' ? COL_MES : COL_PAQ);
const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
function totalesMes(filas) {
  const t = { n: 0, vigentes: 0, neto: 0, final: 0, porItem: {}, porArea: {} };
  filas.forEach(([, d]) => {
    t.n++;
    if (d.estado !== 'vigente' || d.quitadoEnPlanilla) return;
    t.vigentes++; const ne = num(d.montoNeto), fi = num(d.montoFinal);
    t.neto += ne; t.final += fi;
    const it = String(d.itemGasto || 'SIN ÍTEM'), ar = String(d.area || 'SIN ÁREA');
    const pi = t.porItem[it] = t.porItem[it] || { n: 0, neto: 0, final: 0 }; pi.n++; pi.neto += ne; pi.final += fi;
    const pa = t.porArea[ar] = t.porArea[ar] || { n: 0, neto: 0, final: 0 }; pa.n++; pa.neto += ne; pa.final += fi;
  });
  return t;
}
// Arma las partes de un grupo: cada una con hasta ~600 KB de texto. → [{ id, datos }] o null si un documento solo no cabe
function armarGrupo(col, g, filas, hasta) {
  const textos = filas.map(([id, d]) => [id, aTexto(d)]);
  const bytes = textos.reduce((s, [id, t]) => s + t.length + id.length + 6, 0);
  if (textos.some(([, t]) => t.length > MAX_PARTE)) return null;
  let k = Math.max(1, Math.ceil(bytes / MAX_PARTE));
  for (let intento = 0; intento < 6; intento++) {
    const cubos = Array.from({ length: k }, () => []);
    textos.forEach(x => cubos[hash(x[0]) % k].push(x));
    const partes = cubos.map(c => '{' + c.map(([id, t]) => JSON.stringify(id) + ':' + t).join(',') + '}');
    if (partes.every(p => p.length <= MAX_PARTE + 50000)) {
      return partes.map((p, i) => ({ id: idParte(col, g, i), datos: { col, grupo: g, parte: i, de: k, v: VERSION_PAQUETES, filas: p, n: cubos[i].length, hasta, ...(col === 'gastos' && i === 0 ? { mes: g, totales: totalesMes(filas) } : {}) } }));
    }
    k++;
  }
  return null;
}
async function escribirPartes(db, col, grupos, m, construido) {
  const hasta = m.marca || null, porGrupo = {};
  m.docs.forEach((d, id) => { const g = grupoDe(col, id, d); (porGrupo[g] = porGrupo[g] || []).push([id, d]); });
  const ops = [], partes = {}, hastas = {};
  for (const g of grupos) {
    const arm = armarGrupo(col, g, (porGrupo[g] || []).sort((a, b) => (a[0] < b[0] ? -1 : 1)), hasta);
    if (!arm) return false;
    arm.forEach(p => ops.push([FB.doc(db, colParte(col), p.id), p.datos]));
    partes[g] = arm.length; hastas[g] = hasta;
  }
  const idx = FB.doc(db, COL_PAQ, col);
  for (let i = 0; i < ops.length; i += 300) {
    const b = FB.writeBatch(db);
    ops.slice(i, i + 300).forEach(([r, d]) => b.set(r, d));
    await conCuota(() => b.commit(), true);
    anotar(colParte(col), 0, Math.min(300, ops.length - i));
  }
  if (construido) {
    await conCuota(() => FB.setDoc(idx, { v: VERSION_PAQUETES, col, construido, total: m.docs.size, partes, hasta: hastas }), true);
  } else {
    // Otro equipo pudo reescribir otros grupos: se mezcla con lo que hay (cada grupo con su propio "hasta")
    await conCuota(() => FB.runTransaction(db, async tx => {
      const sn = await tx.get(idx), a = sn.exists() ? sn.data() : {};
      // Los grupos que no se reescribieron siguen al día hasta "hasta": todo lo que cambió desde el paquete cargado está en m.cambiados
      // (y su grupo se reescribió). Así la próxima apertura pregunta desde aquí y no desde el grupo más antiguo.
      const h = {}; Object.keys(a.partes || {}).forEach(g => { const x = (a.hasta || {})[g]; h[g] = marcaOk(x) && (!hasta || cmpM(x, hasta) > 0) ? x : hasta; });
      tx.set(idx, { ...a, v: VERSION_PAQUETES, col, total: m.docs.size, partes: { ...(a.partes || {}), ...partes }, hasta: { ...h, ...hastas } });
    }), true);
    anotar(COL_PAQ, 1, 0);
  }
  anotar(COL_PAQ, 0, 1);
  m.paq = m.paq || { partes: {}, hasta: {} };
  Object.assign(m.paq.partes, partes); Object.assign(m.paq.hasta, hastas); m.paq.total = m.docs.size;
  if (construido) m.paq.construido = construido;
  return true;
}
// Reescribe los grupos con cambios acumulados (si son varios)
async function persistir(db, col, m, forzar) {
  if (!m.paq || m.paq.sinPaquete || cuota().agotada) return false;
  if (!forzar && m.cambiados.size < PERSISTIR_DESDE) return false;
  const grupos = new Set();
  m.cambiados.forEach(id => grupos.add(grupoDe(col, id, m.docs.get(id))));
  // un gasto que cambió de mes: su mes anterior también (se reconoce porque el paquete del mes lo tenía)
  (m.origen || new Map()).forEach((g, id) => { if (m.cambiados.has(id)) grupos.add(g); });
  if (!grupos.size) return false;
  const ok = await escribirPartes(db, col, [...grupos], m, 0);
  if (ok) { m.cambiados.forEach(id => { (m.origen = m.origen || new Map()).set(id, grupoDe(col, id, m.docs.get(id))); }); m.cambiados = new Set(); }
  return ok;
}
async function construir(db, col, m) {
  await leerEntera(db, col, m);
  const grupos = new Set(); m.docs.forEach((d, id) => grupos.add(grupoDe(col, id, d)));
  if (!grupos.size) grupos.add(col === 'gastos' ? 'sin-fecha' : 'todo');
  const ok = await escribirPartes(db, col, [...grupos], m, Date.now()).catch(e => { console.warn('Paquete sin armar', col, e); return false; });
  if (!ok) m.paq = { sinPaquete: true };
  m.origen = new Map(); m.docs.forEach((d, id) => m.origen.set(id, grupoDe(col, id, d)));
}
async function contarServidor(db, col) {
  const r = await conCuota(() => FB.getAggregateFromServer(FB.collection(db, col), { n: FB.count() }));
  anotar(col, 1, 0);
  return Number(r.data().n) || 0;
}
async function cargarPaquete(db, col, m, forzar) {
  let idx = null;
  if (!forzar) { const sn = await getDocServidor(FB.doc(db, COL_PAQ, col)); idx = sn.exists() ? sn.data() : null; }
  const viejo = !idx || idx.v !== VERSION_PAQUETES || idx.sinPaquete || !(Date.now() - num(idx.construido) < DIAS_RECONSTRUIR * 864e5);
  if (viejo) return construir(db, col, m);
  // Las partes
  const ids = [];
  Object.entries(idx.partes || {}).forEach(([g, n]) => { for (let k = 0; k < n; k++) ids.push(idParte(col, g, k)); });
  const sns = await Promise.all(ids.map(id => getDocServidor(FB.doc(db, colParte(col), id))));
  if (sns.some(s => !s.exists())) return construir(db, col, m);
  m.docs = new Map(); m.marca = null; m.ultimo = 0; m.cambiados = new Set(); m.origen = new Map();
  for (const s of sns) {
    const p = s.data(), filas = deTexto(p.filas || '{}');
    Object.entries(filas).forEach(([id, d]) => { absorber(m, id, d); m.origen.set(id, p.grupo); });
  }
  // La memoria queda al día hasta la marca más antigua de los grupos (sin marca: se pregunta por todo lo que tiene _m)
  const hastas = Object.values(idx.hasta || {});
  m.marca = hastas.length && hastas.every(marcaOk) ? hastas.reduce((a, x) => (cmpM(x, a) < 0 ? x : a)) : null;
  m.ultimo = msM(m.marca);
  m.paq = { partes: { ...(idx.partes || {}) }, hasta: { ...(idx.hasta || {}) }, total: idx.total, construido: idx.construido };
  m.cargado = true;
  // Lo que cambió desde que se armaron + el conteo (algo que entró sin _m obliga a leer todo)
  let [, total] = await Promise.all([refrescar(db, col, m), contarServidor(db, col)]);
  // Algo pudo entrar justo entre la consulta y el conteo: se pregunta otra vez antes de leer todo
  if (total !== m.docs.size) { await refrescar(db, col, m); total = await contarServidor(db, col); }
  if (total !== m.docs.size) { m.cargado = false; return construir(db, col, m); }
  await persistir(db, col, m).catch(e => console.warn('Paquete sin guardar', col, e));
}

// ═══════════════ Lecturas ═══════════════
function resolverLocal(m, q) {
  const ws = (q.partes || []).filter(p => p.__fs === 'w'), os = (q.partes || []).filter(p => p.__fs === 'o'), ls = (q.partes || []).filter(p => p.__fs === 'l');
  let filas = [...m.docs.entries()].filter(([, d]) => ws.every(w => cumple(d, w)));
  // Como Firestore: sin orden explícito, por id; orderBy deja fuera los que no tienen el campo
  filas.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (os.length) {
    filas = filas.filter(([, d]) => os.every(o => campo(d, o.campo) !== undefined));
    filas.sort((a, b) => { for (const o of os) { const c = cmp(campo(a[1], o.campo), campo(b[1], o.campo)) || 0; if (c) return o.dir === 'desc' ? -c : c; } return 0; });
  }
  if (ls.length) filas = filas.slice(0, Math.min(...ls.map(l => l.n)));
  contarMemoria();
  return resultado(filas.map(([id, d]) => snapDe(id, d)));
}
const usaMemoria = q => {
  if (SIN_MEMORIA.has(q.col)) return false;
  const ws = (q.partes || []).filter(p => p.__fs === 'w');
  return ws.every(w => OPS.has(w.op) && !VOLATILES.has(String(w.campo).split('.')[0]) && w.campo !== '_m');
};
export async function getDocs(q) {
  if (!q || !q.__fs) return leerServidor(q, '?');
  const col = q.col, db = q.db, filtrada = (q.partes || []).some(p => p.__fs === 'w' || p.__fs === 'l');
  if (!usaMemoria(q)) return leerServidor(q.raw, col);
  const m = M[col];
  // Colección entera, o una con paquete: a la memoria. Una consulta a una colección chica sin paquete que no está en memoria: a la base.
  if (!filtrada || PAQUETES.includes(col) || (m && m.cargado)) { const mm = await cargar(db, col); return resolverLocal(mm, q); }
  return leerServidor(q.raw, col);
}
// Un documento: siempre a la base (para revisar si ya existe antes de escribir); se guarda en la memoria si la colección está cargada
function verEnMemoria(col, ref, sn) {
  const m = M[col];
  if (!m || !m.cargado || SIN_MEMORIA.has(col) || !sn || !sn.exists()) return;
  const id = sn.id || ref.id, d = sn.data(), antes = m.docs.get(id);
  // sin mover 'ultimo': lo que cambió entre medio igual se trae en el próximo refresco
  if (!antes || aTexto(antes) !== aTexto(d)) { m.docs.set(id, d); m.cambiados.add(id); m.sucio = true; }
}
export async function getDoc(ref) {
  const sn = await getDocServidor(ref);
  verEnMemoria(colDe(ref), ref, sn);
  return sn;
}
export async function getAggregateFromServer(q, campos) {
  const r = await conCuota(() => FB.getAggregateFromServer(q && q.__fs ? q.raw : q, campos));
  anotar(q && q.col || '?', 1, 0);
  return r;
}
export function onSnapshot(ref, ...resto) { return FB.onSnapshot(ref && ref.__fs ? ref.raw : ref, ...resto); }
// Releer todo y rearmar los paquetes (Configuración → Uso de la base)
export async function reconstruir(db, cols = PAQUETES, avance = () => {}) {
  olvidarTodo();
  for (const col of cols) { avance(col); await cargar(db, col, true); }
}

// ═══════════════ Escrituras (llevan _m) ═══════════════
const conM = (col, d) => (SIN_MEMORIA.has(col) || !d || typeof d !== 'object' ? d : { ...d, _m: FB.serverTimestamp() });
function tocar(col) { const m = M[col]; if (m) m.sucio = true; }
export async function setDoc(ref, datos, opt) {
  const col = colDe(ref);
  const r = await conCuota(() => (opt ? FB.setDoc(ref, conM(col, datos), opt) : FB.setDoc(ref, conM(col, datos))), true);
  anotar(col, 0, 1); tocar(col); return r;
}
export async function updateDoc(ref, cambios) {
  const col = colDe(ref);
  const r = await conCuota(() => FB.updateDoc(ref, conM(col, cambios)), true);
  anotar(col, 0, 1); tocar(col); return r;
}
export async function addDoc(c, datos) {
  const col = c.col || colDe(c);
  const r = await conCuota(() => FB.addDoc(c.__fs ? c.raw : c, conM(col, datos)), true);
  anotar(col, 0, 1); tocar(col); return r;
}
export function writeBatch(db) {
  const b = FB.writeBatch(db), cols = [];
  const w = {
    set(ref, d, opt) { const col = colDe(ref); cols.push(col); opt ? b.set(ref, conM(col, d), opt) : b.set(ref, conM(col, d)); return w; },
    update(ref, d) { const col = colDe(ref); cols.push(col); b.update(ref, conM(col, d)); return w; },
    async commit() {
      const r = await conCuota(() => b.commit(), true);
      const por = {}; cols.forEach(c => { por[c] = (por[c] || 0) + 1; });
      Object.entries(por).forEach(([c, n], i) => anotar(c, 0, n, i ? 0 : 1)); cols.forEach(tocar);
      return r;
    }
  };
  return w;
}
export async function runTransaction(db, fn) {
  if (cuota().agotada) throw errorCuota();
  let cols = [], lecturas = [];
  const r = await conCuota(() => FB.runTransaction(db, async tx => {
    cols = []; lecturas = [];
    const t = {
      // Lo leído en la transacción es lo último de la base: queda en la memoria (y esa colección se refresca en la próxima lectura)
      get: async ref => { const col = colDe(ref); lecturas.push(col); const sn = await tx.get(ref); verEnMemoria(col, ref, sn); return sn; },
      set(ref, d, opt) { const col = colDe(ref); cols.push(col); opt ? tx.set(ref, conM(col, d), opt) : tx.set(ref, conM(col, d)); return t; },
      update(ref, d) { const col = colDe(ref); cols.push(col); tx.update(ref, conM(col, d)); return t; }
    };
    return fn(t);
  }), true);
  lecturas.forEach(c => anotar(c, 1, 0, 0));
  const por = {}; cols.forEach(c => { por[c] = (por[c] || 0) + 1; });
  Object.entries(por).forEach(([c, n]) => anotar(c, 0, n, 0)); anotar('(transacción)', 0, 0, 1);
  cols.forEach(tocar);
  return r;
}
