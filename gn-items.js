// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos nuevo: catálogo de ítems (la entrada al plan de cuentas)  v0.102.0 · reglas puras, sin red
//  Aprobado por Emmanuel el 25 oct (claude/revision-items-contra-mapa.md). Cada ítem apunta a UNA cuenta del plan (plan-cuentas.js) y la
//  cuenta dice dónde va en los estados financieros. Reemplaza a la lista de ítems del Gastos anterior y a Finanzas → Clasificación.
//  · gn_items/{clave}: { nombre, grupo, cuenta, estado: 'activo' | 'archivado', pasaA (el ítem nuevo, si se archivó por otro), sistema,
//    area (sugerida), historial }. Nada se borra: un ítem que sobra se archiva, y si tiene reemplazo apunta a él.
//  · Un nombre antiguo que quedó en documentos ya clasificados no se reescribe: el ítem antiguo queda archivado y apunta al nuevo
//    (resolver). Las fichas de los proveedores y los compromisos sí pasan al nombre nuevo.
//  · Los ítems del sistema (F29, Previred, créditos) tienen su cuenta fija.
// ═══════════════════════════════════════════════
import { norm } from './gn-modelo.js?v=0.138.0';
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as PC from './plan-cuentas.js?v=0.138.0';

const s = v => String(v == null ? '' : v).trim();
const entero = v => { const x = Math.round(Number(v)); return isFinite(x) ? x : 0; };
export const COL = 'gn_items';
export const GRUPOS = ['Producir y vender', 'Local', 'Servicios', 'Operación', 'Administración', 'Venta', 'Trabajadores', 'Banco y fisco', 'Inversiones'];
export const GRUPO_SISTEMA = 'Del sistema';
export const claveItem = nombre => norm(nombre).toLowerCase().replace(/ /g, '_').slice(0, 80) || 'sin_nombre';
// "MANTENIMIENTO CORRECTIVO (IND)" es el mismo que "MANTENIMIENTO CORRECTIVO": el área la dice el reparto
const sinInd = t => norm(t).replace(/ (IND|INDIRECTO)$/, '');

