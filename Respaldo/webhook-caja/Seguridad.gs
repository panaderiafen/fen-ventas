// ═══════════════════════════════════════════════════════════
//  fën caja — Apps Script · Seguridad.gs  v2.0.0  (2026-10-02)
//  Script: caja / merma / anulaciones
//
//  Archivo NUEVO: va en el mismo proyecto de Apps Script que Code.gs.
//  Recibe las llamadas de la caja (doPost) y, antes de hacer nada, revisa
//  que vengan de alguien con sesión abierta en la caja (Firebase):
//
//   · La caja envía su "token de sesión" de Firebase en cada llamada.
//   · Este script se lo muestra a Firestore (el mismo de la caja): si
//     Firestore lo acepta, la sesión es real. Así no hace falta ninguna
//     clave nueva ni configurar nada.
//   · Además revisa el rol: registrar merma es solo de administradores (como en la caja); exportar el cierre y avisar una anulación lo puede hacer cualquier cajera con sesión.
//   · El visor de stock no puede escribir nada.
//   · Cada envío lleva una clave única (idem) y se hace con bloqueo:
//     aunque llegue dos veces, se guarda una.
//
//  Sin configuración: no necesita propiedades del script.
// ═══════════════════════════════════════════════════════════

const SEGF_VERSION = '2.1.0';
const SEGF_PROYECTO = 'fen-ventas';          // proyecto Firebase de la caja (no es secreto)
const SEGF_SOLO_ADMIN = ['merma'];       // "tipo" de envío que solo puede hacer un admin
const SEGF_TIPO_DEFECTO = 'exportar_caja';

function doPost(e) {
  let p;
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return segfSalida({ ok: false, error: 'Solicitud inválida', code: 'formato' }); }
  return segfSalida(segfDespachar(p));
}

function doGet(e) {
  const prm = (e && e.parameter) || {};
  if (prm.action === 'ping') return segfSalida({ ok: true, version: SEGF_VERSION });
  if (prm.p) {
    let p;
    try { p = JSON.parse(prm.p); } catch (err) { return segfSalida({ ok: false, error: 'Solicitud inválida', code: 'formato' }); }
    return segfSalida(segfDespachar(p));
  }
  return segfSalida({ ok: false, error: 'Solicitud sin datos: la caja reintentará.', code: 'version' });
}

function segfSalida(d) {
  return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);
}

function segfDespachar(p) {
  try {
    const quien = segfVerificar(p.idToken);
    if (!quien) return { ok: false, code: 'sesion', error: 'La sesión de la caja no es válida o venció. Vuelve a entrar a la caja.' };
    const tipo = String(p.tipo || SEGF_TIPO_DEFECTO);
    if (quien.visor && !quien.admin) return { ok: false, code: 'permiso', error: 'El visor de stock no puede enviar datos.' };
    if (SEGF_SOLO_ADMIN.indexOf(tipo) >= 0 && !quien.admin) return { ok: false, code: 'permiso', error: 'Solo un administrador puede hacer esto.' };

    const datos = Object.assign({}, p);
    delete datos.idToken; delete datos.idem;
    if (typeof segfAjustar === 'function') segfAjustar(tipo, datos, quien);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return { ok: false, code: 'ocupado', error: 'Otra ejecución está en curso, intenta de nuevo en unos segundos.' };
    try {
      const idem = typeof p.idem === 'string' && /^[a-z0-9-]{8,64}$/i.test(p.idem)
        ? 'idem_' + segfSha(quien.uid + '|' + tipo + '|' + p.idem).slice(0, 32) : null;
      const previo = idem ? CacheService.getScriptCache().get(idem) : null;
      if (previo) return JSON.parse(previo);
      const r = ejecutarAccionLegada(datos);
      // v2.1.0: solo se recuerda un resultado exitoso; si falló, un reintento con la misma clave vuelve a ejecutarse.
      if (idem && r && r.ok === true) { try { CacheService.getScriptCache().put(idem, JSON.stringify(r), 21600); } catch (e) {} }
      return r;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function segfSha(t) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t), Utilities.Charset.UTF_8);
  return b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// Lee el contenido del token (sin confiar todavía en él).
function segfLeerToken(token) {
  const partes = String(token).split('.');
  if (partes.length !== 3) return null;
  let b = partes[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  try { return JSON.parse(Utilities.newBlob(Utilities.base64Decode(b)).getDataAsString()); } catch (e) { return null; }
}

// Firestore valida la firma y el vencimiento del token. Las reglas de la caja
// dejan que cada usuario lea SOLO su propio documento en admins/ y
// stock_viewers/: si el token es de otra persona o es falso, Firestore lo
// rechaza (401/403); si es real, responde 200 (existe) o 404 (no existe).
function segfDoc(coleccion, uid, token) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + SEGF_PROYECTO + '/databases/(default)/documents/' + coleccion + '/' + encodeURIComponent(uid);
  return UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }).getResponseCode();
}

function segfVerificar(token) {
  if (!token || typeof token !== 'string' || token.length < 100) return null;
  const c = segfLeerToken(token);
  if (!c || c.aud !== SEGF_PROYECTO || !c.user_id || !(c.exp * 1000 > Date.now())) return null;
  const clave = 'fb_' + segfSha(token).slice(0, 40);
  const guardado = CacheService.getScriptCache().get(clave);
  if (guardado) return JSON.parse(guardado);
  const a = segfDoc('admins', c.user_id, token);
  if (a !== 200 && a !== 404) return null;
  const quien = { uid: c.user_id, email: String(c.email || ''), admin: a === 200, visor: false };
  if (!quien.admin) {
    const v = segfDoc('stock_viewers', c.user_id, token);
    if (v !== 200 && v !== 404) return null;
    quien.visor = v === 200;
  }
  const seg = Math.max(30, Math.min(300, Math.floor(c.exp - Date.now() / 1000)));
  try { CacheService.getScriptCache().put(clave, JSON.stringify(quien), seg); } catch (e) {}
  return quien;
}

// Ejecutar desde el editor (Ejecutar ▸ instalarSeguridad): pide el permiso
// para conectarse a Firestore y confirma la versión.
function instalarSeguridad() {
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + SEGF_PROYECTO + '/databases/(default)/documents/admins/prueba', { muteHttpExceptions: true }).getResponseCode();
  Logger.log('Conexión con Firestore: ' + (r === 401 || r === 403 ? 'OK (sin sesión, rechaza como corresponde)' : 'respuesta ' + r));
  Logger.log('Seguridad de caja / merma / anulaciones v' + SEGF_VERSION + ' lista.');
  return { ok: r === 401 || r === 403, codigo: r };
}

// La solicitud de anulación queda firmada con el correo real de la sesión.
function segfAjustar(tipo, datos, quien) {
  if (tipo === 'solicitud_anulacion') datos.solicitante = quien.email;
}

