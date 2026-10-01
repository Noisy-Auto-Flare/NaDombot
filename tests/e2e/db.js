/**
 * Временная SQLite-БД для e2e-тестов P5: каждый файл — свой SQLITE_PATH
 * в os.tmpdir, прод-БД не трогаем. Вызывать ДО require(src/config/database).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Создать временный каталог и прописать SQLITE_PATH на него.
 * @param {string} prefix - префикс имени каталога в os.tmpdir()
 * @returns {string} путь временного каталога (для cleanupTempDb)
 */
function setupTempDb(prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
  delete process.env.MULTIPROFILE_FORCE;
  delete process.env.AUDIENCE_CONFIG_PATH;
  return tmpDir;
}

/**
 * Удалить временный каталог (вызывать после sequelize.close()).
 * @param {string} tmpDir
 */
function cleanupTempDb(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

module.exports = { setupTempDb, cleanupTempDb };
