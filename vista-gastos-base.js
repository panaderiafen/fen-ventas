// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos → Configuración → Base nueva (fen-gastos)  v0.43.0 (etapa G1)
//  v0.44.0: parte "Archivos en Drive" (dejar privados los archivos ya subidos; script de Gastos v2.10.0)
//  v0.45.0 (etapa G2): partes "Copia a la planilla" (estado de lo que pasa de la base a la planilla) y
//  "Cambio a la base nueva" (bloqueado hasta que estén listos G2 y G3: CAMBIO_HABILITADO en config.js).
//  Conectar la base nueva, entrar, leer la planilla (2026), copiar y control de totales.
//  Nada cambia en el uso de Gastos: sigue con la planilla hasta el cambio.
//  v0.48.0 (etapa G3): parte "Proveedores" (fichas con lo aprendido para sugerir al cargar del SII con la base nueva):
//  cuántas hay, cuándo se actualizaron y el botón "Armar fichas de proveedores".
//  v0.51.0 (G3 completo): el cambio queda habilitado (CAMBIO_HABILITADO en config.js). Con Gastos en la base nueva, la parte
//  "Cambio a la base nueva" muestra lo que queda por hacer justo después (clasificar obligaciones, identificadores, el
//  arreglo "sin IVA" opcional con su vista previa, fichas de proveedores, dejar privados los archivos y revisar la planilla).
//  H = ayudas de app.js: { esc, info, registrar, mensajeError, hace }
// ═══════════════════════════════════════════════
import * as GB from './gastos-base.js?v=0.138.0';
import { COLECCIONES, NOMBRES } from './gastos-modelo.js?v=0.138.0';
import * as Gastos from './gastos.js?v=0.138.0';
import * as GP from './gastos-planilla.js?v=0.138.0';

const st = { prep: null, ctrl: null, msg: '', copiando: false, leyendo: false, controlando: false,
  prov: { datos: null, corriendo: false, msg: '', err: '' },
  cambio: { corriendo: false, msg: '', err: '', avance: '' },
  siniva: { previa: null, corriendo: false, msg: '', err: '' },
  drive: { corriendo: false, revisados: 0, total: null, cambiados: 0, fallidos: 0, siguiente: null, msg: '', err: '', listo: false } };
const $ = id => document.getElementById(id);
const n = v => Math.round(Number(v || 0)).toLocaleString('es-CL');
const pesos = v => { const x = Math.round(Number(v) || 0); return (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('es-CL'); };

function error(e, H) {
  const c = (e && e.code) || '';
  if (/permission-denied/.test(c)) return 'La base nueva no dejó leer o guardar: revisa que estén publicadas las reglas de fen-gastos y que tu cuenta esté en admins (ver README).';
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return 'En fen-gastos no hay una cuenta con tu correo y esa contraseña. Créala en la consola de Firebase → Authentication (ver README).';
  if (/invalid-api-key|api-key-not-valid/.test(c)) return 'La configuración guardada no es válida (apiKey). Vuelve a pegarla.';
  if (/failed-precondition/.test(c)) return 'Firestore todavía no está creado en fen-gastos (consola → Firestore Database → Crear base de datos).';
  return (e && e.message) || H.mensajeError(e);
}
// Partes plegables (como en Producción); lo abierto se recuerda en este equipo
const K_PLIEGUES = 'fen_sf_gastos_pliegues';
const abiertos = (() => { try { const g = localStorage.getItem(K_PLIEGUES); return new Set(g ? JSON.parse(g) : ['conexion', 'copia', 'control']); } catch (e) { return new Set(['conexion', 'copia', 'control']); } })();
const pliegue = (clave, titulo, resumen, cuerpo) => `<details class="pliegue" data-pliegue="${clave}" ${abiertos.has(clave) ? 'open' : ''}>
    <summary><span class="pl-tit">${titulo}</span><span class="pl-res" id="gb-res-${clave}">${resumen || ''}</span></summary>
    <div class="pliegue-cuerpo">${cuerpo}</div></details>`;
function conectarPliegues(el) {
  el.querySelectorAll('details.pliegue').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) abiertos.add(d.dataset.pliegue); else abiertos.delete(d.dataset.pliegue);
    try { localStorage.setItem(K_PLIEGUES, JSON.stringify([...abiertos])); } catch (e) {}
  }));
}

