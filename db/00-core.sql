-- SPEC-01 · Tabla del core. DOM-R03: cuenta_destino y usuario_id no son FK (son de otros servicios).
-- DOM-R11: titular_id (nullable, no FK) es del core: reintento y reconciliación reenvían el mismo body.
-- DOM-R04: sin columnas de features; cada feature crea su tabla con FK a depositos(id).
-- CI-R08: idempotente (scripts/migrar.js lo aplica sobre bases existentes).
CREATE TABLE IF NOT EXISTS depositos (
    id                UUID PRIMARY KEY,
    cuenta_destino    VARCHAR(36)   NOT NULL,
    monto             NUMERIC(15,2) NOT NULL CHECK (monto > 0),
    moneda            CHAR(3)       NOT NULL CHECK (moneda IN ('PEN','USD')),
    monto_acreditar   NUMERIC(15,2) NOT NULL CHECK (monto_acreditar > 0),
    moneda_acreditar  CHAR(3)       NOT NULL CHECK (moneda_acreditar IN ('PEN','USD')),
    canal             VARCHAR(20)   NOT NULL CHECK (canal IN ('AGENTE','VENTANILLA','APP')),
    referencia        VARCHAR(140),
    estado            VARCHAR(20)   NOT NULL CHECK (estado IN ('PENDIENTE','PROCESANDO','COMPLETADO','FALLIDO')),
    usuario_id        VARCHAR(50)   NOT NULL,
    titular_id        VARCHAR(100),
    creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
-- CI-R08 / DOM-R11: columna añadida en SPEC-01 v1.2; se garantiza en bases creadas antes.
ALTER TABLE depositos ADD COLUMN IF NOT EXISTS titular_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_depositos_cuenta  ON depositos (cuenta_destino, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_depositos_usuario ON depositos (usuario_id, creado_en DESC);
