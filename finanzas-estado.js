// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas: el estado de resultados por cuentas, en cuatro niveles  v0.111.0 · reglas puras, sin red
//  Hoja de ruta v11, sección 1.1 (aprobado por Emmanuel el 26 oct; claude/revision-estados-por-segmento.md).
//  Las filas son las de la estructura clásica (nivel 1) y cada una se forma con cuentas del plan:
//    nivel 1 fila · nivel 2 grupo (cuenta de 2 cifras) · nivel 3 cuenta · nivel 4 ítem (y sus documentos).
//  No calcula nada nuevo: toma el cálculo de siempre (finanzas-eerr.armarEERR: sus filas y su detalle) y lo ordena por cuenta.
//  Cada peso del detalle es un "movimiento" { k (fila de antes), col (área), canal, cuenta, item, neto, ref }. Lo que el
//  redondeo por celda deja de diferencia se suma al movimiento más grande de esa celda, así todo cuadra al peso con lo de antes.
//  Dimensiones guardadas para los estados por área y por canal (v0.112.0): col (PAN, BOL, PAS, CAF, REVENTA, comun) y canal
//  (barros, ainavillo, b2b, comun).
// ═══════════════════════════════════════════════
import * as PC from './plan-cuentas.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';

const s = v => (v === null || v === undefined ? '' : String(v));
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const r0 = v => Math.round(num(v));

export const FORMA = 3;   // forma de la foto del cierre que guarda el estado por cuentas (v0.111.0)
export const PRODUCCION = AR.PRODUCCION;
export const CANALES = ['b2b', 'barros', 'ainavillo'];
export const AREAS_EST = AR.MARGEN;   // v0.112.0: las columnas del estado por área (las 4 que producen y Reventa)
export const NOMBRE_CANAL = { b2b: 'B2B', barros: 'Barros Arana', ainavillo: 'Ainavillo', comun: 'Común' };

// ── Nivel 1: las filas. signo: '' suma, '−' resta, '±' con su signo; res: resultado (en negrita, con %) ──
export const FILAS = [
  { k: 'ventas', t: 'Ventas netas', signo: '' },
  { k: 'costoDirecto', t: 'Costo directo de lo vendido', signo: '−' },
  { k: 'mb', t: 'Margen bruto (food cost)', res: true },
  { k: 'variables', t: 'Costos variables de vender', signo: '−' },
  { k: 'mc', t: 'Margen de contribución', res: true },
  { k: 'moProd', t: 'Mano de obra de producción', signo: '−' },
  { k: 'mp', t: 'Margen de producción', res: true },
  { k: 'remVA', t: 'Remuneraciones de venta y administración', signo: '−' },
  { k: 'operacion', t: 'Gastos de operación', signo: '−' },
  { k: 'venta', t: 'Gastos de venta', signo: '−' },
  { k: 'ebitda', t: 'EBITDA', res: true },
  { k: 'dep', t: 'Depreciación', signo: '−' },
  { k: 'resOp', t: 'Resultado operacional', res: true },
  { k: 'financieros', t: 'Financieros (intereses, multas y banco)', signo: '−' },
  { k: 'otros', t: 'Otros ingresos y gastos (no del giro)', signo: '±' },
  { k: 'rai', t: 'Resultado antes de impuesto', res: true },
  { k: 'impuesto', t: 'Impuesto a la renta estimado', signo: '−' },
  { k: 'utilidad', t: 'Utilidad neta', res: true }
];
export const FILA = Object.fromEntries(FILAS.map(f => [f.k, f]));
export const BASES = FILAS.filter(f => !f.res).map(f => f.k);
export const AYUDA = {
  ventas: 'Lo vendido en el mes, sin IVA: las cajas (Barros Arana y Ainavillo), B2B y el despacho cobrado a los clientes B2B.',
  costoDirecto: 'Receta × unidades vendidas, al costo de la materia prima del mes (con su flete). En reventa, su costo de compra.',
  mb: 'Ventas − costo directo. Debajo, los dos %: el margen bruto y el food cost (costo directo ÷ ventas), que suman 100 %.',
  variables: 'Lo que sube con cada venta: merma, comisiones de tarjeta (y el arriendo del POS), despacho, packaging y producto regalado.',
  mc: 'Lo que queda de cada venta para pagar la gente y los fijos. Sirve para el punto de equilibrio.',
  moProd: 'Sueldos, cotizaciones y la provisión de vacaciones y finiquitos de quienes producen (área Panadería, Bollería, Pastelería o Cafetería).',
  mp: 'Lo que deja producir, ya pagada la gente que produce. Debajo, el prime cost: food cost + mano de obra de producción, como % de las ventas.',
  remVA: 'Sueldos y provisión de quienes venden, atienden o administran (área de una tienda, B2B, Reventa o común).',
  operacion: 'Arriendos, servicios, mantención, aseo, contabilidad y software, seguros, transporte, capacitación y otros.',
  venta: 'Marketing y publicidad, y las facturas B2B dadas por perdidas (incobrables).',
  ebitda: 'El resultado antes de la depreciación, los financieros y el impuesto: lo que genera la operación.',
  dep: 'Los equipos e inversiones, repartidos en su vida útil.',
  resOp: 'Lo que da la panadería como negocio.',
  financieros: 'Intereses de créditos, multas e intereses (Previred, F29, mora) y comisiones del banco.',
  otros: 'Lo que entra o sale y no es del giro (anotado en Finanzas).',
  rai: 'El resultado antes del impuesto a la renta.',
  impuesto: 'Estimación mensual: la tasa de la configuración sobre la base tributaria (sección Gestión y tributario).',
  utilidad: 'Lo que ganó o perdió la empresa en el mes.'
};

