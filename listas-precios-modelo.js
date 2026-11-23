// ═══════════════════════════════════════════════
//  Sistema Fën — Listas de precios (Ventas B2B → Listas de precios): reglas puras  v0.80.2
//  Sin red ni pantalla: qué productos entran (los del Catálogo habilitados en B2B y activos), el precio que se propone para
//  cada cliente (su precio especial o el base), el orden (área y nombre), la vigencia, el documento que se guarda en
//  fen-b2b listas_precios/{id}, las páginas del PDF y "Usar como precios especiales" (qué cambia, solo lo distinto del base,
//  con su historial). Los precios son NETOS: el PDF dice "+ IVA". Ningún costo sale de aquí.
// ═══════════════════════════════════════════════
import * as AR from './areas.js?v=0.138.0';

// Límites de las imágenes (comprimidas en el navegador, JPEG). bytes = el JPEG (el texto data URL pesa ~4/3).
export const FOTO = { lado: 900, bytes: 90000, miniLado: 240, miniBytes: 15000 };
export const PORTADA = { lado: 1600, bytes: 250000 };
export const DESCRIPCION_MAX = 140, FORMATO_MAX = 40;
// v0.80.2 · Encuadre de la foto en la tarjeta del PDF: x, y = posición (0–100 %, 50 = centro), zoom = 1 a 3 (1 = la foto justo cubre).
export const TARJETA_FOTO = { w: 338, h: 150 };   // px de la foto en cada tarjeta (A4 a 96 ppp)
export const ZOOM_MAX = 3;
const acotar = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
export function encuadre(e) { const x = e || {}; return { x: Math.round(acotar(x.x, 0, 100, 50) * 10) / 10, y: Math.round(acotar(x.y, 0, 100, 50) * 10) / 10, zoom: Math.round(acotar(x.zoom, 1, ZOOM_MAX, 1) * 100) / 100 }; }
export const encuadreIgual = (a, b) => { const p = encuadre(a), q = encuadre(b); return p.x === q.x && p.y === q.y && p.zoom === q.zoom; };
// Tamaño (px) de la foto dentro de una caja w × h: "cubrir" por el zoom. ancho/alto = de la foto (si no se sabe, 4:3).
export function tamFoto(ancho, alto, w, h, zoom = 1) {
  const fw = Number(ancho) > 0 ? Number(ancho) : 4, fh = Number(alto) > 0 ? Number(alto) : 3, k = Math.max(w / fw, h / fh) * acotar(zoom, 1, ZOOM_MAX, 1);
  return { w: fw * k, h: fh * k };
}
// El estilo de fondo de la foto encuadrada (lo usan el PDF y el editor del encuadre)
export function fondoFoto(foto, w, h) {
  const e = encuadre(foto && foto.encuadre), t = tamFoto(foto && foto.ancho, foto && foto.alto, w, h, e.zoom);
  return `background-size:${t.w.toFixed(1)}px ${t.h.toFixed(1)}px;background-position:${e.x}% ${e.y}%`;
}
export const POR_PAGINA = 6;                       // tarjetas por hoja del PDF (2 columnas × 3 filas)
export const MAX_ITEMS = 120;

const s = v => String(v ?? '').trim();
const una = v => s(v).replace(/\s+/g, ' ');
const norm = v => s(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const entero = v => { const n = Math.round(Number(String(v ?? '').replace(/[^\d-]/g, ''))); return Number.isFinite(n) ? n : 0; };
export const clp = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CL');
export const precioTxt = n => `${clp(n)} + IVA`;

// ── Fechas (texto AAAA-MM-DD, sin zona) ──
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function sumarDias(f, n) { const [y, m, d] = String(f).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + Number(n || 0))).toISOString().slice(0, 10); }
export const fechaLarga = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : s(f); };
export const fechaCorta = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : s(f); };
export const vigenciaHasta = (fecha, dias) => sumarDias(fecha, Math.max(1, Number(dias) || 30));
export const vencida = (lista, hoy) => !!(lista && lista.vigenciaHasta && hoy > lista.vigenciaHasta);

