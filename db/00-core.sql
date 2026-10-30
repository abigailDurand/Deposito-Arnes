-- SPEC-01 · Tabla del core. DOM-R03: cuenta_destino y usuario_id no son FK (son de otros servicios).
-- DOM-R04: sin columnas de features; cada feature crea su tabla con FK a depositos(id).
CREATE TABLE depositos (
    id                UUID PRIMARY KEY,
    cuenta_destino    VARCHAR(20)   NOT NULL,
    monto             NUMERIC(15,2) NOT NULL CHECK (monto > 0),
    moneda            CHAR(3)       NOT NULL CHECK (moneda IN ('PEN','USD')),
    monto_acreditar   NUMERIC(15,2) NOT NULL CHECK (monto_acreditar > 0),
    moneda_acreditar  CHAR(3)       NOT NULL CHECK (moneda_acreditar IN ('PEN','USD')),
    canal             VARCHAR(20)   NOT NULL CHECK (canal IN ('AGENTE','VENTANILLA','APP')),
    referencia        VARCHAR(140),
    estado            VARCHAR(20)   NOT NULL CHECK (estado IN ('PENDIENTE','PROCESANDO','COMPLETADO','FALLIDO')),
    usuario_id        VARCHAR(50)   NOT NULL,
    creado_en         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_depositos_cuenta  ON depositos (cuenta_destino, creado_en DESC);
CREATE INDEX idx_depositos_usuario ON depositos (usuario_id, creado_en DESC);
