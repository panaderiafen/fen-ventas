// ═══════════════════════════════════════════════
//  Sistema Fën · bandeja-gastos-modelo.js · v0.79.0 (Gastos, etapa B: la Bandeja única)
//  Puro (sin Firebase ni DOM): lo usan la app y las pruebas.
//  Un gasto de verdad vivía en cuatro lugares con cuatro nombres (el documento del SII "por clasificar", el vencimiento "por pagar",
//  el cargo del banco "por calzar" y el gasto "registrado"). Aquí se juntan en UN ítem por gasto, con su paso en la ruta:
//    1 Llegó · 2 Clasificado · 3 Pagado (falta el banco) · 4 Conciliado.
//  Se arma SOLO con lo que la Bandeja ya tiene en la memoria (la lista de la cartola, Pagos sin banco y los documentos sin cuenta
//  recurrente): no lee nada ni cambia ningún dato.
//  Cómo se reconoce que dos cosas son el mismo gasto (los campos de enlace que ya existen):
//   · documento del SII ↔ vencimiento: documento.siiDocId, o el mismo RUT y folio, o el mismo folio y razón social;
//   · vencimiento ↔ gastos: gasto.vencimientoId o vencimiento.gastosDoc;
//   · documento del SII ↔ gastos: gasto.siiDoc.id, o el mismo RUT y folio;
//   · Pagos sin banco: su docId (el documento del SII o "f:RUT|folio") y sus gastos; un saldo vencido, su vencimiento;
//   · documento sin cuenta recurrente ↔ documento del SII: siiDocId;
//   · gasto ↔ cargo del banco: la propuesta de la Bandeja para ese cargo (o, sin propuesta, el mismo monto en su ventana).
//  Todo lo unido por alguno de esos campos es UN ítem (aunque esté en tres colecciones).
// ═══════════════════════════════════════════════
import { VENTANAS, claveFactura } from './gastos-banco.js?v=0.138.0';

