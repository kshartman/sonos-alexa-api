/**
 * Retry utility for handling transient failures
 */

import logger from './logger.js';
import { TimeoutError, UPnPError } from '../errors/sonos-errors.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (not including the initial attempt) */
  maxAttempts?: number;
  /** Initial delay between retries in milliseconds */
  initialDelay?: number;
  /** Maximum delay between retries in milliseconds */
  maxDelay?: number;
  /** Exponential backoff factor (e.g., 2 = double the delay each time) */
  backoffFactor?: number;
  /** Optional timeout for each attempt in milliseconds */
  timeout?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry attempt */
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'timeout' | 'onRetry'>> = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffFactor: 2,
  isRetryable: isDefaultRetryable
};

/**
 * Default logic to determine if an error is retryable
 */
function isDefaultRetryable(error: unknown): boolean {
  // Network errors are usually retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('enetunreach') ||
      message.includes('ehostunreach') ||
      message.includes('socket hang up')
    ) {
      return true;
    }
  }

  // Timeout errors are retryable
  if (error instanceof TimeoutError) {
    return true;
  }

  // Some UPnP errors are retryable
  if (error instanceof UPnPError) {
    const retryableCodes: string[] = [
      UPnPError.ErrorCodes.ACTION_FAILED,
      UPnPError.ErrorCodes.OUT_OF_MEMORY,
      UPnPError.ErrorCodes.CONTENT_BUSY,
      UPnPError.ErrorCodes.TRANSPORT_IS_LOCKED
    ];
    return retryableCodes.includes(error.errorCode);
  }

  return false;
}

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with timeout
 */
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Execute an async function with retry logic
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
  operation = 'operation'
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Execute with timeout if specified
      if (opts.timeout) {
        return await withTimeout(fn, opts.timeout, operation);
      } else {
        return await fn();
      }
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt === opts.maxAttempts || !opts.isRetryable(error)) {
        throw error;
      }

      // Log retry attempt
      logger.debug(
        `Retry attempt ${attempt + 1}/${opts.maxAttempts} for ${operation} after error:`,
        error instanceof Error ? error.message : error
      );

      // Call retry callback if provided
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1);
      }

      // Wait before retrying
      await sleep(delay);

      // Calculate next delay with exponential backoff
      delay = Math.min(delay * opts.backoffFactor, opts.maxDelay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  defaultOptions?: RetryOptions,
  operationName?: string
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    return retry(
      () => fn(...args),
      defaultOptions,
      operationName || fn.name || 'operation'
    );
  };
}

/**
 * Retry options specifically for SOAP requests
 */
export const SOAP_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 2,
  initialDelay: 200,
  maxDelay: 2000,
  backoffFactor: 2,
  timeout: 10000, // 10 second timeout per attempt
  isRetryable: (error) => {
    // Use default retry logic
    if (isDefaultRetryable(error)) {
      return true;
    }

    // Don't retry client errors (4xx equivalent)
    if (error instanceof UPnPError) {
      const nonRetryableCodes = [
        UPnPError.ErrorCodes.INVALID_ACTION,
        UPnPError.ErrorCodes.INVALID_ARGS,
        UPnPError.ErrorCodes.ARGUMENT_VALUE_INVALID,
        UPnPError.ErrorCodes.ARGUMENT_VALUE_OUT_OF_RANGE,
        UPnPError.ErrorCodes.ACTION_NOT_AUTHORIZED,
        UPnPError.ErrorCodes.INVALID_INSTANCE_ID
      ];
      return !nonRetryableCodes.includes(error.errorCode as typeof nonRetryableCodes[number]);
    }

    return false;
  }
};