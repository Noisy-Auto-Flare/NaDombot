# Telegram Бот-Дневник для Домашнего Задания

Telegram-бот для ведения домашнего задания по школьному расписанию. Node.js, PostgreSQL, Docker Compose.

## Быстрый старт

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `ADMIN_ID`.
2. Запуск: `docker compose up -d --build`
3. Бот в Telegram: `/start`

## Обновление без потери данных

Данные хранятся в томе `postgres_data`. Чтобы обновить код и образы и не потерять БД:

```bash
docker compose pull
docker compose up -d --build
```

Не используйте `docker compose down -v` — флаг `-v` удаляет тома и базу. Для остановки достаточно `docker compose down` (без `-v`).

## Остановка

```bash
docker compose down
```

## Postgres и нагрузка на VPS

В `docker-compose.yml` для Postgres заданы лимиты (`mem_limit: 256m`) и параметры под малую нагрузку (бот, 1–2 соединения). Если контейнер падает с OOM, увеличьте, например: `mem_limit: 384m`.

## Переменные окружения (.env)

- `BOT_TOKEN` — токен от @BotFather  
- `ADMIN_ID` — Telegram ID администратора (например, от @userinfobot)  
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` — при необходимости переопределите значения по умолчанию
