// ═══════════════════════════════════════════════
//  Sistema Fën — Producción: base nueva (fen-produccion)  v0.38.0
//  · Conexión: la configuración web de fen-produccion se guarda en Firestore de Sistema Fën
//    (config/sistemaFen → produccionFirebase). No es secreta: solo identifica el proyecto.
//    Lo que protege los datos son las reglas de fen-produccion y tu cuenta (admins/{uid}).
//  · Cuentas de las áreas: cada tablet se autoriza con la cuenta de su área; aquí se dice
//    qué área es cada cuenta (cuentas/{uid} = { area, areas }: v0.35.0, una tablet puede entrar a varias áreas).
//  · Copia desde la planilla: el script de Producción (v2.3.0) entrega las hojas (sin costos)
//    y produccion-modelo.js arma los documentos. Recetas, materias primas, configuración y
//    personas se copian enteras. Un plan semanal que ya se cambió en la app Cocina NO se
//    pisa (la app nueva manda desde que se usa).
//  · v0.32.0: Configuración de Producción por área (config/{AREA}) se edita aquí. Una configuración
//    editada en Sistema Fën tampoco se pisa al copiar desde la planilla.
//  · v0.33.0 (P3): las recetas que proponen las jefas en Cocina (propuestas/) se revisan aquí con su
//    costo (lo calcula el script con los precios de la planilla, en neto) y se aprueban o devuelven.
//    Al aprobar, el script escribe la receta en la planilla (costeo, catálogo, Looker siguen igual) y
//    aquí se actualiza la base nueva: recetas/{id}, la versión anterior queda en versiones/{id}_v{n}.
//    Las materias primas pedidas (solicitudes/) se crean con su precio o se habilitan para el área.
//  · v0.34.0 (P4): mover recetas entre áreas (Bollería → Pastelería) con el mismo ID (script v2.5.0).
//  · v0.38.0: consumo de Cafetería en la bodega: lo vendido en la caja (resúmenes de cada cierre y, en la caja
//    abierta, sus ventas) de productos vinculados a una receta de Cafetería, más el café de la bitácora de turno.
//  · v0.41.0: cada crítica puede contarse en envases (saco de 25 kg…): stockmp/{id}.envase.
//  · v0.37.0 (P5): Bodega — stock de las materias primas críticas (bodega común), consumo por área con lo hecho
//    en Cocina, proyección con lo planificado y alerta en Hoy. El cálculo es el de Cocina (copia en cocina/).
//  · v0.58.0: la merma se valoriza con el motor de costeo de Finanzas (costos de fen-gastos). v0.75.1: SOLO con él (costos_mp):
//    ya no se piden costos a la planilla (op costos_merma). Lo que el motor no puede costear queda "sin costo". El café también.
//  · v0.36.0 (P4b): merma de las cuatro áreas (anotada en Cocina) valorizada con los costos de la planilla,
//    y la bitácora de turno de Cafetería (gramos de café); gramos por shot en la configuración de Cafetería.
//  · v0.35.0: una cuenta de área puede entrar a varias áreas (cuentas/{uid}.areas; reglas v1.4.0, script v2.6.0).
//  · v0.54.0: BODEGAS SEPARADAS (Producción y Cafetería; config/bodegas dice qué área usa cuál). Cada materia prima
//    puede ser crítica en una o en las dos, con su mínimo, llegadas, conteos y stock (stockmp/{mpId} = Producción,
//    stockmp/CAF__{mpId} = Cafetería). "Pasar a Cafetería" copia la configuración (lo de antes queda). Bajo el mínimo:
//    pendiente en Hoy y un correo por día, bodega y materia prima (script v2.9.0, op stock_alerta). Cafetería: shots
//    de la calibración diaria en la configuración, días con venta para la calibración automática y su costo en Merma.
//  · v0.63.3: CUOTA DE COCINA. fen-produccion es la base de las tablets de las jefas (su propia cuota gratis de 50.000 lecturas
//    al día). Todo lo que Sistema Fën lee de aquí pasa por la memoria de fs-memoria.js (10 minutos, compartida por Hoy,
//    Producción y Finanzas): recetas, materias primas y configuración (también guardadas en este navegador para la próxima
//    apertura), stock de la bodega, días de Cocina (una lectura de 120 días responde también el mes de Merma o los conteos del
//    cierre), planes, metas, ajustes, cuentas y lo vendido en la caja para Cafetería. Hoy guarda sus dos resúmenes (avisos de
//    bodega y lo que espera de Cocina, con limit y count) y no vuelve a leer en cada apertura. Cada cambio hecho desde aquí
//    olvida lo que toca; "Actualizar" (Hoy y Producción) olvida todo. Sin escuchas en vivo (onSnapshot) sobre fen-produccion.
//  · v0.65.0: BODEGAS POR ÁREA RESPONSABLE (Panadería, Bollería, Pastelería y Cafetería; cocina/consumo.js v0.17.0). Cada
//    materia prima crítica de producción tiene UNA bodega responsable; su stock (el mismo stockmp/{mpId} de siempre) baja con
//    lo que consume cualquier área. "Asignar responsables" (una vez) propone por uso y, al confirmar, guarda config/bodegas
//    { modo: 'responsable', areas, responsables, confirmado, historial }. Sin confirmar: como la v0.54.0. Correo de bajo el
//    mínimo solo a las jefas del área responsable (script v2.11.0). Las mismas lecturas que antes (config ya se leía).
//  · v0.72.0: CATÁLOGO, Etapa 0 ("Qué está vivo"): archivar y reactivar recetas (estado 'archivada', con estadoAntes,
//    archivadaEn, archivadaPor e historialArchivo; las reglas v1.8.0 ya dejan escribir recetas a la administración).
//    Lo cambiado aquí queda en la memoria con la marca nueva (no se vuelven a leer todas las recetas por un cambio propio).
//    Copiar desde la planilla, mover de área y aprobar escriben la receta entera: una archivada en Firestore sigue archivada.
//    La lista de recetas de la f.b. y la de mover de área no muestran las archivadas.
//  · v0.72.1: AJUSTE DE SÁBADO (Cocina v0.17.4): la bodega y el Plan de Panadería usan cocina/modelo.js → ajusteDelDia (vía
//    consumo.ajustesDe), la misma regla de Cocina. Configuración muestra el ajuste de sábado de cada receta (solo para mirar,
//    con los ajustes de la memoria compartida con la bodega).
//  · v0.73.0 (ETAPA 1): LA BASE DE COCINA ES LA MAESTRA de recetas y materias primas. Aprobar una propuesta escribe recetas/{id},
//    versiones/{id}_v{n} y, si es sub receta, su entrada SR… en mps, SOLO en fen-produccion (IDs como los del script: ÁREA + pid;
//    SR + hora + 2 al azar). Las materias primas pedidas se crean en mps con el ID que sigue (MP### / IN###, el mayor + 1) y su precio
//    va a fen-gastos costos_mp (finanzas.js crearPrecioMp). Mover de área, también solo aquí. La planilla de Producción ya no se lee ni
//    se escribe desde la pantalla (decisión del dueño, 21-oct-2026): la lista publicada (CSV) que leen la caja y logística no recibe
//    las recetas nuevas hasta la etapa 2. preparar/copiar quedan en el código, sin botón. El costo de una propuesta sale solo de Finanzas.
//  · v0.76.0: MATERIAS PRIMAS E INSUMOS DESDE FINANZAS → COSTOS. crearMp (mismo ID MP### / IN### y la misma transacción que una pedida
//    en Cocina: crearEnMps, compartida con resolverSolicitud), editarMp (nombre, categoría, áreas; el nombre también en la copia de las
//    recetas que la usan) y archivarMp (estado 'archivada' / 'activa'; no si una receta viva la usa). Historial en mps/{id}.historial.
//    La memoria (memoriaCon) y la marca de cambio quedan al día como al resolver un pedido: Hoy, Producción, Finanzas y Cocina la ven.
// ═══════════════════════════════════════════════
import { auth as authSF, db as dbSF, doc as docSF, getDoc as getDocSF, runTransaction, collection as colSF, getDocs as getDocsSF, query as querySF, where as whereSF } from './firebase.js?v=0.138.0';
import * as FBr from './firebase-produccion.js?v=0.138.0';
import * as Apps from './apps.js?v=0.138.0';
import { armar, AREAS } from './produccion-modelo.js?v=0.138.0';
import { parsearConfig as parsearB2b } from './b2b.js?v=0.138.0';
import * as K from './cocina/consumo.js?v=0.17.12';      // el cálculo de la bodega es el de Cocina (copia exacta)
import * as BF from './bodega-facturas.js?v=0.138.0';
import * as CM from './cocina/modelo.js?v=0.17.4';
import * as M from './fs-memoria.js?v=0.138.0';
import { cambioArchivo, conArchivo } from './catalogo-modelo.js?v=0.138.0';
import * as RM from './recetas-maestro.js?v=0.138.0';
import * as MA from './mp-alta-modelo.js?v=0.138.0';
import { produccion as QP, esCuota } from './fs-cuota.js?v=0.138.0';

// ── v0.63.3: todo pedido a fen-produccion pasa por aquí: se cuenta (Configuración → Uso de la base hoy) y, si Firestore dice
// "cuota agotada" (resource-exhausted), se muestra el letrero de Producción/Cocina. Cada escritura de Sistema Fën en recetas,
// mps, config o stockmp sube su marca de cambio (migracion/sf_cambios): los otros equipos saben que tienen que volver a leerla.
const colDe = r => { try { return (r && (r.col || (r.parent && r.parent.id) || (r.type === 'collection' && r.id) || (r._query && r._query.path && r._query.path.segments && r._query.path.segments.slice(-1)[0]) || r.id)) || '?'; } catch (e) { return '?'; } };
async function vigilar(col, escribe, fn) {
  try { const x = await fn(); QP.marcarViva(escribe ? 'escritura' : 'lectura'); return x; }
  catch (e) { if (esCuota(e)) { QP.marcarAgotada(escribe ? 'escritura' : 'lectura'); throw Object.assign(QP.errorCuota(), { original: e }); } throw e; }
}
const COLS_MARCA = ['recetas', 'mps', 'config', 'stockmp'];
const FB = {
  ...FBr,
  getDoc: r => vigilar(colDe(r), 0, async () => { const x = await FBr.getDoc(r); QP.anotar(colDe(r), 1, 0); return x; }),
  getDocs: q => vigilar(colDe(q), 0, async () => { const sn = await FBr.getDocs(q); QP.anotar(colDe(q), Math.max(1, sn.size), 0); return sn; }),
  getAggregateFromServer: (q, c) => vigilar(colDe(q), 0, async () => { const x = await FBr.getAggregateFromServer(q, c); QP.anotar(colDe(q) + ' (conteo)', 1, 0); return x; }),
  setDoc: (r, d, o) => vigilar(colDe(r), 1, async () => { const x = await (o ? FBr.setDoc(r, d, o) : FBr.setDoc(r, d)); QP.anotar(colDe(r), 0, 1, 0); marcar(colDe(r)); return x; }),
  updateDoc: (r, d) => vigilar(colDe(r), 1, async () => { const x = await FBr.updateDoc(r, d); QP.anotar(colDe(r), 0, 1, 0); marcar(colDe(r)); return x; }),
  writeBatch: db => {
    const b = FBr.writeBatch(db), cols = new Set(); let n = 0;
    const w = { set(r, ...a) { n++; cols.add(colDe(r)); b.set(r, ...a); return w; }, update(r, ...a) { n++; cols.add(colDe(r)); b.update(r, ...a); return w; },
      commit: () => vigilar('lote', 1, async () => { await b.commit(); QP.anotar('lote', 0, n, 0); marcar(...cols); }) };
    return w;
  },
  runTransaction: (db, fn) => vigilar('transaccion', 1, () => FBr.runTransaction(db, fn))
};
// Marcas de cambio: { recetas, mps, config, stockmp: texto único, en }. Lo que solo cambia desde Sistema Fën (Cocina no puede
// escribirlo: reglas v1.7.0) queda guardado en este navegador con su marca; mientras la marca no cambie no se vuelve a leer
// (1 lectura de la marca cada 10 minutos en vez de ≈ 300). Igual se relee una vez al día, por si acaso.
const MARCAS = ['migracion', 'sf_cambios'], DIA = 24 * 3600e3;
let porMarcar = new Set(), tMarcar = 0;
// v0.72.0: lo que ya quedó actualizado en la memoria después de un cambio propio (col → lista): pasa a la marca nueva
const traspaso = {};
function marcar(...cols) {
  cols.filter(c => COLS_MARCA.includes(c)).forEach(c => porMarcar.add(c));
  if (!porMarcar.size) return;
  clearTimeout(tMarcar); tMarcar = setTimeout(escribirMarcas, 200);
}
async function escribirMarcas() {
  const cols = [...porMarcar]; porMarcar = new Set(); if (!cols.length) return;
  const v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), datos = Object.fromEntries(cols.map(c => [c, v]));
  try {
    const cx = await conexion(); if (cx.estado !== 'ok') return;
    await FBr.setDoc(FBr.doc(cx.db, ...MARCAS), { ...datos, en: FBr.serverTimestamp() }, { merge: true }); QP.anotar('migracion', 0, 1, 0);
    for (const c of cols) if (traspaso[c]) { const l = traspaso[c]; delete traspaso[c]; await M.memo(`prod:${c}@${v}`, async () => l, { guardar: true, forzar: true, ttl: DIA }); }
    const ya = M.ver('prod:marca');
    if (ya) await M.memo('prod:marca', async () => ({ ...ya, ...datos }), { guardar: true, forzar: true }); else M.olvidar('prod:marca');
  } catch (e) { cols.forEach(c => { delete traspaso[c]; }); M.olvidar('prod:marca'); }
}
const marcas = (forzar = false) => M.memo('prod:marca', async () => { const db = await dbOk(); const x = await FB.getDoc(FB.doc(db, ...MARCAS)); return x.exists() ? x.data() : {}; }, { guardar: true, forzar });
async function conMarca(col, fn, forzar = false) {
  let mk = {}; try { mk = await marcas(forzar); } catch (e) { if (e && e.code === 'cuota-agotada') throw e; }
  const clave = `prod:${col}@${(mk && mk[col]) || '0'}`;
  if (forzar || M.ver(clave, DIA) === undefined) M.olvidar(`prod:${col}@`);   // lo de una marca vieja ya no sirve
  // forzar (lo pides tú: Calcular, Actualizar): se vuelve a leer igual, por si algo cambió por fuera de Sistema Fën (la consola)
  return M.memo(clave, fn, { guardar: true, ttl: DIA, forzar });
}