// ── El catálogo aprobado (desde: los nombres del Gastos anterior que pasan a este) ──
export const CATALOGO = [
  { nombre: 'MATERIA PRIMA', grupo: 'Producir y vender', cuenta: '1.4.1', desde: ['MATERIAS PRIMAS'] },
  { nombre: 'PRODUCTOS DE REVENTA', grupo: 'Producir y vender', cuenta: '1.4.2', desde: ['REVENTA'] },
  { nombre: 'PACKAGING', grupo: 'Producir y vender', cuenta: '5.7', desde: [] },
  // v0.103.0 · El flete de una compra (factura aparte del courier) se une a su compra y se suma a su costo (aprobado por Emmanuel el 25 oct).
  // Sin unir, cuenta como inventario (no entra al resultado) y el cierre lo avisa.
  { nombre: 'FLETE DE COMPRA', grupo: 'Producir y vender', cuenta: '1.4.1', desde: ['FLETE', 'FLETES', 'FLETE DE COMPRAS'] },
  { nombre: 'ARRIENDO', grupo: 'Local', cuenta: '6.2', desde: ['ARRIENDO SALA PRODUCCION', 'ARRIENDO SALA DE PRODUCCION'] },
  { nombre: 'PATENTE Y DERECHOS MUNICIPALES', grupo: 'Local', cuenta: '6.2', desde: ['PATENTE MUNICIPAL', 'PATENTE'] },
  { nombre: 'TRÁMITES Y PERMISOS', grupo: 'Local', cuenta: '6.6', desde: ['GESTION EMPRESARIAL'] },
  { nombre: 'LUZ', grupo: 'Servicios', cuenta: '6.3', desde: ['LUZ AINAVILLO', 'LUZ BARROS ARANA'] },
  { nombre: 'AGUA', grupo: 'Servicios', cuenta: '6.3', desde: ['AGUA AINAVILLO', 'AGUA BARROS ARANA'] },
  { nombre: 'GAS', grupo: 'Servicios', cuenta: '6.3', desde: [] },
  { nombre: 'INTERNET Y TELEFONÍA', grupo: 'Servicios', cuenta: '6.3', desde: ['INTERNET', 'TELEFONIA', 'TELEFONO'] },
  { nombre: 'INSUMOS DE ASEO Y OPERACIÓN', grupo: 'Operación', cuenta: '6.5', desde: ['SANITARIOS'] },
  { nombre: 'MANTENCIÓN PREVENTIVA', grupo: 'Operación', cuenta: '6.4', desde: ['MANTENIMIENTO PREVENTIVO DE EQUIPOS', 'MANTENIMIENTO PREVENTIVO'] },
  { nombre: 'REPARACIONES', grupo: 'Operación', cuenta: '6.4', desde: ['MANTENIMIENTO CORRECTIVO'] },
  { nombre: 'CONTABILIDAD', grupo: 'Administración', cuenta: '6.6', desde: ['CONTADOR'] },
  { nombre: 'SOFTWARE Y SUSCRIPCIONES', grupo: 'Administración', cuenta: '6.6', desde: [] },
  { nombre: 'SEGUROS', grupo: 'Administración', cuenta: '6.10', desde: [] },
  { nombre: 'MARKETING Y PUBLICIDAD', grupo: 'Venta', cuenta: '6.9', desde: ['MARKETING', 'PUBLICIDAD'] },
  { nombre: 'TRANSPORTE Y COMBUSTIBLE', grupo: 'Venta', cuenta: '6.11', desde: ['BENCINA'] },
  { nombre: 'COMISIONES DE TARJETA Y MERCADO PAGO', grupo: 'Venta', cuenta: '5.4', desde: ['COMISIONES', 'COMISION TRANSBANK', 'COMISIONES TRANSBANK', 'COMISION MERCADO PAGO', 'COMISIONES MERCADO PAGO'] },   // Emmanuel, 25 oct: llegan facturas de ambos
  { nombre: 'ARRIENDO DE POS (TRANSBANK)', grupo: 'Venta', cuenta: '5.4.2', desde: ['ARRIENDO MAQUINA TRANSBANK'] },
  { nombre: 'REMUNERACIONES', grupo: 'Trabajadores', cuenta: '6.1', desde: ['REMUNERACIONES PRODUCCION', 'OTRAS REMUNERACIONES'] },
  { nombre: 'FINIQUITO', grupo: 'Trabajadores', cuenta: '6.1', desde: ['FINIQUITOS'] },
  { nombre: 'BIENESTAR DE LOS TRABAJADORES', grupo: 'Trabajadores', cuenta: '6.1', desde: ['BIENESTAR'] },
  { nombre: 'CAPACITACIÓN Y UNIFORMES', grupo: 'Trabajadores', cuenta: '6.12', desde: [] },
  { nombre: 'COMISIONES BANCARIAS', grupo: 'Banco y fisco', cuenta: '7.2', desde: ['COMISIONES BACARIAS'] },
  { nombre: 'CONVENIO TGR', grupo: 'Banco y fisco', cuenta: '2.9', desde: ['TGR'] },
  { nombre: 'EQUIPOS Y MAQUINARIA', grupo: 'Inversiones', cuenta: '1.5.1', desde: ['ACTIVO FIJO', 'COMPRA MAQUINA TRANSBANK'] },
  { nombre: 'HABILITACIÓN DE LOCALES', grupo: 'Inversiones', cuenta: '1.5.2', desde: ['HABILITACION INFRAESTRUCTURA'] },
  { nombre: 'ACTIVO INTANGIBLE', grupo: 'Inversiones', cuenta: '1.5.3', desde: [] }
];
// Los que crea el sistema (gn-pdf.js ITEMS_F29, ITEMS_CREDITO; gn-bandeja.js Previred y el ajuste de un compromiso): cuenta fija.
// elegible: también se puede elegir a mano (por ejemplo, los intereses y multas de un convenio de la TGR).
export const SISTEMA = [
  { nombre: 'COTIZACIONES PREVISIONALES', cuenta: '6.1' }, { nombre: 'MULTAS E INTERESES PREVIRED', cuenta: '7.3' },
  { nombre: 'IVA (F29)', cuenta: '2.5.1' }, { nombre: 'PPM (F29)', cuenta: '1.3.2' }, { nombre: 'OTROS IMPUESTOS (F29)', cuenta: '2.5' }, { nombre: 'IMPUESTOS (F29)', cuenta: '2.5' },
  { nombre: 'RETENCION BOLETAS DE TERCEROS (F29)', cuenta: '6.1' }, { nombre: 'IMPUESTO UNICO TRABAJADORES (F29)', cuenta: '6.1' }, { nombre: 'MULTAS E INTERESES (F29)', cuenta: '7.3' },
  { nombre: 'CUOTA DE CREDITO', cuenta: '2.6' }, { nombre: 'INTERESES DE CREDITO', cuenta: '7.1', elegible: true }, { nombre: 'CAPITAL DE CREDITO', cuenta: '2.6' },
  { nombre: 'MULTAS E INTERESES', cuenta: '7.3', elegible: true }
];
// Del Gastos anterior que se archivan sin reemplazo (sin uso, ya no se usan, o los crea el sistema). OTROS INSUMOS: se decide por proveedor.
export const OTROS_INSUMOS = 'OTROS INSUMOS';
export const FLETE = 'FLETE DE COMPRA';
// Los ítems del catálogo aprobado (y del sistema) que faltan en el catálogo vivo: los que agrega una versión nueva (se crean solos al abrir Gastos)
export const faltantes = items => { const I = indice(items); return CATALOGO.filter(x => !I[norm(x.nombre)]).map(x => ({ clave: claveItem(x.nombre), nombre: x.nombre, grupo: x.grupo, cuenta: x.cuenta, sistema: false }))
  .concat(SISTEMA.filter(x => !I[norm(x.nombre)]).map(x => ({ clave: claveItem(x.nombre), nombre: x.nombre, grupo: GRUPO_SISTEMA, cuenta: x.cuenta, sistema: true, elegible: !!x.elegible }))); };
