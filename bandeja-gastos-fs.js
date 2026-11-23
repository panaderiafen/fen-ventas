// ═══════════════════════════════════════════════
//  Sistema Fën — Bandeja única de Gastos: los números para Hoy  v0.79.0 (Gastos, etapa B)
//  Hoy no abre la lista de la cartola (es pesada): arma el mismo modelo (bandeja-gastos-modelo.js) con lo que ya está en la memoria
//  de fs-gastos (vencimientos, gastos, documentos del SII, Pagos sin banco) más los cargos por revisar (cartola_cargos, de su paquete)
//  y los documentos sin cuenta recurrente. Sin las propuestas de la Bandeja, un cargo calza con un ítem solo si es el mismo monto
//  (±$1) en su ventana y no hay otro igual: por eso, abierta la Bandeja, Hoy usa los números de la Bandeja (más exactos).
//  Solo con la base nueva. No escribe nada.
// ═══════════════════════════════════════════════
import * as FB from './fs-gastos.js?v=0.138.0';
import * as M from './gastos-g2.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import * as C from './gastos-cartola.js?v=0.138.0';
import * as B from './gastos-banco.js?v=0.138.0';
import * as BU from './bandeja-gastos-modelo.js?v=0.138.0';
import { todos, documentosPendientes } from './gastos-fs.js?v=0.138.0';
import { registradosGastos } from './bandeja.js?v=0.138.0';

const rutsSii = docs => { const m = {}; (docs || []).forEach(x => { const im = x.d && x.d.importado; if (im && im.vencimiento) m[im.vencimiento] = C.rutNorm(x.d.rut); }); return m; };
// Las entradas del modelo, de la memoria
export async function entradas() {
  const hoy = M.ahoraChile().dia;
  try { const FS = await import('./gastos-fs.js?v=0.138.0'); await FS.vencimientosAlDia(); } catch (e) {}
  const SPF = await import('./sii-pendientes-fs.js?v=0.138.0');
  const [vencs, ps, siiDocs, gastos, cg, sb, dp] = await Promise.all([todos('vencimientos'), todos('obligaciones'), todos('sii_docs').catch(() => []), todos('gastos', FB.where('fecha', '>=', G3.sumarDias(hoy, -150))).catch(() => []),
    todos('cartola_cargos').catch(() => []), SPF.datos().catch(() => null), documentosPendientes().catch(() => ({ documentos: [] }))]);
  const abiertos = C.vencimientosAbiertos(vencs, ps, rutsSii(siiDocs), hoy);
  const grupos = B.candidatosGastos(gastos, hoy, new Set(abiertos.filter(v => !v.plantillaId && v.folio).map(v => B.claveFactura(v.folio, v.razon))), { conNC: true });
  const cargos = cg.filter(x => !x.d.quitadoEnPlanilla).map(x => C.vistaCargo(x.id, x.d)).filter(c => c.estado === C.ESTADOS.revisar);
  return { hoy, siiPendientes: sb ? sb.pendientes : [], vencimientos: abiertos, gastos: grupos.filter(g => g.monto > 0), notasCredito: grupos.filter(g => g.monto < 0),
    sinBanco: sb ? sb.lista : null, pagos: sb ? sb.pagos : [], docsPend: (dp.documentos || []).filter(x => x.estado === 'pendiente'), cargos, registrados: registradosGastos(gastos, vencs, hoy) };
}
// Los números de la Bandeja (Todo, Por clasificar, Por pagar, Por calzar con el banco, Sin pago en banco)
export async function conteosHoy() {
  const E = await entradas();
  return BU.armar(E).n;
}
