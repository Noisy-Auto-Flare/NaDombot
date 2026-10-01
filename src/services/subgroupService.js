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
 * Создать подгруппу (P1 v2).
 * Ожидаемый ввод: "<subject> <id> <учитель...> [classId]"
 * Например: "английский belova Белова 10А" или "английский ivanova Иванова".
 * subject `-` → null (подгруппа годится для любого предмета).
 * division по умолчанию 'Английский язык', name по умолчанию = учитель.
 * @param {object|string} data
 * @returns {Promise<import('sequelize').Model>}
 */
async function create(data) {
  let payload = data;
  if (typeof data === 'string') {
    payload = parseSubgroupInput(data);
  }
  if (!payload.id) {
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
  return Subgroup.create({
    id: payload.id,
    division: payload.division || 'Английский язык',
    name: payload.name || payload.teacher || payload.id,
    teacher: payload.teacher != null ? payload.teacher : null,
    subject: payload.subject != null ? payload.subject : null,
    classId: payload.classId || null,
    active: payload.active !== false
  });
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
 * Парсит ввод подгруппы (P1 v2).
 * Формат: "<subject> <id> <учитель...> [classId]" — последний токен может быть классом если похож на "10А".
 * subject `-` → null (без привязки к предмету). division/name выводятся по умолчанию.
 * Эвристика: если последний токен матчит /^\d{1,2}[А-Яа-яA-Za-z]+$/ и токенов >=4 — считаем его classId.
 * @param {string} input
 * @returns {{subject:string|null, id:string, division:string, name:string|null, teacher:string|null, classId:string|null, active:boolean}}
 */
function parseSubgroupInput(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('❌ Пустой ввод для подгруппы');
  const parts = raw.split(/\s+/);
  if (parts.length < 2) {
    throw new Error('❌ Формат: <предмет> <id> <учитель> [classId]  Например: английский belova Белова');
  }
  const subjectRaw = parts[0];
  const subject = subjectRaw === '-' ? null : subjectRaw;
  const id = parts[1];
  let teacher = null;
  let classId = null;

  if (parts.length >= 3) {
    const rest = parts.slice(2);
    // check if last token looks like classId (e.g. 10А)
    const last = rest[rest.length - 1];
    const looksLikeClass = /^\d{1,2}[А-Яа-яA-Za-z]+$/.test(last);
    if (looksLikeClass && rest.length >= 2) {
      classId = last;
      teacher = rest.slice(0, -1).join(' ') || null;
    } else {
      teacher = rest.join(' ') || null;
    }
  }
  if (teacher === '-') teacher = null;

  return { subject, id, division: 'Английский язык', name: teacher, teacher, classId, active: true };
}

module.exports = {
  findAll,
  findById,
  create,
  remove,
  delete: remove,
  parseSubgroupInput,
};
