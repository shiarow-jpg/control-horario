// Lógica del panel de administración.
// La contraseña se exige CADA VEZ que se entra en la pestaña: enterAdmin()
// cierra cualquier sesión previa y muestra el login; leaveAdmin() cierra sesión
// al salir. Así, cambiar a Fichaje y volver obliga a introducir la contraseña.
import { api, toast, fmtFecha, fmtHora, ETIQUETA, hoyLocalStr, inicioMesLocalStr } from './common.js';

const $ = (s) => document.querySelector(s);
const show = (s) => $(s).classList.remove('hidden');
const hide = (s) => $(s).classList.add('hidden');

function soloLogin() { hide('#vistaSetup'); hide('#vistaPanel'); show('#vistaLogin'); $('#loginPass').value = ''; }

// Llamado por app.js al ENTRAR en la pestaña Administración.
export async function enterAdmin() {
  hide('#vistaSetup'); hide('#vistaLogin'); hide('#vistaPanel');
  let est;
  try { est = await api('/api/admin/estado'); } catch { est = { configurado: true }; }
  if (!est.configurado) { show('#vistaSetup'); return; }
  // Cerrar cualquier sesión heredada y pedir contraseña siempre.
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  soloLogin();
  $('#loginPass').focus();
}

// Llamado por app.js al SALIR de la pestaña Administración.
export async function leaveAdmin() {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  hide('#vistaPanel'); hide('#vistaSetup'); show('#vistaLogin'); $('#loginPass').value = '';
}

function abrirPanel() {
  hide('#vistaSetup'); hide('#vistaLogin'); show('#vistaPanel');
  $('#infHasta').value = hoyLocalStr();
  $('#infDesde').value = inicioMesLocalStr();
  cargarDispositivos(); cargarEmpleados(); cargarSolicitudes(); cargarIntegridadSilenciosa();
}

// ---- Setup / login ----
$('#btnSetup').onclick = async () => {
  const p = $('#setupPass').value, p2 = $('#setupPass2').value;
  if (p.length < 6) return toast('Mínimo 6 caracteres', 'bad');
  if (p !== p2) return toast('Las contraseñas no coinciden', 'bad');
  try {
    await api('/api/admin/setup', { method: 'POST', body: { password: p } });
    await api('/api/admin/login', { method: 'POST', body: { password: p } });
    toast('Administrador creado ✓', 'ok'); abrirPanel();
  } catch { toast('No se pudo configurar', 'bad'); }
};

$('#btnLogin').onclick = async () => {
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('#loginPass').value } });
    abrirPanel();
  } catch { toast('Contraseña incorrecta', 'bad'); }
};

$('#logout').onclick = async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  soloLogin();
};

// Enter para enviar la contraseña.
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#setupPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#setupPass2').focus(); });
$('#setupPass2').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnSetup').click(); });
$('#passNueva').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnPass').click(); });

// ---- Dispositivos ----
$('#btnAutorizar').onclick = async () => {
  const nombre = $('#dispNombre').value.trim() || 'Este equipo';
  try {
    await api('/api/admin/autorizar-dispositivo', { method: 'POST', body: { nombre } });
    toast('Equipo autorizado ✓ Ya puede fichar', 'ok'); $('#dispNombre').value = ''; cargarDispositivos();
  } catch { toast('No se pudo autorizar', 'bad'); }
};

async function cargarDispositivos() {
  const { dispositivos } = await api('/api/admin/dispositivos');
  if (!dispositivos.length) { $('#listaDisp').innerHTML = '<p class="muted">Ningún equipo autorizado todavía.</p>'; return; }
  let h = '<table><thead><tr><th>Equipo</th><th>IP</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const d of dispositivos) {
    h += `<tr><td>${d.nombre}</td><td class="muted">${d.ip || '—'}</td>
      <td>${d.activo ? '<span class="pill" style="background:rgba(46,204,113,.15);color:#2ecc71">Activo</span>' : '<span class="pill tag-anulado">Revocado</span>'}</td>
      <td>${d.activo ? `<button class="btn btn-ghost btn-sm" data-rev="${d.id}">Revocar</button>` : ''}</td></tr>`;
  }
  h += '</tbody></table>';
  $('#listaDisp').innerHTML = h;
  $('#listaDisp').querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Revocar este equipo? Dejará de poder fichar.')) return;
    await api(`/api/admin/dispositivos/${b.dataset.rev}/revocar`, { method: 'POST' }); cargarDispositivos();
  });
}

