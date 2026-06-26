# Imagen de produccion de la app de fichaje.
# Node 24 trae SQLite integrado (node:sqlite), sin modulos nativos que compilar.
FROM node:24-slim

WORKDIR /app

# Dependencias (capa cacheable).
COPY package*.json ./
RUN npm ci --omit=dev

# Codigo de la aplicacion.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Atlantic/Canary

EXPOSE 3000

# Los datos (BD SQLite + secret.key) viven en /app/data, montado como volumen
# persistente para que sobrevivan a redepliegues.
CMD ["node", "src/server.js"]
