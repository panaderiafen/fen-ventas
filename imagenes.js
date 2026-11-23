// ═══════════════════════════════════════════════
//  Sistema Fën — achicar fotos en el navegador (canvas → JPEG)  v0.80.0
//  La foto nunca sube tal cual: se dibuja en un canvas con el lado largo a lo más N píxeles y se guarda como JPEG,
//  bajando la calidad (y si no alcanza, el tamaño) hasta quedar bajo el peso pedido. Fondo blanco (un PNG transparente
//  no queda negro). Sin librerías.
// ═══════════════════════════════════════════════
import { medidas, bytesDataUrl, FOTO, PORTADA } from './listas-precios-modelo.js?v=0.138.0';

async function abrir(archivo) {
  if (!archivo || !/^image\//.test(archivo.type || '')) throw new Error('Elige una imagen (JPG, PNG o WebP).');
  if (archivo.size > 30e6) throw new Error('La imagen pesa más de 30 MB: elige una más liviana.');
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('No se pudo abrir esa imagen. Prueba con una JPG o PNG.')); img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
function dibujar(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  return c;
}
// → { url (data:image/jpeg), ancho, alto, bytes, calidad }
function jpegBajo(img, lado, maxBytes) {
  let { ancho, alto } = medidas(img.naturalWidth || img.width, img.naturalHeight || img.height, lado);
  if (!ancho) throw new Error('La imagen no tiene tamaño.');
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    const c = dibujar(img, ancho, alto);
    for (const q of [0.86, 0.8, 0.72, 0.64, 0.56, 0.48]) {
      const url = c.toDataURL('image/jpeg', q), bytes = bytesDataUrl(url);
      if (bytes <= maxBytes) return { url, ancho, alto, bytes, calidad: q };
    }
    ancho = Math.max(1, Math.round(ancho * 0.82)); alto = Math.max(1, Math.round(alto * 0.82));
  }
  throw new Error('No se pudo achicar la imagen lo suficiente.');
}
// Foto de un producto: la grande (≤ 900 px, ≤ 90 KB) y la miniatura (≤ 240 px, ≤ 15 KB)
export async function fotoProducto(archivo) {
  const img = await abrir(archivo);
  const g = jpegBajo(img, FOTO.lado, FOTO.bytes), m = jpegBajo(img, FOTO.miniLado, FOTO.miniBytes);
  return { foto: g.url, mini: m.url, ancho: g.ancho, alto: g.alto, bytes: g.bytes, miniBytes: m.bytes, original: { ancho: img.naturalWidth, alto: img.naturalHeight, bytes: archivo.size } };
}
// Portada de las listas: ≤ 1600 px, ≤ 250 KB
export async function portada(archivo) {
  const img = await abrir(archivo);
  const g = jpegBajo(img, PORTADA.lado, PORTADA.bytes);
  return { portada: g.url, ancho: g.ancho, alto: g.alto, bytes: g.bytes, original: { ancho: img.naturalWidth, alto: img.naturalHeight, bytes: archivo.size } };
}
