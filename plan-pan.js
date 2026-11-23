// ═══════════════════════════════════════════════
//  Sistema Fën — Plan de Panadería, Etapa 1: lectura de datos  v0.72.1
//  Solo lee (salvo la tabla fija de Ainavillo y los pisos). Junta lo de las cuatro bases y lo pasa a plan-pan-modelo.js:
//   · fen-ventas (la caja): resúmenes de cada cierre (porTarjeta, agotado: caja v2.2.0), ingresos a las tiendas
//     (stockMovimientos con fechaKey: solo los ingresos tienen ese campo, así la consulta no trae las ventas), merma registrada
//     y el stock actual de los panes ingresados (lo que aún queda de cada lote). Configuración: config/planPanaderia.
//   · fen-b2b: órdenes por fecha (= día de entrega = día de horneado; v0.72.1: el lunes se amasa el sábado, el domingo no se hornea).
//   · fen-produccion (Cocina): recetas, materias primas, configuración de Panadería, ajustes, planes y días (lo hecho).
//   · fen-gastos (Finanzas): vínculos producto → receta (fin_productos) y costo por unidad (costos_recetas).
//  Lecturas: una vez por sesión (6 horas en memoria; "Actualizar" vuelve a leer). Cada consulta usa un solo campo (índices simples).
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, getDoc, getDocs, query, where, Timestamp, runTransaction } from './firebase.js?v=0.138.0';
import * as Caja from './caja.js?v=0.138.0';
import * as P from './produccion.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as F from './finanzas.js?v=0.138.0';
import * as M from './fs-memoria.js?v=0.138.0';
import * as Cuota from './fs-cuota.js?v=0.138.0';
import * as CM from './cocina/modelo.js?v=0.17.4';
import * as K from './cocina/consumo.js?v=0.17.12';
import * as PM from './plan-pan-modelo.js?v=0.138.0';

export const CONFIG_ID = 'planPanaderia';     // fen-ventas config/planPanaderia (reglas v1.3.0: solo administración la crea y cambia)
const TTL = 6 * 3600e3;
const PRE = 'pp:';
const yo = () => (auth.currentUser && auth.currentUser.email) || '';
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export { hoyTxt };

// Lecturas de esta pantalla, por base (documentos leídos)
export const uso = { ventas: 0, b2b: 0, produccion: 0, gastos: 0 };
export function reiniciarUso() { Object.keys(uso).forEach(k => { uso[k] = 0; }); }
const contar = (base, sn) => { uso[base] += Math.max(1, sn.size !== undefined ? sn.size : sn.docs.length); return sn; };
const memo = (clave, fn, forzar) => M.memo(PRE + clave, fn, { ttl: TTL, forzar });
export function olvidar() { M.olvidar(PRE); }

// ── fen-ventas ──
async function resumenes(desde, hasta, forzar) {
  return memo(`res:${desde}`, async () => contar('ventas', await getDocs(query(collection(db, 'resumenes_caja'), where('fecha', '>=', desde)))).docs.map(d => ({ id: d.id, ...d.data() })), forzar)
    .then(l => l.filter(r => (r.fecha || '') >= desde && (r.fecha || '') <= hasta));
}
async function ingresos(desde, forzar) {
  return memo(`ing:${desde}`, async () => contar('ventas', await getDocs(query(collection(db, 'stockMovimientos'), where('fechaKey', '>=', PM.claveDeFecha(desde))))).docs
    .map(d => d.data()).filter(x => x.tipo === 'ingreso' || x.tipo === undefined).map(x => ({ sucursal: x.sucursal || '', productoId: x.productoId || '', fechaKey: String(x.fechaKey || ''), cantidad: Number(x.cantidad) || 0 })), forzar);
}
async function mermas(desde, forzar) {
  const [y, m, d] = desde.split('-').map(Number);
  return memo(`merma:${desde}`, async () => contar('ventas', await getDocs(query(collection(db, 'merma'), where('fecha', '>=', Timestamp.fromDate(new Date(y, m - 1, d)))))).docs
    .map(x => { const r = x.data(); return { sucursal: r.sucursal || '', productoId: r.productoId || '', cantidad: Number(r.cantidad) || 0, fechaIngreso: r.fechaIngreso || '', fechaEnvio: r.fechaEnvio || '', monto: Number(r.monto) || 0 }; }), forzar);
}
// El stock actual de cada producto de pan ingresado en la ventana (un documento por producto y sucursal)
async function stocks(pares, forzar) {
  const out = {};
  await Promise.all(pares.map(async ([suc, pid]) => {
    const id = `${suc}_${pid}`;
    out[id] = await memo(`stock:${id}`, async () => { const sn = await getDoc(doc(db, 'stock', id)); uso.ventas++; return sn.exists() ? { ...sn.data(), sucursal: suc, productoId: pid } : null; }, forzar);
  }));
  return out;
}
export async function leerConfig(forzar) {
  return memo('cfg', async () => { const sn = await getDoc(doc(db, 'config', CONFIG_ID)); uso.ventas++; return sn.exists() ? sn.data() : {}; }, forzar);
}
// Guarda cambios de la tabla de Ainavillo o de los pisos (en una transacción: dos equipos a la vez no se pisan). Nada se borra.
export async function guardarCambios(cambios) {
  const ref = doc(db, 'config', CONFIG_ID), en = new Date().toISOString();
  let entradas = [];
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    const r = PM.aplicarCambios(sn.exists() ? sn.data() : {}, cambios, yo(), en);
    entradas = r.entradas;
    if (!entradas.length) return;
    tx.set(ref, { ...r.cfg, actualizado: { por: yo(), en } });
  });
  M.olvidar(PRE + 'cfg');
  return entradas;
}

