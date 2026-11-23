// ═══════════════════════════════════════════════
//  Sistema Fën — pantalla Finanzas  v0.60.0 (F1 pasos 1, 2 y 3; F2 pasos 1 y 2)
//  Pestañas: Cómo trabajamos (el método acordado el 12-oct, fijo) · Costos (Productos, Materias primas, Compras del SII y Revisión de datos) · Márgenes (Ventas por producto, Asociar productos).
//  v0.58.0: Costos → Productos (costo directo por producto con el motor finanzas-motor.js; detalle por ingrediente, historial,
//  alzas sobre el % de aviso y Ajustes de Finanzas). Rutas: #finanzas/costos/productos[/alzas | /r/{recetaId}].
//  v0.59.0: Márgenes (F2 paso 1): Ventas por producto (área × canal, neto) y Asociar productos (producto de venta → receta,
//  reventa o "no es un producto"). Rutas: #finanzas/margenes[/asociar]. Reglas puras en finanzas-ventas.js.
//  v0.60.0: Márgenes (F2 paso 2): Margen por producto, Volumen × margen, Precio sugerido y Ajustes. Rutas: #finanzas/margenes/{margen|matriz|precios|ajustes}.
//  v0.61.0: Resultados (F3 paso 1) en vista-finanzas-resultados.js: Clasificación, Créditos e Inversiones. Rutas: #finanzas/resultados[/creditos[/{id}] | /inversiones].
//  v0.62.0: Resultados → Estado de resultados (por segmentos, tres pisos) y Cierre de mes (vista-finanzas-eerr.js).
//  v0.124.0: Flujo de caja (vista-flujo.js, flujo-modelo.js, flujo-fs.js). Rutas: #finanzas/flujo[/viene | /cuadre].
//  Más adelante: Metas y presupuesto.
//  Datos en fen-gastos (finanzas.js); reglas puras en finanzas-costos.js. Solo administración: nada va a Cocina.
//  v0.76.0: Materias primas → "Nueva materia prima o insumo" (diálogo propio: nombre único, tipo, categoría, unidad de compra con su
//  contenido, precio neto y áreas), "Nombre, categoría y áreas" (cambiar, archivar, reactivar) y, en Compras del SII, "Crear desde esta
//  línea" y las 3 más parecidas al asociar. Reglas puras en mp-alta-modelo.js; escribe en la base de Cocina (produccion.js) y aquí.
//  H = ayudas de app.js: { esc, info, registrar, mensajeError, hace, dialogo }
// ═══════════════════════════════════════════════
import * as F from './finanzas.js?v=0.138.0';
import * as FC from './finanzas-costos.js?v=0.138.0';
import * as FS from './finanzas-sii.js?v=0.138.0';
import * as FM from './finanzas-motor.js?v=0.138.0';
import * as FV from './finanzas-ventas.js?v=0.138.0';
import * as FMG from './finanzas-margenes.js?v=0.138.0';
import { normalizar, coincide, conBuscador } from './buscador.js?v=0.138.0';
import * as VR from './vista-finanzas-resultados.js?v=0.138.0';
import * as MA from './mp-alta-modelo.js?v=0.138.0';
import * as CC from './campo-categoria.js?v=0.138.0';

const st = { datos: null, prod: null, cx: null, filtro: 'todas', q: '', msg: '', err: '', cargando: false, verRevisados: false, compras: null, cFiltro: '', cQ: '',
  pr: null, pArea: 'todas', pQ: '', pOrden: 'nombre', calcErr: '' };
const $ = id => document.getElementById(id);
const nf = v => Number(v || 0).toLocaleString('es-CL');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaTxt = f => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '—'; };
const ORIGEN = { planilla: 'Planilla', manual: 'A mano', sii: 'SII' };
const TIPO = { mp: 'Materia prima', insumo: 'Insumo', sub_receta: 'Sub receta' };
// v0.57.0: "SII · Proveedor · F.123" cuando el precio viene de una compra del SII
const origenTxt = (m, H) => FS.textoOrigenSii(m) ? H.esc(FS.textoOrigenSii(m)) : (ORIGEN[m.origen] || H.esc(m.origen || '—'));

