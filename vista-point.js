// ═══════════════════════════════════════════════
//  Sistema Fën — Ventas de caja → Point  v0.115.0
//  Administra los Point de Mercado Pago a través del servidor de cobros (Cloudflare Worker "fen-point"):
//  ver los Point con su tienda y su modo, pasar a integrado (PDV) o volver a normal, un cobro de prueba
//  y los cobros con tarjeta recientes. Entra con la sesión de Sistema Fën (el Worker revisa que el correo
//  esté en su variable ADMINS). No lee ni escribe Firestore. Ningún secreto vive aquí.
//  v0.122.0: "Actualizar" en los cobros recientes, y se vuelven a pedir al entrar si tienen más de 1 minuto.
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';

const URL_POINT = () => (window.FEN_SIS && window.FEN_SIS.PUNTO_URL) || 'https://fen-point.panaderiafen.workers.dev';
const TIENDAS = { barros_arana: 'Barros Arana', ainavillo: 'Ainavillo' };
export const nombreTienda = k => TIENDAS[k] || (k ? k : '');
const PS = { terminales: null, credencial: '', cobros: null, ultima: null, msg: '', err: '', prueba: '' };
export function olvidar() { PS.terminales = null; PS.cobros = null; PS.msg = ''; PS.err = ''; PS.prueba = ''; }

export async function api(datos, fetchFn = fetch) {
  const u = auth.currentUser;
  if (!u) throw new Error('Sin sesión en Sistema Fën.');
  const token = await u.getIdToken();
  let r;
  try {
    r = await fetchFn(URL_POINT() + '/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(datos) });
  } catch (e) { throw new Error('No se pudo conectar con el servidor de cobros. Revise internet e intente de nuevo.'); }
  let j = {};
  try { j = await r.json(); } catch (_) { j = { ok: false, mensaje: 'Respuesta no válida del servidor de cobros (' + r.status + ').' }; }
  if (!j.ok) throw new Error(j.mensaje || 'El servidor de cobros respondió con un error (' + r.status + ').');
  return j;
}

// Estado → [texto, color del chip]
export function chipEstado(e) {
  return ({
    pagado: ['Pagado', 'verde'], enviado: ['Enviado', 'amarillo'], en_point: ['En el Point', 'amarillo'], accion: ['Requiere acción en el Point', 'amarillo'],
    cancelado: ['Cancelado', 'gris'], vencido: ['Vencido', 'gris'], fallido: ['Falló', 'rojo'], devuelto: ['Devuelto', 'gris'],
  })[e] || [e || '—', 'gris'];
}
export const tipoPagoTxt = t => ({ debito: 'Débito', credito: 'Crédito', prepago: 'Prepago', dinero_en_cuenta: 'Dinero en cuenta (QR)', otro: 'Otro' })[t] || '';
const horaCorta = iso => { const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); };

