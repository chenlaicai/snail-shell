import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Layer dependency enforcement via no-restricted-imports
      // types/config → no deps from higher layers
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/*', '@/db'],
              message: 'types/ and config/ cannot import from db/',
            },
            {
              group: ['@/workflow/*', '@/workflow'],
              message: 'types/ and config/ cannot import from workflow/',
            },
            {
              group: ['@/agent/*', '@/agent'],
              message: 'types/ and config/ cannot import from agent/',
            },
            {
              group: ['@/collaboration/*', '@/collaboration'],
              message: 'types/ and config/ cannot import from collaboration/',
            },
            {
              group: ['@/server/*', '@/server'],
              message: 'types/ and config/ cannot import from server/',
            },
            {
              group: ['@/web/*', '@/web'],
              message: 'Cannot import from web/ in backend code',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'legacy/', 'node_modules/', '*.config.*'],
  },
);
