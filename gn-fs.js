// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos nuevo (desde cero), base fen-gastos  v0.90.0 · Etapa 1: base y carga
//  Colecciones nuevas, que nacen vacías: gn_documentos, gn_movimientos y gn_cargas (reglas en gn-modelo.js).
//  Lo de antes (gastos, vencimientos, cartola_cargos, sii_docs…) no se toca ni se lee aquí.
//  · Todo pasa por fs-gastos.js (memoria de la sesión y cuidado de la cuota): abrir la Bandeja otra vez no vuelve a leer todo.
//  · Escribir es "agregar lo que falta" (set con merge de los campos que vienen del archivo): si otro equipo ya lo había
//    guardado, no se pierde nada de lo que se le agregó después (clasificación, pagos, notas). Nada se borra.
//  · Sin la marca de la planilla (planillaPendiente): lo nuevo ya no se copia a la planilla de Google.
//  v0.91.0 · Etapa 2: gn_pagos (lo único que crea Confirmar), gn_proveedores (la clasificación que recuerda cada proveedor) y
//  gn_config/sugerencias (lo que sugiere el Gastos anterior, armado UNA vez leyendo sus gastos; después se lee un solo documento).
//  Cada cambio en un documento o movimiento queda en su "historial" (qué, quién, cuándo). Deshacer no borra: el pago queda "deshecho".
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import { dbBase, correo } from './gastos-fs.js?v=0.138.0';
import { ahoraChile } from './gastos-g2.js?v=0.138.0';
import * as GN from './gn-modelo.js?v=0.138.0';
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as GP from './gn-pdf.js?v=0.138.0';
import * as GI from './gn-items.js?v=0.138.0';
import * as TR from './trabajadores.js?v=0.138.0';
import * as GT from './tributario.js?v=0.138.0';   // v0.108.0

const quien = () => correo() || 'Sistema Fën';
const todos = async col => { const d = await dbBase(); return (await FB.getDocs(FB.collection(d, col))).docs.map(x => ({ id: x.id, ...x.data() })); };
function limpio(v) {
  if (Array.isArray(v)) return v.map(limpio);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) { const o = {}; Object.entries(v).forEach(([k, x]) => { if (x !== undefined) o[k] = limpio(x); }); return o; }
  return v;
}
const inicio = () => (typeof window !== 'undefined' && window.FEN_SIS && window.FEN_SIS.INICIO) || '2026-10-01';

// ── Lecturas ──
export async function leer() {
  // v0.102.0 · El catálogo de ítems (gn_items). Mientras no se pase al catálogo nuevo, la lista de siempre (la del Gastos anterior) se sigue leyendo.
  let cat = await todos(GI.COL); const conCat = GI.activo(cat);   // si no se puede leer, Gastos avisa el error (no vuelve en silencio a la lista antigua)
  // v0.103.0 · Los ítems que agrega una versión nueva (por ejemplo FLETE DE COMPRA) se crean solos, una vez, con su historial
  if (conCat) { const f = GI.faltantes(cat); if (f.length) { try { const d = await dbBase(), b = FB.writeBatch(d), h = { por: quien(), en: ahoraChile().texto };
    f.forEach(x => b.set(FB.doc(d, GI.COL, x.clave), limpio({ nombre: x.nombre, grupo: x.grupo, cuenta: x.cuenta, estado: 'activo', sistema: x.sistema, elegible: !!x.elegible, area: '', creado: h, historial: [{ que: 'agregado al catálogo por la v0.103.0', ...h }] }), { merge: true }));
    await b.commit(); cat = await todos(GI.COL); } catch (e) { /* sin permiso o sin red: se intenta en la próxima lectura */ } } }
  const [docs0, movs, cargas, pagos, provs, cfg, items, reps0, comps, creds] = await Promise.all([todos(GN.COL.docs), todos(GN.COL.movs), todos(GN.COL.cargas), todos(GN.COL.pagos), todos(GN.COL.provs), todos(GN.COL.config), conCat ? Promise.resolve([]) : todos('items').catch(() => []), todos(GN.COL.repartos), todos(GN.COL.compromisos).catch(() => []), todos(GN.COL.creditos).catch(() => [])]);
  // v0.96.0 · Los compromisos crean el documento del mes cuando el mes empieza (una vez: después ya está)
  let docs = docs0; const hoyCl = ahoraChile().dia, faltan = GB.compromisosPendientes(comps, docs0, inicio(), hoyCl)
    .concat(GB.cuotasPendientes(creds.map(cr => ({ ...cr, cuotas: GP.separarCuotas(cr.cuotas || [], cr.montoOriginal, cr.tasa) })), docs0, inicio(), hoyCl, c => GP.partesCuota(c)));   // v0.124.5: ya separadas (tabla real o estimado)   // v0.97.0: y la cuota de cada crédito, el mes en que vence
  if (faltan.length) { try { await escribir(GN.COL.docs, faltan, nuevoExtra('compromiso', 'sistema', ahoraChile().texto)); docs = docs0.concat(faltan.map(d => ({ ...d, ...nuevoExtra('compromiso', 'sistema', '') }))); } catch (e) { /* sin permiso o sin red: se intenta en la próxima lectura */ } }
  // v0.101.1 · Desde cero en octubre: el Gastos anterior ya no se lee. Las sugerencias que se armaron con él (una vez) quedan guardadas y se
  // siguen usando; si no existen, no se arman. El índice "¿ya está en el Gastos anterior?" (gastosAnteriores) ya no se usa.
  const sug = cfg.find(x => x.id === 'sugerencias') || { porProveedor: {} };
  // v0.102.0 · Con el catálogo, lo sugerido usa el ítem que cuenta (un nombre antiguo pasa al nuevo); lo que no tiene ítem activo no se sugiere
  const I = conCat ? GI.indice(cat) : null, sugeridas = !I ? (sug.porProveedor || {}) : Object.fromEntries(Object.entries(sug.porProveedor || {}).map(([k, v]) => { const r = v && GI.resolver(v.item, I); return r && r.ok ? [k, { ...v, item: r.nombre }] : null; }).filter(Boolean));
  // v0.96.0 · Los repartos iniciales se crean la primera vez (una sola vez: si ya hay alguno, no se toca)
  let reps = reps0;
  if (!reps.length) { try { await crearRepartosIniciales(); reps = await todos(GN.COL.repartos); } catch (e) { reps = []; } }
  // v0.100.0 · El resumen para Hoy y la Agenda (un documento): se guarda solo si cambió
  try { const D0 = { docs, movs, pagos, provs: Object.fromEntries(provs.map(p => [p.id, p])), repartos: Object.fromEntries(reps.map(r => [r.id, r])) }, R = { ...GB.resumenHoy(GB.armar(D0, {}), D0, hoyCl), contratos: TR.avisosContratos(D0, hoyCl), cartolaEn: cargas.filter(c => c.tipo === 'bancoestado' || c.tipo === 'mercadopago').map(c => String(c.en || '').slice(0, 10)).sort().pop() || '' }, prev = cfg.find(x => x.id === 'resumen');
    const sin = o => JSON.stringify({ ...(o || {}), dia: '', _m: null, id: null });
    if (!prev || sin(prev) !== sin(R) || prev.dia !== R.dia) { const dd = await dbBase(), b = FB.writeBatch(dd); b.set(FB.doc(dd, GN.COL.config, 'resumen'), R); await b.commit(); } } catch (e) { /* el resumen es solo un aviso */ }
  return { docs, movs, cargas: cargas.sort((a, b) => String(b.en || '').localeCompare(String(a.en || ''))), pagos, provs: Object.fromEntries(provs.map(p => [p.id, p])),
    creditos: creds.map(cr => ({ ...cr, cuotas: GP.separarCuotas(cr.cuotas || [], cr.montoOriginal, cr.tasa) })), compromisos: comps.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))), sugeridas, items: conCat ? GI.paraElegir(cat) : itemsConUsados(itemsDe(items), docs, provs, comps), catalogo: cat, itemsViejos: conCat ? [] : items.filter(x => x.item && !x.quitadoEnPlanilla).map(x => ({ item: String(x.item), archivado: !!x.archivado || x.estado === 'ARCHIVADO' })),
    repartos: Object.fromEntries(reps.filter(r => r.estado !== 'archivado').map(r => [r.id, r])), inicio: inicio(),
    tributario: (({ id, _m, ...x }) => x)(cfg.find(x => x.id === 'tributario') || {}) };   // v0.108.0
}
// v0.99.0 · La lista de ítems para clasificar: el catálogo de siempre y, después, los que ya se usaron en el Gastos nuevo (clasificaciones,
// fichas, productos y compromisos) aunque no estén en el catálogo: así un ítem nuevo se reutiliza igual. En la Etapa 4 pasan al catálogo nuevo.
function itemsConUsados(cat, docs, provs, comps) {
  const ya = new Set(cat.map(x => x.item.toUpperCase())), extra = new Set(), ag = v => { const t = String(v || '').trim(); if (t && !ya.has(t.toUpperCase())) extra.add(t); };
  (docs || []).forEach(d => ((d.clasif && d.clasif.partes) || []).forEach(p => ag(p.item)));
  (provs || []).forEach(p => { ag(p.item); Object.values(p.productos || {}).forEach(x => ag(x && x.item)); });
  (comps || []).forEach(c => ag(c.item));
  return cat.concat([...extra].sort().map(item => ({ item, area: '', usado: true })));
}
// El catálogo de ítems de siempre (Configuración → Ítems): los vivos, en su orden
const itemsDe = l => l.filter(x => x.item && !x.archivado && !x.quitadoEnPlanilla && x.estado !== 'ARCHIVADO').sort((a, b) => (Number(a.orden) || 999) - (Number(b.orden) || 999)).map(x => ({ item: String(x.item), area: String(x.area || '') }))
  .filter((x, i, a) => a.findIndex(y => y.item === x.item) === i);
async function crearRepartosIniciales() {
  const d = await dbBase(), b = FB.writeBatch(d), h = { por: quien(), en: ahoraChile().texto };
  GB.REPARTOS_INICIALES.forEach(r => b.set(FB.doc(d, GN.COL.repartos, r.id), { nombre: r.nombre, areas: r.areas, estado: 'activo', creado: h, historial: [{ que: 'creado (repartos iniciales acordados el 23 oct)', ...h }] }));
  await b.commit();
}


// ── Escrituras ──
async function escribir(col, lista, extra) {
  const d = await dbBase();
  for (let i = 0; i < lista.length; i += 400) {
    const b = FB.writeBatch(d);
    lista.slice(i, i + 400).forEach(x => { const { id, ...resto } = x; b.set(FB.doc(d, col, id), limpio({ ...resto, ...extra }), { merge: true }); });
    await b.commit();
  }
}
async function guardarCarga(k) {
  const d = await dbBase(), b = FB.writeBatch(d);
  b.set(FB.doc(d, GN.COL.cargas, k.id), limpio({ ...k, id: undefined, creadoEn: FB.serverTimestamp() }));
  await b.commit();
}
const nuevoExtra = (cargaId, por, en) => ({ estado: 'vigente', creado: { por, en, carga: cargaId }, version: 0 });

