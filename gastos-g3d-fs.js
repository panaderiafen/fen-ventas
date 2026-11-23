// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos con la base nueva (fen-gastos), etapa G3 (cuarta parte)  v0.51.0
//  Se usa solo cuando config/gastos dice fuente = "base". Reglas en gastos-g3d.js.
//  · Previred: cot_estado, cot_registrar y cot_lista con las colecciones cotizaciones (una por línea del certificado, id
//    "c-<huella de su Clave>", como la copia G1) y cotiz_trabajadores (área e ítem recordados por RUT). Mismas respuestas
//    que el script (previred.js elige uno u otro). El PDF va a Drive con el script (archivo_subir tipo "previred",
//    "Fën · Gastos / Previred / <año>", privado: script v2.17.0).
//    Regla acordada: si existe la obligación "Cotizaciones" (según documento, identificador Previred) con su vencimiento
//    abierto, el certificado lo COMPLETA (montoDocumento = total, documento { tipo: 'previred', archivo, plan por
//    trabajador }, estado por_pagar) y los gastos por trabajador se crean al pagarlo (Pagar o la cartola: lineasDelPago).
//    Si no, como hoy: un gasto por trabajador al subir (y, si se eligió, el vencimiento queda pagado).
//  · Clasificar obligaciones: la lista con la propuesta y guardar el tipo y el identificador de varias (cada una por su
//    lado, con las reglas de la v0.49.0 para sus vencimientos abiertos).
//  · Arreglo "siniva": vista previa y aplicar (cada gasto con su historial "ajuste siniva" y la marca para la planilla).
//  · v0.67.0 · Comprobante de pago de Previred (con intereses y multas). Mes nuevo: cot_registrar con el comprobante (los
//    trabajadores como siempre + un gasto "Multas e intereses Previred <mes>", o ambos al pagar el vencimiento). Mes que ya
//    tiene sus cotizaciones (certificado): cot_comprobante (solo las multas e intereses, sin repetir los trabajadores). El
//    comprobante queda en previred_planillas/{AAAA-MM}.comprobante y el total de la planilla pasa a ser lo pagado. Quitarlo
//    (cot_quitar_comprobante) anula el gasto de multas e intereses y deja el comprobante en comprobantesQuitados.
//    El aviso de vencimiento (Hoy y Agenda) sale de la memoria: cotizaciones (paquete) y previred_planillas (pocos documentos).
//  · v0.67.5 · Reparto en % por trabajador: cot_estado trae los destinatarios de abonos (de la memoria) para proponer el reparto
//    más nuevo; cot_registrar guarda areas y repartoEn en cotiz_trabajadores (solo si cambió) y parte el gasto en una línea por
//    área; cot_lista dice el reparto de cada trabajador en cada mes (de los gastos en memoria); cot_reparto lo cambia en un mes
//    ya cargado (y, si se pide, en los otros meses del trabajador) por el camino de siempre: corregir con historial y versión,
//    anular lo que sobra y crear lo que falta. Un mes cerrado en Finanzas (fin_cierres) bloquea.
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as D from './gastos-g3d.js?v=0.138.0';
import * as C from './gastos-cartola.js?v=0.138.0';
import * as AB from './gastos-abono.js?v=0.138.0';
import { dbBase, todos, catalogo, nuevo, cambio, despues, correo } from './gastos-fs.js?v=0.138.0';

const error = (msg, code) => Object.assign(new Error(msg), { code });
const s = v => String(v == null ? '' : v);
const MAX_ESCRITURAS = 450;   // una transacción de Firestore acepta hasta 500

