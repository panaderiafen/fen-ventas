// fën caja v2.8.0 · código
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, query, where, orderBy, Timestamp, increment, arrayUnion, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrG2mij1h5wZ2lIyAYMTfgG9avaVnjcaU",
  authDomain: "fen-ventas.firebaseapp.com",
  projectId: "fen-ventas",
  storageBucket: "fen-ventas.firebasestorage.app",
  messagingSenderId: "265179393436",
  appId: "1:265179393436:web:75f74773c0cb992ca3ac59"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── v2.3.0: la caja ya no llama a Apps Script ──────────────────────────────
// Los cierres, la merma, las anulaciones y los descuadres quedan solo en Firestore (Sistema Fën los lee de ahí).
// Los productos se crean y se cambian solo en Sistema Fën → Catálogo; la caja los pide (solicitudes_producto).

// ─── v2.3.1: vuelven solo los dos correos a la administración ───────────────
// El de la solicitud de anulación y el del descuadre al cerrar caja. Nada más va a Apps Script (ni planillas ni CSV).
// Script de caja/merma/anulaciones (caja/webhook-caja): aquí solo el correo de la solicitud de anulación
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx7eYgaVGK5NBFcmX5rVr2H_QiLIuRKS7oBwiVfy5_74icgNnKvD_WEkYD92dU-fddv1A/exec';
// Script de ventas mensuales y descuadres (caja/webhook-ventas): aquí solo el correo del descuadre
const APPS_SCRIPT_URL_VENTAS_FEN = 'https://script.google.com/macros/s/AKfycbxeA_xhOm83PlYgLzv7wP5N6AM-ogfrfTClrs91JzFWgi5HCSgIRwgzAuGIbd6WsukrNQ/exec';

// Envía un aviso por correo sin esperar: no devuelve nada ni lanza errores, así el cierre y la anulación siguen
// aunque el script no responda (los datos ya están en Firestore). Como en la v2.2.0: lleva el token de sesión de
// Firebase de quien está conectada y una clave única (idem) para que un envío repetido no llegue dos veces; si Google
// desvía el POST (llega como GET sin datos, code 'version'), se reintenta por GET con los mismos datos.
function avisarPorCorreo(url, datos) {
  (async () => {
    if (url !== APPS_SCRIPT_URL && url !== APPS_SCRIPT_URL_VENTAS_FEN) return;
    if (auth.currentUser) datos.idToken = await auth.currentUser.getIdToken();
    if (!datos.idem && datos.tipo === 'solicitud_anulacion' && datos.solicitudId) datos.idem = ('anul-' + datos.solicitudId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
    datos.idem = datos.idem || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    const cuerpo = JSON.stringify(datos);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cuerpo });
    try {
      const d = await res.clone().json();
      if (d && d.code === 'version') await fetch(url + '?p=' + encodeURIComponent(cuerpo));
    } catch (e) {}
  })().catch(e => console.error('No se pudo enviar el aviso por correo (' + (datos && datos.tipo) + '):', e));
}

function escHtml(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
// Todos los productos (también inactivos), leídos una sola vez por sesión.
let _prodsTodosCache = null;
async function productosEnMemoria() {
  if (typeof _todosProdsAdmin !== 'undefined' && _todosProdsAdmin.length) return _todosProdsAdmin;
  if (_prodsTodosCache) return _prodsTodosCache;
  const sn = await getDocs(collection(db, 'productos'));
  _prodsTodosCache = sn.docs.map(d => ({ id: d.id, ...d.data() }));
  return _prodsTodosCache;
}
function fechaDMY(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('-') : (iso || ''); }

// ═══════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════
let usuario = null;
let sucursal = null;
let productos = [];
let catActiva = 'TODOS';
let pedidoLineas = [];
// ── Mesas ──
let modoVenta = 'directa'; // 'directa' | 'mesas' | 'mesa-detail'
let mesaActivaId = null;
let mesaActivaNombre = '';
// Última venta registrada — permite reimprimir la comanda con "🖨 Comanda" aunque el carrito ya esté vacío
let ultimaVentaRegistrada = null;
// Caché de las ventas del turno visible (id → datos completos), para poder reimprimir cualquiera de ellas
let ventasTurnoCache = {};

window.reimprimirVentaTurno = function(ventaId) {
  const v = ventasTurnoCache[ventaId];
  if (!v) { alert('No se encontró esa venta para reimprimir'); return; }
  imprimirComanda(v);
};
// ── Pago dividido ──
let pagoDividido = false;
let medioSeleccionado = 'efectivo';
let descTipo = 'pct';
let cajaId = null;
let esAdmin = false;
let esStockViewer = false;
let visorSucursal = 'ainavillo';

// ═══════════════════════════
// AUTH
// ═══════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (user) {
    usuario = user;
    // Restaurar el ancho de papel térmico y método de impresión elegidos en este dispositivo
    const anchoSel = document.getElementById('anchoPapelSel');
    if (anchoSel) anchoSel.value = localStorage.getItem('anchoPapelMM') || '80';
    const metodoSel = document.getElementById('metodoImpresionSel');
    if (metodoSel) metodoSel.value = localStorage.getItem('metodoImpresion') || (navigator.userAgent.includes('Android') ? 'navegador' : 'qz');
    // Verificar si es admin
    const adminDoc = await getDoc(doc(db, 'admins', user.uid));
    esAdmin = adminDoc.exists();
    if (esAdmin) document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    await cargarTiposLeche();
    await cargarMotivosMerma();
    await cargarAreas(); // v2.3.0: la lista fija de Sistema Fën (no lee ni escribe Firestore)
    // Verificar si es visor de stock
    const viewerDoc = await getDoc(doc(db, 'stock_viewers', user.uid));
    esStockViewer = viewerDoc.exists() && !esAdmin; // admin siempre tiene prioridad
    if (esStockViewer) {
      await iniciarVisorStock();
    } else {
      mostrarSucursal();
    }
  } else {
    mostrarLogin();
  }
});

window.login = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const btn = document.getElementById('btnLogin');
  const err = document.getElementById('loginError');
  btn.disabled = true;
  err.style.display = 'none';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    err.style.display = 'block';
    btn.disabled = false;
  }
};

window.cerrarSesion = async function() {
  if (confirm('¿Cerrar sesión?')) {
    sucursal = null;
    pedidoLineas = [];
    await signOut(auth);
  }
};

// ═══════════════════════════
// PANTALLAS
// ═══════════════════════════
function mostrarLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('sucursalScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'none';
}

function mostrarSucursal() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('sucursalScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('sucursalUsuario').textContent = `Hola, ${usuario.email}`;
}

// ══════════════════════════════════
// VISOR DE STOCK
// ══════════════════════════════════
async function iniciarVisorStock() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('sucursalScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('headerSucursal').textContent = 'Stock';
  document.getElementById('headerUsuario').textContent = usuario.email;
  // Desactivar todas las secciones y mostrar solo Stock
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.style.display = 'none');
  document.getElementById('sec-stock').classList.add('active');
  // Mostrar selector de sucursal del visor y panel resumen
  document.getElementById('visorSucursalSelector').style.display = '';
  document.getElementById('visorStockColumns').classList.add('visor-active');
  document.getElementById('visorResumenPanel').style.display = 'block';
  // Ocultar formulario de ingreso
  document.getElementById('stockIngresoForm').style.display = 'none';
  // Cargar con Ainavillo por defecto
  visorSucursal = 'ainavillo';
  sucursal = 'ainavillo';
  await cargarAreas();
  await cargarProductos();
  await cargarStockPorCategoria();
  renderResumenVisor();
}

let _visorResumenArea = '';

window.selVisorSucursal = async function(btn, suc) {
  visorSucursal = suc;
  document.querySelectorAll('.visor-suc-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (suc === 'ambas') {
    await cargarStockAmbas();
  } else {
    sucursal = suc;
    await cargarProductos();
    await cargarStockPorCategoria();
  }
  if (esStockViewer) renderResumenVisor();
};

window.selVisorResumenArea = function(btn, area) {
  _visorResumenArea = area;
  document.querySelectorAll('#visorResumenAreaBtns .area-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderResumenVisor();
};

// Renderiza el panel resumen: total por producto sumando todas las categorías
function renderResumenVisor() {
  const lista = document.getElementById('visorResumenLista');
  const areasBtns = document.getElementById('visorResumenAreaBtns');
  if (!lista) return;

  // Actualizar filtros de área
  if (areasBtns) {
    areasBtns.innerHTML = `<button class="area-filter-btn${_visorResumenArea === '' ? ' active' : ''}" onclick="selVisorResumenArea(this,'')">Todos</button>` +
      areasVisibles().map(a => `<button class="area-filter-btn${_visorResumenArea === a.id ? ' active' : ''}" onclick="selVisorResumenArea(this,'${a.id}')">${a.nombre}</button>`).join('');
  }

  const CATS = ['hoy', 'ayer', 'antesayer', 'cuartoDia'];
  const snap = window._stockMap || {};
  const resumen = {};
  const prefijo = visorSucursal === 'ambas' ? null : visorSucursal + '_';

  Object.entries(snap).forEach(([key, data]) => {
    if (prefijo && !key.startsWith(prefijo)) return;
    const prod = productos.find(p => p.id === data.productoId);
    if (!prod || prod.controlStock === false) return;
    if (_visorResumenArea && normalizarArea(prod.area) !== _visorResumenArea) return;
    const esPerm = prod.autoEliminar === false;

    if (!resumen[data.productoId]) {
      resumen[data.productoId] = { nombre: prod.nombre, area: normalizarArea(prod.area), cats: {}, total: 0, esPerm };
    }

    const entradas = data.entradas || {};
    Object.entries(entradas).forEach(([fechaKey, qty]) => {
      if (!qty || qty <= 0) return;
      const cat = getCategoriaFecha(fechaKey);
      if (esPerm) {
        // Permanentes: mostrar como "Sin venc."
        resumen[data.productoId].cats['permanente'] = (resumen[data.productoId].cats['permanente'] || 0) + qty;
        resumen[data.productoId].total += qty;
      } else if (CATS.includes(cat)) {
        resumen[data.productoId].cats[cat] = (resumen[data.productoId].cats[cat] || 0) + qty;
        resumen[data.productoId].total += qty;
      }
    });
  });

  const items = Object.values(resumen).filter(r => r.total > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  if (!items.length) { lista.innerHTML = '<div class="empty">Sin stock</div>'; return; }

  const catLabel = { hoy: 'Hoy', ayer: 'Ayer', antesayer: 'Ant.', cuartoDia: '4to', permanente: 'Sin venc.' };

  lista.innerHTML = items.map(r => {
    const { principal, fondo } = colorDeArea(r.area);
    const detalle = Object.entries(r.cats)
      .filter(([, q]) => q > 0)
      .map(([c, q]) => `${catLabel[c] || c}: ${q}`)
      .join(' · ');
    return `<div class="visor-resumen-row" style="background:${fondo};border-left:4px solid ${principal};border-radius:6px;padding:8px 10px;margin-bottom:6px">
      <div>
        <div class="visor-resumen-nombre" style="color:${principal}">${r.nombre}</div>
        <div class="visor-resumen-detalle">${detalle}</div>
      </div>
      <div class="visor-resumen-total">${r.total} ud.</div>
    </div>`;
  }).join('');
}

async function cargarStockAmbas() {
  const snap = await getDocs(collection(db, 'stock'));
  const SUCS = ['ainavillo', 'barros_arana'];
  const CATS_KEYS = ['hoy', 'ayer', 'antesayer', 'cuartoDia', 'merma', 'permanente'];

  // Agrupar por productoId, sumar cantidades usando nuevo formato entradas
  const merged = {};
  snap.docs.forEach(d => {
    const data = d.data();
    if (!SUCS.includes(data.sucursal)) return;
    const pid = data.productoId;
    if (!merged[pid]) merged[pid] = { productoId: pid, ain: {}, ba: {} };
    const sideKey = data.sucursal === 'ainavillo' ? 'ain' : 'ba';
    const entradas = data.entradas || {};
    // Calcular cantidad por categoría dinámicamente
    Object.entries(entradas).forEach(([fechaKey, qty]) => {
      if (!qty || qty <= 0) return;
      const cat = getCategoriaFecha(fechaKey);
      merged[pid][sideKey][cat] = (merged[pid][sideKey][cat] || 0) + qty;
    });
  });

  const CATS = [
    { key: 'hoy',        listaId: 'stockListaHoy',       totalId: 'totalHoy' },
    { key: 'ayer',       listaId: 'stockListaAyer',       totalId: 'totalAyer' },
    { key: 'antesayer',  listaId: 'stockListaAntesayer',  totalId: 'totalAntesayer' },
    { key: 'cuartoDia',  listaId: 'stockListaCuartoDia',  totalId: 'totalCuartoDia' },
    { key: 'permanente', listaId: 'stockListaPermanente', totalId: 'totalPermanente' },
    { key: 'merma',      listaId: 'stockListaMerma',      totalId: 'totalMerma' },
  ];

  CATS.forEach(({ key, listaId, totalId }) => {
    const cont    = document.getElementById(listaId);
    const totalEl = document.getElementById(totalId);
    if (!cont) return;

    const conStock = Object.values(merged).filter(m => {
      const prod = productos.find(p => p.id === m.productoId);
      if (!prod || prod.controlStock === false) return false;
      // Permanentes solo en su card, perecederos solo en sus cards
      if (key === 'permanente' && prod.autoEliminar !== false) return false;
      if (key !== 'permanente' && prod.autoEliminar === false) return false;
      return (m.ain[key] || 0) + (m.ba[key] || 0) > 0;
    });

    if (!conStock.length) {
      cont.innerHTML = '<div class="empty">Sin stock</div>';
      if (totalEl) totalEl.textContent = '';
      return;
    }

    let valorTotal = 0;
    cont.innerHTML = conStock.map(m => {
      const prod   = productos.find(p => p.id === m.productoId);
      const nombre = prod?.nombre || m.productoId;
      const qAin   = m.ain[key] || 0;
      const qBa    = m.ba[key]  || 0;
      const total  = qAin + qBa;
      const precio = prod ? getPrecioProducto(prod, key === 'permanente' ? 'hoy' : key) : 0;
      valorTotal  += total * precio;
      return `<div class="stock-row" style="grid-template-columns:1fr auto">
        <div>
          <div class="stock-prod-nombre">${nombre}</div>
          <div class="visor-ambas-detalle">Ain: ${qAin} · BA: ${qBa}</div>
        </div>
        <div class="visor-stock-qty">${total} ud.</div>
      </div>`;
    }).join('');
    if (totalEl) totalEl.textContent = `Total: $${valorTotal.toLocaleString('es-CL')}`;
  });
}

window.selSucursal = async function(s) {
  // v2.4.0: el equipo recuerda su tienda; si se elige la otra, se pregunta (no se bloquea)
  const tiendaEq = tiendaDelEquipo();
  if (tiendaEq && tiendaEq !== s && !confirm(`Este equipo suele trabajar en ${ptNombreTienda(tiendaEq)}. ¿Seguro que quiere entrar como ${ptNombreTienda(s)}?`)) return;
  recordarTiendaEquipo(s);
  sucursal = s;
  document.getElementById('sucursalScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('headerSucursal').textContent = s === 'ainavillo' ? 'Ainavillo' : 'Barros Arana';
  document.getElementById('headerSucursalCorta').textContent = s === 'ainavillo' ? 'AI' : 'BA'; // v2.8.0
  document.getElementById('headerUsuario').textContent = usuario.email;
  await cargarAreas();
  await cargarProductos();
  await verificarCaja();
  cargarStockLista();
  reintentarResumenesPendientes(); // v2.3.0: cierres cuyo resumen no alcanzó a guardarse
  iniciarRevisionPoint(); // v2.4.0: ¿el Point de esta tienda está integrado?
};

// ═══════════════════════════
// NAVEGACIÓN
// ═══════════════════════════
window.showSection = function(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + id).classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'stock')     { cargarStockPorCategoria(); renderStockIngresoGrid(); inicializarFechaStock(); }
  if (id === 'productos') { cargarMisPedidos(); renderAllAreaUIs(); }
  if (id === 'caja')      { cargarSaldoSugerido(); }
};

// ═══════════════════════════
// PRODUCTOS
// ═══════════════════════════

// ── Definición de áreas ──
// v2.3.0: una sola lista de áreas, la de Sistema Fën (areas.js). La caja ya no crea ni cambia áreas.
const SIN_AREA = 'SIN';
const AREAS_CAJA = [
  { id: 'PAN', nombre: 'Panadería', emoji: '' },
  { id: 'BOL', nombre: 'Bollería', emoji: '' },
  { id: 'PAS', nombre: 'Pastelería', emoji: '' },
  { id: 'CAF', nombre: 'Cafetería', emoji: '' },
  { id: 'REVENTA', nombre: 'Reventa', emoji: '' }
];
let AREAS = [...AREAS_CAJA, { id: SIN_AREA, nombre: 'Sin área', emoji: '' }];
let TIPOS_LECHE = ['Entera', 'Descremada', 'Sin lactosa', 'Entera sin lactosa']; // default hasta cargar desde Firestore
let MOTIVOS_MERMA = ['Llegó dañado', 'Se cayó', 'Vencido / pasado de fecha', 'Error de producción', 'Quemado', 'Otro']; // default hasta cargar desde Firestore

async function cargarMotivosMerma() {
  try {
    const snap = await getDoc(doc(db, 'config', 'motivosMerma'));
    if (snap.exists() && Array.isArray(snap.data().lista) && snap.data().lista.length > 0) {
      MOTIVOS_MERMA = snap.data().lista;
    } else {
      await setDoc(doc(db, 'config', 'motivosMerma'), { lista: MOTIVOS_MERMA });
    }
  } catch(e) { console.error('Error cargando motivos de merma:', e); }
}

async function cargarTiposLeche() {
  try {
    const snap = await getDoc(doc(db, 'config', 'tiposLeche'));
    if (snap.exists() && Array.isArray(snap.data().lista) && snap.data().lista.length > 0) {
      TIPOS_LECHE = snap.data().lista;
    } else {
      // Primera vez: sembrar con los valores por defecto
      await setDoc(doc(db, 'config', 'tiposLeche'), { lista: TIPOS_LECHE });
    }
  } catch(e) { console.error('Error cargando tipos de leche:', e); }
}

// Compatibilidad con productos guardados con nombre de área antiguo
// v2.3.0: "REV" (la pestaña antigua de reventa) es el mismo REVENTA. Un área que no está en la lista, o vacía, es "Sin área".
const AREA_COMPAT = { 'Panadería':'PAN','Bollería':'BOL','Sándwiches':'PAN','Cafetería':'CAF','Pastelería':'PAS','Chocolatería':'PAS','REV':'REVENTA','Reventa':'REVENTA' };
function normalizarArea(a) {
  const t = String(a == null ? '' : a).trim(), u = t.toUpperCase();
  if (AREAS_CAJA.some(x => x.id === u)) return u;
  return AREA_COMPAT[t] || AREA_COMPAT[u] || SIN_AREA;
}
// Las áreas que se muestran como botones: "Sin área" solo si algún producto cae ahí
function areasVisibles(lista) {
  const ps = lista || productos;
  return AREAS.filter(a => a.id !== SIN_AREA || ps.some(p => normalizarArea(p.area) === SIN_AREA));
}

// Paleta de colores por área, la misma que usa fën-producción — para identidad visual consistente entre sistemas.
const AREA_COLORES = {
  PAN: { principal: '#E65100', fondo: '#FFF8E1' },
  BOL: { principal: '#6A1B9A', fondo: '#F3E5F5' },
  PAS: { principal: '#1B5E20', fondo: '#E8F5E9' },
  CAF: { principal: '#B71C1C', fondo: '#FFEBEE' },
  REVENTA: { principal: '#00695C', fondo: '#E0F2F1' }
};
// Aclara un color hexadecimal mezclándolo hacia blanco (0 = igual, 1 = blanco puro) — para derivar
// tonos más suaves del mismo color sin tener que definir uno nuevo a mano por cada área.
function aclararColor(hex, pct) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.round(((num >> 16) & 255) + (255 - ((num >> 16) & 255)) * pct);
  const g = Math.round(((num >> 8) & 255)  + (255 - ((num >> 8) & 255))  * pct);
  const b = Math.round((num & 255)         + (255 - (num & 255))         * pct);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
function colorDeArea(areaId) {
  const c = AREA_COLORES[normalizarArea(areaId)] || { principal: '#555555', fondo: '#f2f2f2' };
  // fondoClaro: una versión aún más suave del mismo tono, para fondos grandes (el card completo),
  // dejando "fondo" (más saturado) para elementos chicos como la tarjeta de producto — así no se aplanan entre sí.
  return { ...c, fondoClaro: aclararColor(c.fondo, 0.6) };
}

let areaActiva = null;
let categoriaStockActiva = 'hoy'; // 'hoy' | 'ayer' | 'antesayer'
let mostrarSinStock = false;      // true = muestra todos; false = oculta sin stock
let _todosProdsAdmin = [];       // caché para filtrado

async function cargarProductos() {
  const snap = await getDocs(collection(db, 'productos'));
  productos = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.activo !== false);
  // Área inicial: primera con productos
  const areasConProd = AREAS.filter(a => productos.some(p => normalizarArea(p.area) === a.id));
  if (areasConProd.length > 0 && !areasConProd.some(a => a.id === areaActiva)) areaActiva = areasConProd[0].id;
  catActiva = 'TODOS';
  renderAllAreaUIs(); // v2.3.0: "Sin área" aparece solo si algún producto cae ahí
  // Cargar stock para mostrar badges
  await cargarStockMap();
  renderAreas();
  renderCategorias();
  renderProductos();
  renderStockIngresoGrid();
}

// ══════════════════════════════════
// STOCK INGRESO — GRILLA CON ÁREAS
// ══════════════════════════════════
let _stockIngresoArea = '';

function renderStockIngresoGrid() {
  const grid = document.getElementById('stockIngresoGrid');
  if (!grid) return;
  let lista = productos.filter(p => p.controlStock !== false); // excluir productos sin control de stock
  if (_stockIngresoArea) lista = lista.filter(p => normalizarArea(p.area) === _stockIngresoArea);
  if (lista.length === 0) { grid.innerHTML = '<div class="empty">Sin productos con control de stock en esta área</div>'; return; }
  grid.innerHTML = lista.map(p => {
    const { principal, fondo } = colorDeArea(p.area);
    return `
    <button class="stock-ingreso-btn" style="background:${fondo};border-color:${principal}40" onclick="selStockProducto('${p.id}','${p.nombre.replace(/'/g,"\\'")}')">
      <div class="s-name" style="color:${principal}">${p.nombre}</div>
    </button>`;
  }).join('');
}

