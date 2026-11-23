// ═══════════════════════════════════════════════
//  Sistema Fën — Producción → Recetas y Por revisar: reglas puras  v0.77.1
//  · Qué cambió entre dos versiones de una receta (o una receta vigente y su propuesta): ingredientes en gramos y en % de panadero
//    (la misma regla de Cocina: cocina/modelo.js → panadero), rendimiento, peso por unidad, pasos (cuántos), insumos, nombre y notas.
//  · El costo de una receta aprobada (costos_recetas de Finanzas) y su variación contra el costo anterior (costos_recetas_hist).
//  · Filtros y conteos de la lista de recetas (área, tipo, búsqueda, archivadas).
//  Sin lecturas ni pantallas: lo usan vista-prod-recetas.js y vista-produccion.js (y las pruebas).
// ═══════════════════════════════════════════════
import * as CM from './cocina/modelo.js?v=0.17.4';
import { coincide, normalizar } from './buscador.js?v=0.138.0';

export const AREAS = { PAN: 'Panadería', BOL: 'Bollería', PAS: 'Pastelería', CAF: 'Cafetería' };
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const red1 = v => Math.sign(v) * Math.round(Math.abs(v) * 10) / 10;   // simétrico: −6,25 → −6,3 (como +6,25 → +6,3)
export const numTxt = (v, d = 1) => (Math.round(num(v) * 10 ** d) / 10 ** d).toLocaleString('es-CL', { maximumFractionDigits: d });
export const gTxt = g => `${numTxt(g, 1)} g`;
export const pctTxt = p => (p === null || p === undefined || !isFinite(p) ? '—' : `${numTxt(p, 1)} %`);
export const pesos = v => '$' + Math.round(num(v)).toLocaleString('es-CL');
export const pesosD = v => '$' + (Math.round(num(v) * 10) / 10).toLocaleString('es-CL');
export const signoPct = p => (Math.abs(p) < 0.05 ? 'igual' : `${p > 0 ? '+' : '−'}${numTxt(Math.abs(p), 1)} %`);
export const rindeTxt = r => (r ? `${numTxt(CM.porciones(r), 2)} ${r.unidad === 'g' ? 'g' : 'un'}` : '—');
export const esArchivada = r => (r && r.estado) === 'archivada';
export const esSub = r => (r && r.tipo) === 'sub_receta';

// % de panadero de cada ingrediente (null si la receta no tiene harina): { id: pct }
export function panadero(r) {
  const p = CM.panadero(r || {}), out = {};
  ((r && r.ingredientes) || []).forEach(i => { const x = p.pct(i); if (i.id) out[i.id] = x === null || x === undefined || !isFinite(x) ? null : x; });
  return out;
}
const cant = i => ({ g: num(i.gramos), u: i.unidades === null || i.unidades === undefined || i.unidades === '' ? null : num(i.unidades) });
export const cantTxt = c => (c ? `${c.u !== null ? `${numTxt(c.u, 2)} un · ` : ''}${gTxt(c.g)}` : '—');

// Ingredientes de dos versiones lado a lado. a = antes (o null si es nueva), b = ahora.
// → [{ id, nombre, antes: { g, u, pct } | null, ahora: { … } | null, cambio: 'igual' | 'cambia' | 'nuevo' | 'sale' }]
export function filasIngredientes(a, b) {
  const ia = (a && a.ingredientes) || [], ib = (b && b.ingredientes) || [];
  const pa = panadero(a), pb = panadero(b);
  const ids = [...new Set([...ib.map(i => i.id), ...ia.map(i => i.id)])];
  return ids.map(id => {
    const x = ia.find(i => i.id === id), y = ib.find(i => i.id === id);
    const antes = x ? { ...cant(x), pct: pa[id] ?? null } : null, ahora = y ? { ...cant(y), pct: pb[id] ?? null } : null;
    const igual = antes && ahora && Math.abs(antes.g - ahora.g) < 0.05 && antes.u === ahora.u;
    return { id, nombre: (y || x).nombre || id, antes: a ? antes : null, ahora, cambio: !a ? 'nuevo' : !x ? 'nuevo' : !y ? 'sale' : igual ? 'igual' : 'cambia' };
  });
}
const pasosDe = r => ((r && r.pasos) || []).map(p => (typeof p === 'object' && p ? p.texto : p)).filter(Boolean);
const insumosDe = r => ((r && r.insumos) || []).map(i => `${i.id}:${num(i.cantidad ?? i.unidades)}`).sort().join('|');

