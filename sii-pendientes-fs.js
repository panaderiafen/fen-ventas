// ═══════════════════════════════════════════════
//  Sistema Fën — Documentos del SII por clasificar y pagos sin banco, con la base nueva (fen-gastos)  v0.66.0
//  Reglas en sii-pendientes.js. Aquí solo lo que lee y escribe:
//  · sii_docs/{id}.porClasificar: el documento tal como vino del archivo (montos, fechas, forma de pago y productos), guardado
//    al subirlo. Sin "lineas" ni "notas": la copia a la planilla no agrega nada a "Detalle Compras" hasta que se clasifica
//    (al importar, sus productos entran como siempre). Un documento ya importado no se toca.
//  · Clasificar (al conciliar, en Pagos sin banco o en Cargas del SII): se importa con lo de siempre (gastos-sii-fs.js: un
//    gasto por ítem y área con la fecha de la factura, el vencimiento si es a crédito, la ficha del proveedor aprendida).
//  · Pagos en efectivo o con tarjeta: el gasto queda con su fecha de pago y medio, y un registro en sii_pagos/{doc} para el
//    flujo de caja (F4). sii_pagos no pasa a la planilla (como tef_enviadas y proveedores).
//  · "Todavía por pagar": un vencimiento con la fecha esperada (Agenda y Hoy); se puede reagendar.
//  · config/sii_pagos = { dias }: desde cuántos días después de la factura se pregunta (10 si no se cambia).
//  · Revisar automáticas: los gastos clasificados solos al subir, hasta que se revisan (autoRevisada), se corrigen o se anulan.
//  Lecturas: sii_docs y gastos salen de la memoria de fs-gastos.js (paquetes): ninguna lectura por documento.
//  · v0.67.2: un documento cuyos gastos fueron todos anulados vuelve a por clasificar (contexto, una escritura por documento, una
//    vez) y "Volver a clasificar" (infoVolver, volverAClasificar).
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as S from './gastos-sii.js?v=0.138.0';
import * as SP from './sii-pendientes.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import { dbBase, todos, catalogo, nuevo, nuevoVenc, cambio, despues, limpio, correo, abonoParcial } from './gastos-fs.js?v=0.138.0';
import * as PM from './pagos-mixtos.js?v=0.138.0';   // v0.69.2: documentos pagados en partes con saldo

const s = v => String(v == null ? '' : v);
const error = (msg, code) => Object.assign(new Error(msg), { code });
const ahora = () => M.ahoraChile().texto;
const hoy = () => M.ahoraChile().dia;
const SIIF = () => import('./gastos-sii-fs.js?v=0.138.0');
export const COL_PAGOS = 'sii_pagos';

// ── Configuración (días) ──
let cfg = null;
export async function config(forzar) {
  if (cfg && !forzar) return cfg;
  try { const d = await dbBase(), sn = await FB.getDoc(FB.doc(d, 'config', 'sii_pagos')); const x = sn.exists() ? sn.data() : {}; cfg = { dias: Number(x.dias) > 0 ? Number(x.dias) : SP.DIAS_SIN_PAGO, migrado: s(x.migrado) }; }
  catch (e) { cfg = { dias: SP.DIAS_SIN_PAGO, migrado: '' }; }
  return cfg;
}
export async function guardarConfig(dias) {
  const n = Math.round(Number(dias));
  if (!(n >= 1 && n <= 90)) throw error('Escribe un número de días entre 1 y 90', 'datos');
  const d = await dbBase();
  await FB.setDoc(FB.doc(d, 'config', 'sii_pagos'), { dias: n, por: correo(), en: ahora() }, { merge: true });
  cfg = null;
  return config(true);
}

