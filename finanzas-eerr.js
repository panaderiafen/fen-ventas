// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas, F3 paso 2: estado de resultados por segmentos, cuadratura, cierre de mes y ajustes  v0.62.0
//  Reglas puras (sin red), probadas en pruebas/sistemafen/finanzas-f3b.test.js. Todo en NETO y en pesos enteros
//  (cada celda se redondea al peso y los totales son la suma de las celdas: lo que se ve siempre suma).
//
//  Columnas: Panadería, Bollería, Pastelería, Cafetería (área que produce), Común y Total.
//  Tres pisos (finanzas-plan.md, sección 1):
//   1. Ventas netas (por área productora; abre por canal) − costo directo de lo vendido (teórico: receta × unidades al
//      costo del mes; reventa a su costo de compra) − costos de venta (comisión de tarjeta, despacho) − merma valorizada
//      = MARGEN DE CONTRIBUCIÓN. Las ventas sin asociar van a Común (sin costo directo: se avisa).
//   2. − remuneraciones propias del área − otros fijos propios − depreciación del área = MARGEN DEL ÁREA.
//   3. Común: remuneraciones comunes (incluye el sueldo empresarial), fijos comunes y depreciación común, sin repartir →
//      RESULTADO OPERACIONAL (Total) = Σ margen de las áreas − comunes; − financieros (interés de las cuotas pagadas en el
//      mes según la tabla de cada crédito + gastos tipo financiero) = RESULTADO DEL MES.
//  Fuera del resultado (solo informativo): compras de MP y reventa (desviación), lo que ya está en el margen (comisión
//  Transbank), capital de créditos (cuotas − interés), impuestos (F29), inversiones (entran como depreciación), retiros,
//  otros con motivo y los pagos de tarjeta de crédito de la cartola (no son gastos: flujo de caja).
//  Cuadratura: total de gastos del mes en Gastos = en el resultado + interés dentro de las cuotas + compras + en el margen
//  + fuera + sin clasificar. Tiene que dar $0 de diferencia.
//  Cierre: snapshot (fin_cierres/{AAAA-MM}) con todo el estado de resultados, los costos usados y quién/cuándo. Un mes cerrado
//  no se toca: lo que cambie después aparece como "Ajustes de meses cerrados" en el primer mes abierto siguiente
//  (= cálculo de hoy del mes cerrado − su snapshot − lo ya informado como ajuste en otros meses cerrados).
//  v0.69.1: columna REVENTA (lo que se compra hecho y se vende tal cual): sus ventas, su costo (costo de compra × unidades),
//  su margen de contribución y sus fijos, si algún gasto tiene área REVENTA. Las compras de reventa siguen fuera del resultado
//  (info "compras_reventa"). REVENTA no recibe comunes en el reparto por causa (la vista secundaria es solo de las 4 que producen).
//  v0.75.1 (Etapa 2b, decisión del dueño): bloque "Canal B2B" entre el margen del área y los comunes: + despacho cobrado (cargo
//  del Catálogo, solo a B2B) − costos del canal B2B (remuneraciones y fijos con área B2B, que antes iban en Común) = resultado del
//  canal B2B. El despacho ya no está en Común ni en el margen de contribución. El resultado operacional y el del mes no cambian.
//  Un mes cerrado antes de la v0.75.1 se ve como quedó; sus ajustes se comparan en la forma de entonces (sin ruido por el cambio).
//  v0.102.0 (catálogo de ítems = entrada al plan de cuentas, hoja de ruta sección 1.1): cada línea del Gastos nuevo trae su CUENTA y de ahí
//  sale su lugar: packaging (5.7) en el piso 1, junto a las comisiones el arriendo del POS (5.4.2); las facturas de comisiones (5.4) ya están en el margen; el bloque de cada tienda (costos con área
//  B2C-BA o B2C-AI, como el canal B2B); y, entre los comunes, marketing (6.9), seguros (6.10), transporte (6.11) y capacitación (6.12). Las
//  líneas del catálogo usan el área tal cual (el mapa de áreas de Clasificación ya no se usa: una sola regla). La cuota de un convenio de
//  la TGR (2.9) va fuera del resultado. Un cierre anterior a la v0.102.0 se compara en su forma (las filas nuevas se suman donde estaban).
//  v0.123.0 (aprobado por Emmanuel el 1 nov): la caja entra al resultado (E.caja, de finanzas.cajaFinMes; lineasCaja aquí):
//   · 6.7.1 Diferencias de caja: el faltante (+) o sobrante (−) de efectivo de cada cierre, en el bloque de su tienda; el faltante al recibir
//     y la diferencia de un conteo de la caja de administración, en los comunes (sin el conteo inicial ni el que corrige el conteo inicial).
//   · Un cobro del Point revisado "Se cerró como descuadre": venta de esa tienda ese día (venta sin detalle, neto = monto ÷ 1,19, en Común)
//     y −monto en 6.7.1 de su cierre (deja de ser faltante).
//   · La merma de la tienda (5.3), valorizada como el costo directo (finanzas-margenes.costearMermaTienda), en el área del producto.
//   No son gastos de Gastos: la cuadratura los descuenta (info.caja). Un mes cerrado no cambia: lo nuevo entra como ajuste del mes siguiente.
// ═══════════════════════════════════════════════
import * as FR from './finanzas-resultados.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';
import * as PC from './plan-cuentas.js?v=0.138.0';
import * as GT from './tributario.js?v=0.138.0';   // v0.108.0: gestión y tributario
import * as FS from './finanzas-estado.js?v=0.138.0';   // v0.111.0: el estado por cuentas (filas clásicas en 4 niveles)

export const AREAS = AR.MARGEN;
export const REVENTA = AR.REVENTA;
export const AREAS_REPARTO = AR.PRODUCCION;   // las que reciben comunes en la vista "comunes repartidos por causa"
export const COLS = [...AREAS, 'comun'];
export const NOMBRE_COL = { PAN: 'Panadería', BOL: 'Bollería', PAS: 'Pastelería', CAF: 'Cafetería', REVENTA: 'Reventa', comun: 'Común', total: 'Total' };
export const SUCS = ['barros', 'ainavillo', 'b2b'];
export const NOMBRE_SUC = { barros: 'Caja Barros Arana', ainavillo: 'Caja Ainavillo', b2b: 'B2B' };
export const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const mesTxt = m => { const [y, n] = String(m).split('-'); return `${MESES_L[Number(n) - 1] || n} ${y}`; };

// Filas del estado de resultados: k, texto, piso, signo con que se muestra (−: se resta), qué columnas usa
// (todas | areas = solo las 4 áreas | comun = solo Común), y si es un resultado (en negrita)
export const FILAS = [
  { k: 'ventas', t: 'Ventas netas', piso: 1, signo: '', cols: 'todas', abre: true },
  { k: 'costoDirecto', t: 'Costo directo de lo vendido', piso: 1, signo: '−', cols: 'todas' },
  { k: 'costosVenta', t: 'Comisiones y despacho', piso: 1, signo: '−', cols: 'todas' },
  { k: 'packaging', t: 'Packaging', piso: 1, signo: '−', cols: 'todas' },   // v0.102.0 (cuenta 5.7)
  { k: 'merma', t: 'Merma valorizada', piso: 1, signo: '−', cols: 'todas' },
  // v0.106.0: lo regalado o consumido (colaciones con producto propio, regalos, degustaciones), anotado en Cocina con su motivo (cuenta 5.8)
  { k: 'regalado', t: 'Producto regalado y consumo interno', piso: 1, signo: '−', cols: 'todas', opcional: true },
  { k: 'mc', t: 'Margen de contribución', piso: 1, signo: '=', cols: 'todas', resultado: true, pct: true },
  { k: 'rem', t: 'Remuneraciones propias del área', piso: 2, signo: '−', cols: 'areas' },
  // v0.104.0: la provisión de vacaciones (con su reemplazo) y de la indemnización por años de servicio de los trabajadores del área
  // (los de áreas comunes, en Común)
  { k: 'provision', t: 'Provisión de vacaciones y finiquitos', piso: 2, signo: '−', cols: 'todas', opcional: true },
  { k: 'fijos', t: 'Otros fijos propios del área', piso: 2, signo: '−', cols: 'areas' },
  { k: 'dep', t: 'Depreciación del área', piso: 2, signo: '−', cols: 'areas' },
  { k: 'ma', t: 'Margen del área', piso: 2, signo: '=', cols: 'todas', resultado: true, pct: true },
  // v0.75.1: el canal B2B (cols 'total': una cifra, en Total). El despacho cobrado (cargo del Catálogo, solo a clientes B2B para
  // recuperar la bencina) va junto a los costos del canal B2B, no en Común.
  { k: 'cargos', t: 'Despacho cobrado', piso: 'b2b', signo: '+', cols: 'total' },
  { k: 'canalB2B', t: 'Costos del canal B2B (atención, órdenes y despacho)', piso: 'b2b', signo: '−', cols: 'total' },
  // v0.106.0: facturas B2B dadas por perdidas en el mes (Ventas B2B → Cobranza), por su saldo con IVA (cuenta 6.13)
  { k: 'incobrables', t: 'Incobrables (facturas dadas por perdidas)', piso: 'b2b', signo: '−', cols: 'total', opcional: true },
  { k: 'resCanalB2B', t: 'Resultado del canal B2B', piso: 'b2b', signo: '=', cols: 'total', resultado: true },
  // v0.102.0: el bloque de cada tienda (costos con área B2C-BA o B2C-AI: lo que cuesta vender ahí), igual que el canal B2B
  { k: 'tiendaBA', t: 'Tienda Barros Arana: costos propios', piso: 'tiendas', signo: '−', cols: 'total', opcional: true },
  { k: 'tiendaAI', t: 'Sala de ventas Ainavillo: costos propios', piso: 'tiendas', signo: '−', cols: 'total', opcional: true },
  { k: 'remComun', t: 'Remuneraciones comunes (incluye sueldo empresarial)', piso: 3, signo: '−', cols: 'comun' },
  { k: 'fijosComun', t: 'Fijos comunes (administración y otros)', piso: 3, signo: '−', cols: 'comun' },
  { k: 'marketing', t: 'Marketing y publicidad', piso: 3, signo: '−', cols: 'comun', opcional: true },
  { k: 'seguros', t: 'Seguros', piso: 3, signo: '−', cols: 'comun', opcional: true },
  { k: 'transporte', t: 'Transporte y movilización', piso: 3, signo: '−', cols: 'comun', opcional: true },
  { k: 'capacitacion', t: 'Capacitación, uniformes y seguridad', piso: 3, signo: '−', cols: 'comun', opcional: true },
  { k: 'depComun', t: 'Depreciación común', piso: 3, signo: '−', cols: 'comun' },
  { k: 'resOp', t: 'Resultado operacional', piso: 3, signo: '=', cols: 'total', resultado: true, pct: true },
  { k: 'financieros', t: 'Financieros (intereses, multas y banco)', piso: 3, signo: '−', cols: 'comun' },
  // v0.106.0: lo que no es del giro (cuentas 8.1 y 8.2, anotado en Finanzas) y el impuesto a la renta estimado (9.1, con la tasa de la configuración)
  { k: 'otrosIngresos', t: 'Otros ingresos (no del giro)', piso: 3, signo: '+', cols: 'total', opcional: true },
  { k: 'otrosGastos', t: 'Otros gastos (no del giro)', piso: 3, signo: '−', cols: 'total', opcional: true },
  { k: 'resAntesImp', t: 'Resultado antes de impuesto', piso: 3, signo: '=', cols: 'total', resultado: true, opcional: true },
  { k: 'impuesto', t: 'Impuesto a la renta estimado', piso: 3, signo: '−', cols: 'total', opcional: true },
  { k: 'resultado', t: 'Resultado del mes', piso: 3, signo: '=', cols: 'total', resultado: true, pct: true }
];
export const FILA = Object.fromEntries(FILAS.map(f => [f.k, f]));
export const NOMBRE_PISO = { 1: 'Piso 1 · Margen de contribución', 2: 'Piso 2 · Margen del área', b2b: 'Canal B2B · despacho y costos del canal', tiendas: 'Tiendas · costos propios de cada una', 3: 'Piso 3 · Comunes y resultado' };
export const FILAS_B2B = ['cargos', 'canalB2B', 'incobrables', 'resCanalB2B'];
// v0.102.0 · Los comunes con fila propia (por la cuenta del ítem) y las tiendas (por el área)
export const FILAS_COMUNES_FIJOS = ['fijosComun', 'marketing', 'seguros', 'transporte', 'capacitacion'];
export const FILAS_TIENDAS = ['tiendaBA', 'tiendaAI'];
export const TIENDA_DE_AREA = { 'B2C-BA': 'tiendaBA', 'B2C-AI': 'tiendaAI' };

