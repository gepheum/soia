/**
 * @fileoverview Public types present in the interface between the compiler and
 * language plugins.
 */
import type { z } from "zod";

// -----------------------------------------------------------------------------
// CODE GENERATION
// -----------------------------------------------------------------------------

/**
 * Generates code in one programming language from a set of parsed Soia modules.
 */
export interface CodeGenerator<Config = unknown> {
  readonly id: string;
  readonly version: string;
  readonly configType: z.ZodType<Config>;
  generateCode(input: CodeGenerator.Input<Config>): CodeGenerator.Output;
}

export declare namespace CodeGenerator {
  export interface Input<Config> {
    readonly modules: ReadonlyArray<Module>;
    readonly recordMap: ReadonlyMap<RecordKey, RecordLocation>;
    readonly config: Config;
  }

  export interface Output {
    readonly files: readonly OutputFile[];
  }

  export interface OutputFile {
    readonly path: string;
    readonly code: string;
  }
}

// -----------------------------------------------------------------------------
// LEXICAL ANALYSIS
// -----------------------------------------------------------------------------

/** One line in a module. */
export interface CodeLine {
  /** Zero-based. */
  readonly lineNumber: number;
  readonly line: string;
  readonly position: number;
  readonly modulePath: string;
}

/** A lexical token. */
export interface Token {
  /** Empty if the token is the special token for EOF. */
  readonly text: string;
  /** Measured in number of characters from the start of the module. */
  readonly position: number;
  readonly line: CodeLine;
  /** Zero-based. */
  readonly colNumber: number;
}

export type Casing =
  | "lowerCamel"
  | "lower_underscore"
  | "UpperCamel"
  | "UPPER_UNDERSCORE";

// -----------------------------------------------------------------------------
// ERROR HANDLING
// -----------------------------------------------------------------------------

/** A user error in a module. */
export type SoiaError =
  | {
      readonly token: Token;
      /** Convention: starts with a capital letter. */
      readonly message: string;
      readonly expected?: undefined;
      readonly errorIsInOtherModule?: true;
    }
  | {
      readonly token: Token;
      /** Convention: starts with a lowercase letter. */
      readonly expected: string;
      readonly message?: undefined;
      readonly errorIsInOtherModule?: undefined;
    };

export interface ErrorSink {
  push(error: SoiaError): void;
}

/**
 * Holds a value of type T and possible errors registered during the computation
 * of the value.
 */
export interface Result<T> {
  readonly result: T;
  readonly errors: readonly SoiaError[];
}

// -----------------------------------------------------------------------------
// SYNTACTIC ANALYSIS
// -----------------------------------------------------------------------------

export type Primitive =
  | "bool"
  | "int32"
  | "int64"
  | "uint64"
  | "float32"
  | "float64"
  | "timestamp"
  | "string"
  | "bytes";

export interface PrimitiveType {
  kind: "primitive";
  primitive: Primitive;
}

/**
 * A reference to a record, e.g. 'Foobar' or 'foo.Bar' or '.Foo.Bar'.
 * One of the possible unresolved value types. The corresponding resolved value
 * type is `ResolvedRecordRef`.
 */
export interface UnresolvedRecordRef {
  readonly kind: "record";

  /**
   * The different pieces in the name, e.g. ['Foo', 'Bar'].
   * Cannot be empty.
   */
  readonly nameParts: readonly Token[];

  /**
   * True if the reference starts with a dot, e.g. ".Foo.Bar".
   * In this example, "Foo" is to be found at the top-level of the module.
   */
  readonly absolute: boolean;
}

/** Uniquely identifies a record within a module set. */
export type RecordKey = string;

export interface ResolvedRecordRef {
  readonly kind: "record";
  readonly key: RecordKey;
  readonly recordType: "struct" | "enum";