// ── Previred ──
// p = { claves, periodo?, fechaPago? }: además de lo del script, a dónde va el certificado (destino)
export async function cotEstado(p) {
  const [cot, trab, ps, vencs, ds] = await Promise.all([todos('cotizaciones'), todos('cotiz_trabajadores'), todos('obligaciones'), todos('vencimientos'), todos('abono_destinatarios').catch(() => [])]);
  const r = D.estadoCot(cot, trab, p && p.claves);
  // v0.67.5 · Lo recordado en los abonos (paquete en memoria): la vista previa propone el reparto más nuevo de cada persona
  r.destinatarios = ds.filter(x => x.d && Array.isArray(x.d.areas) && x.d.areas.length).map(x => ({ clave: s(x.d.clave), nombre: s(x.d.nombre), areas: x.d.areas, repartoEn: s(x.d.repartoEn), ultimoEn: s(x.d.ultimo && x.d.ultimo.en) }));
  if (p && M.esIso(p.fechaPago)) {
    const x = D.destinoCertificado(ps, vencs, p.fechaPago);
    r.destino = x.venc ? { vencimientoId: x.venc.id, nombre: s(x.venc.d.nombre), fecha: G3.fechaReal(x.venc.d), obligacion: s(x.obl.d.nombre) } : { nota: x.motivo };
  }
  // v0.67.0 · Lo del mes (para el comprobante): ¿ya tiene cotizaciones?, ¿por certificado o por comprobante?, su comprobante y los ítems
  // para las multas e intereses (todo de la memoria: cotizaciones, items y fin_items en los paquetes; previred_planillas son pocos)
  if (p && /^\d{4}-(0[1-9]|1[0-2])$/.test(s(p.periodo))) {
    const [pl, fin, cat] = await Promise.all([todos(COL_PL).catch(() => []), todos('fin_items').catch(() => []), catalogo()]);
    const del = delMes(cot, p.periodo), doc = (pl.find(x => x.id === p.periodo) || {}).d || null, comp = compVigente(doc);
    const vid = s((del.find(x => x.d.vencimientoId) || { d: {} }).d.vencimientoId), v = vid ? vencs.find(x => x.id === vid) : null;
    const dif = D.difVigente(doc);
    r.mes = { cargado: del.length > 0, lineas: del.length, total: del.reduce((t, x) => t + M.n(x.d.monto), 0), porComprobante: del.some(x => s(x.d.deComprobante)),
      porCsv: del.some(x => !!x.d.deCsv), fechaPago: del.length ? s(del[0].d.fechaPago) : '', trabajadores: new Set(del.map(x => s(x.d.rut).toUpperCase())).size,
      difMultas: dif ? { monto: M.n(dif.monto), fecha: s(dif.fecha), gastoId: s(dif.gastoId) } : null,
      cotizaciones: del.map(x => ({ rut: s(x.d.rut), nombre: s(x.d.nombre), monto: M.n(x.d.monto) })), vencimientoId: vid, vencAbierto: !!(v && G3.abierto(v.d) && G3.esPrevired(v.d)), vencNombre: v ? s(v.d.nombre) : '',
      comprobante: comp ? { clave: s(comp.clave), totalPagado: M.n(comp.totalPagado), totalRecargos: M.n(comp.totalRecargos), fechaPago: s(comp.fechaPago), cargadoEl: s(comp.cargadoEl) } : null };
    const finM = Object.fromEntries(fin.map(x => [x.id, x.d]));
    r.recargos = { ...D.itemsRecargos(cat.lista, finM), area: D.areaRecargos(), avisos: D.avisosRecargos(cat.lista, finM) };   // v0.67.1: dónde arreglar el tipo
  }
  return r;
}
const COL_PL = 'previred_planillas';
const delMes = (cot, per) => (cot || []).filter(x => x.d && !x.d.quitadoEnPlanilla && D.periodoCot(x.d.periodo) === per);
const compVigente = doc => (doc && doc.comprobante && !doc.comprobante.quitado ? doc.comprobante : null);
// La planilla del mes no pasa a la planilla de Google (como en gastos-cartola-fs.js): sin la marca de copia
const sinPlanilla = o => { const x = { ...o }; delete x.planillaPendiente; delete x.hechoEnBase; return x; };
const subirPdf = async (subir, p) => {
  const b64 = s(p.archivoBase64);
  if (!b64) return '';
  // v0.67.3: también el CSV de la nómina (text/csv; el script v2.18.0 lo guarda en la misma carpeta, con su nombre)
  try { return (await subir({ tipo: 'previred', fecha: '01-' + p.periodo.slice(5, 7) + '-' + p.periodo.slice(0, 4), imageData: b64, mimeType: p.csv ? 'text/csv' : 'application/pdf', fileName: s(p.nombreArchivo || 'previred.pdf').replace(/[\/\\]/g, '_').slice(0, 120) || 'previred.pdf' })).url || ''; } catch (e) { return ''; }
};
// v0.65.1: cada mes con sus pagos del banco unidos (previred_planillas y, si su vencimiento se pagó con la cartola, esos cargos)
export async function cotLista() {
  const [cot, pl, vencs, cg, gs] = await Promise.all([todos('cotizaciones'), todos('previred_planillas').catch(() => []), todos('vencimientos'), todos('cartola_cargos').catch(() => []), todos('gastos').catch(() => [])]);
  const r = D.listaCot(cot);
  // v0.67.5 · El reparto de cada trabajador en cada mes, de sus gastos (paquete en memoria: sin lecturas nuevas) o, si todavía no
  // tiene gastos (vencimiento de Cotizaciones por pagar), del plan del vencimiento
  const porT = D.gastosPorTrabajador(gs), vPorId = Object.fromEntries(vencs.map(x => [x.id, x.d]));
  r.periodos.forEach(P => {
    const v = P.vencimientoId ? vPorId[P.vencimientoId] : null, plan = v && G3.abierto(v) && v.documento && v.documento.previred ? v.documento.previred : null;
    P.trabajadores.forEach(T => {
      const L = porT[P.periodo + '|' + D.rutCot(T.rut)] || [];
      if (L.length) { const x = D.repartoDeLineas(L); Object.assign(T, { reparto: x.areas, gastosTotal: x.total, gastos: L.map(g => ({ id: g.id, version: Number(g.d.version) || 0, fecha: s(g.d.fecha) })) }); return; }
      const pt = plan && (plan.trabajadores || []).find(y => D.rutCot(y.rut) === D.rutCot(T.rut));
      if (pt) Object.assign(T, { reparto: D.partesTrabajador(pt), gastosTotal: M.n(pt.total), enPlan: true, gastos: [] });
    });
  });
  const abiertos = new Set(vencs.filter(x => x.d && !x.d.quitadoEnPlanilla && G3.abierto(x.d)).map(x => x.id));
  const pls = C.planillasPrevired(r.periodos, Object.fromEntries(pl.map(x => [x.id, x.d])), abiertos, cg.filter(x => !x.d.quitadoEnPlanilla && x.d.accion === C.PREVIRED).map(x => C.vistaCargo(x.id, x.d)));
  const porPer = Object.fromEntries(pls.map(x => [x.periodo, x]));
  r.periodos.forEach(P => { const x = porPer[P.periodo]; if (x) Object.assign(P, { pagos: x.pagos, unido: x.unido, falta: x.falta, conciliada: x.conciliada, vencAbierto: x.vencAbierto, quitados: x.quitados }); });
  // v0.67.0 · El comprobante del mes (si lo tiene): cotizaciones + multas e intereses = pagado; el total de la planilla es lo pagado
  const docs = Object.fromEntries(pl.map(x => [x.id, x.d]));
  r.periodos.forEach(P => {
    const c = compVigente(docs[P.periodo]), q = (docs[P.periodo] || {}).comprobantesQuitados;
    P.cotizaciones = P.total;
    if (c) Object.assign(P, { comprobante: { totalCotizaciones: M.n(c.totalCotizaciones), totalRecargos: M.n(c.totalRecargos), totalPagado: M.n(c.totalPagado), fueraDePlazo: !!c.fueraDePlazo, fechaPago: s(c.fechaPago),
      archivo: s(c.archivo), instituciones: c.instituciones || [], gastoRecargosId: s(c.gastoRecargosId), cargadoEl: s(c.cargadoEl), folios: c.folios || [] }, total: M.n(c.totalPagado) });
    if (Array.isArray(q) && q.length) P.comprobantesQuitados = q.length;
    // v0.67.3 · Sin comprobante: la diferencia del banco registrada como multas e intereses (el total es lo del banco)
    const dif = !c ? D.difVigente(docs[P.periodo]) : null;
    if (dif) Object.assign(P, { difMultas: { monto: M.n(dif.monto), fecha: s(dif.fecha), gastoId: s(dif.gastoId), item: s(dif.item), banco: M.n(dif.banco) }, total: P.cotizaciones + M.n(dif.monto) });
    if (P.porCsv) P.origenDoc = 'csv';
  });
  return r;
}
// v0.67.3 · Quitar la diferencia del banco registrada como multas e intereses: el gasto se anula (no se borra), la planilla la
// deja en difMultasQuitadas (con quién, cuándo y por qué) y su total vuelve a ser el de las cotizaciones. Los cargos unidos siguen.
// p = { periodo, motivo }
export async function cotQuitarDifMultas(p) {
  const d = await dbBase(), per = s(p && p.periodo), motivo = M.texto(p && p.motivo, 300);
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const [cot, pl] = await Promise.all([todos('cotizaciones'), todos(COL_PL).catch(() => [])]);
  const d0 = D.difVigente((pl.find(x => x.id === per) || {}).d);
  if (!d0) throw error('Ese mes no tiene una diferencia registrada como multas e intereses', 'datos');
  const refP = FB.doc(d, COL_PL, per), refG = s(d0.gastoId) ? FB.doc(d, 'gastos', s(d0.gastoId)) : null;
  const quien = correo() || 'Sistema Fën', en = M.ahoraChile().texto, cotTotal = delMes(cot, per).reduce((t, x) => t + M.n(x.d.monto), 0);
  const r = await FB.runTransaction(d, async tx => {
    const snP = await tx.get(refP), snG = refG ? await tx.get(refG) : null;
    const a = snP.exists() ? snP.data() : null, dif = D.difVigente(a);
    if (!dif || s(dif.gastoId) !== s(d0.gastoId)) return { yaEstaba: true };
    let k = 0;
    if (snG && snG.exists() && snG.data().estado === 'vigente') { tx.update(refG, cambio(snG.data(), 'anuló', { estado: 'anulado', anulado: { el: en, en, por: quien, motivo: 'Diferencia de Previred quitada: ' + motivo, filaOriginal: '' } }, { motivo })); k++; }
    const pagos = Array.isArray(a.pagos) ? a.pagos : [], unido = pagos.reduce((t, x) => t + M.n(x.monto), 0), falta = Math.round(cotTotal - unido), completa = unido > 0 && Math.abs(falta) <= 10;
    tx.update(refP, sinPlanilla(cambio(a, 'quitó la diferencia registrada como multas e intereses', { difMultas: null, difMultasQuitadas: (Array.isArray(a.difMultasQuitadas) ? a.difMultasQuitadas : []).concat([{ ...dif, quitado: { por: quien, en, motivo } }]),
      total: cotTotal, unido, falta, estado: completa ? 'pagada_conciliada' : unido ? 'parcial' : 'sin_pagos', ...(completa ? {} : { conciliadaEl: '', conciliadaPor: '' }) }, { motivo })));
    k++;
    return { k };
  });
  if (r.yaEstaba) return { ok: true, yaEstaba: true };
  await despues(r.k);
  return { ok: true };
}

