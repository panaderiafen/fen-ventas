// ═══════════════════════════════════════════════
//  Sistema Fën — Gastos  v0.10.0 · v0.49.0
//  Habla con el Apps Script de Gastos (v2.2.0+, archivo SistemaFen.gs; registrados, obligaciones, ítems y SII piden v2.4.0)
//  con la sesión de administración de Sistema Fën. El script usa las mismas
//  funciones de la app de Gastos: un pago o un gasto queda igual que si se
//  hubiera hecho allá (mismas hojas, misma carpeta de Drive).
//  Cada envío lleva una clave única (idem): si se repite, no se guarda dos veces.
//  v0.46.0 (etapa G2): con Gastos en la base nueva (config/gastos: fuente "base"), datos, pagar, registrar,
//  registrados (lista, corregir, anular) y anular/reabrir un vencimiento van a fen-gastos (gastos-fs.js) con las
//  mismas respuestas; las fotos y comprobantes siguen yendo a Drive con el script (op archivo_subir, v2.12.0).
//  Con la planilla, todo igual que en la v0.45.0.
//  v0.47.0 (etapa G2): con la base nueva también obligaciones (lista, historial, crear/editar, archivar, reactivar)
//  e ítems (lista, crear/editar, subir/bajar, archivar). La Agenda lee los vencimientos y obligaciones de la base;
//  la copia a Google Calendar y "Sugerir % según ventas" siguen con el script. Con la planilla, igual que en la v0.46.0.
//  v0.48.0 (etapa G3): con la base nueva también las Cargas del SII (sii.js → gastos-sii-fs.js). El archivo del SII va a
//  Drive con el script (archivo_subir tipo "sii") y se vuelve a abrir con él (sii_archivo con su enlace): v2.14.0.
//  v0.49.0 (etapa G3, segunda parte): solo con la base nueva: subir la boleta del mes, la bandeja "Documentos sin
//  obligación", abonos y cerrar (tipo libre) y vencimientos sueltos. Con la planilla no existen (responden "solo_base").
//  v0.50.0 (etapa G3, tercera parte): con la base nueva también la cartola (cartola.js → gastos-cartola-fs.js); su archivo
//  original va a Drive con archivo_subir tipo "cartola" (script v2.16.0). Con la planilla, todo igual que en la v0.49.0.
//  v0.51.0 (etapa G3, cuarta parte): con la base nueva también Previred (previred.js → gastos-g3d-fs.js; el PDF va a Drive con
//  archivo_subir tipo "previred", script v2.17.0), clasificar obligaciones y el arreglo "siniva" (solo base).
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';
import * as Apps from './apps.js?v=0.138.0';

export const VERSION_MINIMA = '2.2.0';
let urlOk = null, versionOk = '', cacheDatos = null;

// Antes de la primera llamada se pregunta la versión del script: a uno antiguo no se le manda nada nuevo
async function url(minima = VERSION_MINIMA) {
  const u = (await Apps.leerConexiones()).gastos;
  if (!u) throw Object.assign(new Error('Falta la dirección del script de Gastos (Configuración → Conexiones).'), { code: 'sin_url' });
  if (urlOk !== u || !Apps.mayorIgual(versionOk, minima)) {
    const v = await Apps.probar('gastos', u, minima);
    if (!v.ok) throw Object.assign(new Error(v.version ? `El script de Gastos está en v${v.version}: falta actualizarlo a v${minima} (ver README).` : v.texto), { code: 'actualizar' });
    urlOk = u; versionOk = v.version;
  }
  return u;
}
const nuevaClave = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60);

