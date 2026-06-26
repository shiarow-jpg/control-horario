// Configuracion central de la aplicacion.
// El secreto HMAC (para firmar cookies y la cadena de hashes) se genera una
// sola vez y se guarda en data/secret.key. NO se debe borrar ni versionar:
// si se pierde, las cookies de dispositivo dejan de validar (se vuelven a
// autorizar) pero la cadena de hashes de los fichajes sigue siendo verificable.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_DIR = join(ROOT, 'data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const SECRET_FILE = join(DATA_DIR, 'secret.key');
function loadOrCreateSecret() {
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  // Empresa que aparece en la cabecera y los informes PDF.
  // Se configura por despliegue con variables de entorno (white-label).
  empresa: {
    nombre: process.env.EMPRESA_NOMBRE || 'Control Horario',
    cif: process.env.EMPRESA_CIF || '',
    direccion: process.env.EMPRESA_DIR || '',
  },
  secret: loadOrCreateSecret(),
  dbFile: join(DATA_DIR, 'fichaje.db'),
  // Anos de conservacion legal (Art. 34.9 ET => 4 anos).
  retencionAnios: 4,
  // Vida de la cookie de dispositivo autorizado (1 ano).
  deviceCookieMaxAge: 365 * 24 * 60 * 60 * 1000,
  // Vida de la sesion de admin (8 horas).
  adminCookieMaxAge: 8 * 60 * 60 * 1000,
  // Si true, ademas de la cookie de dispositivo se exige que la IP coincida
  // con la registrada al autorizar (refuerzo de "solo estos 2 PCs").
  // Por defecto OFF: la cookie firmada ya impide fichar desde un movil. Se
  // puede activar (ENFORCE_DEVICE_IP=true) si la IP publica de la tienda es fija.
  enforceDeviceIp: process.env.ENFORCE_DEVICE_IP === 'true',
  // Zona horaria para mostrar/calcular (Canarias).
  timezone: process.env.TZ || 'Atlantic/Canary',
};
