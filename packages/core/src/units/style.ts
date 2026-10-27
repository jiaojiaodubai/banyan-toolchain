/**
 * Sanitizing and whitelisting a `RenderStyle`.
 *
 * The declaration is data: only the keys `RenderStyle` defines survive, and a
 * color that is not a plain CSS color is dropped rather than copied into marks.
 * Used by both generate-output normalization and the public compile path.
 */
import type { RenderStyle } from "../types/unit";
import { sanitizeCssColor } from "../richText/html";

export function sanitizeRenderStyle(input: unknown): RenderStyle {
  if (!input || typeof input !== "object") {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const out: RenderStyle = {};
  if (typeof raw.italic === "boolean") out.italic = raw.italic;
  if (typeof raw.bold === "boolean") out.bold = raw.bold;
  if (raw.script === "superscript" || raw.script === "subscript") {
    out.script = raw.script;
  }
  if (typeof raw.color === "string") {
    const color = sanitizeCssColor(raw.color);
    if (color) out.color = color;
  }
  if (typeof raw.backgroundColor === "string") {
    const backgroundColor = sanitizeCssColor(raw.backgroundColor);
    if (backgroundColor) out.backgroundColor = backgroundColor;
  }
  return out;
}