// ── fen-b2b ──
async function ordenes(desde, hasta, forzar) {
  const cx = await B.conexion().catch(e => ({ estado: 'error', error: e }));
  if (cx.estado !== 'ok') return { estado: cx.estado, ordenes: [] };
  const antes = B.uso.lecturas;
  const l = await memo(`b2b:${desde}~${hasta}`, async () => { if (forzar) B.olvidarAnalisisB2b(); const x = await B.ordenesEntre(desde, hasta); uso.b2b += B.uso.lecturas - antes; return x; }, forzar);
  return { estado: 'ok', ordenes: l.map(o => ({ fecha: o.fecha, clienteId: o.clienteId || '', cliente: o.cliente || '', lineas: (o.lineas || []).map(x => ({ productoId: x.productoId || x.id || '', producto: x.producto || x.nombre || '', cantidad: Number(x.cantidad) || 0 })) })) };
}

// ── fen-gastos (Finanzas): vínculos y costos ──
async function finanzas(forzar) {
  const cx = await F.conexiones();
  if (cx.gastos.estado !== 'ok') return { estado: cx.gastos.estado, vinculos: {}, costos: {} };
  const antes = Cuota.usoHoy().lecturas;
  const [fin, prods, maestro] = await Promise.all([F.leerVinculos(), F.leerProductos().catch(() => ({ docs: {} })), F.maestroFinanzas().catch(() => null)]);
  // v0.74.0: el producto → receta sale del maestro del Catálogo (si el producto está unido); si no, de fin_productos
  const vinculos = maestro && maestro.vinc ? { ...fin, ...maestro.vinc } : fin;
  uso.gastos += Math.max(0, Cuota.usoHoy().lecturas - antes);
  const costos = {}; Object.entries(prods.docs || {}).forEach(([id, d]) => { if (d && Number(d.costoUnit) > 0) costos[id] = Number(d.costoUnit); });
  return { estado: 'ok', vinculos, costos };
}

// ── fen-produccion (Cocina) ──
async function cocina(desde, hasta) {
  const cx = await P.conexion().catch(e => ({ estado: 'error', error: e }));
  if (cx.estado !== 'ok') return { estado: cx.estado, recetas: [], mps: [], config: {}, ajustes: [], planes: [], dias: [] };
  const antes = Cuota.produccion.usoHoy().lecturas;
  const d = await P.datosPlanPan(desde, hasta);
  uso.produccion += Math.max(0, Cuota.produccion.usoHoy().lecturas - antes);
  return { estado: 'ok', ...d };
}

