const { parseHistoryDateInput } = require('../../src/utils/historyDate');
const { leaveToMenu } = require('../../src/utils/navigation');
const { buildSubgroupKeyboard } = require('../../src/scenes/selectProfileScene');

describe('UI fixes F1/F4/F5', () => {
  describe('F5 parseHistoryDateInput', () => {
    test('прошлая дата без года → текущий год', () => {
      const now = new Date(2026, 9, 2, 12, 0, 0, 0); // 02.10.2026
      const d = parseHistoryDateInput('01.10', now);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(9);
      expect(d.getDate()).toBe(1);
    });

    test('будущая дата без года → прошлый год (история смотрит назад)', () => {
      const now = new Date(2026, 9, 2, 12, 0, 0, 0); // 02.10.2026
      const d = parseHistoryDateInput('05.10', now);
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(9);
      expect(d.getDate()).toBe(5);
    });

    test('январь, октябрь без года → октябрь прошлого года', () => {
      const now = new Date(2026, 0, 15, 12, 0, 0, 0); // 15.01.2026
      const d = parseHistoryDateInput('05.10', now);
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(9);
      expect(d.getDate()).toBe(5);
    });

    test('декабрь, январь без года → январь этого года', () => {
      const now = new Date(2026, 11, 20, 12, 0, 0, 0); // 20.12.2026
      const d = parseHistoryDateInput('10.01', now);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(10);
    });

    test('явный год всегда побеждает (4 и 2 цифры)', () => {
      const now = new Date(2026, 9, 2, 12, 0, 0, 0);
      const d1 = parseHistoryDateInput('05.10.2025', now);
      expect(d1.getFullYear()).toBe(2025);
      const d2 = parseHistoryDateInput('05.10.25', now);
      expect(d2.getFullYear()).toBe(2025);
      // явный будущий год не откатывается
      const d3 = parseHistoryDateInput('05.12.2026', now);
      expect(d3.getFullYear()).toBe(2026);
      expect(d3.getMonth()).toBe(11);
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
        { id: 'firfarova', teacher: 'Фирфарова' }
      ]);
      const flat = kb.flat().map((b) => b.callback_data);
      expect(flat).not.toContain('select_subgroup:null');
      expect(flat).toContain('select_subgroup:belova');
      expect(flat).toContain('select_subgroup:firfarova');
    });
  });
});
