/**
 * Markup splitting for generate output.
 *
 * The core never parses HTML itself: the host's `parseHtml` capability returns
 * a node-like root, and this module turns it into styled runs. Keeping it apart
 * from the Unit compiler makes the boundary explicit — everything here runs
 * only when a text value carries markup.
 *
 * `units/htmlUnit` and `richText/markup` also reuse this splitter because they
 * need the same restricted-markup semantics. The dependency is acyclic and the
 * module remains under the `output/*` public subpath; moving it to `units/` or
 * `richText/` would only trade one cross-directory import for another, so it
 * stays here as the output-side markup bridge.
 */
import type { HtmlNodeLike, HtmlRootLike } from "../host";
import type { TextUnit } from "../types/unit";
import { pushMergedCompiled, type CompiledTextUnit } from "../units/compile";
import { sanitizeCssColor, sanitizeLink } from "../richText/html";
import { createBanyanRuntimeError } from "../sandbox/runtimeErrors";
import { NAMED_ENTITIES } from "./entities";

// DOM node type constants for markup splitting. They stay local because the
// parsed tree is a host value, not a DOM node.
const DOM_NODE_TYPE_ELEMENT = 1;
const DOM_NODE_TYPE_TEXT = 3;

type HtmlElementLike = HtmlNodeLike & {
  tagName: string;
  getAttribute(name: string): string | null;
};

type CompiledTextStyle = Omit<CompiledTextUnit, "value">;

const MARKUP_TAG_NAMES = "b|strong|i|em|sup|sub|a|span|br|sc";
/**
 * One attribute: a name plus an optional value. Quoted values may contain
 * `<`/`>` (`<span title="a > b">`), which a flat `[^<>]*` cannot accept; the
 * unquoted form stops at whitespace, a quote, `=`, `<`/`>` or a backtick, as in
 * the HTML tokenizer.
 */
const TAG_ATTRIBUTE =
  "(?:\\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s\"'=<>`]+))?)*";
const OPEN_TAG = new RegExp(
  `<(${MARKUP_TAG_NAMES})${TAG_ATTRIBUTE}\\s*(/?)>`,
  "i",
);
const CLOSE_TAG = new RegExp(`</(?:${MARKUP_TAG_NAMES})\\s*>`, "i");
const OPEN_TAGS = new RegExp(OPEN_TAG.source, "gi");

/**
 * Nesting budget for the host's parsed tree. The Unit compiler has the same
 * limit for its own trees; markup that needs more is treated as hostile input
 * instead of overflowing the call stack.
 */
const MAX_MARKUP_DEPTH = 100;

/**
 * Tags the core knows how to normalize.
 *
 * A value with no *complete, paired* tag stays literal text: prose like
 * `1 <b and 2 > 1` or `a<b` must not lose the text after `<b` just because the
 * parser would accept it as a start tag. A void (`<br>`) tag anywhere is enough
 * on its own, and so is a self-closing tag that makes up the whole value. A
 * non-void self-closing tag inside prose (`Use <b/> here`) stays literal:
 * HTML would treat it as a start tag and swallow the following text, which is
 * never what a sentence about markup means. Every other tag opens parsing only
 * when a closing tag is present too. Once parsing starts, unknown elements are
 * skipped as elements while their text content is kept, so
 * `a <div>b</div> <b>c</b>` becomes `a b c` rather than dropping the paragraph.
 */
export function looksLikeMarkup(text: string): boolean {
  const opening = OPEN_TAG.exec(text);
  if (!opening) {
    return false;
  }
  if (opening[1]?.toLowerCase() === "br") {
    return true;
  }
  if (CLOSE_TAG.test(text)) {
    return true;
  }
  if (opening[2] === "/") {
    if (text.trim() === opening[0]) {
      return true;
    }
    // A later `<br>` still makes the value markup, even when the first tag was
    // a lone self-closing one.
    for (const match of text.matchAll(OPEN_TAGS)) {
      if (match[1]?.toLowerCase() === "br") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Decode the entities the core can resolve without a parser. Unknown named
 * entities stay literal; a value that also carries a complete tag is handed to
 * the host parser, which decodes the full set.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const hexadecimal = body[1] === "x" || body[1] === "X";
        const code = Number.parseInt(
          body.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        if (
          !Number.isFinite(code) ||
          code <= 0 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
        ) {
          return whole;
        }
        return String.fromCodePoint(code);
      }
      // HTML entity names are case-sensitive (`&Eacute;` is not `&eacute;`);
      // do not fold them to lower case. The table is a plain object, so an own
      // check keeps `&constructor;` / `&toString;` literal instead of resolving
      // an inherited member of Object.prototype.
      return Object.hasOwn(NAMED_ENTITIES, body)
        ? (NAMED_ENTITIES[body] ?? whole)
        : whole;
    },
  );
}

/**
 * Split one text value into styled runs.
 *
 * `parse` is the host's `parseHtml` capability; it is called only for text that
 * looks like markup. A host that cannot produce an element-like root is a
 * contract failure, not "leave the tags in place".
 */
