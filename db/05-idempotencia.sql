-- SPEC-05 · Idempotencia. IDE-R02: la clave es única por usuario.
CREATE TABLE claves_idempotencia (
    usuario_id      VARCHAR(50)  NOT NULL,
    clave           VARCHAR(100) NOT NULL,
    hash_solicitud  CHAR(64)     NOT NULL,
    estado          VARCHAR(20)  NOT NULL CHECK (estado IN ('EN_PROCESO','TERMINADO','REINTENTABLE')),
    status_http     SMALLINT,
    respuesta       JSONB,
    deposito_id     UUID REFERENCES depositos(id),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (usuario_id, clave)
);
CREATE INDEX idx_claves_creado ON claves_idempotencia (creado_en);
