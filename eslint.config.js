import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "styles/flowra.css",
      "supabase/**",
      "coverage/**",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: { version: "19" },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": ["error", { ignore: ["data-export-menu", "data-open"] }],
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-irregular-whitespace": ["error", { skipStrings: true, skipJSXText: true }],
      "react-hooks/exhaustive-deps": "warn",
      // Plugin v7 strict rules still fire on the legitimate but
      // entangled cloud-sync helpers — `refreshCloudBackup`,
      // `syncScenarioToCloud`, and `transitionApply` are declared after
      // the effects that close over them. Fixing that requires lifting
      // them above the effects (or extracting them into a custom hook),
      // which is the next refactor. Until then, keep the rule off.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/unsupported-syntax": "off",
    },
  },
  {
    files: ["**/*.test.js", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