// p = { periodo, fechaPago, fecha, vencimientoId, trabajadores, archivoBase64, nombreArchivo }; marca fija por envío
export async function cotRegistrar(p, marca, subir) {
  const d = await dbBase(), clave = marca.t + marca.r;
  const [cot, cat, ps, vencs] = await Promise.all([todos('cotizaciones'), catalogo(), todos('obligaciones'), todos('vencimientos')]);
  // ¿Ya quedó (un reintento del mismo envío)?
  const mio = cot.find(x => x.d.cargadoClave === clave);
  if (mio) {
    const del = cot.filter(x => x.d.cargadoClave === clave);
    return { ok: true, repetido: true, trabajadores: new Set(del.map(x => x.d.rut)).size, total: del.reduce((t, x) => t + M.n(x.d.monto), 0), lineas: del.length, conArchivo: !!mio.d.archivo, vencimiento: false, aVencimiento: mio.d.vencimientoId ? { id: mio.d.vencimientoId } : null };
  }
  const r = D.revisarRegistro(p, cat.lista.filter(i => !i.archivado), cot);
  if (r.error) throw error(r.error, r.code);
  // v0.67.0 · Con el comprobante de pago: revisado, y el mes no puede tener cotizaciones (sus líneas tienen otros nombres que las
  // del certificado: se cuida por el mes). Un certificado de un mes registrado con el comprobante tampoco entra.
  const del = delMes(cot, p.periodo);
  let comp = null;
  if (p.comprobante) {
    comp = D.revisarComprobante(p.comprobante, cat.lista.filter(i => !i.archivado), p.periodo);
    if (comp.error) throw error(comp.error, comp.code);
    if (comp.limpio.totalCotizaciones !== r.total) throw error('El detalle por trabajador no suma las cotizaciones del comprobante. No se guardó nada.', 'datos');
    if (del.length) throw error('Ese mes ya tiene cotizaciones cargadas: vuelve a subir el comprobante para agregar solo las multas e intereses. No se guardó nada.', 'duplicado');
  } else if (p.csv) {
    // v0.67.3 · El CSV de la nómina solo registra un mes sin cotizaciones (si ya tiene, solo se compara en la pantalla)
    if (del.length) throw error('Ese mes ya tiene sus cotizaciones cargadas: el CSV solo se compara, no agrega nada. No se guardó nada.', 'duplicado');
  } else if (del.some(x => s(x.d.deComprobante))) throw error('Ese mes ya se registró con el comprobante de pago (que trae todo lo pagado): el certificado no agrega nada. No se guardó nada.', 'duplicado');
  else if (del.some(x => !!x.d.deCsv)) throw error('Ese mes ya se registró con el CSV de la nómina (el detalle exacto por trabajador): el certificado no agrega nada. Para las multas e intereses, sube el comprobante de pago. No se guardó nada.', 'duplicado');
  const dest = D.destinoCertificado(ps, vencs, p.fechaPago);
  const aVenc = !!dest.venc;
  // Vencimiento elegido a mano (solo sin la obligación Cotizaciones): debe seguir por pagar, como en el script
  const vElegido = !aVenc && p.vencimientoId ? vencs.find(x => x.id === s(p.vencimientoId) && !x.d.quitadoEnPlanilla) : null;
  if (!aVenc && p.vencimientoId) {
    if (!vElegido) throw error('Ese vencimiento ya no existe', 'datos');
    if (!['esperando_documento', 'por_pagar'].includes(G3.estadoBase(vElegido.d))) throw error('Ese vencimiento ya está ' + (G3.NOMBRE_ESTADO[G3.estadoBase(vElegido.d)] || '').toLowerCase(), 'datos');
  }
  const nGastos = r.limpios.reduce((x, t) => x + t.areas.length, 0);   // v0.67.5: una línea por área de cada trabajador
  const escrituras = r.lineas + r.limpios.length + nGastos + 2 + (comp ? 2 : 0);
  if (escrituras > MAX_ESCRITURAS) throw error('El certificado trae demasiadas líneas para guardarlo de una vez: súbelo por partes (un PDF por trabajador).', 'datos');
  // El PDF a Drive ("Fën · Gastos / Previred / <año del período>", privado)
  const url = await subirPdf(subir, p);
  const quien = correo() || 'Sistema Fën', en = M.ahoraChile().texto, hoy = M.ahoraChile().dia, hora = M.ahoraChile().hora;
  const lineasCot = D.docsCotizacion(p, r.limpios, url, en, quien, { cargadoClave: clave, ...(aVenc ? { vencimientoId: dest.venc.id } : vElegido ? { vencimientoId: vElegido.id } : {}), ...(comp ? { deComprobante: comp.limpio.clave } : {}), ...(p.csv && !comp ? { deCsv: true } : {}) });
  const trab = r.limpios.map(t => D.docTrabajador(t, hoy));
  const refV = aVenc ? FB.doc(d, 'vencimientos', dest.venc.id) : vElegido ? FB.doc(d, 'vencimientos', vElegido.id) : null;
  const rec = comp && comp.rec ? { ...comp.rec, url, nombreArchivo: s(p.nombreArchivo) } : null;
  const plan = { periodo: p.periodo, fecha: p.fecha, fechaPago: p.fechaPago, trabajadores: D.planTrabajadores(p, r.limpios), ...(rec && aVenc ? { recargos: rec } : {}) };
  // Sin vencimiento de Cotizaciones: los gastos por trabajador y el de multas e intereses ahora (con el vencimiento, al pagarlo)
  const gastosAhora = aVenc ? [] : D.lineasPrevired(plan, p.fechaPago, url, hora, vElegido ? { vencimientoId: vElegido.id } : {});
  const idsG = M.idsLineas('gq', marca, gastosAhora.length);
  const idR = rec && !aVenc ? M.idsLineas('gr', marca, 1)[0] : '';
  const refP = comp ? FB.doc(d, COL_PL, p.periodo) : null;
  const n = await FB.runTransaction(d, async tx => {
    const refsC = lineasCot.map(x => FB.doc(d, 'cotizaciones', x.id)), refsT = trab.map(x => FB.doc(d, 'cotiz_trabajadores', x.id));
    const snC = [], snT = [];
    for (const rf of refsC) snC.push(await tx.get(rf));
    for (const rf of refsT) snT.push(await tx.get(rf));
    const snV = refV ? await tx.get(refV) : null, snP = refP ? await tx.get(refP) : null;
    if (snC.some(x => x.exists() && !x.data().quitadoEnPlanilla)) {
      if (snC.every(x => x.exists() && x.data().cargadoClave === clave)) return -1;
      throw error('Ese período ya estaba cargado (otra pestaña o equipo). No se guardó nada.', 'duplicado');
    }
    let k = 0;
    if (refV) {
      if (!snV.exists()) throw error('Ese vencimiento ya no existe', 'datos');
      const a = snV.data();
      if (aVenc) {
        // El certificado completa el vencimiento de Cotizaciones (los gastos, al pagarlo)
        const c = G3.completarDocumento(a, D.documentoPrevired(p, r.limpios, url, p.nombreArchivo, clave, rec), quien, en);
        if (c.error) throw error(c.error + ' (' + s(a.nombre) + ')', 'datos');
        if (a.documento) throw error('Ese vencimiento ya tiene su documento', 'datos');
        c.campos.documento = { ...c.campos.documento, clave, previred: plan };
        tx.update(refV, cambio(a, 'recibió el certificado de Previred', c.campos)); k++;
      } else {
        if (!['esperando_documento', 'por_pagar'].includes(G3.estadoBase(a))) throw error('Ese vencimiento ya no está por pagar', 'datos');
        tx.update(refV, cambio(a, 'pagó con Previred', { estado: 'pagado', fechaPago: p.fechaPago, montoPago: String(r.total + (rec ? rec.monto : 0)), urlComprobante: url, obsPago: 'Pagado con Previred ' + D.nombreMes(p.periodo) + ' (gastos por trabajador' + (rec ? ' y multas e intereses' : '') + ')', pago: { clave } })); k++;
      }
    }
    // v0.67.0 · El comprobante en la planilla del mes (y el gasto de multas e intereses, si va ahora)
    if (refP) {
      const a = snP.exists() ? snP.data() : null, ya = compVigente(a);
      if (ya && s(ya.clave) !== comp.limpio.clave) throw error('Ese mes ya tiene otro comprobante de pago guardado. No se guardó nada.', 'duplicado');
      const campos = D.planillaConComprobante(a, D.docComprobante(comp.limpio, url, p.nombreArchivo, en, quien, idR, aVenc ? { recargosEnVencimiento: dest.venc.id } : {}), p.periodo, r.limpios.length, p.fechaPago);
      if (a) tx.update(refP, sinPlanilla(cambio(a, 'recibió el comprobante de Previred', campos))); else tx.set(refP, sinPlanilla(nuevo({ ...campos, pagos: [], pagosQuitados: [] }, 'previred', quien)));
      k++;
      if (idR) { tx.set(FB.doc(d, 'gastos', idR), nuevo({ ...D.lineaRecargos(rec, url, hora, vElegido ? { vencimientoId: vElegido.id } : {}), origenDetalle: { tipo: 'previred', recargos: true, periodo: p.periodo, por: quien, en } }, 'previred', quien)); k++; }
    }
    lineasCot.forEach((x, i) => { tx.set(refsC[i], nuevo(x.d, 'previred', quien)); k++; });
    // v0.67.5 · repartoEn: cuándo se eligió el reparto (solo si cambió), para que los abonos lean el más nuevo
    trab.forEach((x, i) => { const a = snT[i].exists() ? snT[i].data() : null, dd = D.repartoCambio(a, x.d) ? { ...x.d, repartoEn: en } : x.d; if (a) tx.update(refsT[i], cambio(a, 'Previred', dd)); else tx.set(refsT[i], nuevo(dd, 'previred', quien)); k++; });
    gastosAhora.forEach((l, i) => { tx.set(FB.doc(d, 'gastos', idsG[i]), nuevo(l, 'previred', quien)); k++; });
    return k;
  });
  if (n === -1) return { ok: true, repetido: true, trabajadores: r.limpios.length, gastos: nGastos, total: r.total, lineas: r.lineas, conArchivo: !!url, vencimiento: false, aVencimiento: aVenc ? { id: dest.venc.id, nombre: s(dest.venc.d.nombre) } : null };
  await despues(n);
  return { ok: true, trabajadores: r.limpios.length, gastos: nGastos, total: r.total, lineas: r.lineas, conArchivo: !!url, vencimiento: !!vElegido,
    aVencimiento: aVenc ? { id: dest.venc.id, nombre: s(dest.venc.d.nombre), fecha: G3.fechaReal(dest.venc.d) } : null, nota: aVenc ? '' : dest.motivo || '',
    recargos: rec ? rec.monto : 0, gastoRecargosId: idR, totalPagado: comp ? comp.limpio.totalPagado : r.total };
}

