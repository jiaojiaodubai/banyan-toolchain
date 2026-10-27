/**
 * Unit <-> restricted markup, used by the author utilities `htmlToUnit` and
 * `unitToHtml`.
 *
 * Rich-text editors store structured `RichText`, which is already a Unit. A
 * style that receives restricted markup from a parameter or an external source
 * can convert it here and never parses or concatenates HTML by hand.
 *
 * Casing is resolved while parsing: `<sc>` becomes Unicode small capitals and a
 * `nocase` span loses its case protection, because neither has a Unit form.
 */
import type { HtmlRootLike } from "../host";
import type { Unit } from "../types/unit";
import { compileRichText, type CompiledTextUnit } from "../units/compile";
import { renderRichTextToHtml } from "../richText/render";
import { splitTextUnitByMarkup } from "../output/markup";

export type ParseHtml = (html: string) => HtmlRootLike | null;

function runToUnit(run: CompiledTextUnit): Unit {
  const { value, smallCaps, noCase: _noCase, link, ...style } = run;
  let unit: Unit = { value, ...style };
  if (smallCaps) {
    // Small caps is content, not a visual mark: `text-case` resolves it to
    // Unicode small capitals, exactly like Zotero's rich-text normalization.
    unit = { type: "text-case", unit, form: "small-caps" };
  }
  if (link) {
    unit = { type: "link", unit, link };
  }
  return unit;
}

/**
 * Parse restricted markup into one Unit. Styles inside the markup become
 * `TextUnit` styles, `<sc>` becomes a small-caps text case and links become
 * `link()` units; the value can then be composed with the other builders.
 */
export function unitFromHtml(html: string, parse: ParseHtml): Unit {
  const runs = splitTextUnitByMarkup(
    { value: typeof html === "string" ? html : "" },
    parse,
  );
  return { type: "group", units: runs.map(runToUnit) };
}

/**
 * Serialize a Unit to restricted markup. Unlike generate output, markup inside
 * a text value is escaped rather than parsed: the caller is asking for the
 * markup form of this unit, not for a second round of HTML interpretation.
 */
export function unitToHtml(unit: Unit): string {
  return renderRichTextToHtml(compileRichText(unit));
}
