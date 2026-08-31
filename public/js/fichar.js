// Logica de la pantalla de fichaje (kiosko) + cola offline.
import { api, toast, mensajeError, relojEn, relojHeroEn, iniciales, ETIQUETA, ETIQUETA_ESTADO, esc } from './common.js';

const COLA_KEY = 'fichaje_cola_offline';
const ACCIONES = [
  { tipo: 'entrada', label: 'ENTRADA' },
  { tipo: 'salida', label: 'SALIDA' },
  { tipo: 'inicio_pausa', label: 'INICIO ALMUERZO' },
  { tipo: 'fin_pausa', label: 'FIN ALMUERZO' },
];
// Que acciones se permiten desde cada estado (espejo del servidor).
const PERMITIDOS = {
  fuera: ['entrada'],
  trabajando: ['inicio_pausa', 'salida'],
  en_pausa: ['fin_pausa'],
};

let empleados = [];
let seleccionado = null;
let pin = '';

const $ = (s) => document.querySelector(s);
relojEn('#reloj');
relojHeroEn('#relojHora', '#relojSeg', '#relojFecha');

function leerCola() { try { return JSON.parse(localStorage.getItem(COLA_KEY) || '[]'); } catch { return []; } }
function guardarCola(c) { localStorage.setItem(COLA_KEY, JSON.stringify(c)); }

function pintarOffline() {
  const cola = leerCola();
  const banner = $('#offlineBanner');
  if (!navigator.onLine || cola.length) {
    banner.classList.remove('hidden');
    $('#colaCount').textContent = cola.length ? `(${cola.length} pendiente${cola.length > 1 ? 's' : ''})` : '';
  } else {
    banner.classList.add('hidden');
  }
}

async function cargar() {
  try {
    const ctx = await api('/api/contexto');
    if (!ctx.dispositivoAutorizado) {
      $('#sinAutorizar').classList.remove('hidden');
      return;
    }
    const { empleados: emps } = await api('/api/fichaje/empleados');
    empleados = emps;
    $('#vistaEmpleados').classList.remove('hidden');
    pintarGrid();
    pintarOffline();
    flushCola();
  } catch (e) {
    // Sin conexion al cargar: si tenemos cola previa, mostramos aviso.
    $('#vistaEmpleados').classList.remove('hidden');
    pintarOffline();
    toast('Sin conexión con el servidor', 'bad');
  }
}

function pintarGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!empleados.length) {
    grid.innerHTML = '<p class="muted">Todavía no hay empleados dados de alta. Ve a Administración para añadir el primero.</p>';
    return;
  }
  empleados.forEach((e, i) => {
    // Botón real (no un div con onclick): así funciona con teclado, tiene
    // foco visible y los lectores de pantalla lo anuncian como pulsable.
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emp';
    b.style.setProperty('--i', i); // entrada escalonada
    b.setAttribute('aria-label', `Fichar como ${e.nombre}. Estado actual: ${ETIQUETA_ESTADO[e.estado]}`);
    b.innerHTML = `
      <span class="avatar" aria-hidden="true">${esc(iniciales(e.nombre))}</span>
      <span class="nombre">${esc(e.nombre)}</span>
      <span class="estado est-${esc(e.estado)}">${esc(ETIQUETA_ESTADO[e.estado] || e.estado)}</span>`;
    b.onclick = () => seleccionar(e);
    grid.appendChild(b);
  });
}

