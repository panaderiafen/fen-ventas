// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas F2 paso 2: margen de contribución (funciones puras)  v0.60.0
//  Sin Firebase ni pantalla. Modelo acordado (finanzas-plan.md, sección 1): todo en NETO; margen sobre el precio neto;
//  el precio se arma con el costo directo + el margen de contribución objetivo del área; lo indirecto entra a nivel de área,
//  nunca repartido por unidad.
//
//  Margen de contribución (MC) = venta neta − costo directo − costos variables de venta.
//   · Costo directo: receta → costo por unidad (costos_recetas) × unidades (vendido × unidades por venta);
//                    reventa → costo de compra neto (fin_productos.costoReventaNeto) × unidades.
//                    + costo extra por venta (envases que no están en la receta, fin_productos.costoExtraNeto, neto).
//   · Costos de venta: caja → comisión de tarjeta (% sobre lo PAGADO, con IVA, por medio de pago; la comisión se configura
//                    neta, su IVA es crédito fiscal) = venta neta × 1,19 × Σ (parte del medio × comisión del medio).
//                    B2B → despacho: % de la venta neta, o $ por orden repartido según la venta neta de cada producto.
//   · MC % = MC ÷ venta neta.
//  Costo del mes: el último valor del historial (costos_recetas_hist) hasta el último día de ese mes; el mes en curso usa el
//  costo de hoy; si no hay historial de ese mes, el costo de hoy (y se dice).
//
//  Config (costos_config/finanzas, campo "margenes"):
//   { comision: { debito, credito, otros } (% o null = falta configurar), mixCaja: { debito, credito, otros } (% o null),
//     despacho: { modo: 'pct'|'orden', valor }, margenObjetivo: { PAN, BOL, PAS, CAF, REVENTA } (% o null), redondeo: 10|50|100 }
//  v0.69.1: área REVENTA (las de margen salen de areas.js): una reventa sin área cuenta en REVENTA; la elegida se respeta.
// ═══════════════════════════════════════════════
import { AREAS, NOMBRE_AREA, SUCS, canalDeSuc, claveProducto, upv, mesDe, ultimoDia, areaVinculo, vinculoDeLinea, esPendiente } from './finanzas-ventas.js?v=0.138.0';
// v0.80.1 · Receta pendiente (Catálogo): una fila por producto (tipo 'pendiente', clave 'p:…') en su área, sin costo directo
export const MOTIVO_PENDIENTE = 'sin costo (receta pendiente)';

export const IVA = 0.19;
export const TOLERANCIA = 5;           // % de diferencia con el precio sugerido que todavía es "OK"
export const REDONDEOS = [10, 50, 100];
export const MEDIOS = ['debito', 'credito', 'otros'];
export const NOMBRE_MEDIO = { debito: 'Débito', credito: 'Crédito', otros: 'Otros' };
export const CUADRANTES = ['estrella', 'volumen', 'potencial', 'revisar'];
export const NOMBRE_CUADRANTE = { estrella: 'Estrellas', volumen: 'De volumen', potencial: 'Con potencial', revisar: 'Revisar' };
export const GUIA_CUADRANTE = {
  estrella: 'Mucho volumen y buen margen. Cuídalos: calidad pareja, siempre disponibles y bien a la vista. No los toques de precio sin pensarlo.',
  volumen: 'Se venden mucho pero dejan poco por unidad. Revisa el costo (receta, merma, envase) o sube el precio de a poco; son los que más mueven el margen total.',
  potencial: 'Dejan buen margen pero se venden poco. Dales vitrina, recomiéndalos, pruébalos en otra sucursal o en B2B.',
  revisar: 'Poco volumen y bajo margen. Mejora la receta o el precio, o piensa en sacarlos si no cumplen otro rol (completar la vitrina, un cliente B2B).'
};

const s = v => (v === null || v === undefined ? '' : String(v));
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const red = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const pctONull = v => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));

