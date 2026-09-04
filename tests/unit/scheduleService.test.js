const { Op } = require('sequelize');

jest.mock('../../src/models', () => ({
  Schedule: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
  Homework: {
    destroy: jest.fn(),
  },
}));

const { Schedule, Homework } = require('../../src/models');
const scheduleService = require('../../src/services/scheduleService');

describe('scheduleService create/update sanitize + room', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('create trims and collapses spaces but keeps original casing', async () => {
    Schedule.findOne.mockResolvedValue(null);
    Schedule.create.mockImplementation(async (data) => ({ id: 1, ...data }));
    const result = await scheduleService.create({
      dayOfWeek: 0,
      lessonNumber: 1,
      subjectName: '  Русский   язык  ',
      room: '101',
    });
    expect(Schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dayOfWeek: 0,
        lessonNumber: 1,
        subjectName: 'Русский язык',
        room: '101',
      })
    );
    expect(result.subjectName).toBe('Русский язык');
  });

  test('create keeps display casing not forced lower', async () => {
    Schedule.findOne.mockResolvedValue(null);
    Schedule.create.mockImplementation(async (data) => ({ id: 2, ...data }));
    await scheduleService.create({
      dayOfWeek: 0,
      lessonNumber: 2,
      subjectName: 'МАТЕМАТИКА',
      room: null,
    });
    expect(Schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectName: 'МАТЕМАТИКА' })
    );
  });

  test('create strips trailing punctuation but keeps casing', async () => {
    Schedule.findOne.mockResolvedValue(null);
    Schedule.create.mockImplementation(async (data) => ({ id: 3, ...data }));
    await scheduleService.create({
      dayOfWeek: 1,
      lessonNumber: 1,
      subjectName: 'Русский язык.',
      room: null,
    });
    expect(Schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectName: 'Русский язык' })
    );
  });

  test('create persists room, null if "-" or empty', async () => {
    Schedule.findOne.mockResolvedValue(null);
    Schedule.create.mockImplementation(async (data) => ({ id: 4, ...data }));

    await scheduleService.create({ dayOfWeek: 0, lessonNumber: 3, subjectName: 'Физика', room: '  205 ' });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: '205' }));

    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.create({ dayOfWeek: 0, lessonNumber: 4, subjectName: 'Химия', room: '-' });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: null }));

    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.create({ dayOfWeek: 0, lessonNumber: 5, subjectName: 'Биология', room: '' });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: null }));

    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.create({ dayOfWeek: 0, lessonNumber: 6, subjectName: 'История', room: '   ' });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: null }));

    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.create({ dayOfWeek: 1, lessonNumber: 2, subjectName: 'География', room: null });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: null }));

    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.create({ dayOfWeek: 1, lessonNumber: 3, subjectName: 'ОБЖ', room: undefined });
    expect(Schedule.create).toHaveBeenLastCalledWith(expect.objectContaining({ room: null }));
  });

  test('update sanitizes subjectName trimmed/collapsed and room', async () => {
    const mockSchedule = {
      id: 10,
      update: jest.fn().mockResolvedValue(),
    };
    Schedule.findByPk.mockResolvedValue(mockSchedule);
    Schedule.findOne.mockResolvedValue(null); // isSlotTaken
    await scheduleService.update(10, { subjectName: '  русский   язык  ', room: '-' });
    expect(mockSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ subjectName: 'русский язык', room: null })
    );
  });

  test('update keeps casing for display', async () => {
    const mockSchedule = { id: 11, update: jest.fn().mockResolvedValue() };
    Schedule.findByPk.mockResolvedValue(mockSchedule);
    Schedule.findOne.mockResolvedValue(null);
    await scheduleService.update(11, { subjectName: 'Русский Язык', room: '  101 ' });
    expect(mockSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ subjectName: 'Русский Язык', room: '101' })
    );
  });

  test('isSlotTaken unchanged behavior', async () => {
    const found = { id: 99 };
    Schedule.findOne.mockResolvedValue(found);
    const result = await scheduleService.isSlotTaken(0, 1);
    expect(Schedule.findOne).toHaveBeenCalledWith({ where: { dayOfWeek: 0, lessonNumber: 1 } });
    expect(result).toBe(found);

    Schedule.findOne.mockResolvedValue(null);
    const result2 = await scheduleService.isSlotTaken(0, 1, 5);
    expect(Schedule.findOne).toHaveBeenCalledWith({
      where: { dayOfWeek: 0, lessonNumber: 1, id: { [Op.ne]: 5 } },
    });
    expect(result2).toBeNull();
  });

  test('sanitize helpers exposed', () => {
    expect(scheduleService._sanitizeSubjectForDisplay('  Русский   язык  ')).toBe('Русский язык');
    expect(scheduleService._sanitizeSubjectForDisplay('Русский язык.')).toBe('Русский язык');
    expect(scheduleService._sanitizeSubjectForDisplay('МАТЕМАТИКА')).toBe('МАТЕМАТИКА');
    expect(scheduleService._sanitizeRoom(' 101 ')).toBe('101');
    expect(scheduleService._sanitizeRoom('-')).toBeNull();
    expect(scheduleService._sanitizeRoom('')).toBeNull();
    expect(scheduleService._sanitizeRoom(null)).toBeNull();
  });
});

