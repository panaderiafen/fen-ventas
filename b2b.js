// ═══════════════════════════════════════════════
//  Sistema Fën — Ventas B2B: base nueva (fen-b2b)  v0.11.0
//  · Conexión: la configuración web de fen-b2b se guarda en Firestore de Sistema Fën
//    (config/sistemaFen → b2bFirebase) y una copia en este navegador (para cerrar sesión).
//    No es secreta: solo identifica el proyecto. Lo que protege los datos son las reglas
//    de fen-b2b y la cuenta de administración (admins/{uid} en fen-b2b).
//  · Copia desde la planilla: el script de B2B (v2.3.0) entrega las hojas y aquí se
//    arman los documentos (b2b-modelo.js). Se escribe solo lo que cambió desde la
//    última copia (migracion/{coleccion} guarda una huella por documento).
// ═══════════════════════════════════════════════
import { auth as authSF, db as dbSF, doc as docSF, getDoc as getDocSF, runTransaction } from './firebase.js?v=0.138.0';
import * as FB from './firebase-b2b.js?v=0.138.0';
import * as Apps from './apps.js?v=0.138.0';
import * as Mem from './fs-memoria.js?v=0.138.0';   // v0.63.3: memoria de lo que lee Hoy (fen-b2b tiene su propia cuota)
import { armar, cambios, COLECCIONES, precioEsDe, aplicarUniones } from './b2b-modelo.js?v=0.138.0';
import { distanciaTef } from './feriados-cl.js?v=0.138.0';   // v0.63.4: días hábiles para cruzar transferencias
import * as CB from './gastos-cartola.js?v=0.138.0';   // v0.67.7: las mismas reglas de "el mismo movimiento" que los cargos
import * as RC from './reglas-conc.js?v=0.138.0';
import { cuadreCartola } from './gn-modelo.js?v=0.138.0';   // v0.109.0: el cuadre de saldo de la cartola (el mismo de Gastos)   // v0.69.0: las reglas de conciliación de Abonos (config/conciliacion.reglasConc)

export const VERSION_MINIMA = '2.3.0';   // script de B2B con la copia (SistemaFen.gs v1.1.0)
export const VERSION_BASE_NUEVA = '2.5.0';   // script que pasa la base nueva a la planilla (SistemaFen.gs v1.3.0: también clientes y productos)
const K_CFG = 'fen_sistema_b2b_cfg';
const LOTE = 400;                        // escrituras por lote (Firestore acepta hasta 500)
const LOTE_BYTES = 4e6;                  // y como máximo ~4 MB por lote (el límite de Firestore es 10 MB)
const PARTE = 15000;                     // huellas por documento de migracion (cada uno queda bajo 1 MB)

// Contador de esta sesión (para mostrar cuánto gasta cada cosa)
export const uso = { lecturas: 0, escrituras: 0 };

// ── Configuración ──────────────────────────────────
// Acepta lo que muestra la consola de Firebase (const firebaseConfig = { apiKey: "…", … }) o JSON.
export function parsearConfig(txt) {
  const cfg = {};
  String(txt || '').replace(/["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId)["']?\s*:\s*["']([^"']+)["']/g, (m, k, v) => { cfg[k] = v.trim(); return m; });
  if (!cfg.projectId || !cfg.apiKey || !cfg.appId || !cfg.authDomain) throw new Error('No se encontró la configuración completa. Copia todo el bloque "const firebaseConfig = { … }" de la consola de Firebase.');
  if (!/^[a-z0-9-]{4,40}$/.test(cfg.projectId)) throw new Error('El projectId no se ve bien: ' + cfg.projectId);
  if (cfg.projectId === (window.FEN_SIS.firebase || {}).projectId) throw new Error('Esa es la configuración de la caja (fen-ventas). Copia la del proyecto nuevo de B2B.');
  if (!/^AIza[\w-]{30,}$/.test(cfg.apiKey)) throw new Error('El apiKey no se ve bien.');
  if (!/\.firebaseapp\.com$|\.web\.app$/.test(cfg.authDomain)) throw new Error('El authDomain no se ve bien: ' + cfg.authDomain);
  return cfg;
}
const cfgLocal = () => { try { return JSON.parse(localStorage.getItem(K_CFG) || 'null'); } catch (e) { return null; } };
export async function leerConfig() {
  let cfg = null;
  try { const sn = await getDocSF(docSF(dbSF, 'config', 'sistemaFen')); if (sn.exists()) cfg = sn.data().b2bFirebase || null; } catch (e) { cfg = cfgLocal(); }
  cfg = cfg || window.FEN_SIS.firebaseB2B || null;
  try { if (cfg) localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
  return cfg;
}
export async function guardarConfig(cfg) {
  const ref = docSF(dbSF, 'config', 'sistemaFen');
  await runTransaction(dbSF, async tx => {
    const sn = await tx.get(ref);
    tx.set(ref, { ...(sn.exists() ? sn.data() : {}), b2bFirebase: cfg });
  });
  try { localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
}

// ── Sesión en fen-b2b ──────────────────────────────
// estado: sin_config | sin_sesion | sin_admin | ok
// v0.63.3: "conectada y eres administración" queda 10 minutos en memoria (Hoy preguntaba 5 veces por apertura: 1 lectura en
// fen-b2b y 1 en la caja cada vez)
let cxMem = null;
export function conexion() {
  const u = FB.conectado && FB.conectado() && FB.conectado().auth.currentUser;
  if (cxMem && Date.now() - cxMem.t < Mem.TTL && Date.now() >= cxMem.t && (!cxMem.uid || (u && u.uid === cxMem.uid))) return cxMem.p;
  const yo = { t: Date.now() };
  yo.p = conexionLeer().then(r => { if (cxMem === yo) { if (r.estado === 'ok') yo.uid = r.uid; else cxMem = null; } return r; }, e => { if (cxMem === yo) cxMem = null; throw e; });
  cxMem = yo;
  return yo.p;
}
// config/b2b (¿está activa?): 2 minutos en memoria
async function configB2b(db) {
  return Mem.memo('b2b:config', async () => { const c = await FB.getDoc(FB.doc(db, 'config', 'b2b')); uso.lecturas++; return c.exists() ? c.data() : null; }, { ttl: 120000 });
}
async function conexionLeer() {
  const cfg = await leerConfig();
  if (!cfg) return { estado: 'sin_config' };
  const cx = await FB.conectar(cfg);
  const u = cx.auth.currentUser, yo = (authSF.currentUser && authSF.currentUser.email || '').toLowerCase();
  if (!u) return { estado: 'sin_sesion', cfg, correo: yo };
  // Tiene que ser la misma cuenta que está en Sistema Fën
  if ((u.email || '').toLowerCase() !== yo) { await FB.salir(); return { estado: 'sin_sesion', cfg, correo: yo }; }
  let admin = false;
  try { admin = (await FB.getDoc(FB.doc(cx.db, 'admins', u.uid))).exists(); uso.lecturas++; }
  catch (e) { if (!/permission/i.test(e.code || e.message || '')) throw e; }
  if (!admin) return { estado: 'sin_admin', cfg, uid: u.uid, correo: u.email };
  return { estado: 'ok', cfg, uid: u.uid, correo: u.email, db: cx.db };
}
export async function entrar(clave, soloSesion) {
  cxMem = null; Mem.olvidar('b2b:');
  const cfg = await leerConfig();
  await FB.conectar(cfg);
  await FB.entrar(authSF.currentUser.email, clave, soloSesion);
  return conexion();
}
// Cierra la sesión de fen-b2b (al salir de Sistema Fën o si se revoca el equipo)
export async function salir() {
  cxMem = null; Mem.olvidar('b2b:');
  try {
    if (!FB.conectado()) { const cfg = cfgLocal(); if (!cfg) return; await FB.conectar(cfg); }
    await FB.salir();
  } catch (e) {}
}

// ── Leer la planilla (script de B2B) ───────────────
export async function leerPlanilla() {
  const url = (await Apps.leerConexiones()).b2b;
  if (!url) { const e = new Error('Falta la dirección del script de B2B (Configuración → Conexiones).'); e.code = 'sin_url'; throw e; }
  const v = await Apps.probar('b2b', url, VERSION_MINIMA);
  if (!v.ok) { const e = new Error(v.version ? `El script de B2B está en v${v.version}: para copiar necesita v${VERSION_MINIMA} (ver README).` : v.texto); e.code = 'actualizar'; throw e; }
  const cuerpo = JSON.stringify({ action: 'sistema_fen_b2b', accion: 'sistema_fen_b2b', op: 'exportar', idToken: await authSF.currentUser.getIdToken() });
  const pedir = (u, o) => Promise.race([fetch(u, o).then(x => x.json()), new Promise((_, no) => setTimeout(() => no(new Error('El script no respondió en 3 minutos. Prueba de nuevo.')), 180000))]);
  let r = await pedir(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo });
  if (r && r.code === 'version') r = await pedir(url + '?p=' + encodeURIComponent(cuerpo), {});
  if (!r || !r.ok || !r.hojas) throw new Error((r && (r.error || r.msg)) || 'Respuesta inesperada del script de B2B.');
  return r;
}

// Lo que quedó anotado en la última copia: migracion/{coleccion} dice en cuántas partes está;
// cada parte (migracion/{coleccion}-{i}) guarda las huellas como un solo texto JSON
// (un texto no tiene el límite de 20.000 campos de un documento y no se indexa).
async function leerHuellas(db) {
  const previas = {};
  await Promise.all(COLECCIONES.map(async col => {
    const sn = await FB.getDoc(FB.doc(db, 'migracion', col)); uso.lecturas++;
    const d = sn.exists() ? sn.data() : {};
    previas[col] = {};
    for (let i = 0; i < (d.partes || 0); i++) {
      const p = await FB.getDoc(FB.doc(db, 'migracion', `${col}-${i}`)); uso.lecturas++;
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
  await b.commit(); uso.escrituras += partes + 1;
}

// Lee la planilla, arma los documentos y compara con la última copia. No escribe nada.
export async function preparar(desdeCambio) {
  const cx = await conexion();
  if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva.');
  if (!desdeCambio) { const m = await FB.getDoc(FB.doc(cx.db, 'config', 'b2b')); uso.lecturas++; if (m.exists() && m.data().activa) throw new Error('La base nueva ya está en uso: ahora la planilla es la copia, así que ya no se copia desde ella.'); }
  const r = await leerPlanilla();
  const armado = armar(r.hojas);
  const previas = await leerHuellas(cx.db);
  const cmb = cambios(armado.docs, previas);
  const porEscribir = COLECCIONES.reduce((s, c) => s + cmb[c].nuevos.length + cmb[c].cambiados.length + cmb[c].quitar.length, 0);
  return { ...armado, cambios: cmb, previas, porEscribir, siguienteOrden: Number(r.siguienteOrden) || 0, leido: r.leido, msScript: r.ms };
}

// Escribe lo que cambió, en lotes. avance(hechos, total) para la barra.
// Después de cada lote se anotan sus huellas: si algo se corta a medias, la próxima copia
// sabe exactamente qué quedó escrito (y puede marcar como quitado lo que salga de la planilla).
export async function copiar(prep, avance) {
  const cx = await conexion();
  if (cx.estado !== 'ok') throw new Error('Se perdió la conexión con la base nueva. Vuelve a entrar.');
  const db = cx.db;
  // Lo que solo existe en la base nueva (quién la creó o editó en la app de logística, anulación) no se pierde
  // si se vuelve a copiar después de "Volver a la app antigua"
  const propios = {};
  for (const [campo, op, val] of [['origen.app', '==', 'logistica'], ['editada.veces', '>=', 1], ['estado', '==', 'anulada']]) {
    const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where(campo, op, val)));
    uso.lecturas += Math.max(1, sn.size);
    sn.docs.forEach(d => { const x = d.data(), k = {}; ['creada', 'editada', 'anulada', 'origen'].forEach(c => { if (x[c] !== undefined) k[c] = x[c]; }); if (x.estado === 'anulada') k.estado = 'anulada'; propios[d.id] = k; });
  }
  // v0.13: lo mismo para clientes y productos (historial de precios, quién lo creó o cambió en Sistema Fën)
  const propiosCat = { clientes: {}, productos: {} };
  for (const col of ['clientes', 'productos']) {
    if (!prep.cambios[col] || !prep.cambios[col].cambiados.length) continue;
    const sn = await FB.getDocs(FB.collection(db, col));
    uso.lecturas += Math.max(1, sn.size);
    sn.docs.forEach(d => { const x = d.data(), k = {}; ['historialPrecios', 'creadoEn', 'creadoPor', 'cambiadoEn', 'cambiadoPor'].forEach(c => { if (x[c] !== undefined) k[c] = x[c]; }); if (x.origen && x.origen.app) k.origen = x.origen; if (Object.keys(k).length) propiosCat[col][d.id] = k; });
  }
  const ops = [];
  COLECCIONES.forEach(col => {
    const c = prep.cambios[col];
    [...c.nuevos, ...c.cambiados].forEach(id => { const extra = col === 'ordenes' ? propios[id] : propiosCat[col] && propiosCat[col][id]; const datos = extra ? { ...prep.docs[col][id], ...extra } : prep.docs[col][id]; ops.push({ t: 'set', col, id, datos, bytes: JSON.stringify(datos).length + 200 }); });
    c.quitar.forEach(id => ops.push({ t: 'quitar', col, id, bytes: 200 }));
  });
  // Lotes de hasta 400 escrituras y ~4 MB
  const lotes = [];
  let actual = [], bytes = 0;
  ops.forEach(o => {
    if (actual.length && (actual.length >= LOTE || bytes + o.bytes > LOTE_BYTES)) { lotes.push(actual); actual = []; bytes = 0; }
    actual.push(o); bytes += o.bytes;
  });
  if (actual.length) lotes.push(actual);
  const vivo = {};
  const previas = prep.previas || {};
  COLECCIONES.forEach(col => { vivo[col] = { ...(previas[col] || {}) }; });
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
  const b = FB.writeBatch(db);
  // El contador del N° de orden nunca retrocede
  const cont = await FB.getDoc(FB.doc(db, 'contadores', 'ordenes')); uso.lecturas++;
  const sig = Math.max(prep.siguienteOrden || 0, cont.exists() ? Number(cont.data().siguiente) || 0 : 0);
  b.set(FB.doc(db, 'contadores', 'ordenes'), { siguiente: sig, desde: 'planilla', en: FB.serverTimestamp() });
  b.set(FB.doc(db, 'config', 'migracion'), {
    ultima: FB.serverTimestamp(), por: authSF.currentUser.email, planilla: prep.planilla,
    escritos: ops.length, avisos: prep.avisos.slice(0, 300), totalAvisos: prep.avisos.length
  });
  await b.commit(); uso.escrituras += 2;
  return { escritos: ops.length };
}
// Un lote. Si Firestore lo rechaza por las reglas (límite de revisiones por lote) se reintenta
// de a 10; si un documento por marcar como quitado ya no existe (lo borraron en la consola), se salta.
async function escribir(db, lote) {
  const b = FB.writeBatch(db);
  lote.forEach(o => o.t === 'set'
    ? b.set(FB.doc(db, o.col, o.id), { ...o.datos, copiadoEn: FB.serverTimestamp() })
    : b.update(FB.doc(db, o.col, o.id), { quitadoEnPlanilla: true, quitadoEn: FB.serverTimestamp() }));
  try { await b.commit(); uso.escrituras += lote.length; }
  catch (e) {
    const c = String(e.code || '');
    if (/permission-denied/.test(c) && lote.length > 10) { for (let i = 0; i < lote.length; i += 10) await escribir(db, lote.slice(i, i + 10)); return; }
    if (/not-found/.test(c) && lote.some(o => o.t === 'quitar')) {
      const sets = lote.filter(o => o.t === 'set');
      if (sets.length) await escribir(db, sets);
      for (const o of lote.filter(x => x.t === 'quitar')) {
        try { await FB.updateDoc(FB.doc(db, o.col, o.id), { quitadoEnPlanilla: true, quitadoEn: FB.serverTimestamp() }); uso.escrituras++; }
        catch (e2) { if (!/not-found/.test(String(e2.code || ''))) throw e2; }
      }
      return;
    }
    throw e;
  }
}

// Totales de la base nueva calculados por Firestore (cuestan 1 lectura por cada 1.000 documentos)
export async function totales() {
  const cx = await conexion();
  if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva.');
  // Firestore suma toda la colección (sin filtro: un filtro + una suma necesitaría un índice compuesto);
  // después se restan los pocos documentos marcados como quitados de la planilla.
  const db = cx.db;
  // Una agregación por consulta: Firestore pide un índice compuesto si se suman dos campos juntos
  const agg = async (col, campos) => {
    const partes = await Promise.all(Object.entries(campos).map(async ([k, c]) => (await FB.getAggregateFromServer(FB.collection(db, col), { [k]: c })).data()));
    return Object.assign({}, ...partes);
  };
  const quitados = async col => { const sn = await FB.getDocs(FB.query(FB.collection(db, col), FB.where('quitadoEnPlanilla', '==', true))); uso.lecturas += Math.max(1, sn.size); return sn.docs.map(d => d.data()); };
  const menos = (r, qs, campos) => { const o = { n: r.n - qs.length }; campos.forEach(c => { o[c] = (Number(r[c]) || 0) - qs.reduce((s, d) => s + (Number(d[c]) || 0), 0); }); return o; };
  const [o, a, c, p, e, qo, qa, qc, qp, qe, ult] = await Promise.all([
    agg('ordenes', { n: FB.count(), total: FB.sum('total'), neto: FB.sum('neto') }),
    agg('abonos', { n: FB.count(), monto: FB.sum('monto') }),
    agg('clientes', { n: FB.count() }), agg('productos', { n: FB.count() }), agg('ediciones', { n: FB.count() }),
    quitados('ordenes'), quitados('abonos'), quitados('clientes'), quitados('productos'), quitados('ediciones'),
    FB.getDoc(FB.doc(db, 'config', 'migracion'))
  ]);
  uso.lecturas += Math.ceil((o.n + 1) / 1000) + Math.ceil((a.n + 1) / 1000) + 4;
  const O = menos(o, qo, ['total', 'neto']), A = menos(a, qa, ['monto']);
  return {
    base: { ordenes: O.n, total: O.total, neto: O.neto, abonos: A.n, abonosMonto: A.monto, clientes: c.n - qc.length, productos: p.n - qp.length, ediciones: e.n - qe.length },
    ultima: ult.exists() ? ult.data() : null
  };
}

// ── Mirar órdenes en la base nueva (para revisar la copia) ─
const conId = s => ({ id: s.id, ...s.data() });
// Más recientes primero por fecha de la orden (una orden editada no cambia de lugar)
const porFechaDesc = (a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.n - a.n;
export async function ultimasOrdenes(n = 30) {
  const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva.');
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'ordenes'), FB.orderBy('n', 'desc'), FB.limit(n)));
  uso.lecturas += Math.max(1, sn.size);
  return sn.docs.map(conId).sort(porFechaDesc);
}
// v0.15.1: también por nombre del cliente (o razón social), solo o con un mes: "café uno" o "café uno 2026-09"
const sinTildes = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
export function clientesQueCalzan(texto, clientes) {
  const t = sinTildes(texto); if (t.length < 2) return [];
  const l = (clientes || []).filter(c => sinTildes(c.nombre).includes(t) || sinTildes(c.razonSocial).includes(t));
  const exacto = l.filter(c => sinTildes(c.nombre) === t);
  return exacto.length ? exacto : l;
}
export async function buscarOrdenes(q, clientes) {
  const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva.');
  const t = String(q || '').trim();
  let docs = [];
  const mesEn = t.match(/(?:^|\s)(\d{4}-\d{2})$/), nombre = mesEn ? t.slice(0, mesEn.index).trim() : t;
  if (/[a-záéíóúñü]/i.test(nombre)) {
    const cs = clientesQueCalzan(nombre, clientes);
    if (!cs.length) throw new Error(`No hay clientes que digan "${nombre}".`);
    if (cs.length > 5) throw new Error(`"${nombre}" calza con ${cs.length} clientes (${cs.slice(0, 5).map(c => c.nombre).join(', ')}…): escribe más del nombre.`);
    const vistos = new Set(), mes = mesEn ? mesEn[1] : null;
    for (const c of cs) {
      // Por clienteId y también por el nombre (órdenes antiguas sin clienteId)
      const qs = [FB.where('clienteId', '==', c.id), FB.where('cliente', '==', c.nombre)].map(w => FB.query(FB.collection(cx.db, 'ordenes'), w, ...(mes ? [FB.where('mes', '==', mes)] : [])));
      for (const sn of await Promise.all(qs.map(x => FB.getDocs(x)))) sn.docs.forEach(d => { if (!vistos.has(d.id)) { vistos.add(d.id); docs.push(conId(d)); } });
    }
  } else if (/^\d{4}-\d{2}$/.test(t)) {
    const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'ordenes'), FB.where('mes', '==', t))); docs = sn.docs.map(conId);
  } else if (/^\d+$/.test(t)) {
    const [o, f] = await Promise.all([FB.getDoc(FB.doc(cx.db, 'ordenes', String(Number(t)))), FB.getDocs(FB.query(FB.collection(cx.db, 'ordenes'), FB.where('folio', '==', t), FB.limit(50)))]);
    if (o.exists()) docs.push(conId(o));
    f.docs.forEach(d => { if (d.id !== o.id) docs.push(conId(d)); });
  } else throw new Error('Escribe un N° de orden, un folio, un mes (AAAA-MM) o el nombre del cliente.');
  uso.lecturas += Math.max(1, docs.length);
  return docs.sort(porFechaDesc);
}

// ── v0.63.5 · Buscar por monto ─────────────────────
// "$12.500", "$12500", "$ 12.500", "$12.500,5" (los decimales no cuentan) → ese monto exacto.
// "$12.000-15.000" o "$12000 - 15000" → entre los dos (incluidos; da lo mismo el orden).
// Sin "$" al inicio → null (la búsqueda de siempre). Con "$" pero sin un monto claro → { error }.
const milesCL = n => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export function parseBusquedaMonto(q) {
  const t = String(q ?? '').trim();
  if (!t.startsWith('$')) return null;
  const uno = s => {
    let x = String(s).replace(/\s+/g, '').replace(/^\$/, '').replace(/,\d*$/, '');
    if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '');
    return /^\d+$/.test(x) ? Number(x) : NaN;
  };
  const partes = t.slice(1).split('-'), error = 'Escribe el monto después de "$": $12.500, o un rango: $12.000-15.000.';
  if (partes.length > 2) return { error };
  const ns = partes.map(uno);
  if (ns.some(n => !Number.isFinite(n))) return { error };
  const min = Math.min(...ns), max = Math.max(...ns);
  return { min, max, texto: min === max ? milesCL(min) : `${milesCL(min)} a ${milesCL(max)}` };
}
// ¿El valor (redondeado a pesos) está dentro de la búsqueda?
export function calzaMonto(m, v) {
  if (!m || m.error || v === '' || v == null) return false;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= m.min && n <= m.max;
}
// Órdenes (ya leídas) cuyo total calza; sin repetir y más recientes primero
export function ordenesPorMonto(ordenes, m) {
  const vistas = new Map();
  (ordenes || []).forEach(o => { if (o && calzaMonto(m, o.total) && !vistas.has(String(o.n))) vistas.set(String(o.n), o); });
  return [...vistas.values()].sort(porFechaDesc);
}

