import fs from 'fs';
import os from 'os';
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
} from './types.js';

interface DemoChat {
  id: number;
  type: 'direct' | 'group';
  name: string | null;
  avatar: string | null;
  created_at: string;
}

interface DemoParticipant {
  chat_id: number;
  user_id: number;
  last_read_at: string | null;
}

interface DemoMessage {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string | null;
  image_url: string | null;
  created_at: string;
}

interface DemoState {
  nextUserId: number;
  nextChatId: number;
  nextMessageId: number;
  users: StoredUser[];
  chats: DemoChat[];
  participants: DemoParticipant[];
  messages: DemoMessage[];
}

function emptyState(): DemoState {
  return {
    nextUserId: 1,
    nextChatId: 1,
    nextMessageId: 1,
    users: [],
    chats: [],
    participants: [],
    messages: [],
  };
}

/**
 * Ephemeral fallback storage used on Vercel ONLY when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * have not been configured yet, so a freshly deployed preview works immediately without crashing.
 */
export function createDemoStore(customFilePath?: string): StorageAdapter {
  const filePath = customFilePath || path.join(os.tmpdir(), 'eco_culture_demo_state.json');
  let memoryState: DemoState = emptyState();

  const load = (): DemoState => {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (parsed && Array.isArray(parsed.users)) {
          memoryState = parsed;
          return memoryState;
        }
      }
    } catch {
      // Fall back to in-memory state if /tmp is unavailable
    }
    return memoryState;
  };

  const save = (state: DemoState) => {
    memoryState = state;
    try {
      fs.writeFileSync(filePath, JSON.stringify(state));
    } catch {
      // Keep running in memory
    }
  };

  const toPublicUser = (u: StoredUser): PublicUser => ({
    id: u.id,
    phone: u.phone,
    name: u.name,
    bio: u.bio ?? '',
    avatar: u.avatar ?? null,
  });

  const now = () => new Date().toISOString();

  return {
    mode: 'demo',

    async checkHealth(): Promise<HealthReport> {
      return {
        ok: true,
        mode: 'demo',
        persistent: false,
        schemaReady: true,
        hint: 'Демо-режим (временное хранилище): добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в Vercel для постоянного сохранения данных.',
      };
    },

    async createUser(phone, passwordHash, name) {
      const state = load();
      if (state.users.some((u) => u.phone === phone)) {
        throw new AppError(400, 'Этот номер уже зарегистрирован');
      }
      const user: StoredUser = {
        id: state.nextUserId++,
        phone,
        password: passwordHash,
        name,
        bio: '',
        avatar: null,
        created_at: now(),
      };
      state.users.push(user);
      save(state);
      return toPublicUser(user);
    },

    async getUserByPhone(phone) {
      const state = load();
      return state.users.find((u) => u.phone === phone) ?? null;
    },

    async getUserById(id) {
      const state = load();
      const user = state.users.find((u) => u.id === id);
      return user ? toPublicUser(user) : null;
    },

    async listOtherUsers(currentUserId) {
      const state = load();
      return state.users
        .filter((u) => u.id !== currentUserId)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }))
        .map(toPublicUser);
    },

    async updateUserProfile(userId, { name, bio, avatarUrl }) {
      const state = load();
      const user = state.users.find((u) => u.id === userId);
      if (!user) throw new AppError(404, 'Пользователь не найден');
      user.name = name;
      user.bio = bio;
      if (avatarUrl) user.avatar = avatarUrl;
      save(state);
      return toPublicUser(user);
    },

    async listChatsForUser(userId) {
      const state = load();
      const memberships = state.participants.filter((p) => p.user_id === userId);
      const userById = new Map(state.users.map((u) => [u.id, u]));

      const summaries: ChatSummary[] = [];
      for (const m of memberships) {
        const chat = state.chats.find((c) => c.id === m.chat_id);
        if (!chat) continue;

        const chatMsgs = state.messages.filter((msg) => msg.chat_id === chat.id);
        const last = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : null;
        const lastSender = last ? userById.get(last.sender_id) : undefined;

        const unread = chatMsgs.filter(
          (msg) =>
            msg.sender_id !== userId && (!m.last_read_at || msg.created_at > m.last_read_at)
        ).length;

        let name = chat.name;
        let avatar = chat.avatar;
        let otherUserId: number | undefined;

        if (chat.type === 'direct') {
          const otherPart = state.participants.find(
            (p) => p.chat_id === chat.id && p.user_id !== userId
          );
          const otherUser = otherPart ? userById.get(otherPart.user_id) : undefined;
          if (otherUser) {
            name = otherUser.name;
            avatar = otherUser.avatar ?? null;
            otherUserId = otherUser.id;
          }
        }

        summaries.push({
          id: chat.id,
          type: chat.type,
          name,
          avatar,
          ...(otherUserId ? { other_user_id: otherUserId } : {}),
          created_at: chat.created_at,
          last_message: last?.text ?? null,
          last_message_image: last?.image_url ?? null,
          last_message_time: last?.created_at ?? null,
          last_message_id: last?.id ?? null,
          last_message_sender_id: last?.sender_id ?? null,
          last_message_sender_name: lastSender?.name ?? null,
          unread,
        });
      }

      summaries.sort((a, b) => {
        const diff = (b.last_message_id ?? 0) - (a.last_message_id ?? 0);
        return diff !== 0 ? diff : b.id - a.id;
      });
      return summaries;
    },

    async createDirectChat(userId, otherId) {
      if (otherId === userId) {
        throw new AppError(400, 'Нельзя создать чат с самим собой');
      }
      const state = load();
      if (!state.users.some((u) => u.id === otherId)) {
        throw new AppError(404, 'Пользователь не найден');
      }

      const existing = state.chats.find(
        (c) =>
          c.type === 'direct' &&
          state.participants.some((p) => p.chat_id === c.id && p.user_id === userId) &&
          state.participants.some((p) => p.chat_id === c.id && p.user_id === otherId)
      );
      if (existing) return { chatId: existing.id };

      const timestamp = now();
      const chatId = state.nextChatId++;
      state.chats.push({ id: chatId, type: 'direct', name: null, avatar: null, created_at: timestamp });
      state.participants.push(
        { chat_id: chatId, user_id: userId, last_read_at: timestamp },
        { chat_id: chatId, user_id: otherId, last_read_at: null }
      );
      save(state);
      return { chatId };
    },

    async createGroupChat(userId, name, participantIds) {
      const state = load();
      const timestamp = now();
      const chatId = state.nextChatId++;
      state.chats.push({ id: chatId, type: 'group', name, avatar: null, created_at: timestamp });
      state.participants.push({ chat_id: chatId, user_id: userId, last_read_at: timestamp });

      const seen = new Set<number>([userId]);
      for (const pid of participantIds) {
        const id = Number(pid);
        if (Number.isInteger(id) && !seen.has(id) && state.users.some((u) => u.id === id)) {
          seen.add(id);
          state.participants.push({ chat_id: chatId, user_id: id, last_read_at: null });
        }
      }
      save(state);
      return { chatId };
    },

    async isParticipant(chatId, userId) {
      const state = load();
      return state.participants.some((p) => p.chat_id === chatId && p.user_id === userId);
    },

    async getChatParticipantIds(chatId) {
      const state = load();
      return state.participants.filter((p) => p.chat_id === chatId).map((p) => p.user_id);
    },

    async listMessages(chatId, afterId) {
      const state = load();
      const userById = new Map(state.users.map((u) => [u.id, u]));
      return state.messages
        .filter((m) => m.chat_id === chatId && (!afterId || m.id > afterId))
        .sort((a, b) => a.id - b.id)
        .map((m) => {
          const sender = userById.get(m.sender_id);
          return {
            ...m,
            sender_name: sender?.name ?? 'Пользователь',
            sender_avatar: sender?.avatar ?? null,
          };
        });
    },

    async createMessage(chatId, senderId, { text, imageUrl }) {
      const state = load();
      const createdAt = now();
      const msg: DemoMessage = {
        id: state.nextMessageId++,
        chat_id: chatId,
        sender_id: senderId,
        text,
        image_url: imageUrl,
        created_at: createdAt,
      };
      state.messages.push(msg);

      const senderPart = state.participants.find(
        (p) => p.chat_id === chatId && p.user_id === senderId
      );
      if (senderPart) senderPart.last_read_at = createdAt;
      save(state);

      const sender = state.users.find((u) => u.id === senderId);
      return {
        ...msg,
        sender_name: sender?.name ?? 'Пользователь',
        sender_avatar: sender?.avatar ?? null,
      };
    },

    async markChatRead(chatId, userId) {
      const state = load();
      const p = state.participants.find(
        (part) => part.chat_id === chatId && part.user_id === userId
      );
      if (p) {
        p.last_read_at = now();
        save(state);
      }
    },

    async saveImage(file: UploadInput) {
      return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    },
  };
}