// v0.67.0 · Mes que YA tiene sus cotizaciones (del certificado): no se repiten los trabajadores. Se guarda el comprobante en la
// planilla del mes y se crea el gasto de multas e intereses (o, si el vencimiento de Cotizaciones de ese mes sigue por pagar, se
// suma a su plan: se crea al pagarlo). Subir el mismo comprobante otra vez no repite nada (clave: período + folios).
// p = { periodo, comprobante: { clave, instituciones, totales, fechaPago, fueraDePlazo, recargos: { item, area } }, archivoBase64, nombreArchivo }
export async function cotComprobante(p, marca, subir) {
  const d = await dbBase(), per = s(p && p.periodo);
  const [cot, cat, vencs, pl] = await Promise.all([todos('cotizaciones'), catalogo(), todos('vencimientos'), todos(COL_PL).catch(() => [])]);
  const comp = D.revisarComprobante(p && p.comprobante, cat.lista.filter(i => !i.archivado), per);
  if (comp.error) throw error(comp.error, comp.code);
  const del = delMes(cot, per);
  if (!del.length) throw error('Ese mes no tiene cotizaciones cargadas: regístralo con el comprobante completo (los trabajadores y las multas e intereses).', 'datos');
  const repetido = x => ({ ok: true, repetido: true, recargos: M.n(x.totalRecargos), totalPagado: M.n(x.totalPagado), gastoRecargosId: s(x.gastoRecargosId), conArchivo: !!x.archivo });
  const ya0 = compVigente((pl.find(x => x.id === per) || {}).d);
  if (ya0) { if (s(ya0.clave) === comp.limpio.clave) return repetido(ya0); throw error('Ese mes ya tiene su comprobante de pago guardado. Para cambiarlo, quítalo primero (Gastos → Previred → Meses cargados).', 'duplicado'); }
  const vid = s((del.find(x => x.d.vencimientoId) || { d: {} }).d.vencimientoId), v0 = vid ? vencs.find(x => x.id === vid) : null;
  const aVenc = !!(comp.rec && v0 && G3.abierto(v0.d) && G3.esPrevired(v0.d) && v0.d.documento && v0.d.documento.previred);
  const url = await subirPdf(subir, p);
  const quien = correo() || 'Sistema Fën', en = M.ahoraChile().texto, hora = M.ahoraChile().hora;
  const rec = comp.rec ? { ...comp.rec, url, nombreArchivo: s(p.nombreArchivo) } : null;
  const idR = rec && !aVenc ? M.idsLineas('gr', marca, 1)[0] : '';
  const refP = FB.doc(d, COL_PL, per), refV = aVenc ? FB.doc(d, 'vencimientos', vid) : null, refG = idR ? FB.doc(d, 'gastos', idR) : null;
  const nTrab = new Set(del.map(x => s(x.d.rut).toUpperCase())).size, fpCert = s(del[0].d.fechaPago);
  // v0.67.3 · Mes cargado con el CSV de la nómina: el comprobante trae la fecha de pago de verdad. La planilla toma la del
  // comprobante y los gastos por trabajador (vigentes, de la memoria) que tenían la fecha puesta a mano, también.
  const porCsv = del.some(x => !!x.d.deCsv), fpComp = comp.limpio.fechaPago, fpPl = porCsv ? fpComp : fpCert;
  const gFecha = porCsv && fpCert && fpCert !== fpComp ? (await todos('gastos', FB.where('fechaPago', '==', fpCert))).filter(x => x.d.estado === 'vigente' && x.d.previred && !x.d.previred.recargos && s(x.d.previred.periodo) === per).map(x => x.id).slice(0, 320) : [];   // v0.67.5: hasta 4 líneas por trabajador (reparto)
  const refsF = gFecha.map(id => FB.doc(d, 'gastos', id));
  // v0.67.3 · Si la diferencia del banco ya se había registrado como multas e intereses, la reemplaza el comprobante (se anula)
  const dif0 = D.difVigente((pl.find(x => x.id === per) || {}).d), refD = dif0 && s(dif0.gastoId) ? FB.doc(d, 'gastos', s(dif0.gastoId)) : null;
  const r = await FB.runTransaction(d, async tx => {
    const snP = await tx.get(refP), snV = refV ? await tx.get(refV) : null, snG = refG ? await tx.get(refG) : null;
    const snF = []; for (const rf of refsF) snF.push(await tx.get(rf));
    const snD = refD ? await tx.get(refD) : null;
    const a = snP.exists() ? snP.data() : null, ya = compVigente(a);
    if (ya) { if (s(ya.clave) === comp.limpio.clave) return { repetido: ya }; throw error('Ese mes ya tiene su comprobante de pago guardado. Para cambiarlo, quítalo primero.', 'duplicado'); }
    if (snG && snG.exists()) return { repetido: { ...comp.limpio, gastoRecargosId: idR, archivo: url } };
    let k = 0, fechas = 0, difAnulada = 0;
    snF.forEach((sn, i) => { if (!sn.exists() || sn.data().estado !== 'vigente' || s(sn.data().fechaPago) !== fpCert) return; tx.update(refsF[i], cambio(sn.data(), 'tomó la fecha de pago del comprobante de Previred', { fechaPago: fpComp })); k++; fechas++; });
    const dif = D.difVigente(a);
    if (dif && snD && snD.exists() && snD.data().estado === 'vigente') { tx.update(refD, cambio(snD.data(), 'anuló', { estado: 'anulado', anulado: { el: en, en, por: quien, motivo: 'Reemplazado por el comprobante de pago de Previred', filaOriginal: '' } }, { motivo: 'Reemplazado por el comprobante de pago' })); k++; difAnulada = M.n(dif.monto); }
    if (refV) {
      if (!snV.exists()) throw error('El vencimiento de Cotizaciones ya no existe. Recarga y vuelve a subir el comprobante.', 'datos');
      const v = snV.data();
      if (!G3.abierto(v) || !(v.documento && v.documento.previred)) throw error('El vencimiento de Cotizaciones cambió. Recarga y vuelve a subir el comprobante.', 'cambio');
      const plan = { ...v.documento.previred, recargos: rec }, monto = D.totalPlan(plan);
      tx.update(refV, cambio(v, 'recibió el comprobante de Previred (multas e intereses)', { montoDocumento: monto, documento: { ...v.documento, monto, previred: plan } }));
      k++;
    }
    const campos = D.planillaConComprobante(a, D.docComprobante(comp.limpio, url, p.nombreArchivo, en, quien, idR, aVenc ? { recargosEnVencimiento: vid } : {}), per, nTrab, fpPl);
    if (porCsv) campos.fechaPago = fpComp;
    if (dif) Object.assign(campos, { difMultas: null, difMultasQuitadas: (Array.isArray(a.difMultasQuitadas) ? a.difMultasQuitadas : []).concat([{ ...dif, quitado: { por: quien, en, motivo: 'Reemplazado por el comprobante de pago' } }]) });
    if (a) tx.update(refP, sinPlanilla(cambio(a, 'recibió el comprobante de Previred', campos))); else tx.set(refP, sinPlanilla(nuevo({ ...campos, pagos: [], pagosQuitados: [] }, 'previred', quien)));
    k++;
    if (refG) { tx.set(refG, nuevo({ ...D.lineaRecargos(rec, url, hora), origenDetalle: { tipo: 'previred', recargos: true, periodo: per, por: quien, en } }, 'previred', quien)); k++; }
    return { k, fechas, difAnulada };
  });
  if (r.repetido) return repetido(r.repetido);
  await despues(r.k);
  return { ok: true, recargos: rec ? rec.monto : 0, gastoRecargosId: idR, aVencimiento: aVenc ? { id: vid, nombre: s(v0.d.nombre) } : null, totalPagado: comp.limpio.totalPagado, conArchivo: !!url,
    porCsv, fechasCorregidas: r.fechas, difAnulada: r.difAnulada };
}
// v0.67.0 · Quitar el comprobante de un mes (para cambiarlo): queda en comprobantesQuitados (con quién, cuándo y por qué), el gasto
// de multas e intereses se anula (no se borra) y, si estaba en el plan de un vencimiento por pagar, sale de ahí. Los trabajadores
// y los cargos del banco unidos no cambian. p = { periodo, motivo }
export async function cotQuitarComprobante(p) {
  const d = await dbBase(), per = s(p && p.periodo), motivo = M.texto(p && p.motivo, 300);
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const [cot, pl, vencs] = await Promise.all([todos('cotizaciones'), todos(COL_PL).catch(() => []), todos('vencimientos')]);
  const c0 = compVigente((pl.find(x => x.id === per) || {}).d);
  if (!c0) throw error('Ese mes no tiene comprobante guardado', 'datos');
  // El gasto de multas e intereses: el guardado o, si se creó al pagar el vencimiento, el del mismo comprobante (de la memoria)
  let ids = s(c0.gastoRecargosId) ? [s(c0.gastoRecargosId)] : [];
  if (!ids.length) ids = (await todos('gastos', FB.where('fecha', '==', s(c0.fechaPago)))).filter(x => x.d.previred && x.d.previred.recargos && s(x.d.previred.clave) === s(c0.clave) && x.d.estado === 'vigente').map(x => x.id).slice(0, 5);
  const vid = s(c0.recargosEnVencimiento), v0 = vid ? vencs.find(x => x.id === vid) : null;
  const refP = FB.doc(d, COL_PL, per), refsG = ids.map(id => FB.doc(d, 'gastos', id)), refV = v0 && G3.abierto(v0.d) ? FB.doc(d, 'vencimientos', vid) : null;
  const quien = correo() || 'Sistema Fën', en = M.ahoraChile().texto, cotTotal = delMes(cot, per).reduce((t, x) => t + M.n(x.d.monto), 0);
  const r = await FB.runTransaction(d, async tx => {
    const snP = await tx.get(refP), snG = []; for (const rf of refsG) snG.push(await tx.get(rf));
    const snV = refV ? await tx.get(refV) : null;
    const a = snP.exists() ? snP.data() : null, c = compVigente(a);
    if (!c || s(c.clave) !== s(c0.clave)) return { yaEstaba: true };
    let k = 0, anulados = 0;
    snG.forEach((sn, i) => { if (!sn.exists() || sn.data().estado !== 'vigente') return; tx.update(refsG[i], cambio(sn.data(), 'anuló', { estado: 'anulado', anulado: { el: en, en, por: quien, motivo: 'Comprobante de Previred quitado: ' + motivo, filaOriginal: '' } }, { motivo })); k++; anulados++; });
    if (snV && snV.exists() && G3.abierto(snV.data()) && snV.data().documento && snV.data().documento.previred && snV.data().documento.previred.recargos) {
      const v = snV.data(), plan = { ...v.documento.previred }; delete plan.recargos;
      const monto = D.totalPlan(plan);
      tx.update(refV, cambio(v, 'quitó las multas e intereses del comprobante de Previred', { montoDocumento: monto, documento: { ...v.documento, monto, previred: plan } }, { motivo })); k++;
    }
    const pagos = Array.isArray(a.pagos) ? a.pagos : [], unido = pagos.reduce((t, x) => t + M.n(x.monto), 0), falta = Math.round(cotTotal - unido), completa = unido > 0 && Math.abs(falta) <= 10;
    tx.update(refP, sinPlanilla(cambio(a, 'quitó el comprobante de Previred', { comprobante: null, comprobantesQuitados: (Array.isArray(a.comprobantesQuitados) ? a.comprobantesQuitados : []).concat([{ ...c, quitado: { por: quien, en, motivo } }]),
      total: cotTotal, unido, falta, estado: completa ? 'pagada_conciliada' : unido ? 'parcial' : 'sin_pagos', ...(completa ? {} : { conciliadaEl: '', conciliadaPor: '' }) }, { motivo })));
    k++;
    return { k, anulados };
  });
  if (r.yaEstaba) return { ok: true, yaEstaba: true };
  await despues(r.k);
  return { ok: true, anulados: r.anulados };
}
// v0.67.0 · El aviso de vencimiento de Previred para Hoy y Agenda (de la memoria: sin lecturas por mes)
export async function avisosPreviredHoy() {
  const [cot, pl] = await Promise.all([todos('cotizaciones').catch(() => []), todos(COL_PL).catch(() => [])]);
  const reg = new Set(cot.filter(x => x.d && !x.d.quitadoEnPlanilla).map(x => D.periodoCot(x.d.periodo)).filter(Boolean));
  pl.forEach(x => { if (compVigente(x.d)) reg.add(x.id); });
  // v0.69.5 · "Es lo que falta para cerrar <mes>" si ese mes no está cerrado en Finanzas: solo con fin_cierres ya en la memoria
  // de la sesión (se leyó al abrir Finanzas → Resultados); si no está, sin esa línea (no se lee nada para esto)
  const fc = FB.enMemoriaDocs('fin_cierres');
  return D.conCierre(D.avisosPrevired(M.ahoraChile().dia, [...reg]), fc ? Object.fromEntries(fc.map(x => [x.id, x.d])) : null);
}

