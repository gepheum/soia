import * as casing from "./casing.js";
import type {
  ErrorSink,
  FieldPath,
  Import,
  ImportAlias,
  MutableConstant,
  MutableDeclaration,
  MutableField,
  MutableMethod,
  MutableModule,
  MutableModuleLevelDeclaration,
  MutableObjectEntry,
  MutableRecord,
  MutableRecordLevelDeclaration,
  MutableValue,
  Numbering,
  Primitive,
  Removed,
  Result,
  SoiaError,
  Token,
  UnresolvedArrayType,
  UnresolvedRecordRef,
  UnresolvedType,
} from "./types.js";

/** Runs syntactic analysis on a module. */
export function parseModule(
  tokens: readonly Token[],
  modulePath: string,
): Result<MutableModule> {
  const errors: SoiaError[] = [];
  const it = new TokenIterator(tokens, errors);
  const declarations = parseDeclarations(it, "module");
  it.expectThenMove([""]);
  // Create a mappinng from names to declarations, and check for duplicates.
  const nameToDeclaration: { [name: string]: MutableModuleLevelDeclaration } =
    {};
  for (const declaration of declarations) {
    let nameTokens: Token[];
    if (declaration.kind === "import") {
      nameTokens = declaration.importedNames;
    } else {
      nameTokens = [declaration.name];
    }
    for (const nameToken of nameTokens) {
      const name = nameToken.text;
      if (name in nameToDeclaration) {
        errors.push({
          token: nameToken,
          message: `Duplicate identifier "${name}"`,
        });
      } else {
        nameToDeclaration[name] = declaration;
      }
    }
  }
  const methods = declarations.filter(
    (d): d is MutableMethod => d.kind === "method",
  );
  const constants = declarations.filter(
    (d): d is MutableConstant => d.kind === "constant",
  );
  return {
    result: {
      kind: "module",
      path: modulePath,
      nameToDeclaration: nameToDeclaration,
      declarations: declarations,
      // Will be populated at a later stage.
      pathToImportedNames: {},
      // Will be populated at a later stage.
      records: [],
      methods: methods,
      constants: constants,
    },
    errors: errors,
  };
}

function parseDeclarations(
  it: TokenIterator,
  parentNode: "module",
): MutableModuleLevelDeclaration[];

function parseDeclarations(
  it: TokenIterator,
  parentNode: "struct" | "enum",
): MutableRecordLevelDeclaration[];

function parseDeclarations(
  it: TokenIterator,
  parentNode: "module" | "struct" | "enum",
): MutableDeclaration[] {
  const result: MutableDeclaration[] = [];
  // Returns true on a next token if it indicates that the statement is over.
  const isEndToken = (t: string) =>
    t === "" || (parentNode !== "module" && t === "}");
  // Returns true if the token may be the last token of a valid statement.
  const isLastToken = (t: string) => t === "}" || t === ";";
  while (!isEndToken(it.peek())) {
    const startIndex = it.index;
    const declaration = parseDeclaration(it, parentNode);
    if (declaration !== null) {
      result.push(declaration);
      continue;
    }
    // We have an invalid statement. An error was already registered. Perhaps
    // the statement was parsed entirely but was incorrect (`removed 1, 1;`), or
    // zero tokens were consumed (`a`), or a few tokens were consumed but did
    // not form a statement. We want to recover from whichever scenario to avoid
    // showing unhelpful extra error messages.
    const noTokenWasConsumed = it.index === startIndex;
    if (noTokenWasConsumed) {
      it.next();
      if (isLastToken(it.peekBack())) {
        // For example: two semicolons in a row.
        continue;
      }
    }
    if (
      noTokenWasConsumed ||
      (it.peek() !== "" && !isLastToken(it.peekBack()))
    ) {
      let nestedLevel = 0;
      while (true) {
        const token = it.peek();
        if (token === "") {
          break;
        }
        it.next();
        if (token === "{") {
          ++nestedLevel;
        } else if (token === "}") {
          --nestedLevel;
        }
        if (nestedLevel <= 0 && isLastToken(token)) {
          break;
        }
      }
    }
  }
  return result;
}

