/**
 * P5 e2e — запись+показ ДЗ своим/чужым/наблюдателем, merged-view с тегами,
 * чанкинг (сценарии A2–A5). Запись гоняем через steps addHomeworkScene на моке ctx.
 */

'use strict';

const { setupTempDb, cleanupTempDb } = require('./db');

const tmpDir = setupTempDb('e2e-homework-');

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { User, Homework } = require('../../src/models');
const { setMultiprofileEnabled, setHomeworkVisibility } = require('../../src/utils/settings');
const { setUserProfile } = require('../../src/utils/userProfile');
const {
  getHomeworkForDate,
  formatHomeworkMerged,
  getTagContext,
  splitMessageChunks,
  MESSAGE_CHUNK_LIMIT
} = require('../../src/utils/scheduleUtils');
const scheduleService = require('../../src/services/scheduleService');
const { createMockCtx, replyTexts } = require('./mockCtx');
const addHomeworkScene = require('../../src/scenes/addHomeworkScene');

// Пн 05.10.2026 и Ср 07.10.2026 (московский день совпадает — полдень UTC)
const MONDAY = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));
const MONDAY_STR = '2026-10-05';
const WEDNESDAY = new Date(Date.UTC(2026, 9, 7, 12, 0, 0));
const WEDNESDAY_STR = '2026-10-07';
const MONDAY2_STR = '2026-10-12';

const TECH = 3001;
const SOC = 3002;
const OBS = 3003;

let bio;
let informTech;
let informSoc;
let engBelova;
let engFirfarova;

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
  await setHomeworkVisibility('shared');

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
  engBelova = await scheduleService.create({
    dayOfWeek: 2, lessonNumber: 3, subjectName: 'Английский', room: '4005',
    classId: '10А', trackId: null, subgroupId: 'belova'
  });
  engFirfarova = await scheduleService.create({
    dayOfWeek: 2, lessonNumber: 3, subjectName: 'Английский', room: 'библ',
    classId: '10А', trackId: null, subgroupId: 'firfarova'
  });

  await User.create({ userId: TECH, firstName: 'Ivan', username: 'ivan' });
  await User.create({ userId: SOC, firstName: 'Petr', username: 'petr' });
  await User.create({ userId: OBS, firstName: 'Observer', username: 'observer' });
  await setUserProfile(TECH, { classId: '10А', trackId: 'tech', subgroupId: 'belova', scope: 'own' });
  await setUserProfile(SOC, { classId: '10А', trackId: 'soc', subgroupId: 'firfarova', scope: 'own' });
  await setUserProfile(OBS, { classId: '10А', trackId: null, subgroupId: null, scope: 'all' });

  // чужие строки для проверок видимости (точные даты — напрямую, без toISOString-сдвига сцены)
  await Homework.create({ userId: TECH, scheduleId: bio.id, date: MONDAY_STR, content: 'био от теха' });
  await Homework.create({ userId: SOC, scheduleId: informSoc.id, date: MONDAY_STR, content: 'прога соц' });
  await Homework.create({ userId: TECH, scheduleId: engBelova.id, date: WEDNESDAY_STR, content: 'белова текст' });
  await Homework.create({ userId: SOC, scheduleId: engFirfarova.id, date: WEDNESDAY_STR, content: 'фирфарова текст' });
});

afterAll(async () => {
  await sequelize.close();
  cleanupTempDb(tmpDir);
});

describe('A5-режим «моё»: запись своим через сцену', () => {
  test('tech пишет Биологию: предмет → ближайший урок → текст → строка в БД', async () => {
    // Детерминизм: дата «ближайшего урока» считается от сегодня и может совпасть
    // с фиксированным сидом MONDAY_STR (напр. запуск 02–04.10.2026 → 05.10).
    // Чистим слот сценария, в конце восстанавливаем сид для A2/A4.
    await Homework.destroy({ where: { scheduleId: bio.id, date: MONDAY_STR } });
    const { ctx, calls } = createMockCtx({ userId: TECH, firstName: 'Ivan' });

    await addHomeworkScene.steps[0](ctx);
    expect(replyTexts(calls).join('\n')).toContain('Введите название предмета');
    expect(ctx.wizard.cursor).toBe(1);

    ctx.message = { text: 'Биология' };
    await addHomeworkScene.steps[1](ctx);
    expect(replyTexts(calls).join('\n')).toContain('Найден ближайший урок');
    expect(ctx.wizard.state.scheduleId).toBe(bio.id);
    expect(ctx.wizard.cursor).toBe(2);

    ctx.message = { text: 'стр. 42 упр. 5' };
    await addHomeworkScene.steps[2](ctx);
    expect(replyTexts(calls).join('\n')).toContain('успешно добавлено');
    expect(calls.left).toBe(true);

    const rows = await Homework.findAll({ where: { scheduleId: bio.id } });
    expect(rows.map((r) => r.content)).toContain('стр. 42 упр. 5');
    // Восстанавливаем сид для A2/A4
    await Homework.create({ userId: TECH, scheduleId: bio.id, date: MONDAY_STR, content: 'био от теха' });
  });
});

