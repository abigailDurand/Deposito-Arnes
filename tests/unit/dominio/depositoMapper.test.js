'use strict';

const { aJson } = require('../../../src/core/depositoMapper');

function fila(extra = {}) {
  return {
    id: '7f1c2e9a-0b1d-4c5e-9f00-123456789abc',
    cuenta_destino: '0011-0123-456789',
    monto: '150.00',
    moneda: 'PEN',
    monto_acreditar: '150.00',
    moneda_acreditar: 'PEN',
    canal: 'AGENTE',
    referencia: 'Pago alquiler',
    estado: 'COMPLETADO',
    usuario_id: 'usr-agente-1',
    creado_en: new Date('2026-10-13T19:20:00.000Z'),
    actualizado_en: new Date('2026-10-13T19:20:01.000Z'),
    ...extra,
  };
}

describe('aJson', () => {
  test('DOM-T06 monto 150 y sin referencia → "150.00" y referencia null', () => {
    const { referencia, ...sinReferencia } = fila({ monto: 150 });

    const json = aJson(sinReferencia, {});

    expect(json.monto).toBe('150.00');
    expect(json).toHaveProperty('referencia', null);
  });

  test('DOM-T06 referencia null en BD → referencia null', () => {
    expect(aJson(fila({ referencia: null }), {})).toHaveProperty('referencia', null);
  });

  test('DOM-R10 fila completa → objeto Deposito de §5 (camelCase, ISO UTC, sin usuario_id ni *_acreditar)', () => {
    const json = aJson(fila(), {});

    expect(json).toEqual({
      id: '7f1c2e9a-0b1d-4c5e-9f00-123456789abc',
      cuentaDestino: '0011-0123-456789',
      monto: '150.00',
      moneda: 'PEN',
      canal: 'AGENTE',
      referencia: 'Pago alquiler',
      estado: 'COMPLETADO',
      creadoEn: '2026-10-13T19:20:00.000Z',
      actualizadoEn: '2026-10-13T19:20:01.000Z',
      extensiones: {},
    });
    expect(JSON.stringify(json)).not.toContain('usr-agente-1');
  });

  test('DOM-R10 monto con valores límite → string con exactamente 2 decimales', () => {
    expect(aJson(fila({ monto: '0.01' }), {}).monto).toBe('0.01');
    expect(aJson(fila({ monto: '10.5' }), {}).monto).toBe('10.50');
    expect(aJson(fila({ monto: '1234567890123.45' }), {}).monto).toBe('1234567890123.45');
  });

  test('DOM-R10 fechas como string con offset → ISO 8601 UTC', () => {
    const json = aJson(fila({
      creado_en: '2026-10-13T14:20:00-05:00',
      actualizado_en: '2026-10-13T14:20:01-05:00',
    }), {});

    expect(json.creadoEn).toBe('2026-10-13T19:20:00.000Z');
    expect(json.actualizadoEn).toBe('2026-10-13T19:20:01.000Z');
  });

  test('DOM-R10 extensiones se devuelven tal cual', () => {
    const extensiones = { comision: { monto: '1.50' } };

    expect(aJson(fila(), extensiones).extensiones).toEqual(extensiones);
  });
});
