// ═══════════════════════════════════════════════
//  Sistema Fën — Cartola: los cargos del banco contra Gastos  v0.18.0 (v0.44.0: el archivo original va a Drive)
//  La misma cartola que se sube en B2B → Conciliación (los abonos) trae los
//  cargos: aquí se dice qué es cada uno (paga vencimientos, ya estaba en
//  Gastos, gasto nuevo o no es gasto). Lo guarda el script de Gastos v2.8.0
//  (hojas "Cartola Cargos", "Cartolas" y "Cartola Reglas").
//  Las propuestas se calculan aquí, cada vez, con lo que está por pagar en ese momento.
//  v0.50.0: con Gastos en la base nueva, todo va a gastos-cartola-fs.js (fen-gastos) y las propuestas siguen la forma de
//  trabajar acordada (gastos-cartola.js: monto fijo, documento, abonos). Con la planilla, igual que en la v0.49.0.
// ═══════════════════════════════════════════════
import * as Gastos from './gastos.js?v=0.138.0';
import * as CB from './gastos-cartola.js?v=0.138.0';
export { resumenLote } from './gastos-cartola.js?v=0.138.0';

export const VERSION_CARTOLA = '2.8.0';
const op = (o, d, idem) => Gastos.llamar(o, d, idem, VERSION_CARTOLA);
const fsC = () => import('./gastos-cartola-fs.js?v=0.138.0');
const enBase = () => Gastos.enBase();

let cache = null;
export async function lista(forzar, dias = 60) {
  if (!forzar && cache && cache.dias === dias && Date.now() - cache.t < 60000) return cache.d;
  const d = (await enBase()) ? await (await fsC()).lista(dias) : await op('cc_lista', { dias });
  cache = { t: Date.now(), d, dias };
  return d;
}
export const olvidar = () => { cache = null; };

const metaDe = cartola => ({ id: cartola.identificador, tipo: cartola.tipo, cuenta: (cartola.cuenta && cartola.cuenta.tipo) || 'chequera', numero: (cartola.cuenta && cartola.cuenta.numero) || '', nCartola: cartola.nCartola || '', desde: cartola.desde || '', hasta: cartola.hasta || '' });
// Los cargos de la cartola leída (b2b.leerCartola) se suben de a 1500
export async function cargar(cartola, idemBase) {
  const cargos = cartola.filas.filter(f => f.cargos > 0).map(f => ({ fecha: f.fecha, descripcion: f.descripcion, monto: f.cargos, saldo: f.saldo, operacion: f.operacion || '' }));
  const meta = metaDe(cartola);
  const r = { cargos: 0, nuevos: 0, yaVistos: 0, ignorados: 0, repetidos: 0, parecidos: 0 };   // v0.67.6: repetidos de otra cartola
  const base = await enBase(), F = base ? await fsC() : null;
  for (let i = 0; i < Math.max(1, cargos.length); i += 1500) {
    const x = base ? await F.cargar(meta, cargos.slice(i, i + 1500), i / 1500) : await op('cc_cargar', { cartola: meta, cargos: cargos.slice(i, i + 1500), parte: i / 1500 }, `${idemBase}-${i}`);
    ['cargos', 'nuevos', 'yaVistos', 'ignorados', 'repetidos', 'parecidos'].forEach(k => { r[k] += x[k] || 0; });
  }
  olvidar(); Gastos.olvidar();
  return r;
}
// v0.44.0 · El archivo original, tal como se subió, a Drive ("Fën · Gastos / Cartolas / año", privado).
// Script de Gastos v2.10.0 (op cc_archivo). Hasta 10 MB.
export const VERSION_ARCHIVO = '2.10.0';
export const ARCHIVO_MAX = 10 * 1024 * 1024;
export async function guardarArchivo(file, cartola, idem) {
  if (!file) throw new Error('Falta el archivo');
  if (file.size > ARCHIVO_MAX) throw Object.assign(new Error('el archivo pesa más de 10 MB'), { code: 'grande' });
  const archivoBase64 = await Gastos.aBase64(file);
  if (await enBase()) { const r = await (await fsC()).guardarArchivo(metaDe(cartola), { archivoBase64, mimeType: file.type || 'application/octet-stream', nombreArchivo: file.name || 'cartola.xlsx' }, Gastos.subidor(idem)); olvidar(); return r; }
  const r = await Gastos.llamar('cc_archivo', { cartola: metaDe(cartola), archivoBase64, mimeType: file.type || 'application/octet-stream', nombreArchivo: file.name || 'cartola.xlsx' }, idem, VERSION_ARCHIVO);
  olvidar();
  return r;
}
// v0.81.0 · Mercado Pago: los retiros al banco como traspaso y las ventas con tarjeta por día (solo con la base nueva)
export async function traspasosMP(cartola, retiros, nota) { if (!(await enBase())) throw new Error('Mercado Pago necesita Gastos en la base nueva'); const r = await (await fsC()).traspasosMP(metaDe(cartola), retiros, nota); olvidar(); Gastos.olvidarTodo(); return r; }
export async function ventasMP(dias, archivo) { if (!(await enBase())) throw new Error('Mercado Pago necesita Gastos en la base nueva'); return (await fsC()).guardarVentasMP(dias, archivo); }
export async function resolver(d, idem) { const r = (await enBase()) ? await (await fsC()).resolver(d) : await op('cc_resolver', d, idem); olvidar(); Gastos.olvidarTodo(); return r; }
export async function deshacer(id, motivo, idem, opc = {}) { const r = (await enBase()) ? await (await fsC()).deshacer(id, motivo, opc) : await op('cc_deshacer', { id, motivo }, idem); olvidar(); Gastos.olvidarTodo(); return r; }
export async function quitarRegla(clave) { const r = (await enBase()) ? await (await fsC()).quitarRegla(clave) : await op('cc_quitar_regla', { clave }); olvidar(); return r; }
// v0.50.0 · Confirmar varios de una vez: cada uno por su lado (si uno falla, los demás siguen) e idempotente por el cargo.
// lista: [{ c, pedido }]; avance(hechos, total, c). Devuelve { ok: [ids], errores: [{ c, error }] }
export async function confirmarVarios(lista, avance = () => {}) {
  const out = { ok: [], errores: [] };
  for (let i = 0; i < lista.length; i++) {
    const { c, pedido } = lista[i];
    avance(i, lista.length, c);
    try { await resolver({ id: c.id, huella: c.huella, ...pedido }, 'cc-' + c.id + '-' + Gastos.nuevaClave()); out.ok.push(c.id); }
    catch (e) { out.errores.push({ c, error: e.message || String(e) }); }
  }
  avance(lista.length, lista.length, null);
  return out;
}

