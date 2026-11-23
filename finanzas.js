// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas: datos (F1 pasos 1, 2 y 3 y F2 pasos 1 y 2: costos, precio desde el SII, costo directo por producto, ventas por producto, margen de contribución)  v0.60.0
//  Todo vive en fen-gastos (solo administración; las reglas v0.1.0 ya cubren colecciones nuevas):
//   · costos_mp/{mpId}        (mismo id que fen-produccion mps / MP_maestro ID_MP): nombre, tipo (mp|insumo|sub_receta),
//                             unidadCompra, contenido { cantidad, unidad: g|ml|un }, precioNeto (por unidad de compra),
//                             impAdicionalPct, ivaPct, precioPorBase (neto por g/ml/un), pesoPorUnidad (g, opcional),
//                             origen (planilla|manual|sii), fecha, por, estado (activa|archivada), anterior, updatedAt.
//   · costos_mp_hist/{autoId}  cada cambio de precio o contenido: { mp, precioNeto, contenido, precioPorBase, origen, motivo,
//                             fecha, por, anterior, en }. Nunca se edita ni se borra.
//   · costos_revision/{id}     "revisado" de la Revisión de datos: { clave, huella, revisado { por, fecha } | null, historial }.
//   · costos_cargas/{autoId}   cada "Traer precios desde la planilla": cuántas nuevas, cambiadas y respetadas.
//  v0.57.0 (F1 paso 2, precio desde la última compra del SII; reglas en finanzas-sii.js):
//   · costos_asoc/{rut__nombre[__c-código]}  producto de factura → materia prima (o "no es materia prima"), con lo que trae
//                             una unidad facturada: { rut, rutKey, proveedor, nombreItem, nombreNorm, codigo, mp, mpNombre, ignorar,
//                             contenidoPorUnidad { cantidad, unidad g|ml|un }, creada, actualizada, version }.
//   · costos_asoc_hist/{autoId}  cada cambio de una asociación { asoc, accion, antes, despues, nota, por, fecha, en } (solo agregar).
//   · costos_sii_procesadas/{línea}  cada línea de factura ya revisada { linea, asoc, mp, huella, resultado, motivo, fecha, en }:
//                             revisar de nuevo no repite nada (salvo que cambie su asociación).
//   · costos_por_confirmar/{línea}  cambios de más de ±40 %: { mp, mpNombre, estado pendiente|confirmada|descartada|reemplazada,
//                             actual, nuevo, pct, sii, creada, resuelta { por, fecha, motivo } }. Nunca se borran.
//   · costos_sii_revisiones/{autoId}  cada revisión (al importar del SII o con el botón): cuántas aplicadas, por confirmar…
//  v0.58.0 (F1 paso 3, costo directo por producto; motor en finanzas-motor.js):
//   · costos_recetas/{recetaId}  el último cálculo: { area, nombre, tipo, aprobada, costoUnit (neto por unidad, o por gramo si rinde g),
//                             costoTotal (lote), unidad un|g, porciones, incompleto [motivos], sinCosto, precios { mpId: precio por base },
//                             preciosUsados (hash), recetaHash, ultimoHist { costoUnit, fecha, anterior, pct }, preciosHist, calculadoEn, fecha }.
//   · costos_recetas_hist/{autoId}  solo agregar: { receta, nombre, area, anterior, nuevo, pct, unidad, causa [{ mp, nombre, antes, despues, pct }],
//                             recetaCambio, primero, incompleto, fecha, cuando, en } cuando el costo por unidad cambia más de 0,5 % (y el primer cálculo).
//   · costos_config/finanzas  { alzaAviso (%, por defecto 5), historial }.
//   · costos_alzas_vistas/{recetaId}  "visto" de un aviso de alza en Hoy: { costoUnit, fecha, por, historial }.
//  v0.59.0 (F2 paso 1, ventas por producto, área y canal; reglas puras en finanzas-ventas.js):
//   · fin_productos/{canal}_{productoId}  producto de la caja (fen-ventas productos) o de B2B (fen-b2b productos) → receta (y su área),
//                             reventa (área y costo de compra neto, a mano) o "no es un producto" (propinas, cargos):
//                             { canal caja|b2b, productoId, nombre, tipo receta|reventa|ignorar, receta, recetaNombre, reventa, costoReventaNeto,
//                             ignorar, unidadesPorVenta (1; una "caja de 6" = 6), area, origen (catalogo|nombre|manual), nota, fecha, por }.
//   · fin_productos_hist/{autoId}  solo agregar: { clave, nombre, accion nuevo|cambio, antes, despues, origen, nota, fecha, por, en }.
//   · fin_ventas_mes/{AAAA-MM}_{caja|b2b}  las ventas de un mes ya cerrado (desde el día 8 del mes siguiente, sin cajas abiertas ni
//                             cierres sin resumen): { mes, canal, lineas [{ suc, productoId, nombre, cantidad, neto, recetaCatalogo, areaCatalogo }],
//                             neto, cierres | ordenes, creado, por }. Un mes guardado cuesta 1 lectura; "Volver a leer" lo rehace.
//   Fuentes (solo lectura): fen-ventas resumenes_caja (un documento por cierre, ya trae cada producto) y cajas (para saber si falta
//   algún resumen); fen-b2b ordenes (sin anuladas; precios netos) y productos; fen-produccion recetas (nombre y área).
//  Se recalcula al abrir Finanzas → Costos y justo después de un cambio de precio (a mano, del SII o confirmado).
//  Nada de esto va a fen-produccion ni a Cocina: las jefas no ven costos.
//  v0.60.0 (F2 paso 2, margen de contribución; reglas puras en finanzas-margenes.js): ventasPeriodo devuelve también porMes
//   [{ mes, lineas, medios (bruto por medio de pago y sucursal, de resumenes_caja.porMedio), ordenes (B2B válidas) }]; fin_ventas_mes de la caja
//   guarda porMedio y el de B2B ordenesValidas. costos_config/finanzas.margenes (comisión por medio de pago, mezcla de la caja, despacho B2B,
//   margen objetivo por área, redondeo) + historialMargenes. fin_productos.costoExtraNeto (envase por venta, neto).
//  v0.76.0: materias primas e insumos nuevos desde Finanzas → Costos (crearMateriaPrima, crearDesdeLinea): costos_mp con origen 'manual'
//   (o 'sii' si el precio es el de la línea de factura), creadaDesde 'sistema-fen' y su historial; datosMpEnCostos copia nombre y estado.
// ═══════════════════════════════════════════════
import { auth as authSF } from './firebase.js?v=0.138.0';
import * as FB from './fs-gastos.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as P from './produccion.js?v=0.138.0';
import * as FC from './finanzas-costos.js?v=0.138.0';
import * as FS from './finanzas-sii.js?v=0.138.0';
import * as FM from './finanzas-motor.js?v=0.138.0';
import * as FV from './finanzas-ventas.js?v=0.138.0';
import * as FMG from './finanzas-margenes.js?v=0.138.0';
import * as FR from './finanzas-resultados.js?v=0.138.0';
import * as FE from './finanzas-eerr.js?v=0.138.0';
import * as CPM from './catalogo-productos-modelo.js?v=0.138.0';
import * as Caja from './caja.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as FBB from './firebase-b2b.js?v=0.138.0';
import { db as dbV, collection as colV, getDocs as getDocsV, query as queryV, where as whereV, Timestamp as TsV } from './firebase.js?v=0.138.0';

const LOTE = 400;
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yo = () => (authSF.currentUser && authSF.currentUser.email) || '';
const idNuevo = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Conexiones: fen-gastos (donde se guarda) y fen-produccion (lista de materias primas y recetas)
export async function conexiones() {
  const [g, p] = await Promise.all([GB.conexion().catch(e => ({ estado: 'error', error: e })), P.conexion().catch(e => ({ estado: 'error', error: e }))]);
  return { gastos: g, prod: p };
}
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva de Gastos (Gastos → Configuración → Base nueva).'); return cx.db; }

// El maestro de costos, las marcas de revisión y la última carga
export async function leer() {
  const db = await dbG();
  const [c, r, k, pc] = await Promise.all([FB.getDocs(FB.collection(db, 'costos_mp')), FB.getDocs(FB.collection(db, 'costos_revision')), FB.getDocs(FB.collection(db, 'costos_cargas')),
    FB.getDocs(FB.query(FB.collection(db, 'costos_por_confirmar'), FB.where('estado', '==', 'pendiente')))]);
  const costos = {}; c.docs.forEach(d => { costos[d.id] = { id: d.id, ...d.data() }; });
  const marcas = {}; r.docs.forEach(d => { marcas[d.id] = d.data(); });
  const cargas = k.docs.map(d => d.data()).sort((a, b) => String(b.cuando || '').localeCompare(String(a.cuando || '')));
  const porConfirmar = pc.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.mpNombre || '').localeCompare(String(b.mpNombre || ''), 'es'));
  return { costos, marcas, ultimaCarga: cargas[0] || null, porConfirmar };
}
// Lista actual de fen-produccion (si no está conectada, sigue sin ella)
export async function produccion() {
  try { return (await prodMotor())[0]; } catch (e) { return { mps: [], recetas: [], error: e.message || String(e) }; }
}

// ── Traer precios desde la planilla ──
// Lee MP_maestro con precios (script de Producción v2.10.0, op mp_costos) y la lista de fen-produccion; no escribe nada.
export async function prepararCarga() {
  const [filas, prod, act] = await Promise.all([P.mpCostos(), produccion(), leer()]);
  const plan = FC.prepararCarga(filas, prod.mps, act.costos, { hoy: hoyTxt(), por: yo() });
  return { plan, filas: filas.length, prodError: prod.error || '' };
}
export async function aplicarCarga(plan) {
  const db = await dbG(), ahora = FB.serverTimestamp(), hoy = hoyTxt(), por = yo();
  const ops = [];
  plan.nuevas.forEach(x => {
    ops.push(['set', FB.doc(db, 'costos_mp', x.id), { ...x.doc, updatedAt: ahora }]);
    ops.push(['set', FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { mp: x.id, precioNeto: x.doc.precioNeto, contenido: x.doc.contenido, precioPorBase: x.doc.precioPorBase, origen: 'planilla', motivo: 'Carga inicial desde la planilla (MP_maestro)', fecha: hoy, por, anterior: null, en: ahora }]);
  });
  plan.cambian.forEach(x => {
    ops.push(['set', FB.doc(db, 'costos_mp', x.id), { ...x.doc, updatedAt: ahora }, true]);
    ops.push(['set', FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { mp: x.id, precioNeto: x.doc.precioNeto, contenido: x.doc.contenido, precioPorBase: x.doc.precioPorBase, origen: 'planilla', motivo: `Cambió en la planilla: ${x.cambios.join(', ')}`, fecha: hoy, por, anterior: x.doc.anterior, en: ahora }]);
  });
  plan.metadatos.forEach(x => ops.push(['set', FB.doc(db, 'costos_mp', x.id), { ...x.campos, updatedAt: ahora }, true]));
  for (let i = 0; i < ops.length; i += LOTE) {
    const b = FB.writeBatch(db);
    ops.slice(i, i + LOTE).forEach(([, ref, d, merge]) => (merge ? b.set(ref, d, { merge: true }) : b.set(ref, d)));
    await b.commit();
  }
  await FB.setDoc(FB.doc(db, 'costos_cargas', idNuevo('c-')), { cuando: new Date().toISOString(), fecha: hoy, por, nuevas: plan.nuevas.length, cambian: plan.cambian.length, metadatos: plan.metadatos.length, respetadas: plan.respetadas.length, en: ahora });
  return { escritos: ops.length };
}

