const logger = require('../utils/logger');
const { User, UserEvent } = require('../models');

/**
 * Middleware Telegraf — телеметрия пользователя на каждом апдейте.
 * Делает upsert User + создаёт UserEvent с durationMs (замер вокруг next())
 * и status (ok/error). Никогда не блокирует бота.
 * Корректно обрабатывает апдейты без ctx.from (например channel_post).
 *
 * @param {object} ctx - Telegraf context
 * @param {Function} next - следующий middleware
 * @returns {Promise<void>}
 */
async function userTelemetry(ctx, next) {
  const startedAt = Date.now();
  if (!ctx.from) return next();

  let nextCalled = false;
  try {
    const now = new Date();

    // Короткий payload для lastAction / UserEvent.payload (до 64 симв.)
    const payload =
      ctx.callbackQuery?.data || ctx.message?.text?.slice(0, 64) || ctx.updateType;

    const type = ctx.callbackQuery ? 'callback' : ctx.message ? 'message' : 'command';

    const userData = {
      userId: ctx.from.id,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name || null,
      languageCode: ctx.from.language_code || null,
      isPremium: !!ctx.from.is_premium,
      addedToAttachmentMenu: !!ctx.from.added_to_attachment_menu,
      lastSeenAt: now,
      lastAction: payload?.slice(0, 100) || null
    };

    // upsert User — firstSeenAt при создании, interactionCount++
    const [user, created] = await User.findOrCreate({
      where: { userId: ctx.from.id },
      defaults: { ...userData, firstSeenAt: now, interactionCount: 1, homeworkCount: 0 }
    });

    if (!created) {
      await user.update({
        ...userData,
        interactionCount: (user.interactionCount || 0) + 1
      });
    }

    // Замер длительности вокруг next() (P3 §12: событие = запрос → длительность → результат)
    let status = 'ok';
    try {
      nextCalled = true;
      await next();
    } catch (nextErr) {
      status = 'error';
      throw nextErr;
    } finally {
      const durationMs = Date.now() - startedAt;
      // UserEvent — не блокировать бота если упало
      try {
        await UserEvent.create({
          userId: ctx.from.id,
          type,
          payload: payload?.slice(0, 64) || null,
          meta: {
            chatType: ctx.chat?.type || null,
            text: ctx.message?.text?.slice(0, 200) || null,
            callbackData: ctx.callbackQuery?.data || null
          },
          durationMs,
          status
        });
      } catch (e) {
        logger.error('UserEvent', e.message);
      }
    }
  } catch (e) {
    logger.error('userTelemetry', e.message || e);
    // next() мог не вызваться из-за падения upsert — пробуем пропустить дальше один раз
    if (!nextCalled) {
      return next();
    }
    throw e;
  }
}

module.exports = { userTelemetry };
