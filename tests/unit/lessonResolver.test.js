const { resolveCurrentLesson } = require('../../src/utils/lessonResolver');

// Default bell schedule matching seedLessonTimes
function makeBellMap() {
  return new Map([
    [1, { start: '08:30', end: '09:15' }],
    [2, { start: '09:25', end: '10:10' }],
    [3, { start: '10:30', end: '11:15' }],
    [4, { start: '11:35', end: '12:20' }],
    [5, { start: '12:40', end: '13:25' }],
    [6, { start: '13:35', end: '14:20' }],
    [7, { start: '14:30', end: '15:15' }],
  ]);
}

// Schedule rows for Monday (dayOfWeek 0) - caller typically filters by today
function makeScheduleRows() {
  return [
    { lessonNumber: 1, subjectName: 'Русский', dayOfWeek: 0, room: '101' },
    { lessonNumber: 2, subjectName: 'Математика', dayOfWeek: 0, room: '304' },
    { lessonNumber: 3, subjectName: 'Физика', dayOfWeek: 0, room: '205' },
    { lessonNumber: 4, subjectName: 'История', dayOfWeek: 0, room: '110' },
    { lessonNumber: 5, subjectName: 'Английский', dayOfWeek: 0, room: '212' },
    { lessonNumber: 6, subjectName: 'Биология', dayOfWeek: 0, room: '312' },
    { lessonNumber: 7, subjectName: 'Физкультура', dayOfWeek: 0, room: 'Gym' },
  ];
}

// Helper to create Date that is Moscow wall-clock hh:mm on 2024-09-02 (Monday)
// Moscow = UTC+3, so Moscow 09:30 = 06:30Z on same date
function moscowDate(hhmm, isoDate = '2024-09-02') {
  const [h, m] = hhmm.split(':').map(Number);
  // isoDate is Moscow date, convert to UTC: subtract 3h
  // Build UTC time that will be Moscow hh:mm
  // Safer to construct via UTC string and rely on getMoscowNow conversion
  const [y, mo, d] = isoDate.split('-').map(Number);
  // Create Date in UTC that corresponds to Moscow hh:mm
  // Moscow = UTC+3 => UTC = Moscow -3
  return new Date(Date.UTC(y, mo - 1, d, h - 3, m, 0, 0));
}

describe('lessonResolver - resolveCurrentLesson', () => {
  test('during lesson 2 at 09:30 Moscow returns lesson with room 304', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('09:30');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('lesson');
    expect(result.lessonNumber).toBe(2);
    expect(result.room).toBe('304');
    expect(result.subjectName).toBe('Математика');
    expect(result.currentBell).toEqual({ start: '09:25', end: '10:10' });
  });

  test('during break 09:16 returns break with next room 205 (lesson 2 start 09:25) – but next is lesson2? Actually break between 1 and 2, next is lesson 2', () => {
    const bellMap = makeBellMap();
    // For break 09:16, next is lesson 2 room 304, but spec says next room 205 at 09:16?
    // Let's use custom rows where lesson 2 room is 205 to match spec second check
    const scheduleRows = [
      { lessonNumber: 1, subjectName: 'Русский', dayOfWeek: 0, room: '101' },
      { lessonNumber: 2, subjectName: 'Математика', dayOfWeek: 0, room: '205' },
      { lessonNumber: 3, subjectName: 'Физика', dayOfWeek: 0, room: '301' },
    ];
    const now = moscowDate('09:16');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('break');
    expect(result.nextLesson).toBeDefined();
    expect(result.nextLesson.room).toBe('205');
    expect(result.prevLesson).toBeDefined();
    expect(result.prevLesson.room).toBe('101');
    expect(result.nextBell).toEqual({ start: '09:25', end: '10:10' });
    expect(result.prevBell).toEqual({ start: '08:30', end: '09:15' });
  });

  test('during break at 09:16 with default rows returns break+next room 304', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('09:16');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('break');
    expect(result.nextLesson.room).toBe('304');
  });

  test('before first lesson at 08:00 returns before', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('08:00');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('before');
    expect(result.nextLesson.room).toBe('101');
    expect(result.nextBell).toEqual({ start: '08:30', end: '09:15' });
  });

  test('after last lesson at 16:00 returns after', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('16:00');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('after');
    expect(result.prevLesson.room).toBe('Gym');
    expect(result.prevBell).toEqual({ start: '14:30', end: '15:15' });
  });

  test('no schedule row for lesson returns lesson with room null', () => {
    const bellMap = makeBellMap();
    const scheduleRows = [
      { lessonNumber: 1, subjectName: 'Русский', dayOfWeek: 0, room: '101' },
      // lesson 2 missing
      { lessonNumber: 3, subjectName: 'Физика', dayOfWeek: 0, room: '205' },
    ];
    const now = moscowDate('09:30'); // lesson 2 time
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('lesson');
    expect(result.lessonNumber).toBe(2);
    expect(result.room).toBeNull();
    expect(result.subjectName).toBeNull();
  });

  test('edge 09:15 exactly → break not lesson', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('09:15');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('break');
    expect(result.nextLesson.lessonNumber).toBe(2);
  });

  test('edge 09:25 exactly → lesson 2 (inclusive start)', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('09:25');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('lesson');
    expect(result.lessonNumber).toBe(2);
  });

  test('handles room=null returns room null but status lesson', () => {
    const bellMap = makeBellMap();
    const scheduleRows = [
      { lessonNumber: 2, subjectName: 'Математика', dayOfWeek: 0, room: null },
    ];
    const now = moscowDate('09:30');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('lesson');
    expect(result.room).toBeNull();
    expect(result.lessonNumber).toBe(2);
  });

  test('injected {hours,minutes} works without Date', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const result = resolveCurrentLesson({
      now: { hours: 9, minutes: 30 },
      scheduleRows,
      bellMap,
    });
    expect(result.status).toBe('lesson');
    expect(result.room).toBe('304');
  });

  test('deterministic and <5ms', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('11:00');
    const r1 = resolveCurrentLesson({ now, scheduleRows, bellMap });
    const r2 = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(r1).toEqual(r2);
    const start = Date.now();
    for (let i = 0; i < 1000; i++) resolveCurrentLesson({ now, scheduleRows, bellMap });
    const elapsed = Date.now() - start;
    expect(elapsed / 1000).toBeLessThan(5); // avg <5ms
  });

  test('during break between lesson 3 and 4 (11:16) returns break with correct prev/next', () => {
    const bellMap = makeBellMap();
    const scheduleRows = makeScheduleRows();
    const now = moscowDate('11:16');
    const result = resolveCurrentLesson({ now, scheduleRows, bellMap });
    expect(result.status).toBe('break');
    expect(result.prevLesson.lessonNumber).toBe(3);
    expect(result.nextLesson.lessonNumber).toBe(4);
  });
});
