// ═══════════════════════════════════════════════
//  Sistema Fën — Cartola con la base nueva (fen-gastos), etapa G3 (tercera parte)  v0.50.0 · v0.51.0
//  v0.51.0: pagar con un cargo el vencimiento de Cotizaciones (con su certificado de Previred) crea un gasto por trabajador.
//  Se usa solo cuando config/gastos dice fuente = "base". cartola.js elige: con la planilla, el script como siempre.
//  Lo mismo que cc_cargar, cc_lista, cc_resolver, cc_deshacer y cc_quitar_regla del script (Cartola.gs), en las
//  colecciones cartolas, cartola_cargos y cartola_reglas (forma de la copia G1). Reglas en gastos-cartola.js.
//  · Resolver es UNA transacción por cargo (el cargo, los vencimientos, los gastos y lo aprendido): no queda nada a medias.
//    Cada cargo es independiente e idempotente por su id: confirmar dos veces el mismo cargo no paga dos veces
//    (los ids de lo que crea salen del cargo y de cuántas veces se deshizo).
//  · Abono (nuevo, obligación de tipo libre): agregarAbono(vencId, { monto, fecha, origen: 'cartola', cargoId }).
//    v0.63.1: con el área de ESE abono (areas, fuenteArea) y el destinatario (glosa y RUT del cargo): se recuerda.
//    Nunca se cierra solo.
//  · Cada gasto y vencimiento tocado queda con "cartola" (la traza, como la columna Cartola) y "cartolaCargo" (el id).
//  · Deshacer no borra: el cargo vuelve a revisar (con su historial), el vencimiento queda por pagar, un gasto creado
//    aquí queda anulado y un abono sale del vencimiento (queda en abonosQuitados).
//  · El archivo original va a Drive con el script (op archivo_subir, tipo "cartola", v2.16.0).
//  · v0.63.1: "Traspaso entre cuentas propias" (no crea gasto, se aprende). "Ya está en Gastos" ofrece también lo pagado por
//    banco a mano (esperaCargo), las facturas del SII ya cargadas sin cargo y los pagos de vencimientos sin cargo
//    (gastos-banco.js: candidatosGastos); al vincular, el gasto deja de esperar su cargo, una factura a crédito queda con su
//    fecha de pago y el vencimiento pagado a mano queda con la cartola. Deshacer lo devuelve como estaba.
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as G3D from './gastos-g3d.js?v=0.138.0';
import * as C from './gastos-cartola.js?v=0.138.0';
import * as B from './gastos-banco.js?v=0.138.0';
import { huella } from './gastos-modelo.js?v=0.138.0';
import * as FS from './gastos-fs.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as TE from './tef-enviadas.js?v=0.138.0';
import * as P from './proveedores.js?v=0.138.0';
import * as SP from './sii-pendientes.js?v=0.138.0';   // v0.66.0: documentos del SII por clasificar
import { registradosGastos } from './bandeja.js?v=0.138.0';   // v0.68.0: lo registrado con su estado (Buscar en Gastos)
import * as RC from './reglas-conc.js?v=0.138.0';   // v0.69.0: las reglas de conciliación (conc_reglas)
import * as PT from './puntaje.js?v=0.138.0';      // v0.69.0: el ritmo de pago de cada proveedor
import * as PM from './pagos-mixtos.js?v=0.138.0';  // v0.69.2: pagos mixtos (un documento pagado en partes)

const { dbBase, todos, catalogo, nuevo, cambio, despues, correo, limpio } = FS;
// Los cargos tienen su propia columna "Historial" (texto, la de Deshacer): el registro de cambios va en "registro"
const nuevoCargo = (datos, por) => limpio({ ...datos, origen: 'cartola', creado: { por: por || correo(), en: FB.serverTimestamp() }, version: 0, registro: [], ...GB.marcaBase(por) });
const cambioCargo = (a, que, campos, extra) => { const por = correo() || 'Sistema Fën', dif = M.diferencias(a, campos); if (dif.historial) dif.historial = { antes: '…', despues: '…' };
  return limpio({ ...campos, version: (Number(a && a.version) || 0) + 1, registro: M.conHistorial(a && a.registro, { que, por, en: ahora(), cambios: dif, ...(extra || {}) }), ...GB.marcaBase() }); };
const s = v => String(v == null ? '' : v);
const error = (msg, code) => Object.assign(new Error(msg), { code });
const ahora = () => M.ahoraChile().texto;
const quien = () => correo() || 'Sistema Fën';
// v0.69.0 · El puntaje que mostró la pantalla al confirmar: { valor, propuesta, coincide } (solo para afinar los pesos después)
const puntajeDe = x => (x && typeof x === 'object' && isFinite(Number(x.valor)) ? { valor: Math.max(0, Math.min(100, Math.round(Number(x.valor)))), propuesta: s(x.propuesta).slice(0, 40), coincide: !!x.coincide, en: ahora() } : null);
export async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── Lecturas ──
const reglasTodas = async () => (await todos('cartola_reglas')).map(x => C.vistaRegla(x.id, x.d));
// RUT de cada vencimiento de factura del SII (sii_docs importado.vencimiento)
const rutsSii = docs => { const m = {}; (docs || []).forEach(x => { const im = x.d && x.d.importado; if (im && im.vencimiento) m[im.vencimiento] = C.rutNorm(x.d.rut); }); return m; };
async function abiertos() {
  const [vencs, ps, siiDocs] = await Promise.all([todos('vencimientos'), todos('obligaciones'), todos('sii_docs')]);
  return { vencs, ps, siiDocs, lista: C.vencimientosAbiertos(vencs, ps, rutsSii(siiDocs), M.ahoraChile().dia) };
}
// v0.67.4 · Folios de las facturas que cita cada nota de crédito (su referencia en el XML, si se guardó), de sii_docs ya en memoria
const refsNC = docs => { const m = {}; (docs || []).forEach(x => { const d = x.d || {}, r = (d.porClasificar && d.porClasificar.referencias) || d.referencias;
  if (Array.isArray(r) && r.length) m[x.id] = r.map(y => s(y && (y.folio || y))).filter(Boolean).slice(0, 5); }); return m; };

// cc_lista: cargos (por revisar y lo de los últimos N días), cartolas, reglas, vencimientos abiertos y gastos sin cartola
export async function lista(diasP) {
  const hoy = M.ahoraChile().dia, dias = Math.min(400, Math.max(7, Math.round(Number(diasP)) || 60)), corte = G3.sumarDias(hoy, -dias);
  try { await FS.vencimientosAlDia(); } catch (e) {}
  const [cg, ct, reglas0, ab, gastos, dAb, tefs, provs, dPl, RCx] = await Promise.all([todos('cartola_cargos'), todos('cartolas'), reglasTodas(), abiertos(), todos('gastos', FB.where('fecha', '>=', G3.sumarDias(hoy, -150))), FS.datosAbono().catch(() => ({ destinatarios: [], trabajadores: [] })),
    todos('tef_enviadas').catch(() => []), todos('proveedores').catch(() => []), datosPlanillas(), reglasConc()]);
  // v0.69.0 · Con las reglas migradas, lo aprendido sale de conc_reglas (las exactas, con la forma de siempre); cartola_reglas queda como estaba
  const reglas = RCx.ok ? RC.legacyCargos(RCx.reglas).map(r => ({ ...r, docId: r.regla })) : reglas0;
  // v0.67.6 · El mismo movimiento en dos cartolas: lo ya subido se revisa contra todo (de la memoria, sin lecturas). Los pares
  // claros se marcan "Repetido" una vez (con su registro); los dudosos quedan con la propuesta "Marcar como repetido".
  const todosC = cg.filter(x => !x.d.quitadoEnPlanilla).map(x => C.vistaCargo(x.id, x.d));
  const repetidos = await repetidosAlListar(todosC);
  // v0.82.0 · Lo por revisar de antes del inicio del sistema (config.js) no se pide: queda guardado (y en todosCargos)
  const INI = (typeof window !== 'undefined' && window.FEN_SIS && window.FEN_SIS.INICIO) || '2026-10-01';
  const cargos = todosC
    .filter(c => !(c.estado === C.ESTADOS.revisar && c.fecha < INI))
    .filter(c => c.id && (c.estado === C.ESTADOS.revisar || c.fecha >= corte || s(c.resueltoEl).slice(0, 10) >= corte))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.monto - a.monto);
  // v0.64.0 · Transferencias enviadas (a quién pagaste) y el proveedor de cada cargo: todo desde la memoria, nunca por cargo
  const enviadas = tefs.map(x => TE.vistaEnviada(x.id, x.d)).filter(x => x.fecha >= G3.sumarDias(hoy, -TE.DIAS_GUARDAR - 10));
  const fichas = provs.map(x => P.vistaFicha(x.id, x.d)).filter(f => !f.archivado);
  const asig = TE.asignarEnviadas(cargos.filter(c => c.estado !== C.ESTADOS.repetido), enviadas);
  cargos.forEach(c => {
    const tf = asig.get(c.id) || null;
    if (tf) { c.tef = tf; if (!c.rut && tf.rut) { c.rut = tf.rut; c.rutDe = 'tef'; } }
    const pr = P.buscar(fichas, { rut: c.rut, nombre: tf ? tf.nombre : '', descripcion: c.descripcion });
    if (pr) c.proveedor = { id: pr.ficha.id, nombre: pr.ficha.nombre || pr.ficha.razonSocial, rut: pr.ficha.rut, por: pr.por, resumen: P.resumen(pr.ficha), item: pr.ficha.item, area: pr.ficha.area, manual: pr.ficha.manual };
  });
  // "Pagado sin factura": gasto nuevo desde la cartola sin documento del SII
  const porCargo = {}; gastos.forEach(x => { const k = s(x.d.cartolaCargo); if (k && x.d.estado === 'vigente') (porCargo[k] = porCargo[k] || []).push(x.d); });
  // v0.67.7 · Lo ligado a cada cargo (para "Ver el registro"): fecha, ítem, monto y fecha de pago, de los gastos ya en la memoria
  const ligados = {}; Object.entries(porCargo).forEach(([k, l]) => { ligados[k] = l.slice(0, 12).map(g => ({ fecha: s(g.fecha).slice(0, 10), item: s(g.itemGasto), monto: Number(g.montoFinal) || 0, area: s(g.area), folio: s(g.folio), razon: s(g.razonSocial), fechaPago: s(g.fechaPago).slice(0, 10), formaPago: s(g.formaPago) })); });
  const sinFactura = cargos.filter(c => c.estado === C.ESTADOS.conciliado && c.accion === 'nuevo' && !(c.detalle && c.detalle.sinFactura) && (porCargo[c.id] || []).length && porCargo[c.id].every(g => !s(g.rutProveedor).trim()))
    .map(c => ({ id: c.id, fecha: c.fecha, monto: c.monto, descripcion: c.descripcion, items: [...new Set(porCargo[c.id].map(g => s(g.itemGasto)))] }));
  // v0.65.1 · Planillas de Previred ya registradas (meses cargados) con sus pagos del banco unidos
  const planillas = armarPlanillas(dPl, ab, cg);
  // v0.66.0 · Documentos del SII por clasificar (de la memoria): un cargo del mismo monto los ofrece "Por clasificar"
  // v0.67.1 · sin lo que ya tiene su gasto registrado (se une solo al listar); lo registrado, para proponer su pago
  // v0.67.4 · Los gastos sin cargo y, aparte, las notas de crédito sin cargo (con su referencia): solo se suman con su factura
  const grupos = B.candidatosGastos(gastos, hoy, new Set(ab.lista.filter(v => !v.plantillaId && v.folio).map(v => B.claveFactura(v.folio, v.razon))), { conNC: true });
  const rNC = refsNC(ab.siiDocs), ncs = grupos.filter(g => g.monto < 0).map(g => (rNC[g.siiDocId] ? { ...g, refs: rNC[g.siiDocId] } : g));
  const SPF = await import('./sii-pendientes-fs.js?v=0.138.0');
  const siiPendientes = await SPF.pendientes().catch(async () => SP.pendientesDe(await todos('sii_docs').catch(() => []))), siiRegistrados = await SPF.registrados().catch(() => []);
  // v0.69.0 · El ritmo de pago de cada proveedor (factura → cargo del banco), de los gastos de 12 meses que ya están en la memoria (0 lecturas)
  const ritmos = await ritmosProveedores(hoy, todosC).catch(() => ({}));
  return { ok: true, fuente: 'base', planillas, siiPendientes, siiRegistrados, cargos, repetidos, ligados, todosCargos: todosC, cartolas: ct.filter(x => !x.d.quitadoEnPlanilla).map(x => C.vistaCartola(x.id, x.d)), reglas: reglas.filter(r => !r.quitada && r.veces > 0),
    reglasConc: RCx.reglas, concMigrado: RCx.ok, concMarca: RCx.marca || null, ritmos,
    vencimientos: ab.lista, gastos: grupos.filter(g => g.monto > 0), notasCredito: ncs, sinFactura, siiSinImportar: {}, dias,
    registrados: registradosGastos(gastos, ab.vencs, hoy),   // v0.68.0 · "Buscar en Gastos": lo ya leído (gastos de 150 días y vencimientos), con su estado; 0 lecturas
    abonoDest: dAb.destinatarios, trabajadores: dAb.trabajadores,   // v0.63.1: para "Área de este abono"
    enviadas: { n: enviadas.length, hasta: enviadas.map(x => x.fecha).sort().pop() || '', subidas: [...new Set(enviadas.map(x => x.subida.slice(0, 10)))].sort().slice(-3) } };
}