export function splitTextUnitByMarkup(
  base: TextUnit,
  parse: (html: string) => HtmlRootLike | null,
): CompiledTextUnit[] {
  const text = base.value ?? "";
  if (!looksLikeMarkup(text)) {
    return [{ ...base, value: decodeEntities(text) }];
  }

  const { value: _ignoredValue, ...styleBase } = base;
  const out: CompiledTextUnit[] = [];
  const root = parseContainer(parse, text);

  const walk = (
    node: HtmlNodeLike,
    style: CompiledTextStyle,
    depth: number,
  ): void => {
    if (depth > MAX_MARKUP_DEPTH) {
      throw createBanyanRuntimeError(
        `Markup is nested deeper than ${MAX_MARKUP_DEPTH} elements; the output cannot be normalized safely.`,
        { code: "generate-output" },
      );
    }
    if (node.nodeType === DOM_NODE_TYPE_TEXT) {
      // HTML collapses source whitespace (including newlines) in normal text;
      // only a real `<br>` node contributes the hard-break marker.
      const value = (node.nodeValue || "").replace(/[\t\n\r\f ]+/g, " ");
      if (!value) return;
      pushMergedCompiled(out, {
        ...(styleBase as CompiledTextStyle),
        ...style,
        value,
      });
      return;
    }

    if (node.nodeType !== DOM_NODE_TYPE_ELEMENT) return;

    const element = node as HtmlElementLike;
    if (typeof element.tagName !== "string") {
      throw createBanyanRuntimeError(
        'The host "parseHtml" capability returned an element node without a tag name.',
        { code: "host-capability" },
      );
    }
    const tag = element.tagName.toLowerCase();
    if (tag === "br") {
      pushMergedCompiled(out, {
        ...(styleBase as CompiledTextStyle),
        ...style,
        value: "\n",
      });
      return;
    }

    const nextStyle = { ...style };
    applyStylePatchFromElement(nextStyle, element);
    for (const child of Array.from(element.childNodes)) {
      if (child) walk(child, nextStyle, depth + 1);
    }
  };

  for (const child of Array.from(root.childNodes)) {
    if (child) walk(child, {}, 0);
  }

  // Whitespace collapse is a document property, not a node property: HTML
  // renders `a <b> b</b>` with one space even though the parser gives the
  // second text node a leading space. Trim a leading run when the previous
  // emitted run already ends in a space, keeping the first run's style.
  let previous = "";
  for (let index = 0; index < out.length; index += 1) {
    const current = out[index];
    if (!current) continue;
    let value = current.value;
    if (previous.endsWith(" ") && value.startsWith(" ")) {
      value = value.replace(/^ +/, "");
    }
    if (!value) {
      out.splice(index, 1);
      index -= 1;
      continue;
    }
    out[index] = { ...current, value };
    previous = value;
  }

  if (!out.length) {
    return [
      {
        ...base,
        value: (root.textContent || "").replace(/[\t\n\r\f ]+/g, " "),
      },
    ];
  }
  return out;
}

function parseContainer(
  parse: (html: string) => HtmlRootLike | null,
  input: string,
): HtmlRootLike {
  const root = parse(input);
  // The caller asks only when the text carries markup, so a host that cannot
  // produce a root is reported rather than leaving the markup in place: that
  // would render differently from a host that parses it.
  if (!root || root.nodeType !== DOM_NODE_TYPE_ELEMENT || !root.childNodes) {
    throw createBanyanRuntimeError(
      'The host "parseHtml" capability did not return an element-like root for content containing markup.',
      { code: "host-capability" },
    );
  }
  return root;
}

function applyStylePatchFromElement(
  style: CompiledTextStyle,
  element: HtmlElementLike,
): void {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case "b":
    case "strong":
      style.bold = true;
      break;
    case "i":
    case "em":
      style.italic = true;
      break;
    case "sup":
      style.script = "superscript";
      break;
    case "sub":
      style.script = "subscript";
      break;
    case "sc":
      style.smallCaps = true;
      break;
    case "a": {
      const link = sanitizeLink(attributeOf(element, "href"));
      if (link) style.link = link;
      break;
    }
    case "span": {
      const declarations = styleDeclarations(attributeOf(element, "style"));
      const classText = attributeOf(element, "class");
      const color = sanitizeCssColor(declarations.get("color"));
      const background = sanitizeCssColor(
        declarations.get("background-color") ?? declarations.get("background"),
      );
      if (color) style.color = color;
      if (background) style.backgroundColor = background;
      if (/\bnocase\b/i.test(classText)) style.noCase = true;
      if (isCssValue(declarations, "font-variant", "small-caps")) {
        style.smallCaps = true;
      }
      break;
    }
    default:
      break;
  }
}

function attributeOf(element: HtmlElementLike, name: string): string {
  return typeof element.getAttribute === "function"
    ? (element.getAttribute(name) ?? "")
    : "";
}

/**
 * Parse an inline `style` attribute into declarations.
 *
 * Matching by parsed property name (not by substring) matters: a regex for
 * `color` would also match `background-color` and turn a background-only span
 * into colored text.
 */
function styleDeclarations(styleText: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of styleText.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) {
      // Later declarations win, like CSS itself.
      declarations.set(property, value);
    }
  }
  return declarations;
}

function isCssValue(
  declarations: ReadonlyMap<string, string>,
  property: string,
  value: string,
): boolean {
  return (
    declarations.get(property)?.toLowerCase().split(/\s+/).includes(value) ??
    false
  );
}
