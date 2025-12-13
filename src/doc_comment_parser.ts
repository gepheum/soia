import {
  Documentation,
  DocumentationPiece,
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
        // Escaped opening bracket
        this.currentText += "[";
        this.charIndex += 2;
      } else if (matched === "]]") {
        // Escaped closing bracket
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
        if (reference) {
          this.pieces.push(reference);
        }
      } else if (matched === "]") {
        // Unmatched closing bracket - treat as text
        this.currentText += matched;
        this.charIndex++;
      }
    }

    // Add newline between comment lines (except after the last line)
    if (this.docCommentIndex < this.docComments.length - 1) {
      this.currentText += "\n";
    }
  }

  private parseReference(): DocumentationPiece | null {
    const referenceTokens: Token[] = [];
    const openBracketDocComment = this.docComment;
    const openBracketCharIndex = this.charIndex;

    // Move past the opening bracket
    this.charIndex++;

    const wordRegex = /[a-zA-Z][_a-zA-Z0-9]*/g;
    const whitespaceRegex = /[ \t]*/g;

    while (true) {
      while (this.charIndex < this.content.length) {
        // Skip whitespace
        whitespaceRegex.lastIndex = this.charIndex;
        const whitespaceMatch = whitespaceRegex.exec(this.content);
        if (whitespaceMatch && whitespaceMatch[0].length > 0) {
          this.charIndex += whitespaceMatch[0].length;
        }

        if (this.charIndex >= this.content.length) break;

        const char = this.content[this.charIndex]!;

        if (char === "]") {
          // End of reference
          this.charIndex++;

          if (referenceTokens.length === 0) {
            this.addError(
              openBracketDocComment,
              openBracketCharIndex,
              "Empty reference",
            );
            return null;
          }

          return { kind: "reference", tokens: referenceTokens };
        } else if (char === ".") {
          // Dot token
          const position = this.docComment.position + this.charIndex;
          referenceTokens.push({
            text: ".",
            originalText: ".",
            position: position,
            line: this.docComment.line,
            colNumber: position - this.docComment.line.position,
          });
          this.charIndex++;
        } else if (/^[a-zA-Z]/.test(char)) {
          // Start of a word token - use regex to match the whole word
          wordRegex.lastIndex = this.charIndex;
          const match = wordRegex.exec(this.content);
          const word = match![0];
          const position = this.docComment.position + this.charIndex;
          referenceTokens.push({
            text: word,
            originalText: word,
            position: position,
            line: this.docComment.line,
            colNumber: position - this.docComment.line.position,
          });
          this.charIndex += word.length;
        } else {
          // Invalid character in reference
          const position = this.docComment.position + this.charIndex;
          this.errors.push({
            token: {
              text: char,
              originalText: char,
              position: position,
              line: this.docComment.line,
              colNumber: position - this.docComment.line.position,
            },
            message: `Invalid character '${char}' in reference`,
          });
          this.charIndex++;
          return null;
        }
      }

      // Reached end of line, check if there's a next line
      if (!this.nextDocComment()) {
        // Unterminated reference
        this.addError(
          openBracketDocComment,
          openBracketCharIndex,
          "Unterminated reference",
        );
        return null;
      }
    }
  }

  private addError(
    docComment: Token,
    charIndex: number,
    message: string,
  ): void {
    const position = docComment.position + charIndex;
    this.errors.push({
      token: {
        text: "[",
        originalText: "[",
        position: position,
        line: docComment.line,
        colNumber: position - docComment.line.position,
      },
      message: message,
    });
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