// ═══ v0.69.0 · Reglas de conciliación (conc_reglas) ═══
// Una colección chica: se lee entera una vez (queda en la memoria de la sesión; después solo "lo que cambió"). El documento
// conc_reglas/migracion-v0690 marca que lo aprendido (cartola_reglas) ya se copió: la migración corre una sola vez y no borra nada.
let concOk = false;
async function reglasConc() {
  const l = await todos(RC.COL).catch(() => null);
  if (l === null) return { ok: false, reglas: [] };
  const marca = l.find(x => x.id === RC.ID_MARCA);
  if (!marca) {
    try { await migrarConc(l); } catch (e) { console.warn('Reglas sin migrar', e); return { ok: false, reglas: [] }; }
    const l2 = await todos(RC.COL).catch(() => null), m2 = l2 && l2.find(x => x.id === RC.ID_MARCA);
    if (!m2) return { ok: false, reglas: [] };
    concOk = true;
    return { ok: true, reglas: l2.filter(x => x.id !== RC.ID_MARCA).map(x => RC.vista(x.id, x.d)), marca: m2.d };
  }
  concOk = true;
  return { ok: true, reglas: l.filter(x => x.id !== RC.ID_MARCA).map(x => RC.vista(x.id, x.d)), marca: marca.d };
}
export const reglasConcLista = async () => (await reglasConc()).reglas;
// La migración: cada regla viva de cartola_reglas pasa a una regla "glosa exacta" con id fijo (rc- + huella de la clave). Si ya
// existe (otra pestaña la migró), no se toca. La marca va en el último lote.
async function migrarConc(ya) {
  const d = await dbBase(), t = ahora(), por = quien();
  const sm = await FB.getDoc(FB.doc(d, RC.COL, RC.ID_MARCA));   // por si otra pestaña terminó recién
  if (sm.exists()) return 0;
  const viejas = await reglasTodas(), existe = new Set((ya || []).map(x => x.id));
  const nuevas = RC.migrarCargos(viejas, por, t).filter(r => !existe.has(r.id));
  const marca = { id: RC.ID_MARCA, tipo: 'marca', v: 1, desde: 'cartola_reglas', leidas: viejas.length, migradas: nuevas.length, en: t, por };
  for (let i = 0; i <= nuevas.length; i += 400) {
    const parte = nuevas.slice(i, i + 400), b = FB.writeBatch(d);
    parte.forEach(r => b.set(FB.doc(d, RC.COL, r.id), limpio(RC.aDoc(r))));
    if (i + 400 > nuevas.length) b.set(FB.doc(d, RC.COL, RC.ID_MARCA), marca);
    await b.commit();
  }
  return nuevas.length;
}
// Crear, editar, pausar, activar, archivar, aceptar o descartar una sugerencia: una transacción (1 lectura y 1 escritura)
// op = { que: 'crear'|'editar'|'estado'|'aceptar'|'descartar', id, regla (de RC.revisar), estado, motivo, sugerida }
export async function guardarReglaConc(op) {
  const d = await dbBase(), t = ahora(), por = quien(), o = op || {};
  let id = s(o.id), nuevaR = null;
  if (o.que === 'crear' || o.que === 'aceptar' || o.que === 'descartar') {
    const base = o.que === 'descartar' ? { lado: 'cargo', nivel: 'proponer', cond: o.sugerida.cond, res: o.sugerida.res } : o.regla;
    if (!base) throw error('Falta la regla', 'datos');
    nuevaR = RC.nueva({ ...base, lado: 'cargo' }, o.que === 'crear' ? 'manual' : 'propuesta', por, t, { firma: o.sugerida ? o.sugerida.firma : '', evidencia: o.sugerida ? o.sugerida.evidencia : null, id: o.sugerida ? 'rc-s' + RC.huella(o.sugerida.firma) : '' });
    if (o.que === 'descartar') nuevaR = { ...nuevaR, estado: 'descartada', historial: [RC.entrada('descartó la regla sugerida', por, t, { frase: RC.frase(nuevaR) })] };
    id = nuevaR.id;
  }
  const ref = FB.doc(d, RC.COL, id);
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), act = sn.exists() ? RC.vista(sn.id, sn.data()) : null;
    let x;
    if (nuevaR) { if (act && act.estado !== 'descartada' && o.que !== 'descartar') throw error('Esa regla ya existe: recarga.', 'resuelto'); x = act && o.que === 'descartar' ? RC.conEstado(act, 'descartada', por, t) : nuevaR; }
    else if (!act) throw error('Esa regla ya no está. Recarga.', 'datos');
    else if (o.que === 'editar') x = RC.editar(act, o.regla, por, t);
    else if (o.que === 'estado') x = RC.conEstado(act, o.estado, por, t, o.motivo);
    if (!x) return { sinCambios: true, regla: act };
    tx.set(ref, limpio(RC.aDoc(x)));
    return { regla: x };
  });
  return { ok: true, ...r };
}
// Dentro de la transacción de un cargo: la regla exacta de su glosa (lo aprendido) y la regla que propuso (si es otra)
async function leerConc(tx, d, clave, idUsada) {
  if (!concOk) return null;
  const idE = RC.idExacta('cargo', clave), out = { exacta: { ref: FB.doc(d, RC.COL, idE) }, usada: null };
  const se = await tx.get(out.exacta.ref); out.exacta.act = se.exists() ? RC.vista(se.id, se.data()) : null;
  if (idUsada && idUsada !== idE) { const ref = FB.doc(d, RC.COL, s(idUsada)), su = await tx.get(ref); out.usada = { ref, act: su.exists() ? RC.vista(su.id, su.data()) : null }; }
  else if (idUsada) out.usada = out.exacta;
  return out;
}
// Lo aprendido (la regla exacta, "Solo proponer" si es nueva) y el uso de la regla que propuso, en la misma escritura
function escribirConc(tx, Q, regla, c) {
  if (!Q) return 0;
  const t = ahora(), por = quien(), res = regla ? RC.resDeLegacy({ ...regla, ejemplo: regla.ejemplo }) : null, p = c.__p || {};
  let n = 0;
  const usadaOk = Q.usada && Q.usada.act && p.reglaAccion && p.reglaAccion === s(p.accion);
  // Si la propuso una regla "contiene" y se confirmó eso mismo, no se crea además una exacta (se cuenta el uso de esa)
  const porOtra = usadaOk && Q.usada !== Q.exacta && Q.usada.act.cond.tipo !== 'exacta';
  if (res && !porOtra) {
    if (regla.accion === 'ignorar') res.siempre = true;
    const x = RC.aprendida(Q.exacta.act, 'cargo', c.clave, res, c.monto, por, t);
    tx.set(Q.exacta.ref, limpio(RC.aDoc(x))); n++;
  } else if (usadaOk && Q.usada === Q.exacta && Q.exacta.act) { tx.set(Q.exacta.ref, limpio(RC.aDoc(RC.usada(Q.exacta.act, c.monto, t)))); n++; }
  if (usadaOk && Q.usada !== Q.exacta) { tx.set(Q.usada.ref, limpio(RC.aDoc(RC.usada(Q.usada.act, c.monto, t)))); n++; }
  return n;
}
// El ritmo de pago de cada proveedor: días de la factura (gasto del SII) al cargo del banco que la pagó, en 12 meses
async function ritmosProveedores(hoy, cargos) {
  const g = await todos('gastos', FB.where('fecha', '>=', G3.sumarDias(hoy, -400)));
  const fc = new Map((cargos || []).map(c => [c.id, c.fecha]));
  const pares = [];
  g.forEach(({ d: x }) => {
    if (!x || x.estado !== 'vigente') return;
    const rut = P.rutNorm(x.rutProveedor), folio = s(x.folio) || s(x.siiDoc && x.siiDoc.folio), cg = s(x.cartolaCargo);
    if (!rut || !folio || !cg) return;
    const fp = fc.get(cg) || s(x.fechaPago).slice(0, 10);
    pares.push({ clave: rut, id: folio, fechaDoc: s(x.fecha).slice(0, 10), fechaPago: fp });
  });
  return PT.ritmos(pares, hoy);
}

// ═══ v0.67.6 · Repetidos al listar ═══
// todosC: todos los cargos (vistaCargo, se cambian aquí mismo). Marca los pares claros (1 lectura y 1 escritura por cada uno, una
// sola vez), deja la propuesta en los dudosos y, en cada original, de qué otras cartolas llegó (fuentes y RUT, solo en memoria).
// → { marcados, propuestos }
async function repetidosAlListar(todosC) {
  const r = C.repetidosAlListar(todosC), porId = new Map(todosC.map(c => [c.id, c])), autos = [], props = [];
  r.forEach((x, id) => { const c = porId.get(id); if (!c) return; if (x.auto) autos.push({ c, x }); else props.push({ c, x }); });
  let marcados = 0;
  if (autos.length) {
    try { marcados = await marcarRepetidos(autos.map(({ c, x }) => ({ c, original: x.original, por: x.por, como: 'lista' }))); }
    catch (e) { autos.forEach(a => props.push(a)); }   // sin cuota o sin red: queda la propuesta (nada se pierde)
  }
  // La propuesta (los dudosos y, si no se pudo escribir, los claros)
  props.forEach(({ c, x }) => { if (c.estado !== C.ESTADOS.revisar) return;
    const l = x.auto ? [{ e: x.original, por: x.por, fuerte: true, dias: x.dias }] : x.candidatos;
    c.repetidoProp = { ambiguo: !!x.ambiguo, candidatos: l.map(y => ({ id: y.e.id, fecha: y.e.fecha, monto: y.e.monto, descripcion: y.e.descripcion, cuenta: y.e.cuenta, cuentaN: y.e.cuentaN, estado: y.e.estado, accion: y.e.accion,
      detalle: y.e.detalle, fuente: C.fuentesCargo(y.e)[0] || null, por: y.por, fuerte: !!y.fuerte, dias: y.dias,
      // v0.67.7 · Para "Ver el registro" (de la memoria): de qué cartola, cuándo y quién la subió, y quién lo resolvió
      docId: y.e.docId, operacion: y.e.operacion, cartola: y.e.cartola, nCartola: y.e.nCartola, fuentes: C.fuentesCargo(y.e), subidaEl: y.e.subidaEl, subidaPor: y.e.subidaPor, resueltoEl: y.e.resueltoEl, resueltoPor: y.e.resueltoPor })) }; });
  // En cada original: de qué otra cartola llegó también (fuentes y RUT de la glosa, solo en memoria: la histórica trae más)
  todosC.forEach(c => { if (c.estado !== C.ESTADOS.repetido || !c.repetidoDe) return; const o = porId.get(c.repetidoDe); if (!o) return;
    (o.repetidos = o.repetidos || []).push({ id: c.id, descripcion: c.descripcion, fecha: c.fecha, fuente: C.fuentesCargo(c)[0] || null });
    const fs = C.fuentesCargo(o), nf = C.fuentesCargo(c).filter(f => !fs.some(g => g.tipo === f.tipo)); if (nf.length) o.fuentes = fs.concat(nf);
    if (!o.rut) { const r0 = C.rutDe(c.descripcion); if (r0) { o.rut = r0; o.rutDe = 'repetido'; } } });
  return { marcados, propuestos: props.filter(({ c }) => c.estado === C.ESTADOS.revisar).length };
}
// Marca como repetidos (al listar o a mano): una transacción por cada 100. Cada cargo se revisa adentro: sigue por revisar, con la
// misma huella y sin "no es repetido de" ese original. lista: [{ c (vistaCargo), original (vistaCargo), por, como, motivo }].
// Cambia los cargos en memoria (c) y devuelve cuántos marcó.
async function marcarRepetidos(lista) {
  const d = await dbBase(), t = ahora(), por = quien();
  let n = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const parte = lista.slice(i, i + 100);
    const hechos = await FB.runTransaction(d, async tx => {
      const refs = parte.map(x => FB.doc(d, 'cartola_cargos', s(x.c.docId || x.c.id))), sns = [];
      for (const r of refs) sns.push(await tx.get(r));
      const ok = [];
      parte.forEach((x, j) => {
        const sn = sns[j]; if (!sn.exists()) return;
        const a = sn.data(), c = C.vistaCargo(sn.id, a), oid = s(x.original.docId || x.original.id);
        if (c.estado !== C.ESTADOS.revisar || c.huella !== x.c.huella || c.noRepetidoDe.includes(oid)) return;
        const det = C.detalleRepetido(x.original, x.por, x.como, x.motivo ? { motivo: x.motivo } : null), resp = x.como === 'mano' ? por : C.POR_REPETIDO;
        tx.update(refs[j], cambioCargo(a, x.como === 'mano' ? 'marcó repetido' : 'marcó repetido (al listar)', { estado: C.ESTADOS.repetido, accion: C.REPETIDO, repetidoDe: oid, detalle: JSON.stringify(det), resueltoEl: t, resueltoPor: resp },
          { motivo: C.textoRepetido(det) + (x.motivo ? ': ' + x.motivo : '') }));
        ok.push({ x, det, resp });
      });
      return ok;
    });
    hechos.forEach(({ x, det, resp }) => Object.assign(x.c, { estado: C.ESTADOS.repetido, accion: C.REPETIDO, repetidoDe: s(x.original.docId || x.original.id), detalle: det, resueltoEl: t.slice(0, 16), resueltoPor: resp }));
    n += hechos.length;
  }
  if (n) await despues(n);
  return n;
}

// ── v0.67.1 · Nota de un cargo: 1 escritura, 0 lecturas (el cargo sale de la memoria; la lista se refresca por _m) ──
// Sin clasificar ni conciliar el cargo. La versión anterior queda en notaHistorial. No pasa a la planilla de Google (sin la marca
// de copia: el script no tiene columna para la nota).
export async function notaCargo(docId, texto) {
  const id = s(docId), x = (await todos('cartola_cargos')).find(y => y.id === id && !y.d.quitadoEnPlanilla);
  if (!x) throw error('Ese cargo ya no está. Recarga.', 'datos');
  const por = quien(), en = ahora(), r = C.conNota(x.d, texto, por, en);
  if (!r.cambio) return { ok: true, sinCambios: true, nota: C.vistaNota(x.d.nota) };
  const d = await dbBase();
  await FB.updateDoc(FB.doc(d, 'cartola_cargos', id), limpio({ ...r.campos, version: (Number(x.d.version) || 0) + 1,
    registro: M.conHistorial(x.d.registro, { que: r.quitada ? 'quitó la nota' : (x.d.nota && C.textoNota(x.d.nota.texto) ? 'editó la nota' : 'agregó una nota'), por, en }) }));
  return { ok: true, nota: C.vistaNota(r.campos.nota), quitada: r.quitada };
}

// v0.65.1 · Las planillas de Previred: meses cargados (cotizaciones, ya en memoria) y sus pagos unidos (previred_planillas,
// un documento por mes: pocos). Sin lecturas por cargo.
async function datosPlanillas() {
  const [cot, pl] = await Promise.all([todos('cotizaciones').catch(() => []), todos(COL_PLANILLAS).catch(() => [])]);
  return { periodos: G3D.listaCot(cot).periodos, docs: Object.fromEntries(pl.map(x => [x.id, x.d])) };
}
const armarPlanillas = (dPl, ab, cg) => C.planillasPrevired(dPl.periodos, dPl.docs, new Set(ab.lista.map(v => v.id)),
  cg.filter(x => !x.d.quitadoEnPlanilla && x.d.accion === C.PREVIRED).map(x => C.vistaCargo(x.id, x.d)));
export const COL_PLANILLAS = 'previred_planillas';
// La planilla de Previred unida no pasa a la planilla de Google (como tef_enviadas y proveedores): sin la marca de copia
const sinPlanilla = o => { const x = { ...o }; delete x.planillaPendiente; delete x.hechoEnBase; return x; };
export async function planillas() {
  const [dPl, ab, cg] = await Promise.all([datosPlanillas(), abiertos(), todos('cartola_cargos')]);
  return armarPlanillas(dPl, ab, cg);
}
// v0.69.5 · Para Finanzas → Cierre de mes ("Previred de <mes> cargado"): lo mismo que planillas(), con lo que ya está en la
// memoria de la sesión (Hoy lee cotizaciones y previred_planillas para el aviso de vencimiento; Finanzas, los vencimientos y la
// cartola): 0 lecturas. Lo que no esté en la memoria se lee como siempre.
const deMemoria = col => { const x = FB.enMemoriaDocs(col); return x ? Promise.resolve(x) : todos(col); };
export async function planillasCierre() {
  const [cot, pl, vencs, ps, siiDocs, cg] = await Promise.all([deMemoria('cotizaciones').catch(() => []), deMemoria(COL_PLANILLAS).catch(() => []), deMemoria('vencimientos'), deMemoria('obligaciones'),
    deMemoria('sii_docs'), deMemoria('cartola_cargos')]);
  const dPl = { periodos: G3D.listaCot(cot).periodos, docs: Object.fromEntries(pl.map(x => [x.id, x.d])) };
  return armarPlanillas(dPl, { lista: C.vencimientosAbiertos(vencs, ps, rutsSii(siiDocs), M.ahoraChile().dia) }, cg);
}

