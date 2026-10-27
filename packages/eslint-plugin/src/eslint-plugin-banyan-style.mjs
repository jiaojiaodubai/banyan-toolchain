import {
  CSL_NAME_VARIABLE_SET,
  DENIED_NORMALIZED_PRESET_KEYS,
  isReservedDeclarationKey,
  isValidExtraKey,
  MAX_PRESETS,
  MAX_STATES,
  MAX_STYLE_OPTIONS,
  normalizeExtraKey,
  PARAM_EXPORTS,
  PARAM_KINDS,
  SCHEMA_FACTS,
  STYLE_OPTION_WARN_THRESHOLD,
  ZOTERO_ITEM_TYPE_SET,
} from "@banyan/style-contract";
import { extractStyleUtilsReadonlyGlobals } from "./eslint-style-utils-globals.mjs";

const REQUIRED_EXPORTS = ["INFO", "generate"];
const REQUIRED_INFO_FIELDS = [
  "id",
  "title",
  "description",
  "citationType",
  "creator",
  "tags",
  "documentation",
  "license",
  "updated",
];
const STRING_INFO_FIELDS = ["id", "title", "description", "license", "updated"];
const ARRAY_INFO_FIELDS = ["creator", "tags", "documentation"];
const CITATION_TYPE_VALUES = new Set(["intext-citation", "note-citation"]);
const LARGE_LOOP_BOUNDARY = 100000;
const RULES_DOCUMENTATION_URL =
  "https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/eslint-plugin/docs/rules.md";

function ruleDocsUrl(ruleName) {
  return `${RULES_DOCUMENTATION_URL}#${ruleName}`;
}

function isLiteralTrue(node) {
  return node?.type === "Literal" && node.value === true;
}

function isLargeNumericLiteral(node) {
  return (
    node?.type === "Literal" &&
    typeof node.value === "number" &&
    node.value >= LARGE_LOOP_BOUNDARY
  );
}

function isLargeLoopTest(node) {
  if (!node || node.type !== "BinaryExpression") return false;
  return isLargeNumericLiteral(node.left) || isLargeNumericLiteral(node.right);
}

function isRequiredExport(name) {
  return REQUIRED_EXPORTS.includes(name);
}

function getPropertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value ?? "");
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value?.cooked ?? "";
  }
  return null;
}

function isFunctionLike(node) {
  if (!node) return false;
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

/**
 * Resolve a computed key statically when possible. Plain keys are handled by
 * `getPropertyName()`; computed keys are only trusted when they are literals or
 * interpolation-free templates, because `[someVariable]` cannot be checked.
 */
function getStaticKeyName(property) {
  if (!property || property.type !== "Property") {
    return null;
  }
  if (!property.computed) {
    return getPropertyName(property.key);
  }
  const key = property.key;
  if (key?.type === "Literal") {
    return String(key.value ?? "");
  }
  if (
    key?.type === "TemplateLiteral" &&
    key.expressions.length === 0 &&
    key.quasis.length === 1
  ) {
    return key.quasis[0]?.value?.cooked ?? "";
  }
  return null;
}

function getDynamicKeyProperties(objectExpression) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") {
    return [];
  }
  return objectExpression.properties.filter(
    (property) =>
      property.type === "Property" &&
      property.kind === "init" &&
      getStaticKeyName(property) === null,
  );
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set?.get(name);
    if (variable) {
      return variable;
    }
  }
  return null;
}

/**
 * Resolve the identifier a function declares itself as. Matching the
 * definition avoids picking up a same-named local binding from the function
 * body, which is what a plain name comparison would do.
 */
function findDeclaredVariable(context, node, name) {
  for (
    let scope = context.sourceCode.getScope(node);
    scope;
    scope = scope.upper
  ) {
    const variable = scope.set?.get(name);
    if (
      variable?.defs.some(
        (definition) =>
          definition.node === node || definition.node?.init === node,
      )
    ) {
      return variable;
    }
  }
  return null;
}

/**
 * Describe what a function is bound to so recursion can be checked by identity
 * rather than by comparing names. Name-only comparison misreports shadowed
 * bindings and unrelated `object.member()` calls that happen to share a name.
 */
function getFunctionBinding(context, node) {
  if (!node) {
    return null;
  }
  if (node.id?.type === "Identifier" && node.id.name) {
    return {
      kind: "declared",
      name: node.id.name,
      node,
      variable: findDeclaredVariable(context, node, node.id.name),
    };
  }

  const parent = node.parent;
  if (!parent) {
    return null;
  }
  if (
    parent.type === "VariableDeclarator" &&
    parent.init === node &&
    parent.id.type === "Identifier"
  ) {
    return {
      kind: "variable",
      name: parent.id.name,
      node,
      variable: findVariable(
        context.sourceCode.getScope(parent),
        parent.id.name,
      ),
    };
  }
  if (
    parent.type === "AssignmentExpression" &&
    parent.right === node &&
    parent.left.type === "Identifier"
  ) {
    return {
      kind: "assignment",
      name: parent.left.name,
      node,
      variable: findVariable(
        context.sourceCode.getScope(parent.left),
        parent.left.name,
      ),
    };
  }
  if (parent.type === "Property" && parent.value === node) {
    const name = getStaticKeyName(parent);
    if (!name) {
      return null;
    }
    return {
      kind: "property",
      name,
      node,
      owner: parent.parent?.type === "ObjectExpression" ? parent.parent : null,
      // `this` inside an arrow property is lexical, not the object itself.
      thisIsOwner: node.type !== "ArrowFunctionExpression",
      variable: null,
    };
  }
  return null;
}

function isSelfReferenceCall(context, callee, binding) {
  if (!binding || !callee) {
    return false;
  }

  if (callee.type === "Identifier") {
    if (callee.name !== binding.name || !binding.variable) {
      return false;
    }
    return (
      findVariable(context.sourceCode.getScope(callee), callee.name) ===
      binding.variable
    );
  }

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === binding.name &&
    binding.kind === "property"
  ) {
    if (callee.object.type === "ThisExpression") {
      return binding.thisIsOwner;
    }
    if (callee.object.type === "Identifier" && binding.owner) {
      const objectVariable = findVariable(
        context.sourceCode.getScope(callee.object),
        callee.object.name,
      );
      return Boolean(
        objectVariable?.defs.some(
          (definition) =>
            definition.type === "Variable" &&
            definition.node?.init === binding.owner,
        ),
      );
    }
  }
  return false;
}

