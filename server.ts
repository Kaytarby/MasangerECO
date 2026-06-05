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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'eco_culture_super_secret_key';
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Database Setup
const db = new Database('eco_culture.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    bio TEXT,
    avatar TEXT
  );
  
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'direct' or 'group'
    name TEXT,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id INTEGER,
    user_id INTEGER,
    UNIQUE(chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(express.json());
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Multer setup for uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
  });
  const upload = multer({ storage });

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

  // Auth Routes
  app.post('/api/auth/register', (req, res) => {
    const { phone, password, name } = req.body;
    if (!phone || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    try {
      const hash = bcrypt.hashSync(password, 10);
      const stmt = db.prepare('INSERT INTO users (phone, password, name) VALUES (?, ?, ?)');
      const info = stmt.run(phone, hash, name);
      const token = jwt.sign({ id: info.lastInsertRowid, phone, name }, JWT_SECRET);
      res.json({ token, user: { id: info.lastInsertRowid, phone, name } });
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(400).json({ error: 'Phone already registered' });
      } else {
        res.status(500).json({ error: 'Database error' });
      }
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { phone, password } = req.body;
    try {
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as any;
      if (!user) return res.status(400).json({ error: 'User not found' });
      if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Invalid password' });
      const token = jwt.sign({ id: user.id, phone: user.phone, name: user.name }, JWT_SECRET);
      
      const { password: _, ...userInfo } = user;
      res.json({ token, user: userInfo });
    } catch (e) {
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    try {
      const user = db.prepare('SELECT id, phone, name, bio, avatar FROM users WHERE id = ?').get(req.user.id);
      res.json({ user });
    } catch {
      res.status(500).json({ error: 'Error' });
    }
  });

  // User details & Profile update
  app.get('/api/users', authenticateToken, (req: any, res) => {
    try {
      const users = db.prepare('SELECT id, name, phone, avatar, bio FROM users WHERE id != ?').all(req.user.id);
      res.json({ users });
    } catch {
      res.status(500).json({ error: 'Error fetching users' });
    }
  });

  app.put('/api/users/profile', authenticateToken, upload.single('avatar'), (req: any, res) => {
    const { name, bio } = req.body;
    let avatarUrl = undefined;
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
      const user = db.prepare('SELECT id, name, phone, avatar, bio FROM users WHERE id = ?').get(req.user.id);
      res.json({ user });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Profile update failed' });
    }
  });

  // Chats setup
  app.get('/api/chats', authenticateToken, (req: any, res) => {
    try {
      // Get all chats for the user
      const chats = db.prepare(`
        SELECT c.*, 
          (SELECT text FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
        FROM chats c
        JOIN chat_participants cp ON cp.chat_id = c.id
        WHERE cp.user_id = ?
        ORDER BY last_message_time DESC
      `).all(req.user.id) as any[];

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
      }
      
      res.json({ chats });
    } catch {
      res.status(500).json({ error: 'Error fetching chats' });
    }
  });

  app.post('/api/chats', authenticateToken, (req: any, res) => {
    const { type, participantIds, name } = req.body;
    try {
      if (type === 'direct') {
        const otherId = participantIds[0];
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
      }

      const info = db.prepare('INSERT INTO chats (type, name) VALUES (?, ?)').run(type, name || null);
      const chatId = info.lastInsertRowid;
      
      // Add participants
      const stmt = db.prepare('INSERT INTO chat_participants (chat_id, user_id) VALUES (?, ?)');
      stmt.run(chatId, req.user.id);
      for (const pid of participantIds) {
        if (pid !== req.user.id) stmt.run(chatId, pid);
      }
      
      res.json({ chatId });
    } catch(e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create chat' });
    }
  });

  app.get('/api/chats/:id/messages', authenticateToken, (req: any, res) => {
    try {
      // Validate participant
      const p = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!p) return res.status(403).json({ error: 'Not in chat' });

      const messages = db.prepare(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar 
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = ? 
        ORDER BY m.created_at ASC
      `).all(req.params.id);
      res.json({ messages });
    } catch {
      res.status(500).json({ error: 'Error fetching messages' });
    }
  });

  app.post('/api/chats/:id/messages', authenticateToken, upload.single('image'), (req: any, res) => {
    const { text } = req.body;
    const chatId = req.params.id;
    let imageUrl = undefined;
    if (req.file) imageUrl = '/uploads/' + req.file.filename;

    try {
      const p = db.prepare('SELECT * FROM chat_participants WHERE chat_id = ? AND user_id = ?').get(chatId, req.user.id);
      if (!p) return res.status(403).json({ error: 'Not in chat' });

      const info = db.prepare('INSERT INTO messages (chat_id, sender_id, text, image_url) VALUES (?, ?, ?, ?)').run(chatId, req.user.id, text || null, imageUrl || null);
      
      const message = db.prepare(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar 
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.id = ?
      `).get(info.lastInsertRowid);

      // Broadcast to room
      io.to(`chat_${chatId}`).emit('new_message', message);
      
      res.json({ message });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error sending message' });
    }
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

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
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
