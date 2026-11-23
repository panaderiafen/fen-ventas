// ═══════════════════════════════════════════════════════════════════════
//  Sistema Fën — Plata de Fën hoy (modelo)  v0.128.0 (aprobado por Emmanuel el 13 nov, boceto "Plata de Fën hoy")
//  Tres totales: lo que hay (bancos, Mercado Pago y efectivo), lo que viene (por cobrar − por pagar − tarjeta) y lo que queda.
//  Usa los mismos datos y reglas del Flujo de caja (flujo-modelo.js): no lee nada propio ni gasta lecturas extra. Puro.
//  Decidido el 13 nov: sueldos, Previred y F29 entran como "estimado" hasta que se sube su documento; lo que la empresa le debe
//  al dueño se muestra aparte y no se suma; los créditos solo con la cuota que vence en el período.
// ═══════════════════════════════════════════════════════════════════════
import * as M from './flujo-modelo.js?v=0.138.0';
import * as GB from './gn-bandeja.js?v=0.138.0';

const ent = v => Math.round(Number(v) || 0);
const s = v => (v == null ? '' : String(v));
export const DIAS_VIEJO = 2;        // un saldo de más de 2 días lleva la etiqueta "hace N días"
export const DIAS_AVISO_MES = 7;    // v0.128.3 (pedido por Emmanuel el 13 nov): por pagar, solo hasta fin de mes; 7 días antes, también el mes que viene
// Hasta dónde se mira lo por pagar: el último día del mes en curso; desde 7 días antes de que termine, el último del mes siguiente
export function hastaPagar(hoy) { const fin = M.ultimoDia(hoy.slice(0, 7)); return M.diasEntre(hoy, fin) < DIAS_AVISO_MES ? M.ultimoDia(M.sigMes(hoy.slice(0, 7))) : fin; }
const SUC = { barros_arana: 'Barros Arana', ainavillo: 'Ainavillo' };

