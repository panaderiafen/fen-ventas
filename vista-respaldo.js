// ═══════════════════════════════════════════════
//  Sistema Fën — Configuración → Respaldo  v0.73.0
//  "Descargar respaldo de <mes>" (lo del mes y los catálogos) y "Descargar respaldo completo de catálogos" (solo maestros), con el
//  estimado de lecturas antes de bajar. Datos en respaldo.js; hojas en respaldo-modelo.js.
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, dialogo }
// ═══════════════════════════════════════════════
import * as R from './respaldo.js?v=0.138.0';
import * as RM from './respaldo-modelo.js?v=0.138.0';

const st = { mes: '', msg: '', err: '', ocupado: false, hechos: null };
export const estado = st;
const nf = v => Number(v || 0).toLocaleString('es-CL');
const hoyTxt = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const Mayus = t => String(t).replace(/^./, x => x.toUpperCase());
const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const diaCorto = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[3])} ${MESC[Number(m[2]) - 1]}` : ''; };
let H = null;

const TXT = 'Desde la v0.73.0 lo que haces en Sistema Fën ya no se copia en vivo a las planillas (Looker Studio salió del plan). En su lugar, una vez al mes bajas este respaldo en Excel y lo guardas donde quieras (por ejemplo, en Drive).\nEl del mes trae: gastos, vencimientos, documentos del SII y cargos de la cartola del mes; las órdenes B2B del mes (una fila por producto), los clientes y productos B2B; las ventas de la caja del mes (de cada cierre, por producto); y los catálogos: recetas con su costo, materias primas con su precio, reventa y los vínculos de Finanzas.\nEl de catálogos trae solo los maestros (recetas, materias primas, reventa, vínculos, productos de la caja y de B2B), sin datos del mes.\nEl archivo se arma en este navegador: no se escribe en ninguna planilla. La Agenda te lo recuerda el día 1 de cada mes.\nLas planillas antiguas quedan como estaban, como historial.';
const TXT_LECT = 'Antes de bajar se cuenta cuánto hay que leer (cada conteo cuesta 1 lectura). Lo que ya está en la memoria de esta sesión no se vuelve a leer: los gastos y los catálogos de Finanzas (con sus paquetes), las recetas y materias primas de Cocina, los productos de la caja.\nLo demás se lee una vez: los cierres de la caja del mes (uno por cierre) y las órdenes B2B del mes. Todo cabe de sobra en la cuota gratis de cada base (50.000 lecturas al día).';

export async function pintar(cont, h) {
  H = h; if (!cont) return;
  if (!st.mes) st.mes = RM.mesAnterior(hoyTxt());
  dibujar(cont);
  try { st.hechos = await R.hechos(); } catch (e) { st.hechos = {}; }
  if (cont.isConnected) dibujar(cont);
}
function meses() { const out = []; let m = hoyTxt().slice(0, 7); for (let k = 0; k < 13; k++) { out.push(m); m = RM.mesAnterior(m + '-01'); } return out; }
function dibujar(cont) {
  const hs = st.hechos || {}, ult = Object.entries(hs).filter(([k]) => /^\d{4}-\d{2}$/.test(k)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);
  cont.innerHTML = `<div class="titulo-fila"><h2 id="t-respaldo">Respaldo ${H.info('Respaldo mensual', TXT)}</h2>${hs[st.mes] ? `<span class="chip c-verde">${Mayus(RM.nombreMes(st.mes))}: bajado</span>` : ''}</div>
    <p class="ayuda">Una vez al mes, un Excel con lo del mes y los catálogos. Reemplaza a la copia en vivo a las planillas.</p>
    <div class="resp-fila">
      <div class="campo"><label for="resp-mes">Mes</label><select id="resp-mes">${meses().map(m => `<option value="${m}" ${m === st.mes ? 'selected' : ''}>${Mayus(RM.nombreMes(m))}${hs[m] ? ' · bajado' : ''}</option>`).join('')}</select></div>
      <button type="button" class="btn" id="resp-bajar" ${st.ocupado ? 'disabled' : ''}>${H.icono('bajar', 16)} Descargar respaldo de ${H.esc(RM.nombreMes(st.mes))}</button>
    </div>
    <div class="botones" style="justify-content:flex-start;margin-top:4px"><button type="button" class="btn-sec" id="resp-cat" ${st.ocupado ? 'disabled' : ''}>${H.icono('bajar', 16)} Descargar respaldo completo de catálogos</button>${H.info('Lecturas del respaldo', TXT_LECT)}</div>
    <p class="ok-texto" id="resp-msg" role="status">${H.esc(st.msg)}</p><p class="error" id="resp-err" role="alert">${H.esc(st.err)}</p>
    ${ult.length ? `<p class="ayuda" id="resp-hechos">Bajados: ${ult.map(([k, v]) => `${H.esc(Mayus(RM.nombreMes(k)))} (${H.esc(diaCorto(v.en))})`).join(' · ')}</p>` : ''}`;
  cont.querySelector('#resp-mes').addEventListener('change', e => { st.mes = e.target.value; st.msg = ''; st.err = ''; dibujar(cont); });
  cont.querySelector('#resp-bajar').addEventListener('click', () => flujo(cont, 'mes'));
  cont.querySelector('#resp-cat').addEventListener('click', () => flujo(cont, 'catalogos'));
}
const error = e => (e && e.code === 'cuota-agotada') ? e.message : (e && e.message) || H.mensajeError(e);
async function flujo(cont, tipo) {
  if (st.ocupado) return;
  st.ocupado = true; st.msg = ''; st.err = ''; dibujar(cont);
  cont.querySelector('#resp-msg').textContent = 'Contando cuánto hay que leer…';
  let est;
  try { est = await R.estimar(tipo, st.mes); } catch (e) { st.ocupado = false; st.err = error(e); dibujar(cont); return; }
  st.ocupado = false; dibujar(cont);
  const titulo = tipo === 'mes' ? `Respaldo de ${RM.nombreMes(st.mes)}` : 'Respaldo completo de catálogos';
  const ok = await new Promise(resolve => {
    const d = H.dialogo(`<form class="form-dialogo" id="resp-dlg" novalidate>
      <h2>${H.esc(titulo)}</h2>
      <p id="resp-estimado">Se leerán hasta <b>${nf(est.total)}</b> documentos: Gastos y Finanzas ${nf(est.gastos)} · caja ${nf(est.caja)} · B2B ${nf(est.b2b)} · Cocina ${nf(est.cocina)}.</p>
      <p class="ayuda">Lo que ya estaba en memoria no cuenta. Contar costó ${nf(est.preguntas)} ${est.preguntas === 1 ? 'lectura' : 'lecturas'}. ${H.info('Lecturas del respaldo', TXT_LECT)}</p>
      ${est.sin.length ? `<p class="aviso">Sin conexión en este equipo: ${H.esc(est.sin.join(', '))}. Esas hojas salen vacías.</p>` : ''}
      <p class="ayuda">Hojas: ${H.esc((tipo === 'mes' ? RM.HOJAS_MES : RM.HOJAS_CATALOGOS).join(' · '))}</p>
      <div class="botones"><button type="button" class="btn-sec" id="resp-no">Cancelar</button><button type="submit" class="btn" id="resp-si">${H.icono('bajar', 16)} Descargar</button></div></form>`);
    let listo = false; const fin = v => { if (listo) return; listo = true; resolve(v); try { d.close(); } catch (e) {} };
    d.querySelector('#resp-no').addEventListener('click', () => fin(false));
    d.addEventListener('close', () => fin(false));
    d.querySelector('#resp-dlg').addEventListener('submit', ev => { ev.preventDefault(); fin(true); });
  });
  if (!ok) return;
  st.ocupado = true; dibujar(cont); cont.querySelector('#resp-msg').textContent = 'Armando el Excel…';
  try {
    const r = await R.bajar(tipo, st.mes);
    const filas = r.hojas.reduce((s, h) => s + h.filas, 0), l = r.leidas;
    st.msg = `Listo: ${r.nombre} (${r.hojas.length} hojas, ${nf(filas)} filas). Lecturas: Gastos y Finanzas ${nf(l.gastos)} · caja ${nf(l.caja)} · B2B ${nf(l.b2b)} · Cocina ${nf(l.cocina)}.${r.sin.length ? ` Sin ${r.sin.join(', ')}.` : ''}`;
    H.registrar(tipo === 'mes' ? 'Bajó el respaldo del mes' : 'Bajó el respaldo de catálogos', `${r.nombre} · ${r.hojas.length} hojas · ${filas} filas`);
    try { st.hechos = await R.hechos(); } catch (e) {}
  } catch (e) { st.err = error(e); }
  st.ocupado = false; if (cont.isConnected) dibujar(cont);
}