// cc_cargar: los cargos nuevos (los ya vistos no se repiten) y la fila de la cartola
export async function cargar(meta, cargos, parte) {
  const L = C.limpiarCarga(meta, cargos);
  if (L.error) throw error(L.error, 'datos');
  for (const x of L.limpios) { x.huella = C.huellaDe(x); x.id = await C.idDe(x.huella, sha256); }
  const d = await dbBase(), t = ahora(), por = correo() || 'Sistema Fën';
  L.fuente = C.fuenteDeCarga(meta, t);   // v0.64.0: de qué archivo salió cada cargo
  const [cg, ct, reglas] = await Promise.all([todos('cartola_cargos'), todos('cartolas'), reglasTodas()]);
  // v0.69.0 · Con las reglas migradas, solo "No es gasto" que se ignora sola (lo que marcaste "siempre") se aplica al subir
  const RCx = await reglasConc();
  const plan = C.planCarga(L, cg.map(x => C.vistaCargo(x.id, x.d)), C.mapaReglas(RCx.ok ? RC.legacyAlSubir(RCx.reglas) : reglas), t, por);
  let n = 0;
  for (let i = 0; i < plan.nuevos.length; i += 200) {
    const parteN = plan.nuevos.slice(i, i + 200);
    n += await FB.runTransaction(d, async tx => {
      const refs = parteN.map(x => FB.doc(d, 'cartola_cargos', x.id)), sns = [];
      for (const r of refs) sns.push(await tx.get(r));
      let k = 0;
      parteN.forEach((x, j) => { if (!sns[j].exists()) { tx.set(refs[j], nuevoCargo(x.doc, por)); k++; } });
      return k;
    });
  }
  // v0.64.0 · El mismo cargo que ya estaba (de la en línea) llega en la histórica: se le anota la fuente nueva (sin tocar lo demás)
  for (let i = 0; i < plan.masFuentes.length; i += 200) {
    const b = FB.writeBatch(d);
    plan.masFuentes.slice(i, i + 200).forEach(x => b.update(FB.doc(d, 'cartola_cargos', x.id), { fuentes: x.fuentes }));
    await b.commit();
  }
  // La cartola, una vez por nombre y cuenta
  const prev = ct.find(x => !x.d.quitadoEnPlanilla && s(x.d.cartola) === L.ident && s(x.d.cuenta) === L.cuenta);
  const fila = C.filaCartola(prev ? prev.d : null, meta, L, plan.cuenta, parte, t, por);
  const idC = prev ? prev.id : idCartola(ct, L);
  n += await FB.runTransaction(d, async tx => {
    const ref = FB.doc(d, 'cartolas', idC), sn = await tx.get(ref);
    if (sn.exists()) tx.update(ref, cambio(sn.data(), 'subió de nuevo', fila)); else tx.set(ref, nuevo(fila, 'cartola'));
    return 1;
  });
  await despues(n);
  return { ok: true, ...plan.cuenta };
}
// ═══ v0.81.0 · Mercado Pago (reporte de liberaciones) ═══
// Los retiros de Mercado Pago a la cuenta del banco: "Traspaso entre cuentas propias" (no es gasto; se aprende). Los que ya estaban
// resueltos se dejan como están. retiros: los cargos { fecha, descripcion, monto, saldo, operacion } tal como se subieron.
export async function traspasosMP(meta, retiros, nota) {
  const L = C.limpiarCarga(meta, retiros || []);
  if (L.error) throw error(L.error, 'datos');
  let n = 0;
  for (const x of L.limpios) {
    x.huella = C.huellaDe(x); x.id = await C.idDe(x.huella, sha256);
    try { const r = await resolver({ id: x.id, huella: x.huella, accion: C.TRASPASO, nota }); if (!r.repetido) n++; }
    catch (e) { if (!['resuelto', 'cambio', 'datos'].includes(e.code)) throw e; }
  }
  return n;
}
// Las ventas con tarjeta (Point) de cada día: mp_ventas/{AAAA-MM-DD} = { fecha, n, bruto, comision, neto, pct, porTipo, archivo, subidaEl, subidaPor }.
// Un día que ya estaba con más o las mismas ventas no se toca (un reporte que corta a mitad de día no lo achica). → { escritos, iguales }
export async function guardarVentasMP(dias, archivo) {
  const l = Object.values(dias || {}).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha));
  if (!l.length) return { escritos: 0, iguales: 0 };
  const d = await dbBase(), t = ahora(), por = correo() || 'Sistema Fën';
  const prev = Object.fromEntries((await todos('mp_ventas').catch(() => [])).map(x => [x.id, x.d]));
  const cambia = l.filter(x => { const p = prev[x.fecha]; return !p || (Number(p.n) || 0) < x.n || ((Number(p.n) || 0) === x.n && Math.round(Number(p.comision) || 0) !== Math.round(x.comision)); });
  for (let i = 0; i < cambia.length; i += 200) {
    const b = FB.writeBatch(d);
    cambia.slice(i, i + 200).forEach(x => b.set(FB.doc(d, 'mp_ventas', x.fecha), { fecha: x.fecha, mes: x.fecha.slice(0, 7), n: x.n, bruto: Math.round(x.bruto), comision: Math.round(x.comision), neto: Math.round(x.neto),
      pct: x.bruto > 0 ? Math.round(x.comision / x.bruto * 10000) / 100 : 0, porTipo: x.porTipo, archivo: s(archivo).slice(0, 120), subidaEl: t, subidaPor: por }));
    await b.commit();
  }
  if (cambia.length) await despues(cambia.length);
  return { escritos: cambia.length, iguales: l.length - cambia.length };
}
// Id de una cartola nueva: como la copia G1 ("ct-" + huella del nombre); si ese ya es de otra cuenta, con la cuenta
const idCartola = (ct, L) => { const a = 'ct-' + huella(L.ident); return ct.some(x => x.id === a) ? 'ct-' + huella(L.ident + '|' + L.cuenta) : a; };

// El archivo original a Drive (archivo_subir tipo "cartola"); el mismo archivo otra vez no se sube de nuevo
export async function guardarArchivo(meta, a, subir) {
  const L = C.limpiarCarga(meta, []);
  if (L.error) throw error(L.error, 'datos');
  const hu = 'huella:' + (await sha256(a.archivoBase64)).slice(0, 32);
  const ct = await todos('cartolas');
  const prev = ct.find(x => !x.d.quitadoEnPlanilla && s(x.d.cartola) === L.ident && s(x.d.cuenta) === L.cuenta);
  if (prev && s(prev.d.archivo) && s(prev.d.archivoHuella) === hu) return { ok: true, ya: true, url: s(prev.d.archivo) };
  const r = await subir({ tipo: 'cartola', fecha: meta.hasta || meta.desde || '', imageData: a.archivoBase64, mimeType: a.mimeType, fileName: a.nombreArchivo });
  const d = await dbBase(), idC = prev ? prev.id : idCartola(ct, L);
  await FB.runTransaction(d, async tx => {
    const ref = FB.doc(d, 'cartolas', idC), sn = await tx.get(ref), campos = { archivo: r.url || '', archivoHuella: hu };
    if (sn.exists()) tx.update(ref, cambio(sn.data(), 'guardó el archivo', campos));
    else tx.set(ref, nuevo({ ...C.filaCartola(null, meta, L, { cargos: 0, nuevos: 0, yaVistos: 0, ignorados: 0 }, 0, ahora(), quien()), ...campos }, 'cartola'));
  });
  await despues(1);
  return { ok: true, url: r.url || '' };
}

// ── Resolver un cargo ──
async function leerCargo(id) {
  const d = await dbBase(), ref = FB.doc(d, 'cartola_cargos', s(id));
  const sn = await FB.getDoc(ref);
  if (!sn.exists() || sn.data().quitadoEnPlanilla) throw error('Ese cargo ya no está', 'datos');
  return { d, ref, c: C.vistaCargo(sn.id || s(id), sn.data()) };
}
// Lo aprendido, dentro de la transacción: lee la regla de esa clave y la deja al día
// v0.69.0 · También la regla nueva (conc_reglas) de esa glosa y la que propuso: se leen aquí (antes de escribir) y se escriben en la
// misma transacción. cartola_reglas sigue al día igual (por si hay que volver a la v0.68.0).
async function leerRegla(tx, d, clave, c) {
  const lista = await todos('cartola_reglas'), x = lista.find(y => s(y.d.clave) === clave);
  const ref = FB.doc(d, 'cartola_reglas', x ? x.id : 'r-' + huella(clave));
  const sn = await tx.get(ref);
  const conc = await leerConc(tx, d, clave, c && c.__p && c.__p.regla);
  return { ref, sn, act: sn.exists() ? C.vistaRegla(ref.id, sn.data()) : null, conc };
}
function escribirRegla(tx, R, regla, c) {
  if (R && R.conc) escribirConc(tx, R.conc, regla, c);
  if (!regla) return;
  const campos = C.aprender(R.act, c.clave, regla, c.descripcion, ahora(), quien());
  if (R.sn.exists()) tx.update(R.ref, cambio(R.sn.data(), 'aprendió', campos)); else tx.set(R.ref, nuevo(campos, 'cartola'));
}
// v0.69.0 · El puntaje que se mostró al confirmar y la regla que propuso (solo campos, para afinar después)
const extraCargo = c0 => { const p = (c0 && c0.__p) || {}; return { ...(p.puntaje ? { puntaje: p.puntaje } : {}), ...(p.regla ? { reglaConc: p.regla } : {}) }; };
const aCargo = (c0, a, campos) => cambioCargo(a, 'resolvió', { ...campos, ...extraCargo(c0), resueltoEl: ahora(), resueltoPor: quien() });
// Revisa el cargo dentro de la transacción: por revisar, misma huella; o ya resuelto con esta misma marca (repetido)
function revisarCargo(sn, c0, clave) {
  if (!sn.exists()) throw error('Ese cargo ya no está', 'datos');
  const c = C.vistaCargo(sn.id, sn.data());
  if (c.huella !== c0.huella) throw error('Ese cargo cambió. Recarga la lista.', 'cambio');
  if (c.estado !== C.ESTADOS.revisar) {
    if (c.detalle && c.detalle.marca === clave) return { repetido: true, c };
    throw error(`Ese cargo ya se había resuelto (${c.accion}, ${c.resueltoEl}). Recarga la lista.`, 'resuelto');
  }
  return { c };
}

// p = { id, huella, accion: 'vencimientos'|'gasto'|'nuevo'|'ignorar'|'abono'|'pago_tarjeta'|'traspaso', pagos, filas, gasto, motivo, siempre, vencId, tarjeta, nota }
export async function resolver(p) {
  const { d, ref, c: c0 } = await leerCargo(p.id);
  if (s(p.huella) !== c0.huella) throw error('Ese cargo cambió. Recarga la lista.', 'cambio');
  const marca = C.marcaDe(c0), clave = marca.t + marca.r, accion = s(p.accion);
  if (c0.estado !== C.ESTADOS.revisar) {
    if (c0.detalle && c0.detalle.marca === clave) return { ok: true, repetido: true, id: c0.id, accion: c0.accion };
    if (accion === C.REPETIDO && c0.estado === C.ESTADOS.repetido && c0.repetidoDe === s(p.repetidoDe)) return { ok: true, repetido: true, id: c0.id, accion };   // v0.67.6: dos clics
    throw error(`Ese cargo ya se había resuelto (${c0.accion}, ${c0.resueltoEl}). Recarga la lista.`, 'resuelto');
  }
  const tr = C.traza(c0), hora = M.ahoraChile().hora;
  c0.__p = { accion, regla: s(p.regla).slice(0, 40), reglaAccion: s(p.reglaAccion), puntaje: puntajeDe(p.puntaje) };   // v0.69.0
  let r;
  if (accion === 'vencimientos') r = await resolverVencimientos(d, ref, c0, p.pagos, marca, tr, hora);
  else if (accion === 'gasto') r = await resolverGasto(d, ref, c0, p.filas, marca, tr, p.combinacion === true);
  else if (accion === 'nuevo') r = await resolverNuevo(d, ref, c0, p.gasto || {}, marca, tr, hora);
  else if (accion === 'abono') r = await resolverAbono(d, ref, c0, s(p.vencId), marca, tr, p);
  // v0.69.2 · Pago parcial de un documento con "el resto" (efectivo, tarjeta o todavía lo debo), o de un gasto al contado (filas)
  else if (accion === C.ABONO_PARCIAL && (p.resto || (Array.isArray(p.filas) && p.filas.length))) r = await resolverPagoParcial(d, ref, c0, p, marca, tr);
  else if (accion === C.ABONO_PARCIAL) r = await resolverAbonoParcial(d, ref, c0, s(p.vencId), marca, tr);
  else if (accion === C.PREVIRED) return resolverPrevired(c0, p, marca, tr);
  else if (accion === C.PREVIRED_PLANILLA) return unirPlanilla(c0, p, marca);
  else if (accion === C.REPETIDO) return marcarRepetidoAMano(c0, p);
  else if (accion === 'ignorar') {
    const motivo = C.texto(p.motivo, 80) || 'No es gasto', detalle = { motivo, siempre: !!p.siempre, marca: clave };
    r = await FB.runTransaction(d, async tx => {
      const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
      const R = p.siempre || p.regla ? await leerRegla(tx, d, c0.clave, c0) : null;
      tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.ignorado, accion, detalle: JSON.stringify(detalle) }));
      if (R) escribirRegla(tx, R, p.siempre ? C.reglaDe('ignorar', c0, { siempre: true, motivo }) : null, c0);
      return { n: 1 + (R ? 1 : 0), detalle, estado: C.ESTADOS.ignorado };
    });
  } else if (accion === C.PAGO_TARJETA) {
    // v0.62.0 · Pago de la tarjeta de crédito: no crea gasto (las compras con tarjeta ya entraron por el SII); es un movimiento de flujo
    const tarjeta = C.texto(p.tarjeta, 80), detalle = { movimiento: 'flujo', tipo: C.PAGO_TARJETA, tarjeta, marca: clave };
    r = await FB.runTransaction(d, async tx => {
      const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
      const R = await leerRegla(tx, d, c0.clave, c0);
      tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion, detalle: JSON.stringify(detalle) }));
      escribirRegla(tx, R, C.reglaDe(C.PAGO_TARJETA, c0, { tarjeta }), c0);
      return { n: 2, detalle, estado: C.ESTADOS.conciliado };
    });
  } else if (accion === C.TRASPASO) {
    // v0.63.1 · Traspaso entre cuentas propias (chequera ↔ cuenta corriente): no crea gasto; movimiento de flujo que se aprende
    const nota = C.texto(p.nota, 80), detalle = { movimiento: 'flujo', tipo: C.TRASPASO, nota, marca: clave };
    r = await FB.runTransaction(d, async tx => {
      const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
      const R = await leerRegla(tx, d, c0.clave, c0);
      tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion, detalle: JSON.stringify(detalle) }));
      escribirRegla(tx, R, C.reglaDe(C.TRASPASO, c0, { nota }), c0);
      return { n: 2, detalle, estado: C.ESTADOS.conciliado };
    });
  } else throw error('Acción desconocida', 'datos');
  if (r.repetido) return { ok: true, repetido: true, id: c0.id, accion };
  await despues(r.n);
  // v0.64.0 · Lo aprendido del proveedor: la glosa de este cargo queda en su ficha (si se sabe quién es)
  try { await aprenderGlosa(c0, p, r.detalle); } catch (e) {}
  if (accion === 'vencimientos') { try { await FS.vencimientosAlDia(); } catch (e) {} }
  return { ok: true, id: c0.id, accion, estado: r.estado || C.ESTADOS.conciliado, traza: tr, detalle: r.detalle };
}

