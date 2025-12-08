import { expect } from "buckwheat";
import { describe, it } from "mocha";
import type { FileReader } from "./io.js";
import { ModuleSet } from "./module_set.js";

class FakeFileReader implements FileReader {
  readTextFile(modulePath: string): string | undefined {
    return this.pathToCode.get(modulePath);
  }

  pathToCode = new Map<string, string>();
}

describe("module set", () => {
  it("works", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as other_module from "./other/module";

        struct Outer {
          struct Foo {}
        }

        struct Bar(100) {
          foo: Outer.Foo;
          foo2: .Outer.Foo;

          struct Inner(101) {}
          inner: Inner;
          zoo: other_module.Outer.Zoo;

          loo_loo: struct {};
        }

        method GetBar(Outer.Foo): Bar;
        method GetBar2(Outer.Foo): Bar = 100;
        method Search(enum {}): struct {};
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other/module",
      `
        struct Outer {
          struct Zoo {}
        }
      `,
    );
    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      result: {
        nameToDeclaration: {
          other_module: {
            kind: "import-alias",
            name: {
              text: "other_module",
            },
            modulePath: {
              text: '"./other/module"',
            },
          },
          Outer: {
            kind: "record",
            name: {
              text: "Outer",
            },
            recordType: "struct",
            nameToDeclaration: {
              Foo: {
                kind: "record",
              },
            },
            declarations: [
              {
                name: {
                  text: "Foo",
                },
              },
            ],
            nestedRecords: [
              {
                recordType: "struct",
                name: {
                  text: "Foo",
                },
                nestedRecords: [],
              },
            ],
          },
          Bar: {
            kind: "record",
            recordType: "struct",
            name: {
              text: "Bar",
            },
            fields: [
              {
                kind: "field",
                name: {
                  text: "foo",
                },
                number: 0,
                type: {
                  kind: "record",
                  key: "path/to/module:98",
                  recordType: "struct",
                  refToken: {
                    text: "Foo",
                  },
                },
              },
              { name: { text: "foo2" } },
              { name: { text: "inner" } },
              { name: { text: "zoo" } },
              { name: { text: "loo_loo" } },
            ],
            numSlots: 5,
            numSlotsInclRemovedNumbers: 5,
          },
          GetBar: {
            kind: "method",
            name: { text: "GetBar" },
            requestType: {
              kind: "record",
              key: "path/to/module:98",
              recordType: "struct",
              refToken: {
                text: "Foo",
              },
            },
            responseType: {
              kind: "record",
              key: "path/to/module:131",
              recordType: "struct",
              refToken: {
                text: "Bar",
              },
            },
            number: 2103196129,
            hasExplicitNumber: false,
          },
          GetBar2: {
            number: 100,
          },
          Search: {},
          SearchRequest: {
            name: {
              text: "SearchRequest",
              originalText: "Search",
            },
          },
          SearchResponse: {},
        },
        declarations: [
          { name: { text: "other_module" } },
          { name: { text: "Outer" } },
          { name: { text: "Bar" } },
          { name: { text: "GetBar" } },
          { name: { text: "GetBar2" } },
          { name: { text: "Search" } },
          { name: { text: "SearchRequest" } },
          { name: { text: "SearchResponse" } },
        ],
        records: [
          { record: { name: { text: "Foo" } } },
          { record: { name: { text: "Outer" } } },
          { record: { name: { text: "Inner" }, recordNumber: 101 } },
          { record: { name: { text: "LooLoo" } } },
          { record: { name: { text: "Bar" } } },
          { record: { name: { text: "SearchRequest" } } },
          { record: { name: { text: "SearchResponse" } } },
        ],
      },
      errors: [],
    });
  });

  it("recursivity works", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        struct A { s: string; }
        struct B { b: B; }
        struct C { c: C?; }
        struct D { d: [D]; }
        struct E { f: F; }
        struct F { e: E; }
        struct G { b: B; }
        struct H { i: I; }
        enum I { h: H; }
      `,
    );
    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      result: {
        nameToDeclaration: {
          A: {
            fields: [{ isRecursive: false }],
          },
          B: {
            fields: [{ isRecursive: "hard" }],
          },
          C: {
            fields: [{ isRecursive: "soft" }],
          },
          D: {
            fields: [{ isRecursive: "soft" }],
          },
          E: {
            fields: [{ isRecursive: "hard" }],
          },
          F: {
            fields: [{ isRecursive: "hard" }],
          },
          G: {
            fields: [{ isRecursive: false }],
          },
          H: {
            fields: [{ isRecursive: "soft" }],
          },
          I: {
            fields: [{ isRecursive: "soft" }],
          },
        },
      },
      errors: [],
    });
  });

  it("circular dependency between modules", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as other_module from "./other/module";
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other/module",
      `
        import * as module from "path/to/module";
      `,
    );
    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '"./other/module"',
          },
          message: "Circular dependency between modules",
        },
      ],
    });
    expect(moduleSet.parseAndResolve("path/to/other/module")).toMatch({
      errors: [
        {
          token: {
            text: '"path/to/module"',
          },
          message: "Circular dependency between modules",
        },
      ],
    });
  });

  it("module not found", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as other_module from "./other/module";
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '"./other/module"',
          },
          message: "Module not found",
        },
      ],
    });
  });

  it("module already imported with an alias", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as other_module from "./other/module";
        import Foo from "./other/module";
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other/module",
      `
        struct Foo {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '"./other/module"',
          },
          message: "Module already imported with an alias",
        },
      ],
    });
  });

  it("module already imported with a different alias", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as foo from "./other/module";
        import * as bar from "./other/module";
      `,
    );
    fakeFileReader.pathToCode.set("path/to/root/path/to/other/module", "");

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '"./other/module"',
          },
          message: "Module already imported with a different alias",
        },
      ],
    });
  });

  it("multiple import declarations from same module", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Foo from "./other/module";
        import Bar from "./other/module";

        struct Zoo {
          foo: Foo;
          bar: Bar;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other/module",
      `
        struct Foo {}
        struct Bar {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [],
    });
  });

  it("multiple imports from same module", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Foo, Bar from "./other/module";

        struct Zoo {
          foo: Foo;
          bar: Bar;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other/module",
      `
        struct Foo {}
        struct Bar {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [],
    });
  });

  it("module path cannot contain backslash", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import * as foo from ".\\\\module";
      `,
    );
    fakeFileReader.pathToCode.set("path/to/root/path/to/other/module", "");

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '".\\\\module"',
          },
          message: "Replace backslash with slash",
        },
      ],
    });
  });

  it("field numbering constraint satisfied", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        struct Foo {}
        struct Bar { bar: int32 = 0; }
        struct Zoo { foo: Foo = 0; bar: Bar = 1; }
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({ errors: [] });
  });

  it("field numbering constraint not satisfied", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        struct Foo { foo: int32; }
        struct Bar { foo: Foo = 0; }
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "Foo",
          },
          message:
            "Field type references a struct with implicit numbering, but field belongs to a struct with explicit numbering",
        },
      ],
    });
  });

  describe("keyed arrays", () => {
    it("works", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Outer {
            struct User {
              key: string;
              key_enum: Enum;
            }

            enum Enum {
              MONDAY;
            }

            struct UserHistory {
              user: User;
            }
          }

          struct Foo {
            users: [Outer.User|key];
            users_by_enum: [Outer.User|key_enum.kind];
            user_histories: [Outer.UserHistory|user.key]?;
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        result: {
          nameToDeclaration: {
            Foo: {
              fields: [
                {
                  name: { text: "users" },
                  type: {
                    kind: "array",
                    item: {
                      kind: "record",
                      key: "path/to/module:45",
                    },
                    key: {
                      pipeToken: { text: "|" },
                      path: [{ name: { text: "key" } }],
                      keyType: {
                        kind: "primitive",
                        primitive: "string",
                      },
                    },
                  },
                },
                {
                  name: { text: "users_by_enum" },
                  type: {
                    kind: "array",
                    item: {
                      kind: "record",
                      key: "path/to/module:45",
                    },
                    key: {
                      pipeToken: { text: "|" },
                      path: [
                        {
                          name: { text: "key_enum" },
                          declaration: { name: { text: "key_enum" } },
                        },
                        { name: { text: "kind" }, declaration: undefined },
                      ],
                      keyType: {
                        kind: "record",
                        key: "path/to/module:141",
                      },
                    },
                  },
                },
                {
                  name: { text: "user_histories" },
                  type: {
                    kind: "optional",
                    other: {
                      kind: "array",
                      item: {
                        kind: "record",
                        key: "path/to/module:204",
                      },
                      key: {
                        pipeToken: { text: "|" },
                        path: [
                          { name: { text: "user" } },
                          { name: { text: "key" } },
                        ],
                        keyType: {
                          kind: "primitive",
                          primitive: "string",
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      });
    });

    it("field not found in struct", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct User {}
          struct Foo {
            users: [User|key];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "key",
            },
            message: "Field not found in struct User",
          },
        ],
      });
    });

    it("item must have struct type", () => {
      // This is actually verified at parsing time.

      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Foo {
            users: [string|key];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "|",
            },
            expected: "']'",
          },
        ],
      });
    });

    it("must have struct type", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct User {
            key: string;
          }
          struct Foo {
            users: [User|key.bar];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "key",
            },
            message: "Must have struct type",
          },
        ],
      });
    });

    it("if enum then expects kind", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          enum Enum { MONDAY; }
          struct Foo {
            users: [Enum|key];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "key",
            },
            expected: "'kind'",
          },
        ],
      });
    });

    it("all fields but the last must have struct type", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct User { key: string; }
          struct Foo {
            users: [User|key.bar];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "key",
            },
            message: "Must have struct type",
          },
        ],
      });
    });

    it("key must have primitive or enum type", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Bar {}
          struct User { key: Bar; }
          struct Foo {
            users: [User|key];
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "key",
            },
            message: "Does not have primitive type",
          },
        ],
      });
    });

    it("method and constant types are validated", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Foo {
          }

          method Pa([Foo|a]): string;
          method Pb(string): [Foo|b];
          const FOO: [Foo|c] = [];
          const PI: float32 = -3.14;
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "a",
            },
            message: "Field not found in struct Foo",
          },
          {
            token: {
              text: "b",
            },
            message: "Field not found in struct Foo",
          },
          {
            token: {
              text: "c",
            },
            message: "Field not found in struct Foo",
          },
        ],
      });
    });
  });

  describe("type resolver", () => {
    it("cannot find name", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Foo {
            bar: Bar;
          }
        `,
      );

      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "Bar",
            },
            message: "Cannot find name 'Bar'",
          },
        ],
      });
    });

    describe("cannot reimport imported name", () => {
      it("no alias / no alias", () => {
        const fakeFileReader = new FakeFileReader();
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/foo",
          `
          struct Foo {}
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/bar",
          `
          import Foo from "./foo";
          struct Bar { foo: Foo; }
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/module",
          `
          import Foo from "./bar";
          struct Zoo { foo: Foo; }
        `,
        );

        const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
        const actual = moduleSet.parseAndResolve("path/to/module");

        expect(actual).toMatch({
          errors: [
            {
              token: {
                text: "Foo",
              },
              message: "Cannot reimport imported name 'Foo'",
            },
          ],
        });
      });

      it("no alias / alias", () => {
        const fakeFileReader = new FakeFileReader();
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/foo",
          `
          struct Foo {}
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/bar",
          `
          import * as foo from "./foo";
          struct Bar { foo: foo.Foo; }
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/module",
          `
          import foo from "./bar";
          struct Zoo { foo: foo.Foo; }
        `,
        );

        const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
        const actual = moduleSet.parseAndResolve("path/to/module");

        expect(actual).toMatch({
          errors: [
            {
              token: {
                text: "foo",
              },
              message: "Cannot reimport imported name 'foo'",
            },
          ],
        });
      });

      it("alias / no alias", () => {
        const fakeFileReader = new FakeFileReader();
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/foo",
          `
          struct Foo {}
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/bar",
          `
          import Foo from "./foo";
          struct Bar { foo: Foo; }
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/module",
          `
          import * as bar from "./bar";
          struct Zoo { foo: bar.Foo; }
        `,
        );

        const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
        const actual = moduleSet.parseAndResolve("path/to/module");

        expect(actual).toMatch({
          errors: [
            {
              token: {
                text: "Foo",
              },
              message: "Cannot reimport imported name 'Foo'",
            },
          ],
        });
      });

      it("alias / alias", () => {
        const fakeFileReader = new FakeFileReader();
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/foo",
          `
          struct Foo {}
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/bar",
          `
          import * as foo from "./foo";
          struct Bar { foo: foo.Foo; }
        `,
        );
        fakeFileReader.pathToCode.set(
          "path/to/root/path/to/module",
          `
          import * as bar from "./bar";
          struct Zoo { foo: bar.foo.Foo; }
        `,
        );

        const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
        const actual = moduleSet.parseAndResolve("path/to/module");

        expect(actual).toMatch({
          errors: [
            {
              token: {
                text: "foo",
              },
              message: "Cannot reimport imported name 'foo'",
            },
          ],
        });
      });
    });
  });

  it("import module with absolute path", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Bar from "path/to_other_module";

        struct Foo {
          bar: Bar;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to_other_module",
      `
        struct Bar {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [],
    });
  });

  it("normalize module path", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Bar from "../foo/../to_other_module";

        struct Foo {
          bar: Bar;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to_other_module",
      `
        struct Bar {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [],
    });
  });

  it("module path must point to a file within root", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Bar from "../../../other_module";

        struct Foo {
          bar: Bar;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/other_module",
      `
        struct Bar {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: '"../../../other_module"',
          },
          message: "Module path must point to a file within root",
        },
      ],
    });
  });

  it("all imports must be used", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        import Bar, Zoo from "./other_module";

        struct Foo {
          zoo: Zoo;
        }
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other_module",
      `
        struct Bar {}
        struct Zoo {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");

    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "Bar",
          },
          message: "Unused import",
        },
      ],
    });
  });

  it("all stable ids must be distinct", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        struct Foo(100) {}
      `,
    );
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/other_module",
      `
        struct Bar(100) {}
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    {
      const actual = moduleSet.parseAndResolve("path/to/module");
      expect(actual).toMatch({
        errors: [],
      });
    }
    {
      const actual = moduleSet.parseAndResolve("path/to/other_module");
      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "Bar",
            },
            message: "Same number as Foo in path/to/module",
          },
        ],
      });
    }
  });

  it("all method numbers must be distinct", () => {
    const fakeFileReader = new FakeFileReader();
    fakeFileReader.pathToCode.set(
      "path/to/root/path/to/module",
      `
        method GetFoo(string): string = 2103196129;
        method GetBar(string): string;
      `,
    );

    const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
    const actual = moduleSet.parseAndResolve("path/to/module");
    expect(actual).toMatch({
      errors: [
        {
          token: {
            text: "GetBar",
          },
          message: "Same number as GetFoo in path/to/module",
        },
      ],
    });
  });

  describe("constants", () => {
    it("works", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        struct Color {
          r: int32;
          g: int32;
          b: int32;
        }

        struct Point {
          x: float32;
          removed;
          y: float32;
        }

        struct Shape {
          color: Color;
          points: [Point];
        }

        const MY_SHAPE: Shape = {
          color: {
            r: 255,
            g: 0,
            b: 0,
          },
          points: [
            {
              x: 10.0,
              y: 10.0,
            },
            {|
              y: 20.0,
            |},
            {
              x: 10.0,
              y: 0.0,
            },
          ],
        };
        const NULL_SHAPE: Shape? = null;
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        result: {
          nameToDeclaration: {
            MY_SHAPE: {
              kind: "constant",
              name: {
                text: "MY_SHAPE",
              },
              type: {
                kind: "record",
                key: "path/to/module:207",
                recordType: "struct",
                refToken: {
                  text: "Shape",
                },
              },
              value: {
                kind: "object",
                token: {
                  text: "{",
                },
                entries: {
                  color: {
                    name: {
                      text: "color",
                    },
                    value: {
                      kind: "object",
                      token: {
                        text: "{",
                      },
                      entries: {
                        r: {
                          value: {
                            kind: "literal",
                            token: {
                              text: "255",
                            },
                            type: {
                              kind: "primitive",
                              primitive: "int32",
                            },
                          },
                        },
                        g: {},
                        b: {},
                      },
                      type: "path/to/module:16",
                    },
                  },
                  points: {
                    value: {
                      kind: "array",
                      token: {
                        text: "[",
                      },
                      items: [
                        {
                          kind: "object",
                          token: {
                            text: "{",
                          },
                          entries: {
                            x: {
                              value: {
                                kind: "literal",
                                token: {
                                  text: "10.0",
                                },
                                type: {
                                  kind: "primitive",
                                  primitive: "float32",
                                },
                              },
                            },
                            y: {},
                          },
                          type: "path/to/module:110",
                        },
                        {},
                        {},
                      ],
                    },
                  },
                },
                type: "path/to/module:207",
              },
              valueAsDenseJson: [[255], [[10, 0, 10], [0, 0, 20], [10]]],
            },
            NULL_SHAPE: {
              kind: "constant",
              type: {
                kind: "optional",
                other: {
                  refToken: {
                    text: "Shape",
                  },
                },
              },
              value: {
                kind: "literal",
                token: {
                  text: "null",
                },
                type: {
                  kind: "null",
                },
              },
              valueAsDenseJson: null,
            },
          },
          constants: [{}, {}],
        },
        errors: [],
      });
    });

    it("honors default values", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        struct Struct {
          opt_a: int32?;
          int: int32;
          float: float32;
          bool: bool;
          ints: [int32];
          opt_b: int32?;
        }

        const S: Struct = {
          opt_a: 0,
          int: 0,
          float: 0.0,
          bool: false,
          ints: [],
          opt_b: null,
        };
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        result: {
          nameToDeclaration: {
            S: {
              kind: "constant",
              name: {
                text: "S",
              },
              valueAsDenseJson: [0],
            },
          },
        },
        errors: [],
      });
    });

    it("with keyed array", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        enum Enum {
          A;
          B;
          c: string;
        }
        struct EnumWrapper {
          e: Enum;
        }
        struct Bar {
          x: int32;
        }
        struct Foo {
          enums: [EnumWrapper|e.kind];
          bars: [Bar|x]?;
        }

        const FOO: Foo = {
          enums: [
            {
              e: "A",
            },
            {
              e: "B",
            },
            {
              e: "?",
            },
            {
              e: {
                kind: "c",
                value: "v",
              },
            },
          ],
          bars: [
            {
              x: 0,
            },
          ],
        };
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [],
      });
    });

    it("type error", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
          struct Color {
            r: int32;
            g: int32;
            b: int32;
          }
  
          const BLUE: Color = {
            r: 0,
            g: 0,
            b: 255.0,
          };
        `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "255.0",
            },
            expected: "int32",
          },
        ],
      });
    });

    it("key missing from keyed array", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        enum Enum {
          A;
          B;
        }
        struct EnumWrapper {
          e: Enum;
        }
        struct Foo {
          enums: [EnumWrapper|e.kind];
        }

        const FOO: Foo = {
          enums: [
            {
              e: "A",
            },
            {
            },
          ],
        };
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "{",
            },
            message: "Missing entry: e",
          },
        ],
      });
    });

    it("duplicate key in keyed array", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        enum Enum {
          A;
          B;
        }
        struct EnumWrapper {
          e: Enum;
        }
        struct Foo {
          enums: [EnumWrapper|e.kind];
        }

        const FOO: Foo = {
          enums: [
            {
              e: "A",
            },
            {
              e: 'A',
            },
          ],
        };
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: '"A"',
            },
            message: "Duplicate key",
          },
          {
            token: {
              text: "'A'",
            },
            message: "Duplicate key",
          },
        ],
      });
    });

    it("missing struct field", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        struct Point {
          x: int32;
          y: int32;
        }

        const POINT: Point = {
          x: 10,
        };
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        errors: [
          {
            token: {
              text: "{",
            },
            message: "Missing entry: y",
          },
        ],
      });
    });

    it("missing struct field okay if partial", () => {
      const fakeFileReader = new FakeFileReader();
      fakeFileReader.pathToCode.set(
        "path/to/root/path/to/module",
        `
        struct Point {
          x: int32;
          y: int32;
        }

        const POINT: Point = {|
          x: 10,
        |};
      `,
      );
      const moduleSet = ModuleSet.create(fakeFileReader, "path/to/root");
      const actual = moduleSet.parseAndResolve("path/to/module");

      expect(actual).toMatch({
        result: {
          constants: [
            {
              name: {
                text: "POINT",
              },
              valueAsDenseJson: [10],
            },
          ],
        },
        errors: [],
      });
    });
  });
});
