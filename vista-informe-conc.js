// ═══════════════════════════════════════════════════════════════════════
//  Sistema Fën — Finanzas → Cierre de mes → Informe de conciliación (pantalla)  v0.129.0
//  Se prepara al tocar (lee lo mismo que el Flujo de caja) y se descarga un Excel con tres hojas: Resumen, Cargos y Abonos.
// ═══════════════════════════════════════════════════════════════════════
import * as M from './flujo-modelo.js?v=0.138.0';
import * as FF from './flujo-fs.js?v=0.138.0';
import * as IC from './informe-conc.js?v=0.138.0';

// v0.129.1 · ExcelJS (con colores, bordes, formato $ y filtros): la librería anterior no escribía formato
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let cargando = null;
function cargarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!cargando) cargando = new Promise((ok, no) => { const s = document.createElement('script'); s.src = EXCELJS_URL; s.onload = () => ok(window.ExcelJS); s.onerror = () => { cargando = null; no(new Error('No se pudo cargar el armador de Excel. Revise la conexión.')); }; document.head.appendChild(s); });
  return cargando;
}
const VERDE = 'FF2F5A45', GRIS = 'FFF3F1EA', AMARILLO = 'FFFBF3E0', VERDE_SUAVE = 'FFDFE9E0', BORDE = 'FFD9D3C6';
const FMT_PESOS = '"$"#,##0;[Red]-"$"#,##0';
const relleno = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
const bordes = { top: { style: 'thin', color: { argb: BORDE } }, left: { style: 'thin', color: { argb: BORDE } }, bottom: { style: 'thin', color: { argb: BORDE } }, right: { style: 'thin', color: { argb: BORDE } } };
// Una tabla con encabezado verde, filas alternadas, bordes y montos con $; devuelve la fila siguiente
function tabla(ws, fila, enc, filas, { pesos = [], resaltar = null } = {}) {
  const h = ws.getRow(fila); enc.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = relleno(VERDE); c.border = bordes; c.alignment = { vertical: 'middle', wrapText: true }; }); h.height = 32;
  filas.forEach((f, k) => { const r = ws.getRow(fila + 1 + k); const fondo = resaltar && resaltar(f, k) ? resaltar(f, k) : (k % 2 ? GRIS : 'FFFFFFFF');
    f.forEach((v, i) => { const c = r.getCell(i + 1); c.value = v === '' ? null : v; c.fill = relleno(fondo); c.border = bordes; c.alignment = { vertical: 'top', wrapText: typeof v === 'string' && v.length > 30 }; if (pesos.includes(i) && typeof v === 'number') c.numFmt = FMT_PESOS; }); });
  return fila + 1 + filas.length;
}
async function libro(R, est, generado) {
  const X = await cargarExcelJS(), wb = new X.Workbook(); wb.creator = 'Sistema Fën'; wb.created = new Date();
  const pct = (a, b) => `${a} de ${b} (${IC.pct(a, b)} %)`;
  // Resumen
  const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  ws.columns = [26, 18, 26, 34, 18, 22, 24, 20, 20, 12].map(w => ({ width: w }));
  ws.getCell('A1').value = `Informe de conciliación · ${M.mesTxt(R.mes)} ${R.mes.slice(0, 4)}`; ws.getCell('A1').font = { bold: true, size: 16, color: { argb: VERDE } };
  ws.getCell('A2').value = `Panadería Fën · generado el ${generado} · ${est}`; ws.getCell('A2').font = { color: { argb: 'FF5C665F' } };
  let f = 4; ws.getCell('A' + f).value = 'Por cuenta'; ws.getCell('A' + f).font = { bold: true, size: 12 };
  f = tabla(ws, f + 1, ['Cuenta', 'Saldo inicial (cartola)', 'Entró', 'Salió', 'Saldo final (cartola)', 'Saldo final al', '¿Calza?', 'Cargos conciliados', 'Abonos conciliados', 'Pendientes'],
    R.resumen.map(r => [r.nombre, r.inicial == null ? '' : r.inicial, r.entra, r.sale, r.final == null ? '' : r.final, r.finalAl, r.calza, pct(r.cargos.conc, r.cargos.n), r.abonos ? pct(r.abonos.conc, r.abonos.n) : 'ventas del reporte', r.pend])
      .concat([['Total', '', '', '', '', '', '', pct(R.totales.cargos.conc, R.totales.cargos.n), pct(R.totales.abonos.conc, R.totales.abonos.n), R.totales.pendientes.n]]),
    { pesos: [1, 2, 3, 4], resaltar: (x, k) => (k === R.resumen.length ? VERDE_SUAVE : null) });
  ws.getRow(f - 1).font = { bold: true };
  f += 1; ws.getCell('A' + f).value = `Pendientes al ${M.diaTxt(R.hasta)}`; ws.getCell('A' + f).font = { bold: true, size: 12 };
  f = tabla(ws, f + 1, ['Fecha', 'Tipo', 'Cuenta', 'Glosa del banco', 'Monto', 'Estado', 'Nota'],
    R.pendientes.length ? R.pendientes.map(x => [x.fecha, x.tipo, x.cuentaTxt, x.glosa, x.monto, x.como, x.nota]) : [['Nada pendiente', '', '', '', '', '', '']], { pesos: [4], resaltar: () => (R.pendientes.length ? AMARILLO : null) });
  f += 1; ws.getCell('A' + f).value = 'Ventas con tarjeta liberadas por Mercado Pago (del reporte), por día'; ws.getCell('A' + f).font = { bold: true, size: 12 };
  tabla(ws, f + 1, ['Fecha', 'Bruto', 'Neto (sin comisión)'], R.ventasMp.length ? R.ventasMp.map(v => [v.fecha, v.bruto, v.neto]).concat([['Total', R.ventasMp.reduce((a, v) => a + v.bruto, 0), R.ventasMp.reduce((a, v) => a + v.neto, 0)]]) : [['Sin reporte de Mercado Pago este mes', '', '']],
    { pesos: [1, 2], resaltar: (x, k) => (k === R.ventasMp.length ? VERDE_SUAVE : null) });
  // Cargos y Abonos: encabezado fijo y filtros; pendientes en amarillo
  const hoja = (nombre, enc, anchos, filas, pesos, esPend) => {
    const w = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
    w.columns = anchos.map(x => ({ width: x }));
    tabla(w, 1, enc, filas, { pesos, resaltar: (x, k) => (esPend(k) ? AMARILLO : null) });
    w.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: enc.length } };
  };
  hoja('Cargos', ['Fecha', 'Hora', 'Cuenta', 'Glosa del banco', 'N° de operación', 'Monto', 'Cómo quedó', 'Documento', 'Folio', 'RUT', 'Razón social', 'Ítem', 'Área', 'Situación SII', 'Foto', 'Nota'],
    [11, 7, 24, 40, 16, 12, 32, 20, 12, 14, 30, 26, 12, 14, 30, 40], R.cargos.map(x => [x.fecha, x.hora, x.cuentaTxt, x.glosa, x.operacion, x.monto, x.como, x.documento, x.folio, x.rut, x.razon, x.item, x.area, x.situacion, x.foto, x.nota]), [5], k => R.cargos[k].pend);
  hoja('Abonos', ['Fecha', 'Cuenta', 'Glosa del banco', 'N° de operación', 'Monto', 'Cómo quedó', 'Cliente', 'RUT', 'Folios que paga', 'Nota', 'Cartola'],
    [11, 24, 40, 16, 12, 24, 30, 14, 40, 44, 34], R.abonos.map(x => [x.fecha, x.cuentaTxt, x.glosa, x.operacion, x.monto, x.como, x.cliente, x.rut, x.folios, x.nota, x.cartola]), [4], k => R.abonos[k].pend);
  return wb;
}
async function descargar(wb, nombre) {
  const buf = await wb.xlsx.writeBuffer(), url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
const TXT = 'Cada cargo y cada abono del banco y de Mercado Pago del mes, con su documento o su explicación, y lo que quedó pendiente.\nSirve de respaldo de la conciliación bancaria ante el SII y para la contadora (la contabilidad oficial la lleva ella).\nEl Excel trae tres hojas: Resumen (saldos de la cartola por cuenta, cuánto está conciliado, los pendientes y las ventas con tarjeta por día), Cargos y Abonos.\nSale con los datos de hoy: si el mes está abierto, dice "borrador".';

// sec: el <section> donde va; mes 'AAAA-MM'; c: { cerrado, cerradoEn }
export function pintar(sec, H, mes, c = {}) {
  if (!sec) return;
  const est = c.cerrado ? `Mes cerrado${c.cerradoEn ? ' el ' + c.cerradoEn : ''}` : 'Borrador: el mes está abierto';
  sec.innerHTML = `<div class="titulo-fila fin-titulo"><h2 id="t-ic">Informe de conciliación ${H.info('Informe de conciliación', TXT)}</h2></div>
    <p class="ayuda">Cada cargo y cada abono del banco y de Mercado Pago de ${H.esc(M.mesTxt(mes))}, con su documento o su explicación, y lo que quedó pendiente. Respaldo ante el SII y para la contadora.</p>
    <div id="ic-cuerpo"><button type="button" class="btn-sec" id="ic-prep">Preparar el informe de ${H.esc(M.mesTxt(mes))}</button></div>`;
  const b = sec.querySelector('#ic-prep');
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Preparando…';
    let R; try { R = IC.armar(await FF.cargar(), mes); }
    catch (e) { console.error('Informe de conciliación', e); sec.querySelector('#ic-cuerpo').innerHTML = `<p class="error" role="alert">No se pudo preparar (${H.esc(e.message || String(e))}).</p>`; return; }
    const t = R.totales, cuerpo = sec.querySelector('#ic-cuerpo');
    cuerpo.innerHTML = `<div class="ic-tres">
        <div class="ic-k"><small>Cargos</small><b>${t.cargos.n} · ${IC.pct(t.cargos.conc, t.cargos.n)} %</b><small>conciliados</small></div>
        <div class="ic-k"><small>Abonos</small><b>${t.abonos.n} · ${IC.pct(t.abonos.conc, t.abonos.n)} %</b><small>conciliados</small></div>
        <div class="ic-k ${t.pendientes.n ? 'ic-k-pend' : ''}"><small>Pendientes</small><b>${t.pendientes.n}${t.pendientes.n ? ' · ' + pesos(t.pendientes.monto) : ''}</b><small>${t.pendientes.n ? 'con su nota' : 'nada pendiente'}</small></div></div>
      ${R.faltan.length ? '<p class="aviso">Algunos datos no se pudieron leer en este equipo (Ventas a empresas o las cajas): el informe puede salir incompleto.</p>' : ''}
      <div class="botones"><button type="button" class="btn" id="ic-bajar">Descargar informe (Excel)</button></div>
      <p class="ayuda">${H.esc(est)}. Sale con los datos de hoy. Nombre del archivo: Fen conciliacion ${H.esc(mes)}.xlsx</p><p class="error" id="ic-err" role="alert"></p>`;
    cuerpo.querySelector('#ic-bajar').onclick = async ev => {
      const bt = ev.currentTarget; bt.disabled = true;
      try {
        await descargar(await libro(R, est, new Date().toLocaleString('es-CL')), `Fen conciliacion ${mes}.xlsx`);
        if (H.registrar) H.registrar('Finanzas: informe de conciliación', `${M.mesTxt(mes)} · ${t.cargos.n} cargos · ${t.abonos.n} abonos · ${t.pendientes.n} pendientes`);
      } catch (e) { sec.querySelector('#ic-err').textContent = e.message || String(e); }
      bt.disabled = false;
    };
  };
}
