const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "doi:", "banyan:"]);

/**
 * A CSS color value the renderer may put into a `style` attribute.
 *
 * The allowlist matters: `color`/`backgroundColor` marks come from style output,
 * rich-text editors and parsed markup, and a value containing `;` would add
 * arbitrary declarations to the attribute. Named colors, hex values and the
 * functional forms cover everything the model documents; anything else is
 * dropped, so the renderer never has to escape its way out of CSS syntax.
 */
const CSS_COLOR_PATTERN =
  /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9a-z%.,\s/+-]*\))$/i;
const MAX_CSS_COLOR_LENGTH = 100;
const MAX_LINK_LENGTH = 2_048;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: unknown): string {
  return escapeHtml(value);
}

export function sanitizeCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const color = value.trim();
  if (!color || color.length > MAX_CSS_COLOR_LENGTH) {
    return undefined;
  }
  return CSS_COLOR_PATTERN.test(color) ? color : undefined;
}

export function sanitizeLink(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const link = value.trim();
  if (!link || link.length > MAX_LINK_LENGTH || hasControlCharacters(link)) {
    return undefined;
  }

  const protocol = getLinkProtocol(link);
  if (!protocol || !ALLOWED_LINK_PROTOCOLS.has(protocol)) {
    return undefined;
  }

  if (protocol === "banyan:" && !parseBanyanEntryLink(link)) {
    return undefined;
  }

  return link;
}

function hasControlCharacters(value: string): boolean {
  // C0/C1 controls are never valid in an attribute value; bidi overrides can
  // make a displayed link point somewhere else than it reads.
  return /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value);
}

export function parseBanyanEntryLink(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.trim().match(/^banyan:\/\/entry\/([^/?#]+)$/i);
  if (!match) {
    return undefined;
  }
  const encoded = match[1];
  if (encoded === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Malformed escapes are a bad link, not a broken run.
    return undefined;
  }
}

function getLinkProtocol(link: string): string | undefined {
  const match = link.match(/^([a-z][a-z0-9+.-]*):/i);
  const protocol = match?.[1];
  return protocol ? `${protocol.toLowerCase()}:` : undefined;
}
