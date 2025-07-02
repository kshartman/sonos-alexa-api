/**
 * Custom error classes for the Sonos API
 * Provides a consistent error hierarchy with proper typing
 */

/**
 * Base error class for all Sonos-related errors
 */
export class SonosError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'SonosError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SonosError);
    }
  }
}

/**
 * Error thrown when a device cannot be found
 */
export class DeviceNotFoundError extends SonosError {
  constructor(roomName: string) {
    super(`Device not found: ${roomName}`, 'DEVICE_NOT_FOUND');
    this.name = 'DeviceNotFoundError';
  }
}

/**
 * Error thrown when a SOAP request fails
 */
export class SOAPError extends SonosError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly action: string,
    public readonly faultCode?: string,
    public readonly detail?: unknown
  ) {
    super(message, faultCode);
    this.name = 'SOAPError';
  }

  /**
   * Create a SOAPError from a SOAP fault response
   */
  static fromFault(
    service: string,
    action: string,
    fault: { faultcode?: string; faultstring?: string; detail?: unknown }
  ): SOAPError {
    const message = fault.faultstring || 'SOAP fault';
    return new SOAPError(message, service, action, fault.faultcode, fault.detail);
  }
}

/**
 * Error thrown when a UPnP error occurs
 */
export class UPnPError extends SOAPError {
  constructor(
    service: string,
    action: string,
    public readonly errorCode: string,
    public readonly errorDescription?: string
  ) {
    super(
      errorDescription || `UPnP error ${errorCode}`,
      service,
      action,
      errorCode
    );
    this.name = 'UPnPError';
  }

  /**
   * Common UPnP error codes
   */
  static readonly ErrorCodes = {
    INVALID_ACTION: '401',
    INVALID_ARGS: '402',
    ACTION_FAILED: '501',
    ARGUMENT_VALUE_INVALID: '600',
    ARGUMENT_VALUE_OUT_OF_RANGE: '601',
    OPTIONAL_ACTION_NOT_IMPLEMENTED: '602',
    OUT_OF_MEMORY: '603',
    HUMAN_INTERVENTION_REQUIRED: '604',
    STRING_ARGUMENT_TOO_LONG: '605',
    ACTION_NOT_AUTHORIZED: '606',
    SIGNATURE_FAILURE: '607',
    SIGNATURE_MISSING: '608',
    NOT_ENCRYPTED: '609',
    INVALID_SEQUENCE: '610',
    INVALID_CONTROL_URL: '611',
    NO_SUCH_SESSION: '612',
    // Sonos-specific
    TRANSITION_NOT_AVAILABLE: '701',
    NO_CONTENTS: '714',
    READ_ERROR: '715',
    FORMAT_NOT_SUPPORTED: '716',
    TRANSPORT_IS_LOCKED: '717',
    WRITE_ERROR: '718',
    MEDIA_PROTECTED: '719',
    FORMAT_NOT_RECOGNIZED: '720',
    MEDIA_IS_FULL: '721',
    SEEK_MODE_NOT_SUPPORTED: '722',
    ILLEGAL_SEEK_TARGET: '723',
    PLAY_MODE_NOT_SUPPORTED: '724',
    RECORD_QUALITY_NOT_SUPPORTED: '725',
    ILLEGAL_MIME_TYPE: '726',
    CONTENT_BUSY: '727',
    RESOURCE_NOT_FOUND: '728',
    PLAY_SPEED_NOT_SUPPORTED: '729',
    INVALID_INSTANCE_ID: '730',
    NOT_LOGGED_IN: '800'
  } as const;

  /**
   * Check if this is a specific error code
   */
  isErrorCode(code: string): boolean {
    return this.errorCode === code;
  }
}

/**
 * Error thrown when an operation is not supported
 */
export class NotSupportedError extends SonosError {
  constructor(operation: string, reason?: string) {
    const message = reason 
      ? `Operation not supported: ${operation} (${reason})`
      : `Operation not supported: ${operation}`;
    super(message, 'NOT_SUPPORTED');
    this.name = 'NotSupportedError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends SonosError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_FAILED');
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends SonosError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when a network request times out
 */
export class TimeoutError extends SonosError {
  constructor(
    operation: string,
    public readonly timeoutMs: number
  ) {
    super(`Operation timed out after ${timeoutMs}ms: ${operation}`, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a preset is invalid
 */
export class InvalidPresetError extends SonosError {
  constructor(
    presetName: string,
    reason: string
  ) {
    super(`Invalid preset "${presetName}": ${reason}`, 'INVALID_PRESET');
    this.name = 'InvalidPresetError';
  }
}

/**
 * Error thrown when a music service operation fails
 */
export class MusicServiceError extends SonosError {
  constructor(
    service: string,
    operation: string,
    reason: string
  ) {
    super(`${service} ${operation} failed: ${reason}`, 'MUSIC_SERVICE_ERROR');
    this.name = 'MusicServiceError';
  }
}

/**
 * Type guard to check if an error is a SonosError
 */
export function isSonosError(error: unknown): error is SonosError {
  return error instanceof SonosError;
}

/**
 * Type guard to check if an error is a SOAPError
 */
export function isSOAPError(error: unknown): error is SOAPError {
  return error instanceof SOAPError;
}

/**
 * Type guard to check if an error is a UPnPError
 */
export function isUPnPError(error: unknown): error is UPnPError {
  return error instanceof UPnPError;
}

/**
 * Get a user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'An unknown error occurred';
}

/**
 * Get an appropriate HTTP status code for an error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof DeviceNotFoundError) {
    return 404;
  }
  if (error instanceof AuthenticationError) {
    return 401;
  }
  if (error instanceof ValidationError) {
    return 400;
  }
  if (error instanceof NotSupportedError) {
    return 501;
  }
  if (error instanceof TimeoutError) {
    return 504;
  }
  if (error instanceof UPnPError) {
    // Map common UPnP errors to HTTP status codes
    switch (error.errorCode) {
      case UPnPError.ErrorCodes.INVALID_ARGS:
      case UPnPError.ErrorCodes.ARGUMENT_VALUE_INVALID:
      case UPnPError.ErrorCodes.ARGUMENT_VALUE_OUT_OF_RANGE:
        return 400;
      case UPnPError.ErrorCodes.ACTION_NOT_AUTHORIZED:
      case UPnPError.ErrorCodes.NOT_LOGGED_IN:
        return 401;
      case UPnPError.ErrorCodes.RESOURCE_NOT_FOUND:
        return 404;
      case UPnPError.ErrorCodes.TRANSITION_NOT_AVAILABLE:
      case UPnPError.ErrorCodes.NO_CONTENTS:
        return 409;
      default:
        return 500;
    }
  }
  return 500;
}