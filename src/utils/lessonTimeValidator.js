const { parseHHMM } = require('./moscowTime');

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate HH:MM string
 * @param {string} str
 * @throws {ValidationError}
 */
function validateHHMM(str) {
  if (typeof str !== 'string' || !HHMM_REGEX.test(str)) {
    throw new ValidationError(`Invalid HH:MM: ${str}`);
  }
}

/**
 * Validate lesson number 1-7
 * @param {number} n
 * @throws {ValidationError}
 */
function validateLessonNumber(n) {
  if (!Number.isInteger(n) || n < 1 || n > 7) {
    throw new ValidationError(`Invalid lessonNumber: ${n} (expected 1-7)`);
  }
}

/**
 * Validate start < end using moscowTime.parseHHMM
 * @param {string} startTime
 * @param {string} endTime
 * @throws {ValidationError}
 */
function validateTimeRange(startTime, endTime) {
  validateHHMM(startTime);
  validateHHMM(endTime);
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (end <= start) {
    throw new ValidationError(`endTime must be after startTime: ${startTime} >= ${endTime}`);
  }
}

module.exports = {
  ValidationError,
  validateHHMM,
  validateLessonNumber,
  validateTimeRange,
};
