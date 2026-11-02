/**
 * Language tag normalization and matching.
 *
 * Two normalizers exist on purpose: the strict one (`normalizeLanguageCode`)
 * validates dialog input against CLDR and rejects tags with no data, while the
 * lenient one (`normalizeStyleLanguageTag`) never rejects, because a style may
 * query any tag a user typed. Matching prefers an exact canonical tag and falls
 * back to the prefix rule (`zh` <-> `zh-CN`).
 */
export type StyleLanguageCandidate<T> = {
  item: T;
  /** Leniently normalized tag; never empty (items without one are dropped). */
  language: string;
  isSource?: boolean;
};

const LANGUAGE_TAG_PATTERN =
  /^([a-z]{2,8})(?:-([a-z]{4}))?(?:-([a-z]{2}|[0-9]{3}))?$/i;
const NON_COUNTRY_ALPHA_REGION_CODES = new Set([
  "AC",
  "CP",
  "DG",
  "EA",
  "EU",
  "EZ",
  "IC",
  "QO",
  "UN",
  "XA",
  "XB",
]);
const NON_COUNTRY_NUMERIC_REGION_CODES = new Set([
  "001",
  "002",
  "003",
  "005",
  "009",
  "011",
  "013",
  "014",
  "015",
  "017",
  "018",
  "019",
  "021",
  "029",
  "030",
  "034",
  "035",
  "039",
  "053",
  "054",
  "057",
  "061",
  "142",
  "143",
  "145",
  "150",
  "151",
  "154",
  "155",
  "202",
]);

// Constructing `Intl.DisplayNames` dominates this hot path (once per reference
// per lookup), so the formatters and results are cached for the session.
//
// LIMIT(session lifetime): the tag maps are deliberately not cleared — a
// library's distinct language tags are a small, stable set, and exposing a
// reset API would add mutable global state for no product need. A caller that
// processes unbounded tag vocabularies should reuse one process per corpus
// rather than expect eviction here.
let languageDisplayNames: Intl.DisplayNames | null = null;
let scriptDisplayNames: Intl.DisplayNames | null = null;
let regionDisplayNames: Intl.DisplayNames | null = null;
const validatedLanguageTags = new Map<string, string | null>();
const styleLanguageTags = new Map<string, string>();

function getDisplayNames(
  type: "language" | "script" | "region",
): Intl.DisplayNames {
  if (type === "language") {
    languageDisplayNames ??= new Intl.DisplayNames(["en"], { type });
    return languageDisplayNames;
  }
  if (type === "script") {
    scriptDisplayNames ??= new Intl.DisplayNames(["en"], { type });
    return scriptDisplayNames;
  }
  regionDisplayNames ??= new Intl.DisplayNames(["en"], { type });
  return regionDisplayNames;
}

/** Strict BCP 47 for dialog input; memoized, rejects tags with no data. */
export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const languageCode = value.trim().replace(/_/g, "-");
  if (!languageCode) {
    return null;
  }
  const cached = validatedLanguageTags.get(languageCode);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = validateLanguageTag(languageCode);
  validatedLanguageTags.set(languageCode, normalized);
  return normalized;
}

function validateLanguageTag(languageCode: string): string | null {
  const match = LANGUAGE_TAG_PATTERN.exec(languageCode);
  if (!match) {
    return null;
  }

  try {
    const locale = new Intl.Locale(languageCode);
    const languageName = getDisplayNames("language").of(locale.language);
    if (
      !languageName ||
      languageName.toLowerCase() === locale.language ||
      /unknown language/i.test(languageName)
    ) {
      return null;
    }

    if (match[2]) {
      const script = locale.script ?? "";
      const scriptName = getDisplayNames("script").of(script);
      if (
        !scriptName ||
        scriptName.toLowerCase() === script.toLowerCase() ||
        /unknown script/i.test(scriptName)
      ) {
        return null;
      }
    }

    if (match[3]) {
      const region = locale.region ?? "";
      const regionName = getDisplayNames("region").of(region);
      if (
        !regionName ||
        regionName.toLowerCase() === region.toLowerCase() ||
        /unknown region/i.test(regionName) ||
        (/^[a-z]{2}$/i.test(region) &&
          NON_COUNTRY_ALPHA_REGION_CODES.has(region.toUpperCase())) ||
        NON_COUNTRY_NUMERIC_REGION_CODES.has(region)
      ) {
        return null;
      }
    }

    return locale.toString();
  } catch {
    return null;
  }
}

/** Lenient BCP 47 for lookups; never rejects a tag, unlike the strict one. */
export function normalizeStyleLanguageTag(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const languageCode = String(value).trim().replace(/_/g, "-").toLowerCase();
  if (!languageCode) {
    return "";
  }
  const cached = styleLanguageTags.get(languageCode);
  if (cached !== undefined) {
    return cached;
  }
  let normalized = languageCode;
  try {
    normalized = new Intl.Locale(languageCode).toString().toLowerCase();
  } catch {
    // Keep the textual form; the prefix rule still compares it as written.
  }
  styleLanguageTags.set(languageCode, normalized);
  return normalized;
}

/**
 * Best match among already-normalized candidates: exact canonical tag first,
 * then the prefix rule (`zh` ↔ `zh-CN`); ties break by source, tag, ID.
 */
export function findLanguageMatch<T extends { id: string }>(
  candidates: readonly StyleLanguageCandidate<T>[],
  preference: string,
): T | null {
  const normalizedPreference = normalizeStyleLanguageTag(preference);
  if (!normalizedPreference) {
    return null;
  }

  const exact = candidates.filter(
    (candidate) => candidate.language === normalizedPreference,
  );
  const pool = exact.length
    ? exact
    : candidates.filter(
        (candidate) =>
          candidate.language.startsWith(`${normalizedPreference}-`) ||
          normalizedPreference.startsWith(`${candidate.language}-`),
      );
  if (!pool.length) {
    return null;
  }

  const first = pool[0];
  if (!first) {
    return null;
  }
  let best = first;
  for (const candidate of pool) {
    if (isBetterStyleMatch(candidate, best)) {
      best = candidate;
    }
  }
  return best.item;
}

function isBetterStyleMatch<T extends { id: string }>(
  candidate: StyleLanguageCandidate<T>,
  current: StyleLanguageCandidate<T>,
): boolean {
  if (Boolean(candidate.isSource) !== Boolean(current.isSource)) {
    return Boolean(candidate.isSource);
  }
  if (candidate.language !== current.language) {
    return candidate.language < current.language;
  }
  // IDs are opaque host handles now, so code-unit order is the only ordering
  // that means the same thing on every host (and it is stable for ties).
  return candidate.item.id < current.item.id;
}