// ---- Empleados ----
$('#btnAltaEmp').onclick = async () => {
  const nombre = $('#admNombre').value.trim();
  const regimen = $('#empRegimen').value;
  if (!nombre) return toast('Falta el nombre', 'bad');
  try {
    await api('/api/admin/empleados', { method: 'POST', body: { nombre, regimen, dias_vacaciones: $('#admDiasVac').value, dias_asuntos: $('#admDiasAsu').value } });
    toast('Empleado dado de alta ✓ Creará su PIN al fichar', 'ok'); $('#admNombre').value = '';
    cargarEmpleados();
  } catch { toast('No se pudo dar de alta', 'bad'); }
};

async function cargarEmpleados() {
  const { empleados } = await api('/api/admin/empleados');
  const activos = empleados.filter(e => e.activo);
  const baja = empleados.filter(e => !e.activo);

  // Selector de informes: TODOS (incluidos los de baja) para poder consultar el
  // registro de quien ya no está en la empresa.
  $('#infEmpleado').innerHTML = empleados
    .map(e => `<option value="${e.id}">${e.nombre}${e.activo ? '' : ' (baja)'}</option>`).join('');

  // Lista de empleados activos (los únicos que aparecen también en fichaje).
  if (!activos.length) {
    $('#listaEmp').innerHTML = '<p class="muted">Sin empleados activos. Añade el primero arriba.</p>';
  } else {
    let h = '<table><thead><tr><th>Nombre</th><th>Jornada</th><th>Estado</th><th>PIN</th><th>Vac./Asuntos</th><th>Acciones</th></tr></thead><tbody>';
    for (const e of activos) {
      const pinEstado = e.pin_configurado ? 'Configurado' : '<span class="estado-pill est-pendiente">Sin configurar</span>';
      h += `<tr><td><b>${e.nombre}</b></td><td class="muted">${e.regimen}</td><td>${e.estado}</td><td>${pinEstado}</td>
        <td class="muted">${e.dias_vacaciones ?? 22} / ${e.dias_asuntos ?? 0} días</td>
        <td>
          <button class="btn btn-ghost btn-sm" data-dias="${e.id}">Editar días</button>
          <button class="btn btn-ghost btn-sm" data-resetpin="${e.id}">Restablecer PIN</button>
          <button class="btn btn-ghost btn-sm" data-act="${e.id}" data-val="0">Dar de baja</button>
        </td></tr>`;
    }
    $('#listaEmp').innerHTML = h + '</tbody></table>';
  }

  // Lista de empleados dados de baja (registro conservado, reactivables).
  if (!baja.length) {
    $('#listaBaja').innerHTML = '<p class="muted">Nadie dado de baja.</p>';
  } else {
    let h = '<table><thead><tr><th>Nombre</th><th>Jornada</th><th>Acciones</th></tr></thead><tbody>';
    for (const e of baja) {
      h += `<tr><td>${e.nombre}</td><td class="muted">${e.regimen}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="${e.id}" data-val="1">Reactivar</button></td></tr>`;
    }
    $('#listaBaja').innerHTML = h + '</tbody></table>';
  }

  // Manejadores (sobre ambas listas).
  document.querySelectorAll('#listaEmp [data-resetpin]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Restablecer el PIN de este empleado? Tendrá que crear uno nuevo la próxima vez que fiche. Tú no verás el PIN.')) return;
    await api(`/api/admin/empleados/${b.dataset.resetpin}/reset-pin`, { method: 'POST' });
    toast('PIN restablecido ✓ El empleado creará uno nuevo', 'ok'); cargarEmpleados();
  });
  document.querySelectorAll('#listaEmp [data-dias]').forEach(b => b.onclick = async () => {
    const e = activos.find(x => x.id == b.dataset.dias);
    const vac = prompt('Días de vacaciones al año:', e?.dias_vacaciones ?? 22);
    if (vac == null) return;
    const asu = prompt('Días de asuntos propios al año:', e?.dias_asuntos ?? 0);
    if (asu == null) return;
    await api(`/api/admin/empleados/${b.dataset.dias}`, { method: 'POST', body: { dias_vacaciones: vac, dias_asuntos: asu } });
    toast('Días actualizados ✓', 'ok'); cargarEmpleados();
  });
  document.querySelectorAll('#listaEmp [data-act], #listaBaja [data-act]').forEach(b => b.onclick = async () => {
    const alta = b.dataset.val === '1';
    if (!alta && !confirm('¿Dar de baja a este empleado? Dejará de aparecer en fichaje, pero su registro se conserva y seguirá siendo consultable en Informes.')) return;
    await api(`/api/admin/empleados/${b.dataset.act}`, { method: 'POST', body: { activo: Number(b.dataset.val) } });
    cargarEmpleados();
  });
}

