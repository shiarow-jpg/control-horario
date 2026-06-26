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
  ausencia: 'Ausencia',
};

// Tipos de ausencia/permiso soportados (basados en la normativa española).
export const TIPOS_AUSENCIA = ['vacaciones', 'permiso_retribuido', 'asuntos_propios', 'medico', 'baja', 'otro'];
export const ETIQUETA_AUSENCIA = {
  vacaciones: 'Vacaciones',
  permiso_retribuido: 'Permiso retribuido',
  asuntos_propios: 'Asuntos propios',
  medico: 'Cita médica',
  baja: 'Baja médica (IT)',
  otro: 'Otro',
};
// Subtipos del permiso retribuido (art. 37.3 ET).
export const SUBTIPOS_PERMISO = [
  'matrimonio', 'fallecimiento_familiar', 'hospitalizacion_familiar',
  'fuerza_mayor_familiar', 'mudanza', 'deber_publico', 'lactancia', 'nacimiento_cuidado', 'climatico',
];
export const ETIQUETA_SUBTIPO = {
  matrimonio: 'Matrimonio / pareja de hecho',
  fallecimiento_familiar: 'Fallecimiento de familiar',
  hospitalizacion_familiar: 'Hospitalización / enfermedad grave de familiar',
  fuerza_mayor_familiar: 'Fuerza mayor familiar',
  mudanza: 'Traslado de domicilio',
  deber_publico: 'Deber público / legal',
  lactancia: 'Lactancia',
  nacimiento_cuidado: 'Nacimiento y cuidado de menor',
  climatico: 'Permiso climático',
};

// Estados posibles del empleado y que marcajes admite cada uno.
// fuera -> entrada ; trabajando -> inicio_pausa|salida ; en_pausa -> fin_pausa
export const TRANSICIONES = {
  fuera:      { entrada: 'trabajando' },
  trabajando: { inicio_pausa: 'en_pausa', salida: 'fuera' },
  en_pausa:   { fin_pausa: 'trabajando' },
};

export function getEmpleados({ soloActivos = false } = {}) {
  const sql = `SELECT id, nombre, regimen, activo, creado_en, dias_vacaciones, dias_asuntos,
               CASE WHEN pin_hash IS NOT NULL AND pin_hash != '' THEN 1 ELSE 0 END AS pin_configurado
               FROM empleados ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY nombre COLLATE NOCASE`;
  return db.prepare(sql).all();
}

