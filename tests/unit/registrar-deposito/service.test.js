'use strict';

const Decimal = require('decimal.js');

const billeteraClient = require('../../../src/core/clients/billeteraClient');
const db = require('../../../src/core/db');
const { ErrorApp } = require('../../../src/core/errores');
const permisos = require('../../../src/core/permisos');
const pipeline = require('../../../src/core/pipeline');
const repository = require('../../../src/modules/registrar-deposito/repository');
const service = require('../../../src/modules/registrar-deposito/service');
const { esquemaDeposito } = require('../../../src/modules/registrar-deposito/schema');
const modulo = require('../../../src/modules/registrar-deposito');

const CUENTA = '0011-0123-456789';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const AGENTE_1 = { id: 'usr-agente-1', roles: ['AGENTE'] };
const DATOS = { cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE' };
const CUENTA_PEN = { numero: CUENTA, estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' };
const FECHA = new Date('2026-10-13T19:20:00.000Z');
const TX = { soyLaTransaccion: true };

function fila(estado, extra = {}) {
  return {
    id: ID,
    cuenta_destino: CUENTA,
    monto: '150.00',
    moneda: 'PEN',
    monto_acreditar: '150.00',
    moneda_acreditar: 'PEN',
    canal: 'AGENTE',
    referencia: null,
    estado,
    usuario_id: 'usr-agente-1',
    creado_en: FECHA,
    actualizado_en: FECHA,
    ...extra,
  };
}

// Todas las dependencias del service se simulan; `orden` registra la secuencia de pasos (RD-R04).
let orden;
let deps;

function prepararDependencias() {
  orden = [];
  const paso = (nombre, impl) => (...args) => {
    orden.push(nombre);
    return impl(...args);
  };
  deps = {
    consultarCuenta: jest.spyOn(billeteraClient, 'consultarCuenta')
      .mockImplementation(paso('consultarCuenta', async () => ({ ...CUENTA_PEN }))),
    acreditar: jest.spyOn(billeteraClient, 'acreditar')
      .mockImplementation(paso('acreditar', async () => undefined)),
    verificarCanal: jest.spyOn(permisos, 'verificarCanal')
      .mockImplementation(paso('verificarCanal', () => undefined)),
    verificarTitular: jest.spyOn(permisos, 'verificarTitular')
      .mockImplementation(paso('verificarTitular', () => undefined)),
    validadores: jest.spyOn(pipeline, 'ejecutarValidadores')
      .mockImplementation(paso('ejecutarValidadores', async () => undefined)),
    transformadores: jest.spyOn(pipeline, 'ejecutarTransformadores')
      .mockImplementation(paso('ejecutarTransformadores', async (d) => d)),
    persistir: jest.spyOn(pipeline, 'persistirTransformadores')
      .mockImplementation(paso('persistirTransformadores', async () => undefined)),
    postProcesos: jest.spyOn(pipeline, 'ejecutarPostProcesos')
      .mockImplementation(paso('ejecutarPostProcesos', async () => undefined)),
    leerExtensiones: jest.spyOn(pipeline, 'leerExtensiones')
      .mockImplementation(paso('leerExtensiones', async () => ({}))),
    enTransaccion: jest.spyOn(db, 'enTransaccion')
      .mockImplementation(async (fn) => {
        orden.push('BEGIN');
        const r = await fn(TX);
        orden.push('COMMIT');
        return r;
      }),
    insertar: jest.spyOn(repository, 'insertar')
      .mockImplementation(paso('insertar', async () => fila('PENDIENTE'))),
    buscarPorId: jest.spyOn(repository, 'buscarPorId')
      .mockImplementation(paso('buscarPorId', async () => null)),
    cambiarEstado: jest.spyOn(repository, 'cambiarEstado')
      .mockImplementation(async (_db, id, de, a) => {
        orden.push(`${de}→${a}`);
        return fila(a, { id });
      }),
  };
}

beforeEach(prepararDependencias);

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await db.pool.end();
});

