import { describe, it, expect } from 'vitest';
import {
  GatewayError,
  InvalidRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnsupportedFeatureError,
  EngineError,
  ClientCancelledError,
} from './errors.js';

describe('errors', () => {
  it('should create GatewayError with default status', () => {
    const err = new GatewayError('test');
    expect(err.message).toBe('test');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('internal_error');
  });

  it('should create InvalidRequestError with 400 status', () => {
    const err = new InvalidRequestError('bad request');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('invalid_request');
  });

  it('should create UnauthorizedError with 401 status', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('unauthorized');
  });

  it('should create ForbiddenError with 403 status', () => {
    const err = new ForbiddenError('access denied');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('forbidden_agent');
  });

  it('should create NotFoundError with 404 status', () => {
    const err = new NotFoundError('not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('agent_not_found');
  });

  it('should create ConflictError with 409 status', () => {
    const err = new ConflictError('conflict');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('agent_conflict');
  });

  it('should create UnsupportedFeatureError with 422 status', () => {
    const err = new UnsupportedFeatureError('not supported');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('unsupported_feature');
  });

  it('should create EngineError with 500 status', () => {
    const err = new EngineError('engine failed');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('engine_error');
    expect(err.originalError).toBeUndefined();
  });

  it('should create ClientCancelledError with 408 status', () => {
    const err = new ClientCancelledError();
    expect(err.statusCode).toBe(408);
    expect(err.code).toBe('client_cancelled');
  });
});