// Íconos lineales propios de esta pantalla
const PI = {
  dia: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cierre: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  informe: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  decision: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
  meta: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
  banco: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/>',
  efectivo: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  campana: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', sube: '<path d="M12 19V5M6 11l6-6 6 6"/>', baja: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', bajar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  neto: '<path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="9"/>', fuente: '<circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6"/>', candado: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  factura: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>', enlace: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  revisar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', mas: '<path d="M12 5v14M5 12h14"/>', lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  archivo: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>', atras: '<path d="M19 12H5M11 6l-6 6 6 6"/>', no: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'
};
const ic = (n, t = 20) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PI[n] || ''}</svg>`;

function error(e, H) {
  const c = (e && e.code) || '';
  if (/permission-denied/.test(c)) return 'La base nueva de Gastos no dejó leer o guardar: revisa que tu cuenta esté en admins de fen-gastos.';
  if (c === 'actualizar' || c === 'sin_url') return (e && e.message) || 'Revisa el script de Producción en Configuración → Conexiones.';
  return (e && e.message) || H.mensajeError(e);
}

const partes = () => (location.hash || '').replace('#', '').split('/');
const cab = (tab) => `<div class="cabecera"><div><h1 id="t-finanzas">Finanzas</h1><p>Análisis financiero de Fën</p></div>
  <div class="pestanas" role="tablist" aria-label="Secciones de Finanzas">
    <a role="tab" href="#finanzas" aria-selected="${tab === 'como'}">Cómo trabajamos</a>
    <a role="tab" href="#finanzas/costos/productos" aria-selected="${tab === 'costos'}">Costos</a>
    <a role="tab" href="#finanzas/margenes" aria-selected="${tab === 'margenes'}">Márgenes</a>
    <a role="tab" href="#finanzas/resultados" aria-selected="${tab === 'resultados'}">Resultados</a>
    <a role="tab" href="#finanzas/plata" aria-selected="${tab === 'plata'}">Plata hoy</a>
    <a role="tab" href="#finanzas/flujo" aria-selected="${tab === 'flujo'}">Flujo de caja</a>
    ${F.gnActivo() ? '' : `<a role="tab" href="#finanzas/resumen" aria-selected="${tab === 'resumen'}">Resumen del mes</a>`}</div></div>
  <p class="fin-pronto">Próximamente: Metas y presupuesto</p>`;

export async function pintar(el, sub, H) {
  // v0.77.1: el maestro de materias primas usa los mismos IDs en Producción → Materias primas: la otra pantalla (oculta) se vacía
  const enProd = document.querySelector('#v-produccion #prod-tab[data-tab="mp"]'); if (enProd) enProd.innerHTML = '';
  const p = partes(), tab = p[1] === 'costos' ? 'costos' : p[1] === 'margenes' ? 'margenes' : p[1] === 'resultados' ? 'resultados' : p[1] === 'resumen' ? 'resumen' : p[1] === 'flujo' ? 'flujo' : p[1] === 'plata' ? 'plata' : 'como';
  st.msg = ''; st.err = '';
  if (tab === 'margenes' && st.tabPrev !== 'margenes') MS.costos = null;   // v0.60.0: costos al día al entrar a Márgenes
  if (tab === 'resultados' && st.tabPrev !== 'resultados') VR.olvidar();   // v0.61.0: los gastos al día al entrar a Resultados
  st.tabPrev = tab;
  if (tab === 'como') { el.innerHTML = cab(tab) + comoTrabajamos(H); return; }
  // v0.78.0 (Gastos, etapa A): Resumen del mes (antes en Conciliación), junto al Cierre de mes; lo dibuja app.js con lo de la conciliación
  // v0.102.0 · Con el Gastos nuevo, el Resumen del mes (de la conciliación antigua) se retira: sus revisiones están en Resultados → Cierre de mes
  if (tab === 'resumen' && F.gnActivo()) { location.replace('#finanzas/resultados/cierre'); return; }
  if (tab === 'resumen') { if (H.resumenMes) H.resumenMes(el, cab(tab), p[2] || ''); else el.innerHTML = cab(tab); return; }
  // v0.61.0: Resultados (F3 paso 1): Clasificación, Créditos e Inversiones
  // v0.62.0: Estado de resultados (primera parte) y Cierre de mes; Clasificación pasa a #finanzas/resultados/clasificacion
  if (tab === 'resultados') return VR.pintarResultados(el, ['creditos', 'inversiones', 'clasificacion', 'cierre'].includes(p[2]) ? p[2] : 'eerr', H, { cab, error, sinBase, conexion: async () => { if (!st.cx || st.cx.gastos.estado !== 'ok') st.cx = await F.conexiones(); return st.cx; } });
  // v0.128.0 · Plata hoy: lo que hay, lo que viene y lo que queda (vista-plata.js, con los datos del Flujo de caja)
  if (tab === 'plata') return (await import('./vista-plata.js?v=0.138.0')).pintar(el, H, { cab, error });
  // v0.124.0 · Flujo de caja (Semanas, Lo que viene y Cuadre) en vista-flujo.js
  if (tab === 'flujo') return (await import('./vista-flujo.js?v=0.138.0')).pintar(el, p[2] === 'viene' ? 'viene' : p[2] === 'cuadre' ? 'cuadre' : 'semanas', H, { cab, error });
  if (tab === 'margenes') return pintarMargenes(el, ['asociar', 'margen', 'matriz', 'precios', 'ajustes'].includes(p[2]) ? p[2] : 'ventas', H);
  const parte = p[2] === 'revision' ? 'revision' : p[2] === 'compras' ? 'compras' : p[2] === 'productos' ? 'productos' : 'mp';
  el.innerHTML = cab(tab) + subPestanas(parte, null) + '<section class="tarjeta"><div class="vacio" style="border:0">Abriendo los costos…</div></section>';
  try {
    st.cx = await F.conexiones();
    if (st.cx.gastos.estado !== 'ok') return sinBase(el, tab, H);
    await recargar();
    // v0.58.0: al abrir Costos se recalcula el costo de todos los productos (en este equipo; cada 2 minutos como máximo)
    st.calcErr = '';
    if (st.cx.prod.estado === 'ok' && (!F.ultimoResultado() || F.calculadoHace() > 120000)) {
      el.innerHTML = cab(tab) + subPestanas(parte, null) + '<section class="tarjeta"><div class="vacio" style="border:0" role="status" id="fin-calculando">Calculando… el costo de todos los productos con los precios de hoy.</div></section>';
      try { await F.recalcularRecetas({ costos: st.datos.costos }); st.pr = await F.leerProductos(); } catch (e) { st.calcErr = error(e, H); }
    }
  } catch (e) { el.innerHTML = cab(tab) + `<section class="tarjeta"><p class="error" role="alert">${H.esc(error(e, H))}</p></section>`; return; }
  if (partes()[1] !== 'costos') return;
  pintarCostos(el, parte, H);
}
async function recargar(conCompras) {
  const [d, prod, c, pr] = await Promise.all([F.leer(), st.cx && st.cx.prod.estado === 'ok' ? F.produccion() : Promise.resolve({ mps: [], recetas: [], error: 'sin conexión' }),
    conCompras || partes()[2] === 'compras' ? F.leerCompras() : Promise.resolve(st.compras), F.leerProductos().catch(() => null)]);
  st.datos = d; st.prod = prod; st.compras = c; st.pr = pr;
}
function sinBase(el, tab, H) {
  const g = st.cx.gastos;
  const txt = g.estado === 'sin_config' ? 'Falta conectar la base nueva de Gastos (fen-gastos), donde se guardan los costos.'
    : g.estado === 'sin_sesion' ? 'Falta entrar a la base nueva de Gastos con tu contraseña.'
    : g.estado === 'sin_admin' ? 'Tu cuenta no está marcada como administración en fen-gastos.' : 'No se pudo abrir la base nueva de Gastos.';
  el.innerHTML = cab(tab) + `<section class="tarjeta" aria-labelledby="t-fin-sin"><h2 id="t-fin-sin">Los costos se guardan en la base nueva de Gastos</h2>
    <p class="ayuda">${H.esc(txt)} Se arregla en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>; después vuelve aquí.</p></section>`;
}

// ═══════════════ Cómo trabajamos (contenido fijo) ═══════════════
function comoTrabajamos(H) {
  const paso = (n, icono, titulo, cuando, cuerpo) => `<li class="fin-paso"><div class="fin-paso-ic" aria-hidden="true">${ic(icono, 22)}</div>
    <div class="fin-paso-txt"><div class="fin-paso-tit"><span class="fin-num">${n}</span><h3>${titulo}</h3>${cuando ? `<span class="chip c-gris">${cuando}</span>` : ''}</div>${cuerpo}</div></li>`;
  const cond = t => `<li>${ic('check', 16)}<span>${t}</span></li>`;
  const def = (termino, cuerpo, ej) => `<div class="fin-def"><dt>${termino}</dt><dd>${cuerpo}${ej ? `<p class="fin-ej">${ej}</p>` : ''}</dd></div>`;
  return `
  <section class="tarjeta" aria-labelledby="t-fin-metodo">
    <h2 id="t-fin-metodo">La forma de trabajar ${H.info('Cómo trabajamos', 'Es el método acordado el 12 de octubre de 2026 para mirar los números de Fën. Cada pantalla de Finanzas sigue estas reglas.\nSolo tú ves estos números, y solo en Sistema Fën: las jefas no ven nada de esto.')}</h2>
    <p class="ayuda">Todo se mira en dos ejes: el <b>área que produce</b> (Panadería, Bollería, Pastelería, Cafetería) y el <b>canal donde se vende</b> (caja Barros Arana, caja Ainavillo, B2B). Cada venta va al área del producto; cada canal tiene sus propios costos (cajeras, despacho, comisiones). Lo que se compra hecho y se vende tal cual va al área <b>Reventa</b>, que solo existe para ver su margen (no produce: no está en Cocina ni en Producción). Los costos de atender a cada canal van a su código de canal: <b>B2B</b> y <b>B2C</b> (los clientes de las tiendas).</p>
    <ol class="fin-pasos">
      ${paso(1, 'dia', 'Todos los días', '', '<p>El costo directo de cada producto se actualiza con cada compra. En <b>Hoy</b>: la venta del mes contra la meta y el punto de equilibrio.</p>')}
      ${paso(2, 'cierre', 'Cierre del mes', 'después de Previred, hasta el día 13', `<p>Se cierra después de pagar y cargar el Previred de ese mes, a más tardar el día 13 del mes siguiente. Orden recomendado:</p>
        <ol class="fin-orden" id="fin-orden-cierre"><li><b>Pagar Previred</b>, ojalá antes del día 10.</li><li><b>Subir el comprobante o el CSV</b> en Gastos → Previred.</li><li><b>Cerrar el mes</b> (Resultados → Cierre de mes).</li></ol>
        <p>Se cierra cuando están las cinco cosas:</p>
        <ul class="fin-cond">${cond('SII del mes cargado y clasificado')}${cond('Ventas completas, de las dos sucursales')}${cond('Gastos conciliados con la cartola')}${cond('Previred del mes cargado')}${cond('Conteo de bodega hecho')}</ul>
        <p>Al cerrarlo, el mes queda <b>congelado</b>. Lo que aparezca después entra como ajuste del mes siguiente. ${H.info('Por qué el Previred del mismo mes', 'Las cotizaciones de octubre son un costo de octubre: su gasto queda con fecha del 31 de octubre y se pagan hasta el 13 de noviembre. Si octubre se cierra antes de cargarlas, octubre queda con menos costo y la diferencia entra a noviembre como "Ajustes de meses cerrados". Por eso el cierre espera el Previred.')}</p>`)}
      ${paso(3, 'informe', 'Informes', '', '<p>Estado de resultados y flujo de caja del mes cerrado, comparados con el presupuesto.</p>')}
      ${paso(4, 'decision', 'Decisiones', '', '<p>Precios, mezcla de productos, costos y metas.</p>')}
      ${paso(5, 'meta', 'Presupuesto del mes siguiente', '', '<p>Fijos y metas de venta por área.</p>')}
    </ol>
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-reglas">
    <h2 id="t-fin-reglas">Reglas fijas</h2>
    <div class="fin-reglas">
      <div class="fin-regla">${ic('neto', 22)}<div><b>Todo en neto</b><span>Ventas y costos sin IVA. El IVA va al flujo de caja.</span></div></div>
      <div class="fin-regla">${ic('fuente', 22)}<div><b>Una sola fuente por dato</b><span>Cada número se anota en un solo lugar y de ahí lo leen todos.</span></div></div>
      <div class="fin-regla">${ic('candado', 22)}<div><b>Un mes cerrado no se toca</b><span>Las correcciones entran como ajuste del mes siguiente.</span></div></div>
    </div>
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-pagos" id="fin-pagos">
    <h2 id="t-fin-pagos">Cómo se registran los pagos ${H.info('Cómo se registran los pagos', 'Acordado el 13 de octubre de 2026: cada peso que sale por el banco se registra una sola vez y desde la cartola, con la fecha del banco. Así Gastos y la cartola siempre cuadran y nada queda duplicado.\nLas cuentas recurrentes dicen cómo se pagan (Cuentas recurrentes → Editar → "Se paga por"): banco, efectivo o tarjeta de crédito.')}</h2>
    <div class="fin-reglas">
      <div class="fin-regla">${ic('banco', 22)}<div><b>Lo que pagas por banco lo registra la cartola</b><span>Transferencias, cargos automáticos y pagos desde la cuenta: al subir la cartola, en Gastos → Bandeja → Cargos de la cartola dices qué es cada cargo y ahí queda el gasto.</span></div></div>
      <div class="fin-regla">${ic('efectivo', 22)}<div><b>Solo el efectivo se registra a mano</b><span>En Gastos → Registrar (forma de pago Efectivo) o con "Pagar" en un vencimiento que se paga en efectivo.</span></div></div>
      <div class="fin-regla">${ic('campana', 22)}<div><b>Los vencimientos te dicen qué pagar; la cartola lo registra</b><span>Un vencimiento de banco dice "Se paga desde la cartola": te recuerda pagarlo, no se paga ahí.</span></div></div>
      <div class="fin-regla">${ic('check', 22)}<div><b>Si registras a mano un pago de banco, la cartola solo lo confirma</b><span>Queda esperando su cargo (Hoy: "Esperan cartola"). Cuando llega, elige "Ya está en Gastos" para no duplicarlo.</span></div></div>
    </div>
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-sii" id="fin-sii-flujo">
    <h2 id="t-fin-sii">Las facturas del SII, de la subida al cierre ${H.info('Facturas del SII', 'Acordado el 15 de octubre de 2026 (v0.66.0). Un gasto del SII siempre es del mes de la FACTURA (lo devengado), aunque se pague otro día. El pago queda con su propia fecha (la del banco, la del efectivo o la de la tarjeta) para el flujo de caja.\nNada se da por pagado en efectivo solo: lo decides tú en Pagos sin banco.')}</h2>
    <ol class="fin-pasos fin-sii-pasos">
      ${paso(1, 'fuente', 'Subir el SII', 'Gastos → Bandeja → Subir archivo', '<p>Se guardan todos los documentos. Los de <b>proveedores conocidos</b> (el mismo ítem y área al menos 2 veces, sin repartir) <b>se clasifican solos</b>: su gasto queda con la fecha de la factura y el chip "clasificación automática" (se revisan en Cargas del SII → <b>Revisar automáticas</b>: está bien, cambiar ítem o área, o anular). Lo nuevo o dudoso queda <b>por clasificar</b>, sin gasto.</p>')}
      ${paso(2, 'banco', 'Clasificar al conciliar', 'Gastos → Bandeja → Cargos de la cartola', '<p>El cargo del banco del mismo monto muestra "Factura por clasificar": eliges ítem y área (y repartes si hace falta) y al confirmar nace el gasto con la fecha de la factura y el pago con la del banco. Si pagaste en partes, se clasifica con el primer abono. También puedes clasificar en Cargas del SII, como siempre.</p>')}
      ${paso(3, 'efectivo', 'Pagos sin banco', 'Gastos → Bandeja → Pagos sin banco', '<p>Lo primero es pagar desde el banco; esto es para las excepciones. Las facturas sin pago del banco después de 10 días (o pasado su vencimiento, si son a crédito): <b>pagada en efectivo</b> (de dónde: <b>efectivo de cobros B2B</b>, que nunca pasa por el banco, u otro), <b>con tarjeta de crédito</b> o <b>todavía por pagar</b> (a crédito con su vencimiento: Agenda y Hoy). Ahí ves también el <b>efectivo en mano estimado</b>: lo cobrado en efectivo a clientes B2B menos lo pagado con ese efectivo.</p>')}
      ${paso(4, 'cierre', 'Cierre del mes', 'Resultados → Cierre de mes', '<p>Para cerrar, ningún documento del SII de ese mes puede quedar por clasificar (o se cierra igual con el motivo). El estado de resultados avisa si quedan, con su monto.</p>')}
    </ol>
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-calc">
    <h2 id="t-fin-calc">Cómo se calcula</h2>
    <dl class="fin-glosario">
      ${def('Costo directo', 'Lo que cuesta hacer una unidad: materias primas al precio neto de la última compra (del SII, se puede corregir a mano) + insumos y envases + merma de proceso. Las sub recetas (masa madre, crema pastelera…) entran con su propio costo.')}
      ${def('Margen de contribución', 'Precio neto − costo directo. En %, se mide <b>sobre el precio neto</b>.', 'Ejemplo: precio neto $2.000 y costo directo $800 → margen $1.200, o sea 60 %. El mismo margen visto como <b>recargo</b> sobre el costo es 150 % ($1.200 ÷ $800). Recargo = margen ÷ (1 − margen); margen = recargo ÷ (1 + recargo).')}
      ${def('Margen objetivo del área', 'Lo indirecto entra al precio a nivel de área, no repartido por unidad: margen objetivo = (fijos del área + utilidad objetivo) ÷ ventas esperadas. Precio sugerido = costo directo ÷ (1 − margen objetivo).')}
      ${def('Margen del área', 'Margen de contribución del área − sus fijos propios.')}
      ${def('Fijos propios y fijos comunes', '<b>Propios</b>: existen solo por esa área (por ejemplo, un sueldo o una máquina de una sola área). <b>Comunes</b>: son de todo el negocio (arriendo, contador, luz general, sueldo empresarial). En el resultado los comunes van <b>sin repartir</b>; aparte se puede ver un reparto por causa (m², kWh, horas), solo para conversar.')}
      ${def('Resultado del negocio', 'Tres pisos: ventas netas − costo directo = margen de contribución; − fijos propios = margen del área; − fijos comunes = resultado del negocio.')}
      ${def('Mes cerrado y ajustes', 'Al cerrar el mes (Resultados → Cierre de mes) su estado de resultados queda congelado. Si después cambia algo de ese mes (una factura atrasada, un gasto corregido), el mes cerrado no se toca: la diferencia aparece como <b>Ajustes de meses cerrados</b> en el primer mes abierto siguiente.')}
      ${def('Punto de equilibrio', 'La venta neta que cubre los fijos: fijos ÷ % de margen de contribución.', 'Ejemplo: fijos $3.000.000 al mes y margen 60 % → hay que vender $5.000.000 netos en el mes.')}
      ${def('Tarjeta de crédito', '<b>Compras con tarjeta</b>: son gasto el día de la compra (entran por el SII, con su factura). <b>Pago de la tarjeta</b>: queda fuera del resultado, es solo flujo de caja (en la cartola se marca "Pago de tarjeta": no crea gasto). <b>Mantención e intereses de la tarjeta</b>: gasto financiero, se registran a mano en Gastos.', 'Ejemplo: compras $100.000 en harina con la tarjeta el 10 de marzo → gasto de marzo. El 5 de abril pagas la tarjeta: ese cargo no es gasto (ya se contó en marzo). La comisión de mantención de $3.000 sí es gasto financiero de abril.')}
      ${def('Productos de reventa', 'Lo que compras hecho para venderlo tal cual (bebidas, jugos, chocolates, té e infusiones, Magia…). <b>En Gastos</b> la compra va al ítem "PRODUCTOS DE REVENTA" con el <b>área REVENTA</b> (en Gastos → Ítems, área fija REVENTA). En Resultados → Clasificación ese ítem es "Compras de productos de reventa" (se propone solo por el nombre: reventa, chocolate, infusión, té, Magia): <b>no es una línea de gasto</b>. Lo que entra al resultado es el costo de lo <b>vendido</b>: el costo de compra neto de cada producto (Márgenes → Asociar productos, tipo Reventa) × las unidades vendidas. En Asociar productos, el tipo Reventa propone el <b>área Reventa</b>: así el estado de resultados tiene su columna <b>Reventa</b> (aparece solo si el mes tiene algo), con sus ventas, su costo, su margen de contribución y sus fijos, si algún gasto tiene área REVENTA. Reventa es solo un área de margen: no está en Cocina ni en Producción, no entra sola en un reparto (solo si la eliges) y no recibe comunes en la vista repartida por causa. <b>Pendiente:</b> que ese costo se actualice solo con cada factura del SII; por ahora se escribe a mano.', 'Ejemplo: compras 24 chocolates a $500 netos c/u ($12.000) y vendes 10 en el mes → al resultado entran $5.000 de costo; los 14 que quedan no son gasto todavía.')}
      ${def('Costo de canal B2C', 'Lo que cuesta <b>atender a los clientes de las tiendas</b> (B2C), no lo que cuesta producir: por ejemplo, la parte de la luz y el agua de la sala de venta, o lo de las cajeras. En Gastos es el área <b>B2C</b>, igual que <b>B2B</b> es lo que cuesta atender a los clientes B2B. No es un área que produce ni de margen: no está en Cocina ni en Producción, y nunca entra sola en un reparto (solo si la eliges tú). En el estado de resultados va como B2B: a Común, con su nota de costo de canal, hasta que exista la fila de costo de canal. Cada gasto guarda su local o su cuenta, así más adelante se puede ver por tienda. Es la base para calcular después <b>cuánto cuesta conseguir y atender a un cliente</b>.', 'Ejemplo: la luz de Barros Arana se reparte 70 % Cafetería (lo que produce) y 30 % B2C (la sala de venta).')}
      ${def('Boletas de luz y agua', 'Cada boleta (CGE, ESSBIO) se sube como PDF en Gastos → Por pagar (o en Gastos → Bandeja → Subir archivo). Su gasto es del <b>mes en que termina el período</b> de la boleta, con fecha del último día de ese mes: 16 ago – 15 sep es de septiembre; 8 sep – 7 oct es de octubre. Una boleta no da crédito de IVA: su costo es el total. Los intereses que trae van aparte, como gasto financiero. El "saldo anterior" no es un gasto nuevo: son las boletas de antes que siguen por pagar.')}
      ${def('Qué queda fuera del resultado', 'No son gasto del mes, van al flujo de caja: el <b>capital</b> de las cuotas de crédito (solo el interés es gasto), el pago de IVA (<b>F29</b>), las <b>inversiones</b> (entran al resultado como depreciación mensual según su vida útil) y los <b>retiros</b>. El sueldo empresarial sí es costo (fijo común).')}
    </dl>
  </section>`;
}

// ═══════════════ Costos ═══════════════
function subPestanas(parte, n) {
  const nc = st.datos && st.datos.porConfirmar ? st.datos.porConfirmar.length : 0;
  return `<div class="pastillas fin-sub" role="group" aria-label="Partes de Costos">
    <a class="pastilla" href="#finanzas/costos/productos" aria-current="${parte === 'productos' ? 'page' : 'false'}" aria-pressed="${parte === 'productos'}">Productos</a>
    <a class="pastilla" href="#finanzas/costos" aria-current="${parte === 'mp' ? 'page' : 'false'}" aria-pressed="${parte === 'mp'}">Materias primas</a>
    <a class="pastilla" href="#finanzas/costos/compras" aria-current="${parte === 'compras' ? 'page' : 'false'}" aria-pressed="${parte === 'compras'}">Compras del SII${nc ? ` <span class="chip c-amarillo chip-chico" title="Precios por confirmar">${nc}</span>` : ''}</a>
    <a class="pastilla" href="#finanzas/costos/revision" aria-current="${parte === 'revision' ? 'page' : 'false'}" aria-pressed="${parte === 'revision'}">Revisión de datos${n ? ` <span class="chip c-rojo chip-chico">${n}</span>` : ''}</a></div>`;
}
const lista = () => Object.values((st.datos && st.datos.costos) || {});
// v0.58.0: productos aprobados con costo incompleto (del último cálculo guardado)
const productosIncompletos = () => Object.entries((st.pr && st.pr.docs) || {}).filter(([, d]) => d && d.aprobada && (d.incompleto || []).length).sort((a, b) => String(a[1].nombre).localeCompare(String(b[1].nombre), 'es'));
const GRUPOS = [...FC.GRUPOS, ['producto_incompleto', 'Productos con costo incompleto', 'Productos y sub recetas aprobados a los que les falta algo para tener su costo completo: un ingrediente sin precio, una unidad que no calza, una sub receta incompleta o sin rendimiento. Su costo se muestra con lo que sí tiene costo. "Ver costo" abre su detalle.']];
function revision() {
  const items = FC.revisarDatos({ costos: st.datos.costos, mps: st.prod.mps || [], recetas: st.prod.recetas || [] })
    .concat(productosIncompletos().map(([id, d]) => ({ clave: `producto_incompleto:${id}`, grupo: 'producto_incompleto', titulo: d.nombre || id, detalle: d.incompleto.join(' · '), producto: id, huella: JSON.stringify(d.incompleto) })));
  return { pendientes: items.filter(i => FC.pendiente(i, st.datos.marcas)), revisados: items.filter(i => !FC.pendiente(i, st.datos.marcas)) };
}
// v0.77.1: el maestro de materias primas vive en Producción → Materias primas (#produccion/mp); en Finanzas queda un enlace
const enProduccion = () => /^#produccion\/mp/.test(location.hash || '');
function pintarCostos(el, parte, H) {
  if (parte === 'mp' && enProduccion()) { el.innerHTML = htmlMaestro(H); conectarMaestro(el, H); return; }
  const rv = revision();
  if (parte === 'productos') { const p = partes(); if (p[3] === 'r' && p[4]) return pintarDetalle(el, decodeURIComponent(p[4]), rv, H); }
  el.innerHTML = cab('costos') + subPestanas(parte, rv.pendientes.length) + (parte === 'revision' ? htmlRevision(rv, H) : parte === 'compras' ? htmlCompras(H) : parte === 'productos' ? htmlProductos(H) : htmlMpMovidas(H));
  if (parte === 'revision') conectarRevision(el, rv, H); else if (parte === 'compras') conectarCompras(el, H); else if (parte === 'productos') conectarProductos(el, H);
}

// ── Materias primas ──
// v0.77.1: en Finanzas → Costos, solo el enlace (la pantalla es la misma, en Producción)
function htmlMpMovidas(H) {
  return `<section class="tarjeta fin-mp-movidas" aria-labelledby="t-fin-mp-mov" id="fin-mp-movidas">
    <h2 id="t-fin-mp-mov">Las materias primas están en Producción → Materias primas ${H.info('Materias primas', 'Desde la v0.77.1 el maestro de materias primas e insumos (crear, cambiar nombre, categoría y áreas, archivar, y el precio de cada una) está en Producción → Materias primas: es la misma pantalla, en un solo lugar.\nEl precio sigue guardado aquí, en la base de Gastos y Finanzas, y lo siguen usando Compras del SII y el costo de los productos.\nEn Finanzas quedan Compras del SII (con "Crear desde esta línea") y Productos (el costo de cada receta).')}</h2>
    <p class="ayuda">Crear, cambiar y archivar materias primas e insumos, con su precio a la vista. Aquí quedan Compras del SII y el costo de los productos.</p>
    <p><a class="btn" href="#produccion/mp" id="fin-ir-mp">Abrir Producción → Materias primas</a></p></section>`;
}
// v0.77.1: Producción → Materias primas (el mismo maestro de la v0.76.0). Lee lo de Finanzas (de la memoria de fen-gastos) y la lista
// de la base de Cocina (memoria compartida); no recalcula el costo de los productos. opc.conteo(): cuántas hay en la base de Cocina.
export async function pintarMaestro(el, H, opc = {}) {
  const fin = document.getElementById('v-finanzas'); if (fin && fin !== el && !fin.contains(el)) fin.innerHTML = '';   // mismos IDs (fin-…): solo una pantalla a la vez
  st.mpConteo = null; st.msg = ''; st.err = '';
  el.innerHTML = '<section class="tarjeta"><div class="vacio" style="border:0" role="status">Abriendo las materias primas…</div></section>';
  try {
    st.cx = await F.conexiones();
    if (st.cx.gastos.estado !== 'ok') {
      el.innerHTML = `<section class="tarjeta" aria-labelledby="t-fin-sin"><h2 id="t-fin-sin">Los precios se guardan en la base de Gastos y Finanzas</h2>
        <p class="ayuda">Falta conectar la base nueva de Gastos (fen-gastos), donde está el precio de cada materia prima. Se arregla en <a href="#gastos/config/base">Gastos → Configuración → Base nueva</a>; después vuelve aquí.</p></section>`;
      return;
    }
    const [, k] = await Promise.all([recargar(), opc.conteo ? opc.conteo() : Promise.resolve(null)]);
    st.mpConteo = k;
  } catch (e) { el.innerHTML = `<section class="tarjeta"><p class="error" role="alert">${H.esc(error(e, H))}</p></section>`; return; }
  if (!enProduccion()) return;
  pintarCostos(el, 'mp', H);
}
const FILTROS = [['todas', 'Todas'], ['problemas', 'Con problemas'], ['insumo', 'Insumos'], ['sub_receta', 'Sub recetas'], ['archivada', 'Archivadas']];
function filtrar(xs, f, q) {
  const r = xs.filter(m => f === 'archivada' ? m.estado === 'archivada' : m.estado !== 'archivada')
    .filter(m => f === 'problemas' ? FC.problemasMp(m).length > 0 : f === 'insumo' ? m.tipo === 'insumo' : f === 'sub_receta' ? m.tipo === 'sub_receta' : true)
    .filter(m => !normalizar(q) || coincide(`${m.nombre} ${m.id} ${m.unidadCompra || ''}`, q));
  return r.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
}
// v0.73.0 (Etapa 1): costos_mp (fen-gastos) es la única fuente de precios
const TXT_SOLO_FINANZAS = 'Desde la v0.73.0 los precios viven solo aquí (Finanzas → Costos, en la base de Gastos y Finanzas). La planilla de Producción ya no se actualiza, por eso "Traer precios desde la planilla" ya no está.\nUna materia prima nueva entra con su precio neto cuando la creas aquí o cuando resuelves un pedido de Cocina en Producción → Por revisar. Después, el precio cambia con la última compra del SII o a mano (con motivo).\nEl costo de las recetas por aprobar, la merma y los márgenes salen de estos precios.';
function htmlMaestro(H) {
  const xs = lista(), activas = xs.filter(m => m.estado !== 'archivada');
  const cuenta = k => k === 'todas' ? activas.length : filtrar(xs, k, '').length;
  const ult = st.datos.ultimaCarga;
  const prodAviso = st.cx.prod.estado !== 'ok' ? '<p class="aviso" style="margin-top:12px">La base de Cocina no está conectada: la lista de materias primas y recetas no se puede leer. Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : '';
  return `<section class="tarjeta" aria-labelledby="t-fin-mp">
    <div class="titulo-fila fin-titulo"><h2 id="t-fin-mp">Maestro de materias primas ${H.info('Maestro de materias primas con costos', 'Cada materia prima o insumo con lo que trae una unidad de compra (contenido en g, ml o unidades) y su precio neto. Con eso sale el precio por kg, l o unidad que usa el costeo.\nLos precios partieron de la planilla (MP_maestro); desde la v0.73.0 viven solo aquí. Se actualizan solos con la última compra del SII (Compras del SII), en neto: lo que trae una unidad de la factura se lleva a la unidad de compra de cada materia prima. Lo que cambies a mano queda "A mano". Una materia prima nueva entra con su precio al crearla aquí (o al resolver un pedido de Cocina en Producción → Por revisar).\nHasta la v0.76.0 esta pantalla estaba en Finanzas → Costos; desde la v0.77.1 está aquí, en Producción.\nCada cambio queda en el historial, con fecha, quién y motivo: nada se borra.\nEl impuesto adicional (harina) se guarda, pero no se suma al costo: en la harina es IVA anticipado y se recupera.\nLas sub recetas aparecen en la lista, pero su costo sale de su receta (Costos → Productos).\nSe guarda en la base de Gastos (fen-gastos): las jefas no lo ven.')}</h2>
      <span class="ayuda fin-solo-finanzas" id="fin-traer-off">Precios solo de Finanzas ${H.info('Precios solo de Finanzas', TXT_SOLO_FINANZAS)}</span>
      <button type="button" class="btn" id="fin-mp-nueva" ${st.cx.prod.estado === 'ok' ? '' : 'disabled'}>${ic('mas', 18)} Nueva materia prima o insumo</button></div>
    ${st.mpConteo ? `<p class="ayuda" id="fin-mp-cocina">En la base de Cocina: ${nf(st.mpConteo.total)} materias primas e insumos (${nf(st.mpConteo.activas)} ${st.mpConteo.activas === 1 ? 'activa' : 'activas'} · ${nf(st.mpConteo.insumos)} ${st.mpConteo.insumos === 1 ? 'insumo' : 'insumos'}${st.mpConteo.archivadas ? ` · ${nf(st.mpConteo.archivadas)} ${st.mpConteo.archivadas === 1 ? 'archivada' : 'archivadas'}` : ''}).</p>` : ''}
    <p class="ayuda" id="fin-resumen">${xs.length ? `${nf(activas.length)} activas · ${nf(cuenta('problemas'))} con problemas · última carga desde la planilla: ${ult ? `${fechaTxt(ult.fecha)} (${nf(ult.nuevas)} nuevas, ${nf(ult.cambian)} con cambios)` : '—'}` : 'Todavía no hay precios. Cada materia prima nueva entra con su precio al crearla aquí o en Producción → Por revisar; los demás cambios llegan con las compras del SII o a mano.'}</p>
    <p class="ok-texto" id="fin-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="fin-err" role="alert">${H.esc(st.err)}</p>
    ${prodAviso}
    ${xs.length ? `<div class="filtros fin-filtros">
      <div class="fin-buscar">${ic('lupa', 18)}<label class="sr" for="fin-q">Buscar materia prima</label><input type="search" id="fin-q" placeholder="Buscar por nombre…" autocomplete="off" spellcheck="false" value="${H.esc(st.q)}"></div>
      <div class="chips" role="group" aria-label="Filtrar">${FILTROS.map(([k, t]) => `<button type="button" class="chip-filtro" data-fin-filtro="${k}" aria-pressed="${st.filtro === k}">${t} <span class="fin-cuenta">${nf(cuenta(k))}</span></button>`).join('')}</div></div>
    <div class="fin-tabla" aria-label="Materias primas con costos">
      <div class="fin-fila fin-cab" aria-hidden="true"><span>Nombre</span><span>Unidad de compra</span><span>Contenido</span><span>Precio neto</span><span>Precio por kg, l o un</span><span>Origen</span><span>Cambio</span></div>
      <div id="fin-filas"></div></div>` : ''}
  </section>`;
}
function filaMp(m, H) {
  const pr = FC.problemasMp(m), lec = m.contenido ? FC.porLectura(m.precioPorBase, m.contenido.unidad) : null;
  const v = m.anterior ? FC.variacion(m.precioPorBase, m.anterior.precioPorBase) : null;
  const cambio = v && v.dir !== 'igual' ? `<span class="fin-var ${v.dir === 'sube' ? 'fin-sube' : 'fin-baja'}" title="Contra el precio anterior (${H.esc(fechaTxt(m.anterior.fecha))})">${ic(v.dir, 14)}${FC.textoVariacion(v)}<span class="sr">${v.dir === 'sube' ? 'subió' : 'bajó'} contra el precio anterior</span></span>` : v ? '<span class="ayuda">igual</span>' : '';
  const esSub = m.tipo === 'sub_receta';
  return `<div class="fin-fila"><button type="button" class="fin-abrir" data-fin-mp="${H.esc(m.id)}">
    <span class="fin-nombre"><b>${H.esc(m.nombre)}</b>${m.tipo !== 'mp' ? ` <span class="chip c-gris chip-chico">${TIPO[m.tipo]}</span>` : ''}${pr.map(p => ` <span class="chip c-rojo chip-chico">${H.esc(p.texto.replace(/^Contenido: .*/, 'Contenido dudoso'))}</span>`).join('')}</span>
    <span><span class="fin-et">Unidad de compra</span>${H.esc(m.unidadCompra || '—')}</span>
    <span><span class="fin-et">Contenido</span>${FC.textoContenido(m.contenido)}</span>
    <span><span class="fin-et">Precio neto</span>${esSub ? '<span class="ayuda">se calcula de su receta</span>' : m.precioNeto > 0 ? FC.pesos(m.precioNeto) : '—'}</span>
    <span><span class="fin-et">Por kg, l o un</span>${esSub ? '—' : lec ? `<b>${lec.texto}</b>` : '—'}</span>
    <span><span class="fin-et">Origen</span>${origenTxt(m, H)} <span class="ayuda">${fechaTxt(m.fecha)}</span></span>
    <span><span class="fin-et">Cambio</span>${cambio || '<span class="ayuda">—</span>'}</span></button></div>`;
}
function pintarFilas(H) {
  const xs = filtrar(lista(), st.filtro, st.q), c = $('fin-filas'); if (!c) return;
  c.innerHTML = xs.length ? xs.map(m => filaMp(m, H)).join('') : '<div class="vacio">Nada con ese filtro.</div>';
}
function conectarMaestro(el, H) {
  pintarFilas(H);
  const q = $('fin-q');
  if (q) q.addEventListener('input', () => { st.q = q.value; pintarFilas(H); });
  el.querySelectorAll('[data-fin-filtro]').forEach(b => b.addEventListener('click', () => {
    st.filtro = b.dataset.finFiltro; el.querySelectorAll('[data-fin-filtro]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarFilas(H);
  }));
  const filas = $('fin-filas');
  if (filas) filas.addEventListener('click', ev => { const b = ev.target.closest('[data-fin-mp]'); if (b) editar(b.dataset.finMp, el, H, 'mp'); });
  if ($('fin-mp-nueva')) $('fin-mp-nueva').addEventListener('click', () => dialogoAlta(el, H, { volver: 'mp' }));
  // v0.73.0: "Traer precios desde la planilla" ya no tiene botón (la planilla no se actualiza); traer() queda sin uso
  if ($('fin-traer')) $('fin-traer').addEventListener('click', () => traer(el, H));
}

// ── Traer precios desde la planilla: vista previa → confirmar ──
async function traer(el, H) {
  const btn = $('fin-traer'); st.msg = ''; st.err = ''; $('fin-msg').textContent = ''; $('fin-err').textContent = '';
  btn.disabled = true; btn.lastChild.textContent = ' Leyendo la planilla…';
  let r;
  try { r = await F.prepararCarga(); } catch (e) { $('fin-err').textContent = error(e, H); btn.disabled = false; btn.lastChild.textContent = ' Traer precios desde la planilla'; return; }
  btn.disabled = false; btn.lastChild.textContent = ' Traer precios desde la planilla';
  const p = r.plan, total = p.nuevas.length + p.cambian.length + p.metadatos.length;
  const li = (xs, f) => xs.length ? `<ul class="fin-prev-lista">${xs.map(f).join('')}</ul>` : '';
  const precioTxt = d => d.tipo === 'sub_receta' ? 'sub receta' : `${d.precioNeto > 0 ? FC.pesos(d.precioNeto) : 'sin precio'} por ${FC.textoContenido(d.contenido)}`;
  const det = (t, n, cuerpo, abierto) => n ? `<details class="fin-prev" ${abierto ? 'open' : ''}><summary>${t} <span class="chip c-gris chip-chico">${nf(n)}</span></summary>${cuerpo}</details>` : '';
  const d = H.dialogo(`<form method="dialog" class="form-dialogo" id="fin-prev-form">
    <h2>Traer precios desde la planilla</h2>
    <p class="ayuda">Se leyeron ${nf(r.filas)} filas de MP_maestro${r.prodError ? '' : ' y la lista de Producción'}. Todavía no se guardó nada.</p>
    ${r.prodError ? '<p class="aviso">No se pudo leer la lista de Producción: se usan los nombres y estados de la planilla.</p>' : ''}
    <div class="fin-prev-cifras">
      <div><b>${nf(p.nuevas.length)}</b><span>nuevas</span></div><div><b>${nf(p.cambian.length)}</b><span>cambian de precio</span></div>
      <div><b>${nf(p.respetadas.length)}</b><span>se respetan (a mano o SII)</span></div><div><b>${nf(p.conProblema)}</b><span>con problemas</span></div></div>
    ${det('Nuevas', p.nuevas.length, li(p.nuevas, x => `<li><b>${H.esc(x.doc.nombre)}</b> · ${H.esc(precioTxt(x.doc))}${x.doc.contenidoProblema ? ` <span class="chip c-rojo chip-chico">${H.esc(x.doc.contenidoProblema)}</span>` : ''}</li>`), p.nuevas.length <= 12)}
    ${det('Cambian en la planilla', p.cambian.length, li(p.cambian, x => `<li><b>${H.esc(x.nombre)}</b> · ${H.esc(precioTxt(x.antes))} → ${H.esc(precioTxt(x.doc))} <span class="ayuda">(${H.esc(x.cambios.join(', '))})</span></li>`), true)}
    ${det('Se respetan: tienen precio a mano o del SII (no se tocan)', p.respetadas.length, li(p.respetadas, x => `<li><b>${H.esc(x.nombre)}</b> · queda ${H.esc(precioTxt(x.actual))} (${H.esc(ORIGEN[x.origen] || x.origen)}); la planilla dice ${H.esc(precioTxt(x.planilla))}</li>`), true)}
    ${det('Cambian solo nombre, tipo o estado', p.metadatos.length, li(p.metadatos, x => `<li><b>${H.esc(x.nombre)}</b></li>`), false)}
    ${p.sinId.length ? `<p class="aviso">Ids que no se pueden usar (se saltan): ${H.esc(p.sinId.join(', '))}</p>` : ''}
    ${total ? '' : `<p class="ok-texto">Todo igual a la planilla${p.respetadas.length ? ' (salvo las que tienen precio a mano o del SII, que se respetan)' : ''}.</p>`}
    <p class="error" id="fin-prev-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fin-prev-no">${total ? 'Cancelar' : 'Cerrar'}</button>${total ? `<button type="button" class="btn" id="fin-prev-si">Guardar ${nf(total)} ${total === 1 ? 'cambio' : 'cambios'}</button>` : ''}</div></form>`);
  d.querySelector('#fin-prev-no').addEventListener('click', () => d.close());
  const si = d.querySelector('#fin-prev-si');
  if (si) si.addEventListener('click', async () => {
    si.disabled = true; si.textContent = 'Guardando…';
    try {
      await F.aplicarCarga(p);
      H.registrar('Finanzas: trajo precios desde la planilla', `${p.nuevas.length} nuevas, ${p.cambian.length} con cambios, ${p.respetadas.length} respetadas`);
      st.msg = `Listo: ${nf(p.nuevas.length)} nuevas, ${nf(p.cambian.length)} con precio nuevo${p.respetadas.length ? `, ${nf(p.respetadas.length)} respetadas` : ''}.`;
      d.close(); await recargar(); pintarCostos(el, 'mp', H);
    } catch (e) { d.querySelector('#fin-prev-err').textContent = error(e, H); si.disabled = false; si.textContent = `Guardar ${nf(total)} cambios`; }
  });
}

// ── Editar un precio (con motivo) e historial ──
function enUnidadLectura(c) {
  if (!FC.contenidoValido(c)) return { cantidad: '', unidad: 'kg' };
  if (c.unidad === 'g') return c.cantidad >= 1000 ? { cantidad: c.cantidad / 1000, unidad: 'kg' } : { cantidad: c.cantidad, unidad: 'g' };
  if (c.unidad === 'ml') return c.cantidad >= 1000 ? { cantidad: c.cantidad / 1000, unidad: 'l' } : { cantidad: c.cantidad, unidad: 'ml' };
  return { cantidad: c.cantidad, unidad: 'un' };
}
function editar(id, el, H, volver) {
  const m = st.datos.costos[id]; if (!m) return;
  const esSub = m.tipo === 'sub_receta', c = enUnidadLectura(m.contenido), lec = m.contenido ? FC.porLectura(m.precioPorBase, m.contenido.unidad) : null;
  const pr = FC.problemasMp(m);
  const d = H.dialogo(`<form class="form-dialogo" id="fin-ed" novalidate>
    <h2>${H.esc(m.nombre)}</h2>
    <p class="ayuda">${TIPO[m.tipo] || ''} · ${H.esc(id)} · unidad de compra: <b>${H.esc(m.unidadCompra || '—')}</b>${m.impAdicionalPct ? ` · impuesto adicional ${nf(m.impAdicionalPct)} % (no se suma al costo)` : ''}${m.estado === 'archivada' ? ' · <span class="chip c-gris chip-chico">Archivada</span>' : ''}</p>
    ${!esSub && mpDe(id) ? `<button type="button" class="btn-sec mpa-datos-btn" id="fin-ed-datos">${ic('lapiz', 16)} Nombre, categoría y áreas · ${H.esc(MA.textoAreas(mpDe(id).areas))}</button>` : ''}
    ${pr.length ? `<p class="aviso">${pr.map(p => H.esc(p.texto)).join(' · ')}</p>` : ''}
    ${m.contenidoNota ? `<p class="ayuda">${H.esc(m.contenidoNota)}</p>` : ''}
    <p class="fin-actual">Ahora: ${esSub ? 'se calcula de su receta' : `${m.precioNeto > 0 ? FC.pesos(m.precioNeto) + ' neto' : 'sin precio'} por ${FC.textoContenido(m.contenido)}${lec ? ` → <b>${lec.texto}</b>` : ''}`} · ${origenTxt(m, H)} ${fechaTxt(m.fecha)}</p>
    ${esSub ? '<p class="aviso">El costo de una sub receta se calcula de su receta: míralo en Costos → Productos. Aquí no se edita.</p>' : `
    <div class="grilla-montos">
      <div class="campo"><label for="fin-precio">Precio por unidad de compra</label><input id="fin-precio" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${m.precioNeto > 0 ? H.esc(String(m.precioNeto)) : ''}" required>
        <label class="check fin-check"><input type="checkbox" id="fin-coniva"> Lo escribo con IVA (19 %) ${H.info('Precio con IVA', 'Si copias el precio de una boleta o de la góndola, marca esta casilla: se guarda el neto (precio ÷ 1,19). Todo en Finanzas va en neto.')}</label></div>
      <div class="campo"><span class="rotulo-campo" id="fin-cont-l">Una unidad de compra trae</span>
        <div class="fin-cont" role="group" aria-labelledby="fin-cont-l"><label class="sr" for="fin-cant">Cantidad</label><input id="fin-cant" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${H.esc(String(c.cantidad))}">
        <label class="sr" for="fin-uni">Unidad</label><select id="fin-uni">${['kg', 'g', 'l', 'ml', 'un'].map(u => `<option value="${u}" ${u === c.unidad ? 'selected' : ''}>${u === 'un' ? 'unidades' : u}</option>`).join('')}</select></div></div>
    </div>
    <div class="campo ${c.unidad === 'un' ? '' : 'oculto'}" id="fin-peso-c"><label for="fin-peso">Peso de una unidad, en gramos (opcional)</label><input id="fin-peso" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${m.pesoPorUnidad > 0 ? H.esc(String(m.pesoPorUnidad)) : ''}"><span class="ayuda">Solo si alguna receta la usa en gramos (por ejemplo, huevos).</span></div>
    <p class="fin-calc" id="fin-calc" aria-live="polite"></p>
    <div class="campo"><label for="fin-motivo">Motivo del cambio</label><input id="fin-motivo" type="text" maxlength="160" placeholder="Ej.: factura nueva del proveedor" required></div>
    <p class="error" id="fin-ed-err" role="alert"></p>`}
    <div class="botones"><button type="button" class="btn-sec" id="fin-ed-no">${esSub ? 'Cerrar' : 'Cancelar'}</button>${esSub ? '' : '<button type="submit" class="btn" id="fin-ed-si">Guardar</button>'}</div>
    <div class="fin-hist"><h3>Historial ${H.info('Historial de precios', 'Cada cambio de precio o contenido queda aquí con su fecha, origen, motivo y quién lo hizo. No se borra ni se edita.')}</h3><div id="fin-hist-lista"><p class="ayuda">Cargando…</p></div></div>
  </form>`);
  d.querySelector('#fin-ed-no').addEventListener('click', () => d.close());
  if (d.querySelector('#fin-ed-datos')) d.querySelector('#fin-ed-datos').addEventListener('click', () => { d.close(); dialogoDatos(id, el, H, volver); });
  F.historial(id).then(hs => {
    const c2 = d.querySelector('#fin-hist-lista'); if (!c2) return;
    c2.innerHTML = hs.length ? `<ul class="fin-hist-lista">${hs.map(h => { const l = h.contenido ? FC.porLectura(h.precioPorBase, h.contenido.unidad) : null; return `<li><div><b>${fechaTxt(h.fecha)}</b> · ${h.precioNeto > 0 ? FC.pesos(h.precioNeto) : 'sin precio'} por ${FC.textoContenido(h.contenido)}${l ? ` (${l.texto})` : ''}</div><span class="ayuda">${ORIGEN[h.origen] || H.esc(h.origen || '')} · ${H.esc(h.motivo || '')}${h.por ? ` · ${H.esc(h.por)}` : ''}</span></li>`; }).join('')}</ul>` : '<p class="ayuda">Sin cambios todavía.</p>';
  }).catch(e => { const c2 = d.querySelector('#fin-hist-lista'); if (c2) c2.innerHTML = `<p class="error">${H.esc(error(e, H))}</p>`; });
  if (esSub) return;
  const leerForm = () => ({ precioNeto: FC.casilla(d.querySelector('#fin-precio')), conIva: d.querySelector('#fin-coniva').checked, contenido: { cantidad: FC.casilla(d.querySelector('#fin-cant')), unidad: d.querySelector('#fin-uni').value }, pesoPorUnidad: FC.casilla(d.querySelector('#fin-peso')), motivo: d.querySelector('#fin-motivo').value });
  const calc = () => {
    const x = leerForm(); d.querySelector('#fin-peso-c').classList.toggle('oculto', x.contenido.unidad !== 'un');
    let t = '';
    try {
      const { doc } = FC.edicion({ ...m, id }, { ...x, motivo: x.motivo || '-' });
      const l = FC.porLectura(doc.precioPorBase, doc.contenido.unidad), v = FC.variacion(doc.precioPorBase, m.precioPorBase);
      t = `${x.conIva ? `Neto: ${FC.pesos(doc.precioNeto)} · ` : ''}Precio por ${l.por}: ${l.texto}${v && v.dir !== 'igual' ? ` (${FC.textoVariacion(v)} contra ahora)` : ''}`;
    } catch (e) { t = ''; }
    d.querySelector('#fin-calc').textContent = t;
  };
  ['#fin-precio', '#fin-coniva', '#fin-cant', '#fin-uni'].forEach(s => d.querySelector(s).addEventListener('input', calc));
  d.querySelector('#fin-uni').addEventListener('change', calc);
  calc();
  d.querySelector('#fin-ed').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#fin-ed-err'), b = d.querySelector('#fin-ed-si'); err.textContent = '';
    const x = leerForm();
    try { FC.edicion({ ...m, id }, x); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await F.guardarPrecio(id, x);
      H.registrar('Finanzas: cambió un precio', `${m.nombre}: ${x.motivo}`);
      st.msg = `${m.nombre}: precio guardado.`; st.err = '';
      d.close(); await recargar(); pintarCostos(el, volver, H);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
}

// ═══════════════ v0.76.0 · Nueva materia prima o insumo · Nombre, categoría y áreas · Crear desde una línea del SII ═══════════════
// La base de Cocina (fen-produccion mps) es la maestra (todas, con cualquier estado); el precio va al maestro de costos (aquí).
const mpsCocina = () => (st.prod && Array.isArray(st.prod.mps) ? st.prod.mps : []);
const mpDe = id => mpsCocina().find(m => m.id === id) || null;
const categoriasCocina = () => MA.categoriasDe(mpsCocina());   // v0.137.2: una por clave (sin repetidas por tildes o plural)
const ESTADO_CHIP = { activa: '', inactiva: '<span class="chip c-amarillo chip-chico">inactiva</span>', archivada: '<span class="chip c-gris chip-chico">archivada</span>', reemplazada: '<span class="chip c-gris chip-chico">reemplazada</span>' };
const TXT_AREAS = 'Las áreas de Cocina que la ven para elegirla en sus recetas.\nSi no marcas ninguna, sirve para todas las áreas (Panadería, Bollería, Pastelería y Cafetería).\nSi después un área la necesita, la puede pedir desde Cocina ("Falta una materia prima") o la habilitas aquí.';
const TXT_NOMBRE = 'Las recetas guardan el ID de la materia prima (por ejemplo MP012), no el nombre: cambiarlo no rompe nada.\nEl nombre nuevo se ve en Cocina al elegir ingredientes y en las recetas que la usan (se cambia también la copia del nombre en esas recetas), y en Finanzas.\nNo puede repetirse con otra (sin importar mayúsculas ni tildes), aunque esa esté archivada.';
const TXT_ARCHIVAR = 'Archivar la saca de las listas de Cocina para elegir y para pedir; no se borra nada: sus precios, su historial y las recetas archivadas que la usaban quedan.\nNo se puede archivar si una receta viva (no archivada) la usa como ingrediente o insumo: cámbiala en esas recetas o archívalas primero.\nReactivar la deja activa otra vez, con sus mismas áreas.';
// Las parecidas: modo 'usar' (asociar: elige esa en el selector), 'abrir' (abre sus datos) o 'asociar' (asocia la línea a esa)
function htmlParecidas(top, H, modo) {
  if (!top.length) return '';
  const acc = { usar: 'Usar esta', abrir: 'Abrir esa', asociar: 'Asociar a esta' }[modo];
  return `<div class="mpa-sug" role="group" aria-label="Las más parecidas"><span class="rotulo-campo">${modo === 'usar' ? 'Las más parecidas' : '¿Es alguna de estas?'} ${H.info('Las más parecidas', 'Las 3 materias primas o insumos con el nombre más parecido (palabras en común, también abreviaturas de factura como HNA = harina, y letras en común).\nSi el proveedor la llama distinto, elige la que ya existe: así no queda repetida. Lo que asocias se aprende para las próximas facturas de ese proveedor.')}</span>
    ${top.map(x => `<button type="button" class="mpa-sug-btn" data-mpa-${modo}="${H.esc(x.id)}" aria-pressed="false"><span><b>${H.esc(x.nombre)}</b> <span class="ayuda">${H.esc(x.id)}${x.tipo === 'insumo' ? ' · insumo' : ''}</span> ${ESTADO_CHIP[x.estado] || ''}</span><span class="mpa-sug-acc">${x.estado === 'archivada' && modo === 'asociar' ? 'Abrir esa' : acc}</span></button>`).join('')}</div>`;
}
const checksAreas = (pre, sel, H) => `<fieldset class="mpa-areas"><legend class="rotulo-campo">Áreas habilitadas ${H.info('Áreas habilitadas', TXT_AREAS)}</legend>
  <div class="mpa-areas-ch">${Object.entries(MA.AREAS).map(([k, n]) => `<label class="check"><input type="checkbox" name="${pre}-area" value="${k}" ${(sel || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
  <span class="ayuda" id="${pre}-areas-txt"></span></fieldset>`;
const leerAreas = (d, pre) => [...d.querySelectorAll(`input[name="${pre}-area"]:checked`)].map(x => x.value);

// g (opcional): el producto de Compras del SII (Crear desde esta línea). volver: 'mp' | 'compras'
function dialogoAlta(el, H, { g = null, volver = 'mp' } = {}) {
  const mps = mpsCocina(), u = g && g.ultima, pre = g ? MA.desdeLinea(g) : { nombre: '', tipo: 'mp', unidad: 'kg', contenido: { cantidad: 1000, unidad: 'g' }, precioNeto: null, categoria: '', areas: [] };
  const c0 = MA.enForm(pre.contenido), cats = categoriasCocina();
  const notaCont = g ? (pre.contenido ? (pre.contenidoDe === 'unidad' ? `La factura cobra por ${H.esc(u.unidad)}: una unidad trae ${FC.textoContenido(pre.contenido)}.` : `Leído del nombre: ${FC.textoContenido(pre.contenido)}.`) + (pre.contenidoDudoso ? ` ${H.esc(pre.contenidoMotivo)}` : '') : H.esc(pre.contenidoMotivo || 'No dice cuánto trae una unidad: escríbelo.')) : '';
  const d = H.dialogo(`<form class="form-dialogo mpa" id="mpa-f" novalidate>
    <h2>${g ? 'Crear desde esta línea' : 'Nueva materia prima o insumo'}</h2>
    ${g ? `<p class="fin-actual"><b>${H.esc(g.nombreItem)}</b></p>
      <p class="ayuda">${H.esc(g.proveedor || '')} · ${H.esc(g.rut)}${g.codigo ? ` · cód. ${H.esc(g.codigo)}` : ''} · última compra: ${cantTxt(u.cantidad)} ${H.esc(u.unidad || 'un')} a ${g.precioUnitario ? FC.pesos(g.precioUnitario) : '—'} neto c/u (${fechaTxt(u.fecha)}, F.${H.esc(u.folio)})</p>`
      : '<p class="ayuda">Queda en la base de Cocina (con el ID que sigue) y su precio aquí. Las jefas la ven para elegirla en sus recetas, sin precio.</p>'}
    <div class="campo"><label for="mpa-nombre">Nombre</label><input id="mpa-nombre" maxlength="${MA.MAX_NOMBRE}" autocomplete="off" spellcheck="false" value="${H.esc(pre.nombre)}" required>
      <div id="mpa-rep" class="mpa-rep" role="status" aria-live="polite"></div></div>
    <div id="mpa-sug-c" aria-live="polite"></div>
    <fieldset class="fin-as-tipo"><legend class="rotulo-campo">Es</legend>
      <label class="check"><input type="radio" name="mpa-tipo" value="mp" ${pre.tipo === 'insumo' ? '' : 'checked'}> Materia prima (va en la receta)</label>
      <label class="check"><input type="radio" name="mpa-tipo" value="insumo" ${pre.tipo === 'insumo' ? 'checked' : ''}> Insumo (envase, etiqueta, desechable…)</label></fieldset>
    <div class="campo"><label for="mpa-cat">Categoría</label>${CC.htmlCategoria(H, 'mpa-cat', pre.categoria, cats)}</div>
    <div class="grilla-montos">
      <div class="campo"><label for="mpa-uni">Unidad de compra ${H.info('Unidad de compra', 'Cómo la compras: kg, 25kg (un saco), lt, 500ml, un, 10un (un paquete de 10)…\nAl lado va lo que trae esa unidad, en peso, volumen o unidades: con eso sale el precio por kg, l o unidad que usa el costeo.' + (g ? '\nAquí la unidad de compra es la de la factura: lo que trae una unidad facturada.' : ''))}</label>
        <input id="mpa-uni" maxlength="20" autocomplete="off" spellcheck="false" placeholder="kg, 25kg, lt, un, 10un" value="${H.esc(pre.unidad)}"></div>
      <div class="campo"><span class="rotulo-campo" id="mpa-cont-l">${g ? 'Una unidad de la factura trae' : 'Una unidad de compra trae'}</span>
        <div class="fin-cont" role="group" aria-labelledby="mpa-cont-l"><label class="sr" for="mpa-cant">Cantidad</label><input id="mpa-cant" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${H.esc(String(c0.cantidad))}">
        <label class="sr" for="mpa-cuni">Unidad</label><select id="mpa-cuni">${['kg', 'g', 'l', 'ml', 'un'].map(x => `<option value="${x}" ${x === c0.unidad ? 'selected' : ''}>${x === 'un' ? 'unidades' : x}</option>`).join('')}</select></div>
        <span class="ayuda" id="mpa-cont-nota">${notaCont}</span></div>
    </div>
    <div class="campo"><label for="mpa-precio">Precio neto de la unidad de compra</label><input id="mpa-precio" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${pre.precioNeto > 0 ? H.esc(String(pre.precioNeto)) : ''}" required>
      <label class="check fin-check"><input type="checkbox" id="mpa-coniva"> Lo escribo con IVA (19 %) ${H.info('Precio con IVA', 'Si copias el precio de una boleta o de la góndola, marca esta casilla: se guarda el neto (precio ÷ 1,19). Todo en Finanzas va en neto.')}</label>
      ${g ? '<span class="ayuda">El neto de la última compra (con su descuento). Si lo cambias, queda como precio "A mano".</span>' : ''}</div>
    <p class="fin-calc" id="mpa-calc" aria-live="polite"></p>
    ${checksAreas('mpa', pre.areas, H)}
    <p class="error" id="mpa-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="mpa-no">Cancelar</button><button type="submit" class="btn" id="mpa-si">${g ? 'Crear y asociar' : 'Crear'}</button></div>
  </form>`);
  const q = s2 => d.querySelector(s2);
  q('#mpa-no').addEventListener('click', () => d.close());
  CC.conectarCategoria(d, cats);   // v0.137.2
  let contTocado = false;   // si escribes el contenido a mano, la unidad de compra ya no lo cambia
  const leer = () => ({ nombre: q('#mpa-nombre').value, tipo: (d.querySelector('input[name="mpa-tipo"]:checked') || {}).value, categoria: CC.leerCategoria(d, 'mpa-cat'), unidad: q('#mpa-uni').value,
    contenido: { cantidad: FC.casilla(q('#mpa-cant')), unidad: q('#mpa-cuni').value }, precio: FC.casilla(q('#mpa-precio')), conIva: q('#mpa-coniva').checked, areas: leerAreas(d, 'mpa') });
  const abrirOtra = (id, modo) => {
    d.close();
    if (modo === 'asociar' && g && st.datos.costos[id] && st.datos.costos[id].estado !== 'archivada') return asociar(g.clave, el, H, { elegir: id });
    dialogoDatos(id, el, H, volver);
  };
  const conectarSug = () => d.querySelectorAll('[data-mpa-abrir], [data-mpa-asociar]').forEach(b => b.addEventListener('click', () => abrirOtra(b.dataset.mpaAbrir || b.dataset.mpaAsociar, b.dataset.mpaAsociar ? 'asociar' : 'abrir')));
  const nombreCambio = () => {
    const n = q('#mpa-nombre').value, rep = MA.repetida(n, mps), box = q('#mpa-rep');
    box.innerHTML = rep ? `<p class="aviso">Ya existe <b>${H.esc(rep.nombre)}</b> (${H.esc(rep.id)}${MA.estadoDe(rep) !== 'activa' ? `, ${H.esc(MA.estadoDe(rep))}` : ''}).${MA.esSub(rep) ? ' Es una sub receta: elige otro nombre.' : ` <button type="button" class="btn-sec" data-mpa-${g && MA.estadoDe(rep) !== 'archivada' && st.datos.costos[rep.id] ? 'asociar' : 'abrir'}="${H.esc(rep.id)}">${g && MA.estadoDe(rep) !== 'archivada' && st.datos.costos[rep.id] ? 'Asociar a esa' : MA.estadoDe(rep) === 'activa' ? 'Abrir esa' : 'Abrir esa para reactivarla'}</button>`}</p>` : '';
    const top = rep ? [] : MA.similares(n, mps, { excepto: '' });
    q('#mpa-sug-c').innerHTML = htmlParecidas(top, H, g ? 'asociar' : 'abrir');
    conectarSug();
  };
  const unidadCambio = () => {
    if (contTocado) return calc();
    const r = MA.contenidoDeUnidad(q('#mpa-uni').value);
    if (r.contenido) { const f = MA.enForm(r.contenido); q('#mpa-cant').value = f.cantidad; q('#mpa-cuni').value = f.unidad; }
    q('#mpa-cont-nota').textContent = r.dudoso ? `${r.motivo} Escribe lo que trae la unidad que pagas a ese precio.` : '';
    calc();
  };
  const calc = () => {
    const x = leer(), c = FS.contenidoDesdeForm(x.contenido.cantidad, x.contenido.unidad);
    let neto = FC.num(x.precio); if (x.conIva) neto = neto / 1.19;
    const ppb = FC.precioPorBase(neto, c), l = c && ppb ? FC.porLectura(ppb, c.unidad) : null;
    q('#mpa-calc').textContent = l ? `${x.conIva ? `Neto: ${FC.pesos(neto)} · ` : ''}Precio por ${l.por}: ${l.texto}` : '';
    q('#mpa-areas-txt').textContent = x.areas.length ? `La ven: ${MA.textoAreas(x.areas)}.` : 'Sin marcar: la ven todas las áreas.';
  };
  q('#mpa-nombre').addEventListener('input', () => { q('#mpa-err').textContent = ''; nombreCambio(); });
  q('#mpa-uni').addEventListener('input', unidadCambio);
  ['#mpa-cant', '#mpa-cuni'].forEach(s2 => { q(s2).addEventListener('input', () => { contTocado = true; calc(); }); q(s2).addEventListener('change', () => { contTocado = true; calc(); }); });
  ['#mpa-precio', '#mpa-coniva'].forEach(s2 => q(s2).addEventListener('input', calc));
  d.querySelectorAll('input[name="mpa-area"]').forEach(x => x.addEventListener('change', calc));
  q('#mpa-coniva').addEventListener('change', calc);
  nombreCambio(); calc();
  q('#mpa-f').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = q('#mpa-err'), b = q('#mpa-si'), x = leer(); err.textContent = '';
    try { MA.validarAlta(x, mps); } catch (e) { err.textContent = e.message; if (e.code === 'existe') nombreCambio(); return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = g ? await F.crearDesdeLinea(g, x) : await F.crearMateriaPrima(x);
      const v = r.v, lec = FC.porLectura(FC.precioPorBase(v.precioNeto, v.contenido), v.contenido.unidad);
      H.registrar(g ? 'Finanzas: creó una materia prima desde una compra del SII' : 'Finanzas: creó una materia prima', `${v.nombre} (${r.id}) · ${MA.TIPOS[v.tipo]} · ${FC.pesos(v.precioNeto)} neto por ${v.unidad} · ${MA.textoAreas(v.areas)}${g ? ` · ${g.proveedor} · ${g.nombreItem}` : ''}`);
      st.msg = `${v.nombre} quedó creada (${r.id}) con su precio${lec ? `: ${lec.texto}` : ''}.${g ? ` ${g.nombreItem} quedó asociado a ella (se aprende para las próximas facturas).` : ''} Cocina ya la ve${v.areas.length ? ` en ${MA.textoAreas(v.areas)}` : ' en todas las áreas'}.`; st.err = '';
      st.creadaMp = g ? st.msg : '';
      if (g && !r.revision) st.err = 'No se pudieron revisar los precios de las compras ahora: toca "Revisar compras" cuando quieras.';
      d.close(); await recargar(volver === 'compras'); pintarCostos(el, volver, H);
    } catch (e) {
      if (e.code === 'sin_precio') { H.registrar('Finanzas: creó una materia prima', `${x.nombre} (${e.id}) · sin precio`); st.err = error(e, H); d.close(); await recargar(volver === 'compras').catch(() => {}); pintarCostos(el, volver, H); return; }
      err.textContent = error(e, H); b.disabled = false; b.textContent = g ? 'Crear y asociar' : 'Crear';
      if (e.code === 'existe') nombreCambio();
    }
  });
}