const s = v => String(v == null ? '' : v);
const n = v => Number(v) || 0;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const esIso = f => /^\d{4}-\d{2}-\d{2}/.test(s(f));
const dia = f => (esIso(f) ? s(f).slice(0, 10) : '');
export const diaTxt = f => (esIso(f) ? `${Number(s(f).slice(8, 10))} ${MESES[Number(s(f).slice(5, 7)) - 1]}` : '');
export const pesos = v => { const x = Math.round(n(v)); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('es-CL'); };
const utc = f => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
export const diasEntre = (a, b) => (esIso(a) && esIso(b) ? Math.round((utc(dia(b)) - utc(dia(a))) / 864e5) : NaN);
export const sumarDias = (f, k) => (esIso(f) ? new Date(utc(dia(f)) + k * 864e5).toISOString().slice(0, 10) : '');
const rutNorm = r => s(r).toUpperCase().replace(/[^0-9K]/g, '');
const limpio = t => s(t).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').replace(/\s{2,}/g, ' ').trim();
const norm = t => s(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// ═══ La ruta ═══
export const PASOS = [[1, 'Llegó'], [2, 'Clasificado'], [3, 'Pagado (falta el banco)'], [4, 'Conciliado']];
export const nombrePaso = k => (PASOS.find(p => p[0] === k) || [0, ''])[1];
// Los filtros (pastillas), en orden. "Todo" es la suma de los cuatro de lo que falta (cada cosa está en uno solo).
export const FILTROS = [['todo', 'Todo'], ['clasificar', 'Por clasificar'], ['pagar', 'Por pagar'], ['calzar', 'Por calzar con el banco'], ['sinbanco', 'Sin pago en banco'], ['listos', 'Ya listos (30 días)']];
export const GRUPOS = ['clasificar', 'pagar', 'calzar', 'sinbanco'];
export const DIAS_LISTOS = 30;      // "Ya listos": lo conciliado o pagado en los últimos 30 días
export const DIAS_POR_PAGAR = 7;    // lo por pagar entra a la Bandeja desde 7 días antes de su fecha (lo de después sigue en Por pagar)
export const VENTANA_MONTO = [-20, 60];   // v0.81.0: desde 20 días antes (Mercado Pago: la factura llega después del pago)
export const ORIGENES = { sii: 'Factura del SII', boleta: 'Boleta', previred: 'Previred', mano: 'A mano', cuenta: 'Cuenta recurrente' };

// ═══ Las claves de enlace de cada cosa ═══
const kF = (rut, folio) => (rutNorm(rut) && s(folio) ? 'f:' + rutNorm(rut) + '|' + s(folio) : '');
const kFR = (folio, razon) => (s(folio) && norm(razon) ? 'fr:' + claveFactura(folio, razon) : '');
const nombreFolio = nombre => { const m = /^\s*(.*?)\s+F\.\s*(\d+)\s*$/.exec(limpio(nombre)); return m ? { razon: m[1].trim(), folio: m[2] } : null; };
// Lo que dice una propuesta de cargo (Cartola.proponer + reglas): a qué claves apunta
export function destinosDe(p) {
  if (!p) return [];
  const out = [], add = k => { if (k && !out.includes(k)) out.push(k); };
  const filas = g => ((g && g.filas) || []).forEach(f => add('g:' + s(f.id || f.fila)));
  switch (p.tipo) {
    case 'vencimientos': (p.pagos || []).forEach(x => add('v:' + s(x.id))); break;
    case 'gasto': filas(p.gasto); (p.grupos || []).forEach(filas); if (p.docId) add('s:' + p.docId); break;
    case 'sii_pend': add('s:' + s(p.docId)); break;
    case 'abono': case 'abono_parcial': add('v:' + s(p.vencId)); break;
    case 'previred': add(/^pl:/.test(s(p.opcion)) ? s(p.opcion) : 'v:' + s(p.vencId)); break;
    case 'pago_parcial': if (p.doc && p.doc.tipo === 'venc') add('v:' + s(p.doc.vencId)); else if (p.doc && p.doc.clave) add('g:' + s(p.doc.clave).split('|')[3]); break;
    default: break;
  }
  return out;
}
// Las opciones de una propuesta sin decidir ("Elige cuál paga"): candidatas, no pareja
export const opcionesDe = p => (p && p.sinPropuesta ? (p.opciones || []).map(o => 'v:' + s(o.id)) : []);

// ═══ Unir: claves compartidas → un solo ítem ═══
function uniones() {
  const padre = new Map();
  const raiz = x => { let r = x; while (padre.get(r) !== r) r = padre.get(r); let y = x; while (padre.get(y) !== r) { const z = padre.get(y); padre.set(y, r); y = z; } return r; };
  const nodo = x => { if (!padre.has(x)) padre.set(x, x); return x; };
  return { nodo, raiz: x => raiz(nodo(x)), unir: (a, b) => { const ra = raiz(nodo(a)), rb = raiz(nodo(b)); if (ra !== rb) padre.set(ra, rb); } };
}

// ═══ El modelo ═══
// E = { hoy,
//   siiPendientes   (D.siiPendientes: documentos del SII por clasificar),
//   vencimientos    (D.vencimientos: vencimientos abiertos, con folio, RUT, siiDocId y gastosDoc),
//   vencsInfo       ({ id → { sePagaPor, origenPor, cuentaNombre, estado } } de Gastos.datos; opcional),
//   gastos          (D.gastos: los gastos sin cargo agrupados por registro), notasCredito (D.notasCredito),
//   planillas       (D.planillas: Previred ya registrado con sus pagos del banco),
//   sinBanco        (Pagos sin banco: la lista; null = todavía no se sabe), pagos (sii_pagos),
//   docsPend        (documentos sin cuenta recurrente, pendientes; null = todavía no se sabe),
//   cargos          (D.cargos: los de la lista, con su estado), props ({ cargoId → propuesta }), pt ({ cargoId → { valor } }),
//   clase ({ cargoId → listo|revisar|sin }), alt ({ cargoId → [{ p, pt }] }),
//   registrados     (D.registrados: lo ya pagado, para "Ya listos") }
// → { items (lo que falta, sin "Ya listos"), listos, cargos (los por revisar, con sus ítems), porKey, porCargo, sueltos, n, masAdelante }
// v0.81.0 · El primer día del mes anterior a hoy ('2026-10-22' → '2026-09-01')
export const desdeMesAnterior = hoy => { const [y, m] = dia(hoy).split('-').map(Number); if (!y) return '9999-99-99'; const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 10); };
export function armar(E = {}) {
  const hoy = dia(E.hoy) || '0000-00-00', U = uniones(), cosas = [];
  // v0.82.0 · Inicio del sistema: lo anterior no se pide (salvo lo que todavía se debe: vencimientos y facturas del SII esperando su pago)
  const ini = dia(E.inicio) || '0000-00-00', antes = f => !!(dia(f) && dia(f) < ini);
  const add = (tipo, x, claves) => { const ks = claves.filter(Boolean); const c = { tipo, x, claves: ks, nodo: tipo + '#' + cosas.length }; cosas.push(c); U.nodo(c.nodo); ks.forEach(k => U.unir(c.nodo, k)); return c; };
  // Documentos del SII por clasificar (las notas de crédito no van solas: se descuentan de su factura)
  (E.siiPendientes || []).forEach(v => { if (v.esNC || !(n(v.total) > 0) || antes(v.fecha)) return; add('sii', v, ['s:' + v.id, kF(v.rut, v.folio), kFR(v.folio, v.razonSocial)]); });
  // Vencimientos abiertos
  (E.vencimientos || []).forEach(v => {
    const nf = nombreFolio(v.nombre), folio = s(v.folio) || (nf ? nf.folio : ''), razon = s(v.razon) || (nf ? nf.razon : '');
    add('venc', v, ['v:' + v.id, v.siiDocId ? 's:' + v.siiDocId : '', folio ? kF(v.rut, folio) : '', folio ? kFR(folio, razon) : ''].concat((v.gastosDoc || []).map(id => 'g:' + id)));
  });
  // Gastos sin cargo (lo pagado o por pagar que espera el banco), dentro de la ventana que usa hoy "Ya está en Gastos"
  // (lo que ya se marcó pagado en efectivo o con tarjeta no espera ningún cargo: está en "Ya listos")
  const sinBancoYa = new Set((E.registrados || []).filter(r => r.tipo === 'gasto' && ['efectivo', 'tarjeta', 'mercadopago', 'personal'].includes(r.estado)).flatMap(r => r.ids || []));
  (E.gastos || []).forEach(g => {
    if (!(g.monto > 0) || g.clase === 'efectivo') return;
    if (antes(g.fecha) && g.clase !== 'sii') return;   // v0.82.0: pagado antes del inicio (sin su cargo): no se pide
    if ((g.filas || []).length && g.filas.every(f => sinBancoYa.has(s(f.id || f.fila)))) return;
    const vent = (VENTANAS[g.clase] || VENTANAS.contado)[1];
    // v0.81.0 · Lo del mes pasado y de este no sale solo de la Bandeja (aunque pase su ventana): espera que digas qué pasó
    if (!(diasEntre(g.fecha, hoy) <= vent) && !(dia(g.fecha) >= desdeMesAnterior(hoy))) return;
    add('gasto', g, (g.filas || []).map(f => 'g:' + s(f.id || f.fila)).concat([g.vencimientoId ? 'v:' + g.vencimientoId : '', g.siiDocId ? 's:' + g.siiDocId : '', g.folio && !g.esNC ? kF(g.rut, g.folio) : '']));
  });
  // Previred ya registrado sin vencimiento abierto que todavía no tiene todos sus pagos del banco (de los últimos 60 días)
  (E.planillas || []).forEach(p => {
    if (p.vencAbierto || p.conciliada || !(n(p.total) > 0)) return;
    const ref = dia(p.fechaPago) || (s(p.periodo) + '-28');
    if (!(diasEntre(ref, hoy) <= 60) || antes(ref)) return;
    add('planilla', p, ['pl:' + p.periodo, p.vencimientoId ? 'v:' + p.vencimientoId : '']);
  });
  // Pagos sin banco
  const sinB = Array.isArray(E.sinBanco) ? E.sinBanco : [];
  sinB.forEach(x => {
    if (antes(x.fecha) && !x.saldo) return;   // v0.82.0
    const ks = (x.gastos || []).map(id => 'g:' + id);
    if (x.saldo) ks.push('v:' + x.vencId);
    else if (/^f:/.test(s(x.docId))) ks.push(s(x.docId));
    else ks.push('s:' + s(x.docId));
    if (x.siiDocId) ks.push('s:' + x.siiDocId);
    if (!x.saldo && x.folio) ks.push(kF(x.rut, x.folio));
    add('sinb', x, ks);
  });
  // Documentos sin cuenta recurrente (boletas que no calzaron con ninguna)
  (Array.isArray(E.docsPend) ? E.docsPend : []).forEach(x => { if (x.estado && x.estado !== 'pendiente') return; add('doc', x, ['d:' + x.id, x.siiDocId ? 's:' + x.siiDocId : '']); });

  // Los componentes: un ítem por cada grupo de cosas unidas
  const comp = new Map();
  cosas.forEach(c => { const r = U.raiz(c.nodo); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(c); });
  const info = E.vencsInfo || {};
  let items = [...comp.values()].map(l => itemDe(l, hoy, info)).filter(Boolean);
  const claveItem = new Map();
  items.forEach(it => it.claves.forEach(k => claveItem.set(k, it)));
  // Notas de crédito sin cargo: se muestran en el ítem de su factura (por la referencia o por la combinación del cargo)
  (E.notasCredito || []).forEach(g => {
    const it = (g.refs || []).map(f => items.find(x => x.folio === s(f) && (!g.rut || !x.rut || x.rut === g.rut))).find(Boolean);
    if (it) { it.ncs.push({ folio: g.folio, monto: g.monto }); (g.filas || []).forEach(f => claveItem.set('g:' + s(f.id || f.fila), it)); }
  });

  // El banco: cada cargo por revisar con su ítem (la propuesta de la Bandeja; sin ella, el mismo monto en su ventana)
  const props = E.props || {}, pt = E.pt || {}, cl = E.clase || {}, alt = E.alt || {};
  const pend = (E.cargos || []).filter(c => c.estado === 'POR_REVISAR' && !antes(c.fecha));
  const conProps = !!E.props;
  const porCargo = {}, enlaza = (c, it, principal, valor, por) => {
    if (!it || it.grupo === 'listos') return;
    if (it.cargos.some(x => x.id === c.id)) return;
    it.cargos.push({ id: c.id, fecha: dia(c.fecha), monto: n(c.monto), descripcion: s(c.descripcion), principal, valor: isFinite(valor) ? Math.round(valor) : null, por, clase: cl[c.id] || '' });
    (porCargo[c.id] = porCargo[c.id] || []).push({ key: it.key, principal });
  };
  pend.forEach(c => {
    const p = props[c.id], ds = destinosDe(p);
    const its = [...new Set(ds.map(k => claveItem.get(k)).filter(Boolean))];
    its.forEach(it => enlaza(c, it, true, pt[c.id] && pt[c.id].valor, p && p.por));
    // Una combinación (factura − nota de crédito): la NC se muestra en el ítem de su factura
    ((p && p.grupos) || []).filter(g => g && (g.nc || n(g.monto) < 0)).forEach(g => its.forEach(it => { if (!it.ncs.some(x => x.folio === s(g.folio))) it.ncs.push({ folio: s(g.folio), monto: Math.round(n(g.monto)) }); }));
    // Las alternativas (reglas que chocan, otros del mismo monto) y las opciones sin decidir: candidatas
    (alt[c.id] || []).forEach(a => destinosDe(a.p).forEach(k => enlaza(c, claveItem.get(k), false, a.pt && a.pt.valor, a.p && a.p.por)));
    opcionesDe(p).forEach(k => enlaza(c, claveItem.get(k), false, null, 'opcion'));
  });
  // Sin propuesta que apunte a un ítem: el mismo monto (±$1) en su ventana. Con las propuestas de la Bandeja es solo candidata;
  // sin ellas (Hoy) es pareja si es la única de los dos lados.
  const libres = pend.filter(c => !(porCargo[c.id] || []).some(x => x.principal));
  const montoDe = it => it.pendiente;
  const cand = c => items.filter(it => it.grupo !== 'listos' && Math.abs(montoDe(it) - n(c.monto)) <= 1 && (() => { const d = diasEntre(it.fecha, c.fecha); return isFinite(d) && d >= VENTANA_MONTO[0] && d <= VENTANA_MONTO[1]; })());
  const candDe = new Map(libres.map(c => [c.id, cand(c)]));
  libres.forEach(c => {
    const l = candDe.get(c.id);
    l.forEach(it => {
      const unico = !conProps && l.length === 1 && libres.filter(o => (candDe.get(o.id) || []).includes(it)).length === 1 && !it.cargos.some(x => x.principal);
      enlaza(c, it, unico, null, 'monto');
    });
  });
  // Lo por pagar que vence más adelante sale de la Bandeja (sigue en Por pagar), salvo que un cargo ya lo muestre
  const masAdelante = items.filter(it => it.lejos && !it.cargos.length);
  items = items.filter(it => !(it.lejos && !it.cargos.length));
  // Con su cargo: la próxima acción es calzar (lo por clasificar sigue en "Por clasificar": se clasifica al calzar)
  items.forEach(it => {
    const par = it.cargos.filter(x => x.principal).sort((a, b) => (b.valor || 0) - (a.valor || 0))[0] || null;
    it.cargos.sort((a, b) => (b.principal - a.principal) || ((b.valor || 0) - (a.valor || 0)));
    it.par = par;
    // con su cargo: calzar; lo que todavía no se clasifica sigue en "Por clasificar" (se clasifica al calzar)
    if (par) it.grupo = it.paso === 1 && (it.tipo === 'sii' || it.tipo === 'sinbanco' || it.tipo === 'doc') ? 'clasificar' : 'calzar';
    it.accion = accionDe(it);
  });
  items.sort(ordenItems);
  const sueltos = pend.filter(c => !(porCargo[c.id] || []).some(x => x.principal)).map(c => c.id);
  const listos = listosDe(E, hoy);
  const nn = { clasificar: 0, pagar: 0, calzar: 0, sinbanco: 0 };
  items.forEach(it => { nn[it.grupo]++; });
  nn.calzar += sueltos.length;
  const N = { todo: nn.clasificar + nn.pagar + nn.calzar + nn.sinbanco, ...nn, listos: listos.length, cargos: pend.length, sueltos: sueltos.length, items: items.length };
  const porKey = {}; items.concat(listos).forEach(it => { porKey[it.key] = it; });
  return { items, listos, porKey, porCargo, sueltos, n: N, masAdelante: masAdelante.map(it => ({ key: it.key, titulo: it.titulo, fecha: it.fecha, monto: it.monto })), sabeSinBanco: Array.isArray(E.sinBanco), sabeDocs: Array.isArray(E.docsPend) };
}
const ORDEN_G = { clasificar: 0, sinbanco: 1, calzar: 2, pagar: 3, listos: 4 };
function ordenItems(a, b) {
  return (ORDEN_G[a.grupo] - ORDEN_G[b.grupo]) || s(a.fecha).localeCompare(s(b.fecha)) || s(a.key).localeCompare(s(b.key));
}

