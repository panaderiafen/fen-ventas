// ═══════════════════════════════════════════════
//  Fën · Caja — Efectivo del turno (sin Firestore)  v3.0.0
//  Retiros e ingresos con la caja abierta, y el cálculo del cierre con fondo y retiro.
//  Aprobado por Emmanuel (bocetos "Efectivo de la caja", 30 oct 2026).
//
//  caja_movimientos/{id}: { cajaId, sucursal, tipo 'retiro' | 'ingreso', motivo, monto (siempre positivo),
//    dia 'AAAA-MM-DD' (el día de la caja), mes, detalle?, documento?, nota, por, creado,
//    pendienteAdmin (true si la caja de administración debe recibirlo), anulado?, recibido? }
//  En la caja: efectivoMovs { ingresos, retiros, nIngresos, nRetiros } (contadores, con increment).
// ═══════════════════════════════════════════════

export const MAX_MOV = 5000000;
export const FONDO_SUGERIDO = 25000;

// [clave, texto, pide, vaACajaAdmin]  pide: 'proveedor' | 'detalle' | ''
export const MOTIVOS_CAJA = {
  retiro: [
    ['pago_proveedor', 'Pago a proveedor', 'proveedor', false],
    ['caja_admin', 'A la caja de administración', '', true],
    ['otro', 'Otro', 'detalle', false],
  ],
  ingreso: [
    ['sencillo_admin', 'Sencillo de la caja de administración', '', true],
    ['aporte_dueno', 'Aporte del dueño', '', false],
    ['otro', 'Otro', 'detalle', false],
  ],
};
// Lo que se cree que pasó cuando el cierre no cuadra
export const MOTIVOS_DESCUADRE = [
  ['vuelto', 'Vuelto mal dado'],
  ['retiro_sin_anotar', 'Retiro sin anotar'],
  ['venta_sin_registrar', 'Venta sin registrar'],
  ['no_se', 'No sé'],
  ['otro', 'Otro'],
];

const motivoDe = (tipo, k) => (MOTIVOS_CAJA[tipo] || []).find(m => m[0] === k);
export const textoMotivoCaja = (tipo, k) => (k === 'cierre' ? 'Retiro al cerrar la caja' : ((motivoDe(tipo, k) || [])[1] || k || ''));
export const textoDescuadre = k => (MOTIVOS_DESCUADRE.find(m => m[0] === k) || [])[1] || '';

const limpio = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
// Acepta "18.500", "$18500", "18500"
export function leerPesos(t) {
  const s = String(t == null ? '' : t).replace(/[$\s.]/g, '');
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

// Revisa el formulario de retiro o ingreso → { error } o { mov } (sin cajaId, sucursal, quién ni cuándo)
export function revisarMovCaja(f, dia) {
  const tipo = f.tipo;
  if (tipo !== 'retiro' && tipo !== 'ingreso') return { error: 'Tipo desconocido.' };
  const monto = leerPesos(f.monto);
  if (!(monto > 0)) return { error: 'Escriba un monto mayor que 0.' };
  if (monto > MAX_MOV) return { error: 'El monto es demasiado grande. Revíselo.' };
  const m = motivoDe(tipo, f.motivo);
  if (!m) return { error: tipo === 'retiro' ? 'Elija para qué es el retiro.' : 'Elija de dónde viene el ingreso.' };
  const mov = { tipo, motivo: m[0], monto, dia, mes: String(dia || '').slice(0, 7), nota: limpio(f.nota, 200), pendienteAdmin: m[3] };
  if (m[2] === 'proveedor') {
    const p = limpio(f.detalle, 120);
    if (p.length < 2) return { error: 'Escriba a qué proveedor se le pagó.' };
    mov.detalle = p;
    mov.documento = limpio(f.documento, 40);
    mov.estado = 'por_unir'; // se une a su boleta o factura en Sistema Fën → Gastos
  }
  if (m[2] === 'detalle') {
    const d = limpio(f.detalle, 120);
    if (d.length < 2) return { error: 'Escriba de qué se trata.' };
    mov.detalle = d;
  }
  return { mov };
}

// Lo que suma (+) o resta (−) al efectivo de la caja
export function efectoCaja(m) {
  if (!m || m.anulado) return 0;
  const n = Math.round(Number(m.monto) || 0);
  return m.tipo === 'ingreso' ? n : m.tipo === 'retiro' ? -n : 0;
}

// Contadores de la caja → { ingresos, retiros, nIngresos, nRetiros }
export function movsDeCaja(caja) {
  const e = (caja && caja.efectivoMovs) || {};
  const n = k => Math.max(0, Math.round(Number(e[k]) || 0));
  return { ingresos: n('ingresos'), retiros: n('retiros'), nIngresos: n('nIngresos'), nRetiros: n('nRetiros') };
}

// Efectivo que debería haber en la caja = fondo inicial + ventas en efectivo + ingresos − retiros
export function deberiaHaber(caja) {
  const c = caja || {};
  const m = movsDeCaja(c);
  return (Math.round(Number(c.montoInicial) || 0)) + (Math.round(Number((c.totales || {}).efectivo) || 0)) + m.ingresos - m.retiros;
}

// Cálculo del cierre del efectivo. contado: lo que se contó; fondo: lo que queda para el turno siguiente.
// → { deberia, contado, diferencia (contado − debería; + sobra, − falta), fondo, retiro, error? }
export function calcularCierreEfectivo(caja, contado, fondo) {
  const deberia = deberiaHaber(caja);
  const c = Math.round(Number(contado) || 0);
  let f = Math.round(Number(fondo));
  const r = { deberia, contado: c, diferencia: c - deberia, fondo: f, retiro: 0 };
  if (!(c >= 0)) return { ...r, error: 'Escriba cuánto efectivo contó.' };
  if (!(f >= 0)) return { ...r, error: 'Escriba el fondo que queda (puede ser 0).' };
  if (f > c) return { ...r, error: 'El fondo no puede ser mayor que lo contado.' };
  r.retiro = c - f;
  return r;
}

// Fondo sugerido: $25.000, o lo contado si es menos
export const fondoSugerido = contado => Math.max(0, Math.min(FONDO_SUGERIDO, Math.round(Number(contado) || 0)));

export const pesos = n => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('es-CL');
