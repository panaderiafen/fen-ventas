// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas · precio desde la última compra del SII (F1 paso 2): reglas puras, sin red  v0.57.0
//  · normalizarItem / claveAsoc: el nombre de un producto de la factura, comparable ("HARINA SACO 25KG" = "harina saco 25 kg"),
//    y la clave de su asociación (RUT del proveedor + nombre + código si la factura lo trae).
//  · contenidoDeLinea: lo que trae UNA unidad facturada, desde la unidad (KG, LT…) o el nombre ("25 KG", "1 LT X12"…).
//  · precioUnitarioNeto / precioPorBaseLinea: neto de una unidad facturada (con su descuento) y su precio por g, ml o un.
//  · lineasCompras / agrupar: líneas de facturas de los últimos 90 días, agrupadas por proveedor + producto.
//  · sugerirMp: materias primas con nombre parecido (primero en el selector).
//  · decidir / planPrecios: qué precio se aplica, cuál queda "por confirmar" (más de ±40 %) y cuál se salta.
//  · armarAsociacion: el documento de costos_asoc y su historial (costos_asoc_hist).
//  Todo en neto. Se prueba solo: pruebas/sistemafen/finanzas-f1b.test.js.
// ═══════════════════════════════════════════════
import { num, parsearContenido, contenidoValido, IVA } from './finanzas-costos.js?v=0.138.0';

export const DIAS_COMPRAS = 90;
export const LIMITE_PCT = 40;
export const TIPOS_PRECIO = ['33', '34', ''];   // factura, factura exenta y (copiado de la planilla) sin tipo
const s = v => (v === null || v === undefined ? '' : String(v));
const sinTildes = t => s(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const redondear = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
export const rutProv = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaCorta = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(f)); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '—'; };
const UNIDAD_TXT = { g: 'peso (kg o g)', ml: 'volumen (l o ml)', un: 'unidades' };

