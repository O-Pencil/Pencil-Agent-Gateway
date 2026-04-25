/**
 * Pencil Agent Gateway Error Types
 *
 * [WHO]  Gateway developers
 * [FROM] Engine adapters, routes, auth middleware
 * [TO]  HTTP response handlers
 * [HERE] Centralized error definitions for consistent error handling
 */

/**
 * Base Gateway error
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'internal_error'
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Invalid request error (400)
 */
export class InvalidRequestError extends GatewayError {
  constructor(message: string) {
    super(message, 400, 'invalid_request');
    this.name = 'InvalidRequestError';
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends GatewayError {
  constructor(message: string = 'Missing or invalid API key') {
    super(message, 401, 'unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends GatewayError {
  constructor(message: string) {
    super(message, 403, 'forbidden_agent');
    this.name = 'ForbiddenError';
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends GatewayError {
  constructor(message: string) {
    super(message, 404, 'agent_not_found');
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends GatewayError {
  constructor(message: string) {
    super(message, 409, 'agent_conflict');
    this.name = 'ConflictError';
  }
}

/**
 * Unsupported feature error (422)
 */
export class UnsupportedFeatureError extends GatewayError {
  constructor(message: string) {
    super(message, 422, 'unsupported_feature');
    this.name = 'UnsupportedFeatureError';
  }
}

/**
 * Engine error (500)
 */
export class EngineError extends GatewayError {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message, 500, 'engine_error');
    this.name = 'EngineError';
  }
}

/**
 * Client cancelled error (408)
 */
export class ClientCancelledError extends GatewayError {
  constructor() {
    super('Client cancelled request', 408, 'client_cancelled');
    this.name = 'ClientCancelledError';
  }
}