const s = v => (v === null || v === undefined ? '' : String(v));
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const r0 = v => Math.round(num(v));
export const vacia = () => ({ ...Object.fromEntries(COLS.map(c => [c, 0])), total: 0 });
// v0.69.1 · ¿La columna tiene algo en el mes? (para mostrar REVENTA solo cuando hay datos; un cierre antiguo no la trae)
export function colConDatos(eerr, col) {
  if (!eerr) return false;
  const F = eerr.filas || {}, D = eerr.detalle || {};
  return Object.values(F).some(f => f && Math.round(num(f[col])) !== 0) || Object.keys(D).some(k => k.endsWith('.' + col) && (D[k] || []).length > 0);
}
export const colsVisibles = (eerr, extra = []) => COLS.filter(c => c !== REVENTA || colConDatos(eerr, c) || extra.some(e => colConDatos(e, c)));
const conTotal = c => { const x = { ...vacia(), ...c }; COLS.forEach(k => { x[k] = r0(x[k]); }); x.total = COLS.reduce((a, k) => a + x[k], 0); return x; };
const colDe = a => (AREAS.includes(s(a).toUpperCase()) ? s(a).toUpperCase() : 'comun');
export const mesDe = f => s(f).slice(0, 7);
export const ultimoDia = mes => { const [y, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
export const mesMas = (mes, k) => FR.sumarMeses(mes + '-01', k).slice(0, 7);
const sumarDias = (f, k) => { const d = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10) + k)); return d.toISOString().slice(0, 10); };

// ── Gastos del mes: cada línea (por área, con los prorrateos) con su tipo para resultados ──
// → [{ id, fecha, item, clave, tipo ('' = sin clasificar), grupo, area (código), col (PAN…CAF|comun), neto, proveedor, obs }]
// v0.67.1: el tipo sale de FR.tipoResultado (Clasificación manda; sin ella, subtipo FINANCIERO = financiero). items: los de Gastos
// (para su subtipo); sin la lista, el subtipo guardado en el gasto.
export function lineasGastosMes(gastos, mes, fin = {}, mapa = {}, items = null) {
  const out = [], porClave = {};
  (items || []).forEach(i => { if (i && i.item) porClave[FR.claveItem(i.item)] = i; });
  (gastos || []).filter(FR.vigente).filter(g => FR.fechaGasto(g).slice(0, 7) === mes).forEach(g => {
    // v0.102.0 · Con el catálogo de ítems, el tipo sale de la cuenta del ítem (y el área va tal cual)
    const clave = FR.claveItem(g.itemGasto), tipo = g.catalogo ? PC.tipoDeCuenta(g.cuenta) : FR.tipoResultado(g.itemGasto, fin, porClave[clave] || g, !!g.origenGN).tipo;
    FR.lineasArea(g).forEach(l => out.push({ id: s(g.id), fecha: FR.fechaGasto(g), item: s(g.itemGasto).trim() || '(sin ítem)', clave, tipo, grupo: tipo ? FR.TIPO[tipo].grupo : 'sin', area: l.area, cuenta: s(g.cuenta),
      col: FR.destinoArea(l.area, g.catalogo ? {} : mapa), neto: num(l.neto), proveedor: s(g.razonSocial), obs: s(g.observacion).slice(0, 120), ...(g.itemOriginal ? { itemOriginal: s(g.itemOriginal) } : {}), ...(g.tributario ? { tributario: s(g.tributario), grupoTrib: s(g.grupoTrib) } : {}) }));
  });
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.item.localeCompare(b.item, 'es') || a.id.localeCompare(b.id));
}

// ── Interés y capital de los créditos en el mes (cuotas pagadas en el mes, por la fecha de pago) ──
// creditos: fin_creditos; vencs y gastos de fen-gastos. → [{ credito, nombre, interes, capital, cuotas }]
export function creditosDelMes(creditos, vencs, gastos, mes) {
  return (creditos || []).map(c => {
    const m = FR.marcarPagos(c.tabla || [], FR.pagosDeObligacion(c.obligacionId, vencs, gastos));
    const x = FR.creditoPorMes(m.filas)[mes];
    return x ? { credito: s(c.id), nombre: s(c.nombre), interes: r0(x.interes), capital: r0(x.capital), cuotas: x.cuotas } : null;
  }).filter(Boolean);
}

// ── Depreciación del mes, por inversión y por columna ──
export function depreciacionDelMes(invs, mes) {
  const out = [];
  (invs || []).forEach(inv => {
    const d = FR.deprMes(inv, mes); if (!d) return;
    const tot = inv.lineas.reduce((a, l) => a + l.neto, 0) || 1;
    inv.lineas.forEach(l => out.push({ id: inv.id, item: inv.item, fecha: inv.fecha, col: AREAS.includes(l.destino) ? l.destino : 'comun', area: l.area, neto: d * l.neto / tot, meses: inv.meses, valor: inv.valor }));
  });
  return out;
}

// ═══════════════ v0.123.0 · La caja en el resultado ═══════════════
// X = { evals (evaluacion_caja), efectivo (efectivo_movimientos del mes), point (point_revisiones del mes) }
// → { dif: [{ tienda 'tiendaBA'|'tiendaAI'|'' , suc, dia, neto (+ faltante, − sobrante), nombre }], ventas: [{ suc, dia, monto, neto, nombre }] }
const SUC_FIN = { barros_arana: 'barros', ainavillo: 'ainavillo' }, TIENDA_SUC = { barros: 'tiendaBA', ainavillo: 'tiendaAI' }, AREA_SUC = { barros: 'B2C-BA', ainavillo: 'B2C-AI' };
const diaIso = f => { const t = s(f); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const msTs = t => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : (t && t.__ts) || 0));
export const MOTIVO_DESC = { vuelto: 'vuelto mal dado', retiro_sin_anotar: 'retiro sin anotar', venta_sin_registrar: 'venta sin registrar', no_se: 'no se sabe', otro: 'otro' };
export function lineasCaja(X, mes) {
  const dif = [], ventas = [], ult = {};
  (X && X.evals || []).forEach(e => { const k = e.cajaId || e.id; if (!ult[k] || msTs(e.cierre) >= msTs(ult[k].cierre)) ult[k] = e; });
  Object.values(ult).forEach(e => {
    const dia = diaIso(e.fecha), suc = SUC_FIN[e.sucursal], d = Math.round(num(e.difEfectivo));
    if (!suc || mesDe(dia) !== mes || e.sinArqueo || !d) return;
    dif.push({ tienda: TIENDA_SUC[suc], suc, dia, neto: -d, cajaId: s(e.cajaId || e.id), nombre: `${d < 0 ? 'Faltante' : 'Sobrante'} al cerrar · ${NOMBRE_SUC[suc]}${e.motivoDescuadre ? ' · ' + (MOTIVO_DESC[e.motivoDescuadre] || e.motivoDescuadre) : ''}` });
  });
  (X && X.point || []).filter(p => p && p.resolucion === 'descuadre' && mesDe(p.dia) === mes && SUC_FIN[p.sucursal]).forEach(p => {
    const suc = SUC_FIN[p.sucursal], monto = Math.round(num(p.monto));
    if (!monto) return;
    ventas.push({ suc, dia: s(p.dia), monto, neto: monto / 1.19, nombre: 'Venta sin detalle (cobro del Point que se cerró como descuadre)', referencia: s(p.referencia) });
    dif.push({ tienda: TIENDA_SUC[suc], suc, dia: s(p.dia), neto: -monto, cajaId: s(p.cajaId), nombre: `Cobro del Point de ese cierre (ya no es faltante) · ${NOMBRE_SUC[suc]}` });
  });
  (X && X.efectivo || []).filter(m => m && !m.anulado && mesDe(m.dia) === mes).forEach(m => {
    if (m.tipo === 'salida' && m.motivo === 'faltante') dif.push({ tienda: '', suc: '', dia: s(m.dia), neto: Math.round(num(m.monto)), nombre: `Faltante al recibir${m.detalle ? ' · ' + s(m.detalle) : ''}` });
    // El conteo inicial no es diferencia; el que corrige el conteo inicial tampoco (error de conteo). El que corrige otro conteo sí cuenta:
    // compensa la diferencia mal anotada de ese conteo (las dos juntas dejan la diferencia real).
    if (m.tipo === 'conteo' && !m.inicial && !(m.corrige && m.corrige.inicial) && Math.round(num(m.diferencia))) {
      const d = Math.round(num(m.diferencia));
      dif.push({ tienda: '', suc: '', dia: s(m.dia), neto: -d, nombre: m.corrige ? `Corrige el conteo del ${s(m.corrige.dia).split('-').reverse().join('-')} (error de conteo)` : `${d < 0 ? 'Faltante' : 'Sobrante'} al contar la caja de administración` });
    }
  });
  return { dif, ventas };
}

