'use strict';

// UIF-R03: estado_reporte PENDIENTE. PRY-R06: monto y umbral viajan como string de 2 decimales.
async function insertar(db, alerta) {
  await db.query(
    `INSERT INTO alertas_uif (id, deposito_id, monto, moneda, umbral, estado_reporte)
     VALUES ($1, $2, $3, $4, $5, 'PENDIENTE')`,
    [alerta.id, alerta.depositoId, alerta.monto, alerta.moneda, alerta.umbral],
  );
}

module.exports = { insertar };
