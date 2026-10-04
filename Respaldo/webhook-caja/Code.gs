// ═══════════════════════════════════════════════════════════════
// WEBHOOK — Sistema B2C Fën → Google Sheets · Code.gs v2.1.0 (2026-10-04)
// v2.1.0: un cierre que ya está en "Cajas" (mismo ID de caja) no se vuelve a
// escribir. Así la caja puede reintentar o reenviar sin duplicar filas.
// v2.0.0: las llamadas entran por Seguridad.gs, que exige la sesión de
// Firebase de la caja. Las funciones de prueba del final (test...) ya no
// pasan por doPost: llaman directo a las funciones.
// Spreadsheet ID: 1F8jK8Z4LTpDHXlx3q2E-f8rngCljx4mObdWgwuunuMY
// ═══════════════════════════════════════════════════════════════
// RESTAURADO desde el historial de versiones (versión del 1 de julio).
// Este es el script ORIGINAL de caja/merma/anulaciones — pégalo tal cual
// en el proyecto de la URL que termina en ...WEkYD92dU-fddv1A/exec,
// reemplazando lo que haya ahí ahora. Después: "Implementar" →
// "Gestionar implementaciones" → lápiz → "Nueva versión" → Implementar.

const SPREADSHEET_ID = '1F8jK8Z4LTpDHXlx3q2E-f8rngCljx4mObdWgwuunuMY';
const EMAIL_ADMIN = 'emmanuel.vepal@gmail.com';

const HEADERS_VENTAS = [
  'Fecha', 'N° Venta', 'Producto', 'Cantidad', 'Precio Unit.',
  'Tipo Desc.', 'Desc.', 'Bruto Línea', 'Neto Línea', 'IVA Línea',
  'Medio Pago', 'Usuario', 'Turno'
];

const HEADERS_CAJAS = [
  'Fecha', 'Sucursal', 'Usuario', 'Apertura', 'Cierre',
  'Monto Inicial', 'Total Efectivo', 'Total Débito', 'Total Crédito',
  'Total Transfer.', 'Total Ventas', 'N° Ventas', 'ID Caja'
];

const HEADERS_MERMA = [
  'Fecha Merma', 'Sucursal', 'Producto', 'Cantidad',
  'Precio Original', 'Monto Pérdida', 'Fecha Ingreso'
];

