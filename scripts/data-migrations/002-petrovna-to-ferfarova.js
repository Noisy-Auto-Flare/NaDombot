const logger = require('../../src/utils/logger');
/**
 * Одноразовая миграция данных: переименование подгруппы petrova → ferfarova.
 * Обновляет subgroups (id + name/teacher), schedules.subgroupId,
 * user_profiles.subgroupId и users.subgroupId где petrova.
 * Идемпотентна: на чистых БД (нет petrova) — только бэкфилл полей belova/ferfarova.
 * @param {{sequelize: import('sequelize').Sequelize, transaction?: object}} ctx
 */
async function up({ sequelize, transaction }) {
  const t = transaction || null;
  const q = (sql, replacements) =>
    sequelize.query(sql, {
      type: sequelize.QueryTypes.SELECT,
      replacements,
      transaction: t
    });
  const exec = (sql, replacements) =>
    sequelize.query(sql, {
      replacements,
      transaction: t
    });

  const tableExists = async (name) => {
    try {
      const rows = await q("SELECT name FROM sqlite_master WHERE type='table' AND name=:name", { name });
      return Array.isArray(rows) && rows.length > 0;
    } catch (_e) {
      return false;
    }
  };
  const columnExists = async (table, col) => {
    try {
      const cols = await sequelize.query(`PRAGMA table_info('${table}')`, {
        type: sequelize.QueryTypes.SELECT,
        transaction: t
      });
      return Array.isArray(cols) && cols.some((c) => c.name === col);
    } catch (_e) {
      return false;
    }
  };

  // 1. Ссылки сначала (FK на subgroups.id): schedules → user_profiles → users
  try {
    if ((await tableExists('schedules')) && (await columnExists('schedules', 'subgroupId'))) {
      await exec("UPDATE schedules SET subgroupId='ferfarova' WHERE subgroupId='petrova'");
    }
  } catch (_e) {
    void _e;
  }
  try {
    if ((await tableExists('user_profiles')) && (await columnExists('user_profiles', 'subgroupId'))) {
      await exec("UPDATE user_profiles SET subgroupId='ferfarova' WHERE subgroupId='petrova'");
    }
  } catch (_e) {
    void _e;
  }
  try {
    if ((await tableExists('users')) && (await columnExists('users', 'subgroupId'))) {
      await exec("UPDATE users SET subgroupId='ferfarova' WHERE subgroupId='petrova'");
    }
  } catch (_e) {
    void _e;
  }

  // 2. Сама подгруппа: petrova → ferfarova (если ferfarova уже есть — ссылки уже переведены выше, старую удаляем)
  try {
    if (await tableExists('subgroups')) {
      const petrova = await q("SELECT id FROM subgroups WHERE id='petrova'");
      const ferfarova = await q("SELECT id FROM subgroups WHERE id='ferfarova'");
      const hasPetrova = Array.isArray(petrova) && petrova.length > 0;
      const hasFerfarova = Array.isArray(ferfarova) && ferfarova.length > 0;
      if (hasPetrova && !hasFerfarova) {
        await exec(
          "UPDATE subgroups SET id='ferfarova', name='Ферфарова', teacher='Ферфарова Валерия Михайловна', division='Английский язык' WHERE id='petrova'"
        );
        logger.info('✅ Миграция 002: petrova → ferfarova (rename)');
      } else if (hasPetrova && hasFerfarova) {
        await exec("DELETE FROM subgroups WHERE id='petrova'");
        logger.info('✅ Миграция 002: ссылки переведены на ferfarova, дубль petrova удалён');
      }
      // Бэкфилл полей (идемпотентно, только если строки есть)
      await exec("UPDATE subgroups SET name='Белова', teacher='Белова Ирина Николаевна' WHERE id='belova'").catch(() => []);
      await exec(
        "UPDATE subgroups SET name='Ферфарова', teacher='Ферфарова Валерия Михайловна', division='Английский язык' WHERE id='ferfarova'"
      ).catch(() => []);
    }
  } catch (_e) {
    void _e;
  }
}

module.exports = {
  id: '002-petrovna-to-ferfarova',
  description: 'Переименование подгруппы petrova → ferfarova (Петрова → Ферфарова В.М.) со ссылками',
  up
};
