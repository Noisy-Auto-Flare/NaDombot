const { Homework, User } = require('../models');
const { getMoscowNow } = require('./moscowTime');
const { formatDate, getDayName } = require('./dateUtils');
const { getMoscowDayOfWeek } = require('./moscowTime');

/**
 * P2 §13 — показ существующего при записи + optimistic locking.
 * Общие хелперы обеих add-сцен (обычная + «на дату»).
 */

/**
 * Существующие строки домашки по (scheduleId, date) в порядке updatedAt.
 * @param {number} scheduleId
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function fetchExistingHomework(scheduleId, dateStr) {
  return Homework.findAll({
    where: { scheduleId, date: dateStr },
    order: [['updatedAt', 'ASC']]
  });
}

/**
 * Короткая московская метка времени строки: "DD.MM HH:MM".
 * @param {Date|string} updatedAt
 * @returns {string}
 */
function formatRowTime(updatedAt) {
  const d = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const m = getMoscowNow(d);
  const ddmm = m.dateStr.slice(0, 5);
  return `${ddmm} ${m.hhmm}`;
}

/**
 * Подпись автора строки: @username, иначе имя, иначе id.
 * @param {object|null} user - строка User
 * @param {string|number} userId - fallback
 * @returns {string}
 */
function formatAuthor(user, userId) {
  if (user && user.username) return `@${user.username}`;
  if (user && user.firstName) return String(user.firstName);
  return `id${userId}`;
}

/**
 * Текст «уже есть записи» с автором и временем каждой строки (P2 §13.1).
 * @param {{subjectName: string, date: Date, rows: Array}} params
 * @returns {Promise<string>}
 */
async function formatExistingHomeworkText({ subjectName, date, rows }) {
  const dayOfWeek = getMoscowDayOfWeek(date);
  const ids = [...new Set((rows || []).map((r) => r.userId))];
  const users = new Map();
  if (ids.length) {
    try {
      const found = await User.findAll({ where: { userId: ids } });
      for (const u of found || []) users.set(String(u.userId), u);
    } catch (_e) {
      // без имён — fallback на id
    }
  }
  let text = `📚 ${subjectName}, ${getDayName(dayOfWeek)}, ${formatDate(date)} — уже есть записи:\n`;
  for (const r of rows || []) {
    const author = formatAuthor(users.get(String(r.userId)) || null, r.userId);
    text += `✏️ ${author}, ${formatRowTime(r.updatedAt)}: ${String(r.content).trim()}\n`;
  }
  text += '\nЧто делать?';
  return text;
}

/**
 * Клавиатура выбора действия при существующей записи.
 * @returns {{inline_keyboard: Array}}
 */
function existingHomeworkKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить', callback_data: 'hw_add' },
        { text: '🔄 Заменить', callback_data: 'hw_replace' }
      ],
      [{ text: '❌ Отмена', callback_data: 'hw_cancel' }]
    ]
  };
}

/**
 * Условная замена последней строки по (scheduleId, date) с проверкой updatedAt
 * (optimistic locking, P2 §13.2). Upsert-замену НЕ делаем.
 * @param {{scheduleId: number, dateStr: string, lastId: number, seenUpdatedAt: Date|string, content: string, userId: number|string}} params
 * @returns {Promise<{ok: boolean, conflict?: boolean, rows?: Array}>}
 */
async function replaceHomeworkConditional({ scheduleId, dateStr, lastId, seenUpdatedAt, content, userId }) {
  const seen = seenUpdatedAt instanceof Date ? seenUpdatedAt : new Date(seenUpdatedAt);
  let affected = 0;
  try {
    const res = await Homework.update(
      { content, userId },
      { where: { id: lastId, scheduleId, date: dateStr, updatedAt: seen } }
    );
    affected = Array.isArray(res) ? res[0] : res;
  } catch (_e) {
    affected = 0;
  }
  if (affected > 0) return { ok: true };
  const rows = await fetchExistingHomework(scheduleId, dateStr);
  return { ok: false, conflict: true, rows };
}

/**
 * Перейти на шаг ввода текста: из шага выбора — next(), на шаге текста — остаться.
 * @param {object} ctx
 * @param {number} [lastIndex=2] - индекс шага ввода текста
 */
async function goTextStep(ctx, lastIndex = 2) {
  if (ctx.wizard && typeof ctx.wizard.cursor === 'number' && ctx.wizard.cursor < lastIndex) {
    return ctx.wizard.next();
  }
  if (ctx.wizard && (ctx.wizard.cursor == null || typeof ctx.wizard.cursor !== 'number')) {
    return ctx.wizard.next();
  }
}

/**
 * Обработка кнопок [➕ Добавить|🔄 Заменить|❌ Отмена] (P2 §13.1).
 * @param {object} ctx
 * @param {string} data - callback_data
 * @returns {Promise<boolean>} true если обработано
 */
async function handleChoiceCallback(ctx, data) {
  if (data !== 'hw_add' && data !== 'hw_replace' && data !== 'hw_cancel') return false;
  if (ctx.answerCbQuery) await ctx.answerCbQuery().catch(() => {});
  if (data === 'hw_cancel') {
    await ctx.reply('❌ Действие отменено.', {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]]
      }
    });
    await ctx.scene.leave();
    return true;
  }
  if (ctx.wizard.state.scheduleId == null || !ctx.wizard.state.date) {
    await ctx.reply('❌ Сессия истекла. Начните заново.');
    await ctx.scene.leave();
    return true;
  }
  if (data === 'hw_add') {
    ctx.wizard.state.pendingMode = 'add';
    await ctx.reply('📝 Введите текст домашнего задания (добавится новой строкой):', {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
      }
    });
    return goTextStep(ctx);
  }
  // hw_replace
  ctx.wizard.state.pendingMode = 'replace';
  await ctx.reply('🔄 Введите новый текст — он заменит последнюю запись:', {
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'homework_cancel' }]]
    }
  });
  return goTextStep(ctx);
}

/**
 * Инкремент счётчика добавленных ДЗ пользователя (P3 §12).
 * Вызывать только в точках Homework.create (путь «Заменить» — не инкрементит,
 * создания нет). Никогда не роняет вызывающий флоу.
 * @param {string|number} userId
 * @returns {Promise<number|null>} новое значение или null при ошибке
 */
async function incrementHomeworkCount(userId) {
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      const fallback = await User.findByPk(String(userId));
      if (!fallback) return null;
      await fallback.increment('homeworkCount', { by: 1 });
      await fallback.reload();
      return fallback.homeworkCount;
    }
    await user.increment('homeworkCount', { by: 1 });
    await user.reload();
    return user.homeworkCount;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  fetchExistingHomework,
  formatRowTime,
  formatAuthor,
  formatExistingHomeworkText,
  existingHomeworkKeyboard,
  replaceHomeworkConditional,
  goTextStep,
  handleChoiceCallback,
  incrementHomeworkCount
};
