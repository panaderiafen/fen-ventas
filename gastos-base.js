// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos: base nueva (fen-gastos)  v0.43.0 (etapa G1)
//  · Conexión: la configuración web de fen-gastos se guarda en Firestore de Sistema Fën
//    (config/sistemaFen → gastosFirebase) y una copia en este navegador (para cerrar sesión).
//    No es secreta: solo identifica el proyecto. Lo que protege los datos son las reglas
//    de fen-gastos y tu cuenta (admins/{uid} en fen-gastos).
//  · Copia desde la planilla: el script de Gastos (v2.9.0, op "exportar") entrega las hojas de 2026
//    por partes y gastos-modelo.js arma los documentos. Se escribe solo lo que cambió desde la última
//    copia (migracion/{coleccion} guarda una huella por documento, como en B2B).
//  · En G1 nada cambia en el uso: Gastos sigue leyendo y escribiendo la planilla con el script.
// ═══════════════════════════════════════════════
import { auth as authSF, db as dbSF, doc as docSF, getDoc as getDocSF, runTransaction } from './firebase.js?v=0.138.0';
import * as FB from './fs-gastos.js?v=0.138.0';
import * as Gastos from './gastos.js?v=0.138.0';
import { parsearConfig as parsearB2b } from './b2b.js?v=0.138.0';
import { armar, cambios, comparar, totalesGastos, COLECCIONES, ANIO } from './gastos-modelo.js?v=0.138.0';

export { ANIO };
export const VERSION_EXPORTAR = '2.9.0';   // script de Gastos con la op "exportar" (SistemaFen.gs v1.8.0)
const K_CFG = 'fen_sistema_gastos_cfg';
const LOTE = 400;                          // escrituras por lote (Firestore acepta hasta 500)
const LOTE_BYTES = 4e6;                    // y como máximo ~4 MB por lote (el límite de Firestore es 10 MB)
const PARTE = 15000;                       // huellas por documento de migracion (cada uno queda bajo 1 MB)

