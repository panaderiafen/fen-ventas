// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos → Obligaciones → Clasificar obligaciones  v0.51.0 (etapa G3, cuarta parte; solo con la base nueva)
//  Para el fin de semana del cambio: cada obligación activa con su ítem, su monto, sus últimos pagos y una PROPUESTA de
//  tipo (fijo, según documento o libre) y de identificador (N° de cliente del nombre, RUT del SII, Previred). El dueño
//  confirma cada una (Guardar) o marca varias y presiona "Aplicar propuestas". Guardar usa las reglas de la v0.49.0
//  (sus vencimientos abiertos sin documento ni abonos toman el tipo nuevo). Reglas en gastos-g3d.js.
//  Se abre en #gastos/clasificar (desde Obligaciones o desde Base nueva → Cambio a la base nueva).
//  v0.63.1: también "Se paga por" (banco, efectivo o tarjeta) con su propuesta desde el historial (pagos con la cartola → banco).
//  H = ayudas de app.js: { esc, info, registrar, mensajeError, pesos, fecha }
// ═══════════════════════════════════════════════
import * as Gastos from './gastos.js?v=0.138.0';
import * as G3 from './gastos-g3.js?v=0.138.0';
import { ID_PREVIRED } from './gastos-g3d.js?v=0.138.0';
import * as B from './gastos-banco.js?v=0.138.0';

const st = { lista: null, msg: '', err: '', corriendo: false, sel: new Set() };
const TXT = 'Para cada cuenta recurrente activa se propone un tipo:\n• Monto fijo, si los últimos 3 pagos fueron del mismo monto (arriendo, cuotas).\n• Según documento, si es luz, agua, gas, internet o teléfono, o si el SII tiene facturas de un proveedor con ese nombre. El identificador es el N° de cliente que aparece en el nombre (si hay varios, eliges tú) o el RUT del proveedor del SII.\n• Libre (abonos), si es un sueldo o los montos cambian mucho.\n• Las cotizaciones van como según documento con identificador Previred: el certificado completa su vencimiento.\nNada se guarda solo: confirma cada una con Guardar, o marca varias y presiona "Aplicar propuestas". Puedes cambiar el tipo y el identificador antes. Al guardar, sus vencimientos abiertos (sin documento ni abonos) toman el tipo nuevo.\n\nSe paga por: banco (la cartola registra el pago), efectivo o tarjeta de crédito (se pagan con "Pagar"). La propuesta sale de sus últimos pagos: si se pagaron con la cartola, banco; si sus gastos fueron en efectivo, efectivo. Sin historial: banco.';
const nombreIdent = v => (v === ID_PREVIRED ? 'Previred' : v);

export async function pintar(cont, H) {
  cont.innerHTML = `<div class="titulo-fila"><h2 id="t-clasif">Clasificar cuentas recurrentes ${H.info('Clasificar cuentas recurrentes', TXT)}</h2><a class="btn-sec btn-chico" href="#gastos/config/cuentas">Volver a Cuentas recurrentes</a></div><div class="vacio" style="border:0">Revisando cuentas recurrentes y pagos…</div>`;
  try { st.lista = (await Gastos.datosClasificar()).obligaciones || []; st.err = ''; }
  catch (e) { cont.querySelector('.vacio').outerHTML = `<p class="error" role="alert">${H.esc(e.message || H.mensajeError(e))}</p>`; return; }
  if (!cont.isConnected) return;
  st.sel = new Set(st.lista.filter(o => o.sinClasificar && o.propuesta.segura).map(o => o.id));
  dibujar(cont, H);
}

