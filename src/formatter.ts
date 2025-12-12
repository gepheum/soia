import { ModuleTokens } from "./tokenizer.js";
import type { Token } from "./types.js";

/**
 * Formats the given module and returns the new source code.
 * Preserves token ordering and number of tokens.
 */
export function formatModule(moduleTokens: ModuleTokens): string {
  const tokens = moduleTokens.tokensWithComments;

  const context: Context = {
    context: null,
    indentStack: [{ indent: "" }],
  };

  let result = normalizeToken(tokens[0]!.text, "");

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
    const topOfStack = context.indentStack.at(-1)!;
    if (space === "\n" || space === "\n\n") {
      space = space + topOfStack.indent;
    }

    // Add trailing comma if needed
    if (shouldAddTrailingComma(token, nextNonComment!, context)) {
      result += ",";
    }

    result += space + normalizeToken(next.text, topOfStack.indent);
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
  const topOfStack: () => IndentStackItem = () => context.indentStack.at(-1)!;

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

function normalizeToken(token: string, indent: string): string {
  if (token.startsWith("//")) {
    // Make sure there is a space between the double slash and the comment text.
    if (
      token.startsWith("// ") ||
      token.startsWith("/// ") ||
      token === "//" ||
      token === "///"
    ) {
      return token;
    } else if (token.startsWith("///")) {
      return "/// " + token.slice(3);
    } else {
      return "// " + token.slice(2);
    }
  } else if (token.startsWith("'")) {
    // A single-quoted string
    if (token.includes('"')) {
      // Remove escape characters before single quotes.
      return token.replace(/\\(?=(?:\\\\)*')/g, "");
    } else {
      // If the string does not contain double quotes, turn it into a
      // double-quoted string for consistency
      const content = token.slice(1, -1);
      // Remove escape characters before double quotes.
      return '"' + content.replace(/\\(?=(?:\\\\)*")/g, "") + '"';
    }
  } else if (token.startsWith('"')) {
    // A double-quoted string
    // Remove escape characters before double quotes.
    return token.replace(/\\(?=(?:\\\\)*')/g, "");
  } else {
    return token;
  }
}
