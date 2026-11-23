// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Flujo de caja · datos  v0.124.0
//  Lee (no cambia nada de lo que lee):
//   · fen-gastos: lo del Gastos nuevo (gn-fs.leer: documentos, cargos del banco y Mercado Pago, pagos, cargas con el cuadre de cada
//     cartola, compromisos y créditos; con la memoria de la sesión de fs-gastos) y mp_ventas desde el inicio (1 por día con ventas).
//   · fen-ventas: evaluacion_caja (los cierres), caja_movimientos y efectivo_movimientos desde el inicio (3 consultas sin índices compuestos).
//   · fen-b2b: movimientos (los abonos de la cartola) desde el inicio (1 consulta) y lo de la agenda (por cobrar, clientes y la lista de
//     cartolas: la misma memoria de 5 minutos de Hoy) y las órdenes del análisis (6 horas en este equipo) para el IVA de B2B.
//   Todo queda 5 minutos en memoria (cambiar de pestaña no vuelve a leer); "Actualizar" lee de nuevo.
//  Guarda en fen-gastos (las reglas v0.1.0 ya cubren colecciones nuevas: no cambian):
//   · fin_flujo/config   { apertura { fecha, chequera, cc, mp, efectivo }, mpDias, adelante, historial [{ antes, nota, por, en }] }
//                        Se crea la primera vez con los saldos del 30-09-2026.
//   · fin_flujo/metas    { barros_arana: [{ desde (lunes), monto, nota, por, en }], ainavillo: [...] } — solo se agrega: la última que
//                        rige desde una semana manda (una meta en $0 la quita).
//   · fin_flujo_ajustes/{id}  "mover" (mv_…: otra fecha y/o monto para un esperado; el documento original no cambia) o "manual" (ma_…:
//                        un pago o cobro anotado). { tipo, clave, fecha, monto, nota, estado vigente|anulado, por, en, historial, anulado }.
//                        Nada se borra: se anula.
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as GBase from './gastos-base.js?v=0.138.0';
import { auth, db as dbV, collection as colV, getDocs as getDocsV, query as queryV, where as whereV, Timestamp as TsV } from './firebase.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as FBB from './firebase-b2b.js?v=0.138.0';
import * as M from './flujo-modelo.js?v=0.138.0';

const TTL = 300000;
const yo = () => (auth.currentUser && auth.currentUser.email) || '';
const ahora = () => new Date().toISOString();
const inicio = () => (typeof window !== 'undefined' && window.FEN_SIS && window.FEN_SIS.INICIO) || M.INICIO;
const mem = { t: 0, d: null, p: null };
export const olvidar = () => { mem.t = 0; mem.d = null; mem.p = null; };
export const leidoHace = () => (mem.t ? Date.now() - mem.t : null);

async function dbG() { const cx = await GBase.conexion(); if (cx.estado !== 'ok') throw Object.assign(new Error('sin_base'), { code: 'sin_base', estado: cx.estado }); return cx.db; }
const lista = sn => sn.docs.map(d => ({ id: d.id, ...d.data() }));