// ═══════════════════════════════════════════════
//  v0.12.0 · Base nueva en uso: administración de B2B en Sistema Fën
// ═══════════════════════════════════════════════
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ahoraTxt = (d = new Date()) => `${hoyTxt(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
async function dbOk() { const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva (Ventas a empresas → Base nueva).'); return cx.db; }

// config/b2b: { activa, scriptUrl, desde, por }
export async function modo() {
  const db = await dbOk();
  const sn = await FB.getDoc(FB.doc(db, 'config', 'b2b')); uso.lecturas++;
  return sn.exists() ? sn.data() : { activa: false };
}
async function llamarScript(url, cuerpo) {
  const pedir = (u, o) => Promise.race([fetch(u, o).then(x => x.json()), new Promise((_, no) => setTimeout(() => no(new Error('El script de B2B no respondió a tiempo.')), 120000))]);
  const txt = JSON.stringify(cuerpo);
  let r = await pedir(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: txt });
  if (r && r.code === 'version') r = await pedir(url + '?p=' + encodeURIComponent(txt), {});
  return r;
}
async function scriptListo() {
  const url = (await Apps.leerConexiones()).b2b;
  if (!url) throw new Error('Falta la dirección del script de B2B (Configuración → Conexiones).');
  const v = await Apps.probar('b2b', url, VERSION_BASE_NUEVA);
  if (!v.ok) throw new Error(v.version ? `El script de B2B está en v${v.version}: necesita v${VERSION_BASE_NUEVA} (ver README).` : v.texto);
  return url;
}
async function scriptModo(url, activo) {
  const r = await llamarScript(url, { action: 'sistema_fen_b2b', accion: 'sistema_fen_b2b', op: 'modo', activo, idToken: await authSF.currentUser.getIdToken() });
  if (!r || !r.ok) throw new Error((r && (r.error || r.msg)) || 'El script no respondió bien.');
  return r;
}

// Cambiar a la base nueva: 1) la app antigua queda solo para mirar, 2) última copia de la planilla,
// 3) el N° de orden sigue desde el último, 4) se activa para la app de logística.
export async function cambiarABaseNueva(avance) {
  const db = await dbOk();
  const paso = t => avance && avance(t);
  paso('Revisando el script de B2B…');
  const ya = await FB.getDoc(FB.doc(db, 'config', 'b2b')); uso.lecturas++;
  if (ya.exists() && ya.data().activa) throw new Error('La base nueva ya está en uso (se cambió desde otro equipo). Recarga la página.');
  const url = await scriptListo();
  try {
    paso('Dejando la app antigua solo para mirar…');
    const m = await scriptModo(url, true);
    paso('Leyendo la planilla por última vez…');
    const prep = await preparar(true);
    if (prep.porEscribir) { paso(`Copiando ${prep.porEscribir} cambios…`); await copiar(prep, (h, n) => paso(`Copiando… ${h} de ${n}`)); }
    const cont = await FB.getDoc(FB.doc(db, 'contadores', 'ordenes')); uso.lecturas++;
    const sig = Math.max(Number(m.siguienteOrden) || 0, prep.siguienteOrden || 0, cont.exists() ? Number(cont.data().siguiente) || 0 : 0);
    const b = FB.writeBatch(db);
    b.set(FB.doc(db, 'contadores', 'ordenes'), { siguiente: sig, desde: 'cambio', en: FB.serverTimestamp() });
    b.set(FB.doc(db, 'config', 'b2b'), { activa: true, scriptUrl: url, desde: FB.serverTimestamp(), por: authSF.currentUser.email });
    await b.commit(); uso.escrituras += 2; Mem.olvidar('b2b:');
    return { siguiente: sig, copiados: prep.porEscribir };
  } catch (e) {
    try { await scriptModo(url, false); } catch (e2) {}
    throw new Error('No se pudo cambiar (la app antigua sigue como siempre): ' + (e.message || e));
  }
}
// Volver a la app antigua: solo si todo lo de la base nueva ya pasó a la planilla
export async function volverAPlanilla() {
  // v0.73.0: la copia a la planilla está apagada; volver dejaría fuera lo hecho desde entonces
  if (PLANILLA_APAGADA) throw new Error('Desde la v0.73.0 la planilla de B2B ya no recibe copia: volver a la app antigua dejaría fuera lo hecho desde entonces.');
  const db = await dbOk();
  const url = await scriptListo();
  await pasarAPlanilla();
  let pend = 0;
  for (const col of ['ordenes', 'abonos', 'ediciones', 'clientes', 'productos', 'movimientos']) {
    const sn = await FB.getDocs(FB.query(FB.collection(db, col), FB.where('planillaPendiente', '==', true)));
    uso.lecturas += Math.max(1, sn.size); pend += sn.size;
  }
  if (pend) throw new Error(`Hay ${pend} cambios que todavía no pasan a la planilla. Presiona "Pasar ahora" (en Órdenes) y vuelve a intentar.`);
  await FB.setDoc(FB.doc(db, 'config', 'b2b'), { activa: false, scriptUrl: url, hasta: FB.serverTimestamp(), por: authSF.currentUser.email }); uso.escrituras++; Mem.olvidar('b2b:');
  await scriptModo(url, false);
}

// Pasa a la planilla lo pendiente (el script lee la base nueva con esta sesión de fen-b2b)
// v0.73.0 (Etapa 1): COPIA APAGADA. Lo hecho en Sistema Fën ya no se marca (planillaPendiente = false) ni se manda al script
// (b2b_planilla). La planilla de B2B queda como estaba (historial). Se deja la función para no romper a quien la llama.
export const PLANILLA_APAGADA = true;
export async function pasarAPlanilla() {
  if (PLANILLA_APAGADA) return { ok: true, apagada: true, ordenes: 0, abonos: 0, ediciones: 0, clientes: 0, productos: 0 };
  const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva.');
  const m = await modo();
  const url = m.scriptUrl || (await Apps.leerConexiones()).b2b;
  if (!url) throw new Error('Falta la dirección del script de B2B.');
  const r = await llamarScript(url, { action: 'b2b_planilla', accion: 'b2b_planilla', idToken: await FB.conectado().auth.currentUser.getIdToken() });
  if (!r || !r.ok) throw new Error((r && (r.error || r.msg)) || 'El script no respondió bien.');
  return r;
}

// ── Escuchas en vivo (órdenes por facturar y por cobrar, abonos, solicitudes) ──
export async function escuchar(cb) {
  const db = await dbOk();
  const datos = { ordenes: new Map(), abonos: [], solicitudes: [], config: null, clientes: [], productos: [], movimientos: [], favor: [], conciliacion: null, conciliacionLeida: false, cobranza: {}, listo: { a: 0 }, consultas: new Set() };
  const avisar = () => cb(datos);
  const desde = hoyTxt(new Date(Date.now() - 7 * 864e5));   // v0.14.1: 7 días (antes 30): lo pendiente llega por sus propias consultas; así lee mucho menos
  const juntar = clave => sn => {
    uso.lecturas += sn.docChanges().length || 1; datos.consultas.add(clave);   // v0.111.0: qué consultas en vivo ya llegaron
    sn.docChanges().forEach(c => {
      if (c.type === 'removed') { const o = datos.ordenes.get(c.doc.id); if (o) { o._de.delete(clave); if (!o._de.size) datos.ordenes.delete(c.doc.id); } }
      else { const prev = datos.ordenes.get(c.doc.id); datos.ordenes.set(c.doc.id, { id: c.doc.id, ...c.doc.data(), _de: new Set([...(prev ? prev._de : []), clave]) }); }
    });
    avisar();
  };
  const err = e => cb(datos, e);
  const fin = [
    FB.onSnapshot(FB.query(FB.collection(db, 'ordenes'), FB.where('sinFolio', '==', true)), juntar('sinFolio'), err),
    FB.onSnapshot(FB.query(FB.collection(db, 'ordenes'), FB.where('estadoPago', 'in', ['PENDIENTE', 'PARCIAL'])), juntar('porCobrar'), err),
    FB.onSnapshot(FB.query(FB.collection(db, 'ordenes'), FB.where('fecha', '>=', desde)), juntar('recientes'), err),
    FB.onSnapshot(FB.collection(db, 'abonos'), sn => { uso.lecturas += sn.docChanges().length || 1; datos.abonos = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.quitadoEnPlanilla); avisar(); }, err),
    FB.onSnapshot(FB.query(FB.collection(db, 'solicitudes'), FB.where('estado', '==', 'pendiente')), sn => { uso.lecturas += sn.docChanges().length || 1; datos.solicitudes = sn.docs.map(d => ({ id: d.id, ...d.data() })); avisar(); }, err),
    FB.onSnapshot(FB.doc(db, 'config', 'b2b'), sn => { datos.config = sn.exists() ? sn.data() : { activa: false }; avisar(); }, err),
    // v0.13: catálogo en vivo (clientes con sus precios especiales, y productos)
    FB.onSnapshot(FB.collection(db, 'clientes'), sn => { uso.lecturas += sn.docChanges().length || 1; datos.clientes = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.quitadoEnPlanilla).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')); avisar(); }, err),
    // v0.14: movimientos de la cartola por revisar y la configuración de la conciliación
    FB.onSnapshot(FB.query(FB.collection(db, 'movimientos'), FB.where('estado', '==', 'pendiente')), sn => { uso.lecturas += sn.docChanges().length || 1; datos.movimientos = sn.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.orden || 0) - (b.orden || 0)); avisar(); }, err),
    // v0.15: abonos con saldo a favor por usar
    FB.onSnapshot(FB.query(FB.collection(db, 'movimientos'), FB.where('favorDisponible', '>', 0)), sn => { uso.lecturas += sn.docChanges().length || 1; datos.favor = sn.docs.map(d => ({ id: d.id, ...d.data() })); avisar(); }, err),
    FB.onSnapshot(FB.doc(db, 'config', 'conciliacion'), sn => { datos.conciliacion = sn.exists() ? sn.data() : null; datos.conciliacionLeida = true; avisar(); }, err),
    // v0.24.0: cobranza (compromisos, "dice que ya pagó" y gestiones por cliente); sin las reglas v1.6.0 queda vacío sin cortar lo demás
    FB.onSnapshot(FB.collection(db, 'cobranza'), sn => { uso.lecturas += sn.docChanges().length || 1; const m = {}; sn.docs.forEach(x => { m[x.id] = x.data(); }); datos.cobranza = m; datos.cobranzaLeida = true; avisar(); }, e => { datos.cobranzaError = e && e.code; datos.cobranzaLeida = true; avisar(); }),
    FB.onSnapshot(FB.collection(db, 'productos'), sn => { uso.lecturas += sn.docChanges().length || 1; datos.productos = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.quitadoEnPlanilla).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')); avisar(); }, err)
  ];
  return () => fin.forEach(f => { try { f(); } catch (e) {} });
}

const marcaCambio = extra => ({ ...extra, planillaPendiente: false, cambiadaEn: FB.serverTimestamp(), cambiadaPor: authSF.currentUser.email });
// Asignar un folio a varias órdenes (sin folio) de una vez
// v0.25.0: totalSii = el TOTAL que leyó el botón en la página del SII (queda como lo que se cobra del folio)
export async function asignarFolio(ns, folio, fechaFolio, totalSii) {
  const db = await dbOk();
  const f = String(folio || '').trim();
  if (!/^\d{1,12}$/.test(f)) throw new Error('El folio debe ser un número.');
  if (!ns.length) throw new Error('Marca al menos una orden.');
  // Regla: un folio (una factura) es de un solo cliente
  const cliDe = o => o.clienteId || String(o.cliente || '').trim().toLowerCase();
  const yaEnFolio = await ordenesDelFolio(db, f);
  // v0.124.6 · Lo ya abonado al folio (si se agregan órdenes a uno usado), para saber si con los pagos por orden queda pagado
  let abonadoAntes = 0;
  if (yaEnFolio.length) { const pa = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', '==', f))); uso.lecturas += Math.max(1, pa.size);
    abonadoAntes = pa.docs.map(x => x.data()).filter(a => !a.quitadoEnPlanilla).reduce((x, a) => x + (Number(a.monto) || 0), 0); }
  let res = { pagadasAntes: 0, abonado: 0, falta: 0 };
  await FB.runTransaction(db, async tx => {
    const refs = ns.map(n => FB.doc(db, 'ordenes', String(n)));
    const sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    sns.forEach(sn => { if (!sn.exists()) throw new Error('Una de las órdenes ya no existe.'); const o = sn.data(); if (o.folio) throw new Error(`La orden N° ${o.n} ya tiene el folio ${o.folio}.`); if (o.estado === 'anulada') throw new Error(`La orden N° ${o.n} está anulada.`); });
    const todas = sns.map(sn => sn.data()).concat(yaEnFolio);
    if (new Set(todas.map(cliDe)).size > 1) throw new Error(yaEnFolio.length ? `El folio ${f} ya es de ${yaEnFolio[0].cliente} (N° ${yaEnFolio.map(o => o.n).join(', ')}). Un folio es de un solo cliente: revisa el número.` : 'Un folio es de un solo cliente: marca solo órdenes del mismo cliente.');
    let tf = Math.round(Number(totalSii) || 0) > 0 ? Math.round(Number(totalSii)) : null;
    // v0.124.6 · Órdenes pagadas antes de tener folio (Pagada en efectivo): cada pago pasa a ser un abono del folio
    const nuevas = sns.map((sn, i) => ({ id: refs[i].id, ...sn.data() }));
    const pagadas = nuevas.filter(o => o.pagoOrden && /PAGADO/.test(String(o.estadoPago || '').toUpperCase()));
    if (pagadas.length) {
      const vivas = nuevas.concat(yaEnFolio).filter(o => o.estado !== 'anulada' && !o.quitadoEnPlanilla);
      if (!tf) tf = totalFolio(vivas).total;   // con pagos por orden el folio guarda su total (así lo pendiente se calcula bien)
      let abonado = abonadoAntes;
      pagadas.forEach(o => { const p = o.pagoOrden, m = Math.round(Number(p.monto) || 0); abonado += m;
        tx.set(FB.doc(FB.collection(db, 'abonos')), { folio: f, fecha: p.fecha || hoyTxt(), monto: m, referencia: `Efectivo · orden N° ${o.n}${p.cobro ? ' · cobró ' + p.cobro : ''}`.slice(0, 200),
          ordenes: [String(o.n)], pagoOrden: true, extra: {}, quitadoEnPlanilla: false, planillaPendiente: false, por: authSF.currentUser.email, en: FB.serverTimestamp() }); });
      // Lo que no se pagó por orden: pagado si ya se cubrió la factura (o solo falta el redondeo del IVA), si no, parcial
      const resto = vivas.filter(o => !/PAGADO/.test(String(o.estadoPago || '').toUpperCase()));
      const tolerancia = Math.ceil(vivas.length / 2) + 1, falta = Math.max(0, tf - abonado);
      const fechaUlt = pagadas.map(o => o.pagoOrden.fecha).filter(Boolean).sort().pop() || hoyTxt();
      resto.forEach(o => tx.update(FB.doc(db, 'ordenes', o.id), marcaCambio(falta <= tolerancia
        ? { estadoPago: 'PAGADO', fechaPago: fechaUlt, medioPago: 'Pagada por orden (efectivo)' } : { estadoPago: 'PARCIAL' })));
      res = { pagadasAntes: pagadas.length, abonado, falta };
    }
    refs.forEach(r => tx.update(r, marcaCambio({ folio: f, sinFolio: false, fechaFolio: fechaFolio || hoyTxt(), totalFactura: tf })));
    // Órdenes que ya estaban en ese folio: si cambia la factura (se agregan órdenes), su total también
    yaEnFolio.forEach(o => { if ((o.totalFactura || null) !== tf) tx.update(FB.doc(db, 'ordenes', o.id), { totalFactura: tf }); });
  });
  uso.escrituras += ns.length + res.pagadasAntes;
  if (res.pagadasAntes) olvidarAgendaB2b();
  return res;
}

// ── v0.124.6 · Pagada en efectivo, por orden, antes de tener folio (Emmanuel, 3 nov: un cliente paga cada orden a
// logística y se factura a fin de mes). La orden queda PAGADO con pagoOrden { monto, fecha, medio, cobro, por, en };
// logística ya no puede editarla (las reglas solo dejan editar las PENDIENTE). Al asignar el folio, cada pago pasa a ser
// un abono del folio (asignarFolio). Quitar el pago: solo sin folio; queda en historialPagoOrden. Nada se borra.
export async function pagarOrden(n, { fecha, cobro } = {}) {
  const db = await dbOk(), dia = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoyTxt();
  if (dia > hoyTxt()) throw new Error('La fecha no puede ser futura.');
  let out = null;
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'ordenes', String(n)), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('La orden ya no existe.');
    const o = sn.data();
    if (o.estado === 'anulada') throw new Error(`La orden N° ${o.n} está anulada.`);
    if (o.folio) throw new Error(`La orden N° ${o.n} ya tiene el folio ${o.folio}: el pago se registra en Cobranza.`);
    if (String(o.estadoPago || 'PENDIENTE').toUpperCase() !== 'PENDIENTE') throw new Error(`La orden N° ${o.n} ya está pagada.`);
    const monto = Math.round(Number(o.total) || 0);
    if (!(monto > 0)) throw new Error(`La orden N° ${o.n} no tiene total.`);
    const c = String(cobro || '').trim().slice(0, 60);
    const pagoOrden = { monto, fecha: dia, medio: 'efectivo', cobro: c, por: authSF.currentUser.email, en: ahoraTxt() };
    tx.update(ref, marcaCambio({ estadoPago: 'PAGADO', fechaPago: dia, medioPago: 'Efectivo' + (c ? ' · cobró ' + c : ''), pagoOrden }));
    out = { n: o.n, cliente: o.cliente || '', monto, fecha: dia, cobro: c };
  });
  uso.escrituras++; olvidarAgendaB2b();
  return out;
}
// v0.131.0 · Cobros en efectivo de logística (fen-logistica v1.4.0): las órdenes que logística marcó pagadas y que la administración
// todavía no recibe (pagoOrden.pendienteAdmin), juntas por cobro. 1 consulta (igualdad en un campo: sin índice compuesto).
// → [{ cobroId, cliente, clienteId, ns, total, efectivo, redondeo, fecha, por }]
export async function cobrosLogistica() {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('pagoOrden.pendienteAdmin', '==', true)));
  uso.lecturas += Math.max(1, sn.size);
  const g = new Map();
  sn.docs.map(d => d.data()).filter(o => o.pagoOrden && o.pagoOrden.logistica && o.pagoOrden.cobroId && o.estado !== 'anulada').forEach(o => {
    const p = o.pagoOrden, k = String(p.cobroId);
    if (!g.has(k)) g.set(k, { cobroId: k, cliente: o.cliente || '', clienteId: o.clienteId || '', ns: [], total: 0, efectivo: Math.round(Number(p.cobroEfectivo) || 0), fecha: p.fecha || o.fechaPago || '', por: p.por || '' });
    const x = g.get(k); x.ns.push(o.n); x.total += Math.round(Number(o.total) || 0);
  });
  return [...g.values()].map(x => { x.ns.sort((a, b) => a - b); if (!(x.efectivo > 0)) x.efectivo = x.total; x.redondeo = x.efectivo - x.total; return x; });
}
// Al recibir un cobro de logística: sus órdenes dejan de estar pendientes de recibir (logística ya no lo puede deshacer)
export async function marcarCobroRecibido(cobroId, ns, efectivoId = '') {
  const db = await dbOk();
  await FB.runTransaction(db, async tx => {
    const refs = (ns || []).map(n => FB.doc(db, 'ordenes', String(n))), sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    sns.forEach((sn, i) => {
      const p = sn.exists() && sn.data().pagoOrden;
      if (!p || String(p.cobroId) !== String(cobroId) || !p.pendienteAdmin) return;
      tx.update(refs[i], marcaCambio({ 'pagoOrden.pendienteAdmin': false, 'pagoOrden.recibido': { por: authSF.currentUser.email, en: ahoraTxt(), efectivoId: String(efectivoId || '') } }));
    });
  });
  uso.escrituras++; olvidarAgendaB2b();
}
// ¿Sigue pendiente ese cobro? (antes de recibirlo: logística pudo deshacerlo recién)
export async function cobroSigue(cobroId, ns) {
  const db = await dbOk();
  for (const n of ns || []) {
    const sn = await FB.getDoc(FB.doc(db, 'ordenes', String(n))); uso.lecturas++;
    const p = sn.exists() && sn.data().pagoOrden;
    if (!p || String(p.cobroId) !== String(cobroId) || !p.pendienteAdmin) return false;
  }
  return true;
}
// Deja anotado en la orden el id de lo que quedó por recibir en Efectivo (para poder anularlo si se quita el pago)
export async function anotarPorRecibirOrden(n, id) {
  const db = await dbOk();
  await FB.updateDoc(FB.doc(db, 'ordenes', String(n)), { 'pagoOrden.porRecibirId': String(id || '') }); uso.escrituras++;
}
export async function quitarPagoOrden(n, motivo) {
  const db = await dbOk(), mt = String(motivo || '').trim().slice(0, 200);
  if (mt.length < 3) throw new Error('Escribe el motivo.');
  let p = null;
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'ordenes', String(n)), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('La orden ya no existe.');
    const o = sn.data();
    if (!o.pagoOrden) throw new Error('Esa orden no se pagó por orden.');
    if (o.folio) throw new Error(`La orden ya tiene el folio ${o.folio}: el pago ya es un abono de la factura.`);
    p = o.pagoOrden;
    const hist = (Array.isArray(o.historialPagoOrden) ? o.historialPagoOrden : []).concat([{ ...p, quitado: { por: authSF.currentUser.email, en: ahoraTxt(), motivo: mt } }]).slice(-10);
    tx.update(ref, marcaCambio({ estadoPago: 'PENDIENTE', fechaPago: null, medioPago: null, pagoOrden: null, historialPagoOrden: hist }));
  });
  uso.escrituras++; olvidarAgendaB2b();
  return p;
}
// Órdenes de un folio (todas, también fuera de la ventana de 30 días)
async function ordenesDelFolio(db, folio) {
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('folio', '==', String(folio))));
  uso.lecturas += Math.max(1, sn.size);
  return sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !o.quitadoEnPlanilla && o.estado !== 'anulada');
}
export async function folioUsado(folio) { const db = await dbOk(); return (await ordenesDelFolio(db, folio)).map(o => ({ n: o.n, cliente: o.cliente, clienteId: o.clienteId || null })); }
// Pago completo de un folio: todas sus órdenes quedan PAGADO con esa fecha
export async function registrarPago(folio, fechaPago, medio) {
  const db = await dbOk();
  const os = (await ordenesDelFolio(db, folio)).filter(o => !/PAGADO/.test(o.estadoPago || ''));   // las ya pagadas (o archivadas) no se tocan
  if (!os.length) throw new Error('Ese folio no tiene órdenes por pagar.');
  const b = FB.writeBatch(db);
  os.forEach(o => b.update(FB.doc(db, 'ordenes', o.id), marcaCambio({ estadoPago: 'PAGADO', fechaPago: fechaPago || hoyTxt(), medioPago: String(medio || '').trim().slice(0, 120) || null })));
  await b.commit(); olvidarAgendaB2b(); uso.escrituras += os.length;
  return os.length;
}
// ── v0.106.0 · Incobrables: un folio que se da por perdido (cuenta 6.13). Las órdenes quedan como están (sin pago) y con la marca
// incobrable { fecha, mes, saldo (del folio, con IVA), motivo, por, en }: salen de la cobranza y de la conciliación. Deshacer la quita
// (queda en historialIncobrable) y el folio vuelve a la cobranza; si su mes ya se cerró, Finanzas lo informa como ajuste.
export async function darPorPerdido(folio, { saldo, motivo, fecha }) {
  const db = await dbOk(), m = String(motivo || '').trim().slice(0, 200), f = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : hoyTxt();
  if (!m) throw new Error('Anote el motivo (por ejemplo: el cliente cerró y no responde).');
  if (!(Number(saldo) > 0)) throw new Error('Ese folio no tiene saldo por cobrar.');
  const os = (await ordenesDelFolio(db, folio)).filter(o => !/PAGADO/.test(String(o.estadoPago || '').toUpperCase()));
  if (!os.length) throw new Error('Ese folio no tiene órdenes por pagar.');
  if (os.some(o => o.incobrable)) throw new Error('Ese folio ya está dado por perdido.');
  const marca = { fecha: f, mes: f.slice(0, 7), saldo: Math.round(Number(saldo)), motivo: m, por: authSF.currentUser.email, en: new Date().toISOString() };
  const b = FB.writeBatch(db);
  os.forEach(o => b.update(FB.doc(db, 'ordenes', o.id), marcaCambio({ incobrable: marca })));
  await b.commit(); olvidarAgendaB2b(); uso.escrituras += os.length;
  return os.length;
}
export async function deshacerPerdido(folio, motivo) {
  const db = await dbOk(), os = (await ordenesDelFolio(db, folio)).filter(o => o.incobrable);
  if (!os.length) throw new Error('Ese folio no está dado por perdido.');
  const b = FB.writeBatch(db), quien = authSF.currentUser.email, en = new Date().toISOString();
  os.forEach(o => b.update(FB.doc(db, 'ordenes', o.id), marcaCambio({ incobrable: null,
    historialIncobrable: (Array.isArray(o.historialIncobrable) ? o.historialIncobrable : []).concat([{ ...o.incobrable, deshecho: { por: quien, en, motivo: String(motivo || '').slice(0, 200) } }]).slice(-10) })));
  await b.commit(); olvidarAgendaB2b(); uso.escrituras += os.length;
  return os.length;
}
// Los folios dados por perdidos en un mes (para Finanzas): uno por folio, con su saldo
export function incobrablesDe(ordenes, mes) {
  const F = {};
  (ordenes || []).filter(o => o && o.incobrable && o.estado !== 'anulada' && !o.quitadoEnPlanilla && (!mes || o.incobrable.mes === mes)).forEach(o => {
    const k = String(o.folio || o.n); if (!F[k]) F[k] = { folio: k, cliente: String(o.cliente || ''), monto: Math.round(Number(o.incobrable.saldo) || 0), fecha: o.incobrable.fecha || '', mes: o.incobrable.mes || '', motivo: o.incobrable.motivo || '', por: o.incobrable.por || '', ordenes: [] };
    F[k].ordenes.push(o.n);
  });
  return Object.values(F).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.folio.localeCompare(b.folio));
}
export async function incobrablesDelMes(mes) {
  const db = await dbOk(), sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('incobrable.mes', '==', String(mes))));
  uso.lecturas += Math.max(1, sn.size);
  return incobrablesDe(sn.docs.map(d => ({ id: d.id, ...d.data() })), mes);
}
// Abono a un folio: queda en abonos; si con esto se completa el total, el folio queda PAGADO; si no, PARCIAL
export async function registrarAbono(folio, monto, fecha, referencia) {
  const db = await dbOk();
  const m = Math.round(Number(monto) || 0);
  if (!(m > 0)) throw new Error('Escribe el monto del abono.');
  const os = await ordenesDelFolio(db, folio);
  if (!os.length) throw new Error('No hay órdenes con ese folio.');
  const prev = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', '==', String(folio))));
  uso.lecturas += Math.max(1, prev.size);
  const abonado = prev.docs.map(d => d.data()).filter(a => !a.quitadoEnPlanilla).reduce((s, a) => s + (Number(a.monto) || 0), 0) + m;
  const total = totalFolio(os).total;   // v0.25.0: el total de la factura
  const pagado = abonado >= total;
  const b = FB.writeBatch(db);
  b.set(FB.doc(FB.collection(db, 'abonos')), { folio: String(folio), fecha: fecha || hoyTxt(), monto: m, referencia: String(referencia || '').trim(), extra: {}, quitadoEnPlanilla: false, planillaPendiente: false, por: authSF.currentUser.email, en: FB.serverTimestamp() });
  os.filter(o => !/PAGADO/.test(o.estadoPago || '')).forEach(o => b.update(FB.doc(db, 'ordenes', o.id), marcaCambio(pagado ? { estadoPago: 'PAGADO', fechaPago: fecha || hoyTxt() } : { estadoPago: 'PARCIAL' })));
  await b.commit(); olvidarAgendaB2b(); uso.escrituras += os.length + 1;
  return { pagado, saldo: Math.max(0, total - abonado) };
}
// Anular: no se borra; queda "anulada" con quién, cuándo y por qué (en la planilla pasa a "Ordenes anuladas")
export async function anularOrden(n, motivo) {
  const db = await dbOk();
  const mt = String(motivo || '').trim();
  if (mt.length < 3) throw new Error('Escribe el motivo.');
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'ordenes', String(n)), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('La orden ya no existe.');
    if (sn.data().estado === 'anulada') throw new Error('Ya estaba anulada.');
    tx.update(ref, marcaCambio({ estado: 'anulada', anulada: { por: authSF.currentUser.email, en: ahoraTxt(), motivo: mt } }));
  });
  // v0.25.0: si tenía folio, el total leído del SII ya no corresponde: las demás órdenes del folio vuelven al total calculado
  const o = (await FB.getDoc(FB.doc(db, 'ordenes', String(n)))).data() || {};
  if (o.folio) for (const x of await ordenesDelFolio(db, o.folio)) if (x.totalFactura) { await FB.updateDoc(FB.doc(db, 'ordenes', x.id), { totalFactura: null }); uso.escrituras++; }
  uso.escrituras++;
}

// ── Solicitudes de logística ───────────────────────
export async function aprobarSolicitud(s, precio, respuesta) {
  const db = await dbOk();
  const p = Math.round(Number(precio) || 0);
  if (!(p > 0) && s.tipo !== 'anulacion') throw new Error('Escribe el precio.');
  await FB.runTransaction(db, async tx => {
    const sref = FB.doc(db, 'solicitudes', s.id), ss = await tx.get(sref);
    if (!ss.exists() || ss.data().estado !== 'pendiente') throw new Error('Esa solicitud ya se resolvió.');
    if (s.tipo === 'anulacion') {
      const oref = FB.doc(db, 'ordenes', String(s.n)), os = await tx.get(oref);
      if (!os.exists()) throw new Error('La orden ya no existe.');
      if (os.data().estado !== 'anulada') tx.update(oref, marcaCambio({ estado: 'anulada', anulada: { por: authSF.currentUser.email, en: ahoraTxt(), motivo: `${s.nota || 'Sin motivo'} (pedido por ${s.por})`, solicitud: s.id } }));
    } else if (s.tipo === 'precio') {
      const cref = FB.doc(db, 'clientes', s.clienteId), cs = await tx.get(cref);
      if (!cs.exists()) throw new Error('El cliente ya no existe.');
      // v0.75.1: el precio especial va por el ID del producto (el nombre solo para un precio antiguo sin ID)
      const prodS = { id: s.productoId || null, nombre: s.producto }, igualS = x => precioEsDe(x, prodS);
      const lista = (cs.data().precios || []).filter(x => !igualS(x));
      lista.push({ producto: s.producto, productoId: s.productoId || null, precio: p });
      const previo = (cs.data().precios || []).find(igualS);
      tx.update(cref, { precios: lista, historialPrecios: [...(cs.data().historialPrecios || []), { producto: s.producto, antes: previo ? previo.precio : null, despues: p, en: ahoraTxt(), por: authSF.currentUser.email, solicitud: s.id }].slice(-200), planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
    } else {
      // v0.74.0 (Catálogo, Etapa 2): un producto nuevo ya no se crea suelto en B2B. Se resuelve en Catálogo → Productos → Pedidos:
      // se crea (o se habilita) el producto del maestro desde su receta o reventa, y el maestro escribe la copia en B2B.
      throw new Error('Los productos nuevos se resuelven en Catálogo → Productos (Pedidos): ahí se crea el producto desde su receta y llega solo a B2B.');
    }
    tx.update(sref, { estado: 'aprobada', precioAprobado: s.tipo === 'anulacion' ? null : p, respuesta: String(respuesta || '').trim() || null, resuelta: { por: authSF.currentUser.email, en: FB.serverTimestamp() } });
  });
  uso.escrituras += 2;
}
export async function rechazarSolicitud(s, respuesta) {
  const db = await dbOk();
  await FB.updateDoc(FB.doc(db, 'solicitudes', s.id), { estado: 'rechazada', respuesta: String(respuesta || '').trim() || null, resuelta: { por: authSF.currentUser.email, en: FB.serverTimestamp() } });
  uso.escrituras++;
}
const slugB2B = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'producto';

// Cliente nuevo (mientras llega la administración completa del catálogo)
export async function nuevoCliente(c) {
  const db = await dbOk();
  const nombre = String(c.nombre || '').trim();
  if (nombre.length < 2) throw new Error('Escribe el nombre del cliente.');
  const base = slugB2B(nombre);
  return FB.runTransaction(db, async tx => {
    let id = base, i = 2;
    while (true) {
      const sn = await tx.get(FB.doc(db, 'clientes', id));
      if (!sn.exists()) break;
      if (String(sn.data().nombre || '').toLowerCase().trim() === nombre.toLowerCase()) throw new Error('Ya existe un cliente con ese nombre.');
      id = base + '-' + i++;
    }
    const t = k => String(c[k] || '').trim();
    tx.set(FB.doc(db, 'clientes', id), { nombre, rut: t('rut'), razonSocial: t('razonSocial'), giro: t('giro'), direccion: t('direccion'), ciudad: t('ciudad'), correo: t('correo'), telefono: t('telefono'), contacto: t('contacto'),
      facturacion: c.facturacion || 'Diaria', frecuenciaPago: c.frecuenciaPago || 'Diaria', precios: [], estado: 'activo', extra: {}, origen: { app: 'sistema-fen' }, quitadoEnPlanilla: false, planillaPendiente: false, creadoEn: FB.serverTimestamp(), creadoPor: authSF.currentUser.email });
    return id;
  });
}

// v0.69.4 · Para el resumen de varias órdenes: solo las ediciones y las cantidades originales (sin leer el cliente).
// Lee únicamente las órdenes editadas (1 consulta por orden editada; las demás, 0 lecturas).
export async function cambiosOrden(o) {
  if (!(o && (o.editada || o.revisar))) return { ediciones: [], originales: {} };
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'ediciones'), FB.where('n', '==', Number(o.n))));
  uso.lecturas += Math.max(1, sn.size);
  const ediciones = sn.docs.map(d => d.data()).filter(e => !e.quitadoEnPlanilla).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const originales = {};
  const e0 = ediciones.find(e => e.cambios && /"antes"/.test(e.cambios));
  if (e0) { try { (JSON.parse(e0.cambios).antes || []).forEach(l => { originales[l.producto] = (originales[l.producto] || 0) + l.cantidad; }); } catch (x) {} }
  return { ediciones, originales };
}

// Para el PDF de una orden: el cliente y el historial de ediciones
export async function datosPdf(o) {
  const db = await dbOk();
  let cliente = { nombre: o.cliente };
  if (o.clienteId) { const c = await FB.getDoc(FB.doc(db, 'clientes', o.clienteId)); uso.lecturas++; if (c.exists()) cliente = c.data(); }
  let ediciones = [];
  if (o.editada || o.revisar) {
    const sn = await FB.getDocs(FB.query(FB.collection(db, 'ediciones'), FB.where('n', '==', Number(o.n))));
    uso.lecturas += Math.max(1, sn.size);
    ediciones = sn.docs.map(d => d.data()).filter(e => !e.quitadoEnPlanilla).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }
  let originales = {};
  const e0 = ediciones.find(e => e.cambios && /"antes"/.test(e.cambios));
  if (e0) { try { (JSON.parse(e0.cambios).antes || []).forEach(l => { originales[l.producto] = (originales[l.producto] || 0) + l.cantidad; }); } catch (x) {} }
  return { cliente, ediciones, originales };
}

// ═══════════════════════════════════════════════
//  v0.13.0 · Catálogo (clientes, productos, precios especiales) y estado de cuenta
//  El nombre no se cambia: las órdenes y la planilla se ubican por nombre.
//  Nada se borra: clientes y productos se archivan (logística deja de verlos).
//  Cada cambio de precio queda en historialPrecios del cliente o del producto.
// ═══════════════════════════════════════════════
const TXT = ['rut', 'razonSocial', 'giro', 'direccion', 'ciudad', 'correo', 'telefono', 'contacto'];   // v0.19.1: ciudad (para la factura del SII)
// v0.14.4 · WhatsApp del cliente: número (+56 9 …) o enlace de invitación de un grupo
export function normalizarWsp(t) {
  const d = String(t || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.length === 8) return '569' + d;
  if (d.length === 9 && d[0] === '9') return '56' + d;
  if (d.length === 11 && d.startsWith('569')) return d;
  return null;
}
export const grupoWspValido = t => !t || /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/.test(String(t).trim());
export const FACTURACION = ['Diaria', 'Semanal', 'Semanal viernes', 'Mensual'];   // v0.112.1: semanal viernes (sábado a viernes, se factura el viernes)
export const FRECUENCIA = ['Diaria', 'Semanal', 'Mensual', '30dias', '4 pagos semanales'];   // v0.120.1: factura mensual pagada en 4 pagos semanales
export async function guardarCliente(id, datos) {
  const db = await dbOk();
  const cambios = {};
  TXT.forEach(k => { if (k in datos) cambios[k] = String(datos[k] || '').trim(); });
  if ('whatsapp' in datos) { const w = normalizarWsp(datos.whatsapp); if (w === null) throw new Error('El WhatsApp debe ser un celular chileno (9 dígitos, empieza con 9).'); cambios.whatsapp = w; }
  if ('grupoWhatsapp' in datos) { if (!grupoWspValido(datos.grupoWhatsapp)) throw new Error('El enlace del grupo debe empezar con https://chat.whatsapp.com/'); cambios.grupoWhatsapp = String(datos.grupoWhatsapp || '').trim(); }
  if (datos.facturacion) { if (!FACTURACION.includes(datos.facturacion)) throw new Error('Facturación no válida.'); cambios.facturacion = datos.facturacion; }
  if (datos.frecuenciaPago) { if (!FRECUENCIA.includes(datos.frecuenciaPago)) throw new Error('Frecuencia no válida.'); cambios.frecuenciaPago = datos.frecuenciaPago; }
  await FB.updateDoc(FB.doc(db, 'clientes', id), { ...cambios, planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
  uso.escrituras++;
}
export async function archivarCliente(id, archivar) {
  const db = await dbOk();
  await FB.updateDoc(FB.doc(db, 'clientes', id), { estado: archivar ? 'archivado' : 'activo', planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
  uso.escrituras++;
}
// Precio especial: precio > 0 lo pone o lo cambia; precio 0 o vacío lo quita (vuelve al precio base)
export async function precioEspecial(clienteId, producto, precio) {
  const db = await dbOk();
  const p = Math.round(Number(precio) || 0);
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'clientes', clienteId), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('El cliente ya no existe.');
    const c = sn.data(), igual = x => precioEsDe(x, producto);   // v0.75.1: por el ID del producto (el nombre solo si el precio no tiene ID)
    const previo = (c.precios || []).find(igual);
    if ((previo ? previo.precio : 0) === p) return;
    const lista = (c.precios || []).filter(x => !igual(x));
    if (p > 0) lista.push({ producto: producto.nombre, productoId: producto.id || null, precio: p });
    lista.sort((a, b) => String(a.producto).localeCompare(String(b.producto), 'es'));
    tx.update(ref, { precios: lista, historialPrecios: [...(c.historialPrecios || []), { producto: producto.nombre, antes: previo ? previo.precio : null, despues: p > 0 ? p : null, en: ahoraTxt(), por: authSF.currentUser.email }].slice(-200),
      planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
  });
  uso.escrituras++;
}
// ── v0.75.1 · Precios especiales unidos al producto por ID (una sola vez; ver b2b-modelo.planPreciosPorId) ──
// uniones: [{ clienteId, idx, producto, productoIdAntes, productoId, como }]. Una transacción por cliente (lee lo guardado ahora y solo
// pone el ID). Después guarda config/preciosPorId = { en, por, unidos, pendientes } (para que la pantalla diga "hecho el …").
// Lecturas: 1 por cliente con algo que unir. Escrituras: 1 por cliente + 1. Nada se borra; el nombre y el precio no cambian.
export async function unirPreciosPorId(uniones, { pendientes = 0 } = {}) {
  const db = await dbOk(), por = authSF.currentUser.email, en = ahoraTxt();
  const porCli = new Map();
  (uniones || []).forEach(u => { if (!porCli.has(u.clienteId)) porCli.set(u.clienteId, []); porCli.get(u.clienteId).push(u); });
  let n = 0, clientes = 0;
  for (const [cid, us] of porCli) {
    await FB.runTransaction(db, async tx => {
      const ref = FB.doc(db, 'clientes', cid), sn = await tx.get(ref);
      if (!sn.exists()) return;
      const r = aplicarUniones(sn.data().precios || [], us, { por, en });
      if (!r.n) return;
      tx.update(ref, { precios: r.precios, preciosPorId: { en, por, n: r.n }, planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: por });
      n += r.n; clientes++;
    });
    uso.lecturas++; uso.escrituras++;
  }
  await FB.setDoc(FB.doc(db, 'config', 'preciosPorId'), { en, por, unidos: n, clientes, pendientes: Math.max(0, Number(pendientes) || 0) }, { merge: true });
  uso.escrituras++;
  return { n, clientes };
}
export async function estadoPreciosPorId() {
  const db = await dbOk();
  try { const sn = await FB.getDoc(FB.doc(db, 'config', 'preciosPorId')); uso.lecturas++; return sn.exists() ? sn.data() : null; } catch (e) { return null; }
}
export async function guardarProducto(id, datos) {
  const db = await dbOk();
  // v0.74.0: los productos se crean SOLO en Catálogo → Productos (desde una receta aprobada, una reventa o un cargo)
  if (!id) throw new Error('Los productos se crean en Catálogo → Productos (desde una receta aprobada, una reventa o un cargo).');
  if (!id) {
    const nombre = String(datos.nombre || '').trim();
    if (nombre.length < 2) throw new Error('Escribe el nombre del producto.');
    const p = Math.round(Number(datos.precioBase) || 0);
    if (!(p > 0)) throw new Error('Escribe el precio base.');
    return FB.runTransaction(db, async tx => {
      let nid = slugB2B(nombre), i = 2;
      while (true) {
        const sn = await tx.get(FB.doc(db, 'productos', nid));
        if (!sn.exists()) break;
        if (String(sn.data().nombre || '').toLowerCase().trim() === nombre.toLowerCase()) throw new Error('Ya existe un producto con ese nombre.');
        nid = slugB2B(nombre) + '-' + i++;
      }
      tx.set(FB.doc(db, 'productos', nid), { nombre, precioBase: p, categoria: String(datos.categoria || '').trim(), idReceta: String(datos.idReceta || '').trim(), area: String(datos.area || '').trim(), estado: 'activo', extra: {}, origen: { app: 'sistema-fen' },
        quitadoEnPlanilla: false, planillaPendiente: false, creadoEn: FB.serverTimestamp(), creadoPor: authSF.currentUser.email });
      return nid;
    });
  }
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'productos', id), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('El producto ya no existe.');
    const a = sn.data(), cambios = {};
    ['categoria', 'idReceta', 'area'].forEach(k => { if (k in datos) cambios[k] = String(datos[k] || '').trim(); });
    if ('precioBase' in datos) {
      const p = Math.round(Number(datos.precioBase) || 0);
      if (!(p > 0)) throw new Error('El precio base debe ser mayor que 0.');
      if (p !== Number(a.precioBase)) { cambios.precioBase = p; cambios.historialPrecios = [...(a.historialPrecios || []), { antes: Number(a.precioBase) || null, despues: p, en: ahoraTxt(), por: authSF.currentUser.email }].slice(-200); }
    }
    tx.update(ref, { ...cambios, planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
  });
  uso.escrituras++;
}
export async function archivarProducto(id, archivar) {
  const db = await dbOk();
  await FB.updateDoc(FB.doc(db, 'productos', id), { estado: archivar ? 'archivado' : 'activo', planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: authSF.currentUser.email });
  uso.escrituras++;
}

// ── v0.74.0 · Catálogo (Etapa 2): la copia del producto en B2B la escribe SOLO Sistema Fën (Catálogo → Productos) ──
// crear = documento nuevo (su ID es el del maestro, PR####); si no, cambia solo los campos dados. El nombre de un producto que ya
// existía no se cambia (las órdenes y los precios especiales antiguos lo usan). Un cambio de precio base queda en su historial.
export async function escribirProducto(id, campos, { crear = false } = {}) {
  const db = await dbOk(), por = authSF.currentUser.email;
  const ref = FB.doc(db, 'productos', id);
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); uso.lecturas++;
    const a = sn.exists() ? sn.data() : null;
    if (a && crear && a.catalogoId && a.catalogoId !== campos.catalogoId) throw new Error(`En B2B ya hay un producto con el ID ${id} de otro producto del catálogo.`);
    if (!a) {
      if (!crear) throw new Error('Ese producto ya no está en B2B. Toca Actualizar.');
      tx.set(ref, { ...campos, extra: {}, origen: { app: 'sistema-fen', catalogo: campos.catalogoId || '' }, quitadoEnPlanilla: false, planillaPendiente: false, creadoEn: FB.serverTimestamp(), creadoPor: por });
      return;
    }
    const c = { ...campos };
    if (!crear) delete c.nombre;
    if ('precioBase' in c && Number(c.precioBase) !== Number(a.precioBase)) c.historialPrecios = [...(a.historialPrecios || []), { antes: Number(a.precioBase) || null, despues: Number(c.precioBase), en: ahoraTxt(), por, catalogo: true }].slice(-200);
    tx.update(ref, { ...c, planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: por });
  });
  uso.escrituras++;
}
// La lista que lee logística para pedir un producto nuevo: config/catalogoDisponible = { productos [{ id, nombre, area, tipo }], n, en, por }
// (los activos del maestro que no están en B2B). Necesita las reglas de fen-b2b v1.7.0 para que logística la lea.
export async function publicarCatalogoDisponible(productos) {
  const db = await dbOk();
  await FB.setDoc(FB.doc(db, 'config', 'catalogoDisponible'), { productos: productos || [], n: (productos || []).length, en: FB.serverTimestamp(), por: authSF.currentUser.email });
  uso.escrituras++;
}
// Un pedido de producto de logística, resuelto desde el Catálogo: aprobada (con el producto del maestro y su documento en B2B) o rechazada
export async function resolverSolicitudProducto(id, { aprobada, catalogoId = null, productoId = null, precio = null, respuesta = '' }) {
  const db = await dbOk(), sref = FB.doc(db, 'solicitudes', id);
  await FB.runTransaction(db, async tx => {
    const ss = await tx.get(sref); uso.lecturas++;
    if (!ss.exists() || ss.data().estado !== 'pendiente') throw new Error('Ese pedido ya se resolvió.');
    tx.update(sref, aprobada
      ? { estado: 'aprobada', precioAprobado: precio, catalogoId, productoId, respuesta: String(respuesta || '').trim() || null, resuelta: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }
      : { estado: 'rechazada', respuesta: String(respuesta || '').trim() || null, resuelta: { por: authSF.currentUser.email, en: FB.serverTimestamp() } });
  });
  uso.escrituras++;
}
// Las solicitudes pendientes (para el Catálogo, aunque la base nueva todavía no esté "en uso")
export async function solicitudesPendientes() {
  const cx = await conexion(); if (cx.estado !== 'ok') return null;
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'solicitudes'), FB.where('estado', '==', 'pendiente')));
  uso.lecturas += Math.max(1, sn.size);
  return sn.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Estado de cuenta ───────────────────────────────
// Todas las órdenes de un cliente (también archivadas), sin anuladas ni quitadas
export async function ordenesDeCliente(clienteId) {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('clienteId', '==', clienteId)));
  uso.lecturas += Math.max(1, sn.size);
  const os = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !o.quitadoEnPlanilla && o.estado !== 'anulada');
  // Un folio con abonos que incluye órdenes de otro cliente: el saldo se reparte sobre el total de todo el folio
  const parciales = [...new Set(os.filter(o => o.folio && String(o.estadoPago || '').toUpperCase() === 'PARCIAL').map(o => String(o.folio)))];
  for (const f of parciales) {
    const t = totalFolio(await ordenesDelFolio(db, f));   // v0.25.0: total de la factura y suma de todas sus órdenes
    os.forEach(o => { if (String(o.folio) === f) { o._totalFolio = t.total; o._sumaFolio = t.suma; } });
  }
  return os;
}
// Saldo como la app B2B: pagado = 0; parcial = (total del folio − abonos) repartido por el peso de la orden
export function estadoDeCuenta(ordenes, abonos, desde, hasta, modo) {
  const os = ordenes.filter(o => (!desde || o.fecha >= desde) && (!hasta || o.fecha <= hasta)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.n - b.n);
  const porFolio = {};
  ordenes.forEach(o => { if (o.folio) (porFolio[o.folio] = porFolio[o.folio] || []).push(o); });
  const abonado = f => abonos.filter(a => String(a.folio) === String(f)).reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const ultimoAbono = f => abonos.filter(a => String(a.folio) === String(f)).map(a => a.fecha).sort().pop() || null;
  // v0.25.0: un folio debe el total de su factura; por orden, su parte (proporcional a la orden)
  const tFolio = f => { const l = porFolio[f] || []; return (l[0] && l[0]._totalFolio) || totalFolio(l).total; };
  // Suma de TODAS las órdenes del folio (un folio antiguo puede tener órdenes de otro cliente)
  const sumaFolio = f => { const l = porFolio[f] || []; return (l[0] && (l[0]._sumaFolio || l[0]._totalFolio)) || l.reduce((s, o) => s + o.total, 0); };
  const saldo = o => {
    const e = String(o.estadoPago || '').toUpperCase();
    if (e.includes('PAGADO')) return 0;
    if (!o.folio) return o.total;
    const t = tFolio(o.folio), sf = sumaFolio(o.folio); if (t <= 0 || sf <= 0) return 0;
    return Math.round(Math.max(0, t - abonado(o.folio)) * o.total / sf);
  };
  let filas;
  if (modo === 'folio') {
    const grupos = {}, sueltas = [];
    os.forEach(o => { if (o.folio) (grupos[o.folio] = grupos[o.folio] || []).push(o); else sueltas.push(o); });
    filas = Object.keys(grupos).map(f => {
      const l = grupos[f], est = l.some(o => !/PAGADO|PARCIAL/.test(String(o.estadoPago || '').toUpperCase())) ? 'PENDIENTE' : l.some(o => String(o.estadoPago).toUpperCase() === 'PARCIAL') ? 'PARCIAL' : 'PAGADO';
      const completo = sumaFolio(f) === (porFolio[f] || []).reduce((s, o) => s + o.total, 0), total = completo ? tFolio(f) : l.reduce((s, o) => s + o.total, 0);
      const sal = est === 'PAGADO' ? 0 : completo ? Math.max(0, total - abonado(f)) : l.reduce((s, o) => s + saldo(o), 0);
      return { principal: f, secundaria: l.map(o => o.n).join(', '), fecha: l.map(o => o.fechaFolio).filter(Boolean).sort()[0] || l[0].fecha, neto: l.reduce((s, o) => s + o.neto, 0), total, saldo: sal, abonado: est === 'PARCIAL' ? total - sal : 0, ultimoAbono: est === 'PARCIAL' ? ultimoAbono(f) : null, estado: est, fechaPago: l.map(o => o.fechaPago).filter(Boolean).sort().pop() || null };
    }).concat(sueltas.map(o => { const e = String(o.estadoPago || 'PENDIENTE').toUpperCase(), pag = e.includes('PAGADO'); return { principal: 'Sin folio', secundaria: String(o.n), fecha: o.fecha, neto: o.neto, total: o.total, saldo: saldo(o), abonado: 0, estado: pag ? 'PAGADO' : 'PENDIENTE', fechaPago: pag ? o.fechaPago : null }; }))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  } else {
    filas = os.map(o => { const e = String(o.estadoPago || 'PENDIENTE').toUpperCase(), sal = saldo(o); return { principal: String(o.n), secundaria: o.folio || 'Pendiente', fecha: o.fecha, neto: o.neto, total: o.total, saldo: sal, abonado: e === 'PARCIAL' ? o.total - sal : 0, ultimoAbono: e === 'PARCIAL' && o.folio ? ultimoAbono(o.folio) : null, estado: e.includes('PAGADO') ? 'PAGADO' : e, fechaPago: o.fechaPago }; });
  }
  const comprado = modo === 'folio' ? filas.reduce((s, f) => s + f.total, 0) : os.reduce((s, o) => s + o.total, 0);
  const pendiente = modo === 'folio' ? filas.reduce((s, f) => s + f.saldo, 0) : os.reduce((s, o) => s + saldo(o), 0);
  return { filas, n: os.length, comprado, pagado: comprado - pendiente, pendiente };
}

// ── Para Hoy: solicitudes de logística sin responder (solo si la base nueva está conectada y en uso; no pide nada) ──
export async function solicitudesParaHoy() {
  let cx;
  try { cx = await conexion(); } catch (e) { return null; }
  if (cx.estado !== 'ok') return null;
  const cfg = await configB2b(cx.db);
  if (!cfg || !cfg.activa) return null;
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'solicitudes'), FB.where('estado', '==', 'pendiente')));
  uso.lecturas += Math.max(1, sn.size);
  return sn.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Por facturar: lo que ya corresponde facturar según la modalidad del cliente ──
// Diaria: órdenes de días anteriores · Semanal: de semanas anteriores (lunes a domingo) · Mensual: de meses anteriores
// v0.16.1 (regla de Emmanuel, 8-oct): diaria se factura el mismo día; semanal el sábado de esa semana
// (semana de lunes a domingo: una orden del domingo se factura ese mismo domingo, v0.16.2); mensual el último día del mes (así el IVA queda en ese mes).
export function diaDeFacturar(facturacion, fecha) {
  if (!fecha) return null;
  const f = String(facturacion || '').trim().toLowerCase();   // la planilla puede traer "semanal", "Mensual ", etc.
  const d = new Date(fecha.slice(0, 10) + 'T12:00:00');
  if (/viernes/.test(f)) { d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7); return hoyTxt(d); }   // v0.112.1: sábado a viernes → ese viernes
  if (/^seman/.test(f)) { if (d.getDay() !== 0) d.setDate(d.getDate() + (6 - d.getDay())); return hoyTxt(d); }   // semana de lunes a domingo: lunes a sábado → ese sábado; domingo → ese domingo
  if (/^mensu/.test(f)) return hoyTxt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return fecha.slice(0, 10);
}
export function correspondeFacturar(facturacion, fecha, hoy = hoyTxt()) {
  const dia = diaDeFacturar(facturacion, fecha);
  return !!dia && dia <= hoy;
}
// v0.52.0 · Cómo factura el cliente, normalizado ("semanal", "Mensual ", vacío → diaria)
export function modoFacturacion(facturacion) {
  const f = String(facturacion || '').trim().toLowerCase();
  return /viernes/.test(f) ? 'viernes' : /^seman/.test(f) ? 'semanal' : /^mensu/.test(f) ? 'mensual' : 'diaria';
}
// El período al que pertenece una orden: diaria → el día; semanal → el lunes de su semana (lunes a domingo); mensual → el mes;
// v0.112.1 · semanal viernes → el sábado que abre su semana (sábado a viernes)
export function periodoFacturacion(facturacion, fecha) {
  if (!fecha) return null;
  const f = String(fecha).slice(0, 10), m = modoFacturacion(facturacion);
  if (m === 'mensual') return f.slice(0, 7);
  if (m === 'semanal') { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return hoyTxt(d); }
  if (m === 'viernes') { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() - (d.getDay() + 1) % 7); return hoyTxt(d); }
  return f;
}
// v0.52.0 · Cuántos períodos ya tocaba facturar y siguen con órdenes sin folio (la etiqueta de cada cliente en Por facturar).
// fechas: las fechas de sus órdenes sin folio (o las órdenes, con .fecha). Un período cuenta si ya llegó su día de facturar
// (correspondeFacturar): diaria → días distintos; semanal → semanas distintas (lunes a domingo); mensual → meses distintos.
export function periodosPendientes(facturacion, fechas, hoy = hoyTxt()) {
  const m = modoFacturacion(facturacion), vistos = new Set();
  (fechas || []).forEach(x => {
    const f = typeof x === 'string' ? x : x && x.fecha;
    if (f && correspondeFacturar(m, f, hoy)) vistos.add(periodoFacturacion(m, f));
  });
  return vistos.size;
}

// ═══════════════════════════════════════════════
//  v0.16.0 · Agenda: cobros por la fecha acordada, días de conciliar, facturar y análisis semanal
// ═══════════════════════════════════════════════
let cacheAgendaB2b = null;   // 5 minutos en memoria
export async function datosAgenda(forzar) {
  let cx;
  try { cx = await conexion(); } catch (e) { return null; }
  if (cx.estado !== 'ok') return null;
  if (!forzar && cacheAgendaB2b && Date.now() - cacheAgendaB2b.t < 300000) return cacheAgendaB2b.d;
  // v0.63.3: también guardado en este navegador (5 minutos): abrir la app de nuevo no vuelve a leer las órdenes por cobrar y los clientes
  if (!forzar) { const v = Mem.ver('b2b:agenda', 300000); if (v) { cacheAgendaB2b = { t: Date.now(), d: v }; return v; } }
  const db = cx.db, vivas = sn => sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !o.quitadoEnPlanilla && o.estado !== 'anulada');
  const [pc, sf, cl, cc, cb] = await Promise.all([
    FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('estadoPago', 'in', ['PENDIENTE', 'PARCIAL']))),
    FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('sinFolio', '==', true))),
    FB.getDocs(FB.collection(db, 'clientes')),
    FB.getDoc(FB.doc(db, 'config', 'conciliacion')),
    FB.getDocs(FB.collection(db, 'cobranza')).catch(() => null)   // sin las reglas v1.6.0: la agenda sigue sin compromisos
  ]);
  const porCobrar = vivas(pc), sinFolio = vivas(sf), clientes = cl.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.quitadoEnPlanilla);
  // Abonos solo de los folios con pago parcial (de a 30 por consulta)
  const folios = [...new Set(porCobrar.filter(o => o.folio && String(o.estadoPago).toUpperCase() === 'PARCIAL').map(o => String(o.folio)))];
  const abonos = [];
  for (let i = 0; i < folios.length; i += 30) { const sn = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', 'in', folios.slice(i, i + 30)))); sn.docs.forEach(d => { const a = d.data(); if (!a.quitadoEnPlanilla) abonos.push(a); }); }
  uso.lecturas += pc.size + sf.size + cl.size + abonos.length + 1;
  const cobranza = {}; if (cb) cb.docs.forEach(x => { cobranza[x.id] = x.data(); });
  const d = { porCobrar, sinFolio, clientes, abonos, conciliacion: cc.exists() ? cc.data() : null, cobranza };
  cacheAgendaB2b = { t: Date.now(), d };
  Mem.memo('b2b:agenda', async () => d, { guardar: true, forzar: true, ttl: 300000 }).catch(() => {});
  return d;
}
export function olvidarAgendaB2b() { cacheAgendaB2b = null; Mem.olvidar('b2b:'); }
// Lo de B2B para la agenda entre desde y hasta. Cada elemento: { auto, cat, fecha, titulo, sub, url, vencido, hecho }
export function itemsAgendaB2b(d, desde, hasta, hoy = hoyTxt()) {
  if (!d) return [];
  const out = [], norm = t => String(t || '').trim().toLowerCase(), enRango = f => f >= desde && f <= hasta;
  const clientes = d.clientes.filter(c => c.estado !== 'archivado');
  // v0.24.0 · Cobranza resumida: hoy, cuántos clientes están en cobranza; los compromisos de pago en su día;
  // y, hacia adelante, el día en que un folio entraría en cobranza si no se paga
  const cob = armarCobranza(foliosPorCobrar(d.porCobrar, d.abonos, d.clientes), d.clientes, d.cobranza || {}, d.conciliacion, hoy);
  if (enRango(hoy) && cob.cobrar.length) out.push({ auto: true, cat: 'cobro', fecha: hoy, titulo: `Cobranza: ${cob.cobrar.length} ${cob.cobrar.length === 1 ? 'cliente' : 'clientes'}`, sub: `${cob.cobrar.reduce((s, g) => s + g.folios.length, 0)} folios · $${Math.round(cob.cobrar.reduce((s, g) => s + g.saldo, 0)).toLocaleString('es-CL')}`, url: '#b2b/cobranza', vencido: true });
  cob.esperando.forEach(g => { const x = g.compromiso || g.dice; if (g.compromiso && enRango(x.fecha)) out.push({ auto: true, cat: 'cobro', fecha: x.fecha, titulo: `Compromiso de pago: ${g.cliente.nombre}`, sub: `${g.folios.length === 1 ? 'Folio ' + g.folios[0].folio : g.folios.length + ' folios'} · $${Math.round(g.saldo).toLocaleString('es-CL')}`, url: '#b2b/cobranza/' + encodeURIComponent(g.cliente.nombre) }); });
  const entran = {};
  [...cob.cobrar, ...cob.esperando, ...cob.alDia].forEach(g => g.alDia.forEach(f => { if (f.cobrarDesde > hoy && enRango(f.cobrarDesde)) { const k = f.cobrarDesde; (entran[k] = entran[k] || { n: 0, saldo: 0, cli: new Set() }); entran[k].n++; entran[k].saldo += f.saldo; entran[k].cli.add(g.cliente.nombre); } }));
  Object.entries(entran).forEach(([f, e]) => out.push({ auto: true, cat: 'cobro', fecha: f, titulo: `Entran a cobranza si no pagan (${e.cli.size} ${e.cli.size === 1 ? 'cliente' : 'clientes'})`, sub: `${[...e.cli].slice(0, 3).join(', ')}${e.cli.size > 3 ? '…' : ''} · ${e.n} ${e.n === 1 ? 'folio' : 'folios'} · $${Math.round(e.saldo).toLocaleString('es-CL')}`, url: '#b2b/cobranza' }));
  // Días de conciliar (los que fijaste en Conciliación); los pasados quedan hechos si la cartola ya cubre hasta el día anterior
  const conf = d.conciliacion;
  if (conf && conf.importado) {
    const dias = diasRitmo(conf), revisado = hastaRevisado(conf, hoy);
    for (let f = desde; f <= hasta; f = masDiasB(f, 1)) if (dias.includes(new Date(f + 'T12:00:00').getDay())) out.push({ auto: true, cat: 'conciliar', fecha: f, titulo: 'Conciliar la cartola', sub: 'Días de conciliar', url: '#b2b/conciliacion', hecho: f <= hoy && !!revisado && revisado >= masDiasB(f, -1) });
  }
  // Facturar: hoy, lo que ya toca; hacia adelante, según cómo factura cada cliente (diaria: lunes a sábado; semanal: sábado; semanal viernes: viernes; mensual: último día del mes)
  const modo = c => modoFacturacion(c.facturacion);
  if (enRango(hoy)) {
    const cliDe = o => clientes.find(c => (o.clienteId && c.id === o.clienteId) || norm(c.nombre) === norm(o.cliente));
    const tocan = d.sinFolio.filter(o => { const c = cliDe(o); return correspondeFacturar(c ? c.facturacion : 'Diaria', o.fecha, hoy); });
    if (tocan.length) { const n = new Set(tocan.map(o => o.cliente)).size; out.push({ auto: true, cat: 'facturar', fecha: hoy, titulo: `Facturar ${tocan.length} ${tocan.length === 1 ? 'orden' : 'órdenes'}`, sub: `${n} ${n === 1 ? 'cliente' : 'clientes'} · Por facturar`, url: '#b2b' }); }
  }
  for (let f = masDiasB(hoy >= desde ? hoy : masDiasB(desde, -1), 1); f <= hasta; f = masDiasB(f, 1)) {
    const w = new Date(f + 'T12:00:00').getDay(), quienes = [];
    if (w !== 0 && clientes.some(c => modo(c) === 'diaria')) quienes.push('diarios');
    const sem = w === 6 ? clientes.filter(c => modo(c) === 'semanal').map(c => c.nombre) : w === 5 ? clientes.filter(c => modo(c) === 'viernes').map(c => c.nombre) : [], mes = masDiasB(f, 1).slice(8) === '01' ? clientes.filter(c => modo(c) === 'mensual').map(c => c.nombre) : [];
    if (!quienes.length && !sem.length && !mes.length) continue;
    out.push({ auto: true, cat: 'facturar', fecha: f, titulo: 'Facturar órdenes', sub: [quienes.length ? 'clientes de facturación diaria' : '', sem.length ? (w === 5 ? 'semanal viernes: ' : 'semanal: ') + sem.join(', ') : '', mes.length ? 'mensual: ' + mes.join(', ') : ''].filter(Boolean).join(' · '), url: '#b2b' });
  }
  // Análisis de ventas: cada lunes, la semana pasada
  for (let f = desde; f <= hasta; f = masDiasB(f, 1)) if (new Date(f + 'T12:00:00').getDay() === 1) out.push({ auto: true, cat: 'analisis', fecha: f, titulo: 'Revisar el análisis de ventas', sub: 'La semana pasada · Análisis B2B', url: '#b2b/analisis' });
  return out;
}
const masDiasB = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return hoyTxt(d); };

// ═══════════════════════════════════════════════
//  v0.13.2 · Cuánto aporta cada cliente y cómo paga
// ═══════════════════════════════════════════════
// Órdenes de los últimos 6 meses (para el análisis). Se guardan 6 horas en este equipo para no releer.
const K_ANALISIS = 'fen_b2b_analisis';
let cacheAnalisis = null;
export async function ordenesParaAnalisis(forzar) {
  const db = await dbOk();
  const ahora = Date.now();
  if (!forzar && !cacheAnalisis) { try { const c = JSON.parse(localStorage.getItem(K_ANALISIS) || 'null'); if (c && c.v === 2) cacheAnalisis = c; } catch (e) {} }
  if (!forzar && cacheAnalisis && ahora - cacheAnalisis.en < 6 * 3600e3) return cacheAnalisis;
  const h = new Date(), desde = hoyTxt(new Date(h.getFullYear(), h.getMonth() - 6, 1));
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('fecha', '>=', desde)));
  uso.lecturas += Math.max(1, sn.size);
  const campos = ['n', 'fecha', 'cliente', 'clienteId', 'neto', 'total', 'folio', 'fechaFolio', 'estadoPago', 'fechaPago', 'estado', 'quitadoEnPlanilla', 'medioPago', 'totalFactura'];   // v0.66.0: medioPago y totalFactura (efectivo cobrado)
  const ordenes = sn.docs.map(d => { const x = d.data(), o = { id: d.id }; campos.forEach(k => { if (x[k] !== undefined) o[k] = x[k]; }); return o; })
    .filter(o => !o.quitadoEnPlanilla && o.estado !== 'anulada');
  cacheAnalisis = { v: 2, en: ahora, desde, ordenes };
  try { localStorage.setItem(K_ANALISIS, JSON.stringify(cacheAnalisis)); } catch (e) {}
  return cacheAnalisis;
}
// v0.111.0 · Las órdenes del análisis (copia de hasta 6 horas) con el estado de hoy: lo que está en vivo manda; y una orden que en la
// copia figura por cobrar pero ya no está entre las por cobrar en vivo (esa consulta trae TODAS las pendientes), ya se pagó.
// Así "Debe hace N días" en Clientes desaparece apenas se registra el pago, sin leer nada más.
export function ordenesConEstadoVivo(copia, vivas, porCobrarListo) {
  const enVivo = new Map((vivas || []).map(o => [String(o.n), o]));
  const out = [...enVivo.values()];
  (copia || []).forEach(o => {
    if (enVivo.has(String(o.n))) return;
    const pend = o.folio && !String(o.estadoPago || '').toUpperCase().includes('PAGADO');
    out.push(porCobrarListo && pend ? { ...o, estadoPago: 'PAGADO', fechaPago: null, pagadoSegunVivo: true } : o);
  });
  return out;
}
export function olvidarAnalisis() { cacheAnalisis = null; try { localStorage.removeItem(K_ANALISIS); } catch (e) {} }

const fechaDe = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? m[0] : null; };
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
export const CORTES_PAGO = { verde: 7, amarillo: 30 };   // días: hasta 7 al día, hasta 30 más tarde, más de 30 tarde
// v0.16.1: días entre la factura y el pago acordado. Diaria, semanal y mensual pagan el mismo día de la factura
// (desde ese día quedan por cobrar); "30 días" tiene 30 días de plazo (se pueden ir registrando abonos).
const ACORDADO = { diaria: 0, semanal: 0, mensual: 0, '30dias': 30, '4 pagos semanales': 30 };   // v0.120.3: paga a 30 días, en 4 pagos semanales durante el mes siguiente
// ordenes: las de 6 meses (y además las pendientes de cualquier fecha); abonos: todos. Montos de compra en NETO.
export function analisisClientes(ordenes, abonos, clientes, hoy = hoyTxt()) {
  const mesDe = (k) => { const [y, m] = hoy.split('-').map(Number), d = new Date(y, m - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const m1 = mesDe(1), m3 = [mesDe(1), mesDe(2), mesDe(3)], mPrev = [mesDe(2), mesDe(3), mesDe(4)];
  const norm = t => String(t || '').trim().toLowerCase();
  const porNombre = {}; clientes.forEach(c => { porNombre[norm(c.nombre)] = c.id; });
  const idDe = o => o.clienteId || porNombre[norm(o.cliente)] || 'nombre:' + norm(o.cliente);
  const abonadoFolio = {}, ultAbono = {};
  abonos.forEach(a => { const f = String(a.folio); abonadoFolio[f] = (abonadoFolio[f] || 0) + (Number(a.monto) || 0); const fa = fechaDe(a.fecha); if (fa && (!ultAbono[f] || fa > ultAbono[f])) ultAbono[f] = fa; });
  const R = {};
  const r = id => R[id] || (R[id] = { meses: {}, dias: new Set(), pagos: [], pendientes: {}, ultimaCompra: null });
  const vistos = new Set();
  ordenes.forEach(o => {
    if (vistos.has(String(o.n))) return; vistos.add(String(o.n));
    const x = r(idDe(o)), f = fechaDe(o.fecha), neto = Number(o.neto) || 0;
    if (f) { x.meses[f.slice(0, 7)] = (x.meses[f.slice(0, 7)] || 0) + neto; x.dias.add(f); if (!x.ultimaCompra || f > x.ultimaCompra) x.ultimaCompra = f; }
    const ff = fechaDe(o.fechaFolio), e = String(o.estadoPago || '').toUpperCase();
    if (o.folio && !e.includes('PAGADO')) { const k = String(o.folio), p = x.pendientes[k] || (x.pendientes[k] = { folio: k, total: 0, desde: ff || f }); p.total += Number(o.total) || 0; if ((ff || f) && (ff || f) < p.desde) p.desde = ff || f; }
    if (o.folio && e.includes('PAGADO') && ff) { const fp = fechaDe(o.fechaPago); if (fp && diasEntre(ff, hoy) <= 190) x.pagos.push({ folio: String(o.folio), dias: Math.max(0, diasEntre(ff, fp)), peso: Number(o.total) || 0 }); }
  });
  const totalProm = Object.values(R).reduce((s, x) => s + m3.reduce((t, m) => t + (x.meses[m] || 0), 0) / 3, 0);
  const color = d => d == null ? null : d <= CORTES_PAGO.verde ? 'verde' : d <= CORTES_PAGO.amarillo ? 'amarillo' : 'rojo';
  const peor = (a, b) => ['rojo', 'amarillo', 'verde'].find(c => c === a || c === b) || null;
  const out = {};
  Object.entries(R).forEach(([id, x]) => {
    const mesAnt = x.meses[m1] || 0, prom3 = m3.reduce((s, m) => s + (x.meses[m] || 0), 0) / 3, previo = mPrev.reduce((s, m) => s + (x.meses[m] || 0), 0) / 3;
    const tend = previo > 0 && mesAnt > previo * 1.2 ? 'sube' : previo > 0 && mesAnt < previo * 0.8 ? 'baja' : null;
    // Cómo paga: promedio de días folio → pago, ponderado por monto (un folio cuenta una vez)
    const porFolio = {}; x.pagos.forEach(p => { const q = porFolio[p.folio] || (porFolio[p.folio] = { dias: p.dias, peso: 0 }); q.peso += p.peso; q.dias = Math.max(q.dias, p.dias); });
    const fs = Object.values(porFolio), pesoT = fs.reduce((s, p) => s + (p.peso || 1), 0);
    const diasPago = fs.length ? Math.round(fs.reduce((s, p) => s + p.dias * (p.peso || 1), 0) / pesoT) : null;
    // Cómo está hoy: lo que debe y el folio pendiente más antiguo
    const pend = Object.values(x.pendientes).map(p => ({ ...p, saldo: Math.max(0, p.total - (abonadoFolio[p.folio] || 0)), dias: p.desde ? Math.max(0, diasEntre(p.desde, hoy)) : 0 })).filter(p => p.saldo > 0);
    const deuda = pend.reduce((s, p) => s + p.saldo, 0), masAntiguo = pend.sort((a, b) => b.dias - a.dias)[0] || null;
    const cHist = color(diasPago), cHoy = masAntiguo ? color(masAntiguo.dias) : null;
    const semaforo = peor(cHist, cHoy) || (diasPago == null && !masAntiguo ? 'gris' : 'verde');
    // Dejó de comprar: intervalo típico (mediana entre días de compra) y días sin comprar
    const dias = [...x.dias].sort(), gaps = dias.slice(1).map((d, i) => diasEntre(dias[i], d)).sort((a, b) => a - b);
    const intervalo = gaps.length >= 3 ? gaps[Math.floor(gaps.length / 2)] : null;
    const diasSin = x.ultimaCompra ? diasEntre(x.ultimaCompra, hoy) : null;
    const dejo = intervalo != null && diasSin != null && diasSin > Math.max(intervalo * 2, intervalo + 7);
    const cl = clientes.find(c => c.id === id);
    const acordado = cl ? ACORDADO[norm(cl.frecuenciaPago)] : undefined;
    out[id] = { mesAnt, prom3, tend, peso: totalProm > 0 ? prom3 / totalProm : 0, diasPago, nFolios: fs.length, deuda, masAntiguo, nPendientes: pend.length, semaforo, cHist, cHoy, acordado, ultimaCompra: x.ultimaCompra, intervalo, diasSin, dejo };
  });
  return { porCliente: out, meses: { m1, m3 } };
}
// "Ya lo revisé": el aviso de Dejó de comprar se calla hasta que el cliente vuelva a comprar
export async function revisarDejoDeComprar(clienteId, ultimaCompra, nota) {
  const db = await dbOk();
  await FB.updateDoc(FB.doc(db, 'clientes', clienteId), { avisoCompra: { revisado: ahoraTxt(), ultimaCompra: ultimaCompra || null, nota: String(nota || '').trim().slice(0, 200) || null, por: authSF.currentUser.email } });
  uso.escrituras++; olvidarAgendaB2b();   // v0.63.4: Hoy no muestra el aviso guardado de antes
}
export const dejoVigente = (cliente, a) => !!(a && a.dejo && cliente && cliente.estado !== 'archivado' && !(cliente.avisoCompra && cliente.avisoCompra.ultimaCompra === a.ultimaCompra));
// Para Hoy: clientes que dejaron de comprar (sin "Ya lo revisé"). Solo con la base nueva en uso; no pide nada.
export async function dejoDeComprarParaHoy() {
  let cx;
  try { cx = await conexion(); } catch (e) { return null; }
  if (cx.estado !== 'ok') return null;
  const cfg = await configB2b(cx.db);
  if (!cfg || !cfg.activa) return null;
  // v0.63.3: los clientes salen de los datos de la agenda (ya leídos para Hoy), no de otra lectura de toda la colección
  const [an, ag] = await Promise.all([ordenesParaAnalisis(false), datosAgenda()]);
  if (!ag) return null;
  const clientes = ag.clientes;
  const r = analisisClientes(an.ordenes, [], clientes);
  return clientes.filter(c => dejoVigente(c, r.porCliente[c.id])).map(c => ({ id: c.id, nombre: c.nombre, diasSin: r.porCliente[c.id].diasSin, intervalo: r.porCliente[c.id].intervalo }))
    .sort((a, b) => b.diasSin - a.diasSin);
}

// ═══════════════════════════════════════════════
//  v0.14.0 · Conciliación bancaria con la cartola (BancoEstado, Chequera Electrónica)
// ═══════════════════════════════════════════════
// Lo mismo que hacía la app B2B, ahora con la base nueva:
//  · cada abono de la cartola se identifica por su "huella" (fecha|saldo|monto|descripción), igual que antes,
//    así lo ya conciliado en la app antigua no se vuelve a mostrar.
//  · el cliente se reconoce por lo aprendido, por el RUT de la descripción o por su nombre/razón social.
//  · la propuesta se calcula cada vez con los folios por cobrar de ese momento (nunca queda vieja).
export const normCartola = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normRut = s => String(s || '').toUpperCase().replace(/[^0-9K]/g, '');
export function montoCartola(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const n = parseFloat(String(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : Math.round(n);
}
function fechaCartolaISO(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const t = String(v).trim(), m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
}
// Histórica: la hoja Movimientos trae "DD/MM" (Chequera Electrónica) o "DD/MM/AAAA" (cuenta corriente);
// con "DD/MM" el año sale de "Fecha Inicio" (si cruza de diciembre a enero, suma 1)
function fechaConAnio(ddmm, inicio) {
  if (ddmm instanceof Date || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(String(ddmm || '').trim())) return fechaCartolaISO(ddmm);
  const d = String(ddmm || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/), i = String(inicio || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!d || !i) return '';
  const anio = Number(d[2]) < Number(i[2]) ? Number(i[3]) + 1 : Number(i[3]);
  return `${anio}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
}
function campoResumen(filas, etiqueta) {
  for (const f of filas) if (String(f[0] || '').trim().toLowerCase() === etiqueta.toLowerCase()) { const v = f.find((c, i) => i > 0 && String(c || '').trim()); if (v) return String(v).trim(); }
  return null;
}
// v0.18.0 · De qué cuenta es: la cuenta corriente lo dice en el resumen ("N° Cuenta Corriente" o "Cuenta Corriente");
// si no, es la Chequera Electrónica (como hasta ahora). El número se guarda para mostrar sus últimos 4 dígitos.
export const NOMBRE_CUENTA = { cc: 'Cuenta corriente', chequera: 'Chequera Electrónica', mp: 'Mercado Pago' };   // v0.81.0: Mercado Pago (solo cargos, en Gastos)
function cuentaDeCartola(resumen, filasCrudas) {
  const num = v => (String(v || '').match(/\d{6,}/) || [''])[0] || null;
  const cc = campoResumen(resumen, 'N° Cuenta Corriente') || campoResumen(resumen, 'Cuenta Corriente') || (filasCrudas[0] && filasCrudas[0]['N° Cuenta Corriente']);
  if (cc) return { tipo: 'cc', numero: num(cc) };
  const ch = campoResumen(resumen, 'N° Cuenta') || campoResumen(resumen, 'Chequera Electrónica') || campoResumen(resumen, 'Chequera Electronica') || (filasCrudas[0] && filasCrudas[0]['N° Cuenta']);
  return { tipo: 'chequera', numero: num(ch) };
}
export const ultimos4 = n => (n ? '···' + String(n).slice(-4) : '');
// wb: libro leído con SheetJS (XLSX.read(buf, { type: 'array', cellDates: true }))
export function leerCartola(wb, XLSX) {
  const resumen = wb.SheetNames.includes('Resumen') ? XLSX.utils.sheet_to_json(wb.Sheets['Resumen'], { header: 1, defval: '' }) : [];
  const desc = r => String(r['Descripción'] || r['Descripcion'] || '').trim();
  const col = (r, ...ns) => { for (const n of ns) if (r[n] !== undefined && r[n] !== '') return r[n]; return ''; };
  const operacion = r => String(col(r, 'N° Operación', 'N° Operacion', 'Nº Operación')).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  let filas, identificador, tipo, crudas;
  if (wb.SheetNames.includes('Movimientos')) {
    tipo = 'historica';
    const inicio = campoResumen(resumen, 'Fecha Inicio');
    crudas = XLSX.utils.sheet_to_json(wb.Sheets['Movimientos'], { defval: '' });
    filas = crudas.map(r => ({ fecha: fechaConAnio(r['Fecha'], inicio), descripcion: desc(r), cargos: montoCartola(col(r, 'Cheques / Cargos', 'Cargos', 'Cargo')), abonos: montoCartola(col(r, 'Depósitos / Abonos', 'Abonos', 'Abono')), saldo: montoCartola(r['Saldo']), operacion: operacion(r) })).filter(f => f.descripcion);
    if (filas.some(f => (f.abonos > 0 || f.cargos > 0) && !f.fecha)) throw new Error('No se pudo saber el año de las fechas (falta "Fecha Inicio" en la hoja Resumen).');
    var nCartola = campoResumen(resumen, 'N° Cartola') || (crudas[0] && String(crudas[0]['N° Cartola'] || '').trim()) || null;
    identificador = `Histórica N°${nCartola || '?'} (${inicio || '?'} a ${campoResumen(resumen, 'Fecha Final') || '?'})`;
    var desdeC = fechaCartolaISO(inicio), hastaC = fechaCartolaISO(campoResumen(resumen, 'Fecha Final'));
  } else {
    tipo = 'enlinea';
    const hoja = wb.SheetNames.includes('Registros') ? 'Registros' : wb.SheetNames[0];
    crudas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });
    filas = crudas.map(r => ({ fecha: fechaCartolaISO(r['Fecha']), descripcion: desc(r), cargos: montoCartola(col(r, 'Cargos', 'Cargo', 'Cheques / Cargos')), abonos: montoCartola(col(r, 'Abonos', 'Abono', 'Depósitos / Abonos')), saldo: montoCartola(r['Saldo']), operacion: operacion(r) })).filter(f => f.descripcion && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha));
    let gen = null;
    resumen.forEach(f => f.forEach(c => { const m = String(c || '').match(/Fecha\s*-\s*Hora\s+(\d{2}\/\d{2}\/\d{4})-(\d{2}:\d{2})/); if (m) gen = m[1] + ' ' + m[2]; }));
    const fs = filas.map(f => f.fecha).sort();
    identificador = gen ? 'En línea generada ' + gen : `En línea (${fs[0] || '?'} a ${fs[fs.length - 1] || '?'})`;
  }
  if (!filas.length) throw new Error('El archivo no tiene movimientos. ¿Es la cartola de BancoEstado (histórica o en línea)?');
  const cuenta = cuentaDeCartola(resumen, crudas);
  // La Chequera mantiene su identificador de siempre (así lo ya cargado se reconoce); la cuenta corriente lo lleva adelante
  if (cuenta.tipo === 'cc') identificador = 'Cta. Cte. · ' + identificador;
  const fs = filas.map(f => f.fecha).filter(Boolean).sort();
  return { tipo, identificador, filas, cuenta, nCartola: tipo === 'historica' ? nCartola : null, desde: (tipo === 'historica' && desdeC) || fs[0] || null, hasta: (tipo === 'historica' && hastaC) || fs[fs.length - 1] || null };
}
// ═══ v0.27.0 · Transferencias recibidas (BancoEstado: "Consulta transferencias recibidas" o "Consulta Transferencia Electrónica") ═══
// Trae lo que la cartola no tiene: el RUT, el nombre completo y el banco de quien transfiere.
// v0.63.4: se reconoce por los encabezados de la tabla (Rut Origen, Monto, Fecha…), en cualquier hoja y fila, no por el título
// ni por el nombre de la hoja: el banco cambia el título según la consulta.
const COLS_TEF = { op: ['N OPERACION', 'N DE OPERACION', 'NRO OPERACION', 'NUMERO OPERACION', 'NUMERO DE OPERACION', 'OPERACION'], fecha: ['FECHA HORA', 'FECHA Y HORA', 'FECHA'], hora: ['HORA'],
  rut: ['RUT ORIGEN', 'RUT DE ORIGEN', 'RUT ORIGINADOR', 'RUT EMISOR'], nombre: ['NOMBRE ORIGEN', 'NOMBRE DE ORIGEN', 'NOMBRE ORIGINADOR', 'NOMBRE EMISOR'], banco: ['BANCO ORIGEN', 'BANCO DE ORIGEN', 'BANCO EMISOR'],
  monto: ['MONTO', 'MONTO TRANSFERIDO', 'MONTO TRANSFERENCIA'], alias: ['ALIAS DESTINO'], cuentaDest: ['CUENTA DESTINO', 'CUENTA DE DESTINO'] };
