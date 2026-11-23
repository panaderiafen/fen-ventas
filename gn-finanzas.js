// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos nuevo → Finanzas (Etapa 4, el puente)  v0.101.1 · reglas puras, sin red
//  Finanzas sigue trabajando con "gastos" de una línea (ítem, área, neto, fecha). Aquí cada parte de cada documento clasificado del
//  Gastos nuevo se entrega en esa forma: el estado de resultados, la cuadratura y los cierres no cambian.
//  v0.101.1 · Desde cero en octubre (Emmanuel, 25 oct): Finanzas parte en el mes del inicio y solo cuenta el Gastos nuevo. Lo de antes del
//  inicio no entra al resultado (la deuda anterior queda solo para pagarla; de un pago que cubre varios meses, solo cuentan los meses desde
//  el inicio). El Gastos anterior no se lee para el resultado (solo las inversiones ya registradas, para su depreciación).
//  · El mes de cada documento es su "mes" (el de la factura; el del período en boletas, Previred, F29 y liquidaciones).
//  · Un documento que se reparte en 6 o 12 meses (patentes, permisos) entrega una línea por mes (el último absorbe el redondeo).
//  · Sin clasificar o "Esto no va": no entrega líneas (el cierre avisa lo sin clasificar).
//  · Las notas de crédito vienen en negativo desde el SII: sus partes restan solas.
//  v0.102.0 · Con el catálogo de ítems (gn_items), cada línea lleva el ítem que cuenta (un nombre antiguo pasa al nuevo) y su CUENTA:
//  Finanzas lee el tipo desde la cuenta (plan-cuentas.js), ya no desde Clasificación. catalogo: true marca esas líneas. Un ítem sin cuenta
//  (por ubicar en Gastos → Ítems) entra sin cuenta: queda "sin clasificar" en el estado de resultados.
// ═══════════════════════════════════════════════
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as GI from './gn-items.js?v=0.138.0';
import * as TR from './trabajadores.js?v=0.138.0';
import * as GT from './tributario.js?v=0.138.0';   // v0.108.0: la situación tributaria de cada línea   // v0.104.0: los pagos que usan la provisión de los trabajadores