export async function cargar({ forzar = false } = {}) {
  if (!forzar && mem.d && Date.now() - mem.t < TTL) return mem.d;
  if (!forzar && mem.p) return mem.p;
  const p = leerTodo().then(d => { mem.d = d; mem.t = Date.now(); mem.p = null; return d; }, e => { mem.p = null; throw e; });
  mem.p = p; return p;
}
async function leerTodo() {
  const ini = inicio(), db = await dbG(), faltan = {};
  const [gn, mpV, cfg, met, aj] = await Promise.all([
    import('./gn-fs.js?v=0.138.0').then(m => m.leer()),
    FB.getDocs(FB.query(FB.collection(db, 'mp_ventas'), FB.where('fecha', '>=', ini))).then(lista).catch(e => { faltan.mp = e.message || String(e); return []; }),
    FB.getDoc(FB.doc(db, 'fin_flujo', 'config')),
    FB.getDoc(FB.doc(db, 'fin_flujo', 'metas')),
    FB.getDocs(FB.collection(db, 'fin_flujo_ajustes')).then(lista)
  ]);
  let config = cfg.exists() ? cfg.data() : null;
  if (!config) { try { config = await crearConfig(db); } catch (e) { config = { ...M.CONFIG_DEF, sinGuardar: true }; } }
  // fen-ventas (la caja y Efectivo)
  const [y, m, d] = M.sumarDias(ini, -1).split('-').map(Number);
  const ventas = await Promise.all([
    getDocsV(queryV(colV(dbV, 'evaluacion_caja'), whereV('cierre', '>=', TsV.fromDate(new Date(y, m - 1, d))))).then(lista),
    getDocsV(queryV(colV(dbV, 'caja_movimientos'), whereV('dia', '>=', ini))).then(lista),
    getDocsV(queryV(colV(dbV, 'efectivo_movimientos'), whereV('mes', '>=', ini.slice(0, 7)))).then(l => lista(l).filter(x => x.cuenta === undefined || x.cuenta === 'caja_admin'))
  ]).catch(e => { faltan.ventas = e.message || String(e); return [[], [], []]; });
  // fen-b2b (abonos, por cobrar, cartolas y órdenes)
  let abonos = [], agenda = null, ordenes = [];
  try {
    const cx = await B.conexion();
    if (cx.estado !== 'ok') faltan.b2b = 'Ventas a empresas no está conectada en este equipo.';
    else {
      const [sn, ag, an] = await Promise.all([FBB.getDocs(FBB.query(FBB.collection(cx.db, 'movimientos'), FBB.where('fecha', '>=', ini))), B.datosAgenda().catch(() => null), B.ordenesParaAnalisis().catch(() => null)]);
      abonos = lista(sn); agenda = ag; ordenes = (an && an.ordenes) || [];
      if (!ag) faltan.cobros = 'No se pudo leer lo por cobrar de Ventas a empresas.';
    }
  } catch (e) { faltan.b2b = e.message || String(e); }
  return armarDatos({ ini, gn, mpVentas: mpV, config, metas: met.exists() ? met.data() : {}, ajustes: aj, evals: ventas[0], cmovs: ventas[1], efmovs: ventas[2], abonos, agenda, ordenes, faltan });
}
// Lo que necesitan el modelo y la pantalla (también lo usan las pruebas)
export function armarDatos({ ini = M.INICIO, gn, mpVentas = [], config, metas = {}, ajustes = [], evals = [], cmovs = [], efmovs = [], abonos = [], agenda = null, ordenes = [], faltan = {} }) {
  const cfg = { ...M.CONFIG_DEF, ...(config || {}), apertura: { ...M.APERTURA_DEF, ...((config || {}).apertura || {}) } };
  const porCliente = agenda ? B.foliosPorCobrar(agenda.porCobrar || [], agenda.abonos || [], agenda.clientes || []) : {};
  // Saldos de las cartolas: cada movimiento con su saldo, el cuadre de cada cartola y hasta dónde llega cada cuenta
  const puntos = { cc: [], chequera: [] }, finales = { cc: [], chequera: [] }, cobertura = {};
  const cubre = (c, h) => { const x = M.aDia(h); if (x && (!cobertura[c] || x > cobertura[c])) cobertura[c] = x; };
  ((gn && gn.movs) || []).forEach(x => { if (puntos[x.cuenta] && x.saldo !== undefined && x.saldo !== null && x.saldo !== 0) puntos[x.cuenta].push({ fecha: x.fecha, saldo: x.saldo, cargo: x.monto }); });
  abonos.filter(a => a.estado !== 'repetido' && !a.quitadoEnPlanilla).forEach(a => { const c = a.cuenta === 'cc' ? 'cc' : 'chequera'; if (a.saldo !== undefined && a.saldo !== null) puntos[c].push({ fecha: M.aDia(a.fecha), saldo: a.saldo, abono: a.monto }); });
  ((gn && gn.cargas) || []).forEach(k => {
    if (k.tipo === 'bancoestado') (k.cuentas || []).forEach(c => { if (!puntos[c]) return; cubre(c, k.hasta); if (k.cuadre && k.cuadre.final !== undefined) finales[c].push({ desde: M.aDia(k.desde), hasta: M.aDia(k.hasta), final: k.cuadre.final, inicial: k.cuadre.inicial }); });
    if (k.tipo === 'mercadopago') cubre('mp', k.hasta);
  });
  ((agenda && agenda.conciliacion && agenda.conciliacion.cartolas) || []).forEach(c => { const cu = c.cuenta === 'cc' ? 'cc' : 'chequera'; if (c.tipo === 'antigua') return; cubre(cu, c.hasta); if (c.cuadre && c.cuadre.final !== undefined && c.hasta) finales[cu].push({ desde: M.aDia(c.desde), hasta: M.aDia(c.hasta), final: c.cuadre.final, inicial: c.cuadre.inicial }); });
  const movsMp = ((gn && gn.movs) || []).filter(x => x.cuenta === 'mp');
  return { ini, gn: gn || {}, mpVentas, config: cfg, metas: metas || {}, ajustes, evals, cmovs, efmovs, abonos, porCliente, clientes: (agenda && agenda.clientes) || [], ordenes, faltan, puntos, finales, cobertura, movsMp, leido: Date.now() };
}

