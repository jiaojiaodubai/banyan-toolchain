import type {
  AffixUnit,
  FallbackUnit,
  GroupUnit,
  LinkUnit,
  PrintableValue,
  RenderStyle,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
  UnitUtils,
  WhenUnit,
  WithStyleUnit,
} from "../types/unit";
import type { RichText } from "../types/unit";
import {
  compileRichText,
  normalizeTextValue,
  plainTextOfUnit,
} from "./compile";

// The text-case algorithms stay the core's own decision (`./compile` applies
// them); hosts cannot swap them out.
export { applyTextCase, normalizeTextValue } from "./compile";

function toUnit(value: PrintableValue, style?: RenderStyle): TextUnit {
  return {
    value: normalizeTextValue(value),
    ...style,
  };
}

export function plainText(input: Unit | readonly Unit[]): string {
  const units: readonly Unit[] = Array.isArray(input) ? input : [input];
  return units.map((unit) => plainTextOfUnit(unit)).join("");
}

export const unitUtils = {
  text: toUnit,
  plainText,
  group: (units: Unit[], delimiter?: Unit): GroupUnit => ({
    type: "group",
    units,
    ...(delimiter === undefined ? {} : { delimiter }),
  }),
  affix: (unit: Unit, prefix?: Unit, suffix?: Unit): AffixUnit => ({
    type: "affix",
    unit,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  }),
  fallback: (units: Unit[]): FallbackUnit => {
    return { type: "fall", units };
  },
  when: (condition: boolean, trueUnit: Unit, elseUnit?: Unit): WhenUnit => ({
    type: "when",
    condition,
    trueUnit,
    ...(elseUnit === undefined ? {} : { elseUnit }),
  }),
  textCase: (
    unit: Unit,
    form: TextCaseForm,
    ignoreWords?: string[],
  ): TextCaseUnit => ({
    type: "text-case",
    unit,
    form,
    ...(ignoreWords === undefined ? {} : { ignoreWords }),
  }),
  withStyle: (unit: Unit, style: RenderStyle): WithStyleUnit => {
    return { type: "style", unit, style };
  },
  link: (unit: Unit, link: string): LinkUnit => {
    return { type: "link", unit, link };
  },
} satisfies UnitUtils;

/** Compile a unit tree with the core's own semantics. */
export function compile(unit: Unit): RichText {
  return compileRichText(unit);
}