// Lecturas chicas que se pueden reintentar por la dirección si Google desvía el envío
// (v0.43.0: también "exportar", la lectura de la planilla para la base nueva: el pedido es chico aunque la respuesta sea grande)
const LECTURAS_GET = ['datos', 'sii_cargas', 'sii_detalle', 'sii_ventas', 'sii_archivo', 'cc_lista', 'exportar'];
export async function llamar(op, datos = {}, idem, minima) {
  const u = await url(minima);
  const cuerpo = JSON.stringify({ ...datos, action: 'sistema_fen_gastos', op, idToken: await auth.currentUser.getIdToken(), ...(idem ? { idem } : {}) });
  let r = await (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo })).json();
  if (r && r.code === 'version') {
    // Google desvió el envío. Solo la lectura se reintenta por la dirección: un pago o un gasto
    // no (llevaría la sesión en la dirección y una foto no cabe). No se guardó nada.
    if (!LECTURAS_GET.includes(op)) throw Object.assign(new Error('Google no dejó pasar el envío. Inténtalo de nuevo en un momento (no se guardó nada).'), { code: 'version' });
    r = await (await fetch(u + '?p=' + encodeURIComponent(cuerpo))).json();
  }
  if (!r || !r.ok) throw Object.assign(new Error((r && (r.error || r.msg || r.message)) || 'Respuesta inesperada de Gastos'), { code: r && r.code, datos: r });
  return r;
}

// ── v0.46.0 · Con cuál trabaja Gastos: la planilla (script) o la base nueva (fen-gastos) ──
// gastos-base.js avisa con usarFuente() cada vez que lee config/gastos. Si nadie lo leyó todavía, se lee aquí
// (una vez). Sin conexión a la base nueva en este equipo: la planilla, como siempre.
let fuenteActual = null, leyendoFuente = null;
export function usarFuente(f) {
  const nueva = f === 'base' ? 'base' : 'planilla';
  if (fuenteActual !== null && fuenteActual !== nueva) olvidarTodo();
  fuenteActual = nueva;
}
export async function enBase() {
  if (fuenteActual === null) {
    leyendoFuente = leyendoFuente || import('./gastos-base.js?v=0.138.0').then(GB => GB.cargarFuente()).then(f => { if (fuenteActual === null) usarFuente(f && !f.sinConexion ? f.fuente : 'planilla'); })
      .catch(() => { if (fuenteActual === null) fuenteActual = 'planilla'; }).finally(() => { leyendoFuente = null; });
    await leyendoFuente;
  }
  return fuenteActual === 'base';
}
const fs = () => import('./gastos-fs.js?v=0.138.0');
// Marca de ids por envío (un reintento con la misma clave usa los mismos ids: no duplica) y archivo ya subido por envío
const marcas = new Map(), subidos = new Map();
export async function marcaDe(idem) {
  const M = await import('./gastos-g2.js?v=0.138.0');
  const k = idem || nuevaClave();
  if (!marcas.has(k)) marcas.set(k, M.marcaNueva());
  return marcas.get(k);
}
// v0.46.0 · Archivo a Drive (privado, "Fën · Gastos / <tipo> / <año>") con el script v2.12.0; una vez por envío
export const VERSION_ARCHIVO = '2.12.0';
export const subidor = idem => async a => {
  const k = (idem || '') + '|' + a.tipo;
  if (idem && subidos.has(k)) return subidos.get(k);
  const r = await llamar('archivo_subir', a, null, a.tipo === 'sii' ? VERSION_G3 : a.tipo === 'cartola' ? VERSION_G3C : a.tipo === 'previred' ? VERSION_G3D : a.tipo === 'factura' ? VERSION_FACT : VERSION_ARCHIVO);
  if (idem) subidos.set(k, r);
  return r;
};

