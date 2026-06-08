import { queryOptions } from '@tanstack/react-query';
import { api } from '../services/api-client.js';
import { queryKeys } from './keys.js';

export const skillQueries = {
  list: () =>
    queryOptions({
      queryKey: queryKeys.skills.list(),
      queryFn: () => api('GET /api/skills'),
    }),

  platform: () =>
    queryOptions({
      queryKey: queryKeys.skills.platform(),
      queryFn: () => api('GET /api/skills/platform'),
    }),

  workspace: () =>
    queryOptions({
      queryKey: queryKeys.skills.workspace(),
      queryFn: () => api('GET /api/skills/workspace'),
    }),

  detail: (name: string) =>
    queryOptions({
      queryKey: queryKeys.skills.detail(name),
      queryFn: () => api('GET /api/skills/:name', { params: { name } }),
    }),
};
