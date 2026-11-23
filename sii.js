// ═══════════════════════════════════════════════
//  Sistema Fën — Cargas del SII  v0.10.0
//  Lectura de los archivos del SII y armado de lo que se importa, copiado de la
//  app de Gastos (index.html, "Carga masiva"): mismos formatos, mismas reglas de
//  harina, notas de crédito, detalle de productos y reparto por área.
//  Lo que se guarda pasa por el Apps Script de Gastos (SistemaFen.gs v1.2.0),
//  que vuelve a revisar todo antes de escribir.
//  v0.48.0 (etapa G3): con Gastos en la base nueva (config/gastos: fuente "base"), las llamadas van a fen-gastos
//  (gastos-sii-fs.js) con las mismas respuestas; "Sugerir % según ventas" sigue con el script. Con la planilla, igual que antes.
// ═══════════════════════════════════════════════
import * as Gastos from './gastos.js?v=0.138.0';

export const VERSION_MINIMA = '2.4.0';
// v0.10.0: un documento se reconoce por RUT, folio y si es nota de crédito (tipo 61):
// la nota de crédito de un proveedor puede tener el mismo folio que una de sus facturas.
export const clave = f => `${f.rut}|${f.folio}${String(f.tipoDoc ?? f.tipo) === '61' ? '|61' : ''}`;
const llamar = (op, datos, idem) => Gastos.llamar(op, datos, idem, VERSION_MINIMA);

// ── Lectura de los archivos ────────────────────────
export const TIPO_DOC_LABEL = { '33': 'Factura', '34': 'Factura exenta', '39': 'Boleta', '61': 'Nota de crédito', '56': 'Nota de débito' };

// El SII entrega los nombres con las tildes ya destruidas (llegan como '?'): se limpian.
export function limpiarTextoSII(t) { return String(t || '').replace(/\?/g, '').replace(/\s+/g, ' ').trim(); }

// Cantidades con coma decimal y su unidad (1.146 del SII = 1,146 kg)
export function fmtCantidad(valor, unidad) {
  const v = parseFloat(valor) || 0;
  if (!v) return '';
  const txt = v.toLocaleString('es-CL', { maximumFractionDigits: 3 });
  return unidad ? `${txt} ${unidad}` : txt;
}

// Impuestos adicionales. OJO: el de la harina es el código 19 (no el 23).
export const IMPUESTOS_ADICIONALES = {
  '19': { nombre: 'Harina', tasa: 12, esHarina: true },
  '27': { nombre: 'Bebidas azucaradas', tasa: 10, esHarina: false }
};
export function esImpuestoHarina(codigo, tasa) {
  const info = IMPUESTOS_ADICIONALES[String(codigo || '').trim()];
  if (info) return info.esHarina;
  return Math.round(parseFloat(tasa) || 0) === 12;
}
export function tasaDeImpuesto(codigo, tasaDeclarada) {
  const t = Math.round(parseFloat(tasaDeclarada) || 0);
  if (t) return t;
  const info = IMPUESTOS_ADICIONALES[String(codigo || '').trim()];
  return info ? info.tasa : 0;
}

// Cuál de los tres formatos es, por el contenido (el "xls" del SII en realidad es HTML)
export function detectarFormatoSII(contenido) {
  const cabeza = String(contenido || '').slice(0, 3000);
  if (/<\?xml/i.test(cabeza) || /<(\w+:)?(SetDTE|DTE|Documento)\b/i.test(cabeza)) return 'xml';
  if (/<t[rd]\b/i.test(cabeza)) return 'detalle';
  return 'registro';
}

