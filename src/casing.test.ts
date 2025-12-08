import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { capitalize, convertCase, validate } from "./casing.js";
import type { SkirError, Token } from "./types.js";

function makeToken(text: string): Token {
  return {
    text: text,
    originalText: text,
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
): SkirError[] {
  const errors: SkirError[] = [];
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
    expect(convertCase("FOO_BAR", "UPPER_UNDERSCORE")).toBe("FOO_BAR");
    expect(convertCase("FOO_BAR", "UpperCamel")).toBe("FooBar");
    expect(convertCase("FOO_BAR", "lowerCamel")).toBe("fooBar");
    expect(convertCase("FOO_BAR", "lower_underscore")).toBe("foo_bar");
    expect(convertCase("FooBar", "UPPER_UNDERSCORE")).toBe("FOO_BAR");
    expect(convertCase("fooBar", "UPPER_UNDERSCORE")).toBe("FOO_BAR");
    expect(convertCase("foo_bar", "UPPER_UNDERSCORE")).toBe("FOO_BAR");
    expect(convertCase("fo6_b7r", "UpperCamel")).toBe("Fo6B7r");
  });

  it("capitalize", () => {
    expect(capitalize("fooBar")).toBe("FooBar");
  });
});
