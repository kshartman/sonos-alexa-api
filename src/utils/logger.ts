import winston from 'winston';
import pino from 'pino';

// Determine environment and logger preference
const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === '' || process.env.NODE_ENV === 'development';
const loggerType = process.env.LOGGER?.toLowerCase() || (isDevelopment ? 'winston' : 'pino');
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Custom log levels for Winston: error < warn < info < debug < trace
// Note: Winston uses ascending numbers for less important levels
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,   // Most verbose - matches Pino's trace level
    wall: 4     // Alias for trace (backward compatibility)
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    trace: 'gray',
    wall: 'gray'
  }
};

// Logger interface that works with both Winston and Pino
interface Logger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  trace: (message: string, ...args: unknown[]) => void;
  wall?: (message: string, ...args: unknown[]) => void;  // Alias for trace (backward compatibility)
  always: (message: string, ...args: unknown[]) => void;  // Always logs regardless of level
  level?: string;
}

let logger: Logger;
let wallDeprecationWarned = false;

if (loggerType === 'winston') {
  // Use Winston (default for development)
  winston.addColors(customLevels.colors);
  
  const winstonLogger = winston.createLogger({
    levels: customLevels.levels,
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ),
    defaultMeta: { service: 'sonos-alexa-api' },
    transports: [
      new winston.transports.Console({
        format: isDevelopment 
          ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
          : winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
          )
      })
    ]
  });

  // Add trace and wall methods to Winston
  logger = {
    error: (message: string, ...args: unknown[]) => winstonLogger.error(message, ...args),
    warn: (message: string, ...args: unknown[]) => winstonLogger.warn(message, ...args),
    info: (message: string, ...args: unknown[]) => winstonLogger.info(message, ...args),
    debug: (message: string, ...args: unknown[]) => winstonLogger.debug(message, ...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trace: (message: string, ...args: unknown[]) => (winstonLogger as any).trace(message, ...args), // ANY REQUIRED: Winston doesn't have trace method in types
    wall: (message: string, ...args: unknown[]) => {
      if (!wallDeprecationWarned) {
        console.warn('logger.wall() is deprecated. Please use logger.trace() instead.');
        wallDeprecationWarned = true;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (winstonLogger as any).trace(message, ...args); // ANY REQUIRED: Winston doesn't have trace method in types
    }, // Alias for trace (deprecated)
    always: (message: string, ...args: unknown[]) => {
      // Always log at info level to ensure it's visible
      winstonLogger.info(message, ...args);
    },
    get level() { return winstonLogger.level; },
    set level(level: string) { 
      // Map 'trace' to 'trace' and 'wall' to 'trace' for consistency
      winstonLogger.level = (level === 'wall') ? 'trace' : level; 
    }
  };
} else {
  // Use Pino (default for production)
  const pinoLogger = pino({
    level: logLevel === 'wall' ? 'trace' : logLevel,  // Map wall to trace
    base: {
      service: 'sonos-alexa-api'
    },
    // Ensure consistent field ordering
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    // Map our custom levels
    customLevels: {
      wall: 10 // Same as trace (10) - just an alias
    },
    useOnlyCustomLevels: false,
    formatters: {
      level: (label) => {
        return { level: label };
      }
    }
  });

  // Create wrapper to handle metadata properly
  logger = {
    error: (message: string, ...args: unknown[]) => {
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null && !(meta as Error).stack) {
        pinoLogger.error(meta, message);
      } else {
        pinoLogger.error(message, meta);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.warn(meta, message);
      } else {
        pinoLogger.warn(message, meta);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.info(meta, message);
      } else {
        pinoLogger.info(message, meta);
      }
    },
    debug: (message: string, ...args: unknown[]) => {
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.debug(meta, message);
      } else {
        pinoLogger.debug(message, meta);
      }
    },
    trace: (message: string, ...args: unknown[]) => {
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.trace(meta, message);
      } else {
        pinoLogger.trace(message, meta);
      }
    },
    wall: (message: string, ...args: unknown[]) => {
      // wall is an alias for trace (deprecated)
      if (!wallDeprecationWarned) {
        console.warn('logger.wall() is deprecated. Please use logger.trace() instead.');
        wallDeprecationWarned = true;
      }
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.trace(meta, message);
      } else {
        pinoLogger.trace(message, meta);
      }
    },
    always: (message: string, ...args: unknown[]) => {
      // Always log at info level to ensure it's visible
      const [meta] = args;
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.info(meta, message);
      } else {
        pinoLogger.info(message, meta);
      }
    },
    get level() { return pinoLogger.level; },
    set level(level: string) { pinoLogger.level = level === 'wall' ? 'trace' : level; }
  };
}

export default logger;