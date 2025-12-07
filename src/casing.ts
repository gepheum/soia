import type { Casing, ErrorSink, Token } from "./types.js";

/** Registers an error if the given token does not match the expected casing. */
export function validate(
  name: Token,
  expected: "lower_underscore" | "UpperCamel" | "UPPER_UNDERSCORE",
  errors: ErrorSink,
): void {
  if (!caseMatches(name.text, expected)) {
    errors.push({
      token: name,
      expected: expected,
    });
  }
}

export function convertCase(
  text: string,
  source: Casing,
  target: Casing,
): string {
  let words: string[];
  switch (source) {
    case "lowerCamel":
    case "UpperCamel":
      words = text.split(/(?=[A-Z])/).map((w) => w.toLowerCase());
      break;
    case "lower_underscore":
      words = text.split("_");
      break;
    case "UPPER_UNDERSCORE":
      words = text.split("_").map((w) => w.toLowerCase());
      break;
  }
  switch (target) {
    case "lowerCamel":
      return words.map((w, i) => (i ? capitalize(w) : w)).join("");
    case "lower_underscore":
      return words.join("_");
    case "UpperCamel":
      return words.map(capitalize).join("");
    case "UPPER_UNDERSCORE":
      return words.map((w) => w.toUpperCase()).join("_");
  }
}

/** Returns a new string with the first letter of `name` capitalized. */
export function capitalize(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1);
}

export function caseMatches(
  name: string,
  expected: "lower_underscore" | "UpperCamel" | "UPPER_UNDERSCORE",
): boolean {
  switch (expected) {
    case "lower_underscore":
      return /^[a-z][0-9a-z]*(_[a-z][0-9a-z]*)*$/.test(name);
    case "UpperCamel":
      return /^[A-Z][0-9A-Za-z]*$/.test(name);
    case "UPPER_UNDERSCORE":
      return /^[A-Z][0-9A-Z]*(_[A-Z][0-9A-Z]*)*$/.test(name);
  }
}
