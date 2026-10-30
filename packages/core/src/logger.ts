export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|apikey|api_key|cookie|hash)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogFields;
  sink?: (line: string) => void;
  pretty?: boolean;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  const min = LEVEL_WEIGHT[level] ?? 20;
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));

  const write = (entryLevel: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_WEIGHT[entryLevel] < min) return;
    const record = {
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...bindings,
      ...(fields ? (redact(fields) as LogFields) : {}),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (extra) => createLogger({ ...options, level, bindings: { ...bindings, ...extra }, sink }),
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

export function captureLogger(): { logger: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}