export const OPCIONES_OTROS = ['PACKAGING', 'INSUMOS DE ASEO Y OPERACIÓN'];
export const SIN_REEMPLAZO = ['DELIVERY', 'PROMOCIONES', 'S G V TOTEAT', 'S G V', 'TOTEAT', 'IVA', 'MULTA COTIZACIONES', 'PRESTAMO BANCARIO', 'TARJETA CREDITO', 'TARJETA DE CREDITO', OTROS_INSUMOS];
const SISTEMA_N = Object.fromEntries(SISTEMA.map(x => [norm(x.nombre), x]));
const ORDEN = Object.fromEntries(CATALOGO.map((x, i) => [norm(x.nombre), i]));
// El nombre nuevo de un nombre del Gastos anterior: el ítem nuevo (puede ser el mismo), '' (se archiva sin reemplazo) o null (no se sabe)
const DESTINO = (() => { const m = {}; CATALOGO.forEach(x => { m[norm(x.nombre)] = x.nombre; x.desde.forEach(d => { m[norm(d)] = x.nombre; }); }); SISTEMA.forEach(x => { m[norm(x.nombre)] = x.nombre; }); SIN_REEMPLAZO.forEach(n => { m[norm(n)] = ''; }); return m; })();
export function destinoInicial(nombre) { const a = norm(nombre), b = sinInd(nombre); return a in DESTINO ? DESTINO[a] : b in DESTINO ? DESTINO[b] : null; }