// ── v0.73.0 (Etapa 1) · costos_mp es la ÚNICA fuente de precios ──
// "Traer precios desde la planilla" (prepararCarga / aplicarCarga) queda sin botón: la planilla ya no se actualiza. El código sigue
// aquí solo para leer lo que haga falta en una emergencia (nada lo llama desde la pantalla).
export async function gastosConectada() { try { const cx = await GB.conexion(); return cx.estado === 'ok'; } catch (e) { return false; } }
// Materia prima nueva (pedida en Cocina y creada en Producción): su precio neto por la unidad de compra, origen "A mano".
// datos: { nombre, tipo 'mp'|'insumo', unidadCompra ('kg', '25kg', '10un'…), precioNeto }. 2 escrituras (el precio y su historial).
// v0.76.0 (Finanzas → Costos → Nueva materia prima o insumo): también contenido { cantidad, unidad g|ml|un } escrito (no se adivina de la
// unidad de compra), motivo, creadaDesde y sii (la línea de factura de la que sale: el precio queda con origen "SII" de esa compra, así
// la revisión de compras lo reconoce como "Es el precio actual" y no lo repite).
export async function crearPrecioMp(id, datos) {
  const db = await dbG(), hoy = hoyTxt(), por = yo(), ref = FB.doc(db, 'costos_mp', id);
  const precioNeto = FC.num(datos.precioNeto);
  if (!(precioNeto > 0)) throw new Error('Falta el costo neto.');
  const rc = FC.contenidoValido(datos.contenido) ? { contenido: { cantidad: FC.num(datos.contenido.cantidad), unidad: datos.contenido.unidad }, problema: '', nota: '' } : FC.resolverContenido(datos.unidadCompra, { precioNeto });
  const x = datos.sii || null;
  const sii = x ? { rut: String(x.rut || ''), proveedor: String(x.proveedor || ''), folio: String(x.folio || ''), fecha: String(x.fecha || ''), linea: String(x.linea || ''), nombreItem: String(x.nombreItem || '') } : null;
  const origen = sii ? 'sii' : 'manual', fecha = sii && sii.fecha ? sii.fecha : hoy;
  const motivo = String(datos.motivo || 'Materia prima nueva pedida en Cocina (Producción → Desde Cocina)').slice(0, 300);
  const doc = { nombre: String(datos.nombre || id), tipo: FC.tipoMp(datos.tipo, id), estado: 'activa', unidadCompra: String(datos.unidadCompra || ''),
    contenido: rc.contenido, contenidoProblema: rc.contenido ? '' : rc.problema, contenidoNota: rc.nota, precioNeto, impAdicionalPct: 0, ivaPct: 19,
    precioPorBase: FC.precioPorBase(precioNeto, rc.contenido), origen, fecha, por, anterior: null, pesoPorUnidad: null, sii, creadaDesde: datos.creadaDesde || 'cocina' };
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (sn.exists() && FC.num(sn.data().precioNeto) > 0) return;   // ya tenía precio (un reintento): no se pisa
    tx.set(ref, { ...doc, updatedAt: FB.serverTimestamp() });
    tx.set(FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { mp: id, precioNeto, contenido: rc.contenido, precioPorBase: doc.precioPorBase, origen, motivo, fecha, por, anterior: null, ...(sii ? { sii } : {}), en: FB.serverTimestamp() });
  });
  return doc;
}
// v0.76.0: el nombre y el estado (activa | archivada) que cambiaste en la base de Cocina, también en el maestro de costos. Solo si ya está
// ahí (no crea una sin precio). 1 lectura y, si cambia, 1 escritura.
export async function datosMpEnCostos(id, campos) {
  const db = await dbG(), ref = FB.doc(db, 'costos_mp', id), c = {};
  if (campos.nombre !== undefined) c.nombre = String(campos.nombre);
  if (campos.estado !== undefined) c.estado = campos.estado === 'archivada' ? 'archivada' : 'activa';
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) return false;
    const d = sn.data(); if (Object.keys(c).every(k => d[k] === c[k])) return false;
    tx.set(ref, { ...c, updatedAt: FB.serverTimestamp() }, { merge: true });
    return true;
  });
}
// v0.76.0 · "Crear desde esta línea" (Compras del SII): crea la materia prima con el precio de esa compra y asocia el producto del
// proveedor a ella (costos_asoc, se aprende para las próximas facturas), en una sola acción. g: el grupo de Compras del SII (FS.agrupar);
// datos: el formulario. → { id, nombre, revision } (revision: lo que hizo la revisión de compras, o null si falló; no deshace nada)
export async function crearDesdeLinea(g, datos) {
  const u = g && g.ultima; if (!u) throw new Error('Ese producto no tiene una compra para leer.');
  // La unidad de compra de la nueva es la unidad de la factura: lo que trae una unidad de compra = lo que trae una unidad facturada.
  // El precio es el de la factura (origen SII de esa compra) salvo que lo hayas cambiado: entonces queda "A mano", de hoy.
  const unitario = FS.precioUnitarioNeto(u), escrito = FC.num(datos.precio) > 0 ? (datos.conIva ? FC.num(datos.precio) / 1.19 : FC.num(datos.precio)) : 0;
  const precioDeSii = unitario > 0 && Math.abs(escrito - unitario) < 0.5;
  const sii = { rut: g.rut, proveedor: g.proveedor, folio: u.folio, fecha: u.fecha, linea: u.id, nombreItem: u.descripcion };
  const r = await P.crearMp(datos, { sii, precioDeSii });
  const c = r.v.contenido, cont = c.unidad === 'g' ? { cantidad: c.cantidad / 1000, unidad: 'kg' } : c.unidad === 'ml' ? { cantidad: c.cantidad / 1000, unidad: 'l' } : { cantidad: c.cantidad, unidad: 'un' };
  await guardarAsociacion(g.clave, { rut: g.rut, proveedor: g.proveedor, nombreItem: g.nombreItem, codigo: g.codigo, ignorar: false, mp: r.id, contenido: cont, nota: 'Creada desde esta línea' });
  let revision = null;
  try { revision = await preciosDesdeSii({ origen: 'asociacion' }); } catch (e) { revision = null; }
  return { ...r, precioDeSii, revision };
}

// v0.76.0: lo que la pantalla de Costos pide a la base de Cocina (produccion.js: el mismo ID, transacción y memoria que las pedidas)
export const crearMateriaPrima = datos => P.crearMp(datos);
export const editarMateriaPrima = (id, datos) => P.editarMp(id, datos);
export const archivarMateriaPrima = (id, archivar) => P.archivarMp(id, archivar);

// ── Editar un precio a mano (con motivo) ──
export async function guardarPrecio(id, datos) {
  const db = await dbG(), ref = FB.doc(db, 'costos_mp', id), hoy = hoyTxt(), por = yo();
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Esa materia prima no está en el maestro de costos (Finanzas → Costos). Avísame: desde la v0.73.0 cada materia prima nueva entra con su precio al crearla en Producción.');
    const actual = { id, ...sn.data() };
    const { doc, hist } = FC.edicion(actual, datos, { hoy, por });
    tx.set(ref, { ...doc, updatedAt: FB.serverTimestamp() }, { merge: true });
    tx.set(FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { ...hist, mp: id, en: FB.serverTimestamp() });
    return { ...actual, ...doc };
  }).then(async r => { await recalcularTrasPrecio(); return r; });
}
export async function historial(id) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'costos_mp_hist'), FB.where('mp', '==', id)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (t(b.en) - t(a.en)) || String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

// ── Revisión de datos: marcar revisado / volver a la lista (queda en su historial) ──
export async function marcarRevisado(item, revisado = true) {
  const db = await dbG(), ref = FB.doc(db, 'costos_revision', FC.idRevision(item.clave)), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { accion: revisado ? 'revisado' : 'devuelto a la lista', por, fecha, huella: item.huella }].slice(-30);
    tx.set(ref, { clave: item.clave, grupo: item.grupo, titulo: item.titulo, huella: item.huella, revisado: revisado ? { por, fecha } : null, historial, updatedAt: FB.serverTimestamp() });
  });
}

// ═══════════════ v0.57.0 · Precio desde la última compra del SII ═══════════════
const lista = sn => sn.docs.map(d => ({ id: d.id, d: d.data() }));
const mapa = sn => { const m = {}; sn.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() }; }); return m; };
// Todo lo que necesita "Compras del SII": líneas de los últimos 90 días, asociaciones, maestro, revisadas y por confirmar
export async function leerCompras() {
  const db = await dbG();
  const [docs, as, c, pr, pc, rv, gn] = await Promise.all(['sii_docs', 'costos_asoc', 'costos_mp', 'costos_sii_procesadas', 'costos_por_confirmar', 'costos_sii_revisiones'].map(n => FB.getDocs(FB.collection(db, n)))
    .concat([gnActivo() ? FB.getDocs(FB.collection(db, 'gn_documentos')) : Promise.resolve(null)]));
  // v0.101.1 · Con el Gastos nuevo: hasta antes del inicio, las compras del Gastos anterior (sii_docs); desde el inicio, las del Gastos nuevo
  const ini = gnActivo() ? inicioGN() : '', antes = lista(docs).filter(x => !ini || FS.fechaDocSii(x.d) < ini);
  const deGN = gn ? FS.siiDocsDeGN(gn.docs.map(x => ({ id: x.id, ...x.data() })), ini) : [];
  const { lineas, sinDetalle, desde } = FS.lineasCompras(antes.concat(deGN), { hoy: hoyTxt() });
  const revisiones = rv.docs.map(d => d.data()).sort((a, b) => String(b.cuando || '').localeCompare(String(a.cuando || '')));
  const porConfirmar = Object.values(mapa(pc));
  return { lineas, sinDetalle, desde, asocs: mapa(as), costos: mapa(c), procesadas: mapa(pr), porConfirmar, pendientes: porConfirmar.filter(p => p.estado === 'pendiente'), ultimaRevision: revisiones[0] || null };
}

