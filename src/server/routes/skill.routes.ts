/**
 * Skill API 路由。
 *
 * 前端通过这些端点获取 skill 数据。
 */

import { Hono } from 'hono';
import type { SkillService } from '@/skill/api.js';

/** 创建 skill 路由（依赖注入 SkillService） */
export function createSkillRoutes(service: SkillService): Hono {
  const routes = new Hono();

  // GET /skills — 列出所有 skill
  routes.get('/', (c) => {
    const skills = service.listAll();
    return c.json(skills);
  });

  // GET /skills/platform — 列出平台级 skill
  routes.get('/platform', (c) => {
    const skills = service.listPlatform();
    return c.json(skills);
  });

  // GET /skills/workspace — 列出工作区级 skill
  routes.get('/workspace', (c) => {
    const skills = service.listWorkspace();
    return c.json(skills);
  });

  // GET /skills/:name — 获取单个 skill
  routes.get('/:name', (c) => {
    const name = c.req.param('name');
    const skill = service.getSkill(name);
    if (!skill) {
      return c.json({ error: `Skill not found: ${name}` }, 404);
    }
    return c.json(skill);
  });

  return routes;
}
