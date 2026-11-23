// ═══════════════════════════════════════════════
//  Sistema Fën — Cargas del SII con la base nueva (fen-gastos), etapa G3  v0.48.0
//  Se usa solo cuando config/gastos dice fuente = "base". Mismas respuestas que el script de Gastos
//  (sii_estado, sii_cargas, sii_archivo, sii_detalle, sii_carga, sii_importar, sii_vincular, sii_nota_doc,
//  sii_nota_carga, sii_quitar_carga, sii_clasif): sii.js elige uno u otro.
//  · El archivo del SII sigue yendo a Drive con el script ("Fën · Gastos / Cargas SII / año", privado: op archivo_subir)
//    y se vuelve a abrir con el script (op sii_archivo con su enlace). La carga y sus documentos quedan en la base:
//    sii_cargas (una por archivo) y sii_docs (cada documento con su detalle de productos y sus notas).
//  · Importar crea los gastos como el script (gastos-sii.js), con origen "sii" y el documento (siiDoc: rut, tipo, folio),
//    y deja al día la ficha de cada proveedor (proveedores/{rut}) con lo aprendido para sugerir la próxima vez.
//  · Cada escritura lleva marcaBase() (pasa sola a la planilla: Registro Gasto, Vencimientos, Detalle Compras,
//    Cargas SII y Notas Documentos) y después notarEscritura() + la copia a la planilla. Nada se borra:
//    quitar una carga la marca "quitada" (quién y cuándo) y no toca sus gastos, como el script.
//  · v0.50.0: la factura de un proveedor cuyo RUT es el identificador de una obligación "según documento" (internet, gas,
//    teléfono) no crea un gasto al importar: completa el vencimiento del período de esa obligación (monto = total de la
//    factura, fecha = su vencimiento o 30 días después de emitida, documento { tipo: 'sii', rut, folio }). El gasto se crea
//    al pagarlo (cartola o Pagar). Si no calza con un vencimiento (o hay más de una obligación con ese RUT), va a la bandeja
//    "Documentos sin obligación". Al abrir el archivo, estado() dice a dónde va ("Va al vencimiento de Internet oct").
//  · v0.53.0: el documento del vencimiento guarda también neto, iva, exento, otroImpuesto, total, tipoDoc y esHarina de la
//    factura (también al asignarla desde la bandeja): al pagarlo, el gasto toma el neto exacto. avisoCargas(): "SII sin cargar".
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as S from './gastos-sii.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import { dbBase, todos, catalogo, nuevo, nuevoVenc, despues, limpio, correo, completarCon } from './gastos-fs.js?v=0.138.0';

const error = (msg, code, datos) => Object.assign(new Error(msg), { code, ...(datos ? { datos } : {}) });
const s = v => String(v == null ? '' : v);
const hoy = () => M.ahoraChile().dia;
// Cambio sin copiar listas enteras al historial (las líneas de un documento pueden ser cientos)
const cambioLigero = (a, que, campos, extra, por) => limpio({ ...campos, version: (Number(a && a.version) || 0) + 1,
  historial: M.conHistorial(a && a.historial, { que, por: por || correo(), en: M.ahoraChile().texto, ...(extra || {}) }), ...GB.marcaBase(por) });
const leer = () => Promise.all([todos('gastos'), todos('sii_docs')]);

