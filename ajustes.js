// ═══════════════════════════════════════════════
//  Sistema Fën — configuración del negocio (la que usa la caja)  v0.5.0
//  Mismos documentos que la caja v2.1.1: config/motivosMerma {lista},
//  config/tiposLeche {lista}, config/subcategorias {porArea}, config/tiemposPago
//  {ainavillo, barros_arana}, config/recetasOcultas {ids},
//  config/reconciliacionPeriodos {periodos}.
//  Cada cambio se hace en una transacción sobre lo que hay guardado en ese momento
//  (no sobre lo que se leyó al abrir la pantalla): si alguien cambió la lista desde
//  la caja mientras tanto, no se pierde su cambio.
//  La caja lee estos ajustes al abrirse: llegan a cada tablet al recargar la caja.
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, getDoc, getDocs, runTransaction } from './firebase.js?v=0.138.0';
import { diaLocal, productos } from './caja.js?v=0.138.0';
import * as AR from './areas.js?v=0.138.0';

const F = window.FEN_SIS;
const correo = () => (auth.currentUser && auth.currentUser.email) || '';
export const DOCS = ['motivosMerma', 'tiposLeche', 'subcategorias', 'tiemposPago', 'recetasOcultas', 'reconciliacionPeriodos'];
// Valores con que la caja crea las listas si no existen
export const BASE = {
  motivosMerma: ['Llegó dañado', 'Se cayó', 'Vencido / pasado de fecha', 'Error de producción', 'Quemado', 'Otro'],
  tiposLeche: ['Entera', 'Descremada', 'Sin lactosa', 'Entera sin lactosa']
};

export async function leerAjustes() {
  const [snaps, prods] = await Promise.all([
    Promise.all(DOCS.map(id => getDoc(doc(db, 'config', id)))),
    productos()
  ]);
  const c = {}; DOCS.forEach((id, i) => { c[id] = snaps[i].exists() ? snaps[i].data() : null; });
  // v0.75.1: las áreas de la caja son las de areas.js (las que producen + Reventa); la caja ya no tiene su lista
  const areas = AR.CAJA.map(id => ({ id, nombre: AR.NOMBRE[id] || id }));
  return { c, areas, productos: prods };
}

// Aplica un cambio sobre el documento tal como está guardado ahora.
async function cambiar(id, fn) {
  const ref = doc(db, 'config', id);
  let resultado;
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    const actual = sn.exists() ? sn.data() : {};
    const nuevo = fn(JSON.parse(JSON.stringify(actual)));
    resultado = nuevo;
    tx.set(ref, nuevo);
  });
  return resultado;
}

// ── Listas (motivos de merma, tipos de leche): agregar, renombrar, quitar, mover ──
// Se identifica cada elemento por su texto, no por su posición (la lista pudo cambiar).
const listaDe = (id, d) => (Array.isArray(d.lista) && d.lista.length ? d.lista : (BASE[id] || []).slice());
export function agregar(id, texto) {
  const t = String(texto || '').trim();
  return cambiar(id, d => {
    const l = listaDe(id, d);
    if (!t) throw new Error('Escribe un nombre');
    if (l.some(x => x.toLowerCase() === t.toLowerCase())) throw new Error(`"${t}" ya está en la lista`);
    l.push(t); return { ...d, lista: l };
  });
}
export function renombrar(id, viejo, nuevo) {
  const t = String(nuevo || '').trim();
  return cambiar(id, d => {
    const l = listaDe(id, d);
    if (!t) throw new Error('El nombre no puede quedar vacío');
    const i = l.indexOf(viejo);
    if (i < 0) throw new Error(`"${viejo}" ya no está en la lista (¿lo cambió alguien recién?)`);
    if (l.some((x, j) => j !== i && x.toLowerCase() === t.toLowerCase())) throw new Error(`"${t}" ya está en la lista`);
    l[i] = t; return { ...d, lista: l };
  });
}
export function quitar(id, texto) {
  return cambiar(id, d => {
    const l = listaDe(id, d).filter(x => x !== texto);
    if (!l.length) throw new Error('La lista no puede quedar vacía: la caja volvería a poner los valores de fábrica');
    return { ...d, lista: l };
  });
}
export function mover(id, texto, paso) {
  return cambiar(id, d => {
    const l = listaDe(id, d); const i = l.indexOf(texto), j = i + paso;
    if (i < 0 || j < 0 || j >= l.length) return { ...d, lista: l };
    [l[i], l[j]] = [l[j], l[i]]; return { ...d, lista: l };
  });
}