// cab = cabecera de Gastos con sus pestañas (la arma app.js)
export async function pintar(el, cab, H) {
  el.innerHTML = cab + '<section class="tarjeta"><div class="vacio" style="border:0">Conectando con la base nueva…</div></section>';
  let cx, ult = null, errorCx = '';
  try { cx = await GB.conexion(); if (cx.estado === 'ok') ult = await GB.ultimaCopia(); }
  catch (e) { errorCx = error(e, H); cx = { estado: 'error' }; }
  if (!el.isConnected || !/^#gastos\/config\/base/.test(location.hash)) return;
  const ok = cx.estado === 'ok';
  let fuente = { fuente: 'planilla' };
  if (ok) { try { fuente = await GB.cargarFuente(true); } catch (e) {} }
  if (!el.isConnected || !/^#gastos\/config\/base/.test(location.hash)) return;
  const resCx = ok ? `<span class="chip c-verde">Conectada</span> ${H.esc(cx.cfg.projectId)}` : cx.estado === 'error' ? '<span class="chip c-rojo">Error</span>' : '<span class="chip c-gris">Sin conectar</span>';
  const resCopia = !ok ? '' : st.prep ? (st.prep.porEscribir ? `${n(st.prep.porEscribir)} por copiar` : 'Todo al día') : ult && ult.ultima ? 'Última: ' + H.esc(H.hace(ult.ultima)) : 'Nunca copiada';
  const resCtrl = !ok ? '' : st.ctrl && st.ctrl.resultado ? (st.ctrl.resultado.ok ? '<span class="chip c-verde">Todo cuadra</span>' : '<span class="chip c-rojo">Hay diferencias</span>') : 'Lee la planilla para comparar';
  el.innerHTML = cab + `
    <section class="tarjeta grupo-pliegues" aria-labelledby="t-gb">
      <h2 id="t-gb">Base nueva (fen-gastos) ${H.info('Base nueva de Gastos', 'Es un proyecto de Firebase aparte (fen-gastos), en tu misma cuenta de Google, con su propia cuota gratis.\nEn esta etapa solo se copia la planilla de 2026 a la base nueva y se revisa que cuadre.\nGastos sigue funcionando igual, con la planilla: Registrar, pagar, el SII, la cartola y Previred no cambian. El cambio a la base nueva se hace después, todo de una vez.\nLas fotos y PDF de las boletas siguen en Drive.')}</h2>
      <p class="ayuda">${fuente.fuente === 'base' ? 'Gastos trabaja con la base nueva. La planilla queda como copia: cada cambio pasa solo, unos segundos después.' : 'Gastos sigue trabajando con la planilla hasta el cambio. Aquí solo se copia y se compara.'}</p>
      ${pliegue('conexion', 'Conexión', resCx, `<div id="gb-conexion">${errorCx ? `<p class="error" role="alert">${H.esc(errorCx)}</p>` : seccionConexion(cx, H)}</div>`)}
      ${ok ? pliegue('copia', `Copia desde la planilla (${GB.ANIO})`, fuente.fuente === 'base' ? 'Ya no se usa' : resCopia, fuente.fuente === 'base'
        ? '<p class="ayuda" id="gb-copia-cerrada">Gastos ya trabaja con la base nueva: la copia desde la planilla ya no se usa (copiaría de vuelta lo que la base pasó a la planilla). Ahora es al revés: mira "Copia a la planilla".</p>'
        : seccionCopia(H)) : ''}
      ${ok ? pliegue('control', 'Control de totales', resCtrl, seccionControl(H)) : ''}
      ${ok ? pliegue('planilla', 'Copia a la planilla', '<span class="chip c-gris" id="gb-planilla-chip">Apagada</span>', `<p class="ayuda" id="gb-planilla-estado">Apagada desde la v0.73.0 ${H.info('Copia a la planilla apagada', TXT_APAGADA)}</p>`) : ''}
      ${ok ? pliegue('proveedores', 'Proveedores', `<span id="gb-prov-res">${resumenProv(H)}</span>`, `<div id="gb-prov">${seccionProv(H)}</div>`) : ''}
      ${ok ? pliegue('cambio', 'Cambio a la base nueva', fuente.fuente === 'base' ? '<span class="chip c-verde">Gastos en la base nueva</span>' : '<span class="chip c-gris">Gastos en la planilla</span>', `<div id="gb-cambio">${seccionCambio(fuente, H)}</div>`) : ''}
      ${pliegue('drive', 'Archivos en Drive', st.drive.listo ? '<span class="chip c-verde">Privados</span>' : '', `<div id="gb-drive">${seccionDrive(H)}</div>`)}
    </section>`;
  conectarPliegues(el);
  const otra = () => pintar(el, cab, H);
  conectarConexion(el, cx, H, otra);
  if (ok) { if (fuente.fuente !== 'base') conectarCopia(el, H, otra); conectarPlanilla(H); conectarCambio(fuente, H, otra); conectarProv(H); }
  conectarDrive(H);
}

// ── Conexión ──
function seccionConexion(cx, H) {
  if (cx.estado === 'sin_config') {
    const cfg = cx.sugerida;
    return `<p class="ayuda">La configuración de <b>fen-gastos</b> ya viene escrita. Si creaste el proyecto con otro nombre, pega aquí el bloque <code>const firebaseConfig = { … }</code> de la consola (⚙️ Configuración del proyecto → Tus apps).</p>
      <div class="campo"><label for="gb-cfg">Configuración web de fen-gastos</label><textarea id="gb-cfg" rows="8" spellcheck="false" style="font-family:monospace;font-size:13px;padding:12px;border-radius:12px;border:1px solid var(--borde)">${cfg ? H.esc(JSON.stringify(cfg, null, 2)) : ''}</textarea></div>
      <div class="error" id="gb-cfg-err" role="alert"></div>
      <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="gb-conectar">Conectar</button></div>`;
  }
  if (cx.estado === 'sin_sesion') return `<p class="ayuda">Proyecto <b>${H.esc(cx.cfg.projectId)}</b> · cuenta <b>${H.esc(cx.correo)}</b></p>
      <form id="gb-form-entrar" style="max-width:420px">
        <div class="campo"><label for="gb-clave">Tu contraseña de Sistema Fën</label><input type="password" id="gb-clave" autocomplete="current-password" required></div>
        <div class="error" id="gb-entrar-err" role="alert"></div>
        <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn" id="gb-entrar">Entrar</button><button type="button" class="btn-sec" id="gb-cambiar-cfg">Cambiar configuración</button></div>
      </form>`;
  if (cx.estado === 'sin_admin') return `<p class="ayuda">Entraste a <b>${H.esc(cx.cfg.projectId)}</b> con <b>${H.esc(cx.correo)}</b>, pero esa cuenta no está en <code>admins</code>. Consola de Firebase de fen-gastos → Firestore Database → <b>Iniciar colección</b> <code>admins</code> → ID del documento:</p>
      <div class="aviso" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><code style="font-size:15px;word-break:break-all">${H.esc(cx.uid)}</code></div>
      <p class="ayuda" style="margin-top:8px">Agrega un campo <code>ok</code> (booleano, true) y guarda. Después presiona Revisar.</p>
      <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="gb-revisar">Revisar</button></div>`;
  return `<div class="fila-caja fila-compacta"><div class="txt"><b>Conectada a ${H.esc(cx.cfg.projectId)}</b><span>${H.esc(cx.correo)}</span></div><span class="chip c-verde">Lista</span></div>`;
}
function conectarConexion(el, cx, H, otra) {
  const bc = $('gb-conectar');
  if (bc) bc.addEventListener('click', async () => {
    $('gb-cfg-err').textContent = '';
    let cfg; try { cfg = GB.parsearConfig($('gb-cfg').value); } catch (e) { $('gb-cfg-err').textContent = e.message; return; }
    bc.disabled = true; bc.textContent = 'Conectando…';
    try { await GB.salir(); await GB.guardarConfig(cfg); H.registrar('Conectó la base nueva de Gastos', cfg.projectId); otra(); }
    catch (e) { $('gb-cfg-err').textContent = error(e, H); bc.disabled = false; bc.textContent = 'Conectar'; }
  });
  const cambiar = $('gb-cambiar-cfg');
  if (cambiar) cambiar.addEventListener('click', () => { $('gb-conexion').innerHTML = seccionConexion({ estado: 'sin_config', sugerida: cx.cfg }, H); conectarConexion(el, cx, H, otra); });
  const f = $('gb-form-entrar');
  if (f) f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const b = $('gb-entrar'); $('gb-entrar-err').textContent = ''; b.disabled = true; b.textContent = 'Entrando…';
    try { await GB.entrar($('gb-clave').value); otra(); }
    catch (e) { $('gb-entrar-err').textContent = error(e, H); b.disabled = false; b.textContent = 'Entrar'; }
  });
  const rev = $('gb-revisar');
  if (rev) rev.addEventListener('click', otra);
}

