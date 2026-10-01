const logger = require('../utils/logger');
const { isMultiprofileEnabled } = require('../utils/settings');
const { getUserProfile } = require('../utils/userProfile');

/**
 * Lazy onboarding middleware.
 * Если multiprofile включен и у пользователя нет профиля — отправляет в сцену selectProfile.
 * Не блокирует callbacks сцены (select_* / select_profile) и саму команду /profile.
 * @param {object} ctx - Telegraf context
 * @param {Function} next
 */
async function lazyOnboarding(ctx, next) {
  try {
    if (!ctx.from || !ctx.from.id) return next();

    // не прерывать если уже в сцене selectProfile
    if (ctx.scene && ctx.scene.session && ctx.scene.session.current === 'selectProfile') {
      return next();
    }

    const data = ctx.callbackQuery?.data || '';
    // не блокировать колбэки сцены выбора профиля
    if (data.startsWith('select_profile') || data.startsWith('select_class') || data.startsWith('select_track') || data.startsWith('select_subgroup')) {
      return next();
    }
    // не блокировать команду /profile и её callback
    const text = ctx.message?.text || '';
    if (text.startsWith('/profile')) return next();

    const enabled = await isMultiprofileEnabled();
    if (!enabled) {
      logger.debug('lazyOnboarding skipped: multiprofile disabled');
      return next();
    }

    const profile = await getUserProfile(ctx.from.id);
    if (profile) {
      logger.debug('lazyOnboarding skipped: profile exists');
      return next();
    }

    // нет профиля → онбординг (ctx.scene доступен только после stage.middleware)
    if (!ctx.scene || !ctx.scene.enter) {
      logger.debug('lazyOnboarding skipped: no scene');
      return next();
    }
    logger.debug('lazyOnboarding triggered: no profile, entering selectProfile');
    try {
      await ctx.scene.enter('selectProfile');
    } catch (e) {
      logger.error('lazyOnboarding enter', e.message || e);
      return next();
    }
    return; // прерываем next()
  } catch (e) {
    logger.error('lazyOnboarding', e.message || e);
    return next();
  }
}

module.exports = { lazyOnboarding };
