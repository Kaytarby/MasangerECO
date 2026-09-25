import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';

// Constants
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'eco_culture_super_secret_key';
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Helpers
const now = () => new Date().toISOString();
const normalizePhone = (phone: string) => (phone || '').replace(/\D/g, '');

// Database Setup
const db = new Database(process.env.DB_PATH || 'eco_culture.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    bio TEXT,
    avatar TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'direct' or 'group'
    name TEXT,
    avatar TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id INTEGER,
    user_id INTEGER,
    last_read_at TEXT,
    UNIQUE(chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT,
    image_url TEXT,
    created_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages (chat_id, id);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON chat_participants (user_id);
`);

// Migration for databases created before last_read_at existed
const cpColumns = db.prepare('PRAGMA table_info(chat_participants)').all() as any[];
if (!cpColumns.some((c) => c.name === 'last_read_at')) {
  db.exec('ALTER TABLE chat_participants ADD COLUMN last_read_at TEXT');
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(express.json());
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Multer setup for uploads (images only, max 10 MB)
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
  });
  const upload = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_SIZE },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Можно загружать только изображения'));
      }
    }
  });

  // Middleware for auth
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: now() });
  });

  // Auth Routes
  app.post('/api/auth/register', (req, res) => {
    const { phone, password, name } = req.body;
    const normalized = normalizePhone(String(phone || ''));
    const trimmedName = String(name || '').trim();
    if (!normalized || !password || !trimmedName) return res.status(400).json({ error: 'Заполните все поля' });
    if (normalized.length < 5) return res.status(400).json({ error: 'Некорректный номер телефона' });
    try {
      const hash = bcrypt.hashSync(password, 10);
      const stmt = db.prepare('INSERT INTO users (phone, password, name, created_at) VALUES (?, ?, ?, ?)');
      const info = stmt.run(normalized, hash, trimmedName, now());
      const token = jwt.sign({ id: Number(info.lastInsertRowid), phone: normalized, name: trimmedName }, JWT_SECRET);
      res.json({ token, user: { id: Number(info.lastInsertRowid), phone: normalized, name: trimmedName } });
    } catch (e: any) {
      if (String(e.code || '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
        res.status(400).json({ error: 'Этот номер уже зарегистрирован' });
      } else {
        console.error(e);
        res.status(500).json({ error: 'Ошибка базы данных' });
      }
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { phone, password } = req.body;
    const normalized = normalizePhone(String(phone || ''));
    try {
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized) as any;
      if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
      if (!bcrypt.compareSync(String(password || ''), user.password)) return res.status(400).json({ error: 'Неверный пароль' });
      const token = jwt.sign({ id: user.id, phone: user.phone, name: user.name }, JWT_SECRET);

      const { password: _pw, ...userInfo } = user;
      res.json({ token, user: userInfo });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка базы данных' });
    }
  });

  app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    try {
      const user = db.prepare('SELECT id, phone, name, bio, avatar FROM users WHERE id = ?').get(req.user.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      res.json({ user });
    } catch {
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  // User details & Profile update
  app.get('/api/users', authenticateToken, (req: any, res) => {
    try {
      const users = db.prepare('SELECT id, name, phone, avatar, bio FROM users WHERE id != ? ORDER BY name COLLATE NOCASE ASC').all(req.user.id);
      res.json({ users });
    } catch {
      res.status(500).json({ error: 'Ошибка загрузки пользователей' });
    }
  });

  app.put('/api/users/profile', authenticateToken, upload.single('avatar'), (req: any, res) => {
    const name = String(req.body?.name || '').trim();
    const bio = String(req.body?.bio || '');
    if (!name) return res.status(400).json({ error: 'Имя не может быть пустым' });
    let avatarUrl: string | null = null;
    if (req.file) avatarUrl = '/uploads/' + req.file.filename;

    try {
      let query = 'UPDATE users SET name = ?, bio = ?';
      const params: any[] = [name, bio];
      if (avatarUrl) {
        query += ', avatar = ?';
        params.push(avatarUrl);
      }
      query += ' WHERE id = ?';
      params.push(req.user.id);

      db.prepare(query).run(...params);
      const user = db.prepare('SELECT id, phone, name, avatar, bio FROM users WHERE id = ?').get(req.user.id);
      res.json({ user });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Не удалось обновить профиль' });
    }
  });

  // Chats
  app.get('/api/chats', authenticateToken, (req: any, res) => {
    try {
      const chats = db.prepare(`
        SELECT c.id, c.type, c.name AS chat_name, c.avatar AS chat_avatar, c.created_at,
          lm.text AS last_message, lm.image_url AS last_message_image, lm.created_at AS last_message_time
        FROM chats c
        JOIN chat_participants cp ON cp.chat_id = c.id
        LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = c.id)
        WHERE cp.user_id = ?
        ORDER BY COALESCE(lm.id, 0) DESC, c.id DESC
      `).all(req.user.id) as any[];

      // Unread counts per chat
      const unreadRows = db.prepare(`
        SELECT cp.chat_id,
          (SELECT COUNT(*) FROM messages m
             WHERE m.chat_id = cp.chat_id
               AND m.sender_id != ?
               AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread
        FROM chat_participants cp
        WHERE cp.user_id = ?
      `).all(req.user.id, req.user.id) as any[];
      const unreadMap: Record<number, number> = {};
      for (const row of unreadRows) unreadMap[row.chat_id] = row.unread;

      // Resolve profiles for direct chats
      for (const chat of chats) {
        if (chat.type === 'direct') {
          const otherParticipant = db.prepare(`
            SELECT u.id, u.name, u.avatar
            FROM users u
            JOIN chat_participants cp ON cp.user_id = u.id
            WHERE cp.chat_id = ? AND cp.user_id != ?
          `).get(chat.id, req.user.id) as any;
          if (otherParticipant) {
            chat.name = otherParticipant.name;
            chat.avatar = otherParticipant.avatar;
            chat.other_user_id = otherParticipant.id;
          }
        }
        chat.unread = unreadMap[chat.id] || 0;
      }

      res.json({ chats });
    } catch {
      res.status(500).json({ error: 'Ошибка загрузки чатов' });
    }
  });

  app.post('/api/chats', authenticateToken, (req: any, res) => {
    const { type, participantIds, name } = req.body;
    try {
      if (type === 'direct') {
        const otherId = Number(participantIds?.[0]);
        if (!otherId) return res.status(400).json({ error: 'Укажите собеседника' });
        const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
        if (!other) return res.status(404).json({ error: 'Пользователь не найден' });

        // Check if direct chat already exists
        const existing = db.prepare(`
          SELECT c.id FROM chats c
          JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
          JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
          WHERE c.type = 'direct'
        `).get(req.user.id, otherId) as any;

        if (existing) {
          return res.json({ chatId: existing.id });
        }

        const info = db.prepare('INSERT INTO chats (type, created_at) VALUES (?, ?)').run('direct', now());
        const chatId = Number(info.lastInsertRowid);
        const stmt = db.prepare('INSERT INTO chat_participants (chat_id, user_id, last_read_at) VALUES (?, ?, ?)');
        stmt.run(chatId, req.user.id, now());
        stmt.run(chatId, otherId, null);
        return res.json({ chatId });
      }

      if (type === 'group') {
        const groupName = String(name || '').trim();
        if (!groupName) return res.status(400).json({ error: 'Укажите название группы' });
        const info = db.prepare('INSERT INTO chats (type, name, created_at) VALUES (?, ?, ?)').run('group', groupName, now());
        const chatId = Number(info.lastInsertRowid);
        const stmt = db.prepare('INSERT INTO chat_participants (chat_id, user_id, last_read_at) VALUES (?, ?, ?)');
        stmt.run(chatId, req.user.id, now());
        const seen = new Set<number>([req.user.id]);
        for (const pid of (participantIds || [])) {
          const id = Number(pid);
          if (!seen.has(id)) {
            seen.add(id);
            stmt.run(chatId, id, null);
          }
        }
        return res.json({ chatId });
      }

      return res.status(400).json({ error: 'Неизвестный тип чата' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Не удалось создать чат' });
    }
  });

  app.get('/api/chats/:id/messages', authenticateToken, (req: any, res) => {
    try {
      // Validate participant
      const p = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!p) return res.status(403).json({ error: 'Вы не в этом чате' });

      const messages = db.prepare(`
        SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ?
        ORDER BY m.id ASC
      `).all(req.params.id);
      res.json({ messages });
    } catch {
      res.status(500).json({ error: 'Ошибка загрузки сообщений' });
    }
  });

  app.post('/api/chats/:id/messages', authenticateToken, upload.single('image'), (req: any, res) => {
    const text = String(req.body?.text || '').trim();
    const chatId = req.params.id;
    if (!text && !req.file) return res.status(400).json({ error: 'Пустое сообщение' });
    let imageUrl: string | null = null;
    if (req.file) imageUrl = '/uploads/' + req.file.filename;

    try {
      const p = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id);
      if (!p) return res.status(403).json({ error: 'Вы не в этом чате' });

      const info = db.prepare('INSERT INTO messages (chat_id, sender_id, text, image_url, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, req.user.id, text || null, imageUrl, now());

      const message = db.prepare(`
        SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.id = ?
      `).get(Number(info.lastInsertRowid));

      // The sender is also a participant — mark their copy as read
      db.prepare('UPDATE chat_participants SET last_read_at = ? WHERE chat_id = ? AND user_id = ?').run(now(), chatId, req.user.id);

      // Broadcast to room
      io.to(`chat_${chatId}`).emit('new_message', message);

      res.json({ message });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
  });

  // Mark chat as read
  app.post('/api/chats/:id/read', authenticateToken, (req: any, res) => {
    try {
      const chatId = req.params.id;
      const p = db.prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id);
      if (!p) return res.status(403).json({ error: 'Вы не в этом чате' });
      db.prepare('UPDATE chat_participants SET last_read_at = ? WHERE chat_id = ? AND user_id = ?').run(now(), chatId, req.user.id);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  // Multer / JSON error handler (e.g. file too large) — must be after all routes
  app.use((err: any, req: any, res: any, next: any) => {
    if (err) {
      const msg = err.message === 'File too large' ? 'Файл слишком большой (максимум 10 МБ)' : (err.message || 'Ошибка загрузки');
      return res.status(400).json({ error: msg });
    }
    next();
  });

  // Socket.io for Realtime
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return next(new Error('Authentication error'));
      socket.data.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    console.log(`User connected: ${userId}`);

    // Join user to all their chats
    const chats = db.prepare('SELECT chat_id FROM chat_participants WHERE user_id = ?').all(userId) as any[];
    for (const c of chats) {
      socket.join(`chat_${c.chat_id}`);
    }

    // A room for notifications to specific user
    socket.join(`user_${userId}`);

    socket.on('join_chat', (chatId) => {
      socket.join(`chat_${chatId}`);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
    });
  });

  // Vite middleware (dev) or static dist (production).
  // If NODE_ENV is not set explicitly, use the production build when dist/ exists.
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction = process.env.NODE_ENV
    ? process.env.NODE_ENV === 'production'
    : fs.existsSync(path.join(distPath, 'index.html'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Allow any host (app is served behind the Arena/Cloud preview proxy)
        allowedHosts: true,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
