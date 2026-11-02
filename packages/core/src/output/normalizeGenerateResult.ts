import type {
  BibliographyLine,
  Citation,
  CitationContext,
  CitationSource,
  Style,
} from "../types/style";
import type { RichText, TextUnit } from "../types/unit";
import { richTextFromRuns, type RichTextRun } from "../richText/richText";
import { normalizeRichText } from "../richText/richText";
import {
  assertArrayLengthWithinBudget,
  normalizeUnitInput,
} from "../units/normalize";
import {
  compileUnitTree,
  finalizeCompiledUnit,
  type CompiledTextUnit,
} from "../units/compile";
import {
  decodeEntities,
  looksLikeMarkup,
  splitTextUnitByMarkup,
} from "./markup";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";
import { errorMessageOf } from "../sandbox/runtimeErrors";
import { requireCapability, type HtmlRootLike } from "../host";

/**
 * Validate and normalize the raw output of `generate()`.
 *
 * The result shapes are the author contract; the HTML parser is the only thing
 * the core cannot supply itself, so it arrives as a getter and is resolved on
 * use (a host may attach the capability after the style was created). Text-case
 * algorithms are the core's own, never a host choice.
 */
export type ParseHtmlProvider = () => ParseHtml | undefined;

type ParseHtml = (html: string) => HtmlRootLike | null;

export type NormalizedGenerateResult = {
  citations: Citation[];
  bibliography: BibliographyLine[];
};

export function createGenerateOutputNormalizer(
  getParseHtml?: ParseHtmlProvider,
): (
  raw: unknown,
  contexts: CitationContext[],
  styleName: string,
  citationType: Style["INFO"]["citationType"],
) => NormalizedGenerateResult {
  return (raw, contexts, styleName, citationType) =>
    normalizeGenerateResult(
      raw,
      contexts,
      styleName,
      citationType,
      getParseHtml,
    );
}

const MAX_OUTPUT_ARRAY_LENGTH = 10_000;
const MAX_TEXT_UNIT_VALUE_LENGTH = 20_000;
const MAX_OUTPUT_TEXT_LENGTH = 2_000_000;

type OutputBudget = {
  textLength: number;
};

function addTextToOutputBudget(
  value: string,
  path: string,
  budget: OutputBudget,
): void {
  if (value.length > MAX_TEXT_UNIT_VALUE_LENGTH) {
    throw createBanyanRuntimeError(
      `${path} has ${value.length} characters, exceeding the per-unit limit of ${MAX_TEXT_UNIT_VALUE_LENGTH}.`,
      {
        code: "generate-output",
        sourcePath: path,
      },
    );
  }

  budget.textLength += value.length;
  if (budget.textLength > MAX_OUTPUT_TEXT_LENGTH) {
    throw createBanyanRuntimeError(
      `generate() output text has ${budget.textLength} characters, exceeding the limit of ${MAX_OUTPUT_TEXT_LENGTH}.`,
      {
        code: "generate-output",
        sourcePath: path,
      },
    );
  }
}

/**
 * Add the field path to an error that already carries a code.
 *
 * A host capability may throw a frozen or otherwise non-extensible error; a
 * plain assignment would replace the real failure with a TypeError. The path is
 * diagnostic detail, so failing to attach it must never hide the original.
 */
function attachSourcePath(error: unknown, fieldName: string): void {
  try {
    (error as { sourcePath?: string }).sourcePath = fieldName;
  } catch {
    // Frozen/exotic throwable: keep the original error untouched.
  }
}

/**
 * The splitter handed to the Unit compiler: markup is parsed through the host's
 * capability, everything else only gets its entities decoded. The capability is
 * resolved at this point, so a host may attach it after `createStyle`.
 */
