import winston from 'winston';
import pino from 'pino';

// Determine environment and logger preference
const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === '' || process.env.NODE_ENV === 'development';
const loggerType = process.env.LOGGER?.toLowerCase() || (isDevelopment ? 'winston' : 'pino');
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Custom log levels: wall < debug < info < warn < error
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    wall: 4
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    wall: 'gray'
  }
};

// Logger interface that works with both Winston and Pino
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Logger {
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
  wall?: (message: string, ...args: any[]) => void;
  level?: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let logger: Logger;

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

  // Add wall method to Winston
  /* eslint-disable @typescript-eslint/no-explicit-any */
  logger = {
    error: (message: string, ...args: any[]) => winstonLogger.error(message, ...args),
    warn: (message: string, ...args: any[]) => winstonLogger.warn(message, ...args),
    info: (message: string, ...args: any[]) => winstonLogger.info(message, ...args),
    debug: (message: string, ...args: any[]) => winstonLogger.debug(message, ...args),
    wall: (message: string, ...args: any[]) => (winstonLogger as any).wall(message, ...args),
    get level() { return winstonLogger.level; },
    set level(level: string) { winstonLogger.level = level; }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
} else {
  // Use Pino (default for production)
  const pinoLogger = pino({
    level: logLevel === 'wall' ? 'trace' : logLevel,
    base: {
      service: 'sonos-alexa-api'
    },
    // Ensure consistent field ordering
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    // Map our custom levels
    customLevels: {
      wall: 60 // Higher than trace (10)
    },
    useOnlyCustomLevels: false,
    formatters: {
      level: (label) => {
        return { level: label };
      }
    }
  });

  // Create wrapper to handle metadata properly
  /* eslint-disable @typescript-eslint/no-explicit-any */
  logger = {
    error: (message: string, meta?: any) => {
      if (typeof meta === 'object' && meta !== null && !meta.stack) {
        pinoLogger.error(meta, message);
      } else {
        pinoLogger.error(message, meta);
      }
    },
    warn: (message: string, meta?: any) => {
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.warn(meta, message);
      } else {
        pinoLogger.warn(message, meta);
      }
    },
    info: (message: string, meta?: any) => {
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.info(meta, message);
      } else {
        pinoLogger.info(message, meta);
      }
    },
    debug: (message: string, meta?: any) => {
      if (typeof meta === 'object' && meta !== null) {
        pinoLogger.debug(meta, message);
      } else {
        pinoLogger.debug(message, meta);
      }
    },
    wall: (message: string, meta?: any) => {
      if (logLevel === 'wall') {
        if (typeof meta === 'object' && meta !== null) {
          (pinoLogger as any).wall(meta, message);
        } else {
          (pinoLogger as any).wall(message, meta);
        }
      }
    },
    get level() { return pinoLogger.level; },
    set level(level: string) { pinoLogger.level = level === 'wall' ? 'trace' : level; }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export default logger;