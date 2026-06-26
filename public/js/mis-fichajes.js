// "Mi cuenta" del empleado: fichajes + solicitudes (corrección / ausencia).
import { api, toast, fmtFecha, fmtHora, ETIQUETA, hoyLocalStr, inicioMesLocalStr } from './common.js';

const $ = (s) => document.querySelector(s);
const ETIQUETA_ESTADO_SOL = { pendiente: 'Pendiente', aprobada: 'Aprobada', denegada: 'Denegada' };

function auth() { return { empleado_id: Number($('#mfEmpleado').value), pin: $('#mfPin').value }; }
function pinOk() {
  if (!/^\d{4}$/.test($('#mfPin').value)) { toast('Introduce tu PIN de 4 dígitos', 'bad'); return false; }
  return true;
}

// ---- Mis fichajes (consulta + PDF) ----
function pintarFichajes(r) {
  let html = `<div class="banner" style="background:rgba(90,140,255,.12);border-color:rgba(90,140,255,.4);color:#9cc0ff">
    <b>${r.empleado}</b> · Total trabajado: <b>${r.totalTrabajado}</b> · Pausas: ${r.totalPausa}
    ${r.abierto ? ' · <span style="color:#f1c40f">Jornada sin cerrar</span>' : ''}</div>`;
  if (!r.dias.length) { html += '<p class="muted">Sin fichajes en el periodo.</p>'; $('#mfResultado').innerHTML = html; return; }
  html += '<table><thead><tr><th>Día</th><th>Marcajes</th><th>Trabajado</th></tr></thead><tbody>';
  for (const d of r.dias) {
    const marc = d.marcajes.map(m => {
      const corr = (m.origen === 'manual' || m.origen === 'solicitud') ? ` <span class="pill tag-manual" title="${m.motivo || ''}">corregido</span>` : '';
      const sinc = m.origen === 'offline_sync' ? ' <span class="pill tag-sync">sinc</span>' : '';
      return `${fmtHora(m.ts)} ${ETIQUETA[m.tipo]}${corr}${sinc}`;
    }).join(' · ');
    html += `<tr><td>${fmtFecha(d.fecha)}</td><td>${marc}</td><td><b>${d.trabajado}</b></td></tr>`;
  }
  html += '</tbody></table>';
  $('#mfResultado').innerHTML = html;
}