// Revisa las compras de los últimos 90 días y aplica los precios (idempotente). origen: 'importacion' | 'boton' | 'asociacion'
export async function preciosDesdeSii({ origen = 'boton' } = {}) {
  const db = await dbG(), por = yo(), hoy = hoyTxt(), ahora = FB.serverTimestamp();
  const x = await leerCompras();
  const plan = FS.planPrecios({ lineas: x.lineas, asocs: x.asocs, costos: x.costos, procesadas: x.procesadas, pendientes: x.pendientes });
  const ops = [], aplicadas = [];
  plan.aplicar.forEach(({ mp, cand, d }) => {
    const m = x.costos[mp], { doc, hist } = FS.docAplicar(m, cand, d, { por });
    ops.push(['set', FB.doc(db, 'costos_mp', mp), { ...doc, updatedAt: ahora }, true]);
    ops.push(['set', FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { ...hist, mp, en: ahora }]);
    aplicadas.push({ mp, nombre: m.nombre || mp, antes: m.precioPorBase ?? null, despues: d.nuevo.precioPorBase, unidad: d.nuevo.contenido.unidad, pct: d.pct });
  });
  plan.confirmar.forEach(({ mp, cand, d }) => {
    const m = x.costos[mp];
    ops.push(['set', FB.doc(db, 'costos_por_confirmar', idNuevo('pc-')), { mp, mpNombre: m.nombre || mp, estado: 'pendiente', pct: d.pct, motivo: d.motivo,
      actual: { precioNeto: m.precioNeto ?? null, precioPorBase: m.precioPorBase ?? null, contenido: m.contenido || null, origen: m.origen || '', fecha: m.fecha || '' },
      nuevo: d.nuevo, cand: { ...cand }, sii: { rut: cand.rut, proveedor: cand.proveedor, folio: cand.folio, fecha: cand.fecha, linea: cand.linea, nombreItem: cand.nombreItem },
      creada: { fecha: hoy, por, origen }, resuelta: null, en: ahora }]);
  });
  plan.reemplazar.forEach(id => ops.push(['set', FB.doc(db, 'costos_por_confirmar', id), { estado: 'reemplazada', resuelta: { por, fecha: hoy, motivo: 'Llegó una compra más nueva' }, updatedAt: ahora }, true]));
  plan.marcar.forEach(m => ops.push(['set', FB.doc(db, 'costos_sii_procesadas', FS.idLinea(m.linea.id)), { linea: m.linea.id, asoc: m.asoc, mp: m.mp, huella: m.huella, resultado: m.resultado, motivo: m.motivo,
    folio: m.linea.folio, rut: m.linea.rut, fechaFactura: m.linea.fecha, fecha: hoy, por, en: ahora }]));
  for (let i = 0; i < ops.length; i += LOTE) {
    const b = FB.writeBatch(db);
    ops.slice(i, i + LOTE).forEach(([, ref, d, merge]) => (merge ? b.set(ref, d, { merge: true }) : b.set(ref, d)));
    await b.commit();
  }
  const sinAsociar = FS.agrupar(x.lineas, x.asocs).filter(g => g.estado === 'sin_asociar' && g.ultima).length;
  const r = { aplicadas, porConfirmar: plan.confirmar.length, omitidas: plan.marcar.filter(m => m.resultado === 'omitida').length, revisadas: plan.marcar.length, sinAsociar, sinDetalle: x.sinDetalle.length };
  if (aplicadas.length) await recalcularTrasPrecio();
  if (ops.length || origen === 'boton') await FB.setDoc(FB.doc(db, 'costos_sii_revisiones', idNuevo('r-')), { cuando: new Date().toISOString(), fecha: hoy, por, origen, aplicadas: aplicadas.length, porConfirmar: r.porConfirmar, omitidas: r.omitidas, revisadas: r.revisadas, en: ahora });
  return r;
}
// Después de importar del SII en Gastos: nunca falla hacia afuera (solo devuelve el aviso)
export async function preciosTrasImportar() {
  try { const cx = await GB.conexion(); if (cx.estado !== 'ok') return null; return await preciosDesdeSii({ origen: 'importacion' }); }
  catch (e) { console.warn('Finanzas: no se pudieron revisar los precios del SII', e); return { error: e.message || String(e) }; }
}

// Guardar (o cambiar) una asociación; queda su historial
export async function guardarAsociacion(clave, datos) {
  const db = await dbG(), ref = FB.doc(db, 'costos_asoc', clave), hoy = hoyTxt(), por = yo();
  const mpDoc = datos.mp ? await FB.getDoc(FB.doc(db, 'costos_mp', datos.mp)) : null;
  if (datos.mp && !datos.ignorar && !(mpDoc && mpDoc.exists())) throw new Error('Esa materia prima no está en el maestro de costos.');
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    const { doc, hist } = FS.armarAsociacion(prev, datos, { hoy, por, mpDoc: mpDoc && mpDoc.exists() ? { id: datos.mp, ...mpDoc.data() } : null });
    tx.set(ref, { ...doc, updatedAt: FB.serverTimestamp() });
    if (hist) tx.set(FB.doc(db, 'costos_asoc_hist', idNuevo('a-')), { ...hist, asoc: clave, en: FB.serverTimestamp() });
    return doc;
  });
}
export async function historialAsoc(clave) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'costos_asoc_hist'), FB.where('asoc', '==', clave)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => d.data()).sort((a, b) => t(b.en) - t(a.en));
}

// Confirmar o descartar un cambio de más de ±40 %
export async function resolverPorConfirmar(id, confirmar, motivo) {
  const db = await dbG(), ref = FB.doc(db, 'costos_por_confirmar', id), hoy = hoyTxt(), por = yo(), mot = String(motivo || '').trim().slice(0, 300);
  if (!confirmar && !mot) throw new Error('Escribe por qué lo descartas.');
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese cambio ya no está.');
    const p = sn.data();
    if (p.estado !== 'pendiente') throw new Error('Ese cambio ya se resolvió.');
    if (!confirmar) { tx.set(ref, { estado: 'descartada', resuelta: { por, fecha: hoy, motivo: mot }, updatedAt: FB.serverTimestamp() }, { merge: true }); return { descartada: true }; }
    const refM = FB.doc(db, 'costos_mp', p.mp), sm = await tx.get(refM);
    const m = sm.exists() ? { id: p.mp, ...sm.data() } : null;
    const d = FS.decidir(m, p.cand, { forzar: true });
    if (d.accion !== 'aplicar') throw new Error(`No se puede aplicar: ${d.motivo}. Descártalo con su motivo.`);
    const { doc, hist } = FS.docAplicar(m, p.cand, d, { por, motivo: `Compra del SII confirmada (${d.pct > 0 ? '+' : ''}${Math.round(d.pct)} %): ${p.sii.proveedor} F.${p.sii.folio} (${p.sii.nombreItem})${mot ? ' · ' + mot : ''}` });
    tx.set(refM, { ...doc, updatedAt: FB.serverTimestamp() }, { merge: true });
    tx.set(FB.doc(db, 'costos_mp_hist', idNuevo('h-')), { ...hist, mp: p.mp, en: FB.serverTimestamp() });
    tx.set(ref, { estado: 'confirmada', resuelta: { por, fecha: hoy, motivo: mot }, updatedAt: FB.serverTimestamp() }, { merge: true });
    return { confirmada: true, nombre: m.nombre };
  }).then(async r => { if (r && r.confirmada) await recalcularTrasPrecio(); return r; });
}

// Hoy: cuántos precios hay por confirmar (null si fen-gastos no está conectada)
export async function porConfirmarParaHoy() {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'costos_por_confirmar'), FB.where('estado', '==', 'pendiente')));
  return sn.docs.map(d => d.data().mpNombre || d.data().mp);
}
// v0.80.1 · Hoy: los productos del Catálogo que se venden con la receta pendiente (1 consulta; 1 lectura si no hay ninguno)
// 2 minutos en memoria (volver a Hoy: 0 lecturas); cualquier cambio del Catálogo la olvida (olvidarMaestro)
let pendHoyMem = null;
export async function recetaPendienteParaHoy() {
  if (pendHoyMem && Date.now() - pendHoyMem.t < 120000) return pendHoyMem.v;
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const sn = await FB.getDocs(FB.query(FB.collection(cx.db, 'cat_productos'), FB.where('recetaPendiente', '==', true)));
  const v = sn.docs.map(d => ({ ...d.data(), id: d.id })).filter(p => p.estado !== 'archivado' && p.tipo === 'receta').map(p => p.nombre || p.id).sort((a, b) => String(a).localeCompare(String(b), 'es'));
  pendHoyMem = { t: Date.now(), v };
  return v;
}

