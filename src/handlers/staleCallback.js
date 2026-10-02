const { handleStart } = require('./commands');

const STALE_CALLBACK_TEXT = '⚠️ Это меню устарело';
const STALE_CALLBACK_THROTTLE_MS = 60000;

// In-memory per-user окно троттлинга повторной отрисовки меню.
// Ключ — user id, значение — timestamp последнего показа свежего меню.
const lastMenuAt = new Map();

/**
 * Сеть безопасности для протухших кнопок (после рестарта in-memory сессии сцен
 * мертвы, старые inline-кнопки ни один bot.action не матчит).
 * Регистрируется ПОСЛЕДНИМ bot.on('callback_query') — Telegraf останавливает
 * цепочку после обработанного action, сюда доходят только необработанные колбэки.
 * @param {object} ctx - Telegraf context
 */
async function handleStaleCallback(ctx) {
  try {
    await ctx.answerCbQuery(STALE_CALLBACK_TEXT);
  } catch (_e) { void _e; }
  let userId = null;
  try {
    userId = ctx.from && ctx.from.id != null ? String(ctx.from.id) : null;
  } catch (_e) { userId = null; }
  const now = Date.now();
  if (userId != null) {
    const last = lastMenuAt.get(userId) || 0;
    if (now - last < STALE_CALLBACK_THROTTLE_MS) return;
    lastMenuAt.set(userId, now);
  }
  try {
    await handleStart(ctx);
  } catch (_e) { void _e; }
}

/**
 * Сброс троттлинга (для тестов).
 */
function resetStaleCallbackThrottle() {
  lastMenuAt.clear();
}

module.exports = { handleStaleCallback, resetStaleCallbackThrottle, STALE_CALLBACK_TEXT, STALE_CALLBACK_THROTTLE_MS };
