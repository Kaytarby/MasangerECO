import fs from 'fs';
import path from 'path';
import {
  AppError,
  ChatSummary,
  HealthReport,
  MessageRecord,
  PublicUser,
  StorageAdapter,
  StoredUser,
  UploadInput,
  extensionForImage,
} from './types.js';

interface SqlStatement {
  run(...params: any[]): { lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

async function openSqliteDatabase(dbPath: string): Promise<SqlDatabase> {
  const nodeSqlite: any = await import('node:sqlite');
  const db = new nodeSqlite.DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  return db as SqlDatabase;
}

export async function createSqliteStore(options?: {
  dbPath?: string;
  uploadsDir?: string;
}): Promise<{ store: StorageAdapter; uploadsDir: string }> {
  const dbPath = options?.dbPath || process.env.DB_PATH || 'eco_culture.db';
  const uploadsDir =
    options?.uploadsDir || process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const db = await openSqliteDatabase(dbPath);
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
      type TEXT NOT NULL,
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

  const cpColumns = db.prepare('PRAGMA table_info(chat_participants)').all() as any[];
  if (!cpColumns.some((c) => c.name === 'last_read_at')) {
    db.exec('ALTER TABLE chat_participants ADD COLUMN last_read_at TEXT');
  }

  const now = () => new Date().toISOString();

  const store: StorageAdapter = {
    mode: 'sqlite',

    async checkHealth(): Promise<HealthReport> {
      db.prepare('SELECT 1').get();
      return { ok: true, mode: 'sqlite', persistent: true, schemaReady: true };
    },

    async createUser(phone, passwordHash, name) {
      try {
        const info = db
          .prepare(
            'INSERT INTO users (phone, password, name, bio, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(phone, passwordHash, name, '', now());
        return {
          id: Number(info.lastInsertRowid),
          phone,
          name,
          bio: '',
          avatar: null,
        };
      } catch (e: any) {
        const code = String(e?.code || '');
        const msg = String(e?.message || '');
        if (code.includes('CONSTRAINT') || msg.includes('UNIQUE constraint failed')) {
          throw new AppError(400, 'Этот номер уже зарегистрирован');
        }
        throw e;
      }
    },

    async getUserByPhone(phone) {
      const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as
        | StoredUser
        | undefined;
      return row ?? null;
    },

    async getUserById(id) {
      const row = db
        .prepare('SELECT id, phone, name, bio, avatar FROM users WHERE id = ?')
        .get(id) as PublicUser | undefined;
      return row ?? null;
    },

    async listOtherUsers(currentUserId) {
      return db
        .prepare(
          'SELECT id, name, phone, avatar, bio FROM users WHERE id != ? ORDER BY name COLLATE NOCASE ASC'
        )
        .all(currentUserId) as PublicUser[];
    },

    async updateUserProfile(userId, { name, bio, avatarUrl }) {
      if (avatarUrl) {
        db.prepare('UPDATE users SET name = ?, bio = ?, avatar = ? WHERE id = ?').run(
          name,
          bio,
          avatarUrl,
          userId
        );
      } else {
        db.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio, userId);
      }
      const user = db
        .prepare('SELECT id, phone, name, avatar, bio FROM users WHERE id = ?')
        .get(userId) as PublicUser | undefined;
      if (!user) throw new AppError(404, 'Пользователь не найден');
      return user;
    },

    async listChatsForUser(userId) {
      const chats = db
        .prepare(
          `
          SELECT
            c.id,
            c.type,
            c.name AS chat_name,
            c.avatar AS chat_avatar,
            c.created_at,
            lm.id AS last_message_id,
            lm.text AS last_message,
            lm.image_url AS last_message_image,
            lm.created_at AS last_message_time,
            lm.sender_id AS last_message_sender_id,
            lu.name AS last_message_sender_name
          FROM chats c
          JOIN chat_participants cp ON cp.chat_id = c.id
          LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = c.id)
          LEFT JOIN users lu ON lu.id = lm.sender_id
          WHERE cp.user_id = ?
          ORDER BY COALESCE(lm.id, 0) DESC, c.id DESC
        `
        )
        .all(userId) as any[];

      const unreadRows = db
        .prepare(
          `
          SELECT cp.chat_id,
            (SELECT COUNT(*) FROM messages m
               WHERE m.chat_id = cp.chat_id
                 AND m.sender_id != ?
                 AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread
          FROM chat_participants cp
          WHERE cp.user_id = ?
        `
        )
        .all(userId, userId) as any[];
      const unreadMap: Record<number, number> = {};
      for (const row of unreadRows) unreadMap[row.chat_id] = row.unread;

      const peerStmt = db.prepare(`
        SELECT u.id, u.name, u.avatar
        FROM users u
        JOIN chat_participants cp ON cp.user_id = u.id
        WHERE cp.chat_id = ? AND cp.user_id != ?
      `);

      return chats.map((c): ChatSummary => {
        let name: string | null = c.chat_name ?? null;
        let avatar: string | null = c.chat_avatar ?? null;
        let otherUserId: number | undefined;

        if (c.type === 'direct') {
          const peer = peerStmt.get(c.id, userId) as any;
          if (peer) {
            name = peer.name;
            avatar = peer.avatar ?? null;
            otherUserId = peer.id;
          }
        }

        return {
          id: c.id,
          type: c.type,
          name,
          avatar,
          ...(otherUserId ? { other_user_id: otherUserId } : {}),
          created_at: c.created_at,
          last_message: c.last_message ?? null,
          last_message_image: c.last_message_image ?? null,
          last_message_time: c.last_message_time ?? null,
          last_message_id: c.last_message_id ?? null,
          last_message_sender_id: c.last_message_sender_id ?? null,
          last_message_sender_name: c.last_message_sender_name ?? null,
          unread: unreadMap[c.id] || 0,
        };
      });
    },

    async createDirectChat(userId, otherId) {
      if (otherId === userId) {
        throw new AppError(400, 'Нельзя создать чат с самим собой');
      }
      const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
      if (!other) throw new AppError(404, 'Пользователь не найден');

      const existing = db
        .prepare(
          `
          SELECT c.id FROM chats c
          JOIN chat_participants cp1 ON cp1.chat_id = c.id AND cp1.user_id = ?
          JOIN chat_participants cp2 ON cp2.chat_id = c.id AND cp2.user_id = ?
          WHERE c.type = 'direct'
        `
        )
        .get(userId, otherId) as any;
      if (existing) return { chatId: existing.id };

      const timestamp = now();
      const info = db
        .prepare('INSERT INTO chats (type, created_at) VALUES (?, ?)')
        .run('direct', timestamp);
      const chatId = Number(info.lastInsertRowid);
      const stmt = db.prepare(
        'INSERT INTO chat_participants (chat_id, user_id, last_read_at) VALUES (?, ?, ?)'
      );
      stmt.run(chatId, userId, timestamp);
      stmt.run(chatId, otherId, null);
      return { chatId };
    },

    async createGroupChat(userId, name, participantIds) {
      const timestamp = now();
      const info = db
        .prepare('INSERT INTO chats (type, name, created_at) VALUES (?, ?, ?)')
        .run('group', name, timestamp);
      const chatId = Number(info.lastInsertRowid);
      const stmt = db.prepare(
        'INSERT INTO chat_participants (chat_id, user_id, last_read_at) VALUES (?, ?, ?)'
      );
      const existsStmt = db.prepare('SELECT 1 FROM users WHERE id = ?');
      stmt.run(chatId, userId, timestamp);

      const seen = new Set<number>([userId]);
      for (const pid of participantIds) {
        const id = Number(pid);
        if (Number.isInteger(id) && !seen.has(id) && existsStmt.get(id)) {
          seen.add(id);
          stmt.run(chatId, id, null);
        }
      }
      return { chatId };
    },

    async isParticipant(chatId, userId) {
      const row = db
        .prepare('SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?')
        .get(chatId, userId);
      return !!row;
    },

    async getChatParticipantIds(chatId) {
      const rows = db
        .prepare('SELECT user_id FROM chat_participants WHERE chat_id = ?')
        .all(chatId) as any[];
      return rows.map((r) => Number(r.user_id));
    },

    async listMessages(chatId, afterId) {
      if (afterId && afterId > 0) {
        return db
          .prepare(
            `
            SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.chat_id = ? AND m.id > ?
            ORDER BY m.id ASC
          `
          )
          .all(chatId, afterId) as MessageRecord[];
      }
      return db
        .prepare(
          `
          SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
          FROM messages m
          JOIN users u ON u.id = m.sender_id
          WHERE m.chat_id = ?
          ORDER BY m.id ASC
        `
        )
        .all(chatId) as MessageRecord[];
    },

    async createMessage(chatId, senderId, { text, imageUrl }) {
      const createdAt = now();
      const info = db
        .prepare(
          'INSERT INTO messages (chat_id, sender_id, text, image_url, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(chatId, senderId, text, imageUrl, createdAt);

      db.prepare(
        'UPDATE chat_participants SET last_read_at = ? WHERE chat_id = ? AND user_id = ?'
      ).run(createdAt, chatId, senderId);

      return db
        .prepare(
          `
          SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
          FROM messages m
          JOIN users u ON u.id = m.sender_id
          WHERE m.id = ?
        `
        )
        .get(Number(info.lastInsertRowid)) as MessageRecord;
    },

    async markChatRead(chatId, userId) {
      db.prepare(
        'UPDATE chat_participants SET last_read_at = ? WHERE chat_id = ? AND user_id = ?'
      ).run(now(), chatId, userId);
    },

    async saveImage(file: UploadInput) {
      const ext = extensionForImage(file.mimetype, file.originalname);
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
      return `/uploads/${filename}`;
    },
  };

  return { store, uploadsDir };
}
