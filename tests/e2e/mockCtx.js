/**
 * Минимальные моки Telegraf-ctx для e2e-яруса P5 (CommonJS, без сети).
 * Покрывает reply / scene.enter-leave / wizard.state-next-selectStep /
 * callbackQuery / message / from. Переиспользуется всеми tests/e2e/*.test.js.
 */

'use strict';

/**
 * Создать мок ctx + журнал вызовов.
 * @param {object} [options]
 * @param {number|string} [options.userId=1001]
 * @param {string} [options.firstName='Test']
 * @param {string} [options.username='testuser']
 * @param {string|null} [options.callbackData=null] - сразу положить callbackQuery
 * @param {string|null} [options.messageText=null] - сразу положить message.text
 * @param {object} [options.sceneState={}]
 * @param {object} [options.wizardState={}]
 * @returns {{ctx: object, calls: object}}
 */
function createMockCtx(options = {}) {
  const {
    userId = 1001,
    firstName = 'Test',
    username = 'testuser',
    callbackData = null,
    messageText = null,
    sceneState = {},
    wizardState = {}
  } = options;

  const calls = { replies: [], entered: [], answered: 0, left: false };

  const wizard = { state: { ...wizardState }, cursor: 0 };
  wizard.next = async () => {
    wizard.cursor += 1;
  };
  wizard.selectStep = (index) => {
    wizard.cursor = index;
  };

  const ctx = {
    from: { id: userId, first_name: firstName, username },
    callbackQuery: callbackData != null ? { data: callbackData } : undefined,
    message: messageText != null ? { text: messageText } : undefined,
    reply: async (text, extra) => {
      calls.replies.push({ text, extra });
      return {};
    },
    answerCbQuery: async () => {
      calls.answered += 1;
      return true;
    },
    scene: {
      state: { ...sceneState },
      enter: async (scene, state) => {
        calls.entered.push({ scene, state });
      },
      leave: async () => {
        calls.left = true;
      }
    },
    wizard
  };

  return { ctx, calls };
}

/**
 * Все тексты reply одной строкой (удобно для toContain).
 * @param {object} calls - журнал из createMockCtx
 * @returns {Array<string>}
 */
function replyTexts(calls) {
  return calls.replies.map((r) => String(r.text));
}

/**
 * Текст последнего reply.
 * @param {object} calls
 * @returns {string}
 */
function lastReply(calls) {
  if (!calls.replies.length) return '';
  return String(calls.replies[calls.replies.length - 1].text);
}

/**
 * Все callback_data из кнопок всех reply.
 * @param {object} calls
 * @returns {Array<string>}
 */
function replyButtons(calls) {
  const out = [];
  for (const r of calls.replies) {
    const kb = r.extra && r.extra.reply_markup && r.extra.reply_markup.inline_keyboard;
    if (!Array.isArray(kb)) continue;
    for (const row of kb) {
      for (const btn of row || []) {
        if (btn && btn.callback_data) out.push(btn.callback_data);
      }
    }
  }
  return out;
}

module.exports = { createMockCtx, replyTexts, lastReply, replyButtons };