// ═══ v0.67.5 · Cambiar el reparto de un trabajador en un mes ya cargado ═══
// p = { periodo, rut, areas: [{ area, pct }], motivo, otrosMeses: bool, vistos: [{ id, version }] (las líneas que viste) }
// Por cada mes: las líneas vigentes del trabajador (de la memoria) se corrigen (área y monto, con su historial y la versión
// revisada en la transacción), las que sobran se anulan y las que faltan se crean (copias de la primera, con su origen). El total
// del mes no cambia. Si el mes todavía no tiene gastos y su vencimiento de Cotizaciones sigue por pagar, se cambia el plan.
// El reparto queda recordado en cotiz_trabajadores (areas, area principal y repartoEn). Un mes cerrado en Finanzas bloquea todo.
const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesTxt = m => `${MESES_TXT[+s(m).slice(5, 7) - 1] || ''} ${s(m).slice(0, 4)}`;
export async function cotCambiarReparto(p, marca) {
  const d = await dbBase(), per = s(p && p.periodo), rut = s(p && p.rut), motivo = M.texto(p && p.motivo, 300);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per) || !rut) throw error('Falta el mes o el trabajador', 'datos');
  if (motivo.length < 3) throw error('Escribe el motivo', 'datos');
  const v = AB.validarAreas(p && p.areas, M.AREAS); if (v.error) throw error(v.error, 'datos');
  const areas = v.areas, clave = marca.t + marca.r;
  const [gs, cat, trab, vencs, cot] = await Promise.all([todos('gastos'), catalogo(), todos('cotiz_trabajadores'), todos('vencimientos'), todos('cotizaciones')]);
  const porT = D.gastosPorTrabajador(gs), k = D.rutCot(rut);
  // ¿Ya quedó (un reintento del mismo envío)?
  if (gs.some(x => x.d.origenDetalle && x.d.origenDetalle.reparto && s(x.d.origenDetalle.marca) === clave) || trab.some(x => x.d.repartoMarca === clave)) return { ok: true, repetido: true };
  const meses = [per].concat(p && p.otrosMeses ? Object.keys(porT).filter(x => x.endsWith('|' + k)).map(x => x.split('|')[0]).filter(m => m !== per).sort() : []);
  // El mes elegido sin gastos: el plan de su vencimiento de Cotizaciones (si sigue por pagar)
  const delMesV = delMes(cot, per), vid = s((delMesV.find(x => x.d.vencimientoId) || { d: {} }).d.vencimientoId), v0 = vid ? vencs.find(x => x.id === vid) : null;
  const planAbierto = !(porT[per + '|' + k] || []).length && v0 && G3.abierto(v0.d) && v0.d.documento && v0.d.documento.previred && (v0.d.documento.previred.trabajadores || []).some(t => D.rutCot(t.rut) === k);
  if (!(porT[per + '|' + k] || []).length && !planAbierto) throw error('Este trabajador no tiene gastos de Previred en ' + mesTxt(per) + ' que se puedan cambiar (lo copiado de la planilla antigua no trae el trabajador). No se cambió nada.', 'datos');
  // Lo que viste: si cambió desde que abriste Meses cargados, no se toca
  const vistos = Array.isArray(p && p.vistos) ? p.vistos : null;
  if (vistos && !planAbierto) {
    const L = porT[per + '|' + k] || [];
    if (L.length !== vistos.length || L.some(x => { const y = vistos.find(z => s(z.id) === x.id); return !y || Number(y.version) !== (Number(x.d.version) || 0); })) throw error('Los gastos de este trabajador cambiaron en otro lado. Vuelve a abrir Meses cargados. No se cambió nada.', 'cambio');
  }
  const planes = meses.map(m => ({ mes: m, lineas: porT[m + '|' + k] || [] })).filter(x => x.lineas.length).map(x => ({ ...x, ...D.planCambioReparto(x.lineas, areas) }));
  const cambian = planes.filter(x => !x.igual);
  // Los meses de Finanzas de esas líneas (por su fecha): un mes cerrado bloquea
  const mesesFin = [...new Set(cambian.flatMap(x => x.lineas.map(g => s(g.d.fecha).slice(0, 7))).filter(Boolean))].sort();
  const nNuevas = cambian.reduce((t, x) => t + x.crear.length, 0), ids = M.idsLineas('gx', marca, nNuevas);
  const escr = cambian.reduce((t, x) => t + x.corregir.length + x.anular.length + x.crear.length, 0) + 2;
  if (escr > MAX_ESCRITURAS) throw error('Son demasiados cambios para hacerlos de una vez: desmarca "Aplicar también a los otros meses" y hazlo mes por mes.', 'datos');
  const lista = cat.lista.filter(i => !i.archivado), quien = correo() || 'Sistema Fën', en = M.ahoraChile().texto;
  const t0 = trab.find(x => D.rutCot(x.d.rut) === k), refT = FB.doc(d, 'cotiz_trabajadores', t0 ? t0.id : D.idTrabajador(rut));
  const refV = planAbierto ? FB.doc(d, 'vencimientos', vid) : null;
  const res = await FB.runTransaction(d, async tx => {
    const snF = []; for (const m of mesesFin) snF.push(await tx.get(FB.doc(d, 'fin_cierres', m)));
    const cerr = mesesFin.filter((m, i) => snF[i].exists() && D.mesCerrado(snF[i].data()));
    if (cerr.length) throw error(`No se cambió nada: ${cerr.map(mesTxt).join(', ')} ${cerr.length === 1 ? 'está cerrado' : 'están cerrados'} en Finanzas. Un mes cerrado no se cambia aquí: reábrelo en Finanzas → Resultados → Cierre de mes (con el motivo), cambia el reparto y vuelve a cerrarlo${p && p.otrosMeses ? ', o desmarca "Aplicar también a los otros meses cargados" si el cerrado es otro mes' : ''}.`, 'cerrado');
    const refsG = cambian.flatMap(x => x.lineas.map(g => FB.doc(d, 'gastos', g.id))), snG = [];
    for (const rf of refsG) snG.push(await tx.get(rf));
    const refsN = ids.map(id => FB.doc(d, 'gastos', id)), snN = []; for (const rf of refsN) snN.push(await tx.get(rf));
    const snT = await tx.get(refT), snV = refV ? await tx.get(refV) : null;
    if (snN.some(x => x.exists())) return { repetido: true };
    // Versión: cada línea sigue vigente y como estaba al abrir (si no, nada)
    const porId = {}; snG.forEach((sn, i) => { porId[refsG[i].id] = sn; });
    for (const x of cambian) for (const g of x.lineas) {
      const sn = porId[g.id];
      if (!sn || !sn.exists() || sn.data().estado !== 'vigente' || (Number(sn.data().version) || 0) !== (Number(g.d.version) || 0)) throw error(`Un gasto de ${mesTxt(x.mes)} cambió en otro lado. Vuelve a abrir Meses cargados. No se cambió nada.`, 'cambio');
    }
    let w = 0, j = 0, corregidas = 0, anuladas = 0, creadas = 0;
    const det = { periodo: '', marca: clave, motivo, por: quien, en };
    for (const x of cambian) {
      for (const c of x.corregir) {
        const a = porId[c.id].data(), cx = M.corregirGasto(a, { item: s(a.itemGasto), area: c.area, fecha: s(a.fecha), monto: c.monto, obs: s(a.observacion) }, lista);
        if (cx.error) throw error(`${mesTxt(x.mes)}: ${cx.error}. No se cambió nada.`, 'datos');
        tx.update(FB.doc(d, 'gastos', c.id), cambio(a, 'cambió el reparto de Previred', cx.campos, { motivo })); w++; corregidas++;
      }
      for (const id of x.anular) { tx.update(FB.doc(d, 'gastos', id), cambio(porId[id].data(), 'anuló', { estado: 'anulado', anulado: { el: en, en, por: quien, motivo: 'Reparto de Previred cambiado: ' + motivo, filaOriginal: '' } }, { motivo })); w++; anuladas++; }
      const base = porId[x.lineas[0].id].data();
      for (const c of x.crear) {
        // Una área nueva que no es la del ítem fijo: la misma revisión del camino de corregir
        const cx = M.corregirGasto(base, { item: s(base.itemGasto), area: c.area, fecha: s(base.fecha), monto: Math.max(1, c.monto), obs: s(base.observacion) }, lista);
        if (cx.error) throw error(`${mesTxt(x.mes)}: ${cx.error}. No se cambió nada.`, 'datos');
        const nv = nuevo(D.lineaReparto(base, c.area, c.monto, { ...det, periodo: x.mes, desde: x.lineas[0].id }), s(base.origen) || 'previred', quien);
        nv.historial = [{ que: 'creó por el cambio de reparto de Previred', por: quien, en, motivo, cambios: { area: { antes: null, despues: c.area }, montoFinal: { antes: null, despues: c.monto } }, desde: x.lineas[0].id }];
        tx.set(refsN[j], nv); j++; w++; creadas++;
      }
    }
    // El mes sin gastos todavía: el plan del vencimiento por pagar (los gastos nacen partidos al pagarlo)
    let enPlan = false;
    if (refV) {
      if (!snV.exists() || !G3.abierto(snV.data()) || !(snV.data().documento && snV.data().documento.previred)) throw error('El vencimiento de Cotizaciones cambió. Vuelve a abrir Meses cargados. No se cambió nada.', 'cambio');
      const va = snV.data(), plan = { ...va.documento.previred, trabajadores: va.documento.previred.trabajadores.map(t => (D.rutCot(t.rut) === k ? { ...t, area: AB.principal(areas), areas } : t)) };
      if (areas.length === 1) plan.trabajadores = plan.trabajadores.map(t => { if (D.rutCot(t.rut) !== k) return t; const y = { ...t }; delete y.areas; return y; });
      tx.update(refV, cambio(va, 'cambió el reparto de Previred', { documento: { ...va.documento, previred: plan } }, { motivo })); w++; enPlan = true;
    }
    // Recordado por RUT (Previred): el reparto, el área principal y cuándo se eligió
    const ta = snT.exists() ? snT.data() : null, campos = { areas, area: AB.principal(areas), repartoEn: en, repartoMarca: clave };
    if (ta) tx.update(refT, cambio(ta, 'cambió el reparto', campos, { motivo })); else tx.set(refT, nuevo({ rut, nombre: s(p && p.nombre), item: s(base0(cambian)), ...campos, actualizado: M.ahoraChile().dia }, 'previred', quien));
    w++;
    return { w, corregidas, anuladas, creadas, enPlan, meses: cambian.map(x => x.mes) };
  });
  if (res.repetido) return { ok: true, repetido: true };
  await despues(res.w);
  return { ok: true, ...res, sinCambios: !cambian.length && !res.enPlan };
}
const base0 = l => (l[0] && l[0].lineas[0] ? s(l[0].lineas[0].d.itemGasto) : '');