function createSplitText(
  getParseHtml: ParseHtmlProvider | undefined,
  fieldName: string,
): (base: TextUnit) => CompiledTextUnit[] {
  return (base) => {
    const value = base.value ?? "";
    if (!looksLikeMarkup(value)) {
      return [{ ...base, value: decodeEntities(value) }];
    }
    const parse = requireCapability(
      getParseHtml?.(),
      'The host does not provide the "parseHtml" capability; content containing markup cannot be normalized.',
    );
    try {
      return splitTextUnitByMarkup(base, parse);
    } catch (error) {
      // Keep failures that already carry their own attribution: a host
      // capability failure belongs to the host, while a markup depth failure is
      // the style's output. Rewrapping every non-capability error as
      // `host-capability` would send the host looking in the wrong place.
      const record = error as { code?: unknown; sourcePath?: string } | null;
      if (record?.code === "host-capability") {
        attachSourcePath(error, fieldName);
        throw error;
      }
      if (record?.code === "generate-output") {
        attachSourcePath(error, fieldName);
        throw error;
      }
      if (error instanceof RangeError) {
        throw createBanyanRuntimeError(
          `${fieldName} contains markup nested too deeply to normalize.`,
          {
            code: "generate-output",
            sourcePath: fieldName,
            cause: error,
          },
        );
      }
      throw createBanyanRuntimeError(
        `The host's "parseHtml" capability failed: ${errorMessageOf(error)}`,
        {
          code: "host-capability",
          sourcePath: fieldName,
          cause: error,
        },
      );
    }
  };
}

function normalizeTopLevelUnit(
  input: unknown,
  fieldName: string,
  budget: OutputBudget,
  getParseHtml?: ParseHtmlProvider,
): RichText {
  if (Array.isArray(input)) {
    throw createBanyanRuntimeError(
      `${fieldName} must be a single Unit. Use group([...]) or fallback([...]) to combine multiple units.`,
      {
        code: "generate-output",
        sourcePath: fieldName,
      },
    );
  }

  const out: RichTextRun[] = [];
  const compiled = compileUnitTree(normalizeUnitInput(input), {
    splitText: createSplitText(getParseHtml, fieldName),
  });
  for (const unit of compiled) {
    const finalized = finalizeCompiledUnit(unit);
    addTextToOutputBudget(finalized.value, fieldName, budget);
    pushMergedRun(out, finalized);
  }
  // Runs can carry colors collected from `style` and enough marks to exceed the
  // RichText budget; pass through the same sanitizer every other RichText does.
  const normalized = normalizeRichText(richTextFromRuns(out));
  if (!normalized) {
    throw createBanyanRuntimeError(
      `${fieldName} produced an unusable RichText value.`,
      {
        code: "generate-output",
        sourcePath: fieldName,
      },
    );
  }
  return normalized;
}

function normalizeRequiredTopLevelUnit(
  input: unknown,
  fieldName: string,
  budget: OutputBudget,
  getParseHtml?: ParseHtmlProvider,
): RichText {
  if (input == null) {
    throw createBanyanRuntimeError(`${fieldName} is required.`, {
      code: "generate-output",
      sourcePath: fieldName,
    });
  }
  return normalizeTopLevelUnit(input, fieldName, budget, getParseHtml);
}

function normalizeGenerateResult(
  raw: unknown,
  contexts: CitationContext[],
  styleName: string,
  citationType: Style["INFO"]["citationType"],
  getParseHtml?: ParseHtmlProvider,
): NormalizedGenerateResult {
  if (!raw || typeof raw !== "object") {
    const message =
      raw === undefined
        ? `Style "${styleName}" function generate has no return value. Please return { citations, bibliography }.`
        : `Style "${styleName}" function generate returned invalid value. Expected { citations, bibliography }.`;
    throw createBanyanRuntimeError(message, {
      code: "generate-output",
      sourcePath: "generate()",
    });
  }

  const result = raw as Record<string, unknown>;
  const rawCitations = result.citations;
  const rawBibliography = result.bibliography;

  if (!Array.isArray(rawCitations)) {
    throw createBanyanRuntimeError(
      `Style "${styleName}" generate().citations is not an array.`,
      {
        code: "generate-output",
        sourcePath: "generate().citations",
      },
    );
  }
  if (!Array.isArray(rawBibliography)) {
    throw createBanyanRuntimeError(
      `Style "${styleName}" generate().bibliography is not an array.`,
      {
        code: "generate-output",
        sourcePath: "generate().bibliography",
      },
    );
  }

  assertArrayLengthWithinBudget(
    rawCitations,
    "generate().citations",
    MAX_OUTPUT_ARRAY_LENGTH,
  );
  assertArrayLengthWithinBudget(
    rawBibliography,
    "generate().bibliography",
    MAX_OUTPUT_ARRAY_LENGTH,
  );

  const budget: OutputBudget = { textLength: 0 };
  const contextById = new Map(contexts.map((context) => [context.id, context]));
  const citations = rawCitations.map((citation, index) =>
    normalizeCitation(
      citation,
      contextById,
      citationType,
      `citations[${index}]`,
      budget,
      getParseHtml,
    ),
  );
  const bibliography = rawBibliography.map((line, index) =>
    normalizeBibliographyLine(
      line,
      `bibliography[${index}]`,
      budget,
      getParseHtml,
    ),
  );

  return { citations, bibliography };
}

