import crypto from 'crypto';
import express, { Express, NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { AppError, MessageRecord, StorageAdapter } from './types.js';

export type RealtimeMode = 'socket.io' | 'polling';

export interface CreateAppOptions {
  store: StorageAdapter;
  realtime: RealtimeMode;
  maxUploadBytes?: number;
  jwtSecret?: string;
  onMessageCreated?: (message: MessageRecord, participantIds: number[]) => void;
}

export function resolveJwtSecret(): string {
  const explicit = (process.env.JWT_SECRET || '').trim();
  if (explicit) return explicit;

  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();
  if (serviceKey) {
    return crypto.createHmac('sha256', serviceKey).update('masanger-eco-jwt-v1').digest('hex');
  }

  return 'eco_culture_super_secret_key';
}

const normalizePhone = (phone: string) => (phone || '').replace(/\D/g, '');

const parsePositiveInt = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const asyncRoute =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function createApiApp(options: CreateAppOptions): Express {
  const {
    store,
    realtime,
    maxUploadBytes = 10 * 1024 * 1024,
    jwtSecret = resolveJwtSecret(),
    onMessageCreated,
  } = options;

  const maxUploadMb = Math.round((maxUploadBytes / (1024 * 1024)) * 10) / 10;
  const app = express();

  // Normalize URLs rewritten by Vercel (e.g. /api?__path=chats/1/messages or /api/index?__path=...)
  app.use((req, _res, next) => {
    const qIndex = req.url.indexOf('?');
    const pathname = qIndex >= 0 ? req.url.slice(0, qIndex) : req.url;
    const rawQuery = qIndex >= 0 ? req.url.slice(qIndex + 1) : '';

    if (pathname === '/api' || pathname === '/api/' || pathname === '/api/index') {
      const params = new URLSearchParams(rawQuery);
      const parts = params.has('__path')
        ? params.getAll('__path')
        : params.has('path')
          ? params.getAll('path')
          : [];
      const rewrittenPath = parts.join('/').replace(/^\/+/, '');
      if (rewrittenPath) {
        params.delete('__path');
        params.delete('path');
        const rest = params.toString();
        req.url = `/api/${rewrittenPath}${rest ? '?' + rest : ''}`;
      }
    } else if (!pathname.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new AppError(400, 'Можно загружать только изображения'));
      }
    },
  });

  const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    jwt.verify(token, jwtSecret, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Недействительный токен' });
      req.user = user;
      next();
    });
  };

  // Health & runtime mode info
  app.get(
    '/api/health',
    asyncRoute(async (_req, res) => {
      const health = await store.checkHealth();
      res.json({
        ...health,
        realtime,
        maxUploadBytes,
        time: new Date().toISOString(),
      });
    })
  );

  // Auth routes
  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const { phone, password, name } = req.body || {};
      const normalized = normalizePhone(String(phone || ''));
      const trimmedName = String(name || '').trim();
      const rawPassword = String(password || '');

      if (!normalized || !rawPassword || !trimmedName) {
        return res.status(400).json({ error: 'Заполните все поля' });
      }
      if (normalized.length < 5) {
        return res.status(400).json({ error: 'Некорректный номер телефона' });
      }
      if (rawPassword.length < 4) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 4 символа' });
      }

      const hash = await bcrypt.hash(rawPassword, 10);
      const user = await store.createUser(normalized, hash, trimmedName);
      const token = jwt.sign(
        { id: user.id, phone: user.phone, name: user.name },
        jwtSecret,
        { expiresIn: '30d' }
      );
      res.json({ token, user });
    })
  );

  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const { phone, password } = req.body || {};
      const normalized = normalizePhone(String(phone || ''));
      if (!normalized || !password) {
        return res.status(400).json({ error: 'Введите телефон и пароль' });
      }

      const user = await store.getUserByPhone(normalized);
      if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

      const valid = await bcrypt.compare(String(password), user.password);
      if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

      const token = jwt.sign(
        { id: user.id, phone: user.phone, name: user.name },
        jwtSecret,
        { expiresIn: '30d' }
      );
      const { password: _pw, ...userInfo } = user;
      res.json({ token, user: userInfo });
    })
  );

  app.get(
    '/api/auth/me',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const user = await store.getUserById(Number(req.user.id));
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      res.json({ user });
    })
  );

  // Users & profile
  app.get(
    '/api/users',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const users = await store.listOtherUsers(Number(req.user.id));
      res.json({ users });
    })
  );

  app.put(
    '/api/users/profile',
    authenticateToken,
    upload.single('avatar'),
    asyncRoute(async (req: any, res) => {
      const name = String(req.body?.name || '').trim();
      const bio = String(req.body?.bio || '');
      if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });

      let avatarUrl: string | null = null;
      if (req.file) {
        avatarUrl = await store.saveImage(req.file, 'avatars');
      }

      const user = await store.updateUserProfile(Number(req.user.id), { name, bio, avatarUrl });
      res.json({ user });
    })
  );

  // Chats
  app.get(
    '/api/chats',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const chats = await store.listChatsForUser(Number(req.user.id));
      res.json({ chats });
    })
  );

  app.post(
    '/api/chats',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const { type, participantIds, name } = req.body || {};
      const userId = Number(req.user.id);

      if (type === 'direct') {
        const otherId = parsePositiveInt(participantIds?.[0]);
        if (!otherId) return res.status(400).json({ error: 'Укажите собеседника' });
        const result = await store.createDirectChat(userId, otherId);
        return res.json(result);
      }

      if (type === 'group') {
        const groupName = String(name || '').trim();
        if (!groupName) return res.status(400).json({ error: 'Укажите название группы' });
        const ids = Array.isArray(participantIds) ? participantIds : [];
        const result = await store.createGroupChat(userId, groupName, ids);
        return res.json(result);
      }

      return res.status(400).json({ error: 'Неизвестный тип чата' });
    })
  );

  // Messages
  app.get(
    '/api/chats/:id/messages',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const chatId = parsePositiveInt(req.params.id);
      if (!chatId) return res.status(400).json({ error: 'Некорректный ID чата' });

      const userId = Number(req.user.id);
      if (!(await store.isParticipant(chatId, userId))) {
        return res.status(403).json({ error: 'Вы не в этом чате' });
      }

      const afterId = parsePositiveInt(req.query.afterId) ?? undefined;
      const messages = await store.listMessages(chatId, afterId);
      res.json({ messages });
    })
  );

  app.post(
    '/api/chats/:id/messages',
    authenticateToken,
    upload.single('image'),
    asyncRoute(async (req: any, res) => {
      const chatId = parsePositiveInt(req.params.id);
      if (!chatId) return res.status(400).json({ error: 'Некорректный ID чата' });

      const text = String(req.body?.text || '').trim();
      if (!text && !req.file) {
        return res.status(400).json({ error: 'Пустое сообщение' });
      }

      const userId = Number(req.user.id);
      if (!(await store.isParticipant(chatId, userId))) {
        return res.status(403).json({ error: 'Вы не в этом чате' });
      }

      let imageUrl: string | null = null;
      if (req.file) {
        imageUrl = await store.saveImage(req.file, 'messages');
      }

      const message = await store.createMessage(chatId, userId, {
        text: text || null,
        imageUrl,
      });

      if (onMessageCreated) {
        const participantIds = await store.getChatParticipantIds(chatId);
        onMessageCreated(message, participantIds);
      }

      res.json({ message });
    })
  );

  app.post(
    '/api/chats/:id/read',
    authenticateToken,
    asyncRoute(async (req: any, res) => {
      const chatId = parsePositiveInt(req.params.id);
      if (!chatId) return res.status(400).json({ error: 'Некорректный ID чата' });

      const userId = Number(req.user.id);
      if (!(await store.isParticipant(chatId, userId))) {
        return res.status(403).json({ error: 'Вы не в этом чате' });
      }

      await store.markChatRead(chatId, userId);
      res.json({ ok: true });
    })
  );

  // Unknown API route handler
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Маршрут API не найден' });
  });

  // Centralized error handler (AppError, Multer, unexpected errors)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.code === 'LIMIT_FILE_SIZE' || err?.message === 'File too large') {
      return res
        .status(400)
        .json({ error: `Файл слишком большой (максимум ${maxUploadMb} МБ)` });
    }
    console.error('[api-error]', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
