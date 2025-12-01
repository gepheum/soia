import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { parseModule } from "./parser.js";
import { tokenizeModule } from "./tokenizer.js";
import { Module, Result } from "./types.js";

function parse(content: string): Result<Module> {
  const pathToModule = "path/to/module";
  const tokenizerResult = tokenizeModule(content, pathToModule);
  return parseModule(tokenizerResult.result, pathToModule, content);
}

describe("module parser", () => {
  it("simple struct", () => {
    const actualModule = parse(`
      struct Point {
        x: float32;
        y: float32;
        removed;
      }`);
    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Point: {
            kind: "record",
            name: {
              text: "Point",
            },
            recordType: "struct",
            nameToDeclaration: {
              x: {
                kind: "field",
                name: {
                  text: "x",
                },
                number: 0,
                unresolvedType: {
                  kind: "primitive",
                  primitive: "float32",
                },
                isRecursive: false,
              },
              y: {
                kind: "field",
                name: {
                  text: "y",
                },
                number: 1,
                unresolvedType: {
                  kind: "primitive",
                  primitive: "float32",
                },
                isRecursive: false,
              },
            },
            fields: [
              {
                name: {
                  text: "x",
                },
              },
              {
                name: {
                  text: "y",
                },
              },
            ],
            nestedRecords: [],
            numbering: "implicit",
            removedNumbers: [2],
            numSlots: 2,
            numSlotsInclRemovedNumbers: 3,
          },
        },
      },
      errors: [],
    });
  });

  it("struct with explicit numbering", () => {
    const actualModule = parse(`
      struct Point {
        x: float32 = 1;
        y: float32 = 0;
      }`);

    expect(actualModule).toMatch({
      result: {
        nameToDeclaration: {
          Point: {
            nameToDeclaration: {
              x: {
                number: 1,
              },
              y: {
                number: 0,
              },
            },
            numbering: "explicit",
          },
        },
      },
      errors: [],
    });
  });

  it("simple enum", () => {
    const actualModule = parse(`
      enum Enum {
        CONSTANT;
        removed;
        value_field: bool;
      }`);

    expect(actualModule).toMatch({
      result: {
        nameToDeclaration: {
          Enum: {
            kind: "record",
            name: {
              text: "Enum",
            },
            recordType: "enum",
            nameToDeclaration: {
              CONSTANT: {
                kind: "field",
                name: {
                  text: "CONSTANT",
                },
                number: 1,
              },
              value_field: {
                kind: "field",
                name: {
                  text: "value_field",
                },
                number: 3,
                unresolvedType: {
                  kind: "primitive",
                },
                isRecursive: false,
              },
            },
            fields: [
              {
                kind: "field",
                name: {
                  text: "CONSTANT",
                },
              },
              {
                kind: "field",
                name: {
                  text: "value_field",
                },
              },
            ],
            numSlots: 0,
            numSlotsInclRemovedNumbers: 0,
          },
        },
      },
      errors: [],
    });
  });

  it("record with stable id", () => {
    const actualModule = parse(`
    struct Foo(4294967295) {}
    enum Zoo(0) {}`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Foo: {
            kind: "record",
            recordNumber: 4294967295,
          },
          Zoo: {
            kind: "record",
            recordNumber: 0,
          },
        },
      },
      errors: [],
    });
  });

  it("nested struct", () => {
    const actualModule = parse(`
    struct Foo {
      struct Bar {}
    }`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Foo: {
            kind: "record",
            name: {
              text: "Foo",
            },
            recordType: "struct",
            nameToDeclaration: {
              Bar: {
                kind: "record",
                name: {
                  text: "Bar",
                },
                recordType: "struct",
              },
            },
            nestedRecords: [
              {
                kind: "record",
                name: {
                  text: "Bar",
                },
                recordType: "struct",
              },
            ],
          },
        },
      },
      errors: [],
    });
  });

  it("struct with all possible types", () => {
    const actualModule = parse(`
      struct AllTypes {
        bool: bool;
        int32: int32;
        int64: int64;
        uint64: uint64;
        float32: float32;
        float64: float64;
        timestamp: timestamp;
        string: string;
        bytes: bytes;
        strings: [string?];
        foos: [Foo|x.y];
      }`);

    expect(actualModule).toMatch({
      result: {
        nameToDeclaration: {
          AllTypes: {
            nameToDeclaration: {
              bool: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "bool",
                },
              },
              int32: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "int32",
                },
              },
              int64: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "int64",
                },
              },
              uint64: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "uint64",
                },
              },
              float32: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "float32",
                },
              },
              float64: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "float64",
                },
              },
              timestamp: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "timestamp",
                },
              },
              string: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "string",
                },
              },
              bytes: {
                unresolvedType: {
                  kind: "primitive",
                  primitive: "bytes",
                },
              },
              strings: {
                unresolvedType: {
                  kind: "array",
                  item: {
                    kind: "optional",
                    other: {
                      kind: "primitive",
                      primitive: "string",
                    },
                  },
                },
              },
              foos: {
                unresolvedType: {
                  kind: "array",
                  item: {
                    kind: "record",
                    nameParts: [
                      {
                        text: "Foo",
                        position: 284,
                        line: {
                          lineNumber: 12,
                          line: "        foos: [Foo|x.y];",
                          position: 269,
                          modulePath: "path/to/module",
                        },
                        colNumber: 15,
                      },
                    ],
                    absolute: false,
                  },
                  key: {
                    pipeToken: {
                      text: "|",
                      position: 287,
                      line: {
                        lineNumber: 12,
                        line: "        foos: [Foo|x.y];",
                        position: 269,
                        modulePath: "path/to/module",
                      },
                      colNumber: 18,
                    },
                    path: [
                      {
                        name: {
                          text: "x",
                          position: 288,
                          line: {
                            lineNumber: 12,
                            line: "        foos: [Foo|x.y];",
                            position: 269,
                            modulePath: "path/to/module",
                          },
                          colNumber: 19,
                        },
                      },
                      {
                        name: {
                          text: "y",
                          position: 290,
                          line: {
                            lineNumber: 12,
                            line: "        foos: [Foo|x.y];",
                            position: 269,
                            modulePath: "path/to/module",
                          },
                          colNumber: 21,
                        },
                        declaration: undefined,
                      },
                    ],
                    keyType: {
                      kind: "primitive",
                      primitive: "bool",
                    },
                  },
                },
              },
            },
          },
        },
      },
      errors: [],
    });
  });

  it("module with imports", () => {
    const actualModule = parse(`
    import foo from './path/😊/foo';
    import * as bar from "path/to/bar";`);

    expect(actualModule).toMatch({
      result: {
        nameToDeclaration: {
          foo: {
            kind: "import",
            importedNames: [
              {
                text: "foo",
              },
            ],
            modulePath: {
              text: "'./path/😊/foo'",
            },
          },
          bar: {
            kind: "import-alias",
            name: {
              text: "bar",
            },
            modulePath: {
              text: '"path/to/bar"',
            },
          },
        },
      },
      errors: [],
    });
  });

  it("module with duplicate identifier", () => {
    const actualModule = parse(`
      struct A {}
      struct A {}`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "A",
            line: {
              lineNumber: 2,
            },
          },
          message: 'Duplicate identifier "A"',
        },
      ],
    });
  });

  it("enum with sparse numbers", () => {
    const actualModule = parse(`
      enum Enum {
        CONSTANT = 2;
        removed 10, 11;
        removed 12..14;
        removed 30..32, 50, 60..62;
        value_field: bool = 4;
      }`);

    expect(actualModule).toMatch({
      result: {
        nameToDeclaration: {
          Enum: {
            kind: "record",
            name: {
              text: "Enum",
            },
            recordType: "enum",
            nameToDeclaration: {
              CONSTANT: {
                kind: "field",
                name: {
                  text: "CONSTANT",
                },
                number: 2,
              },
              value_field: {
                kind: "field",
                name: {
                  text: "value_field",
                },
                number: 4,
              },
            },
            removedNumbers: [10, 11, 12, 13, 14, 30, 31, 32, 50, 60, 61, 62],
          },
        },
      },
      errors: [],
    });
  });

  it("struct with duplicate identifier", () => {
    const actualModule = parse(`
      struct A {
        a: bool;
        a: bool;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "a",
            line: {
              lineNumber: 3,
            },
          },
          message: 'Duplicate identifier "a"',
        },
      ],
    });
  });

  it("struct with invalid casing", () => {
    const actualModule = parse(`
      struct a {
        A: bool;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "a",
          },
          expected: "UpperCamel",
        },
        {
          token: {
            text: "A",
          },
          expected: "lower_underscore",
        },
      ],
    });
  });

  it("struct with mixed numbering", () => {
    const actualModule = parse(`
      struct A {
        a: bool;
        b: bool = 1;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "b",
          },
          message: "Cannot mix implicit and explicit numbering",
        },
      ],
    });
  });

  it("struct with removed fields and mixed numbering", () => {
    const actualModule = parse(`
      struct A {
        removed;
        b: bool = 1;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "b",
          },
          message: "Cannot mix implicit and explicit numbering",
        },
      ],
    });
  });

  it("struct with duplicate number", () => {
    const actualModule = parse(`
      struct A {
        a: bool = 0;
        b: bool = 0;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "b",
          },
          message: "Duplicate field number 0",
        },
      ],
    });
  });

  it("struct with duplicate number in removed declaration", () => {
    const actualModule = parse(`
      struct A {
        removed 0, 1, 2, 5, 2, 3, 4;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "removed",
          },
          message: "Duplicate field number 2",
        },
      ],
    });
  });

  it("struct with duplicate number in removed range declaration", () => {
    const actualModule = parse(`
      struct A {
        removed 0, 1, 2, 5, 2..4;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "removed",
          },
          message: "Duplicate field number 2",
        },
      ],
    });
  });

  it("struct with invalid range in removed declaration", () => {
    const actualModule = parse(`
      struct A {
        removed 0..0;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "removed",
          },
          message: "Upper bound must be greater than lower bound",
        },
      ],
    });
  });

  it("struct with removed fields and duplicate number", () => {
    const actualModule = parse(`
      struct A {
        a: bool = 0;
        removed 0;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "removed",
          },
          message: "Duplicate field number 0",
        },
      ],
    });
  });

  it("struct with missing number", () => {
    const actualModule = parse(`
      struct A {
        a: bool = 2;
        b: bool = 0;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "A",
          },
          message: "Missing field number 1",
        },
      ],
    });
  });

  it("struct with stable id out of bounds", () => {
    const actualModule = parse(`
      struct A(4294967296) {}`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "4294967296",
          },
          message: "Value out of uint32 range",
        },
      ],
    });
  });

  it("enum with invalid casing", () => {
    const actualModule = parse(`
      enum a {
        foo = 1;
        BAR: string = 100;
      }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "a",
          },
          expected: "UpperCamel",
        },
        {
          token: {
            text: "foo",
          },
          expected: "UPPER_UNDERSCORE",
        },
        {
          token: {
            text: "BAR",
          },
          expected: "lower_underscore",
        },
      ],
    });
  });

  it("struct with removed fields", () => {
    const actualModule = parse(`
      struct Point {
        removed;
        a: bool;
        removed;
      }`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Point: {
            removedNumbers: [0, 2],
          },
        },
        pathToImportedNames: {},
        records: [{}],
      },
      errors: [],
    });
  });

  it("struct with removed fields and explicit numbering", () => {
    const actualModule = parse(`
      struct Point {
        removed 3, 4, 5, 6;
        removed 0, 1, 2;
      }`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Point: {
            removedNumbers: [0, 1, 2, 3, 4, 5, 6],
          },
        },
        pathToImportedNames: {},
        records: [{}],
      },
      errors: [],
    });
  });

  it("empty struct", () => {
    const actualModule = parse(`
    struct Point {}`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Point: {
            kind: "record",
            name: {
              text: "Point",
            },
            recordType: "struct",
            numbering: "",
          },
        },
      },
      errors: [],
    });
  });

  it("empty enum", () => {
    const actualModule = parse(`
    enum Enum {
      removed;
    }`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Enum: {
            kind: "record",
            recordType: "enum",
            name: {
              text: "Enum",
            },
          },
        },
      },
      errors: [],
    });
  });

  it("enum with field named UNKNOWN", () => {
    const actualModule = parse(`
    enum Enum {
      UNKNOWN = 1;
    }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "UNKNOWN",
          },
          message: "Cannot name field of enum: UNKNOWN",
        },
      ],
    });
  });

  it("enum with field number set to zero", () => {
    const actualModule = parse(`
    enum Enum {
      A = 0;
    }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "A",
          },
          message: "Number 0 is reserved for UNKNOWN field",
        },
      ],
    });
  });

  it("enum with zero field number removed", () => {
    const actualModule = parse(`
    enum Enum {
      removed 0;
    }`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "removed",
          },
          message: "Number 0 is reserved for UNKNOWN field",
        },
      ],
    });
  });

  it("method", () => {
    const actualModule = parse(`
      method Search(req):resp;`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Search: {
            kind: "method",
            name: {
              text: "Search",
            },
            unresolvedRequestType: {
              kind: "record",
              nameParts: [
                {
                  text: "req",
                },
              ],
            },
            unresolvedResponseType: {
              kind: "record",
              nameParts: [
                {
                  text: "resp",
                },
              ],
            },
            number: 2446226092,
            explicitNumber: false,
          },
        },
        methods: [
          {
            kind: "method",
            name: {
              text: "Search",
            },
            number: 2446226092,
            explicitNumber: false,
          },
        ],
      },
      errors: [],
    });
  });

  it("method with explicit number", () => {
    const actualModule = parse(`
      method Search(req):resp = 200;`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          Search: {
            kind: "method",
            name: {
              text: "Search",
            },
            unresolvedRequestType: {
              kind: "record",
              nameParts: [
                {
                  text: "req",
                },
              ],
            },
            unresolvedResponseType: {
              kind: "record",
              nameParts: [
                {
                  text: "resp",
                },
              ],
            },
            number: 200,
          },
        },
        methods: [
          {
            kind: "method",
            name: {
              text: "Search",
            },
            number: 200,
            explicitNumber: true,
          },
        ],
      },
      errors: [],
    });
  });

  it("string constant", () => {
    const actualModule = parse(`
      const FOO: string = "Foo";`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          FOO: {
            kind: "constant",
            name: {
              text: "FOO",
            },
            unresolvedType: {
              kind: "primitive",
              primitive: "string",
            },
            value: {
              kind: "literal",
              token: {
                text: '"Foo"',
              },
            },
          },
        },
        constants: [
          {
            kind: "constant",
            name: {
              text: "FOO",
            },
          },
        ],
      },
      errors: [],
    });
  });

  it("constant with invalid casing", () => {
    const actualModule = parse(`
      const foo: string = "Foo";`);

    expect(actualModule).toMatch({
      errors: [
        {
          token: {
            text: "foo",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ],
    });
  });

  it("complex constant", () => {
    const actualModule = parse(`
      const FOO: [Foo] = {
        foo: true,
        x: [
          {foo: true},
          {bar: false,},
          "hey",
          3.14,
          -3.14,
        ],
        empty_array: [],
        empty_object: {},
      };`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          FOO: {
            kind: "constant",
            name: {
              text: "FOO",
            },
            unresolvedType: {
              kind: "array",
              item: {
                kind: "record",
              },
            },
            value: {
              kind: "object",
              token: {
                text: "{",
              },
              entries: {
                foo: {
                  value: {
                    kind: "literal",
                    token: {
                      text: "true",
                    },
                  },
                },
                x: {
                  value: {
                    kind: "array",
                    items: [
                      {
                        kind: "object",
                        entries: {
                          foo: {
                            value: {
                              kind: "literal",
                              token: {
                                text: "true",
                              },
                            },
                          },
                        },
                      },
                      {
                        kind: "object",
                        entries: {
                          bar: {
                            value: {
                              kind: "literal",
                              token: {
                                text: "false",
                              },
                            },
                          },
                        },
                      },
                      {
                        kind: "literal",
                        token: {
                          text: '"hey"',
                        },
                      },
                      {
                        kind: "literal",
                        token: {
                          text: "3.14",
                        },
                      },
                      {
                        kind: "literal",
                        token: {
                          text: "-3.14",
                        },
                      },
                    ],
                  },
                },
                empty_array: {
                  value: {
                    kind: "array",
                    items: [],
                  },
                },
                empty_object: {
                  value: {
                    kind: "object",
                  },
                },
              },
              partial: false,
            },
          },
        },
        constants: [
          {
            kind: "constant",
            name: {
              text: "FOO",
            },
          },
        ],
      },
      errors: [],
    });
  });

  it("partial constant", () => {
    const actualModule = parse(`
      const FOO: [Foo] = {|
        foo: true,
      |};`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          FOO: {
            kind: "constant",
            name: {
              text: "FOO",
            },
            unresolvedType: {
              kind: "array",
              item: {
                kind: "record",
              },
            },
            value: {
              kind: "object",
              token: {
                text: "{|",
              },
              entries: {
                foo: {
                  value: {
                    kind: "literal",
                    token: {
                      text: "true",
                    },
                  },
                },
              },
              partial: true,
            },
          },
        },
        constants: [
          {
            kind: "constant",
            name: {
              text: "FOO",
            },
          },
        ],
      },
      errors: [],
    });
  });

  it("partial empty constant", () => {
    const actualModule = parse(`
      const FOO: [Foo] = {||};`);

    expect(actualModule).toMatch({
      result: {
        kind: "module",
        path: "path/to/module",
        nameToDeclaration: {
          FOO: {
            kind: "constant",
            name: {
              text: "FOO",
            },
            unresolvedType: {
              kind: "array",
              item: {
                kind: "record",
              },
            },
            value: {
              kind: "object",
              token: {
                text: "{|",
              },
              entries: {},
              partial: true,
            },
          },
        },
        constants: [
          {
            kind: "constant",
            name: {
              text: "FOO",
            },
          },
        ],
      },
      errors: [],
    });
  });

  describe("handle and recover from bad statements", () => {
    it("#0", () => {
      const actualModule = parse(`
        const FOO: string = "";
        a b c;
        struct Foo {}`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            FOO: {},
            Foo: {},
          },
        },
        errors: [
          {
            token: {
              text: "a",
            },
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
        ],
      });
    });

    it("#1", () => {
      const actualModule = parse(`
        const FOO: string = "";
        a;
        struct Foo {}`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            FOO: {},
            Foo: {},
          },
        },
        errors: [
          {
            token: {
              text: "a",
            },
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
        ],
      });
    });

    it("#2", () => {
      const actualModule = parse(`
          const FOO: string = "";
          ;;;
          struct Foo {}`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            FOO: {},
            Foo: {},
          },
        },
        errors: [
          {
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
          {
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
          {
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
        ],
      });
    });

    it("#3", () => {
      const actualModule = parse(`
          const FOO: string = "";;`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            FOO: {},
          },
        },
        errors: [
          {
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
        ],
      });
    });

    it("#4", () => {
      const actualModule = parse(`
          struct Foo { struct Bar {}`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            Foo: {
              nameToDeclaration: {
                Bar: {},
              },
            },
          },
        },
        errors: [
          {
            expected: '"}"',
          },
        ],
      });
    });

    it("#5", () => {
      const actualModule = parse(`
          struct Foo { a { a; {} } b: string; }`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            Foo: {
              nameToDeclaration: {
                b: {},
              },
            },
          },
        },
        errors: [
          {
            expected: '":"',
          },
        ],
      });
    });

    it("#6", () => {
      const actualModule = parse(`
          struct Foo {  }} struct Bar { }`);

      expect(actualModule).toMatch({
        result: {
          nameToDeclaration: {
            Foo: {},
            Bar: {},
          },
        },
        errors: [
          {
            expected: 'one of: "struct", "enum", "import", "method", "const"',
          },
        ],
      });
    });
  });

  describe("grammar errors", () => {
    it("expected: record name", () => {
      const actualModule = parse(`struct {}`);

      expect(actualModule).toMatch({
        errors: [
          {
            token: {
              text: "{",
              line: {
                lineNumber: 0,
              },
            },
            expected: "identifier",
          },
        ],
      });
    });

    it("expected: positive integer", () => {
      const actualModule = parse(`struct A { n: int32 = bool; }`);

      expect(actualModule).toMatch({
        errors: [
          {
            token: {
              text: "bool",
              line: {
                lineNumber: 0,
              },
            },
            expected: "positive integer",
          },
        ],
      });
    });
  });
});
