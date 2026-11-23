// ═══════════════════════════════════════════════
//  Sistema Fën — Gestión y tributario  v0.108.0 · reglas puras, sin red
//  Decidido con Emmanuel el 26 oct (hoja de ruta, sección 7). Cada gasto lleva su SITUACIÓN TRIBUTARIA, aparte del ítem y del área:
//   · aceptado      el SII lo acepta como gasto de la empresa (lo que ve el contador). Es lo que se supone si no se dice otra cosa.
//   · regularizar   gasto real que todavía no se acepta, pero tiene camino (el auto en comodato, Ainavillo): lleva su trámite.
//   · no_aceptado   gasto real que nunca será tributario.
//  Se pone UNA vez y se recuerda (una regla), por compromiso, por servicio (proveedor y N° de cliente), por proveedor o por ítem. Lo del
//  documento (compromiso, servicio, proveedor) manda sobre lo del ítem. Cada regla guarda sus cambios con su fecha "desde": un cambio rige
//  desde esa fecha; lo anterior queda como estaba. Los trámites van por grupo (auto, Ainavillo).
//  Se guarda en gn_config/tributario: { reglas: { id: { tipo, clave, nombre, cambios: [{ desde, situacion, grupo, nota, por, en }] } },
//                                       grupos: { id: { nombre, falta, quien, estado, nota, historial } } }
//  El estado de resultados de gestión no cambia. El impuesto estimado se calcula sobre la base tributaria: el resultado antes de impuesto
//  más los gastos que el SII no acepta (por regularizar y no aceptados).
// ═══════════════════════════════════════════════
import * as GB from './gn-bandeja.js?v=0.138.0';

const s = v => String(v == null ? '' : v).trim();
const norm = t => s(t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const esIso = f => /^\d{4}-\d{2}-\d{2}$/.test(s(f));

export const SITUACIONES = { aceptado: 'Aceptado', regularizar: 'Por regularizar', no_aceptado: 'No aceptado' };
export const ESTADOS = { pendiente: 'Pendiente', en_curso: 'En curso', resuelto: 'Resuelto' };
export const TIPOS = { compromiso: 'Compromiso', servicio: 'Servicio', proveedor: 'Proveedor', item: 'Ítem' };
// Id de la regla (sirve de llave en Firestore: sin puntos ni barras)
export const idRegla = (tipo, clave) => `${tipo}__${(tipo === 'item' ? norm(clave) : s(clave)).replace(/[^0-9A-Za-z_-]/g, '_').slice(0, 120)}`;
export const idGrupo = nombre => 'g_' + norm(nombre).replace(/ /g, '_').slice(0, 60);

// La situación de una regla en una fecha: el último cambio con "desde" ≤ fecha (null si todavía no rige)
export function vigente(regla, fecha) {
  const l = ((regla && regla.cambios) || []).filter(c => esIso(c.desde) && c.desde <= s(fecha)).sort((a, b) => a.desde.localeCompare(b.desde) || s(a.en).localeCompare(s(b.en)));
  return l.length ? l[l.length - 1] : null;
}
// Las reglas que aplican a un documento (en orden: la primera que rija manda), sin el ítem
export function reglasDoc(d, T) {
  const R = (T && T.reglas) || {}, out = [];
  if (d && d.compromiso) out.push(R[idRegla('compromiso', d.compromiso)]);
  if (d && s(d.cliente)) out.push(R[idRegla('servicio', GB.claveProveedor(d))]);
  if (d) out.push(R[idRegla('proveedor', GB.claveBase(d))]);
  return out.filter(Boolean);
}
// La situación de una línea (documento + ítem) en su fecha → { situacion, grupo, tipo, regla }
export function situacionDe(d, item, fecha, T) {
  const R = (T && T.reglas) || {}, f = s(fecha) || s(d && d.fecha);
  for (const r of reglasDoc(d, T).concat(item ? [R[idRegla('item', item)]] : []).filter(Boolean)) {
    const c = vigente(r, f); if (c) return { situacion: SITUACIONES[c.situacion] ? c.situacion : 'aceptado', grupo: s(c.grupo), tipo: r.tipo, regla: idRegla(r.tipo, r.clave) };
  }
  return { situacion: 'aceptado', grupo: '', tipo: '', regla: '' };
}
// ¿Algo de este documento no es aceptado hoy? (para el chip de la Bandeja)
export function chipDoc(d, items, T, fecha) {
  const l = [...new Set((items || []).filter(Boolean))].map(i => situacionDe(d, i, fecha || d.fecha, T)).concat([situacionDe(d, '', fecha || d.fecha, T)]);
  return l.find(x => x.situacion !== 'aceptado') || null;
}
// Validar un cambio de regla
export function validarCambio(x) {
  if (!SITUACIONES[x && x.situacion]) throw new Error('Elija la situación.');
  if (!esIso(x.desde)) throw new Error('Elija desde qué fecha rige.');
  if (x.situacion !== 'aceptado' && !s(x.grupo) && !s(x.grupoNuevo)) throw new Error('Elija el trámite (grupo) o escriba uno nuevo.');
  return { situacion: x.situacion, desde: x.desde, grupo: x.situacion === 'aceptado' ? '' : (s(x.grupoNuevo) ? idGrupo(x.grupoNuevo) : s(x.grupo)), grupoNuevo: x.situacion === 'aceptado' ? '' : s(x.grupoNuevo).slice(0, 60), nota: s(x.nota).slice(0, 200) };
}
// Los gastos del resultado del mes según su situación (líneas de Finanzas con .tributario y .grupoTrib) → informe
export function informe(lineasResultado, T) {
  const G = (T && T.grupos) || {}, out = { aceptado: 0, regularizar: 0, no_aceptado: 0, grupos: {}, detalle: [] };
  (lineasResultado || []).forEach(l => {
    const sit = SITUACIONES[l.tributario] ? l.tributario : 'aceptado', m = Math.round(Number(l.neto) || 0); out[sit] += m;
    if (sit === 'aceptado') return;
    const g = s(l.grupoTrib) || '_', x = out.grupos[g] || (out.grupos[g] = { id: g, nombre: (G[g] && G[g].nombre) || 'Sin trámite', regularizar: 0, no_aceptado: 0, n: 0 }); x[sit] += m; x.n++;
    out.detalle.push({ fecha: l.fecha, item: l.item, proveedor: l.proveedor, area: l.area, neto: m, situacion: sit, grupo: g });
  });
  out.noAceptados = out.regularizar + out.no_aceptado;
  out.total = out.aceptado + out.noAceptados;
  out.detalle.sort((a, b) => s(a.grupo).localeCompare(s(b.grupo)) || s(a.fecha).localeCompare(s(b.fecha)));
  return out;
}
// Las reglas de un grupo (para el trámite): qué gastos lo forman
export const reglasDeGrupo = (T, gid) => Object.values((T && T.reglas) || {}).filter(r => (r.cambios || []).some(c => c.grupo === gid));
