import { findDefinition, findLinkableTokens } from "./definition_finder.js";
import type { FileReader } from "./io.js";
import { ModuleSet } from "./module_set.js";
import { expect } from "buckwheat";
import { describe, it } from "mocha";

class FakeFileReader implements FileReader {
  readTextFile(modulePath: string): string | undefined {
    return this.pathToCode.get(modulePath);
  }

  pathToCode = new Map<string, string>();
}

describe("definition finder", () => {
  const fakeFileReader = new FakeFileReader();
  fakeFileReader.pathToCode.set(
    "path/to/root/path/to/module",
    `
        import * as other_module from "./other/module";

        struct Outer {
          struct Foo {}
        }

        struct Bar {
          foo: Outer.Foo;
          foo2: .Outer.Foo;

          struct Inner {}
          inner: Inner;
          zoo: other_module.Outer.Zoo;
        }

        method GetBar(Outer.Foo): Bar;
        method GetBar2(Outer.Foo): Bar = 100;

        const FOO: Outer.Foo = {};
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
  const module = moduleSet.parseAndResolve("path/to/module").result;
  if (module === null) {
    return Error("Failed to parse module");
  }

  it("works with module paths", () => {
    expect(findDefinition(module, 45)).toMatch({
      modulePath: "path/to/other/module",
      position: 0,
    });
  });

  it("works with record type", () => {
    expect(findDefinition(module, 154)).toMatch({
      modulePath: "path/to/module",
      position: 73,
    });
  });

  it("works with nested record type", () => {
    expect(findDefinition(module, 187)).toMatch({
      modulePath: "path/to/module",
      position: 98,
    });
  });

  it("works with module alias", () => {
    expect(findDefinition(module, 262)).toMatch({
      modulePath: "path/to/module",
      position: 21,
    });
  });

  it("works with request type", () => {
    expect(findDefinition(module, 316)).toMatch({
      modulePath: "path/to/module",
      position: 73,
    });
  });

  it("works with response type", () => {
    expect(findDefinition(module, 367)).toMatch({
      modulePath: "path/to/module",
      position: 131,
    });
  });

  it("works with constant type", () => {
    expect(findDefinition(module, 404)).toMatch({
      modulePath: "path/to/module",
      position: 98,
    });
  });

  it("find linkable tokens works", () => {
    expect(findLinkableTokens(module)).toMatch([
      {
        text: '"./other/module"',
        position: 39,
        line: {
          modulePath: "path/to/module",
        },
      },
      {
        text: "Outer",
        position: 152,
      },
      {
        text: "Foo",
        position: 158,
      },
      {
        text: "Outer",
        position: 180,
      },
      {
        text: "Foo",
        position: 186,
      },
      {
        text: "Inner",
        position: 235,
      },
      {
        text: "other_module",
        position: 257,
      },
      {
        text: "Outer",
        position: 270,
      },
      {
        text: "Zoo",
        position: 276,
      },
      {
        text: "Outer",
        position: 314,
      },
      {
        text: "Foo",
        position: 320,
      },
      {
        text: "Bar",
        position: 326,
      },
      {
        text: "Outer",
        position: 354,
      },
      {
        text: "Foo",
        position: 360,
      },
      {
        text: "Bar",
        position: 366,
      },
      {
        text: "Outer",
        position: 397,
      },
      {
        text: "Foo",
        position: 403,
      },
    ]);
  });
});