// El ítem de un grupo de cosas unidas
function itemDe(l, hoy, info) {
  const de = t => l.filter(c => c.tipo === t).map(c => c.x);
  const sii = de('sii')[0] || null, vencs = de('venc'), gastos = de('gasto'), sinb = de('sinb')[0] || null, doc = de('doc')[0] || null, pl = de('planilla')[0] || null;
  const venc = vencs.slice().sort((a, b) => s(a.fecha).localeCompare(s(b.fecha)))[0] || null, g = gastos[0] || null;
  const vi = venc ? info[venc.id] || {} : {};
  const claves = [...new Set(l.flatMap(c => c.claves))];
  const it = { key: '', claves, tipo: '', titulo: '', sub: '', monto: 0, pendiente: 0, fecha: '', origen: 'mano', paso: 1, grupo: 'clasificar', folio: '', rut: '', razon: '', vence: '', dias: null,
    ids: { siiDoc: sii ? sii.id : (sinb && sinb.porClasificar ? sinb.docId : ''), venc: venc ? venc.id : (sinb && sinb.saldo ? sinb.vencId : ''), vencs: vencs.map(v => v.id), gastos: [...new Set(gastos.flatMap(x => (x.filas || []).map(f => s(f.id || f.fila))).concat(sinb ? sinb.gastos || [] : []))], sinb: sinb ? sinb.docId : '', doc: doc ? doc.id : '', planilla: pl ? pl.periodo : '' },
    ref: { sii, venc, gasto: g, sinb, doc, planilla: pl }, cargos: [], ncs: [], par: null, lejos: false, estado: '' };
  // Lo que se sabe del documento
  const nf = venc ? nombreFolio(venc.nombre) : null;
  it.folio = s((sii && sii.folio) || (sinb && sinb.folio) || (venc && (venc.folio || (nf && nf.folio))) || (g && g.folio) || (doc && doc.folio));
  it.razon = limpio((sii && sii.razonSocial) || (sinb && sinb.razonSocial) || (venc && (venc.razon || (nf && nf.razon))) || (g && g.razon) || (doc && (doc.razonSocial || doc.empresa)));
  it.rut = rutNorm((sii && sii.rut) || (sinb && sinb.rut) || (venc && venc.rut) || (g && g.rut) || (doc && doc.rut));
  // El origen
  if (pl || (venc && (venc.previred || /COTIZACI|PREVIRED/i.test(s(venc.item) + ' ' + s(venc.nombre))))) it.origen = 'previred';
  else if (doc || (venc && (venc.boleta || venc.empresa))) it.origen = 'boleta';
  else if (sii || sinb || (g && (g.clase === 'sii' || g.siiDocId)) || (venc && it.folio && (venc.rut || s(vi.origenPor) === 'factura'))) it.origen = 'sii';
  else if (venc && venc.plantillaId) it.origen = 'cuenta';
  else it.origen = 'mano';
  // El título: proveedor + documento
  const docTxt = it.folio ? `F. ${it.folio}` : '';
  if (pl) { it.titulo = `Previred · ${s(pl.nombre).replace(/^Planilla de /, '')}`; }
  else if (doc && !sii && !venc) it.titulo = [limpio(doc.empresa) || (doc.tipo === 'sii' ? limpio(doc.razonSocial) || 'Factura del SII' : 'Boleta'), doc.numero ? 'N° ' + doc.numero : doc.folio ? 'F. ' + doc.folio : ''].filter(Boolean).join(' · ');
  else if (venc && !it.folio) it.titulo = limpio(venc.cuentaNombre && venc.boleta ? `${venc.cuentaNombre}` : venc.nombre);
  else if (it.razon || docTxt) it.titulo = [it.razon || 'Proveedor', docTxt].filter(Boolean).join(' · ');
  else if (g) it.titulo = (g.items || []).filter(Boolean).join(' + ') || 'Gasto';
  else it.titulo = 'Gasto';
  // Montos y fechas
  const total = sii ? n(sii.total) : sinb ? n(sinb.saldo ? sinb.total : sinb.total) : venc ? n(venc.total || venc.monto) : g ? n(g.monto) : pl ? n(pl.total) : doc ? n(doc.monto) : 0;
  it.monto = Math.round(total);
  const saldoV = venc && venc.estadoBase === 'con_abonos' && n(venc.saldo) > 0 ? n(venc.saldo) : null;
  it.pendiente = Math.round(sinb && sinb.saldo ? n(sinb.monto) : saldoV !== null ? saldoV : pl ? Math.max(0, n(pl.falta)) : venc && !sii && !g ? n(venc.monto) : total);
  it.fecha = dia((sii && sii.fecha) || (sinb && (sinb.saldo ? sinb.fechaFactura : sinb.fecha)) || (g && g.fecha) || (venc && (venc.fechaDoc || venc.fecha)) || (pl && pl.fechaPago) || (doc && (doc.fechaVencimiento || ''))) || dia(venc && venc.fecha) || '';
  it.vence = dia((venc && venc.fecha) || (sii && sii.credito && sii.fechaVenc) || (doc && doc.fechaVencimiento) || (sinb && sinb.fechaVenc)) || '';
  // El paso y el grupo (cada cosa en un solo grupo)
  const espera = !!(venc && (venc.estadoBase === 'esperando_documento' || vi.estadoBase === 'esperando_documento'));
  if (sinb) { it.tipo = 'sinbanco'; it.grupo = 'sinbanco'; it.paso = sinb.porClasificar ? 1 : 2; it.dias = n(sinb.dias); }
  else if (sii) { it.tipo = 'sii'; it.grupo = 'clasificar'; it.paso = 1; }
  else if (doc) { it.tipo = 'doc'; it.grupo = 'clasificar'; it.paso = 1; }
  else if (venc) {
    it.tipo = 'venc'; it.grupo = 'pagar'; it.paso = espera ? 1 : 2;
    // con su gasto registrado y pagado a mano por banco: espera su cargo
    if (g && (g.clase === 'espera' || g.clase === 'vencimiento')) { it.grupo = 'calzar'; it.paso = 3; }
    it.lejos = !g && !sii && !(venc.estadoBase === 'con_abonos') && !!dia(venc.fecha) && diasEntre(hoy, venc.fecha) > DIAS_POR_PAGAR;
  }
  else if (pl) { it.tipo = 'planilla'; it.grupo = 'calzar'; it.paso = 3; }
  else if (g) { it.tipo = 'gasto'; it.grupo = 'calzar'; it.paso = 3; }
  else return null;
  // La línea de abajo: de dónde viene, cuándo y qué falta
  const partes = [];
  if (it.tipo === 'sii' || (it.tipo === 'sinbanco' && sinb.porClasificar)) {
    const v = sii || sinb.v || {};
    partes.push('Factura del SII', diaTxt(it.fecha));
    const det = (v.detalle || []).slice(0, 2).map(d => limpio(d.descripcion)).filter(Boolean);
    if (det.length) partes.push(det.join(', ') + ((v.detalle || []).length > 2 ? '…' : ''));
    if (v.credito) partes.push(`a crédito${it.vence ? ', vence ' + diaTxt(it.vence) : ''}`);
  } else if (it.tipo === 'doc') {
    partes.push(doc.tipo === 'sii' ? 'Factura del SII sin cuenta recurrente' : 'Boleta sin cuenta recurrente');
    if (doc.cliente) partes.push('N° cliente ' + doc.cliente);
    if (it.vence) partes.push('vence ' + diaTxt(it.vence));
  } else if (it.tipo === 'venc') {
    const b = venc.boleta || null;
    partes.push(b && b.esSaldo !== true ? `Boleta ${s(b.empresa) || ''}`.trim() + (b.desde && b.hasta ? ` · período ${diaTxt(b.desde)} – ${diaTxt(b.hasta)}` : '') : venc.previred ? `Certificado de Previred${venc.previred.n ? ' · ' + venc.previred.n + ' trabajadores' : ''}` : ORIGENES[it.origen]);
    if (venc.item && !b && it.origen !== 'previred') partes.push(limpio(venc.item));
    partes.push(espera ? `fecha estimada ${diaTxt(venc.fecha)}` : `vence ${diaTxt(venc.fecha)}`);
    if (saldoV !== null) partes.push(`con abonos · saldo ${pesos(saldoV)}`);
    if (venc.tipoObligacion === 'libre') partes.push('se paga en abonos');
  } else if (it.tipo === 'gasto') {
    partes.push(s(g.chip) || ORIGENES[it.origen], diaTxt(g.fecha));
    if ((g.items || []).length && it.razon) partes.push(g.items.filter(Boolean).join(' + '));
  } else if (it.tipo === 'planilla') {
    partes.push(`Planilla registrada · unidos ${pesos(pl.unido)} de ${pesos(pl.total)}`);
  }
  if (it.tipo === 'sinbanco' && !sinb.porClasificar) {
    if (sinb.saldo) partes.push(`Pagada en partes · el saldo vencía el ${diaTxt(sinb.fecha)}`);
    else { partes.push('Factura del SII', diaTxt(it.fecha)); if ((sinb.items || []).length) partes.push(sinb.items.join(' + ')); }
  }
  if (it.tipo === 'sinbanco' && !sinb.saldo) partes.push(`${it.dias} días sin cargo en el banco`);
  if (it.tipo === 'gasto' || (it.tipo === 'venc' && it.paso === 3)) { const d = diasEntre((g && g.fecha) || it.fecha, hoy); if (d > 0) partes.push(`${d} ${d === 1 ? 'día' : 'días'} sin cargo en el banco`); }
  it.sub = partes.filter(Boolean).join(' · ');
  it.sePagaPor = s(vi.sePagaPor);
  it.key = keyDe(it, l);
  it.atrasado = !!(it.tipo === 'venc' && dia(venc.fecha) && venc.fecha < hoy);
  return it;
}
// Una clave estable para el ítem (la pantalla recuerda cuál está abierto)
function keyDe(it, l) {
  if (it.ids.siiDoc) return 's:' + it.ids.siiDoc;
  if (it.ids.venc) return 'v:' + it.ids.venc;
  if (it.ids.sinb) return 'b:' + it.ids.sinb;
  if (it.ids.doc) return 'd:' + it.ids.doc;
  if (it.ids.planilla) return 'pl:' + it.ids.planilla;
  if (it.ids.gastos.length) return 'g:' + it.ids.gastos[0];
  return 'x:' + l[0].nodo;
}

