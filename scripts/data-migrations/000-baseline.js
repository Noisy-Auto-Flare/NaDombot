/**
 * Базовая отметка ledger одноразовых миграций данных (P0).
 * Схема ведётся только sync(); ledger — только одноразовые ДАННЫЕ.
 * @param {{sequelize: import('sequelize').Sequelize}} _ctx
 */
async function up(_ctx) {
  void _ctx;
}

module.exports = {
  id: '000-baseline',
  description: 'Базовая отметка: схема p0, дальше — только одноразовые данные',
  up
};