  readonly nameParts: ReadonlyArray<{
    /**
     * A single name in the type reference.
     * Can refer to either a report or a module alias.
     */
    token: Token;
    /**
     * Either the definition of the record or the aliased import declaration.
     */
    declaration: Record | ImportAlias;
  }>;

  /**
   * Last token in the type reference. For example, if the type reference is
   * ".Foo.Bar", this is the token for "Bar".
   */
  readonly refToken: Token;
}

export interface MutableFieldPathItem {
  /** The field name token in the field path. */
  readonly name: Token;
  /** The field declaration in the record definition. */
  declaration?: Field;
}

/** A field or a sequence of field for keying items in an array. */
export interface MutableFieldPath<Mutable extends boolean = true> {
  /** The "|" token. */
  readonly pipeToken: Token;
  /**
   * A non-empty sequence of field names.
   * If the key type is an enum type, the last field name is guaranteed to be
   * "kind".
   */
  readonly path: ReadonlyArray<
    Mutable extends true ? MutableFieldPathItem : Readonly<MutableFieldPathItem>
  >;
  /** The type used to key every item: either a primitive or an enum. */
  keyType: PrimitiveType | ResolvedRecordRef;
}

export type FieldPath<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableFieldPath
    : Readonly<MutableFieldPath<false>>;

export interface ArrayType<
  Type = ResolvedType,
  Mutable extends boolean = boolean,
> {
  readonly kind: "array";
  readonly item: Type;
  /**
   * If set, the value obtained by following the field path from an item can be
   * used as a unique key for the item. The user takes responsibility for
   * ensuring that not two items in the array have the same key.
   * The item type must be a struct type.
   */
  readonly key: FieldPath<Mutable> | undefined;
}

export type UnresolvedArrayType = ArrayType<UnresolvedType>;
export type MutableArrayType = ArrayType<ResolvedType, true>;

export interface OptionalType<Type = ResolvedType> {
  readonly kind: "optional";
  readonly other: Type;
}

/**
 * Result of parsing a type from a `.soia` file, without resolving the record
 * references.
 */
export type UnresolvedType =
  | PrimitiveType
  | UnresolvedRecordRef
  | UnresolvedArrayType
  | OptionalType<UnresolvedType>;

/**
 * Result of recursively resolving the record references in an unresolved type.
 * When Mutable is true, the optional field path of an array type can be
 * modified.
 */
export type ResolvedType<Mutable extends boolean = boolean> =
  | PrimitiveType
  | ResolvedRecordRef
  | ArrayType<ResolvedType, Mutable>
  | OptionalType<ResolvedType<Mutable>>;

export type MutableResolvedType = ResolvedType<true>;

/** Field of a struct or enum. */
export interface MutableField<Mutable extends boolean = true> {
  readonly kind: "field";
  readonly name: Token;
  readonly number: number;
  /** May only be undefined if the field is a constant in an enum. */
  readonly unresolvedType: UnresolvedType | undefined;
  /** May only be undefined if the field is a constant in an enum. */
  type: ResolvedType<Mutable> | undefined;
  /**
   * Evaluates to true if the value type of the field depends on the record
   * where the field is defined. If `Struct.DEFAULT.field` is or contains
   * `Struct.DEFAULT`, then the dependency is "hard", otherwise it is "soft".
   *
   * Examples:
   *   struct A { s: string; }  // false
   *   struct B { b: B; }       // "hard"
   *   struct C { c: C?; }      // "soft"
   *   struct D { d: [D]; }     // "soft"
   *   struct E { f: F; }       // "hard"
   *   struct F { e: E; }       // "hard"
   *   struct G { b: B; }       // false
   *   struct H { i: I; }       // "soft"
   *   enum I { h: H; }         // "soft"
   */
  isRecursive: false | "soft" | "hard";
}

/** Field of a struct or enum. */
export type Field<Mutable extends boolean = boolean> = //
  Mutable extends true ? MutableField : Readonly<MutableField<false>>;

