process.env.SQLITE_PATH = ':memory:';

describe('LessonTimeService + validator + formatter (TDD)', () => {
  let LessonTime;
  let service;
  let validator;
  let formatter;
  let seedLessonTimes;
  let sequelize;

  beforeAll(async () => {
    const db = require('../../src/config/database');
    sequelize = db.sequelize;
    LessonTime = require('../../src/models/LessonTime');
    service = require('../../src/services/LessonTimeService');
    validator = require('../../src/utils/lessonTimeValidator');
    formatter = require('../../src/utils/lessonFormatter');
    seedLessonTimes = require('../../src/utils/seedLessonTimes').seedLessonTimes;

    await sequelize.sync({ force: true });
    await seedLessonTimes();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('seeded LessonTime table has 10 rows ordered 1-10', async () => {
    const rows = await service.findAllOrdered();
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.lessonNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('valid upsert creates/updates and findByLessonNumber returns it', async () => {
    const result = await service.upsert(1, '08:30', '09:15');
    expect(result.lessonNumber).toBe(1);
    expect(result.startTime).toBe('08:30');
    expect(result.endTime).toBe('09:15');

    const fetched = await service.findByLessonNumber(1);
    expect(fetched.startTime).toBe('08:30');

    // update same lesson with new times
    const updated = await service.upsert(1, '08:35', '09:20');
    expect(updated.startTime).toBe('08:35');
    expect(updated.endTime).toBe('09:20');
    const refetched = await service.findByLessonNumber(1);
    expect(refetched.startTime).toBe('08:35');
    // restore original for other tests
    await service.upsert(1, '08:30', '09:15');
  });

  test('invalid HHMM 25:00 throws ValidationError', async () => {
    await expect(service.upsert(2, '25:00', '10:10')).rejects.toThrow(validator.ValidationError);
    await expect(service.upsert(2, '09:25', '25:00')).rejects.toThrow(validator.ValidationError);
    expect(() => validator.validateHHMM('25:00')).toThrow(validator.ValidationError);
    expect(() => validator.validateHHMM('8:30')).toThrow(validator.ValidationError);
  });

  test('invalid lessonNumber 0 and 11 throws ValidationError', async () => {
    await expect(service.upsert(0, '08:30', '09:15')).rejects.toThrow(validator.ValidationError);
    await expect(service.upsert(11, '08:30', '09:15')).rejects.toThrow(validator.ValidationError);
    expect(() => validator.validateLessonNumber(0)).toThrow(validator.ValidationError);
    expect(() => validator.validateLessonNumber(11)).toThrow(validator.ValidationError);
    expect(() => validator.validateLessonNumber(3.5)).toThrow(validator.ValidationError);
    expect(() => validator.validateLessonNumber(8)).not.toThrow();
    expect(() => validator.validateLessonNumber(10)).not.toThrow();
  });

  test('start >= end throws ValidationError', async () => {
    await expect(service.upsert(3, '10:30', '10:30')).rejects.toThrow(validator.ValidationError);
    await expect(service.upsert(3, '11:00', '10:30')).rejects.toThrow(validator.ValidationError);
    expect(() => validator.validateTimeRange('11:00', '10:30')).toThrow(validator.ValidationError);
    expect(() => validator.validateTimeRange('10:30', '10:30')).toThrow(validator.ValidationError);
  });

  test('findAllOrdered returns ordered by lessonNumber asc even after out-of-order upserts', async () => {
    await service.upsert(7, '14:25', '15:10');
    await service.upsert(3, '10:25', '11:10');
    const rows = await service.findAllOrdered();
    const numbers = rows.map((r) => r.lessonNumber);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
    }
  });

  test('getBellScheduleMap returns Map<number,{start,end}>', async () => {
    const map = await service.getBellScheduleMap();
    expect(map instanceof Map).toBe(true);
    expect(map.size).toBe(10);
    expect(map.get(1)).toEqual({ start: '08:30', end: '09:15' });
    expect(map.get(7)).toEqual({ start: '14:25', end: '15:10' });
    expect(map.get(8)).toEqual({ start: '15:25', end: '16:10' });
    expect(map.get(10)).toEqual({ start: '17:25', end: '18:10' });
    // verify all keys 1-10
    for (let i = 1; i <= 10; i++) {
      const v = map.get(i);
      expect(v).toHaveProperty('start');
      expect(v).toHaveProperty('end');
      expect(v.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  test('formatter formatBellRow and formatBellSchedule', () => {
    const row = { lessonNumber: 1, startTime: '08:30', endTime: '09:15' };
    expect(formatter.formatBellRow(row)).toBe('1 урок: 08:30–09:15');

    const rows = [
      { lessonNumber: 2, startTime: '09:25', endTime: '10:10' },
      { lessonNumber: 1, startTime: '08:30', endTime: '09:15' },
    ];
    const text = formatter.formatBellSchedule(rows);
    expect(text).toContain('1 урок: 08:30–09:15');
    expect(text).toContain('2 урок: 09:25–10:10');
    // ordered
    expect(text.indexOf('1 урок')).toBeLessThan(text.indexOf('2 урок'));

    // formatBellMap
    const map = new Map([
      [1, { start: '08:30', end: '09:15' }],
      [2, { start: '09:25', end: '10:10' }],
    ]);
    const mapText = formatter.formatBellMap(map);
    expect(mapText).toContain('1 урок: 08:30–09:15');
  });

  test('validator valid cases do not throw', () => {
    expect(() => validator.validateHHMM('00:00')).not.toThrow();
    expect(() => validator.validateHHMM('23:59')).not.toThrow();
    expect(() => validator.validateLessonNumber(1)).not.toThrow();
    expect(() => validator.validateLessonNumber(7)).not.toThrow();
    expect(() => validator.validateLessonNumber(10)).not.toThrow();
    expect(() => validator.validateTimeRange('08:30', '09:15')).not.toThrow();
  });
});
