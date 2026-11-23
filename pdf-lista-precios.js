// ═══════════════════════════════════════════════
//  Sistema Fën — PDF de la lista de precios (A4 vertical)  v0.80.2
//  Mismo método que el PDF de las órdenes (pdf-orden.js): html2canvas + jsPDF desde cdnjs, la primera vez que se pide.
//  Cada hoja se dibuja como una página HTML de 794 × 1123 px (A4) y se pasa a JPEG (liviano: ~20 productos ≈ 1–2 MB).
//  Además lleva el texto (invisible) de cada hoja, para que se pueda buscar y copiar en el PDF.
//  Hojas: 1 portada (imagen de portada si hay, logo, "Lista de precios", cliente, fecha, "Precios netos + IVA · válidos hasta …"),
//  después los productos en 2 columnas (foto, nombre, formato, descripción corta, precio "$ 3.500 + IVA") y al final
//  "Condiciones" y el contacto. Pie con el número de página. Paleta "Salvia y arena". Sin costos.
// ═══════════════════════════════════════════════
import { cargarLibrerias } from './pdf-orden.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ANCHO = 794, ALTO = 1123;          // px CSS de una hoja A4 (96 ppp)
const ESCALA = 1.6, CALIDAD = 0.82;       // nitidez y peso de cada hoja

export const CSS = `.lp-pag{position:relative;width:${ANCHO}px;height:${ALTO}px;overflow:hidden;background:#FBF9F4;color:#25302A;font-family:Manrope,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums;box-sizing:border-box}
.lp-pag *{box-sizing:border-box}
.lp-portada-img{position:absolute;left:0;top:0;width:${ANCHO}px;height:600px;background-size:cover;background-position:center;background-repeat:no-repeat}
.lp-portada-velo{position:absolute;left:0;top:520px;width:${ANCHO}px;height:80px;background:linear-gradient(rgba(251,249,244,0),#FBF9F4)}
.lp-portada-sin{position:absolute;left:0;top:0;width:${ANCHO}px;height:600px;background:#DFE9E0}
.lp-portada-sin .lp-arco{position:absolute;left:197px;top:120px;width:400px;height:400px;border-radius:200px 200px 24px 24px;border:2px solid rgba(47,90,69,.28)}
.lp-portada-cuerpo{position:absolute;left:64px;right:64px;top:600px;bottom:56px;display:flex;flex-direction:column;align-items:center;text-align:center}
.lp-portada-logo{width:170px;height:auto;margin-top:-62px;background:#FBF9F4;border-radius:20px;padding:12px 18px}
.lp-portada-sin-logo{position:absolute;left:247px;top:212px;width:300px;height:auto}
.lp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#626C66}
.lp-titulo{font-size:52px;font-weight:800;letter-spacing:-.02em;color:#2F5A45;line-height:1.05;margin-top:22px}
.lp-cliente{font-size:24px;font-weight:600;margin-top:14px;color:#25302A}
.lp-fecha{font-size:15px;color:#626C66;margin-top:8px}
.lp-pastilla{display:inline-block;margin-top:26px;padding:10px 20px;border-radius:999px;background:#2F5A45;color:#FBF9F4;font-size:14px;font-weight:700;letter-spacing:.01em}
.lp-portada-pie{position:absolute;left:64px;right:64px;bottom:40px;text-align:center;font-size:12px;color:#626C66;line-height:1.6}
.lp-cab{position:absolute;left:48px;right:48px;top:34px;height:58px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #E4DFD3}
.lp-cab-izq{display:flex;align-items:center;gap:14px}.lp-cab-logo{width:62px;height:auto}
.lp-cab-t1{font-size:15px;font-weight:800;color:#2F5A45}.lp-cab-t2{font-size:12px;color:#626C66;margin-top:2px}
.lp-cab-der{font-size:12px;color:#626C66;text-align:right;line-height:1.5}
.lp-grid{position:absolute;left:48px;right:48px;top:112px;display:flex;flex-wrap:wrap;gap:18px 22px}
.lp-card{width:338px;height:300px;border-radius:16px;background:#FFFDF9;border:1px solid #E4DFD3;overflow:hidden;display:flex;flex-direction:column}
.lp-foto{width:338px;height:150px;background-repeat:no-repeat;background-color:#EFEBE0;flex:none}
.lp-sin-foto{width:338px;height:150px;background:#EFEBE0;display:flex;align-items:center;justify-content:center;flex:none}
.lp-mono{width:66px;height:66px;border-radius:33px;border:1.5px solid #C9D6CB;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#2F5A45;background:#F6F4EE}
.lp-card-cuerpo{padding:10px 16px 11px;display:flex;flex-direction:column;flex:1;min-height:0}
.lp-area{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7C857F}
.lp-nombre{font-size:16px;font-weight:700;line-height:22px;height:22px;margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lp-formato{font-size:11.5px;color:#626C66;margin-top:0;line-height:16px;height:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lp-desc{font-size:11px;color:#4A544E;line-height:15px;margin-top:4px;height:46px;overflow:hidden;padding-bottom:1px}
.lp-precio{margin-top:auto;display:flex;align-items:baseline;gap:6px}
.lp-precio b{font-size:21px;font-weight:800;color:#2F5A45;letter-spacing:-.01em}.lp-precio span{font-size:12px;font-weight:600;color:#626C66}
.lp-pie{position:absolute;left:48px;right:48px;bottom:30px;display:flex;justify-content:space-between;font-size:11px;color:#7C857F;border-top:1px solid #E4DFD3;padding-top:10px}
.lp-cond{position:absolute;left:64px;right:64px;top:128px}
.lp-cond h2{margin:0;font-size:30px;font-weight:800;color:#2F5A45;letter-spacing:-.01em}
.lp-cond-sub{font-size:14px;color:#626C66;margin-top:6px}
.lp-cond-lista{margin-top:26px;border-top:1px solid #E4DFD3}
.lp-cond-fila{display:flex;gap:24px;padding:16px 0;border-bottom:1px solid #E4DFD3}
.lp-cond-et{flex:0 0 190px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7C857F;padding-top:3px}
.lp-cond-v{flex:1;font-size:16px;line-height:1.5;color:#25302A;white-space:pre-wrap}
.lp-contacto{margin-top:34px;padding:22px 26px;border-radius:16px;background:#DFE9E0;display:flex;align-items:center;gap:24px}
.lp-contacto img{width:96px;height:auto;flex:none}
.lp-contacto-t{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2F5A45}
.lp-contacto-n{font-size:18px;font-weight:700;margin-top:4px}.lp-contacto-d{font-size:14px;color:#25302A;margin-top:4px;line-height:1.6}`;

