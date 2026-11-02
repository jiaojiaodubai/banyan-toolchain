import { assert } from "chai";
import {
  CSL_M_DATE_VARIABLES,
  CSL_M_ITEM_TYPES,
  CSL_M_NAME_VARIABLES,
  CSL_M_NUMBER_VARIABLES,
  CSL_M_ONLY_ITEM_TYPES,
  CSL_M_ONLY_VARIABLES,
  CSL_M_SCHEMA,
  CSL_M_STRING_VARIABLES,
  CSL_M_TITLE_VARIABLES,
  CSL_M_VARIABLES,
} from "../src/schema/cslmSchema";
import { CSL_ITEM_TYPES, CSL_VARIABLES } from "../src/schema/cslSchema";
import {
  isCslItemType,
  isCslMItemType,
  isCslMOnlyItemType,
  isCslMOnlyVariable,
  isCslMVariable,
  isCslVariable,
} from "../src/schema/queries";

/**
 * CSL and CSL-M are two schemas, not one schema with add-ons. The CSL-M tables
 * are complete (a superset of CSL) and the `CSL_M_ONLY_*` tables are the delta,
 * so a CSL-only platform and a CSL-M platform can each pick its own schema.
 */
describe("CSL-M schema", function () {
  it("is a complete superset of official CSL", function () {
    for (const itemType of CSL_ITEM_TYPES) {
      assert.isTrue(CSL_M_ITEM_TYPES.has(itemType), itemType);
    }
    for (const variable of CSL_VARIABLES) {
      assert.isTrue(CSL_M_VARIABLES.has(variable), variable);
    }

    // CSL-M documents these as extensions, but official CSL has since adopted
    // them: they are shared, not CSL-M-only.
    assert.isTrue(CSL_M_ITEM_TYPES.has("classic"));
    assert.isTrue(CSL_M_ITEM_TYPES.has("hearing"));
    assert.isTrue(CSL_M_ITEM_TYPES.has("regulation"));
    assert.isTrue(CSL_M_VARIABLES.has("title"));
    assert.isTrue(CSL_M_VARIABLES.has("available-date"));
  });

  it("keeps CSL-M-only names in their own tables", function () {
    assert.isTrue(CSL_M_ONLY_ITEM_TYPES.has("legal_commentary"));
    assert.isTrue(CSL_M_ONLY_ITEM_TYPES.has("video"));
    // Deprecated in CSL-M but still recognized by citeproc-js.
    assert.isTrue(CSL_M_ONLY_ITEM_TYPES.has("gazette"));
    assert.isFalse(CSL_M_ONLY_ITEM_TYPES.has("book"));
    assert.isFalse(CSL_M_ONLY_ITEM_TYPES.has("classic"));

    assert.isTrue(CSL_M_ONLY_VARIABLES.has("committee"));
    assert.isTrue(CSL_M_ONLY_VARIABLES.has("court-class"));
    assert.isTrue(CSL_M_ONLY_VARIABLES.has("document-name"));
    assert.isTrue(CSL_M_ONLY_VARIABLES.has("locator-date"));
    assert.isTrue(CSL_M_ONLY_VARIABLES.has("publication-number"));
    assert.isTrue(CSL_M_ONLY_VARIABLES.has("supplement"));
    assert.isFalse(CSL_M_ONLY_VARIABLES.has("title"));

    // The delta and official CSL do not overlap ...
    for (const itemType of CSL_M_ONLY_ITEM_TYPES) {
      assert.isFalse(CSL_ITEM_TYPES.has(itemType), itemType);
    }
    for (const variable of CSL_M_ONLY_VARIABLES) {
      assert.isFalse(CSL_VARIABLES.has(variable), variable);
    }

    // ... and together they are the complete CSL-M schema.
    assert.deepEqual(
      new Set([...CSL_ITEM_TYPES, ...CSL_M_ONLY_ITEM_TYPES]),
      new Set(CSL_M_ITEM_TYPES),
    );
    assert.deepEqual(
      new Set([...CSL_VARIABLES, ...CSL_M_ONLY_VARIABLES]),
      new Set(CSL_M_VARIABLES),
    );
  });

  it("moves `authority` from a CSL string to a CSL-M name", function () {
    assert.isTrue(CSL_VARIABLES.has("authority"));
    assert.isTrue(CSL_M_NAME_VARIABLES.has("authority"));
    assert.isFalse(CSL_M_STRING_VARIABLES.has("authority"));
  });

  it("groups every CSL-M variable and mirrors the model", function () {
    const grouped = new Set([
      ...CSL_M_DATE_VARIABLES,
      ...CSL_M_NAME_VARIABLES,
      ...CSL_M_NUMBER_VARIABLES,
      ...CSL_M_TITLE_VARIABLES,
      ...CSL_M_STRING_VARIABLES,
    ]);
    assert.deepEqual(grouped, new Set(CSL_M_VARIABLES));

    assert.deepEqual(new Set(CSL_M_SCHEMA.itemTypes), CSL_M_ITEM_TYPES);
    assert.deepEqual(new Set(CSL_M_SCHEMA.variablesAll), CSL_M_VARIABLES);
    assert.deepEqual(
      new Set(CSL_M_SCHEMA.variables.names),
      CSL_M_NAME_VARIABLES,
    );
    assert.deepEqual(
      new Set(CSL_M_SCHEMA.variables.dates),
      CSL_M_DATE_VARIABLES,
    );
    assert.deepEqual(
      new Set(CSL_M_SCHEMA.variables.numbers),
      CSL_M_NUMBER_VARIABLES,
    );
    assert.deepEqual(
      new Set(CSL_M_SCHEMA.variables.titles),
      CSL_M_TITLE_VARIABLES,
    );
    assert.deepEqual(
      new Set(CSL_M_SCHEMA.variables.strings),
      CSL_M_STRING_VARIABLES,
    );
  });

  it("classifies each name against the schema it belongs to", function () {
    // Shared names belong to both schemas; official CSL keeps them.
    assert.isTrue(isCslItemType("book"));
    assert.isTrue(isCslMItemType("book"));
    assert.isFalse(isCslMOnlyItemType("book"));
    assert.isTrue(isCslVariable("title"));
    assert.isTrue(isCslMVariable("title"));
    assert.isFalse(isCslMOnlyVariable("title"));

    // CSL-M-only names are absent from the CSL schema.
    assert.isTrue(isCslMItemType("video"));
    assert.isTrue(isCslMOnlyItemType("video"));
    assert.isFalse(isCslItemType("video"));
    assert.isTrue(isCslMVariable("committee"));
    assert.isTrue(isCslMOnlyVariable("committee"));
    assert.isFalse(isCslVariable("committee"));

    // Unknown names are in neither schema.
    assert.isFalse(isCslMItemType("bookSection"));
    assert.isFalse(isCslMOnlyItemType("bookSection"));
    assert.isFalse(isCslMVariable("bookTitle"));
    assert.isFalse(isCslMOnlyVariable("bookTitle"));

    // Matching stays exact and case-sensitive.
    assert.isFalse(isCslMItemType("Video"));
    assert.isFalse(isCslMVariable("Committee"));
  });
});
