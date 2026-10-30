import type { FastifyInstance } from 'fastify';
import { notFound } from '@botforge/core';
import { botCatalog, getBotTemplate, templateCategories } from '@botforge/bot-templates';
import type { AppContext } from '../context';

export async function registerTemplateRoutes(app: FastifyInstance, _context: AppContext): Promise<void> {
  app.get('/api/catalog', async () => ({
    categories: templateCategories,
    bots: botCatalog,
    total: botCatalog.length,
  }));

  app.get('/api/templates', async () => ({
    items: botCatalog.map((entry) => ({
      id: entry.id,
      number: entry.number,
      name: entry.name,
      category: entry.category,
      summary: entry.summary,
      icon: entry.icon,
      tags: entry.tags,
      version: entry.version,
      commands: entry.commands,
      requirements: entry.requirements,
    })),
    categories: templateCategories,
  }));

  app.get('/api/templates/:id', async (request) => {
    const { id } = request.params as { id: string };
    const template = getBotTemplate(id);
    if (!template) throw notFound('قالب ربات پیدا نشد');
    return {
      id: template.id,
      name: template.name,
      category: template.category,
      summary: template.summary,
      description: template.description,
      icon: template.icon,
      tags: template.tags,
      version: template.version,
      commands: template.commands,
      menu: template.menu,
      requirements: template.requirements,
      defaultConfig: template.defaultConfig,
    };
  });
}
