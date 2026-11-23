// ═══════════════════════════════════════════════
//  Sistema Fën — Mi ritmo  v0.127.0
//  El ritmo de trabajo de la semana, en Hoy (Etapa 6 de "Arreglos desde el uso real", pedida por Emmanuel el 11 y 12 nov).
//  · Bloques: nombre, días de la semana, hora de inicio y fin, cada semana o semana por medio (A/B), y sus tareas.
//    Los turnos (cafetería, panadería) van como referencia, sin tareas.
//  · Tareas: nombre y pantalla a la que lleva; algunas se marcan solas cuando el sistema lo ve hecho (del resumen de Gastos).
//  · Lo del mes: tareas por día del mes (RCV, Previred, cierre, conteo de bodega).
//  · Se guarda en config/miRitmo (lo que se ve) y config/miRitmoHechos (las casillas de los últimos 21 días). Sin reglas nuevas.
//  · Lo que no se hizo en un bloque no pasa al siguiente (decidido el 12 nov): lo pendiente se ve en la cifra de cada tarea.
// ═══════════════════════════════════════════════
import { db, doc, getDoc, setDoc, runTransaction } from './firebase.js?v=0.138.0';

const p2 = n => String(n).padStart(2, '0');
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const diaTxt = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const deTxt = f => { const [y, m, d] = String(f).split('-').map(Number); return new Date(y, m - 1, d); };
export const masDias = (f, n) => { const d = deTxt(f); d.setDate(d.getDate() + n); return diaTxt(d); };
export const diaSemana = f => deTxt(f).getDay();
// Semana ISO: A las pares, B las impares (el 12 nov 2026, semana 46, es A)
export function semanaISO(f) {
  const d = deTxt(f); d.setHours(12); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const s1 = new Date(d.getFullYear(), 0, 4); s1.setHours(12);
  return 1 + Math.round(((d - s1) / 864e5 - 3 + ((s1.getDay() + 6) % 7)) / 7);
}
export const semanaAB = f => (semanaISO(f) % 2 === 0 ? 'A' : 'B');

