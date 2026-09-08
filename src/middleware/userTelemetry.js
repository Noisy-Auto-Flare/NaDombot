const { User, UserEvent } = require('../models');

/**
 * Middleware Telegraf — телеметрия пользователя на каждом апдейте.
 * Делает upsert User + создаёт UserEvent. Никогда не блокирует next().
 * Корректно обрабатывает апдейты без ctx.from (например channel_post).
 *
 * @param {object} ctx - Telegraf context
 * @param {Function} next - следующий middleware
 * @returns {Promise<void>}
 */
async function userTelemetry(ctx, next) {
  try {
    if (!ctx.from) return next();

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

    // UserEvent — не блокировать next() если упало
    try {
      await UserEvent.create({
        userId: ctx.from.id,
        type,
        payload: payload?.slice(0, 64) || null,
        meta: {
          chatType: ctx.chat?.type || null,
          text: ctx.message?.text?.slice(0, 200) || null,
          callbackData: ctx.callbackQuery?.data || null
        }
      });
    } catch (e) {
      console.error('UserEvent', e.message);
    }
  } catch (e) {
    console.error('userTelemetry', e.message || e);
  }
  return next();
}

module.exports = { userTelemetry };
