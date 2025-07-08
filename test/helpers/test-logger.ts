import * as fs from 'fs';
import * as path from 'path';

let logStream: fs.WriteStream | null = null;
let isInteractive = false;

/**
 * Initialize the test logger
 * @param enableLogging - Whether to log to file
 * @param logFilePath - Path to log file (if enableLogging is true)
 * @param enableInteractive - Whether to enable interactive mode
 */
export function initTestLogger(enableLogging: boolean, logFilePath?: string, enableInteractive?: boolean) {
  if (enableLogging && logFilePath) {
    // Ensure logs directory exists
    const logsDir = path.dirname(logFilePath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    logStream = fs.createWriteStream(logFilePath);
    console.log(`📝 Test logger initialized. Logging to: ${logFilePath}`);
  }
  
  // Set interactive mode
  isInteractive = enableInteractive || false;
  
  // Check TTY for interactive mode - but only in CI
  if (isInteractive && process.env.CI) {
    console.warn('⚠️  Interactive mode disabled in CI environment');
    isInteractive = false;
  }
}

/**
 * Close the test logger
 */
export function closeTestLogger() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

/**
 * Simple logger for tests that respects LOG_LEVEL environment variable
 */
export const testLog = {
  log: (...args: any[]) => {
    if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace') {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      console.log(...args);
      
      if (logStream) {
        logStream.write('[DEBUG] ' + message + '\n');
      }
    }
  },
  // Debug messages (shown when LOG_LEVEL is debug or trace)
  debug: (...args: any[]) => {
    if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace') {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      console.log(...args);
      
      if (logStream) {
        logStream.write('[DEBUG] ' + message + '\n');
      }
    }
  },
  error: (...args: any[]) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    console.error(...args);  // Always show errors
    
    if (logStream) {
      logStream.write('[ERROR] ' + message + '\n');
    }
  },
  // Always show test descriptions and important status
  info: (...args: any[]) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    console.log(...args);
    
    if (logStream) {
      logStream.write(message + '\n');
    }
  },
  // Warning messages
  warn: (...args: any[]) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    console.warn(...args);
    
    if (logStream) {
      logStream.write('[WARN] ' + message + '\n');
    }
  },
  // Trace messages (only shown when LOG_LEVEL is trace)
  trace: (...args: any[]) => {
    if (process.env.LOG_LEVEL === 'trace') {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      console.log(...args);
      
      if (logStream) {
        logStream.write('[TRACE] ' + message + '\n');
      }
    }
  },
  // Flush any buffered output
  flush: () => {
    // Force flush stdout to ensure console output is displayed immediately
    if (process.stdout.write('')) {
      // Write an empty string to force flush
    }
    
    // Flush the log file stream if it exists
    if (logStream && typeof logStream.cork === 'function') {
      logStream.cork();
      logStream.uncork();
    }
  }
};

/**
 * Wait for user input in interactive mode
 * @param message - Message to display
 */
export async function waitForContinueFlag(message: string = '\n⏸️  Press Enter to continue...'): Promise<void> {
  // Check if interactive mode is enabled via environment variable as fallback
  const interactiveEnabled = isInteractive || process.env.TEST_INTERACTIVE === 'true';
  
  // Skip silently if not in interactive mode
  if (!interactiveEnabled) {
    return;
  }
  
  // Only show message if we're actually going to wait
  testLog.info(message);
  
  // Use file-based trigger for TTY-independent waiting
  const triggerFile = path.join(process.cwd(), 'tmp', 'test-continue.flag');
  const triggerDir = path.dirname(triggerFile);
  
  // Ensure tmp directory exists
  if (!fs.existsSync(triggerDir)) {
    fs.mkdirSync(triggerDir, { recursive: true });
  }
  
  // Remove any existing trigger file
  if (fs.existsSync(triggerFile)) {
    fs.unlinkSync(triggerFile);
  }
  
  testLog.info(`[WAITING_FOR_EXTERNAL_TRIGGER]`);
  testLog.info(`⏸️  To continue, run: touch ${triggerFile}`);
  testLog.info(`   Or press Ctrl+C to abort`);
  testLog.info(`   Working directory: ${process.cwd()}`);
  testLog.info(`   Trigger file path: ${triggerFile}`);
  
  // Wait for file to exist
  const checkInterval = 500; // Check every 500ms
  const timeout = 300000; // 5 minute timeout
  const startTime = Date.now();
  
  return new Promise<void>((resolve, reject) => {
    let checkCount = 0;
    const checkFile = () => {
      checkCount++;
      if (checkCount % 10 === 0) {
        testLog.info(`   Still waiting... (checked ${checkCount} times)`);
      }
      
      if (fs.existsSync(triggerFile)) {
        testLog.info(`✅ Trigger file detected!`);
        // Clean up the trigger file
        try {
          fs.unlinkSync(triggerFile);
          testLog.info('✅ Trigger file removed');
        } catch (err) {
          testLog.info(`⚠️  Could not remove trigger file: ${err}`);
        }
        testLog.info('✅ Continuing test...');
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for continue trigger'));
      } else {
        setTimeout(checkFile, checkInterval);
      }
    };
    
    // Start checking
    checkFile();
    
    // Also listen for SIGINT (Ctrl+C) to allow graceful exit
    process.once('SIGINT', () => {
      testLog.info('\n❌ Test aborted by user');
      process.exit(130); // Standard exit code for SIGINT
    });
  });
}