// ═══════════════ Armar el estado de resultados de un mes ═══════════════
// E = { mes,
//   margen: resultado de finanzas-margenes.calcularMargenes() para ese mes (filas con area, porSuc { neto, costo, comision, despacho }),
//   merma: { disponible, detalle: [{ area, nombre, neto }], cafe (neto del café de calibración, va a Cafetería), sinCosto (n) },
//   gastos (todos), fin (fin_items), mapa (areasGasto), creditosMes (creditosDelMes), invs (FR.inversiones), pagosTarjeta [{ fecha, monto, descripcion, id }] }
// v0.112.0 · ¿De dónde sale la comisión de tarjeta de la caja (Barros Arana)? Del reporte de Mercado Pago (la real, que cambia con la
// categoría de ventas) cuando cubre lo vendido con tarjeta en el mes según los cierres de caja (97 % a 103 %); si no, de la tasa
// configurada en Márgenes. La comisión del reporte trae su IVA (crédito fiscal): al resultado va neta.
// E.comisionMP = { mp: { dias, bruto, comision } | null, medios: { barros: { efectivo, debito, credito… } } }
export function comisionCaja(E) {
  const mp = E && E.comisionMP && E.comisionMP.mp, med = ((E && E.comisionMP && E.comisionMP.medios) || {}).barros || {};
  const tarjeta = Object.entries(med).filter(([k]) => /debit|credit|tarjeta|prepag/i.test(k)).reduce((a, [, v]) => a + num(v), 0);
  const estimada = r0(((E && E.margen && E.margen.filas) || []).reduce((a, f) => a + num(((f.porSuc || {}).barros || {}).comision), 0));
  if (!mp || !mp.dias) return { fuente: 'tasa', motivo: tarjeta > 0 ? 'sin_reporte' : 'sin_tarjeta', estimada };
  const cobertura = tarjeta > 0 ? num(mp.bruto) / tarjeta : null;
  if (cobertura === null) return { fuente: 'tasa', motivo: 'sin_medios', mpBruto: r0(mp.bruto), estimada };
  // v0.137.0 · Si el reporte no calza con la caja (trae otro punto de venta, como el Point de Ainavillo antes de registrar en la caja, o le
  // faltan días), se usa la tasa REAL del reporte (comisión ÷ venta, la misma cuenta y la misma categoría) sobre lo vendido con tarjeta en
  // Barros Arana. Antes iba con la tasa configurada.
  if (cobertura < 0.97 || cobertura > 1.03) {
    if (num(mp.bruto) > 0 && num(mp.comision) > 0) { const tasa = num(mp.comision) / num(mp.bruto);
      return { fuente: 'real', porTasa: true, tasa, real: r0(tarjeta * tasa / 1.19), conIva: r0(tarjeta * tasa), cobertura, mpBruto: r0(mp.bruto), tarjeta: r0(tarjeta), estimada }; }
    return { fuente: 'tasa', motivo: 'parcial', cobertura: cobertura || 0, mpBruto: r0(mp.bruto), tarjeta: r0(tarjeta), estimada };
  }
  return { fuente: 'real', real: r0(num(mp.comision) / 1.19), conIva: r0(mp.comision), cobertura, estimada };
}
export function armarEERR(E) {
  const mes = E.mes, F = {}, D = {}, avisos = [];
  const fila = k => F[k] || (F[k] = vacia());
  const det = (k, col, ref) => { const kk = k + '.' + col; (D[kk] || (D[kk] = [])).push(ref); };
  ['ventas', 'cargos', 'canalB2B', 'incobrables', 'costoDirecto', 'costosVenta', 'packaging', 'merma', 'regalado', 'rem', 'provision', 'fijos', 'dep', 'tiendaBA', 'tiendaAI', 'remComun', 'fijosComun', 'marketing', 'seguros', 'transporte', 'capacitacion', 'depComun', 'financieros', 'otrosIngresos', 'otrosGastos'].forEach(fila);
  const canal = Object.fromEntries(SUCS.map(x => [x, vacia()]));
  const costosUsados = {};
  let sinCostoNeto = 0, nSinCosto = 0, sinAsocNeto = 0, pendNeto = 0, nPend = 0;
  // v0.112.0 · Comisión de tarjeta de Barros Arana: la real del reporte de Mercado Pago cuando cubre el mes (se reparte según la venta)
  const CM = comisionCaja(E), netoBarros = ((E.margen && E.margen.filas) || []).reduce((a, f) => a + num(((f.porSuc || {}).barros || {}).neto), 0);
  const comisionDe = (suc, x) => (suc === 'barros' && CM.fuente === 'real' ? (netoBarros > 0 ? CM.real * num(x.neto) / netoBarros : 0) : num(x.comision));
  // Piso 1: ventas, costo directo y costos de venta, por producto y canal
  ((E.margen && E.margen.filas) || []).forEach(f => {
    const col = f.tipo === 'sin' ? 'comun' : colDe(f.area);
    Object.entries(f.porSuc || {}).forEach(([suc, x0]) => {
      const x = { ...x0, comision: comisionDe(suc, x0) };
      const cv = num(x.comision) + num(x.despacho);
      F.ventas[col] += num(x.neto); F.costoDirecto[col] += num(x.costo); F.costosVenta[col] += cv;
      if (canal[suc]) canal[suc][col] += num(x.neto);
      const ref = { tipo: 'venta', nombre: s(f.nombre), suc, neto: r0(x.neto), costo: r0(x.costo), costoVenta: r0(cv), comision: r0(x.comision), despacho: r0(x.despacho), unidades: Math.round(num(x.unidades) * 1000) / 1000, ok: !!f.ok, motivo: (f.motivos || [])[0] || '' };
      det('ventas', col, ref); det('ventasCanal_' + suc, col, ref); det('costoDirecto', col, ref); det('costosVenta', col, ref);
    });
    if (f.tipo === 'sin') sinAsocNeto += num(f.neto);
    else if (f.tipo === 'pendiente') { pendNeto += num(f.neto); nPend++; }   // v0.80.1: en su área, sin costo directo
    else if (!f.ok) { sinCostoNeto += num(f.neto); nSinCosto++; }
    if (f.tipo === 'receta' && f.receta) costosUsados[f.receta] = { nombre: s(f.nombre), costoUnit: f.costoUnit === null || f.costoUnit === undefined ? null : Math.round(num(f.costoUnit) * 100) / 100, lectura: f.lectura || 'un', fuente: (f.fuenteCosto || []).join(',') };
  });
  // v0.74.0 · Cargos (tipo 'cargo' del Catálogo: despacho): ingreso del canal B2B, no es venta de un producto.
  // v0.75.1: va en el bloque del canal B2B (se guarda en la celda comun y se muestra en Total)
  const CG = (E.margen && E.margen.cargos) || null;
  ((CG && CG.lineas) || []).forEach(x => { F.cargos.comun += num(x.neto); det('cargos', 'comun', { tipo: 'cargo', nombre: s(x.nombre), suc: x.suc, neto: r0(x.neto), unidades: Math.round(num(x.cantidad) * 1000) / 1000, catalogoId: s(x.catalogoId) }); });
  if (CM.fuente === 'tasa' && CM.motivo === 'sin_reporte') avisos.push({ k: 'comision_tasa', texto: `Sin el reporte de Mercado Pago de ${mesTxt(mes)}: la comisión de tarjeta de Barros Arana va con la tasa configurada (Finanzas → Márgenes → Ajustes). Súbalo en Gastos → Bandeja para usar la comisión real.` });
  if (CM.fuente === 'tasa' && CM.motivo === 'sin_medios') avisos.push({ k: 'comision_tasa', texto: `El reporte de Mercado Pago de ${mesTxt(mes)} está, pero las ventas en tienda de Barros Arana no tienen el detalle por medio de pago para compararlo: la comisión de tarjeta va con la tasa configurada. "Volver a leer", arriba del estado de resultados, arma ese detalle.` });
  const pctTasa = t => `${(Math.round(t * 1000) / 10).toLocaleString('es-CL')} %`;
  if (CM.porTasa && CM.cobertura > 1.03) avisos.push({ k: 'comision_tasa_real', texto: `El reporte de Mercado Pago suma ${pesosTxt(CM.mpBruto)}, más que los ${pesosTxt(CM.tarjeta)} vendidos con tarjeta en Barros Arana en ${mesTxt(mes)} (${Math.round(CM.cobertura * 100)} %): trae cobros de otro punto de venta (el Point de Ainavillo) que no pasaron por la caja. La comisión de Barros Arana va con la tasa real del reporte (${pctTasa(CM.tasa)} con IVA) sobre lo vendido con tarjeta.` });
  else if (CM.porTasa) avisos.push({ k: 'comision_tasa_real', texto: `El reporte de Mercado Pago cubre ${pesosTxt(CM.mpBruto)} de los ${pesosTxt(CM.tarjeta)} vendidos con tarjeta en ${mesTxt(mes)} (${Math.round(CM.cobertura * 100)} %): la comisión va con la tasa real del reporte (${pctTasa(CM.tasa)} con IVA) sobre lo vendido con tarjeta. Suba el reporte del mes completo para usar la comisión exacta.` });
  if (CM.fuente === 'tasa' && CM.motivo === 'parcial' && CM.cobertura > 1.03) avisos.push({ k: 'comision_tasa', texto: `El reporte de Mercado Pago suma ${pesosTxt(CM.mpBruto)}, más que los ${pesosTxt(CM.tarjeta)} vendidos con tarjeta en Barros Arana en ${mesTxt(mes)} (${Math.round(CM.cobertura * 100)} %): ¿incluye otro punto de venta o días de otro mes? Mientras tanto, la comisión de tarjeta va con la tasa configurada.` });
  else if (CM.fuente === 'tasa' && CM.motivo === 'parcial') avisos.push({ k: 'comision_tasa', texto: `El reporte de Mercado Pago cubre ${pesosTxt(CM.mpBruto)} de los ${pesosTxt(CM.tarjeta)} vendidos con tarjeta en ${mesTxt(mes)} (${Math.round(CM.cobertura * 100)} %): la comisión de tarjeta va con la tasa configurada hasta que el reporte cubra el mes.` });
  if (sinAsocNeto) avisos.push({ k: 'sin_asociar', texto: `Ventas de productos sin asociar: ${pesosTxt(sinAsocNeto)} (en Común, sin costo directo). Asócialos en Márgenes → Asociar productos.` });
  if (nPend) avisos.push({ k: 'receta_pendiente', texto: `${nPend} ${nPend === 1 ? 'producto' : 'productos'} con la receta pendiente (${pesosTxt(pendNeto)} de venta): van en su área, sin costo directo. Únelos con su receta en Catálogo → Productos → Falta receta.` });
  if (nSinCosto) avisos.push({ k: 'sin_costo', texto: `${nSinCosto} ${nSinCosto === 1 ? 'producto' : 'productos'} con costo incompleto o sin costo (${pesosTxt(sinCostoNeto)} de venta): su costo directo va con lo que sí tiene costo.` });
  // Merma valorizada (neto)
  const M = E.merma || {};
  (M.detalle || []).forEach(x => { const col = colDe(x.area), k = x.regalo ? 'regalado' : 'merma'; F[k][col] += num(x.neto); det(k, col, { tipo: k, nombre: s(x.nombre), neto: r0(x.neto), cantidad: x.cantidad, unidad: x.unidad || '' }); });
  if (num(M.cafe)) { F.merma.CAF += num(M.cafe); det('merma', 'CAF', { tipo: 'merma', nombre: 'Café de calibración, botado y pruebas', neto: r0(M.cafe) }); }
  if (M.disponible === false) avisos.push({ k: 'merma', texto: 'No se pudo leer la merma de Producción: la merma va en $0.' });
  if (num(M.sinCosto)) avisos.push({ k: 'merma_sin_costo', texto: `${M.sinCosto} ${M.sinCosto === 1 ? 'anotación' : 'anotaciones'} de merma sin costo (no suman).` });
  // v0.123.0 · La caja: merma de la tienda (5.3), ventas del Point cerradas como descuadre y diferencias de caja (6.7.1)
  const CJ = E.caja || null, infoCaja = { difTiendas: 0, difComun: 0, ventasPoint: 0, mermaTienda: 0 };
  if (CJ) {
    ((CJ.merma && CJ.merma.detalle) || []).forEach(x => { const col = colDe(x.area); F.merma[col] += num(x.neto); infoCaja.mermaTienda += num(x.neto); det('merma', col, { tipo: 'merma', origen: 'tienda', nombre: s(x.nombre), neto: r0(x.neto), cantidad: x.cantidad, unidad: 'un', suc: x.suc }); });
    if (CJ.merma && num(CJ.merma.sinCosto)) avisos.push({ k: 'merma_tienda_sin_costo', texto: `${CJ.merma.sinCosto} ${CJ.merma.sinCosto === 1 ? 'registro' : 'registros'} de merma de la tienda sin costo (${CJ.merma.unidadesSinCosto} un, no suman): asocie esos productos con su receta.` });
    const L = lineasCaja(CJ, mes);
    L.ventas.forEach(v => { F.ventas.comun += v.neto; canal[v.suc].comun += v.neto; infoCaja.ventasPoint += v.neto;
      const ref = { tipo: 'venta', nombre: v.nombre, suc: v.suc, neto: r0(v.neto), costo: 0, costoVenta: 0, comision: 0, despacho: 0, unidades: 0, ok: true, motivo: '', dia: v.dia };
      det('ventas', 'comun', ref); det('ventasCanal_' + v.suc, 'comun', ref); });
    L.dif.forEach(x => { const k = x.tienda || 'fijosComun'; F[k].comun += x.neto; infoCaja[x.tienda ? 'difTiendas' : 'difComun'] += x.neto;
      det(k, 'comun', { tipo: 'difCaja', cuenta: '6.7.1', item: x.tienda ? 'Cierres de caja' : 'Caja de administración', area: x.suc ? AREA_SUC[x.suc] : '', nombre: x.nombre, fecha: x.dia, neto: r0(x.neto) }); });
    if (CJ.disponible === false) avisos.push({ k: 'caja_fin', texto: 'No se pudieron leer los cierres de caja ni Efectivo: las diferencias de caja y la merma de la tienda van en $0.' });
  }
  // Gastos del mes
  const lineas = lineasGastosMes(E.gastos, mes, E.fin, E.mapa, E.items);
  const info = { compras: { mp: 0, reventa: 0, total: 0 }, enMargen: 0, fuera: { cuotas: 0, capital: 0, impuestos: 0, deuda: 0, provision: 0, inversion: 0, retiro: 0, otro: 0, total: 0 }, interes: 0, pagosTarjeta: { n: 0, monto: 0 }, sinClasificar: { n: 0, neto: 0 }, canalB2B: { rem: 0, fijos: 0, total: 0 },
    tiendas: { tiendaBA: { rem: 0, fijos: 0 }, tiendaAI: { rem: 0, fijos: 0 } }, costoVentaGastos: 0 };
  const refG = l => ({ tipo: 'gasto', id: l.id, fecha: l.fecha, item: l.item, clave: l.clave, tipoRes: l.tipo, area: l.area, neto: r0(l.neto), proveedor: l.proveedor, obs: l.obs, ...(l.cuenta ? { cuenta: l.cuenta } : {}), ...(l.itemOriginal ? { itemOriginal: l.itemOriginal } : {}) });
  const sinClas = {};
  lineas.forEach(l => {
    const t = l.tipo, propio = AREAS.includes(l.col), A = s(l.area).toUpperCase(), fc = PC.filaDeCuenta(l.cuenta);
    // v0.102.0 · Costos de venta desde la cuenta: packaging (5.7) en su fila; arriendo del POS (5.4.2) con las comisiones (las facturas de comisiones, 5.4, ya están en el margen: no suman)
    if (t === 'costo_venta') { const k = fc === 'packaging' ? 'packaging' : 'costosVenta'; F[k][l.col] += l.neto; if (k === 'costosVenta') info.costoVentaGastos += l.neto; det(k, l.col, refG(l)); return; }
    // v0.75.1: remuneraciones y fijos con área B2B (costo del canal B2B) que irían a Común → el bloque del canal B2B
    if ((t === 'remuneraciones' || t === 'fijo') && !propio && A === 'B2B') {
      F.canalB2B.comun += l.neto; info.canalB2B[t === 'remuneraciones' ? 'rem' : 'fijos'] += l.neto; det('canalB2B', 'comun', refG(l)); return;
    }
    // v0.102.0 · Con área de una tienda (B2C-BA, B2C-AI): el bloque de esa tienda (lo que cuesta vender ahí)
    if ((t === 'remuneraciones' || t === 'fijo') && !propio && TIENDA_DE_AREA[A]) {
      const k = TIENDA_DE_AREA[A]; F[k].comun += l.neto; info.tiendas[k][t === 'remuneraciones' ? 'rem' : 'fijos'] += l.neto; det(k, 'comun', refG(l)); return;
    }
    // v0.102.0 · Marketing, seguros, transporte y capacitación: con área de producción, los asume esa área (sus fijos, piso 2; decidido por
    // Emmanuel el 25 oct: "el ítem dice qué es; el área dice dónde"). Con área común, su propia fila entre los comunes.
    if (t === 'fijo' && fc && !propio) { F[fc].comun += l.neto; det(fc, 'comun', refG(l)); return; }
    if (t === 'remuneraciones') { if (propio) { F.rem[l.col] += l.neto; det('rem', l.col, refG(l)); } else { F.remComun.comun += l.neto; det('remComun', 'comun', refG(l)); } }
    else if (t === 'fijo') { if (propio) { F.fijos[l.col] += l.neto; det('fijos', l.col, refG(l)); } else { F.fijosComun.comun += l.neto; det('fijosComun', 'comun', refG(l)); } }
    else if (t === 'financiero') { F.financieros.comun += l.neto; det('financieros', 'comun', refG(l)); }
    else if (t === 'compras_mp') { info.compras.mp += l.neto; det('compras', 'mp', refG(l)); }
    else if (t === 'compras_reventa') { info.compras.reventa += l.neto; det('compras', 'reventa', refG(l)); }
    else if (t === 'en_margen') { info.enMargen += l.neto; det('enMargen', 'total', refG(l)); }
    else if (t === 'fuera_capital_credito') { info.fuera.cuotas += l.neto; det('fuera', 'capital', refG(l)); }
    else if (t === 'fuera_impuestos') { info.fuera.impuestos += l.neto; det('fuera', 'impuestos', refG(l)); }
    else if (t === 'fuera_deuda') { info.fuera.deuda += l.neto; det('fuera', 'deuda', refG(l)); }
    else if (t === 'fuera_provision') { info.fuera.provision += l.neto; det('fuera', 'provision', refG(l)); }
    else if (t === 'inversion') { info.fuera.inversion += l.neto; det('fuera', 'inversion', refG(l)); }
    else if (t === 'retiro') { info.fuera.retiro += l.neto; det('fuera', 'retiro', refG(l)); }
    else if (t === 'otro_fuera') { info.fuera.otro += l.neto; det('fuera', 'otro', refG(l)); }
    else { info.sinClasificar.neto += l.neto; det('sinClasificar', 'total', refG(l)); const x = sinClas[l.clave] || (sinClas[l.clave] = { clave: l.clave, item: l.item, n: 0, neto: 0 }); x.n++; x.neto += l.neto; }
  });
  info.sinClasificar.n = Object.keys(sinClas).length;
  // Interés de los créditos (de la tabla) → financieros; capital = cuotas − interés (fuera)
  (E.creditosMes || []).forEach(c => { if (!c.interes) return; F.financieros.comun += c.interes; info.interes += c.interes; det('financieros', 'comun', { tipo: 'credito', nombre: c.nombre, neto: c.interes, capital: c.capital, cuotas: c.cuotas }); });
  info.fuera.capital = info.fuera.cuotas - info.interes;
  if (info.interes > info.fuera.cuotas + 1) avisos.push({ k: 'interes', texto: `El interés de las cuotas del mes (${pesosTxt(info.interes)}) es mayor que las cuotas clasificadas como "Cuota de crédito" (${pesosTxt(info.fuera.cuotas)}): revisa que el ítem de la cuota esté clasificado así.` });
  // v0.104.0 · Provisión de los trabajadores (calculada desde sus fichas y liquidaciones: trabajadores.js), por área
  (E.provision || []).forEach(x => (x.partes || []).forEach(p => { const col = colDe(p.area); F.provision[col] += num(p.monto);
    det('provision', col, { tipo: 'provision', nombre: s(x.nombre), area: p.area, neto: r0(p.monto), vac: r0(x.vac), ias: r0(x.ias), base: r0(x.base), sinFicha: !!x.sinFicha }); }));
  // Depreciación
  depreciacionDelMes(E.invs, mes).forEach(d => {
    const k = d.col === 'comun' ? 'depComun' : 'dep';
    F[k][d.col] += d.neto; det(k, d.col, { tipo: 'depreciacion', id: d.id, item: d.item, clave: FR.claveItem(d.item), fecha: d.fecha, area: d.area, neto: Math.round(d.neto), meses: d.meses, valor: r0(d.valor) });
  });
  // Pagos de tarjeta (cartola): no son gasto; flujo de caja
  (E.pagosTarjeta || []).filter(p => mesDe(p.fecha) === mes).forEach(p => { info.pagosTarjeta.n++; info.pagosTarjeta.monto += num(p.monto); det('pagosTarjeta', 'total', { tipo: 'cartola', id: s(p.id), fecha: s(p.fecha), nombre: s(p.descripcion), neto: r0(p.monto) }); });
  // v0.108.0 · Gestión y tributario: los gastos del resultado según lo que acepta el SII (el resultado de gestión no cambia)
  const TRIB = new Set(['costo_venta', 'remuneraciones', 'fijo', 'financiero']);
  info.tributario = GT.informe(lineas.filter(l => TRIB.has(l.tipo)), E.tributario || null);
  // v0.106.0 · Incobrables (folios B2B dados por perdidos en el mes) y lo que no es del giro (anotado en Finanzas)
  (E.incobrables || []).forEach(x => { F.incobrables.comun += num(x.monto); det('incobrables', 'comun', { tipo: 'incobrable', nombre: `Folio ${s(x.folio)} · ${s(x.cliente)}`, fecha: s(x.fecha), neto: r0(x.monto), motivo: s(x.motivo) }); });
  (E.otros || []).filter(x => x.estado !== 'anulado' && s(x.mes) === mes).forEach(x => { const k = x.tipo === 'gasto' ? 'otrosGastos' : 'otrosIngresos'; F[k].comun += num(x.monto); det(k, 'comun', { tipo: 'otro', id: s(x.id), nombre: s(x.descripcion), fecha: s(x.fecha), neto: r0(x.monto) }); });
  // Redondeo por celda y filas derivadas
  Object.keys(F).forEach(k => { F[k] = conTotal(F[k]); });
  SUCS.forEach(x => { canal[x] = conTotal(canal[x]); });
  F.mc = conTotal(Object.fromEntries(COLS.map(c => [c, F.ventas[c] - F.costoDirecto[c] - F.costosVenta[c] - F.packaging[c] - F.merma[c] - F.regalado[c]])));
  F.ma = conTotal(Object.fromEntries(COLS.map(c => [c, F.mc[c] - F.rem[c] - F.provision[c] - F.fijos[c] - F.dep[c]])));
  // v0.75.1: el bloque del canal B2B: despacho cobrado − costos del canal B2B
  F.resCanalB2B = { ...vacia(), total: F.cargos.total - F.canalB2B.total - F.incobrables.total };
  const comunes = F.remComun.total + FILAS_COMUNES_FIJOS.reduce((a, k) => a + F[k].total, 0) + F.depComun.total, tiendas = F.tiendaBA.total + F.tiendaAI.total;
  F.resOp = { ...vacia(), total: F.ma.total + F.resCanalB2B.total - tiendas - comunes };
  F.resAntesImp = { ...vacia(), total: F.resOp.total - F.financieros.total + F.otrosIngresos.total - F.otrosGastos.total };
  // v0.106.0 · Impuesto a la renta estimado: la tasa de la configuración (la confirma el contador) sobre el resultado antes de impuesto,
  // solo si es positivo. Es una estimación mensual de gestión: el real sale del F22 (abril).
  const tasa = Math.min(Math.max(num(E.renta && E.renta.tasa), 0), 60);
  // v0.108.0 · Sobre la base tributaria: el resultado antes de impuesto más los gastos que el SII no acepta (sección 7)
  const baseTrib = F.resAntesImp.total + info.tributario.noAceptados; info.tributario.base = baseTrib;
  F.impuesto = { ...vacia(), total: baseTrib > 0 ? r0(baseTrib * tasa / 100) : 0 };
  if (tasa) det('impuesto', 'total', { tipo: 'impuesto', nombre: `${String(tasa).replace('.', ',')}% sobre ${pesosTxt(Math.max(0, baseTrib))}${info.tributario.noAceptados ? ` (resultado antes de impuesto ${pesosTxt(F.resAntesImp.total)} + gastos que el SII no acepta ${pesosTxt(info.tributario.noAceptados)})` : ''}`, neto: F.impuesto.total, tasa });
  F.resultado = { ...vacia(), total: F.resAntesImp.total - F.impuesto.total };
  info.renta = { tasa };
  // Info redondeada
  info.compras.mp = r0(info.compras.mp); info.compras.reventa = r0(info.compras.reventa); info.compras.total = info.compras.mp + info.compras.reventa;
  info.canalB2B = { rem: r0(info.canalB2B.rem), fijos: r0(info.canalB2B.fijos) }; info.canalB2B.total = F.canalB2B.total;
  FILAS_TIENDAS.forEach(k => { info.tiendas[k] = { rem: r0(info.tiendas[k].rem), fijos: r0(info.tiendas[k].fijos), total: F[k].total }; }); info.costoVentaGastos = r0(info.costoVentaGastos);
  info.enMargen = r0(info.enMargen); info.interes = r0(info.interes); info.sinClasificar.neto = r0(info.sinClasificar.neto); info.pagosTarjeta.monto = r0(info.pagosTarjeta.monto);
  ['cuotas', 'impuestos', 'deuda', 'provision', 'inversion', 'retiro', 'otro'].forEach(k => { info.fuera[k] = r0(info.fuera[k]); });
  info.fuera.capital = info.fuera.cuotas - info.interes;
  info.fuera.total = info.fuera.capital + info.fuera.impuestos + info.fuera.deuda + info.fuera.provision + info.fuera.inversion + info.fuera.retiro + info.fuera.otro;
  info.sinClasificarLista = Object.values(sinClas).map(x => ({ ...x, neto: r0(x.neto) })).sort((a, b) => b.neto - a.neto);
  info.ventasSinAsociar = r0(sinAsocNeto); info.ventasSinCosto = r0(sinCostoNeto);
  if (nPend) info.ventasRecetaPendiente = { neto: r0(pendNeto), n: nPend };   // v0.80.1
  info.comisionCaja = CM;   // v0.112.0
  info.caja = { difTiendas: r0(infoCaja.difTiendas), difComun: r0(infoCaja.difComun), ventasPoint: r0(infoCaja.ventasPoint), mermaTienda: r0(infoCaja.mermaTienda) };   // v0.123.0
  const out = { mes, filas: F, canal, info, detalle: D, avisos, costosUsados };
  out.cuadratura = cuadratura(out, E.gastos);
  return out;
}
const pesosTxt = v => '$' + r0(v).toLocaleString('es-CL');

