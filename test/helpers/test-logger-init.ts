/**
 * Auto-initializes the test logger based on environment variables
 * This module should be imported before any test files to ensure logging works
 */
import { initTestLogger, closeTestLogger } from './test-logger.js';
import * as path from 'path';

// Add global type declaration
declare global {
  var __testLoggerInitialized: boolean | undefined;
}

// Check if we should initialize logging
const enableLogging = process.env.TEST_LOGGING === 'true';
const enableInteractive = process.env.TEST_INTERACTIVE === 'true';
const logPath = process.env.TEST_LOG_PATH;

if ((enableLogging || enableInteractive) && !global.__testLoggerInitialized) {
  // Initialize the logger
  initTestLogger(enableLogging, logPath, enableInteractive);
  
  // Mark as initialized to prevent double initialization
  global.__testLoggerInitialized = true;
  
  // Register cleanup on process exit
  process.on('exit', () => {
    try {
      closeTestLogger();
    } catch (error) {
      // Ignore errors during cleanup
    }
  });
}

// Export everything from test-logger for convenience
export * from './test-logger.js';