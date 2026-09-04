/**
 * Валидация и парсинг ввода урока
 */

function validateDay(dayOfWeek) {
  if (Number.isNaN(dayOfWeek) || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('❌ Неверный день недели. Используйте числа от 0 до 6.');
  }
}

function validateLesson(lessonNumber) {
  if (Number.isNaN(lessonNumber) || !Number.isInteger(lessonNumber) || lessonNumber < 1 || lessonNumber > 10) {
    throw new Error('❌ Неверный номер урока. Используйте числа от 1 до 10.');
  }
}

function validateSubject(subjectName) {
  if (!subjectName || subjectName.trim().length === 0) {
    throw new Error('❌ Название предмета не может быть пустым.');
  }
}

function validateRoom(room) {
  if (room == null) return null;
  const r = String(room).trim();
  if (!r || r === '-') return null;
  if (r.length > 20) {
    throw new Error('❌ Номер кабинета слишком длинный (максимум 20 символов).');
  }
  return r;
}

function parseRoomInput(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw || raw === '-') return null;
  return validateRoom(raw);
}

/**
 * Парсит строку "<день> <урок> <предмет>" → объект
 * @param {string} input
 * @returns {{dayOfWeek:number, lessonNumber:number, subjectName:string}}
 */
function parseLessonInput(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('❌ Неверный формат. Попробуйте еще раз:\n<день_недели> <номер_урока> <название_предмета>');
  }
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length < 3) {
    throw new Error('❌ Неверный формат. Попробуйте еще раз:\n<день_недели> <номер_урока> <название_предмета>');
  }

  const dayOfWeek = parseInt(parts[0], 10);
  const lessonNumber = parseInt(parts[1], 10);
  const subjectName = parts.slice(2).join(' ').trim();

  validateDay(dayOfWeek);
  validateLesson(lessonNumber);
  validateSubject(subjectName);

  return { dayOfWeek, lessonNumber, subjectName };
}

module.exports = {
  validateDay,
  validateLesson,
  validateSubject,
  validateRoom,
  parseRoomInput,
  parseLessonInput,
};