// ── Nombres de cuentas que no están en plan-cuentas.js (las que no vienen de un ítem de Gastos) ──
const NOMBRES = {
  '4.1': 'Ventas Barros Arana', '4.2': 'Ventas Ainavillo', '4.3': 'Ventas B2B', '4.4': 'Despacho cobrado (B2B)',
  '5.1': 'Costo de materias primas (recetas)', '5.2': 'Costo de productos de reventa', '5.3': 'Merma valorizada',
  '5.4': 'Comisiones de tarjeta y medios de pago', '5.5': 'Despacho', '5.6': 'Diferencia de inventario', '5.8': 'Producto regalado y consumo interno',
  '6.1.9': 'Provisión de vacaciones y finiquitos', '6.8': 'Depreciación', '6.13': 'Incobrables (facturas dadas por perdidas)',
  '8.1': 'Otros ingresos', '8.2': 'Otros gastos', '9.1': 'Impuesto a la renta estimado', '?': 'Sin cuenta'
};
export const nombreCuenta = c => (c === '5.4' ? NOMBRES['5.4'] : PC.nombre(c) || NOMBRES[c] || c);
// El grupo (nivel 2): la cuenta de 2 cifras
export const grupoDe = c => (c === '?' ? '?' : s(c).split('.').slice(0, 2).join('.'));
const orden = c => s(c).split('.').map(n => n.padStart(3, '0')).join('.');
export const compararCuentas = (a, b) => orden(a).localeCompare(orden(b));

