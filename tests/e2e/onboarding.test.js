/**
 * P5 e2e — онбординг целиком на моке ctx (сценарии A1, A6-частично).
 * Временная БД (свой SQLITE_PATH), steps сцены selectProfile гоняем напрямую.
 */

'use strict';

const { setupTempDb, cleanupTempDb } = require('./db');

const tmpDir = setupTempDb('e2e-onboarding-');

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { User } = require('../../src/models');
const { setMultiprofileEnabled } = require('../../src/utils/settings');
const { getUserProfile } = require('../../src/utils/userProfile');
const { createMockCtx, replyTexts, replyButtons } = require('./mockCtx');
const selectProfileScene = require('../../src/scenes/selectProfileScene');
const { handleStart } = require('../../src/handlers/commands');

const TECH_USER = 2001;
const ALL_USER = 2002;
const TRACK_ALL_USER = 2003;
const REPEAT_USER = 2004;

async function runStep(index, ctx) {
  await selectProfileScene.steps[index](ctx);
}

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
  await User.create({ userId: TECH_USER, firstName: 'Ivan', username: 'ivan' });
  await User.create({ userId: ALL_USER, firstName: 'Petr', username: 'petr' });
  await User.create({ userId: TRACK_ALL_USER, firstName: 'Anna', username: 'anna' });
  await User.create({ userId: REPEAT_USER, firstName: 'Oleg', username: 'oleg' });
});

afterAll(async () => {
  await sequelize.close();
  cleanupTempDb(tmpDir);
});

describe('A1: онбординг целиком tech+belova (класс один — молча, ≤4 клика)', () => {
  test('развилка → профиль → учитель → профиль сохранён + меню', async () => {
    const { ctx, calls } = createMockCtx({ userId: TECH_USER, firstName: 'Ivan' });

    // шаг 0: классов один → развилка scope, класс подставлен молча
    await runStep(0, ctx);
    expect(replyTexts(calls).join('\n')).toContain('Что показывать?');
    expect(ctx.wizard.state.classId).toBe('10А');
    expect(ctx.wizard.cursor).toBe(2);

    // развилка: «Только своё»
    ctx.callbackQuery = { data: 'select_scope:own' };
    await runStep(2, ctx);
    expect(replyTexts(calls).join('\n')).toContain('Выберите профиль');
    expect(ctx.wizard.cursor).toBe(3);

    // профиль: Технологический
    ctx.callbackQuery = { data: 'select_track:tech' };
    await runStep(3, ctx);
    expect(replyTexts(calls).join('\n')).toContain('У кого английский?');
    expect(ctx.wizard.cursor).toBe(4);

    // учитель: Белова → финал: профиль + меню, сцена закрыта
    ctx.callbackQuery = { data: 'select_subgroup:belova' };
    await runStep(4, ctx);
    expect(calls.left).toBe(true);

    const profile = await getUserProfile(TECH_USER);
    expect(profile.classId).toBe('10А');
    expect(profile.trackId).toBe('tech');
    expect(profile.subgroupId).toBe('belova');
    expect(profile.scope).toBe('own');

    const all = replyTexts(calls).join('\n');
    expect(all).toContain('Профиль сохран');
    expect(all).toContain('Привет');
    expect(all).toContain('10А');
  });

  test('повторный вход — сразу меню, вопросов нет', async () => {
    const { ctx, calls } = createMockCtx({ userId: TECH_USER, firstName: 'Ivan' });
    await handleStart(ctx);
    const buttons = replyButtons(calls);
    expect(buttons).not.toContain('select_profile');
    expect(buttons).toContain('profile');
    expect(replyTexts(calls).join('\n')).toContain('👤 10А');
  });
});

describe('A1-альтернатива: третья кнопка «Видеть всё»', () => {
  test('на развилке: scope=all, поля null, онбординг завершён сразу', async () => {
    const { ctx, calls } = createMockCtx({ userId: ALL_USER, firstName: 'Petr' });

    await runStep(0, ctx);
    ctx.callbackQuery = { data: 'select_scope:all' };
    await runStep(2, ctx);
    expect(calls.left).toBe(true);

    const profile = await getUserProfile(ALL_USER);
    expect(profile.classId).toBe('10А');
    expect(profile.trackId).toBeNull();
    expect(profile.subgroupId).toBeNull();
    expect(profile.scope).toBe('all');

    const all = replyTexts(calls).join('\n');
    expect(all).toContain('Видеть всё');
    expect(all).toContain('Привет');
  });

  test('на шаге профиля: «Видеть всё» тоже сохраняет scope=all', async () => {
    const { ctx, calls } = createMockCtx({ userId: TRACK_ALL_USER, firstName: 'Anna' });

    await runStep(0, ctx);
    ctx.callbackQuery = { data: 'select_scope:own' };
    await runStep(2, ctx);
    ctx.callbackQuery = { data: 'select_scope:all' };
    await runStep(3, ctx);
    expect(calls.left).toBe(true);

    const profile = await getUserProfile(TRACK_ALL_USER);
    expect(profile.classId).toBe('10А');
    expect(profile.trackId).toBeNull();
    expect(profile.subgroupId).toBeNull();
    expect(profile.scope).toBe('all');
    expect(replyTexts(calls).join('\n')).toContain('Видеть всё');
  });

  test('без профиля меню предлагает онбординг', async () => {
    const { ctx, calls } = createMockCtx({ userId: REPEAT_USER, firstName: 'Oleg' });
    await handleStart(ctx);
    expect(replyButtons(calls)).toContain('select_profile');
  });
});