// ── Copia ──
function seccionCopia(H) {
  const p = st.prep;
  return `<p class="ayuda">Gastos, anulados, ítems, obligaciones, vencimientos, SII, Previred y cartola de ${GB.ANIO} ${H.info('Copia desde la planilla', `Lee la planilla de Gastos con el script (v${GB.VERSION_EXPORTAR}) y copia a la base nueva lo de ${GB.ANIO}: gastos (también los anulados, con quién y por qué), vencimientos de ${GB.ANIO} y los que siguen por pagar, cargas y documentos del SII, cotizaciones de Previred y la cartola. Ítems, obligaciones y reglas van completos.\nSe puede repetir las veces que quieras: solo escribe lo que cambió desde la copia anterior y nunca duplica.\nNada se borra. Si algo ya no está en la planilla (por ejemplo, un gasto corregido), en la base nueva queda marcado "quitado de la planilla" y deja de sumar.\nLas fotos y PDF de las boletas siguen en Drive.`)}</p>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="gb-leer" ${st.leyendo || st.copiando ? 'disabled' : ''}>${st.leyendo ? 'Leyendo la planilla…' : `Leer la planilla (${GB.ANIO})`}</button></div>
    <div id="gb-prep">${p ? resumenPrep(p, H) : ''}</div>
    <div id="gb-avance" class="ayuda" aria-live="polite">${H.esc(st.msg)}</div>`;
}
function resumenPrep(p, H) {
  const c = p.cambios;
  const filas = COLECCIONES.map(col => `<tr><td>${H.esc(NOMBRES[col])}</td><td>${n(p.totales.porColeccion[col])}</td><td>${n(c[col].nuevos.length)}</td><td>${n(c[col].cambiados.length)}</td><td>${n(c[col].quitar.length)}</td><td>${n(c[col].iguales)}</td></tr>`).join('');
  const g = p.totales.gastos;
  return `<p class="ayuda" style="margin-top:12px">Gastos de ${p.anio}: <b>${n(g.vigentes)}</b> vigentes y <b>${n(g.anulados)}</b> anulados.</p>
    <div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Qué</th><th scope="col">En la planilla</th><th scope="col">Nuevos</th><th scope="col">Cambiados</th><th scope="col">Quitados</th><th scope="col">Iguales</th></tr></thead><tbody>${filas}</tbody></table></div>
    ${p.avisos.length ? `<details class="aviso" style="margin-top:10px"><summary><b>${n(p.avisos.length)} ${p.avisos.length === 1 ? 'aviso' : 'avisos'} de la planilla</b> · no frenan la copia</summary><ul>${p.avisos.slice(0, 150).map(a => `<li>${H.esc(a.hoja)}${a.fila ? ', fila ' + H.esc(a.fila) : ''}: ${H.esc(a.texto)}</li>`).join('')}${p.avisos.length > 150 ? `<li>… y ${n(p.avisos.length - 150)} más</li>` : ''}</ul></details>` : ''}
    <div class="botones" style="justify-content:flex-start;margin-top:12px">${p.porEscribir
      ? `<button type="button" class="btn" id="gb-copiar" ${st.copiando ? 'disabled' : ''}>Copiar a la base nueva (${n(p.porEscribir)} ${p.porEscribir === 1 ? 'cambio' : 'cambios'})</button>`
      : '<span class="chip c-verde">Todo al día: no hay nada que copiar</span>'}</div>`;
}
function conectarCopia(el, H, otra) {
  const bl = $('gb-leer');
  if (bl) bl.addEventListener('click', async () => {
    st.leyendo = true; st.msg = ''; st.ctrl = null; bl.disabled = true; bl.textContent = 'Leyendo la planilla…';
    try { st.prep = await GB.preparar(t => { const a = $('gb-avance'); if (a) a.textContent = t; }); st.msg = ''; }
    catch (e) { st.prep = null; st.msg = error(e, H); }
    st.leyendo = false;
    // Si ya está todo copiado, el control se hace al tiro
    if (st.prep && !st.prep.porEscribir) await hacerControl(H);
    otra();
  });
  const bc = $('gb-copiar');
  if (bc) bc.addEventListener('click', async () => {
    if (!confirm(`¿Copiar ${n(st.prep.porEscribir)} ${st.prep.porEscribir === 1 ? 'cambio' : 'cambios'} a la base nueva? La planilla no cambia.`)) return;
    st.copiando = true; bc.disabled = true;
    try {
      const r = await GB.copiar(st.prep, (h, t) => { const a = $('gb-avance'); if (a) a.textContent = `Copiando… ${n(h)} de ${n(t)}`; });
      H.registrar('Copió Gastos a la base nueva', `${n(r.escritos)} documentos · ${GB.ANIO}`);
      st.msg = `Listo: ${n(r.escritos)} ${r.escritos === 1 ? 'documento copiado' : 'documentos copiados'}.`;
      // Lo copiado ya está: lo que queda por copiar es nada (si se vuelve a leer, lo confirma)
      const p = st.prep; COLECCIONES.forEach(c => { const x = p.cambios[c]; x.iguales += x.nuevos.length + x.cambiados.length; x.nuevos = []; x.cambiados = []; x.quitar = []; });
      p.porEscribir = 0;
      await hacerControl(H);
    } catch (e) { st.msg = error(e, H) + ' Lo copiado hasta aquí queda; vuelve a leer la planilla y copia lo que falta.'; }
    st.copiando = false; otra();
  });
  const bt = $('gb-control');
  if (bt) bt.addEventListener('click', async () => { bt.disabled = true; bt.textContent = 'Revisando…'; await hacerControl(H); otra(); });
}
async function hacerControl(H) {
  try { st.ctrl = await GB.control(st.prep); st.ctrlErr = ''; } catch (e) { st.ctrl = null; st.ctrlErr = error(e, H); }
}

