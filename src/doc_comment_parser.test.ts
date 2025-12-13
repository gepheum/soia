import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { parseDocComments } from "./doc_comment_parser.js";
import type { CodeLine, Token } from "./types.js";

function makeToken(text: string, position: number = 0): Token {
  const line: CodeLine = {
    lineNumber: 0,
    line: text,
    position: 0,
    modulePath: "test",
  };
  return {
    text,
    originalText: text,
    position,
    line,
    colNumber: 0,
  };
}

describe("doc_comment_parser", () => {
  it("parses simple text", () => {
    const tokens = [makeToken("/// Hello, world!")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "Hello, world!" }],
      },
    });
  });

  it("skips exactly one space after ///", () => {
    const tokens = [
      makeToken("/// Hello"),
      makeToken("///  Two spaces"),
      makeToken("///No space"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "Hello\n Two spaces\nNo space" }],
      },
    });
  });

  it("parses multiple lines as single text fragment", () => {
    const tokens = [
      makeToken("/// Hello,"),
      makeToken("/// world!"),
      makeToken("/// How are you?"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "Hello,\nworld!\nHow are you?" }],
      },
    });
  });

  it("parses simple reference", () => {
    const tokens = [makeToken("/// See [.foo.Bar] for details")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "See " },
          {
            kind: "reference",
            tokens: [
              { text: "." },
              { text: "foo" },
              { text: "." },
              { text: "Bar" },
            ],
          },
          { kind: "text", text: " for details" },
        ],
      },
    });
  });

  it("parses reference without leading dot", () => {
    const tokens = [makeToken("/// See [Foo] for details")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {},
          {
            kind: "reference",
            tokens: [{ text: "Foo" }],
          },
          {},
        ],
      },
    });
  });

  it("parses reference with whitespace", () => {
    const tokens = [makeToken("/// See [ .foo . Bar ] for details")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {},
          {
            kind: "reference",
            tokens: [
              { text: "." },
              { text: "foo" },
              { text: "." },
              { text: "Bar" },
            ],
          },
          {},
        ],
      },
    });
  });

  it("parses escaped brackets", () => {
    const tokens = [makeToken("/// Hello [[world]]!")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "Hello [world]!" }],
      },
    });
  });

  it("handles unmatched closing bracket", () => {
    const tokens = [makeToken("/// Hello ] world")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "Hello ] world" }],
      },
    });
  });

  it("parses multiple references and text fragments", () => {
    const tokens = [
      makeToken("/// Hello,"),
      makeToken("/// world [.foo.Bar], how are"),
      makeToken("/// you?"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "Hello,\nworld " },
          { kind: "reference" },
          { kind: "text", text: ", how are\nyou?" },
        ],
      },
    });
  });

  it("reports error for empty reference", () => {
    const tokens = [makeToken("/// See [] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors[0]).toMatch({ message: "Empty reference" });
  });

  it("reports error for unterminated reference", () => {
    const tokens = [makeToken("/// See [.foo.Bar for details")];
    const result = parseDocComments(tokens);

    expect(result.errors[0]).toMatch({ message: "Unterminated reference" });
  });

  it("reports error for invalid character in reference", () => {
    const tokens = [makeToken("/// See [foo@bar] for details")];
    const result = parseDocComments(tokens);

    expect(
      result.errors[0]?.message?.includes("Invalid character '@' in reference"),
    ).toBe(true);
  });

  it("rejects digit at start of word in reference", () => {
    const tokens = [makeToken("/// See [.foo.9Bar] for details")];
    const result = parseDocComments(tokens);

    expect(
      result.errors[0]?.message?.includes("Invalid character '9' in reference"),
    ).toBe(true);
  });

  it("allows underscore and digits in word after first letter", () => {
    const tokens = [makeToken("/// See [Foo_Bar_123] for details")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {},
          {
            kind: "reference",
            tokens: [{ text: "Foo_Bar_123" }],
          },
          {},
        ],
      },
    });
  });

  it("handles mixed escaped brackets and references", () => {
    const tokens = [
      makeToken("/// [[Not a reference]] but [RealReference] is"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "[Not a reference] but " },
          { kind: "reference" },
          { kind: "text", text: " is" },
        ],
      },
    });
  });

  it("handles empty doc comments", () => {
    const tokens: Token[] = [];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [],
      },
    });
  });

  it("handles only whitespace after ///", () => {
    const tokens = [makeToken("///"), makeToken("///   ")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "\n  " }],
      },
    });
  });

  it("continues parsing after error", () => {
    const tokens = [
      makeToken("/// Invalid [@ but"),
      makeToken("/// valid [Link] here"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(result.result.pieces.length > 0).toBe(true);
  });

  it("handles reference at start of comment", () => {
    const tokens = [makeToken("///[Reference] at start")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "reference" }, { kind: "text", text: " at start" }],
      },
    });
  });

  it("handles reference at end of comment", () => {
    const tokens = [makeToken("/// End with [Reference]")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [{ kind: "text", text: "End with " }, { kind: "reference" }],
      },
    });
  });

  it("handles reference at end of line followed by text on next line", () => {
    const tokens = [
      makeToken("/// End with [Reference]"),
      makeToken("/// and continue text"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "End with " },
          {
            kind: "reference",
            tokens: [{ text: "Reference" }],
          },
          { kind: "text", text: "\nand continue text" },
        ],
      },
    });
  });

  it("handles consecutive references", () => {
    const tokens = [makeToken("/// [Ref1][Ref2][Ref3]")];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "reference" },
          { kind: "reference" },
          { kind: "reference" },
        ],
      },
    });
  });

  it("preserves correct token positions with space after ///", () => {
    const tokens = [makeToken("/// [Foo]", 100)];
    const result = parseDocComments(tokens);

    // Position should be 100 (start) + 3 (///) + 1 (space) + 1 (opening bracket) = 105
    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {
            kind: "reference",
            tokens: [{ text: "Foo", position: 105 }],
          },
        ],
      },
    });
  });

  it("preserves correct token positions without space after ///", () => {
    const tokens = [makeToken("///[Foo]", 100)];
    const result = parseDocComments(tokens);

    // Position should be 100 (start) + 3 (///) + 1 (opening bracket) = 104
    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {
            kind: "reference",
            tokens: [{ text: "Foo", position: 104 }],
          },
        ],
      },
    });
  });

  it("preserves correct error positions with space after ///", () => {
    const tokens = [makeToken("/// [@invalid]", 100)];
    const result = parseDocComments(tokens);

    // Error should be at position 100 + 3 (///) + 1 (space) + 1 (bracket) = 105 for @
    expect(result.errors[0]?.token.position).toBe(105);
  });

  it("preserves correct error positions without space after ///", () => {
    const tokens = [makeToken("///[@invalid]", 100)];
    const result = parseDocComments(tokens);

    // Error should be at position 100 + 3 (///) + 1 (bracket) = 104 for @
    expect(result.errors[0]?.token.position).toBe(104);
  });

  it("parses multiple references across multiple lines", () => {
    const tokens = [
      makeToken("/// See [Ref1] and"),
      makeToken("/// also [Ref2] here"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "See " },
          {
            kind: "reference",
            tokens: [{ text: "Ref1" }],
          },
          { kind: "text", text: " and\nalso " },
          {
            kind: "reference",
            tokens: [{ text: "Ref2" }],
          },
          { kind: "text", text: " here" },
        ],
      },
    });
  });

  it("parses reference split across multiple lines", () => {
    const tokens = [
      makeToken("/// See [.foo"),
      makeToken("/// .Bar] for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          { kind: "text", text: "See " },
          {
            kind: "reference",
            tokens: [
              { text: "." },
              { text: "foo" },
              { text: "." },
              { text: "Bar" },
            ],
          },
          { kind: "text", text: " for details" },
        ],
      },
    });
  });

  it("parses reference split with whitespace across multiple lines", () => {
    const tokens = [
      makeToken("/// See [ .foo "),
      makeToken("///   .Bar  ] for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result).toMatch({
      errors: [],
      result: {
        pieces: [
          {},
          {
            kind: "reference",
            tokens: [
              { text: "." },
              { text: "foo" },
              { text: "." },
              { text: "Bar" },
            ],
          },
          {},
        ],
      },
    });
  });

  it("handles unterminated reference across multiple lines", () => {
    const tokens = [
      makeToken("/// See [.foo"),
      makeToken("/// .Bar for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors[0]).toMatch({ message: "Unterminated reference" });
  });
});
