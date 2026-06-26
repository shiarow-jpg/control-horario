// Rutas de administracion. Protegidas por contrasena de admin (salvo el setup
// inicial y el estado). Aqui se gestionan empleados, dispositivos autorizados,
// correcciones (con motivo) e informes.
import { Router } from 'express';
import { db, appendEvento, getConfig, setConfig, verificarCadena } from '../db.js';
import { hashSecret, checkSecret, makeToken, randomId } from '../security.js';
import { config } from '../config.js';
import { requireAdmin, isAdmin, getClientIp } from '../auth.js';
import { getEmpleados, getEmpleado, getEstado, calcularJornada, fmtDuracion, ETIQUETA_TIPO,
  hoyLocal, inicioMesLocal, formatear, getCorrecciones, getAusencias } from '../jornada.js';
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
  const regimen = String(req.body?.regimen || 'completa');
  if (!nombre) return res.status(400).json({ error: 'nombre_requerido' });
  const dv = Math.max(0, parseInt(req.body?.dias_vacaciones) || 22);
  const da = Math.max(0, parseInt(req.body?.dias_asuntos) || 0);
  // Sin PIN: lo crea el propio empleado la primera vez que ficha (el admin no lo conoce).
  const info = db.prepare(`INSERT INTO empleados (nombre, pin_hash, regimen, activo, creado_en, dias_vacaciones, dias_asuntos)
              VALUES (?, '', ?, 1, ?, ?, ?)`).run(nombre, regimen, new Date().toISOString(), dv, da);
  res.json({ ok: true, id: info.lastInsertRowid });
});

adminRouter.post('/empleados/:id', requireAdmin, (req, res) => {
  const emp = getEmpleado(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'no_encontrado' });
  const nombre = req.body?.nombre != null ? String(req.body.nombre).trim() : emp.nombre;
  const regimen = req.body?.regimen != null ? String(req.body.regimen) : emp.regimen;
  const activo = req.body?.activo != null ? (req.body.activo ? 1 : 0) : emp.activo;
  const dv = req.body?.dias_vacaciones != null ? Math.max(0, parseInt(req.body.dias_vacaciones) || 0) : emp.dias_vacaciones;
  const da = req.body?.dias_asuntos != null ? Math.max(0, parseInt(req.body.dias_asuntos) || 0) : emp.dias_asuntos;
  db.prepare('UPDATE empleados SET nombre = ?, regimen = ?, activo = ?, dias_vacaciones = ?, dias_asuntos = ? WHERE id = ?')
    .run(nombre, regimen, activo, dv, da, emp.id);
  res.json({ ok: true });
});

// Restablecer PIN: el admin NO elige el valor, solo lo borra. El empleado
// tendra que crear uno nuevo la proxima vez que fiche (el admin nunca lo conoce).
adminRouter.post('/empleados/:id/reset-pin', requireAdmin, (req, res) => {
  const info = db.prepare("UPDATE empleados SET pin_hash = '' WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'no_encontrado' });
  res.json({ ok: true });
});

// ---- Solicitudes: el empleado pide (correccion/ausencia), el admin resuelve ----
// Las modificaciones NUNCA las inicia el admin; nacen de una solicitud del
// empleado. Al aprobar, queda en la cadena inalterable quien pidio y quien aprobo.
adminRouter.get('/solicitudes', requireAdmin, (req, res) => {
  const estado = req.query.estado || 'pendiente';
  const sql = `SELECT s.*, e.nombre AS empleado FROM solicitudes s JOIN empleados e ON e.id = s.empleado_id
    ${estado === 'todas' ? '' : 'WHERE s.estado = ?'}
    ORDER BY (s.estado = 'pendiente') DESC, s.creada_en DESC LIMIT 200`;
  const rows = estado === 'todas' ? db.prepare(sql).all() : db.prepare(sql).all(estado);
  res.json({ solicitudes: rows.map(s => ({ ...formatear(s), empleado: s.empleado })) });
});

adminRouter.post('/solicitudes/:id/resolver', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitudes WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'no_encontrada' });
  if (s.estado !== 'pendiente') return res.status(409).json({ error: 'ya_resuelta' });
  const decision = req.body?.decision;
  const nota = String(req.body?.nota || '').trim() || null;
  if (!['aprobar', 'denegar'].includes(decision)) return res.status(400).json({ error: 'decision_invalida' });

  const emp = getEmpleado(s.empleado_id);
  const firma = `solicitado por ${emp?.nombre || 'empleado'}, aprobado por administrador`;
  let eventoSeq = null;

  if (decision === 'aprobar') {
    if (s.clase === 'correccion' && s.corr_accion === 'anadir') {
      eventoSeq = appendEvento({ empleado_id: s.empleado_id, tipo: s.corr_tipo, ts_efectivo: s.corr_ts,
        motivo: `${s.motivo} · ${firma}`, autor: 'empleado', origen: 'solicitud', ip: getClientIp(req), dispositivo: 'admin' }).seq;
    } else if (s.clase === 'correccion' && s.corr_accion === 'anular') {
      const orig = db.prepare('SELECT id FROM eventos WHERE id = ?').get(s.corr_ref_id);
      if (!orig) return res.status(404).json({ error: 'marcaje_no_encontrado' });
      eventoSeq = appendEvento({ empleado_id: s.empleado_id, tipo: 'anulacion', ref_evento_id: orig.id,
        motivo: `${s.motivo} · ${firma}`, autor: 'empleado', origen: 'solicitud', ip: getClientIp(req), dispositivo: 'admin' }).seq;
    } else if (s.clase === 'ausencia') {
      const resumen = `${s.aus_tipo}${s.aus_subtipo ? '/' + s.aus_subtipo : ''} ${s.aus_desde}${s.aus_hasta !== s.aus_desde ? ' a ' + s.aus_hasta : ''}${s.aus_horas ? ' (' + s.aus_horas + ')' : ''}${s.motivo ? ' · ' + s.motivo : ''}`;
      eventoSeq = appendEvento({ empleado_id: s.empleado_id, tipo: 'ausencia', ts_efectivo: s.aus_desde + 'T00:00:00.000Z',
        motivo: `${resumen} · ${firma}`, autor: 'empleado', origen: 'solicitud', ip: getClientIp(req), dispositivo: 'admin' }).seq;
    }
  }

  db.prepare('UPDATE solicitudes SET estado = ?, resuelta_en = ?, nota_admin = ?, evento_id = ? WHERE id = ?')
    .run(decision === 'aprobar' ? 'aprobada' : 'denegada', new Date().toISOString(), nota, eventoSeq, s.id);
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
      marcajes: d.marcajes.map(m => ({ tipo: m.tipo, ts: m.ts_efectivo, origen: m.origen, id: m.id, motivo: m.motivo })),
    })),
    correcciones: getCorrecciones(emp.id, desde, hasta),
    ausencias: getAusencias(emp.id, desde, hasta).map(a => ({ ts: a.ts_efectivo, motivo: a.motivo })),
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
