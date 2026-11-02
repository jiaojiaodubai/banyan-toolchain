/**
 * Default HTML rendering of compiled style output.
 *
 * This is a convenience implementation, not a contract: the style result is
 * structured data (`citations` / `bibliography`), and a host may render it into
 * visually equivalent but structurally richer HTML of its own. Snapshot tests
 * therefore only guard this implementation's own stability.
 */
import type { BibliographyLine } from "../types/style";
import type { RichText } from "../types/unit";
import { escapeAttribute, escapeHtml } from "./html";
import { getRichTextSegments, type RichTextSegment } from "./richText";

export type RenderRichTextToHtmlOptions = {
  includeLinks?: boolean;
};

export function renderRichTextToHtml(
  richText: RichText,
  options: RenderRichTextToHtmlOptions = {},
): string {
  if (options.includeLinks === false) {
    return getRichTextSegments(richText)
      .map((unit) => renderUnitVisualToHtml(unit))
      .join("");
  }

  const out: string[] = [];
  let currentLink = "";
  let currentLinkParts: string[] = [];

  const flushLink = () => {
    if (!currentLink) {
      return;
    }
    out.push(
      `<a href="${escapeAttribute(currentLink)}">${currentLinkParts.join("")}</a>`,
    );
    currentLink = "";
    currentLinkParts = [];
  };

  for (const unit of getRichTextSegments(richText)) {
    const html = renderUnitVisualToHtml(unit);
    // Segments come back with normalized marks, so the link is already
    // protocol-checked; rendering must not re-implement that policy.
    const link = unit.link;
    if (!link) {
      flushLink();
      out.push(html);
      continue;
    }

    if (currentLink && currentLink !== link) {
      flushLink();
    }
    currentLink = link;
    currentLinkParts.push(html);
  }

  flushLink();
  return out.join("");
}

export function renderRichTextToText(richText: RichText): string {
  return richText.text;
}

export function renderBibliographyLineToHtml(line: BibliographyLine): string {
  const inner = renderRichTextToHtml(line.content);
  if (line.type === "bibliography-title") {
    return `<h1>${inner}</h1>`;
  }
  return `<p>${inner}</p>`;
}

function renderUnitVisualToHtml(unit: RichTextSegment): string {
  // A line break is a `<br>`: a raw newline in HTML text is collapsed by the
  // browser, which would silently drop the break the model carries.
  let text = escapeHtml(unit.value).replace(/\n/g, "<br>");
  if (unit.bold) text = `<strong>${text}</strong>`;
  if (unit.italic) text = `<em>${text}</em>`;
  if (unit.script === "superscript") text = `<sup>${text}</sup>`;
  if (unit.script === "subscript") text = `<sub>${text}</sub>`;
  const style: string[] = [];
  if (unit.color) style.push(`color:${escapeAttribute(unit.color)}`);
  if (unit.backgroundColor) {
    style.push(`background-color:${escapeAttribute(unit.backgroundColor)}`);
  }
  if (style.length) text = `<span style="${style.join(";")}">${text}</span>`;
  return text;
}