export function getEmpleado(id) {
  return db.prepare('SELECT id, nombre, regimen, activo, creado_en, dias_vacaciones, dias_asuntos FROM empleados WHERE id = ?').get(id);
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

// Correcciones que afectan al periodo (para mostrarlas en el informe con su
// motivo): marcajes anadidos manualmente / por solicitud, y anulaciones.
export function getCorrecciones(empleadoId, desde, hasta) {
  const out = [];
  // Marcajes anadidos (olvidos) por correccion/admin.
  const anadidos = db.prepare(`
    SELECT * FROM eventos
    WHERE empleado_id = ? AND tipo IN ('entrada','salida','inicio_pausa','fin_pausa')
      AND origen IN ('manual','solicitud') AND ts_efectivo >= ? AND ts_efectivo <= ?
    ORDER BY ts_efectivo ASC`).all(empleadoId, desde, hasta);
  for (const e of anadidos) out.push({ accion: 'anadido', tipo: e.tipo, ts: e.ts_efectivo, motivo: e.motivo, autor: e.autor });

  // Anulaciones cuyo marcaje anulado cae en el periodo.
  const anul = db.prepare(`SELECT a.*, m.tipo AS m_tipo, m.ts_efectivo AS m_ts
    FROM eventos a JOIN eventos m ON m.id = a.ref_evento_id
    WHERE a.empleado_id = ? AND a.tipo = 'anulacion' AND m.ts_efectivo >= ? AND m.ts_efectivo <= ?
    ORDER BY m.ts_efectivo ASC`).all(empleadoId, desde, hasta);
  for (const e of anul) out.push({ accion: 'anulado', tipo: e.m_tipo, ts: e.m_ts, motivo: e.motivo, autor: e.autor });

  return out;
}

// Ausencias aprobadas (eventos tipo 'ausencia') en un periodo.
export function getAusencias(empleadoId, desde, hasta) {
  return db.prepare(`SELECT * FROM eventos WHERE empleado_id = ? AND tipo = 'ausencia'
    AND ts_efectivo >= ? AND ts_efectivo <= ? ORDER BY ts_efectivo ASC`).all(empleadoId, desde, hasta);
}

// Formato comun de una solicitud para el frontend (empleado y admin).
export function formatear(s) {
  const r = {
    id: s.id, clase: s.clase, estado: s.estado, motivo: s.motivo,
    creada_en: s.creada_en, resuelta_en: s.resuelta_en, nota_admin: s.nota_admin,
  };
  if (s.clase === 'correccion') {
    r.accion = s.corr_accion;
    r.corr_tipo = s.corr_tipo; r.corr_ts = s.corr_ts; r.corr_ref_id = s.corr_ref_id;
    r.detalle = s.corr_accion === 'anadir'
      ? `Añadir ${ETIQUETA_TIPO[s.corr_tipo] || s.corr_tipo}`
      : `Anular marcaje #${s.corr_ref_id}`;
  } else {
    r.aus_tipo = s.aus_tipo; r.aus_subtipo = s.aus_subtipo; r.aus_desde = s.aus_desde; r.aus_hasta = s.aus_hasta; r.aus_horas = s.aus_horas;
    r.detalle = `${ETIQUETA_AUSENCIA[s.aus_tipo] || s.aus_tipo}${s.aus_subtipo ? ' · ' + (ETIQUETA_SUBTIPO[s.aus_subtipo] || s.aus_subtipo) : ''} · ${s.aus_desde}${s.aus_hasta && s.aus_hasta !== s.aus_desde ? ' a ' + s.aus_hasta : ''}${s.aus_horas ? ' (' + s.aus_horas + ')' : ''}`;
  }
  return r;
}

// Saldo de días de vacaciones y asuntos propios del año en curso.
// "Usados" = días naturales de las ausencias APROBADAS de ese tipo este año.
function diasEntre(desde, hasta) {
  const a = new Date(desde + 'T00:00:00Z'), b = new Date((hasta || desde) + 'T00:00:00Z');
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}
export function getSaldoAusencias(empleadoId) {
  const emp = db.prepare('SELECT dias_vacaciones, dias_asuntos FROM empleados WHERE id = ?').get(empleadoId) || {};
  const anio = hoyLocal().slice(0, 4);
  const usados = (tipo) => {
    const rows = db.prepare(`SELECT aus_desde, aus_hasta FROM solicitudes
      WHERE empleado_id = ? AND clase = 'ausencia' AND estado = 'aprobada' AND aus_tipo = ? AND aus_desde LIKE ?`)
      .all(empleadoId, tipo, anio + '-%');
    return rows.reduce((s, r) => s + diasEntre(r.aus_desde, r.aus_hasta), 0);
  };
  const totalVac = emp.dias_vacaciones ?? 22, totalAsu = emp.dias_asuntos ?? 0;
  const uVac = usados('vacaciones'), uAsu = usados('asuntos_propios');
  return {
    anio,
    vacaciones: { total: totalVac, usados: uVac, restantes: Math.max(0, totalVac - uVac) },
    asuntos_propios: { total: totalAsu, usados: uAsu, restantes: Math.max(0, totalAsu - uAsu) },
  };
}

// Formatea segundos como "Hh Mm".
export function fmtDuracion(seg) {
  seg = Math.max(0, Math.round(seg));
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