// ---- Informes ----
$('#btnInforme').onclick = cargarInforme;
async function cargarInforme() {
  const empleado_id = $('#infEmpleado').value;
  const desde = $('#infDesde').value, hasta = $('#infHasta').value;
  if (!empleado_id) return toast('Selecciona empleado', 'bad');
  const r = await api(`/api/admin/informe?empleado_id=${empleado_id}&desde=${desde}&hasta=${hasta}`);
  let h = `<div class="banner" style="background:rgba(90,140,255,.12);border-color:rgba(90,140,255,.4);color:#9cc0ff">
    <b>${r.empleado}</b> · Total trabajado: <b>${r.totalTrabajado}</b> · Pausas: ${r.totalPausa}
    ${r.abierto ? ' · <span style="color:#f1c40f">Jornada sin cerrar</span>' : ''}</div>`;
  if (!r.dias.length) h += '<p class="muted">Sin fichajes en el periodo.</p>';
  else {
    h += '<table><thead><tr><th>Día</th><th>Marcajes</th><th>Trabajado</th><th>Pausa</th></tr></thead><tbody>';
    for (const d of r.dias) {
      const marc = d.marcajes.map(m => {
        const corr = (m.origen === 'manual' || m.origen === 'solicitud') ? ` <span class="pill tag-manual" title="${(m.motivo || '').replace(/"/g, '')}">corregido</span>` : '';
        const sinc = m.origen === 'offline_sync' ? ' <span class="pill tag-sync">sinc</span>' : '';
        return `${fmtHora(m.ts)} ${ETIQUETA[m.tipo]}${corr}${sinc}`;
      }).join(' · ');
      h += `<tr><td>${fmtFecha(d.fecha)}</td><td>${marc}</td><td><b>${d.trabajado}</b></td><td class="muted">${d.pausa}</td></tr>`;
    }
    h += '</tbody></table>';
  }
  // Correcciones (qué se modificó y por qué).
  if (r.correcciones?.length) {
    h += '<h2 class="mt">Correcciones y modificaciones</h2><table><thead><tr><th>Acción</th><th>Marcaje</th><th>Motivo</th></tr></thead><tbody>';
    for (const c of r.correcciones)
      h += `<tr><td>${c.accion === 'anulado' ? '<span class="tag-anulado">Anulado</span>' : 'Añadido'}</td><td>${fmtFecha(c.ts.slice(0, 10))} ${fmtHora(c.ts)} · ${ETIQUETA[c.tipo] || c.tipo}</td><td class="muted">${c.motivo || ''}</td></tr>`;
    h += '</tbody></table>';
  }
  // Ausencias aprobadas.
  if (r.ausencias?.length) {
    h += '<h2 class="mt">Ausencias aprobadas</h2><ul>';
    for (const a of r.ausencias) h += `<li class="muted">${a.motivo || ''}</li>`;
    h += '</ul>';
  }
  $('#infResultado').innerHTML = h;
  cargarEventos(empleado_id);
}

$('#btnPdf').onclick = () => {
  const empleado_id = $('#infEmpleado').value;
  const desde = $('#infDesde').value, hasta = $('#infHasta').value;
  if (!empleado_id) return toast('Selecciona empleado', 'bad');
  window.open(`/api/admin/informe/pdf?empleado_id=${empleado_id}&desde=${desde}&hasta=${hasta}`, '_blank');
};