// v0.67.6 · "Marcar como repetido" (la propuesta de la lista): el original sale de la memoria y se revisa que sea el mismo
// movimiento (misma cuenta, monto, fecha ±1 y de otra subida). 1 lectura (el cargo, en la transacción) y 1 escritura.
async function marcarRepetidoAMano(c0, p) {
  const oid = s(p.repetidoDe), x = (await todos('cartola_cargos')).find(y => y.id === oid && !y.d.quitadoEnPlanilla);
  if (!x) throw error('Ese movimiento ya no está. Recarga.', 'datos');
  const o = C.vistaCargo(x.id, x.d);
  if (o.estado === C.ESTADOS.repetido) throw error('Ese movimiento también es un repetido. Recarga.', 'cambio');
  const m = C.mismoMovimiento(c0, o);
  if (!m) throw error('No es el mismo movimiento: otra cuenta, otro monto, más de un día de diferencia o la misma cartola.', 'datos');
  const n = await marcarRepetidos([{ c: c0, original: o, por: m.por, como: 'mano', motivo: C.texto(p.motivo, 120) }]);
  if (!n) throw error('Ese cargo ya se había revisado o cambió. Recarga la lista.', 'resuelto');
  return { ok: true, id: c0.id, accion: C.REPETIDO, estado: C.ESTADOS.repetido, detalle: c0.detalle };
}
async function resolverVencimientos(d, ref, c0, pagos, marca, tr, hora) {
  const ab = await abiertos(), porId = {}; ab.lista.forEach(v => { porId[v.id] = v; });
  const rp = C.revisarPagos(pagos, c0, porId);
  if (rp.error) throw error(rp.error, rp.code || 'datos');
  // Compras a crédito y facturas del SII: los gastos que ya existen se completan con la fecha de pago (todas las líneas de la factura)
  const creditos = {};
  for (const { v } of rp.pedidos) {
    const vd = (ab.vencs.find(x => x.id === v.id) || {}).d || {};
    // v0.70.0 · Lo nacido de su boleta: sus gastos son los guardados en él (ya existen, del mes del período)
    if (G3.esDevengado(vd)) { creditos[v.id] = vd.gastosDoc.slice(0, 40).map(s); continue; }
    if (v.plantillaId || v.suelto) continue;
    let l = [];
    if (v.folio) l = (await todos('gastos', FB.where('folio', '==', v.folio))).filter(x => x.d.estado === 'vigente' && !s(x.d.fechaPago) && ['proveedor', 'tarjeta'].includes(s(x.d.formaPago)) && (!v.razon || C.norm(x.d.razonSocial) === C.norm(v.razon)));
    if (!l.length && v.item) {
      const delItem = (await todos('gastos', FB.where('itemGasto', '==', v.item))).sort((a, b) => s(b.d.fecha).localeCompare(s(a.d.fecha)) || s(b.d.hora).localeCompare(s(a.d.hora)) || b.id.localeCompare(a.id));
      l = M.gastosDelCredito(M.vistaVencimiento(v.id, vd), delItem);
    }
    creditos[v.id] = l.map(x => x.id);
  }
  const clave = marca.t + marca.r;
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const refsV = rp.pedidos.map(({ v }) => FB.doc(d, 'vencimientos', v.id)), snV = [];
    for (const r of refsV) snV.push(await tx.get(r));
    const snC = {};
    for (const id of Object.keys(creditos)) { snC[id] = []; for (const gid of creditos[id]) { const rg = FB.doc(d, 'gastos', gid); snC[id].push({ ref: rg, sn: await tx.get(rg) }); } }
    const R = await leerRegla(tx, d, c0.clave, c0);
    let n = 1;
    const pagados = [];
    rp.pedidos.forEach(({ v: v0, monto, abono }, i) => {
      if (!snV[i].exists()) throw error('Un vencimiento ya no existe. Recarga la lista.', 'datos');
      const a = snV[i].data(), eb = G3.estadoBase(a);
      // v0.70.0 · Lo nacido de su boleta pagado en partes (lo más antiguo primero): un abono con su saldo; el último lo deja pagado
      // y les pone la fecha de pago a sus gastos (que ya existían). Nunca se crean gastos aquí.
      if (abono) {
        if (!G3.esDevengado(a)) throw error(`"${s(a.nombre)}" no se puede pagar en partes desde aquí. Recarga la lista.`, 'datos');
        const x = G3.abonoParcial(a, { monto, fecha: c0.fecha, origen: 'cartola', cargoId: c0.id, medio: 'banco', clave: clave + 'v' + i, por: quien(), en: ahora() });
        if (x.repetido) return;
        if (x.error) throw error(`${s(a.nombre)}: ${x.error}`, 'datos');
        const ids = [];
        if (x.final) (snC[v0.id] || []).forEach(({ ref: rg, sn: sg }) => {
          if (!sg.exists()) return; const g = sg.data(); if (g.fechaPago || g.estado !== 'vigente') return;
          tx.update(rg, cambio(g, 'pagó con la cartola (último abono)', { fechaPago: x.campos.fechaPago || c0.fecha, cartola: tr, cartolaCargo: c0.id }, { vencimiento: v0.id })); ids.push(rg.id); n++;
        });
        tx.update(refsV[i], cambio(a, x.final ? 'último abono con la cartola (pagado)' : 'abono con la cartola', x.campos, { monto, cargo: c0.id }));
        pagados.push({ id: v0.id, multiAntes: null, nombre: s(a.nombre), monto, plantillaId: v0.plantillaId, folio: v0.folio, razon: v0.razon, rut: v0.rut, filas: ids.length, gastos: ids, conLineas: false, abono: true, final: !!x.final, saldo: x.saldo });
        return;
      }
      if (!['esperando_documento', 'por_pagar'].includes(eb)) throw error(`"${s(a.nombre)}" ya no está por pagar (${G3.NOMBRE_ESTADO[eb] || eb}). Recarga la lista.`, 'pagado');
      const v = M.vistaVencimiento(v0.id, a), extra = {};
      let ids = [];
      const conLineas = G3.conLineas(a);   // v0.70.0: lo nacido de su boleta ya tiene sus gastos (no crea líneas)
      const multi = conLineas && v.plantillaId ? C.repartoPago(a.multiArea, monto) : [];
      if (multi.length) { extra.multiArea = JSON.stringify(multi); v.multiArea = multi; }
      if (conLineas) {
        // v0.51.0: con el certificado de Previred, un gasto por trabajador (y con la factura del SII, su RUT y folio)
        const lp = G3D.lineasDelPago(v, a, monto, c0.fecha, tr.slice(0, 500), '', s(a.tipoMonto) === 'siniva' ? 'siniva' : 'bruto', hora);
        if (lp.error) throw error(lp.error, 'datos');
        const lineas = lp.lineas;
        ids = M.idsLineas('gp', { t: marca.t, r: marca.r + 'v' + i }, lineas.length);
        const od = { tipo: 'vencimiento', vencimientoId: v0.id, obligacion: s(a.nombre), periodo: s(a.fechaVencimiento).slice(0, 10), cartola: true, cargoId: c0.id, por: quien(), en: ahora() };
        lineas.forEach((l, k) => tx.set(FB.doc(d, 'gastos', ids[k]), nuevo({ ...l, cartola: tr, cartolaCargo: c0.id, origenDetalle: od }, 'obligacion')));
        n += lineas.length;
      } else (snC[v.id] || []).forEach(({ ref: rg, sn: sg }) => {
        if (!sg.exists()) return; const g = sg.data(); if (g.fechaPago || g.estado !== 'vigente') return;
        tx.update(rg, cambio(g, 'pagó con la cartola', { fechaPago: c0.fecha, cartola: tr, cartolaCargo: c0.id }, { vencimiento: v.id })); ids.push(rg.id); n++;
      });
      tx.update(refsV[i], cambio(a, 'pagó con la cartola', { ...extra, estado: 'pagado', fechaPago: c0.fecha, montoPago: String(monto), obsPago: tr.slice(0, 500), cartola: tr, cartolaCargo: c0.id, pago: { clave: clave + 'v' + i, cargoId: c0.id } }));
      pagados.push({ id: v.id, multiAntes: multi.length ? s(a.multiArea) : null, nombre: s(a.nombre), monto, plantillaId: v.plantillaId, folio: v0.folio, razon: v0.razon, rut: v0.rut, filas: ids.length, gastos: ids, conLineas });
    });
    const detalle = { vencimientos: pagados, marca: clave };
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: 'vencimientos', detalle: JSON.stringify(detalle).slice(0, 45000) }));
    escribirRegla(tx, R, C.reglaDe('vencimientos', c0, { pagados }), c0);
    return { n: n + 1, detalle };
  });
}

// v0.67.4 · combinacion: varios gastos (facturas y notas de crédito) que juntos suman el cargo (±$1). Todos quedan con la cartola.
async function resolverGasto(d, ref, c0, filas, marca, tr, combinacion) {
  const ids = [...new Set(Array.isArray(filas) ? filas.map(f => s(f && (f.id || f.fila))).filter(Boolean) : [])];
  if (!ids.length || ids.length > (combinacion ? 120 : 40)) throw error('Elige el gasto', 'datos');
  const clave = marca.t + marca.r;
  // v0.63.1: el vencimiento pagado a mano de esos gastos (si lo hay) también queda con la cartola
  const pre = await Promise.all(ids.map(id => FB.getDoc(FB.doc(d, 'gastos', id))));
  const vIds = [...new Set(pre.filter(x => x.exists()).map(x => s(x.data().vencimientoId)).filter(Boolean))].slice(0, 5);
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const refs = ids.map(id => FB.doc(d, 'gastos', id)), sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    const refsV = vIds.map(id => FB.doc(d, 'vencimientos', id)), snV = [];
    for (const r of refsV) snV.push(await tx.get(r));
    let suma = 0, positivos = 0;
    const ncs = [];
    sns.forEach((g, i) => {
      if (!g.exists() || g.data().estado !== 'vigente') throw error('Ese gasto cambió en otro lado: recarga la lista.', 'cambio');
      if (g.data().cartolaCargo || /\[cc[0-9a-f]{10}\]/.test(s(g.data().cartola))) throw error('Ese gasto ya está conciliado con otro cargo.', 'datos');
      const m = M.n(g.data().montoFinal); suma += m;
      if (m > 0) positivos++; else if (m < 0) ncs.push(refs[i].id);
    });
    // Una nota de crédito (monto negativo) solo va junto con su factura, y el total debe ser el cargo
    if (!positivos) throw error('Una nota de crédito solo se concilia junto con su factura.', 'datos');
    if (Math.abs(suma - c0.monto) > (combinacion ? 1 : ids.length)) throw error(`${combinacion ? 'Los gastos suman' : 'El gasto suma'} ${suma} y el cargo es de ${c0.monto}`, 'datos');
    const esperaban = [], conFecha = [], vLigados = [];
    sns.forEach((g, i) => {
      const a = g.data(), campos = { cartola: tr, cartolaCargo: c0.id };
      if (a.esperaCargo === true) { campos.esperaCargo = false; esperaban.push(refs[i].id); }
      // Una factura a crédito (sin vencimiento por pagar) que se paga con este cargo: queda con su fecha de pago
      if (['proveedor', 'tarjeta'].includes(s(a.formaPago)) && !s(a.fechaPago)) { campos.fechaPago = c0.fecha; conFecha.push(refs[i].id); }
      // v0.66.0 · Factura del SII clasificada sola (o al conciliar) que esperaba su pago: la fecha de pago es la del banco
      else if (a.esperaPago === true) { campos.fechaPago = c0.fecha; campos.esperaPago = false; campos.medioPago = 'banco'; conFecha.push(refs[i].id); }
      tx.update(refs[i], cambio(a, combinacion ? `conciliado con la cartola (junto con ${ids.length - 1} ${ids.length === 2 ? 'línea más' : 'líneas más'})` : 'conciliado con la cartola', campos));
    });
    snV.forEach((v, i) => {
      if (!v.exists()) return; const a = v.data();
      if (G3.estadoBase(a) !== 'pagado' || s(a.cartolaCargo)) return;
      tx.update(refsV[i], cambio(a, 'confirmado con la cartola', { cartola: tr, cartolaCargo: c0.id }));
      vLigados.push(refsV[i].id);
    });
    const g0 = sns[0].data();
    const detalle = { filas: ids.length, ids, items: [...new Set(sns.map(g => s(g.data().itemGasto)))], fecha: s(g0.fecha), monto: suma, marca: clave,
      ...(esperaban.length ? { esperaban } : {}), ...(conFecha.length ? { conFechaPago: conFecha } : {}), ...(vLigados.length ? { vencimientosLigados: vLigados } : {}),
      ...(combinacion || ncs.length ? { combinacion: true, documentos: docsDe(sns.map(g => g.data())), ...(ncs.length ? { notasCredito: ncs } : {}) } : {}) };
    // v0.67.4 · Todos del mismo RUT: se anota para aprender la glosa en la ficha de ese proveedor (si existe)
    const rutsG = [...new Set(sns.map(g => P.rutNorm(g.data().rutProveedor)).filter(Boolean))];
    if (combinacion && rutsG.length === 1) detalle.rut = rutsG[0];
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: 'gasto', detalle: JSON.stringify(detalle) }));
    return { n: ids.length + 1 + vLigados.length, detalle };
  });
}

// v0.67.4 · Los documentos de una combinación, para "Ya revisados": "F.30990149", "NC 4068722" (sin repetir), o los ítems y la fecha
function docsDe(gs) {
  const out = [];
  gs.forEach(g => { const m = /^(F|NC)\.\s*(\d+)/.exec(s(g.observacion)), folio = s(g.folio) || (m ? m[2] : '') || s(g.siiDoc && g.siiDoc.folio), nc = M.n(g.montoFinal) < 0;
    const t = folio ? (nc ? 'NC ' : 'F.') + folio : `${s(g.itemGasto)} ${s(g.fecha)}`; if (!out.includes(t)) out.push(t); });
  return out.slice(0, 12);
}
async function resolverNuevo(d, ref, c0, gq, marca, tr, hora) {
  const cat = await catalogo(), li = M.limpiarItems(Array.isArray(gq.items) ? gq.items.slice(0, 10) : [], cat.lista.filter(i => !i.archivado));
  if (li.error) throw error(li.error, 'datos');
  if (!li.limpios.length) throw error('Agrega al menos un ítem', 'datos');
  const tipoMonto = ['bruto', 'neto', 'siniva'].includes(gq.tipoMonto) ? gq.tipoMonto : 'bruto';
  const total = li.limpios.reduce((t, it) => t + (tipoMonto === 'neto' ? Math.round(it.montoTotal * M.factorDe(it.esHarina)) : it.montoTotal), 0);
  if (Math.abs(total - c0.monto) > li.limpios.length) throw error(`El gasto suma ${total} y el cargo es de ${c0.monto}`, 'datos');
  const e = { fecha: c0.fecha, hora, tipoMonto, formaPago: 'contado', fechaPago: '', observacion: M.obsLibre(gq.observacion, 300) || M.obsLibre('Cartola: ' + c0.descripcion, 300), archivo: '', urlFoto: '' };
  const lineas = M.lineasCompra(e, li.limpios), ids = M.idsLineas('gc', marca, lineas.length), clave = marca.t + marca.r;
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const R = await leerRegla(tx, d, c0.clave, c0);
    const od = { tipo: 'cartola', cargoId: c0.id, descripcion: c0.descripcion, fecha: c0.fecha, cuenta: c0.cuenta, por: quien(), en: ahora() };
    // v0.64.0: el SII de ese mes no estaba cargado: el gasto espera su factura (en la carga del SII se ofrece vincularla)
    const espera = gq.esperaFactura === true && !gq.sinFactura;
    lineas.forEach((l, k) => tx.set(FB.doc(d, 'gastos', ids[k]), nuevo({ ...l, cartola: tr, cartolaCargo: c0.id, origenDetalle: od, ...(espera ? { esperaFactura: true } : {}) }, 'cartola')));
    const detalle = { items: li.limpios.map(it => it.item), filas: lineas.length, ids, sinFactura: !!gq.sinFactura, tipoMonto, marca: clave, ...(espera ? { esperaFactura: true } : {}) };
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: 'nuevo', detalle: JSON.stringify(detalle) }));
    escribirRegla(tx, R, C.reglaDe('nuevo', c0, { it0: li.limpios[0], sinFactura: !!gq.sinFactura }), c0);
    return { n: lineas.length + 2, detalle };
  });
}