async function seleccionar(e) {
  // Consulta el estado FRESCO del empleado (por si el admin restablecio el PIN
  // o cambio el estado desde el otro PC). Asi el kiosko no usa datos en cache.
  try {
    const f = await api('/api/fichaje/estado/' + e.id);
    e = { ...e, estado: f.estado, desde: f.desde, pin_configurado: f.pin_configurado };
  } catch { /* sin conexion: usamos lo que tenemos */ }
  seleccionado = e; pin = '';
  $('#vistaEmpleados').classList.add('hidden');
  $('#vistaFichar').classList.remove('hidden');
  $('#empNombre').textContent = e.nombre;

  // Sin PIN configurado -> mostrar la creacion de PIN (primera vez o tras reset).
  const primera = !e.pin_configurado;
  $('#crearPin').classList.toggle('hidden', !primera);
  $('#pinNormal').classList.toggle('hidden', primera);
  if (primera) {
    $('#empEstado').textContent = 'Crea tu PIN de 4 dígitos para empezar a fichar.';
    $('#cpPin').value = ''; $('#cpPin2').value = '';
  } else {
    $('#empEstado').textContent = e.estado === 'trabajando' && e.desde
      ? `Trabajando desde las ${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary', hour12: false }).format(new Date(e.desde))}`
      : e.estado === 'en_pausa' ? 'En pausa de almuerzo' : 'Actualmente fuera';
    pintarPin(); pintarPad(); pintarAcciones();
  }
}

async function crearPin() {
  if (!seleccionado) return;
  const p = $('#cpPin').value, p2 = $('#cpPin2').value;
  if (!/^\d{4}$/.test(p)) return toast('El PIN debe tener 4 dígitos', 'bad');
  if (p !== p2) return toast('Los PIN no coinciden', 'bad');
  try {
    await api('/api/fichaje/configurar-pin', { method: 'POST', body: { empleado_id: seleccionado.id, pin: p, pin2: p2 } });
    toast('PIN creado ✓ Ya puedes fichar', 'ok');
    seleccionado.pin_configurado = true;
    seleccionar(seleccionado); // recargar en modo normal
  } catch (e) {
    toast(e.data?.error === 'pin_ya_configurado' ? 'Este empleado ya tiene PIN' : 'No se pudo crear el PIN', 'bad');
  }
}

function pintarPin() {
  $('#dots').innerHTML = [0,1,2,3].map(i => `<div class="pindot ${i < pin.length ? 'on' : ''}"></div>`).join('');
}
function pintarPad() {
  const pad = $('#pinpad');
  pad.innerHTML = '';
  const BORRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11v12H9l-6-6 6-6z" stroke-linejoin="round"/><path d="M17 10l-4 4M13 10l4 4" stroke-linecap="round"/></svg>';
  const teclas = ['1','2','3','4','5','6','7','8','9','C','0','borrar'];
  for (const t of teclas) {
    const b = document.createElement('button');
    b.type = 'button';
    if (t === 'borrar') { b.innerHTML = BORRAR; b.setAttribute('aria-label', 'Borrar último dígito'); }
    else if (t === 'C') { b.textContent = t; b.setAttribute('aria-label', 'Borrar el PIN entero'); }
    else b.textContent = t;
    b.onclick = () => {
      if (t === 'C') pin = '';
      else if (t === 'borrar') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += t;
      pintarPin(); pintarAcciones();
    };
    pad.appendChild(b);
  }
}