function toObjectPropertyMap(node) {
  const map = new Map();
  if (!node || node.type !== "ObjectExpression") {
    return map;
  }

  for (const property of node.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }
    const name = getStaticKeyName(property);
    if (name) {
      map.set(name, property.value);
    }
  }

  return map;
}

function collectStyleObjectMembers(objectExpression, styleMembers) {
  const props = toObjectPropertyMap(objectExpression);
  for (const [name, value] of props.entries()) {
    if (isRequiredExport(name)) {
      styleMembers.set(name, value);
    }
  }
}

function collectFromAssignment(assignmentExpression, bindings, styleMembers) {
  if (
    !assignmentExpression ||
    assignmentExpression.type !== "AssignmentExpression"
  ) {
    return;
  }
  if (assignmentExpression.operator !== "=") {
    return;
  }

  const { left, right } = assignmentExpression;
  if (left.type === "Identifier") {
    bindings.set(left.name, right);
    if (left.name === "style") {
      collectStyleObjectMembers(right, styleMembers);
    }
    return;
  }

  if (left.type !== "MemberExpression") {
    return;
  }
  if (left.object.type !== "Identifier" || left.object.name !== "style") {
    return;
  }

  const memberName = left.computed
    ? getPropertyName(left.property)
    : left.property.type === "Identifier"
      ? left.property.name
      : null;

  if (memberName && isRequiredExport(memberName)) {
    styleMembers.set(memberName, right);
  }
}

function collectFromVariableDeclaration(declaration, bindings, styleMembers) {
  if (!declaration || declaration.type !== "VariableDeclaration") {
    return;
  }

  for (const declarator of declaration.declarations) {
    if (declarator.id.type !== "Identifier") {
      continue;
    }

    const name = declarator.id.name;
    bindings.set(name, declarator.init || declarator.id);
    if (name === "style") {
      collectStyleObjectMembers(declarator.init, styleMembers);
    }
  }
}

function resolveBindingNode(node, bindings) {
  let current = node;
  const visited = new Set();

  while (current && current.type === "Identifier") {
    if (visited.has(current.name) || !bindings.has(current.name)) {
      break;
    }
    visited.add(current.name);
    current = bindings.get(current.name);
  }

  return current || node;
}

function getEntryNode(name, bindings, styleMembers) {
  if (bindings.has(name)) {
    return resolveBindingNode(bindings.get(name), bindings);
  }
  if (styleMembers.has(name)) {
    return resolveBindingNode(styleMembers.get(name), bindings);
  }
  return null;
}

function validateFunctionEntry(context, entryName, node) {
  if (!node) return;
  if (!isFunctionLike(node)) {
    context.report({
      node,
      messageId: "entryMustBeFunction",
      data: { name: entryName },
    });
    return;
  }
}

function validateCreatorArray(context, creatorNode) {
  if (!creatorNode || creatorNode.type !== "ArrayExpression") {
    return;
  }

  for (const element of creatorNode.elements) {
    if (!element || element.type !== "ObjectExpression") {
      continue;
    }

    const creatorProps = toObjectPropertyMap(element);
    if (!creatorProps.has("type") || !creatorProps.has("name")) {
      context.report({
        node: element,
        messageId: "creatorMissingFields",
      });
    }
  }
}

function validateInfoEntry(context, infoNode) {
  if (!infoNode) {
    return;
  }

  if (infoNode.type !== "ObjectExpression") {
    context.report({
      node: infoNode,
      messageId: "infoMustBeObject",
    });
    return;
  }

  const infoProps = toObjectPropertyMap(infoNode);
  const missingInfoFields = REQUIRED_INFO_FIELDS.filter(
    (field) => !infoProps.has(field),
  );
  if (missingInfoFields.length) {
    context.report({
      node: infoNode,
      messageId: "infoMissingFields",
      data: { missing: missingInfoFields.join(", ") },
    });
  }

  for (const field of STRING_INFO_FIELDS) {
    const valueNode = infoProps.get(field);
    if (!valueNode) continue;
    if (valueNode.type === "Literal" && typeof valueNode.value !== "string") {
      context.report({
        node: valueNode,
        messageId: "infoFieldMustBeString",
        data: { field },
      });
    }
  }

  for (const field of ARRAY_INFO_FIELDS) {
    const valueNode = infoProps.get(field);
    if (!valueNode) continue;
    if (valueNode.type !== "ArrayExpression") {
      context.report({
        node: valueNode,
        messageId: "infoFieldMustBeArray",
        data: { field },
      });
    }
  }

  const citationTypeNode = infoProps.get("citationType");
  if (citationTypeNode && citationTypeNode.type === "Literal") {
    const value = String(citationTypeNode.value ?? "");
    if (!CITATION_TYPE_VALUES.has(value)) {
      context.report({
        node: citationTypeNode,
        messageId: "infoCitationTypeInvalid",
        data: { value },
      });
    }
  }

  validateCreatorArray(context, infoProps.get("creator"));
}

const warnRiskyRuntimePatternRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn about style script patterns that can hang Banyan's sandbox runtime",
      url: ruleDocsUrl("warn-risky-runtime-pattern"),
    },
    schema: [],
    messages: {
      unboundedWhile:
        "Avoid unbounded while loops in generate(); Banyan isolates permissions, not CPU time.",
      unboundedFor:
        "Avoid for(;;) loops in generate(); Banyan cannot reliably interrupt synchronous infinite loops.",
      largeSyncLoop:
        "This loop has a very large literal boundary. Prefer iterating contexts/items directly or chunking async work.",
      directRecursion:
        "Direct recursion can exhaust the style runtime. Prefer iterative helpers with explicit bounds.",
    },
  },
  create(context) {
    const functionStack = [];

    function enterFunction(node) {
      functionStack.push(getFunctionBinding(context, node));
    }

    function exitFunction() {
      functionStack.pop();
    }

    return {
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      WhileStatement(node) {
        if (isLiteralTrue(node.test)) {
          context.report({ node, messageId: "unboundedWhile" });
        }
      },
      ForStatement(node) {
        if (!node.test) {
          context.report({ node, messageId: "unboundedFor" });
          return;
        }
        if (isLargeLoopTest(node.test)) {
          context.report({ node, messageId: "largeSyncLoop" });
        }
      },
      CallExpression(node) {
        const binding = functionStack[functionStack.length - 1];
        if (!binding) return;
        if (isSelfReferenceCall(context, node.callee, binding)) {
          context.report({ node, messageId: "directRecursion" });
        }
      },
    };
  },
};

const requireStyleContractRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require and validate StyleScript contract (INFO, generate)",
      url: ruleDocsUrl("require-style-contract"),
    },
    schema: [],
    messages: {
      missingEntries:
        "StyleScript is missing required entry points: {{missing}}. Define them as top-level bindings or as style object members.",
      entryMustBeFunction: "StyleScript entry '{{name}}' must be a function.",
      infoMustBeObject: "StyleScript entry 'INFO' must be an object literal.",
      infoMissingFields: "INFO is missing required fields: {{missing}}.",
      infoFieldMustBeString: "INFO.{{field}} should be a string literal.",
      infoFieldMustBeArray: "INFO.{{field}} should be an array.",
      infoCitationTypeInvalid:
        "INFO.citationType should be 'intext-citation' or 'note-citation', got '{{value}}'.",
      creatorMissingFields:
        "Each INFO.creator item should include both 'type' and 'name'.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const bindings = new Map();
        const styleMembers = new Map();

        for (const statement of node.body) {
          if (statement.type === "VariableDeclaration") {
            collectFromVariableDeclaration(statement, bindings, styleMembers);
            continue;
          }

          if (statement.type === "FunctionDeclaration") {
            const functionName = statement.id?.name;
            if (functionName) {
              bindings.set(functionName, statement);
            }
            continue;
          }

          if (statement.type === "ExpressionStatement") {
            collectFromAssignment(statement.expression, bindings, styleMembers);
          }
        }

        const missing = REQUIRED_EXPORTS.filter(
          (name) => !getEntryNode(name, bindings, styleMembers),
        );
        if (missing.length) {
          context.report({
            node,
            messageId: "missingEntries",
            data: { missing: missing.join(", ") },
          });
        }

        const infoNode = getEntryNode("INFO", bindings, styleMembers);
        validateInfoEntry(context, infoNode);

        const generateNode = getEntryNode("generate", bindings, styleMembers);
        validateFunctionEntry(context, "generate", generateNode);
      },
    };
  },
};

/**
 * CSL name variables from the shared schema facts. A preset writes one value,
 * so creators never land.
 */
export const CSL_NAME_VARIABLES = CSL_NAME_VARIABLE_SET;

/** Keys a preset must never target, in normalized form. */
export const PRESET_DENIED_KEYS = DENIED_NORMALIZED_PRESET_KEYS;

function validatePresetFields(context, presetId, fieldsNode) {
  if (!fieldsNode) {
    context.report({
      node: fieldsNode ?? context.sourceCode.ast,
      messageId: "fieldsMissing",
      data: { id: presetId },
    });
    return;
  }
  if (fieldsNode.type !== "ObjectExpression" || !fieldsNode.properties.length) {
    context.report({
      node: fieldsNode,
      messageId: "fieldsMustBeNonEmptyObject",
      data: { id: presetId },
    });
    return;
  }

  for (const property of fieldsNode.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }
    const key = getStaticKeyName(property);
    if (key === null) {
      context.report({ node: property, messageId: "fieldKeyMustBeStatic" });
      continue;
    }
    if (!key) continue;

    const normalized = normalizeExtraKey(key);
    if (PRESET_DENIED_KEYS.has(normalized)) {
      context.report({
        node: property,
        messageId: "fieldKeyDenied",
        data: { key },
      });
      continue;
    }
    // Keys outside the variable-line syntax cannot be read back from `extra`
    // (mirrors `isValidExtraKey()` in @banyan/core/items/extra), so the runtime
    // drops them at apply time. Every Zotero field name satisfies the pattern.
    if (!isValidExtraKey(key)) {
      context.report({
        node: property,
        messageId: "fieldKeyInvalidSyntax",
        data: { key },
      });
      continue;
    }
    if (CSL_NAME_VARIABLES.has(normalized)) {
      context.report({
        node: property,
        messageId: "fieldKeyIsNameVariable",
        data: { key },
      });
      continue;
    }

    const value = property.value;
    if (value.type === "Literal" && value.value === null) {
      // `null` means "ask the user at apply time", which is allowed.
      continue;
    }
    if (
      value.type !== "Literal" ||
      typeof value.value !== "string" ||
      !value.value.trim()
    ) {
      context.report({
        node: value,
        messageId: "fieldValueInvalid",
        data: { key },
      });
    }
  }
}

function validateFieldPresetEntry(context, entry, seenIds) {
  if (!entry || entry.type !== "ObjectExpression") {
    context.report({ node: entry, messageId: "presetMustBeObject" });
    return;
  }

  const props = toObjectPropertyMap(entry);
  const idNode = props.get("id");
  const id =
    idNode?.type === "Literal" && typeof idNode.value === "string"
      ? idNode.value.trim()
      : "";
  if (!id) {
    context.report({
      node: idNode ?? entry,
      messageId: "presetIdInvalid",
    });
  } else if (seenIds.has(id)) {
    context.report({
      node: idNode,
      messageId: "presetIdDuplicate",
      data: { id },
    });
  } else {
    seenIds.add(id);
  }

  const labelNode = props.get("label");
  if (labelNode) {
    const isUsableLabel =
      labelNode.type === "Literal" &&
      typeof labelNode.value === "string" &&
      Boolean(labelNode.value.trim());
    if (!isUsableLabel) {
      context.report({ node: labelNode, messageId: "presetLabelInvalid" });
    }
  }

  const visibleNode = props.get("visible");
  // A style may point at a named function declared elsewhere, as the legal
  // citation style does (`visible: statuteItem`). Only reject expressions that
  // can never be a function value.
  if (
    visibleNode &&
    !isFunctionLike(visibleNode) &&
    visibleNode.type !== "Identifier"
  ) {
    context.report({ node: visibleNode, messageId: "presetVisibleInvalid" });
  }

  validatePresetFields(context, id || "(unnamed)", props.get("fields"));
}

const validateFieldPresetsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Validate the ITEM_FIELD_PRESETS declaration of a style (shape, writable keys)",
      url: ruleDocsUrl("validate-field-presets"),
    },
    schema: [],
    messages: {
      presetsMustBeArray:
        "ITEM_FIELD_PRESETS should be an array of preset objects.",
      presetMustBeObject:
        "Each ITEM_FIELD_PRESETS item should be an object literal.",
      presetIdInvalid:
        "Each ITEM_FIELD_PRESETS item needs a non-empty string 'id'.",
      presetIdDuplicate: "Duplicate ITEM_FIELD_PRESETS id '{{id}}'.",
      presetLabelInvalid:
        "ITEM_FIELD_PRESETS 'label' should be a non-empty plain string; styles have no locale concept, so a locale map is not supported.",
      presetVisibleInvalid:
        "ITEM_FIELD_PRESETS 'visible' should be a function or a reference to a function returning a boolean.",
      fieldsMissing:
        "ITEM_FIELD_PRESETS item '{{id}}' needs a 'fields' object.",
      fieldsMustBeNonEmptyObject:
        "ITEM_FIELD_PRESETS item '{{id}}' 'fields' should be a non-empty object of key/value pairs.",
      fieldValueInvalid:
        "ITEM_FIELD_PRESETS '{{key}}' should be a non-empty string, or null to ask the user when the mark is applied.",
      fieldKeyDenied:
        "'{{key}}' cannot be written by a preset (it is a primary or identity field, or 'extra' itself).",
      fieldKeyIsNameVariable:
        "'{{key}}' is a CSL name variable; a preset writes a single value, so creators are not applied.",
      fieldKeyInvalidSyntax:
        "'{{key}}' is not a valid extra field key; a key starts with a letter and continues with letters, digits, spaces, hyphens or underscores.",
      fieldKeyMustBeStatic:
        "ITEM_FIELD_PRESETS field keys must be static strings so they can be checked.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const bindings = new Map();
        const styleMembers = new Map();

        for (const statement of node.body) {
          if (statement.type === "VariableDeclaration") {
            collectFromVariableDeclaration(statement, bindings, styleMembers);
            continue;
          }
          if (statement.type === "ExpressionStatement") {
            collectFromAssignment(statement.expression, bindings, styleMembers);
          }
        }

        const presetsNode = getEntryNode(
          "ITEM_FIELD_PRESETS",
          bindings,
          styleMembers,
        );
        if (!presetsNode) {
          return;
        }

        // The runtime declares one shape only: an array of preset objects.
        if (presetsNode.type !== "ArrayExpression") {
          context.report({
            node: presetsNode,
            messageId: "presetsMustBeArray",
          });
          return;
        }
        const entries = presetsNode.elements.filter(Boolean);

        const seenIds = new Set();
        for (const entry of entries) {
          validateFieldPresetEntry(context, entry, seenIds);
        }
      },
    };
  },
};

/**
 * Zotero's own labels for item fields, keyed by the flattened lowercase form a
 * style author is likely to type, derived from Zotero's field labels
 * (`chrome/locale/en-US/zotero/zotero.properties`, `itemFields.*`): every label
 * whose flattened form differs from the internal field name.
 *
 * Labels that *are* a field name for some item type are left out on purpose
 * ("Format", "Medium", "Type"): `item.format` is a real read for audio and video
 * items, so flagging them would be wrong as often as right.
 */
export const ITEM_FIELD_LABELS = new Map([
  ["accessed", "accessDate"],
  ["abstract", "abstractNote"],
  ["filetype", "audioFileType"],
  ["forumlistservtitle", "forumTitle"],
  ["journalabbr", "journalAbbreviation"],
  ["license", "rights"],
  ["locinarchive", "archiveLocation"],
  ["modified", "dateModified"],
  ["ofpages", "numPages"],
  ["ofvolumes", "numberOfVolumes"],
  ["pdfattachment", "attachmentPDF"],
  ["proglanguage", "programmingLanguage"],
  ["publication", "publicationTitle"],
  ["repolocation", "repositoryLocation"],
  ["version", "versionNumber"],
]);

/**
 * Keys a Banyan item never carries: the record metadata `toJSON()` adds
 * (`version`, `dateAdded`, `dateModified`, `collections`), the long-text
 * fields the core strips (`EXCLUDED_FIELDS` in `@banyan/core/items/fields`),
 * and the removed host identity fields. Host-private namespaced keys (`z:*`)
 * are reported separately.
 */
export const ITEM_FIELDS_NOT_CARRIED = [
  "abstractNote",
  "collections",
  "dateAdded",
  "dateModified",
  "notes",
  "key",
  "uri",
  "relations",
];

/** Host-private extension keys such as Zotero's `z:uri`. */
const HOST_PRIVATE_FIELD_PATTERN = /^[a-z][a-z0-9]*:/i;

function flattenFieldName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ITEM_FIELDS_NOT_CARRIED_FLAT = new Map(
  ITEM_FIELDS_NOT_CARRIED.map((name) => [flattenFieldName(name), name]),
);

/** True when the member is read off something called `item`. */
function isItemRead(member) {
  const object = member.object;
  if (!object) return false;
  if (object.type === "Identifier") {
    return object.name === "item";
  }
  if (object.type === "MemberExpression") {
    return getPropertyName(object.property) === "item";
  }
  return false;
}

const warnItemFieldMisuseRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when a style reads an item field by Zotero's UI label, or a key a Banyan item does not carry",
      url: ruleDocsUrl("warn-item-field-misuse"),
    },
    schema: [],
    messages: {
      labelRead:
        "'{{name}}' is Zotero's label for '{{field}}'; read '{{field}}' instead.",
      labelReadMissing:
        "'{{name}}' is Zotero's label for '{{field}}', which a Banyan item does not carry.",
      notCarried: "A Banyan item does not carry '{{name}}'.",
      hostPrivate: "Host-private field '{{name}}' must not be read by a style.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = getPropertyName(node.property);
        if (!name || !isItemRead(node)) return;

        const flat = flattenFieldName(name);
        const labelled = ITEM_FIELD_LABELS.get(flat);
        if (labelled) {
          context.report({
            node,
            messageId: ITEM_FIELDS_NOT_CARRIED_FLAT.has(
              flattenFieldName(labelled),
            )
              ? "labelReadMissing"
              : "labelRead",
            data: { name, field: labelled },
          });
          return;
        }

        const notCarried = ITEM_FIELDS_NOT_CARRIED_FLAT.get(flat);
        if (notCarried) {
          context.report({
            node,
            messageId: "notCarried",
            data: { name: notCarried },
          });
          return;
        }

        if (HOST_PRIVATE_FIELD_PATTERN.test(name)) {
          context.report({
            node,
            messageId: "hostPrivate",
            data: { name },
          });
        }
      },
    };
  },
};

