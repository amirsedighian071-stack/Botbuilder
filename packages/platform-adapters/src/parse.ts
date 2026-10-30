import type { Attachment, ChatType, IncomingMessage, PlatformName } from '@botforge/core';

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const asString = (value: unknown, fallback = ''): string => (value === undefined || value === null ? fallback : String(value));
const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function extractCommand(text: string): { command?: string; args: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { args: trimmed };
  const match = trimmed.match(/^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{2,64}))?(?:\s+([\s\S]*))?$/);
  if (!match) return { args: trimmed };
  return { command: match[1].toLowerCase(), args: (match[3] ?? '').trim() };
}

function parseTelegramAttachments(message: Json): Attachment[] {
  const attachments: Attachment[] = [];
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = asRecord(message.photo[message.photo.length - 1]);
    attachments.push({ type: 'photo', fileId: asString(largest.file_id), size: asNumber(largest.file_size) });
  }
  const video = asRecord(message.video);
  if (Object.keys(video).length > 0) {
    attachments.push({
      type: 'video',
      fileId: asString(video.file_id),
      mimeType: asString(video.mime_type, 'video/mp4'),
      duration: asNumber(video.duration),
      size: asNumber(video.file_size),
      fileName: asString(video.file_name) || undefined,
    });
  }
  const audio = asRecord(message.audio);
  if (Object.keys(audio).length > 0) {
    attachments.push({
      type: 'audio',
      fileId: asString(audio.file_id),
      mimeType: asString(audio.mime_type, 'audio/mpeg'),
      duration: asNumber(audio.duration),
      size: asNumber(audio.file_size),
      fileName: asString(audio.file_name) || asString(audio.title) || undefined,
    });
  }
  const voice = asRecord(message.voice);
  if (Object.keys(voice).length > 0) {
    attachments.push({
      type: 'voice',
      fileId: asString(voice.file_id),
      mimeType: asString(voice.mime_type, 'audio/ogg'),
      duration: asNumber(voice.duration),
      size: asNumber(voice.file_size),
    });
  }
  const document = asRecord(message.document);
  if (Object.keys(document).length > 0) {
    attachments.push({
      type: 'document',
      fileId: asString(document.file_id),
      mimeType: asString(document.mime_type, 'application/octet-stream'),
      fileName: asString(document.file_name) || undefined,
      size: asNumber(document.file_size),
    });
  }
  const sticker = asRecord(message.sticker);
  if (Object.keys(sticker).length > 0) {
    attachments.push({ type: 'sticker', fileId: asString(sticker.file_id) });
  }
  const contact = asRecord(message.contact);
  if (Object.keys(contact).length > 0) {
    attachments.push({
      type: 'contact',
      phoneNumber: asString(contact.phone_number),
      firstName: asString(contact.first_name),
    });
  }
  const location = asRecord(message.location);
  if (Object.keys(location).length > 0) {
    attachments.push({
      type: 'location',
      latitude: asNumber(location.latitude),
      longitude: asNumber(location.longitude),
    });
  }
  return attachments;
}

function normalizeChatType(raw: string): ChatType {
  if (raw === 'group' || raw === 'supergroup') return 'group';
  if (raw === 'channel') return 'channel';
  return 'private';
}