// ═══ La próxima acción de cada ítem ═══
// codigo: clasificar | asignar | subir | pagar | espera_banco | calzar | espera_cargo | sinbanco | listo
export function accionDe(it) {
  const par = it.par, cargoTxt = par ? `el cargo del ${diaTxt(par.fecha)}` : '';
  if (it.grupo === 'listos') return { codigo: 'listo', texto: it.estado || 'Listo' };
  if (it.tipo === 'sii' || (it.tipo === 'sinbanco' && it.paso === 1 && par)) return par ? { codigo: 'calzar', texto: `Clasificar y calzar con ${cargoTxt}` } : { codigo: 'clasificar', texto: 'Clasificar: ítem y área' };
  if (it.tipo === 'doc') return { codigo: 'asignar', texto: 'Asignar a una cuenta recurrente o registrar como gasto' };
  if (par) return { codigo: 'calzar', texto: `Calzar con ${cargoTxt}` };
  if (it.tipo === 'sinbanco') return { codigo: 'sinbanco', texto: it.ref.sinb && it.ref.sinb.saldo ? 'El saldo, ¿cómo se pagó?' : '¿Cómo se pagó? En efectivo, con tarjeta o todavía por pagar' };
  if (it.tipo === 'venc') {
    const v = it.ref.venc || {};
    if (it.paso === 1) return { codigo: 'subir', texto: 'Falta el documento: sube la boleta' };
    if (it.paso === 3) return { codigo: 'espera_cargo', texto: 'Pagado a mano por banco: espera su cargo en la cartola' };
    if (it.sePagaPor === 'banco' || (!it.sePagaPor && v.plantillaId)) return { codigo: 'espera_banco', texto: it.atrasado ? `Venció el ${diaTxt(v.fecha)}: se paga por banco, espera su cargo` : `Se paga por banco el ${diaTxt(v.fecha)}: llega con la cartola` };
    return { codigo: 'pagar', texto: it.atrasado ? `Pagar · venció el ${diaTxt(v.fecha)}` : `Pagar · vence el ${diaTxt(v.fecha)}` };
  }
  return { codigo: 'espera_cargo', texto: 'Espera su cargo en la cartola' };
}

