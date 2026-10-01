const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { Op } = require('sequelize');

/**
 * P1 item 3 — boot-лоадер каталога аудиторий.
 * Каталог (что существует: классы/профили/подгруппы/теги) живёт в файле
 * `config/audience.json` (JSONC с `//`-комментариями, volume-mount `:ro`);
 * рантайм (кто что выбрал) — в БД. TAG-шаблон — только `tags.template` из файла,
 * имени `TAG_TEMPLATE` из ENV не вводим.
 */

const TAGS_TEMPLATE_KEY = 'tags_template';
const TAGS_SHOW_CLASS_KEY = 'tags_show_class';
const TAGS_MAX_SEGMENTS_KEY = 'tags_max_segments';

const DEFAULT_TAGS = {
  template: '{track} · {subgroup}',
  showClass: false,
  maxSegments: 4
};

/**
 * Путь к файлу каталога: AUDIENCE_CONFIG_PATH, иначе <cwd>/config/audience.json.
 * @returns {string}
 */
function getAudienceConfigPath() {
  const envPath = process.env.AUDIENCE_CONFIG_PATH;
  if (envPath != null && String(envPath).trim() !== '') return String(envPath).trim();
  return path.join(process.cwd(), 'config', 'audience.json');
}

/**
 * Вырезать `//`-комментарии (до конца строки) вне строк в кавычках.
 * @param {string} text
 * @returns {string}
 */