// Vencimientos e ítems. Se guardan 60 segundos en memoria (Hoy, Agenda y Gastos los comparten).
export async function datos(forzar) {
  if (!forzar && cacheDatos && Date.now() - cacheDatos.t < 60000) return cacheDatos.d;
  const d = (await enBase()) ? await (await fs()).datos() : await llamar('datos');
  cacheDatos = { t: Date.now(), d };
  return d;
}
export const olvidar = () => { cacheDatos = null; };
// Hoy con la base nueva: atrasados y próximos 7 días leídos de la base (null si Gastos trabaja con la planilla)
export async function pendientesBase() {
  if (!(await enBase())) return null;
  const [l, av, sp, pv] = await Promise.all([(await fs()).pendientesHoy(), avisoSii(), import('./sii-pendientes-fs.js?v=0.138.0').then(F => F.conteosHoy()).catch(() => null), avisosPrevired()]);
  // v0.79.0 · La Bandeja única: cuánto falta (lo mismo que cuenta la Bandeja, de la memoria; sin las propuestas de la cartola)
  const bu = await import('./bandeja-gastos-fs.js?v=0.138.0').then(F => F.conteosHoy()).catch(() => null);
  // v0.66.0 · Facturas del SII por clasificar (de la memoria; solo si hay)
  // v0.67.0 · Previred del mes pasado: vence el 13 (o el hábil que sigue), desde el día 10 hasta que se registra
  const extra = (av && av.length ? [{ clave: 'sii_sin_cargar', avisos: av }] : []).concat(sp && sp.porClasificar ? [{ clave: 'sii_v066', ...sp }] : [], pv && pv.length ? [{ clave: 'previred_vence', avisos: pv }] : []);
  return l.concat(extra, bu ? [{ clave: 'bandeja', cantidad: bu.todo, ...bu }] : []);
}
// v0.67.0 · Avisos de vencimiento de Previred (solo con la base nueva; de la memoria). Si no se puede leer, sin aviso.
export async function avisosPrevired() {
  if (!(await enBase())) return [];
  try { return await (await g3d()).avisosPreviredHoy(); } catch (e) { return []; }
}
// v0.53.0 · Aviso "SII sin cargar" (solo con la base nueva; con la planilla null). Si no se puede leer, sin aviso.
export async function avisoSii() {
  if (!(await enBase())) return null;
  try { return await (await import('./gastos-sii-fs.js?v=0.138.0')).avisoCargas(); } catch (e) { return []; }
}

export async function pagar(pago, idem) {
  if (!(await enBase())) { const r = await llamar('pagar', pago, idem); olvidar(); return r; }
  const r = await (await fs()).pagar(pago, await marcaDe(idem), subidor(idem));
  olvidarTodo(); return r;
}
export async function registrar(gasto, idem) {
  if (!(await enBase())) { const r = await llamar('registrar', gasto, idem); olvidar(); return r; }
  const r = await (await fs()).registrar(gasto, await marcaDe(idem), subidor(idem));
  olvidarTodo(); return r;
}
export { nuevaClave };

// Archivo para Drive: una foto se achica (lado mayor 1600 px, JPEG) para que suba rápido;
// un PDF va tal cual (hasta 8 MB).
export async function prepararArchivo(file) {
  if (!file) return null;
  if (file.type === 'application/pdf') {
    if (file.size > 8 * 1024 * 1024) throw new Error('El PDF pesa más de 8 MB');
    return { imageData: await base64(file), mimeType: file.type, fileName: file.name };
  }
  if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name || '')) throw new Error('El archivo debe ser una foto o un PDF');
  // Si el navegador no puede achicarla (por ejemplo una foto HEIC de iPhone en un computador), se sube tal cual
  const original = async () => {
    if (file.size > 8 * 1024 * 1024) throw new Error('La foto pesa más de 8 MB y este navegador no puede achicarla. Prueba con una captura o en formato JPG.');
    return { imageData: await base64(file), mimeType: file.type || 'image/heic', fileName: file.name || 'foto' };
  };
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('no')); i.src = src; });
    const max = 1600, esc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * esc)); c.height = Math.max(1, Math.round(img.naturalHeight * esc));
    const ctx = c.getContext('2d'); if (!ctx) return original();
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.82), datos = dataUrl.split(',')[1];
    if (!datos) return original();
    return { imageData: datos, mimeType: 'image/jpeg', fileName: (file.name || 'foto').replace(/\.[a-z0-9]+$/i, '') + '.jpg' };
  } catch (e) { return original(); }
  finally { URL.revokeObjectURL(src); }
}
export const aBase64 = file => base64(file);
function base64(file) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file); }); }

