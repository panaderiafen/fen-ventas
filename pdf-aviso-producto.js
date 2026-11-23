// ═══════════════════════════════════════════════
//  Sistema Fën — PDF del aviso de producto nuevo (una hoja A4, sin portada)  v0.138.0
//  Boceto "Aviso de producto nuevo" (23 nov). Misma paleta, letra y método que la lista de precios (pdf-lista-precios.js):
//  cabecera (logo, "Producto nuevo para su negocio", fecha), tipo y nombre, foto principal (grande si es "tal cual"; al lado
//  de la descripción si es "para rellenar"), descripción, características, precio neto + IVA, "Ideas para rellenar" (1 a 3
//  fotos con su texto) y al pie las condiciones y el contacto de las listas de precios.
// ═══════════════════════════════════════════════
import * as PL from './pdf-lista-precios.js?v=0.138.0';
import * as LM from './listas-precios-modelo.js?v=0.138.0';
import * as AM from './aviso-producto-modelo.js?v=0.138.0';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CSS = PL.CSS + `
.av-pag{padding:0}
.av-cuerpo{position:absolute;left:52px;right:52px;top:112px;bottom:56px;display:flex;flex-direction:column;gap:16px}
.av-eyebrow{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#626C66}
.av-nombre{font-size:38px;font-weight:800;letter-spacing:-.02em;color:#2F5A45;line-height:1.08;margin-top:4px}
.av-foto{border-radius:18px;background-color:#EFEBE0;background-size:cover;background-position:center;background-repeat:no-repeat}
.av-sinfoto{display:flex;align-items:center;justify-content:center;font-size:56px;font-weight:700;color:#2F5A45}
.av-fila{display:flex;gap:24px;align-items:stretch}
.av-desc{font-size:14.5px;line-height:1.55;color:#25302A;margin:0;white-space:pre-wrap}
.av-car{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.4;color:#25302A;margin-top:12px}
.av-precio{background:#2F5A45;color:#FBF9F4;border-radius:14px;padding:12px 18px;display:flex;flex-direction:column;gap:2px}
.av-precio span{font-size:12px;opacity:.85}.av-precio b{font-size:27px;font-weight:800;letter-spacing:-.01em}
.av-ideas-t{font-size:16px;font-weight:800;color:#2F5A45}
.av-ideas{display:flex;gap:14px}
.av-idea{flex:1 1 0;display:flex;flex-direction:column;gap:6px;min-width:0}
.av-idea .av-foto{height:150px;border-radius:14px}
.av-idea span{font-size:12.5px;line-height:1.35;color:#25302A}
.av-nota{font-size:11.5px;color:#626C66}
.av-cond{margin-top:auto;border-top:1px solid #E4DFD3;padding-top:12px;display:flex;flex-wrap:wrap;gap:6px 24px;font-size:12.5px;line-height:1.45;color:#25302A}
.av-cond b.t{flex-basis:100%;font-size:14px;color:#2F5A45}
.av-cond span{flex:0 0 calc(50% - 12px)}
.av-cond .todo{flex-basis:100%;color:#626C66}`;

const foto = (url, clase, estilo, nombre) => url ? `<div class="av-foto ${clase}" style="background-image:url('${url}');${estilo}"></div>`
  : `<div class="av-foto av-sinfoto ${clase}" style="${estilo}">${esc((String(nombre || 'F').trim()[0] || 'F').toUpperCase())}</div>`;

// aviso: el documento (AM.armarAviso + id) · fotos: { principal (data URL | null), rellenos [data URL] } → [{ html, texto }] (una hoja)
export function paginasHtml(a, { fotos = {}, logo = 'logo-fen.png' } = {}) {
  const c = a.condiciones || {}, ct = c.contacto || {}, rell = a.tipo === 'rellenar', hasta = LM.fechaLarga(a.vigenciaHasta);
  const car = (a.caracteristicas || []).filter(Boolean);
  const precio = `<div class="av-precio"><span>Precio neto por unidad</span><b>${esc(LM.precioTxt(a.precio))}</b></div>`;
  const texto = `<p class="av-desc">${esc(a.descripcion)}</p>${car.length ? `<div class="av-car">${car.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}`;
  const arriba = rell
    ? `<div class="av-fila">${foto(fotos.principal, '', 'flex:1 1 0;height:330px', a.nombre)}<div style="width:252px;display:flex;flex-direction:column;gap:14px"><div>${texto}</div><div style="margin-top:auto">${precio}</div></div></div>`
    : `${foto(fotos.principal, '', 'height:470px', a.nombre)}<div class="av-fila" style="align-items:flex-start"><div style="flex:1 1 0">${texto}</div><div style="width:240px">${precio}</div></div>`;
  const ideas = rell ? `<div style="display:flex;flex-direction:column;gap:10px"><div class="av-ideas-t">Ideas para rellenar</div><div class="av-ideas">${(a.rellenos || []).map((r, i) =>
      `<div class="av-idea">${foto((fotos.rellenos || [])[i], '', '', r.texto)}<span>${esc(r.texto)}</span></div>`).join('')}${'<div class="av-idea"></div>'.repeat(Math.max(0, 3 - (a.rellenos || []).length))}</div>
      <div class="av-nota">Fotos de ejemplo: el relleno lo pone usted.</div></div>` : '';
  const filas = [['Despacho', c.diasDespacho], ['Costo de despacho', c.costoDespacho], ['Formas de pago', c.formasPago],
    ['Precio válido', `${c.vigenciaDias || a.vigenciaDias || 30} días, hasta el ${hasta}`], ['Otras condiciones', c.otras]].filter(([, v]) => String(v || '').trim());
  const contacto = [ct.nombre, ct.telefono, ct.correo].filter(Boolean).join(' · ');
  const html = `<div class="lp-pag av-pag"><div class="lp-cab"><div class="lp-cab-izq"><img class="lp-cab-logo" src="${logo}" alt=""><div><div class="lp-cab-t1">Panadería Fën</div><div class="lp-cab-t2">Producto nuevo para su negocio</div></div></div>
    <div class="lp-cab-der">${esc(LM.fechaLarga(a.fecha))}<br>Precios netos + IVA</div></div>
    <div class="av-cuerpo"><div><div class="av-eyebrow">Nuevo · ${rell ? 'para rellenar' : 'se vende tal cual'}</div><div class="av-nombre">${esc(a.nombre)}</div></div>
    ${arriba}${ideas}
    <div class="av-cond"><b class="t">Condiciones</b>${filas.map(([e, v]) => `<span><b>${esc(e)}:</b> ${esc(v)}</span>`).join('')}${contacto ? `<span class="todo">Contacto: ${esc(contacto)}</span>` : ''}</div></div></div>`;
  return [{ html, texto: [a.nombre, a.descripcion, ...car, LM.precioTxt(a.precio), ...(a.rellenos || []).map(r => r.texto), ...filas.map(([e, v]) => `${e}: ${v}`), contacto].filter(Boolean) }];
}
export async function generar(a, opts = {}) {
  const r = await PL.generarHojas(paginasHtml(a, opts), CSS);
  return { ...r, nombre: AM.nombreArchivo(a) };
}
export const bajar = PL.bajar;
