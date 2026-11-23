// ═══════════════════════════════════════════════
//  Sistema Fën — materias primas e insumos creados y cambiados desde Finanzas → Costos  v0.76.0
//  Reglas puras (sin red). La base de Cocina (fen-produccion mps) es la maestra de nombre, tipo, categoría, unidad, áreas y estado;
//  el precio vive solo en fen-gastos costos_mp (finanzas.js). Lo usan produccion.js (crearMp, editarMp, archivarMp) y
//  vista-finanzas.js (el diálogo "Nueva materia prima o insumo", "Crear desde esta línea" y las parecidas).
//  · nombre único: sin importar mayúsculas, tildes ni espacios, contra TODAS las de la base (activas, inactivas, archivadas…).
//  · parecidas (similares): palabras (con abreviaturas de factura: HNA = harina, MANTEQ = mantequilla…) y trigramas.
//  · desde una línea del SII: nombre limpio (sin cantidades, unidades ni envases), contenido de una unidad (finanzas-sii.js
//    contenidoDeLinea, la misma lectura de "lo que trae una unidad") y tipo probable.
//  · archivar: no si una receta viva (no archivada) la usa como ingrediente o insumo. Nada se borra.
//  Se prueba solo: pruebas/sistemafen/mp-crear-v0760.test.js.
// ═══════════════════════════════════════════════
import { num, parsearContenido, contenidoValido } from './finanzas-costos.js?v=0.138.0';
import { normalizarItem, contenidoDesdeForm, contenidoDeLinea, precioUnitarioNeto } from './finanzas-sii.js?v=0.138.0';

