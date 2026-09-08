const Subgroup = require('../models/Subgroup');
const Class = require('../models/Class');

/**
 * Сервис для управления подгруппами.
 */

/**
 * Найти все подгруппы.
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function findAll() {
  return Subgroup.findAll({ order: [['subject', 'ASC'], ['id', 'ASC']] });
}

/**
 * Найти подгруппу по ID.
 * @param {string} id
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findById(id) {
  return Subgroup.findByPk(id);
}

/**
 * Создать подгруппу.
 * Ожидаемый ввод: "<subject> <id> <teacherName> [classId]"
 * Например: "английский belova Белова 10А" или "английский ivanova Иванова"
 * @param {object|string} data
 * @returns {Promise<import('sequelize').Model>}
 */
async function create(data) {
  let payload = data;
  if (typeof data === 'string') {
    payload = parseSubgroupInput(data);
  }
  if (!payload.id || !payload.subject) {
    throw new Error('❌ Для подгруппы нужно: <предмет> <id> <учитель> [classId]');
  }
  const existing = await Subgroup.findByPk(payload.id);
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }
  if (payload.classId) {
    const classExists = await Class.findByPk(payload.classId);
    if (!classExists) throw new Error('❌ Класс не найден: ' + payload.classId);
  }
  return Subgroup.create(payload);
}

/**
 * Удалить подгруппу.
 * @param {string} id
 * @returns {Promise<{deletedId:string}>}
 */
async function remove(id) {
  const normalized = String(id).trim().split(/\s+/)[0];
  const found = await Subgroup.findByPk(normalized);
  if (!found) throw new Error('NOT_FOUND');
  await found.destroy();
  return { deletedId: normalized };
}

/**
 * Парсит ввод подгруппы.
 * Формат: "<subject> <id> <teacherName...> [classId]" — последний токен может быть классом если похож на "10А".
 * Эвристика: если последний токен матчит /^\d{1,2}[А-Яа-яA-Za-z]+$/ и токенов >=4 — считаем его classId.
 * @param {string} input
 * @returns {{subject:string, id:string, teacherName:string|null, classId:string|null, active:boolean}}
 */
function parseSubgroupInput(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('❌ Пустой ввод для подгруппы');
  const parts = raw.split(/\s+/);
  if (parts.length < 2) {
    throw new Error('❌ Формат: <предмет> <id> <учитель> [classId]  Например: английский belova Белова');
  }
  const subject = parts[0];
  const id = parts[1];
  let teacherName = null;
  let classId = null;

  if (parts.length >= 3) {
    const rest = parts.slice(2);
    // check if last token looks like classId (e.g. 10А)
    const last = rest[rest.length - 1];
    const looksLikeClass = /^\d{1,2}[А-Яа-яA-Za-z]+$/.test(last);
    if (looksLikeClass && rest.length >= 2) {
      classId = last;
      teacherName = rest.slice(0, -1).join(' ') || null;
    } else {
      teacherName = rest.join(' ') || null;
    }
  }

  return { subject, id, teacherName, classId, active: true };
}

module.exports = {
  findAll,
  findById,
  create,
  remove,
  delete: remove,
  parseSubgroupInput,
};
