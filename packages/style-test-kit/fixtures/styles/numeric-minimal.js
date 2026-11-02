/**
 * Minimal deterministic style for testkit self-tests: "[Author, Year]" in-text
 * citations plus a simple bibliography. Exercises: firstCreator, year,
 * container fields via base-field aliases, extra values, the unit builders
 * (`text` / `group` / `affix`) and one declared style option.
 */
const INFO = {
  id: "testkit-numeric-minimal",
  title: "TestKit Numeric Minimal",
  description: "Deterministic minimal style for offline test runs",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Banyan TestKit" }],
  tags: ["testkit"],
  documentation: [],
  license: "MIT",
  updated: "2026-10-17T00:00:00+08:00",
};

const STYLE_OPTIONS = [
  {
    id: "annotate",
    label: "Annotate citations",
    description: "Append a marker after every citation",
    kind: "state",
    defaultValue: false,
  },
];

function generate() {
  const annotate = options.annotate === true;
  const citations = contexts.map((context) => {
    const parts = context.cites.map((cite) => {
      const item = cite.item;
      const year = item.year || "n.d.";
      const firstCreator = item.firstCreator || item.title || "Anonymous";
      return group([text(`${firstCreator}, ${year}`)]);
    });
    return {
      id: context.id,
      content: group([
        affix(group(parts, text("; ")), text("["), text("]")),
        annotate ? text(" [annotated]") : null,
      ]),
    };
  });

  // One bibliography line per unique item id, in first-seen order.
  const seen = new Map();
  for (const context of contexts) {
    for (const cite of context.cites) {
      if (!seen.has(cite.item.id)) {
        seen.set(cite.item.id, cite.item);
      }
    }
  }
  const bibliography = [...seen.values()].map((item) => ({
    id: `bib-${item.id}`,
    type: "bibliography-entry",
    content: group([
      text(`${item.firstCreator || "Anonymous"}. `),
      text(item.title || ""),
      item.publicationTitle ? text(`. ${item.publicationTitle}`) : null,
      item.date ? text(`, ${item.date}`) : null,
      text("."),
    ]),
  }));

  return { citations, bibliography };
}
