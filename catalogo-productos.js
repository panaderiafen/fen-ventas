// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo, Etapa 2: un solo catálogo de productos (datos)  v0.74.0
//  El maestro (fen-gastos cat_productos, cat_config/productos) y las copias en los canales, que escribe SOLO Sistema Fën:
//  la caja (fen-ventas productos) y B2B (fen-b2b productos). Reglas puras en catalogo-productos-modelo.js.
//  Lecturas (plan gratis de Firestore, Spark), con la memoria que ya existe:
//   · fen-gastos: cat_productos y cat_reventa (la colección entera una vez; después la memoria de fs-gastos.js pregunta solo lo que
//     cambió), cat_config/productos (1), fin_productos (la memoria de Finanzas).
//   · fen-produccion: las recetas de la memoria compartida (0 si Hoy, Producción o Finanzas ya las leyeron).
//   · fen-ventas: los productos de la caja (una vez por sesión, los mismos de los cierres y de Finanzas), sus áreas (≈ 4) y los pedidos
//     pendientes (solicitudes_producto, 1 si no hay).
//   · fen-b2b: los productos (una vez por sesión, los de Finanzas) y las solicitudes pendientes (1 si no hay).
//  Escrituras: crear = 1 transacción en fen-gastos (contador + producto) + 1 por canal habilitado (+1 lectura para no pisar un ID) +
//   1 vínculo en fin_productos por canal nuevo (+1 su historial) + 1 de la lista para logística (config/catalogoDisponible).
//   Cambiar = 1 en fen-gastos + 1 por canal que cambia. Armar el catálogo = lotes en fen-gastos + 1 por documento de la caja + lotes en fen-b2b.
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FBG from './fs-gastos.js?v=0.138.0';
import * as Cuota from './fs-cuota.js?v=0.138.0';
import * as P from './produccion.js?v=0.138.0';
import * as Caja from './caja.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as F from './finanzas.js?v=0.138.0';
import * as CPM from './catalogo-productos-modelo.js?v=0.138.0';

const LOTE = 400;
const yo = () => (auth.currentUser && auth.currentUser.email) || '';
export const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const idNuevo = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base de Gastos y Finanzas (Gastos → Configuración → Base nueva): el catálogo se guarda ahí.'); return cx.db; }

// Lecturas de la última apertura, por base (documentos)
export const uso = { gastos: 0, caja: 0, b2b: 0, cocina: 0 };
const reiniciar = () => Object.keys(uso).forEach(k => { uso[k] = 0; });

