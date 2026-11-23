// ═══════════════════════════════════════════════
//  Sistema Fën — Cargas del SII con la base nueva (fen-gastos), etapa G3: reglas puras  v0.48.0
//  Lo mismo que hace hoy el script de Gastos (Code.gs v2.5.6 y SistemaFen.gs v1.12.0), escrito para la base nueva:
//  · Qué documentos ya están en Gastos (clavesDesdeFilas: RUT + folio en la observación de los gastos y Detalle Compras),
//    notas por documento (mapaNotasDocs) y coincidencias con gastos a mano (buscarCoincidencias).
//  · El historial de cargas (getCargasSII), con lo importado, lo en duda y lo que tiene detalle.
//  · Importar (sfSiiImportar + importarSII): las mismas revisiones y los mismos gastos: una línea por ítem y área con el
//    bruto de la pantalla y el neto en la proporción real del documento (así el IVA, también el de la harina, cuadra con
//    lo declarado), las notas de crédito en negativo ("NC.<folio>"), un vencimiento si quedó pendiente y el detalle de
//    productos tal cual (Detalle Compras).
//  · Proveedores: la clasificación aprendida (sfSiiClasif) guardada por proveedor (proveedores/{rut}) con las filas que la
//    forman (últimos 2 años) y su posición en la planilla, para dar exactamente lo mismo que el script.
//  Sin red: se prueba sola. Los documentos usan los mismos nombres que la copia G1 (gastos-modelo.armar).
//  v0.67.2: un documento con todos sus gastos anulados ya no cuenta como importado (devueltos).
// ═══════════════════════════════════════════════
import { dia, idLimpio, huella } from './gastos-modelo.js?v=0.138.0';
import { docGasto, docVencimiento, sumarDias, AREAS } from './gastos-g2.js?v=0.138.0';
import { indiceGastos, revisarVuelta } from './sii-pendientes.js?v=0.138.0';

export const RE_FOLIO_OBS = /(?:^|[^A-Za-z])(NC|F)\.(\d+)/;
const s = v => String(v == null ? '' : v);
const t = v => s(v).trim();
const pad = (n, k) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(k, '0');
// sfTexto del script: sin caracteres de control y sin "=", "+", "-" ni "@" al inicio
export const sfTexto = (v, max) => s(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max || 200).replace(/^[=+\-@\s]+/, '').trim();
export const rutOk = r => /^[0-9.]{1,12}-?[0-9kK]$/.test(s(r));
export const folioOk = f => /^\d{1,15}$/.test(s(f));
export const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
const num = v => { const n = Number(v); return isFinite(n) ? n : NaN; };
const areaOk = a => AREAS.includes(s(a));
const pf = v => parseFloat(v) || 0;     // parseFloat(x) || 0, como el script