function stripJsonComments(text) {
  const src = String(text);
  let out = '';
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Проверить строку-идентификатор.
 * @param {unknown} value
 * @param {string} what
 * @returns {string}
 * @throws {Error} если пусто/не строка
 */
function reqId(value, what) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what}: нужен непустой id`);
  return value.trim();
}

/**
 * Валидация каталога; возвращает нормализованные {classes, tracks, subgroups, tags}.
 * Бросает Error с короткой понятной причиной (она уйдёт в лог-строку).
 * @param {unknown} data
 */
function validateCatalog(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('корень: нужен объект {classes, subgroups, tags}');
  }
  const classesRaw = data.classes;
  const subgroupsRaw = data.subgroups;
  if (!Array.isArray(classesRaw)) throw new Error('classes: нужен массив');
  if (!Array.isArray(subgroupsRaw)) throw new Error('subgroups: нужен массив');

  const classes = [];
  const tracks = [];
  const seenClassIds = new Set();
  const seenTrackIds = new Set();
  for (let ci = 0; ci < classesRaw.length; ci++) {
    const c = classesRaw[ci];
    if (!c || typeof c !== 'object') throw new Error(`classes[${ci}]: нужен объект`);
    const id = reqId(c.id, `classes[${ci}]`);
    if (seenClassIds.has(id)) throw new Error(`classes[${ci}]: дубль id '${id}'`);
    seenClassIds.add(id);
    let grade = null;
    if (c.grade != null) {
      grade = Number(c.grade);
      if (!Number.isInteger(grade) || grade < 1 || grade > 11) {
        throw new Error(`classes[${ci}] ('${id}'): grade должен быть 1..11`);
      }
    }
    classes.push({ id, grade });
    const classTracks = c.tracks == null ? [] : c.tracks;
    if (!Array.isArray(classTracks)) throw new Error(`classes[${ci}] ('${id}'): tracks должен быть массивом`);
    for (let ti = 0; ti < classTracks.length; ti++) {
      const t = classTracks[ti];
      if (!t || typeof t !== 'object') throw new Error(`classes[${ci}].tracks[${ti}]: нужен объект`);
      const tid = reqId(t.id, `classes[${ci}].tracks[${ti}]`);
      if (typeof t.name !== 'string' || !t.name.trim()) {
        throw new Error(`classes[${ci}].tracks[${ti}] ('${tid}'): нужно непустое name`);
      }
      if (seenTrackIds.has(tid)) throw new Error(`tracks: дубль id '${tid}'`);
      seenTrackIds.add(tid);
      tracks.push({ id: tid, classId: id, name: t.name.trim() });
    }
  }

  const subgroups = [];
  const seenSubIds = new Set();
  for (let si = 0; si < subgroupsRaw.length; si++) {
    const s = subgroupsRaw[si];
    if (!s || typeof s !== 'object') throw new Error(`subgroups[${si}]: нужен объект`);
    const id = reqId(s.id, `subgroups[${si}]`);
    if (seenSubIds.has(id)) throw new Error(`subgroups: дубль id '${id}'`);
    seenSubIds.add(id);
    if (typeof s.division !== 'string' || !s.division.trim()) {
      throw new Error(`subgroups[${si}] ('${id}'): нужно непустое division`);
    }
    if (typeof s.name !== 'string' || !s.name.trim()) {
      throw new Error(`subgroups[${si}] ('${id}'): нужно непустое name`);
    }
    let teacher = null;
    if (s.teacher != null) {
      if (typeof s.teacher !== 'string' || !s.teacher.trim()) {
        throw new Error(`subgroups[${si}] ('${id}'): teacher должен быть строкой или null`);
      }
      teacher = s.teacher.trim();
    }
    let subject = null;
    if (s.subject != null) {
      if (typeof s.subject !== 'string' || !s.subject.trim()) {
        throw new Error(`subgroups[${si}] ('${id}'): subject должен быть строкой или null`);
      }
      subject = s.subject.trim();
    }
    let classId = null;
    if (s.classId != null) {
      if (typeof s.classId !== 'string' || !s.classId.trim()) {
        throw new Error(`subgroups[${si}] ('${id}'): classId должен быть строкой или null`);
      }
      classId = s.classId.trim();
      if (!seenClassIds.has(classId)) throw new Error(`subgroups[${si}] ('${id}'): classId '${classId}' нет в classes`);
    }
    let active = true;
    if (s.active != null) {
      if (typeof s.active !== 'boolean') throw new Error(`subgroups[${si}] ('${id}'): active должен быть bool`);
      active = s.active;
    }
    subgroups.push({ id, division: s.division.trim(), name: s.name.trim(), teacher, subject, classId, active });
  }

  const tags = { ...DEFAULT_TAGS };
  if (data.tags != null) {
    if (typeof data.tags !== 'object' || Array.isArray(data.tags)) throw new Error('tags: нужен объект');
    if (data.tags.template != null) {
      if (typeof data.tags.template !== 'string' || !data.tags.template.trim()) {
        throw new Error('tags.template: нужна непустая строка');
      }
      tags.template = data.tags.template;
    }
    if (data.tags.showClass != null) {
      if (typeof data.tags.showClass !== 'boolean') throw new Error('tags.showClass: нужен bool');
      tags.showClass = data.tags.showClass;
    }
    if (data.tags.maxSegments != null) {
      const m = Number(data.tags.maxSegments);
      if (!Number.isInteger(m) || m < 1 || m > 10) throw new Error('tags.maxSegments: нужно целое 1..10');
      tags.maxSegments = m;
    }
  }

  return { classes, tracks, subgroups, tags };
}

/**
 * Прочитать и провалидировать файл каталога.
 * @param {string} configPath
 * @returns {{classes: Array, tracks: Array, subgroups: Array, tags: object}}
 * @throws {Error} ENOENT — файла нет; иначе причина невалидности
 */
function readAudienceFile(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  let data;
  try {
    data = JSON.parse(stripJsonComments(raw));
  } catch (parseErr) {
    throw new Error(`не JSON: ${parseErr.message}`);
  }
  return validateCatalog(data);
}

/**
 * Вывести букву класса из id («10А» → «А»).
 * @param {string} id
 * @returns {string|null}
 */
function letterFromClassId(id) {
  const m = String(id).match(/^\d+(.+)$/);
  return m ? m[1] : null;
}

/**
 * Boot-синк каталога: чтение → strip `//` → валидация → upsert по `id`;
 * отсутствующие в файле справочники → `active=false`/`enabled=false` (не удаляем).
 * При битой правке бот не падает: понятная строка в лог + работа со старым каталогом из БД.
 * Формат строк зафиксирован:
 *   ok:      `✅ audience.json: каталог обновлён (классов: X, треков: Y, подгрупп: Z)`
 *   invalid: `❌ audience.json: <причина> — работаем со старым каталогом из БД`
 *   missing: `⚠️ audience.json не найден (<path>) — работаем с каталогом из БД`
 * @param {{configPath?: string}} [options]
 * @returns {Promise<{status: 'ok'|'fallback-missing'|'fallback-invalid', classes?: number, tracks?: number, subgroups?: number, reason?: string}>}
 */