window.selStockArea = function(btn, area) {
  _stockIngresoArea = area;
  document.querySelectorAll('.stock-area-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStockIngresoGrid();
};

window.selStockProducto = function(id, nombre) {
  document.getElementById('stockProducto').value = id;
  document.getElementById('stockSelNombre').textContent = nombre;
  document.getElementById('stockSelBadge').style.display = 'flex';
  document.getElementById('stockIngresoGrid').style.display = 'none';
  document.getElementById('stockAreaBtns').style.display = 'none';
  document.getElementById('stockCantidad').focus();
};

window.limpiarStockProd = function() {
  document.getElementById('stockProducto').value = '';
  document.getElementById('stockSelBadge').style.display = 'none';
  document.getElementById('stockIngresoGrid').style.display = '';
  document.getElementById('stockAreaBtns').style.display = '';
};

async function cargarStockMap() {
  if (!sucursal) return;
  const snap = await getDocs(collection(db, 'stock'));
  window._stockMap = {};
  snap.docs.filter(d => d.id.startsWith(sucursal + '_')).forEach(d => {
    window._stockMap[d.id] = d.data();
  });
}

// ══════════════════════════════════
// HELPERS GLOBALES
// ══════════════════════════════════

function showToast(msg, tipo = 'ok') {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = tipo === 'error' ? 'show error' : 'show';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}

// Devuelve el precio correcto según categoría de stock y hora actual
// ══════════════════════════════════════════════════════
// HELPERS DE STOCK — SISTEMA BASADO EN FECHAS REALES
// La categoría (hoy/ayer/antesayer/cuartoDia/merma) se
// calcula dinámicamente a partir de la fecha de ingreso.
// No hay rotación: los datos nunca se mueven en Firestore.
// ══════════════════════════════════════════════════════

// Convierte fecha es-CL ("01-07-2026", "1/7/2026") a clave de almacenamiento "20260701"
function parseFechaEsCLToKey(fechaStr) {
  if (!fechaStr) return fechaLocalHoy().replace(/-/g, '');
  const partes = fechaStr.split(/[-\/]/);
  if (partes.length !== 3) return fechaLocalHoy().replace(/-/g, '');
  const d = partes[0].padStart(2, '0');
  const m = partes[1].padStart(2, '0');
  const y = partes[2].length === 4 ? partes[2] : `20${partes[2]}`;
  return `${y}${m}${d}`;
}

// Clave de hoy en formato "20260702"
function fechaKeyHoy() { return fechaLocalHoy().replace(/-/g, ''); }

// Convierte clave "20260701" a texto legible "01-07-2026"
function keyToFechaCL(key) {
  if (!key || key.length !== 8) return '';
  return `${key.slice(6,8)}-${key.slice(4,6)}-${key.slice(0,4)}`;
}

// Fecha en que un lote (por su fecha de ingreso) llega a la categoría "Última oferta" (ingreso + 4 días)
function fechaLlegadaUltimaOferta(dateKey) {
  if (!dateKey || dateKey.length !== 8) return '';
  const y = dateKey.slice(0, 4), m = dateKey.slice(4, 6), d = dateKey.slice(6, 8);
  const fecha = new Date(`${y}-${m}-${d}T00:00:00`);
  fecha.setDate(fecha.getDate() + 4);
  return fechaStr(fecha).split('-').reverse().join('-'); // DD-MM-YYYY, mismo estilo que keyToFechaCL
}

// Formatea un objeto Date como DD-MM-YYYY (mismo estilo que keyToFechaCL, pero a partir de un Date/Timestamp)
function formatoDMY(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}-${m}-${date.getFullYear()}`;
}

// Días entre dos fechas en formato DD-MM-YYYY (ej. fecha de ingreso vs. fecha de envío a merma)
function diasEntreDMY(dmyDesde, dmyHasta) {
  if (!dmyDesde || !dmyHasta) return null;
  const [d1, m1, y1] = dmyDesde.split('-');
  const [d2, m2, y2] = dmyHasta.split('-');
  const f1 = new Date(`${y1}-${m1}-${d1}T00:00:00`);
  const f2 = new Date(`${y2}-${m2}-${d2}T00:00:00`);
  const dias = Math.round((f2 - f1) / 86400000);
  return dias >= 0 ? dias : null;
}

// Determina la categoría de stock según la diferencia de días con hoy
function getCategoriaFecha(dateKey) {
  if (!dateKey) return 'hoy';
  if (dateKey === 'permanente') return 'permanente';
  if (dateKey.startsWith('merma_')) return 'merma';
  if (dateKey.startsWith('ultimaoferta_')) return 'ultimaOferta';
  if (dateKey.length !== 8) return 'hoy';
  const hoyISO  = fechaLocalHoy();
  const keyISO  = `${dateKey.slice(0,4)}-${dateKey.slice(4,6)}-${dateKey.slice(6,8)}`;
  const hoyDate = new Date(hoyISO  + 'T00:00:00');
  const entDate = new Date(keyISO  + 'T00:00:00');
  const diff    = Math.round((hoyDate - entDate) / 86400000);
  if (diff <= 0) return 'hoy';
  if (diff === 1) return 'ayer';
  if (diff === 2) return 'antesayer';
  if (diff === 3) return 'cuartoDia';
  return 'ultimaOferta'; // 4+ días → última oferta (no merma automática)
}

// Devuelve la cantidad total para una categoría sumando todas las entradas de esa fecha
function getQtyCategoria(stockItem, cat) {
  const entradas = stockItem?.entradas || {};
  return Object.entries(entradas)
    .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === cat)
    .reduce((sum, [, q]) => sum + q, 0);
}

// Devuelve las entradas de una categoría ordenadas de más antigua a más nueva
function getEntradasPorCategoria(stockItem, cat) {
  const entradas = stockItem?.entradas || {};
  return Object.entries(entradas)
    .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === cat)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, qty]) => ({ key, qty }));
}

// Todos los lotes vendibles de un producto (todas las categorías con fecha, sin merma ni "permanente"),
// ordenados del más reciente al más antiguo — para la vista general de stock.
function getTodosLotesVendibles(stockItem) {
  const entradas = stockItem?.entradas || {};
  return Object.entries(entradas)
    .filter(([k, q]) => q > 0 && k !== 'permanente' && !k.startsWith('merma'))
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, qty]) => ({ key, qty }));
}

function getPrecioProducto(prod, cat) {
  const hora = new Date().getHours();
  if (cat === 'hoy') return prod.precioHoy || prod.precio || 0;
  if (cat === 'ayer') {
    if (prod.excepcionHoraria && hora < 15) return prod.precioHoy || prod.precio || 0;
    return prod.precioAyer || prod.precioHoy || prod.precio || 0;
  }
  if (cat === 'antesayer')    return prod.precioAntesayer || prod.precioAyer || prod.precioHoy || prod.precio || 0;
  if (cat === 'cuartoDia')    return prod.precioCuartoDia || prod.precioAntesayer || prod.precioAyer || prod.precioHoy || prod.precio || 0;
  if (cat === 'ultimaOferta') return prod.precioUltimaOferta || prod.precioCuartoDia || prod.precioAntesayer || prod.precioHoy || prod.precio || 0;
  return prod.precio || 0;
}

// v2.6.1: bajo cada tarjeta, el día que le corresponde (Hoy jue 29, Ayer mié 28, …, Últ. ≤ dom 25)
function pintarFechasTarjetas() {
  const hoy = new Date(fechaLocalHoy() + 'T12:00:00');
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dia = n => { const d = new Date(hoy); d.setDate(d.getDate() - n); return dias[d.getDay()] + ' ' + d.getDate(); };
  const filas = [['hoy', 'Hoy', dia(0)], ['ayer', 'Ayer', dia(1)], ['antesayer', 'Ant.', dia(2)], ['cuartodia', '4to', dia(3)], ['ultimaoferta', 'Últ.', '≤ ' + dia(4)]];
  for (const [id, nombre, fecha] of filas) {
    const b = document.getElementById('scat-' + id);
    if (b && b.dataset.fecha !== fecha) { b.dataset.fecha = fecha; b.innerHTML = nombre + '<span class="cat-fecha">' + fecha + '</span>'; }
  }
}

// Cambia la categoría de stock activa en ventas
window.selCatStock = function(cat) {
  categoriaStockActiva = cat;
  ['hoy','ayer','antesayer','cuartodia','ultimaoferta'].forEach(c => {
    const btn = document.getElementById('scat-' + c);
    if (btn) btn.classList.toggle('active',
      c === cat ||
      (c === 'cuartodia'    && cat === 'cuartoDia') ||
      (c === 'ultimaoferta' && cat === 'ultimaOferta')
    );
  });
  renderProductos();
};

// Alterna entre mostrar solo productos con stock vs todos
window.toggleMostrarSinStock = function() {
  mostrarSinStock = !mostrarSinStock;
  const btn = document.getElementById('btnToggleStock');
  if (btn) {
    btn.textContent = mostrarSinStock ? '👁 Solo con stock' : '👁 Mostrar todos';
    btn.style.background = mostrarSinStock ? '#1F3F78' : '';
    btn.style.color       = mostrarSinStock ? 'white'   : '';
    btn.style.borderColor = mostrarSinStock ? '#1F3F78' : '';
  }
  renderProductos();
};

function renderAreas() {
  const areasConProd = AREAS.filter(a => productos.some(p => normalizarArea(p.area) === a.id));
  document.getElementById('areaTabs').innerHTML = areasConProd.map(a => {
    const activa = a.id === areaActiva;
    const { principal, fondo } = colorDeArea(a.id);
    const estilo = activa ? `border-color:${principal};background:${fondo};color:${principal}` : '';
    return `<button class="area-tab${activa ? ' active' : ''}" style="${estilo}" onclick="filtrarArea('${a.id}')">${a.nombre}</button>`;
  }).join('');
}

// Sincroniza el color del card "Nueva venta" con el área seleccionada (franja superior + fondo suave)
function actualizarColorCardVenta() {
  const card = document.getElementById('cardNuevaVenta');
  if (!card) return;
  if (areaActiva) {
    const { principal, fondoClaro } = colorDeArea(areaActiva);
    card.style.background = fondoClaro;
    card.style.borderTop = `4px solid ${principal}`;
  } else {
    card.style.background = '';
    card.style.borderTop = '';
  }
}

window.filtrarArea = function(area) {
  areaActiva = area;
  catActiva = 'TODOS';
  renderAreas();
  renderCategorias();
  actualizarColorCardVenta();
  renderProductos();
};

function renderCategorias() {
  const prodArea = areaActiva ? productos.filter(p => normalizarArea(p.area) === areaActiva) : productos;
  const cats = [...new Set(prodArea.map(p => p.categoria).filter(Boolean))];
  if (cats.length <= 1) {
    document.getElementById('catTabs').innerHTML = '';
    return;
  }
  document.getElementById('catTabs').innerHTML = [
    `<button class="cat-tab ${catActiva === 'TODOS' ? 'active' : ''}" onclick="filtrarCat('TODOS')">Todos</button>`,
    ...cats.map(c =>
      `<button class="cat-tab ${c === catActiva ? 'active' : ''}" onclick="filtrarCat('${c}')">${c}</button>`
    )
  ].join('');
}

window.filtrarCat = function(cat) {
  catActiva = cat;
  renderCategorias();
  renderProductos();
};

let vistaGeneralActiva = false;

function renderProductos() {
  pintarFechasTarjetas(); // v2.6.1
  if (vistaGeneralActiva) { renderVistaGeneral(); return; }
  const prodArea = areaActiva ? productos.filter(p => normalizarArea(p.area) === areaActiva) : productos;
  const lista = (catActiva === 'TODOS' ? prodArea : prodArea.filter(p => p.categoria === catActiva))
    .slice()
    .sort((a, b) => {
      const precioA = getPrecioProducto(a, a.autoEliminar === false ? 'hoy' : categoriaStockActiva);
      const precioB = getPrecioProducto(b, b.autoEliminar === false ? 'hoy' : categoriaStockActiva);
      return precioA - precioB;
    });
  const grid = document.getElementById('productosGrid');
  if (lista.length === 0) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No hay productos</div>'; return; }
  grid.innerHTML = lista.map(p => {
    const conControl = p.controlStock !== false;

    // Producto SIN control de stock → siempre disponible, sin badge de stock
    if (!conControl) {
      const precio = getPrecioProducto(p, categoriaStockActiva);
      const { principal, fondo } = colorDeArea(p.area);
      return `
      <button class="prod-btn" onclick="agregarAlPedido('${p.id}')" style="background:${fondo};border-color:${principal}40">
        <div class="nombre" style="color:${principal}">${p.nombre}</div>
        <div class="precio">$${parseInt(precio).toLocaleString('es-CL')}</div>
      </button>`;
    }

    // Producto CON control de stock → categoría calculada dinámicamente por fecha
    const stockKey  = sucursal + '_' + p.id;
    const stockItem = window._stockMap ? window._stockMap[stockKey] : null;
    // Productos permanentes (autoEliminar: false) muestran stock total ignorando el switch
    const esPermanente = p.autoEliminar === false;
    const qty = stockItem
      ? (esPermanente
          ? (stockItem.entradas?.['permanente'] || 0)
          : getQtyCategoria(stockItem, categoriaStockActiva))
      : 0;
    const sinStock  = qty <= 0;
    if (sinStock && !mostrarSinStock) return '';
    const stockLabel = sinStock ? 'Sin stock' : `Stock: ${qty}`;
    const precio = getPrecioProducto(p, esPermanente ? 'hoy' : categoriaStockActiva);
    const { principal, fondo } = colorDeArea(p.area);
    return `
    <button class="prod-btn${sinStock ? ' sin-stock' : ''}" onclick="agregarAlPedido('${p.id}')" ${sinStock ? 'disabled' : ''} style="background:${fondo};border-color:${principal}40">
      <div class="nombre" style="color:${principal}">${p.nombre}</div>
      <div class="precio">$${parseInt(precio).toLocaleString('es-CL')}</div>
      <div class="stock-badge">${stockLabel}</div>
    </button>`;
  }).join('');
}

// Muestra/oculta la vista general: stock total por producto con desglose de lotes por fecha,
// en vez de la grilla de venta rápida filtrada por categoría de día.
window.toggleVistaGeneral = function() {
  vistaGeneralActiva = !vistaGeneralActiva;
  const btn = document.getElementById('btnVistaGeneral');
  const catSwitch = document.getElementById('stockCatSwitch');
  const grid = document.getElementById('productosGrid');
  const lista = document.getElementById('vistaGeneralList');
  if (vistaGeneralActiva) {
    btn.style.cssText = 'white-space:nowrap;padding:6px 10px;font-size:11px;border-radius:8px;background:#1F3F78;color:#fff;border:none';
    catSwitch.style.opacity = '0.4';
    catSwitch.style.pointerEvents = 'none';
    grid.style.display = 'none';
    lista.style.display = '';
  } else {
    btn.style.cssText = 'white-space:nowrap;padding:6px 10px;font-size:11px;border-radius:8px';
    catSwitch.style.opacity = '';
    catSwitch.style.pointerEvents = '';
    grid.style.display = '';
    lista.style.display = 'none';
  }
  renderProductos();
};

// Stock total por producto + desglose de lotes (más reciente primero), respetando área/subcategoría activa
function renderVistaGeneral() {
  const prodArea = areaActiva ? productos.filter(p => normalizarArea(p.area) === areaActiva) : productos;
  const lista = (catActiva === 'TODOS' ? prodArea : prodArea.filter(p => p.categoria === catActiva))
    .slice()
    .sort((a, b) => getPrecioProducto(a, 'hoy') - getPrecioProducto(b, 'hoy'));

  const wrap = document.getElementById('vistaGeneralList');
  if (!wrap) return;
  if (!lista.length) { wrap.innerHTML = '<div class="empty">No hay productos</div>'; return; }

  wrap.innerHTML = lista.map(p => {
    const { principal, fondo } = colorDeArea(p.area);
    const conControl = p.controlStock !== false;
    if (!conControl) {
      return `<div class="stock-row" style="border-left:4px solid ${principal};background:${fondo};border-radius:6px;padding:8px 10px;margin-bottom:6px">
        <div style="flex:1"><div class="stock-prod-nombre" style="color:${principal}">${p.nombre}</div><div class="stock-prod-meta">Sin control de stock</div></div>
      </div>`;
    }
    const stockKey  = sucursal + '_' + p.id;
    const stockItem = window._stockMap ? window._stockMap[stockKey] : null;
    const lotes = getTodosLotesVendibles(stockItem);
    const total = lotes.reduce((a, l) => a + l.qty, 0);
    const detalle = lotes.map(l => `${l.qty}un · ${keyToFechaCL(l.key)}`).join(' — ');
    return `<div class="stock-row" style="border-left:4px solid ${principal};background:${fondo};border-radius:6px;padding:8px 10px;margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <div class="stock-prod-nombre" style="color:${principal}">${p.nombre}</div>
        <div class="stock-prod-meta">${detalle || 'Sin stock'}</div>
      </div>
      <div style="font-weight:700;color:#1F3F78;white-space:nowrap;padding-left:8px">${total} un.</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════
// ÁREAS — v2.3.0: lista fija (la de Sistema Fën)
// ══════════════════════════════════
async function cargarAreas() {
  AREAS = [...AREAS_CAJA, { id: SIN_AREA, nombre: 'Sin área', emoji: '' }];
  renderAllAreaUIs();
}

// Actualiza todos los elementos que dependen de AREAS
function renderAllAreaUIs() {
  renderStockAreaBtns();
  renderStockListaAreaBtns();
}

// Botones de área en stock ingreso
function renderStockAreaBtns() {
  const wrap = document.getElementById('stockAreaBtns');
  if (!wrap) return;
  wrap.innerHTML = `<button class="stock-area-btn active" onclick="selStockArea(this,'')">Todos</button>` +
    areasVisibles().map(a =>
      `<button class="stock-area-btn" onclick="selStockArea(this,'${a.id}')">${a.nombre}</button>`
    ).join('');
}

// Filtro de área compartido para las 3 listas de stock (Hoy/Ayer/Antesayer)
function renderStockListaAreaBtns() {
  const wrap = document.getElementById('stockListaAreaBtns');
  if (!wrap) return;
  wrap.innerHTML = `<button class="stock-area-btn${_stockListaArea === '' ? ' active' : ''}" onclick="selStockListaArea(this,'')">Todos</button>` +
    areasVisibles().map(a =>
      `<button class="stock-area-btn${_stockListaArea === a.id ? ' active' : ''}" onclick="selStockListaArea(this,'${a.id}')">${a.nombre}</button>`
    ).join('');
}

window.selStockListaArea = function(btn, area) {
  _stockListaArea = area;
  document.querySelectorAll('#stockListaAreaBtns .stock-area-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  cargarStockPorCategoria();
};

// PRODUCTOS — se administran en Sistema Fën → Catálogo (v2.7.0: la lista para mirar se retiró).
// Queda "Pedir producto" (todas las cuentas), que escribe en solicitudes_producto lo que lee Sistema Fën.
// ══════════════════════════════════
const pesosCL = v => '$' + (parseInt(v) || 0).toLocaleString('es-CL');
// ── Pedir producto ──
// fen-ventas solicitudes_producto/{id} = { tipo 'producto', nombre, sucursal, precioSugerido (con IVA) | null, nota, estado 'pendiente', por, en }
// Sistema Fën (Catálogo → Productos → Pedidos) lo resuelve: estado 'aprobada' | 'rechazada', catalogoId, productoId, respuesta, resuelta.
const ESTADO_PEDIDO = { pendiente: ['Pendiente', 'pp-pend'], aprobada: ['Aprobado', 'pp-apr'], rechazada: ['Rechazado', 'pp-rech'] };
window.abrirPedirProducto = function() {
  ['pedirNombre', 'pedirPrecio', 'pedirNota'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('pedirError').textContent = '';
  document.getElementById('pedirOk').textContent = '';
  document.getElementById('modalPedirProducto').classList.add('open');
  cargarMisPedidos();
  setTimeout(() => { const n = document.getElementById('pedirNombre'); if (n) n.focus(); }, 50);
};
window.limpiarAvisoPedido = function() { document.getElementById('pedirError').textContent = ''; document.getElementById('pedirOk').textContent = ''; };
window.cerrarPedirProducto = function() {
  document.getElementById('modalPedirProducto').classList.remove('open');
};
window.enviarPedidoProducto = async function() {
  const err = document.getElementById('pedirError'), ok = document.getElementById('pedirOk'), btn = document.getElementById('btnEnviarPedido');
  err.textContent = ''; ok.textContent = '';
  const nombre = document.getElementById('pedirNombre').value.trim().replace(/\s+/g, ' ').slice(0, 120);
  const precioTxt = String(document.getElementById('pedirPrecio').value || '').trim();
  const nota = document.getElementById('pedirNota').value.trim().slice(0, 300);
  if (nombre.length < 2) { err.textContent = 'Escribe el nombre del producto.'; document.getElementById('pedirNombre').focus(); return; }
  const precio = precioTxt === '' ? null : Math.round(Number(precioTxt));
  if (precio !== null && !(precio > 0 && precio < 10000000)) { err.textContent = 'El precio sugerido es un número mayor que 0 (o déjalo vacío).'; return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    await addDoc(collection(db, 'solicitudes_producto'), {
      tipo: 'producto', nombre, sucursal: sucursal || '', precioSugerido: precio, nota,
      estado: 'pendiente', por: usuario.email, en: Timestamp.now()
    });
    ['pedirNombre', 'pedirPrecio', 'pedirNota'].forEach(id => { document.getElementById(id).value = ''; });
    ok.textContent = `Pedido enviado: ${nombre}. Aquí verás la respuesta.`;
    showToast('Pedido enviado');
    await cargarMisPedidos();
  } catch (e) {
    err.textContent = e && e.code === 'permission-denied'
      ? 'No se pudo enviar: falta publicar las reglas de Firestore v1.5.0 (avísale a la administración).'
      : 'No se pudo enviar: ' + (e && e.message ? e.message : e);
  }
  btn.disabled = false; btn.textContent = 'Enviar pedido';
};
// Los pedidos de quien está conectada (los 8 más nuevos), con su estado y la respuesta de Sistema Fën
async function cargarMisPedidos() {
  const wraps = ['misPedidosLista', 'misPedidosProd'].map(id => document.getElementById(id)).filter(Boolean);
  if (!wraps.length || !usuario) return;
  let html;
  try {
    const snap = await getDocs(query(collection(db, 'solicitudes_producto'), where('por', '==', usuario.email)));
    const ms = x => (x && x.toMillis ? x.toMillis() : x && x.seconds ? x.seconds * 1000 : 0);
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.en) - ms(a.en)).slice(0, 8);
    html = lista.length ? lista.map(x => {
      const [txt, cls] = ESTADO_PEDIDO[x.estado] || [escHtml(x.estado || 'Pendiente'), 'pp-gris'];
      const f = x.en && x.en.toDate ? x.en.toDate().toLocaleDateString('es-CL') : '';
      return `<div class="pp-ped" data-pedido="${escHtml(x.id)}">
        <div class="pp-ped-txt"><b>${escHtml(x.nombre)}</b>${x.precioSugerido ? ' · ' + pesosCL(x.precioSugerido) : ''}
          <div class="pp-ped-resp">${escHtml(f)}${x.sucursal ? ' · ' + (x.sucursal === 'ainavillo' ? 'Ainavillo' : 'Barros Arana') : ''}${x.nota ? ' · ' + escHtml(x.nota) : ''}</div>
          ${x.respuesta ? `<div class="pp-ped-resp">Respuesta: ${escHtml(x.respuesta)}</div>` : ''}</div>
        <span class="pp-chip ${cls}">${txt}</span></div>`;
    }).join('') : '<div class="empty" style="padding:12px">Todavía no pides productos.</div>';
  } catch (e) {
    html = `<div class="empty" style="padding:12px">${e && e.code === 'permission-denied' ? 'Para ver tus pedidos falta publicar las reglas de Firestore v1.5.0.' : 'No se pudieron leer tus pedidos.'}</div>`;
  }
  wraps.forEach(w => { w.innerHTML = html; });
}

// ═══════════════════════════
// MESAS
// ═══════════════════════════

// Cambia entre "Nueva venta" directa y "Mesas"
window.selModoVenta = function(btn, modo) {
  document.querySelectorAll('#ventaModoTabs .rep-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('mesaHeaderBar').style.display = 'none';

  if (modo === 'directa') {
    modoVenta = 'directa';
    mesaActivaId = null;
    document.getElementById('mesasListado').style.display = 'none';
    document.getElementById('ventaLayoutMain').style.display = '';
    document.getElementById('ventaCardTitle').textContent = '🛒 Nueva venta';
    document.getElementById('pedidoCardTitle').textContent = 'Pedido actual';
    document.getElementById('btnPagar').textContent = '✓ Registrar pago';
    pedidoLineas = [];
    resetPagoDividido();
    renderPedido();
  } else {
    modoVenta = 'mesas';
    mesaActivaId = null;
    document.getElementById('ventaLayoutMain').style.display = 'none';
    document.getElementById('mesasListado').style.display = '';
    cargarMesas();
  }
};

// Lista las mesas abiertas de la sucursal (visibles para todos los dispositivos)
window.cargarMesas = async function() {
  const wrap = document.getElementById('mesasListado');
  wrap.innerHTML = '<div class="empty">Cargando mesas...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'mesas'), where('sucursal', '==', sucursal), where('estado', '==', 'abierta')));
    const mesas = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.numero || 0) - (b.numero || 0));
    wrap.innerHTML = `
      <div class="card">
        <div class="card-title">🍽️ Mesas abiertas</div>
        <button class="btn btn-primary btn-full" style="margin-bottom:12px" onclick="crearMesa()">+ Nueva mesa</button>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
          ${mesas.length ? mesas.map(m => `
            <button onclick="abrirMesa('${m.id}')" style="text-align:left;padding:12px;border:0.5px solid #ddd;border-radius:10px;background:#fff;cursor:pointer">
              <div style="font-weight:700;font-size:14px;color:#222">${m.nombre}</div>
              <div style="font-size:12px;color:#888;margin-top:4px">${(m.lineas || []).length} línea(s)</div>
              <div style="font-size:15px;font-weight:700;color:#1F3F78;margin-top:6px">$${parseInt(m.total || 0).toLocaleString('es-CL')}</div>
            </button>
          `).join('') : '<div class="empty" style="grid-column:1/-1">Sin mesas abiertas</div>'}
        </div>
      </div>`;
  } catch(e) {
    wrap.innerHTML = `<div class="empty">Error cargando mesas: ${e.message}</div>`;
  }
};

