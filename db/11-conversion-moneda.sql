-- SPEC-11 · Conversión de moneda. CM-R10: fuente de los tipos de cambio [POR ACORDAR]; carga manual.
CREATE TABLE tipos_cambio (
    id              UUID PRIMARY KEY,
    moneda_origen   CHAR(3)        NOT NULL CHECK (moneda_origen IN ('PEN','USD')),
    moneda_destino  CHAR(3)        NOT NULL CHECK (moneda_destino IN ('PEN','USD')),
    valor           NUMERIC(10,4)  NOT NULL CHECK (valor > 0),
    vigente_desde   TIMESTAMPTZ    NOT NULL
);
CREATE INDEX idx_tipos_cambio_par ON tipos_cambio (moneda_origen, moneda_destino, vigente_desde DESC);

CREATE TABLE conversiones_deposito (
    deposito_id     UUID PRIMARY KEY REFERENCES depositos(id),
    tipo_cambio_id  UUID           NOT NULL REFERENCES tipos_cambio(id),
    moneda_cuenta   CHAR(3)        NOT NULL,
    tipo_cambio     NUMERIC(10,4)  NOT NULL,
    monto_final     NUMERIC(15,2)  NOT NULL
);
-- Valores de EJEMPLO [POR ACORDAR], solo para probar a mano.
INSERT INTO tipos_cambio VALUES
  ('00000000-0000-0000-0000-000000000001','USD','PEN',3.7500,'2026-01-01T00:00:00Z');
