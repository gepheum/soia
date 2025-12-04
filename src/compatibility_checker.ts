import { ModuleSet } from "./module_set.js";
import type {
  Field,
  Method,
  Primitive,
  Record,
  RecordLocation,
  ResolvedType,
  Token,
} from "./types.js";

export interface BeforeAfter<T> {
  before: T;
  after: T;
}

export type BreakingChangeError =
  | {
      kind: "illegal-type-change";
      expression: BeforeAfter<Expression>;
      types: BeforeAfter<ResolvedType>;
    }
  | {
      kind: "missing-slots";
      recordName: BeforeAfter<Token>;
      recordExpression: BeforeAfter<Expression>;
      missingRangeStart: number;
      missingRangeEnd: number;
    }
  | {
      kind: "missing-record";
      recordName: Token;
      recordNumber: number;
    }
  | {
      kind: "missing-method";
      methodName: Token;
      methodNumber: number;
    }
  | {
      kind: "record-kind-change";
      recordName: BeforeAfter<Token>;
      recordExpression: BeforeAfter<Expression>;
      recordType: BeforeAfter<"struct" | "enum">;
    }
  | {
      kind: "removed-number-reintroduced";
      recordName: BeforeAfter<Token>;
      recordExpression: BeforeAfter<Expression>;
      removedNumber: number;
    }
  | {
      kind: "enum-variant-kind-change";
      recordName: BeforeAfter<Token>;
      enumEpression: BeforeAfter<Expression>;
      variantName: BeforeAfter<Token>;
    };

export type Expression =
  | {
      kind: "request-type";
      methodName: Token;
    }
  | {
      kind: "response-type";
      methodName: Token;
    }
  | {
      kind: "record";
      recordName: Token;
    }
  | {
      kind: "item";
      arrayExpression: Expression;
    }
  | {
      kind: "optional-value";
      optionalExpression: Expression;
    }
  | {
      kind: "property";
      structExpression: Expression;
      fieldName: Token;
    }
  | {
      kind: "as-variant";
      enumExpression: Expression;
      variantName: Token;
    };

export function checkBackwardCompatibility(
  moduleSet: BeforeAfter<ModuleSet>,
): readonly BreakingChangeError[] {
  return new BackwardCompatibilityChecker(moduleSet).check();
}

export function expressionToString(expression: Expression): string {
  switch (expression.kind) {
    case "request-type":
      return `(${expression.methodName.text}::request)`;
    case "response-type":
      return `(${expression.methodName.text}::response)`;
    case "record":
      return `${expression.recordName.text}`;
    case "item":
      return expressionToString(expression.arrayExpression) + "[*]";
    case "optional-value":
      return expressionToString(expression.optionalExpression) + "!";
    case "property": {
      const structExpression = expressionToString(expression.structExpression);
      return `${structExpression}.${expression.fieldName.text}`;
    }
    case "as-variant": {
      const enumExpression = expressionToString(expression.enumExpression);
      return `${enumExpression}.as_${expression.variantName.text}`;
    }
  }
}

class BackwardCompatibilityChecker {
  constructor(private readonly moduleSet: BeforeAfter<ModuleSet>) {}

  check(): readonly BreakingChangeError[] {
    for (const moduleBefore of this.moduleSet.before.resolvedModules) {
      for (const methodBefore of moduleBefore.methods) {
        if (methodBefore.hasExplicitNumber) {
          const { number } = methodBefore;
          const methodAfter = this.moduleSet.after.findMethodByNumber(number);
          if (methodAfter === undefined) {
            this.errors.push({
              kind: "missing-method",
              methodName: methodBefore.name,
              methodNumber: number,
            });
          } else {
            this.checkMethod({
              before: methodBefore,
              after: methodAfter,
            });
          }
        }
      }
      for (const recordBefore of moduleBefore.records) {
        const { recordNumber } = recordBefore.record;
        if (recordNumber !== null) {
          const recordAfter =
            this.moduleSet.after.findRecordByNumber(recordNumber);
          if (recordAfter === undefined) {
            this.errors.push({
              kind: "missing-record",
              recordName: recordBefore.record.name,
              recordNumber: recordNumber,
            });
          } else {
            const record: BeforeAfter<RecordLocation> = {
              before: recordBefore,
              after: recordAfter,
            };
            this.checkRecord(
              record,
              map(record, (r) => ({
                kind: "record",
                recordName: r.record.name,
              })),
            );
          }
        }
      }
    }
    return this.errors;
  }

