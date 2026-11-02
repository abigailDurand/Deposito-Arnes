-- SPEC-04 · Auditoría de cada intento. AUD-R05: solo inserción; el trigger bloquea UPDATE y DELETE.
CREATE TABLE auditoria_depositos (
    id              BIGSERIAL PRIMARY KEY,
    deposito_id     UUID REFERENCES depositos(id),
    usuario_id      VARCHAR(50),
    accion          VARCHAR(40)  NOT NULL,
    ip              VARCHAR(45),
    canal           VARCHAR(20),
    monto           NUMERIC(15,2),
    resultado       VARCHAR(20)  NOT NULL,
    correlation_id  VARCHAR(100),
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE FUNCTION bloquear_cambios_auditoria() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'auditoria_depositos es solo de inserción'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria_depositos
FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_auditoria();