// ── Al abrir un archivo ──
export async function estado(documentos) {
  const docs = S.docsValidos(documentos);
  if (!docs) throw error('El archivo no trae documentos válidos', 'datos');
  const [gastos, siiDocs, ps, vencs] = await Promise.all([todos('gastos'), todos('sii_docs'), todos('obligaciones'), todos('vencimientos')]);
  const r = S.estado(docs, gastos, siiDocs);
  // v0.50.0 · A qué vencimiento va cada factura de un RUT que identifica a una obligación "según documento"
  const ya = new Set(r.importados || []), aVenc = {};
  docs.forEach(d => {
    if (ya.has(d.clave) || d.tipo === '61') return;
    const x = destinoFactura(ps, vencs, d.rut, G3.fechaFacturaSii('', d.fecha));
    if (x) aVenc[d.clave] = x;
  });
  return { ...r, aVencimiento: aVenc };
}
// Obligaciones "según documento" activas con ese RUT como identificador
const obligacionesRut = (ps, rut) => G3.obligacionesDe(ps, rut).filter(x => G3.tipoDe(x.d) === 'documento');
// { obligacionId, nombre, vencimientoId, texto } o { bandeja: true, texto } o null (no es de una obligación)
function destinoFactura(ps, vencs, rut, fecha) {
  const l = obligacionesRut(ps, rut);
  if (!l.length) return null;
  if (l.length > 1) return { bandeja: true, texto: `Va a "Documentos sin cuenta recurrente": ${l.length} cuentas recurrentes tienen ese RUT` };
  const o = l[0], pid = s(o.d.id) || o.id, v = G3.elegirVencimiento(vencs, pid, fecha);
  const f = v ? (s(v.d.fechaVencimiento).slice(0, 10)) : fecha;
  return { obligacionId: pid, nombre: s(o.d.nombre), vencimientoId: v ? v.id : '', texto: `Va al vencimiento de ${s(o.d.nombre)} ${mesCorto(f)}`.trim() };
}
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesCorto = f => (/^\d{4}-\d{2}/.test(s(f)) ? MESES_C[Number(s(f).slice(5, 7)) - 1] : '');

// ── Historial de cargas ──
export async function cargas() {
  const [c, gastos, siiDocs] = await Promise.all([todos('sii_cargas'), todos('gastos'), todos('sii_docs')]);
  return { ok: true, cargas: S.vistaCargas(c, gastos, siiDocs), fuente: 'base' };
}

// ── Subir un archivo: a Drive con el script; la carga, a la base. El mismo archivo otra vez actualiza la misma carga. ──
const TIPOS_ARCHIVO = ['text/xml', 'application/xml', 'text/csv', 'text/plain', 'text/html', 'application/vnd.ms-excel', 'application/octet-stream'];
export async function registrarCarga(p, subir) {
  const docs = S.docsValidos(p.documentos);
  if (!docs) throw error('El archivo no trae documentos válidos', 'datos');
  const nombre = S.sfTexto(s(p.nombreArchivo || 'archivo-sii.txt').replace(/[/\\]/g, '_'), 120) || 'archivo-sii.txt';
  const tipo = TIPOS_ARCHIVO.includes(s(p.mimeType)) ? s(p.mimeType) : 'text/plain';
  const b64 = typeof p.archivoBase64 === 'string' ? p.archivoBase64 : '';
  if (b64.length > 14 * 1024 * 1024) throw error('El archivo es demasiado grande (más de 10 MB)', 'datos');
  const c = S.datosCarga(docs);
  if (c.claveDocs.length > 49000) throw error('El archivo trae demasiados documentos para el historial (divídelo en dos períodos)', 'datos');
  let url = '';
  if (b64) { try { url = (await subir({ tipo: 'sii', fecha: c.hasta || c.desde || '', imageData: b64, mimeType: tipo, fileName: nombre })).url || ''; } catch (e) { /* como el script: la carga queda igual */ } }
  const d = await dbBase(), lista = await todos('sii_cargas');
  const ya = lista.find(x => !x.d.quitadoEnPlanilla && s(x.d.documentos) === c.claveDocs);
  const id = ya ? ya.id : S.idCarga(c.claveDocs), ref = FB.doc(d, 'sii_cargas', id);
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref);
    if (sn.exists()) {
      const a = sn.data(), campos = {};
      if (url) campos.urlArchivo = url;
      if (s(a.quitada).trim()) { campos.quitada = ''; campos.quitadaPor = null; }   // vuelve a cargarse: deja de estar quitada
      if (Object.keys(campos).length) tx.update(ref, cambioLigero(a, 'volvió a subirse', campos));
      return { ok: true, id: s(a.id || id), actualizada: true, conArchivo: !!url, n: Object.keys(campos).length ? 1 : 0 };
    }
    tx.set(ref, nuevo({ id, fechaCarga: hoy(), periodoDesde: c.desde, periodoHasta: c.hasta, nombreArchivo: nombre, urlArchivo: url, totalDocs: docs.length,
      documentos: c.claveDocs, nota: '', quitada: '', posPlanilla: 'c' + Date.now().toString().padStart(13, '0') }, 'sii'));
    return { ok: true, id, conArchivo: !!url, n: 1 };
  });
  await despues(r.n);
  delete r.n;
  return r;
}