// ═══════════════ El catálogo vivo ═══════════════
export const indice = items => { const I = {}; (items || []).forEach(x => { if (x && s(x.nombre)) I[norm(x.nombre)] = x; }); return I; };
export const activo = (items) => (items || []).length > 0;   // ¿ya se pasó al catálogo nuevo?
// El ítem que cuenta para un nombre: sigue "pasa a" de los archivados (hasta 6 saltos). Los del sistema siempre están.
// → { ok, nombre (el que cuenta), cuenta, item, motivo: 'desconocido' | 'archivado' | 'sin_cuenta' | '', via [nombres archivados] }
export function resolver(nombre, I) {
  let x = (I || {})[norm(nombre)]; const via = [];
  for (let i = 0; x && x.estado === 'archivado' && s(x.pasaA) && i < 6; i++) { via.push(x.nombre); x = (I || {})[norm(x.pasaA)]; }
  if (!x) { const sis = SISTEMA_N[norm(nombre)]; if (sis && !via.length) return { ok: true, nombre: sis.nombre, cuenta: sis.cuenta, item: { ...sis, sistema: true, grupo: GRUPO_SISTEMA, estado: 'activo' }, motivo: '', via }; return { ok: false, nombre: s(nombre), cuenta: '', item: null, motivo: 'desconocido', via }; }
  if (x.estado === 'archivado') return { ok: false, nombre: x.nombre, cuenta: '', item: x, motivo: 'archivado', via };
  if (!PC.existe(x.cuenta)) return { ok: false, nombre: x.nombre, cuenta: '', item: x, motivo: 'sin_cuenta', via };
  return { ok: true, nombre: x.nombre, cuenta: x.cuenta, item: x, motivo: '', via };
}
const ordenGrupo = g => { const i = GRUPOS.indexOf(g); return i < 0 ? 99 : i; };
export const ordenar = l => l.slice().sort((a, b) => ordenGrupo(a.grupo) - ordenGrupo(b.grupo) || (ORDEN[norm(a.nombre)] ?? 999) - (ORDEN[norm(b.nombre)] ?? 999) || s(a.nombre).localeCompare(s(b.nombre), 'es'));
// Los que se eligen al clasificar: los activos con cuenta (los del sistema, solo los elegibles)
export const paraElegir = items => ordenar((items || []).filter(x => x.estado !== 'archivado' && PC.existe(x.cuenta) && (!x.sistema || x.elegible)))
  .map(x => ({ item: x.nombre, area: s(x.area), grupo: s(x.grupo), cuenta: s(x.cuenta) }));
// Lo que escribió o eligió la persona → el nombre que se guarda (un nombre antiguo pasa al nuevo) o el error
// sistema: true solo al reclasificar un documento que creó el sistema (F29, Previred, créditos): los ítems del sistema no se eligen a mano
export function entrada(texto, I, { sistema = false } = {}) {
  const t = s(texto); if (!t) return { error: 'Elija el ítem.' };
  const r = resolver(t, I);
  if (r.ok && r.item && r.item.sistema && !r.item.elegible && !sistema) return { error: `«${r.nombre}» lo usa solo el sistema (F29, Previred o créditos): elija otro ítem de la lista.` };
  if (r.ok) return { nombre: r.nombre };
  if (r.motivo === 'archivado') return { error: `«${t}» está archivado${r.via.length ? '' : ' sin reemplazo'}: elija otro ítem de la lista.` };
  if (r.motivo === 'sin_cuenta') return { error: `«${r.nombre}» no tiene cuenta: póngasela en Gastos → Ítems.` };
  return { error: `«${t}» no está en el catálogo de ítems: elíjalo de la lista o créelo en Gastos → Ítems (con su cuenta).` };
}
// Validar un ítem nuevo o cambiado. prev: el guardado (o null). items: todo el catálogo.
export function validarItem(d, prev, items) {
  const nombre = s(prev ? prev.nombre : d.nombre).toUpperCase().slice(0, 60);
  if (!nombre) throw new Error('Escriba el nombre del ítem.');
  if (prev && prev.sistema) throw new Error('Los ítems del sistema tienen su cuenta fija.');
  if (!prev && (items || []).some(x => norm(x.nombre) === norm(nombre))) throw new Error(`Ya existe un ítem «${nombre}» (puede estar archivado).`);
  if (!GRUPOS.includes(s(d.grupo))) throw new Error('Elija el grupo.');
  if (!PC.existe(d.cuenta)) throw new Error('Elija la cuenta.');
  return { nombre, grupo: s(d.grupo), cuenta: s(d.cuenta), area: s(d.area).toUpperCase().slice(0, 10) };
}
// Archivar con reemplazo: el reemplazo existe, está activo y no forma un círculo
export function validarArchivo(nombre, pasaA, items) {
  if (!s(pasaA)) return '';
  const I = indice(items), x = I[norm(pasaA)];
  if (norm(pasaA) === norm(nombre)) return 'Un ítem no puede pasar a sí mismo.';
  if (!x) return `«${pasaA}» no está en el catálogo.`;
  if (x.estado === 'archivado') return `«${x.nombre}» también está archivado: elija uno activo.`;
  return '';
}

