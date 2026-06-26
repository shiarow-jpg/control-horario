// Rutas de administracion. Protegidas por contrasena de admin (salvo el setup
// inicial y el estado). Aqui se gestionan empleados, dispositivos autorizados,
// correcciones (con motivo) e informes.
import { Router } from 'express';
import { db, appendEvento, getConfig, setConfig, verificarCadena } from '../db.js';
import { hashSecret, checkSecret, makeToken, randomId } from '../security.js';
import { config } from '../config.js';
import { requireAdmin, isAdmin, getClientIp } from '../auth.js';
import { getEmpleados, getEmpleado, getEstado, calcularJornada, fmtDuracion, ETIQUETA_TIPO, hoyLocal, inicioMesLocal } from '../jornada.js';
import { generarInformePDF } from '../pdf.js';

export const adminRouter = Router();

const cookieBase = { httpOnly: true, sameSite: 'lax', path: '/' };
// Marca la cookie como Secure cuando la peticion llega por HTTPS (detras de Nginx,
// con trust proxy, req.secure refleja X-Forwarded-Proto). En local HTTP no la marca.
const cookieOpts = (req, extra = {}) => ({ ...cookieBase, secure: !!req.secure, ...extra });

// ---- Estado / setup / login ----
adminRouter.get('/estado', (req, res) => {
  res.json({ configurado: !!getConfig('admin_hash'), logged: isAdmin(req) });
});

adminRouter.post('/setup', (req, res) => {
  if (getConfig('admin_hash')) return res.status(409).json({ error: 'ya_configurado' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'password_corta' });
  setConfig('admin_hash', hashSecret(password));
  res.json({ ok: true });
});

adminRouter.post('/login', (req, res) => {
  const hash = getConfig('admin_hash');
  if (!hash) return res.status(409).json({ error: 'no_configurado' });
  if (!checkSecret(req.body?.password, hash)) return res.status(401).json({ error: 'password_incorrecta' });
  const token = makeToken({ kind: 'admin', exp: Date.now() + config.adminCookieMaxAge });
  res.cookie('adm', token, cookieOpts(req, { maxAge: config.adminCookieMaxAge }));
  res.json({ ok: true });
});

adminRouter.post('/logout', (req, res) => {
  res.clearCookie('adm', cookieOpts(req));
  res.json({ ok: true });
});

adminRouter.post('/cambiar-password', requireAdmin, (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!checkSecret(actual, getConfig('admin_hash'))) return res.status(401).json({ error: 'password_incorrecta' });
  if (!nueva || String(nueva).length < 6) return res.status(400).json({ error: 'password_corta' });
  setConfig('admin_hash', hashSecret(nueva));
  res.json({ ok: true });
});

// ---- Dispositivos autorizados (los 2 PCs) ----
adminRouter.post('/autorizar-dispositivo', requireAdmin, (req, res) => {
  const nombre = String(req.body?.nombre || '').trim() || 'PC sin nombre';
  const token_id = randomId(16);
  db.prepare(`INSERT INTO dispositivos (nombre, token_id, ip, activo, autorizado_en)
              VALUES (?, ?, ?, 1, ?)`).run(nombre, token_id, getClientIp(req), new Date().toISOString());
  const token = makeToken({ kind: 'device', tid: token_id, exp: Date.now() + config.deviceCookieMaxAge });
  res.cookie('disp', token, cookieOpts(req, { maxAge: config.deviceCookieMaxAge }));
  res.json({ ok: true, nombre });
});

adminRouter.get('/dispositivos', requireAdmin, (req, res) => {
  res.json({ dispositivos: db.prepare('SELECT id, nombre, ip, activo, autorizado_en FROM dispositivos ORDER BY autorizado_en DESC').all() });
});