// ═══════════════ v0.58.0 · Costo directo por producto (motor de costeo) ═══════════════
// Recetas, materias primas y configuración de fen-produccion (sin costos) + el maestro de costos de fen-gastos
// v0.63.2: recetas, materias primas y configuración de fen-produccion quedan 10 minutos en memoria (antes se leían enteras cada
// vez que se abría Costos, Márgenes o Hoy: ~270 lecturas en la base de Cocina cada vez)
// v0.63.3: esa memoria ahora es la de produccion.js (fs-memoria.js), compartida con Hoy y Producción (y guardada en este navegador)
export const olvidarProduccion = () => { P.olvidarMemoria(); };
async function prodMotor() {
  return Promise.all([P.mpsYRecetas(), P.leerConfigs().catch(() => ({}))]);
}
export async function datosMotor({ costos } = {}) {
  const [[prod, cfg], c] = await Promise.all([prodMotor(), costos ? Promise.resolve(costos) : leerColeccion('costos_mp')]);
  return { recetas: prod.recetas || [], mps: prod.mps || [], config: cfg || {}, costos: c };
}
async function leerColeccion(nombre) { const db = await dbG(); return mapa(await FB.getDocs(FB.collection(db, nombre))); }
let ultimoCalculo = 0, ultimoRes = null;
export const ultimoResultado = () => ultimoRes;
// Calcula todas las recetas aprobadas y guarda lo que cambió (costos_recetas) y el historial (más de 0,5 %).
// → { resultados, docs (costos_recetas actualizados), cambios (entradas nuevas del historial), escritos }
// v0.63.2: si los precios, las recetas y la configuración son los mismos del último cálculo (misma huella) y el día no cambió,
// no se recalcula ni se escribe nada (antes, cada apertura de Costos pasados 2 minutos).
let huellaCalculo = '';
const huellaDe = (ctx, hoy) => { const t = JSON.stringify([hoy, ctx.recetas, ctx.mps, ctx.config, ctx.costos]); let h1 = 2166136261, h2 = 5381; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + t.length; };
export async function recalcularRecetas({ costos, forzar = false } = {}) {
  const db = await dbG(), hoy = hoyTxt(), cuando = new Date().toISOString();
  const ctx = await datosMotor({ costos }), huella = huellaDe(ctx, hoy);
  if (!forzar && ultimoRes && huella === huellaCalculo) { ultimoCalculo = Date.now(); return { ...ultimoRes, escritos: 0, sinCambios: true }; }
  const act = await leerColeccion('costos_recetas');
  const resultados = FM.costearTodo(ctx);
  const nombres = {}; Object.entries(ctx.costos).forEach(([id, m]) => { nombres[id] = m.nombre || id; });
  const plan = FM.planGuardar(resultados, act, { hoy, cuando, nombres });
  const ops = [];
  plan.docs.forEach(x => ops.push(['set', FB.doc(db, 'costos_recetas', x.id), { ...x.doc, updatedAt: FB.serverTimestamp() }]));
  plan.hist.forEach(h => ops.push(['set', FB.doc(db, 'costos_recetas_hist', idNuevo('rh-')), { ...h, por: yo(), en: FB.serverTimestamp() }]));
  for (let i = 0; i < ops.length; i += LOTE) {
    const b = FB.writeBatch(db);
    ops.slice(i, i + LOTE).forEach(([, ref, d]) => b.set(ref, d));
    await b.commit();
  }
  ultimoCalculo = Date.now();
  const docs = { ...act }; plan.docs.forEach(x => { docs[x.id] = { id: x.id, ...x.doc }; });
  ultimoRes = { resultados, docs, cambios: plan.hist, escritos: ops.length, ctx, cuando };
  huellaCalculo = huella;
  return ultimoRes;
}
// Después de cambiar un precio: recalcula (si fen-produccion no está conectada, no hace nada; nunca falla hacia afuera)
export async function recalcularTrasPrecio() {
  try { const cx = await P.conexion(); if (cx.estado !== 'ok') return null; return await recalcularRecetas(); }
  catch (e) { console.warn('Finanzas: no se pudo recalcular el costo de los productos', e); return null; }
}
export const calculadoHace = () => (ultimoCalculo ? Date.now() - ultimoCalculo : Infinity);

// Lo que muestra Productos: costos_recetas, su historial, el % de aviso y los "visto"
export async function leerProductos() {
  const db = await dbG();
  const [r, h, c, v] = await Promise.all([FB.getDocs(FB.collection(db, 'costos_recetas')), FB.getDocs(FB.collection(db, 'costos_recetas_hist')),
    FB.getDoc(FB.doc(db, 'costos_config', 'finanzas')), FB.getDocs(FB.collection(db, 'costos_alzas_vistas'))]);
  const cfg = c.exists() ? c.data() : {};
  return { docs: mapa(r), hist: h.docs.map(d => ({ id: d.id, ...d.data() })), alzaAviso: Number(cfg.alzaAviso) > 0 ? Number(cfg.alzaAviso) : FM.ALZA_DEFECTO, config: cfg, vistas: mapa(v) };
}
export async function guardarAjustes({ alzaAviso }) {
  const x = Number(String(alzaAviso).replace(',', '.'));
  if (!(x > 0 && x <= 100)) throw new Error('Escribe un porcentaje entre 0,1 y 100.');
  const db = await dbG(), ref = FB.doc(db, 'costos_config', 'finanzas'), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { alzaAviso: x, antes: prev.alzaAviso ?? FM.ALZA_DEFECTO, por, fecha }].slice(-50);
    tx.set(ref, { ...prev, alzaAviso: x, historial, updatedAt: FB.serverTimestamp() });
  });
  return x;
}
// "Visto" de un aviso de alza: no vuelve a avisar con este costo (si sube otra vez, avisa de nuevo)
export async function marcarAlzaVista(recetaId, costoUnit, pct) {
  const db = await dbG(), ref = FB.doc(db, 'costos_alzas_vistas', recetaId), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { costoUnit, pct: pct ?? null, por, fecha }].slice(-50);
    tx.set(ref, { costoUnit, pct: pct ?? null, fecha, por, historial, updatedAt: FB.serverTimestamp() });
  });
}
// Hoy: productos cuyo costo subió más del % de aviso contra el mes anterior (null si fen-gastos no está conectada)
export async function alzasParaHoy() {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const x = await leerProductos();
  return { lista: FM.alzas(FM.filasProductos(x.docs, x.hist, hoyTxt()), x.vistas, x.alzaAviso), umbral: x.alzaAviso };
}
// Merma: costo neto por unidad de cada ítem con este motor. items: [{ tipo: 'receta'|'mp', id, unidad }]
// → { 'tipo:id:unidad': { neto, incompleto } } (lo que no se pudo costear no viene). null si fen-gastos no está conectada.
export async function costosMerma(items) {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const ctx = await datosMotor();
  const motor = FM.crearMotor(ctx), out = {};
  (items || []).forEach(it => { const c = FM.costoUnitario(motor, ctx.costos, it); if (c) out[`${it.tipo}:${it.id}:${it.unidad}`] = c; });
  return out;
}

// v0.63.6: Recetas por aprobar (Producción → Desde Cocina): propuesta vs vigente con el costo neto del motor (null si fen-gastos no está)
export async function costosPropuesta(prop) {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const [ctx, vinc] = await Promise.all([datosMotor(), leerVinculos().catch(() => ({}))]);
  return FM.compararPropuesta(ctx, prop, vinc);
}
// v0.77.1: Producción → Por revisar muestra el costo de todas las propuestas en la lista: una sola lectura de los precios
// (de la memoria de fen-gastos) para todas. → [comparación | null] en el mismo orden (null si fen-gastos no está conectada)
export async function costosPropuestas(props) {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return (props || []).map(() => null);
  const [ctx, vinc] = await Promise.all([datosMotor(), leerVinculos().catch(() => ({}))]);
  return (props || []).map(p => { try { return FM.compararPropuesta(ctx, p, vinc); } catch (e) { return null; } });
}
// v0.77.1: Producción → Recetas: el costo guardado de cada receta y su historial (sin recalcular; null si fen-gastos no está)
export async function costosRecetas() {
  const cx = await GB.conexion().catch(() => null);
  if (!cx || cx.estado !== 'ok') return null;
  const x = await leerProductos();
  return { docs: x.docs, hist: x.hist };
}

// ═══════════════ v0.59.0 · Ventas por producto, área y canal (F2 paso 1) ═══════════════
// Catálogos (una lectura por sesión): productos de la caja (fen-ventas) y de B2B (fen-b2b, si está conectada)
let catB2b = null;
async function catalogos() {
  const caja = {}; (await Caja.productos()).forEach(p => { caja[p.id] = p; });
  let b2b = {}, b2bEstado = 'ok', lecturas = 0;
  try {
    const cx = await B.conexion();
    b2bEstado = cx.estado;
    if (cx.estado === 'ok') {
      if (!catB2b) { const sn = await FBB.getDocs(FBB.collection(cx.db, 'productos')); catB2b = {}; sn.docs.forEach(d => { catB2b[d.id] = { id: d.id, ...d.data() }; }); lecturas += Math.max(1, sn.docs.length); }
      b2b = catB2b;
    }
  } catch (e) { b2bEstado = 'error'; }
  return { caja, b2b, b2bEstado, lecturas };
}
// Recetas para asociar: las de fen-produccion (id, nombre, área, tipo, estado); si no está conectada, las del último costeo
let recetasCache = null;
let recetasVer = -1;
export async function recetasVenta(forzar) {
  if (recetasVer !== P.versionDatos) { recetasCache = null; recetasVer = P.versionDatos; }   // v0.72.0: después de archivar o reactivar
  if (recetasCache && !forzar) return recetasCache;
  try {
    const x = (await prodMotor())[0];
    recetasCache = (x.recetas || []).filter(r => !/borrador/i.test(String(r.estado || ''))).map(r => ({ id: r.id, nombre: r.nombre || r.id, area: r.area || '', tipo: r.tipo || 'receta', estado: r.estado || '' }));
    // v0.72.0: las archivadas siguen en la lista (un vínculo antiguo se ve con su nombre), pero no se proponen ni se ofrecen
  } catch (e) {
    const docs = await leerColeccion('costos_recetas').catch(() => ({}));
    recetasCache = Object.values(docs).map(d => ({ id: d.id, nombre: d.nombre || d.id, area: d.area || '', tipo: d.tipo || 'receta', estado: 'aprobada' }));
    recetasCache.sinProduccion = true;
  }
  recetasCache.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return recetasCache;
}
export async function leerVinculos() { return leerColeccion('fin_productos'); }
// v0.72.0 · Catálogo: los mismos catálogos (caja y B2B, una lectura por sesión) y saber si fen-gastos está conectada
export async function catalogosVenta() { return catalogos(); }
export function olvidarCatalogoB2b() { catB2b = null; }
// v0.74.0 · Catálogo (Etapa 2): el maestro de productos (fen-gastos cat_productos, con la memoria de fs-gastos) y el vínculo
// producto → receta que sale de él. Lo usan Finanzas (márgenes, estado de resultados) y el Plan de Panadería.
// → { lista, config, desde (vigenteDesde 'AAAA-MM'), vinc { clave: vínculo } } | null (sin maestro o sin la base conectada)
export async function leerMaestro() {
  const db = await dbG();
  const [sn, cfg] = await Promise.all([FB.getDocs(FB.collection(db, 'cat_productos')), FB.getDoc(FB.doc(db, 'cat_config', 'productos')).catch(() => null)]);
  return { lista: sn.docs.map(d => ({ ...d.data(), id: d.id })), config: cfg && cfg.exists() ? cfg.data() : null };
}
let maestroMem = null;
export const olvidarMaestro = () => { maestroMem = null; pendHoyMem = null; };   // v0.80.1: + lo de Hoy (receta pendiente)
export async function maestroFinanzas(forzar = false) {
  if (maestroMem && !forzar && Date.now() - maestroMem.t < 120000) return maestroMem.v;
  let v = null;
  try {
    // Sin catálogo todavía (cat_config/productos no existe): 1 lectura, y nada más hasta que se arme o se cree un producto
    const db = await dbG(), cfg = await FB.getDoc(FB.doc(db, 'cat_config', 'productos')).catch(() => null);
    if (!cfg || !cfg.exists()) { maestroMem = { t: Date.now(), v: null }; return null; }
    const [lista, recetas, rev, fin] = await Promise.all([FB.getDocs(FB.collection(db, 'cat_productos')).then(sn => sn.docs.map(d => ({ ...d.data(), id: d.id }))), recetasVenta().catch(() => []), leerColeccion('cat_reventa').catch(() => ({})), leerVinculos().catch(() => ({}))]);
    const m = { lista, config: cfg.data() };
    if (m.lista.length) v = { lista: m.lista, config: m.config, desde: (m.config && m.config.vigenteDesde) || '', vinc: CPM.vinculosMaestro(m.lista, { recetas, reventa: Object.values(rev), fin }) };
  } catch (e) { v = null; }
  maestroMem = { t: Date.now(), v };
  return v;
}

