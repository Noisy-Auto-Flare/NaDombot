/**
 * F7–F12 ручного тестирования (юнит, без БД: getTagContext мокаем).
 * - F8: нет кнопки «Общий» в клавиатуре треков, обработка select_track:null жива
 * - F9: гашение клавиатуры вызвано
 * - F10: теги в quick-pick
 * - F11: умный disambiguation (ветка учителя vs общий список)
 * - F12: суффикс «· N вар.», человеческая дата в пикере вариантов
 */
jest.mock('../../src/utils/scheduleUtils', () => {
  const actual = jest.requireActual('../../src/utils/scheduleUtils');
  return {
    ...actual,
    getTagContext: async () => ({
      template: '{track} · {subgroup}',
      showClass: false,
      maxSegments: 4,
      trackNames: new Map([
        ['tech', 'Технологический'],
        ['soc', 'Социально-экономический']
      ]),
      subgroupNames: new Map([
        ['belova', { name: 'Белова', teacher: 'Белова Ирина Николаевна' }],
        ['ferfarova', { name: 'Ферфарова', teacher: 'Ферфарова Валерия Михайловна' }]
      ])
    })
  };
});

const { buildTrackKeyboard, dismissKeyboard } = require('../../src/scenes/selectProfileScene');
const { showVariantPicker } = require('../../src/scenes/addHomeworkScene');
const {
  buildDateKeyboard,
  showDateVariantPicker,
  humanDateLabel
} = require('../../src/scenes/addHomeworkOnDateScene');
const { isSubgroupOnlyChoice, buildAudienceTag } = require('../../src/utils/audience');
const { buildQuickPickLabel } = require('../../src/utils/recentLessons');

const TAG_CTX = {
  template: '{track} · {subgroup}',
  showClass: false,
  maxSegments: 4,
  trackNames: new Map([
    ['tech', 'Технологический'],
    ['soc', 'Социально-экономический']
  ]),
  subgroupNames: new Map([
    ['belova', { name: 'Белова', teacher: 'Белова Ирина Николаевна' }],
    ['ferfarova', { name: 'Ферфарова', teacher: 'Ферфарова Валерия Михайловна' }]
  ])
};

function mockCtx() {
  return { wizard: { state: {} }, reply: jest.fn(async () => {}) };
}

// Английский двух подгрупп: одинаковый слот, разные подгруппа/кабинет
const EN_BELOVA = {
  id: 11,
  classId: '10А',
  dayOfWeek: 2,
  lessonNumber: 3,
  subjectName: 'Английский',
  room: '4005',
  trackId: null,
  subgroupId: 'belova'
};
const EN_FERFAROVA = {
  id: 12,
  classId: '10А',
  dayOfWeek: 2,
  lessonNumber: 3,
  subjectName: 'Английский',
  room: 'библ',
  trackId: null,
  subgroupId: 'ferfarova'
};

describe('F8: клавиатура треков без кнопки Общий', () => {
  test('нет select_track:null, есть треки и Видеть всё', () => {
    const kb = buildTrackKeyboard([{ id: 'tech', name: 'Технологический' }]);
    const flat = kb.flat().map((b) => b.callback_data);
    expect(flat).not.toContain('select_track:null');
    expect(flat).toContain('select_track:tech');
    expect(flat).toContain('select_scope:all');
    expect(kb.flat().map((b) => b.text)).not.toContain('Общий');
  });
});

describe('F9: гашение клавиатуры', () => {
  test('editMessageReplyMarkup вызван с пустой клавиатурой', async () => {
    const ctx = { editMessageReplyMarkup: jest.fn(async () => true) };
    await dismissKeyboard(ctx);
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] });
  });

  test('ошибки гашения глотаются', async () => {
    const ctx = {
      editMessageReplyMarkup: jest.fn(async () => {
        throw new Error('message not modified');
      })
    };
    await expect(dismissKeyboard(ctx)).resolves.toBeUndefined();
  });
});

describe('F10: теги в quick-pick', () => {
  test('подгруппа → [Белова], общий урок → без тега', () => {
    expect(buildAudienceTag(EN_BELOVA, TAG_CTX, TAG_CTX)).toBe('[Белова]');
    expect(buildAudienceTag({ ...EN_BELOVA, subgroupId: null }, TAG_CTX, TAG_CTX)).toBe('');
  });

  test('подпись кнопки: 📚 Английский [Белова] (3 урок), общая — без тега', () => {
    expect(buildQuickPickLabel(EN_BELOVA, TAG_CTX)).toBe('📚 Английский [Белова] (3 урок)');
    expect(buildQuickPickLabel({ ...EN_BELOVA, subgroupId: null, room: null }, TAG_CTX)).toBe(
      '📚 Английский (3 урок)'
    );
  });
});

