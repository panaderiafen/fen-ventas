// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo, Etapa 2: un solo catálogo de productos (reglas puras, sin red)  v0.74.0
//  Decisiones del dueño (plan de coherencia, 20/21-oct-2026): un dueño por cosa; unir por ID, nunca por nombre; se crea en un
//  solo lugar y los demás piden; una sola lista de áreas (areas.js); la venta guarda su foto; nada se borra (se archiva).
//
//  El maestro vive en fen-gastos (solo administración; las reglas v0.1.0 ya cubren colecciones nuevas):
//   cat_productos/{PR0001} = {
//     id, nombre, tipo 'receta' | 'reventa' | 'cargo' | 'armado' (solo en el modelo: todavía no en la pantalla),
//     recetaId (receta aprobada de fen-produccion) | reventaId (fen-gastos cat_reventa) | componentes [{ recetaId, gramos }] (armado),
//     area (código de areas.js: receta → el de la receta; reventa → REVENTA; cargo → un canal (B2B/B2C) o ''; armado → un área que produce),
//     unidadesPorVenta (1; una "caja de 6" = 6), estado 'activo' | 'archivado',
//     canales: {
//       caja: { habilitado, docId (fen-ventas productos), controlStock, precios { hoy, ayer, antesayer, cuartoDia, ultimaOferta } | null,
//               precioUnico | null, excepcionHoraria, autoEliminar, categoria, areaCaja (la pestaña de la caja donde aparece;
//               v0.75.1: una reventa va siempre a la pestaña REVENTA, sin elegir) },
//       b2b:  { habilitado, docId (fen-b2b productos), precioBase (neto), categoria } },
//     historial [40], creadoEn, creadoPor, editadoEn, editadoPor, origen 'manual' | 'migracion' | 'solicitud',
//     v0.80.1: recetaPendiente true (tipo 'receta' sin receta todavía: recetaId null, area = la elegida) + notaReceta (≤ 120) }
//   cat_config/productos = { siguiente (el número del próximo PR), armadoEn, armadoPor, vigenteDesde 'AAAA-MM', n, historial }
//
//  Las copias en los canales las escribe SOLO Sistema Fën (al guardar o habilitar):
//   fen-ventas productos/{docId}: los campos de siempre de la caja (nombre, area, categoria, activo, precio*, controlStock,
//     excepcionHoraria, autoEliminar, idRecetaFen) + catalogoId, tipo, reventaId.
//   fen-b2b productos/{docId}: nombre, precioBase, categoria, idReceta, area (código), estado + catalogoId, tipo, reventaId.
//   Un canal nuevo usa el ID del maestro como ID de documento. Deshabilitar = archivar ahí (caja activo false; B2B estado
//   'archivado'). Nunca se borra. Los documentos que ya existían conservan su ID (la historia de ventas está guardada con él).
//
//  Cómo se sabe la receta de una venta (Finanzas y Plan de Panadería), en este orden:
//   1. la foto de la línea (B2B: catalogoId, tipo, area, recetaId/reventaId, unidadesPorVenta, al crear la orden);
//   2. el maestro, por el catalogoId del producto del canal (desde el mes en que se armó el catálogo: vigenteDesde);
//   3. fin_productos (lo asociado a mano en Finanzas: meses antiguos y productos sin unir);
//   4. lo de antes (ID de receta del catálogo de la caja o de B2B, nombre parecido) solo como sugerencia.
// ═══════════════════════════════════════════════
import * as AR from './areas.js?v=0.138.0';
// v0.75.1 (Etapa 2b): la caja v2.3.0 ya no crea ni cambia productos; sus pestañas son areas.js CAJA (PAN, BOL, PAS, CAF, REVENTA).

export const TIPOS = { receta: 'Receta', reventa: 'Reventa', cargo: 'Cargo', armado: 'Armado' };
export const TIPOS_PANTALLA = ['receta', 'reventa', 'cargo'];   // "armado" queda en el modelo, sin pantalla (Pastelería en pausa)
export const ESTADOS = { activo: 'Activo', archivado: 'Archivado' };
export const CANALES = ['caja', 'b2b'];
export const NOMBRE_CANAL = { caja: 'Caja', b2b: 'B2B' };
export const TARJETAS = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['antesayer', 'Antes de ayer'], ['cuartoDia', '4° día'], ['ultimaOferta', 'Última oferta']];
export const CAMPO_PRECIO = { hoy: 'precioHoy', ayer: 'precioAyer', antesayer: 'precioAntesayer', cuartoDia: 'precioCuartoDia', ultimaOferta: 'precioUltimaOferta' };
export const ID_RE = /^PR\d{4,}$/;
export const FILTROS_ESTADO = [['activo', 'Activos'], ['archivado', 'Archivados'], ['todo', 'Todo']];
export const FILTROS_CANAL = [['todos', 'Todos los canales'], ['caja', 'En la caja'], ['b2b', 'En B2B'], ['sin', 'Sin canal']];