// Compras del SII ya leídas (sii.leer): { facturas, omitidas, formato }
export async function cargarSii(L, archivo) {
  const ya = await todos(GN.COL.docs), por = quien(), en = ahoraChile().texto, id = GN.idCarga('sii');
  const P = GN.planDocs(L.facturas, ya, inicio(), id);
  await escribir(GN.COL.docs, P.nuevos.map(d => ({ ...d, formato: L.formato || '' })), nuevoExtra(id, por, en));
  if (P.completar.length) await escribir(GN.COL.docs, P.completar, {});   // v0.90.2: solo el detalle (y lo que faltaba): nada más se toca
  const fechas = (L.facturas || []).map(f => GN.aIso(f.fecha)).filter(Boolean).sort();
  const k = { id, tipo: 'sii', archivo: String(archivo.nombre || '').slice(0, 120), tamano: Number(archivo.tamano) || 0, formato: L.formato || '', desde: fechas[0] || '', hasta: fechas[fechas.length - 1] || '',
    leidos: P.leidos, nuevos: P.nuevos.length, yaEstaban: P.yaEstaban, completados: P.completar.length, anteriores: P.anteriores, antiguos: P.antiguos, guias: (L.omitidas || []).length, por, en };
  await guardarCarga(k);
  return { ...k, plan: P };
}
// v0.96.0 · Una boleta de luz o agua ya armada (GN.docDeBoleta): entra una sola vez (empresa + N° de boleta)
export async function cargarBoleta(doc, archivo) {
  const ya = await todos(GN.COL.docs), por = quien(), en = ahoraChile().texto, P = GN.planBoleta(doc, ya, inicio());
  if (P.doc) await escribir(GN.COL.docs, [P.doc], nuevoExtra(doc.cargaId, por, en));
  const k = { id: doc.cargaId, tipo: 'boleta', archivo: String(archivo.nombre || '').slice(0, 120), tamano: Number(archivo.tamano) || 0, identificador: `${doc.razon} N° ${doc.folio} · cliente ${doc.cliente}`,
    desde: doc.fecha, hasta: doc.fecha, leidos: 1, nuevos: P.doc ? 1 : 0, yaEstaban: P.que === 'ya' ? 1 : 0, anteriores: P.que === 'anterior' ? 1 : 0, que: P.que, por, en };
  await guardarCarga(k);
  return k;
}
// v0.96.0 · Liquidación de sueldo o F29 ya armados (gn-pdf.js): entran una sola vez; uno distinto con la misma clave no se pisa;
// el F29 que estaba como certificado se completa con el formulario (su reparto por código)
export async function cargarPdf(doc, archivo, tipo) {
  const ya = await todos(GN.COL.docs), por = quien(), en = ahoraChile().texto, P = GP.planPdf(doc, ya, inicio());
  if (P.doc) await escribir(GN.COL.docs, [P.doc], nuevoExtra(doc.cargaId, por, en));
  if (P.que === 'completar') await enTransaccion(async (tx, d) => { const ref = FB.doc(d, GN.COL.docs, doc.id), sn = await tx.get(ref); const a = sn.data();
    tx.update(ref, { ...P.cambios, historial: conHist(a, marca('completado con el formulario del F29')) }); });
  const k = { id: doc.cargaId, tipo, archivo: String(archivo.nombre || '').slice(0, 120), tamano: Number(archivo.tamano) || 0, identificador: `${doc.tipoTexto} · ${doc.razon}`,
    desde: doc.fecha, hasta: doc.fecha, leidos: 1, nuevos: P.doc ? 1 : 0, yaEstaban: ['ya', 'distinta'].includes(P.que) ? 1 : 0, anteriores: P.que === 'anterior' ? 1 : 0, que: P.que, texto: GP.textoPlanPdf(P), por, en };
  await guardarCarga(k);
  return k;
}
// Movimientos ya armados (GN.movsDeCartola / GN.movsDeMP) con el id de su carga
export async function cargarMovs(tipo, movs, meta) {
  const ya = await todos(GN.COL.movs), por = quien(), en = ahoraChile().texto;
  const P = GN.planMovs(movs, ya, inicio());
  await escribir(GN.COL.movs, P.nuevos, nuevoExtra(meta.id, por, en));
  const k = { id: meta.id, tipo, archivo: String(meta.archivo || '').slice(0, 120), tamano: Number(meta.tamano) || 0, identificador: String(meta.identificador || '').slice(0, 120),
    desde: meta.desde || '', hasta: meta.hasta || '', cuentas: [...new Set(movs.map(m => m.cuenta))], leidos: P.leidos, nuevos: P.nuevos.length, yaEstaban: P.yaEstaban,
    parecidos: P.parecidos.length, parecidosLista: P.parecidos.slice(0, 50), antes: P.antes, anteriores: P.anteriores, traspasos: P.nuevos.filter(m => m.naturaleza === 'traspaso').length, por, en };
  // v0.105.0 · El cuadre de saldo de la cartola (GN.cuadreCartola) y lo que salió desde el inicio, para compararlo con lo que está en Gastos
  if (meta.cuadre) { const ini = inicio(); k.cuadre = { ...meta.cuadre, inicio: ini, cargosDesde: movs.filter(m => m.fecha >= ini).reduce((a, m) => a + (Number(m.monto) || 0), 0) }; }
  if (meta.saldoFinal && Number.isFinite(Number(meta.saldoFinal.monto))) k.saldoFinal = { fecha: String(meta.saldoFinal.fecha || ''), hora: String(meta.saldoFinal.hora || ''), monto: Math.round(Number(meta.saldoFinal.monto)) };   // v0.128.1 · Mercado Pago
  await guardarCarga(k);
  return { ...k, plan: P };
}

// ═══════════════ v0.91.0 · Etapa 2: unir, clasificar y lo que no va ═══════════════
const marca = (que, extra) => ({ que, por: quien(), en: ahoraChile().texto, ...(extra || {}) });
const conHist = (a, h) => (Array.isArray(a && a.historial) ? a.historial : []).concat([h]).slice(-40);
const error = (msg, code) => Object.assign(new Error(msg), { code });
// Lee lo último de cada documento y movimiento tocado (dentro de una transacción) para no pisar un cambio de otra pestaña
async function enTransaccion(fn) { const d = await dbBase(); return FB.runTransaction(d, tx => fn(tx, d)); }
// La seña aprendida en la ficha del proveedor: una vez cada seña; recuerda con qué movimiento se aprendió (para olvidarla al deshacer)
function conGlosa(prev, doc, sena, movId, h) {
  const gl = (prev && Array.isArray(prev.glosas) ? prev.glosas : []).filter(g => g && g.sena);
  const base = prev ? {} : { rut: doc.rut || '', razon: doc.razon || '' };
  if (gl.some(g => g.sena === sena)) return { ...base, glosas: gl };
  return { ...base, glosas: gl.concat([{ sena, movId, por: h.por, en: h.en }]).slice(-20) };
}
const idPago = (docId, ref, n) => 'p_' + GN.hash(docId + '|' + ref) + (n ? '_' + n : '');

