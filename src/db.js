// Capa de base de datos (SQLite integrado de Node, sin modulos nativos).
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { eventoHash } from './security.js';

export const db = new DatabaseSync(config.dbFile);

// WAL: mejor concurrencia (dos PCs escribiendo) y resistencia a cortes.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS empleados (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  regimen     TEXT DEFAULT 'completa',
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispositivos (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  token_id      TEXT NOT NULL UNIQUE,
  ip            TEXT,
  activo        INTEGER NOT NULL DEFAULT 1,
  autorizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

-- Registro APPEND-ONLY de eventos (fichajes y correcciones).
-- Nunca se hace UPDATE ni DELETE sobre esta tabla: es la fuente legal.
CREATE TABLE IF NOT EXISTS eventos (
  id            INTEGER PRIMARY KEY,
  seq           INTEGER NOT NULL UNIQUE,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  tipo          TEXT NOT NULL,           -- entrada|salida|inicio_pausa|fin_pausa|anulacion
  ts_efectivo   TEXT NOT NULL,           -- momento legal del marcaje (ISO)
  ts_servidor   TEXT NOT NULL,           -- momento de registro en servidor (ISO)
  modalidad     TEXT NOT NULL DEFAULT 'presencial',
  origen        TEXT NOT NULL DEFAULT 'online', -- online|offline_sync|manual
  autor         TEXT NOT NULL DEFAULT 'empleado', -- empleado|admin
  dispositivo   TEXT,
  ip            TEXT,
  ref_evento_id INTEGER,                 -- para anulacion: id del evento anulado
  motivo        TEXT,                    -- obligatorio en correcciones/anulaciones
  hash_prev     TEXT,
  hash          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_emp ON eventos(empleado_id, ts_efectivo);

-- Solicitudes del empleado (correccion de fichaje / ausencia) y su aprobacion.
-- El estado es mutable (workflow); la huella legal de lo APROBADO va a 'eventos'.
CREATE TABLE IF NOT EXISTS solicitudes (
  id            INTEGER PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  clase         TEXT NOT NULL,             -- correccion | ausencia
  estado        TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|aprobada|denegada
  -- correccion de fichaje:
  corr_accion   TEXT,                      -- anadir | anular
  corr_tipo     TEXT,                      -- entrada|salida|inicio_pausa|fin_pausa (anadir)
  corr_ts       TEXT,                      -- hora propuesta ISO (anadir)
  corr_ref_id   INTEGER,                   -- evento a anular (anular)
  -- ausencia:
  aus_tipo      TEXT,                      -- vacaciones|permiso_retribuido|asuntos_propios|medico|baja|otro
  aus_subtipo   TEXT,                      -- detalle del permiso retribuido
  aus_desde     TEXT,                      -- fecha inicio (YYYY-MM-DD)
  aus_hasta     TEXT,                      -- fecha fin (YYYY-MM-DD)
  aus_horas     TEXT,                      -- opcional (ausencia parcial)
  -- comun:
  motivo        TEXT,
  creada_en     TEXT NOT NULL,
  resuelta_en   TEXT,
  nota_admin    TEXT,
  evento_id     INTEGER                    -- evento generado al aprobar (trazabilidad)
);

CREATE INDEX IF NOT EXISTS idx_solic_estado ON solicitudes(estado, creada_en);
CREATE INDEX IF NOT EXISTS idx_solic_emp ON solicitudes(empleado_id, creada_en);
`);

// ----- Helpers de config -----
export function getConfig(clave, def = null) {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return row ? row.valor : def;
}
export function setConfig(clave, valor) {
  db.prepare(`INSERT INTO config (clave, valor) VALUES (?, ?)
              ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(clave, String(valor));
}

// ----- Append de evento con cadena de hashes -----
const insertEvento = db.prepare(`
  INSERT INTO eventos
    (seq, empleado_id, tipo, ts_efectivo, ts_servidor, modalidad, origen, autor, dispositivo, ip, ref_evento_id, motivo, hash_prev, hash)
  VALUES
    (@seq, @empleado_id, @tipo, @ts_efectivo, @ts_servidor, @modalidad, @origen, @autor, @dispositivo, @ip, @ref_evento_id, @motivo, @hash_prev, @hash)
`);

const lastEventoStmt = db.prepare('SELECT seq, hash FROM eventos ORDER BY seq DESC LIMIT 1');

// Anade un evento al registro inmutable. Devuelve el evento creado.
export function appendEvento(ev) {
  const last = lastEventoStmt.get();
  const seq = last ? last.seq + 1 : 1;
  const hash_prev = last ? last.hash : 'GENESIS';
  const ts_servidor = new Date().toISOString();
  const row = {
    seq,
    empleado_id: ev.empleado_id,
    tipo: ev.tipo,
    ts_efectivo: ev.ts_efectivo || ts_servidor,
    ts_servidor,
    modalidad: ev.modalidad || 'presencial',
    origen: ev.origen || 'online',
    autor: ev.autor || 'empleado',
    dispositivo: ev.dispositivo || null,
    ip: ev.ip || null,
    ref_evento_id: ev.ref_evento_id || null,
    motivo: ev.motivo || null,
    hash_prev,
  };
  row.hash = eventoHash(row);
  insertEvento.run(row);
  return row;
}

// Verifica la integridad de toda la cadena. Devuelve {ok, roto_en}.
export function verificarCadena() {
  const rows = db.prepare('SELECT * FROM eventos ORDER BY seq ASC').all();
  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.hash_prev !== prev) return { ok: false, roto_en: r.seq, motivo: 'hash_prev no coincide' };
    const recalculado = eventoHash(r);
    if (recalculado !== r.hash) return { ok: false, roto_en: r.seq, motivo: 'hash no coincide' };
    prev = r.hash;
  }
  return { ok: true, total: rows.length };
}
