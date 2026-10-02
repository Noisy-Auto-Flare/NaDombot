/**
 * G1/G2/G3: сеть безопасности протухших кнопок, текст-фолбэк, scope-aware виды.
 * Временная БД (прод не трогаем).
 */

'use strict';

const { setupTempDb, cleanupTempDb } = require('../e2e/db');

const tmpDir = setupTempDb('int-staletextscope-');

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { User, UserProfile } = require('../../src/models');
const { setMultiprofileEnabled } = require('../../src/utils/settings');
const { seedLessonTimes } = require('../../src/utils/seedLessonTimes');
const scheduleService = require('../../src/services/scheduleService');
const { getMoscowDayOfWeek } = require('../../src/utils/moscowTime');
const { getRecentLessonRows } = require('../../src/utils/recentLessons');
const { handleCurrentLesson } = require('../../src/handlers/commands');
const { handleTextFallback } = require('../../src/handlers/textFallback');
const {
  handleStaleCallback,
  resetStaleCallbackThrottle,
  STALE_CALLBACK_TEXT
} = require('../../src/handlers/staleCallback');
const { createMockCtx, replyTexts, replyButtons } = require('../e2e/mockCtx');

const OBSERVER = 6001;
const READER = 6002;

// Понедельник 2026-10-05, 18:00 мск — после порога quick-pick (16:30): возврат всех видимых рядов.
const MONDAY_LATE = new Date(Date.UTC(2026, 9, 5, 15, 0, 0));

function observerProfile() {
  return { classId: '10А', trackId: 'tech', subgroupId: null, scope: 'all' };
}

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
  await seedLessonTimes();
  const today = getMoscowDayOfWeek(new Date());

  // Quick-pick ряды понедельника: один предмет, два трека
  await scheduleService.create({
    dayOfWeek: 0, lessonNumber: 2, subjectName: 'ИнформатикаНаблюд', room: '1058',
    classId: '10А', trackId: 'tech', subgroupId: null
  });
  await scheduleService.create({
    dayOfWeek: 0, lessonNumber: 2, subjectName: 'ИнформатикаНаблюд', room: '2040',
    classId: '10А', trackId: 'soc', subgroupId: null
  });
  // Текст-фолбэк: уникальный предмет
  await scheduleService.create({
    dayOfWeek: 2, lessonNumber: 1, subjectName: 'МатематикаУникум', room: '304',
    classId: '10А', trackId: null, subgroupId: null
  });
  // Current-lesson: единственный soc-ряд сегодня (любой статус упомянет предмет)
  await scheduleService.create({
    dayOfWeek: today, lessonNumber: 5, subjectName: 'СоцКанарейка', room: '2040',
    classId: '10А', trackId: 'soc', subgroupId: null
  });

  await User.create({ userId: OBSERVER, firstName: 'Obs', username: 'obs' });
  await UserProfile.create({ userId: OBSERVER, classId: '10А', trackId: 'tech', subgroupId: null, scope: 'all' });
  await User.create({ userId: READER, firstName: 'Reader', username: 'reader' });
});

afterAll(async () => {
  await sequelize.close();
  cleanupTempDb(tmpDir);
});

describe('G1: fallback протухших колбэков', () => {
  beforeEach(() => {
    resetStaleCallbackThrottle();
  });
  function staleCtx(userId) {
    const { ctx, calls } = createMockCtx({ userId, callbackData: 'dead_menu_xyz' });
    const answers = [];
    ctx.answerCbQuery = async (text) => {
      answers.push(text);
      calls.answered += 1;
      return true;
    };
    return { ctx, calls, answers };
  }
  test('неизвестный колбэк: answer ⚠️ + свежее меню', async () => {
    const { ctx, calls, answers } = staleCtx(READER);
    await handleStaleCallback(ctx);
    expect(answers).toContain(STALE_CALLBACK_TEXT);
    expect(calls.replies.length).toBe(1);
    expect(replyTexts(calls).join('\n')).toContain('Выберите действие');
  });
  test('троттлинг: 6 тапов в окне 60с — один ре-рендер меню', async () => {
    const { ctx, calls, answers } = staleCtx(READER);
    for (let i = 0; i < 6; i++) await handleStaleCallback(ctx);
    expect(answers.length).toBe(6);
    expect(answers.every((a) => a === STALE_CALLBACK_TEXT)).toBe(true);
    expect(calls.replies.length).toBe(1);
  });
  test('после сброса окна — меню снова отрисовывается', async () => {
    const { ctx, calls } = staleCtx(READER);
    await handleStaleCallback(ctx);
    expect(calls.replies.length).toBe(1);
    resetStaleCallbackThrottle();
    await handleStaleCallback(ctx);
    expect(calls.replies.length).toBe(2);
  });
});

describe('G2: текст вне сцен не молчит', () => {
  test('совпадение с предметом: Нашёл + кнопки add_homework/меню', async () => {
    const { ctx, calls } = createMockCtx({ userId: READER, messageText: 'математикауникум' });
    const consumed = await handleTextFallback(ctx);
    expect(consumed).toBe(true);
    expect(replyTexts(calls).join('\n')).toContain('Нашёл «МатематикаУникум»');
    expect(replyButtons(calls)).toContain('add_homework');
    expect(replyButtons(calls)).toContain('back_to_menu');
  });
  test('без совпадения: короткая подсказка с /start', async () => {
    const { ctx, calls } = createMockCtx({ userId: READER, messageText: 'абракадабра' });
    const consumed = await handleTextFallback(ctx);
    expect(consumed).toBe(true);
    expect(replyTexts(calls).join('\n')).toContain('/start');
  });
  test('внутри сцены — пропуск без ответа', async () => {
    const { ctx, calls } = createMockCtx({ userId: READER, messageText: 'математикауникум' });
    ctx.scene.current = { id: 'addHomework' };
    const consumed = await handleTextFallback(ctx);
    expect(consumed).toBe(false);
    expect(calls.replies.length).toBe(0);
  });
  test('команда — пропуск без ответа', async () => {
    const { ctx, calls } = createMockCtx({ userId: READER, messageText: '/start' });
    const consumed = await handleTextFallback(ctx);
    expect(consumed).toBe(false);
    expect(calls.replies.length).toBe(0);
  });
});

describe('G3: observer-with-track видит чужие треки', () => {
  test('quick-pick: scope=all видит soc-строку, own — только свой трек', async () => {
    const all = await getRecentLessonRows({ now: MONDAY_LATE, profile: observerProfile() });
    const subjects = all.map((r) => `${r.subjectName}|${r.trackId}|${r.room}`);
    expect(subjects).toContain('ИнформатикаНаблюд|tech|1058');
    expect(subjects).toContain('ИнформатикаНаблюд|soc|2040');
    const own = await getRecentLessonRows({
      now: MONDAY_LATE,
      profile: { classId: '10А', trackId: 'tech', subgroupId: null, scope: 'own' }
    });
    expect(own.map((r) => r.trackId)).not.toContain('soc');
    expect(own.map((r) => `${r.subjectName}|${r.trackId}`)).toContain('ИнформатикаНаблюд|tech');
  });
  test('current-lesson: observer видит soc-строку', async () => {
    const { ctx, calls } = createMockCtx({ userId: OBSERVER });
    await handleCurrentLesson(ctx);
    expect(replyTexts(calls).join('\n')).toContain('СоцКанарейка');
  });
});