export function parseTelegramUpdate(platform: PlatformName, update: unknown): IncomingMessage | null {
  const payload = asRecord(update);
  const updateId = asString(payload.update_id, `${Date.now()}`);

  const callback = asRecord(payload.callback_query);
  if (Object.keys(callback).length > 0) {
    const message = asRecord(callback.message);
    const chat = asRecord(message.chat);
    const from = asRecord(callback.from);
    const data = asString(callback.data);
    const { command } = extractCommand(data);
    return {
      platform,
      updateId,
      chatId: asString(chat.id),
      chatType: normalizeChatType(asString(chat.type, 'private')),
      userId: asString(from.id),
      username: asString(from.username) || undefined,
      firstName: asString(from.first_name) || undefined,
      lastName: asString(from.last_name) || undefined,
      language: asString(from.language_code) || undefined,
      text: data,
      command: command,
      args: '',
      callbackData: data,
      callbackQueryId: asString(callback.id),
      messageId: message.message_id === undefined ? undefined : asString(message.message_id),
      attachments: [],
      isEdited: false,
      timestamp: asNumber(callback.date, Math.floor(Date.now() / 1000)),
      raw: update,
    };
  }

  const rawMessage = payload.message ?? payload.edited_message ?? payload.channel_post;
  const message = asRecord(rawMessage);
  if (Object.keys(message).length === 0) return null;

  const chat = asRecord(message.chat);
  const from = asRecord(message.from ?? message.sender_chat);
  const text = asString(message.text ?? message.caption);
  const { command, args } = extractCommand(text);
  const chatType = normalizeChatType(asString(chat.type, 'private'));

  return {
    platform,
    updateId,
    chatId: asString(chat.id),
    chatType,
    userId: asString(from.id ?? chat.id),
    username: asString(from.username) || undefined,
    firstName: asString(from.first_name) || undefined,
    lastName: asString(from.last_name) || undefined,
    language: asString(from.language_code) || undefined,
    text,
    command,
    args,
    messageId: message.message_id === undefined ? undefined : asString(message.message_id),
    replyToMessageId:
      asRecord(message.reply_to_message).message_id === undefined
        ? undefined
        : asString(asRecord(message.reply_to_message).message_id),
    attachments: parseTelegramAttachments(message),
    isEdited: payload.edited_message !== undefined,
    timestamp: asNumber(message.date, Math.floor(Date.now() / 1000)),
    raw: update,
  };
}

export function parseRubikaUpdate(update: unknown): IncomingMessage | null {
  const payload = asRecord(asRecord(update).update ?? update);
  const type = asString(payload.type);
  const newMessage = asRecord(payload.new_message ?? payload.message);
  if (Object.keys(newMessage).length === 0) return null;
  if (type && !['NewMessage', 'UpdatedMessage', 'RemovedMessage'].includes(type)) return null;

  const senderId = asString(newMessage.sender_id ?? payload.sender_id);
  const chatId = asString(payload.chat_id ?? newMessage.chat_id ?? senderId);
  const text = asString(newMessage.text ?? asRecord(newMessage.file).caption);
  const { command, args } = extractCommand(text);
  const auxData = asRecord(newMessage.aux_data);
  const buttonId = asString(auxData.button_id);

  const attachments: Attachment[] = [];
  const file = asRecord(newMessage.file);
  if (Object.keys(file).length > 0) {
    attachments.push({
      type: asString(file.type, 'document').toLowerCase().includes('image') ? 'photo' : 'document',
      fileId: asString(file.file_id ?? file.fileId),
      fileName: asString(file.file_name) || undefined,
      size: asNumber(file.size),
      mimeType: asString(file.mime_type) || undefined,
    });
  }

  return {
    platform: 'rubika',
    updateId: asString(payload.update_id ?? `${chatId}:${asString(newMessage.message_id)}`),
    chatId,
    chatType: chatId.startsWith('c') ? 'channel' : chatId.startsWith('g') ? 'group' : 'private',
    userId: senderId,
    username: asString(newMessage.sender_id) || undefined,
    firstName: asString(asRecord(newMessage.sender).first_name) || undefined,
    language: 'fa',
    text,
    command,
    args,
    callbackData: buttonId || undefined,
    messageId: newMessage.message_id === undefined ? undefined : asString(newMessage.message_id),
    attachments,
    isEdited: type === 'UpdatedMessage',
    timestamp: asNumber(newMessage.time, Math.floor(Date.now() / 1000)),
    raw: update,
  };
}

export function parseUpdate(platform: PlatformName, update: unknown): IncomingMessage | null {
  if (platform === 'rubika') return parseRubikaUpdate(update);
  return parseTelegramUpdate(platform, update);
}
