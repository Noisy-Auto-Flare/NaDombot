const { getDayName } = require('../utils/dateUtils');

const TEXT_FALLBACK_HINT =
  '🤔 Не понял вас. Я умею показывать и добавлять домашнее задание — нажмите /start чтобы открыть меню.';

/**
 * Текст вне сцен не молчит: если текст совпадает с предметом из расписания
 * (subjectsMatch) — короткий ответ с ближайшим уроком + кнопки входа в add-флоу
 * штатной кнопкой; иначе — короткая подсказка.
 * Пропуски: внутри сцен (визарды), команды (/...), пустой текст.
 * Никаких новых сцен/состояний.
 * @param {object} ctx - Telegraf context
 * @returns {Promise<boolean>} true если сообщение потреблено (ответ отправлен)
 */
async function handleTextFallback(ctx) {
  try {
    if (ctx.scene && ctx.scene.current) return false;
  } catch (_e) { void _e; }
  let text = '';
  try {
    text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
  } catch (_e) { text = ''; }
  if (!text || text.startsWith('/')) return false;
  try {
    const { findNextLesson } = require('../utils/scheduleUtils');
    const found = await findNextLesson(text);
    if (found && found.schedule) {
      const dayName = getDayName(found.schedule.dayOfWeek);
      await ctx.reply(
        `Нашёл «${found.schedule.subjectName}» (ближайший: ${dayName}, ${found.schedule.lessonNumber} урок).`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Добавить ДЗ', callback_data: 'add_homework' }],
              [{ text: '🔙 Меню', callback_data: 'back_to_menu' }]
            ]
          }
        }
      );
      return true;
    }
  } catch (_e) { void _e; }
  try {
    await ctx.reply(TEXT_FALLBACK_HINT);
  } catch (_e) { void _e; }
  return true;
}

module.exports = { handleTextFallback, TEXT_FALLBACK_HINT };
