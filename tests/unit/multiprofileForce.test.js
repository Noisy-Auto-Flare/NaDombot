jest.mock('../../src/models', () => ({
  Setting: { findByPk: jest.fn(), upsert: jest.fn() }
}));

const { Setting } = require('../../src/models');
const { getMultiprofileEnabled, isMultiprofileEnabled } = require('../../src/utils/settings');

const OLD_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env = { ...OLD_ENV };
  delete process.env.MULTIPROFILE_FORCE;
  delete process.env.MULTIPROFILE_ENABLED;
});

afterEach(() => {
  console.error.mockRestore();
  process.env = OLD_ENV;
});

describe('multiprofile flag priority: FORCE > Setting > ENV', () => {
  test('FORCE=1 поверх Setting=0', async () => {
    process.env.MULTIPROFILE_FORCE = '1';
    Setting.findByPk.mockResolvedValue({ value: '0' });
    expect(await getMultiprofileEnabled()).toBe(true);
    expect(await isMultiprofileEnabled()).toBe(true);
  });

  test('FORCE=0 поверх Setting=1', async () => {
    process.env.MULTIPROFILE_FORCE = '0';
    Setting.findByPk.mockResolvedValue({ value: '1' });
    expect(await getMultiprofileEnabled()).toBe(false);
  });

  test('пустой FORCE игнорируется, побеждает Setting', async () => {
    process.env.MULTIPROFILE_FORCE = '';
    Setting.findByPk.mockResolvedValue({ value: '1' });
    expect(await getMultiprofileEnabled()).toBe(true);
  });

  test('без FORCE и без Setting — дефолт из MULTIPROFILE_ENABLED', async () => {
    Setting.findByPk.mockResolvedValue(null);
    expect(await getMultiprofileEnabled()).toBe(false);
    process.env.MULTIPROFILE_ENABLED = '1';
    expect(await getMultiprofileEnabled()).toBe(true);
  });

  test('без FORCE побеждает Setting', async () => {
    Setting.findByPk.mockResolvedValue({ value: '1' });
    expect(await getMultiprofileEnabled()).toBe(true);
    Setting.findByPk.mockResolvedValue({ value: '0' });
    expect(await getMultiprofileEnabled()).toBe(false);
  });
});