// Abono a un vencimiento de tipo libre (sueldo líquido). Primero el abono (idempotente por el cargo), después el cargo.
// v0.63.1 · con el área del abono (areas, fuenteArea) y el destinatario (la glosa y el RUT del cargo; nombre opcional)
async function resolverAbono(d, ref, c0, vencId, marca, tr, p = {}) {
  if (!vencId) throw error('Elige el vencimiento que recibe el abono', 'datos');
  const sv = await FB.getDoc(FB.doc(d, 'vencimientos', vencId));
  if (!sv.exists()) throw error('Ese vencimiento ya no existe', 'datos');
  const v = sv.data();
  if (s(v.tipoObligacion) !== 'libre') throw error('Solo los vencimientos de tipo libre reciben abonos', 'datos');
  const ra = await FS.agregarAbono(vencId, { monto: c0.monto, fecha: c0.fecha, origen: 'cartola', cargoId: c0.id, cartola: tr, obs: '',
    ...(Array.isArray(p.areas) && p.areas.length ? { areas: p.areas, fuenteArea: s(p.fuenteArea) } : {}), destinatario: { rut: c0.rut || (P.rutValido(p.rutDestino) ? P.rutNorm(p.rutDestino) : ''), descripcion: c0.descripcion, nombre: C.texto(p.nombre, 80) } }, marca, null);
  const clave = marca.t + marca.r;
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const snV = await tx.get(FB.doc(d, 'vencimientos', vencId)), a = snV.data(), l = Array.isArray(a.abonos) ? a.abonos : [];
    const k = l.findIndex(y => y.cargoId === c0.id);
    if (k < 0) throw error('El abono no quedó en el vencimiento: vuelve a intentarlo.', 'cambio');
    const R = await leerRegla(tx, d, c0.clave, c0);
    const detalle = { abono: { vencimientoId: vencId, nombre: s(a.nombre), n: k + 1, monto: c0.monto, plantillaId: s(a.plantillaID), gastos: l[k].gastoIds || [], ...(Array.isArray(l[k].areas) ? { areas: l[k].areas } : {}) }, marca: clave, repetidoAbono: !!ra.repetido };
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: 'abono', detalle: JSON.stringify(detalle) }));
    if (s(a.plantillaID)) escribirRegla(tx, R, C.reglaDe('abono', c0, { plantillaId: s(a.plantillaID), nombre: s(a.nombre) }), c0);
    return { n: 2, detalle };
  });
}