// ═══════════════ Dónde se usa cada nombre ═══════════════
// docs (desde el inicio, con su clasificación efectiva), fichas de proveedores (ítem y productos) y compromisos.
// lineas: las de gn-finanzas.gastosParaFinanzas (montos desde el inicio). → { NORM: { nombre, docs, fichas, comps, monto, docIds, provs } }
export function usos({ lineas = [], provs = {}, comps = [] } = {}) {
  const U = {}, u = n => { const k = norm(n); return U[k] || (U[k] = { nombre: s(n), docs: 0, fichas: 0, comps: 0, monto: 0, docIds: new Set(), provs: new Set() }); };
  lineas.forEach(l => { const x = u(l.itemOriginal || l.itemGasto); x.monto += entero(l.montoNeto); if (!x.docIds.has(l.docId)) { x.docIds.add(l.docId); x.docs++; } });
  Object.entries(provs || {}).forEach(([k, p]) => { if (!p) return; const n = new Set([s(p.item), ...Object.values(p.productos || {}).map(x => s(x && x.item))].filter(Boolean).map(t => t)); n.forEach(t => { const x = u(t); x.fichas++; x.provs.add(k); }); });
  (comps || []).forEach(c => { if (s(c.item)) u(c.item).comps++; });
  return U;
}
// Lo que hay que ubicar: nombres en uso que no llegan a un ítem activo con cuenta
export function porRevisar(U, I) {
  return Object.values(U).filter(x => !resolver(x.nombre, I).ok).map(x => ({ nombre: x.nombre, motivo: resolver(x.nombre, I).motivo, docs: x.docs, fichas: x.fichas, comps: x.comps, monto: x.monto }))
    .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto) || a.nombre.localeCompare(b.nombre, 'es'));
}