function normalizeCitation(
  input: unknown,
  contextById: Map<string, CitationContext>,
  citationType: Style["INFO"]["citationType"],
  outputPath: string,
  budget: OutputBudget,
  getParseHtml?: ParseHtmlProvider,
): Citation {
  const citationRecord = (input ?? {}) as Record<string, unknown>;
  const id = requireNonEmptyString(citationRecord.id, `${outputPath}.id`);
  const matchedContext = contextById.get(id);
  if (!matchedContext) {
    throw createBanyanRuntimeError(
      `Citation output id "${id}" cannot be matched to input contexts.`,
      {
        code: "generate-output",
        sourcePath: `${outputPath}.id`,
      },
    );
  }

  const source: CitationSource = {
    cites: matchedContext.cites,
    params: matchedContext.params,
  };

  // The host result is built from the documented fields only: a style-supplied
  // `units`, `reference` on an in-text citation or any other key has no place
  // in `Citation` and must not reach a host by riding on `...rest`.
  const normalized: Citation & { reference?: RichText } = {
    id,
    type: citationType,
    source,
    content: normalizeRequiredTopLevelUnit(
      citationRecord.content,
      `${outputPath}.content`,
      budget,
      getParseHtml,
    ),
  };
  if (citationType === "note-citation") {
    normalized.reference = normalizeRequiredTopLevelUnit(
      citationRecord.reference,
      `${outputPath}.reference`,
      budget,
      getParseHtml,
    );
  }
  return normalized;
}

function normalizeBibliographyLine(
  input: unknown,
  outputPath: string,
  budget: OutputBudget,
  getParseHtml?: ParseHtmlProvider,
): BibliographyLine {
  const line = (input ?? {}) as Record<string, unknown>;
  const type = normalizeBibliographyLineType(line.type, `${outputPath}.type`);
  const content = normalizeRequiredTopLevelUnit(
    line.content,
    `${outputPath}.content`,
    budget,
    getParseHtml,
  );

  if (type === "bibliography-title") {
    return {
      id: requireNonEmptyString(line.id, `${outputPath}.id`),
      type: "bibliography-title",
      content,
    };
  }

  return {
    id: requireNonEmptyString(line.id, `${outputPath}.id`),
    type: "bibliography-entry",
    content,
  };
}

function normalizeBibliographyLineType(
  value: unknown,
  fieldName: string,
): BibliographyLine["type"] {
  switch (value) {
    case "bibliography-title":
    case "bibliography-entry":
      return value;
    default:
      throw createBanyanRuntimeError(
        `${fieldName} must be "bibliography-title" or "bibliography-entry".`,
        {
          code: "generate-output",
          sourcePath: fieldName,
        },
      );
  }
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const out = typeof value === "string" ? value.trim() : "";
  if (!out) {
    throw createBanyanRuntimeError(`${fieldName} must be a non-empty string.`, {
      code: "generate-output",
      sourcePath: fieldName,
    });
  }
  return out;
}

function pushMergedRun(out: RichTextRun[], unit: RichTextRun): void {
  if (!unit.value) return;
  const last = out[out.length - 1];
  if (
    !last ||
    last.bold !== unit.bold ||
    last.italic !== unit.italic ||
    last.script !== unit.script ||
    last.link !== unit.link ||
    last.color !== unit.color ||
    last.backgroundColor !== unit.backgroundColor
  ) {
    out.push(unit);
    return;
  }
  last.value += unit.value;
}

export function normalizeStyleCitationType(
  input: unknown,
  styleName: string,
): Style["INFO"]["citationType"] {
  switch (input) {
    case "intext-citation":
    case "note-citation":
      return input;
    default:
      throw createBanyanRuntimeError(
        `Style "${styleName}" has invalid INFO.citationType. Expected "intext-citation" or "note-citation".`,
        {
          code: "style-contract",
          sourcePath: "INFO.citationType",
        },
      );
  }
}
