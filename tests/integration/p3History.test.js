/**
 * P3 — история ДЗ + ретеншн событий 60 дней + homeworkCount + durationMs/status.
 * Временный SQLITE_PATH, прод-БД не трогаем.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-history-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
delete process.env.MULTIPROFILE_FORCE;
delete process.env.AUDIENCE_CONFIG_PATH;

jest.setTimeout(60000);

const { syncDatabase, sequelize, _ensureUserEventTelemetryColumns } = require('../../src/config/database');
const { User, UserEvent, Homework } = require('../../src/models');
const { setUserProfile } = require('../../src/utils/userProfile');
const { setMultiprofileEnabled, setHomeworkVisibility } = require('../../src/utils/settings');
const scheduleService = require('../../src/services/scheduleService');
const { getMoscowDayOfWeek } = require('../../src/utils/moscowTime');
const {
  getMoscowToday,
  addDays,
  toISODate,
  getHistoryForRange,
  getHistoryWeek,
  formatHistoryCompact
} = require('../../src/utils/history');
const { cleanupOldUserEvents } = require('../../src/utils/cleanup');
const { incrementHomeworkCount } = require('../../src/utils/homeworkWrite');
const { userTelemetry } = require('../../src/middleware/userTelemetry');

const TECH_ID = 3001;
const OBS_ID = 3002;

let pastMonday;

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
  await setHomeworkVisibility('shared');

  // Прошлый понедельник (строго в прошлом) — «болел неделю»
  const today = getMoscowToday();
  const dow = getMoscowDayOfWeek(today);
  const thisMonday = addDays(today, -(dow === 0 ? 7 : dow));
  pastMonday = addDays(thisMonday, -7);
  const pastMondayDow = getMoscowDayOfWeek(pastMonday);
  expect(pastMondayDow).toBe(0);

  const bio = await scheduleService.create({
    dayOfWeek: 0,
    lessonNumber: 3,
    subjectName: 'Биология',
    room: '3026',
    classId: '10А',
    trackId: null,
    subgroupId: null
  });
  const informTech = await scheduleService.create({
    dayOfWeek: 0,
    lessonNumber: 2,
    subjectName: 'Информатика',
    room: '1058',
    classId: '10А',
    trackId: 'tech',
    subgroupId: null
  });
  const informSoc = await scheduleService.create({
    dayOfWeek: 0,
    lessonNumber: 2,
    subjectName: 'Информатика',
    room: '2040',
    classId: '10А',
    trackId: 'soc',
    subgroupId: null
  });

  await User.create({ userId: TECH_ID, firstName: 'Tech', username: 'techp3' });
  await User.create({ userId: OBS_ID, firstName: 'Obs', username: 'obsp3' });
  await setUserProfile(TECH_ID, { classId: '10А', trackId: 'tech', subgroupId: null, scope: 'own' });
  await setUserProfile(OBS_ID, { classId: '10А', trackId: null, subgroupId: null, scope: 'all' });

  const mondayStr = toISODate(pastMonday);
  await Homework.create({ userId: TECH_ID, scheduleId: bio.id, date: mondayStr, content: 'био §12 повторить' });
  await Homework.create({ userId: TECH_ID, scheduleId: informTech.id, date: mondayStr, content: 'прога тех: цикл' });
  await Homework.create({ userId: OBS_ID, scheduleId: informSoc.id, date: mondayStr, content: 'прога соц: §3' });
  // Дубль того же текста — схлопнется в истории
  await Homework.create({ userId: OBS_ID, scheduleId: bio.id, date: mondayStr, content: 'био §12 повторить' });
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P3 история за диапазон со скоупом («болел неделю»)', () => {
  test('own/tech видит общее + своё, чужой вариант — нет', async () => {
    const start = pastMonday;
    const end = addDays(pastMonday, 6);
    const days = await getHistoryForRange(TECH_ID, start, end);
    expect(days).toHaveLength(7);
    const text = formatHistoryCompact(days);
    expect(text).toContain('Биология: био §12 повторить');
    expect(text).toContain('Информатика: прога тех: цикл');
    expect(text).not.toContain('прога соц');
    // Дубль схлопнут — текст встречается один раз
    expect(text.match(/био §12 повторить/g).length).toBe(1);
    // Компактный вид: DD.MM — Предмет: текст, без украшений
    const ddmm = `${String(pastMonday.getDate()).padStart(2, '0')}.${String(pastMonday.getMonth() + 1).padStart(2, '0')}`;
    expect(text).toContain(`${ddmm} — Биология: био §12 повторить`);
    expect(text).not.toContain('📝');
  });

  test('наблюдатель all видит всё заданное за неделю', async () => {
    const days = await getHistoryForRange(OBS_ID, pastMonday, addDays(pastMonday, 6));
    const text = formatHistoryCompact(days);
    expect(text).toContain('био §12 повторить');
    expect(text).toContain('прога тех: цикл');
    expect(text).toContain('прога соц: §3');
  });

  test('пустой диапазон — вежливое «нет заданий»', async () => {
    const future = addDays(getMoscowToday(), -60);
    const days = await getHistoryForRange(TECH_ID, addDays(future, -6), addDays(future, -1));
    expect(formatHistoryCompact(days)).toBe('За этот период домашних заданий нет.');
  });

  test('getHistoryWeek: окно 7 дней, конец — сегодня', async () => {
    const { days, start, end, offset } = await getHistoryWeek(TECH_ID, 0);
    expect(offset).toBe(0);
    expect(days).toHaveLength(7);
    expect(toISODate(end)).toBe(toISODate(getMoscowToday()));
    expect(toISODate(start)).toBe(toISODate(addDays(getMoscowToday(), -6)));
  });
});

describe('P3 ретеншн user_events 60 дней', () => {
  test('старые события чистятся запросом, свежие и users целы', async () => {
    const oldDate = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    const oldEv = await UserEvent.create({ userId: TECH_ID, type: 'message', payload: 'old', status: 'ok' });
    await sequelize.query('UPDATE user_events SET createdAt = :d WHERE id = :id', {
      replacements: { d: oldDate.toISOString(), id: oldEv.id }
    });
    const freshEv = await UserEvent.create({ userId: TECH_ID, type: 'message', payload: 'fresh', status: 'ok' });

    const deleted = await cleanupOldUserEvents();
    expect(deleted).toBeGreaterThanOrEqual(1);

    const [rows] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM user_events WHERE createdAt < date('now','-60 days')"
    );
    expect(Number(rows[0].cnt)).toBe(0);

    expect(await UserEvent.findByPk(freshEv.id)).toBeTruthy();
    expect(await UserEvent.findByPk(oldEv.id)).toBeNull();
    // users не трогаем
    expect(await User.findByPk(TECH_ID)).toBeTruthy();
  });
});

describe('P3 счётчик homeworkCount', () => {
  test('incrementHomeworkCount растёт на число созданных', async () => {
    const uid = 3999;
    await User.create({ userId: uid, firstName: 'Cnt', homeworkCount: 0, interactionCount: 0 });
    expect(await incrementHomeworkCount(uid)).toBe(1);
    expect(await incrementHomeworkCount(uid)).toBe(2);
    expect((await User.findByPk(uid)).homeworkCount).toBe(2);
  });

  test('сам Homework.create счётчик не меняет (только явный инкремент)', async () => {
    const uid = 3998;
    await User.create({ userId: uid, firstName: 'Cnt2', homeworkCount: 5, interactionCount: 0 });
    const s = await scheduleService.create({
      dayOfWeek: 2,
      lessonNumber: 1,
      subjectName: 'СчётчикПредмет',
      classId: '10А',
      trackId: null,
      subgroupId: null
    });
    await Homework.create({ userId: uid, scheduleId: s.id, date: toISODate(getMoscowToday()), content: 'x' });
    expect((await User.findByPk(uid)).homeworkCount).toBe(5);
  });
});

describe('P3 durationMs/status в событиях', () => {
  function mockCtx(uid) {
    return {
      from: { id: uid, username: 'tm', first_name: 'Tm', last_name: null, language_code: 'ru' },
      chat: { type: 'private' },
      message: { text: 'привет' },
      updateType: 'message'
    };
  }

  test('ok-путь: durationMs число, status ok', async () => {
    const uid = 3777;
    let nextCalled = false;
    await userTelemetry(mockCtx(uid), async () => {
      nextCalled = true;
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(nextCalled).toBe(true);
    const ev = await UserEvent.findOne({ where: { userId: uid }, order: [['id', 'DESC']] });
    expect(ev).toBeTruthy();
    expect(ev.status).toBe('ok');
    expect(typeof ev.durationMs).toBe('number');
    expect(ev.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('error-путь: status error, ошибка проброшена', async () => {
    const uid = 3778;
    await expect(
      userTelemetry(mockCtx(uid), async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const ev = await UserEvent.findOne({ where: { userId: uid }, order: [['id', 'DESC']] });
    expect(ev).toBeTruthy();
    expect(ev.status).toBe('error');
    expect(typeof ev.durationMs).toBe('number');
  });

  test('prelim-миграция чинит legacy-таблицу без колонок + backfill ok', async () => {
    const qi = sequelize.getQueryInterface();
    await sequelize.query('ALTER TABLE user_events DROP COLUMN status');
    await sequelize.query('ALTER TABLE user_events DROP COLUMN durationMs');
    const before = await qi.describeTable('user_events');
    expect(before.status).toBeUndefined();
    expect(before.durationMs).toBeUndefined();
    await _ensureUserEventTelemetryColumns();
    const after = await qi.describeTable('user_events');
    expect(after.status).toBeTruthy();
    expect(after.durationMs).toBeTruthy();
    const ev = await UserEvent.create({ userId: TECH_ID, type: 'command', payload: 'backfill-check' });
    expect(ev.status).toBe('ok');
  });
});