// ═══ "Ya listos": lo conciliado o pagado sin banco en los últimos 30 días (un ítem por gasto) ═══
const TXT_ACC = { vencimientos: 'Pagado', gasto: 'Ya estaba en Gastos', nuevo: 'Gasto nuevo desde la cartola', abono: 'Abono de sueldo', abono_parcial: 'Abono (pago parcial)', previred: 'Pago de Previred', previred_planilla: 'Unido a la planilla de Previred', sii_pend: 'Factura clasificada al conciliar' };
export function listosDe(E, hoy) {
  const corte = sumarDias(hoy, -(E.diasListos || DIAS_LISTOS)), out = [], porCargo = new Map(), cargos = new Map((E.cargos || []).map(c => [c.id, c]));
  const mete = (key, x) => { out.push(x); if (x.cargoId) porCargo.set(x.cargoId, x); return x; };
  (E.registrados || []).forEach(r => {
    if (!['cargo', 'efectivo', 'tarjeta', 'partes', 'pagado', 'mercadopago', 'personal'].includes(r.estado)) return;
    const c = r.cargoId ? cargos.get(r.cargoId) : null;
    const ref = [dia(r.fechaPago), c ? dia(c.fecha) : '', c ? dia(c.resueltoEl) : ''].filter(Boolean).sort().pop() || (r.estado !== 'cargo' ? dia(r.fecha) : '');
    if (!ref || ref < corte) return;
    if (r.cargoId && porCargo.has(r.cargoId)) { const x = porCargo.get(r.cargoId); if (r.tipo === 'venc' && !x.venc) { x.venc = r.ids[0]; } x.ids = x.ids.concat(r.ids); return; }
    const titulo = r.tipo === 'venc' ? limpio(r.nombre) : [limpio(r.razon) || (r.items || []).join(' + ') || 'Gasto', r.folio ? 'F. ' + r.folio : ''].filter(Boolean).join(' · ');
    const estado = r.estado === 'cargo' ? `Conciliado con el cargo del ${diaTxt(c ? c.fecha : r.fechaPago)}` : r.estado === 'efectivo' ? `Pagado en efectivo${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}` : r.estado === 'tarjeta' ? `Pagado con tarjeta${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}` : r.estado === 'mercadopago' ? `Pagado o descontado en Mercado Pago${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}` : r.estado === 'personal' ? `Pagado por el dueño con plata personal${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}` : r.estado === 'partes' ? 'Pagado en partes' : `Pagado${r.fechaPago ? ' el ' + diaTxt(r.fechaPago) : ''}`;
    mete('', { key: (r.tipo === 'venc' ? 'lv:' : 'lg:') + r.ids[0], tipo: 'listo', grupo: 'listos', paso: 4, titulo, sub: [r.tipo === 'venc' ? 'Vencimiento' : (r.items || []).join(' + '), r.fecha ? diaTxt(r.fecha) : ''].filter(Boolean).join(' · '), monto: Math.round(n(r.monto)), pendiente: 0, fecha: ref,
      estado, cargoId: s(r.cargoId), ids: r.ids.slice(), venc: r.tipo === 'venc' ? r.ids[0] : '', medio: r.estado, origen: r.folio ? 'sii' : 'mano', cargos: c ? [{ id: c.id, fecha: dia(c.fecha), monto: n(c.monto), descripcion: s(c.descripcion), principal: true, valor: null }] : [], ncs: [], accion: { codigo: 'listo', texto: estado }, claves: [] });
  });
  // Lo conciliado desde la cartola que no dejó un gasto en la lista (Previred unido a su planilla, por ejemplo)
  (E.cargos || []).forEach(c => {
    if (c.estado !== 'CONCILIADO' || porCargo.has(c.id) || ['pago_tarjeta', 'traspaso'].includes(s(c.accion))) return;
    const ref = [dia(c.fecha), dia(c.resueltoEl)].filter(Boolean).sort().pop();
    if (!ref || ref < corte) return;
    mete('', { key: 'lc:' + c.id, tipo: 'listo', grupo: 'listos', paso: 4, titulo: limpio(c.descripcion), sub: [TXT_ACC[s(c.accion)] || 'Conciliado', diaTxt(c.fecha)].join(' · '), monto: Math.round(n(c.monto)), pendiente: 0, fecha: ref,
      estado: `Conciliado con el cargo del ${diaTxt(c.fecha)}`, cargoId: c.id, ids: [], venc: '', medio: 'cargo', origen: c.accion === 'previred_planilla' || c.accion === 'previred' ? 'previred' : 'mano', cargos: [{ id: c.id, fecha: dia(c.fecha), monto: n(c.monto), descripcion: s(c.descripcion), principal: true, valor: null }], ncs: [], accion: { codigo: 'listo', texto: `Conciliado con el cargo del ${diaTxt(c.fecha)}` }, claves: [] });
  });
  return out.sort((a, b) => s(b.fecha).localeCompare(s(a.fecha)) || s(a.key).localeCompare(s(b.key)));
}

