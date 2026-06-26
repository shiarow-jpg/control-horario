// Utilidades compartidas por las paginas del frontend.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respuestas no-JSON (PDF) */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'error');
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
export function toast(msg, tipo = '') {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

const TZ = 'Atlantic/Canary';
// Fecha local (Canarias) en YYYY-MM-DD, para los selectores de fecha.
export const hoyLocalStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const inicioMesLocalStr = () => hoyLocalStr().slice(0, 8) + '01';
export const fmtHora = (iso) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ, hour12: false }).format(new Date(iso));
export const fmtFecha = (f) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ }).format(new Date(f + 'T12:00:00Z'));

export function relojEn(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  const tick = () => {
    el.textContent = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: TZ, hour12: false,
    }).format(new Date());
  };
  tick(); setInterval(tick, 1000);
}

export const ETIQUETA = {
  entrada: 'Entrada', salida: 'Salida', inicio_pausa: 'Inicio almuerzo',
  fin_pausa: 'Fin almuerzo', anulacion: 'Anulación',
};
export const ETIQUETA_ESTADO = { fuera: 'Fuera', trabajando: 'Trabajando', en_pausa: 'En almuerzo' };

export function iniciales(nombre) {
  return nombre.split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
}
