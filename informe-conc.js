// ═══════════════════════════════════════════════════════════════════════
//  Sistema Fën — Informe de conciliación del mes (modelo)  v0.129.0 (boceto "Informe de conciliación" aprobado el 13 nov)
//  Cada cargo y cada abono del banco y de Mercado Pago de un mes, con su documento o su explicación, y lo que quedó pendiente.
//  Respaldo ante el SII y para la contadora. Puro: recibe lo de flujo-fs.js (los mismos datos del Flujo de caja).
// ═══════════════════════════════════════════════════════════════════════
import * as M from './flujo-modelo.js?v=0.138.0';
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as GT from './tributario.js?v=0.138.0';

const s = v => (v == null ? '' : String(v));
const ent = v => Math.round(Number(v) || 0);
export const CUENTAS = { chequera: 'BancoEstado chequera', cc: 'BancoEstado cuenta corriente', mp: 'Mercado Pago' };
const ESTADO_ABONO = { conciliado: 'Conciliado', revisado: 'Ya lo anoté a mano', ignorado: 'No es de Ventas a empresas', repetido: 'Repetido', pendiente: 'Pendiente' };

// d: FlujoFS.cargar(); mes 'AAAA-MM' → { mes, desde, hasta, resumen, cargos, abonos, pendientes, ventasMp, totales }
export function armar(d, mes, { hoy = M.hoyChile() } = {}) {
  const gn = d.gn || {}, desde = mes + '-01', fin = M.ultimoDia(mes), hasta = fin < hoy ? fin : hoy, enMes = f => s(f) >= desde && s(f) <= fin;
  const pagos = (gn.pagos || []).filter(p => p.estado !== 'deshecho'), I = GB.indicePagos(gn.pagos || []);
  const docs = new Map((gn.docs || []).map(x => [x.id, x]));
  const T = gn.tributario || {};
  // ── Cargos (Gastos: lo que salió del banco y de Mercado Pago) ──
  const cargos = (gn.movs || []).filter(m => CUENTAS[m.cuenta] && !m.anterior && enMes(m.fecha)).sort((a, b) => s(a.fecha).localeCompare(s(b.fecha)) || s(a.hora).localeCompare(s(b.hora))).map(m => {
    const ps = pagos.filter(p => p.movId === m.id), libre = m.estado === 'no_va' ? 0 : GB.libreMov(m, I), ds = ps.map(p => docs.get(p.docId)).filter(Boolean);
    let como, pend = false;
    if (m.estado === 'no_va') como = 'Esto no va';
    else if (m.naturaleza === 'acuenta') { como = 'Pago a cuenta (espera su documento)'; pend = true; }
    else if (m.naturaleza) como = 'No es gasto: ' + (GB.NO_GASTO[m.naturaleza] || m.naturaleza);
    else if (ps.length && libre <= GB.TOLERANCIA) como = 'Unido a su documento';
    else if (ps.length) { como = `Unido en parte · falta explicar ${'$' + ent(libre).toLocaleString('es-CL')}`; pend = true; }
    else { como = 'Pendiente'; pend = true; }
    const partes = ds.map(x => { const c = GB.clasifDe(x, gn.provs, gn.repartos); const p = (c && c.partes) || []; return { x, items: [...new Set(p.map(q => q.item).filter(Boolean))], areas: [...new Set(p.map(q => q.area).filter(Boolean))] }; });
    const sit = partes.map(({ x, items }) => GT.SITUACIONES[GT.situacionDe(x, items[0] || '', x.fecha, T).situacion] || '').filter(Boolean);
    return { fecha: m.fecha, hora: s(m.hora), cuenta: m.cuenta, cuentaTxt: CUENTAS[m.cuenta], glosa: s(m.glosa), operacion: s(m.operacion), monto: ent(m.monto), como, pend,
      documento: ds.map(x => s(x.tipoTexto)).join(' · '), folio: ds.map(x => s(x.folio)).join(' · '), rut: ds.map(x => s(x.rut)).join(' · '), razon: ds.map(x => s(x.razon)).join(' · '),
      item: [...new Set(partes.flatMap(p => p.items))].join(', '), area: [...new Set(partes.flatMap(p => p.areas))].join(', '), situacion: [...new Set(sit)].join(', '),
      foto: ds.map(x => (x.foto && x.foto.url) || '').filter(Boolean).join(' '), nota: s(m.naturalezaNota || (m.noVa && m.noVa.nota) || '') };
  });
  // ── Abonos (Ventas a empresas → Conciliación) ──
  const clientes = Array.isArray(d.clientes) ? d.clientes : Object.values(d.clientes || {});
  const cli = id => clientes.find(c => c && (c.id === id)) || null;
  const porId = new Map((d.abonos || []).map(a => [a.id, a]));
  const abonos = (d.abonos || []).filter(a => CUENTAS[a.cuenta || 'chequera'] && enMes(a.fecha)).sort((a, b) => s(a.fecha).localeCompare(s(b.fecha)) || (Number(a.orden) || 0) - (Number(b.orden) || 0)).map(a => {
    const c = a.clienteId ? cli(a.clienteId) : null, o = a.repetidoDe ? porId.get(a.repetidoDe) : null;
    const folios = (a.asignaciones || []).filter(x => x && x.folio).map(x => `F.${x.folio} ${'$' + ent(x.monto).toLocaleString('es-CL')}`).join(' · ');
    const nota = a.estado === 'repetido' ? `Repetido del abono del ${o ? M.diaTxt(o.fecha) : '—'}${o && o.cartola ? ' (' + o.cartola + ')' : ''}` : s(a.nota);
    return { fecha: a.fecha, cuenta: a.cuenta || 'chequera', cuentaTxt: CUENTAS[a.cuenta || 'chequera'], glosa: s(a.descripcion), operacion: s(a.nOperacion), monto: ent(a.monto),
      como: ESTADO_ABONO[a.estado] || s(a.estado), pend: a.estado === 'pendiente', real: a.estado !== 'repetido',
      cliente: a.estado === 'conciliado' ? s((c && (c.razonSocial || c.nombre)) || a.cliente) : '', rut: a.estado === 'conciliado' ? s(c && c.rut) : '', folios, nota, cartola: s(a.cartola) };
  });
  // ── Ventas con tarjeta liberadas por Mercado Pago (del reporte), por día ──
  const ventasMp = (d.mpVentas || []).filter(v => enMes(v.fecha)).map(v => ({ fecha: v.fecha, bruto: ent(v.bruto), neto: ent(v.neto) })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  // ── Resumen por cuenta: saldos de la cartola y cuánto está conciliado ──
  const finAnt = M.sumarDias(desde, -1), cob = d.cobertura || {};
  const saldo = (c, dia) => { try { return c === 'mp' ? M.saldoMpAl(dia, { movsMp: d.movsMp, mpVentas: d.mpVentas, cobertura: s(cob.mp), mpDias: (d.config || {}).mpDias || 0 }) : M.saldoCartolaAl(c, dia, d); } catch (e) { return null; } };
  const resumen = Object.keys(CUENTAS).map(c => {
    const cg = cargos.filter(x => x.cuenta === c), ab = abonos.filter(x => x.cuenta === c && x.real);
    const dfin = s(cob[c]) && s(cob[c]) < hasta ? s(cob[c]) : hasta;
    const inicial = s(cob[c]) >= finAnt ? saldo(c, finAnt) : null, final = s(cob[c]) >= desde ? saldo(c, dfin) : null;
    const entra = c === 'mp' ? ventasMp.reduce((a, v) => a + v.neto, 0) : ab.reduce((a, x) => a + x.monto, 0), sale = cg.filter(x => x.como !== 'Esto no va').reduce((a, x) => a + x.monto, 0);
    const dif = inicial != null && final != null ? inicial + entra - sale - final : null;
    return { cuenta: c, nombre: CUENTAS[c], inicial, final, finalAl: dfin, entra, sale, calza: c === 'mp' ? 'no aplica' : dif == null ? '—' : Math.abs(dif) <= 1 ? 'Sí' : `No (diferencia ${'$' + ent(dif).toLocaleString('es-CL')})`,
      cargos: { n: cg.length, conc: cg.filter(x => !x.pend).length }, abonos: c === 'mp' ? null : { n: ab.length, conc: ab.filter(x => !x.pend).length },
      pend: cg.filter(x => x.pend).length + ab.filter(x => x.pend).length };
  }).filter(r => r.cargos.n || (r.abonos && r.abonos.n) || r.inicial != null || (r.cuenta === 'mp' && ventasMp.length));
  const pendientes = cargos.filter(x => x.pend).map(x => ({ ...x, tipo: 'Cargo' })).concat(abonos.filter(x => x.pend).map(x => ({ ...x, tipo: 'Abono' }))).sort((a, b) => s(a.fecha).localeCompare(s(b.fecha)));
  const nCg = cargos.length, nAb = abonos.filter(x => x.real).length;
  const totales = { cargos: { n: nCg, conc: cargos.filter(x => !x.pend).length }, abonos: { n: nAb, conc: abonos.filter(x => x.real && !x.pend).length }, pendientes: { n: pendientes.length, monto: pendientes.reduce((a, x) => a + x.monto, 0) } };
  return { mes, desde, hasta, fin, resumen, cargos, abonos, pendientes, ventasMp, totales, faltan: Object.keys(d.faltan || {}) };
}
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 100);