async function syncAudienceCatalog(options = {}) {
  const configPath = options.configPath || getAudienceConfigPath();
  let catalog;
  try {
    catalog = readAudienceFile(configPath);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      logger.warn(`⚠️ audience.json не найден (${configPath}) — работаем с каталогом из БД`);
      return { status: 'fallback-missing', reason: 'missing' };
    }
    logger.error(`❌ audience.json: ${e.message} — работаем со старым каталогом из БД`);
    return { status: 'fallback-invalid', reason: e.message };
  }

  const { Class, Track, Subgroup, Setting } = require('../models');

  for (const c of catalog.classes) {
    const grade = c.grade != null ? c.grade : parseInt(String(c.id), 10) || null;
    await Class.upsert({ id: c.id, grade, letter: letterFromClassId(c.id), enabled: true });
  }
  for (const t of catalog.tracks) {
    await Track.upsert({ id: t.id, classId: t.classId, name: t.name, isCommon: false });
  }
  for (const s of catalog.subgroups) {
    await Subgroup.upsert({
      id: s.id,
      division: s.division,
      name: s.name,
      teacher: s.teacher,
      subject: s.subject,
      classId: s.classId,
      active: s.active
    });
  }
  // Отсутствующие в файле — деактивируем, не удаляем (история расписаний цела)
  try {
    const fileSubIds = catalog.subgroups.map((s) => s.id);
    const where = fileSubIds.length ? { id: { [Op.notIn]: fileSubIds } } : {};
    const existing = await Subgroup.findAll({ attributes: ['id'], raw: true });
    const missing = existing.map((r) => r.id).filter((id) => !fileSubIds.includes(id));
    if (missing.length) {
      await Subgroup.update({ active: false }, { where });
      logger.info(`✅ audience.json: деактивировано подгрупп (нет в файле): ${missing.length} (${missing.join(',')})`);
    }
  } catch (deErr) {
    logger.warn('⚠️ audience.json: деактивация отсутствующих подгрупп пропущена:', deErr.message || deErr);
  }
  try {
    const fileClassIds = catalog.classes.map((c) => c.id);
    const existingClasses = await Class.findAll({ attributes: ['id'], raw: true });
    const missingClasses = existingClasses.map((r) => r.id).filter((id) => !fileClassIds.includes(id));
    if (missingClasses.length) {
      const where = fileClassIds.length ? { id: { [Op.notIn]: fileClassIds } } : {};
      await Class.update({ enabled: false }, { where });
      logger.info(`✅ audience.json: деактивировано классов (нет в файле): ${missingClasses.length} (${missingClasses.join(',')})`);
    }
  } catch (deErr) {
    logger.warn('⚠️ audience.json: деактивация отсутствующих классов пропущена:', deErr.message || deErr);
  }

  await Setting.upsert({ key: TAGS_TEMPLATE_KEY, value: catalog.tags.template });
  await Setting.upsert({ key: TAGS_SHOW_CLASS_KEY, value: catalog.tags.showClass ? '1' : '0' });
  await Setting.upsert({ key: TAGS_MAX_SEGMENTS_KEY, value: String(catalog.tags.maxSegments) });

  logger.info(
    `✅ audience.json: каталог обновлён (классов: ${catalog.classes.length}, треков: ${catalog.tracks.length}, подгрупп: ${catalog.subgroups.length})`
  );
  return {
    status: 'ok',
    classes: catalog.classes.length,
    tracks: catalog.tracks.length,
    subgroups: catalog.subgroups.length
  };
}

/**
 * Теги склейки из БД (записаны лоадером) с дефолтами из §2 спек.
 * @returns {Promise<{template: string, showClass: boolean, maxSegments: number}>}
 */
async function getTagsConfig() {
  try {
    const { Setting } = require('../models');
    const rows = await Setting.findAll({
      where: { key: { [Op.in]: [TAGS_TEMPLATE_KEY, TAGS_SHOW_CLASS_KEY, TAGS_MAX_SEGMENTS_KEY] } },
      raw: true
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      template: map.get(TAGS_TEMPLATE_KEY) || DEFAULT_TAGS.template,
      showClass: map.has(TAGS_SHOW_CLASS_KEY) ? String(map.get(TAGS_SHOW_CLASS_KEY)) === '1' : DEFAULT_TAGS.showClass,
      maxSegments: map.has(TAGS_MAX_SEGMENTS_KEY) ? parseInt(map.get(TAGS_MAX_SEGMENTS_KEY), 10) || DEFAULT_TAGS.maxSegments : DEFAULT_TAGS.maxSegments
    };
  } catch (_e) {
    return { ...DEFAULT_TAGS };
  }
}

module.exports = {
  TAGS_TEMPLATE_KEY,
  TAGS_SHOW_CLASS_KEY,
  TAGS_MAX_SEGMENTS_KEY,
  DEFAULT_TAGS,
  getAudienceConfigPath,
  stripJsonComments,
  validateCatalog,
  readAudienceFile,
  syncAudienceCatalog,
  getTagsConfig
};
