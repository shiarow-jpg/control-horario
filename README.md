# Fichaje · Multiverso Norte

Aplicación web de **control horario / registro de jornada** para Multiverso Norte (tienda friki, norte de Tenerife). Pensada para fichar desde los **2 PCs del mostrador**, con estado compartido (entras en uno, sales en otro) y registro **inalterable** conforme a la normativa española.

---

## Qué cumple de la ley (art. 34.9 ET y RD-ley 8/2019)

- **Registro diario** de cada trabajador con **hora y minuto exactos** de inicio/fin de jornada y de las **pausas de almuerzo**.
- **Hora del servidor** (objetiva, no manipulable desde el PC).
- **Inalterabilidad**: los marcajes se guardan en un registro *append-only* con **cadena de hashes (SHA-256)**. Editar o borrar cualquier dato rompe la cadena y se detecta (botón "Verificar integridad").
- **Correcciones con trazabilidad**: nunca se edita ni borra el original. Una corrección crea un evento nuevo (anulación o marcaje manual) que guarda **autor y motivo** (como exige el nuevo Real Decreto de registro horario digital, en tramitación).
- **Acceso del trabajador** a sus propios registros y **copia en PDF** (pantalla "Mis fichajes").
- **Conservación 4 años** (los datos no se borran; ver "Backups").
- **Export PDF no modificable** con huella de verificación SHA-256.

> El PDF es el extracto legible; la garantía de invariabilidad está en la base de datos (cadena de hashes). Guarda copia de seguridad de la carpeta `data/`.

---

## Requisitos

- **Node.js 22.5 o superior** (usa el SQLite integrado de Node; no compila módulos nativos).

## Instalación y primer uso (local)

```bash
npm install
npm start            # arranca en http://localhost:3000
```

La app es **una sola página con dos pestañas**: **Fichaje** (lo que usan los empleados) y **Administración**.

1. Abre `http://localhost:3000`, ve a la pestaña **Administración** y **crea la contraseña de administrador**.
2. En **Equipos autorizados**, pulsa *Autorizar este equipo* en cada uno de los 2 PCs (hazlo una vez por PC, desde ese PC). Solo los equipos autorizados podrán fichar; los móviles no.
3. En **Empleados**, da de alta a cada persona con su **PIN de 4 dígitos**.
4. En la pestaña **Fichaje**, los empleados tocan su nombre → PIN → Entrada / Salida / Inicio o Fin de almuerzo. El botón **Mis fichajes** (con PIN) permite a cada uno ver/descargar su copia.

### Logo de la tienda

Coloca el logo en `public/img/logo.png` (o `.svg`) y aparecerá automáticamente en la cabecera. Si no hay archivo, se muestra el recuadro "MN" como respaldo.

> Para probar rápido con datos de ejemplo: `npm run seed` (admin: `admin123`; PINs 1234/2345/3456). **No usar en producción.**

## Estado compartido entre los 2 PCs

Ambos PCs abren la **misma URL** (la del servidor). Como hay una sola base de datos, fichar entrada en un PC y salida en otro funciona automáticamente.

## Modo sin conexión (PWA)

La pantalla de fichaje funciona como PWA: si se cae internet justo al fichar, el marcaje se guarda en el navegador con su hora real y se **sincroniza al recuperar la conexión**. Aun así, conviene un **respaldo en papel** documentado por si Inspección lo pide durante una caída prolongada.

---

## Despliegue en el VPS de Hostinger

Resumen (se detalla al desplegar):

1. Copiar el proyecto al VPS (sin `node_modules` ni `data/`):
   ```bash
   rsync -av --exclude node_modules --exclude data ./ usuario@VPS:/opt/fichaje/
   ```
2. En el VPS: `cd /opt/fichaje && npm ci --omit=dev` y crear `.env` (ver `.env.example`).
3. Servicio **systemd** `fichaje.service` para que arranque solo y se reinicie.
4. **Nginx** como proxy inverso hacia `localhost:PORT` en el subdominio (p.ej. `fichaje.<dominio>`).
5. **HTTPS** con Certbot (Let's Encrypt). Obligatorio: las cookies de dispositivo y la sesión admin viajan seguras.
6. Apuntar el subdominio (DNS A → IP del VPS).

### Puesta en producción (datos limpios)

Antes de entregar la app a la empresa hay que **eliminar los datos de prueba** y dejarla vacía. Con el servidor parado:

```bash
npm run reset
```

Esto borra empleados, fichajes, equipos autorizados y la configuración del admin. En el siguiente arranque la app pedirá **configurar el administrador** y **no habrá ningún empleado**: la empresa añade los suyos. (Se conserva `data/secret.key`.)

### Baja de empleados

Dar de baja a un empleado lo **retira de la pantalla de fichaje y de la lista de empleados activos**, pero su registro **se conserva** y sigue siendo consultable en *Informes y registro* (el selector incluye a los dados de baja). Útil si un extrabajador solicita sus fichajes tras dejar la empresa. Se puede *Reactivar* en cualquier momento.

### Backups (conservación 4 años)

La verdad legal está en `data/fichaje.db`. Programar copia diaria, por ejemplo:
```bash
sqlite3 /opt/fichaje/data/fichaje.db ".backup '/opt/backups/fichaje-$(date +%F).db'"
```
Conservar al menos 4 años. **No borrar `data/secret.key`** (firma cookies y cadena de hashes).

---

## Estructura

```
src/
  server.js        Servidor Express y rutas estáticas
  config.js        Configuración y secreto
  db.js            SQLite (node:sqlite), esquema y cadena de hashes
  security.js      Tokens firmados, bcrypt, hashes
  auth.js          Middlewares: dispositivo autorizado / admin
  jornada.js       Estado, transiciones y cálculo de horas
  pdf.js           Generación de informes PDF
  routes/
    fichaje.js     Fichar (kiosko)
    empleado.js    "Mis fichajes" (consulta/PDF del empleado)
    admin.js       Panel de administración
public/            Frontend de página única con 2 pestañas + PWA
  index.html       Pestañas Fichaje / Administración (todo en una URL)
  js/app.js        Orquesta pestañas y subvista "Mis fichajes"
  js/fichar.js     Kiosko (rejilla, PIN, cola offline)
  js/mis-fichajes.js  Consulta/descarga del propio registro
  js/admin.js      Panel de administración
  img/logo.png     Logo de la tienda (opcional; respaldo "MN")
data/              Base de datos y secreto (NO versionar)
```

## Notas de seguridad

- PIN de empleado y contraseña admin **hasheados con bcrypt**.
- Cookie de dispositivo **firmada (HMAC)** y ligada a un dispositivo activo en BD → control "solo estos 2 PCs".
- Refuerzo opcional por IP de la tienda: `ENFORCE_DEVICE_IP=true` (solo si la IP pública es fija).
- Servir **siempre por HTTPS** en producción.