export { AREAS };
export { resumenPropuesta } from './finanzas-motor.js?v=0.138.0';
export const VERSION_MINIMA = '2.3.0';   // script de Producción con la copia (SistemaFen.gs v2)
export const VERSION_RECETAS = '2.4.0';  // script con costear / aprobar / materias primas (SistemaFen.gs v2.1)
export const VERSION_MOVER = '2.5.0';    // script que mueve recetas entre áreas (SistemaFen.gs v2.2)
export const VERSION_MERMA = '2.7.0';    // script con costos_merma (SistemaFen.gs v2.4) · v0.75.1: ya no se usa (la merma se costea solo con costos_mp)
export const VERSION_BODEGA = '2.8.0';   // script con bodega_adm (SistemaFen.gs v2.5)
export const VERSION_ALERTAS = '2.9.0';  // script con stock_alerta (correo de bajo el mínimo; SistemaFen.gs v2.6)
export const VERSION_COSTOS = '2.10.0';  // script con mp_costos (MP_maestro con precios para Finanzas; SistemaFen.gs v2.7)
export const VERSION_RESP = '2.11.0';    // script que avisa solo a las jefas del área responsable (SistemaFen.gs v2.8)
const K_CFG = 'fen_sistema_prod_cfg';
const LOTE = 400;

