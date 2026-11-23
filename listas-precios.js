// ═══════════════════════════════════════════════
//  Sistema Fën — Listas de precios: lecturas y escrituras  v0.80.2
//  v0.80.2: cat_fotos/{id}.encuadre = { x, y, zoom } (cómo se ve la foto en la tarjeta; se cambia sin volver a subirla)
//  · fen-gastos cat_fotos/{PR####} = { foto, mini (data URL JPEG), ancho, alto, bytes, miniBytes, actualizadoEn, actualizadoPor, historial }
//    (colección aparte: leer el catálogo no trae imágenes). El producto guarda solo la marca cat_productos/{id}.foto = { en, ancho, alto } | null.
//  · fen-b2b config/listasPrecios = { condiciones (con contacto), portada (data URL) | null, portadaAncho, portadaAlto, portadaBytes, en, por, historial }
//  · fen-b2b listas_precios/{auto} = { cliente { id|null, nombre }, fecha, vigenciaDias, vigenciaHasta, items [...], n, condiciones,
//    por, en, editadoEn/Por, enviadaEn, envios [...], aplicada { en, por, n } | null, duplicadaDe, historial }
//  Lecturas (Spark): las fotos SOLO al armar o ver una lista: 1 por producto marcado que tiene foto, y quedan en memoria de la
//  sesión. Las listas guardadas: 1 consulta (las últimas 60) y config/listasPrecios: 1, una vez por sesión. Clientes y productos
//  de B2B: los de la escucha de siempre (0). El catálogo: la memoria de Gastos y Finanzas.
//  Nada se borra: quitar una foto deja foto/mini en null con su historial.
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';
import * as FB from './firebase-b2b.js?v=0.138.0';
import * as B from './b2b.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FBG from './fs-gastos.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';

const yo = () => (auth.currentUser && auth.currentUser.email) || '';
const ahora = () => new Date().toISOString();
export const hoyTxt = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const conHist = (h, x, max = 20) => [...(Array.isArray(h) ? h : []), x].slice(-max);
// Lecturas y escrituras de esta sesión (las muestra la pantalla y las mide la prueba)
export const uso = { b2b: 0, gastos: 0, escrituras: 0, fotos: 0 };

