// Tests del vigilante de jornadas (avisos de exceso + cierre automático).
// Usa una base de datos AISLADA en un directorio temporal (FICHAJE_DATA_DIR),
// nunca la de data/. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FICHAJE_DATA_DIR = mkdtempSync(join(tmpdir(), 'fichaje-test-'));
// No fijamos TZ: config usa 'Atlantic/Canary' por defecto y los tests calculan
// los instantes con instanteLocal, así que son deterministas en cualquier máquina.

const { db, appendEvento, verificarCadena } = await import('../src/db.js');
const { revisarJornadas, instanteLocal, getJornadaAbierta } = await import('../src/vigilante.js');
const { getEstado, resumenHoy } = await import('../src/jornada.js');

function nuevoEmpleado(nombre) {
  return Number(db.prepare(
    "INSERT INTO empleados (nombre, pin_hash, regimen, activo, creado_en) VALUES (?, 'x', 'completa', 1, ?)"
  ).run(nombre, new Date().toISOString()).lastInsertRowid);
}
const ficha = (empleado_id, tipo, cuando) =>
  appendEvento({ empleado_id, tipo, ts_efectivo: cuando.toISOString() });
const avisosDe = (id, tipo) =>
  db.prepare('SELECT * FROM avisos WHERE empleado_id = ? AND tipo = ?').all(id, tipo);
const salidasDe = (id) =>
  db.prepare("SELECT * FROM eventos WHERE empleado_id = ? AND tipo = 'salida'").all(id);

test('instanteLocal convierte la hora canaria a UTC (verano e invierno)', () => {
  // Agosto: Canarias en horario de verano (UTC+1) → 22:30 local = 21:30Z.
  assert.equal(instanteLocal('2026-08-30', '22:30').toISOString(), '2026-08-30T21:30:00.000Z');
  // Enero: horario de invierno (UTC+0) → 22:30 local = 22:30Z.
  assert.equal(instanteLocal('2026-01-15', '22:30').toISOString(), '2026-01-15T22:30:00.000Z');
});

test('avisa una sola vez cuando una jornada supera las 12 horas', () => {
  const id = nuevoEmpleado('Exceso Pérez');
  ficha(id, 'entrada', instanteLocal('2026-08-25', '08:00'));
  const ahora = instanteLocal('2026-08-25', '21:00'); // 13 h después, antes del cierre

  const r1 = revisarJornadas(ahora);
  assert.equal(r1.avisosExceso, 1);
  assert.equal(avisosDe(id, 'exceso_jornada').length, 1);
  assert.match(avisosDe(id, 'exceso_jornada')[0].mensaje, /Exceso Pérez.*12 h/);

  const r2 = revisarJornadas(ahora); // segunda pasada: no duplica
  assert.equal(r2.avisosExceso, 0);
  assert.equal(avisosDe(id, 'exceso_jornada').length, 1);
  // Aún no son las 22:30 de su día: no se cierra.
  assert.equal(getEstado(id).estado, 'trabajando');
});

test('cierra a las 22:30 locales una jornada olvidada (estado trabajando)', () => {
  const id = nuevoEmpleado('Olvido García');
  ficha(id, 'entrada', instanteLocal('2026-08-26', '10:00'));

  const r = revisarJornadas(instanteLocal('2026-08-27', '09:00')); // a la mañana siguiente
  assert.ok(r.cierres >= 1);
  const salidas = salidasDe(id);
  assert.equal(salidas.length, 1);
  assert.equal(salidas[0].ts_efectivo, instanteLocal('2026-08-26', '22:30').toISOString());
  assert.equal(salidas[0].origen, 'auto');
  assert.equal(salidas[0].autor, 'sistema');
  assert.equal(getEstado(id).estado, 'fuera');
  assert.equal(avisosDe(id, 'cierre_automatico').length, 1);
  // Y no vuelve a cerrar en la siguiente pasada.
  revisarJornadas(instanteLocal('2026-08-27', '09:01'));
  assert.equal(salidasDe(id).length, 1);
});

test('cierra también si el empleado quedó en pausa (fin_pausa + salida)', () => {
  const id = nuevoEmpleado('Pausa López');
  ficha(id, 'entrada', instanteLocal('2026-08-26', '10:00'));
  ficha(id, 'inicio_pausa', instanteLocal('2026-08-26', '14:00'));

  revisarJornadas(instanteLocal('2026-08-27', '09:00'));
  const eventos = db.prepare("SELECT tipo, ts_efectivo FROM eventos WHERE empleado_id = ? AND origen = 'auto' ORDER BY seq").all(id);
  assert.deepEqual(eventos.map(e => e.tipo), ['fin_pausa', 'salida']);
  assert.equal(getEstado(id).estado, 'fuera');
});

test('una entrada posterior a la hora de cierre se cierra al día siguiente', () => {
  const id = nuevoEmpleado('Nocturno Ruiz');
  ficha(id, 'entrada', instanteLocal('2026-08-26', '22:45')); // caso raro: tras el cierre

  revisarJornadas(instanteLocal('2026-08-27', '09:00'));
  assert.equal(salidasDe(id).length, 0, 'no debe cerrar antes del cierre del día siguiente');

  revisarJornadas(instanteLocal('2026-08-27', '23:00'));
  const salidas = salidasDe(id);
  assert.equal(salidas.length, 1);
  assert.equal(salidas[0].ts_efectivo, instanteLocal('2026-08-27', '22:30').toISOString());
});

test('una jornada normal en curso no genera avisos ni cierres', () => {
  const id = nuevoEmpleado('Normal Díaz');
  ficha(id, 'entrada', instanteLocal('2026-08-26', '10:00'));

  revisarJornadas(instanteLocal('2026-08-26', '12:00')); // 2 h trabajadas
  assert.equal(getEstado(id).estado, 'trabajando');
  assert.equal(salidasDe(id).length, 0);
  assert.equal(avisosDe(id, 'exceso_jornada').length, 0);
  assert.deepEqual(getJornadaAbierta(id).estado, 'trabajando');
});

test('resumenHoy da el trabajo consolidado y el almuerzo del día', () => {
  const id = nuevoEmpleado('Crono Ruiz');
  ficha(id, 'entrada', instanteLocal('2026-08-20', '09:00'));
  ficha(id, 'inicio_pausa', instanteLocal('2026-08-20', '11:00'));
  ficha(id, 'fin_pausa', instanteLocal('2026-08-20', '11:30'));

  const r = resumenHoy(id, instanteLocal('2026-08-20', '13:00'));
  assert.equal(r.trabajadoSeg, 7200, '09:00 a 11:00 = 2 h ya cerradas');
  assert.equal(r.pausaSeg, 1800, '30 min de almuerzo registrados');
  // El tramo abierto (11:30 en adelante) NO se incluye a propósito: es el
  // navegador quien lo cuenta en vivo a partir de `desde`, sin pedir nada.
});

test('la cadena de hashes sigue íntegra tras los cierres automáticos', () => {
  const v = verificarCadena();
  assert.equal(v.ok, true);
});
