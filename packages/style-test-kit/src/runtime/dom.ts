/**
 * DOMParser polyfill for the `parseHtml` capability, backed by `linkedom`.
 *
 * Hosts share the core's renderer, but the parser differs: a Zotero host uses
 * Gecko's HTML parser, this toolkit uses linkedom. Entities, illegal nesting,
 * `<br>` and attribute handling can differ between parsers, so the HTML
 * conformance fixtures in `fixtures/html/` pin down what the `content`
 * splitting and marks must do here.
 */
import { DOMParser } from "linkedom";
import { createBanyanRuntimeError, type HtmlRootLike } from "../banyan";

const HTML_ROOT_ID = "__banyan_html_root__";

/** Parse an HTML fragment into a document subtree the core can walk. */
export function parseHtml(html: string): HtmlRootLike | null {
  const doc = new DOMParser().parseFromString(
    `<div id="${HTML_ROOT_ID}">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById(HTML_ROOT_ID);
  if (!root) {
    throw createBanyanRuntimeError(
      "The testkit could not parse HTML markup: the parsed document has no fragment root.",
      { code: "host-capability" },
    );
  }
  return root as unknown as HtmlRootLike;
}