// ── Reabrir: el archivo lo lee el script desde Drive con su enlace ──
export async function archivo(id, leerEnlace) {
  const lista = await todos('sii_cargas');
  const x = lista.find(y => !y.d.quitadoEnPlanilla && s(y.d.id || y.id) === s(id));
  if (!x) throw error('Carga no encontrada', 'datos');
  if (!s(x.d.urlArchivo)) throw error('Esta carga no tiene archivo guardado', 'datos');
  return leerEnlace(s(x.d.urlArchivo));
}

export async function detalle(rut, folio, tipo) {
  if (!S.rutOk(rut) || !S.folioOk(folio)) throw error('Documento no válido', 'datos');
  const r = S.detalleDocumento(await todos('sii_docs'), rut, folio, tipo === undefined ? undefined : (s(tipo) === '61' ? '61' : ''));
  return { ok: true, ...r };
}

// ── Importar ──
// marca: fija por envío (gastos.js): un reintento usa los mismos ids y no repite lo que ya quedó.
const LOTE = 400;
export async function importar(facturas, omitirRepetidas, marca, origen) {
  // v0.50.0: las que van al vencimiento de su obligación, aparte (no crean gastos al importar)
  const aVenc = (Array.isArray(facturas) ? facturas : []).filter(f => f && f.aVencimiento), resto = (Array.isArray(facturas) ? facturas : []).filter(f => !(f && f.aVencimiento));
  if (!aVenc.length) return importarGastos(resto, omitirRepetidas, marca, origen);
  const r = resto.length ? await importarGastos(resto, omitirRepetidas, marca, origen) : { ok: true, filas: 0, vencimientos: 0, detalle: 0, facturas: 0 };
  const v = await importarAVencimientos(aVenc, marca);
  return { ...r, facturas: (r.facturas || 0) + v.facturas, detalle: (r.detalle || 0) + v.detalle, aVencimientos: v.aVencimientos, aBandeja: v.aBandeja, destinos: v.destinos };
}
// Cada factura: completa el vencimiento de su obligación (o va a la bandeja) y queda como importada en sii_docs (con sus productos).
// Repetir no duplica: si el vencimiento ya tiene esa factura, o la bandeja ya la tiene, solo se anota en sii_docs.
async function importarAVencimientos(lista, marca) {
  const out = { facturas: 0, detalle: 0, aVencimientos: 0, aBandeja: 0, destinos: [] };
  const d = await dbBase(), hora = M.ahoraChile().hora, clave = marca.t + marca.r, por = correo();
  for (let k = 0; k < lista.length; k++) {
    const f0 = lista[k], rut = s(f0.rut).trim(), folio = s(f0.folio).trim(), total = Math.round(Number(f0.total));
    if (!S.rutOk(rut) || !S.folioOk(folio) || !(total > 0)) throw error(`${s(f0.razonSocial)} F.${folio}: documento no válido`, 'datos');
    const f = { rut, folio, razonSocial: S.sfTexto(f0.razonSocial, 200), tipoDoc: s(f0.tipoDoc) || '33', fechaDocto: s(f0.fechaDocto), total, neto: Number(f0.neto) || 0, iva: Number(f0.iva) || 0, esHarina: false, lineas: [], detalle: Array.isArray(f0.detalle) ? f0.detalle : [] };
    const fISO = M.esIso(f.fechaDocto) ? f.fechaDocto : S.esIso(dmaIso(f.fechaDocto)) ? dmaIso(f.fechaDocto) : '';
    const fv = G3.fechaFacturaSii(s(f0.fechaVencimiento), fISO), claveDoc = S.claveDocumento(rut, folio, ''), docId = S.idDoc(rut, folio, false);
    const plan = S.planFactura(f, k, lista.length, marca, hora);
    const [ps, vencs, pend, snD] = await Promise.all([todos('obligaciones'), todos('vencimientos'), todos('documentos_pendientes'), FB.getDoc(FB.doc(d, 'sii_docs', docId))]);
    const prev = snD.exists() ? snD.data() : null;
    if (prev && prev.importado && prev.importado.clave === claveDoc && !prev.quitadoEnPlanilla) { out.facturas++; continue; }   // ya quedó
    // v0.53.0: con los montos exactos de la factura (neto, IVA, exento, otros impuestos, total): el gasto toma ese neto al pagar
    const montos = G3.montosSii({ neto: f0.neto, iva: f0.iva, exento: f0.exento, otroImpuesto: f0.otroImpuesto, total, tipoDoc: f.tipoDoc, esHarina: f0.esHarina });
    const doc = { tipo: 'sii', rut, folio, numero: folio, razonSocial: f.razonSocial, monto: total, fechaVencimiento: fv, cliente: rut, siiDocId: docId, ...montos };
    let destino = null;
    const ya = vencs.find(x => x.d.documento && x.d.documento.tipo === 'sii' && S.rutProv(x.d.documento.rut) === S.rutProv(rut) && s(x.d.documento.folio) === folio);
    const enBandeja = pend.find(x => s(x.d.clave) === claveDoc && x.d.estado === 'pendiente');
    if (ya) destino = { vencimientoId: ya.id, obligacion: s(ya.d.nombre) };
    else if (enBandeja) destino = { pendienteId: enBandeja.id };
    else {
      const l = obligacionesRut(ps, rut);
      let motivo = l.length > 1 ? `Hay ${l.length} cuentas recurrentes con ese RUT` : 'Ninguna cuenta recurrente tiene ese RUT';
      if (l.length === 1) { try { const r = await completarCon(l[0], doc, ''); destino = { vencimientoId: r.vencimientoId, obligacion: r.obligacion }; } catch (e) { motivo = e.message || String(e); } }
      if (!destino) {
        const idP = 'dp-' + marca.t + '-' + marca.r + '-' + k, refP = FB.doc(d, 'documentos_pendientes', idP);
        await FB.runTransaction(d, async tx => {
          if ((await tx.get(refP)).exists()) return;
          tx.set(refP, nuevo({ id: idP, tipo: 'sii', estado: 'pendiente', motivo, cliente: rut, rut, folio, numero: folio, razonSocial: f.razonSocial, empresa: f.razonSocial, monto: total, fechaVencimiento: fv,
            archivo: { url: '', nombre: '' }, clave: claveDoc, siiDocId: docId, montosSii: montos }, 'sii'));
        });
        await despues(1);
        destino = { pendienteId: idP, motivo };
      }
    }
    // El documento queda como importado (con sus productos en Detalle Compras): no se vuelve a ofrecer
    const refD = FB.doc(d, 'sii_docs', docId);
    await FB.runTransaction(d, async tx => {
      const sn = await tx.get(refD), a = sn.exists() ? sn.data() : null;
      const docN = S.docSiiImportado(a, plan, { marca: clave, en: M.ahoraChile().texto, por });
      docN.importado = { ...docN.importado, ...(destino.vencimientoId ? { aVencimiento: destino.vencimientoId } : { pendienteId: destino.pendienteId }), fechaVencimiento: fv };
      const campos = Object.fromEntries(Object.entries(docN).filter(([kk]) => !['origen', 'creado', 'version', 'historial', 'planillaPendiente', 'hechoEnBase', 'editado'].includes(kk)));
      if (a) tx.update(refD, cambioLigero(a, 'importó (al vencimiento de su cuenta recurrente)', campos, { productos: plan.detalle.length })); else tx.set(refD, nuevo(campos, 'sii'));
    });
    await despues(1);
    out.facturas++; out.detalle += plan.detalle.length;
    if (destino.vencimientoId) out.aVencimientos++; else out.aBandeja++;
    out.destinos.push({ rut, folio, razonSocial: f.razonSocial, ...destino });
  }
  return out;
}
const dmaIso = t => { const m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(s(t)); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
async function importarGastos(facturas, omitirRepetidas, marca, origen) {
  const cat = await catalogo();
  const l = S.limpiarFacturas(facturas, cat.lista.filter(i => !i.archivado));
  if (l.error) throw error(l.error, 'datos');
  const limpias = l.limpias, hora = M.ahoraChile().hora;
  const planes = limpias.map((f, k) => S.planFactura(f, k, limpias.length, marca, hora));
  // v0.63.1: de qué carga y de qué archivo sale cada gasto (para "Ver origen" y la conciliación)
  const o = origen || {}, fmt0 = ['xml', 'detalle', 'registro'].includes(s(o.formato)) ? s(o.formato) : '', quienImp = correo(), enImp = M.ahoraChile().texto;
  planes.forEach(p => p.gastos.forEach(g => { g.d.origenDetalle = { tipo: 'sii', formato: fmt0, archivo: S.sfTexto(s(o.archivo), 120), cargaId: s(o.cargaId).slice(0, 80), docId: p.docId, lineasDetalle: p.detalle.length, por: quienImp, en: enImp }; }));
  const [gastos, siiDocs] = await leer();
  const existentes = new Set(gastos.map(x => x.id));
  // Lo que ya quedó de este mismo envío (se cortó y se reintenta) no se repite ni cuenta como repetido
  const hechos = planes.filter(p => existentes.has(p.gastos[0].id)), faltan = planes.filter(p => !existentes.has(p.gastos[0].id));
  const resumen = ps => ({ filas: ps.reduce((x, p) => x + p.gastos.length, 0), vencimientos: ps.filter(p => p.venc).length, detalle: ps.reduce((x, p) => x + p.detalle.length, 0) });
  if (!faltan.length) return { ok: true, ...resumen(planes), facturas: limpias.length, repetido: true };
  const claves = S.clavesImportadas(gastos, siiDocs);
  const rep = S.repetidas(faltan.map(p => p.f), claves);
  let aEscribir = faltan;
  if (rep.length && !omitirRepetidas) {
    throw error(rep.length + ' documento(s) ya estaban importados. No se guardó nada.', 'duplicados',
      { duplicados: rep.map(f => ({ rut: f.rut, folio: f.folio, razonSocial: f.razonSocial, total: f.total })), nuevas: faltan.length - rep.length });
  }
  if (omitirRepetidas) {
    const r = new Set(rep.map(f => S.claveDocumento(f.rut, f.folio, f.tipoDoc)));
    aEscribir = faltan.filter(p => !r.has(p.clave));
    if (!aEscribir.length && !hechos.length) throw error('Todas las facturas ya estaban importadas', 'datos');
  }
  // Por partes de hasta ~400 escrituras, de la última factura a la primera: en la planilla quedan en el orden del archivo
  const partes = [];
  let parte = [], n = 0;
  aEscribir.slice().reverse().forEach(p => {
    const w = p.gastos.length + (p.venc ? 1 : 0) + 2;
    if (parte.length && n + w > LOTE) { partes.push(parte); parte = []; n = 0; }
    parte.push(p); n += w;
  });
  if (parte.length) partes.push(parte);
  const d = await dbBase(), dia = hoy(), clave = marca.t + marca.r, por = correo();
  let escritos = 0, hechas = 0;
  try {
    for (const ps of partes) {
      escritos += await FB.runTransaction(d, async tx => {
        const refsD = ps.map(p => FB.doc(d, 'sii_docs', p.docId)), refsG = ps.map(p => FB.doc(d, 'gastos', p.gastos[0].id));
        const ruts = [...new Set(ps.flatMap(p => p.gastos.map(g => S.rutProv(g.d.rutProveedor)).concat(p.detalle.map(x => S.rutProv(x.rutProveedor)))).filter(Boolean))];
        const refsP = ruts.map(r => FB.doc(d, 'proveedores', r));
        const sD = [], sG = [], sP = [];
        for (const r of refsD) sD.push(await tx.get(r));
        for (const r of refsG) sG.push(await tx.get(r));
        for (const r of refsP) sP.push(await tx.get(r));
        const nuevasFilas = {}, nuevosProds = {};
        let k = 0;
        ps.forEach((p, i) => {
          if (sG[i].exists()) return;   // ya quedó (otra pestaña con el mismo envío)
          const prev = sD[i].exists() ? sD[i].data() : null;
          if (prev && prev.importado && prev.importado.clave === p.clave && prev.importado.marca !== clave && !prev.quitadoEnPlanilla)
            throw error(`${p.f.razonSocial} F.${p.f.folio}: otro equipo lo acaba de importar. No se guardó nada de esta parte.`, 'duplicados', { duplicados: [{ rut: p.f.rut, folio: p.f.folio, razonSocial: p.f.razonSocial, total: p.f.total }], nuevas: 0 });
          p.gastos.forEach(g => tx.set(FB.doc(d, 'gastos', g.id), nuevo(g.d, 'sii')));
          if (p.venc) tx.set(FB.doc(d, 'vencimientos', p.venc.id), nuevoVenc(p.venc, 'sii'));   // v0.49.0: estado nuevo (por_pagar)
          const base = prev && Array.isArray(prev.lineas) ? prev.lineas.length : 0;
          const docN = S.docSiiImportado(prev, p, { marca: clave, en: M.ahoraChile().texto, por });
          const campos = Object.fromEntries(Object.entries(docN).filter(([kk]) => !['origen', 'creado', 'version', 'historial', 'planillaPendiente', 'hechoEnBase', 'editado'].includes(kk)));
          if (prev) tx.update(refsD[i], cambioLigero(prev, 'importó', campos, { gastos: p.gastos.length, productos: p.detalle.length }));
          else tx.set(refsD[i], nuevo(campos, 'sii'));
          k += p.gastos.length + (p.venc ? 1 : 0) + 1;
          p.gastos.forEach(g => { const x = S.filaGasto(g.id, g.d); if (x) (nuevasFilas[x.r] = nuevasFilas[x.r] || []).push(x); });
          p.detalle.forEach((ln, j) => { const x = S.filaProducto(p.docId, base + j, ln); if (x) (nuevosProds[x.r] = nuevosProds[x.r] || []).push(x); });
        });
        ruts.forEach((r, i) => {
          if (!nuevasFilas[r] && !nuevosProds[r]) return;
          const prev = sP[i].exists() ? sP[i].data() : null;
          const fi = S.fichaCon(prev, r, nuevasFilas[r] || [], nuevosProds[r] || [], dia);
          if (!fi.rutTexto) fi.rutTexto = (ps.find(p => S.rutProv(p.f.rut) === r) || { f: {} }).f.rut || '';
          tx.set(refsP[i], limpio({ ...fi, actualizado: { en: FB.serverTimestamp(), por, que: 'importó' } }));
        });
        return k;
      });
      hechas++;
    }
  } catch (e) {
    if (!hechas) throw e;
    await despues(escritos);
    throw error(`La importación se cortó a medias (${e.message}). Vuelve a presionar Importar: lo que ya quedó no se repite.`, 'a_medias');
  }
  await despues(escritos);
  try { await FB.setDoc(FB.doc(d, 'config', 'proveedores'), { actualizado: FB.serverTimestamp(), por, que: 'importó' }, { merge: true }); } catch (e) {}
  const r = resumen(aEscribir.concat(hechos));
  return { ok: true, ...r, facturas: limpias.length };
}

// ── Vincular un gasto registrado a mano con un documento ("filas" = ids de los gastos que sugirió estado()) ──
export async function vincular(p) {
  const rut = s(p.rut).trim(), folio = s(p.folio).trim();
  if (!S.rutOk(rut) || !S.folioOk(folio)) throw error('Documento no válido', 'datos');
  const ids = Array.isArray(p.filas) ? p.filas.map(s) : [];
  if (!ids.length || ids.length > 60 || ids.some(x => !/^[A-Za-z0-9_-]{1,150}$/.test(x))) throw error('Faltan las filas del gasto', 'datos');
  if (!S.esIso(p.fecha)) throw error('Falta la fecha del gasto', 'datos');
  const tipo = s(p.tipo) === '61' ? '61' : '', razon = S.sfTexto(p.razonSocial, 200);
  const [gastos, siiDocs] = await leer();
  if (S.clavesImportadas(gastos, siiDocs)[S.claveDocumento(rut, folio, tipo)]) throw error('Ese documento ya quedó en Gastos (otro equipo lo importó o vinculó).', 'datos');
  const d = await dbBase(), refs = ids.map(id => FB.doc(d, 'gastos', id)), rp = S.rutProv(rut), refP = FB.doc(d, 'proveedores', rp);
  const CAMBIO = 'La planilla cambió desde que se buscó la coincidencia. Vuelve a abrir el archivo para buscarla de nuevo.';
  const docId = S.idDoc(rut, folio, tipo === '61');
  await FB.runTransaction(d, async tx => {
    const sns = [];
    for (const r of refs) sns.push(await tx.get(r));
    const sp = await tx.get(refP);
    let suma = 0;
    sns.forEach(sn => {
      const g = sn.exists() ? sn.data() : null;
      if (!g || g.estado !== 'vigente' || g.quitadoEnPlanilla || s(g.rutProveedor).trim() || s(g.fecha).slice(0, 10) !== p.fecha) throw error(CAMBIO, 'cambio');
      suma += parseFloat(g.montoFinal) || 0;
    });
    if (Math.abs(Math.round(suma) - Math.round(Number(p.total))) > (sns.some(sn => sn.data().esperaFactura === true) ? 1 : 0)) throw error(CAMBIO, 'cambio');
    const filas = [];
    sns.forEach((sn, i) => {
      const g = sn.data(), obs = S.obsVinculada(g.observacion, folio, tipo), m = obs.match(S.RE_FOLIO_OBS);
      const campos = { rutProveedor: rut, razonSocial: razon, observacion: obs, folio: m ? m[2] : '', esNC: m ? (m[1] === 'NC' || Number(g.montoFinal) < 0) : false, siiDoc: { id: docId, rut, folio, tipo }, ...(g.esperaFactura === true ? { esperaFactura: false } : {}) };
      tx.update(refs[i], cambioLigero(g, 'vinculó', campos, { documento: S.claveDocumento(rut, folio, tipo) }));
      const x = S.filaGasto(ids[i], { ...g, ...campos }); if (x) filas.push(x);
    });
    if (filas.length) {
      const fi = S.fichaCon(sp.exists() ? sp.data() : null, rp, filas, [], hoy());
      if (!fi.rutTexto) fi.rutTexto = rut;
      tx.set(refP, limpio({ ...fi, actualizado: { en: FB.serverTimestamp(), por: correo(), que: 'vinculó' } }));
    }
  });
  await despues(ids.length);
  return { ok: true, filas: ids.length };
}

// ── Notas ──
export async function notaDoc(p) {
  const rut = s(p.rut).trim(), folio = s(p.folio).trim();
  if (!S.rutOk(rut) || !S.folioOk(folio)) throw error('Documento no válido', 'datos');
  const es61 = s(p.tipo) === '61', clave = S.claveDocumento(rut, folio, es61 ? '61' : ''), nota = S.sfTexto(p.nota, 500), razon = S.sfTexto(p.razonSocial, 200);
  const d = await dbBase(), ref = FB.doc(d, 'sii_docs', S.idDoc(rut, folio, es61));
  const r = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref), a = sn.exists() ? sn.data() : null;
    const x = S.notasConNota(a ? a.notas : [], { clave, rut, folio, razonSocial: razon, nota, fecha: hoy() });
    if (!x.cambio) return { ok: true, borrada: x.borrada, n: 0 };
    if (a) tx.update(ref, cambioLigero(a, nota ? 'nota' : 'borró la nota', { notas: x.notas }, { nota }));
    else tx.set(ref, nuevo({ ...S.docSiiVacio(rut, folio, es61, razon), notas: x.notas, posPlanilla: 'n' + Date.now() }, 'sii'));
    return { ok: true, borrada: x.borrada, n: 1 };
  });
  await despues(r.n);
  return { ok: true, borrada: !!r.borrada };
}
async function cargaPorId(id) {
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(s(id))) throw error('Falta la carga', 'datos');
  const d = await dbBase();
  const sn = await FB.getDoc(FB.doc(d, 'sii_cargas', s(id)));
  if (sn.exists() && !sn.data().quitadoEnPlanilla) return { d, ref: FB.doc(d, 'sii_cargas', s(id)) };
  const x = (await todos('sii_cargas')).find(y => !y.d.quitadoEnPlanilla && s(y.d.id) === s(id));
  if (!x) throw error('Carga no encontrada', 'datos');
  return { d, ref: FB.doc(d, 'sii_cargas', x.id) };
}
export async function notaCarga(id, nota) {
  const { d, ref } = await cargaPorId(id), texto = S.sfTexto(nota, 1000);
  const n = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Carga no encontrada', 'datos');
    const a = sn.data(); if (s(a.nota) === texto) return 0;
    tx.update(ref, cambioLigero(a, 'nota de la carga', { nota: texto }, { nota: texto }));
    return 1;
  });
  await despues(n);
  return { ok: true };
}
// No se borra: queda "quitada" con la fecha y quién (como el script). Los gastos importados no se tocan.
export async function quitarCarga(id) {
  const { d, ref } = await cargaPorId(id), por = correo() || 'Sistema Fën';
  const n = await FB.runTransaction(d, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw error('Carga no encontrada', 'datos');
    const a = sn.data(); if (s(a.quitada).trim()) return 0;
    tx.update(ref, cambioLigero(a, 'quitó del historial', { quitada: hoy() + ' · ' + por, quitadaPor: { por, en: M.ahoraChile().texto } }));
    return 1;
  });
  await despues(n);
  return { ok: true };
}

