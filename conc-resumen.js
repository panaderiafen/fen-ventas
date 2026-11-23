// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Resumen del mes  v0.69.3 (Entrega C, punto 4)
//  Puro (sin Firebase): arma el resumen de un mes con lo que la app YA tiene en la memoria (0 lecturas nuevas):
//  · avance: cargos y abonos B2B del mes (por la fecha del movimiento) ya revisados, en cantidad y en pesos;
//  · lo más antiguo sin revisar (3 cargos y 3 abonos), con su edad en días;
//  · cobertura: hasta dónde llega la cartola (cada cuenta) y el SII, y si el mes está completo;
//  · "Qué falta para cerrar el mes": las MISMAS reglas de Finanzas → Cierre de mes (finanzas-eerr.js: checkSiiCargado,
//    checkCartolaConciliada, checkSiiClasificados y, desde la v0.69.5, checkPrevired: el Previred DEL MES) más lo propio de la
//    conciliación (cartola hasta el fin de mes, abonos B2B y facturas con saldo vencido, este último solo como aviso);
//  · señales: pagos parciales con saldo, facturas por clasificar, efectivo pagado en el mes y reglas sugeridas (solo si hay).
//  Conciliado = revisado: ya se dijo qué es (paga un vencimiento, gasto nuevo, no es gasto, cliente y folio, No es de B2B…).
//  Un movimiento "Repetido" (el mismo en otra cartola) no cuenta en el total.
// ═══════════════════════════════════════════════
import * as FE from './finanzas-eerr.js?v=0.138.0';

