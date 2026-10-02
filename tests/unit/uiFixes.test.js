const { parseHistoryDateInput } = require('../../src/utils/historyDate');
const { leaveToMenu } = require('../../src/utils/navigation');
const { buildSubgroupKeyboard } = require('../../src/scenes/selectProfileScene');

describe('UI fixes F1/F4/F5', () => {
  describe('F5 parseHistoryDateInput', () => {
    test('валидная дата ДД.ММ → текущий год', () => {
      const now = new Date(2026, 9, 2, 12, 0, 0, 0); // 02.10.2026
      const d = parseHistoryDateInput('05.10', now);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(9);
      expect(d.getDate()).toBe(5);
    });

    test('невалидные даты бросают HISTORY_BAD_DATE', () => {
      const now = new Date(2026, 9, 2, 12, 0, 0, 0);
      expect(() => parseHistoryDateInput('32.10', now)).toThrow('HISTORY_BAD_DATE');
      expect(() => parseHistoryDateInput('05.13', now)).toThrow('HISTORY_BAD_DATE');
      expect(() => parseHistoryDateInput('31.02', now)).toThrow('HISTORY_BAD_DATE');
      expect(() => parseHistoryDateInput('абракадабра', now)).toThrow('HISTORY_BAD_DATE');
      expect(() => parseHistoryDateInput('', now)).toThrow('HISTORY_BAD_DATE');
    });
  });

  describe('F4 leaveToMenu', () => {
    test('leave вызван + меню показано', async () => {
      const calls = { leave: 0, answered: 0, menu: 0 };
      const ctx = {
        callbackQuery: { data: 'back_to_menu' },
        answerCbQuery: async () => {
          calls.answered += 1;
        },
        scene: {
          current: { id: 'manageSchedule' },
          leave: async () => {
            calls.leave += 1;
          }
        },
        reply: async () => {
          calls.menu += 1;
        },
        from: { id: 1, first_name: 'T' }
      };
      await leaveToMenu(ctx);
      expect(calls.answered).toBe(1);
      expect(calls.leave).toBe(1);
      // handleStart делает reply (меню показано)
      expect(calls.menu).toBeGreaterThanOrEqual(1);
    });
  });

  describe('F1 subgroup keyboard', () => {
    test('нет кнопки select_subgroup:null', () => {
      const kb = buildSubgroupKeyboard([
        { id: 'belova', teacher: 'Белова' },
        { id: 'petrova', teacher: 'Петрова' }
      ]);
      const flat = kb.flat().map((b) => b.callback_data);
      expect(flat).not.toContain('select_subgroup:null');
      expect(flat).toContain('select_subgroup:belova');
      expect(flat).toContain('select_subgroup:petrova');
    });
  });
});
