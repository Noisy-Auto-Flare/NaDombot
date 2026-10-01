/**
 * P2 item 2–4 — scope-миграция, disambiguation, optimistic-конфликт, personal+all приватность.
 * Временный SQLITE_PATH, прод-БД не трогаем.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-scope-write-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
delete process.env.MULTIPROFILE_FORCE;
delete process.env.AUDIENCE_CONFIG_PATH;

jest.setTimeout(60000);

const { syncDatabase, sequelize, _ensureUserProfileScopeColumn } = require('../../src/config/database');
const { User, UserProfile, Setting } = require('../../src/models');
const { setUserProfile, setUserScope } = require('../../src/utils/userProfile');
const { setMultiprofileEnabled, setHomeworkVisibility } = require('../../src/utils/settings');
const { isVisibleWithScope, getEffectiveScope } = require('../../src/utils/audience');
const scheduleService = require('../../src/services/scheduleService');
const { getHomeworkForDate, formatHomeworkMerged, getTagContext } = require('../../src/utils/scheduleUtils');
const { replaceHomeworkConditional, fetchExistingHomework } = require('../../src/utils/homeworkWrite');

const MONDAY = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));
const MONDAY_STR = '2026-10-05';
const TECH_ID = 1001;
const SOC_ID = 1002;

beforeAll(async () => {
  await syncDatabase();
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('P2 scope-миграция user_profiles.scope', () => {
  test('дефолт own для новых профилей', async () => {
    await User.create({ userId: TECH_ID, firstName: 'Ivan', username: 'ivan' });
    const p = await setUserProfile(TECH_ID, { classId: '10А', trackId: 'tech', subgroupId: 'belova' });
    expect(p.scope).toBe('own');
  });

  test('prelim-миграция чинит legacy-таблицу без колонки + backfill own', async () => {
    await sequelize.query('ALTER TABLE user_profiles DROP COLUMN scope');
    const qi = sequelize.getQueryInterface();
    const before = await qi.describeTable('user_profiles');
    expect(before.scope).toBeUndefined();
    await _ensureUserProfileScopeColumn();
    const after = await qi.describeTable('user_profiles');
    expect(after.scope).toBeTruthy();
    // существующая строка на месте и с own
    const p = await UserProfile.findByPk(TECH_ID);
    expect(p).toBeTruthy();
    expect(p.scope).toBe('own');
    // setUserScope переключает
    await setUserScope(TECH_ID, 'all');
    expect((await UserProfile.findByPk(TECH_ID)).scope).toBe('all');
    await setUserScope(TECH_ID, 'own');
  });

  test('невалидный scope отклоняется', async () => {
    await expect(setUserScope(TECH_ID, 'everyone')).rejects.toThrow('SCOPE_INVALID');
  });
});

describe('P2 стенд A2–A5: слоты, приватность, disambiguation', () => {
  let bio;
  let informTech;
  let informSoc;

  beforeAll(async () => {
    await setMultiprofileEnabled(true);
    await setHomeworkVisibility('personal');
    bio = await scheduleService.create({
      dayOfWeek: 0,
      lessonNumber: 3,
      subjectName: 'Биология',
      room: '3026',
      classId: '10А',
      trackId: null,
      subgroupId: null
    });
    informTech = await scheduleService.create({
      dayOfWeek: 0,
      lessonNumber: 2,
      subjectName: 'Информатика',
      room: '1058',
      classId: '10А',
      trackId: 'tech',
      subgroupId: null
    });
    informSoc = await scheduleService.create({
      dayOfWeek: 0,
      lessonNumber: 2,
      subjectName: 'Информатика',
      room: '2040',
      classId: '10А',
      trackId: 'soc',
      subgroupId: null
    });
    await User.create({ userId: SOC_ID, firstName: 'Petr', username: 'petr' });
    await setUserProfile(TECH_ID, { classId: '10А', trackId: 'tech', subgroupId: 'belova', scope: 'own' });
    await setUserProfile(SOC_ID, { classId: '10А', trackId: null, subgroupId: null, scope: 'all' });
    const { Homework } = require('../../src/models');
    await Homework.create({ userId: TECH_ID, scheduleId: bio.id, date: MONDAY_STR, content: 'био от теха' });
    await Homework.create({ userId: TECH_ID, scheduleId: informTech.id, date: MONDAY_STR, content: 'прога тех' });
    await Homework.create({ userId: SOC_ID, scheduleId: informSoc.id, date: MONDAY_STR, content: 'прога соц' });
  });

  test('A2 own: tech видит свои уроки (био + информатика-тех), без соц-варианта', async () => {
    const data = await getHomeworkForDate(TECH_ID, MONDAY);
    const ids = data.schedules.map((s) => s.id);
    expect(ids).toContain(bio.id);
    expect(ids).toContain(informTech.id);
    expect(ids).not.toContain(informSoc.id);
  });

  test('A5 disambiguation: scope all + информатика → 2 варианта; own → 1', async () => {
    const all = await scheduleService.findBySubjectNormalized('информатика', { classId: '10А', scope: 'all' });
    expect(all.map((s) => s.id).sort()).toEqual([informTech.id, informSoc.id].sort());
    const own = await scheduleService.findBySubjectNormalized('информатика', {
      classId: '10А',
      trackId: 'tech',
      subgroupId: 'belova'
    });
    expect(own.map((s) => s.id)).toEqual([informTech.id]);
  });

  test('A3 personal+all: ВСЕ уроки видны, но чужие тексты — НЕТ', async () => {
    const data = await getHomeworkForDate(SOC_ID, MONDAY);
    expect(data.schedules.map((s) => s.id).sort()).toEqual([bio.id, informTech.id, informSoc.id].sort());
    // personal: только свои строки
    for (const hw of data.homeworks) expect(String(hw.userId)).toBe(String(SOC_ID));
    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text).toContain('прога соц');
    expect(text).not.toContain('био от теха');
    expect(text).not.toContain('прога тех');
    // теги вариантов обязательны
    expect(text).toContain('[Тех]');
    expect(text).toContain('[Соц.-эконом.]');
  });

  test('shared+all: видно всё всё', async () => {
    await setHomeworkVisibility('shared');
    try {
      const data = await getHomeworkForDate(SOC_ID, MONDAY);
      const tagCtx = await getTagContext();
      const text = formatHomeworkMerged(data, tagCtx);
      expect(text).toContain('био от теха');
      expect(text).toContain('прога тех');
      expect(text).toContain('прога соц');
    } finally {
      await setHomeworkVisibility('personal');
    }
  });

  test('A4 общий урок: биология techa видна soc в shared', async () => {
    await setHomeworkVisibility('shared');
    try {
      const data = await getHomeworkForDate(SOC_ID, MONDAY);
      const bioTexts = data.homeworks.filter((h) => h.scheduleId === bio.id).map((h) => h.content);
      expect(bioTexts).toContain('био от теха');
    } finally {
      await setHomeworkVisibility('personal');
    }
  });

  test('master OFF ≡ forced all', () => {
    const foreign = { classId: '10А', trackId: 'soc', subgroupId: null };
    expect(isVisibleWithScope({ classId: '10А', trackId: 'tech' }, foreign, false)).toBe(true);
    expect(getEffectiveScope(foreign, false)).toBe('all');
    expect(getEffectiveScope({ ...foreign, scope: 'all' }, true)).toBe('all');
    expect(getEffectiveScope({ ...foreign, scope: 'own' }, true)).toBe('own');
    expect(isVisibleWithScope({ classId: '10А', trackId: 'tech' }, { classId: '10А', scope: 'all' }, true)).toBe(true);
    expect(isVisibleWithScope({ classId: '10А', trackId: 'tech' }, foreign, true)).toBe(false);
  });
});

describe('P2 запись: optimistic locking замены', () => {
  const DATE2 = '2026-10-06';
  let schedId;

  beforeAll(async () => {
    const s = await scheduleService.create({
      dayOfWeek: 1,
      lessonNumber: 1,
      subjectName: 'Математика',
      room: null,
      classId: '10А',
      trackId: null,
      subgroupId: null
    });
    schedId = s.id;
    const { Homework } = require('../../src/models');
    await Homework.create({ userId: TECH_ID, scheduleId: schedId, date: DATE2, content: 'вариант 1' });
  });

  test('stale updatedAt → конфликт (0 affected) + свежие строки', async () => {
    const rows = await fetchExistingHomework(schedId, DATE2);
    expect(rows.length).toBe(1);
    const res = await replaceHomeworkConditional({
      scheduleId: schedId,
      dateStr: DATE2,
      lastId: rows[0].id,
      seenUpdatedAt: new Date(0),
      content: 'попытка замены',
      userId: SOC_ID
    });
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].content).toBe('вариант 1');
  });

  test('свежий updatedAt → замена ok, upsert не плодит строк', async () => {
    const rows = await fetchExistingHomework(schedId, DATE2);
    const res = await replaceHomeworkConditional({
      scheduleId: schedId,
      dateStr: DATE2,
      lastId: rows[0].id,
      seenUpdatedAt: rows[0].updatedAt,
      content: 'вариант 2',
      userId: SOC_ID
    });
    expect(res.ok).toBe(true);
    const after = await fetchExistingHomework(schedId, DATE2);
    expect(after.length).toBe(1);
    expect(after[0].content).toBe('вариант 2');
  });

  test('Setting multiprofile читается (sanity)', async () => {
    const row = await Setting.findByPk('multiprofile_enabled');
    expect(row && String(row.value)).toBe('1');
  });
});