const t = v => (v === null || v === undefined ? '' : String(v).trim());
const sinTildes = v => t(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const redondear = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export const AREAS = { PAN: 'Panadería', BOL: 'Bollería', PAS: 'Pastelería', CAF: 'Cafetería' };
export const TIPOS = { mp: 'Materia prima', insumo: 'Insumo' };
export const ESTADOS = { activa: 'activa', inactiva: 'inactiva', archivada: 'archivada', reemplazada: 'reemplazada' };
// La unidad de compra como la guarda la base de Cocina (la misma regla de las materias primas pedidas)
export const UNIDAD_COMPRA = /^(\d+([.,]\d+)?)?\s*(kg|g|lt|l|ml|un|unidad|unidades)$/i;
export const MAX_NOMBRE = 80;

// ── Nombre comparable: sin tildes, minúsculas, solo letras y números, espacios simples ──
export const normNombre = v => sinTildes(v).replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const esSub = m => !!m && (t(m.tipo) === 'sub_receta' || /^SR/i.test(t(m.id)));
export const estadoDe = m => t(m && m.estado) || 'activa';
// La que ya tiene ese nombre (cualquier estado; también una sub receta: no pueden llamarse igual). excepto: su propio id al cambiarle el nombre
// ── v0.137.2 · Categorías: elegir una de las que hay, sin crear otra por escribirla distinto ──
// (Emmanuel, 21 nov: "si escribo mal una categoría que existe se creará otra"; había "Lácteos", "Lacteos" y "Leches")
// La clave ignora tildes, mayúsculas, espacios y la "s" final: "lacteos", "Lácteo" y "LÁCTEOS" son la misma.
export const claveCategoria = v => normNombre(v).replace(/(es|s)$/, '');
const NO_ES_CATEGORIA = /^(pendiente( de clasificar)?|sin categoria|sub recetas?)$/;
// Las categorías de las materias primas e insumos (sin las sub recetas ni "Pendiente de clasificar"), una por clave, ordenadas
export function categoriasDe(mps) {
  const por = {};
  (mps || []).filter(m => !esSub(m) && estadoDe(m) !== 'archivada').forEach(m => {
    const c = t(m.categoria).replace(/\s+/g, ' '), k = claveCategoria(c);
    if (!c || NO_ES_CATEGORIA.test(normNombre(c))) return;
    (por[k] = por[k] || {})[c] = (por[k][c] || 0) + 1;
  });
  // De cada clave, la forma más usada (a igualdad, la con tilde)
  return Object.values(por).map(f => Object.entries(f).sort((a, b) => b[1] - a[1] || (b[0] !== sinTildes(b[0])) - (a[0] !== sinTildes(a[0])))[0][0])
    .sort((a, b) => a.localeCompare(b, 'es'));
}
// La categoría escrita, con la forma de una que ya existe si es la misma (si no, tal como se escribió)
export function categoriaExistente(texto, mps) {
  const c = t(texto).replace(/\s+/g, ' ').slice(0, 40), k = claveCategoria(c);
  if (!k) return c;
  return categoriasDe(mps).find(x => claveCategoria(x) === k) || c;
}

export function repetida(nombre, mps, excepto = '') {
  const n = normNombre(nombre); if (!n) return null;
  return (mps || []).find(m => m && t(m.id) !== t(excepto) && normNombre(m.nombre) === n) || null;
}
export const textoAreas = areas => { const a = (Array.isArray(areas) ? areas : []).filter(x => AREAS[x]); return a.length ? a.map(x => AREAS[x]).join(', ') : 'Todas las áreas'; };
export const limpiarAreas = areas => [...new Set((Array.isArray(areas) ? areas : []).map(x => t(x).toUpperCase()).filter(x => AREAS[x]))].sort((a, b) => Object.keys(AREAS).indexOf(a) - Object.keys(AREAS).indexOf(b));

// ── Parecidas ──
// Abreviaturas que traen las facturas (se comparan como la palabra entera)
export const ABREV = { hna: 'harina', har: 'harina', hrna: 'harina', hari: 'harina', mant: 'mantequilla', mantq: 'mantequilla', manteq: 'mantequilla', mtq: 'mantequilla', mtqll: 'mantequilla',
  azuc: 'azucar', azu: 'azucar', lev: 'levadura', levad: 'levadura', choc: 'chocolate', chocol: 'chocolate', crem: 'crema', lech: 'leche', lch: 'leche', marg: 'margarina', marga: 'margarina',
  acei: 'aceite', qso: 'queso', jam: 'jamon', hvo: 'huevo', hvos: 'huevos', huev: 'huevo', panad: 'panadera', integ: 'integral', integr: 'integral', semi: 'semilla', sem: 'semilla',
  vain: 'vainilla', vaini: 'vainilla', canel: 'canela', almend: 'almendra', alm: 'almendra', nuez: 'nuez', mzna: 'manzana', fram: 'frambuesa', frut: 'frutilla', cafe: 'cafe', desc: 'descremada', entera: 'entera' };
// Palabras que no dicen qué es (envases, unidades, conectores)
const VACIAS = new Set(['saco', 'sacos', 'caja', 'cajas', 'cj', 'cja', 'bolsa', 'bolsas', 'kg', 'kgs', 'kilo', 'kilos', 'gr', 'grs', 'gramos', 'lt', 'lts', 'litro', 'litros', 'ml', 'cc', 'un', 'und', 'unid', 'unids', 'unidad', 'unidades',
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'pack', 'paquete', 'paq', 'bandeja', 'tarro', 'frasco', 'botella', 'formato', 'granel', 'display', 'dsp', 'fardo', 'malla', 'balde', 'bidon', 'rollo']);
const singular = w => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);
export function palabras(v) {
  return normalizarItem(t(v).replace(/\b([sc])\s*\/\s*/gi, (_, l) => (l.toLowerCase() === 's' ? 'sin ' : 'con ')))
    .split(' ').map(w => ABREV[w] || w).filter(w => w.length >= 3 && !/\d/.test(w) && !VACIAS.has(w)).map(singular);
}
const parecidas = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
const trigramas = ws => { const s = ` ${ws.join(' ')} `, r = new Set(); for (let i = 0; i < s.length - 2; i++) r.add(s.slice(i, i + 3)); return r; };
// 0 a 1: lo mejor entre las palabras en común (como sugerirMp de Compras del SII, con abreviaturas) y los trigramas (Dice)
export function puntaje(a, b) {
  const pa = palabras(a), pb = palabras(b);
  if (!pa.length || !pb.length) return 0;
  const enA = pa.filter(w => pb.some(v => parecidas(w, v))).length, enB = pb.filter(v => pa.some(w => parecidas(w, v))).length;
  const tok = (enA / pa.length + enB / pb.length) / 2;
  const ta = trigramas(pa), tb = trigramas(pb); let comun = 0; ta.forEach(x => { if (tb.has(x)) comun++; });
  const dice = (2 * comun) / (ta.size + tb.size);
  return redondear(Math.max(tok, dice * 0.95), 4);
}
export const UMBRAL = 0.34;
// Las más parecidas (máx. 3): sin sub recetas ni reemplazadas. lista: [{ id, nombre, tipo, estado }]; activas: solo las no archivadas
export function similares(nombre, lista, { max = 3, excepto = '', activas = false, umbral = UMBRAL } = {}) {
  return (lista || []).filter(m => m && t(m.id) !== t(excepto) && !esSub(m) && estadoDe(m) !== 'reemplazada' && (!activas || estadoDe(m) !== 'archivada'))
    .map(m => ({ id: t(m.id), nombre: t(m.nombre), tipo: t(m.tipo) || 'mp', estado: estadoDe(m), puntaje: puntaje(nombre, m.nombre) }))
    .filter(x => x.puntaje >= umbral)
    .sort((x, y) => y.puntaje - x.puntaje || (x.estado === 'archivada') - (y.estado === 'archivada') || x.nombre.localeCompare(y.nombre, 'es'))
    .slice(0, max);
}

