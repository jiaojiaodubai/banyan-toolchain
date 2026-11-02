/**
 * Compile-time consumer smoke test: resolves `@banyan/core` and its
 * `types/*` subpath through the package exports, under `node16` resolution.
 * Run after `pnpm build` (see `pnpm typecheck:consumer`).
 */
import type {
  ScriptContexts,
  ScriptOptions,
  StyleOptionParam,
  StyleResult,
} from "@banyan/core/types/style";
import { createStyle } from "@banyan/core";

const params: StyleOptionParam[] = [
  { id: "mode", kind: "state", label: "Mode", defaultValue: false },
];
const options: ScriptOptions = { mode: true };
const contexts: ScriptContexts = [];
const result: StyleResult = { citations: [], bibliography: [] };

void params;
void options;
void contexts;
void result;
void createStyle;
