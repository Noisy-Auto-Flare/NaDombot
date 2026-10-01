/**
 * Одноразовая миграция данных: удалить лишнюю подгруппу ivanova.
 * Вынесено из syncDatabase (P0: в boot — только find-or-create/skip, деструктив — только ledger).
 * На чистых БД — no-op.
 * @param {{sequelize: import('sequelize').Sequelize}} ctx
 */
async function up({ sequelize }) {
  // Подгруппа ivanova (было 3 учителя → 2)
  try {
    const found = await sequelize.query("SELECT id FROM subgroups WHERE id='ivanova'", {
      type: sequelize.QueryTypes.SELECT
    }).catch(() => null);
    if (found && found.length) {
      await sequelize.query("DELETE FROM subgroups WHERE id='ivanova'");
      console.log('✅ Миграция 001: удалена лишняя подгруппа ivanova');
    }
  } catch (_e) {
    void _e;
  }
  // Расписания с ivanova (FK cleanup: сначала Homework, потом Schedule)
  try {
    const cols = await sequelize.query("PRAGMA table_info('schedules')", {
      type: sequelize.QueryTypes.SELECT
    }).catch(() => []);
    const hasCol = Array.isArray(cols) && cols.some((c) => c.name === 'subgroupId');
    if (hasCol) {
      const rows = await sequelize.query("SELECT id FROM schedules WHERE subgroupId='ivanova'", {
        type: sequelize.QueryTypes.SELECT
      }).catch(() => []);
      if (rows && rows.length) {
        const ids = rows.map((r) => r.id);
        const list = ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)).join(',');
        if (list) {
          await sequelize.query(`DELETE FROM homeworks WHERE scheduleId IN (${list})`).catch(() => []);
        }
        await sequelize.query("DELETE FROM schedules WHERE subgroupId='ivanova'");
        console.log(`✅ Миграция 001: удалены ${ids.length} расписаний с ivanova`);
      }
    }
  } catch (_e) {
    void _e;
  }
}

module.exports = {
  id: '001-drop-ivanova-once',
  description: 'One-off для стендов, где ivanova уже засеяна; на чистых — no-op',
  up
};
