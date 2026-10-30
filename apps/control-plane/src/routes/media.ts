import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { verifyMediaToken } from '@botforge/bot-templates';
import { badRequest, notFound } from '@botforge/core';
import type { AppContext } from '../context';

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

const SAFE_NAME = /^[a-z0-9]{4,64}\.[a-z0-9]{1,5}$/i;

export async function registerMediaRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/media/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const query = request.query as { token?: string };
    if (!file || !SAFE_NAME.test(file)) throw badRequest('نام فایل نامعتبر است');
    const token = query.token ?? '';
    if (!token) throw badRequest('توکن دسترسی لازم است');
    if (!verifyMediaToken(file, token, context.config.SECRET_MASTER_KEY)) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'توکن فایل نامعتبر یا منقضی شده است' } });
      return;
    }

    const mediaRoot = normalize(context.config.MEDIA_DIR);
    const fullPath = normalize(join(mediaRoot, file));
    if (!fullPath.startsWith(mediaRoot.endsWith(sep) ? mediaRoot : `${mediaRoot}${sep}`)) {
      throw badRequest('مسیر فایل نامعتبر است');
    }

    let size: number;
    try {
      const info = await stat(fullPath);
      if (!info.isFile()) throw notFound('فایل پیدا نشد');
      size = info.size;
    } catch {
      throw notFound('فایل پیدا نشد یا منقضی شده است');
    }

    const extension = extname(file).toLowerCase();
    reply
      .header('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream')
      .header('Content-Length', String(size))
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="${file}"`);
    return reply.send(createReadStream(fullPath));
  });
}
