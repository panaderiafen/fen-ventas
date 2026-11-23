// ═══════════════════════════════════════════════
//  Sistema Fën — El PDF de cada factura B2B en Drive  v0.113.0
//  Al asignar el folio que trae el favorito "Llenar factura Fën" desde la página del SII, el PDF de la factura:
//   · se guarda en Drive con el script de Gastos (archivo_subir tipo "factura": "Fën · Gastos / Facturas B2B / año", privado);
//   · se descarga al computador con el mismo nombre, para adjuntarlo en WhatsApp: "3525 - Nombre del local.pdf".
//  El enlace queda en fen-gastos (facturas_b2b/{folio}); "Ver factura" lo lee (1 lectura) y abre el PDF en otra pestaña.
// ═══════════════════════════════════════════════
import * as Gastos from './gastos.js?v=0.138.0';
// fs-gastos.js (Firebase de Gastos) se carga recién al guardar o al ver una factura, no al abrir la app
const fsG = () => import('./fs-gastos.js?v=0.138.0');

export const MAX_PDF = 8 * 1024 * 1024;
// Sin tildes ni ñ (algunos navegadores descartan el nombre de la descarga si las lleva) y sin caracteres que no aceptan las carpetas
const limpio = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
// "3525 - Cafe Ficticio.pdf" (el nombre del local, como se ve en las órdenes; no la razón social)
export const nombreArchivo = (folio, local) => `${String(folio).trim()} - ${limpio(local) || 'factura'}.pdf`;
export async function esPdf(blob) {
  if (!blob || !blob.size) return false;
  const b = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...b) === '%PDF-';
}
// Descarga al computador con su nombre (sin abrirlo)
export function descargar(blob, nombre) {
  // Copia local del archivo (el que llega desde la pestaña del SII es de otro sitio: así el navegador respeta el nombre)
  const u = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), a = document.createElement('a');
  a.href = u; a.download = nombre;
  // Dentro del diálogo abierto si lo hay (fuera de un diálogo modal la página queda inerte y el nombre se pierde)
  (document.querySelector('dialog[open]') || document.body).appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
const base64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('No se pudo leer el PDF.')); r.readAsDataURL(blob); });
const db = async () => (await import('./gastos-base.js?v=0.138.0')).dbBase();

// Guarda el PDF en Drive y su enlace en facturas_b2b/{folio}. → { url, nombre }
export async function guardarEnDrive({ folio, local, clienteId = '', ordenes = [], fecha = '', blob }) {
  if (!/^\d{1,12}$/.test(String(folio || ''))) throw new Error('Falta el N° de folio.');
  if (!blob || blob.size > MAX_PDF) throw new Error('El PDF pesa más de 8 MB: no se guardó en Drive.');
  if (!(await esPdf(blob))) throw new Error('Ese archivo no es un PDF.');
  const nombre = nombreArchivo(folio, local);
  const base = await db();   // antes de subir: sin conexión a la base de Gastos no queda un archivo suelto en Drive
  const r = await Gastos.subidor()({ tipo: 'factura', fecha: fecha || '', imageData: await base64(blob), mimeType: 'application/pdf', fileName: nombre });
  if (!r || !r.url) throw new Error('Drive no devolvió el enlace del archivo.');
  const FB = await fsG();
  await FB.setDoc(FB.doc(base, 'facturas_b2b', String(folio)), { folio: String(folio), local: String(local || ''), clienteId: String(clienteId || ''), ordenes: (ordenes || []).map(String), fecha: fecha || '', archivo: nombre, url: r.url, idDrive: r.id || '', subidaEl: new Date().toISOString(), en: FB.serverTimestamp() });
  return { url: r.url, nombre };
}
// El enlace del PDF de un folio ('' si no está en Drive). 1 lectura.
export async function urlFactura(folio) {
  const FB = await fsG();
  const sn = await FB.getDoc(FB.doc(await db(), 'facturas_b2b', String(folio)));
  return sn.exists() ? String(sn.data().url || '') : '';
}