/** A 'removed' declaration in a struct or enum. */
export interface Removed {
  readonly kind: "removed";
  /** The 'removed' keyword token. */
  readonly removedToken: Token;
  readonly numbers: readonly number[];
}

/** A declaration within a record. */
export type RecordLevelDeclaration<Mutable extends boolean = boolean> =
  | Field
  | Removed
  | Record<Mutable>;

export type MutableRecordLevelDeclaration = RecordLevelDeclaration<true>;

export type Numbering =
  // The record does not have fields.
  | ""
  // Field numbers are not explicit in the schema.
  | "implicit"
  // Field numbers are explicit in the schema.
  | "explicit"
  // The record has both fields with implicit and explicit numbering.
  | "broken";

/** Definition of a struct or enum type. */
export interface Record<Mutable extends boolean = boolean> {
  readonly kind: "record";
  /** Uniquely identifies the record within the module set. */
  readonly key: RecordKey;
  readonly name: Token;
  readonly recordType: "struct" | "enum";
  /** Maps a field or nested record name to the corresponding declaration. */
  readonly nameToDeclaration: { [n: string]: RecordLevelDeclaration<Mutable> };
  readonly declarations: ReadonlyArray<RecordLevelDeclaration<Mutable>>;
  readonly fields: ReadonlyArray<Field<Mutable>>;
  readonly nestedRecords: ReadonlyArray<Record<Mutable>>;
  readonly numbering: Numbering;
  readonly removedNumbers: readonly number[];
  /**
   * If the record is a struct, 1 + the maximum field number.
   * Zero if the record is an enum.
   */
  readonly numSlots: number;
  /**
   * If the record is a struct, 1 + the maximum of all field numbers and removed
   * numbers.
   * Zero if the record is an enum.
   */
  readonly numSlotsInclRemovedNumbers: number;
}

export type MutableRecord = Record<true>;

export interface Import {
  readonly kind: "import";
  readonly importedNames: Token[];
  /** The token corresponding to the quoted string. */
  readonly modulePath: Token;
  /**
   * The path to the module that was imported, or `undefined` if there was an
   * error.
   * Special case: if this logic runs from an IDE extension, this string may be
   * a file URI, e.g. "file:///path/to/root/path/to/module.soia".
   */
  readonly resolvedModulePath: string | undefined;
}

export interface ImportAlias {
  readonly kind: "import-alias";
  /** The alias. */
  readonly name: Token;
  /** The token corresponding to the quoted string. */
  readonly modulePath: Token;
  /**
   * The path to the module that was imported, or `undefined` if there was an
   * error.
   * Special case: if this logic runs from an IDE extension, this string may be
   * a file URI, e.g. "file:///path/to/root/path/to/module.soia".
   */
  readonly resolvedModulePath: string | undefined;
}

export interface MutableMethod<Mutable extends boolean = true> {
  readonly kind: "method";
  readonly name: Token;
  readonly unresolvedRequestType: UnresolvedType;
  readonly unresolvedResponseType: UnresolvedType;
  requestType: ResolvedType<Mutable> | undefined;
  responseType: ResolvedType<Mutable> | undefined;
  // A hash of the name, or the explicit number specified after "=" if any.
  readonly number: number;
}

export type Method<Mutable extends boolean = boolean> = //
  Mutable extends true ? MutableMethod : Readonly<MutableMethod<false>>;

/** A `const` declaration. */
export interface MutableConstant<Mutable extends boolean = true> {
  readonly kind: "constant";
  readonly name: Token;
  readonly unresolvedType: UnresolvedType;
  type: ResolvedType<Mutable> | undefined;
  readonly value: Value;
  valueAsDenseJson: DenseJson | undefined;
}

export type Constant<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableConstant //
    : Readonly<MutableConstant<false>>;

/** A name:value entry of an object. */
export interface MutableObjectEntry<Mutable extends boolean = true> {
  readonly name: Token;
  readonly value: Value<Mutable>;
}