describe('scheduleService.findBySubjectNormalized', () => {
  beforeEach(() => jest.clearAllMocks());

  const makeSchedules = () => [
    { id: 1, subjectName: 'Русский язык', dayOfWeek: 0, lessonNumber: 1 },
    { id: 2, subjectName: 'Математика', dayOfWeek: 0, lessonNumber: 2 },
    { id: 3, subjectName: 'русский', dayOfWeek: 2, lessonNumber: 1 },
    { id: 4, subjectName: 'МЁД', dayOfWeek: 3, lessonNumber: 1 },
    { id: 5, subjectName: 'Физика', dayOfWeek: 4, lessonNumber: 1 },
  ];

  test('case-insensitive: "Русский" vs "русский" match', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('русский');
    const ids = result.map((r) => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  test('case-insensitive opposite: "РУССКИЙ" vs "русский язык"', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('РУССКИЙ');
    expect(result.length).toBe(2);
  });

  test('first-word fallback: "русский язык" vs "русский"', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('Русский');
    // Should match both "Русский язык" and "русский"
    expect(result.map((r) => r.subjectName)).toEqual(
      expect.arrayContaining(['Русский язык', 'русский'])
    );
    const result2 = await scheduleService.findBySubjectNormalized('русский язык');
    expect(result2.length).toBe(2);
  });

  test('Yo handling: "мёд" vs "мед"', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('мед');
    expect(result.map((r) => r.id)).toContain(4);
    const result2 = await scheduleService.findBySubjectNormalized('мёд');
    expect(result2.map((r) => r.id)).toContain(4);
    const result3 = await scheduleService.findBySubjectNormalized('МЁД');
    expect(result3.map((r) => r.id)).toContain(4);
  });

  test('extra spaces collapsed', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('  Русский   язык  ');
    expect(result.length).toBe(2);
    const result2 = await scheduleService.findBySubjectNormalized('  русский  ');
    expect(result2.length).toBe(2);
  });

  test('dayOfWeek filter', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('русский', 0);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(1);
    const result2 = await scheduleService.findBySubjectNormalized('русский', 2);
    expect(result2[0].id).toBe(3);
  });

  test('no match returns empty', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('химия');
    expect(result).toEqual([]);
  });

  test('different subjects not matched', async () => {
    Schedule.findAll.mockResolvedValue(makeSchedules());
    const result = await scheduleService.findBySubjectNormalized('физика');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(5);
  });
});

