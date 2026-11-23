// ═══════════════════════════════════════════════
//  Sistema Fën — merma y stock de la caja  v0.4.0
//  Misma lógica que la caja v2.1.1 (index.html): el stock de cada producto
//  vive en stock/{sucursal}_{productoId}.entradas, una cantidad por lote:
//    'AAAAMMDD'              lote ingresado ese día (hoy, ayer, antes de ayer, cuarto día, última oferta)
//    'ultimaoferta_AAAAMMDD' lote pasado a mano a última oferta
//    'merma_AAAAMMDD'        enviado a merma desde Stock, falta registrarlo
//    'permanente'            productos sin vencimiento
//  Aquí: ver el stock, registrar o rescatar la merma, y el informe de merma.
//  Ingresar stock, ajustar cantidades y enviar a merma siguen en la caja.
//  Diferencias a propósito:
//  · registrar y rescatar se hacen en una transacción (dos clics o dos equipos no duplican);
//  · la merma se guarda en Firebase (v0.75.1: ya no pasa a la planilla, como la caja v2.3.0);
//  · rescatar limpia también el registro de envíos (la caja lo dejaba y la próxima
//    merma de ese producto salía con cantidades y motivos viejos).
// ═══════════════════════════════════════════════
import { auth, db, collection, doc, getDoc, getDocs, updateDoc, query, where, Timestamp, runTransaction } from './firebase.js?v=0.138.0';
import { diaLocal, productos, normalizarArea } from './caja.js?v=0.138.0';

const correo = () => (auth.currentUser && auth.currentUser.email) || '';
export const CATEGORIAS = [
  { key: 'hoy', nombre: 'Hoy' }, { key: 'ayer', nombre: 'Ayer' }, { key: 'antesayer', nombre: 'Antes de ayer' },
  { key: 'cuartoDia', nombre: 'Cuarto día' }, { key: 'ultimaOferta', nombre: 'Última oferta' }, { key: 'permanente', nombre: 'Sin vencimiento' }
];
const claveDia = (d = new Date()) => diaLocal(d).replace(/-/g, '');
export const claveAFecha = k => (k && /^\d{8}$/.test(k) ? `${k.slice(6, 8)}-${k.slice(4, 6)}-${k.slice(0, 4)}` : '');

