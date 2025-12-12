import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { formatModule } from "./formatter.js";
import { parseModule } from "./parser.js";
import { tokenizeModule } from "./tokenizer.js";

const UNFORMATTED_MODULE = `//module
import A from 'module.skir';  import * as foo from 'module.skir';

  struct Empty1 { }
struct Empty2 { //
  }  //

struct S1 {
  a: int32;
  c: double?;

//
//a
// b
///a
/// b
///
b: string;
removed;
    enum E {


    }
}

// doc for
  /* foo
  */
// s2
struct S2 {
  a : int32=0 ;
  b : string=1;//
  c:[[x|foo.a.kind]?] ?=2;
  removed 3, 4..12, 13;
/*
*
*/
/// foo
  struct Nested {
}
}

enum E1 {
  A;
  B;
  c: bool;
}
enum E2 {
  A=1;
  B=2;
}

method M(Request):Response;

const CONST: [Type] = [
  1, [], {}, {
    a : true,
    b: null,
    c: 'n\\\\"',
    d: 'n\\"',
// c doc
      e: [ ]  //c
  },
  {||}, {|  
    a: true,
    b://
3.14
,
  |},
[
'fo',"fo'",
"fo\\"",
'fo"',
'fo\\"',
'fo\\\\"',
]

];

const F: Foo? = {
  a: null,b: 3.14,c:false
}

;struct S {
  // a
}

struct So ( 100 ) { // a
  // b
    }  // d

// a

  // c

//d

method GetFoo(struct {a: enum { z: int32; g
:
bool;
h: //
[
int32 //
?];}; b: bool; }): struct {
  x: int32; y: int32;};

  struct G {
  // a

  // b
  // b2


  // c


  }`;

const EXPECTED_FORMATTED_MODULE = [
  "// module",
  'import A from "module.skir";',
  'import * as foo from "module.skir";',
  "",
  "struct Empty1 {}",
  "struct Empty2 {  //",
  "}  //",
  "",
  "struct S1 {",
  "  a: int32;",
  "  c: double?;",
  "",
  "  //",
  "  // a",
  "  // b",
  "  /// a",
  "  /// b",
  "  ///",
  "  b: string;",
  "  removed;",
  "  enum E {}",
  "}",
  "",
  "// doc for",
  "/* foo",
  "  */",
  "// s2",
  "struct S2 {",
  "  a: int32 = 0;",
  "  b: string = 1;  //",
  "  c: [[x|foo.a.kind]?]? = 2;",
  "  removed 3, 4..12, 13;",
  "  /*",
  "*",
  "*/",
  "  /// foo",
  "  struct Nested {}",
  "}",
  "",
  "enum E1 {",
  "  A;",
  "  B;",
  "  c: bool;",
  "}",
  "enum E2 {",
  "  A = 1;",
  "  B = 2;",
  "}",
  "",
  "method M(Request): Response;",
  "",
  "const CONST: [Type] = [",
  "  1,",
  "  [],",
  "  {},",
  "  {",
  "    a: true,",
  "    b: null,",
  "    c: 'n\\\\\"',",
  "    d: 'n\\\"',",
  "    // c doc",
  "    e: [],  // c,",
  "  },",
  "  {||},",
  "  {|",
  "    a: true,",
  "    b:  //",
  "    3.14,",
  "  |},",
  "  [",
  '    "fo",',
  '    "fo\'",',
  '    "fo\\"",',
  "    'fo\"',",
  "    'fo\\\"',",
  "    'fo\\\\\"',",
  "  ],",
  "];",
  "",
  "const F: Foo? = {",
  "  a: null,",
  "  b: 3.14,",
  "  c: false,",
  "};",
  "struct S {",
  "  // a",
  "}",
  "",
  "struct So(100) {  // a",
  "  // b",
  "}  // d",
  "",
  "// a",
  "",
  "// c",
  "",
  "// d",
  "",
  "method GetFoo(",
  "  struct {",
  "    a: enum {",
  "      z: int32;",
  "      g: bool;",
  "      h:  //",
  "      [int32  //",
  "      ?];",
  "    };",
  "    b: bool;",
  "  }",
  "): struct {",
  "  x: int32;",
  "  y: int32;",
  "};",
  "",
  "struct G {",
  "  // a",
  "",
  "  // b",
  "  // b2",
  "",
  "  // c",
  "}",
  "",
].join("\n");

describe("formatModule", () => {
  it("works", () => {
    const tokens = tokenizeModule(UNFORMATTED_MODULE, "path/to/module");
    expect(tokens.errors).toMatch([]);
    const parsedModule = parseModule(tokens.result);
    expect(parsedModule.errors).toMatch([]);
    const formatted = formatModule(tokens.result);
    expect(formatted).toMatch(EXPECTED_FORMATTED_MODULE);
  });
});
