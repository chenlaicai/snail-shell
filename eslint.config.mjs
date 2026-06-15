import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".claude/**", ".meta/**", ".git/**", "data/**", "logs/**", "docs/**", "v1/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "complexity": ["error", 12],
      "max-depth": ["error", 4],
      "max-lines": ["error", { max: 450, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 5],
      "max-statements": ["error", 25],
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
    files: ["tests/**/*.ts"],
    rules: {
      "complexity": ["error", 20],
      "max-lines-per-function": ["error", { max: 220, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 140],
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["src/app/**/*.ts", "src/**/*initor.ts", "src/**/initor.ts", "src/infra/acs/_internal/agents/*.ts", "src/main.ts", "src/**/*/_internal/adapter.ts", "src/domain/snail-mcp-server/_internal/servers/*.ts"],
    rules: {
      "complexity": ["error", 14],
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 6],
      "max-statements": ["error", 35]
    }
  },

  // ========== _internal 私有性约束 ==========
  // 禁止跨模块 import _internal 目录
  {
    files: ["src/domain/workspace/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },
  {
    files: ["src/domain/tenet-prompt/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/workspace/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },
  {
    files: ["src/domain/skill/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },
  {
    files: ["src/domain/sop/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },
  {
    files: ["src/domain/im/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/knowledge/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },
  {
    files: ["src/domain/knowledge/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*"],
          message: "_internal 是模块私有目录，不能跨模块 import"
        }]
      }]
    }
  },

  // main.ts 可以 import 所有 _internal（组装层）
  {
    files: ["src/main.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": "off"
    }
  }
);
