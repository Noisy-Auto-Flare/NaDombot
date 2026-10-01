/**
 * P0: getHomeworkForDate использует московский день, а не локальный день хоста.
 * Симуляция UTC-хоста: локальный getDayOfWeek «сломан» (всегда воскресенье),
 * а настоящий московский день для фикс. момента — понедельник.
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

// Локальный день хоста — как на UTC-хосте в 21:30Z воскресенья (день 6)
jest.mock('../../src/utils/dateUtils', () => {
  const actual = jest.requireActual('../../src/utils/dateUtils');
  return {
    ...actual,
    getDayOfWeek: jest.fn(() => 6)
  };
});

const { Schedule, Homework, UserProfile } = require('../../src/models');
const { getHomeworkVisibility, isMultiprofileEnabled } = require('../../src/utils/settings');
const dateUtils = require('../../src/utils/dateUtils');
const { getMoscowDayOfWeek } = require('../../src/utils/moscowTime');
const { getHomeworkForDate } = require('../../src/utils/scheduleUtils');

describe('getHomeworkForDate на UTC-хосте (P0: московский день)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('граница суток: в Москве уже понедельник — расписание запрошено на понедельник', async () => {
    // 2026-10-04 21:30 UTC = 2026-10-05 00:30 MSK (понедельник) — не зависит от TZ хоста
    const date = new Date(Date.UTC(2026, 9, 4, 21, 30, 0));
    expect(getMoscowDayOfWeek(date)).toBe(0);

    UserProfile.findByPk.mockResolvedValue(null);
    isMultiprofileEnabled.mockResolvedValue(false);
    Schedule.findAll.mockResolvedValue([]);
    getHomeworkVisibility.mockResolvedValue('personal');

    await getHomeworkForDate(123, date);

    // Локальный день хоста вообще не используется
    expect(dateUtils.getDayOfWeek).not.toHaveBeenCalled();
    // Расписание запрошено на московский понедельник (0), а не на «воскресенье хоста» (6)
    expect(Schedule.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 0 }) })
    );
    expect(Homework.findAll).not.toHaveBeenCalled();
  });
});