function pintarAcciones() {
  const cont = $('#acciones');
  cont.innerHTML = '';
  const permitidos = PERMITIDOS[seleccionado.estado] || [];
  for (const a of ACCIONES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${a.tipo}`;
    b.textContent = a.label;
    b.disabled = pin.length !== 4 || !permitidos.includes(a.tipo);
    b.onclick = () => fichar(a.tipo);
    cont.appendChild(b);
  }
}

async function fichar(tipo) {
  const empleado_id = seleccionado.id;
  const pinActual = pin;
  try {
    const r = await api('/api/fichaje/fichar', { method: 'POST', body: { empleado_id, pin: pinActual, tipo } });
    toast(`${seleccionado.nombre}: ${r.marcaje.etiqueta} registrada ✓`, 'ok');
    await refrescarYVolver();
  } catch (e) {
    if ((e.status === 401 && e.data?.error === 'pin_incorrecto') || e.status === 429) {
      toast(mensajeError(e, 'PIN incorrecto'), 'bad'); pin = ''; pintarPin(); pintarAcciones(); return;
    }
    if (e.status === 409 && e.data?.error === 'pin_no_configurado') {
      toast('Tu PIN fue restablecido. Crea uno nuevo.', '');
      seleccionado.pin_configurado = false; seleccionar(seleccionado); return;
    }
    if (e.status === 409) { toast('Esa acción no es válida ahora mismo', 'bad'); await refrescarYVolver(); return; }
    if (e.status === 400 || e.status === 404) { toast('No se pudo fichar', 'bad'); return; }
    // Error de red -> a la cola offline (la hora real es ahora).
    // NO se guarda el PIN en el navegador: el fichaje se sincronizara como
    // 'offline_sync' (sin PIN), marcado y revisable por el administrador.
    const cola = leerCola();
    cola.push({ empleado_id, nombre: seleccionado.nombre, tipo, ts_efectivo: new Date().toISOString() });
    guardarCola(cola);
    toast(`${seleccionado.nombre}: guardado sin conexión, se enviará al volver internet`, '');
    volver(); pintarOffline();
  }
}

async function refrescarYVolver() {
  try { const { empleados: emps } = await api('/api/fichaje/empleados'); empleados = emps; } catch {}
  volver();
}

function volver() {
  seleccionado = null; pin = '';
  $('#vistaFichar').classList.add('hidden');
  $('#vistaEmpleados').classList.remove('hidden');
  pintarGrid();
}
$('#volver').onclick = volver;
$('#cpGuardar').onclick = crearPin;
$('#cpPin2').addEventListener('keydown', e => { if (e.key === 'Enter') crearPin(); });

// Vacia la cola offline contra el servidor (origen offline_sync).
async function flushCola() {
  let cola = leerCola();
  if (!cola.length) return;
  const pendientes = [];
  for (const item of cola) {
    try {
      await api('/api/fichaje/fichar', { method: 'POST', body: {
        empleado_id: item.empleado_id, tipo: item.tipo,
        origen: 'offline_sync', ts_efectivo: item.ts_efectivo,
      }});
    } catch (e) {
      if (e.status >= 500 || e.status === undefined) { pendientes.push(item); } // reintentar luego
      // errores 4xx (pin, transicion) se descartan para no bloquear la cola; quedan en logs
    }
  }
  guardarCola(pendientes);
  pintarOffline();
  if (cola.length && !pendientes.length) toast('Fichajes pendientes sincronizados ✓', 'ok');
}

window.addEventListener('online', () => { pintarOffline(); flushCola().then(cargar); });
window.addEventListener('offline', pintarOffline);

// El admin acaba de autorizar este equipo: recargar el kiosko sin refrescar
// la página (antes había que recargar a mano para que dejara de decir
// "equipo no autorizado").
document.addEventListener('kiosko-recargar', () => {
  $('#sinAutorizar').classList.add('hidden');
  cargar();
});

// Teclado fisico en la pantalla de PIN: digitos (0-9 y teclado numerico),
// Retroceso para borrar y Enter para confirmar (solo si hay una unica accion
// posible, para no fichar algo por error cuando hay varias opciones).
document.addEventListener('keydown', (e) => {
  if (!seleccionado || $('#vistaFichar').classList.contains('hidden')) return;
  if (!$('#crearPin').classList.contains('hidden')) return; // en modo "crear PIN" no
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
    if (pin.length < 4) pin += e.key;
    pintarPin(); pintarAcciones(); e.preventDefault();
  } else if (e.key === 'Backspace') {
    pin = pin.slice(0, -1); pintarPin(); pintarAcciones(); e.preventDefault();
  } else if (e.key === 'Enter' && pin.length === 4) {
    const perm = PERMITIDOS[seleccionado.estado] || [];
    if (perm.length === 1) fichar(perm[0]);
  }
});

cargar();
