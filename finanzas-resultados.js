// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas, F3 paso 1: clasificar para el estado de resultados  v0.61.0
//  Reglas puras (sin red), probadas en pruebas/sistemafen/finanzas-f3a.test.js:
//   · Tipo para resultados de cada ítem de gasto (propuesta por palabras del nombre y el subtipo del ítem).
//   · Mapa de áreas de gasto: cada código de área de los gastos → área propia (PAN, BOL, PAS, CAF) o común.
//     Los gastos prorrateados ya vienen en una línea por área; si una línea antigua dice "PRORRATEADO" y trae
//     PArea/PPct, se reparte según esos %.
//   · Créditos: tabla francesa (cuota, interés y capital por período, en pesos; la última cuota ajusta),
//     tabla pegada a mano y qué cuotas están pagadas (vencimientos pagados de su obligación).
//   · Inversiones: vida útil por defecto según el nombre y depreciación mensual por área.
//  Todo en neto. Nada de esto cambia los gastos: es una capa de Finanzas (fen-gastos: fin_items, fin_config,
//  fin_creditos, fin_inversiones).
// ═══════════════════════════════════════════════
import { idLimpio } from './gastos-modelo.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';
import * as PC from './plan-cuentas.js?v=0.138.0';   // v0.102.0: con el catálogo de ítems, el tipo sale de la cuenta

export const ANIO = 2026;
// v0.69.1: las áreas propias son las de margen (las 4 de producción + REVENTA), de areas.js
export const AREAS = AR.MARGEN;
export const NOMBRE_AREA = { PAN: 'Panadería', BOL: 'Bollería', PAS: 'Pastelería', CAF: 'Cafetería', REVENTA: 'Reventa', comun: 'Común' };

// ── Tipos para resultados ──
// grupo: costo (entra al resultado), compra (no es línea de gasto: va a la desviación de materias primas),
// margen (ya está en el margen), fuera (no es gasto del mes: va al flujo de caja)
export const TIPOS = [
  { k: 'compras_mp', t: 'Compras de materias primas e insumos', corto: 'Compras MP', grupo: 'compra', ayuda: 'No es una línea de gasto: el costo de las materias primas ya está en el costo directo de cada producto. Las compras se usan después para la desviación (compras − consumo teórico ± conteo de bodega).' },
  { k: 'compras_reventa', t: 'Compras de productos de reventa', corto: 'Compras reventa', grupo: 'compra', ayuda: 'Bebidas y otros productos que se compran hechos. Su costo ya está en el margen de la reventa; las compras se usan después para la desviación.' },
  { k: 'remuneraciones', t: 'Remuneraciones', corto: 'Remuneraciones', grupo: 'costo', ayuda: 'Sueldos, cotizaciones (Previred), finiquitos y bonos. Van al área del gasto: fijo propio si es Panadería, Bollería, Pastelería o Cafetería; común si es Administración o Ventas. El sueldo empresarial va como común.' },
  { k: 'fijo', t: 'Gasto fijo', corto: 'Fijo', grupo: 'costo', ayuda: 'Arriendo, luz, agua, gas, internet, teléfono, contabilidad, seguros, mantención. Fijo propio si el área del gasto es una de producción (según el mapa de áreas); común si es Administración, Ventas u otra.' },
  // v0.102.0 · Desde la cuenta del ítem (plan-cuentas.js): comisiones de medios de pago y arriendo del POS (5.4) y packaging (5.7)
  { k: 'costo_venta', t: 'Costo de venta', corto: 'Costo de venta', grupo: 'costo', ayuda: 'Lo que lleva consigo cada venta y no está en la receta: comisiones y arriendo del POS (5.4) y packaging (5.7). Va al piso 1, en el área del gasto.' },
  { k: 'en_margen', t: 'Ya incluido en el margen', corto: 'En el margen', grupo: 'margen', ayuda: 'Comisiones de tarjeta y despacho B2B: ya se restan en el margen de contribución (Márgenes → Ajustes). No se cuentan dos veces.' },
  { k: 'financiero', t: 'Gasto financiero', corto: 'Financiero', grupo: 'costo', ayuda: 'Intereses, multas (como las de Previred por pagar atrasado), comisiones y mantención de la cuenta del banco. Entran al resultado como gasto común (debajo de los tres pisos).' },
  { k: 'fuera_capital_credito', t: 'Cuota de crédito', corto: 'Cuota de crédito', grupo: 'fuera', ayuda: 'El capital de la cuota no es gasto: es devolver el préstamo (va al flujo de caja). El interés sí es gasto financiero: se separa con la tabla del crédito (pestaña Créditos).' },
  { k: 'fuera_impuestos', t: 'Impuestos (F29, IVA, PPM)', corto: 'Impuestos', grupo: 'fuera', ayuda: 'El pago del F29 (IVA y PPM) no es gasto del mes: todo se mide en neto y el IVA va al flujo de caja. El PPM es un anticipo del impuesto a la renta.' },
  { k: 'fuera_provision', t: 'Pagado con la provisión de los trabajadores', corto: 'Usa la provisión', grupo: 'fuera', ayuda: 'La liquidación de un reemplazo de vacaciones o un finiquito: ya se cargó al resultado mes a mes (provisión de vacaciones y finiquitos). No es gasto otra vez.' },
  { k: 'fuera_deuda', t: 'Deuda con el fisco (convenio TGR)', corto: 'Deuda con el fisco', grupo: 'fuera', ayuda: 'La cuota de un convenio de pago con la TGR baja una deuda: no es gasto del mes. Sus intereses y multas sí son gasto financiero.' },
  { k: 'inversion', t: 'Inversión', corto: 'Inversión', grupo: 'fuera', ayuda: 'Equipos, maquinaria, muebles, computadores o remodelaciones que duran años. No entran enteros al mes en que se compran: entran como depreciación mensual según su vida útil (pestaña Inversiones).' },
  { k: 'retiro', t: 'Retiro del dueño', corto: 'Retiro', grupo: 'fuera', ayuda: 'Plata que sale para el dueño. No es gasto del negocio (el sueldo empresarial sí lo es: va como remuneración).' },
  { k: 'otro_fuera', t: 'Otro fuera del resultado', corto: 'Otro fuera', grupo: 'fuera', ayuda: 'Cualquier otra salida de plata que no es gasto del mes (por ejemplo, una garantía que se devuelve). Pide un motivo.' }
];
export const TIPO = Object.fromEntries(TIPOS.map(x => [x.k, x]));
export const NOMBRE_GRUPO = { costo: 'Gasto del resultado', compra: 'Compras (desviación)', margen: 'Ya en el margen', fuera: 'Fuera del resultado' };