function encabezadoTef(fila) {
  const n = (fila || []).map(normCartola), idx = {};
  Object.entries(COLS_TEF).forEach(([k, al]) => { const i = n.findIndex(x => al.includes(x)); if (i >= 0) idx[k] = i; });
  return idx.rut !== undefined && idx.monto !== undefined && idx.fecha !== undefined ? idx : null;
}
export function leerTransferencias(wb, XLSX) {
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' });
    const h = filas.slice(0, 40).findIndex(f => encabezadoTef(f));
    if (h < 0) continue;
    const ix = encabezadoTef(filas[h]), v = (r, k) => ix[k] === undefined ? '' : r[ix[k]];
    const fechaHora = x => { if (x instanceof Date) return { f: hoyTxt(x), h: x.getHours() || x.getMinutes() ? `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}` : '' }; const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}:\d{2}))?/.exec(String(x || '')); return m ? { f: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, h: m[4] || '' } : { f: '', h: '' }; };
    return filas.slice(h + 1).map(r => {
      const fh = fechaHora(v(r, 'fecha')), hs = /(\d{1,2}:\d{2})/.exec(String(v(r, 'hora') instanceof Date ? `${v(r, 'hora').getHours()}:${String(v(r, 'hora').getMinutes()).padStart(2, '0')}` : v(r, 'hora')));
      const rut = normRut(v(r, 'rut'));
      return { op: String(v(r, 'op') || '').replace(/\D/g, ''), fecha: fh.f, hora: fh.h || (hs ? hs[1].padStart(5, '0') : ''), rut, rutTxt: String(v(r, 'rut') || '').trim(), nombre: String(v(r, 'nombre') || '').trim().slice(0, 80),
        banco: String(v(r, 'banco') || '').trim().slice(0, 40), monto: montoCartola(v(r, 'monto')), cuenta: /corriente/i.test(String(v(r, 'alias') || v(r, 'cuentaDest') || '')) ? 'cc' : 'chequera' };
    }).filter(t => t.fecha && t.monto > 0 && t.rut);
  }
  return null;
}
// Se guardan en config/conciliacion.transferencias (sin repetir por N° de operación; los últimos 180 días, hasta 800)
export async function guardarTransferencias(lista) {
  const db = await dbOk(), cref = FB.doc(db, 'config', 'conciliacion');
  let nuevas = 0;
  await FB.runTransaction(db, async tx => {
    const cs = await tx.get(cref), prev = (cs.exists() && Array.isArray(cs.data().transferencias)) ? cs.data().transferencias : [];
    const clave = t => t.op || `${t.fecha}|${t.monto}|${t.rut}|${t.hora}`, vistos = new Set(prev.map(clave));
    const add = lista.filter(t => !vistos.has(clave(t))); nuevas = add.length;
    const corte = masDiasB(hoyTxt(), -180);
    tx.set(cref, { transferencias: prev.concat(add).filter(t => t.fecha >= corte).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-800) }, { merge: true });
  });
  uso.escrituras++;
  return { leidas: lista.length, nuevas };
}
// La transferencia de un abono de la cartola: misma cuenta y mismo monto; la cartola puede anotarla desde un día antes
// (zona horaria) hasta 3 días hábiles después (v0.63.4: una del sábado aparece el lunes). Gana la fecha más cercana;
// si empatan, la que calza con el nombre. Una transferencia nunca queda en dos abonos.
const nombreCalza = (mov, t) => { const pag = normCartola(mov.descripcion).replace(PREFIJOS, '').trim(), n = normCartola(t.nombre); return !!(pag && n && (n.startsWith(pag) || pag.startsWith(n))); };
// Para varios abonos a la vez: Map(mov → transferencia). Se asigna primero el par más cercano de todos (así el abono
// del lunes no le quita al del martes su transferencia del martes); un abono con dos posibles sin desempate queda sin ella.
export function asignarTransferencias(movs, tefs, usadas) {
  const out = new Map(), libres = new Set((tefs || []).filter(t => !(usadas && usadas.has(t)))), porMonto = new Map();
  libres.forEach(t => { const k = t.monto + '|' + (t.cuenta || 'chequera'); if (!porMonto.has(k)) porMonto.set(k, []); porMonto.get(k).push(t); });
  const cands = new Map();
  (movs || []).forEach(mv => {
    const l = (porMonto.get(mv.monto + '|' + (mv.cuenta || 'chequera')) || []).map(t => ({ t, d: distanciaTef(t.fecha, mv.fecha) })).filter(x => x.d !== null);
    if (l.length) cands.set(mv, l);
  });
  for (;;) {
    let mejor = null;
    [...cands.keys()].forEach((mv, orden) => {
      const l = cands.get(mv).filter(x => libres.has(x.t));
      if (!l.length) { cands.delete(mv); return; }
      const dmin = Math.min(...l.map(x => x.d)), tramo = l.filter(x => x.d === dmin);
      let elegida = null, porNombre = false;
      const mismoRut = l2 => l2.every(x => x.t.rut === l2[0].t.rut);   // iguales (mismo RUT): da lo mismo cuál
      if (tramo.length === 1 || mismoRut(tramo)) { elegida = tramo[0].t; porNombre = nombreCalza(mv, elegida); }
      else { const n = tramo.filter(x => nombreCalza(mv, x.t)); if (n.length === 1 || (n.length > 1 && mismoRut(n))) { elegida = n[0].t; porNombre = true; } }
      if (!elegida) return;   // empate sin desempate: espera (si otro abono se lleva una, puede quedar sola)
      const clave = [dmin, porNombre ? 0 : 1, orden];
      if (!mejor || clave[0] < mejor.clave[0] || (clave[0] === mejor.clave[0] && (clave[1] < mejor.clave[1] || (clave[1] === mejor.clave[1] && clave[2] < mejor.clave[2])))) mejor = { mv, t: elegida, clave };
    });
    if (!mejor) break;
    out.set(mejor.mv, mejor.t); libres.delete(mejor.t); cands.delete(mejor.mv);
  }
  return out;
}
export function transferenciaDe(mov, tefs, usadas) { return asignarTransferencias([mov], tefs, usadas).get(mov) || null; }
export const huellaMovimiento = f => `${f.fecha}|${f.saldo}|${f.abonos}|${normCartola(f.descripcion)}`;
export async function idMovimiento(huella) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(huella));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const CONC_DEF = { ignorar: ['TRANSBANK'], equivalencias: [] };
export const configConciliacion = c => ({ ...CONC_DEF, ...(c || {}), ignorar: (c && c.ignorar) || CONC_DEF.ignorar, equivalencias: (c && c.equivalencias) || [] });