// Pagar: partes = [{ docId, monto }], con un movimiento (movId) o un medio sin banco (efectivo, personal) y su fecha.
// v0.123.0 · clave: un pago que nace en Efectivo (la clave sale del movimiento de efectivo). Su id sale de la clave: si ya hay uno vigente
// con esa clave, no se paga otra vez (responde repetido). extra: lo que se guarda además en el pago (de qué efectivo salió).
const idsDePago = (pagosAntes, docId, ref) => pagosAntes.filter(x => x.id === idPago(docId, ref) || x.id.startsWith(idPago(docId, ref) + '_'));
export async function pagar({ partes, movId = '', medio = 'cargo', fecha = '', nota = '', clave = '', extra = null }) {
  if (!partes || !partes.length) throw error('Nada que pagar.', 'datos');
  const pagosAntes = await todos(GN.COL.pagos), reps = Object.fromEntries((await todos(GN.COL.repartos)).map(r => [r.id, r]));
  if (clave) { const viva = partes.map(p => idsDePago(pagosAntes, p.docId, clave).find(x => x.estado !== 'deshecho')).find(Boolean); if (viva) return { pagos: 0, repetido: true, pagoId: viva.id }; }
  return enTransaccion(async (tx, d) => {
    const refs = partes.map(p => FB.doc(d, GN.COL.docs, p.docId)), sn = [];
    for (const r of refs) sn.push(await tx.get(r));
    // v0.123.0 · Con clave, el pago no puede existir ya (otra pestaña lo acaba de crear)
    const idsP = partes.map(p => { const ref = clave || movId || (medio + '|' + fecha); return idPago(p.docId, ref, idsDePago(pagosAntes, p.docId, ref).length); });
    if (clave) for (const id of idsP) { if ((await tx.get(FB.doc(d, GN.COL.pagos, id))).exists()) throw error('Ese pago ya quedó registrado en Gastos. Vuelva a abrir y únalo otra vez.', 'cambio'); }
    let mov = null; const mref = movId ? FB.doc(d, GN.COL.movs, movId) : null;
    if (mref) { const ms = await tx.get(mref); if (!ms.exists()) throw error('Ese movimiento ya no está.', 'cambio'); mov = ms.data(); if ((mov.naturaleza && mov.naturaleza !== 'acuenta') || mov.estado === 'no_va') throw error('Ese movimiento ya se marcó como "no es gasto".', 'cambio'); }
    sn.forEach((x, i) => { if (!x.exists()) throw error('Un documento ya no está.', 'cambio'); if (x.data().estado === 'no_va') throw error(`El documento N° ${x.data().folio || ''} se marcó "Esto no va".`, 'cambio');
      if (mov && !GB.compatible(x.data(), mov)) throw error('Un cargo anterior al inicio solo se une con documentos desde el inicio: lo de antes con lo de antes es del Gastos anterior.', 'datos'); });
    // v0.91.2 · Regla: cada documento pagado tiene que estar clasificado (por sí mismo o por su proveedor)
    // (Previred: también las fichas de sus trabajadores)
    const claves = [...new Set(sn.map(x => GB.claveProveedor(x.data())))], provs = {};
    for (const k of [...new Set(claves.concat(sn.map(x => GB.claveBase(x.data()))).concat(sn.flatMap(x => ((x.data().previred || {}).trabajadores || []).map(t => 'r_' + t.rutN))))]) { const ps = await tx.get(FB.doc(d, GN.COL.provs, k)); if (ps.exists()) provs[k] = ps.data(); }
    const falta = GB.faltaClasificar(sn.map(x => ({ id: x.id, ...x.data() })), provs, reps);
    if (falta.length) throw error(`Primero clasifique: ${falta.map(x => x.razon || x.folio).join(', ')}.`, 'clasificar');
    // v0.126.4 · "Descontado de las ventas" solo para facturas de comisiones (por su clasificación o la de su proveedor)
    if (medio === 'descuento' && sn.some(x => !GB.admiteDescuento(GB.clasifDe({ id: x.id, ...x.data() }, provs, reps)))) throw error('"Descontado de las ventas" es solo para facturas de comisiones (Mercado Pago) o del arriendo del POS (Transbank).', 'datos');
    // v0.91.1 · El proveedor aprende cómo aparece en el banco (solo si todos los documentos son del mismo proveedor y la glosa tiene seña propia)
    const sena = mov ? GB.senaDe(mov.glosa) : '';
    const aprende = sena && claves.length === 1 ? { ref: FB.doc(d, GN.COL.provs, claves[0]), dato: sn[0].data(), prev: provs[claves[0]] || null } : null;
    const h = marca(movId ? 'pagado con un movimiento' : 'pagado sin banco', { medio, movId, nota: String(nota || '').slice(0, 200) });
    partes.forEach((p, i) => {
      tx.set(FB.doc(d, GN.COL.pagos, idsP[i]), limpio({ docId: p.docId, movId, medio: movId ? 'cargo' : medio, monto: Math.round(Number(p.monto) || 0), fecha: movId ? mov.fecha : fecha,
        cuenta: mov ? mov.cuenta : '', anterior: !!(mov && mov.anterior), nota: String(nota || '').slice(0, 200), estado: 'vigente', creado: { por: h.por, en: h.en }, ...(extra || {}) }));
      // v0.96.0 · Al pagarse, la clasificación que venía del proveedor queda guardada en el documento: un cambio posterior del proveedor
      // o de su reparto no mueve lo ya pagado (ni los meses cerrados de Finanzas)
      const dd = { id: refs[i].id, ...sn[i].data() }, c = dd.clasif ? null : GB.clasifDe(dd, provs, reps);
      tx.update(refs[i], { historial: conHist(sn[i].data(), h), ...(c ? { clasif: limpio({ item: c.item, areas: c.areas, repartoId: c.repartoId || '', partes: c.partes, de: 'proveedor', por: h.por, en: h.en }) } : {}) });
    });
    if (mref) tx.update(mref, { historial: conHist(mov, marca('unido a ' + partes.length + (partes.length === 1 ? ' documento' : ' documentos'), { docs: partes.map(p => p.docId) })) });
    if (aprende) tx.set(aprende.ref, conGlosa(aprende.prev, aprende.dato, sena, movId, h), { merge: true });
    return { pagos: partes.length, sena: aprende ? sena : '', pagoId: idsP[0] };
  });
}
// Deshacer un pago: queda "deshecho" (con quién, cuándo y por qué); el documento y el movimiento vuelven a estar abiertos
export async function deshacerPago(pagoId, motivo) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.pagos, pagoId), sn = await tx.get(ref);
    if (!sn.exists() || sn.data().estado === 'deshecho') throw error('Ese pago ya no está vigente.', 'cambio');
    const p = sn.data(), h = marca('pago deshecho', { pagoId, motivo: String(motivo || '').slice(0, 200) });
    const dref = FB.doc(d, GN.COL.docs, p.docId), ds = await tx.get(dref), mref = p.movId ? FB.doc(d, GN.COL.movs, p.movId) : null, ms = mref ? await tx.get(mref) : null;
    const pref = p.movId && ds.exists() ? FB.doc(d, GN.COL.provs, GB.claveProveedor(ds.data())) : null, ps = pref ? await tx.get(pref) : null;
    tx.update(ref, { estado: 'deshecho', deshecho: { por: h.por, en: h.en, motivo: h.motivo } });
    if (ds.exists()) tx.update(dref, { historial: conHist(ds.data(), h) });
    if (ms && ms.exists()) tx.update(mref, { historial: conHist(ms.data(), h) });
    if (ps && ps.exists() && (ps.data().glosas || []).some(g => g.movId === p.movId)) tx.update(pref, { glosas: ps.data().glosas.filter(g => g.movId !== p.movId) });   // v0.91.1: se olvida lo aprendido con ese pago
  });
}
// Esto no va (documento): repetido, no es de la empresa o no es una compra. Volver a la Bandeja lo deshace.
export async function noVa(docId, motivo, nota) {
  if (!GB.MOTIVOS_NO_VA[motivo]) throw error('Elija el motivo.', 'datos');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref), a = sn.data();
    const h = marca('esto no va: ' + GB.MOTIVOS_NO_VA[motivo], { nota: String(nota || '').slice(0, 200) });
    tx.update(ref, { estado: 'no_va', noVa: { motivo, nota: h.nota, por: h.por, en: h.en }, historial: conHist(a, h) });
  });
}
// v0.128.2 · Varios documentos de deuda anterior: "Ya se pagó antes del 1 oct" (una sola transacción; solo deuda anterior sin pago)
export async function pagadosAntes(ids, nota) {
  const l = [...new Set(ids || [])].filter(Boolean).slice(0, 400); if (!l.length) throw error('Marque al menos un documento.', 'datos');
  return enTransaccion(async (tx, d) => {
    const refs = l.map(id => FB.doc(d, GN.COL.docs, id)), sns = await Promise.all(refs.map(r => tx.get(r)));
    sns.forEach(sn => { if (!sn.exists()) throw error('Un documento ya no está: actualice.', 'cambio'); const a = sn.data(); if (!a.anterior) throw error(`El documento N° ${a.folio || ''} no es deuda anterior.`, 'datos'); if (a.estado === 'no_va') throw error(`El documento N° ${a.folio || ''} ya estaba marcado.`, 'cambio'); });
    const h = marca('esto no va: ' + GB.MOTIVOS_NO_VA_TODOS[GB.PAGADO_ANTES], { nota: String(nota || '').slice(0, 200) });
    refs.forEach((r, i) => tx.update(r, { estado: 'no_va', noVa: { motivo: GB.PAGADO_ANTES, nota: h.nota, por: h.por, en: h.en }, historial: conHist(sns[i].data(), h) }));
    return l.length;
  });
}
export async function volverDoc(docId) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref), a = sn.data();
    tx.update(ref, { estado: 'vigente', noVa: null, historial: conHist(a, marca('vuelve a la Bandeja')) });
  });
}
// No es gasto (movimiento): traspaso, retiro del dueño, pago de la tarjeta de crédito u otro. Volver lo deshace.
// v0.124.2 · Una nota en un cargo o en un documento ("qué falta para resolverlo"). Vacía = se borra; el texto anterior queda en el historial.
// → la nota guardada (o null)
export async function guardarNota(tipo, id, texto) {
  const col = tipo === 'doc' ? GN.COL.docs : GN.COL.movs, t = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, col, id), sn = await tx.get(ref); if (!sn.exists()) throw error('No se encontró.', 'datos');
    const a = sn.data(), antes = a.nota && a.nota.texto ? a.nota.texto : '';
    if (t === antes) return a.nota || null;
    const nota = t ? { texto: t, por: quien(), en: ahoraChile().texto } : null;
    tx.update(ref, { nota, historial: conHist(a, marca(t ? (antes ? 'cambió la nota' : 'anotó una nota') : 'borró la nota', { nota: (t || antes).slice(0, 200) })) });
    return nota;
  });
}
export async function noEsGasto(movId, tipo, nota) {
  if (!GB.NO_GASTO[tipo]) throw error('Elija qué es.', 'datos');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.movs, movId), sn = await tx.get(ref), a = sn.data();
    const h = marca('no es gasto: ' + GB.NO_GASTO[tipo], { nota: String(nota || '').slice(0, 200) });
    tx.update(ref, { naturaleza: tipo, naturalezaNota: h.nota, historial: conHist(a, h) });
  });
}
// v0.135.0 · "Son dos compras": el cargo que parecía repetido (el mismo en otra cartola) no vuelve a avisar
export async function noRepetido(movId) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.movs, movId), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese movimiento ya no está.', 'cambio');
    const h = marca('no es repetido: son dos compras');
    tx.update(ref, { noRepetido: { por: h.por, en: h.en }, historial: conHist(sn.data(), h) });
  });
}
export async function volverMov(movId) {
  // v0.105.0 · Un pago a cuenta ya aplicado a un documento no vuelve: primero se deshace lo aplicado (queda la huella)
  const aplicados = (await todos(GN.COL.pagos)).filter(p => p.movId === movId && p.estado !== 'deshecho');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.movs, movId), sn = await tx.get(ref), a = sn.data();
    if (a && a.naturaleza === 'acuenta' && aplicados.length) throw error('Este pago a cuenta ya se aplicó a un documento: primero deshaga ese pago (en el documento, "Deshacer el pago").', 'cambio');
    tx.update(ref, { naturaleza: '', naturalezaNota: '', aCuenta: null, historial: conHist(a, marca('vuelve a la Bandeja')) });
  });
}
// v0.105.0 · Pago a cuenta: lo que se le pagó a un proveedor o trabajador antes de su documento (un anticipo, una parte de algo que se
// factura después, un abono). Queda conciliado y como saldo a favor de esa parte; cuando llega su documento, se aplica con un toque.
// parte = { clave, razon, rut }. No es gasto del mes: el gasto es el documento cuando llegue.
export async function pagoACuenta(movId, parte, nota) {
  const razon = String((parte && parte.razon) || '').trim().slice(0, 120), rut = String((parte && parte.rut) || '').trim().slice(0, 14);
  if (!razon && !GN.rutN(rut)) throw error('Elija a quién se le pagó (o escriba su nombre o RUT).', 'datos');
  const clave = (parte && parte.clave) || GB.claveParte(razon, rut);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.movs, movId), sn = await tx.get(ref);
    if (!sn.exists()) throw error('Ese movimiento ya no está.', 'cambio');
    const a = sn.data(); if (a.naturaleza || a.estado === 'no_va') throw error('Ese movimiento ya está explicado.', 'cambio');
    const h = marca('pago a cuenta de ' + (razon || rut), { nota: String(nota || '').slice(0, 200) });
    tx.update(ref, { naturaleza: 'acuenta', naturalezaNota: h.nota, aCuenta: limpio({ clave, razon, rut, por: h.por, en: h.en }), historial: conHist(a, h) });
  });
}
// Clasificar: ítem y reparto en el documento; "recordar" lo deja en su proveedor para los que vienen
// Clasificar (v0.92.0, por partes). clasif = { general: { item, areas }, partes?, lineas? } o lo simple { item, areas } (lo sugerido).
//  · general: lo de "toda la factura" (lo que el proveedor recuerda para las próximas).
//  · partes: [{ item, area, monto }] que suman la base del documento (si no vienen, salen de general).
//  · lineas: [{ descripcion, item, area }] cuando se separó por líneas: el proveedor recuerda cada producto.
export async function clasificar(doc, clasif, recordar = true) {   // recordar: 'fijo' | 'item' | false (true = 'fijo')
  const modo = recordar === 'item' ? 'item' : 'fijo';
  // v0.96.0 · Separada por líneas o montos, cada parte trae su ítem y su área: lo de "toda la factura" es opcional (solo llena las vacías).
  //   Sin áreas generales, el proveedor recuerda los productos con su área y el ítem más grande; lo que no reconozca, lo pide.
  const gen = clasif.general || { item: clasif.item, areas: clasif.areas }, sep = !!clasif.separado && (clasif.partes || []).length > 0, genAreas = (gen.areas || []).filter(a => a && a.area);
  if (!sep || genAreas.length) { const err = GB.repartoValido(gen.areas); if (err) throw error(err, 'datos'); }
  const base = GB.baseDe(doc), partes = (sep ? clasif.partes : GB.partesSimple(base, String(gen.item || '').trim(), gen.areas))
    .map(x => ({ item: String(x.item).trim(), area: String(x.area), monto: Math.round(Number(x.monto) || 0) }));
  const itemGen = String(gen.item || '').trim() || (sep ? GB.principal(partes) : '');
  if (!itemGen) throw error('Elija el ítem.', 'datos');
  const general = { item: itemGen, areas: genAreas.map(a => ({ area: String(a.area), pct: Math.round(Number(a.pct) * 100) / 100 })), repartoId: genAreas.length ? String(gen.repartoId || '') : '' };
  const e2 = GB.partesValidas(partes, base); if (e2) throw error(e2, 'datos');
  const lineas = (clasif.lineas || []).filter(l => l && l.descripcion && l.item && l.area);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, doc.id), sn = await tx.get(ref), a = sn.data(), h = marca('clasificado', { clasificacion: GB.textoPartes(partes) });
    const pref = recordar ? FB.doc(d, GN.COL.provs, GB.claveProveedor(doc)) : null, ps = pref ? await tx.get(pref) : null, prev = ps && ps.exists() ? ps.data() : null;
    tx.update(ref, { clasif: { item: general.item, areas: general.areas, repartoId: general.repartoId, partes, porLineas: lineas.length > 0, separado: !!clasif.separado, lineas: lineas.map(l => ({ descripcion: String(l.descripcion).slice(0, 120), item: l.item, area: l.area })), por: h.por, en: h.en }, historial: conHist(a, h) });
    if (pref) {
      // En modo "solo el ítem", ningún producto guarda área (tampoco los que la tenían de antes)
      const antes = Object.fromEntries(Object.entries((prev && prev.productos) || {}).map(([k, v]) => [k, modo === 'item' ? { item: v.item } : v]));
      const productos = { ...antes, ...GB.productosARecordar(lineas, modo) };
      tx.set(pref, limpio({ rut: doc.rut || '', razon: doc.razon || '', item: general.item, modo, por: h.por, en: h.en, historial: conHist(prev, h) }), { merge: true });
      tx.update(pref, { areas: modo === 'fijo' ? general.areas : [], repartoId: modo === 'fijo' ? general.repartoId : '', productos: limpio(productos) });   // estos dos se reemplazan enteros (merge mezclaría lo de antes)
    }
  });
}
// Registrar a mano desde un movimiento: boleta en papel o pago sin documento. Nace el documento ya pagado con ese movimiento.
// v0.126.2 · La foto de una boleta en papel (ya subida a Drive): { url, nombre } → el campo foto del documento
function fotoDoc(f, h) {
  if (!f || !f.url) return {};
  if (!String(f.url).startsWith('https://')) throw error('La foto no se pudo subir a Drive.', 'datos');
  return { foto: { url: String(f.url).slice(0, 500), nombre: String(f.nombre || '').slice(0, 160), por: h.por, en: h.en } };
}
// Agregar (o cambiar) la foto de un documento ya registrado
export async function agregarFoto(docId, f) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese documento ya no existe.', 'datos');
    const a = sn.data(), h = marca(a.foto ? 'cambió la foto de la boleta' : 'agregó la foto de la boleta');
    const x = fotoDoc(f, h); if (!x.foto) throw error('La foto no se pudo subir a Drive.', 'datos');
    tx.update(ref, { foto: x.foto, historial: conHist(a, h) });
    return x.foto;
  });
}
export async function registrarAMano(mov, p) {
  const err = GB.repartoValido(p.areas); if (err) throw error(err, 'datos');
  if (!String(p.proveedor || '').trim()) throw error('Escriba a quién se le pagó.', 'datos');
  if (!String(p.item || '').trim()) throw error('Elija el ítem.', 'datos');
  const monto = Math.round(Number(p.monto) || 0); if (!(monto > 0) || monto > mov.libre) throw error('El monto debe ser mayor que cero y no más que lo libre del movimiento.', 'datos');
  const tipo = p.tipo === 'boleta' ? '39m' : 'sd', docId = `d_mano_${mov.id}_${GN.hash(String(Date.now()))}`, h = marca('registrado a mano', { movId: mov.id });
  const rut = GN.rutN(p.rut);
  const doc = { origen: 'mano', tipo, tipoTexto: p.tipo === 'boleta' ? 'Boleta' : 'Sin documento', nc: false, rut: rut ? GN.rutTexto(rut) : '', rutN: rut, razon: String(p.proveedor).trim().slice(0, 120), folio: String(p.folio || '').slice(0, 30),
    fecha: mov.fecha, mes: mov.fecha.slice(0, 7), neto: 0, exento: 0, iva: 0, otroImp: 0, total: monto, vence: '', formaPago: '', referencias: [], detalle: p.nota ? [{ descripcion: String(p.nota).slice(0, 120), cantidad: 1, unidad: '', monto }] : [],
    estado: 'vigente', clasif: { item: String(p.item).trim(), areas: p.areas, partes: GB.partesSimple(monto, String(p.item).trim(), p.areas), por: h.por, en: h.en }, creado: { por: h.por, en: h.en, mov: mov.id }, version: 0, historial: [h], ...fotoDoc(p.foto, h) };
  return enTransaccion(async (tx, d) => {
    const mref = FB.doc(d, GN.COL.movs, mov.id), ms = await tx.get(mref), m = ms.data();
    const pref = p.recordar !== false ? FB.doc(d, GN.COL.provs, GB.claveProveedor(doc)) : null, ps = pref ? await tx.get(pref) : null;
    tx.set(FB.doc(d, GN.COL.docs, docId), limpio(doc));
    tx.set(FB.doc(d, GN.COL.pagos, idPago(docId, mov.id)), { docId, movId: mov.id, medio: 'cargo', monto, fecha: mov.fecha, cuenta: mov.cuenta, nota: '', estado: 'vigente', creado: { por: h.por, en: h.en } });
    tx.update(mref, { historial: conHist(m, marca('registrado a mano: ' + doc.razon, { docs: [docId] })) });
    if (pref) { const sena = GB.senaDe(mov.glosa), prev = ps && ps.exists() ? ps.data() : null;
      tx.set(pref, limpio({ rut: doc.rut, razon: doc.razon, item: doc.clasif.item, modo: (prev && prev.modo) || 'fijo', areas: prev && prev.modo === 'item' ? [] : p.areas, por: h.por, en: h.en, historial: conHist(prev, h), ...(sena ? { glosas: conGlosa(prev, doc, sena, mov.id, h).glosas } : {}) }), { merge: true }); }
    return { docId };
  });
}