// Adónde lleva una tarea
export const DESTINOS = [
  ['', 'Sin pantalla'], ['#gastos', 'Gastos · Bandeja'], ['#gastos/porpagar', 'Gastos · Por pagar'], ['#gastos/previred', 'Gastos · Previred'],
  ['#b2b', 'Ventas a empresas · Por facturar'], ['#b2b/conciliacion', 'Ventas a empresas · Conciliación'], ['#b2b/cobranza', 'Ventas a empresas · Cobranza'],
  ['#efectivo', 'Efectivo'], ['#caja', 'Ventas en tienda · Cierres'], ['#caja/transferencias', 'Ventas en tienda · Transferencias'],
  ['#finanzas/resultados/cierre', 'Finanzas · Cierre de mes']
];
// Lo que el sistema puede comprobar solo (del resumen de Gastos, que se guarda al abrir Gastos)
export const AUTOS = [
  ['', 'A mano'], ['cartola', 'Se marca sola: cartola subida hoy'], ['bandeja', 'Se marca sola: nada por unir en la Bandeja'], ['clasificar', 'Se marca sola: nada sin clasificar']
];
const T = (id, nombre, ruta, auto = '') => ({ id, nombre, ruta, auto });
// El ritmo con que parte (lo acordado el 12 nov); se edita en "Editar mi ritmo"
export const RITMO_BASE = {
  v: 1,
  bloques: [
    { id: 'caf_lmx', nombre: 'Cafetería', tipo: 'turno', dias: [1, 2, 3], ini: '07:30', fin: '13:00', cada: 'siempre' },
    { id: 'pan_lmx', nombre: 'Panadería', tipo: 'turno', dias: [1, 2, 3], ini: '13:30', fin: '16:00', cada: 'siempre' },
    { id: 'pan_jv', nombre: 'Panadería', tipo: 'turno', dias: [4, 5], ini: '10:00', fin: '13:00', cada: 'siempre' },
    { id: 'pan_s', nombre: 'Panadería', tipo: 'turno', dias: [6], ini: '09:30', fin: '12:30', cada: 'siempre' },
    { id: 'caf_s', nombre: 'Cafetería', tipo: 'turno', dias: [6], ini: '14:30', fin: '20:00', cada: 'siempre' },
    { id: 'adm_corta', nombre: 'Administración corta', tipo: 'bloque', dias: [1, 2, 3], ini: '16:15', fin: '16:45', cada: 'siempre', nota: 'Solo lo del día: lo que no cabe, espera al jueves.',
      tareas: [T('cartola', 'Subir la cartola en línea', '#gastos', 'cartola'), T('bandeja', 'Unir los cargos del día', '#gastos', 'bandeja'), T('sobres', 'Recibir sobres de efectivo', '#efectivo'), T('facturar', 'Facturación del día', '#b2b')] },
    { id: 'adm_fondo', nombre: 'Administración de fondo', tipo: 'bloque', dias: [4], ini: '13:30', fin: '17:30', cada: 'siempre',
      tareas: [T('cartola', 'Subir la cartola en línea', '#gastos', 'cartola'), T('abonos', 'Revisar abonos que calzan', '#b2b/conciliacion'), T('atrasados', 'Conciliar Atrasados', '#gastos', 'bandeja'),
        T('cobranza', 'Cobranza: recordatorios', '#b2b/cobranza'), T('clasificar', 'Documentos sin clasificar', '#gastos', 'clasificar'), T('transf', 'Cuadre de Transferencias de la tienda', '#caja/transferencias')] },
    { id: 'pasteleria', nombre: 'Pastelería', tipo: 'bloque', dias: [5], ini: '13:30', fin: '17:30', cada: 'siempre', nota: 'Sin pantalla: solo pastelería.', tareas: [] },
    { id: 'arreglos_a', nombre: 'Arreglos', tipo: 'bloque', dias: [5], ini: '07:30', fin: '09:30', cada: 'A', tareas: [] },
    { id: 'arreglos_b', nombre: 'Arreglos', tipo: 'bloque', dias: [4], ini: '07:30', fin: '09:30', cada: 'B', tareas: [] },
    { id: 'descanso', nombre: 'Descanso', tipo: 'bloque', dias: [6], ini: '12:30', fin: '14:30', cada: 'siempre', nota: 'Entre dos turnos: sin trabajo.', tareas: [] }
  ],
  mes: [
    { id: 'rcv', nombre: 'RCV y liquidaciones', desde: 1, hasta: 5, ruta: '#gastos' },
    { id: 'previred', nombre: 'Previred y F30-1', desde: 1, hasta: 12, ruta: '#gastos/previred' },
    { id: 'cierre', nombre: 'Cierre del mes anterior', desde: 13, hasta: 13, ruta: '#finanzas/resultados/cierre' },
    { id: 'conteo', nombre: 'Conteo de bodega', ultimo: true, ruta: '' }
  ]
};

const minutos = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
export const tocaEseDia = (b, f) => (b.dias || []).includes(diaSemana(f)) && (!b.cada || b.cada === 'siempre' || b.cada === semanaAB(f));
// Los bloques de un día, por hora
export const bloquesDelDia = (R, f) => (R.bloques || []).filter(b => tocaEseDia(b, f)).sort((a, b) => a.ini.localeCompare(b.ini));
// El bloque de trabajo (no turno) que toca ahora, o el próximo de hoy; y los que vienen (hasta 3, en los próximos 7 días)
export function enHoy(R, f, hhmm) {
  const m = minutos(hhmm), deHoy = bloquesDelDia(R, f).filter(b => b.tipo !== 'turno');
  const ahora = deHoy.find(b => minutos(b.ini) <= m && m < minutos(b.fin)) || null;
  const luego = deHoy.find(b => minutos(b.ini) > m) || null;
  const vienen = [];
  for (let i = 0; i < 8 && vienen.length < 3; i++) {
    const d = masDias(f, i);
    bloquesDelDia(R, d).filter(b => b.tipo !== 'turno' && (i > 0 || minutos(b.ini) > m) && b !== ahora).forEach(b => { if (vienen.length < 3) vienen.push({ dia: d, b }); });
  }
  return { ahora, luego, vienen };
}
// Lo del mes que toca hoy
export function delMes(R, f) {
  const d = deTxt(f), dia = d.getDate(), ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (R.mes || []).filter(x => (x.ultimo ? dia === ult : dia >= Number(x.desde) && dia <= Number(x.hasta || x.desde)));
}
// El estado de una tarea: { hecho, auto (lo marcó el sistema), cuenta (lo que falta, si se sabe) }. G: resumen de Gastos
export function estadoTarea(t, G, f, hechas) {
  const n = (G && G.n) || null, auto = t.auto || '';
  let cuenta = null, solo = false;
  if (auto === 'cartola') solo = !!(G && G.cartolaEn && G.cartolaEn === f);
  if (auto === 'bandeja' && n) { cuenta = (Number(n.pares) || 0) + (Number(n.sinDoc) || 0) + (Number(n.sinPago) || 0); solo = cuenta === 0; }
  if (auto === 'clasificar' && n) { cuenta = Number(n.clasificar) || 0; solo = cuenta === 0; }
  return { hecho: solo || (hechas || []).includes(t.id), auto: solo, cuenta };
}

