import { expect } from "buckwheat";
import { describe, it } from "mocha";
import {
  BeforeAfter,
  BreakingChangeError,
  checkBackwardCompatibility,
} from "./compatibility_checker.js";
import { ModuleSet, makeMapBasedModuleParser } from "./module_set.js";

describe("compatibility checker", () => {
  it("compatible changes", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct Point {
            x: int32;
            y: int32;
          }

          struct Triangle(789) {
            a: Point;
            b: Point;
            removed;
            c: Point;
            other_points: [Point];
          }

          enum Status {
            OK;
            error: string;
          }

          struct Rec(790) {
            self: Rec;
            struct Foo {
              value: int32;
              rec: Rec;
            }
            foo: Foo;
            foos: [Foo];
          }

          method Capitalize(string): string = 101;
        `,
        after: `
          struct PointPoint {
            xx: int64;
            yy: float32;
          }

          struct Triangle(789) {
            a: PointPoint;
            b: PointPoint;
            removed;
            c: PointPoint;
            other_points: [PointPoint];
            removed;
            new_field: string;
          }

          struct Foo(791) {}

          enum Status {
            OK;
            error: string;
            new_variant: int32;
            NEW_CONSTANT;
            removed;
          }

          struct RecRec(790) {
            self: RecRec;
            struct Foo {
              value: int32;
              rec: RecRec;
              removed;
            }
            foo: Foo;
            foos: [Foo];
            new_field: bool;
          }

          method Capitalize(string): string = 101;
          method Lowercase(string): string = 102;`,
      }),
    ).toMatch([]);
  });
  it("missing slots", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct A(101) {
            foo: string;
            removed;
            bar: string;
            removed;
          }
        `,
        after: `
          struct B(101) {
            foo: string;
            removed;
          }
        `,
      }),
    ).toMatch([
      {
        kind: "missing-slots",
        recordName: {
          before: {
            text: "A",
          },
          after: {
            text: "B",
          },
        },
        recordExpression: {
          before: {
            kind: "record",
            recordName: {
              text: "A",
            },
          },
          after: {
            kind: "record",
            recordName: {
              text: "B",
            },
          },
        },
        missingRangeStart: 2,
        missingRangeEnd: 4,
      },
    ]);
  });

  it("missing record", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct A(101) {
            foo: string;
          }
        `,
        after: `
          struct A {
          }
        `,
      }),
    ).toMatch([
      {
        kind: "missing-record",
        recordName: {
          text: "A",
        },
        recordNumber: 101,
      },
    ]);
  });

  it("missing method", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          method Capitalize(string): string = 101;
        `,
        after: `
          method Capitalize(string): string;
        `,
      }),
    ).toMatch([
      {
        kind: "missing-method",
        methodName: {
          text: "Capitalize",
        },
        methodNumber: 101,
      },
    ]);
  });

  it("removed number reintroduced", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct A(101) {
            foo: string;
            removed;
            bar: string;
            removed;
          }
        `,
        after: `
          struct B(101) {
            foo: string;
            removed;
            bar: string;
            zoo: int32;
          }
        `,
      }),
    ).toMatch([
      {
        kind: "removed-number-reintroduced",
        recordName: {
          before: {
            text: "A",
          },
          after: {
            text: "B",
          },
        },
        recordExpression: {
          before: {
            kind: "record",
            recordName: {
              text: "A",
            },
          },
          after: {
            kind: "record",
            recordName: {
              text: "B",
            },
          },
        },
        removedNumber: 3,
      },
    ]);
  });

  it("record kind change", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct Bar {}

          struct Foo {
            bar: Bar;
          }

          struct A(101) {
            foo: Foo;
          }
        `,
        after: `
          enum BarBar {}

          struct Foo {
            barbar: BarBar;
            bar: BarBar;
          }

          struct A(101) {
            foo: Foo;
          }
        `,
      }),
    ).toMatch([
      {
        kind: "record-kind-change",
        recordName: {
          before: {
            text: "Bar",
          },
          after: {
            text: "BarBar",
          },
        },
        recordExpression: {
          before: {
            kind: "property",
            structExpression: {
              kind: "property",
              structExpression: {
                kind: "record",
                recordName: {
                  text: "A",
                },
              },
              fieldName: {
                text: "foo",
              },
            },
            fieldName: {
              text: "bar",
            },
          },
          after: {
            kind: "property",
            structExpression: {
              kind: "property",
              structExpression: {
                kind: "record",
                recordName: {
                  text: "A",
                },
              },
              fieldName: {
                text: "foo",
              },
            },
            fieldName: {
              text: "barbar",
            },
          },
        },
        recordType: {
          before: "struct",
          after: "enum",
        },
      },
    ]);
  });

  it("enum variant kind change", () => {
    expect(
      doCheckBackwardCompatibility({
        before: `
          enum E(100) {
            a: string;
          }
        `,
        after: `
          enum EE(100) {
            A;
          }
        `,
      }),
    ).toMatch([
      {
        kind: "enum-variant-kind-change",
        enumEpression: {
          before: {
            kind: "record",
            recordName: {
              text: "E",
            },
          },
          after: {
            kind: "record",
            recordName: {
              text: "EE",
            },
          },
        },
        variantName: {
          before: {
            text: "a",
          },
          after: {
            text: "A",
          },
        },
      },
    ]);
  });

  it("primitive type compatibility", () => {
    // Compatible primitive type changes
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct A(101) {
            bool_field: bool;
            int32_field: int32;
            int64_field: int64;
            uint64_field: uint64;
            float32_field: float32;
            float64_field: float64;
          }
        `,
        after: `
          struct A(101) {
            bool_field: int64;
            int32_field: float64;
            int64_field: float32;
            uint64_field: float64;
            float32_field: float64;
            float64_field: float32;
          }
        `,
      }),
    ).toMatch([]);

    // Incompatible primitive type changes
    expect(
      doCheckBackwardCompatibility({
        before: `
          struct B(102) {
            str: string;
            num: int32;
          }
        `,
        after: `
          struct B(102) {
            str: bytes;
            num: string;
          }
        `,
      }),
    ).toMatch([
      {
        kind: "illegal-type-change",
        expression: {
          before: {
            kind: "property",
            structExpression: {
              kind: "record",
              recordName: {
                text: "B",
              },
            },
            fieldName: {
              text: "str",
            },
          },
          after: {
            kind: "property",
            structExpression: {
              kind: "record",
              recordName: {
                text: "B",
              },
            },
            fieldName: {
              text: "str",
            },
          },
        },
      },
      {
        kind: "illegal-type-change",
        expression: {
          before: {
            kind: "property",
            structExpression: {
              kind: "record",
              recordName: {
                text: "B",
              },
            },
            fieldName: {
              text: "num",
            },
          },
          after: {
            kind: "property",
            structExpression: {
              kind: "record",
              recordName: {
                text: "B",
              },
            },
            fieldName: {
              text: "num",
            },
          },
        },
      },
    ]);
  });
});

function doCheckBackwardCompatibility(
  sourceCode: BeforeAfter<string>,
): readonly BreakingChangeError[] {
  const moduleSet: BeforeAfter<ModuleSet> = {
    before: parseModuleSet(sourceCode.before),
    after: parseModuleSet(sourceCode.after),
  };
  return checkBackwardCompatibility(moduleSet);
}

function parseModuleSet(sourceCode: string): ModuleSet {
  const modulePath = "path/to/module";
  const modulePathToSourceCode = new Map<string, string>();
  modulePathToSourceCode.set(modulePath, sourceCode);
  const moduleSet = new ModuleSet(
    makeMapBasedModuleParser(modulePathToSourceCode),
  );
  const { errors } = moduleSet.parseAndResolve(modulePath);
  if (errors.length > 0) {
    const firstError = errors[0]!;
    const message = firstError.message ?? `expected: ${firstError.expected}`;
    throw new Error("Error while parsing module set: " + message);
  }
  return moduleSet;
}
