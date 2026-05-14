import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
  }
);