// ── Control de totales ──
function seccionControl(H) {
  const c = st.ctrl, r = c && c.resultado;
  const boton = `<div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="gb-control">Control de totales</button></div>`;
  const ayuda = `<p class="ayuda">Planilla contra base nueva ${H.info('Control de totales', 'Compara lo leído de la planilla con lo que hay en la base nueva: cuántos documentos hay en cada parte y, en los gastos vigentes, cuántos, el monto neto y el monto final de cada mes.\nLo marcado "quitado de la planilla" no cuenta.\nCuesta una lectura por cada gasto de la base nueva (unas pocas miles): úsalo después de copiar.')}</p>`;
  if (st.ctrlErr) return ayuda + `<p class="error" role="alert">${H.esc(st.ctrlErr)}</p>` + boton;
  if (!r) return ayuda + `<p class="ayuda">${st.prep ? 'Presiona "Control de totales" para comparar.' : 'Lee la planilla para comparar.'}</p>` + (st.prep ? boton : '');
  const val = (f, v) => (f.pesos ? pesos(v) : n(v));
  const tabla = filas => `<div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Qué</th><th scope="col">Planilla</th><th scope="col">Base nueva</th><th scope="col"><span class="sr">Cuadra</span></th></tr></thead><tbody>
    ${filas.map(f => `<tr><td>${H.esc(f.que)}</td><td>${val(f, f.planilla)}</td><td>${val(f, f.base)}</td><td>${f.ok ? '<span class="chip c-verde">Cuadra</span>' : '<span class="chip c-rojo">No cuadra</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  return ayuda + `<p class="${r.ok ? 'ok-texto' : 'error'}" role="status" id="gb-control-res">${r.ok ? 'Todo cuadra: la base nueva tiene lo mismo que la planilla.' : `Hay ${r.diferencias.length} ${r.diferencias.length === 1 ? 'diferencia' : 'diferencias'}: ${H.esc(r.diferencias.slice(0, 6).map(d => d.que).join(' · '))}${r.diferencias.length > 6 ? '…' : ''}. Si recién copiaste, lee la planilla de nuevo; si siguen, avísame.`}</p>
    <h3 style="margin:12px 0 4px;font-size:15px">Por colección</h3>${tabla(r.filas.filter(f => f.grupo !== 'mes'))}
    <h3 style="margin:12px 0 4px;font-size:15px">Gastos vigentes por mes</h3>${tabla(r.filas.filter(f => f.grupo === 'mes'))}
    ${boton}`;
}

// ── v0.44.0 · Archivos en Drive ──
// No necesita la base nueva: habla con el script de Gastos (v2.10.0), que deja privados los
// archivos de las carpetas antiguas y de "Fën · Gastos", de a partes. Se puede repetir.
const TXT_DRIVE = 'Lo que se sube desde Sistema Fën (fotos y PDF de boletas, comprobantes de pago, archivos del SII, PDF de Previred y cartolas) queda en Drive, en la carpeta "Fën · Gastos", con una carpeta por tipo y otra por año. Es privado: los enlaces "Boleta", "comprobante", "Archivo en Drive", "PDF en Drive" y "Ver archivo" se abren solo con la cuenta de Google de Emmanuel.\nLo subido antes (carpetas "Boletas Gastos", "Comprobantes Pagos", "Cargas SII" y "Cotizaciones Previred") quedaba abierto a cualquiera con el enlace. Este botón lo deja privado, de a partes. Si se corta, vuelve a presionarlo y sigue donde quedó. Repetirlo no hace daño: no mueve ni borra nada.\nNecesita el script de Gastos v' + Gastos.VERSION_DRIVE + '.';
function avanceDrive(d) {
  return d.total != null ? `${n(d.revisados)} de ${n(d.total)} archivos` : `${n(d.revisados)} ${d.revisados === 1 ? 'archivo' : 'archivos'}`;
}
function seccionDrive(H) {
  const d = st.drive;
  const texto = d.corriendo ? 'Revisando… ' + avanceDrive(d) : d.msg;
  return `<p class="ayuda">Boletas, comprobantes, SII, Previred y cartolas ${H.info('Archivos en Drive', TXT_DRIVE)}</p>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="gb-privados" ${d.corriendo ? 'disabled' : ''}>${d.corriendo ? 'Revisando…' : d.siguiente ? 'Seguir donde quedó' : 'Dejar privados los archivos ya subidos'}</button></div>
    ${d.total ? `<progress id="gb-priv-barra" max="${d.total}" value="${Math.min(d.revisados, d.total)}" style="width:100%;margin-top:8px" aria-label="Avance"></progress>` : ''}
    <p id="gb-priv-avance" class="ayuda" role="status" aria-live="polite">${H.esc(texto)}</p>
    ${d.err ? `<p class="error" role="alert">${H.esc(d.err)}</p>` : ''}`;
}
function pintarDrive(H) { const c = $('gb-drive'); if (c) { c.innerHTML = seccionDrive(H); conectarDrive(H); } }
function conectarDrive(H) {
  const b = $('gb-privados');
  if (b) b.addEventListener('click', () => dejarPrivados(H));
}
async function dejarPrivados(H) {
  const d = st.drive;
  if (d.corriendo) return;
  const seguir = !!d.siguiente;
  if (!seguir) Object.assign(d, { revisados: 0, total: null, cambiados: 0, fallidos: 0 });
  Object.assign(d, { corriendo: true, msg: '', err: '', listo: false });
  pintarDrive(H);
  try {
    do {
      const r = await Gastos.dejarPrivados(d.siguiente);
      Object.assign(d, { revisados: r.revisados || 0, total: r.total == null ? null : r.total, cambiados: r.cambiados || 0, fallidos: r.fallidos || 0, siguiente: r.siguiente || null });
      pintarDrive(H);
    } while (d.siguiente);
    d.listo = true;
    d.msg = `Listo: ${avanceDrive(d)} revisados. ` + (d.cambiados ? `${n(d.cambiados)} ${d.cambiados === 1 ? 'quedó privado' : 'quedaron privados'}` : 'Ya estaban todos privados')
      + (d.fallidos ? `; ${n(d.fallidos)} no se pudieron cambiar (son de otra cuenta)` : '') + '.';
    H.registrar('Dejó privados los archivos de Drive', `${n(d.revisados)} revisados · ${n(d.cambiados)} cambiados`);
    const res = document.querySelector('#gb-res-drive'); if (res) res.innerHTML = '<span class="chip c-verde">Privados</span>';
  } catch (e) {
    d.err = ((e && e.message) || H.mensajeError(e)) + (d.siguiente ? ' Lo revisado hasta aquí ya quedó: presiona "Seguir donde quedó".' : '');
  }
  d.corriendo = false;
  pintarDrive(H);
}

// ── v0.45.0 · Copia a la planilla (G2) ──
// Después del cambio, lo hecho en la base pasa solo a la planilla (script de Gastos v2.11.0). Aquí se ve si está al día.
const TXT_PLANILLA = 'Después del cambio, Gastos se registra en la base nueva y la planilla queda como copia: Looker Studio y el reparto de costos de Producción (que lee "Registro Gasto") la siguen usando.\nCada gasto, pago, obligación o ítem hecho o cambiado en la base pasa a la planilla unos segundos después. Si no se puede (sin internet, el script ocupado), queda anotado y se reintenta solo: al minuto y después cada 2 minutos. No se pierde nada.\nCada fila lleva al final la columna "ID base", con la que se reconoce. Un gasto anulado pasa a "Gastos anulados" con quién, cuándo y por qué, como hoy.\nAntes del cambio no hay nada que pasar: la planilla se usa como siempre.';
function chipPlanilla() {
  const e = GP.estado();
  if (e.error) return '<span class="chip c-rojo">Pendiente</span>';
  if (e.pendientes === null || e.corriendo) return '<span class="chip c-gris">Revisando</span>';
  return e.pendientes ? '<span class="chip c-amarillo">Por pasar</span>' : '<span class="chip c-verde">Al día</span>';
}
// v0.73.0 (Etapa 1): la copia en vivo a la planilla está apagada
const TXT_APAGADA = 'Desde la v0.73.0, lo que haces en Gastos ya no se copia a la planilla (Looker Studio salió del plan). La planilla de Gastos queda como estaba, como historial: no se borra nada.\nEn su lugar, una vez al mes bajas el respaldo en Excel (Configuración → Respaldo): trae los gastos, vencimientos, documentos del SII y cargos de la cartola del mes, más B2B, la caja y los catálogos.\nLa copia de la Agenda a Google Calendar sigue igual.';
function seccionPlanilla(H) {
  const e = GP.estado();
  const u = e.ultima;
  return `<p class="ayuda">De la base nueva a la planilla ${H.info('Copia a la planilla', TXT_PLANILLA)}</p>
    <p id="gb-planilla-estado" class="${e.error ? 'error' : 'ayuda'}" role="status" aria-live="polite">${H.esc(GP.texto())}</p>
    ${u ? `<p class="ayuda" id="gb-planilla-ultima">Última vez: ${H.esc(H.hace(u.en))} · ${H.esc(String(u.pasados))} ${u.pasados === 1 ? 'cambio pasado' : 'cambios pasados'}${u.avisos.length ? ` · ${H.esc(String(u.avisos.length))} ${u.avisos.length === 1 ? 'aviso' : 'avisos'}` : ''}</p>
      ${u.avisos.length ? `<ul class="ayuda">${u.avisos.slice(0, 20).map(a => `<li>${H.esc(a.texto)}</li>`).join('')}</ul>` : ''}` : ''}
    ${e.pendientes || e.error ? `<div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="gb-planilla-pasar" ${e.corriendo ? 'disabled' : ''}>Pasar ahora</button></div>` : ''}`;
}
let soltarPlanilla = null;
function conectarPlanilla(H) {
  if (soltarPlanilla) soltarPlanilla();
  const repintar = () => {
    const c = document.querySelector('details[data-pliegue="planilla"] .pliegue-cuerpo');
    if (!c || !c.isConnected) { if (soltarPlanilla) { soltarPlanilla(); soltarPlanilla = null; } return; }
    c.innerHTML = seccionPlanilla(H);
    const chip = $('gb-planilla-chip'); if (chip) chip.innerHTML = chipPlanilla();
    const b = $('gb-planilla-pasar'); if (b) b.addEventListener('click', () => GP.pasar());
  };
  if (GP.APAGADA) return;   // v0.73.0: la copia está apagada (el pliegue solo lo dice)
  soltarPlanilla = GP.alCambiar(repintar);
  repintar();
  GP.revisar().catch(() => {});
}

// ── v0.45.0 · Cambio a la base nueva (G2) ──
const TXT_CAMBIO = 'El cambio se hace todo de una vez, un fin de semana. Ya está todo Gastos listo para la base nueva: G2 (registrar, pagar, obligaciones, ítems, análisis y agenda) y G3 (SII, cartola y Previred). La guía del cambio (README) tiene los pasos.\nAl presionar "Pasar Gastos a la base nueva":\n1. La app antigua de Gastos y lo que escribía en la planilla dejan de registrar (dicen "Gastos ya se registra en la base nueva"). Las lecturas siguen.\n2. Se lee la planilla, se copia a la base nueva lo que falte y se hace el control de totales.\n3. Solo si dice "Todo cuadra", Gastos queda en la base nueva. Si no cuadra o algo falla, todo vuelve a como estaba.\nDesde ahí, cada cambio pasa a la planilla unos segundos después. Nada con historia se borra: se anula.';
const fechaHora = v => { const d = v && (typeof v.toDate === 'function' ? v.toDate() : new Date(v)); return d && !isNaN(d) ? d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
function seccionCambio(f, H) {
  const c = st.cambio, enBase = f.fuente === 'base', listo = GB.CAMBIO_HABILITADO();
  const estado = enBase
    ? `<div class="fila-caja fila-compacta"><div class="txt"><b>Gastos trabaja con la base nueva</b><span>Desde ${H.esc(fechaHora(f.desde) || '—')}${f.por ? ' · ' + H.esc(f.por) : ''}</span></div><span class="chip c-verde">Base nueva</span></div>`
    : `<div class="fila-caja fila-compacta"><div class="txt"><b>Gastos trabaja con la planilla</b><span>Como siempre: la app de Gastos y Sistema Fën escriben en la planilla</span></div><span class="chip c-gris">Planilla</span></div>`;
  const pasos = `<ol class="ayuda" style="margin:8px 0 8px 18px;padding:0">
      <li>Instala antes el script de Gastos v2.17.0 (todos los archivos .gs) y esta versión de Sistema Fën.</li>
      <li>Un fin de semana, sin registrar nada en la app antigua mientras se hace (unos minutos).</li>
      <li>Presiona <b>Pasar Gastos a la base nueva</b>: se cierra la planilla para escribir, se copia lo que falte y se revisa el control de totales. Solo sigue si dice <b>Todo cuadra</b>.</li>
      <li>Desde ahí, cada cambio pasa solo a la planilla unos segundos después (Looker y Producción la siguen leyendo).</li>
    </ol>`;
  const boton = enBase
    ? `<div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="gb-volver" ${c.corriendo ? 'disabled' : ''}>Volver a la planilla</button></div>`
    : `<div class="botones" style="justify-content:flex-start;align-items:center"><button type="button" class="btn" id="gb-cambiar" ${listo && !c.corriendo ? '' : 'disabled'} ${listo ? '' : 'aria-describedby="gb-cambio-bloqueado"'}>Pasar Gastos a la base nueva</button>${listo ? '' : '<span class="ayuda" id="gb-cambio-bloqueado">El cambio se habilita cuando estén listos G2 y G3</span>'}</div>`;
  return `<p class="ayuda">Todo de una vez, un fin de semana ${H.info('Cambio a la base nueva', TXT_CAMBIO)}</p>
    ${estado}${enBase ? '' : pasos}${boton}${enBase ? despues(H) : ''}
    <p id="gb-cambio-avance" class="ayuda" role="status" aria-live="polite">${H.esc(c.corriendo ? c.avance : c.msg)}</p>
    ${c.err ? `<p class="error" role="alert" id="gb-cambio-err">${H.esc(c.err)}</p>` : ''}`;
}
// ── v0.51.0 · Lo que queda justo después del cambio ──
const TXT_DESPUES = 'Gastos ya trabaja con la base nueva. Para que las propuestas de la cartola, las boletas y Previred funcionen solas, cada obligación necesita su tipo y, las de tipo según documento, su identificador.\nNada de esto es urgente para el día a día: lo que no esté clasificado funciona como monto fijo, igual que antes.';
const TXT_SINIVA = 'La app antigua registraba como "bruto" algunos pagos de obligaciones marcadas "Sin IVA" (cotizaciones, sueldos, arriendos sin IVA): el neto quedaba como el monto dividido por 1,19 y el IVA del análisis salía inflado.\nEste arreglo busca esos gastos de 2026 (nacidos de pagar una obligación sin IVA, con neto = monto / 1,19) y deja el neto igual al monto final (tipo de monto: sin IVA). El monto final no cambia.\nPrimero muestra la lista y la diferencia total; solo se aplica si confirmas. Cada gasto guarda en su historial el "ajuste siniva" y pasa a la planilla. Es opcional y se hace una vez (repetirlo no encuentra nada).';
function despues(H) {
  const x = st.siniva, p = x.previa;
  const tabla = p && p.lista.length ? `<div class="tabla-b2b"><table class="tabla-tiempos siniva-tabla" id="gb-siniva-tabla"><thead><tr><th scope="col">Fecha</th><th scope="col">Obligación</th><th scope="col">Ítem · área</th><th scope="col">Monto final</th><th scope="col">Neto antes</th><th scope="col">Neto nuevo</th></tr></thead><tbody>
    ${p.lista.slice(0, 200).map(g => `<tr><td>${H.esc(g.fecha.split('-').reverse().join('-'))}</td><td>${H.esc(g.obligacion)}</td><td>${H.esc(g.item)} · ${H.esc(g.area)}</td><td>${pesos(g.montoFinal)}</td><td>${pesos(g.netoAntes)}</td><td>${pesos(g.netoNuevo)}</td></tr>`).join('')}</tbody></table></div>${p.lista.length > 200 ? `<p class="ayuda">… y ${n(p.lista.length - 200)} más</p>` : ''}` : '';
  return `<h3 style="margin:16px 0 4px;font-size:16px" id="gb-despues-t">Lo que queda justo después del cambio ${H.info('Después del cambio', TXT_DESPUES)}</h3>
    <ol class="lista-despues" id="gb-despues">
      <li><b>Clasificar obligaciones</b>: revisa la propuesta de tipo de cada una y guárdalas. <a href="#gastos/config/clasificar" id="gb-ir-clasificar">Clasificar obligaciones</a></li>
      <li><b>Completar identificadores</b>: el N° de cliente de luz y agua, el RUT del proveedor de internet, gas o teléfono, y "Es Previred" en Cotizaciones (en la misma pantalla o en <a href="#gastos/config/cuentas">Obligaciones</a> → Editar).</li>
      <li><b>Arreglo "sin IVA"</b> (opcional) ${H.info('Arreglo sin IVA', TXT_SINIVA)}
        <div class="botones" style="justify-content:flex-start;margin-top:6px"><button type="button" class="btn-sec btn-chico" id="gb-siniva-ver" ${x.corriendo ? 'disabled' : ''}>Revisar el arreglo "sin IVA"</button>
        ${p && p.lista.length ? `<button type="button" class="btn btn-chico" id="gb-siniva-aplicar" ${x.corriendo ? 'disabled' : ''}>Aplicar el arreglo (${n(p.n)})</button>` : ''}</div>
        ${p ? `<p class="ayuda" id="gb-siniva-res">${p.lista.length ? `${n(p.n)} ${p.n === 1 ? 'gasto' : 'gastos'} de 2026 · el neto sube en total ${pesos(p.total)} (el monto final no cambia)` : 'No hay gastos por arreglar.'}</p>${tabla}` : ''}
        <p class="ayuda" id="gb-siniva-msg" role="status" aria-live="polite">${H.esc(x.msg)}</p>${x.err ? `<p class="error" role="alert">${H.esc(x.err)}</p>` : ''}</li>
      <li><b>Armar fichas de proveedores</b> (parte "Proveedores", arriba): una vez, para las sugerencias del SII.</li>
      <li><b>Dejar privados los archivos</b> (parte "Archivos en Drive", abajo), si no lo hiciste antes.</li>
      <li><b>Revisar la planilla y Looker Studio</b>: "Copia a la planilla" debe decir Planilla al día; registra y anula un gasto de prueba y míralo en Registro Gasto (columna "ID base") y en Looker.</li>
    </ol>`;
}
function conectarDespues(f, H, otra) {
  const x = st.siniva, ver = $('gb-siniva-ver'), ap = $('gb-siniva-aplicar');
  if (ver) ver.addEventListener('click', async () => {
    Object.assign(x, { corriendo: true, err: '', msg: 'Buscando gastos…' }); pintarCambio(f, H, otra);
    try { x.previa = await Gastos.previaSiniva(); x.msg = ''; } catch (e) { x.err = error(e, H); x.msg = ''; }
    x.corriendo = false; pintarCambio(f, H, otra);
  });
  if (ap) ap.addEventListener('click', async () => {
    const p = x.previa; if (!p || !p.lista.length) return;
    if (!confirm(`¿Aplicar el arreglo "sin IVA" a ${p.n} ${p.n === 1 ? 'gasto' : 'gastos'} de 2026?\n\nEl neto queda igual al monto final (sube en total ${pesos(p.total)}). El monto final no cambia. Cada gasto guarda el cambio en su historial y pasa a la planilla.`)) return;
    Object.assign(x, { corriendo: true, err: '', msg: 'Aplicando…' }); pintarCambio(f, H, otra);
    try {
      const r = await Gastos.aplicarSiniva(p.lista.map(g => g.id), (h, t) => { const m = $('gb-siniva-msg'); if (m) m.textContent = `Aplicando… ${n(h)} de ${n(t)}`; });
      x.msg = `Listo: ${n(r.ajustados)} ${r.ajustados === 1 ? 'gasto ajustado' : 'gastos ajustados'} (el neto subió ${pesos(r.diferencia)}).`;
      H.registrar('Aplicó el arreglo sin IVA', `${r.ajustados} gastos · ${pesos(r.diferencia)}`);
      x.previa = null;
    } catch (e) { x.err = error(e, H); x.msg = ''; }
    x.corriendo = false; pintarCambio(f, H, otra);
  });
}
function pintarCambio(f, H, otra) { const el = $('gb-cambio'); if (el) { el.innerHTML = seccionCambio(f, H); conectarCambio(f, H, otra); } }
function conectarCambio(f, H, otra) {
  const c = st.cambio;
  if (f.fuente === 'base') conectarDespues(f, H, otra);
  const b = $('gb-cambiar');
  if (b) b.addEventListener('click', async () => {
    if (!GB.CAMBIO_HABILITADO()) return;
    if (!confirm('¿Pasar Gastos a la base nueva ahora? La app antigua deja de registrar gastos en la planilla, se copia lo que falte y se revisa que todo cuadre. Hazlo cuando nadie esté registrando gastos.')) return;
    Object.assign(c, { corriendo: true, err: '', msg: '', avance: 'Empezando…' });
    pintarCambio(f, H, otra);
    try {
      const r = await GB.cambiarABase(t => { c.avance = t; const a = $('gb-cambio-avance'); if (a) a.textContent = t; });
      c.msg = r.ya ? 'Gastos ya estaba en la base nueva.' : `Listo: Gastos trabaja con la base nueva. Todo cuadra${r.escritos ? ` (se copiaron ${r.escritos.toLocaleString('es-CL')} cambios de último momento)` : ''}. Abajo está lo que queda por hacer.`;
      H.registrar('Pasó Gastos a la base nueva', r.escritos ? `${r.escritos} documentos copiados al final` : 'Todo cuadra');
      if (r.prep) { st.prep = r.prep; st.prep.porEscribir = 0; st.ctrl = r.control; }
    } catch (e) { c.err = error(e, H); }
    c.corriendo = false; otra();
  });
  const v = $('gb-volver');
  if (v) v.addEventListener('click', async () => {
    Object.assign(c, { corriendo: true, err: '', msg: '', avance: 'Revisando si se puede volver…' });
    pintarCambio(f, H, otra);
    try {
      const p = await GB.puedeVolver();
      if (!p.puede) { c.err = p.motivo; c.corriendo = false; pintarCambio(f, H, otra); return; }
      if (!confirm('¿Volver a trabajar con la planilla? La app antigua de Gastos vuelve a registrar y la base nueva queda como está.')) { c.corriendo = false; pintarCambio(f, H, otra); return; }
      await GB.volverAPlanilla();
      c.msg = 'Listo: Gastos volvió a trabajar con la planilla.';
      H.registrar('Volvió Gastos a la planilla', '');
    } catch (e) { c.err = error(e, H); }
    c.corriendo = false; otra();
  });
}

// ── v0.48.0 · Proveedores (etapa G3) ──
// Con la base nueva, las sugerencias al cargar del SII salen de proveedores/{rut}: lo que se clasificó con cada proveedor
// y cada producto en los últimos 2 años. Se actualiza solo al importar o vincular; "Armar fichas" las arma desde cero.
const fsSii = () => import('./gastos-sii-fs.js?v=0.138.0');
const TXT_PROV = 'Al cargar un archivo del SII, Sistema Fën sugiere cómo clasificar cada documento según cómo clasificaste antes a ese proveedor y a cada uno de sus productos (los últimos 2 años).\nCon la base nueva, eso queda guardado en una ficha por proveedor. Cada importación o vínculo la actualiza sola.\n"Armar fichas de proveedores" las arma desde cero con todo lo que hay en la base nueva (lo copiado de la planilla y lo hecho después). Hazlo una vez, después del cambio a la base nueva. Repetirlo no hace daño.\nNo cambia ningún gasto ni la planilla.';
function resumenProv(H) {
  const d = st.prov.datos;
  if (!d) return '';
  return d.n ? `${n(d.n)} ${d.n === 1 ? 'ficha' : 'fichas'}` : 'Sin fichas';
}
function seccionProv(H) {
  const p = st.prov, d = p.datos, m = d && d.meta;
  const cuando = m && (m.actualizado || m.armadas);
  return `<p class="ayuda">Lo aprendido para sugerir al cargar del SII ${H.info('Proveedores', TXT_PROV)}</p>
    ${d ? `<p class="ayuda" id="gb-prov-estado">${d.n ? `<b>${n(d.n)}</b> ${d.n === 1 ? 'proveedor' : 'proveedores'}` : 'Todavía no hay fichas de proveedores.'}${cuando ? ` · actualizado ${H.esc(fechaHora(cuando))}` : ''}${m && m.armadas ? ` · armadas el ${H.esc(fechaHora(m.armadas))}` : ''}</p>
      ${d.lista.length ? `<div id="gb-prov-lista">${d.lista.slice(0, 8).map(x => `<div class="fila-caja fila-compacta"><div class="txt"><b>${H.esc(x.razonSocial || 'Sin nombre')}</b><span>${H.esc(x.rut)} · ${n(x.documentos)} ${x.documentos === 1 ? 'documento' : 'documentos'} · ${n(x.productos)} ${x.productos === 1 ? 'producto' : 'productos'}${x.ultima ? ' · último ' + H.esc(x.ultima.split('-').reverse().join('-')) : ''}</span></div></div>`).join('')}${d.lista.length > 8 ? `<p class="ayuda">… y ${n(d.lista.length - 8)} más</p>` : ''}</div>` : ''}`
      : `<p class="ayuda" id="gb-prov-estado">${p.err ? '' : 'Revisando…'}</p>`}
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="gb-prov-armar" ${p.corriendo ? 'disabled' : ''}>${p.corriendo ? 'Armando…' : 'Armar fichas de proveedores'}</button></div>
    <p class="ayuda" id="gb-prov-msg" role="status" aria-live="polite">${H.esc(p.msg)}</p>
    ${p.err ? `<p class="error" role="alert">${H.esc(p.err)}</p>` : ''}`;
}
function pintarProv(H) {
  const c = $('gb-prov'); if (!c) return;
  c.innerHTML = seccionProv(H);
  const r = $('gb-prov-res'); if (r) r.innerHTML = resumenProv(H);
  const b = $('gb-prov-armar'); if (b) b.addEventListener('click', () => armarProv(H));
}
async function cargarProv(H) {
  try { st.prov.datos = await (await fsSii()).resumenProveedores(); st.prov.err = ''; }
  catch (e) { st.prov.err = error(e, H); }
  pintarProv(H);
}
function conectarProv(H) { pintarProv(H); cargarProv(H); }
async function armarProv(H) {
  const p = st.prov;
  if (p.corriendo) return;
  if (!confirm('¿Armar las fichas de proveedores con todo lo que hay en la base nueva? No cambia ningún gasto ni la planilla.')) return;
  Object.assign(p, { corriendo: true, msg: '', err: '' });
  pintarProv(H);
  try {
    const r = await (await fsSii()).armarProveedores(t => { p.msg = t; const m = $('gb-prov-msg'); if (m) m.textContent = t; });
    p.msg = `Listo: ${n(r.proveedores)} ${r.proveedores === 1 ? 'proveedor' : 'proveedores'} con datos de los últimos 2 años.`;
    H.registrar('Armó las fichas de proveedores', `${r.proveedores} proveedores`);
  } catch (e) { p.err = error(e, H); }
  p.corriendo = false;
  await cargarProv(H);
}