// Guarda los abonos nuevos de la cartola como "pendientes" (los ya vistos no se repiten)
export async function cargarCartola(cartola, conf) {
  const db = await dbOk();
  // v0.69.0 · Con las reglas migradas, se saltan los textos de las reglas "No es de B2B" activas que se ignoran solas al subir
  const c = configConciliacion(conf), ign = (migradoB2b(conf) ? RC.ignorarAlSubir(reglasB2b(conf)) : c.ignorar).map(normCartola).filter(Boolean);
  const r = { abonos: 0, nuevos: 0, yaVistos: 0, ignorados: 0, cargos: 0, identificador: cartola.identificador };
  const cand = [];
  cartola.filas.forEach((f, i) => {
    if (!(f.abonos > 0)) { r.cargos++; return; }
    r.abonos++;
    const dn = normCartola(f.descripcion);
    if (ign.some(p => dn.includes(p))) { r.ignorados++; return; }
    cand.push({ f, i, huella: huellaMovimiento(f) });
  });
  const ids = await Promise.all(cand.map(x => idMovimiento(x.huella)));
  // v0.67.7 · Una sola consulta por rango de fechas: [la primera − 1 día, la última + 1 día] del archivo, todas las cuentas y estados
  // (se filtra aquí). Sirve para dos cosas: lo ya visto (la misma huella) y el mismo movimiento que llegó en otra cartola.
  // Lo que no aparece en el rango se pregunta uno por uno, como antes (por si un documento antiguo tiene otra fecha).
  const fechas = cand.map(x => fechaDe(x.f.fecha)).filter(Boolean).sort();
  const enRango = new Map();
  let lect = 0;
  if (fechas.length) { const rr = await leerRango(db, masDiasB(fechas[0], -1), masDiasB(fechas[fechas.length - 1], 1)); lect += rr.lecturas; rr.docs.forEach(d => enRango.set(d.id, d)); }
  const faltan = [...new Set(ids.filter(id => !enRango.has(id)))];
  const sns = await Promise.all(faltan.map(id => FB.getDoc(FB.doc(db, 'movimientos', id))));
  uso.lecturas += faltan.length; lect += faltan.length;
  const existe = new Set(faltan.filter((id, k) => sns[k].exists()).concat([...enRango.keys()]));
  const cuenta = (cartola.cuenta && cartola.cuenta.tipo) || 'chequera', ahora = ahoraSeg(), quien = authSF.currentUser.email;
  const llegan = [], vistosAqui = new Set();
  cand.forEach((x, k) => {
    if (existe.has(ids[k]) || vistosAqui.has(ids[k])) { r.yaVistos++; return; }
    vistosAqui.add(ids[k]);
    llegan.push({ id: ids[k], x, d: { huella: x.huella, fecha: x.f.fecha, descripcion: x.f.descripcion, descNorm: normCartola(x.f.descripcion), monto: x.f.abonos, saldo: x.f.saldo, orden: x.i,
      nOperacion: String(x.f.operacion || ''), tipoCartola: cartola.tipo || '', nCartola: cartola.nCartola || null,   // v0.67.7: para reconocer el mismo movimiento y mostrar de dónde vino
      cartola: cartola.identificador, cuenta, estado: 'pendiente', origen: 'sistema-fen', cargado: { por: quien, en: FB.serverTimestamp() }, planillaPendiente: false } });
  });
  // v0.67.7 · ¿El mismo movimiento que ya llegó en OTRA cartola (en línea ↔ histórica)? Las mismas reglas que los cargos (v0.67.6)
  const orig = [...enRango.values()].filter(m => !m.quitadoEnPlanilla).map(vistaRepMov);
  const rep = CB.buscarRepetidos(llegan.map(l => vistaRepMov({ id: l.id, ...l.d, subidaEl: ahora })), orig, { tomados: CB.tomadosDe(orig) });
  const porEscribir = [], reemplazos = [];
  r.repetidos = 0; r.parecidos = 0; r.reemplazados = 0;
  llegan.forEach(l => {
    const m = rep.get(l.id), o = m && m.original && m.original.m;
    // v0.114.2 · La histórica (con la glosa completa) reemplaza al mismo abono de una cartola en línea que sigue pendiente: el de la
    // en línea pasa a "Repetido" de esta histórica (con su N°) y queda por conciliar el de la histórica. Si ya estaba resuelto, como antes.
    if (m && m.auto && cartola.tipo === 'historica' && o && o.estado === 'pendiente' && fuenteMov(o).tipo === 'enlinea') {
      const det = detalleRepetidoMov({ id: l.id, ...l.d, subidaEl: ahora, cargado: { por: quien, en: ahora } }, m.por, 'reemplazo');
      reemplazos.push([o.id, { estado: REPETIDO_B2B, repetidoDe: l.id, repetido: det, resuelto: { por: POR_REPETIDO_B2B, en: FB.serverTimestamp() } }, o]);
      r.reemplazados++; r.nuevos++;
    } else if (m && m.auto) {
      const det = detalleRepetidoMov(m.original.m, m.por, 'carga');
      Object.assign(l.d, { estado: REPETIDO_B2B, repetidoDe: m.original.id, repetido: det, resuelto: { por: POR_REPETIDO_B2B, en: FB.serverTimestamp() } });
      r.repetidos++;
    } else { r.nuevos++; if (m) r.parecidos++; }
    porEscribir.push([l.id, l.d]);
  });
  // v0.114.2 · Primero el de la en línea pasa a repetido (memoria y base) y después llega el de la histórica: así la revisión de la lista
  // (que corre al llegar lo nuevo) nunca toma al de la en línea como original del de la histórica
  reemplazos.forEach(([id, d, o]) => { const p = repMem.docs.get(id) || o; repMem.docs.set(id, { ...p, ...d, id, resuelto: { por: POR_REPETIDO_B2B, en: ahora }, _reemplazado: true }); });
  for (let i = 0; i < reemplazos.length; i += 400) { const b = FB.writeBatch(db); reemplazos.slice(i, i + 400).forEach(([id, d]) => b.update(FB.doc(db, 'movimientos', id), d)); await b.commit(); uso.escrituras += Math.min(400, reemplazos.length - i); }
  for (let i = 0; i < porEscribir.length; i += 400) { const b = FB.writeBatch(db); porEscribir.slice(i, i + 400).forEach(([id, d]) => b.set(FB.doc(db, 'movimientos', id), d)); await b.commit(); uso.escrituras += Math.min(400, porEscribir.length - i); }
  // Lo recién subido queda en la memoria de los repetidos (así la lista no vuelve a leer este rango)
  porEscribir.forEach(([id, d]) => repMem.docs.set(id, { id, ...d, subidaEl: ahora, cargado: { por: quien, en: ahora }, ...(d.resuelto ? { resuelto: { por: d.resuelto.por, en: ahora } } : {}), _subido: true }));
  // v0.14.5: queda anotada la cartola (tipo, N°, período) para saber hasta dónde se revisó
  await anotarCartola({ id: cartola.identificador, tipo: cartola.tipo, cuenta, cuentaFin: cartola.cuenta && cartola.cuenta.numero ? String(cartola.cuenta.numero).slice(-4) : null,
    nCartola: cartola.nCartola || null, desde: cartola.desde || null, hasta: cartola.hasta || null, abonos: r.abonos, nuevos: r.nuevos, yaVistos: r.yaVistos, ignorados: r.ignorados, ...(r.repetidos ? { repetidos: r.repetidos } : {}),
    ...(cuadreCartola(cartola) ? { cuadre: cuadreCartola(cartola) } : {}) });   // v0.109.0
  r.lecturas = lect;   // v0.67.7: lecturas de movimientos al subir (el rango + los que no estaban en él)
  repMem.ultimaSubida = { lecturas: lect, enRango: enRango.size, sueltas: faltan.length, desde: fechas.length ? masDiasB(fechas[0], -1) : '', hasta: fechas.length ? masDiasB(fechas[fechas.length - 1], 1) : '' };
  return r;
}