// ── Configuración ──
export function configMargenes(raw) {
  const r = raw || {};
  const c = r.comision || {}, m = r.mixCaja || {}, d = r.despacho || {}, o = r.margenObjetivo || {};
  return {
    comision: { debito: pctONull(c.debito), credito: pctONull(c.credito), otros: pctONull(c.otros) },
    mixCaja: { debito: pctONull(m.debito), credito: pctONull(m.credito), otros: pctONull(m.otros) },
    despacho: { modo: d.modo === 'orden' ? 'orden' : 'pct', valor: Math.max(0, num(d.valor)) },
    margenObjetivo: Object.fromEntries(AREAS.map(a => [a, pctONull(o[a])])),
    redondeo: REDONDEOS.includes(Number(r.redondeo)) ? Number(r.redondeo) : 10
  };
}
export const comisionConfigurada = cfg => MEDIOS.every(k => cfg.comision[k] !== null);
export const mixConfigurado = cfg => MEDIOS.some(k => cfg.mixCaja[k] !== null);
// Valida y arma lo que se guarda (lanza Error con un texto claro)
export function validarConfig(datos) {
  const p = (v, nom, max = 100) => {
    if (v === null || v === undefined || s(v).trim() === '') return null;
    const x = Number(s(v).replace(',', '.'));
    if (!(x >= 0 && x <= max)) throw new Error(`${nom}: un número entre 0 y ${max}.`);
    return red(x, 3);
  };
  const out = {
    comision: Object.fromEntries(MEDIOS.map(k => [k, p((datos.comision || {})[k], `Comisión ${NOMBRE_MEDIO[k].toLowerCase()}`, 20)])),
    mixCaja: Object.fromEntries(MEDIOS.map(k => [k, p((datos.mixCaja || {})[k], `Parte de la venta en ${NOMBRE_MEDIO[k].toLowerCase()}`)])),
    despacho: { modo: (datos.despacho || {}).modo === 'orden' ? 'orden' : 'pct', valor: 0 },
    margenObjetivo: Object.fromEntries(AREAS.map(a => [a, p((datos.margenObjetivo || {})[a], `Margen objetivo de ${NOMBRE_AREA[a]}`, 95)])),
    redondeo: REDONDEOS.includes(Number(datos.redondeo)) ? Number(datos.redondeo) : 10
  };
  const dv = s((datos.despacho || {}).valor).trim();
  if (dv) {
    const x = Number(dv.replace(',', '.'));
    if (!(x >= 0) || (out.despacho.modo === 'pct' && x > 50)) throw new Error(out.despacho.modo === 'pct' ? 'Despacho B2B: un % entre 0 y 50.' : 'Despacho B2B: un monto en pesos (0 o más).');
    out.despacho.valor = red(x, 2);
  }
  const mix = MEDIOS.reduce((a, k) => a + (out.mixCaja[k] || 0), 0);
  if (mix > 100) throw new Error('La mezcla de medios de pago de la caja suma más de 100 %.');
  return out;
}

