/**
 * timbot-gateway 日志工具
 *
 * 日志级别优先级: debug < info < warn < error
 * 格式: [timbot-gateway] [LEVEL] [时间戳] 消息
 */

export const LOG_PREFIX = "[timbot-gateway]";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

/** 设置日志级别 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** 获取当前日志级别 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

/** Debug 级别日志 */
export function logDebug(message: string): void {
  if (shouldLog("debug")) {
    console.debug(`${LOG_PREFIX} [DEBUG] [${formatTimestamp()}] ${message}`);
  }
}

/** Info 级别日志 */
export function logInfo(message: string): void {
  if (shouldLog("info")) {
    console.log(`${LOG_PREFIX} [INFO] [${formatTimestamp()}] ${message}`);
  }
}

/** Warn 级别日志 */
export function logWarn(message: string): void {
  if (shouldLog("warn")) {
    console.warn(`${LOG_PREFIX} [WARN] [${formatTimestamp()}] ${message}`);
  }
}

/** Error 级别日志 */
export function logError(message: string): void {
  if (shouldLog("error")) {
    console.error(`${LOG_PREFIX} [ERROR] [${formatTimestamp()}] ${message}`);
  }
}
