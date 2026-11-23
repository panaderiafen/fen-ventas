// ═══════════════════════════════════════════════
//  Sistema Fën — pantalla Producción  v0.77.1
//  v0.77.1: siete pestañas (como Gastos, B2B y el Catálogo): Por revisar · Plan de Panadería · Recetas · Materias primas · Bodega ·
//  Merma · Configuración. Rutas: #produccion (Por revisar) · #produccion/plan-pan[/como|/fijos] · #produccion/recetas[/{id}] ·
//  #produccion/mp · #produccion/bodega · #produccion/merma · #produccion/config. Cada pestaña lee solo lo suyo al abrirla.
//  La conexión con la base de Cocina (fen-produccion) y las Cuentas de las áreas pasaron a Configuración → Cocina (#ajustes/cocina):
//  pintarAjustesCocina. Materias primas es el mismo maestro de la v0.76.0 (vista-finanzas.js → pintarMaestro), que antes vivía en
//  Finanzas → Costos. Recetas (solo para mirar) está en vista-prod-recetas.js.
//  Antes (v0.42.0 … v0.76.0): una sola página con tarjetas y pliegues (Desde Cocina, grupo Cocina y grupo Sistema).
//  H = ayudas de app.js: { esc, info, icono, registrar, mensajeError, hace, dialogo }
// ═══════════════════════════════════════════════
import * as P from './produccion.js?v=0.138.0';
import * as K from './cocina/consumo.js?v=0.17.12';
import { conBuscador, coincide } from './buscador.js?v=0.138.0';
import * as FBQ from './fermentacion.js?v=0.138.0';
import * as RV from './recetas-ver-modelo.js?v=0.138.0';
import * as MA from './mp-alta-modelo.js?v=0.138.0';
import * as CC from './campo-categoria.js?v=0.138.0';

const st = { fb: null, sab: null, fbMsg: '', prep: null, tot: null, copiando: false, msg: '', props: null, sols: null, abierta: null, costos: {}, cocinaMsg: '', mover: null, moverMsg: '', nRevisar: null, cfgMsg: '', merma: { periodo: 'semana', datos: null, msg: '', cargando: false }, bodega: { calc: null, msg: '', cargando: false, periodo: 'semana', agregar: '', ver: 'PROD' } };
const $ = id => document.getElementById(id);
const n = v => Number(v || 0).toLocaleString('es-CL');

function error(e, H) {
  const c = (e && e.code) || '';
  if (/permission-denied/.test(c)) return 'La base nueva no dejó leer o guardar: revisa que estén publicadas las reglas de fen-produccion v1.0.0 y que tu cuenta esté en admins (ver README).';
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return 'En fen-produccion no hay una cuenta con tu correo y esa contraseña. Créala en la consola de Firebase → Authentication (ver README).';
  if (/invalid-api-key|api-key-not-valid/.test(c)) return 'La configuración guardada no es válida (apiKey). Vuelve a pegarla.';
  if (/failed-precondition/.test(c)) return 'Firestore todavía no está creado en fen-produccion (consola → Firestore Database → Crear base de datos).';
  return (e && e.message) || H.mensajeError(e);
}

// ── v0.77.1 · Pestañas ──
export const TABS = [['revisar', '', 'Por revisar'], ['plan-pan', 'plan-pan', 'Plan de Panadería'], ['recetas', 'recetas', 'Recetas'], ['mp', 'mp', 'Materias primas'],
  ['bodega', 'bodega', 'Bodega'], ['merma', 'merma', 'Merma'], ['config', 'config', 'Configuración']];
// Rutas antiguas o con otro nombre → la pestaña (los enlaces viejos siguen funcionando)
export const ALIAS = { revisar: 'revisar', 'por-revisar': 'revisar', cocina: 'revisar', 'desde-cocina': 'revisar', recetas: 'recetas', 'materias-primas': 'mp', maestro: 'mp', mp: 'mp',
  bodega: 'bodega', merma: 'merma', config: 'config', configuracion: 'config', mover: 'config', fermentacion: 'config', sabado: 'config', 'plan-pan': 'plan-pan' };
export const A_AJUSTES = ['cuentas', 'conexion', 'base'];   // → Configuración → Cocina
const hashDe = tab => { const t = TABS.find(x => x[0] === tab); return '#produccion' + (t && t[1] ? '/' + t[1] : ''); };
const partes = () => (location.hash || '').replace('#', '').split('/');
const TXT_ACTUALIZAR = 'Lo que Sistema Fën lee de la base de Cocina (recetas, materias primas, configuración, bodega, días de Cocina) queda 10 minutos en memoria: así no gasta la cuota de las tablets de las jefas cada vez que abres Hoy, Producción o Finanzas.\nLo que cambias aquí se ve al tiro. Lo que cambian las jefas en Cocina puede tardar hasta 10 minutos en verse; "Actualizar" lo vuelve a leer ahora.\nCada pestaña lee solo lo suyo, al abrirla.';
const chipRevisar = () => st.nRevisar ? ` <span class="chip c-amarillo chip-chico" id="prod-n-revisar">${st.nRevisar}</span>` : ' <span id="prod-n-revisar" hidden></span>';
const cab = (H, tab) => `<div class="cabecera"><div><h1 id="t-produccion">Producción</h1><p>Lo que llega de Cocina, las recetas, las materias primas y la bodega</p></div>
  ${tab === 'plan-pan' ? '' : `<div class="botones" style="margin:0;align-items:center"><button type="button" class="btn-sec btn-chico" id="prod-actualizar">Actualizar</button>${H.info('Actualizar', TXT_ACTUALIZAR)}</div>`}</div>
  <nav class="pestanas pest-prod" role="tablist" aria-label="Pestañas de Producción">${TABS.map(([k, , t]) => `<a role="tab" href="${hashDe(k)}" data-prod-tab="${k}" aria-selected="${k === tab}">${t}${k === 'revisar' ? chipRevisar() : ''}</a>`).join('')}</nav>`;
function ponerChip(nn) {
  st.nRevisar = nn || 0;
  const c = $('prod-n-revisar'); if (!c) return;
  if (st.nRevisar) { c.hidden = false; c.className = 'chip c-amarillo chip-chico'; c.textContent = String(st.nRevisar); } else { c.hidden = true; c.textContent = ''; }
}
let tabActual = 'revisar';

export async function pintar(el, sub, H) {
  // Ruta → pestaña (y los enlaces viejos a la pestaña nueva)
  if (A_AJUSTES.includes(sub)) { location.replace('#ajustes/cocina'); return; }
  const tab = sub === '' ? 'revisar' : ALIAS[sub];
  if (!tab) { location.replace('#produccion'); return; }
  if (sub !== '' && TABS.find(x => x[0] === tab)[1] !== sub) { location.replace(hashDe(tab)); return; }
  tabActual = tab;
  // v0.63.3: un solo escuchador para el botón Actualizar (la cabecera se vuelve a dibujar en cada pantalla)
  if (!el.dataset.actualizar) {
    el.dataset.actualizar = '1';
    el.addEventListener('click', ev => {
      if (!ev.target.closest('#prod-actualizar')) return;
      P.olvidarMemoria(); st.bodega.calc = null; st.merma.datos = null; st.fb = null; st.sab = null; st.costos = {}; st.mover = null;
      import('./vista-prod-recetas.js?v=0.138.0').then(m => m.olvidar()).catch(() => {});
      pintar(el, partes()[1] || '', H);
    });
  }
  el.innerHTML = cab(H, tab) + '<div id="prod-tab" class="prod-tab" data-tab="' + tab + '"><section class="tarjeta"><div class="vacio" style="border:0" role="status">Abriendo…</div></section></div>';
  const cont = $('prod-tab');
  // En el celular las pestañas se pasan con el dedo: la elegida queda a la vista
  const nav = el.querySelector('.pest-prod'), sel = nav && nav.querySelector('[aria-selected="true"]');
  if (nav && sel && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, sel.offsetLeft - nav.offsetLeft - 16);
  // v0.71.1: Plan de Panadería (Etapa 1); desde la v0.77.1 es una pestaña (trae Finanzas y B2B: se carga recién al abrirla)
  if (tab === 'plan-pan') { contarRevisar(); const VPP = await import('./vista-plan-pan.js?v=0.138.0'); VPP.fijarH(H); return VPP.pintar(cont, H); }
  // Materias primas: los precios están en Finanzas; sin la base de Cocina se ven igual (sin crear ni cambiar, lo dice el aviso)
  if (tab === 'mp') { contarRevisar(); return pintarTab(cont, tab, H); }
  let cx;
  try { cx = await P.conexion(); } catch (e) { cont.innerHTML = `<section class="tarjeta"><p class="error">${H.esc(error(e, H))}</p></section>`; return; }
  if (tabActual !== tab || !document.body.contains(cont)) return;
  if (cx.estado !== 'ok') return pintarSinConexion(cont, H, cx);
  if (tab !== 'revisar') contarRevisar();
  return pintarTab(cont, tab, H);
}
// El número de la pestaña Por revisar fuera de ella: el mismo resumen de Hoy (limit y count; 2 minutos en memoria)
function contarRevisar() { P.pendientesCocina().then(r => { if (r) ponerChip((r.nRecetas || 0) + (r.nMps || 0)); }).catch(() => {}); }
function pintarTab(cont, tab, H) {
  if (tab === 'revisar') { cont.innerHTML = '<section class="tarjeta" aria-labelledby="t-prod-revision" id="prod-cocina"><div class="vacio" style="border:0">Revisando lo que llegó desde Cocina…</div></section>'; return pintarCocina(cont, H, true); }
  if (tab === 'recetas') return import('./vista-prod-recetas.js?v=0.138.0').then(m => m.pintar(cont, H, { sub: partes().slice(2).join('/') }));
  if (tab === 'mp') return import('./vista-finanzas.js?v=0.138.0').then(m => m.pintarMaestro(cont, H, { conteo: conteoMps }));
  if (tab === 'bodega') { cont.innerHTML = `<section class="tarjeta" aria-labelledby="t-prod-bodega"><h2 id="t-prod-bodega">Bodega</h2><div id="prod-bodega">${seccionBodega(H)}</div></section>`; return conectarBodega(H); }
  if (tab === 'merma') { cont.innerHTML = `<section class="tarjeta" aria-labelledby="t-prod-merma"><h2 id="t-prod-merma">Merma</h2><div id="prod-merma">${seccionMerma(H)}</div></section>`; return conectarMerma(cont, H); }
  if (tab === 'config') return pintarConfigTab(cont, H);
}
// Materias primas: cuántas hay en la base de Cocina (arriba del maestro; de la memoria, sin lecturas extra)
async function conteoMps() {
  try {
    const ms = (await P.materiasPrimas()).filter(m => m.tipo !== 'sub_receta'), est = m => m.estado || 'activa';
    return { total: ms.length, activas: ms.filter(m => est(m) === 'activa').length, insumos: ms.filter(m => m.tipo === 'insumo').length, archivadas: ms.filter(m => est(m) === 'archivada').length };
  } catch (e) { return null; }
}
function pintarSinConexion(cont, H, cx) {
  const txt = cx.estado === 'sin_config' ? 'Todavía no está conectada la base de Cocina (fen-produccion).'
    : cx.estado === 'sin_sesion' ? 'Falta entrar a la base de Cocina con tu contraseña de Sistema Fën.'
    : cx.estado === 'sin_admin' ? 'Tu cuenta todavía no está marcada como administración en la base de Cocina.' : 'No se pudo abrir la base de Cocina.';
  cont.innerHTML = `<section class="tarjeta" aria-labelledby="t-prod-sincx" id="prod-sin-conexion"><h2 id="t-prod-sincx">Falta conectar la base de Cocina ${H.info('Base de Cocina', 'Es la base de las tablets de las jefas (proyecto fen-produccion). Se conecta una vez, en Configuración → Cocina, junto con las cuentas de cada área.')}</h2>
    <p class="ayuda">${H.esc(txt)} Se hace en Configuración → Cocina.</p>
    <p><a class="btn" href="#ajustes/cocina" id="prod-ir-ajustes">Ir a Configuración → Cocina</a></p></section>`;
}

