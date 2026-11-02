'use strict';

const billeteraClient = require('../../../src/core/clients/billeteraClient');
const db = require('../../../src/core/db');
const { ErrorApp } = require('../../../src/core/errores');
const pipeline = require('../../../src/core/pipeline');
const repository = require('../../../src/modules/consultar-deposito/repository');
const service = require('../../../src/modules/consultar-deposito/service');

const CUENTA = '0011-0123-456789';
const ID = '7f1c2e9a-0b1d-4c5e-9f00-123456789abc';
const FECHA = new Date('2026-10-13T19:20:00.000Z');
const CUENTA_CLIENTE_1 = { numero: CUENTA, estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' };

function fila(usuarioId = 'usr-agente-1') {
  return {
    id: ID,
    cuenta_destino: CUENTA,
    monto: '100.00',
    moneda: 'PEN',
    monto_acreditar: '100.00',
    moneda_acreditar: 'PEN',
    canal: 'AGENTE',
    referencia: null,
    estado: 'COMPLETADO',
    usuario_id: usuarioId,
    creado_en: FECHA,
    actualizado_en: FECHA,
  };
}

let deps;

beforeEach(() => {
  deps = {
    buscarPorId: jest.spyOn(repository, 'buscarPorId').mockResolvedValue(fila()),
    consultarCuenta: jest.spyOn(billeteraClient, 'consultarCuenta')
      .mockResolvedValue({ ...CUENTA_CLIENTE_1 }),
    leerExtensiones: jest.spyOn(pipeline, 'leerExtensiones').mockResolvedValue({}),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await db.pool.end();
});

async function esperarNoEncontrado(promesa) {
  const err = await promesa.catch((e) => e);
  expect(err).toBeInstanceOf(ErrorApp);
  expect(err).toMatchObject({ codigo: 'DEPOSITO_NO_ENCONTRADO', status: 404 });
}

describe('SPEC-08 service: decisión 2 de impl_08 (usuario con varios roles)', () => {
  // Precedente SEG-R13: usuarios de SPEC-02 §4 con un rol adicional para probar "alguna" condición.
  test('AGENTE+CLIENTE que lo registró → 200 por la 1ª condición, sin consultar billetera', async () => {
    const usuario = { id: 'usr-agente-1', roles: ['AGENTE', 'CLIENTE'] };

    const res = await service.consultar(ID, usuario, 'c');

    expect(res.id).toBe(ID);
    expect(deps.consultarCuenta).not.toHaveBeenCalled();
    expect(deps.leerExtensiones.mock.calls[0][1].cuenta).toBeNull();
  });

  test('CAJERO+CLIENTE que no lo registró pero es titular → consulta billetera y 200', async () => {
    const usuario = { id: 'usr-cliente-1', roles: ['CAJERO', 'CLIENTE'] };

    const res = await service.consultar(ID, usuario, 'c');

    expect(res.id).toBe(ID);
    expect(deps.consultarCuenta).toHaveBeenCalledWith(CUENTA, 'c');
    expect(deps.leerExtensiones.mock.calls[0][1].cuenta).toEqual(CUENTA_CLIENTE_1);
  });

  test('AGENTE+CLIENTE que no lo registró ni es titular → 404 tras consultar billetera', async () => {
    const usuario = { id: 'usr-agente-2', roles: ['AGENTE', 'CLIENTE'] };

    await esperarNoEncontrado(service.consultar(ID, usuario, 'c'));

    expect(deps.consultarCuenta).toHaveBeenCalledTimes(1);
    expect(deps.leerExtensiones).not.toHaveBeenCalled();
  });
});

describe('SPEC-08 service: reglas', () => {
  test('CD-R02 CLIENTE con el mismo id que usuario_id pero sin rol de operador no entra por la 1ª condición', async () => {
    deps.buscarPorId.mockResolvedValue(fila('usr-cliente-2'));
    const usuario = { id: 'usr-cliente-2', roles: ['CLIENTE'] };

    await esperarNoEncontrado(service.consultar(ID, usuario, 'c'));

    expect(deps.consultarCuenta).toHaveBeenCalledTimes(1);
  });

  test('CD-R03 usuario sin roles (o sin usuario) → 404 sin consultar billetera', async () => {
    await esperarNoEncontrado(service.consultar(ID, { id: 'usr-agente-1' }, 'c'));
    await esperarNoEncontrado(service.consultar(ID, undefined, 'c'));

    expect(deps.consultarCuenta).not.toHaveBeenCalled();
  });

  test('CD-R04 consultarCuenta devuelve null → 404', async () => {
    deps.consultarCuenta.mockResolvedValue(null);

    await esperarNoEncontrado(service.consultar(ID, { id: 'usr-cliente-1', roles: ['CLIENTE'] }, 'c'));
    expect(deps.leerExtensiones).not.toHaveBeenCalled();
  });

  test('CD-R06 el error de billetera se propaga tal cual (BILLETERA_NO_DISPONIBLE 502)', async () => {
    deps.consultarCuenta.mockRejectedValue(new ErrorApp('BILLETERA_NO_DISPONIBLE'));

    await expect(service.consultar(ID, { id: 'usr-cliente-1', roles: ['CLIENTE'] }, 'c'))
      .rejects.toMatchObject({ codigo: 'BILLETERA_NO_DISPONIBLE', status: 502 });
  });

  test('CD-R07 la respuesta es aJson(fila, leerExtensiones(id, contexto))', async () => {
    deps.leerExtensiones.mockResolvedValue({ 'fx-ext': { a: 1 } });

    const res = await service.consultar(ID, { id: 'usr-agente-1', roles: ['AGENTE'] }, 'corr');

    expect(deps.buscarPorId).toHaveBeenCalledWith(db.pool, ID);
    expect(deps.leerExtensiones).toHaveBeenCalledWith(ID, expect.objectContaining({
      usuario: { id: 'usr-agente-1', roles: ['AGENTE'] },
      cuenta: null,
      correlationId: 'corr',
      db: db.pool,
    }));
    expect(res).toEqual({
      id: ID,
      cuentaDestino: CUENTA,
      monto: '100.00',
      moneda: 'PEN',
      canal: 'AGENTE',
      referencia: null,
      estado: 'COMPLETADO',
      creadoEn: '2026-10-13T19:20:00.000Z',
      actualizadoEn: '2026-10-13T19:20:00.000Z',
      extensiones: { 'fx-ext': { a: 1 } },
    });
  });
});
