// Rutas del empleado: consulta y descarga de SUS propios registros (Art. 34.9:
// el trabajador debe poder consultar y obtener copia). Requiere PIN propio.
import { Router } from 'express';
import { db } from '../db.js';
import { checkSecret } from '../security.js';
import { requireDevice } from '../auth.js';
import { calcularJornada, fmtDuracion, getEmpleado, hoyLocal, inicioMesLocal } from '../jornada.js';
import { generarInformePDF } from '../pdf.js';

export const empleadoRouter = Router();
empleadoRouter.use(requireDevice);

function autenticar(req, res) {
  const { empleado_id, pin } = req.body || {};
  const emp = db.prepare('SELECT * FROM empleados WHERE id = ?').get(Number(empleado_id));
  if (!emp) { res.status(404).json({ error: 'empleado_no_encontrado' }); return null; }
  if (!checkSecret(pin, emp.pin_hash)) { res.status(401).json({ error: 'pin_incorrecto' }); return null; }
  return emp;
}

empleadoRouter.post('/consulta', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  const desde = (req.body?.desde || inicioMesLocal());
  const hasta = (req.body?.hasta || hoyLocal()) + 'T23:59:59.999Z';
  const j = calcularJornada(emp.id, desde, hasta);
  res.json({
    empleado: emp.nombre,
    desde, hasta,
    totalTrabajado: fmtDuracion(j.totalTrabajadoSeg),
    totalPausa: fmtDuracion(j.totalPausaSeg),
    abierto: j.abierto,
    dias: j.dias.map(d => ({
      fecha: d.fecha,
      trabajado: fmtDuracion(d.trabajadoSeg),
      pausa: fmtDuracion(d.pausaSeg),
      marcajes: d.marcajes.map(m => ({ tipo: m.tipo, ts: m.ts_efectivo, origen: m.origen })),
    })),
  });
});

empleadoRouter.post('/pdf', (req, res) => {
  const emp = autenticar(req, res);
  if (!emp) return;
  const desde = (req.body?.desde || inicioMesLocal());
  const hasta = (req.body?.hasta || hoyLocal()) + 'T23:59:59.999Z';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fichajes-${emp.nombre.replace(/\s+/g, '_')}-${desde}.pdf"`);
  generarInformePDF(res, { empleado: getEmpleado(emp.id), desde, hasta });
});