const s = v => (v === null || v === undefined ? '' : String(v));
const n = v => { const x = Number(v); return isFinite(x) ? x : 0; };
const dia = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(f)); return m ? m[0] : ''; };
const MESES = FE.MESES_L;
export const nombreMes = m => { const k = Number(s(m).slice(5, 7)); return k ? MESES[k - 1].charAt(0).toUpperCase() + MESES[k - 1].slice(1) : s(m); };
export const mesCorto = m => { const k = Number(s(m).slice(5, 7)); return k ? MESES[k - 1] : s(m); };
export const pesos = v => { const x = Math.round(n(v)); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('es-CL'); };
export const diaTxt = f => { const d = dia(f); return d ? `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}` : '—'; };
export const diasEntre = (a, b) => Math.round((Date.parse(dia(b) + 'T12:00:00Z') - Date.parse(dia(a) + 'T12:00:00Z')) / 864e5);
export const haceTxt = d => (d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`);
export const ultimoDia = FE.ultimoDia;
export const mesMas = FE.mesMas;
// El selector: el mes de hoy y el anterior
export const mesesSelector = hoy => [s(hoy).slice(0, 7), FE.mesMas(s(hoy).slice(0, 7), -1)];
// Porcentaje entero hacia abajo (100 % solo cuando no falta nada); null sin movimientos
export const pct = (a, b) => (b > 0 ? Math.floor((a / b) * 100) : null);

// ── Avance de un lado (cargos o abonos) ──
// lista: [{ id, fecha, monto, descripcion, estado: 'pend' | 'hecho' | 'repetido' | 'ignorado' }]
function avance(lista, mes) {
  const del = (lista || []).filter(x => s(x.fecha).slice(0, 7) === mes);
  const base = del.filter(x => x.estado !== 'repetido'), pend = base.filter(x => x.estado === 'pend'), hechos = base.filter(x => x.estado !== 'pend');
  const total = base.reduce((a, x) => a + Math.abs(n(x.monto)), 0), hecho = hechos.reduce((a, x) => a + Math.abs(n(x.monto)), 0);
  return { m: base.length, n: hechos.length, faltan: pend.length, total, hecho, pct: pct(hechos.length, base.length), pctMonto: pct(hecho, total),
    repIgn: del.filter(x => x.estado === 'repetido' || x.estado === 'ignorado').length, pend };
}
// Cargos de Gastos (vistaCargo): POR_REVISAR y A_MEDIAS siguen por revisar; REPETIDO no cuenta; IGNORADO es "No es gasto"
export function ladoCargos(cargos) {
  return (cargos || []).filter(c => c && c.id && !c.quitadoEnPlanilla).map(c => ({ id: c.id, fecha: dia(c.fecha), monto: n(c.monto), descripcion: s(c.descripcion),
    estado: c.estado === 'POR_REVISAR' || c.estado === 'A_MEDIAS' ? 'pend' : c.estado === 'REPETIDO' ? 'repetido' : c.estado === 'IGNORADO' ? 'ignorado' : 'hecho' }));
}
// Abonos de B2B: los pendientes de la escucha y lo resuelto ya leído (b2b.abonosDelMes)
export function ladoAbonos(x) {
  if (!x) return [];
  return (x.pendientes || []).map(m => ({ id: m.id, fecha: dia(m.fecha), monto: n(m.monto), descripcion: s(m.descripcion), estado: 'pend' }))
    .concat((x.resueltos || []).map(m => ({ id: m.id, fecha: dia(m.fecha), monto: n(m.monto), descripcion: s(m.descripcion), estado: m.estado === 'repetido' ? 'repetido' : m.estado === 'ignorado' ? 'ignorado' : 'hecho' })));
}
export const avanceCargos = (cargos, mes) => avance(ladoCargos(cargos), mes);
export const avanceAbonos = (x, mes) => avance(ladoAbonos(x), mes);
// Los estados de la bandeja (Listo, Revisar, Sin coincidencia) de los pendientes de un mes. clase: { id: 'listo'|'revisar'|'sin' }
export function estadosMes(pend, clase) {
  const k = { listo: 0, revisar: 0, sin: 0 };
  (pend || []).forEach(x => { const c = (clase || {})[x.id]; if (c in k) k[c]++; });
  return k;
}
// Lo más antiguo sin revisar (cualquier mes), con su edad en días
export function antiguos(pendientes, hoy, cuantos = 3) {
  return (pendientes || []).filter(x => dia(x.fecha)).slice().sort((a, b) => dia(a.fecha).localeCompare(dia(b.fecha)) || n(b.monto) - n(a.monto)).slice(0, cuantos)
    .map(x => ({ id: x.id, fecha: dia(x.fecha), monto: n(x.monto), descripcion: s(x.descripcion), dias: Math.max(0, diasEntre(x.fecha, hoy)) }));
}

// ── Cobertura (la de "Qué está cubierto"): cuentas { k: { desde, hasta, huecos } } y las cargas del SII ──
export function coberturaMes(cuentas, cargasSii, mes, nombres = {}) {
  const ini = mes + '-01', fin = FE.ultimoDia(mes);
  const l = Object.entries(cuentas || {}).filter(([, c]) => c && c.hasta).map(([k, c]) => {
    const huecos = (c.huecos || []).filter(h => h[0] <= fin && h[1] >= ini);
    return { k, nombre: nombres[k] || k, desde: s(c.desde), hasta: s(c.hasta), huecos, completo: s(c.hasta) >= fin && (!c.desde || s(c.desde) <= ini) && !huecos.length };
  });
  // la más atrasada manda (como "Toca conciliar")
  const hasta = l.length ? l.map(c => c.hasta).sort()[0] : '';
  const vivas = (cargasSii || []).filter(c => c && !s(c.quitada).trim()).map(c => dia(c.hasta) || dia(c.desde)).filter(Boolean);
  return { cuentas: l, hasta, completo: l.length > 0 && l.every(c => c.completo), huecos: l.flatMap(c => c.huecos), sii: cargasSii ? (vivas.sort().pop() || '') : null, conCartola: l.length > 0 };
}

// ── "Qué falta para cerrar el mes" ──
// D = { mes, hoy, cob (coberturaMes), cargos (vistaCargo[] | null), abonos (avanceAbonos | null), cargasSii (| null),
//       siiPorMes ({ mes: { n, monto } } | null), planillas (Previred | null), vencidas ([{ monto }] | null) }
// → [{ k, t, ok, nivel 'ok'|'falla'|'aviso'|'sin', detalle, ir, accion, info, cierre (true si es una regla de Cierre de mes) }]
export function checksMes(D) {
  const mes = D.mes, fin = FE.ultimoDia(mes), out = [];
  const sin = (k, t, detalle, ir, accion, info) => ({ k, t, ok: false, nivel: 'sin', detalle, ir, accion, info });
  const conAccion = (c, accion) => ({ ...c, accion, cierre: true });
  // Cartola hasta el último día del mes (todas las cuentas que se concilian)
  const cob = D.cob;
  if (!cob || !cob.conCartola) out.push(sin('cartola_mes', 'Cartola hasta el fin de mes', 'Todavía no hay cartola de este mes.', '#gastos', 'Subir cartola', TXT_CARTOLA_MES));
  else out.push({ k: 'cartola_mes', t: 'Cartola hasta el fin de mes', ok: cob.completo, nivel: cob.completo ? 'ok' : 'falla', ir: '#gastos', accion: 'Subir cartola', info: TXT_CARTOLA_MES,
    detalle: faltaCartola(cob, mes) });
  // Ningún cargo del mes por revisar (la regla de Cierre de mes)
  if (D.cargos) out.push(conAccion(FE.checkCartolaConciliada({ mes, cargosPorRevisar: FE.cargosPorRevisarDelMes(D.cargos, mes) }), 'Revisar cargos'));
  else out.push(sin('cartola', 'Cartola conciliada', 'Se cuenta al abrir Cargos.', '#gastos', 'Abrir Cargos'));
  // Ningún abono B2B del mes por revisar (Cierre de mes no lo revisa: aquí es un aviso)
  if (D.abonos) { const f = D.abonos.faltan; out.push({ k: 'abonos', t: 'Abonos B2B revisados', ok: !f, nivel: f ? 'aviso' : 'ok', ir: '#b2b/conciliacion', accion: 'Revisar abonos', info: TXT_ABONOS,
    detalle: f ? `${f} ${f === 1 ? 'abono' : 'abonos'} del mes por revisar (${pesos(D.abonos.pend.reduce((a, x) => a + n(x.monto), 0))}).` : 'Sin abonos por revisar en el mes.' }); }
  // SII cargado hasta el fin de mes (la regla de Cierre de mes)
  if (D.cargasSii) out.push(conAccion(FE.checkSiiCargado({ mes, cargasSii: D.cargasSii }), 'Cargar del SII'));
  else out.push(sin('sii', 'SII del mes cargado', 'Se ve al abrir Cargos.', '#gastos', 'Abrir Cargos'));
  // Documentos del SII del mes sin clasificar = 0 (la regla de Cierre de mes)
  if (D.siiPorMes) out.push(conAccion(FE.checkSiiClasificados({ mes, siiPendientes: D.siiPorMes[mes] || { n: 0, monto: 0 } }), 'Clasificar'));
  // v0.69.5 · Previred DEL MES cargado (la misma regla de Cierre de mes: finanzas-eerr.js checkPrevired). Antes se pedía el del
  // mes anterior; ahora cerrar octubre pide "Previred de octubre" (su costo es de octubre y se paga hasta el 13 de noviembre).
  if (!D.planillas) out.push(sin('previred', FE.tituloPrevired(mes), 'Se ve al abrir Cargos.', '#gastos/previred', 'Ir a Previred', FE.TXT_PREVIRED_MES));
  else { const c = FE.checkPrevired({ mes, planillas: D.planillas }); out.push(conAccion(c, c.nivel === 'falla' ? 'Cargar Previred' : 'Ir a Previred')); }
  // Facturas con saldo vencido: aviso, no impide cerrar
  if (D.vencidas && D.vencidas.length) out.push({ k: 'vencidas', t: 'Facturas con saldo vencido', ok: false, nivel: 'aviso', ir: '#gastos/sinbanco', accion: 'Ver en Pagos sin banco', info: TXT_VENCIDAS,
    detalle: `${D.vencidas.length} ${D.vencidas.length === 1 ? 'factura' : 'facturas'} con saldo vencido (${pesos(D.vencidas.reduce((a, x) => a + n(x.monto), 0))}).` });
  return out;
}
// Qué le falta a la cartola del mes, en una línea
function faltaCartola(cob, mes) {
  const ini = mes + '-01', fin = FE.ultimoDia(mes);
  if (cob.completo) return `Cubierto hasta el ${diaTxt(fin)}.`;
  if (cob.huecos.length) return `Faltan días: ${cob.huecos.map(h => { const a = h[0] < ini ? ini : h[0], b = h[1] > fin ? fin : h[1]; return a === b ? diaTxt(a) : `${diaTxt(a)} al ${diaTxt(b)}`; }).join(' · ')}.`;
  const tarde = cob.cuentas.filter(c => c.desde && c.desde > ini).map(c => c.desde).sort().pop();
  if (cob.hasta >= fin && tarde) return `Falta del ${diaTxt(ini)} al ${diaTxt(sumar(tarde, -1))}.`;
  const desde = cob.hasta < ini ? ini : sumar(cob.hasta, 1);
  return `Llega hasta el ${diaTxt(cob.hasta)}: falta del ${diaTxt(desde)} al ${diaTxt(fin)}.`;
}
const sumar = (f, k) => new Date(Date.parse(dia(f) + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
export const paraCerrar = checks => (checks || []).filter(c => c.nivel === 'falla').length;
const TXT_CARTOLA_MES = 'Que la cartola de cada cuenta que concilias llegue hasta el último día del mes, sin días que falten. Sin eso no se sabe si quedan cargos o abonos por revisar. Cierre de mes no lo revisa: lo ves aquí.';
const TXT_ABONOS = 'Que todos los abonos de la cartola del mes estén revisados en Ventas a empresas → Conciliación. Cierre de mes no lo revisa: aquí es un aviso.';
const TXT_VENCIDAS = 'Facturas pagadas en partes con saldo cuya fecha ya pasó (las de Pagos sin banco). Es un aviso: no impide cerrar.';

// ── Señales (una línea cada una, solo si no es cero) ──
// R = { partes [{ saldo }], porClasificar, caja [{ fecha, monto, origen }], sugeridas }
export function senales(R, mes) {
  const out = [];
  const pa = (R.partes || []).filter(x => n(x.saldo) > 0);
  if (pa.length) out.push({ k: 'partes', texto: `Pagos parciales con saldo abierto: ${pa.length} · ${pesos(pa.reduce((a, x) => a + n(x.saldo), 0))}`, ir: '#gastos/por-pagar' });
  if (n(R.porClasificar) > 0) out.push({ k: 'porclasificar', texto: `Facturas por clasificar: ${n(R.porClasificar)}`, ir: '#gastos/sii/porclasificar' });
  const cj = (R.caja || []).filter(x => s(x.fecha).slice(0, 7) === mes && n(x.monto) > 0);
  if (cj.length) {
    const b2b = cj.filter(x => s(x.origen) === 'cobros_b2b').reduce((a, x) => a + n(x.monto), 0), total = cj.reduce((a, x) => a + n(x.monto), 0);
    out.push({ k: 'caja', texto: `Efectivo pagado en ${mesCorto(mes)}: ${pesos(total)} (cobros B2B ${pesos(b2b)} · otro ${pesos(total - b2b)})`, ir: '#gastos/sinbanco' });
  }
  if (n(R.sugeridas) > 0) out.push({ k: 'sugeridas', texto: `Reglas sugeridas por revisar: ${n(R.sugeridas)}`, ir: '#gastos/config/reglas' });
  return out;
}

// ── El resumen completo de un mes ──
// E = { mes, hoy, cargos (vistaCargo[] | null), abonos (b2b.abonosDelMes | null), claseCc, claseAb, cuentas, nombres, cargasSii,
//       siiPorMes, planillas, vencidas, partes, porClasificar, caja, sugeridas, pendCc (todos los cargos por revisar), pendAb }
export function resumen(E) {
  const mes = E.mes, cc = E.cargos ? avanceCargos(E.cargos, mes) : null, ab = E.abonos ? avanceAbonos(E.abonos, mes) : null;
  const cob = coberturaMes(E.cuentas, E.cargasSii, mes, E.nombres);
  const checks = checksMes({ mes, hoy: E.hoy, cob, cargos: E.cargos, abonos: ab, cargasSii: E.cargasSii, siiPorMes: E.siiPorMes, planillas: E.planillas, vencidas: E.vencidas });
  // El % del mes suma los abonos solo cuando lo conciliado de B2B del mes ya está contado entero (si no, solo los cargos: así no
  // baja por lo que todavía no se lee). "Por revisar" siempre suma los dos (los pendientes de B2B están todos en la memoria).
  const abEntero = !!(ab && E.abonos && E.abonos.completo);
  const m = (cc ? cc.m : 0) + (abEntero || !cc ? (ab ? ab.m : 0) : 0), h = (cc ? cc.n : 0) + (abEntero || !cc ? (ab ? ab.n : 0) : 0), faltan = (cc ? cc.faltan : 0) + (ab ? ab.faltan : 0);
  const R = { mes, cc, ab, abCompleto: !E.abonos || !!E.abonos.completo, abDesde: E.abonos ? E.abonos.desde : '', cob, checks, cerrar: paraCerrar(checks),
    estadosCc: cc ? estadosMes(cc.pend, E.claseCc) : null, estadosAb: ab ? estadosMes(ab.pend, E.claseAb) : null,
    antiguosCc: E.pendCc ? antiguos(E.pendCc, E.hoy) : [], antiguosAb: E.pendAb ? antiguos(E.pendAb, E.hoy) : [],
    senales: senales(E, mes), pct: pct(h, m), faltan, total: m };
  R.linea = lineaCorta(R);
  return R;
}
// "Octubre: 87% conciliado · 12 por revisar · 3 para cerrar"
export function lineaCorta(R) {
  return [`${nombreMes(R.mes)}: ${R.pct === null ? 'sin movimientos' : R.pct + '% conciliado'}`, `${R.faltan} por revisar`, R.cerrar ? `${R.cerrar} para cerrar` : 'listo para cerrar'].join(' · ');
}
// Hoy: "Conciliación de octubre: 87% · faltan 12" (solo si falta algo)
export function lineaHoy(R) {
  if (!R || R.pct === null || !R.faltan) return '';
  return `Conciliación de ${mesCorto(R.mes)}: ${R.pct}% · faltan ${R.faltan}`;
}
