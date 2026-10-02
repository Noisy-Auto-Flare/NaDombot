/**
 * F7 + F10 (интеграция, временный SQLITE_PATH, прод-БД не трогаем).
 * - F7: цепочка ledger-миграций 002-petrovna-to-ferfarova → 003-ferfarova-to-firfarova
 *   переименовывает подгруппу и все ссылки (schedules, user_profiles, users) + бэкфилл полных ФИО.
 *   Конечное состояние: firfarova (Фирфарова Валерия Михайловна), petrova/ferfarova нет.
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

const mig002 = require('../../scripts/data-migrations/002-petrovna-to-ferfarova');
const mig003 = require('../../scripts/data-migrations/003-ferfarova-to-firfarova');

beforeAll(async () => {
  await syncDatabase();
  await setMultiprofileEnabled(true);
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('F7: foundation seed с Фирфаровой', () => {
  test('belova/firfarova с полными ФИО, petrova нет', async () => {
    const belova = await Subgroup.findByPk('belova');
    const firfarova = await Subgroup.findByPk('firfarova');
    const petrova = await Subgroup.findByPk('petrova');
    expect(belova && belova.name).toBe('Белова');
    expect(belova && belova.teacher).toBe('Белова Ирина Николаевна');
    expect(firfarova && firfarova.name).toBe('Фирфарова');
    expect(firfarova && firfarova.teacher).toBe('Фирфарова Валерия Михайловна');
    expect(petrova).toBeNull();
  });

  test('id миграций — по порядку', () => {
    expect(mig002.id).toBe('002-petrovna-to-ferfarova');
    expect(typeof mig002.up).toBe('function');
    expect(mig003.id).toBe('003-ferfarova-to-firfarova');
    expect(typeof mig003.up).toBe('function');
  });
});

describe('F7: цепочка 002 → 003 petrova → firfarova со ссылками', () => {
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
    await mig002.up({ sequelize });
    await mig003.up({ sequelize });
    await mig002.up({ sequelize });
    await mig003.up({ sequelize });

    expect(await Subgroup.findByPk('petrova')).toBeNull();
    expect(await Subgroup.findByPk('ferfarova')).toBeNull();
    const firfarova = await Subgroup.findByPk('firfarova');
    expect(firfarova && firfarova.name).toBe('Фирфарова');
    expect(firfarova && firfarova.teacher).toBe('Фирфарова Валерия Михайловна');

    const sched = await Schedule.findOne({ where: { dayOfWeek: 5, lessonNumber: 9 } });
    expect(sched && sched.subgroupId).toBe('firfarova');

    const prof = await UserProfile.findByPk(UID);
    expect(prof && prof.subgroupId).toBe('firfarova');

    const user = await User.findByPk(UID);
    expect(user && user.subgroupId).toBe('firfarova');
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
    await Schedule.create({ dayOfWeek: dow, lessonNumber: 3, subjectName: 'Английский', room: 'библ', classId: '10А', trackId: null, subgroupId: 'firfarova' });
  });

  test('с профилем: только видимые (без firfarova); без профиля: все', async () => {
    const noon = moscowNoon();
    const own = await getRecentLessonRows({ limit: 4, now: noon, profile });
    expect(own.length).toBeGreaterThan(0);
    for (const r of own) expect(isVisible(r, profile)).toBe(true);
    expect(own.some((r) => r.subgroupId === 'firfarova')).toBe(false);
    expect(own.some((r) => r.subgroupId === 'belova')).toBe(true);

    const all = await getRecentLessonRows({ limit: 4, now: noon });
    expect(all.some((r) => r.subgroupId === 'firfarova')).toBe(true);
  });
});