const s = v => (v === null || v === undefined ? '' : String(v));
const sinTildes = t => s(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normalizar = t => sinTildes(t).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
// Clave de un ítem: el mismo id que tiene en la colección items de fen-gastos (nombre limpio en minúsculas)
export const claveItem = nombre => (idLimpio(s(nombre).trim()) || 'sin-item').toLowerCase();
const num = v => { const n = typeof v === 'number' ? v : Number(s(v).replace(',', '.')); return isFinite(n) ? n : 0; };

// ── 1. Propuesta por palabras del nombre (y el subtipo del ítem) ──
// Orden: lo más específico primero (una "COMISION TRANSBANK" no es comisión bancaria; un "INTERES CREDITO" es financiero).
const REGLAS = [
  ['retiro', /\bRETIROS?\b/],
  ['fuera_impuestos', /\b(IVA|F ?29|PPM|IMPUESTOS?|TESORERIA)\b/],
  ['en_margen', /\bCOMISION(ES)? (TRANSBANK|TARJETAS?|GETNET|SUMUP|MERCADO ?PAGO|POS)\b|\bTRANSBANK\b|\bGETNET\b|\bSUMUP\b|\bDESPACHO B2B\b/],
  ['financiero', /\bINTERES(ES)?\b|\bMULTAS?\b|\bCOMISION(ES)? (BANCARIAS?|BANCO|CUENTA)\b|\bGASTOS? BANCARIOS?\b|\bMANTENCION\b/],
  ['fuera_capital_credito', /\b(PRESTAMOS?|CREDITOS?|CUOTAS?|LEASING|FONDO ESPERANZA)\b/],
  ['inversion', /\b(INVERSION(ES)?|EQUIPOS?|EQUIPAMIENTO|MAQUINARIAS?|MAQUINAS?|HORNOS?|AMASADORA|LAMINADORA|REFRIGERADOR|VITRINAS?|MOBILIARIO|MUEBLES?|COMPUTADOR(ES)?|NOTEBOOK|REMODELACION|HABILITACION)\b/],
  ['remuneraciones', /\b(REMUNERACION(ES)?|SUELDOS?|SALARIOS?|COTIZACION(ES)?|PREVIRED|FINIQUITOS?|GRATIFICACION(ES)?|BONOS?|AGUINALDOS?|HONORARIOS?|MUTUAL)\b/],
  ['fijo', /\b(ARRIENDOS?|LUZ|ELECTRICIDAD|ENEL|CGE|AGUA|ESSBIO|GAS|INTERNET|TELEFONO|TELEFONIA|CELULAR|CONTABILIDAD|CONTADOR|SEGUROS?|PATENTE|REPARACION(ES)?|ASEO|SOFTWARE|SUSCRIPCION(ES)?|GASTOS? COMUNES?|VIGILANCIA|ALARMA)\b/],
  // v0.64.0: lo que se compra hecho para vender tal cual (chocolates, infusiones, té, la marca Magia): reventa
  ['compras_reventa', /\b(REVENTA|BEBIDAS?|JUGOS?|CHOCOLATES?|INFUSION(ES)?|TES?|MAGIA)\b/],
  ['compras_mp', /\b(MATERIAS? PRIMAS?|INSUMOS?|HARINAS?|LECHES?|MANTEQUILLA|HUEVOS?|AZUCAR|LEVADURA|CHOCOLATE|CREMA|FRUTAS?|ENVASES?|PACKAGING|EMBALAJE|CAFE EN GRANO|CAFE)\b/]
];
const PALABRA = { compras_mp: 'materias primas', compras_reventa: 'reventa', remuneraciones: 'remuneración', fijo: 'gasto fijo', en_margen: 'comisión de tarjeta o despacho', financiero: 'interés o banco',
  fuera_capital_credito: 'crédito o cuota', fuera_impuestos: 'impuesto', inversion: 'inversión', retiro: 'retiro' };
// item: nombre del ítem; ref: el ítem de la lista (categoria, tipo, subTipo) si existe
// v0.101.0 · Ítems que crea el sistema (Gastos nuevo: F29, créditos, Previred). Tienen su tipo fijo (acordado con Emmanuel el 25 oct):
// el IVA y el PPM no son gasto; la retención de las boletas de terceros y el impuesto único son parte del costo de pagar a las
// personas (remuneraciones); multas e intereses, financiero; el capital de un crédito no es gasto. Lo guardado en Clasificación manda igual.
// Los nombres son los de gn-pdf.js (ITEMS_F29, ITEMS_CREDITO) y gn-bandeja.js (ITEM_COTIZACIONES...): una prueba revisa que calcen.
export const TIPOS_SISTEMA = {
  'IVA (F29)': 'fuera_impuestos', 'PPM (F29)': 'fuera_impuestos', 'OTROS IMPUESTOS (F29)': 'fuera_impuestos', 'IMPUESTOS (F29)': 'fuera_impuestos',
  'RETENCION BOLETAS DE TERCEROS (F29)': 'remuneraciones', 'IMPUESTO UNICO TRABAJADORES (F29)': 'remuneraciones', 'MULTAS E INTERESES (F29)': 'financiero',
  'INTERESES DE CREDITO': 'financiero', 'CAPITAL DE CREDITO': 'fuera_capital_credito', 'CUOTA DE CREDITO': 'fuera_capital_credito',
  'COTIZACIONES PREVISIONALES': 'remuneraciones', 'MULTAS E INTERESES PREVIRED': 'financiero', 'MULTAS E INTERESES': 'financiero'
};
const SISTEMA_N = Object.fromEntries(Object.entries(TIPOS_SISTEMA).map(([k, v]) => [normalizar(k), v]));
export const tipoSistema = item => SISTEMA_N[normalizar(item)] || '';
export function proponer(item, ref = null) {
  const n = normalizar(item), sub = normalizar(ref && ref.subTipo), cat = normalizar(ref && ref.categoria);
  if (SISTEMA_N[n]) return { tipo: SISTEMA_N[n], por: 'sistema', motivo: 'ítem del sistema (Gastos nuevo): su tipo está acordado' };
  // Lo que Emmanuel ya clasificó como inversión en Gastos (subtipo INVERSIÓN) manda
  if (sub === 'INVERSION') return { tipo: 'inversion', por: 'subtipo', motivo: 'el ítem tiene subtipo INVERSIÓN en Gastos' };
  for (const [tipo, re] of REGLAS) {
    const m = n.match(re);
    if (m) {
      // "MANTENCION" de un equipo o del local es gasto fijo, no del banco
      if ((tipo === 'financiero' && /\bMANTENCION\b/.test(m[0]) && /\b(EQUIPOS?|MAQUINAS?|MAQUINARIAS?|LOCAL|HORNOS?|VEHICULOS?)\b/.test(n))
        || (tipo === 'inversion' && /\b(MANTENCION|REPARACION(ES)?|ARRIENDO)\b/.test(n))) return { tipo: 'fijo', por: 'nombre', motivo: 'el nombre dice mantención, reparación o arriendo de un equipo o del local (gasto fijo)' };
      return { tipo, por: 'nombre', motivo: `el nombre dice "${m[0].toLowerCase()}" (${PALABRA[tipo]})` };
    }
  }
  // v0.67.1: subtipo FINANCIERO = gasto financiero (intereses, multas, banco). Si el nombre dice crédito, cuota o préstamo,
  // la regla del nombre de arriba ya lo dejó como cuota de crédito (el capital no es gasto).
  if (sub === 'FINANCIERO') return { tipo: 'financiero', por: 'subtipo', motivo: 'el ítem tiene subtipo FINANCIERO en Gastos' };
  if (sub === 'PASIVO') return { tipo: 'fuera_impuestos', por: 'subtipo', motivo: 'el ítem tiene subtipo PASIVO (impuestos por pagar) en Gastos' };
  if (cat === 'FIJO') return { tipo: 'fijo', por: 'categoria', motivo: 'el ítem tiene categoría FIJO en Gastos' };
  return { tipo: '', por: '', motivo: 'sin propuesta: elígelo tú' };
}

// ── v0.67.1 · El tipo que cuenta (una sola regla para Finanzas, el estado de resultados y Previred) ──
// 1. Lo guardado en Finanzas → Resultados → Clasificación (fin_items) siempre manda.
// 2. Sin clasificación: un ítem con subtipo FINANCIERO en Gastos (sin tildes ni mayúsculas) cuenta como financiero, salvo que
//    su nombre diga crédito, cuota o préstamo (eso es capital: se clasifica a mano).
// 3. Lo demás queda sin clasificar (INVERSIÓN y PASIVO solo se proponen: sacan el gasto del resultado, lo decides tú).
// nombre: el ítem; fin: fin_items por clave; ref: el ítem de Gastos ({ subTipo }) o el gasto mismo (trae su subTipo).
// → { tipo, por: 'clasificacion' | 'subtipo' | '' }
export const subtipoFinanciero = ref => normalizar(ref && ref.subTipo) === 'FINANCIERO';
// v0.101.0 · deGN: la línea viene del Gastos nuevo (solo ahí cuentan los tipos fijos del sistema: un ítem antiguo con el mismo nombre
// no cambia, y los meses cerrados quedan iguales)
export function tipoResultado(nombre, fin, ref, deGN = false) {
  const g = (fin || {})[claveItem(nombre)];
  if (g && TIPO[g.tipo]) return { tipo: g.tipo, por: 'clasificacion' };
  if (deGN && tipoSistema(nombre)) return { tipo: tipoSistema(nombre), por: 'sistema' };
  if (subtipoFinanciero(ref) && proponer(nombre, ref).tipo === 'financiero') return { tipo: 'financiero', por: 'subtipo' };
  return { tipo: '', por: '' };
}
export const esFinanciero = (nombre, fin, ref) => tipoResultado(nombre, fin, ref).tipo === 'financiero';
// El aviso cuando un ítem no cuenta como financiero: dónde se arregla (las dos partes)
export function avisoNoFinanciero(nombre, fin, ref) {
  const r = tipoResultado(nombre, fin, ref);
  if (r.tipo === 'financiero') return '';
  if (r.por === 'clasificacion') return `Ese ítem no es de tipo financiero: en Finanzas → Resultados → Clasificación está como "${TIPO[r.tipo].corto}" (eso manda). Cámbialo ahí a "Financiero" para que entre en "Financieros" del estado de resultados.`;
  return 'Ese ítem no es de tipo financiero: en el estado de resultados no quedaría en "Financieros". Arréglalo en Gastos → Ítems (subtipo FINANCIERO) o en Finanzas → Resultados → Clasificación (tipo Financiero; si está clasificado ahí, eso manda).';
}

// ── Gastos que cuentan ──
export const vigente = g => !!g && !g.quitadoEnPlanilla && s(g.estado) !== 'anulado';
export const fechaGasto = g => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(s(g && g.fecha)); return m ? m[1] : ''; };
export const netoGasto = g => num(g && g.montoNeto);
// Líneas por área de un gasto. Las líneas de un prorrateo ya vienen separadas (una por área, con su monto).
// Una línea antigua con área "PRORRATEADO" y PArea/PPct se reparte según esos % (el último absorbe el redondeo).
export function lineasArea(g) {
  const area = s(g && g.area).trim().toUpperCase() || 'SIN ÁREA', neto = netoGasto(g);
  if (area === 'PRORRATEADO') {
    const partes = [1, 2, 3].map(k => ({ area: s(g['pArea' + k]).trim().toUpperCase(), pct: num(g['pPct' + k]) })).filter(x => x.area && x.pct > 0);
    const tot = partes.reduce((a, x) => a + x.pct, 0);
    if (partes.length && Math.abs(tot - 100) < 0.01) {
      let resto = neto;
      return partes.map((x, i) => { const v = i === partes.length - 1 ? resto : Math.round(neto * x.pct / 100); resto -= v; return { area: x.area, neto: v, pct: x.pct, prorrateo: true }; });
    }
  }
  return [{ area, neto }];
}

