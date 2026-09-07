# src/utils — KNOWLEDGE BASE

**Scope:** Pure logic: time, normalization, validation, formatting, scheduling.
**Files:** 16 (largest dir). Zero deps on Telegraf/Sequelize except `settings.js`, `cleanup.js`, `seedLessonTimes.js`.

## OVERVIEW
All Moscow-time, subject-matching, and schedule math lives here. Services/scenes import these; never the reverse.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Moscow wall-clock | `moscowTime.js` | `getMoscowNow()`, `parseHHMM`, `isTimeBetween`; only place with `Europe/Moscow` |
| Subject matching | `subjectNormalizer.js` | `normalizeSubject` (NFKC→trim→collapse→lower→ё→е→strip `.,;:!?`), `subjectsMatch` (+ firstToken fallback) |
| Current lesson | `lessonResolver.js` | `resolveCurrentLesson({now,scheduleRows,bellMap})` → `lesson|break|before|after`; schedule-aware boundaries |
| Bell message | `lessonFormatter.js` | `formatCurrentLessonMessage(result)` — room fallback `не указан` |
| Schedule search | `scheduleUtils.js` | `findNextLesson(subject,fromDate)` + `getHomeworkForDate/Week`, `formatHomework` |
| Weekly formatting | `scheduleFormatter.js` | `groupByDay`, `formatWeeklySchedule`, `formatScheduleForEdit` |
| Dates | `dateUtils.js` | `getDayOfWeek` (local TZ), `getDayName` (ru), `getNextWorkDay/WeekDates`; gotcha: not Moscow-safe |
| Validation | `scheduleValidator.js` | `parseLessonInput("<day> <num> <subject>")`, `parseRoomInput`; room `'-'`→null |
| Bell validation | `lessonTimeValidator.js` | `validateTimeRange`, `HHMM_REGEX`, `ValidationError` |
| Keyboards | `keyboards.js` | `manageScheduleKeyboard`, `cancelKeyboard` |
| Settings | `settings.js` | `getHomeworkVisibility` — `personal` vs `shared` via `Setting` KV |
| Cleanup | `cleanup.js` | `cleanupOldHomeworks` deletes `date < today` |
| Seed bells | `seedLessonTimes.js` | `seedLessonTimes()` 10 defaults 08:30-18:10 if empty |

## CONVENTIONS
- Pure functions + JSDoc; throw on invalid input (`Error` or `ValidationError`), never return sentinel.
- Time strings always `HH:MM` zero-padded; `parseHHMM` throws on bad format, normalizes midnight `24→0`.
- `dayOfWeek` 0=Mon … 6=Sun everywhere (not `Date.getDay()`). Use `getMoscowDayOfWeek()` for "now", `getDayOfWeek(date)` only for historical/date-loop logic.
- Never touch `Europe/Moscow` outside `moscowTime.js`; import its helpers.

## ANTI-PATTERNS
- Do not compare subjects with `===` — use `subjectsMatch` (handles `Русский` = `русский`, `Ё`, firstToken `русский язык`→`русский`).
- Do not parse bell `HH:MM-HH:MM` inline — use `manageScheduleHelpers.parseBellInput` + `validateTimeRange`.
- Do not add homework without `findNextLesson` — it resolves `scheduleId` + `date`; raw `Schedule.findOne WHERE subjectName` will miss Cyrillic variants.
- Do not use `dateUtils.getDayOfWeek(new Date())` for "current lesson" — it uses host TZ; use `moscowTime.getMoscowNow()`.

## NOTES
- `lessonResolver` accepts `now` as `Date|string|{hours,minutes,dayOfWeek}|{hhmm}` for testability; normalizes via `parseHHMM`.
- `schedule-aware` logic: `before`/`after` use `firstScheduled`/`lastScheduled` (today's scheduled bells), not raw `bells[0]/bells[last]`.
- Bell defaults from photo: 1 08:30-09:15, 2 09:25-10:10, 3 10:25-11:10, 4 11:20-12:05, 5 12:25-13:10, 6 13:30-14:15, 7 14:25-15:10, 8 15:25-16:10, 9 16:25-17:10, 10 17:25-18:10.
```
