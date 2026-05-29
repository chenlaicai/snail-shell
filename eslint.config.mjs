import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * 模块边界守护规则
 *
 * 基于 docs/features/20260513/F2026051307-module-refactor.md 定义的依赖方向：
 * shared ← persistence
 * shared ← prompt-center (← agent/) ← skill-center
 * shared ← snail-den (← agent/, llm/)
 * shared ← message-bus (← persistence, agent/)
 * 以上全部 ← project-workflow
 * 以上全部 ← knowledge-center
 * 以上全部 ← interaction-entry
 *
 * logger 是跨切面基础设施，不属于模块边界守护范围。
 */

/**
 * 生成多层级相对路径 pattern
 *
 * 为什么需要多层级：当前 pattern 只覆盖一层相对路径（如 ../meta），
 * 但嵌套目录可以用 ../../meta 绕过。为了确保边界守护的完整性，
 * 需要覆盖最多 5 层相对路径。
 *
 * 注意：不包含空层级（''），因为这会匹配模块内部导入（如 ./message-bus），
 * 而模块内部导入不应该被禁止。
 *
 * @param {string[]} modules - 模块名称列表
 * @returns {string[]} 包含多层级的 pattern 列表
 */
function generateMultiLevelPatterns(modules) {
  const patterns = [];
  const levels = ['../', '../../', '../../../', '../../../../', '../../../../../'];

  for (const module of modules) {
    for (const level of levels) {
      patterns.push(`${level}${module}`);
      patterns.push(`${level}${module}/**`);
    }
  }

  return patterns;
}

/** 内部模块列表（用于 shared 模块的禁止导入规则） */
const internalModules = [
  "persistence",
  "meta",
  "prompt-center",
  "skill-center",
  "snail-den",
  "snails",
  "agent",
  "llm",
  "message-bus",
  "project-workflow",
  "knowledge-center",
  "interaction-entry",
];

/** 多层级内部模块 pattern */
const internalModulesMultiLevel = generateMultiLevelPatterns(internalModules);

/**
 * 生成特定模块的禁止导入 pattern
 *
 * @param {string[]} allowedModules - 允许导入的模块列表
 * @returns {string[]} 禁止导入的 pattern 列表
 */
function generateForbiddenPatterns(allowedModules) {
  const forbiddenModules = internalModules.filter(m => !allowedModules.includes(m));
  return generateMultiLevelPatterns(forbiddenModules);
}

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
        ResizeObserver: "readonly",
        setTimeout: "readonly",
        WebSocket: "readonly",
        window: "readonly",
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
      "src/agent/claude-code-stateful.ts",
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
      "src/api/knowledge-routes.ts"
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
          group: internalModulesMultiLevel,
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
          group: generateForbiddenPatterns(["shared"]),
          message: "persistence 只能依赖 shared，不能导入其他内部模块"
        }]
      }]
    }
  },

  // prompt-center/: 可以依赖 shared、agent（评估 prompt 需要 agent 类型）
  {
    files: ["src/prompt-center/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: generateForbiddenPatterns(["shared", "agent"]),
          message: "prompt-center 只能依赖 shared、agent，不能导入其他内部模块"
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
          group: generateForbiddenPatterns(["shared", "prompt-center"]),
          message: "skill-center 只能依赖 shared、prompt-center，不能导入其他内部模块"
        }]
      }]
    }
  },

  // snail-den/: 可以依赖 shared、agent、llm
  {
    files: ["src/snail-den/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: generateForbiddenPatterns(["shared", "agent", "llm"]),
          message: "snail-den 只能依赖 shared、agent、llm，不能导入其他内部模块"
        }]
      }]
    }
  },

  // message-bus/: 可以依赖 shared、persistence、agent
  {
    files: ["src/message-bus/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: generateForbiddenPatterns(["shared", "persistence", "agent"]),
          message: "message-bus 只能依赖 shared、persistence、agent，不能导入其他内部模块"
        }]
      }]
    }
  }
);