// v0.130.0 · Anotar boleta (desde el celular, con la foto): la boleta queda registrada en el momento; el pago se une después
// (débito: con su cargo de la cartola) o en el acto (efectivo, plata del dueño o tarjeta de crédito, desde la pantalla).
// p: { monto, medio: 'debito'|'credito'|'efectivo'|'personal', donde, fecha, item, areas, repartoId, foto } → { docId, doc }
export async function anotarBoleta(p) {
  const monto = Math.round(Number(p.monto) || 0); if (!(monto > 0)) throw error('Escriba el monto.', 'datos');
  if (!GN.esIso(p.fecha)) throw error('Elija la fecha.', 'datos');
  const medio = ['debito', 'credito', 'efectivo', 'personal'].includes(p.medio) ? p.medio : '';
  if (!medio) throw error('Elija cómo pagó.', 'datos');
  const item = String(p.item || '').trim(), conClasif = !!item;
  if (conClasif) { const err = GB.repartoValido(p.areas); if (err && !p.repartoId) throw error(err, 'datos'); }
  if (!conClasif && medio !== 'debito') throw error('Elija el ítem y el área: con efectivo, plata del dueño o tarjeta de crédito, la boleta queda pagada al guardar.', 'datos');
  const razon = String(p.donde || '').trim().slice(0, 120) || 'Boleta', h = marca('anotó la boleta', { medio }), docId = `d_bol_${GN.hash(p.fecha + '|' + razon + '|' + monto + '|' + Date.now())}`;
  const doc = { origen: 'mano', tipo: '39m', tipoTexto: 'Boleta', nc: false, rut: '', rutN: '', razon, folio: '', fecha: p.fecha, mes: p.fecha.slice(0, 7), neto: 0, exento: 0, iva: 0, otroImp: 0, total: monto,
    vence: '', formaPago: '', referencias: [], detalle: [], estado: 'vigente', anotada: { medio, ...(medio === 'efectivo' && ['admin', 'caja', 'cobro'].includes(p.origen) ? { origen: p.origen } : {}), por: h.por, en: h.en },   // v0.134.0: de dónde salió el efectivo
    ...(conClasif ? { clasif: { item, areas: p.repartoId ? [] : p.areas, repartoId: p.repartoId || '', partes: GB.partesSimple(monto, item, p.areas), por: h.por, en: h.en } } : {}),
    creado: { por: h.por, en: h.en }, version: 0, historial: [h], ...fotoDoc(p.foto, h) };
  if (conClasif && !doc.clasif.partes.length) throw error('Elija el área o el reparto.', 'datos');
  await enTransaccion(async (tx, d) => { tx.set(FB.doc(d, GN.COL.docs, docId), limpio(doc)); });
  return { docId, doc: { id: docId, ...doc } };
}
// v0.91.1 · Olvidar una seña aprendida (desde el par que la muestra)
export async function olvidarSena(provKey, sena) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, provKey), sn = await tx.get(ref); if (!sn.exists()) return;
    const a = sn.data(); tx.update(ref, { glosas: (a.glosas || []).filter(g => g.sena !== sena), historial: conHist(a, marca('olvidó la glosa ' + sena)) });
  });
}

