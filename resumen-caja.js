// ═══════════════════════════════════════════════
//  fën · resumen del cierre de una caja (resumenes_caja/{cajaId})
//  ARCHIVO COMPARTIDO: el mismo, byte a byte, en la caja (repo fen-ventas) y en Sistema Fën (repo sistema-fen).
//  Si se cambia, se cambia en los dos (las pruebas revisan que sean iguales).
//  Desde la caja v2.9.0 y Sistema Fën v0.117.0 (antes estaba escrito dos veces, "copia fiel").
//  No lee ni escribe Firestore: recibe las ventas y la información de cada producto, y devuelve el resumen.
//  Formato (caja v2.3.0 en adelante): por medio de pago, por área y por producto (con catalogoId, tipo, recetaId,
//  reventaId; porTarjeta y agotadoHoy de la caja v2.2.0; porLeche de la caja v2.7.0) y el total por tipo de leche.
// ═══════════════════════════════════════════════

// cajaId, cajaData: la caja; ventas: los datos de sus ventas (también las anuladas: se cuentan aparte);
// infoProd: { idProducto: { area, idRecetaFen, catalogoId, tipo, recetaId, reventaId, unidadesPorVenta } } (el producto de hoy);
// areaRes(área de la línea) → área del resumen; fecha: 'AAAA-MM-DD'; ahora: Timestamp de este momento.
export function armarResumen({ cajaId, cajaData, ventas, infoProd, areaRes, fecha, ahora }) {
  const neto = b => Math.round((parseInt(b) || 0) / 1.19);
  const r = {
    cajaId, sucursal: cajaData.sucursal || '', fecha: fecha || '',
    nVentas: 0, nAnuladas: 0, totalBruto: 0, totalNeto: 0,
    porMedio: { efectivo: 0, debito: 0, credito: 0, transferencia: 0 },
    porArea: {}, porProducto: {}, porLeche: {}, version: 1, actualizado: ahora
  };
  r.versionCaja = '2.3.0'; // el formato de la caja v2.3.0 (lo de después solo agrega campos)
  const tarj = {}, agot = {}, reagot = {};
  r.mes = (r.fecha || '').slice(0, 7);
  (ventas || []).forEach(v => {
    if (!v) return;
    if (v.anulada === true) { r.nAnuladas++; return; }
    r.nVentas++;
    const total = parseInt(v.total) || 0;
    r.totalBruto += total;
    if (Array.isArray(v.pagos) && v.pagos.length) v.pagos.forEach(p => { if (p && p.medio) r.porMedio[p.medio] = (r.porMedio[p.medio] || 0) + (parseInt(p.monto) || 0); });
    else if (v.medioPago) r.porMedio[v.medioPago] = (r.porMedio[v.medioPago] || 0) + total;
    (v.lineas || []).forEach(l => {
      const key = l.id || ('sin-id:' + (l.nombre || ''));
      const info0 = infoProd[l.id] || { area: 'Otros', idRecetaFen: '', catalogoId: '', tipo: '', recetaId: '', reventaId: '' };
      // La foto de la línea (al vender, caja v2.3.0) manda; si no la tiene (venta anterior), el producto de hoy
      const info = l.catalogoId || l.tipo ? { ...info0, area: l.area ? areaRes(l.area) : info0.area, catalogoId: l.catalogoId || '', tipo: l.tipo || '', recetaId: l.recetaId || '', reventaId: l.reventaId || '', unidadesPorVenta: Number(l.unidadesPorVenta) > 0 ? Number(l.unidadesPorVenta) : info0.unidadesPorVenta } : info0;
      const bruto = parseInt(l.total) || 0, cant = parseFloat(l.cantidad) || 0;
      const pp = r.porProducto[key] || (r.porProducto[key] = { nombre: l.nombre || '', area: info.area, idRecetaFen: info.idRecetaFen, catalogoId: info.catalogoId || '', tipo: info.tipo || '', recetaId: info.recetaId || '', reventaId: info.reventaId || '', ...(info.unidadesPorVenta > 0 ? { unidadesPorVenta: info.unidadesPorVenta } : {}), cantidad: 0, bruto: 0, neto: 0 });
      pp.cantidad += cant; pp.bruto += bruto; pp.neto += neto(bruto);
      const pa = r.porArea[info.area] || (r.porArea[info.area] = { cantidad: 0, bruto: 0, neto: 0 });
      pa.cantidad += cant; pa.bruto += bruto; pa.neto += neto(bruto);
      // Por tipo de leche (la nota del café; caja v2.7.0)
      const leche = String(l.tipoLeche || '').trim();
      if (leche) {
        r.porLeche[leche] = (r.porLeche[leche] || 0) + cant;
        const pl = pp.porLeche || (pp.porLeche = {});
        pl[leche] = (pl[leche] || 0) + cant;
      }
      // Por tarjeta y hora en que se agotó el lote de hoy (caja v2.2.0)
      if (l.tarjeta) {
        const t = (tarj[key] = tarj[key] || {});
        const tt = t[l.tarjeta] || (t[l.tarjeta] = { cant: 0, monto: 0 });
        tt.cant += cant; tt.monto += bruto;
      }
      if (l.agotado && (!agot[key] || l.agotado < agot[key])) agot[key] = l.agotado;
      if (l.reagotado && (!reagot[key] || l.reagotado > reagot[key])) reagot[key] = l.reagotado;
    });
  });
  r.totalNeto = neto(r.totalBruto);
  // porTarjeta suma lo mismo que cantidad y bruto; lo vendido sin tarjeta anotada va a "sinDato"
  Object.keys(tarj).forEach(k => {
    const pp = r.porProducto[k]; if (!pp) return;
    let sc = 0, sm = 0;
    Object.values(tarj[k]).forEach(x => { sc += x.cant; sm += x.monto; });
    const fc = Math.round((pp.cantidad - sc) * 1000) / 1000, fm = pp.bruto - sm;
    if (fc || fm) tarj[k].sinDato = { cant: fc, monto: fm };
    pp.porTarjeta = tarj[k];
  });
  Object.keys(agot).forEach(k => { if (r.porProducto[k]) r.porProducto[k].agotadoHoy = agot[k]; });
  Object.keys(reagot).forEach(k => { if (r.porProducto[k]) r.porProducto[k].reagotadoHoy = reagot[k]; });
  // Las claves de mapas en Firestore no admiten algunos caracteres: el ID de producto ya es seguro; los nombres sin ID se codifican.
  const porProducto = {};
  Object.keys(r.porProducto).forEach(k => { porProducto[k.startsWith('sin-id:') ? 'sin-id-' + encodeURIComponent(k.slice(7)).replace(/[.%]/g, '_') : k] = r.porProducto[k]; });
  r.porProducto = porProducto;
  return r;
}
