'use strict';

// SPEC-01 §5: catálogo del core. Las features agregan los suyos con registrarErrores (DOM-R09).
const catalogo = {
  FORMATO_INVALIDO: { status: 400, mensaje: 'JSON mal formado o campos con tipo incorrecto.' },
  IDEMPOTENCY_KEY_REQUERIDA: {
    status: 400,
    mensaje: 'Falta o es inválido el header Idempotency-Key.',
  },
  TOKEN_REQUERIDO: { status: 401, mensaje: 'Falta el token.' },
  TOKEN_INVALIDO: {
    status: 401,
    mensaje: 'Token mal firmado o con issuer/audience incorrectos.',
  },
  TOKEN_EXPIRADO: { status: 401, mensaje: 'Token vencido.' },
  SIN_PERMISO: { status: 403, mensaje: 'El rol o la cuenta no permiten la operación.' },
  DEPOSITO_NO_ENCONTRADO: { status: 404, mensaje: 'No existe un depósito con ese id.' },
  RUTA_NO_ENCONTRADA: { status: 404, mensaje: 'La ruta no existe.' },
  IDEMPOTENCY_KEY_REUTILIZADA: { status: 409, mensaje: 'Clave usada antes con otros datos.' },
  SOLICITUD_EN_PROCESO: {
    status: 409,
    mensaje: 'La solicitud original con esa clave aún se procesa.',
  },
  MONTO_INVALIDO: {
    status: 422,
    mensaje: 'Monto menor o igual a 0 o con más de 2 decimales.',
  },
  CUENTA_NO_ENCONTRADA: { status: 422, mensaje: 'La cuenta destino no existe.' },
  CUENTA_INACTIVA: { status: 422, mensaje: 'La cuenta destino no está activa.' },
  MONEDA_NO_SOPORTADA: {
    status: 422,
    mensaje: 'Moneda distinta a la de la cuenta y sin conversión disponible.',
  },
  ERROR_INTERNO: { status: 500, mensaje: 'Error no controlado.' },
  BILLETERA_NO_DISPONIBLE: { status: 502, mensaje: 'billetera-service falló o no respondió.' },
};

// DOM-R06: el código debe existir en el catálogo; depositoId es opcional.
class ErrorApp extends Error {
  constructor(codigo, { depositoId } = {}) {
    const definicion = catalogo[codigo];
    if (!definicion) {
      throw new Error(`Código de error no registrado en el catálogo: ${codigo}`);
    }
    super(definicion.mensaje);
    this.name = 'ErrorApp';
    this.codigo = codigo;
    this.status = definicion.status;
    this.mensaje = definicion.mensaje;
    if (depositoId !== undefined) this.depositoId = depositoId;
  }
}

function definicionValida(definicion) {
  return Boolean(definicion)
    && Number.isInteger(definicion.status)
    && typeof definicion.mensaje === 'string';
}

// DOM-R09: se valida todo antes de agregar, así un registro inválido no deja el catálogo a medias.
function registrarErrores(errores) {
  const entradas = Object.entries(errores || {});
  for (const [codigo, definicion] of entradas) {
    if (Object.hasOwn(catalogo, codigo)) {
      throw new Error(`El código de error ya existe en el catálogo: ${codigo}`);
    }
    if (!definicionValida(definicion)) {
      throw new Error(`Definición inválida para ${codigo}: se espera { status, mensaje }`);
    }
  }
  for (const [codigo, { status, mensaje }] of entradas) {
    catalogo[codigo] = { status, mensaje };
  }
}

// DOM-R08: Express 4 no captura el rechazo de una función async; se pasa a next.
function manejar(fn) {
  return async function manejado(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { ErrorApp, catalogo, registrarErrores, manejar };
