export type PlatformName = 'telegram' | 'bale' | 'rubika';

export type BotStatus = 'active' | 'paused' | 'maintenance' | 'disabled';

export type ChatType = 'private' | 'group' | 'channel';

export type BotCategory = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ForceMembershipChannel {
  id: string;
  platform: PlatformName;
  chatId: string;
  title: string;
  inviteLink?: string;
  required: boolean;
}

export interface ForceMembershipConfig {
  enabled: boolean;
  channels: ForceMembershipChannel[];
  message: string;
  buttonLabel: string;
  recheckLabel: string;
  bypassAdmins: boolean;
  cacheSeconds: number;
}

export type AttachmentType =
  | 'photo'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location';

export interface Attachment {
  type: AttachmentType;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  url?: string;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string;
  firstName?: string;
}

export interface IncomingMessage {
  platform: PlatformName;
  updateId: string;
  chatId: string;
  chatType: ChatType;
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  language?: string;
  text: string;
  command?: string;
  args: string;
  callbackData?: string;
  callbackQueryId?: string;
  messageId?: string;
  replyToMessageId?: string;
  attachments: Attachment[];
  isEdited: boolean;
  timestamp: number;
  raw: unknown;
}

export interface OutgoingMessage {
  text: string;
  parseMode?: 'HTML' | 'Markdown';
  keyboard?: ReplyKeyboard;
  inlineKeyboard?: InlineKeyboard;
  disablePreview?: boolean;
  replyToMessageId?: string;
}

export interface KeyboardButton {
  text: string;
  requestContact?: boolean;
}

export interface ReplyKeyboard {
  rows: KeyboardButton[][];
  resize?: boolean;
  oneTime?: boolean;
}

export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface InlineKeyboard {
  rows: InlineButton[][];
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
}

export interface ChatMemberResult {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked' | 'unknown';
  isMember: boolean;
}

export interface BotIdentity {
  id: string;
  username: string;
  firstName: string;
}

export interface AdapterCapabilities {
  inlineKeyboard: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  callbackQueries: boolean;
  files: boolean;
  voice: boolean;
  mediaGroup: boolean;
  htmlParseMode: boolean;
}

export interface MessengerApi {
  readonly platform: PlatformName;
  readonly botId: string;
  readonly capabilities: AdapterCapabilities;
  sendMessage(chatId: string, message: OutgoingMessage): Promise<SendResult>;
  editMessage(chatId: string, messageId: string, message: OutgoingMessage): Promise<SendResult>;
  deleteMessage(chatId: string, messageId: string): Promise<boolean>;
  answerCallback(callbackQueryId: string, text?: string, alert?: boolean): Promise<boolean>;
  sendPhoto(chatId: string, photo: string, caption?: string, keyboard?: InlineKeyboard): Promise<SendResult>;
  sendDocument(chatId: string, document: string, fileName: string, caption?: string): Promise<SendResult>;
  sendVoice(chatId: string, voice: string, caption?: string): Promise<SendResult>;
  sendVideo(chatId: string, video: string, caption?: string, keyboard?: InlineKeyboard): Promise<SendResult>;
  sendChatAction(chatId: string, action: 'typing' | 'upload_photo' | 'upload_document' | 'record_voice'): Promise<void>;
  getChatMember(chatId: string, userId: string): Promise<ChatMemberResult>;
  banChatMember?(chatId: string, userId: string): Promise<boolean>;
  unbanChatMember?(chatId: string, userId: string): Promise<boolean>;
  getFileUrl(fileId: string): Promise<string | null>;
  getMe(): Promise<BotIdentity>;
  setWebhook(url: string, secretToken: string): Promise<boolean>;
  deleteWebhook(): Promise<boolean>;
}

export interface BotRecord {
  id: string;
  slug: string;
  templateId: string;
  name: string;
  platform: PlatformName;
  status: BotStatus;
  tokenCipher: string;
  tokenHint: string;
  ownerId: string;
  config: Record<string, unknown>;
  forceMembership: ForceMembershipConfig;
  webhookSecret: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'owner' | 'admin' | 'user';

export interface BotUser {
  id: string;
  botId: string;
  platform: PlatformName;
  platformUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  language: 'fa' | 'en';
  role: UserRole;
  isBlocked: boolean;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
  metadata: Record<string, unknown>;
}

export interface SessionRecord {
  botId: string;
  userId: string;
  key: string;
  value: unknown;
  updatedAt: string;
  expiresAt?: string;
}

export interface SettingRecord {
  botId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface DocumentRecord<T = Record<string, unknown>> {
  id: string;
  botId: string;
  collection: string;
  key: string;
  data: T;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'in' | 'out';

export interface MessageLogRecord {
  id: string;
  botId: string;
  platform: PlatformName;
  direction: MessageDirection;
  chatId: string;
  userId: string;
  text: string;
  status: string;
  createdAt: string;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead';

export interface JobRecord {
  id: string;
  botId: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  actorId: string;
  actorType: 'admin' | 'bot' | 'system';
  action: string;
  target: string;
  meta: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export interface AdminRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: 'superadmin' | 'operator' | 'viewer';
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface EventRecord {
  id: string;
  botId: string;
  type: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HealthSnapshot {
  botId: string;
  status: BotStatus;
  users: number;
  messagesToday: number;
  messagesTotal: number;
  errors24h: number;
  lastActivityAt: string | null;
  pendingJobs: number;
  platformOk: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}
