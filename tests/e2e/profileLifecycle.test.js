/**
 * P5 e2e — вкладка /profile: карточка, тоггл Моё/Всё, сброс → онбординг заново (A6).
 * Хендлеры commands.js на моке ctx, временная БД.
 */

'use strict';

const { setupTempDb, cleanupTempDb } = require('./db');

const tmpDir = setupTempDb('e2e-profile-');

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { User } = require('../../src/models');
const { setMultiprofileEnabled } = require('../../src/utils/settings');
const { setUserProfile, getUserProfile } = require('../../src/utils/userProfile');
const { createMockCtx, replyTexts, replyButtons } = require('./mockCtx');
const {
  handleStart,
  handleProfile,
  handleProfileToggleScope,
  handleProfileEditTrack,
  handleProfileReset
} = require('../../src/handlers/commands');

const USER = 4001;

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
  await User.create({ userId: USER, firstName: 'Ivan', username: 'ivan' });
  await setUserProfile(USER, { classId: '10А', trackId: 'tech', subgroupId: 'belova', scope: 'own' });
});

afterAll(async () => {
  await sequelize.close();
  cleanupTempDb(tmpDir);
});

describe('A6: карточка /profile', () => {
  test('показывает класс/профиль/учителя/режим + кнопки действий', async () => {
    const { ctx, calls } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfile(ctx);
    const all = replyTexts(calls).join('\n');
    expect(all).toContain('Ваш профиль');
    expect(all).toContain('10А');
    expect(all).toContain('Технологический');
    expect(all).toContain('Белова');
    expect(all).toContain('Моё');
    const buttons = replyButtons(calls);
    expect(buttons).toEqual(
      expect.arrayContaining([
        'profile_edit_class',
        'profile_edit_track',
        'profile_edit_subgroup',
        'profile_toggle_scope',
        'profile_reset'
      ])
    );
  });

  test('«Изменить профиль» ведёт в selectProfile с edit=track', async () => {
    const { ctx, calls } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfileEditTrack(ctx);
    expect(calls.entered).toEqual([{ scene: 'selectProfile', state: { edit: 'track' } }]);
  });
});

describe('A6: тоггл 👁 Моё/Всё', () => {
  test('own → all и обратно', async () => {
    const { ctx: ctx1, calls: calls1 } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfileToggleScope(ctx1);
    expect(replyTexts(calls1).join('\n')).toContain('Видеть всё');
    expect((await getUserProfile(USER)).scope).toBe('all');

    const { ctx: ctx2, calls: calls2 } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfileToggleScope(ctx2);
    expect(replyTexts(calls2).join('\n')).toContain('Моё');
    expect((await getUserProfile(USER)).scope).toBe('own');
  });
});

describe('A6: сброс профиля → онбординг заново', () => {
  test('reset стирает профиль, меню снова предлагает онбординг', async () => {
    const { ctx, calls } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfileReset(ctx);
    expect(replyTexts(calls).join('\n')).toContain('Профиль сброшен');
    expect(await getUserProfile(USER)).toBeNull();

    const again = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleStart(again.ctx);
    expect(replyButtons(again.calls)).toContain('select_profile');
    expect(replyTexts(again.calls).join('\n')).not.toContain('👤 10А');
  });

  test('тоггл без профиля просит выбрать профиль', async () => {
    const { ctx, calls } = createMockCtx({ userId: USER, firstName: 'Ivan' });
    await handleProfileToggleScope(ctx);
    expect(replyTexts(calls).join('\n')).toContain('Профиль не выбран');
    expect(replyButtons(calls)).toContain('select_profile');
  });
});
