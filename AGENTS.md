# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-07
**Commit:** 5ee3abb (main)
**Branch:** main

## OVERVIEW
Telegram bot-diary for homework (school 10a). Node.js 20 + Telegraf 4 + Sequelize 6 + SQLite, Docker Compose. Single admin manages weekly schedule + bell times; all users add/view homework, Moscow timezone (Europe/Moscow) hardcoded.

## STRUCTURE
```
./
├── src/index.js           # bootstrap: DB + cleanup + bot.launch
├── src/config/            # bot (Telegraf), database (Sequelize/sqlite)
├── src/models/            # Schedule, Homework, Setting, LessonTime
├── src/services/          # scheduleService, LessonTimeService (DB boundary)
├── src/handlers/          # commands.js — all reply/callback handlers
├── src/scenes/            # WizardScene: addHomework, manageSchedule
│   └── helpers/           # manageScheduleHelpers — 7 handlers
├── src/utils/             # pure logic: 14 modules (moscowTime, normalizer, etc.)
├── src/middleware/        # isAdmin
├── scripts/               # export-db, import-db, seed-10a-schedule
├── tests/                 # unit + integration (jest, no coverage)
├── data/                  # db.sqlite (volume sqlite_data)
└── docker-compose.yml     # single service `bot`, restart unless-stopped
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add homework flow | `src/scenes/addHomeworkScene.js` | 3-step wizard: subject → findNextLesson → content |
| Manage schedule / bells | `src/scenes/manageScheduleScene.js` + `src/scenes/helpers/manageScheduleHelpers.js` | add/edit/delete/view + edit_bells |
| Schedule CRUD / subject search | `src/services/scheduleService.js` | `findBySubjectNormalized`, `isSlotTaken`, sanitize |
| Bell times CRUD | `src/services/LessonTimeService.js` | `getBellScheduleMap()`, `upsert` 1-10 |
| "Current lesson" resolution | `src/utils/lessonResolver.js` + `src/utils/lessonFormatter.js` | Moscow time → status: lesson/break/before/after |
| Moscow wall-clock | `src/utils/moscowTime.js` | `Intl.DateTimeFormat` Europe/Moscow, `parseHHMM`, `isTimeBetween` |
| Subject matching | `src/utils/subjectNormalizer.js` | NFKC, lower, ё→е, collapse spaces, strip `.,;:!?`, firstToken fallback |
| Room / lesson validation | `src/utils/scheduleValidator.js`, `src/utils/lessonTimeValidator.js` | `parseLessonInput`, `validateTimeRange` |
| Homework visibility toggle | `src/utils/settings.js` + `src/models/Setting.js` | `personal` vs `shared` via `Setting` key |
| Weekly/ завтра formatting | `src/utils/scheduleUtils.js`, `src/utils/scheduleFormatter.js`, `src/utils/dateUtils.js` | `getHomeworkForDate/Week`, `formatWeeklySchedule` |
| DB init + broken-schema fix | `src/config/database.js` | detects `UNIQUE(dayOfWeek)` legacy, drops index, `sync({alter:true})` |
| Keyboards | `src/utils/keyboards.js` | `manageScheduleKeyboard`, `cancelKeyboard` |
| Daily cleanup | `src/utils/cleanup.js` | deletes `date < today` on startup |
| Seed 10 bells | `src/utils/seedLessonTimes.js` | 10 defaults 08:30-18:10 → `LessonTime.bulkCreate` |
| Docker / prod | `docker-compose.yml`, `Dockerfile` | `USE_SQLITE=true`, volume `sqlite_data:/app/data` |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `startBot` | fn | `src/index.js` | DB connect → sync → cleanup → bot.launch, SIGINT/SIGTERM |
| `bot` | Telegraf | `src/config/bot.js` | `Telegraf(BOT_TOKEN)` + `session()` middleware |
| `sequelize` | Sequelize | `src/config/database.js` | `dialect:sqlite`, `pool max:1`, `testConnection`/`syncDatabase` |
| `Schedule` | Model | `src/models/Schedule.js` | `dayOfWeek 0-6`, `lessonNumber 1-10`, `subjectName`, `room?`, unique `(dayOfWeek,lessonNumber)` |
| `Homework` | Model | `src/models/Homework.js` | `userId BIGINT`, `scheduleId`, `date DATEONLY`, `content TEXT`, idx on `[userId,date,scheduleId]` |
| `LessonTime` | Model | `src/models/LessonTime.js` | PK `lessonNumber 1-10`, `startTime`/`endTime` HH:MM, validate `end>start` |
| `Setting` | Model | `src/models/Setting.js` | KV `key`/`value` — homework visibility |
| `scheduleService` | service | `src/services/scheduleService.js` | CRUD + `findBySubjectNormalized` (subjectsMatch), sanitizers |
| `LessonTimeService` | service | `src/services/LessonTimeService.js` | `findAllOrdered`, `getBellScheduleMap()` |
| `handleStart/handleHelp/...` | handlers | `src/handlers/commands.js` | 8 exported handlers, admin-gated via `isAdmin(ctx)` |
| `resolveCurrentLesson` | fn | `src/utils/lessonResolver.js:19` | core: `now` (flex) + `scheduleRows` + `bellMap` → `{status, nextLesson,…}` |
| `formatCurrentLessonMessage` | fn | `src/utils/lessonFormatter.js` | renders lesson/break/before/after, room fallback `не указан` |
| `normalizeSubject/subjectsMatch` | fns | `src/utils/subjectNormalizer.js` | Cyrillic-safe, firstToken fallback |
| `getMoscowNow/parseHHMM` | fns | `src/utils/moscowTime.js` | Intl-based, midnight 24→0 fix |
| `isAdmin` | fn | `src/middleware/isAdmin.js` | `ctx.from.id.toString() === process.env.ADMIN_ID` |
| `addHomeworkScene` | WizardScene | `src/scenes/addHomeworkScene.js` | `addHomework` 3 steps |
| `manageScheduleScene` | WizardScene | `src/scenes/manageScheduleScene.js` | `manageSchedule` 3 steps, delegates to helpers |
| `seedLessonTimes` | fn | `src/utils/seedLessonTimes.js:28` | seeds 10 lessons if empty |

## CONVENTIONS
- **Language:** CommonJS `require`, JS (no TS), `/** jsdoc */` on pure utils. No ESM, no transpilation.
- **Validation throws, services throw `Error('SLOT_TAKEN'|'NOT_FOUND')`** with `.existing` attached — scenes catch by `error.message`.
- **Subject normalization everywhere:** `subjectNormalizer` used in `scheduleService.findBySubjectNormalized` and `scheduleUtils.findNextLesson`. Never raw `===`.
- **Room: `'-'` or empty → `null`.** `sanitizeRoom` / `parseRoomInput` canonicalize; display `— каб. 304` or `не указан`.
- **Moscow time isolated:** only `utils/moscowTime.js` touches `Europe/Moscow`; elsewhere use `getMoscowNow()` / `getMoscowDayOfWeek()`. `dateUtils.getDayOfWeek` is local-TZ fallback, not for current-lesson.
- **Error handling:** `console.error` + user-facing reply `❌ … Попробуйте позже.`; never swallow.
- **Sequelize sync, not migrations:** `sequelize.sync({alter:true})` + broken-schema auto-repair in `config/database.js`. No migration files.
- **Wizard state:** `ctx.wizard.state.action` drives step 3 dispatch (`add`, `add_room`, `edit`, `edit_room`, `delete`, `edit_bells_*`). `pending` / `pendingEdit` hold parsed lesson.
- **Bell parsing:** `manageScheduleHelpers.parseBellInput` normalizes `–/—` → `-`, splits `-` or space.

## ANTI-PATTERNS (THIS PROJECT)
- **Never `docker compose down -v`** — deletes `sqlite_data` volume. Use `down` (no `-v`) + `up -d --build`.
- **Never add Postgres deps** — SQLite-only since `refactor` commit. No `pg`, no `docker-compose.sqlite.yml` (deleted).
- **Do not use `as any` / `@ts-ignore`** — project is plain JS with `eslint:recommended`; suppressions hide real bugs.
- **Do not query schedules with raw `WHERE subjectName = ?`** — always via `subjectsMatch` / `findBySubjectNormalized` (Cyrillic case + firstToken).
- **Do not touch `Europe/Moscow` outside `moscowTime.js`.** Use its helpers; host TZ may be UTC.
- **Do not create indexes on single `dayOfWeek`/`lessonNumber` UNIQUE** — breaks multi-day schedule; only composite `unique_lesson_per_day`.
- **Do not add homework without `findNextLesson` resolution** — homework requires valid `scheduleId`.

## UNIQUE STYLES
- Cyrillic comments throughout, emojis in replies (`📚`, `🏫`, `🔔`, `✅/❌`), Russian UI strings.
- `eslint.config.js`: `no-unused-vars` warn with `^_` ignore, `no-empty allowEmptyCatch:false`, `prefer-const warn`, `no-var error`; ignores `node_modules/** data/** coverage/** .omo/**`.
- `.editorconfig`: `indent_size 2`, `end_of_line lf`, `charset utf-8`, `max_line_length 120`, `[*.md] trim_trailing_whitespace false`.
- `.prettierrc`: `semi true singleQuote true trailingComma none printWidth 120 tabWidth 2`.
- Bell defaults rooted in photo schedule: 1 08:30-09:15 … 10 17:25-18:10, break 15 min after lesson 7.

## COMMANDS
```bash
npm start              # node src/index.js (prod, sync + launch)
npm run dev            # nodemon src/index.js
npm run lint           # eslint src scripts
npm run format         # prettier --write .
npm test               # jest --coverage=false
npm run test:watch     # jest --watch
npm run export-db      # node scripts/export-db.js > backup.json
npm run import-db      # node scripts/import-db.js --yes < backup.json

docker compose up -d --build   # build + start (preserves sqlite_data)
docker compose logs bot        # debug restart loops / permission errors
docker compose down            # stop (no -v!)
```

## NOTES
- Env: `BOT_TOKEN` (required, throws if missing), `ADMIN_ID` (string compare), `SQLITE_PATH` default `/app/data/db.sqlite` or `./data/db.sqlite`, `NODE_ENV` toggles Sequelize logging.
- `ADMIN_ID` may be string/number; `isAdmin` compares `toString()`. Only admin sees `⚙️ Управление расписанием` and `👥 Режим`.
- Gotcha: `Schedule.sync()` auto-repair recreates table if old `UNIQUE(dayOfWeek)` / `UNIQUE(lessonNumber)` detected; backs up rows deduplicated by `dayOfWeek-lessonNumber`.
- Gotcha: `lessonResolver` has schedule-aware `firstScheduled`/`lastScheduled` — `before`/`after` boundaries use scheduled lessons, not pure bell range.
- Gotcha: `Homework` date is `DATEONLY` string `YYYY-MM-DD`; `cleanupOldHomeworks` deletes `< today` (midnight) on every boot.
- Gotcha: `scripts/seed-10a-schedule.js` filters seed to tech profile T only (10a).
```