export function parsearConfig(txt) {
  let cfg;
  try { cfg = parsearB2b(txt); } catch (e) { throw new Error(e.message.replace(/B2B/g, 'Producción')); }
  if (cfg.projectId === ((window.FEN_SIS.firebaseB2B || {}).projectId || 'fen-b2b') || /b2b/.test(cfg.projectId)) throw new Error('Esa es la configuración de fen-b2b. Copia la del proyecto fen-produccion.');
  return cfg;
}
const cfgLocal = () => { try { return JSON.parse(localStorage.getItem(K_CFG) || 'null'); } catch (e) { return null; } };
export async function leerConfig() {
  let cfg = null;
  try { const sn = await getDocSF(docSF(dbSF, 'config', 'sistemaFen')); if (sn.exists()) cfg = sn.data().produccionFirebase || null; } catch (e) { cfg = cfgLocal(); }
  try { if (cfg) localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
  return cfg;
}
export async function guardarConfig(cfg) {
  olvidarTodo();
  const ref = docSF(dbSF, 'config', 'sistemaFen');
  await runTransaction(dbSF, async tx => { const sn = await tx.get(ref); tx.set(ref, { ...(sn.exists() ? sn.data() : {}), produccionFirebase: cfg }); });
  try { localStorage.setItem(K_CFG, JSON.stringify(cfg)); } catch (e) {}
}

// estado: sin_config | sin_sesion | sin_admin | ok
// v0.63.3: "conectada y eres administración" queda 10 minutos en memoria (antes: 1 lectura en fen-produccion y otra en la caja
// cada vez que cualquier pantalla preguntaba; Hoy preguntaba 3 veces por apertura)
let cxMem = null;   // { t, p, uid }
export function conexion() {
  const u = FB.conectado() && FB.conectado().auth.currentUser;
  if (cxMem && Date.now() - cxMem.t < M.TTL && Date.now() >= cxMem.t && (!cxMem.uid || (u && u.uid === cxMem.uid))) return cxMem.p;
  const yo = { t: Date.now() };
  yo.p = conexionLeer().then(r => { if (cxMem === yo) { if (r.estado === 'ok') yo.uid = r.uid; else cxMem = null; } return r; },
    e => { if (cxMem === yo) cxMem = null; throw e; });
  cxMem = yo;
  return yo.p;
}
// Olvida lo leído de fen-produccion (botón Actualizar, entrar o salir)
// Sin nada: todo (y la conexión). Con claves ('dias:', 'stockmp'…): solo eso.
// v0.63.3: "Actualizar" vuelve a leer todo, salvo los días de Cocina: de esos, solo los que cambiaron (por actualizado.en).
// olvidarTodo(): también los días (entrar, salir, copiar la planilla).
export function olvidarMemoria(...claves) {
  if (claves.length) { M.olvidar(...claves.map(c => 'prod:' + c)); return; }
  cxMem = null; M.olvidar('prod:', 'caja:cafe:');
  if (diasInc) { diasInc.revisado = 0; guardarDiasInc(); }
}
export function olvidarTodo() { cxMem = null; diasInc = null; M.olvidar('prod:', 'caja:cafe:'); }
async function conexionLeer() {
  const cfg = await leerConfig();
  if (!cfg) return { estado: 'sin_config' };
  const cx = await FB.conectar(cfg);
  const u = cx.auth.currentUser, yo = (authSF.currentUser && authSF.currentUser.email || '').toLowerCase();
  if (!u) return { estado: 'sin_sesion', cfg, correo: yo };
  if ((u.email || '').toLowerCase() !== yo) { await FB.salir(); return { estado: 'sin_sesion', cfg, correo: yo }; }
  let admin = false;
  try { admin = (await FB.getDoc(FB.doc(cx.db, 'admins', u.uid))).exists(); }
  catch (e) { if (!/permission/i.test(e.code || e.message || '')) throw e; }
  if (!admin) return { estado: 'sin_admin', cfg, uid: u.uid, correo: u.email };
  return { estado: 'ok', cfg, uid: u.uid, correo: u.email, db: cx.db };
}
export async function entrar(clave, soloSesion) {
  olvidarTodo();
  const cfg = await leerConfig();
  await FB.conectar(cfg);
  await FB.entrar(authSF.currentUser.email, clave, soloSesion);
  return conexion();
}
export async function salir() {
  olvidarTodo();
  try { if (!FB.conectado()) { const cfg = cfgLocal(); if (!cfg) return; await FB.conectar(cfg); } await FB.salir(); } catch (e) {}
}
async function dbOk() { const cx = await conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva de Producción.'); return cx.db; }

// ── v0.63.3: lecturas de fen-produccion con memoria (fs-memoria.js) ──
const lista = sn => sn.docs.map(d => ({ id: d.id, ...d.data() }));
async function leerCol(col, ...partes) { const db = await dbOk(); return lista(await FB.getDocs(partes.length ? FB.query(FB.collection(db, col), ...partes) : FB.collection(db, col))); }
// Recetas, materias primas y configuración: solo cambian desde Sistema Fën (Cocina no puede escribirlas); 10 minutos, también
// guardadas en este navegador (la próxima apertura no las vuelve a leer dentro de esos 10 minutos)
// (forzar: vuelve a leer y deja lo nuevo en la memoria para las otras pantallas)
// v0.63.3 (2): con su marca de cambio (ver arriba): forzar vuelve a leer la marca, y la colección solo si cambió
const recetasMem = (forzar = false) => conMarca('recetas', () => leerCol('recetas'), forzar);
const mpsMem = (forzar = false) => conMarca('mps', () => leerCol('mps'), forzar);
const configMem = (forzar = false) => conMarca('config', async () => { const r = {}; (await leerCol('config')).forEach(({ id, ...d }) => { r[id] = d; }); return r; }, forzar);
// El stock de la bodega (críticas, mínimos y el último cálculo) solo lo escribe Sistema Fën (reglas: admin): también con marca
const stockmpMem = (forzar = false) => conMarca('stockmp', () => leerCol('stockmp'), forzar);
// Días de Cocina desde una fecha (la bodega: 120 días). Un período (Merma del mes, conteos del cierre) se responde con una
// lectura ya hecha que lo cubra; si no hay, se lee solo ese período (por fecha).
// v0.63.3 (2): los días de Cocina SÍ cambian desde las tablets, pero cada guardado de Cocina lleva actualizado.en (hora del
// servidor; cocina/app.js guardarDia). Se leen una vez (los 120 días de la bodega), quedan en memoria y en este navegador, y
// después se pregunta solo lo que cambió: where('actualizado.en', '>=', lo último visto) (un solo campo: índice simple, sin
// índices compuestos). Se relee todo una vez al día. Las llegadas de Sistema Fën (ADM_) también llevan actualizado.en.
const K_DIAS = 'prod:diasinc', REVISAR_DIAS = 2 * 60000;
let diasInc = null;   // { desde, filas: { id: día }, ultimo (ms), t (lectura completa), revisado (ms) }
const msEn = x => { const e = x && x.actualizado && x.actualizado.en; if (!e) return 0; if (typeof e.toMillis === 'function') return e.toMillis(); if (typeof e === 'number') return e; if (e.__ts) return e.__ts; if (e.seconds !== undefined) return e.seconds * 1000 + Math.floor((e.nanoseconds || 0) / 1e6); return 0; };
const guardarDiasInc = () => { M.memo(K_DIAS, async () => diasInc, { guardar: true, forzar: true, ttl: DIA }).catch(() => {}); };
async function diasDesde(desde, forzar = false) {
  if (!diasInc) { const g = M.ver(K_DIAS, DIA); if (g && g.filas) diasInc = g; }
  const ahora = Date.now();
  if (!diasInc || diasInc.desde > desde || !(ahora - diasInc.t < DIA && ahora >= diasInc.t - 60000)) {
    const l = await leerCol('dias', FB.where('fecha', '>=', desde));
    diasInc = { desde, filas: Object.fromEntries(l.map(x => [x.id, x])), ultimo: l.reduce((m, x) => Math.max(m, msEn(x)), 0), t: ahora, revisado: ahora };
    guardarDiasInc();
  } else if (forzar || !(ahora - diasInc.revisado < REVISAR_DIAS)) {
    const c = diasInc, cambiaron = await leerCol('dias', FB.where('actualizado.en', '>=', FB.Timestamp.fromMillis(c.ultimo)));
    cambiaron.forEach(x => { if (x.fecha >= c.desde) c.filas[x.id] = x; c.ultimo = Math.max(c.ultimo, msEn(x)); });
    c.revisado = ahora;
    if (cambiaron.length > 1 || forzar) guardarDiasInc();
  }
  return Object.values(diasInc.filas).filter(x => x.fecha >= desde);
}
async function diasEntre(desde, hasta, forzar = false) {
  if (!diasInc) { const g = M.ver(K_DIAS, DIA); if (g && g.filas) diasInc = g; }
  if (diasInc && diasInc.desde <= desde) return (await diasDesde(diasInc.desde, forzar)).filter(x => x.fecha >= desde && x.fecha <= hasta);
  const ya = !forzar && M.buscar('prod:dias:', k => { const [a, b] = k.split('~'); return !!b && a <= desde && b >= hasta; });
  const l = ya || await M.memo(`prod:dias:${desde}~${hasta}`, () => leerCol('dias', FB.where('fecha', '>=', desde), FB.where('fecha', '<=', hasta)), { forzar });
  return l.filter(x => x.fecha >= desde && x.fecha <= hasta);
}
// Después de un cambio hecho desde aquí: olvida lo que toca (y Finanzas vuelve a costear con lo nuevo)
const cambio = (...claves) => { versionDatos++; M.olvidar(...claves.map(c => 'prod:' + c)); };

// ── Cuentas de las áreas ──
export async function cuentas() {
  return (await M.memo('prod:cuentas', () => leerCol('cuentas'))).map(({ id, ...d }) => ({ uid: id, ...d }));
}
// v0.35.0: una cuenta puede entrar a varias áreas. "area" = la principal (con la que abre la tablet la primera vez);
// "areas" = todas (la principal primero). Las reglas v1.4.0 y el script v2.6.0 leen las dos.
export const areasDeCuenta = c => [...new Set([c && c.area, ...((c && Array.isArray(c.areas)) ? c.areas : [])])].filter(a => AREAS[a]);
export async function asignarCuenta(uid, area, otras = []) {
  const u = String(uid || '').trim();
  if (!/^[A-Za-z0-9]{20,40}$/.test(u)) throw new Error('El UID no se ve bien: cópialo de la consola de Firebase → Authentication → Usuarios (columna "UID de usuario").');
  if (!AREAS[area]) throw new Error('Área no válida.');
  const areas = [area, ...[...new Set(otras || [])].filter(a => AREAS[a] && a !== area)];
  const db = await dbOk();
  const yo = await conexion();
  if (u === yo.uid) throw new Error('Ese UID es el de tu cuenta de administración: usa el de la cuenta del área.');
  cambio('cuentas');
  await FB.setDoc(FB.doc(db, 'cuentas', u), { area, areas, asignadaPor: authSF.currentUser.email, en: FB.serverTimestamp() });
}

// ── Leer la planilla (script de Producción) ──
export async function leerPlanilla() {
  const url = (await Apps.leerConexiones()).produccion;
  if (!url) { const e = new Error('Falta la dirección del script de Producción (Configuración → Conexiones).'); e.code = 'sin_url'; throw e; }
  const v = await Apps.probar('produccion', url, VERSION_MINIMA);
  if (!v.ok) { const e = new Error(v.version ? `El script de Producción está en v${v.version}: para copiar necesita v${VERSION_MINIMA} (ver README).` : v.texto); e.code = 'actualizar'; throw e; }
  const cuerpo = JSON.stringify({ action: 'sistema_fen_produccion', accion: 'sistema_fen_produccion', op: 'exportar', idToken: await authSF.currentUser.getIdToken() });
  const pedir = (u, o) => Promise.race([fetch(u, o).then(x => x.json()), new Promise((_, no) => setTimeout(() => no(new Error('El script no respondió en 3 minutos. Prueba de nuevo.')), 180000))]);
  let r = await pedir(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo });
  if (r && r.code === 'version') r = await pedir(url + '?p=' + encodeURIComponent(cuerpo), {});
  if (!r || !r.ok || !r.hojas) throw new Error((r && (r.error || r.msg)) || 'Respuesta inesperada del script de Producción.');
  return r;
}

// Lee la planilla y arma los documentos; mira qué planes ya se cambiaron en Cocina. No escribe nada.
export async function preparar() {
  const db = await dbOk();
  const r = await leerPlanilla();
  const a = armar(r.hojas, r.personas);
  const sn = await FB.getDocs(FB.collection(db, 'planes'));
  const editados = new Set(sn.docs.filter(d => d.data().actualizado || d.data().origen !== 'planilla').map(d => d.id));
  const planesACopiar = Object.keys(a.docs.planes).filter(id => !editados.has(id));
  return { ...a, planesACopiar, planesRespetados: Object.keys(a.docs.planes).filter(id => editados.has(id)), leido: r.leido };
}

export async function copiar(prep, avance) {
  const db = await dbOk();
  // Justo antes de escribir se vuelve a mirar: un plan que una jefa cambió en Cocina mientras tanto no se pisa
  const ahora = await FB.getDocs(FB.collection(db, 'planes'));
  const editadosAhora = new Set(ahora.docs.filter(d => d.data().actualizado || d.data().origen !== 'planilla').map(d => d.id));
  const planes = prep.planesACopiar.filter(id => !editadosAhora.has(id));
  const cfgs = await FB.getDocs(FB.collection(db, 'config'));
  const cfgEditadas = new Set(cfgs.docs.filter(d => d.data().editado).map(d => d.id));
  // v0.72.0: las recetas archivadas (Catálogo) siguen archivadas; se leen recién, justo antes de escribir
  const arch = await archivoActual(db);
  const ops = [];
  ['recetas', 'mps', 'config', 'personas'].forEach(col => Object.entries(prep.docs[col]).forEach(([id, d]) => { if (!(col === 'config' && cfgEditadas.has(id))) ops.push([col, id, col === 'recetas' ? conArchivo(d, arch[id]) : d]); }));
  planes.forEach(id => ops.push(['planes', id, prep.docs.planes[id]]));
  let hechos = 0;
  for (let i = 0; i < ops.length; i += LOTE) {
    const b = FB.writeBatch(db);
    ops.slice(i, i + LOTE).forEach(([col, id, d]) => b.set(FB.doc(db, col, id), { ...d, copiadoEn: FB.serverTimestamp() }));
    await b.commit();
    hechos += Math.min(LOTE, ops.length - i);
    if (avance) avance(hechos, ops.length);
  }
  olvidarTodo(); versionDatos++;
  await FB.setDoc(FB.doc(db, 'migracion', 'produccion'), {
    ultima: FB.serverTimestamp(), por: authSF.currentUser.email, resumen: prep.resumen,
    escritos: ops.length, planesRespetados: prep.planesRespetados.length, avisos: prep.avisos.slice(0, 200), totalAvisos: prep.avisos.length
  });
  return { escritos: ops.length };
}

// ── Configuración de Producción por área (config/{AREA}); las jefas la leen en Cocina ──
export const CAMPOS_CONFIG = {
  PAN: [
    { k: 'pie_mm.dias_elaboracion', t: 'dias', etiqueta: 'Días del pie de masa madre', ayuda: 'Al terminar la jornada; cubre hasta el próximo día marcado.' },
    { k: 'pie_mm.reserva_pct', etiqueta: 'Reserva del pie (%)', ayuda: 'Del período siguiente.', def: 20 },
    { k: 'pie_mm.mm_madura_pct', etiqueta: 'Masa madre madura en el pie (%)', ayuda: 'Sobre la harina del pie.', def: 20 },
    { k: 'pie_mm.agua_pct', etiqueta: 'Agua del pie (%)', ayuda: 'Sobre la harina del pie.', def: 90 }
  ],
  BOL: [
    { k: 'amasadora_kg', etiqueta: 'Amasadora (kg de masa por tanda)', ayuda: 'Las tandas van siempre en masas enteras: con 10 kg y masas de 1,6 kg son 6 por tanda. Vacío = se usa "masas por tanda" de la app actual.' },
    { k: 'amasadora_tandas_dia', etiqueta: 'Tandas por día (normal)', ayuda: 'Cocina avisa cuando un día se pasa.', def: 2 },
    { k: 'merma_laminado_pct', etiqueta: 'Merma de laminado (%)', ayuda: 'Se suma a las masas necesarias. 0 si el rendimiento de la receta ya la considera.', def: 0 },
    { k: 'capacidad_congelacion_masas', etiqueta: 'Congelador de masas (espacios)', ayuda: 'Para el stock congelado (bitácora).', def: 40 },
    { k: 'capacidad_productos', etiqueta: 'Congelador de productos (cajas)', ayuda: 'Para el stock congelado (bitácora).', def: 25 }
  ],
  CAF: [
    { k: 'gramos_por_shot', etiqueta: 'Gramos de café por shot', ayuda: 'Para las calibraciones de la bitácora de turno (Cocina). Vacío = 14 g, como la app actual.', def: 14 },
    { k: 'shots_calibracion_diarios', etiqueta: 'Shots de la calibración diaria', ayuda: 'Se cuentan solos cada día que Cafetería vende en la caja. Vacío = 6.', def: 6,
      info: 'Cada día que Cafetería vende en la caja, Cocina y la bodega cuentan esta cantidad de shots de calibración (× gramos por shot) y los descuentan del café de la bodega de Cafetería.\nSi un día calibraron otra cantidad, la barista lo corrige en Cocina → Bitácora de turno → "Editar" (8, o 0 si no se calibró). Lo editado manda sobre este número.\nEn Merma se ve como gasto de calibración, valorizado con el costo del café.' },
    { k: 'calibracion_desde', t: 'fecha', etiqueta: 'Calibración automática desde (opcional)', ayuda: 'Vacío = desde que Cafetería abrió Cocina v0.15.0 o posterior.',
      info: 'Desde qué día se cuentan los días automáticos de calibración. Nunca se cuenta hacia atrás.\nVacío: desde el primer día en que Cafetería abrió Cocina v0.15.0 o posterior (Cocina deja esa marca sola). Ponlo solo si quieres partir otro día.' }
  ]
};
export const valorEn = (o, k) => k.split('.').reduce((x, p) => (x && typeof x === 'object' ? x[p] : undefined), o);
export async function leerConfigs() { return configMem(); }
// cambios: { 'pie_mm.reserva_pct': 25, 'amasadora_kg': 10, … } → se mezcla con lo que hay (merge)
export async function guardarConfigArea(area, cambios) {
  cambio('config', 'hoy:alertas');   // v0.63.2/v0.63.3: Finanzas y la bodega vuelven a leer la configuración
  if (!CAMPOS_CONFIG[area]) throw new Error('Área sin configuración.');
  const db = await dbOk(), datos = {};
  Object.entries(cambios).forEach(([k, v]) => {
    const partes = k.split('.'); let o = datos;
    partes.slice(0, -1).forEach(p => { o = o[p] = o[p] || {}; });
    o[partes[partes.length - 1]] = v;
  });
  await FB.setDoc(FB.doc(db, 'config', area), { ...datos, editado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true });
}

// ── v0.66.0 · Fermentación en bloque (config/PAN.fermentacionBloque = { recetaId | subId: minutos }); Cocina la muestra ──
// Las recetas que aparecen en "Recetas del día" de Cocina: las aprobadas (no sub recetas) y las sub recetas elegidas en
// "Ordenar Hoy" (ajustes/{AREA}__hoy, un documento; si no se puede leer o no está: las "Masa …", menos masa madre, poolish
// y pie, como Cocina). Lecturas: recetas con su marca (como siempre) + ese documento, guardado 10 minutos en este navegador.
const normFB = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const masaPorDefecto = nombre => { const n = normFB(nombre); return /^masa /.test(n) && !/masa madre|poolish|\bpie\b/.test(n); };
export function listaFB(recetas, hoyDoc, area = 'PAN') {
  const elegidas = (hoyDoc && hoyDoc.hoy && hoyDoc.hoy.recetasDia) || {};
  const deArea = (recetas || []).filter(r => r.area === area && !/anulad|archivad/.test(normFB(r.estado)));   // v0.72.0: sin las archivadas
  const prods = deArea.filter(r => r.tipo !== 'sub_receta' && /consolidad|aprobad/.test(normFB(r.estado))).map(r => ({ id: r.id, nombre: r.nombre || r.id, tipo: 'receta' }));
  const subs = deArea.filter(r => r.tipo === 'sub_receta' && r.mpId).filter(r => { const v = elegidas[r.mpId]; return typeof v === 'boolean' ? v : masaPorDefecto(r.nombre); })
    .map(r => ({ id: r.mpId, nombre: r.nombre || r.mpId, tipo: 'sub' }));
  const orden = (x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es');
  return [...subs.sort(orden), ...prods.sort(orden)];
}
export async function recetasFB(area = 'PAN') {
  const rs = await recetasMem();
  let hoy = null;
  try {
    hoy = await M.memo(`prod:fbhoy:${area}`, async () => { const db = await dbOk(); const sn = await FB.getDoc(FB.doc(db, 'ajustes', `${area}__hoy`)); return sn.exists() ? sn.data() : {}; }, { guardar: true, ttl: 10 * 60000 });
  } catch (e) { if (e && e.code === 'cuota-agotada') throw e; hoy = null; }
  return { lista: listaFB(rs, hoy, area), leyoHoy: hoy !== null };
}
// ── v0.72.1 · Ajuste de sábado de Cocina v0.17.4 (ajustes/{AREA}_{receta}.sabado), solo para mirarlo ──
// → [{ recetaId, nombre, activo, desde, pausadoDesde, por, texto, saltaProximo }] (las recetas del área con ajuste de sábado)
// El cálculo (cuál vale cada día) es el de Cocina: cocina/modelo.js → estadoSabado / ajusteDelDia.
export function listaSabado(recetas, ajustes, area = 'PAN', hoy = '') {
  const porId = {}; (recetas || []).forEach(r => { porId[r.id] = r; });
  const prox = hoy ? CM.sumarDias(hoy, (CM.SABADO - CM.indiceDia(hoy) + 7) % 7) : '';   // este sábado (o hoy, si es sábado)
  return (ajustes || []).filter(a => a && a.area === area && a.sabado && a.recetaId && a.recetaId !== '_hoy').map(a => {
    const r = porId[a.recetaId], e = CM.estadoSabado(a, prox || a.sabado.desde);
    if (!e.hay) return null;
    const P = r ? CM.panadero(r) : null, partes = [];
    if (e.harina && P && Math.abs(e.harina - P.harina) > 0.1) partes.push(`harina base ${Math.round(e.harina).toLocaleString('es-CL')} g`);
    Object.entries(e.pct).forEach(([id, v]) => { const i = r && (r.ingredientes || []).find(x => x.id === id); partes.push(`${i ? i.nombre : id} ${String(Math.round(v * 100) / 100).replace('.', ',')} %${i && P && P.pct(i) ? ` (receta ${String(Math.round(P.pct(i) * 100) / 100).replace('.', ',')} %)` : ''}`); });
    return { recetaId: a.recetaId, nombre: r ? (r.nombre || a.recetaId) : a.recetaId, activo: e.activo, desde: e.desde, pausadoDesde: e.pausadoDesde, por: e.activo ? e.por : e.pausadoPor,
      texto: partes.join(' · '), proximo: prox, saltaProximo: !!prox && e.saltar.includes(prox) };
  }).filter(Boolean).sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
}
export async function ajustesSabado(area = 'PAN', hoy = '') {
  const [rs, aj] = await Promise.all([recetasMem(), M.memo('prod:ajustes', () => leerCol('ajustes'))]);
  return listaSabado(rs, aj, area, hoy);
}
// valores: { id: minutos | null } (solo los de la lista: null = sin f.b.; los demás que hubiera quedan como estaban)
export async function guardarFB(area, valores) { await guardarConfigArea(area, { fermentacionBloque: valores }); }

// Control: lo que hay en la base nueva comparado con la planilla
export async function totales() {
  const db = await dbOk();
  // v0.63.3: recetas y MP de la memoria; personas con count() (1 lectura); planes y la última copia, 10 minutos en memoria
  const [r, m, p, pe, ult] = await Promise.all([recetasMem(), mpsMem(), M.memo('prod:planes:planilla', () => leerCol('planes', FB.where('origen', '==', 'planilla'))),   // solo los copiados de la planilla (los de Cocina no cuentan aquí)
    M.memo('prod:personas:n', async () => (await FB.getAggregateFromServer(FB.collection(db, 'personas'), { n: FB.count() })).data().n),
    M.memo('prod:migracion', async () => { const x = await FB.getDoc(FB.doc(db, 'migracion', 'produccion')); return x.exists() ? x.data() : null; })]);
  const porArea = {}; Object.keys(AREAS).forEach(a => { porArea[a] = 0; });
  r.forEach(x => { const a = x.area; if (a in porArea) porArea[a]++; });
  const unidades = { PAN: 0, BOL: 0, PAS: 0 }, planillaUn = { PAN: 0, BOL: 0, PAS: 0 };
  p.forEach(x => { if (!(x.area in unidades)) return; Object.values(x.filas || {}).forEach(f => Object.values(f || {}).forEach(v => { unidades[x.area] += Number(v) || 0; if (x.origen === 'planilla' && !x.actualizado) planillaUn[x.area] += Number(v) || 0; })); });
  return { recetas: r.length, recetasPorArea: porArea, mps: m.length, planes: p.length, unidades, unidadesSinCambiar: planillaUn, personas: pe, ultima: ult };
}

// ═══════════════ P3: recetas propuestas y materias primas pedidas ═══════════════
async function script(op, datos, minima = VERSION_RECETAS) {
  const url = (await Apps.leerConexiones()).produccion;
  if (!url) { const e = new Error('Falta la dirección del script de Producción (Configuración → Conexiones).'); e.code = 'sin_url'; throw e; }
  const v = await Apps.probar('produccion', url, minima);
  if (!v.ok) { const e = new Error(v.version ? `El script de Producción está en v${v.version}: para esto necesita v${minima} (ver README).` : v.texto); e.code = 'actualizar'; throw e; }
  const cuerpo = JSON.stringify({ action: 'sistema_fen_produccion', accion: 'sistema_fen_produccion', op, ...datos, idToken: await authSF.currentUser.getIdToken() });
  const pedir = (u, o) => Promise.race([fetch(u, o).then(x => x.json()), new Promise((_, no) => setTimeout(() => no(new Error('El script no respondió en 2 minutos. Prueba de nuevo.')), 120000))]);
  let r = await pedir(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo });
  if (r && r.code === 'version') r = await pedir(url + '?p=' + encodeURIComponent(cuerpo), {});
  if (!r || r.ok !== true) { const e = new Error((r && (r.error || r.msg)) || 'Respuesta inesperada del script de Producción.'); e.code = r && r.code; e.datos = r; throw e; }
  return r;
}
// v0.56.0 · Finanzas: MP_maestro CON precios (solo administración, solo lectura). Lo que llega se guarda en fen-gastos,
// nunca en fen-produccion (la base de las jefas no guarda costos).
export async function mpCostos() { return (await script('mp_costos', {}, VERSION_COSTOS)).filas || []; }
// v0.56.0 · Finanzas: materias primas y recetas de fen-produccion (nombres, tipo, estado e ingredientes; sin costos)
// v0.63.2: sube cada vez que desde Sistema Fën cambia una receta, una materia prima o la configuración (Finanzas guarda en memoria
// lo que lee de aquí y con esto sabe que tiene que volver a leer)
export let versionDatos = 0;
export async function mpsYRecetas() {
  const [mps, recetas] = await Promise.all([mpsMem(), recetasMem()]);
  return { mps, recetas };
}

// ═══════════════ v0.72.0 · Catálogo, Etapa 0: archivar y reactivar recetas ═══════════════
export async function recetasCatalogo(forzar = false) { return recetasMem(forzar); }
// v0.73.0 · Respaldo: cuánto costaría leer recetas y materias primas (0 si ya están en la memoria compartida; si no, 1 conteo cada una)
export async function conteoCocina() {
  const mk = M.ver('prod:marca', DIA) || {};
  const en = col => M.ver(`prod:${col}@${mk[col] || '0'}`, DIA) !== undefined;
  const db = await dbOk(), out = { recetas: 0, mps: 0, preguntas: 0 };
  for (const col of ['recetas', 'mps']) {
    if (en(col)) continue;
    out[col] = (await FB.getAggregateFromServer(FB.collection(db, col), { n: FB.count() })).data().n; out.preguntas++;
  }
  return out;
}
// Lo que hay de archivo en Firestore ahora (para no pisarlo al escribir recetas enteras): las archivadas (1 consulta; cuesta
// 1 lectura por archivada) y, de la memoria, el historial de archivo de las reactivadas. → { id: receta }
async function archivoActual(db) {
  const out = {};
  try { (await recetasMem()).forEach(r => { if (r.historialArchivo || r.estado === 'archivada') out[r.id] = r; }); } catch (e) { if (e && e.code === 'cuota-agotada') throw e; }
  lista(await FB.getDocs(FB.query(FB.collection(db, 'recetas'), FB.where('estado', '==', 'archivada')))).forEach(r => { out[r.id] = r; });
  return out;
}
// ids: las recetas a archivar (archivar = true) o reactivar (false). Usa la memoria (las recetas solo cambian desde Sistema Fën:
// reglas v1.7.0). Un solo lote; 1 escritura por receta (+1 de la marca). → [{ id, nombre, antes, despues }] lo que cambió
export async function archivarRecetas(ids, archivar = true) {
  const db = await dbOk(), por = (authSF.currentUser && authSF.currentUser.email) || '', en = new Date().toISOString();
  const recs = await recetasMem(), porId = {}; recs.forEach(r => { porId[r.id] = r; });
  const cambios = [];
  [...new Set(ids || [])].forEach(id => {
    const r = porId[id]; if (!r) throw new Error(`La receta ${id} ya no está en la base de Cocina. Toca Actualizar.`);
    const c = cambioArchivo(r, archivar, { por, en }); if (c) cambios.push({ id, nombre: r.nombre || id, antes: r.estado || '', despues: c.estado, c });
  });
  if (!cambios.length) return [];
  const b = FB.writeBatch(db);
  cambios.forEach(x => b.update(FB.doc(db, 'recetas', x.id), { ...x.c, [archivar ? 'archivadaEn' : 'reactivadaEn']: FB.serverTimestamp() }));
  await b.commit();
  // La memoria queda con lo nuevo (con la marca de ahora y con la que se escribe enseguida): nadie vuelve a leer las ≈ 300 recetas
  const nueva = recs.map(r => { const x = cambios.find(y => y.id === r.id); return x ? { ...r, ...x.c, [archivar ? 'archivadaEn' : 'reactivadaEn']: en } : r; });
  const mk = M.ver('prod:marca', DIA), clave = `prod:recetas@${(mk && mk.recetas) || '0'}`;
  traspaso.recetas = nueva;
  await M.memo(clave, async () => nueva, { guardar: true, forzar: true, ttl: DIA });
  versionDatos++; M.olvidar('prod:hoy:');
  return cambios.map(({ c, ...x }) => x);
}
// Lo que se costea de una receta de la base nueva (mismo formato que una propuesta)
export function datosDeReceta(r) {
  return {
    nombre: r.nombre, tipo: r.tipo, porciones: r.porciones, unidad: r.unidad, harinaTotal: r.harinaTotal,
    ingredientes: (r.ingredientes || []).map(i => ({ id: i.id, nombre: i.nombre, gramos: Number(i.gramos) || 0, unidades: i.unidades ?? null })),
    insumos: (r.insumos || []).map(i => ({ id: i.id, nombre: i.nombre, cantidad: Number(i.cantidad ?? i.unidades) || 0 })),
    pasos: r.pasos || [], notas: r.notas || '', clasificacion: r.clasificacion || '', pesoUnidad: r.pesoUnidad || 0,
    planificable: r.planificable !== false, seCongela: !!r.seCongela, unidadesPorCaja: r.unidadesPorCaja || 0
  };
}
export async function propuestasEnRevision() {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'propuestas'), FB.where('estado', 'in', ['en_revision', 'aprobando'])));
  const lista = sn.docs.map(d => ({ docId: d.id, ...d.data() }));
  // v0.63.3: la versión vigente sale de las recetas en memoria (solo cambian desde Sistema Fën; aprobar la vuelve a leer)
  const vig = {}; (await recetasMem()).forEach(r => { vig[r.id] = r; });
  return lista.map(p => ({ ...p, vigente: p.recetaId ? vig[p.recetaId] || null : null }))
    .sort((a, b) => String(((a.historial || []).slice(-1)[0] || {}).en || '').localeCompare(String(((b.historial || []).slice(-1)[0] || {}).en || '')));
}
export async function solicitudesPendientes() {
  const db = await dbOk();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'solicitudes'), FB.where('estado', '==', 'pendiente')));
  return sn.docs.map(d => ({ docId: d.id, ...d.data() })).sort((a, b) => String(a.en || '').localeCompare(String(b.en || '')));
}
// Para Hoy: cuántas recetas y materias primas esperan (null si la base nueva no está conectada)
// v0.63.3: Hoy muestra cuántas y las 3 primeras: se leen 3 de cada una (limit) y, si hay más, se cuentan (count(): 1 lectura).
// Queda 2 minutos en memoria y en este navegador (como los resúmenes de las otras apps en Hoy).
export async function pendientesCocina({ forzar = false } = {}) {
  try {
    const cx = await conexion(); if (cx.estado !== 'ok') return null;
    return await M.memo('prod:hoy:pend', async () => {
      const db = cx.db, N = 3;
      const uno = async (col, w) => {
        const sn = await FB.getDocs(FB.query(FB.collection(db, col), w, FB.limit(N)));
        const n = sn.size < N ? sn.size : (await FB.getAggregateFromServer(FB.query(FB.collection(db, col), w), { n: FB.count() })).data().n;
        return { n, docs: sn.docs.map(d => d.data()) };
      };
      const [p, s] = await Promise.all([uno('propuestas', FB.where('estado', 'in', ['en_revision', 'aprobando'])), uno('solicitudes', FB.where('estado', '==', 'pendiente'))]);
      return { nRecetas: p.n, nMps: s.n, recetas: p.docs.map(x => ({ nombre: (x.datos || {}).nombre || '', area: x.area })), mps: s.docs.map(x => ({ nombre: x.nombre || '', area: x.area, tipo: x.tipo || '' })) };
    }, { ttl: 2 * 60000, guardar: true, forzar });
  } catch (e) { return null; }
}
// v0.132.0 · Hoy → Solicitudes: cada receta propuesta y cada materia prima pedida, con quién y cuándo (null si no está conectada).
// 2 consultas (las mismas de Por revisar, sin leer las recetas vigentes); 2 minutos en memoria.
export async function solicitudesCocina({ forzar = false } = {}) {
  try {
    const cx = await conexion(); if (cx.estado !== 'ok') return null;
    return await M.memo('prod:hoy:sol', async () => {
      const [p, s] = await Promise.all([
        FB.getDocs(FB.query(FB.collection(cx.db, 'propuestas'), FB.where('estado', 'in', ['en_revision', 'aprobando']))),
        FB.getDocs(FB.query(FB.collection(cx.db, 'solicitudes'), FB.where('estado', '==', 'pendiente')))]);
      const ult = h => [...(h || [])].reverse().find(x => x && x.estado === 'en_revision') || (h || []).slice(-1)[0] || {};
      return {
        recetas: p.docs.map(d => { const x = d.data(), u = ult(x.historial); return { docId: d.id, nombre: (x.datos || {}).nombre || '', area: x.area || '', cambio: !!x.recetaId, por: u.por || x.creadaPor || '', en: u.en || '' }; }),
        mps: s.docs.map(d => { const x = d.data(); return { docId: d.id, nombre: x.nombre || '', area: x.area || '', tipo: x.tipo || '', receta: x.receta || '', nota: x.nota || '', por: x.por || '', en: x.en || '' }; })
      };
    }, { ttl: 2 * 60000, guardar: true, forzar });
  } catch (e) { return null; }
}
// Costo por unidad de la propuesta y de la versión vigente
// v0.73.0 (Etapa 1): SOLO el motor de Finanzas (precios de fen-gastos costos_mp, en neto). Ya no se pregunta al script (los precios de
// la planilla quedaron como estaban). Lo que no está en la base de Cocina va en "faltan" (no se puede aprobar).
export async function costear(prop) {
  const [fin, base] = await Promise.all([
    import('./finanzas.js?v=0.138.0').then(F => F.costosPropuesta(prop)),
    mpsYRecetas().catch(() => null)
  ]);
  if (!fin || !fin.propuesta) { const e = new Error('Para ver el costo, conecta la base de Gastos y Finanzas (Gastos → Configuración → Base nueva): los precios están en Finanzas → Costos.'); e.code = 'sin_gastos'; throw e; }
  const faltan = base ? RM.faltantes(prop.datos, base.mps, base.recetas) : [];
  return { ...fin, propuesta: { ...fin.propuesta, faltan } };
}
// v0.77.1 · Producción → Por revisar: el costo de todas las propuestas de la lista de una vez (los precios se leen una sola vez)
// → [{ …comparación, propuesta: { …, faltan } } | { error }] en el mismo orden
export async function costearVarias(props) {
  const [fin, base] = await Promise.all([
    import('./finanzas.js?v=0.138.0').then(F => F.costosPropuestas(props)),
    mpsYRecetas().catch(() => null)
  ]);
  return (props || []).map((p, i) => {
    const c = fin[i];
    if (!c || !c.propuesta) return { error: 'Para ver el costo, conecta la base de Gastos y Finanzas (Gastos → Configuración → Base nueva): los precios están en Finanzas → Costos.', code: 'sin_gastos' };
    return { ...c, propuesta: { ...c.propuesta, faltan: base ? RM.faltantes(p.datos, base.mps, base.recetas) : [] } };
  });
}
// v0.77.1 · Producción → Recetas: las versiones anteriores de una receta (versiones/{id}_v{n}, guardadas al aprobar un cambio).
// Se leen solo al pedirlas, por su ID (v1 … la anterior a la vigente: 1 lectura cada una) y quedan 10 minutos en memoria.
export async function versionesReceta(id, version) {
  const n = Math.max(0, Math.min(60, (Number(version) || 1) - 1));
  if (!n) return [];
  const l = await M.memo(`prod:versiones:${id}@${n}`, async () => {
    const db = await dbOk();
    const sn = await Promise.all(Array.from({ length: n }, (_, k) => FB.getDoc(FB.doc(db, 'versiones', `${id}_v${k + 1}`))));
    return sn.filter(x => x.exists()).map(x => ({ ...x.data(), id, docId: x.id }));
  });
  return l.map(v => ({ ...v, version: Number(v.version) || Number(String(v.docId).split('_v').pop()) || 1 })).sort((a, b) => b.version - a.version);
}
const paso = (prop, estado, comentario, extra = {}) => ({
  estado, ...extra,
  historial: [...(prop.historial || []), { estado, por: authSF.currentUser.email, en: new Date().toISOString(), comentario: comentario || '' }].slice(-40),
  actualizado: { por: authSF.currentUser.email, en: FB.serverTimestamp() }
});
// Cambia el estado de una propuesta solo si sigue en el estado esperado (transacción: el historial no se pisa)
async function pasar(db, docId, desde, estado, comentario, extra = {}) {
  const ref = FB.doc(db, 'propuestas', docId);
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists() || !desde.includes(sn.data().estado)) { const e = new Error('La propuesta cambió mientras la revisabas (la retiraron, la anularon o ya se resolvió). Vuelve a cargar la lista.'); e.code = 'cambio'; throw e; }
    const p = sn.data();
    tx.set(ref, paso(p, estado, comentario, extra), { merge: true });
    return p;
  });
}
export async function devolver(prop, comentario) {
  cambio('hoy:pend');
  if (!String(comentario || '').trim()) throw new Error('Escribe qué hay que corregir: la jefa lo ve en Cocina.');
  const db = await dbOk();
  await pasar(db, prop.docId, ['en_revision'], 'devuelta', String(comentario).trim().slice(0, 500));
}
// Una aprobación que quedó a medias (se cortó internet o se cerró la página): vuelve a revisión para reintentar.
// Reintentar no duplica: la receta nueva usa el ID de la propuesta y el cambio a una vigente escribe la misma versión.
export async function destrabar(prop) {
  cambio('hoy:pend');
  const db = await dbOk();
  await pasar(db, prop.docId, ['aprobando'], 'en_revision', 'La aprobación quedó a medias: vuelve a revisión');
}
// La memoria de recetas y mps queda con lo recién escrito (como archivarRecetas): nadie vuelve a leer las ≈ 300 recetas por un cambio propio
async function memoriaCon(col, docs) {
  const actual = await (col === 'recetas' ? recetasMem() : mpsMem()).catch(() => null);
  if (!actual) { M.olvidar(`prod:${col}@`); return; }
  const porId = new Map(actual.map(x => [x.id, x]));
  Object.entries(docs).forEach(([id, d]) => porId.set(id, { id, ...d }));
  const nueva = [...porId.values()];
  const mk = M.ver('prod:marca', DIA), clave = `prod:${col}@${(mk && mk[col]) || '0'}`;
  traspaso[col] = nueva;
  await M.memo(clave, async () => nueva, { guardar: true, forzar: true, ttl: DIA });
}
const sinTs = d => JSON.parse(JSON.stringify(d, (k, v) => (v && typeof v === 'object' && (v._methodName || v.__ts !== undefined || typeof v.toMillis === 'function') ? new Date().toISOString() : v)));
// v0.73.0 (Etapa 1): aprobar escribe SOLO en la base de Cocina (fen-produccion), que es la maestra. La planilla de Producción ya
// no se escribe: la lista publicada (CSV) que leen la caja y logística no recibe las recetas nuevas hasta la etapa 2.
//  1) la propuesta pasa a "aprobando" (la jefa ya no la puede cambiar ni retirar; reglas v1.2.0);
//  2) en un solo lote: la versión anterior en versiones/{id}_v{n}, la receta en recetas/{id} y, si es sub receta, su entrada en mps
//     (SR…, con recetaOrigen = id; la receta lleva mpId = SR…);
//  3) la propuesta pasa a "aprobada" con su recetaId.
// IDs como los del script: receta nueva = ÁREA + pid; sub receta nueva = SR + hora + 2 al azar. Reintentar no duplica (mismo ID).
export async function aprobar(prop, comentario) {
  cambio('hoy:');
  const db = await dbOk();
  const p = { ...prop, ...(await pasar(db, prop.docId, ['en_revision'], 'aprobando', '')) };
  const volver = async msg => { try { await pasar(db, p.docId, ['aprobando'], 'en_revision', msg); } catch (e) {} };
  const por = authSF.currentUser.email, hoy = CM.hoyTxt();
  let id, vig = null, version, nueva, docR, docM = null, idM = '';
  try {
    const d = p.datos || {};
    if (!String(d.nombre || '').trim()) throw new Error('La receta no tiene nombre.');
    if (!AREAS[p.area]) throw new Error('Área no válida.');
    if (p.recetaId) {
      id = p.recetaId;
      const x = await FB.getDoc(FB.doc(db, 'recetas', id)); vig = x.exists() ? { id, ...x.data() } : null;
      if (!vig) throw new Error(`La receta ${id} ya no está en la base de Cocina.`);
      // Una propuesta hecha sobre una versión anterior no pisa un cambio aprobado después
      if (p.versionBase && Number(vig.version) !== Number(p.versionBase)) {
        const e = new Error(`La receta vigente cambió desde que se hizo esta propuesta (era v${p.versionBase}, ahora v${vig.version}). Devuélvela para que la rehagan sobre la vigente.`); e.code = 'version'; throw e;
      }
      version = (Number(vig.version) || 1) + 1; nueva = false;
    } else {
      id = RM.idReceta(p.area, p.pid);
      if (!RM.idValidoReceta(id, p.area)) throw new Error('Falta el ID de la receta nueva.');
      const x = await FB.getDoc(FB.doc(db, 'recetas', id));
      if (x.exists() && String(x.data().propuesta || '') !== String(p.pid)) throw new Error(`Ya existe otra receta con el ID ${id}. Avísame: no se aprueba para no pisarla.`);
      // Reintento de una aprobación a medias: la receta ya quedó; se vuelve a escribir igual (misma versión)
      vig = x.exists() ? { id, ...x.data() } : null; version = vig ? Number(vig.version) || 1 : 1; nueva = true;
    }
    const base = await mpsYRecetas();
    const faltan = RM.faltantes(d, base.mps, base.recetas);
    if (faltan.length) { const e = new Error('Hay ingredientes que no están en la base de Cocina: ' + faltan.join(', ') + '.'); e.code = 'faltan'; throw e; }
    const choca = RM.choqueNombre(d, base.mps, id);
    if (choca) { const e = new Error(`Ya hay una materia prima llamada "${d.nombre}" (${choca.id}). Devuélvela para que le cambien el nombre a la sub receta.`); e.code = 'nombre'; throw e; }
    if (d.tipo === 'sub_receta') { const prev = RM.srDe(id, vig, base.mps); idM = prev ? prev.id : RM.idSR(); docM = RM.docSR({ area: p.area, nombre: String(d.nombre).trim() }, id, prev); }
    docR = RM.docReceta(p, vig && !nueva ? vig : (vig || null), { id, version, por, hoy, mpId: idM });
    const b = FB.writeBatch(db);
    if (vig && !nueva) b.set(FB.doc(db, 'versiones', `${vig.id}_v${Number(vig.version) || 1}`), { ...vig, archivadaEn: FB.serverTimestamp(), reemplazadaPor: version });
    b.set(FB.doc(db, 'recetas', id), { ...conArchivo(docR, vig), aprobadaEnTs: FB.serverTimestamp() });   // v0.72.0: si estaba archivada, sigue
    if (docM) b.set(FB.doc(db, 'mps', idM), { ...docM, actualizadoEn: FB.serverTimestamp() });
    await b.commit();
  } catch (e) { await volver(e.code === 'cuota-agotada' ? '' : ''); throw e; }
  try { await memoriaCon('recetas', { [id]: sinTs(conArchivo(docR, vig)) }); if (docM) await memoriaCon('mps', { [idM]: sinTs(docM) }); } catch (e) { M.olvidar('prod:recetas@', 'prod:mps@'); }
  versionDatos++;
  await pasar(db, p.docId, ['aprobando'], 'aprobada', comentario, { recetaId: id, versionAprobada: version });
  return { id, nueva, version, mpId: idM || null };
}
// Materias primas pedidas: crear (con precio neto y unidad de compra) o habilitar una existente
// v0.73.0 (Etapa 1): SOLO en Firestore. La materia prima va a la base de Cocina (mps/{MP###|IN###}, sin precio) y su precio a
// fen-gastos costos_mp (Finanzas → Costos: precio neto por la unidad de compra, origen "A mano"). La planilla ya no se escribe.
export const UNIDAD_COMPRA = MA.UNIDAD_COMPRA;
// v0.76.0: el alta en mps con el ID que sigue (MP### / IN###, el mayor + 1), compartida por las materias primas pedidas en Cocina y
// las que creas en Finanzas → Costos. Una transacción por intento: si justo ese ID existe (otro equipo), se prueba el siguiente.
// extra(tx, id): lo que se escribe en la misma transacción (la solicitud resuelta). → el ID
async function crearEnMps(db, mps, tipo, doc, extra = null) {
  const saltar = [];
  for (let k = 0; k < 20; k++) {
    const cand = RM.siguienteIdMp(mps, tipo, saltar);
    try {
      await FB.runTransaction(db, async tx => {
        const ref = FB.doc(db, 'mps', cand), sn = await tx.get(ref);
        if (sn.exists()) { const e = new Error('ocupado'); e.code = 'id-ocupado'; throw e; }
        tx.set(ref, { ...doc, creadaEnTs: FB.serverTimestamp() });
        if (extra) extra(tx, cand);
      });
      marcar('mps');
      return cand;
    } catch (e) { if (e.code !== 'id-ocupado') throw e; saltar.push(cand); }
  }
  throw new Error('No se pudo elegir un ID libre para la materia prima. Toca Actualizar y vuelve a intentar.');
}
export async function resolverSolicitud(sol, datos = {}) {
  cambio('hoy:');
  const db = await dbOk(), por = authSF.currentUser.email, hoy = CM.hoyTxt(), en = new Date().toISOString();
  const mps = await mpsMem();
  const refSol = FB.doc(db, 'solicitudes', sol.docId), resuelta = mpId => ({ estado: 'resuelta', mpId, resueltaPor: por, resueltaEn: en });
  if (sol.tipo === 'habilitar' || datos.habilitarId) {
    const idH = String(datos.habilitarId || sol.mpId || '');
    const m = mps.find(x => x.id === idH);
    if (!m) throw new Error(`La materia prima ${idH} no está en la base de Cocina. Toca Actualizar.`);
    const areas = RM.conArea(m, sol.area);
    // v0.75.1: si estaba inactiva, habilitarla también la reactiva (Cocina ahora ofrece las inactivas)
    const reactivar = (m.estado || 'activa') !== 'activa';
    const b = FB.writeBatch(db);
    b.update(FB.doc(db, 'mps', idH), { areas, ...(reactivar ? { estado: 'activa', reactivadaPor: por, reactivadaEn: en } : {}), actualizadoEn: FB.serverTimestamp() });
    b.set(refSol, resuelta(idH), { merge: true });
    await b.commit();
    const { id: _z, ...resto } = m;
    await memoriaCon('mps', { [idH]: { ...resto, areas, ...(reactivar ? { estado: 'activa' } : {}) } }).catch(() => M.olvidar('prod:mps@'));
    if (reactivar) await sincronizarCostos(idH, { estado: 'activa' });
    versionDatos++;
    return idH;
  }
  const unidad = String(datos.unidad || '').trim().toLowerCase().replace(',', '.');
  if (!UNIDAD_COMPRA.test(unidad)) throw new Error(`"${datos.unidad || ''}" no es una unidad de compra válida. Usa por ejemplo: kg, 25kg, g, lt, 500ml, un, 10un.`);
  const nombre = String(datos.nombre || sol.nombre || '').trim(), tipo = datos.tipo === 'insumo' || (!datos.tipo && sol.esInsumo) ? 'insumo' : 'mp';
  if (!nombre) throw new Error('Falta el nombre.');
  if (!(Number(datos.costoNeto) > 0)) throw new Error('Escribe el costo neto (sin IVA) de la unidad de compra.');
  // v0.76.0: repetida también sin importar tildes (la misma regla del alta en Finanzas)
  const rep = MA.repetida(nombre, mps);
  if (rep) { const e = new Error(`Ya existe "${nombre}" (${rep.id}). Habilítala en vez de crearla.`); e.code = 'existe'; e.datos = { id: rep.id }; throw e; }
  // El precio va a Finanzas: sin fen-gastos conectada no se crea (así nunca queda una materia prima sin su precio por error)
  const F = await import('./finanzas.js?v=0.138.0');
  if (!(await F.gastosConectada())) throw new Error('Para crearla con su precio, conecta la base de Gastos y Finanzas en este equipo (Gastos → Configuración → Base nueva).');
  const doc = RM.docMp({ nombre, tipo, categoria: MA.categoriaExistente(datos.categoria, mps), unidad, area: sol.area }, { solicitud: sol.docId, por, hoy });
  const idN = await crearEnMps(db, mps, tipo, doc, (tx, id) => tx.set(refSol, resuelta(id), { merge: true }));
  await memoriaCon('mps', { [idN]: doc }).catch(() => M.olvidar('prod:mps@'));
  versionDatos++;
  try { await F.crearPrecioMp(idN, { nombre, tipo, unidadCompra: unidad, precioNeto: Number(datos.costoNeto) }); }
  catch (e) { const x = new Error(`Quedó creada (${idN}) y habilitada para ${AREAS[sol.area] || sol.area}, pero su precio no se guardó en Finanzas (${(e && e.message) || e}). Ponlo en Finanzas → Costos.`); x.code = 'sin_precio'; x.id = idN; throw x; }
  return idN;
}

