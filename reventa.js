// ═══════════════════════════════════════════════
//  Sistema Fën — Catálogo · Reventa (datos)  v0.73.0
//  cat_reventa/{id} en fen-gastos (solo administración; las reglas v0.1.0 ya cubren colecciones nuevas). Reglas en reventa-modelo.js.
//  cat_config/reventa = { importadoEn, importadoPor, n } cuando se trajo la reventa de la planilla (una sola vez).
//  Lecturas: la colección entera una vez (queda en la memoria de fs-gastos.js: después solo lo que cambió) + 1 de cat_config.
//  "Traer reventa de la planilla" lee la lista publicada (CSV, no cuesta lecturas de Firestore) y los vínculos de Finanzas (memoria).
//  Escrituras: 1 por reventa creada, cambiada, archivada o reactivada (+1 de cat_config al importar).
// ═══════════════════════════════════════════════
import { auth } from './firebase.js?v=0.138.0';
import * as GB from './gastos-base.js?v=0.138.0';
import * as FB from './fs-gastos.js?v=0.138.0';
import * as RV from './reventa-modelo.js?v=0.138.0';

const yo = () => (auth.currentUser && auth.currentUser.email) || '';
async function dbG() { const cx = await GB.conexion(); if (cx.estado !== 'ok') throw new Error('Primero conecta la base de Gastos y Finanzas (Gastos → Configuración → Base nueva): la reventa se guarda ahí.'); return cx.db; }
export async function conectada() { try { return (await GB.conexion()).estado === 'ok'; } catch (e) { return false; } }

export async function leer() {
  const db = await dbG();
  const [sn, meta] = await Promise.all([FB.getDocs(FB.collection(db, 'cat_reventa')), FB.getDoc(FB.doc(db, 'cat_config', 'reventa')).catch(() => null)]);
  const lista = sn.docs.map(d => ({ ...d.data(), id: d.id }));
  return { lista, meta: meta && meta.exists() ? meta.data() : null };
}
// Crear (id = null) o cambiar. datos: { nombre, costoNeto, conIva, unidad, rut, razon }. → el documento guardado
export async function guardar(id, datos, lista) {
  const db = await dbG(), por = yo(), en = new Date().toISOString();
  const v = RV.validar(datos, lista, id || '');
  if (id) {
    const ref = FB.doc(db, 'cat_reventa', id);
    return FB.runTransaction(db, async tx => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Esa reventa ya no está. Toca Actualizar.');
      const a = sn.data(), cambios = RV.cambiosDe(a, v);
      if (!Object.keys(cambios).length) return { ...a, id };
      const d = { ...v, editadoEn: en, editadoPor: por, historial: RV.conHistorial(a.historial, { accion: 'cambio', por, en, cambios }) };
      tx.update(ref, d);
      return { ...a, ...d, id };
    });
  }
  const saltar = [];
  for (let k = 0; k < 20; k++) {
    const nid = RV.siguienteId(lista, saltar), ref = FB.doc(db, 'cat_reventa', nid);
    try {
      return await FB.runTransaction(db, async tx => {
        const sn = await tx.get(ref); if (sn.exists()) { const e = new Error('ocupado'); e.code = 'id-ocupado'; throw e; }
        const d = { id: nid, ...v, estado: 'activo', origen: 'manual', creadoEn: en, creadoPor: por, historial: [{ accion: 'nuevo', por, en }] };
        tx.set(ref, d);
        return d;
      });
    } catch (e) { if (e.code !== 'id-ocupado') throw e; saltar.push(nid); }
  }
  throw new Error('No se pudo elegir un ID libre. Toca Actualizar y vuelve a intentar.');
}
export async function archivar(id, archivar = true) {
  const db = await dbG(), por = yo(), en = new Date().toISOString(), ref = FB.doc(db, 'cat_reventa', id);
  return FB.runTransaction(db, async tx => {
    const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Esa reventa ya no está. Toca Actualizar.');
    const a = sn.data(), estado = archivar ? 'archivado' : 'activo';
    if ((a.estado || 'activo') === estado) return { ...a, id };
    const d = { estado, [archivar ? 'archivadoEn' : 'reactivadoEn']: en, [archivar ? 'archivadoPor' : 'reactivadoPor']: por, historial: RV.conHistorial(a.historial, { accion: archivar ? 'archivado' : 'reactivado', por, en }) };
    tx.update(ref, d);
    return { ...a, ...d, id };
  });
}
// "Traer reventa de la planilla": lo que hay en la lista publicada con código de área REV, con su costo si un vínculo de Finanzas lo tiene
export async function prepararImportacion(lista) {
  const [Aj, F] = await Promise.all([import('./ajustes.js?v=0.138.0'), import('./finanzas.js?v=0.138.0')]);
  let filas;
  try { filas = await Aj.leerRecetasProduccion(); } catch (e) { throw new Error('No se pudo leer la lista publicada de la planilla (' + (e.message || e) + '). Revisa internet y vuelve a intentar.'); }
  const [vinc, cat] = await Promise.all([F.leerVinculos().catch(() => ({})), F.catalogosVenta().catch(() => ({ caja: {}, b2b: {} }))]);
  return RV.candidatosPlanilla(filas, vinc, cat, lista);
}
// items: [{ id, nombre, costoNeto, unidad }] revisados por el dueño. Conserva los ID de la planilla. Un solo lote.
export async function importar(items, lista) {
  const db = await dbG(), por = yo(), en = new Date().toISOString();
  const ya = new Set((lista || []).map(x => x.id)), hechos = [];
  const b = FB.writeBatch(db);
  (items || []).forEach(x => {
    if (!RV.ID_RE.test(x.id) || ya.has(x.id)) return;
    const v = RV.validar({ nombre: x.nombre, costoNeto: x.costoNeto, unidad: x.unidad || 'un' }, [...(lista || []), ...hechos], x.id);
    const d = { id: x.id, ...v, estado: 'activo', origen: 'planilla', creadoEn: en, creadoPor: por, historial: [{ accion: 'traida de la planilla', por, en }] };
    b.set(FB.doc(db, 'cat_reventa', x.id), d); hechos.push(d);
  });
  b.set(FB.doc(db, 'cat_config', 'reventa'), { importadoEn: en, importadoPor: por, n: hechos.length });
  await b.commit();
  return hechos;
}