// v0.64.0 · Transferencias enviadas y Proveedores (solo con la base nueva)
const soloBase = async () => { if (!(await enBase())) throw Object.assign(new Error('Esto funciona cuando Gastos trabaja con la base nueva (Gastos → Configuración → Base nueva).'), { code: 'planilla' }); return fsC(); };
export async function guardarEnviadas(L, nombre) { const r = await (await soloBase()).guardarEnviadas(L, nombre); olvidar(); return r; }
export async function proveedores() { return (await soloBase()).proveedoresLista(); }
export async function guardarFicha(p) { const r = await (await soloBase()).guardarFicha(p); olvidar(); return r; }
// v0.67.1 · Nota de un cargo (sin clasificar ni conciliar): 1 escritura. docId: el id del documento del cargo
// v0.69.0 · Reglas de conciliación de Cargos (conc_reglas): crear, editar, pausar, activar, archivar, aceptar o descartar una sugerida
export async function guardarReglaConc(op) { const r = await (await soloBase()).guardarReglaConc(op); olvidar(); return r; }
export async function notaCargo(docId, texto) { const r = await (await soloBase()).notaCargo(docId, texto); olvidar(); return r; }

// ── Propuestas ──
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const dias = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
// Vencimientos de la misma factura/proveedor que suman exacto el cargo: primero los más antiguos seguidos;
// si no, la combinación (de hasta 12) que calza, prefiriendo las más antiguas.
export function combinacion(vencs, monto) {
  const l = vencs.filter(v => v.monto > 0).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).slice(0, 12);
  let s = 0;
  for (let i = 0; i < l.length; i++) { s += l[i].monto; if (s === monto) return l.slice(0, i + 1); if (s > monto) break; }
  let mejor = null;
  for (let m = 1; m < (1 << l.length); m++) {
    let t = 0; const el = [];
    for (let i = 0; i < l.length; i++) if (m & (1 << i)) { t += l[i].monto; el.push(i); }
    if (t !== monto) continue;
    const clave = el.join(',');
    if (!mejor || el.length < mejor.el.length || (el.length === mejor.el.length && clave < mejor.clave)) mejor = { el, clave };
  }
  return mejor ? mejor.el.map(i => l[i]) : null;
}
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fCorta = f => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ''); return m ? `${Number(m[3])} ${MESES_C[Number(m[2]) - 1]}` : (f || ''); };
const pagosDe = l => l.map(v => ({ id: v.id, monto: v.monto }));
const nombresV = l => l.map(v => v.nombre).join(' + ');