// Neto / IVA / total como la app de Gastos (harina: 19% + 12% adicional)
export function desglose(monto, tipoMonto, esHarina) {
  const f = esHarina ? 1.31 : 1.19, m = Number(monto) || 0;
  if (tipoMonto === 'neto') return { neto: m, total: Math.round(m * f) };
  if (tipoMonto === 'siniva') return { neto: m, total: m };
  return { neto: Math.round(m / f), total: m };
}

// ── v0.10.0: gastos registrados, obligaciones e ítems (script de Gastos v2.4.0) ──
export const VERSION_COMPLETA = '2.4.0';
const op = (o, d, idem) => llamar(o, d, idem, VERSION_COMPLETA);
let cacheLista = null;
// Gastos desde el 1 de enero del año pasado (alcanza para el análisis). 60 s en memoria.
export async function lista(forzar) {
  if (!forzar && cacheLista && Date.now() - cacheLista.t < 60000) return cacheLista.d;
  const d = (await enBase()) ? await (await fs()).lista() : await op('g_lista');
  cacheLista = { t: Date.now(), d };
  return d;
}
const olvidarTodo = () => { cacheLista = null; cachePlantillas = null; olvidar(); };
export { olvidarTodo };
export async function editar(g, cambios, idem) {
  const r = (await enBase()) ? await (await fs()).editar(g, cambios) : await op('g_editar', { fila: g.fila, huella: g.huella, ...cambios }, idem);
  olvidarTodo(); return r;
}
export async function anular(filas, motivo, idem) {
  const r = (await enBase()) ? await (await fs()).anular(filas, motivo) : await op('g_anular', { filas: filas.map(g => ({ fila: g.fila, huella: g.huella })), motivo }, idem);
  olvidarTodo(); return r;
}
export const plantillas = async () => ((await enBase()) ? (await fs()).plantillas() : op('obl_plantillas'));
export const historialPagos = async filtro => ((await enBase()) ? (await fs()).historialPagos(filtro || {}) : op('obl_historial', filtro || {}));
export async function anularVencimiento(id, motivo) { const r = (await enBase()) ? await (await fs()).anularVencimiento(id, motivo) : await op('obl_anular_venc', { id, motivo }); olvidarTodo(); return r; }
export async function reabrirVencimiento(id, motivo) { const r = (await enBase()) ? await (await fs()).reabrirVencimiento(id, motivo) : await op('obl_reabrir_venc', { id, motivo }); olvidarTodo(); return r; }
export async function guardarObligacion(d, idem) {
  const r = (await enBase()) ? await (await fs()).guardarObligacion(d, await marcaDe(idem)) : await op('obl_guardar', d, idem);
  olvidarTodo(); return r;
}
export async function archivarObligacion(id, archivar) {
  const r = (await enBase()) ? await (await fs()).archivarObligacion(id, archivar) : await op(archivar ? 'obl_archivar' : 'obl_activar', { id });
  olvidarTodo(); return r;
}
export const itemsTodos = async () => ((await enBase()) ? (await fs()).itemsTodos() : op('items_todos'));
// v0.16.0 · Agenda: próximos pagos de las obligaciones (60 s en memoria) y copia a Google Calendar (script v2.6.0)
let cachePlantillas = null;
export async function plantillasAgenda() {
  if (cachePlantillas && Date.now() - cachePlantillas.t < 60000) return cachePlantillas.d;
  const d = await plantillas(); cachePlantillas = { t: Date.now(), d }; return d;
}
export const VERSION_CALENDARIO = '2.6.0';
export const calendario = eventos => llamar('calendario', { eventos }, null, VERSION_CALENDARIO);
export async function guardarItem(d) { const r = (await enBase()) ? await (await fs()).guardarItem(d) : await op('item_guardar', d); olvidarTodo(); return r; }
export async function moverItem(item, direccion) { const r = (await enBase()) ? await (await fs()).moverItem(item, direccion) : await op('item_mover', { item, direccion }); olvidarTodo(); return r; }
export async function archivarItem(nombre, archivar) { const r = (await enBase()) ? await (await fs()).archivarItem(nombre, archivar) : await op('item_archivar', { nombre, archivar }); olvidarTodo(); return r; }