describe('SPEC-07 service: casos', () => {
  test('RD-T02 monto "0", "-1" y "10.001" → ErrorApp MONTO_INVALIDO 422; billetera ni BD tocadas', async () => {
    for (const monto of ['0', '-1', '10.001', '0.00', '-0.01']) {
      await expect(service.registrar({ ...DATOS, monto }, AGENTE_1, 'c'))
        .rejects.toMatchObject({ codigo: 'MONTO_INVALIDO', status: 422 });
    }
    expect(deps.consultarCuenta).not.toHaveBeenCalled();
    expect(deps.acreditar).not.toHaveBeenCalled();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  // Arrastre de review_07: los decimales se cuentan sobre el string, no sobre el valor.
  test('RD-R03 monto "10.100" (3 decimales en el string) → ErrorApp MONTO_INVALIDO 422; billetera ni BD tocadas', async () => {
    await expect(service.registrar({ ...DATOS, monto: '10.100' }, AGENTE_1, 'c'))
      .rejects.toMatchObject({ codigo: 'MONTO_INVALIDO', status: 422 });
    expect(deps.consultarCuenta).not.toHaveBeenCalled();
    expect(deps.acreditar).not.toHaveBeenCalled();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  test('RD-T03 monto "0.01" → acredita Decimal 0.01', async () => {
    const res = await service.registrar({ ...DATOS, monto: '0.01' }, AGENTE_1, 'c');

    expect(res.estado).toBe('COMPLETADO');
    const [credito] = deps.acreditar.mock.calls[0];
    expect(credito.monto).toBeInstanceOf(Decimal);
    expect(credito.monto.toFixed(2)).toBe('0.01');
  });

  test('RD-T05 consultarCuenta → null → CUENTA_NO_ENCONTRADA; RD-T06 estado BLOQUEADA → CUENTA_INACTIVA', async () => {
    deps.consultarCuenta.mockResolvedValueOnce(null);
    await expect(service.registrar(DATOS, AGENTE_1, 'c'))
      .rejects.toMatchObject({ codigo: 'CUENTA_NO_ENCONTRADA', status: 422 });

    deps.consultarCuenta.mockResolvedValueOnce({ ...CUENTA_PEN, estado: 'BLOQUEADA' });
    await expect(service.registrar(DATOS, AGENTE_1, 'c'))
      .rejects.toMatchObject({ codigo: 'CUENTA_INACTIVA', status: 422 });

    expect(deps.verificarCanal).not.toHaveBeenCalled();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  test('RD-T07 acreditar lanza ErrorApp → PROCESANDO→FALLIDO y ErrorApp BILLETERA_NO_DISPONIBLE { depositoId }', async () => {
    deps.acreditar.mockRejectedValueOnce(new ErrorApp('BILLETERA_NO_DISPONIBLE'));

    const error = await service.registrar(DATOS, AGENTE_1, 'c').catch((e) => e);

    expect(error).toBeInstanceOf(ErrorApp);
    expect(error).toMatchObject({ codigo: 'BILLETERA_NO_DISPONIBLE', status: 502 });
    const id = deps.insertar.mock.calls[0][1].id;
    expect(error.depositoId).toBe(id);
    expect(deps.acreditar).toHaveBeenCalledTimes(1);
    expect(deps.cambiarEstado.mock.calls.map((c) => `${c[2]}→${c[3]}`))
      .toEqual(['PENDIENTE→PROCESANDO', 'PROCESANDO→FALLIDO']);
    expect(deps.postProcesos).not.toHaveBeenCalled();
  });

  test('RD-T09 consultarCuenta lanza BILLETERA_NO_DISPONIBLE → se propaga sin depositoId; nada guardado', async () => {
    deps.consultarCuenta.mockRejectedValueOnce(new ErrorApp('BILLETERA_NO_DISPONIBLE'));

    const error = await service.registrar(DATOS, AGENTE_1, 'c').catch((e) => e);

    expect(error).toMatchObject({ codigo: 'BILLETERA_NO_DISPONIBLE', status: 502 });
    expect(error.depositoId).toBeUndefined();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  test('RD-T10 monedaAcreditar ≠ cuenta.moneda tras los transformadores → MONEDA_NO_SOPORTADA; nada guardado', async () => {
    await expect(service.registrar({ ...DATOS, monto: '100.00', moneda: 'USD' }, AGENTE_1, 'c'))
      .rejects.toMatchObject({ codigo: 'MONEDA_NO_SOPORTADA', status: 422 });
    expect(deps.transformadores).toHaveBeenCalledTimes(1);
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  test('RD-T11 flujo exitoso → cambiarEstado PENDIENTE→PROCESANDO y luego PROCESANDO→COMPLETADO', async () => {
    const res = await service.registrar(DATOS, AGENTE_1, 'c');

    const id = deps.insertar.mock.calls[0][1].id;
    expect(deps.cambiarEstado.mock.calls).toEqual([
      [db.pool, id, 'PENDIENTE', 'PROCESANDO'],
      [db.pool, id, 'PROCESANDO', 'COMPLETADO'],
    ]);
    expect(res).toMatchObject({ id, estado: 'COMPLETADO' });
  });

  test('RD-T12 reintentar FALLIDO con billetera OK → mismo id, COMPLETADO, sin consultar cuenta ni validadores/transformadores', async () => {
    deps.buscarPorId.mockImplementationOnce(async () => {
      orden.push('buscarPorId');
      return fila('FALLIDO');
    });

    const res = await service.reintentar(ID, AGENTE_1, 'c');

    expect(res).toMatchObject({ id: ID, estado: 'COMPLETADO', extensiones: {} });
    expect(deps.consultarCuenta).not.toHaveBeenCalled();
    expect(deps.validadores).not.toHaveBeenCalled();
    expect(deps.transformadores).not.toHaveBeenCalled();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
    expect(orden).toEqual([
      'buscarPorId', 'leerExtensiones', 'FALLIDO→PROCESANDO', 'acreditar',
      'PROCESANDO→COMPLETADO', 'ejecutarPostProcesos',
    ]);
    expect(deps.acreditar.mock.calls[0][0].depositoId).toBe(ID);
  });
});

describe('SPEC-07 service: reglas', () => {
  test('RD-R04 orden exacto del diagrama; nada se guarda antes de la TX', async () => {
    await service.registrar(DATOS, AGENTE_1, 'c');

    expect(orden).toEqual([
      'consultarCuenta', 'verificarCanal', 'verificarTitular', 'ejecutarValidadores',
      'ejecutarTransformadores', 'BEGIN', 'insertar', 'persistirTransformadores', 'COMMIT',
      'PENDIENTE→PROCESANDO', 'acreditar', 'PROCESANDO→COMPLETADO', 'ejecutarPostProcesos',
    ]);
    expect(deps.insertar.mock.calls[0][0]).toBe(TX);
    expect(deps.persistir.mock.calls[0][1]).toBe(TX);
  });

  test('RD-R03/R05 deposito con id UUID, montos Decimal y campos de SPEC-06 §4; contexto único (PIP-R07)', async () => {
    await service.registrar({ ...DATOS, referencia: 'Pago alquiler' }, AGENTE_1, 'corr-1');

    const [deposito, contexto] = deps.validadores.mock.calls[0];
    expect(Object.keys(deposito).sort()).toEqual([
      'canal', 'cuentaDestino', 'extensiones', 'id', 'moneda', 'monedaAcreditar', 'monto',
      'montoAcreditar', 'referencia', 'usuarioId',
    ].concat(deposito.estado ? ['estado'] : []).sort());
    expect(deposito.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deposito.monto).toBeInstanceOf(Decimal);
    expect(deposito.montoAcreditar).toBeInstanceOf(Decimal);
    expect(deposito.monto.toFixed(2)).toBe('150.00');
    expect(deposito).toMatchObject({
      cuentaDestino: CUENTA, moneda: 'PEN', canal: 'AGENTE', referencia: 'Pago alquiler',
      usuarioId: 'usr-agente-1', monedaAcreditar: 'PEN',
    });
    expect(contexto).toMatchObject({ usuario: AGENTE_1, cuenta: CUENTA_PEN, correlationId: 'corr-1', db: db.pool });
    expect(typeof contexto.logger.info).toBe('function');
    expect(deps.transformadores.mock.calls[0][1]).toBe(contexto);
    expect(deps.persistir.mock.calls[0][2]).toBe(contexto);
    expect(deps.postProcesos.mock.calls[0][1]).toBe(contexto);
    expect(deps.postProcesos.mock.calls[0][0].estado).toBe('COMPLETADO');
    expect(deps.verificarTitular).toHaveBeenCalledWith(AGENTE_1, 'AGENTE', CUENTA_PEN);
  });

  test('RD-R03 sin referencia → null; "10.10" se acepta y se guarda como Decimal', async () => {
    await service.registrar({ ...DATOS, monto: '10.10' }, AGENTE_1, 'c');
    expect(deps.validadores.mock.calls[0][0].referencia).toBeNull();
    expect(deps.insertar.mock.calls[0][1].monto.toFixed(2)).toBe('10.10');
  });

  test('RD-R09 el transformador agrega extensiones y cambia monedaAcreditar → se acredita lo transformado y la respuesta trae extensiones', async () => {
    deps.transformadores.mockImplementationOnce(async (d) => ({
      ...d,
      montoAcreditar: new Decimal('370.00'),
      monedaAcreditar: 'PEN',
      extensiones: { conversion: { tasa: '3.70' } },
    }));

    const res = await service.registrar({ ...DATOS, monto: '100.00', moneda: 'USD' }, AGENTE_1, 'c');

    expect(res.extensiones).toEqual({ conversion: { tasa: '3.70' } });
    const [credito] = deps.acreditar.mock.calls[0];
    expect(credito.monto.toFixed(2)).toBe('370.00');
    expect(credito.moneda).toBe('PEN');
    expect(deps.insertar.mock.calls[0][1].monto.toFixed(2)).toBe('100.00');
  });

  test('SEG-R10/R11 verificarCanal o verificarTitular lanzan → 403 sin validadores ni TX', async () => {
    deps.verificarTitular.mockImplementationOnce(() => { throw new ErrorApp('SIN_PERMISO'); });
    await expect(service.registrar(DATOS, AGENTE_1, 'c')).rejects.toMatchObject({ status: 403 });
    expect(deps.validadores).not.toHaveBeenCalled();
    expect(deps.enTransaccion).not.toHaveBeenCalled();
  });

  test('RD-R07 el INSERT falla → el error se propaga y no se llama a billetera ni a cambiarEstado', async () => {
    deps.insertar.mockRejectedValueOnce(new Error('violación de restricción'));

    await expect(service.registrar(DATOS, AGENTE_1, 'c')).rejects.toThrow('violación de restricción');
    expect(deps.acreditar).not.toHaveBeenCalled();
    expect(deps.cambiarEstado).not.toHaveBeenCalled();
  });

  test('acreditar lanza un error que no es ErrorApp → se relanza tal cual; no pasa a FALLIDO', async () => {
    const raro = new TypeError('inesperado');
    deps.acreditar.mockRejectedValueOnce(raro);

    await expect(service.registrar(DATOS, AGENTE_1, 'c')).rejects.toBe(raro);
    expect(orden).not.toContain('PROCESANDO→FALLIDO');
  });

  test('RD-R08 reintentar COMPLETADO → aJson con extensiones de leerExtensiones; sin acreditar', async () => {
    deps.buscarPorId.mockResolvedValueOnce(fila('COMPLETADO', { referencia: 'Pago alquiler' }));
    deps.leerExtensiones.mockResolvedValueOnce({ uif: { alerta: false } });

    const res = await service.reintentar(ID, AGENTE_1, 'c');

    expect(res).toEqual({
      id: ID, cuentaDestino: CUENTA, monto: '150.00', moneda: 'PEN', canal: 'AGENTE',
      referencia: 'Pago alquiler', estado: 'COMPLETADO', creadoEn: FECHA.toISOString(),
      actualizadoEn: FECHA.toISOString(), extensiones: { uif: { alerta: false } },
    });
    expect(deps.acreditar).not.toHaveBeenCalled();
    expect(deps.cambiarEstado).not.toHaveBeenCalled();
    expect(deps.leerExtensiones.mock.calls[0][1]).toMatchObject({ cuenta: null, usuario: AGENTE_1 });
  });

  test('RD-R08 reintentar FALLIDO acredita monto_acreditar/moneda_acreditar guardados; post-procesos con contexto.cuenta = null', async () => {
    deps.buscarPorId.mockResolvedValueOnce(fila('FALLIDO', {
      monto: '100.00', moneda: 'USD', monto_acreditar: '370.00', moneda_acreditar: 'PEN',
    }));
    deps.leerExtensiones.mockResolvedValueOnce({ conversion: { tasa: '3.70' } });

    const res = await service.reintentar(ID, AGENTE_1, 'c');

    const [credito] = deps.acreditar.mock.calls[0];
    expect(credito.monto).toBeInstanceOf(Decimal);
    expect(credito.monto.toFixed(2)).toBe('370.00');
    expect(credito.moneda).toBe('PEN');
    expect(credito.cuenta).toBe(CUENTA);
    const [deposito, contexto] = deps.postProcesos.mock.calls[0];
    expect(contexto.cuenta).toBeNull();
    expect(deposito).toMatchObject({ id: ID, moneda: 'USD', estado: 'COMPLETADO' });
    expect(res.extensiones).toEqual({ conversion: { tasa: '3.70' } });
  });

  test('RD-R08 reintentar PENDIENTE/PROCESANDO → 409 SOLICITUD_EN_PROCESO con depositoId; inexistente → Error 500', async () => {
    for (const estado of ['PENDIENTE', 'PROCESANDO']) {
      deps.buscarPorId.mockResolvedValueOnce(fila(estado));
      await expect(service.reintentar(ID, AGENTE_1, 'c'))
        .rejects.toMatchObject({ codigo: 'SOLICITUD_EN_PROCESO', status: 409, depositoId: ID });
    }
    deps.buscarPorId.mockResolvedValueOnce(null);
    const error = await service.reintentar(ID, AGENTE_1, 'c').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ErrorApp);
    expect(deps.acreditar).not.toHaveBeenCalled();
  });

  test('RD-R08 si leerExtensiones falla en el reintento → no cambia de estado ni acredita', async () => {
    deps.buscarPorId.mockResolvedValueOnce(fila('FALLIDO'));
    deps.leerExtensiones.mockRejectedValueOnce(new Error('falla de lectura'));

    await expect(service.reintentar(ID, AGENTE_1, 'c')).rejects.toThrow('falla de lectura');
    expect(deps.cambiarEstado).not.toHaveBeenCalled();
    expect(deps.acreditar).not.toHaveBeenCalled();
  });
});

describe('SPEC-07 repository (db simulada)', () => {
  test('RD-R06 cambiarEstado: UPDATE condicionado a `de`; 0 filas → Error; transición inválida → Error sin consulta', async () => {
    jest.restoreAllMocks();
    const query = jest.fn().mockResolvedValueOnce({ rows: [fila('PROCESANDO')] })
      .mockResolvedValueOnce({ rows: [] });
    const dbFalsa = { query };

    await expect(repository.cambiarEstado(dbFalsa, ID, 'PENDIENTE', 'PROCESANDO'))
      .resolves.toMatchObject({ estado: 'PROCESANDO' });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE depositos SET estado = \$3, actualizado_en = now\(\)\s+WHERE id = \$1 AND estado = \$2/);
    expect(query.mock.calls[0][1]).toEqual([ID, 'PENDIENTE', 'PROCESANDO']);

    await expect(repository.cambiarEstado(dbFalsa, ID, 'PROCESANDO', 'COMPLETADO')).rejects.toThrow();

    for (const [de, a] of [['PENDIENTE', 'COMPLETADO'], ['COMPLETADO', 'PROCESANDO'], ['FALLIDO', 'COMPLETADO'], ['OTRO', 'PROCESANDO']]) {
      await expect(repository.cambiarEstado(dbFalsa, ID, de, a)).rejects.toThrow();
    }
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('insertar guarda montos con toFixed(2) y estado PENDIENTE; buscarPorId devuelve null si no hay fila', async () => {
    jest.restoreAllMocks();
    const query = jest.fn().mockResolvedValueOnce({ rows: [fila('PENDIENTE')] })
      .mockResolvedValueOnce({ rows: [] });
    const tx = { query };

    await repository.insertar(tx, {
      id: ID, cuentaDestino: CUENTA, monto: new Decimal('150'), moneda: 'USD',
      montoAcreditar: new Decimal('555.5'), monedaAcreditar: 'PEN', canal: 'AGENTE',
      referencia: null, usuarioId: 'usr-agente-1',
    });
    expect(query.mock.calls[0][0]).toMatch(/'PENDIENTE'/);
    expect(query.mock.calls[0][1]).toEqual([
      ID, CUENTA, '150.00', 'USD', '555.50', 'PEN', 'AGENTE', null, 'usr-agente-1',
    ]);
    expect(await repository.buscarPorId(tx, ID)).toBeNull();
  });

  test('schema e index: contrato del módulo endpoint y body estricto', () => {
    expect(modulo).toMatchObject({ id: 'registrar-deposito', tipo: 'endpoint' });
    expect(typeof modulo.router).toBe('function');
    expect(esquemaDeposito.safeParse(DATOS).success).toBe(true);
    expect(esquemaDeposito.safeParse({ ...DATOS, x: 1 }).success).toBe(false);
    expect(esquemaDeposito.safeParse({ ...DATOS, monto: 150 }).success).toBe(false);
  });
});