// ═══════════════ v0.76.0 · Materias primas e insumos desde Finanzas → Costos ═══════════════
// Todas las de la base de Cocina (activas, inactivas, archivadas): para el nombre único, las parecidas y las categorías. De la memoria.
export async function materiasPrimas(forzar = false) { return mpsMem(forzar); }
// El nombre y el estado también en el maestro de costos (fen-gastos costos_mp), si está ahí (no crea uno sin precio)
async function sincronizarCostos(id, campos) {
  try { const F = await import('./finanzas.js?v=0.138.0'); if (await F.gastosConectada()) await F.datosMpEnCostos(id, campos); } catch (e) { console.warn('Finanzas: no se pudo copiar el cambio al maestro de costos', e); }
}
// Crear una materia prima o insumo: mps/{MP###|IN###} (como una pedida en Cocina) + su precio en costos_mp con historial.
// datos: los del formulario (mp-alta-modelo.js validarAlta). sii (opcional): la línea de factura de la que sale { rut, proveedor, folio,
// fecha, linea, nombreItem }; precioDeSii: el precio es el de esa compra (origen SII) o lo escribiste (origen "A mano").
// → { id, doc, v }. Si el precio no se guarda: error code 'sin_precio' (la materia prima quedó).
export async function crearMp(datos, { sii = null, precioDeSii = !!sii } = {}) {
  cambio('hoy:');
  const db = await dbOk(), por = authSF.currentUser.email, hoy = CM.hoyTxt(), en = new Date().toISOString();
  const mps = await mpsMem();
  const v = MA.validarAlta(datos, mps);
  const F = await import('./finanzas.js?v=0.138.0');
  if (!(await F.gastosConectada())) throw new Error('Para crearla con su precio, conecta la base de Gastos y Finanzas en este equipo (Gastos → Configuración → Base nueva).');
  const detalle = sii ? `Creada en Sistema Fën desde la compra del SII: ${sii.proveedor || sii.rut} F.${sii.folio} (${sii.nombreItem})` : 'Creada en Sistema Fën';
  const origen = { base: 'sistema-fen', manual: true, ...(sii ? { sii: { rut: String(sii.rut || ''), proveedor: String(sii.proveedor || ''), nombreItem: String(sii.nombreItem || '') } } : {}) };
  const doc = RM.docMp({ nombre: v.nombre, tipo: v.tipo, categoria: v.categoria || 'Sin categoría', unidad: v.unidad, areas: v.areas }, { por, hoy, origen,
    historial: [{ accion: 'creó', detalle: `${detalle} · ${MA.textoAreas(v.areas)}`, por, en }] });
  const id = await crearEnMps(db, mps, v.tipo, doc);
  await memoriaCon('mps', { [id]: doc }).catch(() => M.olvidar('prod:mps@'));
  versionDatos++;
  try { await F.crearPrecioMp(id, { nombre: v.nombre, tipo: v.tipo, unidadCompra: v.unidad, contenido: v.contenido, precioNeto: v.precioNeto, motivo: precioDeSii || !sii ? detalle : `${detalle} · precio escrito a mano`, creadaDesde: 'sistema-fen', sii: precioDeSii ? sii : null }); }
  catch (e) { const x = new Error(`Quedó creada (${id}), pero su precio no se guardó en Finanzas (${(e && e.message) || e}). Ponlo aquí mismo en su fila.`); x.code = 'sin_precio'; x.id = id; throw x; }
  return { id, doc, v };
}
// Cambiar nombre, categoría y áreas (mismo ID: las recetas no se rompen). Un cambio de nombre también pasa a la copia del nombre en las
// recetas que la usan (es solo la etiqueta: Cocina la muestra) y al maestro de costos. → { cambios, recetas: n } o null si nada cambió
export async function editarMp(id, datos) {
  cambio('hoy:');
  const db = await dbOk(), por = authSF.currentUser.email, en = new Date().toISOString();
  const [mps, recs] = await Promise.all([mpsMem(), recetasMem()]);
  const m = mps.find(x => x.id === id);
  const c = MA.cambioDatos(m, datos, mps, { por, en });
  if (!c) return null;
  // El historial se arma con el documento de ahora (1 lectura en la transacción), no con la memoria
  let final = null;
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'mps', id), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error(`La materia prima ${id} ya no está en la base de Cocina. Toca Actualizar.`);
    const actual = { id, ...sn.data() }, c2 = MA.cambioDatos(actual, datos, mps, { por, en }) || c;
    final = { ...actual, ...c2.patch };
    tx.update(ref, { ...c2.patch, actualizadoEn: FB.serverTimestamp() });
  });
  marcar('mps');
  const { id: _i, ...resto } = final;
  await memoriaCon('mps', { [id]: sinTs(resto) }).catch(() => M.olvidar('prod:mps@'));
  let n = 0;
  if (c.patch.nombre) {
    const cambios = MA.nombresEnRecetas(id, c.patch.nombre, recs), ids = Object.keys(cambios);
    for (let i = 0; i < ids.length; i += 400) {
      const b = FB.writeBatch(db);
      ids.slice(i, i + 400).forEach(r => b.update(FB.doc(db, 'recetas', r), cambios[r]));
      await b.commit();
    }
    if (ids.length) {
      const cR = {}; ids.forEach(r => { const x = recs.find(y => y.id === r); const { id: _r, ...rr } = x; cR[r] = { ...rr, ...cambios[r] }; });
      await memoriaCon('recetas', cR).catch(() => M.olvidar('prod:recetas@'));
    }
    n = ids.length;
    await sincronizarCostos(id, { nombre: c.patch.nombre });
  }
  versionDatos++;
  return { cambios: c.cambios, recetas: n };
}
// Archivar (estado 'archivada': no aparece en Cocina para elegir ni para pedir) o reactivar ('activa'). No se archiva si una receta viva
// la usa (error code 'en_uso' con datos.usos). Nada se borra. → { estado, antes } o null si ya estaba así
export async function archivarMp(id, archivar = true) {
  cambio('hoy:');
  const db = await dbOk(), por = authSF.currentUser.email, en = new Date().toISOString();
  const [mps, recs] = await Promise.all([mpsMem(), recetasMem()]);
  const m = mps.find(x => x.id === id);
  if (!MA.cambioEstado(m, archivar, recs, { por, en })) return null;
  let final = null, antes = '';
  await FB.runTransaction(db, async tx => {
    const ref = FB.doc(db, 'mps', id), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error(`La materia prima ${id} ya no está en la base de Cocina. Toca Actualizar.`);
    const actual = { id, ...sn.data() }, c = MA.cambioEstado(actual, archivar, recs, { por, en });
    antes = MA.estadoDe(actual);
    final = c ? { ...actual, ...c.patch } : actual;
    if (c) tx.update(ref, { ...c.patch, actualizadoEn: FB.serverTimestamp() });
  });
  marcar('mps');
  const { id: _i, ...resto } = final;
  await memoriaCon('mps', { [id]: sinTs(resto) }).catch(() => M.olvidar('prod:mps@'));
  await sincronizarCostos(id, { estado: archivar ? 'archivada' : 'activa' });
  versionDatos++;
  return { estado: MA.estadoDe(final), antes };
}
export async function rechazarSolicitud(sol, motivo) {
  cambio('hoy:pend');
  const db = await dbOk();
  await FB.setDoc(FB.doc(db, 'solicitudes', sol.docId), { estado: 'rechazada', motivo: String(motivo || '').slice(0, 300), resueltaPor: authSF.currentUser.email, resueltaEn: new Date().toISOString() }, { merge: true });
}

