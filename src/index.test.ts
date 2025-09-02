import { expect } from "buckwheat";
import { describe, it } from "mocha";
import * as exports from "./index.js";

describe("index.ts", () => {
  it("exports the right symbols", () => {
    // The actual logic is covered in other unit tests.
    // Here we just want to make sure the right symbols are exported.
    let _: exports.Module;
    expect(exports.convertCase("foo", "lowerCamel", "UPPER_UNDERSCORE")).toBe(
      "FOO",
    );
    expect(exports.capitalize("foo")).toBe("Foo");
    expect(exports.unquoteAndUnescape('"foo"')).toBe("foo");
  });
});
