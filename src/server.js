// Servidor principal de la app de fichaje.
import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT, DATA_DIR } from './config.js';
import { db } from './db.js'; // inicializa el esquema
import { iniciarVigilante } from './vigilante.js';
import { fichajeRouter } from './routes/fichaje.js';
import { empleadoRouter } from './routes/empleado.js';
import { adminRouter } from './routes/admin.js';
import { solicitudesRouter } from './routes/solicitudes.js';
import { deviceInfo, isAdmin } from './auth.js';

const app = express();
// Detras de Nginx: confiar en el primer proxy para leer X-Forwarded-For / HTTPS.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Cabeceras de seguridad basicas. Sin CSP estricta: la UI usa handlers inline.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// Endpoint de contexto para el frontend: sabe si el dispositivo esta autorizado
// y si hay sesion admin, para decidir que pantalla mostrar.
app.get('/api/contexto', (req, res) => {
  const disp = deviceInfo(req);
  // Contadores de pendientes: solo para equipos autorizados (los PCs de la
  // tienda). Alimentan el indicador de notificaciones de la pestaña Admin
  // sin revelar ningún detalle antes de introducir la contraseña.
  let pendientes = null;
  if (disp || isAdmin(req)) {
    pendientes = {
      solicitudes: db.prepare("SELECT COUNT(*) c FROM solicitudes WHERE estado = 'pendiente'").get().c,
      avisos: db.prepare('SELECT COUNT(*) c FROM avisos WHERE visto = 0').get().c,
    };
  }
  res.json({
    dispositivoAutorizado: !!disp,
    dispositivoNombre: disp?.nombre || null,
    admin: isAdmin(req),
    empresa: config.empresa.nombre,
    pendientes,
  });
});

app.get('/api/salud', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Logo white-label: si la empresa puso su logo en la carpeta de datos
// (data/logo.png|.svg|.jpg) se sirve ese; si no, el logo neutro por defecto.
// Asi el mismo codigo vale para cualquier empresa sin tocar el repo.
app.get('/img/logo.png', (req, res) => {
  for (const f of ['logo.png', 'logo.svg', 'logo.jpg', 'logo.jpeg', 'logo.webp']) {
    const custom = join(DATA_DIR, f);
    if (existsSync(custom)) return res.sendFile(custom);
  }
  res.sendFile(join(ROOT, 'public', 'img', 'logo-default.svg'));
});

app.use('/api/fichaje', fichajeRouter);
app.use('/api/mis-fichajes', empleadoRouter);
app.use('/api/solicitudes', solicitudesRouter);
app.use('/api/admin', adminRouter);

// Estaticos (frontend + PWA).
app.use(express.static(join(ROOT, 'public'), { extensions: ['html'] }));

// Pagina unica: cualquier ruta conocida sirve el mismo index.html (dos pestanas).
for (const ruta of ['/', '/admin', '/mis-fichajes']) {
  app.get(ruta, (req, res) => res.sendFile(join(ROOT, 'public', 'index.html')));
}

app.use((req, res) => res.status(404).json({ error: 'no_encontrado' }));

app.listen(config.port, () => {
  console.log(`\n  Fichaje ${config.empresa.nombre}`);
  console.log(`  Escuchando en http://localhost:${config.port}`);
  console.log(`  Zona horaria: ${config.timezone}\n`);
});

// Vigilante de jornadas: avisos de exceso y cierre automático a la hora límite.
iniciarVigilante();