// Crea una mesa nueva: numeración automática por sucursal, con nombre opcional
window.crearMesa = async function() {
  if (!cajaId) { alert('⚠️ Debes abrir la caja antes de crear una mesa'); return; }
  const nombreInput = prompt('Nombre de la mesa (opcional). Deja vacío para usar el número automático:');
  if (nombreInput === null) return; // canceló
  try {
    const snap = await getDocs(query(collection(db, 'mesas'), where('sucursal', '==', sucursal)));
    const maxNum = snap.docs.reduce((max, d) => Math.max(max, d.data().numero || 0), 0);
    const numero = maxNum + 1;
    const nombre = nombreInput.trim() ? nombreInput.trim() : `Mesa ${numero}`;
    const ref = await addDoc(collection(db, 'mesas'), {
      sucursal, numero, nombre, estado: 'abierta',
      lineas: [], subtotal: 0, descuento: 0, total: 0,
      apertura: Timestamp.now(), usuario: usuario.email
    });
    await abrirMesa(ref.id);
  } catch(e) { alert('Error al crear mesa: ' + e.message); }
};

// Abre una mesa: carga sus líneas actuales en el carrito compartido (misma grilla y pedido de "Nueva venta")
window.abrirMesa = async function(mesaId) {
  try {
    const snap = await getDoc(doc(db, 'mesas', mesaId));
    if (!snap.exists()) { alert('Mesa no encontrada'); return; }
    const m = snap.data();
    mesaActivaId = mesaId;
    mesaActivaNombre = m.nombre;
    modoVenta = 'mesa-detail';
    pedidoLineas = (m.lineas || []).map(l => ({ ...l }));
    resetPagoDividido();

    document.getElementById('mesasListado').style.display = 'none';
    document.getElementById('ventaLayoutMain').style.display = '';
    document.getElementById('mesaHeaderBar').style.display = 'flex';
    document.getElementById('mesaHeaderNombre').textContent = `🍽️ ${m.nombre}`;
    document.getElementById('ventaCardTitle').textContent = `🍽️ ${m.nombre}`;
    document.getElementById('pedidoCardTitle').textContent = `Pedido — ${m.nombre}`;
    document.getElementById('btnPagar').textContent = '💳 Cobrar y cerrar mesa';
    renderPedido();
  } catch(e) { alert('Error al abrir mesa: ' + e.message); }
};

// Vuelve al listado de mesas (los cambios ya quedaron guardados en cada agregar/quitar)
window.volverAMesas = function() {
  mesaActivaId = null;
  pedidoLineas = [];
  modoVenta = 'mesas';
  document.getElementById('ventaLayoutMain').style.display = 'none';
  document.getElementById('mesaHeaderBar').style.display = 'none';
  document.getElementById('mesasListado').style.display = '';
  cargarMesas();
};

// Cancela una mesa (por error al crearla, cliente que se fue sin pedir, etc.).
// Si tenía productos cargados, se devuelve el stock de cada uno antes de cerrarla.
window.cancelarMesa = async function() {
  if (!mesaActivaId) return;
  const nLineas = pedidoLineas.length;
  const msg = nLineas > 0
    ? `Esta mesa tiene ${nLineas} línea(s) cargada(s) por un total de $${pedidoLineas.reduce((a,l)=>a+l.total,0).toLocaleString('es-CL')}. Al cancelar se devolverá todo el stock y NO se registrará ninguna venta. ¿Confirmas?`
    : '¿Cancelar esta mesa vacía?';
  if (!confirm(msg)) return;

  try {
    // Devolver stock de cada línea (si la mesa tenía productos cargados)
    for (const l of pedidoLineas) {
      const prod = productos.find(p => p.id === l.id);
      const conControl = prod ? prod.controlStock !== false : true;
      if (!conControl) continue;
      const esPermanente = prod && prod.autoEliminar === false;
      const cat = esPermanente ? 'permanente' : l.categoriaStock;
      await ajustarStock(l.id, cat, l.cantidad);
    }
    await updateDoc(doc(db, 'mesas', mesaActivaId), {
      estado: 'cancelada', cierre: Timestamp.now(), canceladoPor: usuario.email
    });
    showToast('🗑️ Mesa cancelada');
    pedidoLineas = [];
    resetPagoDividido();
    volverAMesas();
  } catch(e) {
    alert('Error al cancelar mesa: ' + e.message);
  }
};

// Guarda el estado actual del carrito (líneas + totales) en el documento de la mesa activa
async function persistirMesa() {
  if (!mesaActivaId) return;
  const subtotal  = pedidoLineas.reduce((a, l) => a + (l.totalBruto || 0), 0);
  const descuento = pedidoLineas.reduce((a, l) => a + (l.descMonto  || 0), 0);
  const total     = pedidoLineas.reduce((a, l) => a + (l.total      || 0), 0);
  const lineasPlano = pedidoLineas.map(l => ({
    id: l.id, nombre: l.nombre, precio: l.precio, cantidad: l.cantidad,
    totalBruto: l.totalBruto, descTipo: l.descTipo, descVal: l.descVal,
    descMonto: l.descMonto, total: l.total, categoriaStock: l.categoriaStock, loteFecha: l.loteFecha || '',
    clienteNombre: l.clienteNombre || '', tipoLeche: l.tipoLeche || '', nota: l.nota || ''
  }));
  try {
    await updateDoc(doc(db, 'mesas', mesaActivaId), { lineas: lineasPlano, subtotal, descuento, total });
  } catch(e) { console.error('Error guardando mesa:', e); }
}

// ═══════════════════════════
// PEDIDO
// ═══════════════════════════
window.agregarAlPedido = function(id) {
  if (!cajaId) { alert('⚠️ Debes abrir la caja antes de realizar ventas'); return; }
  const prod = productos.find(p => p.id === id);
  if (!prod) return;
  const conControl   = prod.controlStock !== false;
  const esPermanente = prod.autoEliminar === false;

  // Última oferta con más de un lote: hay que elegir cuál vender antes de agregarlo al pedido
  if (conControl && !esPermanente && categoriaStockActiva === 'ultimaOferta') {
    const stockKey  = sucursal + '_' + id;
    const stockItem = window._stockMap ? window._stockMap[stockKey] : null;
    const lotes = getEntradasPorCategoria(stockItem, 'ultimaOferta');
    if (lotes.length > 1) {
      abrirModalElegirLote(id, prod.nombre, lotes);
      return;
    }
  }
  agregarAlPedidoConLote(id, null);
};

// Agrega el producto al pedido. Si loteFecha viene con valor, descuenta ESE lote específico
// (elegido por el cajero) en vez del FIFO automático — para Última oferta con varios lotes.
window.agregarAlPedidoConLote = function(id, loteFecha) {
  const prod = productos.find(p => p.id === id);
  if (!prod) return;
  const conControl   = prod.controlStock !== false;
  const esPermanente = prod.autoEliminar === false;

  if (conControl) {
    const stockKey   = sucursal + '_' + id;
    const stockItem  = window._stockMap ? window._stockMap[stockKey] : null;
    const disponible = esPermanente
      ? (stockItem?.entradas?.['permanente'] || 0)
      : loteFecha
        ? (stockItem?.entradas?.[loteFecha] || 0)
        : (stockItem ? getQtyCategoria(stockItem, categoriaStockActiva) : 0);
    if (disponible <= 0) {
      alert(`⚠️ Sin stock${esPermanente ? '' : ` en categoría "${categoriaStockActiva}"`} para ${prod.nombre}`);
      return;
    }
    const cantEnPedido = pedidoLineas
      .filter(l => l.id === id && l.categoriaStock === categoriaStockActiva && (l.loteFecha || '') === (loteFecha || ''))
      .reduce((a, l) => a + l.cantidad, 0);
    if (cantEnPedido >= disponible) {
      alert(`⚠️ Solo hay ${disponible} unidad(es) de ${prod.nombre}${loteFecha ? ` en el lote del ${keyToFechaCL(loteFecha)}` : ` en stock (${categoriaStockActiva})`}`);
      return;
    }
  }

  const precio = getPrecioProducto(prod, categoriaStockActiva);
  // Buscar línea existente del mismo producto, misma categoría Y mismo lote
  const existente = pedidoLineas.find(l => l.id === id && l.categoriaStock === categoriaStockActiva && (l.loteFecha || '') === (loteFecha || ''));
  if (existente) {
    existente.cantidad++;
    existente.totalBruto = existente.cantidad * existente.precio;
    calcularDescLinea(existente);
  } else {
    pedidoLineas.push({
      id, nombre: prod.nombre, precio, cantidad: 1,
      totalBruto: precio, descTipo: 'peso', descVal: 0, descMonto: 0, total: precio,
      categoriaStock: categoriaStockActiva, loteFecha: loteFecha || '',
      clienteNombre: '', tipoLeche: '', nota: ''
    });
  }
  renderPedido();

  // En modo mesa: el stock se descuenta al agregar (no al cobrar), y se guarda de inmediato en Firestore
  if (modoVenta === 'mesa-detail') {
    if (conControl) {
      if (loteFecha) {
        ajustarStockLote(id, loteFecha, -1);
      } else {
        const cat = esPermanente ? 'permanente' : categoriaStockActiva;
        ajustarStock(id, cat, -1);
      }
    }
    persistirMesa();
  }
};

// Abre el selector de lote cuando un producto de Última oferta tiene más de un lote disponible
window.abrirModalElegirLote = function(productoId, nombre, lotes) {
  document.getElementById('elegirLoteTitulo').textContent = `📦 ${nombre} — elige el lote`;
  document.getElementById('elegirLoteOpciones').innerHTML = lotes.map(l => `
    <button onclick="elegirLoteYAgregar('${productoId}','${l.key}')" style="text-align:left;padding:12px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">
      <div style="font-weight:600;font-size:13px">Ingreso ${keyToFechaCL(l.key)} → lleg. Últ.of. ${fechaLlegadaUltimaOferta(l.key)}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">${l.qty} unidad(es) disponibles</div>
    </button>`).join('');
  document.getElementById('modalElegirLote').classList.add('open');
};

window.elegirLoteYAgregar = function(productoId, fechaKey) {
  document.getElementById('modalElegirLote').classList.remove('open');
  agregarAlPedidoConLote(productoId, fechaKey);
};