export async function pintarPoint(el, H) {
  const { esc, registrar, pesos } = H;
  const caja = el.querySelector('.tarjeta');
  if (PS.terminales === null && !PS.err) {
    try {
      const [t, c] = await Promise.all([api({ accion: 'terminales' }), api({ accion: 'cobros_recientes' })]);
      PS.terminales = t.terminales || []; PS.credencial = t.credencial || ''; PS.cobros = c.cobros || []; PS.cobrosEn = Date.now();
    } catch (e) { PS.err = e.message || String(e); }
  } else if (PS.terminales && Date.now() - (PS.cobrosEn || 0) > 60000) await refrescarCobros();
  const msg = PS.msg ? `<p class="aviso" role="status">${esc(PS.msg)}</p>` : '';
  const err = PS.err ? `<p class="error" role="alert">${esc(PS.err)}</p>` : '';
  if (PS.terminales === null) {
    caja.outerHTML = `<section class="tarjeta pt-tarjeta">${err}
      <p class="ayuda">Si dice que su cuenta no está autorizada, agregue su correo a la variable <b>ADMINS</b> del servidor de cobros en Cloudflare (fen-point → Configuración → Variables y secretos).</p>
      <div class="botones"><button type="button" class="btn-sec" data-pt-recargar>Volver a intentar</button></div></section>`;
    enlazar(el, H);
    return;
  }
  const pdv = PS.terminales.filter(t => t.modo === 'PDV');
  const filasT = PS.terminales.map(t => {
    const integrado = t.modo === 'PDV';
    const tienda = t.tienda ? nombreTienda(t.tienda) : 'Sin tienda asignada';
    const boton = integrado
      ? `<button type="button" class="btn-sec btn-peligro" data-pt-modo="STANDALONE" data-pt-term="${esc(t.id)}">Volver a normal</button>`
      : `<button type="button" class="btn-sec" data-pt-modo="PDV" data-pt-term="${esc(t.id)}">Pasar a integrado</button>`;
    return `<div class="fila-caja"><div class="txt"><b>${esc(tienda)}</b>
      <span>${esc(t.nombreCaja || 'Caja ' + (t.caja || '—'))} · <code>${esc(t.id)}</code></span></div>
      <div class="acciones"><span class="chip ${integrado ? 'c-verde' : 'c-gris'}">${integrado ? 'Integrado (PDV)' : 'Normal'}</span>${boton}</div></div>`;
  }).join('') || '<p class="ayuda">No se encontraron Point en la cuenta de Mercado Pago.</p>';
  const sinTienda = PS.terminales.some(t => !t.tienda)
    ? `<p class="ayuda">Un Point "sin tienda asignada" todavía no está en la variable <b>CONFIG</b> del servidor de cobros: la caja no le puede mandar cobros.</p>` : '';
  const filasC = (PS.cobros || []).map(o => {
    const [txt, color] = chipEstado(o.estado);
    const tienda = o.sucursal === 'prueba' ? 'Prueba' : nombreTienda(o.sucursal);
    return `<div class="fila-caja"><div class="txt"><b>${esc(pesos(o.monto))} · ${esc(tienda)}</b>
      <span>${esc(horaCorta(o.creada))}${o.tipoPago ? ' · ' + esc(tipoPagoTxt(o.tipoPago)) : ''}${o.correo ? ' · ' + esc(o.correo) : ''} · ${esc(o.referencia)}</span></div>
      <div class="acciones"><span class="chip c-${color}">${esc(txt)}</span></div></div>`;
  }).join('') || '<p class="ayuda">Todavía no hay cobros con tarjeta enviados al Point.</p>';
  const opciones = pdv.map(t => `<option value="${esc(t.id)}">${esc(t.tienda ? nombreTienda(t.tienda) : (t.nombreCaja || t.id))}</option>`).join('');
  const prueba = pdv.length ? `<div class="pt-prueba">
      <div class="campo"><label for="pt-term">Point</label><select id="pt-term">${opciones}</select></div>
      <div class="campo"><label for="pt-monto">Monto ($)</label><input id="pt-monto" type="number" inputmode="numeric" min="1" max="5000" value="100"></div>
      <div class="botones"><button type="button" class="btn" data-pt-cobrar>Enviar al Point</button>
      <button type="button" class="btn-sec" data-pt-estado ${PS.ultima ? '' : 'disabled'}>Ver estado</button></div></div>
      ${PS.prueba ? `<p class="aviso" role="status">${esc(PS.prueba)}</p>` : ''}`
    : '<p class="ayuda">Para un cobro de prueba, primero pase un Point a integrado y reinícielo.</p>';
  caja.outerHTML = `<section class="tarjeta pt-tarjeta">
      <div class="titulo-fila"><h2>Point de cada tienda</h2><button type="button" class="btn-sec" data-pt-recargar>Actualizar</button></div>
      ${msg}${err}
      <p class="ayuda">Integrado (PDV): el Point cobra lo que manda la caja. Normal: se digita el monto en el Point, como siempre. Después de cambiar el modo hay que <b>reiniciar el Point</b>. Si la caja pierde conexión, "Volver a normal" deja el Point cobrando solo.</p>
      ${filasT}${sinTienda}
      ${PS.credencial ? `<p class="ayuda">Credencial de Mercado Pago en uso: ${esc(PS.credencial)}.</p>` : ''}
    </section>
    <section class="tarjeta pt-tarjeta">
      <div class="titulo-fila"><h2>Cobros con tarjeta recientes</h2><button type="button" class="btn-sec btn-chico" data-pt-cobros>Actualizar</button></div>
      <p class="ayuda">Los últimos cobros que la caja (o una prueba) mandó al Point, con su estado según Mercado Pago. Sirve para revisar un cobro que una vendedora no entiende.</p>
      ${filasC}
    </section>
    <section class="tarjeta pt-tarjeta">
      <div class="titulo-fila"><h2>Cobro de prueba</h2></div>
      <p class="ayuda">Hasta $5.000, a un Point en modo integrado. Vence a los 3 minutos. Una vez en el Point, se cancela en el mismo Point.</p>
      ${prueba}
    </section>
    <p class="ayuda pt-respaldo">Respaldo si Sistema Fën no carga: la página de administración del servidor de cobros (${esc(URL_POINT())}/admin), con su clave.</p>`;
  enlazar(el, H);
}