const s = v => (v === null || v === undefined ? '' : String(v)).trim();
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : NaN; const t = s(v).replace(/\$|\s/g, ''); if (!t) return NaN; const x = Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(',', '.')); return isFinite(x) ? x : NaN; };
const entero = v => { const x = num(v); return isFinite(x) ? Math.round(x) : NaN; };
const red = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
export const norm = t => s(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
// Igual que finanzas-ventas.idDoc / claveProducto: la clave de fin_productos de un producto de un canal
export const idDoc = t => s(t).replace(/\//g, '_').replace(/^\.+$/, '_').slice(0, 300) || '_';
export const clave = (canal, docId) => `${canal}_${idDoc(docId)}`;

// ── IDs: PR + 4 dígitos, del contador de cat_config/productos (nunca baja; si alguien ya tomó uno, el que sigue) ──
export const idDe = n => 'PR' + String(Math.max(1, Math.floor(Number(n) || 1))).padStart(4, '0');
export function siguienteNumero(config, lista = [], saltar = []) {
  const usados = [...(lista || []).map(p => s(p && p.id)), ...saltar].filter(x => ID_RE.test(x)).map(x => parseInt(x.slice(2), 10));
  return Math.max(Number(config && config.siguiente) || 1, usados.length ? Math.max(...usados) + 1 : 1);
}

// ── Áreas (una sola lista: areas.js) ──
const AREA_TXT = { panaderia: 'PAN', pan: 'PAN', bolleria: 'BOL', bol: 'BOL', pasteleria: 'PAS', pas: 'PAS', cafeteria: 'CAF', caf: 'CAF', reventa: 'REVENTA', rev: 'REVENTA', b2b: 'B2B', b2c: 'B2C', 'canal b2b': 'B2B', 'canal b2c': 'B2C' };
export const areaCodigo = a => { const u = s(a).toUpperCase(); if ([...AR.MARGEN, ...AR.CANAL].includes(u)) return u; return AREA_TXT[norm(a)] || ''; };
export const nombreArea = a => AR.NOMBRE[areaCodigo(a)] || s(a) || 'Sin área';

// ── v0.80.1 · Receta pendiente: un producto que se vende hoy, pero cuya receta todavía no está aprobada (o no existe) ──
// tipo 'receta', recetaId null, recetaPendiente true, area (un área que produce: sus ventas van ahí) y una nota opcional
// ("qué receta falta"). Se vende igual en sus canales; mientras tanto no tiene costo ni margen. Se cierra con "Unir con su receta".
export const NOTA_RECETA_MAX = 120;
export const recetaPendiente = p => !!p && p.tipo === 'receta' && p.recetaPendiente === true;
export const faltaReceta = lista => (lista || []).filter(p => p && p.estado !== 'archivado' && recetaPendiente(p));
// ¿Lleva vínculo en fin_productos? Un producto con receta pendiente no (Finanzas lo lee del maestro); se escribe al unirlo.
export const conVinculoFin = p => !recetaPendiente(p);

// ── Recetas y reventa que se pueden elegir ──
// Una receta se puede vender si está aprobada (consolidada) y no archivada. Una sub receta solo si dice "vende directo".
export const recetaAprobada = r => !!r && ['consolidada', 'aprobada'].includes(s(r.estado)) && (r.tipo !== 'sub_receta' || r.vendeDirecto === true);
export const recetasElegibles = recetas => (recetas || []).filter(recetaAprobada).sort((a, b) => s(a.nombre).localeCompare(s(b.nombre), 'es'));
export const reventaElegible = x => !!x && x.estado !== 'archivado';
export const reventasElegibles = lista => (lista || []).filter(reventaElegible).sort((a, b) => s(a.nombre).localeCompare(s(b.nombre), 'es'));
// v0.80.1 · Para "Unir con su receta": las aprobadas del área (o todas)
export const recetasParaUnir = (recetas, area, todas = false) => recetasElegibles(recetas).filter(r => todas || !area || areaCodigo(r.area) === area);
export const textoEstadoReceta = r => !r ? 'no está en la base de Cocina' : s(r.estado) === 'archivada' ? 'está archivada' : recetaAprobada(r) ? 'aprobada' : r.tipo === 'sub_receta' && ['consolidada', 'aprobada'].includes(s(r.estado)) ? 'es sub receta (no se vende sola)' : 'todavía no está aprobada';

// ── Canales ──
export const habilitado = (p, canal) => !!(p && p.estado !== 'archivado' && p.canales && p.canales[canal] && p.canales[canal].habilitado);
export const canalesDe = p => CANALES.filter(c => habilitado(p, c));
export const sinCanal = p => !!p && p.estado !== 'archivado' && !canalesDe(p).length;
// Precios de la caja: con control de stock, uno por tarjeta (hoy es obligatorio; los demás, si van en 0, la caja usa el anterior);
// sin control de stock, un precio único (todas las tarjetas iguales, como la caja)
export function preciosCaja(c) {
  if (!c) return null;
  if (c.controlStock === false) { const u = entero(c.precioUnico); return Object.fromEntries(TARJETAS.map(([k]) => [k, u > 0 ? u : 0])); }
  const p = c.precios || {};
  return Object.fromEntries(TARJETAS.map(([k]) => { const v = entero(p[k]); return [k, v > 0 ? v : 0]; }));
}
export const precioCajaTxt = c => { const p = preciosCaja(c); return p && p.hoy > 0 ? p.hoy : null; };

// ── Validar y armar el producto (crear o cambiar) ──
// datos: { nombre, tipo, recetaId, reventaId, componentes, area, unidadesPorVenta, canales: { caja: {…}, b2b: {…} } }
// ctx: { recetas, reventa, lista (los otros productos del maestro), prev (el producto antes, o null), areasCaja (códigos de la caja) }
// → { nombre, tipo, recetaId, reventaId, componentes, area, unidadesPorVenta, canales } (lanza Error con un texto para la pantalla)
export function validar(datos, { recetas = [], reventa = [], lista = [], prev = null, areasCaja = null } = {}) {
  const d = datos || {};
  const nombre = s(d.nombre).replace(/\s+/g, ' ').slice(0, 120);
  if (nombre.length < 2) throw new Error('Escribe el nombre del producto.');
  const otro = (lista || []).find(p => p && p.id !== (prev && prev.id) && p.estado !== 'archivado' && norm(p.nombre) === norm(nombre));
  if (otro) throw new Error(`Ya existe "${otro.nombre}" (${otro.id}). Usa otro nombre o cambia ese.`);
  const tipo = s(d.tipo);
  if (!TIPOS[tipo]) throw new Error('Elige de dónde sale: una receta aprobada, una reventa o un cargo.');
  const out = { nombre, tipo, recetaId: null, reventaId: null, componentes: null, area: '', unidadesPorVenta: 1 };
  const mismoQueAntes = (campo, v) => prev && prev.tipo === tipo && s(prev[campo]) === s(v);
  const pendiente = tipo === 'receta' && (d.recetaPendiente === true || d.recetaPendiente === 'true');
  if (pendiente) {
    // v0.80.1 · Receta pendiente: sin receta, con su área (las ventas van a esa área) y una nota opcional
    const a = areaCodigo(d.area);
    if (!AR.PRODUCCION.includes(a)) throw new Error('Receta pendiente: elige el área que lo produce (Panadería, Bollería, Pastelería o Cafetería), así sus ventas van a esa área.');
    const nota = s(d.notaReceta).replace(/\s+/g, ' ');
    if (nota.length > NOTA_RECETA_MAX) throw new Error(`Qué receta falta: hasta ${NOTA_RECETA_MAX} letras (tiene ${nota.length}).`);
    Object.assign(out, { area: a, recetaPendiente: true, notaReceta: nota });
  } else if (tipo === 'receta') {
    const r = (recetas || []).find(x => x && x.id === s(d.recetaId));
    if (!s(d.recetaId)) throw new Error('Elige la receta (solo las aprobadas).');
    if (!recetaAprobada(r) && !mismoQueAntes('recetaId', d.recetaId)) throw new Error(`Esa receta ${textoEstadoReceta(r)}: solo se puede elegir una receta aprobada.`);
    out.recetaId = s(d.recetaId); out.area = areaCodigo(r && r.area) || (prev && prev.area) || '';
    if (!AR.PRODUCCION.includes(out.area)) throw new Error('La receta no tiene un área que produce (Panadería, Bollería, Pastelería o Cafetería).');
  } else if (tipo === 'reventa') {
    const x = (reventa || []).find(y => y && y.id === s(d.reventaId));
    if (!s(d.reventaId)) throw new Error('Elige la reventa (Catálogo → Reventa).');
    if (!reventaElegible(x) && !mismoQueAntes('reventaId', d.reventaId)) throw new Error(x ? 'Esa reventa está archivada: reactívala en Catálogo → Reventa.' : 'Esa reventa no está en Catálogo → Reventa.');
    out.reventaId = s(d.reventaId); out.area = AR.REVENTA;
  } else if (tipo === 'cargo') {
    const a = areaCodigo(d.area);
    if (s(d.area) && !AR.CANAL.includes(a)) throw new Error('Un cargo va a un canal (B2B o B2C) o a ninguno.');
    out.area = AR.CANAL.includes(a) ? a : '';
  } else {
    // armado (solo en el modelo): varias recetas o sub recetas con sus gramos, de un área que produce
    const comp = (Array.isArray(d.componentes) ? d.componentes : []).map(c => ({ recetaId: s(c && c.recetaId), gramos: num(c && c.gramos) })).filter(c => c.recetaId);
    if (!comp.length) throw new Error('Un producto armado lleva al menos una receta o sub receta, con sus gramos.');
    comp.forEach(c => { if (!(c.gramos > 0)) throw new Error('Cada parte del armado lleva sus gramos (más que 0).'); if (!(recetas || []).some(r => r && r.id === c.recetaId && ['consolidada', 'aprobada'].includes(s(r.estado)))) throw new Error(`La parte ${c.recetaId} no es una receta aprobada.`); });
    const a = areaCodigo(d.area);
    if (!AR.PRODUCCION.includes(a)) throw new Error('Un producto armado es de un área que produce (la que lo arma).');
    out.componentes = comp.map(c => ({ recetaId: c.recetaId, gramos: red(c.gramos, 2) })); out.area = a;
  }
  // v0.80.1: si antes tenía la receta pendiente y ahora no, se apaga (queda en el historial)
  if (!pendiente && prev && prev.recetaPendiente) Object.assign(out, { recetaPendiente: false, notaReceta: '' });
  if (tipo !== 'cargo') {
    const u = s(d.unidadesPorVenta) === '' ? 1 : num(d.unidadesPorVenta);
    if (!(u > 0 && u <= 1000)) throw new Error('Unidades por venta: un número mayor que 0 (por ejemplo 6 para una caja de 6).');
    out.unidadesPorVenta = red(u, 3);
  }
  // Canales
  const c = ((d.canales || {}).caja) || {}, b = ((d.canales || {}).b2b) || {};
  const pc = (prev && prev.canales && prev.canales.caja) || {}, pb = (prev && prev.canales && prev.canales.b2b) || {};
  const caja = { habilitado: !!c.habilitado, docId: s(pc.docId) || null, controlStock: c.controlStock !== false, precios: null, precioUnico: null, excepcionHoraria: !!c.excepcionHoraria,
    autoEliminar: c.autoEliminar !== false, categoria: s(c.categoria).slice(0, 60),
    // v0.75.1 (Etapa 2b): la reventa va siempre a la pestaña Reventa de la caja (REVENTA; "REV" es el mismo)
    areaCaja: tipo === 'reventa' ? AR.REVENTA : areaCodigo(c.areaCaja) || s(c.areaCaja).toUpperCase().slice(0, 20) || '' };
  if (caja.controlStock) {
    caja.precios = Object.fromEntries(TARJETAS.map(([k]) => { const v = entero((c.precios || {})[k]); return [k, v > 0 ? v : 0]; }));
  } else { const u = entero(c.precioUnico); caja.precioUnico = u > 0 ? u : 0; caja.excepcionHoraria = false; caja.autoEliminar = false; }
  if (caja.habilitado) {
    const hoy = caja.controlStock ? caja.precios.hoy : caja.precioUnico;
    if (!(hoy > 0)) throw new Error(caja.controlStock ? 'Caja: escribe el precio de hoy (con IVA).' : 'Caja: escribe el precio (con IVA).');
    if (!caja.areaCaja) caja.areaCaja = AR.PRODUCCION.includes(out.area) ? out.area : '';
    if (!caja.areaCaja) throw new Error('Caja: elige en qué pestaña de la caja aparece.');
    if (areasCaja && areasCaja.length && !areasCaja.includes(caja.areaCaja)) throw new Error(`Caja: la pestaña ${caja.areaCaja} no existe en la caja.`);
  }
  const b2b = { habilitado: !!b.habilitado, docId: s(pb.docId) || null, precioBase: null, categoria: s(b.categoria).slice(0, 60) };
  const pbv = entero(b.precioBase); b2b.precioBase = pbv > 0 ? pbv : null;
  if (b2b.habilitado && !(b2b.precioBase > 0)) throw new Error('B2B: escribe el precio base neto.');
  out.canales = { caja, b2b };
  // v0.80.0 · Ficha para las listas de precios: formato ("800 g", "Unidad", "Caja 10 un") y descripción corta (hasta 140).
  // Si no vienen (un pedido, el armado), quedan las de antes.
  const ficha = (k, max, txt) => { if (d[k] === undefined || d[k] === null) return s(prev && prev[k]); const v = s(d[k]).replace(/\s+/g, ' '); if (v.length > max) throw new Error(`${txt}: hasta ${max} letras (tiene ${v.length}).`); return v; };
  out.formato = ficha('formato', 40, 'Formato');
  out.descripcionCorta = ficha('descripcionCorta', 140, 'Descripción corta');
  return out;
}

// Lo que cambió (para el historial): campo → { antes, despues }
export function cambiosDe(antes, despues) {
  const out = {};
  // v0.80.0: + formato y descripción corta (vacío = no tenía)
  ['formato', 'descripcionCorta', 'notaReceta'].forEach(k => { if (!(k in despues)) return; const a = s(antes && antes[k]), b = s(despues[k]); if (a !== b) out[k] = { antes: a, despues: b }; });
  // v0.80.1: receta pendiente (no tenerla = false)
  if ('recetaPendiente' in despues && !!(antes && antes.recetaPendiente) !== !!despues.recetaPendiente) out.recetaPendiente = { antes: !!(antes && antes.recetaPendiente), despues: !!despues.recetaPendiente };
  ['nombre', 'tipo', 'recetaId', 'reventaId', 'componentes', 'area', 'unidadesPorVenta', 'estado'].forEach(k => {
    if (!(k in despues)) return;
    const a = antes ? antes[k] ?? null : null, b = despues[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { antes: a, despues: b };
  });
  CANALES.forEach(cn => {
    if (!despues.canales) return;
    const a = (antes && antes.canales && antes.canales[cn]) || {}, b = despues.canales[cn] || {};
    ['habilitado', 'precios', 'precioUnico', 'precioBase', 'controlStock', 'categoria', 'areaCaja', 'excepcionHoraria', 'autoEliminar'].forEach(k => {
      if (!(k in b)) return;
      const x = a[k] ?? null, y = b[k] ?? null;
      if (JSON.stringify(x) !== JSON.stringify(y)) out[`${cn}.${k}`] = { antes: x, despues: y };
    });
  });
  return out;
}
export const conHistorial = (h, e) => [...(Array.isArray(h) ? h : []), e].slice(-40);

// ── Las copias en los canales (lo que escribe Sistema Fën) ──
export const idRecetaCanal = p => (p.tipo === 'receta' ? s(p.recetaId) : p.tipo === 'reventa' ? s(p.reventaId) : '');
// fen-ventas productos/{docId}: la misma forma de siempre de la caja (+ catalogoId, tipo, reventaId)
export function docCaja(p) {
  const c = (p.canales && p.canales.caja) || {}, pr = preciosCaja(c);
  const out = { nombre: s(p.nombre), area: p.tipo === 'reventa' ? AR.REVENTA : s(c.areaCaja) || (AR.PRODUCCION.includes(p.area) ? p.area : ''), categoria: s(c.categoria), activo: habilitado(p, 'caja'),
    precio: pr.hoy, controlStock: c.controlStock !== false, excepcionHoraria: c.controlStock !== false && !!c.excepcionHoraria, autoEliminar: c.controlStock !== false && c.autoEliminar !== false,
    idRecetaFen: idRecetaCanal(p), catalogoId: s(p.id), tipo: s(p.tipo), reventaId: s(p.reventaId),
    unidadesPorVenta: Number(p.unidadesPorVenta) > 0 ? Number(p.unidadesPorVenta) : 1 };   // v0.75.1: la caja v2.3.0 lo guarda en la foto de cada venta
  TARJETAS.forEach(([k]) => { out[CAMPO_PRECIO[k]] = pr[k]; });
  return out;
}
// fen-b2b productos/{docId}: (el nombre solo al crear: las órdenes y los precios especiales antiguos lo usan)
export function docB2b(p) {
  const b = (p.canales && p.canales.b2b) || {};
  return { nombre: s(p.nombre), precioBase: Math.round(Number(b.precioBase) || 0), categoria: s(b.categoria), idReceta: idRecetaCanal(p), area: s(p.area), estado: habilitado(p, 'b2b') ? 'activo' : 'archivado',
    catalogoId: s(p.id), tipo: s(p.tipo), reventaId: s(p.reventaId) };
}

// ── Foto de la venta (línea de una orden B2B, al crearla) ──
// prod: el producto del canal (fen-b2b productos, con catalogoId, tipo, idReceta, area, reventaId); maestro (opcional) para las unidades por venta
export function fotoLinea(prod, maestro) {
  if (!prod || !s(prod.catalogoId)) return null;
  const m = maestro || null, tipo = s((m && m.tipo) || prod.tipo);
  return { catalogoId: s(prod.catalogoId), tipo, area: s((m && m.area) || prod.area), recetaId: tipo === 'receta' ? s((m && m.recetaId) || prod.idReceta) : '', reventaId: tipo === 'reventa' ? s((m && m.reventaId) || prod.reventaId || prod.idReceta) : '',
    unidadesPorVenta: m && Number(m.unidadesPorVenta) > 0 ? Number(m.unidadesPorVenta) : 1 };
}

// ── Vínculos (la forma de fin_productos) desde el maestro ──
// ctx: { recetas: [{ id, nombre }], reventa: [cat_reventa], fin: fin_productos } → el vínculo del producto en ese canal
function vinculoBase(p, canal, docId, ctx = {}) {
  const k = clave(canal, docId), fin = ((ctx.fin || {})[k]) || null;
  const rec = (ctx.recetas || []).find(r => r && r.id === p.recetaId), rev = (ctx.reventa || []).find(x => x && x.id === p.reventaId);
  const base = { canal, productoId: s(docId), nombre: s(p.nombre), tipo: p.tipo, receta: null, recetaNombre: '', reventa: false, costoReventaNeto: null, ignorar: false,
    unidadesPorVenta: Number(p.unidadesPorVenta) > 0 ? Number(p.unidadesPorVenta) : 1, area: s(p.area), catalogoId: s(p.id), origen: 'catalogo',
    costoExtraNeto: fin && fin.costoExtraNeto !== undefined ? fin.costoExtraNeto : null };
  // v0.80.1 · Receta pendiente: asociado (a su área), sin receta: sus ventas no tienen costo directo
  if (recetaPendiente(p)) Object.assign(base, { receta: null, recetaNombre: '', recetaPendiente: true, notaReceta: s(p.notaReceta) });
  else if (p.tipo === 'receta') Object.assign(base, { receta: s(p.recetaId), recetaNombre: s(rec && rec.nombre) || s(fin && fin.recetaNombre) || s(p.nombre) });
  else if (p.tipo === 'reventa') Object.assign(base, { reventa: true, reventaId: s(p.reventaId), reventaNombre: s(rev && rev.nombre), area: s(p.area) || AR.REVENTA,
    costoReventaNeto: rev && rev.costoNeto !== null && rev.costoNeto !== undefined ? Number(rev.costoNeto) : fin && fin.costoReventaNeto !== undefined ? fin.costoReventaNeto : null });
  else if (p.tipo === 'cargo') Object.assign(base, { unidadesPorVenta: 1 });
  return base;
}
// → { 'caja_docId' | 'b2b_docId': vínculo } de todos los productos del maestro con un documento en ese canal (también los archivados:
// su historia de ventas sigue llevando a su receta)
export function vinculosMaestro(maestro, ctx = {}) {
  const out = {};
  (maestro || []).forEach(p => { if (!p || !p.id) return; CANALES.forEach(cn => { const d = p.canales && p.canales[cn] && s(p.canales[cn].docId); if (d) out[clave(cn, d)] = vinculoBase(p, cn, d, ctx); }); });
  return out;
}
// Lo que se escribe en fin_productos para un canal (la forma de finanzas-ventas.armarVinculo, con origen 'catalogo_maestro')
export function vinculoFin(p, canal, docId, ctx = {}, { hoy = '', por = '' } = {}) {
  const v = vinculoBase(p, canal, docId, ctx);
  return { ...v, tipo: p.tipo === 'armado' ? 'receta' : v.tipo, origen: 'catalogo_maestro', nota: `Del Catálogo (${p.id})`, fecha: hoy, por };
}
// Un vínculo de fin_productos ya decidido a mano (receta, reventa, no es producto o cargo)
export const decidido = v => !!(v && ['receta', 'reventa', 'ignorar', 'cargo'].includes(v.tipo));
// ¿El vínculo de Finanzas dice lo mismo que el maestro? (tipo, receta o reventa, unidades por venta)
export function mismoVinculo(fin, m) {
  if (!fin || !m) return false;
  const u = x => (Number(x && x.unidadesPorVenta) > 0 ? Number(x.unidadesPorVenta) : 1);
  if (m.tipo === 'cargo') return fin.tipo === 'cargo' || fin.tipo === 'ignorar';
  if (fin.tipo !== m.tipo || u(fin) !== u(m)) return false;
  if (m.tipo === 'receta') return s(fin.receta) === s(m.receta);
  if (m.tipo === 'reventa') return !s(fin.reventaId) || s(fin.reventaId) === s(m.reventaId);
  return true;
}

// ── Lista publicada para logística (fen-b2b config/catalogoDisponible): activos del maestro que NO están en B2B ──
export function catalogoDisponible(maestro) {
  return (maestro || []).filter(p => p && p.id && p.estado !== 'archivado' && p.tipo !== 'armado' && !habilitado(p, 'b2b'))
    .map(p => ({ id: p.id, nombre: s(p.nombre), area: s(p.area), tipo: p.tipo }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ── Pantalla Productos: filtros ──
export function filtrar(lista, { estado = 'activo', canal = 'todos', tipo = 'todos', q = '', falta = false } = {}) {
  const t = norm(q);
  return (lista || []).filter(p => estado === 'todo' || (estado === 'archivado' ? p.estado === 'archivado' : p.estado !== 'archivado'))
    .filter(p => !falta || (p.estado !== 'archivado' && recetaPendiente(p)))   // v0.80.1: "Falta receta"

    .filter(p => tipo === 'todos' || p.tipo === tipo)
    .filter(p => canal === 'todos' || (canal === 'sin' ? sinCanal(p) : habilitado(p, canal)))
    .filter(p => !t || norm(`${p.nombre} ${p.id} ${p.recetaId || ''} ${p.reventaId || ''}`).includes(t))
    .sort((a, b) => s(a.nombre).localeCompare(s(b.nombre), 'es'));
}
export function resumen(lista) {
  const xs = lista || [];
  return { activos: xs.filter(p => p.estado !== 'archivado').length, archivados: xs.filter(p => p.estado === 'archivado').length, sinCanal: xs.filter(sinCanal).length,
    caja: xs.filter(p => habilitado(p, 'caja')).length, b2b: xs.filter(p => habilitado(p, 'b2b')).length, faltaReceta: faltaReceta(xs).length };
}

// ═══════════════ "Armar el catálogo" (una sola vez): proponer grupos desde lo vivo de la caja y de B2B ═══════════════
const slug = t => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sin-nombre';
const upvDe = v => (v && Number(v.unidadesPorVenta) > 0 ? Number(v.unidadesPorVenta) : 1);
export const vivoCaja = p => !!p && p.activo !== false;
export const vivoB2b = p => !!p && p.estado !== 'archivado' && !p.quitadoEnPlanilla;
export const ES_CARGO = /despacho|flete|env[ií]o|reparto a domicilio/i;
const quitarB2b = n => s(n).replace(/\s*[-·(]?\s*b2b\)?\s*$/i, '').trim() || s(n);
// Del producto de un canal: lo que se sabe de él (Finanzas manda; si no, el ID del catálogo; si no, el nombre para un cargo)
export function leerItem(canal, p, { vinculos = {}, recetas = [], reventa = [] } = {}) {
  const v = vinculos[clave(canal, p.id)] || null, cat = s(canal === 'b2b' ? p.idReceta : p.idRecetaFen), catU = cat.toUpperCase();
  const rec = id => (recetas || []).find(r => r && r.id === id), rev = id => (reventa || []).find(x => x && x.id === id);
  const it = { canal, docId: p.id, nombre: s(p.nombre) || p.id, tipo: null, recetaId: null, reventaId: null, upv: 1, origen: '', aviso: '', doc: p };
  if (v && v.tipo === 'receta' && s(v.receta)) Object.assign(it, { tipo: 'receta', recetaId: s(v.receta), upv: upvDe(v), origen: 'finanzas' });
  else if (v && v.tipo === 'reventa') Object.assign(it, { tipo: 'reventa', reventaId: s(v.reventaId) || (rev(catU) ? catU : null), upv: upvDe(v), origen: 'finanzas' });
  else if (v && (v.tipo === 'ignorar' || v.tipo === 'cargo')) Object.assign(it, { tipo: ES_CARGO.test(it.nombre) || v.tipo === 'cargo' ? 'cargo' : null, origen: 'finanzas', aviso: v.tipo === 'ignorar' && !ES_CARGO.test(it.nombre) ? 'En Finanzas dice "No es un producto": elige cargo o archívalo.' : '' });
  else if (cat && rec(cat)) Object.assign(it, { tipo: 'receta', recetaId: cat, origen: 'catalogo' });
  else if (cat && rev(catU)) Object.assign(it, { tipo: 'reventa', reventaId: catU, origen: 'catalogo' });
  else if (ES_CARGO.test(it.nombre)) Object.assign(it, { tipo: 'cargo', origen: 'nombre' });
  if (it.tipo === 'receta') { const r = rec(it.recetaId); if (!recetaAprobada(r)) it.aviso = `La receta ${it.recetaId} ${textoEstadoReceta(r)}: elige una aprobada (o "Receta pendiente" si se sigue vendiendo).`; }
  if (it.tipo === 'reventa' && !it.reventaId) it.aviso = 'Es reventa, pero sin su ID de la lista: elígela.';
  if (it.tipo === 'reventa' && it.reventaId && !reventaElegible(rev(it.reventaId))) it.aviso = `La reventa ${it.reventaId} ${rev(it.reventaId) ? 'está archivada' : 'no está en la lista'}: elige otra.`;
  if (!it.tipo && !it.aviso) it.aviso = 'Sin receta ni reventa: elige una receta, una reventa o un cargo, "Receta pendiente" si se sigue vendiendo sin receta aprobada, o archívalo.';
  return it;
}
const datosCaja = d => ({ habilitado: true, controlStock: d.controlStock !== false, precios: { hoy: Number(d.precioHoy || d.precio) || 0, ayer: Number(d.precioAyer) || 0, antesayer: Number(d.precioAntesayer) || 0, cuartoDia: Number(d.precioCuartoDia) || 0, ultimaOferta: Number(d.precioUltimaOferta) || 0 },
  precioUnico: d.controlStock === false ? Number(d.precioHoy || d.precio) || 0 : null, excepcionHoraria: !!d.excepcionHoraria, autoEliminar: d.autoEliminar !== false, categoria: s(d.categoria), areaCaja: s(d.area) });
const datosB2b = d => ({ habilitado: true, precioBase: Number(d.precioBase) || 0, categoria: s(d.categoria) });
// datos: { caja: [productos fen-ventas], b2b: [productos fen-b2b], vinculos, recetas, reventa, maestro: [cat_productos] }
// → [grupo] con { gid, nombre, tipo, recetaId, reventaId, unidadesPorVenta, area, caja: item | null, b2b: item | null, accion 'crear', avisos [] }
// Se juntan la caja y B2B que llevan a la misma receta (o reventa) con las mismas unidades por venta; dos de la caja con la misma
// receta quedan en grupos separados (uno con el primero de B2B, por nombre). Lo ya unido al maestro (catalogoId) no se propone.
export function proponerGrupos(datos) {
  const ya = new Set((datos.maestro || []).map(p => p.id)), docs = new Set();
  // También lo que el maestro ya tiene como documento de un canal (un armado que se cortó antes de escribir el catalogoId)
  (datos.maestro || []).forEach(p => CANALES.forEach(cn => { const d = p.canales && p.canales[cn] && s(p.canales[cn].docId); if (d) docs.add(clave(cn, d)); }));
  const unido = (cn, p) => (s(p.catalogoId) && ya.has(s(p.catalogoId))) || docs.has(clave(cn, p.id));
  const items = [];
  (datos.caja || []).filter(p => p && p.id && vivoCaja(p) && !unido('caja', p)).forEach(p => items.push(leerItem('caja', p, datos)));
  (datos.b2b || []).filter(p => p && p.id && vivoB2b(p) && !unido('b2b', p)).forEach(p => items.push(leerItem('b2b', p, datos)));
  const llave = it => it.tipo === 'receta' ? `r:${it.recetaId}|${it.upv}` : it.tipo === 'reventa' && it.reventaId ? `v:${it.reventaId}|${it.upv}` : it.tipo === 'cargo' ? `c:${slug(quitarB2b(it.nombre))}` : `s:${it.canal}:${it.docId}`;
  const porLlave = new Map();
  items.forEach(it => { const k = llave(it); if (!porLlave.has(k)) porLlave.set(k, []); porLlave.get(k).push(it); });
  const recetas = datos.recetas || [], grupos = [];
  porLlave.forEach((xs, k) => {
    const ord = (a, b) => a.nombre.localeCompare(b.nombre, 'es');
    const cs = xs.filter(x => x.canal === 'caja').sort(ord), bs = xs.filter(x => x.canal === 'b2b').sort(ord);
    const n = Math.max(cs.length, bs.length);
    for (let i = 0; i < n; i++) {
      const c = cs[i] || null, b = bs[i] || null, base = c || b;
      const r = base.tipo === 'receta' ? recetas.find(x => x.id === base.recetaId) : null;
      const area = base.tipo === 'receta' ? areaCodigo(r && r.area) : base.tipo === 'reventa' ? AR.REVENTA : base.tipo === 'cargo' ? (c ? '' : 'B2B') : '';
      grupos.push({ gid: `${k}#${i}`, nombre: c ? c.nombre : quitarB2b(b.nombre), tipo: base.tipo, recetaId: base.recetaId, reventaId: base.reventaId, unidadesPorVenta: base.upv, area,
        caja: c, b2b: b, accion: 'crear', avisos: [...new Set([c && c.aviso, b && b.aviso].filter(Boolean))], origen: base.origen });
    }
  });
  const orden = g => (g.avisos.length ? 0 : 1);
  return grupos.sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, 'es'));
}
// Lo que falta para guardar un grupo ('' = listo). accion 'archivar' archiva sus documentos en los canales (sin producto).
export function faltaGrupo(g, ctx) {
  if (g.accion === 'archivar') return '';
  try { validar(datosGrupo(g), { ...ctx, lista: [] }); return ''; }
  catch (e) { return e.message + (!g.recetaPendiente && /receta aprobada|Elige de dónde sale/.test(e.message) ? ' Si se sigue vendiendo sin receta aprobada, elige "Receta pendiente".' : ''); }   // v0.80.1
}
export function datosGrupo(g) {
  return { nombre: g.nombre, tipo: g.tipo, recetaId: g.recetaPendiente ? null : g.recetaId, reventaId: g.reventaId, area: g.area, unidadesPorVenta: g.unidadesPorVenta,
    ...(g.recetaPendiente && g.tipo === 'receta' ? { recetaPendiente: true, notaReceta: g.notaReceta || '' } : {}),   // v0.80.1
    canales: { caja: g.caja ? datosCaja(g.caja.doc) : { habilitado: false }, b2b: g.b2b ? datosB2b(g.b2b.doc) : { habilitado: false } } };
}
// Nombres repetidos entre los grupos que se crean (o con el maestro activo)
export function repetidos(grupos, maestro = []) {
  const vistos = new Map(), out = [];
  (maestro || []).filter(p => p.estado !== 'archivado').forEach(p => vistos.set(norm(p.nombre), p.id));
  (grupos || []).filter(g => g.accion !== 'archivar').forEach(g => { const k = norm(g.nombre); if (vistos.has(k)) out.push(g.gid); else vistos.set(k, g.gid); });
  return out;
}
// El plan de escrituras al guardar: productos del maestro (con su ID), qué se escribe en cada documento de los canales,
// qué se archiva y qué vínculos de fin_productos se crean (solo donde no había uno decidido; si había uno distinto, se deja:
// los meses antiguos siguen con él, y el maestro manda desde vigenteDesde).
// ctx: { siguiente (número), recetas, reventa, vinculos, maestro, por, en, hoy, areasCaja }
export function planGuardar(grupos, ctx) {
  const err = [];
  const crear = (grupos || []).filter(g => g.accion !== 'archivar'), arch = (grupos || []).filter(g => g.accion === 'archivar');
  crear.forEach(g => { const m = faltaGrupo(g, ctx); if (m) err.push(`${g.nombre}: ${m}`); });
  const rep = repetidos(grupos, ctx.maestro);
  rep.forEach(gid => { const g = grupos.find(x => x.gid === gid); err.push(`${g.nombre}: el nombre se repite (cámbialo en uno).`); });
  if (err.length) { const e = new Error(err.slice(0, 6).join(' · ') + (err.length > 6 ? ` · y ${err.length - 6} más` : '')); e.code = 'falta'; e.lista = err; throw e; }
  let n = siguienteNumero({ siguiente: ctx.siguiente }, ctx.maestro);
  const productos = [], caja = [], b2b = [], vinculos = [], archivarCaja = [], archivarB2b = [];
  let distintos = 0;
  crear.forEach(g => {
    const v = validar(datosGrupo(g), { ...ctx, lista: [] });
    const id = idDe(n++);
    if (g.caja) v.canales.caja.docId = g.caja.docId;
    if (g.b2b) v.canales.b2b.docId = g.b2b.docId;
    const doc = { id, ...v, estado: 'activo', origen: 'migracion', creadoEn: ctx.en, creadoPor: ctx.por, historial: [{ accion: 'armado del catálogo', por: ctx.por, en: ctx.en, canales: { caja: g.caja ? g.caja.docId : null, b2b: g.b2b ? g.b2b.docId : null } }] };
    productos.push(doc);
    if (g.caja) caja.push({ docId: g.caja.docId, cambios: { catalogoId: id, tipo: doc.tipo, reventaId: s(doc.reventaId), idRecetaFen: idRecetaCanal(doc) } });
    if (g.b2b) b2b.push({ docId: g.b2b.docId, cambios: { catalogoId: id, tipo: doc.tipo, reventaId: s(doc.reventaId), idReceta: idRecetaCanal(doc), area: doc.area } });
    [['caja', g.caja], ['b2b', g.b2b]].forEach(([cn, it]) => {
      if (!it || !conVinculoFin(doc)) return;   // v0.80.1: la receta pendiente no lleva vínculo en fin_productos (Finanzas lo lee del maestro)
      const k = clave(cn, it.docId), prev = (ctx.vinculos || {})[k], nuevo = vinculoFin(doc, cn, it.docId, ctx, ctx);
      if (!decidido(prev)) vinculos.push({ clave: k, doc: nuevo, antes: prev || null });
      else if (!mismoVinculo(prev, nuevo)) distintos++;
    });
  });
  arch.forEach(g => { if (g.caja) archivarCaja.push(g.caja.docId); if (g.b2b) archivarB2b.push(g.b2b.docId); });
  return { productos, caja, b2b, vinculos, archivarCaja, archivarB2b, distintos, siguiente: n };
}

// ═══════════════ Pedidos de productos (logística en fen-b2b solicitudes tipo 'producto'; la caja en fen-ventas solicitudes_producto) ═══════════════
// → [{ origen 'b2b'|'caja', id, nombre, catalogoId, recetaId, reventaId, precio, cliente, sucursal, por, en, nota, prod (del maestro) | null, accion }]
//   accion: 'habilitar' (el producto existe: se habilita en ese canal), 'ya' (ya está en ese canal), 'crear' (desde su receta o reventa), 'elegir'
export function pedidos({ b2b = [], caja = [] } = {}, maestro = []) {
  const porId = new Map((maestro || []).map(p => [p.id, p]));
  const buscar = (catalogoId, recetaId, reventaId) => (catalogoId && porId.get(catalogoId)) || (maestro || []).find(p => p.estado !== 'archivado' && ((recetaId && p.tipo === 'receta' && p.recetaId === recetaId) || (reventaId && p.tipo === 'reventa' && p.reventaId === reventaId))) || null;
  const out = [];
  (b2b || []).filter(x => x && x.tipo === 'producto' && (x.estado || 'pendiente') === 'pendiente').forEach(x => {
    const recetaId = s(x.recetaId || x.idReceta), reventaId = /^REV\d+$/i.test(recetaId) ? recetaId.toUpperCase() : s(x.reventaId);
    const prod = buscar(s(x.catalogoId), /^REV/i.test(recetaId) ? '' : recetaId, reventaId);
    out.push({ origen: 'b2b', id: x.id, nombre: s(x.producto) || s(prod && prod.nombre), catalogoId: s(x.catalogoId) || s(prod && prod.id), recetaId: /^REV/i.test(recetaId) ? '' : recetaId, reventaId,
      precio: Number(x.precio) || 0, cliente: s(x.cliente), clienteId: s(x.clienteId), sucursal: '', por: s(x.por), en: x.en || null, nota: s(x.nota), prod,
      accion: prod ? (habilitado(prod, 'b2b') ? 'ya' : 'habilitar') : recetaId || reventaId ? 'crear' : 'elegir' });
  });
  (caja || []).filter(x => x && (x.estado || 'pendiente') === 'pendiente').forEach(x => {
    const prod = buscar(s(x.catalogoId), s(x.recetaId), s(x.reventaId));
    out.push({ origen: 'caja', id: x.id, nombre: s(x.nombre) || s(prod && prod.nombre), catalogoId: s(x.catalogoId) || s(prod && prod.id), recetaId: s(x.recetaId), reventaId: s(x.reventaId),
      precio: Number(x.precioSugerido || x.precio) || 0, cliente: '', clienteId: '', sucursal: s(x.sucursal), por: s(x.por), en: x.en || null, nota: s(x.nota), prod,
      accion: prod ? (habilitado(prod, 'caja') ? 'ya' : 'habilitar') : s(x.recetaId) || s(x.reventaId) ? 'crear' : 'elegir' });
  });
  return out;
}
// v0.80.1 · "Unir con su receta": los datos del producto con la receta elegida (canales, precios y ficha como estaban)
export function datosUnir(p, recetaId) {
  return { nombre: p.nombre, tipo: 'receta', recetaId: s(recetaId), recetaPendiente: false, componentes: p.componentes || null, area: p.area, unidadesPorVenta: p.unidadesPorVenta,
    canales: JSON.parse(JSON.stringify(p.canales || {})) };
}
// Los datos del diálogo para resolver un pedido (crear o habilitar con el precio pedido)
export function datosPedido(pd, { recetas = [] } = {}) {
  const canal = pd.origen === 'caja' ? 'caja' : 'b2b';
  if (pd.prod) {
    const p = pd.prod, c = JSON.parse(JSON.stringify(p.canales || {}));
    c[canal] = { ...(c[canal] || {}), habilitado: true };
    if (canal === 'b2b' && !(Number(c.b2b.precioBase) > 0) && pd.precio > 0) c.b2b.precioBase = pd.precio;
    if (canal === 'caja' && pd.precio > 0 && !(c.caja.precios && c.caja.precios.hoy > 0)) c.caja = { ...c.caja, controlStock: c.caja.controlStock !== false, precios: { ...(c.caja.precios || {}), hoy: pd.precio } };
    return { id: p.id, datos: { nombre: p.nombre, tipo: p.tipo, recetaId: p.recetaId, reventaId: p.reventaId, componentes: p.componentes, area: p.area, unidadesPorVenta: p.unidadesPorVenta, canales: c,
      ...(recetaPendiente(p) ? { recetaPendiente: true, notaReceta: s(p.notaReceta) } : {}) } };   // v0.80.1: habilitar un producto con la receta pendiente
  }
  const r = (recetas || []).find(x => x.id === pd.recetaId);
  const canales = { caja: { habilitado: canal === 'caja', controlStock: true, precios: { hoy: canal === 'caja' ? pd.precio : 0 } }, b2b: { habilitado: canal === 'b2b', precioBase: canal === 'b2b' ? pd.precio : null } };
  return { id: null, datos: { nombre: pd.nombre || s(r && r.nombre), tipo: pd.reventaId ? 'reventa' : pd.recetaId ? 'receta' : '', recetaId: pd.recetaId || null, reventaId: pd.reventaId || null, unidadesPorVenta: 1, canales } };
}