// ── Condiciones y contacto (config/listasPrecios; cada lista guarda una copia) ──
export const CONDICIONES = [
  ['diasDespacho', 'Días de despacho', 'Ej.: martes y viernes, antes de las 10:00'],
  ['costoDespacho', 'Costo de despacho', 'Ej.: $ 2.500 + IVA por despacho'],
  ['formasPago', 'Formas de pago', 'Ej.: transferencia, a 30 días con factura'],
  ['otras', 'Otras condiciones (opcional)', 'Déjalo vacío si no hace falta']
];
export function condicionesPorDefecto(empresa = {}) {
  return { diasDespacho: '', costoDespacho: '', formasPago: '', vigenciaDias: 30, otras: '',
    contacto: { nombre: 'Panadería Fën', telefono: s(empresa.telefono), correo: s(empresa.correo) } };
}
export function normalizarCondiciones(c, base = condicionesPorDefecto()) {
  const x = c || {}, ct = x.contacto || {}, bc = base.contacto || {};
  const dias = entero(x.vigenciaDias ?? base.vigenciaDias);
  const out = { diasDespacho: una(x.diasDespacho ?? base.diasDespacho).slice(0, 160), costoDespacho: una(x.costoDespacho ?? base.costoDespacho).slice(0, 160),
    formasPago: una(x.formasPago ?? base.formasPago).slice(0, 200), vigenciaDias: dias > 0 ? Math.min(dias, 365) : 30, otras: s(x.otras ?? '').slice(0, 300),
    contacto: { nombre: una(ct.nombre ?? bc.nombre).slice(0, 80), telefono: una(ct.telefono ?? bc.telefono).slice(0, 40), correo: una(ct.correo ?? bc.correo).slice(0, 80) } };
  if (out.contacto.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.contacto.correo)) throw new Error('El correo de contacto no se ve bien.');
  return out;
}

