// ═══════════════════════════════════════════════
//  Sistema Fën — Finanzas → Resultados: Estado de resultados (F3 paso 2) y Cierre de mes  v0.62.0
//  Rutas: #finanzas/resultados (Estado de resultados, la primera parte) · #finanzas/resultados/cierre.
//  Reglas puras en finanzas-eerr.js; datos en finanzas.js (fen-gastos y lectura de caja, B2B y Producción).
//  Un mes cerrado se lee de su snapshot (fin_cierres/{AAAA-MM}); lo que cambie después aparece como "Ajustes de meses
//  cerrados" en el primer mes abierto siguiente. Solo Emmanuel ve esto (Sistema Fën): nada va a Cocina ni a Hoy.
//  R = { datos (leerResultados: gastos, ítems, obligaciones, vencimientos, fin, config, créditos, inversiones), cabecera() }
// ═══════════════════════════════════════════════
import * as F from './finanzas.js?v=0.138.0';
import * as FR from './finanzas-resultados.js?v=0.138.0';
import * as FE from './finanzas-eerr.js?v=0.138.0';
import * as FS from './finanzas-estado.js?v=0.138.0';   // v0.111.0: el estado por cuentas (filas clásicas, 4 niveles)
import * as FC from './finanzas-costos.js?v=0.138.0';
import * as SP from './sii-pendientes.js?v=0.138.0';   // v0.66.0: documentos del SII por clasificar

