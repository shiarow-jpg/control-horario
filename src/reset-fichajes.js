// Limpieza de DATOS DE USO conservando la configuración.
//
// Borra SOLO los marcajes (tabla `eventos`, el registro append-only) y las
// solicitudes (correcciones/ausencias). CONSERVA: empleados, dispositivos
// autorizados y la configuración del admin (contraseña, etc.).
//
// Pensado para "puesta a 0" antes de empezar a usarlo de verdad, cuando los
// fichajes existentes son solo una prueba/demo: los empleados ya están dados de
// alta y los PCs ya autorizados, y no quieres rehacer todo eso.
//
// Uso (con el servidor PARADO):
//   node src/reset-fichajes.js          -> muestra qué se borraría (simulacro)
//   node src/reset-fichajes.js --si     -> borra de verdad
//
// IMPORTANTE: la tabla `eventos` es la fuente legal inalterable. Vaciarla solo
// es admisible ANTES de la puesta en producción (datos de prueba). Haz copia de
// seguridad de data/fichaje.db antes de ejecutarlo.
import { db } from './db.js';

const confirmar = process.argv.includes('--si') || process.argv.includes('--yes');

const nEventos = db.prepare('SELECT COUNT(*) AS n FROM eventos').get().n;
const nSolic = db.prepare('SELECT COUNT(*) AS n FROM solicitudes').get().n;
const nEmpleados = db.prepare('SELECT COUNT(*) AS n FROM empleados').get().n;
const nDispositivos = db.prepare('SELECT COUNT(*) AS n FROM dispositivos').get().n;

console.log('Datos de USO a borrar:');
console.log(`  - fichajes (eventos):   ${nEventos}`);
console.log(`  - solicitudes:          ${nSolic}`);
console.log('Se CONSERVAN:');
console.log(`  - empleados:            ${nEmpleados}`);
console.log(`  - dispositivos autoriz: ${nDispositivos}`);
console.log('  - configuración del admin (contraseña, etc.)');

if (!confirmar) {
  console.log('\nSimulacro: no se ha borrado nada. Para borrar de verdad:');
  console.log('  node src/reset-fichajes.js --si');
  process.exit(0);
}

if (nEventos === 0 && nSolic === 0) {
  console.log('\nNo había datos de uso que borrar (ya estaba a 0).');
  process.exit(0);
}

// La cadena de hashes se reinicia sola: el próximo fichaje arrancará en seq 1
// con hash_prev = GENESIS (ver appendEvento en db.js).
db.exec('BEGIN');
try {
  db.exec('DELETE FROM eventos');
  db.exec('DELETE FROM solicitudes');
  // Reiniciar los contadores de id para que arranquen limpios desde 1.
  try { db.exec("DELETE FROM sqlite_sequence WHERE name IN ('eventos','solicitudes')"); } catch { /* sin sqlite_sequence */ }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nError al borrar; no se ha cambiado nada:', e.message);
  process.exit(1);
}

console.log('\nHecho. Datos de uso a 0. Empleados, dispositivos y admin intactos.');
console.log('La app está lista para empezar a fichar desde 0.');
