/**
 * Map ESLint rule/message pairs onto the shared diagnostic catalogue.
 *
 * ESLint reports a `messageId` (the stable key in `meta.messages`), not a
 * contract identifier. Keeping the mapping here means a rule can be renamed or
 * reworded without silently changing the conformance vocabulary; a missing
 * entry is an explicit gap, not a guessed identifier.
 */
export const RULE_MESSAGE_DIAGNOSTICS = {
  "require-style-contract/missingEntries": "style.export.missing",
  "require-style-contract/entryMustBeFunction": "style.entry.not-function",
  "require-style-contract/infoMustBeObject": "style.info.not-object",
  "require-style-contract/infoMissingFields": "style.info.field.missing",
  "require-style-contract/infoFieldMustBeString":
    "style.info.field.invalid-type",
  "require-style-contract/infoFieldMustBeArray":
    "style.info.field.invalid-type",
  "require-style-contract/infoCitationTypeInvalid":
    "style.info.citation-type.invalid",
  "require-style-contract/creatorMissingFields": "style.info.creator.invalid",

  "warn-risky-runtime-pattern/directRecursion": "lint.recursion.direct",
  "warn-risky-runtime-pattern/unboundedWhile": "lint.loop.unbounded-while",
  "warn-risky-runtime-pattern/unboundedFor": "lint.loop.unbounded-for",
  "warn-risky-runtime-pattern/largeSyncLoop": "lint.loop.large-bound",

  "warn-item-field-misuse/labelRead": "lint.item-field.label",
  "warn-item-field-misuse/labelReadMissing": "lint.item-field.label",
  "warn-item-field-misuse/notCarried": "lint.item-field.not-carried",
  "warn-item-field-misuse/hostPrivate": "lint.item-field.host-private",

  "warn-param-count/manyOptions": "lint.param-count",
  "warn-empty-style-options/emptyStyleOptions": "param.style-options.empty",

  "validate-params/paramsMustBeArray": "declaration.export.not-array",
  "validate-params/paramMustBeObject": "declaration.entry.not-object",
  "validate-params/paramIdInvalid": "declaration.id.invalid",
  "validate-params/paramIdDuplicate": "declaration.id.duplicate",
  "validate-params/paramIdReserved": "declaration.id.reserved",
  "validate-params/paramLabelInvalid": "declaration.label.invalid",
  "validate-params/paramDescriptionInvalid": "declaration.description.invalid",
  "validate-params/paramKindInvalid": "declaration.kind.invalid",
  "validate-params/applicableUnsupported": "param.applicable.unsupported",
  "validate-params/applicableMustBeFunction": "param.applicable.invalid",
  "validate-params/forcedValueInvalid": "param.forced-value.invalid",
  "validate-params/stateValidate": "param.state.validate-unsupported",
  "validate-params/statePresets": "param.state.presets-unsupported",
  "validate-params/stateFormat": "param.state.format-unsupported",
  "validate-params/statesInvalid": "param.states.invalid",
  "validate-params/statesEmpty": "param.states.empty",
  "validate-params/stateKeyMustBeStatic": "param.states.key.dynamic",
  "validate-params/stateKeyInvalid": "param.states.key.invalid",
  "validate-params/stateKeyReserved": "param.states.key.invalid",
  "validate-params/stateKeyWhitespace": "param.states.key.whitespace",
  "validate-params/stateKeyDuplicate": "param.states.key.duplicate",
  "validate-params/stateLabelInvalid": "param.states.label.invalid",
  "validate-params/defaultNotInStates": "param.state.default.invalid",
  "validate-params/stateDefaultMissing": "param.state.default.missing",
  "validate-params/booleanDefaultInvalid":
    "param.state.default.boolean-invalid",
  "validate-params/valueDefaultInvalid": "param.value.default.invalid",
  "validate-params/formatInvalid": "param.format.invalid",
  "validate-params/validateMustBeFunction": "param.validate.invalid",
  "validate-params/presetsInvalid": "param.presets.invalid",
  "validate-params/presetInvalid": "param.preset.invalid",
  "validate-params/tooManyPresets": "param.presets.limit",
  "validate-params/tooManyStates": "param.states.limit",
  "validate-params/tooManyStyleOptions": "param.style-options.limit",
  "validate-params/listOnlyCite": "param.list.scope",
  "validate-params/listFieldsInvalid": "param.list.fields-invalid",
  "validate-params/listFieldMustBeObject": "param.list.field.not-object",
  "validate-params/listFieldIdInvalid": "param.list.field.id.invalid",
  "validate-params/listFieldIdDuplicate": "param.list.field.id.duplicate",
  "validate-params/listFieldKindInvalid": "param.list.field.kind.invalid",
  "validate-params/listFieldConditionUnsupported":
    "param.list.field.condition-unsupported",
  "validate-params/boundInvalid": "param.list.minmax.invalid",

  "validate-field-presets/presetsMustBeArray": "preset.export.not-array",
  "validate-field-presets/presetMustBeObject": "preset.entry.not-object",
  "validate-field-presets/presetIdInvalid": "preset.id.invalid",
  "validate-field-presets/presetIdDuplicate": "preset.id.duplicate",
  "validate-field-presets/presetLabelInvalid": "preset.label.invalid",
  "validate-field-presets/presetVisibleInvalid": "preset.visible.invalid",
  "validate-field-presets/fieldsMissing": "preset.fields.missing",
  "validate-field-presets/fieldsMustBeNonEmptyObject": "preset.fields.invalid",
  "validate-field-presets/fieldValueInvalid": "preset.field.value.invalid",
  "validate-field-presets/fieldKeyDenied": "preset.field.key.denied",
  "validate-field-presets/fieldKeyIsNameVariable": "preset.field.name-variable",
  "validate-field-presets/fieldKeyInvalidSyntax": "preset.field.key.invalid",
  "validate-field-presets/fieldKeyMustBeStatic": "preset.field.key.dynamic",

  "validate-item-field-validators/validatorsMustBeObject":
    "validator.export.not-object",
  "validate-item-field-validators/groupMustBeArray":
    "validator.group.not-array",
  "validate-item-field-validators/groupEmpty": "validator.group.empty",
  "validate-item-field-validators/groupKeyMustBeStatic":
    "validator.group.key.dynamic",
  "validate-item-field-validators/unknownItemType":
    "validator.group.unknown-item-type",
  "validate-item-field-validators/checkerMustBeObject":
    "validator.entry.not-object",
  "validate-item-field-validators/descriptionInvalid":
    "validator.description.invalid",
  "validate-item-field-validators/descriptionDuplicate":
    "validator.description.duplicate",
  "validate-item-field-validators/checkInvalid": "validator.check.invalid",
};

/** Resolve one ESLint report to its contract identifier, if mapped. */
export function diagnosticIdFor(ruleId, messageId) {
  if (!ruleId || !messageId) return undefined;
  const shortRule = ruleId.replace(/^banyanStyle\//, "");
  return RULE_MESSAGE_DIAGNOSTICS[`${shortRule}/${messageId}`];
}