// ═══════════════════════════════════════════════
//  v0.67.7 · El mismo abono en la cartola en línea y en la histórica
//  Igual que los cargos (v0.67.6, gastos-cartola.js): misma cuenta, mismo monto, fecha ±1 día y de OTRA subida; fuerte si además
//  tiene el mismo N° de operación (si los dos lo traen), la misma glosa normalizada o el mismo RUT. Dos N° de operación distintos
//  nunca son fuertes. Dos iguales de la misma subida nunca se comparan.
//  · Par fuerte y único → "repetido" (repetidoDe): no aparece por conciliar, no crea abonos ni pagos; en Ya conciliados con su chip.
//  · Débil o con dos posibles → queda pendiente, arriba, con la propuesta "Parece el mismo movimiento que…" (un clic).
//  · Deshacer → vuelve a pendiente (deshechos + 1, como pide la regla v1.5.0) con noRepetidoDe: no se vuelve a marcar con ese.
//  Los resueltos no están en la memoria (solo los pendientes): se leen por rango de fechas, una vez por sesión (repMem).
// ═══════════════════════════════════════════════
export const REPETIDO_B2B = 'repetido';
export const POR_REPETIDO_B2B = 'Sistema Fën (repetido)';
const ahoraSeg = (d = new Date()) => `${ahoraTxt(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
const msTxt = t => { const ms = msDe(t); return ms ? ahoraSeg(new Date(ms)) : ''; };
// De qué cartola vino un abono (de su identificador o, desde la v0.67.7, de tipoCartola y nCartola)
export function fuenteMov(m) {
  const id = String((m && m.cartola) || '');
  if ((m && m.tipoCartola === 'historica') || /Hist[oó]rica/i.test(id)) { const n = String((m && m.nCartola) || (id.match(/N°\s*([0-9A-Za-z]+)/) || [])[1] || ''); return { tipo: 'historica', numero: n }; }
  if (/App antigua/i.test(id) || (m && m.origen === 'app antigua' && !id)) return { tipo: 'antigua' };
  const g = id.match(/generada (\d{2})\/(\d{2})\/(\d{4})/); if (g) return { tipo: 'enlinea', generada: `${g[3]}-${g[2]}-${g[1]}` };
  const r = id.match(/\(\d{4}-\d{2}-\d{2} a (\d{4}-\d{2}-\d{2})\)/);
  if ((m && m.tipoCartola === 'enlinea') || /En l[ií]nea/i.test(id)) return { tipo: 'enlinea', generada: r ? r[1] : '' };
  return { tipo: '', texto: id };
}
export function textoFuenteMov(f) {
  if (!f) return 'otra cartola';
  if (f.tipo === 'historica') return `cartola histórica N°${f.numero || '?'}`;
  if (f.tipo === 'enlinea') return f.generada ? `cartola en línea del ${fechaDMY(f.generada)}` : 'cartola en línea';
  if (f.tipo === 'antigua') return 'app B2B antigua';
  return f.texto || 'otra cartola';
}
export const textoRepetidoMov = det => `Repetido de la ${textoFuenteMov(det && det.original && det.original.fuente)}`;
// Un abono como lo comparan las reglas de los cargos (gastos-cartola.buscarRepetidos)
const ESTADO_REP = { pendiente: 'POR_REVISAR', repetido: 'REPETIDO' };
export function vistaRepMov(m) {
  return { id: m.id, docId: m.id, cuenta: m.cuenta || 'chequera', fecha: fechaDe(m.fecha) || '', monto: Math.round(Number(m.monto) || 0), descripcion: m.descripcion || '', operacion: m.nOperacion || '',
    cartola: m.cartola || '', subidaEl: m.subidaEl || msTxt(m.cargado && m.cargado.en), estado: m._fuera ? 'RESUELTO' : ESTADO_REP[m.estado] || 'CONCILIADO', repetidoDe: m.repetidoDe || '',
    noRepetidoDe: Array.isArray(m.noRepetidoDe) ? m.noRepetidoDe : [], m };
}
// Lo que queda en el repetido (para mostrar el chip y el registro aunque el original ya no esté en la memoria)
export function detalleRepetidoMov(o, por, como) {
  const r = o.resuelto || {};
  return { repetidoDe: o.id, por: String(por || ''), como: String(como || ''), original: { fecha: fechaDe(o.fecha) || '', monto: Math.round(Number(o.monto) || 0), descripcion: String(o.descripcion || '').slice(0, 120),
    cuenta: o.cuenta || 'chequera', nOperacion: o.nOperacion || '', cartola: String(o.cartola || '').slice(0, 120), fuente: fuenteMov(o), estado: o.estado || '', cliente: o.cliente || '', clienteId: o.clienteId || null,
    folios: (o.asignaciones || []).map(a => ({ folio: String(a.folio), monto: Math.round(Number(a.monto) || 0), tipo: a.tipo || '' })).slice(0, 20), nota: o.nota || null,
    resueltoPor: r.por || '', resueltoEn: msTxt(r.en) || '', subidaPor: (o.cargado && o.cargado.por) || '', subidaEl: o.subidaEl || msTxt(o.cargado && o.cargado.en) || '' } };
}
// ── Memoria de esta sesión: los abonos leídos por rango (todos los estados) y los rangos ya leídos ──
const repMem = { docs: new Map(), rangos: [], lecturas: 0, consultas: 0, ultimaSubida: null };
export function olvidarRepetidosB2b() { repMem.docs.clear(); repMem.rangos = []; repMem.lecturas = 0; repMem.consultas = 0; }
export const usoRepetidosB2b = () => ({ lecturas: repMem.lecturas, consultas: repMem.consultas, rangos: repMem.rangos.map(r => r.slice()), ultimaSubida: repMem.ultimaSubida || null });
async function leerRango(db, desde, hasta) {
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'movimientos'), FB.where('fecha', '>=', desde), FB.where('fecha', '<=', hasta)));
  const n = Math.max(1, sn.size); uso.lecturas += n; repMem.lecturas += n; repMem.consultas++;
  const docs = sn.docs.map(x => ({ id: x.id, ...x.data() }));
  docs.forEach(d => { const p = repMem.docs.get(d.id); if (!p || !p._local) repMem.docs.set(d.id, d); });
  repMem.rangos.push([desde, hasta]);
  return { docs, lecturas: n };
}
// Lo ya leído en otro lado (Ya conciliados: los últimos N días) también sirve
export function anotarLeidosB2b(docs, desde, hasta) {
  (docs || []).forEach(d => { const p = repMem.docs.get(d.id); if (!p || !p._local) repMem.docs.set(d.id, { ...d }); });
  if (desde) repMem.rangos.push([desde, hasta || '9999-12-31']);
}
const cubierto = f => repMem.rangos.some(([a, b]) => f >= a && f <= b);
// Los días que faltan leer para comparar estos pendientes (cada uno ±1 día), juntos en tramos seguidos (como máximo 6 consultas)
export function tramosFaltantes(fechas, max = 6) {
  const dias = new Set();
  (fechas || []).forEach(f => { if (!fechaDe(f)) return; [-1, 0, 1].forEach(k => { const x = masDiasB(fechaDe(f), k); if (!cubierto(x)) dias.add(x); }); });
  const l = [...dias].sort(), tramos = [];
  l.forEach(x => { const t = tramos[tramos.length - 1]; if (t && masDiasB(t[1], 1) === x) t[1] = x; else tramos.push([x, x]); });
  while (tramos.length > max) {   // junta los dos tramos más cercanos (menos consultas; lee también los días entre medio)
    let k = 0, mejor = Infinity;
    for (let i = 0; i < tramos.length - 1; i++) { const g = diasEntre(tramos[i][1], tramos[i + 1][0]); if (g < mejor) { mejor = g; k = i; } }
    tramos.splice(k, 2, [tramos[k][0], tramos[k + 1][1]]);
  }
  return tramos;
}
// Un abono ya conocido (pendiente en la memoria o leído por rango): para "Ver el registro"
export const movConocido = id => repMem.docs.get(id) || null;
export const movsConocidos = () => [...repMem.docs.values()];
export const momentoTxt = t => (typeof t === 'string' ? t : msTxt(t));
// Después de resolver o deshacer desde aquí: la memoria queda al día sin leer de nuevo
function anotarLocal(id, cambios) {
  const p = repMem.docs.get(id); if (!p) return;
  repMem.docs.set(id, { ...p, ...cambios, _local: true, _fuera: false });
}
// pendientes: los abonos pendientes de la memoria (b2b.datos.movimientos). Lee por rango solo lo que falta (una vez por sesión),
// marca los pares claros (1 lectura y 1 escritura cada uno, una vez) y devuelve las propuestas.
// → { marcados, props: { [id]: { ambiguo, candidatos: [{ id, por, fuerte, dias }] } }, lecturas }
export async function revisarRepetidosB2b(pendientes) {
  const db = await dbOk(), vivos = new Set((pendientes || []).map(m => m.id));
  let lecturas = 0;
  for (const [a, b] of tramosFaltantes((pendientes || []).map(m => m.fecha))) lecturas += (await leerRango(db, a, b)).lecturas;
  (pendientes || []).forEach(m => { const p = repMem.docs.get(m.id); if (p && (p._reemplazado || (p.estado === REPETIDO_B2B && p.repetidoDe))) return;   // v0.114.2: ya repetido (leído de la base): la lista en vivo puede traerlo todavía pendiente
    repMem.docs.set(m.id, { ...(p && p._subido ? { subidaEl: p.subidaEl } : {}), ...m }); });
  // Un pendiente leído antes que ya no está pendiente: se resolvió en otro equipo (no se sabe cómo; no se propone como original dudoso)
  repMem.docs.forEach((d, id) => { if (d.estado === 'pendiente' && !vivos.has(id) && !d._subido && !d._local) d._fuera = true; });
  const vs = [...repMem.docs.values()].filter(m => !m.quitadoEnPlanilla).map(vistaRepMov);
  const pend = vs.filter(v => v.estado === 'POR_REVISAR' && vivos.has(v.id));
  const antes = (a, b) => (a.subidaEl + '|' + a.cartola + '|' + a.id) < (b.subidaEl + '|' + b.cartola + '|' + b.id);
  const r = CB.buscarRepetidos(pend, vs, { tomados: CB.tomadosDe(vs), puede: (n, e) => e.repetidoDe !== n.id && ((repMem.docs.get(e.id) || {}).repetidoDe || '') !== n.id && (e.estado !== 'POR_REVISAR' || antes(e, n)) });   // v0.114.2: el que ya es repetido de este (aunque la lista en vivo aún no lo sepa) no puede ser su original
  const autos = [], props = {};
  r.forEach((x, id) => { if (x.auto) autos.push({ id, x }); else props[id] = { ambiguo: !!x.ambiguo, candidatos: x.candidatos.map(y => ({ id: y.e.id, por: y.por, fuerte: !!y.fuerte, dias: y.dias })) }; });
  let marcados = 0;
  if (autos.length) {
    try { marcados = await marcarRepetidosB2b(autos.map(({ id, x }) => ({ id, original: x.original.m, por: x.por, como: 'lista' }))); }
    catch (e) { autos.forEach(({ id, x }) => { props[id] = { ambiguo: false, candidatos: [{ id: x.original.id, por: x.por, fuerte: true, dias: x.dias }] }; }); }   // sin cuota o sin red: queda la propuesta
    // lo que no se pudo marcar (cambió en otro lado) queda como propuesta
    autos.forEach(({ id, x }) => { const d = repMem.docs.get(id); if (d && d.estado === 'pendiente' && !props[id]) props[id] = { ambiguo: false, candidatos: [{ id: x.original.id, por: x.por, fuerte: true, dias: x.dias }] }; });
  }
  return { marcados, props, lecturas };
}
// Marca como repetidos (al listar o a mano). Cada uno se revisa adentro: sigue pendiente, la misma huella y no está en noRepetidoDe.
// lista: [{ id, original (abono), por, como, motivo }]. → cuántos marcó
async function marcarRepetidosB2b(lista) {
  const db = await dbOk(), quien = authSF.currentUser.email;
  let n = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const parte = lista.slice(i, i + 100);
    const hechos = await FB.runTransaction(db, async tx => {
      const refs = parte.map(x => FB.doc(db, 'movimientos', x.id)), sns = [];
      for (const ref of refs) sns.push(await tx.get(ref));
      const ok = [];
      parte.forEach((x, j) => {
        const sn = sns[j]; if (!sn.exists()) return;
        const a = sn.data(), prev = repMem.docs.get(x.id);
        if (a.estado !== 'pendiente' || (prev && prev.huella && prev.huella !== a.huella) || (a.noRepetidoDe || []).includes(x.original.id)) return;
        const det = { ...detalleRepetidoMov(x.original, x.por, x.como), ...(x.motivo ? { motivo: String(x.motivo).slice(0, 200) } : {}) };
        const resp = x.como === 'mano' ? quien : POR_REPETIDO_B2B;
        tx.update(refs[j], { estado: REPETIDO_B2B, repetidoDe: x.original.id, repetido: det, resuelto: { por: resp, en: FB.serverTimestamp() }, planillaPendiente: false });
        ok.push({ x, det, resp });
      });
      return ok;
    });
    uso.lecturas += parte.length; uso.escrituras += hechos.length;
    hechos.forEach(({ x, det, resp }) => anotarLocal(x.id, { estado: REPETIDO_B2B, repetidoDe: x.original.id, repetido: det, resuelto: { por: resp, en: ahoraSeg() } }));
    n += hechos.length;
  }
  return n;
}
// "Marcar como repetido" (la propuesta): revisa en el servidor que sea el mismo movimiento. 2 lecturas y 1 escritura.
export async function marcarRepetidoB2b(movId, origId, motivo) {
  const db = await dbOk();
  const [sm, so] = await Promise.all([FB.getDoc(FB.doc(db, 'movimientos', movId)), FB.getDoc(FB.doc(db, 'movimientos', origId))]);
  uso.lecturas += 2;
  if (!sm.exists() || !so.exists()) throw new Error('Ese abono ya no está.');
  const m = { id: movId, ...sm.data() }, o = { id: origId, ...so.data() };
  if (m.estado !== 'pendiente') throw new Error('Ese abono ya se resolvió.');
  if (o.estado === REPETIDO_B2B) throw new Error('El otro abono también es un repetido: elige el original.');
  const p = repMem.docs.get(movId), q = repMem.docs.get(origId);
  const vm = vistaRepMov({ ...m, subidaEl: (p && p.subidaEl) || '' }), vo = vistaRepMov({ ...o, subidaEl: (q && q.subidaEl) || '' });
  const x = CB.mismoMovimiento(vm, vo);
  if (!x) throw new Error('No es el mismo movimiento: debe ser de la misma cuenta, el mismo monto, la fecha a ±1 día y de otra cartola.');
  repMem.docs.set(origId, { ...(q || {}), ...o });
  const n = await marcarRepetidosB2b([{ id: movId, original: o, por: x.por, como: 'mano', motivo }]);
  if (!n) throw new Error('Ese abono cambió en otro lado: recarga la lista.');
}

// ── A quién corresponde y cómo repartir cada abono ──
const fechaDMY = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : (f || ''); };
const PREFIJOS = /^(TEF( BANCOESTADO)?( DE)+|TRANSF(ERENCIA)?( DE)+|TRASPASO( DE)+|DEP(OSITO)?( DE)?|ABONO( DE)?)\s*/;
// v0.114.1 · Orden pedido por Emmanuel (28 oct): primero el RUT, después el nombre completo, después lo aprendido (solo si la glosa dice
// quién pagó) y al final el nombre parcial. Así una glosa aprendida no le gana al RUT ni al nombre.
export function identificarCliente(mov, clientes, equivalencias) {
  const r = porRutGlosa(mov, clientes); if (r) return r;
  const n = porNombreGlosa(mov, clientes); if (n && n.por === 'nombre') return n;
  const a = porAprendido(mov, clientes, equivalencias); if (a) return a;
  return n;
}
export function porAprendido(mov, clientes, equivalencias) {
  if (glosaDeCanal(mov.descripcion)) return null;   // "TRANSFERENCIA DESDE MERCADO PAGO" no dice quién pagó
  const dn = mov.descNorm || normCartola(mov.descripcion);
  const eq = (equivalencias || []).find(e => e.desc === dn);
  const c = eq && clientes.find(x => x.id === eq.clienteId);
  return c ? { cliente: c, por: 'aprendido' } : null;
}
export function porRutGlosa(mov, clientes) {
  const m = String(mov.descripcion || '').toUpperCase().match(/(?<!\d)(\d{7,8})-?([0-9K])\b/);
  if (m && dvRut(m[1]) === m[2]) { const rut = m[1] + m[2], c = clientes.find(x => normRut(x.rut) === rut); if (c) return { cliente: c, por: 'rut' }; }
  return null;
}
export function porNombreGlosa(mov, clientes) {
  const dn = mov.descNorm || normCartola(mov.descripcion);
  // Por nombre o razón social, con palabras completas. Si el banco cortó la descripción (35 letras),
  // basta que el pagador sea el comienzo del nombre, pero eso nunca se confirma solo (queda para revisar).
  const pagador = dn.replace(PREFIJOS, '').trim(), cortada = String(mov.descripcion || '').trim().length >= 34;
  const conPalabras = (txt, n) => (' ' + txt + ' ').includes(' ' + n + ' ');
  let mejor = null, largo = 0, empate = false, seguro = false;
  clientes.forEach(c => [normCartola(c.nombre), normCartola(c.razonSocial)].forEach(n => {
    if (!n || n.length < 4) return;
    const entero = conPalabras(dn, n), prefijo = cortada && pagador.length >= 10 && n.startsWith(pagador) && (n.length === pagador.length || n[pagador.length] === ' ' || conPalabras(n, pagador.split(' ').slice(0, -1).join(' ')));
    if (!entero && !prefijo) return;
    const l = entero ? n.length : pagador.length;
    if (l > largo) { mejor = c; largo = l; empate = false; seguro = entero && n.length >= 8; } else if (l === largo && mejor && mejor.id !== c.id) empate = true;
  }));
  return mejor && !empate ? { cliente: mejor, por: seguro ? 'nombre' : 'nombre-parcial' } : null;
}
// Dígito verificador de un RUT chileno
function dvRut(num) { let s = 0, m = 2; for (let i = String(num).length - 1; i >= 0; i--) { s += Number(String(num)[i]) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); }
// Folios por cobrar de cada cliente, con su saldo (total − abonos), del más antiguo al más nuevo
// ═══ v0.25.0 · Lo que se cobra de un folio es el total de la FACTURA, no la suma de sus órdenes ═══
// El SII suma los netos de todas las líneas y calcula el IVA una sola vez (redondeado); cada orden redondea su propio IVA.
// Por eso, con varias órdenes, la factura puede diferir en ±$1 a ±$3 de la suma de las órdenes.
// Filas como en la factura: una por producto y precio; neto de la fila = cantidad × precio redondeado (como el SII).
export function calcularFactura(ordenes) {
  const F = {};
  (ordenes || []).forEach(o => (o.lineas || []).forEach(l => {
    const precio = Math.round(Number(l.precio) || 0), k = String(l.producto).trim() + '|' + precio;
    const f = F[k] || (F[k] = { producto: String(l.producto).trim(), precio, cantidad: 0 });
    f.cantidad = Math.round((f.cantidad + (Number(l.cantidad) || 0)) * 1e6) / 1e6;
  }));
  const filas = Object.values(F).map(f => ({ ...f, neto: Math.round(f.cantidad * f.precio) })).sort((a, b) => a.producto.localeCompare(b.producto, 'es') || a.precio - b.precio);
  const neto = filas.reduce((x, f) => x + f.neto, 0), iva = Math.round(neto * 0.19);
  return { filas, neto, iva, total: neto + iva };
}
// Total del folio: el que leyó el botón en el SII (totalFactura); si no, el calculado como el SII.
// Si una orden no trae líneas, o el cálculo se aleja más de lo que explica el redondeo, se usa la suma de las órdenes.
export function totalFolio(ordenes) {
  const vivas = (ordenes || []).filter(o => o.estado !== 'anulada' && !o.quitadoEnPlanilla);
  const suma = Math.round(vivas.reduce((x, o) => x + (Number(o.total) || 0), 0));
  const sii = vivas.map(o => Number(o.totalFactura)).find(x => x > 0);
  if (sii) return { total: sii, suma, fuente: 'sii', ajuste: sii - suma };
  if (!vivas.length || vivas.some(o => !(o.lineas || []).length)) return { total: suma, suma, fuente: 'ordenes', ajuste: 0 };
  const c = calcularFactura(vivas).total;
  return Math.abs(c - suma) <= Math.ceil(vivas.length / 2) + 1 ? { total: c, suma, fuente: 'calculado', ajuste: c - suma } : { total: suma, suma, fuente: 'ordenes', ajuste: 0 };
}
export function foliosPorCobrar(ordenes, abonos, clientes) {
  const norm = t => String(t || '').trim().toLowerCase(), porNombre = {};
  clientes.forEach(c => { porNombre[norm(c.nombre)] = c.id; });
  const ab = {}; abonos.forEach(a => { ab[String(a.folio)] = (ab[String(a.folio)] || 0) + (Number(a.monto) || 0); });
  // v0.26.0: abonos que dicen qué órdenes del folio pagaron
  const pagadaPor = {}; abonos.forEach(a => (Array.isArray(a.ordenes) ? a.ordenes : []).forEach(n => { pagadaPor[String(a.folio) + '|' + n] = fechaDe(a.fecha) || '—'; }));
  const F = {}, vistos = new Set();
  ordenes.forEach(o => {
    if (vistos.has(String(o.n))) return; vistos.add(String(o.n));
    if (!o.folio || o.estado === 'anulada' || o.quitadoEnPlanilla || o.incobrable || /PAGADO/.test(String(o.estadoPago || '').toUpperCase())) return;   // v0.106.0: lo dado por perdido no se cobra
    const k = String(o.folio), f = F[k] || (F[k] = { folio: k, total: 0, ordenes: [], _os: [], clienteId: o.clienteId || porNombre[norm(o.cliente)] || null, cliente: o.cliente, fecha: fechaDe(o.fechaFolio) || fechaDe(o.fecha) || '' });
    f._os.push(o); f.ordenes.push(o.n);
  });
  const out = {};
  Object.values(F).forEach(f => { const t = totalFolio(f._os);
    f.detalle = f._os.map(o => ({ n: o.n, fecha: fechaDe(o.fecha) || '', total: Math.round(Number(o.total) || 0), pagadaEl: pagadaPor[f.folio + '|' + o.n] || null })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.n - b.n);
    delete f._os; f.total = t.total; f.suma = t.suma; f.ajuste = t.ajuste; f.fuente = t.fuente; f.abonado = ab[f.folio] || 0; f.saldo = Math.max(0, Math.round(f.total - f.abonado)); if (f.saldo > 0 && f.clienteId) (out[f.clienteId] = out[f.clienteId] || []).push(f); });
  Object.values(out).forEach(l => l.sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(a.folio) - Number(b.folio)));
  return out;
}
// Reparto sugerido: primero los folios más antiguos completos; lo que sobra, como abono al siguiente
export function repartoFIFO(folios, monto) {
  let resto = monto; const a = [];
  for (const f of folios) { if (resto <= 0) break; const m = Math.min(resto, f.saldo); a.push({ folio: f.folio, monto: m }); resto -= m; }
  return { asignaciones: a, sobra: Math.max(0, resto) };
}
// v0.26.0 · Órdenes sin pagar de un folio que suman exacto un monto (no todas: eso es el folio completo)
function ordenesQueSuman(f, monto) {
  const pend = (f.detalle || []).filter(d => !d.pagadaEl), n = pend.length, out = [];
  if (n < 2 || n > 12) return out;
  for (let m = 1; m < (1 << n) - 1 && out.length < 20; m++) { let s = 0, edad = 0; for (let i = 0; i < n; i++) if (m & (1 << i)) { s += pend[i].total; edad += i; } if (s === monto) out.push({ edad, l: pend.filter((_, i) => m & (1 << i)) }); }
  return out.sort((a, b) => a.edad - b.edad).map(x => x.l.map(d => d.n));
}
// ═══ v0.65.2 · Solo montos EXACTOS (±$1): con la cartola en línea (glosas pobres) no se adivina el cliente ═══
// Seguro: el cliente se sabe por el RUT (transferencias recibidas o la glosa), por lo aprendido, porque lo elegiste tú o porque la
// glosa trae su nombre completo (como siempre). Probable: nadie dice quién es, pero el monto calza EXACTO con lo que debe un cliente
// (un folio, 2 a 4 folios, una orden de un folio de varias o todo lo que debe). Nunca se confirma solo. Si no calza exacto: nada.
export const TOL_EXACTO = 1;
export const SEGUROS = ['transferencia', 'rut', 'aprendido', 'manual', 'nombre'];
export const PARECIDO = 0.02;   // "Ver parecidos": ±2 %
export const esExacto = (a, b) => Math.abs(Math.round(Number(a) || 0) - Math.round(Number(b) || 0)) <= TOL_EXACTO;
// Confianza de una propuesta de abono: 'seguro' | 'probable' | null (no se muestra)
export function confianzaAbono({ por, exacto, pendientes }) {
  if (SEGUROS.includes(por)) return 'seguro';
  return exacto && pendientes ? 'probable' : null;
}
// Subconjuntos de min..max folios (los más antiguos primero) que suman el monto (±$1). Limitado: a lo más maxFolios folios
// (los más antiguos) y `tope` combinaciones probadas. Devuelve listas de folios, primero las de folios más antiguos (y menos folios).
export function sumasDeFolios(folios, monto, { min = 2, max = 4, tope = 20000, maxFolios = 20, maxRes = 20 } = {}) {
  const l = (folios || []).filter(f => f.saldo > 0).slice(0, maxFolios), out = []; let probadas = 0;
  const rec = (i, el, suma) => {
    if (probadas >= tope || out.length >= maxRes * 4) return;
    if (el.length >= min && esExacto(suma, monto)) out.push({ edad: el.reduce((a, k) => a + k, 0), el: el.slice() });
    if (el.length === max) return;
    for (let k = i; k < l.length; k++) {
      if (suma + l[k].saldo > monto + TOL_EXACTO) continue;
      probadas++; el.push(k); rec(k + 1, el, suma + l[k].saldo); el.pop();
      if (probadas >= tope) return;
    }
  };
  rec(0, [], 0);
  return out.sort((a, b) => a.edad - b.edad || a.el.length - b.el.length).slice(0, maxRes).map(x => x.el.map(k => l[k]));
}
// Reparto de un calce: cada folio con su saldo; si el monto queda $1 bajo el saldo, el último lleva $1 menos
const repartoExacto = (fs, monto) => { const a = fs.map(f => ({ folio: f.folio, monto: f.saldo })), t = a.reduce((x, y) => x + y.monto, 0); if (t > monto && a.length) a[a.length - 1].monto -= t - monto; return a; };
// Calces exactos de un monto con los folios por cobrar de UN cliente (folios del más antiguo al más nuevo; limite = último día de
// pedidos que cuentan). → [{ tipo: folio|folios|orden|total, asignaciones, folios, texto }], el primero es el mejor.
export function calcesExactos(monto, folios, limite = '9999-12-31') {
  const out = [], vistos = new Set(), fs = (folios || []).filter(f => f.saldo > 0);
  const add = (tipo, lista, asignaciones, texto) => { const k = tipo === 'orden' ? 'o' + asignaciones[0].ordenes.join(',') : lista.map(f => f.folio).sort().join(','); if (vistos.has(k)) return; vistos.add(k); out.push({ tipo, folios: lista.map(f => f.folio), asignaciones, texto }); };
  fs.filter(f => esExacto(f.saldo, monto)).forEach(f => add('folio', [f], repartoExacto([f], monto), `el saldo del folio ${f.folio}`));
  sumasDeFolios(fs, monto).forEach(l => add('folios', l, repartoExacto(l, monto), `los folios ${l.map(f => f.folio).join(' + ')}`));
  fs.forEach(f => { const pend = (f.detalle || []).filter(d => !d.pagadaEl); if (pend.length < 2) return;
    pend.filter(d => (!d.fecha || d.fecha <= limite) && esExacto(d.total, monto)).forEach(d => add('orden', [f], [{ folio: f.folio, monto: Math.min(f.saldo, monto), ordenes: [d.n] }], `la orden N° ${d.n} del folio ${f.folio}`)); });
  if (fs.length > 1 && esExacto(fs.reduce((x, f) => x + f.saldo, 0), monto)) add('total', fs, repartoExacto(fs, monto), `todo lo que debe (${fs.length} folios)`);
  return out;
}
// "Ver parecidos": folios, órdenes y totales a ±2 % (no exactos), primero los del cliente de la pista (hintId), después la diferencia
export function parecidosAbono(monto, porCobrar, clientes, hintId, max = 8) {
  const tol = Math.max(TOL_EXACTO + 1, Math.round(monto * PARECIDO)), out = [], nom = id => ((clientes || []).find(c => c.id === id) || {}).nombre || '';
  Object.entries(porCobrar || {}).forEach(([cid, fs]) => {
    const add = (que, m, folio) => { const dif = Math.round(m - monto); if (Math.abs(dif) > TOL_EXACTO && Math.abs(dif) <= tol) out.push({ clienteId: cid, cliente: nom(cid) || (fs[0] && fs[0].cliente) || cid, que, monto: m, dif, folio }); };
    fs.forEach(f => { add(`folio ${f.folio}`, f.saldo, f.folio); (f.detalle || []).filter(d => !d.pagadaEl).forEach(d => { if ((f.detalle || []).length > 1) add(`orden N° ${d.n} del folio ${f.folio}`, d.total, f.folio); }); });
    if (fs.length > 1) add(`todo lo que debe (${fs.length} folios)`, fs.reduce((x, f) => x + f.saldo, 0), '');
  });
  return out.sort((a, b) => ((b.clienteId === hintId) - (a.clienteId === hintId)) || Math.abs(a.dif) - Math.abs(b.dif)).slice(0, max);
}
// ¿La glosa dice algo de quién paga? (para aprender al confirmar un Probable: "TEF DE" o "TRANSFERENCIA DE TERCEROS" no se aprenden)
// v0.114.1 · Una glosa que solo dice el canal ("TRANSFERENCIA DESDE MERCADO PAGO", "TRANSFERENCIA DESDE BANCO DE CHILE", "DEPOSITO"):
// no dice quién pagó. Con ella no se aprende el cliente ni vale lo aprendido o una regla de cliente.
const CANAL = /\b(TEF|TRANSFERENCIA|TRANSF|TRASPASO|DEPOSITO|DEP|ABONO|DE|DEL|DESDE|EN LINEA|INTERNET|OTROS BANCOS|TERCEROS|BANCOESTADO|BANCO|CTA|CTE|RUT|MERCADO ?PAGO|MERCADOPAGO|CHILE|SANTANDER|BCI|SCOTIABANK|ITAU|FALABELLA|RIPLEY|SECURITY|BICE|CONSORCIO|INTERNACIONAL|ESTADO|COOPEUCH|TENPO|MACH|PREX|COPEC|GLOBAL ?66|LOS ANDES)\b/g;
export function glosaDeCanal(desc) { return normCartola(desc).replace(CANAL, ' ').replace(/\d+/g, ' ').replace(/[^A-Z]/g, '').length < 3; }
export function glosaInformativa(desc) {
  const dn = normCartola(desc).replace(PREFIJOS, '').replace(/\b(TERCEROS|OTROS BANCOS|BANCOESTADO|EN LINEA|INTERNET|CTA|CTE|RUT)\b/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return dn.split(' ').filter(w => w.length >= 3).length >= 2 || dn.replace(/ /g, '').length >= 8;
}
// Vencimiento de un folio para ordenar los Probables (fecha + plazo del cliente) y cuán cerca está del pago
const venceFolio = (f, c) => (f.fecha ? masDiasB(f.fecha, plazoCliente(c)) : '');
// Probables de un abono sin cliente seguro: calces exactos de cada cliente (con folios pedidos hasta el día siguiente al pago).
// Primero el cliente de la pista (nombre cortado), después el vencimiento más cercano a la fecha del pago (vencidos antes si empatan).
export function probablesAbono(mv, porCobrar, clientes, reservados, hintId) {
  const limite = mv.fecha ? masDiasB(mv.fecha, 1) : '9999-12-31', out = [];
  Object.entries(porCobrar || {}).forEach(([cid, todos]) => {
    const c = (clientes || []).find(x => x.id === cid); if (!c || c.estado === 'archivado') return;
    const folios = todos.filter(f => !(reservados && reservados.has(f.folio))).filter(f => { const d = (f.detalle || []).filter(x => !x.pagadaEl); return !d.length || d.every(x => !x.fecha || x.fecha <= limite); });
    calcesExactos(mv.monto, folios, limite).forEach((k, i) => {
      const fs = folios.filter(f => k.folios.includes(f.folio)), vence = fs.map(f => venceFolio(f, c)).filter(Boolean).sort()[0] || '';
      const dist = vence && mv.fecha ? Math.abs(diasEntre(vence, mv.fecha)) : 9999;
      out.push({ clienteId: cid, cliente: c.nombre, calce: k, vence, dist, vencido: !!(vence && mv.fecha && vence <= mv.fecha), i });
    });
  });
  return out.sort((a, b) => ((b.clienteId === hintId) - (a.clienteId === hintId)) || a.dist - b.dist || (b.vencido - a.vencido) || a.i - b.i);
}
const TXT_BUSCA_MONTO = 'Busca el monto con "$" en Ventas a empresas (Cobranza u Órdenes), o elige el cliente.';
// mov: movimientos pendientes (en orden); ctx: { clientes, ordenes, abonos, equivalencias, pagados: [{clienteId, total, fechaPago, folio}] }
// v0.65.2: primero los de cliente seguro (reservan sus folios), después los Probables (solo montos exactos)
export function proponer(movs, ctx) {
  const porCobrar = foliosPorCobrar(ctx.ordenes, ctx.abonos, ctx.clientes), reservados = new Set(), out = {}, tefDe = asignarTransferencias(movs, ctx.transferencias);
  const listaN = n => n.length === 1 ? 'la orden N° ' + n[0] : 'las órdenes N° ' + n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1];
  const ident = new Map();
  movs.forEach(mv => {
    // v0.27.0: el RUT de la transferencia (archivo "transferencias recibidas") manda sobre lo aprendido y el nombre
    const tef = tefDe.get(mv) || null;   // v0.63.4: todas a la vez (la más cercana; nunca una en dos abonos)
    const eqRut = tef && (ctx.equivalencias || []).find(e => e.rut && e.rut === tef.rut);
    const porTef = tef && (ctx.clientes.find(c => c.rut && normRut(c.rut) === tef.rut && c.estado !== 'archivado') || (eqRut && ctx.clientes.find(c => c.id === eqRut.clienteId)));
    const forz = ctx.forzados && ctx.forzados[mv.id] && ctx.clientes.find(c => c.id === ctx.forzados[mv.id]);
    // v0.69.0 · Una regla de Abonos que asigna el cliente (contiene, o la glosa exacta de "Solo proponer"): con su nivel
    const rg = ctx.reglasMov && ctx.reglasMov[mv.id], porRegla = rg && ctx.clientes.find(c => c.id === rg.clienteId && c.estado !== 'archivado');
    // v0.114.1 · El RUT (de la transferencia o de la glosa) y el nombre completo mandan sobre las reglas y lo aprendido
    const rutG = !forz && !porTef ? porRutGlosa(mv, ctx.clientes) : null, nomG = !forz && !porTef && !rutG ? porNombreGlosa(mv, ctx.clientes) : null;
    const porReglaOk = porRegla && !glosaDeCanal(mv.descripcion) ? porRegla : null;   // una regla de cliente no vale para una glosa que no dice quién pagó
    ident.set(mv, { tef, id: forz ? { cliente: forz, por: 'manual' } : porTef ? { cliente: porTef, por: 'transferencia' } : rutG || (nomG && nomG.por === 'nombre' ? nomG : null)
      || (porReglaOk ? { cliente: porReglaOk, por: 'regla', regla: rg.id, soloProponer: rg.nivel !== 'listos' } : null) || porAprendido(mv, ctx.clientes, ctx.equivalencias) || nomG });
  });
  const seguroId = mv => { const x = ident.get(mv).id; return !!(x && (SEGUROS.includes(x.por) || x.por === 'regla')); };
  // ¿Ya se registró a mano un pago de ese monto? (v0.28.0: todos los del cliente en los 15 días antes del pago, o hasta 3 después)
  const similaresDe = (mv, cid) => { const cerca = p => p.fechaPago && diasEntre(p.fechaPago, mv.fecha) <= 15 && diasEntre(mv.fecha, p.fechaPago) <= 3;
    return (ctx.pagados || []).filter(p => p.clienteId === cid && Math.abs(Math.round(p.total) - mv.monto) <= 3 && cerca(p)).sort((a, b) => String(b.fechaPago).localeCompare(String(a.fechaPago))); };
  const avisoDe = similares => similares.length ? `Ojo: ${similares.length === 1 ? 'el folio ' + similares[0].folio + ' ya se registró pagado el ' + fechaDMY(similares[0].fechaPago) : 'ya hay ' + similares.length + ' folios pagados con este monto en esos días: ' + similares.map(p => `${p.folio} (${fechaDMY(p.fechaPago)})`).join(', ')}. Si es el mismo pago, marca "Ya lo anoté a mano".` : '';
  movs.filter(seguroId).concat(movs.filter(mv => !seguroId(mv))).forEach(mv => {
    const { tef, id } = ident.get(mv);
    if (!id || !(SEGUROS.includes(id.por) || id.por === 'regla')) {
      // ── Probable: el monto calza exacto con lo que debe un cliente (con pista de nombre cortado, ese cliente primero) ──
      const hintId = id ? id.cliente.id : '', cands = probablesAbono(mv, porCobrar, ctx.clientes, reservados, hintId);
      if (!cands.length) {
        out[mv.id] = { tipo: 'sinCliente', tef, sinExactas: true, pista: id ? { clienteId: id.cliente.id, cliente: id.cliente.nombre } : null, parecidos: parecidosAbono(mv.monto, porCobrar, ctx.clientes, hintId),
          motivo: `Sin coincidencias exactas: ningún folio, suma de folios, orden ni total de un cliente calza con ${milesCL(mv.monto)} (±$1).${id ? ` La glosa se parece a ${id.cliente.nombre}, pero no es seguro.` : ''} ${TXT_BUSCA_MONTO}` };
        return;
      }
      const a = cands[0], c = ctx.clientes.find(x => x.id === a.clienteId), todos = porCobrar[a.clienteId] || [];
      a.calce.folios.forEach(f => reservados.add(f));
      const similares = similaresDe(mv, a.clienteId), yaPagado = similares[0] || null, otros = cands.filter(x => x !== a).slice(0, 5);
      out[mv.id] = { tipo: 'revisar', confianza: 'probable', clienteId: c.id, cliente: c.nombre, por: id ? 'nombre-parcial' : 'monto', folios: todos, posteriores: [], limite: mv.fecha ? masDiasB(mv.fecha, 1) : '', tef,
        asignaciones: a.calce.asignaciones, sobra: Math.max(0, mv.monto - a.calce.asignaciones.reduce((x, y) => x + y.monto, 0)), similares, yaPagado,
        candidatos: otros.map(x => ({ clienteId: x.clienteId, cliente: x.cliente, texto: x.calce.texto, vence: x.vence })),
        motivo: [avisoDe(similares), `Probable: el monto calza exacto con ${a.calce.texto} de ${c.nombre}${a.vence ? ` (${a.vencido ? 'venció' : 'vence'} el ${fechaDMY(a.vence)})` : ''}, pero nada dice que pagó este cliente${id ? ' (la glosa se parece a su nombre)' : ''}. Confírmalo tú.`, otros.length ? `Otras coincidencias exactas: ${otros.map(x => x.cliente + ' (' + x.calce.texto + ')').join(' · ')}.` : ''].filter(Boolean).join(' ') };
      return;
    }
    const c = id.cliente, todos = (porCobrar[c.id] || []).filter(f => !reservados.has(f.folio));
    // v0.28.0 · Solo cuenta lo pedido hasta el día siguiente al pago (el banco puede anotar la transferencia un día después)
    const limite = mv.fecha ? masDiasB(mv.fecha, 1) : '9999-12-31';
    const ordAntes = f => (f.detalle || []).filter(d => !d.pagadaEl && (!d.fecha || d.fecha <= limite));
    const folioAntes = f => { const d = (f.detalle || []).filter(x => !x.pagadaEl); return !d.length || d.every(x => !x.fecha || x.fecha <= limite); };
    const folios = todos.filter(folioAntes), posteriores = todos.filter(f => !folioAntes(f)).map(f => f.folio);
    const base = { clienteId: c.id, cliente: c.nombre, por: id.por, confianza: 'seguro', folios: todos, posteriores, limite, tef, ...(id.regla ? { regla: id.regla, nivelRegla: id.soloProponer ? 'proponer' : 'listos', soloProponer: !!id.soloProponer } : {}) };
    const similares = similaresDe(mv, c.id), yaPagado = similares[0] || null, avisoYa = avisoDe(similares);
    if (!folios.length) { out[mv.id] = { ...base, tipo: 'revisar', sinCalce: true, similares, motivo: avisoYa || (todos.length ? `Sus folios por cobrar son de pedidos posteriores al pago (${fechaDMY(mv.fecha)}). ¿Es un pago ya registrado o un abono adelantado?` : 'No tiene folios por cobrar.'), yaPagado, asignaciones: [], sobra: mv.monto }; return; }
    // 1) un folio completo  2) de 2 a 4 folios completos (v0.65.2: ±$1, los más antiguos primero)  2b) todo lo que debe
    const exactos = folios.filter(f => esExacto(f.saldo, mv.monto));
    let comb = exactos.length ? [] : sumasDeFolios(folios, mv.monto);
    if (!exactos.length && !comb.length && folios.length > 4 && esExacto(folios.reduce((x, f) => x + f.saldo, 0), mv.monto)) comb = [folios];
    let asignaciones = null, motivo = '', unica = false;
    if (exactos.length) { asignaciones = repartoExacto([exactos[0]], mv.monto); unica = exactos.length === 1; motivo = exactos.length > 1 ? `Hay ${exactos.length} folios con ese mismo saldo: se propone el más antiguo.` : 'Calza exacto con un folio.'; }
    else if (comb.length) { asignaciones = repartoExacto(comb[0], mv.monto); unica = comb.length === 1; motivo = comb.length > 1 ? 'Más de una combinación de folios suma ese monto: se propone la de los más antiguos.' : comb[0].length === folios.length && folios.length > 4 ? `Paga todo lo que debe (${folios.length} folios).` : `Paga ${comb[0].length} folios juntos.`; }
    else {
      // 3) folios más antiguos completos + algunas órdenes (anteriores al pago) del siguiente
      let acc = 0; const previos = []; let porOrden = null;
      for (const f of folios) {
        const r = mv.monto - acc; if (r <= 0) break;
        const subs = ordenesQueSuman({ detalle: ordAntes(f) }, r);
        if (subs.length) { porOrden = { previos: previos.slice(), folio: f, ordenes: subs[0], monto: r, varias: subs.length > 1 }; break; }
        acc += f.saldo; previos.push(f);
      }
      // 4) una sola orden (anterior al pago) que calce: la más antigua
      if (!porOrden) {
        const una = [];
        todos.forEach(f => ordAntes(f).forEach(d => { if (esExacto(d.total, mv.monto) && (f.detalle || []).filter(x => !x.pagadaEl).length > 1) una.push({ f, d }); }));
        una.sort((a, b) => String(a.d.fecha).localeCompare(String(b.d.fecha)) || a.d.n - b.d.n);
        if (una.length) porOrden = { previos: [], folio: una[0].f, ordenes: [una[0].d.n], monto: Math.min(una[0].f.saldo, mv.monto), varias: una.length > 1 };
      }
      if (porOrden) {
        asignaciones = porOrden.previos.map(f => ({ folio: f.folio, monto: f.saldo })).concat([{ folio: porOrden.folio.folio, monto: porOrden.monto, ordenes: porOrden.ordenes }]);
        unica = !porOrden.varias;
        motivo = (porOrden.previos.length ? `Paga ${porOrden.previos.length === 1 ? 'el folio ' + porOrden.previos[0].folio : 'los folios ' + porOrden.previos.map(f => f.folio).join(', ')} y ` : 'Paga ') + `${listaN(porOrden.ordenes)} del folio ${porOrden.folio.folio}.` + (porOrden.varias ? ' Hay otra orden o combinación que suma lo mismo: se propone la más antigua.' : '');
      }
    }
    // Se confirma sola solo si no hay ninguna duda: una sola forma de calzar y ningún pago igual ya registrado
    if (asignaciones && unica && !yaPagado && id.soloProponer) motivo = 'Tu regla dice el cliente, pero solo propone: confírmalo tú. ' + motivo;
    if (asignaciones && unica && !yaPagado && !id.soloProponer) {
      asignaciones.forEach(a => reservados.add(a.folio));
      out[mv.id] = { ...base, tipo: 'auto', motivo, asignaciones, sobra: Math.max(0, mv.monto - asignaciones.reduce((x, y) => x + y.monto, 0)) };
      return;
    }
    // 5) paga más que todo lo que debe (pedidos anteriores al pago): todos sus folios y lo que sobra, a favor
    const deuda = folios.reduce((x, f) => x + f.saldo, 0);
    if (!asignaciones && mv.monto > deuda && !similares.length) {   // con un pago igual ya registrado, lo probable es que sea ese
      out[mv.id] = { ...base, tipo: 'revisar', similares, yaPagado, asignaciones: folios.map(f => ({ folio: f.folio, monto: f.saldo })), sobra: mv.monto - deuda,
        motivo: [avisoYa, `Paga ${folios.length === 1 ? 'su folio' : 'sus ' + folios.length + ' folios'} y sobran $${(mv.monto - deuda).toLocaleString('es-CL')}: pagó de más o adelantó un pago.`].filter(Boolean).join(' ') };
      return;
    }
    // v0.28.0: si no calza con nada, no se inventa un reparto: abono a un folio (lo eliges tú) o pago ya registrado
    // v0.65.2: "Sin coincidencias exactas" y, plegado, "Ver parecidos" (±2 %) de este cliente
    if (!asignaciones) {
      out[mv.id] = { ...base, tipo: 'revisar', sinCalce: true, sinExactas: true, similares, yaPagado, asignaciones: [], sobra: mv.monto, parecidos: parecidosAbono(mv.monto, { [c.id]: folios }, ctx.clientes, c.id),
        motivo: avisoYa || `Sin coincidencias exactas. No calza con ningún folio ni orden pedida hasta el ${fechaDMY(limite)}. ¿Es un abono a un folio (tócalo abajo) o un pago que ya estaba registrado? ${TXT_BUSCA_MONTO.replace(', o elige el cliente', '')}` };
      return;
    }
    out[mv.id] = { ...base, tipo: 'revisar', similares, yaPagado, asignaciones, sobra: 0, motivo: [avisoYa, motivo].filter(Boolean).join(' ') };
  });
  return out;
}

// Aplica un abono de la cartola: todo junto o nada (pagos/abonos de cada folio + el movimiento queda conciliado)
// v0.15: con aFavor, lo que sobra del abono queda como saldo a favor del cliente (se usa después en sus folios)
// v0.27.0: rutTef = RUT de quien transfirió (archivo de transferencias): al aprender, también se aprende ese RUT → cliente
export async function aplicarMovimiento(movId, clienteId, asignaciones, aprender, aFavor, rutTef, opc = {}) {
  const db = await dbOk();
  const asig = (asignaciones || []).map(a => ({ folio: String(a.folio), monto: Math.round(Number(a.monto) || 0), ordenes: Array.isArray(a.ordenes) && a.ordenes.length ? a.ordenes.map(Number) : null })).filter(a => a.monto > 0);
  if (!asig.length && !aFavor) throw new Error('Asigna el monto a al menos un folio.');
  if (!clienteId) throw new Error('Elige el cliente.');
  const cliente = (await FB.getDoc(FB.doc(db, 'clientes', clienteId))).data() || {};
  let fin = null;   // v0.67.7: lo que quedó, para la memoria de los repetidos
  await FB.runTransaction(db, async tx => {
    // Las consultas (órdenes y abonos de cada folio) se repiten en cada intento: si otro equipo cambió algo, se ve
    const info = {};
    for (const a of asig) {
      const os = await ordenesDelFolio(db, a.folio);
      if (!os.length) throw new Error(`No hay órdenes con el folio ${a.folio}.`);
      const prev = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', '==', a.folio)));
      uso.lecturas += Math.max(1, prev.size);
      info[a.folio] = { ids: os.map(o => o.id), abonado: prev.docs.map(d => d.data()).filter(x => !x.quitadoEnPlanilla).reduce((s, x) => s + (Number(x.monto) || 0), 0) };
    }
    const mref = FB.doc(db, 'movimientos', movId), ms = await tx.get(mref);
    if (!ms.exists()) throw new Error('Ese movimiento ya no está.');
    const mv = ms.data();
    if (mv.estado !== 'pendiente') throw new Error('Ese movimiento ya se registró.');
    const total = asig.reduce((s, a) => s + a.monto, 0);
    if (aFavor && total >= mv.monto) aFavor = false;
    if (total > mv.monto) throw new Error(`Asignaste ${total.toLocaleString('es-CL')}, más que el abono del banco (${mv.monto.toLocaleString('es-CL')}).`);
    const cref = FB.doc(db, 'config', 'conciliacion'), cs = aprender || opc.regla ? await tx.get(cref) : null;
    const leidas = {};
    for (const a of asig) { leidas[a.folio] = []; for (const id of info[a.folio].ids) { const s = await tx.get(FB.doc(db, 'ordenes', id)); if (s.exists()) leidas[a.folio].push({ id, ...s.data() }); } }
    const hechas = [];
    for (const a of asig) {
      const os = leidas[a.folio].filter(o => o.estado !== 'anulada' && !o.quitadoEnPlanilla);
      if (os.some(o => o.clienteId && o.clienteId !== clienteId)) throw new Error(`El folio ${a.folio} es de otro cliente.`);
      const tot = totalFolio(os).total, saldo = Math.round(tot - info[a.folio].abonado);   // v0.25.0: total de la factura
      if (os.every(o => /PAGADO/.test(o.estadoPago || '')) || saldo <= 0) throw new Error(`El folio ${a.folio} ya está pagado.`);
      if (a.monto > saldo) throw new Error(`Al folio ${a.folio} le quedan ${saldo.toLocaleString('es-CL')}: no se le puede asignar ${a.monto.toLocaleString('es-CL')}.`);
      const completo = a.monto === saldo, tipo = completo && !info[a.folio].abonado ? 'pago' : 'abono';
      // v0.26.0: qué órdenes paga este abono (solo si son del folio y suman exacto el monto)
      let ords = null;
      if (a.ordenes && tipo === 'abono') { const sel = os.filter(o => a.ordenes.includes(Number(o.n))); if (sel.length === a.ordenes.length && Math.round(sel.reduce((x, o) => x + (Number(o.total) || 0), 0)) === a.monto) ords = sel.map(o => Number(o.n)).sort((x, y) => x - y); }
      // Pago del saldo completo de un folio sin abonos: queda PAGADO (igual que antes, sin fila en Abonos). Si no, es un abono.
      const aref = tipo === 'abono' ? FB.doc(FB.collection(db, 'abonos')) : null;
      if (aref) tx.set(aref, { folio: a.folio, fecha: mv.fecha, monto: a.monto, referencia: 'Transferencia · cartola: ' + mv.descripcion + (ords ? ` · ${ords.length === 1 ? 'orden' : 'órdenes'} N° ${ords.join(', ')}` : ''), movimiento: movId, ...(ords ? { ordenes: ords } : {}), extra: {}, quitadoEnPlanilla: false, planillaPendiente: false, por: authSF.currentUser.email, en: FB.serverTimestamp() });
      const tocadas = os.filter(o => !/PAGADO/.test(o.estadoPago || ''));
      tocadas.forEach(o => tx.update(FB.doc(db, 'ordenes', o.id), marcaCambio(completo ? { estadoPago: 'PAGADO', fechaPago: mv.fecha, medioPago: 'Transferencia (cartola)' } : { estadoPago: 'PARCIAL' })));
      hechas.push({ folio: a.folio, monto: a.monto, tipo: completo ? (tipo === 'pago' ? 'pago' : 'abono final') : 'abono', abono: aref ? aref.id : null, ordenes: tocadas.map(o => o.id), ...(ords ? { pagaOrdenes: ords } : {}) });
    }
    // v0.69.0 · Las reglas (si ya se migraron): lo aprendido crea o pone al día la regla exacta de la glosa (y la del RUT de la transferencia),
    // y la regla que propuso suma un uso. Todo en la misma escritura de config/conciliacion.
    const rs = cs && cs.exists() ? reglasNuevas(cs.data(), mv, { aprender: aprender && mv.descNorm ? { tipo: 'cliente', clienteId, nombre: cliente.nombre || '' } : null, rut: normRut(rutTef), regla: opc.regla }) : null;
    if (aprender && mv.descNorm) {
      const r = normRut(rutTef), c = configConciliacion(cs.exists() ? cs.data() : null);
      const eq = c.equivalencias.filter(e => e.desc !== mv.descNorm && !(r && e.rut === r)).concat([{ desc: mv.descNorm, clienteId, nombre: cliente.nombre || '' }], r ? [{ desc: '', rut: r, clienteId, nombre: cliente.nombre || '' }] : []);
      tx.set(cref, { ...(cs.exists() ? cs.data() : {}), ignorar: c.ignorar, equivalencias: eq.slice(-500), ...(rs ? { [RC.CAMPO_B2B]: rs } : {}) });
    } else if (rs) tx.update(cref, { [RC.CAMPO_B2B]: rs });
    const favor = aFavor ? mv.monto - total : 0;
    tx.update(mref, { estado: 'conciliado', clienteId, cliente: cliente.nombre || '', asignaciones: hechas, sobra: mv.monto - total, favorInicial: favor, favorDisponible: favor, favorUsos: [], aprendido: !!aprender, resuelto: { por: authSF.currentUser.email, en: FB.serverTimestamp() }, planillaPendiente: false, ...extraMov(opc) });
    fin = { estado: 'conciliado', clienteId, cliente: cliente.nombre || '', asignaciones: hechas, sobra: mv.monto - total, favorInicial: favor, resuelto: { por: authSF.currentUser.email, en: ahoraSeg() } };
  });
  uso.escrituras += asig.length * 2 + 1;
  if (fin) anotarLocal(movId, fin);
}

// ═══════════════════════════════════════════════
//  v0.15 · Saldo a favor y deshacer (la conciliación como forma principal de registrar pagos)
// ═══════════════════════════════════════════════
const msDe = t => (!t ? 0 : typeof t.toMillis === 'function' ? t.toMillis() : t.__ts || (t.seconds ? t.seconds * 1000 : 0) || (typeof t === 'string' ? Date.parse(t) || 0 : 0));
// Lo que hace falta leer de un folio para poder deshacer (fuera de la transacción: las consultas; dentro: cada documento)
async function leerFolioTx(db, tx, folio) {
  const os = await ordenesDelFolio(db, folio);
  const ab = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', '==', String(folio))));
  uso.lecturas += Math.max(1, ab.size);
  const ordenes = [], abonos = [];
  for (const o of os) { const s = await tx.get(FB.doc(db, 'ordenes', o.id)); if (s.exists()) ordenes.push({ id: o.id, ...s.data() }); }
  for (const d of ab.docs) { const s = await tx.get(FB.doc(db, 'abonos', d.id)); if (s.exists()) abonos.push({ id: d.id, ...s.data() }); }
  return { ordenes: ordenes.filter(o => o.estado !== 'anulada' && !o.quitadoEnPlanilla), abonos: abonos.filter(a => !a.quitadoEnPlanilla) };
}
// Deshace una asignación (pago o abono) en un folio. Solo se puede si después no hubo otro pago en ese folio.
// h: { folio, tipo ('pago' | 'abono' | 'abono final'), abono (id), ordenes (ids) }; fecha: la del pago; desde: cuándo se registró
function planDeshacer(f, h, fecha, desde, movId) {
  // (v0.14 no guardaba el id del abono: se busca por el abono de la cartola y el monto)
  const quitado = h.abono ? f.abonos.find(a => a.id === h.abono) : h.tipo !== 'pago' ? f.abonos.find(a => a.movimiento === movId && Number(a.monto) === Number(h.monto)) : null;
  if (h.tipo !== 'pago' && !quitado) throw new Error(`El abono del folio ${h.folio} ya no está (¿ya se deshizo?).`);
  const resto = f.abonos.filter(a => !quitado || a.id !== quitado.id);
  const ref = quitado ? msDe(quitado.en) : msDe(desde);
  const despues = resto.filter(a => msDe(a.en) > ref).sort((a, b) => msDe(a.en) - msDe(b.en))[0];
  if (despues) throw new Error(`Después hubo otro abono al folio ${h.folio} (${fechaDMY(despues.fecha)}, $${Number(despues.monto).toLocaleString('es-CL')}). Deshaz primero ese.`);
  const pagado = o => /PAGADO/.test(String(o.estadoPago || '').toUpperCase());
  const quedan = resto.reduce((s, a) => s + (Number(a.monto) || 0), 0), nuevo = quedan > 0 ? 'PARCIAL' : 'PENDIENTE';
  let tocar;
  if (h.tipo === 'abono') {
    // v0.25.0: las órdenes cerradas por redondeo vuelven con el abono (no bloquean)
    const pag = f.ordenes.find(o => pagado(o) && o.medioPago !== 'Ajuste de redondeo de la factura');
    if (pag) throw new Error(`El folio ${h.folio} quedó pagado después (${fechaDMY(pag.fechaPago)}). Deshaz primero ese pago.`);
    tocar = f.ordenes;
  } else {
    tocar = f.ordenes.filter(o => (h.ordenes ? h.ordenes.includes(o.id) : pagado(o) && fechaDe(o.fechaPago) === fecha));
    const otra = tocar.find(o => !pagado(o) || fechaDe(o.fechaPago) !== fecha);
    if (otra) throw new Error(`El folio ${h.folio} se cambió después (orden N° ${otra.n}). Revísalo en Por cobrar.`);
    if (!tocar.length) throw new Error(`El folio ${h.folio} ya no está pagado con este abono.`);
  }
  return { quitado, tocar, nuevo };
}
function aplicarPlan(db, tx, plan, motivo) {
  const quien = authSF.currentUser.email;
  if (plan.quitado) tx.update(FB.doc(db, 'abonos', plan.quitado.id), { anulado: { en: ahoraTxt(), por: quien, motivo }, quitadoEnPlanilla: true, planillaPendiente: false });
  plan.tocar.forEach(o => tx.update(FB.doc(db, 'ordenes', o.id), marcaCambio({ estadoPago: plan.nuevo, fechaPago: null, medioPago: null })));
}
// Deshacer un abono de la cartola ya resuelto: vuelve a "por revisar". Si estaba conciliado, sus folios vuelven a
// por cobrar y sus abonos quedan anulados (no se borran). Si se aprendió el cliente, se olvida.
// Deshacer necesita el script v2.8.0 (saca de la planilla el abono anulado y la fila del historial)
export const VERSION_DESHACER = '2.8.0';
async function scriptParaDeshacer() {
  const url = (await Apps.leerConexiones()).b2b;
  if (!url) throw new Error('Falta la dirección del script de B2B (Configuración → Conexiones).');
  const v = await Apps.probar('b2b', url, VERSION_DESHACER);
  if (!v.ok) throw new Error(v.version ? `Para deshacer, el script de B2B debe estar en v${VERSION_DESHACER} (está en v${v.version}; ver README).` : v.texto);
}
export async function deshacerMovimiento(movId, motivo) {
  const db = await dbOk();
  const mref = FB.doc(db, 'movimientos', movId), pre = await FB.getDoc(mref);
  uso.lecturas++;
  if (!pre.exists()) throw new Error('Ese abono ya no está.');
  const m0 = pre.data();
  if (m0.estado === 'pendiente') throw new Error('Ese abono ya está por revisar.');
  if (m0.estado === REPETIDO_B2B) return deshacerRepetidoB2b(db, mref, movId, motivo);   // v0.67.7: no tocó ningún folio ni la planilla
  if (m0.naturaleza === NAT_DEPOSITO) return deshacerDepositoB2b(db, mref, movId, m0, motivo);   // v0.123.0: un depósito de efectivo
  if (m0.naturaleza === NAT_TIENDA) return deshacerTiendaB2b(db, mref, movId, motivo);   // v0.125.1: una venta de la tienda por transferencia
  await scriptParaDeshacer();
  if (m0.estado === 'conciliado' && m0.origen === 'app antigua') throw new Error('Se concilió en la app antigua: si hay un error, corrígelo en Por cobrar.');
  const usosReales = m => (m.favorUsos || []).filter(u => u.tipo !== 'redondeo');   // v0.25.0: el cierre por redondeo no bloquea
  if (usosReales(m0).length) throw new Error(`Primero deshaz el uso del saldo a favor (folio ${usosReales(m0).map(u => u.folio).join(', ')}).`);
  const mot = String(motivo || '').trim().slice(0, 200);
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref), mv = ms.data();
    if (mv.estado === 'pendiente') throw new Error('Ese abono ya está por revisar.');
    if (usosReales(mv).length) throw new Error('Primero deshaz el uso del saldo a favor.');
    const hechas = mv.estado === 'conciliado' ? (mv.asignaciones || []) : [];
    const folios = {};
    for (const h of hechas) folios[h.folio] = folios[h.folio] || await leerFolioTx(db, tx, h.folio);
    const cref = FB.doc(db, 'config', 'conciliacion'), cs = mv.aprendido ? await tx.get(cref) : null;
    const planes = hechas.map(h => planDeshacer(folios[h.folio], h, mv.fecha, mv.resuelto && mv.resuelto.en, movId));
    planes.forEach(p => aplicarPlan(db, tx, p, 'Deshecho en la conciliación' + (mot ? ': ' + mot : '')));
    if (cs && cs.exists() && mv.descNorm) { const c = configConciliacion(cs.data()), ro = olvidarRegla(cs.data(), mv, mot); tx.set(cref, { ...cs.data(), ignorar: c.ignorar, equivalencias: c.equivalencias.filter(e => !(e.desc === mv.descNorm && e.clienteId === mv.clienteId)), ...(ro ? { [RC.CAMPO_B2B]: ro } : {}) }); }
    const antes = { estado: mv.estado, cliente: mv.cliente || '', clienteId: mv.clienteId || null, asignaciones: hechas, favorInicial: mv.favorInicial || 0, nota: mv.nota || null, resuelto: mv.resuelto || null };
    const u = { en: ahoraTxt(), por: authSF.currentUser.email, motivo: mot };
    tx.update(mref, { estado: 'pendiente', deshechos: (mv.deshechos || 0) + 1, ultimoDeshecho: u, deshechosAntes: (mv.deshechosAntes || []).concat([{ ...antes, ...u }]).slice(-10),
      clienteId: null, cliente: '', asignaciones: [], sobra: null, favorInicial: 0, favorDisponible: 0, favorUsos: [], aprendido: false, nota: null, resuelto: null, planillaPendiente: false });
  });
  uso.escrituras += 3;
  anotarLocal(movId, { estado: 'pendiente', clienteId: null, cliente: '', asignaciones: [], nota: null, resuelto: null, deshechos: (m0.deshechos || 0) + 1 });   // v0.67.7
}
// v0.67.7 · Deshacer un repetido: vuelve a pendiente como un abono normal y queda anotado que NO es repetido de ese original
// (no se vuelve a marcar ni a proponer con ese). No tocó folios ni la planilla: no necesita el script. 1 lectura y 1 escritura.
async function deshacerRepetidoB2b(db, mref, movId, motivo) {
  const mot = String(motivo || '').trim().slice(0, 200);
  let no = [];
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref), mv = ms.data();
    if (mv.estado !== REPETIDO_B2B) throw new Error('Ese abono ya no está como repetido.');
    no = [...new Set((mv.noRepetidoDe || []).concat(mv.repetidoDe ? [mv.repetidoDe] : []))].slice(-20);
    const u = { en: ahoraTxt(), por: authSF.currentUser.email, motivo: mot || 'No es repetido' };
    tx.update(mref, { estado: 'pendiente', deshechos: (mv.deshechos || 0) + 1, ultimoDeshecho: u, deshechosAntes: (mv.deshechosAntes || []).concat([{ estado: mv.estado, repetidoDe: mv.repetidoDe || null, resuelto: mv.resuelto || null, ...u }]).slice(-10),
      repetidoDe: null, repetido: null, noRepetidoDe: no, resuelto: null, planillaPendiente: false });
  });
  uso.lecturas++; uso.escrituras++;
  anotarLocal(movId, { estado: 'pendiente', repetidoDe: null, repetido: null, noRepetidoDe: no, resuelto: null });
  return { repetido: true, noRepetidoDe: no };
}
// ═══════════════════════════════════════════════
//  v0.123.0 · Depósitos de efectivo (Efectivo → Salida → Depósito al banco) que llegan como abono en la cartola.
//  El abono queda resuelto "No es de B2B" con naturaleza 'deposito_efectivo' (traspaso de la caja de administración, 1.1.6, al banco, 1.1.3)
//  y el id del movimiento de Efectivo. No toca folios ni la planilla: no necesita el script de B2B. 1 lectura y 1 escritura.
//  El orden entre las dos bases (fen-ventas y fen-b2b) lo lleva vista de la conciliación (terminarDeposito en app.js).
// ═══════════════════════════════════════════════
export const NAT_DEPOSITO = 'deposito_efectivo';
export const esDepositoB2b = m => !!m && m.naturaleza === NAT_DEPOSITO;
export async function leerAbono(movId) {
  const db = await dbOk(), sn = await FB.getDoc(FB.doc(db, 'movimientos', movId)); uso.lecturas++;
  return sn.exists() ? { id: sn.id, ...sn.data() } : null;
}
// dep: { id, dia, monto, banco } (el movimiento de Efectivo) → { repetido? }
export async function marcarDeposito(movId, dep) {
  const db = await dbOk(), mref = FB.doc(db, 'movimientos', movId), por = authSF.currentUser.email;
  const nota = `Depósito de efectivo del ${String(dep.dia || '').split('-').reverse().join('-')} (caja de administración)`;
  let repetido = false;
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref);
    const noEs = t => Object.assign(new Error(t), { code: 'no_es' });   // el abono no puede ser este depósito (Efectivo vuelve a Por unir)
    if (!ms.exists()) throw noEs('Ese abono ya no está.');
    const mv = ms.data();
    if (mv.naturaleza === NAT_DEPOSITO && mv.deposito && mv.deposito.efectivoId === dep.id) { repetido = true; return; }
    if (mv.estado !== 'pendiente') throw noEs('Ese abono ya se resolvió de otra forma. Revíselo en Lo conciliado.');
    if (Math.round(Number(mv.monto) || 0) !== Math.round(Number(dep.monto) || 0)) throw noEs('El monto del abono no es el del depósito.');
    tx.update(mref, { estado: 'ignorado', naturaleza: NAT_DEPOSITO, deposito: { efectivoId: String(dep.id), dia: String(dep.dia || ''), monto: Math.round(Number(dep.monto) || 0), banco: String(dep.banco || '') },
      nota, resuelto: { por, en: FB.serverTimestamp() }, planillaPendiente: false });
  });
  if (!repetido) { uso.lecturas++; uso.escrituras++; anotarLocal(movId, { estado: 'ignorado', naturaleza: NAT_DEPOSITO, nota, resuelto: { por, en: ahoraSeg() } }); }
  return { repetido };
}
// Deshacer: primero el depósito vuelve a "Por unir" en Efectivo (si ya estaba, no hace nada) y después el abono vuelve a pendiente.
// Si la segunda parte falla, Deshacer otra vez la termina (la primera no se repite).
async function deshacerDepositoB2b(db, mref, movId, m0, motivo) {
  const mot = String(motivo || '').trim().slice(0, 200);
  const EFS = await import('./efectivo-fs.js?v=0.138.0');
  if (m0.deposito && m0.deposito.efectivoId) await EFS.desunir(m0.deposito.efectivoId, movId, mot || 'Deshecho en la conciliación');
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref), mv = ms.data();
    if (mv.naturaleza !== NAT_DEPOSITO) throw new Error('Ese abono ya no está como depósito.');
    const u = { en: ahoraTxt(), por: authSF.currentUser.email, motivo: mot || 'No era el depósito' };
    tx.update(mref, { estado: 'pendiente', deshechos: (mv.deshechos || 0) + 1, ultimoDeshecho: u, deshechosAntes: (mv.deshechosAntes || []).concat([{ estado: mv.estado, naturaleza: mv.naturaleza, deposito: mv.deposito || null, resuelto: mv.resuelto || null, ...u }]).slice(-10),
      naturaleza: null, deposito: null, nota: null, resuelto: null, planillaPendiente: false });
  });
  uso.lecturas++; uso.escrituras++;
  anotarLocal(movId, { estado: 'pendiente', naturaleza: null, deposito: null, nota: null, resuelto: null, deshechos: (m0.deshechos || 0) + 1 });
  return { deposito: true };
}
// ═══════════════════════════════════════════════
//  v0.125.1 · Ventas de la tienda cobradas por transferencia que llegan como abono en la cartola. El abono queda resuelto con
//  naturaleza 'venta_tienda' y la foto de su venta de la caja (o sin venta, si no se encontró). No toca folios ni la planilla
//  (no necesita el script de B2B) y no escribe en la caja: 1 lectura y 1 escritura. El cuadre de cada día lo arma transf-tienda.js.
// ═══════════════════════════════════════════════
export const NAT_TIENDA = 'venta_tienda';
export const esTiendaB2b = m => !!m && m.naturaleza === NAT_TIENDA;
// venta: la foto (transf-tienda.js → fotoVenta) o null; nota: opcional
export async function marcarVentaTienda(movId, venta, nota) {
  const db = await dbOk(), mref = FB.doc(db, 'movimientos', movId), por = authSF.currentUser.email;
  const vt = venta && venta.ventaId ? { ventaId: String(venta.ventaId), dia: String(venta.dia || ''), hora: String(venta.hora || ''), sucursal: String(venta.sucursal || ''),
    monto: Math.round(Number(venta.monto) || 0), cajaId: String(venta.cajaId || ''), usuario: String(venta.usuario || ''), nombre: String(venta.nombre || '').slice(0, 60) } : null;
  const n = String(nota || '').trim().slice(0, 200) || null;
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref);
    if (!ms.exists()) throw new Error('Ese abono ya no está.');
    if (ms.data().estado !== 'pendiente') throw new Error('Ese abono ya se resolvió de otra forma. Revíselo en Lo conciliado.');
    tx.update(mref, { estado: 'ignorado', naturaleza: NAT_TIENDA, ventaTienda: vt, nota: n, resuelto: { por, en: FB.serverTimestamp() }, planillaPendiente: false });
  });
  uso.lecturas++; uso.escrituras++;
  anotarLocal(movId, { estado: 'ignorado', naturaleza: NAT_TIENDA, ventaTienda: vt, nota: n, resuelto: { por, en: ahoraSeg() } });
  tiendaMem.l = null;
}
async function deshacerTiendaB2b(db, mref, movId, motivo) {
  const mot = String(motivo || '').trim().slice(0, 200);
  let antes = 0;
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref), mv = ms.data();
    if (mv.naturaleza !== NAT_TIENDA) throw new Error('Ese abono ya no está como venta de la tienda.');
    antes = mv.deshechos || 0;
    const u = { en: ahoraTxt(), por: authSF.currentUser.email, motivo: mot || 'No era venta de la tienda' };
    tx.update(mref, { estado: 'pendiente', deshechos: antes + 1, ultimoDeshecho: u, deshechosAntes: (mv.deshechosAntes || []).concat([{ estado: mv.estado, naturaleza: mv.naturaleza, ventaTienda: mv.ventaTienda || null, nota: mv.nota || null, resuelto: mv.resuelto || null, ...u }]).slice(-10),
      naturaleza: null, ventaTienda: null, nota: null, resuelto: null, planillaPendiente: false });
  });
  uso.lecturas++; uso.escrituras++;
  anotarLocal(movId, { estado: 'pendiente', naturaleza: null, ventaTienda: null, nota: null, resuelto: null, deshechos: antes + 1 });
  tiendaMem.l = null;
  return { tienda: true };
}
// Los abonos marcados "venta de tienda" (todos: una consulta por igualdad, sin índice compuesto), 2 minutos en memoria
const tiendaMem = { l: null, en: 0 };
export async function abonosTienda({ fresco = false } = {}) {
  if (!fresco && tiendaMem.l && Date.now() - tiendaMem.en < 120000) return tiendaMem.l;
  const db = await dbOk(), sn = await FB.getDocs(FB.query(FB.collection(db, 'movimientos'), FB.where('naturaleza', '==', NAT_TIENDA)));
  uso.lecturas += Math.max(1, sn.size);
  tiendaMem.l = sn.docs.map(x => ({ id: x.id, ...x.data() })).filter(m => m.estado === 'ignorado'); tiendaMem.en = Date.now();
  return tiendaMem.l;
}
// Usar el saldo a favor de un abono en un folio del mismo cliente (queda como abono con la fecha del banco)
export async function usarFavor(movId, folio, monto) {
  const db = await dbOk();
  const m = Math.round(Number(monto) || 0);
  if (!(m > 0)) throw new Error('El monto debe ser mayor que cero.');
  let n0 = 0;
  await FB.runTransaction(db, async tx => {
    // Se leen dentro: si otro equipo registró un abono al folio mientras tanto, el reintento lo ve
    const os0 = await ordenesDelFolio(db, folio);
    if (!os0.length) throw new Error(`No hay órdenes con el folio ${folio}.`);
    n0 = os0.length;
    const prev = await FB.getDocs(FB.query(FB.collection(db, 'abonos'), FB.where('folio', '==', String(folio))));
    uso.lecturas += Math.max(1, prev.size);
    const abs = []; for (const x of prev.docs) { const s = await tx.get(FB.doc(db, 'abonos', x.id)); if (s.exists()) abs.push(s.data()); }
    const mref = FB.doc(db, 'movimientos', movId), ms = await tx.get(mref);
    if (!ms.exists()) throw new Error('Ese abono ya no está.');
    const mv = ms.data();
    if (mv.estado !== 'conciliado' || !(mv.favorDisponible > 0)) throw new Error('Ese saldo a favor ya se usó.');
    if (m > mv.favorDisponible) throw new Error(`El saldo a favor es $${mv.favorDisponible.toLocaleString('es-CL')}.`);
    const os = []; for (const o of os0) { const s = await tx.get(FB.doc(db, 'ordenes', o.id)); if (s.exists()) os.push({ id: o.id, ...s.data() }); }
    const vivas = os.filter(o => o.estado !== 'anulada' && !o.quitadoEnPlanilla);
    const nn = t => String(t || '').trim().toLowerCase();
    if (vivas.some(o => (o.clienteId ? o.clienteId !== mv.clienteId : nn(o.cliente) !== nn(mv.cliente)))) throw new Error(`El folio ${folio} es de otro cliente.`);
    const abonado = abs.filter(x => !x.quitadoEnPlanilla).reduce((s, x) => s + (Number(x.monto) || 0), 0);
    const saldo = Math.round(totalFolio(vivas).total - abonado);   // v0.25.0: total de la factura
    if (vivas.every(o => /PAGADO/.test(o.estadoPago || '')) || saldo <= 0) throw new Error(`El folio ${folio} ya está pagado.`);
    if (m > saldo) throw new Error(`Al folio ${folio} le quedan $${saldo.toLocaleString('es-CL')}.`);
    const completo = m === saldo, aref = FB.doc(FB.collection(db, 'abonos'));
    tx.set(aref, { folio: String(folio), fecha: mv.fecha, monto: m, referencia: `Saldo a favor · cartola ${fechaDMY(mv.fecha)}: ${mv.descripcion}`, movimiento: movId, favor: true, extra: {}, quitadoEnPlanilla: false, planillaPendiente: false, por: authSF.currentUser.email, en: FB.serverTimestamp() });
    const tocadas = vivas.filter(o => !/PAGADO/.test(o.estadoPago || ''));
    tocadas.forEach(o => tx.update(FB.doc(db, 'ordenes', o.id), marcaCambio(completo ? { estadoPago: 'PAGADO', fechaPago: mv.fecha, medioPago: 'Transferencia (saldo a favor)' } : { estadoPago: 'PARCIAL' })));
    tx.update(mref, { favorDisponible: mv.favorDisponible - m, favorUsos: (mv.favorUsos || []).concat([{ folio: String(folio), monto: m, tipo: completo ? 'abono final' : 'abono', abono: aref.id, ordenes: tocadas.map(o => o.id), en: ahoraTxt(), por: authSF.currentUser.email }]) });
  });
  uso.escrituras += n0 + 2;
}
// v0.25.0 · Folios en PARCIAL que, contando el total de la factura, ya están pagados (les faltaba $1–$3 por redondeo):
// quedan PAGADO con la fecha del último abono y la nota "Ajuste de redondeo de la factura". No se crea ningún abono.
export async function cerrarPorRedondeo(folio) {
  const db = await dbOk();
  let n = 0;
  await FB.runTransaction(db, async tx => {
    const f = await leerFolioTx(db, tx, folio);
    if (!f.ordenes.length) throw new Error(`No hay órdenes con el folio ${folio}.`);
    const t = totalFolio(f.ordenes), abonado = f.abonos.reduce((x, a) => x + (Number(a.monto) || 0), 0);
    const tocar = f.ordenes.filter(o => !/PAGADO/.test(String(o.estadoPago || '').toUpperCase()));
    if (!tocar.length) throw new Error(`El folio ${folio} ya está pagado.`);
    if (abonado < t.total) throw new Error(`Al folio ${folio} le faltan $${(t.total - abonado).toLocaleString('es-CL')}: no es redondeo.`);
    if (t.suma - abonado > 3) throw new Error(`Al folio ${folio} le faltan $${(t.suma - abonado).toLocaleString('es-CL')} según las órdenes: es más que un redondeo, revísalo.`);
    const fecha = f.abonos.map(a => fechaDe(a.fecha)).filter(Boolean).sort().pop() || hoyTxt();
    tocar.forEach(o => tx.update(FB.doc(db, 'ordenes', o.id), marcaCambio({ estadoPago: 'PAGADO', fechaPago: fecha, medioPago: 'Ajuste de redondeo de la factura' })));
    n = tocar.length;
  });
  uso.escrituras += n; olvidarAgendaB2b();
  return n;
}
// v0.25.0 · Saldo a favor de $1 a $3 que vino del redondeo: se cierra (queda anotado en sus usos; no se borra)
export async function favorRedondeo(movId) {
  const db = await dbOk();
  await FB.runTransaction(db, async tx => {
    const mref = FB.doc(db, 'movimientos', movId), ms = await tx.get(mref);
    if (!ms.exists()) throw new Error('Ese abono ya no está.');
    const mv = ms.data(), m = Number(mv.favorDisponible) || 0;
    if (!(m > 0)) throw new Error('Ese saldo a favor ya se usó.');
    if (m > 3) throw new Error('Solo los saldos a favor de $1 a $3 se cierran como redondeo.');
    tx.update(mref, { favorDisponible: 0, favorUsos: (mv.favorUsos || []).concat([{ tipo: 'redondeo', folio: '', monto: m, en: ahoraTxt(), por: authSF.currentUser.email }]) });
  });
  uso.escrituras++;
}
// Deshacer el uso de un saldo a favor (el último primero): el abono queda anulado y el saldo vuelve
export async function deshacerUsoFavor(movId, abonoId, motivo) {
  const db = await dbOk();
  await scriptParaDeshacer();
  const mref = FB.doc(db, 'movimientos', movId), pre = await FB.getDoc(mref);
  const u0 = pre.exists() && (pre.data().favorUsos || []).find(u => u.abono === abonoId);
  if (!u0) throw new Error('Ese uso del saldo a favor ya no está.');
  const mot = String(motivo || '').trim().slice(0, 200);
  await FB.runTransaction(db, async tx => {
    const ms = await tx.get(mref), mv = ms.data(), u = (mv.favorUsos || []).find(x => x.abono === abonoId);
    if (!u) throw new Error('Ese uso del saldo a favor ya no está.');
    const f = await leerFolioTx(db, tx, u.folio);
    const plan = planDeshacer(f, u, mv.fecha, null, movId);
    aplicarPlan(db, tx, plan, 'Deshecho el uso del saldo a favor' + (mot ? ': ' + mot : ''));
    tx.update(mref, { favorDisponible: Math.min(mv.favorInicial || mv.monto, (mv.favorDisponible || 0) + u.monto), favorUsos: mv.favorUsos.filter(x => x.abono !== abonoId),
      favorUsosDeshechos: (mv.favorUsosDeshechos || []).concat([{ ...u, deshecho: { en: ahoraTxt(), por: authSF.currentUser.email, motivo: mot } }]).slice(-20) });
  });
  uso.escrituras += 3;
}
// Historial: abonos de la cartola ya resueltos, por fecha del banco (los más nuevos primero)
export async function historialConciliacion(dias = 60) {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'movimientos'), FB.where('fecha', '>=', masDias(hoyTxt(), -dias))));
  uso.lecturas += Math.max(1, sn.size);
  anotarLeidosB2b(sn.docs.map(x => ({ id: x.id, ...x.data() })), masDias(hoyTxt(), -dias));   // v0.67.7: también sirve para los repetidos y "Ver el registro"
  return sn.docs.map(x => ({ id: x.id, ...x.data() })).filter(m => m.estado !== 'pendiente')
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.orden || 0) - (a.orden || 0));
}
// Saldos a favor que quedan por usar, por cliente
export function saldosAFavor(favor) {
  const out = {};
  (favor || []).filter(m => m.estado === 'conciliado' && m.favorDisponible > 0 && m.clienteId).forEach(m => { const c = out[m.clienteId] || (out[m.clienteId] = { clienteId: m.clienteId, cliente: m.cliente, total: 0, abonos: [] }); c.total += m.favorDisponible; c.abonos.push(m); });
  Object.values(out).forEach(c => c.abonos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))));
  return out;
}

// ── v0.15 · Ritmo: qué días se concilia y si ya toca ──
export const RITMO_DEF = [1, 4];   // lunes y jueves (0 = domingo)
export const diasRitmo = conf => (conf && conf.ritmo && Array.isArray(conf.ritmo.dias) ? conf.ritmo.dias : RITMO_DEF).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
const masDias = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
// El último día de conciliar (hoy o antes) hay que tener revisado hasta el día anterior
export function tocaConciliar(conf, hoy = hoyTxt()) {
  const dias = diasRitmo(conf);
  if (!dias.length) return null;
  let ultimo = hoy;
  for (let i = 0; i < 7 && !dias.includes(new Date(ultimo + 'T12:00:00').getDay()); i++) ultimo = masDias(ultimo, -1);
  const objetivo = masDias(ultimo, -1);
  // v0.18.0: cada cuenta que se revisa debe estar al día; manda la más atrasada
  const cuentas = cuentasRevisadas(conf, hoy).map(k => ({ cuenta: k, nombre: NOMBRE_CUENTA[k] || k, ...coberturaCartolas(cartolasDe(conf, k)) }));
  const peor = cuentas.slice().sort((a, b) => String(a.hasta || '').localeCompare(String(b.hasta || '')))[0] || { hasta: null, huecos: [] };
  const toca = !peor.hasta || peor.hasta < objetivo;
  return { toca, ultimo, objetivo, hasta: peor.hasta, desde: peor.hasta ? masDias(peor.hasta, 1) : null, ayer: masDias(hoy, -1), huecos: peor.huecos, esHoy: ultimo === hoy,
    cuenta: cuentas.length > 1 ? peor.nombre : null, cuentas: cuentas.map(c => ({ ...c, alDia: !!c.hasta && c.hasta >= objetivo })) };
}
// Cartolas de una cuenta (las anotadas antes de la v0.18.0 y lo traído de la app antigua son de la Chequera)
export const cartolasDe = (conf, cuenta) => ((conf && conf.cartolas) || []).filter(c => (c.cuenta || 'chequera') === cuenta);
// Qué cuentas se revisan: las elegidas en el ritmo o, si no se eligió, las que tienen una cartola de los últimos 60 días (al menos la Chequera)
export function cuentasRevisadas(conf, hoy = hoyTxt()) {
  const elegidas = conf && conf.ritmo && Array.isArray(conf.ritmo.cuentas) ? conf.ritmo.cuentas.filter(k => NOMBRE_CUENTA[k]) : null;
  if (elegidas && elegidas.length) return elegidas;
  const corte = masDias(hoy, -60), usadas = new Set(((conf && conf.cartolas) || []).filter(c => c.tipo !== 'antigua' && String(c.hasta || c.cargada || '').slice(0, 10) >= corte).map(c => c.cuenta || 'chequera'));
  if (!usadas.size) usadas.add('chequera');
  return Object.keys(NOMBRE_CUENTA).filter(k => usadas.has(k));
}
// Hasta qué día están revisadas todas las cuentas que se revisan (la que va más atrás)
export function hastaRevisado(conf, hoy = hoyTxt()) {
  const hs = cuentasRevisadas(conf, hoy).map(k => coberturaCartolas(cartolasDe(conf, k)).hasta);
  return hs.some(h => !h) ? null : hs.sort()[0] || null;
}
// v0.21.0 · Mensaje de la factura: 3 cierres que se turnan por día y datos de transferencia (primera factura de un cliente)
export const CIERRES_DEF = ['Cualquier duda, me avisas. ¡Gracias por preferir Fën!', 'Si algo no calza, me cuentas. ¡Que tengas un lindo día!', 'Quedo atento a cualquier consulta. ¡Gracias por confiar en Fën!'];
let cacheMsj = null;
export async function mensajesFactura(forzar) {
  if (cacheMsj && !forzar) return cacheMsj;
  const db = await dbOk();
  const sn = await FB.getDoc(FB.doc(db, 'config', 'mensajes')); uso.lecturas++;
  const d = sn.exists() ? sn.data() : {}, ci = Array.isArray(d.cierres) ? d.cierres.map(x => String(x || '').trim()).filter(Boolean) : [];
  cacheMsj = { cierres: ci.length ? ci : CIERRES_DEF, transferencia: String(d.transferencia || '') };
  return cacheMsj;
}
export async function guardarMensajes(cierres, transferencia) {
  const db = await dbOk();
  await FB.setDoc(FB.doc(db, 'config', 'mensajes'), { cierres: cierres.map(x => String(x).slice(0, 140)).slice(0, 3), transferencia: String(transferencia || '').slice(0, 400), en: ahoraTxt(), por: authSF.currentUser.email }, { merge: true });
  uso.escrituras++; cacheMsj = null;
}
// Un cierre distinto cada día (se turnan)
export function cierreDelDia(cierres, fecha = hoyTxt()) { const l = (cierres && cierres.length ? cierres : CIERRES_DEF), n = Math.floor(new Date(fecha + 'T12:00:00').getTime() / 864e5); return l[((n % l.length) + l.length) % l.length]; }
// ¿El cliente ya tiene facturas (órdenes con folio) aparte de estas?
export async function tieneFacturasAntes(cliente, excluir = []) {
  const db = await dbOk(), ex = new Set(excluir.map(String));
  const ver = async q => { const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), ...q, FB.where('sinFolio', '==', false), FB.limit(20))); uso.lecturas += Math.max(1, sn.size); return sn.docs.some(dc => { const o = dc.data(); return o.folio && o.estado !== 'anulada' && !ex.has(String(o.n)); }); };
  if (cliente.id && await ver([FB.where('clienteId', '==', cliente.id)])) return true;
  return cliente.nombre ? ver([FB.where('cliente', '==', cliente.nombre)]) : false;
}
// v0.18.0 · La configuración de la conciliación leída una vez (para subir la cartola desde Gastos)
export async function leerConfConciliacion() {
  const db = await dbOk();
  const sn = await FB.getDoc(FB.doc(db, 'config', 'conciliacion')); uso.lecturas++;
  return sn.exists() ? sn.data() : null;
}
export async function guardarCuentasRitmo(cuentas) {
  const db = await dbOk();
  const l = [...new Set(cuentas || [])].filter(k => NOMBRE_CUENTA[k]);
  await FB.setDoc(FB.doc(db, 'config', 'conciliacion'), { ritmo: { cuentas: l, cuentasEn: ahoraTxt(), cuentasPor: authSF.currentUser.email } }, { merge: true });
  uso.escrituras++;
}
export async function guardarRitmo(dias) {
  const db = await dbOk();
  const l = [...new Set((dias || []).map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort();
  await FB.setDoc(FB.doc(db, 'config', 'conciliacion'), { ritmo: { dias: l, en: ahoraTxt(), por: authSF.currentUser.email } }, { merge: true });
  uso.escrituras++;
}
// "Ya lo anoté a mano" (revisado) o "No es de B2B" (ignorado); con patrón, se ignoran siempre los que lo digan
// v0.24.3: "Ya lo anoté a mano" con un cliente elegido a mano: también se aprende quién pagó (para la próxima cartola)
export async function marcarMovimiento(movId, estado, nota, patron, cliente, opc = {}) {
  const db = await dbOk();
  if (!['revisado', 'ignorado'].includes(estado)) throw new Error('Estado no válido.');
  await FB.runTransaction(db, async tx => {
    const mref = FB.doc(db, 'movimientos', movId), ms = await tx.get(mref);
    if (!ms.exists() || ms.data().estado !== 'pendiente') throw new Error('Ese movimiento ya se resolvió.');
    const aprender = estado === 'revisado' && cliente && cliente.id && ms.data().descNorm;
    const cref = FB.doc(db, 'config', 'conciliacion'), cs = patron || aprender || opc.regla ? await tx.get(cref) : null;
    if (patron && normCartola(patron).length < 4) throw new Error('El texto a ignorar es muy corto.');
    // v0.69.0 · Con las reglas migradas: "Ignorar siempre" crea la regla "No es de B2B" (se ignora sola al subir), lo aprendido la regla exacta
    // de la glosa y la regla que propuso suma un uso; todo en la misma escritura de config/conciliacion
    const rs = cs && cs.exists() ? reglasNuevas(cs.data(), ms.data(), { aprender: aprender ? { tipo: 'cliente', clienteId: cliente.id, nombre: cliente.nombre || '' } : null, patron: patron ? normCartola(patron) : '', regla: opc.regla }) : null;
    let cd = cs && cs.exists() ? { ...cs.data() } : {}, escribe = false;
    if (aprender) { const c = configConciliacion(cd), dn = ms.data().descNorm; cd = { ...cd, ignorar: c.ignorar, equivalencias: c.equivalencias.filter(e => e.desc !== dn).concat([{ desc: dn, clienteId: cliente.id, nombre: cliente.nombre || '' }]).slice(-500) }; escribe = true; }
    if (patron) { const c = configConciliacion(cd), p = normCartola(patron); cd = { ...cd, equivalencias: c.equivalencias, ignorar: [...new Set(c.ignorar.concat([p]))] }; escribe = true; }
    if (escribe) tx.set(cref, { ...cd, ...(rs ? { [RC.CAMPO_B2B]: rs } : {}) }); else if (rs) tx.update(cref, { [RC.CAMPO_B2B]: rs });
    tx.update(mref, { estado, nota: String(nota || '').trim().slice(0, 200) || null, ...(cliente && cliente.id && estado === 'revisado' ? { clienteId: cliente.id, cliente: cliente.nombre || '', aprendido: !!aprender } : {}), resuelto: { por: authSF.currentUser.email, en: FB.serverTimestamp() }, planillaPendiente: false, ...extraMov(opc) });   // deshecho antes: su fila del historial se corrige
  });
  anotarLocal(movId, { estado, nota: String(nota || '').trim().slice(0, 200) || null, ...(cliente && cliente.id && estado === 'revisado' ? { clienteId: cliente.id, cliente: cliente.nombre || '' } : {}), resuelto: { por: authSF.currentUser.email, en: ahoraSeg() } });   // v0.67.7
  uso.escrituras += patron || cliente || opc.regla ? 2 : 1;
}

// ═══════════════════════════════════════════════
//  v0.69.0 · Reglas de conciliación de Abonos: en config/conciliacion.reglasConc (las reglas v1.6.0 de fen-b2b ya dejan que
//  administración escriba config/*; no hace falta publicar reglas nuevas). Se leen con la misma escucha de config/conciliacion
//  que ya tiene la conciliación (0 lecturas nuevas); cada cambio es 1 lectura y 1 escritura (una transacción).
// ═══════════════════════════════════════════════
export const reglasB2b = conf => (conf && Array.isArray(conf[RC.CAMPO_B2B]) ? conf[RC.CAMPO_B2B] : []).map(x => RC.vista(x.id, x));
export const migradoB2b = conf => !!(conf && conf[RC.MARCA_B2B]);
// Las equivalencias que lee la propuesta: con las reglas migradas, las de las reglas exactas activas de nivel Listos
export const equivalenciasDe = conf => (migradoB2b(conf) ? RC.legacyAbonos(reglasB2b(conf)) : configConciliacion(conf).equivalencias);
const extraMov = opc => { const p = puntajeMov(opc && opc.puntaje); return { ...(p ? { puntaje: p } : {}), ...(opc && opc.regla ? { reglaConc: String(opc.regla).slice(0, 40) } : {}) }; };
const puntajeMov = x => (x && typeof x === 'object' && isFinite(Number(x.valor)) ? { valor: Math.max(0, Math.min(100, Math.round(Number(x.valor)))), propuesta: String(x.propuesta || '').slice(0, 40), coincide: !!x.coincide, en: ahoraTxt() } : null);
const conLista = (cd, fn) => { const L = reglasB2b(cd), out = fn(L.slice()); return out ? out.slice(-RC.MAX_REGLAS_B2B).map(RC.aDoc) : null; };
const poner = (L, r) => { const i = L.findIndex(x => x.id === r.id); if (i >= 0) L[i] = r; else L.push(r); return L; };
// Dentro de la transacción: lo aprendido, el texto a ignorar y el uso de la regla que propuso → la lista nueva (o null si no cambia)
function reglasNuevas(cd, mv, { aprender, rut, patron, regla } = {}) {
  if (!migradoB2b(cd)) return null;
  const t = ahoraTxt(), por = authSF.currentUser.email;
  let cambia = false;
  const out = conLista(cd, L => {
    const idE = mv.descNorm ? RC.idExacta('abono', 'txt:' + mv.descNorm) : '';
    if (aprender && idE) { poner(L, RC.aprendida(L.find(x => x.id === idE) || null, 'abono', 'txt:' + mv.descNorm, aprender, mv.monto, por, t)); cambia = true;
      if (rut) { const k = 'tef:' + rut, idR = RC.idExacta('abono', k); poner(L, RC.aprendida(L.find(x => x.id === idR) || null, 'abono', k, aprender, mv.monto, por, t)); } }
    if (patron) { const id = RC.idExacta('abono', 'ign:' + patron), a = L.find(x => x.id === id);
      if (!a) { const r = RC.nueva({ lado: 'abono', nivel: 'listos', cond: { tipo: 'contiene', palabras: [patron], no: [], montoMin: null, montoMax: null, cuenta: '', rut: '' }, res: { tipo: 'noB2B', motivo: '', alSubir: true } }, 'manual', por, t, { id }); poner(L, r); }
      else if (a.estado !== 'activa') poner(L, RC.conEstado(a, 'activa', por, t, 'Ignorar siempre al marcar No es de B2B'));
      cambia = true; }
    if (regla && !(aprender && regla === idE)) { const u = L.find(x => x.id === regla); if (u) { poner(L, RC.usada(u, mv.monto, t)); cambia = true; } }
    return L;
  });
  return cambia ? out : null;
}
// Deshacer: la regla exacta de esa glosa (aprendida para ese cliente) pierde un uso; en cero queda archivada
function olvidarRegla(cd, mv, motivo) {
  if (!migradoB2b(cd) || !mv.descNorm) return null;
  const id = RC.idExacta('abono', 'txt:' + mv.descNorm);
  let cambia = false;
  const out = conLista(cd, L => { const a = L.find(x => x.id === id); if (a && a.res.tipo === 'cliente' && a.res.clienteId === mv.clienteId) { const x = RC.olvidada(a, authSF.currentUser.email, ahoraTxt(), motivo); if (x) { poner(L, x); cambia = true; } } return L; });
  return cambia ? out : null;
}
// Una sola vez: lo aprendido (equivalencias) y los textos a ignorar pasan a reglas. No se borra nada de lo de antes.
export async function migrarReglasB2b() {
  const db = await dbOk(), cref = FB.doc(db, 'config', 'conciliacion');
  let n = 0;
  await FB.runTransaction(db, async tx => {
    const cs = await tx.get(cref); if (!cs.exists()) return;
    const cd = cs.data(); if (migradoB2b(cd)) return;
    const t = ahoraTxt(), por = authSF.currentUser.email, ya = reglasB2b(cd), ids = new Set(ya.map(r => r.id));
    const nuevas = RC.migrarAbonos(cd, por, t).filter(r => !ids.has(r.id)); n = nuevas.length;
    tx.update(cref, { [RC.CAMPO_B2B]: ya.concat(nuevas).slice(-RC.MAX_REGLAS_B2B).map(RC.aDoc), [RC.MARCA_B2B]: { v: 1, en: t, por, migradas: nuevas.length, equivalencias: (cd.equivalencias || []).length, ignorar: (cd.ignorar || []).length } });
  });
  uso.lecturas++; uso.escrituras++;
  return n;
}
// Crear, editar, pausar, activar, archivar, aceptar o descartar una sugerencia (como guardarReglaConc de Cargos)
export async function guardarReglaB2b(op) {
  const db = await dbOk(), cref = FB.doc(db, 'config', 'conciliacion'), o = op || {}, t = ahoraTxt(), por = authSF.currentUser.email;
  let res = null;
  await FB.runTransaction(db, async tx => {
    const cs = await tx.get(cref); if (!cs.exists()) throw new Error('Falta la configuración de la conciliación.');
    const cd = cs.data(); if (!migradoB2b(cd)) throw new Error('Las reglas de Abonos todavía no están listas: abre Ventas a empresas → Conciliación y vuelve a intentar.');
    const L = reglasB2b(cd);
    let x = null;
    if (o.que === 'crear' || o.que === 'aceptar' || o.que === 'descartar') {
      const base = o.que === 'descartar' ? { nivel: 'proponer', cond: o.sugerida.cond, res: o.sugerida.res } : o.regla;
      x = RC.nueva({ ...base, lado: 'abono' }, o.que === 'crear' ? 'manual' : 'propuesta', por, t, { firma: o.sugerida ? o.sugerida.firma : '', evidencia: o.sugerida ? o.sugerida.evidencia : null, id: o.sugerida ? 'ra-s' + RC.huella(o.sugerida.firma) : '' });
      if (o.que === 'descartar') x = { ...x, estado: 'descartada', historial: [RC.entrada('descartó la regla sugerida', por, t, { frase: RC.frase(x) })] };
      if (L.some(r => r.id === x.id && r.estado !== 'descartada')) throw new Error('Esa regla ya existe: recarga.');
    } else {
      const a = L.find(r => r.id === o.id); if (!a) throw new Error('Esa regla ya no está. Recarga.');
      x = o.que === 'editar' ? RC.editar(a, o.regla, por, t) : RC.conEstado(a, o.estado, por, t, o.motivo);
    }
    if (!x) return;
    tx.update(cref, { [RC.CAMPO_B2B]: poner(L, x).slice(-RC.MAX_REGLAS_B2B).map(RC.aDoc) });
    res = x;
  });
  uso.lecturas++; if (res) uso.escrituras++;
  return { ok: true, regla: res, sinCambios: !res };
}
// Lo ya resuelto de los últimos 120 días (para las reglas sugeridas): una sola consulta por fecha, guardada en la sesión
let recientes = null;
export function movimientosRecientes(dias = RC.DIAS_SUGERIR) {
  if (recientes && recientes.dias >= dias) return recientes.p;
  const p = (async () => {
    const db = await dbOk(), desde = masDias(hoyTxt(), -dias);
    const sn = await FB.getDocs(FB.query(FB.collection(db, 'movimientos'), FB.where('fecha', '>=', desde)));
    uso.lecturas += Math.max(1, sn.size); recientes.lecturas = Math.max(1, sn.size);
    const l = sn.docs.map(x => ({ id: x.id, ...x.data() }));
    anotarLeidosB2b(l, desde);   // también sirve para los repetidos y "Ver el registro"
    return l;
  })();
  recientes = { dias, p, lecturas: 0 };
  p.catch(() => { recientes = null; });
  return p;
}
export const usoRecientesB2b = () => (recientes ? { dias: recientes.dias, lecturas: recientes.lecturas } : null);
// v0.69.3 · Finanzas → Resumen del mes: los abonos de un mes con lo que ya está en la memoria (0 lecturas).
// pendientes: b2b.datos.movimientos (la escucha). Lo resuelto sale de lo leído por rango en esta sesión (repetidos, Ya conciliados,
// reglas sugeridas o "Contar lo conciliado"). completo: todos los días del mes (hasta hoy) ya se leyeron, así la cuenta es exacta.
// → { pendientes, resueltos, completo, desde (el primer día del mes ya leído, si no está completo) }
export function abonosDelMes(mes, pendientes, hoy = hoyTxt()) {
  const ini = mes + '-01', fin = fechaDe(new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString()), tope = fin < hoy ? fin : hoy;
  const pend = (pendientes || []).filter(m => m && !m.quitadoEnPlanilla && String(fechaDe(m.fecha) || '').slice(0, 7) === mes), vivos = new Set(pend.map(m => m.id));
  const resueltos = [...repMem.docs.values()].filter(m => m && !m.quitadoEnPlanilla && !vivos.has(m.id) && String(fechaDe(m.fecha) || '').slice(0, 7) === mes && (m.estado !== 'pendiente' || m._fuera))
    .map(m => ({ id: m.id, fecha: fechaDe(m.fecha), monto: Math.round(Number(m.monto) || 0), descripcion: m.descripcion || '', estado: m.estado === 'pendiente' ? 'resuelto' : m.estado }));
  let completo = tope >= ini, desde = '';
  for (let f = ini; f <= tope; f = masDiasB(f, 1)) { if (!cubierto(f)) { completo = false; } else if (!desde) desde = f; }
  return { pendientes: pend, resueltos, completo, desde };
}
// "Contar lo conciliado de <mes>": lee por fecha solo los días del mes que faltan (una vez por sesión; queda en la memoria)
export async function leerAbonosDelMes(mes, hoy = hoyTxt()) {
  const ini = mes + '-01', fin = fechaDe(new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString()), tope = fin < hoy ? fin : hoy, faltan = [];
  for (let f = ini; f <= tope; f = masDiasB(f, 1)) if (!cubierto(f)) faltan.push(f);
  if (!faltan.length) return { lecturas: 0, consultas: 0 };
  const db = await dbOk(), tramos = []; let lecturas = 0;
  faltan.forEach(x => { const t = tramos[tramos.length - 1]; if (t && masDiasB(t[1], 1) === x) t[1] = x; else tramos.push([x, x]); });
  // una sola consulta si los huecos están cerca (menos pedidos); como máximo 3
  while (tramos.length > 3) { tramos.splice(0, 2, [tramos[0][0], tramos[1][1]]); }
  for (const [a, b] of tramos) lecturas += (await leerRango(db, a, b)).lecturas;
  return { lecturas, consultas: tramos.length };
}
// Lo conocido de esos días con lo resuelto en esta sesión (repMem guarda lo que se confirmó aquí sin volver a leer)
export const movsResueltosConocidos = () => [...repMem.docs.values()].filter(m => m.estado && m.estado !== 'pendiente');

// ── Una sola vez: traer lo ya conciliado en la app antigua (historial, lo aprendido, lo ignorado y lo pendiente) ──
export const VERSION_CONCILIACION = '2.6.0';   // script que entrega las hojas de conciliación (SistemaFen.gs v1.4.0)
export async function importarConciliacionAntigua() {
  const db = await dbOk();
  const url = (await Apps.leerConexiones()).b2b;
  if (!url) throw new Error('Falta la dirección del script de B2B (Configuración → Conexiones).');
  const v = await Apps.probar('b2b', url, VERSION_CONCILIACION);
  if (!v.ok) throw new Error(v.version ? `El script de B2B está en v${v.version}: necesita v${VERSION_CONCILIACION} (ver README).` : v.texto);
  const r = await llamarScript(url, { action: 'sistema_fen_b2b', accion: 'sistema_fen_b2b', op: 'conciliacion', idToken: await authSF.currentUser.getIdToken() });
  if (!r || !r.ok) throw new Error((r && (r.error || r.msg)) || 'El script no respondió bien.');
  const H = r.hojas || {}, filasDe = (h, ...cols) => { const t = H[h]; if (!t) return []; const ix = cols.map(c => t.c.findIndex(x => normCartola(x) === normCartola(c))); return t.f.map(f => ix.map(i => (i < 0 ? '' : f[i + 1]))); };
  const clientes = (await FB.getDocs(FB.collection(db, 'clientes'))).docs.map(d => ({ id: d.id, ...d.data() }));
  const cliPorNombre = n => clientes.find(c => normCartola(c.nombre) === normCartola(n));
  const snExist = await FB.getDocs(FB.collection(db, 'movimientos'));
  const existentes = new Set(snExist.docs.map(d => d.id)), pendientesYa = new Set(snExist.docs.filter(d => d.data().estado === 'pendiente').map(d => d.id));
  uso.lecturas += clientes.length + existentes.size + 2;
  const docs = [];
  const parteHuella = h => { const p = String(h).split('|'); return { fecha: p[0] || '', saldo: Number(p[1]) || 0, monto: Number(p[2]) || 0, descNorm: p.slice(3).join('|') }; };
  for (const [huella, fecha, descripcion, monto, cliente, folios] of filasDe('ConciliacionBancaria_Historial', 'Fingerprint', 'Fecha', 'Descripcion', 'Monto', 'Cliente', 'Folios')) {
    if (!huella) continue;
    const ph = parteHuella(huella), c = cliPorNombre(cliente);
    docs.push([await idMovimiento(String(huella)), { huella: String(huella), fecha: fechaDe(fecha) || ph.fecha, descripcion: String(descripcion || ph.descNorm), descNorm: ph.descNorm, monto: Number(monto) || ph.monto, saldo: ph.saldo,
      cartola: 'App antigua', estado: /revisado/i.test(String(folios)) ? 'revisado' : 'conciliado', cliente: String(cliente || ''), clienteId: c ? c.id : null, folios: String(folios || ''), origen: 'app antigua', planillaPendiente: false }]);
  }
  for (const [huella, , fecha, descripcion, monto, , , , , ident] of filasDe('ConciliacionBancaria_Pendientes', 'Huella', 'Tipo', 'Fecha', 'Descripcion', 'Monto', 'Cliente', 'Asignaciones', 'FoliosPendientes', 'FolioYaPagado', 'Identificador')) {
    if (!huella) continue;
    const ph = parteHuella(huella);
    docs.push([await idMovimiento(String(huella)), { huella: String(huella), fecha: fechaDe(fecha) || ph.fecha, descripcion: String(descripcion || ph.descNorm), descNorm: ph.descNorm, monto: Number(monto) || ph.monto, saldo: ph.saldo,
      cartola: String(ident || 'App antigua'), estado: 'pendiente', origen: 'app antigua', planillaPendiente: false }]);
  }
  const vistos = new Set(), nuevos = docs.filter(([id]) => !existentes.has(id) && !vistos.has(id) && vistos.add(id));
  // Lo que aquí seguía pendiente pero en la app antigua ya se concilió (por ejemplo, después de volver a ella un tiempo)
  const aCerrar = docs.filter(([id, d]) => pendientesYa.has(id) && d.estado !== 'pendiente');
  for (const [id, d] of aCerrar) { await FB.updateDoc(FB.doc(db, 'movimientos', id), { estado: d.estado, cliente: d.cliente, clienteId: d.clienteId, folios: d.folios, origen: 'app antigua', planillaPendiente: false }); uso.escrituras++; }
  for (let i = 0; i < nuevos.length; i += 400) { const b = FB.writeBatch(db); nuevos.slice(i, i + 400).forEach(([id, d]) => b.set(FB.doc(db, 'movimientos', id), d)); await b.commit(); uso.escrituras += Math.min(400, nuevos.length - i); }
  const equivalencias = filasDe('Equivalencias_Cartola', 'Descripcion_Normalizada', 'Cliente').map(([desc, n]) => { const c = cliPorNombre(n); return c && desc ? { desc: normCartola(desc), clienteId: c.id, nombre: c.nombre } : null; }).filter(Boolean);
  const ignorar = [...new Set(['TRANSBANK'].concat(filasDe('ConciliacionIgnorados', 'Patron').map(([p]) => normCartola(p)).filter(p => p.length >= 4)))];
  const cref = FB.doc(db, 'config', 'conciliacion'), cs = await FB.getDoc(cref), c = configConciliacion(cs.exists() ? cs.data() : null);
  const eqFinal = c.equivalencias.concat(equivalencias.filter(e => !c.equivalencias.some(x => x.desc === e.desc)));
  await FB.setDoc(cref, { ignorar: [...new Set(c.ignorar.concat(ignorar))], equivalencias: eqFinal.slice(-500), importado: { en: FB.serverTimestamp(), por: authSF.currentUser.email, historial: docs.length, nuevos: nuevos.length } });
  uso.escrituras++;
  try { await anotarPeriodoAntiguo(); } catch (e) {}
  return { cerrados: aCerrar.length, historial: docs.filter(([, d]) => d.estado !== 'pendiente').length, pendientes: docs.filter(([, d]) => d.estado === 'pendiente').length, nuevos: nuevos.length, equivalencias: equivalencias.length, ignorar: ignorar.length };
}
// Empezar sin traer nada (por ejemplo, si nunca se usó la conciliación en la app antigua)
export async function empezarConciliacionSinHistorial() {
  const db = await dbOk();
  await FB.setDoc(FB.doc(db, 'config', 'conciliacion'), { ...CONC_DEF, importado: { en: FB.serverTimestamp(), por: authSF.currentUser.email, historial: 0, nuevos: 0, sinHistorial: true } }, { merge: true });
}
// Pagos ya registrados (para avisar "ya estaba registrado"): de las órdenes de 6 meses
export function pagadosPorFolio(ordenes, clientes) {
  const norm = t => String(t || '').trim().toLowerCase(), porNombre = {}; clientes.forEach(c => { porNombre[norm(c.nombre)] = c.id; });
  const F = {}, vistos = new Set();
  ordenes.forEach(o => { if (vistos.has(String(o.n))) return; vistos.add(String(o.n)); if (!o.folio || !/PAGADO/.test(String(o.estadoPago || '').toUpperCase())) return; const k = String(o.folio), f = F[k] || (F[k] = { folio: k, total: 0, fechaPago: fechaDe(o.fechaPago), clienteId: o.clienteId || porNombre[norm(o.cliente)] || null }); f.total += Number(o.total) || 0; });
  return Object.values(F);
}
// Para Hoy: abonos de la cartola que faltan por revisar
export async function movimientosParaHoy() {
  let cx;
  try { cx = await conexion(); } catch (e) { return null; }
  if (cx.estado !== 'ok') return null;
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'movimientos'), FB.where('estado', '==', 'pendiente')));
  uso.lecturas += Math.max(1, sn.size);
  const l = sn.docs.map(d => d.data());
  let ritmo = null;
  try { const c = await FB.getDoc(FB.doc(cx.db, 'config', 'conciliacion')); uso.lecturas++; if (c.exists() && c.data().importado) ritmo = tocaConciliar(c.data()); } catch (e) {}
  return { n: l.length, monto: l.reduce((s, m) => s + (Number(m.monto) || 0), 0), desde: l.map(m => m.fecha).sort()[0] || null, ritmo };
}

// ═══════════════════════════════════════════════
//  v0.14.1 · Análisis de B2B (resumen del período, caja real y productos)
// ═══════════════════════════════════════════════
const cacheRangos = new Map();   // las mismas fechas no se vuelven a leer en 5 minutos
async function consultaCacheada(clave, fn) {
  const c = cacheRangos.get(clave);
  if (c && Date.now() - c.en < 5 * 60e3) return c.v;
  const v = await fn(); cacheRangos.set(clave, { en: Date.now(), v }); return v;
}
export function olvidarAnalisisB2b() { cacheRangos.clear(); }
const limpias = sn => sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => !o.quitadoEnPlanilla && o.estado !== 'anulada');
// Órdenes vendidas entre dos fechas (por fecha de la orden)
export async function ordenesEntre(desde, hasta) {
  return consultaCacheada('v|' + desde + '|' + hasta, async () => {
    const db = await dbOk();
    const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('fecha', '>=', desde), FB.where('fecha', '<=', hasta)));
    uso.lecturas += Math.max(1, sn.size);
    return limpias(sn);
  });
}
// Órdenes pagadas entre dos fechas (por fecha de pago)
export async function pagadasEntre(desde, hasta) {
  return consultaCacheada('p|' + desde + '|' + hasta, async () => {
    const db = await dbOk();
    const sn = await FB.getDocs(FB.query(FB.collection(db, 'ordenes'), FB.where('fechaPago', '>=', desde), FB.where('fechaPago', '<=', hasta + '')));
    uso.lecturas += Math.max(1, sn.size);
    return limpias(sn);
  });
}
// Períodos: devuelve { desde, hasta, antes: { desde, hasta }, nombre }
export function periodoAnalisis(tipo, desdeP, hastaP, hoy = hoyTxt()) {
  const D = s => new Date(s + 'T12:00:00'), T = d => hoyTxt(d), mas = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return T(d); };
  const lunes = s => { const d = D(s), w = d.getDay(); d.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return T(d); };
  const ini = s => s.slice(0, 8) + '01', fin = s => { const d = D(ini(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return T(d); };
  const mesAntes = s => { const d = D(ini(s)); d.setMonth(d.getMonth() - 1); return T(d); };
  const dias = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
  let desde, hasta, antes;
  if (tipo === 'hoy') { desde = hasta = hoy; antes = { desde: mas(hoy, -1), hasta: mas(hoy, -1) }; }
  else if (tipo === 'ayer') { desde = hasta = mas(hoy, -1); antes = { desde: mas(hoy, -2), hasta: mas(hoy, -2) }; }
  else if (tipo === 'semana') { desde = lunes(hoy); hasta = hoy; antes = { desde: mas(desde, -7), hasta: mas(hasta, -7) }; }
  else if (tipo === 'semanaAnterior') { desde = mas(lunes(hoy), -7); hasta = mas(desde, 6); antes = { desde: mas(desde, -7), hasta: mas(hasta, -7) }; }
  else if (tipo === 'mes') { desde = ini(hoy); hasta = hoy; const a = mesAntes(hoy), n = Math.min(Number(hoy.slice(8)), Number(fin(a).slice(8))); antes = { desde: a, hasta: a.slice(0, 8) + String(n).padStart(2, '0') }; }
  else if (tipo === 'mesAnterior') { desde = mesAntes(hoy); hasta = fin(desde); const a = mesAntes(desde); antes = { desde: a, hasta: fin(a) }; }
  else { desde = desdeP || hoy; hasta = hastaP || hoy; if (hasta < desde) [desde, hasta] = [hasta, desde]; const n = dias(desde, hasta); antes = { desde: mas(desde, -n), hasta: mas(desde, -1) }; }
  return { desde, hasta, antes, dias: dias(desde, hasta) };
}
const pct = (a, b) => (b > 0 ? (a - b) / b : null);
const DIAS_SEM = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Lo que se compró: por producto (unidades y neto), por día de la semana y precio real
function porProducto(ordenes) {
  const P = {};
  ordenes.forEach(o => (o.lineas || []).forEach(l => {
    const k = String(l.producto || '').trim(); if (!k) return;
    const p = P[k] || (P[k] = { producto: k, productoId: l.productoId || null, unidades: 0, neto: 0, dias: [0, 0, 0, 0, 0, 0, 0], clientes: new Set() });
    const u = Number(l.cantidad) || 0, n = Number(l.neto) || Math.round(u * (Number(l.precio) || 0));
    p.unidades += u; p.neto += n; if (!p.productoId && l.productoId) p.productoId = l.productoId;
    const f = fechaDe(o.fecha); if (f) { const w = new Date(f + 'T12:00:00').getDay(); p.dias[w === 0 ? 6 : w - 1] += u; }
    p.clientes.add(o.clienteId || o.cliente);
  }));
  return P;
}
// ordenes / ordenesAntes: del período y del anterior; pagadas: con fecha de pago en el período; abonos: todos
export function analizarB2b(per, ordenes, ordenesAntes, pagadas, abonos, productos, clienteId, otras = []) {
  const delCli = o => !clienteId || o.clienteId === clienteId;
  const os = ordenes.filter(delCli), osA = ordenesAntes.filter(delCli);
  const neto = l => l.reduce((s, o) => s + (Number(o.neto) || 0), 0), total = l => l.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const ec = estadoDeCuenta(os, abonos, '', '', 'orden');
  const resumen = { n: os.length, neto: neto(os), iva: total(os) - neto(os), total: total(os), ticket: os.length ? Math.round(neto(os) / os.length) : 0,
    facturado: total(os.filter(o => o.folio)), pendiente: ec.pendiente, cobrado: ec.pagado,
    antes: { n: osA.length, neto: neto(osA), ticket: osA.length ? Math.round(neto(osA) / osA.length) : 0 },
    var: { neto: pct(neto(os), neto(osA)), n: pct(os.length, osA.length) } };
  // Caja real: lo que entró en el período. Un folio con abonos se cuenta por sus abonos (cada uno en su fecha); si no, por su fecha de pago.
  const foliosConAbono = new Set(abonos.map(a => String(a.folio)));
  const cliDeFolio = {}; otras.concat(ordenesAntes, ordenes, pagadas).forEach(o => { if (o.folio) cliDeFolio[String(o.folio)] = o.clienteId || o.cliente; });
  const pag = pagadas.filter(o => delCli(o) && !(o.folio && foliosConAbono.has(String(o.folio))) && (fechaDe(o.fechaPago) || '') >= per.desde && (fechaDe(o.fechaPago) || '') <= per.hasta);
  const delPeriodo = pag.filter(o => (o.fecha || '') >= per.desde), anteriores = pag.filter(o => (o.fecha || '') < per.desde);
  const abs = abonos.filter(a => { const f = fechaDe(a.fecha) || ''; return f >= per.desde && f <= per.hasta && (!clienteId || cliDeFolio[String(a.folio)] === clienteId); });
  const origen = {}; anteriores.forEach(o => { const m = String(o.fecha || '').slice(0, 7); (origen[m] = origen[m] || { mes: m, total: 0, n: 0 }); origen[m].total += Number(o.total) || 0; origen[m].n++; });
  const caja = { delPeriodo: total(delPeriodo), anteriores: total(anteriores), abonos: abs.reduce((s, a) => s + (Number(a.monto) || 0), 0), detalleAbonos: abs.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    origen: Object.values(origen).sort((a, b) => b.mes.localeCompare(a.mes)), nPagos: pag.length };
  caja.total = caja.delPeriodo + caja.anteriores + caja.abonos;
  // Productos
  const P = porProducto(os), PA = porProducto(osA), netoT = Object.values(P).reduce((s, p) => s + p.neto, 0);
  const nDia = [0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < per.dias; i++) { const d = new Date(per.desde + 'T12:00:00'); d.setDate(d.getDate() + i); const w = d.getDay(); nDia[w === 0 ? 6 : w - 1]++; }
  const base = p => { const x = (productos || []).find(y => (p.productoId && y.id === p.productoId) || String(y.nombre).trim().toLowerCase() === p.producto.toLowerCase()); return x ? Number(x.precioBase) || 0 : 0; };
  const ranking = Object.values(P).map(p => { const a = PA[p.producto], real = p.unidades ? Math.round(p.neto / p.unidades) : 0, b = base(p);
    return { producto: p.producto, unidades: p.unidades, neto: p.neto, parte: netoT ? p.neto / netoT : 0, varNeto: a ? pct(p.neto, a.neto) : null, nuevo: !a, clientes: p.clientes.size,
      porDia: p.dias.map((u, i) => (nDia[i] ? u / nDia[i] : null)), precioReal: real, precioBase: b, descuento: b && real ? 1 - real / b : null }; })
    .sort((a, b) => b.neto - a.neto);
  const dejados = clienteId ? Object.values(PA).filter(p => !P[p.producto]).map(p => ({ producto: p.producto, unidadesAntes: p.unidades, netoAntes: p.neto })).sort((a, b) => b.netoAntes - a.netoAntes) : [];
  return { resumen, caja, ranking, dejados, diasSemana: DIAS_SEM, nDia };
}
// v0.14.1 · Planilla: hojas para Producción y filas repetidas (script de B2B v2.7.0)
export const VERSION_PLANILLA = '2.7.0';
export async function opPlanilla(op, extra) {
  const url = (await Apps.leerConexiones()).b2b;
  if (!url) throw new Error('Falta la dirección del script de B2B (Configuración → Conexiones).');
  const v = await Apps.probar('b2b', url, VERSION_PLANILLA);
  if (!v.ok) throw new Error(v.version ? `El script de B2B está en v${v.version}: necesita v${VERSION_PLANILLA} (ver README).` : v.texto);
  const r = await llamarScript(url, { action: 'sistema_fen_b2b', accion: 'sistema_fen_b2b', op, ...(extra || {}), idToken: await authSF.currentUser.getIdToken() });
  if (!r || !r.ok) throw new Error((r && (r.error || r.msg)) || 'El script no respondió bien.');
  return r;
}

// v0.14.5 · Registro de cartolas cargadas (en config/conciliacion.cartolas)
async function anotarCartola(c) {
  const db = await dbOk(), ref = FB.doc(db, 'config', 'conciliacion');
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), d = sn.exists() ? sn.data() : {};
    const lista = (d.cartolas || []).filter(x => !(x.id === c.id && x.tipo === c.tipo));
    lista.push({ ...c, cargada: ahoraTxt(), por: authSF.currentUser.email });
    tx.set(ref, { ...d, ignorar: configConciliacion(d).ignorar, equivalencias: configConciliacion(d).equivalencias, cartolas: lista.slice(-300) });
  });
  uso.escrituras++;
}
// Lo ya traído de la app antigua: su período (de la primera a la última fecha), una sola vez
export async function anotarPeriodoAntiguo() {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'movimientos'), FB.where('origen', '==', 'app antigua')));
  uso.lecturas += Math.max(1, sn.size);
  const fs = sn.docs.map(d => fechaDe(d.data().fecha)).filter(Boolean).sort();
  await anotarCartola({ id: 'App antigua', tipo: 'antigua', nCartola: null, desde: fs[0] || null, hasta: fs[fs.length - 1] || null, abonos: sn.size, nuevos: 0, yaVistos: 0, ignorados: 0 });
}
// Períodos revisados y huecos (días sin ninguna cartola entre la primera y la última)
export function coberturaCartolas(cartolas) {
  const r = (cartolas || []).filter(c => c.desde && c.hasta).map(c => [c.desde, c.hasta]).sort((a, b) => a[0].localeCompare(b[0]));
  if (!r.length) return { hasta: null, huecos: [] };
  const mas = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return hoyTxt(d); };
  const unidos = [];
  r.forEach(([a, b]) => { const u = unidos[unidos.length - 1]; if (u && a <= mas(u[1], 1)) { if (b > u[1]) u[1] = b; } else unidos.push([a, b]); });
  const huecos = unidos.slice(1).map((u, i) => [mas(unidos[i][1], 1), mas(u[0], -1)]);
  return { desde: unidos[0][0], hasta: unidos[unidos.length - 1][1], huecos };
}

// ═══════════════════════════════════════════════
//  v0.24.0 · Cobranza
//  Cada folio vence en su fecha de factura (diaria, semanal y mensual) o 30 días después ("30 días").
//  Pasa a cobranza al 4.º día después del vencimiento (3 días de gracia); los de 30 días, al día siguiente (sin gracia).
//  Lo que se hace con cada cliente queda en cobranza/{clienteId}: compromisos de pago, "dice que ya pagó" y las gestiones.
// ═══════════════════════════════════════════════
export const GRACIA_COBRANZA = 3;
export const plazoCliente = c => ACORDADO[String((c && c.frecuenciaPago) || '').trim().toLowerCase()] || 0;
const MESES_C = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const fechaCobranza = (f, conAnio) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${Number(m[3])} de ${MESES_C[Number(m[2]) - 1]}${conAnio ? ' de ' + m[1] : ''}` : String(f || ''); };
// porCliente: lo de foliosPorCobrar; docs: { clienteId: doc de cobranza }; conf: config/conciliacion
// → { cobrar: [grupo], esperando: [grupo], alDia: [grupo], revisado }
export function armarCobranza(porCliente, clientes, docs, conf, hoy = hoyTxt()) {
  const revisado = conf && conf.importado ? hastaRevisado(conf, hoy) : null;
  const out = { cobrar: [], esperando: [], alDia: [], revisado };
  Object.entries(porCliente || {}).forEach(([cid, fs]) => {
    const c = (clientes || []).find(x => x.id === cid) || { id: cid, nombre: (fs[0] && fs[0].cliente) || cid };
    // v0.28.4: facturación diaria y semanal → 1 día de gracia (al 2.º día después de la factura ya está en cobranza);
    // mensual → 3 días; los que pagan a 30 días → sin gracia. Sin facturación anotada, como diaria.
    const fac = String(c.facturacion || 'Diaria').trim();
    const plazo = plazoCliente(c), gracia = plazo ? 0 : /^mensu/i.test(fac) ? GRACIA_COBRANZA : 1;
    const folios = fs.map(f => {
      const vence = f.fecha ? masDiasB(f.fecha, plazo) : '', desde = vence ? masDiasB(vence, gracia + 1) : '';
      return { ...f, vence, cobrarDesde: desde, atraso: vence ? Math.max(0, diasEntre(vence, hoy)) : 0, enCobranza: !desde || hoy >= desde };
    });
    const venc = folios.filter(f => f.enCobranza), resto = folios.filter(f => !f.enCobranza);
    const doc = (docs && docs[cid]) || {}, gestiones = Array.isArray(doc.gestiones) ? doc.gestiones : [];
    const g = { cliente: c, plazo, gracia, folios: venc, alDia: resto, saldo: venc.reduce((s, f) => s + f.saldo, 0), saldoTotal: folios.reduce((s, f) => s + f.saldo, 0),
      atraso: venc.reduce((m, f) => Math.max(m, f.atraso), 0), gestiones, ultima: gestiones[gestiones.length - 1] || null, recordatorios: 0, notas: [], estado: 'cobrar' };
    if (!venc.length) { out.alDia.push({ ...g, proximo: resto.map(f => f.cobrarDesde).sort()[0] }); return; }
    // Lo anotado cuenta solo si se anotó después de la factura más antigua en cobranza (lo viejo no se arrastra)
    const desdeF = venc.map(f => f.fecha).filter(Boolean).sort()[0] || '';
    const vale = x => x && x.fecha && String(x.registrado || '') >= desdeF;
    g.recordatorios = gestiones.filter(x => x.tipo === 'recordatorio' && String(x.fecha || '') >= desdeF).length;
    const dice = vale(doc.diceQuePago) ? doc.diceQuePago : null, comp = vale(doc.compromiso) ? doc.compromiso : null;
    if (dice) {
      g.dice = dice;
      if (!revisado || revisado < dice.fecha) { g.estado = 'pagoInformado'; out.esperando.push(g); return; }
      g.notas.push(`Dijo que pagó el ${fechaCobranza(dice.fecha)}; la cartola revisada hasta el ${fechaCobranza(revisado)} no muestra ese pago.`);
    }
    if (comp) {
      g.compromiso = comp;
      if (hoy < comp.fecha) { g.estado = 'compromiso'; out.esperando.push(g); return; }
      g.notas.push(hoy === comp.fecha ? `Hoy es el día que se comprometió a pagar.` : `Se comprometió a pagar el ${fechaCobranza(comp.fecha)}.`);
    }
    out.cobrar.push(g);
  });
  out.cobrar.sort((a, b) => b.atraso - a.atraso || b.saldo - a.saldo);
  out.esperando.sort((a, b) => String((a.compromiso || a.dice || {}).fecha).localeCompare(String((b.compromiso || b.dice || {}).fecha)));
  out.alDia.sort((a, b) => String(a.proximo).localeCompare(String(b.proximo)));
  return out;
}
// Mensaje de cobranza. tono 1: amable; tono 2: más firme (y con los datos para transferir, si están guardados)
// v0.28.2: tono 1 sin días; tono 2 con los días de atraso en negrita (*así* en WhatsApp);
// opciones.vigentes: agrega en un párrafo aparte lo que aún está en plazo, con su propio total
export function mensajeCobranza(g, tono, revisado, transferencia, opciones = {}) {
  const nombre = String((g.cliente && g.cliente.contacto) || '').trim().split(/\s+/)[0] || '';
  const hola = nombre ? `Hola ${nombre.charAt(0).toUpperCase() + nombre.slice(1)},` : 'Hola,';
  const pesosC = n => '$' + Math.round(n).toLocaleString('es-CL');
  const faltan = f => { const d = f.detalle || []; if (!d.some(x => x.pagadaEl)) return ''; const l = d.filter(x => !x.pagadaEl).map(x => x.n); return l.length ? ` (${l.length === 1 ? 'orden' : 'órdenes'} N° ${l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + ' y ' + l[l.length - 1]})` : ''; };
  const firme = Number(tono) === 2;
  const atraso = f => firme && f.atraso > 0 ? ` · *${f.atraso} ${f.atraso === 1 ? 'día' : 'días'} de atraso*` : '';
  const lineas = g.folios.map(f => `• Folio N° ${f.folio}${f.fecha ? ' del ' + fechaCobranza(f.fecha) : ''}: ${pesosC(f.saldo)}${f.abonado ? ' (saldo)' : ''}${faltan(f)}${atraso(f)}`).join('\n');
  const total = g.folios.length > 1 ? `\nTotal: ${pesosC(g.saldo)}` : '';
  const al = opciones.vigentes ? (g.alDia || []) : [];
  const vigentes = al.length ? `\n\nAdemás, ${al.length === 1 ? 'esta factura aún está' : 'estas facturas aún están'} en plazo:\n` + al.map(f => `• Folio N° ${f.folio}${f.fecha ? ' del ' + fechaCobranza(f.fecha) : ''}: ${pesosC(f.saldo)}${f.vence && f.vence !== f.fecha ? ' (vence el ' + fechaCobranza(f.vence) + ')' : ''}`).join('\n') + (al.length > 1 ? `\nTotal en plazo: ${pesosC(al.reduce((x, f) => x + f.saldo, 0))}` : '') : '';
  if (firme) {
    return `${hola} te escribimos nuevamente porque aún tenemos pendiente el pago de:\n${lineas}${total}${vigentes}\n\nNecesitamos regularizarlo a la brevedad. ¿Nos confirmas hoy la fecha de pago? Si ya pagaste, envíanos el comprobante y lo revisamos.`
      + (transferencia ? `\n\nPara transferir:\n${transferencia}` : '') + '\n\nGracias.';
  }
  return `${hola} según nuestra última revisión de pagos${revisado ? ` (hasta el ${fechaCobranza(revisado)})` : ''}, no hemos recibido el pago de:\n${lineas}${total}${vigentes}\n\n¿Nos puedes indicar la fecha de pago? Si ya lo hiciste, avísanos y lo revisamos. ¡Gracias!`;
}
// Anota una gestión (recordatorio, compromiso, "dice que ya pagó", nota). Nada se borra: las gestiones solo se agregan.
// Un recordatorio nuevo deja sin efecto el compromiso y el "dice que ya pagó" anteriores (quedan en las gestiones).
export async function registrarGestion(cliente, gestion) {
  const db = await dbOk(), ref = FB.doc(db, 'cobranza', cliente.id);
  const tipo = gestion.tipo, hoy = hoyTxt();
  if (!['recordatorio', 'compromiso', 'dicePago', 'nota', 'quitarCompromiso'].includes(tipo)) throw new Error('Gestión desconocida.');
  if ((tipo === 'compromiso' || tipo === 'dicePago') && !/^\d{4}-\d{2}-\d{2}$/.test(gestion.fecha || '')) throw new Error('Elige la fecha.');
  const g = { tipo, fecha: hoy, en: ahoraTxt(), por: authSF.currentUser.email };
  if (gestion.tono) g.tono = Number(gestion.tono);
  if (gestion.folios) g.folios = gestion.folios.map(String).slice(0, 60);
  if (gestion.saldo != null) g.saldo = Math.round(Number(gestion.saldo) || 0);
  if (gestion.fecha && tipo !== 'recordatorio' && tipo !== 'nota') g.para = gestion.fecha;
  if (gestion.nota) g.nota = String(gestion.nota).trim().slice(0, 300);
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); uso.lecturas++;
    const prev = sn.exists() ? sn.data() : {}, lista = Array.isArray(prev.gestiones) ? prev.gestiones : [];
    const cambio = { cliente: cliente.nombre || '', gestiones: lista.concat([g]), actualizado: g.en };
    if (tipo === 'compromiso') cambio.compromiso = { fecha: gestion.fecha, registrado: hoy, nota: g.nota || '', por: g.por };
    if (tipo === 'dicePago') cambio.diceQuePago = { fecha: gestion.fecha, registrado: hoy, nota: g.nota || '', por: g.por };
    if (tipo === 'recordatorio' || tipo === 'quitarCompromiso') { cambio.compromiso = null; cambio.diceQuePago = null; }
    tx.set(ref, cambio, { merge: true }); uso.escrituras++;
  });
  olvidarAgendaB2b();   // Hoy y la Agenda lo ven al tiro
  return g;
}
// Para Hoy y la Agenda (sin el escuchador): los documentos de cobranza
export async function leerCobranza() {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.collection(db, 'cobranza')); uso.lecturas += Math.max(1, sn.size);
  const out = {}; sn.docs.forEach(d => { out[d.id] = d.data(); });
  return out;
}
// Para Hoy: la cobranza resumida (usa lo mismo que la agenda, 5 minutos en memoria). null si la base nueva no está en uso.
export async function cobranzaParaHoy() {
  const d = await datosAgenda();
  if (!d) return null;
  const cx = await conexion(); const cfg = await configB2b(cx.db);
  if (!cfg || !cfg.activa) return null;
  const hoy = hoyTxt(), c = armarCobranza(foliosPorCobrar(d.porCobrar, d.abonos, d.clientes), d.clientes, d.cobranza || {}, d.conciliacion, hoy);
  return { ...c, compromisosHoy: c.cobrar.filter(g => g.compromiso && g.compromiso.fecha === hoy) };
}