// findNextLesson case-insensitive tests via scheduleUtils
describe('scheduleUtils.findNextLesson case-insensitive', () => {
  beforeEach(() => jest.clearAllMocks());

  // need to re-mock for scheduleUtils which also uses Schedule
  const { findNextLesson } = require('../../src/utils/scheduleUtils');
  const { getMoscowDayOfWeek } = require('../../src/utils/moscowTime');

  test('findNextLesson matches case-insensitive', async () => {
    const schedules = [
      { id: 1, subjectName: 'Русский язык', dayOfWeek: 2, lessonNumber: 1 },
      { id: 2, subjectName: 'Математика', dayOfWeek: 3, lessonNumber: 1 },
    ];
    Schedule.findAll.mockResolvedValue(schedules);
    // from Monday (0) -> should find Русский on day 2
    const from = new Date('2024-09-02T09:00:00Z'); // Monday Moscow 12:00
    // getMoscowDayOfWeek for that date is 0
    const result = await findNextLesson('русский', from);
    expect(result).not.toBeNull();
    expect(result.schedule.subjectName).toBe('Русский язык');
  });

  test('findNextLesson first-word fallback', async () => {
    const schedules = [
      { id: 1, subjectName: 'Русский язык', dayOfWeek: 2, lessonNumber: 1 },
    ];
    Schedule.findAll.mockResolvedValue(schedules);
    const from = new Date('2024-09-02T09:00:00Z');
    const result = await findNextLesson('Русский', from);
    expect(result).not.toBeNull();
    expect(result.schedule.id).toBe(1);
  });

  test('findNextLesson Yo handling', async () => {
    const schedules = [{ id: 1, subjectName: 'Мёд', dayOfWeek: 2, lessonNumber: 1 }];
    Schedule.findAll.mockResolvedValue(schedules);
    const from = new Date('2024-09-02T09:00:00Z');
    const result = await findNextLesson('мед', from);
    expect(result).not.toBeNull();
  });

  test('findNextLesson extra spaces', async () => {
    const schedules = [{ id: 1, subjectName: 'Русский язык', dayOfWeek: 2, lessonNumber: 1 }];
    Schedule.findAll.mockResolvedValue(schedules);
    const from = new Date('2024-09-02T09:00:00Z');
    const result = await findNextLesson('  Русский   язык  ', from);
    expect(result).not.toBeNull();
  });

  test('findNextLesson wrap to next week', async () => {
    const schedules = [
      { id: 1, subjectName: 'Русский язык', dayOfWeek: 0, lessonNumber: 1 }, // Monday
      { id: 2, subjectName: 'Русский язык', dayOfWeek: 1, lessonNumber: 1 }, // Tuesday
    ];
    Schedule.findAll.mockResolvedValue(schedules);
    // From Friday (4) -> next is Monday (0) next week
    const from = new Date('2024-09-06T09:00:00Z'); // Friday
    expect(getMoscowDayOfWeek(from)).toBe(4);
    const result = await findNextLesson('русский', from);
    expect(result).not.toBeNull();
    expect(result.schedule.dayOfWeek).toBe(0);
    // date should be next Monday
    expect(result.date).toBeInstanceOf(Date);
  });

  test('findNextLesson returns null if no match', async () => {
    Schedule.findAll.mockResolvedValue([
      { id: 1, subjectName: 'Математика', dayOfWeek: 0, lessonNumber: 1 },
    ]);
    const from = new Date('2024-09-02T09:00:00Z');
    const result = await findNextLesson('русский', from);
    expect(result).toBeNull();
  });

  test('findNextLesson picks next day greater than current', async () => {
    const schedules = [
      { id: 1, subjectName: 'Русский язык', dayOfWeek: 0, lessonNumber: 2 },
      { id: 2, subjectName: 'Русский язык', dayOfWeek: 2, lessonNumber: 1 },
      { id: 3, subjectName: 'Русский язык', dayOfWeek: 4, lessonNumber: 1 },
    ];
    Schedule.findAll.mockResolvedValue(schedules);
    // From Tuesday (1) -> next is Wednesday (2)
    const from = new Date('2024-09-03T09:00:00Z'); // Tuesday
    expect(getMoscowDayOfWeek(from)).toBe(1);
    const result = await findNextLesson('РУССКИЙ', from);
    expect(result.schedule.dayOfWeek).toBe(2);
  });
});
