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

const adminBackKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_back' }]],
  },
};

const lessonsBackKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'lessons_back' }]],
  },
};

/**
 * Главное админ-меню "Управление"
 * P1 item 4: кнопок каталога (Классы/Профили/Подгруппы) нет — каталог правится
 * в config/audience.json; код сервисов и хендлеры оставлены для сидов/стенда.
 */
const adminMainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📚 Управление уроками', callback_data: 'lessons_manage' }],
      [{ text: '🧩 Режимы', callback_data: 'modes' }],
      [{ text: '📊 Пользователи', callback_data: 'users_list' }],
      [{ text: '📈 Статистика', callback_data: 'schedule_stats' }],
      [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }],
    ],
  },
};

/**
 * Подменю управления уроками
 */
const lessonsManageKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Добавить урок', callback_data: 'schedule_add' }],
      [{ text: '✏️ Редактировать урок', callback_data: 'schedule_edit' }],
      [{ text: '📋 Просмотреть расписание', callback_data: 'schedule_view' }],
      [{ text: '🗑 Удалить урок', callback_data: 'schedule_delete' }],
      [{ text: '🔔 Настроить звонки', callback_data: 'edit_bells' }],
      [{ text: '🔙 Назад', callback_data: 'admin_back' }],
    ],
  },
};

/**
 * @deprecated — оставлен для совместимости, используйте adminMainKeyboard / lessonsManageKeyboard.
 * Кнопки каталога скрыты (P1 item 4), код сервисов оставлен.
 */
const manageScheduleKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Добавить урок', callback_data: 'schedule_add' }],
      [{ text: '✏️ Редактировать урок', callback_data: 'schedule_edit' }],
      [{ text: '📋 Просмотреть расписание', callback_data: 'schedule_view' }],
      [{ text: '🗑 Удалить урок', callback_data: 'schedule_delete' }],
      [{ text: '🔔 Настроить звонки', callback_data: 'edit_bells' }],
      [{ text: '⏰ Порог быстрых кнопок', callback_data: 'edit_quick_pick_threshold' }],
      [{ text: '📊 Статистика', callback_data: 'schedule_stats' }],
      [{ text: '🧩 Режимы', callback_data: 'schedule_toggle_multiprofile' }],
      [{ text: '🔙 Вернуться в меню', callback_data: 'back_to_menu' }],
    ],
  },
};

/**
 * Динамическая клавиатура режимов — генерируется в хелпере, т.к. нужен текущий лейбл.
 * Экспортируется фабрика для тестов/переиспользования.
 * @param {string} label - человекочитаемый лейбл режима
 * @returns {{reply_markup:{inline_keyboard:Array}}}
 */
function createModesKeyboard(label) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `👥 Переключить режим: сейчас ${label}`, callback_data: 'toggle_hw_visibility' }],
        [{ text: '🔙 Назад', callback_data: 'admin_back' }],
      ],
    },
  };
}

const modesKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '👥 Переключить режим', callback_data: 'toggle_hw_visibility' }],
      [{ text: '🔙 Назад', callback_data: 'admin_back' }],
    ],
  },
};

// Alias for expected name adminManageKeyboard (task says manageScheduleKeyboard → adminManageKeyboard)
const adminManageKeyboard = adminMainKeyboard;

module.exports = {
  cancelKeyboard,
  backKeyboard,
  backToMenuKeyboard,
  adminBackKeyboard,
  lessonsBackKeyboard,
  adminMainKeyboard,
  adminManageKeyboard,
  lessonsManageKeyboard,
  modesKeyboard,
  createModesKeyboard,
  manageScheduleKeyboard,
};