// Un mes de la caja, sin caché: los resúmenes de sus cierres + las cajas del mes (para saber si falta alguno o hay abiertas)
async function cajaDelMes(mes, hoy) {
  const desde = `${mes}-01`, hasta = mes === FV.mesDe(hoy) ? hoy : FV.ultimoDia(mes);
  const [sn, cajas] = await Promise.all([getDocsV(queryV(colV(dbV, 'resumenes_caja'), whereV('fecha', '>=', desde), whereV('fecha', '<=', hasta))), Caja.cajasDelRango(desde, hasta)]);
  const res = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => (r.fecha || '') >= desde && (r.fecha || '') <= hasta);
  const conRes = new Set(res.map(r => r.cajaId || r.id));
  const abiertas = cajas.filter(c => c.estado !== 'cerrada');
  const faltan = cajas.filter(c => c.estado === 'cerrada' && !conRes.has(c.id));
  return { res, abiertas, faltan, lecturas: Math.max(1, sn.docs.length) + Math.max(1, cajas.length) };
}
// Ventas del período por mes y canal: de fin_ventas_mes si el mes ya está guardado; si no, de las fuentes (y se guarda si el mes está cerrado).
// forzar: no usa lo guardado (lo vuelve a leer y lo rehace).
export async function ventasPeriodo(per, { forzar = false, avance } = {}) {
  const db = await dbG(), hoy = hoyTxt(), por = yo();
  const cat = await catalogos();
  let lecturas = cat.lecturas;
  const meses = [], lineas = [], faltanTodas = [], porMes = [];
  const conB2b = cat.b2bEstado === 'ok';
  for (const mes of per.meses) {
    if (avance) avance(mes);
    const info = { mes, caja: null, b2b: null };
    const pm = { mes, lineas: [], medios: null, ordenes: 0 };   // v0.60.0: por mes (costo del mes, comisión por medio de pago, despacho por orden)
    let [gc, gb] = forzar ? [null, null] : await Promise.all(['caja', 'b2b'].map(c => FB.getDoc(FB.doc(db, 'fin_ventas_mes', `${mes}_${c}`)).catch(() => null)));
    if (!forzar) lecturas += 2;
    // v0.112.0 · Sin conexión a B2B, aunque se pida leer de nuevo, vale lo guardado (no se pierden las ventas B2B del mes)
    if (forzar && !conB2b) { gb = await FB.getDoc(FB.doc(db, 'fin_ventas_mes', `${mes}_b2b`)).catch(() => null); lecturas += 1; }
    // Caja
    if (gc && gc.exists()) { const d = gc.data(); lineas.push(...(d.lineas || [])); pm.lineas.push(...(d.lineas || [])); pm.medios = d.porMedio || null; info.caja = { fuente: 'guardado', cierres: d.cierres || 0, creado: d.creado || '', conMedios: !!d.porMedio }; }
    else {
      const x = await cajaDelMes(mes, hoy); lecturas += x.lecturas;
      const ls = FV.lineasDeResumenes(x.res, cat.caja); lineas.push(...ls); pm.lineas.push(...ls);
      pm.medios = FMG.mediosDeResumenes(x.res, FV.sucursalCaja);
      faltanTodas.push(...x.faltan);
      const guardar = FV.guardable(mes, hoy, { abiertas: x.abiertas.length, faltan: x.faltan.length });
      if (guardar) await FB.setDoc(FB.doc(db, 'fin_ventas_mes', `${mes}_caja`), { ...FV.docMes(mes, 'caja', ls, { cierres: x.res.length, porMedio: pm.medios }), creado: new Date().toISOString(), fecha: hoy, por, en: FB.serverTimestamp() });
      info.caja = { fuente: 'leido', cierres: x.res.length, abiertas: x.abiertas.length, faltan: x.faltan.length, guardado: guardar, conMedios: true };
    }
    // B2B
    if (gb && gb.exists() && (!gb.data().releer || !conB2b)) { const d = gb.data(); lineas.push(...(d.lineas || [])); pm.lineas.push(...(d.lineas || [])); pm.ordenes = d.ordenesValidas ?? d.ordenes ?? 0; info.b2b = { fuente: 'guardado', ordenes: d.ordenes || 0, creado: d.creado || '', ...(d.releer || forzar ? { sinReleer: true } : {}) }; }
    else if (conB2b) {
      const desde = `${mes}-01`, hasta = mes === FV.mesDe(hoy) ? hoy : FV.ultimoDia(mes);
      if (forzar || (gb && gb.exists())) B.olvidarAnalisisB2b();   // v0.112.0: también si se marcó para leer de nuevo (una orden anulada): sin la copia de 5 minutos
      const os = await B.ordenesEntre(desde, hasta); lecturas += Math.max(1, os.length);
      const ls = FV.lineasDeOrdenes(os, cat.b2b); lineas.push(...ls); pm.lineas.push(...ls);
      pm.ordenes = os.filter(o => o && o.estado !== 'anulada' && !o.quitadoEnPlanilla).length;
      const guardar = FV.guardable(mes, hoy);
      if (guardar) await FB.setDoc(FB.doc(db, 'fin_ventas_mes', `${mes}_b2b`), { ...FV.docMes(mes, 'b2b', ls, { ordenes: os.length, ordenesValidas: pm.ordenes }), creado: new Date().toISOString(), fecha: hoy, por, en: FB.serverTimestamp() });
      info.b2b = { fuente: 'leido', ordenes: os.length, guardado: guardar };
    } else info.b2b = { fuente: 'sin_conexion' };
    meses.push(info);
    pm.lineas = FV.conCatalogo(pm.lineas, cat.caja, cat.b2b);
    porMes.push(pm);
  }
  return { lineas: FV.conCatalogo(FV.juntar(lineas), cat.caja, cat.b2b), meses, porMes, lecturas, b2bEstado: cat.b2bEstado, faltan: faltanTodas, catalogo: { caja: cat.caja, b2b: cat.b2b } };
}
// "Generar los que faltan": los resúmenes de cierres que no lo tienen (igual que Ventas de caja → Reportes)
export async function generarResumenesFaltantes(cajas, avance) { return Caja.generarResumenes(cajas, avance); }

// Guardar (o cambiar) el vínculo de un producto; queda su historial
export async function guardarVinculo(datos) {
  const db = await dbG(), hoy = hoyTxt(), por = yo(), recetas = await recetasVenta();
  const clave = FV.claveProducto(datos.canal === 'b2b' ? 'b2b' : 'caja', datos.productoId), ref = FB.doc(db, 'fin_productos', clave);
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    const { doc, hist } = FV.armarVinculo(prev, datos, { recetas, hoy, por });
    tx.set(ref, { ...doc, updatedAt: FB.serverTimestamp() });
    if (hist) tx.set(FB.doc(db, 'fin_productos_hist', idNuevo('vp-')), { ...hist, en: FB.serverTimestamp() });
    return { clave, doc };
  });
}
// Confirmar de una vez los vínculos que ya vienen del catálogo (ID de receta de la caja o de B2B que existe en Producción)
export async function confirmarCatalogo(items) {
  const db = await dbG(), hoy = hoyTxt(), por = yo(), recetas = await recetasVenta();
  const ops = [];
  (items || []).forEach(p => {
    if (!p.propuesta || p.propuesta.origen !== 'catalogo') return;
    const { doc, hist } = FV.armarVinculo(null, { canal: p.canal, productoId: p.productoId, nombre: p.nombre, tipo: 'receta', receta: p.propuesta.receta, unidadesPorVenta: 1, origen: 'catalogo' }, { recetas, hoy, por });
    ops.push([FB.doc(db, 'fin_productos', p.clave), { ...doc, updatedAt: FB.serverTimestamp() }]);
    ops.push([FB.doc(db, 'fin_productos_hist', idNuevo('vp-')), { ...hist, en: FB.serverTimestamp() }]);
  });
  for (let i = 0; i < ops.length; i += LOTE) { const b = FB.writeBatch(db); ops.slice(i, i + LOTE).forEach(([ref, d]) => b.set(ref, d)); await b.commit(); }
  return ops.length / 2;
}
// v0.69.1 · "Pasar los productos de reventa al área REVENTA": una sola vez, con confirmación. Cada vínculo de reventa que no
// está en REVENTA se lee en una transacción (si cambió mientras tanto, se usa lo nuevo; si ya no es reventa o ya está en
// REVENTA, no se toca), se cambia solo el área y queda su historial. Nada se borra. Lecturas: 1 por vínculo; escrituras: 2.
export const LOTE_REVENTA = 150;
export async function pasarReventaArea(claves) {
  const db = await dbG(), hoy = hoyTxt(), por = yo(), lista = [...new Set((claves || []).filter(Boolean))];
  let n = 0;
  const cambiados = {};
  for (let i = 0; i < lista.length; i += LOTE_REVENTA) {
    const parte = lista.slice(i, i + LOTE_REVENTA);
    const r = await FB.runTransaction(db, async tx => {
      const refs = parte.map(c => FB.doc(db, 'fin_productos', c));
      const sns = await Promise.all(refs.map(ref => tx.get(ref)));
      const hechos = {};
      sns.forEach((sn, k) => {
        if (!sn.exists()) return;
        const prev = sn.data();
        if (!prev || prev.tipo !== 'reventa' || prev.area === FV.REVENTA) return;
        const doc = { ...prev, area: FV.REVENTA, fecha: hoy, por, origen: 'reventa_v0691', nota: 'Pasado al área REVENTA (v0.69.1)' };
        delete doc.updatedAt;
        const corto = x => ({ tipo: x.tipo, receta: x.receta || null, recetaNombre: x.recetaNombre || '', unidadesPorVenta: x.unidadesPorVenta ?? 1, area: x.area || '', costoReventaNeto: x.costoReventaNeto ?? null, ...(x.costoExtraNeto !== null && x.costoExtraNeto !== undefined ? { costoExtraNeto: x.costoExtraNeto } : {}) });
        tx.set(refs[k], { ...doc, updatedAt: FB.serverTimestamp() });
        tx.set(FB.doc(db, 'fin_productos_hist', idNuevo('vp-')), { clave: parte[k], nombre: prev.nombre || '', accion: 'cambio', antes: corto(prev), despues: corto(doc), origen: 'reventa_v0691', nota: doc.nota, fecha: hoy, por, en: FB.serverTimestamp() });
        hechos[parte[k]] = doc;
      });
      return hechos;
    });
    Object.assign(cambiados, r); n += Object.keys(r).length;
  }
  return { n, cambiados, lecturas: lista.length, escrituras: n * 2 };
}
export async function historialVinculo(clave) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'fin_productos_hist'), FB.where('clave', '==', clave)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => d.data()).sort((a, b) => t(b.en) - t(a.en));
}