// v0.64.0 · Abono (pago parcial) a un vencimiento no libre: el abono primero (idempotente por el cargo), después el cargo
async function resolverAbonoParcial(d, ref, c0, vencId, marca, tr) {
  if (!vencId) throw error('Elige el vencimiento que recibe el abono', 'datos');
  const ra = await FS.abonoParcial(vencId, { monto: c0.monto, fecha: c0.fecha, origen: 'cartola', cargoId: c0.id, cartola: tr }, marca);
  const clave = marca.t + marca.r;
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const snV = await tx.get(FB.doc(d, 'vencimientos', vencId)), a = snV.data(), l = Array.isArray(a.abonos) ? a.abonos : [];
    const k = l.findIndex(y => y.cargoId === c0.id);
    if (k < 0) throw error('El abono no quedó en el vencimiento: vuelve a intentarlo.', 'cambio');
    const detalle = { abonoParcial: { vencimientoId: vencId, nombre: s(a.nombre), n: k + 1, monto: c0.monto, total: G3.totalVenc(a), saldo: G3.saldoVenc(a), final: G3.estadoBase(a) === 'pagado', gastos: l[k].gastoIds || [] }, marca: clave, repetidoAbono: !!ra.repetido };
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: C.ABONO_PARCIAL, detalle: JSON.stringify(detalle) }));
    return { n: 1, detalle };
  });
}
// ═══ v0.69.2 · Pagos mixtos: el cargo paga una parte del documento y el resto se pagó en efectivo, con tarjeta, o se debe ═══
// p = { vencId (vencimiento de un documento: factura a crédito o ya en partes) | filas (los gastos de un documento al contado),
//       resto: { medio: 'efectivo'|'tarjeta'|'debo', fecha, origen, origenTexto } }
// Todo en UNA transacción: el cargo, el vencimiento (se crea "en partes" si el documento era al contado), los gastos del documento,
// su documento del SII y, si el resto fue en efectivo o con tarjeta, su pago en sii_pagos. El gasto nunca se duplica.
async function resolverPagoParcial(d, ref, c0, p, marca, tr) {
  const clave = marca.t + marca.r, por = quien(), en = ahora(), conGastos = !s(p.vencId);
  let refV, gs0 = [];
  if (conGastos) {
    const ids = [...new Set(p.filas.map(f => s(f && (f.id || f.fila))).filter(Boolean))].slice(0, 40);
    if (!ids.length) throw error('Elige el documento', 'datos');
    const pre = await Promise.all(ids.map(id => FB.getDoc(FB.doc(d, 'gastos', id))));
    gs0 = pre.filter(x => x.exists()).map(x => ({ id: x.id, d: x.data() }));
    if (gs0.length !== ids.length) throw error('Un gasto de ese documento ya no está. Recarga la lista.', 'cambio');
    refV = FB.doc(d, 'vencimientos', ('vp-' + c0.id + '-' + marca.r).replace(/[^0-9A-Za-z_-]/g, '_'));
  } else {
    refV = FB.doc(d, 'vencimientos', s(p.vencId));
    const sv = await FB.getDoc(refV);
    if (!sv.exists() || sv.data().quitadoEnPlanilla) throw error('Ese vencimiento ya no existe', 'datos');
    if (!PM.esDeDocumento(sv.data())) throw error('El resto solo se registra así en facturas y compras. En una cuenta recurrente, registra el abono y después el resto en Por pagar.', 'datos');
    gs0 = await FS.gastosDelDocumento(refV.id, sv.data());
  }
  const gSii = gs0.find(g => g.d.siiDoc && g.d.siiDoc.id), siiId = gSii ? s(gSii.d.siiDoc.id) : '';
  return FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), x = revisarCargo(sn, c0, clave); if (x.repetido) return { repetido: true };
    const snV = await tx.get(refV);
    const refsG = gs0.map(g => FB.doc(d, 'gastos', g.id)), snG = [];
    for (const r of refsG) snG.push(await tx.get(r));
    const refD = conGastos && siiId ? FB.doc(d, 'sii_docs', siiId) : null, snD = refD ? await tx.get(refD) : null;
    let v;
    if (conGastos) {
      if (snV.exists()) throw error('Ese documento ya se está pagando en partes. Recarga la lista.', 'cambio');
      snG.forEach(g => {
        if (!g.exists() || g.data().estado !== 'vigente') throw error('Ese gasto cambió en otro lado: recarga la lista.', 'cambio');
        const a = g.data();
        if (a.cartolaCargo || /\[cc[0-9a-f]{10}\]/.test(s(a.cartola))) throw error('Ese gasto ya está conciliado con otro cargo.', 'datos');
        if (s(a.vencimientoId) || M.n(a.montoFinal) < 0) throw error('Ese gasto no se puede pagar en partes desde aquí (es un pago de vencimiento o una nota de crédito).', 'datos');
        if (['proveedor', 'tarjeta'].includes(s(a.formaPago)) && s(a.fechaPago)) throw error('Ese documento ya tiene su pago registrado. Recarga la lista.', 'cambio');
      });
      if (!p.resto) throw error('Elige qué pasó con el resto', 'datos');
      const fechaV = s(p.resto.medio) === 'debo' ? s(p.resto.fecha) : [c0.fecha, s(p.resto.fecha)].filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().pop() || c0.fecha;
      const ve = PM.vencimientoEnPartes(snG.map((g, i) => ({ id: refsG[i].id, d: g.data() })), { id: refV.id, fecha: fechaV, porPagar: s(p.resto.medio) === 'debo', cargoId: c0.id, por, en });
      if (snD && snD.exists()) ve.venc.pagoEnPartes.siiDocAntes = { vencimiento: s((snD.data().importado || {}).vencimiento) };
      v = { ...M.docVencimiento(ve.venc), ...ve.venc };
    } else {
      if (!snV.exists()) throw error('Ese vencimiento ya no existe', 'datos');
      v = snV.data();
      if (!G3.abierto(v)) throw error(`"${s(v.nombre)}" ya no está por pagar. Recarga la lista.`, 'pagado');
    }
    const pend = G3.saldoVenc(v);
    if (!(c0.monto < pend - PM.TOL)) throw error(`El cargo (${PM.pesos(c0.monto)}) no es menor que lo que falta (${PM.pesos(pend)}): págalo completo.`, 'datos');
    const falta = pend - c0.monto, rr = p.resto ? PM.revisarResto(p.resto, falta) : null;
    if (rr && rr.error) throw error(rr.error, 'datos');
    // La parte del banco (este cargo) y, si se pagó, el resto (con el mismo cargo, para deshacerlo junto con él)
    const x1 = G3.abonoParcial(v, { monto: c0.monto, fecha: c0.fecha, origen: 'cartola', cargoId: c0.id, clave, medio: 'banco', por, en });
    if (x1.repetido) throw error('Ese cargo ya es un abono de este documento. Recarga la lista.', 'cambio');
    if (x1.error) throw error(x1.error, 'datos');
    let vN = { ...v, ...x1.campos }, pagoId = '', nResto = 0;
    const resto = rr ? rr.limpio : null;
    if (resto && resto.medio !== 'debo') {
      pagoId = PM.idPago(refV.id, clave + 'r');
      const x2 = G3.abonoParcial(vN, { monto: resto.monto, fecha: resto.fecha, origen: 'mano', clave: clave + 'r', medio: resto.medio, origenEfectivo: resto.origenEfectivo, origenTexto: resto.origenTexto, pagoId, conCargo: c0.id, por, en });
      if (x2.error) throw error(x2.error, 'datos');
      vN = { ...vN, ...x2.campos }; nResto = vN.abonos.length;
    } else if (resto && !conGastos && resto.fecha !== G3.fechaReal(v)) vN.fechaSaldo = resto.fecha;   // a crédito: el saldo con su fecha
    const final = G3.estadoBase(vN) === 'pagado', partes = PM.partesDe(vN);
    const mix = final ? { fechaPago: vN.fechaPago, pagoMixto: PM.pagoMixtoDe(vN), cartola: tr, cartolaCargo: c0.id } : {};
    let n = 1;
    // El vencimiento
    const camposV = { abonos: vN.abonos, estado: vN.estado, ...(final ? { fechaPago: vN.fechaPago, montoPago: vN.montoPago, fechaSaldo: '' } : {}), ...(vN.fechaSaldo && !final ? { fechaSaldo: vN.fechaSaldo } : {}) };
    if (conGastos) {
      const { historial, ...sinH } = vN;
      tx.set(refV, { ...nuevo(sinH, 'partes'), historial: M.conHistorial([], { que: final ? 'pagado en partes (cartola y ' + (resto.medio === 'tarjeta' ? 'tarjeta' : 'efectivo') + ')' : 'pago en partes: primer abono (cartola)', por, en, cargoId: c0.id }) });
    } else tx.update(refV, cambio(v, final ? 'último abono (pagado)' : 'abono parcial (cartola)', camposV, { monto: c0.monto, cargoId: c0.id, ...(resto && resto.medio !== 'debo' ? { resto: resto.medio, montoResto: resto.monto } : {}) }));
    n++;
    // Los gastos del documento: nunca se duplican. Al contado pasan a "en partes" (con su vencimiento); pagado: su fecha y cómo
    snG.forEach((g, i) => {
      if (!g.exists()) return; const a = g.data(); if (a.estado !== 'vigente') return;
      if (conGastos) { tx.update(refsG[i], cambio(a, final ? 'pagado en partes' : 'pago en partes (primer abono con la cartola)', { ...PM.camposGastoEnPartes(refV.id), ...mix }, { vencimiento: refV.id, cargoId: c0.id })); n++; }
      else if (final && !s(a.fechaPago)) { tx.update(refsG[i], cambio(a, 'pagó (último abono)', mix, { vencimiento: refV.id })); n++; }
    });
    // Su documento del SII: queda con su vencimiento (para reconocer el proveedor por el RUT en el siguiente cargo)
    if (snD && snD.exists() && snD.data().importado) { tx.update(refD, cambio(snD.data(), 'pago en partes', { importado: { ...snD.data().importado, vencimiento: refV.id } })); n++; }
    // El resto en efectivo o con tarjeta: también como pago guardado (Efectivo disponible y flujo de caja)
    if (pagoId) {
      const g0 = (snG.find(z => z.exists()) || { data: () => ({}) }).data();
      const doc = { docId: siiId || s(vN.siiDocId), vencimientoId: refV.id, rut: s(vN.rutProveedor || g0.rutProveedor), folio: s(vN.folio || g0.folio), razonSocial: s(vN.razonSocial || g0.razonSocial), fechaFactura: s(g0.fecha).slice(0, 10), gastos: refsG.map(r => r.id) };
      tx.set(FB.doc(d, 'sii_pagos', pagoId), limpio(PM.registroPago(doc, resto, { por, en, cargoId: c0.id, clave: clave + 'r' })));
    }
    const k = vN.abonos.findIndex(y => y.cargoId === c0.id);
    const detalle = { abonoParcial: { vencimientoId: refV.id, nombre: s(vN.nombre), n: k + 1, monto: c0.monto, total: G3.totalVenc(vN), saldo: G3.saldoVenc(vN), final, gastos: [] }, partes: partes.length,
      ...(conGastos ? { creoVencimiento: true, gastosDoc: refsG.map(r => r.id) } : {}),
      ...(resto ? { resto: { medio: resto.medio, monto: resto.monto, fecha: resto.fecha, ...(resto.origenEfectivo ? { origen: resto.origenEfectivo } : {}), ...(resto.origenTexto ? { origenTexto: resto.origenTexto } : {}), ...(pagoId ? { pagoId, n: nResto } : {}) } } : {}), marca: clave };
    tx.update(ref, aCargo(c0, sn.data(), { estado: C.ESTADOS.conciliado, accion: C.ABONO_PARCIAL, detalle: JSON.stringify(detalle) }));
    return { n, detalle };
  });
}
// v0.64.0 · Pago de Previred (cotizaciones) con varios cargos: suman el total del certificado (±$10) o se confirma con un motivo.
// Paga el vencimiento de Cotizaciones como siempre (un gasto por trabajador con su área: lo devengado del certificado) y deja
// todos los cargos conciliados, cada uno con el grupo. p = { vencId, cargos: [{ id, huella }], motivo }
async function resolverPrevired(c0, p, marca, tr) {
  const d = await dbBase(), vencId = s(p.vencId);
  const lista = (Array.isArray(p.cargos) ? p.cargos : []).map(x => ({ id: s(x && x.id), huella: s(x && x.huella) })).filter(x => x.id);
  if (!lista.some(x => x.id === c0.id)) lista.unshift({ id: c0.id, huella: c0.huella });
  if (lista.length > 12) throw error('Son demasiados cargos para un pago de Previred (máximo 12)', 'datos');
  if (new Set(lista.map(x => x.id)).size !== lista.length) throw error('Un cargo está repetido', 'datos');
  if (!vencId) throw error('Falta el vencimiento de Cotizaciones', 'datos');
  const refV = FB.doc(d, 'vencimientos', vencId), refsC = lista.map(x => FB.doc(d, 'cartola_cargos', x.id));
  const clave = marca.t + marca.r, hora = M.ahoraChile().hora, motivo = C.texto(p.motivo, 200);
  const r = await FB.runTransaction(d, async tx => {
    const snC = []; for (const rf of refsC) snC.push(await tx.get(rf));
    const cs = snC.map((sn, i) => { if (!sn.exists()) throw error('Un cargo ya no está. Recarga la lista.', 'datos'); const c = C.vistaCargo(sn.id, sn.data()); if (lista[i].huella && c.huella !== lista[i].huella) throw error('Un cargo cambió. Recarga la lista.', 'cambio'); return c; });
    const c00 = cs.find(c => c.id === c0.id);
    if (c00.estado !== C.ESTADOS.revisar) { if (c00.detalle && c00.detalle.marca === clave) return { repetido: true }; throw error(`Ese cargo ya se había resuelto (${c00.accion}). Recarga la lista.`, 'resuelto'); }
    const otro = cs.find(c => c.estado !== C.ESTADOS.revisar); if (otro) throw error(`El cargo de ${otro.monto} (${otro.descripcion}) ya se había resuelto. Recarga la lista.`, 'resuelto');
    const snV = await tx.get(refV); if (!snV.exists()) throw error('Ese vencimiento ya no existe', 'datos');
    const a = snV.data(), eb = G3.estadoBase(a);
    if (!['esperando_documento', 'por_pagar'].includes(eb)) throw error(`"${s(a.nombre)}" ya no está por pagar. Recarga la lista.`, 'pagado');
    if (!G3.esPrevired(a)) throw error('Ese vencimiento no tiene el certificado de Previred: súbelo primero (Gastos → Previred).', 'datos');
    const Rs = [], leidas = {};
    for (const c of cs) { if (!leidas[c.clave]) leidas[c.clave] = await leerRegla(tx, d, c.clave); Rs.push(leidas[c.clave]); }
    const total = G3D.totalPlan(a.documento.previred), suma = cs.reduce((x, c) => x + c.monto, 0);   // v0.67.0: con las multas e intereses del comprobante
    const q = C.cuadraPrevired(suma, total);
    if (!q.igual && motivo.length < 3) throw error(`Los cargos suman ${suma} y el certificado ${total} (diferencia ${q.dif}): escribe el motivo para confirmar igual.`, 'diferencia');
    const fecha = cs.map(c => c.fecha).sort().pop();
    const lp = G3D.lineasDelPago(M.vistaVencimiento(vencId, a), a, total, fecha, tr.slice(0, 500), '', 'siniva', hora);
    if (lp.error) throw error(lp.error, 'datos');
    const ids = M.idsLineas('gp', { t: marca.t, r: marca.r + 'p' }, lp.lineas.length);
    const od = { tipo: 'vencimiento', vencimientoId: vencId, obligacion: s(a.nombre), periodo: s(a.fechaVencimiento).slice(0, 10), cartola: true, cargoId: c0.id, cargos: cs.map(c => c.id), por: quien(), en: ahora() };
    lp.lineas.forEach((l, k) => tx.set(FB.doc(d, 'gastos', ids[k]), nuevo({ ...l, cartola: tr, cartolaCargo: c0.id, origenDetalle: od }, 'obligacion')));
    const grupo = { vencimientoId: vencId, nombre: s(a.nombre), total, suma, diferencia: q.dif, motivo: q.igual ? '' : motivo, cargos: cs.map(c => ({ id: c.id, monto: c.monto, descripcion: c.descripcion, fecha: c.fecha })), gastos: ids, principal: c0.id };
    tx.update(refV, cambio(a, 'pagó con la cartola (Previred)', { estado: 'pagado', fechaPago: fecha, montoPago: String(suma), obsPago: (`Previred con ${cs.length} cargos · ${tr}` + (q.igual ? '' : ` · diferencia ${q.dif}: ${motivo}`)).slice(0, 500), cartola: tr, cartolaCargo: c0.id,
      pago: { clave, cargoId: c0.id, cargos: cs.map(c => c.id), diferencia: q.dif, motivo: q.igual ? '' : motivo } }));
    cs.forEach((c, i) => {
      const detalle = { previred: grupo, marca: clave };
      tx.update(refsC[i], aCargo(c, snC[i].data(), { estado: C.ESTADOS.conciliado, accion: C.PREVIRED, detalle: JSON.stringify(detalle).slice(0, 45000) }));
    });
    const vistos = new Set();
    cs.forEach((c, i) => { if (vistos.has(c.clave)) return; vistos.add(c.clave); escribirRegla(tx, Rs[i], C.reglaDe(C.PREVIRED, c), c); });
    return { n: 1 + lp.lineas.length + cs.length * 2, detalle: { previred: grupo } };
  });
  if (r.repetido) return { ok: true, repetido: true, id: c0.id, accion: C.PREVIRED };
  await despues(r.n);
  try { await FS.vencimientosAlDia(); } catch (e) {}
  return { ok: true, id: c0.id, accion: C.PREVIRED, estado: C.ESTADOS.conciliado, detalle: r.detalle };
}
// v0.65.1 · Unir cargos del banco a una planilla de Previred ya registrada (mes cargado, gastos por trabajador ya creados):
// NO crea gastos. Una transacción: los cargos (por revisar, misma huella) quedan conciliados con accion 'previred_planilla' y
// la planilla (previred_planillas/{AAAA-MM}) suma sus pagos vinculados. Lo unido no puede pasarse del total (±$10).
// p = { planillaId: 'AAAA-MM', cargos: [{ id, huella }] }
async function unirPlanilla(c0, p, marca) {
  const d = await dbBase(), per = s(p.planillaId).slice(0, 7);
  const lista = (Array.isArray(p.cargos) ? p.cargos : []).map(x => ({ id: s(x && x.id), huella: s(x && x.huella) })).filter(x => x.id);
  if (!lista.some(x => x.id === c0.id)) lista.unshift({ id: c0.id, huella: c0.huella });
  if (lista.length > 12) throw error('Son demasiados cargos de una vez (máximo 12)', 'datos');
  if (new Set(lista.map(x => x.id)).size !== lista.length) throw error('Un cargo está repetido', 'datos');
  const pl = (await planillas()).find(x => x.periodo === per);
  if (!pl) throw error('Esa planilla de Previred ya no está (Gastos → Previred)', 'datos');
  if (pl.vencAbierto) throw error('Esa planilla tiene su vencimiento de Cotizaciones por pagar: págalo con "Pago de Previred" en vez de unir.', 'datos');
  const clave = marca.t + marca.r, t = ahora(), por = quien();
  // v0.67.3 · "Registrar la diferencia como multas e intereses": el ítem (de la lista vigente) y el área; el gasto sale del cargo
  const pd = p.difMultas && typeof p.difMultas === 'object' ? p.difMultas : null;
  let refD = null, itemD = null, areaD = '';
  if (pd) {
    if (pl.conComprobante) throw error('Esa planilla tiene su comprobante de pago: las multas e intereses salen de ahí.', 'datos');
    itemD = (await catalogo()).lista.find(i => !i.archivado && i.item === s(pd.item));
    if (!itemD) throw error('Multas e intereses: elige el ítem (uno de tipo financiero).', 'datos');
    areaD = M.AREAS.includes(s(pd.area)) ? s(pd.area) : '';
    if (!areaD) throw error('Multas e intereses: elige el área.', 'datos');
    refD = FB.doc(d, 'gastos', M.idsLineas('gr', marca, 1)[0]);
  }
  const refP = FB.doc(d, COL_PLANILLAS, per), refsC = lista.map(x => FB.doc(d, 'cartola_cargos', x.id));
  const r = await FB.runTransaction(d, async tx => {
    const snC = []; for (const rf of refsC) snC.push(await tx.get(rf));
    const snP = await tx.get(refP), snD = refD ? await tx.get(refD) : null;
    const cs = snC.map((sn, i) => { if (!sn.exists()) throw error('Un cargo ya no está. Recarga la lista.', 'datos'); const c = C.vistaCargo(sn.id, sn.data()); if (lista[i].huella && c.huella !== lista[i].huella) throw error('Un cargo cambió. Recarga la lista.', 'cambio'); return c; });
    const c00 = cs.find(c => c.id === c0.id);
    if (c00.estado !== C.ESTADOS.revisar) { if (c00.detalle && c00.detalle.marca === clave) return { repetido: true }; throw error(`Ese cargo ya se había resuelto (${c00.accion}). Recarga la lista.`, 'resuelto'); }
    const otro = cs.find(c => c.estado !== C.ESTADOS.revisar); if (otro) throw error(`El cargo de ${otro.monto} (${otro.descripcion}) ya se había resuelto. Recarga la lista.`, 'resuelto');
    const a = snP.exists() ? snP.data() : null, antes = Array.isArray(a && a.pagos) ? a.pagos : [];
    if (cs.some(c => antes.some(x => s(x.cargoId) === c.id))) throw error('Un cargo ya estaba unido a esta planilla. Recarga la lista.', 'resuelto');
    // Lo unido: lo del documento (al día, dentro de la transacción) y lo pagado con la cartola por su vencimiento (v0.64.0)
    const previo = antes.reduce((x, y) => x + (Number(y.monto) || 0), 0) + pl.pagos.filter(x => x.porVencimiento).reduce((x, y) => x + y.monto, 0);
    // Lo de la planilla al día (dentro de la transacción): ¿llegó un comprobante o ya hay una diferencia registrada?
    const comp = a && a.comprobante && !a.comprobante.quitado, difYa = G3D.difVigente(a);
    if (pd && (comp || difYa)) throw error(comp ? 'Esa planilla recibió su comprobante de pago: las multas e intereses salen de ahí. Recarga la lista.' : 'Esa planilla ya tiene su diferencia registrada como multas e intereses. Recarga la lista.', 'cambio');
    if (snD && snD.exists()) throw error('Las multas e intereses de este cargo ya estaban registradas. Recarga la lista.', 'resuelto');
    const suma = cs.reduce((x, c) => x + c.monto, 0), q = C.revisarUnion({ ...pl, conComprobante: pl.conComprobante || !!comp, conDif: pl.conDif || !!difYa, unido: previo }, suma, !!pd);
    if (q.error) throw error(q.error, 'datos');
    const nuevos = cs.map(c => ({ cargoId: c.id, monto: c.monto, fecha: c.fecha, descripcion: C.texto(c.descripcion, 120), cuenta: s(c.cuenta), cuentaN: s(c.cuentaN), por, en: t, marca: clave }));
    // v0.67.3 · La diferencia como multas e intereses: con la fecha del último cargo unido; el total pasa a ser lo del banco
    let dif = null, gD = null;
    if (pd) {
      const fecha = antes.map(x => s(x.fecha)).concat(cs.map(c => c.fecha)).filter(Boolean).sort().pop(), banco = previo + suma;
      const rec = G3D.recDiferencia(per, pl.total, banco, fecha, itemD, areaD, 'dif-' + per + '-' + clave);
      gD = nuevo({ ...G3D.lineaRecargos(rec, '', M.ahoraChile().hora), origenDetalle: { tipo: 'previred', recargos: true, diferenciaBanco: true, periodo: per, cargos: cs.map(c => c.id), por, en: t } }, 'previred');
      gD.previred = { ...gD.previred, diferenciaBanco: true };
      dif = { monto: rec.monto, gastoId: refD.id, fecha, item: itemD.item, area: areaD, cotizaciones: pl.total, banco, por, en: t, clave: rec.clave, cargos: cs.map(c => c.id) };
    }
    const total = dif ? dif.banco : pl.total;
    const campos = { periodo: per, total, fechaPago: pl.fechaPago, trabajadores: pl.n, pagos: antes.concat(nuevos), unido: q.avance.unido, falta: q.avance.falta,
      estado: q.avance.completa ? 'pagada_conciliada' : 'parcial', ...(q.avance.completa ? { conciliadaEl: t, conciliadaPor: por } : { conciliadaEl: '', conciliadaPor: '' }), ...(dif ? { difMultas: dif } : {}) };
    if (a) tx.update(refP, sinPlanilla(cambio(a, dif ? `unió ${cs.length} ${cs.length === 1 ? 'cargo' : 'cargos'} del banco y registró la diferencia como multas e intereses` : `unió ${cs.length} ${cs.length === 1 ? 'cargo' : 'cargos'} del banco`, campos)));
    else tx.set(refP, sinPlanilla(nuevo({ ...campos, pagosQuitados: [] }, 'previred')));
    if (gD) tx.set(refD, gD);
    const grupo = { planillaId: per, nombre: pl.nombre, total, fechaPago: pl.fechaPago, cargos: cs.map(c => ({ id: c.id, monto: c.monto, fecha: c.fecha, descripcion: c.descripcion })), suma, unido: q.avance.unido, falta: q.avance.falta, completa: q.avance.completa, principal: c0.id,
      ...(dif ? { difMultas: { monto: dif.monto, gastoId: dif.gastoId, fecha: dif.fecha } } : {}) };
    cs.forEach((c, i) => tx.update(refsC[i], aCargo(c, snC[i].data(), { estado: C.ESTADOS.conciliado, accion: C.PREVIRED_PLANILLA, detalle: JSON.stringify({ previredPlanilla: grupo, marca: clave }).slice(0, 45000) })));
    return { n: 1 + cs.length + (gD ? 1 : 0), detalle: { previredPlanilla: grupo } };
  });
  if (r.repetido) return { ok: true, repetido: true, id: c0.id, accion: C.PREVIRED_PLANILLA };
  await despues(r.n);
  return { ok: true, id: c0.id, accion: C.PREVIRED_PLANILLA, estado: C.ESTADOS.conciliado, detalle: r.detalle };
}
// v0.65.1 · Deshacer UN cargo unido a una planilla: sale de sus pagos (queda en pagosQuitados con el motivo), la planilla
// recalcula lo unido (deja de estar "pagada y conciliada" si falta) y el cargo vuelve a revisar. Los demás cargos siguen unidos.
async function deshacerUnion(d, c0, motivo) {
  const g = (c0.detalle && c0.detalle.previredPlanilla) || {}, per = s(g.planillaId).slice(0, 7), t = ahora(), por = quien(), avisos = [];
  const ref = FB.doc(d, 'cartola_cargos', c0.id), refP = per ? FB.doc(d, COL_PLANILLAS, per) : null;
  // v0.67.3 · Si con este cargo se registró la diferencia como multas e intereses, se deshace también (el gasto se anula)
  const gDif = g.difMultas && s(g.difMultas.gastoId) ? FB.doc(d, 'gastos', s(g.difMultas.gastoId)) : null;
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Ese cargo ya no está', 'datos');
    const snP = refP ? await tx.get(refP) : null, snG = gDif ? await tx.get(gDif) : null;
    const c = C.vistaCargo(sn.id, sn.data()); if (c.estado === C.ESTADOS.revisar) return { yaEstaba: true };
    let n = 1;
    if (snP && snP.exists()) {
      const a = snP.data(), l = Array.isArray(a.pagos) ? a.pagos : [], fuera = l.filter(x => s(x.cargoId) === c.id), quedan = l.filter(x => s(x.cargoId) !== c.id);
      if (fuera.length) {
        const dif = G3D.difVigente(a), conDif = !!(dif && gDif && s(dif.gastoId) === gDif.id);
        const total = conDif ? M.n(dif.cotizaciones) : Number(a.total) || 0;
        const av = C.avancePlanilla(total, quedan.reduce((x, y) => x + (Number(y.monto) || 0), 0));
        tx.update(refP, sinPlanilla(cambio(a, conDif ? 'quitó un cargo del banco (deshecho) y la diferencia registrada como multas e intereses' : 'quitó un cargo del banco (deshecho)', { pagos: quedan, pagosQuitados: (Array.isArray(a.pagosQuitados) ? a.pagosQuitados : []).concat(fuera.map(x => ({ ...x, quitado: { por, en: t, motivo } }))),
          unido: av.unido, falta: av.falta, estado: av.completa ? 'pagada_conciliada' : quedan.length ? 'parcial' : 'sin_pagos', ...(av.completa ? {} : { conciliadaEl: '', conciliadaPor: '' }),
          ...(conDif ? { total, difMultas: null, difMultasQuitadas: (Array.isArray(a.difMultasQuitadas) ? a.difMultasQuitadas : []).concat([{ ...dif, quitado: { por, en: t, motivo } }]) } : {}) }, { motivo })));
        n++;
        if (conDif && snG && snG.exists() && snG.data().estado === 'vigente') { tx.update(gDif, cambio(snG.data(), 'anuló', { estado: 'anulado', anulado: { el: t, en: t, por, motivo: 'Cargo de Previred deshecho: ' + motivo, filaOriginal: '' } }, { motivo })); n++; avisos.push('La diferencia registrada como multas e intereses se anuló.'); }
      } else avisos.push('El cargo ya no estaba en la planilla: no se tocó.');
    } else avisos.push('La planilla ya no está: solo vuelve el cargo.');
    tx.update(ref, cambioCargo(sn.data(), 'deshizo', { estado: C.ESTADOS.revisar, accion: '', detalle: '', resueltoEl: '', resueltoPor: '', historial: C.conDeshecho(c, motivo, t, por) }, { motivo }));
    return { n };
  });
  if (r.yaEstaba) return { ok: true, yaEstaba: true };
  await despues(r.n);
  return { ok: true, avisos };
}
// v0.64.0 · La glosa del cargo queda en la ficha del proveedor (de la factura pagada, del gasto o el que se mostró). Sin lecturas
// nuevas: las fichas ya están en memoria. Una escritura solo si la glosa todavía no estaba.
async function aprenderGlosa(c0, p, det) {
  const k = P.claveGlosa(c0.descripcion);
  if (k.length < 6 || P.deGlosa(c0.descripcion).rut) return;
  const fichas = (await todos('proveedores')).map(x => P.vistaFicha(x.id, x.d));
  let f = p && p.proveedorId ? fichas.find(x => x.id === s(p.proveedorId)) : null;
  if (!f && det) {
    const ruts = [].concat((det.vencimientos || []).map(v => s(v.rut)), det.rut ? [s(det.rut)] : []).map(P.rutNorm).filter(Boolean);
    if (ruts.length && ruts.every(r => r === ruts[0])) f = fichas.find(x => x.rut === ruts[0]);
  }
  if (!f || f.glosas.includes(k)) return;
  const d = await dbBase();
  await FB.updateDoc(FB.doc(d, 'proveedores', f.id), { glosas: f.glosas.concat([k]).slice(-12), glosaAprendida: { glosa: k, cargo: c0.id, por: quien(), en: ahora() } });
}
// v0.64.0 · Transferencias enviadas (BancoEstado): tef_enviadas/{cuenta}_{operación}, solo los últimos 180 días; subir el
// mismo archivo otra vez no repite. L = TE.leerEnviadas(…). No pasa a la planilla (es solo para reconocer los cargos).
export async function guardarEnviadas(L, nombreArchivo) {
  if (!L || !Array.isArray(L.filas)) throw error('El archivo no trae transferencias', 'datos');
  const hoy = M.ahoraChile().dia, corte = G3.sumarDias(hoy, -TE.DIAS_GUARDAR), t = ahora(), por = quien();
  const filas = L.filas.filter(x => x.fecha >= corte), cu = L.cuenta || {};
  const ya = new Set((await todos('tef_enviadas')).map(x => x.id));
  const nuevas = filas.map(x => ({ id: TE.idEnviada(cu.numero, x), x })).filter(y => !ya.has(y.id));
  const d = await dbBase();
  for (let i = 0; i < nuevas.length; i += 400) {
    const b = FB.writeBatch(d);
    nuevas.slice(i, i + 400).forEach(({ id, x }) => b.set(FB.doc(d, 'tef_enviadas', id), limpio({ ...x, cuentaNum: s(cu.numero), cuentaTipo: cu.tipo || 'chequera', cuentaFin: s(cu.fin), cuentaTexto: s(cu.texto), archivo: C.texto(nombreArchivo, 120), subida: t, por, creado: FB.serverTimestamp() })));
    await b.commit();
  }
  return { ok: true, leidas: L.filas.length, nuevas: nuevas.length, viejas: L.filas.length - filas.length, cuenta: cu, desde: L.desde, hasta: L.hasta };
}