const pie = (cliente, i, n) => `<div class="lp-pie"><span>Panadería Fën · Lista de precios${cliente ? ' · ' + esc(cliente) : ''}</span><span>Página ${i} de ${n}</span></div>`;
const cabecera = (lista, logo) => `<div class="lp-cab"><div class="lp-cab-izq"><img class="lp-cab-logo" src="${logo}" alt=""><div><div class="lp-cab-t1">Lista de precios</div><div class="lp-cab-t2">${esc(lista.cliente.nombre)}</div></div></div>
  <div class="lp-cab-der">${esc(LM.fechaLarga(lista.fecha))}<br>Precios netos + IVA</div></div>`;
const inicial = n => (String(n || '').trim().charAt(0) || 'F').toUpperCase();
function tarjeta(it, foto) {
  const f = foto && foto.foto ? `<div class="lp-foto" style="background-image:url('${foto.foto}');${LM.fondoFoto(foto, LM.TARJETA_FOTO.w, LM.TARJETA_FOTO.h)}"></div>` : `<div class="lp-sin-foto"><div class="lp-mono">${esc(inicial(it.nombre))}</div></div>`;
  return `<div class="lp-card">${f}<div class="lp-card-cuerpo"><div class="lp-area">${esc(it.areaNombre || '')}</div><div class="lp-nombre">${esc(it.nombre)}</div>
    <div class="lp-formato">${esc(it.formato || '')}</div><div class="lp-desc">${esc(it.descripcion || '')}</div>
    <div class="lp-precio"><b>${esc(LM.clp(it.precio))}</b><span>+ IVA</span></div></div></div>`;
}
// lista: el documento (LM.armarLista) · fotos: { catalogoId: { foto } } · portada: data URL | null · logo: ruta del logo
// → [{ html, texto: [líneas] }]
export function paginasHtml(lista, { fotos = {}, portada = null, logo = 'logo-fen.png', areaNombre = a => a } = {}) {
  const c = lista.condiciones || {}, ct = c.contacto || {}, cli = (lista.cliente || {}).nombre || '';
  const items = (lista.items || []).map(x => ({ ...x, areaNombre: x.areaNombre || areaNombre(x.area) }));
  const ps = LM.paginas(items), n = ps.length, hasta = LM.fechaLarga(lista.vigenciaHasta);
  return ps.map((p, i) => {
    if (p.tipo === 'portada') {
      const arriba = portada ? `<div class="lp-portada-img" style="background-image:url('${portada}')"></div><div class="lp-portada-velo"></div>` : `<div class="lp-portada-sin"><div class="lp-arco"></div><img class="lp-portada-sin-logo" src="${logo}" alt="Fën"></div>`;
      return { html: `<div class="lp-pag lp-pag-portada">${arriba}<div class="lp-portada-cuerpo">${portada ? `<img class="lp-portada-logo" src="${logo}" alt="Fën">` : '<div style="height:36px"></div>'}
        <div class="lp-eyebrow" style="margin-top:${portada ? 18 : 40}px">Panadería masa madre · Concepción</div><div class="lp-titulo">Lista de precios</div>
        <div class="lp-cliente">${cli ? 'Para ' + esc(cli) : ''}</div><div class="lp-fecha">${esc(LM.fechaLarga(lista.fecha))}</div>
        <div class="lp-pastilla">Precios netos + IVA · válidos hasta el ${esc(hasta)}</div></div>
        <div class="lp-portada-pie">${esc([ct.nombre, ct.telefono, ct.correo].filter(Boolean).join(' · '))}</div></div>`,
      texto: ['Lista de precios', cli ? 'Para ' + cli : '', LM.fechaLarga(lista.fecha), `Precios netos + IVA · válidos hasta el ${hasta}`].filter(Boolean) };
    }
    if (p.tipo === 'productos') return { html: `<div class="lp-pag">${cabecera(lista, logo)}<div class="lp-grid">${p.items.map(it => tarjeta(it, fotos[it.catalogoId])).join('')}</div>${pie(cli, i + 1, n)}</div>`,
      texto: p.items.map(it => [it.nombre, it.formato, LM.precioTxt(it.precio)].filter(Boolean).join(' · ')) };
    const filas = [['Días de despacho', c.diasDespacho], ['Costo de despacho', c.costoDespacho], ['Formas de pago', c.formasPago],
      ['Vigencia', `Precios válidos hasta el ${hasta} (${c.vigenciaDias || lista.vigenciaDias || 30} días desde el ${LM.fechaLarga(lista.fecha)}).`],
      ['Precios', 'Todos los precios son netos: se suma el IVA (19 %).'], ['Otras condiciones', c.otras]].filter(([, v]) => String(v || '').trim());
    return { html: `<div class="lp-pag">${cabecera(lista, logo)}<div class="lp-cond"><h2>Condiciones</h2><div class="lp-cond-sub">Lo que conviene saber para tus pedidos.</div>
      <div class="lp-cond-lista">${filas.map(([e, v]) => `<div class="lp-cond-fila"><div class="lp-cond-et">${esc(e)}</div><div class="lp-cond-v">${esc(v)}</div></div>`).join('')}</div>
      ${ct.nombre || ct.telefono || ct.correo ? `<div class="lp-contacto"><img src="${logo}" alt=""><div><div class="lp-contacto-t">Contacto</div>${ct.nombre ? `<div class="lp-contacto-n">${esc(ct.nombre)}</div>` : ''}<div class="lp-contacto-d">${[ct.telefono, ct.correo].filter(Boolean).map(esc).join('<br>')}</div></div></div>` : ''}
      </div>${pie(cli, i + 1, n)}</div>`, texto: ['Condiciones', ...filas.map(([e, v]) => `${e}: ${v}`), [ct.nombre, ct.telefono, ct.correo].filter(Boolean).join(' · ')] };
  });
}
// Texto que acepta la letra estándar del PDF (Latin-1)
const latin1 = t => String(t || '').replace(/[‐-―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->').replace(/…/g, '...').replace(/[^\x20-\xFF]/g, '');

async function esperarImagenes(raiz) {
  const imgs = [...raiz.querySelectorAll('img')];
  await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 4000); })));
}
// → { blob, nombre, paginas, bytes }
export async function generar(lista, opts = {}) {
  const r = await generarHojas(paginasHtml(lista, opts));
  return { ...r, nombre: LM.nombreArchivo(lista) };
}
// v0.138.0: las hojas ya armadas ([{ html, texto }], cada html una .lp-pag) → { blob, paginas, bytes }. Lo usa también el aviso de producto nuevo.
export async function generarHojas(hojas, css = CSS) {
  await cargarLibrerias();
  const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  const W = pdf.internal.pageSize.getWidth(), Hh = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < hojas.length; i++) {
    const caja = document.createElement('div');
    caja.style.cssText = `position:absolute;top:0;left:-99999px;width:${ANCHO}px;z-index:-1`;
    caja.innerHTML = `<style>${css}</style>` + hojas[i].html;
    document.body.appendChild(caja);
    try {
      const raiz = caja.querySelector('.lp-pag');
      await esperarImagenes(raiz);
      const canvas = await window.html2canvas(raiz, { scale: ESCALA, backgroundColor: '#FBF9F4', width: ANCHO, height: ALTO, windowWidth: ANCHO, logging: false });
      if (i) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', CALIDAD), 'JPEG', 0, 0, W, Hh, undefined, 'FAST');
      // El texto de la hoja, invisible (se puede buscar y copiar)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7);
      hojas[i].texto.forEach((t, k) => pdf.text(latin1(t), 24, 24 + k * 9, { renderingMode: 'invisible' }));
    } finally { caja.remove(); }
  }
  const blob = pdf.output('blob');
  return { blob, paginas: hojas.length, bytes: blob.size };
}
// Bajar el archivo (computador, o celular sin "Compartir")
export function bajar(blob, nombre) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