// ── Escrituras ──
async function crearConfig(db) {
  const ref = FB.doc(db, 'fin_flujo', 'config');
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (sn.exists()) return sn.data();
    const d = { ...M.CONFIG_DEF, historial: [{ antes: null, nota: 'Creado con los saldos al 30-09-2026 (balance de apertura)', por: yo() || 'Sistema Fën', en: ahora() }], creado: { por: yo(), en: ahora() } };
    tx.set(ref, d); return d;
  });
}
export function validarConfig(x) {
  const ap = {}, n = v => Math.round(Number(String(v == null ? '' : v).replace(/[$.\s]/g, '').replace(',', '.')));
  for (const k of M.ORDEN_CUENTAS) { const v = n(x.apertura && x.apertura[k]); if (!isFinite(v)) throw new Error(`Revise el saldo de ${M.CUENTAS[k]}.`); ap[k] = v; }
  const mpDias = n(x.mpDias); if (!isFinite(mpDias) || mpDias < 0 || mpDias > 60) throw new Error('Los días de Mercado Pago van de 0 a 60.');
  const adelante = n(x.adelante); if (!isFinite(adelante) || adelante < 2 || adelante > 16) throw new Error('Las semanas que vienen van de 2 a 16.');
  return { apertura: { fecha: M.INICIO, ...ap }, mpDias, adelante };
}
export async function guardarConfig(x, nota) {
  const v = validarConfig(x), db = await dbG(), ref = FB.doc(db, 'fin_flujo', 'config');
  const d = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : { ...M.CONFIG_DEF };
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { antes: { apertura: prev.apertura || null, mpDias: prev.mpDias ?? 0, adelante: prev.adelante ?? 6 }, nota: String(nota || '').slice(0, 200), por: yo(), en: ahora() }].slice(-40);
    const out = { ...prev, ...v, historial, actualizado: { por: yo(), en: ahora() } };
    tx.set(ref, out); return out;
  });
  if (mem.d) mem.d.config = { ...M.CONFIG_DEF, ...d, apertura: { ...M.APERTURA_DEF, ...(d.apertura || {}) } };
  return d;
}
export async function guardarMeta(suc, desde, monto, nota) {
  if (!M.SUCURSALES.some(x => x[0] === suc)) throw new Error('Elija la tienda.');
  if (!M.esDia(desde) || M.lunesDe(desde) !== desde) throw new Error('Elija la semana desde la que rige.');
  const v = Math.round(Number(String(monto == null ? '' : monto).replace(/[$.\s]/g, ''))); if (!isFinite(v) || v < 0) throw new Error('Escriba la meta en pesos (0 la quita).');
  const db = await dbG(), ref = FB.doc(db, 'fin_flujo', 'metas');
  const d = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const out = { ...prev, [suc]: [...(Array.isArray(prev[suc]) ? prev[suc] : []), { desde, monto: v, nota: String(nota || '').slice(0, 200), por: yo(), en: ahora() }].slice(-100) };
    tx.set(ref, out); return out;
  });
  if (mem.d) mem.d.metas = d;
  return d;
}
const hash = t => { let h = 5381; for (const c of String(t)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };
export const idMover = clave => 'mv_' + String(clave).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) + '_' + hash(clave);
export function validarMover(x) {
  const out = { nota: String(x.nota || '').trim().slice(0, 200) };
  if (x.fecha !== undefined && x.fecha !== '') { if (!M.esDia(x.fecha)) throw new Error('Elija la fecha nueva.'); out.fecha = x.fecha; }
  if (x.monto !== undefined && x.monto !== '' && x.monto !== null) { const v = Math.round(Number(String(x.monto).replace(/[$.\s]/g, ''))); if (!isFinite(v) || v < 0) throw new Error('Escriba el monto en pesos.'); out.monto = v; }
  if (out.fecha === undefined && out.monto === undefined) throw new Error('Elija la fecha nueva.');
  if (out.nota.length < 3) throw new Error('Escriba por qué (una nota corta).');
  return out;
}
// Mover un esperado (otra fecha y/o, para los sueldos, otro monto). El documento original no se toca.
export async function mover(it, x) {
  const v = validarMover(x), db = await dbG(), id = idMover(it.clave), ref = FB.doc(db, 'fin_flujo_ajustes', id);
  const d = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    const antes = prev && prev.estado !== 'anulado' ? { fecha: prev.fecha || '', monto: prev.monto ?? null, nota: prev.nota || '', por: prev.por || '', en: prev.en || '' } : null;
    const out = { tipo: 'mover', clave: it.clave, que: String(it.que || '').slice(0, 160), fechaOriginal: it.fechaOriginal || it.fecha || '', montoOriginal: it.montoOriginal ?? it.monto ?? null,
      fecha: v.fecha || (prev && prev.estado !== 'anulado' ? prev.fecha || '' : ''), ...(v.monto !== undefined ? { monto: v.monto } : prev && prev.estado !== 'anulado' && prev.monto !== undefined ? { monto: prev.monto } : {}),
      nota: v.nota, estado: 'vigente', por: yo(), en: ahora(), historial: [...((prev && prev.historial) || []), { que: prev ? (prev.estado === 'anulado' ? 'movido otra vez' : 'cambiado') : 'movido', antes, por: yo(), en: ahora() }].slice(-30) };
    tx.set(ref, out); return out;
  });
  if (mem.d) mem.d.ajustes = mem.d.ajustes.filter(a => a.id !== id).concat([{ id, ...d }]);
  return d;
}
export function validarManual(x) {
  const sentido = x.sentido === 'entra' ? 'entra' : x.sentido === 'sale' ? 'sale' : ''; if (!sentido) throw new Error('Elija si es un pago o un cobro.');
  if (!M.esDia(x.fecha)) throw new Error('Elija la fecha.');
  const monto = Math.round(Number(String(x.monto == null ? '' : x.monto).replace(/[$.\s]/g, ''))); if (!(monto > 0)) throw new Error('Escriba el monto en pesos.');
  const que = String(x.que || '').trim().slice(0, 120); if (que.length < 3) throw new Error('Escriba qué es.');
  const fila = M.FILAS[x.fila] && M.esEntra(x.fila) === (sentido === 'entra') ? x.fila : sentido === 'entra' ? 'otros_in' : 'otros_out';
  return { tipo: 'manual', sentido, fecha: x.fecha, monto, que, fila, deDonde: String(x.deDonde || 'Banco').slice(0, 40), nota: String(x.nota || '').trim().slice(0, 200) };
}
export async function anotar(x) {
  const v = validarManual(x), db = await dbG(), id = 'ma_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const d = { ...v, estado: 'vigente', por: yo(), en: ahora(), historial: [{ que: 'anotado', por: yo(), en: ahora() }] };
  await FB.setDoc(FB.doc(db, 'fin_flujo_ajustes', id), d);
  if (mem.d) mem.d.ajustes = mem.d.ajustes.concat([{ id, ...d }]);
  return { id, ...d };
}
// Anular (un movido vuelve a su fecha original; uno anotado deja de contar). Queda con su historial.
export async function anular(id, motivo) {
  const m = String(motivo || '').trim(); if (m.length < 3) throw new Error('Escriba el motivo.');
  const db = await dbG(), ref = FB.doc(db, 'fin_flujo_ajustes', id);
  const d = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists() || sn.data().estado === 'anulado') throw new Error('Ya no está vigente.');
    const a = sn.data(), out = { ...a, estado: 'anulado', anulado: { por: yo(), en: ahora(), motivo: m.slice(0, 200) }, historial: [...(a.historial || []), { que: 'anulado', motivo: m.slice(0, 200), por: yo(), en: ahora() }].slice(-30) };
    tx.set(ref, out); return out;
  });
  if (mem.d) mem.d.ajustes = mem.d.ajustes.map(a => (a.id === id ? { id, ...d } : a));
  return d;
}
