// Utilidades de seguridad: firma de tokens (cookies) y cadena de hashes.
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

// ----- Tokens firmados (para cookies de admin y de dispositivo) -----
// Formato: base64url(json).hmac  -> autocontenido y verificable sin sesion en BD.
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function sign(data) {
  return createHmac('sha256', config.secret).update(data).digest('base64url');
}

export function makeToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body);
  // Comparacion en tiempo constante.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ----- Hashes / PIN -----
export function sha256(str) {
  return createHash('sha256').update(str).digest('hex');
}

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

const SALT_ROUNDS = 10;
export function hashSecret(plain) {
  return bcrypt.hashSync(String(plain), SALT_ROUNDS);
}
export function checkSecret(plain, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(plain), hash);
  } catch {
    return false;
  }
}

// ----- Anti fuerza bruta -----
// Cuenta intentos fallidos por clave (p. ej. "pin:IP:empleado"). Tras MAX_FALLOS
// seguidos se bloquea la clave durante BLOQUEO_MS. En memoria: la app corre en
// un unico proceso y un reinicio (que vacia el contador) es un evento raro.
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const VENTANA_MS = 15 * 60 * 1000; // los fallos antiguos caducan
const fallos = new Map(); // clave -> { n, primero, hasta }

export function bloqueoActivo(clave) {
  const r = fallos.get(clave);
  if (!r) return 0;
  if (r.hasta && Date.now() < r.hasta) return Math.ceil((r.hasta - Date.now()) / 1000);
  if (Date.now() - r.primero > VENTANA_MS) fallos.delete(clave);
  return 0;
}

export function registrarFallo(clave) {
  const ahora = Date.now();
  const r = fallos.get(clave);
  if (!r || ahora - r.primero > VENTANA_MS) {
    fallos.set(clave, { n: 1, primero: ahora, hasta: 0 });
    return;
  }
  r.n += 1;
  if (r.n >= MAX_FALLOS) { r.hasta = ahora + BLOQUEO_MS; r.n = 0; r.primero = ahora; }
}

export function limpiarFallos(clave) {
  fallos.delete(clave);
}

// ----- Cadena de hashes (inalterabilidad de los fichajes) -----
// Cada evento encadena con el hash del anterior. Cambiar/borrar un evento
// rompe la cadena => detectable. Esto materializa la "garantia de
// invariabilidad" que exige el Art. 34.9 ET.
export function eventoHash({ seq, empleado_id, tipo, ts_efectivo, ts_servidor, ref_evento_id, motivo, hash_prev }) {
  const canonical = [
    seq,
    empleado_id,
    tipo,
    ts_efectivo,
    ts_servidor,
    ref_evento_id ?? '',
    motivo ?? '',
    hash_prev ?? '',
  ].join('|');
  return sha256(canonical);
}
