// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo, Etapa 0 "Qué está vivo" (datos)  v0.72.0
//  Lee de las cuatro bases lo que hace falta para decidir qué está vivo, y escribe solo lo que el dueño decide.
//  Lecturas (plan gratis de Firestore, Spark), todo con la memoria que ya existe:
//  · fen-produccion: las recetas, de la memoria compartida con Producción y Finanzas (produccion.js, con su marca de cambio).
//  · fen-ventas: los productos de la caja (una vez por sesión, los mismos de los cierres y de Finanzas) y los resúmenes de
//    cierre de los últimos 60 días (1 lectura por cierre; las dos sucursales). Lo que sirve de ellos (unidades y última venta por
//    producto) queda resumido 6 horas, también en este navegador: volver a abrir la pantalla no los vuelve a leer.
//  · fen-b2b: los productos (una vez por sesión, los mismos de Finanzas) y las órdenes de 60 días (1 por orden), resumidas igual.
//  · fen-gastos: fin_productos (vínculos de Finanzas) y cat_revision (lo marcado "Vivo"), con la memoria de fs-gastos.js
//    (una colección leída entera queda en memoria; después se pregunta solo lo que cambió).
//  Escrituras: archivar o reactivar = 1 por receta o producto (+1 de la marca de recetas en fen-produccion); "Vivo" = 1 en
//  cat_revision. Cada acción deja 1 línea en el historial de Sistema Fën (la escribe la pantalla).
// ═══════════════════════════════════════════════
import { auth, db, collection, getDocs, query, where } from './firebase.js?v=0.138.0';
import * as P from './produccion.js?v=0.138.0';
import * as Caja from './caja.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as F from './finanzas.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FBG from './fs-gastos.js?v=0.138.0';
import * as M from './fs-memoria.js?v=0.138.0';
import * as Cuota from './fs-cuota.js?v=0.138.0';
import * as CM from './catalogo-modelo.js?v=0.138.0';
import * as RV from './reventa-modelo.js?v=0.138.0';

export const TTL_VENTAS = 6 * 3600e3;
const PRE = 'cat:';
const yo = () => (auth.currentUser && auth.currentUser.email) || '';
export const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Lecturas de la última apertura, por base (documentos leídos; una consulta vacía cuenta 1)
export const uso = { caja: 0, b2b: 0, cocina: 0, finanzas: 0 };
const reiniciarUso = () => Object.keys(uso).forEach(k => { uso[k] = 0; });

export function olvidar() {
  M.olvidar(PRE); P.olvidarMemoria('recetas'); Caja.olvidarProductos(); F.olvidarCatalogoB2b(); B.olvidarAnalisisB2b();
}

// ── fen-ventas: resúmenes de cierre de 60 días → { productoId: { cantidad, neto, ultima } } ──
async function ventasCaja(desde, hasta, forzar) {
  return M.memo(`${PRE}caja:${desde}~${hasta}`, async () => {
    // Si el Plan de Panadería ya leyó desde antes (6 horas en memoria), sirve
    const ya = !forzar && M.buscar('pp:res:', k => k <= desde, TTL_VENTAS);
    let res = ya;
    if (!res) { const sn = await getDocs(query(collection(db, 'resumenes_caja'), where('fecha', '>=', desde))); uso.caja += Math.max(1, sn.docs.length); res = sn.docs.map(d => d.data()); }
    return CM.ventasCaja(res, desde, hasta);
  }, { ttl: TTL_VENTAS, guardar: true, forzar });
}
// ── fen-b2b: órdenes de 60 días → { productoId: { cantidad, neto, ultima } } ──
async function ventasB2b(desde, hasta, forzar) {
  const cx = await B.conexion().catch(e => ({ estado: 'error', error: e }));
  if (cx.estado !== 'ok') return { estado: cx.estado, ventas: {} };
  const ventas = await M.memo(`${PRE}b2b:${desde}~${hasta}`, async () => {
    const antes = B.uso.lecturas;
    if (forzar) B.olvidarAnalisisB2b();
    const os = await B.ordenesEntre(desde, hasta);
    uso.b2b += Math.max(0, B.uso.lecturas - antes);
    return CM.ventasB2b(os, desde, hasta);
  }, { ttl: TTL_VENTAS, guardar: true, forzar });
  return { estado: 'ok', ventas };
}
// ── fen-gastos: vínculos de Finanzas y lo marcado "Vivo" ──
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva de Gastos (Gastos → Configuración → Base nueva).'); return cx.db; }
async function revision() {
  const db = await dbG(), sn = await FBG.getDocs(FBG.collection(db, 'cat_revision')), out = {};
  sn.docs.forEach(d => { out[d.id] = { id: d.id, ...d.data() }; });
  return out;
}

