/**
 * Rendering wrapper over the core's default implementation.
 *
 * The Zotero plugin host and this toolkit share the same renderer, so the HTML
 * matches by construction; this layer only shapes the two output forms:
 *
 * - fragment: one block per citation plus the bibliography;
 * - document: a complete, self-contained HTML page.
 *
 * Note citations render `reference` as the inline marker and `content` as the
 * footnote body; an empty marker auto-numbers by host convention.
 * This HTML is the default renderer's convenience output, not a contract.
 */
import {
  renderBibliographyLineToHtml,
  renderRichTextToHtml,
  type BibliographyLine,
  type StyleResult,
} from "../banyan";

export interface RenderedCitation {
  id: string;
  /** Inline marker (`reference` for note citations, content otherwise). */
  marker: string;
  /** Footnote body for note citations; `null` for intext citations. */
  note: string | null;
}

export interface RenderedResult {
  citations: RenderedCitation[];
  bibliography: string[];
}

export function renderResult(result: StyleResult): RenderedResult {
  const citations: RenderedCitation[] = result.citations.map(
    (citation, index) => {
      if (citation.type === "note-citation") {
        const markerText = citation.reference?.text ?? "";
        return {
          id: citation.id,
          marker: markerText
            ? renderRichTextToHtml(citation.reference)
            : `[${index + 1}]`,
          note: renderRichTextToHtml(citation.content),
        };
      }
      return {
        id: citation.id,
        marker: renderRichTextToHtml(citation.content),
        note: null,
      };
    },
  );

  const bibliography: string[] = result.bibliography.map(
    (line: BibliographyLine) => renderBibliographyLineToHtml(line),
  );

  return { citations, bibliography };
}

/** All rendered blocks in document order, ready to embed. */
export function renderFragment(result: StyleResult): string {
  const rendered = renderResult(result);
  const blocks: string[] = [];
  if (rendered.citations.some((citation) => citation.note !== null)) {
    const notes = rendered.citations
      .map((citation) => `<li>${citation.note ?? ""}</li>`)
      .join("");
    blocks.push(`<ol class="banyan-notes">${notes}</ol>`);
  }
  const markers = rendered.citations
    .map((citation) => `<p class="banyan-marker">${citation.marker}</p>`)
    .join("\n");
  if (markers) blocks.push(markers);
  if (rendered.bibliography.length) {
    blocks.push(
      `<div class="banyan-bibliography">\n${rendered.bibliography.join("\n")}\n</div>`,
    );
  }
  return blocks.join("\n");
}

/** Render as a complete HTML document. */
export function renderDocument(result: StyleResult): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Banyan style output</title>
<style>
body { font-family: serif; margin: 2rem auto; max-width: 40rem; line-height: 1.6; }
.banyan-marker { margin: 0.25rem 0; }
.banyan-bibliography { margin-top: 2rem; border-top: 1px solid #ccc; padding-top: 1rem; }
.banyan-bibliography p { margin: 0.5rem 0; text-indent: -2em; padding-left: 2em; }
</style>
</head>
<body>
${renderFragment(result)}
</body>
</html>
`;
}
