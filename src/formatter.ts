// TODO: sort imports
import type { Token } from "./types.js";

export function formatModule(tokens: readonly Token[]): string {
  const sink = new CodeSink();
  let inValue = false;
  let indentDepth = 0;
  const iterator = new TokenIterator(tokens);

  const copyInlineComments = () => {
    while (
      iterator.hasNext() &&
      isComment(iterator.peek().text) &&
      iterator.peek().line.lineNumber === iterator.current.line.lineNumber
    ) {
      // Preserve comments before line break.
      sink.write("  " + iterator.next().text);
    }
  };

  const breakLine = () => {
    copyInlineComments();
    const { lastLineOnlyHasWhitespaces } = sink;
    if (iterator.hasNext()) {
      const current = iterator.current;
      const next = iterator.peek();
      if (next.line.lineNumber >= current.line.lineNumber + 2) {
        // Preserve double line breaks.
        sink.write("\n");
      }
    }
    if (!lastLineOnlyHasWhitespaces) {
      sink.write("\n" + "  ".repeat(indentDepth));
    }
  };

  const breakLineAndIndent = () => {
    ++indentDepth;
    breakLine();
  };

  const unindent = () => {
    --indentDepth;
    sink.removeWhitespaceSuffix("  ");
  };

  while (iterator.hasNext()) {
    const token = iterator.next();
    switch (token.text) {
      case "as":
      case "const":
      case "enum":
      case "import":
      case "method":
      case "struct":
      case "*":
      case ":": {
        sink.write(token.text + " ");
        break;
      }
      case "from": {
        sink.write(" from ");
        break;
      }
      case "removed": {
        if (iterator.hasNext() && iterator.peek().text === ";") {
          sink.write("removed");
        } else {
          sink.write("removed ");
        }
        break;
      }
      case "{": {
        if (iterator.hasNext() && iterator.peek().text === "}") {
          sink.write(inValue ? "{}" : " {}");
          iterator.next();
          if (!inValue) {
            breakLine();
          }
        } else {
          sink.write(inValue ? "{" : " {");
          breakLineAndIndent();
        }
        break;
      }
      case "}": {
        if (inValue) {
          sink.maybeWriteTrailingComma();
          breakLine();
        }
        unindent();
        sink.write("}");
        if (!inValue) {
          breakLine();
        }
        break;
      }
      case "[": {
        if (iterator.hasNext() && iterator.peek().text === "]") {
          sink.write("[]");
          iterator.next();
        } else {
          sink.write("[");
          if (inValue) {
            breakLineAndIndent();
          }
        }
        break;
      }
      case "]": {
        if (inValue) {
          sink.maybeWriteTrailingComma();
          breakLine();
          unindent();
        }
        sink.write("]");
        break;
      }
      case ";": {
        sink.write(";");
        inValue = false;
        breakLine();
        break;
      }
      case "=": {
        inValue = true;
        sink.write(" = ");
        break;
      }
      case ",": {
        if (inValue) {
          sink.write(",");
          breakLine();
        } else {
          sink.write(", ");
        }
        break;
      }
      default: {
        if (isComment(token.text)) {
          sink.writeComment(token.text);
          breakLine();
        } else if (token.text.startsWith("'")) {
          const unescapedDoubleQuoteRegex = /(?:^|[^\\])(?:\\\\)*"/;
          if (unescapedDoubleQuoteRegex.test(token.text)) {
            sink.write(token.text);
          } else {
            // Switch to double quotes.
            const unquoted = token.text.slice(1, -1);
            sink.write(`"${unquoted}"`);
          }
        } else {
          sink.write(token.text);
        }
      }
    }
  }

  const result = sink.code;
  if (indentDepth !== 0) {
    throw new Error(`result=${result}`);
  }

  return result;
}

class TokenIterator {
  private nextIndex = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  next(): Token {
    if (this.nextIndex < this.tokens.length) {
      return this.tokens[this.nextIndex++]!;
    }
    throw new Error();
  }

  peek(): Token {
    if (this.nextIndex < this.tokens.length) {
      return this.tokens[this.nextIndex]!;
    }
    throw new Error();
  }

  hasNext(): boolean {
    return this.nextIndex < this.tokens.length;
  }

  get current(): Token {
    const index = this.nextIndex - 1;
    if (index < this.tokens.length) {
      return this.tokens[index]!;
    }
    throw new Error();
  }
}

function isComment(token: string): boolean {
  return token.startsWith("//") || token.startsWith("/*");
}

class CodeSink {
  private _code: string = "";
  // Position after the last non-whitespace character which is not part of a
  // comment.
  private endPosition = 0;

  /** Writes a token possibly preceded or followed by whitespaces. */
  write(text: string): void {
    const trimmed = text.trim();
    if (trimmed && !isComment(trimmed)) {
      this.endPosition = trimmed.endsWith(",")
        ? 0
        : this.code.length + text.trimEnd().length;
    }
    this._code += text;
  }

  writeComment(text: string): void {
    if (this.lastLineOnlyHasWhitespaces) {
      this._code += text;
    } else {
      this._code = this.code.trimEnd() + "  " + text;
    }
  }

  maybeWriteTrailingComma(): void {
    if (this.endPosition === 0) {
      return;
    }
    const { code } = this;
    this._code =
      code.slice(0, this.endPosition) + "," + code.slice(this.endPosition);
  }

  removeWhitespaceSuffix(suffix: string): void {
    if (this.code.endsWith(suffix)) {
      this._code = this.code.slice(0, -suffix.length);
    }
  }

  get lastLineOnlyHasWhitespaces(): boolean {
    return /^$|\n\s*$/.test(this.code);
  }

  get code(): string {
    return this._code;
  }
}