// ── Todo junto ──
// → { hoy, desde, estados: { cocina, gastos, b2b }, datos (para armar), vista (CM.armar), uso, porId: { recetas, caja, b2b } }
export async function cargar({ hoy = hoyTxt(), forzar = false } = {}) {
  reiniciarUso();
  if (forzar) olvidar();
  const desde = CM.desdeDias(hoy);
  const l0 = { p: Cuota.produccion.usoHoy().lecturas, g: Cuota.usoHoy().lecturas, cp: Caja.lecturasProductos };
  const cocina = (async () => {
    const cx = await P.conexion().catch(e => ({ estado: 'error', error: e }));
    if (cx.estado !== 'ok') return { estado: cx.estado, recetas: [] };
    return { estado: 'ok', recetas: await P.recetasCatalogo() };
  })();
  const gastos = (async () => {
    const cx = await GB.conexion().catch(e => ({ estado: 'error', error: e }));
    if (cx.estado !== 'ok') return { estado: cx.estado, vinculos: {}, revision: {} };
    // v0.73.0: la reventa (cat_reventa) cuenta en Vivo / Archivado
    const [vinculos, rev, reventa] = await Promise.all([F.leerVinculos(), revision(), FBG.getDocs(FBG.collection(cx.db, 'cat_reventa')).then(sn => sn.docs.map(d => ({ ...d.data(), id: d.id }))).catch(() => [])]);
    return { estado: 'ok', vinculos, revision: rev, reventa };
  })();
  const [coc, gas, cat, vc, vb] = await Promise.all([cocina, gastos, F.catalogosVenta(), ventasCaja(desde, hoy, forzar), ventasB2b(desde, hoy, forzar)]);
  uso.cocina = Math.max(0, Cuota.produccion.usoHoy().lecturas - l0.p);
  uso.finanzas = Math.max(0, Cuota.usoHoy().lecturas - l0.g);
  uso.caja += Math.max(0, Caja.lecturasProductos - l0.cp);
  uso.b2b += cat.lecturas || 0;   // los productos de B2B (si no estaban en la memoria de Finanzas)
  const datos = {
    recetas: coc.recetas || [], caja: Object.values(cat.caja || {}), b2b: cat.b2bEstado === 'ok' ? Object.values(cat.b2b || {}) : [],
    vinculos: gas.vinculos || {}, revision: gas.revision || {}, ventasCaja: vc || {}, ventasB2b: vb.ventas || {}, reventa: gas.reventa || []
  };
  return { hoy, desde, estados: { cocina: coc.estado, gastos: gas.estado, b2b: cat.b2bEstado === 'ok' ? vb.estado : cat.b2bEstado }, datos, vista: armarTodo(datos), uso: { ...uso } };
}
// Vuelve a armar con lo que ya está en memoria (después de un cambio): 0 lecturas
// v0.73.0: Vivo y Archivado cuentan también la reventa (activa = viva; archivada = archivada)
export function armarTodo(datos) {
  const v = CM.armar(datos), r = RV.resumen(datos.reventa || []);
  return { ...v, resumen: { ...v.resumen, vivo: v.resumen.vivo + r.activos, archivado: v.resumen.archivado + r.archivados }, reventa: r };
}
export const rearmar = D => ({ ...D, vista: armarTodo(D.datos) });

// ── Escrituras ──
// "Vivo": cat_revision/{tipo}_{id} = { decision: 'vivo', en, por } (con su historial; nada se borra)
export async function marcarVivo(D, filas) {
  const db = await dbG(), por = yo(), fecha = hoyTxt(), en = new Date().toISOString();
  const lista = (filas || []).filter(f => f && !f.decision);
  if (!lista.length) return 0;
  const b = FBG.writeBatch(db);
  lista.forEach(f => {
    const prev = D.datos.revision[f.clave] || {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { decision: 'vivo', por, en }].slice(-20);
    const d = { tipo: f.grupo, refId: f.id, nombre: f.nombre, decision: 'vivo', por, fecha, historial };
    b.set(FBG.doc(db, 'cat_revision', f.clave), { ...d, en: FBG.serverTimestamp() });
    D.datos.revision[f.clave] = { id: f.clave, ...d, en };
  });
  await b.commit();
  return lista.length;
}
// Archivar (archivar = true) o reactivar (false) un grupo: recetas en fen-produccion, productos de la caja (activo) y de B2B (estado).
// Primero los productos, después las recetas. El guardia de sub recetas lo revisa antes (CM.bloqueos): aquí se vuelve a revisar.
// → { recetas: [...], caja: [...], b2b: [...] } lo que cambió
export async function archivar(D, filas, archivar = true) {
  const R = filas.filter(f => f.grupo === 'recetas'), C = filas.filter(f => f.grupo === 'caja'), Bb = filas.filter(f => f.grupo === 'b2b');
  if (archivar && R.length) {
    const bl = CM.bloqueos(R.map(f => f.id), D.datos.recetas);
    if (bl.length) { const e = new Error(bl.map(b => `${b.nombre}: ${CM.textoBloqueo(b)}`).join(' ')); e.code = 'bloqueo'; e.bloqueos = bl; throw e; }
  }
  const hecho = { recetas: [], caja: [], b2b: [] };
  for (const f of C) {
    const p = D.datos.caja.find(x => x.id === f.id); if (!p || CM.cajaArchivado(p) === archivar) continue;
    await Caja.cambiarActivoProducto(f.id, !archivar);
    p.activo = !archivar; hecho.caja.push(f);
  }
  for (const f of Bb) {
    const p = D.datos.b2b.find(x => x.id === f.id); if (!p || CM.b2bArchivado(p) === archivar) continue;
    await B.archivarProducto(f.id, archivar);
    p.estado = archivar ? 'archivado' : 'activo'; p.cambiadoPor = yo(); p.cambiadoEn = new Date().toISOString(); hecho.b2b.push(f);
  }
  if (R.length) {
    const cambios = await P.archivarRecetas(R.map(f => f.id), archivar);
    D.datos.recetas = await P.recetasCatalogo();   // ya actualizadas en la memoria (0 lecturas)
    hecho.recetas = cambios;
  }
  // Reactivar = está vivo
  if (!archivar) { try { await marcarVivo(D, filas); } catch (e) { console.warn('Catálogo: no se pudo marcar vivo', e); } }
  return hecho;
}
