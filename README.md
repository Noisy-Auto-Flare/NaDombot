# Telegram Бот-Дневник для Домашнего Задания

Telegram-бот для ведения домашнего задания по школьному расписанию. Node.js, PostgreSQL или SQLite, Docker Compose.

## Быстрый старт

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `ADMIN_ID`.
2. Запуск: `docker compose up -d --build`
3. Бот в Telegram: `/start`

---

## Почему Postgres грузит CPU, когда бот простаивает

Даже без запросов от приложения Postgres держит фоновые процессы, которые периодически просыпаются:

| Процесс | Что делает | Почему даёт нагрузку |
|--------|------------|----------------------|
| **bgwriter** | Сбрасывает буферы на диск | По умолчанию проверяет каждые **200 ms** → до 5 раз в секунду. На 1 vCPU это даёт заметный «средний» CPU. |
| **checkpointer** | Записывает checkpoint (снимок данных) | Обычно каждые 5 минут, но при нагрузке — чаще. |
| **autovacuum launcher** | Решает, когда запускать vacuum/analyze | Просыпается по `autovacuum_naptime` (по умолчанию 1 мин). |
| **autovacuum worker** | Чистит мёртвые строки, обновляет статистику | На маленьких таблицах срабатывает часто: достаточно 10–20% изменений (`autovacuum_analyze_scale_factor=0.1`). |
| **stats collector** | Собирает статистику | Постоянная фоновая активность. |

На VPS с 1 vCPU и 1 GB RAM каждое такое пробуждение даёт всплеск CPU; в `docker stats` это выглядит как почти постоянные десятки процентов, даже если бот не используется.

---

## Что изменено в конфигурации Postgres

Чтобы снизить нагрузку в простое:

- **bgwriter**: `bgwriter_delay=1000ms` (реже, чем 200 ms), `bgwriter_lru_maxpages=5` — меньше записей за раз.
- **checkpoint**: `checkpoint_timeout=30min` — реже, чем 5 мин.
- **autovacuum**:  
  - `autovacuum_naptime=15min` — реже проверки;  
  - `autovacuum_vacuum_scale_factor=0.5`, `autovacuum_analyze_scale_factor=0.25` — реже срабатывает на маленьких таблицах;  
  - `autovacuum_vacuum_cost_delay=50ms` — vacuum и analyze работают «мягче».
- **Память и соединения**: `shared_buffers=16MB`, `work_mem=512kB`, `max_connections=10`.
- **Пул в приложении**: в Sequelize `pool.max` для Postgres уменьшен до 2 — меньше лишних соединений.

После правок пересоздайте контейнер Postgres, чтобы применить `command` и лимиты:

```bash
docker compose down
docker compose up -d --build
```

---

## Вариант на SQLite (почти нет нагрузки в простое)

SQLite не держит фоновых процессов (autovacuum, bgwriter, checkpointer и т.п.), в простое CPU и RAM почти не использует.

Запуск **только бота** с SQLite (без Postgres):

```bash
docker compose -f docker-compose.sqlite.yml up -d --build
```

Данные — в томе `sqlite_data` (файл `/app/data/db.sqlite`). Обновление без потери данных:

```bash
docker compose -f docker-compose.sqlite.yml pull
docker compose -f docker-compose.sqlite.yml up -d --build
```

---

## Переключение между Postgres и SQLite без потери данных

Данные в Postgres (том `postgres_data`) и в SQLite (том `sqlite_data`) хранятся по-разному. При смене варианта (другой `docker-compose` или другие переменные) **автоматического переноса нет** — нужно один раз экспорт и импорт.

### 1. Экспорт из текущей БД (в файл на хосте)

**Если бот на Postgres:**
```bash
docker compose exec bot node scripts/export-db.js > export.json
```

**Если бот на SQLite:**
```bash
docker compose -f docker-compose.sqlite.yml exec bot node scripts/export-db.js > export.json
```

### 2. Остановка и запуск на другой БД

Пример: перейти с Postgres на SQLite.

```bash
# Остановить текущий вариант (без -v, тома не трогаем)
docker compose down

# Запустить на SQLite
docker compose -f docker-compose.sqlite.yml up -d --build
```

### 3. Импорт в новую БД

**Если теперь бот на Postgres:**
```bash
docker compose exec -T bot node scripts/import-db.js --yes < export.json
```

**Если теперь бот на SQLite:**
```bash
docker compose -f docker-compose.sqlite.yml exec -T bot node scripts/import-db.js --yes < export.json
```

Импорт **полностью заменяет** расписание и домашние задания в целевой БД. Без `--yes` скрипт только печатает, что будет импортировано, и не меняет данные.

Итого: можно периодически переключаться с одной базы на другую, каждый раз делая экспорт → смену compose → импорт, без потери данных.

---

## Обновление без потери данных (Postgres)

Том `postgres_data` не удаляется при `docker compose down` (без `-v`). Чтобы обновить образы и код:

```bash
docker compose pull
docker compose up -d --build
```

Не используйте `docker compose down -v` — `-v` удаляет тома и базу.

---

## Остановка

**Postgres-вариант:**
```bash
docker compose down
```

**SQLite-вариант:**
```bash
docker compose -f docker-compose.sqlite.yml down
```

---

## Переменные окружения (.env)

**Общие:**
- `BOT_TOKEN` — токен от @BotFather  
- `ADMIN_ID` — Telegram ID (например, @userinfobot)  
- `NODE_ENV` — по желанию

**Postgres (если не USE_SQLITE):**
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` — при необходимости переопределите значения по умолчанию.

**SQLite (вариант `docker-compose.sqlite.yml`):**
- `USE_SQLITE=true` — уже задано в compose.  
- `SQLITE_PATH` — путь к файлу (в compose: `/app/data/db.sqlite`).

---

## Если контейнер Postgres падает с OOM

Увеличьте лимит в `docker-compose.yml`, например: `mem_limit: 384m`.