// Qué cambió, en frases cortas (para la fila de Por revisar y la comparación de versiones).
// Un ingrediente con % de panadero en las dos se dice en %; si no, en gramos. → [texto]
export function cambios(a, b) {
  if (!b) return [];
  if (!a) return [`Receta nueva · rinde ${rindeTxt(b)} · ${(b.ingredientes || []).length} ingredientes · ${pasosDe(b).length} pasos`];
  const out = [];
  if (String(a.nombre || '').trim() !== String(b.nombre || '').trim()) out.push(`Nombre: ${a.nombre || '—'} → ${b.nombre || '—'}`);
  filasIngredientes(a, b).forEach(f => {
    if (f.cambio === 'nuevo') out.push(`Nuevo: ${f.nombre} ${gTxt(f.ahora.g)}${f.ahora.pct !== null ? ` (${pctTxt(f.ahora.pct)})` : ''}`);
    else if (f.cambio === 'sale') out.push(`Sale: ${f.nombre}`);
    else if (f.cambio === 'cambia') {
      const usaPct = f.antes.pct !== null && f.ahora.pct !== null && Math.abs(red1(f.antes.pct) - red1(f.ahora.pct)) >= 0.1;
      out.push(usaPct ? `${f.nombre} ${pctTxt(f.antes.pct)} → ${pctTxt(f.ahora.pct)}` : `${f.nombre} ${cantTxt(f.antes)} → ${cantTxt(f.ahora)}`);
    }
  });
  if (rindeTxt(a) !== rindeTxt(b)) out.push(`Rinde ${rindeTxt(a)} → ${rindeTxt(b)}`);
  if (num(a.pesoUnidad) !== num(b.pesoUnidad)) out.push(`Peso por unidad ${a.pesoUnidad ? gTxt(a.pesoUnidad) : '—'} → ${b.pesoUnidad ? gTxt(b.pesoUnidad) : '—'}`);
  if (num(a.harinaTotal) !== num(b.harinaTotal) && num(a.harinaTotal) > 0 && num(b.harinaTotal) > 0) out.push(`Harina base ${gTxt(a.harinaTotal)} → ${gTxt(b.harinaTotal)}`);
  const pa = pasosDe(a), pb = pasosDe(b);
  if (JSON.stringify(pa) !== JSON.stringify(pb)) out.push(pa.length !== pb.length ? `Pasos ${pa.length} → ${pb.length}` : `Pasos: cambió el texto (${pb.length})`);
  if (insumosDe(a) !== insumosDe(b)) out.push('Insumos: cambiaron');
  if (String(a.notas || '').trim() !== String(b.notas || '').trim()) out.push('Notas: cambiaron');
  if ((a.tipo || 'receta') !== (b.tipo || 'receta')) out.push(`Tipo: ${esSub(a) ? 'sub receta' : 'receta'} → ${esSub(b) ? 'sub receta' : 'receta'}`);
  return out;
}

// Impacto en el costo de una propuesta (c = P.costear: { propuesta, vigente }; R = resumenPropuesta(c)).
// → { texto, incompleto, faltan, sinPrecio, pct } (texto corto para la fila; null si no hay costo)
export function impactoCosto(c, R) {
  if (!c || c.error || !c.propuesta) return null;
  const n = c.propuesta, o = c.vigente, faltan = n.faltan || [], sinPrecio = n.sinPrecio || [];
  const porKg = x => (x && x.unidad === 'g' ? x.unidadNeto * 1000 : null);
  let texto = '', pct = null;
  if (!o) {
    texto = n.unidad === 'un' ? `Costo ${pesos(n.unidadNeto)} por unidad` : `Costo ${pesos(porKg(n))} por kg · lote ${pesos(n.loteNeto)}`;
  } else if (R && R.unN !== null && R.unV !== null) {
    pct = R.pctUn; texto = `Costo por unidad ${pesos(R.unV)} → ${pesos(R.unN)}${pct !== null ? ` (${signoPct(pct)})` : ''}`;
  } else if (n.unidad === 'g' && o.unidad === 'g') {
    pct = R ? R.pctLote : null; texto = `Costo del lote ${pesos(o.loteNeto)} → ${pesos(n.loteNeto)}${pct !== null ? ` (${signoPct(pct)})` : ''} · por kg ${pesos(porKg(o))} → ${pesos(porKg(n))}`;
  } else {
    pct = R ? R.pctLote : null; texto = `Costo del lote ${pesos(o.loteNeto)} → ${pesos(n.loteNeto)}${pct !== null ? ` (${signoPct(pct)})` : ''}`;
  }
  return { texto, pct, faltan, sinPrecio, incompleto: !!(sinPrecio.length || faltan.length || (n.incompleto || []).length) };
}

