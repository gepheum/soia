import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { encodeInt32 } from "./encoding.js";

function toHexString(a: Uint8Array): string {
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

describe("encoding", () => {
  it("encodeInt32 works", () => {
    expect(toHexString(encodeInt32(4))).toMatch("04");
    expect(toHexString(encodeInt32(231))).toMatch("e7");
    expect(toHexString(encodeInt32(232))).toMatch("e8e800");
    expect(toHexString(encodeInt32(65535))).toMatch("e8ffff");
    expect(toHexString(encodeInt32(65536))).toMatch("e900000100");
    expect(toHexString(encodeInt32(2147483647))).toMatch("e9ffffff7f");
    expect(toHexString(encodeInt32(-255))).toMatch("eb01");
    expect(toHexString(encodeInt32(-256))).toMatch("eb00");
    expect(toHexString(encodeInt32(-257))).toMatch("ecfffe");
    expect(toHexString(encodeInt32(-65536))).toMatch("ec0000");
    expect(toHexString(encodeInt32(-65537))).toMatch("edfffffeff");
    expect(toHexString(encodeInt32(-2147483648))).toMatch("ed00000080");
  });
});
