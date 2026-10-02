#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const logger = require('../src/utils/logger');
const { sequelize } = require('../src/config/database');
const { syncDatabase } = require('../src/config/database');
const { Schedule, Class, Track, Subgroup, Setting } = require('../src/models');

async function ensureBase() {
  await Class.findOrCreate({ where:{id:'10А'}, defaults:{id:'10А', grade:10, letter:'А', enabled:true}});
  await Track.findOrCreate({ where:{id:'tech', classId:'10А'}, defaults:{id:'tech', classId:'10А', name:'Технологический'}});
  await Track.findOrCreate({ where:{id:'soc', classId:'10А'}, defaults:{id:'soc', classId:'10А', name:'Социально-экономический'}});
  await Subgroup.findOrCreate({ where:{id:'belova'}, defaults:{id:'belova', division:'Английский язык', name:'Белова', teacher:'Белова Ирина Николаевна', subject:'английский', classId:null, active:true}});
  await Subgroup.findOrCreate({ where:{id:'ferfarova'}, defaults:{id:'ferfarova', division:'Английский язык', name:'Ферфарова', teacher:'Ферфарова Валерия Михайловна', subject:'английский', classId:null, active:true}});
  await Setting.upsert({key:'multiprofile_enabled', value:'1'});
}

const SCHEDULE = [
  {dayOfWeek:0, lessonNumber:1, subjectName:'Разговор о важном', room:'2035', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:0, lessonNumber:2, subjectName:'Информатика', room:'1058', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:0, lessonNumber:2, subjectName:'Обществознание', room:'3021', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:0, lessonNumber:3, subjectName:'Обществознание', room:'3028', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:0, lessonNumber:3, subjectName:'Информатика', room:'1058', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:0, lessonNumber:4, subjectName:'Алгебра', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:0, lessonNumber:5, subjectName:'Информатика', room:'1058', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:0, lessonNumber:5, subjectName:'Обществознание', room:'3021', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:0, lessonNumber:6, subjectName:'Биология', room:'3026', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:0, lessonNumber:7, subjectName:'Геометрия', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:1, subjectName:'Алгебра', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:2, subjectName:'Геометрия', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:3, subjectName:'История', room:'3028', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:4, subjectName:'География', room:'3022', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:5, subjectName:'Физика', room:'4003', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:6, subjectName:'Русский', room:'3018', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:7, subjectName:'Литература', room:'3018', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:1, lessonNumber:8, subjectName:'Физкультура', room:'БСЗ/МСЗ', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:2, lessonNumber:1, subjectName:'Русский спец', room:'3018', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:2, lessonNumber:1, subjectName:'Физика спец', room:'4003', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:2, lessonNumber:2, subjectName:'ОБЗР', room:'4013', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:2, lessonNumber:3, subjectName:'Английский', room:'4005', classId:'10А', trackId:null, subgroupId:'belova'},
  {dayOfWeek:2, lessonNumber:3, subjectName:'Английский', room:'библ', classId:'10А', trackId:null, subgroupId:'ferfarova'},
  {dayOfWeek:2, lessonNumber:4, subjectName:'Алгебра', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:2, lessonNumber:5, subjectName:'Проект', room:'3028', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:2, lessonNumber:6, subjectName:'Обществознание', room:'3028', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:2, lessonNumber:6, subjectName:'Математический практикум', room:'3046', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:2, lessonNumber:7, subjectName:'ВиС', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:1, subjectName:'РМГ', room:'2035', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:2, subjectName:'История', room:'3028', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:3, subjectName:'Геометрия', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:4, subjectName:'Английский', room:'4005', classId:'10А', trackId:null, subgroupId:'belova'},
  {dayOfWeek:3, lessonNumber:4, subjectName:'Английский', room:'библ', classId:'10А', trackId:null, subgroupId:'ferfarova'},
  {dayOfWeek:3, lessonNumber:5, subjectName:'Алгебра', room:'3046', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:6, subjectName:'Русский', room:'3018', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:3, lessonNumber:7, subjectName:'Литература', room:'3018', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:4, lessonNumber:1, subjectName:'Физика', room:'4003', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:4, lessonNumber:2, subjectName:'Английский', room:'4005', classId:'10А', trackId:null, subgroupId:'belova'},
  {dayOfWeek:4, lessonNumber:2, subjectName:'Английский', room:'библ', classId:'10А', trackId:null, subgroupId:'ferfarova'},
  {dayOfWeek:4, lessonNumber:3, subjectName:'Информатика', room:'1058', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:4, lessonNumber:3, subjectName:'Обществознание', room:'3021', classId:'10А', trackId:'soc', subgroupId:null},
  {dayOfWeek:4, lessonNumber:4, subjectName:'Литература', room:'3018', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:4, lessonNumber:5, subjectName:'Химия', room:'3023', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:4, lessonNumber:6, subjectName:'Физкультура', room:'БСЗ', classId:'10А', trackId:null, subgroupId:null},
  {dayOfWeek:4, lessonNumber:7, subjectName:'Информатика', room:'1058', classId:'10А', trackId:'tech', subgroupId:null},
  {dayOfWeek:4, lessonNumber:7, subjectName:'Обществознание', room:'3021', classId:'10А', trackId:'soc', subgroupId:null},
];