// ═══════════════ v0.96.0 · Repartos con nombre y ficha del proveedor ═══════════════
export async function guardarReparto({ id = '', nombre, areas }) {
  const n = String(nombre || '').trim().slice(0, 60); if (!n) throw error('Escriba el nombre del reparto.', 'datos');
  const err = GB.repartoValido(areas); if (err) throw error(err, 'datos');
  const ar = areas.map(a => ({ area: String(a.area), pct: Math.round(Number(a.pct) * 100) / 100 }));
  const rid = id || 'rp_' + GN.norm(n).toLowerCase().replace(/ /g, '_').slice(0, 40) + '_' + Date.now().toString(36);
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.repartos, rid), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null, h = marca(a ? 'cambió el reparto' : 'creó el reparto', { areas: GB.textoReparto(ar) });
    tx.set(ref, limpio({ nombre: n, areas: ar, estado: 'activo', ...(a ? {} : { creado: { por: h.por, en: h.en } }), historial: conHist(a, h) }), { merge: true });
  });
  return rid;
}
// Aplicar el reparto (cambiado) a lo ya pagado del mes abierto que lo usa (lo que no está pagado ya lo toma solo)
export async function aplicarRepartoAlMes(rid, mes) {
  const [docs, reps] = await Promise.all([todos(GN.COL.docs), todos(GN.COL.repartos)]), r = reps.find(x => x.id === rid);
  if (!r) throw error('Ese reparto ya no está.', 'cambio');
  const l = docs.filter(x => x.clasif && x.clasif.repartoId === rid && x.mes === mes && !x.clasif.porLineas && !x.clasif.separado);
  const d = await dbBase();
  for (let i = 0; i < l.length; i += 200) {
    const b = FB.writeBatch(d);
    l.slice(i, i + 200).forEach(x => { const h = marca('reparto aplicado: ' + r.nombre, { areas: GB.textoReparto(r.areas) });
      b.update(FB.doc(d, GN.COL.docs, x.id), { clasif: limpio({ ...x.clasif, areas: r.areas, partes: GB.partesSimple(GB.baseDe(x), x.clasif.item, r.areas), por: h.por, en: h.en }), historial: conHist(x, h) }); });
    await b.commit();
  }
  return l.length;
}
// Ficha del proveedor (o de un servicio): ítem, modo y reparto (o áreas) — sin pasar por una factura
export async function guardarFicha(clave, { item, modo, repartoId = '', areas = [], razon = '', rut = '' }) {
  if (!String(item || '').trim()) throw error('Elija el ítem.', 'datos');
  const m = modo === 'item' ? 'item' : 'fijo';
  if (m === 'fijo' && !repartoId) { const err = GB.repartoValido(areas); if (err) throw error(err, 'datos'); }
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null, h = marca('ficha editada', { item, modo: m });
    tx.set(ref, limpio({ ...(a ? {} : { razon, rut }), item: String(item).trim(), modo: m, historial: conHist(a, h), por: h.por, en: h.en }), { merge: true });
    tx.update(ref, { repartoId: m === 'fijo' ? repartoId : '', areas: m === 'fijo' && !repartoId ? areas : [] });
  });
}
export async function quitarProducto(clave, k) {
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref); if (!sn.exists()) return;
    const a = sn.data(), prods = { ...(a.productos || {}) }; delete prods[k];
    tx.update(ref, { productos: prods, historial: conHist(a, marca('olvidó el producto ' + k)) });
  });
}

// v0.96.0 · "No es este": queda guardado en cada documento del par (no se vuelve a proponer). Se puede unir igual a mano.
export async function descartarPar(docIds, movId) {
  await enTransaccion(async (tx, d) => {
    const refs = docIds.map(i => FB.doc(d, GN.COL.docs, i)), sn = [];
    for (const r of refs) sn.push(await tx.get(r));
    sn.forEach((x, i) => { if (!x.exists()) return; const a = x.data(), l = Array.isArray(a.descartes) ? a.descartes : [];
      if (!l.includes(movId)) tx.update(refs[i], { descartes: l.concat([movId]).slice(-30), historial: conHist(a, marca('no es este cargo', { movId })) }); });
  });
}

// v0.96.0 · Compromiso (pago fijo sin documento): nombre, a quién se paga (nombre y RUT opcional), monto, día del mes, desde qué mes, ítem y
// reparto. Su clasificación queda en la ficha de a quién se paga (así sus documentos llegan clasificados y un cambio del reparto rige para lo que viene).
// Un cambio del monto o del día rige desde el próximo mes que se cree (lo ya creado no se toca).
export async function guardarCompromiso(c) {
  const nombre = String(c.nombre || '').trim().slice(0, 80), aQuien = String(c.aQuien || '').trim().slice(0, 120), monto = Math.round(Number(c.monto) || 0), dia = Math.round(Number(c.dia) || 0);
  if (!nombre) throw error('Escriba el nombre (por ejemplo, Arriendo Ainavillo).', 'datos');
  if (!aQuien) throw error('Escriba a quién se le paga.', 'datos');
  if (!(monto > 0)) throw error('Escriba el monto.', 'datos');
  if (!(dia >= 1 && dia <= 31)) throw error('El día de pago va del 1 al 31.', 'datos');
  const frecuencia = ['semestral', 'anual'].includes(c.frecuencia) ? c.frecuencia : 'mensual', mesInicio = Math.min(Math.max(1, Math.round(Number(c.mesInicio) || 1)), frecuencia === 'anual' ? 12 : 6);
  if (!String(c.item || '').trim()) throw error('Elija el ítem.', 'datos');
  if (!c.repartoId) { const err = GB.repartoValido(c.areas); if (err) throw error(err, 'datos'); }
  const id = c.id || 'cp_' + GN.norm(nombre).toLowerCase().replace(/ /g, '_').slice(0, 30) + '_' + Date.now().toString(36);
  const dato = { nombre, aQuien, rut: String(c.rut || '').trim().slice(0, 14), monto, dia, frecuencia, mesInicio: frecuencia !== 'mensual' ? mesInicio : 0, rol: String(c.rol || '').trim().slice(0, 40), direccion: String(c.direccion || '').trim().slice(0, 100), desde: /^\d{4}-\d{2}$/.test(c.desde || '') ? c.desde : '', item: String(c.item).trim(), repartoId: c.repartoId || '', areas: c.repartoId ? [] : c.areas, estado: 'activo' };
  const clave = GB.claveBase(GB.docDeCompromiso({ id, ...dato }, '2000-01'));
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.compromisos, id), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null, pref = FB.doc(d, GN.COL.provs, clave), ps = await tx.get(pref), prev = ps.exists() ? ps.data() : null;
    const h = marca(a ? 'cambió el compromiso' : 'creó el compromiso', { monto, dia });
    tx.set(ref, limpio({ ...dato, ...(a ? {} : { creado: { por: h.por, en: h.en } }), historial: conHist(a, h) }), { merge: true });
    tx.set(pref, limpio({ razon: aQuien, rut: dato.rut, item: dato.item, modo: 'fijo', por: h.por, en: h.en, historial: conHist(prev, marca('clasificación del compromiso ' + nombre)) }), { merge: true });
    tx.update(pref, { repartoId: dato.repartoId, areas: dato.areas });
  });
  return id;
}
export async function archivarCompromiso(id, archivar = true) {
  await enTransaccion(async (tx, d) => { const ref = FB.doc(d, GN.COL.compromisos, id), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese compromiso ya no está.', 'cambio');
    tx.update(ref, { estado: archivar ? 'archivado' : 'activo', historial: conHist(sn.data(), marca(archivar ? 'archivado (no crea más meses)' : 'vuelve a crear sus meses')) }); });
}