// Categoría de un lote según cuántos días tiene (igual que getCategoriaFecha de la caja)
export function categoriaDeClave(k, hoy = diaLocal()) {
  if (!k) return 'hoy';
  if (k === 'permanente') return 'permanente';
  if (k.startsWith('merma_')) return 'merma';
  if (k.startsWith('ultimaoferta_')) return 'ultimaOferta';
  if (k.length !== 8) return 'hoy';
  const diff = Math.round((new Date(hoy + 'T00:00:00') - new Date(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T00:00:00`)) / 864e5);
  if (diff <= 0) return 'hoy';
  if (diff === 1) return 'ayer';
  if (diff === 2) return 'antesayer';
  if (diff === 3) return 'cuartoDia';
  return 'ultimaOferta';
}
// Precio de venta según la categoría (igual que getPrecioProducto de la caja)
export function precioSegun(prod, cat, hora = new Date().getHours()) {
  const p = prod || {};
  if (cat === 'hoy' || cat === 'permanente' || cat === 'merma') return p.precioHoy || p.precio || 0;
  if (cat === 'ayer') return (p.excepcionHoraria && hora < 15) ? (p.precioHoy || p.precio || 0) : (p.precioAyer || p.precioHoy || p.precio || 0);
  if (cat === 'antesayer') return p.precioAntesayer || p.precioAyer || p.precioHoy || p.precio || 0;
  if (cat === 'cuartoDia') return p.precioCuartoDia || p.precioAntesayer || p.precioAyer || p.precioHoy || p.precio || 0;
  if (cat === 'ultimaOferta') return p.precioUltimaOferta || p.precioCuartoDia || p.precioAntesayer || p.precioHoy || p.precio || 0;
  return p.precio || 0;
}

// Concilia el registro de envíos (mermaLog) con lo que de verdad hay en merma.
// La caja no limpia el registro al rescatar, así que puede traer envíos viejos; y la merma
// antigua puede no tener registro. Solo cuentan los envíos de lotes que hoy están en merma,
// sin pasar de lo que hay; lo que sobra va como "sin registro de envío".
export function conciliarMerma(data) {
  const resto = {};
  Object.entries(data.entradas || {}).forEach(([k, q]) => { if (k.startsWith('merma_') && Number(q) > 0) resto[k.slice(6)] = (resto[k.slice(6)] || 0) + Number(q); });
  const legado = Number(data.merma && data.merma.cantidad) || 0;
  const total = Object.values(resto).reduce((a, q) => a + q, 0) + legado;
  const usados = [];
  (data.mermaLog || []).slice().sort((a, b) => ((a.fecha && a.fecha.toMillis && a.fecha.toMillis()) || 0) - ((b.fecha && b.fecha.toMillis && b.fecha.toMillis()) || 0))
    .forEach(m => {
      const k = String(m.fechaKey || '').replace(/^ultimaoferta_/, '');
      const n = Math.min(Number(m.cantidad) || 0, resto[k] || 0);
      if (n > 0) { resto[k] -= n; usados.push({ ...m, cantidad: n }); }
    });
  const sobra = total - usados.reduce((a, m) => a + m.cantidad, 0);
  return { total, usados, sobra, lotes: Object.keys(resto).sort() };
}

// Lee todo el stock y lo ordena por sucursal, categoría y producto.
export async function leerStock() {
  const [sn, prods] = await Promise.all([getDocs(collection(db, 'stock')), productos()]);
  const porId = {}; prods.forEach(p => { porId[p.id] = p; });
  const areaDe = {}; for (const p of prods) areaDe[p.id] = await normalizarArea(p.area);
  const hoy = diaLocal();
  const filas = [], merma = [];
  sn.docs.forEach(d => {
    const s = d.data();
    const suc = s.sucursal || (s.productoId && d.id.endsWith('_' + s.productoId) ? d.id.slice(0, d.id.length - s.productoId.length - 1) : d.id.split('_')[0]);
    const prod = porId[s.productoId];
    if (!prod || prod.controlStock === false) return;
    const perm = prod.autoEliminar === false;
    const base = { stockId: d.id, sucursal: suc, productoId: s.productoId, nombre: prod.nombre || s.productoId, area: areaDe[s.productoId] || 'Otros' };
    const porCat = {};
    let qMerma = 0; const lotesMerma = [];
    Object.entries(s.entradas || {}).forEach(([k, q]) => {
      q = Number(q) || 0; if (q <= 0) return;
      if (perm) { if (!k.startsWith('merma_')) porCat.permanente = (porCat.permanente || 0) + q; return; } // como la caja: todo lo del producto sin vencimiento
      const cat = categoriaDeClave(k, hoy);
      if (cat === 'merma') { qMerma += q; lotesMerma.push(k.replace(/^merma_/, '')); return; }
      if (cat === 'permanente') return;
      porCat[cat] = (porCat[cat] || 0) + q;
    });
    if (!perm && s.merma && Number(s.merma.cantidad) > 0) qMerma += Number(s.merma.cantidad); // formato antiguo
    Object.entries(porCat).forEach(([cat, q]) => {
      const precio = precioSegun(prod, cat);
      filas.push({ ...base, categoria: cat, cantidad: q, precio, valor: q * precio });
    });
    if (qMerma > 0) {
      const log = conciliarMerma(s).usados;
      const ult = log[log.length - 1];
      const precio = prod.precioHoy || prod.precio || 0;
      merma.push({ ...base, cantidad: qMerma, precio, valor: qMerma * precio, ingreso: claveAFecha(lotesMerma.sort()[0]),
        envio: ult && ult.fecha && ult.fecha.toDate ? ult.fecha.toDate() : null, quien: ult ? ult.usuario || '' : '',
        motivos: [...new Set(log.map(l => l.motivo).filter(Boolean))] });
    }
  });
  return { filas, merma };
}

const fechaISO = d => diaLocal(d);
const dmyAiso = s => { const m = String(s || '').match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const diasEntre = (a, b) => { if (!a || !b) return null; const n = Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); return n >= 0 ? n : null; };

// Registrar la merma de un producto: la guarda en Firebase (colección merma) y la saca del stock,
// en una sola transacción; después la pasa a la planilla. Igual que "Registrar merma" de la caja.
export async function registrarMerma(stockId) {
  const ref = doc(db, 'stock', stockId);
  const creados = [];
  await runTransaction(db, async tx => {
    creados.length = 0;
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese stock ya no existe');
    const data = sn.data();
    const prods = await productos();
    const prod = prods.find(p => p.id === data.productoId) || {};
    const area = await normalizarArea(prod.area) || '';
    const suc = data.sucursal || stockId.slice(0, stockId.length - String(data.productoId).length - 1);
    const lotes = Object.entries(data.entradas || {}).filter(([k, q]) => Number(q) > 0 && k.startsWith('merma_'));
    const con = conciliarMerma(data);
    const cantidadTotal = con.total;
    if (cantidadTotal <= 0) throw new Error('Ese producto ya no tiene merma por registrar (¿la registró alguien recién?)');
    const ingresoISO = lotes.length ? (() => { const k = lotes.map(([k]) => k.replace(/^merma_/, '')).sort()[0]; return `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`; })() : dmyAiso(data.merma && data.merma.fecha);
    const fechaIngreso = ingresoISO ? ingresoISO.split('-').reverse().join('-') : '';
    const hoy = diaLocal();
    const precio = prod.precioHoy || prod.precio || 0;
    // Un registro por cada día en que se envió a merma (como la caja)
    const porEnvio = {};
    con.usados.forEach(m => {
      const f = m.fecha && m.fecha.toDate ? fechaISO(m.fecha.toDate()) : hoy;
      const e = porEnvio[f] || (porEnvio[f] = { cantidad: 0, motivos: [], usuario: m.usuario, aprox: false });
      e.cantidad += m.cantidad;
      if (m.motivo) e.motivos.push({ motivo: m.motivo, cantidad: m.cantidad });
    });
    // Lo que no tiene registro de envío (merma antigua): un registro aparte con fecha de hoy, marcado aproximado
    if (con.sobra > 0) porEnvio['sinlog'] = { fecha: hoy, cantidad: con.sobra, motivos: [], usuario: correo(), aprox: true };
    const marca = Date.now().toString(36);
    Object.entries(porEnvio).forEach(([clave, info], i) => {
      const fEnvio = info.fecha || clave, aprox = info.aprox;
      const id = `${stockId}-${fEnvio.replace(/-/g, '')}-${marca}${i}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
      const reg = {
        sucursal: suc, productoId: data.productoId, nombreProducto: prod.nombre || data.productoId, area, cantidad: info.cantidad,
        precioOriginal: precio, monto: info.cantidad * precio, fechaIngreso, fechaEnvio: fEnvio, fechaRegistro: hoy, fechaEnvioAprox: aprox,
        diasEnStock: diasEntre(ingresoISO, fEnvio), fecha: Timestamp.now(), usuario: info.usuario || correo(),
        motivo: info.motivos.map(m => `${m.motivo} (${m.cantidad})`).join(' · '), motivos: info.motivos,
        registradoPor: correo(), registradoDesde: 'Sistema Fën'
      };
      tx.set(doc(db, 'merma', id), reg);
      creados.push({ id, ...reg });
    });
    const cambios = { merma: null, mermaLog: [] };
    lotes.forEach(([k]) => { cambios[`entradas.${k}`] = 0; });
    tx.update(ref, cambios);
  });
  // v0.75.1: la merma queda en Firebase (informe de merma, Finanzas); ya no se copia a la planilla ni se llama al script
  return { registros: creados.length, cantidad: creados.reduce((a, m) => a + m.cantidad, 0), monto: creados.reduce((a, m) => a + m.monto, 0), malas: 0, error: '' };
}

