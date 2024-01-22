import { expect } from "buckwheat";
import { describe, it } from "mocha";
import type { SoiaError, Token } from "./types.js";
import { capitalize, convertCase, validate } from "./casing.js";

function makeToken(text: string): Token {
  return {
    text: text,
    colNumber: 0,
    line: {
      line: "",
      lineNumber: 0,
      modulePath: "",
      position: 0,
    },
    position: 0,
  };
}

function doValidate(
  text: string,
  casing: "lower_underscore" | "UpperCamel" | "UPPER_UNDERSCORE",
): SoiaError[] {
  const errors: SoiaError[] = [];
  validate(makeToken(text), casing, errors);
  return errors;
}

describe("casing", () => {
  describe("validate", () => {
    it("is lower_underscore", () => {
      expect(doValidate("foo", "lower_underscore")).toMatch([]);
      expect(doValidate("foo_bar", "lower_underscore")).toMatch([]);
      expect(doValidate("f00", "lower_underscore")).toMatch([]);
      expect(doValidate("f00_bar", "lower_underscore")).toMatch([]);
    });

    it("is not lower_underscore", () => {
      expect(doValidate("Foo", "lower_underscore")).toMatch([
        {
          token: {
            text: "Foo",
          },
          expected: "lower_underscore",
        },
      ]);
      expect(doValidate("foo__bar", "lower_underscore")).toMatch([
        {
          token: {
            text: "foo__bar",
          },
          expected: "lower_underscore",
        },
      ]);
      expect(doValidate("foo_", "lower_underscore")).toMatch([
        {
          token: {
            text: "foo_",
          },
          expected: "lower_underscore",
        },
      ]);
      expect(doValidate("fOO", "lower_underscore")).toMatch([
        {
          token: {
            text: "fOO",
          },
          expected: "lower_underscore",
        },
      ]);
      expect(doValidate("foo_7", "lower_underscore")).toMatch([
        {
          token: {
            text: "foo_7",
          },
          expected: "lower_underscore",
        },
      ]);
    });

    it("is UPPER_UNDERSCORE", () => {
      expect(doValidate("FOO", "UPPER_UNDERSCORE")).toMatch([]);
      expect(doValidate("FOO_BAR", "UPPER_UNDERSCORE")).toMatch([]);
      expect(doValidate("F00", "UPPER_UNDERSCORE")).toMatch([]);
      expect(doValidate("F00_BAR", "UPPER_UNDERSCORE")).toMatch([]);
    });

    it("is not UPPER_UNDERSCORE", () => {
      expect(doValidate("fOO", "UPPER_UNDERSCORE")).toMatch([
        {
          token: {
            text: "fOO",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ]);
      expect(doValidate("FOO__BAR", "UPPER_UNDERSCORE")).toMatch([
        {
          token: {
            text: "FOO__BAR",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ]);
      expect(doValidate("FOO_", "UPPER_UNDERSCORE")).toMatch([
        {
          token: {
            text: "FOO_",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ]);
      expect(doValidate("fOO", "UPPER_UNDERSCORE")).toMatch([
        {
          token: {
            text: "fOO",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ]);
      expect(doValidate("FOO_7", "UPPER_UNDERSCORE")).toMatch([
        {
          token: {
            text: "FOO_7",
          },
          expected: "UPPER_UNDERSCORE",
        },
      ]);
    });
  });

  it("convert", () => {
    expect(convertCase("FOO_BAR", "UPPER_UNDERSCORE", "UPPER_UNDERSCORE")).toBe(
      "FOO_BAR",
    );
    expect(convertCase("FOO_BAR", "UPPER_UNDERSCORE", "UpperCamel")).toBe(
      "FooBar",
    );
    expect(convertCase("FOO_BAR", "UPPER_UNDERSCORE", "lowerCamel")).toBe(
      "fooBar",
    );
    expect(convertCase("FOO_BAR", "UPPER_UNDERSCORE", "lower_underscore")).toBe(
      "foo_bar",
    );
    expect(convertCase("FooBar", "UpperCamel", "UPPER_UNDERSCORE")).toBe(
      "FOO_BAR",
    );
    expect(convertCase("fooBar", "lowerCamel", "UPPER_UNDERSCORE")).toBe(
      "FOO_BAR",
    );
    expect(convertCase("foo_bar", "lower_underscore", "UPPER_UNDERSCORE")).toBe(
      "FOO_BAR",
    );
  });

  it("capitalize", () => {
    expect(capitalize("fooBar")).toBe("FooBar");
  });
});