function fila(o, H) {
  const p = o.propuesta, tipo = o.sinClasificar ? p.tipo : o.tipoObligacion;
  const ident = o.sinClasificar || !o.identificador ? p.identificador : o.identificador;
  const ops = [...new Set([ident].concat(p.opciones || []).filter(Boolean))];
  const pagos = o.pagos.length ? o.pagos.slice(0, 3).map(x => `${H.pesos(x.monto)} (${H.esc(H.fecha(x.fecha))})`).join(' · ') : 'sin pagos registrados';
  const sp = o.sePagaPor || (o.propuestaSePaga || {}).valor || 'banco', ps = o.propuestaSePaga || { valor: 'banco', motivo: '' };
  const chip = o.sinClasificar ? '<span class="chip c-amarillo chip-chico">Sin clasificar</span>' : `<span class="chip c-gris chip-chico">${H.esc(G3.NOMBRE_TIPO[o.tipoObligacion] || o.tipoObligacion)}</span>`;
  const selIdent = ops.length > 1
    ? `<select data-cl-ident="${H.esc(o.id)}" aria-label="Identificador de ${H.esc(o.nombre)}">${ops.map(x => `<option value="${H.esc(x)}" ${x === ident ? 'selected' : ''}>${H.esc(nombreIdent(x))}</option>`).join('')}<option value="__otro">Otro…</option></select><input type="text" class="oculto" data-cl-otro="${H.esc(o.id)}" maxlength="40" aria-label="Otro identificador de ${H.esc(o.nombre)}">`
    : `<input type="text" data-cl-ident="${H.esc(o.id)}" maxlength="40" value="${H.esc(nombreIdent(ident || ''))}" placeholder="N° de cliente o RUT" aria-label="Identificador de ${H.esc(o.nombre)}">`;
  return `<div class="fila-caja fila-clasif" data-cl-fila="${H.esc(o.id)}">
    <label class="check-b2b"><input type="checkbox" data-cl-sel="${H.esc(o.id)}" ${st.sel.has(o.id) ? 'checked' : ''} aria-label="Aplicar la propuesta a ${H.esc(o.nombre)}"></label>
    <div class="txt"><b>${H.esc(o.nombre)}</b> ${chip}
      <span>${[o.item, o.montoEstimado ? H.pesos(o.montoEstimado) + ' est.' : 'sin monto estimado', o.tipoMonto ? 'tipo de monto ' + o.tipoMonto : ''].filter(Boolean).map(H.esc).join(' · ')}</span>
      <span>Últimos pagos: ${pagos}</span>
      <span class="nota" data-cl-prop="${H.esc(o.id)}">Propuesta: <b>${H.esc(G3.NOMBRE_TIPO[p.tipo])}</b>${p.identificador ? ' · ' + H.esc(nombreIdent(p.identificador)) : ''} · ${H.esc(p.motivo)}${p.segura ? '' : ' (revísala)'}</span>
      <span class="nota" data-cl-psp="${H.esc(o.id)}">Se paga por: <b>${H.esc(B.NOMBRE_SE_PAGA[ps.valor])}</b> · ${H.esc(ps.motivo)}${o.sePagaPor ? ` (guardado: ${H.esc(B.NOMBRE_SE_PAGA[o.sePagaPor])})` : ''}</span>
      <div class="clasif-campos"><select data-cl-tipo="${H.esc(o.id)}" aria-label="Tipo de ${H.esc(o.nombre)}">${G3.TIPOS_OBLIGACION.map(k => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${H.esc(G3.NOMBRE_TIPO[k])}</option>`).join('')}</select>
        <span class="clasif-ident ${tipo === 'documento' ? '' : 'oculto'}" data-cl-cident="${H.esc(o.id)}">${selIdent}</span>
        <select data-cl-sepaga="${H.esc(o.id)}" aria-label="Se paga por (${H.esc(o.nombre)})">${B.SE_PAGA.map(k => `<option value="${k}" ${k === sp ? 'selected' : ''}>${H.esc(B.NOMBRE_SE_PAGA[k])}</option>`).join('')}</select>
        <button type="button" class="btn-sec btn-chico" data-cl-guardar="${H.esc(o.id)}">Guardar</button></div>
      <span class="error" role="alert" data-cl-err="${H.esc(o.id)}"></span></div></div>`;
}
function dibujar(cont, H) {
  const L = st.lista, sinC = L.filter(o => o.sinClasificar).length;
  cont.innerHTML = `<div class="titulo-fila"><h2 id="t-clasif">Clasificar cuentas recurrentes ${H.info('Clasificar cuentas recurrentes', TXT)}</h2><a class="btn-sec btn-chico" href="#gastos/config/cuentas">Volver a Cuentas recurrentes</a></div>
    <p class="ayuda">${L.length} ${L.length === 1 ? 'cuenta recurrente activa' : 'cuentas recurrentes activas'} · <b>${sinC}</b> sin clasificar. Revisa la propuesta de cada una; las marcadas se guardan con "Aplicar propuestas".${(n => n ? ` ${n} todavía sin "Se paga por" guardado (cuentan como banco).` : '')(L.filter(o => !o.sePagaPor).length)}</p>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="cl-aplicar" ${st.corriendo || !st.sel.size ? 'disabled' : ''}>Aplicar propuestas (${st.sel.size})</button></div>
    <p class="ayuda" id="cl-msg" role="status" aria-live="polite">${H.esc(st.msg)}</p>${st.err ? `<p class="error" role="alert" id="cl-err">${H.esc(st.err)}</p>` : ''}
    <div id="cl-lista">${L.map(o => fila(o, H)).join('') || '<div class="vacio">No hay cuentas recurrentes activas.</div>'}</div>`;
  conectar(cont, H);
}
// Lo que dice la pantalla para una obligación
function leer(cont, id) {
  const q = sel => cont.querySelector(`[${sel}="${CSS.escape(id)}"]`);
  const tipo = q('data-cl-tipo').value, ci = q('data-cl-ident');
  let ident = ci ? ci.value : '';
  if (ident === '__otro') ident = (q('data-cl-otro') || {}).value || '';
  if (/^previred$/i.test(ident.trim())) ident = ID_PREVIRED;
  const o = st.lista.find(x => x.id === id);
  return { id, tipoObligacion: tipo, identificador: tipo === 'documento' ? ident.trim() : '', diasAviso: o && o.diasAviso !== '' ? o.diasAviso : '', sePagaPor: (q('data-cl-sepaga') || {}).value || 'banco' };
}
function conectar(cont, H) {
  if (!cont.dataset.clEscucha) cont.dataset.clEscucha = '1', cont.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.clSel !== undefined) { if (t.checked) st.sel.add(t.dataset.clSel); else st.sel.delete(t.dataset.clSel); const b = cont.querySelector('#cl-aplicar'); if (b) { b.textContent = `Aplicar propuestas (${st.sel.size})`; b.disabled = st.corriendo || !st.sel.size; } }
    else if (t.dataset.clTipo !== undefined) cont.querySelector(`[data-cl-cident="${CSS.escape(t.dataset.clTipo)}"]`).classList.toggle('oculto', t.value !== 'documento');
    else if (t.dataset.clIdent !== undefined && t.tagName === 'SELECT') { const o = cont.querySelector(`[data-cl-otro="${CSS.escape(t.dataset.clIdent)}"]`); if (o) o.classList.toggle('oculto', t.value !== '__otro'); }
  });
  cont.querySelectorAll('[data-cl-guardar]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.clGuardar, x = leer(cont, id), err = cont.querySelector(`[data-cl-err="${CSS.escape(id)}"]`);
    err.textContent = ''; b.disabled = true; b.textContent = 'Guardando…';
    await guardar([x], cont, H);
  }));
  const ap = cont.querySelector('#cl-aplicar');
  if (ap) ap.addEventListener('click', async () => {
    const lista = [...st.sel].map(id => leer(cont, id));
    const cuenta = G3.TIPOS_OBLIGACION.map(k => [k, lista.filter(x => x.tipoObligacion === k).length]).filter(x => x[1]).map(([k, c]) => `${c} ${G3.NOMBRE_TIPO[k].toLowerCase()}`).join(', ');
    if (!confirm(`¿Guardar el tipo de ${lista.length} ${lista.length === 1 ? 'cuenta recurrente' : 'cuentas recurrentes'} (${cuenta})?\n\nSus vencimientos abiertos sin documento ni abonos toman el tipo nuevo. Se puede cambiar después en Editar.`)) return;
    await guardar(lista, cont, H);
  });
}
async function guardar(lista, cont, H) {
  st.corriendo = true; st.err = ''; st.msg = '';
  const msg = cont.querySelector('#cl-msg');
  try {
    const r = await Gastos.clasificarObligaciones(lista, (k, n) => { if (msg) msg.textContent = `Guardando ${k} de ${n}…`; });
    H.registrar('Clasificó cuentas recurrentes', `${r.ok.length} guardadas${r.errores.length ? ' · ' + r.errores.length + ' con error' : ''}`);
    st.msg = r.ok.length ? `Listo: ${r.ok.length} ${r.ok.length === 1 ? 'cuenta recurrente clasificada' : 'cuentas recurrentes clasificadas'}.` : '';
    st.err = r.errores.length ? 'No se pudieron guardar: ' + r.errores.map(e => `${(st.lista.find(o => o.id === e.id) || {}).nombre || e.id} (${e.error})`).join(' · ') : '';
    r.ok.forEach(id => st.sel.delete(id));
    st.lista = (await Gastos.datosClasificar()).obligaciones || st.lista;
  } catch (e) { st.err = e.message || H.mensajeError(e); }
  st.corriendo = false;
  if (cont.isConnected) dibujar(cont, H);
}