// yyyy-mm-dd (o dd-mm-yy) → dd/mm/yyyy, como trabaja la carga
export function fechaISOaDDMMYYYY(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = String(str || '').match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}/20${m2[3]}`;
  return String(str || '');
}
// dd/mm/yyyy → yyyy-mm-dd
export function fechaDDMMYYYYaISO(str) {
  const m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

// "Documentos recibidos" (.xls, que es HTML): trae el detalle de productos
export function parseXLSDetalleSII(texto) {
  const limpiarCelda = c => {
    const t = document.createElement('textarea');
    t.innerHTML = c.replace(/<[^>]*>/g, '');
    return t.value.trim();
  };
  const filas = texto.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  const docs = [];
  let actual = null;
  const num = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const dec = v => parseFloat(String(v || '').replace(',', '.')) || 0;
  filas.forEach(fila => {
    const celdas = (fila.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(limpiarCelda);
    if (!celdas.length) return;
    // Cabecera de documento: tipo de DTE en la primera celda y todos los totales
    if (/^(33|34|39|61|56|110|111|112)$/.test(celdas[0]) && celdas.length >= 23) {
      const tipoDoc = celdas[0], esNotaCredito = tipoDoc === '61', signo = esNotaCredito ? -1 : 1;
      actual = {
        idx: docs.length, tipoDoc, tipoLabel: TIPO_DOC_LABEL[tipoDoc] || ('Doc ' + tipoDoc), esNotaCredito,
        rut: celdas[5], razonSocial: limpiarTextoSII(celdas[6]), folio: celdas[1], fecha: fechaISOaDDMMYYYY(celdas[2]),
        neto: num(celdas[19]) * signo, exento: num(celdas[20]) * signo, iva: num(celdas[21]) * signo, total: num(celdas[22]) * signo,
        // El impuesto adicional no viene como columna, pero cuadra: total − neto − exento − IVA
        otroImpuesto: Math.round((num(celdas[22]) - num(celdas[19]) - num(celdas[20]) - num(celdas[21])) * signo),
        tasaOtroImpuesto: 0, codImpuesto: '', esHarina: false,
        fechaVencimiento: '', fechaVencISO: '', formaPagoSII: '', termPago: '',
        dirRecep: celdas[16] || '', comunaRecep: celdas[17] || '', detalle: []
      };
      docs.push(actual);
      return;
    }
    // Línea de detalle: 11 columnas, la segunda es el número de ítem
    if (actual && celdas.length >= 11 && celdas[0] === '' && /^\d+$/.test(celdas[1])) {
      const descripcion = limpiarTextoSII(celdas[4]);
      const monto = num(celdas[10]);
      if (!monto && /referencia/i.test(descripcion)) return; // "Referencia POS": no es un producto
      const cant = dec(celdas[5]);
      actual.detalle.push({
        descripcion, codigo: celdas[3] || '', unidad: '', cantidad: cant,
        // El unitario real sale del monto ya descontado
        precioUnitario: cant ? Math.round(Math.round(monto) / (cant || 1) * 100) / 100 : dec(celdas[6]),
        precioLista: dec(celdas[6]), descuento: num(celdas[8]), codImptoAdic: celdas[9] || '', monto: Math.round(monto)
      });
      const cod = String(celdas[9] || '').trim();
      if (cod) {
        actual.codImpuesto = cod;
        actual.tasaOtroImpuesto = tasaDeImpuesto(cod, 0);
        if (esImpuestoHarina(cod, 0)) actual.esHarina = true;
      }
    }
  });
  return docs.filter(d => d.rut && d.folio);
}

// XML del SII: el más completo (detalle, vencimiento, forma de pago y dirección)
export function parseXMLSII(texto) {
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const hijos = (nodo, etq) => nodo ? Array.from(nodo.getElementsByTagNameNS('*', etq)) : [];
  const txt = (nodo, etq) => { const e = hijos(nodo, etq)[0]; return e ? String(e.textContent).trim() : ''; };
  const num = (nodo, etq) => { const n = parseFloat(String(txt(nodo, etq)).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const salida = [];
  hijos(doc, 'Documento').forEach(d => {
    const tipoDoc = txt(d, 'TipoDTE'), folio = txt(d, 'Folio'), rut = txt(d, 'RUTEmisor');
    if (!folio || !rut) return;
    const esNotaCredito = tipoDoc === '61', signo = esNotaCredito ? -1 : 1;
    let otroImpuesto = 0, codImpuesto = '', tasaImpuesto = 0, esHarina = false;
    hijos(d, 'ImptoReten').forEach(imp => {
      const cod = txt(imp, 'TipoImp'), tasa = parseFloat(txt(imp, 'TasaImp')) || 0;
      otroImpuesto += parseFloat(String(txt(imp, 'MontoImp')).replace(/\./g, '')) || 0;
      if (esImpuestoHarina(cod, tasa)) { esHarina = true; codImpuesto = cod; tasaImpuesto = tasaDeImpuesto(cod, tasa); }
      else if (!codImpuesto) { codImpuesto = cod; tasaImpuesto = tasaDeImpuesto(cod, tasa); }
    });
    const neto = num(d, 'MntNeto'), exento = num(d, 'MntExe'), iva = num(d, 'IVA'), total = num(d, 'MntTotal');
    const fchVenc = txt(d, 'FchVenc');
    const f = {
      idx: salida.length, tipoDoc, tipoLabel: TIPO_DOC_LABEL[tipoDoc] || ('Doc ' + tipoDoc), esNotaCredito,
      rut, razonSocial: limpiarTextoSII(txt(d, 'RznSoc')), folio, fecha: fechaISOaDDMMYYYY(txt(d, 'FchEmis')),
      exento: exento * signo, neto: neto * signo, iva: iva * signo, total: total * signo,
      otroImpuesto: Math.round(otroImpuesto) * signo, tasaOtroImpuesto: tasaImpuesto, codImpuesto, esHarina,
      fechaVencimiento: fchVenc ? fechaISOaDDMMYYYY(fchVenc) : '', fechaVencISO: /^\d{4}-\d{2}-\d{2}$/.test(fchVenc) ? fchVenc : '',
      formaPagoSII: txt(d, 'FmaPago'), termPago: limpiarTextoSII(txt(d, 'TermPagoGlosa')),
      // v0.92.3 · N° de cliente del receptor (CdgIntRecep: con eso se distinguen los servicios de un mismo proveedor) y período facturado
      cdgIntRecep: limpiarTextoSII(txt(d, 'CdgIntRecep')).slice(0, 40), periodoDesde: txt(d, 'PeriodoDesde'), periodoHasta: txt(d, 'PeriodoHasta'),
      dirRecep: limpiarTextoSII(txt(d, 'DirRecep')), comunaRecep: limpiarTextoSII(txt(d, 'CmnaRecep')), detalle: []
    };
    // v0.67.4 · Referencias (una nota de crédito dice qué factura corrige): tipo y folio del documento citado
    const refs = hijos(d, 'Referencia').map(r => ({ tipo: txt(r, 'TpoDocRef'), folio: txt(r, 'FolioRef').replace(/^0+/, ''), fecha: txt(r, 'FchRef') }))
      .filter(r => r.folio && /^(30|32|33|34|46|56|61)$/.test(r.tipo)).slice(0, 5);
    if (refs.length) f.referencias = refs;
    // Cada documento debe cuadrar consigo mismo: neto + exento + IVA + adicionales = total
    const suma = Math.round(neto + exento + iva + otroImpuesto);
    if (total && Math.abs(suma - Math.round(total)) > 1) f.descuadre = `Los montos no cuadran: ${suma.toLocaleString('es-CL')} declarado contra ${Math.round(total).toLocaleString('es-CL')}`;
    hijos(d, 'Detalle').forEach(det => {
      const descripcion = limpiarTextoSII(txt(det, 'NmbItem') || txt(det, 'DscItem'));
      const monto = parseFloat(String(txt(det, 'MontoItem')).replace(/\./g, '')) || 0;
      if (!monto && /referencia/i.test(descripcion)) return;
      const codLinea = txt(det, 'CodImpAdic');
      if (codLinea && esImpuestoHarina(codLinea, 0)) f.esHarina = true;
      const cantidad = parseFloat(String(txt(det, 'QtyItem')).replace(',', '.')) || 0;
      const precioLista = parseFloat(String(txt(det, 'PrcItem')).replace(',', '.')) || 0;
      f.detalle.push({
        descripcion, codigo: txt(det, 'VlrCodigo') || '', unidad: limpiarTextoSII(txt(det, 'UnmdItem')), cantidad,
        precioUnitario: cantidad ? Math.round(monto / cantidad * 100) / 100 : precioLista, precioLista,
        descuento: parseFloat(String(txt(det, 'DescuentoMonto')).replace(/\./g, '')) || 0, codImptoAdic: codLinea, monto: Math.round(monto)
      });
    });
    salida.push(f);
  });
  return salida;
}

// Registro de Compras (.csv, separado por ";"): mes completo, sin detalle
export function parseCSVSII(texto) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) return [];
  const headers = lineas[0].split(';').map(h => h.trim());
  const idx = nombre => headers.findIndex(h => h.toLowerCase().replace(/[^a-z]/g, '') === nombre.toLowerCase().replace(/[^a-z]/g, ''));
  const iTipo = idx('Tipo Doc'), iRut = idx('RUT Proveedor'), iRazon = idx('Razon Social'), iFolio = idx('Folio'), iFecha = idx('Fecha Docto'),
    iExento = idx('Monto Exento'), iNeto = idx('Monto Neto'), iIva = idx('Monto IVA Recuperable'), iTotal = idx('Monto Total'),
    iOtroValor = idx('Valor Otro Impuesto'), iOtraTasa = idx('Tasa Otro Impuesto'), iOtroCod = idx('Codigo Otro Impuesto');
  const num = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  return lineas.slice(1).map((linea, i) => {
    const c = linea.split(';');
    const tipoDoc = String(c[iTipo] || '').trim(), esNotaCredito = tipoDoc === '61', signo = esNotaCredito ? -1 : 1;
    const tasaOtro = num(c[iOtraTasa]);
    return {
      idx: i, tipoDoc, tipoLabel: TIPO_DOC_LABEL[tipoDoc] || ('Doc ' + tipoDoc), esNotaCredito,
      rut: String(c[iRut] || '').trim(), razonSocial: String(c[iRazon] || '').trim(), folio: String(c[iFolio] || '').trim(),
      fecha: String(c[iFecha] || '').trim(),
      exento: num(c[iExento]) * signo, neto: num(c[iNeto]) * signo, iva: num(c[iIva]) * signo, total: num(c[iTotal]) * signo,
      otroImpuesto: num(c[iOtroValor]) * signo, tasaOtroImpuesto: tasaDeImpuesto(c[iOtroCod], tasaOtro),
      codImpuesto: String(c[iOtroCod] || '').trim(), esHarina: esImpuestoHarina(c[iOtroCod], tasaOtro),
      fechaVencimiento: '', fechaVencISO: '', formaPagoSII: '', termPago: '', dirRecep: '', comunaRecep: ''
    };
  }).filter(f => f.rut && f.folio);
}

// v0.81.6 · Las guías de despacho (DTE 52, y 50 en papel) no son compras: la que cuenta es su factura (la guía solo acompaña
// el despacho y a veces cita la factura). Vienen en el mismo lote XML: se dejan fuera y se avisa cuáles.
export const TIPOS_NO_COMPRA = { '50': 'Guía de despacho', '52': 'Guía de despacho electrónica' };
export function leer(contenido) {
  const formato = detectarFormatoSII(contenido);
  const todas = formato === 'xml' ? parseXMLSII(contenido) : formato === 'detalle' ? parseXLSDetalleSII(contenido) : parseCSVSII(contenido);
  const omitidas = todas.filter(f => TIPOS_NO_COMPRA[String(f.tipoDoc || '').trim()]);
  const facturas = todas.filter(f => !TIPOS_NO_COMPRA[String(f.tipoDoc || '').trim()]).map((f, i) => ({ ...f, idx: i }));
  return { formato, facturas, omitidas: omitidas.map(f => ({ tipoDoc: f.tipoDoc, tipo: TIPOS_NO_COMPRA[f.tipoDoc], folio: f.folio, rut: f.rut, razonSocial: f.razonSocial, total: Math.abs(f.total), referencias: f.referencias || [] })) };
}
// "Se dejaron fuera 1 guía de despacho (no son compras: cuenta su factura): F.279623 de PIZARRO (de la F.992502)"
export function textoOmitidas(om) {
  if (!om || !om.length) return '';
  const l = om.slice(0, 6).map(g => `N° ${g.folio} de ${g.razonSocial || g.rut}${g.referencias.length ? ` (de la F.${g.referencias.map(r => r.folio).join(', F.')})` : ''}`).join(' · ');
  return `Se dejaron fuera ${om.length} ${om.length === 1 ? 'guía de despacho' : 'guías de despacho'}: no son compras (la que cuenta es su factura). ${l}${om.length > 6 ? ` y ${om.length - 6} más` : ''}.`;
}

// Con fecha de vencimiento posterior a la emisión (o forma de pago 2 = crédito) se precarga
// "pendiente". Nunca se da por pagado algo solo: eso lo decide el usuario.
export function precargarVencimientos(lista) {
  let n = 0;
  (lista || []).forEach(f => {
    if (f.yaImportada || f.esNotaCredito || f.estado) return;
    const emisISO = fechaDDMMYYYYaISO(f.fecha);
    const aCredito = (f.fechaVencISO && emisISO && f.fechaVencISO > emisISO) || f.formaPagoSII === '2';
    if (!aCredito) return;
    f.estado = 'pendiente'; f.fechaEstado = f.fechaVencISO || ''; n++;
  });
  return n;
}

// ── Clasificación ──────────────────────────────────
const necesitaAreas = it => !!it && (it.area === 'SELECCIONAR' || it.area === 'PRORRATEADO');
export { necesitaAreas };

// Los montos del detalle vienen netos: se escalan a bruto según el total real
export function factorBruto(f) {
  const suma = (f.detalle || []).reduce((s, d) => s + Math.abs(d.monto), 0);
  return suma > 0 ? Math.abs(f.total) / suma : 1;
}

// Con detalle: agrupa los productos por ítem y arma las líneas; si los productos traen área,
// el reparto por área también sale solo. Los redondeos se absorben en la última área/ítem.
export function sincronizarLineasDesdeDetalle(f, ITEMS) {
  const factor = factorBruto(f), porItem = {};
  (f.detalle || []).forEach(d => {
    if (!d.item) return;
    if (!porItem[d.item]) porItem[d.item] = { monto: 0, areas: {} };
    const bruto = Math.abs(d.monto) * factor;
    porItem[d.item].monto += bruto;
    if (d.area) porItem[d.item].areas[d.area] = (porItem[d.item].areas[d.area] || 0) + bruto;
  });
  const previas = f.lineas || [];
  f.lineas = Object.keys(porItem).map(item => {
    const g = porItem[item], anterior = previas.find(l => l.item === item) || {};
    const desdeProductos = Object.keys(g.areas).map(a => ({ area: a, valor: Math.round(g.areas[a]) }));
    const it = ITEMS.find(x => x.item === item);
    if (desdeProductos.length) {
      const montoItem = Math.round(g.monto), suma = desdeProductos.reduce((s, a) => s + a.valor, 0);
      desdeProductos[desdeProductos.length - 1].valor += (montoItem - suma);
    }
    return { item, monto: Math.round(g.monto), areas: desdeProductos.length ? desdeProductos : (anterior.areas || []),
      // Las áreas calculadas desde los productos son montos en pesos, nunca porcentajes
      areasAuto: desdeProductos.length > 0, modoArea: desdeProductos.length ? 'monto' : (anterior.modoArea || (it && it.area === 'PRORRATEADO' ? 'pct' : 'monto')) };
  });
  if (f.lineas.length) {
    const dif = Math.abs(f.total) - f.lineas.reduce((s, l) => s + l.monto, 0);
    if (dif !== 0) {
      const ultima = f.lineas[f.lineas.length - 1];
      ultima.monto += dif;
      if (ultima.areasAuto && ultima.areas.length) ultima.areas[ultima.areas.length - 1].valor += dif;
    }
  }
  if (!f.lineas.length) f.lineas = [{ item: '', areas: [], modoArea: 'monto' }];
}

// Base que se reparte por área: el monto de la línea si la factura está dividida o tiene detalle;
// si es de un solo ítem, el total del documento.
export function baseLinea(f, li) {
  const ln = f.lineas[li];
  if ((f.detalle && f.detalle.length) || f.lineas.length > 1) return parseFloat(ln.monto) || 0;
  return Math.abs(f.total);
}

// Al dividir: la primera línea toma el total y la nueva lo que falta
export function dividir(f) {
  const total = Math.abs(f.total);
  if (f.lineas.length === 1 && !f.lineas[0].monto) f.lineas[0].monto = total;
  const restante = total - f.lineas.reduce((s, ln) => s + (parseFloat(ln.monto) || 0), 0);
  f.lineas.push({ item: '', areas: [], modoArea: 'monto', monto: restante > 0 ? Math.round(restante) : '' });
}

// Agrega un área precargada con lo que falta por repartir
export function agregarArea(f, li) {
  const ln = f.lineas[li];
  if (!ln.areas) ln.areas = [];
  const modo = ln.modoArea || 'monto';
  const ya = ln.areas.reduce((s, a) => s + (parseFloat(a.valor) || 0), 0);
  const restante = modo === 'pct' ? 100 - ya : baseLinea(f, li) - ya;
  ln.areas.push({ area: '', valor: restante > 0 ? Math.round(restante) : '' });
}

// Deja cada línea lista para dibujar: ítems con áreas a repartir tienen al menos una fila
export function prepararLineas(f, ITEMS) {
  if (f.yaImportada) return;
  if (!f.lineas || !f.lineas.length) f.lineas = [{ item: '', areas: [], modoArea: 'monto' }];
  f.lineas.forEach((ln, li) => {
    if (ln.areasAuto || !ln.item) return;
    const it = ITEMS.find(x => x.item === ln.item);
    if (necesitaAreas(it) && (!ln.areas || !ln.areas.length)) agregarArea(f, li);
  });
  if (f.esNotaCredito) { f.estado = 'pagada'; if (!f.fechaEstado) f.fechaEstado = fechaDDMMYYYYaISO(f.fecha); }
}

// Pagada sugiere la fecha del documento; pendiente, el vencimiento del XML.
// Una fecha escrita a mano no se pisa.
export function ponerEstado(f, estado) {
  if (f.yaImportada || f.esNotaCredito) return;
  f.estado = estado; f.estadoSugerido = false;
  const sugPagada = fechaDDMMYYYYaISO(f.fecha), sugPendiente = f.fechaVencISO || '';
  if (!f.fechaEstado || f.fechaEstado === sugPagada || f.fechaEstado === sugPendiente) f.fechaEstado = estado === 'pagada' ? sugPagada : sugPendiente;
}

// Estado del reparto de una línea: { ok, texto } para mostrar bajo las áreas
export function revisarAreas(f, li) {
  const ln = f.lineas[li], modo = ln.modoArea || 'monto';
  const areas = (ln.areas || []).filter(a => a.area && a.valor > 0);
  if (!areas.length) return { ok: false, texto: '' };
  const suma = areas.reduce((s, a) => s + Number(a.valor), 0);
  if (modo === 'pct') { const ok = Math.abs(suma - 100) < 0.01; return { ok, texto: ok ? '100% repartido' : `Suma ${suma}% (debe ser 100%)` }; }
  const dif = baseLinea(f, li) - suma, ok = Math.abs(dif) < 1;
  return { ok, texto: ok ? 'Cuadra' : `Suma $${Math.round(suma).toLocaleString('es-CL')} · ${dif > 0 ? 'faltan' : 'sobran'} $${Math.round(Math.abs(dif)).toLocaleString('es-CL')}` };
}
// Cuando la factura está dividida a mano: los ítems deben sumar el total
export function revisarTotal(f) {
  if (f.lineas.length <= 1 || (f.detalle && f.detalle.length)) return null;
  const suma = f.lineas.reduce((s, ln) => s + (parseFloat(ln.monto) || 0), 0), total = Math.abs(f.total), dif = total - suma, ok = Math.abs(dif) < 1;
  return { ok, texto: ok ? `Los ítems suman el total ($${Math.round(total).toLocaleString('es-CL')})` : `Ítems suman $${Math.round(suma).toLocaleString('es-CL')} de $${Math.round(total).toLocaleString('es-CL')} · ${dif > 0 ? 'faltan' : 'sobran'} $${Math.round(Math.abs(dif)).toLocaleString('es-CL')}` };
}

// Convierte lo clasificado al formato que espera Gastos (porcentajes ya resueltos a montos).
// Las facturas sin clasificar se omiten en silencio, como en la app.
export function prepararParaImportar(facturas, ITEMS) {
  const listas = [], problemas = [];
  facturas.forEach(f => {
    if (f.yaImportada) return;
    // v0.50.0 (base nueva): factura de un proveedor que es el RUT de una obligación "según documento": va a su vencimiento, sin clasificar
    if (f.aVencimiento && !f.esNotaCredito && f.total > 0) {
      listas.push({ rut: f.rut, razonSocial: f.razonSocial, folio: f.folio, tipoDoc: f.tipoDoc || '33', fechaDocto: f.fecha.replace(/\//g, '-'), total: f.total, neto: f.neto, iva: f.iva, exento: f.exento || 0, otroImpuesto: f.otroImpuesto || 0, esHarina: !!f.esHarina,
        aVencimiento: true, fechaVencimiento: f.fechaVencISO || '', detalle: (f.detalle || []).map(d => ({ descripcion: d.descripcion, codigo: d.codigo, unidad: d.unidad || '', cantidad: d.cantidad, precioUnitario: d.precioUnitario,
          precioLista: d.precioLista || '', descuento: d.descuento || '', monto: d.monto, item: d.item || '', area: d.area || '' })) });
      return;
    }
    const validas = (f.lineas || []).filter(ln => ln.item);
    if (!validas.length) return;
    const et = `${f.razonSocial} F.${f.folio}`;
    if (!f.esNotaCredito && !f.estado) { problemas.push(`${et}: falta marcar pagada o pendiente`); return; }
    if (!f.fechaEstado) { problemas.push(`${et}: falta la fecha`); return; }
    const totalAbs = Math.abs(f.total), signo = f.total < 0 ? -1 : 1;
    if (f.detalle && f.detalle.length) {
      const sinItem = f.detalle.filter(d => !d.item).length;
      if (sinItem) { problemas.push(`${et}: ${sinItem} producto(s) sin asignar a un ítem`); return; }
      const sinArea = f.detalle.filter(d => { const it = ITEMS.find(x => x.item === d.item); return it && it.area === 'SELECCIONAR' && !d.area; }).length;
      if (sinArea) { problemas.push(`${et}: ${sinArea} producto(s) sin área asignada`); return; }
    } else if (validas.length > 1) {
      const suma = validas.reduce((s, ln) => s + (parseFloat(ln.monto) || 0), 0);
      if (Math.abs(suma - totalAbs) >= 1) { problemas.push(`${et}: los ítems suman $${Math.round(suma).toLocaleString('es-CL')} y el total es $${Math.round(totalAbs).toLocaleString('es-CL')}`); return; }
    }
    const lineas = [];
    let error = false;
    validas.forEach(ln => {
      if (error) return;
      const it = ITEMS.find(x => x.item === ln.item) || {};
      const base = validas.length > 1 || (f.detalle && f.detalle.length) ? (parseFloat(ln.monto) || 0) : totalAbs;
      let areas;
      if (necesitaAreas(it)) {
        const v = (ln.areas || []).filter(a => a.area && a.valor > 0);
        if (!v.length) { problemas.push(`${et} (${ln.item}): falta repartir por área`); error = true; return; }
        const suma = v.reduce((s, a) => s + Number(a.valor), 0);
        if (new Set(v.map(a => a.area)).size !== v.length) { problemas.push(`${et} (${ln.item}): cada área una sola vez`); error = true; return; }
        if ((ln.modoArea || 'monto') === 'pct') {
          if (Math.abs(suma - 100) >= 0.01) { problemas.push(`${et} (${ln.item}): los porcentajes suman ${suma}%, deben sumar 100%`); error = true; return; }
          areas = v.map(a => ({ area: a.area, monto: Math.round(base * a.valor / 100) * signo }));
        } else {
          if (Math.abs(suma - base) >= 1) { problemas.push(`${et} (${ln.item}): las áreas suman $${Math.round(suma).toLocaleString('es-CL')} y debe ser $${Math.round(base).toLocaleString('es-CL')}`); error = true; return; }
          areas = v.map(a => ({ area: a.area, monto: Math.round(a.valor) * signo }));
        }
      } else areas = [{ area: it.area || '', monto: Math.round(base) * signo }];
      lineas.push({ item: ln.item, categoria: it.categoria || '', tipo: it.tipo || '', subTipo: it.subTipo || '', areas });
    });
    if (error) return;
    listas.push({
      rut: f.rut, razonSocial: f.razonSocial, folio: f.folio, tipoDoc: f.tipoDoc || (f.total < 0 ? '61' : '33'),
      fechaDocto: f.fecha.replace(/\//g, '-'), // dd-mm-yyyy, como guarda la app
      total: f.total, neto: f.neto, iva: f.iva, esHarina: !!f.esHarina,
      estado: f.esNotaCredito ? 'pagada' : f.estado, fechaEstado: f.fechaEstado, lineas,
      detalle: (f.detalle || []).map(d => ({ descripcion: d.descripcion, codigo: d.codigo, unidad: d.unidad || '', cantidad: d.cantidad, precioUnitario: d.precioUnitario,
        precioLista: d.precioLista || '', descuento: d.descuento || '', monto: d.monto * signo, item: d.item || '', area: d.area || '' }))
    });
  });
  return { listas, problemas };
}

// ── Historial ──────────────────────────────────────
// Sin acentos, puntos ni guiones: "76.285.613-1" y "762856131" encuentran al mismo proveedor
export const normalizarBusqueda = t => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.\-\s]/g, '');
export function buscarEnHistorial(cargas, texto) {
  const q = normalizarBusqueda(texto);
  if (!q) return [];
  const salida = [];
  cargas.forEach(carga => (carga.documentos || []).forEach(d => {
    if (normalizarBusqueda([d.folio, d.rut, d.razonSocial].join(' ')).includes(q)) salida.push({ doc: d, carga });
  }));
  return salida;
}
export function formatoDeArchivo(nombre) {
  const ext = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  switch (ext && ext[1]) {
    case 'xml': return { etiqueta: 'XML', nota: 'detalle y vencimiento', color: 'c-azul' };
    case 'xls': case 'xlsx': return { etiqueta: 'XLS', nota: 'detalle, sin vencimiento', color: 'c-amarillo' };
    case 'csv': return { etiqueta: 'CSV', nota: 'mes completo, sin detalle', color: 'c-gris' };
    default: return { etiqueta: 'Archivo', nota: '', color: 'c-gris' };
  }
}

// ── Llamadas al Apps Script de Gastos ──────────────
const base64Utf8 = texto => { const b = new TextEncoder().encode(texto); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const docsDe = facturas => facturas.map(f => ({ rut: f.rut, folio: f.folio, tipo: f.tipoDoc === '61' ? '61' : '', total: f.total, fecha: fechaDDMMYYYYaISO(f.fecha), razonSocial: f.razonSocial }));

// v0.48.0 · Con la base nueva, lo mismo en fen-gastos (gastos-sii-fs.js)
const fsSii = () => import('./gastos-sii-fs.js?v=0.138.0');
const enBase = () => Gastos.enBase();
export async function estado(facturas) { return (await enBase()) ? (await fsSii()).estado(docsDe(facturas)) : llamar('sii_estado', { documentos: docsDe(facturas) }); }
export async function registrarCarga(facturas, nombre, tipo, contenido, idem) {
  const p = { nombreArchivo: nombre, mimeType: tipo || 'text/plain', archivoBase64: base64Utf8(contenido), documentos: docsDe(facturas) };
  return (await enBase()) ? (await fsSii()).registrarCarga(p, Gastos.subidor(idem)) : llamar('sii_carga', p, idem);
}
export async function cargas() { return (await enBase()) ? (await fsSii()).cargas() : llamar('sii_cargas'); }
export async function archivo(id) { return (await enBase()) ? (await fsSii()).archivo(id, Gastos.leerArchivoSii) : llamar('sii_archivo', { id }); }
export async function detalle(rut, folio, tipo) { return (await enBase()) ? (await fsSii()).detalle(rut, folio, tipo) : llamar('sii_detalle', { rut, folio, ...(tipo !== undefined ? { tipo } : {}) }); }
let ventasCache = null;
export async function ventas() { if (!ventasCache || Date.now() - ventasCache.t > 600000) ventasCache = { t: Date.now(), d: await llamar('sii_ventas') }; return ventasCache.d; }
// v0.63.1: origen = { formato ('xml' | 'detalle' | 'registro'), archivo, cargaId } del archivo abierto: queda en cada gasto (origenDetalle)
export async function importar(listas, omitirRepetidas, idem, origen) {
  if (await enBase()) {
    const r = await (await fsSii()).importar(listas, !!omitirRepetidas, await Gastos.marcaDe(idem), origen || null); Gastos.olvidarTodo();
    // v0.57.0 · Finanzas: con lo importado ya guardado, revisa los precios de las materias primas (sin esperar; si falla, solo avisa)
    r.precios = import('./finanzas.js?v=0.138.0').then(F => F.preciosTrasImportar()).catch(e => ({ error: e.message || String(e) }));
    return r;
  }
  const r = await llamar('sii_importar', { facturas: listas, omitirRepetidas: !!omitirRepetidas }, idem); Gastos.olvidar(); return r;
}
export async function vincular(f, c, idem) {
  const p = { rut: f.rut, folio: f.folio, tipo: f.tipoDoc === '61' ? '61' : '', razonSocial: f.razonSocial, filas: c.filas, fecha: c.fecha, total: c.total };
  if (await enBase()) { const r = await (await fsSii()).vincular(p); Gastos.olvidarTodo(); return r; }
  return llamar('sii_vincular', p, idem);
}
export async function notaDoc(f, nota) {
  const p = { rut: f.rut, folio: f.folio, tipo: f.tipoDoc === '61' ? '61' : '', razonSocial: f.razonSocial, nota };
  return (await enBase()) ? (await fsSii()).notaDoc(p) : llamar('sii_nota_doc', p);
}
export async function notaCarga(id, nota) { return (await enBase()) ? (await fsSii()).notaCarga(id, nota) : llamar('sii_nota_carga', { id, nota }); }
export async function quitarCarga(id) { return (await enBase()) ? (await fsSii()).quitarCarga(id) : llamar('sii_quitar_carga', { id }); }

// ── v0.17.0 · Sugerencias: cómo clasificaste antes a ese proveedor y a ese producto (script de Gastos v2.7.0) ──
export const VERSION_CLASIF = '2.7.0';
let clasifCache = null;
export async function clasificacion() {
  if (!clasifCache || Date.now() - clasifCache.t > 600000) clasifCache = { t: Date.now(), d: (await enBase()) ? await (await fsSii()).clasif() : await Gastos.llamar('sii_clasif', {}, null, VERSION_CLASIF) };
  return clasifCache.d;
}
export const olvidarClasificacion = () => { clasifCache = null; };
const rutClave = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '');
const descClave = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
// Deja cada documento nuevo con lo sugerido (marcado, para revisar). No toca lo que ya tiene ítem.
// v0.30.0 · Proveedores a los que les postergas el pago (sin crédito formal en la factura): si su documento más
// reciente quedó "pendiente" en Gastos, este se sugiere "Pendiente" (sin fecha: la eliges tú). Nunca se marca pagada sola.
export function sugerirPendientes(facturas, clasif) {
  let n = 0;
  (facturas || []).forEach(f => {
    if (f.yaImportada || f.esNotaCredito || f.estado) return;
    const prov = clasif && (clasif.porRut || {})[rutClave(f.rut)];
    if (!prov || !/prove/i.test(String(prov.forma || ''))) return;
    f.estado = 'pendiente'; f.fechaEstado = ''; f.estadoSugerido = true; n++;
  });
  return n;
}
export function sugerir(facturas, clasif, ITEMS, AREAS) {
  if (!clasif) return 0;
  const activo = item => ITEMS.find(x => x.item === item), areaOk = a => AREAS.includes(a);
  let n = 0;
  facturas.forEach(f => {
    if (f.yaImportada || f.esNotaCredito) return;
    const rut = rutClave(f.rut), prov = (clasif.porRut || {})[rut], top = prov && prov.patrones && prov.patrones.find(p => p.lineas.every(l => activo(l.item)));
    if (f.detalle && f.detalle.length) {
      let sug = 0;
      f.detalle.forEach(d => {
        if (d.item) return;
        const p = (d.codigo && clasif.productos[rut + '|c:' + descClave(d.codigo)]) || clasif.productos[rut + '|d:' + descClave(d.descripcion)];
        let item = '', area = '', motivo = null;
        if (p && activo(p[0])) { item = p[0]; area = p[1]; motivo = { producto: true, n: p[2], de: p[3] }; }
        else if (top && top.lineas.length === 1) { const l = top.lineas[0]; item = l.item; area = l.areas.length === 1 ? l.areas[0].area : ''; motivo = { producto: false, n: top.n, de: prov.docs }; }
        if (!item) return;
        const it = activo(item);
        d.item = item; d.area = it.area === 'SELECCIONAR' && areaOk(area) ? area : ''; d.sugerido = motivo; sug++;
      });
      if (sug) { sincronizarLineasDesdeDetalle(f, ITEMS); f.sugerido = { productos: sug, de: f.detalle.length }; n++; }
      return;
    }
    if (!top || (f.lineas && (f.lineas.length > 1 || (f.lineas[0] && f.lineas[0].item)))) return;
    const total = Math.abs(f.total), lineas = top.lineas.map(l => {
      const it = activo(l.item), areas = l.areas.filter(a => areaOk(a.area));
      const ln = { item: l.item, areas: [], modoArea: 'monto' };
      if (top.lineas.length > 1) ln.monto = Math.round(total * l.parte);
      if (necesitaAreas(it) && areas.length) {
        ln.modoArea = 'pct'; ln.areas = areas.map(a => ({ area: a.area, valor: a.pct }));
        const suma = ln.areas.reduce((s, a) => s + a.valor, 0); ln.areas[ln.areas.length - 1].valor += 100 - suma;
      }
      return ln;
    });
    if (lineas.length > 1) { const suma = lineas.reduce((s, l) => s + l.monto, 0); lineas[lineas.length - 1].monto += total - suma; }
    f.lineas = lineas;
    f.sugerido = { n: top.n, de: prov.docs, ultima: top.ultima };
    n++;
  });
  return n;
}