/**
 * P1 item 0 — `--replace`-гард: по умолчанию скрипт безопасен (только upsert,
 * никаких destroy). Массовая перезаливка 10А — только с явным `--replace`.
 */
const REPLACE = process.argv.includes('--replace');

/**
 * Естественный ключ строки расписания (совпадает с unique_lesson_per_audience).
 * @param {object} s
 */
function naturalKey(s) {
  return {
    classId: s.classId != null ? s.classId : '10А',
    dayOfWeek: s.dayOfWeek,
    lessonNumber: s.lessonNumber,
    trackId: s.trackId != null ? s.trackId : null,
    subgroupId: s.subgroupId != null ? s.subgroupId : null
  };
}

async function upsertScheduleRow(s) {
  const { Op } = require('sequelize');
  const key = naturalKey(s);
  const where = {
    classId: key.classId,
    dayOfWeek: key.dayOfWeek,
    lessonNumber: key.lessonNumber,
    trackId: key.trackId == null ? { [Op.is]: null } : key.trackId,
    subgroupId: key.subgroupId == null ? { [Op.is]: null } : key.subgroupId
  };
  const existing = await Schedule.findOne({ where });
  if (!existing) {
    await Schedule.create({
      dayOfWeek: s.dayOfWeek,
      lessonNumber: s.lessonNumber,
      subjectName: s.subjectName,
      room: s.room != null ? s.room : null,
      classId: key.classId,
      trackId: key.trackId,
      subgroupId: key.subgroupId
    });
    return 'created';
  }
  let dirty = false;
  if (existing.subjectName !== s.subjectName) { existing.subjectName = s.subjectName; dirty = true; }
  const wantRoom = s.room != null ? s.room : null;
  if ((existing.room || null) !== wantRoom) { existing.room = wantRoom; dirty = true; }
  if (dirty) await existing.save();
  return dirty ? 'updated' : 'skipped';
}

async function run(){
  await syncDatabase();
  await ensureBase();
  if (REPLACE) {
    logger.info('Cleaning old 10А schedules (--replace)...');
    const { Homework } = require('../src/models');
    const oldIds = (await Schedule.findAll({where:{classId:'10А'}, attributes:['id'], raw:true})).map(r=>r.id);
    if(oldIds.length){ await Homework.destroy({where:{scheduleId: oldIds}}); logger.info('  Deleted', oldIds.length, 'homework refs'); }
    await Schedule.destroy({where:{classId:'10А'}});
    logger.info('Inserting', SCHEDULE.length, 'rows...');
    for(const s of SCHEDULE) await Schedule.create(s);
  } else {
    logger.info('Upserting 10А schedules (без --replace: только upsert, без destroy)...');
    let created = 0; let updated = 0; let skipped = 0;
    for(const s of SCHEDULE) {
      const res = await upsertScheduleRow(s);
      if (res === 'created') created++;
      else if (res === 'updated') updated++;
      else skipped++;
    }
    logger.info(`  created=${created} updated=${updated} skipped=${skipped} (всего в сиде: ${SCHEDULE.length})`);
  }
  const count = await Schedule.count({where:{classId:'10А'}});
  logger.info('✅ Seed done. 10А schedules:', count);
  const classes = await Class.findAll({raw:true});
  const tracks = await Track.findAll({raw:true});
  const subs = await Subgroup.findAll({raw:true});
  logger.info('Classes:', classes.map(c=>c.id));
  logger.info('Tracks:', tracks.map(t=>t.classId+':'+t.id));
  logger.info('Subgroups:', subs.map(s=>s.id+':'+(s.teacher || s.name)+'/'+(s.subject != null ? s.subject : 'any')));
  const mp = await Setting.findByPk('multiprofile_enabled');
  logger.info('multiprofile_enabled =', mp?.value);
  await sequelize.close(); process.exit(0);
}
run().catch(e=>{logger.error(e); process.exit(1);});
