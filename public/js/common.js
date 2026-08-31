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

// Traduce los codigos de error del servidor a mensajes para el usuario.
const ERRORES = {
  pin_incorrecto: 'PIN incorrecto',
  password_incorrecta: 'Contraseña incorrecta',
  motivo_requerido: 'El motivo es obligatorio',
  ya_resuelta: 'Ya estaba resuelta',
};
export function mensajeError(e, porDefecto = 'No se pudo completar') {
  const code = e?.data?.error;
  if (code === 'demasiados_intentos') {
    const min = Math.max(1, Math.ceil((e.data?.espera || 300) / 60));
    return `Demasiados intentos fallidos. Vuelve a intentarlo en ${min} min`;
  }
  return ERRORES[code] || porDefecto;
}

let toastTimer;
export function toast(msg, tipo = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    // Para que los lectores de pantalla anuncien el resultado del fichaje.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
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

// Reloj protagonista del kiosko: hora grande, segundos y fecha por separado.
export function relojHeroEn(selHora, selSeg, selFecha) {
  const hEl = document.querySelector(selHora), sEl = document.querySelector(selSeg), fEl = document.querySelector(selFecha);
  if (!hEl) return;
  const fmtHM = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ, hour12: false });
  const fmtS = new Intl.DateTimeFormat('es-ES', { second: '2-digit', timeZone: TZ, hour12: false });
  const fmtF = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  let ultimaFecha = '';
  const tick = () => {
    const ahora = new Date();
    enCeldas(hEl, fmtHM.format(ahora));
    if (sEl) enCeldas(sEl, fmtS.format(ahora).padStart(2, '0'));
    if (fEl) {
      const f = fmtF.format(ahora);
      if (f !== ultimaFecha) { ultimaFecha = f; fEl.textContent = f; }
    }
  };
  tick(); setInterval(tick, 1000);
}

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

// Escribe una cifra por casilla de ancho fijo. La tipografía de cartel no
// tiene cifras tabulares (el "1" mide la mitad que el "0"), así que sin
// esto el reloj y los cronómetros "bailarían" a cada tic. Solo se tocan
// los dígitos que han cambiado, no se rehace el bloque entero.
export function enCeldas(el, txt) {
  if (el.dataset.txt === txt) return;
  if (el.dataset.txt && el.dataset.txt.length === txt.length) {
    const celdas = el.children;
    for (let i = 0; i < txt.length; i++) {
      if (celdas[i] && celdas[i].textContent !== txt[i]) celdas[i].textContent = txt[i];
    }
  } else {
    el.innerHTML = [...txt]
      .map(ch => `<span class="${/\d/.test(ch) ? 'd' : 'sep'}">${ch}</span>`)
      .join('');
  }
  el.dataset.txt = txt;
}

// ---- Cronómetros en vivo ----
// Un elemento con [data-crono] lleva el tiempo YA consolidado (data-base, en
// segundos) y, si el tramo sigue abierto, el instante en que empezó
// (data-desde). Un único temporizador los repinta a todos cada segundo, así
// el contador avanza sin pedir nada al servidor.
export function fmtCrono(seg) {
  seg = Math.max(0, Math.floor(seg));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function segundosCrono(el) {
  const base = Number(el.dataset.base || 0);
  const desde = el.dataset.desde;
  if (!desde) return base;
  return base + (Date.now() - new Date(desde).getTime()) / 1000;
}

export function pintarCronometros() {
  for (const el of document.querySelectorAll('[data-crono]')) enCeldas(el, fmtCrono(segundosCrono(el)));
}

let cronoIniciado = false;
export function iniciarCronometros() {
  if (cronoIniciado) return;
  cronoIniciado = true;
  pintarCronometros();
  setInterval(pintarCronometros, 1000);
}

// Datos de cronómetro de un empleado, según su estado actual.
// Trabajando: corre el tiempo de trabajo. En pausa: el trabajo queda
// congelado y corre la pausa. Fuera: ambos quedan como registro del día.
export function cronoDatos(e) {
  const hoy = e.hoy || { trabajadoSeg: 0, pausaSeg: 0 };
  return {
    trabajo: { base: hoy.trabajadoSeg || 0, desde: e.estado === 'trabajando' ? e.desde : null },
    pausa: { base: hoy.pausaSeg || 0, desde: e.estado === 'en_pausa' ? e.desde : null },
  };
}

// Escapa texto para insertarlo en HTML (nombres, mensajes, motivos...).
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function iniciales(nombre) {
  return nombre.split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
}