// ── Todo lo que necesitan Productos y Armar el catálogo ──
// → { maestro, config, recetas, reventa, vinculos, cat { caja: {id: doc}, b2b: {id: doc} }, areasCaja, solicitudes { b2b, caja, cajaEstado },
//     estados { gastos, cocina, b2b }, uso }
export async function cargar({ forzar = false } = {}) {
  reiniciar();
  if (forzar) { Caja.olvidarProductos(); F.olvidarCatalogoB2b(); F.olvidarMaestro(); }
  const l0 = { g: Cuota.usoHoy().lecturas, p: Cuota.produccion.usoHoy().lecturas, c: Caja.lecturasProductos, b: B.uso.lecturas };
  const cx = await GB.conexion().catch(e => ({ estado: 'error', error: e }));
  if (cx.estado !== 'ok') return { estados: { gastos: cx.estado, cocina: 'sin', b2b: 'sin' }, maestro: [], config: null, recetas: [], reventa: [], vinculos: {}, cat: { caja: {}, b2b: {} }, areasCaja: [], solicitudes: { b2b: [], caja: [], cajaEstado: 'sin' }, uso: { ...uso } };
  const cocina = (async () => { const c = await P.conexion().catch(e => ({ estado: 'error', error: e })); return c.estado === 'ok' ? { estado: 'ok', recetas: await P.recetasCatalogo(forzar) } : { estado: c.estado, recetas: [] }; })();
  const [m, rev, vinc, coc, cat, areasCaja, solB, solC] = await Promise.all([
    F.leerMaestro(), FBG.getDocs(FBG.collection(cx.db, 'cat_reventa')).then(sn => sn.docs.map(d => ({ ...d.data(), id: d.id }))).catch(() => []), F.leerVinculos().catch(() => ({})),
    cocina, F.catalogosVenta(), Caja.areasCaja().catch(() => ['PAN', 'BOL', 'PAS', 'CAF']),
    B.solicitudesPendientes().catch(() => null), Caja.solicitudesProducto().catch(e => ({ estado: 'error', lista: [], error: e }))
  ]);
  uso.gastos = Math.max(0, Cuota.usoHoy().lecturas - l0.g);
  uso.cocina = Math.max(0, Cuota.produccion.usoHoy().lecturas - l0.p);
  uso.caja = Math.max(0, Caja.lecturasProductos - l0.c);
  uso.b2b = Math.max(0, B.uso.lecturas - l0.b) + (cat.lecturas || 0);
  return {
    maestro: m.lista, config: m.config, recetas: coc.recetas || [], reventa: rev, vinculos: vinc || {}, cat: { caja: cat.caja || {}, b2b: cat.b2bEstado === 'ok' ? cat.b2b || {} : {} },
    areasCaja, solicitudes: { b2b: solB || [], caja: (solC && solC.lista) || [], cajaEstado: (solC && solC.estado) || 'error' },
    estados: { gastos: 'ok', cocina: coc.estado, b2b: cat.b2bEstado }, uso: { ...uso }
  };
}
const ctxDe = D => ({ recetas: D.recetas, reventa: D.reventa, lista: D.maestro, areasCaja: D.areasCaja, fin: D.vinculos });
const poner = (D, p) => { const i = D.maestro.findIndex(x => x.id === p.id); if (i >= 0) D.maestro[i] = p; else D.maestro.push(p); };

// ── Copias en los canales ──
// Escribe (o archiva) la copia de un canal según el producto guardado. prev: el producto antes (o null). → 'creado'|'cambiado'|'archivado'|''
async function copiarCanal(D, p, prev, canal) {
  const c = p.canales[canal] || {}, pc = (prev && prev.canales && prev.canales[canal]) || {};
  const antesHab = CPM.habilitado(prev, canal), ahoraHab = CPM.habilitado(p, canal);
  if (!c.docId) return '';
  const crear = !pc.docId;   // un documento nuevo en el canal lleva el ID del maestro
  if (canal === 'caja') {
    if (!ahoraHab) { if (crear || !antesHab) return ''; await Caja.cambiarActivoProducto(c.docId, false); const x = D.cat.caja[c.docId]; if (x) x.activo = false; return 'archivado'; }
    const d = CPM.docCaja(p);
    await Caja.escribirProducto(c.docId, d, { crear });
    D.cat.caja[c.docId] = { ...(D.cat.caja[c.docId] || {}), id: c.docId, ...d };
    return crear ? 'creado' : 'cambiado';
  }
  if (!ahoraHab) { if (crear || !antesHab) return ''; await B.archivarProducto(c.docId, true); const x = D.cat.b2b[c.docId]; if (x) x.estado = 'archivado'; return 'archivado'; }
  const d = CPM.docB2b(p);
  await B.escribirProducto(c.docId, d, { crear });
  D.cat.b2b[c.docId] = { ...(D.cat.b2b[c.docId] || {}), id: c.docId, ...d, ...(crear ? {} : { nombre: (D.cat.b2b[c.docId] || {}).nombre || d.nombre }) };
  return crear ? 'creado' : 'cambiado';
}
// fin_productos: el vínculo de un documento nuevo de un canal (si ya hay uno decidido a mano, se deja: vale para los meses antiguos)
async function vincularFin(D, p) {
  if (!CPM.conVinculoFin(p)) return 0;   // v0.80.1: receta pendiente: Finanzas lo lee del maestro; el vínculo se escribe al unirlo
  const db = await dbG(), hoy = hoyTxt(), por = yo(), ops = [];
  CPM.CANALES.forEach(cn => {
    const docId = p.canales[cn] && p.canales[cn].docId; if (!docId) return;
    const k = CPM.clave(cn, docId), prev = D.vinculos[k];
    if (CPM.decidido(prev)) return;
    const doc = CPM.vinculoFin(p, cn, docId, ctxDe(D), { hoy, por });
    ops.push([k, doc, prev || null]);
  });
  if (!ops.length) return 0;
  const b = FBG.writeBatch(db);
  ops.forEach(([k, doc, prev]) => {
    b.set(FBG.doc(db, 'fin_productos', k), { ...doc, updatedAt: FBG.serverTimestamp() });
    b.set(FBG.doc(db, 'fin_productos_hist', idNuevo('vp-')), { clave: k, nombre: doc.nombre, accion: prev ? 'cambio' : 'nuevo', antes: prev ? { tipo: prev.tipo || '' } : null, despues: { tipo: doc.tipo, receta: doc.receta, reventaId: doc.reventaId || null, unidadesPorVenta: doc.unidadesPorVenta, area: doc.area, catalogoId: p.id }, origen: 'catalogo_maestro', nota: doc.nota, fecha: hoy, por, en: FBG.serverTimestamp() });
    D.vinculos[k] = doc;
  });
  await b.commit();
  return ops.length;
}
// La lista para logística (fen-b2b config/catalogoDisponible): los activos que no están en B2B
export async function publicarDisponible(D) {
  if (D.estados.b2b !== 'ok') return false;
  try { await B.publicarCatalogoDisponible(CPM.catalogoDisponible(D.maestro)); return true; } catch (e) { console.warn('Catálogo: no se pudo publicar la lista para logística', e); return false; }
}