// ── Deshacer (ccDeshacer) ──
// v0.69.2 · opc.quitarResto: en un pago parcial con el resto registrado junto con el cargo (efectivo o tarjeta), también sale ese resto
export async function deshacer(id, motivoP, opc = {}) {
  const motivo = C.texto(motivoP, 300);
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const { d, ref, c: c0 } = await leerCargo(id);
  if (c0.estado === C.ESTADOS.revisar) return { ok: true, yaEstaba: true };
  if (c0.estado === C.ESTADOS.repetido) return deshacerRepetido(d, c0, motivo);
  if (c0.accion === C.PREVIRED) return deshacerPrevired(d, c0, motivo);
  if (c0.accion === C.PREVIRED_PLANILLA) return deshacerUnion(d, c0, motivo);
  const refTxt = '[' + c0.id + ']', det = c0.detalle || {};
  // Gastos de este cargo: por su id (hechos en la base) o por la traza (conciliados en la planilla y copiados en G1)
  const g1 = await todos('gastos', FB.where('cartolaCargo', '==', c0.id));
  const g2 = c0.accion === 'ignorar' ? [] : (await todos('gastos', FB.where('fecha', '>=', G3.sumarDias(c0.fecha || M.ahoraChile().dia, -400)))).filter(x => s(x.d.cartola).includes(refTxt));
  // v0.69.2 · Pago parcial de un documento: los gastos del documento (si ya no queda pagado, pierden su fecha de pago) y el resto
  let docG = [], refPago = null, refDocSii = null;
  if (c0.accion === C.ABONO_PARCIAL && det.abonoParcial) {
    const sv = await FB.getDoc(FB.doc(d, 'vencimientos', s(det.abonoParcial.vencimientoId)));
    if (sv.exists() && PM.esDeDocumento(sv.data())) {
      const vv = sv.data();
      if (Array.isArray(vv.gastosDoc) && vv.gastosDoc.length) docG = vv.gastosDoc.slice(0, 40).map(s);
      else { const fo = s(vv.folio) || ((/^\s*\S*\s*(.*?)\s+F\.(\d+)\s*$/.exec(s(vv.nombre)) || [])[2] || ''); if (fo) docG = (await todos('gastos', FB.where('folio', '==', fo))).filter(x => x.d.estado === 'vigente' && ['proveedor', 'tarjeta'].includes(s(x.d.formaPago)) && s(x.d.fechaPago)).map(x => x.id).slice(0, 40); }
      const rs = PM.restoDelCargo(vv, c0.id);
      if (rs && rs.pagoId && opc.quitarResto) refPago = FB.doc(d, 'sii_pagos', rs.pagoId);
      if (vv.pagoEnPartes && s(vv.pagoEnPartes.creadoPor) === c0.id && s(vv.siiDocId)) refDocSii = FB.doc(d, 'sii_docs', s(vv.siiDocId));
    }
  }
  const gIds = [...new Set(g1.concat(g2).map(x => x.id).concat(docG))];
  const vIds = c0.accion === 'vencimientos' ? (det.vencimientos || []).map(x => s(x.id)) : c0.accion === 'abono' && det.abono ? [s(det.abono.vencimientoId)] : c0.accion === C.ABONO_PARCIAL && det.abonoParcial ? [s(det.abonoParcial.vencimientoId)] : c0.accion === 'gasto' ? (det.vencimientosLigados || []).map(s) : [];
  const t = ahora(), por = quien(), avisos = [];
  if (c0.estado === C.ESTADOS.aMedias) avisos.push('Estaba a medias: revisa en Registrados que no haya quedado un gasto de este cargo sin la cartola (si lo hay, anúlalo).');
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Ese cargo ya no está', 'datos');
    const c = C.vistaCargo(sn.id, sn.data()); if (c.estado === C.ESTADOS.revisar) return { yaEstaba: true };
    const refsV = vIds.map(x => FB.doc(d, 'vencimientos', x)), snV = [];
    for (const rv of refsV) snV.push(await tx.get(rv));
    const refsG = gIds.map(x => FB.doc(d, 'gastos', x)), snG = [];
    for (const rg of refsG) snG.push(await tx.get(rg));
    const desap = C.aDesaprender(c), R = desap ? await leerRegla(tx, d, c.clave) : null;
    const RCo = desap && R && R.conc && R.conc.exacta.act ? R.conc.exacta : null;   // v0.69.0: la regla exacta de esa glosa
    // v0.69.2 · Pago parcial de un documento: qué partes salen (el cargo y, si se pidió, el resto registrado con él), antes de escribir
    const snPago = refPago ? await tx.get(refPago) : null, snDocSii = refDocSii ? await tx.get(refDocSii) : null;
    let qp = null;
    const esp = new Map();
    if (c.accion === C.ABONO_PARCIAL && snV[0] && snV[0].exists() && PM.esDeDocumento(snV[0].data())) {
      const a = snV[0].data(), q = PM.quitarPartes(a, c.id, !!opc.quitarResto, { por, en: t, motivo });
      if (q.error) avisos.push(`El abono ya no estaba en "${s(a.nombre)}": no se tocó.`);
      else {
        const creado = !!(a.pagoEnPartes && s(a.pagoEnPartes.creadoPor) === c.id && q.vacio);
        qp = { a, q, creado };
        if (creado) (a.pagoEnPartes.antes || []).forEach(x => esp.set(s(x.id), { que: 'vuelve a como estaba (deshecho el pago en partes)', campos: { ...PM.camposGastoAntes(x), cartola: '', cartolaCargo: '' } }));
        else if (q.cerraba) docG.forEach(id => esp.set(s(id), { que: 'pago en partes deshecho: vuelve a tener saldo', campos: { fechaPago: '', pagoMixto: null }, cc: true }));
      }
    }
    let n = 1;
    const anulado = { el: t, en: t, por, motivo: `Deshecho en la conciliación de la cartola (${c.id}): ${motivo}`, filaOriginal: '' };
    // Vencimientos pagados con este cargo: vuelven por pagar (con el reparto estimado de antes)
    if (c.accion === 'vencimientos') (det.vencimientos || []).forEach((x, i) => {
      const s0 = snV[i]; if (!s0 || !s0.exists()) { avisos.push(`"${x.nombre}" ya no existe: no se tocó.`); return; }
      const a = s0.data();
      // v0.70.0 · Un abono de este cargo (lo nacido de su boleta, pagado en partes): sale (queda en abonosQuitados)
      if (x.abono) {
        const q = G3.quitarAbonoParcial(a, c.id, { por, en: t, motivo });
        if (q.error) { avisos.push(`El abono ya no estaba en "${x.nombre}": no se tocó.`); return; }
        tx.update(refsV[i], cambio(a, 'abono deshecho (cartola)', q.campos, { motivo })); n++;
        return;
      }
      if (G3.estadoBase(a) !== 'pagado' || !(s(a.cartolaCargo) === c.id || s(a.cartola).includes(refTxt))) { avisos.push(`"${x.nombre}" ya no estaba pagado con este cargo: no se tocó.`); return; }
      const espera = s(a.tipoObligacion) === 'documento' && !a.documento;
      tx.update(refsV[i], cambio(a, 'pago deshecho (cartola)', { estado: espera ? 'esperando_documento' : 'por_pagar', fechaPago: '', montoPago: '', cartola: '', cartolaCargo: '', pago: null,
        ...(x.multiAntes != null ? { multiArea: x.multiAntes } : {}), obsPago: (`Pago deshecho ${t.slice(0, 10)} · ${por} · ${motivo} · antes: ${s(a.obsPago)}`).slice(0, 500) }, { motivo }));
      n++;
    });
    // v0.63.1: el vencimiento pagado a mano que solo se confirmó con este cargo: pierde la cartola (sigue pagado)
    if (c.accion === 'gasto') snV.forEach((s0, i) => { if (!s0 || !s0.exists()) return; const a = s0.data(); if (s(a.cartolaCargo) !== c.id) return; tx.update(refsV[i], cambio(a, 'sin cartola (deshecho)', { cartola: '', cartolaCargo: '' }, { motivo })); n++; });
    // Abono: sale del vencimiento (queda en abonosQuitados)
    if (c.accion === 'abono' && snV[0] && snV[0].exists()) {
      const a = snV[0].data();
      if (G3.estadoBase(a) === 'pagado') throw error(`"${s(a.nombre)}" ya se cerró: déjalo por pagar de nuevo en Por pagar y vuelve a deshacer.`, 'datos');
      const l = Array.isArray(a.abonos) ? a.abonos : [], fuera = l.filter(y => y.cargoId === c.id), quedan = l.filter(y => y.cargoId !== c.id);
      if (fuera.length) {
        tx.update(refsV[0], cambio(a, 'abono deshecho (cartola)', { abonos: quedan, estado: quedan.length ? 'con_abonos' : 'por_pagar',
          abonosQuitados: (Array.isArray(a.abonosQuitados) ? a.abonosQuitados : []).concat(fuera.map(y => ({ ...y, quitado: { por, en: t, motivo } }))) }, { motivo }));
        n++;
      } else avisos.push(`El abono ya no estaba en "${s(a.nombre)}": no se tocó.`);
    }
    // v0.64.0 · Abono parcial: sale del vencimiento (queda en abonosQuitados); si era el primero, su gasto completo se anula
    if (qp) {
      const campos = qp.creado ? { ...qp.q.campos, estado: 'anulado', anulado: { por, en: t, motivo: `Deshecho el pago en partes (${c.id}): ${motivo}` } } : qp.q.campos;
      tx.update(refsV[0], cambio(qp.a, qp.creado ? 'anulado: se deshizo el pago en partes (cartola)' : 'abono parcial deshecho (cartola)', campos, { motivo, quitadas: qp.q.quitadas.length })); n++;
      // El resto en efectivo o con tarjeta que salió junto con el cargo: su pago guardado queda quitado (con su historial)
      if (snPago && snPago.exists() && qp.q.quitadas.some(y => y.pagoId && y.pagoId === refPago.id) && !snPago.data().quitado) {
        const pa = snPago.data(); tx.update(refPago, limpio({ quitado: { por, en: t, motivo }, historial: (Array.isArray(pa.historial) ? pa.historial : []).concat([{ que: 'quitado (se deshizo el cargo con que se registró)', por, en: t, motivo }]) }));
      }
      // Su documento del SII vuelve a no tener vencimiento
      if (qp.creado && snDocSii && snDocSii.exists() && snDocSii.data().importado) { const sd = snDocSii.data(); tx.update(refDocSii, cambio(sd, 'pago en partes deshecho', { importado: { ...sd.importado, vencimiento: s((qp.a.pagoEnPartes.siiDocAntes || {}).vencimiento) } }, { motivo })); n++; }
    } else if (c.accion === C.ABONO_PARCIAL && snV[0] && snV[0].exists()) {
      const a = snV[0].data(), q = G3.quitarAbonoParcial(a, c.id, { por, en: t, motivo });
      if (q.error === 'El abono ya no estaba') avisos.push(`El abono ya no estaba en "${s(a.nombre)}": no se tocó.`);
      else if (q.error) throw error(q.error, 'datos');
      else { tx.update(refsV[0], cambio(a, 'abono parcial deshecho (cartola)', q.campos, { motivo })); n++; }
    }
    // Gastos: "ya estaba" solo pierde la cartola; a crédito vuelve sin fecha de pago; lo creado aquí queda anulado
    snG.forEach((sg, i) => {
      if (!sg.exists()) return; const g = sg.data(); if (g.estado !== 'vigente') return;
      // v0.69.2 · Los gastos de un documento pagado en partes: vuelven a como estaban o pierden la fecha de pago (nunca se anulan)
      const e = esp.get(refsG[i].id);
      if (e) { tx.update(refsG[i], cambio(g, e.que, { ...e.campos, ...(e.cc && s(g.cartolaCargo) ? { cartola: '', cartolaCargo: '' } : {}) }, { motivo })); n++; return; }
      if (docG.includes(refsG[i].id) && !s(g.cartolaCargo).includes(c.id)) return;   // del documento, sin nada de este cargo
      const forma = s(g.formaPago);
      // v0.63.1: lo que esperaba su cargo vuelve a esperarlo; la fecha de pago puesta al vincular se quita
      if (c.accion === 'gasto') tx.update(refsG[i], cambio(g, 'sin cartola (deshecho)', { cartola: '', cartolaCargo: '', ...((det.esperaban || []).includes(refsG[i].id) ? { esperaCargo: true } : {}), ...((det.conFechaPago || []).includes(refsG[i].id) ? { fechaPago: '', ...(g.medioPago === 'banco' && g.siiDoc && s(g.formaPago) === 'contado' ? { esperaPago: true, medioPago: '' } : {}) } : {}) }, { motivo }));
      else if (forma === 'proveedor' || forma === 'tarjeta') tx.update(refsG[i], cambio(g, 'pago deshecho (cartola)', { fechaPago: '', cartola: '', cartolaCargo: '' }, { motivo }));
      else tx.update(refsG[i], cambio(g, 'anuló', { estado: 'anulado', anulado }, { motivo: anulado.motivo }));
      n++;
    });
    tx.update(ref, cambioCargo(sn.data(), 'deshizo', { estado: C.ESTADOS.revisar, accion: '', detalle: '', resueltoEl: '', resueltoPor: '', historial: C.conDeshecho(c, motivo, t, por) }, { motivo }));
    if (R && R.sn.exists()) { const x = C.desaprender(R.act, desap, t, por); if (x) { tx.update(R.ref, cambio(R.sn.data(), 'olvidó (deshecho)', x)); n++; } }
    if (RCo && RC.claveRes(RCo.act.res).split('|')[0] === ({ gasto: 'nuevo', vencimiento: 'venc' }[desap] || desap)) { const x = RC.olvidada(RCo.act, por, t, motivo); if (x) { tx.set(RCo.ref, limpio(RC.aDoc(x))); n++; } }
    return { n };
  });
  if (r.yaEstaba) return { ok: true, yaEstaba: true };
  await despues(r.n);
  return { ok: true, avisos };
}

