# Poner los datos a 0 (runbook)

Guía para limpiar datos antes de empezar a usar la app en serio, o tras una
prueba/demo. **Todo esto se ejecuta EN EL SERVIDOR (VPS)** donde está la base de
datos real (`data/fichaje.db`), nunca desde el repositorio de código: la carpeta
`data/` no se versiona (está en `.gitignore`).

## Dónde viven los datos

- Base de datos real: `data/fichaje.db` (+ `-wal` / `-shm`), en el VPS.
- `data/secret.key`: firma cookies y la cadena de hashes. **No borrar nunca.**
- El código (este repo) **no** contiene datos. Resetear aquí no afecta a producción.

## Dos formas de poner a 0

### 1) Reset de fábrica — borra TODO

Deja la app como recién instalada: sin empleados, sin dispositivos autorizados y
sin contraseña de admin. Útil si quieres reconfigurar desde cero.

```bash
npm run reset
```

Tras arrancar: la app pide **crear la contraseña de admin**, das de alta a los
empleados con su PIN y vuelves a **autorizar los PCs** (uno por uno).

### 2) Solo fichajes a 0 — conserva empleados, PCs y admin

Borra únicamente los datos de uso (fichajes/`eventos` y solicitudes). Conserva
empleados, dispositivos autorizados y la config del admin. Ideal tras una demo:
no hay que rehacer empleados ni reautorizar PCs.

```bash
npm run reset-fichajes        # simulacro: muestra qué se borraría
npm run reset-fichajes -- --si  # borra de verdad
```

La cadena de hashes se reinicia sola en el próximo fichaje (`seq 1`, `GENESIS`).

## Procedimiento en el VPS (paso a paso)

Con el servidor **parado** y haciendo copia de seguridad antes:

```bash
cd /opt/fichaje                  # ajustar a la ruta real de instalación
sudo systemctl stop fichaje      # ajustar al nombre real del servicio

# copia de seguridad (recomendado)
sqlite3 data/fichaje.db ".backup 'data/backup-$(date +%F).db'"

# elegir UNA de las dos:
npm run reset                    # opción 1: reset de fábrica
# npm run reset-fichajes -- --si # opción 2: solo fichajes a 0

sudo systemctl start fichaje
```

## Aviso legal

Vaciar la tabla `eventos` solo es admisible **antes** de empezar a usar la app en
producción (datos de prueba). Una vez los empleados fichen jornadas reales, esos
registros deben **conservarse 4 años** (art. 34.9 ET) y no deben borrarse; las
correcciones se hacen con anulaciones trazables, no borrando.