// ── Cuadratura con Gastos: el total de gastos del mes (sumado directo de los gastos, sin pasar por las líneas) contra
// dónde quedó cada peso. Gastos en el resultado = remuneraciones + fijos (propios y comunes) + financieros de gastos
// (sin el interés de las cuotas, que sale de la tabla del crédito y está dentro de las cuotas).
export function cuadratura(eerr, gastos) {
  const F = eerr.filas, I = eerr.info;
  const totalGastos = r0((gastos || []).filter(FR.vigente).filter(g => FR.fechaGasto(g).slice(0, 7) === eerr.mes).reduce((a, g) => a + FR.netoGasto(g), 0));
  const T = k => num((F[k] || {}).total);   // v0.102.0: con las filas nuevas (packaging, tiendas, marketing…) y los costos de venta que vienen de Gastos
  // v0.123.0: las diferencias de caja (6.7.1) están en las tiendas y en los fijos comunes, pero no vienen de Gastos
  const difCaja = I.caja ? num(I.caja.difTiendas) + num(I.caja.difComun) : 0;
  const enResultado = T('rem') + T('fijos') + T('remComun') + FILAS_COMUNES_FIJOS.reduce((a, k) => a + T(k), 0) + T('canalB2B') + FILAS_TIENDAS.reduce((a, k) => a + T(k), 0) + T('packaging') + num(I.costoVentaGastos) + (T('financieros') - I.interes) - difCaja;
  const partes = { enResultado, interesCuotas: I.interes, compras: I.compras.total, enMargen: I.enMargen, fuera: I.fuera.total, sinClasificar: I.sinClasificar.neto };
  const suma = Object.values(partes).reduce((a, v) => a + v, 0);
  return { totalGastos, ...partes, suma, diferencia: totalGastos - suma, cuadra: Math.abs(totalGastos - suma) <= 1 && !I.sinClasificar.n };
}