// ═══════════════ P4: mover recetas entre áreas ═══════════════
// Las que parecen de Pastelería vienen marcadas: sub recetas (preparaciones) clasificadas como relleno o con nombre
// de crema, ganache, glaseado… Un producto ("Croissant relleno") no se marca: es de Bollería. Tú eliges.
const PARECE_PAS = /relleno|crema|ganache|glase|glaseado|alm[ií]bar|pastelera|frangipane|caramelo|mermelada|dulce de leche|manjar|cobertura|merengue|chantilly|curd|coulis|ba[ñn]o/i;
export async function recetasDeArea(area) {
  return (await recetasMem()).filter(r => r.area === area && r.estado !== 'archivada').map(r => ({ ...r, sugerida: r.tipo === 'sub_receta' && r.clasificacion !== 'masa_base' && (r.clasificacion === 'relleno' || PARECE_PAS.test(r.nombre || '')) }))
    .sort((a, b) => (b.sugerida - a.sugerida) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}
// v0.73.0 (Etapa 1): mover recetas de área SOLO en la base de Cocina (mismo ID): recetas/{id}.area cambia (con movidaDesde, quién y
// cuándo) y la sub receta suma el área nueva en mps (sigue habilitada para las dos). La planilla ya no se escribe.
export async function moverRecetas(ids, desde = 'BOL', hacia = 'PAS') {
  cambio('hoy:alertas');
  const db = await dbOk(), por = authSF.currentUser.email, en = new Date().toISOString();
  const [recs, mps] = await Promise.all([recetasMem(), mpsMem()]);
  const movidas = [], saltadas = [], cR = {}, cM = {};
  const b = FB.writeBatch(db);
  [...new Set(ids || [])].forEach(id => {
    const r = recs.find(x => x.id === id);
    if (!r || r.area !== desde) { saltadas.push(id); return; }
    const { id: _a, ...resto } = r;
    cR[id] = { ...resto, area: hacia, movidaDesde: desde, movidaPor: por, movidaEn: en };
    b.update(FB.doc(db, 'recetas', id), { area: hacia, movidaDesde: desde, movidaPor: por, movidaEn: en });
    const sr = RM.srDe(id, r, mps);
    if (sr) { const { id: _b, ...m } = sr; cM[sr.id] = { ...m, areas: RM.conArea(sr, hacia) }; b.update(FB.doc(db, 'mps', sr.id), { areas: cM[sr.id].areas }); }
    movidas.push(id);
  });
  if (movidas.length) {
    await b.commit();
    await memoriaCon('recetas', cR).catch(() => M.olvidar('prod:recetas@'));
    if (Object.keys(cM).length) await memoriaCon('mps', cM).catch(() => M.olvidar('prod:mps@'));
    versionDatos++;
  }
  return { movidas, saltadas };
}


// ═══════════════ P4b: merma valorizada (Cocina la anota sin precios) ═══════════════
export const MOTIVOS = {
  derrame_error: 'Derrame o error', quemado: 'Quemado o mal horneado', vencimiento: 'Vencimiento',
  devolucion_cliente: 'Devolución de cliente', prueba_receta: 'Prueba de receta', regalo: 'Regalo o consumo interno', otro: 'Otro'
};
// v0.106.0 · Lo regalado o consumido (colaciones, regalos, degustaciones) no es merma: va en su propia línea del estado de resultados (5.8)
export const esRegalo = a => !!a && a.motivo === 'regalo';
const txtF = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const masDias = (t, n) => { const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() + n); return txtF(d); };
const lunesDe = t => { const d = new Date(t + 'T12:00:00'); return masDias(t, -((d.getDay() + 6) % 7)); };
const finDeMes = p => { const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)); return masDias(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1); };
export const PERIODOS_MERMA = { semana: 'Esta semana', semana_ant: 'Semana pasada', mes: 'Este mes', mes_ant: 'Mes pasado' };
export function periodoMerma(clave, hoy = txtF(new Date())) {
  if (clave === 'semana_ant') { const l = masDias(lunesDe(hoy), -7); return { desde: l, hasta: masDias(l, 6) }; }
  if (clave === 'mes') { const p = hoy.slice(0, 8) + '01'; return { desde: p, hasta: finDeMes(p) }; }
  if (clave === 'mes_ant') { const p = masDias(hoy.slice(0, 8) + '01', -1).slice(0, 8) + '01'; return { desde: p, hasta: finDeMes(p) }; }
  const l = lunesDe(hoy); return { desde: l, hasta: masDias(l, 6) };
}
// Lo anotado en el período (sin anuladas) y su costo por unidad (script: Maestro_recetas y MP_maestro)
// v0.63.3: Finanzas usa los días en memoria (la bodega ya leyó 120 días) o lee solo ese período (por fecha); Producción → Merma
// (fresco: true, lo pides tú) vuelve a leer el período
export async function mermaDelPeriodo({ desde, hasta, fresco = false }) {
  const sn = await diasEntre(desde, hasta, fresco);
  const merma = [], cafe = [];
  sn.forEach(x => {
    Object.entries(x.merma || {}).forEach(([id, a]) => { if (a && !a.anulado) merma.push({ ...a, id, fecha: x.fecha, area: x.area }); });
    Object.entries(x.turno || {}).forEach(([id, a]) => { if (a && !a.anulado) cafe.push({ ...a, id, fecha: x.fecha, area: x.area }); });
  });
  // v0.54.0: la calibración diaria de Cafetería (automática los días con venta en la caja, o la editada en Cocina)
  let cfgCaf = {}, diasVentaCaf = null;
  try { cfgCaf = (await configMem()).CAF || {}; } catch (e) {}
  try { diasVentaCaf = (await ventasCafeteria(desde, [], fresco)).diasVenta; } catch (e) { diasVentaCaf = null; }
  const diasCaf = {}; sn.forEach(x => { if (x.area === 'CAF' && x.fecha) diasCaf[x.fecha] = x; });
  const calibraciones = K.calibracionesDiarias({ config: { CAF: cfgCaf }, dias: { CAF: diasCaf }, diasVentaCaf: diasVentaCaf || undefined, hoy: CM.hoyTxt(), desde }, desde, hasta);
  const mpCafe = cfgCaf.mp_cafe || '';
  // v0.58.0 · v0.75.1: con el motor de costeo de Finanzas (costos_mp de fen-gastos), y nada más (sin la planilla)
  const k3 = a => (a.tipo === 'mp' ? 'mp' : 'receta') + ':' + a.item + ':' + (a.unidad || 'un');
  const items = [...new Set(merma.map(k3))].map(k => { const [tipo, ...r] = k.split(':'); const unidad = r.pop(); return { tipo, id: r.join(':'), unidad }; });
  if (mpCafe && (calibraciones.length || cafe.length)) items.push({ tipo: 'mp', id: mpCafe, unidad: 'g' });
  let costosMotor = null;
  if (items.length) { try { costosMotor = await (await import('./finanzas.js?v=0.138.0')).costosMerma(items); } catch (e) { console.warn('Merma: sin el motor de costeo', e); costosMotor = null; } }
  // v0.75.1: ya no se piden a la planilla los costos que el motor no tiene (op costos_merma): quedan sin costo o incompletos
  const costos = {}, errorCostos = '';
  return { desde, hasta, merma, cafe, costos, costosMotor, errorCostos, calibraciones, mpCafe };
}
// v0.58.0 · v0.75.1: costo neto por unidad de un ítem, SOLO con el motor de costeo de Finanzas (costos_mp): completo o, si le falta
// algo, el del motor marcado incompleto. Ya no hay respaldo con los costos de la planilla. → { neto, fuente: 'motor'|'incompleto' } | null
export function costoMermaItem(datos, tipo, id, unidad) {
  const m = (datos.costosMotor || {})[`${tipo}:${id}:${unidad || 'un'}`];
  if (m && !m.incompleto) return { neto: m.neto, fuente: 'motor' };
  if (m) return { neto: m.neto, fuente: 'incompleto' };
  return null;
}
// Por área: ítems sumados con su costo neto (null si no hay precio), total, y por motivo
export function resumenMerma(datos) {
  const areas = {};
  (datos.merma || []).forEach(a => {
    const ar = areas[a.area] || (areas[a.area] = { area: a.area, items: {}, total: 0, sinCosto: 0, motivos: {} });
    const tipo = a.tipo === 'mp' ? 'mp' : 'receta', k = tipo + ':' + a.item + ':' + a.unidad + (a.derramado ? ':derramado' : '') + (esRegalo(a) ? ':regalo' : '');
    const c = costoMermaItem(datos, tipo, a.item, a.unidad), neto = c ? Number(a.cantidad) * c.neto : null;
    const it = ar.items[k] || (ar.items[k] = { nombre: a.nombre, tipo, unidad: a.unidad, cantidad: 0, neto: 0, sinCosto: false, motivos: {}, derramado: !!a.derramado, regalo: esRegalo(a), planilla: false, incompleto: false });
    if (c && c.fuente === 'planilla') { it.planilla = true; ar.planilla = (ar.planilla || 0) + 1; }
    if (c && c.fuente === 'incompleto') it.incompleto = true;
    it.cantidad += Number(a.cantidad) || 0;
    it.motivos[a.motivo] = (it.motivos[a.motivo] || 0) + 1;
    if (neto === null) { it.sinCosto = true; ar.sinCosto++; } else { it.neto += neto; ar.total += neto; ar.motivos[a.motivo] = (ar.motivos[a.motivo] || 0) + neto; }
  });
  const lista = Object.values(areas).map(a => ({ ...a, items: Object.values(a.items).sort((x, y) => (y.neto || 0) - (x.neto || 0) || x.nombre.localeCompare(y.nombre, 'es')) }))
    .sort((a, b) => Object.keys(AREAS).indexOf(a.area) - Object.keys(AREAS).indexOf(b.area));
  const cafe = { calibracion: 0, merma: 0, prueba_receta: 0, total: 0 };
  (datos.cafe || []).forEach(a => { const g = Number(a.gramos) || 0; if (a.tipo in cafe) cafe[a.tipo] += g; cafe.total += g; });
  // v0.54.0: calibración diaria (por día: automática o editada), valorizada con el costo neto del café (por gramo)
  // v0.58.0: el café se valoriza con el precio de la materia prima café (motor de Finanzas; v0.75.1: sin la planilla)
  const cal = datos.calibraciones || [], cc = datos.mpCafe ? costoMermaItem(datos, 'mp', datos.mpCafe, 'g') : null;
  const gCal = cal.reduce((s, x) => s + x.gramos, 0), gBit = cafe.total;
  cafe.calibracionDiaria = { dias: cal.map(x => ({ fecha: x.fecha, shots: x.shots, gramos: x.gramos, auto: x.auto })), shots: cal.reduce((s, x) => s + x.shots, 0), gramos: gCal,
    editados: cal.filter(x => !x.auto).length, neto: cc ? gCal * cc.neto : null };
  cafe.total += gCal;
  cafe.porGramo = cc ? cc.neto : null; cafe.fuente = cc ? cc.fuente : '';
  cafe.netoBitacora = cc ? gBit * cc.neto : null; cafe.netoTotal = cc ? cafe.total * cc.neto : null;
  return { areas: lista, total: lista.reduce((s, a) => s + a.total, 0), cafe };
}


