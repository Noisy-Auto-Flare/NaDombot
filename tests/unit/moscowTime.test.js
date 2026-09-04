const {
  getMoscowNow,
  parseHHMM,
  isTimeBetween,
  getMoscowDayOfWeek,
} = require('../../src/utils/moscowTime');

describe('moscowTime', () => {
  describe('getMoscowNow', () => {
    test('UTC vs Moscow +3 offset', () => {
      // 2024-09-02T09:00:00Z = Moscow 12:00 same day (Monday)
      const date = new Date('2024-09-02T09:00:00Z');
      const result = getMoscowNow(date);
      expect(result.hours).toBe(12);
      expect(result.minutes).toBe(0);
      expect(result.hhmm).toBe('12:00');
      expect(result.dateStr).toBe('02.09.2024');
      expect(result.isoDate).toBe('2024-09-02');
      expect(result.dayOfWeek).toBe(0); // Monday
    });

    test('midnight crossover - late UTC becomes next day in Moscow', () => {
      // 2024-09-01T21:30:00Z = Moscow 2024-09-02 00:30 Monday
      const date = new Date('2024-09-01T21:30:00Z');
      const result = getMoscowNow(date);
      expect(result.hours).toBe(0);
      expect(result.minutes).toBe(30);
      expect(result.hhmm).toBe('00:30');
      expect(result.dateStr).toBe('02.09.2024');
      expect(result.isoDate).toBe('2024-09-02');
      expect(result.dayOfWeek).toBe(0); // Monday
    });

    test('midnight crossover 00:30 UTC = 03:30 Moscow same calendar day', () => {
      // 2024-09-02T00:30:00Z = Moscow 03:30 same day
      const date = new Date('2024-09-02T00:30:00Z');
      const result = getMoscowNow(date);
      expect(result.hours).toBe(3);
      expect(result.minutes).toBe(30);
      expect(result.hhmm).toBe('03:30');
      expect(result.dateStr).toBe('02.09.2024');
      expect(result.dayOfWeek).toBe(0);
    });

    test('works when host TZ=UTC - explicit offset check', () => {
      // 2024-01-15T00:00:00Z = Moscow 03:00
      const date = new Date('2024-01-15T00:00:00Z');
      const result = getMoscowNow(date);
      expect(result.hours).toBe(3);
      expect(result.minutes).toBe(0);
      expect(result.hhmm).toBe('03:00');
    });

    test('Sunday mapping 6', () => {
      // 2024-09-01 is Sunday
      // Use UTC that maps to Moscow Sunday: 2024-09-01T09:00:00Z = Moscow 12:00 Sunday
      const date = new Date('2024-09-01T09:00:00Z');
      const result = getMoscowNow(date);
      expect(result.dayOfWeek).toBe(6);
      expect(result.dateStr).toBe('01.09.2024');
    });

    test('default param returns current Moscow time structure', () => {
      const result = getMoscowNow();
      expect(result).toHaveProperty('dayOfWeek');
      expect(result).toHaveProperty('hours');
      expect(result).toHaveProperty('minutes');
      expect(result).toHaveProperty('hhmm');
      expect(result).toHaveProperty('dateStr');
      expect(result).toHaveProperty('isoDate');
      expect(result.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(result.dayOfWeek).toBeLessThanOrEqual(6);
      expect(result.hours).toBeGreaterThanOrEqual(0);
      expect(result.hours).toBeLessThanOrEqual(23);
      expect(result.minutes).toBeGreaterThanOrEqual(0);
      expect(result.minutes).toBeLessThanOrEqual(59);
      expect(result.hhmm).toMatch(/^\d{2}:\d{2}$/);
      expect(result.dateStr).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(result.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('Saturday mapping', () => {
      // 2024-09-07 Saturday
      const date = new Date('2024-09-07T09:00:00Z'); // Moscow 12:00 Saturday
      const result = getMoscowNow(date);
      expect(result.dayOfWeek).toBe(5);
    });
  });

  describe('getMoscowDayOfWeek', () => {
    test('Monday=0', () => {
      const date = new Date('2024-09-02T09:00:00Z'); // Monday Moscow
      expect(getMoscowDayOfWeek(date)).toBe(0);
    });

    test('Sunday=6', () => {
      const date = new Date('2024-09-01T09:00:00Z'); // Sunday Moscow
      expect(getMoscowDayOfWeek(date)).toBe(6);
    });

    test('midnight crossover day increment', () => {
      // Sunday 21:30 UTC = Monday 00:30 Moscow
      const sundayUTC = new Date('2024-09-01T20:00:00Z'); // Moscow 23:00 Sunday
      expect(getMoscowDayOfWeek(sundayUTC)).toBe(6);
      const mondayUTC = new Date('2024-09-01T21:30:00Z'); // Moscow 00:30 Monday
      expect(getMoscowDayOfWeek(mondayUTC)).toBe(0);
    });

    test('default param returns 0-6', () => {
      const dow = getMoscowDayOfWeek();
      expect(dow).toBeGreaterThanOrEqual(0);
      expect(dow).toBeLessThanOrEqual(6);
    });
  });

  describe('parseHHMM', () => {
    test('valid parses', () => {
      expect(parseHHMM('08:30')).toBe(510);
      expect(parseHHMM('00:00')).toBe(0);
      expect(parseHHMM('23:59')).toBe(1439);
      expect(parseHHMM('12:00')).toBe(720);
    });

    test('throws on invalid format', () => {
      expect(() => parseHHMM('8:30')).toThrow();
      expect(() => parseHHMM('08-30')).toThrow();
      expect(() => parseHHMM('ab:cd')).toThrow();
      expect(() => parseHHMM('')).toThrow();
      expect(() => parseHHMM('24:00')).toThrow();
      expect(() => parseHHMM('08:60')).toThrow();
      expect(() => parseHHMM(null)).toThrow();
      expect(() => parseHHMM(' 08:30')).toThrow();
      expect(() => parseHHMM('08:30 ')).toThrow();
    });
  });

  describe('isTimeBetween', () => {
    test('inclusive start', () => {
      // 08:30 inclusive
      expect(isTimeBetween(510, '08:30', '09:30')).toBe(true);
    });

    test('exclusive end', () => {
      // 09:30 exclusive -> false when equal to end
      expect(isTimeBetween(570, '08:30', '09:30')).toBe(false);
    });

    test('inside returns true', () => {
      expect(isTimeBetween(515, '08:30', '09:30')).toBe(true);
      expect(isTimeBetween(569, '08:30', '09:30')).toBe(true);
    });

    test('outside returns false', () => {
      expect(isTimeBetween(500, '08:30', '09:30')).toBe(false);
      expect(isTimeBetween(571, '08:30', '09:30')).toBe(false);
    });

    test('boundary with midnight not wrapping', () => {
      expect(isTimeBetween(0, '00:00', '01:00')).toBe(true);
      expect(isTimeBetween(60, '00:00', '01:00')).toBe(false);
    });
  });
});
