// ═══════════════════════════════════════════════
//  Sistema Fën — Cartola con la base nueva (etapa G3, tercera parte): reglas puras  v0.50.0 · v0.62.0 (pago de tarjeta)
//  Solo con la base nueva (config/gastos: fuente "base"). Con la planilla, cartola.js sigue igual que en la v0.49.0.
//  · Lo mismo que hacía Cartola.gs del script (estados POR_REVISAR / CONCILIADO / IGNORADO / A_MEDIAS, huella e id de
//    cada cargo, ya visto por huella o por N° de operación, la clave de lo aprendido por RUT o por descripción, la traza
//    "Cartola N°…[cc…]", aprender y desaprender con veces y último monto), ahora sobre las colecciones de fen-gastos
//    cartolas, cartola_cargos y cartola_reglas (con la forma de la copia G1: los nombres de las columnas de la planilla).
//  · Las propuestas con la forma de trabajar acordada (12-oct):
//     1) monto fijo: un cargo del monto exacto del vencimiento (±$0) dentro de la ventana de fechas → "pagar este
//        vencimiento", seguro;
//     2) según documento: por el monto del documento (boleta o SII), cuando ya llegó. Dos vencimientos con la misma
//        descripción en el banco se distinguen por ese monto; si los montos chocan o falta el documento, no hay
//        propuesta automática: se muestran las opciones;
//     3) libre (sueldos líquidos): lo aprendido propone "abono a …", nunca seguro; nunca se cierra solo.
//    Después, lo de siempre: RUT de la transferencia, gasto ya registrado del mismo monto (−3 a +10 días) y gasto nuevo
//    aprendido. La cartola nunca crea obligaciones.
//  Sin red: se prueba sola. Fechas aaaa-mm-dd (hora de Chile).
// ═══════════════════════════════════════════════
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as B from './gastos-banco.js?v=0.138.0';
import { habilesEntre } from './feriados-cl.js?v=0.138.0';
import * as D3 from './gastos-g3d.js?v=0.138.0';   // v0.67.0: total del plan de Previred con multas e intereses
import * as PM from './pagos-mixtos.js?v=0.138.0';   // v0.69.2: pagos mixtos (un documento pagado en partes)
import * as BO from './boletas.js?v=0.138.0';   // v0.70.0: boletas de luz y agua (el total a pagar paga todo lo que cubre, lo más antiguo primero)

// v0.62.0 · "Pago de tarjeta de crédito": el cargo no crea gasto (las compras con tarjeta ya son gasto al comprar, por el SII);
// queda en el mismo cargo como movimiento de flujo (estado CONCILIADO, accion 'pago_tarjeta', detalle { movimiento: 'flujo',
// tipo: 'pago_tarjeta', tarjeta }) para el flujo de caja (F4). Se aprende como lo demás (regla accion 'pago_tarjeta').
export const PAGO_TARJETA = 'pago_tarjeta';
// v0.63.1 · "Traspaso entre cuentas propias" (chequera ↔ cuenta corriente): tampoco crea gasto; queda en el cargo como
// movimiento de flujo (estado CONCILIADO, accion 'traspaso', detalle { movimiento: 'flujo', tipo: 'traspaso', nota }) y se aprende.
export const TRASPASO = 'traspaso';
// v0.67.6 · REPETIDO: el mismo movimiento que ya llegó en otra cartola (en línea ↔ histórica). No se revisa ni crea nada; apunta al
// original (repetidoDe). Nunca cuenta: ni por revisar, ni en totales, ni en el flujo (accion 'repetido').
export const ESTADOS = { revisar: 'POR_REVISAR', conciliado: 'CONCILIADO', ignorado: 'IGNORADO', aMedias: 'A_MEDIAS', repetido: 'REPETIDO' };
export const CUENTAS = { cc: 'Cta. Cte.', chequera: 'Chequera', mp: 'Mercado Pago' };   // v0.81.0: Mercado Pago (reporte de liberaciones)
// Ventana de fechas para el monto fijo y el documento: el cargo puede llegar hasta 15 días antes del vencimiento y hasta 10 después
export const VENTANA = { antes: 15, despues: 10 };

const s = v => String(v == null ? '' : v);
const num = v => { if (typeof v === 'number') return isFinite(v) ? v : 0; const x = Number(s(v).replace(/,\d{1,2}$/, '').replace(/[^0-9-]/g, '')); return isFinite(x) ? x : 0; };
const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
// Como sfTexto del script
export const texto = (v, max = 200) => s(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).replace(/^[=+\-@\s]+/, '').trim();
export const dia = v => { const t = s(v).trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(t); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const dias = (a, b) => Math.round((Date.UTC(...a.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(...b.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)))) / 864e5);
const dma = iso => { const p = s(iso).split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : s(iso); };

