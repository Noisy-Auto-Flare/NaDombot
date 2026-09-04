const {
  getDayName,
  getDayOfWeek,
  getNextWorkDay,
  getNextDayOfWeek,
  formatDate,
  getWeekDates,
} = require('./dateUtils');

describe('dateUtils', () => {
  test('getDayName returns Russian names', () => {
    expect(getDayName(0)).toBe('Понедельник');
    expect(getDayName(4)).toBe('Пятница');
    expect(getDayName(6)).toBe('Воскресенье');
    expect(getDayName(99)).toBe('Неизвестно');
  });

  test('getDayOfWeek maps JS days correctly', () => {
    // 2024-09-02 is Monday
    expect(getDayOfWeek(new Date('2024-09-02T12:00:00'))).toBe(0);
    // Sunday
    expect(getDayOfWeek(new Date('2024-09-01T12:00:00'))).toBe(6);
    // Saturday
    expect(getDayOfWeek(new Date('2024-09-07T12:00:00'))).toBe(5);
  });

  test('formatDate pads correctly', () => {
    expect(formatDate(new Date('2024-03-05T10:00:00'))).toBe('05.03.2024');
    expect(formatDate(new Date('2024-12-31T10:00:00'))).toBe('31.12.2024');
  });

  test('getNextWorkDay skips weekend', () => {
    // Monday -> Tuesday
    expect(getNextWorkDay(new Date('2024-09-02T12:00:00')).getDate()).toBe(3);
    // Friday -> Monday (+3)
    const friday = new Date('2024-09-06T12:00:00');
    const next = getNextWorkDay(friday);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(9);
    // Saturday -> Monday
    expect(getNextWorkDay(new Date('2024-09-07T12:00:00')).getDate()).toBe(9);
    // Sunday -> Monday
    expect(getNextWorkDay(new Date('2024-09-08T12:00:00')).getDate()).toBe(9);
  });

  test('getNextDayOfWeek finds next occurrence', () => {
    const monday = new Date('2024-09-02T12:00:00'); // dayOfWeek 0
    // next Wednesday (2) from Monday -> +2
    expect(getNextDayOfWeek(monday, 2).getDate()).toBe(4);
    // same day -> next week +7
    expect(getNextDayOfWeek(monday, 0).getDate()).toBe(9);
  });

  test('getWeekDates returns 7 consecutive dates', () => {
    const start = new Date('2024-09-02T00:00:00');
    const week = getWeekDates(start);
    expect(week).toHaveLength(7);
    expect(week[0].getDate()).toBe(2);
    expect(week[6].getDate()).toBe(8);
    // ensure new instances (mutation safe)
    week[0].setDate(99);
    expect(getWeekDates(start)[0].getDate()).toBe(2);
  });
});