function renderPedido() {
  const card = document.getElementById('cardPedido');
  if (pedidoLineas.length === 0) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  document.getElementById('lineasPedido').innerHTML = pedidoLineas.map((l, i) => {
    const prod = productos.find(p => p.id === l.id);
    const esCafe = prod && normalizarArea(prod.area) === 'CAF';
    const tieneNota = l.clienteNombre || l.tipoLeche || l.nota;
    return `
    <div class="linea-pedido-wrap">
      <div class="linea-pedido">
        <div>
          <div class="linea-prod-nombre">${l.nombre}</div>
          <div class="linea-prod-precio">$${parseInt(l.precio).toLocaleString('es-CL')} c/u <span class="cat-badge cat-${l.categoriaStock||'hoy'}">${l.loteFecha ? `UO ${keyToFechaCL(l.loteFecha).slice(0,5)}` : (({hoy:'Hoy',ayer:'Ayer',antesayer:'Ant.',cuartoDia:'4to',ultimaOferta:'Últ.'})[l.categoriaStock||'hoy'] || l.categoriaStock)}</span></div>
        </div>
        <div class="qty-control">
          <button class="qty-btn" onclick="cambiarQty(${i}, -1)">−</button>
          <div class="qty-num">${l.cantidad}</div>
          <button class="qty-btn" onclick="cambiarQty(${i}, 1)">+</button>
        </div>
        <div class="linea-total">$${parseInt(l.totalBruto).toLocaleString('es-CL')}</div>
        <button class="btn-remove-linea" onclick="eliminarLinea(${i})">×</button>
      </div>
      <div class="linea-desc-row">
        <span class="linea-desc-label">Desc:</span>
        <input class="linea-desc-input" type="number" min="0" value="${l.descVal || ''}" placeholder="0"
               oninput="cambiarDescLinea(${i}, this.value)"/>
        <div class="linea-desc-tipo">
          <button id="desc-peso-${i}" class="linea-desc-tipo-btn ${l.descTipo === 'peso' ? 'active' : ''}"
                  onclick="selDescTipoLinea(${i}, 'peso')">$</button>
          <button id="desc-pct-${i}" class="linea-desc-tipo-btn ${l.descTipo === 'pct' ? 'active' : ''}"
                  onclick="selDescTipoLinea(${i}, 'pct')">%</button>
        </div>
        <span id="desc-result-${i}" class="linea-desc-result" style="${l.descMonto > 0 ? '' : 'display:none'}">
          ${l.descMonto > 0 ? `−$${parseInt(l.descMonto).toLocaleString('es-CL')} → $${parseInt(l.total).toLocaleString('es-CL')}` : ''}
        </span>
        <button class="btn-sm" id="notaBtn-${i}" onclick="toggleNotaLinea(${i})" style="margin-left:auto;font-size:11px;padding:3px 8px">
          ${tieneNota ? '📝 Nota ✓' : '📝 + Nota'}
        </button>
      </div>
      <div class="linea-nota-panel" id="notaPanel-${i}" style="display:${tieneNota ? '' : 'none'};margin-top:6px;padding:8px;background:#f7f9fc;border-radius:8px;display:flex;flex-direction:column;gap:6px">
        <input type="text" placeholder="Nombre cliente (opcional)" value="${l.clienteNombre || ''}"
               oninput="cambiarNotaLinea(${i}, 'clienteNombre', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid #ddd;border-radius:6px"/>
        ${esCafe ? `
        <select onchange="cambiarNotaLinea(${i}, 'tipoLeche', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid #ddd;border-radius:6px">
          <option value="">Tipo de leche (opcional)...</option>
          ${TIPOS_LECHE.map(t => `<option value="${t}" ${l.tipoLeche === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>` : ''}
        <input type="text" placeholder="Nota adicional (a mano)" value="${l.nota || ''}"
               oninput="cambiarNotaLinea(${i}, 'nota', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid #ddd;border-radius:6px"/>
      </div>
    </div>
  `;
  }).join('');
  calcularResumen();
}

// Muestra/oculta el panel de nota de una línea del pedido
window.toggleNotaLinea = function(i) {
  const panel = document.getElementById(`notaPanel-${i}`);
  if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
};

// Guarda cliente/tipo de leche/nota de una línea sin re-renderizar todo el carrito (evita perder el foco al escribir)
window.cambiarNotaLinea = function(i, campo, valor) {
  if (!pedidoLineas[i]) return;
  pedidoLineas[i][campo] = valor;
  const btn = document.getElementById(`notaBtn-${i}`);
  if (btn) {
    const l = pedidoLineas[i];
    btn.textContent = (l.clienteNombre || l.tipoLeche || l.nota) ? '📝 Nota ✓' : '📝 + Nota';
  }
  if (modoVenta === 'mesa-detail') persistirMesa();
};

// Calcula descMonto y total neto de una línea (muta el objeto)
function calcularDescLinea(linea) {
  const val = parseFloat(linea.descVal) || 0;
  if (linea.descTipo === 'pct') {
    linea.descMonto = Math.round(linea.totalBruto * val / 100);
  } else {
    linea.descMonto = Math.min(val, linea.totalBruto);
  }
  // Redondear al múltiplo de 10 más cercano hacia arriba (ej: 999 → 1000)
  const totalSinRedondear = Math.max(0, linea.totalBruto - linea.descMonto);
  linea.total = totalSinRedondear % 10 === 0
    ? totalSinRedondear
    : Math.ceil(totalSinRedondear / 10) * 10;
}

// Actualiza solo el resultado del descuento sin re-renderizar
function actualizarResultadoDesc(i) {
  const l = pedidoLineas[i];
  const el = document.getElementById(`desc-result-${i}`);
  if (!el) return;
  if (l.descMonto > 0) {
    el.textContent = `−$${parseInt(l.descMonto).toLocaleString('es-CL')} → $${parseInt(l.total).toLocaleString('es-CL')}`;
    el.style.display = '';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

window.cambiarDescLinea = function(i, val) {
  pedidoLineas[i].descVal = parseFloat(val) || 0;
  calcularDescLinea(pedidoLineas[i]);
  actualizarResultadoDesc(i);  // solo actualiza el resultado, sin re-renderizar
  calcularResumen();
};

window.selDescTipoLinea = function(i, tipo) {
  pedidoLineas[i].descTipo = tipo;
  calcularDescLinea(pedidoLineas[i]);
  // Toggle solo los botones de esa línea
  const btnPct  = document.getElementById(`desc-pct-${i}`);
  const btnPeso = document.getElementById(`desc-peso-${i}`);
  if (btnPct)  btnPct.classList.toggle('active',  tipo === 'pct');
  if (btnPeso) btnPeso.classList.toggle('active', tipo === 'peso');
  actualizarResultadoDesc(i);
  calcularResumen();
};

window.cambiarQty = function(i, delta) {
  const linea = pedidoLineas[i];
  const prod = productos.find(p => p.id === linea.id);
  const conControl = prod ? prod.controlStock !== false : true;
  if (delta > 0) {
    if (conControl) {
      const stockKey   = sucursal + '_' + linea.id;
      const stockItem  = window._stockMap ? window._stockMap[stockKey] : null;
      const disponible = linea.loteFecha
        ? (stockItem?.entradas?.[linea.loteFecha] || 0)
        : (stockItem ? getQtyCategoria(stockItem, linea.categoriaStock) : 0);
      const totalEnPedido = pedidoLineas
        .filter(l => l.id === linea.id && l.categoriaStock === linea.categoriaStock && (l.loteFecha || '') === (linea.loteFecha || ''))
        .reduce((a, l) => a + l.cantidad, 0);
      if (totalEnPedido >= disponible) {
        showToast(`⚠️ Stock máximo: ${disponible} ud. de ${linea.nombre}`, 'error');
        return;
      }
    }
  }
  pedidoLineas[i].cantidad = Math.max(1, linea.cantidad + delta);
  pedidoLineas[i].totalBruto = pedidoLineas[i].cantidad * linea.precio;
  calcularDescLinea(pedidoLineas[i]);
  renderPedido();

  if (modoVenta === 'mesa-detail') {
    if (conControl) {
      if (linea.loteFecha) {
        ajustarStockLote(linea.id, linea.loteFecha, -delta);
      } else {
        const esPermanente = prod && prod.autoEliminar === false;
        const cat = esPermanente ? 'permanente' : linea.categoriaStock;
        ajustarStock(linea.id, cat, -delta); // delta>0 (agregó) descuenta; delta<0 (quitó) devuelve
      }
    }
    persistirMesa();
  }
};

window.eliminarLinea = function(i) {
  const linea = pedidoLineas[i];
  pedidoLineas.splice(i, 1);
  renderPedido();

  if (modoVenta === 'mesa-detail' && linea) {
    const prod = productos.find(p => p.id === linea.id);
    const conControl = prod ? prod.controlStock !== false : true;
    if (conControl) {
      if (linea.loteFecha) {
        ajustarStockLote(linea.id, linea.loteFecha, linea.cantidad);
      } else {
        const esPermanente = prod && prod.autoEliminar === false;
        const cat = esPermanente ? 'permanente' : linea.categoriaStock;
        ajustarStock(linea.id, cat, linea.cantidad); // devuelve toda la cantidad de esa línea
      }
    }
    persistirMesa();
  }
};

window.calcularResumen = function() {
  const subtotal  = pedidoLineas.reduce((a, l) => a + (l.totalBruto || 0), 0);
  const descuento = pedidoLineas.reduce((a, l) => a + (l.descMonto  || 0), 0);
  const total     = pedidoLineas.reduce((a, l) => a + (l.total      || 0), 0);
  let html = `<div class="resumen-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('es-CL')}</span></div>`;
  if (descuento > 0) html += `<div class="resumen-row descuento"><span>Descuento</span><span>−$${descuento.toLocaleString('es-CL')}</span></div>`;
  html += `<div class="resumen-row total"><span>TOTAL</span><span>$${total.toLocaleString('es-CL')}</span></div>`;
  document.getElementById('resumenVenta').innerHTML = html;
  document.getElementById('resumenVenta').dataset.total     = total;
  document.getElementById('resumenVenta').dataset.descuento = descuento;
  document.getElementById('resumenVenta').dataset.subtotal  = subtotal;
};

window.selMedio = function(medio) {
  medioSeleccionado = medio;
  document.querySelectorAll('.medio-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('mp-' + medio).classList.add('selected');
};

// ── Pago dividido (opcional, normalmente no se usa) ──
window.togglePagoDividido = function() {
  pagoDividido = !pagoDividido;
  document.getElementById('pagoDivididoWrap').style.display = pagoDividido ? '' : 'none';
  document.getElementById('btnTogglePagoDividido').textContent = pagoDividido ? '− Un solo medio de pago' : '+ Dividir pago';
  document.querySelector('.medio-grid').style.display = pagoDividido ? 'none' : '';
  if (pagoDividido) actualizarRestanteDividido();
};

function resetPagoDividido() {
  pagoDividido = false;
  const wrap = document.getElementById('pagoDivididoWrap');
  const btn  = document.getElementById('btnTogglePagoDividido');
  const grid = document.querySelector('.medio-grid');
  if (wrap) wrap.style.display = 'none';
  if (btn)  btn.textContent = '+ Dividir pago';
  if (grid) grid.style.display = '';
  ['divEfectivo','divDebito','divCredito','divTransfer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

window.actualizarRestanteDividido = function() {
  const total = parseInt(document.getElementById('resumenVenta').dataset.total) || 0;
  const suma = ['divEfectivo','divDebito','divCredito','divTransfer']
    .reduce((a, id) => a + (parseInt(document.getElementById(id).value) || 0), 0);
  const restante = total - suma;
  const el = document.getElementById('divRestante');
  el.textContent = restante === 0 ? '✅ Cuadra con el total' : `Diferencia: $${Math.abs(restante).toLocaleString('es-CL')} ${restante > 0 ? 'faltan' : 'de más'}`;
  el.style.color = restante === 0 ? '#1D9E75' : '#e74c3c';
};

// Devuelve { medioPago } o { pagos: [...] } según si el pago está dividido
function obtenerDatosPago() {
  const r = obtenerDatosPagoBase();
  // v2.4.0: la venta cobrada con el Point integrado lleva su orden y su tipo de tarjeta; la cobrada a mano cuando
  // el Point estaba integrado queda marcada para cuadrarla con el reporte de Mercado Pago.
  if (pagoPointListo) r.pagoPoint = pagoPointListo;
  else if (pointIntegrado && pagoSinIntegracion) r.pagoSinIntegracion = true;
  return r;
}
function obtenerDatosPagoBase() {
  if (!pagoDividido) return { medioPago: medioSeleccionado };
  const mapa = [['efectivo','divEfectivo'], ['debito','divDebito'], ['credito','divCredito'], ['transferencia','divTransfer']];
  const pagos = mapa
    .map(([medio, elId]) => ({ medio, monto: parseInt(document.getElementById(elId).value) || 0 }))
    .filter(p => p.monto > 0);
  return { pagos };
}

// Aplica los incrementos correspondientes a la caja según el tipo de pago
async function incrementarTotalesCaja(pagoData, total) {
  if (pagoData.pagos) {
    const incrementos = {};
    pagoData.pagos.forEach(p => { incrementos[`totales.${p.medio}`] = increment(p.monto); });
    if (pagoData.pagoPoint) incrementos[`totalesPoint.${pagoData.pagoPoint.medio}`] = increment(pagoData.pagoPoint.monto); // v2.4.0
    await updateDoc(doc(db, 'cajas', cajaId), { ...incrementos, totalVentas: increment(total), nVentas: increment(1) });
  } else {
    await updateDoc(doc(db, 'cajas', cajaId), {
      [`totales.${pagoData.medioPago}`]: increment(total),
      ...(pagoData.pagoPoint ? { [`totalesPoint.${pagoData.pagoPoint.medio}`]: increment(pagoData.pagoPoint.monto) } : {}), // v2.4.0
      totalVentas: increment(total), nVentas: increment(1)
    });
  }
}

// ─── v2.6.0: cada venta de una sola vez (lote de escrituras) ───────────────
// Un id como los de Firestore (20 letras y números al azar), para conocer el id de la venta antes de guardarla.
function idNuevo() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(20); crypto.getRandomValues(b);
  return Array.from(b, x => abc[x % abc.length]).join('');
}
// Los productos que se venden por primera vez quedan marcados (tuvoVentas), en el mismo lote
function marcarProductosEnLote(lote, lineas) {
  const nuevos = [];
  for (const id of [...new Set((lineas || []).map(l => l.id).filter(Boolean))]) {
    const prod = productos.find(p => p.id === id);
    if (prod && !prod.tuvoVentas) { lote.update(doc(db, 'productos', id), { tuvoVentas: true }); nuevos.push(prod); }
  }
  return nuevos;
}
// Los mismos incrementos de incrementarTotalesCaja, en el lote
function totalesCajaEnLote(lote, pagoData, total) {
  const cambios = { totalVentas: increment(total), nVentas: increment(1) };
  if (pagoData.pagos) pagoData.pagos.forEach(p => { cambios[`totales.${p.medio}`] = increment(p.monto); });
  else cambios[`totales.${pagoData.medioPago}`] = increment(total);
  if (pagoData.pagoPoint) cambios[`totalesPoint.${pagoData.pagoPoint.medio}`] = increment(pagoData.pagoPoint.monto);
  lote.update(doc(db, 'cajas', cajaId), cambios);
}

// v2.6.1: la pantalla toma el stock que se acaba de leer (y, si la venta se registró, lo que quedó)
function stockPantallaDesdePlan(plan, vendido) {
  if (!plan || !plan.docs) return;
  window._stockMap = window._stockMap || {};
  for (const [k, d] of Object.entries(plan.docs)) {
    if (!d.existe) continue;
    const item = window._stockMap[k] || (window._stockMap[k] = {});
    item.entradas = Object.assign({}, vendido ? d.entradas : d.leido);
  }
  renderProductos();
}

// Enruta el botón "Registrar pago / Cobrar" según el modo activo
window.confirmarPagoBoton = function() {
  // v2.4.0: con el Point integrado, la parte con tarjeta se cobra primero en el Point
  const monto = montoTarjetaPoint();
  if (pointIntegrado && !pagoSinIntegracion && monto > 0 && pedidoLineas.length && cajaId) { cobrarConPoint(monto); return; }
  registrarConLoQueHay();
};
function registrarConLoQueHay() {
  if (modoVenta === 'mesa-detail') return cerrarYCobrarMesa();
  return registrarVenta();
}

// ─── v2.4.0: cobro con el Point de Mercado Pago integrado (modo PDV) ───────────
// La caja le pide el cobro al servidor de cobros (Cloudflare Worker fen-point) con la sesión de quien vende; el servidor
// elige el Point de la tienda y crea la orden en Mercado Pago. Cuando Mercado Pago confirma el pago, la venta se registra
// sola, con el tipo de tarjeta. El modo lo manda el Point: si está en modo normal (o no hay conexión con el servidor),
// la caja funciona como siempre. Ningún secreto vive aquí: las claves están en Cloudflare.
const PUNTO_URL = 'https://fen-point.panaderiafen.workers.dev';
const PT_VENCE_MS = 3 * 60 * 1000;
let pointIntegrado = false, pointRevisado = 0, pointTimer = null;
let pagoSinIntegracion = false;   // esta venta se cobra a mano aunque el Point esté integrado (plan B)
let pagoPointListo = null;        // pago confirmado que se está registrando
let pagoPointPendiente = null;    // pago confirmado cuya venta no alcanzó a registrarse (no se vuelve a cobrar)
let ptCobro = null, ptSondeo = null, ptReloj = null;
let ptIntentoAnterior = null, ptVigia = null;   // v2.4.1: el último cobro que no se completó (por si igual se pagó)
const ptNombreTienda = s => s === 'ainavillo' ? 'Ainavillo' : 'Barros Arana';
const ptPesos = n => '$' + (parseInt(n) || 0).toLocaleString('es-CL');

async function ptPedir(metodo, ruta, cuerpo) {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
  const r = await fetch(PUNTO_URL + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  let d = {}; try { d = await r.json(); } catch (e) { d = { ok: false, mensaje: 'Respuesta no válida (' + r.status + ')' }; }
  d.status = r.status;
  return d;
}

// ¿El Point de esta tienda está en modo integrado? Sin respuesta, la caja queda en el modo de siempre.
async function revisarModoPoint(forzar) {
  if (!sucursal || !auth.currentUser) return pointIntegrado;
  if (!forzar && Date.now() - pointRevisado < 60000) return pointIntegrado;
  pointRevisado = Date.now();
  try {
    const d = await ptPedir('GET', '/point?sucursal=' + encodeURIComponent(sucursal));
    pointIntegrado = !!(d.ok && d.integrado);
  } catch (e) { pointIntegrado = false; }
  pintarModoPoint();
  return pointIntegrado;
}
function pintarModoPoint() {
  const integrado = pointIntegrado && !pagoSinIntegracion;
  const deb = document.getElementById('mp-debito'), cre = document.getElementById('mp-credito');
  if (deb) deb.textContent = deb.textContent.replace(integrado ? 'Débito' : 'Tarjeta', integrado ? 'Tarjeta' : 'Débito');
  if (cre) cre.style.display = integrado ? 'none' : '';
  if (integrado && medioSeleccionado === 'credito') selMedio('debito');
  const lblDeb = document.querySelector('label[for="divDebito"]') || (document.getElementById('divDebito') || {}).previousElementSibling;
  if (lblDeb) lblDeb.textContent = lblDeb.textContent.replace(integrado ? 'Débito' : 'Tarjeta', integrado ? 'Tarjeta' : 'Débito');
  const divCre = document.getElementById('divCredito');
  if (divCre && divCre.parentElement) divCre.parentElement.style.display = integrado ? 'none' : '';
  if (integrado && divCre) divCre.value = '';
  const ins = document.getElementById('ptInsignia');
  if (ins) {
    if (pointIntegrado && pagoSinIntegracion) { ins.textContent = 'Point: cobro a mano en esta venta'; ins.className = 'pt-insignia pt-manual'; ins.style.display = ''; }
    else if (pointIntegrado) { ins.textContent = 'Point integrado'; ins.className = 'pt-insignia'; ins.style.display = ''; }
    else ins.style.display = 'none';
  }
}
function iniciarRevisionPoint() {
  revisarModoPoint(true);
  if (pointTimer) clearInterval(pointTimer);
  pointTimer = setInterval(() => { if (!document.getElementById('modalPoint').classList.contains('open')) revisarModoPoint(true); }, 3 * 60 * 1000);
}

// v2.4.1: un cobro vencido o cancelado puede terminar pagado en el Point (la tarjeta ya estaba pasando).
// Se sigue mirando 2 minutos; si se pagó, la venta se registra con ese pago.
function ptVigilar(c) {
  if (ptVigia) clearTimeout(ptVigia);
  const hasta = Date.now() + 120000;
  const mirar = async () => {
    if (ptIntentoAnterior !== c || ptCobro || Date.now() > hasta) return;
    let d = null;
    try { d = await ptPedir('GET', '/estado?ref=' + encodeURIComponent(c.referencia) + '&verificar=1'); } catch (e) { d = null; }
    if (ptIntentoAnterior !== c || ptCobro) return;
    if (d && d.ok && d.estado === 'pagado') { ptIntentoAnterior = null; ptCobro = c; return ptPagado(d); }
    ptVigia = setTimeout(mirar, 4000);
  };
  ptVigia = setTimeout(mirar, 4000);
}
// Antes de cobrar otra vez la misma venta, se revisa si el intento anterior terminó pagado
async function ptRevisarAnterior(monto, total) {
  const c = ptIntentoAnterior;
  if (!c || c.monto !== monto || c.total !== total) { ptIntentoAnterior = null; return false; }
  let d = null;
  try { d = await ptPedir('GET', '/estado?ref=' + encodeURIComponent(c.referencia) + '&verificar=1'); } catch (e) { d = null; }
  if (d && d.ok && d.estado === 'pagado') { ptIntentoAnterior = null; ptCobro = c; await ptPagado(d); return true; }
  if (d && d.ok && ['en_point', 'enviado', 'accion'].includes(d.estado)) { ptCobro = c; ptEsperando('El cobro anterior todavía está en el Point: páguelo o cancélelo ahí.'); ptSondear(0); return true; }
  ptIntentoAnterior = null;
  return false;
}

// Cuánto se cobra con tarjeta en esta venta (con el Point integrado, "Tarjeta" es el botón de Débito)
function montoTarjetaPoint() {
  const total = parseInt(document.getElementById('resumenVenta').dataset.total) || 0;
  if (!pagoDividido) return medioSeleccionado === 'debito' || medioSeleccionado === 'credito' ? total : 0;
  return (parseInt(document.getElementById('divDebito').value) || 0) + (parseInt(document.getElementById('divCredito').value) || 0);
}

function ptVentana(html) {
  document.getElementById('modalPointCuerpo').innerHTML = html;
  document.getElementById('modalPoint').classList.add('open');
}
function ptCerrarVentana() {
  document.getElementById('modalPoint').classList.remove('open');
  if (ptSondeo) { clearTimeout(ptSondeo); ptSondeo = null; }
  if (ptReloj) { clearInterval(ptReloj); ptReloj = null; }
}

async function cobrarConPoint(monto) {
  const total = parseInt(document.getElementById('resumenVenta').dataset.total) || 0;
  if (pagoDividido) {
    const pagos = obtenerDatosPagoBase().pagos || [];
    const suma = pagos.reduce((a, p) => a + p.monto, 0);
    if (suma !== total) { alert(`La suma de los medios de pago ($${suma.toLocaleString('es-CL')}) no coincide con el total ($${total.toLocaleString('es-CL')})`); return; }
  }
  // v2.6.1: antes de cobrar en el Point, se revisa que el stock alcance (venta directa; la mesa ya lo descontó)
  if (modoVenta !== 'mesa-detail' && !pagoPointPendiente) {
    const prev = await planearStockVenta(pedidoLineas, Timestamp.now());
    if (prev && prev.faltantes.length) {
      stockPantallaDesdePlan(prev, false);
      alert('No alcanza el stock (otra caja vendió mientras tanto):\n' + prev.faltantes.map(f => `· ${f.nombre}: pidió ${f.pedido}, quedan ${f.hay}`).join('\n') + '\n\nAjuste el pedido antes de cobrar.');
      return;
    }
  }
  // Un pago ya confirmado cuya venta no alcanzó a registrarse: se registra sin volver a cobrar
  if (pagoPointPendiente && pagoPointPendiente.monto === monto && pagoPointPendiente.total === total) { return registrarPagado(pagoPointPendiente); }
  // v2.4.1: si el intento anterior de esta misma venta terminó pagado (o sigue en el Point), no se cobra otra vez
  if (ptIntentoAnterior) {
    ptVentana(`<div class="pt-centro"><div class="pt-tit" id="ptTitulo">Revisando el cobro anterior…</div><div class="pt-monto">${ptPesos(monto)}</div></div>`);
    if (await ptRevisarAnterior(monto, total)) return;
  }
  const tienda = ptNombreTienda(sucursal);
  ptVentana(`<div class="pt-centro"><div class="pt-tienda">Point de ${tienda}</div><div class="pt-monto">${ptPesos(monto)}</div>
    <div class="pt-tit" id="ptTitulo">Enviando el cobro al Point…</div></div>`);
  const referencia = (sucursal === 'ainavillo' ? 'AI-' : 'BA-') + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  let d;
  try { d = await ptPedir('POST', '/cobrar', { sucursal, monto, referencia, descripcion: 'Venta Fën ' + tienda }); }
  catch (e) { return ptSinConexion(monto, 'No se pudo conectar con el servidor de cobros.'); }
  if (!d.ok) {
    if (d.status === 409 && /queued|cola/i.test(d.mensaje || '')) return ptSinConexion(monto, 'El Point tiene otro cobro pendiente. Cancélelo en el Point (o espere 3 minutos) y vuelva a cobrar.');
    return ptSinConexion(monto, d.mensaje || 'El servidor de cobros no aceptó el cobro.');
  }
  ptCobro = { referencia, monto, total, creada: Date.now(), estado: d.estado || 'enviado', tienda };
  ptEsperando();
  ptSondear(0);
}

function ptEsperando(aviso) {
  const c = ptCobro;
  ptVentana(`<div class="pt-centro"><div class="pt-tienda">Enviado al Point de ${c.tienda}</div><div class="pt-monto">${ptPesos(c.monto)}</div>
    <div class="pt-tit" id="ptTitulo">El cliente paga en el Point</div>
    <div class="pt-sub">No digite el monto: ya aparece en el Point. Esta pantalla avanza sola cuando Mercado Pago confirma el pago.</div>
    <div class="pt-barra"><div id="ptBarra" style="width:0%"></div></div>
    <div class="pt-sub" id="ptQueda"></div>
    ${aviso ? `<div class="pt-planb">${aviso}</div>` : ''}
    <div class="pt-botones"><button type="button" class="btn btn-danger" onclick="ptCancelar()">Cancelar cobro</button>
    <button type="button" class="btn btn-secondary" onclick="ptPlanB()">Cobrar sin integración</button></div></div>`);
  const pintar = () => {
    const pasado = Date.now() - c.creada, queda = Math.max(0, PT_VENCE_MS - pasado);
    const b = document.getElementById('ptBarra'); if (b) b.style.width = Math.min(100, pasado / PT_VENCE_MS * 100) + '%';
    const q = document.getElementById('ptQueda'); if (q) q.textContent = 'Esperando · el cobro vence en ' + Math.floor(queda / 60000) + ':' + String(Math.floor(queda / 1000) % 60).padStart(2, '0');
  };
  pintar();
  if (ptReloj) clearInterval(ptReloj);
  ptReloj = setInterval(pintar, 1000);
}

function ptSondear(n) {
  if (ptSondeo) clearTimeout(ptSondeo);
  ptSondeo = setTimeout(async () => {
    const c = ptCobro;
    if (!c) return;
    const verificar = Date.now() - c.creada > 3000; // v2.4.1: el servidor confirma con Mercado Pago (como mucho cada 3 s)
    let d = null;
    try { d = await ptPedir('GET', '/estado?ref=' + encodeURIComponent(c.referencia) + (verificar ? '&verificar=1' : '')); } catch (e) { d = null; }
    if (!ptCobro || ptCobro !== c) return;
    if (d && d.ok) {
      c.estado = d.estado;
      if (d.estado === 'pagado') return ptPagado(d);
      if (['cancelado', 'vencido', 'fallido', 'devuelto'].includes(d.estado)) return ptNoPagado(d.estado);
    }
    // Pasado el plazo sin respuesta, se pregunta directo a Mercado Pago en el siguiente intento
    ptSondear(Date.now() - c.creada > PT_VENCE_MS + 20000 ? 0 : n + 1);
  }, 2000);
}

function medioDeTipo(t) { return t === 'credito' ? 'credito' : 'debito'; }   // prepago y dinero en cuenta se suman a débito

async function ptPagado(d) {
  const c = ptCobro; ptCobro = null;
  const medio = medioDeTipo(d.tipoPago);
  const pago = { referencia: c.referencia, ordenId: d.ordenId || '', pagoId: d.pagoId || '', tipoPago: d.tipoPago || '', medio, monto: c.monto, total: c.total };
  const txt = { debito: 'Débito', credito: 'Crédito', prepago: 'Prepago', dinero_en_cuenta: 'Dinero en cuenta (QR)' }[d.tipoPago] || 'Tarjeta';
  ptVentana(`<div class="pt-centro"><div class="pt-tit pt-ok" id="ptTitulo">Pago confirmado</div><div class="pt-monto">${ptPesos(c.monto)}</div>
    <div class="pt-sub">${txt} · confirmado por Mercado Pago</div><div class="pt-sub">Registrando la venta…</div></div>`);
  return registrarPagado(pago);
}

async function registrarPagado(pago) {
  // El monto con tarjeta queda en Débito o Crédito según lo que dijo Mercado Pago
  if (pagoDividido) {
    const deb = document.getElementById('divDebito'), cre = document.getElementById('divCredito');
    deb.value = pago.medio === 'debito' ? pago.monto : ''; cre.value = pago.medio === 'credito' ? pago.monto : '';
  } else {
    medioSeleccionado = pago.medio;
  }
  pagoPointListo = { referencia: pago.referencia, ordenId: pago.ordenId, pagoId: pago.pagoId, tipoPago: pago.tipoPago, medio: pago.medio, monto: pago.monto };
  const antes = pedidoLineas.length;
  try { await registrarConLoQueHay(); } catch (e) { /* registrarVenta ya avisa */ }
  pagoPointListo = null;
  const registrada = antes > 0 && pedidoLineas.length === 0;
  if (registrada) {
    pagoPointPendiente = null; ptIntentoAnterior = null;
    ptCerrarVentana();
    if (!pagoDividido) selMedio('efectivo');
    pintarModoPoint();
  } else {
    pagoPointPendiente = pago;
    ptVentana(`<div class="pt-centro"><div class="pt-tit pt-mal" id="ptTitulo">El pago está confirmado, pero la venta no se registró</div>
      <div class="pt-monto">${ptPesos(pago.monto)}</div>
      <div class="pt-sub">No vuelva a cobrar al cliente. Revise internet y toque "Registrar venta": se registra con el pago ya confirmado.</div>
      <button type="button" class="btn btn-success pt-uno" onclick="ptCerrarVentana(); confirmarPagoBoton()">Registrar venta</button></div>`);
  }
}

function ptNoPagado(estado) {
  const c = ptCobro; ptCobro = null;
  if (ptReloj) { clearInterval(ptReloj); ptReloj = null; }
  ptIntentoAnterior = c; ptVigilar(c);
  const motivo = { cancelado: 'Se canceló el cobro.', vencido: 'Pasaron 3 minutos sin pagar.', fallido: 'La tarjeta fue rechazada o el pago falló.', devuelto: 'El pago se devolvió.' }[estado] || '';
  ptVentana(`<div class="pt-centro"><div class="pt-tit pt-mal" id="ptTitulo">El pago no se completó</div><div class="pt-monto">${ptPesos(c.monto)}</div>
    <div class="pt-sub">${motivo} La venta no se registró y el pedido sigue abierto.</div>
    <button type="button" class="btn btn-success pt-uno" onclick="ptCerrarVentana(); confirmarPagoBoton()">Volver a cobrar en el Point</button>
    <button type="button" class="btn btn-secondary pt-uno" onclick="ptCerrarVentana()">Cambiar medio de pago</button></div>`);
}

window.ptCancelar = async function() {
  const c = ptCobro; if (!c) return ptCerrarVentana();
  let d = null;
  try { d = await ptPedir('POST', '/cancelar', { referencia: c.referencia }); } catch (e) { d = null; }
  if (d && d.ok && d.estado === 'pagado') return ptPagado(d);
  if (d && d.ok && ['cancelado', 'vencido', 'fallido'].includes(d.estado)) { ptCobro = null; ptIntentoAnterior = c; ptVigilar(c); ptCerrarVentana(); showToast('Cobro cancelado'); return; }
  ptEsperando('El cobro ya está en el Point: cancélelo en el mismo Point (salga de la pantalla de cobro y confirme). Esta pantalla avanza sola.');
};
window.ptCerrarVentana = ptCerrarVentana;

function ptPasosPlanB() {
  return `<div class="pt-planb"><b>Cobrar sin integración</b><ol>
    <li>Si el cobro ya aparece en el Point, cancélelo ahí primero.</li>
    <li>En el Point: Más opciones › Ajustes › Modo de vinculación › modo normal (sin integración).</li>
    <li>Digite el monto en el Point y cobre como antes.</li>
    <li>En la caja, elija Débito o Crédito y registre la venta.</li></ol></div>`;
}
function ptSinConexion(monto, msg) {
  ptCobro = null;
  ptVentana(`<div class="pt-centro"><div class="pt-tit pt-mal" id="ptTitulo">No se pudo cobrar en el Point</div><div class="pt-monto">${ptPesos(monto)}</div>
    <div class="pt-sub">${msg}</div>
    <button type="button" class="btn btn-secondary pt-uno" onclick="ptCerrarVentana(); confirmarPagoBoton()">Intentar de nuevo</button>
    ${ptPasosPlanB()}
    <button type="button" class="btn btn-danger pt-uno" onclick="ptPlanB(true)">Cobrar sin integración</button></div>`);
}
// Plan B: esta venta se cobra a mano (Débito o Crédito, como antes). Si había un cobro en el Point, se intenta cancelar.
window.ptPlanB = async function(directo) {
  const c = ptCobro;
  if (c && !directo) {
    if (!confirm('¿Cobrar esta venta sin integración? Si el cobro ya aparece en el Point, cancélelo ahí antes de digitar el monto.')) return;
    ptCobro = null;
    try { await ptPedir('POST', '/cancelar', { referencia: c.referencia }); } catch (e) {}
  }
  ptCerrarVentana();
  pagoSinIntegracion = true;
  pintarModoPoint();
  showToast('Cobre en el Point digitando el monto, elija Débito o Crédito y registre la venta');
};

// ─── v2.4.0: cada equipo recuerda la tienda donde trabaja ───────────────────
const CLAVE_TIENDA_EQUIPO = 'fen_caja_tienda_equipo';
function tiendaDelEquipo() { try { return localStorage.getItem(CLAVE_TIENDA_EQUIPO) || ''; } catch (e) { return ''; } }
function recordarTiendaEquipo(s) { try { if (!localStorage.getItem(CLAVE_TIENDA_EQUIPO)) localStorage.setItem(CLAVE_TIENDA_EQUIPO, s); } catch (e) {} }

// ═══════════════════════════
// REGISTRAR VENTA
// ═══════════════════════════
// Marca cada producto vendido con tuvoVentas:true, una sola vez (no vuelve a escribir si ya lo tenía).
// Se usa para decidir si "Eliminar" puede borrar de verdad o debe marcar inactivo en su lugar —
// así nunca queda una venta histórica apuntando a un producto que ya no existe.
async function marcarProductosConVenta(lineas) {
  const idsUnicos = [...new Set((lineas || []).map(l => l.id).filter(Boolean))];
  for (const id of idsUnicos) {
    const prod = productos.find(p => p.id === id);
    if (prod && !prod.tuvoVentas) {
      prod.tuvoVentas = true;
      try { await updateDoc(doc(db, 'productos', id), { tuvoVentas: true }); }
      catch (e) { console.error('Error marcando tuvoVentas:', e); }
    }
  }
}

// ─── v2.2.0: tarjeta, lotes y agotado en cada venta ───────────────────────────
// Antes de guardar la venta se leen los mismos documentos de stock que ya se leían para
// descontar (uno por producto) y se decide el descuento con la misma lógica de siempre
// (permanente, lote elegido o FIFO dentro de la tarjeta). Así cada línea guarda en qué
// tarjeta se vendió y de qué lotes salió, sin lecturas ni escrituras nuevas.
// Si el stock no se puede leer (por ejemplo, sin conexión), la venta sigue exactamente
// como en la v2.1.1 (la línea guarda la tarjeta, pero no los lotes).
const CAJA_VERSION = '2.8.0';
function horaAgotadoCaja(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
}
async function planearStockVenta(lineas, fechaVenta) {
  try {
    const hoyKey = fechaKeyHoy();
    const hora = horaAgotadoCaja(fechaVenta);
    const docs = {};
    const plan = [];
    const faltantes = [];
    plan.faltantes = faltantes; plan.docs = docs; // v2.6.1
    for (const l of lineas) {
      const prod = productos.find(p => p.id === l.id);
      if (prod && prod.controlStock === false) { plan.push(null); continue; }
      const esPerm = prod && prod.autoEliminar === false;
      const stockKey = `${sucursal}_${l.id}`;
      let d = docs[stockKey];
      if (!d) {
        const ref = doc(db, 'stock', stockKey);
        const sn = await getDoc(ref);
        const data = sn.exists() ? (sn.data() || {}) : null;
        d = docs[stockKey] = { ref, existe: !!data, entradas: Object.assign({}, data && data.entradas), agotado: Object.assign({}, data && data.agotado) };
        d.leido = Object.assign({}, d.entradas); // v2.6.1: lo que había al leer, para la pantalla si falta
      }
      const p = { productoId: l.id, stockRef: d.ref, escrituras: [], campos: esPerm ? {} : { tarjeta: l.categoriaStock || 'hoy' } };
      plan.push(p);
      if (!d.existe) { faltantes.push({ nombre: (prod && prod.nombre) || l.nombre || l.id, pedido: l.cantidad, hay: 0 }); continue; }
      const entradas = d.entradas;
      if (esPerm) {
        const qtyActual = entradas['permanente'] || 0;
        p.escrituras.push({ key: 'permanente', nuevo: Math.max(0, qtyActual - l.cantidad), cantidad: Math.min(qtyActual, l.cantidad) });
      } else if (l.loteFecha) {
        const qtyActual = entradas[l.loteFecha] || 0;
        p.escrituras.push({ key: l.loteFecha, nuevo: Math.max(0, qtyActual - l.cantidad), cantidad: Math.min(qtyActual, l.cantidad) });
      } else {
        const cat = l.categoriaStock || 'hoy';
        const entradasCat = Object.entries(entradas)
          .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === cat)
          .sort(([a], [b]) => a.localeCompare(b));
        let toDeduct = l.cantidad;
        for (const [key, qty] of entradasCat) {
          if (toDeduct <= 0) break;
          const deducir = Math.min(qty, toDeduct);
          p.escrituras.push({ key, nuevo: Math.max(0, qty - deducir), cantidad: deducir });
          toDeduct -= deducir;
        }
      }
      // v2.6.1: ¿alcanzó? (otra caja pudo vender ese stock después de que se cargó la pantalla)
      const salio = p.escrituras.reduce((a, e) => a + e.cantidad, 0);
      if (salio < l.cantidad) faltantes.push({ nombre: (prod && prod.nombre) || l.nombre || l.id, pedido: l.cantidad, hay: salio });
      for (const e of p.escrituras) {
        const antes = entradas[e.key] || 0;
        entradas[e.key] = e.nuevo;
        if (esPerm) continue;
        if (e.cantidad > 0) { p.campos.lotes = p.campos.lotes || {}; p.campos.lotes[e.key] = (p.campos.lotes[e.key] || 0) + e.cantidad; }
        // El lote que entró HOY llega a 0 con esta venta: se anota la hora en la misma escritura
        if (e.key === hoyKey && antes > 0 && e.nuevo === 0) {
          if (d.agotado[hoyKey]) { e.extra = { [`reagotado.${hoyKey}`]: hora }; p.campos.reagotado = hora; }
          else { e.extra = { [`agotado.${hoyKey}`]: hora }; d.agotado[hoyKey] = hora; p.campos.agotado = hora; }
        }
      }
    }
    return plan;
  } catch (e) {
    console.error('v2.2.0: no se pudo leer el stock antes de la venta; sigue como en la v2.1.1', e);
    return null;
  }
}
// Agrega tarjeta (y lotes, agotado) a las líneas que se guardan en ventas. Solo productos con stock.
function agregarTarjetaYLotes(lineasVenta, lineasPedido, plan) {
  try {
    lineasVenta.forEach((vl, i) => {
      if (plan) { if (plan[i]) Object.assign(vl, plan[i].campos); return; }
      const l = lineasPedido[i] || {};
      const prod = productos.find(p => p.id === l.id);
      if (prod && (prod.controlStock === false || prod.autoEliminar === false)) return;
      vl.tarjeta = l.categoriaStock || 'hoy';
    });
  } catch (e) { console.error('v2.2.0: no se pudo anotar la tarjeta', e); }
}

// ─── v2.3.0: la venta guarda su foto ──────────────────────────────────────────
// Cada línea lleva lo que el Catálogo de Sistema Fën dice del producto AL VENDER: su ID del catálogo, de dónde sale
// (receta, reventa o cargo), su área y su receta o reventa. Si el producto cambia después, la venta sigue diciendo lo que era.
// Un producto anterior al catálogo (sin tipo) usa su ID de receta de siempre (idRecetaFen).
function fotoProductoCaja(id) {
  const p = productos.find(x => x.id === id) || (_todosProdsAdmin || []).find(x => x.id === id) || {};
  const tipo = String(p.tipo || '').trim();
  const idRec = String(p.idRecetaFen || '').trim();
  const area = normalizarArea(p.area);
  const esReventa = tipo === 'reventa' || (!tipo && /^REV\d+$/i.test(idRec));
  return {
    catalogoId: String(p.catalogoId || '').trim(), tipo, area: area === SIN_AREA ? '' : area,
    recetaId: esReventa || tipo === 'cargo' ? '' : String(p.recetaId || idRec).trim(),
    reventaId: esReventa ? String(p.reventaId || idRec).trim() : '',
    ...(Number(p.unidadesPorVenta) > 0 ? { unidadesPorVenta: Number(p.unidadesPorVenta) } : {})
  };
}

window.registrarVenta = async function() {
  if (pedidoLineas.length === 0) return;
  if (!cajaId) { alert('Debes abrir la caja primero'); return; }
  const resumen = document.getElementById('resumenVenta');
  const total    = parseInt(resumen.dataset.total)    || 0;
  const subtotal = parseInt(resumen.dataset.subtotal) || 0;
  const descuento = parseInt(resumen.dataset.descuento) || 0;
  const pagoData = obtenerDatosPago();
  if (pagoData.pagos) {
    const suma = pagoData.pagos.reduce((a, p) => a + p.monto, 0);
    if (suma !== total) { alert(`La suma de los medios de pago ($${suma.toLocaleString('es-CL')}) no coincide con el total ($${total.toLocaleString('es-CL')})`); return; }
  }
  const btn = document.getElementById('btnPagar');
  btn.disabled = true;
  btn.textContent = 'Registrando...';
  const venta = {
    sucursal,
    usuario: usuario.email,
    fecha: Timestamp.now(),
    lineas: pedidoLineas.map(l => ({
      id: l.id, nombre: l.nombre, precio: l.precio, cantidad: l.cantidad,
      totalBruto: l.totalBruto, descTipo: l.descTipo, descVal: l.descVal,
      descMonto: l.descMonto, total: l.total, loteFecha: l.loteFecha || '',
      clienteNombre: l.clienteNombre || '', tipoLeche: l.tipoLeche || '', nota: l.nota || '',
      ...fotoProductoCaja(l.id) // v2.3.0: la foto de la venta
    })),
    subtotal, descuento, total,
    ...pagoData,
    cajaId
  };
  // v2.2.0: tarjeta y lotes de cada línea (mismas lecturas de stock, antes de guardar)
  const planStock = await planearStockVenta(pedidoLineas, venta.fecha);
  // v2.6.1: si otra caja ya vendió ese stock, se avisa y no se registra
  if (planStock && planStock.faltantes.length) {
    stockPantallaDesdePlan(planStock, false);
    btn.disabled = false; btn.textContent = '✓ Registrar pago';
    alert('No alcanza el stock (otra caja vendió mientras tanto):\n' + planStock.faltantes.map(f => `· ${f.nombre}: pidió ${f.pedido}, quedan ${f.hay}`).join('\n') + '\n\nAjuste el pedido y vuelva a cobrar.');
    return;
  }
  agregarTarjetaYLotes(venta.lineas, pedidoLineas, planStock);
  try {
    if (planStock) {
      // v2.6.0: la venta, los productos vendidos, los totales de la caja, el stock y su movimiento, de una sola vez
      const lote = writeBatch(db);
      const ventaRef = doc(db, 'ventas', idNuevo());
      lote.set(ventaRef, venta);
      const marcados = marcarProductosEnLote(lote, venta.lineas);
      totalesCajaEnLote(lote, pagoData, total);
      const descontadosLote = [];
      for (const p of planStock) {
        if (!p) continue;
        for (const e of p.escrituras) {
          // Se resta lo que sale (no se escribe el número nuevo): dos equipos a la vez no se pisan
          lote.update(p.stockRef, Object.assign({ [`entradas.${e.key}`]: increment(-e.cantidad) }, e.extra || {}));
          descontadosLote.push({ productoId: p.productoId, key: e.key, cantidad: e.cantidad });
        }
      }
      const mov = descontadosLote.filter(d => d && d.cantidad > 0);
      if (mov.length) lote.set(doc(db, 'stockMovimientos', idNuevo()), { tipo: 'venta', ventaId: ventaRef.id, sucursal, descontados: mov, usuario: usuario.email, fecha: Timestamp.now() });
      await lote.commit();
      marcados.forEach(p => { p.tuvoVentas = true; });
      stockPantallaDesdePlan(planStock, true); // v2.6.1: lo vendido se descuenta en pantalla al instante
    } else {
    const ventaRef = await addDoc(collection(db, 'ventas'), venta);
    await marcarProductosConVenta(venta.lineas);
    // Actualizar caja
    await incrementarTotalesCaja(pagoData, total);
    // v2.1.1: se anota de qué lote salió cada unidad, para devolverla ahí si la venta se anula
    const descontados = [];
    if (false) {
      // v2.2.0: el mismo descuento de siempre, ya decidido antes de guardar la venta
      for (const p of planStock) {
        if (!p) continue;
        for (const e of p.escrituras) {
          await updateDoc(p.stockRef, Object.assign({ [`entradas.${e.key}`]: e.nuevo }, e.extra || {}));
          descontados.push({ productoId: p.productoId, key: e.key, cantidad: e.cantidad });
        }
      }
    } else {
    // Descontar stock — FIFO por fechas (más antiguo primero dentro de la categoría)
    for (const l of pedidoLineas) {
      const prod = productos.find(p => p.id === l.id);
      if (prod && prod.controlStock === false) continue;
      const esPerm   = prod && prod.autoEliminar === false;
      const stockRef  = doc(db, 'stock', `${sucursal}_${l.id}`);
      const stockSnap = await getDoc(stockRef);
      if (!stockSnap.exists()) continue;
      const entradas = stockSnap.data().entradas || {};

      if (esPerm) {
        // Producto permanente: descontar siempre de la clave "permanente"
        const qtyActual = entradas['permanente'] || 0;
        await updateDoc(stockRef, { 'entradas.permanente': Math.max(0, qtyActual - l.cantidad) });
        descontados.push({ productoId: l.id, key: 'permanente', cantidad: Math.min(qtyActual, l.cantidad) });
      } else if (l.loteFecha) {
        // Lote específico elegido por el cajero (Última oferta con más de un lote): descuenta ESE lote, no FIFO
        const qtyActual = entradas[l.loteFecha] || 0;
        await updateDoc(stockRef, { [`entradas.${l.loteFecha}`]: Math.max(0, qtyActual - l.cantidad) });
        descontados.push({ productoId: l.id, key: l.loteFecha, cantidad: Math.min(qtyActual, l.cantidad) });
      } else {
        // Producto perecedero: FIFO dentro de la categoría
        const cat = l.categoriaStock || 'hoy';
        const entradasCat = Object.entries(entradas)
          .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === cat)
          .sort(([a], [b]) => a.localeCompare(b));
        let toDeduct = l.cantidad;
        for (const [key, qty] of entradasCat) {
          if (toDeduct <= 0) break;
          const deducir = Math.min(qty, toDeduct);
          await updateDoc(stockRef, { [`entradas.${key}`]: Math.max(0, qty - deducir) });
          descontados.push({ productoId: l.id, key, cantidad: deducir });
          toDeduct -= deducir;
        }
      }
    }
    }
    await registrarMovimientoVenta(ventaRef.id, descontados);
    } // v2.6.0: fin del camino sin plan de stock (como antes)
    ultimaVentaRegistrada = venta;
    pedidoLineas = [];
    resetPagoDividido();
    pagoSinIntegracion = false; ptIntentoAnterior = null; pintarModoPoint(); // v2.4.0 · v2.4.1
    renderPedido();
    await cargarUltimasVentas();
    showToast(`✅ Venta registrada · $${total.toLocaleString('es-CL')}`);
  } catch(e) {
    alert('Error al registrar: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '✓ Registrar pago';
};

// ═══════════════════════════
// CERRAR Y COBRAR MESA
// ═══════════════════════════
// El stock de los productos de la mesa ya fue descontado al momento de agregarlos,
// así que acá solo se registra la venta, se actualiza la caja y se cierra la mesa.
window.cerrarYCobrarMesa = async function() {
  if (pedidoLineas.length === 0) { alert('La mesa no tiene productos todavía'); return; }
  if (!cajaId) { alert('Debes abrir la caja primero'); return; }
  const resumen = document.getElementById('resumenVenta');
  const total    = parseInt(resumen.dataset.total)    || 0;
  const subtotal = parseInt(resumen.dataset.subtotal) || 0;
  const descuento = parseInt(resumen.dataset.descuento) || 0;
  const pagoData = obtenerDatosPago();
  if (pagoData.pagos) {
    const suma = pagoData.pagos.reduce((a, p) => a + p.monto, 0);
    if (suma !== total) { alert(`La suma de los medios de pago ($${suma.toLocaleString('es-CL')}) no coincide con el total ($${total.toLocaleString('es-CL')})`); return; }
  }
  const btn = document.getElementById('btnPagar');
  btn.disabled = true;
  btn.textContent = 'Cobrando...';
  const venta = {
    sucursal,
    usuario: usuario.email,
    fecha: Timestamp.now(),
    lineas: pedidoLineas.map(l => ({
      id: l.id, nombre: l.nombre, precio: l.precio, cantidad: l.cantidad,
      totalBruto: l.totalBruto, descTipo: l.descTipo, descVal: l.descVal,
      descMonto: l.descMonto, total: l.total, loteFecha: l.loteFecha || '',
      clienteNombre: l.clienteNombre || '', tipoLeche: l.tipoLeche || '', nota: l.nota || '',
      ...fotoProductoCaja(l.id) // v2.3.0: la foto de la venta
    })),
    subtotal, descuento, total,
    ...pagoData,
    cajaId,
    origenMesa: mesaActivaId, mesaNombre: mesaActivaNombre
  };
  agregarTarjetaYLotes(venta.lineas, pedidoLineas, null); // v2.2.0
  try {
    // v2.6.0: de una sola vez. El stock NO se vuelve a descontar acá — ya se descontó al agregar cada producto a la mesa.
    const lote = writeBatch(db);
    lote.set(doc(db, 'ventas', idNuevo()), venta);
    const marcados = marcarProductosEnLote(lote, venta.lineas);
    totalesCajaEnLote(lote, pagoData, total);
    lote.update(doc(db, 'mesas', mesaActivaId), { estado: 'cerrada', cierre: Timestamp.now(), total });
    await lote.commit();
    marcados.forEach(p => { p.tuvoVentas = true; });
    ultimaVentaRegistrada = venta;
    showToast(`✅ Mesa cobrada · $${total.toLocaleString('es-CL')}`);
    pedidoLineas = [];
    resetPagoDividido();
    pagoSinIntegracion = false; ptIntentoAnterior = null; pintarModoPoint(); // v2.4.0 · v2.4.1
    volverAMesas();
  } catch(e) {
    alert('Error al cobrar mesa: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '💳 Cobrar y cerrar mesa';
};

// ═══════════════════════════
// COMANDA
// ═══════════════════════════
window.cambiarAnchoPapel = function(val) {
  localStorage.setItem('anchoPapelMM', val);
};

window.cambiarMetodoImpresion = function(val) {
  localStorage.setItem('metodoImpresion', val);
};

window.imprimirComanda = async function(venta) {
  // Si no se pasa una venta explícita: usa el carrito actual si tiene productos,
  // o si ya está vacío (por ejemplo, después de "Registrar pago"), reimprime la última venta registrada.
  const fuente = venta || (pedidoLineas.length > 0
    ? { lineas: pedidoLineas, total: parseInt(document.getElementById('resumenVenta').dataset.total) || 0, medioPago: medioSeleccionado, pagos: pagoDividido ? obtenerDatosPago().pagos : null }
    : ultimaVentaRegistrada);

  if (!fuente || !fuente.lineas || fuente.lineas.length === 0) {
    alert('No hay ningún pedido para imprimir todavía.');
    return;
  }

  const lineas = fuente.lineas;
  const total = fuente.total;
  const medio = fuente.pagos ? 'Dividido' : fuente.medioPago;
  const suc = sucursal === 'ainavillo' ? 'Ainavillo 764' : 'Barros Arana';
  const fecha = new Date().toLocaleString('es-CL');

  // Actualiza siempre la vista previa (se usa en el camino "navegador/RawBT")
  document.getElementById('cmdSucursal').textContent = suc;
  document.getElementById('cmdFecha').textContent = fecha;
  document.getElementById('cmdLineas').innerHTML = lineas.map(l => {
    const extra = [l.clienteNombre, l.tipoLeche, l.nota].filter(Boolean).join(' · ');
    return `${l.nombre} x${l.cantidad} ........ $${parseInt(l.total).toLocaleString('es-CL')}` +
      (extra ? `<br/><span style="font-size:11px;color:#555">&nbsp;&nbsp;📝 ${extra}</span>` : '');
  }).join('<br/>');
  document.getElementById('cmdTotal').textContent = `TOTAL: $${total.toLocaleString('es-CL')}`;
  document.getElementById('cmdMedio').textContent = `Medio: ${medio}`;

  // Método por defecto: RawBT/navegador en Android, QZ Tray en PC (se puede cambiar y queda guardado en el dispositivo)
  const metodo = localStorage.getItem('metodoImpresion') || (navigator.userAgent.includes('Android') ? 'navegador' : 'qz');

  if (metodo === 'qz') {
    await imprimirConQZ({ suc, fecha, lineas, total, medio });
    return;
  }

  // Ajusta el tamaño de página impresa al ancho de papel térmico elegido (58mm u 80mm)
  const anchoMM = localStorage.getItem('anchoPapelMM') || '80';
  let styleTag = document.getElementById('pageSizeStyle');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'pageSizeStyle';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `@page { size: ${anchoMM}mm auto; margin: 0; }`;

  window.print();
};

// Imprime directo a la impresora térmica vía QZ Tray (texto plano ESC/POS + corte automático),
// evitando el driver de Windows por completo. Requiere QZ Tray abierto en el PC (ícono en la bandeja).
async function imprimirConQZ({ suc, fecha, lineas, total, medio }) {
  if (typeof qz === 'undefined') {
    alert('No se pudo cargar la librería de QZ Tray (revisa la conexión a internet).');
    return;
  }
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect();
    }
    const printer = await qz.printers.getDefault();
    const config = qz.configs.create(printer);

    const ESC = '\x1B', GS = '\x1D';
    let cmd = ESC + '@';             // reset impresora
    cmd += ESC + 'a' + '\x01';        // centrado
    cmd += 'PANADERIA FEN\n';
    cmd += ESC + 'a' + '\x00';        // alinear izquierda
    cmd += suc + '\n' + fecha + '\n';
    cmd += '--------------------------------\n';
    lineas.forEach(l => {
      cmd += `${l.nombre} x${l.cantidad} ........ $${parseInt(l.total).toLocaleString('es-CL')}\n`;
      const extra = [l.clienteNombre, l.tipoLeche, l.nota].filter(Boolean).join(' - ');
      if (extra) cmd += `  * ${extra}\n`;
    });
    cmd += '--------------------------------\n';
    cmd += `TOTAL: $${total.toLocaleString('es-CL')}\n`;
    cmd += `Medio: ${medio}\n`;
    cmd += GS + 'V' + '\x42' + '\x05'; // avanza 5 líneas de papel y luego corta (más margen antes del corte)

    await qz.print(config, [{ type: 'raw', format: 'command', flavor: 'plain', data: cmd }]);
  } catch(e) {
    alert('Error al imprimir con QZ Tray: ' + e.message + '\n\nVerifica que QZ Tray esté abierto (ícono en la bandeja del sistema, junto al reloj).');
  }
}

// ═══════════════════════════
// CAJA
// ═══════════════════════════
async function verificarCaja() {
  const hoy = fechaLocalHoy();
  const q = query(collection(db, 'cajas'),
    where('sucursal', '==', sucursal),
    where('fecha', '==', hoy),
    where('estado', '==', 'abierta')
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    cajaId = snap.docs[0].id;
    document.getElementById('cardAbrirCaja').classList.add('hidden');
    document.getElementById('cardCajaAbierta').classList.remove('hidden');
    mostrarResumenCaja(snap.docs[0].data());
    await cargarUltimasVentas();
  }
  await avisarCajaAnterior();
}

// v2.1: si en esta sucursal quedó abierta una caja de un día anterior (por ejemplo,
// pasó la medianoche sin cerrar), se avisa aquí mismo con el botón para cerrarla.
async function avisarCajaAnterior() {
  const wrap = document.getElementById('avisoCajaAnterior');
  if (!wrap) return;
  wrap.innerHTML = '';
  try {
    const hoy = fechaLocalHoy();
    const sn = await getDocs(query(collection(db, 'cajas'), where('sucursal', '==', sucursal), where('estado', '==', 'abierta')));
    const viejas = sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.fecha !== hoy);
    if (!viejas.length) return;
    wrap.innerHTML = `
    <div class="card" style="border:1px solid #f0ad4e;background:#fffaf0">
      <div class="card-title" style="color:#8a6416">Caja anterior sin cerrar</div>
      <p style="font-size:12px;color:#8a6416;margin-bottom:10px">Quedó abierta una caja de un día anterior. Ciérrala con el conteo de ese turno para que su cierre quede con su resumen.</p>
      ${viejas.map(c => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:0.5px solid #f0d9a0">
          <div style="font-size:13px"><b>${escHtml(fechaDMY(c.fecha))}</b> <span style="color:#888;font-size:11px">(${escHtml(c.usuario)} · $${parseInt(c.totalVentas || 0).toLocaleString('es-CL')} vendidos)</span></div>
          <button class="btn-sm btn-edit" onclick="cerrarCaja('${c.id}')">Cerrar con arqueo</button>
        </div>`).join('')}
    </div>`;
  } catch (e) { console.error('No se pudo revisar cajas anteriores:', e); }
}

// ═══════════════════════════
// ÚLTIMAS VENTAS
// ═══════════════════════════
async function cargarUltimasVentas() {
  const card = document.getElementById('cardUltimasVentas');
  const list = document.getElementById('ultimasVentasList');
  if (!cajaId) { card.style.display = 'none'; return; }
  try {
    const snap = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', cajaId)));
    if (snap.empty) { card.style.display = 'none'; return; }
    const ventas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0)); // todas, más reciente primero

    const medioLabel = { efectivo: '💵 Efectivo', debito: '💳 Débito', credito: '💳 Crédito', transferencia: '📲 Transfer.' };

    ventasTurnoCache = {}; // se refresca cada vez que se recarga la lista

    list.innerHTML = ventas.map(v => {
      ventasTurnoCache[v.id] = v;
      const fecha = v.fecha?.toDate ? v.fecha.toDate() : new Date();
      const fechaStr = fecha.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const esAnulada = v.anulada === true;
      const tienePendiente = v.solicitudAnulacionPendiente === true;

      const medioBadge = v.pagos
        ? `<span class="ultimas-venta-medio" title="${v.pagos.map(p => `${medioLabel[p.medio]||p.medio}: $${p.monto.toLocaleString('es-CL')}`).join(' · ')}">🔀 Dividido</span>`
        : esAnulada
          ? `<span class="ultimas-venta-medio anulada-badge">${medioLabel[v.medioPago] || v.medioPago}</span>`
          : `<button class="ultimas-venta-medio" onclick="abrirModalEditarMedio('${v.id}','${v.medioPago}')" title="Cambiar medio de pago">${medioLabel[v.medioPago] || v.medioPago} ✏️</button>`;

      const btnComanda = `<button onclick="reimprimirVentaTurno('${v.id}')" title="Reimprimir comanda">🖨 Comanda</button>`;

      const acciones = esAnulada
        ? `<div class="ultimas-venta-acciones"><span class="ultimas-venta-anulada-tag">🚫 Venta anulada${v.motivoAnulacion ? ': ' + v.motivoAnulacion : ''}</span>${btnComanda}</div>`
        : tienePendiente
          ? `<div class="ultimas-venta-acciones"><span class="ultimas-venta-pendiente-tag">⏳ Anulación pendiente de aprobación</span>${btnComanda}</div>`
          : `<div class="ultimas-venta-acciones">
              ${btnComanda}
              <button class="btn-anular" onclick="abrirModalAnulacion('${v.id}')">🗑️ Solicitar anulación</button>
            </div>`;

      return `
        <div class="ultimas-venta-item${esAnulada ? ' anulada' : ''}">
          <div class="ultimas-venta-header">
            <span class="ultimas-venta-fecha">${fechaStr}</span>
            ${medioBadge}
          </div>
          ${(v.lineas || []).map(l => `
            <div class="ultimas-venta-linea">
              <span>${l.nombre} × ${l.cantidad}</span>
              <span>$${parseInt(l.total).toLocaleString('es-CL')}</span>
            </div>
          `).join('')}
          <div class="ultimas-venta-total">Total: $${parseInt(v.total).toLocaleString('es-CL')}</div>
          ${acciones}
        </div>
      `;
    }).join('');
    card.style.display = 'block';
  } catch(e) {
    console.error('Error cargando últimas ventas:', e);
  }
}

// ══════════════════════════════════
// EDITAR MEDIO DE PAGO
// ══════════════════════════════════
let _medioEditSeleccionado = null;

window.abrirModalEditarMedio = function(ventaId, medioActual) {
  const vPoint = ventasTurnoCache[ventaId];
  if (vPoint && vPoint.pagoPoint) { alert('Esta venta se cobró con el Point integrado: el medio de pago lo confirmó Mercado Pago y no se cambia aquí.'); return; } // v2.4.0
  document.getElementById('editVentaId').value = ventaId;
  _medioEditSeleccionado = medioActual;
  ['efectivo','debito','credito','transferencia'].forEach(m => {
    document.getElementById('em-' + m).classList.toggle('selected', m === medioActual);
  });
  document.getElementById('modalEditarMedio').classList.add('open');
};

window.cerrarModalEditarMedio = function() {
  document.getElementById('modalEditarMedio').classList.remove('open');
};

window.selMedioEdit = function(medio) {
  _medioEditSeleccionado = medio;
  ['efectivo','debito','credito','transferencia'].forEach(m => {
    document.getElementById('em-' + m).classList.toggle('selected', m === medio);
  });
};

window.confirmarEditarMedio = async function() {
  const btn = document.getElementById('btnConfirmarEditMedio');
  const ventaId = document.getElementById('editVentaId').value;
  if (!ventaId || !_medioEditSeleccionado) return;

  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const ventaRef = doc(db, 'ventas', ventaId);
    const ventaSnap = await getDoc(ventaRef);
    if (!ventaSnap.exists()) throw new Error('La venta ya no existe');
    const venta = ventaSnap.data();
    const medioAnterior = venta.medioPago;

    if (medioAnterior === _medioEditSeleccionado) {
      cerrarModalEditarMedio();
      btn.disabled = false; btn.textContent = '✓ Guardar cambio';
      return;
    }

    // 1. Sobrescribir el medio de pago en la venta (con rastro de auditoría)
    await updateDoc(ventaRef, {
      medioPago: _medioEditSeleccionado,
      medioPagoOriginal: venta.medioPagoOriginal || medioAnterior,
      medioPagoEditadoPor: usuario.email,
      medioPagoEditadoFecha: Timestamp.now()
    });

    // 2. Ajustar los totales acumulados de la caja (resta del medio viejo, suma al nuevo)
    //    — esto es un contador agregado, no se puede simplemente sobrescribir.
    if (venta.cajaId) {
      await updateDoc(doc(db, 'cajas', venta.cajaId), {
        [`totales.${medioAnterior}`]: increment(-venta.total),
        [`totales.${_medioEditSeleccionado}`]: increment(venta.total)
      });
    }

    cerrarModalEditarMedio();
    await cargarUltimasVentas();
    // Refrescar el arqueo visible si la caja sigue abierta
    if (cajaId) {
      const cajaSnap = await getDoc(doc(db, 'cajas', cajaId));
      if (cajaSnap.exists()) mostrarResumenCaja(cajaSnap.data());
    }
    showToast('✅ Medio de pago actualizado');
  } catch(e) {
    alert('Error al actualizar: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '✓ Guardar cambio';
};

// ══════════════════════════════════
// SOLICITAR ANULACIÓN DE VENTA
// ══════════════════════════════════
window.abrirModalAnulacion = function(ventaId) {
  document.getElementById('anulVentaId').value = ventaId;
  document.getElementById('anulMotivo').value = '';
  document.getElementById('modalSolicitarAnulacion').classList.add('open');
};

window.cerrarModalAnulacion = function() {
  document.getElementById('modalSolicitarAnulacion').classList.remove('open');
};

window.confirmarSolicitudAnulacion = async function() {
  const btn = document.getElementById('btnConfirmarAnulacion');
  const ventaId = document.getElementById('anulVentaId').value;
  const motivo  = document.getElementById('anulMotivo').value.trim();
  if (!ventaId) return;
  if (!motivo) { alert('Por favor describe el motivo de la anulación'); return; }

  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const ventaRef = doc(db, 'ventas', ventaId);
    const ventaSnap = await getDoc(ventaRef);
    if (!ventaSnap.exists()) throw new Error('La venta ya no existe');
    const venta = ventaSnap.data();

    // 1. Crear la solicitud
    const solicitudRef = await addDoc(collection(db, 'solicitudes_anulacion'), {
      ventaId, sucursal, cajaId: venta.cajaId || null,
      total: venta.total, medioPago: venta.medioPago,
      lineasResumen: (venta.lineas || []).map(l => `${l.nombre} x${l.cantidad}`).join(', '),
      motivo,
      solicitadoPor: usuario.email,
      fechaSolicitud: Timestamp.now(),
      estado: 'pendiente'
    });

    // 2. Marcar la venta como con solicitud pendiente (solo visual, no se anula aún)
    await updateDoc(ventaRef, { solicitudAnulacionPendiente: true });

    // 3. v2.3.1: aviso por correo a la administración (no aprueba nada, solo avisa). Sale sin esperar: si falla, la
    //    solicitud queda igual en Firestore (Reportes → Solicitudes y Sistema Fën → Hoy).
    avisarPorCorreo(APPS_SCRIPT_URL, {
      tipo: 'solicitud_anulacion',
      sucursal, solicitante: usuario.email, motivo,
      total: venta.total, medioPago: venta.medioPago,
      lineasResumen: (venta.lineas || []).map(l => `${l.nombre} x${l.cantidad}`).join(', '),
      solicitudId: solicitudRef.id
    });

    cerrarModalAnulacion();
    await cargarUltimasVentas();
    showToast('📩 Solicitud enviada al administrador');
  } catch(e) {
    alert('Error al enviar la solicitud: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '📩 Enviar solicitud';
};

// Busca el último cierre de caja de esta sucursal que tenga saldoSiguiente
// y lo sugiere como monto inicial del turno siguiente
async function cargarSaldoSugerido() {
  const hint = document.getElementById('saldoSugeridoHint');
  const input = document.getElementById('cajaMontoInicial');
  if (!hint || !input) return;
  hint.style.display = 'none';
  try {
    const snap = await getDocs(query(
      collection(db, 'cajas'),
      where('sucursal', '==', sucursal),
      where('estado', '==', 'cerrada')
    ));
    if (snap.empty) return;
    // Buscar la más reciente con saldoSiguiente
    const cierres = snap.docs.map(d => d.data())
      .filter(d => d.saldoSiguiente != null)
      .sort((a, b) => (b.cierre?.seconds || 0) - (a.cierre?.seconds || 0));
    if (!cierres.length) return;
    const ultimo = cierres[0];
    const saldo = parseInt(ultimo.saldoSiguiente);
    if (saldo < 0) return;
    hint.textContent = `💡 Saldo sugerido del turno anterior: $${saldo.toLocaleString('es-CL')} — puedes ajustarlo si es necesario`;
    hint.style.display = 'block';
    // Pre-llenar solo si el campo está vacío
    if (!input.value) input.value = saldo;
  } catch(e) { console.error('Error cargando saldo sugerido:', e); }
}

window.abrirCaja = async function() {
  const btn   = document.getElementById('btnAbrirCaja');
  const monto = parseInt(document.getElementById('cajaMontoInicial').value) || 0;
  btn.disabled = true; btn.textContent = 'Abriendo...';
  const hoy = fechaLocalHoy();
  try {
    const ref = await addDoc(collection(db, 'cajas'), {
      sucursal, usuario: usuario.email, fecha: hoy,
      montoInicial: monto, estado: 'abierta',
      totales: { efectivo: 0, debito: 0, credito: 0, transferencia: 0 },
      totalVentas: 0, nVentas: 0,
      apertura: Timestamp.now()
    });
    cajaId = ref.id;
    document.getElementById('cardAbrirCaja').classList.add('hidden');
    document.getElementById('cardCajaAbierta').classList.remove('hidden');
    mostrarResumenCaja({ montoInicial: monto, totales: { efectivo: 0, debito: 0, credito: 0, transferencia: 0 }, totalVentas: 0, nVentas: 0 });
    showToast('✅ Caja abierta');
  } catch(e) { alert('Error al abrir caja: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Abrir caja';
};

function mostrarResumenCaja(data) {
  const t = data.totales || {};
  document.getElementById('resumenCaja').innerHTML = `
    <div class="resumen-row"><span>Monto inicial</span><span>$${parseInt(data.montoInicial||0).toLocaleString('es-CL')}</span></div>
    <div class="resumen-row"><span>💵 Efectivo</span><span>$${parseInt(t.efectivo||0).toLocaleString('es-CL')}</span></div>
    <div class="resumen-row"><span>💳 Débito</span><span>$${parseInt(t.debito||0).toLocaleString('es-CL')}</span></div>
    <div class="resumen-row"><span>💳 Crédito</span><span>$${parseInt(t.credito||0).toLocaleString('es-CL')}</span></div>
    <div class="resumen-row"><span>📲 Transferencia</span><span>$${parseInt(t.transferencia||0).toLocaleString('es-CL')}</span></div>
    <div class="resumen-row total"><span>Total ventas (${data.nVentas||0})</span><span>$${parseInt(data.totalVentas||0).toLocaleString('es-CL')}</span></div>
  `;
}

// Actualizar arqueo visible en pantalla
window.actualizarArqueo = async function() {
  const btn = document.getElementById('btnActualizarArqueo');
  if (!cajaId) return;
  btn.disabled = true; btn.textContent = 'Actualizando...';
  try {
    const snap = await getDoc(doc(db, 'cajas', cajaId));
    if (snap.exists()) mostrarResumenCaja(snap.data());
  } catch(e) { console.error(e); }
  btn.disabled = false; btn.textContent = '↻ Actualizar arqueo';
};

// Abre el modal de cierre ciego (NO muestra totales del sistema)
// targetCajaId opcional: permite reutilizar el mismo modal para cerrar retroactivamente
// una caja de otro día desde el panel admin (Reportes > Eval. caja > Cajas sin cerrar)
window.cerrarCaja = function(targetCajaId) {
  document.getElementById('cierrEfectivo').value  = '';
  document.getElementById('cierrDebito').value    = '';
  document.getElementById('cierrCredito').value   = '';
  document.getElementById('cierrTransfer').value  = '';
  document.getElementById('cierrRetirado').value  = '';
  document.getElementById('cierreTargetCajaId').value = targetCajaId || cajaId || '';
  document.getElementById('modalCierreCiego').classList.add('open');
  infoPointCierre(targetCajaId || cajaId); // v2.4.0
};
// v2.4.0: lo cobrado con el Point integrado se muestra (ya lo confirmó Mercado Pago) y no se cuenta en el arqueo
async function infoPointCierre(id) {
  const box = document.getElementById('cierrePointInfo');
  const lblD = document.getElementById('cierrDebitoLbl'), lblC = document.getElementById('cierrCreditoLbl');
  box.style.display = 'none'; lblD.textContent = '💳 Débito ($)'; lblC.textContent = '💳 Crédito ($)';
  if (!id) return;
  try {
    const snap = await getDoc(doc(db, 'cajas', id));
    const tp = (snap.exists() && snap.data().totalesPoint) || {};
    const d = parseInt(tp.debito) || 0, c = parseInt(tp.credito) || 0;
    if (!d && !c) return;
    box.innerHTML = `<b>Con el Point integrado: ${ptPesos(d + c)}</b> (Débito ${ptPesos(d)} · Crédito ${ptPesos(c)}), confirmado por Mercado Pago venta por venta. No se cuenta: abajo escriba solo lo cobrado <b>sin integración</b>.`;
    box.style.display = 'block';
    lblD.textContent = '💳 Débito sin integración ($)'; lblC.textContent = '💳 Crédito sin integración ($)';
  } catch (e) { /* sin conexión: el arqueo sigue como siempre */ }
}

window.cerrarModalCierre = function() {
  document.getElementById('modalCierreCiego').classList.remove('open');
};

// Pide una nota obligatoria de justificación cuando el cierre de caja tiene diferencias
// (a favor o en contra, mismo trato para ambas). Devuelve el texto escrito, o null si se canceló.
let _resolverNotaDescuadre = null;
function pedirNotaDescuadre(difs) {
  const partes = [];
  if (difs.difEfectivo !== 0) partes.push(`Efectivo: ${difs.difEfectivo > 0 ? '+' : ''}$${difs.difEfectivo.toLocaleString('es-CL')}`);
  if (difs.difDebito !== 0)   partes.push(`Débito: ${difs.difDebito > 0 ? '+' : ''}$${difs.difDebito.toLocaleString('es-CL')}`);
  if (difs.difCredito !== 0)  partes.push(`Crédito: ${difs.difCredito > 0 ? '+' : ''}$${difs.difCredito.toLocaleString('es-CL')}`);
  if (difs.difTransfer !== 0) partes.push(`Transferencia: ${difs.difTransfer > 0 ? '+' : ''}$${difs.difTransfer.toLocaleString('es-CL')}`);

  const total = difs.difTotal ?? (difs.difEfectivo + difs.difDebito + difs.difCredito + difs.difTransfer);
  const tipoSaldo = total >= 0 ? 'a favor' : 'en contra';
  const montoTexto = `${total >= 0 ? '+' : '-'}$${Math.abs(total).toLocaleString('es-CL')}`;

  document.getElementById('notaDescuadreResumen').innerHTML =
    `La caja no está cuadrada, tienes un <b>saldo ${tipoSaldo} ${montoTexto}</b>${partes.length ? ` (${partes.join(' · ')})` : ''}. Por favor tómate el tiempo en verificar qué pasó realmente con ese dinero y anota la información <b>DETALLADA</b> en el recuadro de abajo.`;
  document.getElementById('notaDescuadreTexto').value = '';
  document.getElementById('modalNotaDescuadre').classList.add('open');
  return new Promise(resolve => { _resolverNotaDescuadre = resolve; });
}

window.confirmarNotaDescuadre = function() {
  const texto = document.getElementById('notaDescuadreTexto').value.trim();
  if (!texto) { alert('Por favor escribe una breve explicación antes de continuar.'); return; }
  document.getElementById('modalNotaDescuadre').classList.remove('open');
  if (_resolverNotaDescuadre) { _resolverNotaDescuadre(texto); _resolverNotaDescuadre = null; }
};

window.cancelarNotaDescuadre = function() {
  document.getElementById('modalNotaDescuadre').classList.remove('open');
  if (_resolverNotaDescuadre) { _resolverNotaDescuadre(null); _resolverNotaDescuadre = null; }
};

window.confirmarCierreCiego = async function() {
  const btn = document.getElementById('btnConfirmarCierre');
  const manEfectivo  = parseInt(document.getElementById('cierrEfectivo').value)  || 0;
  let manDebito      = parseInt(document.getElementById('cierrDebito').value)    || 0;
  let manCredito     = parseInt(document.getElementById('cierrCredito').value)   || 0;
  const manTransfer  = parseInt(document.getElementById('cierrTransfer').value)  || 0;
  const montoRetirado = parseInt(document.getElementById('cierrRetirado').value) || 0;
  const targetCajaId  = document.getElementById('cierreTargetCajaId').value || cajaId;

  // Confirmación reforzada: se muestra un resumen de lo ingresado y se pide confirmar explícitamente,
  // para evitar cierres accidentales con un solo clic.
  const totalIngresado = manEfectivo + manDebito + manCredito + manTransfer;
  const confirmado = confirm(
    `¿Confirmas el cierre de caja con estos montos?\n\n` +
    `Efectivo: $${manEfectivo.toLocaleString('es-CL')}\n` +
    `Débito: $${manDebito.toLocaleString('es-CL')}\n` +
    `Crédito: $${manCredito.toLocaleString('es-CL')}\n` +
    `Transferencia: $${manTransfer.toLocaleString('es-CL')}\n` +
    `Total contado: $${totalIngresado.toLocaleString('es-CL')}\n\n` +
    `Esta acción no se puede deshacer directamente (aunque un admin podrá corregirla después desde Reportes).`
  );
  if (!confirmado) return;

  btn.disabled = true; btn.textContent = 'Cerrando...';
  try {
    const cajaSnap = await getDoc(doc(db, 'cajas', targetCajaId));
    const cajaData = cajaSnap.data();
    const cajaDocId = targetCajaId;
    const t = cajaData.totales || {};
    const montoInicial = parseInt(cajaData.montoInicial) || 0;
    // v2.4.0: lo cobrado con el Point integrado ya está confirmado: se suma a lo contado
    const tPoint = cajaData.totalesPoint || {};
    manDebito += parseInt(tPoint.debito) || 0;
    manCredito += parseInt(tPoint.credito) || 0;

    // Sistema: solo ventas (sin monto inicial)
    const sistEfectivo = parseInt(t.efectivo)        || 0;
    const sistDebito   = parseInt(t.debito)          || 0;
    const sistCredito  = parseInt(t.credito)         || 0;
    const sistTransfer = parseInt(t.transferencia)   || 0;
    const sistTotal    = parseInt(cajaData.totalVentas) || 0;

    // Cajero: desconta el monto inicial del efectivo contado
    const manEfectivoNeto = manEfectivo - montoInicial;
    const manTotal        = manEfectivoNeto + manDebito + manCredito + manTransfer;

    // Diferencias sobre ventas netas (sin el inicial)
    const difEfectivo = manEfectivoNeto - sistEfectivo;
    const difDebito   = manDebito       - sistDebito;
    const difCredito  = manCredito      - sistCredito;
    const difTransfer = manTransfer     - sistTransfer;
    const difTotal    = manTotal        - sistTotal;

    // Saldo que queda en caja para el turno siguiente
    // = efectivo físico contado − monto retirado (si se registró retiro)
    const saldoSiguiente = montoRetirado > 0 ? manEfectivo - montoRetirado : null;

    // Si hay cualquier diferencia (a favor o en contra, mismo trato), se exige una nota antes de continuar
    let notaDescuadre = '';
    const hayDiferencia = difEfectivo !== 0 || difDebito !== 0 || difCredito !== 0 || difTransfer !== 0;
    if (hayDiferencia) {
      notaDescuadre = await pedirNotaDescuadre({ difEfectivo, difDebito, difCredito, difTransfer, difTotal });
      if (notaDescuadre === null) {
        btn.disabled = false; btn.textContent = '🔒 Confirmar cierre';
        return;
      }
    }

    // Cerrar caja en Firestore
    await updateDoc(doc(db, 'cajas', cajaDocId), {
      estado: 'cerrada', cierre: Timestamp.now(),
      ...(saldoSiguiente !== null ? { saldoSiguiente } : {})
    });

    // Guardar evaluación de cierre ciego
    await addDoc(collection(db, 'evaluacion_caja'), {
      cajaId: cajaDocId, sucursal: cajaData.sucursal || sucursal, usuario: cajaData.usuario || usuario.email,
      fecha: cajaData.fecha || fechaLocalHoy(),
      nVentas: cajaData.nVentas || 0,
      montoInicial,
      apertura: cajaData.apertura,
      cierre: Timestamp.now(),
      // Sistema (solo ventas)
      sistEfectivo, sistDebito, sistCredito, sistTransfer, sistTotal,
      // Cajero (efectivo ya descontado el inicial)
      manEfectivo, manEfectivoNeto,
      manDebito, manCredito, manTransfer, manTotal,
      // Diferencias
      difEfectivo, difDebito, difCredito, difTransfer, difTotal,
      // Nota de justificación (obligatoria si hubo cualquier diferencia)
      ...(hayDiferencia ? { notaDescuadre } : {}),
      // Retiro y saldo siguiente (opcionales)
      ...(montoRetirado > 0 ? { montoRetirado, saldoSiguiente } : {})
    });

    document.getElementById('modalCierreCiego').classList.remove('open');

    // Si se estaba cerrando la caja de la sesión activa, se limpia el estado de la pantalla de ventas.
    // Si en cambio era una caja atrasada de otro día (cerrada desde el panel admin), la sesión activa no se toca.
    if (targetCajaId === cajaId) {
      cajaId = null;
      document.getElementById('cardAbrirCaja').classList.remove('hidden');
      document.getElementById('cardCajaAbierta').classList.add('hidden');
    } else {
      avisarCajaAnterior();
    }
    showToast('✅ Caja cerrada correctamente');

    // v2.3.1: aviso por correo del descuadre (como en la v2.2.0). Sale sin esperar: el cierre no depende de él.
    if (hayDiferencia) avisarPorCorreo(APPS_SCRIPT_URL_VENTAS_FEN, {
      tipo: 'descuadre_caja',
      filaCaja: {
        sucursal: cajaData.sucursal === 'ainavillo' ? 'Ainavillo' : 'Barros Arana',
        fecha: fechaDMY(cajaData.fecha || fechaLocalHoy()), // la fecha de la caja, no la de hoy
        usuario: cajaData.usuario || usuario.email,
        difTotal, difEfectivo, notaDescuadre
      }
    });

    // v2.3.0: el resumen del cierre (resumenes_caja). Ya no se copia a la planilla:
    // la diferencia y su nota quedan también en evaluacion_caja (Sistema Fën la muestra en Hoy).
    const cajaDataFinal = (await getDoc(doc(db, 'cajas', cajaDocId))).data();
    await cerrarResumen(cajaDocId, cajaDataFinal);
  } catch(e) {
    alert('Error al cerrar caja: ' + e.message);
    btn.disabled = false; btn.textContent = '🔒 Confirmar cierre';
  }
};

// Devuelve YYYY-MM-DD en fecha LOCAL (no UTC). toISOString() convierte a UTC y en Chile
// (UTC-3/UTC-4) eso hacía que "Hoy" mostrara a veces la fecha de mañana — mismo problema
// que ya se había resuelto en fechaLocalHoy(), aplicado acá para cualquier fecha.
function fechaStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

// Devuelve la fecha local (no UTC) en formato YYYY-MM-DD.
// Crítico para la rotación de stock: evita que la diferencia de zona
// horaria (Chile = UTC-3/UTC-4) haga creer al sistema que pasó un día
// cuando en realidad no pasó, disparando rotaciones incorrectas.
function fechaLocalHoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

// Normaliza la fecha de una evaluación a YYYY-MM-DD. Algunas evaluaciones antiguas quedaron
// guardadas en formato DD-MM-YYYY (por un fallback que ya se corrigió) — esto las reconoce
// y las convierte, para que se agrupen en su mes real en vez de caer en "Otras fechas".
function normalizarFechaCaja(fecha) {
  if (!fecha) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha; // ya viene bien
  const m = fecha.match(/^(\d{2})-(\d{2})-(\d{4})$/); // DD-MM-YYYY (formato legado)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// v2.1.1: un documento por venta en stockMovimientos con los lotes descontados.
// Si falla no detiene la venta (solo se pierde la posibilidad de devolver al lote exacto).
async function registrarMovimientoVenta(ventaId, descontados) {
  const lista = (descontados || []).filter(d => d && d.cantidad > 0);
  if (!lista.length) return;
  try {
    await addDoc(collection(db, 'stockMovimientos'), {
      tipo: 'venta', ventaId, sucursal, descontados: lista,
      usuario: usuario.email, fecha: Timestamp.now()
    });
  } catch (e) { console.error('No se pudo anotar el movimiento de stock de la venta', e); }
}

// RESUMEN DEL CIERRE (v2.3.0: ya no se exporta a Google Sheets)
// ═══════════════════════════
// Lee las ventas de esa caja una vez y guarda su resumen. Si no se puede, la caja queda con resumenPendiente: true
// y se reintenta sola al elegir la sucursal y a medianoche. → true | false
async function cerrarResumen(cajaDocId, cajaData) {
  try {
    const ventasSnap = await getDocs(query(collection(db, 'ventas'), where('cajaId', '==', cajaDocId)));
    if (!(await guardarResumenCaja(cajaDocId, cajaData, ventasSnap.docs))) throw new Error('No se pudo guardar el resumen');
    if (cajaData && cajaData.resumenPendiente) await updateDoc(doc(db, 'cajas', cajaDocId), { resumenPendiente: false });
    return true;
  } catch (err) {
    console.error('Resumen del cierre pendiente:', cajaDocId, err);
    try { await updateDoc(doc(db, 'cajas', cajaDocId), { resumenPendiente: true }); } catch (e2) {}
    return false;
  }
}

// ─── v2.1: resumen de cada caja (por producto, área y medio de pago) ───
// Se guarda en resumenes_caja/{cajaId}. Con él, los informes del mes leen unos
// pocos resúmenes en vez de miles de ventas, y Sistema Fën obtiene las ventas sin exportar.
async function guardarResumenCaja(cajaDocId, cajaData, ventasDocs) {
  try {
    const prods = await productosEnMemoria();
    const infoProd = {};
    // v2.3.0: área de la lista de Sistema Fën (REV = REVENTA; sin área = 'Otros') y la foto del catálogo
    const areaRes = a => { const c = normalizarArea(a); return c === SIN_AREA ? 'Otros' : c; };
    prods.forEach(p => { const f = (function () { const t = String(p.tipo || '').trim(), r = String(p.idRecetaFen || '').trim(), rv = t === 'reventa' || (!t && /^REV\d+$/i.test(r)); return { catalogoId: String(p.catalogoId || ''), tipo: t, recetaId: rv || t === 'cargo' ? '' : r, reventaId: rv ? String(p.reventaId || r) : '', unidadesPorVenta: Number(p.unidadesPorVenta) > 0 ? Number(p.unidadesPorVenta) : null }; })();
      infoProd[p.id] = { area: areaRes(p.area), idRecetaFen: p.idRecetaFen || '', ...f }; });
    const neto = b => Math.round((parseInt(b) || 0) / 1.19);
    const r = {
      cajaId: cajaDocId,
      sucursal: cajaData.sucursal || '',
      fecha: normalizarFechaCaja(cajaData.fecha) || cajaData.fecha || '',
      nVentas: 0, nAnuladas: 0, totalBruto: 0, totalNeto: 0,
      porMedio: { efectivo: 0, debito: 0, credito: 0, transferencia: 0 },
      porArea: {}, porProducto: {},
      porLeche: {}, // v2.7.0: unidades por tipo de leche (también en cada producto)
      version: 1, actualizado: Timestamp.now()
    };
    r.versionCaja = '2.3.0'; // v2.3.0 (porProducto con catalogoId, tipo, recetaId, reventaId) · v2.2.0 (porTarjeta, agotadoHoy)
    const tarj = {}, agot = {}, reagot = {}; // v2.2.0
    r.mes = (r.fecha || '').slice(0, 7);
    ventasDocs.forEach(d => {
      const v = d.data();
      if (v.anulada === true) { r.nAnuladas++; return; }
      r.nVentas++;
      const total = parseInt(v.total) || 0;
      r.totalBruto += total;
      if (Array.isArray(v.pagos) && v.pagos.length) {
        v.pagos.forEach(p => { if (p && p.medio) r.porMedio[p.medio] = (r.porMedio[p.medio] || 0) + (parseInt(p.monto) || 0); });
      } else if (v.medioPago) {
        r.porMedio[v.medioPago] = (r.porMedio[v.medioPago] || 0) + total;
      }
      (v.lineas || []).forEach(l => {
        const key = l.id || ('sin-id:' + (l.nombre || ''));
        const info0 = infoProd[l.id] || { area: 'Otros', idRecetaFen: '', catalogoId: '', tipo: '', recetaId: '', reventaId: '' };
        // v2.3.0: la foto de la línea (al vender) manda; si no la tiene (venta anterior), el producto de hoy
        const info = l.catalogoId || l.tipo ? { ...info0, area: l.area ? areaRes(l.area) : info0.area, catalogoId: l.catalogoId || '', tipo: l.tipo || '', recetaId: l.recetaId || '', reventaId: l.reventaId || '', unidadesPorVenta: Number(l.unidadesPorVenta) > 0 ? Number(l.unidadesPorVenta) : info0.unidadesPorVenta } : info0;
        const bruto = parseInt(l.total) || 0, cant = parseFloat(l.cantidad) || 0;
        const pp = r.porProducto[key] || (r.porProducto[key] = { nombre: l.nombre || '', area: info.area, idRecetaFen: info.idRecetaFen, catalogoId: info.catalogoId || '', tipo: info.tipo || '', recetaId: info.recetaId || '', reventaId: info.reventaId || '', ...(info.unidadesPorVenta > 0 ? { unidadesPorVenta: info.unidadesPorVenta } : {}), cantidad: 0, bruto: 0, neto: 0 });
        pp.cantidad += cant; pp.bruto += bruto; pp.neto += neto(bruto);
        const pa = r.porArea[info.area] || (r.porArea[info.area] = { cantidad: 0, bruto: 0, neto: 0 });
        pa.cantidad += cant; pa.bruto += bruto; pa.neto += neto(bruto);
        // v2.7.0: por tipo de leche (la nota del café)
        const leche = String(l.tipoLeche || '').trim();
        if (leche) {
          r.porLeche[leche] = (r.porLeche[leche] || 0) + cant;
          const pl = pp.porLeche || (pp.porLeche = {});
          pl[leche] = (pl[leche] || 0) + cant;
        }
        // v2.2.0: por tarjeta y hora en que se agotó el lote de hoy
        if (l.tarjeta) {
          const t = (tarj[key] = tarj[key] || {});
          const tt = t[l.tarjeta] || (t[l.tarjeta] = { cant: 0, monto: 0 });
          tt.cant += cant; tt.monto += bruto;
        }
        if (l.agotado && (!agot[key] || l.agotado < agot[key])) agot[key] = l.agotado;
        if (l.reagotado && (!reagot[key] || l.reagotado > reagot[key])) reagot[key] = l.reagotado;
      });
    });
    r.totalNeto = neto(r.totalBruto);
    // v2.2.0: porTarjeta suma lo mismo que cantidad y bruto; lo vendido sin tarjeta anotada va a "sinDato"
    Object.keys(tarj).forEach(k => {
      const pp = r.porProducto[k]; if (!pp) return;
      let sc = 0, sm = 0;
      Object.values(tarj[k]).forEach(x => { sc += x.cant; sm += x.monto; });
      const fc = Math.round((pp.cantidad - sc) * 1000) / 1000, fm = pp.bruto - sm;
      if (fc || fm) tarj[k].sinDato = { cant: fc, monto: fm };
      pp.porTarjeta = tarj[k];
    });
    Object.keys(agot).forEach(k => { if (r.porProducto[k]) r.porProducto[k].agotadoHoy = agot[k]; });
    Object.keys(reagot).forEach(k => { if (r.porProducto[k]) r.porProducto[k].reagotadoHoy = reagot[k]; });
    // Las claves de mapas en Firestore no admiten algunos caracteres: el ID de producto ya es seguro;
    // los nombres sin ID se codifican.
    const porProducto = {};
    Object.keys(r.porProducto).forEach(k => { porProducto[k.startsWith('sin-id:') ? 'sin-id-' + encodeURIComponent(k.slice(7)).replace(/[.%]/g, '_') : k] = r.porProducto[k]; });
    r.porProducto = porProducto;
    await setDoc(doc(db, 'resumenes_caja', cajaDocId), r);
    return true;
  } catch (e) {
    console.error('No se pudo guardar el resumen de la caja', cajaDocId, e);
    return false;
  }
}

// v2.3.0: reintenta en segundo plano los resúmenes que no alcanzaron a guardarse al cerrar.
let _reintentoEnCurso = false;
async function reintentarResumenesPendientes() {
  if (_reintentoEnCurso || esStockViewer) return;
  _reintentoEnCurso = true;
  try {
    const sn = await getDocs(query(collection(db, 'cajas'), where('resumenPendiente', '==', true)));
    for (const d of sn.docs) {
      const c = d.data();
      if (c.estado !== 'cerrada') continue;
      await cerrarResumen(d.id, c);
    }
  } catch (e) { console.error('Reintento de resúmenes pendientes:', e); }
  _reintentoEnCurso = false;
}

/**
 * Determina el turno según la hora de la venta.
 */
function determinarTurno(fecha) {
  const hora = fecha.getHours();
  if (hora < 13) return 'Mañana';
  if (hora < 18) return 'Tarde';
  return 'Noche';
}

/**
 * Respaldo automático a medianoche: exporta cajas abiertas del día que no se hayan exportado.
 */
async function programarRespaldoMedianoche() {
  const ahora = new Date();
  const manana = new Date(ahora);
  manana.setDate(manana.getDate() + 1);
  manana.setHours(0, 0, 30, 0); // 00:00:30 del día siguiente
  const msHastaMedianoche = manana - ahora;

  setTimeout(async () => {
    try {
      // Exportar cajas no exportadas (rotación eliminada - ahora es por fechas dinámicas)
      const hoy = fechaLocalHoy();
      const tsDesde = Timestamp.fromDate(new Date(hoy + 'T00:00:00'));
      const tsHasta = Timestamp.fromDate(new Date(hoy + 'T23:59:59'));

      const cajasSnap = await getDocs(
        query(collection(db, 'cajas'),
          where('apertura', '>=', tsDesde),
          where('apertura', '<=', tsHasta)
        )
      );

      for (const cajaDoc of cajasSnap.docs) {
        const data = cajaDoc.data();
        // v2.3.0: la caja que sigue abierta se cierra y queda con su resumen (ya no se exporta a la planilla)
        if (data.estado !== 'cerrada') {
          await updateDoc(doc(db, 'cajas', cajaDoc.id), {
            estado: 'cerrada',
            cierre: Timestamp.now(),
            cierreAutomatico: true
          });
          const cajaDataFinal = (await getDoc(doc(db, 'cajas', cajaDoc.id))).data();
          await cerrarResumen(cajaDoc.id, cajaDataFinal);
        }
      }
      await reintentarResumenesPendientes(); // v2.3.0
    } catch (err) {
      console.error('❌ Error en respaldo automático de medianoche:', err);
    }

    // Re-programar para la siguiente medianoche
    programarRespaldoMedianoche();
  }, msHastaMedianoche);

  console.log(`Cierre automático programado en ${Math.round(msHastaMedianoche / 60000)} minutos`);
}

// Iniciar el respaldo automático al cargar la app
programarRespaldoMedianoche();

// ═══════════════════════════
// Migra datos del formato viejo (hoy/ayer/antesayer/cuartoDia/merma como campos)
// al nuevo formato (entradas: {"20260701": 10}) para AMBAS sucursales
window.migrarStockFormato = async function() {
  if (!confirm('¿Migrar todos los datos de stock al nuevo formato?\n\nEsto convierte el stock existente (Hoy/Ayer/Antesayer/Cuarto día/Merma) al nuevo sistema basado en fechas.\n\nSolo es necesario hacerlo una vez.')) return;
  const btn = document.getElementById('btnMigrarStock');
  btn.disabled = true; btn.textContent = '⏳ Migrando...';
  try {
    const snap = await getDocs(collection(db, 'stock'));
    let migrados = 0, omitidos = 0;

    for (const stockDoc of snap.docs) {
      const data = stockDoc.data();

      // Si ya tiene el formato nuevo, omitir
      if (data.entradas && Object.keys(data.entradas).length > 0) {
        omitidos++;
        continue;
      }

      // Campos del formato viejo que pueden tener datos
      const camposViejos = [
        { campo: 'hoy',       data: data.hoy },
        { campo: 'ayer',      data: data.ayer },
        { campo: 'antesayer', data: data.antesayer },
        { campo: 'cuartoDia', data: data.cuartoDia },
        { campo: 'merma',     data: data.merma },
      ];

      const entradasNuevas = {};
      let tieneDatos = false;

      for (const { data: campoData } of camposViejos) {
        if (!campoData || !campoData.cantidad || campoData.cantidad <= 0) continue;
        // Convertir fecha es-CL "01-07-2026" o "1/7/2026" → key "20260701"
        const key = parseFechaEsCLToKey(campoData.fecha);
        entradasNuevas[key] = (entradasNuevas[key] || 0) + campoData.cantidad;
        tieneDatos = true;
      }

      if (!tieneDatos) { omitidos++; continue; }

      // Guardar nuevo formato y limpiar campos viejos
      await updateDoc(doc(db, 'stock', stockDoc.id), {
        entradas:  entradasNuevas,
        hoy:       null,
        ayer:      null,
        antesayer: null,
        cuartoDia: null,
        merma:     null,
      });
      migrados++;
    }

    await cargarStockPorCategoria();
    showToast(`✅ Migración completa: ${migrados} documentos migrados, ${omitidos} ya estaban actualizados`);
    console.log(`Migración: ${migrados} migrados, ${omitidos} omitidos`);
  } catch(e) {
    alert('Error en migración: ' + e.message);
    console.error(e);
  }
  btn.disabled = false; btn.textContent = '⚡ Migrar datos stock';
};

let _stockListaArea = ''; // filtro de área compartido para las 3 categorías

async function cargarStockPorCategoria() {
  if (!sucursal) return;

  // Cargar todos los docs de stock
  const snap = await getDocs(collection(db, 'stock'));

  // Auto-migración silenciosa: convierte formato viejo al nuevo sin acción del usuario
  let necesitaRecarga = false;
  for (const stockDoc of snap.docs) {
    const data = stockDoc.data();
    if (data.entradas && Object.keys(data.entradas).length > 0) continue;
    const camposViejos = [data.hoy, data.ayer, data.antesayer, data.cuartoDia, data.merma];
    if (!camposViejos.some(c => c?.cantidad > 0)) continue;
    const entradasNuevas = {};
    camposViejos.forEach(c => {
      if (!c?.cantidad || c.cantidad <= 0) return;
      const key = parseFechaEsCLToKey(c.fecha);
      entradasNuevas[key] = (entradasNuevas[key] || 0) + c.cantidad;
    });
    try {
      await updateDoc(doc(db, 'stock', stockDoc.id), {
        entradas: entradasNuevas,
        hoy: null, ayer: null, antesayer: null, cuartoDia: null, merma: null,
      });
      necesitaRecarga = true;
      console.log('✅ Auto-migrado:', stockDoc.id);
    } catch(e) { console.error('Error migrando:', stockDoc.id, e); }
  }

  // Si hubo migración, recargar datos frescos
  const snapFinal = necesitaRecarga
    ? await getDocs(collection(db, 'stock'))
    : snap;

  window._stockMap = {};
  const items = snapFinal.docs
    .filter(d => d.id.startsWith(sucursal + '_'))
    .map(d => ({ _id: d.id, ...d.data() }));
  items.forEach(i => { window._stockMap[i._id] = i; });

  renderProductos();
  renderStockListaAreaBtns();
  if (esStockViewer) renderResumenVisor();

  const CATS = [
    { key: 'hoy',          listaId: 'stockListaHoy',          totalId: 'totalHoy' },
    { key: 'ayer',         listaId: 'stockListaAyer',         totalId: 'totalAyer' },
    { key: 'antesayer',    listaId: 'stockListaAntesayer',    totalId: 'totalAntesayer' },
    { key: 'cuartoDia',    listaId: 'stockListaCuartoDia',    totalId: 'totalCuartoDia' },
    { key: 'ultimaOferta', listaId: 'stockListaUltimaOferta', totalId: 'totalUltimaOferta' },
  ];

  CATS.forEach(({ key, listaId, totalId }) => {
    const contenedor = document.getElementById(listaId);
    const totalEl    = document.getElementById(totalId);
    if (!contenedor) return;
    const conStock = items.filter(i => {
      const prod = productos.find(p => p.id === i.productoId);
      if (!prod || prod.controlStock === false) return false;
      if (prod.autoEliminar === false) return false; // permanentes van a su propia card
      if (_stockListaArea && normalizarArea(prod.area) !== _stockListaArea) return false;
      return getQtyCategoria(i, key) > 0;
    });
    if (!conStock.length) {
      contenedor.innerHTML = '<div class="empty">Sin stock</div>';
      if (totalEl) totalEl.textContent = '';
      return;
    }
    let valorTotal = 0;
    contenedor.innerHTML = conStock.map(i => {
      const prod   = productos.find(p => p.id === i.productoId);
      const nombre = prod ? prod.nombre : i.productoId;
      const qty    = getQtyCategoria(i, key);
      const precio = prod ? getPrecioProducto(prod, key) : 0;
      valorTotal  += qty * precio;
      const entradas = getEntradasPorCategoria(i, key);
      const fechaRef = entradas.length ? keyToFechaCL(entradas[0].key) : '';

      // Construir detalle de horas desde entradasLog filtrado por este fechaKey y categoría
      const logCat = (i.entradasLog || [])
        .filter(l => entradas.some(e => e.key === l.fechaKey))
        .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
      const logStr = logCat.length > 0
        ? logCat.map(l => `${l.cantidad} ud. ${l.hora}`).join('&nbsp;&nbsp;')
        : '';

      // Última oferta con más de un lote: mostrar el desglose completo por lote
      // (fecha de ingreso + hora, fecha en que llegó a Última oferta, cantidad de ese lote)
      const metaHTML = (key === 'ultimaOferta' && entradas.length > 1)
        ? `<div style="font-size:11px;color:#888;margin-top:2px;line-height:1.5">
            ${entradas.map(e => {
              const hora = (i.entradasLog || []).find(l => l.fechaKey === e.key)?.hora || '';
              return `<div>📦 Ingreso ${keyToFechaCL(e.key)}${hora ? ` ${hora}` : ''} → lleg. Últ.of. ${fechaLlegadaUltimaOferta(e.key)} · <b>${e.qty} ud.</b></div>`;
            }).join('')}
          </div>`
        : `<div class="stock-prod-meta">${fechaRef}${logStr ? `&nbsp;&nbsp;${logStr}` : ''}</div>`;

      return `<div class="stock-row">
        <div style="flex:1;min-width:0">
          <div class="stock-prod-nombre">${nombre}</div>
          ${metaHTML}
        </div>
        ${esStockViewer
          ? `<div class="visor-stock-qty">${qty} ud.</div>`
          : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                <div class="stock-qty-ctrl">
                  <button class="stock-qty-btn" onclick="ajustarStock('${i.productoId}','${key}',-1)">−</button>
                  <div class="stock-qty-num" id="sqty-${key}-${i.productoId}">${qty}</div>
                  <button class="stock-qty-btn" onclick="ajustarStock('${i.productoId}','${key}',1)">+</button>
                </div>
                <button class="btn-a-merma" onclick="abrirModalMoverMerma('${i.productoId}','${nombre.replace(/'/g,"\\'")}','${key}')">→ Merma</button>
              </div>`}
      </div>`;
    }).join('');
    if (totalEl) totalEl.textContent = `Valor: $${valorTotal.toLocaleString('es-CL')}`;
  });

  // Sin vencimiento — productos con autoEliminar: false, usan clave "permanente"
  const contenedorPerm = document.getElementById('stockListaPermanente');
  const totalPermEl    = document.getElementById('totalPermanente');
  if (contenedorPerm) {
    const conPerm = items.filter(i => {
      const prod = productos.find(p => p.id === i.productoId);
      if (!prod || prod.controlStock === false || prod.autoEliminar !== false) return false;
      if (_stockListaArea && normalizarArea(prod.area) !== _stockListaArea) return false;
      return (i.entradas?.['permanente'] || 0) > 0;
    });
    if (!conPerm.length) {
      contenedorPerm.innerHTML = '<div class="empty">Sin stock permanente</div>';
      if (totalPermEl) totalPermEl.textContent = '';
    } else {
      let valorPerm = 0;
      contenedorPerm.innerHTML = conPerm.map(i => {
        const prod   = productos.find(p => p.id === i.productoId);
        const nombre = prod ? prod.nombre : i.productoId;
        const precio = prod ? (prod.precioHoy || prod.precio || 0) : 0;
        const qty    = i.entradas?.['permanente'] || 0;
        valorPerm += qty * precio;
        return `<div class="stock-row">
          <div>
            <div class="stock-prod-nombre">${nombre}</div>
            <div class="stock-prod-meta">Sin vencimiento</div>
          </div>
          ${esStockViewer
            ? `<div class="visor-stock-qty">${qty} ud.</div>`
            : `<div class="stock-qty-ctrl">
                <button class="stock-qty-btn" onclick="ajustarStockPerm('${i.productoId}',-1)">−</button>
                <div class="stock-qty-num" id="sqty-perm-${i.productoId}">${qty}</div>
                <button class="stock-qty-btn" onclick="ajustarStockPerm('${i.productoId}',1)">+</button>
              </div>`}
        </div>`;
      }).join('');
      if (totalPermEl) totalPermEl.textContent = `Valor: $${valorPerm.toLocaleString('es-CL')}`;
    }
  }

  // Merma
  const contenedorMerma = document.getElementById('stockListaMerma');
  const totalMermaEl    = document.getElementById('totalMerma');
  if (contenedorMerma) {
    const conMerma = items.filter(i => {
      const prod = productos.find(p => p.id === i.productoId);
      if (!prod || prod.controlStock === false) return false;
      if (prod.autoEliminar === false) return false; // permanentes nunca van a merma
      if (_stockListaArea && normalizarArea(prod.area) !== _stockListaArea) return false;
      return getQtyCategoria(i, 'merma') > 0 || (i.merma?.cantidad > 0);
    });
    if (!conMerma.length) {
      contenedorMerma.innerHTML = '<div class="empty">Sin merma registrada</div>';
      if (totalMermaEl) totalMermaEl.textContent = '';
    } else {
      let valorMerma = 0;
      contenedorMerma.innerHTML = conMerma.map(i => {
        const prod   = productos.find(p => p.id === i.productoId);
        const nombre = prod ? prod.nombre : i.productoId;
        const precio = prod ? (prod.precioHoy || prod.precio || 0) : 0;
        const qty    = getQtyCategoria(i, 'merma') + (i.merma?.cantidad || 0);
        const entradasMerma = getEntradasPorCategoria(i, 'merma');
        // La clave viene como "merma_YYYYMMDD" (fecha de INGRESO del lote) — hay que quitar el prefijo antes de convertirla
        const primerKey  = entradasMerma.length ? entradasMerma[0].key : '';
        const fechaIngresoPlano = primerKey.replace(/^merma_/, '');
        const fechaIngresoRef   = keyToFechaCL(fechaIngresoPlano) || (i.merma?.fecha || '');
        // La fecha REAL de envío a merma (y quién lo hizo) vive en el registro interno de movimientos, no en la clave
        const logEntry    = (i.mermaLog || []).find(l => l.fechaKey === fechaIngresoPlano);
        const fechaEnvioRef = logEntry?.fecha?.toDate ? formatoDMY(logEntry.fecha.toDate()) : '';
        const quien = logEntry?.usuario ? logEntry.usuario.split('@')[0] : '';
        const dias  = diasEntreDMY(fechaIngresoRef, fechaEnvioRef);
        const metaPartes = [
          fechaEnvioRef ? `envió ${fechaEnvioRef}` : '',
          fechaIngresoRef ? `ingresó ${fechaIngresoRef}` : '',
          dias != null ? `${dias}d en stock` : '',
          quien,
          `${qty} ud.`,
          `pérdida $${(qty*precio).toLocaleString('es-CL')}`
        ].filter(Boolean);
        valorMerma += qty * precio;
        return `<div class="stock-row" style="grid-template-columns:1fr auto">
          <div>
            <div class="stock-prod-nombre">${nombre}</div>
            <div class="stock-prod-meta">${metaPartes.join(' · ')}</div>
          </div>
          ${esAdmin
            ? `<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                <button class="btn-reg-merma" onclick="registrarMermaItem('${i.productoId}','${nombre.replace(/'/g,"\'")}',${qty},${precio})">✓ Registrar merma</button>
                <button class="btn-rescatar" onclick="abrirModalRescatar('${i.productoId}','${nombre.replace(/'/g,"\'")}',${qty})">↩ Rescatar</button>
               </div>`
            : '<span style="font-size:11px;color:#aaa">Solo admin</span>'}
        </div>`;
      }).join('');
      if (totalMermaEl) totalMermaEl.textContent = `Pérdida: $${valorMerma.toLocaleString('es-CL')}`;
    }
  }
}

