// ═══════════════════════════════════════════════
//  Sistema Fën — configuración  v0.2.0
//  (i) La configuración web de Firebase no es secreta: es la misma que usa
//  la caja y solo identifica el proyecto. Lo que protege los datos son las
//  reglas de Firestore y la cuenta de administración.
// ═══════════════════════════════════════════════
window.FEN_SIS = {
  VERSION: '0.138.0',
  // v0.82.0 · El sistema empieza el 1 de octubre de 2026: lo anterior (septiembre, mes de transición) queda guardado, pero la Bandeja,
  // el informe y los avisos ya no lo piden. Se queda lo que todavía se debe (vencimientos y facturas del SII esperando su pago).
  INICIO: '2026-10-01',
  // v0.115.0 · Servidor de cobros con el Point de Mercado Pago (Cloudflare Worker). La dirección no es secreta; los secretos viven en Cloudflare.
  PUNTO_URL: 'https://fen-point.panaderiafen.workers.dev',
  // v0.90.0 · Gastos desde cero: la pestaña Gastos es la nueva (documentos, movimientos y la Bandeja que los une). El Gastos anterior queda
  // fuera de la vista y sus datos no se borran. En false vuelve el Gastos anterior tal cual (solo para una emergencia).
  GASTOS_NUEVO: true,
  firebase: {
    apiKey: 'AIzaSyDrG2mij1h5wZ2lIyAYMTfgG9avaVnjcaU',
    authDomain: 'fen-ventas.firebaseapp.com',
    projectId: 'fen-ventas',
    storageBucket: 'fen-ventas.firebasestorage.app',
    messagingSenderId: '265179393436',
    appId: '1:265179393436:web:75f74773c0cb992ca3ac59'
  },
  // Apps actuales: el menú las abre en otra pestaña. Cada etapa saca una de aquí.
  APPS: [
    { id: 'b2b',        nombre: 'Ventas B2B', url: 'https://panaderiafen.github.io/Admin-Ventas-B2B-fen/', icono: 'camion' },
    { id: 'gastos',     nombre: 'Gastos',     url: 'https://panaderiafen.github.io/registro-gasto/',      icono: 'boleta' },
    { id: 'produccion', nombre: 'Producción', url: 'https://panaderiafen.github.io/fen-produccion/',      icono: 'libro' },
    { id: 'caja',       nombre: 'Caja',       url: 'https://panaderiafen.github.io/fen-ventas/',          icono: 'pantalla' },
    { id: 'asistencia', nombre: 'Asistencia', url: 'https://panaderiafen.github.io/fen-asistencia/admin.html', icono: 'personas' }
  ],
  // Cuánto se recuerda un equipo. "sesion" = hasta cerrar el navegador (y como máximo 12 horas).
  DURACIONES: [
    { id: 'sesion', nombre: 'Solo esta vez' },
    { id: '30d',    nombre: '30 días' },
    { id: '4m',     nombre: '4 meses' },
    { id: '1a',     nombre: '1 año' },
    { id: 'fecha',  nombre: 'Personalizado' }
  ],
  DURACION_SUGERIDA: '4m',
  // Script de caja/merma (el mismo que usa la caja para pasar los cierres a la planilla).
  // Sistema Fën lo llama con su propia sesión de administración.
  CAJA_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx7eYgaVGK5NBFcmX5rVr2H_QiLIuRKS7oBwiVfy5_74icgNnKvD_WEkYD92dU-fddv1A/exec',
  // Script de Ventas mensuales (el mismo que usa la caja): solo para el correo de descuadre.
  VENTAS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxeA_xhOm83PlYgLzv7wP5N6AM-ogfrfTClrs91JzFWgi5HCSgIRwgzAuGIbd6WsukrNQ/exec',
  // Apps Script de cada app, para que Hoy lea sus pendientes (se pueden cambiar en Configuración → Conexiones).
  // La de Ventas B2B se guarda en cada equipo de la app B2B (⚙️ Config): pégala en Conexiones.
  SCRIPTS: {
    gastos: 'https://script.google.com/macros/s/AKfycbxQXOCvWM9YYY-mKLBImD4jp5XTCpBLqBO1pzCFFfllMaDBmFZAzdT8dswjyifcqzex/exec',
    b2b: '',
    produccion: 'https://script.google.com/macros/s/AKfycbw-D1gOezUuFEhhqXQ69zYR0Sp4Bekg3CHhy3lEMzB8CV9kp6ty0iXTreyq5aULmz5L8g/exec'
  },
  // Lista de recetas que publica Producción (la misma que lee la caja, pestaña Lista_publica_productos)
  RECETAS_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRKvAbWUlwxbcCx54T3lfdMa8XxPD-F2lSE05-vMfdv_UpFVpDi6pbAJOpM7O6LBLmdfkz5804lzMYn/pub?gid=1370945279&single=true&output=csv',
  DIAS_HISTORIAL: 60,
  // Base nueva de Ventas B2B (proyecto Firebase fen-b2b). Se pega en Sistema Fën → Ventas B2B y queda
  // guardada en Firestore (config/sistemaFen). Si se pone aquí, se usa cuando no hay una guardada.
  firebaseB2B: null,
  // Base nueva de Gastos (proyecto Firebase fen-gastos, etapa G1). Viene escrita en "Conectar" (Gastos → Configuración → Base nueva):
  // al conectar se guarda en Firestore (config/sistemaFen → gastosFirebase). No es secreta: solo identifica el proyecto.
  firebaseGastos: {
    apiKey: 'AIzaSyDTun4x6bzoW71QQZ6vVnrjulbMIAQKVCU',
    authDomain: 'fen-gastos.firebaseapp.com',
    projectId: 'fen-gastos',
    storageBucket: 'fen-gastos.firebasestorage.app',
    messagingSenderId: '649845839125',
    appId: '1:649845839125:web:28b66f7f0cf364c95bc51c'
  },
  // v0.45.0 · Gastos, etapa G2: el botón "Pasar Gastos a la base nueva" (Gastos → Configuración → Base nueva) queda bloqueado
  // hasta que toda la etapa G2 esté lista (registrar, pagar, obligaciones, ítems, análisis y agenda con la base nueva).
  // v0.47.0: G2 ya está completo, pero el cambio también necesita G3 (SII, cartola y Previred con la base nueva):
  // sigue en false ("El cambio se habilita cuando estén listos G2 y G3").
  // v0.48.0: de G3 ya están las Cargas del SII; faltan la cartola y Previred: sigue en false.
  // v0.49.0: G3 suma tipos de obligación, boletas del mes, bandeja y abonos; faltan la cartola y Previred: sigue en false.
  // v0.50.0: G3 suma la cartola con la base nueva; falta Previred: sigue en false.
  // v0.51.0: G3 completo (Previred con la base nueva): el cambio queda habilitado. La constante se llama ahora
  // CAMBIO_HABILITADO (antes G2_COMPLETO). En false, el botón vuelve a quedar gris.
  CAMBIO_HABILITADO: true,
  // Datos que salen en el PDF de la orden de venta B2B
  DATOS_EMPRESA: { direccion: 'Ainavillo 764, Concepción', telefono: '+56 9 4147 3683', correo: 'panaderiafen@gmail.com', web: 'WWW.PANADERIAFEN.CL · @PANADERIAFEN' }
};
