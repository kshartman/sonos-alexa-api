import winston from 'winston';

// Add custom log levels: wall < debug < info < warn < error
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

winston.addColors(customLevels.colors);

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'sonos-alexa-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Extend logger with wall method
declare module 'winston' {
  interface Logger {
    wall: winston.LeveledLogMethod;
  }
}

export default logger;