  private checkMethod(method: BeforeAfter<Method>): void {
    this.checkType(
      map(method, (m) => m.requestType!),
      map(method, (m) => ({ kind: "request-type", methodName: m.name })),
    );
    this.checkType(
      map(method, (m) => m.responseType!),
      map(method, (m) => ({ kind: "response-type", methodName: m.name })),
    );
  }

  private checkRecord(
    record: BeforeAfter<RecordLocation>,
    recordExpression: BeforeAfter<Expression>,
  ): void {
    const recordName = map(record, (r) => r.record.name);
    const recordType = map(record, (r) => r.record.recordType);
    if (recordType.after !== recordType.before) {
      this.pushError({
        kind: "record-kind-change",
        recordName,
        recordExpression,
        recordType,
      });
      return;
    }
    const isStruct = recordType.before === "struct";
    const { numSlotsInclRemovedNumbers } = record.before.record;
    if (
      record.after.record.numSlotsInclRemovedNumbers <
      numSlotsInclRemovedNumbers
    ) {
      this.pushError({
        kind: "missing-slots",
        recordName,
        recordExpression,
        missingRangeStart: record.after.record.numSlotsInclRemovedNumbers,
        missingRangeEnd: numSlotsInclRemovedNumbers,
      });
      return;
    }
    const numberToFieldAfter = indexFields(record.after.record);
    // Check that no removed number was reintroduced.
    for (const removedNumber of record.before.record.removedNumbers) {
      if (numberToFieldAfter.has(removedNumber)) {
        this.pushError({
          kind: "removed-number-reintroduced",
          recordName,
          recordExpression,
          removedNumber: removedNumber,
        });
      }
    }
    for (const fieldBefore of record.before.record.fields) {
      const fieldAfter = numberToFieldAfter.get(fieldBefore.number);
      if (fieldAfter === undefined) {
        continue;
      }
      if (fieldBefore.type && fieldAfter.type) {
        this.checkType(
          {
            before: fieldBefore.type,
            after: fieldAfter.type,
          },
          isStruct
            ? {
                before: {
                  kind: "property",
                  structExpression: recordExpression.before,
                  fieldName: fieldBefore.name,
                },
                after: {
                  kind: "property",
                  structExpression: recordExpression.after,
                  fieldName: fieldAfter.name,
                },
              }
            : {
                before: {
                  kind: "as-variant",
                  enumExpression: recordExpression.before,
                  variantName: fieldBefore.name,
                },
                after: {
                  kind: "as-variant",
                  enumExpression: recordExpression.after,
                  variantName: fieldAfter.name,
                },
              },
        );
      } else if (fieldBefore.type || fieldAfter.type) {
        this.pushError({
          kind: "enum-variant-kind-change",
          recordName,
          enumEpression: recordExpression,
          variantName: {
            before: fieldBefore.name,
            after: fieldAfter.name,
          },
        });
      }
    }
  }