const ES = { mes: '', vista: 'principal', verPor: 'total', nivel: 1, perMeses: null, perSeg: null, abiertosE: new Set(), cerradosE: new Set(), abiertas: {}, cierres: null, claves: {}, cartola: null, sii: null, vivo: {}, msg: '', err: '', cargando: '', checks: {}, conteos: {}, otros: null, renta: null, incob: {} };
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL');
const pesos = v => FC.pesos(Math.round(Number(v) || 0));
const pct = v => (v === null || v === undefined || !isFinite(v) ? '—' : `${(Math.round(v * 10) / 10).toLocaleString('es-CL')} %`);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaTxt = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '—'; };
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PI = {
  candado: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', abierto: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', aviso: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  revisar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', abajo: '<path d="M6 9l6 6 6-6"/>', ir: '<path d="M5 12h14M13 6l6 6-6 6"/>', hist: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  balanza: '<path d="M12 4v16M6 20h12M4 8h16"/><path d="M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z"/>'
};
const ic = (n, t = 18) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PI[n] || ''}</svg>`;
const mapaAreas = R => (R.datos.config && R.datos.config.areasGasto) || {};
// v0.102.0 · ¿Ya se pasó al catálogo de ítems? (entonces el tipo de cada gasto sale de la cuenta de su ítem, no de Clasificación)
const conCatalogo = R => !!(R.datos.gn && R.datos.gn.D && (R.datos.gn.D.catalogo || []).length);
const mesHoy = () => hoyTxt().slice(0, 7);
// v0.101.1 · Con el Gastos nuevo, Finanzas parte en el mes del inicio (desde cero en octubre)
const mesDesde = () => F.mesInicioGN() || `${FR.ANIO}-01`;
const mesDefecto = () => (FE.mesMas(mesHoy(), -1) >= mesDesde() ? FE.mesMas(mesHoy(), -1) : mesHoy());
const mesValido = m => (/^\d{4}-\d{2}$/.test(String(m || '')) && m >= mesDesde() ? m : mesDefecto());
const cerrado = m => !!(ES.cierres && ES.cierres[m] && ES.cierres[m].estado === 'cerrado');
const mensajes = H => `<p class="ok-texto" id="e-msg" role="status">${H.esc(ES.msg)}</p><p class="error" id="e-err" role="alert">${H.esc(ES.err)}</p>`;
// v0.69.3 · Finanzas → Resumen del mes: "Ir a Cierre de mes" abre el mismo mes
export function elegirMes(m) { if (/^\d{4}-\d{2}$/.test(String(m || ''))) { ES.mes = m; ES.msg = ''; ES.err = ''; } }
export function olvidar() { ES.cierres = null; ES.cartola = null; ES.sii = null; ES.siiPend = null; ES.vivo = {}; ES.checks = {}; ES.conteos = {}; ES.otros = null; ES.renta = null; ES.incob = {}; ES.msg = ''; ES.err = ''; F.olvidarMeses(); }

// ── Datos comunes (una vez por entrada a Resultados) ──
async function base() {
  if (!ES.cierres) { const x = await F.leerCierres(); ES.cierres = x.cierres; ES.claves = x.claves || {}; }
  // v0.106.0 · Otros ingresos y gastos (no del giro) y la tasa del impuesto a la renta: una lectura cada uno al entrar
  if (!ES.otros) { try { ES.otros = await F.leerOtros(); } catch (e) { console.warn('Otros ingresos', e); ES.otros = []; } }
  if (!ES.renta) { try { ES.renta = await F.leerRenta(); } catch (e) { console.warn('Tasa de renta', e); ES.renta = { tasa: 0 }; } }
  // v0.101.1 · Con el Gastos nuevo, la cartola y el SII del Gastos anterior ya no se leen (las revisiones salen del Gastos nuevo)
  if (F.gnActivo()) return;
  if (!ES.cartola) ES.cartola = await F.cargosCartola();
  if (!ES.siiPend) { try { ES.siiPend = await F.siiPorClasificar(); } catch (e) { ES.siiPend = null; } }
}
// Estado de resultados calculado hoy (sin el snapshot) de un mes
async function vivo(R, mes) {
  if (ES.vivo[mes]) return ES.vivo[mes];
  const dm = await F.datosMes(mes);
  const D = R.datos, mapa = mapaAreas(R);
  // v0.101.0 · Desde el inicio (octubre) manda el Gastos nuevo: el interés de los créditos va en sus cuotas (Gastos → Compromisos → Créditos),
  // no en la tabla de Finanzas → Créditos (sería doble); los pagos de la tarjeta son los movimientos marcados así en la Bandeja.
  // v0.101.1 · Desde cero en octubre: con el Gastos nuevo, Finanzas no muestra meses anteriores al inicio.
  if (F.delGastosNuevo(mes) && D.gn && D.gn.error) throw new Error(`No se pudo leer el Gastos nuevo (desde ${FE.mesTxt(D.gn.inicio.slice(0, 7))} los gastos salen de ahí): ${D.gn.error}. Revise la conexión y toque "Leer de nuevo".`);
  const nuevo = F.delGastosNuevo(mes) && D.gn, GF = nuevo ? await import('./gn-finanzas.js?v=0.138.0') : null;
  const pagosTarjeta = nuevo ? GF.pagosTarjetaGN(D.gn.D) : ((ES.cartola && ES.cartola.pagosTarjeta) || []);
  // v0.104.0 · Provisión de vacaciones y finiquitos (fichas y liquidaciones de los trabajadores)
  const TR = nuevo ? await import('./trabajadores.js?v=0.138.0') : null, GBm = nuevo ? await import('./gn-bandeja.js?v=0.138.0') : null;
  const areasT = clave => GBm.areasDe((D.gn.D.provs || {})[clave], D.gn.D.repartos || {}), provision = nuevo ? TR.provisionesDelMes(D.gn.D, mes, areasT) : [];
  // v0.106.0 · Incobrables (Ventas B2B → Cobranza), otros ingresos y gastos, y la tasa del impuesto a la renta
  if (!(mes in ES.incob)) ES.incob[mes] = await F.incobrablesMes(mes);
  const e = FE.armarEERR({ mes, margen: dm.margen, merma: dm.merma, caja: dm.caja || null, comisionMP: { mp: dm.mp || null, medios: dm.medios || null }, gastos: D.gastos, fin: D.fin, items: D.items, mapa, creditosMes: nuevo ? [] : FE.creditosDelMes(D.creditos, D.vencimientos, D.gastos, mes),
    invs: FR.inversiones(D.gastos, D.fin, D.invGuardadas, mapa), pagosTarjeta, provision, incobrables: ES.incob[mes] || [], otros: ES.otros || [], renta: ES.renta || { tasa: 0 }, tributario: nuevo ? (D.gn.D.tributario || null) : null });
  if (ES.incob[mes] === null) e.avisos.push({ k: 'incobrables', texto: 'No se pudieron leer las facturas dadas por perdidas en Ventas a empresas: los incobrables van en $0.' });
  e.ventasInfo = dm.ventasInfo;
  if (nuevo) {
    const sc = GF.sinClasificarDelMes(D.gn.D, mes), av = [];
    if (sc.n) av.push({ k: 'gn_sin_clasificar', texto: `${sc.n} ${sc.n === 1 ? 'documento' : 'documentos'} de ${FE.mesTxt(mes)} sin clasificar en Gastos (${pesos(sc.monto)}): no están en este estado de resultados. Clasifíquelos en Gastos → Bandeja.` });
    if ((D.gn.errores || []).length) av.push({ k: 'gn_errores', texto: `${D.gn.errores.length} ${D.gn.errores.length === 1 ? 'documento del Gastos nuevo no se pudo leer' : 'documentos del Gastos nuevo no se pudieron leer'} (no están en el estado de resultados): ${D.gn.errores.slice(0, 5).join(', ')}.` });
    // Un crédito de Finanzas → Créditos con cuota este mes y ninguna cuota del Gastos nuevo: su interés faltaría sin aviso
    const viejo = (D.creditos || []).filter(c => c.estado !== 'archivado' && (c.tabla || []).some(f => String(f.fecha || '').slice(0, 7) === mes)), cuotasGN = (D.gastos || []).some(g => FE.mesDe(g.fecha) === mes && g.origenGN === 'credito');
    if (viejo.length && !cuotasGN) av.push({ k: 'gn_credito_falta', texto: `${viejo.map(c => c.nombre).join(', ')}: tiene cuota en ${FE.mesTxt(mes)} en Finanzas → Créditos, pero no hay cuotas en el Gastos nuevo. Desde octubre el interés sale de Gastos → Compromisos → Créditos (súbalo ahí).` });
    const S = TR.saldo(D.gn.D, mesDesde(), mes, areasT), sinF = provision.filter(x => x.sinFicha).map(x => x.nombre);
    e.provisionInfo = { mes: provision.reduce((a, x) => a + x.total, 0), ...S, usadoMes: TR.usosDelMes(D.gn.D, mes).reduce((a, u) => a + u.monto, 0) };
    if (sinF.length) av.push({ k: 'trab_sin_ficha', texto: `${sinF.length} ${sinF.length === 1 ? 'trabajador' : 'trabajadores'} sin los datos de su contrato (${sinF.slice(0, 4).join(', ')}): sus vacaciones se provisionan, pero no su indemnización por años de servicio. Anótelos en su ficha (Gastos → Equipo).` });
    const fl = GF.fletesPorUnir(D.gn.D, mes);   // v0.103.0
    if (fl.n) av.push({ k: 'gn_flete', texto: `${fl.n} ${fl.n === 1 ? 'flete de compra' : 'fletes de compra'} de ${FE.mesTxt(mes)} sin unir a su compra (${pesos(fl.monto)}): todavía no suman al costo de lo comprado. Únalos en Gastos → Bandeja ("¿De qué compra es?").` });
    if (!conCatalogo(R)) av.push({ k: 'gn_sin_catalogo', texto: 'Falta pasar al catálogo de ítems (Gastos → Ítems). Mientras tanto, el tipo de cada gasto sale de Clasificación y no se ven las líneas nuevas (packaging, tiendas, marketing…).' });
    const cuotas = (D.gastos || []).filter(g => FE.mesDe(g.fecha) === mes && FR.normalizar(g.itemGasto) === 'CUOTA DE CREDITO');
    if (cuotas.length) av.push({ k: 'gn_cuota_sin_separar', texto: `${cuotas.length} ${cuotas.length === 1 ? 'cuota de crédito va completa' : 'cuotas de crédito van completas'} (${pesos(cuotas.reduce((a, g) => a + (Number(g.montoNeto) || 0), 0))}) fuera del resultado: falta separar su interés. Anote el monto original y la tasa del crédito en Gastos → Compromisos → Créditos.` });
    e.avisos = (e.avisos || []).concat(av); e.conCatalogo = conCatalogo(R);
    ES.vivo[mes] = e;
    return e;
  }
  // v0.66.0 · Documentos del SII de ese mes por clasificar: su gasto todavía no existe (no están en este estado de resultados)
  const sp = ES.siiPend ? SP.pendientesDelMes(ES.siiPend, mes) : null;
  if (sp && sp.n) e.avisos = (e.avisos || []).concat([{ k: 'sii_por_clasificar', texto: `${sp.n} ${sp.n === 1 ? 'documento del SII' : 'documentos del SII'} de ${FE.mesTxt(mes)} sin clasificar (${SP.fmt(sp.monto)}): su gasto todavía no existe y no está en este estado de resultados. Clasifícalos al conciliar la cartola o en Gastos → Bandeja → Cargas del SII.` }]);
  ES.vivo[mes] = e;
  return e;
}
// Ajustes de meses cerrados que van en el mes abierto M (cálculo de hoy − snapshot − lo ya informado)
async function ajustesPara(R, M) {
  const porMes = {};
  for (const X of Object.keys(ES.cierres || {}).filter(x => x < M && x >= mesDesde() && cerrado(x)).sort()) {   // v0.101.1: los cierres de antes del inicio no se recalculan
    if (FE.mesDeAjuste(X, ES.cierres) !== M) continue;
    const v = await vivo(R, X);
    porMes[X] = FE.ajusteDe(v, ES.cierres[X], FE.yaInformado(ES.cierres, X), FS.yaInformadoCuentas(ES.cierres, X));
  }
  return FE.juntarAjustes(porMes);
}
// El estado de resultados que se muestra: el snapshot si el mes está cerrado; si no, el de hoy + los ajustes
async function delMes(R, mes) {
  if (cerrado(mes)) { const c = ES.cierres[mes]; return { ...c, congelado: true }; }
  const e = await vivo(R, mes), aj = await ajustesPara(R, mes);
  return { ...e, ajustes: aj.total || Object.keys(aj.porMes).length ? aj : null, congelado: false };
}

// ═══════════════ v0.111.0 · El estado de resultados por cuentas: filas clásicas, 4 niveles y "Ver por" ═══════════════
// Hoja de ruta v11, sección 1.1 (aprobado el 26 oct). Ver por: Total (un mes), Meses (desde el inicio, con el acumulado) o
// Temporadas (suma de sus meses); Áreas muestra la forma anterior hasta la v0.112.0. Un mes cerrado usa su foto (sin lecturas
// nuevas); uno abierto, el cálculo de hoy. Lo que se elige (Ver por y nivel) se recuerda en este equipo.
const K_PREF = 'fen_fin_estado';
(() => { try { const x = JSON.parse(localStorage.getItem(K_PREF) || '{}'); if (['total', 'meses', 'temporadas', 'areas', 'canales'].includes(x.verPor)) ES.verPor = x.verPor; if ([1, 2, 3, 4].includes(x.nivel)) ES.nivel = x.nivel; } catch (e) { /* sin memoria del equipo */ } })();
const guardarPref = () => { try { localStorage.setItem(K_PREF, JSON.stringify({ verPor: ES.verPor, nivel: ES.nivel })); } catch (e) { /* sin memoria del equipo */ } };
const VER_POR = [['total', 'Total'], ['meses', 'Meses'], ['temporadas', 'Temporadas'], ['areas', 'Por área'], ['canales', 'Por canal']];   // v0.112.0: los estados por área y por canal
const NIVELES = [[1, 'Resumen'], [2, 'Grupos'], [3, 'Cuentas'], [4, 'Ítems']];
const TXT_ESTADO = 'El estado de resultados de la empresa, en neto, con las filas de siempre en contabilidad: ventas, margen bruto (food cost), margen de contribución, margen de producción, EBITDA, resultado operacional y utilidad neta.\nCada fila se forma con cuentas del plan, según la cuenta del ítem de cada gasto (Gastos → Ítems). Nivel: 1 Resumen (las filas) · 2 Grupos · 3 Cuentas · 4 Ítems (y sus documentos). La flecha de una fila abre solo esa fila.\nVer por: Total (el mes elegido), Meses (cada mes de un período, Desde–Hasta, y su total), Temporadas, Por área (cada línea de negocio hasta su aporte) o Por canal (B2B, Barros Arana y Ainavillo hasta su aporte). En los dos últimos, lo que no es de nadie va en Común, sin repartir, y la suma cuadra con el resultado operacional de la empresa.\nUn mes cerrado se ve como quedó al cerrarlo.';
// El estado por cuentas de un mes: la foto del cierre (si la tiene) o el cálculo de hoy
const estadoDe = e => (e._est || (e._est = (e.congelado && e.estadoCuentas && e.estadoCuentas.forma) ? e.estadoCuentas : FS.armarEstado(e)));
// ── Período (v0.112.0): Meses usa Desde–Hasta (por defecto, el año en curso desde el inicio); Por área y Por canal también
// (por defecto, el mes elegido). Temporadas: desde el inicio, las últimas 8. Un mes cerrado sale de su foto (1 lectura).
const mesesTodos = () => { const out = []; for (let m = mesDesde(), k = 0; m <= mesHoy() && k < 240; m = FE.mesMas(m, 1), k++) out.push(m); return out; };
const ordenado = p => (p.desde <= p.hasta ? p : { desde: p.hasta, hasta: p.desde });
function periodo() {
  const todos = mesesTodos(), ok = m => todos.includes(m);
  if (ES.verPor === 'meses') {
    const def = { desde: [`${mesHoy().slice(0, 4)}-01`, mesDesde()].sort().pop(), hasta: mesHoy() };
    if (!ES.perMeses || !ok(ES.perMeses.desde) || !ok(ES.perMeses.hasta)) ES.perMeses = def;
    return (ES.perMeses = ordenado(ES.perMeses));
  }
  if (!ES.perSeg || !ok(ES.perSeg.desde) || !ok(ES.perSeg.hasta)) ES.perSeg = { desde: ES.mes, hasta: ES.mes };
  return (ES.perSeg = ordenado(ES.perSeg));
}
function mesesSerie() {
  const todos = mesesTodos();
  if (ES.verPor === 'temporadas') { const ts = [...new Set(todos.map(m => FS.temporadaDe(m).k))].slice(-8); return todos.filter(m => ts.includes(FS.temporadaDe(m).k)); }
  const p = periodo(); return todos.filter(m => m >= p.desde && m <= p.hasta);
}
const textoPer = p => (p.desde === p.hasta ? FE.mesTxt(p.desde) : `${FE.mesTxt(p.desde)} a ${FE.mesTxt(p.hasta)}`);
// Las columnas de cada "Ver por": { key, t, est, e?, k (columna del estado: 't' total, 'a:PAN' un área, 'c:b2b' un canal), seg (corta en el aporte) }
async function serie(R) {
  const meses = [];
  for (const m of mesesSerie()) { const e = await delMes(R, m); meses.push({ key: m, t: FE.mesTxt(m), est: estadoDe(e), e, congelado: !!e.congelado }); }
  if (ES.verPor === 'temporadas') {
    const T = {}; meses.forEach(c => { const t = FS.temporadaDe(c.key), x = T[t.k] || (T[t.k] = { key: t.k, t: t.t, orden: t.orden, ests: [], meses: [] }); x.ests.push(c.est); x.meses.push(c.key); });
    return { cols: Object.values(T).sort((a, b) => a.orden.localeCompare(b.orden)).map(x => ({ key: x.key, t: x.t, est: FS.sumarEstados(x.ests), sub: x.meses.map(m => FE.mesTxt(m).split(' ')[0].slice(0, 3)).join(' · ') })), meses };
  }
  if (ES.verPor === 'meses') return { cols: meses.length > 1 ? meses.concat([{ key: 'acum', t: 'Total del período', est: FS.sumarEstados(meses.map(c => c.est)), acum: true }]) : meses, meses };
  // Por área o por canal: el período sumado, una columna por área o canal, Común y Total
  const est = meses.length === 1 ? meses[0].est : FS.sumarEstados(meses.map(c => c.est)), areas = ES.verPor === 'areas';
  const claves = areas ? FS.AREAS_EST.filter(a => a !== 'REVENTA' || FS.conDatos(est, 'a:' + a)) : FS.CANALES;
  const cols = claves.map(k => ({ key: k, t: areas ? FE.NOMBRE_COL[k] : FS.NOMBRE_CANAL[k], est, k: (areas ? 'a:' : 'c:') + k, seg: true }))
    .concat([{ key: 'comun', t: 'Común', sub: 'sin repartir', est, k: areas ? 'a:comun' : 'c:comun', seg: true, comun: true }, { key: 'total', t: 'Total', est, k: 't', acum: true }]);
  return { cols, meses, est, e: meses.length === 1 ? meses[0].e : null };
}
function verPorHtml(H) {
  return `<div class="fin-everpor">
    <div class="pastillas" role="group" aria-label="Ver por">${VER_POR.map(([k, t]) => `<button type="button" class="pastilla" data-e-verpor="${k}" aria-pressed="${ES.verPor === k}">${H.esc(t)}</button>`).join('')}</div>
    ${ES.vista === 'repartido' && ES.verPor === 'areas' ? '' : `<div class="pastillas fin-enivel" role="group" aria-label="Nivel de detalle"><span class="fin-enivel-t">Nivel</span>${NIVELES.map(([n, t]) => `<button type="button" class="pastilla" data-e-nivel="${n}" aria-pressed="${ES.nivel === n}">${n} ${H.esc(t)}</button>`).join('')}</div>`}</div>`;
}
// Desde – Hasta (Meses, Por área, Por canal)
function selectorPeriodo(H) {
  const p = periodo(), ms = mesesTodos().slice().reverse();
  const sel = (id, et, v) => `<div class="campo fin-emes"><label for="${id}">${et}</label><select id="${id}">${ms.map(m => `<option value="${m}" ${m === v ? 'selected' : ''}>${H.esc(FE.mesTxt(m))}${cerrado(m) ? ' · cerrado' : m === mesHoy() ? ' · en curso' : ''}</option>`).join('')}</select></div>`;
  return `<div class="fin-ecab fin-eper">${sel('e-desde', 'Desde', p.desde)}${sel('e-hasta', 'Hasta', p.hasta)}</div>`;
}
const fmtE = (v, signo) => (signo === '−' ? (v ? `−${pesos(v)}` : '—') : signo === '±' ? (v ? `${v > 0 ? '+' : '−'}${pesos(Math.abs(v))}` : '—') : pesos(v));
// ¿Está abierto un nodo? Por el nivel elegido, salvo que se haya cerrado a mano (o abierto a mano)
const abiertoE = (key, prof) => ES.abiertosE.has(key) || (ES.nivel > prof && !ES.cerradosE.has(key));
const I_RESOP = FS.FILAS.findIndex(f => f.k === 'resOp');
function htmlTablaEstado(H, cols) {
  const A = FS.arbol([...new Set(cols.map(c => c.est))]), uno = ES.verPor === 'total' && cols.length === 1 && cols[0].e, out = [];
  const seg = cols.some(c => c.seg);
  const ck = c => c.k || 't';
  // En los estados por área y por canal, cada columna llega hasta su aporte; lo de abajo (financieros, impuesto…) es solo de la empresa
  const corta = (c, i) => c.seg && i > I_RESOP;
  const tog = (key, prof, abierto, txt) => `<button type="button" class="fin-etog" data-e-tog="${H.esc(key)}" data-e-prof="${prof}" aria-expanded="${abierto}" aria-label="${abierto ? 'Cerrar' : 'Abrir'} ${H.esc(txt)}">${ic('abajo', 14)}</button>`;
  const fila = (cls, th, valores) => `<tr class="${cls}">${th}${valores}</tr>`;
  const td = (c, i, html, cls = '') => `<td class="fin-enum${c.comun ? ' fin-ecomun' : ''}${cls}">${corta(c, i) ? '' : html}</td>`;
  FS.FILAS.forEach((f, i) => {
    const titulo = seg && f.k === 'resOp' ? 'Aporte (resultado operacional)' : f.t;
    if (f.res) {
      const tds = cols.map(c => {
        if (corta(c, i)) return td(c, i, '');
        const k = ck(c), v = FS.valor(c.est.filas[f.k], k), ven = FS.valor(c.est.filas.ventas, k), I = FS.indicadores(c.est, k);
        const sub = !ven || c.comun ? '' : f.k === 'mb' ? `${pct(I.margenBruto)} · food cost ${pct(I.foodCost)}` : f.k === 'mp' ? `${pct(v / ven * 100)} · prime cost ${pct(I.primeCost)}` : pct(v / ven * 100);
        return td(c, i, `<span>${pesos(v)}</span>${sub ? `<small class="fin-epct">${sub}</small>` : ''}`, v < 0 ? ' fin-eneg' : '');
      }).join('');
      out.push(fila(`fin-eres fin-en1`, `<th scope="row" data-e-fila2="${f.k}"><span class="fin-etog-v"></span><span class="fin-esig" aria-hidden="true">=</span>${H.esc(titulo)} ${H.info(titulo, FS.AYUDA[f.k])}</th>`, tds));
      return;
    }
    const grupos = A[f.k] || [], ab = grupos.length && abiertoE(f.k, 1);
    out.push(fila('fin-en1', `<th scope="row" data-e-fila2="${f.k}">${grupos.length ? tog(f.k, 1, !!ab, f.t) : '<span class="fin-etog-v"></span>'}${f.signo ? `<span class="fin-esig" aria-hidden="true">${f.signo}</span>` : ''}${H.esc(f.t)} ${H.info(f.t, FS.AYUDA[f.k])}</th>`,
      cols.map(c => td(c, i, fmtE(FS.valor(c.est.filas[f.k], ck(c)), f.signo))).join('')));
    if (!ab) return;
    grupos.forEach(g => {
      const kg = `${f.k}|${g.grupo}`, soloUna = g.cuentas.length === 1 && g.cuentas[0].cuenta === g.grupo;
      // Un grupo con una sola cuenta (la misma) se abre directo en sus ítems (nivel 4)
      const hijos = soloUna ? g.cuentas[0].items.length : g.cuentas.length, profG = soloUna ? 3 : 2, abG = hijos && abiertoE(kg, profG);
      out.push(fila('fin-en2', `<th scope="row">${hijos ? tog(kg, profG, !!abG, g.nombre) : '<span class="fin-etog-v"></span>'}<span class="fin-ecod">${H.esc(g.grupo)}</span>${H.esc(g.nombre)}</th>`,
        cols.map(c => td(c, i, fmtE(FS.valorGrupo(c.est, f.k, g.grupo, ck(c)), f.signo))).join('')));
      if (!abG) return;
      const items = (cuenta, its, cls) => its.forEach(it => out.push(fila(cls, `<th scope="row"><span class="fin-etog-v"></span>${H.esc(it)}</th>`,
        cols.map(c => { const v = FS.valorItem(c.est, f.k, cuenta, it, ck(c)); return td(c, i, uno && v ? `<button type="button" class="fin-ecel" data-e-item="${H.esc(`${f.k}|${cuenta}|${it}`)}" aria-label="${H.esc(it)}: ver de dónde sale">${fmtE(v, f.signo)}</button>` : fmtE(v, f.signo)); }).join(''))));
      if (soloUna) { items(g.grupo, g.cuentas[0].items, 'fin-en4 fin-en4-g'); return; }
      g.cuentas.forEach(cu => {
        const kc = `${kg}|${cu.cuenta}`, abC = cu.items.length && abiertoE(kc, 3);
        out.push(fila('fin-en3', `<th scope="row">${cu.items.length ? tog(kc, 3, !!abC, cu.nombre) : '<span class="fin-etog-v"></span>'}<span class="fin-ecod">${H.esc(cu.cuenta)}</span>${H.esc(cu.nombre)}</th>`,
          cols.map(c => td(c, i, fmtE(FS.valorCuenta(c.est, f.k, cu.cuenta, ck(c)), f.signo))).join('')));
        if (abC) items(cu.cuenta, cu.items, 'fin-en4');
      });
    });
  });
  // Ajustes de meses cerrados (solo en un mes abierto, Ver por: Total)
  const e = uno ? cols[0].e : null;
  if (e && e.ajustes) {
    const u = FS.valor(cols[0].est.filas.utilidad) + (e.ajustes.total || 0);
    out.push(fila('fin-eaj fin-en1', `<th scope="row"><span class="fin-etog-v"></span><span class="fin-esig" aria-hidden="true">±</span>Ajustes de meses cerrados</th>`, `<td class="fin-enum"><button type="button" class="fin-ecel" data-e-det="ajustes" aria-label="Ajustes de meses cerrados: ver de dónde salen">${fmtE(e.ajustes.total || 0, '±')}</button></td>`));
    out.push(fila('fin-eres fin-en1', `<th scope="row"><span class="fin-etog-v"></span><span class="fin-esig" aria-hidden="true">=</span>Utilidad neta con ajustes</th>`, `<td class="fin-enum${u < 0 ? ' fin-eneg' : ''}"><span>${pesos(u)}</span></td>`));
  }
  const th = `<tr><th scope="col">Concepto</th>${cols.map(c => `<th scope="col" class="fin-enum${c.acum ? ' fin-eacum' : ''}${c.comun ? ' fin-ecomun' : ''}">${H.esc(c.t)}${c.congelado ? ` <span class="fin-ecand" title="Mes cerrado">${ic('candado', 12)}</span>` : ''}${c.sub ? `<small class="fin-epct">${H.esc(c.sub)}</small>` : ''}</th>`).join('')}</tr>`;
  const cap = ES.verPor === 'total' ? 'de ' + FE.mesTxt(ES.mes) : ES.verPor === 'areas' ? 'por área' : ES.verPor === 'canales' ? 'por canal' : 'por ' + ES.verPor;
  return `<div class="tabla-b2b fin-etabla"><table class="tabla-tiempos fin-eerr fin-estado" id="e-estado-tabla"><caption class="sr">Estado de resultados ${H.esc(cap)}</caption><thead>${th}</thead><tbody>${out.join('')}</tbody></table></div>`;
}
// La línea que cuadra (Por área y Por canal): suma de los aportes − comunes = resultado operacional de la empresa
function htmlCuadre(H, S) {
  const pre = ES.verPor === 'areas' ? 'a:' : 'c:', est = S.est, cols = S.cols.filter(c => c.seg && !c.comun);
  const aportes = cols.reduce((a, c) => a + FS.valor(est.filas.resOp, c.k), 0), comun = FS.valor(est.filas.resOp, pre + 'comun'), tot = FS.valor(est.filas.resOp);
  const ok = Math.abs(aportes + comun - tot) <= 1;
  return `<p class="fin-ecuadre${ok ? '' : ' error'}" id="e-cuadre">${ic(ok ? 'check' : 'aviso', 16)} <span>Suma de los aportes de ${ES.verPor === 'areas' ? 'las áreas' : 'los canales'} <b>${pesos(aportes)}</b> ${comun <= 0 ? '−' : '+'} comunes sin repartir <b>${pesos(Math.abs(comun))}</b> = resultado operacional <b>${pesos(tot)}</b>${ok ? ', el mismo del estado de la empresa.' : '. No cuadra: avise a Claude (es un error del sistema, no de sus datos).'}</span></p>`;
}
const TXT_COMUN_AREA = 'Lo que no es de ninguna línea de negocio: las tiendas y B2B (lo que cuesta vender), administración, lo financiero y las ventas de productos sin asociar. Va sin repartir: repartirlo a ojo puede hacer parecer que un área pierde cuando en realidad aporta. Para conversar, está la vista "Comunes repartidos".';
const TXT_COMUN_CANAL = 'Lo que no es de ningún canal: la gente y los gastos de producción, la merma, el packaging y el producto regalado, administración y lo financiero. Va sin repartir.';
function htmlEstado(H, e, S, R) {
  const total = ES.verPor === 'total', cols = S.cols, segs = ES.verPor === 'areas' || ES.verPor === 'canales';
  if (ES.vista === 'repartido' && !(ES.verPor === 'areas' && S.e)) ES.vista = 'principal';   // v0.112.0: con varios meses no hay repartido (vuelven los niveles)
  const rep = segs && ES.verPor === 'areas' && ES.vista === 'repartido' && S.e;
  // El estado por cuentas tiene que cuadrar al peso con el cálculo de siempre (si no, se avisa)
  // (la utilidad, el resultado operacional y los primeros pisos: ventas con el despacho cobrado, costo directo y costos variables)
  const T = (c, k) => Number(((c.e.filas || {})[k] || {}).total || 0), dif = (c, a, v) => Math.abs(FS.valor(c.est.filas[a]) - v) > 1;
  const conE = (S.meses || cols).filter(c => c.e && !c.e.congelado);
  const descuadre = conE.filter(c => dif(c, 'utilidad', T(c, 'resultado')) || dif(c, 'resOp', T(c, 'resOp')) || dif(c, 'ventas', T(c, 'ventas') + T(c, 'cargos'))
    || dif(c, 'costoDirecto', T(c, 'costoDirecto')) || dif(c, 'variables', T(c, 'costosVenta') + T(c, 'packaging') + T(c, 'merma') + T(c, 'regalado'))).map(c => FE.mesTxt(c.key));
  const avisosMes = total ? (e.avisos || []) : (S.meses || []).length === 1 && S.meses[0].e ? (S.meses[0].e.avisos || []) : [];
  const avisos = avisosMes.map(a => a.texto).concat(descuadre.length ? [`El estado por cuentas no cuadra con el cálculo del mes (${descuadre.join(', ')}). Avise a Claude: es un error del sistema, no de sus datos.`] : []);
  const abiertos = (S.meses || []).filter(c => c.e && !c.congelado).map(c => FE.mesTxt(c.key));
  const nota = total ? '' : ES.verPor === 'temporadas' ? 'Cada temporada suma sus meses (verano: diciembre a febrero; las últimas 8).'
    : ES.verPor === 'meses' ? `${textoPer(periodo())}: cada mes${cols.some(c => c.acum) ? ' y el total del período' : ''}.`
    : `${textoPer(periodo())}. Cada ${ES.verPor === 'areas' ? 'área' : 'canal'} llega hasta su aporte; Común es lo que no es de ${ES.verPor === 'areas' ? 'ninguna área' : 'ningún canal'}, sin repartir. ${H.info('Común', ES.verPor === 'areas' ? TXT_COMUN_AREA : TXT_COMUN_CANAL)}`;
  return `<section class="tarjeta" aria-labelledby="t-e-eerr">
    <div class="titulo-fila fin-titulo"><h2 id="t-e-eerr">Estado de resultados ${H.info('Estado de resultados', TXT_ESTADO)}</h2>
      <button type="button" class="btn-sec btn-chico" id="e-releer">${ic('revisar', 16)} Volver a leer</button></div>
    ${total ? `<div class="fin-ecab">${selectorMes(H)}</div>` : ES.verPor === 'temporadas' ? '' : selectorPeriodo(H)}
    ${verPorHtml(H)}
    ${total ? bannerMes(H, e) : `<p class="ayuda fin-eserie" id="e-serie">${nota} ${ES.verPor === 'temporadas' || ES.verPor === 'meses' ? `Los meses cerrados se ven como quedaron al cerrarlos${abiertos.length ? `; ${abiertos.join(', ')} ${abiertos.length === 1 ? 'está abierto y se calcula' : 'están abiertos y se calculan'} con lo que hay hoy` : ''}.` : ''}</p>`}
    ${ES.verPor === 'areas' ? `<div class="pastillas fin-evista" role="group" aria-label="Cómo ver los comunes"><button type="button" class="pastilla" data-e-vista="principal" aria-pressed="${ES.vista !== 'repartido'}">Comunes sin repartir</button><button type="button" class="pastilla" data-e-vista="repartido" aria-pressed="${ES.vista === 'repartido'}" ${S.e ? '' : 'disabled aria-disabled="true" title="Solo para un mes (Desde y Hasta iguales)"'}>Comunes repartidos · para conversar</button></div>` : ''}
    ${mensajes(H)}
    ${avisos.length ? `<ul class="fin-eavisos" id="e-avisos">${avisos.map(t => `<li>${ic('aviso', 16)}<span>${H.esc(t)}</span></li>`).join('')}</ul>` : ''}
    ${rep ? htmlRepartido(H, S.e, R) : htmlTablaEstado(H, cols)}
    ${segs && !rep ? htmlCuadre(H, S) : ''}
    <p class="nota-i">(i) Los % son sobre las ventas netas de la columna. ${total ? 'Toque la cifra de un ítem para ver los documentos o las ventas que la forman.' : 'El detalle de cada documento se ve en Ver por: Total.'}</p>
  </section>
  ${total ? `${htmlRenta(H, e)}${htmlInfo(H, e)}${htmlProvision(H, e)}${htmlOtros(H, e)}${htmlTributario(H, e, R)}${htmlCuadratura(H, e)}` : ''}`;
}
// Los documentos o ventas de un ítem (nivel 4)
function dialogoItem(H, e, fila, cuenta, item) {
  const refs = FS.refsDe(e, fila, cuenta, item), tot = Math.abs(refs.reduce((a, r) => a + r.montoEnCuenta, 0));
  const K = { ventas: 'ventas', costoDirecto: 'costoDirecto' };
  const d = H.dialogo(`<div class="form-dialogo fin-edet"><h2>${H.esc(item)}</h2><p class="fin-actual">${H.esc((FS.FILA[fila] || {}).t || fila)} · ${H.esc(cuenta)} ${H.esc(FS.nombreCuenta(cuenta))} · ${H.esc(FE.mesTxt(ES.mes))} · <b>${pesos(tot)}</b></p>
    ${refs.length ? `<ul class="fin-hist-lista fin-edlista" id="e-item-lista">${refs.slice(0, 300).map(r => lineaRef(H, r, K[fila] || '', Math.abs(r.montoEnCuenta))).join('')}</ul>${refs.length > 300 ? `<p class="ayuda">Y ${nf(refs.length - 300)} más.</p>` : ''}` : '<p class="ayuda">Sin detalle.</p>'}
    <div class="botones"><button type="button" class="btn" id="e-item-ok">Cerrar</button></div></div>`);
  d.querySelector('#e-item-ok').addEventListener('click', () => d.close());
  d.querySelectorAll('[data-e-ver]').forEach(b => b.addEventListener('click', () => { d.close(); if (H.verGastos) H.verGastos(b.dataset.eVermes, b.dataset.eVer); }));
}

// ═══════════════ Estado de resultados ═══════════════
function selectorMes(H, id = 'e-mes') {
  const meses = FE.mesesDelAnio(FR.ANIO, hoyTxt()).filter(m => m >= mesDesde());
  return `<div class="campo fin-emes"><label for="${id}">Mes</label><select id="${id}">${meses.map(m => `<option value="${m}" ${m === ES.mes ? 'selected' : ''}>${H.esc(FE.mesTxt(m))}${cerrado(m) ? ' · cerrado' : m === mesHoy() ? ' · en curso' : ''}</option>`).join('')}</select></div>`;
}
export async function pintarEERR(el, H, ctx, R) {
  ES.mes = mesValido(ES.mes);
  const tope = (cuerpo) => R.cabecera() + cuerpo;
  el.innerHTML = tope(`<section class="tarjeta"><div class="vacio" style="border:0" role="status" id="e-leyendo">Calculando el estado de resultados…</div></section>`);
  let e, S;
  try {
    await base();
    e = await delMes(R, ES.mes);
    // v0.112.0 · Ver por: Total (el mes), Meses (Desde–Hasta), Temporadas, Por área y Por canal (el período sumado)
    S = ES.verPor === 'total' ? { cols: [{ key: ES.mes, t: 'Total', est: estadoDe(e), e }], meses: [{ key: ES.mes, e, est: estadoDe(e) }] } : await serie(R);
  } catch (er) { el.innerHTML = tope(`<section class="tarjeta"><p class="error" role="alert">${H.esc(ctx.error(er, H))}</p></section>`); return; }
  if (!/^#finanzas\/resultados\/?$/.test(location.hash) && !/^#finanzas\/resultados\/eerr/.test(location.hash)) return;
  el.innerHTML = tope(htmlEstado(H, e, S, R));
  conectarEERR(el, H, ctx, R, e, S);
}
// El aviso del mes (cerrado y congelado, o abierto)
function bannerMes(H, e) {
  const congel = e.congelado ? ES.cierres[ES.mes] : null;
  return congel ? `<div class="fin-econg" id="e-estado">${ic('candado', 18)}<span><b>Mes cerrado</b> el ${fechaTxt(congel.cerradoEn)} por ${H.esc(congel.cerradoPor || '—')}: se ve congelado, como quedó al cerrarlo.${congel.override ? ` Se cerró con revisiones pendientes: ${H.esc(congel.override.motivo)}.` : ''} ${H.info('Mes cerrado', 'Un mes cerrado no se toca: lo que se ve es el snapshot guardado al cerrarlo (ventas, costos, gastos y créditos de ese momento).\nSi después cambia algo de ese mes (un gasto corregido, una factura que llegó tarde), la diferencia aparece como "Ajustes de meses cerrados" en el primer mes abierto siguiente.')}</span></div>`
    : `<div class="fin-econg fin-eabierto" id="e-estado">${ic('abierto', 18)}<span><b>Mes abierto</b>: se calcula con lo que hay hoy. ${ES.mes < mesHoy() ? `Ciérralo en <a href="#finanzas/resultados/cierre">Cierre de mes</a> cuando esté completo.` : 'Es el mes en curso.'}</span></div>`;
}

// ── v0.106.0 · Otros ingresos y gastos (no del giro) e impuesto a la renta estimado ──
const TXT_OTROS = 'Lo que entra o sale y no es de la panadería: vender un equipo usado, un evento puntual, intereses ganados, una multa que no es del giro. Va debajo del resultado operacional, para que no se confunda con lo que da el negocio.\nNada se borra: se anula, con quién y cuándo.';
const TXT_RENTA = 'Una estimación mensual del impuesto a la renta (Primera Categoría), para no llevarse la sorpresa en abril: la tasa de su régimen sobre el resultado antes de impuesto del mes, solo si es positivo. La tasa la confirma su contador (por ejemplo, el régimen Pro Pyme tiene una tasa distinta del general).\nEs de gestión: el impuesto real sale del F22, sobre la renta tributaria (con sus propias reglas). Un cambio de tasa rige para los meses abiertos; los cerrados quedan como se cerraron.';
// v0.112.0 · La tasa del impuesto a la renta en su propia tarjeta, a la vista (antes quedaba bajo "Anotar" en Otros ingresos y gastos)
function htmlRenta(H, e) {
  const tasa = Number((ES.renta || {}).tasa) || 0, editable = !e.congelado;
  return `<section class="tarjeta fin-erenta" aria-labelledby="t-e-renta"><div class="titulo-fila fin-titulo"><h2 id="t-e-renta">Tasa del impuesto a la renta ${H.info('Impuesto a la renta estimado', TXT_RENTA)}</h2></div>
    <div class="fin-renta" id="e-renta"><span>${tasa ? `tasa <b>${String(tasa).replace('.', ',')}%</b>${(ES.renta || {}).nota ? ' · ' + H.esc(ES.renta.nota) : ''}` : '<b>sin tasa</b> (confírmela con su contador; mientras, va en $0)'}</span>${editable ? '<button type="button" class="btn-link btn-chico" id="e-renta-cambiar">Cambiar la tasa</button>' : ''}</div></section>`;
}
function htmlOtros(H, e) {
  const l = (ES.otros || []).filter(x => x.mes === ES.mes), editable = !e.congelado;
  return `<section class="tarjeta" aria-labelledby="t-e-otros"><div class="titulo-fila fin-titulo"><h2 id="t-e-otros">Otros ingresos y gastos ${H.info('Otros ingresos y gastos', TXT_OTROS)}</h2>${editable ? '<button type="button" class="btn-sec btn-chico" id="e-otro-nuevo">Anotar</button>' : ''}</div>
    <ul class="fin-hist-lista" id="e-otros">${l.map(x => `<li><div><b>${H.esc(x.descripcion)}</b> · ${fechaTxt(x.fecha)}${x.estado === 'anulado' ? ' · <span class="chip c-gris chip-chico">anulado</span>' : ''}</div><span class="ayuda">${x.tipo === 'gasto' ? 'Gasto' : 'Ingreso'} · ${H.esc((x.creado || {}).por || '')}${x.estado === 'anulado' && x.anulado ? ` · anulado por ${H.esc(x.anulado.por || '')}${x.anulado.motivo ? ': ' + H.esc(x.anulado.motivo) : ''}` : ''}</span><b class="fin-edval">${x.tipo === 'gasto' ? '−' : '+'}${pesos(x.monto)}</b>${editable && x.estado !== 'anulado' ? `<button type="button" class="btn-link btn-chico" data-e-anular="${H.esc(x.id)}">Anular</button>` : ''}</li>`).join('') || `<li class="ayuda">Nada anotado en ${H.esc(FE.mesTxt(ES.mes))}.</li>`}</ul>