// v0.97.0 · Créditos: el detalle del banco (Excel) se guarda una vez; sus cuotas crean su documento el mes en que vencen
export async function cargarCredito(r, archivo) {
  const c0 = r.cuotas[0], id = 'cr_' + GN.hash(`${c0.fecha}|${r.cuotas.length}|${r.cuota}`), por = quien(), en = ahoraChile().texto;
  let que = 'nuevo';
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.creditos, id), sn = await tx.get(ref);
    // v0.124.5: lo que trae la tabla de amortización (capital, interés, atraso, otros) se conserva cuota por cuota
    if (sn.exists()) { que = 'ya'; const antes = Object.fromEntries((sn.data().cuotas || []).map(c => [c.n, c]));
      tx.update(ref, { cuotas: r.cuotas.map(c => ({ ...REAL(antes[c.n]), n: c.n, fecha: c.fecha, monto: c.monto, estado: c.estado })), historial: conHist(sn.data(), marca('detalle actualizado desde el banco')) }); return; }
    tx.set(ref, limpio({ banco: r.banco, nombre: r.nombre, cuota: r.cuota, dia: r.dia, cuotas: r.cuotas.map(c => ({ n: c.n, fecha: c.fecha, monto: c.monto, estado: c.estado })), montoOriginal: 0, tasa: 0, estado: 'activo', creado: { por, en }, historial: [marca('cargado del detalle del banco')] }));
  });
  const k = { id: GN.idCarga('credito'), tipo: 'credito', archivo: String(archivo.nombre || '').slice(0, 120), tamano: Number(archivo.tamano) || 0, identificador: r.nombre, leidos: r.cuotas.length, nuevos: que === 'nuevo' ? 1 : 0, yaEstaban: que === 'ya' ? 1 : 0, que, por, en };
  await guardarCarga(k);
  return { ...k, idCredito: id };
}
// v0.124.5 · Los campos de la tabla real de una cuota (para conservarlos o copiarlos)
const REAL = c => (c && c.real ? { capital: c.capital, interes: c.interes, retardo: c.retardo || 0, otros: c.otros || 0, real: true, ...(c.fechaPago ? { fechaPago: c.fechaPago } : {}) } : {});
// v0.124.5 · La "Tabla de amortización Fën": se une al crédito con el mismo N° de operación, o al cargado del detalle del banco (misma primera
// cuota y mismo número de cuotas); si no hay, crea el crédito. Cada cuota con su tabla real usa esos montos; las que ya tienen documento
// (clasificación del sistema) se actualizan si su total no cambia o todavía no tienen pago.
export async function cargarTablaCredito(r, archivo) {
  const [creds, docsT, pagosT] = await Promise.all([todos(GN.COL.creditos), todos(GN.COL.docs), todos(GN.COL.pagos)]);
  const c0 = r.cuotas[0], idNuevo = 'cr_' + GN.hash(`${c0.fecha}|${r.nCuotas}|${r.cuota}`);
  const prev = creds.find(x => r.operacion && x.operacion === r.operacion) || creds.find(x => x.id === idNuevo)
    || creds.find(x => (x.cuotas || []).length === r.nCuotas && ((x.cuotas || []).find(c => c.n === 1) || {}).fecha === (r.cuotas.find(c => c.n === 1) || {}).fecha);
  const id = prev ? prev.id : idNuevo, por = quien(), en = ahoraChile().texto;
  let que = prev ? 'ya' : 'nuevo', cuotasF = [];
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.creditos, id), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null;
    const porN = Object.fromEntries(((a && a.cuotas) || []).map(c => [c.n, c]));
    r.cuotas.forEach(c => { const e = porN[c.n];
      porN[c.n] = e ? { ...e, ...(c.real ? REAL(c) : {}), ...(c.fechaPago && !c.real ? { fechaPago: c.fechaPago } : {}) } : { n: c.n, fecha: c.fecha, monto: c.monto, estado: c.fechaPago ? 'Pagada' : '', ...REAL(c) }; });
    cuotasF = Object.values(porN).sort((x, y) => x.n - y.n);
    const h = marca(a ? 'tabla de amortización cargada' : 'creado desde la tabla de amortización', { cuotasReales: r.reales });
    tx.set(ref, limpio({ banco: r.banco, nombre: (a && a.nombre) || r.nombre, operacion: r.operacion || (a && a.operacion) || '', cuota: (a && a.cuota) || r.cuota, dia: (a && a.dia) || r.dia, cuotas: cuotasF,
      montoOriginal: r.montoOriginal || (a && a.montoOriginal) || 0, tasa: r.tasa || (a && a.tasa) || 0, estado: (a && a.estado) || 'activo', ...(a ? {} : { creado: { por, en } }), historial: conHist(a, h) }), { merge: true });
  });
  // Las cuotas que ya tienen su documento (desde el inicio): sus partes y, si no tienen pago, su total
  const sep = GP.separarCuotas(cuotasF, r.montoOriginal, r.tasa), pagados = new Set(pagosT.filter(p => p.estado !== 'deshecho').map(p => p.docId));
  const docs = docsT.filter(x => x.credito === id && x.clasif && x.clasif.de === 'sistema'), dbb = await dbBase();
  let cambiados = 0, revisar = 0;
  for (let i = 0; i < docs.length; i += 200) { const b = FB.writeBatch(dbb); let n = 0;
    docs.slice(i, i + 200).forEach(x => { const c = sep.find(q => String(q.n) === String(x.folio)); if (!c) return; const partes = GP.partesCuota(c), tot = partes.reduce((a2, p) => a2 + p.monto, 0);
      if (tot !== Math.round(Number(x.total) || 0) && pagados.has(x.id)) { revisar++; return; }
      b.update(FB.doc(dbb, GN.COL.docs, x.id), { clasif: { ...x.clasif, item: partes[0].item, partes, separado: partes.length > 1, tabla: !!c.real }, ...(tot !== Math.round(Number(x.total) || 0) ? { total: tot, neto: tot } : {}), historial: conHist(x, marca(c.real ? 'cuota con la tabla del banco' : 'cuota separada (estimado)')) }); n++; cambiados++; });
    if (n) await b.commit(); }
  const k = { id: GN.idCarga('credito'), tipo: 'credito', archivo: String(archivo.nombre || '').slice(0, 120), tamano: Number(archivo.tamano) || 0, identificador: r.nombre, leidos: r.cuotas.length, nuevos: que === 'nuevo' ? 1 : 0, yaEstaban: que === 'ya' ? 1 : 0, que, por, en };
  await guardarCarga(k);
  return { ...k, idCredito: id, reales: r.reales, cambiados, revisar };
}
// Nombre, monto original y tasa mensual (%): con los dos últimos, cada cuota se separa en interés (financiero) y capital (fuera del resultado).
// Se recalculan las cuotas ya creadas que conservan la clasificación del sistema.
export async function guardarCredito(id, { nombre, montoOriginal, tasa }) {
  const docs = (await todos(GN.COL.docs)).filter(x => x.credito === id && x.clasif && x.clasif.de === 'sistema');
  let cuotas = [];
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.creditos, id), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese crédito ya no está.', 'cambio');
    const a = sn.data(), mo = Math.max(0, Math.round(Number(montoOriginal) || 0)), t = Math.max(0, Number(String(tasa).replace(',', '.')) || 0);
    if (t > 10) throw error('La tasa es mensual, en %: por ejemplo 1,25.', 'datos');
    cuotas = GP.separarCuotas(a.cuotas || [], mo, t);
    tx.update(ref, { nombre: String(nombre || a.nombre).trim().slice(0, 100), montoOriginal: mo, tasa: t, historial: conHist(a, marca('datos del crédito', { montoOriginal: mo, tasa: t })) });
  });
  const dbb = await dbBase();
  for (let i = 0; i < docs.length; i += 200) { const b = FB.writeBatch(dbb); docs.slice(i, i + 200).forEach(x => { const c = cuotas.find(q => String(q.n) === String(x.folio)); if (!c) return; const partes = GP.partesCuota(c);
    b.update(FB.doc(dbb, GN.COL.docs, x.id), { razon: String(nombre || x.razon).trim().slice(0, 100), clasif: { ...x.clasif, item: partes[0].item, partes, separado: partes.length > 1 }, historial: conHist(x, marca('cuota separada en interés y capital')) }); }); await b.commit(); }
  return docs.length;
}

// v0.98.0 · Ajustar un compromiso al monto pagado (la patente cambia cada año y a veces suma IPC o multas). Lo pagado de más queda como
// multas e intereses (financiero); de menos, el documento baja a lo pagado. Queda el monto original en el historial.
export async function ajustarCompromiso(docId, nuevoTotal) {
  const t = Math.round(Number(nuevoTotal) || 0); if (!(t > 0)) throw error('El monto no es válido.', 'datos');
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese documento ya no está.', 'cambio');
    const a = sn.data(); if (a.origen !== 'compromiso') throw error('Solo se ajustan los compromisos.', 'datos');
    const original = a.ajuste && a.ajuste.original ? a.ajuste.original : a.total, recargo = Math.max(0, t - original);
    tx.update(ref, { total: t, neto: t, ajuste: { original, recargo }, historial: conHist(a, marca(`ajustado al monto pagado: ${original} → ${t}`)) });
  });
}

// v0.100.0 · Hoy y la Agenda: el resumen guardado al abrir Gastos (una sola lectura)
export async function resumenHoy() {
  const d = await dbBase(), sn = await FB.getDoc(FB.doc(d, GN.COL.config, 'resumen'));
  return sn.exists() ? sn.data() : null;
}
// v0.100.0 · Un gasto sin banco: en efectivo (caja) o con plata del dueño, con boleta en papel o sin documento. Nace pagado.
export async function registrarSinBanco(p) {
  const err = GB.repartoValido(p.areas); if (err && !p.repartoId) throw error(err, 'datos');
  if (!String(p.proveedor || '').trim()) throw error('Escriba a quién se le pagó.', 'datos');
  if (!String(p.item || '').trim()) throw error('Elija el ítem.', 'datos');
  if (!GN.esIso(p.fecha)) throw error('Elija la fecha.', 'datos');
  const monto = Math.round(Number(p.monto) || 0); if (!(monto > 0)) throw error('Escriba el monto.', 'datos');
  const medio = p.medio === 'personal' ? 'personal' : 'efectivo', tipo = p.tipo === 'boleta' ? '39m' : 'sd', docId = `d_mano_${medio}_${GN.hash(p.fecha + '|' + p.proveedor + '|' + monto + '|' + Date.now())}`, h = marca('registrado sin banco', { medio });
  const rut = GN.rutN(p.rut), areas = p.repartoId ? [] : p.areas;
  const doc = { origen: 'mano', tipo, tipoTexto: p.tipo === 'boleta' ? 'Boleta' : 'Sin documento', nc: false, rut: rut ? GN.rutTexto(rut) : '', rutN: rut, razon: String(p.proveedor).trim().slice(0, 120), folio: String(p.folio || '').slice(0, 30),
    fecha: p.fecha, mes: p.fecha.slice(0, 7), neto: 0, exento: 0, iva: 0, otroImp: 0, total: monto, vence: '', formaPago: '', referencias: [], detalle: p.nota ? [{ descripcion: String(p.nota).slice(0, 120), cantidad: 1, unidad: '', monto }] : [],
    estado: 'vigente', clasif: { item: String(p.item).trim(), areas: p.areas, repartoId: p.repartoId || '', partes: GB.partesSimple(monto, String(p.item).trim(), p.areas), por: h.por, en: h.en }, creado: { por: h.por, en: h.en }, version: 0, historial: [h], ...fotoDoc(p.foto, h) };
  if (!doc.clasif.partes.length) throw error('Elija el área o el reparto.', 'datos');
  await enTransaccion(async (tx, d) => {
    const pref = p.recordar !== false ? FB.doc(d, GN.COL.provs, GB.claveProveedor(doc)) : null, ps = pref ? await tx.get(pref) : null, prev = ps && ps.exists() ? ps.data() : null;
    tx.set(FB.doc(d, GN.COL.docs, docId), limpio(doc));
    // v0.134.0: desde Efectivo (pago sin boleta posible) el pago nace unido a su movimiento de Efectivo
    tx.set(FB.doc(d, GN.COL.pagos, idPago(docId, medio + '|' + p.fecha)), { docId, movId: '', medio, monto, fecha: p.fecha, cuenta: '', nota: '', estado: 'vigente', creado: { por: h.por, en: h.en },
      ...(p.efectivo ? { efectivo: { ...p.efectivo, por: h.por, en: h.en }, origenEfectivo: p.efectivo.origen || '' } : {}) });
    if (pref) tx.set(pref, limpio({ rut: doc.rut, razon: doc.razon, item: doc.clasif.item, modo: (prev && prev.modo) || 'fijo', areas: prev && prev.modo === 'item' ? [] : areas, repartoId: p.repartoId || '', por: h.por, en: h.en, historial: conHist(prev, h) }), { merge: true });
  });
  return p.efectivo ? { docId, pagoId: idPago(docId, medio + '|' + p.fecha) } : docId;
}

