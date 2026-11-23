// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos: copia de la base nueva a la planilla  v0.45.0 (etapa G2)
//  Después del cambio, cada documento hecho o cambiado en fen-gastos queda marcado
//  (planillaPendiente = true) y el script de Gastos (v2.11.0, op planilla_sync) lo escribe en la
//  planilla unos segundos después: Looker Studio y el reparto de costos de Producción la siguen leyendo.
//  Igual que Cocina (programarPlanilla / pasarPlanilla / revisarPlanilla): si falla, se reintenta solo
//  (al minuto y después cada 2 minutos). Los pasos 3 y 4 de G2 llaman programar() después de cada escritura.
// ═══════════════════════════════════════════════
//  v0.73.0 (Etapa 1): COPIA APAGADA. Decisión del dueño (20-oct-2026): Looker Studio sale del plan y las copias en vivo a las
//  planillas se apagan; en su lugar, un respaldo mensual en Excel (Configuración → Respaldo). Lo hecho en fen-gastos ya no se marca
//  (planillaPendiente = false) y nada llama al script (op planilla_sync). La planilla de Gastos queda como estaba (historial).
//  Las funciones quedan para no romper a quien las llama, pero no hacen nada.
// ═══════════════════════════════════════════════
import * as GB from './gastos-base.js?v=0.138.0';
import * as Gastos from './gastos.js?v=0.138.0';
import * as FB from './fs-gastos.js?v=0.138.0';

export const APAGADA = true;
const E = { t: 0, corriendo: false, error: '', fallos: 0, pendientes: APAGADA ? 0 : null, ultima: null, oyentes: new Set() };
const avisar = () => E.oyentes.forEach(fn => { try { fn(estado()); } catch (e) {} });
export const alCambiar = fn => { E.oyentes.add(fn); return () => E.oyentes.delete(fn); };
export const estado = () => ({ corriendo: E.corriendo, error: E.error, pendientes: E.pendientes, ultima: E.ultima, programada: !!E.t });

// Texto para la pantalla
export function texto() {
  if (APAGADA) return 'Copia a la planilla apagada (v0.73.0): la planilla de Gastos queda como estaba.';
  if (E.error) return `Planilla pendiente: ${E.error}, se reintenta sola`;
  if (E.corriendo) return 'Pasando los cambios a la planilla…';
  if (E.pendientes === null) return 'Revisando la planilla…';
  if (E.pendientes > 0) return `Hay ${E.pendientes.toLocaleString('es-CL')} ${E.pendientes === 1 ? 'cambio' : 'cambios'} por pasar`;
  return 'Planilla al día';
}

// Cuántos documentos esperan pasar a la planilla (una agregación por colección)
export async function contar() {
  if (APAGADA) { E.pendientes = 0; return 0; }
  const db = await GB.dbBase();
  const ns = await Promise.all(GB.COLECCIONES_PLANILLA.map(async col => {
    const r = await FB.getAggregateFromServer(FB.query(FB.collection(db, col), FB.where('planillaPendiente', '==', true)), { n: FB.count() });
    return Number(r.data().n) || 0;
  }));
  E.pendientes = ns.reduce((s, x) => s + x, 0);
  avisar();
  return E.pendientes;
}

// v0.63.2: cada pasada cuesta lecturas en fen-gastos (el script revisa las 11 colecciones y el conteo otras 11): se juntan los
// cambios de 20 segundos en una sola pasada (antes 5) y, si algo queda pegado, se espera cada vez más (1, 2, 4… hasta 30 minutos)
// en vez de reintentar cada minuto todo el día.
const JUNTAR_MS = 20000, MAX_ESPERA = 1800000;
export function programar(ms = JUNTAR_MS) { if (APAGADA) return; clearTimeout(E.t); E.t = setTimeout(pasar, ms); avisar(); }
const espera = n => Math.min(MAX_ESPERA, 60000 * Math.pow(2, Math.max(0, n - 1)));
// Al abrir: si hay algo por pasar y no hay una copia en camino, se programa
export async function revisar() {
  if (APAGADA) return estado();
  try { await contar(); } catch (e) { return estado(); }
  if (E.pendientes > 0 && !E.t && !E.corriendo) programar(3000);
  return estado();
}

export async function pasar() {
  clearTimeout(E.t); E.t = 0;
  if (APAGADA) return null;
  if (E.corriendo) return;
  if (navigator.onLine === false) { programar(60000); return; }
  E.corriendo = true; avisar();
  let r = null;
  try {
    // El script trabaja hasta ~4,5 minutos por llamada; si queda algo (mucho por pasar), se llama de nuevo
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      r = await Gastos.planillaSync(await GB.tokenBase());
      if (!r.quedan || r.siguenPendientes || (r.errores && r.errores.length) || !r.pasados) break;
    }
    E.error = '';
    E.ultima = { en: new Date(), pasados: r.pasados || 0, avisos: r.avisos || [], errores: r.errores || [] };
    // Sin avances (quedó algo que no se puede pasar): cuenta como fallo para esperar más la próxima vez
    E.fallos = r.pasados || !r.quedan ? 0 : E.fallos + 1;
    if (r.errores && r.errores.length) { E.error = `${r.errores.length} ${r.errores.length === 1 ? 'cambio no se pudo escribir' : 'cambios no se pudieron escribir'} (${r.errores[0].error})`; E.fallos = Math.max(E.fallos, 1); }
  } catch (e) {
    E.error = (e && e.message) || String(e);
    E.fallos++;
  } finally {
    E.corriendo = false;
    // v0.63.2: el conteo (11 consultas) solo si el script no dijo que terminó
    if (E.error || !r || r.quedan) { try { await contar(); } catch (e) {} } else { E.pendientes = 0; }
    // Reintento solo, cada vez más espaciado (1, 2, 4, 8… hasta 30 minutos). Si quedó algo y la pasada avanzó, en un minuto.
    if (E.error) programar(espera(E.fallos));
    else if (E.pendientes > 0) programar(E.fallos ? espera(E.fallos) : 60000);
    avisar();
  }
  return r;
}