// ── Medios de pago de la caja ──
// resúmenes de cierre → { barros: { efectivo, debito, credito, transferencia… }, ainavillo: {…} } (bruto, lo pagado)
export function mediosDeResumenes(resumenes, sucursalDe = x => (/ainavillo/i.test(s(x)) ? 'ainavillo' : 'barros')) {
  const M = {};
  (resumenes || []).forEach(r => {
    if (!r || !r.porMedio) return;
    const suc = sucursalDe(r.sucursal), x = M[suc] || (M[suc] = {});
    Object.entries(r.porMedio).forEach(([k, v]) => { x[k] = (x[k] || 0) + num(v); });
  });
  return M;
}
export function sumarMedios(...ms) {
  const out = {};
  ms.filter(Boolean).forEach(m => Object.entries(m).forEach(([suc, x]) => { const y = out[suc] || (out[suc] = {}); Object.entries(x || {}).forEach(([k, v]) => { y[k] = (y[k] || 0) + num(v); }); }));
  return out;
}
const grupoMedio = k => (k === 'efectivo' ? 'efectivo' : k === 'debito' ? 'debito' : k === 'credito' ? 'credito' : 'otros');
// Tasa de comisión de la caja (fracción de lo PAGADO, con IVA) para un juego de medios (bruto por medio).
// → { tasa, fuente: 'caja' (de los resúmenes) | 'mezcla' (la configurada) | 'sin', partes { efectivo, debito, credito, otros } (fracciones) }
export function tasaComision(medios, cfg) {
  const com = k => (cfg.comision[k] || 0) / 100;
  const tot = Object.values(medios || {}).reduce((a, v) => a + Math.max(0, num(v)), 0);
  let partes, fuente;
  if (tot > 0) {
    partes = { efectivo: 0, debito: 0, credito: 0, otros: 0 };
    Object.entries(medios).forEach(([k, v]) => { partes[grupoMedio(k)] += Math.max(0, num(v)) / tot; });
    fuente = 'caja';
  } else if (mixConfigurado(cfg)) {
    const d = (cfg.mixCaja.debito || 0) / 100, c = (cfg.mixCaja.credito || 0) / 100, o = (cfg.mixCaja.otros || 0) / 100;
    partes = { efectivo: Math.max(0, 1 - d - c - o), debito: d, credito: c, otros: o };
    fuente = 'mezcla';
  } else return { tasa: 0, fuente: 'sin', partes: null };
  return { tasa: red(MEDIOS.reduce((a, k) => a + partes[k] * com(k), 0), 8), fuente, partes };
}
// Comisión en pesos para una venta neta de la caja: neto × 1,19 × tasa
export const comisionDe = (neto, tasa) => num(neto) * (1 + IVA) * num(tasa);

// ── Costo directo: el de hoy o el del mes (desde el historial) ──
// docs: costos_recetas { id: { costoUnit, unidad, incompleto, aprobada } }; histPorReceta: { id: [entradas] }
export function histPorReceta(hist) { const o = {}; (hist || []).forEach(h => { if (h && h.receta) (o[h.receta] || (o[h.receta] = [])).push(h); }); return o; }
const ordenH = (a, b) => s(a.fecha).localeCompare(s(b.fecha)) || s(a.cuando).localeCompare(s(b.cuando));
// → { costoUnit, unidad, fuente: 'hoy'|'mes'|'hoy_sin_hist', fecha, incompleto (lista) } | null (sin costo)
export function costoReceta(recetaId, mes, docs, hpr, { hoy, modo = 'mes' } = {}) {
  const d = (docs || {})[recetaId];
  if (!d) return null;
  const inc = Array.isArray(d.incompleto) ? d.incompleto : (d.incompleto ? ['costo incompleto'] : []);
  const hoyRes = { costoUnit: num(d.costoUnit), unidad: d.unidad === 'g' ? 'g' : 'un', fuente: 'hoy', fecha: s(d.fecha || d.calculadoEn).slice(0, 10), incompleto: inc };
  if (modo !== 'mes' || !mes || mes >= mesDe(hoy)) return hoyRes;
  const fin = ultimoDia(mes), xs = ((hpr || {})[recetaId] || []).slice().sort(ordenH);
  const antes = xs.filter(h => s(h.fecha) <= fin);
  if (antes.length) { const h = antes[antes.length - 1]; return { ...hoyRes, costoUnit: num(h.nuevo), fuente: 'mes', fecha: s(h.fecha), incompleto: h.incompleto ? (inc.length ? inc : ['costo incompleto ese mes']) : [] }; }
  const desp = xs.find(h => s(h.fecha) > fin && h.anterior !== null && h.anterior !== undefined);
  if (desp) return { ...hoyRes, costoUnit: num(desp.anterior), fuente: 'mes', fecha: fin, incompleto: [] };
  return { ...hoyRes, fuente: 'hoy_sin_hist' };
}

