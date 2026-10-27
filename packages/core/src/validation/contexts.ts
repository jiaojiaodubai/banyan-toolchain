/**
 * Shape checks and defaults for what a caller hands to `generate()`.
 *
 * Mapping Zotero, RDF or API data onto Banyan Items is the host's job (see
 * `dev/hostIntegration.md`, "Preparing style input"), and the core does not
 * validate item contents. It does validate the context array, because a
 * malformed one would otherwise surface much later as an unmatchable citation
 * id — a message that sends the author looking in the wrong place.
 *
 * The returned array is a copy with `params` defaulted to `{}`; a missing
 * `params` object would otherwise put `undefined` into the published
 * `Citation.source` shape and make the sandbox's safe view leak `undefined`.
 */
import type {
  CitationContext,
  CitationParams,
  CitationSource,
} from "../types/style";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}

function inputError(message: string, sourcePath: string): Error {
  return createBanyanRuntimeError(message, {
    code: "generate-input",
    sourcePath,
  });
}

export function normalizeCitationContexts(
  contexts: unknown,
): CitationContext[] {
  if (!Array.isArray(contexts)) {
    throw inputError(
      `generate() expects an array of contexts, received ${describeValue(contexts)}.`,
      "generate(contexts)",
    );
  }

  const normalized: CitationContext[] = [];
  const seenIds = new Set<string>();

  contexts.forEach((entry, index) => {
    const record =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!record) {
      throw inputError(
        `generate() received contexts[${index}] that is not an object (${describeValue(entry)}).`,
        `contexts[${index}]`,
      );
    }

    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      throw inputError(
        `generate() received contexts[${index}] without a non-empty string id.`,
        `contexts[${index}].id`,
      );
    }
    if (seenIds.has(id)) {
      // The output side matches a citation back by id; two contexts with one id
      // would silently attribute both outputs to the last of them.
      throw inputError(
        `generate() received duplicate context id "${id}" at contexts[${index}].`,
        `contexts[${index}].id`,
      );
    }
    seenIds.add(id);

    if (typeof record.page !== "number" || !Number.isFinite(record.page)) {
      throw inputError(
        `generate() received contexts[${index}] without a finite number page.`,
        `contexts[${index}].page`,
      );
    }

    if (!Array.isArray(record.cites)) {
      throw inputError(
        `generate() received contexts[${index}].cites that is not an array (${describeValue(record.cites)}).`,
        `contexts[${index}].cites`,
      );
    }

    // A cite is spread into the sandbox and read through property access; a
    // primitive or null here would either throw deep in parameter resolution or
    // produce a blank item that violates the safe-view contract.
    for (const [citeIndex, cite] of record.cites.entries()) {
      const citePath = `contexts[${index}].cites[${citeIndex}]`;
      if (!cite || typeof cite !== "object" || Array.isArray(cite)) {
        throw inputError(
          `generate() received ${citePath} that is not an object (${describeValue(cite)}).`,
          citePath,
        );
      }
      const citeRecord = cite as Record<string, unknown>;
      const citeParams = citeRecord.params;
      if (
        citeParams != null &&
        (typeof citeParams !== "object" || Array.isArray(citeParams))
      ) {
        throw inputError(
          `generate() received ${citePath}.params that is not an object (${describeValue(citeParams)}).`,
          `${citePath}.params`,
        );
      }
      if (
        !citeRecord.item ||
        typeof citeRecord.item !== "object" ||
        Array.isArray(citeRecord.item)
      ) {
        throw inputError(
          `generate() received ${citePath}.item that is not an object (${describeValue(citeRecord.item)}).`,
          `${citePath}.item`,
        );
      }
    }

    const params = record.params ?? {};
    if (typeof params !== "object" || Array.isArray(params)) {
      throw inputError(
        `generate() received contexts[${index}].params that is not an object (${describeValue(params)}).`,
        `contexts[${index}].params`,
      );
    }

    normalized.push({
      ...(record as CitationContext),
      id,
      params: params as CitationParams,
    } satisfies CitationSource & { id: string; page: number });
  });

  return normalized;
}