// ── 2. Mapa de áreas de gasto ──
// v0.63.1 · Códigos de canal (B2B: costos del canal B2B, atención de clientes, órdenes y despacho). El estado de resultados
// todavía no tiene la fila "costo de canal": por ahora van a Común (pendiente para F3; no se construye ahora).
// v0.70.0 · B2C (lo que cuesta atender a los clientes de las tiendas): igual que B2B, a Común con su nota de costo de canal.
export const CANALES_PENDIENTES = { B2B: 'Canal B2B (costo de canal)', B2C: 'Canal B2C (costo de canal)' };
// Por defecto: las de producción y REVENTA son área propia (la misma); Administración, Ventas, Prorrateado y cualquier otra, común.
export const destinoDefecto = codigo => (AREAS.includes(s(codigo).toUpperCase()) ? s(codigo).toUpperCase() : 'comun');
export function destinoArea(codigo, mapa) {
  const c = s(codigo).trim().toUpperCase(), v = mapa && mapa[c];
  return AREAS.includes(v) || v === 'comun' ? v : destinoDefecto(c);
}
// Códigos de área de los gastos del año (con las líneas de prorrateo), con cuántos gastos y cuánto neto
export function areasDeGastos(gastos, anio = ANIO, mapa = {}) {
  const r = {};
  (gastos || []).filter(vigente).filter(g => fechaGasto(g).startsWith(String(anio))).forEach(g => {
    lineasArea(g).forEach(l => { const x = r[l.area] || (r[l.area] = { codigo: l.area, n: 0, neto: 0, deProrrateo: 0 }); x.n++; x.neto += l.neto; if (l.prorrateo) x.deProrrateo++; });
  });
  return Object.values(r).map(x => ({ ...x, destino: destinoArea(x.codigo, mapa), guardado: !!(mapa && mapa[x.codigo]), defecto: destinoDefecto(x.codigo) }))
    .sort((a, b) => b.neto - a.neto || a.codigo.localeCompare(b.codigo));
}
export function validarMapa(mapa) {
  const out = {};
  Object.entries(mapa || {}).forEach(([k, v]) => {
    const c = s(k).trim().toUpperCase();
    if (!c) return;
    if (!AREAS.includes(v) && v !== 'comun') throw new Error(`Elige el área de ${c}`);
    out[c] = v;
  });
  return out;
}