// v0.67.6 · Deshacer un "Repetido": vuelve a "Para revisar" como un cargo normal y queda anotado que NO es repetido de ese
// original (noRepetidoDe): no se vuelve a marcar solo ni a proponer con él. No había nada en Gastos. 1 lectura y 1 escritura.
async function deshacerRepetido(d, c0, motivo) {
  const ref = FB.doc(d, 'cartola_cargos', s(c0.docId || c0.id)), t = ahora(), por = quien();
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Ese cargo ya no está', 'datos');
    const a = sn.data(), c = C.vistaCargo(sn.id, a);
    if (c.estado !== C.ESTADOS.repetido) return { yaEstaba: true };
    const no = [...new Set(c.noRepetidoDe.concat(c.repetidoDe ? [c.repetidoDe] : []))].slice(-20);
    tx.update(ref, cambioCargo(a, 'deshizo (no es repetido)', { estado: C.ESTADOS.revisar, accion: '', detalle: '', repetidoDe: '', noRepetidoDe: no, resueltoEl: '', resueltoPor: '', historial: C.conDeshecho(c, motivo, t, por) }, { motivo }));
    return { n: 1 };
  });
  if (r.yaEstaba) return { ok: true, yaEstaba: true };
  await despues(r.n);
  return { ok: true, avisos: [] };
}
// v0.64.0 · Deshacer un pago de Previred: vuelven a revisar TODOS los cargos del grupo, el vencimiento queda por pagar y los gastos
// por trabajador quedan anulados (no se borran)
async function deshacerPrevired(d, c0, motivo) {
  const g = (c0.detalle && c0.detalle.previred) || {}, ids = [...new Set([c0.id].concat((g.cargos || []).map(x => s(x.id))))].slice(0, 12);
  const t = ahora(), por = quien(), avisos = [];
  const r = await FB.runTransaction(d, async tx => {
    const refsC = ids.map(x => FB.doc(d, 'cartola_cargos', x)), snC = [];
    for (const rf of refsC) snC.push(await tx.get(rf));
    const refV = g.vencimientoId ? FB.doc(d, 'vencimientos', s(g.vencimientoId)) : null, snV = refV ? await tx.get(refV) : null;
    const refsG = (g.gastos || []).map(x => FB.doc(d, 'gastos', s(x))), snG = [];
    for (const rg of refsG) snG.push(await tx.get(rg));
    const cs = snC.map(sn => (sn.exists() ? C.vistaCargo(sn.id, sn.data()) : null));
    const Rs = []; for (const c of cs) Rs.push(c && c.accion === C.PREVIRED ? await leerRegla(tx, d, c.clave) : null);
    let n = 0;
    const anulado = { el: t, en: t, por, motivo: `Deshecho en la conciliación de la cartola (Previred ${c0.id}): ${motivo}`, filaOriginal: '' };
    snG.forEach((sg, i) => { if (!sg.exists() || sg.data().estado !== 'vigente') return; tx.update(refsG[i], cambio(sg.data(), 'anuló', { estado: 'anulado', anulado }, { motivo: anulado.motivo })); n++; });
    if (snV && snV.exists()) {
      const a = snV.data();
      if (G3.estadoBase(a) === 'pagado' && s(a.cartolaCargo) && ids.includes(s(a.cartolaCargo))) { tx.update(refV, cambio(a, 'pago deshecho (cartola, Previred)', { estado: 'por_pagar', fechaPago: '', montoPago: '', cartola: '', cartolaCargo: '', pago: null, obsPago: (`Pago deshecho ${t.slice(0, 10)} · ${por} · ${motivo}`).slice(0, 500) }, { motivo })); n++; }
      else avisos.push(`"${s(a.nombre)}" ya no estaba pagado con estos cargos: no se tocó.`);
    }
    const olvidadas = new Set();
    cs.forEach((c, i) => {
      if (!c || c.estado === C.ESTADOS.revisar || c.accion !== C.PREVIRED) return;
      tx.update(refsC[i], cambioCargo(snC[i].data(), 'deshizo', { estado: C.ESTADOS.revisar, accion: '', detalle: '', resueltoEl: '', resueltoPor: '', historial: C.conDeshecho(c, motivo, t, por) }, { motivo })); n++;
      const R = Rs[i]; if (R && R.sn.exists() && !olvidadas.has(c.clave)) { olvidadas.add(c.clave); const x = C.desaprender(R.act, C.PREVIRED, t, por); if (x) { tx.update(R.ref, cambio(R.sn.data(), 'olvidó (deshecho)', x)); n++; } }
    });
    return { n };
  });
  await despues(r.n);
  return { ok: true, avisos: [`Volvieron a revisar ${ids.length} ${ids.length === 1 ? 'cargo' : 'cargos'} del pago de Previred.`].concat(avisos) };
}

// Quitar lo aprendido (en la base no se borra: queda quitada, con quién y cuándo)
export async function quitarRegla(clave) {
  const d = await dbBase(), lista = await todos('cartola_reglas'), x = lista.find(y => s(y.d.clave) === s(clave) && !(y.d.quitada && s(y.d.quitada)));
  if (!x) return { ok: true, yaEstaba: true };
  const ref = FB.doc(d, 'cartola_reglas', x.id);
  await FB.runTransaction(d, async tx => { const sn = await tx.get(ref); tx.update(ref, cambio(sn.data(), 'quitó', { veces: 0, quitada: `${ahora()} · ${quien()}` })); });
  await despues(1);
  // v0.69.0 · Con las reglas migradas, la regla exacta de esa glosa queda archivada (no se borra)
  if (concOk) { try { await guardarReglaConc({ que: 'estado', id: RC.idExacta('cargo', s(clave)), estado: 'archivada', motivo: 'Quitada desde lo aprendido' }); } catch (e) {} }
  return { ok: true };
}

// ═══════════════════════════════════════════════
//  v0.64.0 · Proveedores (Gastos → Proveedores): lista, detalle y fichas a mano. Todo desde la memoria.
// ═══════════════════════════════════════════════
export async function proveedoresLista() {
  const hoy = M.ahoraChile().dia;
  const [provs, ab, gastos, cg, cat] = await Promise.all([todos('proveedores'), abiertos(), todos('gastos', FB.where('fecha', '>=', G3.sumarDias(hoy, -400))), todos('cartola_cargos'), FS.catalogo()]);
  const fichas = provs.map(x => P.vistaFicha(x.id, x.d)).filter(f => !f.archivado);
  const cargos = cg.filter(x => !x.d.quitadoEnPlanilla).map(x => C.vistaCargo(x.id, x.d)), porCargo = {};
  cargos.forEach(c => { porCargo[c.id] = c; });
  // Gastos por RUT de proveedor (los vinculados a un cargo son los pagos por banco)
  const gPorRut = {};
  gastos.forEach(({ id, d }) => { if (d.estado !== 'vigente') return; const r = P.rutNorm(d.rutProveedor); if (r) (gPorRut[r] = gPorRut[r] || []).push({ id, d }); });
  const out = fichas.map(f => {
    const q = P.loQueLeCompras(f, 5), pend = ab.lista.filter(v => !v.plantillaId && f.rut && v.rut === f.rut);
    const ligados = new Map();
    (gPorRut[f.rut] || []).forEach(({ d }) => { const k = s(d.cartolaCargo); if (k && porCargo[k] && !ligados.has(k)) ligados.set(k, porCargo[k]); });
    cargos.forEach(c => { if (c.estado === C.ESTADOS.revisar || c.estado === C.ESTADOS.repetido || ligados.has(c.id)) return; const det = c.detalle || {};
      if ((f.rut && ((det.vencimientos || []).some(v => P.rutNorm(v.rut) === f.rut) || P.deGlosa(c.descripcion).rut === f.rut)) || f.glosas.includes(P.claveGlosa(c.descripcion))) ligados.set(c.id, c); });
    const pagos = [...ligados.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 12).map(c => ({ id: c.id, fecha: c.fecha, monto: c.monto, descripcion: c.descripcion, accion: c.accion }));
    return { ...f, filas: undefined, prods: undefined, nFacturas: P.ultimasFacturas(f, 999).length, facturas: P.ultimasFacturas(f, 8), pendientes: pend.map(v => ({ id: v.id, nombre: v.nombre, fecha: v.fecha, monto: v.monto, saldo: v.saldo, estadoBase: v.estadoBase, folio: v.folio })),
      productos: q.productos, items: q.items, pagos, resumen: P.resumen(f) };
  }).sort((a, b) => s(b.ultima).localeCompare(s(a.ultima)) || a.nombre.localeCompare(b.nombre));
  return { ok: true, proveedores: out, items: cat.lista.filter(i => !i.archivado).map(i => i.item), areas: M.AREAS.slice() };
}
// Crear o editar una ficha a mano: { id (al editar), nombre, rut, glosas (texto o lista), item, area }. No pasa a la planilla.
export async function guardarFicha(p) {
  const cat = await FS.catalogo(), x = P.limpiarFicha(p || {}, cat.lista.filter(i => !i.archivado).map(i => i.item), M.AREAS);
  if (x.error) throw error(x.error, 'datos');
  const d = await dbBase(), id = s(p.id) || P.idFicha(x.campos.rut, x.campos.nombre), ref = FB.doc(d, 'proveedores', id), t = ahora(), por = quien();
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), a = sn.exists() ? sn.data() : null;
    if (!a && p.id) throw error('Esa ficha ya no está', 'datos');
    if (!a && !p.id && sn.exists()) throw error('Ya hay una ficha con ese nombre: ábrela y edítala', 'datos');
    const campos = { ...x.campos, ...(a && a.razonSocial ? {} : { razonSocial: x.campos.nombre }), ...(a && !x.campos.rut && a.rut ? { rut: a.rut, rutTexto: a.rutTexto || '' } : {}) };
    const h = M.conHistorial(a && a.historial, { que: a ? 'editó (a mano)' : 'creó (a mano)', por, en: t, cambios: M.diferencias(a, campos) });
    if (a) tx.update(ref, limpio({ ...campos, version: (Number(a.version) || 0) + 1, historial: h, actualizado: { en: FB.serverTimestamp(), por, que: 'editó a mano' } }));
    else tx.set(ref, limpio({ ...campos, filas: [], prods: [], creado: { por, en: FB.serverTimestamp() }, version: 0, historial: h, actualizado: { en: FB.serverTimestamp(), por, que: 'creó a mano' } }));
    return { nuevo: !a };
  });
  return { ok: true, id, ...r };
}