// Alias para compatibilidad con el hook existente
async function cargarStockLista() { await cargarStockPorCategoria(); }



// Admin: registra la merma (Firestore: informe de merma y Sistema Fën) y la saca del stock. v2.3.0: ya no va a la planilla.
window.registrarMermaItem = async function(productoId, nombre, cantidad, precioOriginal) {
  if (!confirm(`¿Registrar merma de ${cantidad} ud. de "${nombre}"?\n\nQueda en el informe de merma y sale del stock.`)) return;
  try {
    const stockRef  = doc(db, 'stock', `${sucursal}_${productoId}`);
    const stockSnap = await getDoc(stockRef);
    if (!stockSnap.exists()) return;
    const data = stockSnap.data();

    // Recopilar fechas para el reporte (quitar el prefijo "merma_" antes de convertir la clave a fecha)
    const entradasMerma = Object.entries(data.entradas || {})
      .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === 'merma');
    const fechaIngreso = entradasMerma.length
      ? keyToFechaCL(entradasMerma.map(([k]) => k.replace(/^merma_/, '')).sort()[0])
      : (data.merma?.fecha || '');

    const fechaRegistro = fechaLocalHoy();
    const mermaLog = data.mermaLog || [];

    // Agrupar el log por la fecha REAL en que se envió a merma desde Stock (no la fecha de registro de hoy).
    // Si el mismo producto se envió a merma en más de un día distinto antes de registrarlo,
    // se crea un registro separado por cada día, para que el análisis por fecha sea preciso.
    let usoRespaldo = false;
    const porFechaEnvio = {};
    mermaLog.forEach(m => {
      const fEnvio = m.fecha?.toDate ? fechaStr(m.fecha.toDate()) : fechaRegistro;
      if (!porFechaEnvio[fEnvio]) porFechaEnvio[fEnvio] = { cantidad: 0, motivos: [], usuario: m.usuario };
      porFechaEnvio[fEnvio].cantidad += m.cantidad;
      if (m.motivo) porFechaEnvio[fEnvio].motivos.push({ motivo: m.motivo, cantidad: m.cantidad });
    });
    // Respaldo por si no hay log (ej. stock de antes de este cambio): usa la fecha de hoy,
    // pero queda marcado como "aproximado" para no mostrarlo como si fuera exacto
    if (!Object.keys(porFechaEnvio).length) {
      porFechaEnvio[fechaRegistro] = { cantidad, motivos: [], usuario: usuario.email };
      usoRespaldo = true;
    }

    for (const [fEnvio, info] of Object.entries(porFechaEnvio)) {
      const motivo = info.motivos.map(m => `${m.motivo} (${m.cantidad})`).join(' · ');
      const area0 = normalizarArea(productos.find(p => p.id === productoId)?.area), area = area0 === SIN_AREA ? '' : area0;
      // fEnvio viene en formato YYYY-MM-DD; se convierte a DD-MM-YYYY para poder compararla con fechaIngreso
      const fEnvioDMY = fEnvio.split('-').reverse().join('-');
      const diasEnStock = diasEntreDMY(fechaIngreso, fEnvioDMY);

      // Guardar también en Firestore, para verla y analizarla desde Reportes > Merma.
      // fechaEnvio = cuándo se mandó a merma desde Stock (lo relevante para análisis).
      // fechaRegistro = cuándo se confirmó acá (queda en segundo plano, solo de referencia).
      // fechaEnvioAprox = true si no había registro exacto del movimiento y se usó la fecha de registro como respaldo.
      await addDoc(collection(db, 'merma'), {
        sucursal, productoId, nombreProducto: nombre, area, cantidad: info.cantidad,
        precioOriginal, monto: info.cantidad * precioOriginal,
        fechaIngreso, fechaEnvio: fEnvio, fechaRegistro, fechaEnvioAprox: usoRespaldo, diasEnStock,
        fecha: Timestamp.now(), usuario: info.usuario || usuario.email, motivo, motivos: info.motivos
      });
    }

    // Eliminar de Firestore — borrar entradas de merma, campo legacy, y limpiar el log ya procesado
    const updates = { merma: null, mermaLog: [] };
    entradasMerma.forEach(([k]) => { updates[`entradas.${k}`] = 0; });
    await updateDoc(stockRef, updates);
    await cargarStockPorCategoria();
    showToast('Merma registrada');
  } catch(e) {
    alert('Error al registrar merma: ' + e.message);
  }
};