// ── Clasificar obligaciones ──
export async function datosClasificar() {
  // v0.63.1: los gastos del último año pagados desde un vencimiento, para proponer "Se paga por"
  const [ps, vencs, siiDocs, fichas, gastos] = await Promise.all([todos('obligaciones'), todos('vencimientos'), todos('sii_docs'), todos('proveedores'),
    todos('gastos', FB.where('fecha', '>=', G3.sumarDias(M.ahoraChile().dia, -365))).then(l => l.filter(x => x.d && x.d.vencimientoId)).catch(() => [])]);
  return { ok: true, obligaciones: D.listaClasificar(ps, vencs, D.proveedoresSii(siiDocs, fichas), M.ahoraChile().dia, gastos) };
}
// lista = [{ id, tipoObligacion, identificador, diasAviso }]. Cada una por su lado: { ok: [ids], errores: [{ id, error }] }
export async function clasificar(lista, avance = () => {}) {
  const d = await dbBase(), [ps, vencs] = await Promise.all([todos('obligaciones'), todos('vencimientos')]);
  const ok = [], errores = [];
  let k = 0;
  for (const x of (Array.isArray(lista) ? lista : [])) {
    k++; avance(k, lista.length);
    try {
      const o = ps.find(y => (s(y.d.id) || y.id) === s(x.id) && !y.d.quitadoEnPlanilla);
      if (!o) throw error('Esa cuenta recurrente ya no existe', 'datos');
      const c = G3.clasificacionDesdeForm({ tipoObligacion: x.tipoObligacion, identificador: x.identificador, diasAviso: x.diasAviso, sePagaPor: x.sePagaPor });
      if (c.error) throw error(c.error, 'datos');
      const pid = s(o.d.id) || o.id, ref = FB.doc(d, 'obligaciones', o.id);
      const recl = c.campos.tipoObligacion !== s(o.d.tipoObligacion) || (c.campos.tipoObligacion === 'documento' && String(c.campos.diasAviso) !== String(o.d.diasAviso)) ? G3.reclasificar(vencs, pid, c.campos) : [];
      const n = await FB.runTransaction(d, async tx => {
        const sn = await tx.get(ref); if (!sn.exists()) throw error('Esa cuenta recurrente ya no existe', 'datos');
        const refsV = recl.map(v => FB.doc(d, 'vencimientos', v.id)), snV = [];
        for (const rv of refsV) snV.push(await tx.get(rv));
        const a = sn.data(); let j = 0;
        if (Object.keys(M.diferencias(a, c.campos)).length) { tx.update(ref, cambio(a, 'clasificó', c.campos)); j++; }
        recl.forEach((v, i) => { if (snV[i].exists() && !snV[i].data().documento) { tx.update(refsV[i], cambio(snV[i].data(), 'tomó el tipo de su cuenta recurrente', v.campos)); j++; } });
        return j;
      });
      await despues(n);
      ok.push(s(x.id));
    } catch (e) { errores.push({ id: s(x.id), error: e.message || String(e) }); }
  }
  return { ok, errores };
}

