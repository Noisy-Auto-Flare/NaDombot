const logger = require('../../src/utils/logger');
/**
 * Одноразовая миграция данных: переименование подгруппы ferfarova → firfarova.
 * Обновляет subgroups (id + name/teacher), schedules.subgroupId,
 * user_profiles.subgroupId и users.subgroupId где ferfarova.
 * Идемпотентна: на чистых БД (нет ferfarova) — только бэкфилл полей belova/firfarova.
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
      await exec("UPDATE schedules SET subgroupId='firfarova' WHERE subgroupId='ferfarova'");
    }
  } catch (_e) {
    void _e;
  }
  try {
    if ((await tableExists('user_profiles')) && (await columnExists('user_profiles', 'subgroupId'))) {
      await exec("UPDATE user_profiles SET subgroupId='firfarova' WHERE subgroupId='ferfarova'");
    }
  } catch (_e) {
    void _e;
  }
  try {
    if ((await tableExists('users')) && (await columnExists('users', 'subgroupId'))) {
      await exec("UPDATE users SET subgroupId='firfarova' WHERE subgroupId='ferfarova'");
    }
  } catch (_e) {
    void _e;
  }

  // 2. Сама подгруппа: ferfarova → firfarova (если firfarova уже есть — ссылки уже переведены выше, старую удаляем)
  try {
    if (await tableExists('subgroups')) {
      const ferfarova = await q("SELECT id FROM subgroups WHERE id='ferfarova'");
      const firfarova = await q("SELECT id FROM subgroups WHERE id='firfarova'");
      const hasFerfarova = Array.isArray(ferfarova) && ferfarova.length > 0;
      const hasFirfarova = Array.isArray(firfarova) && firfarova.length > 0;
      if (hasFerfarova && !hasFirfarova) {
        await exec(
          "UPDATE subgroups SET id='firfarova', name='Фирфарова', teacher='Фирфарова Валерия Михайловна', division='Английский язык' WHERE id='ferfarova'"
        );
        logger.info('✅ Миграция 003: ferfarova → firfarova (rename)');
      } else if (hasFerfarova && hasFirfarova) {
        await exec("DELETE FROM subgroups WHERE id='ferfarova'");
        logger.info('✅ Миграция 003: ссылки переведены на firfarova, дубль ferfarova удалён');
      }
      // Бэкфилл полей (идемпотентно, только если строки есть)
      await exec("UPDATE subgroups SET name='Белова', teacher='Белова Ирина Николаевна' WHERE id='belova'").catch(() => []);
      await exec(
        "UPDATE subgroups SET name='Фирфарова', teacher='Фирфарова Валерия Михайловна', division='Английский язык' WHERE id='firfarova'"
      ).catch(() => []);
    }
  } catch (_e) {
    void _e;
  }
}

module.exports = {
  id: '003-ferfarova-to-firfarova',
  description: 'Переименование подгруппы ferfarova → firfarova (Ферфарова → Фирфарова В.М.) со ссылками',
  up
};