// ═══════════════ v0.102.0 · Catálogo de ítems (gn_items) ═══════════════
// Para la vista previa: el tipo con que contaba cada ítem en Finanzas → Clasificación (solo se lee, una vez, al abrir la vista previa)
export async function leerFinItems() {
  try { return Object.fromEntries((await todos('fin_items')).map(x => [x.id, x])); } catch (e) { return {}; }
}
// Pasar al catálogo nuevo (una sola vez). plan: GI.planMigracion. dec: { otros: { claveProveedor: ítem }, revisar: { NOMBRE: ítem } }.
// Escribe: los ítems nuevos y los del sistema; los nombres antiguos archivados (con su reemplazo); las fichas de los proveedores y los
// compromisos con el nombre nuevo; y solo los documentos con OTROS INSUMOS (lo que se decidió para su proveedor). Todo con historial.
export async function aplicarCatalogo(plan, dec = {}) {
  const d = await dbBase(), h = marca('pasó al catálogo nuevo de ítems (v0.102.0)');
  // Se puede repetir si se cortó a medias: las fichas, compromisos y documentos van primero (lo ya cambiado no se vuelve a tocar) y el
  // catálogo al final, así queda activo solo cuando todo lo demás está escrito.
  const cfg = await FB.getDoc(FB.doc(d, GN.COL.config, 'catalogo'));
  if (cfg.exists() && cfg.data().migrado) throw error('El catálogo nuevo ya se había creado: recargue Gastos.', 'cambio');
  const [docs, provs, comps] = await Promise.all([todos(GN.COL.docs), todos(GN.COL.provs), todos(GN.COL.compromisos).catch(() => [])]);
  const ops = [], fin = [], hist = (que, extra) => [{ ...h, que, ...(extra || {}) }];
  plan.crear.forEach(x => fin.push(['set', GI.COL, x.clave, limpio({ nombre: x.nombre, grupo: x.grupo, cuenta: x.cuenta, estado: 'activo', sistema: !!x.sistema, elegible: !!x.elegible, area: '', creado: { por: h.por, en: h.en }, historial: hist('creado en el catálogo nuevo') })]));
  const creados = new Set(plan.crear.map(x => x.clave));
  plan.archivar.forEach(x => { if (creados.has(x.clave)) return; fin.push(['set', GI.COL, x.clave, limpio({ nombre: x.nombre, grupo: '', cuenta: '', estado: 'archivado', pasaA: x.pasaA || '', motivo: x.motivo, deAnterior: true, creado: { por: h.por, en: h.en }, historial: hist('archivado al pasar al catálogo nuevo' + (x.pasaA ? ': pasa a ' + x.pasaA : '')) })]); });
  // Los nombres por ubicar que se decidieron: archivados con su reemplazo (así sus documentos ya clasificados cuentan con el nuevo)
  Object.entries(dec.revisar || {}).forEach(([k, nuevo]) => { const r = plan.revisar.find(x => GN.norm(x.nombre) === k); if (!r || !nuevo) return; const c = GI.claveItem(r.nombre); if (creados.has(c)) return;
    fin.push(['set', GI.COL, c, limpio({ nombre: r.nombre, grupo: '', cuenta: '', estado: 'archivado', pasaA: nuevo, motivo: 'ubicado al pasar al catálogo nuevo', creado: { por: h.por, en: h.en }, historial: hist('ubicado: pasa a ' + nuevo) })]); });
  let fichas = 0, ncomps = 0, ndocs = 0;
  provs.forEach(p => { const c = GI.cambiosFicha(p, dec, p.id); if (!c) return; fichas++; ops.push(['update', GN.COL.provs, p.id, { ...limpio(c.cambios), historial: conHist(p, marca('ítems del catálogo nuevo: ' + c.texto)) }]); });
  const P = Object.fromEntries(provs.map(p => [p.id, p]));
  comps.forEach(x => { const f = GI.nombreFinal(x.item, dec, GI.claveGrupo(GB.docDeCompromiso(x, '2000-01'), P)); if (!f || GN.norm(f) === GN.norm(x.item)) return; ncomps++; ops.push(['update', GN.COL.compromisos, x.id, { item: f, historial: conHist(x, marca(`ítem del catálogo nuevo: ${x.item} → ${f}`)) }]); });
  docs.forEach(x => { const c = GI.cambiosDoc(x, dec, GI.claveGrupo(x, P)); if (!c) return; ndocs++; ops.push(['update', GN.COL.docs, x.id, { clasif: limpio(c), historial: conHist(x, marca('OTROS INSUMOS pasa a ' + GB.textoPartes(c.partes || []))) }]); });
  fin.push(['set', GN.COL.config, 'catalogo', { migrado: { por: h.por, en: h.en, version: '0.102.0', items: plan.crear.length, archivados: plan.archivar.length, fichas, compromisos: ncomps, documentos: ndocs } }]);
  await enLotes(d, ops); await enLotes(d, fin);
  return { items: plan.crear.length, archivados: plan.archivar.length, fichas, compromisos: ncomps, documentos: ndocs };
}
// Crear o cambiar un ítem (el nombre no cambia: para otro nombre se crea uno nuevo y el antiguo se archiva apuntando a él)
export async function guardarItem(clave, datos) {
  const cat = await todos(GI.COL);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GI.COL, clave || GI.claveItem(datos.nombre)), sn = await tx.get(ref), prev = sn.exists() ? sn.data() : null;
    if (!clave && prev) throw error(`Ya existe un ítem «${prev.nombre}» (puede estar archivado).`, 'datos');
    if (clave && !prev) throw error('Ese ítem ya no está.', 'cambio');
    const x = GI.validarItem(datos, prev, cat), h = marca(prev ? 'cambió el ítem' : 'creó el ítem', { grupo: x.grupo, cuenta: x.cuenta });
    tx.set(ref, limpio({ ...x, estado: (prev && prev.estado) || 'activo', sistema: false, ...(prev ? {} : { creado: { por: h.por, en: h.en } }), historial: conHist(prev, h) }), { merge: true });
    return ref.id;
  });
}
// Archivar (con su reemplazo, opcional) o reactivar. Con reemplazo, las fichas y los compromisos que lo usan pasan al nuevo (con historial);
// los documentos ya clasificados no se tocan (el archivado apunta al nuevo).
export async function archivarItem(clave, { archivar = true, pasaA = '' } = {}) {
  const [cat, provs, comps] = await Promise.all([todos(GI.COL), todos(GN.COL.provs), todos(GN.COL.compromisos).catch(() => [])]);
  const x = cat.find(i => i.id === clave); if (!x) throw error('Ese ítem ya no está.', 'cambio');
  if (x.sistema) throw error('Los ítems del sistema no se archivan.', 'datos');
  const err = archivar ? GI.validarArchivo(x.nombre, pasaA, cat) : ''; if (err) throw error(err, 'datos');
  const nuevo = pasaA ? cat.find(i => GN.norm(i.nombre) === GN.norm(pasaA)).nombre : '';
  if (!archivar && !(x.grupo && x.cuenta)) throw error('Este nombre se archivó al pasar al catálogo nuevo y no tiene grupo ni cuenta: si se reactiva, sus documentos dejarían de contar con su reemplazo. Cree un ítem nuevo si lo necesita.', 'datos');
  const d = await dbBase(), ops = [], h = marca(archivar ? `archivado${nuevo ? ': pasa a ' + nuevo : ''}` : 'reactivado');
  const b = { update: (col, id, dato) => ops.push(['set', col, id, dato]) };
  b.update(GI.COL, clave, { estado: archivar ? 'archivado' : 'activo', pasaA: archivar ? nuevo : '', historial: conHist(x, h) });
  let n = 0;
  if (archivar && nuevo) {
    const sol = n0 => (GN.norm(n0) === GN.norm(x.nombre) ? nuevo : '');
    provs.forEach(p => { const c = cambiosNombre(p, sol); if (c) { n++; b.update(GN.COL.provs, p.id, { ...limpio(c.cambios), historial: conHist(p, marca('ítem archivado: ' + c.texto)) }); } });
    comps.forEach(c => { if (GN.norm(c.item) === GN.norm(x.nombre)) { n++; b.update(GN.COL.compromisos, c.id, { item: nuevo, historial: conHist(c, marca(`ítem archivado: ${c.item} → ${nuevo}`)) }); } });
  }
  await enLotes(d, ops);
  return n;
}
// Escribe en tandas de 400 (el límite de Firestore es 500). set con merge: un documento que ya no está no corta la tanda.
async function enLotes(d, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = FB.writeBatch(d);
    ops.slice(i, i + 400).forEach(([, col, id, dato]) => b.set(FB.doc(d, col, id), dato, { merge: true }));
    await b.commit();
  }
}
const cambiosNombre = (p, f) => {
  const out = {}, txt = [];
  if (p.item && f(p.item)) { out.item = f(p.item); txt.push(`${p.item} → ${out.item}`); }
  let cp = false; const np = {}; Object.entries(p.productos || {}).forEach(([k, v]) => { const z = v && v.item ? f(v.item) : ''; np[k] = z ? { ...v, item: z } : v; if (z) { cp = true; txt.push(`${k}: ${v.item} → ${z}`); } });
  if (cp) out.productos = np;
  return Object.keys(out).length ? { cambios: out, texto: txt.slice(0, 6).join(' · ') } : null;
};
// Un nombre en uso que no está en el catálogo ("Revisar ítem"): pasa a un ítem que existe, o se crea como ítem nuevo con su grupo y cuenta
export async function ubicarItem(nombre, { pasaA = '', grupo = '', cuenta = '' } = {}) {
  const cat = await todos(GI.COL), clave = GI.claveItem(nombre), prev = cat.find(i => i.id === clave) || null;
  if (pasaA) {
    const err = GI.validarArchivo(nombre, pasaA, cat); if (err) throw error(err, 'datos');
    const nuevo = cat.find(i => GN.norm(i.nombre) === GN.norm(pasaA)).nombre, h = marca('ubicado: pasa a ' + nuevo);
    const d = await dbBase(), b = FB.writeBatch(d);
    b.set(FB.doc(d, GI.COL, clave), limpio({ nombre: prev ? prev.nombre : String(nombre).trim(), grupo: '', cuenta: '', estado: 'archivado', pasaA: nuevo, ...(prev ? {} : { creado: { por: h.por, en: h.en } }), historial: conHist(prev, h) }), { merge: true });
    await b.commit();
    return clave;
  }
  const x = GI.validarItem({ nombre, grupo, cuenta }, prev && prev.estado === 'activo' ? prev : null, prev ? cat.filter(i => i.id !== clave) : cat), h = marca('ubicado: ítem nuevo', { grupo: x.grupo, cuenta: x.cuenta });
  const d = await dbBase(), b = FB.writeBatch(d);
  b.set(FB.doc(d, GI.COL, clave), limpio({ ...x, nombre: prev ? prev.nombre : x.nombre, estado: 'activo', pasaA: '', sistema: false, ...(prev ? {} : { creado: { por: h.por, en: h.en } }), historial: conHist(prev, h) }), { merge: true });
  await b.commit();
  return clave;
}

// ═══════════════ v0.103.0 · Flete de compra ═══════════════
// La factura del flete (courier) se une a una o varias compras: su costo se reparte entre ellas (gn-finanzas.partesFlete) y sube el precio de
// lo comprado (finanzas-sii.fleteDeCompras). docIds vacío: se desune (vuelve a "flete por unir"). Queda en el historial.
export async function unirFlete(docId, docIds) {
  const ids = [...new Set((docIds || []).map(String))].filter(x => x && x !== docId).slice(0, 20);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese documento ya no está.', 'cambio');
    const sns = []; for (const i of ids) sns.push(await tx.get(FB.doc(d, GN.COL.docs, i)));
    const ok = sns.filter(x => x.exists()), txt = ok.map(x => `${x.data().razon || ''} N° ${x.data().folio || ''}`).join(', ');
    if (ids.length && !ok.length) throw error('Esas compras ya no están.', 'cambio');
    const h = marca(ok.length ? 'flete unido a: ' + txt : 'flete desunido de sus compras');
    tx.update(ref, { flete: ok.length ? { docs: ok.map(x => x.id), por: h.por, en: h.en } : null, historial: conHist(sn.data(), h) });
    return ok.length;
  });
}

