import * as casing from "./casing.js";
import { parseDocComments } from "./doc_comment_parser.js";
import { ModuleTokens } from "./tokenizer.js";
import type {
  Declaration,
  Documentation,
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
  MutableRecordLocation,
  MutableValue,
  Numbering,
  Primitive,
  Record,
  Removed,
  Result,
  SkirError,
  Token,
  UnresolvedArrayType,
  UnresolvedRecordRef,
  UnresolvedType,
} from "./types.js";

/** Runs syntactic analysis on a module. */
export function parseModule(moduleTokens: ModuleTokens): Result<MutableModule> {
  const { tokens, modulePath, sourceCode } = moduleTokens;
  const errors: SkirError[] = [];
  const it = new TokenIterator(tokens, errors);
  const declarations = parseDeclarations(it, "module");
  it.expectThenNext([""]);
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
          message: `Duplicate identifier '${name}'`,
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
      sourceCode: sourceCode,
      nameToDeclaration: nameToDeclaration,
      declarations: declarations,
      // Populated right below.
      records: collectModuleRecords(declarations),
      pathToImportedNames: {},
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
  const isEndToken = (t: string): boolean =>
    t === "" || (parentNode !== "module" && t === "}");
  // Returns true if the token may be the last token of a valid statement.
  const isLastToken = (t: string): boolean => t === "}" || t === ";";
  while (!isEndToken(it.current)) {
    const startIndex = it.index;
    const declaration = parseDeclaration(it, parentNode);
    if (declaration !== null) {
      result.push(declaration);
      if (declaration.kind === "method") {
        if (declaration.inlineRequestRecord) {
          result.push(declaration.inlineRequestRecord);
        }
        if (declaration.inlineResponseRecord) {
          result.push(declaration.inlineResponseRecord);
        }
      }
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
      if (isLastToken(it.previous)) {
        // For example: two semicolons in a row.
        continue;
      }
    }
    if (
      noTokenWasConsumed ||
      (it.current !== "" && !isLastToken(it.previous))
    ) {
      let nestedLevel = 0;
      while (true) {
        const token = it.current;
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
  const documentation = parseDocumentation(it);
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
  const match = it.expectThenNext(expected);
  switch (match.case) {
    case 0:
      recordType = "struct";
    // Falls through.
    case 1:
      return parseRecord(it, recordType, documentation);
    case 2:
      return parseRemoved(it, match.token);
    case 3:
      return parseField(
        it,
        match.token,
        documentation,
        parentNode as "struct" | "enum",
      );
    case 4:
      return parseImport(it);
    case 5:
      return parseMethod(it, documentation);
    case 6:
      return parseConstant(it, documentation);
    default:
      return null;
  }
}

class RecordBuilder {
  constructor(
    private readonly recordName: Token,
    private readonly recordType: "struct" | "enum",
    private readonly documentation: Documentation,
    private readonly stableId: number | null,
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
          message: `Duplicate identifier '${name}'`,
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
      documentation: this.documentation,
      nameToDeclaration: this.nameToDeclaration,
      declarations: Object.values(this.nameToDeclaration),
      fields: fields,
      nestedRecords: nestedRecords,
      numbering: this.numbering,
      removedNumbers: this.removedNumbers.sort(),
      recordNumber: this.stableId,
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

interface InlineRecordContext {
  context: "field" | "method-request" | "method-response";
  /** Name of the field or method. */
  originalName: Token;
}

function parseRecord(
  it: TokenIterator,
  recordType: "struct" | "enum",
  documentation: Documentation,
  inlineContext?: InlineRecordContext,
): MutableRecord | null {
  // A struct or an enum.
  let nameToken: Token;
  if (inlineContext) {
    const { originalName } = inlineContext;
    let transformedName = casing.convertCase(originalName.text, "UpperCamel");
    if (inlineContext.context === "method-request") {
      transformedName += "Request";
    } else if (inlineContext.context === "method-response") {
      transformedName += "Response";
    }
    nameToken = {
      ...originalName,
      text: transformedName,
    };
  } else {
    // Read the name.
    const nameMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (nameMatch.case < 0) {
      return null;
    }
    casing.validate(nameMatch.token, "UpperCamel", it.errors);
    nameToken = nameMatch.token;
  }
  let stableId: number | null = null;
  if (it.current === "(") {
    it.next();
    stableId = parseUint32(it);
    if (stableId < 0) {
      return null;
    }
    if (it.expectThenNext([")"]).case < 0) {
      return null;
    }
  }
  if (it.expectThenNext(["{"]).case < 0) {
    return null;
  }
  const declarations = parseDeclarations(it, recordType);
  it.expectThenNext(["}"]);
  const builder = new RecordBuilder(
    nameToken,
    recordType,
    documentation,
    stableId,
    it.errors,
  );
  for (const declaration of declarations) {
    builder.addDeclaration(declaration);
    if (declaration.kind === "field" && declaration.inlineRecord) {
      builder.addDeclaration(declaration.inlineRecord);
    }
  }
  return builder.build();
}

function parseField(
  it: TokenIterator,
  name: Token,
  documentation: Documentation,
  recordType: "struct" | "enum",
): MutableField | null {
  // May only be undefined if the type is an enum.
  let type: UnresolvedType | undefined;
  let inlineRecord: MutableRecord | undefined;
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
    const match = it.expectThenNext(expected);
    switch (match.case) {
      case 0: {
        const inlineContext: InlineRecordContext = {
          context: "field",
          originalName: name,
        };
        const typeOrInlineRecord = parseTypeOrInlineRecord(it, inlineContext);
        type = typeOrInlineRecord.type;
        inlineRecord = typeOrInlineRecord.inlineRecord;
        if (type === undefined) {
          return null;
        }
        break;
      }
      case 1: {
        number = parseUint32(it);
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
          documentation: documentation,
          unresolvedType: type,
          // Will be populated at a later stage.
          type: undefined,
          // Will be populated at a later stage.
          isRecursive: false,
          inlineRecord: inlineRecord,
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

function parseTypeOrInlineRecord(
  it: TokenIterator,
  inlineContext: InlineRecordContext,
): {
  type: UnresolvedType | undefined;
  inlineRecord: MutableRecord | undefined;
} {
  if (it.current === "struct" || it.current === "enum") {
    const recordType = it.current as "struct" | "enum";
    it.next();
    const inlineRecord = parseRecord(it, recordType, EMPTY_DOC, inlineContext);
    const type: UnresolvedRecordRef | undefined = inlineRecord
      ? {
          kind: "record",
          nameParts: [inlineRecord.name],
          absolute: false,
        }
      : undefined;
    return {
      type: type,
      inlineRecord: inlineRecord ? inlineRecord : undefined,
    };
  } else {
    return {
      type: parseType(it),
      inlineRecord: undefined,
    };
  }
}

function parseType(it: TokenIterator): UnresolvedType | undefined {
  const match = it.expectThenNext([
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
  if (it.current === "?") {
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
    const match = it.expectThenNext([
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
    const match = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    fieldNames.push(match.token);
    if (it.current === ".") {
      it.next();
    } else {
      break;
    }
  }
  const path = fieldNames.map((name) => ({
    name: name,
  }));
  return {
    pipeToken: pipeToken,
    path,
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
    const match = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    nameParts.push(match.token);
  } else {
    nameParts.push(nameOrDot);
  }
  while (it.current === ".") {
    it.next();
    const match = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (match.case < 0) {
      return undefined;
    }
    nameParts.push(match.token);
  }
  return { kind: "record", nameParts: nameParts, absolute: absolute };
}

function parseUint32(it: TokenIterator): number {
  const match = it.expectThenNext([TOKEN_IS_POSITIVE_INT]);
  if (match.case < 0) {
    return -1;
  }
  const { text } = match.token;
  const valueAsBigInt = BigInt(text);
  if (valueAsBigInt < BigInt(2 ** 32)) {
    return +text;
  } else {
    it.errors.push({
      token: match.token,
      message: "Value out of uint32 range",
    });
    return -1;
  }
}

// Parses the 'removed' declaration.
// Assumes the current token is the token after 'removed'.
function parseRemoved(it: TokenIterator, removedToken: Token): Removed | null {
  const numbers: number[] = [];
  // The 5 states are:
  //   ·  '?': expect a number or a semicolon
  //   ·  ',': expect a comma or a semicolon
  //   · '..': expect a comma, a semicolon or a '..'
  //   ·  '0': expect a single number or the lower bound of a range
  //   ·  '1': expect the upper bound of a range
  let expect: "?" | "," | ".." | "0" | "1" = "?";
  let lowerBound: number | undefined;
  loop: while (true) {
    const expected: Array<string | TokenPredicate | null> = [
      /*0:*/ expect === "," || expect === ".." ? "," : null,
      /*1:*/ expect === "?" || expect === "0" || expect === "1"
        ? TOKEN_IS_POSITIVE_INT
        : null,
      /*2:*/ expect === "?" || expect === "," || expect === ".." ? ";" : null,
      /*3:*/ expect === ".." ? ".." : null,
    ];
    const match = it.expectThenNext(expected);
    switch (match.case) {
      case 0: {
        // A comma.
        expect = "0";
        break;
      }
      case 1: {
        // A number.
        const number = +match.token.text;
        if (lowerBound === undefined) {
          expect = "..";
          numbers.push(number);
        } else {
          expect = ",";
          if (number <= lowerBound) {
            it.errors.push({
              token: removedToken,
              message: "Upper bound must be greater than lower bound",
            });
          }
          for (let n = lowerBound; n <= number; ++n) {
            numbers.push(n);
          }
          lowerBound = undefined;
        }
        break;
      }
      case 2: {
        // A semicolon.
        break loop;
      }
      case 3: {
        // A '..'
        expect = "1";
        lowerBound = numbers.pop()!;
        break;
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
  const tokenMatch = it.expectThenNext(["*", TOKEN_IS_IDENTIFIER]);
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
  if (it.expectThenNext(["as"]).case < 0) return null;
  const aliasMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
  if (aliasMatch.case < 0) {
    return null;
  }
  casing.validate(aliasMatch.token, "lower_underscore", it.errors);
  if (it.expectThenNext(["from"]).case < 0) return null;
  const modulePathMatch = it.expectThenNext([TOKEN_IS_STRING_LITERAL]);
  if (modulePathMatch.case < 0) {
    return null;
  }
  it.expectThenNext([";"]);
  const modulePath = modulePathMatch.token;
  return {
    kind: "import-alias",
    name: aliasMatch.token,
    modulePath,
  };
}

function parseImportGivenNames(
  firstName: Token,
  it: TokenIterator,
): Import | null {
  const importedNames = [firstName];
  while (it.current === ",") {
    it.next();
    const nameMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (nameMatch.case < 0) {
      return null;
    }
    importedNames.push(nameMatch.token);
  }
  if (it.expectThenNext(["from"]).case < 0) return null;
  const modulePathMatch = it.expectThenNext([TOKEN_IS_STRING_LITERAL]);
  if (modulePathMatch.case < 0) {
    return null;
  }
  it.expectThenNext([";"]);
  const modulePath = modulePathMatch.token;
  return {
    kind: "import",
    importedNames,
    modulePath,
  };
}

function parseMethod(
  it: TokenIterator,
  documentation: Documentation,
): MutableMethod | null {
  const nameMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
  if (nameMatch.case < 0) {
    return null;
  }
  const name = nameMatch.token;
  casing.validate(name, "UpperCamel", it.errors);
  if (it.expectThenNext(["("]).case < 0) {
    return null;
  }
  const requestTypeOrInlineRecord = parseTypeOrInlineRecord(it, {
    context: "method-request",
    originalName: name,
  });
  const requestType = requestTypeOrInlineRecord.type;
  if (!requestType) {
    return null;
  }
  if (it.expectThenNext([")"]).case < 0 || it.expectThenNext([":"]).case < 0) {
    return null;
  }
  const responseTypeOrInlineRecord = parseTypeOrInlineRecord(it, {
    context: "method-response",
    originalName: name,
  });
  const responseType = responseTypeOrInlineRecord.type;
  if (!responseType) {
    return null;
  }

  const explicitNumber = it.expectThenNext(["=", ";"]).case === 0;
  let number: number;
  if (explicitNumber) {
    number = parseUint32(it);
    if (number < 0) {
      return null;
    }
    it.expectThenNext([";"]);
  } else {
    const methodName = nameMatch.token.text;
    const { modulePath } = nameMatch.token.line;
    number = simpleHash(`${modulePath}:${methodName}`);
  }

  return {
    kind: "method",
    name: nameMatch.token,
    documentation: documentation,
    unresolvedRequestType: requestType,
    unresolvedResponseType: responseType,
    // Will be populated at a later stage.
    requestType: undefined,
    // Will be populated at a later stage.
    responseType: undefined,
    number: number,
    hasExplicitNumber: explicitNumber,
    inlineRequestRecord: requestTypeOrInlineRecord.inlineRecord,
    inlineResponseRecord: responseTypeOrInlineRecord.inlineRecord,
  };
}

function parseConstant(
  it: TokenIterator,
  documentation: Documentation,
): MutableConstant | null {
  const nameMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
  if (nameMatch.case < 0) {
    return null;
  }
  casing.validate(nameMatch.token, "UPPER_UNDERSCORE", it.errors);
  if (it.expectThenNext([":"]).case < 0) {
    return null;
  }
  const type = parseType(it);
  if (!type) {
    return null;
  }
  if (it.expectThenNext(["="]).case < 0) {
    return null;
  }
  const value = parseValue(it);
  if (value === null) {
    return null;
  }
  it.expectThenNext([";"]);
  return {
    kind: "constant",
    name: nameMatch.token,
    documentation: documentation,
    unresolvedType: type,
    type: undefined,
    value: value,
    valueAsDenseJson: undefined,
  };
}

function parseValue(it: TokenIterator): MutableValue | null {
  const expected = [
    /*0:*/ "{",
    /*1:*/ "{|",
    /*2:*/ "[",
    /*3:*/ "false",
    /*4:*/ "true",
    /*5:*/ "null",
    /*6:*/ TOKEN_IS_NUMBER,
    /*7:*/ TOKEN_IS_STRING_LITERAL,
  ];
  const match = it.expectThenNext(expected);
  switch (match.case) {
    case 0:
    case 1: {
      const partial = match.case === 1;
      const entries = parseObjectValue(it, partial);
      if (entries === null) {
        return null;
      }
      return {
        kind: "object",
        token: match.token,
        entries: entries,
        partial: partial,
      };
    }
    case 2: {
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
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
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
  partial: boolean,
): { [f: string]: MutableObjectEntry } | null {
  const closingToken = partial ? "|}" : "}";
  const entries: { [f: string]: MutableObjectEntry } = {};
  while (true) {
    if (it.current === closingToken) {
      it.next();
      return entries;
    }
    const fieldNameMatch = it.expectThenNext([TOKEN_IS_IDENTIFIER]);
    if (fieldNameMatch.case < 0) {
      return null;
    }
    const fieldNameToken = fieldNameMatch.token;
    const fieldName = fieldNameMatch.token.text;
    if (it.expectThenNext([":"]).case < 0) {
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
    const endMatch = it.expectThenNext([",", closingToken]);
    if (endMatch.case < 0) {
      return null;
    }
    if (endMatch.token.text === closingToken) {
      return entries;
    }
  }
}

function parseArrayValue(it: TokenIterator): MutableValue[] | null {
  if (it.current === "]") {
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
    const match = it.expectThenNext([",", "]"]);
    if (match.case < 0) {
      return null;
    }
    if (match.token.text === "]") {
      return items;
    }
    if (it.current === "]") {
      it.next();
      return items;
    }
  }
}

function parseDocumentation(it: TokenIterator): Documentation {
  const docComments: Token[] = [];
  while (it.current.startsWith("///")) {
    docComments.push(it.currentToken);
    it.next();
  }
  const result = parseDocComments(docComments);
  result.errors.forEach((e) => it.errors.push(e));
  return result.result;
}

const EMPTY_DOC: Documentation = {
  pieces: [],
};

abstract class TokenPredicate {
  abstract matches(token: string): boolean;
  abstract what(): string;
}

class TokenIsIdentifier extends TokenPredicate {
  override matches(token: string): boolean {
    return /^\w/.test(token);
  }

  override what(): string {
    return "identifier";
  }
}

const TOKEN_IS_IDENTIFIER = new TokenIsIdentifier();

class TokenIsPositiveInt extends TokenPredicate {
  override matches(token: string): boolean {
    return /^[0-9]+$/.test(token);
  }

  override what(): string {
    return "positive integer";
  }
}

const TOKEN_IS_POSITIVE_INT = new TokenIsPositiveInt();

class TokenIsNumber extends TokenPredicate {
  override matches(token: string): boolean {
    return /^[0-9-]/.test(token);
  }

  override what(): string {
    return "number";
  }
}

const TOKEN_IS_NUMBER = new TokenIsNumber();

class TokenIsStringLiteral extends TokenPredicate {
  override matches(token: string): boolean {
    return /^["']/.test(token);
  }

  override what(): string {
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
  expectThenNext(
    expected: ReadonlyArray<string | TokenPredicate | null>,
  ): TokenMatch {
    let token = this.tokens[this.tokenIndex]!;
    while (token.text.startsWith("///")) {
      this.errors.push({
        token: token,
        message: "Doc comments can only precede declarations",
      });
      ++this.tokenIndex;
      token = this.tokens[this.tokenIndex]!;
    }
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
      expectedParts.push(e instanceof TokenPredicate ? e.what() : `'${e}'`);
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

  get currentToken(): Token {
    return this.tokens[this.tokenIndex]!;
  }

  get current(): string {
    return this.currentToken.text;
  }

  get previous(): string {
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

function collectModuleRecords(
  declarations: readonly Declaration[],
): MutableRecordLocation[] {
  const result: MutableRecordLocation[] = [];
  const collect = (
    declarations: readonly Declaration[],
    ancestors: readonly Record[],
  ): void => {
    for (const record of declarations) {
      if (record.kind !== "record") continue;
      const updatedRecordAncestors = ancestors.concat([record]);
      const modulePath = record.name.line.modulePath;
      const recordLocation: MutableRecordLocation = {
        kind: "record-location",
        record: record,
        recordAncestors: updatedRecordAncestors,
        modulePath: modulePath,
      };
      // We want depth-first.
      collect(record.declarations, updatedRecordAncestors);
      result.push(recordLocation);
    }
  };
  collect(declarations, []);
  return result;
}