// ---- Solicitudes (el empleado pide, el admin aprueba/deniega) ----
$('#solicFiltro').onchange = cargarSolicitudes;
async function cargarSolicitudes() {
  const estado = $('#solicFiltro').value;
  const { solicitudes } = await api(`/api/admin/solicitudes?estado=${estado}`);
  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length;
  const badge = $('#solicBadge');
  badge.classList.toggle('hidden', pendientes === 0);
  badge.textContent = pendientes ? `${pendientes} pendiente${pendientes > 1 ? 's' : ''}` : '';
  if (!solicitudes.length) { $('#listaSolic').innerHTML = '<p class="muted">No hay solicitudes.</p>'; return; }
  let h = '<table><thead><tr><th>Empleado</th><th>Tipo</th><th>Detalle</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const s of solicitudes) {
    const acc = s.estado === 'pendiente'
      ? `<button class="btn btn-sm" style="background:#1f9d57;color:#fff" data-ap="${s.id}">Aprobar</button>
         <button class="btn btn-sm" style="background:#c0392b;color:#fff" data-de="${s.id}">Denegar</button>`
      : `<span class="muted">${s.nota_admin || ''}</span>`;
    h += `<tr><td><b>${s.empleado}</b></td><td>${s.clase === 'correccion' ? 'Corrección' : 'Ausencia'}</td>
      <td>${s.detalle}</td><td class="muted">${s.motivo || ''}</td>
      <td><span class="estado-pill est-${s.estado}">${s.estado}</span></td><td>${acc}</td></tr>`;
  }
  $('#listaSolic').innerHTML = h + '</tbody></table>';
  $('#listaSolic').querySelectorAll('[data-ap]').forEach(b => b.onclick = () => resolver(b.dataset.ap, 'aprobar'));
  $('#listaSolic').querySelectorAll('[data-de]').forEach(b => b.onclick = () => resolver(b.dataset.de, 'denegar'));
}
async function resolver(id, decision) {
  let nota = '';
  if (decision === 'denegar') nota = prompt('Motivo de la denegación (opcional):') || '';
  try {
    await api(`/api/admin/solicitudes/${id}/resolver`, { method: 'POST', body: { decision, nota } });
    toast(decision === 'aprobar' ? 'Solicitud aprobada ✓' : 'Solicitud denegada', decision === 'aprobar' ? 'ok' : '');
    cargarSolicitudes();
  } catch (e) { toast(e.data?.error === 'ya_resuelta' ? 'Ya estaba resuelta' : 'No se pudo resolver', 'bad'); }
}

// ---- Auditoría (registro completo, solo lectura) ----
async function cargarEventos(empleadoId) {
  const { eventos } = await api(`/api/admin/eventos/${empleadoId}`);
  const anulados = new Set(eventos.filter(e => e.tipo === 'anulacion' && e.ref_evento_id).map(e => e.ref_evento_id));
  let h = '<table><thead><tr><th>Fecha/hora</th><th>Tipo</th><th>Origen</th><th>Autor</th><th>Motivo</th></tr></thead><tbody>';
  for (const e of eventos) {
    const anulado = anulados.has(e.id);
    h += `<tr><td>${fmtFecha(e.ts_efectivo.slice(0, 10))} ${fmtHora(e.ts_efectivo)}</td>
      <td class="${anulado ? 'tag-anulado' : ''}">${e.etiqueta}${e.tipo === 'anulacion' && e.ref_evento_id ? ` (#${e.ref_evento_id})` : ''}</td>
      <td>${e.origen}</td><td>${e.autor}</td><td class="muted">${e.motivo || ''}</td></tr>`;
  }
  $('#listaEventos').innerHTML = h + '</tbody></table>';
}

// ---- Integridad / contraseña ----
$('#btnIntegridad').onclick = async () => {
  const r = await api('/api/admin/integridad');
  $('#integridadRes').innerHTML = r.ok
    ? `<span class="pill" style="background:rgba(46,204,113,.15);color:#2ecc71">Cadena intacta (${r.total} eventos)</span>`
    : `<span class="pill tag-anulado">ALTERADA en seq ${r.roto_en}: ${r.motivo}</span>`;
};
async function cargarIntegridadSilenciosa() { try { await $('#btnIntegridad').onclick(); } catch {} }

$('#btnPass').onclick = async () => {
  const actual = $('#passActual').value, nueva = $('#passNueva').value;
  if (nueva.length < 6) return toast('La nueva debe tener mín. 6 caracteres', 'bad');
  try {
    await api('/api/admin/cambiar-password', { method: 'POST', body: { actual, nueva } });
    toast('Contraseña cambiada ✓', 'ok'); $('#passActual').value = ''; $('#passNueva').value = '';
  } catch { toast('Contraseña actual incorrecta', 'bad'); }
};
