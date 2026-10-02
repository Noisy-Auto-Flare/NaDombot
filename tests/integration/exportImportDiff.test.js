/**
 * P1 item 6 — приёмка «export→import→diff»: restore не теряет division/name/scope.
 * Гоняет настоящие scripts/export-db.js и scripts/import-db.js на временном
 * SQLITE_PATH (прод-БД и серверы не трогаем). Diff-логика — только здесь, в тесте:
 * канонические ключи + сортировка строк + нормализация дат.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-export-import-'));
const dbPath = path.join(tmpDir, 'test.db');

process.env.SQLITE_PATH = dbPath;
delete process.env.MULTIPROFILE_FORCE;
delete process.env.AUDIENCE_CONFIG_PATH;

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { Class, Track, Subgroup, Schedule, Homework, LessonTime, Setting, User, UserProfile, UserEvent } = require('../../src/models');

const D = (iso) => new Date(iso);

function childEnv() {
  return { ...process.env, SQLITE_PATH: dbPath };
}

function runExport() {
  const r = spawnSync('node', [path.join(ROOT, 'scripts', 'export-db.js')], {
    cwd: ROOT,
    env: childEnv(),
    encoding: 'utf8'
  });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

function runImport(dump) {
  return spawnSync('node', [path.join(ROOT, 'scripts', 'import-db.js'), '--yes'], {
    cwd: ROOT,
    env: childEnv(),
    input: JSON.stringify(dump),
    encoding: 'utf8'
  });
}

/**
 * Канонизация дампа: сортировка строк + сортировка ключей + нормализация дат.
 * meta приводим к стабильной строке (экспорт может отдать объект или JSON-строку).
 * @param {object} dump
 */
function canonical(dump) {
  const canonMeta = (v) => {
    let val = v;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch (_e) {
        return val;
      }
    }
    if (val != null && typeof val === 'object') {
      const sorted = {};
      for (const kk of Object.keys(val).sort()) sorted[kk] = val[kk];
      return JSON.stringify(sorted);
    }
    return val;
  };
  const out = {};
  for (const key of Object.keys(dump)) {
    if (key === 'exportedAt') continue;
    const rows = dump[key];
    if (!Array.isArray(rows)) {
      out[key] = rows;
      continue;
    }
    out[key] = rows
      .map((r) => {
        const norm = {};
        for (const k of Object.keys(r).sort()) {
          let v = r[k];
          if ((k === 'date' || k.endsWith('At')) && v != null) {
            const t = new Date(v).getTime();
            v = Number.isNaN(t) ? v : new Date(t).toISOString();
          }
          if (k === 'meta') v = canonMeta(v);
          norm[k] = v;
        }
        return norm;
      })
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  return out;
}

