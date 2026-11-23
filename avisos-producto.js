// ═══════════════════════════════════════════════
//  Sistema Fën — Aviso de producto nuevo: lecturas y escrituras  v0.138.0
//  En fen-gastos (las reglas ya dejan a la administración leer y escribir cualquier colección: no cambia ninguna regla):
//  · avisos_producto/{id}: el aviso, sin imágenes (aviso-producto-modelo.js).
//  · avisos_fotos/{id} = { principal (data URL | null), rellenos [data URL], en, por }: la foto propia y las de los rellenos,
//    achicadas en el equipo (≤ 900 px, ≤ 90 KB cada una: 4 fotos ≈ 360 KB, bajo el máximo de 1 MB de un documento).
//  Lecturas: los avisos, 1 consulta (los últimos 40), una vez por sesión; las fotos, 1 por aviso al abrirlo. Nada se borra.
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FBG from './fs-gastos.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';

const yo = () => (auth.currentUser && auth.currentUser.email) || '';
const ahora = () => new Date().toISOString();
const conHist = (h, x, max = 20) => [...(Array.isArray(h) ? h : []), x].slice(-max);
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Los avisos se guardan en la base de Gastos y Finanzas (fen-gastos): conéctela en Gastos → Configuración → Base nueva.'); return cx.db; }

export const LIMITE = 40;
let mem = null;
const fotosMem = new Map();
export function leerAvisos(forzar = false) { if (forzar) mem = null; if (!mem) mem = leerBase().catch(e => { mem = null; throw e; }); return mem; }
async function leerBase() {
  const db = await dbG();
  const sn = await FBG.getDocs(FBG.query(FBG.collection(db, 'avisos_producto'), FBG.orderBy('en', 'desc'), FBG.limit(LIMITE)));
  return sn.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function avisoDe(id) { const l = await leerAvisos(); return l.find(x => x.id === id) || null; }
export async function leerFotos(id) {
  if (fotosMem.has(id)) return fotosMem.get(id);
  const db = await dbG(), sn = await FBG.getDoc(FBG.doc(db, 'avisos_fotos', id));
  const d = sn.exists() ? sn.data() : {}, v = { principal: d.principal || null, rellenos: Array.isArray(d.rellenos) ? d.rellenos : [] };
  fotosMem.set(id, v);
  return v;
}
// doc: el de armarAviso · fotos: { principal: data URL | null, rellenos: [data URL] } (las que ya estaban van tal cual)
export async function guardarAviso(doc, fotos, id = null) {
  const db = await dbG(), por = yo(), en = ahora();
  [fotos.principal, ...(fotos.rellenos || [])].filter(Boolean).forEach(u => { if (LM.bytesDataUrl(u) > LM.FOTO.bytes * 1.2) throw new Error('Una foto pesa más de lo permitido: súbala de nuevo.'); });
  const nid = id || 'av_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref = FBG.doc(db, 'avisos_producto', nid);
  const b = FBG.writeBatch(db);
  if (id) {
    const ant = (await avisoDe(id)) || {};
    b.set(ref, { ...doc, por: ant.por || por, en: ant.en || en, editadoEn: en, editadoPor: por, enviadoEn: ant.enviadoEn || null, envios: ant.envios || [], historial: conHist(ant.historial, { accion: 'cambio', por, en }) });
  } else b.set(ref, { ...doc, por, en, enviadoEn: null, envios: [], historial: [{ accion: 'creado', por, en }] });
  b.set(FBG.doc(db, 'avisos_fotos', nid), { principal: fotos.principal || null, rellenos: (fotos.rellenos || []).slice(0, 3), por, en });
  await b.commit();
  fotosMem.set(nid, { principal: fotos.principal || null, rellenos: (fotos.rellenos || []).slice(0, 3) });
  mem = null;
  return nid;
}
export async function marcarEnviado(a, como) {
  const db = await dbG(), por = yo(), en = ahora(), envios = [...(a.envios || []), { como, por, en }].slice(-20);
  await FBG.updateDoc(FBG.doc(db, 'avisos_producto', a.id), { enviadoEn: a.enviadoEn || en, envios });
  mem = null;
  return { ...a, enviadoEn: a.enviadoEn || en, envios };
}
export function olvidar() { mem = null; fotosMem.clear(); }
