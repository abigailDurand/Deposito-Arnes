-- SPEC-10 · Límites por canal. Tabla de configuración: limpiar() de las pruebas no la vacía.
CREATE TABLE limites_canal (
    canal         VARCHAR(20)   NOT NULL CHECK (canal IN ('AGENTE','VENTANILLA','APP')),
    moneda        CHAR(3)       NOT NULL CHECK (moneda IN ('PEN','USD')),
    monto_maximo  NUMERIC(15,2) NOT NULL CHECK (monto_maximo > 0),
    PRIMARY KEY (canal, moneda)
);
-- Valores de EJEMPLO [POR ACORDAR]: el equipo debe definir los reales.
INSERT INTO limites_canal VALUES
  ('AGENTE','PEN',2000.00), ('AGENTE','USD',500.00),
  ('APP','PEN',5000.00), ('APP','USD',1500.00),
  ('VENTANILLA','PEN',50000.00), ('VENTANILLA','USD',15000.00);
