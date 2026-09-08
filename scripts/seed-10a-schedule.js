#!/usr/bin/env node
/**
 * Seed расписания 10а (технический профиль, только Т) + звонков из фото.
 * Идемпотентно: upsert по (dayOfWeek, lessonNumber), перезапишет существующие.
 * Запуск: docker compose exec bot node scripts/seed-10a-schedule.js --yes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize } = require('../src/config/database');
const { Schedule } = require('../src/models');
const { seedLessonTimes } = require('../src/utils/seedLessonTimes');

const DRY = !process.argv.includes('--yes');

function expandSubject(raw) {
  const map = {
    'геометр': 'геометрия',
    'биолог': 'биология',
    'географ': 'география',
    'литер': 'литература',
    'физ культ': 'физкультура',
    'физ спТ': 'физика спец',
    'рус спС': 'русский спец',
    'англ': 'английский',
    'инфТ': 'информатика',
    'инфС': 'информатика',
    'инф': 'информатика',
    'общС': 'обществознание',
    'общТ': 'обществознание',
    'общ': 'обществознание',
    'мат прС': 'математический практикум',
    'ВиС': 'ВиС',
    'ОБЗР': 'ОБЗР',
    'РМГ': 'РМГ',
  };
  return raw.split('/').map(part => {
    const t = part.trim();
    const low = t.toLowerCase();
    if (map[t]) return map[t];
    if (map[low]) return map[low];
    for (const k of Object.keys(map)) if (k.toLowerCase() === low) return map[k];
    return t;
  }).join('/');
}

function pickTechProfile(subjectRaw, roomRaw) {
  if (!subjectRaw.includes('/')) return { subject: expandSubject(subjectRaw), room: roomRaw };
  const subParts = subjectRaw.split('/').map(s => s.trim());
  const roomParts = roomRaw.split('/').map(r => r.trim());
  // Т группы — часть оканчивается на Т (инфТ, общТ, физ спТ)
  let idx = subParts.findIndex(p => p.slice(-1).toUpperCase() === 'Т');
  if (idx === -1) idx = subParts.findIndex(p => p.toUpperCase().includes('Т'));
  if (idx === -1) idx = 0; // fallback
  if (idx >= roomParts.length) idx = 0;
  const pickedSub = subParts[idx] || subParts[0];
  const pickedRoom = roomParts[idx] || roomParts[0] || roomRaw;
  return { subject: expandSubject(pickedSub), room: pickedRoom };
}

const RAW_SCHEDULE = [
  { dayOfWeek: 0, lessonNumber: 1, subjectName: 'Разговор о важном', room: '2035' },
  { dayOfWeek: 0, lessonNumber: 2, subjectName: 'инфТ/общС', room: '1059/3021' },
  { dayOfWeek: 0, lessonNumber: 3, subjectName: 'общТ/инфС', room: '3028/1059' },
  { dayOfWeek: 0, lessonNumber: 4, subjectName: 'алгебра', room: '3046' },
  { dayOfWeek: 0, lessonNumber: 5, subjectName: 'инфТ/общС', room: '1059/3021' },
  { dayOfWeek: 0, lessonNumber: 6, subjectName: 'биолог', room: '3026' },
  { dayOfWeek: 0, lessonNumber: 7, subjectName: 'геометр', room: '3046' },
  { dayOfWeek: 1, lessonNumber: 1, subjectName: 'алгебра', room: '3046' },
  { dayOfWeek: 1, lessonNumber: 2, subjectName: 'геометр', room: '3046' },
  { dayOfWeek: 1, lessonNumber: 3, subjectName: 'история', room: '3028' },
  { dayOfWeek: 1, lessonNumber: 4, subjectName: 'географ', room: '3022' },
  { dayOfWeek: 1, lessonNumber: 5, subjectName: 'физика', room: '4003' },
  { dayOfWeek: 1, lessonNumber: 6, subjectName: 'русский', room: '3018' },
  { dayOfWeek: 1, lessonNumber: 7, subjectName: 'литер', room: '3018' },
  { dayOfWeek: 1, lessonNumber: 8, subjectName: 'физ культ', room: 'БСЗ/МСЗ' },
  { dayOfWeek: 2, lessonNumber: 1, subjectName: 'рус спС/физ спТ', room: '3018/4003' },
  { dayOfWeek: 2, lessonNumber: 2, subjectName: 'ОБЗР', room: '4013' },
  { dayOfWeek: 2, lessonNumber: 3, subjectName: 'англ', room: '4005' },
  { dayOfWeek: 2, lessonNumber: 4, subjectName: 'алгебра', room: '3046' },
  { dayOfWeek: 2, lessonNumber: 5, subjectName: 'проект', room: '3028' },
  { dayOfWeek: 2, lessonNumber: 6, subjectName: 'общТ/мат прС', room: '3028/3046' },
  { dayOfWeek: 2, lessonNumber: 7, subjectName: 'ВиС', room: '3046' },
  { dayOfWeek: 3, lessonNumber: 1, subjectName: 'РМГ', room: '2035' },
  { dayOfWeek: 3, lessonNumber: 2, subjectName: 'история', room: '3028' },
  { dayOfWeek: 3, lessonNumber: 3, subjectName: 'геометр', room: '3046' },
  { dayOfWeek: 3, lessonNumber: 4, subjectName: 'англ', room: '4005' },
  { dayOfWeek: 3, lessonNumber: 5, subjectName: 'алгебра', room: '3046' },
  { dayOfWeek: 3, lessonNumber: 6, subjectName: 'русский', room: '3018' },
  { dayOfWeek: 3, lessonNumber: 7, subjectName: 'литер', room: '3018' },
  { dayOfWeek: 4, lessonNumber: 1, subjectName: 'физика', room: '4003' },
  { dayOfWeek: 4, lessonNumber: 2, subjectName: 'англ', room: '4005' },
  { dayOfWeek: 4, lessonNumber: 3, subjectName: 'инфТ/общС', room: '1058/3021' },
  { dayOfWeek: 4, lessonNumber: 4, subjectName: 'литер', room: '3018' },
  { dayOfWeek: 4, lessonNumber: 5, subjectName: 'химия', room: '3023' },
  { dayOfWeek: 4, lessonNumber: 6, subjectName: 'физ культ', room: 'БСЗ' },
  { dayOfWeek: 4, lessonNumber: 7, subjectName: 'инфТ/общС', room: '1058/3021' },
];

function capitalizeSubject(name) {
  if (!name) return name;
  if (name === name.toUpperCase()) return name; // ОБЗР, ВиС, РМГ
  if (['ВиС', 'ОБЗР', 'РМГ'].includes(name)) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const SCHEDULE_10A = RAW_SCHEDULE.map(r => {
  const picked = pickTechProfile(r.subjectName, r.room);
  return { ...r, subjectName: capitalizeSubject(picked.subject), room: picked.room };
});

async function run() {
  try { await sequelize.authenticate(); } catch (e) {
    console.error('DB connect fail', e.message); process.exit(1);
  }
  await sequelize.sync();
  await seedLessonTimes();

  console.log(`${DRY ? '[DRY-RUN] ' : ''}Будет upsert ${SCHEDULE_10A.length} уроков 10а ТЕХ профиль (дни 0-4):`);
  for (const s of SCHEDULE_10A) {
    console.log(`  ${['Пн','Вт','Ср','Чт','Пт'][s.dayOfWeek]} ${s.lessonNumber}. ${s.subjectName} — каб. ${s.room}`);
  }
  const LessonTime = require('../src/models/LessonTime');
  const bells = await LessonTime.findAll({ order: [['lessonNumber','ASC']] });
  console.log(`\nЗвонки (${bells.length}): ${bells.map(b=>`${b.lessonNumber}:${b.startTime}-${b.endTime}`).join(', ')}`);
  if (DRY) {
    console.log('\nЗапусти с --yes чтобы записать в БД (перезапишет существующие уроки)');
    await sequelize.close(); process.exit(0);
  }
  for (const s of SCHEDULE_10A) {
    const [row, created] = await Schedule.findOrCreate({
      where: { dayOfWeek: s.dayOfWeek, lessonNumber: s.lessonNumber },
      defaults: s,
    });
    if (!created) {
      await row.update({ subjectName: s.subjectName, room: s.room });
    }
  }
  console.log('\n✅ Расписание 10а ТЕХ профиль и звонки обновлены. Проверь: /start -> расписание, 🏫 В каком кабинете урок');
  await sequelize.close(); process.exit(0);
}
run().catch(e=>{ console.error(e); process.exit(1); });