// ═══════════════ v0.60.0 · Margen de contribución (F2 paso 2) ═══════════════
// Ajustes de márgenes: costos_config/finanzas, campo "margenes" (comisiones, mezcla de la caja, despacho B2B, margen objetivo, redondeo); historial
export async function guardarAjustesMargenes(datos) {
  const x = FMG.validarConfig(datos);
  const db = await dbG(), ref = FB.doc(db, 'costos_config', 'finanzas'), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historialMargenes = [...(Array.isArray(prev.historialMargenes) ? prev.historialMargenes : []), { antes: prev.margenes || null, despues: x, por, fecha }].slice(-50);
    tx.set(ref, { ...prev, margenes: x, historialMargenes, updatedAt: FB.serverTimestamp() });
  });
  return FMG.configMargenes(x);
}

// ═══════════════ v0.61.0 · Resultados (F3 paso 1): clasificar para el estado de resultados ═══════════════
// Reglas puras en finanzas-resultados.js. Se guarda en fen-gastos (solo administración; las reglas v0.1.0 ya cubren colecciones nuevas):
//  · fin_items/{clave del ítem}   tipo para resultados del ítem: { item, clave, tipo, motivo, origen propuesta|manual, propuesta, fecha, por, version }.
//  · fin_items_hist/{autoId}      solo agregar: { clave, item, antes, despues, origen, fecha, por, en }.
//  · fin_config/resultados        { areasGasto { código: PAN|BOL|PAS|CAF|comun }, historialAreas [{ antes, despues, por, fecha }] }.
//  · fin_creditos/{id}            { nombre, obligacionId, obligacionNombre, modo frances|manual, monto, tasa, n, fechaPrimera, cuota, cuotaManual,
//                                 tabla [{ n, fecha, cuota, interes, capital, saldo }], nota, creado, actualizado, por, version, estado activo|archivado }.
//  · fin_creditos_hist/{autoId}   solo agregar: { credito, accion, antes, despues, fecha, por, en }.
//  · fin_inversiones/{gastoId}    { vidaUtilMeses, fechaInicio, nota, item, valorNeto, fecha, por, historial }.
//  Lee (solo lectura): gastos, items, obligaciones y vencimientos de fen-gastos. No cambia ningún gasto.
// v0.101.1 · Etapa 4, desde cero en octubre (Emmanuel, 25 oct): con el Gastos nuevo, Finanzas parte en el mes del inicio y los gastos salen
// solo del Gastos nuevo (gn-finanzas.js, en la misma forma de una línea). Del Gastos anterior solo quedan las inversiones ya registradas
// (siguen depreciándose: son equipos que se usan hoy); sus vencimientos y obligaciones ya no se leen. Sin el Gastos nuevo (GASTOS_NUEVO
// en false, solo para una emergencia) todo vuelve a ser como antes.
// gn = { D (lo que lee la Bandeja: docs, movs, pagos, cargas, provs, repartos), errores, inicio } | { error, inicio } | null.
let resCache = null;
export const olvidarResultados = () => { resCache = null; };
export const gnActivo = () => typeof window === 'undefined' || !window.FEN_SIS || window.FEN_SIS.GASTOS_NUEVO !== false;
export const inicioGN = () => (typeof window !== 'undefined' && window.FEN_SIS && window.FEN_SIS.INICIO) || '2026-10-01';
// Desde qué mes trabaja Finanzas con el Gastos nuevo ('' = sin el Gastos nuevo: todo como antes)
export const mesInicioGN = () => (gnActivo() ? inicioGN().slice(0, 7) : '');
export const delGastosNuevo = mes => !!mesInicioGN() && String(mes || '') >= mesInicioGN();
export async function leerResultados(forzar) {
  if (resCache && !forzar) return resCache;
  const db = await dbG(), nuevo = gnActivo();
  const col = n => FB.getDocs(FB.collection(db, n)), nada = Promise.resolve({ docs: [] });
  const [g, it, ob, ve, fi, cf, cr, inv, gn] = await Promise.all([col('gastos'), col('items'), nuevo ? nada : col('obligaciones'), nuevo ? nada : col('vencimientos'), col('fin_items'),
    FB.getDoc(FB.doc(db, 'fin_config', 'resultados')), col('fin_creditos'), col('fin_inversiones'), nuevo ? import('./gn-fs.js?v=0.138.0').then(m => m.leer()).catch(e => ({ error: e.message || String(e) })) : Promise.resolve(null)]);
  const lista = sn => sn.docs.map(d => ({ id: d.id, ...d.data() })), fin = mapa(fi);
  let gastos = lista(g), gnInfo = null;
  if (nuevo) {
    // Del anterior, solo las inversiones (de antes del inicio) para su depreciación.
    // v0.102.1 · Se reconocen también por el catálogo de ítems (un ítem antiguo como ACTIVO FIJO apunta a una cuenta 1.5.x) o por su subtipo
    // INVERSIÓN: en Clasificación casi nada se había guardado, y equipos comprados antes de octubre (los refrigeradores de agosto) no se depreciaban.
    const ini = inicioGN(), [GI, PC] = await Promise.all([import('./gn-items.js?v=0.138.0'), import('./plan-cuentas.js?v=0.138.0')]);
    const I = gn && !gn.error && GI.activo(gn.catalogo) ? GI.indice(gn.catalogo) : null;
    const comoInversion = x => { if ((fin[FR.claveItem(x.itemGasto)] || {}).tipo === 'inversion') return x;
      const r = I ? GI.resolver(x.itemGasto, I) : null; if (r && r.ok && PC.tipoDeCuenta(r.cuenta) === 'inversion') return { ...x, catalogo: true, cuenta: r.cuenta, itemOriginal: x.itemGasto, itemGasto: r.nombre };
      if (FR.normalizar(x.subTipo) === 'INVERSION') return { ...x, catalogo: true, cuenta: '1.5.1' };
      return null; };
    const inversiones = gastos.filter(x => String(x.fecha || '').slice(0, 10) < ini).map(comoInversion).filter(Boolean);
    if (gn && gn.error) { gnInfo = { error: gn.error, inicio: ini }; gastos = inversiones; }
    else { const GF = await import('./gn-finanzas.js?v=0.138.0'), P = GF.gastosParaFinanzas(gn, ini); gnInfo = { D: gn, errores: P.errores, inicio: ini, n: P.lineas.length }; gastos = P.lineas.concat(inversiones); }
  }
  resCache = {
    gastos, items: lista(it).filter(x => !x.quitadoEnPlanilla), obligaciones: lista(ob).filter(x => !x.quitadoEnPlanilla), vencimientos: lista(ve),
    fin, config: cf.exists() ? cf.data() : {}, creditos: lista(cr), invGuardadas: mapa(inv), gn: gnInfo, leido: Date.now()
  };
  return resCache;
}
// Guarda el tipo de varios ítems (uno o "Aplicar propuestas"): cada uno en transacción por lotes, con su historial
export async function guardarTipos(lista) {
  const db = await dbG(), hoy = hoyTxt(), por = yo();
  const hechos = [];
  for (let i = 0; i < lista.length; i += 150) {
    const parte = lista.slice(i, i + 150);
    await FB.runTransaction(db, async tx => {
      const refs = parte.map(x => FB.doc(db, 'fin_items', FR.claveItem(x.item))), sns = [];
      for (const r of refs) sns.push(await tx.get(r));
      parte.forEach((x, k) => {
        const prev = sns[k].exists() ? sns[k].data() : null;
        const { doc, hist, igual } = FR.armarClasificacion(prev, x, { hoy, por });
        if (igual) return;
        tx.set(refs[k], { ...doc, updatedAt: FB.serverTimestamp() });
        if (hist) tx.set(FB.doc(db, 'fin_items_hist', idNuevo('ci-')), { ...hist, en: FB.serverTimestamp() });
        hechos.push(doc);
      });
    });
  }
  if (resCache) hechos.forEach(d => { resCache.fin[d.clave] = d; });
  return hechos;
}
export async function historialTipo(clave) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'fin_items_hist'), FB.where('clave', '==', clave)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => d.data()).sort((a, b) => t(b.en) - t(a.en));
}
export async function guardarAreasGasto(m) {
  const x = FR.validarMapa(m);
  const db = await dbG(), ref = FB.doc(db, 'fin_config', 'resultados'), fecha = hoyTxt(), por = yo();
  const out = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const areasGasto = { ...(prev.areasGasto || {}), ...x };
    const historialAreas = [...(Array.isArray(prev.historialAreas) ? prev.historialAreas : []), { antes: prev.areasGasto || null, despues: areasGasto, por, fecha }].slice(-50);
    const d = { ...prev, areasGasto, historialAreas, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    return d;
  });
  if (resCache) resCache.config = out;
  return out;
}
// Crear o cambiar un crédito (la tabla completa se guarda en el documento)
export async function guardarCredito(id, datos) {
  const x = FR.validarCredito(datos);
  const db = await dbG(), fecha = hoyTxt(), por = yo(), cid = id || idNuevo('cr-'), ref = FB.doc(db, 'fin_creditos', cid);
  const doc = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    const d = { ...(prev || {}), ...x, estado: (prev && prev.estado) || 'activo', creado: (prev && prev.creado) || fecha, actualizado: fecha, por, version: (Number(prev && prev.version) || 0) + 1, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    const resumen = c => (c ? { nombre: c.nombre, obligacionId: c.obligacionId, modo: c.modo, monto: c.monto, tasa: c.tasa, n: c.n, cuota: c.cuota, fechaPrimera: c.fechaPrimera } : null);
    tx.set(FB.doc(db, 'fin_creditos_hist', idNuevo('ch-')), { credito: cid, accion: prev ? 'cambio' : 'nuevo', antes: resumen(prev), despues: resumen(x), fecha, por, en: FB.serverTimestamp() });
    return { id: cid, ...d };
  });
  if (resCache) { resCache.creditos = resCache.creditos.filter(c => c.id !== cid).concat([doc]); }
  return doc;
}
export async function archivarCredito(id, archivar) {
  const db = await dbG(), ref = FB.doc(db, 'fin_creditos', id), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Ese crédito ya no existe');
    tx.update(ref, { estado: archivar ? 'archivado' : 'activo', actualizado: fecha, por, version: (Number(sn.data().version) || 0) + 1 });
    tx.set(FB.doc(db, 'fin_creditos_hist', idNuevo('ch-')), { credito: id, accion: archivar ? 'archivado' : 'reactivado', antes: null, despues: null, fecha, por, en: FB.serverTimestamp() });
  });
  if (resCache) { const c = resCache.creditos.find(x => x.id === id); if (c) c.estado = archivar ? 'archivado' : 'activo'; }
}
export async function historialCredito(id) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'fin_creditos_hist'), FB.where('credito', '==', id)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => d.data()).sort((a, b) => t(b.en) - t(a.en));
}
// Vida útil (y fecha de inicio) de una inversión; el historial queda en el mismo documento
export async function guardarInversion(gastoId, datos, info = {}) {
  const x = FR.validarInversion(datos);
  const db = await dbG(), ref = FB.doc(db, 'fin_inversiones', gastoId), fecha = hoyTxt(), por = yo();
  const doc = await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    const historial = [...(prev && Array.isArray(prev.historial) ? prev.historial : []), { antes: prev ? { vidaUtilMeses: prev.vidaUtilMeses, fechaInicio: prev.fechaInicio } : null, despues: { vidaUtilMeses: x.vidaUtilMeses, fechaInicio: x.fechaInicio }, por, fecha }].slice(-30);
    const d = { ...x, item: String(info.item || ''), valorNeto: Number(info.valor) || 0, fecha, por, historial, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    return d;
  });
  if (resCache) resCache.invGuardadas[gastoId] = doc;
  return doc;
}