function parseDeclaration(
  it: TokenIterator,
  parentNode: "module" | "struct" | "enum",
): MutableDeclaration | null {
  let recordType: "struct" | "enum" = "enum";
  const parentIsRoot = parentNode === "module";
  const expected = [
    /*0:*/ "struct",
    /*1:*/ "enum",
    /*2:*/ parentIsRoot ? null : "removed",
    /*3:*/ parentIsRoot ? null : TOKEN_IS_IDENTIFIER,
    /*4:*/ parentIsRoot ? "import" : null,
    /*5:*/ parentIsRoot ? "method" : null,
    /*6:*/ parentIsRoot ? "const" : null,
  ];
  const match = it.expectThenMove(expected);
  switch (match.case) {
    case 0:
      recordType = "struct";
    // Falls through.
    case 1:
      return parseRecord(it, recordType);
    case 2:
      return parseRemoved(it, match.token);
    case 3:
      return parseField(it, match.token, parentNode as "struct" | "enum");
    case 4:
      return parseImport(it);
    case 5:
      return parseMethod(it);
    case 6:
      return parseConstant(it);
    default:
      return null;
  }
}

class RecordBuilder {
  constructor(
    private readonly recordName: Token,
    private readonly recordType: "struct" | "enum",
    private readonly errors: ErrorSink,
  ) {}

  addDeclaration(declaration: MutableRecordLevelDeclaration): void {
    if (this.numbering === "broken") {
      return;
    }

    let nameToken: Token | undefined;
    let errorToken: Token;
    let numbers: readonly number[] = [];
    let newNumbering = this.numbering;

    // Unless explicitly specified, the number assigned to the first field of an
    // enum is 1.
    const nextImplicitNumber =
      this.numbers.size + (this.recordType === "enum" ? 1 : 0);

    switch (declaration.kind) {
      case "field": {
        nameToken = declaration.name;
        errorToken = nameToken;
        newNumbering = declaration.number < 0 ? "implicit" : "explicit";
        if (declaration.number < 0) {
          declaration = { ...declaration, number: nextImplicitNumber };
        }
        numbers = [declaration.number];
        break;
      }
      case "record": {
        nameToken = declaration.name;
        errorToken = nameToken;
        break;
      }
      case "removed": {
        errorToken = declaration.removedToken;
        if (declaration.numbers.length) {
          newNumbering = "explicit";
          numbers = declaration.numbers;
        } else {
          newNumbering = "implicit";
          numbers = [nextImplicitNumber];
        }
      }
    }

    // Make sure we're not mixing implicit and explicit numbering.
    if (this.numbering === "") {
      this.numbering = newNumbering;
    } else if (this.numbering !== newNumbering) {
      this.errors.push({
        token: errorToken,
        message: "Cannot mix implicit and explicit numbering",
      });
      this.numbering = "broken";
    }

    // Register the record/field name and make sure it's unique.
    if (nameToken !== undefined) {
      const name = nameToken.text;
      if (name in this.nameToDeclaration) {
        this.errors.push({
          token: nameToken,
          message: `Duplicate identifier "${name}"`,
        });
        return;
      }
      this.nameToDeclaration[name] = declaration;
    }

    // Register the field number and make sure it's unique.
    for (const number of numbers) {
      if (this.numbers.has(number)) {
        this.errors.push({
          token: errorToken,
          message: `Duplicate field number ${number}`,
        });
        this.numbering = "broken";
        return;
      } else if (number === 0 && this.recordType === "enum") {
        this.errors.push({
          token: errorToken,
          message: "Number 0 is reserved for UNKNOWN field",
        });
        return;
      }
      this.numbers.add(number);
    }

    // Register the removed field numbers.
    if (declaration.kind === "removed") {
      this.removedNumbers.push(...numbers);
    }
  }