async function dbB() { const cx = await B.conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base nueva de B2B (Ventas a empresas).'); return cx.db; }
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Las fotos se guardan en la base de Gastos y Finanzas (fen-gastos): conéctala en Gastos → Configuración → Base nueva.'); return cx.db; }
const errPermiso = e => /permission/i.test(String((e && (e.code || e.message)) || ''));
const textoPermiso = 'La base de B2B no dejó guardar las listas de precios: falta publicar las reglas de fen-b2b v1.8.0 (ver README, Instalación v0.80.0).';

// ═══════════════ Fotos de los productos (fen-gastos cat_fotos) ═══════════════
const fotos = new Map();   // id → { foto, mini, ancho, alto } | null (sin foto)
export const fotoEnMemoria = id => fotos.get(id);
const fotosLeyendo = new Map();
export function leerFoto(id) {
  if (fotos.has(id)) return Promise.resolve(fotos.get(id));
  if (!fotosLeyendo.has(id)) fotosLeyendo.set(id, leerFotoBase(id).finally(() => fotosLeyendo.delete(id)));
  return fotosLeyendo.get(id);
}
async function leerFotoBase(id) {
  const db = await dbG(), sn = await FBG.getDoc(FBG.doc(db, 'cat_fotos', id));
  uso.gastos++; uso.fotos++;
  const d = sn.exists() ? sn.data() : null;
  const v = d && d.foto ? { foto: d.foto, mini: d.mini || d.foto, ancho: d.ancho || 0, alto: d.alto || 0, encuadre: LM.encuadre(d.encuadre) } : null;
  fotos.set(id, v);
  return v;
}
// Las fotos de los productos marcados que tienen foto (en paralelo; las que ya están en memoria no se leen)
export async function leerFotos(items) {
  const ids = [...new Set((items || []).filter(x => x.conFoto !== false && x.catalogoId).map(x => x.catalogoId))];
  await Promise.all(ids.map(id => leerFoto(id).catch(() => null)));
  return Object.fromEntries(ids.map(id => [id, fotos.get(id) || null]));
}
// Subir, cambiar (datos = lo de imagenes.fotoProducto) o quitar (datos = null). 1 transacción: lee el producto y su foto, escribe los dos.
export async function guardarFoto(id, datos, enc = null) {
  const db = await dbG(), por = yo(), en = ahora();
  const rp = FBG.doc(db, 'cat_productos', id), rf = FBG.doc(db, 'cat_fotos', id);
  if (datos && (LM.bytesDataUrl(datos.foto) > LM.FOTO.bytes || LM.bytesDataUrl(datos.mini) > LM.FOTO.miniBytes)) throw new Error('La foto pesa más de lo permitido.');
  const r = await FBG.runTransaction(db, async tx => {
    const sp = await tx.get(rp), sf = await tx.get(rf);
    if (!sp.exists()) throw new Error('Ese producto ya no está en el catálogo.');
    const p = sp.data(), f = sf.exists() ? sf.data() : {};
    const habia = !!f.foto, accion = datos ? (habia ? 'cambió la foto' : 'subió la foto') : 'quitó la foto';
    if (!datos && !habia) return { p: { ...p, id }, accion: '' };
    const marca = datos ? { en, ancho: datos.ancho, alto: datos.alto } : null;
    tx.set(rf, { foto: datos ? datos.foto : null, mini: datos ? datos.mini : null, ancho: datos ? datos.ancho : null, alto: datos ? datos.alto : null, bytes: datos ? datos.bytes : null, miniBytes: datos ? datos.miniBytes : null, encuadre: datos ? LM.encuadre(enc) : null,
      catalogoId: id, actualizadoEn: en, actualizadoPor: por, historial: conHist(f.historial, { accion, en, por, ...(datos ? { ancho: datos.ancho, alto: datos.alto, bytes: datos.bytes } : {}) }) });
    const cambio = { foto: marca, editadoEn: en, editadoPor: por, historial: conHist(p.historial, { accion: 'foto', por, en, nota: accion }, 40) };
    tx.update(rp, cambio);
    return { p: { ...p, ...cambio, id }, accion };
  });
  uso.gastos += 2; uso.escrituras += 2;
  fotos.set(id, datos ? { foto: datos.foto, mini: datos.mini, ancho: datos.ancho, alto: datos.alto, encuadre: LM.encuadre(enc) } : null);
  return r;
}
// v0.80.2 · Mover o acercar la foto en la tarjeta (sin subirla de nuevo): 1 escritura en cat_fotos/{id}.encuadre
export async function guardarEncuadre(id, enc) {
  const db = await dbG(), e = LM.encuadre(enc);
  await FBG.updateDoc(FBG.doc(db, 'cat_fotos', id), { encuadre: e, encuadreEn: ahora(), encuadrePor: yo() });
  uso.escrituras++;
  const f = fotos.get(id); if (f) fotos.set(id, { ...f, encuadre: e });
  return e;
}

// ═══════════════ Configuración: portada, condiciones y contacto (fen-b2b config/listasPrecios) ═══════════════
let cfgMem = null, cfgLeyendo = null;
export function leerConfig(forzar = false) {
  if (cfgMem && !forzar) return Promise.resolve(cfgMem);
  if (!cfgLeyendo) cfgLeyendo = leerConfigBase().finally(() => { cfgLeyendo = null; });
  return cfgLeyendo;
}
async function leerConfigBase() {
  const db = await dbB(), sn = await FB.getDoc(FB.doc(db, 'config', 'listasPrecios'));
  uso.b2b++;
  const d = sn.exists() ? sn.data() : {}, base = LM.condicionesPorDefecto((window.FEN_SIS || {}).DATOS_EMPRESA || {});
  let condiciones; try { condiciones = LM.normalizarCondiciones(d.condiciones || base, base); } catch (e) { condiciones = base; }
  cfgMem = { condiciones, portada: d.portada || null, portadaAncho: d.portadaAncho || 0, portadaAlto: d.portadaAlto || 0, portadaBytes: d.portadaBytes || 0, en: d.en || '', por: d.por || '', existe: sn.exists() };
  return cfgMem;
}
// cambios: { condiciones?, portada? (lo de imagenes.portada) | portada: null (quitarla) }
export async function guardarConfig(cambios) {
  const db = await dbB(), por = yo(), en = ahora(), ref = FB.doc(db, 'config', 'listasPrecios');
  const actual = await leerConfig();
  const d = { en, por };
  const hist = [];
  if (cambios.condiciones) { d.condiciones = LM.normalizarCondiciones(cambios.condiciones, actual.condiciones); hist.push('condiciones y contacto'); }
  if ('portada' in cambios) {
    const p = cambios.portada;
    if (p && LM.bytesDataUrl(p.portada) > LM.PORTADA.bytes) throw new Error('La portada pesa más de lo permitido.');
    Object.assign(d, { portada: p ? p.portada : null, portadaAncho: p ? p.ancho : 0, portadaAlto: p ? p.alto : 0, portadaBytes: p ? p.bytes : 0 });
    hist.push(p ? 'portada' : 'quitó la portada');
  }
  try {
    await FB.runTransaction(db, async tx => {
      const sn = await tx.get(ref), a = sn.exists() ? sn.data() : {};
      tx.set(ref, { ...a, ...d, historial: conHist(a.historial, { en, por, que: hist.join(' · ') }) });
    });
  } catch (e) { throw errPermiso(e) ? new Error(textoPermiso) : e; }
  B.uso.lecturas++; B.uso.escrituras++; uso.b2b++; uso.escrituras++;
  cfgMem = { ...actual, ...d, existe: true };
  if (d.condiciones) cfgMem.condiciones = d.condiciones;
  return cfgMem;
}

// ═══════════════ Listas guardadas (fen-b2b listas_precios) ═══════════════
let listasMem = null, listasLeyendo = null;
export const LIMITE_LISTAS = 60;
export function leerListas(forzar = false) {
  if (listasMem && !forzar) return Promise.resolve(listasMem);
  if (!listasLeyendo) listasLeyendo = leerListasBase().finally(() => { listasLeyendo = null; });
  return listasLeyendo;
}
async function leerListasBase() {
  const db = await dbB();
  let sn;
  try { sn = await FB.getDocs(FB.query(FB.collection(db, 'listas_precios'), FB.orderBy('en', 'desc'), FB.limit(LIMITE_LISTAS))); }
  catch (e) { if (errPermiso(e)) { const x = new Error('Para guardar y ver las listas de precios falta publicar las reglas de fen-b2b v1.8.0 (ver README, Instalación v0.80.0).'); x.code = 'sin_reglas'; throw x; } throw e; }
  uso.b2b += Math.max(1, sn.size); B.uso.lecturas += Math.max(1, sn.size);
  listasMem = sn.docs.map(d => ({ ...d.data(), id: d.id }));
  return listasMem;
}
const ponerEnMemoria = l => { if (!listasMem) return; const i = listasMem.findIndex(x => x.id === l.id); if (i >= 0) listasMem[i] = l; else listasMem.unshift(l); };
export const listaEnMemoria = id => (listasMem || []).find(x => x.id === id) || null;
// Guardar una lista nueva (id null) o cambiar una guardada (que todavía no se aplicó). editor → LM.armarLista
export async function guardarLista(editor, id = null) {
  const db = await dbB(), por = yo(), en = ahora();
  const doc = LM.armarLista(editor);
  try {
    if (!id) {
      const ref = FB.doc(FB.collection(db, 'listas_precios'));
      const nuevo = { ...doc, por, en, enviadaEn: null, envios: [], aplicada: null, duplicadaDe: editor.duplicadaDe || null, historial: [{ accion: editor.duplicadaDe ? 'duplicada' : 'creada', en, por }] };
      await FB.setDoc(ref, nuevo);
      uso.escrituras++; B.uso.escrituras++;
      const l = { ...nuevo, id: ref.id }; ponerEnMemoria(l); return l;
    }
    const ref = FB.doc(db, 'listas_precios', id);
    const l = await FB.runTransaction(db, async tx => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Esa lista ya no está.');
      const a = sn.data();
      if (a.aplicada && a.aplicada.en) throw new Error('Esta lista ya se aplicó como precios especiales: para cambiarla, usa Duplicar.');
      const d = { ...doc, editadoEn: en, editadoPor: por, historial: conHist(a.historial, { accion: 'cambiada', en, por }) };
      tx.update(ref, d);
      return { ...a, ...d, id };
    });
    uso.b2b++; uso.escrituras++; B.uso.lecturas++; B.uso.escrituras++;
    ponerEnMemoria(l); return l;
  } catch (e) { throw errPermiso(e) ? new Error(textoPermiso) : e; }
}
// Enviada (por WhatsApp o descargada para enviar): 1 escritura
export async function marcarEnviada(lista, como) {
  const db = await dbB(), por = yo(), en = ahora(), ref = FB.doc(db, 'listas_precios', lista.id);
  const d = { enviadaEn: lista.enviadaEn || en, envios: [...(lista.envios || []), { en, por, como }].slice(-20) };
  await FB.updateDoc(ref, d);
  uso.escrituras++; B.uso.escrituras++;
  const l = { ...lista, ...d }; ponerEnMemoria(l); return l;
}
// Usar como precios especiales: 1 transacción (lee el cliente y la lista; escribe los dos). cambios = LM.diffEspeciales(...)
// Solo cambia los productos de la lista con precio distinto del base; nada se borra; cada cambio queda en historialPrecios.
export async function aplicarComoEspeciales(lista, cambios) {
  const db = await dbB(), por = yo(), en = ahora(), enTxt = en.slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5);
  if (!lista.cliente || !lista.cliente.id) throw new Error('Esta lista es para un cliente nuevo: primero créalo en Ventas a empresas → Clientes y duplica la lista para él.');
  if (!(cambios || []).length) throw new Error('No hay nada que cambiar: los precios de la lista son el base o ya son sus precios especiales.');
  const rc = FB.doc(db, 'clientes', lista.cliente.id), rl = FB.doc(db, 'listas_precios', lista.id);
  const r = await FB.runTransaction(db, async tx => {
    const sc = await tx.get(rc), sl = await tx.get(rl);
    if (!sc.exists()) throw new Error('El cliente ya no existe.');
    if (!sl.exists()) throw new Error('Esa lista ya no está.');
    const l = sl.data();
    if (l.aplicada && l.aplicada.en) throw new Error('Esta lista ya se aplicó.');
    const c = sc.data();
    const x = LM.aplicarEspeciales(c.precios, c.historialPrecios, cambios, { por, en: enTxt, listaId: lista.id });
    tx.update(rc, { precios: x.precios, historialPrecios: x.historialPrecios, planillaPendiente: false, cambiadoEn: FB.serverTimestamp(), cambiadoPor: por });
    const ap = { en, por, n: x.n };
    tx.update(rl, { aplicada: ap, historial: conHist(l.historial, { accion: 'aplicada como precios especiales', en, por, n: x.n }) });
    return { n: x.n, aplicada: ap, lista: { ...l, aplicada: ap, id: lista.id } };
  });
  uso.b2b += 2; uso.escrituras += 2; B.uso.lecturas += 2; B.uso.escrituras += 2;
  ponerEnMemoria(r.lista);
  return r;
}
export function olvidar() { listasMem = null; cfgMem = null; fotos.clear(); }
