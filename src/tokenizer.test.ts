import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { tokenizeModule } from "./tokenizer.js";

describe("tokenizer", () => {
  it("tokenizes module with simple struct", () => {
    const code = [
      "import foo from './path/😊/foo';",
      'import * as bar from "path/to/bar";',
      "",
      "// Single-line comment",
      "struct Point2d { /* Multi-line",
      "  comment */",
      "  x: float32 = 1;",
      "  y: float32 = 2;",
      "  foos: [foo.Foo]? = 4;",
      "  bars: [Bar|key] = 8;",
      "  removed 3, 5..7;",
      "}",
      "",
      "const MINUS_ONE: int32 = -1;",
      "const MINUS_ONE_AND_A_HALF: float32 = -1.5;",
      "/// Doc comment for STRUCT",
      "const STRUCT: Point2d = {| |};",
    ].join("\n");

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [],
      result: {
        tokens: [
          {
            text: "import",
            position: 0,
            line: {
              lineNumber: 0,
              line: "import foo from './path/😊/foo';",
              position: 0,
              modulePath: "path/to/module",
            },
            colNumber: 0,
          },
          {
            text: "foo",
            position: 7,
            colNumber: 7,
          },
          {
            text: "from",
            position: 11,
            colNumber: 11,
          },
          {
            text: "'./path/😊/foo'",
            position: 16,
            colNumber: 16,
          },
          {
            text: ";",
            position: 31,
            colNumber: 31,
          },
          {
            text: "import",
            position: 33,
            colNumber: 0,
          },
          {
            text: "*",
            position: 40,
            line: {
              lineNumber: 1,
              line: 'import * as bar from "path/to/bar";',
              position: 33,
              modulePath: "path/to/module",
            },
            colNumber: 7,
          },
          {
            text: "as",
            position: 42,
            colNumber: 9,
          },
          {
            text: "bar",
            position: 45,
            colNumber: 12,
          },
          {
            text: "from",
            position: 49,
            colNumber: 16,
          },
          {
            text: '"path/to/bar"',
            position: 54,
            colNumber: 21,
          },
          {
            text: ";",
          },
          {
            text: "struct",
          },
          {
            text: "Point2d",
          },
          {
            text: "{",
          },
          {
            text: "x",
          },
          {
            text: ":",
          },
          {
            text: "float32",
          },
          {
            text: "=",
          },
          {
            text: "1",
          },
          {
            text: ";",
          },
          {
            text: "y",
          },
          {
            text: ":",
          },
          {
            text: "float32",
          },
          {
            text: "=",
          },
          {
            text: "2",
          },
          {
            text: ";",
          },
          {
            text: "foos",
          },
          {
            text: ":",
          },
          {
            text: "[",
          },
          {
            text: "foo",
          },
          {
            text: ".",
          },
          {
            text: "Foo",
          },
          {
            text: "]",
          },
          {
            text: "?",
          },
          {
            text: "=",
          },
          {
            text: "4",
          },
          {
            text: ";",
          },
          {
            text: "bars",
          },
          {
            text: ":",
          },
          {
            text: "[",
          },
          {
            text: "Bar",
          },
          {
            text: "|",
          },
          {
            text: "key",
          },
          {
            text: "]",
          },
          {
            text: "=",
          },
          {
            text: "8",
          },
          {
            text: ";",
          },
          {
            text: "removed",
          },
          {
            text: "3",
          },
          {
            text: ",",
          },
          {
            text: "5",
          },
          {
            text: "..",
          },
          {
            text: "7",
          },
          {
            text: ";",
          },
          {
            text: "}",
          },
          {
            text: "const",
          },
          {
            text: "MINUS_ONE",
          },
          {
            text: ":",
          },
          {
            text: "int32",
          },
          {
            text: "=",
          },
          {
            text: "-1",
          },
          {
            text: ";",
          },
          {
            text: "const",
          },
          {
            text: "MINUS_ONE_AND_A_HALF",
          },
          {
            text: ":",
          },
          {
            text: "float32",
          },
          {
            text: "=",
          },
          {
            text: "-1.5",
          },
          {
            text: ";",
          },
          {
            text: "/// Doc comment for STRUCT",
          },
          {
            text: "const",
          },
          {
            text: "STRUCT",
          },
          {
            text: ":",
          },
          {
            text: "Point2d",
          },
          {
            text: "=",
          },
          {
            text: "{|",
          },
          {
            text: "|}",
          },
          {
            text: ";",
          },
          {
            text: "",
          },
        ],
      },
    });

    expect(
      actual.result.tokensWithComments.filter(
        (t) =>
          t.text.startsWith("/*") ||
          (t.text.startsWith("//") && !t.text.startsWith("///")),
      ),
    ).toMatch([
      {
        text: "// Single-line comment",
        originalText: "// Single-line comment",
      },
      {
        text: ["/* Multi-line", "  comment */"].join("\n"),
      },
    ]);
  });

  it("tokenizes module with single-quoted string", () => {
    const code = ['const FOO: string = \'"\\\\\\""\''].join("\n");

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [],
    });
  });

  it("tokenizes module with unterminated multi-line comment", () => {
    const code = "  /*";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "/*",
            position: 2,
          },
          message: "Unterminated multi-line comment",
        },
      ],
    });
  });

  it("tokenizes module with unterminated string literal", () => {
    const code = "import 'foo";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "'foo",
            position: 7,
          },
          message: "Unterminated string literal",
        },
      ],
    });
  });

  it("tokenizes module with invalid char sequence", () => {
    const code = "  ##";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "##",
            position: 2,
          },
          message: "Invalid sequence of characters",
        },
      ],
    });
  });

  it("tokenizes module with invalid escape sequence in string literal", () => {
    const code = "import 'foo\\u0ffg';";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "'foo\\u0ffg'",
            position: 7,
          },
          message: "String literal contains invalid escape sequence",
        },
      ],
    });
  });

  it("tokenizes module with lone surrogate in string literal", () => {
    const code = "'\uD800a'";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "'\ud800a'",
            position: 0,
          },
          message: "String literal contains lone surrogates",
        },
      ],
    });
  });

  it("tokenizes module with invalid word", () => {
    const code = "00 1_ 2a";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: { text: "00" },
          message: "Invalid number",
        },
        {
          token: { text: "1_" },
          message: "Invalid number",
        },
        {
          token: { text: "2a" },
          message: "Invalid number",
        },
      ],
    });
  });

  it("tokenizes module with invalid identifiers", () => {
    const code = "_a a_ a__a a_0";

    const actual = tokenizeModule(code, "path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          message: "Identifier cannot start with _",
        },
        {
          message: "Identifier cannot end with _",
        },
        {
          message: "Identifier cannot contain __ sequence",
        },
        {
          message: "Digit cannot follow _",
        },
      ],
    });
  });
});
