/**
 * P1 item 1 — Subgroup v2: subject валидируется только если задан (null = любой
 * предмет); черчение/информатика встают в один слот без ошибок.
 * Временный SQLITE_PATH, прод-БД не трогаем.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-subgroup-v2-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
delete process.env.MULTIPROFILE_FORCE;
delete process.env.AUDIENCE_CONFIG_PATH;

jest.setTimeout(60000);

const { syncDatabase, sequelize } = require('../../src/config/database');
const { Subgroup } = require('../../src/models');
const scheduleService = require('../../src/services/scheduleService');

beforeAll(async () => {
  await syncDatabase();
});

afterAll(async () => {
  await sequelize.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Subgroup v2 (P1 item 1)', () => {
  test('subject=null валиден (годится для любого предмета)', async () => {
    const sg = await Subgroup.create({
      id: 'draving',
      division: 'Черчение/Информатика',
      name: 'Чертёжная',
      teacher: null,
      subject: null,
      classId: null,
      active: true
    });
    expect(sg.subject).toBeNull();
  });

  test('пустой subject отклоняется валидацией', async () => {
    await expect(
      Subgroup.create({ id: 'bad1', division: 'D', name: 'N', subject: '' })
    ).rejects.toThrow();
  });

  test('без division не создаётся', async () => {
    await expect(Subgroup.create({ id: 'bad2', name: 'N' })).rejects.toThrow();
  });

  test('черчение + информатика в одном слоте (Чт-4) без ошибок', async () => {
    const a = await scheduleService.create({
      dayOfWeek: 3,
      lessonNumber: 4,
      subjectName: 'Черчение',
      room: '4010',
      classId: '10А',
      trackId: null,
      subgroupId: 'draving'
    });
    expect(a.subgroupId).toBe('draving');
    const b = await scheduleService.create({
      dayOfWeek: 3,
      lessonNumber: 4,
      subjectName: 'Информатика',
      room: '1058',
      classId: '10А',
      trackId: 'tech',
      subgroupId: null
    });
    expect(b.trackId).toBe('tech');
  });

  test('подгруппа с subject отторгает чужой предмет, как раньше', async () => {
    await expect(
      scheduleService.create({
        dayOfWeek: 3,
        lessonNumber: 5,
        subjectName: 'Черчение',
        room: null,
        classId: '10А',
        trackId: null,
        subgroupId: 'belova'
      })
    ).rejects.toThrow('SUBGROUP_SUBJECT_MISMATCH');
  });
});
