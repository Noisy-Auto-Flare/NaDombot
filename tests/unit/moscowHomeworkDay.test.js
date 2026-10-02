/**
 * P0-регрессия (хотфикс): календарные даты vs instant-«сейчас».
 * Диагноз: `getMoscowDayOfWeek(instant)` возвращает московский день МОМЕНТА,
 * его нельзя применять к календарным датам — в 00:00–03:00 МСК дни расходятся:
 * Mon Oct 05 21:29 UTC → календарный день Пн, а Москва уже Вт 00:29.
 * Правило: календарным датам — только getCalendarDayOfWeek (день собственных Y-M-D).
 */
jest.mock('../../src/models', () => ({
  Schedule: {
    findAll: jest.fn()
  },
  Homework: {
    findAll: jest.fn()
  },
  UserProfile: {
    findByPk: jest.fn()
  }
}));

jest.mock('../../src/utils/settings', () => ({
  getHomeworkVisibility: jest.fn(),
  HOMEWORK_VISIBILITY_SHARED: 'shared',
  isMultiprofileEnabled: jest.fn()
}));

const { Schedule, Homework, UserProfile } = require('../../src/models');
const { getHomeworkVisibility, isMultiprofileEnabled } = require('../../src/utils/settings');
const {
  getMoscowDayOfWeek,
  getCalendarDayOfWeek,
  getMoscowToday,
  parseCalendarDate
} = require('../../src/utils/moscowTime');
const { getHomeworkForDate, findNextLesson, formatHomework } = require('../../src/utils/scheduleUtils');
const { buildDateKeyboard } = require('../../src/scenes/addHomeworkOnDateScene');

// Прод-расклад из репродюса: Пн — 7 уроков, Вт — 8 уроков
const MON_SCHEDULES = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  dayOfWeek: 0,
  lessonNumber: i + 1,
  subjectName: `Предмет-Пн-${i + 1}`
}));
const TUE_SCHEDULES = Array.from({ length: 8 }, (_, i) => ({
  id: 101 + i,
  dayOfWeek: 1,
  lessonNumber: i + 1,
  subjectName: `Предмет-Вт-${i + 1}`
}));
const ALL = [...MON_SCHEDULES, ...TUE_SCHEDULES];

const MON_HOMEWORK = [
  {
    id: 5001,
    scheduleId: 3,
    userId: 777,
    date: '2026-10-05',
    content: 'Параграф 5',
    updatedAt: new Date(2026, 9, 4, 12, 0, 0, 0)
  }
];

function mockDb() {
  UserProfile.findByPk.mockResolvedValue(null);
  isMultiprofileEnabled.mockResolvedValue(false);
  getHomeworkVisibility.mockResolvedValue('shared');
  Schedule.findAll.mockImplementation(async (query) => {
    const dow = query && query.where && query.where.dayOfWeek;
    if (dow === 0) return [...MON_SCHEDULES];
    if (dow === 1) return [...TUE_SCHEDULES];
    if (dow != null) return [];
    return [...ALL];
  });
  Homework.findAll.mockImplementation(async (query) => {
    const where = (query && query.where) || {};
    let list = null;
    const sid = where.scheduleId;
    if (Array.isArray(sid)) list = sid;
    else if (sid != null && typeof sid === 'object') {
      const syms = Object.getOwnPropertySymbols(sid);
      if (syms.length) list = sid[syms[0]];
    } else if (sid != null) list = [sid];
    return MON_HOMEWORK.filter(
      (h) => h.date === where.date && (list == null || list.includes(h.scheduleId))
    ).map((h) => ({ ...h, schedule: ALL.find((s) => s.id === h.scheduleId) }));
  });
}

