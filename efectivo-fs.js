// ═══════════════════════════════════════════════
//  Sistema Fën — Efectivo · Firestore (fen-ventas)  v0.121.0
//  efectivo/caja_admin           { saldo, ultimoConteo: { dia, monto, diferencia, por, en }, actualizado, por }
//  efectivo_movimientos/{id}     un movimiento (ver efectivo-modelo.js) + { cuenta, creado, por } y, si se anula,
//                                anulado: { por, en, motivo }. Nada se borra.
//  Cada movimiento y el saldo se escriben juntos en una transacción.
//  Lecturas al abrir: 1 (el saldo) + los movimientos del mes elegido (una consulta por mes, sin índices)
//  + lo que las cajas dejaron por recibir (caja_movimientos con pendienteAdmin, una consulta sin índices).
//  v0.119.0 (caja v3.0.0): recibirDeCaja() pasa un retiro de la caja (o el sencillo que salió hacia ella)
//  a la caja de administración y lo marca recibido, todo en la misma transacción.
//  v0.121.0: recibirVarios() recibe varios completos en una sola transacción.
//  v0.122.0: un conteo puede corregir el anterior (mov.corrige): la diferencia queda como error de conteo, no como
//  faltante; si el que se corrige era el conteo inicial, el nuevo pasa a ser el conteo inicial.
//  v0.123.0: unir a su documento (pagos) o a su abono de la cartola (depósitos) y Retiros por semana (ver abajo).
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, getDoc, getDocs, query, where, Timestamp, runTransaction } from './firebase.js?v=0.138.0';
import { CUENTA, efecto, movPorRecibir, revisarRecepcion } from './efectivo-modelo.js?v=0.138.0';

const correo = () => (auth.currentUser && auth.currentUser.email) || '';
const refCuenta = () => doc(db, 'efectivo', CUENTA);

export async function leerCuenta() {
  const sn = await getDoc(refCuenta());
  return sn.exists() ? sn.data() : null;
}
export async function leerMes(mes) {
  const sn = await getDocs(query(collection(db, 'efectivo_movimientos'), where('mes', '==', mes)));
  return sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.cuenta === CUENTA);
}

// mov: lo que devuelve revisar(). → { id, saldo }
export async function guardar(mov) {
  const ref = doc(collection(db, 'efectivo_movimientos'));
  const ahora = Timestamp.now(), por = correo();
  let saldo = 0;
  await runTransaction(db, async tx => {
    const c = await tx.get(refCuenta());
    const antes = c.exists() ? Math.round(Number(c.data().saldo) || 0) : 0;
    const datos = { ...mov, cuenta: CUENTA, creado: ahora, por };
    let cambios;
    if (mov.tipo === 'conteo') {
      // El conteo deja el saldo en lo contado; la diferencia queda anotada en el movimiento
      datos.diferencia = mov.monto - antes;
      datos.saldoAntes = antes;
      const uc = c.exists() ? c.data().ultimoConteo : null;
      datos.inicial = !uc || !!(mov.corrige && uc.inicial);
      if (mov.corrige) {
        if (!uc || uc.dia !== mov.corrige.dia) throw new Error('El último conteo cambió mientras tanto. Cierre y vuelva a abrir Contar.');
        datos.corrige = { ...mov.corrige, inicial: !!uc.inicial, monto: Math.round(Number(uc.monto) || 0) };
      }
      saldo = mov.monto;
      cambios = { saldo, ultimoConteo: { dia: mov.dia, monto: mov.monto, diferencia: datos.diferencia, inicial: datos.inicial, ...(mov.corrige ? { corrige: true } : {}), por, en: ahora }, actualizado: ahora, por };
    } else {
      saldo = antes + efecto(mov);
      cambios = { saldo, actualizado: ahora, por };
    }
    tx.set(ref, datos);
    if (c.exists()) tx.update(refCuenta(), cambios);
    else tx.set(refCuenta(), { ...cambios, creado: ahora });
  });
  return { id: ref.id, saldo };
}