// Nombre, categoría y áreas · archivar o reactivar (con su historial, que vive en el documento de la base de Cocina)
function dialogoDatos(id, el, H, volver = 'mp') {
  const m = mpDe(id);
  if (!m) { st.err = `${id} no está en la base de Cocina (o no se pudo leer). Toca Actualizar en Producción.`; pintarCostos(el, volver, H); return; }
  const est = MA.estadoDe(m), areas = MA.limpiarAreas(m.areas), cats = categoriasCocina();
  const usos = MA.usosVivos(id, (st.prod && st.prod.recetas) || []);
  const hs = [...(Array.isArray(m.historial) ? m.historial : [])].reverse();
  const d = H.dialogo(`<form class="form-dialogo mpa" id="mpd-f" novalidate>
    <h2>${H.esc(m.nombre)}</h2>
    <p class="ayuda">${MA.TIPOS[m.tipo === 'insumo' ? 'insumo' : 'mp']} · ${H.esc(id)} · se compra por ${H.esc(m.unidad || '—')} ${ESTADO_CHIP[est] || ''}</p>
    <div class="campo"><label for="mpd-nombre">Nombre ${H.info('Cambiar el nombre', TXT_NOMBRE)}</label><input id="mpd-nombre" maxlength="${MA.MAX_NOMBRE}" autocomplete="off" spellcheck="false" value="${H.esc(m.nombre)}">
      <div id="mpd-aviso" role="status" aria-live="polite"></div></div>
    <div class="campo"><label for="mpd-cat">Categoría</label>${CC.htmlCategoria(H, 'mpd-cat', m.categoria, cats)}</div>
    ${checksAreas('mpd', areas, H)}
    <p class="error" id="mpd-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="mpd-no">Cancelar</button><button type="submit" class="btn" id="mpd-si">Guardar</button></div>
    <div class="mpa-estado"><h3>${est === 'archivada' ? 'Archivada' : 'Archivar'} ${H.info('Archivar y reactivar', TXT_ARCHIVAR)}</h3>
      ${est === 'archivada' ? `<p class="ayuda">No aparece en Cocina para elegir ni para pedir${m.archivadaEn ? ` desde el ${fechaTxt(String(m.archivadaEn).slice(0, 10))}` : ''}.</p><button type="button" class="btn-sec" id="mpd-reactivar">${ic('revisar', 16)} Reactivar</button>`
        : usos.length ? `<p class="aviso" id="mpd-usos">No se puede archivar: ${usos.length === 1 ? 'la usa una receta viva' : `la usan ${usos.length} recetas vivas`}.</p><ul class="fin-prev-lista mpa-usos">${usos.map(r => `<li>${H.esc(r.nombre)} <span class="ayuda">${H.esc(MA.AREAS[r.area] || r.area)} · ${H.esc(r.id)}</span></li>`).join('')}</ul>`
        : `<p class="ayuda">${est === 'activa' ? 'Ninguna receta viva la usa.' : `Está ${H.esc(est)}.`}</p><button type="button" class="btn-sec" id="mpd-archivar">${ic('archivo', 16)} Archivar</button>`}
      ${est !== 'archivada' && est !== 'activa' ? `<button type="button" class="btn-sec" id="mpd-reactivar">${ic('revisar', 16)} Dejarla activa</button>` : ''}</div>
    <div class="fin-hist"><h3>Historial ${H.info('Historial', 'Lo que se le ha cambiado desde Sistema Fën (nombre, categoría, áreas, archivar o reactivar), con quién y cuándo. Los cambios de precio están en el historial de precios (toca su fila en la lista).')}</h3>
      ${hs.length ? `<ul class="fin-hist-lista">${hs.map(h => `<li><div><b>${fechaTxt(String(h.en || '').slice(0, 10))}</b> · ${H.esc(h.accion || '')}</div><span class="ayuda">${H.esc(h.detalle || '')}${h.por ? ` · ${H.esc(h.por)}` : ''}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios desde Sistema Fën todavía.</p>'}</div>
  </form>`);
  const q = s2 => d.querySelector(s2);
  q('#mpd-no').addEventListener('click', () => d.close());
  CC.conectarCategoria(d, cats);   // v0.137.2
  const aviso = () => {
    const n = q('#mpd-nombre').value, rep = MA.repetida(n, mpsCocina(), id), box = q('#mpd-aviso');
    const harina = /^harina/i.test(MA.normNombre(m.nombre)) && !/^harina/i.test(MA.normNombre(n));
    box.innerHTML = rep ? `<p class="aviso">Ya existe <b>${H.esc(rep.nombre)}</b> (${H.esc(rep.id)}${MA.estadoDe(rep) !== 'activa' ? `, ${H.esc(MA.estadoDe(rep))}` : ''}): elige otro nombre.</p>`
      : n.trim() && n.trim() !== m.nombre ? `<p class="ayuda">Las recetas guardan el ID (${H.esc(id)}): nada se rompe. Cocina muestra el nombre nuevo.${harina ? ' Ojo: Cocina reconoce las harinas porque su nombre empieza con "Harina" (para el % de panadero y los ajustes): si le sacas esa palabra, deja de contarla como harina.' : ''}</p>` : '';
    q('#mpd-areas-txt').textContent = leerAreas(d, 'mpd').length ? `La ven: ${MA.textoAreas(leerAreas(d, 'mpd'))}.` : 'Sin marcar: la ven todas las áreas.';
  };
  q('#mpd-nombre').addEventListener('input', aviso);
  d.querySelectorAll('input[name="mpd-area"]').forEach(x => x.addEventListener('change', aviso));
  aviso();
  const terminar = async msg => { st.msg = msg; st.err = ''; d.close(); await recargar(volver === 'compras'); pintarCostos(el, volver, H); };
  q('#mpd-f').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = q('#mpd-err'), b = q('#mpd-si'); err.textContent = '';
    const datos = { nombre: q('#mpd-nombre').value, categoria: CC.leerCategoria(d, 'mpd-cat') || undefined, areas: leerAreas(d, 'mpd') };
    let c;
    try { c = MA.cambioDatos(m, datos, mpsCocina()); } catch (e) { err.textContent = e.message; return; }
    if (!c) { d.close(); return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await F.editarMateriaPrima(id, datos);
      if (r) H.registrar('Finanzas: cambió una materia prima', `${m.nombre} (${id}) · ${r.cambios.join(' · ')}${r.recetas ? ` · nombre actualizado en ${r.recetas} ${r.recetas === 1 ? 'receta' : 'recetas'}` : ''}`);
      await terminar(`${datos.nombre.trim() || m.nombre}: guardado${r && r.recetas ? ` (y en ${r.recetas} ${r.recetas === 1 ? 'receta' : 'recetas'} que la usan)` : ''}.`);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
  const estado = archivar => async () => {
    const err = q('#mpd-err'); err.textContent = '';
    const btn = q(archivar ? '#mpd-archivar' : '#mpd-reactivar'); btn.disabled = true;
    try {
      const r = await F.archivarMateriaPrima(id, archivar);
      if (r) H.registrar(archivar ? 'Finanzas: archivó una materia prima' : 'Finanzas: reactivó una materia prima', `${m.nombre} (${id}) · ${r.antes} → ${r.estado}`);
      await terminar(archivar ? `${m.nombre}: archivada. Ya no aparece en Cocina para elegir ni para pedir.` : `${m.nombre}: activa otra vez. Cocina la ve en ${MA.textoAreas(m.areas)}.`);
    } catch (e) {
      err.textContent = error(e, H); btn.disabled = false;
    }
  };
  if (q('#mpd-archivar')) q('#mpd-archivar').addEventListener('click', estado(true));
  if (q('#mpd-reactivar')) q('#mpd-reactivar').addEventListener('click', estado(false));
}

// ── Revisión de datos ──
function htmlRevision(rv, H) {
  const lista = st.verRevisados ? rv.revisados : rv.pendientes;
  const sinProd = st.cx.prod.estado !== 'ok' || (st.prod && st.prod.error);
  const grupos = GRUPOS.map(([k, t, ayuda]) => {
    const xs = lista.filter(i => i.grupo === k);
    if (!xs.length) return '';
    return `<section class="tarjeta fin-grupo" aria-labelledby="t-fin-g-${k}">
      <div class="titulo-fila"><h2 id="t-fin-g-${k}">${t} ${H.info(t, ayuda)}</h2><span class="chip ${st.verRevisados ? 'c-gris' : 'c-rojo'}">${nf(xs.length)}</span></div>
      ${xs.map(i => { const marca = (st.datos.marcas || {})[FC.idRevision(i.clave)]; return `<div class="fila-caja fin-item"><div class="txt"><b>${H.esc(i.titulo)}</b><span>${H.esc(i.detalle)}</span>${st.verRevisados && marca && marca.revisado ? `<span class="ayuda">Revisado por ${H.esc(marca.revisado.por)} el ${fechaTxt(marca.revisado.fecha)}</span>` : ''}</div>
        <div class="acciones">${i.mp && st.datos.costos[i.mp] && ['sin_precio', 'contenido', 'raro', 'unidad'].includes(i.grupo) ? `<button type="button" class="btn-sec" data-fin-corregir="${H.esc(i.mp)}">Corregir</button>` : i.producto ? `<a class="btn-sec fin-enlace" href="#finanzas/costos/productos/r/${encodeURIComponent(i.producto)}">Ver costo</a>` : i.receta ? `<a class="btn-sec fin-enlace" href="#produccion/recetas/${encodeURIComponent(i.receta)}">Ver en Producción</a>` : ''}
        <button type="button" class="btn-sec" data-fin-rev="${H.esc(i.clave)}">${st.verRevisados ? 'Volver a la lista' : `${ic('check', 16)} Marcar revisado`}</button></div></div>`; }).join('')}
    </section>`;
  }).join('');
  return `<section class="tarjeta" aria-labelledby="t-fin-rev">
    <div class="titulo-fila fin-titulo"><h2 id="t-fin-rev">Revisión de datos ${H.info('Revisión de datos', 'Lista de lo que parece mal en el maestro de costos y en las recetas aprobadas: sin precio, contenido que no se entiende, precios raros, ingredientes sin costo, unidades que no calzan, recetas sin rendimiento y productos con costo incompleto.\n"Corregir" abre el precio de esa materia prima. Lo de las recetas se corrige en la receta.\nSi algo está bien así, márcalo "revisado": sale de la lista y vuelve solo si cambia.')}</h2>
      <button type="button" class="btn-sec" id="fin-ver-rev" aria-pressed="${st.verRevisados}">${st.verRevisados ? 'Ver pendientes' : `Ver revisados (${nf(rv.revisados.length)})`}</button></div>
    <p class="ayuda">${st.verRevisados ? `${nf(rv.revisados.length)} marcados como revisados.` : rv.pendientes.length ? `${nf(rv.pendientes.length)} por revisar.` : lista.length === 0 && Object.keys(st.datos.costos).length ? 'Nada por revisar.' : 'Trae los precios desde la planilla para empezar.'}</p>
    ${sinProd ? '<p class="aviso">Sin la base de Cocina no se revisan las recetas (solo el maestro de costos). Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : ''}
    <p class="ok-texto" id="fin-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="fin-err" role="alert"></p>
  </section>${grupos}`;
}
function conectarRevision(el, rv, H) {
  $('fin-ver-rev').addEventListener('click', () => { st.verRevisados = !st.verRevisados; st.msg = ''; pintarCostos(el, 'revision', H); });
  el.querySelectorAll('[data-fin-corregir]').forEach(b => b.addEventListener('click', () => editar(b.dataset.finCorregir, el, H, 'revision')));
  el.querySelectorAll('[data-fin-rev]').forEach(b => b.addEventListener('click', async () => {
    const it = [...rv.pendientes, ...rv.revisados].find(i => i.clave === b.dataset.finRev); if (!it) return;
    b.disabled = true;
    try {
      await F.marcarRevisado(it, !st.verRevisados);
      st.msg = st.verRevisados ? `${it.titulo}: vuelve a la lista.` : `${it.titulo}: revisado.`;
      await recargar(); pintarCostos(el, 'revision', H);
    } catch (e) { $('fin-err').textContent = error(e, H); b.disabled = false; }
  }));
}

// ═══════════════ v0.57.0 · Compras del SII: asociar productos de factura → materia prima, precios por confirmar ═══════════════
const C_FILTROS = [['sin_asociar', 'Sin asociar'], ['asociada', 'Asociadas'], ['ignorada', 'No son materia prima'], ['todas', 'Todas']];
const RESULTADO = { aplicada: 'Precio aplicado', por_confirmar: 'Precio por confirmar', igual: 'Es el precio actual', omitida: 'No cambió el precio' };
function gruposCompras() { const c = st.compras; return c ? FS.agrupar(c.lineas, c.asocs) : []; }
const lecturaPpb = (ppb, unidad) => { const l = FC.porLectura(ppb, unidad); return l ? l.texto : '—'; };
const cantTxt = n => Number(n || 0).toLocaleString('es-CL', { maximumFractionDigits: 3 });

function htmlCompras(H) {
  const c = st.compras;
  if (!c) return '<section class="tarjeta"><div class="vacio" style="border:0">Leyendo las compras del SII…</div></section>';
  const gs = gruposCompras(), cuenta = k => k === 'todas' ? gs.length : gs.filter(g => g.estado === k).length;
  if (!st.cFiltro) st.cFiltro = cuenta('sin_asociar') ? 'sin_asociar' : 'todas';
  const ult = c.ultimaRevision, pend = st.datos.porConfirmar || [];
  const info = H.info('Compras del SII', 'Aquí están los productos de las facturas del SII (tipo 33 y 34) de los últimos 90 días, agrupados por proveedor y producto.\nCada producto se asocia una vez a su materia prima o insumo, con lo que trae UNA unidad de la factura (una línea "HARINA SACO 25 KG" por 10 sacos → 25 kg por unidad). Se aprende: las próximas facturas de ese proveedor y producto se usan solas.\nEl precio de cada materia prima es el neto de su ÚLTIMA compra: precio de la línea (con su descuento) ÷ lo que trae una unidad, llevado a la unidad de compra de la materia prima.\nUn precio a mano más nuevo que la factura no se pisa. Si el precio cambia más de ±40 %, no se aplica solo: queda "por confirmar".\nSe revisa solo al importar un archivo del SII en Gastos (base nueva) y con el botón. Revisar de nuevo no repite nada.\nLas notas de crédito se muestran, pero no cambian precios. Gas, servicios, despacho…: márcalos "No es materia prima".');
  return `<section class="tarjeta" aria-labelledby="t-fin-compras">
    <div class="titulo-fila fin-titulo"><h2 id="t-fin-compras">Compras del SII ${info}</h2>
      <button type="button" class="btn-sec" id="fin-revisar">${ic('revisar', 18)} Revisar compras de los últimos 90 días</button></div>
    <p class="ayuda" id="fin-c-resumen">${nf(gs.length)} ${gs.length === 1 ? 'producto' : 'productos'} en facturas desde el ${fechaTxt(c.desde)} · ${nf(cuenta('sin_asociar'))} sin asociar · ${nf(cuenta('asociada'))} asociados · ${nf(cuenta('ignorada'))} no son materia prima · última revisión: ${ult ? `${fechaTxt(ult.fecha)} (${nf(ult.aplicadas)} ${ult.aplicadas === 1 ? 'precio aplicado' : 'precios aplicados'}${ult.porConfirmar ? `, ${nf(ult.porConfirmar)} por confirmar` : ''})` : '—'}</p>
    <p class="ok-texto" id="fin-msg" role="status">${H.esc(st.msg)}${st.creadaMp && st.creadaMp === st.msg ? ` <a href="#produccion/mp" id="fin-ver-mp">Verla en Producción → Materias primas</a>` : ''}</p><p class="error" id="fin-err" role="alert">${H.esc(st.err)}</p>
    ${c.sinDetalle.length ? `<details class="fin-prev fin-sindet"><summary>${ic('factura', 18)} ${nf(c.sinDetalle.length)} ${c.sinDetalle.length === 1 ? 'factura' : 'facturas'} sin detalle de productos</summary>
      <p class="aviso">Esta carga no trae el detalle de productos (sube el XML para actualizar precios).</p>
      <ul class="fin-prev-lista">${c.sinDetalle.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(d => `<li>${H.esc(d.proveedor || d.rut)} · F.${H.esc(d.folio)} · ${fechaTxt(d.fecha)}</li>`).join('')}</ul></details>` : ''}
  </section>
  ${pend.length ? `<section class="tarjeta fin-pend" aria-labelledby="t-fin-pend">
    <div class="titulo-fila"><h2 id="t-fin-pend">Precios por confirmar ${H.info('Precios por confirmar', 'El precio de la última compra cambia más de ±40 % contra el precio actual. Puede ser un alza real, o la asociación con un contenido mal escrito (por ejemplo, 1 kg en vez de 25 kg).\nConfirmar: aplica el precio de la factura (queda en el historial).\nDescartar: deja el precio como está; escribe el motivo. Si el contenido estaba mal, corrige la asociación y revisa de nuevo.')}</h2><span class="chip c-amarillo">${nf(pend.length)}</span></div>
    ${pend.map(p => { const u = p.nuevo && p.nuevo.contenido ? p.nuevo.contenido.unidad : 'g';
      return `<div class="fila-caja fin-item fin-conf" data-pc="${H.esc(p.id)}"><div class="txt"><b>${H.esc(p.mpNombre)}</b>
        <span class="fin-conf-precios">Ahora ${p.actual && p.actual.precioPorBase ? lecturaPpb(p.actual.precioPorBase, u) : 'sin precio'} → factura <b>${lecturaPpb(p.nuevo.precioPorBase, u)}</b>
          <span class="fin-var ${p.pct > 0 ? 'fin-sube' : 'fin-baja'}">${ic(p.pct > 0 ? 'sube' : 'baja', 14)}${p.pct > 0 ? '+' : '−'}${Math.abs(p.pct).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %</span></span>
        <span class="ayuda">${H.esc(p.sii.proveedor)} · F.${H.esc(p.sii.folio)} · ${fechaTxt(p.sii.fecha)} · ${H.esc(p.sii.nombreItem)}</span></div>
        <div class="acciones"><button type="button" class="btn-sec" data-pc-si="${H.esc(p.id)}">${ic('check', 16)} Confirmar</button><button type="button" class="btn-sec" data-pc-no="${H.esc(p.id)}">Descartar</button></div></div>`; }).join('')}
  </section>` : ''}
  <section class="tarjeta" aria-labelledby="t-fin-prods">
    <div class="titulo-fila"><h2 id="t-fin-prods">Productos de las facturas</h2></div>
    ${gs.length ? `<div class="filtros fin-filtros">
      <div class="fin-buscar">${ic('lupa', 18)}<label class="sr" for="fin-cq">Buscar producto o proveedor</label><input type="search" id="fin-cq" placeholder="Buscar producto o proveedor…" autocomplete="off" spellcheck="false" value="${H.esc(st.cQ)}"></div>
      <div class="chips" role="group" aria-label="Filtrar">${C_FILTROS.map(([k, t]) => `<button type="button" class="chip-filtro" data-fin-cf="${k}" aria-pressed="${st.cFiltro === k}">${t} <span class="fin-cuenta">${nf(cuenta(k))}</span></button>`).join('')}</div></div>
      <div id="fin-compras" class="fin-compras"></div>` : '<div class="vacio">No hay productos de facturas en los últimos 90 días. Se llenan al importar un archivo del SII (XML o XLS con detalle) en Gastos.</div>'}
  </section>`;
}
function filaCompra(g, H) {
  const c = st.compras, a = g.asoc, u = g.ultima;
  const pu = g.precioUnitario, pr = u ? c.procesadas[FS.idLinea(u.id)] : null;
  let estado = '';
  if (g.estado === 'sin_asociar') estado = '<span class="chip c-amarillo chip-chico">Sin asociar</span>';
  else if (g.estado === 'ignorada') estado = `<span class="chip c-gris chip-chico">${ic('no', 13)} No es materia prima</span>`;
  else {
    const ppb = u ? FS.precioPorBaseLinea(u, a.contenidoPorUnidad) : null, m = st.datos.costos[a.mp];
    estado = `<span class="fin-asoc">${ic('enlace', 14)} <b>${H.esc((m && m.nombre) || a.mpNombre || a.mp)}</b></span><span class="ayuda">${FC.textoContenido(a.contenidoPorUnidad)} por unidad${ppb ? ` · ${lecturaPpb(ppb, a.contenidoPorUnidad.unidad)}` : ''}</span>`
      + (pr && pr.huella === FS.huellaAsoc(a) ? `<span class="ayuda fin-res">${H.esc(RESULTADO[pr.resultado] || '')}${pr.motivo && pr.resultado !== 'aplicada' ? `: ${H.esc(pr.motivo)}` : ''}</span>` : '');
  }
  return `<div class="fin-compra">
    <div class="fin-c-prod"><b>${H.esc(g.nombreItem)}</b><span class="ayuda">${H.esc(g.proveedor || g.rut)}${g.codigo ? ` · cód. ${H.esc(g.codigo)}` : ''}</span></div>
    <div class="fin-c-ult">${u ? `<span>${pu ? FC.pesos(pu) : '—'} neto por ${H.esc(u.unidad || 'unidad')}</span><span class="ayuda">${cantTxt(u.cantidad)} ${H.esc(u.unidad || 'un')} · ${fechaTxt(u.fecha)} · F.${H.esc(u.folio)} · ${g.veces} ${g.veces === 1 ? 'compra' : 'compras'}</span>` : '<span class="ayuda">Solo en notas de crédito</span>'}
      ${g.ncs ? `<span class="ayuda">${g.ncs} ${g.ncs === 1 ? 'nota de crédito' : 'notas de crédito'} (no cambian el precio)</span>` : ''}</div>
    <div class="fin-c-est">${estado}</div>
    <div class="fin-c-acc">${u ? `<button type="button" class="btn-sec" data-fin-asoc="${H.esc(g.clave)}">${g.estado === 'sin_asociar' ? 'Asociar' : 'Cambiar'}</button>` : ''}${u && g.estado === 'sin_asociar' && st.cx.prod.estado === 'ok' ? `<button type="button" class="btn-link" data-fin-crear="${H.esc(g.clave)}">${ic('mas', 14)} Crear desde esta línea</button>` : ''}</div></div>`;
}
function pintarCompras(H) {
  const cont = $('fin-compras'); if (!cont) return;
  const xs = gruposCompras().filter(g => st.cFiltro === 'todas' || g.estado === st.cFiltro).filter(g => !normalizar(st.cQ) || coincide(`${g.nombreItem} ${g.proveedor} ${g.codigo} ${g.asoc && g.asoc.mpNombre || ''}`, st.cQ));
  cont.innerHTML = xs.length ? xs.map(g => filaCompra(g, H)).join('') : '<div class="vacio">Nada con ese filtro.</div>';
}
function conectarCompras(el, H) {
  if (!st.compras) { F.leerCompras().then(c => { st.compras = c; pintarCostos(el, 'compras', H); }).catch(e => { const x = $('fin-err'); if (x) x.textContent = error(e, H); else el.insertAdjacentHTML('beforeend', `<p class="error" role="alert">${H.esc(error(e, H))}</p>`); }); return; }
  pintarCompras(H);
  const q = $('fin-cq');
  if (q) q.addEventListener('input', () => { st.cQ = q.value; pintarCompras(H); });
  el.querySelectorAll('[data-fin-cf]').forEach(b => b.addEventListener('click', () => { st.cFiltro = b.dataset.finCf; el.querySelectorAll('[data-fin-cf]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarCompras(H); }));
  const lista = $('fin-compras');
  if (lista) lista.addEventListener('click', ev => {
    const b = ev.target.closest('[data-fin-asoc]'); if (b) { asociar(b.dataset.finAsoc, el, H); return; }
    const c = ev.target.closest('[data-fin-crear]'); if (c) { const g = gruposCompras().find(x => x.clave === c.dataset.finCrear); if (g) dialogoAlta(el, H, { g, volver: 'compras' }); }
  });
  $('fin-revisar').addEventListener('click', async () => {
    const b = $('fin-revisar'); b.disabled = true; b.lastChild.textContent = ' Revisando…'; $('fin-err').textContent = '';
    try { const r = await F.preciosDesdeSii({ origen: 'boton' }); H.registrar('Finanzas: revisó las compras del SII', resumenRevision(r)); st.msg = resumenRevision(r); st.err = ''; await recargar(true); pintarCostos(el, 'compras', H); }
    catch (e) { $('fin-err').textContent = error(e, H); b.disabled = false; b.lastChild.textContent = ' Revisar compras de los últimos 90 días'; }
  });
  el.querySelectorAll('[data-pc-si]').forEach(b => b.addEventListener('click', () => resolver(b.dataset.pcSi, true, el, H)));
  el.querySelectorAll('[data-pc-no]').forEach(b => b.addEventListener('click', () => resolver(b.dataset.pcNo, false, el, H)));
}
function resumenRevision(r) {
  const a = r.aplicadas.length;
  return `Listo: ${a ? `${nf(a)} ${a === 1 ? 'precio actualizado' : 'precios actualizados'} (${r.aplicadas.slice(0, 4).map(x => x.nombre).join(', ')}${a > 4 ? '…' : ''})` : 'ningún precio cambió'}${r.porConfirmar ? ` · ${nf(r.porConfirmar)} por confirmar` : ''}${r.sinAsociar ? ` · ${nf(r.sinAsociar)} ${r.sinAsociar === 1 ? 'producto' : 'productos'} sin asociar` : ''}.`;
}
// Confirmar (aplica) o descartar (con motivo) un cambio de más de ±40 %
function resolver(id, confirmar, el, H) {
  const p = (st.datos.porConfirmar || []).find(x => x.id === id); if (!p) return;
  const u = p.nuevo.contenido.unidad;
  const d = H.dialogo(`<form class="form-dialogo" id="fin-pc" novalidate>
    <h2>${confirmar ? 'Confirmar precio' : 'Descartar precio'}: ${H.esc(p.mpNombre)}</h2>
    <p class="fin-actual">Ahora ${p.actual && p.actual.precioPorBase ? lecturaPpb(p.actual.precioPorBase, u) : 'sin precio'} → factura <b>${lecturaPpb(p.nuevo.precioPorBase, u)}</b> (${p.pct > 0 ? '+' : '−'}${Math.abs(p.pct).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %)</p>
    <p class="ayuda">${H.esc(p.sii.proveedor)} · F.${H.esc(p.sii.folio)} · ${fechaTxt(p.sii.fecha)} · ${H.esc(p.sii.nombreItem)}. ${confirmar ? `Queda en ${FC.pesos(p.nuevo.precioNeto)} neto por ${FC.textoContenido(p.nuevo.contenido)}.` : 'El precio actual no cambia.'}</p>
    <div class="campo"><label for="fin-pc-mot">${confirmar ? 'Nota (opcional)' : 'Motivo'}</label><input id="fin-pc-mot" type="text" maxlength="200" ${confirmar ? 'placeholder="Ej.: alza real del proveedor"' : 'placeholder="Ej.: el contenido de la asociación estaba mal" required'}></div>
    <p class="error" id="fin-pc-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fin-pc-no">Cancelar</button><button type="submit" class="btn" id="fin-pc-si">${confirmar ? 'Confirmar' : 'Descartar'}</button></div></form>`);
  d.querySelector('#fin-pc-no').addEventListener('click', () => d.close());
  d.querySelector('#fin-pc').addEventListener('submit', async ev => {
    ev.preventDefault();
    const mot = d.querySelector('#fin-pc-mot').value, err = d.querySelector('#fin-pc-err'), b = d.querySelector('#fin-pc-si');
    if (!confirmar && !mot.trim()) { err.textContent = 'Escribe por qué lo descartas.'; return; }
    b.disabled = true;
    try {
      await F.resolverPorConfirmar(id, confirmar, mot);
      H.registrar(confirmar ? 'Finanzas: confirmó un precio del SII' : 'Finanzas: descartó un precio del SII', `${p.mpNombre} · ${p.sii.proveedor} F.${p.sii.folio}${mot ? ' · ' + mot : ''}`);
      st.msg = confirmar ? `${p.mpNombre}: precio confirmado (${lecturaPpb(p.nuevo.precioPorBase, u)}).` : `${p.mpNombre}: descartado, el precio no cambia.`; st.err = '';
      d.close(); await recargar(true); pintarCostos(el, 'compras', H);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; }
  });
}

// ── Asociar un producto de factura a su materia prima (o "no es materia prima") ──
const enForm = c => { if (!FC.contenidoValido(c)) return { cantidad: '', unidad: 'kg' }; return enUnidadLectura(c); };
function asociar(clave, el, H, { elegir = '' } = {}) {
  const g = gruposCompras().find(x => x.clave === clave); if (!g || !g.ultima) return;
  const a = g.asoc, u = g.ultima, costos = st.datos.costos;
  const leido = FS.contenidoDeLinea(u.descripcion, u.unidad);
  const c0 = enForm(a && a.contenidoPorUnidad ? a.contenidoPorUnidad : leido.contenido);
  const sug = FS.sugerirMp(g.nombreItem, costos), idsSug = new Set(sug.map(x => x.id));
  const elegibles = Object.values(costos).filter(m => m.tipo !== 'sub_receta' && m.estado !== 'archivada').sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
  const mpSel = elegir && costos[elegir] ? elegir : a && a.mp ? a.mp : (sug[0] ? sug[0].id : '');
  // v0.76.0: las 3 más parecidas (con abreviaturas de factura), para elegir la que ya existe en vez de crear otra
  const top = MA.similares(g.nombreItem, Object.values(costos), { activas: true });
  const opt = (m, t) => `<option value="${H.esc(m.id)}" ${m.id === mpSel ? 'selected' : ''}>${H.esc(t)}</option>`;
  const notaLeido = a && a.contenidoPorUnidad ? 'Lo que se guardó al asociarlo.' : leido.contenido ? (leido.de === 'unidad' ? `La factura cobra por ${H.esc(u.unidad)}: una unidad trae ${FC.textoContenido(leido.contenido)}.` : `Leído del nombre: ${FC.textoContenido(leido.contenido)}.`) + (leido.dudoso ? ` ${H.esc(leido.motivo)}` : '') : H.esc(leido.motivo);
  const ignorar = !!(a && a.ignorar);
  const d = H.dialogo(`<form class="form-dialogo" id="fin-as" novalidate>
    <h2>${a ? 'Cambiar asociación' : 'Asociar producto'}</h2>
    <p class="fin-actual"><b>${H.esc(g.nombreItem)}</b></p>
    <p class="ayuda">${H.esc(g.proveedor || '')} · ${H.esc(g.rut)}${g.codigo ? ` · cód. ${H.esc(g.codigo)}` : ''} · última compra: ${cantTxt(u.cantidad)} ${H.esc(u.unidad || 'un')} a ${g.precioUnitario ? FC.pesos(g.precioUnitario) : '—'} neto c/u (${fechaTxt(u.fecha)}, F.${H.esc(u.folio)})</p>
    <fieldset class="fin-as-tipo"><legend class="sr">Qué es</legend>
      <label class="check"><input type="radio" name="fin-as-t" value="mp" ${ignorar ? '' : 'checked'}> Es una materia prima o insumo</label>
      <label class="check"><input type="radio" name="fin-as-t" value="no" ${ignorar ? 'checked' : ''}> No es materia prima (gas, servicios, despacho…)</label></fieldset>
    <div id="fin-as-mp-c" class="${ignorar ? 'oculto' : ''}">
      <div class="campo"><label for="fin-as-mp">Materia prima o insumo</label><select id="fin-as-mp"><option value="">Elige…</option>
        ${sug.map(x => opt(costos[x.id], `${costos[x.id].nombre} · parecida`)).join('')}${elegibles.filter(m => !idsSug.has(m.id)).map(m => opt(m, m.nombre)).join('')}</select>
        ${sug.length ? '<span class="ayuda">Primero las de nombre parecido.</span>' : ''}</div>
      ${htmlParecidas(top, H, 'usar')}
      ${!a && st.cx.prod.estado === 'ok' ? `<button type="button" class="btn-link" id="fin-as-crear">${ic('mas', 14)} No está: crear desde esta línea</button>` : ''}
      <div class="campo"><span class="rotulo-campo" id="fin-as-cont-l">Una unidad de la factura trae ${H.info('Contenido por unidad', 'Lo que trae UNA unidad de la línea de la factura, no la línea completa. Ejemplos: "HARINA SACO 25 KG", 10 sacos → 25 kg. "MANTEQUILLA" en KG, 20 KG → 1 kg. "LECHE 1 LT X12" (una caja de 12) → 12 l.\nSe usa para sacar el precio por kg, l o unidad. Si la materia prima se compra por peso, aquí va peso (kg o g); si se compra por unidades, unidades.')}</span>
        <div class="fin-cont" role="group" aria-labelledby="fin-as-cont-l"><label class="sr" for="fin-as-cant">Cantidad</label><input id="fin-as-cant" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${H.esc(String(c0.cantidad))}">
        <label class="sr" for="fin-as-uni">Unidad</label><select id="fin-as-uni">${['kg', 'g', 'l', 'ml', 'un'].map(x => `<option value="${x}" ${x === c0.unidad ? 'selected' : ''}>${x === 'un' ? 'unidades' : x}</option>`).join('')}</select></div>
        <span class="ayuda">${notaLeido}</span></div>
      <p class="fin-calc" id="fin-as-calc" aria-live="polite"></p>
    </div>
    <div class="campo"><label for="fin-as-nota">Nota (opcional)</label><input id="fin-as-nota" type="text" maxlength="200"></div>
    <p class="error" id="fin-as-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="fin-as-no">Cancelar</button><button type="submit" class="btn" id="fin-as-si">Guardar</button></div>
    ${a ? `<div class="fin-hist"><h3>Historial de la asociación</h3><div id="fin-as-hist"><p class="ayuda">Cargando…</p></div></div>` : ''}
  </form>`);
  const sel = d.querySelector('#fin-as-mp');
  conBuscador(sel);
  d.querySelector('#fin-as-no').addEventListener('click', () => d.close());
  d.querySelectorAll('[data-mpa-usar]').forEach(b => b.addEventListener('click', () => {
    const bq = d.querySelector('.buscador input'); if (bq && bq.value) { bq.value = ''; bq.dispatchEvent(new Event('input')); }
    sel.value = b.dataset.mpaUsar; sel.dispatchEvent(new Event('change', { bubbles: true }));
    d.querySelectorAll('[data-mpa-usar]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  if (d.querySelector('#fin-as-crear')) d.querySelector('#fin-as-crear').addEventListener('click', () => { d.close(); dialogoAlta(el, H, { g, volver: 'compras' }); });
  const tipo = () => d.querySelector('input[name="fin-as-t"]:checked').value;
  const leer = () => ({ rut: g.rut, proveedor: g.proveedor, nombreItem: g.nombreItem, codigo: g.codigo, ignorar: tipo() === 'no', mp: tipo() === 'no' ? null : sel.value,
    contenido: { cantidad: FC.casilla(d.querySelector('#fin-as-cant')), unidad: d.querySelector('#fin-as-uni').value }, nota: d.querySelector('#fin-as-nota').value });
  const calc = () => {
    d.querySelector('#fin-as-mp-c').classList.toggle('oculto', tipo() === 'no');
    const x = leer(), out = d.querySelector('#fin-as-calc'), m = costos[x.mp];
    const cont = FS.contenidoDesdeForm(x.contenido.cantidad, x.contenido.unidad);
    if (x.ignorar || !m || !cont) { out.textContent = ''; return; }
    const cand = FS.candidato(u, { contenidoPorUnidad: cont });
    if (!(cand.ppb > 0)) { out.textContent = 'La última línea no trae precio o cantidad.'; return; }
    const r = FS.decidir({ ...m }, cand), lec = lecturaPpb(cand.ppb, cont.unidad);
    out.textContent = r.accion === 'aplicar' ? `${lec} → ${m.nombre} queda en ${FC.pesos(r.nuevo.precioNeto)} neto por ${FC.textoContenido(r.nuevo.contenido)}${r.pct !== null ? ` (${r.pct > 0 ? '+' : ''}${r.pct.toLocaleString('es-CL', { maximumFractionDigits: 1 })} % contra ahora)` : ''}`
      : r.accion === 'confirmar' ? `${lec} · ${r.motivo}: quedará por confirmar` : `${lec} · no cambia el precio: ${r.motivo}`;
  };
  d.querySelectorAll('input[name="fin-as-t"]').forEach(r => r.addEventListener('change', calc));
  ['#fin-as-cant', '#fin-as-uni'].forEach(q => d.querySelector(q).addEventListener('input', calc));
  ['#fin-as-mp', '#fin-as-uni'].forEach(q => d.querySelector(q).addEventListener('change', calc));
  calc();
  if (a) F.historialAsoc(clave).then(hs => {
    const c2 = d.querySelector('#fin-as-hist'); if (!c2) return;
    const t = x => !x ? '—' : x.ignorar ? 'No es materia prima' : `${x.mpNombre || x.mp} · ${FC.textoContenido(x.contenidoPorUnidad)} por unidad`;
    c2.innerHTML = hs.length ? `<ul class="fin-hist-lista">${hs.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${H.esc(h.accion)}: ${H.esc(t(h.despues))}</div><span class="ayuda">${h.antes ? `Antes: ${H.esc(t(h.antes))} · ` : ''}${H.esc(h.por || '')}${h.nota ? ` · ${H.esc(h.nota)}` : ''}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios.</p>';
  }).catch(() => {});
  d.querySelector('#fin-as').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#fin-as-err'), b = d.querySelector('#fin-as-si'), x = leer(); err.textContent = '';
    try { FS.armarAsociacion(a, x, { mpDoc: x.mp ? costos[x.mp] : null }); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await F.guardarAsociacion(clave, x);
      const nombre = x.ignorar ? '' : (costos[x.mp] || {}).nombre || x.mp;
      H.registrar('Finanzas: asoció un producto del SII', `${g.proveedor} · ${g.nombreItem} → ${x.ignorar ? 'no es materia prima' : nombre}`);
      let r = null;
      try { r = await F.preciosDesdeSii({ origen: 'asociacion' }); } catch (e) { st.err = `Asociación guardada, pero no se pudieron revisar los precios: ${error(e, H)}`; }
      const ap = r && r.aplicadas.find(y => y.mp === x.mp);
      st.msg = x.ignorar ? `${g.nombreItem}: marcado "No es materia prima".` : `${g.nombreItem} → ${nombre}.${ap ? ` Precio actualizado: ${lecturaPpb(ap.despues, ap.unidad)}.` : r && r.porConfirmar ? ' El precio cambia más de ±40 %: quedó por confirmar.' : ''}`;
      d.close(); await recargar(true); pintarCostos(el, 'compras', H);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
}

// ═══════════════ v0.58.0 · Costos → Productos: costo directo por producto ═══════════════
const AREAS = { PAN: 'Panadería', BOL: 'Bollería', PAS: 'Pastelería', CAF: 'Cafetería' };
const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ORDENES = [['nombre', 'Nombre'], ['costo', 'Costo'], ['alza', 'Mayor alza']];
const costoTxt = d => d.unidad === 'g' ? `${FC.pesos(d.costoUnit * 1000)} / kg` : `${FC.pesos(d.costoUnit)} / un`;
const varHtml = (v, titulo, H) => !v ? '<span class="ayuda">—</span>' : v.dir === 'igual' ? '<span class="ayuda">igual</span>'
  : `<span class="fin-var ${v.dir === 'sube' ? 'fin-sube' : 'fin-baja'}" title="${H.esc(titulo)}">${ic(v.dir, 14)}${FC.textoVariacion(v)}<span class="sr">${v.dir === 'sube' ? 'subió' : 'bajó'} ${H.esc(titulo)}</span></span>`;
const filasP = () => st.pr ? FM.filasProductos(st.pr.docs, st.pr.hist, hoyTxt()) : [];
const alzasP = () => st.pr ? FM.alzas(filasP(), st.pr.vistas, st.pr.alzaAviso) : [];
const causaTxt = h => {
  if (!h) return '';
  const c = (h.causa || []).map(x => `${x.nombre}${x.pct !== null && x.pct !== undefined ? ` ${x.pct > 0 ? '+' : ''}${String(x.pct).replace('.', ',')} %` : x.antes === null ? ' (precio nuevo)' : x.despues === null ? ' (sin precio)' : ''}`);
  if (h.recetaCambio) c.push('cambió la receta');
  return h.primero ? 'Primer cálculo' : c.length ? c.join(', ') : 'otros cambios';
};
function ordenarP(xs, orden) {
  const alza = f => (f.vsMes ? f.vsMes.pct : -Infinity);
  return xs.sort((a, b) => orden === 'costo' ? (b.unidad === 'g' ? b.costoUnit * 1000 : b.costoUnit) - (a.unidad === 'g' ? a.costoUnit * 1000 : a.costoUnit)
    : orden === 'alza' ? alza(b) - alza(a) || String(a.nombre).localeCompare(String(b.nombre), 'es') : String(a.nombre).localeCompare(String(b.nombre), 'es'));
}
function htmlProductos(H) {
  const p = partes(); if (p[3] === 'alzas') st.pOrden = 'alza';
  const todas = filasP(), alzas = alzasP(), umbral = st.pr ? st.pr.alzaAviso : FM.ALZA_DEFECTO;
  const cuenta = a => a === 'todas' ? todas.length : todas.filter(f => f.area === a).length;
  const inc = todas.filter(f => (f.incompleto || []).length).length;
  const calc = F.ultimoResultado();
  const sinProd = st.cx.prod.estado !== 'ok';
  const ayudaTabla = 'Costo directo de una unidad (o de un kg, si la receta rinde gramos), neto: ingredientes al precio de la última compra + sub recetas con su propio costo + insumos y envases + merma de laminado en Bollería, dividido por lo que rinde la receta.\nSolo recetas aprobadas. Se recalcula al abrir Costos y después de cada cambio de precio (a mano o del SII).\nMes anterior: contra el costo que tenía al empezar este mes (el último registrado antes del día 1).\nÚltimo cambio: contra el costo anterior al último cambio de más de 0,5 % (con su fecha).\n"Incompleto": a algún ingrediente le falta precio o una unidad no calza; el costo mostrado es solo lo que sí tiene costo.';
  return `<section class="tarjeta" aria-labelledby="t-fin-prod">
    <div class="titulo-fila fin-titulo"><h2 id="t-fin-prod">Costo directo por producto ${H.info('Costo directo por producto', ayudaTabla)}</h2>
      <span class="ayuda" id="fin-calc-hora">${calc ? `Calculado ${H.esc(new Date(calc.cuando).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }))}` : ''}</span></div>
    <p class="ayuda" id="fin-presumen">${todas.length ? `${nf(todas.length)} productos aprobados · ${nf(inc)} con costo incompleto` : sinProd ? '' : 'Todavía no hay productos costeados.'}</p>
    <p class="ok-texto" id="fin-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="fin-err" role="alert">${H.esc(st.calcErr || st.err)}</p>
    ${sinProd ? '<p class="aviso">La base de Cocina no está conectada: sin recetas no se puede calcular (se muestra el último cálculo guardado). Conéctala en <a href="#ajustes/cocina">Configuración → Cocina</a>.</p>' : ''}
    ${alzas.length ? `<div class="fin-alzas" id="fin-alzas" role="region" aria-labelledby="t-fin-alzas">
      <h3 id="t-fin-alzas">${ic('sube', 18)} Subió el costo de ${nf(alzas.length)} ${alzas.length === 1 ? 'producto' : 'productos'} ${H.info('Alzas de costo', `Productos cuyo costo directo por unidad subió más de ${String(umbral).replace('.', ',')} % contra el costo con que empezó el mes (el % se cambia en Ajustes de Finanzas, abajo).\nTambién aparecen en Hoy. "Visto" lo saca de aquí y de Hoy mientras el costo siga igual; si vuelve a subir, avisa de nuevo.\nNo avisan los productos con costo incompleto (su costo no es confiable).`)}</h3>
      <ul class="fin-alzas-lista">${alzas.map(f => `<li data-alza="${H.esc(f.id)}"><div class="txt"><a href="#finanzas/costos/productos/r/${encodeURIComponent(f.id)}"><b>${H.esc(f.nombre)}</b></a> <span class="ayuda">${H.esc(AREAS[f.area] || f.area)}</span>
        <span>${f.unidad === 'g' ? FC.pesos(f.ref.valor * 1000) + ' / kg' : FC.pesos(f.ref.valor) + ' / un'} → <b>${costoTxt(f)}</b> <span class="fin-var fin-sube">${ic('sube', 14)}+${String(f.vsMes.pct).replace('.', ',')} %</span></span>
        <span class="ayuda">Por: ${H.esc(causaTxt(f.ultimo) || '—')}</span></div>
        <button type="button" class="btn-sec" data-fin-visto="${H.esc(f.id)}">${ic('check', 16)} Visto</button></li>`).join('')}</ul></div>` : ''}
    ${todas.length ? `<div class="filtros fin-filtros">
      <div class="fin-buscar">${ic('lupa', 18)}<label class="sr" for="fin-pq">Buscar producto</label><input type="search" id="fin-pq" placeholder="Buscar producto…" autocomplete="off" spellcheck="false" value="${H.esc(st.pQ)}"></div>
      <div class="chips" role="group" aria-label="Filtrar por área">${['todas', ...Object.keys(AREAS)].map(a => `<button type="button" class="chip-filtro" data-fin-area="${a}" aria-pressed="${st.pArea === a}">${a === 'todas' ? 'Todas' : AREAS[a]} <span class="fin-cuenta">${nf(cuenta(a))}</span></button>`).join('')}</div>
      <div class="campo fin-orden"><label for="fin-porden">Ordenar por</label><select id="fin-porden">${ORDENES.map(([k, t]) => `<option value="${k}" ${st.pOrden === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="fin-ptabla" aria-label="Costo directo por producto">
      <div class="fin-pcab" aria-hidden="true"><span>Producto</span><span>Costo directo</span><span>vs mes anterior</span><span>vs último cambio</span><span>Último cambio</span></div>
      <div id="fin-pfilas"></div></div>` : ''}
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-ajustes">
    <h2 id="t-fin-ajustes">Ajustes de Finanzas</h2>
    <form id="fin-ajustes" class="fin-ajustes" novalidate>
      <div class="campo"><label for="fin-alza">Avisar en Hoy cuando el costo de un producto sube más de (%) ${H.info('Aviso de alza', 'Si el costo directo por unidad de un producto sube más de este % contra el costo con que empezó el mes, aparece en Hoy ("Subió el costo de N productos") y arriba en esta lista.\nPor defecto 5 %. Cada cambio de este número queda guardado con quién y cuándo.')}</label>
        <input id="fin-alza" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0.1" max="100" step="any" value="${H.esc(String(umbral))}"></div>
      <button type="submit" class="btn-sec" id="fin-alza-si">Guardar</button>
    </form><p class="error" id="fin-aj-err" role="alert"></p>
  </section>`;
}
function filaProducto(f, H) {
  const inc = (f.incompleto || []);
  return `<div class="fin-pfila"><a class="fin-pabrir" href="#finanzas/costos/productos/r/${encodeURIComponent(f.id)}">
    <span class="fin-nombre"><b>${H.esc(f.nombre)}</b> <span class="ayuda">${H.esc(AREAS[f.area] || f.area || '')}</span>${inc.length ? ` <span class="chip c-amarillo chip-chico" title="${H.esc(inc.join(' · '))}">Incompleto</span><span class="fin-inc-motivo">${H.esc(inc[0])}${inc.length > 1 ? ` y ${inc.length - 1} más` : ''}</span>` : ''}</span>
    <span><span class="fin-et">Costo directo</span><b>${costoTxt(f)}</b></span>
    <span><span class="fin-et">vs mes anterior</span>${varHtml(f.vsMes, 'contra el mes anterior', H)}</span>
    <span><span class="fin-et">vs último cambio</span>${varHtml(f.vsUltimo, 'contra el último cambio', H)}</span>
    <span><span class="fin-et">Último cambio</span>${f.ultimo ? fechaTxt(f.ultimo.fecha) : '<span class="ayuda">—</span>'}</span></a></div>`;
}
function pintarFilasP(H) {
  const c = $('fin-pfilas'); if (!c) return;
  const xs = ordenarP(filasP().filter(f => st.pArea === 'todas' || f.area === st.pArea).filter(f => !normalizar(st.pQ) || coincide(`${f.nombre} ${f.id}`, st.pQ)), st.pOrden);
  c.innerHTML = xs.length ? xs.map(f => filaProducto(f, H)).join('') : '<div class="vacio">Nada con ese filtro.</div>';
}
function conectarProductos(el, H) {
  pintarFilasP(H);
  const q = $('fin-pq'); if (q) q.addEventListener('input', () => { st.pQ = q.value; pintarFilasP(H); });
  const o = $('fin-porden'); if (o) o.addEventListener('change', () => { st.pOrden = o.value; pintarFilasP(H); });
  el.querySelectorAll('[data-fin-area]').forEach(b => b.addEventListener('click', () => { st.pArea = b.dataset.finArea; el.querySelectorAll('[data-fin-area]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarFilasP(H); }));
  el.querySelectorAll('[data-fin-visto]').forEach(b => b.addEventListener('click', async () => {
    const f = alzasP().find(x => x.id === b.dataset.finVisto); if (!f) return;
    b.disabled = true;
    try { await F.marcarAlzaVista(f.id, f.costoUnit, f.vsMes.pct); H.registrar('Finanzas: vio un alza de costo', `${f.nombre}: +${f.vsMes.pct} %`); st.msg = `${f.nombre}: marcado como visto.`; st.pr = await F.leerProductos(); pintarCostos(el, 'productos', H); }
    catch (e) { $('fin-err').textContent = error(e, H); b.disabled = false; }
  }));
  const fa = $('fin-ajustes');
  if (fa) fa.addEventListener('submit', async ev => {
    ev.preventDefault(); const err = $('fin-aj-err'); err.textContent = '';
    try { const x = await F.guardarAjustes({ alzaAviso: FC.casilla($('fin-alza')) }); H.registrar('Finanzas: cambió el % de aviso de alza', `${x} %`); st.msg = `Aviso de alza: más de ${String(x).replace('.', ',')} %.`; st.pr = await F.leerProductos(); pintarCostos(el, 'productos', H); }
    catch (e) { err.textContent = error(e, H); }
  });
}

// ── Detalle de un producto ──
const cantD = (c, u) => u === 'un' ? `${Number((Math.round(c * 100) / 100).toFixed(2)).toLocaleString('es-CL')} un` : u === 'ml' ? `${Math.round(c * 10) / 10 >= 1000 ? (c / 1000).toLocaleString('es-CL', { maximumFractionDigits: 2 }) + ' l' : (Math.round(c * 10) / 10).toLocaleString('es-CL') + ' ml'}` : (c >= 1000 ? (c / 1000).toLocaleString('es-CL', { maximumFractionDigits: 3 }) + ' kg' : (Math.round(c * 10) / 10).toLocaleString('es-CL') + ' g');
const precioBaseTxt = l => l.precioBase === null || l.precioBase === undefined ? '—' : l.base === 'un' ? `${FC.pesos(l.precioBase)} / un` : FC.porLectura(l.precioBase, l.base || 'g').texto;
function lineaHtml(l, total, H, nivel = 0) {
  const pct = total > 0 && l.costo ? l.costo / total * 100 : null;
  const formula = l.costo === null || l.costo === undefined ? '' : l.tipo === 'sub' ? (l.unidad === 'un' ? `${cantD(l.cantidad, 'un')} × ${precioBaseTxt(l)}` : `${cantD(l.cantidad, 'g')} × costo por g de la sub receta`)
    : l.tipo === 'mp' || l.tipo === 'insumo' ? `${cantD(l.cantidad, l.unidad)}${l.supuesto ? ` (${l.supuesto})` : ''} × ${precioBaseTxt(l)}` : '';
  const sub = l.tipo === 'sub' && l.sub && l.subLineas ? `<details class="fin-subdet"><summary>Ver qué lleva (${H.esc(String(Math.round((l.factor || 0) * 1000) / 10).replace('.', ','))} % del lote de la sub receta)</summary>
    <div class="fin-dlista fin-dsub">${l.subLineas.map(x => lineaHtml(x, total, H, nivel + 1)).join('')}</div></details>` : '';
  return `<div class="fin-dfila ${nivel ? 'fin-dnivel' : ''}" data-linea="${H.esc(l.ingrediente)}">
    <span class="fin-dnom"><b>${H.esc(l.ingrediente)}</b>${l.tipo === 'sub' ? ' <span class="chip c-gris chip-chico">Sub receta</span>' : ''}${l.tipo === 'insumo' ? ' <span class="chip c-gris chip-chico">Insumo</span>' : ''}${l.supuesto === 'g = ml' ? ' <span class="chip c-amarillo chip-chico" title="Se compra por volumen y la receta lo pide en gramos: se usa 1 g = 1 ml">supuesto g = ml</span>' : ''}${l.incompleto ? ` <span class="chip c-rojo chip-chico">${H.esc(l.incompleto)}</span>` : ''}${l.nota ? `<span class="ayuda">${H.esc(l.nota)}</span>` : ''}</span>
    <span><span class="fin-et">Cantidad</span>${l.tipo === 'merma' ? '—' : cantD(l.cantidad, l.unidad)}${l.porUnidad ? ` <span class="ayuda">(${H.esc(String(l.porUnidad).replace('.', ','))} por unidad)</span>` : ''}</span>
    <span><span class="fin-et">Precio base</span>${l.tipo === 'merma' ? `${H.esc(String(l.pct).replace('.', ','))} % de ${FC.pesos(l.base)}` : precioBaseTxt(l)}${l.origenPrecio ? `<span class="ayuda">${H.esc(l.origenPrecio)}${l.fechaPrecio ? ' · ' + fechaTxt(l.fechaPrecio) : ''}</span>` : ''}</span>
    <span><span class="fin-et">Costo</span><b>${l.costo === null || l.costo === undefined ? 'sin costo' : FC.pesos(l.costo)}</b>${formula ? `<span class="ayuda">${H.esc(formula)}</span>` : ''}</span>
    <span><span class="fin-et">% del total</span>${pct === null ? '—' : (Math.round(pct * 10) / 10).toLocaleString('es-CL') + ' %'}</span>${sub}</div>`;
}
// Las líneas de una sub receta, en la proporción que usa el producto (recursivo)
function conSub(lineas, motor, fac = 1, prof = 0) {
  return lineas.map(l => {
    const x = { ...l, cantidad: l.cantidad * fac, costo: l.costo === null || l.costo === undefined ? l.costo : l.costo * fac };
    if (l.tipo === 'sub' && l.sub && prof < 6 && !l.ciclo) {
      const r = motor.costear(l.sub);
      if (r && !r.ciclo) x.subLineas = conSub([...r.desglose, ...r.insumos], motor, (l.factor || 0) * fac, prof + 1);
    }
    return x;
  });
}
function pintarDetalle(el, id, rv, H) {
  const calc = F.ultimoResultado(), d = (st.pr && st.pr.docs || {})[id];
  const motor = calc && calc.ctx ? FM.crearMotor(calc.ctx) : null;
  const r = motor ? motor.costear(id) : null;
  const fila = filasP().find(f => f.id === id) || (d ? FM.filasProductos({ [id]: { ...d, aprobada: true, tipo: 'receta' } }, (st.pr && st.pr.hist) || [], hoyTxt())[0] : null);
  const volver = `<a class="btn-sec fin-enlace fin-volver" href="#finanzas/costos/productos">${ic('atras', 16)} Productos</a>`;
  if (!r && !d) { el.innerHTML = cab('costos') + subPestanas('productos', rv.pendientes.length) + `<section class="tarjeta">${volver}<p class="aviso">No se encontró ese producto.</p></section>`; return; }
  const nombre = (r && r.nombre) || d.nombre, area = (r && r.area) || d.area, unidad = (r && r.unidad) || d.unidad || 'un';
  const costoUnit = r ? r.costoUnit : d.costoUnit, lote = r ? r.costoTotal : d.costoTotal, porc = r ? r.porciones : d.porciones;
  const inc = r ? r.incompleto : (d.incompleto || []);
  const lineas = r ? conSub(r.desglose, motor) : [], insumos = r ? r.insumos : [];
  const hs = ((st.pr && st.pr.hist) || []).filter(h => h.receta === id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.cuando || '').localeCompare(String(a.cuando || '')));
  const lect = unidad === 'g' ? `${FC.pesos(costoUnit * 1000)} / kg` : `${FC.pesos(costoUnit)} / un`;
  const cifra = (t, v, ayuda, extra = '') => `<div><span>${t} ${H.info(t, ayuda)}</span><b>${v}</b>${extra}</div>`;
  const cab5 = `<div class="fin-dfila fin-dcab" aria-hidden="true"><span>Ingrediente</span><span>Cantidad (lote)</span><span>Precio base</span><span>Costo</span><span>% del total</span></div>`;
  el.innerHTML = cab('costos') + subPestanas('productos', rv.pendientes.length) + `<section class="tarjeta" aria-labelledby="t-fin-det">
    ${volver}
    <div class="titulo-fila fin-titulo"><h2 id="t-fin-det">${H.esc(nombre)}</h2><span class="chip c-gris">${H.esc(AREAS[area] || area || '')}</span>${r && r.tipo === 'sub_receta' ? '<span class="chip c-gris">Sub receta</span>' : ''}</div>
    ${inc.length ? `<div class="aviso" role="note"><b>Costo incompleto:</b> el costo mostrado es solo lo que sí tiene costo.<ul class="fin-inc">${inc.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul>Se corrige en <a href="#finanzas/costos">Materias primas</a> (precio, contenido, peso por unidad) o en la receta (en Producción).</div>` : ''}
    <div class="fin-prev-cifras fin-dcifras">
      ${cifra(unidad === 'g' ? 'Costo directo por kg' : 'Costo directo por unidad', lect, `Costo del lote ÷ lo que rinde la receta${unidad === 'g' ? ' (en gramos; se muestra por kg = × 1.000)' : ''}: ${FC.pesos(lote)} ÷ ${nf(porc)} ${unidad === 'g' ? 'g' : 'un'}.\nNeto, con los precios de la última compra de cada materia prima.`)}
      ${cifra('Costo del lote', FC.pesos(lote), `Suma de todas las líneas de abajo: ingredientes, sub recetas, insumos${r && r.merma ? ' y merma de laminado' : ''}, para una receta completa (rinde ${nf(porc)} ${unidad === 'g' ? 'g' : 'un'}).`, `<span>rinde ${nf(porc)} ${unidad === 'g' ? 'g' : 'un'}</span>`)}
      ${cifra('vs mes anterior', fila && fila.ref ? varHtml(fila.vsMes, 'contra el mes anterior', H) : '—', 'Contra el costo con que empezó este mes: el último registrado en el historial antes del día 1 (si el producto es nuevo este mes, el primero del mes).', fila && fila.ref ? `<span>${unidad === 'g' ? FC.pesos(fila.ref.valor * 1000) + ' / kg' : FC.pesos(fila.ref.valor) + ' / un'}</span>` : '')}
      ${cifra('vs último cambio', fila && fila.ultimo ? varHtml(fila.vsUltimo, 'contra el último cambio', H) : '—', 'Contra el costo que tenía antes del último cambio de más de 0,5 % (los cambios más chicos no quedan en el historial).', fila && fila.ultimo ? `<span>${fechaTxt(fila.ultimo.fecha)}</span>` : '')}
    </div>
    ${!r ? '<p class="aviso">Sin la base de Producción conectada no se puede ver el desglose (solo el último costo guardado).</p>' : `
    <h3 class="fin-dtit">Ingredientes ${H.info('Desglose por ingrediente', 'Cada ingrediente de una receta completa (lote): cantidad × precio base (por kg, l o unidad, neto, con su origen: SII con proveedor y folio, a mano o planilla).\nSub receta: su costo por gramo (costo de su lote ÷ peso de su lote) o por unidad si rinde unidades; "Ver qué lleva" muestra sus ingredientes en la proporción que usa este producto.\n"supuesto g = ml": se compra por volumen y la receta lo pide en gramos; se toma 1 g = 1 ml.\n% del total: costo de la línea ÷ costo del lote.')}</h3>
    <div class="fin-dlista">${cab5}${lineas.map(l => lineaHtml(l, lote, H)).join('') || '<p class="ayuda">Sin ingredientes.</p>'}</div>
    ${insumos.length ? `<h3 class="fin-dtit">Insumos ${H.info('Insumos y envases', 'Envases, etiquetas y otros insumos de la receta. Si la receta rinde unidades, la cantidad es por unidad (× lo que rinde = el lote); si rinde gramos, es por lote. Igual que el consumo de la bodega.')}</h3>
      <div class="fin-dlista">${cab5.replace('Ingrediente', 'Insumo')}${insumos.map(l => lineaHtml(l, lote, H)).join('')}</div>` : ''}
    ${r.merma ? `<h3 class="fin-dtit">Merma de laminado ${H.info('Merma de laminado', `Lo que se pierde al laminar la masa (recortes): ${String(r.merma.pct).replace('.', ',')} % según la Configuración de Producción → Bollería (merma_laminado_pct), la misma que usa la planificación para pedir más masas.\nSe calcula sobre el costo de la masa base y del empaste de este producto: (${r.merma.sobre.join(' + ')}) ${FC.pesos(r.merma.base)} × ${String(r.merma.pct).replace('.', ',')} % = ${FC.pesos(r.merma.costo)}.`)}</h3>
      <div class="fin-dlista">${lineaHtml(r.merma, lote, H)}</div>` : ''}
    <div class="fin-dtotal"><span>Costo del lote</span><b>${FC.pesos(lote)}</b><span>÷ ${nf(porc)} ${unidad === 'g' ? 'g' : 'un'} =</span><b>${lect}</b></div>`}
  </section>
  <section class="tarjeta" aria-labelledby="t-fin-dhist">
    <h2 id="t-fin-dhist">Historial de cambios ${H.info('Historial del costo', 'Cada vez que el costo por unidad cambia más de 0,5 % queda aquí: fecha, costo anterior y nuevo, % y la causa (las materias primas que cambiaron de precio, o un cambio en la receta). No se borra.')}</h2>
    ${hs.length ? `<ul class="fin-hist-lista fin-dhist">${hs.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${h.anterior === null || h.anterior === undefined ? '' : (unidad === 'g' ? FC.pesos(h.anterior * 1000) : FC.pesos(h.anterior)) + ' → '}<b>${unidad === 'g' ? FC.pesos(h.nuevo * 1000) + ' / kg' : FC.pesos(h.nuevo) + ' / un'}</b>${h.pct !== null && h.pct !== undefined ? ` <span class="fin-var ${h.pct > 0 ? 'fin-sube' : 'fin-baja'}">${h.pct > 0 ? '+' : '−'}${String(Math.abs(Math.round(h.pct * 10) / 10)).replace('.', ',')} %</span>` : ''}</div><span class="ayuda">${H.esc(causaTxt(h))}${h.incompleto ? ' · costo incompleto' : ''}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios todavía.</p>'}
  </section>`;
}

// ═══════════════ v0.59.0 · Márgenes (F2 paso 1): ventas por producto, área y canal ═══════════════
const MS = { per: 'mes', desde: '', hasta: '', datos: null, clave: '', vinc: {}, recetas: [], area: 'todas', canal: 'todos', q: '', verAsoc: false, msg: '', err: '' };
const pesosM = v => FC.pesos(Math.round(Number(v) || 0));
const cantM = v => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('es-CL');
const NOMBRE_MES = m => { const [y, n] = String(m).split('-'); return `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(n) - 1] || n} ${y}`; };
const perActual = () => FV.periodo(MS.per, hoyTxt(), MS.desde, MS.hasta);
// v0.74.0: el vínculo de un producto sale del maestro del Catálogo (si está unido); si no, de lo asociado aquí (fin_productos)
const vincEf = () => FV.vinculosEfectivos(MS.vinc, MS.maestro);
const productosM = () => MS.datos ? FV.productosVendidos(MS.datos.lineas, vincEf(), MS.recetas) : [];
const PI2 = { caja: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>', camion: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>', recargar: PI.revisar };
const icM = (n, t = 18) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PI2[n] || PI[n] || ''}</svg>`;

function subMargenes(parte, n) {
  const pill = (k, href, txt, extra = '') => `<a class="pastilla" href="#finanzas/margenes${href}" aria-current="${parte === k ? 'page' : 'false'}" aria-pressed="${parte === k}">${txt}${extra}</a>`;
  const falta = MS.costos && !FMG.comisionConfigurada(cfgM());
  return `<div class="pastillas fin-sub" role="group" aria-label="Partes de Márgenes">
    ${pill('ventas', '', 'Ventas por producto')}${pill('margen', '/margen', 'Margen por producto')}${pill('matriz', '/matriz', 'Volumen × margen')}${pill('precios', '/precios', 'Precio sugerido')}
    ${pill('asociar', '/asociar', 'Asociar productos', n ? ` <span class="chip c-amarillo chip-chico" title="Productos vendidos sin asociar">${n}</span>` : '')}
    ${pill('ajustes', '/ajustes', 'Ajustes', falta ? ' <span class="chip c-amarillo chip-chico" id="m-falta-chip">Falta configurar</span>' : '')}</div>`;
}
function selectorPeriodo(H) {
  const hoy = hoyTxt(), mesHoy = FV.mesDe(hoy);
  const b = (k, t) => `<button type="button" class="chip-filtro" data-m-per="${k}" aria-pressed="${MS.per === k}">${t}</button>`;
  return `<div class="fin-mper" role="group" aria-label="Período">
    <div class="chips">${b('mes', 'Este mes')}${b('mesAnterior', 'Mes anterior')}${b('rango', 'Elegir meses')}</div>
    <form class="fin-mrango ${MS.per === 'rango' ? '' : 'oculto'}" id="m-rango" novalidate>
      <div class="campo"><label for="m-desde">Desde</label><input type="month" id="m-desde" max="${mesHoy}" value="${H.esc(MS.desde || FV.mesMas(mesHoy, -2))}"></div>
      <div class="campo"><label for="m-hasta">Hasta</label><input type="month" id="m-hasta" max="${mesHoy}" value="${H.esc(MS.hasta || mesHoy)}"></div>
      <button type="submit" class="btn-sec" id="m-ver">Ver</button></form></div>`;
}
async function pintarMargenes(el, parte, H) {
  const per = perActual(), clave = per.meses.join(',');
  const base = (cuerpo, n) => cab('margenes') + subMargenes(parte, n) + cuerpo;
  el.innerHTML = base(`<section class="tarjeta">${selectorPeriodo(H)}<div class="vacio" style="border:0" role="status" id="m-leyendo">Leyendo las ventas de ${H.esc(per.meses.map(NOMBRE_MES).join(', '))}…</div></section>`);
  conectarPeriodo(el, parte, H);
  try {
    if (!st.cx || st.cx.gastos.estado !== 'ok') st.cx = await F.conexiones();
    if (st.cx.gastos.estado !== 'ok') return sinBase(el, 'margenes', H);
    if (MS.clave !== clave || !MS.datos) {
      const [d, v, r, m] = await Promise.all([F.ventasPeriodo(per, { avance: m => { const x = $('m-leyendo'); if (x) x.textContent = `Leyendo las ventas de ${NOMBRE_MES(m)}…`; } }), F.leerVinculos(), F.recetasVenta(), F.maestroFinanzas()]);
      MS.datos = d; MS.vinc = v; MS.recetas = r; MS.maestro = m; MS.clave = clave;
    }
    // v0.60.0: costos (último cálculo guardado + historial) y ajustes de márgenes; una vez por visita a Márgenes
    if (!MS.costos) MS.costos = await F.leerProductos();
  } catch (e) { el.innerHTML = base(`<section class="tarjeta">${selectorPeriodo(H)}<p class="error" role="alert">${H.esc(error(e, H))}</p></section>`); conectarPeriodo(el, parte, H); return; }
  if (partes()[1] !== 'margenes') return;
  dibujarMargenes(el, parte, H);
  // v0.71.1: #finanzas/margenes/asociar/{clave} (desde el Plan de Panadería) abre ese producto para asociarlo
  const claveAs = parte === 'asociar' && partes()[3] ? decodeURIComponent(partes()[3]) : '';
  if (claveAs) {
    const p = productosM().find(x => x.clave === claveAs);
    if (p) dialogoVinculo(p, el, 'asociar', H);
    else { const m = $('m-msg'); if (m) m.textContent = 'Ese producto no tiene ventas en el período elegido: cambia el período (arriba) para encontrarlo en la lista.'; }
  }
}
function dibujarMargenes(el, parte, H) {
  const prods = productosM(), sin = prods.filter(p => !p.vinculo);
  const cuerpo = { asociar: () => htmlAsociar(prods, H), margen: () => htmlMargen(H), matriz: () => htmlMatriz(H), precios: () => htmlPrecios(H), ajustes: () => htmlAjustesM(H) }[parte];
  el.innerHTML = cab('margenes') + subMargenes(parte, sin.length) + (cuerpo ? cuerpo() : htmlVentas(prods, H));
  conectarPeriodo(el, parte, H);
  if (parte === 'asociar') conectarAsociar(el, prods, H);
  else if (parte === 'margen') conectarMargen(el, H);
  else if (parte === 'matriz') conectarMatriz(el, H);
  else if (parte === 'precios') conectarPrecios(el, H);
  else if (parte === 'ajustes') conectarAjustesM(el, H);
  else conectarVentas(el, prods, H);
}
function conectarPeriodo(el, parte, H) {
  el.querySelectorAll('[data-m-per]').forEach(b => b.addEventListener('click', () => {
    MS.per = b.dataset.mPer;
    if (MS.per === 'rango') { el.querySelectorAll('[data-m-per]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('m-rango').classList.remove('oculto'); $('m-desde').focus(); return; }
    MS.msg = ''; pintarMargenes(el, parte, H);
  }));
  const f = $('m-rango');
  if (f) f.addEventListener('submit', ev => { ev.preventDefault(); MS.desde = $('m-desde').value; MS.hasta = $('m-hasta').value; if (!MS.desde || !MS.hasta) return; MS.per = 'rango'; MS.msg = ''; pintarMargenes(el, parte, H); });
  const r = $('m-releer');
  if (r) r.addEventListener('click', async () => {
    r.disabled = true; r.lastChild.textContent = ' Leyendo…';
    try { const per = perActual(); MS.datos = await F.ventasPeriodo(per, { forzar: true }); MS.clave = per.meses.join(','); MS.msg = 'Ventas leídas de nuevo desde la caja y B2B.'; H.registrar('Finanzas: volvió a leer las ventas', per.meses.join(', ')); dibujarMargenes(el, parte, H); }
    catch (e) { r.disabled = false; r.lastChild.textContent = ' Volver a leer'; const x = $('m-err'); if (x) x.textContent = error(e, H); }
  });
  const g = $('m-generar');
  if (g) g.addEventListener('click', async () => {
    g.disabled = true; g.textContent = 'Generando…';
    try {
      const r2 = await F.generarResumenesFaltantes(MS.datos.faltan, (i, n) => { g.textContent = `Generando ${i} de ${n}…`; });
      H.registrar('Finanzas: generó resúmenes de caja faltantes', `${r2.hechos} hechos, ${r2.fallas} con error`);
      const per = perActual(); MS.datos = await F.ventasPeriodo(per, { forzar: true }); MS.msg = `Resúmenes generados: ${r2.hechos}${r2.fallas ? ` (${r2.fallas} con error)` : ''}.`; dibujarMargenes(el, parte, H);
    } catch (e) { g.disabled = false; g.textContent = 'Generar los que faltan'; const x = $('m-err'); if (x) x.textContent = error(e, H); }
  });
}
// Lo que se leyó (y de dónde) y los avisos del período
function htmlFuente(H) {
  const d = MS.datos; if (!d) return '';
  const partesTxt = d.meses.map(m => {
    const c = m.caja || {}, b = m.b2b || {};
    const ct = c.fuente === 'guardado' ? 'caja guardada' : `${nf(c.cierres)} ${c.cierres === 1 ? 'cierre' : 'cierres'} de caja`;
    const bt = b.fuente === 'guardado' ? 'B2B guardado' : b.fuente === 'sin_conexion' ? 'sin B2B' : `${nf(b.ordenes)} ${b.ordenes === 1 ? 'orden' : 'órdenes'} B2B`;
    return `${NOMBRE_MES(m.mes)}: ${ct} · ${bt}`;
  });
  const abiertas = d.meses.reduce((a, m) => a + ((m.caja && m.caja.abiertas) || 0), 0), faltan = (d.faltan || []).length;
  const guardados = d.meses.filter(m => (m.caja && m.caja.guardado) || (m.b2b && m.b2b.guardado)).map(m => NOMBRE_MES(m.mes));
  const ayuda = 'Caja: se lee el resumen de cada cierre (un documento por cierre, que ya trae lo vendido de cada producto y descuenta las anuladas), no las ventas una por una. Un mes son unas 60 lecturas de resúmenes y otras tantas de cajas (para saber si falta algún resumen).\nB2B: las órdenes del mes (sin anuladas), una lectura por orden. Los precios de B2B ya son netos.\nUn mes cerrado (desde el día 8 del mes siguiente, sin cajas abiertas ni cierres sin resumen) se guarda en Finanzas: la próxima vez cuesta 1 lectura. "Volver a leer" lo rehace (por ejemplo, si se corrigió una orden de ese mes).\nLa caja: neto = bruto ÷ 1,19 de cada producto, después del descuento de línea.';
  return `<p class="ayuda fin-mfuente">${H.esc(partesTxt.join(' · '))} · unas ${nf(d.lecturas)} lecturas ${H.info('De dónde salen las ventas', ayuda)}
      <button type="button" class="btn-sec btn-chico fin-mreleer" id="m-releer">${icM('recargar', 16)} Volver a leer</button></p>
    ${guardados.length ? `<p class="ayuda">Guardado en Finanzas (mes cerrado): ${H.esc(guardados.join(', '))}.</p>` : ''}
    ${abiertas ? `<p class="aviso">${nf(abiertas)} ${abiertas === 1 ? 'caja sigue abierta' : 'cajas siguen abiertas'}: sus ventas no se cuentan hasta que se cierren.</p>` : ''}
    ${faltan ? `<p class="aviso">${nf(faltan)} ${faltan === 1 ? 'cierre no tiene' : 'cierres no tienen'} resumen: sus ventas no se cuentan. <button type="button" class="btn-sec btn-chico" id="m-generar">Generar los que faltan</button></p>` : ''}
    ${d.b2bEstado !== 'ok' ? '<p class="aviso">La base de B2B no está conectada: solo se ven las ventas de la caja (y los meses de B2B ya guardados). Conéctala en <a href="#b2b/base">Ventas a empresas → Base nueva</a>.</p>' : ''}`;
}
// v0.69.1 · Las áreas de margen que se muestran: Reventa solo si tiene algo (o si está elegida en el filtro)
const hayEn = x => !!x && (typeof x === 'number' ? x !== 0 : (Number(x.n || 0) > 0 || Math.round(Number(x.neto || 0)) !== 0));
const areasVer = (porArea, elegida = '') => FV.AREAS.filter(a => a !== FV.REVENTA || a === elegida || hayEn((porArea || {})[a]));
function htmlCobertura(t, n, H) {
  const pct = t.pct === null ? 0 : Math.max(0, Math.min(100, t.pct));
  return `<div class="fin-mcob" id="m-cobertura"><div class="fin-mcob-txt"><span>Asociado: <b>${t.pctTxt}</b> de la venta neta del período ${H.info('Cobertura', `Parte de la venta neta del período cuyos productos ya están asociados: a su receta (y su área), a una reventa o marcados "no es un producto" (propinas, cargos).\nLo que falta asociar no tiene área, y en el próximo paso no tendrá costo ni margen.\nConviene partir por los que más venden (Asociar productos los ordena así).\nAsociado: ${pesosM(t.decidido)} de ${pesosM(t.todo)}.`)}</span>
    ${n ? `<a href="#finanzas/margenes/asociar">Asociar ${nf(n)} ${n === 1 ? 'producto' : 'productos'} (${pesosM(t.sinAsociar)})</a>` : '<span class="ok-texto">Todo asociado</span>'}</div>
    <div class="fin-mbarra" role="progressbar" aria-label="Venta asociada" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%"></span></div></div>`;
}
function htmlVentas(prods, H) {
  const t = FV.totales(prods, { canal: MS.canal }), per = perActual();
  const sin = prods.filter(p => !p.vinculo).length;
  const cifra = (tit, v, ayuda, extra = '', cls = '') => `<div class="${cls}"><span>${tit}${ayuda ? ' ' + H.info(tit, ayuda) : ''}</span><b>${pesosM(v)}</b>${extra}</div>`;
  const parte = v => (t.total > 0 ? `<span>${(Math.round(v / t.total * 1000) / 10).toLocaleString('es-CL')} %</span>` : '');
  const canales = FV.SUCS.filter(sc => MS.canal === 'todos' || sc === MS.canal);
  return `<section class="tarjeta" aria-labelledby="t-m-ventas">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-ventas">Ventas por producto ${H.info('Ventas por producto', 'Lo vendido en el período, en neto (sin IVA), por producto, área y canal.\nÁrea: la de la receta del producto (Panadería, Bollería, Pastelería, Cafetería); en una reventa, Reventa (o la que elegiste antes).\nCanal: caja Barros Arana, caja Ainavillo y B2B. Los productos de la caja y de B2B que van a la misma receta se ven en una sola fila.\nUnidades: lo vendido × unidades por venta (una "caja de 6" = 6 unidades de la receta).\nPrecio neto promedio: venta neta ÷ unidades.\nLos "no es un producto" (propinas, cargos) no suman.')}</h2>
      <span class="ayuda">${H.esc(fechaTxt(per.desde))} al ${H.esc(fechaTxt(per.hasta))}</span></div>
    ${selectorPeriodo(H)}
    <p class="ok-texto" id="m-msg" role="status">${H.esc(MS.msg)}</p><p class="error" id="m-err" role="alert">${H.esc(MS.err)}</p>
    ${htmlFuente(H)}
    ${htmlCobertura(t, sin, H)}
    <h3 class="fin-dtit">Por canal</h3>
    <div class="fin-prev-cifras fin-mcifras" id="m-canales">
      ${cifra('Venta neta', t.total, 'Toda la venta neta del período (y del canal elegido), sin los "no es un producto".', t.ignorado ? `<span>${pesosM(t.ignorado)} no son productos</span>` : '', 'fin-mtot')}
      ${canales.map(sc => cifra(FV.NOMBRE_SUC[sc], t.porSuc[sc] || 0, '', parte(t.porSuc[sc] || 0))).join('')}</div>
    <h3 class="fin-dtit">Por área</h3>
    <div class="fin-prev-cifras fin-mcifras" id="m-areas">
      ${areasVer(t.porArea).map(a => cifra(FV.NOMBRE_AREA[a], t.porArea[a] || 0, '', parte(t.porArea[a] || 0))).join('')}
      ${t.sinAsociar ? cifra('Sin asociar', t.sinAsociar, 'Venta de productos que todavía no tienen receta (ni son reventa): no tienen área. Asócialos en Asociar productos.', parte(t.sinAsociar), 'fin-msin') : ''}</div>
    ${t.recetaPendiente ? `<p class="ayuda" id="m-pend">Incluye ${pesosM(t.recetaPendiente)} de ${nf(t.nRecetaPendiente)} ${t.nRecetaPendiente === 1 ? 'producto' : 'productos'} con la receta pendiente: en su área, sin costo (receta pendiente). ${H.info('Receta pendiente', TXT_PEND_FIN)} <a href="#catalogo/productos/falta-receta">Unir con su receta</a></p>` : ''}
    ${t.reventa ? `<p class="ayuda">Incluye ${pesosM(t.reventa)} de reventa${t.reventa - (t.porArea[FV.REVENTA] || 0) ? ` (${pesosM(t.reventa - (t.porArea[FV.REVENTA] || 0))} con otra área elegida antes)` : ''}.</p>` : ''}
    <div class="filtros fin-filtros" id="m-filtros-ventas">
      <div class="fin-buscar">${ic('lupa', 18)}<label class="sr" for="m-q">Buscar producto</label><input type="search" id="m-q" placeholder="Buscar producto…" autocomplete="off" spellcheck="false" value="${H.esc(MS.q)}"></div>
      <div class="chips" role="group" aria-label="Filtrar por área">${['todas', ...areasVer(t.porArea, MS.area), 'sin'].map(a => `<button type="button" class="chip-filtro" data-m-area="${a}" aria-pressed="${MS.area === a}">${a === 'todas' ? 'Todas' : a === 'sin' ? 'Sin asociar' : FV.NOMBRE_AREA[a]}</button>`).join('')}</div>
      <div class="chips" role="group" aria-label="Filtrar por canal">${['todos', ...FV.SUCS].map(c => `<button type="button" class="chip-filtro" data-m-canal="${c}" aria-pressed="${MS.canal === c}">${c === 'todos' ? 'Todos los canales' : FV.NOMBRE_SUC[c]}</button>`).join('')}</div></div>
    <div class="fin-mtabla" aria-label="Ventas por producto">
      <div class="fin-mfila fin-mcab" aria-hidden="true"><span>Producto</span><span>Área</span><span>Caja Barros</span><span>Caja Ainavillo</span><span>B2B</span><span>Unidades</span><span>Venta neta</span><span>Precio neto prom.</span></div>
      <div id="m-filas"></div></div>
  </section>`;
}
function filasVentas(prods) {
  const q = MS.q;
  return FV.tablaVentas(prods, { canal: MS.canal })
    .filter(f => MS.area === 'todas' || (MS.area === 'sin' ? f.tipo === 'sin' : f.area === MS.area))
    .filter(f => !normalizar(q) || coincide(`${f.nombre} ${f.fuentes.map(x => x.nombre).join(' ')}`, q));
}
function filaVenta(f, H) {
  const celda = sc => { const x = f.porSuc[sc]; return x ? `${pesosM(x.neto)}<span class="ayuda">${cantM(x.cantidad)} ${x.cantidad === 1 ? 'vendido' : 'vendidos'}</span>` : '<span class="ayuda">—</span>'; };
  const fuentes = f.fuentes.map(x => `${x.nombre} (${x.canal === 'b2b' ? 'B2B' : 'caja'}${x.unidadesPorVenta !== 1 ? ` × ${String(x.unidadesPorVenta).replace('.', ',')}` : ''})`).join(' · ');
  const area = f.tipo === 'sin' ? '<span class="chip c-amarillo chip-chico">Sin asociar</span>' : `${H.esc(FV.NOMBRE_AREA[f.area] || f.area || '—')}${f.tipo === 'reventa' && f.area !== FV.REVENTA ? ' <span class="chip c-gris chip-chico">Reventa</span>' : ''}${f.tipo === 'pendiente' ? ' <span class="chip c-amarillo chip-chico fin-pend-chip">Receta pendiente</span>' : ''}`;
  return `<div class="fin-mfila" data-m-fila="${H.esc(f.clave)}">
    <span class="fin-nombre"><b>${H.esc(f.nombre)}</b>${f.tipo === 'receta' ? `<span class="ayuda">${H.esc(fuentes)}</span>` : ''}${f.tipo === 'sin' ? ` <button type="button" class="fin-mlink" data-m-asociar="${H.esc(f.productoClave)}">Asociar</button>` : ''}${f.tipo === 'pendiente' ? '<span class="ayuda">Sin costo (receta pendiente) · <a href="#catalogo/productos/falta-receta">Unir con su receta</a></span>' : ''}</span>
    <span><span class="fin-et">Área</span>${area}</span>
    <span><span class="fin-et">Caja Barros</span>${celda('barros')}</span>
    <span><span class="fin-et">Caja Ainavillo</span>${celda('ainavillo')}</span>
    <span><span class="fin-et">B2B</span>${celda('b2b')}</span>
    <span><span class="fin-et">Unidades</span>${cantM(f.unidades)}</span>
    <span><span class="fin-et">Venta neta</span><b>${pesosM(f.neto)}</b></span>
    <span><span class="fin-et">Precio neto prom.</span>${f.precioUnidad === null ? '—' : pesosM(f.precioUnidad)}${f.precioVenta !== null && f.precioVenta !== f.precioUnidad ? `<span class="ayuda">${pesosM(f.precioVenta)} por venta</span>` : ''}</span></div>`;
}
function pintarFilasVentas(prods, H) {
  const c = $('m-filas'); if (!c) return;
  const xs = filasVentas(prods);
  const tot = xs.reduce((a, f) => ({ neto: a.neto + f.neto, unidades: a.unidades + f.unidades, s: FV.SUCS.reduce((o, sc) => ({ ...o, [sc]: (a.s[sc] || 0) + ((f.porSuc[sc] || {}).neto || 0) }), {}) }), { neto: 0, unidades: 0, s: {} });
  c.innerHTML = xs.length ? xs.map(f => filaVenta(f, H)).join('') + `<div class="fin-mfila fin-mtotal" id="m-total">
      <span class="fin-nombre"><b>Total (${nf(xs.length)} ${xs.length === 1 ? 'fila' : 'filas'})</b></span><span></span>
      ${FV.SUCS.map(sc => `<span><span class="fin-et">${FV.NOMBRE_SUC[sc]}</span>${pesosM(tot.s[sc] || 0)}</span>`).join('')}
      <span><span class="fin-et">Unidades</span>${cantM(tot.unidades)}</span><span><span class="fin-et">Venta neta</span><b>${pesosM(tot.neto)}</b></span><span></span></div>`
    : `<div class="vacio">${MS.datos && MS.datos.lineas.length ? 'Nada con ese filtro.' : 'No hay ventas en este período.'}</div>`;
}
function conectarVentas(el, prods, H) {
  pintarFilasVentas(prods, H);
  const q = $('m-q'); if (q) q.addEventListener('input', () => { MS.q = q.value; pintarFilasVentas(prods, H); });
  el.querySelectorAll('[data-m-area]').forEach(b => b.addEventListener('click', () => { MS.area = b.dataset.mArea; el.querySelectorAll('[data-m-area]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pintarFilasVentas(prods, H); }));
  el.querySelectorAll('#m-filtros-ventas [data-m-canal]').forEach(b => b.addEventListener('click', () => { MS.canal = b.dataset.mCanal; MS.msg = ''; dibujarMargenes(el, 'ventas', H); }));
  const filas = $('m-filas');
  if (filas) filas.addEventListener('click', ev => { const b = ev.target.closest('[data-m-asociar]'); if (b) { const p = prods.find(x => x.clave === b.dataset.mAsociar); if (p) dialogoVinculo(p, el, 'ventas', H); } });
}

// ── Asociar productos ──
const canalTxt = p => (p.canal === 'b2b' ? 'B2B' : 'Caja');
const ventaTxt = p => Object.entries(p.porSuc).map(([sc, x]) => `${FV.NOMBRE_SUC[sc]}: ${cantM(x.cantidad)} · ${pesosM(x.neto)}`).join(' · ');
const propuestaTxt = p => !p.propuesta ? '' : p.propuesta.receta ? `${p.propuesta.recetaNombre}${p.propuesta.origen === 'catalogo' ? (p.canal === 'b2b' ? ' (del catálogo de B2B)' : ' (del catálogo de la caja)') : ' (nombre parecido)'}` : '';
const TXT_ASOC_CAT = 'Desde la v0.74.0 los productos se crean en el Catálogo (Catálogo → Productos), siempre desde una receta aprobada, una reventa o un cargo: el vínculo producto → receta sale de ahí, y cada orden B2B nueva guarda su receta al crearse.\nAsociar productos queda para lo que no está unido al Catálogo: los meses antiguos (antes de armar el catálogo) y algún producto que todavía no se une. Un mes ya cerrado no cambia.';
const TXT_PASAR_REV = 'Desde la v0.69.1 lo que se compra hecho y se vende tal cual (chocolates, té, infusiones, Magia…) tiene su propia área, Reventa: así su venta, su costo y su margen se ven aparte en el estado de resultados.\nEstos productos ya estaban asociados como reventa a otra área (por ejemplo Cafetería). No se cambian solos: con este botón pasan todos de una vez al área Reventa, después de que confirmes.\nSolo cambia el área: el costo de compra, las unidades por venta y el envase quedan iguales. Cada cambio queda en el historial del producto. Un mes ya cerrado no cambia (se ve como quedó al cerrarlo).';
function htmlAsociar(prods, H) {
  const t = FV.totales(prods), sin = prods.filter(p => !p.vinculo), asoc = prods.filter(p => p.vinculo);
  const rev = FV.reventaFueraDeArea(MS.vinc);   // v0.69.1: todos los vínculos de reventa (no solo los vendidos en el período)
  const deCat = sin.filter(p => p.propuesta && p.propuesta.origen === 'catalogo');
  const fila = (p, conCambio) => `<div class="fin-compra fin-masoc" data-m-prod="${H.esc(p.clave)}">
    <div><b>${H.esc(p.nombre)}</b><span class="ayuda">${canalTxt(p)} · ${H.esc(p.productoId)}</span></div>
    <div><span><b>${pesosM(p.neto)}</b> neto · ${cantM(p.cantidad)} ${p.cantidad === 1 ? 'vendido' : 'vendidos'}</span><span class="ayuda">${H.esc(ventaTxt(p))}</span></div>
    <div>${conCambio ? `<span class="fin-asoc">${ic('enlace', 16)}<b>${H.esc(FV.textoVinculo(p.vinculo))}</b>${p.vinculo.origen === 'catalogo' ? ` <span class="chip chip-chico c-verde" data-m-cat="${H.esc(p.vinculo.catalogoId)}">Catálogo ${H.esc(p.vinculo.catalogoId)}</span>` : ''}</span><span class="ayuda">${H.esc(p.vinculo.area ? FV.NOMBRE_AREA[p.vinculo.area] || p.vinculo.area : '')}${p.vinculo.por ? ` · ${H.esc(p.vinculo.por)} · ${fechaTxt(p.vinculo.fecha)}` : ''}</span>`
      : p.propuesta && p.propuesta.receta ? `<span>Sugerencia: <b>${H.esc(propuestaTxt(p))}</b></span><span class="ayuda">${H.esc(FV.NOMBRE_AREA[p.propuesta.area] || p.propuesta.area || '')}</span>`
      : `<span class="ayuda">Sin sugerencia${p.propuesta && p.propuesta.aviso ? ': ' + H.esc(p.propuesta.aviso) : ''}</span>`}</div>
    <div class="acciones fin-c-acc">${!conCambio && p.propuesta && p.propuesta.receta ? `<button type="button" class="btn" data-m-confirmar="${H.esc(p.clave)}">${ic('check', 16)} Confirmar</button>` : ''}
      ${conCambio && p.vinculo.origen === 'catalogo' ? `<a class="btn-sec" href="#catalogo/productos/${H.esc(p.vinculo.catalogoId)}">Ver en el Catálogo</a>` : ''}<button type="button" class="btn-sec" data-m-asociar="${H.esc(p.clave)}">${conCambio ? (p.vinculo.origen === 'catalogo' ? 'Meses anteriores' : 'Cambiar') : 'Asociar…'}</button></div></div>`;
  return `<section class="tarjeta" aria-labelledby="t-m-asoc">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-asoc">Asociar productos ${H.info('Asociar y el Catálogo', TXT_ASOC_CAT)} ${H.info('Asociar productos', 'Cada producto que se vende en la caja o en B2B se asocia a la receta que lo produce: de ahí sale su área, su costo y su margen.\nReventa: algo que se compra hecho y se vende tal cual (bebidas, chocolates, té, Magia…). Va al área Reventa (se propone sola; puedes elegir otra) y anotas su costo de compra neto (por ahora a mano).\nNo es un producto: propinas, cargos de despacho, ajustes… no suman en la venta por producto.\nUnidades por venta: cuántas unidades de la receta lleva una venta (una "caja de 6" = 6).\nLa sugerencia sale primero del ID de receta que ya tiene el producto en el catálogo de la caja o de B2B; si no, de un nombre parecido. Nada se asocia solo: tú confirmas.\nCada cambio queda en el historial. Se guarda en Finanzas (fen-gastos): no cambia nada en la caja ni en B2B.')}</h2>
      <span class="chip ${sin.length ? 'c-amarillo' : 'c-verde'}">${nf(sin.length)} sin asociar</span></div>
    ${selectorPeriodo(H)}
    <p class="ok-texto" id="m-msg" role="status">${H.esc(MS.msg)}</p><p class="error" id="m-err" role="alert">${H.esc(MS.err)}</p>
    ${htmlFuente(H)}
    ${htmlCobertura(t, sin.length, H)}
    ${deCat.length ? `<div class="fin-mcat"><span>${nf(deCat.length)} ${deCat.length === 1 ? 'producto ya tiene' : 'productos ya tienen'} su receta en el catálogo de la caja o de B2B (${pesosM(deCat.reduce((a, p) => a + p.neto, 0))}). ${H.info('Vínculos del catálogo', 'Son los productos que ya tienen un ID de receta (ID_receta) en el catálogo de la caja o en Productos de B2B, y esa receta existe en Producción. Confirmarlos de una vez los asocia a esa receta, con 1 unidad por venta. Si alguno es una caja o un pack, cámbialo después con "Cambiar".')}</span>
      <button type="button" class="btn" id="m-cat">${ic('check', 16)} Confirmar los ${nf(deCat.length)} del catálogo</button></div>` : ''}
    ${rev.length ? `<div class="fin-mcat fin-mrev" id="m-rev"><span>${nf(rev.length)} ${rev.length === 1 ? 'producto de reventa está' : 'productos de reventa están'} en otra área (${H.esc([...new Set(rev.map(v => FV.NOMBRE_AREA[v.area] || v.area || 'sin área'))].join(', '))}). ${H.info('Pasar al área Reventa', TXT_PASAR_REV)}</span>
      <button type="button" class="btn-sec" id="m-rev-pasar">${ic('enlace', 16)} Pasar los productos de reventa al área REVENTA (${nf(rev.length)})</button></div>` : ''}
    <h3 class="fin-dtit">Sin asociar, de mayor a menor venta</h3>
    <div class="fin-compras" id="m-sin">${sin.length ? sin.map(p => fila(p, false)).join('') : '<div class="vacio">Todos los productos vendidos en el período están asociados.</div>'}</div>
    ${asoc.length ? `<details class="fin-sindet" id="m-asoc-det" ${MS.verAsoc ? 'open' : ''}><summary>Ya asociados <span class="chip c-gris chip-chico">${nf(asoc.length)}</span></summary>
      <div class="fin-compras" id="m-asoc">${asoc.map(p => fila(p, true)).join('')}</div></details>` : ''}
  </section>`;
}
function conectarAsociar(el, prods, H) {
  const det = $('m-asoc-det'); if (det) det.addEventListener('toggle', () => { MS.verAsoc = det.open; });
  el.querySelectorAll('[data-m-asociar]').forEach(b => b.addEventListener('click', () => { const p = prods.find(x => x.clave === b.dataset.mAsociar); if (p) dialogoVinculo(p, el, 'asociar', H); }));
  el.querySelectorAll('[data-m-confirmar]').forEach(b => b.addEventListener('click', async () => {
    const p = prods.find(x => x.clave === b.dataset.mConfirmar); if (!p || !p.propuesta) return;
    b.disabled = true;
    try {
      const r = await F.guardarVinculo({ canal: p.canal, productoId: p.productoId, nombre: p.nombre, tipo: 'receta', receta: p.propuesta.receta, unidadesPorVenta: 1, origen: p.propuesta.origen });
      MS.vinc[r.clave] = r.doc; H.registrar('Finanzas: asoció un producto de venta', `${p.nombre} → ${p.propuesta.recetaNombre}`);
      MS.msg = `${p.nombre} → ${p.propuesta.recetaNombre}.`; dibujarMargenes(el, 'asociar', H);
    } catch (e) { b.disabled = false; $('m-err').textContent = error(e, H); }
  }));
  const pr = $('m-rev-pasar');
  if (pr) pr.addEventListener('click', () => dialogoPasarReventa(el, H));
  const c = $('m-cat');
  if (c) c.addEventListener('click', async () => {
    c.disabled = true; c.lastChild.textContent = ' Guardando…';
    try {
      const n = await F.confirmarCatalogo(prods.filter(p => !p.vinculo && p.propuesta && p.propuesta.origen === 'catalogo'));
      MS.vinc = await F.leerVinculos(); H.registrar('Finanzas: confirmó vínculos del catálogo', `${n} productos`);
      MS.msg = `${nf(n)} ${n === 1 ? 'producto asociado' : 'productos asociados'} a su receta del catálogo.`; dibujarMargenes(el, 'asociar', H);
    } catch (e) { c.disabled = false; c.lastChild.textContent = ' Confirmar los del catálogo'; $('m-err').textContent = error(e, H); }
  });
}
// v0.69.1 · Confirmar antes de pasar los vínculos de reventa al área REVENTA (lista con el área de hoy de cada uno)
function dialogoPasarReventa(el, H) {
  const rev = FV.reventaFueraDeArea(MS.vinc);
  if (!rev.length) return;
  const d = H.dialogo(`<form class="form-dialogo" id="m-rev-f" novalidate>
    <h2>Pasar al área Reventa</h2>
    <p>${nf(rev.length)} ${rev.length === 1 ? 'producto de reventa pasa' : 'productos de reventa pasan'} al área <b>Reventa</b>. Solo cambia el área: el costo de compra, las unidades por venta y el envase quedan iguales.</p>
    <ul class="fin-hist-lista fin-rev-lista" id="m-rev-lista">${rev.map(v => `<li><div><b>${H.esc(v.nombre || v.productoId || v.clave)}</b> · ${v.canal === 'b2b' ? 'B2B' : 'Caja'}</div><span class="ayuda">Hoy: ${H.esc(FV.NOMBRE_AREA[v.area] || v.area || 'sin área')} → Reventa</span></li>`).join('')}</ul>
    <p class="nota-i">(i) Cada cambio queda en el historial del producto (Cambiar → Historial). Los meses ya cerrados no cambian: se ven como quedaron al cerrarlos.</p>
    <p class="error" id="m-rev-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="m-rev-no">Cancelar</button><button type="submit" class="btn" id="m-rev-si">${ic('check', 16)} Pasar ${nf(rev.length)} a Reventa</button></div>
  </form>`);
  d.querySelector('#m-rev-no').addEventListener('click', () => d.close());
  d.querySelector('#m-rev-f').addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = d.querySelector('#m-rev-si'), err = d.querySelector('#m-rev-err'); err.textContent = '';
    b.disabled = true; b.lastChild.textContent = ' Guardando…';
    try {
      const r = await F.pasarReventaArea(rev.map(v => v.clave));
      Object.entries(r.cambiados).forEach(([k, doc]) => { MS.vinc[k] = doc; });
      H.registrar('Finanzas: pasó productos de reventa al área REVENTA', `${r.n} productos`);
      MS.msg = r.n ? `${nf(r.n)} ${r.n === 1 ? 'producto de reventa pasó' : 'productos de reventa pasaron'} al área Reventa.` : 'No había productos para pasar: ya estaban en Reventa.';
      MS.err = ''; d.close(); dibujarMargenes(el, 'asociar', H);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.lastChild.textContent = ` Pasar ${nf(rev.length)} a Reventa`; }
  });
}
function dialogoVinculo(p, el, volver, H) {
  // v0.74.0: si el producto está unido al Catálogo, su vínculo sale del maestro; aquí se cambia solo lo de los meses antes del catálogo
  const delCat = p.vinculo && p.vinculo.origen === 'catalogo' ? p.vinculo : null;
  const v = delCat ? ((MS.vinc || {})[p.clave] || null) : p.vinculo, recetas = MS.recetas || [];
  const sug = FV.sugerirRecetas(p.nombre, recetas), idsSug = new Set(sug.map(x => x.id));
  const tipo0 = v ? v.tipo : 'receta';
  const recSel = v && v.receta ? v.receta : p.propuesta && p.propuesta.receta ? p.propuesta.receta : '';
  // v0.69.1: una reventa nueva propone el área REVENTA; una reventa que ya tenía otra área la conserva (no se cambia sola)
  const area0 = v && v.tipo === 'reventa' && v.area ? v.area : FV.REVENTA;
  const etq = r => `${r.nombre}${r.area ? ' · ' + (FV.NOMBRE_AREA[FV.areaDe(r.area)] || r.area) : ''}${r.tipo === 'sub_receta' ? ' · sub receta' : ''}${r.estado === 'archivada' ? ' · archivada' : ''}`;
  const opt = (r, extra = '') => `<option value="${H.esc(r.id)}" ${r.id === recSel ? 'selected' : ''}>${H.esc(etq(r) + extra)}</option>`;
  // v0.72.0: las recetas archivadas (Catálogo) no se ofrecen; solo la que ya tenía este producto, para no perderla
  const ofrecer = r => r && (r.estado !== 'archivada' || (v && v.receta === r.id));
  const catRec = p.recetaCatalogo && recetas.find(r => r.id === p.recetaCatalogo && ofrecer(r));
  const ordenadas = [...recetas].filter(ofrecer).sort((a, b) => (a.tipo === 'sub_receta') - (b.tipo === 'sub_receta') || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const d = H.dialogo(`<form class="form-dialogo" id="m-vf" novalidate>
    <h2>${v ? 'Cambiar asociación' : 'Asociar producto'}</h2>
    <p class="fin-actual"><b>${H.esc(p.nombre)}</b> · ${canalTxt(p)}</p>
    ${delCat ? `<p class="aviso" id="m-v-delcat">Este producto está en el Catálogo (${H.esc(delCat.catalogoId)}): desde ${H.esc(MS.maestro && MS.maestro.desde ? NOMBRE_MES(MS.maestro.desde) : 'que se armó el catálogo')} su receta sale de ahí (<a href="#catalogo/productos/${H.esc(delCat.catalogoId)}">ver en el Catálogo</a>). Lo que guardes aquí vale solo para los meses anteriores. ${H.info('Asociar y el Catálogo', TXT_ASOC_CAT)}</p>` : ''}
    <p class="ayuda">${H.esc(ventaTxt(p))} en el período${p.recetaCatalogo ? ` · ID de receta en el catálogo: ${H.esc(p.recetaCatalogo)}${catRec ? '' : ' (no está en Producción)'}` : ''}</p>
    <fieldset class="fin-as-tipo"><legend class="sr">Qué es</legend>
      <label class="check"><input type="radio" name="m-vt" value="receta" ${tipo0 === 'receta' ? 'checked' : ''}> Se hace con una receta</label>
      <label class="check"><input type="radio" name="m-vt" value="reventa" ${tipo0 === 'reventa' ? 'checked' : ''}> Es reventa (se compra hecho)</label>
      <label class="check"><input type="radio" name="m-vt" value="ignorar" ${tipo0 === 'ignorar' ? 'checked' : ''}> No es un producto (propina, cargo, ajuste)</label></fieldset>
    <div id="m-v-rec" class="${tipo0 === 'receta' ? '' : 'oculto'}"><div class="campo"><label for="m-v-receta">Receta</label><select id="m-v-receta"><option value="">Elige…</option>
      ${catRec ? opt(catRec, ' · del catálogo') : ''}${sug.filter(x => !catRec || x.id !== catRec.id).map(x => opt(recetas.find(r => r.id === x.id), ' · parecida')).join('')}${ordenadas.filter(r => !idsSug.has(r.id) && (!catRec || r.id !== catRec.id)).map(r => opt(r)).join('')}</select>
      ${sug.length || catRec ? '<span class="ayuda">Primero la del catálogo y las de nombre parecido.</span>' : ''}${recetas.sinProduccion ? '<span class="aviso">Producción no está conectada: la lista es la del último costeo (solo recetas aprobadas).</span>' : ''}</div></div>
    <div id="m-v-rev" class="${tipo0 === 'reventa' ? '' : 'oculto'}">
      <div class="campo"><label for="m-v-area">Área ${H.info('Área de la reventa', 'Lo que se compra hecho y se vende tal cual va al área Reventa: así su venta, su costo de compra y su margen se ven aparte en el estado de resultados.\nPuedes elegir otra área si de verdad corresponde. Una reventa que ya tenía otra área la conserva hasta que la cambies aquí (o con "Pasar los productos de reventa al área REVENTA").')}</label><select id="m-v-area"><option value="">Elige…</option>${FV.AREAS.map(a => `<option value="${a}" ${a === area0 ? 'selected' : ''}>${FV.NOMBRE_AREA[a]}</option>`).join('')}</select>
        <span class="ayuda" id="m-v-area-prop">${v && v.tipo === 'reventa' && v.area && v.area !== FV.REVENTA ? `Hoy está en ${H.esc(FV.NOMBRE_AREA[v.area] || v.area)}. Lo propuesto para la reventa es Reventa.` : 'Propuesta: Reventa.'}</span></div>
      <div class="campo"><label for="m-v-revid">De la lista de reventa ${H.info('Lista de reventa', 'La reventa del Catálogo (pestaña Reventa), con su ID y su costo neto por unidad. Al elegirla, el costo se copia abajo; lo puedes cambiar para este producto.\nSi no está en la lista, agrégala en Catálogo → Reventa. Un vínculo antiguo sin reventa elegida sigue funcionando igual.')}</label><select id="m-v-revid"><option value="">${v && v.reventaId ? H.esc(v.reventaId) : 'Cargando…'}</option></select></div>
      <div class="campo"><label for="m-v-costo">Costo de compra por unidad, neto (opcional) ${H.info('Costo de la reventa', 'Lo que pagas por una unidad, sin IVA. Por ahora se anota a mano; es el costo directo de la reventa en Margen por producto. Si lo copias de una boleta con IVA, marca la casilla.')}</label>
        <input id="m-v-costo" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${v && v.costoReventaNeto !== null && v.costoReventaNeto !== undefined ? H.esc(String(v.costoReventaNeto)) : ''}">
        <label class="check fin-check"><input type="checkbox" id="m-v-iva"> Lo escribo con IVA (19 %)</label></div></div>
    <div id="m-v-upv" class="campo ${tipo0 === 'ignorar' ? 'oculto' : ''}"><label for="m-v-u">Unidades por venta ${H.info('Unidades por venta', 'Cuántas unidades de la receta (o de la reventa) lleva una venta de este producto. Casi siempre 1. Una "caja de 6 alfajores" = 6; "media docena" = 6.')}</label>
      <input id="m-v-u" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${H.esc(String(v ? v.unidadesPorVenta ?? 1 : 1))}"></div>
    <div id="m-v-extra" class="campo ${tipo0 === 'ignorar' ? 'oculto' : ''}"><label for="m-v-ex">Costo extra por venta, neto (opcional) ${H.info('Costo extra por venta', 'Envases o lo que se agrega al vender y no está en la receta (caja, bolsa, vaso, tapa), sin IVA, por cada venta de este producto: una "caja de 6" lleva una caja.\nSuma al costo directo en Margen por producto y en Precio sugerido.')}</label>
      <input id="m-v-ex" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${v && v.costoExtraNeto !== null && v.costoExtraNeto !== undefined ? H.esc(String(v.costoExtraNeto)) : ''}"></div>
    <div class="campo"><label for="m-v-nota">Nota (opcional)</label><input id="m-v-nota" type="text" maxlength="200" value="${H.esc((v && v.nota) || '')}"></div>
    <p class="error" id="m-v-err" role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" id="m-v-no">Cancelar</button><button type="submit" class="btn" id="m-v-si">Guardar</button></div>
    ${v ? '<div class="fin-hist"><h3>Historial</h3><div id="m-v-hist"><p class="ayuda">Cargando…</p></div></div>' : ''}
  </form>`);
  conBuscador(d.querySelector('#m-v-receta'));
  d.querySelector('#m-v-no').addEventListener('click', () => d.close());
  const tipo = () => d.querySelector('input[name="m-vt"]:checked').value;
  const vis = () => { const t = tipo(); d.querySelector('#m-v-rec').classList.toggle('oculto', t !== 'receta'); d.querySelector('#m-v-rev').classList.toggle('oculto', t !== 'reventa'); d.querySelector('#m-v-upv').classList.toggle('oculto', t === 'ignorar'); d.querySelector('#m-v-extra').classList.toggle('oculto', t === 'ignorar'); };
  d.querySelectorAll('input[name="m-vt"]').forEach(r => r.addEventListener('change', vis));
  // v0.73.0: la lista de reventa (cat_reventa, de la memoria de fs-gastos): activas, más la que ya tenía este producto
  const selRev = d.querySelector('#m-v-revid');
  import('./reventa.js?v=0.138.0').then(R => R.leer()).then(({ lista }) => {
    MS.reventa = lista;
    const ofrecer = lista.filter(x => x.estado !== 'archivado' || (v && v.reventaId === x.id)).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
    selRev.innerHTML = `<option value="">${ofrecer.length ? 'Elige…' : 'La lista de reventa está vacía (Catálogo → Reventa)'}</option>` + ofrecer.map(x => `<option value="${H.esc(x.id)}" data-costo="${x.costoNeto ?? ''}" data-nombre="${H.esc(x.nombre)}" ${v && v.reventaId === x.id ? 'selected' : ''}>${H.esc(x.nombre)} · ${H.esc(x.id)} · $${(Math.round(Number(x.costoNeto || 0) * 100) / 100).toLocaleString('es-CL')} / ${H.esc(x.unidad || 'un')}${x.estado === 'archivado' ? ' · archivada' : ''}</option>`).join('');
  }).catch(() => { selRev.innerHTML = `<option value="">${v && v.reventaId ? H.esc(v.reventaId) : 'Sin la lista (conecta la base de Gastos y Finanzas)'}</option>`; });
  selRev.addEventListener('change', () => { const o = selRev.selectedOptions[0]; if (o && o.value && o.dataset.costo !== '') { d.querySelector('#m-v-costo').value = o.dataset.costo; d.querySelector('#m-v-iva').checked = false; } });
  if (v) F.historialVinculo(p.clave).then(hs => {
    const c2 = d.querySelector('#m-v-hist'); if (!c2) return;
    c2.innerHTML = hs.length ? `<ul class="fin-hist-lista">${hs.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${H.esc(FV.textoVinculo(h.despues))}</div><span class="ayuda">${h.antes ? `Antes: ${H.esc(FV.textoVinculo(h.antes))} · ` : ''}${H.esc(h.por || '')}${h.nota ? ` · ${H.esc(h.nota)}` : ''}</span></li>`).join('')}</ul>` : '<p class="ayuda">Sin cambios.</p>';
  }).catch(() => {});
  d.querySelector('#m-vf').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = d.querySelector('#m-v-err'), b = d.querySelector('#m-v-si'); err.textContent = '';
    const datos = { canal: p.canal, productoId: p.productoId, nombre: p.nombre, tipo: tipo(), receta: d.querySelector('#m-v-receta').value, area: d.querySelector('#m-v-area').value,
      costoReventaNeto: FC.casilla(d.querySelector('#m-v-costo')), conIva: d.querySelector('#m-v-iva').checked, reventaId: selRev.value, reventaNombre: (selRev.selectedOptions[0] && selRev.selectedOptions[0].dataset.nombre) || '', unidadesPorVenta: FC.casilla(d.querySelector('#m-v-u')), costoExtraNeto: FC.casilla(d.querySelector('#m-v-ex')), nota: d.querySelector('#m-v-nota').value,
      origen: p.propuesta && p.propuesta.receta === d.querySelector('#m-v-receta').value ? p.propuesta.origen : 'manual' };
    try { FV.armarVinculo(v, datos, { recetas }); } catch (e) { err.textContent = e.message; return; }
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const r = await F.guardarVinculo(datos);
      MS.vinc[r.clave] = r.doc;
      H.registrar('Finanzas: asoció un producto de venta', `${p.nombre} (${canalTxt(p)}) → ${FV.textoVinculo(r.doc)}`);
      MS.msg = `${p.nombre} → ${FV.textoVinculo(r.doc)}.`; MS.err = '';
      d.close(); dibujarMargenes(el, volver, H);
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
}

// ═══════════════ v0.60.0 · Márgenes (F2 paso 2): margen de contribución, matriz volumen × margen, precio sugerido y ajustes ═══════════════
// Reglas puras en finanzas-margenes.js. Usa el último costo guardado de cada receta (costos_recetas) y su historial (costo del mes).
Object.assign(MS, { modo: 'mes', mcCanal: 'todos', mcArea: 'todas', mcOrden: 'mc', mxArea: '', prArea: 'todas', ajMsg: '' });
const cfgM = () => FMG.configMargenes(MS.costos && MS.costos.config && MS.costos.config.margenes);
const calcM = (canal = MS.mcCanal) => FMG.calcularMargenes(MS.datos ? MS.datos.porMes || [] : [], MS.vinc || {}, MS.costos || {}, cfgM(), { hoy: hoyTxt(), modo: MS.modo, canal, maestro: MS.maestro || null });
const pctM = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : `${(Math.round(v * 10 ** d) / 10 ** d).toLocaleString('es-CL')}\u00a0%`);
const pctF = v => pctM(v * 100);
const unidTxt = f => `${cantM(f.unidadesL)}${f.lectura === 'kg' ? ' kg' : ''}`;
const porTxt = f => (f.lectura === 'kg' ? ' / kg' : '');
const mcCls = v => (v === null || v === undefined ? '' : v < 0 ? 'fin-neg' : '');
// v0.80.1 · Receta pendiente (Catálogo)
const TXT_PEND_FIN = 'Productos del Catálogo que se venden con la "Receta pendiente": su receta todavía no está aprobada en Cocina (o no existe). Cuentan como asociados y su venta va a su área, pero no tienen costo directo: no entran en el margen (están en "Sin costo o incompleto").\nEs temporal: aprueba o crea la receta en Cocina y toca "Unir con su receta" en Catálogo → Productos. Desde ahí tienen costo y margen.';
const MOTIVO = m => m.replace(/^sin costo calculado$/, 'la receta no tiene costo calculado (ábrela en Costos)').replace(/^costo 0$/, 'costo 0');

// Aviso "falta configurar" (solo aquí, no en Hoy)
function avisoComision(H) {
  const c = cfgM();
  if (FMG.comisionConfigurada(c)) return '';
  return `<p class="aviso" id="m-falta-com">${ic('neto', 18)} <span><b>Falta configurar la comisión de tarjeta</b> (débito, crédito y otros). Mientras tanto se usa 0 % y el margen de la caja sale más alto de lo real. <a href="#finanzas/margenes/ajustes">Configurar en Ajustes</a></span></p>`;
}
function selectorCosto(H, r) {
  const b = (k, t) => `<button type="button" class="chip-filtro" data-m-modo="${k}" aria-pressed="${MS.modo === k}">${t}</button>`;
  const f = r.fuentes, usado = MS.modo === 'hoy' ? 'Costo de hoy para todo el período.'
    : 'Costo del mes: ' + [f.mes ? `${nf(f.mes)} ${f.mes === 1 ? 'línea' : 'líneas'} con el costo de ese mes (historial)` : '', f.hoy ? `${nf(f.hoy)} del mes en curso con el costo de hoy` : '', f.hoy_sin_hist ? `${nf(f.hoy_sin_hist)} con el de hoy porque no hay historial de ese mes` : ''].filter(Boolean).join(', ') + '.';
  return `<div class="fin-mmodo"><div class="chips" role="group" aria-label="Qué costo usar">${b('mes', 'Costo del mes')}${b('hoy', 'Costo de hoy')}</div>
    <span class="ayuda" id="m-costo-usado">${H.esc(usado)} ${H.info('Qué costo directo se usa', 'Costo del mes (recomendado): para cada mes del período, el último costo por unidad registrado en el historial de Costos hasta el último día de ese mes. El mes en curso usa el costo de hoy. Si un producto no tiene historial de ese mes (por ejemplo, Costos se empezó a usar después), se usa el de hoy y se dice aquí.\nEl historial guarda los cambios de más de 0,5 %, así que el costo del mes puede diferir en menos de eso.\nCosto de hoy: el último cálculo de Costos para todo el período (útil para ver cómo quedaría el margen con los precios de compra de hoy).')}</span></div>`;
}
function tarjetaMC(tit, t, H, { id = '', ayuda = false, cls = '' } = {}) {
  const i = (n, x) => (ayuda ? ' ' + H.info(n, x) : '');
  return `<div class="fin-mcc ${cls}" ${id ? `id="${id}"` : ''}><h4>${H.esc(tit)}</h4><dl>
    <div><dt>Venta neta${i('Venta neta', 'Lo vendido sin IVA, de los productos con costo (los sin costo van aparte, abajo).')}</dt><dd>${pesosM(t.neto)}</dd></div>
    <div><dt>Costo directo${i('Costo directo', 'Receta: costo por unidad × unidades (vendido × unidades por venta). Reventa: costo de compra neto × unidades. Más el costo extra por venta (envases que no están en la receta).')}</dt><dd>− ${pesosM(t.costo)}</dd></div>
    <div><dt>Costos de venta${i('Costos de venta', 'Caja: comisión de tarjeta = venta neta × 1,19 × (parte pagada con cada medio × su comisión). La comisión se cobra sobre lo pagado, con IVA.\nB2B: despacho (% de la venta neta, o $ por orden repartido según la venta de cada producto).\nSe configuran en Ajustes.')}</dt><dd>− ${pesosM(t.costoVenta)}</dd></div>
    <div class="fin-mcc-mc"><dt>Margen de contribución${i('Margen de contribución', 'MC = venta neta − costo directo − costos de venta. Es lo que queda para pagar los fijos del área y los comunes, y la utilidad.')}</dt><dd class="${mcCls(t.mc)}">${pesosM(t.mc)}</dd></div>
    <div><dt>MC %${i('MC %', 'MC ÷ venta neta. Se mide sobre el precio neto (sin IVA).')}</dt><dd><b>${pctM(t.mcPct)}</b></dd></div></dl></div>`;
}

// ── Margen por producto ──
function htmlMargen(H) {
  const r = calcM(), t = r.totales, per = perActual();
  const filas = FMG.ordenarMargen(r.filas.filter(f => f.ok && (MS.mcArea === 'todas' || f.area === MS.mcArea)), MS.mcOrden);
  const fuera = r.filas.filter(f => !f.ok).sort((a, b) => b.neto - a.neto);
  const sucs = FV.SUCS.filter(sc => MS.mcCanal === 'todos' || sc === MS.mcCanal);
  return `<section class="tarjeta" aria-labelledby="t-m-mc">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-mc">Margen por producto ${H.info('Margen de contribución por producto', 'MC = venta neta − costo directo − costos de venta (comisión de tarjeta en la caja, despacho en B2B). MC % = MC ÷ venta neta.\nTodo en neto. Lo indirecto (sueldos fijos, arriendo, luz) no se reparte por producto: entra a nivel de área en Resultados.\nLos productos sin costo (sin asociar, receta sin costo, costo incompleto o reventa sin costo de compra) se muestran aparte y no entran en los totales ni en los %.')}</h2>
      <span class="ayuda">${H.esc(fechaTxt(per.desde))} al ${H.esc(fechaTxt(per.hasta))}</span></div>
    ${selectorPeriodo(H)}
    <p class="ok-texto" id="m-msg" role="status">${H.esc(MS.msg)}</p><p class="error" id="m-err" role="alert">${H.esc(MS.err)}</p>
    ${htmlFuente(H)}
    ${avisoComision(H)}
    ${selectorCosto(H, r)}
    <p class="fin-mcob-nota" id="m-mc-cob">Con costo: <b>${pctM(t.coberturaPct)}</b> de la venta neta (${pesosM(t.todo - t.excluido)} de ${pesosM(t.todo)}). ${H.info('Cobertura del margen', 'Parte de la venta neta del período (y canal elegido) que tiene costo directo y entra en el margen. El resto (abajo, "Sin costo o incompleto") no se cuenta en los totales ni en los %: hay que completarlo para que el margen del área sea real.')}${fuera.length ? ` <a href="#m-fuera">${nf(fuera.length)} sin costo o incompleto (${pesosM(t.excluido)})</a>` : ''}</p>
    <h3 class="fin-dtit">Por canal</h3>
    <div class="fin-mccs" id="m-mc-canales">${tarjetaMC(MS.mcCanal === 'todos' ? 'Total' : 'Total del canal', t.total, H, { ayuda: true, cls: 'fin-mcc-tot', id: 'm-mc-total' })}${sucs.map(sc => tarjetaMC(FV.NOMBRE_SUC[sc], t.porSuc[sc], H)).join('')}</div>
    <h3 class="fin-dtit">Por área</h3>
    <div class="fin-mccs" id="m-mc-areas">${areasVer(t.porArea).map(a => tarjetaMC(FV.NOMBRE_AREA[a], t.porArea[a], H)).join('')}</div>
    <div class="filtros fin-filtros" id="m-mc-filtros">
      <div class="chips" role="group" aria-label="Filtrar por área">${['todas', ...areasVer(t.porArea, MS.mcArea)].map(a => `<button type="button" class="chip-filtro" data-mc-area="${a}" aria-pressed="${MS.mcArea === a}">${a === 'todas' ? 'Todas' : FV.NOMBRE_AREA[a]}</button>`).join('')}</div>
      <div class="chips" role="group" aria-label="Filtrar por canal">${['todos', ...FV.SUCS].map(c => `<button type="button" class="chip-filtro" data-mc-canal="${c}" aria-pressed="${MS.mcCanal === c}">${c === 'todos' ? 'Todos los canales' : FV.NOMBRE_SUC[c]}</button>`).join('')}</div>
      <div class="campo fin-orden"><label for="m-mc-orden">Ordenar por</label><select id="m-mc-orden">${FMG.ORDENES_MC.map(([k, x]) => `<option value="${k}" ${MS.mcOrden === k ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="fin-mctabla" aria-label="Margen por producto">
      <div class="fin-mcf fin-mcab" aria-hidden="true"><span>Producto</span><span>Unidades</span><span>Precio neto prom.</span><span>Costo unit.</span><span>MC unit.</span><span>MC %</span><span>MC total</span><span>% del MC total</span></div>
      <div id="m-mc-filas">${filas.length ? filas.map(f => filaMC(f, H)).join('') + filaTotalMC(filas) : `<div class="vacio">${r.filas.length ? 'Ningún producto con costo en este filtro.' : 'No hay ventas en este período.'}</div>`}</div></div>
    <p class="ayuda fin-mcleyenda">Por unidad de la receta (o por kg si la receta rinde gramos). Costo unit. = costo directo ÷ unidades; MC unit. = MC ÷ unidades; % del MC total = MC del producto ÷ MC de todos los productos con costo. ${H.info('Cómo leer la tabla', 'Unidades: lo vendido × unidades por venta.\nPrecio neto prom.: venta neta ÷ unidades.\nCosto unit.: costo directo ÷ unidades (promedio del período si el costo cambió).\nMC unit.: (venta neta − costo directo − costos de venta) ÷ unidades.\nMC %: MC ÷ venta neta.\nMC total: el margen de contribución del producto en el período.\n% del MC total: cuánto aporta al margen de todos los productos con costo (del canal elegido).')}</p>
  </section>
  ${fuera.length ? `<section class="tarjeta" aria-labelledby="t-m-fuera" id="m-fuera">
    <h2 id="t-m-fuera">Sin costo o incompleto <span class="chip c-amarillo chip-chico">${nf(fuera.length)}</span> ${H.info('Sin costo o incompleto', 'Productos vendidos que no entran en el margen: sin asociar a una receta, receta sin costo calculado o con costo incompleto (le falta precio a algún ingrediente), o reventa sin costo de compra.\nSu venta no se cuenta en los totales ni en los % de arriba. Complétalos en Asociar productos o en Costos.')}</h2>
    <ul class="fin-mfuera">${fuera.map(f => `<li data-mc-fuera="${H.esc(f.clave)}"><div><b>${H.esc(f.nombre)}</b> <span class="ayuda">${H.esc(FV.NOMBRE_AREA[f.area] || 'Sin área')}</span><span class="ayuda">${H.esc(f.motivos.map(MOTIVO).join(' · '))}</span></div>
      <div class="fin-mfuera-d"><span>${pesosM(f.neto)} <span class="ayuda">neto</span></span>${f.tipo === 'receta' ? `<a href="#finanzas/costos/productos/r/${encodeURIComponent(f.receta)}">Ver costo</a>` : f.tipo === 'pendiente' ? `<a href="#catalogo/productos/falta-receta" data-mc-pend="${H.esc(f.catalogoId || '')}">Unir con su receta</a>` : '<a href="#finanzas/margenes/asociar">Asociar</a>'}</div></li>`).join('')}</ul></section>` : ''}`;
}
function filaMC(f, H) {
  const fuentes = f.fuentes.map(x => `${x.nombre} (${x.canal === 'b2b' ? 'B2B' : 'caja'}${x.unidadesPorVenta !== 1 ? ` × ${String(x.unidadesPorVenta).replace('.', ',')}` : ''})`).join(' · ');
  return `<div class="fin-mcf" data-mc-fila="${H.esc(f.clave)}">
    <span class="fin-nombre"><b>${H.esc(f.nombre)}</b> <span class="ayuda">${H.esc(FV.NOMBRE_AREA[f.area] || f.area || '')}${f.tipo === 'reventa' ? ' · reventa' : ''}</span>${f.tipo === 'receta' ? `<span class="ayuda fin-mcf-src">${H.esc(fuentes)}</span>` : ''}${f.fuenteCosto.includes('hoy_sin_hist') && MS.modo === 'mes' ? '<span class="ayuda">Costo de hoy (sin historial de ese mes)</span>' : ''}</span>
    <span><span class="fin-et">Unidades</span>${unidTxt(f)}</span>
    <span><span class="fin-et">Precio neto prom.</span>${f.precioUnit === null ? '—' : pesosM(f.precioUnit) + porTxt(f)}</span>
    <span><span class="fin-et">Costo unit.</span>${f.costoUnit === null ? '—' : pesosM(f.costoUnit) + porTxt(f)}</span>
    <span><span class="fin-et">MC unit.</span><span class="${mcCls(f.mcUnit)}">${f.mcUnit === null ? '—' : pesosM(f.mcUnit) + porTxt(f)}</span></span>
    <span><span class="fin-et">MC %</span><b class="${mcCls(f.mcPct)}">${pctM(f.mcPct)}</b></span>
    <span><span class="fin-et">MC total</span><b class="${mcCls(f.mc)}">${pesosM(f.mc)}</b></span>
    <span><span class="fin-et">% del MC total</span>${pctM(f.pctMcTotal)}</span></div>`;
}
function filaTotalMC(filas) {
  const n = filas.reduce((a, f) => a + f.neto, 0), mc = filas.reduce((a, f) => a + f.mc, 0), pt = filas.reduce((a, f) => a + (f.pctMcTotal || 0), 0);
  return `<div class="fin-mcf fin-mtotal" id="m-mc-tot"><span class="fin-nombre"><b>Total (${nf(filas.length)} ${filas.length === 1 ? 'producto' : 'productos'})</b> <span class="ayuda">venta neta ${pesosM(n)}</span></span>
    <span></span><span></span><span></span><span></span><span><span class="fin-et">MC %</span><b>${pctM(n > 0 ? mc / n * 100 : null)}</b></span><span><span class="fin-et">MC total</span><b>${pesosM(mc)}</b></span><span><span class="fin-et">% del MC total</span>${pctM(pt)}</span></div>`;
}
function conectarModo(el, parte, H) {
  el.querySelectorAll('[data-m-modo]').forEach(b => b.addEventListener('click', () => { MS.modo = b.dataset.mModo; MS.msg = ''; dibujarMargenes(el, parte, H); }));
}
function conectarMargen(el, H) {
  conectarModo(el, 'margen', H);
  el.querySelectorAll('[data-mc-area]').forEach(b => b.addEventListener('click', () => { MS.mcArea = b.dataset.mcArea; MS.msg = ''; dibujarMargenes(el, 'margen', H); }));
  el.querySelectorAll('[data-mc-canal]').forEach(b => b.addEventListener('click', () => { MS.mcCanal = b.dataset.mcCanal; MS.msg = ''; dibujarMargenes(el, 'margen', H); }));
  const o = $('m-mc-orden'); if (o) o.addEventListener('change', () => { MS.mcOrden = o.value; MS.msg = ''; dibujarMargenes(el, 'margen', H); });
}

// ── Matriz volumen × margen ──
function svgMatriz(m, nums, H) {
  const angosto = typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;   // en el celular, menos ancho = letra más grande
  const W = angosto ? 310 : 400, Hh = angosto ? 270 : 290, L = 54, R = 10, T = 12, B = 40, pw = W - L - R, ph = Hh - T - B;
  const xs = m.puntos.map(p => p.unidadesL), ys = m.puntos.map(p => p.mcUnit);
  const xMax = Math.max(...xs, m.volProm) * 1.15 || 1;
  let yMin = Math.min(0, ...ys, m.mcProm), yMax = Math.max(...ys, m.mcProm);
  const pad = (yMax - yMin) * 0.15 || Math.abs(yMax) * 0.15 || 1; yMax += pad; if (yMin < 0) yMin -= pad;
  const sx = x => L + x / xMax * pw, sy = y => T + (yMax - y) / (yMax - yMin) * ph;
  const cx = sx(m.volProm), cy = sy(m.mcProm);
  const k = v => Math.round(v).toLocaleString('es-CL');
  const zona = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="var(${c})" opacity=".55"/>`;
  const rot = (x, y, t, a) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="10" font-weight="700" fill="var(--suave)" stroke="var(--tarjeta)" stroke-width="3" paint-order="stroke">${t}</text>`;
  return `<svg class="fin-mx-svg" viewBox="0 0 ${W} ${Hh}" role="img" aria-labelledby="m-mx-svg-t m-mx-svg-d">
    <title id="m-mx-svg-t">Matriz volumen × margen de ${H.esc(FV.NOMBRE_AREA[m.area])}</title>
    <desc id="m-mx-svg-d">${nf(m.puntos.length)} productos. Eje horizontal: unidades vendidas (promedio ${k(m.volProm)}). Eje vertical: margen de contribución por unidad (promedio $${k(m.mcProm)}). Las listas de abajo tienen el mismo contenido.</desc>
    ${zona(cx, T, L + pw - cx, cy - T, '--verde')}${zona(L, T, cx - L, cy - T, '--azul')}${zona(cx, cy, L + pw - cx, T + ph - cy, '--amarillo')}${zona(L, cy, cx - L, T + ph - cy, '--rojo')}
    ${rot(cx + 4, cy - 5, 'Estrellas', 'start')}${rot(cx - 4, cy - 5, 'Con potencial', 'end')}${rot(cx + 4, cy + 13, 'De volumen', 'start')}${rot(cx - 4, cy + 13, 'Revisar', 'end')}
    <line x1="${cx}" y1="${T}" x2="${cx}" y2="${T + ph}" stroke="var(--suave)" stroke-dasharray="4 3"/><line x1="${L}" y1="${cy}" x2="${L + pw}" y2="${cy}" stroke="var(--suave)" stroke-dasharray="4 3"/>
    <line x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}" stroke="var(--borde)"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" stroke="var(--borde)"/>
    ${yMin < 0 ? `<line x1="${L}" y1="${sy(0)}" x2="${L + pw}" y2="${sy(0)}" stroke="var(--borde)"/>` : ''}
    <text x="${L}" y="${T + ph + 14}" font-size="10" fill="var(--suave)">0</text><text x="${cx}" y="${T + ph + 14}" font-size="10" text-anchor="middle" fill="var(--suave)">${k(m.volProm)}</text>
    <text x="${L + pw / 2}" y="${Hh - 6}" font-size="10.5" text-anchor="middle" fill="var(--texto)">Unidades vendidas →</text>
    <text x="${L - 4}" y="${cy + 3}" font-size="10" text-anchor="end" fill="var(--suave)">$${k(m.mcProm)}</text>
    <text x="11" y="${T + ph / 2}" font-size="10.5" text-anchor="middle" fill="var(--texto)" transform="rotate(-90 11 ${T + ph / 2})">MC por unidad →</text>
    ${m.puntos.map(p => `<g><title>${H.esc(`${nums[p.clave]}. ${p.nombre}: ${cantM(p.unidadesL)} ${p.lectura}, MC $${k(p.mcUnit)} por ${p.lectura}`)}</title><circle cx="${sx(p.unidadesL)}" cy="${sy(p.mcUnit)}" r="9" fill="var(--tarjeta)" stroke="var(--acento)" stroke-width="1.6"/>
      <text x="${sx(p.unidadesL)}" y="${sy(p.mcUnit) + 3.5}" font-size="9.5" font-weight="700" text-anchor="middle" fill="var(--acento)">${nums[p.clave]}</text></g>`).join('')}
  </svg>`;
}
function htmlMatriz(H) {
  const r = calcM('todos');
  const conDatos = FV.AREAS.filter(a => r.filas.some(f => f.ok && f.area === a && f.unidadesL > 0));
  if (!MS.mxArea || !FV.AREAS.includes(MS.mxArea)) MS.mxArea = conDatos[0] || 'PAN';
  const m = FMG.matriz(r.filas, MS.mxArea), per = perActual();
  const nums = {}; FMG.ordenarMargen(m.puntos, 'mc').forEach((p, i) => { nums[p.clave] = i + 1; });
  const mezcla = m.puntos.some(p => p.lectura === 'kg') && m.puntos.some(p => p.lectura === 'un');
  return `<section class="tarjeta" aria-labelledby="t-m-mx">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-mx">Volumen × margen ${H.info('Matriz volumen × margen', 'Cada producto con costo del área, según cuánto se vende (unidades del período) y cuánto deja cada unidad (margen de contribución por unidad, en pesos: el eje clásico de la ingeniería de menú, porque mide lo que aporta cada venta).\nLos cortes son los promedios del área: unidades = promedio simple de sus productos; MC por unidad = MC total del área ÷ unidades totales (promedio ponderado).\nEstrellas: mucho volumen y buen margen. De volumen: mucho volumen, margen bajo. Con potencial: poco volumen, buen margen. Revisar: poco volumen y margen bajo.\nTodos los canales juntos; usa el mismo costo que Margen por producto. Los productos sin costo no aparecen.')}</h2>
      <span class="ayuda">${H.esc(fechaTxt(per.desde))} al ${H.esc(fechaTxt(per.hasta))}</span></div>
    ${selectorPeriodo(H)}
    <p class="ok-texto" id="m-msg" role="status">${H.esc(MS.msg)}</p><p class="error" id="m-err" role="alert">${H.esc(MS.err)}</p>
    ${avisoComision(H)}
    ${selectorCosto(H, r)}
    <div class="chips fin-mx-areas" role="group" aria-label="Área">${FV.AREAS.filter(a => a !== FV.REVENTA || conDatos.includes(a) || MS.mxArea === a).map(a => `<button type="button" class="chip-filtro" data-mx-area="${a}" aria-pressed="${MS.mxArea === a}">${FV.NOMBRE_AREA[a]}</button>`).join('')}</div>
    ${m.puntos.length ? `<p class="ayuda" id="m-mx-prom">Promedios de ${H.esc(FV.NOMBRE_AREA[m.area])}: <b>${cantM(Math.round(m.volProm * 10) / 10)}</b> unidades por producto · MC <b>${pesosM(m.mcProm)}</b> por unidad ${H.info('Promedios del área', `Unidades: suma de las unidades de los ${m.puntos.length} productos ÷ ${m.puntos.length}.\nMC por unidad: MC total del área ÷ unidades totales.\nUn producto está "arriba" si su MC por unidad es igual o mayor que el promedio, y "a la derecha" si vende igual o más unidades que el promedio.`)}</p>
      ${mezcla ? '<p class="aviso">En esta área hay productos por kg (recetas que rinden gramos) y por unidad: compáralos con cuidado.</p>' : ''}
      <div class="fin-mx-grid">
        <div class="fin-mx-listas" id="m-mx-listas">${FMG.CUADRANTES.map(c => `<div class="fin-mx-q fin-mx-${c}" data-mx-q="${c}"><h3>${FMG.NOMBRE_CUADRANTE[c]} <span class="chip c-gris chip-chico">${nf(m.grupos[c].length)}</span></h3>
          <p class="ayuda">${H.esc(FMG.GUIA_CUADRANTE[c])}</p>
          ${m.grupos[c].length ? `<ol>${m.grupos[c].map(p => `<li><span class="fin-mx-n" aria-hidden="true">${nums[p.clave]}</span><span><b>${H.esc(p.nombre)}</b><span class="ayuda">${cantM(p.unidadesL)} ${p.lectura === 'kg' ? 'kg' : 'un'} · MC ${pesosM(p.mcUnit)}${porTxt(p)} · ${pctM(p.mcPct)}</span></span></li>`).join('')}</ol>` : '<p class="ayuda">Ninguno.</p>'}</div>`).join('')}</div>
        <figure class="fin-mx-fig">${svgMatriz(m, nums, H)}<figcaption class="ayuda">El número de cada punto es el de las listas. Línea punteada: promedios del área.</figcaption></figure>
      </div>` : `<div class="vacio">${H.esc(FV.NOMBRE_AREA[m.area])} no tiene productos con costo vendidos en este período.</div>`}
  </section>`;
}
function conectarMatriz(el, H) {
  conectarModo(el, 'matriz', H);
  el.querySelectorAll('[data-mx-area]').forEach(b => b.addEventListener('click', () => { MS.mxArea = b.dataset.mxArea; MS.msg = ''; dibujarMargenes(el, 'matriz', H); }));
}

// ── Precio sugerido ──
function badgeDif(c) {
  if (!c) return '';
  const t = { bajo: ['c-rojo', 'Bajo'], ok: ['c-verde', 'OK'], sobre: ['c-azul', 'Sobre'] }[c.estado];
  return ` <span class="chip ${t[0]} chip-chico" data-dif="${c.estado}">${t[1]} ${c.pct > 0 ? '+' : c.pct < 0 ? '−' : ''}${pctM(Math.abs(c.pct))}</span>`;
}
function htmlPrecios(H) {
  const cfg = cfgM(), r = calcM('todos'), k = FMG.costosVentaPeriodo(r.totales, cfg);
  const filas = FMG.tablaPrecios(FMG.conListas(r.filas, MS.datos && MS.datos.catalogo ? MS.datos.catalogo.caja : {}), (MS.costos && MS.costos.docs) || {}, cfg, { ...k, vinculos: vincEf() });
  const conRev = filas.some(f => f.area === FV.REVENTA) || MS.prArea === FV.REVENTA;   // v0.69.1: Reventa solo si tiene productos
  const areasPr = FV.AREAS.filter(a => a !== FV.REVENTA || conRev);
  const areas = areasPr.filter(a => MS.prArea === 'todas' || a === MS.prArea);
  const sinObj = FV.AREAS.filter(a => cfg.margenObjetivo[a] === null);
  const bloque = a => {
    const xs = filas.filter(f => f.area === a).sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));
    const m = cfg.margenObjetivo[a];
    return `<div class="fin-pr-area" data-pr-area="${a}"><h3 class="fin-dtit">${FV.NOMBRE_AREA[a]} ${m === null ? '<span class="chip c-amarillo chip-chico">Sin margen objetivo</span>' : `<span class="ayuda">margen objetivo <b>${pctM(m)}</b> = recargo ${pctF(FMG.margenARecargo(m / 100))} sobre el costo</span>`}</h3>
      ${m === null ? `<p class="ayuda">Define el margen objetivo de ${FV.NOMBRE_AREA[a]} en <a href="#finanzas/margenes/ajustes">Ajustes</a> para ver el precio sugerido.</p>`
        : xs.length ? xs.map(f => filaPrecio(f, cfg, H)).join('') : '<p class="ayuda">Sin productos con costo vendidos en el período.</p>'}</div>`;
  };
  return `<section class="tarjeta" aria-labelledby="t-m-pr">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-pr">Precio sugerido ${H.info('Precio sugerido', 'Precio neto sugerido = costo directo de hoy ÷ (1 − margen objetivo del área − costos de venta %). Así, después de la comisión (caja) o el despacho (B2B), el margen de contribución queda justo en el objetivo.\nCon IVA (caja) = neto × 1,19, redondeado hacia arriba a $10, $50 o $100 (se elige en Ajustes).\nSe compara con el precio actual: el neto promedio del período (venta neta ÷ unidades) y, en la caja, el precio de lista del catálogo (con IVA). Diferencia = (actual − sugerido) ÷ sugerido. Bajo: más de 5 % por debajo. OK: ±5 %. Sobre: más de 5 % por encima.\nMargen ↔ recargo: recargo = margen ÷ (1 − margen); margen = recargo ÷ (1 + recargo).')}</h2></div>
    ${selectorPeriodo(H)}
    <p class="ok-texto" id="m-msg" role="status">${H.esc(MS.msg)}</p><p class="error" id="m-err" role="alert">${H.esc(MS.err)}</p>
    ${avisoComision(H)}
    <p class="ayuda" id="m-pr-k">Costos de venta usados: caja <b>${pctM(k.kCaja * 100, 2)}</b> del precio neto ${H.info('Costos de venta de la caja', 'Comisión de tarjeta del período como % de la venta neta de la caja: 1,19 × (parte pagada con débito × comisión débito + crédito × comisión crédito + otros × comisión otros). Si no hay ventas de la caja en el período, se usa la mezcla configurada en Ajustes.')} · B2B <b>${pctM(k.kB2b * 100, 2)}</b> ${H.info('Costos de venta de B2B', 'Despacho como % de la venta neta B2B: el % configurado, o (si es $ por orden) el despacho del período ÷ la venta neta B2B.')} · redondeo de la caja a $${nf(cfg.redondeo)}</p>
    ${sinObj.length === FV.AREAS.length ? `<p class="aviso" id="m-pr-sinobj">Todavía no hay margen objetivo para ningún área. Defínelo en <a href="#finanzas/margenes/ajustes">Ajustes</a> (la etapa de Metas lo va a calcular con los fijos de cada área).</p>` : ''}
    <div class="chips" role="group" aria-label="Filtrar por área">${['todas', ...areasPr].map(a => `<button type="button" class="chip-filtro" data-pr-filtro="${a}" aria-pressed="${MS.prArea === a}">${a === 'todas' ? 'Todas' : FV.NOMBRE_AREA[a]}</button>`).join('')}</div>
    <div id="m-pr-lista">${areas.map(bloque).join('')}</div>
  </section>`;
}
function filaPrecio(f, cfg, H) {
  const por = f.lectura === 'kg' ? ' / kg' : '';
  const c = f.canales.caja, b = f.canales.b2b;
  const caja = c ? `<div class="fin-pr-canal"><h4>Caja</h4>
      ${c.sugerido ? `<div><span>Sugerido</span><b>${pesosM(c.sugerido.conIvaRedondeado)}${por}</b><span class="ayuda">con IVA · neto ${pesosM(c.sugerido.neto)}</span></div>` : '<div><span>Sugerido</span><span class="ayuda">No se puede: margen + costos de venta llegan a 100 %</span></div>'}
      <div><span>Actual (neto prom.)</span><b>${c.actualNeto === null ? '—' : pesosM(c.actualNeto) + por}</b>${badgeDif(c.vsProm)}</div>
      ${c.lista ? `<div><span>Lista de la caja</span><b>${pesosM(c.lista)}${por}</b><span class="ayuda">con IVA</span>${badgeDif(c.vsLista)}</div>` : ''}</div>` : '';
  const bb = b ? `<div class="fin-pr-canal"><h4>B2B</h4>
      ${b.sugerido ? `<div><span>Sugerido</span><b>${pesosM(b.sugerido.neto)}${por}</b><span class="ayuda">neto</span></div>` : '<div><span>Sugerido</span><span class="ayuda">No se puede: margen + costos de venta llegan a 100 %</span></div>'}
      <div><span>Actual (neto prom.)</span><b>${b.actualNeto === null ? '—' : pesosM(b.actualNeto) + por}</b>${badgeDif(b.vsProm)}</div></div>` : '';
  return `<div class="fin-pr-fila" data-pr="${H.esc(f.clave)}"><div class="fin-pr-prod"><b>${H.esc(f.nombre)}</b>${f.tipo === 'reventa' ? ' <span class="chip c-gris chip-chico">Reventa</span>' : ''}<span class="ayuda">Costo directo hoy: ${f.costo === null ? '—' : pesosM(f.costo) + por}</span></div>${caja}${bb}</div>`;
}
function conectarPrecios(el, H) {
  el.querySelectorAll('[data-pr-filtro]').forEach(b => b.addEventListener('click', () => { MS.prArea = b.dataset.prFiltro; MS.msg = ''; dibujarMargenes(el, 'precios', H); }));
}

// ── Ajustes de márgenes (costos_config/finanzas → margenes) ──
function htmlAjustesM(H) {
  const c = cfgM(), raw = (MS.costos && MS.costos.config) || {};
  const medios = FMG.sumarMedios(...((MS.datos && MS.datos.porMes) || []).map(m => m.medios));
  const todos = {}; Object.values(medios).forEach(x => Object.entries(x).forEach(([k, v]) => { todos[k] = (todos[k] || 0) + v; }));
  const tc = FMG.tasaComision(todos, c);
  const val = v => (v === null || v === undefined ? '' : H.esc(String(v)));
  const campo = (id, et, v, ayuda, extra = '') => `<div class="campo"><label for="${id}">${et}${ayuda ? ' ' + ayuda : ''}</label><input id="${id}" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" step="any" value="${val(v)}" ${extra}></div>`;
  const hist = (Array.isArray(raw.historialMargenes) ? raw.historialMargenes : []).slice(-5).reverse();
  const falta = !FMG.comisionConfigurada(c);
  return `<section class="tarjeta" aria-labelledby="t-m-aj">
    <div class="titulo-fila fin-titulo"><h2 id="t-m-aj">Ajustes de Finanzas: márgenes ${H.info('Ajustes de márgenes', 'Lo que se usa para el margen de contribución y el precio sugerido. Se guarda en Finanzas (fen-gastos, solo administración) y cada cambio queda en el historial con quién y cuándo.')}</h2></div>
    <p class="ok-texto" id="m-aj-msg" role="status">${H.esc(MS.ajMsg)}</p>
    <form id="m-aj" class="fin-majustes" novalidate>
      <fieldset><legend>Comisión de tarjeta, por medio de pago ${falta ? '<span class="chip c-amarillo chip-chico" id="m-aj-falta">Falta configurar</span>' : '<span class="chip c-verde chip-chico">Configurada</span>'} ${H.info('Comisión de tarjeta', 'El % que cobra la empresa de tarjetas sobre lo pagado (con IVA), sin el IVA de la comisión (ese IVA es crédito fiscal). Míralo en la liquidación o la factura de la empresa de pagos.\nOtros: transferencias, apps de pago o cualquier medio que no sea efectivo, débito ni crédito (si no cobran, 0).\nMientras no se configure se usa 0 % y Márgenes avisa.')}</legend>
        <div class="fin-maj-campos">${FMG.MEDIOS.map(k => campo(`m-aj-c-${k}`, `${FMG.NOMBRE_MEDIO[k]} (%)`, c.comision[k], '', 'max="20"')).join('')}</div></fieldset>
      <fieldset><legend>Cómo se paga en la caja ${H.info('Medios de pago de la caja', 'La comisión se reparte según cuánto se pagó con cada medio. Se toma de los resúmenes de cierre de la caja (traen el total por medio de pago).\nLa mezcla de abajo se usa solo si en un mes no hay ese dato (por ejemplo, un mes guardado antes de esta versión: "Volver a leer" lo completa).')}</legend>
        <p class="ayuda" id="m-aj-mix">${tc.fuente === 'caja' ? `En el período, según los cierres: efectivo ${pctF(tc.partes.efectivo)}, débito ${pctF(tc.partes.debito)}, crédito ${pctF(tc.partes.credito)}, otros ${pctF(tc.partes.otros)}.<span class="fin-maj-tasa" id="m-aj-tasa">Comisión estimada: <b>${pctF(tc.tasa)}</b> de lo pagado</span>` : 'En el período no hay totales por medio de pago en los cierres.'}</p>
        <div class="fin-maj-campos">${FMG.MEDIOS.map(k => campo(`m-aj-m-${k}`, `${FMG.NOMBRE_MEDIO[k]} (% venta)`, c.mixCaja[k], '', 'max="100"')).join('')}</div>
        <p class="ayuda">Mezcla de respaldo, <b>opcional</b>: se usa solo si en un mes falta el dato de los cierres (normalmente quedan vacías). El resto se toma como efectivo.</p></fieldset>
      <fieldset><legend>Despacho B2B ${H.info('Despacho B2B', 'Lo que cuesta llevar los pedidos B2B (combustible, flete), neto. Como % de la venta neta B2B, o como $ por orden (se reparte entre los productos de cada mes según su venta). Opcional: por defecto 0.')}</legend>
        <div class="fin-maj-campos"><div class="campo"><label for="m-aj-dm">Cómo</label><select id="m-aj-dm"><option value="pct" ${c.despacho.modo === 'pct' ? 'selected' : ''}>% de venta</option><option value="orden" ${c.despacho.modo === 'orden' ? 'selected' : ''}>$ por orden</option></select></div>
          ${campo('m-aj-dv', 'Valor', c.despacho.valor || '', '')}</div></fieldset>
      <fieldset><legend>Margen objetivo por área (MC % sobre el precio neto) ${H.info('Margen objetivo', 'El margen de contribución que cada área necesita sobre su precio neto: margen objetivo = (fijos del área + utilidad objetivo) ÷ ventas esperadas del área.\nPor ahora se escribe a mano; la etapa de Metas (F5) lo va a calcular con los fijos reales y el presupuesto.\nVacío: no se calcula precio sugerido para esa área.\nRecargo equivalente sobre el costo = margen ÷ (1 − margen). Ej.: 60 % de margen = 150 % de recargo.')}</legend>
        <div class="fin-maj-campos">${FV.AREAS.map(a => `<div class="campo"><label for="m-aj-o-${a}">${FV.NOMBRE_AREA[a]} (%)</label><input id="m-aj-o-${a}" type="text" inputmode="decimal" data-decimal autocomplete="off" min="0" max="95" step="any" value="${val(c.margenObjetivo[a])}" data-recargo="m-aj-r-${a}"><span class="ayuda" id="m-aj-r-${a}">${c.margenObjetivo[a] === null ? 'Sin definir' : `= recargo ${pctF(FMG.margenARecargo(c.margenObjetivo[a] / 100))}`}</span></div>`).join('')}</div></fieldset>
      <fieldset><legend>Redondeo del precio con IVA de la caja ${H.info('Redondeo', 'El precio sugerido con IVA de la caja se redondea hacia arriba a este múltiplo (para no quedar bajo el margen objetivo).')}</legend>
        <div class="chips">${FMG.REDONDEOS.map(r => `<label class="check fin-maj-red"><input type="radio" name="m-aj-red" value="${r}" ${c.redondeo === r ? 'checked' : ''}> $${r}</label>`).join('')}</div></fieldset>
      <p class="error" id="m-aj-err" role="alert"></p>
      <button type="submit" class="btn" id="m-aj-si">Guardar</button>
    </form>
    ${hist.length ? `<h3 class="fin-dtit">Últimos cambios</h3><ul class="fin-hist-lista" id="m-aj-hist">${hist.map(h => `<li><div><b>${fechaTxt(h.fecha)}</b> · ${H.esc(h.por || '')}</div><span class="ayuda">${H.esc(resumenAj(h.despues))}</span></li>`).join('')}</ul>` : ''}
  </section>`;
}
function resumenAj(x) {
  if (!x) return '';
  const c = FMG.configMargenes(x), p = v => (v === null ? '—' : String(v).replace('.', ',') + ' %');
  return `Comisión débito ${p(c.comision.debito)}, crédito ${p(c.comision.credito)}, otros ${p(c.comision.otros)} · despacho ${c.despacho.modo === 'pct' ? p(c.despacho.valor) : '$' + nf(c.despacho.valor) + ' por orden'} · margen objetivo ${FV.AREAS.map(a => `${FV.NOMBRE_AREA[a]} ${p(c.margenObjetivo[a])}`).join(', ')} · redondeo $${c.redondeo}`;
}
function conectarAjustesM(el, H) {
  el.querySelectorAll('[data-recargo]').forEach(i => i.addEventListener('input', () => {
    const x = Number(String(i.value).replace(',', '.')), o = $(i.dataset.recargo);
    o.textContent = i.value === '' ? 'Sin definir' : x >= 0 && x < 100 ? `= recargo ${pctF(FMG.margenARecargo(x / 100))}` : 'Entre 0 y 95';
  }));
  const f = $('m-aj');
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('m-aj-err'), b = $('m-aj-si'); err.textContent = '';
    const v = id => FC.casilla($(id));   // v0.112.0: las casillas de número, como número
    const datos = { comision: Object.fromEntries(FMG.MEDIOS.map(k => [k, v(`m-aj-c-${k}`)])), mixCaja: Object.fromEntries(FMG.MEDIOS.map(k => [k, v(`m-aj-m-${k}`)])),
      despacho: { modo: v('m-aj-dm'), valor: v('m-aj-dv') }, margenObjetivo: Object.fromEntries(FV.AREAS.map(a => [a, v(`m-aj-o-${a}`)])),
      redondeo: (f.querySelector('input[name="m-aj-red"]:checked') || {}).value };
    try { FMG.validarConfig(datos); } catch (e) { err.textContent = e.message; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }   // v0.112.0: el aviso a la vista
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await F.guardarAjustesMargenes(datos);
      MS.costos = await F.leerProductos();
      H.registrar('Finanzas: cambió los ajustes de márgenes', resumenAj(FMG.validarConfig(datos)));
      MS.ajMsg = 'Ajustes guardados.'; dibujarMargenes(el, 'ajustes', H); MS.ajMsg = '';
    } catch (e) { err.textContent = error(e, H); b.disabled = false; b.textContent = 'Guardar'; }
  });
}
