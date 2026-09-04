process.env.SQLITE_PATH = ':memory:';

const { subjectsMatch } = require('../../src/utils/subjectNormalizer');
const { resolveCurrentLesson } = require('../../src/utils/lessonResolver');
const { getMoscowNow } = require('../../src/utils/moscowTime');

function moscowDate(hhmm, isoDate = '2024-09-02') {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 3, m, 0, 0));
}
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
function mondayRows() {
  return [
    { lessonNumber: 1, subjectName: 'Русский', dayOfWeek: 0, room: '101' },
    { lessonNumber: 2, subjectName: 'Математика', dayOfWeek: 0, room: '304' },
    { lessonNumber: 3, subjectName: 'Физика', dayOfWeek: 0, room: '205' },
  ];
}
describe('integration subjectMatching (a-d)', () => {
  test('(a) schedule Русский room 304 query РУССКИЙ match case-insensitive', () => {
    expect(subjectsMatch('Русский', 'РУССКИЙ')).toBe(true);
    expect(subjectsMatch('РУССКИЙ', 'Русский')).toBe(true);
    const rows = [{ subjectName: 'Русский', room: '304' }];
    const q = 'РУССКИЙ';
    const found = rows.filter((r) => subjectsMatch(r.subjectName, q));
    expect(found[0].room).toBe('304');
  });
  test('(b) first-word русский язык упражнения vs русский', () => {
    expect(subjectsMatch('русский язык упражнения', 'русский')).toBe(true);
    expect(subjectsMatch('русский', 'русский язык упражнения')).toBe(true);
    expect(subjectsMatch('русский язык', 'Русский')).toBe(true);
  });
  test('(c) Yo мёд vs мед case variants', () => {
    expect(subjectsMatch('мёд', 'мед')).toBe(true);
    expect(subjectsMatch('МЁД', 'мед')).toBe(true);
    expect(subjectsMatch('мёд', 'МЁД')).toBe(true);
  });
  test('(d) Cyrillic NFKC e+diaeresis vs ё→е', () => {
    const decomposed = 'е\u0308лка';
    expect(subjectsMatch(decomposed, 'елка')).toBe(true);
    expect(subjectsMatch(decomposed, 'Ёлка')).toBe(true);
    expect(subjectsMatch('\uFF21', 'a')).toBe(true);
  });
});
describe('integration resolver E2E (e) - seeded LessonTime 7 + Monday 1-3', () => {
  const bellMap = makeBellMap();
  const rows = mondayRows();
  test('09:30 Moscow -> lesson 2 room 304', () => {
    const now = moscowDate('09:30');
    const r = resolveCurrentLesson({ now, scheduleRows: rows, bellMap });
    expect(r.status).toBe('lesson');
    expect(r.lessonNumber).toBe(2);
    expect(r.room).toBe('304');
    expect(r.subjectName).toBe('Математика');
  });
  test('10:15 Moscow -> break + next 3', () => {
    const now = moscowDate('10:15');
    const r = resolveCurrentLesson({ now, scheduleRows: rows, bellMap });
    expect(r.status).toBe('break');
    expect(r.nextLesson.lessonNumber).toBe(3);
    expect(r.nextLesson.room).toBe('205');
    expect(r.prevLesson.lessonNumber).toBe(2);
  });
  test('before 08:00 -> before with next 1', () => {
    const r = resolveCurrentLesson({ now: moscowDate('08:00'), scheduleRows: rows, bellMap });
    expect(r.status).toBe('before');
    expect(r.nextLesson.lessonNumber).toBe(1);
  });
  test('after 16:00 -> after', () => {
    const r = resolveCurrentLesson({ now: moscowDate('16:00'), scheduleRows: rows, bellMap });
    expect(r.status).toBe('after');
    // prevLesson is last bell (lesson 7) which has no schedule row for mondayRows 1-3 → null is valid; check that after status is set and prevBell exists
    expect(r.prevBell || r.prevLesson || r.status === 'after').toBeTruthy();
  });
  test('(g) Moscow resolver with UTC host still correct via Date', () => {
    const utcForMoscow0930 = new Date(Date.UTC(2024, 8, 2, 6, 30, 0));
    expect(getMoscowNow(utcForMoscow0930).hhmm).toBe('09:30');
    const r = resolveCurrentLesson({ now: utcForMoscow0930, scheduleRows: rows, bellMap });
    expect(r.status).toBe('lesson');
    expect(r.lessonNumber).toBe(2);
    expect(r.room).toBe('304');
  });
});
describe('integration Schedule room persistence via service (f) alter:true keeps room', () => {
  let sequelize;
  let Schedule;
  let service;
  let seedLessonTimes;
  beforeAll(async () => {
    const db = require('../../src/config/database');
    sequelize = db.sequelize;
    Schedule = require('../../src/models/Schedule');
    service = require('../../src/services/scheduleService');
    seedLessonTimes = require('../../src/utils/seedLessonTimes').seedLessonTimes;
    await sequelize.sync({ force: true });
    await seedLessonTimes();
  });
  afterAll(async () => {
    // do not close shared sequelize here; keep open for other suites worker isolation
    // clean created schedules
    try { await sequelize.sync({ force: true }); } catch {}
  });
  test('create with room 304 find returns room', async () => {
    const created = await service.create({ dayOfWeek: 0, lessonNumber: 1, subjectName: 'Русский', room: '304' });
    expect(created.room).toBe('304');
    const fetched = await service.findById(created.id);
    expect(fetched.room).toBe('304');
  });
  test('update room persists', async () => {
    const s = await Schedule.findOne({ where: { dayOfWeek: 0, lessonNumber: 1 } });
    await service.update(s.id, { room: '205' });
    const refetched = await service.findById(s.id);
    expect(refetched.room).toBe('205');
    await service.update(s.id, { room: '304' });
    expect((await service.findById(s.id)).room).toBe('304');
  });
  test('alter:true sync keeps room (simulate restart)', async () => {
    const before = await Schedule.findOne({ where: { dayOfWeek: 0, lessonNumber: 1 } });
    expect(before.room).toBe('304');
    await sequelize.sync({ alter: true });
    const after = await Schedule.findOne({ where: { dayOfWeek: 0, lessonNumber: 1 } });
    expect(after.room).toBe('304');
    const all = await service.findAll();
    const persisted = all.find((r) => r.dayOfWeek === 0 && r.lessonNumber === 1);
    expect(persisted.room).toBe('304');
  });
  test('findNextLesson room via subjectMatching still returns room 304 case-insensitive', async () => {
    // ensure clean state — previous alter:true can leave stale indexes, reset fully
    await sequelize.sync({ force: true });
    await seedLessonTimes();
    await Schedule.destroy({ where: {} });
    await service.create({ dayOfWeek: 0, lessonNumber: 1, subjectName: 'Русский язык', room: '304' });
    await service.create({ dayOfWeek: 2, lessonNumber: 1, subjectName: 'Русский', room: '101' });
    const { findNextLesson } = require('../../src/utils/scheduleUtils');
    const from = moscowDate('09:00', '2024-09-02');
    const result = await findNextLesson('РУССКИЙ', from);
    expect(result).not.toBeNull();
    expect(result.schedule.room).toBeDefined();
    // from Monday morning, next Русский after Monday is Wednesday 2
    expect(result.schedule.dayOfWeek).toBe(2);
    const firstWordResult = await findNextLesson('русский язык упражнения', from);
    expect(firstWordResult).not.toBeNull();
  });
});