// ═══════════════ Configuración general → Cocina (v0.77.1: antes en Producción) ═══════════════
// Conexión con la base de Cocina (configuración, entrar, marcar administración) y las Cuentas de las áreas (tablets).
export async function pintarAjustesCocina(box, H) {
  if (!box) return;
  const tit = `<div class="titulo-fila"><h2 id="t-ajustes-cocina">Cocina ${H.info('Cocina', 'La conexión de Sistema Fën con la base de Cocina (fen-produccion, la de las tablets de las jefas) y las cuentas de cada área. Se usa una vez y casi nunca más: por eso está aquí y no en Producción.\nLo del día (Por revisar, recetas, materias primas, bodega, merma y la configuración de cada área) está en Producción.')}</h2></div>`;
  box.innerHTML = tit + '<div class="vacio" style="border:0">Revisando la conexión con Cocina…</div>';
  let cx;
  try { cx = await P.conexion(); } catch (e) { box.innerHTML = tit + `<p class="error">${H.esc(error(e, H))}</p>`; return; }
  if (cx.estado === 'sin_config') return pintarConfig(box, H, null, tit);
  if (cx.estado === 'sin_sesion') return pintarEntrar(box, H, cx, tit);
  if (cx.estado === 'sin_admin') return pintarSinAdmin(box, H, cx, tit);
  return pintarCuentas(box, H, cx, tit);
}
function pintarConfig(box, H, actual, tit) {
  box.innerHTML = tit + `<div aria-labelledby="t-prod-cfg">
    <h3 id="t-prod-cfg" class="sub-h3">Conectar la base de Cocina ${H.info('Base de Cocina', 'Es un proyecto de Firebase aparte (fen-produccion), en tu misma cuenta de Google, con su propia cuota gratis.\nLa configuración que pegas aquí no es secreta: solo dice cuál es el proyecto. Los datos los protegen las reglas y las cuentas (la tuya y la de cada área).')}</h3>
    <p class="ayuda">Consola de Firebase → proyecto <b>fen-produccion</b> → Configuración del proyecto (rueda) → Tus apps → la app web → copia todo el bloque <code>const firebaseConfig = { … }</code>.</p>
    <div class="campo"><label for="prod-cfg">Configuración web de fen-produccion</label><textarea id="prod-cfg" rows="8" spellcheck="false" style="font-family:monospace;font-size:13px;padding:12px;border-radius:12px;border:1px solid var(--borde)">${actual ? H.esc(JSON.stringify(actual, null, 2)) : ''}</textarea></div>
    <div class="error" id="prod-cfg-err" role="alert"></div>
    <div class="botones">${actual ? '<button type="button" class="btn-sec" id="prod-cfg-volver">Volver</button>' : ''}<button type="button" class="btn" id="prod-cfg-ok">Guardar y conectar</button></div></div>`;
  if (actual) $('prod-cfg-volver').addEventListener('click', () => pintarAjustesCocina(box, H));
  $('prod-cfg-ok').addEventListener('click', async () => {
    const btn = $('prod-cfg-ok'); $('prod-cfg-err').textContent = '';
    let cfg; try { cfg = P.parsearConfig($('prod-cfg').value); } catch (e) { $('prod-cfg-err').textContent = e.message; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await P.salir(); await P.guardarConfig(cfg); H.registrar('Conectó la base nueva de Producción', cfg.projectId); pintarAjustesCocina(box, H); }
    catch (e) { $('prod-cfg-err').textContent = error(e, H); btn.disabled = false; btn.textContent = 'Guardar y conectar'; }
  });
}
function pintarEntrar(box, H, cx, tit) {
  box.innerHTML = tit + `<div aria-labelledby="t-prod-entrar">
    <h3 id="t-prod-entrar" class="sub-h3">Entrar a la base de Cocina</h3>
    <p class="ayuda">Proyecto <b>${H.esc(cx.cfg.projectId)}</b> · cuenta <b>${H.esc(cx.correo)}</b> (tu misma contraseña de Sistema Fën)</p>
    <form id="prod-form-entrar" class="campo" style="max-width:420px">
      <label for="prod-clave">Tu contraseña de Sistema Fën</label><input type="password" id="prod-clave" autocomplete="current-password" required>
      <div class="error" id="prod-entrar-err" role="alert"></div>
      <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn" id="prod-entrar-ok">Entrar</button><button type="button" class="btn-sec" id="prod-cambiar-cfg">Cambiar configuración</button></div>
    </form></div>`;
  $('prod-cambiar-cfg').addEventListener('click', () => pintarConfig(box, H, cx.cfg, tit));
  $('prod-form-entrar').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('prod-entrar-ok'); $('prod-entrar-err').textContent = ''; btn.disabled = true; btn.textContent = 'Entrando…';
    try { await P.entrar($('prod-clave').value, false); pintarAjustesCocina(box, H); }
    catch (e) { $('prod-entrar-err').textContent = error(e, H); btn.disabled = false; btn.textContent = 'Entrar'; }
  });
}
function pintarSinAdmin(box, H, cx, tit) {
  box.innerHTML = tit + `<div aria-labelledby="t-prod-adm">
    <h3 id="t-prod-adm" class="sub-h3">Falta marcar tu cuenta como administración</h3>
    <p class="ayuda">Entraste a <b>${H.esc(cx.cfg.projectId)}</b> con <b>${H.esc(cx.correo)}</b>, pero esa cuenta no está en <code>admins</code>. Consola de Firebase de fen-produccion → Firestore Database → <b>Iniciar colección</b> <code>admins</code> → ID del documento:</p>
    <div class="aviso" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><code style="font-size:15px;word-break:break-all">${H.esc(cx.uid)}</code></div>
    <p class="ayuda" style="margin-top:8px">Agrega un campo <code>ok</code> (booleano, true) y guarda. Después presiona Revisar.</p>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="prod-revisar">Revisar</button></div></div>`;
  $('prod-revisar').addEventListener('click', () => { P.olvidarTodo(); pintarAjustesCocina(box, H); });
}
async function pintarCuentas(box, H, cx, tit) {
  let cuentas = [], msg = '';
  try { cuentas = await P.cuentas(); } catch (e) { msg = error(e, H); }
  const porArea = a => cuentas.filter(c => P.areasDeCuenta(c).includes(a));
  const listas = Object.keys(P.AREAS).filter(a => porArea(a).length).length;
  box.innerHTML = tit + `<p class="ayuda" id="prod-cx-ok"><span class="chip c-verde chip-chico">Conectada</span> Proyecto <b>${H.esc(cx.cfg.projectId)}</b> · ${H.esc(cx.correo || '')} <button type="button" class="btn-link" id="prod-cx-cambiar">Cambiar configuración</button></p>
    <h3 class="sub-h3" id="t-prod-cuentas">Cuentas de las áreas ${H.info('Cuentas de las áreas', 'Cada tablet de la cocina se autoriza una vez con la cuenta de su área (la creas en la consola de Firebase de fen-produccion → Authentication). Aquí dices de qué área es cada cuenta: con eso, esa tablet solo ve y cambia lo de su área. Una cuenta puede tener más de un área ("También entra a").\nEl UID está en la consola → Authentication → Usuarios. No es secreto.\nLa contraseña de cada cuenta no pasa por aquí: la escribes tú en la tablet al autorizarla.')}</h3>
    <p class="ayuda">Las tablets de la cocina y sus áreas · ${listas} de ${Object.keys(P.AREAS).length} áreas con cuenta</p>
    ${msg ? `<p class="error">${H.esc(msg)}</p>` : ''}
    <div class="lista-simple">${Object.keys(P.AREAS).map(a => `<div class="fila-caja fila-compacta"><div class="txt"><b>${P.AREAS[a]}</b><span>${porArea(a).length ? porArea(a).map(c => H.esc(c.uid) + (c.area !== a ? ` (también; principal ${H.esc(P.AREAS[c.area] || c.area)})` : '')).join(' · ') : 'Sin cuenta asignada'}</span></div>${porArea(a).length ? '<span class="chip c-verde">Lista</span>' : '<span class="chip c-gris">Falta</span>'}</div>`).join('')}</div>
    ${cuentas.length ? `<h3 style="margin:14px 0 4px;font-size:15px">Cuentas ${H.info('Cambiar las áreas de una cuenta', 'Toca "Cambiar" para cargar la cuenta en el formulario de abajo, marca o desmarca áreas y presiona Guardar.\nSi una tablet ya estaba abierta, toma el cambio en la próxima carga.')}</h3>
    <div class="lista-simple">${cuentas.map(c => `<div class="fila-caja fila-compacta"><div class="txt"><b>${P.areasDeCuenta(c).map(a => H.esc(P.AREAS[a])).join(' + ') || 'Sin área'}</b><span>${H.esc(c.uid)}</span></div><button type="button" class="btn-sec" data-cta-editar="${H.esc(c.uid)}">Cambiar</button></div>`).join('')}</div>` : ''}
    <form id="prod-cuenta" style="margin-top:12px">
      <div class="fila-campos fila-bod">
        <div class="campo"><label for="prod-cta-area">Área principal ${H.info('Área principal', 'Con esta área abre la tablet la primera vez. Después recuerda la última en que estuvo.')}</label><select id="prod-cta-area">${Object.entries(P.AREAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo campo-ancho"><label for="prod-cta-uid">UID de la cuenta del área</label><input id="prod-cta-uid" spellcheck="false" autocomplete="off"></div>
      </div>
      <fieldset style="border:0;padding:0;margin:8px 0 0"><legend style="font-weight:600;font-size:14px;margin-bottom:4px">También entra a ${H.info('Más de un área', 'Marca las otras áreas a las que puede entrar esta tablet (por ejemplo, una tablet compartida entre Bollería y Pastelería).\nArriba de la app aparece "Cambiar de área". En cada área se pide el PIN de una persona de esa área, y la tablet ve y cambia solo lo de esa área mientras está en ella.')}</legend>
        <div style="display:flex;gap:16px;flex-wrap:wrap">${Object.entries(P.AREAS).map(([k, v]) => `<label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" name="prod-cta-otras" value="${k}">${v}</label>`).join('')}</div>
      </fieldset>
      <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn-sec">Guardar</button></div>
    </form>
    <div class="error" id="prod-cta-err" role="alert"></div>`;
  $('prod-cx-cambiar').addEventListener('click', () => pintarConfig(box, H, cx.cfg, tit));
  const marcarPrincipal = () => box.querySelectorAll('[name="prod-cta-otras"]').forEach(x => { const es = x.value === $('prod-cta-area').value; x.disabled = es; if (es) x.checked = false; });
  $('prod-cta-area').addEventListener('change', marcarPrincipal); marcarPrincipal();
  box.querySelectorAll('[data-cta-editar]').forEach(b => b.addEventListener('click', () => {
    const c = cuentas.find(x => x.uid === b.dataset.ctaEditar); if (!c) return;
    $('prod-cta-uid').value = c.uid; $('prod-cta-area').value = P.AREAS[c.area] ? c.area : 'PAN';
    const otras = P.areasDeCuenta(c).filter(a => a !== c.area);
    box.querySelectorAll('[name="prod-cta-otras"]').forEach(x => { x.checked = otras.includes(x.value); });
    marcarPrincipal(); $('prod-cta-uid').focus();
  }));
  $('prod-cuenta').addEventListener('submit', async ev => {
    ev.preventDefault(); $('prod-cta-err').textContent = '';
    const principal = $('prod-cta-area').value, otras = [...box.querySelectorAll('[name="prod-cta-otras"]:checked')].map(x => x.value).filter(a => a !== principal);
    try { await P.asignarCuenta($('prod-cta-uid').value, principal, otras); H.registrar('Asignó una cuenta de área (Producción)', `${[principal, ...otras].map(a => P.AREAS[a]).join(' + ')} · ${$('prod-cta-uid').value.trim()}`); pintarCuentas(box, H, cx, tit); }
    catch (e) { $('prod-cta-err').textContent = error(e, H); }
  });
}

function tablaControl(prep, tot) {
  const filas = [];
  Object.keys(P.AREAS).forEach(a => filas.push([`Recetas de ${P.AREAS[a]}`, prep ? prep.resumen.recetasPorArea[a] : null, tot.recetasPorArea[a]]));
  filas.push(['Materias primas', prep ? prep.resumen.mps : null, tot.mps]);
  filas.push(['Personas que entran con PIN', prep ? prep.resumen.personas : null, tot.personas]);
  ['PAN', 'BOL', 'PAS'].forEach(a => filas.push([`Unidades planificadas de ${P.AREAS[a]} (planes sin cambios en Cocina)`, prep ? prep.planesACopiar.filter(id => id.startsWith(a + '_')).reduce((s, id) => s + Object.values(prep.docs.planes[id].filas).reduce((x, d) => x + Object.values(d).reduce((y, v) => y + v, 0), 0), 0) : null, tot.unidadesSinCambiar[a]]));
  const ok = filas.every(f => f[1] === null || Math.round(f[1]) === Math.round(f[2]));
  return `<div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Qué</th><th scope="col">Planilla</th><th scope="col">Base nueva</th><th scope="col"><span class="sr">Cuadra</span></th></tr></thead><tbody>
    ${filas.map(([t, a, b]) => `<tr><td>${t}</td><td>${a === null ? '—' : n(a)}</td><td>${n(b)}</td><td>${a === null ? '' : Math.round(a) === Math.round(b) ? '<span class="chip c-verde">Cuadra</span>' : '<span class="chip c-rojo">No cuadra</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    ${prep ? `<p class="${ok ? 'ok-texto' : 'error'}" style="margin-top:8px">${ok ? 'Todo cuadra: la base nueva tiene lo mismo que la planilla.' : 'Hay diferencias. Si recién copiaste, presiona "Leer la planilla" de nuevo; si siguen, avísame.'}</p>` : '<p class="ayuda">Lee la planilla para comparar.</p>'}`;
}

// ═══════════════ Configuración (pestaña): por área, fermentación en bloque, ajuste de sábado y pasar recetas a Pastelería ═══════════════
// Lee la configuración de la memoria; la lista de la fermentación en bloque y el ajuste de sábado se leen al abrir la pestaña.
async function pintarConfigTab(cont, H) {
  let cfgs = {};
  try { cfgs = await P.leerConfigs(); } catch (e) { st.msg = error(e, H); }
  if (tabActual !== 'config' || !document.body.contains(cont)) return;
  cont.innerHTML = `<section class="tarjeta" aria-labelledby="t-prod-config"><h2 id="t-prod-config">Configuración de Producción</h2>
      ${st.msg ? `<p class="error">${H.esc(st.msg)}</p>` : ''}
      <div id="prod-config">${seccionConfig(cfgs, H)}</div></section>
    <section class="tarjeta" aria-labelledby="t-prod-mover"><h2 id="t-prod-mover">Pasar recetas de Bollería a Pastelería</h2>
      <div id="prod-mover"><p class="ayuda">Rellenos, cremas y preparaciones del día ${H.info('Pasar recetas a Pastelería', 'Los rellenos, cremas y otras preparaciones del día pasan a Pastelería. Marca cuáles: se mueven en la base de Cocina con el mismo ID (la planilla ya no se escribe).\nLos productos de Bollería que las usan siguen funcionando: la sub receta queda habilitada para las dos áreas.')}</p>
      ${st.mover ? listaMover(H) : '<div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="prod-mover-ver">Ver las recetas de Bollería</button></div>'}
      ${st.moverMsg ? `<p class="ayuda" role="status">${H.esc(st.moverMsg)}</p>` : ''}</div></section>`;
  st.msg = '';
  const repintar = () => pintarConfigTab(cont, H);
  cargarFB(cont, H, cfgs);
  if (st.fb) conectarFB();
  st.fbMsg = '';
  const fFB = $('prod-fb');
  if (fFB) fFB.addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('prod-fb-err'), btn = $('prod-fb-guardar'); err.textContent = '';
    const valores = {};
    for (const inp of fFB.querySelectorAll('[data-fb-id]')) {
      const r = FBQ.leerHHMM(inp.value);
      inp.removeAttribute('aria-invalid');
      if (!r.ok) {
        inp.setAttribute('aria-invalid', 'true');
        const fila = inp.closest('.fb-fila'); if (fila) fila.hidden = false;
        err.textContent = `${inp.closest('.fb-fila').dataset.fbNombre}: escribe horas y minutos, por ejemplo 2:00 (máximo 48:00), o déjalo vacío.`;
        inp.focus(); return;
      }
      valores[inp.dataset.fbId] = r.min;
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await P.guardarFB('PAN', valores);
      const con = Object.values(valores).filter(v => v > 0).length;
      H.registrar('Cambió la fermentación en bloque (Producción)', `Panadería · ${con} ${con === 1 ? 'receta' : 'recetas'} con f.b.`);
      st.fbMsg = 'Guardado. Las tablets lo ven al instante.';
      repintar();
    } catch (e) { err.textContent = error(e, H); btn.disabled = false; btn.textContent = 'Guardar fermentación en bloque'; }
  });
  const verMover = $('prod-mover-ver');
  if (verMover) verMover.addEventListener('click', async () => {
    verMover.disabled = true; verMover.textContent = 'Cargando…';
    try { st.mover = await P.recetasDeArea('BOL'); st.moverMsg = ''; } catch (e) { st.moverMsg = error(e, H); }
    repintar();
  });
  const btnMover = $('prod-mover-ok');
  if (btnMover) btnMover.addEventListener('click', async () => {
    const ids = [...cont.querySelectorAll('[data-mover]:checked')].map(x => x.dataset.mover);
    if (!ids.length) { st.moverMsg = 'Marca al menos una receta.'; repintar(); return; }
    if (!confirm(`¿Pasar ${ids.length} ${ids.length === 1 ? 'receta' : 'recetas'} a Pastelería? Se mueven en la planilla y en la base nueva, con el mismo ID.`)) return;
    btnMover.disabled = true; btnMover.textContent = 'Moviendo…';
    try {
      const r = await P.moverRecetas(ids);
      H.registrar('Pasó recetas de Bollería a Pastelería', `${r.movidas.length} recetas`);
      st.moverMsg = `Listo: ${r.movidas.length} ${r.movidas.length === 1 ? 'receta pasó' : 'recetas pasaron'} a Pastelería.${r.saltadas.length ? ' No se movieron: ' + r.saltadas.map(x => `${x.id} (${x.motivo})`).join(', ') + '.' : ''}`;
      st.mover = await P.recetasDeArea('BOL');
    } catch (e) { st.moverMsg = error(e, H); }
    repintar();
  });
  cont.querySelectorAll('[data-cfg-area]').forEach(f => f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const area = f.dataset.cfgArea, err = f.querySelector('.error'), btn = f.querySelector('button[type=submit]');
    err.textContent = '';
    const cambios = {};
    for (const c of P.CAMPOS_CONFIG[area]) {
      if (c.t === 'dias') { cambios[c.k] = [...f.querySelectorAll(`[name="${area}-${c.k}"]:checked`)].map(x => Number(x.value)); if (!cambios[c.k].length) { err.textContent = `${c.etiqueta}: marca al menos un día.`; return; } continue; }
      const t = f.querySelector(`[data-k="${c.k}"]`).value.trim();
      if (t === '') { cambios[c.k] = null; continue; }
      if (c.t === 'fecha') { if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) { err.textContent = `${c.etiqueta}: elige una fecha o déjalo vacío.`; return; } cambios[c.k] = t; continue; }
      const v = Number(t.replace(',', '.'));
      if (!isFinite(v) || v < 0 || v > 100000) { err.textContent = `${c.etiqueta}: escribe un número (0 o más).`; return; }
      cambios[c.k] = v;
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try { await P.guardarConfigArea(area, cambios); H.registrar('Cambió la configuración de Producción', P.AREAS[area]); repintar(); }
    catch (e) { err.textContent = error(e, H); btn.disabled = false; btn.textContent = 'Guardar'; }
  }));
}


