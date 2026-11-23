// Sistema Fën v0.137.2 · Campo "Categoría" de una materia prima o insumo: una lista con las que existen y "Otra…" para una nueva.
// (Emmanuel, 21 nov: al escribirla a mano se creaban categorías repetidas, como "Lácteos", "Lacteos" y "Leches").
// Si en "Otra…" se escribe una que ya existe (sin tilde, en plural…), avisa y se guarda con la forma que existe (mp-alta-modelo.js).
import { claveCategoria } from './mp-alta-modelo.js?v=0.138.0';
const OTRA = '__otra';
// H: helpers (esc). id: el id del select (el campo de texto es id + '-otra'). valor: la categoría actual. cats: categoriasDe(mps)
export function htmlCategoria(H, id, valor, cats, { dataK = '' } = {}) {
  const v = String(valor || '').trim(), k = claveCategoria(v), hay = cats.find(c => claveCategoria(c) === k);
  const pend = !v || /^pendiente/i.test(v) || /^sin categor/i.test(v), sel = pend ? '' : hay || OTRA;
  return `<select id="${id}" data-cat-sel${dataK ? ` data-k="${dataK}"` : ''}>
      <option value="" ${sel === '' ? 'selected' : ''}>Elegir…</option>
      ${cats.map(c => `<option value="${H.esc(c)}" ${c === sel ? 'selected' : ''}>${H.esc(c)}</option>`).join('')}
      <option value="${OTRA}" ${sel === OTRA ? 'selected' : ''}>Otra…</option></select>
    <input id="${id}-otra" data-cat-otra maxlength="40" autocomplete="off" placeholder="Nombre de la categoría nueva" aria-label="Categoría nueva" ${sel === OTRA ? `value="${H.esc(v)}"` : 'hidden'}>
    <span class="ayuda" id="${id}-aviso" role="status" aria-live="polite"></span>`;
}
export function leerCategoria(root, id) {
  const s = root.querySelector('#' + CSS.escape(id)); if (!s) return '';
  if (s.value !== OTRA) return s.value;
  const o = root.querySelector('#' + CSS.escape(id + '-otra')); return o ? o.value : '';
}
// Mostrar el campo de texto con "Otra…" y avisar si la escrita ya existe. Se conecta una vez por contenedor.
export function conectarCategoria(root, cats) {
  if (!root || root.dataset.catConectado) return; root.dataset.catConectado = '1';
  const aviso = (id, txt) => { const a = root.querySelector('#' + CSS.escape(id + '-aviso')); if (a) a.textContent = txt; };
  root.addEventListener('change', e => {
    const s = e.target.closest('[data-cat-sel]'); if (!s) return;
    const o = root.querySelector('#' + CSS.escape(s.id + '-otra')); if (!o) return;
    o.hidden = s.value !== OTRA; aviso(s.id, '');
    if (!o.hidden) o.focus();
  });
  root.addEventListener('input', e => {
    const o = e.target.closest('[data-cat-otra]'); if (!o) return;
    const id = o.id.replace(/-otra$/, ''), k = claveCategoria(o.value), hay = k && cats.find(c => claveCategoria(c) === k);
    aviso(id, hay ? `Ya existe "${hay}": se usará esa.` : '');
  });
}
