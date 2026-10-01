/**
 * P2 item 1 — merge-рендер: склейка дублей/вариантов, теги, чанкинг 4000.
 * Чистые синхронные тесты, БД не нужна.
 */
const {
  formatHomework,
  formatHomeworkMerged,
  mergeHomeworkBySchedule,
  splitMessageChunks,
  MESSAGE_CHUNK_LIMIT
} = require('../../src/utils/scheduleUtils');
const { buildAudienceTag, shortTrackLabel, shortSubgroupLabel } = require('../../src/utils/audience');

const TAG_CTX = {
  template: '{track} · {subgroup}',
  showClass: false,
  maxSegments: 4,
  trackNames: new Map([
    ['tech', 'Технологический'],
    ['soc', 'Социально-экономический']
  ]),
  subgroupNames: new Map([
    ['belova', { name: 'Белова', teacher: 'Белова И.В.' }],
    ['petrova', { name: 'Петрова', teacher: 'Петрова А.С.' }]
  ])
};

function mkSchedule(over) {
  return {
    id: 1,
    lessonNumber: 1,
    subjectName: 'Биология',
    room: null,
    classId: '10А',
    trackId: null,
    subgroupId: null,
    ...over
  };
}

function mkHw(scheduleId, content, updatedAt = '2026-10-05T10:00:00.000Z') {
  return { scheduleId, content, updatedAt: new Date(updatedAt) };
}

describe('P2 merge-рендер', () => {
  test('дубли одного scheduleId: уникальные тексты через \\n\\n, без тегов', () => {
    const data = {
      date: new Date(2026, 9, 5, 12, 0, 0),
      schedules: [mkSchedule({ id: 7, lessonNumber: 6, subjectName: 'Биология', room: '3026' })],
      homeworks: [
        mkHw(7, 'стр. 42 упр. 5', '2026-10-04T10:00:00.000Z'),
        mkHw(7, 'стр. 42 упр. 5', '2026-10-04T11:00:00.000Z'),
        mkHw(7, 'повторить §12', '2026-10-04T12:00:00.000Z')
      ]
    };
    const text = formatHomeworkMerged(data, TAG_CTX);
    // дедуп: повтор встречается один раз
    expect(text.match(/стр\. 42 упр\. 5/g).length).toBe(1);
    expect(text).toContain('повторить §12');
    // разделитель — пустая строка между блоками
    expect(text).toContain('📝 стр. 42 упр. 5\n\n   📝 повторить §12');
    // общий урок без фасетов — тега нет
    expect(text).not.toContain('[');
    expect(text).toContain('6. Биология — каб. 3026');
  });

  test('варианты аудиторий: соседние строки, каждая с обязательным тегом', () => {
    const data = {
      date: new Date(2026, 9, 5, 12, 0, 0),
      schedules: [
        mkSchedule({ id: 11, lessonNumber: 2, subjectName: 'Информатика', room: '1058', trackId: 'tech' }),
        mkSchedule({ id: 12, lessonNumber: 2, subjectName: 'Обществознание', room: '3021', trackId: 'soc' })
      ],
      homeworks: [mkHw(11, 'сделать прогу', '2026-10-04T10:00:00.000Z'), mkHw(12, 'читать §3', '2026-10-04T11:00:00.000Z')]
    };
    const text = formatHomeworkMerged(data, TAG_CTX);
    expect(text).toContain('2. Информатика — каб. 1058 [Тех]');
    expect(text).toContain('2. Обществознание — каб. 3021 [Соц.-эконом.]');
    expect(text).toContain('📝 сделать прогу');
    expect(text).toContain('📝 читать §3');
  });

  test('английские подгруппы: теги Белова/Петрова', () => {
    const data = {
      date: new Date(2026, 9, 7, 12, 0, 0),
      schedules: [
        mkSchedule({ id: 21, lessonNumber: 3, subjectName: 'Английский', room: '4005', subgroupId: 'belova' }),
        mkSchedule({ id: 22, lessonNumber: 3, subjectName: 'Английский', room: 'библ', subgroupId: 'petrova' })
      ],
      homeworks: []
    };
    const text = formatHomeworkMerged(data, TAG_CTX);
    expect(text).toContain('3. Английский — каб. 4005 [Белова]');
    expect(text).toContain('3. Английский — каб. библ [Петрова]');
  });

  test('formatHomework — тот же merged-рендер (поведение OFF)', () => {
    const data = {
      date: new Date(2026, 9, 5, 12, 0, 0),
      schedules: [mkSchedule({ id: 11, lessonNumber: 2, subjectName: 'Информатика', room: '1058', trackId: 'tech' })],
      homeworks: [mkHw(11, 'текст')]
    };
    expect(formatHomework(data, TAG_CTX)).toBe(formatHomeworkMerged(data, TAG_CTX));
    expect(formatHomework(data, TAG_CTX)).toContain('[Тех]');
  });

  test('mergeHomeworkBySchedule: порядок по updatedAt', () => {
    const merged = mergeHomeworkBySchedule([
      mkHw(1, 'второе', '2026-10-04T12:00:00.000Z'),
      mkHw(1, 'первое', '2026-10-04T10:00:00.000Z')
    ]);
    expect(merged.get(1)).toEqual(['первое', 'второе']);
  });
});