// ── Lo mismo que Cartola.gs ──
export const norm = t => s(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const dv = n => { let x = 0, m = 2; const t = s(n); for (let i = t.length - 1; i >= 0; i--) { x += Number(t[i]) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (x % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); };
export function rutDe(desc) {
  const re = /(?:^|[^0-9])(\d{1,2}\.?\d{3}\.?\d{3})-?([0-9kK])(?![0-9])/g;
  let m;
  while ((m = re.exec(s(desc)))) { const n = m[1].replace(/\./g, ''); if (n.length >= 7 && dv(n) === m[2].toUpperCase()) return n + m[2].toUpperCase(); }
  return '';
}
export const rutNorm = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
export const claveDe = desc => { const r = rutDe(desc); return r ? 'rut:' + r : 'txt:' + norm(desc).replace(/\d{5,}/g, '#').slice(0, 80); };
export const huellaDe = c => ['C', c.cuenta, c.fecha, Math.round(c.saldo), Math.round(c.monto), norm(c.descripcion)].join('|');
// Id del cargo: "cc" + los 10 primeros del SHA-256 de la huella (como ccId del script). sha: función async (texto) → hex
export const idDe = async (huella, sha) => 'cc' + (await sha(huella)).slice(0, 10);
const claveOp = (cu, f, m, op) => (op && Number(op) > 0 ? [cu, f, Math.round(m), s(op).replace(/^0+/, '')].join('|') : '');
// "Cartola N°012 · Cta. Cte. ···0123 · cargo 07-09-2026 · op. 5550101 · subida 08-10-2026 [cc1a2b3c4d5e]"
export function traza(c, sii) {
  return [(c.nCartola ? 'Cartola N°' + c.nCartola : 'Cartola en línea'), (CUENTAS[c.cuenta] || c.cuenta) + (c.cuentaN ? ' ···' + c.cuentaN : ''), 'cargo ' + dma(c.fecha)]
    .concat(c.operacion ? ['op. ' + c.operacion] : []).concat(['subida ' + dma(s(c.subidaEl).slice(0, 10))]).concat(sii ? [sii] : []).join(' · ') + ' [' + c.id + ']';
}

// ── Cargo de la base (copiado de la planilla en G1 o hecho en la base) → como lo entrega cc_lista ──
const json = t => { if (t && typeof t === 'object') return t; try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
export function vistaCargo(id, d) {
  const c = { id: s(d.id) || id, docId: id, huella: s(d.huella), cuenta: s(d.cuenta), cuentaN: s(d.cuentaN), fecha: dia(d.fecha), descripcion: s(d.descripcion), monto: num(d.monto), saldo: num(d.saldo),
    operacion: s(d.nOperacion), cartola: s(d.cartola), nCartola: s(d.nCartola), subidaEl: s(d.subidaEl).slice(0, 16), subidaPor: s(d.subidaPor), estado: s(d.estado),
    accion: s(d.accion), detalle: json(d.detalle), resueltoEl: s(d.resueltoEl).slice(0, 16), resueltoPor: s(d.resueltoPor), historial: s(d.historial), version: Number(d.version) || 0,
    fuentes: Array.isArray(d.fuentes) ? d.fuentes : [],   // v0.64.0: de qué archivos salió
    nota: vistaNota(d.nota), notasAntes: Array.isArray(d.notaHistorial) ? d.notaHistorial.length : 0,   // v0.67.1: la nota del cargo
    repetidoDe: s(d.repetidoDe), noRepetidoDe: Array.isArray(d.noRepetidoDe) ? d.noRepetidoDe.map(s) : [], ...(d.quitadoEnPlanilla ? { quitadoEnPlanilla: true } : {}) };   // v0.67.6
  c.rut = rutDe(c.descripcion); c.clave = claveDe(c.descripcion);
  return c;
}
// ── v0.67.1 · Nota de un cargo ("Compra del 30 sep, aún sin factura: pedirla el 17-oct") ──
// cartola_cargos/{id}.nota = { texto, por, en }; las versiones anteriores (también la quitada) quedan en notaHistorial (nunca se pisan).
// Se guarda sin clasificar ni conciliar el cargo. No pasa a la planilla de Google.
export const MAX_NOTA = 300, MAX_HIST_NOTA = 50;
export const textoNota = v => s(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTA);
export function vistaNota(n) { const t = n && typeof n === 'object' ? textoNota(n.texto) : ''; return t ? { texto: t, por: s(n.por), en: s(n.en).slice(0, 16) } : null; }
// prev: el cargo (datos de la base). → { cambio: false } o { cambio: true, campos: { nota, notaHistorial }, quitada }
export function conNota(prev, texto, por, en) {
  const t = textoNota(texto), antes = prev && prev.nota && typeof prev.nota === 'object' ? prev.nota : null, tAntes = antes ? textoNota(antes.texto) : '';
  if (t === tAntes) return { cambio: false };
  const hist = (Array.isArray(prev && prev.notaHistorial) ? prev.notaHistorial : []).slice();
  if (antes && (tAntes || antes.en)) hist.push({ texto: tAntes, por: s(antes.por), en: s(antes.en) });
  return { cambio: true, quitada: !t, campos: { nota: { texto: t, por: s(por), en: s(en) }, notaHistorial: hist.slice(-MAX_HIST_NOTA) } };
}
export const vistaCartola = (id, d) => ({ docId: id, id: s(d.cartola), cuenta: s(d.cuenta), cuentaN: s(d.cuentaN), tipo: s(d.tipo), nCartola: s(d.nCartola), desde: dia(d.desde), hasta: dia(d.hasta),
  cargos: num(d.cargos), nuevos: num(d.nuevos), yaVistos: num(d.yaVistos), ignorados: num(d.ignorados), repetidos: num(d.repetidos), subidaEl: s(d.subidaEl).slice(0, 16), archivo: s(d.archivo) });
export const vistaRegla = (id, d) => ({ docId: id, clave: s(d.clave), accion: s(d.accion), item: s(d.item), area: s(d.area), vencimiento: s(d.vencimiento), sinFactura: s(d.sinFactura) === 'Sí' || d.sinFactura === true,
  ejemplo: s(d.ejemplo), veces: num(d.veces), monto: num(d.ultimoMonto), actualizado: s(d.actualizado).slice(0, 16), quitada: !!(d.quitada && s(d.quitada)) });
// Reglas vivas por clave (una regla quitada no cuenta)
export function mapaReglas(reglas) { const out = {}; (reglas || []).forEach(r => { if (r.clave && !r.quitada && r.veces > 0) out[r.clave] = r; }); return out; }

// ── Subir los cargos (ccCargar): limpiar y decidir qué es nuevo ──
// meta = { id, tipo, cuenta, numero, nCartola, desde, hasta }. Devuelve { error } o { cuenta, ident, cuentaN, nCartola, limpios }
export function limpiarCarga(meta, lista) {
  const c = meta || {}, cuenta = CUENTAS[c.cuenta] ? s(c.cuenta) : '';
  if (!cuenta) return { error: 'Falta la cuenta de la cartola' };
  const ident = texto(c.id, 120);
  if (!ident) return { error: 'Falta el nombre de la cartola' };
  if (!Array.isArray(lista)) return { error: 'Faltan los cargos' };
  if (lista.length > 2000) return { error: 'Son demasiados cargos de una vez (máximo 2000)' };
  const limpios = [];
  for (let i = 0; i < lista.length; i++) {
    const x = lista[i] || {}, monto = Math.round(Number(x.monto)), saldo = Math.round(Number(x.saldo));
    if (!esIso(x.fecha) || !(monto > 0) || isNaN(saldo)) return { error: 'Un cargo no es válido (fila ' + (i + 1) + ')' };
    limpios.push({ cuenta, fecha: x.fecha, descripcion: texto(x.descripcion, 200), monto, saldo, operacion: s(x.operacion).replace(/\D/g, '').slice(0, 20) });
  }
  return { cuenta, ident, cuentaN: s(c.numero).replace(/\D/g, '').slice(-4), nCartola: s(c.nCartola).replace(/[^0-9A-Za-z]/g, '').slice(0, 10), limpios };
}
// existentes: cargos vistaCargo; limpios con { id, huella } ya calculados; reglas: mapaReglas.
// Devuelve { nuevos: [{ id, doc }], cuenta: { cargos, nuevos, yaVistos, ignorados, repetidos, parecidos }, masFuentes }
// v0.67.6 · Un cargo nuevo que es el mismo movimiento que uno de OTRA subida de la misma cuenta (buscarRepetidos) y el par es
// único y claro: nace REPETIDO (apunta al original; no aparece en "Para revisar" ni crea nada). Si el par es dudoso (débil o
// con dos posibles), nace por revisar y la lista propone "Marcar como repetido". Dos iguales de la MISMA subida nunca.
export function planCarga(L, existentes, reglas, ahora, quien) {
  const ya = new Set(), porOp = new Map(), porId = new Map();
  (existentes || []).forEach(c => { ya.add(c.id); porId.set(c.id, c); const k = claveOp(c.cuenta, c.fecha, c.monto, c.operacion); if (k) porOp.set(k, c); });
  const r = { cargos: L.limpios.length, nuevos: 0, yaVistos: 0, ignorados: 0, repetidos: 0, parecidos: 0 }, nuevos = [], masFuentes = [], llegan = [];
  L.limpios.forEach(x => {
    const ko = claveOp(L.cuenta, x.fecha, x.monto, x.operacion);
    if (ya.has(x.id) || (ko && porOp.has(ko))) {
      r.yaVistos++;
      // v0.64.0: el mismo cargo en otra clase de archivo (en línea → histórica): se anota la fuente nueva
      const prev = porId.get(x.id) || (ko && porOp.get(ko));
      if (prev && L.fuente && !fuentesCargo(prev).some(f => f.tipo === L.fuente.tipo)) masFuentes.push({ id: prev.docId || prev.id, fuentes: fuentesCargo(prev).concat([L.fuente]) });
      return;
    }
    ya.add(x.id); if (ko) porOp.set(ko, { id: x.id, fuentes: L.fuente ? [L.fuente] : [] }); porId.set(x.id, { id: x.id, fuentes: L.fuente ? [L.fuente] : [] });
    llegan.push(x);
  });
  // v0.67.6 · ¿Es el mismo movimiento que uno de otra subida (en línea ↔ histórica)?
  const vivos = (existentes || []).filter(c => c.id && !c.quitadoEnPlanilla);
  const vistas = llegan.map(x => ({ id: x.id, cuenta: L.cuenta, fecha: x.fecha, monto: x.monto, descripcion: x.descripcion, operacion: x.operacion, cartola: L.ident, nCartola: L.nCartola, subidaEl: ahora, fuentes: L.fuente ? [L.fuente] : [] }));
  const rep = buscarRepetidos(vistas, vivos, { tomados: tomadosDe(vivos) });
  llegan.forEach(x => {
    const m = rep.get(x.id), auto = m && m.auto ? m : null;
    const regla = reglas[claveDe(x.descripcion)], ign = !auto && regla && regla.accion === 'ignorar';
    const est = auto ? { estado: ESTADOS.repetido, accion: REPETIDO, repetidoDe: auto.original.docId || auto.original.id, detalle: JSON.stringify(detalleRepetido(auto.original, auto.por, 'carga')), resueltoEl: ahora, resueltoPor: POR_REPETIDO }
      : { estado: ign ? ESTADOS.ignorado : ESTADOS.revisar, accion: ign ? 'ignorar' : '', detalle: ign ? JSON.stringify({ motivo: regla.ejemplo || 'No es gasto', regla: true }) : '', resueltoEl: ign ? ahora : '', resueltoPor: ign ? 'regla (siempre)' : '' };
    nuevos.push({ id: x.id, doc: { id: x.id, huella: x.huella, cuenta: L.cuenta, cuentaN: L.cuentaN, fecha: x.fecha, descripcion: x.descripcion, monto: x.monto, saldo: x.saldo, nOperacion: x.operacion,
      cartola: L.ident, nCartola: L.nCartola, subidaEl: ahora, subidaPor: quien, ...(L.fuente ? { fuentes: [L.fuente] } : {}), ...est, historial: '' } });
    if (auto) r.repetidos++; else if (ign) r.ignorados++; else { r.nuevos++; if (m) r.parecidos++; }
  });
  return { nuevos, cuenta: r, masFuentes };
}

// ═══ v0.67.6 · El mismo movimiento en dos cartolas (la en línea y la histórica) ═══
// La huella del cargo lleva la fecha y el saldo: la cartola histórica puede traer el movimiento con la fecha contable (un día
// después) o con otro saldo, y entonces su id es otro. Aquí se reconoce igual:
//  · misma cuenta, mismo monto (todos son cargos: mismo signo), fecha ±1 día y de OTRA subida;
//  · fuerte: el mismo N° de operación (si los dos lo traen), o la glosa igual (normalizada), o el mismo RUT en la glosa.
//    Si los dos traen N° de operación y son distintos, nunca es fuerte (son dos operaciones): a lo más una propuesta;
//  · débil: solo fecha ±1 y monto → propuesta, nunca automático.
export const REPETIDO = 'repetido';
export const POR_REPETIDO = 'Sistema Fën (repetido)';
export const VENTANA_REPETIDO = 1;
const opNorm = op => s(op).replace(/\D/g, '').replace(/^0+/, '');
// a: el que llega (o el que se revisa), b: el posible original. → null | { fuerte, por: operacion|glosa|rut|fecha_monto, dias }
export function mismoMovimiento(a, b) {
  if (!a || !b || s(a.id) === s(b.id)) return null;
  if (s(a.cuenta) !== s(b.cuenta) || !(Number(a.monto) > 0) || Math.round(a.monto) !== Math.round(b.monto)) return null;
  if (!esIso(a.fecha) || !esIso(b.fecha)) return null;
  const d = Math.abs(dias(a.fecha, b.fecha));
  if (d > VENTANA_REPETIDO) return null;
  if (s(a.cartola) && s(a.cartola) === s(b.cartola)) return null;   // la misma subida: son pagos distintos (el aviso "Ojo" los cubre)
  const oa = opNorm(a.operacion), ob = opNorm(b.operacion);
  if (oa && ob) return oa === ob ? { fuerte: true, por: 'operacion', dias: d } : { fuerte: false, por: 'fecha_monto', dias: d };
  const ga = norm(a.descripcion);
  if (ga && ga === norm(b.descripcion)) return { fuerte: true, por: 'glosa', dias: d };
  const ra = rutDe(a.descripcion);
  if (ra && ra === rutDe(b.descripcion)) return { fuerte: true, por: 'rut', dias: d };
  return { fuerte: false, por: 'fecha_monto', dias: d };
}
// Los originales que ya tienen su repetido (un original se empareja una sola vez)
export const tomadosDe = cargos => new Set((cargos || []).filter(c => c.estado === ESTADOS.repetido && c.repetidoDe).map(c => c.repetidoDe));
// nuevos: los que se revisan (vistaCargo o lo que llega); originales: los posibles originales; puede(n, e): e puede ser original de n.
// → Map(n.id → { auto: true, original, por } | { auto: false, candidatos: [{ e, por, fuerte, dias }], ambiguo })
//  · fuerte y único → auto.
//  · varios fuertes: si los del mismo día y la misma glosa son tantos como los iguales que llegan en esa subida (pagos repetidos de
//    verdad, que vienen en las dos cartolas), se emparejan uno a uno → auto. Si no → propuesta (ambiguo).
//  · solo débiles → propuesta. Un original ya emparejado no se marca solo otra vez, pero sí se propone (v0.127.1: tercera copia,
//    p. ej. dos cartolas en línea y la histórica; antes no aparecía "Marcar como repetido"). Primero los libres.
export function buscarRepetidos(nuevos, originales, { tomados, puede } = {}) {
  const ya = new Set(tomados || []), usados = new Set(ya), ahora = new Set(), out = new Map(), ok = puede || (() => true), marcados = new Set();
  const orig = (originales || []).filter(e => e && e.id && e.estado !== ESTADOS.repetido);
  const kG = n => [s(n.cartola), s(n.cuenta), s(n.fecha), Math.round(n.monto), norm(n.descripcion)].join('|');
  const tam = {}; (nuevos || []).forEach(n => { const k = kG(n); tam[k] = (tam[k] || 0) + 1; });
  const ord = (a, b) => a.dias - b.dias || (a.e.estado === ESTADOS.revisar) - (b.e.estado === ESTADOS.revisar) || s(a.e.subidaEl).localeCompare(s(b.e.subidaEl)) || s(a.e.id).localeCompare(s(b.e.id));
  const lista = (nuevos || []).slice().sort((a, b) => s(a.subidaEl).localeCompare(s(b.subidaEl)) || s(a.fecha).localeCompare(s(b.fecha)) || s(a.id).localeCompare(s(b.id)));
  const cands = n => { const no = new Set(n.noRepetidoDe || []);
    return orig.filter(e => !no.has(s(e.docId || e.id)) && !no.has(s(e.id)) && !marcados.has(e.id) && ok(n, e)).map(e => { const m = mismoMovimiento(n, e); return m ? { e, ...m } : null; }).filter(Boolean).sort(ord); };
  const grupos = {};
  // 1) fuertes
  lista.forEach(n => {
    const f = cands(n).filter(x => x.fuerte && !usados.has(x.e.id));
    if (!f.length) return;
    let el = null;
    if (f.length === 1) el = f[0];
    else {
      const k = kG(n);
      if (!grupos[k]) { const g = f.filter(x => x.e.fecha === n.fecha && norm(x.e.descripcion) === norm(n.descripcion)); grupos[k] = { g, ok: g.length > 0 && g.length === tam[k] }; }
      if (grupos[k].ok) el = grupos[k].g.find(x => !usados.has(x.e.id)) || null;
    }
    if (el) { usados.add(el.e.id); ahora.add(el.e.id); marcados.add(n.id); out.set(n.id, { auto: true, original: el.e, por: el.por, dias: el.dias }); }
    else out.set(n.id, { auto: false, ambiguo: true, candidatos: f.slice(0, 3) });
  });
  // 2) débiles (y lo que quedó dudoso): propuesta con los posibles que quedan libres
  lista.forEach(n => {
    const x = out.get(n.id); if (x && x.auto) return;
    const l = cands(n).filter(y => !ahora.has(y.e.id)).sort((a, b) => (ya.has(a.e.id) - ya.has(b.e.id)) || (b.fuerte - a.fuerte) || ord(a, b));
    if (l.length) out.set(n.id, { auto: false, ambiguo: l.filter(y => y.fuerte).length > 1 || (x && x.ambiguo) || false, candidatos: l.slice(0, 3) });
    else out.delete(n.id);
  });
  return out;
}
// Lo que queda en el detalle del repetido (también para mostrar el chip sin buscar el original)
export function detalleRepetido(e, por, como, extra) {
  const f = fuentesCargo(e)[0] || null;
  return { repetidoDe: s(e.docId || e.id), por: s(por), como: s(como), original: { fecha: s(e.fecha), descripcion: s(e.descripcion).slice(0, 120), cartola: s(e.cartola), nCartola: s(e.nCartola), fuente: f, estado: s(e.estado), accion: s(e.accion) }, ...(extra || {}) };
}
// "Repetido de la cartola en línea del 13-10-2026" / "Repetido de la cartola N°053"
export function textoRepetido(det) {
  const f = det && det.original && det.original.fuente;
  if (!f) return 'Repetido de otra cartola';
  if (f.tipo === 'historica') return `Repetido de la cartola N°${f.numero || (det.original.nCartola) || '?'}`;
  return `Repetido de la cartola en línea del ${dma(f.generada || f.subida)}`;
}
export const textoCriterio = por => ({ operacion: 'mismo N° de operación', glosa: 'misma glosa', rut: 'mismo RUT en la glosa', fecha_monto: 'misma fecha (±1 día) y monto' }[por] || '');
// Retroactivo (al listar): los por revisar contra todo lo subido. Un original es uno ya revisado, o uno por revisar subido antes
// (el que llega después queda como repetido, como al subir). cargos: todos (vistaCargo).
export function repetidosAlListar(cargos) {
  const vivos = (cargos || []).filter(c => c.id && !c.quitadoEnPlanilla);
  const antes = (a, b) => (s(a.subidaEl) + '|' + s(a.cartola) + '|' + s(a.id)) < (s(b.subidaEl) + '|' + s(b.cartola) + '|' + s(b.id));
  const pend = vivos.filter(c => c.estado === ESTADOS.revisar);
  return buscarRepetidos(pend, vivos, { tomados: tomadosDe(vivos), puede: (n, e) => e.estado !== ESTADOS.revisar || antes(e, n) });
}
// La fila de la cartola (una vez por cartola y cuenta; una cartola grande llega en partes: la parte 2 en adelante suma)
export function filaCartola(previa, meta, L, r, parte, ahora, quien) {
  const f = { cartola: L.ident, cuenta: L.cuenta, cuentaN: L.cuentaN, tipo: meta.tipo === 'historica' ? 'histórica' : meta.tipo === 'mercadopago' ? 'mercado pago' : 'en línea', nCartola: L.nCartola,
    desde: esIso(meta.desde) ? meta.desde : '', hasta: esIso(meta.hasta) ? meta.hasta : '', cargos: r.cargos, nuevos: r.nuevos, yaVistos: r.yaVistos, ignorados: r.ignorados, subidaEl: ahora, subidaPor: quien };
  if (r.repetidos) f.repetidos = r.repetidos;   // v0.67.6: el mismo movimiento que ya llegó en otra cartola
  if (previa && Number(parte) > 0) ['cargos', 'nuevos', 'yaVistos', 'ignorados', 'repetidos'].forEach(k => { if (f[k] !== undefined || previa[k] !== undefined) f[k] = num(f[k]) + num(previa[k]); });
  return f;
}

// ── Aprender (ccAprender / ccDesaprender) ──
// act: la regla de esa clave (vistaRegla, puede estar quitada) o null. Devuelve los campos del documento de la regla.
export function aprender(act, clave, regla, desc, ahora, quien) {
  const vivo = act && !act.quitada && act.veces > 0;
  const igual = vivo && act.accion === regla.accion && act.item === (regla.item || '') && act.vencimiento === (regla.vencimiento || '');
  return { clave, accion: regla.accion, item: regla.item || '', area: regla.area || '', vencimiento: regla.vencimiento || '', sinFactura: regla.sinFactura ? 'Sí' : '',
    ejemplo: texto(regla.ejemplo || desc, 120), veces: igual ? act.veces + 1 : 1, ultimoMonto: regla.monto || '', actualizado: ahora, por: quien, quitada: '' };
}
// La regla pierde una vez; si queda en cero, queda quitada (en la base no se borra). null = no se toca
export function desaprender(act, accion, ahora, quien) {
  if (!act || act.quitada || act.accion !== accion) return null;
  if (act.veces > 1) return { veces: act.veces - 1, actualizado: ahora, por: quien };
  return { veces: 0, quitada: `${ahora} · ${quien} (deshecho)`, actualizado: ahora, por: quien };
}
// Qué se olvida al deshacer (como ccDeshacer): un "no es gasto" de una vez o uno ignorado por la regla no la toca
export function aDesaprender(c) {
  if (c.estado === ESTADOS.aMedias) return null;
  if (c.accion === 'ignorar') return c.detalle && c.detalle.siempre ? 'ignorar' : null;
  return { vencimientos: 'vencimiento', nuevo: 'gasto', abono: 'abono', [PAGO_TARJETA]: PAGO_TARJETA, [TRASPASO]: TRASPASO, [PREVIRED]: PREVIRED }[c.accion] || null;
}
// "Deshecho … por …: motivo (antes: …)", al final del historial (texto, como la columna Historial)
export function conDeshecho(c, motivo, ahora, quien) {
  const antes = c.accion + (c.detalle ? ' ' + JSON.stringify(c.detalle).slice(0, 300) : '') + ' · ' + c.resueltoEl + ' ' + c.resueltoPor;
  return ((c.historial ? c.historial + '\n' : '') + 'Deshecho ' + ahora + ' por ' + quien + ': ' + motivo + ' (antes: ' + antes + ')').slice(-5000);
}
// Vuelta de resolución: cuántas veces se deshizo. Con ella se arman ids fijos por cargo (un reintento no duplica; después de
// deshacer, la siguiente vez usa otros ids)
export const vuelta = c => (s(c.historial).match(/(^|\n)Deshecho /g) || []).length;
export const marcaDe = (c, k) => ({ t: s(c.id), r: 'r' + vuelta(c) + (k !== undefined ? 'v' + k : '') });

// ── Vencimientos abiertos para la cartola (con su tipo y su documento) ──
// vencs: [{ id, d }] de la base; plantillas: [{ id, d }]; siiRut: { vencId → rut } (facturas del SII importadas)
export function vencimientosAbiertos(vencs, plantillas, siiRut, hoy) {
  const obl = {}; (plantillas || []).forEach(x => { obl[s(x.d.id) || x.id] = x.d; });
  const out = [];
  (vencs || []).forEach(({ id, d }) => {
    if (!d || d.quitadoEnPlanilla || !G3.abierto(d)) return;
    const pid = s(d.plantillaID), o = pid ? obl[pid] : null;
    const tipo = s(d.tipoObligacion) || (o ? G3.tipoDe(o) : '');
    const ma = Array.isArray(d.multiArea) ? d.multiArea : json(d.multiArea);
    const estimado = Array.isArray(ma) && ma.length ? ma.reduce((t, a) => t + num(a.monto), 0) : num(d.montoEstimado);
    const m = /^\s*📋\s*(.*?)\s+F\.(\d+)\s*$/.exec(s(d.nombre));
    const montoDoc = d.documento && num(d.montoDocumento) > 0 ? num(d.montoDocumento) : 0;
    out.push({ id, nombre: s(d.nombre), item: s(d.item), fecha: G3.fechaReal(d), monto: montoDoc || estimado, estimado, plantillaId: pid,
      estado: G3.estadoVista(d, hoy), estadoBase: G3.estadoBase(d), tipoObligacion: pid ? (o && G3.sinClasificar(o) && !s(d.tipoObligacion) ? 'sin_clasificar' : tipo || 'fijo') : '',
      montoDocumento: montoDoc, conDocumento: !!d.documento, area: s(d.area), multiArea: Array.isArray(ma) ? ma : [], pArea1: s(d.pArea1), pPct1: s(d.pPct1), pArea2: s(d.pArea2), pPct2: s(d.pPct2), pArea3: s(d.pArea3), pPct3: s(d.pPct3),   // v0.63.1: para el área del abono
      abonos: Array.isArray(d.abonos) ? d.abonos : [], suelto: d.suelto === true, obs: s(d.obs),
      // v0.64.0: período (abono de sueldo), total y saldo (pagos parciales), certificado de Previred
      periodo: /^\d{4}-\d{2}$/.test(s(d.periodoKey)) ? s(d.periodoKey) : dia(d.fechaVencimiento).slice(0, 7), total: G3.totalVenc(d), saldo: G3.saldoVenc(d), conLineas: G3.conLineas(d), fechaSaldo: dia(d.fechaSaldo),
      // v0.67.0: el total incluye las multas e intereses del comprobante (recargos)
      previred: d.documento && d.documento.tipo === 'previred' && d.documento.previred ? { periodo: s(d.documento.previred.periodo), fechaPago: dia(d.documento.previred.fechaPago), total: D3.totalPlan(d.documento.previred), recargos: num(d.documento.previred.recargos && d.documento.previred.recargos.monto), n: (d.documento.previred.trabajadores || []).length } : null,
      folio: m ? m[2] : s(d.folio), razon: m ? m[1].trim() : s(d.razonSocial).trim(), rut: (siiRut && siiRut[id]) || (d.documento && d.documento.tipo === 'sii' ? rutNorm(d.documento.rut) : '') || rutNorm(d.rutProveedor), sii: '',
      // v0.69.2: las partes ya pagadas (medio, fecha, cargo u origen) y si es un documento pagado en partes
      partes: PM.partesDe(d), enPartes: !!d.pagoEnPartes, deDocumento: PM.esDeDocumento(d),
      fechaDoc: dia(d.fechaCompra) || (d.documento && dia(d.documento.fecha)) || '',   // v0.69.0: la fecha de la factura (para el ritmo de pago)
      // v0.70.0 · Nació de su boleta (luz, agua): sus gastos ya existen; la boleta dice qué cubre (su saldo anterior) y de qué empresa es
      devengado: G3.esDevengado(d), boleta: d.boleta && typeof d.boleta === 'object' ? d.boleta : null, mesBoleta: s(d.boleta && d.boleta.mes) || s(d.periodoKey), empresa: s((o && o.empresa) || (d.boleta && d.boleta.empresa)), cuentaNombre: o ? s(o.nombre) : '',
      // v0.79.0 · Los enlaces que ya guarda (para la Bandeja única: un gasto aparece una sola vez): su documento del SII y sus gastos
      siiDocId: s(d.documento && d.documento.siiDocId) || s(d.siiDocId), gastosDoc: Array.isArray(d.gastosDoc) ? d.gastosDoc.map(String) : [] });
  });
  return out.sort((a, b) => s(a.fecha).localeCompare(s(b.fecha)) || a.id.localeCompare(b.id));
}

// ═══════════════════════════════════════════════
//  Propuestas (forma de trabajar acordada)
// ═══════════════════════════════════════════════
const enVentana = (c, v) => !!v.fecha && dias(c.fecha, v.fecha) >= -VENTANA.antes && dias(c.fecha, v.fecha) <= VENTANA.despues;
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesCorto = f => (esIso(f) ? MESES_C[Number(f.slice(5, 7)) - 1] : '');
const opcion = v => ({ id: v.id, nombre: v.nombre, monto: v.montoDocumento || v.monto || 0, fecha: v.fecha, conDocumento: !!v.conDocumento, tipo: v.tipoObligacion });
const pagoDe = (c, v, por, seguro, texto0) => ({ tipo: 'vencimientos', seguro, pagos: [{ id: v.id, monto: c.monto }], texto: texto0 || v.nombre, por });
// Vencimientos de facturas (sin obligación) que suman exacto el cargo (como cartola.js)
export function combinacion(vencs, monto) {
  const l = vencs.filter(v => v.monto > 0).slice().sort((a, b) => s(a.fecha).localeCompare(s(b.fecha))).slice(0, 12);
  let t = 0;
  for (let i = 0; i < l.length; i++) { t += l[i].monto; if (t === monto) return l.slice(0, i + 1); if (t > monto) break; }
  let mejor = null;
  for (let m = 1; m < (1 << l.length); m++) {
    let x = 0; const el = [];
    for (let i = 0; i < l.length; i++) if (m & (1 << i)) { x += l[i].monto; el.push(i); }
    if (x !== monto) continue;
    const k = el.join(',');
    if (!mejor || el.length < mejor.el.length || (el.length === mejor.el.length && k < mejor.k)) mejor = { el, k };
  }
  return mejor ? mejor.el.map(i => l[i]) : null;
}
// c: cargo (vistaCargo); D: { reglas, vencimientos (vencimientosAbiertos), gastos }. null = sin propuesta.
// Devuelve { tipo: 'vencimientos'|'abono'|'gasto'|'nuevo'|'ignorar', seguro, por, texto, pagos?, vencId?, opciones? }
export function proponer(c, D) {
  const reglas = {}; (D.reglas || []).forEach(r => { if (!r.quitada) reglas[r.clave] = r; });
  const regla = reglas[c.clave || claveDe(c.descripcion)];
  const vencs = D.vencimientos || [];
  // 0) "No es gasto" aprendido
  if (regla && regla.accion === 'ignorar') return { tipo: 'ignorar', seguro: true, motivo: regla.ejemplo || 'No es gasto', por: 'aprendido' };
  // v0.62.0 · Pago de la tarjeta de crédito aprendido (no es gasto: movimiento de flujo)
  if (regla && regla.accion === PAGO_TARJETA) return { tipo: PAGO_TARJETA, seguro: true, texto: regla.ejemplo || 'Pago de tarjeta de crédito', tarjeta: regla.ejemplo || '', por: 'aprendido' };
  // v0.63.1 · Traspaso entre cuentas propias aprendido
  if (regla && regla.accion === TRASPASO) return { tipo: TRASPASO, seguro: true, texto: regla.ejemplo || 'Traspaso entre cuentas propias', nota: regla.ejemplo || '', por: 'aprendido' };
  const aprendidoP = regla && (regla.accion === 'vencimiento' || regla.accion === 'abono') && s(regla.vencimiento).startsWith('p:') ? s(regla.vencimiento).slice(2) : '';
  // 1) Monto fijo: el monto exacto del vencimiento, dentro de la ventana
  const fijos = vencs.filter(v => v.plantillaId && v.tipoObligacion === 'fijo' && v.estadoBase !== 'con_abonos' && v.monto === c.monto && enVentana(c, v));
  if (fijos.length === 1) return pagoDe(c, fijos[0], 'monto fijo', true);
  if (fijos.length > 1) {
    // Varios del mismo monto: lo aprendido decide cuál (sin quitarle la duda: a revisar)
    const ap = fijos.find(v => v.plantillaId === aprendidoP) || fijos[0];
    return { ...pagoDe(c, ap, 'monto fijo', false), opciones: fijos.map(opcion), duda: `Hay ${fijos.length} vencimientos de monto fijo de ${fmt(c.monto)}: revisa cuál es.` };
  }
  // v0.70.0 · Boleta de luz o agua: un cargo igual al total a pagar de una boleta paga todo lo que cubre (su saldo anterior y la
  // boleta del mes), lo más antiguo primero; uno igual al saldo anterior paga solo lo de antes. Listo si la glosa dice la empresa.
  const pBol = BO.propuestaBoleta(c, vencs, regla);
  if (pBol) return pBol;
  // 2) Según documento: por el monto del documento (boleta o SII), ya llegado
  const docs = vencs.filter(v => v.plantillaId && v.tipoObligacion === 'documento');
  const conMonto = docs.filter(v => v.montoDocumento > 0 && v.montoDocumento === c.monto && enVentana(c, v));
  if (conMonto.length === 1) return pagoDe(c, conMonto[0], 'documento', true, `${conMonto[0].nombre} (documento de ${fmt(conMonto[0].montoDocumento)})`);
  // v0.64.0 · Pago de Previred en varios cargos (AFP, IPS, Fonasa, isapre, caja, mutual): se juntan y se comparan con el certificado
  if ((regla && regla.accion === PREVIRED) || esGlosaPrevired(c.descripcion)) {
    const vp = vencPrevired(vencs, c.fecha);
    // v0.65.1: también las planillas ya registradas (meses cargados): la de fecha de pago cercana al cargo o la más reciente sin conciliar
    const op = opcionPropuesta(opcionesPrevired(vencs, D.planillas || []), c.fecha), por = regla && regla.accion === PREVIRED ? 'aprendido' : 'glosa';
    if (op && op.tipo === 'planilla') return { tipo: PREVIRED, seguro: false, opcion: op.id, planillaId: op.planillaId, texto: `${op.nombre} (${textoAvance(avancePlanilla(op.total, op.unido))})`, por };
    if (op && op.tipo === 'venc') return { tipo: PREVIRED, seguro: false, vencId: op.vencId, opcion: op.id, texto: `${op.nombre} (certificado de ${fmt(op.total)})`, por };
    if (vp) return { tipo: PREVIRED, seguro: false, vencId: vp.id, opcion: vp.id, texto: `${vp.nombre} (certificado de ${fmt(vp.previred.total)})`, por };
  }
  // v0.64.0 · El saldo de un vencimiento con abonos (no libre): el último abono lo cierra
  const saldos = vencs.filter(v => v.estadoBase === 'con_abonos' && v.tipoObligacion !== 'libre' && !v.previred && v.saldo > 0 && v.saldo === c.monto && (!c.rut || !v.rut || v.rut === c.rut));
  if (saldos.length === 1) {
    // v0.69.2 · El saldo exacto de un DOCUMENTO que ya tiene partes, con el proveedor del cargo reconocido (RUT o nombre): seguro
    const v = saldos[0], prov = v.deDocumento ? provCargo(c, D) : null, calza = v.deDocumento ? PM.calzaProveedor(c, v, prov, B) : '';
    return { tipo: ABONO_PARCIAL, seguro: !!calza, vencId: v.id, texto: `saldo de ${v.nombre}`, por: 'saldo', ...(v.deDocumento ? { saldoDoc: true, total: v.total, partes: (v.partes || []).length, quien: calza } : {}) };
  }
  // Choque de montos, o lo aprendido apunta a una obligación según documento sin documento todavía: opciones, sin propuesta automática
  // Lo aprendido apunta a una obligación; las de su mismo ítem (Luz Barros y Luz Ainavillo) son las opciones.
  // Sin nada aprendido: las que esperan su documento con un monto estimado parecido (±30%).
  const delAprendido = aprendidoP ? docs.filter(v => v.plantillaId === aprendidoP) : [];
  const itemAp = delAprendido.length ? delAprendido[0].item : '';
  const parecidos = !regla ? docs.filter(v => !v.conDocumento && v.estimado > 0 && Math.abs(v.estimado - c.monto) <= v.estimado * 0.3 && enVentana(c, v)) : [];
  if (conMonto.length > 1 || delAprendido.length || parecidos.length) {
    const ops = conMonto.length > 1 ? conMonto : delAprendido.length ? docs.filter(v => (v.plantillaId === aprendidoP || (itemAp && v.item === itemAp)) && enVentana(c, v)) : parecidos;
    const lista = (ops.length ? ops : delAprendido).slice(0, 6);
    return { tipo: 'vencimientos', seguro: false, sinPropuesta: true, pagos: [], opciones: lista.map(opcion), por: conMonto.length > 1 ? 'documento' : 'aprendido',
      texto: lista.map(v => v.nombre).join(' o '),
      duda: conMonto.length > 1 ? `Los documentos de ${lista.map(v => v.nombre).join(' y ')} son del mismo monto: elige cuál paga.` : `Falta el documento (o no calza el monto): elige cuál paga.` };
  }
  // 3) Libre (sueldos líquidos): lo aprendido propone un abono, nunca seguro
  if (regla && regla.accion === 'abono' && aprendidoP) {
    const l = vencs.filter(v => v.plantillaId === aprendidoP && v.tipoObligacion === 'libre');
    if (l.length) {
      // v0.64.0: el vencimiento del período que corresponde a la fecha del cargo (los sueldos del mes se pagan a inicios del siguiente)
      const v = periodoPropuesto(c, l) || l.slice().sort((a, b) => Math.abs(dias(a.fecha, c.fecha)) - Math.abs(dias(b.fecha, c.fecha)))[0];
      return { tipo: 'abono', seguro: false, vencId: v.id, texto: v.nombre + (v.periodo ? ' · ' + nombrePeriodo(v.periodo) : ''), por: 'aprendido', opciones: l.map(opcion) };
    }
  }
  // 4) Lo aprendido de un vencimiento (fijo o sin clasificar): a revisar si no es el monto exacto
  if (regla && regla.accion === 'vencimiento') {
    const t = s(regla.vencimiento).slice(0, 2), val = s(regla.vencimiento).slice(2);
    const cand = vencs.filter(v => v.tipoObligacion !== 'libre' && v.tipoObligacion !== 'documento' && (t === 'p:' ? v.plantillaId === val : t === 'rut:' ? v.rut === val : norm(v.razon || v.nombre).startsWith(val)));
    if (t === 'p:' && cand.length) {
      const v = cand.slice().sort((a, b) => Math.abs(dias(a.fecha, c.fecha)) - Math.abs(dias(b.fecha, c.fecha)))[0];
      if (Math.abs(dias(c.fecha, v.fecha)) <= 45) return pagoDe(c, v, 'aprendido', false, v.nombre + (v.monto && v.monto !== c.monto ? ` (estimado ${fmt(v.monto)})` : ''));
    }
    const comb = t !== 'p:' ? combinacion(cand, c.monto) : null;
    if (comb) return { tipo: 'vencimientos', seguro: true, pagos: comb.map(v => ({ id: v.id, monto: v.monto })), texto: comb.map(v => v.nombre).join(' + '), por: 'aprendido' };
  }
  // 5) El RUT de la transferencia: facturas de ese proveedor
  if (c.rut) {
    const comb = combinacion(vencs.filter(v => !v.plantillaId && v.rut === c.rut), c.monto);
    if (comb) return { tipo: 'vencimientos', seguro: true, pagos: comb.map(v => ({ id: v.id, monto: v.monto })), texto: comb.map(v => v.nombre).join(' + '), por: 'rut' };
  }
  // 6) Un gasto ya registrado sin cargo, del mismo monto (v0.63.1: también lo pagado por banco a mano, que espera su cargo, y las
  //    facturas del SII ya cargadas que se pagan después; cada uno con su ventana de días): el exacto más cercano
  const pg = B.propuestaGasto(c, D.gastos || []);
  if (pg) {
    const g = pg.a.g;
    return { tipo: 'gasto', seguro: pg.seguro, gasto: g, chip: g.chip, texto: `${g.razon ? g.razon + ' · ' : ''}del ${dma(g.fecha)}` + (pg.otros.length ? ` (hay ${pg.otros.length} más del mismo monto)` : ''), por: pg.por, otros: pg.otros.map(x => x.g) };
  }
  // 6b) v0.67.4 · Una combinación de gastos del proveedor reconocido (factura − nota de crédito, varias facturas): nunca se confirma sola
  const pcb = D.fuente === 'base' ? B.propuestaCombinacion(c, D) : null;   // solo con la base nueva
  if (pcb) return pcb;
  // 7) Gasto nuevo aprendido (seguro con 2 o más veces y el monto parecido al último, ±50%)
  if (regla && regla.accion === 'gasto') return { tipo: 'nuevo', seguro: regla.veces >= 2 && (!regla.monto || Math.abs(c.monto - regla.monto) <= regla.monto * 0.5), item: regla.item, area: regla.area, sinFactura: !!regla.sinFactura, texto: regla.item, por: 'aprendido' };
  // 8) Un vencimiento sin clasificar con el monto exacto: a revisar (el tipo "monto fijo" lo deja seguro)
  const ex = vencs.filter(v => v.tipoObligacion !== 'libre' && v.tipoObligacion !== 'documento' && v.monto === c.monto && enVentana(c, v));
  if (ex.length === 1) return pagoDe(c, ex[0], 'monto', false);
  // 8b) v0.70.0 · Un cargo de una cuenta de boleta reconocida (la glosa dice CGE o ESSBIO, o lo aprendido) que no calza con un total:
  //     paga lo más antiguo primero y lo que no alcanza queda como abono (siempre se revisa)
  const pOrd = BO.propuestaOrden(c, vencs, regla);
  if (pOrd) return pOrd;
  // 9) v0.69.2 · Pago parcial: el proveedor del cargo está reconocido y tiene un documento abierto MAYOR que el cargo (nunca Listo)
  if (D.fuente === 'base') { const pp = PM.propuestaParcial(c, D.gastos || [], vencs, provCargo(c, D), B); if (pp) return pp; }
  return null;
}
// v0.69.2 · El proveedor del cargo (v0.67.4: RUT, glosa aprendida o nombre en la glosa), también con los documentos a crédito
function provCargo(c, D) {
  const vs = (D.vencimientos || []).filter(v => !v.plantillaId && (v.rut || v.razon)).map(v => ({ rut: v.rut, razon: v.razon }));
  const p = B.proveedorDelCargo(c, (D.gastos || []).concat(D.notasCredito || [], vs));
  return p && !p.ambiguo ? p : null;
}
const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');

// ═══ v0.64.0 ═══
export const PREVIRED = 'previred';
export const ABONO_PARCIAL = 'abono_parcial';
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombrePeriodo = p => { const m = /^(\d{4})-?(\d{2})/.exec(s(p)); return m ? `${MESES_L[Number(m[2]) - 1]} ${m[1]}` : s(p); };
const mesAnterior = m => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
// ── Abono de sueldo: los vencimientos libres abiertos de cualquier mes, el más nuevo primero ──
export const libresOrdenados = vencs => (vencs || []).filter(v => v.tipoObligacion === 'libre').slice().sort((a, b) => s(b.periodo).localeCompare(s(a.periodo)) || s(b.fecha).localeCompare(s(a.fecha)) || a.nombre.localeCompare(b.nombre));
// El que corresponde a la fecha del cargo: los sueldos del mes M se pagan a inicios de M+1, así que un cargo del día 15 o antes
// va al vencimiento del mes anterior si sigue abierto; si no, al del mes del cargo. Solo si hay uno claro (null si no).
export function periodoPropuesto(c, libres) {
  if (!c || !esIso(c.fecha) || !(libres || []).length) return null;
  const mes = c.fecha.slice(0, 7), ant = mesAnterior(mes), diaC = Number(c.fecha.slice(8, 10));
  const de = m => libres.filter(v => v.periodo === m);
  for (const m of diaC <= 15 ? [ant, mes] : [mes]) { const l = de(m); if (l.length === 1) return l[0]; if (l.length > 1) return null; }
  return null;
}
// ── Pago de Previred desde la cartola (varios cargos: AFP, IPS, Fonasa, isapre, caja, mutual) ──
export const RE_PREVIRED = /\bAFPS?\b|INSTITUTO DE SEGUR|\bIPS\b|FONASA|\bISAPRES?\b|\bCAJA\b|\bMUTUAL\b|PREVIRED|\bISL\b|\bACHS\b|\bIST\b|HABITAT|PROVIDA|CUPRUM|PLANVITAL|BANMEDICA|COLMENA|CONSALUD|CRUZ BLANCA|VIDA TRES|NUEVA MAS ?VIDA|PAGO DE CUENTAS (AFP|IPS|PREV)/;
export const esGlosaPrevired = desc => RE_PREVIRED.test(norm(desc));
// El vencimiento de Cotizaciones abierto con su certificado (el de fecha más cercana al cargo); null si no hay
export function vencPrevired(vencs, fecha) {
  const l = (vencs || []).filter(v => v.previred && v.previred.total > 0 && v.estadoBase !== 'pagado');
  if (!l.length) return null;
  return l.slice().sort((a, b) => Math.abs(dias(a.fecha, fecha)) - Math.abs(dias(b.fecha, fecha)) || s(b.fecha).localeCompare(s(a.fecha)))[0];
}
// Los cargos por revisar del mismo día (±1) que parecen parte del pago de Previred (por la glosa o lo aprendido)
export function hermanosPrevired(c, cargos, reglas) {
  const R = {}; (reglas || []).forEach(r => { if (!r.quitada) R[r.clave] = r; });
  return (cargos || []).filter(x => x.estado === ESTADOS.revisar && Math.abs(dias(x.fecha, c.fecha)) <= 1 && (x.id === c.id || esGlosaPrevired(x.descripcion) || (R[x.clave || claveDe(x.descripcion)] || {}).accion === PREVIRED));
}
// Los cargos que se pueden juntar con éste (por revisar, ±1 día), los de Previred primero
export const juntablesPrevired = (c, cargos, reglas) => { const h = new Set(hermanosPrevired(c, cargos, reglas).map(x => x.id)); return (cargos || []).filter(x => x.estado === ESTADOS.revisar && Math.abs(dias(x.fecha, c.fecha)) <= 1).sort((a, b) => (h.has(b.id) - h.has(a.id)) || b.monto - a.monto); };
export const TOLERANCIA_PREVIRED = 10;
export function cuadraPrevired(suma, total) { const dif = Math.round(suma - total); return { dif, igual: Math.abs(dif) <= TOLERANCIA_PREVIRED }; }

// ═══ v0.65.1 · Planillas de Previred ya registradas (meses cargados) ═══
// Un mes cargado cuyo certificado ya se pagó (sus gastos por trabajador ya existen, no hay vencimiento abierto) se UNE con
// los cargos del banco: los cargos quedan conciliados (accion 'previred_planilla') y la planilla guarda sus pagos vinculados
// (previred_planillas/{AAAA-MM}: pagos [{ cargoId, monto, fecha, descripcion, cuenta, por, en }], pagosQuitados). No se
// crean gastos. Cuando lo unido iguala el total (±$10) la planilla queda "pagada y conciliada" (su fecha de pago sigue
// siendo la del certificado; las fechas del banco son informativas). Se pueden unir más cargos otro día o de otra cuenta, y
// deshacer cada uno (queda en pagosQuitados).
export const PREVIRED_PLANILLA = 'previred_planilla';
export const VENTANA_PLANILLA = 5;          // días entre la fecha de pago del certificado y el cargo para proponerla
export const HABILES_PLANILLA = 3;         // los cargos de Previred de ±3 días hábiles vienen marcados
const perNorm = p => { const m = /^(\d{4})-?(\d{2})/.exec(s(p)); return m ? `${m[1]}-${m[2]}` : ''; };
// ¿Están a ±N días hábiles? (mismo día = 0; sábado → lunes = 1)
export function habilesDist(a, b) {
  if (!esIso(a) || !esIso(b)) return 99;
  if (a === b) return 0;
  const [x, y] = a < b ? [a, b] : [b, a];
  if (dias(y, x) > 20) return 99;
  return Math.max(1, habilesEntre(x, y));
}
// Pagos unidos de una planilla: los de su documento (vigentes) y, si su vencimiento se pagó con la cartola (v0.64.0), esos cargos
export function pagosDePlanilla(doc, cargos, vencimientoId) {
  const l = (Array.isArray(doc && doc.pagos) ? doc.pagos : []).map(x => ({ cargoId: s(x.cargoId), monto: num(x.monto), fecha: dia(x.fecha), descripcion: s(x.descripcion), cuenta: s(x.cuenta), en: s(x.en), por: s(x.por) })).filter(x => x.cargoId);
  const ya = new Set(l.map(x => x.cargoId));
  if (vencimientoId) (cargos || []).forEach(c => { const g = c.accion === PREVIRED && c.estado !== ESTADOS.revisar && c.detalle && c.detalle.previred; if (g && s(g.vencimientoId) === s(vencimientoId) && !ya.has(c.id)) { ya.add(c.id); l.push({ cargoId: c.id, monto: c.monto, fecha: c.fecha, descripcion: c.descripcion, cuenta: s(c.cuenta), porVencimiento: true }); } });
  return l.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
}
export function avancePlanilla(total, unido) {
  const falta = Math.round(total - unido);
  return { unido: Math.round(unido), total: Math.round(total), falta, completa: unido > 0 && Math.abs(falta) <= TOLERANCIA_PREVIRED };
}
// "Unidos $X de $total · faltan $Y" (o "· pagada y conciliada")
export function textoAvance(a) {
  return `Unidos ${fmt(a.unido)} de ${fmt(a.total)} · ${a.completa ? 'pagada y conciliada' : a.falta > 0 ? `faltan ${fmt(a.falta)}` : `te pasas en ${fmt(-a.falta)}`}`;
}
// periodos: listaCot(…).periodos [{ periodo, fechaPago, total, trabajadores, vencimientoId }]; docs: { AAAA-MM → previred_planillas };
// abiertosIds: Set de vencimientos abiertos; cargos: vistaCargo (para los pagados con la cartola en la v0.64.0)
// v0.67.0: con el comprobante de pago (doc.comprobante), el total es lo pagado (cotizaciones + multas e intereses)
export function planillasPrevired(periodos, docs, abiertosIds, cargos) {
  return (periodos || []).map(P => {
    const per = perNorm(P.periodo), doc = (docs || {})[per] || null, vid = s(P.vencimientoId), comp = doc && doc.comprobante && !doc.comprobante.quitado ? doc.comprobante : null;
    // v0.67.3: sin comprobante, la diferencia del banco registrada como multas e intereses (difMultas) se suma al total
    const dif = !comp && doc && doc.difMultas && !doc.difMultas.quitado ? doc.difMultas : null;
    const cotiz = num(P.cotizaciones !== undefined ? P.cotizaciones : P.total), total = comp ? num(comp.totalPagado) : cotiz + (dif ? num(dif.monto) : 0);
    const pagos = pagosDePlanilla(doc, cargos, vid), av = avancePlanilla(total, pagos.reduce((t, x) => t + x.monto, 0));
    return { id: per, periodo: per, nombre: 'Planilla de ' + nombrePeriodo(per), total, cotizaciones: comp ? num(comp.totalCotizaciones) : cotiz, recargos: comp ? num(comp.totalRecargos) : dif ? num(dif.monto) : 0, conComprobante: !!comp, conDif: !!dif, fueraDePlazo: !!(comp && comp.fueraDePlazo),
      fechaPago: (comp && dia(comp.fechaPago)) || dia(P.fechaPago), n: (P.trabajadores || []).length, vencimientoId: vid, porCsv: !!P.porCsv,
      vencAbierto: !!(vid && abiertosIds && abiertosIds.has(vid)), pagos, unido: av.unido, falta: av.falta, conciliada: av.completa,
      quitados: (Array.isArray(doc && doc.pagosQuitados) ? doc.pagosQuitados : []).length };
  }).filter(x => x.periodo).sort((a, b) => b.periodo.localeCompare(a.periodo));
}
// Las opciones del "Pago de Previred": los vencimientos de Cotizaciones abiertos con su certificado (se PAGAN, como en la
// v0.64.0) y las planillas registradas sin vencimiento abierto (se UNEN, sin gastos). Cada una con su fecha de pago y su avance.
export function opcionesPrevired(vencs, planillas) {
  const vs = (vencs || []).filter(v => v.previred && v.previred.total > 0 && v.estadoBase !== 'pagado');
  const porVenc = {}; (planillas || []).forEach(p => { if (p.vencimientoId) porVenc[p.vencimientoId] = p; });
  const out = vs.map(v => { const pl = porVenc[v.id]; return { tipo: 'venc', id: v.id, vencId: v.id, nombre: v.nombre, periodo: perNorm(v.previred.periodo), total: v.previred.total, recargos: num(v.previred.recargos), n: v.previred.n,
    fechaPago: dia(v.previred.fechaPago) || (pl ? pl.fechaPago : ''), fecha: v.fecha, unido: 0, falta: v.previred.total, conciliada: false }; });
  (planillas || []).filter(p => !p.vencAbierto).forEach(p => out.push({ tipo: 'planilla', id: 'pl:' + p.periodo, planillaId: p.periodo, nombre: p.nombre, periodo: p.periodo, total: p.total, recargos: num(p.recargos), conComprobante: !!p.conComprobante, conDif: !!p.conDif, cotizaciones: num(p.cotizaciones), fueraDePlazo: !!p.fueraDePlazo, n: p.n, fechaPago: p.fechaPago, fecha: p.fechaPago,
    unido: p.unido, falta: p.falta, conciliada: p.conciliada, pagos: p.pagos }));
  return out;
}
// La propuesta: la de fecha de pago (certificado) a −5..+5 días del cargo (la más cercana); si no, el vencimiento abierto más
// cercano (como en la v0.64.0); si no, el mes más reciente sin conciliar completo. null si no hay.
// v0.67.6 · Fuera de los ±5 días manda la más cercana a su fecha de referencia (la fecha de pago o, si no la tiene, su vencimiento:
// el 13 del mes siguiente o el hábil que sigue); a igual distancia, el vencimiento abierto y después el mes más reciente.
export function opcionPropuesta(ops, fecha) {
  const abiertas = (ops || []).filter(o => !o.conciliada);
  if (!abiertas.length) return null;
  const cerca = abiertas.filter(o => esIso(o.fechaPago) && esIso(fecha) && Math.abs(dias(fecha, o.fechaPago)) <= VENTANA_PLANILLA)
    .sort((a, b) => Math.abs(dias(fecha, a.fechaPago)) - Math.abs(dias(fecha, b.fechaPago)) || b.periodo.localeCompare(a.periodo));
  if (cerca.length) return cerca[0];
  if (esIso(fecha)) {
    const d = o => { const r = fechaRefPrevired(o); return esIso(r.fecha) ? Math.abs(dias(fecha, r.fecha)) : 9999; };
    const l = abiertas.slice().sort((a, b) => d(a) - d(b) || ((b.tipo === 'venc') - (a.tipo === 'venc')) || s(b.periodo).localeCompare(s(a.periodo)));
    if (d(l[0]) < 9999) return l[0];
  }
  const vs = abiertas.filter(o => o.tipo === 'venc');
  if (vs.length) return vs.slice().sort((a, b) => Math.abs(dias(a.fecha, fecha)) - Math.abs(dias(b.fecha, fecha)) || s(b.fecha).localeCompare(s(a.fecha)))[0];
  return abiertas.slice().sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
}
// ═══ v0.67.6 · Un cargo lejos de la fecha de pago de la planilla: puede ser de otro mes ═══
// La referencia es la fecha de pago (del certificado, el comprobante o el CSV) con ±10 días; sin fecha de pago, el vencimiento
// esperado (13 del mes siguiente o el hábil que sigue) con ±15 días.
export const LEJOS_PAGO_PREVIRED = 10, LEJOS_VENCE_PREVIRED = 15;
export function fechaRefPrevired(o) {
  const fp = dia(o && o.fechaPago);
  if (esIso(fp)) return { fecha: fp, tipo: 'pago', ventana: LEJOS_PAGO_PREVIRED };
  return { fecha: D3.venceDe(perNorm(o && o.periodo)), tipo: 'vence', ventana: LEJOS_VENCE_PREVIRED };
}
// → null (está cerca o no se sabe) | { tipo: 'pago'|'vence', fecha, dias, ventana }
export function lejosDePrevired(o, fechaCargo) {
  if (!o || !esIso(fechaCargo)) return null;
  const r = fechaRefPrevired(o);
  if (!esIso(r.fecha)) return null;
  const d = Math.abs(dias(fechaCargo, r.fecha));
  return d > r.ventana ? { ...r, dias: d } : null;
}
// Para una planilla registrada: los cargos por revisar de Previred (glosa o lo aprendido) a ±3 días hábiles vienen marcados
export function hermanosPlanilla(c, cargos, reglas) {
  const R = {}; (reglas || []).forEach(r => { if (!r.quitada) R[r.clave] = r; });
  return (cargos || []).filter(x => x.estado === ESTADOS.revisar && habilesDist(x.fecha, c.fecha) <= HABILES_PLANILLA && (x.id === c.id || esGlosaPrevired(x.descripcion) || (R[x.clave || claveDe(x.descripcion)] || {}).accion === PREVIRED));
}
// Los que se pueden unir: los hermanos y los demás por revisar del mismo día (±1); los de Previred primero
export const juntablesPlanilla = (c, cargos, reglas) => { const h = hermanosPlanilla(c, cargos, reglas), ids = new Set(h.map(x => x.id));
  return h.concat((cargos || []).filter(x => !ids.has(x.id) && x.estado === ESTADOS.revisar && Math.abs(dias(x.fecha, c.fecha)) <= 1)).sort((a, b) => (ids.has(b.id) - ids.has(a.id)) || a.fecha.localeCompare(b.fecha) || b.monto - a.monto); };
// ¿Se puede unir? suma de lo marcado contra lo que falta (no se pasa del total más la tolerancia)
// v0.67.3 · conDif: se registra la diferencia como multas e intereses (planilla sin comprobante): el total pasa a ser lo del banco
export function revisarUnion(planilla, suma, conDif) {
  if (!planilla) return { error: 'Esa planilla de Previred ya no está' };
  if (planilla.vencAbierto) return { error: 'Esa planilla tiene su vencimiento de Cotizaciones por pagar: págalo (Pago de Previred) en vez de unir.' };
  if (!(suma > 0)) return { error: 'Marca los cargos del pago' };
  if (conDif) {
    const d = difComoMultas(planilla, suma);
    if (!d.puede) return { error: d.motivo };
    return { avance: avancePlanilla(planilla.unido + suma, planilla.unido + suma), diferencia: d.monto };
  }
  const av = avancePlanilla(planilla.total, planilla.unido + suma);
  if (av.falta < -TOLERANCIA_PREVIRED) return { error: `Con estos cargos se pasa del total de la planilla (${fmt(planilla.total)}) en ${fmt(-av.falta)}: revisa los marcados.` };
  return { avance: av };
}
// v0.67.3 · ¿Se puede registrar la diferencia del banco como multas e intereses? Solo en una planilla SIN comprobante de pago (el
// comprobante trae sus multas) ni diferencia ya registrada, y cuando los cargos se pasan de las cotizaciones en más de $10.
export function difComoMultas(planilla, suma) {
  if (!planilla) return { puede: false, motivo: 'Esa planilla de Previred ya no está' };
  const monto = Math.round((Number(planilla.unido) || 0) + (Number(suma) || 0) - (Number(planilla.total) || 0));
  if (planilla.conComprobante) return { puede: false, monto, motivo: 'Esa planilla tiene su comprobante de pago: las multas e intereses salen de ahí.' };
  if (planilla.conDif) return { puede: false, monto, motivo: 'Esa planilla ya tiene su diferencia registrada como multas e intereses.' };
  if (monto <= TOLERANCIA_PREVIRED) return { puede: false, monto, motivo: 'Los cargos no se pasan de las cotizaciones: no hay diferencia que registrar.' };
  return { puede: true, monto };
}
// ── Origen del cargo: de qué archivo salió ──
// fuentes (v0.64.0, al subir): [{ tipo: historica|enlinea|tef, numero, generada, subida }]; lo de antes se deduce de la cartola
export function fuentesCargo(c) {
  const l = Array.isArray(c && c.fuentes) ? c.fuentes.filter(f => f && f.tipo) : [];
  if (l.length) return l;
  if (!c) return [];
  const gen = /generada (\d{2})\/(\d{2})\/(\d{4})/.exec(s(c.cartola));
  return [{ tipo: c.nCartola ? 'historica' : 'enlinea', numero: s(c.nCartola), generada: gen ? `${gen[3]}-${gen[2]}-${gen[1]}` : '', subida: dia(c.subidaEl) }];
}
export function textoFuente(f) {
  const dm = x => (esIso(x) ? `${x.slice(8, 10)}-${x.slice(5, 7)}` : '');
  if (f.tipo === 'historica') return `Cartola histórica N°${f.numero || '?'}${f.subida ? ` (${dm(f.subida)})` : ''}`;
  if (f.tipo === 'tef') return `Transferencias enviadas del ${dma(f.subida || f.generada)}`;
  if (f.tipo === 'mercadopago') return `Reporte de Mercado Pago (subido el ${dma(f.subida)})`;   // v0.81.1
  return `Cartola en línea del ${dma(f.generada || f.subida)}`;
}
// ¿Viene solo de la cartola en línea? (trae poca información)
export const soloEnLinea = c => { const l = fuentesCargo(c); return l.length > 0 && l.every(f => f.tipo === 'enlinea'); };
// La fuente de una carga: { tipo, numero, generada, subida }
export function fuenteDeCarga(meta, subida) {
  const gen = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s(meta && meta.id).replace(/^.*generada /, ''));
  return { tipo: meta && meta.tipo === 'historica' ? 'historica' : meta && meta.tipo === 'mercadopago' ? 'mercadopago' : 'enlinea', numero: s(meta && meta.nCartola).replace(/[^0-9A-Za-z]/g, '').slice(0, 10), generada: meta && meta.tipo !== 'historica' && gen ? `${gen[3]}-${gen[2]}-${gen[1]}` : '', subida: dia(subida) };
}

// Lo que se aprende al resolver (regla), según la acción
export function reglaDe(accion, c, x) {
  if (accion === 'vencimientos') { const v0 = x.pagados[0]; return { accion: 'vencimiento', vencimiento: v0.plantillaId ? 'p:' + v0.plantillaId : (v0.rut ? 'rut:' + v0.rut : 'n:' + norm(v0.razon || v0.nombre).slice(0, 60)), ejemplo: v0.nombre, monto: c.monto }; }
  if (accion === 'abono') return { accion: 'abono', vencimiento: 'p:' + x.plantillaId, ejemplo: x.nombre, monto: c.monto };
  if (accion === 'nuevo') return { accion: 'gasto', item: x.it0.item, area: x.it0.prorrateo ? JSON.stringify(x.it0.prorrateo) : (x.it0.areas.length === 1 ? x.it0.areas[0].area : ''), sinFactura: !!x.sinFactura, ejemplo: c.descripcion, monto: c.monto };
  if (accion === 'ignorar' && x.siempre) return { accion: 'ignorar', ejemplo: x.motivo };
  if (accion === PAGO_TARJETA) return { accion: PAGO_TARJETA, ejemplo: texto(x && x.tarjeta, 80) || 'Pago de tarjeta de crédito', monto: c.monto };
  if (accion === TRASPASO) return { accion: TRASPASO, ejemplo: texto(x && x.nota, 80) || 'Traspaso entre cuentas propias', monto: c.monto };
  if (accion === PREVIRED) return { accion: PREVIRED, ejemplo: 'Pago de Previred', monto: c.monto };
  return null;
}
// Pagos de varios vencimientos: revisa como ccPagarVencimientos. vs: { id → vencimiento abierto (vencimientosAbiertos) }
export function revisarPagos(pagos, c, vs) {
  if (!Array.isArray(pagos) || !pagos.length || pagos.length > 20) return { error: 'Elige el o los vencimientos que paga este cargo' };
  const vistos = new Set(), out = [];
  let suma = 0;
  for (const p of pagos) {
    const id = s(p && p.id), monto = Math.round(Number(p && p.monto));
    if (!id || vistos.has(id)) return { error: 'Vencimiento repetido o vacío' };
    vistos.add(id);
    if (!(monto > 0)) return { error: 'Cada vencimiento necesita su monto' };
    const v = vs[id];
    if (!v) return { error: 'Un vencimiento ya no está por pagar. Recarga la lista.', code: 'pagado' };
    if (v.tipoObligacion === 'libre') return { error: `"${v.nombre}" es de tipo libre: asígnale el cargo como abono.` };
    // v0.70.0 · Lo nacido de su boleta: se paga completo o en partes (abono con su saldo), lo más antiguo primero
    if (v.devengado) {
      if (monto > v.saldo + 1) return { error: `"${v.nombre}" tiene ${v.saldo} por pagar y este cargo le asigna ${monto}.` };
      out.push({ v, monto, abono: v.estadoBase === 'con_abonos' || monto < v.saldo }); suma += monto; continue;
    }
    if (v.estadoBase === 'con_abonos') return { error: `"${v.nombre}" tiene abonos: agrega otro abono o ciérralo.` };
    if (!v.plantillaId && !v.suelto && v.monto && Math.abs(v.monto - monto) > 1) return { error: `"${v.nombre}" es de ${v.monto}: una factura o compra a crédito se paga completa (este cargo le asigna ${monto}).` };
    out.push({ v, monto }); suma += monto;
  }
  if (suma !== c.monto) return { error: `Los vencimientos suman ${suma} y el cargo es de ${c.monto}` };
  return { pedidos: out };
}
// Reparto por área de un pago de obligación con varias áreas: en la proporción de lo estimado (como el script)
export function repartoPago(multiArea, monto) {
  const l = Array.isArray(multiArea) ? multiArea : json(multiArea);
  if (!Array.isArray(l) || !l.length) return [];
  const est = l.reduce((t, a) => t + num(a.monto), 0);
  let resto = monto;
  return l.map((a, j) => { const m = j === l.length - 1 ? resto : Math.round(monto * (est ? num(a.monto) / est : 1 / l.length)); resto -= m; return { area: s(a.area), monto: m }; });
}

// Resumen de lo que se va a confirmar de una vez: cuántos, cuánto y de qué tipo
export function resumenLote(lista) {
  const r = { n: lista.length, monto: 0, porTipo: {} };
  lista.forEach(x => { r.monto += x.c.monto; r.porTipo[x.p.tipo] = (r.porTipo[x.p.tipo] || 0) + 1; });
  return r;
}
// Gastos al contado de los últimos 5 meses sin cartola, agrupados por registro (para "ya estaba en Gastos")
export function gastosSinCartola(gastos, hoy) {
  const corte = G3.sumarDias(hoy, -150), porRegistro = {}, out = [];
  (gastos || []).forEach(({ id, d }) => {
    if (!d || d.estado !== 'vigente' || d.quitadoEnPlanilla || s(d.cartola).match(/\[cc[0-9a-f]{10}\]/) || d.cartolaCargo) return;
    const f = dia(d.fecha), monto = num(d.montoFinal);
    if (!f || f < corte || s(d.formaPago) !== 'contado' || !(monto > 0)) return;
    const k = [f, s(d.hora), s(d.observacion), s(d.urlFoto), s(d.rutProveedor)].join('|');
    let x = porRegistro[k];
    if (!x) { x = porRegistro[k] = { fecha: f, hora: s(d.hora).slice(0, 5), items: [], monto: 0, obs: s(d.observacion), rut: rutNorm(d.rutProveedor), razon: s(d.razonSocial), folio: s(d.folio), filas: [] }; out.push(x); }
    if (x.filas.length >= 40) return;
    x.filas.push({ fila: id, id, version: Number(d.version) || 0, item: s(d.itemGasto), area: s(d.area), monto }); x.monto += monto;
    if (!x.items.includes(s(d.itemGasto))) x.items.push(s(d.itemGasto));
  });
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 800);
}
