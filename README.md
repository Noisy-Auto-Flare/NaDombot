# Telegram Бот-Дневник для Домашнего Задания

Telegram-бот для ведения домашнего задания по школьному расписанию. Node.js, SQLite, Docker Compose.

## Быстрый старт

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `ADMIN_ID`.
2. Запуск: `docker compose up -d --build`
3. Бот в Telegram: `/start`

Данные — в томе `sqlite_data` (файл `/app/data/db.sqlite` внутри контейнера).

Обновление без потери данных:

```bash
docker compose up -d --build
```

> ⚠️ Никогда не используйте `docker compose down -v` — флаг `-v` удаляет том `sqlite_data` и базу.

---

## Миграция с Postgres (если сервер ещё на Postgres)

Проект переведён на SQLite-only. Если сервер ещё работает на старом `docker-compose.yml` с Postgres, перенесите данные через `backup.json` (3 таблицы, скрипты `scripts/export-db.js` / `scripts/import-db.js` уже в репозитории).

### Шаг 1 — Экспорт на старом сервере (до обновления кода)

На сервере, где ещё Postgres:

```bash
docker compose exec bot node scripts/export-db.js > backup.json
# проверьте: cat backup.json | head -20  — должен быть JSON с schedules/homeworks
```

### Шаг 2 — Обновление кода

```bash
git pull
```

После `git pull` `docker-compose.yml` уже SQLite-only, `docker-compose.sqlite.yml` удалён (legacy).

### Шаг 3 — Запуск на SQLite

```bash
docker compose up -d --build
```

Том `sqlite_data` создастся автоматически. Старый том `postgres_data` останется на диске, но больше не используется — удаляйте вручную только когда убедитесь, что миграция прошла:

```bash
# только после успешной проверки бота!
docker volume ls | grep postgres
# docker volume rm <имя_postgres_toma>
```

### Шаг 4 — Импорт

```bash
docker compose exec -T bot node scripts/import-db.js --yes < backup.json
```

Без `--yes` скрипт только печатает, что будет импортировано, и не меняет данные. Импорт полностью заменяет расписание и домашние задания в целевой БД.

---

## Если контейнер постоянно перезапускается

1. Проверьте логи: `docker compose logs bot`
2. Если ошибка про права доступа к `/app/data`:
   ```bash
   docker compose down
   # Удалите том (данные потеряются!) — только если это новая установка
   docker volume rm tgdomashkabot_sqlite_data
   docker compose up -d --build
   ```
3. Или исправьте права вручную (если нужно сохранить данные):
   ```bash
   docker compose run --rm --user root bot chown -R nodejs:nodejs /app/data
   ```

Остановка:

```bash
docker compose down
```

---

## Переменные окружения (.env)

- `BOT_TOKEN` — токен от @BotFather
- `ADMIN_ID` — Telegram ID (например, @userinfobot)
- `NODE_ENV` — по желанию (`production` по умолчанию)
- `SQLITE_PATH` — путь к файлу внутри контейнера (по умолчанию `/app/data/db.sqlite`, уже задан в `docker-compose.yml`; переопределяйте только если меняете volume)

---

## Legacy: почему Postgres удалён

Ранее проект использовал Postgres с тонкой настройкой (`shared_buffers=16MB`, `bgwriter_delay=1000ms`, `autovacuum_naptime=15min` и т.д.), чтобы снизить фоновую нагрузку на VPS 1 vCPU/1 GB RAM. Postgres даже в простое держит фоновые процессы (bgwriter, checkpointer, autovacuum, stats collector), которые периодически просыпаются и дают заметный CPU. SQLite не держит фоновых процессов и в простое почти не тратит CPU/RAM — поэтому оставлен только SQLite. Подробности старой настройки — в истории git.

## Legacy файлы

- `docker-compose.sqlite.yml` — удалён. Теперь `docker-compose.yml` и есть SQLite-вариант. Если на сервере есть скрипты с `-f docker-compose.sqlite.yml`, замените на `docker compose up -d --build`.
