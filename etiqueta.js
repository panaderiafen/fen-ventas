// ═══════════════════════════════════════════════
//  fën · Etiqueta de 80 × 50 mm para la impresora térmica (90-IV-Printer, TSPL, Bluetooth)  v1.1.0
//  v1.1.0: imprime DIRECTO por Bluetooth desde Chrome en Android (sin la app), con imprimirDirecto(); probado por Emmanuel el 25 nov
//          con la página de prueba en la tablet de Ainavillo. Compartir (PDF o imagen a Print Label) queda para el iPhone y el Mac.
//  El mismo archivo va en la caja, en logística y en Sistema Fën.
//  Dibuja la etiqueta (logo, título, filas, monto grande y pie) en una imagen de 640 × 400 puntos (8 por mm, 203 dpi),
//  la pone en un PDF de 80 × 50 mm hecho aquí mismo (sin librerías ni internet) y abre "Compartir" para elegir
//  la app de la impresora. Si el equipo no puede compartir archivos, lo descarga.
//  Todo es síncrono hasta el "Compartir" (el iPhone lo exige dentro del toque): el logo se carga antes, con prepararLogo().
// ═══════════════════════════════════════════════
export const ANCHO = 640, ALTO = 400;            // puntos (8 por mm)
const MM_PT = 72 / 25.4, PAG = [80 * MM_PT, 50 * MM_PT];
let logo = null, logoListo = null;

// Carga el logo en negro (logo-etiqueta.png, junto a la app). Sin logo, la etiqueta sale igual.
export function prepararLogo(url = 'logo-etiqueta.png') {
  if (!logoListo) logoListo = new Promise(ok => {
    const im = new Image();
    im.onload = () => { logo = im; ok(true); };
    im.onerror = () => { logoListo = null; ok(false); };
    im.src = url;
  });
  return logoListo;
}

const LETRA = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
// Achica la letra hasta que el texto quepa en el ancho
function ajustar(ctx, texto, peso, tam, max) {
  let t = tam;
  ctx.font = `${peso} ${t}px ${LETRA}`;
  while (t > 12 && ctx.measureText(texto).width > max) { t -= 1; ctx.font = `${peso} ${t}px ${LETRA}`; }
  return t;
}

// d = { titulo, sub, filas: [[izq, der]], total: [izq, der] | null, grande: texto | null, pie: [izq, der] }
// → canvas de 640 × 400, en blanco y negro
export function dibujar(d) {
  const c = document.createElement('canvas'); c.width = ANCHO; c.height = ALTO;
  const x = c.getContext('2d'), M = 26, AN = ANCHO - 2 * M;
  x.fillStyle = '#fff'; x.fillRect(0, 0, ANCHO, ALTO);
  x.fillStyle = '#000'; x.strokeStyle = '#000'; x.textBaseline = 'alphabetic';
  // Cabecera: logo a la izquierda, título y fecha a la derecha
  let tx = M;
  if (logo) { const h = 98, w = Math.round(h * logo.naturalWidth / logo.naturalHeight); x.drawImage(logo, M, 14, w, h); tx = M + w + 18; }
  const anchoTit = ANCHO - M - tx;
  x.textAlign = 'left';
  ajustar(x, d.titulo || '', 800, 30, anchoTit); x.fillText(d.titulo || '', tx, 56);
  ajustar(x, d.sub || '', 700, 25, anchoTit); x.fillText(d.sub || '', tx, 94);
  x.fillRect(M, 122, AN, 3);
  let y = 122;
  if (d.grande != null) {
    // Un solo monto, grande (sobre de caja o de efectivo B2B)
    (d.filas || []).slice(0, 1).forEach(([a]) => { ajustar(x, a, 700, 27, AN); x.fillText(a, M, y + 40); y += 40; });
    const t = ajustar(x, d.grande, 800, 86, AN); x.fillText(d.grande, M, y + 16 + t);
  } else {
    // Filas con su monto a la derecha y, abajo, el total destacado
    (d.filas || []).slice(0, 3).forEach(([a, b]) => {
      y += 38;
      x.textAlign = 'right'; x.font = `800 26px ${LETRA}`; x.fillText(b || '', ANCHO - M, y);
      const wb = x.measureText(b || '').width;
      x.textAlign = 'left'; ajustar(x, a || '', 600, 26, AN - wb - 16); x.fillText(a || '', M, y);
    });
    if (d.total) {
      y += 14; x.fillRect(M, y, AN, 3);
      x.textAlign = 'right'; const t = ajustar(x, d.total[1], 800, 64, AN * 0.62); x.fillText(d.total[1], ANCHO - M, y + 8 + t);
      x.textAlign = 'left'; x.font = `800 32px ${LETRA}`; x.fillText(d.total[0], M, y + 8 + t - Math.round((t - 32) / 2));
    }
  }
  // Pie: quién y firma
  const [pi, pd] = d.pie || ['', ''];
  x.textAlign = 'left'; ajustar(x, pi || '', 600, 23, AN / 2 - 8); x.fillText(pi || '', M, ALTO - 16);
  x.textAlign = 'right'; ajustar(x, pd || '', 600, 23, AN / 2 - 8); x.fillText(pd || '', ANCHO - M, ALTO - 16);
  return c;
}

