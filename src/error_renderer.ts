import { caseMatches } from "./casing.js";
import {
  BeforeAfter,
  BreakingChange,
  Expression,
  getTokenForBreakingChange,
} from "./compatibility_checker.js";
import { ModuleSet } from "./module_set.js";
import { RecordLocation, ResolvedType, SkirError, Token } from "./types.js";

export function renderErrors(errors: readonly SkirError[]): void {
  const MAX_ERRORS = 10;
  for (let i = 0; i < errors.length && i < MAX_ERRORS; ++i) {
    const error = errors[i];
    console.error(formatError(error!));
  }
  // Count the number of distinct modules with errors.
  if (errors.length) {
    const modules = new Set<string>();
    for (const error of errors) {
      modules.add(error.token.line.modulePath);
    }
    const numErrors = `${errors.length} error${errors.length <= 1 ? "" : "s"}`;
    const numFiles = `${modules.size} file${modules.size <= 1 ? "" : "s"}`;
    console.error(`Found ${numErrors} in ${numFiles}\n`);
  }
}

export function formatError(error: SkirError): string {
  const { token } = error;
  const { line, colNumber } = token;
  const lineNumberStr = (line.lineNumber + 1).toString();
  let result = formatLocation(token);
  result += " - ";
  if (error.expected !== undefined) {
    result += makeRed("expected");
    result += `: ${error.expected}`;
  } else {
    result += makeRed("error");
    result += `: ${error.message}`;
  }
  result += "\n\n";
  result += makeBlackOnWhite(lineNumberStr);
  result += " ";
  result += line.line;
  result += "\n";
  result += makeBlackOnWhite(" ".repeat(lineNumberStr.length));
  result += " ".repeat(colNumber + 1);
  result += makeRed("~".repeat(Math.max(token.originalText.length, 1)));
  result += "\n";
  return result;
}

export function renderBreakingChanges(
  breakingChanges: readonly BreakingChange[],
  moduleSet: BeforeAfter<ModuleSet>,
): void {
  const MAX = 10;
  for (let i = 0; i < breakingChanges.length && i < MAX; ++i) {
    const breakingChange = breakingChanges[i]!;
    console.error(formatBreakingChange(breakingChange, moduleSet));
    console.error();
  }
  const numBreakingChanges = breakingChanges.length;
  const s = numBreakingChanges === 1 ? "" : "s";
  if (numBreakingChanges) {
    console.error(`Found ${numBreakingChanges} breaking change${s}\n`);
  }
}