// ── Crear o cambiar un producto (y escribir sus canales) ──
// datos: lo del diálogo (ver CPM.validar). id: el del producto (o null para crear). → { producto, canales: { caja, b2b }, vinculos }
export async function guardar(D, datos, id = null, { origen = 'manual', nota = '', accion = 'cambio' } = {}) {
  const db = await dbG(), por = yo(), en = new Date().toISOString();
  const prev = id ? D.maestro.find(p => p.id === id) || null : null;
  if (id && !prev) throw new Error('Ese producto ya no está. Toca Actualizar.');
  const v = CPM.validar(datos, { ...ctxDe(D), prev });
  if (D.estados.b2b !== 'ok' && v.canales.b2b.habilitado !== CPM.habilitado(prev, 'b2b')) throw new Error('B2B (fen-b2b) no está conectada en este equipo: conéctala en Ventas a empresas para habilitar o deshabilitar ese canal.');
  let p;
  if (!prev) {
    const cref = FBG.doc(db, 'cat_config', 'productos'), saltar = [];
    p = await FBG.runTransaction(db, async tx => {
      const cs = await tx.get(cref), cfg = cs.exists() ? cs.data() : {};
      let n = CPM.siguienteNumero(cfg, D.maestro, saltar), nid = CPM.idDe(n);
      for (let k = 0; k < 20; k++) { const ps = await tx.get(FBG.doc(db, 'cat_productos', nid)); if (!ps.exists()) break; n++; nid = CPM.idDe(n); }
      const doc = { id: nid, ...v, estado: 'activo', origen, creadoEn: en, creadoPor: por, historial: [{ accion: 'nuevo', por, en, ...(nota ? { nota } : {}) }] };
      CPM.CANALES.forEach(cn => { if (doc.canales[cn].habilitado && !doc.canales[cn].docId) doc.canales[cn].docId = nid; });
      tx.set(FBG.doc(db, 'cat_productos', nid), doc);
      tx.set(cref, { ...cfg, siguiente: n + 1 });
      return doc;
    });
  } else {
    const ref = FBG.doc(db, 'cat_productos', prev.id);
    p = await FBG.runTransaction(db, async tx => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Ese producto ya no está. Toca Actualizar.');
      const a = { ...sn.data(), id: prev.id };
      const nuevo = { ...v };
      CPM.CANALES.forEach(cn => { nuevo.canales[cn].docId = (a.canales && a.canales[cn] && a.canales[cn].docId) || (nuevo.canales[cn].habilitado ? a.id : null); });
      const cambios = CPM.cambiosDe(a, nuevo);
      if (!Object.keys(cambios).length) return a;
      const d = { ...nuevo, editadoEn: en, editadoPor: por, historial: CPM.conHistorial(a.historial, { accion, por, en, cambios, ...(nota ? { nota } : {}) }) };
      tx.update(ref, d);
      return { ...a, ...d };
    });
  }
  // Los canales (después del maestro: así el ID del documento queda guardado aunque un canal falle)
  const canales = {}, errores = [];
  for (const cn of CPM.CANALES) {
    try { canales[cn] = await copiarCanal(D, p, prev, cn); }
    catch (e) { errores.push(`${CPM.NOMBRE_CANAL[cn]}: ${(e && e.message) || e}`); }
  }
  poner(D, p); F.olvidarMaestro();
  let vinculos = 0;
  try { vinculos = await vincularFin(D, p); } catch (e) { console.warn('Catálogo: vínculo de Finanzas', e); }
  const cambiaLista = !prev || CPM.habilitado(prev, 'b2b') !== CPM.habilitado(p, 'b2b') || prev.estado !== p.estado || prev.nombre !== p.nombre;
  if (cambiaLista) await publicarDisponible(D);
  if (errores.length) { const e = new Error(`El producto quedó guardado en el Catálogo (${p.id}), pero no se pudo escribir en ${errores.join(' · ')}. Toca Guardar otra vez para reintentar.`); e.producto = p; throw e; }
  return { producto: p, canales, vinculos };
}
// v0.80.1 · "Unir con su receta": un producto con la receta pendiente pasa a su receta aprobada. Es el mismo camino que crear un
// producto desde una receta: el maestro (con su historial: "unido con su receta"), las copias de la caja y de B2B (idRecetaFen / idReceta)
// y el vínculo de Finanzas (fin_productos, donde no había uno decidido a mano). Desde ahí sus ventas tienen costo y margen.
export async function unirReceta(D, id, recetaId) {
  const p = D.maestro.find(x => x.id === id);
  if (!p) throw new Error('Ese producto ya no está. Toca Actualizar.');
  if (!CPM.recetaPendiente(p)) throw new Error(`${p.nombre} ya tiene su receta.`);
  if (!String(recetaId || '').trim()) throw new Error('Elige la receta (solo las aprobadas).');
  const r = (D.recetas || []).find(x => x.id === recetaId);
  return guardar(D, CPM.datosUnir(p, recetaId), id, { accion: 'unido con su receta', nota: `${(r && r.nombre) || recetaId} (${recetaId})${p.notaReceta ? ' · faltaba: ' + p.notaReceta : ''}` });
}
// Archivar (archivar = true) o reactivar: el producto y sus canales (caja activo false; B2B archivado). Reactivar no vuelve a
// habilitar los canales: se habilitan en el diálogo, con su precio.
export async function archivar(D, id, archivar = true) {
  const db = await dbG(), por = yo(), en = new Date().toISOString(), ref = FBG.doc(db, 'cat_productos', id);
  const prev = D.maestro.find(p => p.id === id); if (!prev) throw new Error('Ese producto ya no está. Toca Actualizar.');
  const p = await FBG.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Ese producto ya no está. Toca Actualizar.');
    const a = { ...sn.data(), id }, estado = archivar ? 'archivado' : 'activo';
    if ((a.estado || 'activo') === estado) return a;
    const canales = JSON.parse(JSON.stringify(a.canales || {}));
    if (!archivar) CPM.CANALES.forEach(cn => { if (canales[cn]) canales[cn].habilitado = false; });
    const d = { estado, canales, [archivar ? 'archivadoEn' : 'reactivadoEn']: en, [archivar ? 'archivadoPor' : 'reactivadoPor']: por, historial: CPM.conHistorial(a.historial, { accion: archivar ? 'archivado' : 'reactivado', por, en }) };
    tx.update(ref, d);
    return { ...a, ...d };
  });
  const errores = [];
  if (archivar) for (const cn of CPM.CANALES) { if (!CPM.habilitado(prev, cn)) continue; try { await copiarCanal(D, p, prev, cn); } catch (e) { errores.push(`${CPM.NOMBRE_CANAL[cn]}: ${e.message || e}`); } }
  poner(D, p); F.olvidarMaestro();
  await publicarDisponible(D);
  if (errores.length) throw new Error(`Quedó ${archivar ? 'archivado' : 'activo'} en el Catálogo, pero no se pudo archivar en ${errores.join(' · ')}. Vuelve a intentar.`);
  return p;
}

