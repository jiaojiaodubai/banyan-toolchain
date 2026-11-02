/**
 * CitationSpec -> CitationContext[] construction.
 *
 * A spec references items by key, `#item_*` node or numeric id; the builder
 * resolves them against the test library, converts each to a Banyan item, and
 * assigns deterministic ids and pages when the spec does not.
 *
 * Note contexts follow the host convention: a footnote context sends a real
 * page plus `noteType: "footnote"`; an endnote context sends
 * `noteType: "endnote"` and `page: 0`, the sentinel for "no page semantics".
 * In-text citations and legacy hosts omit `noteType` and keep a real page.
 */
import type { CitationContext, CitationParams, NoteType } from "../banyan";
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
  /**
   * 1-based page the citation appears on (defaults to the context index).
   * Endnote contexts use `0` for "no page semantics" and default to it.
   */
  page?: number;
  /**
   * Note kind for note-citation styles: a footnote context sends
   * `"footnote"` with a real page, an endnote context sends `"endnote"` and
   * `page: 0`. Omit for in-text citations and legacy hosts.
   */
  noteType?: NoteType;
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

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  return Array.isArray(value) ? "an array" : "an object";
}

/**
 * The test kit fails early on note contexts the core would reject later (and
 * on ambiguous page semantics), so a malformed fixture names itself here. The
 * core stays the final validator of what a host actually sends.
 */
function validateNoteType(
  noteType: unknown,
  index: number,
): NoteType | undefined {
  if (noteType === undefined) return undefined;
  if (noteType !== "footnote" && noteType !== "endnote") {
    throw new Error(
      `contexts[${index}].noteType must be "footnote" or "endnote" (received ${describeValue(noteType)}).`,
    );
  }
  return noteType;
}

/** Default page: `0` for endnotes, the context index + 1 otherwise. */
function resolvePage(
  spec: CitationSpec,
  noteType: NoteType | undefined,
  index: number,
): number {
  if (noteType !== "endnote") return spec.page ?? index + 1;
  if (spec.page !== undefined && spec.page !== 0) {
    throw new Error(
      `contexts[${index}] is an endnote context and must use page 0, the "no page semantics" sentinel (received ${describeValue(spec.page)}).`,
    );
  }
  return 0;
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
    const noteType = validateNoteType(spec.noteType, index);
    const context: CitationContext = {
      id: spec.id ?? `citation-${index + 1}`,
      page: resolvePage(spec, noteType, index),
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
    // Only supplied note kinds reach the context: an absent `noteType` is the
    // in-text/legacy host signal, not an explicit `undefined` value.
    if (noteType !== undefined) context.noteType = noteType;
    return context;
  });
}
