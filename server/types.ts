export type StorageMode = 'supabase' | 'sqlite' | 'demo';

export interface PublicUser {
  id: number;
  phone: string;
  name: string;
  bio?: string | null;
  avatar?: string | null;
}

export interface StoredUser extends PublicUser {
  password: string;
  created_at?: string;
}

export interface ChatSummary {
  id: number;
  type: 'direct' | 'group';
  name: string | null;
  avatar: string | null;
  other_user_id?: number;
  created_at: string;
  last_message: string | null;
  last_message_image: string | null;
  last_message_time: string | null;
  last_message_id: number | null;
  last_message_sender_id: number | null;
  last_message_sender_name: string | null;
  unread: number;
}

export interface MessageRecord {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string | null;
  image_url: string | null;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
}

export interface UploadInput {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface HealthReport {
  ok: boolean;
  mode: StorageMode;
  persistent: boolean;
  schemaReady: boolean;
  hint?: string;
}

export interface StorageAdapter {
  readonly mode: StorageMode;
  checkHealth(): Promise<HealthReport>;

  createUser(phone: string, passwordHash: string, name: string): Promise<PublicUser>;
  getUserByPhone(phone: string): Promise<StoredUser | null>;
  getUserById(id: number): Promise<PublicUser | null>;
  listOtherUsers(currentUserId: number): Promise<PublicUser[]>;
  updateUserProfile(
    userId: number,
    data: { name: string; bio: string; avatarUrl: string | null }
  ): Promise<PublicUser>;

  listChatsForUser(userId: number): Promise<ChatSummary[]>;
  createDirectChat(userId: number, otherId: number): Promise<{ chatId: number }>;
  createGroupChat(
    userId: number,
    name: string,
    participantIds: number[]
  ): Promise<{ chatId: number }>;
  isParticipant(chatId: number, userId: number): Promise<boolean>;
  getChatParticipantIds(chatId: number): Promise<number[]>;

  listMessages(chatId: number, afterId?: number): Promise<MessageRecord[]>;
  createMessage(
    chatId: number,
    senderId: number,
    data: { text: string | null; imageUrl: string | null }
  ): Promise<MessageRecord>;
  markChatRead(chatId: number, userId: number): Promise<void>;

  saveImage(file: UploadInput, folder: 'messages' | 'avatars'): Promise<string>;
}

export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

export function extensionForImage(mimetype: string, originalname: string): string {
  const fromMime = MIME_EXTENSIONS[mimetype.toLowerCase()];
  if (fromMime) return fromMime;
  const match = originalname.toLowerCase().match(/\.(jpe?g|png|webp|gif|svg|avif)$/);
  return match ? match[0] : '.jpg';
}