// ── Margen de contribución por producto ──
// meses: [{ mes, lineas: [líneas de venta], medios: { barros: {…}, ainavillo: {…} } | null, ordenes: n B2B válidas }]
// vinculos: fin_productos; costos: { docs, hist }; cfg: configMargenes(); opciones: { hoy, modo: 'mes'|'hoy', canal: 'todos'|suc }
// → { filas, totales, fuentesCosto, comision: { porMes } }
// v0.74.0: opciones.maestro (finanzas.maestroFinanzas): el vínculo de cada línea sale de su foto → del maestro (desde vigenteDesde)
// → de fin_productos (finanzas-ventas.vinculoDeLinea). Los cargos (tipo 'cargo': despacho) no son margen de un producto: van aparte
// en cargos { total, porSuc, lineas } (el estado de resultados los muestra como un ingreso del canal B2B).
export function calcularMargenes(meses, vinculos, costos, cfg, { hoy, modo = 'mes', canal = 'todos', maestro = null } = {}) {
  const docs = (costos && costos.docs) || {}, hpr = histPorReceta(costos && costos.hist);
  const F = {}, fuentes = { hoy: 0, mes: 0, hoy_sin_hist: 0 }, tasas = [];
  const cargos = { total: 0, porSuc: {}, lineas: [] };
  vinculos = vinculos || {};
  (meses || []).forEach(M => {
    const lineas = (M.lineas || []);
    const vDe = l => vinculoDeLinea(l, vinculos, maestro, M.mes);
    // Venta neta B2B del mes (sin "no es un producto" ni cargos), para repartir el despacho por orden
    const netoB2b = lineas.filter(l => l.suc === 'b2b').filter(l => { const v = vDe(l); return !(v && (v.tipo === 'ignorar' || v.tipo === 'cargo')); }).reduce((a, l) => a + num(l.neto), 0);
    const despachoMes = cfg.despacho.modo === 'orden' ? cfg.despacho.valor * num(M.ordenes) : 0;
    const tasaSuc = {};
    ['barros', 'ainavillo'].forEach(sc => { tasaSuc[sc] = tasaComision(M.medios && M.medios[sc], cfg); });
    tasas.push({ mes: M.mes, barros: tasaSuc.barros, ainavillo: tasaSuc.ainavillo });
    lineas.forEach(l => {
      if (canal !== 'todos' && l.suc !== canal) return;
      const cn = canalDeSuc(l.suc), clave = claveProducto(cn, l.productoId), v = vDe(l);
      if (v && v.tipo === 'ignorar') return;
      if (v && v.tipo === 'cargo') {
        const n = num(l.neto); cargos.total += n; cargos.porSuc[l.suc] = (cargos.porSuc[l.suc] || 0) + n;
        const x = cargos.lineas.find(y => y.clave === clave && y.suc === l.suc);
        if (x) { x.neto += n; x.cantidad += num(l.cantidad); } else cargos.lineas.push({ clave, suc: l.suc, nombre: s(l.nombre), catalogoId: s(v.catalogoId), neto: n, cantidad: num(l.cantidad) });
        return;
      }
      const tipo = esPendiente(v) ? 'pendiente' : v && (v.tipo === 'receta' || v.tipo === 'reventa') ? v.tipo : 'sin';
      const k = tipo === 'receta' ? 'r:' + v.receta : (tipo === 'reventa' ? 'v:' : tipo === 'pendiente' ? 'p:' : 's:') + clave;
      const u = upv(v), cant = num(l.cantidad), unidades = cant * u, neto = num(l.neto);
      const f = F[k] || (F[k] = { clave: k, tipo, nombre: tipo === 'receta' ? (v.recetaNombre || v.receta) : s(l.nombre), area: areaVinculo(v), receta: tipo === 'receta' ? v.receta : null,
        productoClave: tipo === 'receta' ? null : clave, unidad: 'un', fuentes: {}, porSuc: {}, cantidad: 0, unidades: 0, neto: 0, costo: 0, comision: 0, despacho: 0, extra: 0, motivos: new Set(), fuenteCosto: new Set() });
      f.fuentes[clave] = { nombre: s(l.nombre), canal: cn, productoId: l.productoId, unidadesPorVenta: u };
      if (tipo === 'pendiente' && !f.catalogoId) f.catalogoId = s(v.catalogoId);
      // Costo directo
      let cu = null;
      if (tipo === 'receta') {
        const c = costoReceta(v.receta, M.mes, docs, hpr, { hoy, modo });
        if (!c) f.motivos.add('sin costo calculado');
        else {
          f.unidad = c.unidad; fuentes[c.fuente]++; f.fuenteCosto.add(c.fuente);
          if (!(c.costoUnit > 0)) f.motivos.add('costo 0');
          if (c.incompleto.length) f.motivos.add('costo incompleto: ' + c.incompleto[0]);
          cu = c.costoUnit;
        }
      } else if (tipo === 'reventa') {
        if (v.costoReventaNeto === null || v.costoReventaNeto === undefined || s(v.costoReventaNeto) === '') f.motivos.add('reventa sin costo de compra');
        else cu = num(v.costoReventaNeto);
      } else if (tipo === 'pendiente') f.motivos.add(MOTIVO_PENDIENTE);
      else f.motivos.add('sin asociar');
      const extra = v ? num(v.costoExtraNeto) * cant : 0;   // por venta (una caja de 6 lleva una caja)
      const costo = (cu || 0) * unidades + extra;
      // Costos de venta
      let comision = 0, despacho = 0;
      if (l.suc === 'b2b') despacho = cfg.despacho.modo === 'pct' ? neto * cfg.despacho.valor / 100 : (netoB2b > 0 ? despachoMes * neto / netoB2b : 0);
      else comision = comisionDe(neto, tasaSuc[l.suc] ? tasaSuc[l.suc].tasa : 0);
      const ps = f.porSuc[l.suc] || (f.porSuc[l.suc] = { cantidad: 0, unidades: 0, neto: 0, costo: 0, comision: 0, despacho: 0 });
      ps.cantidad += cant; ps.unidades += unidades; ps.neto += neto; ps.costo += costo; ps.comision += comision; ps.despacho += despacho;
      f.cantidad += cant; f.unidades += unidades; f.neto += neto; f.costo += costo; f.comision += comision; f.despacho += despacho; f.extra += extra;
    });
  });
  const filas = Object.values(F).map(f => {
    const costoVenta = f.comision + f.despacho, mc = f.neto - f.costo - costoVenta;
    const ok = !f.motivos.size;
    const fac = f.unidad === 'g' ? 1000 : 1;   // recetas que rinden gramos: se leen por kg
    const ul = f.unidades / fac;
    Object.values(f.porSuc).forEach(x => { x.mc = x.neto - x.costo - x.comision - x.despacho; });
    return { ...f, motivos: [...f.motivos], fuenteCosto: [...f.fuenteCosto], fuentes: Object.values(f.fuentes), ok, costoVenta, mc, mcPct: f.neto > 0 ? mc / f.neto * 100 : null,
      lectura: f.unidad === 'g' ? 'kg' : 'un', unidadesL: red(ul, 3), precioUnit: ul > 0 ? f.neto / ul : null, costoUnit: ul > 0 ? f.costo / ul : null, mcUnit: ul > 0 ? mc / ul : null };
  }).filter(f => f.neto !== 0 || f.cantidad !== 0);
  const conCosto = filas.filter(f => f.ok), mcTotal = conCosto.reduce((a, f) => a + f.mc, 0);
  filas.forEach(f => { f.pctMcTotal = f.ok && mcTotal ? f.mc / mcTotal * 100 : null; });
  return { filas, totales: totalesMargen(filas), fuentes, tasas, cargos };
}
// v0.123.0 · La merma de la tienda (lo que sobró y la caja registró como merma: fen-ventas merma) valorizada igual que el costo directo de
// lo vendido: el vínculo de cada producto de la caja (foto → maestro → fin_productos) y el costo de su receta en ese mes (o el costo de compra
// de la reventa). registros: [{ sucursal, productoId, nombreProducto, cantidad }]. → { detalle: [{ area, nombre, neto, cantidad, suc }], sinCosto, unidadesSinCosto }
export function costearMermaTienda(registros, mes, vinculos, costos, { hoy, maestro = null } = {}) {
  const docs = (costos && costos.docs) || {}, hpr = histPorReceta(costos && costos.hist), F = {};
  let sinCosto = 0, unidadesSinCosto = 0;
  (registros || []).forEach(r => {
    const suc = /ainavillo/i.test(s(r.sucursal)) ? 'ainavillo' : 'barros', cant = num(r.cantidad);
    if (!(cant > 0)) return;
    const l = { suc, productoId: s(r.productoId), nombre: s(r.nombreProducto), cantidad: cant }, v = vinculoDeLinea(l, vinculos || {}, maestro, mes);
    let cu = null;
    if (v && v.tipo === 'receta' && !esPendiente(v)) { const c = costoReceta(v.receta, mes, docs, hpr, { hoy, modo: 'mes' }); if (c && c.costoUnit > 0) cu = c.costoUnit; }
    else if (v && v.tipo === 'reventa' && s(v.costoReventaNeto) !== '' && num(v.costoReventaNeto) > 0) cu = num(v.costoReventaNeto);
    if (cu === null) { sinCosto++; unidadesSinCosto += cant; return; }
    const k = suc + '|' + (v.tipo === 'receta' ? 'r:' + v.receta : 'v:' + l.productoId);
    const f = F[k] || (F[k] = { area: areaVinculo(v), nombre: (v.tipo === 'receta' ? (v.recetaNombre || v.receta) : l.nombre) + ' (sobró en la tienda)', neto: 0, cantidad: 0, suc });
    f.neto += cu * cant * upv(v); f.cantidad += cant;
  });
  return { detalle: Object.values(F).map(f => ({ ...f, neto: Math.round(f.neto), cantidad: red(f.cantidad, 3) })).filter(f => f.neto), sinCosto, unidadesSinCosto: red(unidadesSinCosto, 3) };
}
const vacioT = () => ({ neto: 0, costo: 0, comision: 0, despacho: 0, costoVenta: 0, mc: 0, mcPct: null, n: 0 });
const cerrar = t => ({ ...t, costoVenta: t.comision + t.despacho, mc: t.neto - t.costo - t.comision - t.despacho, mcPct: t.neto > 0 ? (t.neto - t.costo - t.comision - t.despacho) / t.neto * 100 : null });
// Totales (solo productos con costo) por área y por canal; lo excluido (sin costo, incompleto, sin asociar) aparte, con la cobertura
export function totalesMargen(filas) {
  const total = vacioT(), porArea = Object.fromEntries(AREAS.map(a => [a, vacioT()])), porSuc = Object.fromEntries(SUCS.map(x => [x, vacioT()]));
  let excluido = 0, nExcluido = 0, todo = 0;
  (filas || []).forEach(f => {
    todo += f.neto;
    if (!f.ok) { excluido += f.neto; nExcluido++; return; }
    const add = (t, x) => { t.neto += x.neto; t.costo += x.costo; t.comision += x.comision; t.despacho += x.despacho; };
    add(total, f); total.n++;
    if (porArea[f.area]) { add(porArea[f.area], f); porArea[f.area].n++; }
    Object.entries(f.porSuc).forEach(([sc, x]) => { if (porSuc[sc]) { add(porSuc[sc], x); porSuc[sc].n++; } });
  });
  return { total: cerrar(total), porArea: Object.fromEntries(Object.entries(porArea).map(([k, t]) => [k, cerrar(t)])), porSuc: Object.fromEntries(Object.entries(porSuc).map(([k, t]) => [k, cerrar(t)])),
    excluido, nExcluido, todo, coberturaPct: todo > 0 ? (todo - excluido) / todo * 100 : null };
}
export const ORDENES_MC = [['mc', 'Mayor MC total'], ['mcPct', 'Mayor MC %'], ['mcPctAsc', 'Menor MC %'], ['unidades', 'Más unidades'], ['neto', 'Mayor venta'], ['nombre', 'Nombre']];
export function ordenarMargen(filas, orden = 'mc') {
  const v = x => (x === null || x === undefined ? -Infinity : x);
  const cmp = { mc: (a, b) => b.mc - a.mc, mcPct: (a, b) => v(b.mcPct) - v(a.mcPct), mcPctAsc: (a, b) => (a.mcPct ?? Infinity) - (b.mcPct ?? Infinity), unidades: (a, b) => b.unidadesL - a.unidadesL, neto: (a, b) => b.neto - a.neto }[orden];
  return filas.slice().sort((a, b) => (cmp ? cmp(a, b) : 0) || s(a.nombre).localeCompare(s(b.nombre), 'es'));
}