// ── 1. Resumen por ítem: total neto del año, cuántos gastos, por destino, propuesta y lo guardado ──
// items: los de la lista de Gastos ({ item, categoria, tipo, subTipo, area, archivado }); fin: fin_items por clave
export function resumenItems(gastos, items, fin = {}, { anio = ANIO, mapa = {} } = {}) {
  const r = {};
  const fila = (nombre, ref) => {
    const k = claveItem(nombre);
    return r[k] || (r[k] = { clave: k, item: s(nombre).trim() || '(sin ítem)', ref: ref || null, n: 0, neto: 0, porArea: {}, porDestino: {} });
  };
  (items || []).forEach(i => { if (s(i.item).trim()) { const f = fila(i.item, i); f.ref = i; } });
  (gastos || []).filter(vigente).filter(g => fechaGasto(g).startsWith(String(anio))).forEach(g => {
    const f = fila(g.itemGasto, null);
    f.n++; f.neto += netoGasto(g); if (g.origenGN) f.deGN = true;
    lineasArea(g).forEach(l => { f.porArea[l.area] = (f.porArea[l.area] || 0) + l.neto; const d = destinoArea(l.area, mapa); f.porDestino[d] = (f.porDestino[d] || 0) + l.neto; });
  });
  return Object.values(r).map(f => {
    const prop = proponer(f.item, f.ref), g = fin[f.clave] || null;
    const actual = g && TIPO[g.tipo] ? g : null;
    // v0.67.1: sin clasificar, lo que igual cuenta (subtipo FINANCIERO → financiero) para decirlo en la fila
    const cuenta = actual ? null : tipoResultado(f.item, fin, f.ref, !!f.deGN);
    return { ...f, propuesta: prop, guardado: actual, tipo: actual ? actual.tipo : '', clasificado: !!actual, archivado: !!(f.ref && f.ref.archivado), cuentaComo: cuenta && cuenta.tipo ? cuenta.tipo : '',
      distinta: !!(actual && prop.tipo && actual.tipo !== prop.tipo) };
  }).sort((a, b) => b.neto - a.neto || a.item.localeCompare(b.item, 'es'));
}
// Avance: ítems con gastos en el año clasificados y qué % del gasto neto del año cubren (en valor absoluto: una nota de crédito no resta avance)
export function avance(resumen) {
  const con = (resumen || []).filter(f => f.n > 0), hechos = con.filter(f => f.clasificado);
  const tot = con.reduce((a, f) => a + Math.abs(f.neto), 0), ok = hechos.reduce((a, f) => a + Math.abs(f.neto), 0);
  return { n: hechos.length, m: con.length, pct: tot > 0 ? ok / tot * 100 : (con.length ? 0 : 100), netoTotal: con.reduce((a, f) => a + f.neto, 0), netoClasificado: hechos.reduce((a, f) => a + f.neto, 0) };
}
// Documento fin_items/{clave} (+ su historial). prev: el guardado (o null). origen: propuesta | manual
export function armarClasificacion(prev, datos, { hoy = '', por = '' } = {}) {
  const tipo = s(datos.tipo);
  if (!TIPO[tipo]) throw new Error('Elige el tipo para resultados');
  const motivo = s(datos.motivo).trim().slice(0, 200);
  if (tipo === 'otro_fuera' && !motivo) throw new Error('Escribe el motivo (por qué queda fuera del resultado)');
  const doc = { item: s(datos.item).trim(), clave: claveItem(datos.item), tipo, motivo: tipo === 'otro_fuera' ? motivo : '', origen: datos.origen === 'propuesta' ? 'propuesta' : 'manual',
    propuesta: s(datos.propuesta), fecha: hoy, por, version: (Number(prev && prev.version) || 0) + 1 };
  const igual = prev && prev.tipo === doc.tipo && s(prev.motivo) === doc.motivo;
  const hist = igual ? null : { clave: doc.clave, item: doc.item, antes: prev ? { tipo: prev.tipo, motivo: s(prev.motivo) } : null, despues: { tipo: doc.tipo, motivo: doc.motivo }, origen: doc.origen, fecha: hoy, por };
  return { doc, hist, igual: !!igual };
}
// v0.102.0 · El texto de una línea: su cuenta (con el catálogo) o su tipo
export const textoLinea = (tipo, cuenta, motivo) => (cuenta ? PC.texto(cuenta) : textoTipo(tipo, motivo));
export const textoTipo = (tipo, motivo) => (TIPO[tipo] ? TIPO[tipo].t + (tipo === 'otro_fuera' && motivo ? `: ${motivo}` : '') : 'Sin clasificar');