// ═══════════════ Vista secundaria: comunes repartidos por causa ═══════════════
// claves (fin_config/claves): { bases: { m2: { PAN, BOL, PAS, CAF }, kwh: {…}, horas: {…} },
//   porTipo: { remuneraciones: asig, fijo: asig, depreciacion: asig }, porItem: { claveItem: asig } }
//   asig = { base: 'm2'|'kwh'|'horas' } | { base: 'manual', pct: { PAN, BOL, PAS, CAF } } (suma 100). Sin asig = sin repartir.
export const BASES = [{ k: 'm2', t: 'Metros cuadrados (m²)', u: 'm²' }, { k: 'kwh', t: 'Maquinaria (kWh)', u: 'kWh' }, { k: 'horas', t: 'Horas de trabajo', u: 'h' }, { k: 'manual', t: '% a mano', u: '%' }];
// v0.102.0: los fijos comunes incluyen marketing, seguros, transporte y capacitación (sus filas propias)
export const TIPOS_COMUNES = [{ k: 'remuneraciones', t: 'Remuneraciones comunes', fila: 'remComun' }, { k: 'fijo', t: 'Fijos comunes', fila: 'fijosComun', filas: FILAS_COMUNES_FIJOS }, { k: 'depreciacion', t: 'Depreciación común', fila: 'depComun' }];
// % por área de una asignación (suma 100) o null
export function pctDe(asig, bases = {}) {
  if (!asig || !asig.base) return null;
  const src = asig.base === 'manual' ? asig.pct : (bases || {})[asig.base];
  if (!src) return null;
  const v = AREAS_REPARTO.map(a => Math.max(0, num(src[a])));
  const t = v.reduce((a, x) => a + x, 0);
  if (!(t > 0)) return null;
  if (asig.base === 'manual' && Math.abs(t - 100) > 0.01) return null;
  return Object.fromEntries(AREAS_REPARTO.map((a, i) => [a, v[i] / t * 100]));
}
export function validarClaves(d) {
  const out = { bases: {}, porTipo: {}, porItem: {} };
  ['m2', 'kwh', 'horas'].forEach(b => {
    const x = (d.bases || {})[b] || {}, y = {};
    AREAS_REPARTO.forEach(a => { const v = s(x[a]).trim() === '' ? 0 : Number(s(x[a]).replace(',', '.')); if (!(v >= 0)) throw new Error(`${BASES.find(z => z.k === b).t}: escribe números de 0 o más.`); y[a] = v; });
    out.bases[b] = y;
  });
  const asig = (a, nom) => {
    if (!a || !a.base) return null;
    if (!BASES.some(b => b.k === a.base)) throw new Error(`${nom}: elige una clave.`);
    if (a.base === 'manual') {
      const pct = {}; AREAS_REPARTO.forEach(k => { pct[k] = Number(s((a.pct || {})[k] || 0).replace(',', '.')) || 0; });
      const t = AREAS_REPARTO.reduce((x, k) => x + pct[k], 0);
      if (Math.abs(t - 100) > 0.01) throw new Error(`${nom}: los % suman ${String(Math.round(t * 100) / 100).replace('.', ',')}, deben sumar 100.`);
      return { base: 'manual', pct };
    }
    if (!pctDe(a, out.bases)) throw new Error(`${nom}: la clave "${BASES.find(b => b.k === a.base).t}" no tiene valores por área.`);
    return { base: a.base };
  };
  TIPOS_COMUNES.forEach(t => { const x = asig((d.porTipo || {})[t.k], t.t); if (x) out.porTipo[t.k] = x; });
  Object.entries(d.porItem || {}).forEach(([k, a]) => { const x = asig(a, `Ítem ${k}`); if (x) out.porItem[k] = x; });
  return out;
}
// Reparte las líneas comunes (remuneraciones, fijos y depreciación comunes; los financieros quedan sin repartir, debajo del
// resultado operacional). Cada línea con su clave (la del ítem manda sobre la del tipo); el redondeo lo absorbe la última área.
// → { porArea { PAN: { rem, fijos, dep, total } }, sinRepartir { rem, fijos, dep, total, lineas }, resultadoArea { PAN… },
//     comunResto (margen de Común − sin repartir), total (= resultado operacional), lineas [{ item, base, neto, partes }] }
export function repartirComunes(eerr, claves = {}) {
  const porArea = Object.fromEntries(AREAS_REPARTO.map(a => [a, { rem: 0, fijos: 0, dep: 0, total: 0 }])), sin = { rem: 0, fijos: 0, dep: 0, total: 0, lineas: [] }, lineas = [];
  const key = { remuneraciones: 'rem', fijo: 'fijos', depreciacion: 'dep' };
  TIPOS_COMUNES.forEach(t => {
    const filasT = t.filas || [t.fila], refs = filasT.flatMap(f => (eerr.detalle || {})[f + '.comun'] || []);
    // Agrupadas por ítem (una clave por ítem)
    const grupos = {};
    // v0.102.0: un ítem que pasó a otro nombre en el catálogo conserva la clave propia guardada con su nombre antiguo (orig)
    refs.forEach(r => { const k = r.clave || FR.claveItem(r.item || r.nombre); const g = grupos[k] || (grupos[k] = { clave: k, item: r.item || r.nombre || k, neto: 0, orig: [] }); g.neto += num(r.neto); if (r.itemOriginal) g.orig.push(FR.claveItem(r.itemOriginal)); });
    const totFila = filasT.reduce((a, f) => a + num((eerr.filas[f] || {}).total), 0), sumaRefs = Object.values(grupos).reduce((a, g) => a + g.neto, 0);
    if (Math.abs(totFila - sumaRefs) >= 1) { const g = grupos.__ajuste || (grupos.__ajuste = { clave: '__ajuste', item: 'Redondeo', neto: 0 }); g.neto += totFila - sumaRefs; }
    Object.values(grupos).forEach(g => {
      const asig = ((claves.porItem || {})[g.clave]) || (g.orig || []).map(o => (claves.porItem || {})[o]).find(Boolean) || ((claves.porTipo || {})[t.k]) || null;
      const pct = pctDe(asig, claves.bases), neto = r0(g.neto);
      if (!pct) { sin[key[t.k]] += neto; sin.lineas.push({ tipo: t.k, item: g.item, neto }); lineas.push({ tipo: t.k, item: g.item, clave: g.clave, base: '', neto, partes: null }); return; }
      let resto = neto; const partes = {};
      const conPct = AREAS_REPARTO.filter(a => pct[a] > 0);
      conPct.forEach((a, i) => { const v = i === conPct.length - 1 ? resto : Math.round(neto * pct[a] / 100); resto -= v; partes[a] = v; porArea[a][key[t.k]] += v; });
      lineas.push({ tipo: t.k, item: g.item, clave: g.clave, base: asig.base, porItem: !!((claves.porItem || {})[g.clave]), neto, partes });
    });
  });
  AREAS_REPARTO.forEach(a => { const x = porArea[a]; x.total = x.rem + x.fijos + x.dep; });
  sin.total = sin.rem + sin.fijos + sin.dep;
  const resultadoArea = Object.fromEntries(AREAS_REPARTO.map(a => [a, eerr.filas.ma[a] - porArea[a].total]));
  // v0.69.1: REVENTA no recibe comunes ni tiene columna en esta vista: su margen del área va en Común (así el total sigue
  // siendo el resultado operacional de la vista principal)
  const reventa = num((eerr.filas.ma || {})[REVENTA]);
  // v0.75.1: el resultado del canal B2B (despacho − costos del canal) no se reparte: va en Común (así el total sigue siendo el operacional)
  const canalB2B = num((eerr.filas.resCanalB2B || {}).total);
  // v0.102.0: los costos propios de las tiendas tampoco se reparten: van en Común (restan)
  const tiendas = FILAS_TIENDAS.reduce((a, k) => a + num((eerr.filas[k] || {}).total), 0);
  const comunResto = eerr.filas.ma.comun - sin.total + reventa + canalB2B - tiendas;
  return { porArea, sinRepartir: sin, resultadoArea, comunResto, reventa, canalB2B, tiendas, total: AREAS_REPARTO.reduce((x, a) => x + resultadoArea[a], 0) + comunResto, lineas };
}

