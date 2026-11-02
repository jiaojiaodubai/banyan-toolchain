// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Globals the core must never read. Anything a style needs from outside the
 * sandbox arrives through `StyleHostCapabilities`, so the core's own source has
 * no business reading an ambient host global.
 */
const HOST_GLOBALS = [
  "console",
  "window",
  "document",
  "navigator",
  "location",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "indexedDB",
  "DOMParser",
  "alert",
  "process",
  "require",
  "module",
  "exports",
  // Reaching `console` etc. through these would slip past `no-restricted-globals`.
  "globalThis",
  "self",
  "global",
  "Buffer",
  "setImmediate",
];

/**
 * Platforms the core is expected to run on. Their brand names are the only
 * host-specific strings in this file: they exist to ban importing a platform's
 * packages, and a host that reuses this configuration replaces the list with its
 * own.
 */
const HOST_PLATFORMS = ["zotero", "gecko", "firefox", "electron"];

const HOST_PACKAGE_PATTERNS = HOST_PLATFORMS.flatMap((platform) => [
  platform,
  `${platform}-*`,
  `${platform}/**`,
  `@${platform}/*`,
  `@${platform}/**`,
]);

/**
 * Node built-ins. Platform *natives* (`crypto`, `TextDecoder`, `Intl`, …) are
 * fine; importing a module the browser hosts do not have is not.
 */
const NODE_BUILTIN_PATTERNS = [
  "node:*",
  "fs",
  "fs/*",
  "path",
  "path/*",
  "vm",
  "child_process",
  "worker_threads",
  "os",
  "util",
  "stream",
  "buffer",
  "url",
  "crypto",
  "net",
  "http",
  "https",
];

const IMPORT_BOUNDARY = {
  group: [...HOST_PACKAGE_PATTERNS, ...NODE_BUILTIN_PATTERNS],
  message:
    "The core must not import host or Node modules; use StyleHostCapabilities or leave it to the host.",
};

/**
 * The core lints itself: the community-standard TypeScript rule sets plus the
 * boundary below. A host's own conventions, plugins and globals belong to the
 * host's configuration.
 */
export default tseslint.config(
  { ignores: ["dist/**"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `_` marks a binding that exists to be dropped or to keep a signature.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The author contract keeps `any` on purpose: fields the item schema does
    // not cover stay readable without a cast (see `src/types/style.d.ts`).
    files: ["src/types/**/*.d.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // The core is host-agnostic: it may only use the platform, its own schema
    // data, the author contract in `src/types/` and itself. Host APIs reach it
    // through `StyleHostCapabilities`, never through globals or imports.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        ...HOST_GLOBALS.map((name) => ({
          name,
          message: `"${name}" is an ambient host global; the core must go through StyleHostCapabilities.`,
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [IMPORT_BOUNDARY],
        },
      ],
      // Type-aware rules the untyped preset cannot see: a dropped promise or a
      // promise used where a callback is expected is a real bridge bug.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
);