// Anular un ingreso o una salida (el conteo no se anula: se hace un conteo nuevo). → { saldo }
export async function anular(id, motivo) {
  const ref = doc(db, 'efectivo_movimientos', id);
  const ahora = Timestamp.now(), por = correo();
  let saldo = 0;
  await runTransaction(db, async tx => {
    const m = await tx.get(ref), c = await tx.get(refCuenta());
    if (!m.exists()) throw new Error('El movimiento ya no existe.');
    const d = m.data();
    if (d.anulado) throw new Error('Ese movimiento ya estaba anulado.');
    if (d.tipo === 'conteo') throw new Error('Un conteo no se anula: haga un conteo nuevo.');
    // v0.123.0 · Lo unido a su documento o a su abono no se anula aquí: primero se deshace allá (Gastos o la cartola)
    if (d.estado === 'unido' || d.estado === 'uniendo') throw new Error(d.motivo === 'deposito' ? 'Está unido a su abono de la cartola: primero deshaga la conciliación del abono.' : 'Está unido a su documento en Gastos: no se anula.');
    // Lo anterior al último conteo ya quedó cuadrado por ese conteo: anularlo descuadraría el saldo
    const uc = c.exists() && c.data().ultimoConteo, msC = uc && uc.en && uc.en.toMillis ? uc.en.toMillis() : 0, msM = d.creado && d.creado.toMillis ? d.creado.toMillis() : 0;
    if (msC && msM && msM < msC) throw new Error('Es anterior al último conteo, que ya lo incluye. Si hay un error, haga un conteo nuevo.');
    saldo = (c.exists() ? Math.round(Number(c.data().saldo) || 0) : 0) - efecto(d);
    tx.update(ref, { anulado: { por, en: ahora, motivo: String(motivo || '').trim().slice(0, 200) } });
    if (c.exists()) tx.update(refCuenta(), { saldo, actualizado: ahora, por });
  });
  return { saldo };
}

// v0.119.0 · Lo que las cajas dejaron para la caja de administración y aún no se recibe
export async function leerPorRecibir() {
  // v0.120.0: también el efectivo de clientes B2B que queda por recibir (efectivo_por_recibir)
  const [a, b] = await Promise.all([
    getDocs(query(collection(db, 'caja_movimientos'), where('pendienteAdmin', '==', true))),
    getDocs(query(collection(db, 'efectivo_por_recibir'), where('pendienteAdmin', '==', true)))
  ]);
  return [...a.docs.map(d => ({ id: d.id, col: 'caja_movimientos', ...d.data() })), ...b.docs.map(d => ({ id: d.id, col: 'efectivo_por_recibir', ...d.data() }))]
    .filter(m => !m.anulado && !m.recibido);
}

// v0.120.0 · Un cobro B2B en efectivo queda por recibir (lo marca Cobranza). → id
// v0.124.6: orden = N° de la orden cuando se pagó por orden (todavía sin folio)
export async function crearPorRecibirB2B({ folio, cliente, monto, dia, nota, orden }) {
  const ref = doc(collection(db, 'efectivo_por_recibir'));
  const ahora = Timestamp.now();
  await runTransaction(db, async tx => {
    tx.set(ref, { origen: 'b2b', folio: String(folio || ''), ...(orden ? { orden: String(orden) } : {}), cliente: String(cliente || '').slice(0, 120), monto: Math.round(Number(monto) || 0),
      dia, mes: String(dia || '').slice(0, 7), nota: String(nota || '').slice(0, 200), pendienteAdmin: true, por: correo(), creado: ahora });
  });
  return ref.id;
}

