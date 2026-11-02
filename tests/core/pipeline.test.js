'use strict';

const { randomUUID } = require('node:crypto');

const Decimal = require('decimal.js');

const { ErrorApp } = require('../../src/core/errores');
const { logger } = require('../../src/core/logger');
const { cargar } = require('../../src/core/cargador');
const pipeline = require('../../src/core/pipeline');
const registro = require('./fixtures/registro');
const { registrarFixtures, manifest, activa, inactiva } = require('./fixtures/modulos');

registrarFixtures(jest);

// SPEC-06 §4 con datos de SPEC-02 §4.
function nuevoDeposito() {
  return {
    id: randomUUID(),
    cuentaDestino: '0011-0123-456789',
    monto: new Decimal('150.00'),
    moneda: 'PEN',
    canal: 'AGENTE',
    referencia: null,
    usuarioId: 'usr-agente-1',
    montoAcreditar: new Decimal('150.00'),
    monedaAcreditar: 'PEN',
    extensiones: {},
  };
}

function nuevoContexto() {
  return {
    usuario: { id: 'usr-agente-1', roles: ['AGENTE'] },
    cuenta: { numero: '0011-0123-456789', estado: 'ACTIVA', moneda: 'PEN', titularId: 'usr-cliente-1' },
    correlationId: 'corr-pip-0001',
    logger,
    db: { soy: 'pool' },
  };
}

function llamadas(fase) {
  return registro.llamadas.filter((l) => l.fase === fase).map((l) => l.id);
}

// Captura lo que cada módulo escribe en su logger.child.
function espiarLoggerHijo() {
  const errores = [];
  const hijos = [];
  jest.spyOn(logger, 'child').mockImplementation((bindings) => {
    hijos.push(bindings);
    const noop = () => {};
    return {
      error: (obj, msg) => errores.push({ bindings, obj, msg }),
      warn: noop,
      info: noop,
      debug: noop,
      trace: noop,
      fatal: noop,
    };
  });
  return { errores, hijos };
}