const CANAL_DE_SUC = { barros: 'barros', ainavillo: 'ainavillo', b2b: 'b2b' };
const CANAL_DE_AREA = { 'B2C-BA': 'barros', 'B2C-AI': 'ainavillo', B2B: 'b2b' };
const CUENTA_VENTA = { barros: '4.1', ainavillo: '4.2', b2b: '4.3' };
const canalDeArea = a => CANAL_DE_AREA[s(a).toUpperCase()] || 'comun';
// Remuneraciones: mano de obra de producción si la columna es un área que produce; si no, de venta y administración
const filaRem = col => (PRODUCCION.includes(col) ? 'moProd' : 'remVA');
// La fila de nivel 1 de un gasto según su cuenta (y la columna, para las remuneraciones)
export function filaDeCuenta(cuenta, col) {
  const c = s(cuenta), n = c.split('.');
  if (n[0] === '4') return 'ventas';
  if (c === '5.1' || c === '5.2' || c === '5.6') return 'costoDirecto';
  if (n[0] === '5') return 'variables';
  if (n[0] === '6' && n[1] === '1') return filaRem(col);
  if (c === '6.8') return 'dep';
  if (c === '6.9' || c === '6.13') return 'venta';
  if (n[0] === '6') return 'operacion';
  if (n[0] === '7') return 'financieros';
  if (n[0] === '8') return 'otros';
  if (n[0] === '9') return 'impuesto';
  return 'operacion';
}
// Cuenta de un gasto sin cuenta (antes del catálogo de ítems): por su tipo
const cuentaPorTipo = (tipo, k) => (tipo === 'remuneraciones' ? '6.1' : tipo === 'financiero' ? '7.3' : tipo === 'costo_venta' ? (k === 'packaging' ? '5.7' : '5.4.2') : tipo === 'fijo' ? '6.7' : '?');

// ── Movimientos: cada peso del detalle, con su cuenta ──
// Las filas de antes (finanzas-eerr) que no son resultado ni información
const K_RES = new Set(['ventas', 'cargos', 'costoDirecto', 'costosVenta', 'packaging', 'merma', 'regalado', 'rem', 'provision', 'fijos', 'dep', 'canalB2B', 'incobrables',
  'tiendaBA', 'tiendaAI', 'remComun', 'fijosComun', 'marketing', 'seguros', 'transporte', 'capacitacion', 'depComun', 'financieros', 'otrosIngresos', 'otrosGastos', 'impuesto']);
