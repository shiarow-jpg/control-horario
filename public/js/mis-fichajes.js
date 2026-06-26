// Subvista "Mis fichajes": el empleado consulta/descarga SU registro con su PIN.
import { api, toast, fmtFecha, fmtHora, ETIQUETA, hoyLocalStr, inicioMesLocalStr } from './common.js';

const $ = (s) => document.querySelector(s);

function cuerpo() {
  return {
    empleado_id: Number($('#mfEmpleado').value),
    pin: $('#mfPin').value,
    desde: $('#mfDesde').value,
    hasta: $('#mfHasta').value,
  };
}

function pintar(r) {
  let html = `<div class="banner" style="background:rgba(90,140,255,.12);border-color:rgba(90,140,255,.4);color:#9cc0ff">
    <b>${r.empleado}</b> · Total trabajado: <b>${r.totalTrabajado}</b> · Pausas: ${r.totalPausa}
    ${r.abierto ? ' · <span style="color:#f1c40f">Jornada sin cerrar</span>' : ''}</div>`;
  if (!r.dias.length) { html += '<p class="muted">Sin fichajes en el periodo.</p>'; $('#mfResultado').innerHTML = html; return; }
  html += '<table><thead><tr><th>Día</th><th>Marcajes</th><th>Trabajado</th><th>Pausa</th></tr></thead><tbody>';
  for (const d of r.dias) {
    const marc = d.marcajes.map(m => `${fmtHora(m.ts)} ${ETIQUETA[m.tipo]}${m.origen==='offline_sync'?' <span class="pill tag-sync">sinc</span>':''}${m.origen==='manual'?' <span class="pill tag-manual">manual</span>':''}`).join(' · ');
    html += `<tr><td>${fmtFecha(d.fecha)}</td><td>${marc}</td><td><b>${d.trabajado}</b></td><td class="muted">${d.pausa}</td></tr>`;
  }
  html += '</tbody></table>';
  $('#mfResultado').innerHTML = html;
}

let wired = false;
export async function initMisFichajes() {
  // Fechas por defecto: mes en curso (fecha local canaria).
  $('#mfHasta').value = hoyLocalStr();
  $('#mfDesde').value = inicioMesLocalStr();
  $('#mfResultado').innerHTML = '';
  $('#mfPin').value = '';

  try {
    const { empleados } = await api('/api/fichaje/empleados');
    $('#mfEmpleado').innerHTML = empleados.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  } catch {
    toast('No se pudo cargar la lista', 'bad');
  }

  if (wired) return;
  wired = true;

  $('#mfPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('#mfConsultar').click(); });

  $('#mfConsultar').onclick = async () => {
    try {
      const r = await api('/api/mis-fichajes/consulta', { method: 'POST', body: cuerpo() });
      pintar(r);
    } catch (e) {
      toast(e.data?.error === 'pin_incorrecto' ? 'PIN incorrecto' : 'No se pudo consultar', 'bad');
    }
  };

  $('#mfPdf').onclick = async () => {
    const c = cuerpo();
    try {
      const res = await fetch('/api/mis-fichajes/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c),
      });
      if (!res.ok) { toast('PIN incorrecto o sin datos', 'bad'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `mis-fichajes-${c.desde}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('No se pudo descargar', 'bad'); }
  };
}
