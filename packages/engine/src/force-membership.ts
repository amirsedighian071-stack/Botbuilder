import type {
  BotRecord,
  ForceMembershipChannel,
  ForceMembershipConfig,
  InlineKeyboard,
  MessengerApi,
  PlatformName,
  Storage,
} from '@botforge/core';
import { escapeHtml } from '@botforge/core';

export interface MembershipCheckResult {
  ok: boolean;
  missing: ForceMembershipChannel[];
  unknown: ForceMembershipChannel[];
  checkedAt: string;
}

export interface MembershipContext {
  bot: BotRecord;
  api: MessengerApi;
  storage: Storage;
  userId: string;
  cacheSeconds?: number;
}

interface CachedCheck {
  ok: boolean;
  missingIds: string[];
  unknownIds: string[];
  checkedAt: string;
}

const CACHE_KEY = 'fsm';

export function isForceMembershipActive(config: ForceMembershipConfig | undefined | null): boolean {
  if (!config || !config.enabled) return false;
  return config.channels.some((channel) => channel.required);
}

export async function checkMembership(context: MembershipContext): Promise<MembershipCheckResult> {
  const config = context.bot.forceMembership;
  const cacheSeconds = context.cacheSeconds ?? config.cacheSeconds ?? 0;
  const platform: PlatformName = context.bot.platform;

  if (cacheSeconds > 0) {
    const cached = await context.storage.sessions.get<CachedCheck>(context.bot.id, context.userId, CACHE_KEY);
    if (cached) {
      const ageSeconds = (Date.now() - new Date(cached.checkedAt).getTime()) / 1000;
      if (ageSeconds < cacheSeconds) {
        return {
          ok: cached.ok,
          missing: config.channels.filter((channel) => cached.missingIds.includes(channel.id)),
          unknown: config.channels.filter((channel) => cached.unknownIds.includes(channel.id)),
          checkedAt: cached.checkedAt,
        };
      }
    }
  }

  const missing: ForceMembershipChannel[] = [];
  const unknown: ForceMembershipChannel[] = [];

  for (const channel of config.channels) {
    if (!channel.required) continue;
    if (channel.platform !== platform) {
      unknown.push(channel);
      continue;
    }
    if (channel.chatId === context.userId) continue;
    const member = await context.api.getChatMember(channel.chatId, context.userId);
    if (member.status === 'unknown') {
      unknown.push(channel);
    } else if (!member.isMember) {
      missing.push(channel);
    }
  }

  const checkedAt = new Date().toISOString();
  const result: MembershipCheckResult = { ok: missing.length === 0, missing, unknown, checkedAt };

  if (cacheSeconds > 0) {
    await context.storage.sessions.set(
      context.bot.id,
      context.userId,
      CACHE_KEY,
      { ok: result.ok, missingIds: missing.map((item) => item.id), unknownIds: unknown.map((item) => item.id), checkedAt },
      cacheSeconds,
    );
  }
  return result;
}

export function buildForceMembershipPrompt(config: ForceMembershipConfig, missing: ForceMembershipChannel[]): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const lines = [config.message || 'برای استفاده از ربات ابتدا در کانال‌های زیر عضو شوید.', ''];
  const links: Array<{ text: string; url: string }> = [];
  missing.forEach((channel, index) => {
    lines.push(`${index + 1}. ${escapeHtml(channel.title)}`);
    if (channel.inviteLink) {
      links.push({ text: `${config.buttonLabel} — ${channel.title}`.slice(0, 60), url: channel.inviteLink });
    }
  });
  lines.push('', 'پس از عضویت، دکمه بررسی مجدد را بزنید.');

  const rows: InlineKeyboard['rows'] = links.map((link) => [{ text: link.text, url: link.url }]);
  rows.push([{ text: config.recheckLabel || 'بررسی مجدد', callbackData: 'a:__fsm_check' }]);
  return { text: lines.join('\n'), keyboard: { rows } };
}

export async function invalidateMembershipCache(context: { botId: string; userId: string; storage: Storage }): Promise<void> {
  await context.storage.sessions.delete(context.botId, context.userId, CACHE_KEY);
}