  build(): MutableRecord {
    const isStruct = this.recordType === "struct";

    // If the record is a struct, make sure that all field numbers are
    // consecutive starting from 0. The fields of an enum, on the other hand,
    // can be sparse.
    if (isStruct) {
      for (let i = 0; i < this.numbers.size; ++i) {
        if (this.numbers.has(i)) {
          continue;
        }
        this.errors.push({
          token: this.recordName,
          message: `Missing field number ${i}`,
        });
        break;
      }
    }

    const declarations = Object.values(this.nameToDeclaration);
    const fields = declarations.filter(
      (d): d is MutableField => d.kind === "field",
    );
    const nestedRecords = declarations.filter(
      (d): d is MutableRecord => d.kind === "record",
    );

    const { recordName } = this;
    const key = `${recordName.line.modulePath}:${recordName.position}`;

    const numSlots =
      isStruct && fields.length
        ? Math.max(...fields.map((f) => f.number)) + 1
        : 0;
    const numSlotsInclRemovedNumbers = isStruct ? this.numbers.size : 0;

    return {
      kind: "record",
      key: key,
      name: this.recordName,
      recordType: this.recordType,
      nameToDeclaration: this.nameToDeclaration,
      declarations: Object.values(this.nameToDeclaration),
      fields: fields,
      nestedRecords: nestedRecords,
      numbering: this.numbering,
      removedNumbers: this.removedNumbers.sort(),
      numSlots: numSlots,
      numSlotsInclRemovedNumbers: numSlotsInclRemovedNumbers,
    };
  }

  private nameToDeclaration: { [n: string]: MutableRecordLevelDeclaration } =
    {};
  private numbers = new Set<number>();
  private numbering: Numbering = "";
  private removedNumbers: number[] = [];
}

function parseRecord(
  it: TokenIterator,
  recordType: "struct" | "enum",
): MutableRecord | null {
  // A struct or an enum.
  const nameMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
  if (nameMatch.case < 0) {
    return null;
  }
  casing.validate(nameMatch.token, "UpperCamel", it.errors);
  if (it.expectThenMove(["{"]).case < 0) {
    return null;
  }
  const declarations = parseDeclarations(it, recordType);
  it.expectThenMove(["}"]);
  const builder = new RecordBuilder(nameMatch.token, recordType, it.errors);
  for (const declaration of declarations) {
    builder.addDeclaration(declaration);
  }
  return builder.build();
}

function parseField(
  it: TokenIterator,
  name: Token,
  recordType: "struct" | "enum",
): MutableField | null {
  // May only be undefined if the type is an enum.
  let type: UnresolvedType | undefined = undefined;
  let number = -1;

  while (true) {
    const typeAllowed = type === undefined && number < 0;
    const endAllowed = type !== undefined || recordType === "enum";
    const numberAllowed = number < 0 && endAllowed;
    const expected = [
      /*0:*/ typeAllowed ? ":" : null,
      /*1:*/ numberAllowed ? "=" : null,
      /*2:*/ endAllowed ? ";" : null,
    ];
    const match = it.expectThenMove(expected);
    switch (match.case) {
      case 0: {
        type = parseType(it);
        if (type === undefined) {
          return null;
        }
        break;
      }
      case 1: {
        number = parseInt(it);
        if (number < 0) {
          return null;
        }
        break;
      }
      case 2: {
        const expectedCasing = type ? "lower_underscore" : "UPPER_UNDERSCORE";
        casing.validate(name, expectedCasing, it.errors);
        if (recordType === "enum" && name.text === "UNKNOWN") {
          it.errors.push({
            token: name,
            message: `Cannot name field of enum: UNKNOWN`,
          });
          return null;
        }
        return {
          kind: "field",
          name: name,
          number: number,
          unresolvedType: type,
          // Will be populated at a later stage.
          type: undefined,
          // Will be populated at a later stage.
          isRecursive: false,
        };
      }
      case -1:
        return null;
    }
  }
}

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set<Primitive>([
  "bool",
  "int32",
  "int64",
  "uint64",
  "float32",
  "float64",
  "timestamp",
  "string",
  "bytes",
]);

