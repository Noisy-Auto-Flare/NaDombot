# src/scenes — KNOWLEDGE BASE

**Scope:** Telegraf WizardScene flows: homework entry + schedule/bell admin.
**Files:** `addHomeworkScene.js` (196 LOC), `manageScheduleScene.js` (120), `helpers/manageScheduleHelpers.js` (249).

## OVERVIEW
Two wizards registered in `src/index.js` via `Scenes.Stage([addHomeworkScene, manageScheduleScene])`. All state in `ctx.wizard.state`.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Add homework 3-step | `addHomeworkScene.js` | step1 subject → `findNextLesson` → step2 confirm → step3 `Homework.create` |
| Schedule hub | `manageScheduleScene.js` | step1 menu, step2 `schedule_*` dispatch, step3 `ctx.wizard.state.action` router |
| 7 handlers | `helpers/manageScheduleHelpers.js` | `handleAdd/AddRoom/Edit/EditRoom/Delete/BellSelect/BellTime` + `parseBellInput` |
| Keyboards | `../utils/keyboards.js` | `manageScheduleKeyboard`, `cancelKeyboard`, `backKeyboard` |
| Validation | `../utils/scheduleValidator.js` | `parseLessonInput`, `parseRoomInput` |
| Services | `../services/scheduleService.js`, `../services/LessonTimeService.js` | DB boundary, throw `SLOT_TAKEN`/`NOT_FOUND` |

## STRUCTURE
```
scenes/
├── addHomeworkScene.js        # WizardScene('addHomework') — 3 steps
├── manageScheduleScene.js     # WizardScene('manageSchedule') — 3 steps + action router
└── helpers/
    └── manageScheduleHelpers.js  # 7 handlers, ROOM_PROMPT, parseBellInput
```

## CONVENTIONS
- Wizard state keys: `action` (`add`|`add_room`|`edit`|`edit_select`|`delete`|`edit_bells_select|time`|`edit_room`), `pending`/`pendingEdit` (parsed lesson), `editId`, `bellLessonNumber`, `scheduleId`/`date`/`subjectName` (homework flow).
- Input format for lessons: `"<day> <lessonNumber> <subject>"` e.g. `0 1 Математика` — parsed by `parseLessonInput`, validated day 0-6, lesson 1-10.
- Room flow: after parsed lesson, prompt `ROOM_PROMPT` → `parseRoomInput`; `'-'`/empty → `null`; max 20 chars.
- Bell flow: `edit_bells` → prompt 1-10 → `parseBellInput` (normalizes `–/—`→`-`) → `validateTimeRange` → `LessonTimeService.upsert`.
- All replies include `cancelKeyboard` (step cancel) or `backKeyboard` (return to hub); `back_to_menu` always `ctx.scene.leave()`.
- Admin guard: `isAdmin(ctx)` at entry + per `edit_bells`; non-admin `answerCbQuery('❌ …')` + leave.

## ANTI-PATTERNS
- Do not read `ctx.wizard.state` without null-check — helpers check `pending`/`pendingEdit`/`editId` and reply `Сессия истекла`.
- Do not throw from `parseLessonInput` without catching — scenes catch and reply `e.message` with `cancelKeyboard`, stay on step.
- Do not bypass `scheduleService.isSlotTaken` — helpers check slot before `create`/`update`; service also throws `SLOT_TAKEN` with `.existing`.
- Do not call `LessonTimeService.upsert` without `validateTimeRange` — helpers validate first, catch `ValidationError` separately.
```