// ── 3. Créditos ──
const r0 = v => Math.round(v);
// Cuota fija (sistema francés), redondeada al peso. tasa = % mensual (1,5 = 1,5 %)
export function cuotaFrancesa(monto, tasaPct, n) {
  const P = num(monto), i = num(tasaPct) / 100, N = Math.round(num(n));
  if (!(P > 0) || !(N > 0)) return 0;
  if (!(i > 0)) return r0(P / N);
  return r0(P * i / (1 - Math.pow(1 + i, -N)));
}
// v0.62.0 · La tasa desde la cuota: monto, n° de cuotas y valor de la cuota → tasa mensual del sistema francés.
// Se busca i tal que monto × i ÷ (1 − (1 + i)^−n) = cuota (la cuota crece con la tasa: una sola solución). Bisección
// (robusta, no se pierde) y al final unos pasos de Newton para afinar. → { tasa (% mensual), anual (% efectiva anual), cuotaCalc }
export function tasaDesdeCuota(monto, n, cuota) {
  const P = num(monto), N = Math.round(num(n)), C = num(cuota);
  if (!(P > 0)) throw new Error('Escribe el monto del crédito');
  if (!(N > 0) || N > 600) throw new Error('Escribe el número de cuotas (1 a 600)');
  if (!(C > 0)) throw new Error('Escribe el valor de la cuota');
  if (C * N < P - 0.5) throw new Error(`Las ${N} cuotas suman ${Math.round(C * N).toLocaleString('es-CL')}, menos que el monto: revisa los datos (la tasa saldría negativa).`);
  if (N === 1) { const i = C / P - 1; return { tasa: i * 100, anual: (Math.pow(1 + i, 12) - 1) * 100, cuotaCalc: Math.round(C) }; }
  const f = i => (i <= 1e-12 ? P / N : P * i / (1 - Math.pow(1 + i, -N))) - C;
  if (Math.abs(f(0)) < 1e-9 || f(0) >= 0) return { tasa: 0, anual: 0, cuotaCalc: Math.round(P / N) };
  let lo = 0, hi = 0.05;
  while (f(hi) < 0 && hi < 50) hi *= 2;
  if (f(hi) < 0) throw new Error('La cuota es demasiado alta para ese monto: revisa los datos.');
  for (let k = 0; k < 200 && hi - lo > 1e-15; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  let i = (lo + hi) / 2;
  for (let k = 0; k < 5; k++) {
    const h = Math.max(1e-10, i * 1e-6), d = (f(i + h) - f(i - h)) / (2 * h);
    if (!(Math.abs(d) > 0)) break;
    const x = i - f(i) / d; if (!(x > lo - 1e-9 && x < hi + 1e-9)) break; i = x;
  }
  if (num(i * 100) > 20) throw new Error(`La tasa saldría ${(i * 100).toFixed(2).replace('.', ',')} % mensual (más de 20 %): revisa los datos.`);
  return { tasa: i * 100, anual: (Math.pow(1 + i, 12) - 1) * 100, cuotaCalc: cuotaFrancesa(P, i * 100, N) };
}
// Suma meses a una fecha aaaa-mm-dd manteniendo el día (si el mes es más corto, el último día del mes)
export function sumarMeses(fecha, k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(fecha)); if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]) - 1 + k, d = Number(m[3]);
  const yy = y + Math.floor(mo / 12), mm = ((mo % 12) + 12) % 12, ult = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`;
}
// Tabla de amortización francesa: interés = saldo × tasa (al peso), capital = cuota − interés; la última cuota paga el saldo que quede.
// cuota: si viene (la del banco), se usa esa; si no, la calculada.
export function tablaFrancesa({ monto, tasa, n, fechaPrimera, cuota } = {}) {
  const P = r0(num(monto)), i = num(tasa) / 100, N = Math.round(num(n));
  if (!(P > 0)) throw new Error('Escribe el monto del crédito');
  if (!(N > 0) || N > 600) throw new Error('Escribe el número de cuotas (1 a 600)');
  if (num(tasa) < 0 || num(tasa) > 20) throw new Error('La tasa mensual debe estar entre 0 y 20 %');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s(fechaPrimera))) throw new Error('Elige la fecha de la primera cuota');
  const C = num(cuota) > 0 ? r0(num(cuota)) : cuotaFrancesa(P, tasa, N);
  const filas = []; let saldo = P;
  for (let k = 1; k <= N; k++) {
    const interes = r0(saldo * i);
    let capital = C - interes, c = C;
    if (k === N || capital >= saldo) { capital = saldo; c = interes + capital; }
    if (capital < 0) capital = 0;
    saldo -= capital;
    filas.push({ n: k, fecha: sumarMeses(fechaPrimera, k - 1), cuota: c, interes, capital, saldo });
    if (saldo <= 0) break;
  }
  return filas;
}
// Números como los escribe el banco: "1.234.567", "$ 12.345", "1.234,56", "1,5 %", "12345.5"
export function numeroCL(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let t = s(v).trim().replace(/\$|%|\s|CLP/gi, '');
  if (!t) return NaN;
  const neg = /^-|^\(.*\)$/.test(t); t = t.replace(/[()-]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  const n = Number(t);
  return isFinite(n) ? (neg ? -n : n) : NaN;
}
export function fechaCL(v) {
  const t = s(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}
// Tabla pegada (de la planilla o del PDF del banco): una cuota por línea, columnas N°, fecha, cuota, interés, capital, saldo
// separadas por tabulador, punto y coma o 2+ espacios. Las líneas que no empiezan con un número (encabezados) se saltan.
// Si falta el capital, capital = cuota − interés. Avisa si cuota ≠ interés + capital (más de $2) o si el saldo no cuadra.
export function parsearTabla(texto) {
  const filas = [], avisos = [], saltadas = [];
  s(texto).split(/\r?\n/).forEach((linea, k) => {
    const l = linea.trim(); if (!l) return;
    // Con tabulador o punto y coma se respetan las columnas vacías (capital o saldo sin dato); si no, 2+ espacios o espacios
    let cols = /\t|;/.test(l) ? l.split(/\t|;/).map(x => x.trim()) : l.split(/\s{2,}/).map(x => x.trim());
    if (cols.filter(x => x !== '').length < 4) cols = l.split(/\s+/);
    const n = numeroCL(cols[0]), fecha = fechaCL(cols[1]);
    if (!(n >= 1) || !Number.isInteger(n) || !fecha) { saltadas.push(k + 1); return; }
    const v = cols.slice(2).map(numeroCL);
    let [cuota, interes, capital, saldo] = v;
    if (!isFinite(cuota) || !isFinite(interes)) { avisos.push(`Línea ${k + 1}: falta la cuota o el interés`); return; }
    if (!isFinite(capital)) capital = cuota - interes;
    if (Math.abs(cuota - interes - capital) > 2) avisos.push(`Cuota ${n}: cuota ${r0(cuota)} ≠ interés ${r0(interes)} + capital ${r0(capital)}`);
    filas.push({ n, fecha, cuota: r0(cuota), interes: r0(interes), capital: r0(capital), saldo: isFinite(saldo) ? r0(saldo) : null });
  });
  filas.sort((a, b) => a.n - b.n);
  filas.forEach((f, i) => { if (i && f.n === filas[i - 1].n) avisos.push(`La cuota ${f.n} está repetida`); });
  for (let i = 1; i < filas.length; i++) { const a = filas[i - 1], b = filas[i]; if (a.saldo !== null && b.saldo !== null && Math.abs(a.saldo - b.capital - b.saldo) > 2) avisos.push(`Cuota ${b.n}: el saldo no cuadra (${r0(a.saldo)} − ${r0(b.capital)} ≠ ${r0(b.saldo)})`); }
  return { filas, avisos, saltadas };
}
export function validarCredito(d) {
  const nombre = s(d.nombre).trim();
  if (!nombre) throw new Error('Escribe el nombre del crédito');
  const modo = d.modo === 'manual' ? 'manual' : 'frances';
  let tabla;
  if (modo === 'manual') {
    const p = Array.isArray(d.tabla) ? { filas: d.tabla, avisos: [] } : parsearTabla(d.texto);
    if (!p.filas.length) throw new Error('Pega la tabla: una cuota por línea (N°, fecha, cuota, interés, capital, saldo)');
    tabla = p.filas;
  } else tabla = tablaFrancesa(d);
  const monto = modo === 'manual' ? r0(num(d.monto) || tabla.reduce((a, f) => a + f.capital, 0)) : r0(num(d.monto));
  return { nombre: nombre.slice(0, 120), obligacionId: s(d.obligacionId), obligacionNombre: s(d.obligacionNombre).slice(0, 160), modo, monto,
    tasa: modo === 'manual' ? (num(d.tasa) || null) : num(d.tasa), n: tabla.length, fechaPrimera: tabla[0].fecha,
    cuota: modo === 'manual' ? (tabla[0] ? tabla[0].cuota : 0) : (num(d.cuota) > 0 ? r0(num(d.cuota)) : cuotaFrancesa(d.monto, d.tasa, d.n)), cuotaManual: modo !== 'manual' && num(d.cuota) > 0,
    tabla, nota: s(d.nota).trim().slice(0, 300) };
}
// Pagos de la obligación del crédito: vencimientos pagados (fecha del vencimiento, fecha de pago, monto pagado) + los gastos ligados.
// Cada pago se asigna a la cuota del mismo mes (por la fecha del vencimiento); si no hay, a la primera cuota sin pago, en orden.
export function pagosDeObligacion(obligacionId, vencs, gastos) {
  const id = s(obligacionId); if (!id) return [];
  const porVenc = {};
  (gastos || []).filter(vigente).forEach(g => { const v = s(g.vencimientoId); if (v) (porVenc[v] = porVenc[v] || []).push(g); });
  return (vencs || []).filter(v => v && !v.quitadoEnPlanilla && s(v.plantillaID || v.obligacionId) === id && /^pagado$/i.test(s(v.estado)))
    .map(v => {
      const gs = porVenc[s(v.id)] || [], montoG = gs.reduce((a, g) => a + num(g.montoFinal), 0);
      const fecha = fechaCL(s(v.fechaDocumento).slice(0, 10)) || fechaCL(s(v.fechaVencimiento).slice(0, 10));
      const fechaPago = fechaCL(s(v.fechaPago).slice(0, 10)) || (gs[0] ? fechaGasto(gs[0]) : '') || fecha;
      return { vencimientoId: s(v.id), fecha, fechaPago, monto: num(v.montoPago) || montoG || num(v.montoEstimado), gastos: gs.map(g => g.id || '').filter(Boolean) };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha));
}
export function marcarPagos(tabla, pagos) {
  const filas = (tabla || []).map(f => ({ ...f, pago: null })), libres = [];
  (pagos || []).forEach(p => {
    const f = filas.find(x => !x.pago && x.fecha.slice(0, 7) === s(p.fecha).slice(0, 7));
    if (f) f.pago = p; else libres.push(p);
  });
  libres.forEach(p => { const f = filas.find(x => !x.pago); if (f) f.pago = { ...p, porOrden: true }; });
  const pagadas = filas.filter(f => f.pago);
  return {
    filas, sobran: Math.max(0, libres.length - filas.filter(f => f.pago && f.pago.porOrden).length),
    resumen: { pagadas: pagadas.length, interes: pagadas.reduce((a, f) => a + f.interes, 0), capital: pagadas.reduce((a, f) => a + f.capital, 0),
      saldo: pagadas.length ? pagadas[pagadas.length - 1].saldo : (filas[0] ? filas[0].saldo + filas[0].capital : 0), dif: pagadas.reduce((a, f) => a + (num(f.pago.monto) - f.cuota), 0) }
  };
}
// Por mes de pago: interés (→ financiero) y capital (→ fuera del resultado)
export function creditoPorMes(filasMarcadas) {
  const r = {};
  (filasMarcadas || []).filter(f => f.pago).forEach(f => { const m = s(f.pago.fechaPago || f.fecha).slice(0, 7); const x = r[m] || (r[m] = { interes: 0, capital: 0, cuotas: 0 }); x.interes += f.interes; x.capital += f.capital; x.cuotas++; });
  return r;
}

// ── 4. Inversiones ──
export const VIDAS = [
  { k: 'computacion', t: 'Computación', meses: 36, re: /\b(COMPUTADOR(ES)?|COMPUTACION|NOTEBOOK|LAPTOP|IMPRESORA|TABLET|CELULAR|POS|PANTALLA|MONITOR|SOFTWARE)\b/ },
  { k: 'muebles', t: 'Muebles', meses: 84, re: /\b(MUEBLES?|MOBILIARIO|ESTANTES?|ESTANTERIA|MESAS?|SILLAS?|MESONES?|REPISAS?)\b/ },
  { k: 'remodelacion', t: 'Remodelación', meses: 120, re: /\b(REMODELACION|OBRAS?|CONSTRUCCION|HABILITACION|INSTALACION(ES)?|AMPLIACION)\b/ },
  { k: 'equipos', t: 'Equipos', meses: 60, re: null }
];
export function vidaDefecto(texto) {
  const n = normalizar(texto);
  const v = VIDAS.find(x => x.re && x.re.test(n)) || VIDAS[VIDAS.length - 1];
  return { meses: v.meses, clase: v.k, nombre: v.t };
}
export const mesDe = f => s(f).slice(0, 7);
export const mesMas = (m, k) => sumarMeses(m + '-01', k).slice(0, 7);
// Gastos clasificados como inversión (por su ítem) con su vida útil (guardada o por defecto) y la depreciación mensual
// v0.102.0 · Con el catálogo (g.catalogo), lo que es inversión lo dice la cuenta del ítem (1.5.x) y el área va tal cual (sin el mapa)
export const tipoDeGasto = (g, fin = {}) => (g && g.catalogo ? PC.tipoDeCuenta(g.cuenta) : ((fin || {})[claveItem(g && g.itemGasto)] || {}).tipo || '');
export function inversiones(gastos, fin = {}, guardadas = {}, mapa = {}) {
  return (gastos || []).filter(vigente).filter(g => tipoDeGasto(g, fin) === 'inversion').map(g => {
    const gu = guardadas[g.id] || null, texto = [g.itemGasto, g.observacion, g.razonSocial].map(s).join(' '), def = vidaDefecto(texto);
    const meses = gu && num(gu.vidaUtilMeses) > 0 ? Math.round(num(gu.vidaUtilMeses)) : def.meses;
    const inicio = (gu && /^\d{4}-\d{2}-\d{2}$/.test(s(gu.fechaInicio)) && gu.fechaInicio) || fechaGasto(g);
    const valor = netoGasto(g), lineas = lineasArea(g).map(l => ({ ...l, destino: destinoArea(l.area, g.catalogo ? {} : mapa) }));
    return { id: g.id, fecha: fechaGasto(g), item: s(g.itemGasto), detalle: s(g.observacion), proveedor: s(g.razonSocial), area: s(g.area), lineas, valor, meses, inicio,
      mensual: meses > 0 ? valor / meses : 0, defecto: def, guardada: !!gu, porDefecto: !(gu && num(gu.vidaUtilMeses) > 0), nota: s(gu && gu.nota), fin: mesMas(mesDe(inicio), meses - 1) };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.valor - a.valor);
}
// Depreciación del mes m de una inversión (desde el mes de inicio, durante "meses" meses)
export const deprMes = (inv, m) => (inv.meses > 0 && m >= mesDe(inv.inicio) && m <= inv.fin ? inv.valor / inv.meses : 0);
// Tabla por mes y destino (PAN, BOL, PAS, CAF, comun) para los meses pedidos; cada inversión se reparte según sus líneas por área
export function depreciacionPorMes(invs, meses) {
  const filas = (meses || []).map(m => {
    const f = { mes: m, total: 0 }; AREAS.concat('comun').forEach(a => { f[a] = 0; });
    (invs || []).forEach(inv => {
      const d = deprMes(inv, m); if (!d) return;
      const tot = inv.lineas.reduce((a, l) => a + l.neto, 0) || 1;
      inv.lineas.forEach(l => { f[l.destino] += d * l.neto / tot; });
      f.total += d;
    });
    return f;
  });
  return filas;
}
export function validarInversion(d) {
  const meses = Math.round(num(d.vidaUtilMeses));
  if (!(meses >= 1 && meses <= 600)) throw new Error('La vida útil va de 1 a 600 meses');
  const fechaInicio = s(d.fechaInicio);
  if (fechaInicio && !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) throw new Error('Revisa la fecha de inicio');
  return { vidaUtilMeses: meses, fechaInicio, nota: s(d.nota).trim().slice(0, 200) };
}
