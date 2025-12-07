import { unquoteAndUnescape } from "./literals.js";
import type { CodeLine, ErrorSink, Result, SkirError, Token } from "./types.js";

/** Tokenizes the given module. */
export function tokenizeModule(
  code: string,
  modulePath: string,
  keepComments?: "keep-comments",
): Result<Token[]> {
  const tokens: Token[] = [];
  const errors: SkirError[] = [];

  const lines = new Lines(code, modulePath);

  // Multiline comment:            \/\*([^*]|\*[^\/])*(\*\/)?
  // Single-line comment:          \/\/[^\n\r]*
  // Number:                       -?(0|[1-9][0-9]*)(\.[0-9]+)?\b
  // Word:                         \b\w+\b
  // Whitespaces:                  [ \n\r\t]+
  // Symbol:                       \.\.|\{\||\|\}|[{}[\]()*.:=;|?,]
  // Double-quote string literal:  "(\\(\n|\r|\n\r|.)|[^\\\"\n\r])*"?
  // Single-quote string literal:  '(\\(\n|\r|\n\r|.)|[^\\\'\n\r])*'?
  //
  // To iterate on this regex, use https://regex101.com/.
  const re =
    /(\/\*([^*]|\*[^/])*(\*\/)?)|(\/\/[^\n\r]*)|(-?(0|[1-9][0-9]*)(\.[0-9]+)?\b)|\b(\w+)\b|([ \n\r\t]+)|(\.\.|\{\||\|\}|[{}[\]()*.:=;|?,])|("(\\(\n|\r|\n\r|.)|[^\\"\n\r])*"?)|('(\\(\n|\r|\n\r|.)|[^\\'\n\r])*'?)|($)/g;
  // 1    2             3        4              5  6              7                8       9            10                                 11   13                             14   16                             17

  let group: RegExpExecArray | null;
  let expectedPosition = 0;
  while ((group = re.exec(code)) !== null) {
    const position = re.lastIndex - group[0].length;

    // Check that all the regex matches are consecutive.
    // If there is a gap between two matches, it means that we have an invalid
    // sequence of characters.
    if (position !== expectedPosition) {
      const line = lines.advancePosition(expectedPosition);
      const colNumber = expectedPosition - line.position;
      errors.push({
        token: {
          text: code.substring(expectedPosition, position),
          position: expectedPosition,
          line: line,
          colNumber: colNumber,
        },
        message: "Invalid sequence of characters",
      });
    }
    expectedPosition = re.lastIndex;

    const line = lines.advancePosition(position);
    const colNumber = position - line.position;
    const token = {
      text: group[0],
      position: position,
      line: line,
      colNumber: colNumber,
    };

    // Skip multiline comments.
    if (group[1] !== undefined && !keepComments) {
      // Make sure the multiline comment is terminated.
      if (!group[1].endsWith("*/")) {
        errors.push({
          token: token,
          message: "Unterminated multi-line comment",
        });
      }
      continue;
    }

    // Skip single-line comments.
    if (group[4] !== undefined && !keepComments) {
      continue;
    }

    if (group[8] !== undefined) {
      if (!validateWord(token, errors)) {
        continue;
      }
    }

    // Skip whitespaces.
    if (group[9] !== undefined) continue;

    // Validate string literals.
    const stringLiteral = group[11] || group[14];
    if (stringLiteral !== undefined) {
      if (!stringLiteral.endsWith(stringLiteral[0]!)) {
        errors.push({
          token: token,
          message: "Unterminated string literal",
        });
        continue;
      }
      const stringLiteralRe =
        /^["'](\\(\r\n|u[0-9A-Fa-f]{4}|["'\\/bfnrt\n\r])|[^\\])*["']$/;
      if (!stringLiteralRe.test(stringLiteral)) {
        errors.push({
          token: token,
          message: "String literal contains invalid escape sequence",
        });
        continue;
      }
      // Check that the string doesn't contain lone surrogates.
      // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/isWellFormed
      const unquoted = unquoteAndUnescape(stringLiteral);
      try {
        encodeURIComponent(unquoted);
      } catch {
        errors.push({
          token: token,
          message: "String literal contains lone surrogates",
        });
        continue;
      }
    }

    tokens.push(token);

    if (group[17] !== undefined) {
      // The end of the string has been reached.
      // The last token we added is an empty string.
      break;
    }
  }

  return { result: tokens, errors: errors };
}

function validateWord(token: Token, errors: ErrorSink): boolean {
  if (/^[0-9]/.test(token.text)) {
    errors.push({
      token: token,
      message: "Invalid number",
    });
    return false;
  }

  if (token.text.startsWith("_")) {
    errors.push({
      token: token,
      message: "Identifier cannot start with _",
    });
    return false;
  }
  if (token.text.endsWith("_")) {
    errors.push({
      token: token,
      message: "Identifier cannot end with _",
    });
    return false;
  }
  if (token.text.includes("__")) {
    errors.push({
      token: token,
      message: "Identifier cannot contain __ sequence",
    });
    return false;
  }
  if (/_[0-9]/.test(token.text)) {
    // The problem is we could end up with duplicate field names when converting
    // to camel case. For example: "field0" and "field_0" would both be
    // converted to "field0".
    errors.push({
      token: token,
      message: "Digit cannot follow _",
    });
    return false;
  }

  return true;
}

class Lines {
  /** Splits the given code into multiple lines. */
  constructor(code: string, modulePath: string) {
    const lines = this.lines;
    let lineStart = 0;
    let group: RegExpExecArray | null;
    const re = /\n|\r|\n\r|$/g;
    while ((group = re.exec(code)) !== null) {
      const match = group[0];
      const lineEnd = re.lastIndex - match.length;
      const lineString = code.substring(lineStart, lineEnd);
      lines.push({
        lineNumber: lines.length,
        line: lineString,
        position: lineStart,
        modulePath: modulePath,
      });
      // Record the position after the EOL or EOF.
      lineStart = re.lastIndex;
      if (match === "") {
        break;
      }
    }
  }

  /**
   * Returns the line at the given position, where the position is the char
   * index within `code`.
   * Requires the position to be >= the position given the last time the method
   * was called.
   */
  advancePosition(position: number): CodeLine {
    const lines = this.lines;
    while (lines.length >= 2 && position >= this.lines[1]!.position) {
      lines.shift();
    }
    return lines[0]!;
  }

  private readonly lines: CodeLine[] = [];
}
