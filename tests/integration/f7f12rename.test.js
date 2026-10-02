/**
 * F7 + F10 (интеграция, временный SQLITE_PATH, прод-БД не трогаем).
 * - F7: ledger-миграция 002-petrovna-to-ferfarova переименовывает подгруппу
 *   и все ссылки (schedules, user_profiles, users) + бэкфилл полных ФИО
 * - F10: getRecentLessonRows фильтрует чужие подгруппы при флаге (isVisible)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f7f12-rename-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
delete process.env.MULTIPROFILE_FORCE;
delete process.env.AUDIENCE_CONFIG_PATH;

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { Subgroup, Schedule, User, UserProfile } = require('../../src/models');
const { setMultiprofileEnabled } = require('../../src/utils/settings');
const { isVisible } = require('../../src/utils/audience');
const { getRecentLessonRows } = require('../../src/utils/recentLessons');
const { getMoscowNow, getMoscowDayOfWeek } = require('../../src/utils/moscowTime');

const mig = require('../../scripts/data-migrations/002-petrovna-to-ferfarova');

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('F7: foundation seed с Ферфаровой', () => {
  test('belova/ferfarova с полными ФИО, petrova нет', async () => {
    const belova = await Subgroup.findByPk('belova');
    const ferfarova = await Subgroup.findByPk('ferfarova');
    const petrova = await Subgroup.findByPk('petrova');
    expect(belova && belova.name).toBe('Белова');
    expect(belova && belova.teacher).toBe('Белова Ирина Николаевна');
    expect(ferfarova && ferfarova.name).toBe('Ферфарова');
    expect(ferfarova && ferfarova.teacher).toBe('Ферфарова Валерия Михайловна');
    expect(petrova).toBeNull();
  });

  test('id миграции — следующий номер после существующих', () => {
    expect(mig.id).toBe('002-petrovna-to-ferfarova');
    expect(typeof mig.up).toBe('function');
  });
});

describe('F7: миграция 002 petrova → ferfarova со ссылками', () => {
  const UID = 77001;

  beforeAll(async () => {
    await Subgroup.create({
      id: 'petrova',
      division: 'Английский язык',
      name: 'Петрова',
      teacher: 'Петрова',
      subject: 'английский',
      classId: null,
      active: true
    });
    await Schedule.create({
      dayOfWeek: 5,
      lessonNumber: 9,
      subjectName: 'Английский',
      room: 'библ',
      classId: '10А',
      trackId: null,
      subgroupId: 'petrova'
    });
    await User.create({ userId: UID, firstName: 'Test', classId: '10А', subgroupId: 'petrova' });
    await UserProfile.create({ userId: UID, classId: '10А', trackId: null, subgroupId: 'petrova', scope: 'own' });
  });

  test('переименование + ссылки переведены, повтор идемпотентен', async () => {
    await mig.up({ sequelize });
    await mig.up({ sequelize });

    expect(await Subgroup.findByPk('petrova')).toBeNull();
    const ferfarova = await Subgroup.findByPk('ferfarova');
    expect(ferfarova && ferfarova.name).toBe('Ферфарова');
    expect(ferfarova && ferfarova.teacher).toBe('Ферфарова Валерия Михайловна');

    const sched = await Schedule.findOne({ where: { dayOfWeek: 5, lessonNumber: 9 } });
    expect(sched && sched.subgroupId).toBe('ferfarova');

    const prof = await UserProfile.findByPk(UID);
    expect(prof && prof.subgroupId).toBe('ferfarova');

    const user = await User.findByPk(UID);
    expect(user && user.subgroupId).toBe('ferfarova');
  });
});

describe('F10: quick-pick фильтрует чужую аудиторию', () => {
  const profile = { classId: '10А', trackId: null, subgroupId: 'belova', scope: 'own' };

  // Фиксируем московский полдень текущего дня: уроки 1–3 уже прошли (детерминированно)
  function moscowNoon() {
    const m = getMoscowNow(new Date());
    const [y, mo, d] = String(m.isoDate).split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d, 9, 0, 0));
  }

  beforeAll(async () => {
    const dow = getMoscowDayOfWeek(new Date());
    await Schedule.create({ dayOfWeek: dow, lessonNumber: 1, subjectName: 'Алгебра', classId: '10А', trackId: null, subgroupId: null });
    await Schedule.create({ dayOfWeek: dow, lessonNumber: 2, subjectName: 'Английский', room: '4005', classId: '10А', trackId: null, subgroupId: 'belova' });
    await Schedule.create({ dayOfWeek: dow, lessonNumber: 3, subjectName: 'Английский', room: 'библ', classId: '10А', trackId: null, subgroupId: 'ferfarova' });
  });

  test('с профилем: только видимые (без ferfarova); без профиля: все', async () => {
    const noon = moscowNoon();
    const own = await getRecentLessonRows({ limit: 4, now: noon, profile });
    expect(own.length).toBeGreaterThan(0);
    for (const r of own) expect(isVisible(r, profile)).toBe(true);
    expect(own.some((r) => r.subgroupId === 'ferfarova')).toBe(false);
    expect(own.some((r) => r.subgroupId === 'belova')).toBe(true);

    const all = await getRecentLessonRows({ limit: 4, now: noon });
    expect(all.some((r) => r.subgroupId === 'ferfarova')).toBe(true);
  });
});