// ── Subcategorías por área ──
export function subAgregar(area, texto) {
  const t = String(texto || '').trim();
  return cambiar('subcategorias', d => {
    const p = d.porArea || {}; const l = p[area] || [];
    if (!t) throw new Error('Escribe un nombre');
    if (l.some(x => x.toLowerCase() === t.toLowerCase())) throw new Error(`"${t}" ya está en ${area}`);
    p[area] = [...l, t]; return { ...d, porArea: p };
  });
}
export function subRenombrar(area, viejo, nuevo) {
  const t = String(nuevo || '').trim();
  return cambiar('subcategorias', d => {
    const p = d.porArea || {}; const l = (p[area] || []).slice(); const i = l.indexOf(viejo);
    if (!t) throw new Error('El nombre no puede quedar vacío');
    if (i < 0) throw new Error(`"${viejo}" ya no está en ${area}`);
    if (l.some((x, j) => j !== i && x.toLowerCase() === t.toLowerCase())) throw new Error(`"${t}" ya está en ${area}`);
    l[i] = t; p[area] = l; return { ...d, porArea: p };
  });
}
export function subQuitar(area, texto) {
  return cambiar('subcategorias', d => { const p = d.porArea || {}; p[area] = (p[area] || []).filter(x => x !== texto); return { ...d, porArea: p }; });
}
export function subMover(area, texto, paso) {
  return cambiar('subcategorias', d => {
    const p = d.porArea || {}; const l = (p[area] || []).slice(); const i = l.indexOf(texto), j = i + paso;
    if (i >= 0 && j >= 0 && j < l.length) [l[i], l[j]] = [l[j], l[i]];
    p[area] = l; return { ...d, porArea: p };
  });
}

// ── Tiempos de pago: solo Ainavillo (Barros Arana es 0 fijo, como en la caja) ──
export function guardarTiemposAinavillo(t) {
  const n = v => Math.max(0, Math.min(90, parseInt(v) || 0));
  return cambiar('tiemposPago', () => ({
    ainavillo: { debito: n(t.debito), credito: n(t.credito), transferencia: n(t.transferencia) },
    barros_arana: { debito: 0, credito: 0, transferencia: 0 }
  }));
}

// ── Recetas ocultas ──
export function ocultarReceta(id) { return cambiar('recetasOcultas', d => { const ids = d.ids || []; return { ...d, ids: ids.includes(id) ? ids : [...ids, id] }; }); }
export function mostrarReceta(id) { return cambiar('recetasOcultas', d => ({ ...d, ids: (d.ids || []).filter(x => x !== id) })); }

// Lista de recetas publicada por Producción (la misma que lee la caja)
function parseCSV(texto) {
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i], sig = texto[i + 1];
    if (comillas) { if (ch === '"' && sig === '"') { campo += '"'; i++; } else if (ch === '"') comillas = false; else campo += ch; }
    else if (ch === '"') comillas = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && sig === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}
export async function leerRecetasProduccion() {
  const res = await fetch(F.RECETAS_CSV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const filas = parseCSV(await res.text());
  const h = (filas[0] || []).map(x => x.trim().toLowerCase());
  const col = (...n) => { for (const x of n) { const i = h.indexOf(x); if (i >= 0) return i; } return -1; };
  const iId = col('id_receta'), iNom = col('nombre'), iCod = col('código_área', 'codigo_area'), iArea = col('área', 'area');
  return filas.slice(1).filter(f => f[iId]).map(f => ({
    id: (f[iId] || '').trim(), nombre: (f[iNom] || '').trim(), area: ((iCod >= 0 ? f[iCod] : '') || (iArea >= 0 ? f[iArea] : '') || '').trim()
  }));
}

// ── Períodos de conciliación (meses del año revisados) ──
export function marcarPeriodo(periodo, revisado) {
  return cambiar('reconciliacionPeriodos', d => {
    const p = d.periodos || {};
    if (revisado) p[periodo] = { revisado: true, fecha: diaLocal(), usuario: correo() };
    else p[periodo] = { revisado: false, fecha: diaLocal(), usuario: correo() };
    return { ...d, periodos: p };
  });
}
