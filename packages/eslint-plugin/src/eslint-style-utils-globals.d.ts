/**
 * Build ESLint readonly globals from the keys of `type StyleUtils = ...` in the
 * generated `styleUtils.d.ts` (plus `unit.d.ts` when it is intersected).
 *
 * @param typingsDir directory containing the generated declaration files;
 *   defaults to this module's directory
 */
export function extractStyleUtilsReadonlyGlobals(
  typingsDir?: string,
): Record<string, "readonly">;
