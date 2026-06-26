// Reinicio para PUESTA EN PRODUCCIÓN: borra TODOS los datos (empleados,
// fichajes, dispositivos autorizados y configuración del admin), dejando la
// aplicación vacía. Tras ejecutarlo, en el próximo arranque la app pedirá
// "Configurar administrador" y no habrá ningún empleado: la empresa añade los
// suyos. Uso: node src/reset.js   (con el servidor PARADO)
import { existsSync, unlinkSync } from 'node:fs';
import { DATA_DIR } from './config.js';
import { join } from 'node:path';

const archivos = ['fichaje.db', 'fichaje.db-wal', 'fichaje.db-shm'];
let borrados = 0;
for (const f of archivos) {
  const ruta = join(DATA_DIR, f);
  if (existsSync(ruta)) { unlinkSync(ruta); borrados++; console.log('borrado:', f); }
}
console.log(borrados ? `\nBase de datos reiniciada. La app arrancará vacía (sin empleados) y pedirá configurar el administrador.`
                     : 'No había base de datos que borrar (ya estaba vacía).');
console.log('Nota: se conserva data/secret.key (no borrar).');