// ── Matriz volumen × margen (ingeniería de menú) ──
// Ejes: unidades vendidas en el período y MC unitario en $ (el eje clásico). Cortes: el promedio de unidades del área
// (promedio simple entre sus productos) y el MC unitario promedio del área ponderado por unidades (MC total ÷ unidades totales).
// Solo productos con costo y unidades > 0. Las recetas que rinden gramos se miden en kg.
export function cuadrante(unidades, mcUnit, volProm, mcProm) {
  const alto = unidades >= volProm, bueno = mcUnit >= mcProm;
  return alto && bueno ? 'estrella' : alto ? 'volumen' : bueno ? 'potencial' : 'revisar';
}
export function matriz(filas, area) {
  const xs = (filas || []).filter(f => f.ok && f.area === area && f.unidadesL > 0);
  if (!xs.length) return { area, puntos: [], volProm: 0, mcProm: 0, grupos: Object.fromEntries(CUADRANTES.map(c => [c, []])) };
  const volProm = xs.reduce((a, f) => a + f.unidadesL, 0) / xs.length;
  const mcProm = xs.reduce((a, f) => a + f.mc, 0) / xs.reduce((a, f) => a + f.unidadesL, 0);
  const puntos = xs.map(f => ({ ...f, cuadrante: cuadrante(f.unidadesL, f.mcUnit, volProm, mcProm) }));
  const grupos = Object.fromEntries(CUADRANTES.map(c => [c, ordenarMargen(puntos.filter(p => p.cuadrante === c), 'mc')]));
  return { area, puntos, volProm, mcProm, grupos };
}