// ═══════════════ Pasar al catálogo nuevo (una sola vez) ═══════════════
// viejos: la lista de ítems del Gastos anterior ([{ item, archivado… }]). lineas: gn-finanzas sin catálogo (nombres tal cual).
// docs, provs, comps: los del Gastos nuevo. tipoAntes(nombre) → el tipo con que contaba (Finanzas → Clasificación), para mostrar el cambio.
// → { crear, archivar, pasan, otros { grupos, monto }, revisar, sinUso, total }
export function planMigracion({ viejos = [], lineas = [], docs = [], provs = {}, comps = [], tipoAntes = () => '' } = {}) {
  const U = usos({ lineas, provs, comps }), dest = n => destinoInicial(n);
  const crear = CATALOGO.map(x => ({ clave: claveItem(x.nombre), nombre: x.nombre, grupo: x.grupo, cuenta: x.cuenta, estado: 'activo', sistema: false }))
    .concat(SISTEMA.map(x => ({ clave: claveItem(x.nombre), nombre: x.nombre, grupo: GRUPO_SISTEMA, cuenta: x.cuenta, estado: 'activo', sistema: true, elegible: !!x.elegible })));
  const nuevos = new Set(crear.map(x => norm(x.nombre)));
  // Todos los nombres conocidos: los de la lista anterior y los que están en uso
  const nombres = {};
  (viejos || []).forEach(v => { const n = s(v.item || v.nombre); if (n) nombres[norm(n)] = n; });
  Object.values(U).forEach(x => { if (!nombres[norm(x.nombre)]) nombres[norm(x.nombre)] = x.nombre; });
  const archivar = [], pasan = [], revisar = [], sinUso = [];
  Object.entries(nombres).forEach(([k, n]) => {
    const uso = U[k] || { docs: 0, fichas: 0, comps: 0, monto: 0 }, usado = uso.docs + uso.fichas + uso.comps > 0, d = dest(n);
    if (nuevos.has(k)) { if (usado) pasan.push({ viejo: n, nuevo: crear.find(x => norm(x.nombre) === k).nombre, cuenta: crear.find(x => norm(x.nombre) === k).cuenta, ...cuenta(uso), antes: tipoAntes(n) }); return; }
    if (k === norm(OTROS_INSUMOS)) { archivar.push({ clave: claveItem(n), nombre: n, pasaA: '', motivo: 'se decide por proveedor' }); return; }
    if (d) { archivar.push({ clave: claveItem(n), nombre: n, pasaA: d, motivo: 'pasa al nuevo' }); if (usado) pasan.push({ viejo: n, nuevo: d, cuenta: crear.find(x => norm(x.nombre) === norm(d)).cuenta, ...cuenta(uso), antes: tipoAntes(n) }); else sinUso.push(n); return; }
    if (d === '' || !usado) { archivar.push({ clave: claveItem(n), nombre: n, pasaA: '', motivo: d === '' ? 'sin reemplazo' : 'sin uso' }); if (!usado) sinUso.push(n); else revisar.push({ nombre: n, ...cuenta(uso), antes: tipoAntes(n), motivo: 'sin reemplazo' }); return; }
    revisar.push({ nombre: n, ...cuenta(uso), antes: tipoAntes(n), motivo: 'no está en la tabla aprobada' });   // en uso y desconocido: lo ubica Emmanuel (no se archiva solo)
  });
  // OTROS INSUMOS: por proveedor (su ficha y sus documentos), con una sugerencia según el detalle de las facturas
  const porProv = {}, kOtros = norm(OTROS_INSUMOS), docPor = Object.fromEntries((docs || []).map(d => [d.id, d]));
  lineas.filter(l => norm(l.itemOriginal || l.itemGasto) === kOtros).forEach(l => { const d = docPor[l.docId]; const k = d ? claveGrupo(d, provs) : 'doc_' + l.docId;
    const g = porProv[k] || (porProv[k] = { clave: k, razon: s(l.razonSocial) || (d && d.razon) || '', monto: 0, docs: {}, ficha: !!(provs || {})[k] });
    g.monto += entero(l.montoNeto); const x = g.docs[l.docId] || (g.docs[l.docId] = { id: l.docId, folio: d ? s(d.folio) : '', fecha: d ? s(d.fecha) : '', tipo: d ? s(d.tipoTexto) : '', monto: 0, detalle: d ? (d.detalle || []).map(z => s(z.descripcion)).filter(Boolean).slice(0, 12) : [] }); x.monto += entero(l.montoNeto); });
  Object.entries(provs || {}).forEach(([k, p]) => { if (!p) return; const tiene = norm(p.item) === kOtros || Object.values(p.productos || {}).some(x => x && norm(x.item) === kOtros);
    if (tiene && !porProv[k]) porProv[k] = { clave: k, razon: s(p.razon) || k, monto: 0, docs: {}, ficha: true }; });
  // Documentos con OTROS INSUMOS guardado que no tienen línea desde el inicio (por ejemplo, una deuda anterior repartida en varios meses)
  (docs || []).forEach(d => { if (!d || d.estado === 'no_va' || !d.clasif || !(d.clasif.partes || []).some(p => norm(p.item) === kOtros)) return; const k = claveGrupo(d, provs);
    if (!porProv[k]) porProv[k] = { clave: k, razon: s(d.razon) || k, monto: 0, docs: {}, ficha: !!(provs || {})[k] }; });
  const grupos = Object.values(porProv).map(g => ({ ...g, docs: Object.values(g.docs).sort((a, b) => b.fecha.localeCompare(a.fecha)), sugerido: sugerirOtros(Object.values(g.docs).flatMap(x => x.detalle).concat([g.razon])) }))
    .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto) || a.razon.localeCompare(b.razon, 'es'));
  const total = lineas.reduce((a, l) => a + entero(l.montoNeto), 0);
  return { crear, archivar, pasan: pasan.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)), otros: { grupos, monto: grupos.reduce((a, g) => a + g.monto, 0), antes: tipoAntes(OTROS_INSUMOS) }, revisar, sinUso: sinUso.sort(), total };
}
// La ficha que manda en un documento (la del servicio o la del proveedor): así su ficha y sus documentos se deciden juntos
export const claveGrupo = (d, provs) => ((provs || {})[GB.claveProveedor(d)] ? GB.claveProveedor(d) : (provs || {})[GB.claveBase(d)] ? GB.claveBase(d) : GB.claveProveedor(d));
const cuenta = u => ({ docs: u.docs, fichas: u.fichas, comps: u.comps, monto: u.monto });
// Una sugerencia para OTROS INSUMOS, solo si el detalle es claro (si no, la elige Emmanuel)
const RE_PACK = /\b(BOLSAS?|CAJAS?|ENVASES?|ETIQUETAS?|POTES?|VASOS?|TAPAS?|BANDEJAS?|PAPEL KRAFT|SERVILLETAS?|BOMBILLAS?|CUCHARAS?|CUCHARITAS?|PALITOS?|FILM|SELLOS?)\b/;
const RE_ASEO = /\b(PAPEL HIGIENICO|TOALLAS?|JABON|DETERGENTE|CLORO|LAVALOZAS|ESPONJAS?|GUANTES?|DESINFECTANTE|ALCOHOL|ESCOBA|TRAPEROS?|PANOS?|LIMPIA\w*|BOLSAS DE BASURA|BASURA)\b/;
export function sugerirOtros(textos) {
  let p = 0, a = 0; (textos || []).forEach(t => { const n = norm(t); if (RE_ASEO.test(n)) a++; else if (RE_PACK.test(n)) p++; });
  return p && !a ? 'PACKAGING' : a && !p ? 'INSUMOS DE ASEO Y OPERACIÓN' : '';
}
// El nombre que queda para un nombre en uso, con las decisiones: { otros: { claveProv: nombre }, revisar: { NORM: nombre } }
export function nombreFinal(nombre, dec = {}, claveProv = '') {
  const k = norm(nombre);
  if (k === norm(OTROS_INSUMOS)) return s(((dec.otros || {})[claveProv])) || '';
  const d = destinoInicial(nombre); if (d) return d;
  return s((dec.revisar || {})[k]) || '';
}
// Cambiar los ítems de una ficha (ítem general y productos) o de un compromiso: lo que cambia → { cambios, texto } o null
export function cambiosFicha(p, dec, clave) {
  if (!p) return null;
  const cambia = n => { const f = nombreFinal(n, dec, clave); return f && norm(f) !== norm(n) ? f : ''; }, txt = [];
  const out = {};
  if (s(p.item)) { const f = cambia(p.item); if (f) { out.item = f; txt.push(`${p.item} → ${f}`); } }
  const prods = p.productos || {}; let cp = false; const np = {};
  Object.entries(prods).forEach(([k, v]) => { const f = v && s(v.item) ? cambia(v.item) : ''; np[k] = f ? { ...v, item: f } : v; if (f) { cp = true; txt.push(`${k}: ${v.item} → ${f}`); } });
  if (cp) out.productos = np;
  return Object.keys(out).length ? { cambios: out, texto: [...new Set(txt)].slice(0, 6).join(' · ') } : null;
}
// La clasificación guardada en un documento con OTROS INSUMOS (lo único sin reemplazo único: se decide por proveedor). Los demás nombres
// antiguos no se reescriben: su ítem archivado apunta al nuevo. → la clasificación nueva, o null si no cambia
export function cambiosDoc(d, dec, clave) {
  const c = d && d.clasif; if (!c) return null;
  const f = n => (s(n) && norm(n) === norm(OTROS_INSUMOS) ? nombreFinal(n, dec, clave) : '');
  let hay = false; const m = n => { const x = f(n); if (x) { hay = true; return x; } return n; };
  const nueva = { ...c, item: m(c.item), partes: (c.partes || []).map(p => ({ ...p, item: m(p.item) })), lineas: (c.lineas || []).map(l => ({ ...l, item: m(l.item) })) };
  return hay ? nueva : null;
}
