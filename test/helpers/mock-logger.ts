/**
 * Simple mock logger for unit tests that just uses console.log
 * No persistent resources, no file streams, no external dependencies
 */
export const mockLogger = {
  error: (message: string, ...args: unknown[]) => {
    // Only log errors in unit tests
    if (process.env.LOG_LEVEL !== 'error') return;
    console.log(`[ERROR] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    // Silent in unit tests
  },
  info: (message: string, ...args: unknown[]) => {
    // Silent in unit tests
  },
  debug: (message: string, ...args: unknown[]) => {
    // Silent in unit tests
  },
  trace: (message: string, ...args: unknown[]) => {
    // Silent in unit tests
  },
  always: (message: string, ...args: unknown[]) => {
    console.log(`[ALWAYS] ${message}`, ...args);
  },
  level: 'error'
};

export default mockLogger;