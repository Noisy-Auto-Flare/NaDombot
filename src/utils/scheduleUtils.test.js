/**
 * Tests for findNextLesson with mocked Schedule model
 */
jest.mock('../models', () => ({
  Schedule: { findAll: jest.fn() },
  Homework: { findAll: jest.fn() },
}));

const { Schedule } = require('../models');
const { findNextLesson } = require('./scheduleUtils');

describe('scheduleUtils.findNextLesson', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns null when no schedules for subject', async () => {
    Schedule.findAll.mockResolvedValue([]);
    const res = await findNextLesson('Математика', new Date('2024-09-02T12:00:00'));
    expect(res).toBeNull();
  });

  test('finds next lesson later this week', async () => {
    Schedule.findAll.mockResolvedValue([
      { subjectName: 'Математика', dayOfWeek: 0, lessonNumber: 1 },
      { subjectName: 'Математика', dayOfWeek: 2, lessonNumber: 2 },
      { subjectName: 'Математика', dayOfWeek: 4, lessonNumber: 1 },
    ]);
    // Monday (0) -> next is Wednesday (2)
    const monday = new Date('2024-09-02T00:00:00');
    const res = await findNextLesson('Математика', monday);
    expect(res.schedule.dayOfWeek).toBe(2);
    expect(res.date.getDate()).toBe(4); // Wednesday
  });

  test('wraps to next week when no later day this week', async () => {
    Schedule.findAll.mockResolvedValue([
      { subjectName: 'Физика', dayOfWeek: 0, lessonNumber: 1 },
      { subjectName: 'Физика', dayOfWeek: 1, lessonNumber: 1 },
    ]);
    // Friday (4) -> next is Monday (0) next week
    const friday = new Date('2024-09-06T00:00:00');
    const res = await findNextLesson('Физика', friday);
    expect(res.schedule.dayOfWeek).toBe(0);
    expect(res.date.getDate()).toBe(9); // next Monday
  });

  test('passes correct ordering to findAll (no where — filtered via subjectsMatch)', async () => {
    Schedule.findAll.mockResolvedValue([]);
    await findNextLesson('Химия', new Date());
    expect(Schedule.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        order: [
          ['dayOfWeek', 'ASC'],
          ['lessonNumber', 'ASC'],
        ],
      })
    );
    // Ensure no where clause — filtering is done in JS via subjectsMatch
    const callArg = Schedule.findAll.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('where');
  });
});
