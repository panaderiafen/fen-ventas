// ═══════════════════════════════════════════════
//  Sistema Fën — Aviso de producto nuevo: reglas  v0.138.0
//  Boceto "Aviso de producto nuevo" (aprobado por Emmanuel el 23 nov): un PDF de UNA hoja, sin portada y sin cliente, de un
//  producto del Catálogo (habilitado en B2B) para mandarlo a cualquier cliente. Dos tipos:
//   · talcual: se vende tal cual (foto grande, descripción, características, precio).
//   · rellenar: el cliente lo rellena o le agrega valor (lo mismo + "Ideas para rellenar": 1 a 3 fotos con su texto).
//  Precio: el precio base neto de B2B + IVA (se cambia en Catálogo → Productos). Condiciones y contacto: las de las listas de
//  precios (config/listasPrecios), con su vigencia.
//  Doc fen-gastos avisos_producto/{id} = { tipo, catalogoId, productoId, nombre, area, formato, descripcion, caracteristicas [≤3],
//    precio, fecha, vigenciaDias, vigenciaHasta, condiciones, fotoCatalogo (bool), rellenos [{ texto }], por, en, editadoEn/Por,
//    enviadoEn, envios [...], historial }
//  Fotos aparte (leer la lista no trae imágenes): avisos_fotos/{id} = { principal (data URL | null), rellenos [data URL] }
// ═══════════════════════════════════════════════
import * as LM from './listas-precios-modelo.js?v=0.138.0';

export const TIPOS = { talcual: 'Se vende tal cual', rellenar: 'Para rellenar o agregar valor' };
export const MAX_RELLENOS = 3, MAX_CARACT = 3;
export const LARGO = { descripcion: 320, caracteristica: 70, relleno: 50 };
const s = v => String(v ?? '').trim();
const una = v => s(v).replace(/\s+/g, ' ');

// editor: { tipo, item (de LM.elegibles), descripcion, caracteristicas [3], fecha, condiciones, fotoCatalogo, fotoPropia (bool),
//   rellenos [{ texto, conFoto }] } → doc sin por/en. Lanza un error con lo que falta.
export function armarAviso(e) {
  const it = e.item;
  if (!it || !it.catalogoId) throw new Error('Elige el producto del catálogo.');
  const tipo = TIPOS[e.tipo] ? e.tipo : '';
  if (!tipo) throw new Error('Elige el tipo de aviso: tal cual o para rellenar.');
  const precio = Math.round(Number(it.precioBase) || 0);
  if (!(precio > 0)) throw new Error(`"${it.nombre}" no tiene precio base en B2B: póngaselo en Catálogo → Productos.`);
  if (!e.fotoCatalogo && !e.fotoPropia) throw new Error('Falta la foto principal: use la del catálogo o suba otra.');
  const descripcion = s(e.descripcion).slice(0, LARGO.descripcion);
  if (!descripcion) throw new Error('Escriba la descripción (parte con la del catálogo).');
  const caracteristicas = (e.caracteristicas || []).map(una).filter(Boolean).slice(0, MAX_CARACT).map(x => x.slice(0, LARGO.caracteristica));
  let rellenos = [];
  if (tipo === 'rellenar') {
    rellenos = (e.rellenos || []).filter(r => r && (r.conFoto || s(r.texto))).slice(0, MAX_RELLENOS);
    if (!rellenos.length) throw new Error('Agregue al menos una foto de ejemplo de relleno (hasta 3).');
    rellenos.forEach((r, i) => { if (!r.conFoto) throw new Error(`Falta la foto del relleno ${i + 1}.`); if (!una(r.texto)) throw new Error(`Escriba el texto bajo la foto del relleno ${i + 1}.`); });
    rellenos = rellenos.map(r => ({ texto: una(r.texto).slice(0, LARGO.relleno) }));
  }
  const condiciones = LM.normalizarCondiciones(e.condiciones), fecha = s(e.fecha) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Falta la fecha.');
  return { tipo, catalogoId: it.catalogoId, productoId: it.productoId || null, nombre: una(it.nombre), area: s(it.area), formato: una(it.formato),
    descripcion, caracteristicas, precio, fecha, vigenciaDias: condiciones.vigenciaDias, vigenciaHasta: LM.sumarDias(fecha, condiciones.vigenciaDias),
    condiciones, fotoCatalogo: !!e.fotoCatalogo, rellenos };
}
// Las características que se proponen: el formato del catálogo y dos líneas libres
export const caracteristicasIniciales = it => [it && it.formato ? `Formato: ${una(it.formato)}` : '', '', ''];
export const nombreArchivo = a => `Producto_nuevo_Fen_${String(a.nombre || 'producto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}.pdf`;
export const mensajeWsp = a => `Hola, les presentamos un producto nuevo de Panadería Fën: ${a.nombre} (${LM.precioTxt(a.precio)}${a.tipo === 'rellenar' ? ', para rellenar a su gusto' : ''}). Les dejo la ficha con las condiciones. Cualquier duda, nos escriben.`;
export function estadoAviso(a) { return a && a.enviadoEn ? { k: 'enviado', t: 'Enviado', c: 'c-verde' } : { k: 'listo', t: 'Sin enviar', c: 'c-gris' }; }