describe('F11: умный disambiguation', () => {
  test('только подгруппа различается → true (кабинет не ось)', () => {
    expect(isSubgroupOnlyChoice([EN_BELOVA, EN_FERFAROVA])).toBe(true);
  });

  test('разные треки → false (общий список)', () => {
    const tech = { ...EN_BELOVA, id: 21, subjectName: 'Информатика', trackId: 'tech', subgroupId: null, room: '1058' };
    const soc = { ...EN_BELOVA, id: 22, subjectName: 'Информатика', trackId: 'soc', subgroupId: null, room: '2040' };
    expect(isSubgroupOnlyChoice([tech, soc])).toBe(false);
  });

  test('один вариант / разные слоты → false', () => {
    expect(isSubgroupOnlyChoice([EN_BELOVA])).toBe(false);
    expect(isSubgroupOnlyChoice([{ ...EN_BELOVA }, { ...EN_FERFAROVA, lessonNumber: 4 }])).toBe(false);
  });

  test('addHomework: ветка учителя — «У кого именно?», кнопки-учителя, callback hw_pick жив', async () => {
    const ctx = mockCtx();
    await showVariantPicker(ctx, 'Английский', [EN_BELOVA, EN_FERFAROVA]);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('у кого именно?');
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(
      expect.arrayContaining(['Белова Ирина Николаевна', 'Ферфарова Валерия Михайловна'])
    );
    expect(buttons.map((b) => b.callback_data)).toEqual(
      expect.arrayContaining(['hw_pick:11', 'hw_pick:12'])
    );
    expect(ctx.wizard.state.pendingPick).toEqual([11, 12]);
  });

  test('addHomework: разные треки — общий список с тегами', async () => {
    const ctx = mockCtx();
    const tech = { ...EN_BELOVA, id: 21, subjectName: 'Информатика', trackId: 'tech', subgroupId: null, room: '1058' };
    const soc = { ...EN_BELOVA, id: 22, subjectName: 'Информатика', trackId: 'soc', subgroupId: null, room: '2040' };
    await showVariantPicker(ctx, 'Информатика', [tech, soc]);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('несколько вариантов');
    const labels = extra.reply_markup.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(['[Тех] · Ср 3 ур.', '[Соц.-эконом.] · Ср 3 ур.']));
  });

  test('on-date: заголовок — человеческая дата, ветка учителя', async () => {
    const ctx = mockCtx();
    await showDateVariantPicker(ctx, '2026-10-07', [EN_BELOVA, EN_FERFAROVA]);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('Ср, 07.10');
    expect(text).not.toContain('2026-10-07');
    expect(text).toContain('у кого именно?');
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.callback_data)).toEqual(
      expect.arrayContaining(['hw_variant:11:2026-10-07', 'hw_variant:12:2026-10-07'])
    );
  });

  test('on-date: разные треки — общий список с человеческой датой', async () => {
    const ctx = mockCtx();
    const tech = { ...EN_BELOVA, id: 21, subjectName: 'Информатика', trackId: 'tech', subgroupId: null, room: '1058' };
    const soc = { ...EN_BELOVA, id: 22, subjectName: 'Информатика', trackId: 'soc', subgroupId: null, room: '2040' };
    await showDateVariantPicker(ctx, '2026-10-07', [tech, soc]);
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain('Ср, 07.10');
    expect(text).toContain('несколько вариантов');
  });
});

describe('F12: читаемость on-date', () => {
  test('humanDateLabel: Ср, 07.10', () => {
    expect(humanDateLabel('2026-10-07')).toBe('Ср, 07.10');
  });

  test('кнопка даты: «· 2 вар.» вместо (?)', () => {
    const baseDate = new Date(2026, 9, 6, 12, 0, 0, 0); // Вт 06.10
    const kb = buildDateKeyboard([EN_BELOVA, EN_FERFAROVA], baseDate, true);
    const texts = kb.flat().map((b) => b.text);
    expect(texts).toEqual(expect.arrayContaining(['Ср 07.10 · 2 вар.']));
    expect(texts.join(' ')).not.toContain('(?)');
    const cbs = kb.flat().map((b) => b.callback_data);
    expect(cbs).toEqual(expect.arrayContaining(['hw_variants:2026-10-07']));
  });
});