// Recibir en la caja de administración lo que dejó una caja o un cobro B2B. → { saldo }
// v0.120.0: recepcion = { llego, usos } cuando llega menos: entra lo esperado y sale, en la misma transacción,
// cada pago hecho con esa plata (Por unir) o el faltante con su motivo. Sin recepcion, llegó completo.
export async function recibirDeCaja(id, recepcion = null, col = 'caja_movimientos') {
  const refOrigen = doc(db, col, id);
  const ahora = Timestamp.now(), por = correo();
  let saldo = 0;
  await runTransaction(db, async tx => {
    const cm = await tx.get(refOrigen), c = await tx.get(refCuenta());
    if (!cm.exists()) throw new Error('Ese movimiento ya no existe.');
    const x = cm.data();
    if (x.anulado) throw new Error('Ese movimiento fue anulado.');
    if (x.recibido || x.pendienteAdmin !== true) throw new Error('Ya estaba recibido.');
    const base = movPorRecibir({ id, ...x });
    if (!base) throw new Error('Ese movimiento no va a la caja de administración.');
    const r = recepcion ? revisarRecepcion(base, recepcion) : { movs: [base], falta: 0 };
    if (r.error) throw new Error(r.error);
    const bol = await leerBoletas(tx, r.boletas);   // v0.131.0: las boletas ya pagadas que explican parte de la diferencia
    let s = c.exists() ? Math.round(Number(c.data().saldo) || 0) : 0;
    const ids = [];
    r.movs.forEach((m, i) => {
      const ref = doc(collection(db, 'efectivo_movimientos'));
      s += efecto(m);
      // Un milisegundo de diferencia entre cada uno: así el saldo línea por línea queda en orden
      tx.set(ref, { ...m, cuenta: CUENTA, creado: Timestamp.fromMillis(ahora.toMillis() + i), por });
      ids.push(ref.id);
    });
    saldo = s;
    if (c.exists()) tx.update(refCuenta(), { saldo, actualizado: ahora, por });
    else tx.set(refCuenta(), { saldo, actualizado: ahora, por, creado: ahora });
    tx.update(refOrigen, { pendienteAdmin: false, recibido: { por, en: ahora, efectivoId: ids[0], ...(r.falta ? { llego: base.monto - r.falta, falta: r.falta } : {}), ...(bol.length ? { boletas: bol.map(b => b.efId) } : {}) } });
    marcarBoletas(tx, bol, { id, col, texto: base.detalle || base.nota || '', por, en: ahora });
  });
  return { saldo };
}
// v0.131.0 · Las boletas elegidas al recibir: deben existir, seguir vigentes y no explicar otro pago (se leen antes de escribir)
async function leerBoletas(tx, boletas) {
  const out = [];
  for (const b of boletas || []) {
    const ref = doc(db, 'efectivo_movimientos', b.efId), sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Una de las boletas elegidas ya no existe.');
    const m = sn.data();
    if (m.anulado) throw new Error(`La boleta ${m.detalle || ''} fue anulada: elija otra.`);
    if (m.deRecepcion) throw new Error(`La boleta ${m.detalle || ''} ya explica otro cobro.`);
    if (Math.round(Number(m.monto) || 0) !== b.monto) throw new Error(`La boleta ${m.detalle || ''} es de $${Math.round(Number(m.monto) || 0).toLocaleString('es-CL')}, no de $${b.monto.toLocaleString('es-CL')}.`);
    out.push({ ...b, ref });
  }
  return out;
}
function marcarBoletas(tx, bol, { id, col, texto, por, en }) {
  bol.forEach(b => tx.update(b.ref, { deRecepcion: { id, col, texto: String(texto || '').slice(0, 120), por, en } }));
}