// ── Claves (claveDocumento) e ids de la base ─────────
export const claveDocumento = (rut, folio, tipo) => t(rut) + '|' + t(folio) + (s(tipo) === '61' ? '|61' : '');
// Mismo id que arma la copia G1 para sii_docs: "<RUT>_<folio>" y "_61" las notas de crédito
const rutClaveDoc = r => t(r).toUpperCase().replace(/[^0-9K-]/g, '');
export const idDoc = (rut, folio, es61) => idLimpio(`${rutClaveDoc(rut) || 'sin-rut'}_${t(folio) || 'sin-folio'}${es61 ? '_61' : ''}`);
export const idCarga = claveDocs => 'sc-' + huella(claveDocs);
// Proveedor (sfRutClave) y producto (sfDescClave), como sii_clasif
export const rutProv = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
export const descClave = x => s(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

const vivo = x => x && x.d && !x.d.quitadoEnPlanilla;
// Gastos que estarían en "Registro Gasto" (los anulados pasan a "Gastos anulados")
export const enRegistro = gastos => (gastos || []).filter(x => vivo(x) && x.d.estado === 'vigente');
// Las líneas de "Detalle Compras" (de todos los documentos)
export const lineasDetalle = docs => (docs || []).filter(vivo).flatMap(x => (Array.isArray(x.d.lineas) ? x.d.lineas : []));

// ── Ya importados (clavesDesdeFilas + claveImportada) ──
// v0.67.2 · Un documento cuyos gastos fueron TODOS anulados ya no cuenta como importado (ni por sus líneas de Detalle Compras, ni
// por estar unido a su gasto): vuelve a por clasificar (sii-pendientes.js: revisarVuelta), también lo de antes, sin esperar a guardarlo
export function devueltos(gastos, docs) {
  const idx = indiceGastos(gastos), out = new Set();
  (docs || []).forEach(x => { if (x && x.d && revisarVuelta(x.id, x.d, idx).vuelve) out.add(x.id); });
  return out;
}
export function clavesImportadas(gastos, docs) {
  const claves = {}, dev = devueltos(gastos, docs);
  docs = (docs || []).filter(x => !(x && dev.has(x.id)));
  enRegistro(gastos).forEach(({ d }) => {
    const rut = t(d.rutProveedor); if (!rut) return;
    const m = s(d.observacion).match(RE_FOLIO_OBS); if (!m) return;
    const esNC = m[1] === 'NC' || parseFloat(d.montoFinal) < 0;
    claves[claveDocumento(rut, m[2], esNC ? '61' : '')] = true;
  });
  const sinTipo = {};
  lineasDetalle(docs).forEach(l => {
    const r2 = t(l.rutProveedor), f2 = t(l.folio);
    if (!r2 || !f2) return;
    const t2 = t(l.tipoDoc);
    if (t2) { claves[claveDocumento(r2, f2, t2)] = true; return; }
    const k2 = r2 + '|' + f2;
    sinTipo[k2] = (sinTipo[k2] || 0) + pf(l.montoNeto);
  });
  Object.keys(sinTipo).forEach(k => { claves[sinTipo[k] < 0 ? k + '|61' : k] = true; });
  // v0.50.0 · factura de un proveedor que es el RUT de una obligación "según documento": quedó en su vencimiento (o en la bandeja), sin gasto todavía
  (docs || []).forEach(x => { const im = x && x.d && x.d.importado; if (im && (im.aVencimiento || im.pendienteId) && im.clave) claves[im.clave] = true; });
  // v0.67.1 · documento por clasificar que quedó unido a su gasto ya registrado (registrado.gastos): ya está en Gastos
  (docs || []).forEach(x => { const rg = x && x.d && !x.d.quitadoEnPlanilla && x.d.registrado; if (rg && Array.isArray(rg.gastos) && rg.gastos.length && !rg.quitado) claves[claveDocumento(x.d.rut, x.d.folio, x.d.tipo)] = true; });
  return claves;
}
// v0.67.1 · La misma clave sin puntos ni guion en el RUT ("96.512.200-1|5" = "96512200-1|5"): el RUT puede venir escrito distinto
// en la planilla antigua y en el archivo del SII
export const claveNorm = k => { const p = s(k).split('|'); return [rutProv(p[0])].concat(p.slice(1)).join('|'); };
export const claveImportada = (claves, k) => !!(claves[k] || (s(k).split('|').length === 2 && claves[k + '|61']));
// Notas por clave (mapaNotasDocs): una nota vacía no cuenta (en la base no se borra: queda vacía)
export function mapaNotas(docs) {
  const m = {};
  (docs || []).filter(vivo).forEach(x => (Array.isArray(x.d.notas) ? x.d.notas : []).forEach(n => { const k = t(n.clave), v = t(n.nota); if (k && v) m[k] = v; }));
  return m;
}
const conDetalle = docs => { const m = {}; lineasDetalle(docs).forEach(l => { m[t(l.rutProveedor) + '|' + t(l.folio)] = true; }); return m; };

// Documentos del archivo (sfDocsValidos): [{rut, folio, tipo, clave, total, fecha, razonSocial}] o null
export function docsValidos(lista, max) {
  if (!Array.isArray(lista) || !lista.length || lista.length > (max || 2000)) return null;
  const out = [];
  for (const d0 of lista) {
    const d = d0 || {}, rut = t(d.rut), folio = t(d.folio);
    if (!rutOk(rut) || !folioOk(folio)) return null;
    const tipo = s(d.tipo) === '61' ? '61' : '';
    out.push({ rut, folio, tipo, clave: claveDocumento(rut, folio, tipo), total: num(d.total) || 0, fecha: esIso(d.fecha) ? d.fecha : '', razonSocial: sfTexto(d.razonSocial, 200) });
  }
  return out;
}

// ── Orden de la planilla (para gastos y detalle) ─────
// Registro Gasto: lo hecho en la base entra arriba (lo más nuevo más arriba) y lo copiado en G1 sigue en su fila;
// los gastos de un pago ("gp-…") van al final. Detalle Compras: lo nuevo se agrega al final.
// "a…" arriba, "b<fila>" lo de G1, "c…" al final. Ids "<prefijo>-<marca>-<azar>-<n>": la línea con n mayor queda más arriba.
const MAX_MS = 9999999999999;
export function posGasto(id, d) {
  if (d && d.hoja === 'Registro Gasto' && Number(d.fila) >= 2) return 'b' + pad(d.fila, 7);
  const m = /^(gs|gp|g)-([0-9a-z]+)-[0-9a-z]{5}-([0-9-]+)$/.exec(s(id));
  if (!m) return 'b~' + s(id);
  const ms = parseInt(m[2], 36), n = Number(m[3].replace(/-/g, '')) || 0;
  return m[1] === 'gp' ? 'c' + pad(ms, 13) + pad(n, 7) : 'a' + pad(MAX_MS - ms, 13) + pad(9999999 - n, 7);
}
export const posLinea = l => (l && l.pos) || (l && Number(l.fila) >= 2 ? 'b' + pad(l.fila, 7) : 'b~');
const porPos = (a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0);

// ── Coincidencias con gastos a mano (buscarCoincidencias), "filas" = ids de los gastos ──
export function coincidencias(gastos, documentos) {
  const filas = enRegistro(gastos).map(x => ({ x, p: posGasto(x.id, x.d) })).sort(porPos).map(y => y.x);
  const grupos = {};
  filas.forEach(({ id, d }) => {
    if (t(d.rutProveedor)) return;   // ya tiene proveedor: vino del SII
    const fechaISO = dia(d.fecha);
    if (!fechaISO) return;
    const clave = fechaISO + '|' + t(d.observacion);
    if (!grupos[clave]) grupos[clave] = { fecha: fechaISO, filas: [], detalleFilas: [], total: 0, items: {}, areas: {}, obs: s(d.observacion), formaPago: s(d.formaPago), espera: false };
    const g = grupos[clave], monto = pf(d.montoFinal);
    if (d.esperaFactura === true) g.espera = true;   // v0.64.0: gasto nuevo desde la cartola de un mes sin el SII cargado
    g.filas.push(id);
    g.detalleFilas.push({ fila: id, monto, item: s(d.itemGasto), area: s(d.area), obs: s(d.observacion) });
    g.total += monto;
    if (d.itemGasto) g.items[s(d.itemGasto)] = true;
    if (d.area) g.areas[s(d.area)] = (g.areas[s(d.area)] || 0) + monto;
  });
  const difDias = (a, b) => Math.abs((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  const resultado = {};
  (documentos || []).forEach(doc => {
    const candidatos = [];
    Object.keys(grupos).forEach(k => {
      const g = grupos[k], dias = difDias(g.fecha, doc.fecha);
      // v0.64.0 · Un gasto de la cartola que espera su factura: la factura puede ser de 5 días antes hasta 30 días después del cargo,
      // y el monto puede diferir en $1 (redondeo del IVA)
      if (g.espera) {
        const dd = Math.round((new Date(doc.fecha + 'T00:00:00') - new Date(g.fecha + 'T00:00:00')) / 86400000);
        if (dd >= -5 && dd <= 30 && Math.abs(Math.round(g.total) - Math.round(Math.abs(doc.total))) <= 1)
          candidatos.push({ fecha: g.fecha, total: Math.round(g.total), items: Object.keys(g.items), areas: Object.keys(g.areas).map(a => ({ area: a, monto: Math.round(g.areas[a]) })),
            obs: g.obs, formaPago: g.formaPago, filas: g.filas.slice(), diasDif: Math.abs(dd), parcial: false, desdeCartola: true });
        return;
      }
      if (dias > 5) return;
      if (Math.round(g.total) === Math.round(Math.abs(doc.total))) {
        candidatos.push({ fecha: g.fecha, total: Math.round(g.total), items: Object.keys(g.items), areas: Object.keys(g.areas).map(a => ({ area: a, monto: Math.round(g.areas[a]) })),
          obs: g.obs, formaPago: g.formaPago, filas: g.filas.slice(), diasDif: dias, parcial: false });
        return;
      }
      g.detalleFilas.forEach(f => {
        if (Math.round(f.monto) !== Math.round(Math.abs(doc.total))) return;
        candidatos.push({ fecha: g.fecha, total: Math.round(f.monto), items: [f.item], areas: f.area ? [{ area: f.area, monto: Math.round(f.monto) }] : [],
          obs: f.obs, formaPago: g.formaPago, filas: [f.fila], diasDif: dias, parcial: true });
      });
    });
    candidatos.sort((a, b) => (b.desdeCartola === true) - (a.desdeCartola === true) || a.diasDif - b.diasDif);
    if (candidatos.length) resultado[doc.rut + '|' + doc.folio] = candidatos.slice(0, 4);
  });
  return resultado;
}

// ── Al abrir un archivo (sfSiiEstado) ─────────────────
export function estado(docs, gastos, siiDocs) {
  const ya = clavesImportadas(gastos, siiDocs), notas = mapaNotas(siiDocs), yaN = new Set(Object.keys(ya).map(claveNorm));
  const importados = [], notasOut = {}, pendientes = [];
  docs.forEach(d => {
    const k = d.clave;
    if (ya[k] || yaN.has(claveNorm(k))) importados.push(k); else if (d.fecha) pendientes.push(d);
    const nota = notas[k] || (d.tipo === '61' ? notas[d.rut + '|' + d.folio] : '');
    if (nota) notasOut[k] = nota;
  });
  const coinc = {};
  [pendientes.filter(d => d.tipo !== '61'), pendientes.filter(d => d.tipo === '61')].forEach(grupo => {
    if (!grupo.length) return;
    const r = coincidencias(gastos, grupo);
    grupo.forEach(d => { const c = r[d.rut + '|' + d.folio]; if (c) coinc[d.clave] = c; });
  });
  return { ok: true, importados, notas: notasOut, coincidencias: coinc };
}

// ── Historial de cargas (getCargasSII) ────────────────
// cargas: [{ id, d }] de sii_cargas (campos de la hoja "Cargas SII": id, fechaCarga, periodoDesde, periodoHasta,
// nombreArchivo, urlArchivo, totalDocs, documentos, nota, quitada)
const posCarga = x => (x.d.hoja === 'Cargas SII' && Number(x.d.fila) >= 2 ? 'a' + pad(x.d.fila, 7) : 'b' + s(x.d.posPlanilla || '') + s(x.id));
export function vistaCargas(cargas, gastos, siiDocs) {
  const ya = clavesImportadas(gastos, siiDocs), notasDocs = mapaNotas(siiDocs), det = conDetalle(siiDocs);
  const out = (cargas || []).filter(vivo).map(x => ({ x, p: posCarga(x) })).sort(porPos).map(y => y.x)
    .filter(({ d }) => !t(d.quitada)).map(({ id, d }) => {
      let docs = [];
      try { docs = JSON.parse(d.documentos || '[]').map(z => (typeof z === 'string' ? { k: z, n: '' } : z)); } catch (e) {}
      const nota = k => notasDocs[k] || notasDocs[s(k).replace(/\|61$/, '')] || '';
      const pendientes = docs.filter(z => !claveImportada(ya, z.k));
      return {
        id: s(d.id || id), fechaCarga: dia(d.fechaCarga) || s(d.fechaCarga), desde: dia(d.periodoDesde) || s(d.periodoDesde), hasta: dia(d.periodoHasta) || s(d.periodoHasta),
        nombreArchivo: s(d.nombreArchivo), url: s(d.urlArchivo), total: docs.length, importados: docs.length - pendientes.length, nota: s(d.nota),
        enDuda: pendientes.filter(z => nota(z.k)).length,
        pendientes: pendientes.map(z => ({ clave: z.k, folio: s(z.k).split('|')[1] || '', razonSocial: z.n || '', nota: nota(z.k) })),
        documentos: docs.map(z => { const p = s(z.k).split('|'); return { clave: z.k, rut: p[0] || '', folio: p[1] || '', tipo: p[2] === '61' ? '61' : '', razonSocial: z.n || '', importado: claveImportada(ya, z.k), nota: nota(z.k), tieneDetalle: !!det[(p[0] || '') + '|' + (p[1] || '')] }; })
      };
    }).filter(c => c.id);
  out.sort((a, b) => (b.desde || '').localeCompare(a.desde || ''));
  return out;
}
// La carga de un archivo (sfSiiCarga): documentos, período y la clave con que se reconoce el mismo archivo
export function datosCarga(docs) {
  const fechas = docs.map(d => d.fecha).filter(String).sort();
  const claveDocs = JSON.stringify(docs.map(d => ({ k: d.clave, n: d.razonSocial || '' })).sort((a, b) => a.k.localeCompare(b.k)));
  return { fechas, claveDocs, desde: fechas[0] || '', hasta: fechas[fechas.length - 1] || '' };
}

// ── Detalle de un documento (getDetalleDocumento) ─────
export function detalleDocumento(siiDocs, rut, folio, tipo) {
  const conTipo = tipo !== undefined, out = { detalle: [], razonSocial: '', fecha: '', folio: t(folio) };
  lineasDetalle(siiDocs).forEach(l => {
    if (t(l.rutProveedor) !== t(rut) || t(l.folio) !== t(folio)) return;
    if (conTipo && t(l.tipoDoc) && (t(l.tipoDoc) === '61') !== (s(tipo) === '61')) return;
    out.razonSocial = s(l.razonSocial); out.fecha = s(l.fecha);
    out.detalle.push({ descripcion: s(l.descripcion), unidad: s(l.unidad), cantidad: l.cantidad || '', precioUnitario: l.precioUnitario || '', precioLista: l.precioLista || '',
      descuento: l.descuento || '', monto: l.montoNeto || 0, item: s(l.itemGasto), area: s(l.area) });
  });
  return out;
}

// ── Importar: las revisiones de sfSiiImportar. lista = ítems vigentes (no archivados) ──
export function limpiarFacturas(facturas, lista) {
  facturas = Array.isArray(facturas) ? facturas : [];
  if (!facturas.length) return { error: 'No hay facturas para importar' };
  if (facturas.length > 300) return { error: 'Son demasiadas de una vez: importa de a 300 como máximo' };
  const porNombre = {}; (lista || []).forEach(i => { porNombre[i.item] = i; });
  const limpias = [], vistas = {};
  for (const f0 of facturas) {
    const f = f0 || {}, rut = t(f.rut), folio = t(f.folio);
    const et = (sfTexto(f.razonSocial, 60) || 'Documento') + ' F.' + folio;
    if (!rutOk(rut) || !folioOk(folio)) return { error: 'Documento no válido (RUT o folio)' };
    const tipoDoc = /^\d{2,3}$/.test(s(f.tipoDoc)) ? s(f.tipoDoc) : (num(f.total) < 0 ? '61' : '33');
    const clave = claveDocumento(rut, folio, tipoDoc);
    if (vistas[clave]) return { error: et + ': viene dos veces' };
    vistas[clave] = true;
    if (!/^\d{2}-\d{2}-\d{4}$/.test(s(f.fechaDocto))) return { error: et + ': falta la fecha del documento' };
    const total = num(f.total), neto = num(f.neto), iva = num(f.iva);
    if (isNaN(total) || isNaN(neto) || isNaN(iva)) return { error: et + ': montos no válidos' };
    if (!['pagada', 'pendiente'].includes(f.estado)) return { error: et + ': falta marcar pagada o pendiente' };
    if (!esIso(f.fechaEstado)) return { error: et + ': falta la fecha' };
    const signo = total < 0 ? -1 : 1;
    if (!Array.isArray(f.lineas) || !f.lineas.length || f.lineas.length > 30) return { error: et + ': falta clasificar el ítem' };
    const lineas = [];
    let suma = 0, nAreas = 0;
    for (const ln0 of f.lineas) {
      const ln = ln0 || {}, ref = porNombre[ln.item];
      if (!ref) return { error: et + ': el ítem "' + sfTexto(ln.item, 60) + '" no está en la lista de ítems' };
      if (!Array.isArray(ln.areas) || !ln.areas.length || ln.areas.length > 12) return { error: et + ' (' + ref.item + '): falta repartir por área' };
      const areas = [];
      for (const x0 of ln.areas) {
        const x = x0 || {}, monto = Math.round(num(x.monto));
        const fija = ref.area !== 'SELECCIONAR' && ref.area !== 'PRORRATEADO';
        if (fija ? s(x.area) !== s(ref.area) : !areaOk(x.area)) return { error: et + ' (' + ref.item + '): área no válida' };
        if (isNaN(monto) || monto * signo < 0 || (!monto && Math.round(total) !== 0)) return { error: et + ' (' + ref.item + '): monto no válido' };
        areas.push({ area: s(x.area), monto });
        suma += monto; nAreas++;
      }
      lineas.push({ item: ref.item, categoria: ref.categoria || '', tipo: ref.tipo || '', subTipo: ref.subTipo || '', areas });
    }
    if (Math.abs(suma - Math.round(total)) > Math.max(1, nAreas)) return { error: et + ': las áreas suman ' + suma + ' y el total es ' + Math.round(total) };
    const detalle = [];
    const det = Array.isArray(f.detalle) ? f.detalle.slice(0, 1000) : [];
    for (const d0 of det) {
      const d = d0 || {};
      if (d.item && !porNombre[d.item]) return { error: et + ': un producto tiene un ítem que no existe' };
      if (d.area && !areaOk(d.area)) return { error: et + ': un producto tiene un área no válida' };
      const numOVacio = v => { const x = num(v); return v === '' || v == null || isNaN(x) ? '' : x; };
      detalle.push({ descripcion: sfTexto(d.descripcion, 300), codigo: sfTexto(d.codigo, 60), unidad: sfTexto(d.unidad, 20),
        cantidad: numOVacio(d.cantidad), precioUnitario: numOVacio(d.precioUnitario), precioLista: numOVacio(d.precioLista),
        descuento: numOVacio(d.descuento), monto: Math.round(num(d.monto)) || 0, item: d.item ? s(d.item) : '', area: d.area ? s(d.area) : '' });
    }
    limpias.push({ rut, folio, tipoDoc, razonSocial: sfTexto(f.razonSocial, 200), fechaDocto: s(f.fechaDocto), total, neto, iva, esHarina: !!f.esHarina,
      estado: f.estado, fechaEstado: f.fechaEstado, lineas, detalle,
      // v0.66.0 · clasificada sola al subir (proveedor conocido), pagada sin saber todavía cómo (espera su pago: cartola, efectivo o tarjeta)
      ...(f.auto === true ? { auto: true } : {}), ...(f.esperaPago === true && f.estado === 'pagada' ? { esperaPago: true } : {}), ...(f.formaPago === 'tarjeta' && f.estado === 'pagada' ? { formaPago: 'tarjeta' } : {}),
      ...(f.pagoSinBanco && typeof f.pagoSinBanco === 'object' ? { pagoSinBanco: { medio: s(f.pagoSinBanco.medio).slice(0, 20), fecha: s(f.pagoSinBanco.fecha).slice(0, 10), ...(f.pagoSinBanco.origen ? { origen: s(f.pagoSinBanco.origen).slice(0, 20) } : {}), ...(f.pagoSinBanco.origenTexto ? { origenTexto: s(f.pagoSinBanco.origenTexto).slice(0, 120) } : {}) } } : {}) });
  }
  return { limpias };
}

// ── Importar (importarSII): qué se escribe por documento ──
// k = posición de la factura en lo enviado (ids fijos por envío: un reintento no duplica).
// Ids: gastos "gs-<marca>-<azar>-<fff>-<nn>" (la primera factura y su primera línea con el número mayor: la copia a la
// planilla los pasa en orden de id y cada uno entra arriba, así quedan como las inserta el script), vencimiento
// "vs-<marca>-<azar>-<kkk>" (al final de Vencimientos, en el orden de las facturas).
export const idsGastosFactura = (marca, k, total, n) => Array.from({ length: n }, (_, i) => `gs-${marca.t}-${marca.r}-${pad(total - 1 - k, 3)}-${pad(n - i, 2)}`);
export const idVencSii = (marca, k) => `vs-${marca.t}-${marca.r}-${pad(k, 3)}`;
export const esNCFactura = f => s(f.tipoDoc) === '61' || f.total < 0;
export function planFactura(f, k, totalFacturas, marca, hora) {
  const esNC = esNCFactura(f), obsBase = (esNC ? 'NC.' : 'F.') + f.folio, docId = idDoc(f.rut, f.folio, esNC);
  const tipoLinea = esNC ? '61' : s(f.tipoDoc || '');
  const filas = [];
  (f.lineas || []).forEach(ln => (ln.areas || []).forEach(a => {
    const bruto = Math.round(a.monto), proporcion = f.total ? bruto / f.total : 0, neto = Math.round(f.neto * proporcion);
    filas.push(docGasto({ fecha: f.fechaDocto, hora, itemGasto: ln.item || '', categoria: ln.categoria || '', tipo: ln.tipo || '', subTipo: ln.subTipo || '', area: a.area,
      tipoMonto: 'bruto', montoNeto: neto, montoFinal: bruto, esHarina: f.esHarina ? 'Sí' : 'No', formaPago: f.estado === 'pagada' ? (f.formaPago === 'tarjeta' ? 'tarjeta' : 'contado') : 'proveedor',
      fechaPago: f.estado === 'pagada' && !f.esperaPago ? f.fechaEstado : '', archivo: '', observacion: obsBase, urlFoto: '' },
    { rutProveedor: f.rut, razonSocial: f.razonSocial, siiDoc: { id: docId, rut: f.rut, folio: f.folio, tipo: s(f.tipoDoc) },
      ...(f.auto ? { clasificacionAutomatica: true } : {}), ...(f.esperaPago ? { esperaPago: true } : {}),
      ...(f.pagoSinBanco ? { medioPago: f.pagoSinBanco.medio, pagoSinBanco: f.pagoSinBanco } : {}) }));
  }));
  const ids = idsGastosFactura(marca, k, totalFacturas, filas.length);
  let venc = null;
  if (f.estado === 'pendiente' && f.fechaEstado) {
    const todas = [];
    (f.lineas || []).forEach(ln => (ln.areas || []).forEach(a => todas.push({ area: a.area, monto: Math.round(a.monto) })));
    const primera = (f.lineas || [])[0] || {};
    venc = docVencimiento({ id: idVencSii(marca, k), plantillaID: '', nombre: '📋 ' + f.razonSocial + ' F.' + f.folio, item: primera.item || '', periodoKey: f.fechaEstado.slice(0, 7),
      fechaVencimiento: f.fechaEstado, montoEstimado: Math.round(f.total), obs: obsBase, area: todas.length === 1 ? todas[0].area : 'MULTI',
      categoria: primera.categoria || '', tipo: primera.tipo || '', subTipo: primera.subTipo || '', multiArea: todas.length > 1 ? JSON.stringify(todas) : '', estado: 'PENDIENTE', fechaCompra: f.fechaDocto });
  }
  const posBase = 'c' + pad(parseInt(marca.t, 36), 13) + pad(k, 3);
  const detalle = (f.detalle || []).map((d, i) => ({ fecha: dia(f.fechaDocto), rutProveedor: f.rut, razonSocial: f.razonSocial, folio: f.folio, descripcion: d.descripcion || '', codigo: d.codigo || '',
    unidad: d.unidad || '', cantidad: d.cantidad || '', precioUnitario: d.precioUnitario || '', precioLista: d.precioLista || '', descuento: d.descuento || '', montoNeto: d.monto || 0,
    itemGasto: d.item || '', area: d.area || '', tipoDoc: tipoLinea, pos: posBase + pad(i, 4) }));
  return { k, f, clave: claveDocumento(f.rut, f.folio, f.tipoDoc), docId, esNC, gastos: filas.map((d, i) => ({ id: ids[i], d })), venc, detalle, posPlanilla: posBase };
}
// Revisa repetidos como importarSII (justo antes de escribir). Sistema Fën siempre manda el tipo de documento.
export function repetidas(limpias, claves) {
  const ya = f => !!claves[claveDocumento(f.rut, f.folio, f.tipoDoc)];
  return limpias.filter(ya);
}
// El documento sii_docs después de importar: lo que tenía (notas, o una carga anterior) más las líneas nuevas
export function docSiiImportado(prev, p, extra) {
  const f = p.f, a = prev || { rut: f.rut, folio: f.folio, tipo: p.esNC ? '61' : '', clave: claveDocumento(f.rut, f.folio, p.esNC ? '61' : ''), razonSocial: f.razonSocial,
    fecha: '', totalNeto: 0, tiposDoc: [], lineas: [], notas: [] };
  // v0.67.2 · Si el documento volvió a por clasificar, sus líneas de antes están en lineasAnuladas: las nuevas ocupan su lugar (la
  // misma fila de Detalle Compras en la planilla, "<documento>#<n>"), sin duplicarse
  const anuladas = Array.isArray(a.lineasAnuladas) ? a.lineasAnuladas : [], base0 = Array.isArray(a.lineas) ? a.lineas.length : 0;
  const filaDe = j => { for (let i = anuladas.length - 1; i >= 0; i--) { const l = anuladas[i]; if (l && l.anulada && Number(l.anulada.k) === j) return Number(l.fila) >= 2 ? Number(l.fila) : 0; } return 0; };
  const nuevas = anuladas.length ? p.detalle.map((l, j) => { const f = filaDe(base0 + j); return f ? { ...l, fila: f } : l; }) : p.detalle;
  const lineas = (Array.isArray(a.lineas) ? a.lineas : []).concat(nuevas);
  const tipos = (Array.isArray(a.tiposDoc) ? a.tiposDoc : []).slice();
  p.detalle.forEach(l => { if (l.tipoDoc && !tipos.includes(l.tipoDoc)) tipos.push(l.tipoDoc); });
  let fecha = a.fecha || ''; p.detalle.forEach(l => { if (l.fecha && (!fecha || l.fecha < fecha)) fecha = l.fecha; });
  const totalNeto = Math.round(((Number(a.totalNeto) || 0) + p.detalle.reduce((x, l) => x + (Number(l.montoNeto) || 0), 0)) * 100) / 100;
  return { ...a, razonSocial: a.razonSocial || f.razonSocial, lineas, tiposDoc: tipos, fecha, totalNeto, posPlanilla: p.posPlanilla,
    importado: { ...(extra || {}), ...(f.auto ? { automatico: true } : {}), clave: p.clave, gastos: p.gastos.map(g => g.id), vencimiento: p.venc ? p.venc.id : '', fechaDocto: f.fechaDocto, total: f.total, neto: f.neto, iva: f.iva,
      estado: f.estado, fechaEstado: f.fechaEstado } };
}
// Vincular (vincularGastoConDocumento): la observación lleva "F.<folio>" (o "NC.<folio>") al inicio, si no lo tenía
export function obsVinculada(obs, folio, tipo) {
  const pref = s(tipo) === '61' ? 'NC.' : 'F.';
  return s(obs).indexOf(pref + folio) === -1 ? (pref + folio + ' ' + s(obs)).trim() : s(obs);
}
// Notas de un documento (guardarNotaDocumento): nota vacía = se borra (en la base queda vacía: no se borra la fila)
export function notasConNota(notas, n) {
  const l = (Array.isArray(notas) ? notas : []).map(x => ({ ...x })), i = l.findIndex(x => t(x.clave) === n.clave);
  if (!n.nota) { if (i < 0 || !t(l[i].nota)) return { notas: l, cambio: false, borrada: true }; l[i].nota = ''; l[i].fecha = n.fecha; return { notas: l, cambio: true, borrada: true }; }
  if (i > -1) { l[i].nota = n.nota; l[i].fecha = n.fecha; } else l.push({ clave: n.clave, rutProveedor: n.rut, razonSocial: n.razonSocial, folio: n.folio, nota: n.nota, fecha: n.fecha });
  return { notas: l, cambio: true, borrada: false };
}
export const docSiiVacio = (rut, folio, es61, razonSocial) => ({ rut: t(rut), folio: t(folio), tipo: es61 ? '61' : '', clave: claveDocumento(rut, folio, es61 ? '61' : ''), razonSocial: t(razonSocial),
  fecha: '', totalNeto: 0, tiposDoc: [], lineas: [], notas: [] });

// ═══════════════════════════════════════════════
//  Proveedores: la clasificación aprendida (sii_clasif), guardada por proveedor
//  proveedores/{rut sin puntos ni guion} = { rut, rutTexto, razonSocial, primera, ultima, documentos, productos,
//    filas: [{ p, g, f, fp, fo, it, a, m }]  (líneas de gasto con RUT, ítem y fecha, sin notas de crédito)
//    prods: [{ p, l, f, d, c, it, a }] }      (productos de Detalle Compras con ítem)
//  p = posición en la planilla (sii_clasif recorre las hojas de arriba hacia abajo). Solo los últimos 2 años.
// ═══════════════════════════════════════════════
export const DIAS_CLASIF = 730;
// Una línea de gasto como la lee sii_clasif (sfLeerFila); null si no cuenta
export function filaGasto(id, d) {
  if (!d || d.quitadoEnPlanilla || d.estado !== 'vigente') return null;
  const r = rutProv(d.rutProveedor), it = s(d.itemGasto), f = dia(d.fecha);
  const obs = s(d.observacion), m = obs.match(RE_FOLIO_OBS), m2 = typeof d.montoFinal === 'number' ? d.montoFinal : pf(d.montoFinal);
  const nc = m ? (m[1] === 'NC' || m2 < 0) : false;
  if (!r || !it || !f || nc) return null;
  return { p: posGasto(id, d), g: s(id), r, f, fp: s(d.formaPago), fo: m ? m[2] : '', it, a: s(d.area), m: m2, rs: t(d.razonSocial) };
}
// Un producto de Detalle Compras; null si no cuenta
export function filaProducto(docId, k, l) {
  const it = t(l.itemGasto), r = rutProv(l.rutProveedor);
  if (!it || !r) return null;
  return { p: posLinea(l), l: s(docId) + '#' + (k + 1), r, f: dia(l.fecha), d: descClave(l.descripcion), c: t(l.codigo) ? descClave(l.codigo) : null, it, a: t(l.area), rs: t(l.razonSocial) };
}
const sinR = ({ r, rs, ...x }) => x;
// Ficha nueva o actualizada con filas y productos (repetidos se reemplazan; lo de más de 2 años se quita)
export function fichaCon(prev, rut, filas, prods, hoy) {
  const desde = sumarDias(hoy, -DIAS_CLASIF);
  const a = prev || { rut, rutTexto: '', razonSocial: '', primera: '', ultima: '', filas: [], prods: [] };
  const ng = new Set(filas.map(x => x.g)), nl = new Set(prods.map(x => x.l));
  const F = (a.filas || []).filter(x => !ng.has(x.g)).concat(filas.map(sinR)).filter(x => x.f >= desde).sort(porPos);
  const P = (a.prods || []).filter(x => !nl.has(x.l)).concat(prods.map(sinR)).filter(x => !x.f || x.f >= desde).sort(porPos);
  const fechas = filas.map(x => x.f).concat(prods.map(x => x.f)).filter(Boolean).sort();
  const rs = filas.concat(prods).filter(x => x.rs).sort((x, y) => (x.f < y.f ? 1 : -1))[0];
  return { ...a, rut, razonSocial: (rs && rs.rs) || a.razonSocial || '', rutTexto: a.rutTexto || '',
    primera: [a.primera, fechas[0]].filter(Boolean).sort()[0] || '', ultima: [a.ultima, fechas[fechas.length - 1]].filter(Boolean).sort().pop() || '',
    documentos: new Set(F.map(x => x.fo || x.f)).size, productos: new Set(P.map(x => x.d)).size, filas: F, prods: P };
}
// Todas las fichas desde los gastos y documentos de la base (botón "Armar fichas de proveedores")
export function armarFichas(gastos, siiDocs, hoy) {
  const porRut = {};
  const de = r => porRut[r] || (porRut[r] = { filas: [], prods: [], ruts: [] });
  (gastos || []).forEach(({ id, d }) => { const x = filaGasto(id, d); if (x) { de(x.r).filas.push(x); if (d.rutProveedor) de(x.r).ruts.push(t(d.rutProveedor)); } });
  (siiDocs || []).filter(vivo).forEach(({ id, d }) => (Array.isArray(d.lineas) ? d.lineas : []).forEach((l, k) => { const x = filaProducto(id, k, l); if (x) { de(x.r).prods.push(x); de(x.r).ruts.push(t(l.rutProveedor)); } }));
  const out = {};
  Object.keys(porRut).forEach(r => { const z = porRut[r]; out[r] = { ...fichaCon(null, r, z.filas, z.prods, hoy), rutTexto: z.ruts[0] || '' }; });
  return out;
}
// Lo que entrega sii_clasif ({ porRut, productos }), con el mismo cálculo y el mismo orden que el script
export function clasifDesdeFichas(fichas, hoy) {
  const desde = sumarDias(hoy, -DIAS_CLASIF), lista = Object.values(fichas || {});
  const filas = [], prods = [];
  lista.forEach(fi => { (fi.filas || []).forEach(x => filas.push({ ...x, r: fi.rut })); (fi.prods || []).forEach(x => prods.push({ ...x, r: fi.rut })); });
  filas.sort(porPos); prods.sort(porPos);
  const docs = {};
  filas.forEach(g => {
    if (!g.r || !g.it || !g.f || g.f < desde) return;
    const clave = g.r + '|' + (g.fo || g.f), d = docs[clave] || (docs[clave] = { rut: g.r, fecha: g.f, forma: g.fp || '', lineas: {} });
    const l = d.lineas[g.it] || (d.lineas[g.it] = { monto: 0, areas: {} });
    const m = Math.abs(g.m) || 0; l.monto += m; if (g.a) l.areas[g.a] = (l.areas[g.a] || 0) + m;
  });
  const porRut = {};
  Object.keys(docs).forEach(c => {
    const d = docs[c], total = Object.keys(d.lineas).reduce((x, it) => x + d.lineas[it].monto, 0) || 1;
    const lineas = Object.keys(d.lineas).sort().map(it => {
      const l = d.lineas[it], areas = Object.keys(l.areas).sort();
      return { item: it, parte: Math.round(l.monto / total * 1000) / 1000, areas: areas.map(a => ({ area: a, pct: Math.round(l.areas[a] / (l.monto || 1) * 100) })) };
    });
    const firma = lineas.map(l => l.item + ':' + l.areas.map(a => a.area).join('+')).join('|');
    const r = porRut[d.rut] || (porRut[d.rut] = { docs: 0, patrones: {} }), p = r.patrones[firma];
    r.docs++;
    if (!r.ultimaFecha || d.fecha > r.ultimaFecha) { r.ultimaFecha = d.fecha; r.forma = d.forma; }
    if (!p) r.patrones[firma] = { n: 1, ultima: d.fecha, lineas };
    else { p.n++; if (d.fecha > p.ultima) { p.ultima = d.fecha; p.lineas = lineas; } }
  });
  Object.keys(porRut).forEach(rut => {
    const r = porRut[rut];
    r.patrones = Object.keys(r.patrones).map(f => r.patrones[f]).sort((a, b) => b.n - a.n || (a.ultima < b.ultima ? 1 : -1)).slice(0, 3);
  });
  const productos = {};
  prods.forEach(x => {
    if (!x.it || !x.r || (x.f && x.f < desde)) return;
    const claves = [x.r + '|d:' + x.d];
    if (x.c !== null && x.c !== undefined) claves.push(x.r + '|c:' + x.c);
    claves.forEach(cl => { const y = productos[cl] || (productos[cl] = { n: 0, op: {} }), o = x.it + '|' + x.a; y.n++; y.op[o] = (y.op[o] || 0) + 1; });
  });
  const prod = {}; let n = 0;
  Object.keys(productos).forEach(cl => {
    if (n >= 6000) return;
    const x = productos[cl], mejor = Object.keys(x.op).sort((a, b) => x.op[b] - x.op[a])[0].split('|');
    prod[cl] = [mejor[0], mejor[1], x.op[mejor.join('|')], x.n]; n++;
  });
  return { ok: true, porRut, productos: prod };
}

// ── v0.53.0 · Aviso "SII sin cargar" (con la base nueva: Hoy y Gastos → Cargas del SII) ──
// cargas: [{ fechaCarga, desde, hasta, quitada }] (vistaCargas o sii_cargas; las quitadas no cuentan). hoy: aaaa-mm-dd.
// · La última carga (por fecha de carga) tiene más de 7 días → "Cargas del SII: la última fue hace N días (dd-mm)…".
// · Desde el día 5 del mes, si ninguna carga tiene documentos del mes anterior (su período desde–hasta toca ese mes)
//   → "Falta cargar el SII de <mes>". Sin cargas, solo puede salir el segundo. [] = sin aviso.
export const DIAS_AVISO_SII = 7, DIA_AVISO_MES_SII = 5;
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const diasEntreIso = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
export function avisosSii(cargas, hoy) {
  const h = dia(hoy);
  if (!h) return [];
  const vivas = (cargas || []).filter(c => c && !t(c.quitada) && !c.quitadoEnPlanilla);
  const out = [];
  const ultima = vivas.map(c => dia(c.fechaCarga)).filter(Boolean).sort().pop() || '';
  if (ultima) {
    const n = diasEntreIso(ultima, h);
    if (n > DIAS_AVISO_SII) out.push({ clave: 'antigua', dias: n, fecha: ultima, texto: `Cargas del SII: la última fue hace ${n} días (${ultima.slice(8, 10)}-${ultima.slice(5, 7)}). Sube las compras del SII.` });
  }
  if (Number(h.slice(8, 10)) >= DIA_AVISO_MES_SII) {
    const y = +h.slice(0, 4), m = +h.slice(5, 7), py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const mes = `${py}-${String(pm).padStart(2, '0')}`, ini = mes + '-01', fin = mes + '-' + String(new Date(Date.UTC(py, pm, 0)).getUTCDate()).padStart(2, '0');
    const cubre = vivas.some(c => { const a = dia(c.desde) || dia(c.hasta), b = dia(c.hasta) || a; return a && a <= fin && b >= ini; });
    if (!cubre) out.push({ clave: 'mes', mes, texto: `Falta cargar el SII de ${MESES_L[pm - 1]}${py !== y ? ' ' + py : ''}` });
  }
  return out;
}