// ═══════════════ v0.104.0 · Ficha del trabajador y provisión ═══════════════
// Los datos del contrato van en la ficha del trabajador (gn_proveedores/r_<RUT>.trabajador), con su historial
export async function guardarTrabajador(clave, datos, { razon = '', rut = '' } = {}) {
  const x = TR.validarFicha(datos);
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null;
    const h = marca(a && a.trabajador ? 'datos del trabajador cambiados' : 'datos del trabajador', { contrato: x.contrato, ingreso: x.ingreso });
    tx.set(ref, limpio({ ...(a ? {} : { razon, rut }), trabajador: x, historial: conHist(a, h) }), { merge: true });
  });
}
// v0.124.3 · El término del contrato (null = vuelve a "trabajando"; queda en el historial)
export async function guardarTermino(clave, datos, { razon = '', rut = '' } = {}) {
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null;
    const t = datos ? TR.validarTermino(datos, a && a.trabajador) : null;
    const h = marca(t ? (a && a.termino ? 'término del contrato cambiado' : 'término del contrato') : 'vuelve a trabajando (sin término)', t ? { dia: t.dia, causa: t.causa } : {});
    tx.set(ref, limpio({ ...(a ? {} : { razon, rut }), termino: t, historial: conHist(a, h) }), { merge: true });
    return t;
  });
}
// v0.124.3 · Un documento del trabajador (el archivo ya subido a Drive): { tipo, fecha, nota, url, nombre }
export async function agregarDocTrab(clave, x, { razon = '', rut = '' } = {}) {
  if (!TR.TIPOS_DOC[x.tipo]) throw error('Elija qué documento es.', 'datos');
  if (x.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha))) throw error('Revise la fecha del documento.', 'datos');
  if (!String(x.url || '').startsWith('https://')) throw error('El archivo no se pudo subir a Drive.', 'datos');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null, l = Array.isArray(a && a.documentosTrab) ? a.documentosTrab : [];
    if (l.length >= TR.MAX_DOCS) throw error(`Esta ficha ya tiene ${TR.MAX_DOCS} documentos.`, 'datos');
    const h = marca('subió un documento: ' + TR.TIPOS_DOC[x.tipo].toLowerCase());
    const nuevo = { id: 'dt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: x.tipo, fecha: String(x.fecha || ''), nota: String(x.nota || '').slice(0, 200), url: String(x.url).slice(0, 500), nombre: String(x.nombre || '').slice(0, 120), por: h.por, en: h.en, estado: 'vigente' };
    tx.set(ref, limpio({ ...(a ? {} : { razon, rut }), documentosTrab: l.concat([nuevo]), historial: conHist(a, h) }), { merge: true });
    return nuevo;
  });
}
// v0.124.3 · Un documento subido por error: no se borra, queda "no va" con su motivo
export async function docTrabNoVa(clave, id, motivo) {
  const m = String(motivo || '').trim().slice(0, 200); if (!m) throw error('Escriba el motivo.', 'datos');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.provs, clave), sn = await tx.get(ref), a = sn.exists() ? sn.data() : null, l = Array.isArray(a && a.documentosTrab) ? a.documentosTrab : [];
    const x = l.find(y => y.id === id); if (!x) throw error('Ese documento ya no está.', 'cambio');
    const h = marca('documento marcado "no va": ' + (TR.TIPOS_DOC[x.tipo] || x.tipo).toLowerCase(), { motivo: m });
    tx.update(ref, { documentosTrab: l.map(y => (y.id === id ? { ...y, estado: 'no_va', noVa: { motivo: m, por: h.por, en: h.en } } : y)), historial: conHist(a, h) });
  });
}
// Un pago (liquidación o finiquito) que sale de la provisión: { uso: 'vacaciones' | 'finiquito' | '', de: clave del trabajador }
export async function marcarProvision(docId, { uso = '', de = '' } = {}) {
  if (uso && !TR.USOS[uso]) throw error('Elija el uso.', 'datos');
  if (uso && !de) throw error('Elija de qué trabajador es la provisión.', 'datos');
  await enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.docs, docId), sn = await tx.get(ref); if (!sn.exists()) throw error('Ese documento ya no está.', 'cambio');
    const h = marca(uso ? `usa la provisión: ${TR.USOS[uso].toLowerCase()} (${de})` : 'ya no usa la provisión');
    tx.update(ref, { provision: uso ? { uso, de, por: h.por, en: h.en } : null, historial: conHist(sn.data(), h) });
  });
}

// ═══════════════ v0.108.0 · Gestión y tributario (gn_config/tributario) ═══════════════
// Un cambio de la situación tributaria de una regla (compromiso, servicio, proveedor o ítem), desde una fecha. Nada se borra: los cambios
// se suman a la regla (lo anterior a la fecha sigue rigiendo como estaba). Un trámite nuevo se crea con su nombre.
export async function cambiarTributario({ tipo, clave, nombre }, datos) {
  if (!GT.TIPOS[tipo] || !String(clave || '').trim()) throw error('Falta a qué se aplica.', 'datos');
  const x = GT.validarCambio(datos), id = GT.idRegla(tipo, clave);
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.config, 'tributario'), sn = await tx.get(ref), a = sn.exists() ? sn.data() : {};
    const reglas = { ...(a.reglas || {}) }, grupos = { ...(a.grupos || {}) }, h = marca('situación tributaria', { regla: id, situacion: x.situacion, desde: x.desde });
    if (x.grupoNuevo && !grupos[x.grupo]) grupos[x.grupo] = { nombre: x.grupoNuevo, falta: '', quien: '', estado: 'pendiente', nota: '', historial: [{ ...h, que: 'trámite creado' }] };
    if (x.grupo && !grupos[x.grupo]) throw error('Ese trámite ya no está.', 'cambio');
    const r = reglas[id] || { tipo, clave: String(clave), nombre: String(nombre || clave).slice(0, 120), cambios: [] };
    reglas[id] = { ...r, nombre: String(nombre || r.nombre).slice(0, 120), cambios: (r.cambios || []).concat([{ desde: x.desde, situacion: x.situacion, grupo: x.grupo, nota: x.nota, por: h.por, en: h.en }]).slice(-30) };
    tx.set(ref, limpio({ reglas, grupos, historial: conHist(a, h) }));
    return reglas[id];
  });
}
// El trámite de un grupo: qué falta, quién, en qué estado va (con su historial)
export async function guardarTramite(gid, { nombre, falta, quien, estado, nota }) {
  if (!GT.ESTADOS[estado]) throw error('Elija el estado.', 'datos');
  return enTransaccion(async (tx, d) => {
    const ref = FB.doc(d, GN.COL.config, 'tributario'), sn = await tx.get(ref), a = sn.exists() ? sn.data() : {};
    const g = (a.grupos || {})[gid]; if (!g) throw error('Ese trámite ya no está.', 'cambio');
    const h = marca('trámite: ' + GT.ESTADOS[estado].toLowerCase(), { grupo: gid });
    const n = { ...g, nombre: String(nombre || g.nombre).trim().slice(0, 60) || g.nombre, falta: String(falta || '').slice(0, 300), quien: String(quien || '').slice(0, 80), estado, nota: String(nota || '').slice(0, 300), historial: conHist(g, h) };
    tx.set(ref, limpio({ ...a, grupos: { ...(a.grupos || {}), [gid]: n }, historial: conHist(a, h) }));
  });
}

// ═══════════════ v0.123.0 · Efectivo → "Unir a su documento" ═══════════════
// Lo que Efectivo puede unir: los documentos con saldo por pagar y los ya pagados en efectivo en Gastos ("Gasto sin banco") que todavía
// no están unidos a un movimiento de Efectivo (o que están unidos a ESTE movimiento: un "Unir" que se cortó a medias se termina igual).
// Lee gn_documentos y gn_pagos con la memoria de fs-gastos (abrir Gastos antes = 0 lecturas nuevas).
export async function docsParaEfectivo(efId = '') {
  const [docs, pagos] = await Promise.all([todos(GN.COL.docs), todos(GN.COL.pagos)]);
  const I = GB.indicePagos(pagos), out = [];
  docs.forEach(d => {
    if (d.estado === 'no_va' || d.nc || Number(d.total) <= 0) return;
    const e = GB.estadoDoc(d, I), base = { id: d.id, razon: d.razon || '', rut: d.rut || '', rutN: d.rutN || '', folio: d.folio || '', tipoTexto: d.tipoTexto || '', fecha: d.fecha || '', total: Math.round(Number(d.total) || 0),
      ...(d.origen === 'liquidacion' ? { origen: 'liquidacion', anticipos: Math.round(Number(d.liquidacion && d.liquidacion.anticipos) || 0) } : {}) };   // v0.124.9
    if (e.saldo > 0) out.push({ ...base, estado: 'pendiente', saldo: e.saldo });
    (e.pagos || []).filter(p => p.medio === 'efectivo' && (!p.efectivo || (efId && p.efectivo.id === efId))).forEach(p => out.push({ ...base, estado: 'pagado_efectivo', saldo: 0, pagoId: p.id, pagoMonto: Math.round(Number(p.monto) || 0), pagoFecha: p.fecha || '' }));
  });
  return out;
}
// v0.124.9 · Los trabajadores de Gastos → Equipo que siguen trabajando, para el anticipo de sueldo en Efectivo → [{ clave, rutN, nombre }]
export async function trabajadoresParaEfectivo() {
  const [docs, provs] = await Promise.all([todos(GN.COL.docs), todos(GN.COL.provs)]);
  const P = {}; provs.forEach(p => { P[p.id] = p; });
  return TR.equipo({ docs, provs: P }).filter(t => !TR.terminado(t)).map(t => ({ clave: t.clave, rutN: t.rutN || '', nombre: t.nombre }));
}
// Pagar el documento con el efectivo (o unirlo al pago en efectivo que ya tenía en Gastos). ef: { id, col, sucursal, dia, monto, origen, clave, texto }
// → { pagoId, repetido }
export async function pagarConEfectivo(doc, ef) {
  const efectivo = { id: String(ef.id), col: ef.col || 'efectivo_movimientos', origen: ef.origen, ...(ef.sucursal ? { sucursal: ef.sucursal } : {}) };
  if (doc.estado === 'pagado_efectivo') {
    return enTransaccion(async (tx, d) => {
      const ref = FB.doc(d, GN.COL.pagos, doc.pagoId), sn = await tx.get(ref);
      if (!sn.exists() || sn.data().estado === 'deshecho') throw error('Ese pago ya no está vigente en Gastos.', 'cambio');
      const p = sn.data();
      if (p.efectivo && p.efectivo.id === efectivo.id) return { pagoId: doc.pagoId, repetido: true };
      if (p.efectivo) throw error('Ese pago de Gastos ya está unido a otro movimiento de Efectivo.', 'cambio');
      tx.update(ref, { efectivo: { ...efectivo, por: quien(), en: ahoraChile().texto }, origenEfectivo: ef.origen });
      return { pagoId: doc.pagoId, repetido: false };
    });
  }
  const r = await pagar({ partes: [{ docId: doc.id, monto: Math.round(Number(ef.monto) || 0) }], medio: 'efectivo', fecha: ef.dia, nota: String(ef.texto || '').slice(0, 200), clave: ef.clave,
    extra: { origenEfectivo: ef.origen, efectivo: { ...efectivo, por: quien(), en: ahoraChile().texto } } });
  return { pagoId: r.pagoId, repetido: !!r.repetido };
}
