// ═══════════════════════════════════════════════
//  Sistema Fën — agenda  v0.16.0
//  Dos colecciones (reglas v1.3.0):
//   · agenda           lo de Fën: lo ve la administración.
//   · agenda_personal  lo personal: solo lo ve y lo cambia quien lo creó, y no
//                      entra en ningún informe de Fën.
//  Nada se borra: "Quitar" lo marca quitado (queda en Firebase).
//  Las consultas usan un solo campo (no necesitan índices).
//  v0.16.0: etiquetas con color (config/agenda), fecha de término, repetir cada
//  semana o cada mes (con días quitados y "hecho" por día) y copia a Google Calendar.
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, query, where, Timestamp, runTransaction } from './firebase.js?v=0.138.0';

const correo = () => (auth.currentUser && auth.currentUser.email) || '';
const uid = () => (auth.currentUser && auth.currentUser.uid) || '';
const COL = { fen: 'agenda', personal: 'agenda_personal' };
export const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const p2 = n => String(n).padStart(2, '0');
export const diaTxt = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const masDias = (f, n) => { const [y, m, d] = f.split('-').map(Number); return diaTxt(new Date(y, m - 1, d + n)); };
const diaSemana = f => { const [y, m, d] = f.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const ultimoDelMes = f => { const [y, m] = f.split('-').map(Number); return new Date(y, m, 0).getDate(); };

// ── Etiquetas ──
export const COLORES = ['azul', 'verde', 'amarillo', 'lila', 'rosa', 'naranja', 'turquesa', 'gris'];
export const ETIQUETAS_BASE = [
  { id: 'conciliacion', nombre: 'Conciliación', color: 'azul' }, { id: 'sii', nombre: 'Cargas del SII', color: 'amarillo' },
  { id: 'reunion', nombre: 'Reuniones', color: 'lila' }, { id: 'cobranza', nombre: 'Cobranza', color: 'verde' },
  { id: 'marketing', nombre: 'Marketing', color: 'rosa' }, { id: 'habilitacion', nombre: 'Habilitación', color: 'naranja' },
  { id: 'apps', nombre: 'Revisión de apps', color: 'turquesa' }
];
export async function leerEtiquetas() {
  const sn = await getDoc(doc(db, 'config', 'agenda'));
  const l = sn.exists() && Array.isArray(sn.data().etiquetas) ? sn.data().etiquetas : ETIQUETAS_BASE;
  return l.filter(e => e && e.id && e.nombre);
}
// lista completa (también las archivadas: archivada:true); nunca se borra una etiqueta usada
export async function guardarEtiquetas(lista) {
  const l = lista.map(e => ({ id: String(e.id), nombre: String(e.nombre || '').trim().slice(0, 40), color: COLORES.includes(e.color) ? e.color : 'gris', archivada: !!e.archivada }));
  if (l.some(e => !e.nombre)) throw new Error('Cada etiqueta necesita un nombre');
  await setDoc(doc(db, 'config', 'agenda'), { etiquetas: l, editado: Timestamp.now(), editadoPor: correo() });
  return l;
}
export const nuevaEtiquetaId = nombre => String(nombre || 'etiqueta').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + Date.now().toString(36).slice(-4);

// ── Leer: lo de un rango de días, con los que se repiten y los de varios días ya abiertos ──
// desde / hasta: 'AAAA-MM-DD', ambos incluidos. Devuelve un elemento por día.
export async function leerAgenda(desde, hasta) {
  const [fen, rep, largos, per] = await Promise.all([
    getDocs(query(collection(db, COL.fen), where('fecha', '>=', desde))),
    getDocs(query(collection(db, COL.fen), where('repite', '==', true))),
    getDocs(query(collection(db, COL.fen), where('fechaFin', '>=', desde))),
    getDocs(query(collection(db, COL.personal), where('uid', '==', uid())))
  ]);
  const docs = new Map();
  [fen, rep, largos].forEach(sn => sn.docs.forEach(d => docs.set('fen/' + d.id, { id: d.id, tipo: 'fen', ...d.data() })));
  per.docs.forEach(d => docs.set('personal/' + d.id, { id: d.id, tipo: 'personal', ...d.data() }));
  const lista = [];
  docs.forEach(x => { if (!x.quitado) expandir(x, desde, hasta).forEach(o => lista.push(o)); });
  return lista.sort((a, b) => (a.fecha + (a.hora || '99:99')).localeCompare(b.fecha + (b.hora || '99:99')));
}
// Un documento → sus días dentro del rango
export function expandir(x, desde, hasta) {
  const out = [];
  if (x.repite && x.repetir) {
    const fin = x.repetirHasta && x.repetirHasta < hasta ? x.repetirHasta : hasta, quitados = new Set(x.excepciones || []);
    const dia0 = Number(x.fecha.slice(8, 10));
    for (let d = x.fecha > desde ? x.fecha : desde, n = 0; d <= fin && n < 400; d = masDias(d, 1), n++) {
      const toca = x.repetir.tipo === 'semanal' ? (x.repetir.dias || []).includes(diaSemana(d))
        : x.repetir.tipo === 'mensual' ? Number(d.slice(8, 10)) === Math.min(dia0, ultimoDelMes(d)) : false;
      if (toca && !quitados.has(d)) out.push({ ...x, fecha: d, fechaBase: x.fecha, serie: true, hecho: !!(x.hechos || {})[d] });
    }
    return out;
  }
  const fin = x.fechaFin && x.fechaFin > x.fecha ? x.fechaFin : x.fecha;
  if (fin < desde || x.fecha > hasta) return out;
  for (let d = x.fecha > desde ? x.fecha : desde, n = 0; d <= fin && d <= hasta && n < 400; d = masDias(d, 1), n++) {
    out.push({ ...x, fecha: d, fechaBase: x.fecha, tramo: fin > x.fecha ? { de: x.fecha, a: fin } : null });
  }
  return out;
}

function limpiar(d) {
  const titulo = String(d.titulo || '').trim().slice(0, 120);
  if (!titulo) throw new Error('Escribe qué es');
  if (!DIA_RE.test(d.fecha || '')) throw new Error('Elige la fecha');
  const hora = String(d.hora || '').trim();
  if (hora && !HORA_RE.test(hora)) throw new Error('La hora no es válida');
  const r = { titulo, fecha: d.fecha, hora, nota: String(d.nota || '').trim().slice(0, 500), etiqueta: String(d.etiqueta || '').slice(0, 40) };
  // Repetir: semanal (días 0 = domingo … 6) o mensual (el mismo día del mes); con o sin fecha de término
  const rp = d.repetir && ['semanal', 'mensual'].includes(d.repetir.tipo) ? d.repetir : null;
  if (rp) {
    const dias = rp.tipo === 'semanal' ? [...new Set((rp.dias || []).map(Number))].filter(n => n >= 0 && n <= 6).sort() : [];
    if (rp.tipo === 'semanal' && !dias.length) throw new Error('Elige qué días de la semana');
    if (rp.tipo === 'mensual' && Number(d.fecha.slice(8, 10)) > 28) throw new Error('Para repetir cada mes, empieza un día del 1 al 28 (no todos los meses tienen 29, 30 o 31)');
    const hasta = String(d.repetirHasta || '');
    if (hasta && (!DIA_RE.test(hasta) || hasta < d.fecha)) throw new Error('"Se repite hasta" no puede ser antes del primer día');
    Object.assign(r, { repite: true, repetir: rp.tipo === 'semanal' ? { tipo: 'semanal', dias } : { tipo: 'mensual' }, repetirHasta: hasta, fechaFin: '' });
  } else {
    const fin = String(d.fechaFin || '');
    if (fin && (!DIA_RE.test(fin) || fin < d.fecha)) throw new Error('"Hasta" no puede ser antes de "Desde"');
    Object.assign(r, { repite: false, repetir: null, repetirHasta: '', fechaFin: fin && fin > d.fecha ? fin : '' });
  }
  // Google Calendar: copiar (sí/no) y aviso en minutos (-1 sin aviso)
  const aviso = Number(d.aviso);
  r.gcal = { copiar: !!d.copiarGcal, aviso: Number.isFinite(aviso) ? Math.max(-1, Math.min(40320, Math.round(aviso))) : -1 };
  return r;
}

// Agregar o cambiar (si es de una serie, cambia la serie entera). Si cambia de Fën a personal (o al revés),
// se crea en la otra colección y el original queda quitado (con la referencia a dónde se fue).
// El id del evento en Google (gcal.id) lo escribe solo anotarGcal: aquí se lee el documento al día para no pisarlo.
// gcalVer sube con cada cambio: así una copia que estaba en curso no marca como copiado algo que cambió después.
async function actual(item) { const sn = await getDoc(doc(db, COL[item.tipo], item.id)); return sn.exists() ? sn.data() : {}; }
const marcaGcal = (a, copiar) => ({ gcalPendiente: !!(copiar || (a.gcal && a.gcal.id)), gcalVer: (Number(a.gcalVer) || 0) + 1 });
export async function guardar(item, datos, tipo) {
  const c = limpiar(datos);
  const ahora = Timestamp.now();
  const a = item ? await actual(item) : {};
  if (item && item.tipo === tipo) {
    const { gcal, ...resto } = c;
    await updateDoc(doc(db, COL[tipo], item.id), { ...resto, 'gcal.copiar': gcal.copiar, 'gcal.aviso': gcal.aviso, ...marcaGcal(a, gcal.copiar), editado: ahora, editadoPor: correo() });
    return { id: item.id, tipo };
  }
  const base = { ...c, gcal: { ...c.gcal, id: '' }, gcalPendiente: !!c.gcal.copiar, gcalVer: 1, hechos: a.hechos || {}, excepciones: a.excepciones || [],
    hecho: item ? !!a.hecho : false, quitado: false, creado: ahora, creadoPor: correo(), origen: 'manual' };
  const nuevo = await addDoc(collection(db, COL[tipo]), tipo === 'personal' ? { ...base, uid: uid() } : base);
  if (item) await updateDoc(doc(db, COL[item.tipo], item.id), { quitado: true, quitadoEn: ahora, movidoA: COL[tipo] + '/' + nuevo.id, ...marcaGcal(a, false) });
  return { id: nuevo.id, tipo, antes: item ? { id: item.id, tipo: item.tipo } : null };
}
// Hecho: en una serie, solo ese día
export async function marcarHecho(item, hecho) {
  const ref = doc(db, COL[item.tipo], item.id);
  if (item.serie) {
    const actual = (await getDoc(ref)).data() || {}, h = { ...(actual.hechos || {}) };
    if (hecho) h[item.fecha] = true; else delete h[item.fecha];
    return updateDoc(ref, { hechos: h });
  }
  return updateDoc(ref, { hecho: !!hecho, hechoEn: hecho ? Timestamp.now() : null });
}
// Quitar: todo (o en una serie, solo ese día)
export async function quitar(item, soloEsteDia) {
  const ref = doc(db, COL[item.tipo], item.id);
  const a = await actual(item);
  if (item.serie && soloEsteDia) return updateDoc(ref, { excepciones: [...new Set((a.excepciones || []).concat([item.fecha]))].sort(), ...marcaGcal(a, a.gcal && a.gcal.copiar) });
  return updateDoc(ref, { quitado: true, quitadoEn: Timestamp.now(), quitadoPor: correo(), ...marcaGcal(a, false) });
}

// ── Copia a Google Calendar (la hace el script de Gastos v2.6.0 con la cuenta de Google del dueño) ──
// Pendientes: lo que cambió y todavía no se copió
export async function pendientesGcal() {
  const [fen, per] = await Promise.all([
    getDocs(query(collection(db, COL.fen), where('gcalPendiente', '==', true))),
    getDocs(query(collection(db, COL.personal), where('uid', '==', uid())))
  ]);
  return fen.docs.map(d => ({ id: d.id, tipo: 'fen', ...d.data() })).concat(per.docs.map(d => ({ id: d.id, tipo: 'personal', ...d.data() })).filter(x => x.gcalPendiente));
}
// Lo que se manda al script por cada documento
export function paraCalendario(x, etiquetas) {
  const g = x.gcal || {}, et = (etiquetas || []).find(e => e.id === x.etiqueta);
  const quitar = x.quitado || !g.copiar;
  return { ref: `${x.tipo}/${x.id}`, ver: Number(x.gcalVer) || 0, accion: quitar ? 'quitar' : 'poner', gcalId: g.id || '', titulo: x.titulo, fecha: x.fecha, fechaFin: x.fechaFin || '', hora: x.hora || '',
    nota: [x.nota || '', et ? 'Etiqueta: ' + et.nombre : '', x.tipo === 'personal' ? 'Personal' : ''].filter(Boolean).join('\n'),
    repetir: x.repite ? x.repetir : null, repetirHasta: x.repetirHasta || '', excepciones: x.excepciones || [], aviso: Number.isFinite(g.aviso) ? g.aviso : -1, color: et ? et.color : (x.tipo === 'personal' ? 'lila' : 'verde') };
}
// Anota el resultado del script en cada documento
// Si el documento cambió mientras se copiaba (gcalVer distinto), queda pendiente para la próxima (con el id nuevo).
export async function anotarGcal(docs, resultados) {
  for (const r of resultados || []) {
    const x = docs.find(d => `${d.tipo}/${d.id}` === r.ref); if (!x) continue;
    const ref = doc(db, COL[x.tipo], x.id), ver = Number(x.gcalVer) || 0;
    await runTransaction(db, async tx => {
      const sn = await tx.get(ref); if (!sn.exists()) return;
      const igual = (Number(sn.data().gcalVer) || 0) === ver;
      if (r.ok) tx.update(ref, { 'gcal.id': r.gcalId || '', 'gcal.error': '', 'gcal.copiadoEn': Timestamp.now(), gcalPendiente: !igual });
      else tx.update(ref, { 'gcal.error': String(r.error || 'No se pudo copiar').slice(0, 200) });
    });
  }
}

// ── Pagos de Gastos que todavía no se generan (cada obligación crea su pago 3 días antes) ──
// Igual que el script de Gastos (calcularOcurrenciaDesde): mensual un día, último del mes, quincenal (1 y 15)
function siguienteOcurrencia(frecuencia, dia, ref) {
  const [y, m] = ref.split('-').map(Number);
  if (frecuencia === 'mensual_dia') { const n = parseInt(dia, 10); if (!(n >= 1 && n <= 31)) return null; let f = diaTxt(new Date(y, m - 1, n)); if (f < ref) f = diaTxt(new Date(y, m, n)); return f; }
  if (frecuencia === 'mensual_ultimo') { let f = diaTxt(new Date(y, m, 0)); if (f < ref) f = diaTxt(new Date(y, m + 1, 0)); return f; }
  if (frecuencia === 'quincenal') return [new Date(y, m - 1, 1), new Date(y, m - 1, 15), new Date(y, m, 1), new Date(y, m, 15)].map(diaTxt).find(f => f >= ref) || null;
  return null;
}
export function proyectarObligaciones(plantillas, vencimientos, desde, hasta) {
  const hay = new Set((vencimientos || []).map(v => `${v.plantillaId}|${v.fecha}`)), out = [];
  const item = (p, f) => ({ auto: true, cat: 'pago', proyectado: true, fecha: f, titulo: `Pago de ${p.nombre}`, monto: Number(String(p.montoEstimado || '').replace(/[^0-9]/g, '')) || 0, sub: 'Próximo pago (se activa 3 días antes)', url: '#gastos/config/cuentas' });
  (plantillas || []).filter(p => p.estado === 'ACTIVA' && p.proximaFecha && p.frecuencia !== 'cuponera').forEach(p => {
    if (p.frecuencia === 'variable') { const f = p.proximaFecha; if (f >= desde && f <= hasta && !hay.has(`${p.id}|${f}`)) out.push(item(p, f)); return; }
    for (let f = p.proximaFecha, n = 0; f && f <= hasta && n < 80; f = siguienteOcurrencia(p.frecuencia, p.dia, masDias(f, 1)), n++) {
      if (f >= desde && !hay.has(`${p.id}|${f}`)) out.push(item(p, f));
    }
  });
  return out;
}