// ═══════════════ Cierre de mes: lo que se revisa antes de cerrar ═══════════════
// D = { mes, cargasSii [{ desde, hasta, quitada }], ventas { abiertas, faltan, guardado, netoAinavillo, nAinavillo, netoTotal, netoSinAsociar },
//   cargosPorRevisar [{ fecha, monto, descripcion }], conteos { bodegas [cód], nombres { cód: nombre }, porBodega { cód: [fechas] } },
//   sinClasificar { n, neto } }
// → [{ k, t, ok, nivel: 'ok'|'falla'|'aviso', detalle, ir (ruta para arreglarlo), info }]
export const VENTANA_CONTEO = 3;
export function ventanaConteo(mes) { const fin = ultimoDia(mes); return { desde: sumarDias(fin, -(VENTANA_CONTEO - 1)), hasta: sumarDias(fin, VENTANA_CONTEO) }; }
// v0.69.3 · Las revisiones que también usa Finanzas → Resumen del mes (las mismas reglas, una sola vez): el SII cargado hasta
// el fin de mes, ningún cargo del mes por revisar y ningún documento del SII del mes sin clasificar. Cada una → el ítem del cierre.
const itemCheck = (k, t, ok, detalle, ir, info, nivelFalla = 'falla') => ({ k, t, ok: !!ok, nivel: ok ? 'ok' : nivelFalla, detalle, ir, info });
// Los cargos de la cartola de un mes que siguen por revisar (un "Repetido" nunca cuenta: su estado no es POR_REVISAR)
export const cargosPorRevisarDelMes = (cargos, mes) => (cargos || []).filter(c => c && c.estado === 'POR_REVISAR' && !c.quitadoEnPlanilla && mesDe(c.fecha) === mes);
// 1. SII del mes cargado: alguna carga cubre hasta el último día del mes
export function checkSiiCargado(D) {
  const mes = D.mes, ini = mes + '-01', fin = ultimoDia(mes);
  const vivas = (D.cargasSii || []).filter(c => c && !s(c.quitada).trim()).map(c => ({ desde: s(c.desde).slice(0, 10) || s(c.hasta).slice(0, 10), hasta: s(c.hasta).slice(0, 10) || s(c.desde).slice(0, 10) })).filter(c => c.desde);
  const tocan = vivas.filter(c => c.desde <= fin && c.hasta >= ini), hasta = tocan.map(c => c.hasta).sort().pop() || '';
  return itemCheck('sii', 'SII del mes cargado', tocan.length && hasta >= fin,
    !tocan.length ? `No hay ninguna carga del SII con documentos de ${mesTxt(mes)}.` : hasta >= fin ? `Cargado hasta el ${fechaCorta(hasta > fin ? fin : hasta)}.` : `Las cargas llegan solo hasta el ${fechaCorta(hasta)}: falta el resto del mes.`,
    '#gastos/sii', 'Que las compras del SII de todo el mes estén cargadas en Gastos → Bandeja → Cargas del SII (alguna carga cubre hasta el último día del mes). Sin eso faltan facturas en Gastos y el costo de las materias primas no está al día.');
}
// 3. Cartola conciliada: ningún cargo del mes por revisar
export function checkCartolaConciliada(D) {
  const cr = D.cargosPorRevisar || [];
  return itemCheck('cartola', 'Cartola conciliada', !cr.length, cr.length ? `${cr.length} ${cr.length === 1 ? 'cargo' : 'cargos'} del mes por revisar (${pesosTxt(cr.reduce((a, c) => a + num(c.monto), 0))}).` : 'Sin cargos por revisar en el mes.',
    '#gastos', 'Que todos los cargos de la cartola del mes estén revisados en Gastos → Bandeja → Cargos de la cartola (pagan un vencimiento, ya están en Gastos, son gasto nuevo, pago de tarjeta o no son gasto).');
}
// v0.66.0 · Documentos del SII de ese mes sin clasificar = 0 (su gasto todavía no existe). D.siiPendientes = { n, monto }
export function checkSiiClasificados(D) {
  const mes = D.mes, sp = D.siiPendientes || {};
  return itemCheck('sii_clasif', `Documentos del SII de ${mesTxt(mes)} sin clasificar: ${num(sp.n)}`, !num(sp.n), num(sp.n) ? `${sp.n} ${sp.n === 1 ? 'documento del SII' : 'documentos del SII'} de ${mesTxt(mes)} sin clasificar (${pesosTxt(sp.monto)}): su gasto todavía no existe.` : `Todos los documentos del SII de ${mesTxt(mes)} están clasificados.`,
    `#gastos/sii/porclasificar/${mes}`, 'Los documentos del SII que subiste y no se clasificaron solos (proveedor nuevo o con dudas) no tienen gasto todavía: no están en el estado de resultados. Clasifícalos al conciliar la cartola (el cargo del mismo monto), en Gastos → Bandeja → Pagos sin banco o en Cargas del SII. Para cerrar igual, escribe el motivo.');
}
// v0.69.5 · Previred DEL MES cargado (acordado con Emmanuel): las cotizaciones del mes M son costo de M (su gasto queda con
// fecha del último día de M) y se pagan hasta el día 13 de M+1. Cerrar M sin ellas deja M con menos costo y la diferencia entra a
// M+1 como "Ajustes de meses cerrados". Cargado = hay cotizaciones de ese período (por certificado, comprobante o CSV).
// Cargado pero sin unir a sus cargos del banco es un aviso (no impide cerrar); sin cargar, falta (para cerrar igual, el motivo).
// D.planillas = las planillas de Previred (gastos-cartola.planillasPrevired: { periodo, total, conciliada, unido, falta,
// vencimientoId, vencAbierto }); null = no se pudieron leer.
export const TXT_PREVIRED_MES = 'Las cotizaciones de Previred de un mes son un costo de ese mes (su gasto queda con fecha del último día del mes) y se pagan hasta el día 13 del mes siguiente. Si cierras el mes sin ellas, ese mes queda con menos costo y la diferencia entra al mes siguiente como "Ajustes de meses cerrados".\nCuenta como cargado si sus cotizaciones están en Gastos → Previred (por el certificado, el comprobante de pago o el CSV). Si todavía no están unidas a sus cargos del banco, es un aviso: no impide cerrar.\nOrden recomendado: (1) pagar Previred, ojalá antes del día 10; (2) subir el comprobante o el CSV en Gastos → Previred; (3) cerrar el mes, a más tardar el día 13.';
export const tituloPrevired = mes => `Previred de ${MESES_L[Number(String(mes).slice(5, 7)) - 1] || mes} cargado`;
export function checkPrevired(D) {
  const mes = D.mes, t = tituloPrevired(mes), ir = '#gastos/previred', nombre = MESES_L[Number(mes.slice(5, 7)) - 1] || mes, sig = MESES_L[Number(mesMas(mes, 1).slice(5, 7)) - 1];
  if (!Array.isArray(D.planillas)) return itemCheck('previred', t, false, 'No se pudo revisar Previred. Abre Gastos → Previred y vuelve aquí.', ir, TXT_PREVIRED_MES);
  const p = D.planillas.find(x => x && s(x.periodo).slice(0, 7) === mes);
  if (!p) return itemCheck('previred', t, false, `Las cotizaciones de ${nombre} no están cargadas (se pagan hasta el 13 de ${sig}).`, ir, TXT_PREVIRED_MES);
  if (p.conciliada) return itemCheck('previred', t, true, `Cargado (${pesosTxt(p.total)}), pagado y conciliado con la cartola.`, ir, TXT_PREVIRED_MES);
  const unido = num(p.unido), vencPagado = !!(p.vencimientoId && !p.vencAbierto);
  const detalle = unido > 0 ? `Cargado (${pesosTxt(p.total)}), unido solo en parte a sus cargos del banco: unidos ${pesosTxt(unido)}, faltan ${pesosTxt(num(p.falta))}.`
    : vencPagado ? `Cargado (${pesosTxt(p.total)}) y su vencimiento pagado, pero sin unir a un cargo del banco.` : `Cargado (${pesosTxt(p.total)}), todavía sin unir a sus cargos del banco.`;
  return itemCheck('previred', t, false, detalle, ir, TXT_PREVIRED_MES, 'aviso');
}
// Las juntas (Finanzas → Resumen del mes las muestra con el mismo texto que el cierre)
export const CHECKS_CONCILIACION = ['sii', 'cartola', 'sii_clasif', 'previred'];
export function checksConciliacion(D) {
  return [checkSiiCargado(D), checkCartolaConciliada(D)].concat(D.siiPendientes ? [checkSiiClasificados(D)] : [], 'planillas' in D ? [checkPrevired(D)] : []);
}
// ── v0.101.0 · Las revisiones de Gastos desde el inicio (octubre): del Gastos nuevo. D.gn = { sii (gn-finanzas.siiDelMes), movs { n, monto },
// sinClas { n, monto }, previred { total, pagado, completo } | null }
export const TXT_SII_GN = 'Que las compras del SII de todo el mes estén en Gastos. Su método: al bajar el XML incluya siempre el último día de la descarga anterior y, terminado el mes, suba el RCV (Registro de Compras) del mes completo: así entra lo que llegó atrasado.\nCuenta como listo si alguna carga del SII se subió después del último día del mes y trae documentos de ese mes.';
export const TXT_PREVIRED_GN = 'Las cotizaciones de Previred de un mes son un costo de ese mes y se pagan hasta el día 13 del mes siguiente. Si cierra el mes sin ellas, ese mes queda con menos costo y la diferencia entra al mes siguiente como "Ajustes de meses cerrados".\nCuenta como cargado si el CSV de la nómina, el comprobante o el certificado está subido en Gastos (zona de arrastre). Si todavía no está unido a su pago, es un aviso: no impide cerrar.\nOrden recomendado: (1) pagar Previred, ojalá antes del día 10; (2) subir el comprobante o el CSV en Gastos; (3) cerrar el mes, a más tardar el día 13.';
export function checksGastosNuevo(D) {
  const mes = D.mes, G = D.gn || {}, out = [], nm = mesTxt(mes), fin = ultimoDia(mes);
  const S = G.sii || {};
  out.push(itemCheck('sii', 'SII del mes cargado', S.ok, S.ok ? `Cargado después del cierre del mes (${fechaCorta(S.ultima)}${S.rcv ? ', con el RCV' : ''}).` : S.hasta ? `Hay documentos hasta el ${fechaCorta(S.hasta)}, pero falta una carga hecha después del ${fechaCorta(fin)} (el RCV del mes).` : `No hay ninguna carga del SII con documentos de ${nm}.`, '#gastos/cargas', TXT_SII_GN));
  const M = G.movs || {};
  out.push(itemCheck('cartola', 'Cartola conciliada', !num(M.n), num(M.n) ? `${M.n} ${M.n === 1 ? 'movimiento' : 'movimientos'} de ${nm} sin explicar en la Bandeja (${pesosTxt(M.monto)}).` : 'Todos los movimientos del mes están unidos a su documento o marcados "No es gasto".',
    '#gastos', 'Que cada cargo del mes (cuenta corriente, Mercado Pago, tarjeta) esté unido a su documento en Gastos → Bandeja, o marcado "No es gasto" (traspaso, retiro, pago de la tarjeta, devolución al dueño). Los pagos a cuenta no cuentan aquí: van en su propia línea, como aviso.'));
  // v0.126.1 · Etapa 4: los pagos a cuenta que esperan su documento, en su propia línea: un aviso con la lista (no impide cerrar)
  const AC = G.aCuenta || {};
  if (num(AC.n)) out.push(itemCheck('acuenta', `Pagos a cuenta esperando su documento: ${AC.n}`, false,
    `${AC.n} ${AC.n === 1 ? 'pago' : 'pagos'} · ${pesosTxt(AC.monto)}: ${(AC.lista || []).map(x => `${x.quien} ${fechaCorta(x.fecha)} ${pesosTxt(x.monto)}`).join(' · ')}. Ya están conciliados con su cargo; cuando llegue la factura, se aplica desde la Bandeja. Es un aviso: no impide cerrar.`,
    '#gastos', 'Un pago a cuenta es un cargo que se pagó antes de tener el documento (por ejemplo, un anticipo o una compra cuya factura todavía no llega). Ya está explicado: solo falta unirle su factura cuando llegue (Gastos → Bandeja → "Aplicar pago a cuenta").\nNo impide cerrar. Al llegar la factura, su gasto entra en el mes de la factura.', 'aviso'));
  const C = G.sinClas || {};
  out.push(itemCheck('sii_clasif', `Documentos de ${nm} sin clasificar: ${num(C.n)}`, !num(C.n), num(C.n) ? `${C.n} ${C.n === 1 ? 'documento' : 'documentos'} de ${nm} sin clasificar (${pesosTxt(C.monto)}): no están en el estado de resultados.` : `Todos los documentos de ${nm} están clasificados.`,
    '#gastos', 'Un documento sin clasificar (proveedor nuevo o que recuerda solo el ítem) no tiene ítem ni área: no entra al estado de resultados. Clasifíquelo en Gastos → Bandeja ("Clasificar").'));
  const t = tituloPrevired(mes), sig = MESES_L[Number(mesMas(mes, 1).slice(5, 7)) - 1], P = G.previred;
  out.push(!P ? itemCheck('previred', t, false, `Las cotizaciones de ${MESES_L[Number(mes.slice(5, 7)) - 1]} no están en Gastos (se pagan hasta el 13 de ${sig}).`, '#gastos/cargas', TXT_PREVIRED_GN)
    : P.completo ? itemCheck('previred', t, true, `Cargado (${pesosTxt(P.total)}) y pagado.`, '#gastos', TXT_PREVIRED_GN)
      : itemCheck('previred', t, false, `Cargado (${pesosTxt(P.total)}), ${num(P.pagado) ? `pagado ${pesosTxt(P.pagado)}, faltan ${pesosTxt(P.total - P.pagado)}` : 'todavía sin unir a su pago'}.`, '#gastos', TXT_PREVIRED_GN, 'aviso'));
  // v0.103.0 · Fletes de compra sin unir a su compra: un aviso (su costo todavía no está en lo comprado)
  const FL = G.fletes || {};
  if (num(FL.n)) out.push(itemCheck('fletes', `Fletes de compra sin unir: ${FL.n}`, false, `${FL.n} ${FL.n === 1 ? 'flete' : 'fletes'} de ${nm} sin unir a su compra (${pesosTxt(FL.monto)}): todavía no suman al costo de lo comprado. Es un aviso: no impide cerrar.`,
    '#gastos', 'El flete de una compra (la factura aparte del courier) se une a su compra en Gastos → Bandeja ("¿De qué compra es?"): se suma al costo de lo comprado. Sin unir, queda como inventario y no entra al resultado.', 'aviso'));
  return out;
}
export function checksCierre(D) {
  const mes = D.mes, out = [];
  const add = (...a) => out.push(itemCheck(...a));
  // v0.101.0 · Desde el inicio (D.gn): SII, cartola, documentos sin clasificar y Previred, del Gastos nuevo
  const G = D.gn ? checksGastosNuevo(D) : null, deG = k => G.find(c => c.k === k);
  // 1. SII del mes cargado: alguna carga cubre hasta el último día del mes
  out.push(G ? deG('sii') : checkSiiCargado(D));
  // 2. Ventas completas (las dos sucursales y B2B): sin cajas abiertas ni cierres sin resumen
  const v = D.ventas || {};
  add('ventas', 'Ventas completas', !v.abiertas && !v.faltan,
    v.guardado ? 'Mes guardado completo en Finanzas.' : `${v.abiertas ? `${v.abiertas} ${v.abiertas === 1 ? 'caja abierta' : 'cajas abiertas'}` : ''}${v.abiertas && v.faltan ? ' · ' : ''}${v.faltan ? `${v.faltan} ${v.faltan === 1 ? 'cierre sin resumen' : 'cierres sin resumen'}` : ''}` || 'Todas las cajas cerradas y con su resumen.',
    '#finanzas/margenes', 'Todas las cajas del mes cerradas y con su resumen de cierre (Ventas en tienda → Reportes o Finanzas → Márgenes → "Generar los que faltan"). Las órdenes B2B se leen tal cual.');
  // v0.112.0 · Las ventas B2B leídas al día (al cerrar se leen de nuevo; sin conexión a la base de B2B quedarían viejas o en cero)
  if (v.b2bSinConexion) add('b2b', 'Ventas a empresas al día', false, 'No se pudo leer la base de Ventas a empresas: las ventas a empresas del mes no están al día.', '#b2b', 'Abre Ventas a empresas en este equipo (que conecte con su base) y vuelve a revisar antes de cerrar.');
  add('ainavillo', 'Ainavillo registrando ventas', num(v.nAinavillo) > 0,
    num(v.nAinavillo) > 0 ? `${num(v.nAinavillo).toLocaleString('es-CL')} productos vendidos · ${pesosTxt(v.netoAinavillo)} neto.` : 'Ainavillo no tiene ventas registradas en la caja este mes.',
    '#caja/reportes', 'Ainavillo tiene que registrar sus ventas en la caja: si no, su venta no está en el estado de resultados. Es un aviso: no impide cerrar.', 'aviso');
  // 3. Cartola conciliada: ningún cargo del mes por revisar
  out.push(G ? deG('cartola') : checkCartolaConciliada(D));
  if (G && deG('acuenta')) out.push(deG('acuenta'));   // v0.126.1
  // v0.69.5 · Previred del mes cargado (el de ese mismo mes: es su costo). Lo pasa Cierre de mes; sin el dato no se agrega.
  if (G) out.push(deG('previred')); else if ('planillas' in D) out.push(checkPrevired(D));
  if (G && deG('fletes')) out.push(deG('fletes'));   // v0.103.0
  // 4. Conteo de bodega hecho (cada bodega): un conteo en los últimos 3 días del mes o los primeros 3 del siguiente
  const w = ventanaConteo(mes), C = D.conteos || {}, bods = C.bodegas && C.bodegas.length ? C.bodegas : ['PROD', 'CAF'];
  const sinConteo = bods.filter(b => !((C.porBodega || {})[b] || []).some(f => f >= w.desde && f <= w.hasta));
  // v0.102.0 · Decidido por Emmanuel el 25 oct: el conteo de las jefas (materias primas críticas) es para el punto de pedido. El inventario se
  // valoriza con el teórico cada mes y con un conteo completo en cada balance (30 de junio y 31 de diciembre): aquí es un aviso, no impide cerrar.
  add('conteo', 'Conteo de bodega hecho', C.disponible !== false && !sinConteo.length,
    C.disponible === false ? 'No se pudo leer Producción (bodegas).' : sinConteo.length ? `Falta el conteo de ${sinConteo.map(b => (C.nombres || {})[b] || b).join(' y ')} (del ${fechaCorta(w.desde)} al ${fechaCorta(w.hasta)}). Es un aviso: no impide cerrar.` : `Contado: ${bods.map(b => `${(C.nombres || {})[b] || b} ${fechaCorta(((C.porBodega || {})[b] || []).filter(f => f >= w.desde && f <= w.hasta).sort().pop())}`).join(' · ')}.`,
    '#produccion/bodega', `Un conteo en cada bodega (Producción y Cafetería) entre el ${fechaCorta(w.desde)} y el ${fechaCorta(w.hasta)}: los últimos ${VENTANA_CONTEO} días del mes o los primeros ${VENTANA_CONTEO} del siguiente. Lo anotan las jefas en Cocina → Bodega.\nEs un aviso: el conteo de las jefas sirve para el punto de pedido. El inventario se valoriza con el teórico (compras, recetas y merma) y con un conteo completo en cada balance (30 de junio y 31 de diciembre).`, 'aviso');
  // 5. Gastos sin clasificar = 0
  const sc = D.sinClasificar || {};
  // v0.102.0 · Con el catálogo de ítems (D.catalogo), un gasto sin tipo es un ítem sin cuenta: se ubica en Gastos → Ítems ("Revisar ítem")
  if (D.catalogo) add('clasificar', 'Ítems con su cuenta', !num(sc.n), num(sc.n) ? `${sc.n} ${sc.n === 1 ? 'ítem' : 'ítems'} sin cuenta (${pesosTxt(sc.neto)}): no están en el catálogo.` : 'Todos los gastos del mes tienen un ítem con cuenta.',
    '#gastos/catalogo', 'Cada gasto del mes con un ítem del catálogo que tenga su cuenta (Gastos → Ítems). Un nombre que no está en el catálogo aparece en "Revisar ítem": se ubica ahí. Lo que no tiene cuenta no entra al resultado.');
  else add('clasificar', 'Gastos clasificados', !num(sc.n), num(sc.n) ? `${sc.n} ${sc.n === 1 ? 'ítem' : 'ítems'} sin tipo para resultados (${pesosTxt(sc.neto)}).` : 'Todos los gastos del mes tienen tipo.',
    '#finanzas/resultados/clasificacion', 'Cada ítem de gasto del mes con su tipo para resultados (Resultados → Clasificación). Lo sin clasificar no entra al resultado.');
  // v0.66.0 · Documentos del SII de ese mes sin clasificar = 0 (su gasto todavía no existe)
  if (G) out.push(deG('sii_clasif')); else if (D.siiPendientes) out.push(checkSiiClasificados(D));
  // 6. Productos vendidos sin asociar < 10 % de la venta
  const pctSin = num(v.netoTotal) > 0 ? num(v.netoSinAsociar) / num(v.netoTotal) * 100 : 0;
  add('asociar', 'Productos vendidos asociados', pctSin < 10, `${String(Math.round(pctSin * 10) / 10).replace('.', ',')} % de la venta neta sin asociar (${pesosTxt(v.netoSinAsociar)}); el límite es menos de 10 %.`,
    '#finanzas/margenes/asociar', 'La venta de productos sin asociar a una receta o reventa no tiene costo directo. Para cerrar, menos del 10 % de la venta neta del mes puede quedar sin asociar.');
  // v0.80.1 · Receta pendiente: asociados (a su área) pero sin costo. Una línea aparte, que no impide cerrar.
  if (num(v.nRecetaPendiente) > 0) add('receta_pendiente', 'Productos asociados sin costo (receta pendiente)', false,
    `${v.nRecetaPendiente} ${v.nRecetaPendiente === 1 ? 'producto vendido tiene' : 'productos vendidos tienen'} la receta pendiente: ${pesosTxt(v.netoRecetaPendiente)} de venta neta en su área, sin costo directo. Cuentan como asociados; no impide cerrar.`,
    '#catalogo/productos/falta-receta', 'Son productos del Catálogo que se venden con la "Receta pendiente" (su receta todavía no está aprobada o no existe). Su venta va a su área, pero sin costo directo: el margen de esa área se ve más alto de lo que es. Es un aviso: no impide cerrar.\nApruébala o créala en Cocina y toca "Unir con su receta" en Catálogo → Productos. Un mes ya cerrado no cambia.', 'aviso');
  return out;
}
export const fallas = checks => (checks || []).filter(c => c.nivel === 'falla');
const fechaCorta = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(f)); return m ? `${Number(m[3])} ${MESES_L[Number(m[2]) - 1].slice(0, 3)}` : '—'; };