// ── Lecturas ──
// v0.67.1 · Por clasificar = lo subido sin gasto, MENOS lo que ya tiene su gasto registrado: al listar se revisa (de la memoria:
// sii_docs y gastos van en los paquetes, 0 lecturas) y lo que calza fuerte o débil y único se une solo, una vez (1 escritura por
// documento, registrado { gastos, por, … }). Lo ambiguo o posible queda por clasificar con su aviso (registro) y "Unir".
const tomadosDe = docs => new Set(docs.flatMap(x => (SP.estaRegistrado(x.d) ? x.d.registrado.gastos.map(s) : [])));
// v0.67.2 · Antes de todo: los documentos cuyos gastos fueron TODOS anulados vuelven a por clasificar (también lo de antes: lo
// importado antes de la v0.66, lo clasificado en la v0.66 y lo unido en la v0.67.1). Se revisa de la memoria (0 lecturas) cada vez
// que se lista y se guarda UNA vez (1 escritura por documento + la ficha del proveedor si tenía lo anulado), con su historial.
async function contexto() {
  const [docs0, gastos, vencs] = await Promise.all([todos('sii_docs'), todos('gastos').catch(() => []), todos('vencimientos').catch(() => [])]);
  const idx = SP.indiceGastos(gastos), vueltas = [];
  const docs = docs0.map(x => {
    const r = SP.revisarVuelta(x.id, x.d, idx);
    if (!r.vuelve) return x;
    const c = SP.camposVuelta(x.d, r, { en: ahora(), por: correo() });
    vueltas.push({ x, r, c });
    return { id: x.id, d: { ...x.d, ...docVuelta(x.d, c, SP.MOTIVO_VUELTA, { gastos: r.gastos.length }) } };
  });
  const nuevas = vueltas.filter(v => !yaVueltos.has(v.x.id));
  if (nuevas.length) { nuevas.forEach(v => yaVueltos.add(v.x.id)); volviendo = volviendo.then(() => guardarVueltas(nuevas)).catch(() => { nuevas.forEach(v => yaVueltos.delete(v.x.id)); }); await volviendo; }
  return { docs, gastos, vencs, idx, vueltas, compras: SP.comprasDe(gastos, tomadosDe(docs)) };
}
const yaVueltos = new Set();
let volviendo = Promise.resolve();
// La ficha del proveedor sin lo anulado (de la memoria): { ref, campos } o null
async function fichaSin(d0, rut, gastoIds, docId) {
  const r = SP.rutNorm(rut); if (!r) return null;
  const fs0 = (await todos('proveedores').catch(() => [])).find(x => x.id === r);
  const f = fs0 && SP.fichaSinDoc(fs0.d, gastoIds, docId);
  return f ? { ref: FB.doc(d0, 'proveedores', r), campos: limpio({ ...f, actualizado: { en: FB.serverTimestamp(), por: correo(), que: 'documento por clasificar de nuevo' } }) } : null;
}
// Escribe la vuelta: el documento con cambio() (historial; las listas largas de líneas van aparte, sin copiarse al historial)
const docVuelta = (a, c, que, extra) => ({ ...cambio(a, que, c.chicos, extra), ...c.listas });
async function guardarVueltas(lista) {
  const d = await dbBase();
  let n = 0;
  for (let i = 0; i < lista.length; i += 150) {
    const b = FB.writeBatch(d);
    for (const { x, r, c } of lista.slice(i, i + 150)) {
      b.update(FB.doc(d, 'sii_docs', x.id), docVuelta(x.d, c, SP.MOTIVO_VUELTA, { gastos: r.gastos.length }));
      n++;
      const fi = await fichaSin(d, x.d.rut, r.gastos.map(g => g.id), x.id);
      if (fi) { b.set(fi.ref, fi.campos, { merge: true }); n++; }
    }
    await b.commit();
  }
  await despues(n);
  return n;
}
const yaUnidos = new Set();
let uniendo = Promise.resolve();
export async function pendientes() {
  const { docs, compras, vencs } = await contexto(), out = [], unir = [], usados = new Set(), porId = new Map(docs.map(x => [x.id, x.d]));
  SP.pendientesDe(docs).forEach(v => {
    const r = SP.registroDe(v, compras);
    if (SP.seUneSola(r) && !r.gastos.some(id => usados.has(id))) { r.gastos.forEach(id => usados.add(id)); unir.push({ v, r, a: porId.get(v.id), venc: SP.vencimientoDeCompras(r.compras, vencs, v) }); return; }
    v.registro = r.tipo ? (SP.seUneSola(r) ? { ...r, tipo: 'ambiguo', gastos: [], motivo: 'Puede estar ya registrada: otro documento calza con el mismo gasto' } : r) : null;
    out.push(v);
  });
  const nuevos = unir.filter(x => !yaUnidos.has(x.v.id));
  if (nuevos.length) { nuevos.forEach(x => yaUnidos.add(x.v.id)); uniendo = uniendo.then(() => guardarUniones(nuevos)).catch(() => { nuevos.forEach(x => yaUnidos.delete(x.v.id)); }); await uniendo; }
  return out;
}
// Lo ya registrado (para proponer el pago en la cartola): con su vencimiento, si no lo tenía anotado (de la memoria)
export async function registrados() {
  const { docs, gastos, vencs } = await contexto(), l = SP.registradosDe(docs);
  if (l.some(v => !v.registrado.vencimiento)) {
    const compras = SP.comprasDe(gastos, []);
    l.forEach(v => { if (v.registrado.vencimiento) return; const ids = new Set(v.registrado.gastos); v.registrado.vencimiento = SP.vencimientoDeCompras(compras.filter(c => c.ids.some(id => ids.has(id))), vencs, v); });
  }
  return l;
}
// Una escritura por documento; si otro equipo ya lo unió o lo importó, no se toca
async function guardarUniones(lista) {
  const d = await dbBase(), por = correo(), en = ahora();
  let n = 0;
  for (let i = 0; i < lista.length; i += 200) {
    const b = FB.writeBatch(d);
    // sin lecturas: lo que tenía el documento (versión e historial) sale de la memoria
    lista.slice(i, i + 200).forEach(({ v, r, a, venc }) => { b.update(FB.doc(d, 'sii_docs', v.id), cambio(a || {}, `unido a un gasto ya registrado (${r.por})`, { registrado: SP.datosRegistrado(v, r, { en, quien: por, ...(venc ? { vencimiento: venc } : {}) }) })); n++; });
    await b.commit();
  }
  await despues(n);
  return n;
}
// ¿Qué pasa con estos documentos al subirlos? (antes de clasificar solo: nunca un segundo gasto)
// facturas: documentos leídos del archivo (sii.js). → { clave: registroDe }
export async function registrosAlSubir(facturas) {
  const { compras, vencs } = await contexto(), out = {};
  const { docs } = await contexto(), porId = new Map(docs.map(x => [x.id, x.d]));
  (facturas || []).forEach(f => {
    if (!f || f.esNotaCredito) return;
    const v = SP.vistaPendiente('', { rut: f.rut, folio: f.folio, razonSocial: f.razonSocial, porClasificar: SP.datosPendiente(f) });
    v.id = S.idDoc(f.rut, f.folio, false);
    // v0.67.2 · ya estaba y volvió a por clasificar (sus gastos se anularon): queda por clasificar, nunca se clasifica solo
    const prev = porId.get(v.id);
    if (prev && prev.vueltaPorClasificar && SP.esPendiente(prev)) { out[`${f.rut}|${f.folio}`] = { tipo: 'devuelto', por: '', compras: [], gastos: [], motivo: 'Sus gastos fueron anulados: vuelve a por clasificar' }; return; }
    const r = SP.registroDe(v, compras);
    if (SP.seUneSola(r)) r.vencimiento = SP.vencimientoDeCompras(r.compras, vencs, v);
    if (r.tipo) out[`${f.rut}|${f.folio}`] = r;
  });
  return out;
}
// "Unir a un gasto ya registrado": las compras para elegir y unir (1 escritura; nunca crea un gasto)
export async function paraUnir(docId) {
  const { docs, compras } = await contexto(), x = docs.find(y => y.id === s(docId));
  if (!x || !SP.esPendiente(x.d)) return [];
  return SP.comprasParaUnir(SP.vistaPendiente(x.id, x.d), compras);
}
export async function unir(docId, gastoIds) {
  const { docs, compras, vencs } = await contexto(), x = docs.find(y => y.id === s(docId));
  if (!x) throw error('Ese documento ya no está. Recarga.', 'datos');
  if (!SP.esPendiente(x.d)) throw error('Ese documento ya no está por clasificar (ya tiene su gasto). Recarga.', 'cambio');
  const ids = new Set((gastoIds || []).map(s)), cs = compras.filter(c => c.ids.some(id => ids.has(id)));
  if (!cs.length) throw error('Ese gasto ya no está (o ya quedó unido a otro documento). Recarga.', 'cambio');
  const v = SP.vistaPendiente(x.id, x.d), r = { tipo: 'manual', por: 'manual', compras: cs, gastos: cs.flatMap(c => c.ids), motivo: 'Unido a mano a un gasto ya registrado' };
  const d = await dbBase();
  const venc = SP.vencimientoDeCompras(cs, vencs, v);
  await FB.updateDoc(FB.doc(d, 'sii_docs', x.id), cambio(x.d, 'unido a un gasto ya registrado (a mano)', { registrado: SP.datosRegistrado(v, r, { en: ahora(), quien: correo(), ...(venc ? { vencimiento: venc } : {}) }) }));
  await despues(1);
  return { ok: true, gastos: r.gastos };
}
// ── v0.67.2 · "Volver a clasificar" (Cargas del SII y Gastos → Registrados) ──
// El documento de un gasto: su siiDoc o el RUT + folio. → id del documento o ''
export async function docDeGasto(g) {
  const sd = s(g && (g.siiDocId || (g.siiDoc && g.siiDoc.id)));
  if (sd) return sd;
  const rut = s(g && (g.rut || g.rutProveedor)).trim(), folio = s(g && g.folio).trim();
  return rut && folio && S.rutOk(rut) && S.folioOk(folio) ? S.idDoc(rut, folio, false) : '';
}
// Cómo está un documento (de la memoria): { pendiente, vuelta, texto }
export async function estadoDoc(docId) {
  const { docs } = await contexto(), x = docs.find(y => y.id === s(docId));
  if (!x) return null;
  return { pendiente: SP.esPendiente(x.d), vuelta: SP.esPendiente(x.d) && !!x.d.vueltaPorClasificar, texto: SP.textoDoc({ razonSocial: s(x.d.razonSocial), folio: s(x.d.folio) }) };
}
// Lo que se va a anular y lo que bloquea (de la memoria: 0 lecturas)
// → { ok, doc: { id, razonSocial, folio, total, fecha }, gastos: [{ id, item, area, monto, fecha }], bloqueos: [texto], motivoNo }
export async function infoVolver(docId) {
  const { docs, idx, vencs } = await contexto(), x = docs.find(y => y.id === s(docId));
  if (!x || x.d.quitadoEnPlanilla) return { ok: false, motivoNo: 'Esta factura no está en los documentos del SII de la base nueva: súbela en Gastos → Bandeja → Subir archivo. Si quieres sacar su gasto, anúlalo.', gastos: [], bloqueos: [] };
  if (s(x.d.tipo) === '61') return { ok: false, motivoNo: 'Las notas de crédito se corrigen desde su carga.', gastos: [], bloqueos: [] };
  if (x.d.importado && (x.d.importado.aVencimiento || x.d.importado.pendienteId)) return { ok: false, motivoNo: 'Esta factura fue al vencimiento de su cuenta recurrente (según documento): se corrige en Gastos → Por pagar.', gastos: [], bloqueos: [] };
  const doc = { id: x.id, razonSocial: s(x.d.razonSocial), folio: s(x.d.folio), total: Number((x.d.importado || {}).total || (x.d.porClasificar || {}).total) || 0, fecha: s((x.d.porClasificar || {}).fecha || (x.d.importado || {}).fechaDocto || x.d.fecha) };
  if (SP.esPendiente(x.d)) return { ok: false, yaPendiente: true, doc, motivoNo: 'Ya está por clasificar.', gastos: [], bloqueos: [] };
  const r = SP.revisarVuelta(x.id, x.d, idx), vig = r.vigentes;
  if (!vig.length) return { ok: false, doc, motivoNo: 'No se encontró ningún gasto vigente de esta factura.', gastos: [], bloqueos: [] };
  let cargos = [];
  if (vig.some(g => s(g.d.cartolaCargo)) || (vencs || []).some(v => s(v.d.cartolaCargo))) cargos = await todos('cartola_cargos').catch(() => []);
  const bloqueos = SP.bloqueosVolver(r, vencs, cargos, x.d);
  return { ok: !bloqueos.length, doc, rut: s(x.d.rut), bloqueos, gastos: vig.map(({ id, d: g }) => ({ id, item: s(g.itemGasto), area: s(g.area), monto: Math.round(Number(g.montoFinal) || 0), fecha: s(g.fecha).slice(0, 10), version: Number(g.version) || 0 })) };
}
// Anula todos los gastos vigentes del documento en UNA transacción y lo deja por clasificar (con su historial). Lee en la
// transacción el documento y cada gasto (para no pisar un cambio de otro equipo): n + 1 lecturas, n + 1 escrituras (+1 la ficha).
export async function volverAClasificar(docId, motivoP) {
  const motivo = M.texto(motivoP, 300);
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const info = await infoVolver(docId);
  if (!info.ok) throw error(info.bloqueos && info.bloqueos.length ? info.bloqueos.join(' ') : info.motivoNo || 'No se puede volver a clasificar', info.bloqueos && info.bloqueos.length ? 'bloqueado' : 'datos');
  const d = await dbBase(), por = correo() || 'Sistema Fën', en = ahora(), refD = FB.doc(d, 'sii_docs', s(docId)), refs = info.gastos.map(g => FB.doc(d, 'gastos', g.id));
  const fi = await fichaSin(d, info.rut, info.gastos.map(g => g.id), s(docId)), gastos0 = await todos('gastos');
  const mot = `Volver a clasificar: ${motivo}`;
  await FB.runTransaction(d, async tx => {
    const sd = await tx.get(refD), sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    if (!sd.exists()) throw error('Ese documento ya no está. Recarga.', 'cambio');
    sns.forEach((sn, i) => { if (!sn.exists() || sn.data().estado !== 'vigente' || (Number(sn.data().version) || 0) !== info.gastos[i].version || s(sn.data().cartolaCargo)) throw error('Un gasto de esta factura cambió en otro lado. Recarga.', 'cambio'); });
    const a = sd.data();
    // con los gastos ya anulados (en memoria) el documento vuelve: los mismos campos que la vuelta automática
    const anulados = sns.map((sn, i) => ({ id: refs[i].id, d: { ...sn.data(), estado: 'anulado' } }));
    const gastosMem = gastos0.filter(x => !anulados.some(y => y.id === x.id)).concat(anulados);
    const r = SP.revisarVuelta(sd.id || s(docId), a, SP.indiceGastos(gastosMem));
    if (!r.vuelve) throw error('Esta factura tiene otros gastos vigentes. Recarga.', 'cambio');
    sns.forEach((sn, i) => tx.update(refs[i], cambio(sn.data(), 'anuló', { estado: 'anulado', anulado: { el: en, en, por, motivo: mot, filaOriginal: '' } }, { motivo: mot })));
    const c = SP.camposVuelta(a, r, { en, por, motivo: `volver a clasificar: ${motivo}` });
    tx.update(refD, docVuelta(a, c, `volver a clasificar: ${motivo}`, { gastos: refs.length }));
    if (fi) tx.set(fi.ref, fi.campos, { merge: true });
  });
  yaVueltos.add(s(docId));
  await despues(refs.length + 1 + (fi ? 1 : 0));
  return { ok: true, gastos: info.gastos.map(g => g.id), doc: info.doc };
}
// v0.81.7 · "No es una compra": un documento por clasificar que no es gasto (una guía de despacho, un documento duplicado del SII…).
// No se borra: queda descartado con quién, cuándo y por qué, y sale de "Por clasificar".
export async function descartar(docId, motivoP) {
  const motivo = M.texto(motivoP, 300);
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const d = await dbBase(), por = correo() || 'Sistema Fën', en = ahora(), ref = FB.doc(d, 'sii_docs', s(docId));
  await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw error('Ese documento ya no está. Recarga.', 'cambio');
    const a = sn.data();
    if (a.importado || SP.estaRegistrado(a)) throw error('Ese documento ya tiene su gasto: anúlalo en Registrados.', 'datos');
    tx.update(ref, cambio(a, 'descartó: no es una compra', { descartado: { por, en, motivo } }, { motivo }));
  });
  await despues(1);
  return { ok: true };
}
async function pagos() { try { return (await todos(COL_PAGOS)).filter(x => !x.d.quitado).map(x => ({ id: x.id, ...x.d })); } catch (e) { return []; } }
// Lo que muestra la pestaña "Pagos sin banco"
// v0.69.2 · La lista: las facturas sin pago del banco y los documentos pagados en partes con saldo cuya fecha ya pasó
const listaSinBanco = (pend, gs, pg, c, vencs) => SP.pagosSinBanco({ pendientes: pend, gastos: gs, pagos: pg, hoy: hoy(), dias: c.dias })
  .concat(PM.saldosSinBanco(vencs, hoy())).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.folio).localeCompare(String(b.folio)));
