'use strict';

const {
  AppError, ValidationError, UnauthorizedError,
  ForbiddenError, NotFoundError, ConflictError
} = require('../../src/utils/errors');

describe('error classes', () => {
  it.each([
    [ValidationError,   400, 'VALIDATION_ERROR'],
    [UnauthorizedError, 401, 'UNAUTHORIZED'],
    [ForbiddenError,    403, 'FORBIDDEN'],
    [NotFoundError,     404, 'NOT_FOUND'],
    [ConflictError,     409, 'CONFLICT']
  ])('%p carries status %i and code %s', (ErrorClass, status, code) => {
    const err = new ErrorClass();
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
    expect(err.isOperational).toBe(true);
  });

  it('NotFoundError names the missing resource', () => {
    expect(new NotFoundError('Project').message).toBe('Project not found');
  });

  it('ValidationError carries structured details', () => {
    const details = [{ field: 'email', message: 'required' }];
    expect(new ValidationError('bad input', details).details).toEqual(details);
  });

  it('AppError defaults to a 500 internal error', () => {
    const err = new AppError('boom');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('captures a stack trace', () => {
    expect(new AppError('boom').stack).toBeDefined();
  });
});