describe('P2 теги audience', () => {
  test('дефолт [Тех · Белова] по шаблону {track} · {subgroup}', () => {
    const tag = buildAudienceTag({ classId: '10А', trackId: 'tech', subgroupId: 'belova' }, TAG_CTX, TAG_CTX);
    expect(tag).toBe('[Тех · Белова]');
  });

  test('пустые фасеты выпадают; общий урок — без тега', () => {
    expect(buildAudienceTag({ classId: '10А', trackId: null, subgroupId: null }, TAG_CTX, TAG_CTX)).toBe('');
    expect(buildAudienceTag({ classId: '10А', trackId: 'tech', subgroupId: null }, TAG_CTX, TAG_CTX)).toBe('[Тех]');
  });

  test('кастомный tags.template respected, showClass добавляет класс', () => {
    const custom = { ...TAG_CTX, template: '{subgroup}' };
    expect(buildAudienceTag({ classId: '10А', trackId: 'tech', subgroupId: 'belova' }, custom, custom)).toBe('[Белова]');
    const withClass = { ...TAG_CTX, template: '{class} · {track}', showClass: true };
    expect(buildAudienceTag({ classId: '10А', trackId: 'tech', subgroupId: null }, withClass, withClass)).toBe(
      '[10А · Тех]'
    );
  });

  test('fallback по голым id без lookups', () => {
    expect(buildAudienceTag({ trackId: 'tech', subgroupId: null }, {}, {})).toBe('[Тех]');
    expect(shortTrackLabel('unknown-track', null)).toBe('unknown-track');
    expect(shortSubgroupLabel('x', null, 'Сидорова А.А.')).toBe('Сидорова');
  });
});

describe('P2 чанкинг 4000', () => {
  test('лимит зафиксирован 4000 (не 4096)', () => {
    expect(MESSAGE_CHUNK_LIMIT).toBe(4000);
  });

  test('длинные тексты с тегами режутся на чанки ≤4000 без потерь', () => {
    const big = 'домашка '.repeat(600);
    const data = {
      date: new Date(2026, 9, 5, 12, 0, 0),
      schedules: [
        mkSchedule({ id: 11, lessonNumber: 2, subjectName: 'Информатика', room: '1058', trackId: 'tech' }),
        mkSchedule({ id: 12, lessonNumber: 2, subjectName: 'Обществознание', room: '3021', trackId: 'soc' })
      ],
      homeworks: [mkHw(11, big), mkHw(12, big)]
    };
    const text = formatHomeworkMerged(data, TAG_CTX);
    expect(text.length).toBeGreaterThan(4000);
    const parts = splitMessageChunks(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4000);
    // контент не потерян, порядок сохранён (разрез идёт внутри длинных строк)
    expect(parts.join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
  });

  test('короткий текст — один чанк', () => {
    expect(splitMessageChunks('привет')).toEqual(['привет']);
  });
});
