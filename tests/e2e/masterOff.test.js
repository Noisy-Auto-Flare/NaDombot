/**
 * P5 e2e — мастер ВЫКЛ ≡ forced all (A7): никого ни о чём не спрашивают,
 * все видят склейку с тегами тем же кодом, что scope all. Временная БД.
 */

'use strict';

const { setupTempDb, cleanupTempDb } = require('./db');

const tmpDir = setupTempDb('e2e-masteroff-');

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { User, Homework } = require('../../src/models');
const { setMultiprofileEnabled } = require('../../src/utils/settings');
const {
  getHomeworkForDate,
  getScheduleForDay,
  formatHomeworkMerged,
  getTagContext
} = require('../../src/utils/scheduleUtils');
const { findNextLesson } = require('../../src/utils/scheduleUtils');
const { getEffectiveScope, isVisibleWithScope } = require('../../src/utils/audience');
const scheduleService = require('../../src/services/scheduleService');
const { createMockCtx, replyTexts, replyButtons } = require('./mockCtx');
const { handleStart } = require('../../src/handlers/commands');

const NOBODY = 5001;

const MONDAY = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));
const MONDAY_STR = '2026-10-05';

let bio;
let informTech;
let informSoc;

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(false);
  await User.create({ userId: NOBODY, firstName: 'No', username: 'nobody' });

  bio = await scheduleService.create({
    dayOfWeek: 0, lessonNumber: 3, subjectName: 'Биология', room: '3026',
    classId: '10А', trackId: null, subgroupId: null
  });
  informTech = await scheduleService.create({
    dayOfWeek: 0, lessonNumber: 2, subjectName: 'Информатика', room: '1058',
    classId: '10А', trackId: 'tech', subgroupId: null
  });
  informSoc = await scheduleService.create({
    dayOfWeek: 0, lessonNumber: 2, subjectName: 'Информатика', room: '2040',
    classId: '10А', trackId: 'soc', subgroupId: null
  });

  await Homework.create({ userId: NOBODY, scheduleId: bio.id, date: MONDAY_STR, content: 'био общая' });
  await Homework.create({ userId: NOBODY, scheduleId: informTech.id, date: MONDAY_STR, content: 'прога тех' });
  await Homework.create({ userId: NOBODY, scheduleId: informSoc.id, date: MONDAY_STR, content: 'прога соц' });
});

afterAll(async () => {
  await sequelize.close();
  cleanupTempDb(tmpDir);
});

describe('A7: мастер ВЫКЛ — все видят склейку, вопросов нет', () => {
  test('без профиля: расписание дня — все варианты, merged-view с тегами', async () => {
    const schedules = await getScheduleForDay(0, null);
    expect(schedules.map((s) => s.id)).toEqual(
      expect.arrayContaining([bio.id, informTech.id, informSoc.id])
    );

    const data = await getHomeworkForDate(NOBODY, MONDAY);
    expect(data.schedules.map((s) => s.id)).toEqual(
      expect.arrayContaining([bio.id, informTech.id, informSoc.id])
    );
    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text).toContain('2. Информатика — каб. 1058 [Тех]');
    expect(text).toContain('2. Информатика — каб. 2040 [Соц.-эконом.]');
    expect(text).toContain('био общая');
  });

  test('меню без профиля не предлагает онбординг', async () => {
    const { ctx, calls } = createMockCtx({ userId: NOBODY, firstName: 'No' });
    await handleStart(ctx);
    expect(replyButtons(calls)).not.toContain('select_profile');
    expect(replyTexts(calls).join('\n')).toContain('Привет');
  });

  test('запись как в OLD: findNextLesson без профиля находит урок', async () => {
    const found = await findNextLesson('Биология', new Date(Date.UTC(2026, 9, 1, 12, 0, 0)), null);
    expect(found).toBeTruthy();
    expect(found.schedule.id).toBe(bio.id);
  });

  test('forced all на уровне предикатов', () => {
    expect(getEffectiveScope({ classId: '10А', scope: 'own' }, false)).toBe('all');
    expect(getEffectiveScope(null, false)).toBe('all');
    expect(
      isVisibleWithScope({ classId: '10А', trackId: 'tech' }, { classId: '10А', trackId: 'soc' }, false)
    ).toBe(true);
  });
});
