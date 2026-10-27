import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "pnpm-lock.yaml"],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