// ── Qué productos entran: los del Catálogo activos y habilitados en B2B ──
// maestro: cat_productos; productosB2b: fen-b2b productos (para el nombre de B2B y su precio base si el maestro no lo tiene)
// → [{ catalogoId, productoId, nombre, nombreB2b, formato, descripcion, area, areaNombre, categoria, precioBase, conFoto }]
export function elegibles(maestro, productosB2b = []) {
  const porId = new Map((productosB2b || []).map(p => [p.id, p]));
  return (maestro || []).filter(p => p && p.estado !== 'archivado' && p.canales && p.canales.b2b && p.canales.b2b.habilitado && p.tipo !== 'cargo')
    .map(p => {
      const b = p.canales.b2b, doc = porId.get(b.docId) || null;
      return { catalogoId: p.id, productoId: b.docId || null, nombre: s(p.nombre), nombreB2b: s((doc && doc.nombre) || p.nombre), formato: s(p.formato), descripcion: s(p.descripcionCorta),
        area: s(p.area), areaNombre: AR.NOMBRE[p.area] || s(p.area) || 'Otros', categoria: s(b.categoria || (doc && doc.categoria)),
        precioBase: Number(b.precioBase) > 0 ? Number(b.precioBase) : Number(doc && doc.precioBase) || 0, conFoto: !!(p.foto && p.foto.en) };
    })
    .filter(x => x.productoId && (!porId.size || !porId.get(x.productoId) || porId.get(x.productoId).estado !== 'archivado'));
}
const ORDEN_AREA = [...AR.PRODUCCION, AR.REVENTA];
const rangoArea = a => { const i = ORDEN_AREA.indexOf(a); return i < 0 ? 99 : i; };
export const ordenar = items => (items || []).slice().sort((a, b) => rangoArea(a.area) - rangoArea(b.area) || String(a.areaNombre || a.area).localeCompare(String(b.areaNombre || b.area), 'es') || String(a.nombre).localeCompare(String(b.nombre), 'es'));
export const areasDe = items => [...new Set((items || []).map(x => x.area))].sort((a, b) => rangoArea(a) - rangoArea(b) || String(a).localeCompare(String(b), 'es')).map(a => [a, AR.NOMBRE[a] || a || 'Otros']);
export const categoriasDe = items => [...new Set((items || []).map(x => x.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
export function filtrar(items, { area = '', categoria = '', q = '' } = {}) {
  const k = norm(q);
  return (items || []).filter(x => (!area || x.area === area) && (!categoria || x.categoria === categoria) && (!k || norm(x.nombre).includes(k) || norm(x.formato).includes(k) || norm(x.catalogoId).includes(k)));
}

// ── El precio que se propone para un cliente: su precio especial (por el ID del producto) o el base ──
const esDe = (x, item) => !!x && (s(x.productoId) ? s(x.productoId) === s(item.productoId) : norm(x.producto) === norm(item.nombreB2b || item.nombre));
export function precioActual(cliente, item) {
  const x = ((cliente && cliente.precios) || []).find(y => esDe(y, item));
  return x && Number(x.precio) > 0 ? { precio: Number(x.precio), especial: true } : { precio: Number(item.precioBase) || 0, especial: false };
}

// ── El documento de una lista (fen-b2b listas_precios/{id}) ──
// editor: { cliente: { id|null, nombre }, fecha, items: [{ ...elegible, precio }], condiciones } → doc sin por/en (los pone quien guarda)
export function armarLista(editor) {
  const e = editor || {}, c = e.cliente || {};
  const nombre = una(c.nombre).slice(0, 120);
  if (nombre.length < 2) throw new Error(c.id === null || c.nuevo ? 'Escribe el nombre del cliente nuevo.' : 'Elige el cliente.');
  const items = (e.items || []).map(x => ({ catalogoId: s(x.catalogoId), productoId: s(x.productoId) || null, nombre: s(x.nombre), formato: s(x.formato).slice(0, FORMATO_MAX), descripcion: s(x.descripcion).slice(0, DESCRIPCION_MAX),
    area: s(x.area), precioBase: Math.round(Number(x.precioBase) || 0), precio: entero(x.precio) }));
  if (!items.length) throw new Error('Marca al menos un producto.');
  if (items.length > MAX_ITEMS) throw new Error(`Una lista lleva hasta ${MAX_ITEMS} productos.`);
  const sinPrecio = items.filter(x => !(x.precio > 0));
  if (sinPrecio.length) throw new Error(`Falta el precio de ${sinPrecio.map(x => x.nombre).join(', ')}.`);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(s(e.fecha)) ? s(e.fecha) : '';
  if (!fecha) throw new Error('Falta la fecha de la lista.');
  const condiciones = normalizarCondiciones(e.condiciones);
  return { cliente: { id: s(c.id) || null, nombre }, fecha, vigenciaDias: condiciones.vigenciaDias, vigenciaHasta: vigenciaHasta(fecha, condiciones.vigenciaDias), items, n: items.length, condiciones };
}
export function estadoLista(l) {
  if (l && l.aplicada && l.aplicada.en) return { k: 'aplicada', t: 'Aplicada como precios especiales', c: 'c-verde' };
  if (l && l.enviadaEn) return { k: 'enviada', t: 'Enviada', c: 'c-azul' };
  return { k: 'guardada', t: 'Guardada', c: 'c-gris' };
}
// Duplicar para otro cliente: mismos productos, precios, orden y condiciones; fecha de hoy; sin envío ni aplicación
export function duplicar(l, hoy) {
  return { id: null, cliente: { id: null, nombre: '' }, fecha: hoy, items: (l.items || []).map(x => ({ ...x })), condiciones: JSON.parse(JSON.stringify(l.condiciones || {})), duplicadaDe: l.id || null };
}
export const nombreArchivo = l => `Lista_de_precios_Fen_${String((l.cliente || {}).nombre || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}_${l.fecha}.pdf`;
export const mensajeWsp = l => `Hola${(l.cliente || {}).nombre ? ' ' + l.cliente.nombre : ''}, te enviamos nuestra lista de precios (precios netos + IVA, válidos hasta el ${fechaLarga(l.vigenciaHasta)}). Cualquier duda, nos escribes. Panadería Fën`;

// ── Páginas del PDF: portada, productos (POR_PAGINA por hoja) y condiciones ──
export function paginas(items, porPagina = POR_PAGINA) {
  const out = [{ tipo: 'portada' }];
  for (let i = 0; i < (items || []).length; i += porPagina) out.push({ tipo: 'productos', items: items.slice(i, i + porPagina), desde: i });
  out.push({ tipo: 'condiciones' });
  return out;
}

// ── Usar como precios especiales ──
// Qué cambia en el cliente si la lista pasa a ser sus precios especiales: solo los productos cuyo precio de la lista es distinto del
// base, y que no tengan ya ese mismo precio especial. productosB2b: para el base vigente y el nombre de B2B.
// → [{ productoId, catalogoId, producto (nombre en B2B), base, actual, actualEspecial, nuevo }]
export function diffEspeciales(lista, cliente, productosB2b = []) {
  const porId = new Map((productosB2b || []).map(p => [p.id, p]));
  const out = [];
  (lista.items || []).forEach(it => {
    if (!s(it.productoId)) return;
    const doc = porId.get(it.productoId);
    const base = Number(doc && doc.precioBase) > 0 ? Number(doc.precioBase) : Number(it.precioBase) || 0;
    const nuevo = entero(it.precio);
    if (!(nuevo > 0) || nuevo === base) return;
    const item = { productoId: it.productoId, nombreB2b: (doc && doc.nombre) || it.nombre, nombre: it.nombre };
    const a = precioActual(cliente, { ...item, precioBase: base });
    if (a.especial && a.precio === nuevo) return;
    out.push({ productoId: it.productoId, catalogoId: it.catalogoId || null, producto: s((doc && doc.nombre) || it.nombre), base, actual: a.precio, actualEspecial: a.especial, nuevo });
  });
  return out;
}
// Aplica los cambios a los precios del cliente (por el ID del producto). Nada se borra: un precio especial que no está en los
// cambios queda igual; el que cambia queda con su historial. → { precios, historialPrecios, n }
export function aplicarEspeciales(precios, historialPrecios, cambios, { por, en, listaId }) {
  let lista = (precios || []).map(x => ({ ...x }));
  const hist = [...(historialPrecios || [])];
  let n = 0;
  (cambios || []).forEach(c => {
    const prev = lista.find(x => esDe(x, { productoId: c.productoId, nombreB2b: c.producto }));
    if (prev && Number(prev.precio) === c.nuevo) return;
    lista = lista.filter(x => x !== prev);
    lista.push({ producto: c.producto, productoId: c.productoId, precio: c.nuevo });
    hist.push({ producto: c.producto, productoId: c.productoId, antes: prev ? Number(prev.precio) : null, despues: c.nuevo, en, por, origen: 'lista de precios', listaId: listaId || null });
    n++;
  });
  lista.sort((a, b) => String(a.producto).localeCompare(String(b.producto), 'es'));
  return { precios: lista, historialPrecios: hist.slice(-200), n };
}

// ── Medidas de una imagen al achicarla (el lado largo a lo más "lado") ──
export function medidas(ancho, alto, lado) {
  const w = Number(ancho) || 0, h = Number(alto) || 0;
  if (!(w > 0 && h > 0)) return { ancho: 0, alto: 0 };
  const f = Math.min(1, lado / Math.max(w, h));
  return { ancho: Math.max(1, Math.round(w * f)), alto: Math.max(1, Math.round(h * f)) };
}
// Bytes de un data URL base64 (lo que pesa el JPEG)
export const bytesDataUrl = u => { const i = String(u || '').indexOf(','); if (i < 0) return 0; const b = String(u).slice(i + 1); return Math.floor(b.length * 3 / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0); };