// ── Nombre comparable: sin tildes, minúsculas, número y unidad separados ("25KG" → "25 kg", "X12" → "x 12") ──
export function normalizarItem(t) {
  return sinTildes(t).replace(/(\d),(\d)/g, '$1.$2').replace(/[^a-z0-9.]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim();
}
const slug = t => normalizarItem(t).replace(/\./g, '_').replace(/ /g, '-').replace(/[^a-z0-9_-]/g, '');
// Id del documento costos_asoc: rut + nombre (+ código). Sin "/" ni caracteres raros.
export function claveAsoc(rut, nombre, codigo) {
  const c = slug(codigo);
  return (`${rutProv(rut) || 'sin-rut'}__${slug(nombre).slice(0, 100) || 'sin-nombre'}${c ? '__c-' + c.slice(0, 30) : ''}`).slice(0, 150);
}
// Id del documento costos_sii_procesadas / costos_por_confirmar para una línea ("<docId>#<n>")
export const idLinea = lineId => s(lineId).replace(/#/g, '__L').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);

// ── Lo que trae UNA unidad facturada ──
// Si la factura cobra por kg, g, l o ml (UnmdItem), una unidad trae 1 de eso (el nombre no manda: "JAMÓN 500G" en KG cobra por kg).
// Si no (UN, SACO, CJ, vacío…), se lee el nombre: "SACO 25 KG" → 25 kg; "1 LT X12" → paquete de 12 × 1 l = 12 l;
// "250G X 40" → 10 kg; "X50" sin peso → 50 un. "30 UN" queda dudoso (¿cobra el paquete o una?). Siempre se confirma al asociar.
const MEDIBLES = [[/^(kg|kgs|kilo|kilos|kilogramos?|k)$/, 'g', 1000], [/^(g|gr|grs|gramos?)$/, 'g', 1], [/^(l|lt|lts|litros?|ltr)$/, 'ml', 1000], [/^(ml|cc|mililitros?)$/, 'ml', 1]];
const UNIDAD_RE = '(kgs?|kilos?|grs?|gramos?|g|lts?|litros?|l|ml|cc|unidades|unidad|unids?|und|un|u)';
export function contenidoDeLinea(descripcion, unidad) {
  const u = sinTildes(unidad).replace(/[^a-z]/g, '');
  const med = MEDIBLES.find(([re]) => re.test(u));
  if (med) return { contenido: { cantidad: med[2], unidad: med[1] }, dudoso: false, de: 'unidad', motivo: '' };
  let t = normalizarItem(descripcion), mult = 1;
  // "6 x 1 lt" (paquete con su contenido): parsearContenido ya lo entiende
  const conPack = new RegExp('\\d+(?:\\.\\d+)?\\s*x\\s*\\d+(?:\\.\\d+)?\\s*' + UNIDAD_RE + '(?![a-z])').test(t);
  if (!conPack) {
    // "x 12" o "12 x" sueltos: paquete de 12
    const mx = new RegExp('(?:^|\\s)x\\s(\\d+)(?!\\s*(?:\\.\\d|' + UNIDAD_RE + '(?![a-z])))(?=\\s|$)').exec(t) || /(?:^|\s)(\d+)\sx(?=\s|$)(?!\s\d)/.exec(t);
    if (mx && Number(mx[1]) > 1) { mult = Number(mx[1]); t = (t.slice(0, mx.index) + ' ' + t.slice(mx.index + mx[0].length)).replace(/\s+/g, ' ').trim(); }
  }
  const p = parsearContenido(t);
  if (p.contenido) return { contenido: { cantidad: redondear(p.contenido.cantidad * mult), unidad: p.contenido.unidad }, dudoso: false, de: 'nombre', motivo: '' };
  if (p.dudoso && p.sugerido) return { contenido: { cantidad: redondear(p.sugerido.cantidad * mult), unidad: 'un' }, dudoso: true, de: 'nombre', motivo: `¿La factura cobra el paquete de ${p.sugerido.cantidad * mult} o una unidad?` };
  if (mult > 1 && !/\d/.test(t)) return { contenido: { cantidad: mult, unidad: 'un' }, dudoso: false, de: 'nombre', motivo: '' };
  if (/^(un|u|und|unid|unids|unidad|unidades)$/.test(u) && !/\d/.test(t)) return { contenido: { cantidad: 1, unidad: 'un' }, dudoso: false, de: 'unidad', motivo: '' };
  return { contenido: null, dudoso: false, de: '', motivo: p.motivo && !/Sin unidad|no reconocida/.test(p.motivo) ? p.motivo : 'No dice cuánto trae una unidad: escríbelo' };
}
// El contenido escrito en el formulario (kg, g, l, ml, un) → { cantidad, unidad g|ml|un }
export function contenidoDesdeForm(cantidad, unidad) {
  const f = { kg: ['g', 1000], g: ['g', 1], l: ['ml', 1000], ml: ['ml', 1], un: ['un', 1] }[s(unidad)], c = num(cantidad);
  return f && c > 0 ? { cantidad: redondear(c * f[1]), unidad: f[0] } : null;
}

// ── Precio de una línea ──
// Neto de UNA unidad facturada: PrcItem menos el descuento de la línea (DescuentoMonto ÷ cantidad); si no viene PrcItem,
// MontoItem ÷ QtyItem (ya trae el descuento). Una factura afecta (33) trae los productos en neto; la exenta (34) no tiene IVA.
export function precioUnitarioNeto(l) {
  const q = num(l && l.cantidad), pl = num(l && l.precioLista), d = num(l && l.descuento), m = num(l && (l.montoNeto ?? l.monto)), pu = num(l && l.precioUnitario);
  if (pl > 0) { const x = pl - (q > 0 && d > 0 ? d / q : 0); if (x > 0) return redondear(x, 4); }
  if (q > 0 && m > 0) return redondear(m / q, 4);
  if (pu > 0) return redondear(pu, 4);
  return null;
}
export function precioPorBaseLinea(l, contenido) {
  const pu = precioUnitarioNeto(l);
  if (!(pu > 0) || !contenidoValido(contenido)) return null;
  return redondear(pu / num(contenido.cantidad), 8);
}

// ── Líneas de compra de los últimos N días (sii_docs como [{ id, d }]) ──
const dmaIso = t => { const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s(t)); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const isoDe = t => (/^\d{4}-\d{2}-\d{2}/.test(s(t)) ? s(t).slice(0, 10) : dmaIso(t));
export function restarDias(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); }
// v0.101.1 · Con el Gastos nuevo, las compras del SII de desde el inicio están en gn_documentos (no en sii_docs). Se entregan en la misma forma
// para los precios de las materias primas: una línea por producto del detalle (el XML trae descripción, cantidad, unidad y monto neto).
// Lo cargado sin detalle (el RCV) queda en "sin detalle", como antes. Las notas de crédito no dan precio.
export const fechaDocSii = d => isoDe(d && d.fecha) || isoDe(d && d.importado && d.importado.fechaDocto);
// v0.103.0 · El flete de una compra (factura aparte, unida a esa compra en Gastos) se suma a su costo: cada línea sube en la misma proporción
// (flete repartido entre las compras unidas según su valor). Así el precio de la materia prima es el puesto en Fën. La línea lleva cuánto flete
// se le sumó (flete): si se une después, la línea se vuelve a revisar.
const baseDoc = d => (num(d.neto) + num(d.exento)) || num(d.total);
export function fleteDeCompras(docs) {
  const porId = Object.fromEntries((docs || []).filter(Boolean).map(d => [d.id, d])), extra = {};
  (docs || []).filter(f => f && f.estado !== 'no_va' && f.flete && (f.flete.docs || []).length).forEach(f => {
    const L = f.flete.docs.map(i => porId[i]).filter(x => x && x.estado !== 'no_va' && x.id !== f.id), pesos = L.map(x => Math.max(0, baseDoc(x))), t = pesos.reduce((a, b) => a + b, 0);
    if (t > 0) L.forEach((x, i) => { extra[x.id] = (extra[x.id] || 0) + baseDoc(f) * pesos[i] / t; });
  });
  return extra;
}
export function siiDocsDeGN(docs, inicio = '') {
  const extra = fleteDeCompras(docs);
  return (docs || []).filter(d => d && d.origen === 'sii' && d.estado !== 'no_va' && s(d.fecha) >= s(inicio)).map(d => { const b = baseDoc(d), f = extra[d.id] && b > 0 ? 1 + extra[d.id] / b : 1;
    return { id: 'gn_' + d.id, d: {
    fecha: s(d.fecha), tipo: s(d.tipo), tiposDoc: [s(d.tipo)], rut: s(d.rut), razonSocial: s(d.razon), folio: s(d.folio), importado: { fechaDocto: s(d.fecha) },
    lineas: (d.detalle || []).map(l => { const pu = num(l.precioUnitario) || (num(l.cantidad) ? num(l.monto) / num(l.cantidad) : 0);
      return { descripcion: s(l.descripcion), codigo: s(l.codigo), unidad: s(l.unidad), cantidad: num(l.cantidad), montoNeto: redondear(num(l.monto) * f, 2), precioUnitario: redondear(pu * f, 4), tipoDoc: s(d.tipo), ...(f !== 1 ? { flete: Math.round(num(l.monto) * (f - 1)) } : {}) }; }) } }; });
}
export function lineasCompras(siiDocs, { hoy, dias = DIAS_COMPRAS } = {}) {
  const desde = restarDias(hoy, dias), lineas = [], sinDetalle = [];
  (siiDocs || []).forEach(({ id, d }) => {
    if (!d || d.quitadoEnPlanilla) return;
    const ls = Array.isArray(d.lineas) ? d.lineas : [];
    const fechaDoc = isoDe(d.fecha) || isoDe(d.importado && d.importado.fechaDocto);
    const tipoDoc = s(d.tipo) === '61' ? '61' : s((d.tiposDoc || [])[0]);
    if (!ls.length) {
      if (d.importado && tipoDoc !== '61' && fechaDoc >= desde && fechaDoc <= hoy)
        sinDetalle.push({ docId: id, rut: s(d.rut), proveedor: s(d.razonSocial), folio: s(d.folio), fecha: fechaDoc });
      return;
    }
    ls.forEach((l, k) => {
      const fecha = isoDe(l.fecha) || fechaDoc;
      if (!fecha || fecha < desde || fecha > hoy) return;
      const tipo = s(l.tipoDoc) || (s(d.tipo) === '61' ? '61' : '');
      const esNC = tipo === '61' || num(l.montoNeto) < 0;
      const rut = s(l.rutProveedor || d.rut), descripcion = s(l.descripcion).trim(), codigo = s(l.codigo).trim();
      if (!descripcion) return;
      lineas.push({ id: `${id}#${k + 1}`, docId: id, rut, proveedor: s(l.razonSocial || d.razonSocial), folio: s(l.folio || d.folio), fecha, tipoDoc: tipo, esNC,
        paraPrecio: !esNC && TIPOS_PRECIO.includes(tipo), descripcion, codigo, unidad: s(l.unidad).trim(), cantidad: num(l.cantidad),
        precioLista: num(l.precioLista), descuento: num(l.descuento), montoNeto: num(l.montoNeto), precioUnitario: num(l.precioUnitario), ...(num(l.flete) ? { flete: num(l.flete) } : {}),
        clave: claveAsoc(rut, descripcion, codigo) });
    });
  });
  return { lineas, sinDetalle, desde };
}
// a más nueva que b: fecha y, si empata, folio mayor
export const comparar = (a, b) => (s(a.fecha) < s(b.fecha) ? -1 : s(a.fecha) > s(b.fecha) ? 1 : (num(a.folio) - num(b.folio)));

// ── Agrupar por proveedor + producto (lo que se ve en "Compras del SII") ──
export function agrupar(lineas, asocs) {
  const g = {};
  (lineas || []).forEach(l => {
    const x = g[l.clave] || (g[l.clave] = { clave: l.clave, rut: l.rut, proveedor: l.proveedor, nombreItem: l.descripcion, codigo: l.codigo, unidad: l.unidad, lineas: [], facturas: new Set(), ncs: 0, ultima: null });
    x.lineas.push(l);
    if (l.esNC) { x.ncs++; return; }
    if (!l.paraPrecio) return;
    x.facturas.add(l.docId);
    if (!x.ultima || comparar(l, x.ultima) > 0) { x.ultima = l; x.nombreItem = l.descripcion; x.unidad = l.unidad; x.proveedor = l.proveedor || x.proveedor; }
  });
  return Object.values(g).map(x => {
    const a = (asocs || {})[x.clave] || null;
    const estado = !a ? 'sin_asociar' : a.ignorar ? 'ignorada' : 'asociada';
    return { ...x, veces: x.facturas.size, facturas: undefined, asoc: a, estado, precioUnitario: x.ultima ? precioUnitarioNeto(x.ultima) : null };
  }).sort((a, b) => (a.estado === 'sin_asociar' ? 0 : 1) - (b.estado === 'sin_asociar' ? 0 : 1) || s(a.proveedor).localeCompare(s(b.proveedor), 'es') || s(a.nombreItem).localeCompare(s(b.nombreItem), 'es'));
}

// ── Sugerencias por nombre parecido ──
const VACIAS = new Set(['saco', 'sacos', 'caja', 'cajas', 'cj', 'bolsa', 'bolsas', 'kg', 'kgs', 'kilo', 'kilos', 'gr', 'grs', 'lt', 'lts', 'litro', 'litros', 'ml', 'cc', 'un', 'und', 'unid', 'unidad', 'unidades',
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'x', 'pack', 'paquete', 'bandeja', 'tarro', 'frasco', 'botella', 'formato', 'granel']);
const palabras = t => normalizarItem(t).split(' ').filter(w => w.length >= 3 && !/\d/.test(w) && !VACIAS.has(w));
const parecidas = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
export function sugerirMp(nombreItem, costos, max = 5) {
  const pi = palabras(nombreItem);
  if (!pi.length) return [];
  return Object.values(costos || {}).filter(m => m && m.tipo !== 'sub_receta' && m.estado !== 'archivada').map(m => {
    const pm = palabras(m.nombre);
    if (!pm.length) return null;
    const enItem = pi.filter(w => pm.some(v => parecidas(w, v))).length, enMp = pm.filter(v => pi.some(w => parecidas(w, v))).length;
    if (!enItem) return null;
    return { id: m.id, nombre: m.nombre, puntaje: redondear((enItem / pi.length + enMp / pm.length) / 2, 4) };
  }).filter(Boolean).sort((a, b) => b.puntaje - a.puntaje || s(a.nombre).localeCompare(s(b.nombre), 'es')).slice(0, max);
}

// ── La asociación (costos_asoc/{clave}) y su historial ──
// datos: { rut, proveedor, nombreItem, codigo, mp (id) | null, ignorar, contenido: { cantidad, unidad: kg|g|l|ml|un }, nota }
// mpDoc: costos_mp de la materia prima elegida (para revisar que la unidad calce).
export function armarAsociacion(prev, datos, { hoy, por, mpDoc } = {}) {
  const ignorar = !!datos.ignorar;
  const base = { rut: s(datos.rut), rutKey: rutProv(datos.rut), proveedor: s(datos.proveedor).slice(0, 200), nombreItem: s(datos.nombreItem).slice(0, 300), nombreNorm: normalizarItem(datos.nombreItem).slice(0, 300), codigo: s(datos.codigo).slice(0, 60) };
  let doc;
  if (ignorar) doc = { ...base, mp: null, mpNombre: '', ignorar: true, contenidoPorUnidad: null };
  else {
    const mp = s(datos.mp);
    if (!mp) throw new Error('Elige la materia prima o insumo (o marca "No es materia prima").');
    if (mpDoc && mpDoc.tipo === 'sub_receta') throw new Error('Una sub receta no se compra: elige una materia prima o insumo.');
    const c = contenidoDesdeForm(datos.contenido && datos.contenido.cantidad, datos.contenido && datos.contenido.unidad);
    if (!c) throw new Error('Escribe cuánto trae una unidad de la factura (cantidad y unidad).');
    if (mpDoc && contenidoValido(mpDoc.contenido) && mpDoc.contenido.unidad !== c.unidad)
      throw new Error(`${mpDoc.nombre || 'Esa materia prima'} se compra por ${UNIDAD_TXT[mpDoc.contenido.unidad]}: escribe el contenido en ${UNIDAD_TXT[mpDoc.contenido.unidad]}.`);
    doc = { ...base, mp, mpNombre: s(mpDoc && mpDoc.nombre), ignorar: false, contenidoPorUnidad: c };
  }
  const ahora = { por: por || '', fecha: hoy || '' };
  const cambia = !prev || prev.mp !== doc.mp || !!prev.ignorar !== doc.ignorar || JSON.stringify(prev.contenidoPorUnidad || null) !== JSON.stringify(doc.contenidoPorUnidad);
  const accion = !prev ? (ignorar ? 'ignoró' : 'asoció') : ignorar ? 'cambió a "no es materia prima"' : prev.ignorar ? 'asoció (antes ignorada)' : 'cambió la asociación';
  const full = { ...doc, creada: prev && prev.creada ? prev.creada : ahora, actualizada: ahora, version: (num(prev && prev.version) || 0) + (cambia ? 1 : 0) };
  const hist = cambia ? { accion, nota: s(datos.nota).slice(0, 300), antes: prev ? { mp: prev.mp || null, mpNombre: prev.mpNombre || '', ignorar: !!prev.ignorar, contenidoPorUnidad: prev.contenidoPorUnidad || null } : null,
    despues: { mp: doc.mp, mpNombre: doc.mpNombre, ignorar: doc.ignorar, contenidoPorUnidad: doc.contenidoPorUnidad }, por: por || '', fecha: hoy || '' } : null;
  return { doc: full, hist, cambia };
}
// Cambia si cambia a qué materia prima va o cuánto trae: así las líneas se vuelven a revisar con la asociación nueva
export const huellaAsoc = a => JSON.stringify([a && a.mp || null, !!(a && a.ignorar), (a && a.contenidoPorUnidad) || null]);

// ── ¿Se aplica el precio de esta compra? ──
// mp: costos_mp; cand: { ppb, unidad, contenidoFactura, fecha, folio, rut, proveedor, nombreItem, linea }
// → { accion: 'aplicar' | 'confirmar' | 'omitir', clave, motivo, nuevo: { precioNeto, precioPorBase, contenido, contenidoAdoptado }, pct }
// Reglas: el precio de la planilla es solo de partida (cualquier compra lo reemplaza); uno a mano se respeta si es del mismo día
// o más nuevo que la factura; uno del SII solo lo cambia una compra más nueva (mismo día: folio mayor).
// Si cambia más de ±40 % contra el precio actual, no se aplica solo: queda "por confirmar".
export function decidir(mp, cand, { limitePct = LIMITE_PCT, forzar = false } = {}) {
  const omitir = (clave, motivo) => ({ accion: 'omitir', clave, motivo });
  if (!mp) return omitir('sin_mp', 'La materia prima no está en el maestro de costos');
  if (mp.tipo === 'sub_receta') return omitir('sub_receta', 'Es una sub receta: su costo sale de su receta');
  if (mp.estado === 'archivada') return omitir('archivada', 'La materia prima está archivada');
  if (!(num(cand && cand.ppb) > 0) || !contenidoValido(cand.contenidoFactura)) return omitir('sin_precio', 'La línea no trae precio o cantidad');
  const cv = contenidoValido(mp.contenido);
  if (cv && mp.contenido.unidad !== cand.contenidoFactura.unidad)
    return omitir('unidad', `La factura viene en ${UNIDAD_TXT[cand.contenidoFactura.unidad]} y la materia prima se compra por ${UNIDAD_TXT[mp.contenido.unidad]}`);
  const origen = mp.origen || 'planilla';
  if (origen === 'manual' && !(s(cand.fecha) > s(mp.fecha))) return omitir('manual', `Hay un precio a mano del ${fechaCorta(mp.fecha)}, igual o más nuevo que la factura`);
  if (origen === 'sii' && mp.sii) {
    // v0.103.0: la misma línea con otro precio (se le sumó su flete) sí se aplica
    const misma = rutProv(mp.sii.rut) === rutProv(cand.rut) && s(mp.sii.folio) === s(cand.folio) && s(mp.sii.linea || '') === s(cand.linea || '');
    if (misma && Math.abs(num(mp.precioPorBase) - num(cand.ppb)) <= Math.max(1e-9, num(cand.ppb) * 1e-6)) return omitir('igual', 'Ya es el precio actual');
    if (!misma && comparar(cand, mp.sii) <= 0) return omitir('mas_nueva', `El precio actual viene de una compra más nueva (${s(mp.sii.proveedor)} F.${s(mp.sii.folio)}, ${fechaCorta(mp.sii.fecha)})`);
  }
  const contenido = cv ? { cantidad: num(mp.contenido.cantidad), unidad: mp.contenido.unidad } : { ...cand.contenidoFactura };
  const precioNeto = redondear(cand.ppb * contenido.cantidad, 2), ppb = redondear(cand.ppb, 8);
  const ant = num(mp.precioPorBase), pct = ant > 0 ? redondear((ppb - ant) / ant * 100, 2) : null;
  const nuevo = { precioNeto, precioPorBase: ppb, contenido, contenidoAdoptado: !cv };
  if (!forzar && pct !== null && Math.abs(pct) > limitePct) return { accion: 'confirmar', clave: 'limite', motivo: `Cambia ${pct > 0 ? '+' : ''}${pct.toLocaleString('es-CL', { maximumFractionDigits: 1 })} % (más de ±${limitePct} %)`, nuevo, pct };
  return { accion: 'aplicar', clave: 'ok', motivo: '', nuevo, pct };
}
// El candidato de una línea con su asociación
export function candidato(l, a) {
  return { ppb: precioPorBaseLinea(l, a.contenidoPorUnidad), contenidoFactura: a.contenidoPorUnidad, fecha: l.fecha, folio: l.folio, rut: l.rut, proveedor: l.proveedor,
    nombreItem: l.descripcion, linea: l.id, unitario: precioUnitarioNeto(l), unidadFactura: l.unidad, asoc: l.clave };
}

// ── Plan de una revisión (idempotente) ──
// lineas: de lineasCompras (con clave); asocs: { clave: doc }; costos: { mpId: doc }; procesadas: { idLinea: { huella } };
// pendientes: costos_por_confirmar con estado "pendiente" [{ id, mp, sii: { fecha, folio } }].
// → { aplicar: [{ mp, cand, d }], confirmar: [{ mp, cand, d }], marcar: [{ linea, asoc, mp, huella, resultado, motivo }], reemplazar: [ids] }
// Una línea ya revisada con la misma asociación no se vuelve a mirar (no repite el historial).
// Varias compras de la misma materia prima: gana la más nueva (mismo día: folio mayor); las otras quedan "hay una más nueva".
export function planPrecios({ lineas = [], asocs = {}, costos = {}, procesadas = {}, pendientes = [] } = {}) {
  const plan = { aplicar: [], confirmar: [], marcar: [], reemplazar: [] }, porMp = {};
  lineas.filter(l => l.paraPrecio).forEach(l => {
    const a = asocs[l.clave];
    if (!a || a.ignorar || !a.mp) return;
    const h = huellaAsoc(a) + (num(l.flete) ? '|flete:' + Math.round(num(l.flete)) : ''), pr = procesadas[idLinea(l.id)];   // v0.103.0: un flete nuevo la vuelve a revisar
    if (pr && pr.huella === h) return;
    const cand = candidato(l, a), base = { linea: l, asoc: l.clave, mp: a.mp, huella: h };
    if (!(cand.ppb > 0)) { plan.marcar.push({ ...base, resultado: 'omitida', motivo: 'La línea no trae precio o cantidad' }); return; }
    (porMp[a.mp] || (porMp[a.mp] = [])).push({ cand, base });
  });
  Object.keys(porMp).sort().forEach(mp => {
    const xs = porMp[mp].sort((a, b) => comparar(b.cand, a.cand));
    const [g, ...resto] = xs;
    resto.forEach(x => plan.marcar.push({ ...x.base, resultado: 'omitida', motivo: 'Hay una compra más nueva de esta materia prima' }));
    const pend = pendientes.filter(p => p.mp === mp);
    if (pend.some(p => p.sii && comparar(p.sii, g.cand) >= 0)) { plan.marcar.push({ ...g.base, resultado: 'omitida', motivo: 'Hay una compra más nueva por confirmar' }); return; }
    const d = decidir(costos[mp], g.cand);
    if (d.accion === 'omitir') { plan.marcar.push({ ...g.base, resultado: d.clave === 'igual' ? 'igual' : 'omitida', motivo: d.motivo }); return; }
    pend.forEach(p => plan.reemplazar.push(p.id));
    if (d.accion === 'aplicar') { plan.aplicar.push({ mp, cand: g.cand, d }); plan.marcar.push({ ...g.base, resultado: 'aplicada', motivo: '' }); }
    else { plan.confirmar.push({ mp, cand: g.cand, d }); plan.marcar.push({ ...g.base, resultado: 'por_confirmar', motivo: d.motivo }); }
  });
  return plan;
}
// Lo que se escribe en costos_mp y costos_mp_hist al aplicar (función pura)
export function docAplicar(mp, cand, d, { por, motivo } = {}) {
  const sii = { rut: s(cand.rut), proveedor: s(cand.proveedor), folio: s(cand.folio), fecha: s(cand.fecha), linea: s(cand.linea), nombreItem: s(cand.nombreItem) };
  const anterior = { precioNeto: mp.precioNeto ?? null, contenido: mp.contenido || null, precioPorBase: mp.precioPorBase ?? null, fecha: mp.fecha || '', origen: mp.origen || '' };
  const doc = { precioNeto: d.nuevo.precioNeto, precioPorBase: d.nuevo.precioPorBase, origen: 'sii', fecha: s(cand.fecha), por: por || '', sii, anterior,
    ...(d.nuevo.contenidoAdoptado ? { contenido: d.nuevo.contenido, contenidoProblema: '', contenidoNota: 'Contenido tomado de la factura del SII' } : {}) };
  const hist = { mp: mp.id || '', precioNeto: d.nuevo.precioNeto, contenido: d.nuevo.contenido, precioPorBase: d.nuevo.precioPorBase, origen: 'sii',
    motivo: motivo || `Compra del SII: ${sii.proveedor} F.${sii.folio} (${sii.nombreItem})`, fecha: s(cand.fecha), por: por || '', anterior, sii };
  return { doc, hist };
}
// Texto del origen en la lista: "SII · Proveedor · F.123"
export const textoOrigenSii = m => (m && m.origen === 'sii' && m.sii ? `SII · ${s(m.sii.proveedor) || s(m.sii.rut)} · F.${s(m.sii.folio)}` : '');
export const conIva = neto => redondear(num(neto) * (1 + IVA), 2);
