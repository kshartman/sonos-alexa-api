/**
 * Simple logger for tests that respects TEST_DEBUG environment variable
 */
export const testLog = {
  log: (...args: any[]) => {
    if (process.env.TEST_DEBUG === 'true' || process.env.LOG_LEVEL === 'debug') {
      console.log(...args);
    }
  },
  error: (...args: any[]) => {
    console.error(...args);  // Always show errors
  },
  // Always show test descriptions and important status
  info: (...args: any[]) => {
    console.log(...args);
  }
};