// Las hojas del Excel (filas como arreglos; la primera fila de cada tabla es su encabezado)
export function hojas(R, { empresa = 'Panadería Fën', generado = '', estadoMes = '' } = {}) {
  const $ = n => (n == null ? '' : Math.round(n));
  const res = [[`Informe de conciliación · ${M.mesTxt ? M.mesTxt(R.mes) : R.mes} · ${empresa}`], [`Generado: ${generado}${estadoMes ? ' · ' + estadoMes : ''}`], [],
    ['Cuenta', 'Saldo inicial (cartola)', 'Entró', 'Salió', 'Saldo final (cartola)', 'Saldo final al', '¿Calza?', 'Cargos conciliados', 'Abonos conciliados', 'Pendientes'],
    ...R.resumen.map(r => [r.nombre, $(r.inicial), r.entra, r.sale, $(r.final), r.finalAl, r.calza, `${r.cargos.conc} de ${r.cargos.n} (${pct(r.cargos.conc, r.cargos.n)} %)`, r.abonos ? `${r.abonos.conc} de ${r.abonos.n}` : 'ventas del reporte', r.pend]),
    ['Total', '', '', '', '', '', '', `${R.totales.cargos.conc} de ${R.totales.cargos.n}`, `${R.totales.abonos.conc} de ${R.totales.abonos.n}`, R.totales.pendientes.n],
    [], ['Pendientes al ' + R.hasta], ['Fecha', 'Tipo', 'Cuenta', 'Glosa del banco', 'Monto', 'Estado', 'Nota'],
    ...(R.pendientes.length ? R.pendientes.map(x => [x.fecha, x.tipo, x.cuentaTxt, x.glosa, x.monto, x.como, x.nota]) : [['Nada pendiente']]),
    [], ['Ventas con tarjeta liberadas por Mercado Pago (del reporte), por día'], ['Fecha', 'Bruto', 'Neto (sin comisión)'],
    ...(R.ventasMp.length ? R.ventasMp.map(v => [v.fecha, v.bruto, v.neto]) : [['Sin reporte de Mercado Pago este mes']])];
  const car = [['Fecha', 'Hora', 'Cuenta', 'Glosa del banco', 'N° de operación', 'Monto', 'Cómo quedó', 'Documento', 'Folio', 'RUT', 'Razón social', 'Ítem', 'Área', 'Situación SII', 'Foto', 'Nota'],
    ...R.cargos.map(x => [x.fecha, x.hora, x.cuentaTxt, x.glosa, x.operacion, x.monto, x.como, x.documento, x.folio, x.rut, x.razon, x.item, x.area, x.situacion, x.foto, x.nota])];
  const abo = [['Fecha', 'Cuenta', 'Glosa del banco', 'N° de operación', 'Monto', 'Cómo quedó', 'Cliente', 'RUT', 'Folios que paga', 'Nota', 'Cartola'],
    ...R.abonos.map(x => [x.fecha, x.cuentaTxt, x.glosa, x.operacion, x.monto, x.como, x.cliente, x.rut, x.folios, x.nota, x.cartola])];
  return { Resumen: res, Cargos: car, Abonos: abo };
}