export async function datos() {
  const [pend, gs, pg, c, vencs] = await Promise.all([pendientes(), todos('gastos', FB.where('esperaPago', '==', true)).catch(() => []), pagos(), config(), todos('vencimientos')]);
  const lista = listaSinBanco(pend, gs, pg, c, vencs), conSaldo = new Set(lista.filter(x => x.saldo).map(x => x.vencId));
  // "Todavía por pagar" ya registrados: vencimientos abiertos de facturas del SII (para reagendar); los que ya pasaron su fecha y
  // tienen partes van arriba, en la lista (v0.69.2)
  const porPagar = vencs.filter(x => x.d && !x.d.quitadoEnPlanilla && x.d.porPagarSinBanco === true && G3.abierto(x.d) && !conSaldo.has(x.id))
    .map(x => ({ id: x.id, nombre: s(x.d.nombre), fecha: G3.fechaReal(x.d), monto: Number(x.d.montoEstimado) || 0 })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { lista, pagos: pg, config: c, porPagar, pendientes: pend };
}
// Hoy: conteos desde la memoria
export async function conteosHoy() {
  const [pend, gs, pg, c, vencs] = await Promise.all([pendientes(), todos('gastos', FB.where('esperaPago', '==', true)).catch(() => []), pagos(), config(), todos('vencimientos').catch(() => [])]);
  return SP.conteosHoy(pend, listaSinBanco(pend, gs, pg, c, vencs));
}
// Las pestañas de Conciliación (los números junto al nombre): todo desde la memoria
export async function conteos() {
  const [pend, gs, pg, c, ga, vencs] = await Promise.all([pendientes(), todos('gastos', FB.where('esperaPago', '==', true)).catch(() => []), pagos(), config(), todos('gastos', FB.where('clasificacionAutomatica', '==', true)).catch(() => []), todos('vencimientos').catch(() => [])]);
  const lista = listaSinBanco(pend, gs, pg, c, vencs);
  return { porClasificar: pend.filter(v => !v.esNC).length, sinBanco: lista.length, automaticas: SP.automaticasDe(ga).length, resumen: resumenMemoria(pend, pg, vencs) };
}
// v0.69.3 · Finanzas → Resumen del mes: lo mismo que ya se leyó para los números de las pestañas (0 lecturas nuevas).
//  · siiPorMes: los documentos del SII por clasificar de cada mes (la misma cuenta que el cierre de mes: SP.pendientesDelMes);
//  · caja: lo pagado en efectivo (Pagos sin banco y la parte en efectivo de los pagos mixtos), con su fecha y de dónde salió;
//  · partes: los vencimientos con abonos y saldo abierto; vencidas: los documentos con saldo cuya fecha ya pasó (como Pagos sin banco).
function resumenMemoria(pend, pg, vencs) {
  const siiPorMes = {};
  [...new Set((pend || []).map(v => s(v.fecha).slice(0, 7)).filter(Boolean))].forEach(m => { const x = SP.pendientesDelMes(pend, m); siiPorMes[m] = { n: x.n, monto: x.monto }; });
  const caja = PM.pagosDeCaja([], pg).filter(x => x.medio === 'efectivo').map(x => ({ fecha: x.fecha, monto: x.monto, origen: x.origen }));
  const partes = (vencs || []).filter(x => x.d && !x.d.quitadoEnPlanilla && G3.abierto(x.d) && Array.isArray(x.d.abonos) && x.d.abonos.length && G3.saldoVenc(x.d) > 1)
    .map(x => ({ id: x.id, nombre: s(x.d.nombre), saldo: Math.round(G3.saldoVenc(x.d)) }));
  const vencidas = PM.saldosSinBanco(vencs, hoy()).map(x => ({ id: x.vencId, nombre: x.nombre, monto: x.monto, fecha: x.fecha }));
  return { siiPorMes, caja, partes, vencidas, porClasificar: (pend || []).filter(v => !v.esNC).length };
}
// Cargas del SII → "Por clasificar" y "Revisar automáticas"
export async function documentos() {
  const [pend, ga] = await Promise.all([pendientes(), todos('gastos', FB.where('clasificacionAutomatica', '==', true)).catch(() => [])]);
  return { pendientes: pend.filter(v => !v.esNC || v.total), automaticas: SP.automaticasDe(ga) };
}
// "Está bien": la automática revisada sale de la lista (queda en su historial)
export async function revisarAutomatica(ids) {
  const d = await dbBase(), refs = (ids || []).map(id => FB.doc(d, 'gastos', s(id)));
  if (!refs.length) throw error('Faltan los gastos', 'datos');
  await FB.runTransaction(d, async tx => {
    const sns = []; for (const r of refs) sns.push(await tx.get(r));
    sns.forEach((g, i) => { if (!g.exists()) throw error('Ese gasto ya no está. Recarga.', 'cambio'); const a = g.data(); if (a.autoRevisada === true) return; tx.update(refs[i], cambio(a, 'revisó la clasificación automática', { autoRevisada: true })); });
  });
  await despues(refs.length);
  return { ok: true };
}

// Fichas de proveedores a mano con su ítem (y área): { rut sin puntos ni guion → { item, area } }
export async function fichasManuales() {
  const out = {};
  (await todos('proveedores')).forEach(x => { const f = x.d || {}; if (f.archivado || !f.item) return; const r = SP.rutNorm(f.rutTexto || f.rut || x.id); if (r) out[r] = { item: s(f.item), area: s(f.area), manual: !!f.manual }; });
  return out;
}
// ── Al subir: guardar los documentos que quedan por clasificar ──
// lista: [{ f (documento leído del archivo), motivo }]; origen: { cargaId, formato, archivo }
export async function guardarPendientes(lista, origen = {}) {
  // v0.67.2 · con la vuelta a por clasificar ya hecha (contexto): un documento devuelto se encuentra y se actualiza, nunca se repite
  const { docs } = await contexto(), porId = new Map(docs.map(x => [x.id, x.d])), d = await dbBase(), por = correo(), en = ahora();
  const escribir = [];
  // v0.67.1 · registro (registrosAlSubir): si ya tiene su gasto registrado (fuerte o débil y único), queda unido de una vez
  (lista || []).forEach(({ f, motivo, registro }) => {
    if (!f || !S.rutOk(f.rut) || !S.folioOk(f.folio)) return;
    const es61 = s(f.tipoDoc) === '61', id = S.idDoc(f.rut, f.folio, es61), prev = porId.get(id);
    const pc = SP.datosPendiente(f, { ...origen, motivo }, en, por);
    // v0.67.2 · devuelto con lo reconstruido de sus gastos: queda con lo del archivo (montos y detalle exactos)
    if (prev && SP.esPendiente(prev) && prev.porClasificar && prev.porClasificar.reconstruido && pc.fecha) { escribir.push({ id, prev, campos: { porClasificar: pc }, que: 'volvió a subirse: queda con lo del archivo' }); return; }
    if (prev && (prev.importado || prev.porClasificar) && !prev.quitadoEnPlanilla) return;   // ya está (importado o por clasificar)
    if (!pc.fecha) return;
    const campos = { porClasificar: pc };
    if (!es61 && SP.seUneSola(registro)) campos.registrado = SP.datosRegistrado(SP.vistaPendiente(id, { rut: f.rut, folio: f.folio, razonSocial: f.razonSocial, porClasificar: pc }), registro, { en, quien: por, ...(registro.vencimiento ? { vencimiento: registro.vencimiento } : {}) });
    escribir.push({ id, prev, campos });
  });
  for (let i = 0; i < escribir.length; i += 200) {
    const b = FB.writeBatch(d);
    escribir.slice(i, i + 200).forEach(x => {
      const ref = FB.doc(d, 'sii_docs', x.id), f0 = (lista.find(y => y.f && S.idDoc(y.f.rut, y.f.folio, s(y.f.tipoDoc) === '61') === x.id) || {}).f;
      if (x.prev) b.update(ref, cambio(x.prev, x.que || 'quedó por clasificar', x.campos));
      else b.set(ref, nuevo({ ...S.docSiiVacio(f0.rut, f0.folio, s(f0.tipoDoc) === '61', f0.razonSocial), ...x.campos, posPlanilla: 'p' + Date.now() }, 'sii'));
    });
    await b.commit();
  }
  await despues(escribir.length);
  return { ok: true, guardados: escribir.length };
}

// ── Clasificar e importar un documento por clasificar ──
// lineas: [{ item, area, monto }]; pago: { estado, fechaEstado, esperaPago?, formaPago?, pagoSinBanco? }
// → { ok, gastos: [ids], vencimiento, ya? }
// v0.67.1 · opc.detalle: el ítem y el área de cada línea del documento (clasificado por línea, como en Cargas del SII), en el
// orden del documento: quedan en sus productos (Detalle Compras). Sin él, los productos llevan el ítem si es uno solo.
export async function clasificar(docId, lineas, pago, opc = {}) {
  const d = await dbBase(), ref = FB.doc(d, 'sii_docs', s(docId));
  const sn = await FB.getDoc(ref);
  if (!sn.exists()) throw error('Ese documento ya no está', 'datos');
  const a = sn.data();
  if (a.importado) return { ok: true, ya: true, gastos: a.importado.gastos || [], vencimiento: a.importado.vencimiento || '' };
  if (!a.porClasificar) throw error('Ese documento no está por clasificar', 'datos');
  const v = SP.vistaPendiente(sn.id || docId, a), cat = await catalogo(), items = cat.lista.filter(i => !i.archivado);
  if (Array.isArray(opc.detalle) && opc.detalle.length === v.detalle.length) v.detalle = SP.conDetalleClasificado(v.detalle, opc.detalle, items);
  const AREAS = M.AREAS || [];
  const err = SP.revisarLineas(lineas, v.total, items, AREAS);
  if (err) throw error(err, 'datos');
  const f = SP.facturaClasificada(v, lineas, items, pago, !!opc.auto);
  const SF = await SIIF();
  await SF.importar([f], false, opc.marca || M.marcaNueva(), { formato: v.formato, archivo: v.archivo, cargaId: v.cargaId });
  const sn2 = await FB.getDoc(ref), im = (sn2.exists() && sn2.data().importado) || {};
  try { import('./finanzas.js?v=0.138.0').then(F => F.preciosTrasImportar()).catch(() => {}); } catch (e) {}
  return { ok: true, gastos: im.gastos || [], vencimiento: im.vencimiento || '' };
}

// ── Pagos sin banco ──
const idPago = docId => 'sp-' + s(docId).replace(/[^0-9A-Za-z_-]/g, '_').slice(0, 120);
// x: fila de pagosSinBanco; medio: 'efectivo' | 'tarjeta'; fecha aaaa-mm-dd; lineas (si está por clasificar)
export async function marcarPago(x, medio, fecha, lineas, origen, detalle) {
  if (!['efectivo', 'tarjeta'].includes(medio)) throw error('Elige cómo se pagó', 'datos');
  if (!M.esIso(fecha)) throw error('Elige la fecha del pago', 'datos');
  let org = {};
  if (medio === 'efectivo') { const r = SP.revisarOrigen(origen || {}); if (r.error) throw error(r.error, 'datos'); org = r.limpio; }
  const d = await dbBase(), por = correo(), en = ahora();
  let ids = x.gastos || [];
  if (x.porClasificar) {
    const r = await clasificar(x.docId, lineas, { estado: 'pagada', fechaEstado: fecha, formaPago: medio === 'tarjeta' ? 'tarjeta' : '', pagoSinBanco: { medio, fecha, ...org } }, { detalle });
    ids = r.gastos;
  } else {
    if (!ids.length) throw error('Esa factura no tiene gastos', 'datos');
    await FB.runTransaction(d, async tx => {
      const refs = ids.map(id => FB.doc(d, 'gastos', id)), sns = [];
      for (const r of refs) sns.push(await tx.get(r));
      sns.forEach((g, i) => {
        if (!g.exists()) throw error('Un gasto de esa factura ya no está. Recarga.', 'cambio');
        const a = g.data();
        if (a.estado !== 'vigente' || a.cartolaCargo || s(a.fechaPago)) throw error('Esa factura ya tiene su pago registrado (otro equipo o la cartola). Recarga.', 'cambio');
        tx.update(refs[i], cambio(a, medio === 'efectivo' ? 'pagada en efectivo' : 'pagada con tarjeta de crédito', { fechaPago: fecha, esperaPago: false, medioPago: medio, formaPago: medio === 'tarjeta' ? 'tarjeta' : 'contado', pagoSinBanco: { medio, fecha, ...org, por, en } }));
      });
    });
    await despues(ids.length);
  }
  const reg = { docId: s(x.docId), rut: s(x.rut), folio: s(x.folio), razonSocial: s(x.razonSocial), monto: Math.round(Number(x.total) || 0), fecha, mes: fecha.slice(0, 7), medio, ...org, gastos: ids, fechaFactura: s(x.fecha), por, en,
    historial: [{ que: medio === 'efectivo' ? `pagada en efectivo (${SP.textoOrigen(org)})` : 'pagada con tarjeta de crédito', por, en }] };
  await FB.setDoc(FB.doc(d, COL_PAGOS, idPago(x.docId)), limpio(reg));
  return { ok: true, gastos: ids };
}
// ═══ v0.81.0 · Un gasto que esperaba su cargo y no lo tendrá: cómo se pagó (Gastos → Bandeja) ═══
// medio: 'efectivo' (con su origen) | 'tarjeta' (de crédito) | 'mercadopago' (descontado o pagado en Mercado Pago, sin cargo que calzar)
//      | 'personal' (lo pagó el dueño con su plata: es gasto de la empresa, pero no salió de sus cuentas)
// x = { gastos: [ids], folio, razonSocial, rut, total, fecha }. El gasto queda con su fecha de pago y medio; el pago, en sii_pagos (flujo de caja).
export const MEDIOS_GASTO = { efectivo: 'Pagado en efectivo', tarjeta: 'Pagado con tarjeta de crédito', mercadopago: 'Pagado o descontado en Mercado Pago', personal: 'Pagado por el dueño con plata personal' };
export async function marcarPagoGastos(x, medio, fecha, origen, nota) {
  if (!MEDIOS_GASTO[medio]) throw error('Elige cómo se pagó', 'datos');
  if (!M.esIso(fecha)) throw error('Elige la fecha del pago', 'datos');
  const ids = (x && x.gastos) || [];
  if (!ids.length || ids.length > 40) throw error('Faltan los gastos', 'datos');
  let org = {};
  if (medio === 'efectivo') { const r = SP.revisarOrigen(origen || {}); if (r.error) throw error(r.error, 'datos'); org = r.limpio; }
  const d = await dbBase(), por = correo(), en = ahora(), nt = s(nota).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200), que = MEDIOS_GASTO[medio].toLowerCase();
  await FB.runTransaction(d, async tx => {
    const refs = ids.map(id => FB.doc(d, 'gastos', id)), sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    sns.forEach((g, i) => {
      if (!g.exists()) throw error('Un gasto ya no está. Recarga.', 'cambio');
      const a = g.data();
      if (a.estado !== 'vigente') throw error('Ese gasto ya no está vigente (anulado). Recarga.', 'cambio');
      if (s(a.cartolaCargo)) throw error('Ese gasto ya tiene su cargo del banco. Recarga.', 'cambio');
      tx.update(refs[i], cambio(a, que, { fechaPago: fecha, esperaPago: false, esperaCargo: false, medioPago: medio, formaPago: medio === 'tarjeta' ? 'tarjeta' : 'contado', pagoSinBanco: { medio, fecha, ...org, ...(nt ? { nota: nt } : {}), por, en } }));
    });
  });
  await despues(ids.length);
  const docId = 'g:' + s(ids[0]);
  const reg = { docId, rut: s(x.rut), folio: s(x.folio), razonSocial: s(x.razonSocial), monto: Math.round(Number(x.total) || 0), fecha, mes: fecha.slice(0, 7), medio, ...org, gastos: ids, fechaFactura: s(x.fecha), por, en,
    ...(nt ? { nota: nt } : {}), historial: [{ que: medio === 'efectivo' ? `pagado en efectivo (${SP.textoOrigen(org)})` : que, por, en }] };
  await FB.setDoc(FB.doc(d, COL_PAGOS, idPago(docId)), limpio(reg));
  return { ok: true, gastos: ids };
}
// v0.69.2 · El saldo de un documento pagado en partes, pagado en efectivo o con tarjeta: una parte más (abono con su medio), con
// su pago guardado en sii_pagos (efectivo disponible y flujo de caja). Cuando completa el total, el documento queda pagado.
// x: fila de saldosSinBanco; medio 'efectivo' | 'tarjeta'; origen: { origen, origenTexto } (efectivo)
export async function pagarSaldo(x, medio, fecha, origen) {
  if (!['efectivo', 'tarjeta'].includes(medio)) throw error('Elige cómo se pagó', 'datos');
  if (!M.esIso(fecha)) throw error('Elige la fecha del pago', 'datos');
  if (!x || !x.vencId || !(Number(x.monto) > 0)) throw error('Falta el documento', 'datos');
  const r = await abonoParcial(x.vencId, { monto: Math.round(Number(x.monto)), fecha, origen: 'mano', medio, origenEfectivo: origen && origen.origen, origenTexto: origen && origen.origenTexto, obs: 'Pagos sin banco: el saldo' }, M.marcaNueva());
  return { ok: true, final: !!r.final, saldo: r.saldo || 0 };
}
// "Todavía por pagar": un vencimiento con la fecha esperada. Por clasificar: se clasifica e importa a crédito (crea su vencimiento).
export async function porPagar(x, fecha, lineas, detalle) {
  if (!M.esIso(fecha)) throw error('Elige la fecha en que esperas pagarla', 'datos');
  if (x.porClasificar) {
    const r = await clasificar(x.docId, lineas, { estado: 'pendiente', fechaEstado: fecha }, { detalle });
    if (r.vencimiento) await marcarVencSinBanco(r.vencimiento);
    return { ok: true, vencimiento: r.vencimiento, gastos: r.gastos };
  }
  const ids = x.gastos || [];
  if (!ids.length) throw error('Esa factura no tiene gastos', 'datos');
  const d = await dbBase(), marca = M.marcaNueva(), vid = S.idVencSii(marca, 0);
  await FB.runTransaction(d, async tx => {
    const refs = ids.map(id => FB.doc(d, 'gastos', id)), sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    const gs = sns.map((g, i) => {
      if (!g.exists()) throw error('Un gasto de esa factura ya no está. Recarga.', 'cambio');
      const a = g.data();
      if (a.estado !== 'vigente' || a.cartolaCargo || s(a.fechaPago)) throw error('Esa factura ya tiene su pago registrado. Recarga.', 'cambio');
      return { ref: refs[i], a };
    });
    const todas = gs.map(({ a }) => ({ area: s(a.area), monto: Math.round(Number(a.montoFinal) || 0) })), a0 = gs[0].a;
    const venc = M.docVencimiento({ id: vid, plantillaID: '', nombre: '📋 ' + s(a0.razonSocial) + ' F.' + s(a0.folio), item: s(a0.itemGasto), periodoKey: fecha.slice(0, 7), fechaVencimiento: fecha,
      montoEstimado: todas.reduce((t0, y) => t0 + y.monto, 0), obs: 'F.' + s(a0.folio), area: todas.length === 1 ? todas[0].area : 'MULTI', categoria: s(a0.categoria), tipo: s(a0.tipo), subTipo: s(a0.subTipo),
      multiArea: todas.length > 1 ? JSON.stringify(todas) : '', estado: 'PENDIENTE', fechaCompra: s(a0.fecha).split('-').reverse().join('-') });
    tx.set(FB.doc(d, 'vencimientos', vid), nuevoVenc({ ...venc, porPagarSinBanco: true }, 'sii'));
    gs.forEach(({ ref, a }) => tx.update(ref, cambio(a, 'todavía por pagar', { formaPago: 'proveedor', esperaPago: false, fechaPago: '' }, { vencimiento: vid })));
    if (a0.siiDoc && a0.siiDoc.id) {
      const rd = FB.doc(d, 'sii_docs', s(a0.siiDoc.id)), sd = await tx.get(rd);
      if (sd.exists() && sd.data().importado) tx.update(rd, cambio(sd.data(), 'todavía por pagar', { importado: { ...sd.data().importado, vencimiento: vid, estado: 'pendiente', fechaEstado: fecha } }));
    }
  });
  await despues(ids.length + 2);
  return { ok: true, vencimiento: vid };
}
async function marcarVencSinBanco(id) {
  const d = await dbBase(), ref = FB.doc(d, 'vencimientos', s(id)), sn = await FB.getDoc(ref);
  if (!sn.exists()) return;
  await FB.updateDoc(ref, cambio(sn.data(), 'todavía por pagar', { porPagarSinBanco: true }));
  await despues(1);
}
// Reagendar la fecha esperada de pago (un vencimiento por pagar, sin abonos)
export async function reagendar(vencId, fecha) {
  if (!M.esIso(fecha)) throw error('Elige la fecha nueva', 'datos');
  const d = await dbBase(), ref = FB.doc(d, 'vencimientos', s(vencId));
  await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Ese vencimiento ya no existe', 'datos');
    const v = sn.data();
    if (!G3.abierto(v)) throw error('Ese vencimiento ya no está por pagar', 'datos');
    if (G3.estadoBase(v) === 'con_abonos') throw error('Tiene abonos: usa "Reagendar saldo" en Gastos → Por pagar', 'datos');
    tx.update(ref, cambio(v, 'reagendó', { fechaVencimiento: fecha, periodoKey: fecha.slice(0, 7) }));
  });
  await despues(1);
  return { ok: true };
}