// ── Arreglo "siniva" ──
export async function previaSiniva() {
  const [gs, vencs, ps] = await Promise.all([todos('gastos', FB.where('fecha', '>=', '2026-01-01')), todos('vencimientos'), todos('obligaciones')]);
  return D.planSiniva(gs, vencs, ps, 2026);
}
// ids: los de la vista previa. De a 100 por transacción; un gasto que cambió desde la vista previa no se toca.
export async function aplicarSiniva(ids, avance = () => {}) {
  const d = await dbBase(), plan = await previaSiniva(), porId = new Map(plan.lista.map(x => [x.id, x]));
  const elegidos = (Array.isArray(ids) ? ids : []).filter(id => porId.has(id));
  let hechos = 0, total = 0;
  for (let i = 0; i < elegidos.length; i += 100) {
    const parte = elegidos.slice(i, i + 100);
    const r = await FB.runTransaction(d, async tx => {
      const refs = parte.map(id => FB.doc(d, 'gastos', id)), sns = [];
      for (const rf of refs) sns.push(await tx.get(rf));
      let h = 0, t = 0;
      sns.forEach((sn, j) => {
        if (!sn.exists()) return;
        const g = sn.data(), c = D.camposSiniva(g);
        if (!c || g.estado !== 'vigente') return;
        tx.update(refs[j], cambio(g, 'ajuste siniva', c, { motivo: 'Pago de una cuenta recurrente sin IVA registrado como bruto: el neto es el monto final' }));
        h++; t += c.montoNeto - M.n(g.montoNeto);
      });
      return { h, t };
    });
    hechos += r.h; total += r.t;
    await despues(r.h);
    avance(Math.min(i + 100, elegidos.length), elegidos.length);
  }
  return { ok: true, ajustados: hechos, diferencia: total };
}
