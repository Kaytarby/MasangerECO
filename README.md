# Эко-культура — мессенджер

Веб-мессенджер для сообщества садоводов: личные и групповые чаты, отправка фотографий, профили с аватарами, поиск и счётчики непрочитанных сообщений. Готов как к облачному деплою на **Vercel + Supabase**, так и к локальному запуску или запуску в **Docker** с SQLite.

## Возможности

- Регистрация и вход по номеру телефона (JWT + bcrypt)
- Личные и групповые чаты с автообновлением сообщений
- Отправка фотографий с автоматическим сжатием больших снимков на клиенте
- Поиск по чатам и пользователям
- Счётчики непрочитанных сообщений и отметка «прочитано»
- Профиль: имя, «о себе», аватар
- Браузерные уведомления (PWA-манифест + service worker)
- Адаптивный интерфейс (мобильные и десктоп)

## Стек

| Слой | Технологии |
|------|-----------|
| Фронтенд | React 19, TypeScript, Vite 6, Tailwind CSS 4, React Router 7 |
| Бэкенд (Vercel) | Vercel Serverless Function (`api/index.ts`, Express) + smart polling |
| Бэкенд (локально / Docker) | Node.js, Express, Socket.IO (`server.ts`) |
| База и файлы (облако) | Supabase PostgreSQL + Supabase Storage (`eco-uploads`) |
| База и файлы (локально) | SQLite (`node:sqlite`, `eco_culture.db`) + папка `uploads/` |

## Деплой на Vercel + Supabase

1. **Подготовьте базу в Supabase** (для постоянного хранения данных):
   - Откройте ваш проект в **Supabase → SQL Editor → New query**.
   - Вставьте содержимое файла [`supabase/schema.sql`](supabase/schema.sql) и нажмите **Run** (создадутся таблицы `eco_*` с RLS и публичный бакет `eco-uploads`).
   - В **Project Settings → API** скопируйте **Project URL** и ключ **`service_role`** (secret).
2. **Импортируйте проект в Vercel**:
   - Откройте **vercel.com → Add New → Project** и выберите репозиторий `Kaytarby/MasangerECO`.
   - Настройки сборки подтянутся автоматически из `vercel.json` (`Framework: Vite`, `Build Command: npm run build:web`, `Output Directory: dist`).
   - В разделе **Environment Variables** добавьте:
     - `SUPABASE_URL` — URL проекта Supabase
     - `SUPABASE_SERVICE_ROLE_KEY` — ключ `service_role` (secret) из Supabase
     - `JWT_SECRET` — любая длинная случайная строка (например, 32+ символа)
   - Нажмите **Deploy**.

> Если задеплоить без переменных Supabase, приложение всё равно запустится в демо-режиме (временное хранилище) и покажет подсказку вверху экрана. После добавления переменных сделайте **Redeploy**.

## Локальный запуск

**Требуется:** Node.js 22+

```bash
npm install
npm run dev      # http://localhost:3000 (SQLite или Supabase, если задан .env)
```

Продакшен-сборка для своего сервера / Docker:

```bash
npm run build    # фронт → dist/, сервер → build-server/server.cjs
npm start        # запуск на PORT (по умолчанию 3000)
```

Проверка E2E (при запущенном сервере):

```bash
npm run test:e2e
```

## Переменные окружения

| Переменная | Где нужна | Описание |
|------------|-----------|----------|
| `SUPABASE_URL` | Vercel / прод | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel / прод | Сервисный ключ Supabase (`service_role` / `secret`) |
| `JWT_SECRET` | Везде | Секрет для подписи JWT-токенов |
| `PORT` | Локально / Docker | Порт HTTP-сервера (по умолчанию `3000`) |
| `DB_PATH` | Локально / Docker | Путь к файлу SQLite (по умолчанию `eco_culture.db`) |
| `UPLOADS_DIR` | Локально / Docker | Папка для загрузок (по умолчанию `uploads`) |

## Структура проекта

```
api/index.ts              — Serverless-функция для Vercel
vercel.json               — Конфигурация сборки и маршрутизации Vercel
supabase/schema.sql       — SQL-схема таблиц и бакета Storage для Supabase
server.ts                 — Локальный / Docker сервер (Express + Socket.IO + Vite/dist)
server/
  createApp.ts            — Общие REST API маршруты, авторизация и загрузка фото
  supabaseStore.ts        — Хранилище Supabase (PostgreSQL + Storage)
  sqliteStore.ts          — Локальное хранилище SQLite + uploads/
  demoStore.ts            — Временное демо-хранилище (fallback без Supabase)
  types.ts                — Общие типы
src/                      — Фронтенд (React 19 + Tailwind CSS 4)
scripts/e2e-test.mjs      — Сквозной тест API и чатов
```
