// Logica de jornada: estado actual, validacion de transiciones y calculo de horas.
import { db } from './db.js';
import { config } from './config.js';

// Fecha local (zona horaria de la empresa, p.ej. Canarias) en formato YYYY-MM-DD.
// IMPORTANTE: agrupar por dia debe hacerse en hora LOCAL, no en UTC, o un fichaje
// de madrugada (verano canario = UTC+1) se asignaria al dia anterior.
const fmtDiaLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
});
export const diaLocal = (d) => fmtDiaLocal.format(new Date(d));
export const hoyLocal = () => diaLocal(new Date());
export const inicioMesLocal = () => hoyLocal().slice(0, 8) + '01';

export const TIPOS_MARCAJE = ['entrada', 'salida', 'inicio_pausa', 'fin_pausa'];

export const ETIQUETA_TIPO = {
  entrada: 'Entrada',
  salida: 'Salida',
  inicio_pausa: 'Inicio almuerzo',
  fin_pausa: 'Fin almuerzo',
  anulacion: 'Anulación',
};

// Estados posibles del empleado y que marcajes admite cada uno.
// fuera -> entrada ; trabajando -> inicio_pausa|salida ; en_pausa -> fin_pausa
export const TRANSICIONES = {
  fuera:      { entrada: 'trabajando' },
  trabajando: { inicio_pausa: 'en_pausa', salida: 'fuera' },
  en_pausa:   { fin_pausa: 'trabajando' },
};

export function getEmpleados({ soloActivos = false } = {}) {
  const sql = `SELECT id, nombre, regimen, activo, creado_en FROM empleados
               ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY nombre COLLATE NOCASE`;
  return db.prepare(sql).all();
}

export function getEmpleado(id) {
  return db.prepare('SELECT id, nombre, regimen, activo, creado_en FROM empleados WHERE id = ?').get(id);
}

// Conjunto de ids de eventos que han sido anulados (para excluirlos del computo).
function getAnuladosSet() {
  const rows = db.prepare("SELECT ref_evento_id FROM eventos WHERE tipo = 'anulacion' AND ref_evento_id IS NOT NULL").all();
  return new Set(rows.map(r => r.ref_evento_id));
}

// Eventos de marcaje vigentes (no anulados) de un empleado, ordenados por momento efectivo.
export function getMarcajes(empleadoId, { desde, hasta } = {}) {
  const anulados = getAnuladosSet();
  let sql = `SELECT * FROM eventos WHERE empleado_id = ? AND tipo IN ('entrada','salida','inicio_pausa','fin_pausa')`;
  const params = [empleadoId];
  if (desde) { sql += ' AND ts_efectivo >= ?'; params.push(desde); }
  if (hasta) { sql += ' AND ts_efectivo <= ?'; params.push(hasta); }
  sql += ' ORDER BY ts_efectivo ASC, seq ASC';
  return db.prepare(sql).all(...params).filter(e => !anulados.has(e.id));
}

// Estado actual del empleado a partir de su ultimo marcaje vigente.
export function getEstado(empleadoId) {
  const marcajes = getMarcajes(empleadoId);
  let estado = 'fuera';
  let desde = null;
  for (const m of marcajes) {
    const siguiente = TRANSICIONES[estado]?.[m.tipo];
    if (siguiente) { estado = siguiente; desde = m.ts_efectivo; }
  }
  return { estado, desde };
}

// Devuelve los tipos de marcaje permitidos desde el estado actual.
export function marcajesPermitidos(estado) {
  return Object.keys(TRANSICIONES[estado] || {});
}

// Calcula la jornada (segmentos y totales) en un periodo, agrupada por dia.
// Atribuye cada tramo trabajado al dia en que empieza.
export function calcularJornada(empleadoId, desde, hasta) {
  const marcajes = getMarcajes(empleadoId, { desde, hasta });
  const dias = new Map(); // 'YYYY-MM-DD' -> { trabajadoSeg, pausaSeg, marcajes: [] }

  const ensure = (d) => {
    if (!dias.has(d)) dias.set(d, { fecha: d, trabajadoSeg: 0, pausaSeg: 0, marcajes: [] });
    return dias.get(d);
  };

  let estado = 'fuera';
  let segStart = null;   // inicio del tramo trabajado actual
  let pausaStart = null; // inicio de la pausa actual

  for (const m of marcajes) {
    ensure(diaLocal(m.ts_efectivo)).marcajes.push(m);
    const t = new Date(m.ts_efectivo).getTime();
    if (m.tipo === 'entrada' && estado === 'fuera') {
      estado = 'trabajando'; segStart = t;
    } else if (m.tipo === 'inicio_pausa' && estado === 'trabajando') {
      ensure(diaLocal(segStart)).trabajadoSeg += (t - segStart) / 1000;
      estado = 'en_pausa'; pausaStart = t; segStart = null;
    } else if (m.tipo === 'fin_pausa' && estado === 'en_pausa') {
      ensure(diaLocal(pausaStart)).pausaSeg += (t - pausaStart) / 1000;
      estado = 'trabajando'; segStart = t; pausaStart = null;
    } else if (m.tipo === 'salida' && estado === 'trabajando') {
      ensure(diaLocal(segStart)).trabajadoSeg += (t - segStart) / 1000;
      estado = 'fuera'; segStart = null;
    }
  }

  const lista = [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const totalTrabajadoSeg = lista.reduce((s, d) => s + d.trabajadoSeg, 0);
  const totalPausaSeg = lista.reduce((s, d) => s + d.pausaSeg, 0);
  // Marca si el empleado quedo "abierto" (sin salida) dentro del periodo.
  const abierto = estado !== 'fuera';
  return { dias: lista, totalTrabajadoSeg, totalPausaSeg, abierto };
}

// Formatea segundos como "Hh Mm".
export function fmtDuracion(seg) {
  seg = Math.max(0, Math.round(seg));
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
