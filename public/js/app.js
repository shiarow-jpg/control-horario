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

// ---- Subvista "Mis fichajes" (dentro de la pestaña Fichaje) ----
let mfIniciado = false;
$('#btnMisFichajes').onclick = () => {
  $('#vistaEmpleados').classList.add('hidden');
  $('#vistaFichar').classList.add('hidden');
  $('#vistaMisFichajes').classList.remove('hidden');
  if (!mfIniciado) { initMisFichajes(); mfIniciado = true; }
};
$('#mfVolver').onclick = () => {
  $('#vistaMisFichajes').classList.add('hidden');
  $('#vistaEmpleados').classList.remove('hidden');
};
