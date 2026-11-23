// ═══════════════════════════════════════════════
//  Sistema Fën — pantalla Gastos (nuevo, desde cero)  v0.90.0 · Etapa 1: base y carga
//  Rutas: #gastos (Bandeja) · #gastos/cargas (lo que se subió). Cualquier otra ruta de Gastos (las del Gastos anterior) lleva a #gastos.
//  Etapa 1: subir las compras del SII, la cartola de BancoEstado (cuenta corriente y chequera) y el reporte de liberaciones de
//  Mercado Pago; ver los dos lados de la Bandeja (documentos y movimientos) y hasta dónde llega cada cuenta. Unir cada
//  documento con su pago llega en la Etapa 2.
//  La cartola de BancoEstado sigue pasando sus abonos a Ventas B2B → Conciliación, igual que antes.
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, pesos, diaTexto, cargarXLSX, B2b, Cartola }
// ═══════════════════════════════════════════════
import * as GN from './gn-modelo.js?v=0.138.0';
import * as GB from './gn-bandeja.js?v=0.138.0';
import * as CP from './cartolas-periodo.js?v=0.138.0';   // v0.127.2: cartolas por período
import * as AR from './areas.js?v=0.138.0';
import * as Sii from './sii.js?v=0.138.0';
import * as MP from './mercadopago.js?v=0.138.0';
import * as GI from './gn-items.js?v=0.138.0';   // v0.102.0: catálogo de ítems
import * as GF from './gn-finanzas.js?v=0.138.0';
import * as PC from './plan-cuentas.js?v=0.138.0';
import * as FR from './finanzas-resultados.js?v=0.138.0';
import * as TR from './trabajadores.js?v=0.138.0';   // v0.104.0: ficha del trabajador y provisión
import * as GT from './tributario.js?v=0.138.0';   // v0.108.0: gestión y tributario

const st = { medio: '', qMov: '', vista: (() => { try { return localStorage.getItem('fen_gn_vista') || 'recientes'; } catch (e) { return 'recientes'; } })(), D: null, B: null, err: '', msg: '', subiendo: false, cuenta: '', cargando: false, ocupado: false, sel: { d: [], m: [], primero: '' }, carga: '', verConciliado: false, mesD: '', mesM: '', qListos: '', abrirListos: false };   // v0.125.1: qListos = buscador de Listos   // v0.124.4: mesD / mesM = filtro por mes de cada lado ('' = todos)   // v0.105.0: carga = conciliar una cartola
const $ = id => document.getElementById(id);
const fsGN = () => import('./gn-fs.js?v=0.138.0');
const INICIO = () => (window.FEN_SIS && window.FEN_SIS.INICIO) || '2026-10-01';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = f => `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]} de ${f.slice(0, 4)}`;
export const olvidar = () => { st.D = null; };
// v0.125.1 · Al salir de Gastos se olvida la cartola que se estaba conciliando y "Lo conciliado": al volver, la Bandeja abre en toda la Bandeja y en lo pendiente
window.addEventListener('hashchange', () => { if ((location.hash || '').replace('#', '').split('/')[0] !== 'gastos') { st.carga = ''; st.verConciliado = false; } });

const TABS = [['bandeja', '', 'Bandeja'], ['proveedores', 'proveedores', 'Proveedores'], ['equipo', 'equipo', 'Equipo'], ['catalogo', 'catalogo', 'Ítems'], ['repartos', 'repartos', 'Repartos'], ['porpagar', 'porpagar', 'Por pagar'], ['compromisos', 'compromisos', 'Compromisos'], ['cargas', 'cargas', 'Archivos subidos']];   // v0.96.0 · v0.102.0: Ítems
const hashDe = t => '#gastos' + (t === 'bandeja' ? '' : '/' + t);
const TXT_SUBIR = 'Sirven:\n• Las compras del SII: el XML de documentos recibidos, el Registro de Compras (.csv) o los Documentos recibidos (.xls).\n• La cartola de BancoEstado (.xlsx), histórica o en línea, de la cuenta corriente o de la chequera. Sus abonos siguen pasando a Ventas a empresas → Conciliación.\n• El reporte de liberaciones de Mercado Pago (.csv).\n• Las liquidaciones de sueldo del contador (PDF, una por trabajador): entran por el líquido + anticipos.\n• El F29 (formulario completo o certificado, PDF): su pago repartido por impuesto.\n• Las boletas de luz (CGE) y agua (ESSBIO) en PDF: entran con su N° de cliente; el saldo anterior es de las boletas anteriores (súbalas también).\nSubir el mismo archivo dos veces no repite nada: cada documento se reconoce por RUT, tipo y folio, y cada movimiento por su línea exacta. Si la misma salida ya llegó en otra cartola (por ejemplo la en línea y después la histórica), no se guarda otra vez.\nLas guías de despacho no entran (no son compras: cuenta su factura).';
const TXT_BANDEJA = 'A la izquierda, lo que se debe: los documentos de compra desde el inicio del sistema. A la derecha, lo que salió: los movimientos de cada cuenta.\nEn la Etapa 2 la Bandeja propone qué documento va con qué movimiento, y se concilia con un toque.\nLos traspasos entre cuentas propias (por ejemplo, el retiro de Mercado Pago a BancoEstado) no son gasto: se muestran aparte.';
const TXT_ANTERIOR = 'Facturas anteriores al inicio del sistema (hasta un año antes). Si se pagan desde el inicio en adelante, son "deuda anterior": su pago no cuenta como gasto del mes nuevo.\n"Buscar su documento" (la lupa, en un movimiento) también las busca. Las que tienen el mismo monto que un cargo aparecen solas en Para conciliar.';
const TXT_ANTIGUA = 'VENTAS y B2C (sin local) ya no se usan en el Gastos nuevo: el costo de atender clientes en tienda va al local que corresponde, B2C-BA (Tienda Barros Arana) o B2C-AI (Sala de ventas Ainavillo). Así se ve el margen de cada tienda.\nCambie la clasificación de estos documentos; si el proveedor lo recuerda, cámbielo también en su ficha (Proveedores).';
const TXT_REPARTOS = 'Un reparto es una forma fija de dividir un gasto entre áreas, con nombre propio (por ejemplo, Ainavillo común). Se define una vez y se elige al clasificar o en la ficha del proveedor.\nSi un reparto cambia, rige para lo que viene: lo ya pagado queda como estaba, y se ofrece aplicarlo también a lo pagado del mes abierto. Los meses cerrados no cambian.';
const TXT_FICHA = 'Todo lo que el sistema sabe de este proveedor: su clasificación (y si recuerda ítem y áreas o solo el ítem), sus servicios por N° de cliente, los productos que recuerda y cómo aparece en el banco. Lo que cambie aquí rige para sus facturas sin pagar; las pagadas quedan como estaban.';
const TXT_ELEGIR = 'Marque una o varias facturas y aquí aparecen los cargos que pueden ser su pago, para la suma de lo que falta pagar (al revés también: marque un cargo y aparecen sus posibles facturas). Primero los que calzan, después los de las fechas probables y los del proveedor.\nSe puede unir una factura con varios cargos (un pago en partes) o varias facturas con un cargo. Varios con varios no: únalos en dos pasos.\nLos pares descartados con "No es este" aparecen al final, por si sí era.';
const TXT_CARGOS_ANT = 'Cargos de los 20 días antes del inicio. Se unen con facturas desde el inicio (por ejemplo, un abono de septiembre de una factura de octubre) o con la deuda anterior (una factura de septiembre pagada en septiembre): eso solo deja los dos cerrados. No cuentan como salida de plata del mes nuevo.\nUna deuda anterior no se clasifica: no entra al estado de resultados (salvo un pago que se reparte en varios meses, como una patente semestral).';
const TXT_COMPROMISOS = 'Un compromiso es un pago fijo de cada mes que no trae documento (por ejemplo, un arriendo). El sistema crea el documento de cada mes cuando el mes empieza, con su día de pago, y la Bandeja lo une con la transferencia como cualquier factura.\nSu ítem y su reparto quedan en la ficha de a quién se le paga: sus meses llegan clasificados. Un cambio del monto o del día rige desde el próximo mes que se cree. Archivar deja de crear meses; lo ya creado sigue.';
const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TXT_COB_SII = '"Documentos hasta" es la fecha de la factura más reciente que está cargada. No asegura que estén todas: una factura puede llegar al SII días después.\nSu método: al bajar el XML, incluya siempre el último día de la descarga anterior, así se capta lo que llegó después (lo que ya estaba no se repite). A fin de mes, el RCV completa lo que falte.';
const TXT_SINBANCO = 'Para un gasto que no pasa por el banco ni trae factura: una compra en la feria o con boleta en papel pagada en efectivo (de la caja), o algo que usted pagó con su plata.\nNace pagado y clasificado. Lo pagado con su plata queda como deuda de la empresa con usted (Por pagar → "Cuenta con el dueño"); cuando la empresa se lo devuelva, marque esa transferencia "No es gasto → Devolución al dueño".\nSi el gasto tiene factura, no lo registre aquí: llega por el SII.';
const TXT_TARJETA = 'Cada compra anotada es un movimiento de la tarjeta (cuenta "Tarjeta de crédito"): se une con su factura en la Bandeja como cualquier cargo.\nEl pago de la tarjeta desde la cuenta corriente no es gasto: márquelo "No es gasto → pago de la tarjeta", así nada se cuenta dos veces.\nAnotar la misma compra dos veces no la repite.';
// v0.124.5 · La planilla propia para la tabla de amortización (cuando el banco la entrega escaneada o en PDF)
const TXT_TABLA_CRED = '"Descargar formato de tabla" baja un Excel con dos hojas: Crédito (banco, N° de operación, capital otorgado, tasa, N° de cuotas) y Cuotas (N°, vencimiento, fecha de pago, capital, interés, interés por atraso, otros y total).\nLlénelo con la cartola o tabla del banco y arrástrelo al recuadro de subir. Se une al crédito con el mismo N° de operación o al cargado del Detalle Crédito (misma primera cuota). Las cuotas con capital e interés usan esos montos; las demás se estiman desde el saldo.\nLa comisión de la garantía estatal y los seguros van a Comisiones bancarias; el interés por atraso, a Multas e intereses; el capital no es gasto.';
const TXT_CREDITOS = 'Los créditos se cargan arrastrando el "Detalle Crédito" de BancoEstado (Excel). Cada cuota entra a la Bandeja el mes en que vence, para unirla con su cargo.\nCon el monto original y la tasa mensual, cada cuota se separa en interés (gasto financiero) y capital (no es gasto: es devolver el préstamo). Sin esos datos, la cuota va completa.';
const TXT_PORPAGAR = 'Lo que se debe y todavía no tiene su pago: facturas y boletas, sueldos, Previred, F29, arriendos y cuotas, por su fecha de vencimiento (o la del documento si no trae).\nLa deuda anterior al inicio va aparte. Para registrar un pago, use la Bandeja.';
const TXT_INICIO = 'Gastos parte desde cero. Lo anterior a esta fecha no entra, salvo las facturas, que quedan aparte como deuda anterior. El Gastos anterior no se borró: sus datos siguen guardados en la base.';

function cab(H, tab) {
  return `<div class="cabecera"><div><h1 id="t-gastos">Gastos</h1><p>Lo que se debe y lo que salió, desde el ${H.esc(fechaLarga(INICIO()))} ${H.info('Desde cero', TXT_INICIO)}</p></div>
    <button type="button" class="btn bo-btn" data-gn-boleta>+ Boleta</button></div>
    <nav class="pestanas" role="tablist" aria-label="Pestañas de Gastos">${TABS.map(([k, , t]) => `<a role="tab" href="${hashDe(k)}" aria-selected="${k === tab}">${t}</a>`).join('')}</nav>
    <div class="gn-drop${st.subiendo ? ' gn-drop-ocupado' : ''}" data-gn-drop>
      <label class="gn-drop-zona" for="gn-archivo">
        <span class="gn-drop-ic">${H.icono('subir', 26)}</span>
        <span class="gn-drop-txt"><b>${st.subiendo ? H.esc(st.subiendo === true ? 'Leyendo el archivo…' : st.subiendo) : '<span class="gn-pc">Arrastre aquí los archivos</span><span class="gn-cel">Toque para elegir los archivos</span>'}</b>
          <small>${st.subiendo ? 'No cierre esta pestaña' : '<span class="gn-pc">o haga clic para elegirlos · puede soltar varios a la vez</span><span class="gn-cel">Puede elegir varios a la vez</span>'}</small></span>
        <span class="gn-drop-tipos"><span>SII</span><span>BancoEstado</span><span>Mercado Pago</span><span>Luz y agua</span><span>Sueldos y F29</span></span>
      </label>
      ${H.info('Subir archivo', TXT_SUBIR)}
      <input type="file" id="gn-archivo" class="sr" multiple accept=".xml,.csv,.txt,.xls,.xlsx,.html,.pdf" ${st.subiendo ? 'disabled' : ''}>
    </div>
    <div id="gn-msg" role="status" aria-live="polite">${st.err ? `<p class="error" role="alert">${st.err}</p>` : ''}${st.msg ? `<div class="aviso gn-aviso">${st.msg}</div>` : ''}</div>`;
}

export async function pintar(el, sub, H) {
  const tab = ['cargas', 'proveedores', 'equipo', 'repartos', 'compromisos', 'porpagar', 'catalogo'].includes(sub) ? sub : 'bandeja';
  if (sub && tab === 'bandeja') { location.replace('#gastos'); return; }
  if (!st.D) {
    el.innerHTML = cab(H, tab) + '<section class="tarjeta"><div class="vacio" style="border:0">Cargando Gastos…</div></section>';
    conectar(el, H);
    try { st.D = await (await fsGN()).leer(); }
    catch (e) { el.innerHTML = cab(H, tab) + `<section class="tarjeta"><p class="error" role="alert">${H.esc(e.message || H.mensajeError(e))}</p>${e.code === 'sin_base' ? '<p class="ayuda">La conexión con la base de Gastos se hace en Configuración → Conexiones.</p>' : ''}</section>`; conectar(el, H); return; }
    if (!enGastos()) return;
  }
  const clave = decodeURIComponent((location.hash || '').split('/')[2] || '');
  // v0.107.0 · Un trabajador tiene su ficha en Equipo (un enlace antiguo a Proveedores lo lleva ahí)
  if (tab === 'proveedores' && clave && TR.equipo(st.D).some(x => x.clave === clave)) { location.replace('#gastos/equipo/' + encodeURIComponent(clave)); return; }
  const lugar = tab + '/' + clave; if (st.lugar && st.lugar !== lugar) { st.msg = ''; st.err = ''; } st.lugar = lugar;   // el aviso es de la pantalla donde se hizo
  el.innerHTML = cab(H, tab) + (tab === 'cargas' ? cargasHtml(H) : tab === 'repartos' ? repartosHtml(H) : tab === 'compromisos' ? compromisosHtml(H) : tab === 'porpagar' ? porPagarHtml(H) : tab === 'catalogo' ? itemsHtml(H) : tab === 'proveedores' ? (clave ? fichaHtml(H, clave) : proveedoresHtml(H)) : tab === 'equipo' ? (clave ? fichaHtml(H, clave, { equipo: true }) : equipoHtml(H)) : bandejaHtml(H));
  conectar(el, H);
  if (tab === 'bandeja') marcarEsperas(el, H).catch(() => {});
}
const enGastos = () => (location.hash || '').replace('#', '').split('/')[0] === 'gastos';
const subActual = () => ((location.hash || '').split('/')[1] || '');

// ── Bandeja (v0.91.0 · Etapa 2: une cada documento con su pago) ──
const TXT_PARES = 'El documento y el movimiento del mismo monto (hasta $5 de diferencia), con la fecha del pago entre 20 días antes y 60 días después del documento.\nEn verde, los seguros: el RUT o el nombre del proveedor está en la glosa del banco, la glosa ya se confirmó antes con ese proveedor ("glosa conocida"), o son varios documentos del mismo proveedor que suman justo el pago. En amarillo, los que calzan solo por el monto: revíselos antes de conciliar.\nAl conciliar, el proveedor aprende cómo aparece en el banco. Si se aprendió mal, "Olvidar esta glosa". Deshacer el pago también la olvida.\nConciliar crea el pago. Se puede deshacer en "Listos".';
const TXT_CLASIF = 'Un documento está listo cuando tiene su pago y su clasificación (ítem y área). Aquí quedan los que ya tienen su pago y todavía no su ítem.\nUna factura con cosas distintas se separa por líneas (o por montos, si no trae detalle). Lo que elija queda recordado en el proveedor, también por producto: sus próximas facturas llegan clasificadas.\n"Sugerido" viene del Gastos anterior: es solo una propuesta; nada se copia hasta que usted la usa. Antes de usarla, mire el detalle de la factura.';
const TXT_SINPAGO = 'Lo que se debe y todavía no tiene su pago. Si se pagó por el banco y el cargo ya llegó, use "¿Cómo se pagó?" → Con cargos del banco. Si se pagó en efectivo o con su plata, ahí mismo.\n"Esto no va": un documento repetido, que no es de la empresa o que no es una compra. No se borra.';
// v0.125.1 · Cómo salió cada cargo, leído de la glosa (pedido por Emmanuel el 10 nov: él hace las transferencias y logística paga con la tarjeta)
const MEDIOS = { transf: 'Transferencia', tarjeta: 'Tarjeta', mp: 'Mercado Pago', cuenta: 'Pago de cuenta', otro: 'Otro' };
export function medioDe(m) {
  const g = String((m && m.glosa) || '').toUpperCase().trim(), c = m && m.cuenta;
  if (c === 'mp' || /^PAGO CON SALDO MERCADO PAGO|^COMPRA MERCADO LIBRE/.test(g)) return 'mp';
  if (c === 'tc' || /^COMPRA\b/.test(g)) return 'tarjeta';
  if (/^(TEF|TRANSF|TRANSFERENCIA|TRASPASO)\b/.test(g)) return 'transf';
  if (/^PAGO\b/.test(g)) return 'cuenta';
  return 'otro';
}
const TXT_SINDOC = 'Lo que salió de las cuentas y todavía no tiene su documento. En cada cargo:\n• "Buscar su documento" (la lupa): lo une con una factura o con una boleta ya anotada. Si la boleta ya está anotada, nunca la anote de nuevo.\n• "Tengo la boleta": la boleta no estaba anotada; se anota con su foto y queda unida a este cargo.\n• "Sin documento": lo que no tiene boleta posible (comisión, interés, impuesto del banco, cuota).\n• "No es gasto": traspaso entre sus cuentas, retiro suyo o pago de la tarjeta de crédito.\n• "Pago a cuenta": lo que se pagó antes de su documento (un anticipo, un abono): queda a favor de ese proveedor o trabajador.\nEl sistema aprende cómo aparece cada comercio en la cartola (por ejemplo "MERPAGO*JAVI" = Punto Frut) y la próxima vez propone el par solo.';
const kPar = p => p.movId + '|' + p.docIds.join(',');
const POR_TXT = { rut: 'mismo monto y RUT en la glosa', glosa: 'mismo monto y glosa conocida', nombre: 'mismo monto y nombre en la glosa', monto: 'mismo monto', varios: 'varios documentos del mismo proveedor' };
function bandejaHtml(H) {
  const D = st.D, cob = GN.cobertura(D.movs, D.cargas);
  const B = st.B = GB.armar(D, { cuenta: st.cuenta });
  // v0.105.0 · Conciliar una cartola: la Bandeja muestra solo los movimientos de esa cartola (los documentos siguen todos, para unirlos)
  const kC = st.carga ? (D.cargas || []).find(k => k.id === st.carga) || null : null, enC = kC ? new Set(GB.movsDeCarga(kC, B.movs).map(m => m.id)) : null, deC = id => !enC || enC.has(id);
  let pares = B.pares.filter(p => deC(p.movId)), sinDoc = B.sinDoc.filter(m => deC(m.id)), noGasto = B.noGasto.filter(m => deC(m.id)), aCuentaV = B.aCuenta.filter(m => deC(m.id)), movsAnt = kC ? [] : B.movsAnteriores;
  const docDe = id => B.docs.find(d => d.id === id), movDe = id => B.movs.find(m => m.id === id);
  // v0.124.4 · Filtro por mes, independiente en cada lado (pedido por Emmanuel el 3 nov): documentos por su vencimiento (o su fecha),
  // movimientos por su fecha. Solo cambia lo que se ve; lo elegido para unir y los "posibles" no se filtran.
  const mesDoc = d => String(d.vence || d.fecha || '').slice(0, 7), mesMov = m => String(m.fecha || '').slice(0, 7);
  // v0.135.0 · Las boletas anotadas que esperan su pago van en su propio grupo (fuera de "Documentos sin pago"), salvo al conciliar una cartola
  const espB = kC ? [] : B.sinPago.filter(d => d.anotada), spBase = kC ? B.sinPago : B.sinPago.filter(d => !d.anotada);
  let sinPagoV = st.mesD ? spBase.filter(d => mesDoc(d) === st.mesD) : spBase;
  let sinDocV = st.mesM ? sinDoc.filter(m => mesMov(m) === st.mesM) : sinDoc;
  // v0.124.16 · Recientes y Atrasados (pedido por Emmanuel el 10 nov): con la cartola en línea subida a diario, lo de los últimos 7 días
  // se ve aparte y no se pierde entre lo antiguo. Recientes = movimientos (y documentos) con fecha de los últimos 7 días; lo demás, Atrasados.
  // Solo cambia lo que se ve: lo elegido para unir y los "posibles" no se filtran. Al conciliar una cartola no se usa.
  const lim = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const esRecM = m => String((m && m.fecha) || '') >= lim, esRecD = d => String(d.fecha || '') >= lim;
  const usaVista = !kC, enRec = usaVista && st.vista !== 'atrasados', verAtr = !enRec;
  const nRec = usaVista ? pares.filter(p => esRecM(movDe(p.movId))).length + sinDoc.filter(esRecM).length + B.sinPago.filter(esRecD).length : 0;
  const nTodo = pares.length + B.n.clasificar + B.n.sinPago + sinDoc.length, nAtr = usaVista ? nTodo - nRec : 0;
  if (usaVista) { const f = enRec ? (x => x) : (x => !x);
    pares = pares.filter(p => f(esRecM(movDe(p.movId)))); sinDoc = sinDoc.filter(m => f(esRecM(m))); sinDocV = sinDocV.filter(m => f(esRecM(m))); sinPagoV = sinPagoV.filter(d => f(esRecD(d))); }
  // v0.125.1 · Filtro por cómo salió (transferencia, tarjeta, Mercado Pago, pago de cuenta): solo lo que se ve
  const cuentaMedios = {}; sinDoc.forEach(m => { const k = medioDe(m); cuentaMedios[k] = (cuentaMedios[k] || 0) + 1; });
  if (st.medio) { sinDoc = sinDoc.filter(m => medioDe(m) === st.medio); sinDocV = sinDocV.filter(m => medioDe(m) === st.medio); pares = pares.filter(p => medioDe(movDe(p.movId)) === st.medio); }
  const filtroMedio = sinDoc.length || st.medio ? `<div class="gn-filtro gn-filtro-medio" role="group" aria-label="Cómo salió"><button type="button" class="chip ${st.medio ? 'c-gris' : 'c-verde'}" data-gn-medio="" aria-pressed="${!st.medio}">Todos</button>${Object.keys(MEDIOS).filter(k => cuentaMedios[k] || st.medio === k).map(k => `<button type="button" class="chip ${st.medio === k ? 'c-verde' : 'c-gris'}" data-gn-medio="${k}" aria-pressed="${st.medio === k}">${MEDIOS[k]} · ${cuentaMedios[k] || 0}</button>`).join('')}</div>` : '';
  // v0.124.17 · Buscador de cargos (pedido por Emmanuel el 10 nov): por nombre, folio o monto, en TODOS los movimientos subidos
  // (las dos pestañas, lo conciliado, lo que no es gasto), y dice en qué quedó cada uno.
  const qM = GN.norm(st.qMov || '');
  const txtMov = m => { const ds = (m.pagosM || []).map(p => docDe(p.docId)).filter(Boolean);
    return GN.norm([m.glosa, m.fecha, H.diaTexto(m.fecha), m.monto, Math.round(Number(m.monto) || 0).toLocaleString('es-CL'), GN.CUENTAS[m.cuenta], ...ds.flatMap(d => [nom(d), d.razon, d.rut, d.folio])].filter(Boolean).join(' ')); };
  const hallados = qM ? B.movs.filter(m => (!st.cuenta || m.cuenta === st.cuenta) && qM.split(/\s+/).every(w => txtMov(m).includes(w))).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))) : [];
  const estadoMov = m => { const ds = (m.pagosM || []).map(p => docDe(p.docId)).filter(Boolean);
    if (m.estado === 'no_va') return '<span class="chip c-gris chip-chico">Descartado</span>';
    if (m.naturaleza) return `<span class="chip c-gris chip-chico">${H.esc(m.naturaleza === 'acuenta' ? 'Pago a cuenta' : GB.NO_GASTO[m.naturaleza] || 'No es gasto')}</span>`;
    if (ds.length) return `<span class="chip c-verde chip-chico">Conciliado</span> <span class="gn-sug">con ${ds.map(d => H.esc(nom(d)) + (d.folio ? ' N° ' + H.esc(d.folio) : '')).join(', ')}${m.libre > 0 ? ` · queda libre ${H.pesos(m.libre)}` : ''}</span>`;
    return `<span class="chip c-amarillo chip-chico">Sin documento${m.anterior ? ' · anterior al inicio' : String(m.fecha) < lim ? ' · en Atrasados' : ' · en Recientes'}</span>`; };
  const buscaMovHtml = `<div class="gn-listos-buscar gn-buscar-mov"><label class="ayuda" for="gn-qmov">Buscar un cargo (nombre, folio o monto)</label><input id="gn-qmov" type="search" data-gn-qmov value="${H.esc(st.qMov || '')}" placeholder="Ej.: CGE, 26688022 o 171.000" autocomplete="off"></div>`;
  const resMovHtml = () => qM ? `<div class="gn-lado-t">Cargos con «${H.esc(st.qMov)}» · ${hallados.length}${hallados.length > 60 ? ' (se muestran 60)' : ''}</div>${hallados.length ? hallados.slice(0, 60).map(m => movFila(m, `<span class="gn-estado-mov">${estadoMov(m)}</span>${m.libre > 0 && m.estado !== 'no_va' && !m.naturaleza ? accMov(m) : ''}`, true)).join('') : '<div class="vacio">Ningún cargo con ese texto en las cartolas subidas. Si se pagó en efectivo, con otra cuenta o con la tarjeta personal, no está en las cartolas: anote la boleta con + Boleta (Efectivo o Mi plata).</div>'}` : '';
  const pestanas = usaVista ? `<div class="gn-filtro gn-vista" role="group" aria-label="Qué mirar"><button type="button" class="chip ${enRec ? 'c-verde' : 'c-gris'}" data-gn-vista="recientes" aria-pressed="${enRec}">Recientes · ${nRec}</button><button type="button" class="chip ${enRec ? 'c-gris' : 'c-verde'}" data-gn-vista="atrasados" aria-pressed="${!enRec}">Atrasados · ${nAtr}</button><span class="ayuda">${enRec ? 'Lo de los últimos 7 días. Si un cargo tiene factura, déjelo: se une solo al subir el SII.' : 'Lo de hace más de 7 días, y lo que falta clasificar.'}</span></div>` : '';
  const chipsMes = (lista, de, actual, attr, etq) => { const meses = [...new Set(lista.map(de).filter(Boolean))].sort().reverse(); if (meses.length < 2 && !actual) return '';
    if (actual && !meses.includes(actual)) meses.unshift(actual);
    return `<div class="gn-filtro gn-filtro-mes" role="group" aria-label="${etq}"><button type="button" class="chip chip-chico ${actual ? 'c-gris' : 'c-verde'}" ${attr}="" aria-pressed="${!actual}">Todos</button>${meses.map(m => `<button type="button" class="chip chip-chico ${actual === m ? 'c-verde' : 'c-gris'}" ${attr}="${m}" aria-pressed="${actual === m}">${H.esc(GF.mesCorto(m))}</button>`).join('')}</div>`; };
  const cuantos = (v, t) => (v.length === t.length ? `${t.length}` : `${v.length} de ${t.length}`);
  // v0.126.3 · Etapa 5 (pedido por Emmanuel el 11 nov, la página se congelaba): en Atrasados, sin filtro de mes, cada lado se agrupa por
  // mes; solo el más nuevo (o el que tiene algo elegido, o uno que usted abrió) viene dibujado. Los demás se dibujan al abrirlos.
  st.lazy = {};
  const gruposMes = (tipo, l, de, fila, montoDe) => {
    const G = new Map(); l.forEach(x => { const k = de(x) || ''; if (!G.has(k)) G.set(k, []); G.get(k).push(x); });
    const gs = [...G.entries()].sort((a, b) => b[0].localeCompare(a[0])); if (gs.length < 2) return l.map(fila).join('');
    const sel = tipo === 'd' ? selD : selM, ab = st.mesAbierto || (st.mesAbierto = {});
    return gs.map(([mes, xs], i) => { const k = tipo + ':' + mes, abierto = ab[k] !== undefined ? ab[k] : (i === 0 || xs.some(x => sel.has(x.id)));
      const tit = mes ? `${MESES_TXT[Number(mes.slice(5, 7)) - 1] || ''} ${mes.slice(0, 4)}` : 'Sin fecha';
      if (!abierto) st.lazy[k] = () => xs.map(fila).join('');
      return `<details class="gn-mesgrp" data-gn-mesgrp="${H.esc(k)}" ${abierto ? 'open' : ''}><summary><b>${H.esc(tit)} · ${xs.length}</b><span class="gn-m">${H.pesos(xs.reduce((a, x) => a + montoDe(x), 0))}</span></summary><div class="gn-mesgrp-c">${abierto ? xs.map(fila).join('') : ''}</div></details>`; }).join(''); };
  const agrupar = (tipo, mesF) => verAtr && !kC && !mesF && !qM;
  const cuentas = [['', 'Todas'], ...cob.map(c => [c.cuenta, c.nombre])];
  // v0.99.0 · Las compras del SII: hasta qué fecha llegan los documentos cargados y el último archivo subido
  const fsii = (D.docs || []).filter(d => d.origen === 'sii' && !d.anterior).map(d => d.fecha).sort(), ksii = (D.cargas || []).find(k => k.tipo === 'sii');
  const sii = fsii.length ? `<div class="gn-cob-c"><b>Compras del SII ${H.info('Compras del SII', TXT_COB_SII)}</b><span>documentos hasta el ${H.esc(H.diaTexto(fsii[fsii.length - 1]))}${ksii ? ` · último archivo ${H.esc(String(ksii.en || '').slice(0, 10) ? H.diaTexto(String(ksii.en).slice(0, 10)) : '')}${ksii.formato === 'registro' ? ' (RCV)' : ksii.formato ? ' (XML)' : ''}` : ''}</span></div>` : '';
  const nombreDoc = d => H.esc(d.razon || d.rut || 'Sin nombre');
  // v0.96.0 · De dónde vino: XML (trae el detalle) o RCV (Registro de Compras: sin detalle; subir su XML lo completa)
  const origenDoc = d => (d.origen === 'bte' && d.bte ? ` · honorarios ${H.pesos(d.bte.bruto)} − retención ${H.pesos(d.bte.retencion)} (va en el F29)`
    : d.origen === 'previred' && d.previred ? ` · ${d.previred.formato === 'comprobante' ? 'comprobante' : d.previred.formato === 'certificado' ? 'certificado' : 'CSV'} · ${d.previred.trabajadores.length} trabajadores${d.previred.recargos ? ` · multas e intereses ${H.pesos(d.previred.recargos)}` : ''}`
    : d.origen === 'credito' ? (d.clasif && d.clasif.separado ? '' : ' · sin separar interés y capital') :
    d.origen === 'liquidacion' && d.liquidacion ? ` · líquido ${H.pesos(d.liquidacion.liquido)}${d.liquidacion.anticipos ? ` + anticipos ${H.pesos(d.liquidacion.anticipos)}` : ''}`
    : d.origen === 'f29' ? (d.f29 && d.f29.formato === 'certificado' ? ' · certificado (solo el total)' : ' · formulario completo')
    : d.origen === 'boleta' ? ' · PDF' + (d.saldoAnterior ? ` · trae saldo anterior ${H.pesos(d.saldoAnterior)}` : '') + (d.corte ? ` · <span class="gn-corte">corte ${d.corte.desde ? 'desde el ' + H.esc(H.diaTexto(d.corte.desde)) : 'en trámite'}</span>` : '') : d.origen !== 'sii' ? '' : (d.detalle || []).length ? ' · XML' : d.formato === 'registro' ? ' · RCV, sin detalle' : ' · sin detalle');
  const lineaDoc = d => `${H.esc(d.tipoTexto)}${d.folio && d.origen !== 'credito' ? ' N° ' + H.esc(d.folio) : ''} · ${H.esc(H.diaTexto(d.fecha))}${d.vence && d.vence !== d.fecha ? ` · vence ${H.esc(H.diaTexto(d.vence))}` : ''}${d.nc && (d.referencias || []).length ? ` · corrige la N° ${H.esc(d.referencias.map(r => r.folio).join(', '))}` : ''}${d.cliente ? ` · cliente ${H.esc(d.cliente)}${d.direccion ? ' · ' + H.esc(d.direccion) : ''}` : d.origen === 'compromiso' && (d.rol || d.direccion) ? `${d.rol ? ' · rol ' + H.esc(d.rol) : ''}${d.direccion ? ' · ' + H.esc(d.direccion) : ''}` : ''}${d.ajuste ? ` · ajustado de ${H.pesos(d.ajuste.original)}` : ''}${d.periodo ? ` · período ${H.esc(H.diaTexto(d.periodo.desde))} al ${H.esc(H.diaTexto(d.periodo.hasta))}` : ''}${d.anterior ? ' · deuda anterior' : ''}${origenDoc(d)}`;
  // v0.92.0 · La clasificación de cada documento a la vista (con su detalle), y sus botones, en la misma tarjeta donde esté
  const bt = (attr, txt, pri) => `<button type="button" class="${pri ? 'btn btn-chico' : 'btn-sec btn-chico'}" ${attr}>${txt}</button>`;
  const sugOk = d => d.sugerida && (d.sugerida.areas || []).length;
  // v0.92.3 · Verde con visto: lo que usted guardó (en el documento o en su proveedor). Rojo: lo que falta decidir (sugerido, sin clasificar, falta el área)
  const visto = '<svg class="gn-visto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const Icat = catI(), sinCuenta = c => (Icat && c ? [...new Set((c.partes || []).map(p => p.item))].filter(n => !GI.resolver(n, Icat).ok) : []);
  const revItem = d => { const l = sinCuenta(d.clasifEf); return l.length ? `<span class="gn-cl gn-cl-falta">Revisar ítem: ${H.esc(l.join(', '))} no está en el catálogo (Gastos → Ítems)</span>` : ''; };
  // v0.103.0 · Flete de compra: a qué compras se une (o que falta unirlo)
  const docPorId = Object.fromEntries((D.docs || []).map(x => [x.id, x])), esFl = d => d.estado !== 'no_va' && d.clasifEf && (d.clasifEf.partes || []).some(p => GN.norm(p.item) === GN.norm(GI.FLETE));
  const fleteTxt = d => { if (!esFl(d)) return ''; const l = ((d.flete && d.flete.docs) || []).map(i => docPorId[i]).filter(Boolean);
    return l.length ? `<span class="gn-cl">${visto}Flete de: ${H.esc(l.map(x => `${x.razon || x.rut} N° ${x.folio}`).join(', '))} (se suma a su costo)</span>` : '<span class="gn-cl gn-cl-falta">Flete por unir a su compra: mientras, no entra al costo</span>'; };
  // v0.104.0 · Un pago que sale de la provisión de los trabajadores (reemplazo de vacaciones o finiquito)
  const nombreTrab = k => ((D.provs || {})[k] || {}).razon || (D.docs || []).find(x => 'r_' + x.rutN === k && x.origen === 'liquidacion')?.razon || k;
  const puedeProv = d => d.estado !== 'no_va' && (d.origen === 'liquidacion' || (d.clasifEf && (d.clasifEf.partes || []).some(p => /FINIQUITO/.test(GN.norm(p.item)))));
  const provTxt = d => (TR.usaProvision(d) ? `<span class="gn-cl">${visto}Sale de la provisión: ${H.esc(TR.USOS[d.provision.uso].toLowerCase())} de ${H.esc(nombreTrab(d.provision.de))} (no es gasto del mes)</span>` : '');
  // v0.108.0 · Lo que el SII no acepta (por regularizar o no aceptado), a la vista en la tarjeta del documento
  const tribDoc = d => { const x = d.estado === 'no_va' ? null : GT.chipDoc(d, ((d.clasifEf || {}).partes || []).map(p => p.item), st.D.tributario || {}); return x ? ` <span class="chip ${x.situacion === 'regularizar' ? 'c-amarillo' : 'c-rojo'} chip-chico">${H.esc(GT.SITUACIONES[x.situacion])}</span>` : ''; };
  const clasTxt = d => (d.clasifEf ? `<span class="gn-cl">${visto}${H.esc(GB.textoPartes(d.clasifEf.partes))}${d.clasifEf.de === 'proveedor' ? ' <span class="gn-cl-de">(como siempre)</span>' : ''}${tribDoc(d)}</span>${revItem(d)}${fleteTxt(d)}${provTxt(d)}`
    : d.faltanFichas && d.faltanFichas.length ? `<span class="gn-cl gn-cl-falta">Falta el área de: ${H.esc(d.faltanFichas.join(', '))} (se toma de su ficha)</span>`
    : d.soloItem ? `<span class="gn-cl gn-cl-falta">${H.esc(d.soloItem)} · falta el área</span>`
    : sugOk(d) ? `<span class="gn-cl gn-cl-falta">Sugerido: ${H.esc(d.sugerida.item)} · ${H.esc(GB.textoReparto(d.sugerida.areas))}</span>` : '<span class="gn-cl gn-cl-falta">Sin clasificar</span>');
  const detHtml = d => ((d.detalle || []).length ? `<details class="gn-detalle"><summary>Ver detalle (${d.detalle.length} ${d.detalle.length === 1 ? 'línea' : 'líneas'})</summary><ul>${d.detalle.map(x => `<li><span>${H.esc(x.descripcion)}${x.cantidad ? ` · ${H.esc(String(x.cantidad).replace('.', ','))}${x.unidad ? ' ' + H.esc(x.unidad) : ''}` : ''}</span><span class="gn-m">${H.pesos(x.monto)}</span></li>`).join('')}</ul></details>` : '');
  const clasBtns = d => d.estado === 'no_va' ? '' : (puedeProv(d) ? bt(`data-gn-prov="${H.esc(d.id)}"`, TR.usaProvision(d) ? 'Cambiar uso de la provisión' : '¿Usa la provisión?') : '') + (d.clasifEf ? (esFl(d) ? bt(`data-gn-flete="${H.esc(d.id)}"`, (d.flete && (d.flete.docs || []).length) ? 'Cambiar sus compras' : '¿De qué compra es?', !(d.flete && (d.flete.docs || []).length)) : '') + bt(`data-gn-clasif="${H.esc(d.id)}"`, 'Cambiar clasificación')
    : '') + (d.clasifEf ? '' : d.soloItem ? bt(`data-gn-clasif="${H.esc(d.id)}"`, 'Elegir el área')
    : sugOk(d) ? bt(`data-gn-usar="${H.esc(d.id)}"`, 'Usar lo sugerido') + bt(`data-gn-clasif="${H.esc(d.id)}"`, 'Clasificar') : bt(`data-gn-clasif="${H.esc(d.id)}"`, 'Clasificar'));
  // v0.96.0 · Elegir (seleccionar y filtrar): la casilla va en lo que se puede unir (documentos con saldo, cargos con algo libre)
  const selD = new Set(st.sel.d), selM = new Set(st.sel.m), movsSel = st.sel.m.map(movDe).filter(Boolean), docsSel = st.sel.d.map(docDe).filter(Boolean);
  const puedeD = d => selD.has(d.id) || ((st.sel.m.length <= 1 || st.sel.d.length === 0) && movsSel.every(m => GB.compatible(d, m)) && !(st.sel.m.length > 1 && st.sel.d.length >= 1));
  const puedeM = m => selM.has(m.id) || (!(st.sel.d.length > 1 && st.sel.m.length >= 1) && docsSel.every(d => GB.compatible(d, m)));
  const casilla = (tipo, id, on, ok, quien) => `<label class="gn-elegir"><input type="checkbox" data-gn-sel-${tipo}="${H.esc(id)}" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Elegir ${H.esc(quien)}"></label>`;
  // v0.124.2 · La nota de un cargo o documento ("qué falta para resolverlo"), a la vista
  const notaFila = x => (x.nota && x.nota.texto ? `<p class="gn-nota">${H.icono('nota', 14)}<span>${H.esc(x.nota.texto)} <small>(${H.esc(String(x.nota.por || '').split('@')[0])}, ${H.esc(String(x.nota.en || '').slice(0, 10).split('-').reverse().join('-'))})</small></span></p>` : '');
  const btNota = (tipo, x) => bt(`data-gn-nota="${tipo}:${H.esc(x.id)}"`, x.nota && x.nota.texto ? 'Editar nota' : 'Nota');
  const docFila = (d, acc, elegible) => `<div class="gn-it${d.nc ? ' gn-nc' : ''}${selD.has(d.id) ? ' gn-elegido' : ''}" data-gn-doc="${H.esc(d.id)}"><div class="gn-fila">${elegible && d.saldo > 0 ? casilla('d', d.id, selD.has(d.id), puedeD(d), nom(d)) : ''}<b>${nombreDoc(d)}</b><span class="gn-m">${H.pesos(d.estadoPago === 'a_medias' ? d.saldo : d.total)}</span></div>
      <small>${lineaDoc(d)}${d.estadoPago === 'a_medias' ? ` · falta de ${H.pesos(d.total)}` : ''}</small>${notaFila(d)}${clasTxt(d)}${detHtml(d)}${acc ? `<div class="gn-acc">${acc}</div>` : ''}</div>`;
  // v0.126.0 · Etapa 3: un resto (lo libre de un cargo que ya pagó algo) dice de qué cargo es y qué pagó
  const resto = m => GB.esResto(m), yaPago = m => [...new Set((m.pagosM || []).map(p => docDe(p.docId)).filter(Boolean).map(d => `${nom(d)}${d.folio ? ' N° ' + d.folio : ''}`))].join(', ');
  const movFila = (m, acc, elegible) => `<div class="gn-it${selM.has(m.id) ? ' gn-elegido' : ''}${resto(m) ? ' gn-resto' : ''}" data-gn-mov="${H.esc(m.id)}"><div class="gn-fila">${elegible && m.libre > 0 ? casilla('m', m.id, selM.has(m.id), puedeM(m), m.glosa) : ''}<b>${resto(m) ? `Resto de ${H.esc(m.glosa)} ${H.pesos(m.monto)}: ${H.pesos(m.libre)} sin explicar` : H.esc(m.glosa)}</b><span class="gn-m">${H.pesos(m.libre > 0 && m.libre !== m.monto ? m.libre : m.monto)}</span></div>
      <small><span class="chip chip-chico gn-medio gn-medio-${medioDe(m)}">${MEDIOS[medioDe(m)]}</span> ${H.esc(GN.CUENTAS[m.cuenta] || m.cuenta)} · ${H.esc(H.diaTexto(m.fecha))}${m.hora ? ' ' + H.esc(m.hora) : ''}${resto(m) ? (yaPago(m) ? ` · ya pagó: ${H.esc(yaPago(m))}` : '') : m.libre > 0 && m.libre !== m.monto ? ` · queda libre de ${H.pesos(m.monto)}` : ''}${m.naturaleza ? ' · ' + H.esc(m.naturaleza === 'acuenta' ? 'Pago a cuenta' : GB.NO_GASTO[m.naturaleza] || m.naturaleza) : ''}${m.anterior ? ' · anterior al inicio' : ''}</small>${notaFila(m)}${acc ? `<div class="gn-acc">${acc}</div>` : ''}</div>`;
  const conNota = l => { const n = l.filter(x => x.nota && x.nota.texto).length; return n ? ` <span class="chip c-amarillo chip-chico">${n} con nota</span>` : ''; };
  const accDoc = d => d.nc ? bt(`data-gn-nc="${H.esc(d.id)}"`, 'Descontar de su factura', true) + clasBtns(d) + bt(`data-gn-nova="${H.esc(d.id)}"`, 'Esto no va')
    : (GB.aCuentaPara(d, B.aCuenta).length ? bt(`data-gn-aplicar="${H.esc(d.id)}"`, `Aplicar pago a cuenta (${H.pesos(GB.aCuentaPara(d, B.aCuenta).reduce((a, m) => a + m.libre, 0))})`, true) : '')
    + bt(`data-gn-como="${H.esc(d.id)}"`, '¿Cómo se pagó?', !GB.aCuentaPara(d, B.aCuenta).length) + clasBtns(d) + bt(`data-gn-nova="${H.esc(d.id)}"`, 'Esto no va') + btNota('doc', d);
  // v0.105.0 · La lupa: buscar su documento cuando la Bandeja no propone nada. Pago a cuenta: lo pagado antes de su documento.
  const accMov = m => resto(m) ? bt(`data-gn-resto="multa:${H.esc(m.id)}"`, 'Intereses o multa', true) + bt(`data-gn-resto="comision:${H.esc(m.id)}"`, 'Comisión del banco', true) + bt(`data-gn-sindoc="${H.esc(m.id)}"`, 'Sin documento')
      + bt(`data-gn-esde="${H.esc(m.id)}"`, `${H.icono('lupa', 14)} Buscar su documento`) + bt(`data-gn-nota="mov:${H.esc(m.id)}"`, m.nota && m.nota.texto ? 'Editar nota' : 'Esperar (dejar nota)')
    : B.rep[m.id] ? repHtml(m, B.rep[m.id])
    : bt(`data-gn-esde="${H.esc(m.id)}"`, `${H.icono('lupa', 14)} Buscar su documento`, true) + bt(`data-gn-tengo="${H.esc(m.id)}"`, 'Tengo la boleta (foto)') + bt(`data-gn-sindoc="${H.esc(m.id)}"`, 'Sin documento') + bt(`data-gn-nogasto="${H.esc(m.id)}"`, 'No es gasto') + bt(`data-gn-acuenta="${H.esc(m.id)}"`, 'Pago a cuenta') + btNota('mov', m);
  // v0.135.0 · Parece repetido: el mismo cargo en otra cartola
  const repHtml = (m, o) => `<span class="gn-rep">Parece repetido: el mismo cargo (fecha, monto y glosa) está en otra cartola${(o.pagosM || []).length ? ', ya conciliado' : ''}.</span>`
    + bt(`data-gn-esrep="${H.esc(m.id)}"`, 'Es repetido', true) + bt(`data-gn-dosc="${H.esc(m.id)}"`, 'Son dos compras');
  const parHtml = p => { const m = movDe(p.movId), ds = p.docIds.map(docDe).filter(Boolean);
    const sena = p.por === 'glosa' ? GB.senaDe(m.glosa) : '';
    return `<div class="gn-par${p.por === 'monto' ? '' : ' gn-par-seguro'}" data-gn-par="${H.esc(kPar(p))}"><div class="gn-par-lados"><div class="gn-par-l">${ds.map(d => `<div><b>${nombreDoc(d)}</b> <span class="gn-m">${H.pesos(d.saldo)}</span><small>${lineaDoc(d)}</small>${clasTxt(d)}${detHtml(d)}<div class="gn-acc">${clasBtns(d)}</div></div>`).join('')}</div>
      <div class="gn-par-r"><b>${H.esc(m.glosa)}</b> <span class="gn-m">${H.pesos(m.libre)}</span><small>${H.esc(GN.CUENTAS[m.cuenta] || m.cuenta)} · ${H.esc(H.diaTexto(m.fecha))}${m.anterior ? ' · anterior al inicio' : ''}</small></div></div>
      <div class="gn-par-pie"><span class="gn-par-por">${sena && ds.length === 1 && ds[0].anotada ? `aprendido: ${H.esc(sena)} es ${H.esc(nom(ds[0]))}` : POR_TXT[p.por] + (sena ? ` (${H.esc(sena)})` : '')}${p.dif ? ` · diferencia de ${H.pesos(Math.abs(p.dif))}` : ''}${sena ? ` <button type="button" class="gn-link" data-gn-olvidar="${H.esc(GB.claveProveedor(ds[0]))}" data-sena="${H.esc(sena)}">Olvidar esta glosa</button>` : ''}</span><div class="gn-acc">${bt(`data-gn-confirmar="${H.esc(kPar(p))}"`, p.faltaClasif ? 'Clasificar y conciliar' : 'Conciliar', true)}${bt(`data-gn-noeseste="${H.esc(kPar(p))}"`, 'No es este')}</div></div></div>`; };
  const seguros = pares.filter(p => p.por !== 'monto' && !p.faltaClasif && !(movDe(p.movId) || {}).anterior);
  const clasifHtml = d => docFila(d, clasBtns(d));
  // v0.125.1 · Listos: buscador (proveedor, N°, monto, ítem); con búsqueda se busca en todos, no solo en los 60 más nuevos
  const qL = GN.norm(st.qListos || ''), txtListo = d => GN.norm([nom(d), d.razon, d.rut, d.folio, d.tipoTexto, d.total, Math.round(Number(d.total) || 0).toLocaleString('es-CL'), d.clasif && d.clasif.item, ...(((d.clasif || {}).partes || []).map(x => x.item))].filter(Boolean).join(' '));
  const listosF = qL ? B.listosD.filter(d => qL.split(/\s+/).every(w => txtListo(d).includes(w))) : B.listosD;
  const listos = listosF.slice(0, 60);
  const pagoTxt = p => p.movId ? `${H.esc(GN.CUENTAS[p.cuenta] || p.cuenta || 'Banco')} ${H.esc(H.diaTexto(p.fecha))}` : `${H.esc((p.medio === 'nc' ? 'Nota de crédito' : GB.MEDIOS[p.medio] || p.medio))} ${H.esc(H.diaTexto(p.fecha))}`;
  const listoHtml = d => docFila(d, d.estado === 'no_va' ? `<span class="gn-sug">Esto no va: ${H.esc(GB.MOTIVOS_NO_VA_TODOS[(d.noVa || {}).motivo] || '')}${(d.noVa || {}).nota ? ' · ' + H.esc(d.noVa.nota) : ''}</span>${bt(`data-gn-volverdoc="${H.esc(d.id)}"`, 'Volver a la Bandeja')}`
    : d.pagos.map(p => `<span class="gn-sug">Pagado: ${H.pesos(p.monto)} · ${pagoTxt(p)}</span>${bt(`data-gn-deshacer="${H.esc(p.id)}"`, 'Deshacer el pago')}`).join('') + fotoAcc(d) + clasBtns(d));
  // v0.126.2 · Una boleta en papel registrada aquí: "Ver foto" o, si falta, "Sin foto" con "Agregar foto"
  function fotoAcc(d) {
    if (d.origen !== 'mano' || d.tipo !== '39m') return '';
    return d.foto && d.foto.url ? `<a class="btn-sec btn-chico gn-ver-foto" href="${H.esc(d.foto.url)}" target="_blank" rel="noopener">Ver foto</a>`
      : `<span class="gn-sin-foto">Sin foto de la boleta</span>${bt(`data-gn-foto="${H.esc(d.id)}"`, 'Agregar foto')}`;
  }   // v0.92.2: también se cambia la clasificación
  // v0.96.0 · Filtrar: lo elegido primero manda; el otro lado muestra sus posibles (lo elegido de ese lado, arriba)
  const filtraMovs = st.sel.primero === 'd' && docsSel.length > 0, filtraDocs = st.sel.primero === 'm' && movsSel.length > 0;
  const posMovs = filtraMovs ? movsSel.map(m => ({ m, calza: false, dentro: true, desc: false })).concat(GB.posiblesMovs(docsSel, B.abiertosM.filter(m => !selM.has(m.id) && (!st.cuenta || m.cuenta === st.cuenta)), B.S).slice(0, 20)) : [];
  const posDocs = filtraDocs ? docsSel.map(d => ({ d, calza: false, dentro: true, desc: false })).concat(GB.posiblesDocs(movsSel, B.abiertosD.filter(d => !selD.has(d.id)), B.S).slice(0, 20)) : [];
  const barraSel = () => { if (!docsSel.length && !movsSel.length) return '';
    const b = GB.balance(docsSel, movsSel), n = (x, s1, p1) => `${x} ${x === 1 ? s1 : p1}`;
    const estado = !docsSel.length || !movsSel.length ? `Elija también ${docsSel.length ? 'el cargo' : 'el documento'}.` : !b.valido ? 'Varios documentos con varios cargos: únalos en dos pasos.'
      : b.calza ? 'Calza.' : b.dif < 0 ? `Falta ${H.pesos(-b.dif)}: ${docsSel.length > 1 ? 'el último documento' : 'el documento'} queda pagado en parte.` : `Sobran ${H.pesos(b.dif)}: quedan libres en el cargo.`;
    return `<div class="gn-barra-sel" role="region" aria-label="Lo elegido"><div class="gn-barra-t"><span>${n(docsSel.length, 'documento', 'documentos')} · ${H.pesos(b.td)}</span><span>${n(movsSel.length, 'cargo', 'cargos')} · ${H.pesos(b.tm)}</span><b class="${b.valido && b.calza ? 'gn-ok' : ''}">${estado}</b></div>
      <div class="gn-acc"><button type="button" class="btn btn-chico" data-gn-unir ${b.valido ? '' : 'disabled'}>Conciliar</button><button type="button" class="btn-sec btn-chico" data-gn-limpiar>Limpiar</button></div></div>`; };
  const avisoCat = GI.activo(D.catalogo) ? '' : `<section class="tarjeta gn-aviso-cat" aria-labelledby="t-gn-avcat"><h2 id="t-gn-avcat">Falta un paso: el catálogo de ítems</h2><p class="ayuda">Cada ítem pasa a apuntar a una cuenta del plan, y Finanzas lee de ahí. Antes de pasar se ve una vista previa: nada cambia hasta que usted confirme.</p><a class="btn btn-chico" href="#gastos/catalogo">Ir a Gastos → Ítems</a></section>`;
  return `${avisoCat}<section class="tarjeta gn-cob-t" aria-labelledby="t-gn-cob"><div class="titulo-fila"><h2 id="t-gn-cob">Hasta dónde llega cada cuenta</h2></div>
      ${cob.length || sii ? `<div class="gn-cob">${sii}${cob.map(c => `<div class="gn-cob-c"><b>${H.esc(c.nombre)}</b><span>${H.esc(H.diaTexto(c.desde))} al ${H.esc(H.diaTexto(c.hasta))} · ${c.n} ${c.n === 1 ? 'movimiento' : 'movimientos'}</span></div>`).join('')}</div>` : '<p class="ayuda">Todavía no se sube ninguna cartola.</p>'}</section>
    ${kC ? '' : cartolasHtml(H, B)}
    <section class="tarjeta" aria-labelledby="t-gn-bandeja"><div class="titulo-fila"><h2 id="t-gn-bandeja">Bandeja</h2><span>${nTodo} por hacer</span></div>
      ${kC ? franjaCartolaHtml(H, kC, B) + cartolaHtml(H, kC, B) : ''}
      ${cuentas.length > 2 && !kC ? `<div class="gn-filtro" role="group" aria-label="Cuenta">${cuentas.map(([k, t]) => `<button type="button" class="chip ${st.cuenta === k ? 'c-verde' : 'c-gris'}" data-gn-cuenta="${k}" aria-pressed="${st.cuenta === k}">${H.esc(t)}</button>`).join('')}</div>` : ''}
      ${pestanas}
      ${kC && st.verConciliado ? conciliadoHtml(H, kC, B) : `<div class="gn-grupo" id="gn-pares"><div class="gn-grupo-t"><h3>Para conciliar · ${pares.length} ${H.info('Para conciliar', TXT_PARES)}</h3>${seguros.length > 1 ? `<button type="button" class="btn btn-chico gn-btn-seguro" data-gn-confirmar-seguros>Conciliar los ${seguros.length} en verde ya clasificados</button>` : ''}</div>
        ${pares.length ? pares.map(parHtml).join('') : '<div class="vacio">Nada por conciliar.</div>'}</div>
      ${espB.length ? esperaHtml(H, espB, docFila, bt) : ''}
      ${verAtr && B.conAreaAntigua.length ? `<div class="gn-grupo" id="gn-antiguas"><div class="gn-grupo-t"><h3>Con área antigua · ${B.conAreaAntigua.length} ${H.info('Área antigua', TXT_ANTIGUA)}</h3></div>${B.conAreaAntigua.map(d => docFila(d, bt(`data-gn-clasif="${H.esc(d.id)}"`, 'Cambiar clasificación', true))).join('')}</div>` : ''}
      ${verAtr && B.porClasificar.length ? `<div class="gn-grupo" id="gn-clasificar"><div class="gn-grupo-t"><h3>Pagados, falta clasificar · ${B.porClasificar.length} ${H.info('Pagados, falta clasificar', TXT_CLASIF)}</h3>${B.porClasificar.filter(sugOk).length > 1 ? bt('data-gn-usar-todas', `Usar lo sugerido en ${B.porClasificar.filter(sugOk).length}`) : ''}</div>${B.porClasificar.map(clasifHtml).join('')}</div>` : ''}
      <div class="gn-lados" id="gn-lados">
        <div class="gn-lado">${filtraDocs ? `<div class="gn-lado-t">Documentos posibles para ${movsSel.length === 1 ? 'el cargo elegido' : 'los cargos elegidos'} ${H.info('Elegir', TXT_ELEGIR)}</div>${posDocs.map(x => docFila(x.d, x.desc ? '<span class="chip c-gris chip-chico">descartado antes</span>' : x.calza ? '<span class="chip c-verde chip-chico">calza</span>' : (!x.dentro ? '<span class="gn-sug">fuera de las fechas</span>' : ''), true)).join('') || '<div class="vacio">Ningún documento con saldo para esto.</div>'}`
          : `<div class="gn-lado-t">Documentos sin pago · ${cuantos(sinPagoV, spBase)}${conNota(sinPagoV)} ${H.info('Documentos sin pago', TXT_SINPAGO)}</div>
          ${chipsMes(spBase, mesDoc, st.mesD, 'data-gn-mesd', 'Vencen en')}
          ${st.mesD && !sinPagoV.length ? '<div class="vacio">Ningún documento sin pago vence ese mes.</div>' : ''}
          ${enRec && !sinPagoV.length ? '<div class="vacio">Ningún documento nuevo en los últimos 7 días.</div>' : spBase.length ? (agrupar('d', st.mesD) ? gruposMes('d', sinPagoV, mesDoc, d => docFila(d, accDoc(d), true), d => d.saldo) : sinPagoV.map(d => docFila(d, accDoc(d), true)).join('')) : `<div class="vacio">${D.docs.length ? 'Todos los documentos tienen su pago.' : 'Todavía no hay documentos. Suba las compras del SII.'}</div>`}
          ${verAtr && B.anteriores.length ? `<details class="gn-det"${B.anteriores.some(d => selD.has(d.id)) ? ' open' : ''}><summary>${B.anteriores.length} de deuda anterior sin pago ${H.info('Deuda anterior', TXT_ANTERIOR)}</summary>${B.anteriores.map(d => docFila(d, accDoc(d), true)).join('')}</details>` : ''}`}</div>
        <div class="gn-lado">${filtraMovs ? '' : buscaMovHtml + filtroMedio}${!filtraMovs && qM ? resMovHtml() : filtraMovs ? `<div class="gn-lado-t">Cargos posibles para ${docsSel.length === 1 ? 'el documento elegido' : 'los documentos elegidos'} ${H.info('Elegir', TXT_ELEGIR)}</div>${posMovs.map(x => movFila(x.m, x.desc ? '<span class="chip c-gris chip-chico">descartado antes</span>' : x.calza ? '<span class="chip c-verde chip-chico">calza</span>' : (!x.dentro ? '<span class="gn-sug">fuera de las fechas</span>' : ''), true)).join('') || '<div class="vacio">Ningún cargo libre para esto.</div>'}`
          : `<div class="gn-lado-t">Movimientos sin documento · ${cuantos(sinDocV, sinDoc)}${conNota(sinDocV)} ${H.info('Movimientos sin documento', TXT_SINDOC)}</div>
          ${chipsMes(sinDoc, mesMov, st.mesM, 'data-gn-mesm', 'Movimientos del mes')}
          ${st.mesM && !sinDocV.length ? '<div class="vacio">Ningún movimiento sin documento ese mes.</div>' : ''}
          ${sinDoc.length ? (agrupar('m', st.mesM) ? gruposMes('m', sinDocV, mesMov, m => movFila(m, accMov(m), true), m => m.libre) : sinDocV.map(m => movFila(m, accMov(m), true)).join('')) : `<div class="vacio">${enRec ? 'Ningún cargo nuevo sin documento en los últimos 7 días.' : kC ? 'Todos los movimientos de esta cartola están conciliados.' : D.movs.length ? 'Todos los movimientos tienen su documento.' : 'Todavía no hay movimientos. Suba la cartola o el reporte de Mercado Pago.'}</div>`}
          ${verAtr && movsAnt.length ? `<details class="gn-det"${movsAnt.some(m => selM.has(m.id)) ? ' open' : ''}><summary>${movsAnt.length} ${movsAnt.length === 1 ? 'cargo anterior' : 'cargos anteriores'} al inicio sin documento ${H.info('Cargos anteriores', TXT_CARGOS_ANT)}</summary>${movsAnt.map(m => movFila(m, accMov(m), true)).join('')}</details>` : ''}`}
          ${filtraMovs ? '' : aCuentaV.length ? `<details class="gn-det"><summary>${aCuentaV.length} ${aCuentaV.length === 1 ? 'pago a cuenta' : 'pagos a cuenta'} · saldo a favor ${H.pesos(aCuentaV.reduce((a, m) => a + Math.max(0, m.libre), 0))} ${H.info('Pagos a cuenta', TXT_ACUENTA)}</summary>${aCuentaV.map(m => movFila(m, `<span class="gn-sug">A cuenta de ${H.esc(m.aCuenta ? m.aCuenta.razon || m.aCuenta.rut : '')}${m.libre > 0 ? ` · saldo a favor ${H.pesos(m.libre)}` : ' · ya aplicado entero'}${m.naturalezaNota ? ' · ' + H.esc(m.naturalezaNota) : ''}</span>` + (m.pagosM.length ? '' : bt(`data-gn-volvermov="${H.esc(m.id)}"`, 'Volver a la Bandeja')))).join('')}</details>` : ''}
          ${filtraMovs ? '' : noGasto.length ? `<details class="gn-det"><summary>${noGasto.length} que no son gasto (traspasos, retiros, tarjeta)</summary>${noGasto.map(m => movFila(m, bt(`data-gn-volvermov="${H.esc(m.id)}"`, 'Volver a la Bandeja'))).join('')}</details>` : ''}</div>
      </div>`}
      ${barraSel()}
      ${B.listosD.length ? `<details class="gn-det gn-listos" ${st.abrirListos || qL ? 'open' : ''} data-gn-listos><summary>Listos · ${B.listosD.length} (pagados o "esto no va")</summary>
        <div class="gn-listos-buscar"><input type="search" data-gn-qlistos value="${H.esc(st.qListos || '')}" placeholder="Buscar por proveedor, N°, monto o ítem" aria-label="Buscar en Listos">${qL ? `<span class="ayuda">${listosF.length} de ${B.listosD.length}</span>` : ''}</div>
        ${listos.length ? listos.map(listoHtml).join('') : '<div class="vacio">Nada con ese texto.</div>'}${listosF.length > 60 ? `<p class="ayuda">Y ${listosF.length - 60} más${qL ? '' : ' antiguos'}: ${qL ? 'afine la búsqueda' : 'búsquelos arriba'}.</p>` : ''}</details>` : ''}
    </section>`;
}

// ── v0.135.0 · Boletas esperando su pago (boceto "Boletas: una sola puerta", aprobado el 18 nov) ──
const TXT_ESPERA = 'Boletas anotadas con + Boleta que todavía no tienen su pago:\n• Débito o transferencia: esperan su cargo. Al subir la cartola aparecen en "Para conciliar"; si no, en el cargo use "Buscar su documento".\n• Tarjeta de crédito: esperan la compra del estado de cuenta de la tarjeta (súbalo cada mes).\n• Efectivo de una caja de venta: esperan el retiro "Pago a proveedor" que anota la cajera.\n• Efectivo de un cobro: esperan el pago anotado al recibir el cobro con "llegó menos".\nCuando el pago en efectivo ya está anotado, la boleta lo muestra: "Buscar su pago en efectivo" y confirme.';
const esperaDe = d => { const a = d.anotada || {};
  return a.medio === 'credito' ? 'espera la compra del estado de cuenta de la tarjeta' : a.medio === 'debito' ? 'espera su cargo en la cartola'
    : a.medio === 'efectivo' ? (a.origen === 'cobro' ? 'espera el pago anotado al recibir el cobro' : a.origen === 'caja' ? 'espera el retiro "Pago a proveedor" de la caja' : 'espera su pago en efectivo')
    : a.medio === 'personal' ? 'espera su pago (plata del dueño)' : 'espera su pago'; };
const MEDIO_BOL_TXT = { debito: 'débito o transferencia', credito: 'tarjeta de crédito', efectivo: 'efectivo', personal: 'mi plata' };
function esperaHtml(H, l, docFila, bt) {
  const fila = d => { const a = d.anotada || {}, ef = a.medio === 'efectivo';
    const como = `${MEDIO_BOL_TXT[a.medio] || ''}${ef && a.origen === 'caja' ? ', caja de venta' : ef && a.origen === 'cobro' ? ', un cobro' : ''}`;
    return `<div data-gn-espera="${H.esc(d.id)}"${ef ? ` data-gn-espera-ef="${H.esc(a.origen || 'caja')}" data-monto="${d.saldo}" data-fecha="${H.esc(d.fecha)}"` : ''}>${docFila(d,
      `<span class="gn-sug">${H.esc(como)} · ${H.esc(esperaDe(d))}</span><span data-gn-llego></span>`
      + (ef ? bt(`data-gn-buscaef="${H.esc(d.id)}"`, 'Buscar su pago en efectivo') : '') + bt(`data-gn-como="${H.esc(d.id)}"`, '¿Cómo se pagó?')
      + (d.foto && d.foto.url ? `<a class="btn-sec btn-chico gn-ver-foto" href="${H.esc(d.foto.url)}" target="_blank" rel="noopener">Ver foto</a>` : '') + bt(`data-gn-nova="${H.esc(d.id)}"`, 'Esto no va'))}</div>`; };
  return `<div class="gn-grupo" id="gn-esperan"><div class="gn-grupo-t"><h3>Boletas esperando su pago · ${l.length} ${H.info('Boletas esperando su pago', TXT_ESPERA)}</h3></div>${l.map(fila).join('')}</div>`;
}
// Después de pintar: si el pago en efectivo que una boleta espera ya está anotado, se avisa en la boleta (usted confirma con "Buscar su pago")
async function marcarEsperas(el, H) {
  const l = [...el.querySelectorAll('[data-gn-espera-ef]')]; if (!l.length) return;
  for (const x of l) {
    const c = await pagosSinBoleta(Number(x.dataset.monto), x.dataset.gnEsperaEf, x.dataset.fecha, isoHoy(), 5);
    const s = x.querySelector('[data-gn-llego]'); if (!s || !c.length) continue;
    s.innerHTML = `<span class="chip c-verde chip-chico">${c.length === 1 ? 'Ya está anotado un pago de este monto' : `Hay ${c.length} pagos de este monto`}</span>`;
    const b = x.querySelector('[data-gn-buscaef]'); if (b) { b.classList.remove('btn-sec'); b.classList.add('btn'); }
  }
}
async function buscarPagoEfectivo(el, H, d) {
  if (!d) return;
  const a = d.anotada || {}, cands = await pagosSinBoleta(d.saldo, a.origen || 'caja', d.fecha, isoHoy(), 5);
  if (!cands.length) { st.msg = ''; st.err = `Todavía no hay un pago en efectivo sin boleta de ${H.pesos(d.saldo)} (${esperaDe(d).replace(/^espera /, '')}). Cuando se anote, aparece aquí.`; return repintar(el, H); }
  const dlg = H.dialogo(`<div class="form-dialogo"><h2>Su pago en efectivo</h2><p class="ayuda">Boleta de <b>${H.esc(d.razon)}</b> · ${H.pesos(d.saldo)} · ${H.esc(H.diaTexto(d.fecha))}</p>
    ${cands.map(x => `<div class="bo-match-p"><span>${H.esc(x.texto)}${x.detalle ? `<small>${H.esc(x.detalle)}</small>` : ''}</span><button type="button" class="btn btn-chico" data-bo-es="${H.esc(x.id)}">Es este pago: unir la boleta</button></div>`).join('')}
    <p class="error" data-err role="alert"></p><div class="botones"><button type="button" class="btn-sec" data-cerrar>Ninguno es</button></div></div>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelectorAll('[data-bo-es]').forEach(b => b.addEventListener('click', async () => {
    const x = cands.find(c => c.id === b.dataset.boEs); b.disabled = true;
    try { if (!(await asegurarClasif(H, [d]))) { b.disabled = false; return; }
      await unirBoletaConPago(await fsGN(), d, x, d.saldo); dlg.close();
      H.registrar('Gastos: unió una boleta con su pago en efectivo', `${d.razon} · ${d.saldo}`); aviso(el, H, `Unida: la boleta de ${H.esc(d.razon)} con ${H.esc(x.texto)}.`); }
    catch (e) { b.disabled = false; falla(dlg, e, H); }
  }));
}

// ── v0.105.0 · Conciliar por cartola: avance, cuadre de saldo y lo conciliado ──
const TXT_ACUENTA = 'Un pago a cuenta es plata que salió para un proveedor o un trabajador antes de su documento: un anticipo, una parte de algo que se factura después, un abono. Queda conciliado (no está "sin explicar") y como saldo a favor de esa parte.\nNo es gasto del mes: el gasto es el documento cuando llegue. Cuando llega, la Bandeja muestra en ese documento "Aplicar pago a cuenta" y se une con un toque. Mientras no se aplique, puede volver a la Bandeja.';
const TXT_CUADRE = 'El cuadre de saldo revisa que la cartola esté completa: el saldo inicial más los abonos menos los cargos tiene que dar el saldo final, y cada fila tiene que calzar con la anterior. Si una fila no calza, falta un movimiento o el archivo viene cortado.\nAbajo, los cargos de la cartola desde el inicio contra los que están en Gastos: si no calzan, falta o sobra un cargo (por ejemplo, uno que llegó en otra cartola con otra glosa).\nLos abonos (lo que entra) siguen en Ventas a empresas → Conciliación.';
const TXT_AVANCE = 'Conciliado: el movimiento quedó unido entero con sus documentos, o explicado (no es gasto, pago a cuenta). Un movimiento unido solo en parte sigue por conciliar.';
function avanceHtml(H, a) {
  return `<div class="gn-avance" role="img" aria-label="${a.listos} de ${a.n} conciliados"><div class="gn-avance-t"><span>${a.listos} de ${a.n} movimientos conciliados</span><b>${a.pct}%</b></div><div class="gn-avance-p"><span style="width:${a.pct}%"></span></div></div>`;
}
function cuadreHtml(H, k, movs) {
  const q = GB.cuadreEnGastos(k, movs);
  if (!q) return k.tipo === 'bancoestado' ? '<p class="ayuda">Esta cartola se subió antes del cuadre de saldo. Para verlo, súbala otra vez: no se repite nada.</p>' : '';
  const ok = '<span class="gn-ok">calza</span>', no = t => `<span class="gn-no">${t}</span>`;
  return `<div class="gn-cuadre"><div class="gn-cuadre-t"><b>Cuadre de saldo</b>${H.info('Cuadre de saldo', TXT_CUADRE)}</div>
    <dl><dt>Saldo inicial</dt><dd class="gn-num">${H.pesos(q.inicial)}</dd><dt>+ Abonos</dt><dd class="gn-num">${H.pesos(q.abonos)}</dd><dt>− Cargos</dt><dd class="gn-num">${H.pesos(q.cargos)}</dd><dt>= Saldo final</dt><dd class="gn-num">${H.pesos(q.final)}</dd></dl>
    <p>${q.cuadra ? `La cartola ${ok}: ${q.filas} filas completas.` : no(q.saltos ? `${q.saltos} ${q.saltos === 1 ? 'fila no calza' : 'filas no calzan'} con la anterior: puede faltar un movimiento.` : 'El saldo final no calza con los movimientos.')}</p>
    <p>Cargos desde el inicio: ${H.pesos(q.cargosDesde)} · en Gastos: ${H.pesos(q.enGastos)} · ${Math.abs(q.dif) <= 1 ? ok : no(q.dif > 0 ? `sobran ${H.pesos(q.dif)} en Gastos` : `faltan ${H.pesos(-q.dif)} en Gastos`)}</p></div>`;
}
const NOMBRE_CARGA = { sii: 'Compras del SII', bancoestado: 'Cartola BancoEstado', mercadopago: 'Mercado Pago', boleta: 'Boleta de luz o agua', liquidacion: 'Liquidación de sueldo', f29: 'F29', bte: 'Boleta de terceros', previred: 'Previred', credito: 'Crédito', tarjeta: 'Tarjeta de crédito (anotada)' };
const conMovs = k => ['bancoestado', 'mercadopago', 'tarjeta'].includes(k.tipo) && (k.cuentas || []).length && k.desde;
// v0.106.1 · Las cartolas en la Bandeja (decidido por Emmanuel el 26 oct): las que tienen pendientes, con "Conciliar esta cartola", y las
// conciliadas al 100 %, con "Ver lo conciliado". Una cartola subida dos veces (para el cuadre) se muestra una vez: la última.
function cartolasDe(cargas, movs) {
  const vistas = {};
  (cargas || []).filter(conMovs).forEach(k => { const c = [k.tipo, (k.cuentas || []).join(','), k.desde, k.hasta].join('|'), y = vistas[c];
    if (!y || (!!k.cuadre > !!y.cuadre) || (!!k.cuadre === !!y.cuadre && String(k.en || '') > String(y.en || ''))) vistas[c] = k; });
  // v0.127.2 · Por período: las en línea que caben en una histórica (o en una en línea más nueva) quedan dentro de ella, plegadas
  const g = CP.agruparPorPeriodo(Object.values(vistas).map(k => ({ k, clave: [k.tipo, (k.cuentas || []).join(',')].join('|'), desde: k.desde, hasta: k.hasta || k.desde, hist: CP.esHistorica(k.identificador), en: k.en || '' })));
  return g.map(({ item, dentro }) => ({ k: item.k, hist: item.hist, dentro: dentro.map(d => d.k), rango: item.hist ? CP.rangoDentro(dentro) : null, a: GB.avanceCarga(item.k, movs) })).sort((x, y) => String(y.k.hasta).localeCompare(String(x.k.hasta)) || String(y.k.en || '').localeCompare(String(x.k.en || '')));
}
function cartolasHtml(H, B) {
  const l = cartolasDe(st.D.cargas, B.movs); if (!l.length) return '';
  const pend = l.filter(x => x.a.faltan), listas = l.filter(x => !x.a.faltan && x.a.n), vacias = l.filter(x => !x.a.n);
  const saldo = k => { const q = GB.cuadreEnGastos(k, B.movs); if (!q) return k.tipo === 'bancoestado' ? '<span class="gn-sug">Sin cuadre de saldo: súbala otra vez (no se repite nada)</span>' : '';
    return q.cuadra && Math.abs(q.dif) <= 1 ? '<span class="gn-ok">Saldo calza</span>' : CP.esEnLinea(k.identificador) ? '<span class="gn-sug">Saldo: se revisa con la histórica cuando llegue</span>' : '<span class="gn-no">Saldo no calza</span>'; };
  const fila = ({ k, a, hist, dentro, rango }, boton) => `<div class="gn-cart${dentro && dentro.length ? ' gn-cart-grupo' : ''}"><div class="gn-fila"><b>${H.esc(NOMBRE_CARGA[k.tipo] || k.tipo)} · ${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))}</b>${boton}</div>
    <small>${H.esc(k.identificador || k.archivo || '')}${dentro && dentro.length ? (hist ? ' · manda sobre las en línea de esos días' : ' · la más nueva: trae todo lo de las anteriores') : ''}</small>${avanceHtml(H, a)}${comparaHtml(k, rango)}${notasCartola(k)}<div class="gn-cart-pie">${saldo(k)}${k.cuadre ? `<details class="gn-det"><summary>Ver cuadre</summary>${cuadreHtml(H, k, B.movs)}</details>` : ''}</div>${dentroHtml(dentro, hist)}</div>`;
  // v0.127.2 · Las que quedaron dentro (plegadas) y, en una histórica, lo que trajo distinto de las en línea de esos días
  const dentroHtml = (dentro, hist) => dentro && dentro.length ? `<details class="gn-det gn-cart-dentro"><summary>${hist ? 'En línea que quedaron dentro de esta' : 'En línea anteriores de estos mismos días'} · ${dentro.length}</summary><p class="ayuda">Quedaron dentro de esta: lo conciliado sigue conciliado y no se repite nada.</p>${dentro.map(d => `<div class="gn-cart-sub"><span>${H.esc(H.diaTexto(d.desde))} al ${H.esc(H.diaTexto(d.hasta))}</span><small>${H.esc(d.identificador || d.archivo || '')}</small></div>`).join('')}</details>` : '';
  const comparaHtml = (k, rango) => {
    if (!rango) return '';
    const nuevos = (B.movs || []).filter(m => m.cargaId === k.id && !m.anterior && m.fecha >= rango.desde && m.fecha <= rango.hasta).sort((x, y) => x.fecha.localeCompare(y.fecha));
    const ya = (Number(k.yaEstaban) || 0) + (Number(k.parecidos) || 0);
    return `<div class="gn-compara"><b>Comprobada con las en línea: ${ya} ya estaban · ${nuevos.length ? `${nuevos.length} ${nuevos.length === 1 ? 'nuevo' : 'nuevos'}` : 'nada nuevo'}</b>${nuevos.map(m => `<div class="gn-fila"><span>Solo en la histórica: <b>${H.esc(H.diaTexto(m.fecha))} · ${H.esc(m.glosa)} · ${H.pesos(m.monto)}</b></span>${GB.conciliado(m) ? '<span class="gn-ok">conciliado</span>' : '<span class="gn-sug">por conciliar</span>'}</div>`).join('')}<p class="ayuda">Un movimiento que estaba en la en línea y la histórica no trae (un reverso) aparece en el cuadre como "sobran en Gastos".</p></div>`;
  };
  // v0.124.2 · Los cargos por conciliar de la cartola que tienen nota: cuántos y cuáles
  const notasCartola = k => { const l = GB.movsDeCarga(k, B.movs).filter(m => !GB.conciliado(m) && m.nota && m.nota.texto).sort((x, y) => x.fecha.localeCompare(y.fecha));
    return l.length ? `<details class="gn-det gn-cart-notas"><summary>${l.length} por conciliar con nota</summary>${l.map(m => `<div class="gn-cart-nota"><div class="gn-fila"><span>${H.esc(H.diaTexto(m.fecha))} · ${H.esc(m.glosa)}</span><span class="gn-m">${H.pesos(m.libre > 0 ? m.libre : m.monto)}</span></div><p class="gn-nota">${H.icono('nota', 14)}<span>${H.esc(m.nota.texto)}</span></p></div>`).join('')}</details>` : ''; };
  const bt = (k, txt, pri) => `<button type="button" class="${pri ? 'btn' : 'btn-sec'} btn-chico" data-gn-concart="${H.esc(k.id)}">${txt}</button>`;
  // v0.106.2 · Se pliega y se despliega; cada equipo recuerda cómo la dejó (sin nada guardado: abierta si hay pendientes)
  let abierta = pend.length > 0; try { const g = localStorage.getItem('fen_gn_cartolas'); if (g === '1' || g === '0') abierta = g === '1'; } catch (e) {}
  return `<details class="tarjeta plegable gn-cartolas" id="gn-cartolas" ${abierta ? 'open' : ''}><summary class="titulo-fila"><h2 id="t-gn-cart">Cartolas</h2><span>${pend.length ? `${pend.length} con pendientes` : 'todas conciliadas'}</span></summary>
    <p class="ayuda">${H.info('Cartolas', TXT_AVANCE + '\n' + TXT_CUADRE)} El avance y el cuadre de saldo de cada cartola subida.</p>
    <div class="gn-grupo-t"><h3>Con pendientes por conciliar · ${pend.length}</h3></div>
    ${pend.length ? pend.map(x => fila(x, bt(x.k, 'Conciliar esta cartola', true))).join('') : '<div class="vacio">Todas las cartolas están conciliadas.</div>'}
    ${listas.length ? `<details class="gn-det"><summary>Conciliadas al 100 % · ${listas.length}</summary>${listas.map(x => fila(x, bt(x.k, 'Ver lo conciliado'))).join('')}</details>` : ''}
    ${vacias.length ? `<details class="gn-det"><summary>Sin movimientos desde el inicio · ${vacias.length}</summary><p class="ayuda">Todos sus cargos son de antes del ${H.esc(H.diaTexto(st.D.inicio || INICIO()))}: no hay nada que conciliar aquí (los de los 20 días antes del inicio están en "Cargos anteriores").</p>${vacias.map(({ k }) => `<div class="gn-cart"><b>${H.esc(NOMBRE_CARGA[k.tipo] || k.tipo)} · ${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))}</b><small>${H.esc(k.identificador || k.archivo || '')}</small></div>`).join('')}</details>` : ''}
  </details>`;
}
// v0.125.1 · Mientras se concilia una cartola, una franja que queda pegada arriba al bajar: qué cartola es, su avance y cómo salir
function franjaCartolaHtml(H, k, B) {
  const a = GB.avanceCarga(k, B.movs);
  return `<div class="gn-franja-carga" role="status"><div class="gn-franja-t"><b>Conciliando la cartola del ${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))}</b><span>${a.listos} de ${a.listos + a.faltan} movimientos conciliados · se ven solo los de esta cartola</span></div>
    <button type="button" class="btn-sec btn-chico" data-gn-quitarcarga>Volver a toda la Bandeja</button></div>`;
}
function cartolaHtml(H, k, B) {
  const a = GB.avanceCarga(k, B.movs);
  return `<div class="gn-cartola" role="region" aria-label="Conciliando una cartola"><div class="gn-fila"><b>Conciliando: ${H.esc(NOMBRE_CARGA[k.tipo] || k.tipo)} · ${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))}</b>${H.info('Conciliado', TXT_AVANCE)}</div>
    <small>${H.esc(k.identificador || k.archivo || '')}</small>${avanceHtml(H, a)}${cuadreHtml(H, k, B.movs)}
    <div class="gn-filtro" role="group" aria-label="Qué ver"><button type="button" class="chip ${st.verConciliado ? 'c-gris' : 'c-verde'}" data-gn-verconc="0" aria-pressed="${!st.verConciliado}">Por conciliar · ${a.faltan}</button><button type="button" class="chip ${st.verConciliado ? 'c-verde' : 'c-gris'}" data-gn-verconc="1" aria-pressed="${st.verConciliado}">Lo conciliado · ${a.listos}</button></div>
    <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-quitarcarga>Ver toda la Bandeja</button></div></div>`;
}
function conciliadoHtml(H, k, B) {
  const porId = Object.fromEntries(B.docs.map(d => [d.id, d])), l = GB.movsDeCarga(k, B.movs).filter(GB.conciliado).filter(m => !st.mesM || String(m.fecha).slice(0, 7) === st.mesM).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const como = m => m.naturaleza === 'acuenta' ? `A cuenta de ${H.esc(m.aCuenta ? m.aCuenta.razon || m.aCuenta.rut : '')}${m.pagosM.length ? ' · aplicado a ' + H.esc(m.pagosM.map(p => porId[p.docId] ? `${porId[p.docId].razon || ''} N° ${porId[p.docId].folio || ''}` : '').filter(Boolean).join(', ')) : ''}`
    : m.naturaleza ? H.esc(GB.NO_GASTO[m.naturaleza] || m.naturaleza) : m.estado === 'no_va' ? 'No va'
    : H.esc(m.pagosM.map(p => porId[p.docId] ? `${porId[p.docId].razon || porId[p.docId].rut || ''} ${porId[p.docId].tipoTexto || ''} N° ${porId[p.docId].folio || ''} (${H.pesos(p.monto)})` : '').filter(Boolean).join(' · '));
  return `<div class="gn-grupo" id="gn-conciliado"><div class="gn-grupo-t"><h3>Lo conciliado de esta cartola · ${l.length}${st.mesM ? ' · ' + H.esc(GF.mesCorto(st.mesM)) : ''}</h3></div>${(() => { const meses = [...new Set(GB.movsDeCarga(k, B.movs).filter(GB.conciliado).map(m => String(m.fecha).slice(0, 7)))].sort().reverse(); return meses.length > 1 || st.mesM ? `<div class="gn-filtro gn-filtro-mes" role="group" aria-label="Movimientos del mes"><button type="button" class="chip chip-chico ${st.mesM ? 'c-gris' : 'c-verde'}" data-gn-mesm="" aria-pressed="${!st.mesM}">Todos</button>${meses.map(m => `<button type="button" class="chip chip-chico ${st.mesM === m ? 'c-verde' : 'c-gris'}" data-gn-mesm="${m}" aria-pressed="${st.mesM === m}">${H.esc(GF.mesCorto(m))}</button>`).join('')}</div>` : ''; })()}
    ${l.length ? l.map(m => `<div class="gn-it"><div class="gn-fila"><b>${H.esc(m.glosa)}</b><span class="gn-m">${H.pesos(m.monto)}</span></div><small>${H.esc(H.diaTexto(m.fecha))} · ${como(m)}</small>${m.nota && m.nota.texto ? `<p class="gn-nota">${H.icono('nota', 14)}<span>${H.esc(m.nota.texto)}</span></p>` : ''}</div>`).join('') : '<div class="vacio">Todavía nada conciliado en esta cartola.</div>'}
    <p class="ayuda">Para corregir uno: "Deshacer el pago" en su documento (Listos) o "Volver a la Bandeja" en lo que no es gasto.</p></div>`;
}

// ── Archivos subidos ──
function cargasHtml(H) {
  const K = st.D.cargas, nombre = NOMBRE_CARGA;   // v0.106.1: solo el registro de lo subido (el avance de cada cartola está en la Bandeja)
  return `<section class="tarjeta" aria-labelledby="t-gn-tc"><div class="titulo-fila"><h2 id="t-gn-tc">Tarjeta de crédito</h2>${H.info('Tarjeta de crédito', TXT_TARJETA)}</div>
      <p class="ayuda">Su estado de cuenta viene en PDF de imagen: anote aquí sus compras y cada una queda como un movimiento de la tarjeta, para unirla con su factura.</p>
      <button type="button" class="btn btn-chico" data-gn-tarjeta>Anotar compras de la tarjeta</button></section>
    <section class="tarjeta" aria-labelledby="t-gn-cargas"><div class="titulo-fila"><h2 id="t-gn-cargas">Archivos subidos</h2><span>${K.length}</span></div>
    <p class="ayuda">El registro de todo lo subido, por orden de llegada. El avance de cada cartola y "Conciliar esta cartola" están en la Bandeja.</p>
    ${K.length ? K.map(k => `<div class="gn-carga"><div class="gn-fila"><b>${H.esc(nombre[k.tipo] || k.tipo)}${k.desde ? ` · ${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))}` : ''}</b><small>${H.esc(k.en || '')}</small></div>
      <small>${H.esc(k.archivo || '')}${k.identificador ? ' · ' + H.esc(k.identificador) : ''} · ${H.esc(k.por || '')}</small>
      <p>${H.esc(GN.textoCarga(k))}</p>
      ${(k.parecidosLista || []).length ? `<details class="gn-det"><summary>Ver lo que ya había llegado en otra cartola</summary>${k.parecidosLista.map(p => `<div class="gn-fila"><span>${H.esc(H.diaTexto(p.fecha))} · ${H.esc(p.glosa)}</span><span class="gn-m">${H.pesos(p.monto)}</span></div>`).join('')}</details>` : ''}</div>`).join('')
      : '<div class="vacio" style="border:0">Todavía no se sube ningún archivo.</div>'}</section>`;
}

// ── Eventos ──
function conectar(el, H) {
  const inp = el.querySelector('#gn-archivo');
  if (inp) inp.addEventListener('change', () => { const l = Array.from(inp.files || []); inp.value = ''; if (l.length) subir(l, el, H); });
  arrastrar(el, H);
  acciones(el, H);
  const bp = el.querySelector('#gn-buscar-prov');
  // v0.125.1 · Buscador de Listos (se vuelve a dibujar con lo encontrado; el cursor sigue en la casilla)
  const ql = el.querySelector('[data-gn-qlistos]');
  if (ql) { let t = null; ql.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.qListos = ql.value; st.abrirListos = true; const pos = ql.selectionStart; pintar(el, subActual(), H).then(() => { const n = el.querySelector('[data-gn-qlistos]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }); }, 250); }); }
  el.querySelectorAll('[data-gn-medio]').forEach(b => b.addEventListener('click', () => { st.medio = b.dataset.gnMedio; pintar(el, subActual(), H); }));
  const qm = el.querySelector('[data-gn-qmov]');
  if (qm) { let t = null; qm.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.qMov = qm.value; const pos = qm.selectionStart; pintar(el, subActual(), H).then(() => { const n = el.querySelector('[data-gn-qmov]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }); }, 250); }); }
  const dl = el.querySelector('[data-gn-listos]'); if (dl) dl.addEventListener('toggle', () => { st.abrirListos = dl.open; });
  if (bp) bp.addEventListener('input', () => { st.buscaProv = bp.value; const pos = bp.selectionStart; pintar(el, subActual(), H).then(() => { const n = el.querySelector('#gn-buscar-prov'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }); });
  const selCambio = raiz => raiz.querySelectorAll('[data-gn-sel-d], [data-gn-sel-m]').forEach(x => x.addEventListener('change', () => elegir(el, H, x.dataset.gnSelD ? 'd' : 'm', x.dataset.gnSelD || x.dataset.gnSelM, x.checked)));
  selCambio(el);
  // v0.126.3 · Un mes de Atrasados se dibuja al abrirlo (y queda abierto, o cerrado, al volver a dibujar la Bandeja)
  el.querySelectorAll('details[data-gn-mesgrp]').forEach(dt => dt.addEventListener('toggle', () => {
    const k = dt.dataset.gnMesgrp; (st.mesAbierto || (st.mesAbierto = {}))[k] = dt.open;
    const c = dt.querySelector('.gn-mesgrp-c'); if (dt.open && c && !c.children.length && st.lazy && st.lazy[k]) { c.innerHTML = st.lazy[k](); selCambio(c); delete st.lazy[k]; }
  }));
  const gc = el.querySelector('#gn-cartolas'); if (gc) gc.addEventListener('toggle', () => { try { localStorage.setItem('fen_gn_cartolas', gc.open ? '1' : '0'); } catch (e) {} });
  conectarDeudaAnterior(el, H);   // v0.128.2
  const bb = el.querySelector('[data-gn-boleta]'); if (bb) bb.addEventListener('click', () => tomarFotoBoleta(f => dlgBoleta(H, f, { el })));   // v0.130.0
  el.querySelectorAll('[data-gn-cuenta]').forEach(b => b.addEventListener('click', () => { st.cuenta = b.dataset.gnCuenta; pintar(el, subActual(), H); }));
  el.querySelectorAll('[data-gn-vista]').forEach(b => b.addEventListener('click', () => { st.vista = b.dataset.gnVista; try { localStorage.setItem('fen_gn_vista', st.vista); } catch (e) { /* sin almacenamiento */ } pintar(el, subActual(), H); }));
  // v0.102.0 · Vista previa del catálogo: lo que se decide se guarda en la vista (nada se escribe hasta confirmar)
  el.querySelectorAll('[data-gn-pv-otro]').forEach(x => x.addEventListener('change', () => { if (st.previa && x.checked) { st.previa.dec.otros[x.dataset.gnPvOtro] = x.value; repintarQuieto(el, H); } }));
  el.querySelectorAll('[data-gn-pv-rev]').forEach(x => x.addEventListener('change', () => { if (st.previa) { st.previa.dec.revisar[x.dataset.gnPvRev] = x.value; repintarQuieto(el, H); } }));
}
const repintar = (el, H) => { if (enGastos()) pintar(el, subActual(), H); };

// Arrastrar y soltar: un solo juego de escuchadores en la vista (la cabecera se vuelve a dibujar). Soltar fuera del recuadro, dentro
// de Gastos, también sirve (así el navegador no abre el archivo en la pestaña).
function arrastrar(el, H) {
  if (el.dataset.gnArrastre) return;
  el.dataset.gnArrastre = '1';
  let n = 0;
  const conArchivos = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  const marcar = on => { const z = el.querySelector('[data-gn-drop]'); if (z) z.classList.toggle('gn-drop-sobre', on); };
  el.addEventListener('dragenter', ev => { if (!conArchivos(ev) || !enGastos()) return; ev.preventDefault(); n++; marcar(true); });
  el.addEventListener('dragover', ev => { if (!conArchivos(ev) || !enGastos()) return; ev.preventDefault(); ev.dataTransfer.dropEffect = st.subiendo ? 'none' : 'copy'; });
  el.addEventListener('dragleave', ev => { if (!conArchivos(ev)) return; n = Math.max(0, n - 1); if (!n) marcar(false); });
  el.addEventListener('drop', ev => {
    if (!conArchivos(ev) || !enGastos()) return;
    ev.preventDefault(); n = 0; marcar(false);
    const l = Array.from(ev.dataTransfer.files || []);
    if (l.length && !st.subiendo) subir(l, el, H);
  });
}
// Uno o varios archivos, uno detrás de otro; cada uno con su resultado
async function subir(lista, el, H) {
  const L = Array.isArray(lista) ? lista : [lista], msgs = [], errs = [];
  st.err = ''; st.msg = '';
  for (let i = 0; i < L.length; i++) {
    st.subiendo = L.length > 1 ? `Leyendo ${i + 1} de ${L.length}: ${L[i].name}` : true; repintar(el, H);
    try { msgs.push(await procesar(L[i], H)); }
    catch (e) { errs.push(H.esc(`${L.length > 1 ? L[i].name + ': ' : ''}No se pudo cargar el archivo: ` + (e.message || H.mensajeError(e)))); }
    st.D = null;
  }
  st.subiendo = false; st.msg = msgs.join('<hr class="gn-sep">'); st.err = errs.join('<br>');
  repintar(el, H);
}
const ext = f => (String(f.name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
async function procesar(f, H) {
  const e = ext(f);
  if (f.size > 10 * 1024 * 1024) throw new Error('el archivo pesa más de 10 MB.');
  if (e === 'pdf') return subirBoleta(f, H);
  if (e === 'csv') {
    const txt = await f.text();
    const Pv = await import('./previred.js?v=0.138.0');
    if (Pv.esCsvNomina(Pv.textoDeArchivo(await f.arrayBuffer()))) return subirPrevired(f, H, Pv.leerCsv(Pv.textoDeArchivo(await f.arrayBuffer())));
    const tipo = MP.tipoReporte(txt);
    if (tipo === 'liberaciones') return subirMP(f, txt, H);
    if (tipo === 'liquidaciones') throw new Error(MP.leer(txt).error);
    return subirSii(f, txt, H);
  }
  if (['xml', 'txt', 'html'].includes(e)) return subirSii(f, await f.text(), H);
  if (!['xls', 'xlsx'].includes(e)) throw new Error('no se reconoce ese archivo. Sirven las compras del SII (XML, CSV o XLS), la cartola de BancoEstado (.xlsx) y el reporte de liberaciones de Mercado Pago (.csv).');
  const XLSX = await H.cargarXLSX();
  let wb = null; try { wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }); } catch (x) { wb = null; }
  if (wb) {
    const tefs = H.B2b.leerTransferencias(wb, XLSX);
    if (tefs) { const r = await H.B2b.guardarTransferencias(tefs); H.registrar('Cargó transferencias recibidas', `${r.leidas} leídas · ${r.nuevas} nuevas`); return `<b>Transferencias recibidas</b>: ${r.leidas} en el archivo · ${r.nuevas} nuevas. Sirven a Ventas a empresas → Conciliación (quién pagó cada abono).`; }
    { const GP = await import('./gn-pdf.js?v=0.138.0'), hC = wb.SheetNames.find(n => /^cr[eé]dito$/i.test(n)), hQ = wb.SheetNames.find(n => /^cuotas$/i.test(n));   // v0.124.5
      if (hC && hQ) { const fC = XLSX.utils.sheet_to_json(wb.Sheets[hC], { header: 1, defval: '', raw: true });
        if (GP.esTablaFen(wb.SheetNames, (fC[0] || [])[0])) { const r = GP.leerTablaFen(fC, XLSX.utils.sheet_to_json(wb.Sheets[hQ], { header: 1, defval: '', raw: true }));
          if (r.bloquea) throw new Error('la tabla no se guardó. ' + r.errores.slice(0, 4).join(' ') + (r.errores.length > 4 ? ` (y ${r.errores.length - 4} más)` : ''));
          const k = await (await fsGN()).cargarTablaCredito(r, { nombre: f.name, tamano: f.size }); H.registrar('Gastos: cargó una tabla de amortización', r.nombre);
          return `<b>${H.esc(r.nombre)}</b>: ${k.que === 'ya' ? 'se unió al crédito que ya estaba' : 'crédito nuevo'} · ${r.reales} ${r.reales === 1 ? 'cuota' : 'cuotas'} con capital, interés y comisiones del banco${k.cambiados ? ` · ${k.cambiados} ${k.cambiados === 1 ? 'cuota ya en Gastos se actualizó' : 'cuotas ya en Gastos se actualizaron'}` : ''}.${k.revisar ? ` <b>${k.revisar} ${k.revisar === 1 ? 'cuota pagada tiene' : 'cuotas pagadas tienen'} otro total en la tabla: revísela${k.revisar === 1 ? '' : 's'} (no se cambió).</b>` : ''}`; } } }
    if (wb.SheetNames.includes('Datos')) { const GP = await import('./gn-pdf.js?v=0.138.0'), filas = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1, defval: '', raw: false });
      if (GP.esDetalleCredito(filas)) { const enc = wb.SheetNames.includes('Encabezados') ? XLSX.utils.sheet_to_csv(wb.Sheets.Encabezados) : '', r = GP.leerCredito(filas, enc);
        if (r.bloquea) throw new Error(r.errores.join(' '));
        const k = await (await fsGN()).cargarCredito(r, { nombre: f.name, tamano: f.size }); H.registrar('Gastos: cargó un crédito', r.nombre);
        return `<b>${H.esc(r.nombre)}</b>: ${k.que === 'ya' ? 'ya estaba (se actualizó el estado de sus cuotas)' : 'nuevo'}. Cada cuota entra a la Bandeja el mes en que vence. Para separar interés y capital, escriba el monto original y la tasa en Compromisos → Créditos.`; } }
    if (esCartola(wb, XLSX, H)) return subirCartola(f, wb, XLSX, H);
  }
  return subirSii(f, await f.text(), H);
}
function esCartola(wb, XLSX, H) {
  if (wb.SheetNames.includes('Movimientos') || wb.SheetNames.includes('Registros')) return true;
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(0, 30);
  return filas.some(r => { const n = r.map(x => H.B2b.normCartola(x)); return n.includes('DESCRIPCION') && (n.some(x => /^CARGOS?$|CHEQUES CARGOS/.test(x)) || n.some(x => /^ABONOS?$|DEPOSITOS ABONOS/.test(x))); });
}
// v0.96.0 · Boleta de luz (CGE) o agua (ESSBIO) en PDF: el mismo lector del Gastos anterior; entra como documento con su N° de cliente
async function subirBoleta(f, H) {
  const [Pv, Bo] = await Promise.all([import('./previred.js?v=0.138.0'), import('./boletas.js?v=0.138.0')]);
  let lineas = null; try { lineas = await Pv.lineasDelPdf(f); } catch (x) { throw new Error('no se pudo leer el PDF.'); }
  const GP = await import('./gn-pdf.js?v=0.138.0'), tipo = GP.tipoPdf(lineas);
  if (tipo) return subirOtroPdf(f, H, GP, tipo, lineas);
  if (Pv.esComprobante(lineas) || Pv.esCertificado(lineas)) { let r; try { r = Pv.leerPdf(lineas); } catch (x) { throw new Error(x.message); } return subirPrevired(f, H, r); }
  const r = Bo.leerBoleta(lineas);
  if (!r.reconocida) throw new Error('ese PDF no es una boleta de luz (CGE) o agua (ESSBIO), una liquidación de sueldo ni un F29. Previred y la tarjeta de crédito llegan después.');
  if (r.bloquea) throw new Error(`la boleta no se guardó. ${r.errores.join(' ')}`);
  const emp = Bo.EMPRESAS[r.empresa], id = GN.idCarga('boleta');
  const d = GN.docDeBoleta(r, { rut: emp.rut, nombre: emp.nombre, servicio: emp.servicio }, GN.direccionDeBoleta(lineas), id);
  const k = await (await fsGN()).cargarBoleta(d, { nombre: f.name, tamano: f.size });
  H.registrar('Gastos: cargó una boleta', `${d.razon} N° ${d.folio} · ${GN.textoCarga(k)}`);
  return `<b>Boleta de ${H.esc(emp.servicio)} ${H.esc(emp.nombre)}</b> N° ${H.esc(d.folio)} · cliente ${H.esc(d.cliente)} · ${H.pesos(d.total)}: ${H.esc(GN.textoCarga(k))}.`
    + (d.saldoAnterior ? `<br>Trae saldo anterior de ${H.pesos(d.saldoAnterior)} (total a pagar ${H.pesos(d.totalPagar)}): es lo que quedó sin pagar de boletas anteriores. Suba también esas boletas y el pago se une con todas.` : '')
    + (d.corte ? `<br><b>Aviso de corte${d.corte.desde ? ' desde el ' + H.esc(H.diaTexto(d.corte.desde)) : ' en trámite'}.</b>` : '')
    + (r.avisos.length ? '<br>' + H.esc(r.avisos.join(' ')) : '');
}
// v0.96.0 · Liquidación de sueldo (una por trabajador y mes) o F29 (formulario completo o certificado)
async function subirOtroPdf(f, H, GP, tipo, lineas) {
  const r = tipo === 'liquidacion' ? GP.leerLiquidacion(lineas) : tipo === 'bte' ? GP.leerBTE(lineas) : GP.leerF29(lineas);
  if (r.bloquea) throw new Error(`${tipo === 'f29' ? 'el F29' : tipo === 'bte' ? 'la boleta de terceros' : 'la liquidación'} no se guardó. ${r.errores.join(' ')}`);
  const id = GN.idCarga(tipo), d = tipo === 'liquidacion' ? GP.docDeLiquidacion(r, id) : tipo === 'bte' ? GP.docDeBTE(r, id) : GP.docDeF29(r, id);
  if (tipo === 'bte') { const k = await (await fsGN()).cargarPdf(d, { nombre: f.name, tamano: f.size }, tipo); H.registrar('Gastos: cargó una boleta de terceros', `${d.razon} N° ${d.folio} · ${k.texto}`);
    return `<b>Boleta de terceros N° ${H.esc(d.folio)}</b> · ${H.esc(d.razon)} · honorarios ${H.pesos(r.bruto)} − retención ${H.pesos(r.retencion)} = líquido ${H.pesos(r.liquido)}: ${H.esc(k.texto)}.<br>Se une con la transferencia del líquido; la retención se paga en el F29.`; }
  const k = await (await fsGN()).cargarPdf(d, { nombre: f.name, tamano: f.size }, tipo);
  H.registrar(tipo === 'f29' ? 'Gastos: cargó un F29' : 'Gastos: cargó una liquidación', `${d.tipoTexto} · ${k.texto}`);
  return tipo === 'f29'
    ? `<b>F29 de ${H.esc(GP.textoMes(r.periodo))}</b> (${r.formato === 'certificado' ? 'certificado' : 'formulario completo'}) · total a pagar ${H.pesos(d.total)}: ${H.esc(k.texto)}.`
      + (r.formato === 'certificado' ? '<br>El certificado trae solo el total: si sube el formulario completo, el pago se reparte por impuesto (IVA, PPM, retenciones).' : `<br>${H.esc(GB.textoPartes(d.clasif.partes))}.`)
      + (r.avisos.length ? '<br>' + H.esc(r.avisos.join(' ')) : '')
    : `<b>Liquidación de ${H.esc(d.razon)}</b> · ${H.esc(GP.textoMes(r.periodo))} · líquido ${H.pesos(r.liquido)}${r.anticipos ? ` + anticipos ${H.pesos(r.anticipos)}` : ''}: ${H.esc(k.texto)}.`
      + (r.avisos.length ? '<br>' + H.esc(r.avisos.join(' ')) : '');
}
// v0.97.0 · Previred: el CSV de la nómina o el comprobante de pago (los lectores del Gastos anterior) → el documento del mes
async function subirPrevired(f, H, r) {
  if (r.bloquea) throw new Error(`Previred no se guardó. ${(r.avisos || []).join(' ')}`);
  const [GP, G3D] = await Promise.all([import('./gn-pdf.js?v=0.138.0'), import('./gastos-g3d.js?v=0.138.0')]);
  const id = GN.idCarga('previred'), d = GP.docDePrevired(r, G3D.venceDe(r.periodo), id);
  const k = await (await fsGN()).cargarPdf(d, { nombre: f.name, tamano: f.size }, 'previred');
  H.registrar('Gastos: cargó Previred', `${d.tipoTexto} · ${k.texto}`);
  const faltan = GB.faltanFichasPrevired(d, st.D ? st.D.provs : {}, st.D ? st.D.repartos : {});
  return `<b>${H.esc(d.tipoTexto)}</b> (${r.tipoDoc === 'comprobante' ? 'comprobante de pago' : r.tipoDoc === 'certificado' ? 'certificado' : 'CSV de la nómina'}) · ${d.previred.trabajadores.length} trabajadores · ${H.pesos(d.total)}: ${H.esc(k.texto)}.`
    + (faltan.length ? `<br>Para repartirlo falta el área de: ${H.esc(faltan.join(', '))}. Se toma de la ficha de cada persona (clasifique su liquidación o su boleta una vez).` : '')
    + ((r.avisos || []).length ? '<br>' + H.esc(r.avisos.join(' ')) : '');
}
async function subirSii(f, txt, H) {
  const L = Sii.leer(txt);
  if (!L.facturas.length) throw new Error(L.omitidas && L.omitidas.length ? Sii.textoOmitidas(L.omitidas) + ' El archivo no trae facturas.' : 'no se reconocieron documentos. Revise que sea el XML, el Registro de Compras (.csv) o los Documentos recibidos (.xls) del SII.');
  const k = await (await fsGN()).cargarSii(L, { nombre: f.name, tamano: f.size });
  H.registrar('Gastos: cargó compras del SII', GN.textoCarga(k));
  preciosDeMP(H);   // v0.101.1 · Los precios de las materias primas (Finanzas) se actualizan con estas compras, como antes con el Gastos anterior
  return `<b>Compras del SII</b>${k.desde ? ` (${H.esc(H.diaTexto(k.desde))} al ${H.esc(H.diaTexto(k.hasta))})` : ''}: ${H.esc(GN.textoCarga(k))}.${L.omitidas.length ? '<br>' + H.esc(Sii.textoOmitidas(L.omitidas)) : ''}`;
}
// v0.101.1 · Después de subir compras del SII: Finanzas revisa los precios de las materias primas (sin esperar; nunca falla hacia afuera)
function preciosDeMP(H) {
  import('./finanzas.js?v=0.138.0').then(F => F.preciosTrasImportar()).then(x => {
    if (!x || (!x.error && !(x.aplicadas.length || x.porConfirmar || x.sinAsociar))) return;
    const t = x.error ? `No se pudieron revisar los precios de las materias primas (${H.esc(x.error)}): hágalo en <a href="#finanzas/costos/compras">Finanzas → Costos → Compras del SII</a>.`
      : `Precios de materias primas: ${x.aplicadas.length} ${x.aplicadas.length === 1 ? 'actualizado' : 'actualizados'}${x.porConfirmar ? ` · ${x.porConfirmar} por confirmar` : ''}${x.sinAsociar ? ` · ${x.sinAsociar} ${x.sinAsociar === 1 ? 'producto' : 'productos'} sin asociar` : ''} · <a href="#finanzas/costos/compras">Ver en Finanzas</a>.`;
    st.msg = (st.msg ? st.msg + '<br>' : '') + t;
    const m = document.querySelector('#gn-msg .gn-aviso'); if (m && enGastos()) m.insertAdjacentHTML('beforeend', '<br>' + t);
  }).catch(() => {});
}
async function subirMP(f, txt, H) {
  const L = MP.leer(txt);
  if (L.error) throw new Error(L.error);
  const id = GN.idCarga('mp'), movs = GN.movsDeMP(L, id);
  const k = await (await fsGN()).cargarMovs('mercadopago', movs, { id, archivo: f.name, tamano: f.size, desde: L.desde, hasta: L.hasta, identificador: `Liberaciones ${L.desde} al ${L.hasta}`, saldoFinal: L.saldoFinal });
  // Las ventas con tarjeta (Point) y su comisión real, por día: las sigue leyendo Finanzas (mp_ventas)
  let ventas = ''; const meses = MP.porMes(L.dias || {});
  if (meses.length) { try { await H.Cartola.ventasMP(L.dias, f.name); ventas = `<br>Ventas con tarjeta: ${meses.map(m => `${H.esc(m.mes)} ${H.pesos(m.bruto)}, comisión ${H.pesos(m.comision)}`).join(' · ')}.`; } catch (x) { ventas = `<br>Las ventas con tarjeta no se guardaron (${H.esc(x.message || H.mensajeError(x))}).`; } }
  H.registrar('Gastos: cargó Mercado Pago', GN.textoCarga(k));
  return `<b>Mercado Pago</b> (${H.esc(H.diaTexto(L.desde))} al ${H.esc(H.diaTexto(L.hasta))}): ${H.esc(GN.textoCarga(k))}.${ventas}`;
}
async function subirCartola(f, wb, XLSX, H) {
  const c = H.B2b.leerCartola(wb, XLSX), id = GN.idCarga('be'), movs = GN.movsDeCartola(c, id);
  const k = await (await fsGN()).cargarMovs('bancoestado', movs, { id, archivo: f.name, tamano: f.size, desde: c.desde, hasta: c.hasta, identificador: c.identificador, cuadre: GN.cuadreCartola(c) });
  // Los abonos siguen yendo a Ventas B2B → Conciliación, como siempre
  let ab = '';
  try {
    const conf = await H.B2b.leerConfConciliacion();
    if (conf && conf.importado) { const a = await H.B2b.cargarCartola(c, conf); ab = `<br>Abonos (pagos de clientes): ${a.nuevos} ${a.nuevos === 1 ? 'nuevo' : 'nuevos'} en <a href="#b2b/conciliacion">Ventas a empresas → Conciliación</a>.`; }
    else ab = '<br>Abonos: la conciliación de Ventas a empresas todavía no se empieza.';
  } catch (x) { ab = `<br>Abonos: no se pudieron pasar a Ventas a empresas (${H.esc(x.message || H.mensajeError(x))}).`; }
  H.registrar('Gastos: cargó cartola', `${c.identificador} · ${GN.textoCarga(k)}`);
  return `<b>${H.esc(c.identificador)}</b>: ${H.esc(GN.textoCarga(k))}.${ab}`;
}

// ═══════════════ v0.91.0 · Etapa 2: acciones de la Bandeja ═══════════════
const TXT_COMO = 'Con cargos del banco: el pago está en la cartola o en Mercado Pago (aparecen primero los del mismo monto y fecha cercana). Se pueden marcar varios cargos: pagan el documento en orden de fecha y abajo se ve la suma. Si es de Previred, se marcan solos los cargos del mismo día con glosa de AFP, Fonasa, ISL, mutual, caja o isapre.\nDescontado de las ventas (solo en facturas de comisiones o del arriendo del POS): Mercado Pago, y antes Transbank, los cobra restándolos de lo que deposita, así que la factura no tiene cargo; queda pagada en su fecha, sin banco ni efectivo.\nEn efectivo: excepción; queda con su fecha y cuenta en el informe de pagos en efectivo.\nCon plata del dueño: lo pagó usted con su plata; queda como aporte del dueño, fuera del resultado, y no espera cartola.';
const TXT_NOVA = 'Repetido: el mismo documento ya está (por ejemplo, una factura que se emitió dos veces).\nNo es de la empresa: una compra personal con el RUT de la empresa.\nNo es una compra: un documento que no es gasto.\nNo se borra: queda en Listos con el motivo, y se puede volver a la Bandeja.';
const TXT_NOGASTO = 'Traspaso entre cuentas propias: de una cuenta de la empresa a otra (por ejemplo, de Mercado Pago a BancoEstado).\nRetiro del dueño: plata de la empresa para usted. Va fuera del resultado.\nPago de la tarjeta de crédito: lo que se paga a la tarjeta; las compras ya están en su estado de cuenta.\nNo se borra: se puede volver a la Bandeja.';
const TXT_MANO = 'Para lo que no tiene factura del SII: una boleta en papel o un pago sin documento (por ejemplo, el maestro o la feria). Nace el documento ya pagado con este movimiento.\nEl monto puede ser menor que el movimiento si el mismo pago cubre varias cosas: lo que sobra queda libre.';
const nombreArea = a => (AR.NOMBRE[a] ? `${AR.NOMBRE[a]} (${a})` : a);
function aviso(el, H, txt) { st.msg = txt; st.err = ''; st.D = null; repintar(el, H); }
function falla(dlg, e, H) { const er = dlg.querySelector('[data-err]'); if (er) er.textContent = e.message || H.mensajeError(e); const b = dlg.querySelector('[type=submit]'); if (b) b.disabled = false; }
async function hacer(el, H, fn, ok) {
  if (st.ocupado) return; st.ocupado = true;
  try { await fn(); aviso(el, H, ok); } catch (e) { st.err = H.esc(e.message || H.mensajeError(e)); st.msg = ''; st.D = null; repintar(el, H); }
  finally { st.ocupado = false; }
}
const B = () => st.B;
// Lo sugerido con varias áreas se recuerda como "solo el ítem" (el reparto cambia de una compra a otra); con una sola área, entero
const modoSug = sg => ((sg.areas || []).length > 1 ? 'item' : 'fijo');
const docDe = id => B().docs.find(d => d.id === id), movDe = id => B().movs.find(m => m.id === id);
const nom = d => d.razon || d.rut || 'Sin nombre';

function acciones(el, H) {
  if (el.dataset.gnAcc) return;
  el.dataset.gnAcc = '1';
  el.addEventListener('click', ev => {
    const b = ev.target && ev.target.closest && ev.target.closest('button'); if (!b || !enGastos() || !st.D) return;
    const ds = b.dataset;
    if (ds.gnConfirmar !== undefined) return confirmarPar(el, H, ds.gnConfirmar);
    if (ds.gnConfirmarSeguros !== undefined) return confirmarSeguros(el, H);
    if (ds.gnNoeseste) { const p = parDe(ds.gnNoeseste); if (!p) return; return hacer(el, H, async () => (await fsGN()).descartarPar(p.docIds, p.movId), 'Listo: ese par no se vuelve a proponer. Si después resulta que sí era, elija la factura y el cargo y use Unir.'); }
    if (ds.gnUnir !== undefined) return unirElegidos(el, H);
    if (ds.gnLimpiar !== undefined) { st.sel = { d: [], m: [], primero: '' }; return repintarQuieto(el, H); }
    if (ds.gnComo) return dlgComo(el, H, docDe(ds.gnComo));
    if (ds.gnNova) return dlgNoVa(el, H, docDe(ds.gnNova));
    if (ds.gnClasif) return dlgClasif(el, H, docDe(ds.gnClasif));
    if (ds.gnUsar) { const d = docDe(ds.gnUsar); return hacer(el, H, async () => (await fsGN()).clasificar(d, d.sugerida, modoSug(d.sugerida)), `Clasificado: ${H.esc(nom(d))} → ${H.esc(d.sugerida.item)}. Sus próximas facturas llegan así.`); }
    if (ds.gnUsarTodas !== undefined) return usarTodas(el, H);
    if (ds.gnNc) return dlgNC(el, H, docDe(ds.gnNc));
    if (ds.gnEsde) return dlgEsDe(el, H, movDe(ds.gnEsde));
    if (ds.gnMano) return dlgMano(el, H, movDe(ds.gnMano));
    if (ds.gnTengo) return dlgMano(el, H, movDe(ds.gnTengo), false, 'boleta');
    if (ds.gnSindoc) return dlgMano(el, H, movDe(ds.gnSindoc), true, 'sin');
    if (ds.gnEsrep) return hacer(el, H, async () => (await fsGN()).noEsGasto(ds.gnEsrep, 'otro', 'Repetido: el mismo cargo está en otra cartola'), 'Listo: el cargo repetido quedó como "no es gasto". Está en "que no son gasto" por si hay que volverlo.');
    if (ds.gnDosc) return hacer(el, H, async () => (await fsGN()).noRepetido(ds.gnDosc), 'Listo: son dos compras. Ese cargo no vuelve a avisar.');
    if (ds.gnBuscaef) return buscarPagoEfectivo(el, H, docDe(ds.gnBuscaef));
    if (ds.gnFoto) return dlgFoto(el, H, docDe(ds.gnFoto));
    if (ds.gnResto) { const [t, id] = ds.gnResto.split(':'); return dlgResto(el, H, t, movDe(id)); }
    if (ds.gnNogasto) return dlgNoGasto(el, H, movDe(ds.gnNogasto));
    if (ds.gnNota) { const [t, id] = ds.gnNota.split(':'); return dlgNota(el, H, t, t === 'doc' ? docDe(id) : movDe(id)); }
    if (ds.gnVolverdoc) return hacer(el, H, async () => (await fsGN()).volverDoc(ds.gnVolverdoc), 'El documento volvió a la Bandeja.');
    if (ds.gnVolvermov) return hacer(el, H, async () => (await fsGN()).volverMov(ds.gnVolvermov), 'El movimiento volvió a la Bandeja.');
    if (ds.gnDeshacer) return dlgDeshacer(el, H, ds.gnDeshacer);
    if (ds.gnReparto !== undefined) return dlgReparto(el, H, ds.gnReparto);
    if (ds.gnCompromiso !== undefined) return dlgCompromiso(el, H, ds.gnCompromiso);
    if (ds.gnCredito) return dlgCredito(el, H, ds.gnCredito);
    if (ds.gnTarjeta !== undefined) return dlgTarjeta(el, H);
    if (ds.gnArchivarcp) return hacer(el, H, async () => (await fsGN()).archivarCompromiso(ds.gnArchivarcp, ds.archivar === '1'), ds.archivar === '1' ? 'Compromiso archivado: no crea más meses (lo ya creado sigue).' : 'El compromiso vuelve a crear sus meses.');
    if (ds.gnFicha) return dlgFicha(el, H, ds.gnFicha, ds.razon || '', ds.rut || '');
    if (ds.gnQuitarprod) return hacer(el, H, async () => (await fsGN()).quitarProducto(ds.gnQuitarprod, ds.prod), `Producto olvidado: ${H.esc(ds.prod)}.`);
    if (ds.gnFlete) return dlgFlete(el, H, ds.gnFlete);
    if (ds.gnProv) return dlgProvision(el, H, ds.gnProv);
    if (ds.gnTrab) return dlgTrabajador(el, H, ds.gnTrab, ds.razon || '', ds.rut || '');
    if (ds.gnTrabNuevo !== undefined) return dlgTrabajador(el, H, '', '', '');
    if (ds.gnTermino) return dlgTermino(el, H, ds.gnTermino, ds.razon || '', ds.rut || '');
    if (ds.gnDoctrab) return dlgDocTrab(el, H, ds.gnDoctrab, ds.razon || '', ds.rut || '');
    if (ds.gnDoctrabNova) return dlgDocTrabNoVa(el, H, ds.gnDoctrabNova, ds.id);
    if (ds.gnTrib) return dlgTrib(el, H, ds.tipo, ds.gnTrib, ds.nombre || ds.gnTrib);
    if (ds.gnPrevia !== undefined) return abrirPrevia(el, H);
    if (ds.gnPasar !== undefined) return pasarCatalogo(el, H);
    if (ds.gnPreviaCerrar !== undefined) { st.previa = null; return repintarQuieto(el, H); }
    if (ds.gnItem !== undefined) return dlgItem(el, H, ds.gnItem);
    if (ds.gnArchivaritem) return dlgArchivarItem(el, H, ds.gnArchivaritem);
    if (ds.gnReactivaritem) return hacer(el, H, async () => (await fsGN()).archivarItem(ds.gnReactivaritem, { archivar: false }), 'El ítem vuelve a estar activo.');
    if (ds.gnUbicar) return dlgUbicar(el, H, ds.gnUbicar);
    if (ds.gnConcart) { st.carga = ds.gnConcart; st.verConciliado = !GB.avanceCarga((st.D.cargas || []).find(k => k.id === ds.gnConcart) || {}, GB.armar(st.D).movs).faltan; st.cuenta = ''; st.sel = { d: [], m: [], primero: '' };
      if (subActual()) location.hash = '#gastos'; else { repintar(el, H); requestAnimationFrame(() => { const c = el.querySelector('.gn-cartola'); if (c) c.scrollIntoView({ block: 'start' }); }); } return; }
    if (ds.gnQuitarcarga !== undefined) { st.carga = ''; st.verConciliado = false; return repintarQuieto(el, H); }
    if (ds.gnVerconc !== undefined) { st.verConciliado = ds.gnVerconc === '1'; return repintarQuieto(el, H); }
    if (ds.gnPlantillaCred !== undefined) return descargarPlantillaCred(H);   // v0.124.5
    if (ds.gnMesd !== undefined) { st.mesD = ds.gnMesd; return repintarQuieto(el, H); }   // v0.124.4
    if (ds.gnMesm !== undefined) { st.mesM = ds.gnMesm; return repintarQuieto(el, H); }
    if (ds.gnAcuenta) return dlgACuenta(el, H, movDe(ds.gnAcuenta));
    if (ds.gnAplicar) return aplicarACuenta(el, H, docDe(ds.gnAplicar));
    if (ds.gnOlvidar) return hacer(el, H, async () => (await fsGN()).olvidarSena(ds.gnOlvidar, ds.sena), `Olvidada la glosa "${H.esc(ds.sena)}": ya no cuenta como de ese proveedor.`);
  });
}
const parDe = k => st.B.pares.find(p => p.movId + '|' + p.docIds.join(',') === k);
async function confirmarPar(el, H, k) {
  const p = parDe(k); if (!p) return;
  const docs = p.docIds.map(docDe), partes = GB.repartirPago(docs, p.monto);
  if (!(await asegurarClasif(H, docs))) return;   // v0.92.0: listo = pagado y clasificado
  return hacer(el, H, async () => { await (await fsGN()).pagar({ partes, movId: p.movId }); H.registrar('Gastos: confirmó un pago', `${nom(docs[0])} · ${p.monto}`); }, `Pagado: ${H.esc(nom(docs[0]))}${docs.length > 1 ? ` (${docs.length} documentos)` : ''} · ${H.pesos(p.monto)}.`);
}
async function confirmarSeguros(el, H) {
  const l = st.B.pares.filter(p => p.por !== 'monto' && !p.faltaClasif && !(movDe(p.movId) || {}).anterior);   // v0.96.0: los cargos anteriores se revisan uno a uno
  return hacer(el, H, async () => { const F = await fsGN(); for (const p of l) await F.pagar({ partes: GB.repartirPago(p.docIds.map(docDe), p.monto), movId: p.movId }); H.registrar('Gastos: confirmó pagos', `${l.length} pares con RUT o nombre`); }, `Conciliados ${l.length} pagos con RUT o nombre en la glosa.`);
}
async function usarTodas(el, H) {
  const l = st.B.porClasificar.filter(d => d.sugerida && (d.sugerida.areas || []).length), hechos = new Set();
  return hacer(el, H, async () => { const F = await fsGN(); for (const d of l) { await F.clasificar(d, d.sugerida, hechos.has(GB.claveProveedor(d)) ? false : modoSug(d.sugerida)); hechos.add(GB.claveProveedor(d)); } }, `Clasificados ${l.length} documentos con lo sugerido.`);
}

// ¿Cómo se pagó? (una sola puerta: con cargos del banco, en efectivo, con plata del dueño)
// v0.126.0 · Etapa 3: con cargos del banco se marcan VARIOS (casillas), con la suma en vivo; para Previred se marcan solos los del mismo día
async function dlgComo(el, H, d) {
  if (!(await asegurarClasif(H, [d]))) return;
  const hoy = new Date().toISOString().slice(0, 10), prev = GB.cargosPrevired(d, st.B.abiertosM), prevS = new Set(prev);
  const cand0 = GB.candidatosMov(d, st.B.abiertosM, st.B.S), cand = prev.map(id => cand0.find(x => x.m.id === id)).filter(Boolean).concat(cand0.filter(x => !prevS.has(x.m.id)).slice(0, 40));
  const marcado = (x, i) => (prev.length ? prevS.has(x.m.id) : i === 0 && x.igual && x.dentro);
  const descOk = GB.admiteDescuento(d.clasifEf), medio0 = descOk ? 'descuento' : 'cargo';   // v0.126.4
  const opc = cand.map((x, i) => { const { m, igual, dentro } = x; return `<label class="gn-opc${prevS.has(m.id) ? ' gn-opc-prev' : ''}" data-txt="${H.esc(GN.norm(m.glosa + ' ' + m.monto))}"><input type="checkbox" name="gc-mov" value="${H.esc(m.id)}" ${marcado(x, i) ? 'checked' : ''}><span><b>${H.esc(m.glosa)}</b> <span class="gn-m">${H.pesos(m.libre)}</span><small>${H.esc(GN.CUENTAS[m.cuenta] || m.cuenta)} · ${H.esc(H.diaTexto(m.fecha))}${igual ? ' · mismo monto' : ''}${prevS.has(m.id) ? ' · Previred, mismo día' : ''}${dentro ? '' : ' · fuera de la ventana de fechas'}</small></span></label>`; }).join('');
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>¿Cómo se pagó?</h2>${H.info('Cómo se pagó', TXT_COMO)}</div>
    <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · ${H.pesos(d.saldo)} · ${H.esc(H.diaTexto(d.fecha))}</p>
    <div class="chips" role="radiogroup" aria-label="Medio">${Object.entries(GB.MEDIOS).filter(([k]) => k !== 'descuento' || descOk).map(([k, t]) => `<label class="chip-radio"><input type="radio" name="gc-medio" value="${k}" ${k === medio0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
    ${descOk ? '<p class="ayuda gn-desc-ayuda" data-gc="descuento">Mercado Pago (y antes Transbank) cobra sus comisiones y el arriendo del POS restándolos de lo que deposita: esta factura no tiene un cargo propio. Queda pagada en la fecha que elija, sin banco ni efectivo.</p>' : ''}
    <div data-gc="cargo" class="gn-dlg-bloque"${medio0 === 'cargo' ? '' : ' hidden'}>${prev.length ? `<p class="gn-prev-aviso">Se marcaron solos ${prev.length === 1 ? 'el cargo' : `los ${prev.length} cargos`} del mismo día con glosa de Previred. Revise y desmarque si alguno no va.</p>` : ''}${cand.length ? `<input type="search" data-gn-buscar placeholder="Buscar por glosa o monto" aria-label="Buscar movimiento"><div class="gn-opcs">${opc}</div><div class="gn-suma-c" data-gc-suma role="status" aria-live="polite"></div>` : '<p class="ayuda">No hay movimientos libres. Suba la cartola o use otro medio.</p>'}</div>
    <div data-gc="otro" class="gn-dlg-bloque"${medio0 === 'cargo' ? ' hidden' : ''}><div class="campo"><label for="gc-fecha">Fecha del pago</label><input id="gc-fecha" type="date" value="${H.esc(d.fecha <= hoy ? d.fecha : hoy)}" max="${hoy}"></div></div>
    <div class="campo"><label for="gc-nota">Nota (opcional)</label><input id="gc-nota" maxlength="200"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const medio = () => dlg.querySelector('[name=gc-medio]:checked').value;
  const elegidos = () => Array.from(dlg.querySelectorAll('[name=gc-mov]:checked')).map(x => movDe(x.value)).filter(Boolean);
  const btOk = dlg.querySelector('[type=submit]');
  const pintarSuma = () => { const c = dlg.querySelector('[data-gc-suma]'), l = elegidos();
    if (medio() !== 'cargo') { btOk.textContent = 'Guardar'; return; }
    btOk.textContent = l.length > 1 ? `Unir los ${l.length} cargos` : 'Guardar';
    if (!c) return; const r = GB.sumaCargos(d, l);
    c.className = 'gn-suma-c' + (r.estado ? ' gn-suma-' + r.estado : '');
    c.innerHTML = !l.length ? 'Marque uno o más cargos.' : `Marcados: ${l.length} ${l.length === 1 ? 'cargo' : 'cargos'} · <b>${H.pesos(r.total)}</b> de ${H.pesos(d.saldo)} · <span class="gn-suma-e">${r.estado === 'justo' ? 'justo' : r.estado === 'faltan' ? `faltan ${H.pesos(-r.dif)}: el documento queda pagado en parte` : `sobran ${H.pesos(r.dif)}: quedan libres en el último cargo`}</span>`; };
  dlg.querySelectorAll('[name=gc-medio]').forEach(r => r.addEventListener('change', () => { dlg.querySelector('[data-gc=cargo]').hidden = medio() !== 'cargo'; dlg.querySelector('[data-gc=otro]').hidden = medio() === 'cargo'; const da = dlg.querySelector('p[data-gc=descuento]'); if (da) da.hidden = medio() !== 'descuento'; pintarSuma(); }));
  dlg.querySelectorAll('[name=gc-mov]').forEach(x => x.addEventListener('change', pintarSuma)); pintarSuma();
  buscador(dlg); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const bt = btOk; bt.disabled = true;
    try {
      const nota = dlg.querySelector('#gc-nota').value, F = await fsGN();
      let txtCargos = '';
      if (medio() === 'cargo') {
        const ms = elegidos(); if (!ms.length) throw new Error('Marque el cargo (o los cargos) con que se pagó.');
        if (ms.length === 1) {
          const m = ms[0];
          let dd = d;
          if (d.origen === 'compromiso' && Math.abs(m.libre - d.saldo) > GB.TOLERANCIA) { const aj = await ofrecerAjuste(H, d, m.libre); if (aj === undefined) { bt.disabled = false; return; } if (aj) dd = { ...d, saldo: m.libre }; }
          await F.pagar({ partes: GB.repartirPago([dd], m.libre), movId: m.id, nota });
        } else {
          const pasos = GB.pagosDeVarios(d, ms);
          if (pasos.length < ms.length) throw new Error(`Con ${pasos.length === 1 ? 'el primer cargo' : `los primeros ${pasos.length} cargos`} (por fecha) ya se paga todo el documento: desmarque los que sobran.`);
          for (let k = 0; k < pasos.length; k++) await F.pagar({ ...pasos[k], nota: k === 0 ? nota : '' });
          txtCargos = ` con ${ms.length} cargos`;
        }
      } else {
        const f = dlg.querySelector('#gc-fecha').value; if (!GN.esIso(f)) throw new Error('Elija la fecha del pago.');
        await F.pagar({ partes: [{ docId: d.id, monto: d.saldo }], medio: medio(), fecha: f, nota });
      }
      dlg.close(); H.registrar('Gastos: registró un pago', `${nom(d)} · ${GB.MEDIOS[medio()]}${txtCargos}`); aviso(el, H, `Pagado: ${H.esc(nom(d))} · ${txtCargos ? H.esc(txtCargos.trim()) : H.esc(GB.MEDIOS[medio()].toLowerCase())}.`);
    } catch (e) { bt.disabled = false; falla(dlg, e, H); }
  });
}
function buscador(dlg) {
  const q = dlg.querySelector('[data-gn-buscar]'); if (!q) return;
  // v0.130.2: también busca montos con punto ("55.848") y, sin texto, muestra solo los primeros 60
  const tope = Number(q.dataset.tope) || 0;
  q.addEventListener('input', () => { const t = GN.norm(q.value), dig = q.value.replace(/[^0-9]/g, ''), soloNum = /^[\d\s.$,-]+$/.test(q.value.trim());
    dlg.querySelectorAll('.gn-opc').forEach((o, i) => { const tx = o.dataset.txt || '';
      o.hidden = !t ? (tope > 0 && i >= tope) : !(tx.includes(t) || (soloNum && dig.length >= 3 && tx.replace(/ /g, '').includes(dig))); }); });
}
// Esto no va (un solo botón, tres motivos)
function dlgNoVa(el, H, d) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Esto no va</h2>${H.info('Esto no va', TXT_NOVA)}</div>
    <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · ${H.pesos(d.total)}</p>
    <div class="chips" role="radiogroup" aria-label="Motivo">${Object.entries(GB.MOTIVOS_NO_VA).map(([k, t]) => `<label class="chip-radio"><input type="radio" name="nv-m" value="${k}"><span>${t}</span></label>`).join('')}</div>
    <div class="campo"><label for="nv-nota">Nota (opcional)</label><input id="nv-nota" maxlength="200" placeholder="Por ejemplo: es la misma que la N° 1234"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const r = dlg.querySelector('[name=nv-m]:checked'); if (!r) return falla(dlg, new Error('Elija el motivo.'), H);
    dlg.querySelector('[type=submit]').disabled = true;
    try { await (await fsGN()).noVa(d.id, r.value, dlg.querySelector('#nv-nota').value); dlg.close(); H.registrar('Gastos: esto no va', `${nom(d)} · ${GB.MOTIVOS_NO_VA[r.value]}`); aviso(el, H, `${H.esc(nom(d))}: ${H.esc(GB.MOTIVOS_NO_VA[r.value].toLowerCase())}. Queda en Listos.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// Ítem y reparto por área (lo usan Clasificar y Registrar a mano)
function camposClasif(H, pre, pref, sinItem) {
  const items = st.D.items || [], reps = Object.values(st.D.repartos || {}), rid = (pre && pre.repartoId) || '', areas = rid && st.D.repartos[rid] ? st.D.repartos[rid].areas : (pre && pre.areas) || [];
  return `${sinItem ? '' : `<div class="campo"><label for="${pref}-item">Ítem</label><input id="${pref}-item" list="${pref}-items" value="${H.esc((pre && pre.item) || '')}" autocomplete="off" placeholder="Escriba o elija"><datalist id="${pref}-items">${items.map(i => `<option value="${H.esc(i.item)}"${i.grupo ? ` label="${H.esc(i.grupo)}"` : ''}>`).join('')}</datalist></div>`}
    ${reps.length ? `<div class="campo"><label for="${pref}-reparto">Reparto</label><select id="${pref}-reparto" data-reparto><option value="">Elegir las áreas a mano</option>${reps.map(r => `<option value="${H.esc(r.id)}" ${r.id === rid ? 'selected' : ''}>${H.esc(r.nombre)} · ${H.esc(GB.textoReparto(r.areas))}</option>`).join('')}</select></div>` : ''}
    <fieldset class="campo"><legend>Área</legend><div class="chips" data-areas>${AR.GASTO_GN.map(a => `<label class="chip-radio"><input type="checkbox" value="${a}" ${areas.some(x => x.area === a) ? 'checked' : ''}><span>${H.esc(nombreArea(a))}</span></label>`).join('')}</div>
      <div class="gn-pcts" data-pcts></div><span class="ayuda">Con varias áreas, el reparto en %. Debe sumar 100.</span></fieldset>`;
}
function conectarClasif(dlg, H, pre, pref) {
  const items = st.D.items || [], pcts = dlg.querySelector('[data-pcts]'), prev = {}, rsel = dlg.querySelector('[data-reparto]');
  const rid0 = (pre && pre.repartoId) || '', ar0 = rid0 && st.D.repartos[rid0] ? st.D.repartos[rid0].areas : (pre && pre.areas) || [];
  ar0.forEach(a => { prev[a.area] = a.pct; });
  const elegidas = () => Array.from(dlg.querySelectorAll('[data-areas] input:checked')).map(x => x.value);
  const dibujar = () => { const l = elegidas(), ig = GB.repartoIgual(l); pcts.innerHTML = l.length > 1 ? l.map((a, i) => `<label class="gn-pct"><span>${H.esc(a)}</span><input type="text" data-decimal autocomplete="off" min="0.01" max="100" step="0.01" data-pct="${a}" value="${prev[a] != null && l.length === Object.keys(prev).length ? prev[a] : ig[i].pct}" inputmode="decimal"><span>%</span></label>`).join('') : ''; };
  // v0.96.0 · Elegir un reparto marca sus áreas y porcentajes; tocar las áreas a mano lo deja en "a mano"
  dlg.querySelectorAll('[data-areas] input').forEach(x => x.addEventListener('change', () => { if (rsel) rsel.value = ''; dibujar(); })); dibujar();
  if (rsel) rsel.addEventListener('change', () => { const r = st.D.repartos[rsel.value]; if (!r) return; Object.keys(prev).forEach(k => delete prev[k]); r.areas.forEach(a => { prev[a.area] = a.pct; });
    dlg.querySelectorAll('[data-areas] input').forEach(x => { x.checked = r.areas.some(a => a.area === x.value); }); dibujar(); dlg.dispatchEvent(new Event('change')); });
  const it = dlg.querySelector(`#${pref}-item`);
  if (it) it.addEventListener('change', () => { const i = items.find(x => x.item === it.value); if (i && AR.GASTO_GN.includes(i.area) && !elegidas().length) { const c = dlg.querySelector(`[data-areas] input[value="${i.area}"]`); if (c) { c.checked = true; dibujar(); } } });
  return () => { const l = elegidas(); return { item: it ? it.value.trim() : '', repartoId: rsel ? rsel.value : '', areas: l.length === 1 ? [{ area: l[0], pct: 100 }] : l.map(a => ({ area: a, pct: Number((dlg.querySelector(`[data-pct="${a}"]`) || {}).value) || 0 })) }; };
}
function dlgClasif(el, H, d) {
  pedirClasif(H, d).then(r => { if (r) aviso(el, H, `Clasificado: ${H.esc(nom(d))} → ${H.esc(GB.textoPartes(r.partes))}.`); });
}
// v0.92.0 · Antes de pagar: cada documento clasificado. Abre la clasificación de los que faltan (uno por proveedor: si se recuerda,
// los demás del mismo proveedor quedan clasificados). → true si quedaron todos; false si se canceló.
async function asegurarClasif(H, docs) {
  const hechos = new Set();
  for (const d of docs) {
    if (!d || d.clasifEf || GB.sinEfecto(d) || hechos.has(GB.claveProveedor(d))) continue;   // v0.102.0: la deuda anterior no se clasifica
    const r = await pedirClasif(H, d, true); if (!r) return false;
    if (r.recordar === 'fijo') hechos.add(GB.claveProveedor(d));   // en "solo el ítem", las otras facturas del proveedor piden su área
  }
  return true;
}
// La clasificación de un documento: toda la factura (ítem y áreas en %) o separada por líneas (con detalle) o por montos (sin detalle).
// → Promise: { partes, recordar } al guardar, o null si se cancela.
function pedirClasif(H, d, antesDePagar) {
  return new Promise(resolve => {
    const base = GB.baseDe(d), det = d.detalle || [], conLineas = det.length >= 2, c0 = d.clasifEf || null, sug = d.sugerida && (d.sugerida.areas || []).length ? d.sugerida : null;
    const prov = GB.provDe(d, st.D.provs || {}), prods = (prov && prov.productos) || {};
    const pre = c0 ? { item: c0.item, repartoId: c0.repartoId || '', areas: c0.areas && c0.areas.length ? c0.areas : [] } : d.soloItem ? { item: d.soloItem, areas: [] } : sug;
    const modo0 = prov ? GB.modoProveedor(prov) : '';
    const lineasPrev = c0 && c0.lineas && c0.lineas.length === det.length ? c0.lineas : null;
    const empezarSeparado = !!(lineasPrev || (conLineas && det.some(x => prods[GB.normProducto(x.descripcion)])) || (c0 && new Set((c0.partes || []).map(p => p.item)).size > 1));
    const items = st.D.items || [], repsL = Object.values(st.D.repartos || {}), areaSel = (v, k) => `<select data-${k} aria-label="Área"><option value="">Área</option>${k === 'la' && repsL.length ? `<optgroup label="Repartos">${repsL.map(r => `<option value="${GB.AREA_REPARTO}${H.esc(r.id)}" ${GB.AREA_REPARTO + r.id === v ? 'selected' : ''}>${H.esc(r.nombre)}</option>`).join('')}</optgroup><optgroup label="Un área">` : ''}${AR.GASTO_GN.map(a => `<option value="${a}" ${a === v ? 'selected' : ''}>${H.esc(a)}</option>`).join('')}${k === 'la' && repsL.length ? '</optgroup>' : ''}</select>`;
    const itemInp = (v, k) => `<input data-${k} list="cl-items" value="${H.esc(v || '')}" placeholder="Ítem" aria-label="Ítem" autocomplete="off">`;
    let idx = 0; const filaMonto = (x = {}) => `<div class="gn-sep-fila" data-parte="${idx++}"><input type="number" data-pm value="${x.monto || ''}" placeholder="Monto" aria-label="Monto" inputmode="numeric">${itemInp(x.item, 'pi')}${areaSel(x.area, 'pa')}<button type="button" class="gn-link" data-quitar>Quitar</button></div>`;
    const dlg = H.dialogo(`<form class="form-dialogo gn-dlg-ancho" novalidate><div class="titulo-fila"><h2>${antesDePagar ? 'Clasificar antes de conciliar' : 'Clasificar'}</h2>${H.info('Clasificar', TXT_CLASIF)}</div>
      <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · ${d.origen === 'boleta' ? 'total (sin crédito de IVA)' : 'neto'} ${H.pesos(base)}${sug && !c0 ? `<br>Sugerido por el Gastos anterior: ${H.esc(sug.item)} · ${H.esc(GB.textoReparto(sug.areas))}` : ''}</p>
      ${det.length ? `<div class="gn-det-dlg"><b>${d.origen === 'boleta' ? 'Detalle de la boleta (PDF)' : 'Detalle de la factura (XML)'}</b><ul>${det.map(x => `<li><span>${H.esc(x.descripcion)}${x.cantidad ? ` · ${H.esc(String(x.cantidad).replace('.', ','))}${x.unidad ? ' ' + H.esc(x.unidad) : ''}` : ''}</span><span class="gn-m">${H.pesos(x.monto)}</span></li>`).join('')}</ul></div>`
        : `<p class="ayuda gn-sin-det">${d.formato === 'registro' ? 'Esta factura vino del Registro de Compras (RCV): no trae el detalle. Si tiene su XML, arrástrelo a Gastos y se completa solo.' : 'Esta factura no trae detalle.'}</p>`}
      ${camposClasif(H, pre, 'cl')}
      <label class="gn-check"><input type="checkbox" id="cl-sep" ${empezarSeparado ? 'checked' : ''}> ${conLineas ? 'La factura trae cosas distintas: separar por líneas' : 'Separar en partes (por montos)'}</label>
      <div data-sep hidden>
        ${conLineas ? `<div class="gn-lineas">${det.map((x, i) => { const pr = (lineasPrev && lineasPrev[i]) || prods[GB.normProducto(x.descripcion)] || {};
          return `<div class="gn-sep-fila" data-linea="${i}"><span class="gn-lin-desc">${H.esc(x.descripcion)}<small>${x.cantidad ? H.esc(String(x.cantidad).replace('.', ',')) + (x.unidad ? ' ' + H.esc(x.unidad) : '') + ' · ' : ''}${H.pesos(x.monto)}</small></span>${itemInp(pr.item, 'li')}${areaSel(pr.area, 'la')}</div>`; }).join('')}</div>
          <p class="ayuda">Las líneas vacías toman lo de arriba (toda la factura).</p>`
        : `<div class="gn-montos" data-montos>${(c0 && (c0.partes || []).length > 1 ? c0.partes : [{}, {}]).map(filaMonto).join('')}</div><p><button type="button" class="btn-sec btn-chico" data-agregar>Agregar parte</button></p>`}
        <p class="ayuda" data-resumen></p>
      </div>
      <fieldset class="campo gn-recordar"><legend>Para las próximas facturas de este proveedor</legend>
        <label class="gn-opc"><input type="radio" name="cl-rec" value="fijo" ${modo0 !== 'item' ? 'checked' : ''}><span><b>Recordar ítem y áreas</b><small>Siempre se reparte igual (luz, agua, arriendo, o un proveedor de una sola área). La próxima factura llega clasificada.</small></span></label>
        <label class="gn-opc"><input type="radio" name="cl-rec" value="item" ${modo0 === 'item' ? 'checked' : ''}><span><b>Recordar solo el ítem</b><small>Las áreas cambian en cada compra. La próxima factura llega con el ítem y pide el área.</small></span></label>
        <label class="gn-opc"><input type="radio" name="cl-rec" value="no"><span><b>No recordar</b><small>Fue una compra excepcional.</small></span></label>
      </fieldset>
      <p class="error" data-err role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">${antesDePagar ? 'Guardar y seguir' : 'Guardar'}</button></div></form>`);
    let listo = false; dlg.addEventListener('close', () => { if (!listo) resolve(null); });
    const leerGen = conectarClasif(dlg, H, pre, 'cl'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    const sep = dlg.querySelector('#cl-sep'), caja = dlg.querySelector('[data-sep]'), resumen = dlg.querySelector('[data-resumen]');
    const generalPrimera = () => { const g = leerGen(); return { item: g.item, area: (g.areas[0] || {}).area || '' }; };
    const armar = () => {
      const g = leerGen();
      if (!sep.checked) return { general: g, partes: GB.partesSimple(base, g.item, g.areas), lineas: null };
      if (conLineas) {
        const asign = det.map((x, i) => { const f = dlg.querySelector(`[data-linea="${i}"]`), la = f.querySelector('[data-la]').value;   // v0.96.0: la línea vacía toma las áreas (o el reparto) de toda la factura
          // vacía: un área → esa; un reparto → el reparto (así se recuerda); varias áreas a mano → esas, en %
          const gArea = g.repartoId && st.D.repartos[g.repartoId] ? GB.AREA_REPARTO + g.repartoId : g.areas.length === 1 ? g.areas[0].area : '';
          return { item: f.querySelector('[data-li]').value.trim() || g.item, ...(la || gArea ? { area: la || gArea } : { area: '', areas: g.areas }) }; });
        return { general: g, separado: true, partes: GB.partesPorLineas(d, asign, st.D.repartos), lineas: det.map((x, i) => ({ descripcion: x.descripcion, ...asign[i] })) };
      }
      const partes = Array.from(dlg.querySelectorAll('[data-parte]')).map(f => ({ monto: Math.round(Number(f.querySelector('[data-pm]').value) || 0), item: f.querySelector('[data-pi]').value.trim(), area: f.querySelector('[data-pa]').value })).filter(x => x.monto);
      return { general: g, separado: true, partes, lineas: null };
    };
    const pintarResumen = () => { if (!sep.checked) return; const a = armar(), t = a.partes.reduce((x, p) => x + p.monto, 0); resumen.textContent = a.partes.length ? `${GB.textoPartes(a.partes)} · suma ${H.pesos(t)} de ${H.pesos(base)}${t !== base ? ` · ${t < base ? 'falta' : 'sobra'} ${H.pesos(Math.abs(base - t))}` : ''}` : ''; };
    const fsAreas = dlg.querySelector('[data-areas]').closest('fieldset');
    const notaGen = document.createElement('p'); notaGen.className = 'ayuda gn-nota-gen'; notaGen.textContent = 'Con la factura separada, esto es opcional: solo se usa para las líneas que deje vacías.'; fsAreas.appendChild(notaGen);
    const mostrar = () => { caja.hidden = !sep.checked; fsAreas.classList.toggle('gn-gris', sep.checked); notaGen.hidden = !sep.checked; pintarResumen(); };
    // Sin ficha del proveedor: si la factura va a más de un área, lo más probable es que cambie en cada compra → "solo el ítem" (si no lo tocó)
    let tocoRec = !!modo0; dlg.querySelectorAll('[name=cl-rec]').forEach(r => r.addEventListener('change', () => { tocoRec = true; }));
    const proponerRec = () => { if (tocoRec) return; const a = armar(), n = new Set(a.partes.map(p => p.area)).size, fijo = n <= 1 || (!a.separado && a.general.repartoId) || !!(a.lineas && a.lineas.length);   // por líneas: cada producto recuerda su área   // un reparto con nombre es una regla fija
      dlg.querySelector(`[name=cl-rec][value="${fijo ? 'fijo' : 'item'}"]`).checked = true; };
    dlg.addEventListener('change', ev => { if (!ev.target.matches('[name=cl-rec]')) proponerRec(); });
    sep.addEventListener('change', mostrar); mostrar();
    dlg.addEventListener('input', pintarResumen); dlg.addEventListener('change', pintarResumen);
    const ag = dlg.querySelector('[data-agregar]'); if (ag) ag.onclick = () => { dlg.querySelector('[data-montos]').insertAdjacentHTML('beforeend', filaMonto()); };
    dlg.addEventListener('click', ev => { const q = ev.target.closest && ev.target.closest('[data-quitar]'); if (q) { q.closest('[data-parte]').remove(); pintarResumen(); } });
    dlg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
      try {
        const a = conItemsValidos(armar(), ['f29', 'previred', 'credito'].includes(d.origen) || (d.clasif && d.clasif.de === 'sistema') || !!(d.ajuste && d.ajuste.recargo)), rv = dlg.querySelector('[name=cl-rec]:checked').value, rec = rv === 'no' ? false : rv;
        await (await fsGN()).clasificar(d, a, rec);
        listo = true; dlg.close(); st.D = null; H.registrar('Gastos: clasificó', `${nom(d)} · ${GB.textoPartes(a.partes)}`);
        resolve({ partes: a.partes, recordar: rec });
      } catch (e) { falla(dlg, e, H); }
    });
  });
}
// Una nota de crédito se descuenta de su factura (la que cita, si está)
function dlgNC(el, H, nc) {
  const ref = (nc.referencias || []).map(r => r.folio), facs = st.B.abiertosD.concat(st.B.anteriores).filter(d => !d.nc && d.rutN === nc.rutN && d.saldo > 0).filter((d, i, a) => a.findIndex(x => x.id === d.id) === i)
    .sort((a, b) => (ref.includes(b.folio) - ref.includes(a.folio)) || b.fecha.localeCompare(a.fecha));
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Descontar de su factura</h2></div>
    <p class="ayuda"><b>${H.esc(nom(nc))}</b> · Nota de crédito ${H.esc(nc.folio)} · ${H.pesos(nc.saldo)}${ref.length ? ` · corrige la N° ${H.esc(ref.join(', '))}` : ''}</p>
    ${facs.length ? `<div class="gn-opcs">${facs.map((f, i) => `<label class="gn-opc"><input type="radio" name="nc-f" value="${H.esc(f.id)}" ${i === 0 ? 'checked' : ''}><span><b>Factura N° ${H.esc(f.folio)}</b> <span class="gn-m">${H.pesos(f.saldo)}</span><small>${H.esc(H.diaTexto(f.fecha))}${ref.includes(f.folio) ? ' · la que cita' : ''}${f.anterior ? ' · deuda anterior' : ''}</small></span></label>`).join('')}</div>` : '<p class="ayuda">No hay facturas abiertas de este proveedor. Si su factura ya se pagó, marque la nota como "Esto no va" con una nota, o espere la devolución.</p>'}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button>${facs.length ? '<button type="submit" class="btn">Descontar</button>' : ''}</div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const r = dlg.querySelector('[name=nc-f]:checked'); if (!r) return; dlg.querySelector('[type=submit]').disabled = true;
    try { const f = facs.find(x => x.id === r.value), m = Math.max(nc.saldo, -f.saldo);
      if (!(await asegurarClasif(H, [f, nc]))) { dlg.querySelector('[type=submit]').disabled = false; return; }
      await (await fsGN()).pagar({ partes: [{ docId: nc.id, monto: m }, { docId: f.id, monto: -m }], medio: 'nc', fecha: nc.fecha }); dlg.close(); aviso(el, H, `Nota de crédito ${H.esc(nc.folio)} descontada de la factura N° ${H.esc(f.folio)}.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// Es de este documento (desde un movimiento): uno o varios documentos, también de la deuda anterior
function dlgEsDe(el, H, m) {
  const abiertos = st.B.abiertosD.filter((d, i, a) => a.findIndex(x => x.id === d.id) === i), cand = GB.candidatosDoc(m, abiertos, st.B.S);
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Buscar su documento</h2></div>
    <p class="ayuda"><b>${H.esc(m.glosa)}</b> · ${H.pesos(m.libre)} · ${H.esc(GN.CUENTAS[m.cuenta] || m.cuenta)} · ${H.esc(H.diaTexto(m.fecha))}</p>
    ${cand.length ? `<input type="search" data-gn-buscar data-tope="60" placeholder="Buscar proveedor, folio o monto" aria-label="Buscar documento"><div class="gn-opcs">${cand.map(({ d, igual, dentro }, i) => `<label class="gn-opc"${i >= 60 ? ' hidden' : ''} data-txt="${H.esc(GN.norm(nom(d) + ' ' + d.folio + ' ' + d.saldo + ' ' + d.rut))}"><input type="checkbox" value="${H.esc(d.id)}"><span><b>${H.esc(nom(d))}</b> <span class="gn-m">${H.pesos(d.saldo)}</span><small>${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · ${H.esc(H.diaTexto(d.fecha))}${igual ? ' · mismo monto' : ''}${d.anterior ? ' · deuda anterior' : ''}${dentro ? '' : ' · fuera de la ventana de fechas'}</small></span></label>`).join('')}</div>
      <p class="ayuda" data-suma></p>` : '<p class="ayuda">No hay documentos sin pago. Si tiene la boleta, use "Tengo la boleta"; si no hay boleta posible, "Sin documento".</p>'}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button>${cand.length ? '<button type="submit" class="btn">Conciliar</button>' : ''}</div></form>`);
  buscador(dlg); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  const elegidos = () => Array.from(dlg.querySelectorAll('.gn-opc input:checked')).map(x => abiertos.find(d => d.id === x.value));
  const suma = dlg.querySelector('[data-suma]');
  dlg.querySelectorAll('.gn-opc input').forEach(x => x.addEventListener('change', () => { const l = elegidos(), t = l.reduce((a, d) => a + d.saldo, 0); suma.textContent = l.length ? `Elegidos: ${l.length} · ${H.pesos(t)} de ${H.pesos(m.libre)}${t > m.libre ? ' · el último queda pagado en parte' : t < m.libre ? ' · sobra ' + H.pesos(m.libre - t) + ', queda libre' : ' · justo'}` : ''; }));
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const l = elegidos(); if (!l.length) return falla(dlg, new Error('Elija al menos un documento.'), H);
    dlg.querySelector('[type=submit]').disabled = true;
    try { if (!(await asegurarClasif(H, l))) { dlg.querySelector('[type=submit]').disabled = false; return; }
      await (await fsGN()).pagar({ partes: GB.repartirPago(l, m.libre), movId: m.id }); dlg.close(); aviso(el, H, `Unido: ${H.esc(m.glosa)} con ${l.length === 1 ? H.esc(nom(l[0])) : l.length + ' documentos'}.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// v0.126.0 · Etapa 3 · Resto de un cargo como intereses o multa, o comisión del banco: un gasto sin documento, ya pagado con ese resto.
// El ítem se propone (crédito → INTERESES DE CREDITO; si no, MULTAS E INTERESES; comisión → COMISIONES BANCARIAS) y el área es ADMIN; se pueden cambiar.
const TXT_RESTO_GN = 'Lo que queda libre de un cargo que ya pagó su documento (por ejemplo, una cuota de crédito con intereses de atraso, o una comisión que el banco sumó al cargo).\nSe registra como un gasto sin documento, con la fecha del cargo y pagado con ese resto: el cargo queda conciliado entero y deja de frenar el cierre.\nEl ítem se propone: si el cargo pagaba un crédito, INTERESES DE CREDITO; si no, MULTAS E INTERESES; la comisión va a COMISIONES BANCARIAS. El área propuesta es ADMIN: en el estado de resultados el gasto financiero va como gasto común, debajo de las áreas.\nSi todavía no sabe qué es, use "Esperar (dejar nota)".';
function dlgResto(el, H, tipo, m) {
  if (!m) return;
  const docs = (m.pagosM || []).map(p => docDe(p.docId)).filter(Boolean), item = GB.itemResto(tipo, m, docs), prov = docs[0] ? nom(docs[0]) : m.glosa;
  const titulo = tipo === 'comision' ? 'Comisión del banco' : 'Intereses o multa';
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${titulo}</h2>${H.info(titulo, TXT_RESTO_GN)}</div>
    <p class="ayuda">Resto de <b>${H.esc(m.glosa)}</b> ${H.pesos(m.monto)} · ${H.esc(H.diaTexto(m.fecha))}: <b>${H.pesos(m.libre)}</b></p>
    <div class="campo"><label for="rs-prov">A quién</label><input id="rs-prov" maxlength="120" value="${H.esc(prov)}"></div>
    ${camposClasif(H, { item, areas: [{ area: GB.AREA_RESTO, pct: 100 }] }, 'rs')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Registrar ${H.pesos(m.libre)}</button></div></form>`);
  const leer = conectarClasif(dlg, H, { item, areas: [{ area: GB.AREA_RESTO, pct: 100 }] }, 'rs'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const bt = dlg.querySelector('[type=submit]'); bt.disabled = true;
    try { const c = leer(); c.item = itemValido(c.item, true); const quien = dlg.querySelector('#rs-prov').value.trim() || m.glosa;
      await (await fsGN()).registrarAMano(m, { tipo: 'sin', proveedor: quien, rut: '', folio: '', monto: m.libre, nota: `${titulo.toLowerCase()} · resto del cargo`, item: c.item, areas: c.areas, recordar: false });
      dlg.close(); H.registrar('Gastos: registró un resto', `${m.glosa} · ${m.libre} · ${c.item}`); aviso(el, H, `Registrado: ${H.pesos(m.libre)} como ${H.esc(c.item)}. El cargo quedó conciliado entero.`); }
    catch (e) { bt.disabled = false; falla(dlg, e, H); }
  });
}
// ═══ v0.126.2 · La foto de la boleta en papel (pedido por Emmanuel el 11 nov): se sube a Drive por el mismo camino que los
// comprobantes y los documentos del trabajador, con un nombre que se arma solo, y queda en el documento (foto: { url, nombre }).
const TXT_FOTO = 'La boleta de papel se borra con los meses: la foto es el respaldo que queda. Se sube a Drive (la carpeta de los comprobantes de Gastos) con un nombre que se arma solo: fecha · a quién · monto.\nEn el celular puede sacarla con la cámara; en el computador, elija la foto o el PDF (hasta 10 MB).\nSi no la tiene ahora, regístrela igual: después, en Listos, la boleta dice "Sin foto" y tiene "Agregar foto".\nEl original en papel guárdelo igual, en el sobre del mes.';
const campoFotoHtml = (H, pref) => `<div class="campo gn-foto"><label for="${pref}-foto">Foto de la boleta (opcional) ${H.info('Foto de la boleta', TXT_FOTO)}</label><input id="${pref}-foto" type="file" accept="image/*,application/pdf"><span class="ayuda">En el celular puede sacarla con la cámara.</span></div>`;
const nombreFoto = (fecha, razon, monto) => `${fecha} · ${String(razon || 'Boleta').trim()} · ${Math.round(Number(monto) || 0).toLocaleString('es-CL')}`.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 110);
// Sube la foto elegida en el campo (si hay) → { url, nombre } o null. bt: el botón, que dice "Subiendo la foto…" mientras tanto
async function subirFotoDe(dlg, pref, { fecha, razon, monto }, bt) {
  const inp = dlg.querySelector(`#${pref}-foto`), f = inp && inp.files && inp.files[0]; if (!f) return null;
  if (f.size > MAX_ARCHIVO) throw new Error('La foto pesa más de 10 MB: sáquela con menos calidad o elija otra.');
  if (!/^application\/pdf$|^image\//.test(f.type || '')) throw new Error('Sirve una foto o un PDF.');
  const txt = bt ? bt.textContent : ''; if (bt) bt.textContent = 'Subiendo la foto…';
  try {
    const G = await import('./gastos.js?v=0.138.0'), b64 = await G.aBase64(f);
    const ext = (f.name.match(/\.[A-Za-z0-9]{2,5}$/) || [f.type === 'application/pdf' ? '.pdf' : '.jpg'])[0], nombre = nombreFoto(fecha, razon, monto) + ext;
    const r = await G.subidor()({ tipo: 'comprobante', fecha: String(fecha || isoHoy()).split('-').reverse().join('-'), imageData: b64, mimeType: f.type, fileName: nombre });
    if (!r || !r.url) throw new Error('Drive no devolvió el enlace de la foto. Intente de nuevo (o registre sin foto y agréguela después).');
    return { url: r.url, nombre };
  } finally { if (bt) bt.textContent = txt; }
}
// "Agregar foto" (o cambiarla) en una boleta ya registrada
function dlgFoto(el, H, d) {
  if (!d) return;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${d.foto ? 'Cambiar la foto' : 'Agregar foto'}</h2>${H.info('Foto de la boleta', TXT_FOTO)}</div>
    <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto || 'Boleta')}${d.folio ? ' N° ' + H.esc(d.folio) : ''} · ${H.pesos(d.total)} · ${H.esc(H.diaTexto(d.fecha))}</p>
    ${campoFotoHtml(H, 'af')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Subir</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const bt = dlg.querySelector('[type=submit]'); bt.disabled = true;
    try { const f = await subirFotoDe(dlg, 'af', { fecha: d.fecha, razon: nom(d), monto: d.total }, bt); if (!f) throw new Error('Elija la foto.');
      await (await fsGN()).agregarFoto(d.id, f); dlg.close(); H.registrar('Gastos: agregó la foto de una boleta', `${nom(d)} · ${d.total}`); aviso(el, H, `Foto guardada: ${H.esc(nom(d))} · ${H.pesos(d.total)}.`); }
    catch (e) { bt.disabled = false; falla(dlg, e, H); }
  });
}
// Registrar a mano: boleta en papel o pago sin documento
// v0.135.0 · Desde el cargo: modo 'boleta' ("Tengo la boleta (foto)") o 'sin' ("Sin documento"); sin modo, el diálogo de antes
const TXT_TENGO = 'La boleta de este cargo no estaba anotada: se anota aquí con su foto y queda unida al cargo (pagada).\nSi ya la anotó con + Boleta, no la anote de nuevo: use "Buscar su documento".';
const TXT_SINDOC_M = 'Para lo que no tiene boleta posible: comisión, interés o impuesto del banco, una cuota. Queda como gasto "Sin documento", pagado con este cargo.\nSi el cargo es una compra con boleta, use "Tengo la boleta".';
function dlgMano(el, H, m, sinPreguntar, modo = '') {
  // v0.130.0 · Si hay una boleta anotada esperando un cargo de este monto, primero se pregunta (para no registrarla dos veces)
  const esp = !sinPreguntar && (st.B || GB.armar(st.D, {})).abiertosD.filter(d => d.anotada && d.saldo === m.libre && GB.enVentana(d.fecha, m.fecha));
  if (esp && esp.length) return preguntarBoleta(el, H, m, esp, modo);
  const provs = Object.values(st.D.provs || {}), sin = modo === 'sin';
  const titulo = modo === 'boleta' ? 'Tengo la boleta' : sin ? 'Sin documento' : 'Registrar a mano', txt = modo === 'boleta' ? TXT_TENGO : sin ? TXT_SINDOC_M : TXT_MANO;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${titulo}</h2>${H.info(titulo, txt)}</div>
    <p class="ayuda"><b>${H.esc(m.glosa)}</b> · ${H.pesos(m.libre)} · ${H.esc(H.diaTexto(m.fecha))}</p>
    ${modo ? `<input type="hidden" name="am-t" value="${sin ? 'sin' : 'boleta'}">` : `<div class="chips" role="radiogroup" aria-label="Documento"><label class="chip-radio"><input type="radio" name="am-t" value="boleta" checked><span>Boleta en papel</span></label><label class="chip-radio"><input type="radio" name="am-t" value="sin"><span>Sin documento</span></label></div>`}
    <div class="campo"><label for="am-prov">${sin ? 'A quién se le pagó (el banco, la institución)' : modo === 'boleta' ? 'Dónde compró' : 'A quién se le pagó'}</label><input id="am-prov" list="am-provs" maxlength="120" autocomplete="off"><datalist id="am-provs">${provs.map(p => `<option value="${H.esc(p.razon)}">`).join('')}</datalist></div>
    <div class="gn-dos"><div class="campo"><label for="am-rut">RUT (opcional)</label><input id="am-rut" maxlength="14"></div>${sin ? '' : '<div class="campo"><label for="am-folio">N° de boleta (opcional)</label><input id="am-folio" maxlength="30"></div>'}</div>
    <div class="campo"><label for="am-monto">Monto</label><input id="am-monto" type="number" min="1" max="${m.libre}" value="${m.libre}" inputmode="numeric"></div>
    <div class="campo"><label for="am-nota">${sin ? 'Qué es (opcional)' : 'Qué se compró (opcional)'}</label><input id="am-nota" maxlength="120"></div>
    ${sin ? '' : campoFotoHtml(H, 'am')}
    ${camposClasif(H, null, 'am')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Registrar</button></div></form>`);
  const leer = conectarClasif(dlg, H, null, 'am'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  const prov = dlg.querySelector('#am-prov');
  prov.addEventListener('change', () => { const p = provs.find(x => x.razon === prov.value); if (!p) return; if (p.rut) dlg.querySelector('#am-rut').value = p.rut; dlg.querySelector('#am-item').value = p.item || '';
    dlg.querySelectorAll('[data-areas] input').forEach(x => { x.checked = (p.areas || []).some(a => a.area === x.value); }); dlg.querySelector('[data-areas] input').dispatchEvent(new Event('change')); });
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const c = leer(); c.item = itemValido(c.item);
      const foto = sin ? null : await subirFotoDe(dlg, 'am', { fecha: m.fecha, razon: prov.value, monto: dlg.querySelector('#am-monto').value }, dlg.querySelector('[type=submit]'));
      const tipoEl = dlg.querySelector('[name=am-t]:checked') || dlg.querySelector('[name=am-t]'), folioEl = dlg.querySelector('#am-folio');
      await (await fsGN()).registrarAMano(m, { tipo: tipoEl.value, proveedor: prov.value, rut: dlg.querySelector('#am-rut').value, folio: folioEl ? folioEl.value : '',
        monto: dlg.querySelector('#am-monto').value, nota: dlg.querySelector('#am-nota').value, item: c.item, areas: c.areas, foto });
      dlg.close(); H.registrar(sin ? 'Gastos: cargo sin documento' : 'Gastos: registró a mano', `${prov.value} · ${m.libre}`); aviso(el, H, `Registrado: ${H.esc(prov.value)} · ${H.esc(c.item)}, pagado con ${H.esc(m.glosa)}.${sin ? '' : ' La próxima vez, este comercio se reconoce en la cartola.'}`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// ═══════════════ v0.130.0 · Anotar boleta (boceto "Anotar boleta" aprobado el 13 nov) ═══════════════
// La cámara se abre en el mismo toque (el navegador lo exige); después se completa monto, cómo pagó y, si se sabe, ítem y área.
export function tomarFotoBoleta(alElegir) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); inp.style.display = 'none';
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) alElegir(f); });
  document.body.appendChild(inp); inp.click();
}
// La foto, achicada (lado mayor 1600 px, JPEG): sube más rápido desde el celular. Si no se puede, va la original.
async function achicar(f) {
  if (!/^image\//.test(f.type || '') || f.size < 600 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82)); return b && b.size < f.size ? new File([b], 'boleta.jpg', { type: 'image/jpeg' }) : f;
  } catch (e) { return f; }
}
const MEDIOS_BOLETA = [['debito', 'Débito o transferencia'], ['credito', 'Tarjeta de crédito'], ['efectivo', 'Efectivo'], ['personal', 'Mi plata']];
// v0.134.0 · De dónde salió el efectivo (boceto "Boletas: una sola puerta", aprobado el 18 nov)
const ORIGENES_EF = [['admin', 'Caja de administración', 'sale de la caja de la oficina ahora'], ['caja', 'Una caja de venta', 'la cajera la pagó con la plata de la caja (retiro "Pago a proveedor")'], ['cobro', 'Un cobro a un cliente', 'logística la pagó con la plata de un cobro B2B']];
export const TXT_BOLETA_CARTILLA = 'Lo que compró se anota una vez, aquí, con su foto. Cómo se pagó lo encuentra el sistema: usted confirma.\n'
  + 'Débito o transferencia: espera su cargo. Al subir la cartola, la Bandeja lo propone: Confirmar.\n'
  + 'Tarjeta de crédito: espera su compra. Al subir el estado de cuenta de la tarjeta, la Bandeja la propone: Confirmar.\n'
  + 'Efectivo · caja de administración: queda pagada al guardar. No anote nada en Efectivo.\n'
  + 'Efectivo · caja de venta: la cajera anota el retiro "Pago a proveedor" y guarda la boleta en el sobre del cierre. Usted la anota aquí: se une con ese retiro (si todavía no está, la boleta lo espera).\n'
  + 'Efectivo · un cobro B2B: anótela aquí. Al recibir el cobro con "llegó menos", márquela.\n'
  + 'Mi plata: queda pagada al guardar (la empresa se la debe).\n'
  + 'Sin boleta posible (comisión, interés, impuesto del banco, cuota): en el cargo, "Sin documento".\n'
  + 'Efectivo sin boleta posible (propina, flete informal): Efectivo → Salida → "Pago en efectivo (solo para pagos en efectivo sin boleta posible)". Solo la administración.\n'
  + 'Un cargo que parece de una boleta: en el cargo, "Buscar su documento". Nunca anotarla de nuevo.\n'
  + 'Un cargo de una boleta que no anotó: en el cargo, "Tengo la boleta" (con su foto).\n'
  + 'El sistema aprende cómo aparece cada comercio en la cartola (por ejemplo "MERPAGO*JAVI" = Punto Frut) y la próxima vez propone el par solo.';
const TXT_BOLETA = TXT_BOLETA_CARTILLA;
export async function dlgBoleta(H, file, { el = null } = {}) {
  if (!st.D) { try { st.D = await (await fsGN()).leer(); } catch (e) { H.dialogo(`<div class="form-dialogo"><h2>Anotar boleta</h2><p class="error">${H.esc(H.mensajeError(e))}</p><div class="botones"><button type="button" class="btn" data-cerrar>Cerrar</button></div></div>`).querySelector('[data-cerrar]').onclick = ev => ev.target.closest('dialog').close(); return; } }
  let foto = file, url = URL.createObjectURL(file);
  const provs = Object.values(st.D.provs || {}), hoy = isoHoy();
  const dlg = H.dialogo(`<form class="form-dialogo bo-dlg" novalidate><div class="titulo-fila"><h2>Anotar boleta</h2>${H.info('Anotar boleta', TXT_BOLETA)}</div>
    <div class="bo-foto" style="display:flex;gap:12px;align-items:center"><img alt="Foto de la boleta" data-bo-img src="${url}" style="width:96px;height:128px;max-width:96px;object-fit:cover;border-radius:10px;flex:0 0 auto"><button type="button" class="btn-sec btn-chico" data-bo-otra>Tomar otra</button></div>
    <div class="campo"><label for="bo-monto">Monto</label><input id="bo-monto" class="bo-monto" inputmode="numeric" autocomplete="off" placeholder="$"></div>
    <fieldset class="campo"><legend>¿Cómo pagó?</legend><div class="chips" role="radiogroup">${MEDIOS_BOLETA.map(([k, t], i) => `<label class="chip-radio"><input type="radio" name="bo-medio" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></fieldset>
    <fieldset class="campo bo-origen" data-bo-origen hidden><legend>¿De dónde salió la plata?</legend>${ORIGENES_EF.map(([k, t, d], i) => `<label class="bo-or"><input type="radio" name="bo-origen" value="${k}" ${i === 0 ? 'checked' : ''}><span>${t}<small>${d}</small></span></label>`).join('')}</fieldset>
    <p class="ayuda bo-medio-txt" data-bo-medio-txt></p>
    <div class="bo-match" data-bo-match hidden></div>
    <div class="campo"><label for="bo-donde">Dónde compró <small>(opcional)</small></label><input id="bo-donde" list="bo-provs" maxlength="120" autocomplete="off" placeholder="Por ejemplo: supermercado"><datalist id="bo-provs">${provs.map(p => `<option value="${H.esc(p.razon)}">`).join('')}</datalist></div>
    <details class="bo-clasif" data-bo-clasif><summary>Ítem y área <small data-bo-opc>(opcional: también después, en la Bandeja)</small></summary>${camposClasif(H, null, 'bo')}</details>
    <div class="campo"><label for="bo-fecha">Fecha</label><input id="bo-fecha" type="date" value="${hoy}" max="${hoy}"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar boleta</button></div></form>`);
  const leer = conectarClasif(dlg, H, null, 'bo'), cerrar = () => { dlg.close(); URL.revokeObjectURL(url); };
  dlg.querySelector('[data-cerrar]').onclick = cerrar;
  dlg.querySelector('[data-bo-otra]').onclick = () => tomarFotoBoleta(f => { URL.revokeObjectURL(url); foto = f; url = URL.createObjectURL(f); dlg.querySelector('[data-bo-img]').src = url; });
  const det = dlg.querySelector('[data-bo-clasif]'), opc = dlg.querySelector('[data-bo-opc]');
  const medio = () => (dlg.querySelector('[name=bo-medio]:checked') || {}).value;
  const origen = () => (dlg.querySelector('[name=bo-origen]:checked') || {}).value || 'admin';
  const TXT_MEDIO = { debito: 'Queda esperando su cargo: al subir la cartola, la Bandeja se lo propone.', credito: 'Queda esperando su compra: al subir el estado de cuenta de la tarjeta, la Bandeja se la propone.', personal: 'Queda pagada con su plata (la empresa se la debe).',
    admin: 'Queda pagada con la caja de administración.', caja: 'Se une con el retiro "Pago a proveedor" de la caja; si todavía no está, la boleta lo espera.', cobro: 'Queda pagada; al recibir el cobro con "llegó menos", márquela.' };
  const alMedio = () => { const obl = medio() !== 'debito'; opc.textContent = obl ? '(obligatorio con este medio)' : '(opcional: también después, en la Bandeja)'; if (obl) det.open = true;
    dlg.querySelector('[data-bo-origen]').hidden = medio() !== 'efectivo'; dlg.querySelector('[data-bo-medio-txt]').textContent = TXT_MEDIO[medio() === 'efectivo' ? origen() : medio()] || '';
    const mb = dlg.querySelector('[data-bo-match]'); mb.hidden = true; mb.innerHTML = ''; delete dlg.dataset.boUnir; };
  dlg.querySelectorAll('[name=bo-medio], [name=bo-origen]').forEach(x => x.addEventListener('change', alMedio)); alMedio();
  dlg.querySelector('#bo-monto').addEventListener('input', () => { const mb = dlg.querySelector('[data-bo-match]'); mb.hidden = true; delete dlg.dataset.boUnir; });
  const donde = dlg.querySelector('#bo-donde');
  donde.addEventListener('change', () => { const p = provs.find(x => x.razon === donde.value); if (!p || !p.item) return; dlg.querySelector('#bo-item').value = p.item;
    dlg.querySelectorAll('[data-areas] input').forEach(x => { x.checked = (p.areas || []).some(a => a.area === x.value); }); const a0 = dlg.querySelector('[data-areas] input'); if (a0) a0.dispatchEvent(new Event('change')); });
  setTimeout(() => { try { dlg.querySelector('#bo-monto').focus(); } catch (e) {} }, 50);
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const bt = dlg.querySelector('[type=submit]'), t0 = bt.textContent; bt.disabled = true;
    try {
      const monto = Math.round(Number(String(dlg.querySelector('#bo-monto').value).replace(/[$\s.]/g, '').replace(',', '.')) || 0); if (!(monto > 0)) throw new Error('Escriba el monto.');
      const m = medio(), fecha = dlg.querySelector('#bo-fecha').value, c = leer(); c.item = c.item ? itemValido(c.item) : '';
      if (m !== 'debito' && !c.item) { det.open = true; throw new Error('Con este medio, elija el ítem y el área.'); }
      // v0.134.0 · Efectivo: si ya hay un pago en efectivo sin boleta de ese monto (retiro de una caja, pago al recibir un cobro), se pregunta
      let unirCon = null;
      if (m === 'efectivo' && dlg.dataset.boUnir !== 'no') {
        const cands = await pagosSinBoleta(monto, origen(), fecha);
        if (dlg.dataset.boUnir) unirCon = cands.find(x => x.id === dlg.dataset.boUnir) || null;
        else if (cands.length) { mostrarPagos(dlg, H, cands, () => dlg.querySelector('form').requestSubmit()); bt.disabled = false; bt.textContent = t0; return; }
      }
      bt.textContent = 'Subiendo la foto…';
      const f = await achicar(foto), G = await import('./gastos.js?v=0.138.0'), b64 = await G.aBase64(f), nombre = nombreFoto(fecha, donde.value || 'Boleta', monto) + '.jpg';
      const r = await G.subidor()({ tipo: 'comprobante', fecha: fecha.split('-').reverse().join('-'), imageData: b64, mimeType: f.type || 'image/jpeg', fileName: nombre });
      if (!r || !r.url) throw new Error('Drive no devolvió el enlace de la foto. Intente de nuevo.');
      bt.textContent = 'Guardando…';
      const FS = await fsGN(), { docId, doc } = await FS.anotarBoleta({ monto, medio: m, origen: m === 'efectivo' ? origen() : '', donde: donde.value, fecha, item: c.item, areas: c.areas, repartoId: c.repartoId, foto: { url: r.url, nombre } });
      let msg = `Boleta anotada: ${H.pesos(monto)}${donde.value ? ' · ' + H.esc(donde.value) : ''}.`;
      try {
        if (m === 'personal') { await FS.pagar({ partes: [{ docId, monto }], medio: 'personal', fecha, clave: 'bol_' + docId }); msg += ' Quedó pagada con su plata.'; }
        // v0.134.0: la tarjeta de crédito ya no crea su compra: la boleta espera la del estado de cuenta (así no se repite)
        else if (m === 'credito') msg += ' Queda esperando su compra: al subir el estado de cuenta de la tarjeta, la Bandeja la propone.';
        else if (m === 'efectivo' && unirCon) { await unirBoletaConPago(FS, doc, unirCon, monto); msg += ` Quedó unida al pago en efectivo de ${H.esc(unirCon.texto)}.`; }
        else if (m === 'efectivo' && origen() === 'caja') msg += ' Queda esperando el retiro "Pago a proveedor" de la caja: cuando aparezca, se unen.';
        else if (m === 'efectivo') { await pagarBoletaEfectivo(FS, doc, { monto, fecha, donde: donde.value }); msg += origen() === 'cobro' ? ' Quedó pagada; al recibir el cobro con "llegó menos", márquela.' : ' Quedó pagada con la caja de administración.'; }
        else msg += ' Queda esperando su cargo: al subir la cartola, la Bandeja propone unirlos.';
      } catch (e2) { msg += ` La boleta quedó anotada, pero no se alcanzó a registrar el pago (${H.esc(e2.message || H.mensajeError(e2))}): búsquela en la Bandeja y use "¿Cómo se pagó?".`; }
      cerrar(); H.registrar('Gastos: anotó una boleta', `${monto} · ${m} · ${donde.value || ''}`);
      st.D = null; if (el) aviso(el, H, msg); else H.dialogo(`<div class="form-dialogo"><h2>Listo</h2><p>${msg}</p><div class="botones"><button type="button" class="btn" data-cerrar>Cerrar</button></div></div>`).querySelector('[data-cerrar]').onclick = e3 => e3.target.closest('dialog').close();
    } catch (e) { bt.textContent = t0; falla(dlg, e, H); }
  });
}
// v0.134.0 · Un pago en efectivo SIN boleta posible (propina, flete informal), desde Efectivo: queda como gasto "Sin documento" de una vez,
// pagado con ese movimiento de Efectivo (como "Unir a su documento"). m: el movimiento de Efectivo (por unir). → true si quedó registrado
export async function dlgSinDocEfectivo(H, m) {
  if (!st.D) { try { st.D = await (await fsGN()).leer(); } catch (e) { throw new Error('No se pudo leer Gastos: ' + H.mensajeError(e)); } }
  const provs = Object.values(st.D.provs || {});
  H = { ...H, pesos: H.pesos || (n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL')), diaTexto: H.diaTexto || H0.diaTexto, info: H.info || (() => ''), registrar: H.registrar || (() => {}) };   // desde Efectivo (sus ayudas son otras)
  return new Promise(listo => {
    const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Gasto sin documento</h2>${H.info('Gasto sin documento', 'Un pago en efectivo que no tiene ni puede tener boleta (una propina, un flete informal). Queda en Gastos como "Sin documento", pagado con este movimiento de Efectivo. Si tiene boleta, no use esto: anótela con + Boleta.')}</div>
      <p class="ayuda"><b>Pago en efectivo · ${H.pesos(m.monto)}</b> · ${H.esc(H.diaTexto(m.dia))}</p>
      <div class="campo"><label for="se-prov">A quién se le pagó</label><input id="se-prov" list="se-provs" maxlength="120" autocomplete="off" value="${H.esc(m.detalle || '')}"><datalist id="se-provs">${provs.map(p => `<option value="${H.esc(p.razon)}">`).join('')}</datalist></div>
      <div class="campo"><label for="se-nota">Qué fue (opcional)</label><input id="se-nota" maxlength="120" value="${H.esc(m.nota || '')}"></div>
      ${camposClasif(H, null, 'se')}
      <p class="error" data-err role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" data-cerrar>Después</button><button type="submit" class="btn">Registrar el gasto</button></div></form>`);
    const leer = conectarClasif(dlg, H, null, 'se'), prov = dlg.querySelector('#se-prov');
    dlg.querySelector('[data-cerrar]').onclick = () => { dlg.close(); listo(false); };
    prov.addEventListener('change', () => { const p = provs.find(x => x.razon === prov.value); if (!p || !p.item) return; dlg.querySelector('#se-item').value = p.item;
      dlg.querySelectorAll('[data-areas] input').forEach(x => { x.checked = (p.areas || []).some(a => a.area === x.value); }); const a0 = dlg.querySelector('[data-areas] input'); if (a0) a0.dispatchEvent(new Event('change')); });
    dlg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const bt = dlg.querySelector('[type=submit]'); bt.disabled = true;
      try {
        const c = leer(); c.item = itemValido(c.item); if (!c.item) throw new Error('Elija el ítem.');
        const FS = await fsGN(), monto = Math.round(Number(m.monto) || 0);
        const [EM, EF] = await Promise.all([import('./efectivo-modelo.js?v=0.138.0'), import('./efectivo-fs.js?v=0.138.0')]);
        const r = await FS.registrarSinBanco({ medio: 'efectivo', tipo: 'sin', proveedor: prov.value, monto, fecha: m.dia, item: c.item, areas: c.areas, repartoId: c.repartoId, nota: dlg.querySelector('#se-nota').value,
          efectivo: { id: m.id, col: m.col || 'efectivo_movimientos', origen: EM.origenEfectivo(m), ...(m.sucursal ? { sucursal: m.sucursal } : {}) } });
        await EF.unir(m, { docId: r.docId, pagoId: r.pagoId, documento: 'Sin documento', proveedor: String(prov.value || '').slice(0, 120), monto }); EF.olvidarPorUnir();
        st.D = null; dlg.close(); H.registrar('Efectivo: gasto sin documento', `${prov.value} · ${monto} · ${c.item}`); listo(true);
      } catch (e) { falla(dlg, e, H); }
    });
  });
}
// v0.134.0 · Pagos en efectivo que esperan su boleta (Efectivo → por unir), del mismo monto y de hasta 30 días antes de la boleta.
// origen: 'caja' = retiros "Pago a proveedor" de una caja de venta; 'cobro' = pagos anotados al recibir un cobro; 'admin' = de la caja de administración.
async function pagosSinBoleta(monto, origen, fecha, hasta = fecha, diasAntes = 30) {   // v0.135.0: hasta (una boleta que espera: hasta hoy)
  try {
    const [EM, EF] = await Promise.all([import('./efectivo-modelo.js?v=0.138.0'), import('./efectivo-fs.js?v=0.138.0')]);
    const l = await EF.leerPorUnir(), desde = new Date(new Date(fecha + 'T12:00:00').getTime() - diasAntes * 864e5).toISOString().slice(0, 10);
    return l.filter(m => Math.round(Number(m.monto) || 0) === monto && String(m.dia || '') >= desde && String(m.dia || '') <= hasta && ['pago', 'pago_proveedor'].includes(m.motivo) && m.estado === 'por_unir')
      .filter(m => origen === 'caja' ? m.col === 'caja_movimientos' : origen === 'cobro' ? m.col !== 'caja_movimientos' && /^Al recibir/.test(m.nota || '') : m.col !== 'caja_movimientos')
      .map(m => ({ id: m.id, m, texto: `${EM.textoOrigenEfectivo(m)} · ${H0.diaTexto(m.dia)}${m.detalle ? ' · ' + m.detalle : ''}`, detalle: [m.nota, m.por].filter(Boolean).join(' · ') }));
  } catch (e) { return []; }
}
const H0 = { diaTexto: d => { const [y, m, dd] = String(d || '').split('-'); return dd ? `${Number(dd)}/${Number(m)}` : ''; } };
function mostrarPagos(dlg, H, cands, seguir) {
  const mb = dlg.querySelector('[data-bo-match]');
  mb.innerHTML = `<b>${cands.length === 1 ? 'Hay un pago en efectivo sin boleta de este monto' : `Hay ${cands.length} pagos en efectivo sin boleta de este monto`}</b>
    ${cands.map(x => `<div class="bo-match-p"><span>${H.esc(x.texto)}${x.detalle ? `<small>${H.esc(x.detalle)}</small>` : ''}</span><button type="button" class="btn btn-chico" data-bo-es="${H.esc(x.id)}">Es este pago: unir la boleta</button></div>`).join('')}
    <button type="button" class="btn-sec btn-chico" data-bo-no>Es otro pago</button>`;
  mb.hidden = false;
  mb.querySelectorAll('[data-bo-es]').forEach(b => b.onclick = () => { dlg.dataset.boUnir = b.dataset.boEs; mb.hidden = true; seguir(); });
  mb.querySelector('[data-bo-no]').onclick = () => { dlg.dataset.boUnir = 'no'; mb.hidden = true; seguir(); };
}
// La boleta con un pago en efectivo que la esperaba (lo mismo que "Unir a su documento" en Efectivo)
async function unirBoletaConPago(FS, doc, x, monto) {
  const [EM, EF] = await Promise.all([import('./efectivo-modelo.js?v=0.138.0'), import('./efectivo-fs.js?v=0.138.0')]), m = x.m;
  const pago = await FS.pagarConEfectivo({ id: doc.id, estado: 'pendiente', razon: doc.razon }, { id: m.id, col: m.col || 'efectivo_movimientos', sucursal: m.sucursal || '', dia: m.dia, monto, origen: EM.origenEfectivo(m), clave: EM.claveUnion(m), texto: `Efectivo · ${EM.textoOrigenEfectivo(m)} · ${m.detalle || ''}` });
  await EF.unir(m, { docId: doc.id, pagoId: pago.pagoId || '', documento: 'Boleta', proveedor: String(doc.razon || '').slice(0, 120), monto });
  EF.olvidarPorUnir();
}
// Efectivo de la caja de administración: la salida "Pago en efectivo" en Efectivo, unida a la boleta (como "Unir a su documento")
async function pagarBoletaEfectivo(FS, doc, { monto, fecha, donde }) {
  const [EM, EF] = await Promise.all([import('./efectivo-modelo.js?v=0.138.0'), import('./efectivo-fs.js?v=0.138.0')]);
  const r = EM.revisar({ tipo: 'salida', motivo: 'pago', monto: String(monto), dia: fecha, detalle: donde || 'Boleta', documento: 'Boleta', nota: 'Anotada con su foto en Gastos' }, isoHoy());
  if (r.error) throw new Error(r.error);
  r.mov.boleta = true;   // v0.131.0: así Efectivo la reconoce (boleta primero, pago después)
  const g = await EF.guardar(r.mov), m = { id: g.id, col: 'efectivo_movimientos', ...r.mov };
  const pago = await FS.pagarConEfectivo({ id: doc.id, estado: 'pendiente', razon: doc.razon }, { id: m.id, col: m.col, dia: fecha, monto, origen: EM.origenEfectivo(m), clave: EM.claveUnion(m), texto: `Efectivo · Caja de administración · ${donde || 'Boleta'}` });
  await EF.unir(m, { docId: doc.id, pagoId: pago.pagoId || '', documento: 'Boleta', proveedor: String(doc.razon || '').slice(0, 120), monto });
}
// "Registrar a mano" sobre un cargo con una boleta anotada esperando del mismo monto: "¿Es la boleta del …?"
function preguntarBoleta(el, H, m, esp, modo = '') {
  const dlg = H.dialogo(`<div class="form-dialogo"><h2>¿Es una boleta ya anotada?</h2><p class="ayuda"><b>${H.esc(m.glosa)}</b> · ${H.pesos(m.libre)} · ${H.esc(H.diaTexto(m.fecha))}</p>
    ${esp.map(d => `<div class="gn-fila bo-esp">${d.foto && d.foto.url ? `<a href="${H.esc(d.foto.url)}" target="_blank" rel="noopener">Ver foto</a>` : ''}<span>Boleta del ${H.esc(H.diaTexto(d.fecha))} · ${H.esc(d.razon)} · ${H.pesos(d.saldo)}</span><button type="button" class="btn btn-chico" data-bo-unir="${H.esc(d.id)}">Sí, es esta: unir</button></div>`).join('')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="button" class="btn-sec" data-bo-otra>No, registrar otra</button></div></div>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('[data-bo-otra]').onclick = () => { dlg.close(); dlgMano(el, H, m, true, modo); };
  dlg.querySelectorAll('[data-bo-unir]').forEach(b => b.addEventListener('click', async () => {
    const d = esp.find(x => x.id === b.dataset.boUnir); b.disabled = true;
    try { if (!(await asegurarClasif(H, [d]))) { b.disabled = false; return; }
      await (await fsGN()).pagar({ partes: [{ docId: d.id, monto: m.libre }], movId: m.id, medio: 'cargo', fecha: m.fecha }); dlg.close();
      H.registrar('Gastos: unió una boleta anotada', `${d.razon} · ${m.libre}`); aviso(el, H, `Unida: la boleta de ${H.esc(d.razon)} con ${H.esc(m.glosa)}.`); }
    catch (e) { b.disabled = false; falla(dlg, e, H); }
  }));
}
// v0.124.2 · Nota en un cargo o documento: qué falta para resolverlo. Se guarda en el mismo cargo o documento (sin lecturas nuevas).
const TXT_NOTA = 'Para acordarse de qué falta: "pedir la boleta", "es el sueldo de septiembre de X, falta la liquidación", "preguntar a la contadora".\nSe ve en la Bandeja y en el resumen de su cartola. Cuando el cargo o el documento se resuelve, deja de verse en la Bandeja pero queda en su historial (y en "Lo conciliado" de su cartola).\nPara borrarla, déjela vacía y guarde.';
function dlgNota(el, H, tipo, x) {
  if (!x) return;
  const que = tipo === 'doc' ? `${H.esc(x.razon || x.rut || 'Documento')} · ${H.esc(x.tipoTexto || '')}${x.folio ? ' N° ' + H.esc(x.folio) : ''}` : `${H.esc(x.glosa)} · ${H.pesos(x.monto)} · ${H.esc(H.diaTexto(x.fecha))}`;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${x.nota && x.nota.texto ? 'Editar nota' : 'Nota'}</h2>${H.info('Nota', TXT_NOTA)}</div>
    <p class="ayuda"><b>${que}</b></p>
    <div class="campo"><label for="nt-txt">Qué falta para resolverlo</label><textarea id="nt-txt" rows="3" maxlength="300" placeholder="Ej: pedir la boleta a la ferretería">${H.esc((x.nota && x.nota.texto) || '')}</textarea><span class="ayuda" data-cuenta></span></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const ta = dlg.querySelector('#nt-txt'), cuenta = () => { dlg.querySelector('[data-cuenta]').textContent = `${ta.value.length} de 300`; };
  ta.addEventListener('input', cuenta); cuenta(); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  setTimeout(() => { try { ta.focus(); } catch (e) {} }, 0);
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try {
      const nota = await (await fsGN()).guardarNota(tipo, x.id, ta.value);
      // Sin volver a leer: se cambia lo que ya está en pantalla
      const lista = tipo === 'doc' ? (st.D.docs || []) : (st.D.movs || []), o = lista.find(y => y.id === x.id); if (o) o.nota = nota;
      dlg.close(); H.registrar(nota ? 'Gastos: anotó una nota' : 'Gastos: borró una nota', tipo === 'doc' ? (x.razon || x.folio || x.id) : x.glosa);
      st.msg = nota ? 'Nota guardada.' : 'Nota borrada (queda en el historial).'; st.err = ''; repintarQuieto(el, H);
    } catch (e) { falla(dlg, e, H); }
  });
}
function dlgNoGasto(el, H, m) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>No es gasto</h2>${H.info('No es gasto', TXT_NOGASTO)}</div>
    <p class="ayuda"><b>${H.esc(m.glosa)}</b> · ${H.pesos(m.monto)} · ${H.esc(H.diaTexto(m.fecha))}</p>
    <div class="chips" role="radiogroup" aria-label="Qué es">${Object.entries(GB.NO_GASTO).map(([k, t]) => `<label class="chip-radio"><input type="radio" name="ng-t" value="${k}"><span>${t}</span></label>`).join('')}</div>
    <div class="campo"><label for="ng-nota">Nota (opcional)</label><input id="ng-nota" maxlength="200"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const r = dlg.querySelector('[name=ng-t]:checked'); if (!r) return falla(dlg, new Error('Elija qué es.'), H);
    dlg.querySelector('[type=submit]').disabled = true;
    try { await (await fsGN()).noEsGasto(m.id, r.value, dlg.querySelector('#ng-nota').value); dlg.close(); aviso(el, H, `${H.esc(m.glosa)}: ${H.esc(GB.NO_GASTO[r.value].toLowerCase())}.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// v0.105.0 · Pago a cuenta: a quién (propuesto por la glosa: RUT, seña aprendida o nombre), o una parte nueva por nombre y RUT
function dlgACuenta(el, H, m) {
  const D = st.D, partes = Object.entries(D.provs || {}).map(([clave, p]) => ({ clave, razon: p.razon || '', rut: p.rut || '', trab: !!p.trabajador }))
    .concat((D.docs || []).filter(d => d.estado !== 'no_va').map(d => ({ clave: GB.claveBase(d), razon: d.razon || '', rut: d.rut || '' }))).filter(p => p.razon || p.rut);
  const pos = GB.partesPosibles(m, partes, st.B.S).slice(0, 80);
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Pago a cuenta</h2>${H.info('Pago a cuenta', TXT_ACUENTA)}</div>
    <p class="ayuda"><b>${H.esc(m.glosa)}</b> · ${H.pesos(m.libre)} · ${H.esc(GN.CUENTAS[m.cuenta] || m.cuenta)} · ${H.esc(H.diaTexto(m.fecha))}</p>
    <p class="ayuda">¿A quién se le pagó? Primero los que aparecen en la glosa.</p>
    ${pos.length ? `<input type="search" data-gn-buscar placeholder="Buscar proveedor o trabajador" aria-label="Buscar a quién"><div class="gn-opcs">${pos.map(({ p, a }, i) => `<label class="gn-opc" data-txt="${H.esc(GN.norm(p.razon + ' ' + p.rut))}"><input type="radio" name="ac-p" value="${H.esc(p.clave)}" ${i === 0 && a ? 'checked' : ''}><span><b>${H.esc(p.razon || p.rut)}</b>${p.trab ? ' <span class="chip c-gris chip-chico">Trabajador</span>' : ''}<small>${H.esc(p.rut ? GN.rutTexto(p.rut) : 'sin RUT')}${a ? ' · aparece en la glosa' : ''}</small></span></label>`).join('')}</div>` : ''}
    <details class="gn-det"${pos.length ? '' : ' open'}><summary>Es alguien nuevo</summary><div class="gn-dos"><div class="campo"><label for="ac-n">Nombre</label><input id="ac-n" maxlength="120"></div><div class="campo"><label for="ac-r">RUT (opcional)</label><input id="ac-r" maxlength="14"></div></div></details>
    <div class="campo"><label for="ac-nota">De qué es (opcional)</label><input id="ac-nota" maxlength="200" placeholder="Por ejemplo: anticipo del pedido de noviembre"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Conciliar como pago a cuenta</button></div></form>`);
  if (pos.length) buscador(dlg);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const n = dlg.querySelector('#ac-n').value.trim(), r = dlg.querySelector('#ac-r').value.trim(), x = dlg.querySelector('[name=ac-p]:checked');
    const parte = n || r ? { razon: n, rut: r } : x ? pos.map(o => o.p).find(p => p.clave === x.value) : null;
    if (!parte) return falla(dlg, new Error('Elija a quién se le pagó, o escriba su nombre.'), H);
    if (r && !GN.rutN(r).match(/^\d{6,9}[0-9K]$/)) return falla(dlg, new Error('Revise el RUT (por ejemplo 12.345.678-9).'), H);
    dlg.querySelector('[type=submit]').disabled = true;
    try { await (await fsGN()).pagoACuenta(m.id, parte, dlg.querySelector('#ac-nota').value); dlg.close(); H.registrar('Gastos: pago a cuenta', `${parte.razon || parte.rut} · ${m.libre}`);
      aviso(el, H, `Conciliado como pago a cuenta de ${H.esc(parte.razon || parte.rut)}: ${H.pesos(m.libre)} a favor. Cuando llegue su documento, se aplica desde la Bandeja.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// Aplicar el saldo a favor a un documento de esa parte (por fecha: primero el pago a cuenta más antiguo)
async function aplicarACuenta(el, H, d) {
  const l = GB.aCuentaPara(d, st.B.aCuenta); if (!d || !l.length) return;
  if (!(await asegurarClasif(H, [d]))) return;
  const plan = GB.pagosDeVarios(d, l), total = plan.reduce((a, x) => a + x.partes[0].monto, 0);
  return hacer(el, H, async () => { const F = await fsGN(); for (const x of plan) await F.pagar({ partes: x.partes, movId: x.movId }); H.registrar('Gastos: aplicó pago a cuenta', `${nom(d)} · ${total}`); },
    `Aplicado: ${H.pesos(total)} a cuenta a ${H.esc(nom(d))}${d.saldo - total > 5 ? ` · falta ${H.pesos(d.saldo - total)}` : ' · queda pagado'}.`);
}
function dlgDeshacer(el, H, pagoId) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Deshacer el pago</h2></div>
    <p class="ayuda">El documento y el movimiento vuelven a la Bandeja. El pago no se borra: queda como deshecho, con quién y cuándo.</p>
    <div class="campo"><label for="dh-m">Motivo</label><input id="dh-m" maxlength="200" placeholder="Por ejemplo: era de otra factura"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Deshacer</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { await (await fsGN()).deshacerPago(pagoId, dlg.querySelector('#dh-m').value); dlg.close(); aviso(el, H, 'Pago deshecho: el documento y el movimiento volvieron a la Bandeja.'); }
    catch (e) { falla(dlg, e, H); }
  });
}

// ═══════════════ v0.96.0 · Repartos con nombre ═══════════════
function repartosHtml(H) {
  const R = Object.values(st.D.repartos || {}).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))), uso = GB.usoRepartos(st.D.provs);
  const barra = r => `<div class="gn-barra">${r.areas.map((a, i) => `<span class="gn-b${i % 5}" style="width:${Number(a.pct)}%"></span>`).join('')}</div>`;
  return `<section class="tarjeta" aria-labelledby="t-gn-rep"><div class="titulo-fila"><h2 id="t-gn-rep">Repartos ${H.info('Repartos', TXT_REPARTOS)}</h2><button type="button" class="btn btn-chico" data-gn-reparto="">Nuevo reparto</button></div>
    ${R.length ? R.map(r => `<div class="gn-it"><div class="gn-fila"><b>${H.esc(r.nombre)}</b><span class="chip ${uso[r.id] ? 'c-verde' : 'c-gris'} chip-chico">usado por ${uso[r.id] || 0}</span></div>${barra(r)}
      <small>${H.esc(r.areas.map(a => `${a.area} ${a.pct}%`).join(' · '))}</small><div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-reparto="${H.esc(r.id)}">Cambiar</button></div></div>`).join('') : '<div class="vacio" style="border:0">Todavía no hay repartos.</div>'}</section>`;
}
function dlgReparto(el, H, rid) {
  const r = rid ? st.D.repartos[rid] : null;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${r ? 'Cambiar el reparto' : 'Nuevo reparto'}</h2>${H.info('Repartos', TXT_REPARTOS)}</div>
    <div class="campo"><label for="rp-nombre">Nombre</label><input id="rp-nombre" maxlength="60" value="${H.esc(r ? r.nombre : '')}" placeholder="Por ejemplo: Ainavillo común"></div>
    ${camposClasif(H, r ? { areas: r.areas } : null, 'rp', true).replace(/<div class="campo"><label for="rp-reparto">[\s\S]*?<\/select><\/div>/, '')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const leer = conectarClasif(dlg, H, r ? { areas: r.areas } : null, 'rp'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try {
      const a = leer(), F = await fsGN(), id = await F.guardarReparto({ id: rid || '', nombre: dlg.querySelector('#rp-nombre').value, areas: a.areas });
      dlg.close(); H.registrar(r ? 'Gastos: cambió un reparto' : 'Gastos: creó un reparto', dlg.querySelector('#rp-nombre').value);
      const mes = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7), n = r ? (st.D.docs || []).filter(x => x.clasif && x.clasif.repartoId === rid && x.mes === mes && !x.clasif.porLineas && !x.clasif.separado).length : 0;
      if (n) return ofrecerAplicar(el, H, id, mes, n);
      aviso(el, H, r ? 'Reparto cambiado. Rige para las facturas que vienen.' : 'Reparto creado. Ya se puede elegir al clasificar.');
    } catch (e) { falla(dlg, e, H); }
  });
}
function ofrecerAplicar(el, H, id, mes, n) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>¿También a lo ya pagado de este mes?</h2></div>
    <p>El reparto cambió y rige para lo que viene. Hay <b>${n}</b> ${n === 1 ? 'documento ya pagado' : 'documentos ya pagados'} de este mes con el reparto anterior.</p>
    <p class="ayuda">Los meses cerrados no se tocan en ningún caso.</p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Dejarlos como están</button><button type="submit" class="btn">Aplicar a los ${n}</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => { dlg.close(); aviso(el, H, 'Reparto cambiado. Rige para las facturas que vienen.'); };
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const k = await (await fsGN()).aplicarRepartoAlMes(id, mes); dlg.close(); aviso(el, H, `Reparto cambiado y aplicado a ${k} ${k === 1 ? 'documento' : 'documentos'} de este mes.`); } catch (e) { falla(dlg, e, H); } });
}

// ═══════════════ v0.96.0 · Proveedores y su ficha ═══════════════
function listaProveedores() {
  const por = {};
  (st.D.docs || []).forEach(d => { const k = GB.claveBase(d), x = por[k] || (por[k] = { clave: k, razon: d.razon || d.rut, rut: d.rut || '', n: 0, total: 0, ultima: '' }); x.n++; x.total += Number(d.total) || 0; if (d.fecha > x.ultima) x.ultima = d.fecha; if (!x.razon) x.razon = d.razon; });
  Object.entries(st.D.provs || {}).forEach(([k, p]) => { const b = k.replace(/_c_.*$/, ''); if (!por[b]) por[b] = { clave: b, razon: p.razon || b, rut: p.rut || '', n: 0, total: 0, ultima: '' }; });
  return Object.values(por).sort((a, b) => String(a.razon).localeCompare(String(b.razon)));
}
function proveedoresHtml(H) {
  // v0.107.0 · Los trabajadores están en Equipo, no aquí
  const trabs = new Set(TR.equipo(st.D).map(x => x.clave)), L = listaProveedores().filter(x => !trabs.has(x.clave)), q = GN.norm(st.buscaProv || ''), l = L.filter(x => !q || GN.norm(x.razon + ' ' + x.rut).includes(q));
  const estado = x => estado0(x);
  const estado0 = x => { const p = st.D.provs[x.clave]; return p && p.item ? `<span class="chip ${GB.modoProveedor(p) === 'item' ? 'c-amarillo' : 'c-verde'} chip-chico">${GB.modoProveedor(p) === 'item' ? 'Solo el ítem' : 'Ítem y áreas'}</span>` : '<span class="chip c-gris chip-chico">Sin ficha</span>'; };
  return `<section class="tarjeta" aria-labelledby="t-gn-provs"><div class="titulo-fila"><h2 id="t-gn-provs">Proveedores</h2><span>${L.length}</span></div>
    <div class="campo"><label class="sr" for="gn-buscar-prov">Buscar proveedor</label><input id="gn-buscar-prov" type="search" value="${H.esc(st.buscaProv || '')}" placeholder="Nombre o RUT"></div>
    ${l.length ? l.slice(0, 300).map(x => `<a class="gn-it gn-prov" href="#gastos/proveedores/${encodeURIComponent(x.clave)}"><div class="gn-fila"><b>${H.esc(x.razon)}</b>${estado(x)}</div><small>${x.rut ? 'RUT ' + H.esc(x.rut) + ' · ' : ''}${x.n} ${x.n === 1 ? 'documento' : 'documentos'}${x.n ? ' · ' + H.pesos(x.total) : ''}${x.ultima ? ' · último ' + H.esc(H.diaTexto(x.ultima)) : ''}</small></a>`).join('') : '<div class="vacio" style="border:0">Ningún proveedor con eso.</div>'}</section>`;
}
// ── v0.108.0 · Situación tributaria (gestión y tributario): se pone una vez y se recuerda, desde una fecha ──
const TXT_TRIB = 'Si el SII acepta este gasto como gasto de la empresa. Aceptado: lo ve el contador. Por regularizar: gasto real que todavía no se acepta, pero tiene camino (va con su trámite). No aceptado: gasto real que nunca será tributario.\nNo cambia el estado de resultados de gestión: cambia lo que ve el contador y el impuesto estimado. Cada cambio rige desde la fecha que elija; lo anterior queda como estaba. Qué es deducible lo decide su contador.';
const hoyCl = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
function tribTxt(H, tipo, clave) {
  const T = st.D.tributario || {}, r = (T.reglas || {})[GT.idRegla(tipo, clave)], c = r ? GT.vigente(r, hoyCl()) : null, sit = c ? c.situacion : 'aceptado';
  const futuro = r ? (r.cambios || []).filter(x => x.desde > hoyCl()).sort((a, b) => a.desde.localeCompare(b.desde))[0] : null, g = c && c.grupo ? ((T.grupos || {})[c.grupo] || {}).nombre : '';
  return `<span class="chip ${sit === 'aceptado' ? 'c-gris' : sit === 'regularizar' ? 'c-amarillo' : 'c-rojo'} chip-chico">${H.esc(GT.SITUACIONES[sit])}</span>${c && c.desde ? ` <small>desde el ${H.esc(H.diaTexto(c.desde))}${g ? ' · ' + H.esc(g) : ''}</small>` : ''}${futuro ? ` <small>· pasa a ${H.esc(GT.SITUACIONES[futuro.situacion].toLowerCase())} el ${H.esc(H.diaTexto(futuro.desde))}</small>` : ''}`;
}
const tribBloque = (H, tipo, clave, nombre, titulo = 'Situación tributaria') => `<div class="gn-trib"><span>${titulo} ${H.info('Situación tributaria', TXT_TRIB)}</span><span>${tribTxt(H, tipo, clave)}</span><button type="button" class="btn-link btn-chico" data-gn-trib="${H.esc(clave)}" data-tipo="${tipo}" data-nombre="${H.esc(nombre)}">Cambiar</button></div>`;
function dlgTrib(el, H, tipo, clave, nombre) {
  const T = st.D.tributario || {}, r = (T.reglas || {})[GT.idRegla(tipo, clave)], c = r ? GT.vigente(r, hoyCl()) : null, grupos = Object.entries(T.grupos || {});
  const ini = st.D.inicio || INICIO(), desde0 = r ? hoyCl().slice(0, 8) + '01' : ini;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Situación tributaria</h2>${H.info('Situación tributaria', TXT_TRIB)}</div>
    <p class="ayuda"><b>${H.esc(nombre)}</b> · ${H.esc(GT.TIPOS[tipo])}${tipo === 'item' ? ' (todo lo que use este ítem, salvo que su proveedor o servicio diga otra cosa)' : ''}</p>
    <div class="chips" role="radiogroup" aria-label="Situación">${Object.entries(GT.SITUACIONES).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="tb-s" value="${k}" ${(c ? c.situacion : 'aceptado') === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <div class="campo"><label for="tb-desde">Desde</label><input id="tb-desde" type="date" value="${desde0}"><p class="ayuda">Lo anterior a esta fecha queda como estaba.</p></div>
    <div data-tb-grupo ${(c ? c.situacion : 'aceptado') === 'aceptado' ? 'hidden' : ''}><div class="campo"><label for="tb-g">Trámite</label><select id="tb-g">${grupos.map(([id, g]) => `<option value="${H.esc(id)}" ${c && c.grupo === id ? 'selected' : ''}>${H.esc(g.nombre)}</option>`).join('')}<option value="" ${grupos.length ? '' : 'selected'}>Uno nuevo…</option></select></div>
      <div class="campo" data-tb-nuevo ${grupos.length ? 'hidden' : ''}><label for="tb-gn">Nombre del trámite</label><input id="tb-gn" maxlength="60" placeholder="Por ejemplo: Auto en comodato"></div></div>
    <div class="campo"><label for="tb-nota">Nota (opcional)</label><input id="tb-nota" maxlength="200"></div>
    ${r && (r.cambios || []).length ? `<details class="gn-det"><summary>Cambios anteriores · ${r.cambios.length}</summary>${r.cambios.slice().reverse().map(x => `<div class="gn-fila"><small>Desde el ${H.esc(H.diaTexto(x.desde))}: ${H.esc(GT.SITUACIONES[x.situacion])}${x.grupo && (T.grupos || {})[x.grupo] ? ' · ' + H.esc(T.grupos[x.grupo].nombre) : ''}${x.nota ? ' · ' + H.esc(x.nota) : ''}</small><small>${H.esc(x.por || '')} · ${H.esc(x.en || '')}</small></div>`).join('')}</details>` : ''}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const sit = () => (dlg.querySelector('[name=tb-s]:checked') || {}).value || '', sel = dlg.querySelector('#tb-g');
  dlg.querySelectorAll('[name=tb-s]').forEach(x => x.addEventListener('change', () => { dlg.querySelector('[data-tb-grupo]').hidden = sit() === 'aceptado'; }));
  sel.addEventListener('change', () => { dlg.querySelector('[data-tb-nuevo]').hidden = !!sel.value; });
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); const datos = { situacion: sit(), desde: dlg.querySelector('#tb-desde').value, grupo: sel.value, grupoNuevo: sel.value ? '' : dlg.querySelector('#tb-gn').value, nota: dlg.querySelector('#tb-nota').value };
    try { GT.validarCambio(datos); } catch (e) { return falla(dlg, e, H); }
    dlg.querySelector('[type=submit]').disabled = true;
    try { await (await fsGN()).cambiarTributario({ tipo, clave, nombre }, datos); dlg.close(); H.registrar('Gastos: situación tributaria', `${nombre} · ${GT.SITUACIONES[datos.situacion]} desde ${datos.desde}`);
      aviso(el, H, `${H.esc(nombre)}: ${H.esc(GT.SITUACIONES[datos.situacion].toLowerCase())} desde el ${H.esc(H.diaTexto(datos.desde))}.`); }
    catch (e) { falla(dlg, e, H); }
  });
}
// ── v0.107.0 · Equipo: los trabajadores (aprobado por Emmanuel el 26 oct: "son dos ámbitos diferentes") ──
const TXT_EQUIPO = 'Las personas que trabajan en Fën: sus datos de contrato, antigüedad, sueldo base y la provisión de sus vacaciones y finiquito. Un trabajador aparece aquí solo con su primera liquidación, o antes, con "Agregar trabajador".\nSu área (en su ficha) dice a qué área van su sueldo y su provisión. Los proveedores siguen en Proveedores.';
function equipoHtml(H) {
  const eq = TR.equipo(st.D), hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const areaTxt = k => { const a = GB.areasDe((st.D.provs || {})[k], st.D.repartos || {}); return (a || []).length ? GB.textoReparto(a) : ''; };
  const chip = x => { if (!x.ficha) return '<span class="chip c-amarillo chip-chico">Faltan los datos del contrato</span>'; const e = TR.estadoContrato(x.ficha, hoy);
    return `<span class="chip ${e.nivel === 'vencido' ? 'c-rojo' : e.nivel === 'pronto' ? 'c-amarillo' : 'c-verde'} chip-chico">${H.esc(TR.CONTRATOS[x.ficha.contrato] || '')}</span>`; };
  // v0.124.3 · Los que siguen trabajando arriba; los que terminaron, plegados en "Ex trabajadores"
  const activos = eq.filter(x => !TR.terminado(x)), ex = eq.filter(x => TR.terminado(x)).sort((a, b) => b.termino.dia.localeCompare(a.termino.dia));
  const docsTxt = x => { const n = TR.docsVigentes(x).length; return n ? `${n} ${n === 1 ? 'documento' : 'documentos'}` : ''; };
  const sinContrato = x => !TR.docsVigentes(x).some(d => d.tipo === 'contrato');
  const filaActivo = x => { const ult = x.liqs[x.liqs.length - 1], ant = x.ficha ? TR.antiguedad(x.ficha.ingreso, hoy) : null, e = x.ficha ? TR.estadoContrato(x.ficha, hoy) : null, ar = areaTxt(x.clave);
      return `<a class="gn-it gn-prov" href="#gastos/equipo/${encodeURIComponent(x.clave)}"><div class="gn-fila"><b>${H.esc(x.nombre)}</b>${chip(x)}</div>
        <small>${[x.ficha && x.ficha.cargo ? H.esc(x.ficha.cargo) : '', ant ? H.esc(ant.texto) : '', ult ? 'sueldo base ' + H.pesos(TR.sueldoBase(ult)) : 'sin liquidaciones todavía', ar ? H.esc(ar) : 'sin área', docsTxt(x)].filter(Boolean).join(' · ')}${sinContrato(x) ? ' · <span class="gn-sin-contrato">sin contrato subido</span>' : ''}</small>
        ${e && e.nivel !== 'ok' && e.nivel ? `<small class="${e.nivel === 'vencido' ? 'gn-cl gn-cl-falta' : 'gn-cl gn-aviso-c'}">${H.esc(e.texto)}</small>` : ''}</a>`; };
  const filaEx = x => `<a class="gn-it gn-prov" href="#gastos/equipo/${encodeURIComponent(x.clave)}"><div class="gn-fila"><b>${H.esc(x.nombre)}</b><span class="chip c-gris chip-chico">Ex trabajador</span></div>
        <small>${[H.esc(TR.textoTermino(x.termino)), docsTxt(x)].filter(Boolean).join(' · ')}</small></a>`;
  return `<section class="tarjeta" aria-labelledby="t-gn-eq"><div class="titulo-fila"><h2 id="t-gn-eq">Equipo ${H.info('Equipo', TXT_EQUIPO)}</h2><span>${activos.length} ${activos.length === 1 ? 'trabajando' : 'trabajando'}${ex.length ? ` · ${ex.length} ${ex.length === 1 ? 'ex trabajador' : 'ex trabajadores'}` : ''}</span></div>
    <div class="gn-acc"><button type="button" class="btn btn-chico" data-gn-trab-nuevo>Agregar trabajador</button></div>
    ${activos.length ? activos.map(filaActivo).join('')
      : '<div class="vacio" style="border:0">Todavía no hay trabajadores: aparecen al subir su primera liquidación, o agréguelos con "Agregar trabajador".</div>'}
    ${ex.length ? `<details class="gn-det"><summary>Ex trabajadores · ${ex.length}</summary>${ex.map(filaEx).join('')}</details>` : ''}</section>`;
}
function fichaHtml(H, base, { equipo = false } = {}) {
  const docs = (st.D.docs || []).filter(d => GB.claveBase(d) === base).sort((a, b) => b.fecha.localeCompare(a.fecha)), provs = st.D.provs || {};
  const gen = provs[base] || null, razon = (docs[0] && docs[0].razon) || (gen && gen.razon) || base, rut = (docs[0] && docs[0].rut) || (gen && gen.rut) || '';
  const B = st.B || GB.armar(st.D, {}), est = id => B.docs.find(x => x.id === id) || {};
  // v0.124.4 · Un servicio por N° de cliente aunque venga con o sin guion (3589534-5 y 35895345 son la misma ficha)
  const nCli = c => String(c).replace(/[^0-9A-Za-z]/g, '').slice(0, 30), clientes = {};
  docs.filter(d => d.cliente).forEach(d => { const k = nCli(d.cliente); if (!clientes[k] || (!clientes[k].direccion && d.direccion)) clientes[k] = d; });
  Object.keys(provs).filter(k => k.startsWith(base + '_c_')).forEach(k => { const c = k.slice(base.length + 3); if (!clientes[nCli(c)]) clientes[nCli(c)] = { cliente: c, direccion: '' }; });
  const repTxt = p => (p.repartoId && st.D.repartos[p.repartoId] ? `${st.D.repartos[p.repartoId].nombre} · ${GB.textoReparto(st.D.repartos[p.repartoId].areas)}` : GB.textoReparto(p.areas || []) || 'sin áreas');
  const clasif = (p, clave, titulo) => `<div class="gn-it"><span class="gn-sub">${titulo}</span>${p && p.item ? `<b>${H.esc(p.item)}</b><small>${GB.modoProveedor(p) === 'item' ? 'Solo el ítem: las áreas se eligen en cada compra.' : 'Ítem y áreas: ' + H.esc(repTxt(p))}</small>` : '<small>Sin clasificación guardada.</small>'}
    <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-ficha="${H.esc(clave)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">${p && p.item ? 'Cambiar' : 'Establecer'}</button></div></div>`;
  const prods = [...Object.entries((gen && gen.productos) || {}).map(([k, v]) => [base, k, v]), ...Object.keys(provs).filter(k => k.startsWith(base + '_c_')).flatMap(k => Object.entries(provs[k].productos || {}).map(([pk, v]) => [k, pk, v]))];
  const glosas = Object.keys(provs).filter(k => k === base || k.startsWith(base + '_c_')).flatMap(k => (provs[k].glosas || []).map(g => [k, g]));
  const estDoc = d => { const e = est(d.id); return e.estado === 'no_va' ? '<span class="chip c-gris chip-chico">esto no va</span>' : e.estadoPago === 'pagado' ? `<span class="chip ${e.clasifEf ? 'c-verde' : 'c-amarillo'} chip-chico">${e.clasifEf ? 'listo' : 'pagado, falta clasificar'}</span>` : '<span class="chip c-amarillo chip-chico">sin pago</span>'; };
  const hist = ((gen && gen.historial) || []).slice(-8).reverse();
  return `<p class="volver"><a href="#gastos/${equipo ? 'equipo' : 'proveedores'}">${equipo ? 'Todo el equipo' : 'Todos los proveedores'}</a></p>
    <section class="tarjeta" aria-labelledby="t-gn-ficha"><div class="titulo-fila"><h2 id="t-gn-ficha">${H.esc(razon)} ${equipo ? H.info('Ficha del trabajador', TXT_TRAB) : H.info('Ficha del proveedor', TXT_FICHA)}</h2></div>
      <p class="ayuda">${rut ? 'RUT ' + H.esc(rut) + ' · ' : ''}${docs.length} ${docs.length === 1 ? (equipo ? 'liquidación o pago' : 'documento') : (equipo ? 'liquidaciones y pagos' : 'documentos')} desde el inicio</p>
      <div class="gn-ficha">
        ${trabajadorHtml(H, base, razon, rut)}
        ${(sf => sf ? `<div class="gn-it"><span class="gn-sub">Saldo a favor (pagos a cuenta) ${H.info('Pagos a cuenta', TXT_ACUENTA)}</span><div class="gn-fila"><b>${H.pesos(sf.monto)}</b><span></span></div>${sf.movs.map(m => `<small>${H.esc(H.diaTexto(m.fecha))} · ${H.esc(m.glosa)} · ${H.pesos(m.libre)}${m.naturalezaNota ? ' · ' + H.esc(m.naturalezaNota) : ''}</small>`).join('<br>')}<p class="ayuda">Se aplica desde la Bandeja cuando llega su documento.</p></div>` : '')(GB.saldosAFavor(B.movs)[base])}
        ${clasif(gen, base, equipo ? 'Área y clasificación del sueldo' : 'Clasificación')}
        ${equipo ? '' : `<div class="gn-it">${tribBloque(H, 'proveedor', base, razon)}${Object.keys(clientes).length ? '<small>Cada servicio (N° de cliente) puede tener la suya, abajo.</small>' : ''}</div>`}
        ${equipo ? '' : Object.keys(clientes).length ? `<div class="gn-it"><span class="gn-sub">Servicios (por N° de cliente)</span>${Object.values(clientes).map(c => { const k = base + '_c_' + String(c.cliente).replace(/[^0-9A-Za-z]/g, '').slice(0, 30), p = provs[k];
            return `<div class="gn-serv"><div><b>Cliente ${H.esc(c.cliente)}</b>${c.direccion ? ` · ${H.esc(c.direccion)}` : ''}<br><small>${p && p.item ? `${H.esc(p.item)} · ${GB.modoProveedor(p) === 'item' ? 'solo el ítem' : H.esc(repTxt(p))}` : 'Sin clasificación: use la del proveedor o establézcala'}</small></div>
              <button type="button" class="btn-sec btn-chico" data-gn-ficha="${H.esc(k)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">${p && p.item ? 'Cambiar' : 'Establecer'}</button></div>${tribBloque(H, 'servicio', k, `${razon} · cliente ${c.cliente}`)}`; }).join('')}</div>` : ''}
        <div class="gn-it"><span class="gn-sub">Cómo aparece en el banco</span>${glosas.length ? glosas.map(([k, g]) => `<div class="gn-fila"><span>${H.esc(g.sena)}</span><button type="button" class="gn-link" data-gn-olvidar="${H.esc(k)}" data-sena="${H.esc(g.sena)}">Olvidar</button></div>`).join('') : '<small>Todavía no aprende ninguna glosa (se aprende al conciliar un pago).</small>'}</div>
        ${equipo ? '' : `        <div class="gn-it"><span class="gn-sub">Productos recordados</span>${prods.length ? prods.map(([k, pk, v]) => `<div class="gn-fila"><span>${H.esc(pk)}</span><span><small>${H.esc(v.item)}${v.area ? ' · ' + H.esc(String(v.area).startsWith(GB.AREA_REPARTO) ? ((st.D.repartos[v.area.slice(GB.AREA_REPARTO.length)] || {}).nombre || 'reparto que ya no está') : v.area) : ''}</small> <button type="button" class="gn-link" data-gn-quitarprod="${H.esc(k)}" data-prod="${H.esc(pk)}">Quitar</button></span></div>`).join('') : '<small>Ninguno (se recuerdan al separar una factura por líneas).</small>'}</div>`}
      </div>
      <h3 class="gn-h3">${equipo ? 'Últimas liquidaciones y pagos' : 'Últimos documentos'}</h3>
      ${docs.slice(0, 12).map(d => `<div class="gn-fila gn-fila-doc"><span>${H.esc(d.tipoTexto)} ${H.esc(d.folio)} · ${H.esc(H.diaTexto(d.fecha))} ${estDoc(d)}</span><span class="gn-m">${H.pesos(d.total)}</span></div>`).join('') || '<p class="ayuda">Sin documentos desde el inicio.</p>'}
      ${hist.length ? `<details class="gn-det"><summary>Historial de la ficha</summary>${hist.map(h => `<div class="gn-fila"><small>${H.esc(h.en || '')} · ${H.esc(h.por || '')}</small><small>${H.esc(h.que || '')}</small></div>`).join('')}</details>` : ''}
    </section>`;
}
function dlgFicha(el, H, clave, razon, rut) {
  const p = (st.D.provs || {})[clave] || null, pre = p ? { item: p.item, repartoId: p.repartoId || '', areas: p.areas || [] } : null, modo0 = p ? GB.modoProveedor(p) : 'fijo';
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${H.esc(razon)}</h2>${H.info('Ficha del proveedor', TXT_FICHA)}</div>
    ${clave.includes('_c_') ? `<p class="ayuda">Servicio: cliente ${H.esc(clave.split('_c_')[1])}</p>` : ''}
    <fieldset class="campo gn-recordar"><legend>Qué recuerda</legend>
      <label class="gn-opc"><input type="radio" name="fi-modo" value="fijo" ${modo0 !== 'item' ? 'checked' : ''}><span><b>Ítem y áreas</b><small>Siempre se reparte igual: sus facturas llegan clasificadas.</small></span></label>
      <label class="gn-opc"><input type="radio" name="fi-modo" value="item" ${modo0 === 'item' ? 'checked' : ''}><span><b>Solo el ítem</b><small>Las áreas se eligen en cada compra.</small></span></label></fieldset>
    ${camposClasif(H, pre, 'fi')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const leer = conectarClasif(dlg, H, pre, 'fi'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const a = leer(), modo = dlg.querySelector('[name=fi-modo]:checked').value; a.item = itemValido(a.item);
      await (await fsGN()).guardarFicha(clave, { item: a.item, modo, repartoId: a.repartoId, areas: a.areas, razon, rut }); dlg.close(); H.registrar('Gastos: ficha de proveedor', `${razon} · ${a.item}`); aviso(el, H, `Ficha guardada: ${H.esc(razon)}. Rige para sus facturas sin pagar.`); }
    catch (e) { falla(dlg, e, H); }
  });
}

// ═══════════════ v0.96.0 · Seleccionar y unir; revisar el Gastos anterior ═══════════════
function repintarQuieto(el, H) { const y = window.scrollY; repintar(el, H); requestAnimationFrame(() => window.scrollTo(0, y)); }
function elegir(el, H, tipo, id, on) {
  const S = st.sel, l = S[tipo];
  if (on && !l.includes(id)) l.push(id); if (!on) S[tipo] = l.filter(x => x !== id);
  if (!S.d.length && !S.m.length) S.primero = ''; else if (!S.primero || !S[S.primero].length) S.primero = S.d.length && !S.m.length ? 'd' : S.m.length && !S.d.length ? 'm' : (S.primero || tipo);
  repintarQuieto(el, H);
}
async function unirElegidos(el, H) {
  const docs = st.sel.d.map(docDe).filter(Boolean), movs = st.sel.m.map(movDe).filter(Boolean), b = GB.balance(docs, movs);
  if (!b.valido) return;
  // Compromisos (uno o varios del mismo, por ejemplo dos semestres de patente en un solo pago) por otro monto: se ajusta el más reciente
  if (movs.length === 1 && docs.every(x => x.origen === 'compromiso') && new Set(docs.map(x => x.compromiso)).size === 1 && !b.calza) {
    const k = docs.reduce((a, x, i) => (x.fecha > docs[a].fecha ? i : a), 0), r = await ofrecerAjuste(H, docs[k], docs[k].saldo + b.dif); if (r === undefined) return;
    if (r) docs[k] = { ...docs[k], saldo: docs[k].saldo + b.dif };
  }
  if (!(await asegurarClasif(H, docs))) return;
  const bb = GB.balance(docs, movs);
  const pasos = movs.length === 1 ? [{ movId: movs[0].id, partes: GB.repartirPago(docs, movs[0].libre) }] : GB.pagosDeVarios(docs[0], movs);
  return hacer(el, H, async () => { const F = await fsGN(); for (const p of pasos) await F.pagar(p);
      st.sel = { d: [], m: [], primero: '' }; H.registrar('Gastos: unió lo elegido', `${docs.length} doc · ${movs.length} cargo`); },
    `Unido: ${docs.length === 1 ? H.esc(nom(docs[0])) : docs.length + ' documentos'} con ${movs.length === 1 ? H.esc(movs[0].glosa) : movs.length + ' cargos'}${bb.calza ? '' : bb.dif < 0 ? ` · queda por pagar ${H.pesos(-bb.dif)}` : ` · quedan libres ${H.pesos(bb.dif)}`}.`);
}
// ═══════════════ v0.96.0 · Compromisos ═══════════════
function compromisosHtml(H) {
  const L = st.D.compromisos || [], reps = st.D.repartos || {};
  const repTxt = c => (c.repartoId && reps[c.repartoId] ? `${reps[c.repartoId].nombre} · ${GB.textoReparto(reps[c.repartoId].areas)}` : GB.textoReparto(c.areas || []));
  return `<section class="tarjeta" aria-labelledby="t-gn-cp"><div class="titulo-fila"><h2 id="t-gn-cp">Compromisos ${H.info('Compromisos', TXT_COMPROMISOS)}</h2><button type="button" class="btn btn-chico" data-gn-compromiso="">Nuevo compromiso</button></div>
    ${L.length ? L.map(c => `<div class="gn-it${c.estado === 'archivado' ? ' gn-archivado' : ''}"><div class="gn-fila"><b>${H.esc(c.nombre)}</b><span class="gn-m">${H.pesos(c.monto)}</span></div>
      <small>A ${H.esc(c.aQuien)}${c.rut ? ' · RUT ' + H.esc(c.rut) : ''} · ${c.frecuencia === 'semestral' ? `día ${H.esc(c.dia)} de ${MESES_TXT[(Number(c.mesInicio) || 1) - 1]} y ${MESES_TXT[(Number(c.mesInicio) || 1) + 5]}` : c.frecuencia === 'anual' ? `día ${H.esc(c.dia)} de ${MESES_TXT[(Number(c.mesInicio) || 1) - 1]}, una vez al año` : `día ${H.esc(c.dia)} de cada mes`}${c.rol ? ' · rol ' + H.esc(c.rol) : ''}${c.direccion ? ' · ' + H.esc(c.direccion) : ''}${c.desde ? ' · desde ' + H.esc(c.desde) : ''}${c.estado === 'archivado' ? ' · archivado' : ''}</small>
      <span class="gn-cl">${H.esc(c.item)} · ${H.esc(repTxt(c))}</span>${tribBloque(H, 'compromiso', c.id, c.nombre)}
      <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-compromiso="${H.esc(c.id)}">Cambiar</button><button type="button" class="btn-sec btn-chico" data-gn-archivarcp="${H.esc(c.id)}" data-archivar="${c.estado === 'archivado' ? '0' : '1'}">${c.estado === 'archivado' ? 'Reactivar' : 'Archivar'}</button></div></div>`).join('')
    : '<div class="vacio" style="border:0">Todavía no hay compromisos. Por ejemplo: los arriendos.</div>'}</section>
    <section class="tarjeta" aria-labelledby="t-gn-cr"><div class="titulo-fila"><h2 id="t-gn-cr">Créditos ${H.info('Créditos', TXT_CREDITOS)}</h2><button type="button" class="btn-sec btn-chico" data-gn-plantilla-cred>Descargar formato de tabla</button></div>
    ${(st.D.creditos || []).length ? st.D.creditos.map(cr => { const pend = (cr.cuotas || []).filter(c => c.estado !== 'Pagada' && c.fecha >= (st.D.inicio || '')), sep = cr.montoOriginal > 0 && cr.tasa > 0;
        return `<div class="gn-it"><div class="gn-fila"><b>${H.esc(cr.nombre)}</b><span class="gn-m">${H.pesos(cr.cuota)}</span></div>
        <small>${(cr.cuotas || []).length} cuotas · día ${H.esc(cr.dia)} · ${pend.length} por vencer${pend.length ? ' · la última el ' + H.esc(H.diaTexto(pend[pend.length - 1].fecha)) : ''}</small>
        <span class="gn-cl${sep ? '' : ' gn-cl-falta'}">${sep ? `Monto original ${H.pesos(cr.montoOriginal)} · tasa ${H.esc(String(cr.tasa).replace('.', ','))}% mensual: cada cuota separada en interés y capital` : 'Falta el monto original y la tasa: las cuotas van completas'}</span>
        ${(() => { const reales = (cr.cuotas || []).filter(c => c.real), ult = reales.length ? reales[reales.length - 1].n : 0;   // v0.124.5
          return reales.length ? `<small class="gn-cl">${H.icono('check', 14)}Con la tabla del banco: cuotas ${reales[0].n}${ult !== reales[0].n ? '–' + ult : ''} (capital, interés y comisiones reales)${sep && ult < (cr.cuotas || []).length ? ` · desde la ${ult + 1}, estimado` : ''}${cr.operacion ? ' · N° ' + H.esc(cr.operacion) : ''}</small>` : ''; })()}
        <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-credito="${H.esc(cr.id)}">${sep ? 'Cambiar' : 'Escribir monto y tasa'}</button></div></div>`; }).join('')
      : '<div class="vacio" style="border:0">Arrastre el "Detalle Crédito" de BancoEstado (Excel) o la "Tabla de amortización Fën" al recuadro de arriba.</div>'}
    <p class="ayuda">${H.info('Tabla de amortización', TXT_TABLA_CRED)} Con la tabla del banco (capital, interés y comisión de cada cuota), cada cuota usa los montos reales en vez del cálculo.</p></section>`;
}
// v0.124.5 · El formato vacío de la "Tabla de amortización Fën" (Excel)
async function descargarPlantillaCred(H) {
  const XLSX = await H.cargarXLSX(), wb = XLSX.utils.book_new();
  const cred = [['Tabla de amortización Fën', 'Llene la columna B. No cambie los nombres de la columna A.'], ['Banco', 'BancoEstado'], ['N° de operación', ''], ['Nombre', ''], ['Producto', ''],
    ['Capital otorgado', ''], ['Monto líquido entregado', ''], ['Fecha de otorgamiento', ''], ['Tasa mensual (%)', ''], ['N° de cuotas', ''], ['Saldo insoluto capital', ''], ['Saldo al', ''], ['Notas', '']];
  const cuotas = [['Cuota', 'Vencimiento', 'Fecha de pago', 'Capital', 'Interés', 'Interés por atraso', 'Otros (comisiones y seguros)', 'Total', 'Estado'],
    [1, 'DD-MM-AAAA', '', '', '', '', '', '', 'Pagada / Por pagar']];
  const h1 = XLSX.utils.aoa_to_sheet(cred), h2 = XLSX.utils.aoa_to_sheet(cuotas);
  h1['!cols'] = [{ wch: 26 }, { wch: 40 }]; h2['!cols'] = [{ wch: 7 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, h1, 'Crédito'); XLSX.utils.book_append_sheet(wb, h2, 'Cuotas');
  XLSX.writeFile(wb, 'tabla-amortizacion-fen.xlsx');
}
function dlgCompromiso(el, H, cid) {
  const c = cid ? (st.D.compromisos || []).find(x => x.id === cid) : null, pre = c ? { item: c.item, repartoId: c.repartoId || '', areas: c.areas || [] } : null;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${c ? 'Cambiar el compromiso' : 'Nuevo compromiso'}</h2>${H.info('Compromisos', TXT_COMPROMISOS)}</div>
    <div class="campo"><label for="cp-nombre">Nombre</label><input id="cp-nombre" maxlength="80" value="${H.esc(c ? c.nombre : '')}" placeholder="Por ejemplo: Arriendo Ainavillo"></div>
    <div class="gn-dos"><div class="campo"><label for="cp-aquien">A quién se le paga</label><input id="cp-aquien" maxlength="120" value="${H.esc(c ? c.aQuien : '')}" placeholder="Nombre o razón social"></div>
      <div class="campo"><label for="cp-rut">RUT (opcional)</label><input id="cp-rut" maxlength="14" value="${H.esc(c ? c.rut : '')}"></div></div>
    <div class="gn-dos"><div class="campo"><label for="cp-monto">Monto de cada pago</label><input id="cp-monto" type="number" min="1" inputmode="numeric" value="${c ? H.esc(c.monto) : ''}"></div>
      <div class="campo"><label for="cp-dia">Día de pago</label><input id="cp-dia" type="number" min="1" max="31" inputmode="numeric" value="${c ? H.esc(c.dia) : '5'}"></div></div>
    <div class="gn-dos"><div class="campo"><label for="cp-frec">Cada cuánto</label><select id="cp-frec"><option value="mensual">Cada mes</option><option value="semestral" ${c && c.frecuencia === 'semestral' ? 'selected' : ''}>Cada 6 meses</option><option value="anual" ${c && c.frecuencia === 'anual' ? 'selected' : ''}>Una vez al año</option></select></div>
      <div class="campo" data-cp-sem ${c && c.frecuencia && c.frecuencia !== 'mensual' ? '' : 'hidden'}><label for="cp-mes">Meses de pago</label><select id="cp-mes"></select></div></div>
    <div class="gn-dos"><div class="campo"><label for="cp-rol">Rol o N° (opcional)</label><input id="cp-rol" maxlength="40" value="${H.esc(c && c.rol ? c.rol : '')}" placeholder="Por ejemplo: rol de la patente"></div>
      <div class="campo"><label for="cp-dir">Dirección (opcional)</label><input id="cp-dir" maxlength="100" value="${H.esc(c && c.direccion ? c.direccion : '')}"></div></div>
    <div class="campo"><label for="cp-desde">Desde (mes)</label><input id="cp-desde" type="month" value="${H.esc(c && c.desde ? c.desde : '')}"><p class="ayuda">Vacío: desde el inicio del sistema. Un mes anterior al inicio (hasta un año antes) entra como deuda anterior: úselo para lo que quedó sin pagar.</p></div>
    ${camposClasif(H, pre, 'cp')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const leer = conectarClasif(dlg, H, pre, 'cp'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  // Los meses de pago según cada cuánto: cada 6 meses, un par (enero y julio…); una vez al año, un mes
  const frec = dlg.querySelector('#cp-frec'), mesSel = dlg.querySelector('#cp-mes');
  const meses = () => { const f = frec.value, v = Number(mesSel.value) || (c && Number(c.mesInicio)) || 1; dlg.querySelector('[data-cp-sem]').hidden = f === 'mensual';
    mesSel.innerHTML = (f === 'anual' ? MESES_TXT.map((t, i) => [i + 1, t]) : [1, 2, 3, 4, 5, 6].map(m => [m, `${MESES_TXT[m - 1]} y ${MESES_TXT[m + 5]}`])).map(([m, t]) => `<option value="${m}" ${m === v ? 'selected' : ''}>${t}</option>`).join(''); };
  frec.addEventListener('change', meses); meses();
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const a = leer(), v = id => dlg.querySelector(id).value; a.item = itemValido(a.item);
      await (await fsGN()).guardarCompromiso({ id: cid || '', nombre: v('#cp-nombre'), aQuien: v('#cp-aquien'), rut: v('#cp-rut'), monto: v('#cp-monto'), dia: v('#cp-dia'), desde: v('#cp-desde'), frecuencia: v('#cp-frec'), mesInicio: v('#cp-mes'), rol: v('#cp-rol'), direccion: v('#cp-dir'), item: a.item, repartoId: a.repartoId, areas: a.areas });
      dlg.close(); H.registrar(c ? 'Gastos: cambió un compromiso' : 'Gastos: creó un compromiso', v('#cp-nombre')); aviso(el, H, c ? 'Compromiso cambiado. Rige desde el próximo mes que se cree.' : 'Compromiso creado. Su documento del mes ya está en la Bandeja.'); }
    catch (e) { falla(dlg, e, H); }
  });
}

// ═══════════════ v0.97.0 · Créditos, tarjeta y Por pagar ═══════════════
function dlgCredito(el, H, id) {
  const cr = (st.D.creditos || []).find(x => x.id === id); if (!cr) return;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Datos del crédito</h2>${H.info('Créditos', TXT_CREDITOS)}</div>
    <div class="campo"><label for="cr-nombre">Nombre</label><input id="cr-nombre" maxlength="100" value="${H.esc(cr.nombre)}"></div>
    <div class="gn-dos"><div class="campo"><label for="cr-monto">Monto original</label><input id="cr-monto" type="number" min="0" inputmode="numeric" value="${cr.montoOriginal || ''}"></div>
      <div class="campo"><label for="cr-tasa">Tasa mensual (%)</label><input id="cr-tasa" inputmode="decimal" value="${cr.tasa ? H.esc(String(cr.tasa).replace('.', ',')) : ''}" placeholder="Por ejemplo 1,25"></div></div>
    <p class="ayuda">Están en el contrato o en el detalle del crédito del banco. La cuota de ${H.pesos(cr.cuota)} se separa en interés y capital; las cuotas ya creadas se recalculan.</p>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const n = await (await fsGN()).guardarCredito(id, { nombre: dlg.querySelector('#cr-nombre').value, montoOriginal: dlg.querySelector('#cr-monto').value, tasa: dlg.querySelector('#cr-tasa').value });
      dlg.close(); aviso(el, H, `Crédito guardado${n ? `: ${n} ${n === 1 ? 'cuota recalculada' : 'cuotas recalculadas'}` : ''}.`); } catch (e) { falla(dlg, e, H); } });
}
function dlgTarjeta(el, H) {
  let n = 0; const fila = () => `<div class="gn-sep-fila gn-tc-fila" data-tc="${n++}"><input type="date" data-tf aria-label="Fecha"><input data-tg maxlength="80" placeholder="Comercio" aria-label="Comercio"><input type="number" data-tm min="1" inputmode="numeric" placeholder="Monto" aria-label="Monto"></div>`;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Compras de la tarjeta de crédito</h2>${H.info('Tarjeta de crédito', TXT_TARJETA)}</div>
    <p class="ayuda">Una fila por compra, como aparece en el estado de cuenta.</p><div data-tcs>${fila()}${fila()}${fila()}</div>
    <button type="button" class="btn-sec btn-chico" data-mas>Agregar fila</button>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('[data-mas]').onclick = () => dlg.querySelector('[data-tcs]').insertAdjacentHTML('beforeend', fila());
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try {
      const filas = Array.from(dlg.querySelectorAll('[data-tc]')).map(f => ({ fecha: f.querySelector('[data-tf]').value, glosa: f.querySelector('[data-tg]').value, monto: f.querySelector('[data-tm]').value })).filter(x => x.fecha || x.glosa || x.monto);
      if (!filas.length) throw new Error('Anote al menos una compra.');
      if (filas.some(x => !GN.esIso(x.fecha) || !String(x.glosa).trim() || !(Number(x.monto) > 0))) throw new Error('Cada compra necesita fecha, comercio y monto.');
      const id = GN.idCarga('tarjeta'), movs = GN.movsDeTarjeta(filas, id), fs0 = movs.map(m => m.fecha).sort();
      const k = await (await fsGN()).cargarMovs('tarjeta', movs, { id, archivo: 'anotadas a mano', desde: fs0[0], hasta: fs0[fs0.length - 1], identificador: `${movs.length} compras de la tarjeta` });
      dlg.close(); H.registrar('Gastos: anotó compras de la tarjeta', GN.textoCarga(k)); aviso(el, H, `Tarjeta de crédito: ${H.esc(GN.textoCarga(k))}.`);
    } catch (e) { falla(dlg, e, H); } });
}
function porPagarHtml(H) {
  const B = st.B || GB.armar(st.D, {}), hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }), en7 = new Date(Date.now() + 7 * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const l = B.abiertosD.filter(d => !d.nc && d.saldo > 0 && d.estado !== 'no_va').map(d => ({ d, f: d.vence || d.fecha }));
  const ahora = l.filter(x => !x.d.anterior).sort((a, b) => a.f.localeCompare(b.f)), ant = l.filter(x => x.d.anterior);
  const grupos = [['Vencido', x => x.f < hoy], ['Esta semana', x => x.f >= hoy && x.f <= en7], ['Más adelante', x => x.f > en7]];
  const fila = x => `<div class="gn-fila gn-fila-doc"><span><b>${H.esc(x.d.razon || x.d.rut)}</b> · ${H.esc(x.d.tipoTexto)}${x.d.folio && x.d.origen !== 'credito' ? ' ' + H.esc(x.d.folio) : ''} · ${x.d.vence ? 'vence' : 'del'} ${H.esc(H.diaTexto(x.f))}</span><span class="gn-m">${H.pesos(x.d.saldo)}</span></div>`;
  const tot = a => a.reduce((t, x) => t + x.d.saldo, 0), dd = GB.deudaDueno(st.D.pagos, st.D.movs, st.D.docs);
  const pagAntes = (st.D.docs || []).filter(d => d.estado === 'no_va' && d.noVa && d.noVa.motivo === GB.PAGADO_ANTES).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return `<section class="tarjeta" aria-labelledby="t-gn-pp"><div class="titulo-fila"><h2 id="t-gn-pp">Por pagar ${H.info('Por pagar', TXT_PORPAGAR)}</h2><span class="gn-m">${H.pesos(tot(ahora))}</span></div>
    ${ahora.length ? grupos.map(([t, f]) => { const g = ahora.filter(f); return g.length ? `<h3 class="gn-h3${t === 'Vencido' ? ' gn-vencido' : ''}">${t} · ${H.pesos(tot(g))}</h3>${g.map(fila).join('')}` : ''; }).join('') : '<div class="vacio" style="border:0">Nada por pagar.</div>'}
    ${ant.length ? deudaAnteriorHtml(H, ant, tot) : ''}
    ${pagAntes.length ? `<details class="gn-det"><summary>Pagados antes del inicio · ${pagAntes.length} · ${H.pesos(pagAntes.reduce((a, d) => a + (Number(d.total) || 0), 0))}</summary><p class="ayuda">Deuda anterior marcada "Ya se pagó antes del 1 oct". Si aparece su cargo, devuélvala.</p>${pagAntes.map(d => `<div class="gn-fila gn-fila-doc"><span><b>${H.esc(d.razon || d.rut)}</b> · ${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · del ${H.esc(H.diaTexto(d.fecha))}${d.noVa && d.noVa.nota ? ' · ' + H.esc(d.noVa.nota) : ''}</span><span class="gn-acc-fila"><span class="gn-m">${H.pesos(d.total)}</span><button type="button" class="btn-link btn-chico" data-gn-volverdoc="${H.esc(d.id)}">Devolver a Por pagar</button></span></div>`).join('')}</details>` : ''}
  </section>${cuentaDuenoHtml(H, dd)}`;
}
// v0.128.2 · Deuda anterior: casillas, "Marcar todos", por mes y "Ya se pagó antes del 1 oct" (boceto aprobado el 13 nov)
const MESES_C = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function deudaAnteriorHtml(H, ant, tot) {
  const porMes = {}; ant.forEach(x => { const m = String(x.d.fecha || '').slice(0, 7); (porMes[m] = porMes[m] || []).push(x); });
  const meses = Object.keys(porMes).sort().reverse();
  const nomMes = m => (MESES_C[Number(m.slice(5, 7)) - 1] || m) + (m.slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + m.slice(0, 4) : '');
  const fila = x => `<label class="gn-ant-fila"><input type="checkbox" data-gn-ant-chk="${H.esc(x.d.id)}" data-monto="${x.d.saldo}" data-mes="${H.esc(String(x.d.fecha || '').slice(0, 7))}"><span><b>${H.esc(x.d.razon || x.d.rut)}</b> · ${H.esc(x.d.tipoTexto)} ${H.esc(x.d.folio || '')} <small>· del ${H.esc(H.diaTexto(x.d.fecha))}${x.d.vence ? ' · vencía ' + H.esc(H.diaTexto(x.d.vence)) : ''}</small></span><span class="gn-m">${H.pesos(x.d.saldo)}</span></label>`;
  return `<details class="gn-det gn-ant" ${st.antAbierta ? 'open' : ''} data-gn-ant><summary>Deuda anterior al inicio · ${ant.length} · ${H.pesos(tot(ant))}</summary>
    <p class="ayuda">Facturas de antes del inicio del sistema que no tienen su pago aquí. Si ya se pagaron antes del 1 oct (con cargos que no están en el sistema), márquelas: quedan cerradas como pagadas antes del inicio, no cuentan como gasto de octubre ni mueven ningún saldo, y salen de Por pagar y de Plata hoy. Las que todavía se deben, déjelas sin marcar.</p>
    <div class="gn-ant-barra"><label class="gn-ant-todos"><input type="checkbox" data-gn-ant-todos> Marcar todos</label><div class="gn-ant-meses">${meses.map(m => `<button type="button" class="btn-sec btn-chico" data-gn-ant-mes="${H.esc(m)}">${H.esc(nomMes(m))} · ${porMes[m].length}</button>`).join('')}</div></div>
    ${ant.map(fila).join('')}
    <div class="gn-ant-pie"><span data-gn-ant-suma>Marcados: 0</span><button type="button" class="btn" data-gn-ant-marcar disabled>Ya se pagó antes del 1 oct</button></div></details>`;
}
function conectarDeudaAnterior(el, H) {
  const caja = el.querySelector('[data-gn-ant]'); if (!caja) return;
  caja.addEventListener('toggle', () => { st.antAbierta = caja.open; });
  const chks = () => [...caja.querySelectorAll('[data-gn-ant-chk]')];
  const actualizar = () => { const l = chks().filter(x => x.checked), t = l.reduce((a, x) => a + (Number(x.dataset.monto) || 0), 0);
    caja.querySelector('[data-gn-ant-suma]').textContent = `Marcados: ${l.length}${l.length ? ' · ' + H.pesos(t) : ''}`;
    const b = caja.querySelector('[data-gn-ant-marcar]'); b.disabled = !l.length; b.textContent = l.length ? `Ya se pagó antes del 1 oct (${l.length} · ${H.pesos(t)})` : 'Ya se pagó antes del 1 oct';
    const todos = caja.querySelector('[data-gn-ant-todos]'); todos.checked = l.length === chks().length; todos.indeterminate = l.length > 0 && l.length < chks().length; };
  chks().forEach(x => x.addEventListener('change', actualizar));
  caja.querySelector('[data-gn-ant-todos]').addEventListener('change', ev => { chks().forEach(x => { x.checked = ev.target.checked; }); actualizar(); });
  caja.querySelectorAll('[data-gn-ant-mes]').forEach(b => b.addEventListener('click', () => { const l = chks().filter(x => x.dataset.mes === b.dataset.gnAntMes), on = !l.every(x => x.checked); l.forEach(x => { x.checked = on; }); actualizar(); }));
  caja.querySelector('[data-gn-ant-marcar]').addEventListener('click', () => {
    const l = chks().filter(x => x.checked); if (!l.length) return;
    const t = l.reduce((a, x) => a + (Number(x.dataset.monto) || 0), 0);
    const dlg = H.dialogo(`<form class="form-dialogo" novalidate><h2>¿Se pagaron antes del 1 oct?</h2>
      <p>${l.length} ${l.length === 1 ? 'documento' : 'documentos'} · ${H.pesos(t)}. Quedan cerrados como pagados antes del inicio del sistema: no cuentan como gasto de octubre ni mueven ningún saldo.</p>
      <div class="campo"><label for="ant-nota">Nota (opcional)</label><input id="ant-nota" maxlength="200" placeholder="Por ejemplo: pagadas en septiembre"></div>
      <p class="ayuda">Si después aparece el cargo de alguno, se devuelve a Por pagar desde "Pagados antes del inicio".</p>
      <p class="error" data-err role="alert"></p>
      <div class="botones"><button type="button" class="btn-sec" data-cerrar>Volver</button><button type="submit" class="btn">Marcar como pagados</button></div></form>`);
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    dlg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
      try { const n = await (await fsGN()).pagadosAntes(l.map(x => x.dataset.gnAntChk), dlg.querySelector('#ant-nota').value); dlg.close();
        H.registrar('Gastos: deuda anterior pagada antes del inicio', `${n} documentos · ${H.pesos(t)}`); st.D = null; aviso(el, H, `${n} ${n === 1 ? 'documento quedó' : 'documentos quedaron'} como pagados antes del 1 oct.`); }
      catch (e) { dlg.querySelector('[type=submit]').disabled = false; falla(dlg, e, H); }
    });
  });
}
// v0.126.6 · La cuenta con el dueño (pedido por Emmanuel el 12 nov): quién le debe a quién, con las dos listas
const TXT_DUENO = 'La cuenta entre usted y la empresa.\nA su favor: lo que usted pagó por la empresa con su plata ("¿Cómo se pagó?" → Con plata del dueño, o Gasto sin banco), menos lo que la empresa ya le devolvió (cargos marcados "No es gasto → Devolución al dueño").\nEn contra: sus gastos personales que pagó la empresa (cargos marcados "No es gasto → Gasto personal del dueño").\nEl saldo es la diferencia: si es a su favor, la empresa le debe; si no, usted le debe a la empresa. Un gasto personal se descuenta solo, sin mover plata.\nLos retiros del dueño no entran: un retiro no se devuelve.';
function cuentaDuenoHtml(H, dd) {
  if (!dd.pagado && !dd.devuelto && !dd.gastos) return '';
  const filas = (l, signo) => l.map(x => `<div class="gn-fila gn-dueno-f"><span>${H.esc(x.texto)} · ${H.esc(H.diaTexto(x.fecha))}</span><span class="gn-m">${signo}${H.pesos(x.monto)}</span></div>`).join('');
  const sal = dd.saldo, txt = sal > 0 ? `La empresa le debe a usted ${H.pesos(sal)}` : sal < 0 ? `Usted le debe a la empresa ${H.pesos(-sal)}` : 'La cuenta está en cero';
  return `<section class="tarjeta gn-cuenta-dueno" aria-labelledby="t-gn-dueno"><div class="titulo-fila"><h2 id="t-gn-dueno">Cuenta con el dueño ${H.info('Cuenta con el dueño', TXT_DUENO)}</h2></div>
    <div class="gn-dueno-saldo ${sal < 0 ? 'gn-dueno-debe' : ''}" data-gn-dueno-saldo="${sal}"><span class="gn-dueno-k">Saldo</span><b>${txt}</b>
      <small>${sal > 0 ? 'Cuando la empresa le transfiera, marque ese cargo "No es gasto → Devolución al dueño".' : sal < 0 ? 'Se descuenta de lo próximo que pague con su plata, o devuélvalo a la empresa.' : ''}</small></div>
    <div class="gn-dueno-cols">
      <div><div class="gn-fila"><b>Lo que usted pagó por la empresa</b><b class="gn-m">${H.pesos(dd.pagado - dd.devuelto)}</b></div>${filas(dd.listaPagado, '')}${filas(dd.listaDevuelto.map(x => ({ ...x, texto: 'Devuelto: ' + x.texto })), '−')}${!dd.listaPagado.length && !dd.listaDevuelto.length ? '<div class="vacio" style="border:0">Nada.</div>' : ''}</div>
      <div><div class="gn-fila"><b>Gastos suyos que pagó la empresa</b><b class="gn-m">${H.pesos(dd.gastos)}</b></div>${filas(dd.listaGastos, '')}${!dd.listaGastos.length ? '<div class="vacio" style="border:0">Nada.</div>' : ''}</div>
    </div></section>`;
}

// v0.98.0 · Un compromiso pagado por otro monto (patente con IPC o multas, arriendo con reajuste): ajustar el documento a lo pagado.
// → Promise: true (ajustado), false (unir igual, sin ajustar), undefined (canceló)
function ofrecerAjuste(H, d, pagado) {
  const dif = pagado - d.saldo; if (Math.abs(dif) <= GB.TOLERANCIA || !(pagado > 0)) return Promise.resolve(false);
  return new Promise(resolve => {
    const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>El pago es por otro monto</h2></div>
      <p><b>${H.esc(d.tipoTexto)}</b> · ${H.esc(d.razon)}: el documento dice ${H.pesos(d.saldo)} y lo pagado es ${H.pesos(pagado)} (${dif > 0 ? 'más' : 'menos'} ${H.pesos(Math.abs(dif))}).</p>
      <p class="ayuda">${dif > 0 ? 'Ajustar: el documento sube a lo pagado y la diferencia queda como multas e intereses (gasto financiero), por ejemplo el IPC y las multas de una patente atrasada.' : 'Ajustar: el documento baja a lo pagado (por ejemplo, la patente de este año es menor).'} El monto del compromiso para los próximos meses no cambia (eso se cambia en Compromisos).</p>
      <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="button" class="btn-sec" data-igual>Unir sin ajustar</button><button type="submit" class="btn">Ajustar a ${H.pesos(pagado)}</button></div></form>`);
    let listo = false; dlg.addEventListener('close', () => { if (!listo) resolve(undefined); });
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    dlg.querySelector('[data-igual]').onclick = () => { listo = true; dlg.close(); resolve(false); };
    dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
      try { await (await fsGN()).ajustarCompromiso(d.id, d.total + dif); listo = true; dlg.close(); resolve(true); } catch (e) { falla(dlg, e, H); } });
  });
}

// ═══════════════ v0.100.0 · Gasto sin banco (efectivo o plata del dueño) ═══════════════
function dlgSinBanco(el, H) {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }), provs = Object.values(st.D.provs || {});
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Gasto sin banco</h2>${H.info('Gasto sin banco', TXT_SINBANCO)}</div>
    <div class="chips" role="radiogroup" aria-label="Con qué se pagó"><label class="chip-radio"><input type="radio" name="sb-m" value="efectivo" checked><span>En efectivo</span></label><label class="chip-radio"><input type="radio" name="sb-m" value="personal"><span>Con plata del dueño</span></label></div>
    <div class="chips" role="radiogroup" aria-label="Documento"><label class="chip-radio"><input type="radio" name="sb-t" value="boleta" checked><span>Boleta en papel</span></label><label class="chip-radio"><input type="radio" name="sb-t" value="sin"><span>Sin documento</span></label></div>
    <div class="gn-dos"><div class="campo"><label for="sb-fecha">Fecha</label><input id="sb-fecha" type="date" value="${hoy}" max="${hoy}"></div><div class="campo"><label for="sb-monto">Monto</label><input id="sb-monto" type="number" min="1" inputmode="numeric"></div></div>
    <div class="campo"><label for="sb-prov">A quién se le pagó</label><input id="sb-prov" list="sb-provs" maxlength="120" autocomplete="off"><datalist id="sb-provs">${provs.map(p => `<option value="${H.esc(p.razon)}">`).join('')}</datalist></div>
    <div class="gn-dos"><div class="campo"><label for="sb-rut">RUT (opcional)</label><input id="sb-rut" maxlength="14"></div><div class="campo"><label for="sb-folio">N° de boleta (opcional)</label><input id="sb-folio" maxlength="30"></div></div>
    <div class="campo"><label for="sb-nota">Qué se compró (opcional)</label><input id="sb-nota" maxlength="120"></div>
    ${campoFotoHtml(H, 'sb')}
    ${camposClasif(H, null, 'sb')}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Registrar</button></div></form>`);
  const leer = conectarClasif(dlg, H, null, 'sb'); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const a = leer(), v = id => dlg.querySelector(id).value, medio = dlg.querySelector('[name=sb-m]:checked').value; a.item = itemValido(a.item);
      const areas = a.repartoId && st.D.repartos[a.repartoId] ? st.D.repartos[a.repartoId].areas : a.areas;
      const foto = await subirFotoDe(dlg, 'sb', { fecha: v('#sb-fecha'), razon: v('#sb-prov'), monto: v('#sb-monto') }, dlg.querySelector('[type=submit]'));
      await (await fsGN()).registrarSinBanco({ foto, medio, tipo: dlg.querySelector('[name=sb-t]:checked').value, fecha: v('#sb-fecha'), monto: v('#sb-monto'), proveedor: v('#sb-prov'), rut: v('#sb-rut'), folio: v('#sb-folio'), nota: v('#sb-nota'), item: a.item, areas, repartoId: a.repartoId });
      dlg.close(); H.registrar('Gastos: registró un gasto sin banco', `${v('#sb-prov')} · ${v('#sb-monto')} · ${medio}`);
      aviso(el, H, `Registrado: ${H.esc(v('#sb-prov'))} · ${H.pesos(Number(v('#sb-monto')))} ${medio === 'personal' ? 'con plata del dueño (queda en Por pagar → "Cuenta con el dueño")' : 'en efectivo'}.`); }
    catch (e) { falla(dlg, e, H); } });
}

// ═══════════════ v0.102.0 · Catálogo de ítems (Gastos → Ítems) ═══════════════
// Cada ítem apunta a una cuenta del plan de cuentas (plan-cuentas.js): la cuenta dice dónde va en los estados financieros. Finanzas lee
// de aquí (ya no de Finanzas → Clasificación). El paso desde la lista de siempre se hace una vez, con una vista previa.
const TXT_ITEMS = 'Cada ítem apunta a una cuenta del plan de cuentas, y la cuenta dice dónde va en los estados financieros: en qué línea del estado de resultados, o si va al inventario, al activo fijo o fuera del resultado (balance y flujo de caja). Así nada se clasifica dos veces.\nEl ítem dice qué es; el área o el reparto dicen dónde (por eso hay un solo LUZ, no uno por local).\nNada se borra: un ítem que sobra se archiva, y si tiene reemplazo apunta a él. Los documentos ya clasificados con el nombre antiguo cuentan con el nuevo.\nCambiar la cuenta de un ítem rige para los meses abiertos. Un mes cerrado no cambia: la diferencia entra como "Ajustes de meses cerrados".';
const TXT_REVISAR_IT = 'Nombres que se usan en documentos, fichas o compromisos y no llegan a un ítem del catálogo con cuenta. Mientras no se ubiquen, su gasto queda "sin clasificar" en el estado de resultados.\nUbicar: decir a qué ítem del catálogo pasa (lo más común) o crearlo como ítem nuevo con su grupo y su cuenta.';
const TXT_PREVIA = 'Lo que pasa al confirmar:\n• Se crea el catálogo aprobado el 25 de octubre (y los ítems del sistema: F29, Previred y créditos, con su cuenta fija).\n• Cada nombre de la lista anterior queda archivado y, si tiene reemplazo, apunta al nuevo. Los documentos ya clasificados no se reescriben: cuentan con el ítem nuevo.\n• Las fichas de los proveedores y los compromisos pasan al nombre nuevo, con su historial.\n• OTROS INSUMOS no tiene un reemplazo único (parte es packaging, parte aseo): se decide por proveedor, y solo esos documentos se cambian.\n• Desde ese momento, Finanzas lee el tipo de cada gasto desde la cuenta del ítem (Finanzas → Clasificación queda solo como historial).';
const catI = () => (st.D && GI.activo(st.D.catalogo) ? GI.indice(st.D.catalogo) : null);
// El ítem escrito o elegido → el nombre que se guarda (un nombre antiguo pasa al nuevo). Sin catálogo todavía: tal cual.
function itemValido(t, sistema = false) { const I = catI(); if (!I) return String(t || '').trim(); const r = GI.entrada(t, I, { sistema }); if (r.error) throw new Error(r.error); return r.nombre; }
function conItemsValidos(a, sistema = false) {
  const f = x => (String(x || '').trim() ? itemValido(x, sistema) : '');
  const general = { ...a.general, item: f(a.general && a.general.item) };
  return { ...a, general, partes: (a.partes || []).map(p => ({ ...p, item: f(p.item) || general.item })), lineas: a.lineas ? a.lineas.map(l => ({ ...l, item: f(l.item) || general.item })) : a.lineas };
}
const NOMBRE_TIPO = t => (t && FR.TIPO[t] ? FR.TIPO[t].corto : 'Sin clasificar');
const GRUPO_TXT = { costo: 'En el resultado', compra: 'Compras (inventario)', margen: 'Ya en el margen', fuera: 'Fuera del resultado', sin: 'Sin clasificar' };
const grupoDeTipo = t => (t && FR.TIPO[t] ? FR.TIPO[t].grupo : 'sin');
const lineasCrudas = () => GF.gastosParaFinanzas(st.D, st.D.inicio || INICIO(), { conCatalogo: false }).lineas;

function itemsHtml(H) {
  const D = st.D, cat = D.catalogo || [];
  if (!GI.activo(cat)) return previaHtml(H);
  const I = GI.indice(cat), U = GI.usos({ lineas: lineasCrudas(), provs: D.provs, comps: D.compromisos }), rev = GI.porRevisar(U, I);
  // Uso de cada ítem activo: lo suyo y lo de los nombres antiguos que apuntan a él
  const uso = {}; Object.values(U).forEach(u => { const r = GI.resolver(u.nombre, I); if (!r.ok) return; const k = GN.norm(r.nombre), x = uso[k] || (uso[k] = { docs: 0, fichas: 0, comps: 0, monto: 0 }); x.docs += u.docs; x.fichas += u.fichas; x.comps += u.comps; x.monto += u.monto; });
  const usoTxt = n => { const x = uso[GN.norm(n)]; if (!x || !(x.docs + x.fichas + x.comps)) return 'sin uso todavía'; return [x.docs ? `${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'} (${H.pesos(x.monto)})` : '', x.fichas ? `${x.fichas} ${x.fichas === 1 ? 'ficha' : 'fichas'}` : '', x.comps ? `${x.comps} ${x.comps === 1 ? 'compromiso' : 'compromisos'}` : ''].filter(Boolean).join(' · '); };
  const activos = GI.ordenar(cat.filter(x => x.estado !== 'archivado' && !x.sistema)), sistema = cat.filter(x => x.sistema), archivados = cat.filter(x => x.estado === 'archivado').sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const filaItem = x => `<div class="gn-it gn-item"><div class="gn-fila"><b>${H.esc(x.nombre)}</b><span class="chip ${PC.existe(x.cuenta) ? 'c-gris' : 'c-rojo'} chip-chico">${H.esc(PC.existe(x.cuenta) ? x.cuenta : 'sin cuenta')}</span></div>
    <small>${H.esc(PC.nombre(x.cuenta) || 'Sin cuenta')} · ${H.esc(PC.dondeVa(x.cuenta))}${x.area ? ' · área sugerida ' + H.esc(x.area) : ''}</small><small class="gn-uso">${H.esc(usoTxt(x.nombre))}</small>${tribBloque(H, 'item', x.nombre, x.nombre)}
    <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-item="${H.esc(x.id)}">Cambiar</button><button type="button" class="btn-sec btn-chico" data-gn-archivaritem="${H.esc(x.id)}">Archivar</button></div></div>`;
  const MOT = { desconocido: 'no está en el catálogo', archivado: 'está archivado sin reemplazo', sin_cuenta: 'no tiene cuenta' };
  return `${rev.length ? `<section class="tarjeta gn-revisar-it" aria-labelledby="t-gn-revit"><div class="titulo-fila"><h2 id="t-gn-revit">Revisar ítem · ${rev.length} ${H.info('Revisar ítem', TXT_REVISAR_IT)}</h2></div>
      ${rev.map(x => `<div class="gn-it"><div class="gn-fila"><b>${H.esc(x.nombre)}</b><span class="gn-m">${H.pesos(x.monto)}</span></div><small>${H.esc(MOT[x.motivo] || '')} · ${[x.docs ? `${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'}` : '', x.fichas ? `${x.fichas} ${x.fichas === 1 ? 'ficha' : 'fichas'}` : '', x.comps ? `${x.comps} ${x.comps === 1 ? 'compromiso' : 'compromisos'}` : ''].filter(Boolean).join(' · ')}</small>
        <div class="gn-acc"><button type="button" class="btn btn-chico" data-gn-ubicar="${H.esc(x.nombre)}">Ubicar</button></div></div>`).join('')}</section>` : ''}
    <section class="tarjeta" aria-labelledby="t-gn-items"><div class="titulo-fila"><h2 id="t-gn-items">Ítems ${H.info('Catálogo de ítems', TXT_ITEMS)}</h2><button type="button" class="btn btn-chico" data-gn-item="">Nuevo ítem</button></div>
      <p class="ayuda">${activos.length} ítems en ${GI.GRUPOS.filter(g => activos.some(x => x.grupo === g)).length} grupos. Cada uno con su cuenta del plan.</p>
      ${GI.GRUPOS.map(g => { const l = activos.filter(x => x.grupo === g); return l.length ? `<h3 class="gn-h3">${H.esc(g)}</h3>${l.map(filaItem).join('')}` : ''; }).join('')}
      <details class="gn-det"><summary>Del sistema · ${sistema.length} (cuenta fija)</summary>${sistema.map(x => `<div class="gn-fila gn-fila-doc"><span><b>${H.esc(x.nombre)}</b> · ${H.esc(PC.texto(x.cuenta))}</span><small>${H.esc(usoTxt(x.nombre))}</small></div>`).join('')}
        <p class="ayuda">Los crean el F29, Previred, los créditos y el ajuste de un compromiso. ${sistema.filter(x => x.elegible).map(x => H.esc(x.nombre)).join(' y ')} también se pueden elegir a mano.</p></details>
      ${archivados.length ? `<details class="gn-det"><summary>Archivados · ${archivados.length}</summary>${archivados.map(x => `<div class="gn-fila gn-fila-doc gn-archivado"><span><b>${H.esc(x.nombre)}</b> · ${x.pasaA ? 'pasa a ' + H.esc(x.pasaA) : 'sin reemplazo'}</span>${x.grupo && PC.existe(x.cuenta) ? `<button type="button" class="gn-link" data-gn-reactivaritem="${H.esc(x.id)}">Reactivar</button>` : ''}</div>`).join('')}</details>` : ''}
    </section>`;
}

// ── El paso al catálogo nuevo: vista previa y confirmar ──
async function abrirPrevia(el, H) {
  if (st.ocupado) return; st.ocupado = true;
  try {
    const fin = await (await fsGN()).leerFinItems(), D = st.D, lineas = lineasCrudas();
    const tipoAntes = n => FR.tipoResultado(n, fin, null, true).tipo;
    const plan = GI.planMigracion({ viejos: D.itemsViejos || [], lineas, docs: D.docs, provs: D.provs, comps: D.compromisos, tipoAntes });
    st.previa = { plan, lineas, tipoAntes, dec: { otros: Object.fromEntries(plan.otros.grupos.filter(g => g.sugerido).map(g => [g.clave, g.sugerido])), revisar: {} } };
  } catch (e) { st.err = H.esc(e.message || H.mensajeError(e)); }
  finally { st.ocupado = false; }
  repintarQuieto(el, H);
}
// El total del mes por dónde queda (antes: Finanzas → Clasificación; después: la cuenta del ítem nuevo)
function totalesPrevia() {
  const P = st.previa, pl = P.plan, dec = P.dec, cat = pl.crear.concat(pl.archivar.map(x => ({ nombre: x.nombre, estado: 'archivado', pasaA: x.pasaA })))
    .concat(Object.entries(dec.revisar).filter(([, v]) => v).map(([k, v]) => ({ nombre: (pl.revisar.find(r => GN.norm(r.nombre) === k) || {}).nombre || k, estado: 'archivado', pasaA: v })));
  const I = GI.indice(cat), docPor = Object.fromEntries((st.D.docs || []).map(d => [d.id, d])), out = {};
  const sumar = (mes, lado, g, v) => { const m = out[mes] || (out[mes] = { antes: {}, despues: {}, total: 0 }); m[lado][g] = (m[lado][g] || 0) + v; };
  P.lineas.forEach(l => {
    const n = l.itemOriginal || l.itemGasto, mes = String(l.fecha).slice(0, 7), v = Number(l.montoNeto) || 0, d = docPor[l.docId];
    let nuevo = GN.norm(n) === GN.norm(GI.OTROS_INSUMOS) ? (dec.otros[d ? GI.claveGrupo(d, st.D.provs) : ''] || '') : n;
    const r = nuevo ? GI.resolver(nuevo, I) : { ok: false };
    sumar(mes, 'antes', grupoDeTipo(P.tipoAntes(n)), v); sumar(mes, 'despues', r.ok ? grupoDeTipo(PC.tipoDeCuenta(r.cuenta)) : 'sin', v); out[mes].total += v;
  });
  return out;
}
function previaHtml(H) {
  const intro = `<section class="tarjeta" aria-labelledby="t-gn-cat"><div class="titulo-fila"><h2 id="t-gn-cat">Catálogo de ítems ${H.info('Pasar al catálogo nuevo', TXT_PREVIA)}</h2></div>
    <p>Desde esta versión, cada ítem apunta a una cuenta del plan de cuentas y Finanzas lee de ahí. Es el catálogo que usted aprobó el 25 de octubre (9 grupos; "personal" se dice "trabajadores").</p>
    <p class="ayuda">Antes de pasar, revise la vista previa: qué pasa solo, qué necesita su decisión y cómo queda el total de cada mes. Nada cambia hasta que confirme.</p>
    ${st.previa ? '' : '<button type="button" class="btn" data-gn-previa>Ver la vista previa</button>'}</section>`;
  if (!st.previa) return intro;
  const P = st.previa, pl = P.plan, dec = P.dec, sel = (k, v, nombre) => `<select data-gn-pv-rev="${H.esc(k)}" aria-label="Pasa a, para ${H.esc(nombre)}"><option value="">Dejar para después (Revisar ítem)</option>${GI.GRUPOS.map(g => `<optgroup label="${H.esc(g)}">${GI.CATALOGO.filter(x => x.grupo === g).map(x => `<option value="${H.esc(x.nombre)}" ${x.nombre === v ? 'selected' : ''}>${H.esc(x.nombre)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const usosTxt = x => [x.docs ? `${x.docs} ${x.docs === 1 ? 'documento' : 'documentos'}` : '', x.fichas ? `${x.fichas} ${x.fichas === 1 ? 'ficha' : 'fichas'}` : '', x.comps ? `${x.comps} ${x.comps === 1 ? 'compromiso' : 'compromisos'}` : ''].filter(Boolean).join(' · ') || 'sin uso';
  const cambio = x => { const a = grupoDeTipo(x.antes), b = grupoDeTipo(PC.tipoDeCuenta(x.cuenta)); return a !== b && x.monto ? ` · <b class="gn-cambia">antes ${H.esc(GRUPO_TXT[a].toLowerCase())}, ahora ${H.esc(GRUPO_TXT[b].toLowerCase())}</b>` : ''; };
  const faltan = pl.otros.grupos.filter(g => !dec.otros[g.clave]).length;
  const T = totalesPrevia(), meses = Object.keys(T).sort(), G = ['costo', 'compra', 'margen', 'fuera', 'sin'];
  const tabla = m => { const x = T[m], fila = g => (x.antes[g] || x.despues[g]) ? `<tr><th scope="row">${GRUPO_TXT[g]}</th><td class="gn-num">${H.pesos(x.antes[g] || 0)}</td><td class="gn-num">${H.pesos(x.despues[g] || 0)}</td></tr>` : '';
    return `<div class="gn-pv-mes"><h3 class="gn-h3">${H.esc(GF.mesCorto(m))}</h3><table class="gn-pv-tabla"><thead><tr><th scope="col">Dónde queda</th><th scope="col" class="gn-num">Antes</th><th scope="col" class="gn-num">Después</th></tr></thead><tbody>${G.map(fila).join('')}
      <tr class="gn-pv-tot"><th scope="row">Total del mes</th><td class="gn-num">${H.pesos(G.reduce((a, g) => a + (x.antes[g] || 0), 0))}</td><td class="gn-num">${H.pesos(G.reduce((a, g) => a + (x.despues[g] || 0), 0))}</td></tr></tbody></table></div>`; };
  return intro + `<section class="tarjeta" aria-labelledby="t-gn-pv1"><div class="titulo-fila"><h2 id="t-gn-pv1">Vista previa</h2><button type="button" class="btn-sec btn-chico" data-gn-previa-cerrar>Cerrar</button></div>
      <p>Se crean <b>${pl.crear.filter(x => !x.sistema).length} ítems</b> en 9 grupos y <b>${pl.crear.filter(x => x.sistema).length} del sistema</b>. Se archivan <b>${pl.archivar.length} nombres</b> de la lista anterior (${pl.archivar.filter(x => x.pasaA).length} con su reemplazo).</p>
      <h3 class="gn-h3">El total de cada mes, antes y después</h3>
      <div class="gn-pv-meses">${meses.length ? meses.map(tabla).join('') : '<p class="ayuda">Todavía no hay gastos clasificados desde el inicio.</p>'}</div>
      <p class="ayuda">El total no cambia: solo cambia dónde queda cada peso. "Antes" es lo que decía Finanzas → Clasificación; "después", la cuenta del ítem nuevo.</p></section>
    ${pl.otros.grupos.length ? `<section class="tarjeta" aria-labelledby="t-gn-pv2"><div class="titulo-fila"><h2 id="t-gn-pv2">OTROS INSUMOS · ${H.pesos(pl.otros.monto)}</h2><span>${faltan ? `${faltan} por decidir` : 'decidido'}</span></div>
      <p class="ayuda">Antes contaba como "${H.esc(NOMBRE_TIPO(pl.otros.antes))}"${grupoDeTipo(pl.otros.antes) === 'compra' ? ': no entraba al resultado, porque no está en ninguna receta' : ''}. Elija, por proveedor, a qué pasa. Lo que elija queda en su ficha y en sus documentos.</p>
      ${pl.otros.grupos.map(g => `<div class="gn-it" data-gn-pv-grupo="${H.esc(g.clave)}"><div class="gn-fila"><b>${H.esc(g.razon)}</b><span class="gn-m">${H.pesos(g.monto)}</span></div>
        <small>${g.docs.length ? `${g.docs.length} ${g.docs.length === 1 ? 'documento' : 'documentos'}` : 'sin documentos desde el inicio'}${g.ficha ? ' · su ficha recuerda OTROS INSUMOS' : ''}${g.sugerido ? ` · sugerido por el detalle: ${H.esc(g.sugerido)}` : ''}</small>
        ${g.docs.some(x => x.detalle.length) ? `<details class="gn-detalle"><summary>Ver el detalle</summary><ul>${g.docs.map(x => `<li><span>${H.esc(x.tipo)} ${H.esc(x.folio)} · ${H.esc(H.diaTexto(x.fecha))}: ${H.esc(x.detalle.join(', ') || 'sin detalle')}</span><span class="gn-m">${H.pesos(x.monto)}</span></li>`).join('')}</ul></details>` : ''}
        <div class="chips" role="radiogroup" aria-label="OTROS INSUMOS de ${H.esc(g.razon)} pasa a">${GI.OPCIONES_OTROS.map(o => `<label class="chip-radio"><input type="radio" name="pv-${H.esc(g.clave)}" value="${H.esc(o)}" data-gn-pv-otro="${H.esc(g.clave)}" ${dec.otros[g.clave] === o ? 'checked' : ''}><span>${H.esc(o)}</span></label>`).join('')}</div></div>`).join('')}</section>` : ''}
    ${pl.revisar.length ? `<section class="tarjeta" aria-labelledby="t-gn-pv3"><div class="titulo-fila"><h2 id="t-gn-pv3">Para ubicar · ${pl.revisar.length}</h2></div>
      <p class="ayuda">Nombres en uso que no están en la tabla aprobada. Elija a qué ítem pasan, o déjelos para después: quedan en "Revisar ítem" y su gasto, sin clasificar, hasta ubicarlos.</p>
      ${pl.revisar.map(x => `<div class="gn-it"><div class="gn-fila"><b>${H.esc(x.nombre)}</b><span class="gn-m">${H.pesos(x.monto)}</span></div><small>${H.esc(usosTxt(x))} · ${H.esc(x.motivo)} · antes: ${H.esc(NOMBRE_TIPO(x.antes))}</small>
        <div class="campo"><label class="sr" for="pv-r-${H.esc(GI.claveItem(x.nombre))}">Pasa a</label>${sel(GN.norm(x.nombre), dec.revisar[GN.norm(x.nombre)] || '', x.nombre).replace('<select', `<select id="pv-r-${H.esc(GI.claveItem(x.nombre))}"`)}</div></div>`).join('')}</section>` : ''}
    <section class="tarjeta" aria-labelledby="t-gn-pv4"><div class="titulo-fila"><h2 id="t-gn-pv4">Pasan solos · ${pl.pasan.length}</h2></div>
      <p class="ayuda">Los nombres en uso con su reemplazo en la tabla aprobada. Sus documentos no se reescriben: cuentan con el ítem nuevo.</p>
      ${pl.pasan.map(x => `<div class="gn-fila gn-fila-doc"><span><b>${H.esc(x.viejo)}</b>${GN.norm(x.viejo) !== GN.norm(x.nuevo) ? ` → ${H.esc(x.nuevo)}` : ' (queda igual)'} · ${H.esc(PC.texto(x.cuenta))}<br><small>${H.esc(usosTxt(x))}${cambio(x)}</small></span><span class="gn-m">${x.monto ? H.pesos(x.monto) : ''}</span></div>`).join('') || '<p class="ayuda">Ninguno.</p>'}
      ${pl.sinUso.length ? `<details class="gn-det"><summary>Se archivan sin uso · ${pl.sinUso.length}</summary><p class="ayuda">${H.esc(pl.sinUso.join(' · '))}</p></details>` : ''}</section>
    <section class="tarjeta" aria-labelledby="t-gn-pv5"><h2 id="t-gn-pv5">Confirmar</h2>
      <p class="ayuda">${faltan ? `Falta decidir OTROS INSUMOS de ${faltan} ${faltan === 1 ? 'proveedor' : 'proveedores'}.` : 'Todo listo. Nada se borra: los nombres antiguos quedan archivados y cada cambio queda en el historial de su ficha o documento.'}</p>
      <button type="button" class="btn" data-gn-pasar ${faltan ? 'disabled' : ''}>Pasar al catálogo nuevo</button></section>`;
}
async function pasarCatalogo(el, H) {
  const P = st.previa; if (!P || P.plan.otros.grupos.some(g => !P.dec.otros[g.clave])) return;
  return hacer(el, H, async () => { const r = await (await fsGN()).aplicarCatalogo(P.plan, P.dec); st.previa = null; H.registrar('Gastos: pasó al catálogo nuevo de ítems', `${r.items} ítems · ${r.fichas} fichas · ${r.documentos} documentos`); st.ultimoPaso = r; },
    'Listo: el catálogo nuevo está activo. Las fichas, los compromisos y los documentos de OTROS INSUMOS pasaron al nombre nuevo. Finanzas ya lee la cuenta de cada ítem.');
}
// ── Crear o cambiar un ítem ──
function selCuenta(H, id, v) {
  const sec = {}; PC.CODIGOS.forEach(c => { const k = PC.seccion(c); (sec[k] = sec[k] || []).push(c); });
  return `<select id="${id}"><option value="">Elija la cuenta</option>${Object.entries(sec).map(([k, l]) => `<optgroup label="${H.esc(k)}">${l.map(c => `<option value="${c}" ${c === v ? 'selected' : ''}>${H.esc(PC.texto(c))}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function dlgItem(el, H, id) {
  const x = id ? (st.D.catalogo || []).find(i => i.id === id) : null;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${x ? H.esc(x.nombre) : 'Nuevo ítem'}</h2>${H.info('Catálogo de ítems', TXT_ITEMS)}</div>
    ${x ? '<p class="ayuda">El nombre no cambia: para otro nombre, cree un ítem nuevo y archive este con su reemplazo.</p>' : '<div class="campo"><label for="it-nombre">Nombre</label><input id="it-nombre" maxlength="60" placeholder="Por ejemplo: SEGUROS" autocomplete="off"></div>'}
    <div class="campo"><label for="it-grupo">Grupo</label><select id="it-grupo"><option value="">Elija el grupo</option>${GI.GRUPOS.map(g => `<option ${x && x.grupo === g ? 'selected' : ''}>${H.esc(g)}</option>`).join('')}</select></div>
    <div class="campo"><label for="it-cuenta">Cuenta</label>${selCuenta(H, 'it-cuenta', x ? x.cuenta : '')}<p class="ayuda" data-donde></p></div>
    <div class="campo"><label for="it-area">Área sugerida (opcional)</label><select id="it-area"><option value="">Ninguna</option>${AR.GASTO_GN.map(a => `<option value="${a}" ${x && x.area === a ? 'selected' : ''}>${H.esc(nombreArea(a))}</option>`).join('')}</select></div>
    ${x ? '<p class="ayuda">Un cambio de cuenta rige para los meses abiertos. Un mes cerrado no cambia: la diferencia entra como "Ajustes de meses cerrados".</p>' : ''}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const cu = dlg.querySelector('#it-cuenta'), donde = () => { dlg.querySelector('[data-donde]').textContent = cu.value ? PC.dondeVa(cu.value) + (PC.CUENTAS[cu.value] && PC.CUENTAS[cu.value].ayuda ? '. ' + PC.CUENTAS[cu.value].ayuda : '') : ''; };
  cu.addEventListener('change', donde); donde(); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const v = q => (dlg.querySelector(q) || {}).value || '';
      await (await fsGN()).guardarItem(x ? x.id : '', { nombre: x ? x.nombre : v('#it-nombre'), grupo: v('#it-grupo'), cuenta: v('#it-cuenta'), area: v('#it-area') });
      dlg.close(); H.registrar(x ? 'Gastos: cambió un ítem' : 'Gastos: creó un ítem', x ? x.nombre : v('#it-nombre')); aviso(el, H, x ? `Ítem cambiado: ${H.esc(x.nombre)} · ${H.esc(PC.texto(v('#it-cuenta')))}.` : `Ítem creado: ${H.esc(v('#it-nombre').toUpperCase())}. Ya se puede elegir al clasificar.`); }
    catch (e) { falla(dlg, e, H); } });
}
const opcionesActivos = (H, excepto) => GI.GRUPOS.map(g => { const l = GI.ordenar((st.D.catalogo || []).filter(x => x.estado !== 'archivado' && !x.sistema && x.grupo === g && x.id !== excepto)); return l.length ? `<optgroup label="${H.esc(g)}">${l.map(x => `<option value="${H.esc(x.nombre)}">${H.esc(x.nombre)}</option>`).join('')}</optgroup>` : ''; }).join('');
function dlgArchivarItem(el, H, id) {
  const x = (st.D.catalogo || []).find(i => i.id === id); if (!x) return;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Archivar ${H.esc(x.nombre)}</h2></div>
    <p class="ayuda">No se borra: deja de aparecer al clasificar. Si tiene reemplazo, sus documentos ya clasificados cuentan con el nuevo, y las fichas y compromisos que lo usan pasan al nuevo (con su historial). Sin reemplazo, lo que lo use queda en "Revisar ítem".</p>
    <div class="campo"><label for="ai-pasa">Pasa a</label><select id="ai-pasa"><option value="">Sin reemplazo</option>${opcionesActivos(H, x.id)}</select></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Archivar</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const pasa = dlg.querySelector('#ai-pasa').value, n = await (await fsGN()).archivarItem(x.id, { archivar: true, pasaA: pasa }); dlg.close(); H.registrar('Gastos: archivó un ítem', `${x.nombre}${pasa ? ' → ' + pasa : ''}`);
      aviso(el, H, `Archivado: ${H.esc(x.nombre)}${pasa ? ` · pasa a ${H.esc(pasa)}${n ? ` (${n} ${n === 1 ? 'ficha o compromiso cambió' : 'fichas o compromisos cambiaron'})` : ''}` : ''}.`); }
    catch (e) { falla(dlg, e, H); } });
}
function dlgUbicar(el, H, nombre) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Ubicar ${H.esc(nombre)}</h2>${H.info('Revisar ítem', TXT_REVISAR_IT)}</div>
    <div class="chips" role="radiogroup" aria-label="Cómo"><label class="chip-radio"><input type="radio" name="ub-m" value="pasa" checked><span>Pasa a un ítem del catálogo</span></label><label class="chip-radio"><input type="radio" name="ub-m" value="nuevo"><span>Es un ítem nuevo</span></label></div>
    <div data-ub="pasa" class="gn-dlg-bloque"><div class="campo"><label for="ub-pasa">Pasa a</label><select id="ub-pasa"><option value="">Elija el ítem</option>${opcionesActivos(H, '')}</select></div><p class="ayuda">Sus documentos ya clasificados cuentan con ese ítem; no se reescriben.</p></div>
    <div data-ub="nuevo" class="gn-dlg-bloque" hidden><div class="campo"><label for="ub-grupo">Grupo</label><select id="ub-grupo"><option value="">Elija el grupo</option>${GI.GRUPOS.map(g => `<option>${H.esc(g)}</option>`).join('')}</select></div>
      <div class="campo"><label for="ub-cuenta">Cuenta</label>${selCuenta(H, 'ub-cuenta', '')}</div></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const modo = () => dlg.querySelector('[name=ub-m]:checked').value;
  dlg.querySelectorAll('[name=ub-m]').forEach(r => r.addEventListener('change', () => { dlg.querySelectorAll('[data-ub]').forEach(b => { b.hidden = b.dataset.ub !== modo(); }); }));
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const v = q => dlg.querySelector(q).value, F = await fsGN();
      if (modo() === 'pasa') { if (!v('#ub-pasa')) throw new Error('Elija el ítem.'); await F.ubicarItem(nombre, { pasaA: v('#ub-pasa') }); }
      else await F.ubicarItem(nombre, { grupo: v('#ub-grupo'), cuenta: v('#ub-cuenta') });
      dlg.close(); H.registrar('Gastos: ubicó un ítem', `${nombre} → ${modo() === 'pasa' ? v('#ub-pasa') : 'ítem nuevo ' + v('#ub-cuenta')}`); aviso(el, H, `Ubicado: ${H.esc(nombre)}${modo() === 'pasa' ? ' pasa a ' + H.esc(v('#ub-pasa')) : ' es un ítem nuevo (' + H.esc(PC.texto(v('#ub-cuenta'))) + ')'}.`); }
    catch (e) { falla(dlg, e, H); } });
}

// ═══════════════ v0.103.0 · Flete de compra: ¿de qué compra es? ═══════════════
const TXT_FLETE = 'El flete de una compra es parte de lo que cuesta lo comprado: la harina de Santiago cuesta su precio más traerla.\nUna el flete con la compra (o las compras) que trajo: se reparte entre ellas según su valor, y cada parte sigue a lo comprado. El flete de una materia prima sube su precio (y el costo de las recetas que la usan); el de packaging es packaging; el de un equipo, parte del equipo.\nMientras no se une, queda como inventario (no entra al resultado) y el cierre de mes lo avisa.';
const diasEntre = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
function dlgFlete(el, H, id) {
  const d = (st.D.docs || []).find(x => x.id === id); if (!d) return;
  const ya = new Set((d.flete && d.flete.docs) || []), esFl = x => (((GB.clasifDe(x, st.D.provs || {}, st.D.repartos || {}) || {}).partes) || []).some(p => GN.norm(p.item) === GN.norm(GI.FLETE));
  const cand = (st.D.docs || []).filter(x => x.id !== d.id && x.estado !== 'no_va' && !x.nc && GB.baseDe(x) > 0 && !esFl(x) && (ya.has(x.id) || (diasEntre(x.fecha, d.fecha) >= -90 && diasEntre(x.fecha, d.fecha) <= 30)))
    .sort((a, b) => (ya.has(b.id) - ya.has(a.id)) || Math.abs(diasEntre(a.fecha, d.fecha)) - Math.abs(diasEntre(b.fecha, d.fecha))).slice(0, 120);
  const dlg = H.dialogo(`<form class="form-dialogo gn-dlg-ancho" novalidate><div class="titulo-fila"><h2>¿De qué compra es este flete?</h2>${H.info('Flete de compra', TXT_FLETE)}</div>
    <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto)} ${H.esc(d.folio || '')} · ${H.esc(H.diaTexto(d.fecha))} · flete ${H.pesos(GB.baseDe(d))} neto</p>
    ${cand.length ? `<input type="search" data-gn-buscar placeholder="Buscar proveedor, folio o monto" aria-label="Buscar compra"><div class="gn-opcs">${cand.map(x => `<label class="gn-opc" data-txt="${H.esc(GN.norm(nom(x) + ' ' + x.folio + ' ' + GB.baseDe(x)))}"><input type="checkbox" value="${H.esc(x.id)}" ${ya.has(x.id) ? 'checked' : ''}><span><b>${H.esc(nom(x))}</b> <span class="gn-m">${H.pesos(GB.baseDe(x))}</span><small>${H.esc(x.tipoTexto)} ${H.esc(x.folio || '')} · ${H.esc(H.diaTexto(x.fecha))}${x.clasifEf || GB.clasifDe(x, st.D.provs || {}, st.D.repartos || {}) ? ' · ' + H.esc(GB.textoPartes((GB.clasifDe(x, st.D.provs || {}, st.D.repartos || {}) || {}).partes || [])) : ' · sin clasificar'}</small></span></label>`).join('')}</div>
      <p class="ayuda" data-suma></p>` : '<p class="ayuda">No hay compras cerca de la fecha del flete. Suba primero la factura de la compra.</p>'}
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button>${cand.length ? '<button type="submit" class="btn">Guardar</button>' : ''}</div></form>`);
  buscador(dlg); dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  const elegidos = () => Array.from(dlg.querySelectorAll('.gn-opc input:checked')).map(x => cand.find(c => c.id === x.value)).filter(Boolean);
  const suma = dlg.querySelector('[data-suma]'), pintar = () => { if (!suma) return; const l = elegidos(), t = l.reduce((a, x) => a + GB.baseDe(x), 0); suma.textContent = l.length ? `${l.length} ${l.length === 1 ? 'compra' : 'compras'} · ${H.pesos(t)} neto: el flete sube su costo en ${String(Math.round(GB.baseDe(d) / t * 1000) / 10).replace('.', ',')} %` : 'Sin compras elegidas: el flete queda por unir.'; };
  dlg.querySelectorAll('.gn-opc input').forEach(x => x.addEventListener('change', pintar)); pintar();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const l = elegidos(), n = await (await fsGN()).unirFlete(d.id, l.map(x => x.id)); dlg.close(); H.registrar('Gastos: unió un flete', `${nom(d)} → ${n} compras`);
      preciosDeMP(H); aviso(el, H, n ? `Flete unido: ${H.esc(nom(d))} se suma al costo de ${n === 1 ? H.esc(nom(l[0])) + ' N° ' + H.esc(l[0].folio) : n + ' compras'}.` : 'Flete desunido: queda por unir a su compra.'); }
    catch (e) { falla(dlg, e, H); } });
}

// ═══════════════ v0.104.0 · Ficha del trabajador y provisión ═══════════════
const TXT_TRAB = 'Los datos de su contrato (en su contrato de trabajo): fecha de ingreso, tipo (plazo fijo o indefinido) y, si es a plazo fijo, hasta cuándo. El sueldo sale solo de sus liquidaciones.\nCon esto el sistema calcula su antigüedad, avisa en Hoy cuando un plazo fijo está por vencer y provisiona cada mes sus vacaciones (con reemplazo) y, si es indefinido, su indemnización por años de servicio.\nPor ley, un plazo fijo que se renueva por segunda vez, o en que el trabajador sigue después del vencimiento, pasa a ser indefinido.';
const TXT_PROV = 'La liquidación de quien reemplaza a alguien en sus vacaciones, o un finiquito, ya se cargó al resultado mes a mes (provisión de vacaciones y finiquitos). Márquelo aquí para que no se cuente dos veces: sale de lo acumulado.\nSe puede cambiar o quitar después; queda en el historial.';
const mesActual = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }).slice(0, 7);
function trabajadorHtml(H, base, razon, rut) {
  const x = TR.equipo(st.D).find(t => t.clave === base); if (!x) return '';
  const t = x.ficha, hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }), ult = x.liqs[x.liqs.length - 1], ant = t ? TR.antiguedad(t.ingreso, hoy) : null, e = TR.estadoContrato(t, hoy);
  const areas = clave => GB.areasDe((st.D.provs || {})[clave], st.D.repartos || {}), ini = (st.D.inicio || INICIO()).slice(0, 7), S = TR.saldo(st.D, ini, mesActual(), areas).porTrabajador[base] || { prov: 0, usado: 0 };
  const pm = ult ? TR.provisionMes(t, x.liqs, ult.mes) : null, antes = TR.iasAntesDe(t, x.liqs, st.D.inicio || INICIO());
  const fila = (k, v) => `<div class="gn-fila"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="gn-it gn-trab"><span class="gn-sub">Trabajador ${H.info('Datos del trabajador', TXT_TRAB)}</span>
    ${t ? `${t.cargo ? fila('Cargo', H.esc(t.cargo)) : ''}${fila('Ingreso', `${H.esc(TR.fechaTxt(t.ingreso))} · ${H.esc(ant.texto)}`)}${fila('Contrato', H.esc(TR.CONTRATOS[t.contrato]))}
      <p class="${e.nivel === 'vencido' ? 'gn-cl gn-cl-falta' : e.nivel === 'pronto' ? 'gn-cl gn-aviso-c' : 'ayuda'}">${H.esc(e.texto)}</p>` : '<p class="gn-cl gn-cl-falta">Faltan los datos de su contrato: sin ellos no se provisiona su indemnización ni se avisa el vencimiento.</p>'}
    ${ult ? fila(`Sueldo base (${H.esc(GF.mesCorto(ult.mes))})`, H.pesos(TR.sueldoBase(ult))) + fila('Remuneración (promedio de hasta 3 meses)', H.pesos(TR.remuneracionBase(x.liqs, ult.mes))) : '<p class="ayuda">Sin liquidaciones desde el inicio.</p>'}
    ${pm ? fila('Provisión de cada mes', `${H.pesos(pm.total)} <small>(vacaciones ${H.pesos(pm.vac)}${pm.ias ? ` · años de servicio ${H.pesos(pm.ias)}` : ''})</small>`) : ''}
    ${S.prov || S.usado ? fila('Acumulado desde el inicio', `${H.pesos(S.prov)}${S.usado ? ` − usado ${H.pesos(S.usado)}` : ''}`) : ''}
    ${antes ? `<p class="ayuda">Antes del inicio ya llevaba años con contrato indefinido: unos ${H.pesos(antes)} de indemnización acumulada (estimado). Va al balance de apertura.</p>` : ''}
    <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-trab="${H.esc(base)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">${t ? 'Cambiar datos del trabajador' : 'Anotar datos del trabajador'}</button>${TR.terminado(x) ? '' : `<button type="button" class="btn-sec btn-chico gn-btn-termino" data-gn-termino="${H.esc(base)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">Término del contrato</button>`}</div></div>
    ${terminoHtml(H, x, base, razon, rut)}${docsTrabHtml(H, x, base, razon, rut)}`;
}
// v0.124.3 · El término del contrato, a la vista en la ficha
function terminoHtml(H, x, base, razon, rut) {
  if (!TR.terminado(x)) return '';
  const t = x.termino, fila = (k, v) => `<div class="gn-fila"><span>${k}</span><b>${v}</b></div>`, desp = TR.liqsDespues(x);
  return `<div class="gn-it gn-termino"><span class="gn-sub">Término del contrato</span>
    ${fila('Último día trabajado', H.esc(TR.fechaTxt(t.dia)))}${fila('Causa', H.esc(TR.CAUSAS[t.causa] || ''))}${t.firma ? fila('Finiquito', H.esc(TR.FIRMAS[t.firma])) : ''}
    ${t.monto ? fila('Monto del finiquito', H.pesos(t.monto)) : ''}${t.pagoDia || t.pagoComo ? fila('Pagado', H.esc([t.pagoDia ? TR.fechaTxt(t.pagoDia) : '', t.pagoComo].filter(Boolean).join(' · '))) : ''}
    ${t.nota ? `<p class="ayuda">${H.esc(t.nota)}</p>` : ''}
    ${desp.length ? `<p class="gn-cl gn-cl-falta">Hay ${desp.length === 1 ? 'una liquidación' : desp.length + ' liquidaciones'} de después del término (${H.esc(desp.map(l => GF.mesCorto(l.mes)).join(', '))}): revise la fecha.</p>` : ''}
    <p class="ayuda">Ya no avisa vencimientos de su contrato y su provisión deja de acumular (no hay más liquidaciones).</p>
    <div class="gn-acc"><button type="button" class="btn-sec btn-chico" data-gn-termino="${H.esc(base)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">Cambiar el término</button></div></div>`;
}
// v0.124.3 · Los documentos del trabajador (en Drive, privados); nada se borra
const TXT_DOCTRAB = 'El contrato, sus anexos y renovaciones, la carta de término o la renuncia, el finiquito y su comprobante de pago. Quedan en Google Drive, en la carpeta privada "Fën · Gastos / Comprobantes / <año>", con el nombre del trabajador y el tipo en el nombre del archivo; se abren solo con la cuenta de administración.\nNada se borra: un documento subido por error se marca "no va", con su motivo.';
function docsTrabHtml(H, x, base, razon, rut) {
  const l = (x.documentos || []).slice().sort((a, b) => String(b.fecha || b.en).localeCompare(String(a.fecha || a.en)));
  const vig = l.filter(d => d.estado !== 'no_va'), nova = l.filter(d => d.estado === 'no_va');
  const fila = d => `<div class="gn-doctrab${d.estado === 'no_va' ? ' gn-doctrab-nova' : ''}"><div><b>${H.esc(TR.TIPOS_DOC[d.tipo] || d.tipo)}</b><small>${[d.fecha ? H.esc(H.diaTexto(d.fecha)) : '', d.nota ? H.esc(d.nota) : '', d.estado === 'no_va' ? 'no va: ' + H.esc((d.noVa || {}).motivo || '') : ''].filter(Boolean).join(' · ')}</small></div>
      <div class="gn-acc"><a class="btn-sec btn-chico" href="${H.esc(d.url)}" target="_blank" rel="noopener">Ver<span class="sr"> (se abre en otra pestaña)</span></a>${d.estado === 'no_va' ? '' : `<button type="button" class="gn-link" data-gn-doctrab-nova="${H.esc(base)}" data-id="${H.esc(d.id)}">No va</button>`}</div></div>`;
  return `<div class="gn-it gn-docstrab"><div class="gn-fila"><span class="gn-sub">Documentos · ${vig.length} ${H.info('Documentos del trabajador', TXT_DOCTRAB)}</span><button type="button" class="btn btn-chico" data-gn-doctrab="${H.esc(base)}" data-razon="${H.esc(razon)}" data-rut="${H.esc(rut)}">Subir documento</button></div>
    ${vig.length ? vig.map(fila).join('') : `<p class="ayuda">Todavía no hay documentos.${TR.terminado(x) ? '' : ' Empiece por el contrato.'}</p>`}
    ${nova.length ? `<details class="gn-det"><summary>${nova.length} marcados "no va"</summary>${nova.map(fila).join('')}</details>` : ''}</div>`;
}
const isoHoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
// Sin volver a leer: se cambia la ficha que ya está en pantalla y se repinta
function enFicha(el, H, clave, razon, rut, cambios, msg) {
  const P = st.D.provs || (st.D.provs = {}); P[clave] = { ...(P[clave] || { razon, rut }), ...cambios };
  st.msg = msg; st.err = ''; repintarQuieto(el, H);
}
function dlgTermino(el, H, clave, razon, rut) {
  const x = TR.equipo(st.D).find(t => t.clave === clave) || { termino: null, ficha: null }, t = x.termino || {}, f = x.ficha || {};
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Término del contrato · ${H.esc(razon || x.nombre || '')}</h2></div>
    <p class="ayuda">${f.contrato ? H.esc(TR.CONTRATOS[f.contrato]) + (f.ingreso ? ' desde el ' + H.esc(TR.fechaTxt(f.ingreso)) : '') + (f.vence ? ' hasta el ' + H.esc(TR.fechaTxt(f.vence)) : '') + '. ' : ''}Al guardar pasa a Ex trabajadores: se apagan los avisos de su contrato y su provisión deja de acumular. Nada se borra.</p>
    <div class="gn-dos"><div class="campo"><label for="te-dia">Último día trabajado</label><input id="te-dia" type="date" value="${H.esc(t.dia || '')}"></div>
      <div class="campo"><label for="te-causa">Causa</label><select id="te-causa"><option value="">Elija la causa</option>${Object.entries(TR.CAUSAS).map(([k, v]) => `<option value="${k}" ${t.causa === k ? 'selected' : ''}>${H.esc(v)}</option>`).join('')}</select></div></div>
    <fieldset class="campo"><legend>Dónde se firmó el finiquito</legend><div class="chips" role="radiogroup" aria-label="Dónde se firmó el finiquito">${Object.entries(TR.FIRMAS).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="te-firma" value="${k}" ${t.firma === k ? 'checked' : ''}><span>${H.esc(v)}</span></label>`).join('')}</div></fieldset>
    <div class="gn-dos"><div class="campo"><label for="te-monto">Monto del finiquito (opcional)</label><input id="te-monto" inputmode="numeric" value="${t.monto ? H.esc(String(t.monto)) : ''}" placeholder="Ej: 350000"></div>
      <div class="campo"><label for="te-pago">Pagado el (opcional)</label><input id="te-pago" type="date" value="${H.esc(t.pagoDia || '')}"></div></div>
    <div class="campo"><label for="te-como">Cómo se pagó (opcional)</label><input id="te-como" maxlength="60" value="${H.esc(t.pagoComo || '')}" placeholder="Ej: vía DT, transferencia"></div>
    <div class="campo"><label for="te-nota">Nota (opcional)</label><input id="te-nota" maxlength="200" value="${H.esc(t.nota || '')}"></div>
    <p class="ayuda" data-te-aviso></p>
    <p class="error" data-err role="alert"></p>
    <div class="botones">${x.termino ? '<button type="button" class="btn-sec" data-te-quitar>Volver a "trabajando"</button>' : ''}<button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar término</button></div></form>`);
  const ini = st.D.inicio || INICIO(), av = () => { const d = dlg.querySelector('#te-pago').value || dlg.querySelector('#te-dia').value;
    dlg.querySelector('[data-te-aviso]').textContent = d && d < ini ? 'Es de antes del inicio de Gastos: el pago no entra a Gastos. Queda la ficha y sus documentos.' : 'Si el pago del finiquito llega en una cartola, en la Bandeja regístrelo con el ítem FINIQUITO y márquelo "¿Usa la provisión?".'; };
  dlg.querySelectorAll('#te-dia, #te-pago').forEach(i => i.addEventListener('change', av)); av();
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  const q = dlg.querySelector('[data-te-quitar]');
  if (q) q.onclick = async () => { q.disabled = true; try { await (await fsGN()).guardarTermino(clave, null, { razon, rut }); dlg.close(); H.registrar('Gastos: quitó el término de un contrato', razon); enFicha(el, H, clave, razon, rut, { termino: null }, `${H.esc(razon)} vuelve a "trabajando" (queda en el historial).`); } catch (e) { q.disabled = false; falla(dlg, e, H); } };
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const v = s => dlg.querySelector(s).value;
      const r = await (await fsGN()).guardarTermino(clave, { dia: v('#te-dia'), causa: v('#te-causa'), firma: (dlg.querySelector('[name=te-firma]:checked') || {}).value || '', monto: v('#te-monto'), pagoDia: v('#te-pago'), pagoComo: v('#te-como'), nota: v('#te-nota') }, { razon, rut });
      dlg.close(); H.registrar('Gastos: anotó el término de un contrato', `${razon} · ${r.dia} · ${TR.CAUSAS[r.causa]}`); enFicha(el, H, clave, razon, rut, { termino: r }, `${H.esc(razon)}: ${H.esc(TR.textoTermino(r))}. Pasa a Ex trabajadores.`); }
    catch (e) { falla(dlg, e, H); } });
}
const MAX_ARCHIVO = 10 * 1024 * 1024;
function dlgDocTrab(el, H, clave, razon, rut) {
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>Subir documento · ${H.esc(razon)}</h2>${H.info('Documentos del trabajador', TXT_DOCTRAB)}</div>
    <div class="campo"><label for="dt-tipo">Qué documento es</label><select id="dt-tipo"><option value="">Elija</option>${Object.entries(TR.TIPOS_DOC).map(([k, v]) => `<option value="${k}">${H.esc(v)}</option>`).join('')}</select></div>
    <div class="campo"><label for="dt-fecha">Fecha del documento</label><input id="dt-fecha" type="date" value="${isoHoy()}"></div>
    <div class="campo"><label for="dt-arch">Archivo (PDF o foto, hasta 10 MB)</label><input id="dt-arch" type="file" accept="application/pdf,image/*"></div>
    <div class="campo"><label for="dt-nota">Nota (opcional)</label><input id="dt-nota" maxlength="200" placeholder="Ej: firmada en notaría"></div>
    <p class="ayuda">Va a Google Drive, privado. Se abre solo con la cuenta de administración.</p>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Subir</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); const b = dlg.querySelector('[type=submit]'); b.disabled = true;
    try {
      const tipo = dlg.querySelector('#dt-tipo').value, fecha = dlg.querySelector('#dt-fecha').value, f = dlg.querySelector('#dt-arch').files[0];
      if (!TR.TIPOS_DOC[tipo]) throw new Error('Elija qué documento es.');
      if (!f) throw new Error('Elija el archivo.');
      if (f.size > MAX_ARCHIVO) throw new Error('El archivo pesa más de 10 MB: comprímalo o súbalo en partes.');
      if (!/^application\/pdf$|^image\//.test(f.type || '')) throw new Error('Sirve un PDF o una foto.');
      b.textContent = 'Subiendo…';
      const G = await import('./gastos.js?v=0.138.0'), b64 = await G.aBase64(f);
      const ext = (f.name.match(/\.[A-Za-z0-9]{2,5}$/) || [f.type === 'application/pdf' ? '.pdf' : '.jpg'])[0];
      const nombre = `Trabajador - ${razon} - ${TR.TIPOS_DOC[tipo]} - ${fecha || isoHoy()}${ext}`.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 120);
      const fd = (fecha || isoHoy()).split('-').reverse().join('-');
      const r = await G.subidor()({ tipo: 'comprobante', fecha: fd, imageData: b64, mimeType: f.type, fileName: nombre });
      if (!r || !r.url) throw new Error('Drive no devolvió el enlace del archivo. Intente de nuevo.');
      const d = await (await fsGN()).agregarDocTrab(clave, { tipo, fecha, nota: dlg.querySelector('#dt-nota').value, url: r.url, nombre }, { razon, rut });
      dlg.close(); H.registrar('Gastos: subió un documento del trabajador', `${razon} · ${TR.TIPOS_DOC[tipo]}`);
      const prev = ((st.D.provs || {})[clave] || {}).documentosTrab || []; enFicha(el, H, clave, razon, rut, { documentosTrab: prev.concat([d]) }, `Subido: ${H.esc(TR.TIPOS_DOC[d.tipo])} de ${H.esc(razon)}.`);
    } catch (e) { b.textContent = 'Subir'; falla(dlg, e, H); } });
}
function dlgDocTrabNoVa(el, H, clave, id) {
  const x = TR.equipo(st.D).find(t => t.clave === clave), d = x && (x.documentos || []).find(y => y.id === id); if (!d) return;
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>"No va": ${H.esc(TR.TIPOS_DOC[d.tipo] || d.tipo)}</h2></div>
    <p class="ayuda">No se borra: queda abajo, en "marcados no va", con su motivo. El archivo sigue en Drive.</p>
    <div class="campo"><label for="dn-mot">Motivo</label><input id="dn-mot" maxlength="200" placeholder="Ej: era de otra persona"></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Marcar "no va"</button></div></form>`);
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const mot = dlg.querySelector('#dn-mot').value; await (await fsGN()).docTrabNoVa(clave, id, mot); dlg.close();
      const prev = ((st.D.provs || {})[clave] || {}).documentosTrab || []; enFicha(el, H, clave, x.nombre, '', { documentosTrab: prev.map(y => (y.id === id ? { ...y, estado: 'no_va', noVa: { motivo: mot.trim() } } : y)) }, 'Documento marcado "no va".'); } catch (e) { falla(dlg, e, H); } });
}
function dlgTrabajador(el, H, clave, razon, rut) {
  const nuevo = !clave, t = nuevo ? {} : ((st.D.provs || {})[clave] || {}).trabajador || {};
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>${nuevo ? 'Agregar trabajador' : H.esc(razon || 'Trabajador')}</h2>${H.info('Datos del trabajador', TXT_TRAB)}</div>
    ${nuevo ? '<div class="gn-dos"><div class="campo"><label for="tr-nombre">Nombre</label><input id="tr-nombre" maxlength="120" autocomplete="off"></div><div class="campo"><label for="tr-rut">RUT</label><input id="tr-rut" maxlength="14" placeholder="12.345.678-9" autocomplete="off"></div></div>' : ''}
    <div class="campo"><label for="tr-cargo">Cargo (opcional)</label><input id="tr-cargo" maxlength="60" value="${H.esc(t.cargo || '')}" placeholder="Por ejemplo: maestro panadero"></div>
    <div class="campo"><label for="tr-ingreso">Fecha de ingreso</label><input id="tr-ingreso" type="date" value="${H.esc(t.ingreso || '')}"></div>
    <div class="chips" role="radiogroup" aria-label="Contrato">${Object.entries(TR.CONTRATOS).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="tr-c" value="${k}" ${t.contrato === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <div data-tr="plazo_fijo" class="gn-dlg-bloque" ${t.contrato === 'plazo_fijo' ? '' : 'hidden'}><div class="gn-dos"><div class="campo"><label for="tr-vence">Vence el</label><input id="tr-vence" type="date" value="${H.esc(t.vence || '')}"></div>
      <div class="campo"><label for="tr-renov">Renovaciones</label><select id="tr-renov">${[0, 1].map(n => `<option value="${n}" ${Number(t.renovaciones || 0) === n ? 'selected' : ''}>${n === 0 ? 'Ninguna' : 'Una'}</option>`).join('')}</select></div></div>
      <div data-tr-renov class="gn-dlg-bloque" ${Number(t.renovaciones || 0) >= 1 ? '' : 'hidden'}>
        <fieldset class="campo"><legend>Cómo se renovó</legend><div class="chips" role="radiogroup" aria-label="Cómo se renovó">${Object.entries(TR.COMO_RENOVO).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="tr-como" value="${k}" ${((t.renovacion || {}).como) === k ? 'checked' : ''}><span>${H.esc(v)}</span></label>`).join('')}</div></fieldset>
        <div class="gn-dos"><div class="campo"><label for="tr-antes">Antes vencía el</label><input id="tr-antes" type="date" value="${H.esc((t.renovacion || {}).venciaAntes || '')}"></div>
          <div class="campo"><label for="tr-rdia">Fecha del anexo o contrato nuevo (opcional)</label><input id="tr-rdia" type="date" value="${H.esc((t.renovacion || {}).dia || '')}"></div></div>
        <p class="ayuda">Las dos formas cuentan como renovación. En "Vence el" va la fecha nueva. Suba el anexo en Documentos ("Anexo · renovación del plazo"). Un anexo que solo cambia la jornada u horas no es renovación: súbalo como "Anexo · cambio de jornada u horas".</p></div></div>
    <div data-tr="indefinido" class="gn-dlg-bloque" ${t.contrato === 'indefinido' ? '' : 'hidden'}><div class="campo"><label for="tr-indef">Indefinido desde</label><input id="tr-indef" type="date" value="${H.esc(t.indefinidoDesde || '')}"><p class="ayuda">Si empezó a plazo fijo, la fecha en que pasó a indefinido. Vacío: desde el ingreso.</p></div></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const c = () => (dlg.querySelector('[name=tr-c]:checked') || {}).value || '';
  dlg.querySelectorAll('[name=tr-c]').forEach(r => r.addEventListener('change', () => dlg.querySelectorAll('[data-tr]').forEach(b => { b.hidden = b.dataset.tr !== c(); })));
  const renovSel = dlg.querySelector('#tr-renov'); renovSel.addEventListener('change', () => { dlg.querySelector('[data-tr-renov]').hidden = renovSel.value === '0'; });
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const v = q => dlg.querySelector(q).value;
      let k = clave, nom = razon, r = rut;
      if (nuevo) {   // v0.107.0 · Agregar: nombre y RUT (su ficha queda con la clave de sus liquidaciones: r_<RUT>)
        nom = v('#tr-nombre').trim(); r = v('#tr-rut').trim();
        if (!nom) throw new Error('Escriba el nombre.');
        if (!/^\d{7,8}[0-9K]$/.test(GN.rutN(r))) throw new Error('Revise el RUT (por ejemplo 12.345.678-9).');
        k = 'r_' + GN.rutN(r); r = GN.rutTexto(r);
        if (TR.equipo(st.D).some(x => x.clave === k)) throw new Error('Ese RUT ya está en el equipo.');
      }
      await (await fsGN()).guardarTrabajador(k, { cargo: v('#tr-cargo'), ingreso: v('#tr-ingreso'), contrato: c(), vence: v('#tr-vence'), renovaciones: v('#tr-renov'), renovacion: { como: (dlg.querySelector('[name=tr-como]:checked') || {}).value || '', venciaAntes: v('#tr-antes'), dia: v('#tr-rdia') }, indefinidoDesde: v('#tr-indef') }, { razon: nom, rut: r });
      dlg.close(); H.registrar(nuevo ? 'Gastos: agregó un trabajador' : 'Gastos: datos del trabajador', nom);
      if (nuevo) aviso(el, H, `Agregado al equipo: ${H.esc(nom)}. Ábralo para elegir su área (a qué área van su sueldo y su provisión).`);
      else aviso(el, H, `Datos guardados: ${H.esc(nom)}.`); }
    catch (e) { falla(dlg, e, H); } });
}
function dlgProvision(el, H, id) {
  const d = (st.D.docs || []).find(x => x.id === id); if (!d) return;
  const eq = TR.equipo(st.D), p = d.provision || {}, propio = 'r_' + (d.rutN || '');
  const dlg = H.dialogo(`<form class="form-dialogo" novalidate><div class="titulo-fila"><h2>¿Usa la provisión?</h2>${H.info('Provisión de los trabajadores', TXT_PROV)}</div>
    <p class="ayuda"><b>${H.esc(nom(d))}</b> · ${H.esc(d.tipoTexto)} · ${H.pesos(d.total)}</p>
    <div class="chips" role="radiogroup" aria-label="Uso"><label class="chip-radio"><input type="radio" name="pv-u" value="" ${!p.uso ? 'checked' : ''}><span>No: es gasto del mes</span></label>${Object.entries(TR.USOS).map(([k, v]) => `<label class="chip-radio"><input type="radio" name="pv-u" value="${k}" ${p.uso === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
    <div class="campo" data-pv-de ${p.uso ? '' : 'hidden'}><label for="pv-de">Provisión de</label><select id="pv-de">${eq.map(x => `<option value="${H.esc(x.clave)}" ${(p.de || (d.origen === 'liquidacion' && p.uso !== 'vacaciones' ? propio : '')) === x.clave ? 'selected' : ''}>${H.esc(x.nombre)}</option>`).join('')}</select>
      <p class="ayuda">Reemplazo de vacaciones: el trabajador que salió de vacaciones. Finiquito: quien se va.</p></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const u = () => dlg.querySelector('[name=pv-u]:checked').value;
  dlg.querySelectorAll('[name=pv-u]').forEach(r => r.addEventListener('change', () => { dlg.querySelector('[data-pv-de]').hidden = !u(); }));
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async ev => { ev.preventDefault(); dlg.querySelector('[type=submit]').disabled = true;
    try { const de = u() ? dlg.querySelector('#pv-de').value : ''; await (await fsGN()).marcarProvision(d.id, { uso: u(), de }); dlg.close(); H.registrar('Gastos: uso de la provisión', `${nom(d)} · ${u() || 'no'}`);
      aviso(el, H, u() ? `${H.esc(nom(d))}: sale de la provisión (${H.esc(TR.USOS[u()].toLowerCase())}).` : `${H.esc(nom(d))}: es gasto del mes.`); }
    catch (e) { falla(dlg, e, H); } });
}