export type ObjectEntry<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableObjectEntry //
    : Readonly<MutableObjectEntry<false>>;

/** An object value, for example `{r: 255, g: 0, b: 0}`. */
export interface MutableObjectValue<Mutable extends boolean = true> {
  readonly kind: "object";
  readonly token: Token;
  readonly entries: Readonly<{ [f: string]: ObjectEntry<Mutable> }>;
  type?: RecordKey;
}

export type ObjectValue<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableObjectValue
    : Readonly<MutableObjectValue<false>>;

/** An array value, for example `[0, 1, 2]`. */
export interface MutableArrayValue<Mutable extends boolean = true> {
  readonly kind: "array";
  readonly token: Token;
  readonly items: ReadonlyArray<Value<Mutable>>;
  key?: FieldPath | undefined;
}

export type ArrayValue<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableArrayValue //
    : Readonly<MutableArrayValue<false>>;

/** One of: a quoted string, a number, `true`, `false`. */
export interface MutableLiteralValue {
  readonly kind: "literal";
  readonly token: Token;
  type?: PrimitiveType | { kind: "enum"; key: RecordKey } | { kind: "null" };
}

export type LiteralValue<Mutable extends boolean = boolean> = //
  Mutable extends true //
    ? MutableLiteralValue //
    : Readonly<MutableLiteralValue>;

/** The value on the right side of the `=` symbol of a `const` declaration. */
export type Value<Mutable extends boolean = boolean> =
  | ObjectValue<Mutable>
  | ArrayValue<Mutable>
  | LiteralValue<Mutable>;

export type MutableValue = Value<true>;

/** Result of serializing a Soia value to dense JSON format. */
export type DenseJson = null | boolean | number | string | readonly DenseJson[];

/** A declaration which can appear at the top-level of a module. */
export type ModuleLevelDeclaration<Mutable extends boolean = boolean> =
  | Record<Mutable>
  | Import
  | ImportAlias
  | Method<Mutable>
  | Constant<Mutable>;

export type MutableModuleLevelDeclaration = ModuleLevelDeclaration<true>;

export type Declaration<Mutable extends boolean = boolean> =
  | RecordLevelDeclaration<Mutable>
  | ModuleLevelDeclaration<Mutable>;

export type MutableDeclaration = Declaration<true>;

/**
 * Contains the definition of a record and information about where the record
 * was defined.
 */
export interface RecordLocation<Mutable extends boolean = boolean> {
  readonly kind: "record-location";
  readonly record: Record<Mutable>;
  /**
   * Chain of records from the top-level record to `record` included.
   * Every record is nested within the record preceding it in the chain.
   */
  readonly recordAncestors: readonly Record[];
  readonly modulePath: string;
}

export type MutableRecordLocation = RecordLocation<true>;

/** The set of names from one module imported to another module. */
export type ImportedNames =
  | { kind: "all"; alias: string }
  | { kind: "some"; names: ReadonlySet<string> };

export interface Module<Mutable extends boolean = boolean> {
  readonly kind: "module";
  readonly path: string;
  readonly nameToDeclaration: { [n: string]: ModuleLevelDeclaration<Mutable> };
  readonly declarations: ReadonlyArray<ModuleLevelDeclaration<Mutable>>;

  /**
   * Maps the path (to another module) to the corresponding import declarations in
   * this module.
   */
  readonly pathToImportedNames: { [path: string]: ImportedNames };

  /**
   * All the record declared in the module, at the top-level or not.
   * Depth-first: "Foo.Bar" will appear before "Foo".
   */
  readonly records: //
  Mutable extends true //
    ? MutableRecordLocation[]
    : readonly RecordLocation[];

  readonly methods: ReadonlyArray<Method<Mutable>>;

  readonly constants: ReadonlyArray<Constant<Mutable>>;
}

/** Can be assigned to a `Module`. */
export type MutableModule = Module<true>;
