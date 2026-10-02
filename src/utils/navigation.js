/**
 * Единый выход в главное меню из сцен.
 * answerCbQuery + scene.leave() (если в сцене) + показ главного меню через handleStart.
 * require handlers/commands — ленивый внутри функции во избежание циклов.
 * @param {object} ctx - Telegraf context
 * @returns {Promise<void>}
 */
async function leaveToMenu(ctx) {
  try {
    if (ctx.callbackQuery && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery().catch(() => {});
    }
  } catch (_e) {
    void _e;
  }
  try {
    if (ctx.scene && ctx.scene.current) {
      await ctx.scene.leave();
    }
  } catch (_e) {
    void _e;
  }
  try {
    const { handleStart } = require('../handlers/commands');
    await handleStart(ctx);
  } catch (_e) {
    void _e;
  }
}

module.exports = { leaveToMenu };