</section>`;
}
// ── v0.108.0 · Gestión y tributario: lo que ve el contador, lo que ve la gestión y la diferencia; los trámites ──
const TXT_TRIBF = 'El estado de resultados de arriba es el de gestión: todos los gastos reales del negocio. El contador ve solo los que el SII acepta como gasto de la empresa.\nLa diferencia son los gastos por regularizar (con su trámite: por ejemplo, el auto en comodato o Ainavillo) y los no aceptados. Como el SII no los descuenta, la base para el impuesto es el resultado antes de impuesto más esa diferencia.\nLa situación de cada gasto se pone en Gastos: en la ficha del proveedor (o de su servicio), en el compromiso o en el ítem, desde una fecha.';
const ESTADO_TXT = { pendiente: 'Pendiente', en_curso: 'En curso', resuelto: 'Resuelto' };
function htmlTributario(H, e, R) {
  const I = (e.info || {}).tributario, T = ((R.datos || {}).gn && R.datos.gn.D && R.datos.gn.D.tributario) || {}, G = Object.entries(T.grupos || {});
  if (!I || (!I.noAceptados && !G.length)) return '';
  const l = (t, v, cls = '') => `<div class="fin-einfo-l${cls}"><span>${t}</span><b>${pesos(v)}</b></div>`;
  return `<section class="tarjeta" aria-labelledby="t-e-trib"><div class="titulo-fila fin-titulo"><h2 id="t-e-trib">Gestión y tributario ${H.info('Gestión y tributario', TXT_TRIBF)}</h2></div>
    <div class="fin-einfo" id="e-trib"><div><h3>Gastos del mes en el resultado</h3>${l('Lo que ve la gestión (todos)', I.total)}${l('Lo que ve el contador (aceptados)', I.aceptado)}${l('Por regularizar', I.regularizar)}${l('No aceptados', I.no_aceptado)}${l('Diferencia', I.noAceptados, ' fin-einfo-t')}</div>
      <div><h3>Base del impuesto estimado</h3>${l('Resultado antes de impuesto', ((e.filas || {}).resAntesImp || {}).total || 0)}${l('+ Gastos que el SII no acepta', I.noAceptados)}${l('= Base tributaria estimada', Number.isFinite(I.base) ? I.base : 0, ' fin-einfo-t')}</div></div>
    ${G.length ? `<h3 class="fin-trib-h">Trámites</h3><ul class="fin-hist-lista" id="e-tramites">${G.map(([id, g]) => { const m = (I.grupos || {})[id]; return `<li><div><b>${H.esc(g.nombre)}</b> · <span class="chip ${g.estado === 'resuelto' ? 'c-verde' : g.estado === 'en_curso' ? 'c-azul' : 'c-amarillo'} chip-chico">${H.esc(ESTADO_TXT[g.estado] || 'Pendiente')}</span>${m ? ` · este mes ${pesos(m.regularizar + m.no_aceptado)}` : ''}</div>
      <span class="ayuda">${g.falta ? 'Falta: ' + H.esc(g.falta) : 'Falta anotar qué hace falta'}${g.quien ? ' · ' + H.esc(g.quien) : ''}${g.nota ? ' · ' + H.esc(g.nota) : ''}</span>${e.congelado ? '' : `<button type="button" class="btn-link btn-chico" data-e-tramite="${H.esc(id)}">Cambiar</button>`}</li>`; }).join('')}</ul>` : ''}
    ${(I.detalle || []).length ? `<details class="gn-det"><summary>Detalle de lo que el SII no acepta · ${I.detalle.length}</summary><ul class="fin-hist-lista">${I.detalle.slice(0, 200).map(x => `<li><div><b>${H.esc(x.item)}</b> · ${fechaTxt(x.fecha)} · ${H.esc(x.proveedor || '')}</div><span class="ayuda">${x.situacion === 'regularizar' ? 'Por regularizar' : 'No aceptado'}${(T.grupos || {})[x.grupo] ? ' · ' + H.esc(T.grupos[x.grupo].nombre) : ''} · ${H.esc(x.area || '')}</span><b class="fin-edval">${pesos(x.neto)}</b></li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function conectarTributario(el, H, ctx, R, repintar) {
  el.querySelectorAll('[data-e-tramite]').forEach(b => b.addEventListener('click', () => {
    const T = R.datos.gn.D.tributario || {}, id = b.dataset.eTramite, g = (T.grupos || {})[id]; if (!g) return;
    const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Trámite</h2>
      <div class="campo"><label for="et-n">Nombre</label><input id="et-n" maxlength="60" value="${H.esc(g.nombre)}"></div>
      <div class="chips" role="radiogroup" aria-label="Estado">${Object.entries(ESTADO_TXT).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="et-e" value="${k}" ${(g.estado || 'pendiente') === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      <div class="campo"><label for="et-f">Qué falta</label><input id="et-f" maxlength="300" value="${H.esc(g.falta || '')}" placeholder="Ej: que el SII acepte el comodato"></div>
      <div class="campo"><label for="et-q">Quién (opcional)</label><input id="et-q" maxlength="80" value="${H.esc(g.quien || '')}" placeholder="Ej: el contador"></div>
      <div class="campo"><label for="et-o">Nota (opcional)</label><input id="et-o" maxlength="300" value="${H.esc(g.nota || '')}"></div>
      <p class="ayuda">Cuando se resuelva, cambie la situación de sus gastos en Gastos (ficha, compromiso o ítem) desde la fecha en que rige.</p>
      <p class="error" id="et-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="et-c">Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
    d.querySelector('#et-c').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const bt = d.querySelector('[type=submit]'); bt.disabled = true;
      const x = { nombre: d.querySelector('#et-n').value, estado: (d.querySelector('[name=et-e]:checked') || {}).value || 'pendiente', falta: d.querySelector('#et-f').value, quien: d.querySelector('#et-q').value, nota: d.querySelector('#et-o').value };
      try { await (await import('./gn-fs.js?v=0.138.0')).guardarTramite(id, x); T.grupos[id] = { ...g, ...x }; ES.vivo = {}; H.registrar('Finanzas: trámite tributario', `${x.nombre} · ${ESTADO_TXT[x.estado]}`); ES.msg = `Trámite guardado: ${x.nombre}.`; d.close(); repintar(); }
      catch (e) { d.querySelector('#et-err').textContent = ctx.error(e, H); bt.disabled = false; }
    });
  }));
}
function conectarOtros(el, H, ctx, repintar) {
  const nuevo = $('e-otro-nuevo');
  if (nuevo) nuevo.addEventListener('click', () => {
    const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Otro ingreso o gasto</h2><p class="ayuda">Solo lo que no es de la panadería. Una venta o una compra del negocio va por Ventas o por Gastos.</p>
      <div class="chips" role="radiogroup" aria-label="Tipo"><label class="chip-radio"><input type="radio" name="eo-t" value="ingreso" checked><span>Ingreso</span></label><label class="chip-radio"><input type="radio" name="eo-t" value="gasto"><span>Gasto</span></label></div>
      <div class="campo"><label for="eo-desc">De qué es</label><input id="eo-desc" maxlength="160" placeholder="Por ejemplo: venta de la batidora antigua"></div>
      <div class="fila-campos"><div class="campo"><label for="eo-fecha">Fecha</label><input id="eo-fecha" type="date" value="${ES.mes === mesHoy() ? hoyTxt() : ES.mes + '-01'}" min="${ES.mes}-01" max="${ES.mes}-${String(new Date(Number(ES.mes.slice(0, 4)), Number(ES.mes.slice(5, 7)), 0).getDate())}"></div>
      <div class="campo"><label for="eo-monto">Monto</label><input id="eo-monto" inputmode="numeric" placeholder="Ej: 150000"></div></div>
      <p class="error" id="eo-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="eo-cancelar">Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
    d.querySelector('#eo-cancelar').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const err = d.querySelector('#eo-err'), b = d.querySelector('[type=submit]');
      const x = { tipo: d.querySelector('[name=eo-t]:checked').value, descripcion: d.querySelector('#eo-desc').value, fecha: d.querySelector('#eo-fecha').value, monto: d.querySelector('#eo-monto').value };
      try { F.validarOtro(x); } catch (e) { err.textContent = e.message; return; }
      b.disabled = true;
      try { const g = await F.guardarOtro(x); ES.otros = (ES.otros || []).concat([g]); ES.vivo = {}; H.registrar('Finanzas: anotó otro ingreso o gasto', `${g.tipo} · ${g.descripcion} · ${g.monto}`); ES.msg = `Anotado: ${g.descripcion} (${g.tipo === 'gasto' ? '−' : '+'}${pesos(g.monto)}).`; ES.err = ''; d.close(); repintar(); }
      catch (e) { err.textContent = ctx.error(e, H); b.disabled = false; }
    });
  });
  el.querySelectorAll('[data-e-anular]').forEach(b => b.addEventListener('click', () => {
    const x = (ES.otros || []).find(o => o.id === b.dataset.eAnular); if (!x) return;
    const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Anular</h2><p class="ayuda"><b>${H.esc(x.descripcion)}</b> · ${pesos(x.monto)}. No se borra: queda anulado, con quién y cuándo.</p>
      <div class="campo"><label for="ea-mot">Motivo (opcional)</label><input id="ea-mot" maxlength="200"></div><p class="error" id="ea-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="ea-cancelar">Cancelar</button><button type="submit" class="btn">Anular</button></div></form>`);
    d.querySelector('#ea-cancelar').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const bt = d.querySelector('[type=submit]'); bt.disabled = true;
      try { await F.anularOtro(x.id, d.querySelector('#ea-mot').value); ES.otros = await F.leerOtros(); ES.vivo = {}; H.registrar('Finanzas: anuló otro ingreso o gasto', x.descripcion); ES.msg = `Anulado: ${x.descripcion}.`; d.close(); repintar(); }
      catch (e) { d.querySelector('#ea-err').textContent = ctx.error(e, H); bt.disabled = false; }
    });
  }));
  const ct = $('e-renta-cambiar');
  if (ct) ct.addEventListener('click', () => {
    const r = ES.renta || {};
    const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Tasa del impuesto a la renta</h2><p class="ayuda">El % que su contador le confirme para su régimen. Rige para los meses abiertos; los cerrados quedan como se cerraron.</p>
      <div class="fila-campos"><div class="campo"><label for="er-tasa">Tasa (%)</label><input id="er-tasa" inputmode="decimal" value="${H.esc(String(Number(r.tasa) || 0).replace('.', ','))}"></div>
      <div class="campo"><label for="er-nota">Nota (opcional)</label><input id="er-nota" maxlength="200" value="${H.esc(r.nota || '')}" placeholder="Ej: confirmada por el contador"></div></div>
      <p class="error" id="er-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="er-cancelar">Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
    d.querySelector('#er-cancelar').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const err = d.querySelector('#er-err'), v = d.querySelector('#er-tasa').value;
      try { F.validarTasa(v); } catch (e) { err.textContent = e.message; return; }
      const bt = d.querySelector('[type=submit]'); bt.disabled = true;
      try { ES.renta = await F.guardarRenta(v, d.querySelector('#er-nota').value); ES.vivo = {}; H.registrar('Finanzas: cambió la tasa del impuesto a la renta', `${ES.renta.tasa}%`); ES.msg = `Tasa del impuesto a la renta: ${String(ES.renta.tasa).replace('.', ',')}%.`; d.close(); repintar(); }
      catch (e) { err.textContent = ctx.error(e, H); bt.disabled = false; }
    });
  });
}
// ── Información (no está en el resultado) ──
function htmlProvision(H, e) {
  const P = e.provisionInfo; if (!P || !(P.provisionado || P.usado)) return '';
  return `<section class="tarjeta" aria-labelledby="t-e-prov"><div class="titulo-fila fin-titulo"><h2 id="t-e-prov">Provisión de los trabajadores ${H.info('Provisión de los trabajadores', 'Cada mes, cada área carga lo que después se paga junto: las vacaciones con su reemplazo (unos 21 días corridos al año) y, con contrato indefinido, la indemnización por años de servicio (un mes por año, tope 11).\nLa provisión no guarda plata: dice cuánto se debe. Para tenerla cuando llegue el momento, aparte cada mes "este mes" en una cuenta que no se toque.\nUn pago que sale de aquí (la liquidación de un reemplazo o un finiquito, marcado "usa la provisión" en la Bandeja) no es gasto del mes.\nLo que se debía antes de octubre va al balance de apertura. Es de gestión: el monto exacto de un finiquito lo calcula el contador.')}</h2></div>
    <div class="fin-einfo" id="e-prov"><div>
      <div class="fin-einfo-l"><span>Este mes: apartar</span><b>${pesos(P.mes)}</b></div>
      <div class="fin-einfo-l"><span>Pagado este mes con la provisión</span><b>${pesos(P.usadoMes)}</b></div></div>
      <div><div class="fin-einfo-l"><span>Acumulado desde ${H.esc(FE.mesTxt(mesDesde()))}</span><b>${pesos(P.provisionado)}</b></div>
      <div class="fin-einfo-l"><span>− Usado</span><b>${pesos(P.usado)}</b></div>
      <div class="fin-einfo-l fin-einfo-t"><span>Lo que debería estar apartado</span><b>${pesos(P.saldo)}</b></div></div></div></section>`;
}
function htmlInfo(H, e) {
  const I = e.info, l = (k, col, t, v, ayuda) => `<div class="fin-einfo-l"><span>${t}${ayuda ? ' ' + H.info(t, ayuda) : ''}</span>${v ? `<button type="button" class="fin-ecel" data-e-det="${k}" data-e-col="${col}">${pesos(v)}</button>` : `<span>${pesos(v)}</span>`}</div>`;
  return `<section class="tarjeta" aria-labelledby="t-e-info"><div class="titulo-fila fin-titulo"><h2 id="t-e-info">Fuera del resultado ${H.info('Fuera del resultado', 'Lo que salió o se compró en el mes pero no es una línea del estado de resultados. Va al flujo de caja o a la desviación de materias primas. Se muestra para que todo cuadre con Gastos.')}</h2></div>
    <div class="fin-einfo" id="e-info">
      <div><h3>Compras del mes</h3>${l('compras', 'mp', 'Materias primas e insumos', I.compras.mp, 'Su costo ya está en el costo directo de cada producto. Las compras se usan para la desviación (compras − consumo teórico ± conteo).')}${l('compras', 'reventa', 'Productos de reventa', I.compras.reventa)}
        <div class="fin-einfo-l fin-einfo-t"><span>Total compras</span><b>${pesos(I.compras.total)}</b></div>
        ${l('enMargen', 'total', 'Ya en el margen (comisión Transbank, despacho)', I.enMargen, 'Gastos clasificados como "Ya incluido en el margen": su costo ya se resta como costo de venta (Márgenes → Ajustes). No se cuentan dos veces.')}</div>
      <div><h3>Fuera del resultado</h3>${l('fuera', 'capital', 'Capital de créditos', I.fuera.capital, `Cuotas de crédito del mes (${pesos(I.fuera.cuotas)}) menos su interés según la tabla de cada crédito (${pesos(I.interes)}, que va a financieros).`)}
        ${l('fuera', 'impuestos', 'Impuestos (F29, IVA, PPM)', I.fuera.impuestos)}${I.fuera.provision ? l('fuera', 'provision', 'Pagado con la provisión de los trabajadores', I.fuera.provision, 'La liquidación de un reemplazo de vacaciones o un finiquito: ya se cargó mes a mes en la provisión. No es gasto otra vez.') : ''}${I.fuera.deuda ? l('fuera', 'deuda', 'Deuda con el fisco (convenio TGR)', I.fuera.deuda, 'La cuota de un convenio de pago con la TGR baja una deuda: no es gasto del mes. Sus intereses y multas sí son gasto financiero.') : ''}${l('fuera', 'inversion', 'Inversiones (entran como depreciación)', I.fuera.inversion)}${l('fuera', 'retiro', 'Retiros', I.fuera.retiro)}${l('fuera', 'otro', 'Otros fuera del resultado', I.fuera.otro)}
        <div class="fin-einfo-l fin-einfo-t"><span>Total fuera del resultado</span><b>${pesos(I.fuera.total)}</b></div>
        ${l('pagosTarjeta', 'total', `Pagos de tarjeta de crédito (cartola · ${nf(I.pagosTarjeta.n)})`, I.pagosTarjeta.monto, 'Cargos de la cartola marcados "Pago de tarjeta". No son gasto: las compras con tarjeta ya entraron como gasto el día de la compra (por el SII). Solo mueven plata: van al flujo de caja. No son parte de Gastos, por eso no entran en la cuadratura.')}</div>
    </div></section>`;
}
// ── Cuadratura con Gastos ──
function htmlCuadratura(H, e) {
  const C = e.cuadratura, I = e.info;
  const l = (t, v, k) => `<div class="fin-einfo-l"><span>${t}</span><b${k ? ` id="${k}"` : ''}>${pesos(v)}</b></div>`;
  return `<section class="tarjeta" aria-labelledby="t-e-cuad"><div class="titulo-fila fin-titulo"><h2 id="t-e-cuad">${ic('balanza', 20)} Cuadratura con Gastos ${H.info('Cuadratura', 'El total de gastos del mes en Gastos (neto, sumado directo de los gastos vigentes) tiene que ser igual a la suma de dónde quedó cada peso: en el resultado (remuneraciones, fijos y financieros), el interés que va dentro de las cuotas, las compras, lo que ya está en el margen, lo que queda fuera del resultado y lo sin clasificar.\nSi algo no cuadra, aparece la diferencia. Lo sin clasificar se arregla en Clasificación.')}</h2>
      <span class="chip ${C.cuadra ? 'c-verde' : C.diferencia ? 'c-rojo' : 'c-amarillo'}" id="e-cuadra">${C.diferencia ? `No cuadra: ${pesos(C.diferencia)}` : C.cuadra ? 'Cuadra' : 'Cuadra, con gastos sin clasificar'}</span></div>
    <div class="fin-ecuad" id="e-cuad">
      ${l('Total de gastos del mes en Gastos', C.totalGastos, 'e-cuad-total')}
      ${l('= En el resultado (remuneraciones, fijos, costos de venta, financieros)', C.enResultado)}${l('+ Interés dentro de las cuotas de crédito', C.interesCuotas)}${l('+ Compras de MP y reventa', C.compras)}${l('+ Ya en el margen', C.enMargen)}${l('+ Fuera del resultado', C.fuera)}${l('+ Sin clasificar', C.sinClasificar)}
      <div class="fin-einfo-l fin-einfo-t"><span>Diferencia</span><b id="e-cuad-dif">${pesos(C.diferencia)}</b></div></div>
    ${I.sinClasificar.n ? `<div class="fin-esin" id="e-sin"><p class="aviso">${nf(I.sinClasificar.n)} ${I.sinClasificar.n === 1 ? 'ítem sin clasificar' : 'ítems sin clasificar'} (${pesos(I.sinClasificar.neto)}): no entran al resultado.</p>
      <ul>${I.sinClasificarLista.map(x => `<li><span>${H.esc(x.item)} · ${nf(x.n)} ${x.n === 1 ? 'línea' : 'líneas'}</span><b>${pesos(x.neto)}</b></li>`).join('')}</ul>
      ${e.conCatalogo ? `<a class="btn-sec" href="#gastos/catalogo">${ic('ir', 16)} Ir a Gastos → Ítems</a>` : `<a class="btn-sec" href="#finanzas/resultados/clasificacion">${ic('ir', 16)} Ir a Clasificación</a>`}</div>` : ''}
  </section>`;
}
// ── Vista secundaria: comunes repartidos por causa ──
function htmlRepartido(H, e, R) {
  const rp = FE.repartirComunes(e, ES.claves || {});
  const A = FE.AREAS_REPARTO;   // v0.69.1: Reventa no recibe comunes (su margen va en Común en esta vista)
  const filaR = (t, vals, tot, cls = '') => `<tr class="${cls}"><th scope="row">${t}</th>${A.map(a => `<td class="fin-enum">${vals[a] === null ? '' : pesos(vals[a])}</td>`).join('')}<td class="fin-enum">${vals.comun === null ? '' : pesos(vals.comun)}</td><td class="fin-enum">${pesos(tot)}</td></tr>`;
  const neg = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? null : -v]));
  const ma = { ...Object.fromEntries(A.map(a => [a, e.filas.ma[a]])), comun: e.filas.ma.comun + (rp.reventa || 0) };
  const rep = { ...Object.fromEntries(A.map(a => [a, rp.porArea[a].total])), comun: rp.sinRepartir.total };
  const res = { ...rp.resultadoArea, comun: rp.comunResto };
  const asignTxt = l => (l.partes ? `${l.porItem ? 'clave del ítem' : 'clave del tipo'}: ${FE.BASES.find(b => b.k === l.base).t}` : 'sin clave: queda sin repartir');
  return `<p class="aviso fin-esec">Vista secundaria, solo para conversar: reparte los comunes por causa (m², maquinaria, horas o % a mano). El resultado de cada área en la vista principal es su margen del área, con los comunes sin repartir.</p>
    <div class="tabla-b2b fin-etabla"><table class="tabla-tiempos fin-eerr" id="e-rep"><thead><tr><th scope="col">Concepto</th>${A.map(a => `<th scope="col" class="fin-enum">${FE.NOMBRE_COL[a]}</th>`).join('')}<th scope="col" class="fin-enum">Común</th><th scope="col" class="fin-enum">Total</th></tr></thead><tbody>
      ${filaR('Margen del área', ma, e.filas.ma.total)}
      ${filaR('− Comunes repartidos', neg(rep), -(rp.sinRepartir.total + A.reduce((x, a) => x + rp.porArea[a].total, 0)))}
      ${filaR('= Resultado con comunes repartidos', res, rp.total, 'fin-eres')}
      ${filaR('− Financieros', { PAN: null, BOL: null, PAS: null, CAF: null, comun: -e.filas.financieros.total }, -e.filas.financieros.total)}
      ${filaR('= Resultado del mes', { PAN: null, BOL: null, PAS: null, CAF: null, comun: null }, rp.total - e.filas.financieros.total, 'fin-eres')}</tbody></table></div>
    <p class="nota-i" id="e-rep-nota">(i) El total es el mismo que en la vista principal: resultado operacional ${pesos(e.filas.resOp.total)}. Común = margen de ventas sin asociar${rp.reventa ? ` y de Reventa (${pesos(rp.reventa)}: Reventa no recibe comunes)` : ''}${rp.canalB2B ? ` + resultado del canal B2B (${pesos(rp.canalB2B)})` : ''} − lo que quedó sin clave.</p>
    ${rp.lineas.length ? `<details class="fin-sindet" id="e-rep-det"><summary>Cómo se repartió cada común (${nf(rp.lineas.length)})</summary><ul class="fin-hist-lista">${rp.lineas.map(l => `<li><div><b>${H.esc(l.item)}</b> · ${pesos(l.neto)}</div><span class="ayuda">${H.esc(asignTxt(l))}${l.partes ? ' · ' + A.filter(a => l.partes[a]).map(a => `${FE.NOMBRE_COL[a]} ${pesos(l.partes[a])}`).join(' · ') : ''}</span></li>`).join('')}</ul></details>` : ''}
    ${htmlClaves(H, e)}`;
}
function htmlClaves(H, e) {
  const C = ES.claves || {}, B = C.bases || {}, A = FE.AREAS_REPARTO;
  const val = (b, a) => { const v = (B[b] || {})[a]; return v === undefined || v === null || v === 0 ? '' : H.esc(String(v)); };
  const selAsig = (id, asig, conTipo) => `<select id="${id}" data-e-asig="${id}">${conTipo ? `<option value="">Como su tipo</option>` : '<option value="">Sin repartir</option>'}${FE.BASES.map(b => `<option value="${b.k}" ${asig && asig.base === b.k ? 'selected' : ''}>${H.esc(b.t)}</option>`).join('')}</select>`;
  const manual = (id, asig) => `<div class="fin-epcts ${asig && asig.base === 'manual' ? '' : 'oculto'}" data-e-man="${id}">${A.map(a => `<label><span>${FE.NOMBRE_COL[a]} %</span><input type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" max="100" step="any" data-e-pct="${id}" data-area="${a}" value="${asig && asig.base === 'manual' && asig.pct ? H.esc(String(asig.pct[a] ?? '')) : ''}"></label>`).join('')}</div>`;
  const items = [];
  ['remComun', ...FE.FILAS_COMUNES_FIJOS, 'depComun'].forEach(k => { const vistos = new Set(); ((e.detalle || {})[k + '.comun'] || []).forEach(r => { const c = r.clave || FR.claveItem(r.item || r.nombre); if (c && !vistos.has(c)) { vistos.add(c); items.push({ clave: c, item: r.item || r.nombre || c }); } }); });
  return `<details class="tarjeta plegable fin-eclaves" id="e-claves" ${ES.abiertas.claves ? 'open' : ''}><summary class="titulo-fila"><h3>Claves de reparto ${H.info('Claves de reparto', 'Con qué se reparte cada común entre las áreas, solo para la vista secundaria:\n· Metros cuadrados: arriendo, aseo, seguros del local.\n· Maquinaria (kWh): luz, gas, mantención de equipos.\n· Horas de trabajo: remuneraciones comunes, administración.\n· % a mano: lo que quieras (tiene que sumar 100).\nCada tipo de común tiene su clave; un ítem puede tener una propia que manda sobre la del tipo. Sin clave, queda sin repartir.')}</h3></summary>
    <form id="e-claves-f" novalidate>
      <h4>Bases por área</h4>
      <div class="tabla-b2b"><table class="tabla-tiempos fin-ebases"><thead><tr><th scope="col">Base</th>${A.map(a => `<th scope="col">${FE.NOMBRE_COL[a]}</th>`).join('')}</tr></thead><tbody>
        ${FE.BASES.filter(b => b.k !== 'manual').map(b => `<tr><th scope="row">${H.esc(b.t)}</th>${A.map(a => `<td><label class="sr" for="e-b-${b.k}-${a}">${H.esc(b.t)} ${FE.NOMBRE_COL[a]}</label><input id="e-b-${b.k}-${a}" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" data-e-base="${b.k}" data-area="${a}" value="${val(b.k, a)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <h4>Clave de cada tipo de común</h4>
      ${FE.TIPOS_COMUNES.map(t => `<div class="fin-easig"><label for="e-t-${t.k}">${H.esc(t.t)}</label>${selAsig('e-t-' + t.k, (C.porTipo || {})[t.k], false)}${manual('e-t-' + t.k, (C.porTipo || {})[t.k])}</div>`).join('')}
      ${items.length ? `<h4>Clave propia de un ítem (opcional)</h4>${items.map(x => `<div class="fin-easig"><label for="e-i-${H.esc(x.clave)}">${H.esc(x.item)}</label>${selAsig('e-i-' + x.clave, (C.porItem || {})[x.clave], true)}${manual('e-i-' + x.clave, (C.porItem || {})[x.clave])}</div>`).join('')}` : ''}
      <p class="error" id="e-claves-err" role="alert"></p>
      <div class="botones"><button type="submit" class="btn" id="e-claves-g">Guardar claves</button></div></form></details>`;
}

// ── Detalle de una cifra ──
const NOMBRE_DET = { compras: 'Compras', enMargen: 'Ya en el margen', fuera: 'Fuera del resultado', pagosTarjeta: 'Pagos de tarjeta de crédito', sinClasificar: 'Sin clasificar' };   // las filas (packaging, tiendas…) usan su texto de FE.FILA
function refsDe(e, k, col) {
  const D = e.detalle || {};
  if (col === 'total' && !D[k + '.total']) return FE.COLS.flatMap(c => D[k + '.' + c] || []);
  return D[k + '.' + col] || [];
}
// Una línea del detalle (venta, gasto, cargo, merma…); valor: el monto que va en esa cifra (v0.111.0: el de la cuenta)
function lineaRef(H, r, k, valor = null) {
  if (r.tipo === 'venta') { const v = valor !== null ? valor : k === 'costoDirecto' ? r.costo : k === 'costosVenta' ? r.costoVenta : r.neto; return `<li><div><b>${H.esc(r.nombre)}</b> · ${H.esc(FE.NOMBRE_SUC[r.suc] || r.suc)}</div><span class="ayuda">${nf(r.unidades)} un · venta ${pesos(r.neto)} · costo ${pesos(r.costo)} · costos de venta ${pesos(r.costoVenta)}${r.ok ? '' : ` · ${H.esc(r.motivo || 'sin costo')}`}</span><b class="fin-edval">${pesos(v)}</b></li>`; }
  if (r.tipo === 'gasto') return `<li><div><b>${H.esc(r.item)}</b>${r.itemOriginal ? ` <small>(guardado como ${H.esc(r.itemOriginal)})</small>` : ''} · ${fechaTxt(r.fecha)} · ${H.esc(r.area)}</div><span class="ayuda">${H.esc([r.proveedor, r.obs].filter(Boolean).join(' · ') || '—')} · ${H.esc(FR.textoLinea(r.tipoRes, r.cuenta))}</span><span class="fin-edacc"><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b><button type="button" class="fin-mlink" data-e-ver="${H.esc(r.item)}" data-e-vermes="${H.esc(String(r.fecha).slice(0, 7))}">Ver en Gastos</button></span></li>`;
  if (r.tipo === 'cargo') return `<li><div><b>${H.esc(r.nombre)}</b> · ${H.esc(FE.NOMBRE_SUC[r.suc] || r.suc)}${r.catalogoId ? ` · ${H.esc(r.catalogoId)}` : ''}</div><span class="ayuda">${nf(r.unidades)} cobrados · cargo del Catálogo (no es venta de un producto)</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'merma') return `<li><div><b>${H.esc(r.nombre)}</b>${r.origen === 'tienda' ? ` · ${H.esc(FE.NOMBRE_SUC[r.suc] || r.suc)}` : ''}</div><span class="ayuda">${r.cantidad ? `${nf(r.cantidad)} ${H.esc(r.unidad || '')} · ` : ''}${r.origen === 'tienda' ? 'merma de la tienda (registrada en la caja), al costo de su receta, neto' : 'merma de Producción, neto'}</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  // v0.123.0 · 6.7.1 Diferencias de caja (faltante +, sobrante −)
  if (r.tipo === 'difCaja') return `<li><div><b>${H.esc(r.nombre)}</b> · ${fechaTxt(r.fecha)}</div><span class="ayuda">6.7.1 Diferencias de caja · de los cierres de caja y Efectivo (faltante suma, sobrante resta)</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'credito') return `<li><div><b>${H.esc(r.nombre)}</b></div><span class="ayuda">Interés de ${nf(r.cuotas)} ${r.cuotas === 1 ? 'cuota pagada' : 'cuotas pagadas'} en el mes (capital ${pesos(r.capital)}, fuera del resultado) · tabla del crédito</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'provision') return `<li><div><b>${H.esc(r.nombre)}</b> · ${H.esc(r.area)}</div><span class="ayuda">Remuneración ${pesos(r.base)} · vacaciones ${pesos(r.vac)}${r.ias ? ` · años de servicio ${pesos(r.ias)}` : r.sinFicha ? ' · sin datos de contrato: falta la indemnización' : ''}</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'depreciacion') return `<li><div><b>${H.esc(r.item)}</b> · compra del ${fechaTxt(r.fecha)}</div><span class="ayuda">${pesos(r.valor)} ÷ ${nf(r.meses)} meses${r.area ? ' · ' + H.esc(r.area) : ''}</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'regalado') return `<li><div><b>${H.esc(r.nombre)}</b></div><span class="ayuda">${r.cantidad ? `${nf(r.cantidad)} ${H.esc(r.unidad || '')} · ` : ''}regalo o consumo interno (anotado en Cocina), neto</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'incobrable') return `<li><div><b>${H.esc(r.nombre)}</b> · ${fechaTxt(r.fecha)}</div><span class="ayuda">Dada por perdida${r.motivo ? ': ' + H.esc(r.motivo) : ''} · saldo con IVA</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'otro') return `<li><div><b>${H.esc(r.nombre)}</b> · ${fechaTxt(r.fecha)}</div><span class="ayuda">Anotado en Finanzas (no es del giro)</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'impuesto') return `<li><div><b>${H.esc(r.nombre)}</b></div><span class="ayuda">Estimación de gestión: el real sale del F22</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  if (r.tipo === 'cartola') return `<li><div><b>${H.esc(r.nombre)}</b> · ${fechaTxt(r.fecha)}</div><span class="ayuda">Cargo de la cartola marcado "Pago de tarjeta"</span><b class="fin-edval">${pesos(valor !== null ? valor : r.neto)}</b></li>`;
  return '';
}
function dialogoDetalle(H, e, k, col) {
  const refs = refsDe(e, k, col);
  const f = FE.FILA[k], tit = f ? f.t : k.startsWith('ventasCanal_') ? `Ventas netas · ${FE.NOMBRE_SUC[k.slice(12)]}` : (NOMBRE_DET[k] || k);
  const colTxt = FE.NOMBRE_COL[col] || ({ mp: 'materias primas', reventa: 'reventa', capital: 'capital de créditos', impuestos: 'impuestos', deuda: 'deuda con el fisco', provision: 'pagado con la provisión', inversion: 'inversiones', retiro: 'retiros', otro: 'otros' }[col] || col);
  const tot = refs.reduce((a, r) => a + (r.tipo !== 'venta' ? r.neto : k.startsWith('costoDirecto') ? r.costo : k === 'costosVenta' ? r.costoVenta : r.neto), 0);   // v0.102.0: costos de venta también desde Gastos
  const linea = r => lineaRef(H, r, k);
  const d = H.dialogo(`<div class="form-dialogo fin-edet"><h2>${H.esc(tit)}</h2><p class="fin-actual">${H.esc(colTxt)} · ${H.esc(FE.mesTxt(ES.mes))} · <b>${pesos(tot)}</b>${refs.length ? ` · ${nf(refs.length)} ${refs.length === 1 ? 'línea' : 'líneas'}` : ''}</p>
    ${refs.length ? `<ul class="fin-hist-lista fin-edlista" id="e-det-lista">${refs.slice(0, 300).map(linea).join('')}</ul>${refs.length > 300 ? `<p class="ayuda">Y ${nf(refs.length - 300)} más.</p>` : ''}` : '<p class="ayuda">Sin detalle.</p>'}
    <div class="botones"><button type="button" class="btn" id="e-det-ok">Cerrar</button></div></div>`);
  d.querySelector('#e-det-ok').addEventListener('click', () => d.close());
  d.querySelectorAll('[data-e-ver]').forEach(b => b.addEventListener('click', () => { d.close(); if (H.verGastos) H.verGastos(b.dataset.eVermes, b.dataset.eVer); }));
}
function dialogoAjustes(H, e) {
  const A = e.ajustes || { porMes: {} };
  const d = H.dialogo(`<div class="form-dialogo fin-edet"><h2>Ajustes de meses cerrados</h2><p class="ayuda">Cambios hechos después de cerrar un mes (un gasto corregido, una factura que llegó tarde…). El mes cerrado no se toca: la diferencia entra aquí. ${pesos(A.total)} en el resultado.</p>
    <ul class="fin-hist-lista" id="e-aj-lista">${Object.entries(A.porMes).map(([m, a]) => `<li><div><b>${H.esc(FE.mesTxt(m))}</b> · resultado ${a.resultado > 0 ? '+' : ''}${pesos(a.resultado)}</div>
      <span class="ayuda">${Object.entries(a.porFila).filter(([k]) => FE.FILA[k]).map(([k, v]) => `${H.esc(FE.FILA[k].t)} ${v > 0 ? '+' : ''}${pesos(v)}`).join(' · ')}</span>
      ${a.porCuenta ? `<span class="ayuda">${Object.entries(a.porCuenta).map(([k, v]) => { const [f, c] = k.split('|'); return `${H.esc((FS.FILA[f] || {}).t || f)} · ${H.esc(c)} ${H.esc(FS.nombreCuenta(c))} ${v > 0 ? '+' : ''}${pesos(v)}`; }).join(' · ')}</span>` : ''}
      ${(a.gastos || []).map(g => `<span class="ayuda">${H.esc(g.item)} (${fechaTxt(g.fecha)}): ${g.cambio === 'nuevo' ? 'nuevo' : g.cambio === 'quitado' ? 'quitado o anulado' : 'cambió'} · antes ${pesos(g.antes)}, ahora ${pesos(g.ahora)}</span>`).join('')}</li>`).join('')}</ul>
    <div class="botones"><button type="button" class="btn" id="e-aj-ok">Cerrar</button></div></div>`);
  d.querySelector('#e-aj-ok').addEventListener('click', () => d.close());
}
function conectarEERR(el, H, ctx, R, e, S) {
  const repintar = () => pintarEERR(el, H, ctx, R);
  // v0.111.0 · Ver por, nivel de detalle, abrir una fila y el detalle de un ítem
  const redibujar = () => { el.innerHTML = R.cabecera() + htmlEstado(H, e, S, R); conectarEERR(el, H, ctx, R, e, S); };
  el.querySelectorAll('[data-e-verpor]').forEach(b => b.addEventListener('click', () => { if (ES.verPor === b.dataset.eVerpor) return; ES.verPor = b.dataset.eVerpor; guardarPref(); repintar(); }));
  el.querySelectorAll('[data-e-nivel]').forEach(b => b.addEventListener('click', () => { ES.nivel = Number(b.dataset.eNivel); ES.abiertosE.clear(); ES.cerradosE.clear(); guardarPref(); redibujar(); }));
  el.querySelectorAll('[data-e-tog]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.eTog, d = Number(b.dataset.eProf), ab = b.getAttribute('aria-expanded') === 'true';
    if (ab) { ES.abiertosE.delete(k); if (ES.nivel > d) ES.cerradosE.add(k); } else { ES.cerradosE.delete(k); if (ES.nivel <= d) ES.abiertosE.add(k); }
    redibujar(); const x = el.querySelector(`[data-e-tog="${CSS.escape(k)}"]`); if (x) x.focus(); }));
  el.querySelectorAll('[data-e-item]').forEach(b => b.addEventListener('click', () => { const [f, c, ...it] = b.dataset.eItem.split('|'); dialogoItem(H, e, f, c, it.join('|')); }));
  const sel = $('e-mes'); if (sel) sel.addEventListener('change', () => { ES.mes = sel.value; ES.msg = ''; ES.err = ''; repintar(); });
  // v0.112.0 · El período (Desde – Hasta) y la vista de comunes repartidos (Por área, un mes)
  ['e-desde', 'e-hasta'].forEach(id => { const x = $(id); if (x) x.addEventListener('change', () => { const p = { desde: $('e-desde').value, hasta: $('e-hasta').value }; if (ES.verPor === 'meses') ES.perMeses = p; else ES.perSeg = p; repintar(); }); });
  el.querySelectorAll('[data-e-vista]').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; ES.vista = b.dataset.eVista; redibujar(); }));
  el.querySelectorAll('[data-e-det]').forEach(b => b.addEventListener('click', () => (b.dataset.eDet === 'ajustes' ? dialogoAjustes(H, e) : dialogoDetalle(H, e, b.dataset.eDet, b.dataset.eCol))));
  conectarOtros(el, H, ctx, repintar);
  conectarTributario(el, H, ctx, R, repintar);
  const rl = $('e-releer');
  if (rl) rl.addEventListener('click', async () => {
    rl.disabled = true; olvidar();
    // v0.112.0: en Meses, Temporadas, Por área y Por canal, los meses abiertos del período (los cerrados salen de su foto)
    try { await R.releer(); for (const m of (ES.verPor === 'total' ? [ES.mes] : mesesSerie().filter(m => !cerrado(m)))) { delete ES.vivo[m]; await F.datosMes(m, { forzar: true }); } ES.msg = 'Gastos, ventas y merma leídos de nuevo.'; } catch (x) { ES.err = ctx.error(x, H); }
    repintar();
  });
  // Claves de reparto
  const cl = $('e-claves'); if (cl) cl.addEventListener('toggle', () => { ES.abiertas.claves = cl.open; });
  el.querySelectorAll('[data-e-asig]').forEach(s => s.addEventListener('change', () => { const m = el.querySelector(`[data-e-man="${CSS.escape(s.id)}"]`); if (m) m.classList.toggle('oculto', s.value !== 'manual'); }));
  const f = $('e-claves-f');
  if (f) f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('e-claves-err'), b = $('e-claves-g'); err.textContent = '';
    const bases = {}; el.querySelectorAll('[data-e-base]').forEach(i => { (bases[i.dataset.eBase] = bases[i.dataset.eBase] || {})[i.dataset.area] = FC.casilla(i); });
    const asig = id => { const s = $(id); if (!s || !s.value) return null; if (s.value !== 'manual') return { base: s.value }; const pct = {}; el.querySelectorAll(`[data-e-pct="${CSS.escape(id)}"]`).forEach(i => { pct[i.dataset.area] = FC.casilla(i); }); return { base: 'manual', pct }; };
    const porTipo = {}; FE.TIPOS_COMUNES.forEach(t => { const a = asig('e-t-' + t.k); if (a) porTipo[t.k] = a; });
    const porItem = { ...((ES.claves || {}).porItem || {}) };
    el.querySelectorAll('[data-e-asig^="e-i-"]').forEach(s => { const k = s.id.slice(4); const a = asig(s.id); if (a) porItem[k] = a; else delete porItem[k]; });
    try { FE.validarClaves({ bases, porTipo, porItem }); } catch (x) { err.textContent = x.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try { ES.claves = await F.guardarClaves({ bases, porTipo, porItem }); H.registrar('Finanzas: guardó las claves de reparto', Object.keys(porTipo).join(', ') || 'sin claves'); ES.msg = 'Claves de reparto guardadas.'; ES.err = ''; }
    catch (x) { err.textContent = ctx.error(x, H); b.disabled = false; b.textContent = 'Guardar claves'; return; }
    redibujar();
  });
}

