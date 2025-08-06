import { formatModule } from "./formatter.js";
import { tokenizeModule } from "./tokenizer.js";
import { expect } from "buckwheat";
import { describe, it } from "mocha";

const UNFORMATTED_MODULE = `
/* module */ import A from 'module.soia';  import * as foo from 'module.soia';

  struct Empty1 { }
struct Empty2 { //
  }  /*a*///

struct S1 {
  a: int32;

//
/* aaa */
b: string;
removed;

    enum E {


    }
}

// doc for
// s2
struct S2 {
  a : int32=0 /* a */;
  b : string=1;//
  c:[[x|foo.a.kind]?] ?;
  removed 5, 10-12, 13;
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

/* a */const CONST: [Type] = [
  1, [], {}, {
    "a" : true,
    'n\\\\"': null,
    'n\\"': null, // null
// c doc
    'c': []  // c
  }
];

struct S {
  // a
}

struct S { // a
  // b
/* c */}  // d

// a

  /* b */ // c

//d
`;

const EXPECTED_FORMATTED_MODULE = `/* module */
import A from "module.soia";
import * as foo from "module.soia";

struct Empty1 {}
struct Empty2 {  //
}  /*a*/  //

struct S1 {
  a: int32;

  //
  /* aaa */
  b: string;
  removed;

  enum E {}
}

// doc for
// s2
struct S2 {
  a: int32 = 0  /* a */
  ;
  b: string = 1;  //
  c: [[x|foo.a.kind]?]?;
  removed 5, 10-12, 13;
}

enum E1 {
  A;
  B;
  c: bool;
}
enum E2 {
  A = 1;
  B = 2;
}

method M(Request): Response;

/* a */
const CONST: [Type] = [
  1,
  [],
  {},
  {
    "a": true,
    'n\\\\"': null,
    "n\\"": null,  // null
    // c doc
    "c": [],  // c
  },
];

struct S {
  // a
}

struct S {  // a
  // b
  /* c */
}  // d

// a

/* b */  // c

//d
`;

describe("formatModule", () => {
  it("works", () => {
    const tokens = tokenizeModule(
      UNFORMATTED_MODULE,
      "path/to/module",
      "keep-comments",
    );
    expect(tokens.errors).toMatch([]);
    const formatted = formatModule(tokens.result);
    expect(formatted).toMatch(EXPECTED_FORMATTED_MODULE);
  });
});