const s = v => String(v == null ? '' : v).trim();
const entero = v => { const x = Math.round(Number(v)); return isFinite(x) ? x : 0; };
const norm = t => s(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));
const sigMes = m => { const [y, n] = m.split('-').map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };
const ultimoDia = m => { const [y, n] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, n, 0)).getUTCDate()).padStart(2, '0')}`; };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesCorto = m => (/^\d{4}-\d{2}$/.test(s(m)) ? `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : s(m));
export const TOL = 5;
const hashCorto = t => { let h = 5381; for (const c of s(t)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };

// ── Los meses en que cuenta un documento: el suyo, o 6 / 12 desde el inicio de su período ──
export function mesesDoc(d) {
  const n = Number(d.prorratear) || 0, m0 = s(d.mes) || s(d.fecha).slice(0, 7);
  if (!(n > 1)) return [m0];
  let m = (d.periodo && esIso(d.periodo.desde) ? d.periodo.desde.slice(0, 7) : m0); const out = [];
  for (let i = 0; i < n; i++) { out.push(m); m = sigMes(m); }
  return out;
}
// ── v0.103.0 · Flete de compra (factura aparte, unida a una o varias compras): se reparte entre esas compras según su valor y, dentro de cada
// una, como su clasificación (mismo ítem y área). Así el flete de la harina es costo de la harina (inventario y, con el precio, las recetas),
// el del packaging es packaging, etc. Sin compras unidas (o sin clasificar): null, y el flete queda con su propia clasificación.
const juntarPartes = partes => { const m = {}; partes.forEach(p => { const k = p.item + '|' + p.area; m[k] = m[k] ? { ...m[k], monto: m[k].monto + p.monto } : { ...p }; }); return Object.values(m).filter(p => p.monto !== 0); };
export function partesFlete(d, porId, provs, reps) {
  const L = ((d && d.flete && d.flete.docs) || []).map(i => (porId || {})[i]).filter(x => x && x.estado !== 'no_va' && x.id !== d.id);
  const pesos = L.map(x => Math.max(0, GB.baseDe(x))); if (!pesos.some(Boolean)) return null;
  const montos = GB.repartirMonto(GB.baseDe(d), pesos), propia = (GB.clasifDe(d, provs, reps) || {}).partes || [], out = [];
  const repartir = (monto, ps) => GB.repartirMonto(monto, ps.map(p => Math.abs(p.monto))).forEach((m, k) => { if (m) out.push({ item: ps[k].item, area: ps[k].area, monto: m }); });
  L.forEach((x, i) => { if (!montos[i]) return; const ps = (((GB.clasifDe(x, provs, reps) || {}).partes) || []).filter(p => p.monto > 0);
    if (ps.length) repartir(montos[i], ps); else if (propia.length) repartir(montos[i], propia); else out.push({ item: GI.FLETE, area: 'ADMIN', monto: montos[i] }); });
  return juntarPartes(out);
}
export const esFlete = (d, provs, reps) => (((GB.clasifDe(d, provs, reps) || {}).partes) || []).some(p => norm(p.item) === norm(GI.FLETE));
// Fletes del mes que todavía no se unen a su compra (el cierre los avisa)
export function fletesPorUnir(D, mes) {
  const l = ((D && D.docs) || []).filter(d => d.estado !== 'no_va' && mesesDoc(d).includes(mes) && !((d.flete && d.flete.docs) || []).length && esFlete(d, D.provs || {}, D.repartos || {}));
  return { n: l.length, monto: l.reduce((a, d) => a + GB.baseDe(d), 0) };
}
const repartirEn = (monto, n) => { const b = Math.trunc(monto / n), out = Array(n).fill(b); out[n - 1] = monto - b * (n - 1); return out; };

// ── Las líneas de un documento para Finanzas (solo los meses desde el inicio) ──
// → [{ id, fecha, itemGasto, area, montoNeto, razonSocial, observacion, estado, origenGN, docId, mesOriginal [, catalogo, cuenta, itemOriginal] }]
// El id no depende del orden de las partes (ítem y área): reclasificar no cambia la llave de lo que sigue igual. El id sale del nombre
// guardado (no del que cuenta): pasar al catálogo nuevo no cambia las llaves.
// I: el índice del catálogo (GI.indice) o null (todavía sin catálogo: los nombres tal cual)
export function lineasDoc(d, provs, reps, { inicio, I = null, porId = null, T = null } = {}) {
  if (!d || d.estado === 'no_va') return [];
  const mesIni = s(inicio).slice(0, 7), meses = mesesDoc(d), n = meses.length;
  if (meses[n - 1] < mesIni) return [];   // todo es de antes del inicio
  const c = GB.clasifDe(d, provs, reps), pf = porId && d.flete ? partesFlete(d, porId, provs, reps) : null;
  // v0.104.0 · Un pago que usa la provisión (reemplazo de vacaciones o finiquito): sale de lo acumulado (2.8), no es gasto del mes
  const usa = TR.usaProvision(d), partes = usa ? [{ item: 'USO DE LA PROVISIÓN (' + TR.USOS[d.provision.uso].toUpperCase() + ')', area: (((c && c.partes) || [])[0] || {}).area || 'ADMIN', monto: GB.baseDe(d) }] : pf || (c && c.partes) || []; if (!partes.length) return [];
  const de = pf ? ' · flete de ' + d.flete.docs.map(i => porId[i]).filter(Boolean).map(x => `${s(x.razon).slice(0, 30)} N° ${s(x.folio)}`).join(', ') : '';
  const ref = `${s(d.tipoTexto)}${d.folio && d.origen !== 'credito' ? ' N° ' + s(d.folio) : ''}${de}`;
  const out = [], vistos = {};
  partes.forEach(p => {
    const montos = repartirEn(entero(p.monto), n);
    const k0 = hashCorto(norm(p.item) + '|' + s(p.area).toUpperCase()), k = vistos[k0] ? `${k0}${vistos[k0]}` : k0; vistos[k0] = (vistos[k0] || 0) + 1;
    meses.forEach((m, i) => {
      if (!montos[i] || m < mesIni) return;
      const fecha = s(d.fecha).slice(0, 7) === m ? s(d.fecha) : ultimoDia(m);
      const obs = [ref, n > 1 ? `${i + 1}/${n} (${mesCorto(meses[0])} a ${mesCorto(meses[n - 1])})` : ''].filter(Boolean).join(' · ');
      const r = usa ? { ok: true, nombre: p.item, cuenta: '2.8' } : I ? GI.resolver(p.item, I) : null, cat = r ? { catalogo: true, cuenta: r.ok ? r.cuenta : '', ...(r.ok && r.nombre !== s(p.item) ? { itemOriginal: s(p.item) } : {}) } : {};
      // v0.108.0 · Situación tributaria (gestión y tributario): solo se anota lo que el SII no acepta
      const tr = T ? GT.situacionDe(d, r && r.ok ? r.nombre : s(p.item), fecha, T) : null;
      out.push({ id: `gn_${d.id}_${k}${n > 1 ? '_' + m.replace('-', '') : ''}`, fecha, itemGasto: r && r.ok ? r.nombre : s(p.item), area: s(p.area).toUpperCase(), montoNeto: montos[i], razonSocial: s(d.razon), observacion: obs,
        estado: 'vigente', origenGN: s(d.origen) || 'sii', docId: s(d.id), mesOriginal: m, ...cat, ...(tr && tr.situacion !== 'aceptado' ? { tributario: tr.situacion, grupoTrib: tr.grupo } : {}) });
    });
  });
  return out;
}

// ── Todo para Finanzas: las líneas del Gastos nuevo desde el inicio ──
// D: { docs, provs, repartos, catalogo }. → { lineas, errores [docId] } (un documento raro se salta y se avisa: no deja a Finanzas sin nada)
// conCatalogo false: los nombres tal cual (lo usa la vista previa del paso al catálogo)
export function gastosParaFinanzas(D, inicio, { conCatalogo = true } = {}) {
  const lineas = [], errores = [], I = conCatalogo && D && GI.activo(D.catalogo) ? GI.indice(D.catalogo) : null, porId = Object.fromEntries(((D && D.docs) || []).map(d => [d.id, d]));
  ((D && D.docs) || []).forEach(d => { try { lineas.push(...lineasDoc(d, D.provs || {}, D.repartos || {}, { inicio, I, porId, T: (D && D.tributario) || null })); } catch (e) { errores.push(d && d.id); } });
  return { lineas, errores };
}

// ── Lo del Gastos nuevo que todavía no tiene clasificación, por mes (para el cierre) ──
export function sinClasificarDelMes(D, mes) {
  const l = ((D && D.docs) || []).filter(d => d.estado !== 'no_va' && mesesDoc(d).includes(mes) && !GB.clasifDe(d, D.provs || {}, D.repartos || {}));   // también la parte del mes de un pago de varios meses
  return { n: l.length, monto: l.reduce((a, d) => a + entero(d.total), 0), lista: l.slice(0, 30).map(d => ({ id: d.id, razon: s(d.razon), folio: s(d.folio), total: entero(d.total), tipo: s(d.tipoTexto) })) };
}
// Movimientos del mes con saldo sin explicar (ni pago, ni "no es gasto", ni "no va"); los anteriores al inicio no cuentan
// v0.126.1 · Etapa 4: un pago a cuenta (naturaleza 'acuenta') ya tiene su cargo y solo espera la factura: no cuenta aquí (va en su aviso)
export function movsSinRevisarDelMes(D, mes) {
  const I = GB.indicePagos((D && D.pagos) || []), l = ((D && D.movs) || []).filter(m => !m.anterior && m.naturaleza !== 'acuenta' && s(m.fecha).slice(0, 7) === mes && entero(m.monto) > 0 && GB.libreMov(m, I) > TOL);
  return { n: l.length, monto: l.reduce((a, m) => a + GB.libreMov(m, I), 0) };
}
// Los pagos a cuenta del mes que todavía esperan su documento (con saldo a favor): { n, monto, lista: [{ quien, fecha, monto }] }
export function aCuentaDelMes(D, mes) {
  const I = GB.indicePagos((D && D.pagos) || []), l = ((D && D.movs) || []).filter(m => m.naturaleza === 'acuenta' && m.estado !== 'no_va' && !m.anterior && s(m.fecha).slice(0, 7) === mes && GB.libreMov(m, I) > TOL)
    .map(m => ({ quien: s((m.aCuenta && (m.aCuenta.razon || m.aCuenta.rut)) || m.glosa), fecha: s(m.fecha), monto: GB.libreMov(m, I) })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { n: l.length, monto: l.reduce((a, x) => a + x.monto, 0), lista: l };
}
// Pagos de la tarjeta de crédito (movimientos marcados así): no son gasto, van al flujo de caja
export const pagosTarjetaGN = D => ((D && D.movs) || []).filter(m => m.naturaleza === 'tarjeta' && m.estado !== 'no_va').map(m => ({ id: s(m.id), fecha: s(m.fecha), monto: entero(m.monto), descripcion: s(m.glosa) }));
// ¿El SII del mes está completo? Su método (anotado en la (i) de "Hasta dónde llega"): a fin de mes se sube el RCV (o el XML) ya
// terminado el mes. Cuenta como completo si alguna carga del SII se subió después del último día del mes y trae documentos de ese mes.
// → { ok, hasta (la factura más reciente cargada), ultima (la última carga que cubre el mes) }
export function siiDelMes(cargas, mes) {
  const fin = ultimoDia(mes), l = (cargas || []).filter(k => s(k.tipo) === 'sii');
  const cubre = l.filter(k => esIso(s(k.hasta)) && s(k.hasta) >= mes + '-01' && (!esIso(s(k.desde)) || s(k.desde) <= fin));
  const despues = cubre.filter(k => s(k.en).slice(0, 10) > fin);
  return { ok: despues.length > 0, hasta: l.map(k => s(k.hasta)).filter(esIso).sort().pop() || '', ultima: (despues[0] && s(despues[0].en).slice(0, 10)) || '', rcv: despues.some(k => k.formato === 'registro') };
}
// Previred del mes (el documento del período)
export const previredDelMes = (D, mes) => ((D && D.docs) || []).find(d => d.origen === 'previred' && s(d.mes) === mes && d.estado !== 'no_va') || null;
