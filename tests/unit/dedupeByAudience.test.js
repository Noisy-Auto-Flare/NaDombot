/**
 * P0 D2: дедуп только по полной аудитории, конфликт → keep max(updatedAt).
 */
const { _dedupeByAudience } = require('../../src/config/database');

describe('dedupeByAudience (P0 D2)', () => {
  test('дубли одной аудитории: остаётся max(updatedAt), id проигравшего в логе', () => {
    const rows = [
      { id: 1, dayOfWeek: 0, lessonNumber: 1, classId: '10А', trackId: null, subgroupId: null, updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 2, dayOfWeek: 0, lessonNumber: 1, classId: '10А', trackId: null, subgroupId: null, updatedAt: '2026-09-02T10:00:00.000Z' },
      { id: 3, dayOfWeek: 0, lessonNumber: 1, classId: '10А', trackId: 'tech', subgroupId: null, updatedAt: '2026-09-01T10:00:00.000Z' }
    ];
    const { kept, droppedIds } = _dedupeByAudience(rows);
    expect(kept.map((r) => r.id).sort()).toEqual([2, 3]);
    expect(droppedIds).toEqual([1]);
  });

  test('разные аудитории не схлопываются; legacy без classId — дефолт 10А', () => {
    const rows = [
      { id: 1, dayOfWeek: 0, lessonNumber: 2, updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 2, dayOfWeek: 0, lessonNumber: 2, classId: '10А', trackId: null, subgroupId: null, updatedAt: '2026-09-03T10:00:00.000Z' },
      { id: 3, dayOfWeek: 1, lessonNumber: 2, updatedAt: '2026-09-01T10:00:00.000Z' }
    ];
    const { kept, droppedIds } = _dedupeByAudience(rows);
    // 1 и 2 — одна аудитория (дефолт classId), побеждает 2; 3 — другой день
    expect(kept.map((r) => r.id).sort()).toEqual([2, 3]);
    expect(droppedIds).toEqual([1]);
  });

  test('без дублей — всё на месте', () => {
    const rows = [
      { id: 1, dayOfWeek: 0, lessonNumber: 1, classId: '10А', trackId: null, subgroupId: null, updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 2, dayOfWeek: 0, lessonNumber: 2, classId: '10А', trackId: null, subgroupId: null, updatedAt: '2026-09-01T10:00:00.000Z' }
    ];
    const { kept, droppedIds } = _dedupeByAudience(rows);
    expect(kept).toHaveLength(2);
    expect(droppedIds).toHaveLength(0);
  });
});