async function consultar() {
  if (!pinOk()) return;
  try {
    const r = await api('/api/mis-fichajes/consulta', { method: 'POST', body: { ...auth(), desde: $('#mfDesde').value, hasta: $('#mfHasta').value } });
    pintarFichajes(r);
  } catch (e) { toast(e.data?.error === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo consultar', 'bad'); }
}

async function descargarPdf() {
  if (!pinOk()) return;
  try {
    const res = await fetch('/api/mis-fichajes/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...auth(), desde: $('#mfDesde').value, hasta: $('#mfHasta').value }) });
    if (!res.ok) { toast('PIN incorrecto o sin datos', 'bad'); return; }
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `mis-fichajes-${$('#mfDesde').value}.pdf`; a.click();
    URL.revokeObjectURL(url);
  } catch { toast('No se pudo descargar', 'bad'); }
}

// ---- Pedir corrección ----
async function cargarParaAnular() {
  if (!pinOk()) return;
  try {
    const desde = inicioMesLocalStr(), hasta = hoyLocalStr();
    const r = await api('/api/mis-fichajes/consulta', { method: 'POST', body: { ...auth(), desde, hasta } });
    const ops = [];
    for (const d of r.dias) for (const m of d.marcajes) ops.push(`<option value="${m.id}">${fmtFecha(d.fecha)} ${fmtHora(m.ts)} · ${ETIQUETA[m.tipo]}</option>`);
    $('#corrRef').innerHTML = ops.length ? ops.join('') : '<option value="">(sin fichajes este mes)</option>';
    toast('Fichajes cargados', 'ok');
  } catch (e) { toast(e.data?.error === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo cargar', 'bad'); }
}

async function enviarCorreccion() {
  if (!pinOk()) return;
  const accion = $('#corrAccion').value;
  const motivo = $('#corrMotivo').value.trim();
  if (!motivo) return toast('Indica el motivo', 'bad');
  const body = { ...auth(), accion, motivo };
  if (accion === 'anadir') {
    if (!$('#corrTs').value) return toast('Indica fecha y hora', 'bad');
    body.tipo = $('#corrTipo').value;
    body.ts = new Date($('#corrTs').value).toISOString();
  } else {
    if (!$('#corrRef').value) return toast('Elige el marcaje a anular (carga tus fichajes)', 'bad');
    body.ref_id = Number($('#corrRef').value);
  }
  try {
    await api('/api/solicitudes/correccion', { method: 'POST', body });
    toast('Solicitud enviada ✓ El administrador la revisará', 'ok');
    $('#corrMotivo').value = '';
  } catch (e) { toast(e.data?.error === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo enviar', 'bad'); }
}

// ---- Pedir ausencia ----
async function enviarAusencia() {
  if (!pinOk()) return;
  if (!$('#ausDesde').value) return toast('Indica la fecha de inicio', 'bad');
  const body = {
    ...auth(), aus_tipo: $('#ausTipo').value,
    aus_subtipo: $('#ausTipo').value === 'permiso_retribuido' ? $('#ausSub').value : null,
    aus_desde: $('#ausDesde').value, aus_hasta: $('#ausHasta').value || $('#ausDesde').value,
    aus_horas: $('#ausHoras').value.trim(), motivo: $('#ausMotivo').value.trim(),
  };
  try {
    await api('/api/solicitudes/ausencia', { method: 'POST', body });
    toast('Solicitud de ausencia enviada ✓', 'ok');
    $('#ausMotivo').value = '';
  } catch (e) {
    const err = e.data?.error;
    toast(err === 'pin_incorrecto' ? 'PIN incorrecto' : err === 'motivo_requerido' ? 'El motivo es obligatorio en «Otro»' : 'No se pudo enviar', 'bad');
  }
}

// ---- Mis solicitudes ----
async function verMisSolicitudes() {
  if (!pinOk()) return;
  try {
    const { solicitudes } = await api('/api/solicitudes/mias', { method: 'POST', body: auth() });
    if (!solicitudes.length) { $('#ssLista').innerHTML = '<p class="muted">No tienes solicitudes.</p>'; return; }
    let h = '<table><thead><tr><th>Tipo</th><th>Detalle</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>';
    for (const s of solicitudes) {
      h += `<tr><td>${s.clase === 'correccion' ? 'Corrección' : 'Ausencia'}</td>
        <td>${s.detalle}</td><td class="muted">${s.motivo || ''}</td>
        <td><span class="estado-pill est-${s.estado}">${ETIQUETA_ESTADO_SOL[s.estado]}</span>${s.nota_admin ? `<br><span class="muted" style="font-size:11px">${s.nota_admin}</span>` : ''}</td></tr>`;
    }
    $('#ssLista').innerHTML = h + '</tbody></table>';
  } catch (e) { toast(e.data?.error === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo cargar', 'bad'); }
}

// ---- Saldo de vacaciones / asuntos propios ----
let saldoCache = null;
async function cargarSaldo() {
  try { saldoCache = await api('/api/solicitudes/saldo', { method: 'POST', body: auth() }); }
  catch { saldoCache = null; }
  pintarSaldo();
}
function pintarSaldo() {
  const el = $('#ausSaldo'), tipo = $('#ausTipo').value;
  if (!saldoCache || (tipo !== 'vacaciones' && tipo !== 'asuntos_propios')) { el.classList.add('hidden'); return; }
  const s = tipo === 'vacaciones' ? saldoCache.vacaciones : saldoCache.asuntos_propios;
  const nombre = tipo === 'vacaciones' ? 'vacaciones' : 'asuntos propios';
  el.innerHTML = `Te quedan <b>${s.restantes}</b> de ${s.total} días de ${nombre} (año ${saldoCache.anio}). Usados: ${s.usados}.`;
  el.classList.remove('hidden');
}

// Vuelve a la puerta (pide PIN), oculta el contenido.
function mostrarGate() {
  $('#mfAuth').classList.remove('hidden');
  $('#mfContenido').classList.add('hidden');
  $('#mfPin').value = '';
}

let wired = false;
export async function initMisFichajes() {
  $('#mfDesde').value = inicioMesLocalStr();
  $('#mfHasta').value = hoyLocalStr();
  $('#mfResultado').innerHTML = '';
  mostrarGate(); // siempre se empieza por el PIN
  try {
    const { empleados } = await api('/api/fichaje/empleados');
    $('#mfEmpleado').innerHTML = empleados.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  } catch { toast('No se pudo cargar la lista', 'bad'); }

  if (wired) return;
  wired = true;

  // Puerta de entrada: validar el PIN y, si es correcto, mostrar el contenido.
  const entrar = async () => {
    if (!pinOk()) return;
    try {
      const r = await api('/api/fichaje/verificar-pin', { method: 'POST', body: auth() });
      $('#mfQuien').textContent = r.nombre;
      $('#mfAuth').classList.add('hidden');
      $('#mfContenido').classList.remove('hidden');
      document.querySelectorAll('#vistaMisFichajes .subtab').forEach((x, i) => x.classList.toggle('active', i === 0));
      for (const pane of ['fichajes', 'correccion', 'ausencia', 'solicitudes', 'pin'])
        $('#ss-' + pane).classList.toggle('hidden', pane !== 'fichajes');
      consultar();
    } catch (e) {
      const err = e.data?.error;
      toast(err === 'pin_no_configurado' ? 'Aún no tienes PIN. Créalo en la pantalla de fichar.'
        : err === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo entrar', 'bad');
    }
  };
  $('#mfEntrar').onclick = entrar;
  $('#mfPin').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  $('#mfSalir').onclick = (e) => { e.preventDefault(); mostrarGate(); };

  // sub-pestañas
  document.querySelectorAll('#vistaMisFichajes .subtab').forEach(t => t.onclick = () => {
    document.querySelectorAll('#vistaMisFichajes .subtab').forEach(x => x.classList.toggle('active', x === t));
    for (const pane of ['fichajes', 'correccion', 'ausencia', 'solicitudes', 'pin'])
      $('#ss-' + pane).classList.toggle('hidden', pane !== t.dataset.ss);
    if (t.dataset.ss === 'solicitudes') verMisSolicitudes();
    if (t.dataset.ss === 'ausencia') cargarSaldo();
  });

  $('#mfConsultar').onclick = consultar;
  $('#mfPdf').onclick = descargarPdf;

  // corrección: toggle añadir/anular
  $('#corrAccion').onchange = () => {
    const anular = $('#corrAccion').value === 'anular';
    $('#corrAnadir').classList.toggle('hidden', anular);
    $('#corrAnular').classList.toggle('hidden', !anular);
  };
  $('#corrCargar').onclick = cargarParaAnular;
  $('#corrEnviar').onclick = enviarCorreccion;

  // ausencia: mostrar subtipo solo en permiso retribuido
  $('#ausTipo').onchange = () => {
    $('#ausSubWrap').classList.toggle('hidden', $('#ausTipo').value !== 'permiso_retribuido');
    pintarSaldo();
  };
  $('#ausEnviar').onclick = enviarAusencia;

  $('#ssRefrescar').onclick = verMisSolicitudes;

  // cambiar PIN
  $('#cpaGuardar').onclick = async () => {
    const empleado_id = Number($('#mfEmpleado').value);
    const pin_actual = $('#cpaActual').value, nuevo = $('#cpaNuevo').value, nuevo2 = $('#cpaNuevo2').value;
    if (!/^\d{4}$/.test(nuevo)) return toast('El nuevo PIN debe tener 4 dígitos', 'bad');
    if (nuevo !== nuevo2) return toast('El nuevo PIN no coincide', 'bad');
    try {
      await api('/api/fichaje/cambiar-pin', { method: 'POST', body: { empleado_id, pin_actual, nuevo, nuevo2 } });
      toast('PIN cambiado ✓', 'ok');
      $('#cpaActual').value = ''; $('#cpaNuevo').value = ''; $('#cpaNuevo2').value = '';
    } catch (e) { toast(e.data?.error === 'pin_incorrecto' ? 'PIN actual incorrecto' : 'No se pudo cambiar', 'bad'); }
  };
}
