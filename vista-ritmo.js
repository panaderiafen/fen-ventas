// ═══════════════════════════════════════════════
//  Sistema Fën — Mi ritmo en Hoy  v0.127.0
//  Arriba en Hoy: el bloque que toca ahora (o el próximo de hoy) con sus tareas, lo del mes y lo que viene.
//  "Editar mi ritmo": la semana completa y cada bloque (nombre, días, horario, semana A/B, tareas).
//  H: { esc, info, dialogo, registrar, mensajeError, correo }
// ═══════════════════════════════════════════════
import * as MR from './mi-ritmo.js?v=0.138.0';

const TXT = 'Su semana de trabajo, en bloques: cada bloque tiene su hora y sus tareas, y Hoy muestra el que toca.\nLas casillas se marcan a mano; las que dicen "solo" las marca el sistema cuando lo ve hecho (la cartola subida hoy, la Bandeja sin nada por unir, nada sin clasificar; lo lee del resumen que se guarda al abrir Gastos).\nLo que no se hizo en un bloque no pasa al siguiente: lo pendiente se ve en la cifra de cada tarea.\nLos turnos (cafetería, panadería) se ven en la semana como referencia.\nSemana A y B: semana por medio (A las semanas pares del año, B las impares). Para cambiar bloques o tareas: "Editar mi ritmo".';
const st = { R: null, G: null, hechos: {} };
const ahoraCl = () => { const s = new Date().toLocaleString('sv-SE', { timeZone: 'America/Santiago' }); return { f: s.slice(0, 10), h: s.slice(11, 16) }; };
const diaCorto = (f, hoy) => (f === hoy ? 'Hoy' : f === MR.masDias(hoy, 1) ? 'Mañana' : MR.DIAS_LARGOS[MR.diaSemana(f)].replace(/^./, c => c.toUpperCase()));

// el: la sección de Hoy (#mi-ritmo). G: el resumen de Gastos (o null)
export async function pintar(el, H, G) {
  if (!el) return;
  try { st.R = await MR.leer(); } catch (e) { st.R = MR.RITMO_BASE; }
  st.G = G || null;
  const { f } = ahoraCl();
  try { st.hechos = await MR.leerHechos(f); } catch (e) { st.hechos = {}; }
  dibujar(el, H);
}
function dibujar(el, H) {
  if (!el.isConnected) return;
  const { f, h } = ahoraCl(), R = st.R, E = MR.enHoy(R, f, h), b = E.ahora || E.luego, mes = MR.delMes(R, f);
  const tareas = b ? (b.tareas || []).map(t => ({ t, e: MR.estadoTarea(t, st.G, f, st.hechos[b.id]) })) : [];
  const listas = tareas.filter(x => x.e.hecho).length;
  const filaT = ({ t, e }) => `<div class="mr-tarea${e.hecho ? ' mr-hecha' : ''}"><label><input type="checkbox" data-mr-t="${H.esc(t.id)}" ${e.hecho ? 'checked' : ''} ${e.auto ? 'disabled' : ''}>
      <span>${H.esc(t.nombre)}${e.cuenta != null && e.cuenta > 0 ? ` <small class="mr-cuenta">· ${e.cuenta} ${e.cuenta === 1 ? 'pendiente' : 'pendientes'}</small>` : ''}</span></label>
      ${e.auto ? '<span class="chip c-verde chip-chico" title="Lo marcó el sistema">solo</span>' : ''}${t.ruta ? `<a class="mr-ir" href="${H.esc(t.ruta)}">Ir</a>` : ''}</div>`;
  el.innerHTML = `<div class="titulo-fila"><h2 id="t-ritmo">Mi ritmo ${H.info('Mi ritmo', TXT)}</h2><button type="button" class="btn-sec btn-chico" data-mr-editar>Editar mi ritmo</button></div>
    ${b ? `<div class="mr-bloque${E.ahora ? ' mr-ahora' : ''}" data-mr-bloque="${H.esc(b.id)}">
        <div class="mr-cab"><b>${E.ahora ? 'Ahora' : 'Hoy, más tarde'} · ${H.esc(b.nombre)}</b><span>${H.esc(b.ini)}–${H.esc(b.fin)}</span></div>
        ${b.nota ? `<p class="mr-nota">${H.esc(b.nota)}</p>` : ''}
        ${tareas.length ? `<div class="mr-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${tareas.length}" aria-valuenow="${listas}" aria-label="Tareas listas"><span style="width:${Math.round(100 * listas / tareas.length)}%"></span></div>
          <small class="mr-avance">${listas} de ${tareas.length} ${tareas.length === 1 ? 'lista' : 'listas'}</small>${tareas.map(filaT).join('')}` : ''}
      </div>` : `<p class="ayuda">Hoy no quedan bloques de trabajo.${(E.vienen[0] ? ` El próximo: ${H.esc(diaCorto(E.vienen[0].dia, f).toLowerCase())} ${H.esc(E.vienen[0].b.ini)} · ${H.esc(E.vienen[0].b.nombre)}.` : '')}</p>`}
    ${mes.length ? `<div class="mr-mes"><b>Este mes</b>${mes.map(x => `<span>${H.esc(x.nombre)}${x.ruta ? ` · <a href="${H.esc(x.ruta)}">Ir</a>` : ''}</span>`).join('')}</div>` : ''}
    ${E.vienen.length ? `<div class="mr-vienen"><b>Lo que viene</b>${E.vienen.map(v => `<span>${H.esc(diaCorto(v.dia, f))} ${H.esc(v.b.ini)} · ${H.esc(v.b.nombre)}${v.b.cada !== 'siempre' ? ` (semana ${H.esc(v.b.cada)})` : ''}</span>`).join('')}</div>` : ''}`;
  if (st.err) { el.insertAdjacentHTML('beforeend', `<p class="error" role="alert">${H.esc(st.err)}</p>`); st.err = ''; }
  el.querySelector('[data-mr-editar]').onclick = () => editar(el, H);
  el.querySelectorAll('[data-mr-t]').forEach(x => x.addEventListener('change', async () => {
    x.disabled = true;
    try { st.hechos = await MR.marcar(f, b.id, x.dataset.mrT, x.checked); }
    catch (e) { st.err = H.mensajeError ? H.mensajeError(e) : 'No se pudo guardar la casilla.'; }
    dibujar(el, H);
  }));
}

