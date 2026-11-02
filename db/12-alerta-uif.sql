-- SPEC-12 · Alerta UIF. UIF-R07: estado_reporte cambia después; por eso no va en la auditoría.
CREATE TABLE alertas_uif (
    id              UUID PRIMARY KEY,
    deposito_id     UUID          NOT NULL UNIQUE REFERENCES depositos(id),
    monto           NUMERIC(15,2) NOT NULL,
    moneda          CHAR(3)       NOT NULL,
    umbral          NUMERIC(15,2) NOT NULL,
    estado_reporte  VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado_reporte IN ('PENDIENTE','REPORTADO','DESCARTADO')),
    creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
