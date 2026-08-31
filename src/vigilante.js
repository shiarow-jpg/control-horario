// Vigilante de jornadas olvidadas. Corre en el servidor cada minuto y:
//  1) Crea un aviso para el administrador si un empleado lleva más de
//     config.avisoHorasMax horas con la jornada abierta (olvidó fichar salida).
//  2) A partir de config.cierreAutoHora (hora local de la empresa) cierra
//     automáticamente toda jornada que siga abierta: añade los marcajes de
//     cierre a la cadena inalterable con origen 'auto' y autor 'sistema',
//     con motivo explícito. El empleado puede pedir corrección si la hora
//     real de salida fue otra (flujo de solicitudes ya existente).
// También cubre el arranque: si el servidor estuvo apagado a la hora de
// cierre, al volver cierra las jornadas pendientes con la hora que tocaba.
import { db, appendEvento } from './db.js';
import { config } from './config.js';
import { getEmpleados, getMarcajes, TRANSICIONES, diaLocal, instanteLocal } from './jornada.js';

// El helper de hora local vive en jornada.js (lo comparten el vigilante y el
// resumen del día); se reexporta para quien ya lo importaba de aquí.
export { instanteLocal };

const diaSiguiente = (dia) => new Date(new Date(dia + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);

const fmtHoraLocal = new Intl.DateTimeFormat('es-ES', {
  timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
});

// Jornada abierta de un empleado: estado actual y la entrada que la abrió.
export function getJornadaAbierta(empleadoId) {
  let estado = 'fuera';
  let entradaTs = null;
  for (const m of getMarcajes(empleadoId)) {
    const siguiente = TRANSICIONES[estado]?.[m.tipo];
    if (!siguiente) continue;
    if (estado === 'fuera' && m.tipo === 'entrada') entradaTs = m.ts_efectivo;
    estado = siguiente;
  }
  return estado === 'fuera' ? null : { estado, entradaTs };
}

const insAviso = db.prepare(`INSERT OR IGNORE INTO avisos (tipo, empleado_id, clave, mensaje, creado_en)
                             VALUES (?, ?, ?, ?, ?)`);
export function crearAviso({ tipo, empleado_id = null, clave, mensaje }) {
  return insAviso.run(tipo, empleado_id, clave, mensaje, new Date().toISOString()).changes > 0;
}

// Revisión completa. `ahora` es inyectable para poder probarla de forma determinista.
export function revisarJornadas(ahora = new Date()) {
  const resultado = { avisosExceso: 0, cierres: 0 };
  for (const emp of getEmpleados({ soloActivos: true })) {
    const j = getJornadaAbierta(emp.id);
    if (!j || !j.entradaTs) continue;
    const entradaMs = new Date(j.entradaTs).getTime();

    // 1) Jornada demasiado larga (una vez por jornada/día de entrada).
    const horas = (ahora.getTime() - entradaMs) / 3600000;
    if (horas >= config.avisoHorasMax) {
      const creado = crearAviso({
        tipo: 'exceso_jornada', empleado_id: emp.id,
        clave: `exceso:${emp.id}:${diaLocal(j.entradaTs)}`,
        mensaje: `${emp.nombre} lleva más de ${config.avisoHorasMax} h con la jornada abierta (entrada a las ${fmtHoraLocal.format(new Date(j.entradaTs))}). Probablemente olvidó fichar la salida.`,
      });
      if (creado) resultado.avisosExceso++;
    }

    // 2) Cierre automático a la hora límite local.
    if (!config.cierreAutoHora) continue;
    let dia = diaLocal(j.entradaTs);
    let cierre = instanteLocal(dia, config.cierreAutoHora);
    // Si la entrada fue después de la hora de cierre (caso raro), toca el día siguiente.
    while (cierre.getTime() <= entradaMs) { dia = diaSiguiente(dia); cierre = instanteLocal(dia, config.cierreAutoHora); }
    if (ahora.getTime() < cierre.getTime()) continue;

    const ts_efectivo = cierre.toISOString();
    const motivo = `Cierre automático: la jornada seguía abierta a la hora límite (${config.cierreAutoHora}) sin salida fichada`;
    const base = { empleado_id: emp.id, ts_efectivo, origen: 'auto', autor: 'sistema', dispositivo: 'servidor', motivo };
    if (j.estado === 'en_pausa') appendEvento({ ...base, tipo: 'fin_pausa' });
    appendEvento({ ...base, tipo: 'salida' });
    resultado.cierres++;
    crearAviso({
      tipo: 'cierre_automatico', empleado_id: emp.id,
      clave: `cierre:${emp.id}:${dia}`,
      mensaje: `Jornada de ${emp.nombre} cerrada automáticamente a las ${config.cierreAutoHora} del ${dia}: no fichó la salida. El marcaje figura como "auto" y puede corregirse con una solicitud.`,
    });
  }
  return resultado;
}

// Arranca la revisión periódica (cada minuto) y hace una pasada inmediata
// para ponerse al día si el servidor estuvo apagado.
export function iniciarVigilante() {
  const tick = () => { try { revisarJornadas(); } catch (e) { console.error('vigilante:', e); } };
  tick();
  const timer = setInterval(tick, 60 * 1000);
  timer.unref?.(); // no impide que el proceso termine (tests, scripts)
  return timer;
}