// Revisa y limpia un ritmo antes de guardarlo (texto acotado, horas válidas, días 0-6)
export function limpiar(R) {
  const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const id = (v, i) => s(v, 40).replace(/[^\w-]/g, '') || 'b' + i + '_' + Date.now().toString(36);
  const rutas = DESTINOS.map(d => d[0]), autos = AUTOS.map(a => a[0]);
  const bloques = (R.bloques || []).map((b, i) => {
    const x = { id: id(b.id, i), nombre: s(b.nombre, 60), tipo: b.tipo === 'turno' ? 'turno' : 'bloque', dias: [...new Set((b.dias || []).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
      ini: HORA_RE.test(b.ini) ? b.ini : '', fin: HORA_RE.test(b.fin) ? b.fin : '', cada: ['A', 'B'].includes(b.cada) ? b.cada : 'siempre', nota: s(b.nota, 160) };
    if (!x.nombre) throw new Error('Cada bloque necesita un nombre.');
    if (!x.dias.length) throw new Error(`Elija los días de "${x.nombre}".`);
    if (!x.ini || !x.fin || x.fin <= x.ini) throw new Error(`Revise el horario de "${x.nombre}": la hora de fin debe ser después de la de inicio.`);
    x.tareas = x.tipo === 'turno' ? [] : (b.tareas || []).filter(t => s(t.nombre, 80)).slice(0, 15).map((t, j) => ({ id: id(t.id, j), nombre: s(t.nombre, 80), ruta: rutas.includes(t.ruta) ? t.ruta : '', auto: autos.includes(t.auto) ? t.auto : '' }));
    return x;
  });
  const mes = (R.mes || []).filter(x => s(x.nombre, 80)).map((x, i) => ({ id: id(x.id, i), nombre: s(x.nombre, 80), ruta: rutas.includes(x.ruta) ? x.ruta : '',
    ...(x.ultimo ? { ultimo: true } : { desde: Math.min(31, Math.max(1, Number(x.desde) || 1)), hasta: Math.min(31, Math.max(Number(x.desde) || 1, Number(x.hasta) || Number(x.desde) || 1)) }) }));
  return { v: 1, bloques, mes };
}

// ── Firestore (config/miRitmo y config/miRitmoHechos) ──
export async function leer() {
  const sn = await getDoc(doc(db, 'config', 'miRitmo'));
  return sn.exists() && Array.isArray(sn.data().bloques) ? sn.data() : RITMO_BASE;
}
export async function guardar(R, por) {
  const x = limpiar(R);
  await setDoc(doc(db, 'config', 'miRitmo'), { ...x, por: String(por || ''), en: new Date().toISOString() });
  return x;
}
export async function leerHechos(f) {
  const sn = await getDoc(doc(db, 'config', 'miRitmoHechos'));
  return (sn.exists() && sn.data().dias && sn.data().dias[f]) || {};
}
// Marca o desmarca una tarea de un bloque en un día; guarda solo los últimos 21 días
export async function marcar(f, bloqueId, tareaId, hecho) {
  const ref = doc(db, 'config', 'miRitmoHechos');
  return runTransaction(db, async tx => {
    const sn = await tx.get(ref), dias = (sn.exists() && sn.data().dias) || {}, corte = masDias(f, -21);
    const d = { ...(dias[f] || {}) }, l = new Set(d[bloqueId] || []);
    if (hecho) l.add(tareaId); else l.delete(tareaId);
    d[bloqueId] = [...l];
    const nuevos = Object.fromEntries(Object.entries({ ...dias, [f]: d }).filter(([k]) => k >= corte));
    tx.set(ref, { dias: nuevos });
    return d;
  });
}
