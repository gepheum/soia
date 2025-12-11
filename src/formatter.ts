// TODO: save the position
// TODO normalization:
//   - string quotes normalization
//   - make sure there is a space after "// "

import { ModuleTokens } from "./tokenizer.js";
import type { Token } from "./types.js";

export function formatModule(moduleTokens: ModuleTokens): string {
  const tokens = moduleTokens.tokensWithComments;

  const context: Context = {
    context: null,
    indentStack: [{ indent: "" }],
  };

  let result = tokens[0]!.text;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i - 1]!;
    const next = tokens[i]!;

    // Find the next non-comment token
    let nextNonComment = next;
    for (let j = i; j < tokens.length; j++) {
      const token = tokens[j]!;
      if (!isComment(token)) {
        nextNonComment = token;
        break;
      }
    }

    let space = getWhitespaceAfterToken(token, next, nextNonComment!, context);
    if (space === "\n" || space === "\n\n") {
      const topOfStack = context.indentStack.at(-1)!;
      space = space + topOfStack.indent;
    }

    // Add trailing comma if needed
    if (shouldAddTrailingComma(token, nextNonComment!, context)) {
      result += ",";
    }

    result += space + next.text;
  }

  return result;
}

type Context = {
  context:
    | "const" // Between 'const' and '='
    | "in-value" // After 'const', between '=' and ';'
    | "removed" // Between 'removed' and ';'
    | null;
  readonly indentStack: IndentStackItem[];
};

interface IndentStackItem {
  indent: string;
  // If true, the new indentation level is for the declaration of an inline
  // record as a method request type:
  //    method GetFoo(
  //      struct {
  //        ...
  //      }
  //    ): Foo;
  inlineRecordInBracket?: true;
}

function getWhitespaceAfterToken(
  token: Token,
  next: Token,
  // If 'next' is a comment, the next non-comment token after 'next'.
  // Otherwise, 'next' itself.
  nextNonComment: Token,
  context: Context,
): "" | " " | "  " | "\n" | "\n\n" {
  const topOfStack = () => context.indentStack.at(-1)!;

  const indentUnit = "  ";
  if (
    token.text === "{" ||
    token.text === "{|" ||
    (context.context === "in-value" && token.text === "[")
  ) {
    context.indentStack.push({
      indent: topOfStack().indent + indentUnit,
    });
  } else if (
    token.text === "(" &&
    ["struct", "enum"].includes(nextNonComment.text)
  ) {
    context.indentStack.push({
      indent: topOfStack().indent + indentUnit,
      inlineRecordInBracket: true,
    });
  }

  if (
    next.text === "}" ||
    next.text === "|}" ||
    (context.context === "in-value" && next.text === "]") ||
    (next.text === ")" && topOfStack().inlineRecordInBracket)
  ) {
    context.indentStack.pop();
  }

  if (isComment(token)) {
    return oneOrTwoLineBreaks(token, next);
  } else if (
    token.text !== "{" &&
    next.text === "}" &&
    context.context !== "in-value"
  ) {
    return "\n";
  } else if (isComment(next)) {
    return token.line.lineNumber === next.line.lineNumber
      ? "  "
      : oneOrTwoLineBreaks(token, next);
  } else if (next.text === "=") {
    return " ";
  } else if (
    (token.text === "[" && next.text === "]") ||
    (token.text === "{" && next.text === "}") ||
    (token.text === "{|" && next.text === "|}")
  ) {
    return "";
  } else if (["{", "{|"].includes(token.text)) {
    return "\n";
  } else if (token.text === "[") {
    return context.context === "in-value" ? "\n" : "";
  } else if (["*", ":"].includes(token.text)) {
    return " ";
  } else if (token.text === "(") {
    return ["struct", "enum"].includes(next.text) ? "\n" : "";
  } else if (token.text === ")") {
    return next.text === "{" ? " " : "";
  } else if (token.text === ";") {
    context.context = null;
    return oneOrTwoLineBreaks(token, next);
  } else if (token.text === "}") {
    return [",", ";"].includes(next.text)
      ? ""
      : oneOrTwoLineBreaks(token, next);
  } else if (token.text === ",") {
    return context.context === "removed" ? " " : "\n";
  } else if (token.text === "=") {
    if (context.context === "const") {
      context.context = "in-value";
    }
    return " ";
  } else if (token.text === "const") {
    context.context = "const";
    return " ";
  } else if (token.text === "removed") {
    context.context = "removed";
    return next.text === ";" ? "" : " ";
  } else if (
    context.context === "in-value" &&
    ["]", "}", "|}"].includes(next.text)
  ) {
    return "\n";
  } else if (
    /^[A-Za-z]/.test(token.text) &&
    !["(", ":", ",", ";", "|", ".", ")", "]", "?"].includes(next.text)
  ) {
    return " ";
  } else {
    return "";
  }
}

function shouldAddTrailingComma(
  first: Token,
  nextNonComment: Token,
  context: Context,
): boolean {
  return (
    context.context === "in-value" &&
    ["]", "}", "|}"].includes(nextNonComment.text) &&
    !["[", "{", "{|", ","].includes(first.text)
  );
}

function oneOrTwoLineBreaks(first: Token, second: Token): "\n" | "\n\n" {
  const firstLineNumber =
    first.line.lineNumber + first.originalText.split("\n").length - 1;
  if (
    firstLineNumber < second.line.lineNumber - 1 &&
    (isComment(second) || /^[A-Za-z]/.test(second.text))
  ) {
    return "\n\n";
  } else {
    return "\n";
  }
}

function isComment(token: Token): boolean {
  return token.text.startsWith("//") || token.text.startsWith("/*");
}
