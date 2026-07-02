import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".claude/**", ".meta/**", ".git/**", ".snail/**", "data/**", "logs/**", "docs/**", "v1/**"],
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
      "no-console": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [{
            group: ["./*", "../*", "@shared", "@shared/*", "src/shared", "src/shared/*", "**/shared", "**/shared/*"],
            message: "src 内统一使用 @domain/@infra/@app/@api-contracts 路径别名；严禁引入 shared 目录"
          }]
        }
      ],
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
  // logger.ts 内部需要调用 console，豁免 no-console
  {
    files: ["src/web/lib/logger.ts"],
    rules: {
      "no-console": "off"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "complexity": ["error", 20],
      "max-lines-per-function": ["error", { max: 220, skipBlankLines: true, skipComments: true }],
      "max-statements": ["error", 140],
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": ["error",
        { selector: "CallExpression[callee.property.name='toHaveBeenCalledWith']", message: "禁止断言调用参数——绑定实现细节。使用返回值/状态/副作用断言替代。" },
        { selector: "CallExpression[callee.property.name='toBeCalledTimes']", message: "禁止断言调用次数——绑定实现细节。使用返回值/状态/副作用断言替代。" },
        { selector: "CallExpression[callee.property.name='toHaveBeenCalledTimes']", message: "禁止断言调用次数——绑定实现细节。使用返回值/状态/副作用断言替代。" }
      ]
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

  {
    files: ["src/shared/**/*"],
    rules: {
      "no-restricted-syntax": ["error", { selector: "Program", message: "严禁创建 src/shared 目录；DTO 放 api-contracts/web，业务模型放 domain" }]
    }
  },

  // ========== 层级方向约束 ==========
  // domain（最内层）禁止反向依赖 app 层（warn，待 F-1 修复后升级为 error）
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["warn", {
        patterns: [{
          group: ["@app/*"],
          message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
        }]
      }]
    }
  },
  // infra 层禁止依赖 app 层（warn，待 F-2 修复后升级为 error）
  {
    files: ["src/infra/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["warn", {
        patterns: [{
          group: ["@app/*"],
          message: "infra 层禁止依赖 app 层；adapter 通过 DI 接收 app 层实例"
        }]
      }]
    }
  },

  // ========== _internal 私有性约束 ==========
  // 禁止跨模块 import _internal 目录
  {
    files: ["src/domain/workspace/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },
  {
    files: ["src/domain/tenet-prompt/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/workspace/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },
  {
    files: ["src/domain/skill/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },
  {
    files: ["src/domain/sop/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*", "@domain/knowledge/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },
  {
    files: ["src/domain/im/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/knowledge/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },
  {
    files: ["src/domain/knowledge/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@app/*"],
            message: "domain 层禁止反向依赖 app 层；如需 app 层能力，应通过 port 注入"
          },
          {
            group: ["@domain/workspace/_internal/*", "@domain/tenet-prompt/_internal/*", "@domain/skill/_internal/*", "@domain/sop/_internal/*", "@domain/mcp-server/_internal/*", "@domain/mcp-client/_internal/*", "@domain/im/_internal/*"],
            message: "_internal 是模块私有目录，不能跨模块 import"
          }
        ]
      }]
    }
  },

  {
    files: ["src/web/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [{
            group: ["@shared", "@shared/*", "src/shared", "src/shared/*", "**/shared", "**/shared/*"],
            message: "严禁引入 shared 目录；DTO 放 api-contracts/web，业务模型放 domain"
          }]
        }
      ]
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