// ───────────────────────────────────────────
// v2.0.0: antes era doPost. Ahora doPost vive en Seguridad.gs, que revisa
// la sesión de Firebase de quien llama (cajera o admin) y recién entonces
// llama a esta función con los datos ya leídos.
function ejecutarAccionLegada(payload) {
  try {

    // Notificación de solicitud de anulación → solo correo, no Sheets
    if (payload.tipo === 'solicitud_anulacion') {
      return notificarSolicitudAnulacion(payload);
    }

    // Registro de merma → pestaña "Merma" (más reciente arriba)
    if (payload.tipo === 'merma') {
      return registrarMermaSheets(payload);
    }

    // Flujo normal: exportación de ventas/caja a Sheets
    const { sucursal, filas, filaCaja } = payload;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // v2.1.0: si este cierre ya fue escrito antes (su ID de caja está en "Cajas"),
    // se responde OK sin escribir nada: el reintento no duplica ventas ni cajas.
    if (filaCaja && filaCaja.cajaId && cajaYaExportada(ss, String(filaCaja.cajaId))) {
      return respuesta({ ok: true, filas: 0, yaExistia: true });
    }

    // 1. Ventas → pestaña de la sucursal (más reciente arriba)
    const tabNombre = sucursal === 'ainavillo' ? 'Ainavillo' : 'Barros Arana';
    const sheetVentas = obtenerOCrearPestana(ss, tabNombre, HEADERS_VENTAS);

    // v2.1.0: si un intento anterior alcanzó a escribir las ventas pero no la fila de
    // "Cajas", las ventas no se vuelven a escribir (se busca la primera N° Venta del cierre).
    const ventasYaEstan = filas && filas.length > 0 && ventasYaEscritas(sheetVentas, filas);
    if (filas && filas.length > 0 && !ventasYaEstan) {
      const filasArray = filas.map(f => [
        f.fecha, f.nVenta, f.producto, f.cantidad, f.precioUnit,
        f.tipoDesc || '-', f.descuento || 0,
        f.brutoLinea, f.netoLinea, f.ivaLinea,
        f.medioPago, f.usuario, f.turno
      ]);
      // Insertar filas después de la cabecera → más reciente en fila 2
      sheetVentas.insertRowsAfter(1, filasArray.length);
      sheetVentas.getRange(2, 1, filasArray.length, HEADERS_VENTAS.length)
        .setValues(filasArray);
    }

    // 2. Caja → pestaña "Cajas" (más reciente arriba)
    if (filaCaja) {
      const sheetCajas = obtenerOCrearPestana(ss, 'Cajas', HEADERS_CAJAS);
      sheetCajas.insertRowAfter(1);
      sheetCajas.getRange(2, 1, 1, HEADERS_CAJAS.length).setValues([[
        filaCaja.fecha, filaCaja.sucursal, filaCaja.usuario,
        filaCaja.apertura, filaCaja.cierre, filaCaja.montoInicial,
        filaCaja.totalEfectivo, filaCaja.totalDebito, filaCaja.totalCredito,
        filaCaja.totalTransfer, filaCaja.totalVentas, filaCaja.nVentas,
        filaCaja.cajaId
      ]]);
    }

    return respuesta({ ok: true, filas: filas ? filas.length : 0 });

  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

// v2.1.0: ¿ya están las ventas de este cierre? Busca su primer N° Venta (ID único de la venta).
function ventasYaEscritas(sheet, filas) {
  const n = String(filas[0].nVenta || '');
  if (!n || sheet.getLastRow() < 2) return false;
  const col = HEADERS_VENTAS.indexOf('N° Venta') + 1;
  return !!sheet.getRange(2, col, sheet.getLastRow() - 1, 1).createTextFinder(n).matchEntireCell(true).findNext();
}

// v2.1.0: busca el ID de caja en la columna "ID Caja" de la pestaña "Cajas".
function cajaYaExportada(ss, cajaId) {
  const sheet = ss.getSheetByName('Cajas');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const col = HEADERS_CAJAS.indexOf('ID Caja') + 1;
  const encontrado = sheet.getRange(2, col, sheet.getLastRow() - 1, 1)
    .createTextFinder(cajaId).matchEntireCell(true).findNext();
  return !!encontrado;
}

// ───────────────────────────────────────────
// Devuelve la pestaña; si no existe la crea con cabeceras.
// Si existe pero no tiene cabeceras, las agrega.
function obtenerOCrearPestana(ss, nombre, headers) {
  let sheet = ss.getSheetByName(nombre);

  if (!sheet) {
    // Crear pestaña nueva con cabeceras
    sheet = ss.insertSheet(nombre);
    formatearCabeceras(sheet, headers);
  } else {
    // Verificar si ya tiene cabeceras en fila 1
    const primeraFila = sheet.getRange(1, 1).getValue();
    if (!primeraFila || primeraFila.toString().trim() === '') {
      if (sheet.getLastRow() > 0) {
        // Hay datos sin cabecera → insertar fila 1 vacía y poner cabeceras
        sheet.insertRowBefore(1);
      }
      formatearCabeceras(sheet, headers);
    }
  }
  return sheet;
}

function formatearCabeceras(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold');
  range.setBackground('#003a79');
  range.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

// v2.0.0: devuelve el objeto; Seguridad.gs lo convierte en la respuesta JSON.
function respuesta(obj) {
  return obj;
}

// ───────────────────────────────────────────
// Registra una merma en la pestaña "Merma" del Spreadsheet.
// Se llama cuando el admin confirma la merma desde el sistema.
// Una sola pestaña para ambas sucursales — la columna "Sucursal" permite
// filtrar en Looker Studio.
function registrarMermaSheets(payload) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = obtenerOCrearPestana(ss, 'Merma', HEADERS_MERMA);
    const sucursalNombre = payload.sucursal === 'ainavillo' ? 'Ainavillo' : 'Barros Arana';
    sheet.insertRowAfter(1);
    sheet.getRange(2, 1, 1, HEADERS_MERMA.length).setValues([[
      payload.fechaMerma    || '',
      sucursalNombre,
      payload.producto      || '',
      payload.cantidad      || 0,
      payload.precioOriginal|| 0,
      payload.monto         || 0,
      payload.fechaIngreso  || ''
    ]]);
    return respuesta({ ok: true });
  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

// ───────────────────────────────────────────
// Envía un correo de NOTIFICACIÓN al admin cuando un cajero solicita anular
// una venta. Esto es solo un aviso — la aprobación real se hace dentro del
// sistema (sección Reportes → Solicitudes), no haciendo clic en el correo.
function notificarSolicitudAnulacion(payload) {
  try {
    const sucursalNombre = payload.sucursal === 'ainavillo' ? 'Ainavillo' : 'Barros Arana';
    const asunto = `🔔 Solicitud de anulación de venta — ${sucursalNombre}`;
    const cuerpo = [
      `Un cajero solicitó anular una venta. Esto requiere tu aprobación dentro del sistema.`,
      ``,
      `Sucursal: ${sucursalNombre}`,
      `Solicitado por: ${payload.solicitante || '—'}`,
      `Total de la venta: $${(payload.total || 0).toLocaleString('es-CL')}`,
      `Medio de pago: ${payload.medioPago || '—'}`,
      `Detalle: ${payload.lineasResumen || '—'}`,
      `Motivo indicado por el cajero: ${payload.motivo || '—'}`,
      ``,
      `Para aprobar o rechazar, entra al sistema → Reportes → 🔔 Solicitudes.`,
      ``,
      `ID de solicitud: ${payload.solicitudId || '—'}`
    ].join('\n');

    MailApp.sendEmail(EMAIL_ADMIN, asunto, cuerpo);
    return respuesta({ ok: true, notificado: true });
  } catch (err) {
    return respuesta({ ok: false, error: err.message });
  }
}

// ───────────────────────────────────────────
// Test manual desde el editor de Apps Script
function testDoPost() {
  const payload = {
    sucursal: 'ainavillo',
    filas: [{
      fecha: '24/06/2025', nVenta: 'ABC123', producto: 'Croissant',
      cantidad: 2, precioUnit: 1500, tipoDesc: '-', descuento: 0,
      brutoLinea: 3000, netoLinea: 2521, ivaLinea: 479,
      medioPago: 'efectivo', usuario: 'cajero@fen.cl', turno: 'Mañana'
    }],
    filaCaja: {
      fecha: '24/06/2025', sucursal: 'Ainavillo', usuario: 'cajero@fen.cl',
      apertura: '08:00', cierre: '18:30', montoInicial: 50000,
      totalEfectivo: 120000, totalDebito: 80000, totalCredito: 30000,
      totalTransfer: 20000, totalVentas: 250000, nVentas: 45, cajaId: 'test_001'
    }
  };
  const fakeEvent = { postData: { contents: JSON.stringify(payload) } };
  Logger.log(JSON.stringify(ejecutarAccionLegada(payload))); // v2: directo, sin pasar por la sesión
}

// Test manual del correo de notificación de anulación
function testNotificarSolicitudAnulacion() {
  const payload = {
    tipo: 'solicitud_anulacion',
    sucursal: 'ainavillo',
    solicitante: 'cajero@fen.cl',
    motivo: 'Cliente se arrepintió de la compra',
    total: 4500,
    medioPago: 'efectivo',
    lineasResumen: 'Croissant x2, Café x1',
    solicitudId: 'test_solicitud_001'
  };
  const fakeEvent = { postData: { contents: JSON.stringify(payload) } };
  Logger.log(JSON.stringify(ejecutarAccionLegada(payload))); // v2: directo, sin pasar por la sesión
}

// Test manual del registro de merma en Sheets
function testRegistrarMerma() {
  const payload = {
    tipo: 'merma',
    sucursal: 'ainavillo',
    producto: 'Ciabatta',
    cantidad: 5,
    precioOriginal: 800,
    monto: 4000,
    fechaIngreso: '28/06/2025',
    fechaMerma: new Date().toLocaleDateString('es-CL')
  };
  const fakeEvent = { postData: { contents: JSON.stringify(payload) } };
  Logger.log(JSON.stringify(ejecutarAccionLegada(payload))); // v2: directo, sin pasar por la sesión
}