// v0.44.0 · Archivos en Drive (script de Gastos v2.10.0): deja privados los archivos ya subidos.
// Una parte por llamada (menos de ~4 minutos en el script); "siguiente" es la marca para seguir.
export const VERSION_DRIVE = '2.10.0';
export const dejarPrivados = siguiente => llamar('drive_privados', siguiente ? { siguiente } : {}, null, VERSION_DRIVE);

// v0.45.0 · Base nueva, etapa G2 (script de Gastos v2.11.0, BaseNueva.gs):
// planilla_sync copia a la planilla lo que cambió en la base nueva (con la sesión de fen-gastos: tokenBase);
// cambio deja la planilla cerrada para escribir (fuente "base") o la vuelve a abrir ("planilla").
export const VERSION_G2 = '2.11.0';
// v0.49.0: la copia necesita el script v2.15.0 (el estado nuevo de los vencimientos pasa a la planilla como lo entiende la app antigua)
// v0.50.0: la cartola también pasa a la planilla (Cartolas, Cartola Cargos y Cartola Reglas): script v2.16.0
// v0.51.0: Previred también pasa a la planilla (Cotizaciones y Cotizaciones Trabajadores): script v2.17.0
export const VERSION_COPIA = '2.17.0';
// v0.50.0 · el archivo original de la cartola con la base nueva (archivo_subir tipo "cartola")
export const VERSION_G3C = '2.16.0';
// v0.51.0 · el PDF de Previred con la base nueva (archivo_subir tipo "previred")
export const VERSION_G3D = '2.17.0';
export const VERSION_FACT = '2.19.0';   // v0.113.0: el PDF de las facturas B2B a Drive (archivo_subir tipo "factura")
export const planillaSync = tokenBase => llamar('planilla_sync', { tokenBase }, null, VERSION_COPIA);
export const cambioFuente = fuente => llamar('cambio', { fuente }, null, VERSION_G2);
export const fuenteScript = () => llamar('fuente', {}, null, VERSION_G2);

// v0.48.0 · Etapa G3 (script de Gastos v2.14.0): con la base nueva, el archivo de una carga del SII se sube a Drive
// con archivo_subir (tipo "sii") y se vuelve a abrir con sii_archivo y su enlace (la carga está en la base, no en la planilla).
export const VERSION_G3 = '2.14.0';
export const leerArchivoSii = enlace => llamar('sii_archivo', { url: enlace }, null, VERSION_G3);