// Ajusta el stock de un lote específico (fecha exacta elegida por el cajero), sin FIFO —
// se usa cuando el producto viene de Última oferta con más de un lote y se eligió cuál vender.
window.ajustarStockLote = async function(productoId, fechaKey, delta) {
  const stockKey = `${sucursal}_${productoId}`;
  const ref = doc(db, 'stock', stockKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const entradas = snap.data().entradas || {};
  const qtyActual = entradas[fechaKey] || 0;
  const nuevaQty = Math.max(0, qtyActual + delta);
  await updateDoc(ref, { [`entradas.${fechaKey}`]: nuevaQty });
  if (window._stockMap[stockKey]?.entradas) window._stockMap[stockKey].entradas[fechaKey] = nuevaQty;
  renderProductos();
};

window.ajustarStock = async function(productoId, cat, delta) {
  const stockKey = `${sucursal}_${productoId}`;
  const ref = doc(db, 'stock', stockKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const entradas = snap.data().entradas || {};
  const entradasCat = Object.entries(entradas)
    .filter(([k, q]) => q > 0 && getCategoriaFecha(k) === cat)
    .sort(([a], [b]) => a.localeCompare(b)); // oldest first
  if (!entradasCat.length) return;
  if (delta < 0) {
    // FIFO: descontar de la más antigua primero
    let toDeduct = Math.abs(delta);
    for (const [key, qty] of entradasCat) {
      if (toDeduct <= 0) break;
      const deducir = Math.min(qty, toDeduct);
      await updateDoc(ref, { [`entradas.${key}`]: Math.max(0, qty - deducir) });
      if (window._stockMap[stockKey]?.entradas) window._stockMap[stockKey].entradas[key] = Math.max(0, qty - deducir);
      toDeduct -= deducir;
    }
  } else {
    // Añadir a la entrada más reciente
    const [key, qty] = entradasCat[entradasCat.length - 1];
    await updateDoc(ref, { [`entradas.${key}`]: qty + delta });
    if (window._stockMap[stockKey]?.entradas) window._stockMap[stockKey].entradas[key] = qty + delta;
  }
  // Actualizar UI
  const newQty = getQtyCategoria(window._stockMap[stockKey], cat);
  const el = document.getElementById(`sqty-${cat}-${productoId}`);
  if (el) el.textContent = newQty;
  renderProductos();
};

// Ajusta stock de productos sin vencimiento (clave "permanente" fija)
window.ajustarStockPerm = async function(productoId, delta) {
  const stockKey = `${sucursal}_${productoId}`;
  const ref  = doc(db, 'stock', stockKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const entradas = snap.data().entradas || {};
  const qtyActual = entradas['permanente'] || 0;
  const nuevaQty  = Math.max(0, qtyActual + delta);
  await updateDoc(ref, { 'entradas.permanente': nuevaQty });
  const el = document.getElementById(`sqty-perm-${productoId}`);
  if (el) el.textContent = nuevaQty;
  renderProductos();
};

// Mueve stock de Última oferta → Merma (disponible para todos los usuarios)
// Abre el modal para enviar a Merma desde cualquier categoría (Hoy/Ayer/Antesayer/Cuarto día/Última oferta),
// permitiendo elegir de qué fecha exacta es el lote (si hay más de una) y cuánta cantidad
window.abrirModalMoverMerma = function(productoId, nombre, categoria) {
  const stockItem = window._stockMap ? window._stockMap[`${sucursal}_${productoId}`] : null;
  const entradas = getEntradasPorCategoria(stockItem, categoria);
  if (!entradas.length) { alert('No hay stock disponible en esa categoría'); return; }

  document.getElementById('moverMermaProdId').value = productoId;
  document.getElementById('moverMermaNombre').value = nombre;
  document.getElementById('moverMermaTitulo').textContent = `🗑️ Enviar "${nombre}" a Merma`;

  const sel = document.getElementById('moverMermaFecha');
  sel.innerHTML = entradas.map(e =>
    `<option value="${e.key}" data-qty="${e.qty}">${keyToFechaCL(e.key)} (${e.qty} disponibles)</option>`
  ).join('');

  actualizarMaxMoverMerma();
  document.getElementById('moverMermaMotivo').innerHTML =
    `<option value="">Selecciona un motivo...</option>` +
    MOTIVOS_MERMA.map(m => `<option value="${m}">${m}</option>`).join('');
  document.getElementById('modalMoverMerma').classList.add('open');
};

// Ajusta el máximo permitido de cantidad según la fecha elegida en el selector
window.actualizarMaxMoverMerma = function() {
  const sel = document.getElementById('moverMermaFecha');
  const opt = sel.options[sel.selectedIndex];
  const max = opt ? parseInt(opt.dataset.qty) || 0 : 0;
  const input = document.getElementById('moverMermaCantidad');
  input.max = max;
  input.value = max; // por defecto, todo el lote de esa fecha (se puede editar)
};

// Mueve la cantidad elegida a Merma, desde la fecha exacta elegida por la persona
window.confirmarMoverMerma = async function() {
  const productoId = document.getElementById('moverMermaProdId').value;
  const nombre      = document.getElementById('moverMermaNombre').value;
  const sel         = document.getElementById('moverMermaFecha');
  const fechaKey    = sel.value;
  const opt         = sel.options[sel.selectedIndex];
  const max         = opt ? parseInt(opt.dataset.qty) || 0 : 0;
  const cantidad    = parseInt(document.getElementById('moverMermaCantidad').value) || 0;
  const motivo      = document.getElementById('moverMermaMotivo').value;

  if (cantidad <= 0) { alert('Ingresa una cantidad válida'); return; }
  if (cantidad > max) { alert(`Solo hay ${max} ud. disponibles en esa fecha`); return; }
  if (!motivo) { alert('Selecciona un motivo antes de continuar'); return; }
  if (!confirm(`¿Enviar ${cantidad} de ${max} ud. de "${nombre}" (${keyToFechaCL(fechaKey)}) a Merma?\n\nMotivo: ${motivo}`)) return;

  document.getElementById('modalMoverMerma').classList.remove('open');

  try {
    const stockRef  = doc(db, 'stock', `${sucursal}_${productoId}`);
    const stockSnap = await getDoc(stockRef);
    if (!stockSnap.exists()) return;
    const entradas = stockSnap.data().entradas || {};
    const qtyActual = entradas[fechaKey] || 0;
    if (qtyActual < cantidad) { alert('El stock cambió, vuelve a intentarlo'); await cargarStockPorCategoria(); return; }

    const mermaKey = fechaKey.startsWith('ultimaoferta_') ? fechaKey.replace('ultimaoferta_', 'merma_') : `merma_${fechaKey}`;
    await updateDoc(stockRef, {
      [`entradas.${fechaKey}`]: qtyActual - cantidad,
      [`entradas.${mermaKey}`]: (entradas[mermaKey] || 0) + cantidad,
      mermaLog: arrayUnion({
        fechaKey, cantidad, motivo: motivo || '',
        fecha: Timestamp.now(), usuario: usuario.email
      })
    });

    await cargarStockPorCategoria();
    showToast(`🗑 ${cantidad} ud. de "${nombre}" movidas a Merma`);
  } catch(e) { alert('Error: ' + e.message); }
};

// Admin: abre modal para elegir destino al rescatar de Merma
window.abrirModalRescatar = function(productoId, nombre, qty) {
  document.getElementById('rescatarProdId').value = productoId;
  document.getElementById('rescatarQty').value    = qty;
  document.getElementById('modalRescatar').querySelector('.modal-title').textContent = `↩ Rescatar "${nombre}" (${qty} ud.)`;
  document.getElementById('modalRescatar').classList.add('open');
};

// Admin: confirma el rescate y mueve de merma a la categoría elegida
window.confirmarRescatar = async function(catDestino) {
  const productoId = document.getElementById('rescatarProdId').value;
  const qty        = parseInt(document.getElementById('rescatarQty').value) || 0;
  document.getElementById('modalRescatar').classList.remove('open');
  try {
    const stockRef  = doc(db, 'stock', `${sucursal}_${productoId}`);
    const stockSnap = await getDoc(stockRef);
    if (!stockSnap.exists()) return;
    const entradas = stockSnap.data().entradas || {};
    const updates  = {};

    // Calcular clave YYYYMMDD con offset de días (sin usar toLocaleDateString)
    function keyOffset(dias) {
      const d = new Date();
      d.setDate(d.getDate() - dias);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    }
    const hoy = fechaKeyHoy();
    const claveDestino = {
      hoy:          hoy,
      ayer:         keyOffset(1),
      antesayer:    keyOffset(2),
      cuartoDia:    keyOffset(3),
      ultimaOferta: `ultimaoferta_${hoy}`
    }[catDestino] || hoy;

    // Limpiar todas las claves merma_ y mover al destino
    let totalRescatado = 0;
    Object.entries(entradas).forEach(([k, q]) => {
      if (k.startsWith('merma_') && q > 0) {
        updates[`entradas.${k}`] = 0;
        totalRescatado += q;
      }
    });
    if (totalRescatado > 0) {
      updates[`entradas.${claveDestino}`] = (entradas[claveDestino] || 0) + totalRescatado;
    }
    if (Object.keys(updates).length) await updateDoc(stockRef, updates);
    await cargarStockPorCategoria();
    showToast(`✅ Producto rescatado a "${catDestino}"`);
  } catch(e) { alert('Error: ' + e.message); }
};
function determinarCatPorFecha(fechaISO) {
  if (!fechaISO) return 'hoy';
  const key = fechaISO.replace(/-/g, '');
  return getCategoriaFecha(key);
}

// Actualiza el badge de categoría al cambiar la fecha
window.actualizarCatFecha = function() {
  const cat   = determinarCatPorFecha(document.getElementById('stockFecha').value);
  const badge = document.getElementById('stockFechaCat');
  if (!badge) return;
  const labels = { hoy: 'Stock hoy', ayer: 'Stock ayer', antesayer: 'Stock ant. ayer', cuartoDia: 'Cuarto día' };
  const clases = { hoy: 'cat-hoy', ayer: 'cat-ayer', antesayer: 'cat-antesayer', cuartoDia: 'cat-cuartodia' };
  badge.textContent = labels[cat];
  badge.className   = `cat-badge ${clases[cat]}`;
};

// Inicializa la fecha de stock con hoy
function inicializarFechaStock() {
  const input = document.getElementById('stockFecha');
  if (input) {
    input.value = fechaLocalHoy();
    actualizarCatFecha();
  }
}

window.ingresarStock = async function() {
  const btn        = document.getElementById('btnIngresarStock');
  const productoId = document.getElementById('stockProducto').value;
  const cantidad   = parseFloat(document.getElementById('stockCantidad').value) || 0;
  const obs        = document.getElementById('stockObs').value.trim();
  const fechaInput = document.getElementById('stockFecha').value;

  if (!productoId || cantidad <= 0) { alert('Ingresa producto y cantidad'); return; }

  const prod = productos.find(p => p.id === productoId);
  if (prod && prod.controlStock === false) {
    alert(`"${prod.nombre}" no requiere control de stock (revisa su configuración en Productos)`);
    return;
  }

  // Productos permanentes siempre usan la clave "permanente" — nunca envejecen
  const esPermanente = prod && prod.autoEliminar === false;
  const fechaKey = esPermanente ? 'permanente' : (fechaInput ? fechaInput.replace(/-/g, '') : fechaKeyHoy());
  const cat = getCategoriaFecha(fechaKey);
  const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

  btn.disabled = true; btn.textContent = 'Ingresando...';
  const ref  = doc(db, 'stock', `${sucursal}_${productoId}`);
  const snap = await getDoc(ref);
  try {
    if (snap.exists()) {
      const dataActual = snap.data();
      const entradasActuales = dataActual.entradas || {};

      if (esPermanente) {
        const qtyPermActual = entradasActuales['permanente'] || 0;
        let qtyFechasViejas = 0;
        const updates = {};
        Object.entries(entradasActuales).forEach(([k, q]) => {
          if (k !== 'permanente' && q > 0) {
            qtyFechasViejas += q;
            updates[`entradas.${k}`] = 0;
          }
        });
        updates['entradas.permanente'] = qtyPermActual + cantidad + qtyFechasViejas;
        updates.entradasLog = arrayUnion({ fechaKey, cantidad, hora });
        await updateDoc(ref, updates);
      } else {
        const prevQty = entradasActuales[fechaKey] || 0;
        await updateDoc(ref, {
          [`entradas.${fechaKey}`]: prevQty + cantidad,
          entradasLog: arrayUnion({ fechaKey, cantidad, hora })
        });
      }
    } else {
      await setDoc(ref, {
        sucursal, productoId,
        entradas: { [fechaKey]: cantidad },
        entradasLog: [{ fechaKey, cantidad, hora }]
      });
    }
    await addDoc(collection(db, 'stockMovimientos'), {
      sucursal, productoId, cantidad, categoria: cat,
      fechaKey, hora, tipo: 'ingreso', obs,
      usuario: usuario.email, fecha: Timestamp.now()
    });
    document.getElementById('stockCantidad').value = '';
    document.getElementById('stockObs').value = '';
    inicializarFechaStock();
    limpiarStockProd();
    await cargarStockPorCategoria();
    showToast('✅ Stock ingresado correctamente');
  } catch(e) {
    alert('Error al ingresar stock: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '+ Ingresar stock';
};

// Rota categorías: hoy→ayer→antesayer→cuartoDia→merma (acumula, no elimina)
async function rotarStock() {
  if (!sucursal) return;
  const snap = await getDocs(collection(db, 'stock'));

  for (const stockDoc of snap.docs) {
    const data = stockDoc.data();
    if (data.sucursal !== sucursal) continue;
    const prod = productos.find(p => p.id === data.productoId);
    if (!prod || prod.controlStock === false || prod.autoEliminar === false) continue;

    // Merma acumula: si ya había merma + lo que viene de cuartoDia
    let mermaFinal = null;
    if (data.cuartoDia && data.cuartoDia.cantidad > 0) {
      const cantMermaAnterior = data.merma?.cantidad || 0;
      mermaFinal = {
        cantidad: cantMermaAnterior + data.cuartoDia.cantidad,
        fecha:    data.merma?.fecha || data.cuartoDia.fecha || new Date().toLocaleDateString('es-CL')
      };
    } else {
      mermaFinal = data.merma || null; // mantener merma existente
    }

    // Rotar: hoy→ayer, ayer→antesayer, antesayer→cuartoDia, cuartoDia→merma (ya calculado)
    await updateDoc(doc(db, 'stock', stockDoc.id), {
      merma:     mermaFinal,
      cuartoDia: data.antesayer ? { ...data.antesayer } : null,
      antesayer: data.ayer      ? { ...data.ayer }      : null,
      ayer:      data.hoy       ? { ...data.hoy }       : null,
      hoy:       null
    });
  }
  console.log('🔄 Rotación de stock completada (5 categorías)');
}

/**
 * Catch-up de rotación: compara la fecha de la última rotación guardada en
 * Firestore (por sucursal) contra hoy. Si pasaron uno o más días sin que
 * nadie abriera el sistema (y por lo tanto el timer de medianoche nunca
 * corrió), ejecuta rotarStock() las veces necesarias para ponerse al día.
 * Se llama cada vez que se entra a una sucursal, así que no depende de que
 * el navegador quede abierto hasta medianoche.
 */
async function verificarYRotarStock() {
  if (!sucursal) return;
  const hoyStr = fechaLocalHoy();
  const metaRef = doc(db, 'meta_rotacion', sucursal);
  try {
    const metaSnap = await getDoc(metaRef);

    // Aunque meta_rotacion diga "ya verificado hoy", comprobamos si hay stock
    // viejo en "hoy" que no debería estar ahí (puede ocurrir si el flag quedó
    // mal puesto por el bug de zona horaria en versiones anteriores).
    const yaVerificadoHoy = metaSnap.exists()
      && metaSnap.data().fecha === hoyStr
      && metaSnap.data().verificado === true;

    if (yaVerificadoHoy) {
      // Verificación extra: ¿hay stock en "hoy" que sea de antes de hoy?
      const diasReal = await calcularDiasSinRotar();
      if (diasReal === 0) return; // todo en orden, nada que hacer
      // Hay stock viejo → el flag estaba mal, forzamos la rotación
      console.log(`⚠️ meta_rotacion decía verificado pero hay ${diasReal} día(s) de stock sin rotar`);
      const vueltas = Math.min(diasReal, 3);
      for (let i = 0; i < vueltas; i++) await rotarStock();
      await setDoc(metaRef, { fecha: hoyStr, verificado: true });
      return;
    }

    let diffDias = 0;
    if (metaSnap.exists() && metaSnap.data().fecha) {
      const ultimaFecha = metaSnap.data().fecha;
      diffDias = Math.round(
        (new Date(hoyStr + 'T00:00:00') - new Date(ultimaFecha + 'T00:00:00')) / 86400000
      );
    } else {
      diffDias = await calcularDiasSinRotar();
    }

    if (diffDias > 0) {
      const vueltas = Math.min(diffDias, 3);
      console.log(`🔄 Catch-up: ${diffDias} día(s) sin rotar → ejecutando ${vueltas} rotación(es)`);
      for (let i = 0; i < vueltas; i++) await rotarStock();
    }

    await setDoc(metaRef, { fecha: hoyStr, verificado: true });
  } catch (e) {
    console.error('❌ Error en catch-up de rotación de stock:', e);
  }
}

// Convierte una fecha en formato "dd-mm-yyyy" o "dd/mm/yyyy" (es-CL) a objeto Date
function parseFechaCL(fechaStr) {
  if (!fechaStr) return null;
  const partes = fechaStr.split(/[\/\-]/);
  if (partes.length !== 3) return null;
  const [d, m, y] = partes.map(n => parseInt(n));
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// Revisa el stock real guardado (no el registro de control) para encontrar
// la fecha más antigua marcada como "hoy" y calcular cuántos días de
// rotación faltan por ejecutar. Es el respaldo para cuando no hay
// meta_rotacion previo, como al activar este fix por primera vez.
async function calcularDiasSinRotar() {
  try {
    const snap = await getDocs(collection(db, 'stock'));
    const items = snap.docs
      .filter(d => d.id.startsWith(sucursal + '_'))
      .map(d => d.data());

    let fechaMasAntigua = null;
    items.forEach(i => {
      if (i.hoy && i.hoy.fecha) {
        const f = parseFechaCL(i.hoy.fecha);
        if (f && (!fechaMasAntigua || f < fechaMasAntigua)) fechaMasAntigua = f;
      }
    });
    if (!fechaMasAntigua) return 0;

    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    fechaMasAntigua.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoy - fechaMasAntigua) / 86400000));
  } catch (e) {
    console.error('Error calculando días sin rotar:', e);
    return 0;
  }
}

// Botón de respaldo manual: fuerza una rotación inmediata, por si el
// catch-up automático no se ejecutó por alguna razón.
window.forzarRotacionManual = async function() {
  if (!sucursal) return;
  if (!confirm('¿Forzar una rotación de stock ahora?\n\nHoy → Ayer\nAyer → Antes de ayer\nAntes de ayer → Cuarto día\nCuarto día → Merma (queda pendiente de registrar)\n\nEsto normalmente ocurre solo de forma automática.')) return;
  const btn = document.getElementById('btnForzarRotacion');
  if (btn) { btn.disabled = true; btn.textContent = 'Rotando...'; }
  try {
    await rotarStock();
    const hoyStr = fechaLocalHoy();
    await setDoc(doc(db, 'meta_rotacion', sucursal), { fecha: hoyStr, verificado: true });
    await cargarStockPorCategoria();
    showToast('✅ Rotación ejecutada correctamente');
  } catch (e) {
    alert('Error al rotar stock: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Forzar rotación'; }
};

// ─── v2.8.0: la barra lateral se colapsa y se abre; el equipo recuerda cómo la dejó ───
function aplicarLateral(colapsada) {
  const marco = document.getElementById('appMarco'), btn = document.getElementById('btnLateral');
  if (!marco) return;
  marco.classList.toggle('colapsada', colapsada);
  if (btn) { btn.setAttribute('aria-expanded', String(!colapsada)); btn.setAttribute('aria-label', colapsada ? 'Abrir la barra' : 'Colapsar la barra'); }
}
window.alternarLateral = function() {
  const colapsada = !document.getElementById('appMarco').classList.contains('colapsada');
  aplicarLateral(colapsada);
  try { localStorage.setItem('fen_caja_lateral', colapsada ? 'colapsada' : 'abierta'); } catch (e) {}
};
(function () {
  let guardado = null;
  try { guardado = localStorage.getItem('fen_caja_lateral'); } catch (e) {}
  aplicarLateral(guardado ? guardado === 'colapsada' : window.innerWidth < 1024);
})();
