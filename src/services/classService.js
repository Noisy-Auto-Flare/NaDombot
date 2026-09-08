const Class = require('../models/Class');

/**
 * Сервис для управления классами.
 */

/**
 * Найти все классы.
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function findAll() {
  return Class.findAll({ order: [['id', 'ASC']] });
}

/**
 * Найти класс по ID.
 * @param {string} id
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findById(id) {
  return Class.findByPk(id);
}

/**
 * Создать класс.
 * Ожидаемый ввод: "<grade> <letter> [enabled]" или просто "11Б".
 * Если передана строка "11Б" — парсим grade/letter автоматически.
 * @param {object|string} data
 * @param {string} [data.id]
 * @param {number} [data.grade]
 * @param {string} [data.letter]
 * @param {boolean} [data.enabled]
 * @returns {Promise<import('sequelize').Model>}
 */
async function create(data) {
  let payload = data;
  if (typeof data === 'string') {
    payload = parseClassInput(data);
  }
  if (!payload.id) {
    throw new Error('❌ Не указан ID класса');
  }
  const existing = await Class.findByPk(payload.id);
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }
  return Class.create(payload);
}

/**
 * Удалить класс по ID.
 * @param {string} id
 * @returns {Promise<{deletedId:string}>}
 */
async function remove(id) {
  const found = await Class.findByPk(id);
  if (!found) {
    throw new Error('NOT_FOUND');
  }
  await found.destroy();
  return { deletedId: id };
}

/**
 * Парсит ввод класса.
 * Поддерживает:
 *  - "11Б"
 *  - "11 Б"
 *  - "10 А 1" / "10 А true" / "10 А 0"
 *  - "10А enabled" — где enabled опционально
 * @param {string} input
 * @returns {{id:string, grade:number|null, letter:string|null, enabled:boolean}}
 */
function parseClassInput(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('❌ Пустой ввод для класса');
  const parts = raw.split(/\s+/);

  // Один токен вроде "10А" или "11Б"
  if (parts.length === 1) {
    const token = parts[0];
    const m = token.match(/^(\d{1,2})(.+)$/);
    if (m) {
      const grade = parseInt(m[1], 10);
      const letter = m[2].trim();
      return { id: `${grade}${letter}`, grade, letter, enabled: true };
    }
    // просто ID без разделения
    return { id: token, grade: null, letter: null, enabled: true };
  }

  // Несколько токенов: первый — grade, второй — letter, третий — enabled
  const gradeMaybe = parseInt(parts[0], 10);
  const hasNumericGrade = !isNaN(gradeMaybe);
  let grade = null;
  let letter = null;
  let enabled = true;
  let id;

  if (hasNumericGrade) {
    grade = gradeMaybe;
    letter = parts[1] || null;
    id = `${grade}${letter || ''}`.trim();
    if (parts[2] != null) {
      const v = String(parts[2]).toLowerCase();
      enabled = !(v === '0' || v === 'false' || v === 'off' || v === 'disabled');
    }
  } else {
    // fallback: id = first part, enabled = second
    id = parts[0];
    const v = parts[1] ? String(parts[1]).toLowerCase() : null;
    if (v) enabled = !(v === '0' || v === 'false' || v === 'off' || v === 'disabled');
  }
  return { id, grade, letter, enabled };
}

module.exports = {
  findAll,
  findById,
  create,
  remove,
  delete: remove,
  parseClassInput,
};