function resumenPrep(p, H) {
  const r = p.resumen, docs = Object.keys(p.docs.recetas).length + Object.keys(p.docs.mps).length + Object.keys(p.docs.config).length + Object.keys(p.docs.personas).length + p.planesACopiar.length;
  return `<div class="tabla-b2b" style="margin-top:12px"><table class="tabla-tiempos"><thead><tr><th scope="col">Qué</th><th scope="col">En la planilla</th><th scope="col">Se copia</th></tr></thead><tbody>
      ${Object.keys(P.AREAS).map(a => `<tr><td>Recetas de ${P.AREAS[a]}</td><td>${n(r.recetasPorArea[a])}</td><td>${n(r.recetasPorArea[a])}</td></tr>`).join('')}
      <tr><td>Materias primas (sin costos)</td><td>${n(r.mps)}</td><td>${n(r.mps)}</td></tr>
      <tr><td>Semanas planificadas</td><td>${n(r.planes)}</td><td>${n(p.planesACopiar.length)}${p.planesRespetados.length ? ` (${n(p.planesRespetados.length)} ya se cambiaron en Cocina: no se pisan)` : ''}</td></tr>
      <tr><td>Personas que entran con PIN</td><td>${n(r.personas)}</td><td>${n(r.personas)}</td></tr>
    </tbody></table></div>
    ${p.avisos.length ? `<details class="aviso" style="margin-top:10px"><summary><b>${p.avisos.length} ${p.avisos.length === 1 ? 'aviso' : 'avisos'} de la planilla</b> · no frenan la copia</summary><ul>${p.avisos.slice(0, 150).map(a => `<li>${H.esc(a.hoja)}${a.fila ? ', fila ' + a.fila : ''}: ${H.esc(a.texto)}</li>`).join('')}${p.avisos.length > 150 ? `<li>… y ${p.avisos.length - 150} más</li>` : ''}</ul></details>` : ''}
    <div class="botones" style="justify-content:flex-start;margin-top:12px"><button type="button" class="btn" id="prod-copiar" ${st.copiando ? 'disabled' : ''}>Copiar ${n(docs)} documentos a la base nueva</button></div>`;
}

// Configuración de Producción por área: la editas tú; las jefas la ven en Cocina (solo lectura)
const DIAS_C = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function seccionConfig(cfgs, H) {
  const bloque = area => {
    const c = cfgs[area] || {}, campos = P.CAMPOS_CONFIG[area];
    const viejo = area === 'BOL' && !(Number(c.amasadora_kg) > 0) && c.amasadora_max_por_tanda ? `<p class="ayuda">Hoy (app actual): ${H.esc(String(c.amasadora_max_por_tanda))} masas por tanda.</p>` : '';
    return `<form class="cfg-area" data-cfg-area="${area}" style="margin-top:14px">
      <h3 style="margin:0 0 6px">${P.AREAS[area]}${c.editado ? ' <span class="chip c-gris">editada aquí</span>' : ''}</h3>${viejo}
      ${campos.filter(f => f.t === 'dias').map(f => {
        const v = P.valorEn(c, f.k), sel = Array.isArray(v) ? v.map(Number) : [1, 4];
        return `<fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:600;font-size:14px;margin-bottom:4px">${H.esc(f.etiqueta)}</legend><div style="display:flex;gap:16px;flex-wrap:wrap">${DIAS_C.map((d, i) => `<label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" name="${area}-${f.k}" value="${i}" ${sel.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div><small class="ayuda">${H.esc(f.ayuda)}</small></fieldset>`;
      }).join('')}
      <div class="fila-campos" style="flex-wrap:wrap;align-items:flex-end">
        ${campos.filter(f => f.t !== 'dias').map(f => {
          const v = P.valorEn(c, f.k);
          const id = `cfg-${area}-${f.k.replace(/\./g, '-')}`;
          const lab = `<label for="${id}">${H.esc(f.etiqueta)}${f.info ? ' ' + H.info(f.etiqueta, f.info) : ''}</label>`;
          if (f.t === 'fecha') return `<div class="campo" style="min-width:200px">${lab}<input id="${id}" data-k="${f.k}" type="date" value="${typeof v === 'string' ? H.esc(v) : ''}"><small class="ayuda">${H.esc(f.ayuda)}</small></div>`;
          return `<div class="campo" style="min-width:200px">${lab}<input id="${id}" data-k="${f.k}" inputmode="decimal" value="${v === undefined || v === null ? '' : H.esc(String(v).replace('.', ','))}" placeholder="${f.def !== undefined ? f.def : ''}"><small class="ayuda">${H.esc(f.ayuda)}</small></div>`;
        }).join('')}
      </div>
      <div class="error" role="alert"></div>
      <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn-sec">Guardar ${P.AREAS[area]}</button></div>
    </form>`;
  };
  return `<p class="ayuda">Cómo calcula Cocina en cada área ${H.info('Configuración de Producción', 'Lo que define cómo calcula Cocina en cada área: amasadora, tandas por día, merma, congeladores, días del pie de masa madre.\nLa cambias tú; las jefas la ven en Cocina sin poder cambiarla. Una configuración que guardas aquí no se pisa al volver a copiar desde la planilla.')}</p>
    ${bloque('PAN')}${bloqueFB(cfgs.PAN || {}, H)}<div class="cfg-area" id="prod-sab" style="margin-top:14px">${bloqueSab(H)}</div>${bloque('BOL')}${bloque('CAF')}`;
}

// ── v0.66.0 · Fermentación en bloque (Panadería): config/PAN.fermentacionBloque = { recetaId | subId: minutos } ──
// Se carga al abrir "Configuración de Producción" (recetas con su marca, como siempre, + ajustes/PAN__hoy: un documento).
const INFO_FB = 'Tiempo a temperatura ambiente después de terminar la masa. Ajústalo según la temporada: en invierno más, en verano menos.';
function bloqueFB(c, H) {
  return `<form class="cfg-area" id="prod-fb" style="margin-top:14px" novalidate>
      <h3 style="margin:0 0 6px">Fermentación en bloque · Panadería ${H.info('Fermentación en bloque', INFO_FB)}</h3>
      <p class="ayuda">Las recetas de "Recetas del día" en Cocina. Escribe horas y minutos (2:00, 1:30); vacío = sin fermentación en bloque. Al marcar terminada, Cocina muestra "f.b. hasta 13:00".</p>
      <div id="prod-fb-lista">${listaFBHtml(c, H)}</div>
      <div class="error" role="alert" id="prod-fb-err"></div>
      ${st.fbMsg ? `<p class="ok-texto" role="status">${H.esc(st.fbMsg)}</p>` : ''}
      <div class="botones" style="justify-content:flex-start"><button type="submit" class="btn-sec" id="prod-fb-guardar" ${st.fb && st.fb.lista ? '' : 'disabled'}>Guardar fermentación en bloque</button></div>
    </form>`;
}
function listaFBHtml(c, H) {
  if (!st.fb) return '<p class="ayuda">Cargando las recetas…</p>';
  if (st.fb.error) return `<p class="error">${H.esc(st.fb.error)}</p>`;
  const L = st.fb.lista || [], fb = (c && c.fermentacionBloque) || {};
  if (!L.length) return '<p class="ayuda">No hay recetas aprobadas de Panadería en la base nueva (copia la planilla primero).</p>';
  const buscar = L.length > 8 ? `<div class="campo fb-buscar"><label for="prod-fb-q">Buscar receta</label><input id="prod-fb-q" type="search" placeholder="Escribe para buscar…" autocomplete="off" spellcheck="false"></div>` : '';
  return `${buscar}${st.fb.leyoHoy ? '' : '<p class="ayuda">No se pudo leer "Ordenar Hoy" de Cocina: se muestran las masas por defecto ("Masa …").</p>'}
    <div class="fb-lista">${L.map((r, i) => `<div class="fb-fila" data-fb-nombre="${H.esc(r.nombre)}">
        <label for="prod-fb-${i}"><span>${H.esc(r.nombre)}</span><small>${r.tipo === 'sub' ? 'Masa · sub receta' : 'Receta'}</small></label>
        <input id="prod-fb-${i}" data-fb-id="${H.esc(r.id)}" inputmode="numeric" maxlength="5" placeholder="sin f.b." value="${H.esc(FBQ.aHHMM(fb[r.id]))}" aria-describedby="prod-fb-formato">
      </div>`).join('')}</div>
    <p class="ayuda" id="prod-fb-nada" hidden>Sin resultados</p>
    <small class="ayuda" id="prod-fb-formato">Formato h:mm (por ejemplo 2:00). Vacío = sin f.b.</small>`;
}
// ── v0.72.1 · Ajuste de sábado (Cocina v0.17.4): solo para mirar; las jefas lo ponen, pausan o saltan en Cocina ──
const INFO_SAB = 'Cocina → Hoy → Ajustar harina / agua → "Todos los sábados (masa para el lunes)": un ajuste de % que vale todos los sábados (lo amasado el sábado se hornea el lunes).\nLas jefas lo pausan (guarda los valores), lo saltan un sábado ("Este sábado no") o lo usan solo un día (antes de un feriado: los feriados no son automáticos).\nQué vale un día: un ajuste "Solo el …" de ese día; si no, los sábados, el de sábado; si no, el último ajuste que cubre el día. La bodega y el Plan de Panadería calculan con la misma regla.';
function bloqueSab(H) {
  const L = st.sab;
  const cab = `<h3 style="margin:0 0 6px">Ajuste de sábado · Panadería ${H.info('Ajuste de sábado', INFO_SAB)}</h3>`;
  if (!L) return cab + '<p class="ayuda">Cargando…</p>';
  if (L.error) return cab + `<p class="error">${H.esc(L.error)}</p>`;
  if (!L.length) return cab + '<p class="ayuda">Ninguna receta tiene ajuste de sábado (se pone en Cocina).</p>';
  const fc = f => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '';
  return cab + `<ul class="lista-sab">${L.map(x => `<li data-sab-receta="${H.esc(x.recetaId)}"><div><b>${H.esc(x.nombre)}</b> <span class="chip ${x.activo ? 'c-verde' : 'c-gris'}">${x.activo ? 'Activo' : 'En pausa'}</span>${x.activo && x.saltaProximo ? ` <span class="chip c-gris">no el sáb ${H.esc(fc(x.proximo))}</span>` : ''}</div>
      <span class="ayuda">${H.esc(x.texto || 'sin cambios')} · ${x.activo ? `desde el ${H.esc(fc(x.desde))}` : `en pausa desde el ${H.esc(fc(x.pausadoDesde))}`}${x.por ? ` · ${H.esc(x.por)}` : ''}</span></li>`).join('')}</ul>
    <p class="ayuda">Solo para mirar: se cambia en Cocina.</p>`;
}
async function cargarSab(H) {
  if (st.sab && !st.sab.error) return;
  const h = new Date(), hoy = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  try { st.sab = await P.ajustesSabado('PAN', hoy); } catch (e) { st.sab = { error: error(e, H) }; }
  const caja = $('prod-sab'); if (caja) caja.innerHTML = bloqueSab(H);
}
async function cargarFB(el, H, cfgs) {
  cargarSab(H);
  if (st.fb && !st.fb.error) return;
  st.fb = null;
  try { st.fb = await P.recetasFB('PAN'); } catch (e) { st.fb = { error: error(e, H) }; }
  const caja = $('prod-fb-lista'); if (!caja) return;
  caja.innerHTML = listaFBHtml(cfgs.PAN || {}, H);
  const b = $('prod-fb-guardar'); if (b) b.disabled = !(st.fb && st.fb.lista && st.fb.lista.length);
  conectarFB();
}
function conectarFB() {
  const q = $('prod-fb-q');
  if (q) q.addEventListener('input', () => {
    let vis = 0;
    document.querySelectorAll('#prod-fb .fb-fila').forEach(f => { const ok = coincide(f.dataset.fbNombre, q.value); f.hidden = !ok; if (ok) vis++; });
    $('prod-fb-nada').hidden = vis > 0;
  });
  if (q) q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; q.dispatchEvent(new Event('input')); } });
}

