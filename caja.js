// ═══════════════════════════════════════════════
//  Sistema Fën — lógica de administración de la caja  v0.3.0 · v0.75.1 · v0.117.0
//  Copia fiel de lo que hace la caja v2.3.0 (index.html) para cerrar cajas,
//  guardar el resumen de cada cierre, corregir arqueos y resolver anulaciones.
//  v0.75.1 (Etapa 2b): los cierres ya NO se copian a la planilla ni se llama a ningún Apps Script (como la caja v2.3.0).
//  Las áreas son las de areas.js (CAJA); "REV" es REVENTA; un área desconocida es "Otros" en el resumen (nunca Bollería).
//  Si se cambia algo aquí, revisar lo mismo en la caja (y al revés).
//  Diferencias a propósito:
//  · al anular una venta con pago dividido en una caja abierta, se descuenta de
//    cada medio (la caja v2.1.1 lo descuenta mal);
//  · v0.117.0: el resumen lo arma resumen-caja.js (el mismo archivo en la caja); al aprobar, el stock y lo
//    cobrado con el Point integrado van en la misma transacción;
//  · cerrar y aprobar se hacen en una sola transacción: si dos personas lo hacen
//    a la vez (o desde la caja y desde aquí), solo una gana y nada queda a medias;
//  · antes de cerrar una caja vieja se revisa que no siga vendiendo.
// ═══════════════════════════════════════════════
import {
  auth, db, collection, doc, getDoc, getDocs, updateDoc, setDoc, increment,
  query, where, Timestamp, runTransaction, getAggregateFromServer, sum, count
} from './firebase.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';
import { armarResumen } from './resumen-caja.js?v=0.138.0';   // v0.117.0: el mismo archivo que usa la caja v2.9.0

const F = window.FEN_SIS;
const correo = () => (auth.currentUser && auth.currentUser.email) || '';
const ent = v => parseInt(v) || 0;

