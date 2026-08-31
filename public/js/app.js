// Orquestador de la página única: pestañas (Fichaje / Administración),
// subvista "Mis fichajes" dentro del kiosko, y arranque de los módulos.
import './fichar.js';      // auto-inicia el kiosko (rejilla, reloj, cola offline)
import { enterAdmin, leaveAdmin } from './admin.js';
import { initMisFichajes } from './mis-fichajes.js';
import { api } from './common.js';

const $ = (s) => document.querySelector(s);

// ---- Marca white-label: nombre y logo segun la empresa configurada ----
(async () => {
  try {
    const ctx = await api('/api/contexto');
    const nombre = ctx.empresa || 'Control Horario';
    document.title = 'Fichaje · ' + nombre;
    const bn = $('#brandName'); if (bn) bn.textContent = nombre;
    const initials = nombre.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    const bl = $('#brandLogo');
    if (bl) { bl.dataset.initials = initials; if (!bl.querySelector('img')) bl.textContent = initials; }
  } catch { /* sin conexion: se queda el valor por defecto del HTML */ }
})();

// ---- Indicador de notificaciones pendientes (solicitudes + avisos) ----
// El dueño no siempre entra en Administración: este badge en la propia
// pestaña le avisa de que hay algo pendiente de revisar, sin revelar detalles.
async function refrescarNotificaciones() {
  try {
    const ctx = await api('/api/contexto');
    const p = ctx.pendientes;
    const total = p ? (p.solicitudes || 0) + (p.avisos || 0) : 0;
    const badge = $('#tabAdminBadge');
    if (!badge) return;
    badge.classList.toggle('hidden', total === 0);
    badge.textContent = total > 99 ? '99+' : (total || '');
    const tabAdmin = document.querySelector('.tab[data-tab="admin"]');
    if (tabAdmin) tabAdmin.title = total
      ? `Tienes ${total} notificación${total > 1 ? 'es' : ''} pendiente${total > 1 ? 's' : ''} de revisión`
      : '';
  } catch { /* sin conexión: se mantiene el último estado */ }
}
refrescarNotificaciones();
setInterval(refrescarNotificaciones, 60 * 1000);
document.addEventListener('notifs-refresh', refrescarNotificaciones);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarNotificaciones(); });

// ---- Pestañas ----
// Al entrar en Administración se exige la contraseña SIEMPRE; al salir se cierra
// la sesión, de modo que volver a entrar vuelve a pedirla (requisito de seguridad).
let tabActual = 'fichaje';
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    const destino = tab.dataset.tab;
    if (destino === tabActual) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    $('#tab-fichaje').classList.toggle('active', destino === 'fichaje');
    $('#tab-admin').classList.toggle('active', destino === 'admin');

    if (destino === 'admin') enterAdmin();      // pide contraseña cada vez
    if (tabActual === 'admin') leaveAdmin();     // cierra sesión al salir
    tabActual = destino;
  };
});

// ---- Subvista "Mi cuenta" (dentro de la pestaña Fichaje) ----
$('#btnMisFichajes').onclick = () => {
  $('#vistaEmpleados').classList.add('hidden');
  $('#vistaFichar').classList.add('hidden');
  $('#vistaMisFichajes').classList.remove('hidden');
  initMisFichajes(); // reinicia la puerta (pide PIN) cada vez
};
$('#mfVolver').onclick = () => {
  $('#vistaMisFichajes').classList.add('hidden');
  $('#vistaEmpleados').classList.remove('hidden');
};