function movsDeRef(k, col, r) {
  const base = { k, col, ref: r };
  const t = s(r.tipo);
  if (k === 'ventas') return [{ ...base, fila: 'ventas', cuenta: CUENTA_VENTA[r.suc] || '4.1', canal: CANAL_DE_SUC[r.suc] || 'comun', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'cargos') return [{ ...base, fila: 'ventas', cuenta: '4.4', canal: 'b2b', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'costoDirecto') return [{ ...base, fila: 'costoDirecto', cuenta: col === AR.REVENTA ? '5.2' : '5.1', canal: CANAL_DE_SUC[r.suc] || 'comun', item: s(r.nombre), neto: num(r.costo) }];
  if (k === 'costosVenta' && t === 'venta') {
    const cn = CANAL_DE_SUC[r.suc] || 'comun', out = [], com = 'comision' in r ? num(r.comision) : num(r.costoVenta), des = 'despacho' in r ? num(r.despacho) : 0;
    if (com) out.push({ ...base, fila: 'variables', cuenta: '5.4', canal: cn, item: 'Comisión de tarjeta · ' + (NOMBRE_CANAL[cn] || cn), neto: com });
    if (des) out.push({ ...base, fila: 'variables', cuenta: '5.5', canal: cn, item: 'Despacho · ' + (NOMBRE_CANAL[cn] || cn), neto: des });
    return out;
  }
  // v0.123.0: la merma de la tienda va en el canal de su tienda (la de Producción, en Común)
  if (k === 'merma') return [{ ...base, fila: 'variables', cuenta: '5.3', canal: CANAL_DE_SUC[r.suc] || 'comun', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'regalado') return [{ ...base, fila: 'variables', cuenta: '5.8', canal: 'comun', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'provision') { const c2 = colArea(r.area, col); return [{ ...base, col: c2, fila: filaRem(c2), cuenta: '6.1.9', canal: canalDeArea(r.area), item: s(r.nombre), neto: num(r.neto) }]; }
  if (k === 'dep' || k === 'depComun') return [{ ...base, fila: 'dep', cuenta: '6.8', canal: canalDeArea(r.area), item: s(r.item), neto: num(r.neto) }];
  if (k === 'incobrables') return [{ ...base, fila: 'venta', cuenta: '6.13', canal: 'b2b', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'otrosIngresos') return [{ ...base, fila: 'otros', cuenta: '8.1', canal: 'comun', item: s(r.nombre), neto: num(r.neto) }];
  if (k === 'otrosGastos') return [{ ...base, fila: 'otros', cuenta: '8.2', canal: 'comun', item: s(r.nombre), neto: -num(r.neto) }];
  if (k === 'impuesto') return [{ ...base, col: 'comun', fila: 'impuesto', cuenta: '9.1', canal: 'comun', item: 'Impuesto a la renta estimado', neto: num(r.neto) }];
  if (k === 'financieros' && t === 'credito') return [{ ...base, fila: 'financieros', cuenta: '7.1', canal: 'comun', item: s(r.nombre), neto: num(r.neto) }];
  // Un gasto: su cuenta (o la de su tipo) dice la fila
  const c0 = s(r.cuenta) || cuentaPorTipo(r.tipoRes, k), cuenta = c0 === '?' ? (CUENTA_DE_K[k] || '?') : c0;
  return [{ ...base, fila: filaDeCuenta(cuenta, col), cuenta, canal: canalDeArea(r.area), item: s(r.item) || '(sin ítem)', neto: num(r.neto) }];
}
// La provisión viene por área (código): su columna de área
const colArea = (a, col) => { const u = s(a).toUpperCase(); return AR.MARGEN.includes(u) ? u : (col && col !== 'total' ? col : 'comun'); };
// La fila y la cuenta de una celda de antes sin detalle
const FILA_K = { ventas: 'ventas', cargos: 'ventas', costoDirecto: 'costoDirecto', costosVenta: 'variables', packaging: 'variables', merma: 'variables', regalado: 'variables',
  remComun: 'remVA', fijos: 'operacion', fijosComun: 'operacion', canalB2B: 'operacion', tiendaBA: 'operacion', tiendaAI: 'operacion', seguros: 'operacion', transporte: 'operacion', capacitacion: 'operacion',
  marketing: 'venta', incobrables: 'venta', dep: 'dep', depComun: 'dep', financieros: 'financieros', otrosIngresos: 'otros', otrosGastos: 'otros', impuesto: 'impuesto' };
const FILA_DE_K = (k, col) => (k === 'rem' || k === 'provision' ? filaRem(col) : FILA_K[k] || 'operacion');
const CUENTA_DE_K = { ventas: '4.1', cargos: '4.4', costoDirecto: '5.1', costosVenta: '5.4', packaging: '5.7', merma: '5.3', regalado: '5.8', rem: '6.1', remComun: '6.1', provision: '6.1.9',
  fijos: '6.7', fijosComun: '6.7', marketing: '6.9', seguros: '6.10', transporte: '6.11', capacitacion: '6.12', dep: '6.8', depComun: '6.8', incobrables: '6.13', financieros: '7.3', otrosIngresos: '8.1', otrosGastos: '8.2', impuesto: '9.1' };
// Movimientos de un estado de resultados (el cálculo de hoy o la foto de un cierre: los dos traen filas y detalle)
export function movimientos(e) {
  const D = (e && e.detalle) || {}, F = (e && e.filas) || {}, out = [];
  const celdas = {};
  Object.entries(D).forEach(([kk, refs]) => {
    const i = kk.lastIndexOf('.'), k = kk.slice(0, i), col = kk.slice(i + 1);
    if (!K_RES.has(k)) return;
    const l = []; (refs || []).forEach(r => movsDeRef(k, col, r || {}).forEach(m => l.push(m)));
    celdas[k + '.' + col] = l; l.forEach(m => out.push(m));
  });
  // Redondeo: la celda de antes manda (cada celda se redondea al peso); la diferencia va al movimiento más grande de la celda
  K_RES.forEach(k => {
    const fila = F[k]; if (!fila) return;
    // El impuesto vive solo en Total (no tiene área): se compara su total
    const celdasK = k === 'impuesto' ? { total: num(fila.total) } : fila;
    Object.entries(celdasK).forEach(([col, v]) => {
      if (col === 'total' && k !== 'impuesto') return;
      const l = celdas[k + '.' + col] || [], suma = l.reduce((a, m) => a + (k === 'otrosGastos' ? -m.neto : m.neto), 0), d = num(v) - suma;
      if (Math.abs(d) < 0.5) return;
      if (l.length) { const g = l.reduce((a, m) => (Math.abs(m.neto) > Math.abs(a.neto) ? m : a), l[0]); g.neto += k === 'otrosGastos' ? -d : d; return; }
      // Una celda sin detalle (centavos que suman un peso, o una foto sin detalle): queda en la fila que le corresponde, "sin detalle"
      out.push({ k, col: col === 'total' ? 'comun' : col, fila: FILA_DE_K(k, col), cuenta: CUENTA_DE_K[k] || '?', canal: k === 'cargos' || k === 'canalB2B' || k === 'incobrables' ? 'b2b' : 'comun', item: 'Sin detalle', neto: k === 'otrosGastos' ? -d : d, ref: null });
    });
  });
  return out;
}

// ── El estado: totales por fila, grupo, cuenta e ítem; en total, por área (col) y por canal ──
const sumar = (o, key, v) => { o[key] = (o[key] || 0) + v; };
const vacioDim = () => ({ t: 0, a: {}, c: {} });
const agregar = (x, m) => { x.t += m.neto; sumar(x.a, m.col, m.neto); sumar(x.c, m.canal, m.neto); };
const redondear = x => { x.t = r0(x.t); Object.keys(x.a).forEach(k => { x.a[k] = r0(x.a[k]); if (!x.a[k]) delete x.a[k]; }); Object.keys(x.c).forEach(k => { x.c[k] = r0(x.c[k]); if (!x.c[k]) delete x.c[k]; }); return x; };
// → { forma, filas: { k: {t,a,c} } (las bases y los resultados), cuentas: { "fila|cuenta": {t,a,c} }, items: { "fila|cuenta|item": {t,a,c} } }
export function armarEstado(e) {
  const filas = {}, cuentas = {}, items = {};
  BASES.forEach(k => { filas[k] = vacioDim(); });
  movimientos(e).forEach(m => {
    if (!m.neto) return;
    agregar(filas[m.fila] || (filas[m.fila] = vacioDim()), m);
    agregar(cuentas[m.fila + '|' + m.cuenta] || (cuentas[m.fila + '|' + m.cuenta] = vacioDim()), m);
    agregar(items[m.fila + '|' + m.cuenta + '|' + m.item] || (items[m.fila + '|' + m.cuenta + '|' + m.item] = vacioDim()), m);
  });
  [filas, cuentas, items].forEach(o => Object.values(o).forEach(redondear));
  resultados(filas);
  return { forma: FORMA, filas, cuentas, items };
}
// Los resultados (por dimensión): cada uno es la resta de los de arriba
function resultados(F) {
  const dims = x => [['t', null], ...Object.keys(x.a).map(k => ['a', k]), ...Object.keys(x.c).map(k => ['c', k])];
  const v = (k, d, key) => { const x = F[k]; if (!x) return 0; return d === 't' ? x.t : num(x[d][key]); };
  const claves = { a: new Set(), c: new Set() };
  BASES.forEach(k => { Object.keys(F[k].a).forEach(x => claves.a.add(x)); Object.keys(F[k].c).forEach(x => claves.c.add(x)); });
  const def = [['mb', (d, k) => v('ventas', d, k) - v('costoDirecto', d, k)], ['mc', (d, k) => v('mb', d, k) - v('variables', d, k)], ['mp', (d, k) => v('mc', d, k) - v('moProd', d, k)],
    ['ebitda', (d, k) => v('mp', d, k) - v('remVA', d, k) - v('operacion', d, k) - v('venta', d, k)], ['resOp', (d, k) => v('ebitda', d, k) - v('dep', d, k)],
    ['rai', (d, k) => v('resOp', d, k) - v('financieros', d, k) + v('otros', d, k)], ['utilidad', (d, k) => v('rai', d, k) - v('impuesto', d, k)]];
  def.forEach(([k, fn]) => { const x = { t: fn('t'), a: {}, c: {} }; claves.a.forEach(a => { x.a[a] = fn('a', a); }); claves.c.forEach(c => { x.c[c] = fn('c', c); }); F[k] = x; });
  return F;
}
// El valor de una fila (o cuenta, o ítem) en una columna: 't', un área ('a:PAN') o un canal ('c:b2b')
export function valor(x, colKey = 't') {
  if (!x) return 0;
  if (colKey === 't') return num(x.t);
  const [d, k] = colKey.split(':'); return num((x[d] || {})[k]);
}
// Indicadores bajo los resultados
export function indicadores(est, colKey = 't') {
  const F = est.filas, ven = valor(F.ventas, colKey), cd = valor(F.costoDirecto, colKey), mo = valor(F.moProd, colKey);
  const p = v => (ven ? v / ven * 100 : null);
  return { foodCost: p(cd), margenBruto: p(valor(F.mb, colKey)), primeCost: p(cd + mo) };
}

// ── El árbol para la pantalla: fila → grupos → cuentas → ítems, ordenado ──
// est: un estado (armarEstado o la foto del cierre). → { fila: [ { grupo, nombre, cuentas: [ { cuenta, nombre, items: [ { item } ] } ] } ] }
export function arbol(ests) {
  const lista = Array.isArray(ests) ? ests : [ests], out = {};
  const cuentasDe = {}, itemsDe = {};
  lista.forEach(est => {
    Object.keys((est && est.cuentas) || {}).forEach(key => { const [f, c] = key.split('|'); (cuentasDe[f] || (cuentasDe[f] = new Set())).add(c); });
    Object.keys((est && est.items) || {}).forEach(key => { const i1 = key.indexOf('|'), i2 = key.indexOf('|', i1 + 1), f = key.slice(0, i1), c = key.slice(i1 + 1, i2), it = key.slice(i2 + 1); (itemsDe[f + '|' + c] || (itemsDe[f + '|' + c] = new Set())).add(it); });
  });
  Object.entries(cuentasDe).forEach(([f, set]) => {
    const grupos = {};
    [...set].sort(compararCuentas).forEach(c => { const g = grupoDe(c); (grupos[g] || (grupos[g] = [])).push(c); });
    out[f] = Object.keys(grupos).sort(compararCuentas).map(g => ({ grupo: g, nombre: nombreCuenta(g), cuentas: grupos[g].map(c => ({ cuenta: c, nombre: nombreCuenta(c), items: [...(itemsDe[f + '|' + c] || [])].sort((a, b) => a.localeCompare(b, 'es')) })) }));
  });
  return out;
}
// Suma de un grupo (sus cuentas) en un estado
export function valorGrupo(est, fila, grupo, colKey = 't') {
  return Object.entries((est && est.cuentas) || {}).filter(([key]) => { const [f, c] = key.split('|'); return f === fila && grupoDe(c) === grupo; }).reduce((a, [, x]) => a + valor(x, colKey), 0);
}
export const valorCuenta = (est, fila, cuenta, colKey = 't') => valor(((est && est.cuentas) || {})[fila + '|' + cuenta], colKey);
export const valorItem = (est, fila, cuenta, item, colKey = 't') => valor(((est && est.items) || {})[fila + '|' + cuenta + '|' + item], colKey);
// Los documentos (referencias) de un ítem, desde el detalle
export const refsDe = (e, fila, cuenta, item) => movimientos(e).filter(m => m.fila === fila && m.cuenta === cuenta && m.item === item && m.ref).map(m => ({ ...m.ref, montoEnCuenta: r0(m.neto) }));

// ── Varios meses: la suma (acumulado, temporada) ──
export function sumarEstados(ests) {
  const out = { forma: FORMA, filas: {}, cuentas: {}, items: {} };
  const junta = (dest, src) => Object.entries(src || {}).forEach(([key, x]) => { const y = dest[key] || (dest[key] = vacioDim()); y.t += num(x.t); Object.entries(x.a || {}).forEach(([k, v]) => sumar(y.a, k, num(v))); Object.entries(x.c || {}).forEach(([k, v]) => sumar(y.c, k, num(v))); });
  (ests || []).filter(Boolean).forEach(est => { junta(out.filas, est.filas); junta(out.cuentas, est.cuentas); junta(out.items, est.items); });
  BASES.forEach(k => { if (!out.filas[k]) out.filas[k] = vacioDim(); });
  resultados(out.filas);
  return out;
}
// Temporadas (hoja de ruta 1.5): verano dic-feb (el diciembre cuenta para el verano del año siguiente), otoño mar-may, invierno jun-ago, primavera sep-nov
export function temporadaDe(mes) {
  const [y, m] = s(mes).split('-').map(Number);
  if (m === 12) return { k: `${y + 1}-verano`, t: `Verano ${y + 1}`, orden: `${y + 1}-0` };
  if (m <= 2) return { k: `${y}-verano`, t: `Verano ${y}`, orden: `${y}-0` };
  if (m <= 5) return { k: `${y}-otono`, t: `Otoño ${y}`, orden: `${y}-1` };
  if (m <= 8) return { k: `${y}-invierno`, t: `Invierno ${y}`, orden: `${y}-2` };
  return { k: `${y}-primavera`, t: `Primavera ${y}`, orden: `${y}-3` };
}

// ── Ajustes de meses cerrados, por cuenta: cálculo de hoy − foto − lo ya informado ──
export function ajusteCuentas(vivoEst, snapEst, informado = {}) {
  const out = {};
  const keys = new Set([...Object.keys((vivoEst && vivoEst.cuentas) || {}), ...Object.keys((snapEst && snapEst.cuentas) || {})]);
  keys.forEach(key => { const d = valor(vivoEst.cuentas[key]) - valor((snapEst.cuentas || {})[key]) - num(informado[key]); if (Math.abs(d) >= 1) out[key] = r0(d); });
  return out;
}
export function yaInformadoCuentas(cierres, mesX) {
  const out = {};
  Object.values(cierres || {}).forEach(c => { if (!c || c.estado !== 'cerrado' || !c.ajustes || !c.ajustes.porMes) return; const a = c.ajustes.porMes[mesX]; if (!a || !a.porCuenta) return; Object.entries(a.porCuenta).forEach(([k, v]) => { out[k] = (out[k] || 0) + num(v); }); });
  return out;
}
// El efecto de un ajuste por cuenta en la utilidad: los ingresos suman, los costos restan, "otros" con su signo
export const efectoEnUtilidad = (key, monto) => { const f = s(key).split('|')[0]; return f === 'ventas' || f === 'otros' ? num(monto) : -num(monto); };

// v0.112.0 · ¿Una columna (área o canal) tiene algo en el estado? (para mostrar Reventa solo si tiene)
export const conDatos = (est, colKey) => BASES.some(k => Math.abs(valor((est && est.filas || {})[k], colKey)) >= 1);
