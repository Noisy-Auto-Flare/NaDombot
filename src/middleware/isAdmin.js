/**
 * Middleware для проверки прав администратора в сценах и обработчиках
 */

function isAdmin(ctx) {
  return ctx.from && ctx.from.id && ctx.from.id.toString() === process.env.ADMIN_ID;
}

/**
 * Middleware для Telegraf — прерывает выполнение если не админ
 */
async function isAdminMiddleware(ctx, next) {
  if (!isAdmin(ctx)) {
    // Для callbackQuery — answerCbQuery, для сообщений — reply
    if (ctx.callbackQuery) {
      try { await ctx.answerCbQuery('❌ У вас нет прав администратора'); } catch (_e) { /* ignore */ }
    } else {
      await ctx.reply('❌ У вас нет прав администратора');
    }
    if (ctx.scene) {
      return ctx.scene.leave();
    }
    return;
  }
  return next();
}

module.exports = { isAdmin, isAdminMiddleware };
