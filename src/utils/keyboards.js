/**
 * Переиспользуемые клавиатуры
 */

const cancelKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '❌ Отменить', callback_data: 'schedule_cancel' }]],
  },
};

const backKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'schedule_back' }]],
  },
};

const backToMenuKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }]],
  },
};

const manageScheduleKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Добавить урок', callback_data: 'schedule_add' }],
      [{ text: '✏️ Редактировать урок', callback_data: 'schedule_edit' }],
      [{ text: '📋 Просмотреть расписание', callback_data: 'schedule_view' }],
      [{ text: '🗑 Удалить урок', callback_data: 'schedule_delete' }],
      [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }],
    ],
  },
};

module.exports = {
  cancelKeyboard,
  backKeyboard,
  backToMenuKeyboard,
  manageScheduleKeyboard,
};
