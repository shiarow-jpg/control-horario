// Rutas de fichaje (pantalla principal de kiosko). Protegidas por dispositivo.
import { Router } from 'express';
import { db, appendEvento } from '../db.js';
import { checkSecret, hashSecret } from '../security.js';
import { requireDevice, getClientIp } from '../auth.js';
import { getEmpleados, getEstado, marcajesPermitidos, TIPOS_MARCAJE, ETIQUETA_TIPO } from '../jornada.js';

export const fichajeRouter = Router();
fichajeRouter.use(requireDevice);

// Lista de empleados activos con su estado actual (para pintar la rejilla).
fichajeRouter.get('/empleados', (req, res) => {
  const empleados = getEmpleados({ soloActivos: true }).map(e => {
    const { estado, desde } = getEstado(e.id);
    return { id: e.id, nombre: e.nombre, estado, desde, pin_configurado: !!e.pin_configurado };
  });
  res.json({ empleados, dispositivo: req.dispositivo.nombre });
});

// Crear el PIN por primera vez (lo hace el propio empleado; el admin no lo conoce).
// Solo se permite si el empleado aun no tiene PIN configurado.
fichajeRouter.post('/configurar-pin', (req, res) => {
  const emp = db.prepare('SELECT * FROM empleados WHERE id = ? AND activo = 1').get(Number(req.body?.empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  if (emp.pin_hash) return res.status(409).json({ error: 'pin_ya_configurado' });
  const { pin, pin2 } = req.body || {};
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'pin_formato' });
  if (pin !== pin2) return res.status(400).json({ error: 'pin_no_coincide' });
  db.prepare('UPDATE empleados SET pin_hash = ? WHERE id = ?').run(hashSecret(pin), emp.id);
  res.json({ ok: true });
});

// Verificar el PIN (puerta de entrada de "Mi cuenta").
fichajeRouter.post('/verificar-pin', (req, res) => {
  const emp = db.prepare('SELECT id, nombre, pin_hash FROM empleados WHERE id = ? AND activo = 1').get(Number(req.body?.empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  if (!emp.pin_hash) return res.status(409).json({ error: 'pin_no_configurado' });
  if (!checkSecret(req.body?.pin, emp.pin_hash)) return res.status(401).json({ error: 'pin_incorrecto' });
  res.json({ ok: true, nombre: emp.nombre });
});

// Cambiar el PIN (requiere el PIN actual). Lo hace el propio empleado.
fichajeRouter.post('/cambiar-pin', (req, res) => {
  const emp = db.prepare('SELECT * FROM empleados WHERE id = ? AND activo = 1').get(Number(req.body?.empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  if (!checkSecret(req.body?.pin_actual, emp.pin_hash)) return res.status(401).json({ error: 'pin_incorrecto' });
  const { nuevo, nuevo2 } = req.body || {};
  if (!/^\d{4}$/.test(String(nuevo || ''))) return res.status(400).json({ error: 'pin_formato' });
  if (nuevo !== nuevo2) return res.status(400).json({ error: 'pin_no_coincide' });
  db.prepare('UPDATE empleados SET pin_hash = ? WHERE id = ?').run(hashSecret(nuevo), emp.id);
  res.json({ ok: true });
});

// Estado de un empleado concreto (incluye marcajes permitidos).
fichajeRouter.get('/estado/:id', (req, res) => {
  const emp = db.prepare('SELECT id, nombre, pin_hash FROM empleados WHERE id = ? AND activo = 1').get(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });
  const { estado, desde } = getEstado(emp.id);
  res.json({ id: emp.id, nombre: emp.nombre, estado, desde, permitidos: marcajesPermitidos(estado), pin_configurado: !!emp.pin_hash });
});

// Registrar un marcaje.
//  - Online: requiere PIN correcto y transicion valida; la hora la pone el servidor.
//  - Offline (origen 'offline_sync'): marcaje sincronizado tras un corte. NO lleva
//    PIN (el navegador no guarda PINs); durante el corte la identidad va por
//    seleccion en un equipo autorizado. Queda marcado como tal y es revisable.
fichajeRouter.post('/fichar', (req, res) => {
  const { empleado_id, tipo } = req.body || {};
  const esOffline = req.body?.origen === 'offline_sync';
  if (!TIPOS_MARCAJE.includes(tipo)) return res.status(400).json({ error: 'tipo_invalido' });

  const emp = db.prepare('SELECT * FROM empleados WHERE id = ? AND activo = 1').get(Number(empleado_id));
  if (!emp) return res.status(404).json({ error: 'empleado_no_encontrado' });

  let ts_efectivo;
  let origen = 'online';

  if (esOffline) {
    const t = new Date(req.body?.ts_efectivo);
    const ahora = Date.now();
    if (isNaN(t.getTime()) || t.getTime() > ahora + 60000 || t.getTime() < ahora - 48 * 3600 * 1000) {
      return res.status(400).json({ error: 'ts_efectivo_invalido' });
    }
    ts_efectivo = t.toISOString();
    origen = 'offline_sync';
    // No se valida la transicion: es un marcaje historico real ya ocurrido.
  } else {
    if (!emp.pin_hash) return res.status(409).json({ error: 'pin_no_configurado' });
    const { pin } = req.body || {};
    if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'pin_formato' });
    if (!checkSecret(pin, emp.pin_hash)) return res.status(401).json({ error: 'pin_incorrecto' });
    const { estado } = getEstado(emp.id);
    if (!marcajesPermitidos(estado).includes(tipo)) {
      return res.status(409).json({ error: 'transicion_invalida', estado, permitidos: marcajesPermitidos(estado) });
    }
  }

  const ev = appendEvento({
    empleado_id: emp.id,
    tipo,
    ts_efectivo,
    origen,
    autor: 'empleado',
    dispositivo: req.dispositivo.nombre,
    ip: getClientIp(req),
  });

  const nuevo = getEstado(emp.id);
  res.json({
    ok: true,
    marcaje: { tipo, etiqueta: ETIQUETA_TIPO[tipo], ts: ev.ts_efectivo, hash: ev.hash.slice(0, 12) },
    empleado: emp.nombre,
    estado: nuevo.estado,
    desde: nuevo.desde,
  });
});