// v0.49.0 · Solo con la base nueva (la planilla no tiene estas piezas: la app antigua sigue igual)
const soloBase = async () => { if (!(await enBase())) throw Object.assign(new Error('Esto se usa cuando Gastos trabaje con la base nueva.'), { code: 'solo_base' }); return fs(); };
export async function subirBoleta(p, idem) { const F = await soloBase(); const r = await F.subirBoleta(p, await marcaDe(idem), subidor(idem)); olvidarTodo(); return r; }
export const bandeja = async () => (await soloBase()).documentosPendientes();
export async function resolverPendiente(id, accion, datos) { const r = await (await soloBase()).resolverPendiente(id, accion, datos); olvidarTodo(); return r; }
export async function agregarAbono(vencId, a, idem) { const F = await soloBase(); const r = await F.agregarAbono(vencId, a, await marcaDe(idem), subidor(idem)); olvidarTodo(); return r; }
// v0.63.1 · Área de cada abono: lo recordado por destinatario y los trabajadores de Previred
export const datosAbono = async () => (await soloBase()).datosAbono();
export async function cerrarVencimiento(id) { const r = await (await soloBase()).cerrarVencimiento(id); olvidarTodo(); return r; }
// v0.64.0 · Abono (pago parcial) a un vencimiento no libre y "Reagendar saldo"
export async function abonoParcial(vencId, a, idem) { const F = await soloBase(); const r = await F.abonoParcial(vencId, a, await marcaDe(idem)); olvidarTodo(); return r; }
export async function reagendarSaldo(vencId, fecha, nota) { const r = await (await soloBase()).reagendarSaldo(vencId, fecha, nota); olvidarTodo(); return r; }
// v0.63.1 · El detalle de un gasto con su origen (solo con la base nueva)
export const detalleGasto = async ids => (await soloBase()).detalleGasto(ids);
export async function crearSuelto(p, idem) { const F = await soloBase(); const r = await F.crearSuelto(p, await marcaDe(idem)); olvidarTodo(); return r; }
// v0.70.0 · Boletas de luz y agua (CGE, ESSBIO): vista previa (de la memoria), registrar (con su PDF a Drive) y "Crear cuentas de luz y agua"
export const datosBoleta = async () => (await soloBase()).datosBoleta();
export async function registrarBoletaServicio(p, idem) { const F = await soloBase(); const r = await F.registrarBoletaServicio(p, await marcaDe(idem), subidor(idem)); olvidarTodo(); return r; }
export async function crearCuentasLuzAgua(elecciones, idem) { const F = await soloBase(); const r = await F.crearCuentasLuzAgua(elecciones, await marcaDe(idem)); olvidarTodo(); return r; }

// v0.51.0 · Etapa G3 (cuarta parte), solo con la base nueva: clasificar obligaciones y el arreglo "siniva"
const g3d = () => import('./gastos-g3d-fs.js?v=0.138.0');
export async function datosClasificar() { await soloBase(); return (await g3d()).datosClasificar(); }
export async function clasificarObligaciones(lista, avance) { await soloBase(); const r = await (await g3d()).clasificar(lista, avance); olvidarTodo(); return r; }
export async function previaSiniva() { await soloBase(); return (await g3d()).previaSiniva(); }
export async function aplicarSiniva(ids, avance) { await soloBase(); const r = await (await g3d()).aplicarSiniva(ids, avance); olvidarTodo(); return r; }
// Previred con la base nueva (previred.js decide): estado, registrar (con la marca del envío) y lista
export async function cotBase(op, datos, idem) {
  const F = await g3d();
  if (op === 'cot_estado') return F.cotEstado(datos);
  if (op === 'cot_lista') return F.cotLista();
  if (op === 'cot_registrar') { const r = await F.cotRegistrar(datos, await marcaDe(idem), subidor(idem)); olvidarTodo(); return r; }
  // v0.67.0 · comprobante de pago de Previred en un mes ya cargado, y quitarlo
  if (op === 'cot_comprobante') { const r = await F.cotComprobante(datos, await marcaDe(idem), subidor(idem)); olvidarTodo(); return r; }
  if (op === 'cot_quitar_comprobante') { const r = await F.cotQuitarComprobante(datos); olvidarTodo(); return r; }
  if (op === 'cot_quitar_dif') { const r = await F.cotQuitarDifMultas(datos); olvidarTodo(); return r; }   // v0.67.3
  if (op === 'cot_reparto') { const r = await F.cotCambiarReparto(datos, await marcaDe(idem)); olvidarTodo(); return r; }   // v0.67.5
  throw new Error('Operación desconocida');
}