// ═══════════════ v0.62.0 · Estado de resultados y cierre de mes (F3 paso 2) ═══════════════
// Reglas puras en finanzas-eerr.js. Se guarda en fen-gastos (solo administración; las reglas v0.1.0 ya cubren colecciones nuevas):
//  · fin_cierres/{AAAA-MM}   snapshot del mes cerrado: { mes, estado cerrado|reabierto, filas, canal, info, cuadratura, detalle, avisos,
//                            costosUsados, checks, override { motivo, fallas } | null, ajustes { total, porMes } | null, cerradoPor, cerradoEn, version }.
//                            Un mes cerrado se lee de aquí (congelado). Reabrir lo deja en "reabierto" (el snapshot anterior queda en el historial).
//  · fin_cierres_hist/{autoId}  solo agregar: { mes, accion cerrado|reabierto, por, fecha, en, motivo, override, resultado, snapshotAnterior }.
//  · fin_config/claves       claves de reparto de los comunes (vista secundaria): { bases { m2, kwh, horas }, porTipo, porItem, historial }.
//  Lee (solo lectura): ventas (fin_ventas_mes / caja / B2B), costos, vínculos, merma y conteos de fen-produccion, gastos, créditos,
//  inversiones, cargas del SII y cargos de la cartola (por revisar y pagos de tarjeta).
export async function leerCierres() {
  const db = await dbG();
  const [c, k] = await Promise.all([FB.getDocs(FB.collection(db, 'fin_cierres')), FB.getDoc(FB.doc(db, 'fin_config', 'claves'))]);
  return { cierres: mapa(c), claves: k.exists() ? k.data() : {} };
}
// Cargos de la cartola: por revisar y pagos de tarjeta (con su fecha aaaa-mm-dd)
export async function cargosCartola() {
  const db = await dbG();
  const sn = await FB.getDocs(FB.collection(db, 'cartola_cargos'));
  const dia = v => { const t = String(v || '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[0]; m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
  const l = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !x.quitadoEnPlanilla).map(x => ({ id: x.id, fecha: dia(x.fecha), monto: Number(x.monto) || 0, descripcion: String(x.descripcion || ''), estado: String(x.estado || ''), accion: String(x.accion || '') }));
  // v0.65.1 · Cargos unidos a una planilla de Previred ya registrada (accion previred_planilla): NO son gasto (el gasto es el del
  // certificado, uno por trabajador; contarlos sería doble). No entran al estado de resultados ni a la cuadratura; quedan aquí para
  // el flujo de caja (F4), que también puede leer previred_planillas/{AAAA-MM}.pagos [{ cargoId, monto, fecha }].
  // v0.67.6 · Un cargo "Repetido" (el mismo movimiento que llegó en otra cartola) nunca cuenta: ni por revisar ni en el flujo
  const v = l.filter(x => x.estado !== 'REPETIDO');
  return { porRevisar: v.filter(x => x.estado === 'POR_REVISAR'), pagosTarjeta: v.filter(x => x.accion === 'pago_tarjeta' && x.estado !== 'POR_REVISAR'),
    pagosPrevired: v.filter(x => x.accion === 'previred_planilla' && x.estado !== 'POR_REVISAR') };
}
// v0.66.0 · Documentos del SII por clasificar (subidos, sin gasto todavía), de la memoria: para el cierre y el estado de resultados
// v0.67.1: lo mismo que Conciliación (sin lo que ya tiene su gasto registrado: eso no se cuenta en el cierre)
export async function siiPorClasificar() {
  try { return await (await import('./sii-pendientes-fs.js?v=0.138.0')).pendientes(); } catch (e) { /* sin la base nueva: como antes */ }
  const db = await dbG(), SP = await import('./sii-pendientes.js?v=0.138.0');
  const sn = await FB.getDocs(FB.collection(db, 'sii_docs'));
  return SP.pendientesDe(sn.docs.map(d => ({ id: d.id, d: d.data() })));
}
// v0.69.5 · Las planillas de Previred para Cierre de mes (de la memoria de la sesión; lo que falte se lee). null si no se puede.
export async function planillasPrevired() {
  try { return await (await import('./gastos-cartola-fs.js?v=0.138.0')).planillasCierre(); } catch (e) { console.warn('Previred para el cierre', e); return null; }
}
export async function cargasSii() {
  const db = await dbG();
  const sn = await FB.getDocs(FB.collection(db, 'sii_cargas'));
  return sn.docs.map(d => d.data()).filter(x => !x.quitadoEnPlanilla).map(x => ({ desde: String(x.periodoDesde || ''), hasta: String(x.periodoHasta || ''), quitada: x.quitada || '' }));
}
// La merma del mes valorizada (Producción → Merma, neto): por área y el café. null si fen-produccion no está conectada.
async function mermaMes(mes) {
  try {
    const cx = await P.conexion(); if (cx.estado !== 'ok') return { disponible: false, detalle: [], cafe: 0 };
    const d = await P.mermaDelPeriodo({ desde: mes + '-01', hasta: FV.ultimoDia(mes) }), r = P.resumenMerma(d);
    const detalle = []; let sinCosto = 0;
    r.areas.forEach(a => { sinCosto += a.sinCosto || 0; a.items.forEach(it => { if (it.neto) detalle.push({ area: a.area, nombre: it.nombre + (it.derramado ? ' (derramado)' : ''), neto: it.neto, cantidad: it.cantidad, unidad: it.unidad, ...(it.regalo ? { regalo: true } : {}) }); }); });
    return { disponible: true, detalle, cafe: Number(r.cafe && r.cafe.netoTotal) || 0, sinCosto };
  } catch (e) { console.warn('Finanzas: sin la merma de Producción', e); return { disponible: false, detalle: [], cafe: 0 }; }
}
// v0.112.0 · Una orden B2B de un mes ya leído cambió (se anuló): sus ventas guardadas se marcan para leerlas de nuevo la próxima vez.
// Así Finanzas no se queda con lo viejo y, si el mes ya se cerró, la diferencia entra como ajuste. No falla si no hay nada guardado.
export async function ventasParaReleer(mes) {
  try { const db = await dbG(), ref = FB.doc(db, 'fin_ventas_mes', `${mes}_b2b`), sn = await FB.getDoc(ref); if (sn.exists()) await FB.updateDoc(ref, { releer: true, releerDesde: hoyTxt() }); olvidarMeses(); return true; }
  catch (e) { console.warn('Finanzas: no se pudo marcar las ventas para leer de nuevo', e); return false; }
}
// ¿Ese mes ya está cerrado en Finanzas? (1 lectura; false si no se pudo leer)
export async function mesCerradoFin(mes) {
  try { const db = await dbG(), sn = await FB.getDoc(FB.doc(db, 'fin_cierres', mes)); return sn.exists() && sn.data().estado === 'cerrado'; } catch (e) { return false; }
}
// v0.112.0 · Las ventas con tarjeta (Point) del mes según el reporte de Mercado Pago (mp_ventas, un documento por día, lo sube
// Gastos): { dias, bruto, comision (la real, con su IVA) }. null si no se pudo leer. Cuesta 1 lectura por día con ventas.
async function mpVentasMes(mes) {
  try {
    const db = await dbG(), sn = await FB.getDocs(FB.query(FB.collection(db, 'mp_ventas'), FB.where('mes', '==', mes)));
    const l = sn.docs.map(d => d.data());
    return { dias: l.length, bruto: l.reduce((a, x) => a + (Number(x.bruto) || 0), 0), comision: l.reduce((a, x) => a + (Number(x.comision) || 0), 0) };
  } catch (e) { console.warn('Finanzas: sin el reporte de Mercado Pago', e); return null; }
}
// v0.123.0 · La caja en el resultado de un mes (fen-ventas, 4 consultas sin índices compuestos; se guarda con el mes en mesCache):
// los cierres (evaluacion_caja por la hora del cierre, del 1 del mes hasta 3 días después del último), Efectivo (efectivo_movimientos
// del mes), los cobros del Point revisados (point_revisiones del mes) y la merma de la tienda (merma por la hora de registro, hasta 7 días
// después; cuenta su fechaEnvio). → { evals, efectivo, point, mermaReg, disponible }
async function cajaFinMes(mes) {
  try {
    const [y, m] = mes.split('-').map(Number), ini = TsV.fromDate(new Date(y, m - 1, 1)), finE = TsV.fromDate(new Date(y, m, 4)), finM = TsV.fromDate(new Date(y, m, 8));
    const lista = sn => sn.docs.map(d => ({ id: d.id, ...d.data() }));
    const [ev, ef, pt, me] = await Promise.all([
      getDocsV(queryV(colV(dbV, 'evaluacion_caja'), whereV('cierre', '>=', ini), whereV('cierre', '<', finE))),
      getDocsV(queryV(colV(dbV, 'efectivo_movimientos'), whereV('mes', '==', mes))).catch(() => ({ docs: [] })),
      getDocsV(queryV(colV(dbV, 'point_revisiones'), whereV('mes', '==', mes))).catch(() => ({ docs: [] })),
      getDocsV(queryV(colV(dbV, 'merma'), whereV('fecha', '>=', ini), whereV('fecha', '<', finM)))
    ]);
    const diaMerma = r => (/^\d{4}-\d{2}-\d{2}$/.test(String(r.fechaEnvio || '')) ? r.fechaEnvio : (r.fecha && r.fecha.toDate ? hoyTxt(r.fecha.toDate()) : ''));
    return { evals: lista(ev), efectivo: lista(ef).filter(x => x.cuenta === 'caja_admin'), point: lista(pt), mermaReg: lista(me).filter(r => diaMerma(r).slice(0, 7) === mes), disponible: true };
  } catch (e) { console.warn('Finanzas: sin la caja del mes', e); return { evals: [], efectivo: [], point: [], mermaReg: [], disponible: false }; }
}
// Todo lo de un mes para el estado de resultados (ventas, costos, vínculos, merma). forzar: vuelve a leer las ventas.
const mesCache = {};
export const olvidarMeses = () => { Object.keys(mesCache).forEach(k => delete mesCache[k]); };
export async function datosMes(mes, { forzar = false } = {}) {
  if (mesCache[mes] && !forzar) return mesCache[mes];
  const [ventas, vinculos, costos, merma, maestro, mp, cj] = await Promise.all([ventasPeriodo({ meses: [mes] }, { forzar }), leerVinculos(), leerProductos(), mermaMes(mes), maestroFinanzas(), mpVentasMes(mes), cajaFinMes(mes)]);
  const hoy = hoyTxt(), cfg = FMG.configMargenes(costos.config && costos.config.margenes);
  // v0.123.0 · La caja: la merma de la tienda valorizada como el costo directo (mismos vínculos y costos de receta del mes)
  const caja = { evals: cj.evals, efectivo: cj.efectivo, point: cj.point, disponible: cj.disponible, merma: FMG.costearMermaTienda(cj.mermaReg, mes, vinculos || {}, costos, { hoy, maestro }) };
  // v0.74.0: foto de la venta → maestro (desde vigenteDesde) → fin_productos; los cargos (despacho) van aparte
  const margen = FMG.calcularMargenes(ventas.porMes || [], vinculos || {}, costos, cfg, { hoy, modo: 'mes', maestro });
  const info = (ventas.meses || [])[0] || {};
  const lAin = (ventas.lineas || []).filter(l => l.suc === 'ainavillo');
  const netoTotal = margen.filas.reduce((a, f) => a + f.neto, 0), netoSin = margen.filas.filter(f => f.tipo === 'sin').reduce((a, f) => a + f.neto, 0);
  const pend = margen.filas.filter(f => f.tipo === 'pendiente');   // v0.80.1: receta pendiente (asociados, sin costo)
  const infoCaja = info.caja || {};   // v0.124.0: antes también se llamaba "caja" (dos const con el mismo nombre: Finanzas no abría)
  const medios = ((ventas.porMes || [])[0] || {}).medios || null;   // v0.112.0: lo pagado con cada medio en la caja (para la cobertura del reporte de Mercado Pago)
  mesCache[mes] = { mes, margen, merma, mp, medios, caja, ventasInfo: { b2bSinConexion: (info.b2b || {}).fuente === 'sin_conexion' || !!(info.b2b || {}).sinReleer, guardado: infoCaja.fuente === 'guardado', abiertas: infoCaja.abiertas || 0, faltan: infoCaja.faltan || 0, nAinavillo: lAin.reduce((a, l) => a + (Number(l.cantidad) || 0), 0), netoAinavillo: lAin.reduce((a, l) => a + (Number(l.neto) || 0), 0), netoTotal, netoSinAsociar: netoSin, netoRecetaPendiente: pend.reduce((a, f) => a + f.neto, 0), nRecetaPendiente: pend.length, b2b: info.b2b || null } };
  return mesCache[mes];
}
export async function conteosMes(mes) {
  try { const cx = await P.conexion(); if (cx.estado !== 'ok') return { disponible: false }; const w = FE.ventanaConteo(mes); return { disponible: true, ...(await P.conteosEntre(w.desde, w.hasta)) }; }
  catch (e) { return { disponible: false, error: e.message || String(e) }; }
}
// Cerrar un mes: guarda el snapshot (no se puede si ya está cerrado) y su historial
export async function cerrarMes(mes, snap) {
  const db = await dbG(), ref = FB.doc(db, 'fin_cierres', mes), fecha = hoyTxt(), por = yo();
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    if (prev && prev.estado === 'cerrado') throw new Error(`${FE.mesTxt(mes)} ya está cerrado.`);
    const d = { ...snap, cerradoPor: por, cerradoEn: new Date().toISOString(), fecha, version: (Number(prev && prev.version) || 0) + 1, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    tx.set(FB.doc(db, 'fin_cierres_hist', idNuevo('fc-')), { mes, accion: 'cerrado', por, fecha, en: FB.serverTimestamp(), motivo: snap.override ? snap.override.motivo : '', override: snap.override || null, resultado: snap.filas.resultado.total });
    return d;
  });
}
// Reabrir (se puede, pero no se recomienda): con motivo; el snapshot anterior queda en el historial
export async function reabrirMes(mes, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 5) throw new Error('Escribe el motivo para reabrir (al menos 5 letras).');
  const db = await dbG(), ref = FB.doc(db, 'fin_cierres', mes), fecha = hoyTxt(), por = yo();
  await FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists() || sn.data().estado !== 'cerrado') throw new Error(`${FE.mesTxt(mes)} no está cerrado.`);
    const a = sn.data();
    tx.set(FB.doc(db, 'fin_cierres_hist', idNuevo('fc-')), { mes, accion: 'reabierto', por, fecha, en: FB.serverTimestamp(), motivo: m.slice(0, 300), resultado: a.filas && a.filas.resultado ? a.filas.resultado.total : null,
      snapshotAnterior: { filas: a.filas || null, info: a.info || null, cuadratura: a.cuadratura || null, ajustes: a.ajustes || null, cerradoPor: a.cerradoPor || '', cerradoEn: a.cerradoEn || '' } });
    tx.update(ref, { estado: 'reabierto', reabiertoPor: por, reabiertoEn: new Date().toISOString(), motivoReabrir: m.slice(0, 300), version: (Number(a.version) || 0) + 1 });
  });
}
export async function historialCierres(mes) {
  const db = await dbG();
  const sn = await FB.getDocs(FB.query(FB.collection(db, 'fin_cierres_hist'), FB.where('mes', '==', mes)));
  const t = x => (x && typeof x.toMillis === 'function' ? x.toMillis() : 0);
  return sn.docs.map(d => d.data()).sort((a, b) => t(b.en) - t(a.en));
}
// ═══ v0.106.0 · Otros ingresos y gastos (no del giro), tasa del impuesto a la renta e incobrables ═══
//  · fin_otros/{id}       { tipo 'ingreso'|'gasto', fecha, mes, monto, descripcion, estado 'vigente'|'anulado', creado { por, en }, anulado { por, en, motivo } }
//                          Cuentas 8.1 y 8.2: lo que entra o sale y no es de la panadería (vender un equipo usado, un evento puntual,
//                          intereses ganados). Nada se borra: se anula.
//  · fin_config/renta     { tasa (% sobre el resultado antes de impuesto; la confirma el contador), nota, historial [{ antes, por, fecha }] }
export function validarOtro(x) {
  const tipo = x && x.tipo === 'gasto' ? 'gasto' : x && x.tipo === 'ingreso' ? 'ingreso' : '';
  if (!tipo) throw new Error('Elija si es un ingreso o un gasto.');
  const fecha = String((x && x.fecha) || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Elija la fecha.');
  const monto = Math.round(Number(String((x && x.monto) || '').replace(/[^\d]/g, '')));
  if (!(monto > 0)) throw new Error('Escriba el monto (en pesos, sin puntos).');
  const descripcion = String((x && x.descripcion) || '').trim().slice(0, 160); if (!descripcion) throw new Error('Escriba de qué es.');
  return { tipo, fecha, mes: fecha.slice(0, 7), monto, descripcion };
}
export async function leerOtros() {
  const db = await dbG(), sn = await FB.getDocs(FB.collection(db, 'fin_otros'));
  return sn.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}
export async function guardarOtro(x) {
  const v = validarOtro(x), db = await dbG(), id = 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const d = { ...v, estado: 'vigente', creado: { por: yo(), en: new Date().toISOString() }, updatedAt: FB.serverTimestamp() };
  await FB.setDoc(FB.doc(db, 'fin_otros', id), d);
  return { id, ...d };
}
export async function anularOtro(id, motivo) {
  const db = await dbG(), ref = FB.doc(db, 'fin_otros', id);
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists() || sn.data().estado === 'anulado') throw new Error('Ya no está vigente.');
    tx.update(ref, { estado: 'anulado', anulado: { por: yo(), en: new Date().toISOString(), motivo: String(motivo || '').slice(0, 200) }, updatedAt: FB.serverTimestamp() });
  });
}
export const validarTasa = v => { const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.').trim()); if (String(v).trim() === '' || !isFinite(n) || n < 0 || n > 60) throw new Error('La tasa va de 0 a 60 (%).'); return Math.round(n * 100) / 100; };
export async function leerRenta() { const db = await dbG(), sn = await FB.getDoc(FB.doc(db, 'fin_config', 'renta')); return sn.exists() ? sn.data() : { tasa: 0 }; }
export async function guardarRenta(tasa, nota) {
  const t = validarTasa(tasa), db = await dbG(), ref = FB.doc(db, 'fin_config', 'renta'), fecha = hoyTxt(), por = yo();
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { antes: Number(prev.tasa) || 0, nota: prev.nota || '', por, fecha }].slice(-30);
    const d = { tasa: t, nota: String(nota || '').slice(0, 200), historial, por, fecha, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    return d;
  });
}
// Las facturas B2B dadas por perdidas en el mes (Ventas B2B → Cobranza). null si B2B no está conectada.
export async function incobrablesMes(mes) {
  try { return await B.incobrablesDelMes(mes); } catch (e) { console.warn('Finanzas: sin los incobrables de B2B', e); return null; }
}
export async function guardarClaves(datos) {
  const x = FE.validarClaves(datos);
  const db = await dbG(), ref = FB.doc(db, 'fin_config', 'claves'), fecha = hoyTxt(), por = yo();
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref), prev = sn.exists() ? sn.data() : {};
    const historial = [...(Array.isArray(prev.historial) ? prev.historial : []), { antes: { bases: prev.bases || null, porTipo: prev.porTipo || null, porItem: prev.porItem || null }, por, fecha }].slice(-30);
    const d = { ...x, historial, por, fecha, updatedAt: FB.serverTimestamp() };
    tx.set(ref, d);
    return d;
  });
}