// v0.62.0 · Cierre de mes (Finanzas): los conteos de bodega anotados entre dos fechas, por bodega (Producción, Cafetería).
// Solo lectura de dias/{AREA}_{fecha}.bodega (tipo 'conteo', sin anulados; la bodega como la calcula Cocina).
// → { bodegas: ['PROD', 'CAF'], nombres: { PROD: 'Producción', … }, porBodega: { PROD: [fechas] } }
export async function conteosEntre(desde, hasta) {
  const [sn, cfg] = await Promise.all([diasEntre(desde, hasta), configMem().catch(() => ({}))]);
  const mapa = K.mapaBodegas(cfg.bodegas || undefined), bodegas = K.listaBodegas(mapa), dias = {};
  sn.forEach(x => { if (x.area && x.fecha && x.fecha >= desde && x.fecha <= hasta) (dias[x.area] || (dias[x.area] = {}))[x.fecha] = x; });
  const porBodega = {};
  K.movimientos(dias, mapa).filter(m => m.tipo === 'conteo').forEach(m => { (porBodega[m.bodega] || (porBodega[m.bodega] = [])).push(m.fecha); });
  return { bodegas, nombres: Object.fromEntries(bodegas.map(b => [b, K.nombreBodega(b, mapa)])), porBodega };
}

// ═══════════════ v0.71.1 · Plan de Panadería (solo lectura) ═══════════════
// Recetas, materias primas, configuración, ajustes de harina/agua, planes desde el lunes de "desde" y los días de Panadería entre
// las dos fechas (lo hecho). Todo con la memoria de siempre: lo que ya leyó la bodega, Merma o Finanzas no se vuelve a leer.
// Los planes: si ya hay en memoria una lectura de planes desde un lunes anterior (la bodega lee 120 días), se usa esa.
export async function datosPlanPan(desde, hasta) {
  const lunes = CM.lunesDe(desde);
  const planes = () => M.buscar('prod:planes:>=', k => k <= lunes) || M.memo('prod:planes:>=' + lunes, () => leerCol('planes', FB.where('lunes', '>=', lunes)));
  const [recetas, mps, config, ajustes, pl, dias] = await Promise.all([recetasMem(), mpsMem(), configMem(), M.memo('prod:ajustes', () => leerCol('ajustes')), planes(), diasEntre(desde, hasta)]);
  return { recetas, mps, config, ajustes, planes: pl.filter(p => p.area === 'PAN' && p.lunes >= lunes), dias: dias.filter(d => d.area === 'PAN') };
}