const STYLE_OPTION_MAX_COUNT = MAX_STYLE_OPTIONS;
const DEFAULT_STYLE_OPTION_WARN_COUNT = STYLE_OPTION_WARN_THRESHOLD;
const PARAM_KIND_SET = new Set(PARAM_KINDS);

function getStyleEntryFromProgram(node, name) {
  const bindings = new Map();
  const styleMembers = new Map();
  for (const statement of node.body) {
    if (statement.type === "VariableDeclaration") {
      collectFromVariableDeclaration(statement, bindings, styleMembers);
      continue;
    }
    if (statement.type === "ExpressionStatement") {
      collectFromAssignment(statement.expression, bindings, styleMembers);
    }
  }
  return getEntryNode(name, bindings, styleMembers);
}

function getStyleOptionEntries(entryNode) {
  return entryNode.type === "ArrayExpression"
    ? entryNode.elements.filter(Boolean)
    : null;
}

function isNonEmptyStringLiteral(node) {
  return (
    node?.type === "Literal" &&
    typeof node.value === "string" &&
    Boolean(node.value.trim())
  );
}

/**
 * Normalize one parameter object once so identity, modifier and kind checks
 * read the same nodes and literals. This is a read-only view of the AST, not a
 * second source of truth; diagnostics still point at the original nodes.
 */
function parseParamEntry(entry) {
  const props = toObjectPropertyMap(entry);
  const idNode = props.get("id");
  const kindNode = props.get("kind");
  return {
    node: entry,
    props,
    idNode,
    id: isNonEmptyStringLiteral(idNode) ? idNode.value.trim() : "",
    labelNode: props.get("label"),
    descriptionNode: props.get("description"),
    kindNode,
    kind:
      kindNode?.type === "Literal" && typeof kindNode.value === "string"
        ? kindNode.value
        : "",
    statesNode: props.get("states"),
    defaultValueNode: props.get("defaultValue"),
  };
}

function validateParamIdentity(context, param, seenIds, sourceName) {
  const { node, idNode, id, labelNode, descriptionNode } = param;
  if (!id) {
    context.report({ node: idNode ?? node, messageId: "paramIdInvalid" });
  } else if (isReservedDeclarationKey(id)) {
    context.report({
      node: idNode,
      messageId: "paramIdReserved",
      data: { id },
    });
  } else if (seenIds.has(id)) {
    context.report({
      node: idNode,
      messageId: "paramIdDuplicate",
      data: { id, source: sourceName },
    });
  } else {
    seenIds.add(id);
  }

  if (!isNonEmptyStringLiteral(labelNode)) {
    context.report({
      node: labelNode ?? node,
      messageId: "paramLabelInvalid",
    });
  }
  if (descriptionNode && !isNonEmptyStringLiteral(descriptionNode)) {
    context.report({
      node: descriptionNode,
      messageId: "paramDescriptionInvalid",
    });
  }
}

function validateParamModifiers(context, param, scope) {
  const { props } = param;
  const applicableNode = props.get("applicable");
  if (applicableNode) {
    if (scope === "style") {
      context.report({
        node: applicableNode,
        messageId: "applicableUnsupported",
      });
    } else if (!isFunctionLike(applicableNode)) {
      context.report({
        node: applicableNode,
        messageId: "applicableMustBeFunction",
      });
    }
  }

  const forcedValueNode = props.get("forcedValue");
  if (forcedValueNode && !isFunctionLike(forcedValueNode)) {
    // A constant forced value is allowed, but it should still be a literal
    // rather than an arbitrary expression the runtime cannot reason about.
    if (
      forcedValueNode.type !== "Literal" &&
      forcedValueNode.type !== "ArrayExpression" &&
      forcedValueNode.type !== "ObjectExpression"
    ) {
      context.report({
        node: forcedValueNode,
        messageId: "forcedValueInvalid",
      });
    }
  }
}

function validateStateParam(context, param) {
  const { node, props, statesNode, defaultValueNode } = param;
  if (props.has("validate")) {
    context.report({
      node: props.get("validate"),
      messageId: "stateValidate",
    });
  }
  if (props.has("presets")) {
    context.report({ node: props.get("presets"), messageId: "statePresets" });
  }
  if (props.has("format")) {
    context.report({ node: props.get("format"), messageId: "stateFormat" });
  }

  if (!statesNode) {
    if (
      defaultValueNode &&
      !(
        defaultValueNode.type === "Literal" &&
        typeof defaultValueNode.value === "boolean"
      )
    ) {
      context.report({
        node: defaultValueNode,
        messageId: "booleanDefaultInvalid",
      });
    }
    return;
  }

  if (statesNode.type !== "ObjectExpression") {
    context.report({ node: statesNode, messageId: "statesInvalid" });
    return;
  }
  if (!statesNode.properties.length) {
    context.report({ node: statesNode, messageId: "statesEmpty" });
    return;
  }

  const dynamicKeyProperties = getDynamicKeyProperties(statesNode);
  for (const property of dynamicKeyProperties) {
    context.report({ node: property, messageId: "stateKeyMustBeStatic" });
  }

  const staticEntries = [];
  const seenKeys = new Set();
  for (const property of statesNode.properties) {
    if (property.type !== "Property" || property.kind !== "init") {
      continue;
    }
    const key = getStaticKeyName(property);
    if (key === null) {
      continue;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      context.report({ node: property, messageId: "stateKeyInvalid" });
      continue;
    }
    if (trimmed === "__proto__") {
      context.report({
        node: property,
        messageId: "stateKeyReserved",
        data: { key },
      });
      continue;
    }
    if (trimmed !== key) {
      context.report({
        node: property,
        messageId: "stateKeyWhitespace",
        data: { key, trimmed },
      });
    }
    if (seenKeys.has(trimmed)) {
      context.report({
        node: property,
        messageId: "stateKeyDuplicate",
        data: { key, trimmed },
      });
      continue;
    }
    seenKeys.add(trimmed);
    staticEntries.push({ key, trimmed, labelNode: property.value });
  }

  if (!statesNode.properties.length || !staticEntries.length) {
    if (!dynamicKeyProperties.length) {
      context.report({ node: statesNode, messageId: "statesInvalid" });
    }
    return;
  }
  if (!dynamicKeyProperties.length && staticEntries.length > MAX_STATES) {
    context.report({
      node: statesNode,
      messageId: "tooManyStates",
      data: { count: staticEntries.length },
    });
  }

  for (const entry of staticEntries) {
    if (!isNonEmptyStringLiteral(entry.labelNode)) {
      context.report({
        node: entry.labelNode,
        messageId: "stateLabelInvalid",
        data: { key: entry.trimmed },
      });
    }
  }

  if (!defaultValueNode) {
    context.report({ node, messageId: "stateDefaultMissing" });
    return;
  }
  // With a dynamic key the full key set is unknown, so a string default cannot
  // be judged without risking a false positive.
  if (dynamicKeyProperties.length) {
    return;
  }
  if (
    !isNonEmptyStringLiteral(defaultValueNode) ||
    !seenKeys.has(defaultValueNode.value.trim())
  ) {
    context.report({
      node: defaultValueNode,
      messageId: "defaultNotInStates",
      data: {
        value:
          defaultValueNode.type === "Literal"
            ? String(defaultValueNode.value)
            : context.sourceCode.getText(defaultValueNode),
      },
    });
  }
}

