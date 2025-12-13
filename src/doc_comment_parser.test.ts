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

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([
      { kind: "text", text: "Hello, world!" },
    ]);
  });

  it("skips exactly one space after ///", () => {
    const tokens = [
      makeToken("/// Hello"),
      makeToken("///  Two spaces"),
      makeToken("///No space"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([
      { kind: "text", text: "Hello\n Two spaces\nNo space" },
    ]);
  });

  it("parses multiple lines as single text fragment", () => {
    const tokens = [
      makeToken("/// Hello,"),
      makeToken("/// world!"),
      makeToken("/// How are you?"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([
      { kind: "text", text: "Hello,\nworld!\nHow are you?" },
    ]);
  });

  it("parses simple reference", () => {
    const tokens = [makeToken("/// See [.foo.Bar] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]).toMatch({ kind: "text", text: "See " });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch([".", "foo", ".", "Bar"]);
    }
    expect(result.result.pieces[2]).toMatch({
      kind: "text",
      text: " for details",
    });
  });

  it("parses reference without leading dot", () => {
    const tokens = [makeToken("/// See [Foo] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch(["Foo"]);
    }
  });

  it("parses reference with whitespace", () => {
    const tokens = [makeToken("/// See [ .foo . Bar ] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch([".", "foo", ".", "Bar"]);
    }
  });

  it("parses escaped brackets", () => {
    const tokens = [makeToken("/// Hello [[world]]!")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([
      { kind: "text", text: "Hello [world]!" },
    ]);
  });

  it("handles unmatched closing bracket", () => {
    const tokens = [makeToken("/// Hello ] world")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([
      { kind: "text", text: "Hello ] world" },
    ]);
  });

  it("parses multiple references and text fragments", () => {
    const tokens = [
      makeToken("/// Hello,"),
      makeToken("/// world [.foo.Bar], how are"),
      makeToken("/// you?"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]).toMatch({
      kind: "text",
      text: "Hello,\nworld ",
    });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    expect(result.result.pieces[2]).toMatch({
      kind: "text",
      text: ", how are\nyou?",
    });
  });

  it("reports error for empty reference", () => {
    const tokens = [makeToken("/// See [] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toBe("Empty reference");
  });

  it("reports error for unterminated reference", () => {
    const tokens = [makeToken("/// See [.foo.Bar for details")];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toBe("Unterminated reference");
  });

  it("reports error for invalid character in reference", () => {
    const tokens = [makeToken("/// See [foo@bar] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(
      result.errors[0]?.message?.includes("Invalid character '@' in reference"),
    ).toBe(true);
  });

  it("rejects digit at start of word in reference", () => {
    const tokens = [makeToken("/// See [.foo.9Bar] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(
      result.errors[0]?.message?.includes("Invalid character '9' in reference"),
    ).toBe(true);
  });

  it("allows underscore and digits in word after first letter", () => {
    const tokens = [makeToken("/// See [Foo_Bar_123] for details")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch(["Foo_Bar_123"]);
    }
  });

  it("handles mixed escaped brackets and references", () => {
    const tokens = [
      makeToken("/// [[Not a reference]] but [RealReference] is"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]).toMatch({
      kind: "text",
      text: "[Not a reference] but ",
    });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    expect(result.result.pieces[2]).toMatch({ kind: "text", text: " is" });
  });

  it("handles empty doc comments", () => {
    const tokens: Token[] = [];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([]);
  });

  it("handles only whitespace after ///", () => {
    const tokens = [makeToken("///"), makeToken("///   ")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces).toMatch([{ kind: "text", text: "\n  " }]);
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

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(2);
    expect(result.result.pieces[0]?.kind).toBe("reference");
    expect(result.result.pieces[1]).toMatch({
      kind: "text",
      text: " at start",
    });
  });

  it("handles reference at end of comment", () => {
    const tokens = [makeToken("/// End with [Reference]")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(2);
    expect(result.result.pieces[0]).toMatch({
      kind: "text",
      text: "End with ",
    });
    expect(result.result.pieces[1]?.kind).toBe("reference");
  });

  it("handles reference at end of line followed by text on next line", () => {
    const tokens = [
      makeToken("/// End with [Reference]"),
      makeToken("/// and continue text"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]).toMatch({
      kind: "text",
      text: "End with ",
    });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      expect(result.result.pieces[1].tokens.map((t) => t.text)).toMatch([
        "Reference",
      ]);
    }
    expect(result.result.pieces[2]).toMatch({
      kind: "text",
      text: "\nand continue text",
    });
  });

  it("handles consecutive references", () => {
    const tokens = [makeToken("/// [Ref1][Ref2][Ref3]")];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]?.kind).toBe("reference");
    expect(result.result.pieces[1]?.kind).toBe("reference");
    expect(result.result.pieces[2]?.kind).toBe("reference");
  });

  it("preserves correct token positions with space after ///", () => {
    const tokens = [makeToken("/// [Foo]", 100)];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[0]?.kind).toBe("reference");
    if (result.result.pieces[0]?.kind === "reference") {
      const referenceToken = result.result.pieces[0].tokens[0]!;
      // Position should be 100 (start) + 3 (///) + 1 (space) + 1 (opening bracket) = 105
      expect(referenceToken.position).toBe(105);
      expect(referenceToken.text).toBe("Foo");
    }
  });

  it("preserves correct token positions without space after ///", () => {
    const tokens = [makeToken("///[Foo]", 100)];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[0]?.kind).toBe("reference");
    if (result.result.pieces[0]?.kind === "reference") {
      const referenceToken = result.result.pieces[0].tokens[0]!;
      // Position should be 100 (start) + 3 (///) + 1 (opening bracket) = 104
      expect(referenceToken.position).toBe(104);
      expect(referenceToken.text).toBe("Foo");
    }
  });

  it("preserves correct error positions with space after ///", () => {
    const tokens = [makeToken("/// [@invalid]", 100)];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    // Error should be at position 100 + 3 (///) + 1 (space) + 1 (bracket) = 105 for @
    expect(result.errors[0]?.token.position).toBe(105);
  });

  it("preserves correct error positions without space after ///", () => {
    const tokens = [makeToken("///[@invalid]", 100)];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    // Error should be at position 100 + 3 (///) + 1 (bracket) = 104 for @
    expect(result.errors[0]?.token.position).toBe(104);
  });

  it("parses multiple references across multiple lines", () => {
    const tokens = [
      makeToken("/// See [Ref1] and"),
      makeToken("/// also [Ref2] here"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(5);
    expect(result.result.pieces[0]).toMatch({ kind: "text", text: "See " });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      expect(result.result.pieces[1].tokens.map((t) => t.text)).toMatch([
        "Ref1",
      ]);
    }
    expect(result.result.pieces[2]).toMatch({
      kind: "text",
      text: " and\nalso ",
    });
    expect(result.result.pieces[3]?.kind).toBe("reference");
    if (result.result.pieces[3]?.kind === "reference") {
      expect(result.result.pieces[3].tokens.map((t) => t.text)).toMatch([
        "Ref2",
      ]);
    }
    expect(result.result.pieces[4]).toMatch({ kind: "text", text: " here" });
  });

  it("parses reference split across multiple lines", () => {
    const tokens = [
      makeToken("/// See [.foo"),
      makeToken("/// .Bar] for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces.length).toBe(3);
    expect(result.result.pieces[0]).toMatch({ kind: "text", text: "See " });
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch([".", "foo", ".", "Bar"]);
    }
    expect(result.result.pieces[2]).toMatch({
      kind: "text",
      text: " for details",
    });
  });

  it("parses reference split with whitespace across multiple lines", () => {
    const tokens = [
      makeToken("/// See [ .foo "),
      makeToken("///   .Bar  ] for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors).toMatch([]);
    expect(result.result.pieces[1]?.kind).toBe("reference");
    if (result.result.pieces[1]?.kind === "reference") {
      const tokens = result.result.pieces[1].tokens;
      expect(tokens.map((t) => t.text)).toMatch([".", "foo", ".", "Bar"]);
    }
  });

  it("handles unterminated reference across multiple lines", () => {
    const tokens = [
      makeToken("/// See [.foo"),
      makeToken("/// .Bar for details"),
    ];
    const result = parseDocComments(tokens);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.message).toBe("Unterminated reference");
  });
});