// ═══════════════ P5: Bodega (materias primas críticas, bodega común) ═══════════════
// Lee lo necesario de la base nueva (120 días de Cocina, planes, metas, ajustes, recetas, materias primas), calcula
// con cocina/consumo.js (el mismo cálculo de Cocina) y deja en stockmp/{id}.estado lo que ven las jefas.
export const DIAS_BODEGA = 120;
// v0.63.3: calcular (Hoy cuando el último cálculo tiene más de 6 horas, o "Calcular" en Producción → Bodega) siempre vuelve a leer
// (fresco) y deja lo leído en la memoria compartida: Finanzas, Merma y los avisos de Hoy lo usan después sin leer de nuevo.
export async function calcularBodega({ guardar = true, hoy = CM.hoyTxt(), fresco = true, desdeAlertas = false } = {}) {
  const db = await dbOk();
  const desde = CM.sumarDias(hoy, -DIAS_BODEGA), lunes = CM.lunesDe(hoy);
  const sinIdDe = ({ id, ...d }) => d, forzar = !!fresco;
  const [rs, ms, cf, aj, sm, ds, pl, mt] = await Promise.all([
    recetasMem(forzar), mpsMem(forzar), configMem(forzar),
    M.memo('prod:ajustes', () => leerCol('ajustes'), { forzar }), stockmpMem(forzar),
    diasDesde(desde, forzar),
    M.memo('prod:planes:>=' + CM.lunesDe(desde), () => leerCol('planes', FB.where('lunes', '>=', CM.lunesDe(desde))), { forzar }),   // Panadería toma del plan la cantidad de lo hecho
    M.memo('prod:metas:>=' + lunes, () => leerCol('metas', FB.where('lunes', '>=', lunes)), { forzar })
  ]);
  const datos = { recetas: rs, mps: ms, config: { ...cf }, ajustes: {}, dias: {}, planes: {}, metas: {}, hoy };
  aj.forEach(x => { const a = sinIdDe(x); (datos.ajustes[a.area] || (datos.ajustes[a.area] = {}))[a.recetaId] = a; });
  ds.forEach(x => { if (x.area && x.fecha) (datos.dias[x.area] || (datos.dias[x.area] = {}))[x.fecha] = sinIdDe(x); });
  pl.forEach(x => { datos.planes[x.id] = sinIdDe(x); });
  mt.forEach(x => { datos.metas[x.id] = sinIdDe(x); });
  const control = {}; sm.forEach(x => { control[x.id] = sinIdDe(x); });
  datos.stockmp = control;   // v0.65.0: la ruta del consumo (bodega responsable) mira qué es crítico dónde
  // Cafetería: lo vendido en la caja (fen-ventas) y los días con venta (calibración diaria automática)
  let cafe = { ventas: [], sinReceta: {}, diasVenta: [], error: '' };
  try { cafe = await ventasCafeteria(desde, datos.recetas, forzar); } catch (e) { cafe.error = e.message || String(e); }
  datos.ventas = cafe.ventas;
  if (!cafe.error) datos.diasVentaCaf = cafe.diasVenta;
  const { eventos, sinId } = K.consumo(datos);
  // v0.54.0: por bodega (Producción y Cafetería): críticas, movimientos, consumo y proyección de cada una
  const mapa = K.mapaBodegas(datos.config.bodegas), bodegas = K.listaBodegas(mapa);
  const movs = K.movimientos(datos.dias, mapa);
  // v0.65.0: con responsables, PAN, BOL, PAS y CAF (K.puestos: cada crítica en su bodega, con el documento donde vive)
  const ps = K.puestos(datos.mps, control, mapa);
  const orden = (a, b) => (b.bajoAhora - a.bajoAhora) || ((a.bajoDesde || '9') < (b.bajoDesde || '9') ? -1 : (a.bajoDesde || '9') > (b.bajoDesde || '9') ? 1 : 0) || a.mp.nombre.localeCompare(b.mp.nombre, 'es');
  const porBodega = {}, proys = {};
  bodegas.forEach(bod => {
    const proy = proys[bod] = K.proyeccion(datos, CM.sumarDias(hoy, 1), 7, eventos, bod);   // desde mañana: lo de hoy se descuenta al marcarlo hecho
    porBodega[bod] = ps.filter(p => p.bodega === bod)
      .map(p => ({ ...K.estado(p.mp, p.cfg, K.stock(p.mp.id, movs, eventos, bod), proy), bodega: bod, docId: p.docId }))
      .sort(orden);
  });
  const criticas = bodegas.flatMap(b => porBodega[b]);
  const proy = proys[K.BODEGA_PRINCIPAL] || proys[bodegas[0]];
  // v0.65.0: avisos de la configuración (críticas en dos bodegas de producción; críticas sin responsable elegida) y la propuesta
  const repetidas = K.esResponsable(mapa) ? K.repetidasProd(ps, mapa) : [];
  const sinResponsable = K.esResponsable(mapa) ? ps.filter(p => p.docId === p.mp.id && K.esProduccion(p.bodega, mapa) && !K.tieneResponsable(p.mp.id, mapa)).map(p => p.mp.id) : [];
  const propuesta = propuestaResponsables({ datos, eventos, ps, mapa });
  const en = new Date().toISOString();
  if (guardar && criticas.length) {
    const b = FB.writeBatch(db);
    criticas.forEach(e => b.set(FB.doc(db, 'stockmp', e.docId), { ...(e.docId !== e.mp.id ? { bodega: e.bodega, mp: e.mp.id } : {}), estado: {
      contado: e.st.contado, stock: e.st.contado ? Math.round(e.st.stock) : null, alcanza: e.alcanza === null ? null : Math.round(e.alcanza * 10) / 10,
      bajoAhora: !!e.bajoAhora, bajoDesde: e.bajoDesde || null, minimo: Math.round(e.cfg.seguridad), en } }, { merge: true }));
    await b.commit();
    // v0.63.3: el estado recién guardado se lee de nuevo la próxima vez; los avisos de Hoy se vuelven a armar con él
    M.olvidar('prod:stockmp', ...(desdeAlertas ? [] : ['prod:hoy:alertas']));
    // Bajo el mínimo ahora: correo (uno por día, bodega y materia prima; el script no repite)
    avisarBajos(criticas.filter(e => e.st.contado && e.bajoAhora).map(e => ({ bodega: e.bodega, mp: e.mp.id, nombre: e.mp.nombre, unidad: e.cfg.unidad, hay: e.st.stock, minimo: e.cfg.seguridad, bajoAhora: true })), mapa).catch(() => {});
  }
  // Llegadas anotadas aquí que todavía no pasan a la planilla (si el script falló al anotarlas)
  const pendientes = Object.entries((datos.dias.ADM) || {}).flatMap(([fecha, d]) => Object.entries(d.bodega || {}).filter(([, b]) => b && !b.planilla).map(([id, b]) => ({ ...b, id, fecha })));
  if (pendientes.length) pasarLlegadasAdm(db, pendientes).catch(() => {});
  return { hoy, desde, datos, control, eventos, movs, proy, proys, criticas, porBodega, bodegas, mapa, sinId, en, cafe, repetidas, sinResponsable, propuesta };
}
// v0.65.0 · "Asignar responsables": las críticas de producción (sin confirmar: las de PROD) con el uso por área (lo consumido en
// los 120 días leídos; si no hay, las recetas) y la propuesta. Sin lecturas: usa lo ya calculado.
// → [{ mp, uso: { PAN, BOL, PAS } (g, ml o un), pct, fuente: 'consumo' | 'recetas' | '', propuesta, motivo, actual }]
export function propuestaResponsables({ datos, eventos, ps, mapa }) {
  const u = K.usoPorArea(eventos, datos), vistos = new Set(), out = [];
  (ps || []).filter(p => K.esProduccion(p.bodega, mapa) && p.docId === p.mp.id).forEach(p => {
    if (vistos.has(p.mp.id)) return; vistos.add(p.mp.id);
    const x = u.de(p.mp.id), pr = K.proponerResponsable(p.mp, x.uso);
    out.push({ mp: p.mp, uso: x.uso, fuente: x.fuente, ...pr, actual: K.tieneResponsable(p.mp.id, mapa) ? mapa.responsables[p.mp.id] : '' });
  });
  return out.sort((a, b) => a.mp.nombre.localeCompare(b.mp.nombre, 'es'));
}
// Lo vendido desde "desde": los resúmenes de cada cierre (un día por caja) y, de las cajas abiertas, sus ventas
// (con su hora). Cada línea va con la receta vinculada al producto en la caja (idRecetaFen); las de Cafetería
// que no tienen receta se avisan (no descuentan).
const esCafeteriaCaja = a => /^(caf|cafeter)/i.test(String(a || ''));
// v0.63.3: lo leído de la caja (fen-ventas) queda 10 minutos en memoria; una lectura desde una fecha anterior sirve para otra posterior
async function cajaDesde(desde, forzar = false) {
  const ya = !forzar && M.buscar('caja:cafe:', d => d <= desde);
  if (ya) return { ...ya, res: ya.res.filter(r => r.fecha >= desde) };
  return M.memo('caja:cafe:' + desde, async () => {
    const [prods, res, abiertas] = await Promise.all([
      getDocsSF(colSF(dbSF, 'productos')),
      getDocsSF(querySF(colSF(dbSF, 'resumenes_caja'), whereSF('fecha', '>=', desde))),
      getDocsSF(querySF(colSF(dbSF, 'cajas'), whereSF('estado', '==', 'abierta')))
    ]);
    const ventas = {};
    for (const c of abiertas.docs) ventas[c.id] = (await getDocsSF(querySF(colSF(dbSF, 'ventas'), whereSF('cajaId', '==', c.id)))).docs.map(x => x.data());
    return { prods: prods.docs.map(d => ({ id: d.id, ...d.data() })), res: res.docs.map(d => ({ id: d.id, ...d.data() })), abiertas: abiertas.docs.map(d => d.id), ventas };
  }, { forzar });
}
export async function ventasCafeteria(desde, recetas, fresco = false) {
  const raw = await cajaDesde(desde, fresco);
  const prod = {}; raw.prods.forEach(d => { prod[d.id] = d; });
  const deCaf = new Set((recetas || []).filter(r => r.area === 'CAF').map(r => r.id));
  const ventas = [], sinReceta = {}, conResumen = new Set(), diasVenta = new Set();
  // v0.54.0: días con venta de Cafetería (también de productos sin receta vinculada): la calibración diaria automática
  const deCafeteria = (rid, area) => (rid && deCaf.has(rid)) || esCafeteriaCaja(area);
  const linea = (fecha, en, pid, nombre, area, cantidad) => {
    const rid = (prod[pid] && prod[pid].idRecetaFen) || '';
    if (cantidad > 0 && deCafeteria(rid, area || (prod[pid] && prod[pid].area))) diasVenta.add(fecha);
    if (rid) { if (deCaf.has(rid)) ventas.push({ fecha, en, receta: rid, cantidad }); return; }
    if (esCafeteriaCaja(area || (prod[pid] && prod[pid].area))) sinReceta[nombre || pid] = (sinReceta[nombre || pid] || 0) + cantidad;
  };
  raw.res.forEach(d => {
    const r = d; if (!r.fecha) return;
    conResumen.add(r.cajaId || d.id);
    const en = new Date(r.fecha + 'T23:59:00').toISOString();   // un cierre cuenta al final de su día
    Object.entries(r.porProducto || {}).forEach(([pid, pp]) => {
      const rid = pp.idRecetaFen || (prod[pid] && prod[pid].idRecetaFen) || '';
      if ((Number(pp.cantidad) || 0) > 0 && deCafeteria(rid, pp.area || (prod[pid] && prod[pid].area))) diasVenta.add(r.fecha);
      if (rid) { if (deCaf.has(rid)) ventas.push({ fecha: r.fecha, en, receta: rid, cantidad: Number(pp.cantidad) || 0 }); }
      else if (esCafeteriaCaja(pp.area)) sinReceta[pp.nombre || pid] = (sinReceta[pp.nombre || pid] || 0) + (Number(pp.cantidad) || 0);
    });
  });
  for (const id of raw.abiertas) {
    if (conResumen.has(id)) continue;
    (raw.ventas[id] || []).forEach(v => {
      if (v.anulada === true) return;
      const t = v.fecha && v.fecha.toDate ? v.fecha.toDate() : null; if (!t) return;
      const fecha = CM.hoyTxt(t); if (fecha < desde) return;
      (v.lineas || []).forEach(l => linea(fecha, t.toISOString(), l.id, l.nombre, null, parseFloat(l.cantidad) || 0));
    });
  }
  return { ventas, sinReceta, diasVenta: [...diasVenta].sort(), error: '' };
}
// De qué materia prima sale el café de la bitácora de turno de Cafetería (config/CAF.mp_cafe)
export async function guardarMpCafe(mpId) { await guardarConfigArea('CAF', { mp_cafe: mpId || null }); }
// Las llegadas de Sistema Fën pasan a MP_stock_movimientos con el script (sin duplicar); quedan marcadas al pasar
async function pasarLlegadasAdm(db, lista) {
  const r = await script('bodega_adm', { movimientos: lista.map(b => ({ id: b.id, fecha: b.fecha, mp: b.mp, nombre: b.nombre, tipo: b.tipo, bodega: b.bodega || K.BODEGA_PRINCIPAL, cantidad: b.cantidad, unidad: b.unidad, nota: b.nota || '', por: b.por || '', anulado: !!b.anulado })) }, VERSION_BODEGA);
  const porDia = {}; lista.filter(b => (r.ids || []).includes(b.id)).forEach(b => { (porDia[b.fecha] || (porDia[b.fecha] = {}))[b.id] = { planilla: true }; });
  await Promise.all(Object.entries(porDia).map(([fecha, bod]) => FB.setDoc(FB.doc(db, 'dias', 'ADM_' + fecha), { bodega: bod, actualizado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true })));
  if (Object.keys(porDia).length) { M.olvidar('prod:dias:'); if (diasInc) diasInc.revisado = 0; }
}
// Consumo de un período por materia prima y área (todas las materias primas, no solo las críticas)
export function consumoPeriodo(calc, { desde, hasta }) {
  const t = K.porMp(calc.eventos.filter(e => e.fecha >= desde && e.fecha <= hasta));
  // Sin la materia prima en el maestro: el nombre con que aparece en las recetas
  const deReceta = id => { for (const r of calc.datos.recetas) { const i = [...(r.ingredientes || []), ...(r.insumos || [])].find(x => x.id === id); if (i && i.nombre) return i.nombre + ' (no está en el maestro)'; } return id; };
  return Object.entries(t).map(([id, x]) => { const m = calc.datos.mps.find(y => y.id === id); return { id, nombre: m ? m.nombre : deReceta(id), unidad: m ? K.unidadMp(m) : 'g', ...x }; })
    .sort((a, b) => b.total - a.total);
}
// Crítica y mínimo de una materia prima (seguridad en g, ml o un)
// envase: { nombre: 'saco', tamano: 25000 (g, ml o un) } o null (se cuenta en kg, l o un)
// v0.54.0: bodega = 'PROD' (stockmp/{mpId}, como siempre) o 'CAF' (stockmp/CAF__{mpId})
// v0.65.0: con responsables, en la bodega responsable de esa materia prima va en stockmp/{mpId} (el de siempre); en otra, {BODEGA}__{mpId}
const datosControl = ({ critica, seguridad, envase }) => {
  const datos = { critica: !!critica, seguridad: Math.max(0, Number(seguridad) || 0), editado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } };
  if (envase !== undefined) datos.envase = envase && String(envase.nombre || '').trim() && Number(envase.tamano) > 0 ? { nombre: String(envase.nombre).trim().slice(0, 20), tamano: Number(envase.tamano) } : null;
  return datos;
};
export async function guardarControl(mpId, x, bodega = K.BODEGA_PRINCIPAL) {
  const db = await dbOk(), datos = datosControl(x), mapa = K.mapaBodegas((await configMem()).bodegas || null), id = K.idStockEn(bodega, mpId, mapa);
  if (id !== String(mpId)) Object.assign(datos, { bodega, mp: mpId });
  await FB.setDoc(FB.doc(db, 'stockmp', id), datos, { merge: true });
  cambio('stockmp', 'hoy:alertas');
}
// "Pasar a Cafetería" (una vez, para las que hoy son críticas en Producción solo por Cafetería): copia crítica, mínimo y
// envase a la bodega de Cafetería. quitar = true además las deja de seguir en Producción (critica: false). No se borra
// nada: los conteos y llegadas de antes quedan en Producción; en Cafetería se parte con un conteo.
export async function pasarABodega(mpIds, hacia = 'CAF', { quitar = false } = {}) {
  const db = await dbOk(), sn = await FB.getDocs(FB.collection(db, 'stockmp')), ms = await FB.getDocs(FB.collection(db, 'mps'));
  const sm = {}; sn.docs.forEach(d => { sm[d.id] = d.data(); });
  const mps = {}; ms.docs.forEach(d => { mps[d.id] = { id: d.id, ...d.data() }; });
  const b = FB.writeBatch(db), por = authSF.currentUser.email, hechos = [];
  [...new Set(mpIds || [])].forEach(id => {
    const m = mps[id]; if (!m) return;
    const c = K.control(m, sm[id]);
    b.set(FB.doc(db, 'stockmp', K.idStock(hacia, id)), { bodega: hacia, mp: id, critica: true, seguridad: c.seguridad, envase: c.envase || null,
      copiadoDe: { bodega: K.BODEGA_PRINCIPAL, por, en: new Date().toISOString() }, editado: { por, en: FB.serverTimestamp() } }, { merge: true });
    if (quitar) b.set(FB.doc(db, 'stockmp', id), { critica: false, seguridad: c.seguridad, pasadaA: hacia, editado: { por, en: FB.serverTimestamp() } }, { merge: true });
    hechos.push(id);
  });
  if (hechos.length) await b.commit();
  cambio('stockmp', 'hoy:alertas');
  return hechos;
}
// El mapa de bodegas (config/bodegas): qué área usa qué bodega. Vacío = lo de siempre.
export async function guardarMapaBodegas(areas, nombres) {
  const db = await dbOk();
  await FB.setDoc(FB.doc(db, 'config', 'bodegas'), { areas, nombres, editado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true });
  cambio('config', 'hoy:alertas');
}
// v0.65.0 · Bodegas por área responsable. cambios = { mpId: 'PAN' | 'BOL' | 'PAS' }. confirmar = true la primera vez (pantalla
// "Asignar responsables"): pasa a modo 'responsable' con el mapa PAN→PAN, BOL→BOL, PAS→PAS, CAF→CAF. Nada se copia ni se borra:
// el stock, los conteos y las llegadas siguen en stockmp/{mpId} y conteosmp/{mpId}; solo cambia de qué bodega es.
// Queda la historia (config/bodegas.historial, las últimas 200 vueltas: { en, por, cambios: { mpId: [antes, ahora] } }).
export async function guardarResponsables(cambios, { confirmar = false } = {}) {
  const db = await dbOk(), por = authSF.currentUser.email, en = new Date().toISOString();
  const ref = FB.doc(db, 'config', 'bodegas'), sn = await FB.getDoc(ref), act = sn.exists() ? sn.data() : {};
  const antes = { ...(act.responsables || {}) }, nuevos = { ...antes }, hechos = {};
  if (!confirmar && act.modo !== K.MODO_RESP) throw new Error('Primero confirma los responsables (Asignar responsables).');
  Object.entries(cambios || {}).forEach(([mp, b]) => {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(mp) || /__/.test(mp) || !K.AREAS_PROD.includes(b)) return;
    if (antes[mp] !== b) hechos[mp] = [antes[mp] || (act.modo === K.MODO_RESP ? 'PAN' : 'PROD'), b];
    nuevos[mp] = b;
  });
  if (!Object.keys(hechos).length && (!confirmar || act.modo === K.MODO_RESP)) return { cambios: 0 };
  const primera = act.modo !== K.MODO_RESP;
  const historial = [...(Array.isArray(act.historial) ? act.historial : []), { en, por, cambios: hechos, ...(primera ? { confirmado: true } : {}) }].slice(-200);
  const datos = { modo: K.MODO_RESP, responsables: nuevos, historial, editado: { por, en: FB.serverTimestamp() } };
  if (primera) Object.assign(datos, { areas: { ...K.AREA_BODEGA_RESP }, nombres: { ...K.BODEGAS_RESP }, confirmado: { por, en }, antes: { areas: act.areas || null, nombres: act.nombres || null } });
  await FB.setDoc(ref, datos, { merge: true });
  cambio('config', 'stockmp', 'hoy:alertas');
  return { cambios: Object.keys(hechos).length };
}
// Llegada desde Sistema Fën (va al día de Administración: dias/ADM_{fecha}), a la bodega elegida
export async function registrarLlegada(mp, cantidadBase, nota, bodega = K.BODEGA_PRINCIPAL) {
  const db = await dbOk(), hoy = CM.hoyTxt(), id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (!(Number(cantidadBase) > 0)) throw new Error('La cantidad tiene que ser mayor que 0.');
  const mapa = K.mapaBodegas((await configMem()).bodegas || null);
  const b = { tipo: 'llegada', mp: mp.id, nombre: mp.nombre, bodega, ...(K.esResponsable(mapa) ? { stock: K.idStockEn(bodega, mp.id, mapa) } : {}), cantidad: Math.round(Number(cantidadBase) * 100) / 100, unidad: K.unidadMp(mp), nota: String(nota || '').slice(0, 120), por: authSF.currentUser.email, en: new Date().toISOString() };
  await FB.setDoc(FB.doc(db, 'dias', 'ADM_' + hoy), { area: 'ADM', fecha: hoy, bodega: { [id]: b }, actualizado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true });
  cambio('dias:', 'hoy:alertas'); if (diasInc) diasInc.revisado = 0;
  try { await pasarLlegadasAdm(db, [{ ...b, id, fecha: hoy }]); } catch (e) {}   // si falla, se reintenta al calcular la bodega
}
// v0.133.0 · Las facturas de las críticas entran solas a la bodega (bodega-facturas.js). Lee las compras de Finanzas (30 minutos en
// memoria) y la bodega; anota lo que falta en dias/ADM_{fecha de la factura} con id fijo (no repite, no revive lo anulado).
// → { compras, facturas, sinAsociar, creadas, criticas, mps } · null si Producción no está conectada
export async function facturasBodega({ forzar = false, anotar = true } = {}) {
  const cx = await conexion(); if (cx.estado !== 'ok') return null;
  const Fin = await import('./finanzas.js?v=0.138.0');
  const [c, C] = await Promise.all([calcularBodega({ guardar: false, fresco: !!forzar }), M.memo('prod:fac:compras', () => Fin.leerCompras(), { ttl: 30 * 60000, forzar })]);
  const crit = c.criticas || [], compras = BF.comprasCriticas(C.lineas, C.asocs, crit);
  let anotadas = BF.yaAnotadas((c.datos.dias || {}).ADM), creadas = 0;
  const faltan = anotar ? BF.porAnotar(compras, anotadas, { desde: c.desde }) : [];
  if (faltan.length) {
    const db = await dbOk(), conStock = K.esResponsable(c.mapa), porDia = {};
    faltan.forEach(x => { (porDia[x.fecha] || (porDia[x.fecha] = {}))[x.id] = BF.llegadaDe(x, { conStock }); });
    await Promise.all(Object.entries(porDia).map(([fecha, bod]) => FB.setDoc(FB.doc(db, 'dias', 'ADM_' + fecha), { area: 'ADM', fecha, bodega: bod, actualizado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true })));
    creadas = faltan.length;
    Object.entries(porDia).forEach(([fecha, bod]) => Object.entries(bod).forEach(([id, b]) => { anotadas[id] = { fecha, b }; }));
    cambio('dias:', 'hoy:alertas'); if (diasInc) diasInc.revisado = 0;
  }
  const FSii = await import('./finanzas-sii.js?v=0.138.0');
  const sinAs = BF.sinAsociar(C.lineas, C.asocs, crit).map(x => ({ ...x, sug: FSii.contenidoDeLinea(x.descripcion, x.unidad) }));
  return { compras, facturas: BF.porFactura(compras, anotadas), sinAsociar: sinAs, creadas, criticas: crit, costos: C.costos,
    repetidas: BF.manualesRepetidas(c.movs, compras) };
}
// Anular las llegadas anotadas a mano que se repiten con las facturas (quedan anuladas, con quién y por qué; nada se borra)
export async function anularManuales(lista) {
  const db = await dbOk(), por = authSF.currentUser.email, porDoc = {};
  (lista || []).forEach(m => { const k = `${m.area}_${m.fecha}`; (porDoc[k] || (porDoc[k] = {}))[m.id] = { anulado: true, anulacion: { por, en: new Date().toISOString(), motivo: 'Se repite con la factura (las llegadas entran desde las facturas)' } }; });
  await Promise.all(Object.entries(porDoc).map(([k, bod]) => FB.setDoc(FB.doc(db, 'dias', k), { bodega: bod, actualizado: { por, en: FB.serverTimestamp() } }, { merge: true })));
  cambio('dias:', 'hoy:alertas'); if (diasInc) diasInc.revisado = 0;
}
// La fecha en que llegó una factura (si no es la de la factura): cambia la hora de sus llegadas; el stock se recalcula solo
export async function recepcionFactura(lineas, fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('Elija la fecha en que llegó.');
  if (fecha > CM.hoyTxt()) throw new Error('La fecha de llegada no puede ser futura.');
  const db = await dbOk(), porDia = {};
  (lineas || []).filter(l => l.estado === 'entro').forEach(l => { (porDia[l.fecha] || (porDia[l.fecha] = {}))[l.id] = { en: BF.enDeRecepcion(fecha), recepcion: fecha }; });
  if (!Object.keys(porDia).length) throw new Error('Esta factura todavía no entró a la bodega.');
  await Promise.all(Object.entries(porDia).map(([f, bod]) => FB.setDoc(FB.doc(db, 'dias', 'ADM_' + f), { bodega: bod, actualizado: { por: authSF.currentUser.email, en: FB.serverTimestamp() } }, { merge: true })));
  cambio('dias:', 'hoy:alertas'); if (diasInc) diasInc.revisado = 0;
}
// Asociar un producto de factura a una crítica (lo mismo que Finanzas → Costos → Compras del SII) y revisar los precios
export async function asociarFactura(x, { mp, contenido, ignorar = false }) {
  const Fin = await import('./finanzas.js?v=0.138.0');
  await Fin.guardarAsociacion(x.clave, { rut: x.rut, proveedor: x.proveedor, nombreItem: x.descripcion, codigo: x.codigo, ignorar, mp: ignorar ? '' : mp, contenido, nota: 'Desde Producción → Bodega' });
  M.olvidar('prod:fac:compras');
  try { return await Fin.preciosDesdeSii({ origen: 'asociacion' }); } catch (e) { return null; }
}
// Para Hoy: lo que está o queda bajo el mínimo, por bodega. Usa el último cálculo si es de las últimas 6 horas; si no, calcula.
// → { bajos: [{ bodega, nombreBodega, mp, nombre, unidad, hay, minimo, bajoAhora, bajoDesde }], sinContar } o null
// v0.63.3: el resultado queda 10 minutos en memoria y en este navegador (Hoy no lo vuelve a leer en cada apertura); lo leído
// para calcularlo (stock, materias primas, configuración, días) queda en la memoria compartida con Producción y Finanzas.
// Anotar una llegada, cambiar una crítica o la configuración lo olvida; "Actualizar" también.
export async function alertasBodega({ forzar = false } = {}) {
  try {
    const cx = await conexion(); if (cx.estado !== 'ok') return null;
    return await M.memo('prod:hoy:alertas', alertasLeer, { guardar: true, forzar });
  } catch (e) { return null; }
}
async function alertasLeer() {
  {
    const [sn, ms, cfg] = await Promise.all([stockmpMem(), mpsMem(), configMem()]);
    const sm = {}; sn.forEach(({ id, ...d }) => { sm[id] = d; });
    const mapa = K.mapaBodegas(cfg.bodegas || null), mps = ms.filter(m => (m.estado || 'activa') === 'activa' && m.tipo !== 'sub_receta');
    const ultimo = Object.values(sm).map(d => (d.estado || {}).en).filter(Boolean).sort().pop();
    let lista = null;
    if (ultimo && Date.now() - new Date(ultimo).getTime() < 6 * 3600000) {
      // Las críticas de hoy (activas, en cada bodega): todas tienen que venir del último cálculo; si no, se calcula de nuevo
      const crit = K.puestos(mps, sm, mapa).map(p => ({ m: p.mp, b: p.bodega, d: p.sm, cfg: p.cfg }));
      if (crit.every(x => x.d && x.d.estado && x.d.estado.en === ultimo))
        lista = crit.map(x => ({ bodega: x.b, mp: x.m.id, nombre: x.m.nombre, unidad: x.cfg.unidad, minimo: x.cfg.seguridad, ...x.d.estado }));
    }
    if (!lista) {
      const c = await calcularBodega({ desdeAlertas: true });
      lista = c.criticas.map(e => ({ bodega: e.bodega, mp: e.mp.id, nombre: e.mp.nombre, unidad: e.cfg.unidad, minimo: e.cfg.seguridad, contado: e.st.contado, stock: e.st.contado ? e.st.stock : null, bajoAhora: e.bajoAhora, bajoDesde: e.bajoDesde }));
    }
    const bajos = lista.filter(x => x.contado && (x.bajoAhora || x.bajoDesde))
      .map(x => ({ bodega: x.bodega, nombreBodega: K.nombreBodega(x.bodega, mapa), mp: x.mp, nombre: x.nombre, unidad: x.unidad, hay: x.stock, minimo: x.minimo, bajoAhora: !!x.bajoAhora, bajoDesde: x.bajoDesde || null }));
    avisarBajos(bajos.filter(x => x.bajoAhora), mapa).catch(() => {});
    return { bajos, sinContar: lista.filter(x => !x.contado).length };
  }
}
// Correo de "bajo el mínimo" (script v2.9.0, stock_alerta): el script manda uno por día, bodega y materia prima.
// v0.65.0: con responsables, a las jefas del área responsable (script v2.11.0: recibe modo).
// Aquí además se recuerda en el equipo lo ya pedido hoy, para no llamar al script cada vez que se abre Hoy.
const K_ALERTAS = 'fen_sf_alertas_stock';
export async function avisarBajos(bajos, mapa) {
  const hoy = CM.hoyTxt();
  let hechas = {}; try { hechas = JSON.parse(localStorage.getItem(K_ALERTAS) || '{}') || {}; } catch (e) { hechas = {}; }
  const nuevas = (bajos || []).filter(x => x.bajoAhora && K.bajoMinimo(x.hay, x.minimo) && !hechas[K.claveAlerta(hoy, x.bodega, x.mp)]);
  if (!nuevas.length) return { pedidas: 0 };
  const m = mapa || K.mapaBodegas();
  const r = await script('stock_alerta', { fecha: hoy, mapa: m.areas, modo: m.modo, alertas: nuevas.map(x => ({ bodega: x.bodega, nombreBodega: K.nombreBodega(x.bodega, m), mp: x.mp, nombre: x.nombre, unidad: x.unidad, hay: Math.round(x.hay), minimo: Math.round(x.minimo) })) }, K.esResponsable(m) ? VERSION_RESP : VERSION_ALERTAS);
  const limpio = {}; Object.entries(hechas).forEach(([k, v]) => { if (k.slice(0, 10) >= CM.sumarDias(hoy, -3)) limpio[k] = v; });
  nuevas.forEach(x => { limpio[K.claveAlerta(hoy, x.bodega, x.mp)] = 1; });
  try { localStorage.setItem(K_ALERTAS, JSON.stringify(limpio)); } catch (e) {}
  return { pedidas: nuevas.length, respuesta: r };
}