describe('P0: ночь 05.10 21:29Z — вид 05.10 показывает Понедельник (7 уроков + домашка)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb();
  });

  test('расхождение зафиксировано: у instant московский день уже Вт, у даты — Пн', () => {
    // Mon Oct 05 21:29 UTC = Tue Oct 06 00:29 MSK
    const night = new Date(Date.UTC(2026, 9, 5, 21, 29, 0));
    expect(getMoscowDayOfWeek(night)).toBe(1);
    // Календарная дата вида — Пн 05.10 (полдень, как getMoscowToday/getWeekDates)
    const view = new Date(2026, 9, 5, 12, 0, 0, 0);
    expect(getCalendarDayOfWeek(view)).toBe(0);
    expect(getCalendarDayOfWeek('2026-10-05')).toBe(0);
  });

  test('getHomeworkForDate(05.10) → 7 уроков Пн, домашка видна, заголовок Понедельник', async () => {
    const view = new Date(2026, 9, 5, 12, 0, 0, 0);
    const data = await getHomeworkForDate(777, view);

    // Расписание запрошено на Пн (0), а не на «московский Вт» instant-момента
    expect(Schedule.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 0 }) })
    );
    expect(data.schedules).toHaveLength(7);
    // Домашка видна (scheduleId Пн совпали, а не чужие Вт)
    expect(data.homeworks).toHaveLength(1);
    expect(data.homeworks[0].content).toBe('Параграф 5');

    // Инвариант: будний день расписания == заголовка == строки даты ДЗ
    const text = formatHomework(data, null);
    expect(text).toContain('Понедельник');
    expect(text).toContain('05.10');
    expect(text).toContain('Параграф 5');
    expect(text).not.toContain('Вторник');
  });

  test('00:30 МСК: вид 06.10 — расписание Вторника (8 уроков)', async () => {
    // Mon Oct 05 21:30 UTC = Tue Oct 06 00:30 MSK
    const night = new Date(Date.UTC(2026, 9, 5, 21, 30, 0));
    expect(getMoscowDayOfWeek(night)).toBe(1);
    // База «сегодня» — московская календарная дата 06.10
    const today = getMoscowToday(night);
    expect(today.getFullYear()).toBe(2026);
    expect(today.getMonth()).toBe(9);
    expect(today.getDate()).toBe(6);

    const view = new Date(2026, 9, 6, 12, 0, 0, 0);
    const data = await getHomeworkForDate(777, view);
    expect(Schedule.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 1 }) })
    );
    expect(data.schedules).toHaveLength(8);
    const text = formatHomework(data, null);
    expect(text).toContain('Вторник');
    expect(text).not.toContain('Понедельник');
  });

  test('UTC-хост: клавиатура дат и человеческие метки — календарные', () => {
    const base = new Date(2026, 9, 5, 12, 0, 0, 0); // Пн 05.10
    const kb = buildDateKeyboard(TUE_SCHEDULES, base, false);
    const texts = kb.flat().map((b) => b.text);
    expect(texts).toEqual(expect.arrayContaining(['Вт 06.10']));
    const cbs = kb.flat().map((b) => b.callback_data);
    expect(cbs).toEqual(expect.arrayContaining(['hw_date:2026-10-06:101']));
    // Парс callback-даты — полдень тех же Y-M-D (без UTC-сдвига)
    const parsed = parseCalendarDate('2026-10-06');
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 9, 6]);
    expect(getCalendarDayOfWeek(parsed)).toBe(1);
  });

  test('instant-семантика findNextLesson сохранена (вход — момент «сейчас»)', async () => {
    const tueOnly = TUE_SCHEDULES.map((s, i) => ({
      subjectName: 'Физика',
      dayOfWeek: 1,
      lessonNumber: i + 1
    }));
    Schedule.findAll.mockResolvedValue(tueOnly);
    // Днём: Пн 05.10 12:00 МСК (=09:00Z) → ближайший Вт 06.10
    const day = new Date(Date.UTC(2026, 9, 5, 9, 0, 0));
    const res = await findNextLesson('Физика', day);
    expect(res.schedule.dayOfWeek).toBe(1);
    expect([res.date.getFullYear(), res.date.getMonth(), res.date.getDate()]).toEqual([2026, 9, 6]);
  });
});