// ── Migración (una vez): los documentos de cargas anteriores que no se importaron quedan "por clasificar" ──
// Sin clasificarse solos. Lo ya importado queda igual. Solo se leen (de Drive, con el script) las cargas que tienen documentos
// sin importar que todavía no están por clasificar. leerCarga(id) → { contenido }; leer(contenido) → { formato, facturas } (sii.js);
// filtrar(facturas) → las que siguen sin importar y no van al vencimiento de una obligación "según documento".
export async function migrarCargas(cargas, leerCarga, leer, filtrar = async f => f, avance = () => {}) {
  let n = 0, cargasN = 0, errores = 0;
  const ya = new Set((await pendientes()).map(v => `${v.rut}|${v.folio}${v.tipo === '61' ? '|61' : ''}`));
  const conPend = (cargas || []).filter(c => c.url && (c.documentos || []).some(z => !z.importado && !ya.has(z.clave)));
  for (const c of conPend) {
    avance(`Pasando a "por clasificar" lo que quedó sin importar: ${c.nombreArchivo || 'carga'} (${cargasN + 1} de ${conPend.length})…`);
    try {
      const r = await leerCarga(c.id), contenido = typeof r === 'string' ? r : (r && r.contenido) || '';
      const { formato, facturas } = leer(contenido);
      const pend = new Set(c.documentos.filter(z => !z.importado && !ya.has(z.clave)).map(z => z.clave));
      const quedan = await filtrar(facturas.filter(f => pend.has(`${f.rut}|${f.folio}${s(f.tipoDoc) === '61' ? '|61' : ''}`)));
      n += (await guardarPendientes(quedan.map(f => ({ f, motivo: 'De una carga anterior' })), { cargaId: c.id, formato, archivo: c.nombreArchivo })).guardados;
    } catch (e) { errores++; }
    cargasN++;
  }
  if (!errores) { try { const d = await dbBase(); await FB.setDoc(FB.doc(d, 'config', 'sii_pagos'), { migrado: ahora(), migradoPor: correo() }, { merge: true }); cfg = null; } catch (e) {} }
  return { ok: true, documentos: n, cargas: cargasN, errores };
}