// ── Desde una línea de factura del SII ──
const ENVASE = /^(saco|sacos|caja|cajas|cj|cja|bolsa|bolsas|paquete|paq|pack|bandeja|tarro|frasco|botella|formato|granel|display|dsp|fardo|malla|balde|bidon|rollo|x|kg|kgs|kilo|kilos|g|gr|grs|gramos?|l|lt|lts|litros?|ml|cc|un|u|und|unid|unids|unidad|unidades)$/;
const capital = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// "HNA PANADERA 25KG" → "Harina panadera" · "MANTEQ. S/SAL CAJA 10 KG" → "Mantequilla sin sal"
// Un código con letras y números ("T80", "000") se queda (en mayúsculas); una cantidad ("25KG", "X12", "8OZ") no.
export function nombreDesdeLinea(descripcion) {
  const ws = sinTildes(t(descripcion).replace(/\b([sc])\s*\/\s*/gi, (_, l) => (l.toLowerCase() === 's' ? 'sin ' : 'con '))).split(/[^a-z0-9ñ]+/)
    .filter(w => w && w.length > 1 && !ENVASE.test(w) && !/^\d/.test(w) && !/^x\d/.test(w))
    .map(w => (/\d/.test(w) ? w.toUpperCase() : ABREV[w] || w));
  return capital(ws.join(' ').slice(0, MAX_NOMBRE)).trim();
}
// Insumo (envases, desechables, limpieza) o materia prima (lo que va en la receta)
const INSUMO = /\b(vasos?|tapas?|servilletas?|film|alusa|papel|etiquetas?|stickers?|guantes?|envases?|potes?|bombillas?|cucharas?|cucharitas?|revolvedor(es)?|cintas?|toallas?|capacillos?|blondas?|bolsas? (de )?(papel|plastic[oa]|kraft|camiseta)|cajas? (de )?(carton|torta|pizza)|bandejas? (de )?(carton|aluminio|plumavit)|detergentes?|cloro|desengrasante|lavaloza|mascarillas?|gorros?|cofias?|palitos?)\b/;
export const tipoProbable = nombre => (INSUMO.test(sinTildes(nombre)) ? 'insumo' : 'mp');
// La unidad de compra como texto de la base de Cocina, desde su contenido: 25 kg → "25kg"; 1 l → "lt"; 10 un → "10un"
export function unidadDeContenido(c) {
  if (!contenidoValido(c)) return '';
  const n = num(c.cantidad), f = x => String(redondear(x, 3));
  if (c.unidad === 'g') return n >= 1000 ? (n === 1000 ? 'kg' : `${f(n / 1000)}kg`) : `${f(n)}g`;
  if (c.unidad === 'ml') return n >= 1000 ? (n === 1000 ? 'lt' : `${f(n / 1000)}lt`) : `${f(n)}ml`;
  return n === 1 ? 'un' : `${f(n)}un`;
}
// Para el formulario: cantidad y unidad (kg, g, l, ml, un) de un contenido
export function enForm(c) {
  if (!contenidoValido(c)) return { cantidad: '', unidad: 'kg' };
  const n = num(c.cantidad);
  if (c.unidad === 'g') return n >= 1000 ? { cantidad: redondear(n / 1000, 3), unidad: 'kg' } : { cantidad: n, unidad: 'g' };
  if (c.unidad === 'ml') return n >= 1000 ? { cantidad: redondear(n / 1000, 3), unidad: 'l' } : { cantidad: n, unidad: 'ml' };
  return { cantidad: n, unidad: 'un' };
}
// Lo que trae la unidad de compra escrita ("25kg" → 25 kg; "10un" → 10 un, dudoso: se confirma en el formulario)
export function contenidoDeUnidad(unidad) {
  const p = parsearContenido(unidad);
  return { contenido: p.contenido || p.sugerido || null, dudoso: !!p.dudoso, motivo: p.motivo || '' };
}
// El diálogo lleno desde la línea más nueva de un producto de factura (grupo de Compras del SII)
export function desdeLinea(g) {
  const u = (g && g.ultima) || {}, leido = contenidoDeLinea(u.descripcion || (g && g.nombreItem), u.unidad);
  const contenido = leido.contenido || null, nombre = nombreDesdeLinea((g && g.nombreItem) || u.descripcion);
  const pu = precioUnitarioNeto(u);
  return { nombre, tipo: tipoProbable(`${(g && g.nombreItem) || ''} ${nombre}`), unidad: unidadDeContenido(contenido) || (t(u.unidad).toLowerCase() === 'kg' ? 'kg' : ''),
    contenido, contenidoDudoso: !!leido.dudoso, contenidoMotivo: leido.motivo || '', contenidoDe: leido.de || '', precioNeto: pu > 0 ? redondear(pu, 2) : null, categoria: '', areas: [] };
}