// ── Costo de una receta aprobada (costos_recetas) y su variación contra el costo anterior (costos_recetas_hist) ──
// docs: { recetaId: doc de costos_recetas }; hist: entradas del historial. → null | { costoUnit, unidad, lectura { valor, por },
//   fecha (del cálculo), incompleto, anterior: { valor, fecha } | null, variacion: { pct, dir } | null }
export function costoDe(id, docs, hist) {
  const d = (docs || {})[id];
  if (!d || !(num(d.costoUnit) > 0)) return null;
  const hs = (hist || []).filter(h => h.receta === id).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)) || String(x.cuando || '').localeCompare(String(y.cuando || '')));
  // El último cambio real (con un valor anterior) y la fecha desde la que valía ese valor anterior (la entrada de antes)
  let k = -1; for (let i = hs.length - 1; i >= 0; i--) if (hs[i].anterior !== null && hs[i].anterior !== undefined) { k = i; break; }
  let anterior = null, variacion = null;
  if (k >= 0) {
    const u = hs[k], prev = k > 0 ? hs[k - 1] : null;
    anterior = { valor: num(u.anterior), desde: prev ? prev.fecha : null, hasta: u.fecha };
    const p = num(u.anterior) > 0 ? (num(d.costoUnit) - num(u.anterior)) / num(u.anterior) * 100 : null;
    if (p !== null) variacion = { pct: red1(p), dir: Math.abs(p) < 0.05 ? 'igual' : p > 0 ? 'sube' : 'baja' };
  }
  const lectura = d.unidad === 'g' ? { valor: num(d.costoUnit) * 1000, por: 'kg' } : { valor: num(d.costoUnit), por: 'un' };
  return { costoUnit: num(d.costoUnit), unidad: d.unidad === 'g' ? 'g' : 'un', lectura, fecha: d.fecha || '', incompleto: (d.incompleto || []).length > 0, anterior, variacion };
}
export const lecturaTxt = c => (c ? `${c.lectura.por === 'kg' ? pesos(c.lectura.valor) : pesosD(c.lectura.valor)} / ${c.lectura.por}` : '');

// ── Lista ──
export const TIPOS = [['todas', 'Todos los tipos'], ['receta', 'Productos'], ['sub', 'Masas y sub recetas']];
export function filtrar(recetas, { area = 'todas', tipo = 'todas', q = '', archivadas = false } = {}) {
  return (recetas || [])
    .filter(r => (archivadas ? esArchivada(r) : !esArchivada(r)))
    .filter(r => area === 'todas' || r.area === area)
    .filter(r => tipo === 'todas' || (tipo === 'sub' ? esSub(r) : !esSub(r)))
    .filter(r => !normalizar(q) || coincide(`${r.nombre || ''} ${r.id || ''} ${r.clasificacion || ''}`, q))
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
}
export function conteos(recetas) {
  const vivas = (recetas || []).filter(r => !esArchivada(r)), porArea = {};
  Object.keys(AREAS).forEach(a => { porArea[a] = vivas.filter(r => r.area === a).length; });
  return { vivas: vivas.length, productos: vivas.filter(r => !esSub(r)).length, subs: vivas.filter(esSub).length, archivadas: (recetas || []).length - vivas.length, porArea };
}
// Quién y cuándo se aprobó (las que vienen de la planilla no lo dicen)
export function aprobacion(r) {
  if (!r) return '';
  if (r.aprobadaPor || r.aprobadaEn) return `${r.aprobadaPor || '—'}${r.aprobadaEn ? ` · ${String(r.aprobadaEn).slice(0, 10)}` : ''}`;
  return '';
}