// v0.121.0 · Recibir varios de una vez, todos completos (Emmanuel, 31 oct): "Recibir todos (llegó completo)".
// lista: [{ id, col }] (solo lo que entra: retiros de una caja o efectivo B2B). Una sola transacción: si alguno ya estaba
// recibido o anulado, no se guarda ninguno. Cada movimiento con 1 ms de diferencia; el saldo se escribe una vez. → { saldo, n, total }
// v0.124.12: cada uno puede traer recepcion { llego, usos } (llegó con menos): se revisa con revisarRecepcion como uno solo.
export async function recibirVarios(lista) {
  const items = (lista || []).filter(x => x && x.id);
  if (!items.length) throw new Error('No hay nada que recibir.');
  const refs = items.map(x => doc(db, x.col || 'caja_movimientos', x.id));
  const ahora = Timestamp.now(), por = correo();
  let saldo = 0, total = 0;
  await runTransaction(db, async tx => {
    // Primero todas las lecturas (Firestore lo exige), después las escrituras
    const sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    const c = await tx.get(refCuenta());
    const bases = sns.map((sn, i) => {
      if (!sn.exists()) throw new Error('Uno de ellos ya no existe. No se recibió ninguno.');
      const x = sn.data();
      if (x.anulado) throw new Error('Uno de ellos fue anulado. No se recibió ninguno.');
      if (x.recibido || x.pendienteAdmin !== true) throw new Error('Uno de ellos ya estaba recibido. No se recibió ninguno.');
      const base = movPorRecibir({ id: items[i].id, ...x });
      if (!base || base.tipo !== 'ingreso') throw new Error('Uno de ellos no entra a la caja de administración. No se recibió ninguno.');
      const r = items[i].recepcion ? revisarRecepcion(base, items[i].recepcion) : { movs: [base], falta: 0 };
      if (r.error) throw new Error(`${base.detalle || 'Uno de ellos'}: ${r.error} No se recibió ninguno.`);
      return { base, r };
    });
    const bols = [];
    for (const { r } of bases) bols.push(await leerBoletas(tx, r.boletas));   // v0.131.0
    let s = c.exists() ? Math.round(Number(c.data().saldo) || 0) : 0, k = 0;
    bases.forEach(({ base, r }, i) => {
      let primero = null;
      r.movs.forEach(m => {
        const ref = doc(collection(db, 'efectivo_movimientos'));
        s += efecto(m); if (!primero) primero = ref.id;
        tx.set(ref, { ...m, cuenta: CUENTA, creado: Timestamp.fromMillis(ahora.toMillis() + k++), por });
      });
      total += base.monto - r.falta;
      tx.update(refs[i], { pendienteAdmin: false, recibido: { por, en: ahora, efectivoId: primero, ...(r.falta ? { llego: base.monto - r.falta, falta: r.falta } : {}), ...(bols[i].length ? { boletas: bols[i].map(b => b.efId) } : {}) } });
      marcarBoletas(tx, bols[i], { id: items[i].id, col: items[i].col || 'caja_movimientos', texto: base.detalle || base.nota || '', por, en: ahora });
    });
    saldo = s;
    if (c.exists()) tx.update(refCuenta(), { saldo, actualizado: ahora, por });
    else tx.set(refCuenta(), { saldo, actualizado: ahora, por, creado: ahora });
  });
  return { saldo, n: items.length, total };
}

