import { assert } from "node:console";
import {
  Documentation,
  DocumentationPiece,
  DocumentationReference,
  Result,
  SkirError,
  Token,
} from "./types.js";

export function parseDocComments(
  docComments: readonly Token[],
): Result<Documentation> {
  const parser = new DocCommentsParser(docComments);
  return parser.parse();
}

class DocCommentsParser {
  private readonly pieces: DocumentationPiece[] = [];
  private readonly errors: SkirError[] = [];
  private currentText = "";
  private docCommentIndex = -1;
  private charIndex = -1;
  private contentOffset = -1;

  constructor(private readonly docComments: readonly Token[]) {}

  parse(): Result<Documentation> {
    while (this.nextDocComment()) {
      this.parseCurrentDocComment();
    }

    // Add any remaining text
    if (this.currentText.length > 0) {
      this.pieces.push({ kind: "text", text: this.currentText });
    }

    return {
      result: {
        pieces: this.pieces,
      },
      errors: this.errors,
    };
  }

  private parseCurrentDocComment(): void {
    // Matches unescaped [ or ], OR escaped [[ or ]]
    const specialCharRegex = /\[\[|\]\]|\[|\]/g;

    while (this.charIndex < this.content.length) {
      // Find next special character or escaped bracket
      specialCharRegex.lastIndex = this.charIndex;
      const match = specialCharRegex.exec(this.content);

      if (!match) {
        // No more special characters, add rest as text
        this.currentText += this.content.slice(this.charIndex);
        break;
      }

      // Add text before the special character
      if (match.index > this.charIndex) {
        this.currentText += this.content.slice(this.charIndex, match.index);
      }

      const matched = match[0];
      this.charIndex = match.index;

      if (matched === "[[") {
        // Escaped left bracket
        this.currentText += "[";
        this.charIndex += 2;
      } else if (matched === "]]") {
        // Escaped right bracket
        this.currentText += "]";
        this.charIndex += 2;
      } else if (matched === "[") {
        // Start of a reference - save current text if any
        if (this.currentText.length > 0) {
          this.pieces.push({ kind: "text", text: this.currentText });
          this.currentText = "";
        }

        // Parse the reference
        const reference = this.parseReference();
        this.pieces.push(reference);
      } else if (matched === "]") {
        // Unmatched right bracket - treat as text
        this.currentText += matched;
        this.charIndex++;
      }
    }

    // Add newline between comment lines (except after the last line)
    if (this.docCommentIndex < this.docComments.length - 1) {
      this.currentText += "\n";
    }
  }

  private parseReference(): DocumentationReference {
    const { content, docComment } = this;

    const leftBracketCharIndex = this.charIndex;
    const startPosition = docComment.position + leftBracketCharIndex;

    const rightBracketCharIndex = content.indexOf("]", leftBracketCharIndex);

    // End position: right after the closing bracket or at end of the line if
    // not found.
    const endCharIndex =
      rightBracketCharIndex < 0 ? content.length : rightBracketCharIndex + 1;

    const referenceText = content.slice(leftBracketCharIndex, endCharIndex);
    const referenceRange: Token = {
      text: referenceText,
      originalText: referenceText,
      position: startPosition,
      line: docComment.line,
      colNumber: startPosition - docComment.line.position,
    };

    let hasError = false;
    if (rightBracketCharIndex < 0) {
      hasError = true;
      this.errors.push({
        token: referenceRange,
        message: "Unterminated reference",
      });
    }

    // Move past the left bracket
    this.charIndex++;

    const wordRegex = /[a-zA-Z][_a-zA-Z0-9]*/g;

    const tokens: Token[] = [];
    while (this.charIndex < endCharIndex) {
      const char = content[this.charIndex]!;
      const position = docComment.position + this.charIndex;

      const makeToken = (text: string): Token => ({
        text: text,
        originalText: text,
        position: position,
        line: docComment.line,
        colNumber: position - docComment.line.position,
      });

      if (char === ".") {
        // Dot token
        tokens.push(makeToken("."));
        this.charIndex++;
      } else if (/^[a-zA-Z]/.test(char)) {
        // Start of a word token - use regex to match the whole word
        wordRegex.lastIndex = this.charIndex;
        const match = wordRegex.exec(content);
        const word = match![0];
        tokens.push(makeToken(word));
        this.charIndex += word.length;
      } else if (char === "]") {
        // Reached the end of the reference
        tokens.push(makeToken("]"));
        this.charIndex++;
      } else {
        // Invalid character in reference (including whitespace)
        const column = this.docComment.colNumber + this.charIndex;
        hasError = true;
        this.errors.push({
          token: referenceRange,
          message: `Invalid character in reference at column ${column + 1}`,
        });
        // Exit loop
        this.charIndex = endCharIndex;
      }
    }

    const nameChain = hasError ? [] : this.parseNameChain(tokens);

    return {
      kind: "reference",
      nameChain: nameChain,
      absolute: tokens[0]?.text === ".",
      referee: undefined,
      docComment: this.docComment,
      referenceRange: referenceRange,
    };
  }

  private parseNameChain(tokens: readonly Token[]): Token[] {
    const nameChain: Token[] = [];
    let expect: "identifier" | "identifier or '.'" | "'.' or ']'" =
      "identifier or '.'";
    for (const token of tokens) {
      let expected: boolean;
      if (/^[a-zA-Z]/.test(token.text)) {
        expected = expect === "identifier or '.'" || expect === "identifier";
        expect = "'.' or ']'";
        nameChain.push(token);
      } else if (token.text === ".") {
        expected = expect === "identifier or '.'" || expect === "'.' or ']'";
        expect = "identifier";
      } else {
        assert(token.text === "]");
        expected = expect === "'.' or ']'";
      }
      if (!expected) {
        this.errors.push({
          token: token,
          expected: expect,
        });
        return [];
      }
      if (token.text === "]") {
        return nameChain;
      }
    }
    // An error has already been pushed to signify the unterminated reference.
    return [];
  }

  /// The current doc comment being parsed.
  private get docComment(): Token {
    return this.docComments[this.docCommentIndex]!;
  }

  /// The text of the current doc comment being parsed.
  private get content(): string {
    return this.docComment.text;
  }

  private nextDocComment(): boolean {
    if (this.docCommentIndex < this.docComments.length - 1) {
      this.docCommentIndex++;
      const { content } = this;
      if (content.startsWith("/// ")) {
        this.contentOffset = 4;
      } else if (content.startsWith("///")) {
        this.contentOffset = 3;
      } else {
        throw new Error("Expected doc comment to start with ///");
      }
      this.charIndex = this.contentOffset;
      return true;
    } else {
      return false;
    }
  }
}
