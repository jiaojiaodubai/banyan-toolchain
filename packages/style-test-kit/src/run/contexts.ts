/**
 * CitationSpec -> CitationContext[] construction.
 *
 * A spec references items by key, `#item_*` node or numeric id; the builder
 * resolves them against the test library, converts each to a Banyan item, and
 * assigns deterministic ids and pages when the spec does not.
 */
import type { CitationContext, CitationParams } from "../banyan";
import { TestLibrary } from "../library/library";

/** One cited item: library reference plus optional cite params. */
export type CiteSpec = {
  item: string | number;
  params?: CitationParams;
};

/** One citation context to generate. */
export type CitationSpec = {
  id?: string;
  cites: CiteSpec[];
  /** 1-based page the citation appears on (defaults to the context index). */
  page?: number;
  params?: CitationParams;
};

export type ContextsInput =
  readonly CitationSpec[] | { contexts: readonly CitationSpec[] };

function normalizeInput(input: ContextsInput): readonly CitationSpec[] {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray((input as { contexts?: unknown }).contexts)) {
    return (input as { contexts: readonly CitationSpec[] }).contexts;
  }
  throw new Error(
    "Contexts input must be a CitationSpec[] or { contexts: CitationSpec[] }.",
  );
}

/** Build the `CitationContext[]` a style's `generate()` expects. */
export function buildContexts(
  library: TestLibrary,
  input: ContextsInput,
): CitationContext[] {
  return normalizeInput(input).map((spec, index) => {
    if (!spec || !Array.isArray(spec.cites)) {
      throw new Error(`contexts[${index}] must carry a cites array.`);
    }
    return {
      id: spec.id ?? `citation-${index + 1}`,
      page: spec.page ?? index + 1,
      params: { ...(spec.params ?? {}) },
      cites: spec.cites.map((cite) => {
        if (cite === null || typeof cite !== "object" || !("item" in cite)) {
          throw new Error(
            `contexts[${index}].cites entries must be { item, params? } objects.`,
          );
        }
        return {
          item: library.toBanyanItem(library.require(cite.item)),
          params: { ...(cite.params ?? {}) },
        };
      }),
    };
  });
}