// ── Precio sugerido ──
export const margenARecargo = m => (num(m) >= 1 ? null : num(m) / (1 - num(m)));
export const recargoAMargen = r => (num(r) <= -1 ? null : num(r) / (1 + num(r)));
// costoUnit neto; margen y costoVenta como fracción del precio neto. Precio neto = costo ÷ (1 − margen − costos de venta %):
// así, después de la comisión o el despacho, el MC % queda justo en el objetivo. Con IVA: × 1,19 redondeado HACIA ARRIBA al múltiplo.
export function precioSugerido(costoUnit, margen, costoVenta = 0, { redondeo = 0 } = {}) {
  const den = 1 - num(margen) - num(costoVenta);
  if (!(num(costoUnit) > 0) || !(den > 1e-9)) return null;
  const neto = num(costoUnit) / den, conIva = neto * (1 + IVA);
  const r = num(redondeo) > 0 ? Math.ceil(Math.round(conIva * 100) / 100 / redondeo) * redondeo : Math.round(conIva);
  return { neto, conIva, conIvaRedondeado: r, netoRedondeado: r / (1 + IVA) };
}
export function comparar(actual, sugerido, tol = TOLERANCIA) {
  if (!(num(actual) > 0) || !(num(sugerido) > 0)) return null;
  const pct = (num(actual) - num(sugerido)) / num(sugerido) * 100;
  return { pct, estado: pct < -tol ? 'bajo' : pct > tol ? 'sobre' : 'ok' };
}
// Filas de "Precio sugerido": productos con costo (costo de HOY), por canal.
// kCaja / kB2b: costos de venta como fracción del precio neto. catalogo: { caja: { productoId: { precio (con IVA) } }, b2b: { id: { precioBase (neto) } } }
export function tablaPrecios(filas, docs, cfg, { kCaja = 0, kB2b = 0, catalogo = {}, vinculos = {} } = {}) {
  return (filas || []).filter(f => f.ok && (f.tipo === 'receta' || f.tipo === 'reventa')).map(f => {
    const mObj = cfg.margenObjetivo[f.area];
    const fac = f.unidad === 'g' ? 1000 : 1;
    let costoHoy = null;
    if (f.tipo === 'receta') { const d = docs[f.receta]; costoHoy = d ? num(d.costoUnit) * fac : null; }
    else { const v = vinculos[f.productoClave]; costoHoy = v ? num(v.costoReventaNeto) : null; }
    // costo extra (envase) por unidad: el del primer vínculo que lo tenga
    const extraU = (() => { for (const k of Object.keys(f.fuentesClaves || {})) { const v = vinculos[k]; if (v && num(v.costoExtraNeto) > 0) return num(v.costoExtraNeto) / upv(v) * fac; } return 0; })();
    const costo = costoHoy === null ? null : costoHoy + extraU;
    const m = mObj === null ? null : mObj / 100;
    const caja = f.porSuc.barros || f.porSuc.ainavillo, b2b = f.porSuc.b2b;
    const uCaja = ['barros', 'ainavillo'].reduce((a, sc) => a + (f.porSuc[sc] ? f.porSuc[sc].unidades : 0), 0) / fac;
    const nCaja = ['barros', 'ainavillo'].reduce((a, sc) => a + (f.porSuc[sc] ? f.porSuc[sc].neto : 0), 0);
    // Precio de lista de la caja (con IVA) por unidad de la receta: del producto de la caja con 1 unidad por venta (o el primero)
    let lista = null;
    const fc = (f.listaCaja || []).sort((a, b) => (a.u === 1 ? -1 : 0) - (b.u === 1 ? -1 : 0))[0];
    if (fc && num(fc.precio) > 0) lista = num(fc.precio) / fc.u * (f.unidad === 'g' ? 1000 : 1);
    const out = { clave: f.clave, nombre: f.nombre, area: f.area, tipo: f.tipo, lectura: f.lectura, costo, margen: m, recargo: m === null ? null : margenARecargo(m), canales: {} };
    if (caja) {
      const sug = m === null || costo === null ? null : precioSugerido(costo, m, kCaja, { redondeo: cfg.redondeo });
      const prom = uCaja > 0 ? nCaja / uCaja : null;
      out.canales.caja = { costoVenta: kCaja, sugerido: sug, actualNeto: prom, lista, vsProm: sug ? comparar(prom, sug.neto) : null, vsLista: sug && lista ? comparar(lista, sug.conIvaRedondeado) : null };
    }
    if (b2b) {
      const sug = m === null || costo === null ? null : precioSugerido(costo, m, kB2b);
      const prom = b2b.unidades > 0 ? b2b.neto / (b2b.unidades / fac) : null;
      out.canales.b2b = { costoVenta: kB2b, sugerido: sug, actualNeto: prom, vsProm: sug ? comparar(prom, sug.neto) : null };
    }
    return out;
  });
}
// Para tablaPrecios: agrega a cada fila los precios de lista de la caja y las claves de sus vínculos
export function conListas(filas, catalogoCaja = {}) {
  return (filas || []).map(f => {
    const listaCaja = [], fuentesClaves = {};
    (f.fuentes || []).forEach(x => {
      const pid = x.productoId;
      if (pid) fuentesClaves[claveProducto(x.canal, pid)] = true;
      if (x.canal === 'caja' && pid && catalogoCaja[pid]) listaCaja.push({ precio: catalogoCaja[pid].precio, u: x.unidadesPorVenta || 1 });
    });
    return { ...f, listaCaja, fuentesClaves };
  });
}
// Costos de venta como fracción del precio neto, desde lo calculado en el período: caja = comisión ÷ venta neta de la caja;
// B2B = despacho ÷ venta neta B2B (con % fijo: ese %). Sin venta de la caja: la mezcla configurada.
export function costosVentaPeriodo(tot, cfg) {
  const nc = tot.porSuc.barros.neto + tot.porSuc.ainavillo.neto, cc = tot.porSuc.barros.comision + tot.porSuc.ainavillo.comision;
  const kCaja = nc > 0 ? cc / nc : comisionDe(1, tasaComision(null, cfg).tasa);
  const kB2b = cfg.despacho.modo === 'pct' ? cfg.despacho.valor / 100 : (tot.porSuc.b2b.neto > 0 ? tot.porSuc.b2b.despacho / tot.porSuc.b2b.neto : 0);
  return { kCaja, kB2b };
}