adminRouter.post('/dispositivos/:id/revocar', requireAdmin, (req, res) => {
  db.prepare('UPDATE dispositivos SET activo = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Empleados ----
adminRouter.get('/empleados', requireAdmin, (req, res) => {
  const empleados = getEmpleados().map(e => ({ ...e, estado: getEstado(e.id).estado }));
  res.json({ empleados });
});

adminRouter.post('/empleados', requireAdmin, (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const pin = String(req.body?.pin || '');
  const regimen = String(req.body?.regimen || 'completa');
  if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin_formato' });
  const info = db.prepare(`INSERT INTO empleados (nombre, pin_hash, regimen, activo, creado_en)
              VALUES (?, ?, ?, 1, ?)`).run(nombre, hashSecret(pin), regimen, new Date().toISOString());
  res.json({ ok: true, id: info.lastInsertRowid });
});

adminRouter.post('/empleados/:id', requireAdmin, (req, res) => {
  const emp = getEmpleado(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'no_encontrado' });
  const nombre = req.body?.nombre != null ? String(req.body.nombre).trim() : emp.nombre;
  const regimen = req.body?.regimen != null ? String(req.body.regimen) : emp.regimen;
  const activo = req.body?.activo != null ? (req.body.activo ? 1 : 0) : emp.activo;
  db.prepare('UPDATE empleados SET nombre = ?, regimen = ?, activo = ? WHERE id = ?')
    .run(nombre, regimen, activo, emp.id);
  res.json({ ok: true });
});

adminRouter.post('/empleados/:id/pin', requireAdmin, (req, res) => {
  const pin = String(req.body?.pin || '');
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin_formato' });
  const info = db.prepare('UPDATE empleados SET pin_hash = ? WHERE id = ?').run(hashSecret(pin), Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'no_encontrado' });
  res.json({ ok: true });
});

// ---- Correcciones (siempre con motivo; nunca se edita/borra el original) ----
// Anular un marcaje erroneo: crea un evento 'anulacion' que referencia al original.
adminRouter.post('/anular', requireAdmin, (req, res) => {
  const eventoId = Number(req.body?.evento_id);
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'motivo_requerido' });
  const ev = db.prepare("SELECT * FROM eventos WHERE id = ? AND tipo IN ('entrada','salida','inicio_pausa','fin_pausa')").get(eventoId);
  if (!ev) return res.status(404).json({ error: 'evento_no_encontrado' });
  appendEvento({
    empleado_id: ev.empleado_id, tipo: 'anulacion', ref_evento_id: ev.id,
    motivo, autor: 'admin', origen: 'manual', ip: getClientIp(req), dispositivo: 'admin',
  });
  res.json({ ok: true });
});

// Anadir un marcaje manualmente (p.ej. olvido de fichaje). Requiere motivo.
adminRouter.post('/marcaje-manual', requireAdmin, (req, res) => {
  const { empleado_id, tipo, ts_efectivo, motivo } = req.body || {};
  if (!['entrada', 'salida', 'inicio_pausa', 'fin_pausa'].includes(tipo)) return res.status(400).json({ error: 'tipo_invalido' });
  if (!String(motivo || '').trim()) return res.status(400).json({ error: 'motivo_requerido' });
  const emp = getEmpleado(Number(empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  const t = new Date(ts_efectivo);
  if (isNaN(t.getTime())) return res.status(400).json({ error: 'fecha_invalida' });
  appendEvento({
    empleado_id: emp.id, tipo, ts_efectivo: t.toISOString(),
    motivo: String(motivo).trim(), autor: 'admin', origen: 'manual', ip: getClientIp(req), dispositivo: 'admin',
  });
  res.json({ ok: true });
});

// Eventos en bruto (auditoria), incluidos anulados y anulaciones.
adminRouter.get('/eventos/:empleadoId', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM eventos WHERE empleado_id = ? ORDER BY ts_efectivo DESC, seq DESC LIMIT 500')
    .all(Number(req.params.empleadoId));
  res.json({ eventos: rows.map(e => ({ ...e, etiqueta: ETIQUETA_TIPO[e.tipo] })) });
});

// ---- Informes ----
adminRouter.get('/informe', requireAdmin, (req, res) => {
  const emp = getEmpleado(Number(req.query.empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  const desde = (req.query.desde || inicioMesLocal());
  const hasta = (req.query.hasta || hoyLocal()) + 'T23:59:59.999Z';
  const j = calcularJornada(emp.id, desde, hasta);
  res.json({
    empleado: emp.nombre, desde, hasta,
    totalTrabajado: fmtDuracion(j.totalTrabajadoSeg),
    totalPausa: fmtDuracion(j.totalPausaSeg), abierto: j.abierto,
    dias: j.dias.map(d => ({
      fecha: d.fecha, trabajado: fmtDuracion(d.trabajadoSeg), pausa: fmtDuracion(d.pausaSeg),
      marcajes: d.marcajes.map(m => ({ tipo: m.tipo, ts: m.ts_efectivo, origen: m.origen, id: m.id })),
    })),
  });
});

adminRouter.get('/informe/pdf', requireAdmin, (req, res) => {
  const emp = getEmpleado(Number(req.query.empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  const desde = (req.query.desde || inicioMesLocal());
  const hasta = (req.query.hasta || hoyLocal()) + 'T23:59:59.999Z';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fichajes-${emp.nombre.replace(/\s+/g, '_')}-${desde}.pdf"`);
  generarInformePDF(res, { empleado: emp, desde, hasta });
});

// ---- Integridad de la cadena ----
adminRouter.get('/integridad', requireAdmin, (req, res) => {
  res.json(verificarCadena());
});
