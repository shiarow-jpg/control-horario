// Generacion de informes PDF de registro de jornada (Art. 34.9 ET).
// El PDF es el extracto legible; la inalterabilidad la garantiza la cadena de
// hashes en BD. Se incluye una "huella" SHA-256 del contenido para verificacion.
import PDFDocument from 'pdfkit';
import { config } from './config.js';
import { sha256 } from './security.js';
import { calcularJornada, getMarcajes, fmtDuracion, ETIQUETA_TIPO } from './jornada.js';
import { verificarCadena } from './db.js';

const fmtFecha = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: config.timezone,
});
const fmtHora = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: config.timezone, hour12: false,
});
const fmtFechaHora = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: config.timezone, hour12: false,
});

function isoSemana(fecha) {
  const d = new Date(fecha + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

// Genera el PDF y lo escribe en `stream`. Devuelve la huella del documento.
export function generarInformePDF(stream, { empleado, desde, hasta }) {
  const jornada = calcularJornada(empleado.id, desde, hasta);
  const cadena = verificarCadena();

  // Huella: hash de todos los marcajes vigentes del periodo + metadatos.
  const marcajes = getMarcajes(empleado.id, { desde, hasta });
  const huella = sha256(JSON.stringify({
    empleado: empleado.id, desde, hasta,
    marcajes: marcajes.map(m => [m.seq, m.tipo, m.ts_efectivo, m.hash]),
  }));

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: `Registro de jornada - ${empleado.nombre}`,
    Author: config.empresa.nombre,
    Subject: `Periodo ${desde} a ${hasta}`,
    Keywords: 'registro jornada, art 34.9 ET, no modificable',
  }});
  doc.pipe(stream);

  // ---- Cabecera ----
  doc.fontSize(16).font('Helvetica-Bold').text('Registro de jornada laboral', { align: 'left' });
  doc.fontSize(9).font('Helvetica').fillColor('#555')
    .text('Documento generado conforme al art. 34.9 del Estatuto de los Trabajadores. Copia no modificable.');
  doc.moveDown(0.6).fillColor('#000');

  doc.fontSize(10).font('Helvetica-Bold').text(config.empresa.nombre, { continued: false });
  doc.font('Helvetica').fontSize(9);
  if (config.empresa.cif) doc.text(`CIF: ${config.empresa.cif}`);
  if (config.empresa.direccion) doc.text(config.empresa.direccion);
  doc.moveDown(0.5);

  doc.fontSize(11).font('Helvetica-Bold').text(`Empleado/a: ${empleado.nombre}`);
  doc.fontSize(9).font('Helvetica')
    .text(`Periodo: ${desde} a ${hasta}`)
    .text(`Generado: ${fmtFechaHora.format(new Date())} (${config.timezone})`);
  doc.moveDown(0.8);

  // ---- Resumen de totales ----
  const semanas = new Map();
  const meses = new Map();
  for (const d of jornada.dias) {
    semanas.set(isoSemana(d.fecha), (semanas.get(isoSemana(d.fecha)) || 0) + d.trabajadoSeg);
    const mes = d.fecha.slice(0, 7);
    meses.set(mes, (meses.get(mes) || 0) + d.trabajadoSeg);
  }

  doc.fontSize(11).font('Helvetica-Bold').text('Resumen');
  doc.fontSize(10).font('Helvetica')
    .text(`Total trabajado en el periodo: ${fmtDuracion(jornada.totalTrabajadoSeg)}`)
    .text(`Total pausas (almuerzo): ${fmtDuracion(jornada.totalPausaSeg)}`);
  if (jornada.abierto) doc.fillColor('#b00').text('Aviso: hay una jornada sin marcaje de salida en el periodo.').fillColor('#000');
  doc.moveDown(0.4);

  doc.fontSize(9).font('Helvetica-Bold').text('Por semana (ISO):');
  doc.font('Helvetica');
  for (const [s, seg] of [...semanas].sort()) doc.text(`   ${s}: ${fmtDuracion(seg)}`);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').text('Por mes:');
  doc.font('Helvetica');
  for (const [m, seg] of [...meses].sort()) doc.text(`   ${m}: ${fmtDuracion(seg)}`);
  doc.moveDown(0.8);

  // ---- Detalle diario con marcajes ----
  doc.fontSize(11).font('Helvetica-Bold').text('Detalle diario');
  doc.moveDown(0.3);

  if (jornada.dias.length === 0) {
    doc.fontSize(10).font('Helvetica').fillColor('#777').text('Sin marcajes en el periodo.').fillColor('#000');
  }

  for (const d of jornada.dias) {
    if (doc.y > 720) doc.addPage();
    const fechaTxt = fmtFecha.format(new Date(d.fecha + 'T12:00:00Z'));
    doc.fontSize(10).font('Helvetica-Bold')
      .text(`${fechaTxt}  —  Trabajado: ${fmtDuracion(d.trabajadoSeg)}  (pausa ${fmtDuracion(d.pausaSeg)})`);
    const linea = d.marcajes.map(m => {
      const flag = m.origen === 'offline_sync' ? ' (sinc.)' : '';
      return `${fmtHora.format(new Date(m.ts_efectivo))} ${ETIQUETA_TIPO[m.tipo]}${flag}`;
    }).join('   ·   ');
    doc.fontSize(9).font('Helvetica').fillColor('#333').text(`   ${linea}`).fillColor('#000');
    doc.moveDown(0.4);
  }

  // ---- Pie de verificacion ----
  doc.moveDown(1);
  if (doc.y > 700) doc.addPage();
  doc.fontSize(8).font('Helvetica').fillColor('#555');
  doc.text('—'.repeat(60));
  doc.text(`Huella de verificación (SHA-256): ${huella}`);
  doc.text(`Integridad de la cadena de registros: ${cadena.ok ? 'CORRECTA' : 'ALTERADA en seq ' + cadena.roto_en}`);
  doc.text('Este documento es un extracto del registro inmutable. Cualquier modificación de los datos originales');
  doc.text('rompe la cadena de hashes y resulta detectable. Conservación legal: 4 años.');
  doc.fillColor('#000');

  doc.end();
  return huella;
}
