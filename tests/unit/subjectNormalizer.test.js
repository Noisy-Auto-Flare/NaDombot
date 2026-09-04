const { normalizeSubject, firstToken, subjectsMatch } = require('../../src/utils/subjectNormalizer');

describe('subjectNormalizer.normalizeSubject', () => {
  test('exact match unchanged', () => {
    expect(normalizeSubject('русский язык')).toBe('русский язык');
  });

  test('trims and collapses extra spaces', () => {
    expect(normalizeSubject('  Русский   язык  ')).toBe('русский язык');
    expect(normalizeSubject('математика   \t  продвинутая')).toBe('математика продвинутая');
  });

  test('case insensitive Cyrillic lowercasing', () => {
    expect(normalizeSubject('РУССКИЙ ЯЗЫК')).toBe('русский язык');
    expect(normalizeSubject('Русский Язык')).toBe('русский язык');
    expect(normalizeSubject('РУССКИЙ')).toBe('русский');
  });

  test('ё → е after lower (lowercase ё)', () => {
    expect(normalizeSubject('мёд')).toBe('мед');
    expect(normalizeSubject('ёж')).toBe('еж');
  });

  test('Ё → е after lower (uppercase Ё)', () => {
    expect(normalizeSubject('МЁД')).toBe('мед');
    expect(normalizeSubject('ЁЛКА')).toBe('елка');
    expect(normalizeSubject('Алёна')).toBe('алена');
  });

  test('NFKC normalization: e + combining diaeresis → ё → е', () => {
    // 'е' + combining diaeresis (U+0308) NFKC-composes to 'ё'
    const decomposed = 'е\u0308лка'; // should become 'елка'
    expect(normalizeSubject(decomposed)).toBe('елка');
  });

  test('NFKC normalization: fullwidth Cyrillic or compatibility', () => {
    // NFKC should at least not throw and normalize fullwidth latin example
    // Fullwidth 'Ａ' (U+FF21) NFKC -> 'A' -> 'a'
    expect(normalizeSubject('\uFF21')).toBe('a');
  });

  test('strips trailing punctuation .,', () => {
    expect(normalizeSubject('Русский язык.')).toBe('русский язык');
    expect(normalizeSubject('Русский язык,')).toBe('русский язык');
    expect(normalizeSubject('Русский язык...')).toBe('русский язык');
  });

  test('hyphen preserved', () => {
    expect(normalizeSubject('русский-язык')).toBe('русский-язык');
    expect(normalizeSubject('  Русский-Язык  ')).toBe('русский-язык');
  });

  test('handles null/undefined/empty → empty string', () => {
    expect(normalizeSubject(null)).toBe('');
    expect(normalizeSubject(undefined)).toBe('');
    expect(normalizeSubject('')).toBe('');
    expect(normalizeSubject('   ')).toBe('');
  });

  test('coerces numbers via String()', () => {
    expect(normalizeSubject(123)).toBe('123');
  });
});

describe('subjectNormalizer.firstToken', () => {
  test('returns first word lowercased and normalized', () => {
    expect(firstToken('русский язык')).toBe('русский');
    expect(firstToken('РУССКИЙ ЯЗЫК')).toBe('русский');
    expect(firstToken('  Русский   язык  ')).toBe('русский');
  });

  test('single word returns itself', () => {
    expect(firstToken('Математика')).toBe('математика');
  });

  test('strips trailing punctuation via normalize', () => {
    expect(firstToken('Русский язык.')).toBe('русский');
    expect(firstToken('Русский,')).toBe('русский');
  });

  test('ё handling in first token', () => {
    expect(firstToken('Ёлка большая')).toBe('елка');
  });

  test('empty/null → empty string', () => {
    expect(firstToken('')).toBe('');
    expect(firstToken(null)).toBe('');
    expect(firstToken(undefined)).toBe('');
    expect(firstToken('   ')).toBe('');
  });
});

describe('subjectNormalizer.subjectsMatch', () => {
  test('exact match', () => {
    expect(subjectsMatch('русский язык', 'русский язык')).toBe(true);
  });

  test('case insensitive match', () => {
    expect(subjectsMatch('РУССКИЙ', 'русский')).toBe(true);
    expect(subjectsMatch('Русский Язык', 'русский язык')).toBe(true);
  });

  test('extra spaces insensitive', () => {
    expect(subjectsMatch('  Русский  ЯЗЫК ', 'русский язык')).toBe(true);
  });

  test('first-word fallback: "русский язык" vs "русский"', () => {
    expect(subjectsMatch('русский язык', 'Русский')).toBe(true);
    expect(subjectsMatch('Русский', 'русский язык')).toBe(true);
  });

  test('first-word fallback with case and spaces', () => {
    expect(subjectsMatch('  РУССКИЙ   язык  ', 'русский')).toBe(true);
  });

  test('Yo handling via subjectsMatch', () => {
    expect(subjectsMatch('мёд', 'мед')).toBe(true);
    expect(subjectsMatch('Ёлка', 'елка')).toBe(true);
    expect(subjectsMatch('Алёна', 'Алена')).toBe(true);
  });

  test('NFKC handling via subjectsMatch', () => {
    expect(subjectsMatch('е\u0308лка', 'елка')).toBe(true);
  });

  test('punctuation trailing dot stripped', () => {
    expect(subjectsMatch('Русский язык.', 'русский язык')).toBe(true);
    expect(subjectsMatch('Русский язык.', 'Русский')).toBe(true);
  });

  test('punctuation trailing comma stripped', () => {
    expect(subjectsMatch('Русский язык,', 'русский язык')).toBe(true);
  });

  test('Cyrillic upper/lower comprehensive', () => {
    expect(subjectsMatch('МАТЕМАТИКА', 'математика')).toBe(true);
    expect(subjectsMatch('ФиЗиКа', 'физика')).toBe(true);
  });

  test('different subjects → false', () => {
    expect(subjectsMatch('математика', 'физика')).toBe(false);
    expect(subjectsMatch('русский', 'математика')).toBe(false);
  });

  test('empty/null handling → false', () => {
    expect(subjectsMatch(null, 'русский')).toBe(false);
    expect(subjectsMatch('русский', null)).toBe(false);
    expect(subjectsMatch(null, null)).toBe(false);
    expect(subjectsMatch('', 'русский')).toBe(false);
    expect(subjectsMatch('русский', '')).toBe(false);
    expect(subjectsMatch('', '')).toBe(false);
    expect(subjectsMatch(undefined, 'русский')).toBe(false);
    expect(subjectsMatch('   ', 'русский')).toBe(false);
  });

  test('verify required CLI example: "русский язык" vs "Русский"', () => {
    expect(subjectsMatch('русский язык', 'Русский')).toBe(true);
  });

  test('hyphen: exact hyphen match true, hyphen vs space false unless first token equal', () => {
    expect(subjectsMatch('русский-язык', 'русский-язык')).toBe(true);
    // 'русский-язык' firstToken is 'русский-язык', not 'русский', so should be false
    expect(subjectsMatch('русский-язык', 'русский')).toBe(false);
  });
});