function enlazar(el, H) {
  const { registrar } = H;
  const repintar = () => pintarPoint(el, H);
  el.querySelectorAll('[data-pt-recargar]').forEach(b => b.addEventListener('click', () => { olvidar(); el.querySelectorAll('.pt-tarjeta, .pt-respaldo').forEach((x, i) => { if (i) x.remove(); }); const t = el.querySelector('.pt-tarjeta'); if (t) t.outerHTML = '<div class="tarjeta"><div class="vacio" style="border:0">Cargando…</div></div>'; repintar(); }));
  el.querySelectorAll('[data-pt-modo]').forEach(b => b.addEventListener('click', async () => {
    const modo = b.dataset.ptModo, term = b.dataset.ptTerm;
    const txt = modo === 'PDV' ? 'pasar a integrado' : 'volver a modo normal';
    if (!confirm(`¿Seguro que quiere ${txt} este Point? Después hay que reiniciarlo.` + (modo === 'PDV' ? '\n\nEn modo integrado el Point no cobra solo: solo lo que manda la caja.' : ''))) return;
    b.disabled = true;
    try { const j = await api({ accion: 'modo', terminal: term, modo }); registrar('Cambió el modo de un Point', term + ' → ' + modo); PS.msg = j.mensaje || 'Listo. Reinicie el Point.'; PS.err = ''; PS.terminales = null; }
    catch (e) { PS.err = e.message || String(e); PS.msg = ''; }
    recargarTarjetas(el); repintar();
  }));
  const act = el.querySelector('[data-pt-cobros]');
  if (act) act.addEventListener('click', async () => { act.disabled = true; act.textContent = 'Actualizando…'; await refrescarCobros(); repintar(); });
  const cobrar = el.querySelector('[data-pt-cobrar]');
  if (cobrar) cobrar.addEventListener('click', async () => {
    const monto = parseInt(el.querySelector('#pt-monto').value, 10), term = el.querySelector('#pt-term').value;
    cobrar.disabled = true;
    try { const j = await api({ accion: 'cobro_prueba', terminal: term, monto }); PS.ultima = j.orden.referencia; PS.prueba = 'Cobro de prueba enviado al Point (' + j.orden.referencia + '). Páguelo o cancélelo en el Point y toque "Ver estado".'; registrar('Envió un cobro de prueba al Point', j.orden.referencia); }
    catch (e) { PS.prueba = e.message || String(e); }
    PS.cobros = null; await refrescarCobros(); recargarTarjetas(el); repintar();
  });
  const estado = el.querySelector('[data-pt-estado]');
  if (estado) estado.addEventListener('click', async () => {
    if (!PS.ultima) return;
    estado.disabled = true;
    try { const j = await api({ accion: 'estado_prueba', referencia: PS.ultima }); const [txt] = chipEstado(j.orden.estado); PS.prueba = 'Cobro ' + j.orden.referencia + ': ' + txt + (j.orden.tipoPago ? ' · ' + tipoPagoTxt(j.orden.tipoPago) : '') + '.'; }
    catch (e) { PS.prueba = e.message || String(e); }
    await refrescarCobros(); recargarTarjetas(el); repintar();
  });
}
async function refrescarCobros() { try { PS.cobros = (await api({ accion: 'cobros_recientes' })).cobros || []; PS.cobrosEn = Date.now(); } catch (_) { /* se mantiene lo anterior */ } }
function recargarTarjetas(el) {
  const ts = el.querySelectorAll('.pt-tarjeta, .pt-respaldo');
  ts.forEach((x, i) => { if (i) x.remove(); });
  if (ts[0]) ts[0].outerHTML = '<div class="tarjeta"><div class="vacio" style="border:0">Cargando…</div></div>';
}