// d: lo de FlujoFS.cargar() (armarDatos). → { hoy, hay, viene, queda, dueno, sinConciliar }
export function calcular(d, { hoy = M.hoyChile() } = {}) {
  const cfg = d.config || {}, gn = d.gn || {}, cob = d.cobertura || {};
  // ── Lo que hay ──
  const fila = (k, nombre, fecha, monto, extra = {}) => ({ k, nombre, fecha: fecha || '', monto: monto == null ? null : ent(monto), dias: fecha ? M.diasEntre(fecha, hoy) : null, ...extra });
  const banco = c => { const f = s(cob[c]); return fila(c, M.CUENTAS[c], f, f ? M.saldoCartolaAl(c, f, d) : null, { de: 'cartola', link: '#gastos' }); };
  const mp = saldoMp(d, cfg);
  const libro = M.libroAdminAl(d.efmovs, hoy);
  const admin = fila('admin', 'Caja de administración', hoy, libro ? libro.saldo : null, { de: 'efectivo', conteo: libro && libro.conteo ? libro.conteo.dia : '', link: '#efectivo' });
  const F = M.fondosAl(d.evals, hoy), fondos = Object.entries(F);
  const fondo = fila('fondos', 'Fondos de las cajas', hoy, fondos.reduce((a, [, f]) => a + f.monto, 0), { detalle: fondos.map(([k, f]) => `${SUC[k] || k} ${'$' + f.monto.toLocaleString('es-CL')}`).join(' · '), link: '#efectivo' });
  const sobresN = sobresSinRecibir(d.cmovs, d.efmovs, hoy);
  const sobres = fila('sobres', 'Sobres por recibir', hoy, M.transitoAl(d.cmovs, d.efmovs, hoy), { detalle: sobresN ? `${sobresN} ${sobresN === 1 ? 'retiro sin recibir' : 'retiros sin recibir'}` : 'nada por recibir', link: '#efectivo' });
  const hayL = [banco('chequera'), banco('cc'), mp, admin, fondo, sobres];
  hayL.forEach(x => { x.viejo = x.de && x.dias != null && x.dias > DIAS_VIEJO; });
  const hay = { lista: hayL, total: hayL.reduce((a, x) => a + (x.monto || 0), 0), faltan: hayL.filter(x => x.monto == null).map(x => x.nombre), viejos: hayL.filter(x => x.viejo) };

  // ── Lo que viene ──
  const hasta = hastaPagar(hoy), ctx = { catalogo: gn.catalogo, provs: gn.provs, repartos: gn.repartos };
  let esp = [].concat(
    M.esperadosDocs(gn, { hoy }), M.esperadosCompromisos(gn.compromisos, gn.docs, { hoy, hasta, ctx }), M.esperadosCuotas(gn.creditos, gn.docs, { hoy, hasta }),
    M.esperadosSueldos(gn.docs, { hoy, hasta }), M.esperadosPrevired(gn.docs, { hoy, hasta }), M.esperadosF29(gn.docs, { hoy, hasta, cierres: d.evals, ordenes: d.ordenes }),
    M.esperadosCobros(d.porCliente, d.clientes, { hoy }));
  esp = M.aplicarAjustes(esp, d.ajustes).filter(x => ent(x.monto) > 0);
  const dom = M.sumarDias(M.lunesDe(hoy), 6);
  const tramo = x => (!M.esDia(x.fecha) ? 'adelante' : x.fecha < hoy ? 'vencido' : x.fecha <= dom ? 'semana' : 'adelante');
  const grupo = l => { const g = { vencido: [], semana: [], adelante: [] }; l.forEach(x => g[tramo(x)].push(x)); Object.values(g).forEach(a => a.sort((p, q) => s(p.fecha).localeCompare(s(q.fecha)) || q.monto - p.monto));
    const t = k => g[k].reduce((a, x) => a + ent(x.monto), 0); return { ...g, tot: { vencido: t('vencido'), semana: t('semana'), adelante: t('adelante') }, total: t('vencido') + t('semana') + t('adelante') }; };
  const esAnterior = x => x.fuente && x.fuente.tipo === 'doc' && /deuda anterior/.test(s(x.que));
  const cobrar = grupo(esp.filter(x => x.sentido === 'entra'));
  const fueraP = esp.filter(x => x.sentido === 'sale' && !esAnterior(x) && M.esDia(x.fecha) && x.fecha > hasta);
  const pagar = grupo(esp.filter(x => x.sentido === 'sale' && !esAnterior(x) && !(M.esDia(x.fecha) && x.fecha > hasta)));
  const anteriorL = esp.filter(x => x.sentido === 'sale' && esAnterior(x)), anterior = anteriorL.reduce((a, x) => a + ent(x.monto), 0);
  const tarjeta = tarjetaUsada(gn.movs, d.ini || M.INICIO);
  const viene = { cobrar, pagar, despues: { n: fueraP.length, total: fueraP.reduce((a, x) => a + ent(x.monto), 0) }, anterior: { total: anterior, lista: anteriorL }, tarjeta, hasta,
    // v0.128.1: la deuda de antes del 1 oct se muestra aparte y no se suma (casi siempre se pagó antes del corte)
    total: cobrar.total - pagar.total - tarjeta.monto, estimados: esp.filter(x => x.estado === 'estimado' && x.sentido === 'sale').length };

  // ── Aparte: la cuenta con el dueño y lo que falta conciliar (los totales pueden cambiar) ──
  const dd = GB.deudaDueno(gn.pagos, gn.movs, gn.docs);
  const I = GB.indicePagos(gn.pagos || []);
  const cargos = (gn.movs || []).filter(m => !m.anterior && ['cc', 'chequera', 'mp'].includes(m.cuenta) && m.estado !== 'no_va' && !m.naturaleza && GB.libreMov(m, I) > GB.TOLERANCIA).length;
  const abonos = (d.abonos || []).filter(a => a.estado === 'pendiente').length;
  return { hoy, hay, viene, queda: hay.total + viene.total, dueno: { saldo: ent(dd.saldo) }, sinConciliar: { cargos, abonos }, faltanDatos: Object.keys(d.faltan || {}) };
}
// v0.128.1 · Mercado Pago: el saldo de la última fila del último reporte (BALANCE_AMOUNT, exacto); si el reporte se subió antes de
// esta versión, el cálculo de antes (saldo del último pago + ventas liberadas después).
export function saldoMp(d, cfg = {}) {
  const ks = (((d.gn || {}).cargas) || []).filter(k => k.tipo === 'mercadopago' && k.saldoFinal && M.esDia(k.saldoFinal.fecha)).sort((a, b) => (s(a.saldoFinal.fecha) + s(a.saldoFinal.hora)).localeCompare(s(b.saldoFinal.fecha) + s(b.saldoFinal.hora)));
  const k = ks[ks.length - 1], fmp = s((d.cobertura || {}).mp), hoy = M.hoyChile();
  const dias = f => (f ? M.diasEntre(f, hoy) : null);
  if (k && s(k.saldoFinal.fecha) >= fmp) return { k: 'mp', nombre: 'Mercado Pago', fecha: k.saldoFinal.fecha, monto: ent(k.saldoFinal.monto), dias: dias(k.saldoFinal.fecha), de: 'reporte', exacto: true, hora: s(k.saldoFinal.hora), link: '#gastos' };
  return { k: 'mp', nombre: 'Mercado Pago', fecha: fmp, monto: fmp ? M.saldoMpAl(fmp, { movsMp: d.movsMp, mpVentas: d.mpVentas, cobertura: fmp, mpDias: cfg.mpDias || 0 }) : null, dias: dias(fmp), de: 'reporte', link: '#gastos' };
}
// Los retiros de cierre (o a la caja de administración) que todavía no se reciben en Efectivo
function sobresSinRecibir(cmovs, efmovs, hoy) {
  const rec = new Set(); (efmovs || []).forEach(m => { if (!m.anulado && m.tipo === 'ingreso' && m.motivo === 'retiro_caja' && m.origen && m.origen.cajaMovId) rec.add(m.origen.cajaMovId); });
  return (cmovs || []).filter(x => !x.anulado && x.tipo === 'retiro' && ['cierre', 'caja_admin'].includes(x.motivo) && s(x.dia) <= hoy && !rec.has(x.id)).length;
}
// Tarjeta de crédito: las compras anotadas desde el inicio menos los pagos de la tarjeta desde el banco (sin bajar de 0)
export function tarjetaUsada(movs, inicio) {
  const vivo = m => m.estado !== 'no_va' && s(m.fecha) >= inicio;
  const compras = (movs || []).filter(m => m.cuenta === 'tc' && vivo(m)).reduce((a, m) => a + ent(m.monto), 0);
  const pagos = (movs || []).filter(m => m.cuenta !== 'tc' && m.naturaleza === 'tarjeta' && vivo(m)).reduce((a, m) => a + ent(m.monto), 0);
  return { compras, pagos, monto: Math.max(0, compras - pagos) };
}
// Lo que se guarda en este equipo para la tarjeta de Hoy (sin escribir en la base)
export const resumenCorto = P => ({ en: new Date().toISOString(), hoy: P.hoy, hay: P.hay.total, viene: P.viene.total, queda: P.queda, viejos: P.hay.viejos.map(x => ({ nombre: x.nombre, dias: x.dias })) });