// ── PDF de una página de 80 × 50 mm con la imagen (JPEG) a página completa ──
const ascii = s => new TextEncoder().encode(s);
function base64Bytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export function pdfDeJpeg(jpg, w, h) {
  const [pw, ph] = PAG.map(n => n.toFixed(2));
  const cont = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const partes = [], offs = [];
  let largo = 0;
  const poner = b => { const u = typeof b === 'string' ? ascii(b) : b; partes.push(u); largo += u.length; };
  const obj = (n, cuerpo) => { offs[n] = largo; poner(`${n} 0 obj\n`); cuerpo(); poner('\nendobj\n'); };
  poner('%PDF-1.4\n');
  obj(1, () => poner('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => poner('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => poner(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`));
  obj(4, () => poner(`<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`));
  obj(5, () => { poner(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); poner(jpg); poner('\nendstream'); });
  const xref = largo;
  poner(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(largo); let p = 0; partes.forEach(u => { out.set(u, p); p += u.length; });
  return out;
}

// Los archivos de la etiqueta: { pdf: File, png: File }
export function archivos(d, nombre) {
  const c = dibujar(d);
  const jpg = base64Bytes(c.toDataURL('image/jpeg', 0.95).split(',')[1]);
  const png = base64Bytes(c.toDataURL('image/png').split(',')[1]);
  const base = String(nombre || 'etiqueta').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60);
  return { pdf: new File([pdfDeJpeg(jpg, ANCHO, ALTO)], base + '.pdf', { type: 'application/pdf' }), png: new File([png], base + '.png', { type: 'image/png' }) };
}
function descargar(f) {
  const u = URL.createObjectURL(f), a = document.createElement('a');
  a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
// Abre "Compartir" con la etiqueta (PDF o, si se pide, imagen). Llamar dentro del toque. → Promise<'compartida'|'descargada'|'cancelada'>
export function compartir(d, nombre, { como = 'pdf' } = {}) {
  const f = archivos(d, nombre)[como === 'png' ? 'png' : 'pdf'];
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    return navigator.share({ files: [f], title: d.titulo || 'Etiqueta' }).then(() => 'compartida', e => (e && e.name === 'AbortError' ? 'cancelada' : (descargar(f), 'descargada')));
  }
  descargar(f);
  return Promise.resolve('descargada');
}

// ── v1.1.0 · Impresión directa por Bluetooth (Web Bluetooth, Chrome en Android). La impresora habla TSPL. ──
// La primera vez de cada sesión Chrome muestra la lista para elegir "BlueTooth Printer" (dentro del toque); después imprime al tiro.
const SERVICIOS_BT = [0x18f0, 0xff00, 0xffe0, 0xfee7, 0xae30, 0xae00, 0xfff0, 0xff80,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
let bt = { dev: null, car: null };
export const puedeDirecto = () => !!(typeof navigator !== 'undefined' && navigator.bluetooth);
async function buscarEscritura(dev) {
  const srv = await dev.gatt.connect();
  for (const s of await srv.getPrimaryServices()) {
    if (/^0000180[01a]-/.test(s.uuid)) continue;
    let cs = []; try { cs = await s.getCharacteristics(); } catch (e) { /* sin acceso a ese servicio */ }
    const c = cs.find(x => x.properties.writeWithoutResponse || x.properties.write);
    if (c) return c;
  }
  throw new Error('La impresora se conectó, pero no recibe datos por este camino.');
}
async function conectarBT() {
  if (bt.car && bt.dev && bt.dev.gatt.connected) return bt.car;
  if (bt.dev) { try { bt.car = await buscarEscritura(bt.dev); return bt.car; } catch (e) { bt = { dev: null, car: null }; } }
  // Lo que ya autorizó antes (si Chrome lo permite), si no, la lista para elegir
  if (navigator.bluetooth.getDevices) {
    try { for (const d of await navigator.bluetooth.getDevices()) { try { const c = await buscarEscritura(d); bt = { dev: d, car: c }; return c; } catch (e) { /* no está a mano */ } } } catch (e) { /* sin permiso guardado */ }
  }
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS_BT });
  const car = await buscarEscritura(dev);
  dev.addEventListener('gattserverdisconnected', () => { bt.car = null; });
  bt = { dev, car };
  return car;
}
// La etiqueta en TSPL: SIZE, GAP y la imagen como BITMAP (bit en 0 = imprime). Probado así en la 90-IV-Printer.
export function tspl(c, { invertir = false } = {}) {
  const d = c.getContext('2d').getImageData(0, 0, ANCHO, ALTO).data, ab = ANCHO / 8, bits = new Uint8Array(ab * ALTO);
  for (let y = 0; y < ALTO; y++) for (let x = 0; x < ANCHO; x++) {
    const i = (y * ANCHO + x) * 4, negro = (d[i] + d[i + 1] + d[i + 2]) / 3 < 140;
    if (negro === invertir) bits[y * ab + (x >> 3)] |= 0x80 >> (x & 7);
  }
  const cab = ascii(`SIZE 80 mm,50 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 0\r\nDENSITY 8\r\nCLS\r\nBITMAP 0,0,${ab},${ALTO},0,`), fin = ascii('\r\nPRINT 1,1\r\n');
  const out = new Uint8Array(cab.length + bits.length + fin.length);
  out.set(cab, 0); out.set(bits, cab.length); out.set(fin, cab.length + bits.length);
  return out;
}
async function enviarBT(car, bytes) {
  const sinResp = car.properties.writeWithoutResponse, n = sinResp ? 180 : 100;
  for (let i = 0; i < bytes.length; i += n) {
    const parte = bytes.slice(i, i + n);
    if (sinResp) await car.writeValueWithoutResponse(parte); else await car.writeValue(parte);
    if (i % 2000 < n) await new Promise(r => setTimeout(r, 20));
  }
}
// Imprime la etiqueta directo. Llamar dentro del toque (la primera vez abre la lista de Chrome). → Promise<'impresa'>; lanza un Error con el texto para la persona.
export async function imprimirDirecto(d, { invertir = false } = {}) {
  if (!puedeDirecto()) throw new Error('Este equipo no imprime directo por Bluetooth (use Chrome en Android).');
  let car;
  try { car = await conectarBT(); }
  catch (e) { throw new Error(e && e.name === 'NotFoundError' ? 'No se eligió la impresora.' : 'No se pudo conectar con la impresora: ¿está encendida y cerca? Cierre la app Print Label si está abierta.'); }
  const bytes = tspl(dibujar(d), { invertir });
  try { await enviarBT(car, bytes); }
  catch (e) { bt.car = null; throw new Error('Se cortó la conexión con la impresora. Toque otra vez.'); }
  return 'impresa';
}