  private checkType(
    type: BeforeAfter<ResolvedType>,
    expression: BeforeAfter<Expression>,
  ): null {
    const illegalTypeChangeError: BreakingChangeError = {
      kind: "illegal-type-change",
      expression: expression,
      types: type,
    };
    switch (type.before.kind) {
      case "array": {
        if (type.after.kind === "array") {
          return this.checkType(
            {
              before: type.before.item,
              after: type.after.item,
            },
            map(expression, (e) => ({
              kind: "item",
              arrayExpression: e,
            })),
          );
        } else {
          this.pushError(illegalTypeChangeError);
          return null;
        }
      }
      case "optional": {
        if (type.after.kind === "optional") {
          return this.checkType(
            {
              before: type.before.other,
              after: type.after.other,
            },
            map(expression, (e) => ({
              kind: "optional-value",
              optionalExpression: e,
            })),
          );
        } else {
          this.pushError(illegalTypeChangeError);
          return null;
        }
      }
      case "record": {
        if (type.after.kind === "record") {
          const record: BeforeAfter<RecordLocation> = {
            before: this.moduleSet.before.recordMap.get(type.before.key)!,
            after: this.moduleSet.after.recordMap.get(type.after.key)!,
          };
          this.checkRecord(record, expression);
          return null;
        } else {
          this.pushError(illegalTypeChangeError);
          return null;
        }
      }
      case "primitive": {
        if (
          type.after.kind !== "primitive" ||
          !primitiveTypesAreCompatible({
            before: type.before.primitive,
            after: type.after.primitive,
          })
        ) {
          this.pushError(illegalTypeChangeError);
        }
        return null;
      }
    }
  }

  private pushError(error: BreakingChangeError): void {
    const token = getTokenForError(error);
    if (token === null) {
      return;
    }
    let tokenErrorKinds = this.tokenToErrorKinds.get(token);
    if (tokenErrorKinds === undefined) {
      tokenErrorKinds = new Set();
      this.tokenToErrorKinds.set(token, tokenErrorKinds);
    }
    if (tokenErrorKinds.has(error.kind)) {
      return;
    }
    tokenErrorKinds.add(error.kind);
    this.errors.push(error);
  }

  private readonly errors: BreakingChangeError[] = [];
  // This map helps avoid reporting multiple variants of the same error on the
  // same token multiple times.
  private readonly tokenToErrorKinds = new Map<
    Token,
    Set<BreakingChangeError["kind"]>
  >();
}

function getTokenForError(error: BreakingChangeError): Token | null {
  switch (error.kind) {
    case "illegal-type-change": {
      return getTokenForExpression(error.expression.after);
    }
    case "missing-slots":
    case "record-kind-change":
    case "enum-variant-kind-change":
    case "removed-number-reintroduced": {
      return error.recordName.after;
    }
    case "missing-record":
    case "missing-method": {
      return null;
    }
  }
}

function getTokenForExpression(expression: Expression): Token {
  switch (expression.kind) {
    case "item": {
      return getTokenForExpression(expression.arrayExpression);
    }
    case "optional-value": {
      return getTokenForExpression(expression.optionalExpression);
    }
    case "property": {
      return expression.fieldName;
    }
    case "as-variant": {
      return expression.variantName;
    }
    case "record": {
      return expression.recordName;
    }
    case "request-type": {
      return expression.methodName;
    }
    case "response-type": {
      return expression.methodName;
    }
  }
}

function primitiveTypesAreCompatible(type: BeforeAfter<Primitive>): boolean {
  switch (type.before) {
    case "bool":
      return (
        type.after === "bool" ||
        type.after === "int32" ||
        type.after === "int64" ||
        type.after === "uint64" ||
        type.after === "float32" ||
        type.after === "float64"
      );
    case "int32":
      return (
        type.after === "int32" ||
        type.after === "int64" ||
        type.after === "uint64" ||
        type.after === "float32" ||
        type.after === "float64"
      );
    case "int64":
      return (
        type.after === "int64" ||
        type.after === "float32" ||
        type.after === "float64"
      );
    case "uint64":
      return (
        type.after === "uint64" ||
        type.after === "float32" ||
        type.after === "float64"
      );
    case "float32":
    case "float64":
      return type.after === "float32" || type.after === "float64";
    case "timestamp":
    case "string":
    case "bytes":
      return type.after === "bytes";
  }
}

function indexFields(record: Record): Map<number, Field> {
  const result = new Map<number, Field>();
  for (const field of record.fields) {
    result.set(field.number, field);
  }
  return result;
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