// v0.131.0 · Cobros en efectivo de logística (fen-logistica v1.4.0): logística marca la orden pagada en fen-b2b; aquí cada cobro
// (uno por cliente, con sus órdenes) se deja por recibir con un id fijo (log_<cobroId>), así leerlo dos veces no lo repite.
// grupos: los cobros que siguen pendientes en fen-b2b (B2b.cobrosLogistica). pendientes: lo que hoy está por recibir.
// → { creados, anulados, recibidos: [cobro ya recibido aquí cuya orden sigue pendiente en fen-b2b] }
export const idCobroLogistica = cobroId => 'log_' + String(cobroId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
export async function sincronizarLogistica(grupos, pendientes) {
  const out = { creados: 0, anulados: 0, recibidos: [] }, vivos = new Set((grupos || []).map(g => idCobroLogistica(g.cobroId)));
  for (const g of grupos || []) {
    const ref = doc(db, 'efectivo_por_recibir', idCobroLogistica(g.cobroId));
    await runTransaction(db, async tx => {
      const sn = await tx.get(ref);
      if (sn.exists()) { const x = sn.data(); if (x.recibido) out.recibidos.push({ ...g, efectivoId: x.recibido.efectivoId || '' }); return; }
      tx.set(ref, { origen: 'b2b', folio: '', orden: g.ns.join(', '), cliente: String(g.cliente || '').slice(0, 120), monto: Math.round(Number(g.efectivo) || 0),
        dia: g.fecha, mes: String(g.fecha || '').slice(0, 7), pendienteAdmin: true, por: correo(), creado: Timestamp.now(),
        nota: `Cobró logística${g.redondeo ? ` · total $${g.total.toLocaleString('es-CL')}, redondeo ${g.redondeo > 0 ? '+' : '−'}$${Math.abs(g.redondeo).toLocaleString('es-CL')}` : ''}`.slice(0, 200),
        logistica: { cobroId: String(g.cobroId), ns: g.ns, total: g.total, redondeo: g.redondeo, cobro: String(g.por || '').slice(0, 120) } });
      out.creados++;
    });
  }
  // Lo que logística deshizo antes de que se recibiera: se anula aquí (nada se borra)
  for (const x of pendientes || []) {
    if (!x.logistica || x.col !== 'efectivo_por_recibir' || vivos.has(x.id)) continue;
    try { await anularPorRecibir(x.id, 'Logística deshizo el cobro'); out.anulados++; } catch (e) { /* ya recibido o anulado */ }
  }
  return out;
}

// v0.120.0 · Anular un cobro B2B que quedó por recibir (por ejemplo, el pago se marcó por error). Nada se borra.
export async function anularPorRecibir(id, motivo) {
  const ref = doc(db, 'efectivo_por_recibir', id);
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ya no existe.');
    const x = sn.data();
    if (x.recibido || x.anulado) throw new Error('Ya estaba recibido o anulado.');
    tx.update(ref, { pendienteAdmin: false, anulado: { por: correo(), en: Timestamp.now(), motivo: String(motivo || '').trim().slice(0, 200) } });
  });
}