// ── Todo junto ──
// → { hoy, lunesProx, desde, hasta, estados, mapa, recetasPan, nombres, lotes, tarjetas, producido, b2b, costos, cfg, sinAsociar, cocina, uso }
export async function cargar({ hoy = hoyTxt(), forzar = false, lunesExtra = [] } = {}) {
  if (forzar) { olvidar(); P.olvidarMemoria('planes', 'ajustes'); }
  const lunesProx = PM.sumarDias(PM.lunesDe(hoy), 7);
  const v = PM.ventana(lunesProx, hoy);
  const desde = [v.desde, ...lunesExtra].sort()[0], hasta = hoy;
  const [fin, coc, res, ing, mer, ord, cfg] = await Promise.all([
    finanzas(forzar), cocina(PM.sumarDias(desde, -2), hasta), resumenes(desde, hasta, forzar), ingresos(desde, forzar), mermas(desde, forzar), ordenes(desde, PM.sumarDias(lunesProx, 6), forzar), leerConfig(forzar)
  ]);
  const mapa = PM.mapaProductos(fin.vinculos);
  // Stock actual: los productos de pan (asociados) ingresados en la ventana, por sucursal tal como la escribe la caja
  const pares = [...new Set(ing.filter(x => mapa.pan[PM.claveProducto('caja', x.productoId)]).map(x => x.sucursal + '|' + x.productoId))].map(k => k.split('|'));
  const st = await stocks(pares, forzar);
  // La referencia "hace un año" (desde junio de 2027): solo si su día ya tiene datos en Firebase. Se lee aparte (por igualdad).
  const anio = PM.semanaDe(lunesProx).map(t => PM.mismoDiaDelMes(t, 12)).filter(f => f >= PM.DATOS_DESDE && f < desde);
  let ingA = [], merA = [], resA = [];
  if (anio.length) {
    const claves = anio.map(PM.claveDeFecha), dmy = anio.map(f => f.split('-').reverse().join('-'));
    [ingA, merA, resA] = await Promise.all([
      memo(`ingA:${claves.join(',')}`, async () => contar('ventas', await getDocs(query(collection(db, 'stockMovimientos'), where('fechaKey', 'in', claves)))).docs.map(d => d.data()).filter(x => x.tipo === 'ingreso'), forzar),
      memo(`merA:${dmy.join(',')}`, async () => contar('ventas', await getDocs(query(collection(db, 'merma'), where('fechaIngreso', 'in', dmy)))).docs.map(d => d.data()), forzar),
      memo(`resA:${anio.join(',')}`, async () => contar('ventas', await getDocs(query(collection(db, 'resumenes_caja'), where('fecha', 'in', anio)))).docs.map(d => d.data()), forzar)]);
  }
  const L = PM.lotes({ ingresos: [...ing, ...ingA], mermas: [...mer, ...merA], stocks: st, mapa });
  const filasT = Caja.tarjetasDeResumenes([...res, ...resA]);
  const tarjetas = PM.tarjetasPorLote(filasT, mapa);
  const b2b = PM.b2bPorDia(ord.ordenes, mapa);
  const producido = PM.producidoPorDia(coc.planes, coc.dias);
  // Tipos de pan: las recetas de Panadería (Cocina) que tienen un producto asociado, están en un plan o tienen algo en la ventana
  const usadas = new Set(Object.values(mapa.pan).map(v => v.receta));
  Object.values(producido).forEach(x => Object.keys(x).forEach(r => usadas.add(r)));
  const nombres = {};
  (coc.recetas || []).forEach(r => { if (r.area === 'PAN') nombres[r.id] = r.nombre || r.id; });
  Object.values(mapa.pan).forEach(v => { if (!nombres[v.receta]) nombres[v.receta] = v.nombre || v.receta; });
  // v0.72.0: una receta archivada (Catálogo) no entra en la propuesta; lo que ya pasó (Cómo nos fue) sigue contando
  const archivadas = new Set((coc.recetas || []).filter(r => r.estado === 'archivada').map(r => r.id));
  const recetasPan = [...usadas].filter(id => !archivadas.has(id)).map(id => ({ id, nombre: nombres[id] || id })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  // Productos sin asociar: de la caja (área PAN en el catálogo) vendidos o ingresados, y de B2B pedidos
  // (el área y el nombre vienen en los mismos resúmenes: 0 lecturas más)
  const deRes = {}; filasT.forEach(f => { if (!deRes[f.productoId]) deRes[f.productoId] = { nombre: f.nombre, area: f.area }; });
  const cajaVistos = [];
  filasT.forEach(f => cajaVistos.push({ productoId: f.productoId, nombre: f.nombre, area: f.area, cantidad: f.cantidad }));
  ing.forEach(x => { const c = deRes[x.productoId]; if (c) cajaVistos.push({ productoId: x.productoId, nombre: c.nombre, area: c.area, cantidad: 0 }); });
  const sin = fin.estado === 'ok' ? PM.sinAsociar({ caja: cajaVistos, b2b: b2b.sin }, mapa) : [];
  return {
    hoy, lunesProx, desde, hasta, estados: { gastos: fin.estado, b2b: ord.estado, cocina: coc.estado },
    mapa, recetasPan, nombres, lotes: L.porReceta, lotesInfo: { sinLote: L.sinLote, corridas: L.corridas }, tarjetas, producido, b2b, costos: fin.costos, cfg,
    sinAsociar: sin, cocina: coc, uso: { ...uso }
  };
}

// Referencia de un lote de Barros (receta, fecha) → detalleLote | null
export function refBarros(D) {
  return (receta, fecha) => {
    const l = ((D.lotes.barros || {})[fecha] || {})[receta];
    if (!l) return null;
    return PM.detalleLote(l, (((D.tarjetas.barros || {})[fecha]) || {})[receta]);
  };
}
// La propuesta de la próxima semana (con la masa madre de Cocina)
export function propuesta(D) {
  const semana = PM.propuestaSemana(D.lunesProx, { b2b: D.b2b, refBarros: refBarros(D), cfg: D.cfg, recetas: D.recetasPan, hoy: D.hoy });
  const ajA = {}; (D.cocina.ajustes || []).filter(a => a.area === 'PAN').forEach(a => { ajA[a.id] = a; });
  const mm = D.cocina.estado === 'ok' ? PM.masaMadre(semana, { recetas: D.cocina.recetas, mps: D.cocina.mps, config: (D.cocina.config || {}).PAN || {} }, CM, f => K.ajustesDe(ajA, f)) : { disponible: false, porDia: {} };
  return { semana, mm };
}
