// ═══════════════════════════════════════════════
//  Sistema Fën — lectura de pendientes de las otras apps  v0.6.0
//  Gastos, Ventas B2B y Producción tienen su propio Apps Script. Desde su
//  versión 2.1.0 / 2.1.0 / 2.2.0 traen SistemaFen.gs, que responde un resumen de
//  pendientes (solo lectura) a la cuenta de administración de Sistema Fën.
//  Las direcciones de los scripts vienen de config.js y se pueden cambiar en
//  Configuración → Conexiones (se guardan en Firestore, config/sistemaFen).
// ═══════════════════════════════════════════════
import { auth, db, doc, getDoc, runTransaction } from './firebase.js?v=0.138.0';

const F = window.FEN_SIS;
export const APPS = [
  { id: 'gastos', nombre: 'Gastos', minima: '2.1.0', completa: '2.5.0' },   // completa: la que piden los módulos de Sistema Fën (Gastos y cargas del SII)
  { id: 'b2b', nombre: 'Ventas B2B', minima: '2.1.0' },
  { id: 'produccion', nombre: 'Producción', minima: '2.2.0' }
];
export const URL_VALIDA = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export async function leerConexiones() {
  let guardadas = {};
  try { const sn = await getDoc(doc(db, 'config', 'sistemaFen')); if (sn.exists()) guardadas = sn.data().urls || {}; } catch (e) {}
  const r = {};
  APPS.forEach(a => { r[a.id] = guardadas[a.id] || (F.SCRIPTS || {})[a.id] || ''; });
  return r;
}
export async function guardarConexion(app, url) {
  const u = String(url || '').trim();
  if (u && !URL_VALIDA.test(u)) throw new Error('La dirección debe ser la de una implementación de Apps Script: https://script.google.com/macros/s/…/exec');
  const ref = doc(db, 'config', 'sistemaFen');
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    const d = sn.exists() ? sn.data() : {};
    tx.set(ref, { ...d, urls: { ...(d.urls || {}), [app]: u } });
  });
}

const conTiempo = (promesa, ms) => Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error('No respondió a tiempo')), ms))]);
export const mayorIgual = (v, m) => { const a = String(v || '0').split('.').map(Number), b = m.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; } return true; };

// Versión del script (ping): para saber si ya trae SistemaFen.gs
export async function probar(app, url, minima) {
  const a = { ...APPS.find(x => x.id === app) }; if (minima) a.minima = minima;
  const r = await conTiempo(fetch(url + '?action=ping').then(x => x.json()), 20000);
  if (!r || !r.version) return { ok: false, texto: 'Responde, pero no es la implementación con Seguridad' };
  return mayorIgual(r.version, a.minima) ? { ok: true, version: r.version, texto: `v${r.version} · lista` } : { ok: false, version: r.version, texto: `v${r.version} · falta actualizar a v${a.minima}` };
}

// Resumen de pendientes. estado: ok | sin_url | actualizar | error
// Antes de pedir el resumen se pregunta la versión del script (una vez por sesión si está al día):
// a un script antiguo nunca se le manda la acción nueva.
const versionOk = new Set();
export async function leerPendientes(app, url) {
  if (!url) return { estado: 'sin_url' };
  try {
    if (!versionOk.has(url)) {
      const v = await probar(app, url);
      if (!v.ok) return v.version ? { estado: 'actualizar', version: v.version } : { estado: 'error', error: v.texto };
      versionOk.add(url);
    }
    const cuerpo = JSON.stringify({ action: 'sistema_fen_pendientes', accion: 'sistema_fen_pendientes', idToken: await auth.currentUser.getIdToken() });
    let r = await conTiempo(fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo }).then(x => x.json()), 30000);
    if (r && r.code === 'version') r = await conTiempo(fetch(url + '?p=' + encodeURIComponent(cuerpo)).then(x => x.json()), 30000);
    if (r && r.ok && Array.isArray(r.pendientes)) return { estado: 'ok', pendientes: r.pendientes, leido: r.leido };
    const msg = String((r && (r.error || r.msg)) || '');
    // Un script sin SistemaFen.gs no conoce la acción: la trata como una acción con sesión propia de la app
    if (r && !/Sistema Fën/.test(msg) && (r.code === 'sesion' || /no reconocida|Acción desconocida/i.test(msg))) return { estado: 'actualizar' };
    return { estado: 'error', error: msg || 'Respuesta inesperada' };
  } catch (e) {
    return { estado: 'error', error: e.message || String(e) };
  }
}