// ═══════════════ Bodega (P5): stock de las críticas por bodega, consumo por área y llegadas ═══════════════
// v0.54.0: bodegas separadas (Producción y Cafetería), en pestañas. Cada una con sus críticas, mínimos, llegadas y alertas.
// Las de Producción conservan los mismos campos de antes (ids sin sufijo); las de otra bodega llevan "-{BODEGA}".
const fechaC = f => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : '';
const sufijo = bod => bod === K.BODEGA_PRINCIPAL ? '' : '-' + bod;
// v0.65.0 · Bodegas por área responsable: textos de la ayuda (i)
const INFO_RESP = 'Cada materia prima crítica de producción tiene UNA bodega responsable: Panadería, Bollería o Pastelería (Cafetería tiene la suya, como antes).\nSu stock es uno solo y baja con lo que consume CUALQUIER área: la harina es de Panadería y baja también con lo que usan Bollería y Pastelería.\nEn Cocina, cada área ve, cuenta y recibe solo las de su bodega. El correo de bajo el mínimo llega a ti y a las jefas del área responsable (no a las demás).\nSi una materia prima es crítica en dos bodegas de producción, se avisa aquí: lo que consume un área va a la suya si la tiene; si no, a la primera.\nCambiar la responsable no mueve nada: el stock, los conteos y las llegadas siguen igual (mismo documento); solo cambia quién la ve y a quién le llega el aviso. Queda la historia de cada cambio.';
const INFO_ASIGNAR = 'Hasta ahora Panadería, Bollería y Pastelería compartían una bodega (Producción). Desde aquí cada materia prima crítica queda a cargo de UNA de ellas.\nLa propuesta sale del uso: lo consumido por cada área en los últimos 120 días (o, si no hay consumo, sus recetas). Las harinas van a Panadería aunque las usen otras áreas (se comparten).\nRevisa y cambia lo que quieras; nada se aplica hasta "Confirmar responsables". Hasta entonces todo sigue como hoy.\nAl confirmar no se copia ni se borra nada: el stock, los conteos y las llegadas siguen en el mismo lugar. Después puedes cambiar la responsable de cada una en su pestaña.';
const bajosDe = lista => lista.filter(e => e.st.contado && (e.bajoAhora || e.bajoDesde)).length;
function seccionBodega(H) {
  const b = st.bodega, c = b.calc;
  const cab = `<div class="titulo-fila"><span class="ayuda">Stock de las críticas por bodega, consumo por área y llegadas ${H.info('Bodega (materias primas críticas)', 'Hay dos bodegas, cada una con su stock: Producción (Panadería, Bollería y Pastelería: lo que cuenta un área vale para las tres) y Cafetería (solo Cafetería).\nUna materia prima puede ser crítica en una o en las dos, con su propio mínimo, llegadas, conteos y stock. Lo que consume Cafetería (ventas de la caja, calibración diaria y extra, derramado, merma) baja la bodega de Cafetería; lo de las otras áreas, la de Producción. Si una materia prima no es crítica en esa bodega, no se sigue ahí.\nStock = último conteo + llegadas − lo consumido. El conteo vale como cierre de su día (se cuenta después de la producción; en Cafetería, después de cerrar la caja): lo hecho ese día ya está incluido y se descuenta desde el día siguiente.\nLas jefas anotan llegadas y conteos en Cocina → Bodega, solo de su bodega. El conteo corrige la cuenta. Si faltó, es lo que se usa sin anotar (harina de mesón, pruebas, pérdidas chicas) o algo hecho que no se marcó; si sobró, una llegada o un hecho que no se anotó.\n"Alcanza" y "bajo el mínimo" usan lo planificado de los próximos 7 días (Panadería: el plan; Bollería: masas y metas; Pastelería y Cafetería: su ritmo de los últimos 14 días).\nBajo el mínimo: aparece en Hoy, en Cocina (arriba de la Bodega del área) y llega un correo (uno por día por materia prima) a ti y a las jefas de esa bodega. Se revisa cuando se abre Sistema Fën o Cocina, o se hace un conteo: no hay revisión automática de noche.\nEn Producción, si no marcas una crítica aquí, vale lo de la planilla (es_critica, stock_seguridad).')}</span>
    <button type="button" class="btn-sec" id="prod-bod-calc" ${b.cargando ? 'disabled' : ''}>${b.cargando ? 'Calculando…' : 'Actualizar ahora'}</button></div>`;
  if (!c) return cab + (b.msg ? `<p class="error">${H.esc(b.msg)}</p>` : '<p class="ayuda">Calculando el stock…</p>');
  const bods = c.bodegas || [K.BODEGA_PRINCIPAL], ver = bods.includes(b.ver) ? b.ver : bods[0], resp = K.esResponsable(c.mapa);
  const pest = `<div class="pestanas pest-bodega" role="tablist" aria-label="Bodegas">${bods.map(x => { const n = bajosDe(c.porBodega[x] || []); return `<button type="button" role="tab" data-bod-tab="${H.esc(x)}" aria-selected="${x === ver}">${H.esc(K.nombreBodega(x, c.mapa))}${n ? ` <span class="chip c-rojo">${n}</span>` : ''}</button>`; }).join('')}</div>`;
  const per = P.periodoMerma(b.periodo), cons = P.consumoPeriodo(c, per);
  const AR = ['PAN', 'BOL', 'PAS', 'CAF'].filter(a => cons.some(x => x.porArea[a]));
  const sinId = Object.keys(c.sinId || {});
  return cab + `
    <p class="ayuda">Calculado el ${H.esc(fechaC(c.hoy))} a las ${H.esc(new Date(c.en).toTimeString().slice(0, 5))} · las jefas ven en Cocina lo de su bodega que está bajo el mínimo.${resp ? ' ' + H.info('Bodegas por área responsable', INFO_RESP) : ''}</p>
    ${resp ? avisosResp(H, c) : seccionAsignar(H, c)}
    ${seccionFacturas(H, b)}
    ${pest}
    <div class="bod-bodega" data-bodega="${H.esc(ver)}">${seccionUnaBodega(H, c, ver)}</div>
    <div class="error" id="prod-bod-err" role="alert">${H.esc(b.msg)}</div>
    <div class="titulo-fila" style="margin-top:18px"><h3 style="margin:0">Consumo por área ${H.info('Consumo por área', 'Todas las materias primas (no solo las críticas), con lo que se marcó como hecho en Cocina, lo vendido en la caja (Cafetería) y la merma de materias primas. Las sub recetas se bajan hasta sus materias primas; la de otra área la cuenta el área que la hace.\nLa columna Cafetería baja la bodega de Cafetería; las demás, la de Producción (con responsables: la bodega responsable de cada materia prima, por ejemplo la harina de Bollería baja la de Panadería).')}</h3>
      <select id="prod-bod-per" aria-label="Período">${Object.entries(P.PERIODOS_MERMA).map(([k, t]) => `<option value="${k}" ${b.periodo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${cons.length ? `<div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Materia prima</th>${AR.map(a => `<th scope="col" style="text-align:right">${H.esc(P.AREAS[a])}</th>`).join('')}<th scope="col" style="text-align:right">Total</th></tr></thead><tbody>
      ${cons.map(x => `<tr><td>${H.esc(x.nombre)}</td>${AR.map(a => `<td style="text-align:right">${x.porArea[a] ? H.esc(K.texto(x.porArea[a], x.unidad)) : ''}</td>`).join('')}<td style="text-align:right"><b>${H.esc(K.texto(x.total, x.unidad))}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="ayuda">Nada marcado como hecho en este período.</p>'}
    <h3 style="margin:16px 0 4px">Cafetería ${H.info('Consumo de Cafetería', 'Cafetería descuenta de SU bodega lo VENDIDO en la caja: cada producto vinculado a una receta de Cafetería (en la caja, Configuración → Conexión con fën-producción) se baja por su receta hasta las materias primas. Los cierres cuentan al final de su día; la caja abierta, venta por venta.\nAdemás, el café de la bitácora de turno (calibración diaria automática o editada, calibración extra, café botado, pruebas) se descuenta de la materia prima que elijas aquí, y lo derramado baja la preparación entera.\nLos productos de otras áreas que se venden en la cafetería (croissant, pan) no descuentan aquí: los cuenta su área al hacerlos.')}</h3>
    <div class="fila-campos fila-bod">
      <div class="campo campo-ancho"><label for="prod-bod-cafe">El café de la bitácora de turno sale de</label><select id="prod-bod-cafe"><option value="">(no descuenta)</option>${c.datos.mps.filter(m => m.tipo !== 'sub_receta' && (m.estado || 'activa') === 'activa').sort((a, x) => a.nombre.localeCompare(x.nombre, 'es')).map(m => `<option value="${H.esc(m.id)}" ${((c.datos.config.CAF || {}).mp_cafe) === m.id ? 'selected' : ''}>${H.esc(m.nombre)}</option>`).join('')}</select></div>
      <button type="button" class="btn-sec" id="prod-bod-cafe-ok">Guardar</button>
    </div>
    ${c.cafe && c.cafe.error ? `<p class="error">No se pudieron leer las ventas de la caja: ${H.esc(c.cafe.error)}</p>` : ''}
    ${c.cafe && Object.keys(c.cafe.sinReceta).length ? `<p class="ayuda">Vendidos en Cafetería sin receta vinculada en la caja (no descuentan): ${H.esc(Object.entries(c.cafe.sinReceta).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, q]) => `${n} (${Math.round(q)})`).join(', '))}${Object.keys(c.cafe.sinReceta).length > 10 ? '…' : ''}. Vincúlalos en la caja para que cuenten.</p>` : ''}
    ${sinId.length ? `<p class="ayuda">Ingredientes sin materia prima en el maestro (no se cuentan): ${H.esc(sinId.slice(0, 8).join(', '))}${sinId.length > 8 ? '…' : ''}.</p>` : ''}`;
}
// v0.133.0 · Facturas de críticas: cada compra entra sola a la bodega (con la fecha de la factura, o la de recepción si se cambia)
const TXT_FAC = 'Cada factura de compra de una materia prima crítica entra sola a su bodega como llegada: cantidad de la factura × lo que trae una unidad (por ejemplo 80 sacos × 25 kg = 2.000 kg). Entra con la fecha de la factura; si llegó otro día, cámbielo en "Llegó el" y el stock se recalcula solo (también hacia atrás).\nEl stock es siempre: último conteo + llegadas − lo que usaron las recetas desde ese conteo. Una factura de antes del último conteo ya está dentro del conteo.\nPara que una compra entre, su producto de la factura tiene que estar asociado a la materia prima (una vez): abajo aparecen los que parecen de una crítica y no lo están. Asociar también actualiza su precio en Costos.\nLas jefas ya no anotan llegadas: solo cuentan cuando se les pide.';
function seccionFacturas(H, b) {
  const f = b.fac;
  if (b.facErr) return `<p class="aviso" role="note">No se pudieron revisar las facturas de compra: ${H.esc(b.facErr)}</p>`;
  if (!f) return '';
  const kg = (v, u) => K.texto(v, u || 'g');
  const est = l => l.estado === 'entro' ? '<span class="chip c-verde chip-chico">entró</span>' : l.estado === 'anulada' ? '<span class="chip c-gris chip-chico">anulada</span>' : l.estado === 'nc' ? '<span class="chip c-gris chip-chico">nota de crédito</span>' : '<span class="chip c-amarillo chip-chico">fuera del período</span>';
  const facs = f.facturas.slice(0, 20);
  const opts = (f.criticas || []).filter((c, i, a) => a.findIndex(x => x.mp.id === c.mp.id) === i);
  const contTxt = x => { const c = x.sug && x.sug.contenido; return c ? (c.unidad === 'g' ? [c.cantidad / 1000, 'kg'] : c.unidad === 'ml' ? [c.cantidad / 1000, 'l'] : [c.cantidad, 'un']) : ['', 'kg']; };
  return `<details class="tarjeta-sub bod-fac" id="prod-bod-fac" ${b.facAbierto === false ? '' : 'open'}><summary><b>Facturas de críticas</b> · las compras entran solas a la bodega ${H.info('Facturas de críticas', TXT_FAC)}</summary>
    ${f.repetidas && f.repetidas.length ? `<div class="aviso" role="status" id="prod-bod-fac-rep"><b>${f.repetidas.length} ${f.repetidas.length === 1 ? 'llegada anotada a mano se repite' : 'llegadas anotadas a mano se repiten'} con las facturas</b>
      <ul>${f.repetidas.map(m => `<li>${H.esc(fechaC(m.fecha))} · ${H.esc(m.nombre)} · ${H.esc(kg(m.cantidad, m.unidad))}${m.por ? ' · ' + H.esc(m.por) : ''}</li>`).join('')}</ul>
      <button type="button" class="btn-sec" id="prod-bod-fac-anular">Anular las anotadas a mano</button></div>` : ''}
    ${facs.length ? `<div class="tabla-b2b"><table class="tabla-tiempos tabla-fac"><thead><tr><th scope="col">Factura</th><th scope="col">Materia prima</th><th scope="col" style="text-align:right">Cantidad</th><th scope="col">Llegó el</th></tr></thead><tbody>
      ${facs.map((x, i) => `<tr><td>${H.esc(fechaC(x.fecha))} · F. ${H.esc(x.folio)}<br><span class="ayuda">${H.esc(x.proveedor)}</span></td>
        <td>${x.lineas.map(l => `${H.esc(l.nombre)} ${est(l)}`).join('<br>')}</td>
        <td style="text-align:right">${x.lineas.map(l => `${H.esc(String(l.cantidad).replace('.', ','))} ${H.esc((l.unidadFactura || 'un').toLowerCase())} = <b>${H.esc(kg(l.total, l.unidad))}</b>`).join('<br>')}</td>
        <td>${x.lineas.some(l => l.estado === 'entro') ? `<div class="fac-rec"><input type="date" data-fac-fecha="${i}" value="${H.esc(x.recepcion || x.fecha)}" max="${H.esc(CMhoy())}" aria-label="Llegó el (factura ${H.esc(x.folio)})"><button type="button" class="btn-sec btn-chico" data-fac-rec="${i}">Guardar</button></div>${x.recepcion ? '<span class="ayuda">cambiada</span>' : ''}` : '<span class="ayuda">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>${f.facturas.length > facs.length ? `<p class="ayuda">Y ${f.facturas.length - facs.length} más antiguas.</p>` : ''}` : '<p class="ayuda">Todavía no hay facturas de críticas asociadas (desde el 1 de octubre).</p>'}
    ${f.sinAsociar.length ? `<h4 style="margin:14px 0 4px">Productos de factura sin asociar</h4><p class="ayuda">Parecen de una crítica. Asócielos una vez: sus facturas entran a la bodega y actualizan el precio en Costos.</p>
      ${f.sinAsociar.map((x, i) => { const [cq, cu] = contTxt(x); return `<div class="fac-asoc" data-fac-asoc-i="${i}"><div class="fac-asoc-t"><b>${H.esc(x.descripcion)}</b><span class="ayuda">${H.esc(x.proveedor)} · última ${H.esc(fechaC(x.fecha))} · F. ${H.esc(x.folio)} · ${H.esc(String(x.cantidad).replace('.', ','))} ${H.esc((x.unidad || 'un').toLowerCase())}</span></div>
        <div class="fila-campos fila-bod"><div class="campo campo-ancho"><label for="fac-mp-${i}">Es</label><select id="fac-mp-${i}">${opts.map(c => `<option value="${H.esc(c.mp.id)}" ${c.mp.id === x.sugerida ? 'selected' : ''}>${H.esc(c.mp.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="fac-cq-${i}">Cada unidad trae</label><input id="fac-cq-${i}" inputmode="decimal" value="${H.esc(String(cq).replace('.', ','))}"></div>
          <div class="campo"><label for="fac-cu-${i}">Unidad</label><select id="fac-cu-${i}">${['kg', 'g', 'l', 'ml', 'un'].map(u => `<option ${u === cu ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          <button type="button" class="btn-sec" data-fac-asociar="${i}">Asociar</button><button type="button" class="btn-link" data-fac-ignorar="${i}">No es materia prima</button></div></div>`; }).join('')}` : ''}
  </details>`;
}
const CMhoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// v0.65.0 · "Asignar responsables\" (una vez, mientras Producción es una sola bodega): propuesta por uso, se cambia y se confirma
function seccionAsignar(H, c) {
  const lista = c.propuesta || [], b = st.bodega, elegidas = b.resp || {};
  if (!lista.length) return '';
  const pct = (x, a) => x.fuente ? `${x.pct[a]} %` : '—';
  const fuente = x => x.fuente === 'consumo' ? 'consumo (120 días)' : x.fuente === 'recetas' ? 'recetas' : 'sin uso';
  const motivo = x => x.motivo === 'harina' ? 'Harina: va a Panadería' : x.motivo === 'uso' ? 'La que más la usa' : 'Sin uso: Panadería';
  return `<details class="aviso asignar-resp" id="prod-bod-asignar" ${b.asignarAbierto === false ? '' : 'open'}><summary><b>Asignar responsables</b> · cada materia prima crítica, a cargo de una sola área</summary>
    <p class="ayuda">Propuesta por uso. Revisa, cambia lo que quieras y confirma. Hasta confirmar, Panadería, Bollería y Pastelería siguen compartiendo la bodega Producción. ${H.info('Asignar responsables', INFO_ASIGNAR)}</p>
    <div class="tabla-b2b"><table class="tabla-tiempos tabla-asignar"><thead><tr><th scope="col">Materia prima</th><th scope="col" style="text-align:right">Panadería</th><th scope="col" style="text-align:right">Bollería</th><th scope="col" style="text-align:right">Pastelería</th><th scope="col">Según</th><th scope="col">Responsable</th></tr></thead><tbody>
    ${lista.map(x => `<tr><td>${H.esc(x.mp.nombre)}<br><span class="ayuda">${H.esc(motivo(x))}</span></td>${K.AREAS_PROD.map(a => `<td style="text-align:right">${H.esc(pct(x, a))}</td>`).join('')}<td class="ayuda">${H.esc(fuente(x))}</td>
      <td><select data-bod-asignar="${H.esc(x.mp.id)}" aria-label="Responsable de ${H.esc(x.mp.nombre)}">${K.AREAS_PROD.map(a => `<option value="${a}" ${(elegidas[x.mp.id] || x.propuesta) === a ? 'selected' : ''}>${H.esc(P.AREAS[a])}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn" id="prod-bod-asignar-ok">Confirmar responsables</button></div></details>`;
}
// v0.65.0 · Avisos de la configuración: críticas en dos bodegas de producción y críticas sin responsable elegida
function avisosResp(H, c) {
  const nom = id => { const m = c.datos.mps.find(x => x.id === id); return m ? m.nombre : id; };
  const rep = (c.repetidas || []).map(r => `<li><b>${H.esc(nom(r.mp))}</b>: crítica en ${H.esc(r.bodegas.map(x => K.nombreBodega(x, c.mapa)).join(' y '))}. Lo que consume un área va a la suya si la tiene; si no, a ${H.esc(K.nombreBodega(r.bodegas[0], c.mapa))}. Si es un error, quítala de una (botón Quitar en su pestaña).</li>`).join('');
  const sin = (c.sinResponsable || []).map(id => H.esc(nom(id))).join(', ');
  return `${rep ? `<div class="aviso" id="prod-bod-repetidas" role="status"><b>Críticas en más de una bodega de producción</b><ul>${rep}</ul></div>` : ''}
    ${sin ? `<p class="ayuda" id="prod-bod-sinresp">Sin responsable elegida (van a Panadería): ${sin}. Elige la responsable en la pestaña de Panadería.</p>` : ''}`;
}
// Una bodega: críticas (estado, stock, mínimo, envase, alcanza, último conteo), agregar, llegadas y (Producción) pasar a Cafetería
function seccionUnaBodega(H, c, bod) {
  const lista = c.porBodega[bod] || [], s = sufijo(bod), nombre = K.nombreBodega(bod, c.mapa);
  const areas = K.areasDeBodega(bod, c.mapa).map(a => P.AREAS[a] || a).join(', ');
  const resp = K.esResponsable(c.mapa), prodB = resp && K.esProduccion(bod, c.mapa);
  // v0.65.0: la responsable de cada una (las que viven en su documento de siempre); se cambia aquí y no mueve el stock
  const selResp = e => prodB && e.docId === e.mp.id ? `<br><label class="ayuda resp-sel">Responsable <select data-bod-resp="${H.esc(e.mp.id)}" aria-label="Responsable de ${H.esc(e.mp.nombre)}">${K.AREAS_PROD.map(a => `<option value="${a}" ${a === bod ? 'selected' : ''}>${H.esc(P.AREAS[a])}</option>`).join('')}</select></label>` : prodB ? '<br><span class="chip c-amarillo">También en otra bodega</span>' : '';
  const est = e => !e.st.contado ? '<span class="chip c-gris" title="No hay conteo en los últimos 120 días">Falta conteo</span>' : e.bajoAhora ? '<span class="chip c-rojo">Bajo el mínimo</span>' : e.bajoDesde ? `<span class="chip c-amarillo">Bajo el ${H.esc(fechaC(e.bajoDesde))}</span>` : '<span class="chip c-verde">Bien</span>';
  const dif = e => { const t = e.st.teoricoAlContar; if (t === null || t === undefined) return ''; const d = e.st.conteo.cantidad - t; return Math.abs(d) < 1 ? ' · cuadró' : d < 0 ? ` · faltaron ${H.esc(K.texto(-d, e.cfg.unidad))} (uso sin anotar: mesón, pruebas…)` : ` · sobraron ${H.esc(K.texto(d, e.cfg.unidad))} (llegada o hecho sin anotar)`; };
  const filas = lista.map(e => `<tr>
      <td>${H.esc(e.mp.nombre)}${selResp(e)}</td><td>${est(e)}</td>
      <td style="text-align:right">${e.st.contado ? H.esc(K.texto(e.st.stock, e.cfg.unidad)) + (e.cfg.envase ? `<br><span class="ayuda">${H.esc((Math.round(e.st.stock / e.cfg.envase.tamano * 10) / 10).toLocaleString('es-CL'))} ${H.esc(K.envases(e.cfg.envase.nombre, 2))}</span>` : '') : '—'}</td>
      <td><input class="bod-min" data-bod-min="${H.esc(e.docId)}" inputmode="decimal" value="${H.esc(String(K.deBase(e.cfg.seguridad, e.cfg.unidad)).replace('.', ','))}" aria-label="Mínimo de ${H.esc(e.mp.nombre)} en ${H.esc(nombre)}" style="width:80px"> ${K.unidadEntrada(e.cfg.unidad)}</td>
      <td class="bod-env"><input data-bod-env-n="${H.esc(e.docId)}" value="${H.esc(e.cfg.envase ? e.cfg.envase.nombre : '')}" placeholder="${K.unidadEntrada(e.cfg.unidad)}" maxlength="20" aria-label="Envase de ${H.esc(e.mp.nombre)}" style="width:72px"> de <input data-bod-env-t="${H.esc(e.docId)}" inputmode="decimal" value="${e.cfg.envase ? H.esc(String(K.deBase(e.cfg.envase.tamano, e.cfg.unidad)).replace('.', ',')) : ''}" aria-label="Tamaño del envase de ${H.esc(e.mp.nombre)}" style="width:56px"> ${K.unidadEntrada(e.cfg.unidad)}</td>
      <td>${e.alcanza === null ? '—' : H.esc((Math.round(e.alcanza * 10) / 10).toLocaleString('es-CL')) + ' días'}<br><span class="ayuda">${e.prom ? H.esc(K.texto(e.prom, e.cfg.unidad)) + '/día' : ''}</span></td>
      <td class="ayuda">${e.st.conteo ? `${H.esc(fechaC(e.st.conteo.fecha))} · ${H.esc(P.AREAS[e.st.conteo.area] || (e.st.conteo.area === 'ADM' ? 'Administración' : e.st.conteo.area))}${dif(e)}` : 'nunca'}</td>
      <td><button type="button" class="btn-link" data-bod-quitar="${H.esc(e.docId)}">Quitar</button></td></tr>`).join('');
  const otras = c.datos.mps.filter(m => (m.estado || 'activa') === 'activa' && m.tipo !== 'sub_receta' && !lista.some(e => e.mp.id === m.id)).sort((a, x) => a.nombre.localeCompare(x.nombre, 'es'));
  const enCaf = new Set((c.porBodega.CAF || []).map(e => e.mp.id));
  const pasables = (bod === K.BODEGA_PRINCIPAL || prodB) && (c.bodegas || []).includes('CAF') ? lista.filter(e => !enCaf.has(e.mp.id)) : [];
  const quien = prodB ? `Responsable: ${H.esc(P.AREAS[K.areasAviso(bod, c.mapa)[0]] || nombre)} (la ve, la cuenta y recibe el aviso). Su stock baja con lo que consume cualquier área.`
    : areas ? 'La usan: ' + H.esc(areas) : 'Ningún área la usa';
  return `<h3 style="margin:12px 0 2px">Bodega ${H.esc(nombre)}</h3><p class="ayuda" style="margin-top:0">${quien}</p>
    ${lista.length ? `<div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Materia prima</th><th scope="col">Estado</th><th scope="col" style="text-align:right">Stock</th><th scope="col">Mínimo</th><th scope="col">Se cuenta en ${H.info('Se cuenta en', 'Vacío: se cuenta y se recibe en kg, litros o unidades.\nCon un envase (por ejemplo "saco" de 25 kg), en Cocina se escriben los sacos más lo suelto (3 sacos + 5 kg = 80 kg), y el stock también se ve en sacos. Si cambia el formato (centeno en sacos de 20 kg), lo cambias aquí.')}</th><th scope="col">Alcanza</th><th scope="col">Último conteo</th><th scope="col"><span class="sr">Quitar</span></th></tr></thead><tbody>${filas}</tbody></table></div>
      <div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="prod-bod-min${s}" data-bod-guardar="${H.esc(bod)}">Guardar cambios</button></div>` : `<p class="ayuda">Todavía no hay materias primas críticas en ${H.esc(nombre)}. Agrega las que quieres controlar${bod === 'CAF' ? ' (café, leche, vasos…)' : ' (harina, mantequilla…)'}.</p>`}
    <div class="fila-campos fila-bod" style="margin-top:8px">
      <div class="campo campo-ancho"><label for="prod-bod-nueva${s}">Agregar crítica en ${H.esc(nombre)}</label><select id="prod-bod-nueva${s}"><option value="">Elige una materia prima…</option>${otras.map(m => `<option value="${H.esc(m.id)}">${H.esc(m.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="prod-bod-nueva-min${s}">Mínimo</label><input id="prod-bod-nueva-min${s}" inputmode="decimal" placeholder="kg, l o un"></div>
      <button type="button" class="btn-sec" id="prod-bod-agregar${s}" data-bod-agregar="${H.esc(bod)}">Agregar</button>
    </div>
    ${lista.length ? `<h3 style="margin:16px 0 4px">Llegó mercadería a ${H.esc(nombre)}</h3>
    <div class="fila-campos fila-bod">
      <div class="campo campo-ancho"><label for="prod-bod-ll-mp${s}">Materia prima</label><select id="prod-bod-ll-mp${s}">${lista.map(e => `<option value="${H.esc(e.mp.id)}">${H.esc(e.mp.nombre)} (${K.unidadEntrada(e.cfg.unidad)})</option>`).join('')}</select></div>
      <div class="campo"><label for="prod-bod-ll-cant${s}">Cantidad</label><input id="prod-bod-ll-cant${s}" inputmode="decimal"></div>
      <div class="campo campo-ancho"><label for="prod-bod-ll-nota${s}">Proveedor o factura</label><input id="prod-bod-ll-nota${s}" maxlength="120"></div>
      <button type="button" class="btn-sec" id="prod-bod-llegada${s}" data-bod-llegada="${H.esc(bod)}">Anotar llegada</button>
    </div>` : ''}
    ${pasables.length ? `<details class="aviso" style="margin-top:14px" id="prod-bod-pasar"><summary><b>Pasar a Cafetería</b> · una vez, para las que hoy son críticas solo por Cafetería</summary>
      <p class="ayuda">Marca las que en realidad se guardan en la Cafetería. Se copia su mínimo y envase a la bodega de Cafetería ${H.info('Pasar a Cafetería', 'Hasta Cocina v0.15.0 había una sola bodega. Si una materia prima estaba marcada crítica por Cafetería (leche, café, vasos), aquí la pasas a la bodega de Cafetería.\nSe copia la crítica, el mínimo y el envase. Nada se borra: los conteos y llegadas de antes quedan en Producción. En Cafetería parte con su primer conteo.\nSi marcas "Dejar de seguirlas en Producción", en Producción quedan como no críticas (puedes volver a marcarlas).')}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">${pasables.map(e => `<label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" data-bod-pasar="${H.esc(e.mp.id)}">${H.esc(e.mp.nombre)}</label>`).join('')}</div>
      <label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" id="prod-bod-pasar-quitar">Dejar de seguirlas en Producción</label>
      <div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" id="prod-bod-pasar-ok">Pasar a Cafetería</button></div></details>` : ''}`;
}
function conectarBodega(H) {
  const $b = id => document.getElementById(id), b = st.bodega;
  const repintarB = () => { const c = $b('prod-bodega'); if (!c) return; c.innerHTML = seccionBodega(H); conectarBodega(H); };
  // v0.77.1: al abrir la pestaña se calcula solo, con lo que ya está en memoria (casi sin lecturas al volver);
  // "Actualizar ahora" y después de un cambio hecho aquí se vuelve a leer todo (fresco)
  // v0.133.0: después de calcular, las facturas de las críticas que faltan entran solas (y se recalcula si entró alguna)
  const calcular = async (fresco = true) => { b.cargando = true; b.msg = ''; repintarB();
    try { b.calc = await P.calcularBodega({ fresco });
      try { b.fac = await P.facturasBodega({ forzar: fresco }); b.facErr = '';
        if (b.fac && b.fac.creadas) { H.registrar('Bodega: entraron facturas de críticas', `${b.fac.creadas} ${b.fac.creadas === 1 ? 'línea' : 'líneas'}`); b.calc = await P.calcularBodega({ fresco: true }); } }
      catch (e) { b.facErr = error(e, H); }
    } catch (e) { b.msg = error(e, H); } b.cargando = false; repintarB(); };
  const boton = $b('prod-bod-calc'); if (!boton) return;
  if (!b.calc && !b.cargando && !b.autoHecho) { b.autoHecho = true; setTimeout(() => calcular(false), 0); }
  // v0.54.1: buscador sobre las listas de materias primas (café de Cafetería, agregar crítica, llegó mercadería)
  document.querySelectorAll('#prod-bod-cafe, select[id^="prod-bod-nueva"], select[id^="prod-bod-ll-mp"]').forEach(conBuscador);
  boton.addEventListener('click', () => calcular(true));
  // v0.133.0 · Facturas de críticas
  const fd = $b('prod-bod-fac'); if (fd) fd.addEventListener('toggle', () => { b.facAbierto = fd.open; });
  const errF = (el, t) => { const p = el.closest('details') || document; let e = p.querySelector('.fac-err'); if (!e) { e = document.createElement('p'); e.className = 'error fac-err'; e.setAttribute('role', 'alert'); (el.closest('.fac-asoc, td, .aviso') || p).appendChild(e); } e.textContent = t; };
  document.querySelectorAll('[data-fac-rec]').forEach(x => x.addEventListener('click', async () => {
    const fac = b.fac.facturas[Number(x.dataset.facRec)], v = document.querySelector(`[data-fac-fecha="${x.dataset.facRec}"]`).value;
    x.disabled = true;
    try { await P.recepcionFactura(fac.lineas, v); H.registrar('Bodega: fecha de llegada de una factura', `F. ${fac.folio} · ${fac.proveedor} → ${v}`); await calcular(true); }
    catch (e) { x.disabled = false; errF(x, error(e, H)); }
  }));
  const asoc = async (x, ignorar) => {
    const i = Number(x.dataset.facAsociar ?? x.dataset.facIgnorar), it = b.fac.sinAsociar[i];
    const mp = $b('fac-mp-' + i).value, cq = String($b('fac-cq-' + i).value || '').replace(',', '.'), cu = $b('fac-cu-' + i).value;
    if (!ignorar && !(Number(cq) > 0)) { errF(x, 'Escriba cuánto trae una unidad de la factura (por ejemplo 25 kg).'); return; }
    x.disabled = true;
    try { const r = await P.asociarFactura(it, { mp, contenido: { cantidad: cq, unidad: cu }, ignorar });
      H.registrar('Bodega: asoció un producto de factura', `${it.proveedor} · ${it.descripcion} → ${ignorar ? 'no es materia prima' : (b.fac.criticas.find(c => c.mp.id === mp) || { mp: { nombre: mp } }).mp.nombre}${r && r.aplicadas && r.aplicadas.length ? ' (precio actualizado)' : ''}`);
      await calcular(true); }
    catch (e) { x.disabled = false; errF(x, error(e, H)); }
  };
  document.querySelectorAll('[data-fac-asociar]').forEach(x => x.addEventListener('click', () => asoc(x, false)));
  document.querySelectorAll('[data-fac-ignorar]').forEach(x => x.addEventListener('click', () => asoc(x, true)));
  const an = $b('prod-bod-fac-anular');
  if (an) an.addEventListener('click', async () => {
    const l = b.fac.repetidas; an.disabled = true;
    try { await P.anularManuales(l); H.registrar('Bodega: anuló llegadas a mano repetidas con facturas', l.map(m => `${m.fecha} ${m.nombre}`).join(', ')); await calcular(true); }
    catch (e) { an.disabled = false; errF(an, error(e, H)); }
  });
  document.querySelectorAll('[data-bod-tab]').forEach(t => t.addEventListener('click', () => { b.ver = t.dataset.bodTab; repintarB(); }));
  const per = $b('prod-bod-per'); if (per) per.addEventListener('change', () => { b.periodo = per.value; repintarB(); });
  const mp = id => b.calc.datos.mps.find(m => m.id === id);
  const nomB = bod => K.nombreBodega(bod, b.calc.mapa);
  const leerCant = (t, u) => { const v = String(t || '').trim(); if (!/^\d+([.,]\d+)?$/.test(v)) return null; return K.aBase(v, u); };
  const err = t => { $b('prod-bod-err').textContent = t; };
  // lista: [[mpId, control, bodega]]
  const guardar = async (lista, msg) => { try { for (const [id, x, bod] of lista) await P.guardarControl(id, x, bod); H.registrar(msg, lista.map(([id, , bod]) => `${(mp(id) || {}).nombre || id} (${nomB(bod)})`).join(', ')); await calcular(); } catch (e) { b.msg = error(e, H); repintarB(); } };
  const ag = document.querySelector('[data-bod-agregar]');
  if (ag) ag.addEventListener('click', () => {
    const bod = ag.dataset.bodAgregar, s = sufijo(bod), id = $b('prod-bod-nueva' + s).value; if (!id) { err('Elige una materia prima.'); return; }
    const u = K.unidadMp(mp(id)), t = $b('prod-bod-nueva-min' + s).value, seg = t.trim() === '' ? 0 : leerCant(t, u);
    if (seg === null) { err('El mínimo es un número (en kg, l o un).'); return; }
    // v0.65.0: en una bodega de producción (con responsables), esa área queda como responsable (el stock de siempre)
    const c = b.calc;
    if (K.esResponsable(c.mapa) && K.esProduccion(bod, c.mapa)) {
      const otra = c.criticas.find(e => e.mp.id === id && e.docId === id && e.bodega !== bod);
      if (otra && !confirm(`${mp(id).nombre} ya es crítica en ${nomB(otra.bodega)}. ¿Pasarla a ${nomB(bod)}? El stock y los conteos siguen igual.`)) return;
      (async () => { try { await P.guardarResponsables({ [id]: bod }); H.registrar('Cambió la bodega responsable', `${mp(id).nombre} → ${nomB(bod)}`); } catch (e) { b.msg = error(e, H); repintarB(); return; }
        guardar([[id, { critica: true, seguridad: seg }, bod]], 'Marcó una materia prima crítica (Bodega ' + nomB(bod) + ')'); })();
      return;
    }
    guardar([[id, { critica: true, seguridad: seg }, bod]], 'Marcó una materia prima crítica (Bodega ' + nomB(bod) + ')');
  });
  const gm = document.querySelector('[data-bod-guardar]');
  if (gm) gm.addEventListener('click', () => {
    const bod = gm.dataset.bodGuardar, lista = [];
    for (const e of b.calc.porBodega[bod] || []) {
      const inp = document.querySelector(`[data-bod-min="${CSS.escape(e.docId)}"]`); if (!inp) continue;
      const v = inp.value.trim() === '' ? 0 : leerCant(inp.value, e.cfg.unidad);
      if (v === null) { err(`${e.mp.nombre}: el mínimo es un número.`); return; }
      // Envase: nombre + tamaño (los dos o ninguno)
      const n = (document.querySelector(`[data-bod-env-n="${CSS.escape(e.docId)}"]`) || {}).value || '', tt = (document.querySelector(`[data-bod-env-t="${CSS.escape(e.docId)}"]`) || {}).value || '';
      let env = null;
      if (n.trim() || tt.trim()) {
        const tam = leerCant(tt, e.cfg.unidad);
        if (!n.trim() || !(tam > 0)) { err(`${e.mp.nombre}: el envase necesita nombre y tamaño (por ejemplo, saco de 25 ${K.unidadEntrada(e.cfg.unidad)}), o déjalo vacío.`); return; }
        env = { nombre: K.singular(n), tamano: tam };   // se guarda en singular ("sacos" → "saco")
      }
      const envAntes = e.cfg.envase ? `${e.cfg.envase.nombre}|${e.cfg.envase.tamano}` : '', envAhora = env ? `${env.nombre}|${env.tamano}` : '';
      if (Math.abs(v - e.cfg.seguridad) > 0.001 || envAntes !== envAhora) lista.push([e.mp.id, { critica: true, seguridad: v, envase: env }, bod]);
    }
    if (!lista.length) { err('No cambiaste nada.'); return; }
    guardar(lista, 'Cambió mínimos o envases de bodega');
  });
  document.querySelectorAll('[data-bod-quitar]').forEach(x => x.addEventListener('click', () => {
    const e = b.calc.criticas.find(y => y.docId === x.dataset.bodQuitar); if (!e) return;
    if (!confirm(`¿Quitar ${e.mp.nombre} de las críticas de ${nomB(e.bodega)}? Deja de llevar stock y alerta ahí. Sus llegadas y conteos quedan guardados.`)) return;
    guardar([[e.mp.id, { critica: false, seguridad: e.cfg.seguridad }, e.bodega]], 'Quitó una materia prima crítica (Bodega ' + nomB(e.bodega) + ')');
  }));
  // v0.65.0 · Asignar responsables (una vez) y cambiar la responsable de una
  document.querySelectorAll('[data-bod-asignar]').forEach(x => x.addEventListener('change', () => { b.resp = { ...(b.resp || {}), [x.dataset.bodAsignar]: x.value }; }));
  const asg = $b('prod-bod-asignar');
  if (asg) asg.addEventListener('toggle', () => { b.asignarAbierto = asg.open; });
  const asgOk = $b('prod-bod-asignar-ok');
  if (asgOk) asgOk.addEventListener('click', async () => {
    const elegidas = {}; document.querySelectorAll('[data-bod-asignar]').forEach(x => { elegidas[x.dataset.bodAsignar] = x.value; });
    const n = Object.keys(elegidas).length, cuenta = a => Object.values(elegidas).filter(v => v === a).length;
    if (!confirm(`¿Confirmar responsables? Panadería ${cuenta('PAN')}, Bollería ${cuenta('BOL')}, Pastelería ${cuenta('PAS')} (${n} en total). Cada área verá y contará solo las suyas en Cocina. No se copia ni se borra nada.`)) return;
    asgOk.disabled = true;
    try { await P.guardarResponsables(elegidas, { confirmar: true }); H.registrar('Confirmó las bodegas por área responsable', Object.entries(elegidas).map(([id, a]) => `${(mp(id) || {}).nombre || id} → ${P.AREAS[a]}`).join(', ')); b.resp = null; b.ver = 'PAN'; await calcular(); }
    catch (e) { b.msg = error(e, H); repintarB(); }
  });
  document.querySelectorAll('[data-bod-resp]').forEach(x => x.addEventListener('change', async () => {
    const id = x.dataset.bodResp, m = mp(id), de = b.ver, a = x.value; if (a === de) return;
    if (!confirm(`¿Pasar ${m ? m.nombre : id} de ${P.AREAS[de] || de} a ${P.AREAS[a] || a}? El stock, los conteos y las llegadas siguen igual; desde ahora la ve, la cuenta y recibe el aviso ${P.AREAS[a] || a}.`)) { x.value = de; return; }
    try { await P.guardarResponsables({ [id]: a }); H.registrar('Cambió la bodega responsable', `${m ? m.nombre : id}: ${P.AREAS[de] || de} → ${P.AREAS[a] || a}`); b.ver = a; await calcular(); }
    catch (e) { b.msg = error(e, H); repintarB(); }
  }));
  const pasar = $b('prod-bod-pasar-ok');
  if (pasar) pasar.addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('[data-bod-pasar]:checked')].map(x => x.dataset.bodPasar), quitar = $b('prod-bod-pasar-quitar').checked;
    if (!ids.length) { err('Marca al menos una materia prima para pasar a Cafetería.'); return; }
    if (!confirm(`¿Pasar ${ids.length} ${ids.length === 1 ? 'materia prima' : 'materias primas'} a la bodega de Cafetería?${quitar ? ' En Producción dejan de ser críticas.' : ' En Producción siguen igual.'} Nada se borra.`)) return;
    pasar.disabled = true;
    try { await P.pasarABodega(ids, 'CAF', { quitar }); H.registrar('Pasó materias primas a la bodega de Cafetería', ids.map(id => (mp(id) || {}).nombre || id).join(', ') + (quitar ? ' (ya no en Producción)' : '')); b.ver = 'CAF'; await calcular(); }
    catch (e) { b.msg = error(e, H); repintarB(); }
  });
  const cf = $b('prod-bod-cafe-ok');
  if (cf) cf.addEventListener('click', async () => {
    cf.disabled = true;
    try { const id = $b('prod-bod-cafe').value; await P.guardarMpCafe(id); H.registrar('Eligió la materia prima del café de Cafetería (Bodega)', id ? (mp(id) || {}).nombre || id : 'ninguna'); await calcular(); }
    catch (e) { b.msg = error(e, H); repintarB(); }
  });
  const ll = document.querySelector('[data-bod-llegada]');
  if (ll) ll.addEventListener('click', async () => {
    const bod = ll.dataset.bodLlegada, s = sufijo(bod), m = mp($b('prod-bod-ll-mp' + s).value), u = K.unidadMp(m), q = leerCant($b('prod-bod-ll-cant' + s).value, u);
    if (!(q > 0)) { err('Escribe la cantidad que llegó (en ' + K.unidadEntrada(u) + ').'); return; }
    ll.disabled = true;
    try { await P.registrarLlegada(m, q, $b('prod-bod-ll-nota' + s).value, bod); H.registrar('Anotó una llegada a bodega', `${m.nombre} · ${K.texto(q, u)} (${nomB(bod)})`); await calcular(); }
    catch (e) { b.msg = error(e, H); repintarB(); }
  });
}

// ═══════════════ Merma (P4b): lo que anotan las áreas en Cocina, valorizado ═══════════════
const UNID = { un: 'un', g: 'g', ml: 'ml' };
const cantM = (n, u) => `${(Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-CL')} ${UNID[u] || ''}`;   // solo unidades conocidas (lo demás no se muestra)
function seccionMerma(H) {
  const m = st.merma, r = m.datos ? P.resumenMerma(m.datos) : null;
  const cab = `<div class="titulo-fila"><span class="ayuda">Lo perdido por área, valorizado ${H.info('Merma', 'Lo que las áreas anotan en Cocina como perdido (productos, preparaciones o materias primas), con su motivo.\nEl costo es neto (sin IVA) y sale del costo directo de Finanzas (Finanzas → Costos → Productos): recetas y sub recetas con su costo por unidad o por gramo, y materias primas con el precio de su última compra. Si algo no tiene costo ahí, queda "sin costo" (y no suma); si le falta algún precio, dice "costo incompleto". Desde la v0.75.1 ya no se usan los costos de la planilla ni se copia a la hoja "Registro_merma". Las jefas no ven precios.\nLas anotaciones anuladas no cuentan.')}</span>
      <div class="fila-campos" style="align-items:flex-end;gap:8px;flex-wrap:nowrap"><select id="prod-merma-per" aria-label="Período">${Object.entries(P.PERIODOS_MERMA).map(([k, t]) => `<option value="${k}" ${m.periodo === k ? 'selected' : ''}>${t}</option>`).join('')}</select><button type="button" class="btn-sec" id="prod-merma-ver" ${m.cargando ? 'disabled' : ''}>${m.cargando ? 'Leyendo…' : m.datos ? 'Actualizar' : 'Ver'}</button></div></div>`;
  if (!r) return cab + (m.msg ? `<p class="error">${H.esc(m.msg)}</p>` : '<p class="ayuda">Elige el período y presiona "Ver".</p>');
  const d = m.datos, rango = `${d.desde.split('-').reverse().slice(0, 2).join('/')} al ${d.hasta.split('-').reverse().slice(0, 2).join('/')}`;
  const area = a => `<div class="merma-area">
      <div class="titulo-fila" style="margin-top:10px"><h3 style="margin:0">${H.esc(P.AREAS[a.area] || a.area)}</h3><b>${pesosN(a.total)}${a.sinCosto ? ' <span class="chip c-amarillo">' + a.sinCosto + ' sin costo</span>' : ''}</b></div>
      <div class="tabla-b2b"><table class="tabla-tiempos"><thead><tr><th scope="col">Ítem</th><th scope="col">Cantidad</th><th scope="col">Motivo</th><th scope="col" style="text-align:right">Costo neto</th></tr></thead><tbody>
      ${a.items.map(it => `<tr><td>${H.esc(it.nombre)}${it.tipo === 'mp' ? ' <span class="ayuda">(MP)</span>' : ''}${it.derramado ? ' <span class="chip c-amarillo">Derramado</span>' : ''}</td><td>${cantM(it.cantidad, it.unidad)}</td><td>${Object.entries(it.motivos).map(([k, n]) => H.esc(P.MOTIVOS[k] || k) + (n > 1 ? ` (${n})` : '')).join(', ')}</td><td style="text-align:right">${it.sinCosto && !it.neto ? '<span class="ayuda">sin costo</span>' : pesosN(it.neto) + (it.sinCosto ? ' <span class="ayuda">(parcial)</span>' : '') + (it.incompleto ? ' <span class="ayuda merma-fuente">costo incompleto</span>' : '')}</td></tr>`).join('')}
      </tbody></table></div>
      ${Object.keys(a.motivos).length > 1 ? `<p class="ayuda">Por motivo: ${Object.entries(a.motivos).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${H.esc(P.MOTIVOS[k] || k)} ${pesosN(v)}`).join(' · ')}</p>` : ''}
    </div>`;
  return cab + `
    <p class="ayuda">${H.esc(rango)} · Total: <b>${pesosN(r.total)}</b> neto${r.areas.some(a => a.sinCosto) ? ' (hay ítems sin costo en Finanzas → Costos: no suman)' : ''}</p>
    ${d.errorCostos ? `<p class="error">No se pudieron leer los costos: ${H.esc(d.errorCostos)}</p>` : ''}
    ${r.areas.length ? r.areas.map(area).join('') : '<p class="ayuda">Nada anotado como merma en este período.</p>'}
    ${r.cafe.total ? seccionCafe(H, r.cafe) : ''}`;
}
// Café de Cafetería: calibración diaria (automática o editada, por día, valorizada como gasto de calibración) + la bitácora
const DIA_S = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function seccionCafe(H, cafe) {
  const cd = cafe.calibracionDiaria;
  const dias = cd.dias.map(x => `<li>${H.esc(DIA_S[new Date(x.fecha + 'T12:00:00').getDay()] + ' ' + fechaC(x.fecha))}: ${H.esc(String(x.shots))} shots ${x.auto ? '(automática)' : '<b>(editada)</b>'} · ${cantM(x.gramos, 'g')}</li>`).join('');
  return `<h3 style="margin:16px 0 4px">Café de Cafetería ${H.info('Café de Cafetería', 'Calibración diaria: los shots que se cuentan solos cada día que Cafetería vende en la caja (configuración de Cafetería; vacío = 6), o el número que la barista editó ese día en Cocina (0 si no se calibró). Se valoriza como gasto de calibración, con el costo neto del café (maestro de costos de Finanzas; si falta, MP_maestro).\nCalibración extra, café botado y pruebas: lo anotado en la bitácora de turno.\nTodo esto se descuenta del café de la bodega de Cafetería.')}</h3>
    <p class="ayuda">Calibración diaria: <b>${H.esc(String(cd.shots))} shots · ${cantM(cd.gramos, 'g')}</b> en ${cd.dias.length} ${cd.dias.length === 1 ? 'día' : 'días'}${cd.editados ? ` (${cd.editados} editado${cd.editados === 1 ? '' : 's'})` : ''}${cd.neto !== null ? ` · gasto de calibración <b>${pesosN(cd.neto)}</b> neto` : cd.gramos ? ' · sin costo del café' : ''}</p>
    ${cd.dias.length ? `<details><summary class="ayuda">Ver por día</summary><ul class="ayuda">${dias}</ul></details>` : ''}
    <p class="ayuda">Bitácora de turno: calibración extra ${cantM(cafe.calibracion, 'g')} · café botado ${cantM(cafe.merma, 'g')} · pruebas ${cantM(cafe.prueba_receta, 'g')} · <b>total de café ${cantM(cafe.total, 'g')}</b> (con la calibración diaria)</p>
    ${cafe.porGramo !== null && cafe.porGramo !== undefined ? `<p class="ayuda" id="merma-cafe-valor">Valorizado: bitácora de turno <b>${pesosN(cafe.netoBitacora)}</b> · todo el café <b>${pesosN(cafe.netoTotal)}</b> neto · café a ${pesosN(cafe.porGramo * 1000)} / kg ${H.info('Café valorizado', 'Los gramos de café (calibración diaria, calibración extra, café botado y pruebas) × el precio neto por gramo de la materia prima café de Cafetería (Configuración de Producción → Cafetería).\nEl precio sale del maestro de costos de Finanzas (última compra; Finanzas → Costos).')}</p>` : ''}`;
}
function conectarMerma(el, H) {
  const b = $('prod-merma-ver'), sel = $('prod-merma-per'); if (!b) return;
  sel.addEventListener('change', () => { st.merma.periodo = sel.value; });
  b.addEventListener('click', async () => {
    st.merma.periodo = sel.value; st.merma.cargando = true; st.merma.msg = ''; $('prod-merma').innerHTML = seccionMerma(H); conectarMerma(el, H);
    // v0.63.3: lo pides tú: se lee de nuevo (fresco)
    try { st.merma.datos = await P.mermaDelPeriodo({ ...P.periodoMerma(st.merma.periodo), fresco: true }); } catch (e) { st.merma.datos = null; st.merma.msg = error(e, H); }
    st.merma.cargando = false; if (!$('prod-merma')) return; $('prod-merma').innerHTML = seccionMerma(H); conectarMerma(el, H);
  });
}

// ═══════════════ Recetas por aprobar y materias primas pedidas (desde Cocina) ═══════════════
// v0.73.0 (Etapa 1): la base de Cocina (fen-produccion) es la maestra de recetas y materias primas; la planilla ya no se escribe
const TXT_MAESTRA = 'Desde la v0.73.0, las recetas y las materias primas viven en la base de Cocina (fen-produccion): lo que apruebas aquí y lo que creas para las jefas se guarda solo ahí. Los precios están en Finanzas → Costos (base de Gastos y Finanzas): las jefas no ven costos.\nLa planilla de Producción queda como estaba, como historial: ya no se lee ni se escribe. Por eso ya no está "Leer la planilla / Copiar".\nNada se borra: la versión anterior de cada receta queda guardada al aprobar un cambio.';
const TXT_CSV = 'La caja y la app de logística todavía leen la lista de recetas publicada desde la planilla (la usan para enlazar productos con su receta). Como la planilla ya no recibe las recetas nuevas, una receta aprobada desde ahora llegará a esas listas en la próxima etapa (etapa 2), cuando la caja y logística lean la base de Cocina.\nMientras tanto, los productos los creas tú igual (en la caja y en Ventas a empresas), y en Finanzas → Asociar productos eliges la receta (esa lista sí sale de la base de Cocina).';
const TXT_DESDE = 'Las jefas de cada área crean y cambian recetas en Cocina. Cada cambio llega aquí como propuesta: la receta vigente sigue igual hasta que la apruebas.\nEl costo es neto (sin IVA) y sale de Finanzas → Costos (precios de la última compra del SII o a mano). Al aprobar, la receta queda en la base de Cocina (la maestra) con su ID; la versión anterior queda guardada. La planilla ya no se escribe.\nUna materia prima pedida se crea en la base de Cocina con el ID que sigue (MP… o IN…) y su precio neto queda en Finanzas.\nSi la devuelves, la jefa ve tu comentario y la corrige.\n' + TXT_CSV.split('\n')[0].replace('todavía leen', 'leen por ahora');
const FMr = c => P.resumenPropuesta(c);
const pesosN = v => '$' + Math.round(Number(v) || 0).toLocaleString('es-CL');
const pesosD = v => '$' + (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-CL');
const ESTADO_TXT = { en_revision: 'En revisión', devuelta: 'Devuelta', aprobada: 'Aprobada' };
// v0.77.1 · Por revisar: cada propuesta dice qué cambió (ingredientes en g y %, rendimiento, pasos) y su impacto en el costo
// (costo por unidad vigente → propuesto, con el motor de Finanzas; los precios se leen una sola vez para toda la lista).
function resumenFila(p, H) {
  const d = p.datos || {}, v = p.vigente, c = st.costos[p.docId];
  const cs = RV.cambios(v ? { ...v } : null, d);
  const qu = cs.length > 3 ? cs.slice(0, 3).concat([`y ${cs.length - 3} ${cs.length - 3 === 1 ? 'cambio más' : 'cambios más'}`]) : cs;
  const imp = c ? RV.impactoCosto(c, c.error ? null : FMr(c)) : null;
  const costo = !c ? '<span class="ayuda">Calculando el costo…</span>'
    : c.error ? `<span class="ayuda">Sin costo: ${H.esc(c.code === 'sin_gastos' ? 'conecta la base de Gastos y Finanzas' : c.error)}</span>`
    : imp ? `<span class="prop-impacto${imp.pct > 0.05 ? ' dif-mal' : imp.pct < -0.05 ? ' prop-baja' : ''}">${H.esc(imp.texto)}</span>${imp.faltan.length ? ` <span class="chip c-rojo chip-chico">no está en la base de Cocina: ${H.esc(imp.faltan.join(', '))}</span>` : ''}${imp.sinPrecio.length ? ` <span class="chip c-amarillo chip-chico">sin precio: ${H.esc(imp.sinPrecio.slice(0, 3).join(', '))}${imp.sinPrecio.length > 3 ? '…' : ''}</span>` : ''}` : '';
  return `<div class="prop-resumen" data-prop-resumen="${H.esc(p.docId)}">${qu.length ? `<span class="prop-cambios">${qu.map(x => H.esc(x)).join(' · ')}</span>` : ''}<span class="prop-costo-fila">${costo}</span></div>`;
}
async function pintarCocina(el, H, leer) {
  const caja = $('prod-cocina'); if (!caja) return;
  if (leer) {
    try { [st.props, st.sols] = await Promise.all([P.propuestasEnRevision(), P.solicitudesPendientes()]); st.cocinaMsg = ''; }
    catch (e) { st.props = st.props || []; st.sols = st.sols || []; st.cocinaMsg = error(e, H); }
    ponerChip((st.props || []).length + (st.sols || []).length);
    // El costo de todas las propuestas, de una vez (sin esperar: la lista se ve antes)
    const faltan = (st.props || []).filter(p => !st.costos[p.docId]);
    // Al llegar, solo se cambia la línea del costo de cada fila (lo que estés escribiendo en las pedidas no se borra); la propuesta
    // abierta que esperaba su costo se vuelve a dibujar entera
    const llegaron = () => {
      if (faltan.some(p => p.docId === st.abierta)) return pintarCocina(el, H, false);
      faltan.forEach(p => { const x = document.querySelector(`[data-prop-resumen="${CSS.escape(p.docId)}"]`); if (x) x.outerHTML = resumenFila(p, H); });
    };
    if (faltan.length) P.costearVarias(faltan).then(cs => { faltan.forEach((p, i) => { st.costos[p.docId] = cs[i]; }); llegaron(); })
      .catch(e => { faltan.forEach(p => { st.costos[p.docId] = { error: error(e, H) }; }); llegaron(); });
  }
  if (!$('prod-cocina')) return;
  const props = st.props || [], sols = st.sols || [];
  // v0.137.2: las categorías que existen, para la lista del campo Categoría
  if (sols.some(x => x.tipo !== 'habilitar') && !st.catsMp) { try { st.catsMp = MA.categoriasDe(await P.materiasPrimas()); } catch (e) { st.catsMp = []; } }
  const cuando = p => String(((p.historial || []).slice(-1)[0] || {}).en || '').slice(0, 10);
  const pie = `<p class="ayuda prod-maestra" id="prod-maestro">La base de Cocina es la maestra ${H.info('La base de Cocina es la maestra', TXT_MAESTRA)} · Las recetas aprobadas están en <a href="#produccion/recetas">Recetas</a> y las materias primas en <a href="#produccion/mp">Materias primas</a>.</p>`;
  // Sin nada esperando: una sola línea
  if (!props.length && !sols.length && !st.cocinaMsg) {
    caja.innerHTML = `<div class="titulo-fila"><h2 id="t-prod-revision">Por revisar ${H.info('Por revisar', TXT_DESDE)}</h2><span class="ayuda">Nada esperando: recetas por aprobar · 0 · materias primas pedidas · 0</span></div>${pie}`;
    return;
  }
  caja.innerHTML = `
    <div class="titulo-fila"><h2 id="t-prod-revision">Por revisar ${H.info('Por revisar', TXT_DESDE)}</h2></div>
    ${st.cocinaMsg ? `<p class="error">${H.esc(st.cocinaMsg)}</p>` : ''}
    <h3 style="margin:8px 0">Recetas por aprobar · ${props.length} ${H.info('Recetas nuevas en la caja y en logística', TXT_CSV)}</h3>
    ${props.length ? `<div class="lista-simple">${props.map(p => `<div class="fila-caja fila-prop" data-prop="${H.esc(p.docId)}" style="flex-wrap:wrap">
        <div class="txt"><b>${p.recetaId ? 'Cambio a ' : ''}${H.esc((p.datos || {}).nombre || 'Sin nombre')}</b><span>${P.AREAS[p.area] || p.area} · ${p.recetaId ? `cambio a la v${H.esc(String((p.vigente || {}).version || 1))}` : 'receta nueva'}${p.origen === 'ajuste' ? ' · desde el ajuste de harina/agua' : ''} · ${H.esc(p.creadaPor || '')} · ${H.esc(cuando(p))}</span>${resumenFila(p, H)}</div>
        ${p.estado === 'aprobando' ? `<span class="chip c-amarillo">Aprobándose</span><button type="button" class="btn-sec" data-prop-destrabar="${H.esc(p.docId)}" title="Si se cortó la aprobación, vuelve a revisión para reintentarla">Volver a revisión</button>`
          : `<button type="button" class="btn-sec" data-prop-revisar="${H.esc(p.docId)}">${st.abierta === p.docId ? 'Cerrar' : 'Revisar'}</button>`}
        ${st.abierta === p.docId ? `<div style="flex-basis:100%">${detallePropuesta(p, H)}</div>` : ''}
      </div>`).join('')}</div>` : '<p class="ayuda">No hay recetas esperando.</p>'}
    <h3 style="margin:16px 0 8px">Materias primas pedidas · ${sols.length}</h3>
    ${sols.length ? `<div class="lista-simple">${sols.map(s => filaSolicitud(s, H)).join('')}</div>` : '<p class="ayuda">No hay pedidos.</p>'}
    ${pie}`;
  caja.querySelectorAll('[data-prop-revisar]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.propRevisar;
    st.abierta = st.abierta === id ? null : id;
    pintarCocina(el, H, false);
    if (st.abierta && !st.costos[id]) {
      const p = props.find(x => x.docId === id);
      try { st.costos[id] = await P.costear(p); } catch (e) { st.costos[id] = { error: error(e, H) }; }
      pintarCocina(el, H, false);
    }
  }));
  caja.querySelectorAll('[data-prop-destrabar]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await P.destrabar(props.find(x => x.docId === b.dataset.propDestrabar)); } catch (e) { st.cocinaMsg = error(e, H); }
    pintarCocina(el, H, true);
  }));
  caja.querySelectorAll('[data-prop-accion]').forEach(b => b.addEventListener('click', async () => {
    const p = props.find(x => x.docId === b.dataset.propId), com = ($('prop-com') || {}).value || '', err = $('prop-err');
    err.textContent = ''; b.disabled = true;
    try {
      if (b.dataset.propAccion === 'aprobar') {
        const r = await P.aprobar(p, com);
        H.registrar('Aprobó una receta de Cocina', `${(p.datos || {}).nombre} · ${P.AREAS[p.area]} · v${r.version}`);
        st.cocinaMsg = '';
      } else {
        await P.devolver(p, com);
        H.registrar('Devolvió una receta a Cocina', `${(p.datos || {}).nombre} · ${P.AREAS[p.area]}`);
      }
      st.abierta = null; delete st.costos[p.docId];
      pintarCocina(el, H, true);
    } catch (e) {
      if (e.code === 'cambio') { st.abierta = null; st.cocinaMsg = error(e, H); pintarCocina(el, H, true); return; }
      err.textContent = error(e, H); b.disabled = false;
    }
  }));
  CC.conectarCategoria(caja, st.catsMp || []);   // v0.137.2
  caja.querySelectorAll('[data-sol-accion]').forEach(b => b.addEventListener('click', async () => {
    const s = sols.find(x => x.docId === b.dataset.solId), f = b.closest('[data-sol]'), err = f.querySelector('.error'), v = k => (f.querySelector(`[data-k="${k}"]`) || {}).value || '';
    err.textContent = ''; b.disabled = true;
    try {
      if (b.dataset.solAccion === 'rechazar') {
        const motivo = prompt('¿Por qué no se crea? (lo ve la jefa)', ''); if (motivo === null) { b.disabled = false; return; }
        await P.rechazarSolicitud(s, motivo);
      } else if (b.dataset.solAccion === 'habilitar') {
        await P.resolverSolicitud(s, { habilitarId: b.dataset.mpId || s.mpId });
        H.registrar('Habilitó una materia prima para un área', `${s.nombre} → ${P.AREAS[s.area]}`);
      } else {
        const costo = Number(v('costo').replace(/\./g, '').replace(',', '.'));
        if (!(costo > 0)) { err.textContent = 'Escribe el costo neto (sin IVA) de la unidad de compra.'; b.disabled = false; return; }
        await P.resolverSolicitud(s, { nombre: v('nombre').trim() || s.nombre, tipo: v('tipo'), categoria: CC.leerCategoria(f, `sol-${s.docId}-c`).trim(), unidad: v('unidad').trim(), costoNeto: costo });
        st.catsMp = null;   // v0.137.2: puede haber una categoría nueva
        H.registrar('Creó una materia prima pedida en Cocina', `${s.nombre} · ${P.AREAS[s.area]}`);
      }
      pintarCocina(el, H, true);
    } catch (e) {
      if (e.code === 'sin_precio') { H.registrar('Creó una materia prima pedida en Cocina', `${s.nombre} · ${P.AREAS[s.area]} · sin precio`); st.cocinaMsg = error(e, H); pintarCocina(el, H, true); return; }
      err.innerHTML = H.esc(error(e, H)) + (e.code === 'existe' && e.datos && e.datos.id ? ` <button type="button" class="btn-sec" data-sol-accion="habilitar" data-sol-id="${H.esc(s.docId)}" data-mp-id="${H.esc(e.datos.id)}">Habilitar esa</button>` : '');
      err.querySelectorAll('[data-sol-accion]').forEach(x => x.addEventListener('click', async () => {
        try { await P.resolverSolicitud(s, { habilitarId: x.dataset.mpId }); pintarCocina(el, H, true); } catch (e2) { err.textContent = error(e2, H); }
      }));
      b.disabled = false;
    }
  }));
}

function detallePropuesta(p, H) {
  const d = p.datos || {}, v = p.vigente, c = st.costos[p.docId];
  const cant = i => i ? (i.unidades !== null && i.unidades !== undefined && i.unidades !== '' ? `${String(i.unidades).replace('.', ',')} un · ` : '') + `${(Math.round((Number(i.gramos) || 0) * 10) / 10).toLocaleString('es-CL')} g` : '—';
  const vIngs = v ? v.ingredientes || [] : [];
  const ids = [...new Set([...(d.ingredientes || []).map(i => i.id), ...vIngs.map(i => i.id)])];
  const pctV = v ? RV.panadero(v) : {}, pctP = RV.panadero(d);   // v0.77.1: el % de panadero al lado de los gramos (como en Cocina)
  // v0.63.6: costo neto por ingrediente (Finanzas), vigente y propuesta: se ve qué ingrediente mueve el costo
  const lnV = c && !c.error && c.vigente && c.vigente.lineas, lnP = c && !c.error && c.propuesta && c.propuesta.lineas, conCosto = !!(lnP || lnV);
  const cst = (ln, id, hay) => (!hay ? '' : ln && ln[id] !== null && ln[id] !== undefined ? ` <span class="prop-costo">${pesosN(ln[id])}</span>` : ln && id in ln ? ' <span class="prop-costo">sin precio</span>' : '');
  const filas = ids.map(id => {
    const a = vIngs.find(i => i.id === id), b = (d.ingredientes || []).find(i => i.id === id), igual = a && b && cant(a) === cant(b) && RV.pctTxt(pctV[id]) === RV.pctTxt(pctP[id]);
    const pc = (x, m) => (x && m[id] !== null && m[id] !== undefined ? ` · ${RV.pctTxt(m[id])}` : '');
    return `<tr${igual ? '' : ' class="cambio"'}><td>${H.esc((b || a).nombre)}</td>${v ? `<td>${cant(a)}${pc(a, pctV)}${cst(lnV, id, !!a)}</td>` : ''}<td>${cant(b)}${pc(b, pctP)}${cst(lnP, id, !!b)}${!a && v ? ' <span class="chip c-verde">nuevo</span>' : !b ? ' <span class="chip c-rojo">sale</span>' : ''}</td></tr>`;
  }).join('');
  const otros = [];
  const cmp = (t, x, y) => { if (String(x ?? '') !== String(y ?? '')) otros.push(`${t}: ${H.esc(String(x ?? '—'))} → <b>${H.esc(String(y ?? '—'))}</b>`); };
  if (v) {
    cmp('Nombre', v.nombre, d.nombre); cmp('Rinde', `${v.porciones} ${v.unidad}`, `${d.porciones} ${d.unidad}`); cmp('Tipo', v.tipo, d.tipo);
    cmp('Clasificación', v.clasificacion, d.clasificacion); cmp('Peso por unidad', v.pesoUnidad || '', d.pesoUnidad || '');
    if (JSON.stringify(v.pasos || []) !== JSON.stringify(d.pasos || [])) otros.push(`Pasos: ${(v.pasos || []).length} → <b>${(d.pasos || []).length}</b> (cambiaron)`);
    if (JSON.stringify((v.insumos || []).map(i => i.id)) !== JSON.stringify((d.insumos || []).map(i => i.id))) otros.push('Insumos: cambiaron');
  } else otros.push(`Rinde ${H.esc(String(d.porciones))} ${d.unidad === 'g' ? 'g' : 'un'} · ${d.tipo === 'sub_receta' ? 'sub receta' : 'receta'}${d.clasificacion ? ' · ' + H.esc(d.clasificacion) : ''} · ${(d.pasos || []).length} pasos`);
  const pct = x => (x === null || x === undefined || !isFinite(x) ? '' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.round(Math.abs(x) * 10) / 10).toLocaleString('es-CL')} %`);
  const pctCls = x => (x > 0.05 ? 'dif-mal' : x < -0.05 ? 'prop-baja' : '');
  const rinde = x => `${H.esc(String(x.porciones))} ${x.unidad === 'g' ? 'g' : 'un'}`;
  const costo = !c ? '<p class="ayuda">Calculando el costo (neto, con Finanzas)…</p>' : c.error ? `<p class="error">${H.esc(c.error)}</p>` : (() => {
    const n = c.propuesta, o = c.vigente, R = FMr(c);
    const avisos = [...(n.faltan || []).map(x => `${x}: no está en la base de Cocina`), ...(n.sinPrecio || []).map(x => `${x}: sin precio`)];
    const rv = o ? { porciones: v.porciones, unidad: v.unidad } : null, rn = { porciones: d.porciones, unidad: d.unidad };
    const fuente = 'Costo neto de Finanzas (Finanzas → Costos: precio de la última compra o a mano).';
    const tit = R.titular ? `<p class="prop-titular" id="prop-titular"><b class="${pctCls(R.titular.pct)}">${pct(R.titular.pct)}</b> el costo ${R.titular.que} (neto) ${H.info('Qué cambia', `Lo primero es el costo ${R.titular.que === 'por unidad' ? 'por unidad (lo que cuesta cada una)' : 'del lote completo (todo lo que se hace con la receta)'}, no el costo por gramo.\nSi la receta rinde más gramos porque lleva más agua o leche, el gramo sale más barato aunque cada taza o pieza cueste más: por eso el costo por gramo queda abajo, como dato secundario.\n${fuente}`)}</p>` : '';
    const vpu = c.vendePorUnidad && c.vendePorUnidad.si ? `<p class="aviso" id="prop-aviso-unidad">Esta receta rinde en gramos pero se vende por unidad: compara el costo del lote. Conviene que rinda unidades (ej. 1 espresso). ${H.info('Rinde en gramos, se vende por unidad', `Esta receta ${c.vendePorUnidad.motivo || 'se vende por unidad'}. Su costo se calcula por gramo, y el gramo cambia cuando cambia el rendimiento (más agua = más gramos), aunque cada taza cueste lo mismo o más.\nMientras rinda gramos, mira el costo del lote (lo que cuesta hacerla una vez).\nSi en Cocina se cambia para que rinda unidades (por ejemplo 1 espresso), el costo por unidad sale directo y se compara bien.`)}</p>` : '';
    const lote = `<div class="cifras" style="margin:10px 0">
      ${o ? `<div class="tarjeta cifra"><span class="rotulo">Lote vigente</span><span class="valor">${pesosN(o.loteNeto)}</span><span class="nota">neto · ${rinde(rv)}</span></div>` : ''}
      <div class="tarjeta cifra"><span class="rotulo">Lote propuesto</span><span class="valor">${pesosN(n.loteNeto)}</span><span class="nota">neto · ${rinde(rn)}${R.pctLote !== null ? ` · <b class="${pctCls(R.pctLote)}">${pct(R.pctLote)}</b>` : ''}</span></div>
      ${R.unN !== null ? `${R.unV !== null ? `<div class="tarjeta cifra"><span class="rotulo">Vigente · por unidad</span><span class="valor">${pesosD(R.unV)}</span><span class="nota">neto · bruto ${pesosD(R.unV * 1.19)}</span></div>` : ''}<div class="tarjeta cifra"><span class="rotulo">Propuesta · por unidad</span><span class="valor">${pesosD(R.unN)}</span><span class="nota">neto · bruto ${pesosD(R.unN * 1.19)}${R.pctUn !== null ? ` · <b class="${pctCls(R.pctUn)}">${pct(R.pctUn)}</b>` : ''}</span></div>` : ''}
    </div>`;
    const pgV = o ? (o.unidad === 'g' ? o.unidadNeto : o.porGramo) : null, pgN = n.unidad === 'g' ? n.unidadNeto : n.porGramo;
    const gramo = pgN !== null && pgN !== undefined ? `<div class="cifras prop-secundaria" id="prop-por-gramo">
      ${pgV !== null && pgV !== undefined ? `<div class="cifra"><span class="rotulo">Vigente · por gramo</span><span class="valor">${pesosD(pgV)}</span><span class="nota">neto · bruto ${pesosD(pgV * 1.19)}</span></div>` : ''}
      <div class="cifra"><span class="rotulo">Propuesta · por gramo</span><span class="valor">${pesosD(pgN)}</span><span class="nota">neto · bruto ${pesosD(pgN * 1.19)}${R.pctGramo !== null ? ` · ${pct(R.pctGramo)}` : ''}</span></div>
    </div>` : '';
    return `${tit}${vpu}${lote}${gramo}${avisos.length ? `<p class="aviso">${avisos.map(H.esc).join(' · ')}</p>` : ''}`;
  })();
  const ult = [...(p.historial || [])].reverse().find(h => h.comentario);
  return `<div style="border-top:1px solid var(--borde);margin-top:10px;padding-top:10px">
    ${ult ? `<p class="ayuda">Nota de ${H.esc(ult.por || '')}: ${H.esc(ult.comentario)}</p>` : ''}
    <div class="tabla-b2b"><table class="tabla-tiempos" id="prop-ingredientes"><thead><tr><th scope="col">Ingrediente</th>${v ? `<th scope="col">Vigente${conCosto ? ' · costo neto' : ''}</th>` : ''}<th scope="col">Propuesta${conCosto ? ' · costo neto' : ''}</th></tr></thead><tbody>${filas}</tbody></table></div>
    ${otros.length ? `<ul class="ayuda" style="margin:8px 0 0 18px">${otros.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${costo}
    <div class="campo"><label for="prop-com">Comentario (si la devuelves, la jefa lo ve; si la apruebas, queda en el registro)</label><textarea id="prop-com" rows="2" maxlength="500" style="font:inherit;padding:10px;border-radius:10px;border:1px solid var(--borde)"></textarea></div>
    <div class="error" id="prop-err" role="alert"></div>
    <div class="botones"><button type="button" class="btn-sec" data-prop-accion="devolver" data-prop-id="${H.esc(p.docId)}">Devolver</button><button type="button" class="btn" data-prop-accion="aprobar" data-prop-id="${H.esc(p.docId)}" ${c && !c.error && !(c.propuesta.faltan || []).length ? '' : 'disabled'}>Aprobar${p.recetaId ? ' y reemplazar la vigente' : ''}</button></div>
  </div>`;
}

function filaSolicitud(s, H) {
  const base = `<div class="txt"><b>${s.tipo === 'habilitar' ? 'Habilitar' : 'Nueva'}: ${H.esc(s.nombre)}</b><span>${P.AREAS[s.area] || s.area} · ${H.esc(s.por || '')}${s.receta ? ' · para ' + H.esc(s.receta) : ''}${s.nota ? ' · “' + H.esc(s.nota) + '”' : ''}</span></div>`;
  if (s.tipo === 'habilitar') return `<div class="fila-caja" data-sol="${H.esc(s.docId)}" style="flex-wrap:wrap">${base}
      <div class="botones"><button type="button" class="btn-sec" data-sol-accion="rechazar" data-sol-id="${H.esc(s.docId)}">No</button><button type="button" class="btn" data-sol-accion="habilitar" data-sol-id="${H.esc(s.docId)}">Habilitar para ${P.AREAS[s.area] || s.area}</button></div>
      <div class="error" role="alert" style="flex-basis:100%"></div></div>`;
  const id = k => `sol-${s.docId}-${k}`;
  return `<div class="fila-caja" data-sol="${H.esc(s.docId)}" style="flex-wrap:wrap">${base}
    <div class="fila-campos" style="flex-basis:100%;flex-wrap:wrap;align-items:flex-end">
      <div class="campo"><label for="${id('n')}">Nombre</label><input id="${id('n')}" data-k="nombre" value="${H.esc(s.nombre)}"></div>
      <div class="campo"><label for="${id('t')}">Es</label><select id="${id('t')}" data-k="tipo"><option value="mp" ${s.esInsumo ? '' : 'selected'}>Materia prima</option><option value="insumo" ${s.esInsumo ? 'selected' : ''}>Insumo</option></select></div>
      <div class="campo"><label for="${id('c')}">Categoría</label>${CC.htmlCategoria(H, id('c'), '', st.catsMp || [])}</div>
      <div class="campo"><label for="${id('u')}">Se compra por</label><input id="${id('u')}" data-k="unidad" value="${H.esc(P.UNIDAD_COMPRA.test(s.unidadCompra || '') ? s.unidadCompra : (s.esInsumo ? 'un' : 'kg'))}" placeholder="kg, 25kg, lt, un, 10un">${s.unidadCompra && !P.UNIDAD_COMPRA.test(s.unidadCompra) ? `<small class="ayuda">La jefa escribió “${H.esc(s.unidadCompra)}”</small>` : ''}</div>
      <div class="campo"><label for="${id('p')}">Costo neto de esa unidad ($, sin IVA)</label><input id="${id('p')}" data-k="costo" inputmode="decimal"></div>
    </div>
    <div class="error" role="alert" style="flex-basis:100%"></div>
    <div class="botones" style="flex-basis:100%"><button type="button" class="btn-sec" data-sol-accion="rechazar" data-sol-id="${H.esc(s.docId)}">No crear</button><button type="button" class="btn" data-sol-accion="crear" data-sol-id="${H.esc(s.docId)}">Crear y habilitar para ${P.AREAS[s.area] || s.area}</button></div>
  </div>`;
}

function listaMover(H) {
  const l = st.mover || [];
  if (!l.length) return '<p class="ayuda">Bollería no tiene recetas en la base nueva.</p>';
  const sug = l.filter(r => r.sugerida).length;
  return `<p class="ayuda">${sug ? `Marcadas las ${sug} que parecen de Pastelería (rellenos, cremas, glaseados…). Revisa y cambia lo que haga falta.` : 'Marca las que pasan a Pastelería.'}</p>
    <div class="lista-simple">${l.map(r => `<label class="fila-caja" style="cursor:pointer"><input type="checkbox" data-mover="${H.esc(r.id)}" ${r.sugerida ? 'checked' : ''} style="width:22px;height:22px">
      <div class="txt"><b>${H.esc(r.nombre)}</b><span>${r.tipo === 'sub_receta' ? 'Sub receta' : 'Receta'}${r.clasificacion ? ' · ' + H.esc(r.clasificacion) : ''} · ${H.esc(r.estado || '')}</span></div></label>`).join('')}</div>
    <div class="botones" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn" id="prod-mover-ok">Pasar las marcadas a Pastelería</button></div>`;
}

