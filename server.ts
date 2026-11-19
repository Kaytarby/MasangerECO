import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import path from 'path';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { createApiApp, resolveJwtSecret } from './server/createApp.js';
import { createDemoStore } from './server/demoStore.js';
import { createSqliteStore } from './server/sqliteStore.js';
import { createSupabaseStore, resolveSupabaseConfig } from './server/supabaseStore.js';
import { MessageRecord, StorageAdapter } from './server/types.js';

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = resolveJwtSecret();

async function startServer() {
  const supabaseConfig = resolveSupabaseConfig();
  let store: StorageAdapter;
  let uploadsDir: string | null = null;

  if (supabaseConfig) {
    store = createSupabaseStore(supabaseConfig.url, supabaseConfig.serviceKey);
    console.log('Storage mode: Supabase');
  } else {
    try {
      const sqlite = await createSqliteStore();
      store = sqlite.store;
      uploadsDir = sqlite.uploadsDir;
      console.log('Storage mode: SQLite (local)');
    } catch {
      store = createDemoStore();
      console.log('Storage mode: Demo (ephemeral)');
    }
  }

  let io: Server | null = null;

  const apiApp = createApiApp({
    store,
    realtime: 'socket.io',
    maxUploadBytes: 10 * 1024 * 1024,
    jwtSecret: JWT_SECRET,
    onMessageCreated: (message: MessageRecord, participantIds: number[]) => {
      if (!io) return;
      const rooms = [
        `chat_${message.chat_id}`,
        ...participantIds.map((id) => `user_${id}`),
      ];
      io.to(rooms).emit('new_message', message);
    },
  });

  const app = express();
  const httpServer = createServer(app);
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  if (uploadsDir) {
    app.use('/uploads', express.static(uploadsDir));
  }

  app.use('/api', (req, res, next) => {
    req.url = '/api' + req.url;
    apiApp(req, res, next);
  });

  // Socket.IO realtime connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return next(new Error('Authentication error'));
      socket.data.user = decoded;
      next();
    });
  });

  io.on('connection', async (socket) => {
    const userId = Number(socket.data.user.id);
    socket.join(`user_${userId}`);

    try {
      const chats = await store.listChatsForUser(userId);
      for (const c of chats) {
        socket.join(`chat_${c.id}`);
      }
    } catch {
      // Ignore initial room preload errors
    }

    socket.on('join_chat', async (rawChatId) => {
      const chatId = Number(rawChatId);
      if (!Number.isInteger(chatId) || chatId <= 0) return;
      try {
        if (await store.isParticipant(chatId, userId)) {
          socket.join(`chat_${chatId}`);
        }
      } catch {
        // Ignore
      }
    });
  });

  // Vite middleware (dev) or static dist/ (production)
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction = process.env.NODE_ENV
    ? process.env.NODE_ENV === 'production'
    : fs.existsSync(path.join(distPath, 'index.html'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