beforeEach(() => {
  registro.reiniciar();
  pipeline.reiniciar();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SPEC-06 · pipeline', () => {
  test('PIP-T01 manifest sin extensiones → los 4 huecos no hacen nada', async () => {
    // Primero se cargan extensiones, para demostrar que el manifest vacío las quita.
    cargar(manifest(activa('fx-validador-diez', 'validador', 10), activa('fx-post-a', 'post-proceso', 10)));
    cargar(manifest(
      inactiva('fx-validador-diez', 'validador', 10),
      inactiva('fx-transformador-a', 'transformador', 10),
      inactiva('fx-post-a', 'post-proceso', 10),
    ));

    const deposito = nuevoDeposito();
    const copia = { ...deposito };
    const contexto = nuevoContexto();

    await expect(pipeline.ejecutarValidadores(deposito, contexto)).resolves.toBeUndefined();
    await expect(pipeline.ejecutarTransformadores(deposito, contexto)).resolves.toBe(deposito);
    await expect(pipeline.persistirTransformadores(deposito, { tx: true }, contexto)).resolves.toBeUndefined();
    await expect(pipeline.ejecutarPostProcesos({ ...deposito, estado: 'COMPLETADO' }, contexto))
      .resolves.toBeUndefined();
    await expect(pipeline.leerExtensiones(deposito.id, contexto)).resolves.toEqual({});

    expect(registro.llamadas).toEqual([]);
    expect(deposito).toEqual(copia);
  });

  test('PIP-T01 manifest con features: [] → los huecos tampoco hacen nada', async () => {
    cargar(manifest());
    const deposito = nuevoDeposito();
    await expect(pipeline.ejecutarTransformadores(deposito, nuevoContexto())).resolves.toBe(deposito);
    await expect(pipeline.leerExtensiones(deposito.id, nuevoContexto())).resolves.toEqual({});
    expect(registro.llamadas).toEqual([]);
  });

  test('PIP-T02 validadores con orden 20 y 10 → corre primero el de orden 10', async () => {
    // El de orden 20 va primero en el manifest: el orden sale de `orden`, no de la posición.
    cargar(manifest(
      activa('fx-validador-veinte', 'validador', 20),
      activa('fx-validador-diez', 'validador', 10),
    ));

    await pipeline.ejecutarValidadores(nuevoDeposito(), nuevoContexto());

    expect(llamadas('ejecutar')).toEqual(['fx-validador-diez', 'fx-validador-veinte']);
  });

  test('PIP-T03 un validador lanza → el siguiente no corre; el error llega intacto', async () => {
    cargar(manifest(
      activa('fx-validador-veinte', 'validador', 20),
      activa('fx-validador-diez', 'validador', 10),
    ));
    registro.lanzar.add('fx-validador-diez');

    const err = await pipeline.ejecutarValidadores(nuevoDeposito(), nuevoContexto()).catch((e) => e);

    expect(err).toBeInstanceOf(ErrorApp);
    expect(err.codigo).toBe('FX_RECHAZO_DIEZ');
    expect(err.status).toBe(422);
    expect(err.mensaje).toBe('Rechazo de prueba de fx-validador-diez.');
    expect(llamadas('ejecutar')).toEqual(['fx-validador-diez']);
  });

  test('PIP-T04 dos transformadores → el segundo recibe lo que devolvió el primero', async () => {
    cargar(manifest(
      activa('fx-transformador-b', 'transformador', 20),
      activa('fx-transformador-a', 'transformador', 10),
    ));
    const deposito = nuevoDeposito();

    const final = await pipeline.ejecutarTransformadores(deposito, nuevoContexto());

    const [primera, segunda] = registro.llamadas.filter((l) => l.fase === 'ejecutar');
    expect(primera.id).toBe('fx-transformador-a');
    expect(primera.deposito).toBe(deposito);
    expect(segunda.id).toBe('fx-transformador-b');
    expect(segunda.deposito).not.toBe(deposito);
    expect(segunda.deposito.extensiones).toEqual({ 'fx-transformador-a': { aplicado: true } });
    expect(final.extensiones).toEqual({
      'fx-transformador-a': { aplicado: true },
      'fx-transformador-b': { aplicado: true },
    });
    expect(final.id).toBe(deposito.id);
  });

  test('PIP-T05 post-proceso que lanza → no se propaga; logger.error con depositoId; el siguiente corre', async () => {
    cargar(manifest(
      activa('fx-post-a', 'post-proceso', 10),
      activa('fx-post-b', 'post-proceso', 20),
    ));
    registro.lanzar.add('fx-post-a');
    const { errores } = espiarLoggerHijo();
    const deposito = { ...nuevoDeposito(), estado: 'COMPLETADO' };

    await expect(pipeline.ejecutarPostProcesos(deposito, nuevoContexto())).resolves.toBeUndefined();

    expect(llamadas('ejecutar')).toEqual(['fx-post-a', 'fx-post-b']);
    expect(errores).toHaveLength(1);
    expect(errores[0].bindings).toEqual({ correlationId: 'corr-pip-0001', modulo: 'fx-post-a' });
    expect(errores[0].obj.depositoId).toBe(deposito.id);
    expect(errores[0].obj.error).toBe('post-proceso fx-post-a falló');
  });

  test('PIP-T06 leerExtensiones con un módulo que devuelve null → su clave no aparece', async () => {
    cargar(manifest(
      activa('fx-validador-diez', 'validador', 10),
      activa('fx-transformador-a', 'transformador', 10),
      activa('fx-post-a', 'post-proceso', 10),
    ));
    registro.extensiones['fx-transformador-a'] = { tipoCambio: '3.75' };
    registro.extensiones['fx-validador-diez'] = null;
    const deposito = nuevoDeposito();

    const extensiones = await pipeline.leerExtensiones(deposito.id, nuevoContexto());

    expect(extensiones).toEqual({ 'fx-transformador-a': { tipoCambio: '3.75' } });
    expect(Object.keys(extensiones)).not.toContain('fx-validador-diez');
    expect(Object.keys(extensiones)).not.toContain('fx-post-a');
    expect(registro.llamadas.filter((l) => l.fase === 'leerExtension').map((l) => l.depositoId))
      .toEqual([deposito.id, deposito.id, deposito.id]);
  });

  describe('reglas PIP-R02, R03, R07', () => {
    test('PIP-R02 un transformador lanza → ErrorApp ERROR_INTERNO 500 y el siguiente no corre', async () => {
      cargar(manifest(
        activa('fx-transformador-a', 'transformador', 10),
        activa('fx-transformador-b', 'transformador', 20),
      ));
      registro.lanzar.add('fx-transformador-a');
      const { errores } = espiarLoggerHijo();
      const deposito = nuevoDeposito();

      const err = await pipeline.ejecutarTransformadores(deposito, nuevoContexto()).catch((e) => e);

      expect(err).toBeInstanceOf(ErrorApp);
      expect(err.codigo).toBe('ERROR_INTERNO');
      expect(err.status).toBe(500);
      expect(llamadas('ejecutar')).toEqual(['fx-transformador-a']);
      expect(errores).toHaveLength(1);
      expect(errores[0].bindings.modulo).toBe('fx-transformador-a');
      expect(errores[0].obj).toEqual({
        depositoId: deposito.id,
        error: 'fallo de prueba en fx-transformador-a',
        codigoError: '23505',
      });
    });

    test('PIP-R03 persistir recibe deposito y tx; solo los transformadores que lo tienen', async () => {
      cargar(manifest(
        activa('fx-transformador-a', 'transformador', 10),
        activa('fx-transformador-sin-persistir', 'transformador', 15),
        activa('fx-transformador-b', 'transformador', 20),
      ));
      const deposito = nuevoDeposito();
      const tx = { soy: 'tx' };

      await pipeline.persistirTransformadores(deposito, tx, nuevoContexto());

      const persistidos = registro.llamadas.filter((l) => l.fase === 'persistir');
      expect(persistidos.map((l) => l.id)).toEqual(['fx-transformador-a', 'fx-transformador-b']);
      for (const l of persistidos) {
        expect(l.deposito).toBe(deposito);
        expect(l.tx).toBe(tx);
      }
    });

    test('PIP-R03 si un persistir lanza, el error se propaga tal cual', async () => {
      cargar(manifest(
        activa('fx-transformador-a', 'transformador', 10),
        activa('fx-transformador-b', 'transformador', 20),
      ));
      registro.lanzar.add('fx-transformador-a:persistir');

      await expect(pipeline.persistirTransformadores(nuevoDeposito(), {}, nuevoContexto()))
        .rejects.toThrow('persistir falló en fx-transformador-a');
      expect(llamadas('persistir')).toEqual(['fx-transformador-a']);
    });

    test('PIP-R07 privado distinto por id y el mismo de ejecutar a persistir', async () => {
      cargar(manifest(
        activa('fx-transformador-a', 'transformador', 10),
        activa('fx-transformador-b', 'transformador', 20),
      ));
      const contexto = nuevoContexto();
      const deposito = await pipeline.ejecutarTransformadores(nuevoDeposito(), contexto);
      await pipeline.persistirTransformadores(deposito, {}, contexto);

      const priv = (id, fase) => registro.llamadas.find((l) => l.id === id && l.fase === fase).contexto.privado;
      expect(priv('fx-transformador-a', 'ejecutar')).not.toBe(priv('fx-transformador-b', 'ejecutar'));
      expect(priv('fx-transformador-a', 'persistir')).toBe(priv('fx-transformador-a', 'ejecutar'));
      expect(priv('fx-transformador-b', 'persistir')).toBe(priv('fx-transformador-b', 'ejecutar'));
      expect(priv('fx-transformador-a', 'persistir')).toEqual({ marca: 'privado-fx-transformador-a' });
      // El contexto del service no recibe ni privado ni otro logger.
      expect(contexto.privado).toBeUndefined();
      expect(contexto.logger).toBe(logger);
    });

    test('PIP-R07 / §4 cada módulo recibe usuario, cuenta, correlationId, db y logger.child({ correlationId, modulo })', async () => {
      cargar(manifest(activa('fx-validador-diez', 'validador', 10)));
      const { hijos } = espiarLoggerHijo();
      const contexto = nuevoContexto();

      await pipeline.ejecutarValidadores(nuevoDeposito(), contexto);

      const recibido = registro.llamadas[0].contexto;
      expect(recibido.usuario).toBe(contexto.usuario);
      expect(recibido.cuenta).toBe(contexto.cuenta);
      expect(recibido.correlationId).toBe('corr-pip-0001');
      expect(recibido.db).toBe(contexto.db);
      expect(recibido.privado).toEqual({});
      expect(hijos).toEqual([{ correlationId: 'corr-pip-0001', modulo: 'fx-validador-diez' }]);
    });

    test('PIP-R08 a igual orden se respeta la posición del manifest', async () => {
      cargar(manifest(
        activa('fx-validador-veinte', 'validador', 10),
        activa('fx-validador-diez', 'validador', 10),
      ));
      await pipeline.ejecutarValidadores(nuevoDeposito(), nuevoContexto());
      expect(llamadas('ejecutar')).toEqual(['fx-validador-veinte', 'fx-validador-diez']);
    });

    test('registrar con un tipo que no es extensión → lanza', () => {
      expect(() => pipeline.registrar({ id: 'fx-endpoint', tipo: 'endpoint' }, 1)).toThrow(/desconocido/);
    });
  });
});
