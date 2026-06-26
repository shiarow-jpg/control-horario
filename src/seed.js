// Datos de ejemplo para pruebas locales. NO usar en produccion.
// Uso: node src/seed.js
import { db, getConfig, setConfig } from './db.js';
import { hashSecret } from './security.js';

if (!getConfig('admin_hash')) {
  setConfig('admin_hash', hashSecret('admin123'));
  console.log('Admin creado con contrasena: admin123 (cambiala)');
}

const demo = ['Rubén Rodríguez', 'Laura Pérez', 'Carlos Gómez'];
const existe = db.prepare('SELECT COUNT(*) c FROM empleados').get().c;
if (existe === 0) {
  // Sin PIN: cada empleado crea el suyo la primera vez que ficha.
  const ins = db.prepare("INSERT INTO empleados (nombre, pin_hash, regimen, activo, creado_en) VALUES (?,'','completa',1,?)");
  for (const nombre of demo) ins.run(nombre, new Date().toISOString());
  console.log(`${demo.length} empleados de ejemplo creados (sin PIN: cada uno lo crea al fichar la 1ª vez)`);
} else {
  console.log('Ya habia empleados, no se crean de ejemplo.');
}
console.log('Listo.');