// Para un cargo: qué parece ser. seguro = va a "Listos para confirmar".
// v0.30.0 · ¿La descripción del banco nombra al proveedor? (una palabra propia de su razón social, de 4+ letras)
const GENERICAS = new Set(['SOCIEDAD', 'COMERCIAL', 'COMERCIALIZADORA', 'EMPRESA', 'EMPRESAS', 'LIMITADA', 'LTDA', 'CHILE', 'SERVICIOS', 'INVERSIONES', 'DISTRIBUIDORA', 'ALIMENTOS', 'INDUSTRIAL', 'COMPANIA', 'IMPORTADORA']);
export function nombreCalza(descripcion, razon) {
  const dsc = ' ' + norm(descripcion) + ' ';
  return norm(razon).split(' ').filter(w => w.length >= 4 && !GENERICAS.has(w)).some(w => dsc.includes(' ' + w + ' ') || dsc.includes(' ' + w.slice(0, 6)));
}
// v0.30.1 · Cómo quedó clasificado un gasto: cada ítem con sus áreas y montos ("LACTEOS: PAN $8.000 · BOL $4.000").
// Con el script de Gastos anterior a 2.8.2 las filas no traen área: se muestran solo los ítems.
const pesosC = n => '$' + Math.round(n).toLocaleString('es-CL');
export function clasificacionGasto(g) {
  const fs = (g.filas || []).filter(f => f.item);
  if (!fs.length) return (g.items || []).join(' + ');
  const porItem = {};
  fs.forEach(f => { const it = porItem[f.item] || (porItem[f.item] = {}); const a = f.area || '—'; it[a] = (it[a] || 0) + (Number(f.monto) || 0); });
  return Object.entries(porItem).map(([item, areas]) => { const l = Object.entries(areas); return l.length === 1 ? `${item} · ${l[0][0]}` : `${item}: ${l.map(([a, m]) => `${a} ${pesosC(m)}`).join(' · ')}`; }).join(' | ');
}
export function proponer(c, d) {
  if (d && d.fuente === 'base') return CB.proponer(c, d);   // v0.50.0: la forma de trabajar acordada
  const reglas = {}; (d.reglas || []).forEach(r => { reglas[r.clave] = r; });
  const regla = reglas[c.clave];
  const vencs = (d.vencimientos || []);
  const cerca = (v, antes = 60, despues = 20) => !v.fecha || (dias(c.fecha, v.fecha) <= antes && dias(v.fecha, c.fecha) <= despues);
  // 1) Lo aprendido
  if (regla && regla.accion === 'ignorar') return { tipo: 'ignorar', seguro: true, motivo: regla.ejemplo || 'No es gasto', por: 'aprendido' };
  if (regla && regla.accion === 'vencimiento') {
    const [t, val] = [regla.vencimiento.slice(0, 2), regla.vencimiento.slice(2)];
    const cand = vencs.filter(v => (t === 'p:' ? v.plantillaId === val : t === 'rut:' ? v.rut === val : norm(v.razon || v.nombre).startsWith(val)));
    if (t === 'p:' && cand.length) {
      const v = cand.slice().sort((a, b) => Math.abs(dias(a.fecha, c.fecha)) - Math.abs(dias(b.fecha, c.fecha)))[0];
      // Seguro solo si el monto se parece a lo estimado (±15%): una descripción genérica puede ser de otra cosa
      if (cerca(v, 45, 25)) return { tipo: 'vencimientos', seguro: !v.monto || Math.abs(c.monto - v.monto) <= v.monto * 0.15, pagos: [{ id: v.id, monto: c.monto }], texto: v.nombre + (v.monto && v.monto !== c.monto ? ` (estimado ${v.monto.toLocaleString('es-CL')})` : ''), por: 'aprendido' };
    }
    const comb = combinacion(cand, c.monto);
    if (comb) return { tipo: 'vencimientos', seguro: true, pagos: pagosDe(comb), texto: nombresV(comb), por: 'aprendido' };
  }
  // 2) El RUT de la transferencia: facturas de ese proveedor
  if (c.rut) {
    const cand = vencs.filter(v => v.rut === c.rut), comb = combinacion(cand, c.monto);
    if (comb) return { tipo: 'vencimientos', seguro: true, pagos: pagosDe(comb), texto: nombresV(comb), por: 'rut' };
  }
  // 3) Un gasto al contado ya registrado (factura pagada al comprar), del mismo monto y de esos días.
  // v0.30.0: si hay varios del mismo monto (leche, mantequilla…), el de fecha más cercana; seguro solo si es uno
  // claro (el más cercano, a ≤3 días, sin empate) y el RUT o el nombre del proveedor calzan con la descripción del banco
  const gs = (d.gastos || []).filter(g => Math.abs(g.monto - c.monto) <= g.filas.length && dias(c.fecha, g.fecha) >= -3 && dias(c.fecha, g.fecha) <= 10 && (!c.rut || !g.rut || g.rut === c.rut))
    .map(g => ({ g, dist: Math.abs(dias(c.fecha, g.fecha)), nombre: nombreCalza(c.descripcion, g.razon), rut: !!(c.rut && g.rut === c.rut) }))
    .sort((a, b) => (b.rut - a.rut) || (b.nombre - a.nombre) || a.dist - b.dist);
  const txtG = g => `${g.folio ? 'Factura N° ' + g.folio + ' · ' : ''}${g.razon ? g.razon + ' · ' : ''}del ${fCorta(g.fecha)} · ${clasificacionGasto(g)}`;
  if (gs.length) {
    const [a, b] = gs, empate = b && (b.rut === a.rut) && (b.nombre === a.nombre) && b.dist === a.dist;
    const seguro = !empate && (a.rut || (a.nombre && a.dist <= 3));
    if (seguro || gs.length === 1) return { tipo: 'gasto', seguro: !!seguro, gasto: a.g, texto: txtG(a.g) + (gs.length > 1 ? ` (hay ${gs.length - 1} más del mismo monto: se propone el de fecha más cercana)` : ''), por: a.rut ? 'rut' : 'monto', otros: gs.slice(1, 4).map(x => x.g) };
  }
  // 4) Lo aprendido como gasto nuevo
  // Gasto nuevo aprendido: seguro si ya se confirmó así más de una vez y el monto se parece al último (±50%)
  if (regla && regla.accion === 'gasto') return { tipo: 'nuevo', seguro: regla.veces >= 2 && (!regla.monto || Math.abs(c.monto - regla.monto) <= regla.monto * 0.5), item: regla.item, area: regla.area, sinFactura: !!regla.sinFactura, texto: regla.item, por: 'aprendido' };
  // 5) Un vencimiento por pagar con el monto exacto (sin nada más que lo confirme: a revisar)
  const ex = vencs.filter(v => v.monto === c.monto && cerca(v));
  if (ex.length === 1) return { tipo: 'vencimientos', seguro: false, pagos: [{ id: ex[0].id, monto: c.monto }], texto: ex[0].nombre, por: 'monto' };
  if (gs.length) return { tipo: 'gasto', seguro: false, gasto: gs[0].g, texto: txtG(gs[0].g) + (gs.length > 1 ? ` (hay ${gs.length - 1} más del mismo monto: revisa cuál es)` : ''), por: 'monto', otros: gs.slice(1, 4).map(x => x.g) };
  return null;
}

// Facturas del SII por pagar cuyo vencimiento ya está cubierto por las cartolas subidas (deberían aparecer como cargo)
export function facturasSinPago(vencs, hastaRevisado) {
  if (!hastaRevisado) return [];
  return (vencs || []).filter(v => v.folio && v.razon && v.fecha && v.fecha <= hastaRevisado).sort((a, b) => a.fecha.localeCompare(b.fecha));
}
// Hasta dónde están subidas las cartolas de cada cuenta (las cuentas que aparecen en la lista)
export function coberturaPorCuenta(cartolas, cobertura) {
  const out = {};
  (cartolas || []).forEach(c => { (out[c.cuenta] = out[c.cuenta] || []).push(c); });
  Object.keys(out).forEach(k => { out[k] = { ...cobertura(out[k]), cuentaN: (out[k].find(x => x.cuentaN) || {}).cuentaN || '' }; });
  return out;
}
