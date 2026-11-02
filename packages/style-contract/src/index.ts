/**
 * `@banyan/style-contract`: the executor-neutral part of the Banyan style
 * declaration contract.
 *
 * It owns:
 * - declaration field sets, caps, reserved keys and key normalization;
 * - the stable diagnostic catalogue and the reviewed executor policy;
 * - generated item-type / CSL vocabulary facts and their revision.
 *
 * It does not own AST traversal, sandbox bridging, author callbacks, warning
 * prose, ESLint rule names or Zotero host capabilities.
 */
export * from "./diagnostics.js";
export * from "./constants.js";
export * from "./schema.js";
