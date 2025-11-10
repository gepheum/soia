import { expect } from "buckwheat";
import { describe, it } from "mocha";
import {
  isStringLiteral,
  literalValueToDenseJson,
  literalValueToIdentity,
  unquoteAndUnescape,
  valueHasPrimitiveType,
} from "./literals.js";

describe("literals", () => {
  it("#unquoteAndUnescape() works", () => {
    expect(unquoteAndUnescape('"foo\\\r\n\\\n\\\r\\tbar\\\\t"')).toBe(
      ["foo", "", "", "\tbar\\t"].join("\n"),
    );
  });

  it("#isStringLiteral() works", () => {
    expect(isStringLiteral('"foo"')).toBe(true);
    expect(isStringLiteral('""')).toBe(true);
    expect(isStringLiteral("3")).toBe(false);
  });

  describe("#valueHasPrimitiveType()", () => {
    it("works with bool", () => {
      expect(valueHasPrimitiveType("true", "bool")).toBe(true);
      expect(valueHasPrimitiveType("false", "bool")).toBe(true);
      expect(valueHasPrimitiveType("'true'", "bool")).toBe(false);
    });

    it("works with bytes", () => {
      expect(valueHasPrimitiveType("'hex:09afAF'", "bytes")).toBe(true);
      expect(valueHasPrimitiveType('"hex:09afAF"', "bytes")).toBe(true);
      expect(valueHasPrimitiveType("'hex:09afAFa'", "bytes")).toBe(false);
      expect(valueHasPrimitiveType("'hex:09afAG'", "bytes")).toBe(false);
    });

    it("works with timestamp", () => {
      expect(valueHasPrimitiveType("'2023-12-25Z'", "timestamp")).toBe(true);
      expect(
        valueHasPrimitiveType('"2023-12-25T12:00:00.000+08:30"', "timestamp"),
      ).toBe(true);
      // No timezone
      expect(valueHasPrimitiveType('"2023-12-25"', "timestamp")).toBe(false);
      expect(valueHasPrimitiveType('"now"', "timestamp")).toBe(false);
      // Out of bounds
      expect(valueHasPrimitiveType('"-10000-12-25T12:00Z"', "timestamp")).toBe(
        false,
      );
      expect(valueHasPrimitiveType('"10000-12-25T12:00Z"', "timestamp")).toBe(
        false,
      );
    });

    it("works with int32", () => {
      expect(valueHasPrimitiveType("-2147483648", "int32")).toBe(true);
      expect(valueHasPrimitiveType("2147483647", "int32")).toBe(true);
      expect(valueHasPrimitiveType("-2147483649", "int32")).toBe(false);
      expect(valueHasPrimitiveType("2147483648", "int32")).toBe(false);
      expect(valueHasPrimitiveType("Infinity", "int32")).toBe(false);
      expect(valueHasPrimitiveType("3.14", "int32")).toBe(false);
    });

    it("works with int64", () => {
      expect(valueHasPrimitiveType("-9223372036854775808", "int64")).toBe(true);
      expect(valueHasPrimitiveType("9223372036854775807", "int64")).toBe(true);
      expect(valueHasPrimitiveType("-9223372036854775809", "int64")).toBe(
        false,
      );
      expect(valueHasPrimitiveType("9223372036854775808", "int64")).toBe(false);
      expect(valueHasPrimitiveType("3.14", "int64")).toBe(false);
    });

    it("works with uint64", () => {
      expect(valueHasPrimitiveType("0", "uint64")).toBe(true);
      expect(valueHasPrimitiveType("18446744073709551615", "uint64")).toBe(
        true,
      );
      expect(valueHasPrimitiveType("18446744073709551616", "uint64")).toBe(
        false,
      );
      expect(valueHasPrimitiveType("3.14", "uint64")).toBe(false);
    });

    it("works with float32", () => {
      expect(valueHasPrimitiveType("0", "float32")).toBe(true);
      expect(valueHasPrimitiveType("-10", "float32")).toBe(true);
      expect(valueHasPrimitiveType("3.14", "float32")).toBe(true);
      expect(valueHasPrimitiveType("-3.14", "float32")).toBe(true);
      expect(valueHasPrimitiveType("'-3.14'", "float32")).toBe(false);
      expect(valueHasPrimitiveType("'-Infinity'", "float32")).toBe(true);
      expect(valueHasPrimitiveType("'Infinity'", "float32")).toBe(true);
      expect(valueHasPrimitiveType("'NaN'", "float32")).toBe(true);
    });

    it("works with float64", () => {
      expect(valueHasPrimitiveType("0", "float64")).toBe(true);
      expect(valueHasPrimitiveType("-10", "float64")).toBe(true);
      expect(valueHasPrimitiveType("3.14", "float64")).toBe(true);
      expect(valueHasPrimitiveType("-3.14", "float64")).toBe(true);
      expect(valueHasPrimitiveType("'-3.14'", "float64")).toBe(false);
      expect(valueHasPrimitiveType("'-Infinity'", "float64")).toBe(true);
      expect(valueHasPrimitiveType("'Infinity'", "float64")).toBe(true);
      expect(valueHasPrimitiveType("'NaN'", "float64")).toBe(true);
    });

    it("works with string", () => {
      expect(valueHasPrimitiveType("''", "string")).toBe(true);
      expect(valueHasPrimitiveType('""', "string")).toBe(true);
      expect(valueHasPrimitiveType("'foo'", "string")).toBe(true);
      expect(valueHasPrimitiveType('"foo"', "string")).toBe(true);
      expect(valueHasPrimitiveType("3", "string")).toBe(false);
    });
  });

  describe("#literalValueToIdentity()", () => {
    it("works with bool", () => {
      expect(literalValueToIdentity("true", "bool")).toBe("1");
      expect(literalValueToIdentity("false", "bool")).toBe("0");
    });

    it("works with bytes", () => {
      expect(literalValueToIdentity("'hex:09afAF'", "bytes")).toBe("Ca+v");
    });

    it("works with timestamp", () => {
      expect(literalValueToIdentity("'2023-12-25Z'", "timestamp")).toBe(
        "1703462400000",
      );
    });

    it("works with int32", () => {
      expect(literalValueToIdentity("-02147483648", "int32")).toBe(
        "-2147483648",
      );
    });

    it("works with int64", () => {
      expect(literalValueToIdentity("-09223372036854775808", "int64")).toBe(
        "-9223372036854775808",
      );
    });

    it("works with uint64", () => {
      expect(literalValueToIdentity("18446744073709551615", "uint64")).toBe(
        "18446744073709551615",
      );
    });

    it("works with float32", () => {
      expect(literalValueToIdentity("3.140", "float32")).toBe("3.14");
    });

    it("works with float64", () => {
      expect(literalValueToIdentity("3.140", "float64")).toBe("3.14");
    });

    it("works with string", () => {
      expect(literalValueToIdentity("'foo'", "string")).toBe("foo");
    });
  });

  describe("#literalValueToDenseJson()", () => {
    it("works with bool", () => {
      expect(literalValueToDenseJson("true", "bool")).toBe(1);
      expect(literalValueToDenseJson("false", "bool")).toBe(0);
    });

    it("works with bytes", () => {
      expect(literalValueToDenseJson("'hex:09afAF'", "bytes")).toBe("Ca+v");
    });

    it("works with timestamp", () => {
      expect(literalValueToDenseJson("'2023-12-25Z'", "timestamp")).toBe(
        1703462400000,
      );
    });

    it("works with int32", () => {
      expect(literalValueToDenseJson("-02147483648", "int32")).toBe(
        -2147483648,
      );
    });

    it("works with int64", () => {
      expect(literalValueToDenseJson("-09223372036854775808", "int64")).toBe(
        "-9223372036854775808",
      );
    });

    it("works with uint64", () => {
      expect(literalValueToDenseJson("18446744073709551615", "uint64")).toBe(
        "18446744073709551615",
      );
    });

    it("works with float32", () => {
      expect(literalValueToDenseJson("3.140", "float32")).toBe(3.14);
      expect(literalValueToDenseJson("'Infinity'", "float32")).toBe("Infinity");
      expect(literalValueToDenseJson("'NaN'", "float32")).toBe("NaN");
    });

    it("works with float64", () => {
      expect(literalValueToDenseJson("3.140", "float64")).toBe(3.14);
      expect(literalValueToDenseJson("'-Infinity'", "float64")).toBe(
        "-Infinity",
      );
      expect(literalValueToDenseJson("'NaN'", "float64")).toBe("NaN");
    });

    it("works with string", () => {
      expect(literalValueToDenseJson("'foo'", "string")).toBe("foo");
    });
  });
});
