const Track = require('../models/Track');
const Class = require('../models/Class');

/**
 * Сервис для управления профилями (треками).
 */

/**
 * Найти все треки.
 * @returns {Promise<import('sequelize').Model[]>}
 */
async function findAll() {
  return Track.findAll({ order: [['classId', 'ASC'], ['id', 'ASC']] });
}

/**
 * Найти трек по PK (id — код трека). Для составного поиска используйте findByClassAndId.
 * @param {string} id
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findById(id) {
  return Track.findByPk(id);
}

/**
 * Найти трек по classId+trackId
 * @param {string} classId
 * @param {string} trackId
 * @returns {Promise<import('sequelize').Model|null>}
 */
async function findByClassAndId(classId, trackId) {
  return Track.findOne({ where: { classId, id: trackId } });
}

/**
 * Создать трек.
 * Ввод: "<classId> <trackId> <name...>" — например "10А tech Технологический профиль"
 * @param {object|string} data
 * @returns {Promise<import('sequelize').Model>}
 */
async function create(data) {
  let payload = data;
  if (typeof data === 'string') {
    payload = parseTrackInput(data);
  }
  if (!payload.id || !payload.classId || !payload.name) {
    throw new Error('❌ Для профиля нужно: <classId> <trackId> <название>');
  }
  // validate class exists
  const classExists = await Class.findByPk(payload.classId);
  if (!classExists) {
    throw new Error('❌ Класс не найден: ' + payload.classId);
  }
  const existing = await Track.findOne({ where: { classId: payload.classId, id: payload.id } });
  if (existing) {
    const err = new Error('SLOT_TAKEN');
    err.existing = existing;
    throw err;
  }
  return Track.create(payload);
}

/**
 * Удалить трек.
 * @param {string} classId
 * @param {string} trackId
 * @returns {Promise<{deletedId:string}>}
 */
async function remove(classId, trackId) {
  // Allow remove(trackId) or remove(classId,trackId) or remove("10А tech")
  if (trackId == null && typeof classId === 'string' && classId.includes(' ')) {
    const parts = classId.trim().split(/\s+/);
    classId = parts[0];
    trackId = parts[1];
  }
  let found = null;
  if (classId && trackId) {
    found = await Track.findOne({ where: { classId, id: trackId } });
  } else if (classId) {
    found = await Track.findByPk(classId);
  }
  if (!found) throw new Error('NOT_FOUND');
  await found.destroy();
  return { deletedId: found.id };
}

/**
 * Парсит ввод трека: "<classId> <trackId> <name...>"
 * @param {string} input
 * @returns {{classId:string, id:string, name:string, isCommon:boolean}}
 */
function parseTrackInput(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('❌ Пустой ввод для профиля');
  const parts = raw.split(/\s+/);
  if (parts.length < 3) {
    throw new Error('❌ Формат: <classId> <trackId> <название>  Например: 10А tech Тех. профиль');
  }
  const classId = parts[0];
  const trackId = parts[1];
  const name = parts.slice(2).join(' ').trim();
  if (!name) throw new Error('❌ Название профиля не может быть пустым');
  return { classId, id: trackId, name, isCommon: false };
}

module.exports = {
  findAll,
  findById,
  findByClassAndId,
  create,
  remove,
  delete: remove,
  parseTrackInput,
};