// ── Validar el formulario de alta ──
// datos: { nombre, tipo 'mp'|'insumo', categoria, unidad ('25kg'…), contenido { cantidad, unidad kg|g|l|ml|un }, precio, conIva, areas [] }
// mps: TODAS las de la base de Cocina. → { nombre, tipo, categoria, unidad, contenido { cantidad, unidad g|ml|un }, precioNeto, areas }
export function validarAlta(datos, mps) {
  const d = datos || {};
  const nombre = t(d.nombre).replace(/\s+/g, ' ');
  if (normNombre(nombre).length < 2) throw new Error('Escribe el nombre.');
  if (nombre.length > MAX_NOMBRE) throw new Error(`El nombre puede tener hasta ${MAX_NOMBRE} letras.`);
  const rep = repetida(nombre, mps);
  if (rep) {
    const est = estadoDe(rep), e = new Error(esSub(rep) ? `"${rep.nombre}" es una sub receta (${rep.id}): una materia prima no puede llamarse igual.`
      : `Ya existe "${rep.nombre}" (${rep.id}${est !== 'activa' ? `, ${ESTADOS[est] || est}` : ''}). Ábrela en vez de crear otra.`);
    e.code = 'existe'; e.datos = { id: rep.id, estado: est, sub: esSub(rep) }; throw e;
  }
  const tipo = d.tipo === 'insumo' ? 'insumo' : 'mp';
  const unidad = t(d.unidad).toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!UNIDAD_COMPRA.test(unidad)) throw new Error(`"${t(d.unidad)}" no es una unidad de compra válida. Usa por ejemplo: kg, 25kg, g, lt, 500ml, un, 10un.`);
  const contenido = contenidoDesdeForm(d.contenido && d.contenido.cantidad, d.contenido && d.contenido.unidad);
  if (!contenido) throw new Error('Escribe cuánto trae una unidad de compra (cantidad y unidad).');
  const p = parsearContenido(unidad), deUnidad = p.contenido || p.sugerido;
  if (deUnidad && deUnidad.unidad !== contenido.unidad) throw new Error(`La unidad de compra (${unidad}) es ${deUnidad.unidad === 'un' ? 'por unidades' : deUnidad.unidad === 'g' ? 'por peso' : 'por volumen'}, pero el contenido está en ${contenido.unidad === 'un' ? 'unidades' : contenido.unidad === 'g' ? 'peso' : 'volumen'}.`);
  // "10un" es dudoso (¿el precio es por las 10 o por 1?): vale lo que escribas en el contenido; "25kg" o "kg" tienen que calzar
  if (p.contenido && Math.abs(num(p.contenido.cantidad) - num(contenido.cantidad)) > 1e-6) throw new Error(`La unidad de compra dice ${unidad}, pero el contenido no calza. Corrige uno de los dos.`);
  let precioNeto = num(d.precio);
  if (!(precioNeto > 0)) throw new Error('Escribe el precio neto (sin IVA) de la unidad de compra.');
  if (d.conIva) precioNeto = redondear(precioNeto / 1.19, 2);
  const categoria = categoriaExistente(d.categoria, mps);   // v0.137.2
  return { nombre, tipo, categoria, unidad, contenido, precioNeto, areas: limpiarAreas(d.areas) };
}

// ── Historial en el documento de mps ──
export const conHistorial = (prev, entrada) => [...(Array.isArray(prev && prev.historial) ? prev.historial : []), entrada].slice(-50);