function parseType(it: TokenIterator): UnresolvedType | undefined {
  const match = it.expectThenMove([
    /*0:*/ "[",
    /*1:*/ TOKEN_IS_IDENTIFIER,
    /*2:*/ ".",
  ]);
  let value: UnresolvedType | undefined;
  switch (match.case) {
    case 0: {
      // Left square bracket.
      value = parseArrayType(it);
      break;
    }
    case 1:
      // An identifier.
      if (PRIMITIVE_TYPES.has(match.token.text)) {
        value = {
          kind: "primitive",
          primitive: match.token.text as Primitive,
        };
        break;
      }
    // Falls through.
    case 2: {
      // Dot.
      value = parseRecordRef(it, match.token);
      break;
    }
    default:
      return undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  if (it.peek() === "?") {
    it.next();
    return { kind: "optional", other: value };
  } else {
    return value;
  }
}

function parseArrayType(it: TokenIterator): UnresolvedArrayType | undefined {
  const item = parseType(it);
  if (item === undefined) {
    return undefined;
  }
  let key: FieldPath | undefined = undefined;
  while (true) {
    const keyAllowed = !key && item.kind === "record";
    const match = it.expectThenMove([
      /*0:*/ keyAllowed ? "|" : null,
      /*1:*/ "]",
    ]);
    switch (match.case) {
      case 0: {
        // '|'
        key = parseFieldPath(it, match.token);
        if (key === null) {
          return undefined;
        }
        break;
      }
      case 1:
        return { kind: "array", item: item, key: key };
      default:
        return undefined;
    }
  }
}

function parseFieldPath(
  it: TokenIterator,
  pipeToken: Token,
): FieldPath | undefined {
  const fieldNames: Token[] = [];
  while (true) {
    const match = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    fieldNames.push(match.token);
    if (it.peek() === ".") {
      it.next();
    } else {
      break;
    }
  }
  return {
    pipeToken: pipeToken,
    fieldNames: fieldNames,
    // Just because we need to provide a value.
    // The correct value will be populated at a later stage.
    keyType: { kind: "primitive", primitive: "bool" },
  };
}

function parseRecordRef(
  it: TokenIterator,
  nameOrDot: Token,
): UnresolvedRecordRef | undefined {
  const absolute = nameOrDot.text === ".";
  const nameParts: Token[] = [];
  if (nameOrDot.text === ".") {
    const match = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    nameParts.push(match.token);
  } else {
    nameParts.push(nameOrDot);
  }
  while (it.peek() === ".") {
    it.next();
    const match = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    nameParts.push(match.token);
  }
  return { kind: "record", nameParts: nameParts, absolute: absolute };
}

function parseInt(it: TokenIterator): number {
  const match = it.expectThenMove([TOKEN_IS_INT]);
  return match.case == 0 ? +match.token.text : -1;
}

// Parses the "removed" declaration.
// Assumes the current token is the token after "removed".
function parseRemoved(it: TokenIterator, removedToken: Token): Removed | null {
  const numbers: number[] = [];
  // The 3 states are:
  //   · '?': expect a number or a semicolon
  //   · ',': expect a comma or a semicolon
  //   · '0': expect a single number or the lower bound of a range
  let expect: "?" | "," | "0" = "?";
  loop: while (true) {
    const expected: Array<string | TokenPredicate | null> = [
      /*0:*/ expect === "," ? "," : null,
      /*1:*/ expect === "?" || expect === "0" ? TOKEN_IS_INT : null,
      /*3:*/ expect === "?" || expect === "," ? ";" : null,
    ];
    const match = it.expectThenMove(expected);
    switch (match.case) {
      case 0: {
        // A comma.
        expect = "0";
        break;
      }
      case 1: {
        // A number.
        const number = +match.token.text;
        expect = ",";
        numbers.push(number);
        break;
      }
      case 2: {
        // A semicolon.
        break loop;
      }
      case -1:
        return null;
    }
  }
  // Make sure we don't have a duplicate number.
  const seenNumbers = new Set<number>();
  for (const number of numbers) {
    if (seenNumbers.has(number)) {
      it.errors.push({
        token: removedToken,
        message: `Duplicate field number ${number}`,
      });
      return null;
    }
    seenNumbers.add(number);
  }

  return {
    kind: "removed",
    removedToken: removedToken,
    numbers: numbers,
  };
}

function parseImport(it: TokenIterator): Import | ImportAlias | null {
  const tokenMatch = it.expectThenMove(["*", TOKEN_IS_IDENTIFIER]);
  switch (tokenMatch.case) {
    case 0:
      return parseImportAs(it);
    case 1:
      return parseImportGivenNames(tokenMatch.token, it);
    default:
      return null;
  }
}

function parseImportAs(it: TokenIterator): ImportAlias | null {
  if (it.expectThenMove(["as"]).case < 0) return null;
  const aliasMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
  if (aliasMatch.case < 0) {
    return null;
  }
  casing.validate(aliasMatch.token, "lower_underscore", it.errors);
  if (it.expectThenMove(["from"]).case < 0) return null;
  const modulePathMatch = it.expectThenMove([TOKEN_IS_STRING_LITERAL]);
  if (modulePathMatch.case < 0) {
    return null;
  }
  it.expectThenMove([";"]);
  return {
    kind: "import-alias",
    name: aliasMatch.token,
    modulePath: modulePathMatch.token,
  };
}

function parseImportGivenNames(
  firstName: Token,
  it: TokenIterator,
): Import | null {
  const importedNames = [firstName];
  while (it.peek() === ",") {
    it.next();
    const nameMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
    if (nameMatch.case < 0) {
      return null;
    }
    importedNames.push(nameMatch.token);
  }
  if (it.expectThenMove(["from"]).case < 0) return null;
  const modulePathMatch = it.expectThenMove([TOKEN_IS_STRING_LITERAL]);
  if (modulePathMatch.case < 0) {
    return null;
  }
  it.expectThenMove([";"]);
  return {
    kind: "import",
    importedNames,
    modulePath: modulePathMatch.token,
  };
}

function parseMethod(it: TokenIterator): MutableMethod | null {
  const nameMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
  if (nameMatch.case < 0) {
    return null;
  }
  casing.validate(nameMatch.token, "UpperCamel", it.errors);
  if (it.expectThenMove(["("]).case < 0) {
    return null;
  }
  const requestType = parseType(it);
  if (!requestType) {
    return null;
  }
  if (it.expectThenMove([")"]).case < 0 || it.expectThenMove([":"]).case < 0) {
    return null;
  }
  const responseType = parseType(it);
  if (!responseType) {
    return null;
  }

  let number: number | undefined;
  if (it.expectThenMove(["=", ";"]).case === 0) {
    number = parseInt(it);
    if (number < 0) {
      return null;
    }
    it.expectThenMove([";"]);
  }
  if (number === undefined) {
    number = simpleHash(nameMatch.token.text);
  }

  return {
    kind: "method",
    name: nameMatch.token,
    unresolvedRequestType: requestType,
    unresolvedResponseType: responseType,
    // Will be populated at a later stage.
    requestType: undefined,
    // Will be populated at a later stage.
    responseType: undefined,
    number: number,
  };
}

function parseConstant(it: TokenIterator): MutableConstant | null {
  const nameMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
  if (nameMatch.case < 0) {
    return null;
  }
  casing.validate(nameMatch.token, "UPPER_UNDERSCORE", it.errors);
  if (it.expectThenMove([":"]).case < 0) {
    return null;
  }
  const type = parseType(it);
  if (!type) {
    return null;
  }
  if (it.expectThenMove(["="]).case < 0) {
    return null;
  }
  const value = parseValue(it);
  if (value === null) {
    return null;
  }
  it.expectThenMove([";"]);
  return {
    kind: "constant",
    name: nameMatch.token,
    unresolvedType: type,
    type: undefined,
    value: value,
    valueAsDenseJson: undefined,
  };
}

function parseValue(it: TokenIterator): MutableValue | null {
  const expected = [
    /*0:*/ "{",
    /*1:*/ "[",
    /*2:*/ "false",
    /*3:*/ "true",
    /*4:*/ "null",
    /*5:*/ TOKEN_IS_NUMBER,
    /*6:*/ TOKEN_IS_STRING_LITERAL,
  ];
  const match = it.expectThenMove(expected);
  switch (match.case) {
    case 0: {
      const entries = parseObjectValue(it);
      if (entries === null) {
        return null;
      }
      return {
        kind: "object",
        token: match.token,
        entries: entries,
      };
    }
    case 1: {
      const items = parseArrayValue(it);
      if (items === null) {
        return null;
      }
      return {
        kind: "array",
        token: match.token,
        items: items,
      };
    }
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return {
        kind: "literal",
        token: match.token,
      };
    default:
      return null;
  }
}

function parseObjectValue(
  it: TokenIterator,
): { [f: string]: MutableObjectEntry } | null {
  if (it.peek() === "}") {
    it.next();
    return {};
  }
  const entries: { [f: string]: MutableObjectEntry } = {};
  while (true) {
    const fieldNameMatch = it.expectThenMove([TOKEN_IS_IDENTIFIER]);
    if (fieldNameMatch.case < 0) {
      return null;
    }
    const fieldNameToken = fieldNameMatch.token;
    const fieldName = fieldNameMatch.token.text;
    if (it.expectThenMove([":"]).case < 0) {
      return null;
    }
    const value = parseValue(it);
    if (value === null) {
      return null;
    }
    if (fieldName in entries) {
      it.errors.push({
        token: fieldNameMatch.token,
        message: "Duplicate field",
      });
    }
    entries[fieldName] = {
      name: fieldNameToken,
      value: value,
    };
    const endMatch = it.expectThenMove([",", "}"]);
    if (endMatch.case < 0) {
      return null;
    }
    if (endMatch.token.text === "}") {
      return entries;
    }
    if (it.peek() === "}") {
      it.next();
      return entries;
    }
  }
}

function parseArrayValue(it: TokenIterator): MutableValue[] | null {
  if (it.peek() === "]") {
    it.next();
    return [];
  }
  const items: MutableValue[] = [];
  while (true) {
    const item = parseValue(it);
    if (item === null) {
      return null;
    }
    items.push(item);
    const match = it.expectThenMove([",", "]"]);
    if (match.case < 0) {
      return null;
    }
    if (match.token.text === "]") {
      return items;
    }
    if (it.peek() === "]") {
      it.next();
      return items;
    }
  }
}

abstract class TokenPredicate {
  abstract matches(token: string): boolean;
  abstract what(): string;
}

class TokenIsIdentifier extends TokenPredicate {
  override matches(token: string): boolean {
    return /^\w/.test(token);
  }

  override what() {
    return "identifier";
  }
}

const TOKEN_IS_IDENTIFIER = new TokenIsIdentifier();

class TokenIsInt extends TokenPredicate {
  override matches(token: string): boolean {
    return /^[0-9]+$/.test(token);
  }

  override what() {
    return "number";
  }
}

const TOKEN_IS_INT = new TokenIsInt();

class TokenIsNumber extends TokenPredicate {
  override matches(token: string): boolean {
    return /^[0-9]/.test(token);
  }

  override what() {
    return "number";
  }
}

const TOKEN_IS_NUMBER = new TokenIsNumber();

class TokenIsStringLiteral extends TokenPredicate {
  override matches(token: string): boolean {
    return /^["']/.test(token);
  }

  override what() {
    return "string literal";
  }
}

const TOKEN_IS_STRING_LITERAL = new TokenIsStringLiteral();

interface TokenMatch {
  case: number;
  token: Token;
}

class TokenIterator {
  constructor(
    private readonly tokens: readonly Token[],
    readonly errors: ErrorSink,
  ) {}

  // Returns both:
  //   · the index of the first predicate matching the current token, or -1 if
  //       there is none
  //   · the current token (before the move)
  //
  // If the current token matches any predicate, i.e. if the index is not -1,
  // moves to the next token before returning. Otherwise, registers an error.
  expectThenMove(
    expected: ReadonlyArray<string | TokenPredicate | null>,
  ): TokenMatch {
    const token = this.tokens[this.tokenIndex]!;
    for (let i = 0; i < expected.length; ++i) {
      const e = expected[i];
      if (e === null) {
        continue;
      }
      const match =
        e instanceof TokenPredicate ? e.matches(token.text) : token.text === e;
      if (!match) {
        continue;
      }
      ++this.tokenIndex;
      return {
        case: i,
        token: token,
      };
    }

    // No match: register an error.
    const expectedParts: string[] = [];
    for (let i = 0; i < expected.length; ++i) {
      const e = expected[i];
      if (e === null) {
        continue;
      }
      expectedParts.push(e instanceof TokenPredicate ? e.what() : `"${e}"`);
    }
    const expectedMsg =
      expectedParts.length === 1
        ? expectedParts[0]!
        : `one of: ${expectedParts.join(", ")}`;

    this.errors.push({
      token: token,
      expected: expectedMsg,
    });

    return {
      case: -1,
      token: token,
    };
  }

  peek(): string {
    return this.tokens[this.tokenIndex]!.text;
  }

  peekBack(): string {
    return this.tokens[this.tokenIndex - 1]!.text;
  }

  next(): void {
    ++this.tokenIndex;
  }

  get index(): number {
    return this.tokenIndex;
  }

  private tokenIndex = 0;
}

/** Returns a uint32 hash of the given string. */
export function simpleHash(input: string): number {
  // From https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  // Signed int32 to unsigned int32.
  return hash >>> 0;
}
