/**
 * Cyrillic-safe subject normalization.
 * Pure functions, no dependencies.
 */

/**
 * Normalize subject string for comparison.
 * Steps: NFKC → trim → collapse spaces → lower → ё→е → strip trailing .,;:!?
 * Returns empty string for null/undefined.
 * @param {unknown} str
 * @returns {string}
 */
function normalizeSubject(str) {
  if (str == null) return '';
  const s = String(str).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
  if (!s) return '';
  // Strip trailing punctuation (.,;:!? ) — decision: "Русский язык." should match "русский язык"
  const stripped = s.replace(/[.,;:!?]+$/g, '');
  // Re-trim in case punctuation removal left trailing space (unlikely)
  return stripped.trim();
}

/**
 * First token of normalized subject.
 * @param {unknown} str
 * @returns {string}
 */
function firstToken(str) {
  const normalized = normalizeSubject(str);
  if (!normalized) return '';
  return normalized.split(' ')[0] || '';
}

/**
 * Compare two subject names.
 * True if normalized forms equal OR first tokens equal.
 * Handles null/empty → false.
 * Covers: "русский язык" vs "русский", "РУССКИЙ" vs "русский", extra spaces, Yo, NFKC, punctuation.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function subjectsMatch(a, b) {
  if (a == null || b == null) return false;
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const fa = firstToken(a);
  const fb = firstToken(b);
  if (!fa || !fb) return false;
  return fa === fb;
}

module.exports = {
  normalizeSubject,
  firstToken,
  subjectsMatch,
};