// ── Proveedores ──
export async function clasif() {
  const l = await todos('proveedores'), fichas = {};
  l.forEach(x => { fichas[x.id] = { ...x.d, rut: x.d.rut || x.id }; });
  return S.clasifDesdeFichas(fichas, hoy());
}
// Una vez (Gastos → Configuración → Base nueva): arma la ficha de cada proveedor con lo copiado de la planilla y lo hecho en la base
export async function armarProveedores(avance = () => {}) {
  avance('Leyendo gastos y documentos del SII…');
  const [gastos, siiDocs, prev] = await Promise.all([todos('gastos'), todos('sii_docs'), todos('proveedores')]);
  const fichas = S.armarFichas(gastos, siiDocs, hoy()), d = await dbBase(), por = correo();
  const ids = Object.keys(fichas), conDatos = ids.length;
  // Las que ya no tienen nada en los últimos 2 años quedan vacías (no se borran)
  prev.forEach(x => { if (!fichas[x.id]) { fichas[x.id] = { ...x.d, filas: [], prods: [], documentos: 0, productos: 0 }; ids.push(x.id); } });
  // v0.64.0: lo puesto a mano en la ficha (nombre, glosas de la cartola, ítem y área usuales) no se pierde al rearmar
  prev.forEach(x => { const f = fichas[x.id], a = x.d || {}; if (!f) return; ['manual', 'nombre', 'glosas', 'item', 'area', 'archivado', 'historial', 'version', 'creado', 'glosaAprendida'].forEach(k => { if (a[k] !== undefined && f[k] === undefined) f[k] = a[k]; }); });
  let hechos = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const b = FB.writeBatch(d);
    ids.slice(i, i + 200).forEach(id => b.set(FB.doc(d, 'proveedores', id), limpio({ ...fichas[id], actualizado: { en: FB.serverTimestamp(), por, que: 'armó las fichas' } })));
    await b.commit();
    hechos = Math.min(ids.length, i + 200);
    avance(`Guardando fichas… ${hechos} de ${ids.length}`);
  }
  await FB.setDoc(FB.doc(d, 'config', 'proveedores'), { armadas: FB.serverTimestamp(), actualizado: FB.serverTimestamp(), por, n: conDatos, que: 'armó las fichas' }, { merge: true });
  return { ok: true, proveedores: conDatos, total: ids.length };
}
// Para "Gastos → Configuración → Base nueva": cuántas fichas hay y cuándo se actualizaron
export async function resumenProveedores() {
  const d = await dbBase();
  const [n, c, l] = await Promise.all([FB.getAggregateFromServer(FB.collection(d, 'proveedores'), { n: FB.count() }), FB.getDoc(FB.doc(d, 'config', 'proveedores')), todos('proveedores')]);
  const lista = l.map(x => ({ rut: x.d.rutTexto || x.id, razonSocial: x.d.razonSocial || '', documentos: Number(x.d.documentos) || 0, productos: Number(x.d.productos) || 0, ultima: x.d.ultima || '' }))
    .sort((a, b) => b.documentos - a.documentos || a.razonSocial.localeCompare(b.razonSocial));
  return { n: Number(n.data().n) || 0, meta: c.exists() ? c.data() : null, lista };
}

// ── v0.53.0 · Aviso "SII sin cargar" (Hoy y Cargas del SII): solo lee sii_cargas ──
export async function avisoCargas() {
  const l = await todos('sii_cargas');
  return S.avisosSii(l.map(x => ({ fechaCarga: x.d.fechaCarga, desde: x.d.periodoDesde, hasta: x.d.periodoHasta, quitada: x.d.quitada, quitadoEnPlanilla: x.d.quitadoEnPlanilla })), hoy());
}
