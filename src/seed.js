// Datos de ejemplo para pruebas locales. NO usar en produccion.
// Uso: node src/seed.js
import { db, getConfig, setConfig } from './db.js';
import { hashSecret } from './security.js';

if (!getConfig('admin_hash')) {
  setConfig('admin_hash', hashSecret('admin123'));
  console.log('Admin creado con contrasena: admin123 (cambiala)');
}

const demo = [
  ['Rubén Rodríguez', '1234'],
  ['Laura Pérez', '2345'],
  ['Carlos Gómez', '3456'],
];
const existe = db.prepare('SELECT COUNT(*) c FROM empleados').get().c;
if (existe === 0) {
  const ins = db.prepare('INSERT INTO empleados (nombre, pin_hash, regimen, activo, creado_en) VALUES (?,?,?,1,?)');
  for (const [nombre, pin] of demo) ins.run(nombre, hashSecret(pin), 'completa', new Date().toISOString());
  console.log(`${demo.length} empleados de ejemplo creados (PINs: 1234, 2345, 3456)`);
} else {
  console.log('Ya habia empleados, no se crean de ejemplo.');
}
console.log('Listo.');