// ═══════════════ Armar el catálogo (una sola vez) ═══════════════
// Documentos de los canales que el maestro ya tiene pero que todavía no llevan su catalogoId (un armado que se cortó a medias)
export function porTerminar(D) {
  const out = [];
  D.maestro.forEach(p => CPM.CANALES.forEach(cn => {
    const id = p.canales && p.canales[cn] && p.canales[cn].docId; if (!id) return;
    const d = D.cat[cn][id];
    if (d && d.catalogoId !== p.id) out.push({ canal: cn, docId: id, producto: p });
  }));
  return out;
}
async function unirCanales(D, cajas, b2bs) {
  for (const x of cajas) { await Caja.escribirProducto(x.docId, x.cambios); }
  for (const x of b2bs) { await B.escribirProducto(x.docId, x.cambios); }
}
export async function terminar(D) {
  const xs = porTerminar(D);
  const caja = xs.filter(x => x.canal === 'caja').map(x => ({ docId: x.docId, cambios: { catalogoId: x.producto.id, tipo: x.producto.tipo, reventaId: x.producto.reventaId || '', idRecetaFen: CPM.idRecetaCanal(x.producto) } }));
  const b2b = xs.filter(x => x.canal === 'b2b').map(x => ({ docId: x.docId, cambios: { catalogoId: x.producto.id, tipo: x.producto.tipo, reventaId: x.producto.reventaId || '', idReceta: CPM.idRecetaCanal(x.producto), area: x.producto.area } }));
  await unirCanales(D, caja, b2b);
  return xs.length;
}
// grupos: los revisados por el dueño (CPM.proponerGrupos + sus cambios). → { creados, archivados, vinculos, distintos }
export async function armar(D, grupos) {
  const db = await dbG(), por = yo(), en = new Date().toISOString(), hoy = hoyTxt();
  const cref = FBG.doc(db, 'cat_config', 'productos'), cs = await FBG.getDoc(cref), cfg = cs.exists() ? cs.data() : {};
  const plan = CPM.planGuardar(grupos, { ...ctxDe(D), siguiente: cfg.siguiente, vinculos: D.vinculos, maestro: D.maestro, por, en, hoy });
  // 1 · fen-gastos: productos + contador + vínculos (en lotes; el último lleva el contador y la marca del armado)
  const ops = [];
  plan.productos.forEach(p => ops.push([FBG.doc(db, 'cat_productos', p.id), p]));
  plan.vinculos.forEach(v => {
    ops.push([FBG.doc(db, 'fin_productos', v.clave), { ...v.doc, updatedAt: FBG.serverTimestamp() }]);
    ops.push([FBG.doc(db, 'fin_productos_hist', idNuevo('vp-')), { clave: v.clave, nombre: v.doc.nombre, accion: v.antes ? 'cambio' : 'nuevo', antes: v.antes ? { tipo: v.antes.tipo || '' } : null, despues: { tipo: v.doc.tipo, receta: v.doc.receta, reventaId: v.doc.reventaId || null, unidadesPorVenta: v.doc.unidadesPorVenta, area: v.doc.area, catalogoId: v.doc.catalogoId }, origen: 'catalogo_maestro', nota: v.doc.nota, fecha: hoy, por, en: FBG.serverTimestamp() }]);
  });
  const hist = [...(Array.isArray(cfg.historial) ? cfg.historial : []), { accion: 'armado', por, en, creados: plan.productos.length, archivados: plan.archivarCaja.length + plan.archivarB2b.length }].slice(-20);
  const marca = { ...cfg, siguiente: plan.siguiente, armadoEn: cfg.armadoEn || en, armadoPor: cfg.armadoPor || por, vigenteDesde: cfg.vigenteDesde || hoy.slice(0, 7), n: (Number(cfg.n) || 0) + plan.productos.length, historial: hist };
  for (let i = 0; i < ops.length || i === 0; i += LOTE) {
    const b = FBG.writeBatch(db);
    ops.slice(i, i + LOTE).forEach(([ref, d]) => b.set(ref, d));
    if (i + LOTE >= ops.length) b.set(cref, marca);
    await b.commit();
  }
  plan.productos.forEach(p => poner(D, p)); plan.vinculos.forEach(v => { D.vinculos[v.clave] = v.doc; });
  D.config = marca; F.olvidarMaestro();
  // 2 · Los canales: catalogoId en los documentos que ya existían (conservan su ID) y lo archivado
  await unirCanales(D, plan.caja, plan.b2b);
  plan.caja.forEach(x => Object.assign(D.cat.caja[x.docId] || {}, x.cambios)); plan.b2b.forEach(x => Object.assign(D.cat.b2b[x.docId] || {}, x.cambios));
  for (const id of plan.archivarCaja) { await Caja.cambiarActivoProducto(id, false); if (D.cat.caja[id]) D.cat.caja[id].activo = false; }
  for (const id of plan.archivarB2b) { await B.archivarProducto(id, true); if (D.cat.b2b[id]) D.cat.b2b[id].estado = 'archivado'; }
  await publicarDisponible(D);
  return { creados: plan.productos.length, archivados: plan.archivarCaja.length + plan.archivarB2b.length, vinculos: plan.vinculos.length, distintos: plan.distintos, productos: plan.productos };
}