// ═══════════════ Snapshot y ajustes ═══════════════
// Lo que se guarda al cerrar: el estado de resultados completo (filas, canal, info, cuadratura, detalle), los costos usados,
// las revisiones (y si se cerró igual con motivo), los ajustes de meses anteriores que se informaron aquí, quién y cuándo.
export function armarSnapshot(eerr, { checks = [], override = null, por = '', en = '', ajustes = null } = {}) {
  const f = fallas(checks);
  if (f.length && !(override && s(override.motivo).trim().length >= 5)) throw new Error('Hay revisiones sin cumplir: para cerrar igual, marca "Cerrar igual" y escribe el motivo.');
  return {
    mes: eerr.mes, estado: 'cerrado', filas: eerr.filas, canal: eerr.canal, info: eerr.info, cuadratura: eerr.cuadratura, detalle: eerr.detalle, avisos: eerr.avisos, costosUsados: eerr.costosUsados,
    checks: checks.map(c => ({ k: c.k, t: c.t, ok: c.ok, nivel: c.nivel, detalle: c.detalle })), override: f.length ? { motivo: s(override.motivo).trim().slice(0, 300), fallas: f.map(c => c.k) } : null,
    ajustes: ajustes ? { total: ajustes.total, porMes: ajustes.porMes } : null, cerradoPor: por, cerradoEn: en,
    // v0.111.0 · El estado por cuentas, congelado: un mes cerrado se ve igual aunque cambie cómo se ordena después
    estadoCuentas: FS.armarEstado(eerr)   // (no "estado": ese campo dice 'cerrado')
  };
}
// Lo informado como ajuste de un mes X en los snapshots de otros meses cerrados (por fila, en Total)
export function yaInformado(cierres, mesX) {
  const out = {};
  Object.values(cierres || {}).forEach(c => { if (!c || c.estado !== 'cerrado' || !c.ajustes || !c.ajustes.porMes) return; const a = c.ajustes.porMes[mesX]; if (!a) return; Object.entries(a.porFila || {}).forEach(([k, v]) => { out[k] = (out[k] || 0) + num(v); }); });
  return out;
}
// v0.75.1 · Un cierre de antes del bloque del canal B2B (sin filas.canalB2B): el despacho estaba en Común (dentro del margen de
// contribución y del margen del área) y los costos del canal B2B en los comunes. El cálculo de hoy se lleva a esa forma para comparar.
export const formaAntigua = snap => !!(snap && snap.filas && !snap.filas.canalB2B);
export function filasFormaAntigua(vivo) {
  const F = vivo.filas, cg = num((F.cargos || {}).total), cb = (vivo.info && vivo.info.canalB2B) || { rem: 0, fijos: 0 };
  const t = k => num((F[k] || {}).total);
  const out = {};
  FILAS.forEach(f => { out[f.k] = { total: t(f.k) }; });
  out.mc = { total: t('mc') + cg }; out.ma = { total: t('ma') + cg };
  out.remComun = { total: t('remComun') + num(cb.rem) }; out.fijosComun = { total: t('fijosComun') + num(cb.fijos) };
  return out;
}
// v0.102.0 · Un cierre de antes de la v0.102.0 (sin filas.packaging): el packaging iba con los costos de venta, las tiendas y los comunes con
// fila propia (marketing, seguros, transporte, capacitación) iban en los comunes. El cálculo de hoy se lleva a esa forma para comparar.
export const formaPre102 = snap => !!(snap && snap.filas && !snap.filas.packaging);
export function filasComoSnap(vivo, snap) {
  const F = formaAntigua(snap) ? filasFormaAntigua(vivo) : Object.fromEntries(FILAS.map(f => [f.k, { total: num((vivo.filas[f.k] || {}).total) }]));
  if (!formaPre102(snap)) return F;
  const t = k => num((F[k] || {}).total), ti = (vivo.info && vivo.info.tiendas) || {}, tt = c => FILAS_TIENDAS.reduce((a, k) => a + num((ti[k] || {})[c]), 0), cero = { total: 0 };
  return { ...F, costosVenta: { total: t('costosVenta') + t('packaging') }, packaging: cero, remComun: { total: t('remComun') + tt('rem') }, fijosComun: { total: FILAS_COMUNES_FIJOS.reduce((a, k) => a + t(k), 0) + tt('fijos') },
    ...Object.fromEntries(FILAS_TIENDAS.concat(FILAS_COMUNES_FIJOS.slice(1)).map(k => [k, cero])) };
}
// Diferencia de un mes cerrado: cálculo de hoy − snapshot − lo ya informado. Por fila (Total) y los gastos que cambiaron.
export function ajusteDe(vivo, snap, informado = {}, informadoCuentas = {}) {
  const porFila = {}, antigua = formaAntigua(snap), pre102 = formaPre102(snap), FV = filasComoSnap(vivo, snap);
  FILAS.forEach(f => { if (antigua && (f.k === 'canalB2B' || f.k === 'resCanalB2B')) return; if (f.k === 'resAntesImp') return;   /* v0.106.0: lo dice el resultado */ const d = num((FV[f.k] || {}).total) - num((snap.filas[f.k] || {}).total) - num(informado[f.k]); if (Math.abs(d) >= 1) porFila[f.k] = r0(d); });
  // Gastos que cambiaron (por id): agregados, quitados o con otro monto/tipo/área
  const donde = (k, r) => { const k1 = pre102 && FILAS_TIENDAS.includes(k) ? (r.tipoRes === 'remuneraciones' ? 'remComun' : 'fijosComun') : pre102 && FILAS_COMUNES_FIJOS.includes(k) ? 'fijosComun' : pre102 && k === 'packaging' ? 'costosVenta' : k;
    return antigua && k1 === 'canalB2B' ? (r.tipoRes === 'remuneraciones' ? 'remComun' : 'fijosComun') : k1; };
  const mapa = det => { const m = {}; Object.entries(det || {}).forEach(([k, refs]) => (refs || []).forEach(r => { if (r.tipo !== 'gasto') return; const x = m[r.id] || (m[r.id] = { id: r.id, item: r.item, fecha: r.fecha, neto: 0, donde: [] }); x.neto += num(r.neto); x.donde.push(donde(k.split('.')[0], r)); })); return m; };
  const a = mapa(snap.detalle), b = mapa(vivo.detalle), gastos = [];
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(id => {
    const x = a[id], y = b[id];
    if (!x) gastos.push({ id, item: y.item, fecha: y.fecha, antes: 0, ahora: r0(y.neto), cambio: 'nuevo' });
    else if (!y) gastos.push({ id, item: x.item, fecha: x.fecha, antes: r0(x.neto), ahora: 0, cambio: 'quitado' });
    else if (r0(x.neto) !== r0(y.neto) || x.donde.sort().join() !== y.donde.sort().join()) gastos.push({ id, item: y.item, fecha: y.fecha, antes: r0(x.neto), ahora: r0(y.neto), cambio: 'cambió', antesDonde: x.donde, ahoraDonde: y.donde });
  });
  // v0.111.0 · Por cuenta (solo si la foto guardó el estado por cuentas: los cierres desde la v0.111.0)
  const porCuenta = snap.estadoCuentas && snap.estadoCuentas.cuentas ? FS.ajusteCuentas(FS.armarEstado(vivo), snap.estadoCuentas, informadoCuentas) : null;
  // Hay ajuste si cambia una fila de antes o una fila del estado por cuentas (un cambio entre cuentas de la misma fila, como 5.1 → 5.2, no es ajuste)
  const porFila1 = {}; Object.entries(porCuenta || {}).forEach(([k, v]) => { const f = k.split('|')[0]; porFila1[f] = (porFila1[f] || 0) + v; });
  const cambiaFila1 = Object.values(porFila1).some(v => Math.abs(v) >= 1);
  return { porFila, resultado: porFila.resultado || 0, gastos, hay: Object.keys(porFila).length > 0 || cambiaFila1, ...(porCuenta && (Object.keys(porFila).length || cambiaFila1) ? { porCuenta } : {}) };
}
// En qué mes abierto se informa el ajuste de un mes cerrado: el primer mes después de él que no esté cerrado
export function mesDeAjuste(mesX, cierres, hasta = '9999-12') {
  for (let m = mesMas(mesX, 1), k = 0; m <= hasta && k < 60; m = mesMas(m, 1), k++) { const c = (cierres || {})[m]; if (!c || c.estado !== 'cerrado') return m; }
  return null;
}
// Junta los ajustes que van en el mes M: { total, porMes { X: { porFila, resultado, gastos } } }
export function juntarAjustes(porMes) {
  const out = { total: 0, porMes: {} };
  Object.entries(porMes || {}).forEach(([m, a]) => { if (!a || !a.hay) return; out.porMes[m] = { porFila: a.porFila, ...(a.porCuenta ? { porCuenta: a.porCuenta } : {}), resultado: a.resultado, gastos: (a.gastos || []).slice(0, 50) }; out.total += a.resultado; });
  return out;
}
// Meses de un año para el selector: de enero al mes de hoy (o diciembre), del más nuevo al más viejo
export function mesesDelAnio(anio, hoy) {
  const out = [], tope = mesDe(hoy) < `${anio}-12` ? mesDe(hoy) : `${anio}-12`;
  for (let m = `${anio}-01`; m <= tope; m = mesMas(m, 1)) out.push(m);
  return out.reverse();
}
