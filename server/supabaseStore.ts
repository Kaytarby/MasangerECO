import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'eco-uploads';

export function resolveSupabaseConfig(): { url: string; serviceKey: string } | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();

  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();

  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function isMissingSchemaError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('eco_users') && msg.includes('does not exist') ||
    msg.includes('could not find the table')
  );
}

function mapDbError(err: any, fallbackMessage: string): AppError {
  if (!err) return new AppError(500, fallbackMessage);
  const code = String(err.code || '');
  if (code === '23505') {
    return new AppError(400, 'Этот номер уже зарегистрирован');
  }
  if (isMissingSchemaError(err)) {
    return new AppError(
      503,
      'Таблицы в Supabase ещё не созданы — выполните файл supabase/schema.sql в SQL Editor'
    );
  }
  console.error('[supabase]', err);
  return new AppError(500, fallbackMessage);
}

function unwrapSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

export function createSupabaseStore(url: string, serviceKey: string): StorageAdapter {
  const supabase: SupabaseClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let bucketReady = false;

  const ensureBucket = async () => {
    if (bucketReady) return;
    const { data, error } = await supabase.storage.getBucket(BUCKET_NAME);
    if (!error && data) {
      bucketReady = true;
      return;
    }
    const { error: createErr } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'image/avif',
      ],
    });
    if (createErr && !String(createErr.message || '').toLowerCase().includes('already exists')) {
      console.error('[supabase-storage] createBucket failed:', createErr);
      throw new AppError(500, 'Не удалось подготовить хранилище изображений в Supabase');
    }
    bucketReady = true;
  };

  const now = () => new Date().toISOString();

  return {
    mode: 'supabase',

    async checkHealth(): Promise<HealthReport> {
      const { error } = await supabase.from('eco_users').select('id').limit(1);
      if (!error) {
        return { ok: true, mode: 'supabase', persistent: true, schemaReady: true };
      }
      if (isMissingSchemaError(error)) {
        return {
          ok: true,
          mode: 'supabase',
          persistent: true,
          schemaReady: false,
          hint: 'Выполните supabase/schema.sql в Supabase SQL Editor, чтобы создать таблицы.',
        };
      }
      return {
        ok: false,
        mode: 'supabase',
        persistent: false,
        schemaReady: false,
        hint: 'Не удалось подключиться к Supabase — проверьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.',
      };
    },

    async createUser(phone, passwordHash, name) {
      const { data, error } = await supabase
        .from('eco_users')
        .insert({ phone, password: passwordHash, name, bio: '', created_at: now() })
        .select('id, phone, name, bio, avatar')
        .single();
      if (error || !data) throw mapDbError(error, 'Ошибка базы данных');
      return {
        id: Number(data.id),
        phone: data.phone,
        name: data.name,
        bio: data.bio,
        avatar: data.avatar,
      };
    },

    async getUserByPhone(phone) {
      const { data, error } = await supabase
        .from('eco_users')
        .select('id, phone, password, name, bio, avatar, created_at')
        .eq('phone', phone)
        .maybeSingle();
      if (error) throw mapDbError(error, 'Ошибка базы данных');
      if (!data) return null;
      return {
        id: Number(data.id),
        phone: data.phone,
        password: data.password,
        name: data.name,
        bio: data.bio,
        avatar: data.avatar,
        created_at: data.created_at,
      } satisfies StoredUser;
    },

    async getUserById(id) {
      const { data, error } = await supabase
        .from('eco_users')
        .select('id, phone, name, bio, avatar')
        .eq('id', id)
        .maybeSingle();
      if (error) throw mapDbError(error, 'Ошибка базы данных');
      if (!data) return null;
      return {
        id: Number(data.id),
        phone: data.phone,
        name: data.name,
        bio: data.bio,
        avatar: data.avatar,
      };
    },

    async listOtherUsers(currentUserId) {
      const { data, error } = await supabase
        .from('eco_users')
        .select('id, name, phone, avatar, bio')
        .neq('id', currentUserId)
        .order('name', { ascending: true });
      if (error) throw mapDbError(error, 'Ошибка загрузки пользователей');
      return (data || []).map((u) => ({
        id: Number(u.id),
        name: u.name,
        phone: u.phone,
        avatar: u.avatar,
        bio: u.bio,
      }));
    },

    async updateUserProfile(userId, { name, bio, avatarUrl }) {
      const patch: Record<string, any> = { name, bio };
      if (avatarUrl) patch.avatar = avatarUrl;

      const { data, error } = await supabase
        .from('eco_users')
        .update(patch)
        .eq('id', userId)
        .select('id, phone, name, avatar, bio')
        .single();
      if (error || !data) throw mapDbError(error, 'Не удалось обновить профиль');
      return {
        id: Number(data.id),
        phone: data.phone,
        name: data.name,
        avatar: data.avatar,
        bio: data.bio,
      };
    },

    async listChatsForUser(userId) {
      const { data: memberships, error } = await supabase
        .from('eco_chat_participants')
        .select('chat_id, last_read_at, chat:eco_chats(id, type, name, avatar, created_at)')
        .eq('user_id', userId);
      if (error) throw mapDbError(error, 'Ошибка загрузки чатов');
      if (!memberships || memberships.length === 0) return [];

      const entries = memberships
        .map((m: any) => ({
          chatId: Number(m.chat_id),
          lastReadAt: m.last_read_at as string | null,
          chat: unwrapSingle<any>(m.chat),
        }))
        .filter((e) => e.chat);

      const directIds = entries.filter((e) => e.chat.type === 'direct').map((e) => e.chatId);

      const peersPromise =
        directIds.length > 0
          ? supabase
              .from('eco_chat_participants')
              .select('chat_id, user:eco_users(id, name, avatar)')
              .in('chat_id', directIds)
              .neq('user_id', userId)
          : Promise.resolve({ data: [], error: null });

      const metaPromise = Promise.all(
        entries.map(async (entry) => {
          let unreadQuery = supabase
            .from('eco_messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', entry.chatId)
            .neq('sender_id', userId);
          if (entry.lastReadAt) {
            unreadQuery = unreadQuery.gt('created_at', entry.lastReadAt);
          }

          const [lastRes, unreadRes] = await Promise.all([
            supabase
              .from('eco_messages')
              .select(
                'id, text, image_url, created_at, sender_id, sender:eco_users(name)'
              )
              .eq('chat_id', entry.chatId)
              .order('id', { ascending: false })
              .limit(1)
              .maybeSingle(),
            unreadQuery,
          ]);

          const last = lastRes.data as any;
          const sender = last ? unwrapSingle<any>(last.sender) : null;
          return {
            chatId: entry.chatId,
            lastMessage: last
              ? {
                  id: Number(last.id),
                  text: last.text ?? null,
                  image_url: last.image_url ?? null,
                  created_at: last.created_at,
                  sender_id: Number(last.sender_id),
                  sender_name: sender?.name ?? null,
                }
              : null,
            unread: unreadRes.count ?? 0,
          };
        })
      );

      const [peersRes, metas] = await Promise.all([peersPromise, metaPromise]);
      if (peersRes.error) throw mapDbError(peersRes.error, 'Ошибка загрузки чатов');

      const peerByChat = new Map<number, { id: number; name: string; avatar: string | null }>();
      for (const row of (peersRes.data || []) as any[]) {
        const u = unwrapSingle<any>(row.user);
        if (u) {
          peerByChat.set(Number(row.chat_id), {
            id: Number(u.id),
            name: u.name,
            avatar: u.avatar ?? null,
          });
        }
      }

      const metaByChat = new Map(metas.map((m) => [m.chatId, m]));

      const summaries: ChatSummary[] = entries.map((entry) => {
        const c = entry.chat;
        const meta = metaByChat.get(entry.chatId);
        const lm = meta?.lastMessage ?? null;
        const isDirect = c.type === 'direct';
        const peer = isDirect ? peerByChat.get(entry.chatId) : undefined;

        return {
          id: entry.chatId,
          type: c.type,
          name: isDirect ? peer?.name ?? null : c.name ?? null,
          avatar: isDirect ? peer?.avatar ?? null : c.avatar ?? null,
          ...(peer ? { other_user_id: peer.id } : {}),
          created_at: c.created_at,
          last_message: lm?.text ?? null,
          last_message_image: lm?.image_url ?? null,
          last_message_time: lm?.created_at ?? null,
          last_message_id: lm?.id ?? null,
          last_message_sender_id: lm?.sender_id ?? null,
          last_message_sender_name: lm?.sender_name ?? null,
          unread: meta?.unread ?? 0,
        };
      });

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

      const { data: other, error: otherErr } = await supabase
        .from('eco_users')
        .select('id')
        .eq('id', otherId)
        .maybeSingle();
      if (otherErr) throw mapDbError(otherErr, 'Не удалось создать чат');
      if (!other) throw new AppError(404, 'Пользователь не найден');

      // Reuse an existing direct chat if both users share one
      const [{ data: mine, error: mineErr }, { data: theirs, error: theirsErr }] =
        await Promise.all([
          supabase.from('eco_chat_participants').select('chat_id').eq('user_id', userId),
          supabase.from('eco_chat_participants').select('chat_id').eq('user_id', otherId),
        ]);
      if (mineErr || theirsErr) throw mapDbError(mineErr || theirsErr, 'Не удалось создать чат');

      const theirSet = new Set((theirs || []).map((r) => Number(r.chat_id)));
      const sharedIds = (mine || [])
        .map((r) => Number(r.chat_id))
        .filter((id) => theirSet.has(id));

      if (sharedIds.length > 0) {
        const { data: existing } = await supabase
          .from('eco_chats')
          .select('id')
          .in('id', sharedIds)
          .eq('type', 'direct')
          .limit(1)
          .maybeSingle();
        if (existing) return { chatId: Number(existing.id) };
      }

      const timestamp = now();
      const { data: created, error: createErr } = await supabase
        .from('eco_chats')
        .insert({ type: 'direct', created_at: timestamp })
        .select('id')
        .single();
      if (createErr || !created) throw mapDbError(createErr, 'Не удалось создать чат');

      const chatId = Number(created.id);
      const { error: partErr } = await supabase.from('eco_chat_participants').insert([
        { chat_id: chatId, user_id: userId, last_read_at: timestamp },
        { chat_id: chatId, user_id: otherId, last_read_at: null },
      ]);
      if (partErr) throw mapDbError(partErr, 'Не удалось создать чат');

      return { chatId };
    },

    async createGroupChat(userId, name, participantIds) {
      const timestamp = now();
      const { data: created, error: createErr } = await supabase
        .from('eco_chats')
        .insert({ type: 'group', name, created_at: timestamp })
        .select('id')
        .single();
      if (createErr || !created) throw mapDbError(createErr, 'Не удалось создать чат');

      const chatId = Number(created.id);
      const otherIds = Array.from(
        new Set(
          participantIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0 && id !== userId)
        )
      );

      let validOtherIds: number[] = [];
      if (otherIds.length > 0) {
        const { data: validUsers, error: validErr } = await supabase
          .from('eco_users')
          .select('id')
          .in('id', otherIds);
        if (validErr) throw mapDbError(validErr, 'Не удалось создать чат');
        validOtherIds = (validUsers || []).map((u) => Number(u.id));
      }

      const rows = [
        { chat_id: chatId, user_id: userId, last_read_at: timestamp },
        ...validOtherIds.map((id) => ({ chat_id: chatId, user_id: id, last_read_at: null })),
      ];
      const { error: partErr } = await supabase.from('eco_chat_participants').insert(rows);
      if (partErr) throw mapDbError(partErr, 'Не удалось создать чат');

      return { chatId };
    },

    async isParticipant(chatId, userId) {
      const { data, error } = await supabase
        .from('eco_chat_participants')
        .select('chat_id')
        .eq('chat_id', chatId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw mapDbError(error, 'Ошибка базы данных');
      return !!data;
    },

    async getChatParticipantIds(chatId) {
      const { data, error } = await supabase
        .from('eco_chat_participants')
        .select('user_id')
        .eq('chat_id', chatId);
      if (error) throw mapDbError(error, 'Ошибка базы данных');
      return (data || []).map((r) => Number(r.user_id));
    },

    async listMessages(chatId, afterId) {
      let query = supabase
        .from('eco_messages')
        .select('id, chat_id, sender_id, text, image_url, created_at, sender:eco_users(name, avatar)')
        .eq('chat_id', chatId);

      if (afterId && afterId > 0) {
        query = query.gt('id', afterId);
      }

      const { data, error } = await query.order('id', { ascending: true });
      if (error) throw mapDbError(error, 'Ошибка загрузки сообщений');

      return (data || []).map((m: any) => {
        const sender = unwrapSingle<any>(m.sender);
        return {
          id: Number(m.id),
          chat_id: Number(m.chat_id),
          sender_id: Number(m.sender_id),
          text: m.text ?? null,
          image_url: m.image_url ?? null,
          created_at: m.created_at,
          sender_name: sender?.name ?? 'Пользователь',
          sender_avatar: sender?.avatar ?? null,
        } satisfies MessageRecord;
      });
    },

    async createMessage(chatId, senderId, { text, imageUrl }) {
      const createdAt = now();
      const { data, error } = await supabase
        .from('eco_messages')
        .insert({
          chat_id: chatId,
          sender_id: senderId,
          text,
          image_url: imageUrl,
          created_at: createdAt,
        })
        .select('id, chat_id, sender_id, text, image_url, created_at, sender:eco_users(name, avatar)')
        .single();
      if (error || !data) throw mapDbError(error, 'Ошибка отправки сообщения');

      await supabase
        .from('eco_chat_participants')
        .update({ last_read_at: data.created_at })
        .eq('chat_id', chatId)
        .eq('user_id', senderId);

      const sender = unwrapSingle<any>((data as any).sender);
      return {
        id: Number(data.id),
        chat_id: Number(data.chat_id),
        sender_id: Number(data.sender_id),
        text: data.text ?? null,
        image_url: data.image_url ?? null,
        created_at: data.created_at,
        sender_name: sender?.name ?? 'Пользователь',
        sender_avatar: sender?.avatar ?? null,
      };
    },

    async markChatRead(chatId, userId) {
      const { data: latest } = await supabase
        .from('eco_messages')
        .select('created_at')
        .eq('chat_id', chatId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentIso = now();
      const latestIso = latest?.created_at ? new Date(latest.created_at).toISOString() : null;
      const readAt = latestIso && latestIso > currentIso ? latestIso : currentIso;

      const { error } = await supabase
        .from('eco_chat_participants')
        .update({ last_read_at: readAt })
        .eq('chat_id', chatId)
        .eq('user_id', userId);
      if (error) throw mapDbError(error, 'Ошибка обновления статуса прочтения');
    },

    async saveImage(file: UploadInput, folder: 'messages' | 'avatars') {
      await ensureBucket();
      const ext = extensionForImage(file.mimetype, file.originalname);
      const objectPath = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

      const { error } = await supabase.storage.from(BUCKET_NAME).upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) {
        console.error('[supabase-storage] upload failed:', error);
        throw new AppError(500, 'Не удалось загрузить изображение');
      }

      const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(objectPath);
      return data.publicUrl;
    },
  };
}