// ── Configuración ──────────────────────────────────
export const cfgConocida = () => window.FEN_SIS.firebaseGastos || null;
export function parsearConfig(txt) {
  let cfg;
  try { cfg = parsearB2b(txt); } catch (e) { throw new Error(e.message.replace(/de B2B|B2B/g, 'de Gastos')); }
  if (/b2b|produccion|ventas/.test(cfg.projectId)) throw new Error(`Esa es la configuración de ${cfg.projectId}. Copia la del proyecto fen-gastos.`);
  return cfg;
}
const cfgLocal = () => { try { return JSON.parse(localStorage.getItem(K_CFG) || 'null'); } catch (e) { return null; } };
export async function leerConfig() {
  let cfg = null;
  try { const sn = await getDocSF(docSF(dbSF, 'config', 'sistemaFen')); if (sn.exists()) cfg = sn.data().gastosFirebase || null; } catch (e) { cfg = cfgLocal(); }
  try { if (cfg) localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
  return cfg;
}
export async function guardarConfig(cfg) {
  const ref = docSF(dbSF, 'config', 'sistemaFen');
  await runTransaction(dbSF, async tx => { const sn = await tx.get(ref); tx.set(ref, { ...(sn.exists() ? sn.data() : {}), gastosFirebase: cfg }); });
  try { localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
}

// ── Sesión en fen-gastos ───────────────────────────
// estado: sin_config | sin_sesion | sin_admin | ok
// v0.63.2: el resultado "ok" queda en memoria 10 minutos (antes cada lectura de Gastos y Finanzas volvía a leer config/sistemaFen
// en la base de Sistema Fën y admins/{uid} en fen-gastos: 2 lecturas más por cada pantalla y acción)
let cxMemo = null;
const CX_MS = 600000;
export const olvidarConexion = () => { cxMemo = null; };
export async function conexion() {
  if (cxMemo && Date.now() - cxMemo.t < CX_MS && FB.conectado() && FB.conectado().auth.currentUser && cxMemo.uid === FB.conectado().auth.currentUser.uid) return cxMemo.r;
  const r = await conexion0();
  cxMemo = r.estado === 'ok' ? { t: Date.now(), r, uid: r.uid } : null;
  return r;
}
async function conexion0() {
  const cfg = await leerConfig();
  if (!cfg) return { estado: 'sin_config', sugerida: cfgConocida() };
  const cx = await FB.conectar(cfg);
  const u = cx.auth.currentUser, yo = (authSF.currentUser && authSF.currentUser.email || '').toLowerCase();
  if (!u) return { estado: 'sin_sesion', cfg, correo: yo };
  // Tiene que ser la misma cuenta que está en Sistema Fën
  if ((u.email || '').toLowerCase() !== yo) { await FB.salir(); return { estado: 'sin_sesion', cfg, correo: yo }; }
  let admin = false;
  try { admin = (await FB.getDoc(FB.doc(cx.db, 'admins', u.uid))).exists(); }
  catch (e) { if (!/permission/i.test(e.code || e.message || '')) throw e; }
  if (!admin) return { estado: 'sin_admin', cfg, uid: u.uid, correo: u.email };
  return { estado: 'ok', cfg, uid: u.uid, correo: u.email, db: cx.db };
}
export async function entrar(clave) {
  cxMemo = null;
  const cfg = await leerConfig();
  await FB.conectar(cfg);
  await FB.entrar(authSF.currentUser.email, clave, false);
  return conexion();
}
// Cierra la sesión de fen-gastos (al salir de Sistema Fën o si se revoca el equipo)
export async function salir() {
  cxMemo = null;
  try { if (!FB.conectado()) { const cfg = cfgLocal(); if (!cfg) return; await FB.conectar(cfg); } await FB.salir(); } catch (e) {}
}
async function dbOk() { const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva de Gastos.'); return cx.db; }

// ── Leer la planilla (script de Gastos, por partes) ──
// avance(texto) para mostrar cuánto va. Si la planilla cambia entre una parte y otra (entró un gasto),
// se vuelve a leer desde el principio (hasta 3 veces).
export async function leerPlanilla(anio = ANIO, avance) {
  for (let intento = 1; intento <= 3; intento++) {
    const hojas = {}, vistas = {};
    let cursor = {}, partes = 0, r, cambio = false;
    do {
      r = await Gastos.llamar('exportar', { anio, ...cursor }, null, VERSION_EXPORTAR);
      if (!r.hojas || !Array.isArray(r.orden)) throw new Error('Respuesta inesperada del script de Gastos.');
      partes++;
      for (const [nombre, h] of Object.entries(r.hojas)) {
        if (!h) { hojas[nombre] = null; continue; }
        if (vistas[nombre] !== undefined && vistas[nombre] !== h.filasHoja) { cambio = true; break; }
        vistas[nombre] = h.filasHoja;
        if (!hojas[nombre]) hojas[nombre] = { c: h.c, f: [], total: h.total, nombreReal: h.nombreReal };
        if (h.desde !== hojas[nombre].f.length) { cambio = true; break; }
        hojas[nombre].f.push(...h.f);
      }
      if (cambio) break;
      cursor = r.siguiente ? { hoja: r.siguiente.hoja, fila: r.siguiente.fila } : null;
      if (avance) avance(`Leyendo la planilla… parte ${partes}${r.siguiente ? ` (${r.orden[r.siguiente.hoja]})` : ''}`);
      if (partes > 400) throw new Error('La planilla no terminó de llegar. Prueba de nuevo.');
    } while (cursor);
    if (!cambio) {
      const faltan = Object.entries(hojas).filter(([, h]) => h && h.f.length !== h.total).map(([n]) => n);
      if (faltan.length) throw new Error('No llegaron todas las filas de: ' + faltan.join(', ') + '. Prueba de nuevo.');
      return { anio: r.anio, zona: r.zona, version: r.version, hojas, partes, leido: r.leido };
    }
    if (avance) avance('La planilla cambió mientras se leía (entró un gasto). Se vuelve a leer…');
  }
  throw new Error('La planilla cambió varias veces mientras se leía. Prueba de nuevo en un rato.');
}

// Lo que quedó anotado en la última copia (como B2B): migracion/{coleccion} dice en cuántas partes está;
// cada parte (migracion/{coleccion}-{i}) guarda las huellas como un solo texto JSON.
async function leerHuellas(db) {
  const previas = {};
  await Promise.all(COLECCIONES.map(async col => {
    const sn = await FB.getDoc(FB.doc(db, 'migracion', col));
    const d = sn.exists() ? sn.data() : {};
    previas[col] = {};
    for (let i = 0; i < (d.partes || 0); i++) {
      const p = await FB.getDoc(FB.doc(db, 'migracion', `${col}-${i}`));
      if (p.exists()) Object.assign(previas[col], JSON.parse(p.data().hj || '{}'));
    }
  }));
  return previas;
}
async function guardarHuellas(db, col, mapa) {
  const ids = Object.keys(mapa), partes = Math.max(1, Math.ceil(ids.length / PARTE));
  const b = FB.writeBatch(db);
  for (let i = 0; i < partes; i++) {
    const trozo = {}; ids.slice(i * PARTE, (i + 1) * PARTE).forEach(id => { trozo[id] = mapa[id]; });
    b.set(FB.doc(db, 'migracion', `${col}-${i}`), { hj: JSON.stringify(trozo) });
  }
  b.set(FB.doc(db, 'migracion', col), { partes, total: ids.length, en: FB.serverTimestamp() });
  await b.commit();
}

// Lee la planilla, arma los documentos y compara con la última copia. No escribe nada.
export async function preparar(avance) {
  const db = await dbOk();
  const r = await leerPlanilla(ANIO, avance);
  const armado = armar(r);
  const previas = await leerHuellas(db);
  const cmb = cambios(armado.colecciones, previas);
  const porEscribir = COLECCIONES.reduce((s, c) => s + cmb[c].nuevos.length + cmb[c].cambiados.length + cmb[c].quitar.length, 0);
  return { ...armado, cambios: cmb, previas, porEscribir, leido: r.leido, partes: r.partes };
}

// Escribe lo que cambió, en lotes de hasta 400. avance(hechos, total).
// Después de cada lote se anotan sus huellas: si algo se corta a medias, la próxima copia sabe qué quedó escrito.
export async function copiar(prep, avance) {
  const db = await dbOk();
  const ops = [];
  COLECCIONES.forEach(col => {
    const c = prep.cambios[col];
    [...c.nuevos, ...c.cambiados].forEach(id => { const datos = prep.colecciones[col][id]; ops.push({ t: 'set', col, id, datos, bytes: JSON.stringify(datos).length + 200 }); });
    c.quitar.forEach(id => ops.push({ t: 'quitar', col, id, bytes: 200 }));
  });
  const lotes = [];
  let actual = [], bytes = 0;
  ops.forEach(o => {
    if (actual.length && (actual.length >= LOTE || bytes + o.bytes > LOTE_BYTES)) { lotes.push(actual); actual = []; bytes = 0; }
    actual.push(o); bytes += o.bytes;
  });
  if (actual.length) lotes.push(actual);
  const vivo = {};
  COLECCIONES.forEach(col => { vivo[col] = { ...((prep.previas || {})[col] || {}) }; });
  let hechos = 0;
  for (const lote of lotes) {
    await escribir(db, lote);
    const tocadas = new Set();
    lote.forEach(o => { vivo[o.col][o.id] = o.t === 'set' ? prep.cambios[o.col].huellas[o.id] : 'quitado'; tocadas.add(o.col); });
    for (const col of tocadas) await guardarHuellas(db, col, vivo[col]);
    hechos += lote.length;
    if (avance) avance(hechos, ops.length);
  }
  // Al final, las huellas completas (incluye lo que ya estaba marcado como quitado)
  for (const col of COLECCIONES) await guardarHuellas(db, col, prep.cambios[col].huellas);
  await FB.setDoc(FB.doc(db, 'config', 'migracion'), {
    ultima: FB.serverTimestamp(), por: authSF.currentUser.email, anio: prep.anio, escritos: ops.length,
    totales: prep.totales, avisos: prep.avisos.slice(0, 300), totalAvisos: prep.avisos.length
  });
  return { escritos: ops.length };
}
// Un lote. Si Firestore lo rechaza por las reglas (límite de revisiones por lote) se reintenta de a 10;
// si un documento por marcar como quitado ya no existe (lo borraron en la consola), se salta.
async function escribir(db, lote) {
  const b = FB.writeBatch(db);
  lote.forEach(o => o.t === 'set'
    ? b.set(FB.doc(db, o.col, o.id), { ...o.datos, copiadoEn: FB.serverTimestamp() })
    : b.update(FB.doc(db, o.col, o.id), { quitadoEnPlanilla: true, quitadoEn: FB.serverTimestamp() }));
  try { await b.commit(); }
  catch (e) {
    const c = String(e.code || '');
    if (/permission-denied/.test(c) && lote.length > 10) { for (let i = 0; i < lote.length; i += 10) await escribir(db, lote.slice(i, i + 10)); return; }
    if (/not-found/.test(c) && lote.some(o => o.t === 'quitar')) {
      const sets = lote.filter(o => o.t === 'set');
      if (sets.length) await escribir(db, sets);
      for (const o of lote.filter(x => x.t === 'quitar')) {
        try { await FB.updateDoc(FB.doc(db, o.col, o.id), { quitadoEnPlanilla: true, quitadoEn: FB.serverTimestamp() }); }
        catch (e2) { if (!/not-found/.test(String(e2.code || ''))) throw e2; }
      }
      return;
    }
    throw e;
  }
}

// ── Control de totales ──────────────────────────────
// Base: cuántos documentos hay en cada colección (Firestore los cuenta: 1 lectura por cada 1.000) menos los
// quitados de la planilla; los gastos se leen enteros para sumar por mes (1 lectura por gasto).
export async function totalesBase() {
  const db = await dbOk();
  const porColeccion = {};
  await Promise.all(COLECCIONES.filter(c => c !== 'gastos').map(async col => {
    const [n, q] = await Promise.all([
      FB.getAggregateFromServer(FB.collection(db, col), { n: FB.count() }),
      FB.getDocs(FB.query(FB.collection(db, col), FB.where('quitadoEnPlanilla', '==', true)))
    ]);
    porColeccion[col] = (Number(n.data().n) || 0) - q.size;
  }));
  const [g, ult] = await Promise.all([FB.getDocs(FB.collection(db, 'gastos')), FB.getDoc(FB.doc(db, 'config', 'migracion'))]);
  const docs = g.docs.map(d => d.data());
  porColeccion.gastos = docs.filter(d => !d.quitadoEnPlanilla).length;
  return { porColeccion, gastos: totalesGastos(docs), ultima: ult.exists() ? ult.data() : null };
}
// Planilla (lo leído) contra la base: { ok, filas, diferencias }
export async function control(prep) {
  const base = await totalesBase();
  return { base, ultima: base.ultima, resultado: prep ? comparar(prep.totales, base) : null };
}
// Para el resumen al abrir: la última copia (1 lectura)
export async function ultimaCopia() {
  const db = await dbOk();
  const sn = await FB.getDoc(FB.doc(db, 'config', 'migracion'));
  return sn.exists() ? sn.data() : null;
}

// ═══════════════════════════════════════════════
//  v0.45.0 · Etapa G2: con cuál trabaja Gastos (fen-gastos: config/gastos) y el cambio a la base nueva
//  config/gastos = { fuente: 'planilla' | 'base', desde, por, g2Completo, escritos, historial }
//  · Mientras el cambio no esté habilitado (CAMBIO_HABILITADO en config.js; antes G2_COMPLETO), queda bloqueado y todo sigue
//    exactamente como en la v0.44.0 (fuente "planilla").
//  · Para los pasos 3 y 4 de G2: cada documento hecho o cambiado en la base lleva marcaBase(...) y,
//    después de escribir, se llama notarEscritura() y GastosPlanilla.programar(): así pasa a la planilla
//    y "Volver a la planilla" sabe que ya no se puede.
// ═══════════════════════════════════════════════
// v0.51.0: G2 y G3 completos: CAMBIO_HABILITADO = true en config.js (antes G2_COMPLETO)
export const CAMBIO_HABILITADO = () => window.FEN_SIS.CAMBIO_HABILITADO === true;
// v0.48.0 (G3): también las cargas y documentos del SII (Cargas SII, Detalle Compras y Notas Documentos)
// v0.50.0: también la cartola (cartolas, cartola_cargos y cartola_reglas: script v2.16.0)
// v0.51.0: también Previred (cotizaciones y cotiz_trabajadores: hojas Cotizaciones y Cotizaciones Trabajadores, script v2.17.0)
export const COLECCIONES_PLANILLA = ['gastos', 'vencimientos', 'obligaciones', 'items', 'sii_cargas', 'sii_docs', 'cartolas', 'cartola_cargos', 'cartola_reglas', 'cotizaciones', 'cotiz_trabajadores'];
let fuenteCache = null;
export async function dbBase() { return dbOk(); }
export async function tokenBase() { await dbOk(); return FB.idToken(); }
// Se lee una vez al abrir Gastos (queda en memoria). Sin conexión a la base nueva: "planilla" (como siempre).
export async function cargarFuente(forzar) {
  if (fuenteCache && !forzar) return fuenteCache;
  let cx;
  try { cx = await conexion(); } catch (e) { return { fuente: 'planilla', sinConexion: true }; }
  if (cx.estado !== 'ok') return { fuente: 'planilla', sinConexion: true };
  const ref = FB.doc(cx.db, 'config', 'gastos'), sn = await FB.getDoc(ref);
  let d = sn.exists() ? sn.data() : null;
  if (!d) {   // la primera vez queda escrito cómo está hoy
    d = { fuente: 'planilla', desde: null, por: '', g2Completo: false, escritos: 0, historial: [] };
    try { await FB.setDoc(ref, d); } catch (e) {}
  }
  fuenteCache = { fuente: d.fuente === 'base' ? 'base' : 'planilla', desde: d.desde || null, por: d.por || '', g2Completo: !!d.g2Completo, escritos: Number(d.escritos) || 0, historial: d.historial || [] };
  Gastos.usarFuente(fuenteCache.fuente);   // v0.46.0: Registrar, pagar, registrados y vencimientos van a donde corresponde
  return fuenteCache;
}
export const fuenteGastos = () => (fuenteCache && fuenteCache.fuente) || 'planilla';
export const olvidarFuente = () => { fuenteCache = null; };
// Campos que lleva cada documento hecho o cambiado en la base (pasos 3 y 4)
export const marcaBase = por => ({ planillaPendiente: false, hechoEnBase: true, editado: { en: FB.serverTimestamp(), por: por || (authSF.currentUser && authSF.currentUser.email) || '' } });
export async function notarEscritura(n = 1) {
  const db = await dbOk(), ref = FB.doc(db, 'config', 'gastos');
  await FB.runTransaction(db, async tx => { const sn = await tx.get(ref); const d = sn.exists() ? sn.data() : {}; tx.set(ref, { ...d, escritos: (Number(d.escritos) || 0) + n, ultimaEscritura: FB.serverTimestamp() }); });
  if (fuenteCache) fuenteCache.escritos += n;
}
const quien = () => (authSF.currentUser && authSF.currentUser.email) || '';
async function guardarFuente(db, fuente, extra) {
  const ref = FB.doc(db, 'config', 'gastos'), sn = await FB.getDoc(ref), d = sn.exists() ? sn.data() : {};
  const historial = (Array.isArray(d.historial) ? d.historial : []).slice(-20).concat([{ fuente, en: new Date().toISOString(), por: quien() }]);
  await FB.setDoc(ref, { ...d, ...extra, fuente, por: quien(), historial });
  fuenteCache = null;
  return cargarFuente(true);
}
// Pasar Gastos a la base nueva. avance(texto). Orden:
//  1. el script deja de aceptar escrituras en la planilla (nada nuevo entra mientras se copia);
//  2. se lee la planilla, se copia lo que falte y se hace el control de totales;
//  3. solo con "Todo cuadra" queda config/gastos en "base". Si algo falla, el script vuelve a la planilla.
export async function cambiarABase(avance = () => {}) {
  if (!CAMBIO_HABILITADO()) throw new Error('El cambio se habilita cuando estén listos G2 y G3.');
  const db = await dbOk();
  const f = await cargarFuente(true);
  if (f.fuente === 'base') return { ya: true, fuente: f };
  avance('Cerrando la planilla: desde ahora la app antigua ya no registra gastos…');
  await Gastos.cambioFuente('base');
  try {
    const prep = await preparar(avance);
    let escritos = 0;
    if (prep.porEscribir) escritos = (await copiar(prep, (h, t) => avance(`Copiando a la base nueva… ${h.toLocaleString('es-CL')} de ${t.toLocaleString('es-CL')}`))).escritos;
    avance('Control de totales…');
    const c = await control(prep);
    if (!c.resultado || !c.resultado.ok) {
      const d = (c.resultado && c.resultado.diferencias) || [];
      throw Object.assign(new Error(`El control de totales no cuadra (${d.length} ${d.length === 1 ? 'diferencia' : 'diferencias'}: ${d.slice(0, 4).map(x => x.que).join(' · ')}). No se cambió nada: Gastos sigue con la planilla.`), { code: 'no_cuadra', control: c });
    }
    const fuente = await guardarFuente(db, 'base', { desde: FB.serverTimestamp(), g2Completo: true, escritos: 0 });
    return { ok: true, escritos, control: c, fuente, prep };
  } catch (e) {
    try { await Gastos.cambioFuente('planilla'); }
    catch (e2) { e.message += ` Ojo: el script de Gastos quedó cerrado para escribir (${e2.message}). Presiona "Pasar Gastos a la base nueva" de nuevo o vuelve a la planilla.`; }
    throw e;
  }
}
// ¿Se puede volver a la planilla? Solo si desde el cambio no se hizo nada en la base nueva.
export async function puedeVolver() {
  const db = await dbOk(), f = await cargarFuente(true);
  if (f.fuente !== 'base') return { puede: false, motivo: 'Gastos ya trabaja con la planilla.' };
  let hechos = f.escritos;
  if (!hechos) {
    for (const col of COLECCIONES_PLANILLA) {
      const q = await FB.getDocs(FB.query(FB.collection(db, col), FB.where('hechoEnBase', '==', true), FB.limit(1)));
      if (q.size) { hechos = 1; break; }
    }
  }
  if (hechos) return { puede: false, motivo: 'Desde el cambio ya se registraron o cambiaron cosas en la base nueva. Volver a la planilla las dejaría fuera (la app antigua no las ve), así que Gastos sigue en la base nueva. Si algo anda mal, avísame y lo vemos.' };
  return { puede: true };
}
export async function volverAPlanilla() {
  const v = await puedeVolver();
  if (!v.puede) throw Object.assign(new Error(v.motivo), { code: 'no_vuelve' });
  await Gastos.cambioFuente('planilla');
  return guardarFuente(await dbOk(), 'planilla', { desde: FB.serverTimestamp() });
}