function formatBreakingChange(
  breakingChange: BreakingChange,
  moduleSet: BeforeAfter<ModuleSet>,
): string {
  const token = getTokenForBreakingChange(breakingChange);
  const locationPrefix = token ? formatLocation(token) + " - " : "";
  switch (breakingChange.kind) {
    case "illegal-type-change": {
      const { expression, type } = breakingChange;
      const errorHeader = makeRed("Illegal type change");
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(expression.before)}`,
        `          ${makeGray("Type:")} ${formatType(type.before, moduleSet.before)}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(expression.after)}`,
        `          ${makeGray("Type:")} ${formatType(type.after, moduleSet.after)}`,
      ].join("\n");
    }
    case "missing-slots": {
      const { missingRangeEnd, missingRangeStart, recordExpression, record } =
        breakingChange;
      const errorHeader = makeRed("Missing slots in record");
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.before)}`,
        `        ${makeGray("Record:")} ${record.before.record.name.text}`,
        `         ${makeGray("Slots:")} ${missingRangeEnd}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.after)}`,
        `        ${makeGray("Record:")} ${record.after.record.name.text}`,
        `         ${makeGray("Slots:")} ${missingRangeStart}\n`,
        `  ${makeGray("Fix:")} mark the field numbers as removed`,
      ].join("\n");
    }
    case "missing-record": {
      const { record, recordNumber } = breakingChange;
      const recordDefinition = [
        record.record.recordType,
        " ",
        getQualifiedName(record),
      ].join("");
      return [
        `${makeRed("Missing record")}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Record:")} ${recordDefinition}`,
        `    ${makeGray("Number:")} ${recordNumber}`,
      ].join("\n");
    }
    case "missing-method": {
      const { method } = breakingChange;
      const methodDefinition = [
        "method ",
        method.name.text,
        "(",
        formatType(method.requestType!, moduleSet.before),
        "): ",
        formatType(method.responseType!, moduleSet.before),
      ].join("");
      return [
        `${makeRed("Missing method")}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Method:")} ${methodDefinition}`,
        `    ${makeGray("Number:")} ${method.number}`,
      ].join("\n");
    }
    case "variant-kind-change": {
      const { enumEpression, number, record, variantName } = breakingChange;
      const errorHeader = makeRed("Illegal variant kind change");
      const enumName = map(record, getQualifiedName);
      const variantKind = map(variantName, (vn) => {
        caseMatches(vn.text, "lower_underscore") ? "wrapper" : "constant";
      });
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(enumEpression.before)}`,
        `          ${makeGray("Enum:")} ${enumName.before}`,
        `       ${makeGray("Variant:")} ${variantName.before.text}`,
        `        ${makeGray("Number:")} ${number}`,
        `          ${makeGray("Kind:")} ${variantKind.before}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(enumEpression.after)}`,
        `          ${makeGray("Enum:")} ${enumName.after}`,
        `       ${makeGray("Variant:")} ${variantName.after.text}`,
        `        ${makeGray("Number:")} ${number}`,
        `          ${makeGray("Kind:")} ${variantKind.after}`,
      ].join("\n");
    }
    case "missing-variant": {
      const { enumEpression, number, record, variantName } = breakingChange;
      const errorHeader = makeRed("Missing variant");
      const enumName = map(record, getQualifiedName);
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(enumEpression.before)}`,
        `          ${makeGray("Enum:")} ${enumName.before}`,
        `       ${makeGray("Variant:")} ${variantName.text}`,
        `        ${makeGray("Number:")} ${number}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(enumEpression.after)}`,
        `          ${makeGray("Enum:")} ${enumName.after}`,
      ].join("\n");
    }
    case "record-kind-change": {
      const { record, recordExpression, recordType } = breakingChange;
      const errorHeader = makeRed("Record kind change");
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.before)}`,
        `        ${makeGray("Record:")} ${record.before.record.name.text}`,
        `          ${makeGray("Kind:")} ${recordType.before}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.after)}`,
        `        ${makeGray("Record:")} ${record.after.record.name.text}`,
        `          ${makeGray("Kind:")} ${recordType.after}`,
      ].join("\n");
    }
    case "removed-number-reintroduced": {
      const { record, recordExpression, reintroducedAs, removedNumber } =
        breakingChange;
      const errorHeader = makeRed("Removed number reintroduced");
      return [
        `${locationPrefix}${errorHeader}\n`,
        "  [Last snapshot]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.before)}`,
        `        ${makeGray("Record:")} ${record.before.record.name.text}`,
        `       ${makeGray("Removed:")} ${removedNumber}\n`,
        "  [Now]\n",
        `    ${makeGray("Expression:")} ${formatExpression(recordExpression.after)}`,
        `        ${makeGray("Record:")} ${record.after.record.name.text}`,
        record.after.record.recordType === "struct"
          ? `         ${makeGray("Field:")} ${reintroducedAs.text}`
          : `       ${makeGray("Variant:")} ${reintroducedAs.text}`,
      ].join("\n");
    }
  }
}

function formatLocation(token: Token): string {
  const { line, colNumber } = token;
  return [
    makeCyan(line.modulePath),
    makeYellow((line.lineNumber + 1).toString()),
    makeYellow((colNumber + 1).toString()),
  ].join(":");
}

function formatExpression(expression: Expression): string {
  switch (expression.kind) {
    case "request-type":
      return `(${expression.methodName.text}::request)`;
    case "response-type":
      return `(${expression.methodName.text}::response)`;
    case "record":
      return `${expression.recordName.text}`;
    case "item":
      return formatExpression(expression.arrayExpression) + "[*]";
    case "optional-value":
      return formatExpression(expression.optionalExpression) + "!";
    case "property": {
      const structExpression = formatExpression(expression.structExpression);
      return `${structExpression}.${expression.fieldName.text}`;
    }
    case "as-variant": {
      const enumExpression = formatExpression(expression.enumExpression);
      return `${enumExpression}.as_${expression.variantName.text}`;
    }
  }
}

function formatType(resolvedType: ResolvedType, moduleSet: ModuleSet): string {
  switch (resolvedType.kind) {
    case "array":
      return `[${formatType(resolvedType.item, moduleSet)}]`;
    case "optional":
      return `${formatType(resolvedType.other, moduleSet)}?`;
    case "primitive":
      return resolvedType.primitive;
    case "record": {
      const record = moduleSet.recordMap.get(resolvedType.key)!;
      return getQualifiedName(record);
    }
  }
}

function getQualifiedName(recordLocation: RecordLocation): string {
  return recordLocation.recordAncestors.map((r) => r.name.text).join(".");
}

function map<T, U>(
  beforeAfter: BeforeAfter<T>,
  fn: (value: T) => U,
): BeforeAfter<U> {
  return {
    before: fn(beforeAfter.before),
    after: fn(beforeAfter.after),
  };
}

export function makeRed(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

export function makeGreen(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

export function makeGray(text: string): string {
  return `\x1b[90m${text}\x1b[0m`;
}

function makeCyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}

function makeYellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function makeBlackOnWhite(text: string): string {
  return `\x1b[47m${text}\x1b[0m`;
}