export function haceDias(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return Timestamp.fromDate(d); }
export function diaLocal(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function normalizarFechaCaja(fecha) {
  if (!fecha) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const m = String(fecha).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Productos y áreas de la caja: se leen una vez por sesión (para el resumen de cada cierre).
let _prods = null;
const AREA_COMPAT = { 'Panadería': 'PAN', 'Bollería': 'BOL', 'Sándwiches': 'PAN', 'Cafetería': 'CAF', 'Pastelería': 'PAS', 'Chocolatería': 'PAS', 'Reventa': 'REVENTA' };
export let lecturasProductos = 0;   // v0.72.0: cuántos documentos de productos se leyeron en esta sesión (Catálogo lo muestra)
export async function productos() {
  if (!_prods) { const sn = await getDocs(collection(db, 'productos')); lecturasProductos += Math.max(1, sn.docs.length); _prods = sn.docs.map(d => ({ id: d.id, ...d.data() })); }
  return _prods;
}
export function olvidarProductos() { _prods = null; }
// v0.72.0 · Catálogo: archivar un producto de la caja es lo mismo de siempre en la caja: activo false (deja de aparecer para
// vender; su historia queda). Reactivar: activo true. Solo la administración (reglas v1.3.0: productos update esAdmin).
export async function cambiarActivoProducto(id, activo) {
  await updateDoc(doc(db, 'productos', id), { activo: !!activo });
  const p = (_prods || []).find(x => x.id === id); if (p) p.activo = !!activo;
}
// v0.74.0 · Catálogo (Etapa 2): la copia del producto en la caja la escribe SOLO Sistema Fën (Catálogo → Productos).
// crear = documento nuevo (su ID es el del maestro, PR####); si no, cambia solo los campos dados (los que ya existían conservan su ID:
// la historia de ventas está guardada con él). Reglas fen-ventas v1.3.0: productos create/update de la administración (sin cambio).
export async function escribirProducto(id, campos, { crear = false } = {}) {
  if (crear) {
    const sn = await getDoc(doc(db, 'productos', id)); lecturasProductos++;
    if (sn.exists() && sn.data().catalogoId && sn.data().catalogoId !== campos.catalogoId) throw new Error(`En la caja ya hay un producto con el ID ${id} de otro producto del catálogo.`);
    if (sn.exists()) await updateDoc(doc(db, 'productos', id), campos); else await setDoc(doc(db, 'productos', id), campos);
  } else await updateDoc(doc(db, 'productos', id), campos);
  if (_prods) { const p = _prods.find(x => x.id === id); if (p) Object.assign(p, campos); else _prods.push({ id, ...campos }); }
}
// v0.75.1 · Las pestañas (áreas) de la caja: la lista de areas.js (las que producen + REVENTA). La caja ya no tiene la suya.
export async function areasCaja() { return [...AR.CAJA]; }
// v0.74.0 · Pedidos de productos de la caja (los escribe la caja desde la entrega 2b): fen-ventas solicitudes_producto
// { tipo 'producto', nombre, catalogoId | recetaId | reventaId, sucursal, precioSugerido, nota, estado 'pendiente', por, en }.
// Necesita las reglas de fen-ventas v1.4.0 (ver README); sin ellas → { estado: 'sin_reglas', lista: [] } (no corta nada).
export async function solicitudesProducto() {
  try {
    const sn = await getDocs(query(collection(db, 'solicitudes_producto'), where('estado', '==', 'pendiente')));
    lecturasProductos += Math.max(1, sn.docs.length);
    return { estado: 'ok', lista: sn.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) { if (e && e.code === 'permission-denied') return { estado: 'sin_reglas', lista: [] }; throw e; }
}
export async function resolverSolicitudProducto(id, cambios) {
  await updateDoc(doc(db, 'solicitudes_producto', id), { ...cambios, resuelta: { por: (auth.currentUser && auth.currentUser.email) || '', en: Timestamp.now() } });
}
// v0.75.1 · El área de un producto de la caja (como la caja v2.3.0): una de areas.js CAJA; "REV" → REVENTA; desconocida o vacía → ''
// (async por compatibilidad con quien ya la llamaba con await)
export function areaDeCaja(a) { const t = String(a == null ? '' : a).trim(), c = AR.deCaja(AREA_COMPAT[t] || t); return c === AR.SIN_AREA ? '' : c; }
export async function normalizarArea(a) { return areaDeCaja(a); }

// v0.75.1 · La foto de un producto de la caja (como la caja v2.3.0): catalogoId, tipo, recetaId / reventaId (idRecetaFen si no hay tipo)
export function fotoProductoCaja(p) {
  const x = p || {}, tipo = String(x.tipo || '').trim(), r = String(x.idRecetaFen || '').trim(), rv = tipo === 'reventa' || (!tipo && /^REV\d+$/i.test(r));
  return { catalogoId: String(x.catalogoId || ''), tipo, recetaId: rv || tipo === 'cargo' ? '' : String(x.recetaId || r), reventaId: rv ? String(x.reventaId || r) : '',
    unidadesPorVenta: Number(x.unidadesPorVenta) > 0 ? Number(x.unidadesPorVenta) : null };
}

// ── Resumen de la caja: resumen-caja.js (compartido con la caja desde la v0.117.0 / caja v2.9.0) ──
export async function guardarResumenCaja(cajaDocId, cajaData, ventasDocs) {
  try {
    const infoProd = {};
    const areaRes = a => areaDeCaja(a) || 'Otros';
    for (const p of await productos()) infoProd[p.id] = { area: areaRes(p.area), idRecetaFen: p.idRecetaFen || '', ...fotoProductoCaja(p) };
    // v0.117.0: el resumen lo arma resumen-caja.js, el mismo archivo de la caja (v2.9.0)
    const r = armarResumen({ cajaId: cajaDocId, cajaData, ventas: ventasDocs.map(d => d.data()), infoProd, areaRes,
      fecha: normalizarFechaCaja(cajaData.fecha) || cajaData.fecha || '', ahora: Timestamp.now() });
    await setDoc(doc(db, 'resumenes_caja', cajaDocId), r);
    return true;
  } catch (e) { console.error('No se pudo guardar el resumen de la caja', cajaDocId, e); return false; }
}

// ── v0.75.1 · El resumen de un cierre (igual que cerrarResumen de la caja v2.3.0). Ya no se pasa a la planilla. ──
// Devuelve { ok, error }. Si falla, la caja queda con resumenPendiente: true (la caja y Sistema Fën lo reintentan).
export async function resumenCierre(cajaDocId, cajaData) {
  try {
    const ventasSnap = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', cajaDocId)));
    if (!(await guardarResumenCaja(cajaDocId, cajaData, ventasSnap.docs))) throw new Error('No se pudo guardar el resumen');
    if (cajaData && cajaData.resumenPendiente) await updateDoc(doc(db, 'cajas', cajaDocId), { resumenPendiente: false });
    return { ok: true };
  } catch (err) {
    try { await updateDoc(doc(db, 'cajas', cajaDocId), { resumenPendiente: true }); } catch (e2) {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// ── Cierres ──
export async function leerCierres() {
  const hoy = diaLocal();
  const [abiertas, recientes, evals] = await Promise.all([
    getDocs(query(collection(db, 'cajas'), where('estado', '==', 'abierta'))),
    getDocs(query(collection(db, 'cajas'), where('apertura', '>=', haceDias(F.DIAS_HISTORIAL)))),
    getDocs(query(collection(db, 'evaluacion_caja'), where('cierre', '>=', haceDias(F.DIAS_HISTORIAL))))
  ]);
  const lista = sn => sn.docs.map(d => ({ id: d.id, ...d.data() }));
  return {
    sinCerrar: lista(abiertas).filter(c => (c.fecha || '') < hoy).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')),
    // v0.75.1: los cierres ya no van a la planilla; solo los que quedaron sin resumen (resumenPendiente)
    sinResumen: lista(recientes).filter(c => c.estado === 'cerrada' && c.resumenPendiente === true)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')),
    evaluaciones: lista(evals).sort((a, b) => ((b.cierre && b.cierre.toMillis && b.cierre.toMillis()) || 0) - ((a.cierre && a.cierre.toMillis && a.cierre.toMillis()) || 0))
  };
}

// Calcula el arqueo como la caja: el efectivo contado descuenta el monto inicial.
export function calcularArqueo(cajaData, m) {
  const t = cajaData.totales || {};
  const montoInicial = ent(cajaData.montoInicial);
  const sist = { sistEfectivo: ent(t.efectivo), sistDebito: ent(t.debito), sistCredito: ent(t.credito), sistTransfer: ent(t.transferencia), sistTotal: ent(cajaData.totalVentas) };
  const manEfectivoNeto = ent(m.manEfectivo) - montoInicial;
  const manTotal = manEfectivoNeto + ent(m.manDebito) + ent(m.manCredito) + ent(m.manTransfer);
  // v0.119.0 (caja v3.0.0): lo que entró y salió de la caja con la caja abierta (retiros e ingresos del turno)
  const em = cajaData.efectivoMovs || {}, ingresosTurno = ent(em.ingresos), retirosTurno = ent(em.retiros), movsNeto = ingresosTurno - retirosTurno;
  const difs = {
    difEfectivo: manEfectivoNeto - sist.sistEfectivo - movsNeto, difDebito: ent(m.manDebito) - sist.sistDebito,
    difCredito: ent(m.manCredito) - sist.sistCredito, difTransfer: ent(m.manTransfer) - sist.sistTransfer,
    difTotal: manTotal - sist.sistTotal - movsNeto
  };
  const hayDiferencia = difs.difEfectivo !== 0 || difs.difDebito !== 0 || difs.difCredito !== 0 || difs.difTransfer !== 0;
  return { montoInicial, ...sist, manEfectivo: ent(m.manEfectivo), manEfectivoNeto, manDebito: ent(m.manDebito), manCredito: ent(m.manCredito), manTransfer: ent(m.manTransfer), manTotal, ...difs,
    ...(ingresosTurno || retirosTurno ? { ingresosTurno, retirosTurno, movsNeto } : {}), hayDiferencia };
}

// Minutos desde la última venta de esa caja (null si no tiene ventas).
export async function minutosDesdeUltimaVenta(cajaId) {
  const vs = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', cajaId)));
  let ult = 0;
  vs.docs.forEach(d => { const f = d.data().fecha; const ms = f && f.toMillis ? f.toMillis() : 0; if (ms > ult) ult = ms; });
  return ult ? Math.floor((Date.now() - ult) / 60000) : null;
}

// Cerrar una caja de un día anterior. montos = null → sin arqueo (solo totales del sistema).
// v0.75.1: con o sin arqueo, queda el resumen del cierre (ya no la planilla ni el correo de descuadre por Apps Script).
// La caja y su evaluación se escriben juntas en una transacción: si alguien la cerró
// recién (desde la caja u otro equipo), no se crea un segundo cierre.
export async function cerrarCajaAnterior(cajaId, montos, nota) {
  const cajaRef = doc(db, 'cajas', cajaId);
  const evalRef = doc(db, 'evaluacion_caja', 'cierre-' + cajaId);
  let cajaData, evaluacion;
  await runTransaction(db, async tx => {
    const sn = await tx.get(cajaRef);
    if (!sn.exists()) throw new Error('La caja ya no existe');
    cajaData = sn.data();
    if (cajaData.estado !== 'abierta') throw new Error('Esa caja ya estaba cerrada');
    const ahora = Timestamp.now();
    const base = { cajaId, sucursal: cajaData.sucursal || '', usuario: cajaData.usuario || '', fecha: cajaData.fecha || '',
      nVentas: cajaData.nVentas || 0, montoInicial: ent(cajaData.montoInicial), apertura: cajaData.apertura || null, cierre: ahora, cerradoPor: correo(), cerradoDesde: 'Sistema Fën' };
    const extraCaja = {};
    if (montos) {
      const a = calcularArqueo(cajaData, montos);
      if (a.hayDiferencia && !String(nota || '').trim()) throw new Error('Falta la nota que explica la diferencia');
      const retirado = ent(montos.montoRetirado);
      const saldoSiguiente = retirado > 0 ? a.manEfectivo - retirado : null;
      const { hayDiferencia, ...campos } = a;
      evaluacion = { ...base, ...campos, ...(hayDiferencia ? { notaDescuadre: String(nota).trim() } : {}), ...(retirado > 0 ? { montoRetirado: retirado, saldoSiguiente } : {}) };
      if (saldoSiguiente !== null) extraCaja.saldoSiguiente = saldoSiguiente;
      // v0.119.0: el retiro queda por recibir en Efectivo → Caja de administración, como el de un cierre en la caja
      if (retirado > 0) {
        const dia = String(cajaData.fecha || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && ['barros_arana', 'ainavillo'].includes(cajaData.sucursal)) {
          tx.set(doc(collection(db, 'caja_movimientos')), { cajaId, sucursal: cajaData.sucursal, tipo: 'retiro', motivo: 'cierre', monto: retirado,
            dia, mes: dia.slice(0, 7), nota: 'Cerrada desde Sistema Fën', pendienteAdmin: true, por: correo(), creado: ahora });
          extraCaja.retiroCierre = retirado;
        }
      }
    } else {
      const t = cajaData.totales || {};
      evaluacion = { ...base, sistEfectivo: ent(t.efectivo), sistDebito: ent(t.debito), sistCredito: ent(t.credito), sistTransfer: ent(t.transferencia), sistTotal: ent(cajaData.totalVentas), sinArqueo: true };
    }
    tx.update(cajaRef, { estado: 'cerrada', cierre: ahora, ...extraCaja });
    tx.set(evalRef, evaluacion);
    Object.assign(cajaData, { estado: 'cerrada', cierre: ahora, ...extraCaja });
  });
  // La diferencia y su nota quedan en la evaluación (Hoy la muestra); el resumen, con la misma lectura de la caja.
  return resumenCierre(cajaId, cajaData);
}

// v0.75.1 · "Generar resumen" de un cierre que quedó sin él (antes "Reenviar" a la planilla)
export async function reenviarCierre(cajaId) {
  const sn = await getDoc(doc(db, 'cajas', cajaId));
  if (!sn.exists()) return { ok: false, error: 'La caja ya no existe' };
  return resumenCierre(cajaId, sn.data());
}

// Corregir el arqueo de un cierre (igual que la caja: queda marcado como corregido).
export async function corregirEvaluacion(evalId, m) {
  const sn = await getDoc(doc(db, 'evaluacion_caja', evalId));
  if (!sn.exists()) throw new Error('No se encontró ese cierre');
  const e = sn.data();
  const montoInicial = ent(e.montoInicial);
  const manEfectivoNeto = ent(m.manEfectivo) - montoInicial;
  const manTotal = manEfectivoNeto + ent(m.manDebito) + ent(m.manCredito) + ent(m.manTransfer);
  const movsNeto = Math.round(Number(e.movsNeto) || 0); // v0.119.0: retiros e ingresos del turno (caja v3.0.0)
  await updateDoc(doc(db, 'evaluacion_caja', evalId), {
    manEfectivo: ent(m.manEfectivo), manEfectivoNeto, manDebito: ent(m.manDebito), manCredito: ent(m.manCredito), manTransfer: ent(m.manTransfer), manTotal,
    difEfectivo: manEfectivoNeto - ent(e.sistEfectivo) - movsNeto, difDebito: ent(m.manDebito) - ent(e.sistDebito),
    difCredito: ent(m.manCredito) - ent(e.sistCredito), difTransfer: ent(m.manTransfer) - ent(e.sistTransfer),
    difTotal: manTotal - ent(e.sistTotal) - movsNeto,
    sinArqueo: false, corregido: true, fechaCorreccion: Timestamp.now(), corregidoPor: correo(),
    diferenciaAceptada: false // con montos nuevos, la diferencia (si queda) se vuelve a revisar
  });
}

// Aceptar una diferencia que ya no se puede aclarar: no cambia montos, solo deja constancia.
export async function aceptarDiferencia(evalId, nota) {
  const sn = await getDoc(doc(db, 'evaluacion_caja', evalId));
  if (!sn.exists()) throw new Error('No se encontró ese cierre');
  await updateDoc(doc(db, 'evaluacion_caja', evalId), {
    diferenciaAceptada: true, aceptadaPor: correo(), fechaAceptacion: Timestamp.now(), notaAceptacion: String(nota || '').trim().slice(0, 300)
  });
}

// ── Anulaciones ──
export async function leerAnulaciones() {
  const [pend, recientes] = await Promise.all([
    getDocs(query(collection(db, 'solicitudes_anulacion'), where('estado', '==', 'pendiente'))),
    getDocs(query(collection(db, 'solicitudes_anulacion'), where('fechaSolicitud', '>=', haceDias(F.DIAS_HISTORIAL))))
  ]);
  const vistos = {}, todas = [];
  [...pend.docs, ...recientes.docs].forEach(d => { if (!vistos[d.id]) { vistos[d.id] = 1; todas.push({ id: d.id, ...d.data() }); } });
  const ms = s => (s.fechaSolicitud && s.fechaSolicitud.toMillis && s.fechaSolicitud.toMillis()) || 0;
  todas.sort((a, b) => ms(b) - ms(a));
  return { pendientes: todas.filter(s => s.estado === 'pendiente'), resueltas: todas.filter(s => s.estado !== 'pendiente') };
}

// v0.117.0 · Qué stock devolver al anular una venta (al mismo lote del que salió, como la caja v2.1.1).
// Se calcula antes de la transacción (las consultas no pueden ir dentro) y se escribe dentro de ella.
// → [{ id: 'sucursal_producto', key: lote, cantidad, etiqueta, revisar }]  (revisar: solo si el documento existe)
async function planDevolucion(ventaId, venta) {
  const suc = venta.sucursal || '';
  let movs = [];
  try {
    const ms = await getDocs(query(collection(db, 'stockMovimientos'), where('ventaId', '==', ventaId)));
    ms.docs.forEach(d => { const m = d.data(); if (m.tipo === 'venta' && Array.isArray(m.descontados)) movs = movs.concat(m.descontados); });
  } catch (e) { console.error('No se pudieron leer los movimientos de la venta', e); }
  if (movs.length) return movs.map(m => ({ id: `${suc}_${m.productoId}`, key: m.key, cantidad: m.cantidad, etiqueta: `${m.productoId} × ${m.cantidad}` }));
  const prods = await productos(), plan = [];
  for (const l of (venta.lineas || [])) {
    const prod = prods.find(p => p.id === l.id);
    if (prod && prod.controlStock === false) continue;
    if (l.lotes && typeof l.lotes === 'object' && Object.keys(l.lotes).length) {
      // v0.70.1 (caja v2.2.0): la línea trae los lotes exactos de los que salió
      for (const [k, c] of Object.entries(l.lotes)) plan.push({ id: `${suc}_${l.id}`, key: k, cantidad: c, etiqueta: `${l.nombre} × ${c}` });
      continue;
    }
    const key = (prod && prod.autoEliminar === false) ? 'permanente' : (l.loteFecha || '');
    plan.push({ id: `${suc}_${l.id}`, key, cantidad: l.cantidad, etiqueta: `${l.nombre} × ${l.cantidad}` });
  }
  return plan;
}

// Aprobar: anula la venta, devuelve el stock, descuenta de la caja si sigue abierta (también lo cobrado con el Point
// integrado), rehace el resumen si ya cerró. v0.117.0: solicitud, venta, caja y stock se escriben juntos en una
// transacción: si dos personas aprueban a la vez, solo una descuenta, y no queda una venta anulada con el stock sin volver.
export async function aprobarAnulacion(solicitudId) {
  const solRef = doc(db, 'solicitudes_anulacion', solicitudId);
  // El plan del stock, con lo que dice la venta ahora (dentro de la transacción se vuelve a leer todo)
  const sol0 = await getDoc(solRef);
  if (!sol0.exists()) throw new Error('La solicitud ya no existe');
  const venta0Sn = sol0.data().ventaId ? await getDoc(doc(db, 'ventas', sol0.data().ventaId)) : null;
  const plan = venta0Sn && venta0Sn.exists() && venta0Sn.data().anulada !== true ? await planDevolucion(sol0.data().ventaId, venta0Sn.data()) : [];
  let venta = null, ventaId = null, yaAnulada = false, sinDevolver = [];
  await runTransaction(db, async tx => {
    const solSn = await tx.get(solRef);
    if (!solSn.exists()) throw new Error('La solicitud ya no existe');
    const sol = solSn.data();
    if (sol.estado !== 'pendiente') throw new Error('Esa solicitud ya estaba resuelta');
    ventaId = sol.ventaId;
    const ventaRef = doc(db, 'ventas', ventaId);
    const ventaSn = await tx.get(ventaRef);
    if (!ventaSn.exists()) throw new Error('La venta ya no existe');
    venta = ventaSn.data();
    const cajaRef = venta.cajaId ? doc(db, 'cajas', venta.cajaId) : null;
    const cajaSn = cajaRef ? await tx.get(cajaRef) : null;
    // Los documentos de stock (todas las lecturas antes de escribir)
    const ids = [...new Set(plan.map(x => x.id))], existe = {};
    for (const id of ids) existe[id] = (await tx.get(doc(db, 'stock', id))).exists();
    const resuelta = { estado: 'aprobada', resueltoPor: correo(), fechaResolucion: Timestamp.now() };
    yaAnulada = venta.anulada === true;
    if (yaAnulada) { tx.update(solRef, resuelta); return; }
    // Stock: un cambio por documento, con todos sus lotes
    sinDevolver = [];
    const porDoc = {};
    plan.forEach(x => {
      if (!x.key || !existe[x.id]) { sinDevolver.push(x.etiqueta); return; }
      const c = porDoc[x.id] || (porDoc[x.id] = {});
      c[`entradas.${x.key}`] = (c[`entradas.${x.key}`] || 0) + (Number(x.cantidad) || 0);
    });
    tx.update(ventaRef, { anulada: true, motivoAnulacion: sol.motivo || '', anuladoPor: correo(), fechaAnulacion: Timestamp.now(), solicitudAnulacionPendiente: false, stockDevuelto: !sinDevolver.length });
    if (cajaSn && cajaSn.exists() && cajaSn.data().estado === 'abierta') {
      const cambios = { totalVentas: increment(-ent(venta.total)), nVentas: increment(-1) };
      if (Array.isArray(venta.pagos) && venta.pagos.length) {
        // pago dividido: se descuenta de cada medio (si hay dos pagos con el mismo medio, se suman)
        const porMedio = {};
        venta.pagos.forEach(p => { if (p && p.medio) porMedio[p.medio] = (porMedio[p.medio] || 0) + ent(p.monto); });
        Object.keys(porMedio).forEach(m => { cambios[`totales.${m}`] = increment(-porMedio[m]); });
      } else if (venta.medioPago) {
        cambios[`totales.${venta.medioPago}`] = increment(-ent(venta.total));
      }
      // v0.117.0: lo cobrado con el Point integrado (caja v2.4.0) también baja; la devolución al cliente se hace en Mercado Pago
      if (venta.pagoPoint && venta.pagoPoint.medio) cambios[`totalesPoint.${venta.pagoPoint.medio}`] = increment(-ent(venta.pagoPoint.monto));
      tx.update(cajaRef, cambios);
    }
    Object.entries(porDoc).forEach(([id, c]) => {
      const inc = {}; Object.entries(c).forEach(([k, n]) => { inc[k] = increment(n); });
      tx.update(doc(db, 'stock', id), inc);
    });
    tx.update(solRef, resuelta);
  });
  if (yaAnulada) return { yaAnulada: true, sinDevolver: [] };
  if (venta.cajaId) {
    try {
      const cajaRes = await getDoc(doc(db, 'cajas', venta.cajaId));
      if (cajaRes.exists() && cajaRes.data().estado === 'cerrada') {
        const vs = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', venta.cajaId)));
        await guardarResumenCaja(venta.cajaId, cajaRes.data(), vs.docs);
      }
    } catch (e) { console.error('No se pudo actualizar el resumen de la caja', e); }
  }
  return { yaAnulada: false, sinDevolver };
}

export async function rechazarAnulacion(solicitudId) {
  const solRef = doc(db, 'solicitudes_anulacion', solicitudId);
  const solSn = await getDoc(solRef);
  if (!solSn.exists()) throw new Error('La solicitud ya no existe');
  const sol = solSn.data();
  if (sol.estado !== 'pendiente') throw new Error('Esa solicitud ya estaba resuelta');
  // v0.117.0: la solicitud y la marca de la venta, de una sola vez
  const ventaRef = doc(db, 'ventas', sol.ventaId);
  await runTransaction(db, async tx => {
    const s2 = await tx.get(solRef), v2 = await tx.get(ventaRef);
    if (!s2.exists() || s2.data().estado !== 'pendiente') throw new Error('Esa solicitud ya estaba resuelta');
    tx.update(solRef, { estado: 'rechazada', resueltoPor: correo(), fechaResolucion: Timestamp.now() });
    if (v2.exists()) tx.update(ventaRef, { solicitudAnulacionPendiente: false });
  });
}

// ── Reportes de ventas (leen resumenes_caja: un documento por cierre) ──
// desde / hasta: 'AAAA-MM-DD' (ambos incluidos). Una sola condición por consulta: no necesita índices.
export async function leerResumenes(desde, hasta) {
  const sn = await getDocs(query(collection(db, 'resumenes_caja'), where('fecha', '>=', desde)));
  return sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => (r.fecha || '') <= hasta);
}

// ── v0.70.1: tarjetas de rotación y agotado (caja v2.2.0), para el Plan de Panadería ──
// Cada resumen de una caja v2.2.0 trae, por producto con stock:
//   porTarjeta: { hoy: { cant, monto }, ayer, antesayer, cuartoDia, ultimaOferta, sinDato }
//   agotadoHoy: 'HH:MM' (primera vez que el lote de hoy llegó a 0 por una venta), reagotadoHoy: 'HH:MM'
// Resúmenes antiguos no los traen: registrado = false y todo lo vendido queda en sinDato.
// 0 lecturas: trabaja sobre lo que ya devolvió leerResumenes.
export const TARJETAS = ['hoy', 'ayer', 'antesayer', 'cuartoDia', 'ultimaOferta'];
const ALIAS_TARJETA = { dia4: 'cuartoDia', cuartodia: 'cuartoDia', oferta: 'ultimaOferta', ultimaoferta: 'ultimaOferta' };
export function normalizarTarjeta(t) {
  if (TARJETAS.includes(t) || t === 'sinDato') return t;
  return ALIAS_TARJETA[String(t || '').toLowerCase()] || 'sinDato';
}
const numT = v => Number(v) || 0;
// Un producto de un resumen → { registrado, porTarjeta (las 5 + sinDato, siempre), fresco, rebajado, agotadoHoy, reagotadoHoy }
export function tarjetasProducto(pp) {
  const out = {};
  [...TARJETAS, 'sinDato'].forEach(t => { out[t] = { cant: 0, monto: 0 }; });
  const pt = pp && pp.porTarjeta && typeof pp.porTarjeta === 'object' ? pp.porTarjeta : null;
  if (pt) Object.entries(pt).forEach(([t, v]) => { const k = normalizarTarjeta(t); out[k].cant += numT(v && v.cant); out[k].monto += numT(v && v.monto); });
  else if (pp) { out.sinDato.cant = numT(pp.cantidad); out.sinDato.monto = numT(pp.bruto); }
  const rebajado = ['ayer', 'antesayer', 'cuartoDia', 'ultimaOferta'].reduce((a, t) => ({ cant: a.cant + out[t].cant, monto: a.monto + out[t].monto }), { cant: 0, monto: 0 });
  return {
    registrado: !!pt, porTarjeta: out, fresco: { ...out.hoy }, rebajado,
    agotadoHoy: (pp && typeof pp.agotadoHoy === 'string' && pp.agotadoHoy) || '',
    reagotadoHoy: (pp && typeof pp.reagotadoHoy === 'string' && pp.reagotadoHoy) || ''
  };
}
// Resúmenes → filas por día, sucursal y producto: { fecha, sucursal, productoId, nombre, area, idRecetaFen, cantidad, bruto, ...tarjetasProducto }
// Dos cierres del mismo día y sucursal se suman; agotadoHoy queda con la hora más temprana y reagotadoHoy con la más tardía.
export function tarjetasDeResumenes(resumenes) {
  const F2 = {};
  (resumenes || []).forEach(r => {
    if (!r) return;
    Object.entries(r.porProducto || {}).forEach(([pid, pp]) => {
      if (!pp) return;
      const k = `${r.fecha || ''}|${r.sucursal || ''}|${pid}`;
      const t = tarjetasProducto(pp);
      const x = F2[k];
      if (!x) {
        F2[k] = { fecha: r.fecha || '', sucursal: r.sucursal || '', productoId: pid, nombre: pp.nombre || pid, area: pp.area || '', idRecetaFen: pp.idRecetaFen || '',
          cantidad: numT(pp.cantidad), bruto: numT(pp.bruto), ...t };
        return;
      }
      x.cantidad += numT(pp.cantidad); x.bruto += numT(pp.bruto);
      x.registrado = x.registrado && t.registrado;
      Object.keys(x.porTarjeta).forEach(tk => { x.porTarjeta[tk].cant += t.porTarjeta[tk].cant; x.porTarjeta[tk].monto += t.porTarjeta[tk].monto; });
      x.fresco = { ...x.porTarjeta.hoy };
      x.rebajado = { cant: x.rebajado.cant + t.rebajado.cant, monto: x.rebajado.monto + t.rebajado.monto };
      if (t.agotadoHoy && (!x.agotadoHoy || t.agotadoHoy < x.agotadoHoy)) x.agotadoHoy = t.agotadoHoy;
      if (t.reagotadoHoy && (!x.reagotadoHoy || t.reagotadoHoy > x.reagotadoHoy)) x.reagotadoHoy = t.reagotadoHoy;
    });
  });
  return Object.values(F2);
}

// Cajas abiertas en el rango (por fecha de apertura) para saber cuáles no tienen resumen.
export async function cajasDelRango(desde, hasta) {
  const [y, m, d] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const fin = new Date(y2, m2 - 1, d2 + 1).getTime();
  const sn = await getDocs(query(collection(db, 'cajas'), where('apertura', '>=', Timestamp.fromDate(new Date(y, m - 1, d)))));
  return sn.docs.map(x => ({ id: x.id, ...x.data() }))
    .filter(c => { const a = c.apertura && c.apertura.toMillis ? c.apertura.toMillis() : 0; return a && a < fin; });
}

// Genera los resúmenes que faltan (igual que "Generar resúmenes faltantes" de la caja).
export async function generarResumenes(cajas, avance) {
  let hechos = 0, fallas = 0;
  for (const c of cajas) {
    const ya = await getDoc(doc(db, 'resumenes_caja', c.id));
    if (!ya.exists()) {
      const vs = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', c.id)));
      (await guardarResumenCaja(c.id, c, vs.docs)) ? hechos++ : fallas++;
    }
    if (avance) avance(hechos + fallas, cajas.length);
  }
  return { hechos, fallas };
}

// ── v0.100.1 · Revisar una caja contra sus ventas ──
// Lo vendido en una caja según sus ventas (sin anuladas): dos consultas de agregación (1 lectura cada 1000 ventas); si fallan, sus ventas.
export async function sumarVentasCaja(id) {
  const vq = query(collection(db, 'ventas'), where('cajaId', '==', id));
  try {
    const [todas, anul] = await Promise.all([getAggregateFromServer(vq, { bruto: sum('total'), n: count() }), getAggregateFromServer(query(collection(db, 'ventas'), where('cajaId', '==', id), where('anulada', '==', true)), { bruto: sum('total'), n: count() })]);
    const a = todas.data(), b = anul.data();
    return { bruto: (Number(a.bruto) || 0) - (Number(b.bruto) || 0), n: (Number(a.n) || 0) - (Number(b.n) || 0) };
  } catch (e) {
    const sn = await getDocs(vq); let bruto = 0, n = 0;
    sn.docs.forEach(d => { const v = d.data(); if (v.anulada === true) return; bruto += parseInt(v.total) || 0; n++; });
    return { bruto, n };
  }
}
// Cada caja con lo que dicen sus ventas y lo que dice su resumen del cierre (si lo tiene). cuadra: el resumen suma lo mismo que las ventas.
export async function revisarCajas(cajas, resumenes = {}) {
  return Promise.all((cajas || []).map(async c => {
    const real = await sumarVentasCaja(c.id), r = resumenes[c.id] || null;
    return { id: c.id, sucursal: c.sucursal || (r && r.sucursal) || '', usuario: c.usuario || '', estado: c.estado || '', apertura: c.apertura && c.apertura.toDate ? c.apertura.toDate() : null,
      fecha: normalizarFechaCaja(c.fecha) || '', bruto: real.bruto, nVentas: real.n, resumen: r ? Number(r.totalBruto) || 0 : null, nResumen: r ? Number(r.nVentas) || 0 : null,
      cuadra: !r || ((Number(r.totalBruto) || 0) === real.bruto && (Number(r.nVentas) || 0) === real.n) };
  }));
}
// Rehacer el resumen de un cierre con todas sus ventas (cuando no cuadra): el mismo cálculo del cierre
export async function regenerarResumen(cajaId) {
  const c = await getDoc(doc(db, 'cajas', cajaId)); if (!c.exists()) throw new Error('Esa caja ya no está.');
  const vs = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', cajaId)));
  if (!(await guardarResumenCaja(cajaId, c.data(), vs.docs))) throw new Error('No se pudo guardar el resumen.');
  return true;
}

// ── v0.55.0: ventas de hoy (bruto con IVA, sin anuladas), para la tarjeta de Hoy ──
// Hoy todavía no hay resúmenes (se escriben al cerrar), así que por cada caja de hoy:
//  · cerrada y con resumen → se usa el resumen (ya descuenta anuladas; 0 lecturas extra);
//  · si no → dos consultas de agregación sobre ventas (cajaId == caja): sum(total) de todas
//    y sum(total) de las anuladas, y se restan. Cada agregación cuesta 1 lectura por cada
//    1000 ventas (mínimo 1), no una por venta.
//  · si la agregación falla (sin índice, sin red…), se leen las ventas de esa caja una vez.
// cajasHoy: cajas con fecha de hoy (abiertas o cerradas). resumenes: { cajaId: resumen }.
// Devuelve { total, porSuc: { sucursal: bruto }, nVentas, cajas }.
export async function ventasDeHoy(cajasHoy, resumenes = {}) {
  const ventasCaja = id => query(collection(db, 'ventas'), where('cajaId', '==', id));
  const una = async c => {
    const r = resumenes[c.id];
    if (c.estado === 'cerrada' && r) return { suc: c.sucursal || r.sucursal || '', bruto: Number(r.totalBruto) || 0, n: Number(r.nVentas) || 0 };
    try {
      const [todas, anul] = await Promise.all([
        getAggregateFromServer(ventasCaja(c.id), { bruto: sum('total'), n: count() }),
        getAggregateFromServer(query(collection(db, 'ventas'), where('cajaId', '==', c.id), where('anulada', '==', true)), { bruto: sum('total'), n: count() })
      ]);
      const a = todas.data(), b = anul.data();
      return { suc: c.sucursal || '', bruto: (Number(a.bruto) || 0) - (Number(b.bruto) || 0), n: (Number(a.n) || 0) - (Number(b.n) || 0) };
    } catch (e) {
      console.warn('Agregación no disponible, se leen las ventas de la caja', c.id, e && e.message);
      const sn = await getDocs(ventasCaja(c.id));
      let bruto = 0, n = 0;
      sn.docs.forEach(d => { const v = d.data(); if (v.anulada === true) return; bruto += parseInt(v.total) || 0; n++; });
      return { suc: c.sucursal || '', bruto, n };
    }
  };
  const partes = await Promise.all(cajasHoy.map(async c => ({ ...(await una(c)), id: c.id, usuario: c.usuario || '', estado: c.estado || '', apertura: c.apertura && c.apertura.toDate ? c.apertura.toDate() : null })));
  const porSuc = {};
  let total = 0, nVentas = 0;
  partes.forEach(p => { total += p.bruto; nVentas += p.n; if (p.bruto || p.n) porSuc[p.suc] = (porSuc[p.suc] || 0) + p.bruto; });
  return { total, porSuc, nVentas, cajas: cajasHoy.length, partes };   // v0.100.1: partes = cada caja
}

// ═══ v0.125.1 · Transferencias de la tienda (Ventas en tienda → Transferencias y Conciliación de abonos) ═══
// Las ventas cobradas por transferencia: una consulta por medio de pago (sin índice compuesto), las de los últimos 120 días,
// 2 minutos en memoria. Las de pago dividido no se pueden pedir así (su medio está dentro de "pagos"): no se unen solas.
let _vt = null;
export async function ventasTransferencia({ fresco = false } = {}) {
  if (!fresco && _vt && Date.now() - _vt.en < 120000) return _vt.l;
  const sn = await getDocs(query(collection(db, 'ventas'), where('medioPago', '==', 'transferencia')));
  const lim = haceDias(120).toMillis();
  const l = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.anulada && v.fecha && typeof v.fecha.toMillis === 'function' && v.fecha.toMillis() >= lim);
  _vt = { l, en: Date.now(), lecturas: Math.max(1, sn.size) };
  return l;
}
export function olvidarVentasTransferencia() { _vt = null; }
// "Fue con otro medio": la venta cambia de medio de pago (con rastro, como en la caja) y los totales de su caja se corrigen,
// de una sola vez. Si la caja ya cerró, se rehace su resumen. El arqueo ya hecho no cambia (queda como se contó).
export async function cambiarMedioVenta(ventaId, medio) {
  if (!['efectivo', 'debito', 'credito'].includes(medio)) throw new Error('Medio de pago no válido.');
  let cajaId = '', cerrada = false;
  await runTransaction(db, async tx => {
    const vref = doc(db, 'ventas', ventaId), vs = await tx.get(vref);
    if (!vs.exists()) throw new Error('Esa venta ya no está.');
    const v = vs.data();
    if (v.anulada) throw new Error('Esa venta está anulada.');
    if (Array.isArray(v.pagos) && v.pagos.length) throw new Error('Es un pago dividido: corríjalo en la caja.');
    if (v.medioPago !== 'transferencia') throw new Error('Esa venta ya no está como transferencia.');
    cajaId = v.cajaId || '';
    const cs = cajaId ? await tx.get(doc(db, 'cajas', cajaId)) : null;
    cerrada = !!(cs && cs.exists() && cs.data().estado === 'cerrada');
    tx.update(vref, { medioPago: medio, medioPagoOriginal: v.medioPagoOriginal || v.medioPago, medioPagoEditadoPor: correo(), medioPagoEditadoFecha: Timestamp.now() });
    if (cs && cs.exists()) tx.update(doc(db, 'cajas', cajaId), { 'totales.transferencia': increment(-ent(v.total)), [`totales.${medio}`]: increment(ent(v.total)) });
  });
  _vt = null;
  if (cerrada) await regenerarResumen(cajaId);
  return { cajaId, cerrada };
}
// "Llegó a otra cuenta": fue transferencia, pero no a la cuenta de la cartola (queda anotado en la venta; no cambia montos)
export async function ventaOtraCuenta(ventaId, nota) {
  await updateDoc(doc(db, 'ventas', ventaId), { transfRevision: { estado: 'otra_cuenta', nota: String(nota || '').trim().slice(0, 200), por: correo(), en: Timestamp.now() } });
  if (_vt) { const v = _vt.l.find(x => x.id === ventaId); if (v) v.transfRevision = { estado: 'otra_cuenta', nota: String(nota || '').trim().slice(0, 200), por: correo() }; }
}
export async function quitarOtraCuenta(ventaId) {
  await updateDoc(doc(db, 'ventas', ventaId), { transfRevision: null });
  if (_vt) { const v = _vt.l.find(x => x.id === ventaId); if (v) v.transfRevision = null; }
}
