import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * 模块边界守护规则
 *
 * 基于 docs/features/20260513/F2026051307-module-refactor.md 定义的依赖方向：
 * shared ← persistence
 * shared ← prompt-center ← skill-center
 * shared ← snail-den (← agent/)
 * shared ← message-bus (← persistence)
 * 以上全部 ← project-workflow
 * 以上全部 ← knowledge-center
 * 以上全部 ← interaction-entry
 */

/** 内部模块列表（用于 shared 模块的禁止导入规则） */
const internalModules = [
  "../persistence",
  "../persistence/**",
  "../meta",
  "../meta/**",
  "../prompt-center",
  "../prompt-center/**",
  "../skill-center",
  "../skill-center/**",
  "../snail-den",
  "../snail-den/**",
  "../snails",
  "../snails/**",
  "../agent",
  "../agent/**",
  "../llm",
  "../llm/**",
  "../message-bus",
  "../message-bus/**",
  "../project-workflow",
  "../project-workflow/**",
  "../knowledge-center",
  "../knowledge-center/**",
  "../interaction-entry",
  "../interaction-entry/**",
  "../logger",
  "../logger/**",
];

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".claude/**", ".meta/**", ".git/**", "data/**", "logs/**", "docs/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/web/**/*.js"],
    languageOptions: {
      globals: {
        alert: "readonly",
        CSS: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        Node: "readonly",
        prompt: "readonly",
        setTimeout: "readonly",
        WebSocket: "readonly"
      }
    },
    rules: {
      "complexity": ["error", 40],
      "max-lines": ["error", { max: 900, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 160, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 40]
    }
  },
  {
    files: ["src/web/app.js"],
    rules: {
      "complexity": ["error", 40],
      "max-lines": ["error", { max: 980, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 160, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 40]
    }
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "complexity": ["error", 10],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "max-statements": ["error", 20],
      "no-console": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: ["src/bin/**/*.ts"],
    rules: {
      "complexity": ["error", 14],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 30]
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "complexity": ["error", 20],
      "max-lines-per-function": ["error", { max: 220, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 140],
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: [
      "src/interaction-entry/api/server.ts",
      "src/agent/claude-code.ts",
      "src/message-bus/collaboration.ts",
      "src/project-workflow/tool-use.ts",
      "src/snails/prompt-builder.ts",
      "src/prompt-center/builder.ts",
      "src/persistence/store.ts"
    ],
    rules: {
      "complexity": ["error", 18],
      "max-lines": ["error", { max: 620, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 6],
      "max-statements": ["error", 40]
    }
  },
  {
    files: [
      "src/project-workflow/manager.ts",
    ],
    rules: {
      "complexity": ["error", 18],
      "max-lines": ["error", { max: 620, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 6],
      "max-statements": ["error", 40]
    }
  },
  {
    files: [
      "src/message-bus/agent-message.ts",
      "src/message-bus/message-out.ts",
      "src/project/message-parts.ts",
      "src/persistence/knowledge-model.ts",
      "src/persistence/helpers.ts",
      "src/api/knowledge-routes.ts",
      "src/bin/message-out.ts"
    ],
    rules: {
      "complexity": ["error", 27],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 30]
    }
  },

  // ========== 模块边界守护规则 ==========

  // shared/: 零依赖基础类型层，不能导入任何内部模块
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: internalModules,
          message: "shared 是零依赖基础类型层，不能导入其他内部模块"
        }]
      }]
    }
  },

  // persistence/: 只能依赖 shared
  {
    files: ["src/persistence/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "../meta", "../meta/**",
            "../prompt-center", "../prompt-center/**",
            "../skill-center", "../skill-center/**",
            "../snail-den", "../snail-den/**",
            "../snails", "../snails/**",
            "../agent", "../agent/**",
            "../llm", "../llm/**",
            "../message-bus", "../message-bus/**",
            "../project-workflow", "../project-workflow/**",
            "../knowledge-center", "../knowledge-center/**",
            "../interaction-entry", "../interaction-entry/**",
          ],
          message: "persistence 只能依赖 shared，不能导入其他内部模块"
        }]
      }]
    }
  },

  // prompt-center/: 只能依赖 shared
  {
    files: ["src/prompt-center/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "../persistence", "../persistence/**",
            "../meta", "../meta/**",
            "../skill-center", "../skill-center/**",
            "../snail-den", "../snail-den/**",
            "../snails", "../snails/**",
            "../agent", "../agent/**",
            "../llm", "../llm/**",
            "../message-bus", "../message-bus/**",
            "../project-workflow", "../project-workflow/**",
            "../knowledge-center", "../knowledge-center/**",
            "../interaction-entry", "../interaction-entry/**",
          ],
          message: "prompt-center 只能依赖 shared，不能导入其他内部模块"
        }]
      }]
    }
  },

  // skill-center/: 可以依赖 shared、prompt-center
  {
    files: ["src/skill-center/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "../persistence", "../persistence/**",
            "../meta", "../meta/**",
            "../snail-den", "../snail-den/**",
            "../snails", "../snails/**",
            "../agent", "../agent/**",
            "../llm", "../llm/**",
            "../message-bus", "../message-bus/**",
            "../project-workflow", "../project-workflow/**",
            "../knowledge-center", "../knowledge-center/**",
            "../interaction-entry", "../interaction-entry/**",
          ],
          message: "skill-center 只能依赖 shared、prompt-center，不能导入其他内部模块"
        }]
      }]
    }
  },

  // snail-den/: 可以依赖 shared、agent
  {
    files: ["src/snail-den/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "../persistence", "../persistence/**",
            "../meta", "../meta/**",
            "../prompt-center", "../prompt-center/**",
            "../skill-center", "../skill-center/**",
            "../snails", "../snails/**",
            "../llm", "../llm/**",
            "../message-bus", "../message-bus/**",
            "../project-workflow", "../project-workflow/**",
            "../knowledge-center", "../knowledge-center/**",
            "../interaction-entry", "../interaction-entry/**",
          ],
          message: "snail-den 只能依赖 shared、agent，不能导入其他内部模块"
        }]
      }]
    }
  },

  // message-bus/: 可以依赖 shared、persistence
  {
    files: ["src/message-bus/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "../meta", "../meta/**",
            "../prompt-center", "../prompt-center/**",
            "../skill-center", "../skill-center/**",
            "../snail-den", "../snail-den/**",
            "../snails", "../snails/**",
            "../agent", "../agent/**",
            "../llm", "../llm/**",
            "../project-workflow", "../project-workflow/**",
            "../knowledge-center", "../knowledge-center/**",
            "../interaction-entry", "../interaction-entry/**",
          ],
          message: "message-bus 只能依赖 shared、persistence，不能导入其他内部模块"
        }]
      }]
    }
  }
);