// ═══════════════ Pedidos de productos (logística y la caja) ═══════════════
export const pedidos = D => CPM.pedidos(D.solicitudes, D.maestro);
// Resolver = crear o habilitar el producto en el Catálogo (con lo del diálogo) y marcar el pedido como aprobado
export async function resolverPedido(D, pd, datos, id) {
  const r = await guardar(D, datos, id || null, { origen: id ? 'manual' : 'solicitud', nota: `Pedido ${pd.origen === 'caja' ? 'de la caja' : 'de logística'}${pd.por ? ' (' + pd.por + ')' : ''}` });
  const p = r.producto, canal = pd.origen === 'caja' ? 'caja' : 'b2b', docId = p.canales[canal] && p.canales[canal].docId;
  if (pd.origen === 'b2b') await B.resolverSolicitudProducto(pd.id, { aprobada: true, catalogoId: p.id, productoId: docId || null, precio: canal === 'b2b' ? p.canales.b2b.precioBase : null, respuesta: `Agregado al catálogo (${p.nombre})` });
  else await Caja.resolverSolicitudProducto(pd.id, { estado: 'aprobada', catalogoId: p.id, productoId: docId || null, respuesta: `Agregado a la caja (${p.nombre})` });
  quitarPedido(D, pd);
  return r;
}
export async function rechazarPedido(D, pd, motivo) {
  const m = String(motivo || '').trim();
  if (m.length < 3) throw new Error('Escribe el motivo (le llega como respuesta).');
  if (pd.origen === 'b2b') await B.resolverSolicitudProducto(pd.id, { aprobada: false, respuesta: m });
  else await Caja.resolverSolicitudProducto(pd.id, { estado: 'rechazada', respuesta: m.slice(0, 300) });
  quitarPedido(D, pd);
}
function quitarPedido(D, pd) { const l = pd.origen === 'caja' ? D.solicitudes.caja : D.solicitudes.b2b; const i = l.findIndex(x => x.id === pd.id); if (i >= 0) l.splice(i, 1); }
