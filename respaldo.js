// ═══════════════════════════════════════════════
//  Sistema Fën — Respaldo mensual en Excel (Configuración → Respaldo)  v0.73.0
//  Reemplaza a las copias en vivo a las planillas (apagadas en la v0.73.0). Arma un .xlsx en el navegador con SheetJS (el mismo
//  lector de Excel que ya usa la cartola: cdnjs xlsx 0.18.5) y lo descarga. No escribe en ninguna planilla.
//  Lecturas: lo que ya está en memoria no se vuelve a leer (fen-gastos: la memoria de fs-gastos.js, con sus paquetes; Cocina: la memoria
//  compartida; caja y B2B: los productos de la sesión). Antes de bajar se muestra el estimado (conteos: 1 lectura por cada pregunta).
//  Escrituras: 1 (config/respaldo en fen-ventas: qué meses ya se bajaron, para la Agenda).
// ═══════════════════════════════════════════════
import { auth, db as dbV, collection, doc, getDoc, getDocs, setDoc, query, where, getAggregateFromServer, count } from './firebase.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FBG from './fs-gastos.js?v=0.138.0';
import * as FBB from './firebase-b2b.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as P from './produccion.js?v=0.138.0';
import * as Caja from './caja.js?v=0.138.0';
import * as M from './fs-memoria.js?v=0.138.0';
import * as Cuota from './fs-cuota.js?v=0.138.0';
import * as RM from './respaldo-modelo.js?v=0.138.0';

export const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const yo = () => (auth.currentUser && auth.currentUser.email) || '';
const COLS_MES = ['gastos', 'vencimientos', 'sii_docs', 'cartola_cargos', 'costos_mp', 'costos_recetas', 'fin_productos', 'cat_reventa'];
const COLS_CAT = ['costos_mp', 'costos_recetas', 'fin_productos', 'cat_reventa'];

let cargando = null;
export function cargarXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!cargando) cargando = new Promise((ok, no) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => { cargando = null; no(new Error('No se pudo cargar el armador de Excel (revisa internet).')); }; document.head.appendChild(s); });
  return cargando;
}

// ── Qué meses ya se bajaron (para la Agenda): config/respaldo en fen-ventas, 1 lectura cada 6 horas ──
const K_HECHOS = 'respaldo:hechos';
export const hechos = (forzar = false) => M.memo(K_HECHOS, async () => { const sn = await getDoc(doc(dbV, 'config', 'respaldo')); return (sn.exists() && sn.data().meses) || {}; }, { guardar: true, ttl: 6 * 3600e3, forzar });
export const hechosEnMemoria = () => M.ver(K_HECHOS, 6 * 3600e3) || null;
async function anotar(clave, info) {
  const prev = (await hechos().catch(() => ({}))) || {};
  const meses = { ...prev, [clave]: { ...info, en: new Date().toISOString(), por: yo() } };
  await setDoc(doc(dbV, 'config', 'respaldo'), { meses, editado: new Date().toISOString(), por: yo() }, { merge: true });
  await M.memo(K_HECHOS, async () => meses, { guardar: true, forzar: true, ttl: 6 * 3600e3 });
}

// ── Conexiones ──
async function estados() {
  const [g, b, p] = await Promise.all([GB.conexion().catch(() => ({ estado: 'error' })), B.conexion().catch(() => ({ estado: 'error' })), P.conexion().catch(() => ({ estado: 'error' }))]);
  return { gastos: g, b2b: b, cocina: p };
}
const rango = mes => [`${mes}-01`, RM.finDeMes(mes)];

// ── Estimado de lecturas (antes de bajar). tipo: 'mes' | 'catalogos' ──
export async function estimar(tipo, mes) {
  const cx = await estados(), est = { gastos: 0, caja: 0, b2b: 0, cocina: 0, preguntas: 0, sin: [] };
  if (cx.gastos.estado === 'ok') {
    const mem = FBG.enMemoria();
    for (const col of (tipo === 'mes' ? COLS_MES : COLS_CAT)) {
      if (mem[col] !== undefined) continue;
      est.gastos += Number((await FBG.getAggregateFromServer(FBG.collection(cx.gastos.db, col), { n: FBG.count() })).data().n) || 0; est.preguntas++;
    }
  } else est.sin.push('Gastos y Finanzas');
  if (tipo === 'mes') { const [d, h] = rango(mes); est.caja += Number((await getAggregateFromServer(query(collection(dbV, 'resumenes_caja'), where('fecha', '>=', d), where('fecha', '<=', h)), { n: count() })).data().n) || 0; est.preguntas++; }
  else if (!Caja.lecturasProductos) { est.caja += Number((await getAggregateFromServer(collection(dbV, 'productos'), { n: count() })).data().n) || 0; est.preguntas++; }
  if (cx.b2b.estado === 'ok') {
    const q = [FBB.collection(cx.b2b.db, 'clientes'), FBB.collection(cx.b2b.db, 'productos')];
    if (tipo === 'mes') { const [d, h] = rango(mes); q.push(FBB.query(FBB.collection(cx.b2b.db, 'ordenes'), FBB.where('fecha', '>=', d), FBB.where('fecha', '<=', h))); }
    for (const x of q) { est.b2b += Number((await FBB.getAggregateFromServer(x, { n: FBB.count() })).data().n) || 0; est.preguntas++; }
  } else est.sin.push('B2B');
  if (cx.cocina.estado === 'ok') { const c = await P.conteoCocina(); est.cocina += c.recetas + c.mps; est.preguntas += c.preguntas; }
  else est.sin.push('Cocina');
  est.total = est.gastos + est.caja + est.b2b + est.cocina;
  return est;
}

