// Rutas del EMPLEADO para crear solicitudes (correccion de fichaje / ausencia)
// y consultar las suyas. Protegidas por dispositivo autorizado + PIN propio.
import { Router } from 'express';
import { db } from '../db.js';
import { checkSecret } from '../security.js';
import { requireDevice } from '../auth.js';
import { TIPOS_MARCAJE, TIPOS_AUSENCIA, SUBTIPOS_PERMISO, formatear, getSaldoAusencias } from '../jornada.js';

export const solicitudesRouter = Router();
solicitudesRouter.use(requireDevice);

function autenticar(req, res) {
  const emp = db.prepare('SELECT * FROM empleados WHERE id = ? AND activo = 1').get(Number(req.body?.empleado_id));
  if (!emp) { res.status(404).json({ error: 'empleado_no_encontrado' }); return null; }
  if (!checkSecret(req.body?.pin, emp.pin_hash)) { res.status(401).json({ error: 'pin_incorrecto' }); return null; }
  return emp;
}

const insertSolic = db.prepare(`INSERT INTO solicitudes
  (empleado_id, clase, estado, corr_accion, corr_tipo, corr_ts, corr_ref_id,
   aus_tipo, aus_subtipo, aus_desde, aus_hasta, aus_horas, motivo, creada_en)
  VALUES (@empleado_id, @clase, 'pendiente', @corr_accion, @corr_tipo, @corr_ts, @corr_ref_id,
   @aus_tipo, @aus_subtipo, @aus_desde, @aus_hasta, @aus_horas, @motivo, @creada_en)`);

function base(emp) {
  return {
    empleado_id: emp.id, clase: null, corr_accion: null, corr_tipo: null, corr_ts: null, corr_ref_id: null,
    aus_tipo: null, aus_subtipo: null, aus_desde: null, aus_hasta: null, aus_horas: null,
    motivo: null, creada_en: new Date().toISOString(),
  };
}

// Solicitud de CORRECCION de fichaje (anadir un marcaje olvidado o anular uno erroneo).
solicitudesRouter.post('/correccion', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  const { accion, motivo } = req.body || {};
  if (!String(motivo || '').trim()) return res.status(400).json({ error: 'motivo_requerido' });
  const row = { ...base(emp), clase: 'correccion', corr_accion: accion, motivo: String(motivo).trim() };

  if (accion === 'anadir') {
    if (!TIPOS_MARCAJE.includes(req.body?.tipo)) return res.status(400).json({ error: 'tipo_invalido' });
    const t = new Date(req.body?.ts);
    if (isNaN(t.getTime())) return res.status(400).json({ error: 'fecha_invalida' });
    row.corr_tipo = req.body.tipo;
    row.corr_ts = t.toISOString();
  } else if (accion === 'anular') {
    const ev = db.prepare(`SELECT id FROM eventos WHERE id = ? AND empleado_id = ?
      AND tipo IN ('entrada','salida','inicio_pausa','fin_pausa')`).get(Number(req.body?.ref_id), emp.id);
    if (!ev) return res.status(404).json({ error: 'marcaje_no_encontrado' });
    row.corr_ref_id = ev.id;
  } else {
    return res.status(400).json({ error: 'accion_invalida' });
  }
  const info = insertSolic.run(row);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Solicitud de AUSENCIA (vacaciones, permiso, etc.).
solicitudesRouter.post('/ausencia', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  const { aus_tipo, aus_subtipo, aus_desde, aus_hasta, aus_horas, motivo } = req.body || {};
  if (!TIPOS_AUSENCIA.includes(aus_tipo)) return res.status(400).json({ error: 'tipo_ausencia_invalido' });
  if (aus_tipo === 'permiso_retribuido' && aus_subtipo && !SUBTIPOS_PERMISO.includes(aus_subtipo)) {
    return res.status(400).json({ error: 'subtipo_invalido' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(aus_desde || ''))) return res.status(400).json({ error: 'fecha_desde_invalida' });
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(aus_hasta || '')) ? aus_hasta : aus_desde;
  if (hasta < aus_desde) return res.status(400).json({ error: 'rango_invalido' });
  if ((aus_tipo === 'otro') && !String(motivo || '').trim()) return res.status(400).json({ error: 'motivo_requerido' });

  const row = {
    ...base(emp), clase: 'ausencia',
    aus_tipo, aus_subtipo: aus_subtipo || null, aus_desde, aus_hasta: hasta,
    aus_horas: String(aus_horas || '').trim() || null, motivo: String(motivo || '').trim() || null,
  };
  const info = insertSolic.run(row);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Saldo de días de vacaciones y asuntos propios del empleado.
solicitudesRouter.post('/saldo', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  res.json(getSaldoAusencias(emp.id));
});

// Listar las solicitudes del propio empleado.
solicitudesRouter.post('/mias', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  const rows = db.prepare('SELECT * FROM solicitudes WHERE empleado_id = ? ORDER BY creada_en DESC LIMIT 100').all(emp.id);
  res.json({ solicitudes: rows.map(formatear) });
});