describe('A5-режим «всё»: disambiguation при >1 варианте', () => {
  test('наблюдатель пишет Информатику: уточнение кнопками → выбор → запись в вариант', async () => {
    const { ctx, calls } = createMockCtx({ userId: OBS, firstName: 'Observer' });

    await addHomeworkScene.steps[0](ctx);
    ctx.message = { text: 'Информатика' };
    await addHomeworkScene.steps[1](ctx);

    const all = replyTexts(calls).join('\n');
    expect(all).toContain('несколько вариантов');
    expect(ctx.wizard.state.pendingPick).toEqual(
      expect.arrayContaining([informTech.id, informSoc.id])
    );
    // уточнение — курсор стоит, ждём кнопку
    expect(ctx.wizard.cursor).toBe(1);

    ctx.message = undefined;
    ctx.callbackQuery = { data: `hw_pick:${informTech.id}` };
    await addHomeworkScene.steps[1](ctx);
    expect(replyTexts(calls).join('\n')).toContain('Найден ближайший урок');
    expect(ctx.wizard.state.scheduleId).toBe(informTech.id);

    ctx.callbackQuery = undefined;
    ctx.message = { text: 'сделать прогу' };
    await addHomeworkScene.steps[2](ctx);
    expect(replyTexts(calls).join('\n')).toContain('успешно добавлено');

    const rows = await Homework.findAll({ where: { scheduleId: informTech.id } });
    expect(rows.map((r) => r.content)).toContain('сделать прогу');
  });
});

describe('A2: своим видно своё, чужой вариант скрыт (personal)', () => {
  beforeAll(async () => {
    await setHomeworkVisibility('personal');
  });

  afterAll(async () => {
    await setHomeworkVisibility('shared');
  });

  test('tech видит био + информатику-тех, без соц-варианта и чужих текстов', async () => {
    await Homework.create({ userId: TECH, scheduleId: informTech.id, date: MONDAY_STR, content: 'прога тех' });
    const data = await getHomeworkForDate(TECH, MONDAY);
    const ids = data.schedules.map((s) => s.id);
    expect(ids).toContain(bio.id);
    expect(ids).toContain(informTech.id);
    expect(ids).not.toContain(informSoc.id);

    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text).toContain('био от теха');
    expect(text).toContain('прога тех');
    expect(text).not.toContain('прога соц');
  });
});

describe('A4: общая домашка видна всем (shared)', () => {
  test('Биология, записанная tech, видна soc', async () => {
    const data = await getHomeworkForDate(SOC, MONDAY);
    const bioTexts = data.homeworks.filter((h) => h.scheduleId === bio.id).map((h) => h.content);
    expect(bioTexts).toContain('био от теха');
    // профильное не пересекается: текста tech-информатики у soc нет
    expect(data.homeworks.map((h) => h.content)).not.toContain('прога тех');
  });
});

describe('A3: наблюдатель видит обе строки с тегами (shared)', () => {
  test('Пн слот 2: Информатика [Тех] + Информатика [Соц.-эконом.]', async () => {
    const data = await getHomeworkForDate(OBS, MONDAY);
    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text).toContain('2. Информатика [Тех]');
    expect(text).toContain('2. Информатика [Соц.-эконом.]');
    expect(text).toContain('прога тех');
    expect(text).toContain('прога соц');
  });

  test('Ср слот 3: Английский [Белова] + Английский [Фирфарова]', async () => {
    const data = await getHomeworkForDate(OBS, WEDNESDAY);
    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text).toContain('3. Английский [Белова]');
    expect(text).toContain('3. Английский [Фирфарова]');
    expect(text).toContain('белова текст');
    expect(text).toContain('фирфарова текст');
  });

  test('personal + all: уроки все видны, чужие тексты — нет', async () => {
    await setHomeworkVisibility('personal');
    try {
      const data = await getHomeworkForDate(OBS, MONDAY);
      expect(data.schedules.map((s) => s.id)).toEqual(
        expect.arrayContaining([bio.id, informTech.id, informSoc.id])
      );
      const tagCtx = await getTagContext();
      const text = formatHomeworkMerged(data, tagCtx);
      expect(text).not.toContain('прога тех');
      expect(text).not.toContain('прога соц');
    } finally {
      await setHomeworkVisibility('shared');
    }
  });
});

describe('merged-view: теги + чанкинг 4000', () => {
  test('длинная неделя режется на чанки ≤4000 без потерь', async () => {
    const big = 'домашка '.repeat(600);
    await Homework.create({ userId: OBS, scheduleId: bio.id, date: MONDAY2_STR, content: big });
    await Homework.create({ userId: OBS, scheduleId: informTech.id, date: MONDAY2_STR, content: big });

    expect(MESSAGE_CHUNK_LIMIT).toBe(4000);
    const data = await getHomeworkForDate(OBS, new Date(Date.UTC(2026, 9, 12, 12, 0, 0)));
    const tagCtx = await getTagContext();
    const text = formatHomeworkMerged(data, tagCtx);
    expect(text.length).toBeGreaterThan(4000);
    expect(text).toContain('[Тех]');

    const parts = splitMessageChunks(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    expect(parts.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
  });
});