// ── Leer lo que va en el libro ──
async function deGastos(db, cols) {
  const out = {};
  for (const col of cols) { const sn = await FBG.getDocs(FBG.collection(db, col)); out[col] = sn.docs.map(d => ({ ...d.data(), id: d.id })); }
  return out;
}
const mapa = l => Object.fromEntries((l || []).map(x => [x.id, x]));
async function leerTodo(tipo, mes) {
  const cx = await estados(), l0 = { g: Cuota.usoHoy().lecturas, p: Cuota.produccion.usoHoy().lecturas };
  const leidas = { gastos: 0, caja: 0, b2b: 0, cocina: 0 };
  const d = { gastos: [], vencimientos: [], sii: [], cartola: [], ordenes: [], clientes: [], productosB2b: [], resumenes: [], recetas: [], costosRecetas: {}, mps: [], costosMp: {}, reventa: [], vinculos: {}, productosCaja: [] };
  if (cx.gastos.estado === 'ok') {
    const g = await deGastos(cx.gastos.db, tipo === 'mes' ? COLS_MES : COLS_CAT);
    Object.assign(d, { gastos: g.gastos || [], vencimientos: g.vencimientos || [], sii: g.sii_docs || [], cartola: g.cartola_cargos || [], costosMp: mapa(g.costos_mp), costosRecetas: mapa(g.costos_recetas), vinculos: mapa(g.fin_productos), reventa: g.cat_reventa || [] });
    Object.values(d.vinculos).forEach(v => { delete v.id; });
  }
  if (tipo === 'mes') {
    const [desde, hasta] = rango(mes);
    const sn = await getDocs(query(collection(dbV, 'resumenes_caja'), where('fecha', '>=', desde), where('fecha', '<=', hasta)));
    leidas.caja += Math.max(1, sn.docs.length); d.resumenes = sn.docs.map(x => ({ ...x.data(), id: x.id }));
  } else { const a = Caja.lecturasProductos; d.productosCaja = await Caja.productos(); leidas.caja += Caja.lecturasProductos - a; }
  if (cx.b2b.estado === 'ok') {
    const a = B.uso.lecturas;
    const [cs, ps] = await Promise.all(['clientes', 'productos'].map(col => FBB.getDocs(FBB.collection(cx.b2b.db, col))));
    leidas.b2b += Math.max(1, cs.docs.length) + Math.max(1, ps.docs.length);
    d.clientes = cs.docs.map(x => ({ ...x.data(), id: x.id })).filter(x => !x.quitadoEnPlanilla); d.productosB2b = ps.docs.map(x => ({ ...x.data(), id: x.id })).filter(x => !x.quitadoEnPlanilla);
    if (tipo === 'mes') { const [desde, hasta] = rango(mes); d.ordenes = await B.ordenesEntre(desde, hasta); leidas.b2b += B.uso.lecturas - a; }
  }
  if (cx.cocina.estado === 'ok') { const x = await P.mpsYRecetas(); d.recetas = x.recetas || []; d.mps = x.mps || []; }
  leidas.gastos = Math.max(0, Cuota.usoHoy().lecturas - l0.g); leidas.cocina = Math.max(0, Cuota.produccion.usoHoy().lecturas - l0.p);
  return { d, leidas, sin: [cx.gastos.estado !== 'ok' && 'Gastos y Finanzas', cx.b2b.estado !== 'ok' && 'B2B', cx.cocina.estado !== 'ok' && 'Cocina'].filter(Boolean) };
}

// Hojas → libro de SheetJS (en el navegador; también sirve en Node con el mismo XLSX)
export function libro(XLSX, hojas) {
  const wb = XLSX.utils.book_new();
  hojas.forEach(h => {
    const ws = XLSX.utils.aoa_to_sheet([h.columnas, ...h.filas]);
    ws['!cols'] = h.columnas.map((c, i) => ({ wch: Math.min(48, Math.max(8, String(c).length + 2, ...h.filas.slice(0, 200).map(f => String(f[i] ?? '').length)) ) }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0, 31));
  });
  return wb;
}
function descargar(XLSX, wb, nombre) {
  const datos = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  const blob = new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  window.__ultimoRespaldo = { nombre, bytes: datos.byteLength || datos.length, base64: null, datos };   // para las pruebas (no se manda a ningún lado)
  return datos.byteLength || datos.length;
}

// tipo 'mes' (con mes 'AAAA-MM') o 'catalogos' → { nombre, hojas: [{ nombre, filas }], leidas, sin, bytes }
export async function bajar(tipo, mes) {
  const XLSX = await cargarXlsx();
  const { d, leidas, sin } = await leerTodo(tipo, mes);
  const meta = { generado: new Date().toISOString().slice(0, 16).replace('T', ' '), por: yo() };
  const hojas = tipo === 'mes' ? RM.libroMes(mes, d, meta) : RM.libroCatalogos(d, meta);
  const hoy = new Date(), dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const nombre = tipo === 'mes' ? `fen-respaldo-${mes}.xlsx` : `fen-respaldo-catalogos-${dia}.xlsx`;
  const bytes = descargar(XLSX, libro(XLSX, hojas), nombre);
  const resumen = hojas.slice(1).map(h => ({ nombre: h.nombre, filas: h.filas.length }));
  try { await anotar(tipo === 'mes' ? mes : 'catalogos', { archivo: nombre, hojas: resumen.length, filas: resumen.reduce((s, h) => s + h.filas, 0) }); } catch (e) { console.warn('Respaldo: no se pudo anotar', e); }
  return { nombre, hojas: resumen, leidas, sin, bytes };
}