// Rescatar: devuelve toda la merma del producto a la categoría elegida (como la caja).
export async function rescatarMerma(stockId, destino) {
  const ref = doc(db, 'stock', stockId);
  let total = 0;
  await runTransaction(db, async tx => {
    const sn = await tx.get(ref);
    if (!sn.exists()) throw new Error('Ese stock ya no existe');
    const entradas = sn.data().entradas || {};
    const desplazar = n => { const d = new Date(); d.setDate(d.getDate() - n); return claveDia(d); };
    const hoy = claveDia();
    const clave = { hoy, ayer: desplazar(1), antesayer: desplazar(2), cuartoDia: desplazar(3), ultimaOferta: 'ultimaoferta_' + hoy }[destino] || hoy;
    const cambios = {}; total = 0;
    Object.entries(entradas).forEach(([k, q]) => { if (k.startsWith('merma_') && Number(q) > 0) { cambios[`entradas.${k}`] = 0; total += Number(q); } });
    const legado = Number(sn.data().merma && sn.data().merma.cantidad) || 0;
    if (legado > 0) { total += legado; cambios.merma = null; } // formato antiguo
    if (!total) throw new Error('Ese producto ya no tiene merma (¿la registró o rescató alguien recién?)');
    cambios[`entradas.${clave}`] = (Number(entradas[clave]) || 0) + total;
    cambios.mermaLog = [];
    tx.update(ref, cambios);
  });
  return total;
}

// Registros de merma para el informe. Se agrupan por el día en que se envió a merma (fechaEnvio),
// como en la caja. Se consulta por la fecha de registro (con margen) y se filtra aquí.
export async function leerMerma(desde, hasta) {
  const [y, m, d] = desde.split('-').map(Number);
  const sn = await getDocs(query(collection(db, 'merma'), where('fecha', '>=', Timestamp.fromDate(new Date(y, m - 1, d - 21)))));
  const norm = f => (/^\d{4}-\d{2}-\d{2}$/.test(f || '') ? f : dmyAiso(f));
  return sn.docs.map(x => ({ id: x.id, ...x.data() }))
    .map(r => ({ ...r, dia: norm(r.fechaEnvio) || norm(r.fechaMerma) || (r.fecha && r.fecha.toDate ? diaLocal(r.fecha.toDate()) : '') }))
    .filter(r => r.dia >= desde && r.dia <= hasta);
}