function validateValueParam(context, param) {
  const { props, defaultValueNode } = param;
  if (
    defaultValueNode &&
    !(
      defaultValueNode.type === "Literal" &&
      typeof defaultValueNode.value === "string"
    )
  ) {
    context.report({
      node: defaultValueNode,
      messageId: "valueDefaultInvalid",
    });
  }
  const formatNode = props.get("format");
  if (
    formatNode &&
    !(
      formatNode.type === "Literal" &&
      (formatNode.value === "plain" || formatNode.value === "rich")
    )
  ) {
    context.report({ node: formatNode, messageId: "formatInvalid" });
  }
  const validateNode = props.get("validate");
  if (validateNode && !isFunctionLike(validateNode)) {
    context.report({
      node: validateNode,
      messageId: "validateMustBeFunction",
    });
  }
  const presetsNode = props.get("presets");
  if (presetsNode) {
    if (presetsNode.type !== "ArrayExpression") {
      context.report({ node: presetsNode, messageId: "presetsInvalid" });
    } else {
      const presetCount = presetsNode.elements.filter(Boolean).length;
      if (presetCount > MAX_PRESETS) {
        context.report({
          node: presetsNode,
          messageId: "tooManyPresets",
          data: { count: presetCount },
        });
      }
      for (const preset of presetsNode.elements) {
        if (!preset) continue;
        const validString =
          preset.type === "Literal" && typeof preset.value === "string";
        const validObject =
          preset.type === "ObjectExpression" &&
          isNonEmptyStringLiteral(toObjectPropertyMap(preset).get("label")) &&
          isNonEmptyStringLiteral(toObjectPropertyMap(preset).get("value"));
        if (!validString && !validObject) {
          context.report({ node: preset, messageId: "presetInvalid" });
        }
      }
    }
  }
}

function validateListParam(context, param, scope, sourceName) {
  const { node, props, kindNode } = param;
  if (scope !== "cite") {
    context.report({
      node: kindNode ?? node,
      messageId: "listOnlyCite",
      data: { source: sourceName },
    });
    return;
  }
  const fieldsNode = props.get("fields");
  if (
    !fieldsNode ||
    fieldsNode.type !== "ArrayExpression" ||
    !fieldsNode.elements.length
  ) {
    context.report({
      node: fieldsNode ?? node,
      messageId: "listFieldsInvalid",
    });
    return;
  }
  const fieldIds = new Set();
  for (const field of fieldsNode.elements) {
    if (!field || field.type !== "ObjectExpression") {
      context.report({ node: field, messageId: "listFieldMustBeObject" });
      continue;
    }
    const fieldProps = toObjectPropertyMap(field);
    const fieldIdNode = fieldProps.get("id");
    const fieldId = isNonEmptyStringLiteral(fieldIdNode)
      ? fieldIdNode.value.trim()
      : "";
    const fieldKindNode = fieldProps.get("kind");
    const fieldKind =
      fieldKindNode?.type === "Literal" ? fieldKindNode.value : "";
    if (!fieldId) {
      context.report({
        node: fieldIdNode ?? field,
        messageId: "listFieldIdInvalid",
      });
    } else if (fieldIds.has(fieldId)) {
      context.report({
        node: fieldIdNode,
        messageId: "listFieldIdDuplicate",
        data: { id: fieldId },
      });
    } else {
      fieldIds.add(fieldId);
    }
    if (fieldKind !== "value") {
      context.report({
        node: fieldKindNode ?? field,
        messageId: "listFieldKindInvalid",
      });
    }
    if (fieldProps.has("applicable") || fieldProps.has("forcedValue")) {
      context.report({
        node: field,
        messageId: "listFieldConditionUnsupported",
      });
    }
    if (!isNonEmptyStringLiteral(fieldProps.get("label"))) {
      context.report({
        node: fieldProps.get("label") ?? field,
        messageId: "paramLabelInvalid",
      });
    }
    const validateNode = fieldProps.get("validate");
    if (validateNode && !isFunctionLike(validateNode)) {
      context.report({
        node: validateNode,
        messageId: "validateMustBeFunction",
      });
    }
    const formatNode = fieldProps.get("format");
    if (
      formatNode &&
      !(
        formatNode.type === "Literal" &&
        (formatNode.value === "plain" || formatNode.value === "rich")
      )
    ) {
      context.report({ node: formatNode, messageId: "formatInvalid" });
    }
  }
  for (const name of ["min", "max"]) {
    const boundNode = props.get(name);
    if (
      boundNode &&
      !(
        boundNode.type === "Literal" &&
        typeof boundNode.value === "number" &&
        Number.isFinite(boundNode.value) &&
        boundNode.value >= 0
      )
    ) {
      context.report({
        node: boundNode,
        messageId: "boundInvalid",
        data: { name },
      });
    }
  }
}

function validateParamEntry(context, entry, seenIds, scope, sourceName) {
  if (!entry || entry.type !== "ObjectExpression") {
    context.report({ node: entry, messageId: "paramMustBeObject" });
    return;
  }

  const param = parseParamEntry(entry);
  validateParamIdentity(context, param, seenIds, sourceName);

  if (!PARAM_KIND_SET.has(param.kind)) {
    context.report({
      node: param.kindNode ?? entry,
      messageId: "paramKindInvalid",
    });
    return;
  }

  validateParamModifiers(context, param, scope);

  if (param.kind === "state") {
    validateStateParam(context, param);
    return;
  }
  if (param.kind === "value") {
    validateValueParam(context, param);
    return;
  }
  validateListParam(context, param, scope, sourceName);
}

const validateParamsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Validate STYLE_OPTIONS / CITATION_PARAMS / CITE_PARAMS declarations",
      url: ruleDocsUrl("validate-params"),
    },
    schema: [],
    messages: {
      paramsMustBeArray: "{{source}} should be an array of parameter objects.",
      paramMustBeObject: "Each parameter should be an object literal.",
      paramIdInvalid: "Each parameter needs a non-empty string 'id'.",
      paramIdDuplicate: "Duplicate parameter id '{{id}}' in {{source}}.",
      paramIdReserved:
        "'{{id}}' is a reserved declaration key and cannot be a parameter id.",
      paramLabelInvalid:
        "Parameter 'label' should be a non-empty plain string.",
      paramDescriptionInvalid:
        "Parameter 'description' should be a non-empty plain string when present.",
      paramKindInvalid: "Parameter 'kind' must be 'state', 'value' or 'list'.",
      applicableUnsupported:
        "STYLE_OPTIONS is document-wide; 'applicable' is only available on citation/cite parameters.",
      applicableMustBeFunction: "'applicable' must be a function.",
      forcedValueInvalid:
        "'forcedValue' must be a function, a value literal, or an array literal.",
      stateValidate: "'validate' is not available on state parameters.",
      statePresets: "'presets' are not available on state parameters.",
      stateFormat: "'format' is not available on state parameters.",
      statesInvalid: "'states' must be a non-empty object of key -> label.",
      statesEmpty:
        "'states' is empty; it declares no usable state and the runtime degrades to a boolean state.",
      stateKeyMustBeStatic:
        "State keys must be static string literals so defaultValue can be checked.",
      stateKeyInvalid: "State keys must be non-empty strings.",
      stateKeyReserved:
        "State key '{{key}}' is reserved and cannot be read back as a state.",
      stateKeyWhitespace:
        "State key '{{key}}' is trimmed to '{{trimmed}}' at runtime; write the trimmed key.",
      stateKeyDuplicate:
        "State key '{{key}}' collides with an earlier key after trimming to '{{trimmed}}'.",
      stateLabelInvalid:
        "State '{{key}}' should have a non-empty plain string label.",
      defaultNotInStates: "defaultValue '{{value}}' is not one of the states.",
      stateDefaultMissing:
        "A state with 'states' must declare a defaultValue naming one of its keys.",
      booleanDefaultInvalid:
        "A boolean state defaultValue must be a boolean literal.",
      valueDefaultInvalid:
        "A value parameter's defaultValue must be a string literal.",
      formatInvalid: "'format' must be 'plain' or 'rich'.",
      validateMustBeFunction: "'validate' must be a function.",
      presetsInvalid: "'presets' must be an array.",
      tooManyPresets:
        "A value parameter has {{count}} presets; at most " +
        MAX_PRESETS +
        " are kept.",
      tooManyStates:
        "A state parameter has {{count}} states; at most " +
        MAX_STATES +
        " are kept.",
      presetInvalid:
        "Each preset should be a non-empty string or an object with label/value strings.",
      listOnlyCite:
        "list parameters are only allowed in CITE_PARAMS, not {{source}}.",
      listFieldsInvalid: "A list needs a non-empty 'fields' array.",
      listFieldMustBeObject: "Each list field should be an object literal.",
      listFieldIdInvalid: "Each list field needs a non-empty string 'id'.",
      listFieldIdDuplicate: "Duplicate list field id '{{id}}'.",
      listFieldKindInvalid:
        "List fields must be value parameters ('kind: \"value\"').",
      listFieldConditionUnsupported:
        "applicable/forcedValue are not available inside a list field.",
      boundInvalid: "'{{name}}' must be a non-negative number literal.",
      tooManyStyleOptions:
        "STYLE_OPTIONS has {{count}} entries; at most 16 are kept.",
    },
  },
  create(context) {
    return {
      Program(node) {
        for (const sourceName of PARAM_EXPORTS) {
          const entryNode = getStyleEntryFromProgram(node, sourceName);
          if (!entryNode) continue;
          const entries = getStyleOptionEntries(entryNode);
          if (!entries) {
            context.report({
              node: entryNode,
              messageId: "paramsMustBeArray",
              data: { source: sourceName },
            });
            continue;
          }
          if (
            sourceName === "STYLE_OPTIONS" &&
            entries.length > STYLE_OPTION_MAX_COUNT
          ) {
            context.report({
              node: entryNode,
              messageId: "tooManyStyleOptions",
              data: { count: entries.length },
            });
          }
          const scope =
            sourceName === "STYLE_OPTIONS"
              ? "style"
              : sourceName === "CITATION_PARAMS"
                ? "citation"
                : "cite";
          const seenIds = new Set();
          for (const entry of entries) {
            validateParamEntry(context, entry, seenIds, scope, sourceName);
          }
        }
      },
    };
  },
};

const warnEmptyStyleOptionsRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when STYLE_OPTIONS is an empty array, which declares no options and is ignored",
      url: ruleDocsUrl("warn-empty-style-options"),
    },
    schema: [],
    messages: {
      emptyStyleOptions:
        "STYLE_OPTIONS is empty; it declares no options and the runtime ignores it.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const optionsNode = getStyleEntryFromProgram(node, "STYLE_OPTIONS");
        if (
          optionsNode?.type === "ArrayExpression" &&
          optionsNode.elements.filter(Boolean).length === 0
        ) {
          context.report({
            node: optionsNode,
            messageId: "emptyStyleOptions",
          });
        }
      },
    };
  },
};

const warnParamCountRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when STYLE_OPTIONS grows past the comfortable size (configurable, default 12)",
      url: ruleDocsUrl("warn-param-count"),
    },
    schema: [
      {
        type: "object",
        properties: {
          warnCount: { type: "integer", minimum: 1, maximum: 16 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      manyOptions:
        "STYLE_OPTIONS declares {{count}} parameters; consider splitting the style or moving per-citation differences into params.",
    },
  },
  create(context) {
    const warnCount =
      context.options[0]?.warnCount ?? DEFAULT_STYLE_OPTION_WARN_COUNT;
    return {
      Program(node) {
        const optionsNode = getStyleEntryFromProgram(node, "STYLE_OPTIONS");
        if (!optionsNode) return;
        const entries = getStyleOptionEntries(optionsNode);
        if (!entries) return;
        if (
          entries.length >= warnCount &&
          entries.length <= STYLE_OPTION_MAX_COUNT
        ) {
          context.report({
            node: optionsNode,
            messageId: "manyOptions",
            data: { count: entries.length },
          });
        }
      },
    };
  },
};
const validateItemFieldValidatorsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Validate the ITEM_FIELD_VALIDATORS declaration of a style (item-type object, checker arrays)",
      url: ruleDocsUrl("validate-item-field-validators"),
    },
    schema: [],
    messages: {
      validatorsMustBeObject:
        "ITEM_FIELD_VALIDATORS should be an object keyed by item type.",
      groupMustBeArray:
        "ITEM_FIELD_VALIDATORS['{{type}}'] should be a non-empty array of checker objects.",
      groupEmpty:
        "ITEM_FIELD_VALIDATORS['{{type}}'] has no checkers; the group is ignored.",
      groupKeyMustBeStatic:
        "ITEM_FIELD_VALIDATORS keys must be static item-type strings.",
      unknownItemType:
        "ITEM_FIELD_VALIDATORS: '{{type}}' is not a Zotero item type in schema revision {{revision}}.",
      checkerMustBeObject:
        "Each ITEM_FIELD_VALIDATORS checker should be an object literal.",
      descriptionInvalid:
        "Each ITEM_FIELD_VALIDATORS checker needs a non-empty plain string 'description'.",
      descriptionDuplicate:
        "Duplicate ITEM_FIELD_VALIDATORS description '{{description}}' for '{{type}}'.",
      checkInvalid:
        "ITEM_FIELD_VALIDATORS checker '{{description}}' needs a 'check' function (it may be async).",
    },
  },
  create(context) {
    return {
      Program(node) {
        const validatorsNode = getStyleEntryFromProgram(
          node,
          "ITEM_FIELD_VALIDATORS",
        );
        if (!validatorsNode) {
          return;
        }
        if (validatorsNode.type !== "ObjectExpression") {
          context.report({
            node: validatorsNode,
            messageId: "validatorsMustBeObject",
          });
          return;
        }

        for (const property of validatorsNode.properties) {
          if (property.type !== "Property" || property.kind !== "init") {
            continue;
          }
          const type = getStaticKeyName(property)?.trim() ?? null;
          if (type === null) {
            context.report({
              node: property,
              messageId: "groupKeyMustBeStatic",
            });
            continue;
          }
          if (!type) {
            context.report({
              node: property,
              messageId: "groupMustBeArray",
              data: { type: "(unnamed)" },
            });
            continue;
          }
          if (!ZOTERO_ITEM_TYPE_SET.has(type)) {
            context.report({
              node: property,
              messageId: "unknownItemType",
              data: { type, revision: SCHEMA_FACTS.schemaRevision },
            });
            continue;
          }
          const checkerNodes =
            property.value.type === "ArrayExpression"
              ? property.value.elements.filter(Boolean)
              : [];
          if (property.value.type !== "ArrayExpression") {
            context.report({
              node: property,
              messageId: "groupMustBeArray",
              data: { type },
            });
            continue;
          }
          if (!checkerNodes.length) {
            context.report({
              node: property,
              messageId: "groupEmpty",
              data: { type },
            });
            continue;
          }

          const descriptions = new Set();
          for (const entry of checkerNodes) {
            if (entry.type !== "ObjectExpression") {
              context.report({
                node: entry,
                messageId: "checkerMustBeObject",
              });
              continue;
            }

            const props = toObjectPropertyMap(entry);
            const descriptionNode = props.get("description");
            const description =
              descriptionNode?.type === "Literal" &&
              typeof descriptionNode.value === "string"
                ? descriptionNode.value.trim()
                : "";
            if (!description) {
              context.report({
                node: descriptionNode ?? entry,
                messageId: "descriptionInvalid",
              });
            } else if (descriptions.has(description)) {
              context.report({
                node: descriptionNode,
                messageId: "descriptionDuplicate",
                data: { description, type },
              });
            } else {
              descriptions.add(description);
            }

            const checkNode = props.get("check");
            if (!checkNode || !isFunctionLike(checkNode)) {
              context.report({
                node: checkNode ?? entry,
                messageId: "checkInvalid",
                data: { description: description || "(unnamed)" },
              });
            }
          }
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "require-style-contract": requireStyleContractRule,
    "warn-risky-runtime-pattern": warnRiskyRuntimePatternRule,
    "validate-field-presets": validateFieldPresetsRule,
    "validate-item-field-validators": validateItemFieldValidatorsRule,
    "warn-item-field-misuse": warnItemFieldMisuseRule,
    "validate-params": validateParamsRule,
    "warn-param-count": warnParamCountRule,
    "warn-empty-style-options": warnEmptyStyleOptionsRule,
  },
};

/**
 * Build the flat-config fragment every Banyan host shares: the author globals,
 * the plugin object and the recommended rule levels. Consumers combine it with
 * their own base config (usually `js.configs.recommended`) and file-specific
 * overrides.
 *
 * @param {object} [options]
 * @param {string[]} [options.files] style script globs
 * @param {string} [options.typingsDir] directory with `styleUtils.d.ts` and
 *   `unit.d.ts`; defaults to this module's directory, which is where Banyan
 *   copies the linter next to the generated typings at runtime
 * @param {Record<string, "readonly" | "writable" | "off">} [options.globals]
 *   additional host globals
 * @param {number} [options.warnCount] `STYLE_OPTIONS` warning threshold
 * @returns {object} a flat-config object
 */
export function createBanyanStyleConfig({
  files = ["**/*.js"],
  typingsDir,
  globals = {},
  warnCount = DEFAULT_STYLE_OPTION_WARN_COUNT,
} = {}) {
  return {
    name: "banyan-style/recommended",
    files,
    plugins: {
      banyanStyle: plugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        contexts: "readonly",
        options: "readonly",
        // The sandbox provides the familiar console (see the author contract).
        console: "readonly",
        ...extractStyleUtilsReadonlyGlobals(typingsDir),
        ...globals,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "banyanStyle/require-style-contract": "error",
      "banyanStyle/warn-risky-runtime-pattern": "warn",
      "banyanStyle/validate-field-presets": "error",
      "banyanStyle/validate-item-field-validators": "error",
      "banyanStyle/validate-params": "error",
      "banyanStyle/warn-param-count": ["warn", { warnCount }],
      "banyanStyle/warn-empty-style-options": "warn",
      "banyanStyle/warn-item-field-misuse": "warn",
    },
  };
}

export { diagnosticIdFor, RULE_MESSAGE_DIAGNOSTICS } from "./diagnostics.mjs";

export default plugin;
