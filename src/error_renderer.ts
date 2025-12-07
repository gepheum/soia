import { caseMatches } from "./casing.js";
import {
  BeforeAfter,
  BreakingChange,
  Expression,
  getTokenForExpression,
} from "./compatibility_checker.js";
import { ModuleSet } from "./module_set.js";
import { RecordLocation, ResolvedType, SoiaError, Token } from "./types.js";

export function renderErrors(errors: readonly SoiaError[]): void {
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

export function makeRed(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

export function makeGreen(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

export function makeGray(text: string): string {
  return `\x1b[90m${text}\x1b[0m`;
}

export function makeCyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}

export function makeYellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

export function makeBlackOnWhite(text: string): string {
  return `\x1b[47m${text}\x1b[0m`;
}

export function formatError(error: SoiaError): string {
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
  result += makeRed("~".repeat(Math.max(token.text.length, 1)));
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
  }
  // Count the number of distinct modules with errors.
  if (breakingChanges.length) {
    console.error(`Found ${breakingChanges.length} errors\n`);
  }
}

function formatBreakingChange(
  breakingChange: BreakingChange,
  moduleSet: BeforeAfter<ModuleSet>,
): string {
  switch (breakingChange.kind) {
    case "illegal-type-change": {
      const { expression, type } = breakingChange;
      const location = formatLocation(getTokenForExpression(expression.after));
      const errorHeader = makeRed("Illegal type change");
      return [
        `${location} - ${errorHeader}`,
        "  [Last snapshot]",
        `    Expression: ${formatExpression(expression.before)}`,
        `          Type: ${formatType(type.before, moduleSet.before)}`,
        "  [Now]",
        `    Expression: ${formatExpression(expression.after)}`,
        `          Type: ${formatType(type.after, moduleSet.after)}`,
      ].join("\n");
    }
    case "missing-slots": {
      const { missingRangeEnd, missingRangeStart, recordExpression, record } =
        breakingChange;
      const location = formatLocation(record.after.record.name);
      const errorHeader = makeRed("Missing slots in record");
      return [
        `${location} - ${errorHeader}`,
        "  [Last snapshot]",
        `    Expression: ${formatExpression(recordExpression.before)}`,
        `        Record: ${record.before.record.name.text}`,
        `         Slots: ${missingRangeEnd}`,
        "  [Now]",
        `    Expression: ${formatExpression(recordExpression.after)}`,
        `        Record: ${record.after.record.name.text}`,
        `         Slots: ${missingRangeStart}`,
        "  Fix: mark the field numbers as removed",
      ].join("\n");
    }
    case "missing-record": {
      const { record, recordNumber } = breakingChange;
      const recordDefinition = [
        record.record.recordType,
        " ",
        getQualifiedName(record),
        `(${recordNumber})`,
      ].join("");
      return [
        makeRed("Missing record"),
        "  [Last snapshot]",
        `        Record: ${recordDefinition}`,
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
        ` = ${method.number}`,
      ].join("");
      return [
        makeRed("Missing method"),
        "  [Last snapshot]",
        `        Method: ${methodDefinition}`,
      ].join("\n");
    }
    case "enum-variant-kind-change": {
      const { record, variantName, number } = breakingChange;
      const location = formatLocation(record.after.record.name);
      const errorHeader = makeRed("Illegal variant kind change");
      const enumName = map(record, getQualifiedName);
      const variantKind = map(variantName, (vn) => {
        caseMatches(vn.text, "lower_underscore") ? "wrapper" : "constant";
      });
      return [
        `${location} - ${errorHeader}`,
        "  [Last snapshot]",
        `       Enum: ${enumName.before}`,
        `    Variant: ${variantName.before.text} = ${number}`,
        `       Kind: ${variantKind.before}`,
        "  [Now]",
        `       Enum: ${enumName.after}`,
        `    Variant: ${variantName.after.text} = ${number}`,
        `       Kind: ${variantKind.after}`,
      ].join("\n");
    }
    case "record-kind-change": {
      const { record, recordExpression, recordType } = breakingChange;
      const location = formatLocation(record.after.record.name);
      const errorHeader = makeRed("Record kind change");
      return [
        `${location} - ${errorHeader}`,
        "  [Last snapshot]",
        `    Expression: ${formatExpression(recordExpression.before)}`,
        `        Record: ${record.before.record.name.text}`,
        `          Kind: ${recordType.before}`,
        "  [Now]",
        `    Expression: ${formatExpression(recordExpression.after)}`,
        `        Record: ${record.after.record.name.text}`,
        `          Kind: ${recordType.after}`,
      ].join("\n");
    }
    case "removed-number-reintroduced": {
      const { record, recordExpression, reintroducedAs, removedNumber } =
        breakingChange;
      const location = formatLocation(record.after.record.name);
      const errorHeader = makeRed("Removed number reintroduced");
      return [
        `${location} - ${errorHeader}`,
        "  [Last snapshot]",
        `    Expression: ${formatExpression(recordExpression.before)}`,
        `        Record: ${record.before.record.name.text}`,
        `       Removed: ${removedNumber}`,
        "  [Now]",
        `    Expression: ${formatExpression(recordExpression.after)}`,
        `        Record: ${record.after.record.name.text}`,
        record.after.record.recordType === "struct"
          ? `         Field: ${reintroducedAs.text}`
          : `       Variant: ${reintroducedAs.text}`,
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
