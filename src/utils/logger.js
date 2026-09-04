/**
 * Централизованный логгер — обёртка над console с уровнями.
 *
 * Обоснование: 40 вызовов console.* разбросаны по проекту.
 * Вместо тяжёлых pino/winston (оверкилл для бота <10k строк) используем
 * лёгкую централизацию: один модуль, уровни через LOG_LEVEL env,
 * префиксы и возможность заглушить в тестах. При росте проекта легко
 * заменить на pino без изменения call sites.
 *
 * Уровни: error < warn < info < debug
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] <= currentLevel;
}

function error(...args) {
  if (shouldLog('error')) console.error(...args);
}
function warn(...args) {
  if (shouldLog('warn')) console.warn(...args);
}
function info(...args) {
  if (shouldLog('info')) console.log(...args);
}
function debug(...args) {
  if (shouldLog('debug')) console.log('[debug]', ...args);
}
function log(...args) {
  // legacy alias → info
  info(...args);
}

module.exports = { error, warn, info, debug, log, LEVELS };