// ═══════════════════════════════════════════════
//  v0.123.0 · Unir a su documento, depósitos con la cartola y Retiros por semana
//  · leerPorUnir(): 2 consultas sin índices (efectivo_movimientos con estado por_unir o uniendo; caja_movimientos con estado por_unir).
//    Se guarda 2 minutos (Efectivo y Conciliación la comparten) y se olvida al escribir.
//  · unir(): marca el movimiento unido (unido: { … , por, en } y estado 'unido'), en una transacción. El pago en Gastos (fen-gastos)
//    se hace ANTES y con una clave que sale del movimiento: si esta segunda parte falla, "Unir" otra vez no paga dos veces.
//  · Depósitos: por_unir → uniendo (con el id del abono) → unido. "uniendo" queda a la vista si algo se corta a medias.
//    desunir(): vuelve a por_unir (unido: null) y deja desunido { por, en, motivo }. Nada se borra.
//  · leerSemana(lunes): 2 consultas (evaluacion_caja por la hora del cierre y caja_movimientos por su día); se guarda por semana.
// ═══════════════════════════════════════════════
let porUnirMem = null;
export function olvidarPorUnir() { porUnirMem = null; }
export async function leerPorUnir({ soloAdmin = false } = {}) {
  if (porUnirMem && Date.now() - porUnirMem.t < 120000 && (soloAdmin || porUnirMem.conCajas)) return porUnirMem.lista.filter(m => !soloAdmin || m.col !== 'caja_movimientos');
  const [a, b] = await Promise.all([
    getDocs(query(collection(db, 'efectivo_movimientos'), where('estado', 'in', ['por_unir', 'uniendo']))),
    soloAdmin ? null : getDocs(query(collection(db, 'caja_movimientos'), where('estado', '==', 'por_unir')))
  ]);
  const lista = [...a.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.cuenta === CUENTA && !m.anulado),
    ...(b ? b.docs.map(d => ({ id: d.id, col: 'caja_movimientos', ...d.data() })).filter(m => !m.anulado) : [])];
  porUnirMem = { t: Date.now(), lista, conCajas: !soloAdmin };
  return lista;
}
const refDe = m => doc(db, m.col === 'caja_movimientos' ? 'caja_movimientos' : 'efectivo_movimientos', m.id);
// union: { docId, pagoId, documento ("Boleta 4471"), proveedor, monto } → { repetido? }
export async function unir(m, union) {
  const ref = refDe(m), por = correo(), ahora = Timestamp.now();
  let repetido = false;
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese movimiento ya no existe.');
    const x = sn.data();
    if (x.anulado) throw new Error('Ese movimiento fue anulado.');
    if (x.estado === 'unido' && x.unido && x.unido.docId === union.docId) { repetido = true; return; }
    if (x.estado !== 'por_unir') throw new Error('Ese movimiento ya no está por unir. Vuelva a abrir Efectivo.');
    tx.update(ref, { estado: 'unido', unido: { ...union, por, en: ahora } });
  });
  porUnirMem = null;
  return { repetido };
}
// Depósito → "uniendo" con su abono (paso 1 de 3: después se marca el abono en la cartola y se termina)
export async function depositoUniendo(depId, abono) {
  const ref = doc(db, 'efectivo_movimientos', depId), por = correo(), ahora = Timestamp.now();
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese depósito ya no existe.');
    const x = sn.data();
    if (x.anulado) throw new Error('Ese depósito fue anulado en Efectivo.');
    if (x.estado === 'uniendo' && x.unido && x.unido.cartolaMovId === abono.id) return;
    if (x.estado !== 'por_unir') throw new Error('Ese depósito ya está unido a otro abono.');
    tx.update(ref, { estado: 'uniendo', unido: { cartolaMovId: abono.id, abonoDia: String(abono.fecha || '').slice(0, 10), monto: Math.round(Number(abono.monto) || 0), cuenta: abono.cuenta || '', por, en: ahora } });
  });
  porUnirMem = null;
}
export async function depositoUnido(depId, abonoId) {
  const ref = doc(db, 'efectivo_movimientos', depId);
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese depósito ya no existe.');
    const x = sn.data();
    if (x.estado === 'unido') return;
    if (x.estado !== 'uniendo' || !x.unido || x.unido.cartolaMovId !== abonoId) throw new Error('Ese depósito cambió mientras tanto. Vuelva a abrir la conciliación.');
    tx.update(ref, { estado: 'unido' });
  });
  porUnirMem = null;
}
// Deshacer: el depósito vuelve a "Por unir" (solo si sigue unido a ese abono; si ya estaba por unir, no hace nada)
export async function desunir(depId, abonoId, motivo) {
  const ref = doc(db, 'efectivo_movimientos', depId), por = correo(), ahora = Timestamp.now();
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) return;
    const x = sn.data();
    if (x.estado === 'por_unir') return;
    if (!x.unido || (abonoId && x.unido.cartolaMovId !== abonoId)) throw new Error('Ese depósito está unido a otro abono: no se cambió.');
    tx.update(ref, { estado: 'por_unir', unido: null, desunido: { por, en: ahora, motivo: String(motivo || '').trim().slice(0, 200), antes: { ...x.unido } } });
  });
  porUnirMem = null;
}

const semanaMem = {};
export function olvidarSemanas() { Object.keys(semanaMem).forEach(k => delete semanaMem[k]); }
// lunes 'AAAA-MM-DD' → { evals, cmovs } (los cierres hasta 2 días después del domingo, por si una caja se cerró tarde)
export async function leerSemana(lunes, { forzar = false } = {}) {
  if (semanaMem[lunes] && !forzar && Date.now() - semanaMem[lunes].t < 600000) return semanaMem[lunes].d;
  const [y, m, d] = lunes.split('-').map(Number);
  const desde = Timestamp.fromDate(new Date(y, m - 1, d)), hasta = Timestamp.fromDate(new Date(y, m - 1, d + 9));
  const dom = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10);
  const [a, b] = await Promise.all([
    getDocs(query(collection(db, 'evaluacion_caja'), where('cierre', '>=', desde), where('cierre', '<', hasta))),
    getDocs(query(collection(db, 'caja_movimientos'), where('dia', '>=', lunes), where('dia', '<=', dom)))
  ]);
  const r = { evals: a.docs.map(x => ({ id: x.id, ...x.data() })), cmovs: b.docs.map(x => ({ id: x.id, ...x.data() })) };
  semanaMem[lunes] = { t: Date.now(), d: r };
  return r;
}
