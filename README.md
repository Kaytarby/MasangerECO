# Эко-культура — мессенджер

Полноценный веб-мессенджер для сообщества садоводов: личные и групповые чаты в реальном времени, отправка фото, профили с аватарами и непрочитанные сообщения.

## Возможности

- 🔐 Регистрация и вход по номеру телефона (JWT-авторизация)
- 💬 Личные и групповые чаты в реальном времени (Socket.IO)
- 📷 Отправка фотографий (до 10 МБ, хранятся в `uploads/`)
- 🔍 Поиск по чатам и пользователям
- 📩 Счётчики непрочитанных сообщений и отметка «прочитано»
- 👤 Профиль: имя, «о себе», аватар
- 🔔 Браузерные уведомления о новых сообщениях (PWA-манифест + service worker)
- 📱 Адаптивный интерфейс (мобильные и десктоп)

## Стек

| Слой | Технологии |
|------|-----------|
| Фронтенд | React 19, Vite 6, Tailwind CSS 4, React Router, Socket.IO client |
| Бэкенд | Node.js, Express, Socket.IO |
| База данных | SQLite (`better-sqlite3`) — файл `eco_culture.db` создаётся автоматически |
| Авторизация | JWT + bcrypt |

## Быстрый старт

**Требуется:** Node.js 18+ (рекомендуется 22+)

```bash
# 1. Установить зависимости
npm install

# 2. Запустить (режим разработки, http://localhost:3000)
npm run dev
```

Сервер слушает порт `3000` (можно поменять переменной окружения `PORT`).

## Продакшен

```bash
npm run build   # соберёт фронтенд в dist/ и бэкенд в dist/server.cjs
npm start       # запустит node dist/server.cjs (NODE_ENV=production)
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `PORT` | `3000` | Порт HTTP-сервера |
| `JWT_SECRET` | встроенный fallback | Секрет для подписи JWT (задайте свой в продакшене!) |
| `DB_PATH` | `eco_culture.db` | Путь к файлу SQLite |

## API (кратко)

Все запросы, кроме `/api/auth/*` и `/api/health`, требуют заголовок `Authorization: Bearer <token>`.

| Метод | Путь | Назначение |
|-------|------|-----------|
| POST | `/api/auth/register` | Регистрация `{phone, password, name}` |
| POST | `/api/auth/login` | Вход `{phone, password}` |
| GET | `/api/auth/me` | Текущий пользователь |
| GET | `/api/users` | Список пользователей (кроме текущего) |
| PUT | `/api/users/profile` | Обновить профиль (multipart: `name`, `bio`, `avatar`) |
| GET | `/api/chats` | Чаты пользователя + счётчики непрочитанных |
| POST | `/api/chats` | Создать чат `{type: 'direct'\|'group', participantIds, name}` |
| GET | `/api/chats/:id/messages` | История сообщений |
| POST | `/api/chats/:id/messages` | Отправить сообщение (multipart: `text`, `image`) |
| POST | `/api/chats/:id/read` | Отметить чат прочитанным |
| GET | `/api/health` | Проверка работоспособности |

**Socket.IO:** клиент подключается с `auth: { token }`. Сервер шлёт событие `new_message` участникам чата; клиент эмитит `join_chat` при открытии чата.

## Структура проекта

```
server.ts                 — Express + Socket.IO + SQLite (весь бэкенд)
src/
  App.tsx                 — маршрутизация и защита маршрутов
  contexts/
    AuthContext.tsx       — состояние авторизации (JWT в localStorage)
    SocketContext.tsx     — socket.io-соединение
  pages/
    Login.tsx / Register.tsx — вход и регистрация
    Home.tsx              — список чатов, переписка, поиск
    ProfileSettings.tsx   — профиль и аватар
public/
  manifest.json, sw.js, favicon.svg — PWA
```