// ── Recetas que la usan ──
const usa = (r, id) => [...(r.ingredientes || []), ...(r.insumos || [])].some(i => i && t(i.id) === t(id));
// Recetas vivas (no archivadas) que la usan como ingrediente o insumo → [{ id, nombre, area }]
export const usosVivos = (id, recetas) => (recetas || []).filter(r => r && r.estado !== 'archivada' && usa(r, id))
  .map(r => ({ id: t(r.id), nombre: t(r.nombre) || t(r.id), area: t(r.area) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
// Las recetas (todas: el nombre es solo una etiqueta, el ID manda) con el nombre copiado viejo → { id: { ingredientes, insumos } }
export function nombresEnRecetas(id, nombre, recetas) {
  const out = {};
  (recetas || []).forEach(r => {
    if (!r || !usa(r, id)) return;
    let cambia = false;
    const fix = xs => (xs || []).map(i => { if (i && t(i.id) === t(id) && t(i.nombre) !== nombre) { cambia = true; return { ...i, nombre }; } return i; });
    const ingredientes = fix(r.ingredientes), insumos = fix(r.insumos);
    if (cambia) out[r.id] = { ingredientes, insumos };
  });
  return out;
}

// ── Cambiar nombre, categoría y áreas ──
// → { patch, cambios: [texto], hist } o null si nada cambió
export function cambioDatos(mp, datos, mps, { por = '', en = '' } = {}) {
  if (!mp) throw new Error('Esa materia prima ya no está en la base de Cocina. Toca Actualizar.');
  if (esSub(mp)) throw new Error('Una sub receta se cambia desde su receta (Catálogo y Producción), no aquí.');
  const d = datos || {}, patch = {}, cambios = [];
  if (d.nombre !== undefined) {
    const nombre = t(d.nombre).replace(/\s+/g, ' ');
    if (normNombre(nombre).length < 2) throw new Error('Escribe el nombre.');
    if (nombre.length > MAX_NOMBRE) throw new Error(`El nombre puede tener hasta ${MAX_NOMBRE} letras.`);
    const rep = repetida(nombre, mps, mp.id);
    if (rep) { const e = new Error(`Ya existe "${rep.nombre}" (${rep.id}${estadoDe(rep) !== 'activa' ? `, ${estadoDe(rep)}` : ''}): elige otro nombre.`); e.code = 'existe'; e.datos = { id: rep.id }; throw e; }
    if (nombre !== t(mp.nombre)) { patch.nombre = nombre; cambios.push(`nombre: ${t(mp.nombre)} → ${nombre}`); }
  }
  if (d.categoria !== undefined) {
    const c = categoriaExistente(d.categoria, mps);   // v0.137.2
    if (c !== t(mp.categoria)) { patch.categoria = c; cambios.push(`categoría: ${t(mp.categoria) || '—'} → ${c || '—'}`); }
  }
  if (d.areas !== undefined) {
    const a = limpiarAreas(d.areas), antes = limpiarAreas(mp.areas);
    if (JSON.stringify(a) !== JSON.stringify(antes) || (Array.isArray(mp.areas) && mp.areas.length !== antes.length)) { patch.areas = a; cambios.push(`áreas: ${textoAreas(antes)} → ${textoAreas(a)}`); }
  }
  if (!cambios.length) return null;
  const hist = { accion: 'cambió', detalle: cambios.join(' · '), por, en };
  return { patch: { ...patch, historial: conHistorial(mp, hist) }, cambios, hist };
}

// ── Archivar y reactivar ──
// archivar: no si una receta viva la usa (error code 'en_uso', datos.usos). Reactivar deja 'activa'. → { patch, hist } o null
export function cambioEstado(mp, archivar, recetas, { por = '', en = '' } = {}) {
  if (!mp) throw new Error('Esa materia prima ya no está en la base de Cocina. Toca Actualizar.');
  if (esSub(mp)) throw new Error('Una sub receta se archiva archivando su receta (Catálogo → Qué está vivo).');
  const est = estadoDe(mp);
  if (archivar) {
    if (est === 'archivada') return null;
    const usos = usosVivos(mp.id, recetas);
    if (usos.length) {
      const e = new Error(`No se puede archivar: ${usos.length === 1 ? 'la usa una receta viva' : `la usan ${usos.length} recetas vivas`} (${usos.slice(0, 6).map(u => `${u.nombre} · ${AREAS[u.area] || u.area}`).join('; ')}${usos.length > 6 ? '…' : ''}). Cámbiala en esas recetas o archívalas primero.`);
      e.code = 'en_uso'; e.datos = { usos }; throw e;
    }
    const hist = { accion: 'archivó', detalle: `estado: ${est} → archivada`, por, en };
    return { patch: { estado: 'archivada', estadoAntes: est, archivadaPor: por, archivadaEn: en, historial: conHistorial(mp, hist) }, hist };
  }
  if (est === 'activa') return null;
  const hist = { accion: 'reactivó', detalle: `estado: ${est} → activa`, por, en };
  return { patch: { estado: 'activa', estadoAntes: est, reactivadaPor: por, reactivadaEn: en, historial: conHistorial(mp, hist) }, hist };
}
