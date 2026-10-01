const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/models', () => ({
  Class: { upsert: jest.fn(), findAll: jest.fn(), update: jest.fn() },
  Track: { upsert: jest.fn() },
  Subgroup: { upsert: jest.fn(), findAll: jest.fn(), update: jest.fn() },
  Setting: { upsert: jest.fn(), findAll: jest.fn() }
}));

const { Class, Subgroup, Setting } = require('../../src/models');
const {
  stripJsonComments,
  validateCatalog,
  readAudienceFile,
  syncAudienceCatalog
} = require('../../src/utils/audienceLoader');

let tmpDir;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
  Subgroup.findAll.mockResolvedValue([]);
  Class.findAll.mockResolvedValue([]);
});

afterEach(() => {
  console.log.mockRestore();
  console.warn.mockRestore();
  console.error.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

const VALID_JSONC = `// каталог аудиторий — комментарии разрешены
{
  // классы с вложенными треками
  "classes": [
    { "id": "10А", "grade": 10, "tracks": [
      { "id": "tech", "name": "Технологический" },
      { "id": "soc", "name": "Социально-экономический" }
    ] }
  ],
  "subgroups": [
    { "id": "belova", "division": "Английский язык", "name": "Белова", "teacher": "Белова И.В.", "subject": "английский" },
    { "id": "draving", "division": "Черчение/Информатика", "name": "Чертёжная", "teacher": null, "subject": null } // годится для любого предмета
  ],
  "tags": { "template": "{track} · {subgroup}", "showClass": false, "maxSegments": 4 }
}
`;

describe('stripJsonComments', () => {
  test('вырезает //-комментарии, сохраняет // внутри строк', () => {
    const out = stripJsonComments('{"a": "http://x", "b": 1} // коммент\n{"c": 2}');
    expect(out).toContain('http://x');
    expect(out).not.toContain('коммент');
    expect(JSON.parse(`{${out.split('{')[1].split('}')[0]}}`).a).toBe('http://x');
  });
});

describe('validateCatalog', () => {
  test('валидный каталог (включая subject=null) проходит', () => {
    const data = JSON.parse(stripJsonComments(VALID_JSONC));
    const cat = validateCatalog(data);
    expect(cat.classes).toHaveLength(1);
    expect(cat.tracks).toHaveLength(2);
    expect(cat.subgroups).toHaveLength(2);
    expect(cat.subgroups[1].subject).toBeNull();
    expect(cat.tags.template).toBe('{track} · {subgroup}');
  });

  test('подгруппа без division/name — ошибка', () => {
    expect(() =>
      validateCatalog({ classes: [], subgroups: [{ id: 'x' }], tags: {} })
    ).toThrow(/division/);
  });

  test('дубль id подгруппы — ошибка', () => {
    const dup = {
      classes: [],
      subgroups: [
        { id: 'a', division: 'D', name: 'A' },
        { id: 'a', division: 'D', name: 'A' }
      ]
    };
    expect(() => validateCatalog(dup)).toThrow(/дубль/);
  });

  test('classId подгруппы вне classes — ошибка', () => {
    const bad = {
      classes: [{ id: '10А' }],
      subgroups: [{ id: 'a', division: 'D', name: 'A', classId: '11Б' }]
    };
    expect(() => validateCatalog(bad)).toThrow(/classId/);
  });
});

describe('syncAudienceCatalog', () => {
  test('валидный файл: upsert по id + теги в Setting', async () => {
    const p = writeFile('audience.json', VALID_JSONC);
    const res = await syncAudienceCatalog({ configPath: p });
    expect(res.status).toBe('ok');
    expect(res.classes).toBe(1);
    expect(res.tracks).toBe(2);
    expect(res.subgroups).toBe(2);
    expect(Subgroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'belova', division: 'Английский язык', teacher: 'Белова И.В.', subject: 'английский' })
    );
    expect(Subgroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draving', subject: null, teacher: null })
    );
    expect(Setting.upsert).toHaveBeenCalledWith({ key: 'tags_template', value: '{track} · {subgroup}' });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('✅ audience.json: каталог обновлён'));
  });

  test('битый файл: fallback-invalid, понятная строка лога, upsert не вызван', async () => {
    const p = writeFile('audience.json', '{ не json !!!');
    const res = await syncAudienceCatalog({ configPath: p });
    expect(res.status).toBe('fallback-invalid');
    expect(Subgroup.upsert).not.toHaveBeenCalled();
    expect(Class.upsert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ audience.json:'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('работаем со старым каталогом из БД'));
  });

  test('валидный JSON, но невалидный каталог: fallback-invalid', async () => {
    const p = writeFile('audience.json', '{"classes": [], "subgroups": [{"id": "x"}]}');
    const res = await syncAudienceCatalog({ configPath: p });
    expect(res.status).toBe('fallback-invalid');
    expect(Subgroup.upsert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ audience.json:'));
  });

  test('нет файла: fallback-missing, бот не падает', async () => {
    const res = await syncAudienceCatalog({ configPath: path.join(tmpDir, 'nope.json') });
    expect(res.status).toBe('fallback-missing');
    expect(Subgroup.upsert).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('⚠️ audience.json не найден'));
  });

  test('deactivate-missing: отсутствующие в файле → active=false', async () => {
    Subgroup.findAll.mockResolvedValue([{ id: 'belova' }, { id: 'stale_sub' }]);
    Class.findAll.mockResolvedValue([{ id: '10А' }, { id: '11Б' }]);
    const p = writeFile('audience.json', VALID_JSONC);
    const res = await syncAudienceCatalog({ configPath: p });
    expect(res.status).toBe('ok');
    expect(Subgroup.update).toHaveBeenCalledWith({ active: false }, expect.anything());
    expect(Class.update).toHaveBeenCalledWith({ enabled: false }, expect.anything());
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stale_sub'));
  });

  test('readAudienceFile читает example-формат', () => {
    const p = writeFile('audience.json', VALID_JSONC);
    const cat = readAudienceFile(p);
    expect(cat.classes[0].id).toBe('10А');
  });
});