// ═══════════════ Cierre de mes ═══════════════
const TXT_CIERRE = 'Lo acordado (Cómo trabajamos): el mes se cierra después de pagar y cargar su Previred, a más tardar el día 13 del mes siguiente. Orden recomendado: (1) pagar Previred, ojalá antes del día 10; (2) subir el comprobante o el CSV en Gastos → Previred; (3) revisar que esté todo y cerrar el mes.\nAl cerrarlo queda congelado: el estado de resultados de ese mes se guarda tal cual (ventas, costos usados, gastos, créditos, quién y cuándo) y no cambia más.\nLo que aparezca después (una factura atrasada, un gasto corregido) no cambia el mes cerrado: entra como "Ajustes de meses cerrados" en el primer mes abierto siguiente.\nSi una revisión no se cumple, se puede cerrar igual marcando "Cerrar igual" y escribiendo el motivo (queda guardado).';
async function datosCierre(R, mes) {
  // v0.69.5 · Previred del mes (planillas): de la memoria de la sesión, sin lecturas nuevas (lo que falte se lee)
  // v0.101.0 · Desde el inicio (octubre) las revisiones de Gastos salen del Gastos nuevo (gn-finanzas.js); lo demás (ventas, conteos,
  // asociar, clasificar) es igual.
  const D = R.datos;
  if (F.delGastosNuevo(mes) && D.gn && D.gn.error) throw new Error(`No se pudo leer el Gastos nuevo: ${D.gn.error}`);
  if (F.delGastosNuevo(mes) && D.gn) {
    const GF = await import('./gn-finanzas.js?v=0.138.0');
    const [e, dm, conteos] = await Promise.all([vivo(R, mes), F.datosMes(mes), ES.conteos[mes] ? Promise.resolve(ES.conteos[mes]) : F.conteosMes(mes)]);
    ES.conteos[mes] = conteos;
    const G = D.gn.D, pv = GF.previredDelMes(G, mes), I = pv ? (await import('./gn-bandeja.js?v=0.138.0')).indicePagos(G.pagos || []) : null;
    const pagado = pv ? (I.porDoc[pv.id] || []).reduce((a, p) => a + (Number(p.monto) || 0), 0) : 0;
    const gn = { sii: GF.siiDelMes(G.cargas, mes), movs: GF.movsSinRevisarDelMes(G, mes), aCuenta: GF.aCuentaDelMes(G, mes), sinClas: GF.sinClasificarDelMes(G, mes),
      previred: pv ? { total: Number(pv.total) || 0, pagado, completo: pagado >= (Number(pv.total) || 0) - GF.TOL } : null, fletes: GF.fletesPorUnir(G, mes) };
    const checks = FE.checksCierre({ mes, gn, ventas: dm.ventasInfo, conteos, sinClasificar: e.info.sinClasificar, catalogo: conCatalogo(R) });
    return { e, checks };
  }
  const [e, dm, conteos, sii, planillas] = await Promise.all([vivo(R, mes), F.datosMes(mes), ES.conteos[mes] ? Promise.resolve(ES.conteos[mes]) : F.conteosMes(mes), ES.sii ? Promise.resolve(ES.sii) : F.cargasSii(), F.planillasPrevired()]);
  ES.conteos[mes] = conteos; ES.sii = sii;
  const checks = FE.checksCierre({ mes, cargasSii: sii, ventas: dm.ventasInfo, cargosPorRevisar: FE.cargosPorRevisarDelMes(ES.cartola.porRevisar, mes), conteos, sinClasificar: e.info.sinClasificar,
    ...(ES.siiPend ? { siiPendientes: SP.pendientesDelMes(ES.siiPend, mes) } : {}), planillas });
  return { e, checks };
}
export async function pintarCierre(el, H, ctx, R) {
  ES.mes = mesValido(ES.mes);
  const tope = cuerpo => R.cabecera() + cuerpo;
  el.innerHTML = tope(`<section class="tarjeta"><div class="vacio" style="border:0" role="status">Revisando ${H.esc(FE.mesTxt(ES.mes))}…</div></section>`);
  let x = null, hist = [];
  try {
    await base();
    if (!cerrado(ES.mes) && ES.mes < mesHoy()) x = await datosCierre(R, ES.mes);
    hist = await F.historialCierres(ES.mes).catch(() => []);
  } catch (er) { el.innerHTML = tope(`<section class="tarjeta"><p class="error" role="alert">${H.esc(ctx.error(er, H))}</p></section>`); return; }
  if (!/^#finanzas\/resultados\/cierre/.test(location.hash)) return;
  el.innerHTML = tope(htmlCierre(H, x, hist));
  conectarCierre(el, H, ctx, R, x);
}
function filaCheck(H, c) {
  return `<li class="fin-ccheck fin-c-${c.nivel}" data-e-check="${c.k}"><span class="fin-cic" aria-hidden="true">${ic(c.nivel === 'ok' ? 'check' : c.nivel === 'aviso' ? 'aviso' : 'x', 18)}</span>
    <div><span class="fin-ctit"><b>${H.esc(c.t)}</b>${c.info ? H.info(c.t, c.info) : ''}</span><span class="ayuda">${H.esc(c.detalle)}</span></div>
    <span class="fin-cest"><span class="chip chip-chico ${c.nivel === 'ok' ? 'c-verde' : c.nivel === 'aviso' ? 'c-amarillo' : 'c-rojo'}">${c.nivel === 'ok' ? 'Listo' : c.nivel === 'aviso' ? 'Aviso' : 'Falta'}</span>${c.nivel !== 'ok' && c.ir ? `<a class="btn-sec btn-chico" href="${c.ir}">${ic('ir', 14)} Revisar</a>` : ''}</span></li>`;
}
function htmlCierre(H, x, hist) {
  const c = ES.cierres[ES.mes], cerr = cerrado(ES.mes);
  let cuerpo;
  if (cerr) {
    cuerpo = `<div class="fin-econg" id="c-estado">${ic('candado', 18)}<span><b>${H.esc(FE.mesTxt(ES.mes))} está cerrado</b> desde el ${fechaTxt(c.cerradoEn)} por ${H.esc(c.cerradoPor || '—')}. Resultado del mes: <b>${pesos(c.filas.resultado.total)}</b>.${c.override ? ` Se cerró con revisiones pendientes (${H.esc(c.override.fallas.join(', '))}): ${H.esc(c.override.motivo)}.` : ''}</span></div>
      <ul class="fin-cchecks" id="c-checks">${(c.checks || []).map(k => filaCheck(H, k)).join('')}</ul>
      <div class="botones fin-cbot"><a class="btn-sec" href="#finanzas/resultados">Ver el estado de resultados</a><button type="button" class="btn-sec btn-peligro" id="c-reabrir">${ic('abierto', 16)} Reabrir</button></div>
      <p class="nota-i">(i) Reabrir se puede, pero no se recomienda: el mes deja de estar congelado y sus números pueden cambiar respecto de lo que ya informaste. Para corregir algo de un mes cerrado no hace falta reabrir: el cambio aparece solo como ajuste en el mes siguiente.</p>`;
  } else if (ES.mes >= mesHoy()) {
    cuerpo = `<p class="aviso" id="c-estado">${H.esc(FE.mesTxt(ES.mes))} está en curso. Se cierra después de pagar y cargar su Previred, a más tardar el 13 de ${H.esc(FE.MESES_L[Number(FE.mesMas(ES.mes, 1).slice(5, 7)) - 1])}.</p>`;
  } else {
    const fs = FE.fallas(x.checks);
    cuerpo = `${c && c.estado === 'reabierto' ? `<p class="aviso" id="c-reab">Se reabrió el ${fechaTxt(c.reabiertoEn)} por ${H.esc(c.reabiertoPor || '—')}: ${H.esc(c.motivoReabrir || '')}</p>` : ''}
      <ul class="fin-cchecks" id="c-checks">${x.checks.map(k => filaCheck(H, k)).join('')}</ul>
      <div class="fin-cres"><span>Resultado del mes (hoy): <b id="c-resultado">${pesos(x.e.filas.resultado.total)}</b></span><a class="btn-sec btn-chico" href="#finanzas/resultados">Ver el estado de resultados</a></div>
      ${fs.length ? `<div class="fin-cover" id="c-over"><label class="check"><input type="checkbox" id="c-igual"> Cerrar igual, con ${fs.length === 1 ? 'una revisión pendiente' : `${fs.length} revisiones pendientes`}</label>
        <div class="campo"><label for="c-motivo">Motivo (obligatorio para cerrar igual)</label><textarea id="c-motivo" rows="2" maxlength="300" placeholder="Por ejemplo: la factura de luz llega tarde; entra como ajuste"></textarea></div></div>` : ''}
      <p class="error" id="c-err" role="alert">${H.esc(ES.err)}</p>
      <div class="botones fin-cbot"><button type="button" class="btn" id="c-cerrar">${ic('candado', 16)} Cerrar ${H.esc(FE.mesTxt(ES.mes))}</button></div>`;
  }
  return `<section class="tarjeta" aria-labelledby="t-c-cierre">
    <div class="titulo-fila fin-titulo"><h2 id="t-c-cierre">Cierre de mes ${H.info('Cierre de mes', TXT_CIERRE)}</h2>${F.gnActivo() ? '' : '<a class="btn-link" href="#finanzas/resumen" id="c-ir-resumen">Ver el Resumen del mes</a>'}</div>
    <div class="fin-ecab">${selectorMes(H, 'c-mes')}</div>
    <p class="ok-texto" id="c-msg" role="status">${H.esc(ES.msg)}</p>
    ${cuerpo}
    ${hist.length ? `<details class="fin-sindet" id="c-hist"><summary>${ic('hist', 16)} Historial del cierre (${nf(hist.length)})</summary><ul class="fin-hist-lista">${hist.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${h.accion === 'cerrado' ? 'Cerrado' : 'Reabierto'}${h.resultado !== null && h.resultado !== undefined ? ` · resultado ${pesos(h.resultado)}` : ''}</div><span class="ayuda">${H.esc(h.por || '')}${h.motivo ? ' · ' + H.esc(h.motivo) : ''}</span></li>`).join('')}</ul></details>` : ''}
  </section>${F.gnActivo() ? '<section class="tarjeta" id="ic-sec" aria-labelledby="t-ic"></section>' : ''}`;
}
function conectarCierre(el, H, ctx, R, x) {
  const repintar = () => pintarCierre(el, H, ctx, R);
  // v0.129.0 · Informe de conciliación del mes (vista-informe-conc.js)
  if ($('ic-sec')) import('./vista-informe-conc.js?v=0.138.0').then(V => { const c = ES.cierres[ES.mes]; V.pintar($('ic-sec'), H, ES.mes, { cerrado: cerrado(ES.mes), cerradoEn: c && c.cerradoEn ? fechaTxt(c.cerradoEn) : '' }); }).catch(e => console.error('Informe de conciliación', e));
  const sel = $('c-mes'); if (sel) sel.addEventListener('change', () => { ES.mes = sel.value; ES.msg = ''; ES.err = ''; repintar(); });
  const ce = $('c-cerrar');
  if (ce) ce.addEventListener('click', async () => {
    const fs = FE.fallas(x.checks), err = $('c-err'); err.textContent = '';
    let override = null;
    if (fs.length) {
      if (!$('c-igual').checked) { err.textContent = 'Hay revisiones pendientes: arréglalas, o marca "Cerrar igual" y escribe el motivo.'; return; }
      const m = $('c-motivo').value.trim(); if (m.length < 5) { err.textContent = 'Escribe el motivo para cerrar igual (al menos 5 letras).'; return; }
      override = { motivo: m };
    }
    // v0.112.0 · Antes de cerrar, las ventas del mes se leen de nuevo (una vez): la foto queda con lo último de las cajas y de B2B
    ce.disabled = true; const t0 = ce.lastChild.textContent; ce.lastChild.textContent = ' Leyendo las ventas…';
    try { await F.datosMes(ES.mes, { forzar: true }); delete ES.vivo[ES.mes]; x = await datosCierre(R, ES.mes); }
    catch (er) { err.textContent = ctx.error(er, H); ce.disabled = false; ce.lastChild.textContent = t0; return; }
    ce.disabled = false; ce.lastChild.textContent = t0;
    if (FE.fallas(x.checks).length && !override) { err.textContent = 'Al leer de nuevo las ventas apareció una revisión pendiente. Revise la lista de arriba.'; repintar(); return; }
    const ok = await new Promise(res => {
      const d = H.dialogo(`<div class="form-dialogo"><h2>Cerrar ${H.esc(FE.mesTxt(ES.mes))}</h2><p>El estado de resultados de ${H.esc(FE.mesTxt(ES.mes))} queda <b>congelado</b> tal como está hoy (resultado ${pesos(x.e.filas.resultado.total)}). Lo que cambie después entra como ajuste en el mes siguiente.</p>${override ? `<p class="aviso">Se cierra con ${fs.length === 1 ? 'una revisión pendiente' : `${fs.length} revisiones pendientes`}: ${H.esc(override.motivo)}</p>` : ''}
        <div class="botones"><button type="button" class="btn-sec" id="c-no">Cancelar</button><button type="button" class="btn" id="c-si">Cerrar el mes</button></div></div>`);
      d.querySelector('#c-no').addEventListener('click', () => { d.close(); res(false); });
      d.querySelector('#c-si').addEventListener('click', () => { d.close(); res(true); });
    });
    if (!ok) return;
    ce.disabled = true; ce.lastChild.textContent = ' Cerrando…';
    try {
      const aj = await ajustesPara(R, ES.mes);
      const snap = FE.armarSnapshot(x.e, { checks: x.checks, override, ajustes: Object.keys(aj.porMes).length ? aj : null });
      ES.cierres[ES.mes] = await F.cerrarMes(ES.mes, snap);
      H.registrar('Finanzas: cerró un mes', `${FE.mesTxt(ES.mes)} · resultado ${x.e.filas.resultado.total}${override ? ' · cerrado igual: ' + override.motivo : ''}`);
      ES.msg = `${FE.mesTxt(ES.mes)} cerrado: queda congelado.`; ES.err = '';
    } catch (er) { ES.err = ctx.error(er, H); }
    repintar();
  });
  const ra = $('c-reabrir');
  if (ra) ra.addEventListener('click', () => {
    const d = H.dialogo(`<form class="form-dialogo" novalidate><h2>Reabrir ${H.esc(FE.mesTxt(ES.mes))}</h2>
      <p class="aviso">No se recomienda: el mes deja de estar congelado y sus números pueden cambiar respecto de lo que ya informaste. Para corregir algo de un mes cerrado no hace falta reabrirlo: el cambio entra solo como ajuste en el mes siguiente.</p>
      <div class="campo"><label for="c-r-mot">Motivo</label><textarea id="c-r-mot" rows="2" maxlength="300"></textarea></div><p class="error" id="c-r-err" role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" id="c-r-no">Cancelar</button><button type="submit" class="btn btn-peligro" id="c-r-si">Reabrir</button></div></form>`);
    d.querySelector('#c-r-no').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const m = d.querySelector('#c-r-mot').value.trim(), er = d.querySelector('#c-r-err');
      if (m.length < 5) { er.textContent = 'Escribe el motivo (al menos 5 letras).'; return; }
      const b = d.querySelector('#c-r-si'); b.disabled = true; b.textContent = 'Reabriendo…';
      try { await F.reabrirMes(ES.mes, m); H.registrar('Finanzas: reabrió un mes', `${FE.mesTxt(ES.mes)} · ${m}`); ES.cierres = null; ES.vivo = {}; ES.msg = `${FE.mesTxt(ES.mes)} reabierto.`; d.close(); repintar(); }
      catch (x2) { er.textContent = ctx.error(x2, H); b.disabled = false; b.textContent = 'Reabrir'; }
    });
  });
}