// ═══ Filtrar ═══
export function filtrar(M, f) {
  if (!M) return [];
  if (f === 'listos') return M.listos;
  if (!f || f === 'todo') return M.items;
  return M.items.filter(it => it.grupo === f);
}
// Las parejas para destacar: al elegir un ítem, sus cargos; al elegir un cargo, sus ítems
export const cargosDeItem = (M, key) => ((M && M.porKey[key]) ? M.porKey[key].cargos.map(x => x.id) : []);
export const itemsDeCargo = (M, cargoId) => ((M && M.porCargo[cargoId]) || []).map(x => x.key);

// ═══ La barra de 4 pasos (para la pantalla y las pruebas) ═══
// → [{ n, nombre, estado: 'hecho' (ya pasó) | 'sigue' (lo que falta ahora) | 'falta' }]
export const barra = paso => PASOS.map(([k, t]) => ({ n: k, nombre: t, estado: k <= paso ? 'hecho' : k === paso + 1 ? 'sigue' : 'falta' }));

// ═══ "Abrir": la ruta del gasto, para registro-detalle.js (htmlRegistro) ═══
export function registroItem(it) {
  if (!it) return null;
  const r = it.ref || {}, v = r.venc, sii = r.sii || (r.sinb && r.sinb.v) || null, g = r.gasto, sb = r.sinb, d = r.doc;
  const filas = [];
  if (sii) filas.push({ titulo: 'Documento del SII', texto: `${it.razon} F.${it.folio} · ${pesos(sii.total)} · ${diaTxt(sii.fecha)} · por clasificar` });
  else if (it.folio && it.origen === 'sii') filas.push({ titulo: 'Documento del SII', texto: `${it.razon} F.${it.folio} · ya clasificado` });
  if (d) filas.push({ titulo: 'Documento sin cuenta recurrente', texto: [limpio(d.empresa) || 'Boleta', d.monto ? pesos(d.monto) : '', d.motivo ? limpio(d.motivo) : ''].filter(Boolean).join(' · ') });
  if (v) filas.push({ titulo: 'Por pagar', texto: `${limpio(v.nombre)} · ${pesos(v.monto)} · ${v.estadoBase === 'esperando_documento' ? 'fecha estimada' : 'vence'} ${diaTxt(v.fecha)}${v.estadoBase === 'con_abonos' ? ' · con abonos, saldo ' + pesos(v.saldo) : ''}` });
  if (g) filas.push({ titulo: 'Registrado en Gastos', texto: `${(g.items || []).join(' + ') || 'Gasto'} · ${pesos(g.monto)} · ${diaTxt(g.fecha)}${g.chip ? ' · ' + g.chip : ''}` });
  if (sb) filas.push({ titulo: 'Pagos sin banco', texto: sb.saldo ? `Saldo ${pesos(sb.monto)} vencido el ${diaTxt(sb.fecha)}` : `${sb.dias} días sin cargo en el banco` });
  (it.ncs || []).forEach(x => filas.push({ titulo: 'Nota de crédito', texto: `NC ${x.folio} · ${pesos(x.monto)}` }));
  it.cargos.forEach(c => filas.push({ titulo: c.principal ? 'Cargo del banco que calza' : 'Cargo del banco del mismo monto', texto: `${pesos(c.monto)} · ${diaTxt(c.fecha)} · ${c.descripcion}${c.valor !== null && c.valor !== undefined ? ' · ' + c.valor + ' puntos' : ''}` }));
  const paso = it.paso, hecho = k => (k <= paso ? 'sí' : k === paso + 1 ? 'es lo que sigue' : 'todavía no');
  return { clave: 'bu-' + it.key,
    mov: [['Documento', it.titulo], ['Monto', pesos(it.monto)], ['Fecha', diaTxt(it.fecha)], ['Origen', ORIGENES[it.origen] || ''], it.vence ? ['Vence', diaTxt(it.vence)] : null].filter(Boolean),
    estado: { texto: nombrePaso(paso), tono: paso === 4 ? 'verde' : paso === 3 ? 'azul' : 'amarillo' },
    resolucion: [['1 Llegó', hecho(1)], ['2 Clasificado', hecho(2)], ['3 Pagado', hecho(3)], ['4 Conciliado', hecho(4)], ['Lo que falta', it.accion ? it.accion.texto : '']],
    docs: { titulo: 'Dónde está (un solo gasto)', filas } };
}

// Texto corto del monto que falta (para la fila)
export const faltaTxt = it => (it.pendiente && it.pendiente !== it.monto ? `falta ${pesos(it.pendiente)}` : '');
