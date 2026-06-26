// Middlewares de autenticacion: dispositivo autorizado y administrador.
import { config } from './config.js';
import { db } from './db.js';
import { verifyToken } from './security.js';

export function getClientIp(req) {
  // Detras de Nginx llega X-Forwarded-For; tomamos la primera IP real.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// Exige que la peticion venga de un dispositivo autorizado (cookie firmada
// + dispositivo activo en BD). Es el control principal "solo estos 2 PCs".
export function requireDevice(req, res, next) {
  const token = req.cookies?.disp;
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'device') {
    return res.status(401).json({ error: 'dispositivo_no_autorizado' });
  }
  const disp = db.prepare('SELECT * FROM dispositivos WHERE token_id = ? AND activo = 1').get(payload.tid);
  if (!disp) return res.status(401).json({ error: 'dispositivo_no_autorizado' });

  // Refuerzo opcional por IP (la red de la tienda). Secundario a la cookie.
  if (config.enforceDeviceIp && disp.ip) {
    if (getClientIp(req) !== disp.ip) {
      return res.status(403).json({ error: 'ip_no_autorizada' });
    }
  }
  req.dispositivo = disp;
  next();
}

// Indica si la peticion trae un dispositivo autorizado (sin bloquear).
export function deviceInfo(req) {
  const payload = verifyToken(req.cookies?.disp);
  if (!payload || payload.kind !== 'device') return null;
  return db.prepare('SELECT * FROM dispositivos WHERE token_id = ? AND activo = 1').get(payload.tid) || null;
}

// Exige sesion de administrador.
export function requireAdmin(req, res, next) {
  const payload = verifyToken(req.cookies?.adm);
  if (!payload || payload.kind !== 'admin') {
    return res.status(401).json({ error: 'admin_requerido' });
  }
  req.admin = true;
  next();
}

export function isAdmin(req) {
  const payload = verifyToken(req.cookies?.adm);
  return !!(payload && payload.kind === 'admin');
}