beforeAll(async () => {
  await syncDatabase();

  // Foundation (Class/Track/belova/ferfarova) уже засеян syncDatabase — только добивка
  await Class.findOrCreate({ where: { id: '10А' }, defaults: { id: '10А', grade: 10, letter: 'А', enabled: true } });
  await Track.findOrCreate({ where: { id: 'tech', classId: '10А' }, defaults: { id: 'tech', classId: '10А', name: 'Технологический', isCommon: false } });
  await Track.findOrCreate({ where: { id: 'soc', classId: '10А' }, defaults: { id: 'soc', classId: '10А', name: 'Социально-экономический', isCommon: false } });
  await Subgroup.findOrCreate({ where: { id: 'belova' }, defaults: { id: 'belova', division: 'Английский язык', name: 'Белова', teacher: 'Белова И.В.', subject: 'английский', classId: null, active: true } });
  await Subgroup.findOrCreate({ where: { id: 'ferfarova' }, defaults: { id: 'ferfarova', division: 'Английский язык', name: 'Ферфарова', teacher: 'Ферфарова Валерия Михайловна', subject: 'английский', classId: null, active: true } });
  // Доводим foundation-строки до «мигрированного» вида с полными ФИО
  await Subgroup.update({ division: 'Английский язык', name: 'Белова', teacher: 'Белова Ирина Николаевна' }, { where: { id: 'belova' } });
  await Subgroup.update({ division: 'Английский язык', name: 'Ферфарова', teacher: 'Ферфарова Валерия Михайловна' }, { where: { id: 'ferfarova' } });
  await Subgroup.create({ id: 'draving', division: 'Черчение/Информатика', name: 'Чертёжная', teacher: null, subject: null, classId: null, active: true });

  // Ортогональные аудитории в одном слоте: Пн-2 tech/soc, Ср-3 belova/ferfarova,
  // черчение (draving) + информатика (tech) в одном слоте Чт-4
  const rows = await Schedule.bulkCreate(
    [
      { dayOfWeek: 0, lessonNumber: 2, subjectName: 'Информатика', room: '1058', classId: '10А', trackId: 'tech', subgroupId: null },
      { dayOfWeek: 0, lessonNumber: 2, subjectName: 'Обществознание', room: '3021', classId: '10А', trackId: 'soc', subgroupId: null },
      { dayOfWeek: 2, lessonNumber: 3, subjectName: 'Английский', room: '4005', classId: '10А', trackId: null, subgroupId: 'belova' },
      { dayOfWeek: 2, lessonNumber: 3, subjectName: 'Английский', room: 'библ', classId: '10А', trackId: null, subgroupId: 'ferfarova' },
      { dayOfWeek: 3, lessonNumber: 4, subjectName: 'Черчение', room: '4010', classId: '10А', trackId: null, subgroupId: 'draving' },
      { dayOfWeek: 3, lessonNumber: 4, subjectName: 'Информатика', room: '1058', classId: '10А', trackId: 'tech', subgroupId: null }
    ],
    { validate: false }
  );
  await Homework.create({ userId: 1, scheduleId: rows[0].id, date: '2024-10-07', content: 'стр. 12 №3', createdAt: D('2024-10-01T12:00:00.000Z'), updatedAt: D('2024-10-01T12:00:00.000Z') });
  await LessonTime.findOrCreate({ where: { lessonNumber: 1 }, defaults: { lessonNumber: 1, startTime: '08:30', endTime: '09:15' } });
  await Setting.create({ key: 'multiprofile_enabled', value: '1' });
  await Setting.create({ key: 'tags_template', value: '{track} · {subgroup}' });
  await User.create({ userId: 1, firstName: 'Иван', classId: '10А', trackId: 'tech', subgroupId: 'belova', createdAt: D('2024-10-01T12:00:00.000Z'), updatedAt: D('2024-10-01T12:00:00.000Z') });
  await UserProfile.create({ userId: 1, classId: '10А', trackId: 'tech', subgroupId: 'belova', version: 1 });
  await UserEvent.create({ userId: 1, type: 'command', payload: '/start', meta: { chatType: 'private' }, createdAt: D('2024-10-01T12:00:00.000Z'), updatedAt: D('2024-10-01T12:00:00.000Z') });
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('export→import→diff (P1 item 6)', () => {
  test('неизвестные/legacy-поля — warn и пропуск; restore без потерь, diff пуст', () => {
    const before = runExport();
    expect(before.subgroups).toHaveLength(3);
    expect(before.schedules).toHaveLength(6);

    // Загрязняем дамп: мусорное поле + legacy teacherName (его больше нет в модели)
    const polluted = JSON.parse(JSON.stringify(before));
    polluted.schedules[0].__junk = 'drop-me';
    polluted.subgroups[0].teacherName = 'Белова';

    const imp = runImport(polluted);
    expect(imp.status).toBe(0);
    expect(String(imp.stderr)).toContain('⚠️ import-db: неизвестное поле schedules.__junk пропущено');
    expect(String(imp.stderr)).toContain('⚠️ import-db: неизвестное поле subgroups.teacherName пропущено');

    const after = runExport();
    expect(canonical(after)).toEqual(canonical(before));

    // division/name/teacher на месте, scope-профиль цел
    const belova = after.subgroups.find((s) => s.id === 'belova');
    expect(belova.division).toBe('Английский язык');
    expect(belova.name).toBe('Белова');
    expect(belova.teacher).toBe('Белова Ирина Николаевна');
    expect(belova.teacherName).toBeUndefined();
    const draving = after.subgroups.find((s) => s.id === 'draving');
    expect(draving.subject).toBeNull();
    expect(after.schedules).toHaveLength(6);
    expect(after.userProfiles).toHaveLength(1);
    expect(after.userProfiles[0].subgroupId).toBe('belova');
  });
});