// ── Editar mi ritmo ──
const copia = o => JSON.parse(JSON.stringify(o));
function semanaHtml(H, R) {
  const col = d => R.bloques.filter(b => (b.dias || []).includes(d)).sort((a, b) => a.ini.localeCompare(b.ini))
    .map(b => `<button type="button" class="mr-sem-b mr-${b.tipo === 'turno' ? 'turno' : 'bloque'}" data-mr-ed="${H.esc(b.id)}">${H.esc(b.ini)} ${H.esc(b.nombre)}${b.cada !== 'siempre' ? ` · sem. ${H.esc(b.cada)}` : ''}</button>`).join('') || '<span class="mr-libre">Libre</span>';
  return `<div class="mr-semana">${[1, 2, 3, 4, 5, 6, 0].map(d => `<div><b>${MR.DIAS[d]}</b>${col(d)}</div>`).join('')}</div>`;
}
function editar(el, H) {
  const R = copia(st.R);
  const dlg = H.dialogo(`<form class="form-dialogo mr-dlg" novalidate><div class="titulo-fila"><h2>Editar mi ritmo</h2>${H.info('Mi ritmo', TXT)}</div>
    <p class="ayuda">Toque un bloque para cambiarlo. Gris: turnos (solo referencia). Verde: bloques con tareas.</p>
    <div data-mr-sem></div>
    <div class="botones" style="justify-content:flex-start"><button type="button" class="btn-sec" data-mr-nuevo>+ Agregar bloque</button></div>
    <div data-mr-form></div>
    <h3 class="gn-h3">Lo del mes</h3><div data-mr-mes></div>
    <p class="error" data-err role="alert"></p>
    <div class="botones"><button type="button" class="btn-sec" data-mr-base>Volver al ritmo inicial</button><button type="button" class="btn-sec" data-cerrar>Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>`);
  const err = t => { dlg.querySelector('[data-err]').textContent = t || ''; };
  const pintarSem = () => { dlg.querySelector('[data-mr-sem]').innerHTML = semanaHtml(H, R); dlg.querySelectorAll('[data-mr-ed]').forEach(x => x.onclick = () => formBloque(x.dataset.mrEd)); };
  const pintarMes = () => {
    dlg.querySelector('[data-mr-mes]').innerHTML = R.mes.map((x, i) => `<div class="mr-mes-f"><input aria-label="Tarea del mes" data-mm="nombre" data-i="${i}" value="${H.esc(x.nombre)}" maxlength="80">
      <label>${x.ultimo ? 'último día' : `días <input type="number" min="1" max="31" data-mm="desde" data-i="${i}" value="${x.desde}" aria-label="Desde el día"> a <input type="number" min="1" max="31" data-mm="hasta" data-i="${i}" value="${x.hasta || x.desde}" aria-label="Hasta el día">`}</label>
      <select data-mm="ruta" data-i="${i}" aria-label="Pantalla">${MR.DESTINOS.map(([v, t]) => `<option value="${v}" ${v === x.ruta ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="btn-sec btn-chico" data-mm-quitar="${i}" aria-label="Quitar">×</button></div>`).join('') + '<button type="button" class="btn-sec btn-chico" data-mm-nuevo>+ Tarea del mes</button>';
    dlg.querySelectorAll('[data-mm]').forEach(x => x.addEventListener('input', () => { const m = R.mes[x.dataset.i]; m[x.dataset.mm] = x.type === 'number' ? Number(x.value) : x.value; }));
    dlg.querySelectorAll('[data-mm-quitar]').forEach(x => x.onclick = () => { R.mes.splice(Number(x.dataset.mmQuitar), 1); pintarMes(); });
    dlg.querySelector('[data-mm-nuevo]').onclick = () => { R.mes.push({ id: 'm' + Date.now().toString(36), nombre: '', desde: 1, hasta: 1, ruta: '' }); pintarMes(); };
  };
  const formBloque = id => {
    err('');
    let b = R.bloques.find(x => x.id === id);
    if (!b) { b = { id: 'b' + Date.now().toString(36), nombre: '', tipo: 'bloque', dias: [], ini: '', fin: '', cada: 'siempre', nota: '', tareas: [] }; R.bloques.push(b); }
    const box = dlg.querySelector('[data-mr-form]');
    const filasT = () => (b.tareas || []).map((t, i) => `<div class="mr-t-f"><input aria-label="Tarea" data-tt="nombre" data-i="${i}" value="${H.esc(t.nombre)}" maxlength="80" placeholder="Qué hay que hacer">
      <select aria-label="Pantalla" data-tt="ruta" data-i="${i}">${MR.DESTINOS.map(([v, x]) => `<option value="${v}" ${v === t.ruta ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <select aria-label="Cómo se marca" data-tt="auto" data-i="${i}">${MR.AUTOS.map(([v, x]) => `<option value="${v}" ${v === t.auto ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button type="button" class="btn-sec btn-chico" data-tt-quitar="${i}" aria-label="Quitar tarea">×</button></div>`).join('');
    const dibujarF = () => {
      box.innerHTML = `<fieldset class="mr-form"><legend>${b.nombre ? H.esc(b.nombre) : 'Bloque nuevo'}</legend>
        <div class="campo"><label for="mr-n">Nombre</label><input id="mr-n" maxlength="60" value="${H.esc(b.nombre)}"></div>
        <div class="chips" role="radiogroup" aria-label="Tipo"><label class="chip-radio"><input type="radio" name="mr-tipo" value="bloque" ${b.tipo !== 'turno' ? 'checked' : ''}><span>Bloque con tareas</span></label><label class="chip-radio"><input type="radio" name="mr-tipo" value="turno" ${b.tipo === 'turno' ? 'checked' : ''}><span>Turno (solo referencia)</span></label></div>
        <div class="chips" role="group" aria-label="Días">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="chip-radio"><input type="checkbox" data-mr-dia="${d}" ${(b.dias || []).includes(d) ? 'checked' : ''}><span>${MR.DIAS[d]}</span></label>`).join('')}</div>
        <div class="fila-campos"><div class="campo"><label for="mr-ini">Desde</label><input id="mr-ini" type="time" value="${H.esc(b.ini)}"></div><div class="campo"><label for="mr-fin">Hasta</label><input id="mr-fin" type="time" value="${H.esc(b.fin)}"></div>
          <div class="campo"><label for="mr-cada">Se repite</label><select id="mr-cada"><option value="siempre" ${b.cada === 'siempre' ? 'selected' : ''}>Cada semana</option><option value="A" ${b.cada === 'A' ? 'selected' : ''}>Semana A (por medio)</option><option value="B" ${b.cada === 'B' ? 'selected' : ''}>Semana B (por medio)</option></select></div></div>
        <div class="campo"><label for="mr-nota">Nota (opcional)</label><input id="mr-nota" maxlength="160" value="${H.esc(b.nota || '')}"></div>
        <div data-mr-tareas ${b.tipo === 'turno' ? 'hidden' : ''}><b>Tareas</b>${filasT()}<button type="button" class="btn-sec btn-chico" data-tt-nuevo>+ Agregar tarea</button></div>
        <div class="botones" style="justify-content:space-between"><button type="button" class="btn-sec" data-mr-quitar>Quitar este bloque</button><button type="button" class="btn-sec" data-mr-listo>Listo</button></div></fieldset>`;
      const leerF = () => { b.nombre = box.querySelector('#mr-n').value; b.tipo = box.querySelector('[name=mr-tipo]:checked').value; b.dias = [...box.querySelectorAll('[data-mr-dia]:checked')].map(x => Number(x.dataset.mrDia));
        b.ini = box.querySelector('#mr-ini').value; b.fin = box.querySelector('#mr-fin').value; b.cada = box.querySelector('#mr-cada').value; b.nota = box.querySelector('#mr-nota').value; };
      box.querySelectorAll('input, select').forEach(x => x.addEventListener('change', () => { leerF(); if (x.name === 'mr-tipo') box.querySelector('[data-mr-tareas]').hidden = b.tipo === 'turno'; pintarSem(); }));
      box.querySelectorAll('[data-tt]').forEach(x => x.addEventListener('input', () => { b.tareas[x.dataset.i][x.dataset.tt] = x.value; }));
      box.querySelectorAll('[data-tt-quitar]').forEach(x => x.onclick = () => { leerF(); b.tareas.splice(Number(x.dataset.ttQuitar), 1); dibujarF(); });
      box.querySelector('[data-tt-nuevo]').onclick = () => { leerF(); (b.tareas = b.tareas || []).push({ id: 't' + Date.now().toString(36), nombre: '', ruta: '', auto: '' }); dibujarF(); };
      box.querySelector('[data-mr-quitar]').onclick = () => { R.bloques = R.bloques.filter(x => x !== b); box.innerHTML = ''; pintarSem(); };
      box.querySelector('[data-mr-listo]').onclick = () => { leerF(); box.innerHTML = ''; pintarSem(); };
      box.querySelector('#mr-n').focus();
    };
    dibujarF();
  };
  pintarSem(); pintarMes();
  dlg.querySelector('[data-mr-nuevo]').onclick = () => formBloque('');
  dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
  dlg.querySelector('[data-mr-base]').onclick = () => { const B = copia(MR.RITMO_BASE); R.bloques = B.bloques; R.mes = B.mes; dlg.querySelector('[data-mr-form]').innerHTML = ''; pintarSem(); pintarMes(); };
  dlg.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault(); err(''); const bt = dlg.querySelector('[type=submit]'); bt.disabled = true;
    const fb = dlg.querySelector('[data-mr-listo]'); if (fb) fb.click();
    try { st.R = await MR.guardar(R, H.correo && H.correo()); dlg.close(); H.registrar && H.registrar('Mi ritmo: guardó cambios', `${st.R.bloques.length} bloques`); dibujar(el, H); }
    catch (e) { bt.disabled = false; err(e.message || 'No se pudo guardar.'); }
  });
}
