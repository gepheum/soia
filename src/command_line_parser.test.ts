import { expect } from "buckwheat";
import { describe, it } from "mocha";
import { parseCommandLine } from "./command_line_parser.js";

describe("command_line_parser", () => {
  describe("parseCommandLine", () => {
    describe("gen command", () => {
      it("should parse basic gen command", () => {
        const result = parseCommandLine(["gen"]);
        expect(result).toMatch({ kind: "gen" });
      });

      it("should parse gen with --root option", () => {
        const result = parseCommandLine(["gen", "--root", "path/to/dir"]);
        expect(result).toMatch({
          kind: "gen",
          root: "path/to/dir",
        });
      });

      it("should parse gen with -r option", () => {
        const result = parseCommandLine(["gen", "-r", "path/to/dir"]);
        expect(result).toMatch({
          kind: "gen",
          root: "path/to/dir",
        });
      });

      it("should parse gen with --watch option", () => {
        const result = parseCommandLine(["gen", "--watch"]);
        expect(result).toMatch({
          kind: "gen",
          watch: true,
        });
      });

      it("should parse gen with -w option", () => {
        const result = parseCommandLine(["gen", "-w"]);
        expect(result).toMatch({
          kind: "gen",
          watch: true,
        });
      });

      it("should parse gen with both --root and --watch", () => {
        const result = parseCommandLine([
          "gen",
          "--root",
          "path/to/dir",
          "--watch",
        ]);
        expect(result).toMatch({
          kind: "gen",
          root: "path/to/dir",
          watch: true,
        });
      });

      it("should parse gen with -r and -w", () => {
        const result = parseCommandLine(["gen", "-r", "path/to/dir", "-w"]);
        expect(result).toMatch({
          kind: "gen",
          root: "path/to/dir",
          watch: true,
        });
      });

      it("should return error if --check is used with gen", () => {
        const result = parseCommandLine(["gen", "--check"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if unknown option is used", () => {
        const result = parseCommandLine(["gen", "--unknown"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if --root is missing value", () => {
        const result = parseCommandLine(["gen", "--root"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if --root is specified multiple times", () => {
        const result = parseCommandLine([
          "gen",
          "--root",
          "path1",
          "--root",
          "path2",
        ]);
        expect(result).toMatch({ kind: "error" });
      });
    });

    describe("format command", () => {
      it("should parse basic format command", () => {
        const result = parseCommandLine(["format"]);
        expect(result).toMatch({ kind: "format" });
      });

      it("should parse format with --root option", () => {
        const result = parseCommandLine(["format", "--root", "path/to/dir"]);
        expect(result).toMatch({
          kind: "format",
          root: "path/to/dir",
        });
      });

      it("should parse format with -r option", () => {
        const result = parseCommandLine(["format", "-r", "path/to/dir"]);
        expect(result).toMatch({
          kind: "format",
          root: "path/to/dir",
        });
      });

      it("should parse format with --check option", () => {
        const result = parseCommandLine(["format", "--check"]);
        expect(result).toMatch({
          kind: "format",
          check: true,
        });
      });

      it("should parse format with -c option", () => {
        const result = parseCommandLine(["format", "-c"]);
        expect(result).toMatch({
          kind: "format",
          check: true,
        });
      });

      it("should parse format with both --root and --check", () => {
        const result = parseCommandLine([
          "format",
          "--root",
          "path/to/dir",
          "--check",
        ]);
        expect(result).toMatch({
          kind: "format",
          root: "path/to/dir",
          check: true,
        });
      });

      it("should parse format with -r and -c", () => {
        const result = parseCommandLine(["format", "-r", "path/to/dir", "-c"]);
        expect(result).toMatch({
          kind: "format",
          root: "path/to/dir",
          check: true,
        });
      });

      it("should return error if --watch is used with format", () => {
        const result = parseCommandLine(["format", "--watch"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if unknown option is used", () => {
        const result = parseCommandLine(["format", "--verbose"]);
        expect(result).toMatch({ kind: "error" });
      });
    });

    describe("snapshot command", () => {
      it("should parse basic snapshot command", () => {
        const result = parseCommandLine(["snapshot"]);
        expect(result).toMatch({ kind: "snapshot" });
      });

      it("should parse snapshot with --root option", () => {
        const result = parseCommandLine(["snapshot", "--root", "path/to/dir"]);
        expect(result).toMatch({
          kind: "snapshot",
          root: "path/to/dir",
        });
      });

      it("should parse snapshot with -r option", () => {
        const result = parseCommandLine(["snapshot", "-r", "path/to/dir"]);
        expect(result).toMatch({
          kind: "snapshot",
          root: "path/to/dir",
        });
      });

      it("should return error if --watch is used with snapshot", () => {
        const result = parseCommandLine(["snapshot", "--watch"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should parse snapshot with --check option", () => {
        const result = parseCommandLine(["snapshot", "--check"]);
        expect(result).toMatch({
          kind: "snapshot",
          check: true,
        });
      });

      it("should parse snapshot with -c option", () => {
        const result = parseCommandLine(["snapshot", "-c"]);
        expect(result).toMatch({
          kind: "snapshot",
          check: true,
        });
      });

      it("should return error if unknown option is used", () => {
        const result = parseCommandLine(["snapshot", "--force"]);
        expect(result).toMatch({ kind: "error" });
      });
    });

    describe("init command", () => {
      it("should parse basic init command", () => {
        const result = parseCommandLine(["init"]);
        expect(result).toMatch({ kind: "init" });
      });

      it("should parse init with --root option", () => {
        const result = parseCommandLine(["init", "--root", "path/to/dir"]);
        expect(result).toMatch({
          kind: "init",
          root: "path/to/dir",
        });
      });

      it("should parse init with -r option", () => {
        const result = parseCommandLine(["init", "-r", "path/to/dir"]);
        expect(result).toMatch({
          kind: "init",
          root: "path/to/dir",
        });
      });

      it("should return error if --watch is used with init", () => {
        const result = parseCommandLine(["init", "--watch"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if --check is used with init", () => {
        const result = parseCommandLine(["init", "--check"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if unknown option is used", () => {
        const result = parseCommandLine(["init", "--template"]);
        expect(result).toMatch({ kind: "error" });
      });
    });

    describe("help command", () => {
      it("should return help for help command", () => {
        const result = parseCommandLine(["help"]);
        expect(result).toMatch({ kind: "help" });
      });

      it("should return help for --help flag", () => {
        const result = parseCommandLine(["--help"]);
        expect(result).toMatch({ kind: "help" });
      });

      it("should return help for -h flag", () => {
        const result = parseCommandLine(["-h"]);
        expect(result).toMatch({ kind: "help" });
      });
    });

    describe("error cases", () => {
      it("should return help for empty args", () => {
        const result = parseCommandLine([]);
        expect(result).toMatch({ kind: "help" });
      });

      it("should return error for unknown command", () => {
        const result = parseCommandLine(["unknown"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error for unexpected positional argument", () => {
        const result = parseCommandLine(["gen", "extra-arg"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error for option with missing value at end", () => {
        const result = parseCommandLine(["format", "-r"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if --watch specified multiple times", () => {
        const result = parseCommandLine(["gen", "--watch", "-w"]);
        expect(result).toMatch({ kind: "error" });
      });

      it("should return error if --check specified multiple times", () => {
        const result = parseCommandLine(["format", "--check", "-c"]);
        expect(result).toMatch({ kind: "error" });
      });
    });

    describe("option order", () => {
      it("should parse options in any order for gen", () => {
        const result1 = parseCommandLine(["gen", "--watch", "--root", "dir"]);
        const result2 = parseCommandLine(["gen", "--root", "dir", "--watch"]);
        expect(result1).toMatch({
          kind: "gen",
          root: "dir",
          watch: true,
        });
        expect(result2).toMatch({
          kind: "gen",
          root: "dir",
          watch: true,
        });
      });

      it("should parse options in any order for format", () => {
        const result1 = parseCommandLine([
          "format",
          "--check",
          "--root",
          "dir",
        ]);
        const result2 = parseCommandLine([
          "format",
          "--root",
          "dir",
          "--check",
        ]);
        expect(result1).toMatch({
          kind: "format",
          root: "dir",
          check: true,
        });
        expect(result2).toMatch({
          kind: "format",
          root: "dir",
          check: true,
        });
      });
    });
  });
});
