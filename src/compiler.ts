#!/usr/bin/env node
import { GeneratorConfig, SoiaConfig } from "./config.js";
import { formatModule } from "./formatter.js";
import { REAL_FILE_SYSTEM } from "./io.js";
import { ModuleSet } from "./module_set.js";
import { tokenizeModule } from "./tokenizer.js";
import type { CodeGenerator, SoiaError } from "./types.js";
import * as fs from "fs/promises";
import { glob } from "glob";
import { parseArgs } from "node:util";
import * as paths from "path";
import Watcher from "watcher";
import * as yaml from "yaml";
import { fromZodError } from "zod-validation-error";

interface GeneratorBundle<Config = unknown> {
  generator: CodeGenerator<Config>;
  config: Config;
}

interface SoiagenDir {
  path: string;
  fileRegex: RegExp;
}

async function makeGeneratorBundle(
  config: GeneratorConfig,
): Promise<GeneratorBundle> {
  const mod = await import(config.mod);
  const generator = mod.GENERATOR;
  if (typeof generator !== "object") {
    throw new Error(`Cannot import GENERATOR from module ${config.mod}`);
  }
  // Validate the generator config.
  const parsedConfig = generator.configType.safeParse(config.config);
  if (!parsedConfig.success) {
    const { id } = generator;
    console.log(makeRed(`Invalid config for ${id} generator`));
    const validationError = fromZodError(parsedConfig.error);
    console.log(validationError.toString());
    process.exit(1);
  }
  return {
    generator: generator,
    config: parsedConfig.data,
  };
}

async function collectModules(root: string): Promise<ModuleSet> {
  const modules = ModuleSet.create(REAL_FILE_SYSTEM, root);
  const soiaFiles = await glob(paths.join(root, "**/*.soia"), {
    stat: true,
    withFileTypes: true,
  });
  for await (const soiaFile of soiaFiles) {
    if (!soiaFile.isFile) {
      continue;
    }
    const relativePath = paths
      .relative(root, soiaFile.fullpath())
      .replace(/\\/g, "/");
    modules.parseAndResolve(relativePath);
  }
  return modules;
}

interface WriteBatch {
  /** Key: path to a generated file relative to the soiagen dir. */
  readonly pathToFile: ReadonlyMap<string, CodeGenerator.OutputFile>;
  readonly writeTime: Date;
}

class WatchModeMainLoop {
  constructor(
    private readonly srcDir: string,
    private readonly soiagenDirs: readonly SoiagenDir[],
    private readonly generatorBundles: readonly GeneratorBundle[],
    private readonly watchModeOn: boolean,
  ) {}

  async start() {
    await this.generate();
    const watcher = new Watcher(this.srcDir, {
      renameDetection: true,
      recursive: true,
      persistent: true,
    });
    watcher.on("all", (_, targetPath, targetPathNext) => {
      if (
        targetPath.endsWith(".soia") ||
        (targetPathNext && targetPathNext.endsWith(".soia"))
      ) {
        this.triggerGeneration();
      }
    });
  }

  private triggerGeneration(): void {
    if (this.generating) {
      this.mustRegenerate = true;
      return;
    }
    if (this.timeoutId !== undefined) {
      globalThis.clearTimeout(this.timeoutId);
    }
    const delayMillis = 200;
    const callback = () => {
      try {
        this.generate();
      } catch (e) {
        const message =
          e && typeof e === "object" && "message" in e ? e.message : e;
        (console.error || console.log).call(message);
      }
    };
    this.timeoutId = globalThis.setTimeout(callback, delayMillis);
  }

  async generate(): Promise<boolean> {
    this.generating = true;
    this.timeoutId = undefined;
    this.mustRegenerate = false;
    if (this.watchModeOn) {
      console.clear();
    }
    try {
      const moduleSet = await collectModules(this.srcDir);
      const errors = moduleSet.errors.filter((e) => !e.errorIsInOtherModule);
      if (errors.length) {
        renderErrors(errors);
        return false;
      } else {
        await this.doGenerate(moduleSet);
        if (this.watchModeOn) {
          const date = new Date().toLocaleTimeString("en-GB");
          const successMessage = `Generation succeeded at ${date}`;
          console.log(makeGreen(successMessage));
          console.log("\nWaiting for changes in files matching:");
          const glob = paths.resolve(paths.join(this.srcDir, "/**/*.soia"));
          console.log(`  ${glob}`);
        }
        return true;
      }
    } finally {
      this.generating = false;
      if (this.mustRegenerate) {
        this.triggerGeneration();
      }
    }
  }

  private async doGenerate(moduleSet: ModuleSet): Promise<void> {
    const { soiagenDirs } = this;
    const preExistingAbsolutePaths = new Set<string>();
    for (const soiagenDir of soiagenDirs) {
      await fs.mkdir(soiagenDir.path, { recursive: true });

      // Collect all the files in all the soiagen dirs.
      (
        await glob(paths.join(soiagenDir.path, "**/*"), { withFileTypes: true })
      ).forEach((p) => preExistingAbsolutePaths.add(p.fullpath()));
    }

    const pathToFile = new Map<string, CodeGenerator.OutputFile>();
    for (const bundle of this.generatorBundles) {
      const files = bundle.generator.generateCode({
        modules: moduleSet.resolvedModules,
        recordMap: moduleSet.recordMap,
        config: bundle.config,
      }).files;
      for (const file of files) {
        const { path } = file;
        if (pathToFile.has(path)) {
          throw new Error(`Multiple generators produce ${path}`);
        }
        pathToFile.set(path, file);
        for (const soiagenDir of soiagenDirs) {
          if (!soiagenDir.fileRegex.test(path)) {
            continue;
          }
          // Remove this path and all its parents from the set of paths to remove
          // at the end of the generation.
          for (
            let pathToKeep = path;
            pathToKeep !== ".";
            pathToKeep = paths.dirname(pathToKeep)
          ) {
            preExistingAbsolutePaths.delete(
              paths.resolve(paths.join(soiagenDir.path, pathToKeep)),
            );
          }
        }
      }
    }

    // Write or override all the generated files.
    const { lastWriteBatch } = this;
    await Promise.all(
      Array.from(pathToFile).map(async ([p, newFile]) => {
        const oldFile = lastWriteBatch.pathToFile.get(p);
        for (const soiagenDir of soiagenDirs) {
          if (!soiagenDir.fileRegex.test(p)) {
            continue;
          }
          const fsPath = paths.join(soiagenDir.path, p);
          if (oldFile?.code === newFile.code) {
            const mtime = (await fs.stat(fsPath)).mtime;
            if (
              mtime !== null &&
              mtime.getDate() <= lastWriteBatch.writeTime.getDate()
            ) {
              return;
            }
          }
          await fs.mkdir(paths.dirname(fsPath), { recursive: true });
          await fs.writeFile(fsPath, newFile.code, "utf-8");
        }
      }),
    );

    // Remove all the pre-existing paths which haven't been overridden.
    await Promise.all(
      Array.from(preExistingAbsolutePaths)
        .sort((a, b) => b.localeCompare(a, "en-US"))
        .map(async (p) => {
          try {
            await fs.rm(p, { force: true, recursive: true });
          } catch (e) {
            // Ignore error.
          }
        }),
    );

    this.lastWriteBatch = {
      pathToFile: pathToFile,
      writeTime: new Date(),
    };
  }

  private timeoutId?: NodeJS.Timeout;
  private generating = false;
  private mustRegenerate = false;
  private lastWriteBatch: WriteBatch = {
    pathToFile: new Map(),
    writeTime: new Date(0),
  };
}

function makeCyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}

function makeYellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function makeRed(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function makeBlackOnWhite(text: string): string {
  return `\x1b[47m${text}\x1b[0m`;
}

function makeGreen(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function makeGray(text: string): string {
  return `\x1b[90m${text}\x1b[0m`;
}

function formatError(error: SoiaError): string {
  const { token } = error;
  const { line, colNumber } = token;
  const lineNumberStr = (line.lineNumber + 1).toString();
  let result = makeCyan(line.modulePath);
  result += ":";
  result += makeYellow(lineNumberStr);
  result += ":";
  result += makeYellow((colNumber + 1).toString());
  result += " - ";
  if (error.expected !== undefined) {
    result += makeRed("expected");
    result += `: ${error.expected}`;
  } else {
    result += makeRed("error");
    result += `: ${error.message}`;
  }
  result += "\n\n";
  result += makeBlackOnWhite(lineNumberStr);
  result += " ";
  result += line.line;
  result += "\n";
  result += makeBlackOnWhite(" ".repeat(lineNumberStr.length));
  result += " ".repeat(colNumber + 1);
  result += makeRed("~".repeat(Math.max(token.text.length, 1)));
  result += "\n";
  return result;
}

function renderErrors(errors: readonly SoiaError[]): void {
  const MAX_ERRORS = 10;
  for (let i = 0; i < errors.length && i < MAX_ERRORS; ++i) {
    const error = errors[i];
    console.log(formatError(error!));
  }
  // Count the number of distinct modules with errors.
  if (errors.length) {
    const modules = new Set<string>();
    for (const error of errors) {
      modules.add(error.token.line.modulePath);
    }
    const numErrors = `${errors.length} error${errors.length <= 1 ? "" : "s"}`;
    const numFiles = `${modules.size} file${modules.size <= 1 ? "" : "s"}`;
    console.log(`Found ${numErrors} in ${numFiles}\n`);
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isDirectory();
  } catch (e) {
    return false;
  }
}

function checkNoOverlappingSoiagenDirs(
  soiagenDirs: readonly SoiagenDir[],
): void {
  for (let i = 0; i < soiagenDirs.length; ++i) {
    for (let j = i + 1; j < soiagenDirs.length; ++j) {
      const dirA = paths.normalize(soiagenDirs[i]!.path);
      const dirB = paths.normalize(soiagenDirs[j]!.path);

      if (
        dirA.startsWith(dirB + paths.sep) ||
        dirB.startsWith(dirA + paths.sep)
      ) {
        throw new Error(`Overlapping soiagen directories: ${dirA} and ${dirB}`);
      }
    }
  }
}

interface ModuleFormatResult {
  formattedCode: string;
  alreadyFormatted: boolean;
}

async function format(root: string, mode: "fix" | "check"): Promise<void> {
  const soiaFiles = await glob(paths.join(root, "**/*.soia"), {
    withFileTypes: true,
  });
  const pathToFormatResult = new Map<string, ModuleFormatResult>();
  for await (const soiaFile of soiaFiles) {
    if (!soiaFile.isFile) {
      continue;
    }
    const unformattedCode = REAL_FILE_SYSTEM.readTextFile(soiaFile.fullpath());
    if (unformattedCode === undefined) {
      throw new Error(`Cannot read ${soiaFile.fullpath()}`);
    }
    const tokens = tokenizeModule(unformattedCode, "", "keep-comments");
    if (tokens.errors.length) {
      renderErrors(tokens.errors);
      process.exit(1);
    }
    const formattedCode = formatModule(tokens.result);
    pathToFormatResult.set(soiaFile.fullpath(), {
      formattedCode: formattedCode,
      alreadyFormatted: formattedCode === unformattedCode,
    });
  }
  let numFilesNotFormatted = 0;
  for (const [path, result] of pathToFormatResult) {
    const relativePath = paths.relative(root, path).replace(/\\/g, "/");
    if (mode === "fix") {
      if (result.alreadyFormatted) {
        console.log(`${makeGray(relativePath)} (unchanged)`);
      } else {
        REAL_FILE_SYSTEM.writeTextFile(path, result.formattedCode);
        console.log(makeGray(relativePath));
      }
    } else {
      const _: "check" = mode;
      if (result.alreadyFormatted) {
        console.log(`${makeGray(relativePath)} (OK)`);
      } else {
        console.log(makeRed(relativePath));
        ++numFilesNotFormatted;
      }
    }
  }
  if (numFilesNotFormatted) {
    console.log();
    console.log(
      makeRed(
        `${numFilesNotFormatted} file${
          numFilesNotFormatted > 1 ? "s" : ""
        } not formatted; run with '--fmt fix' to format ${
          numFilesNotFormatted > 1 ? "them" : "it"
        }`,
      ),
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const {
    values: { root, watch, fmt },
  } = parseArgs({
    options: {
      root: {
        type: "string",
        short: "r",
        default: ".",
      },
      watch: {
        type: "boolean",
        short: "w",
      },
      fmt: {
        type: "string",
      },
    },
  });

  if (!(await isDirectory(root!))) {
    console.log(makeRed(`Not a directory: ${root}`));
    process.exit(1);
  }

  // Use an absolute path to make error messages more helpful.
  const soiaConfigPath = paths.resolve(paths.join(root!, "soia.yml"));
  const soiaConfigContents = REAL_FILE_SYSTEM.readTextFile(soiaConfigPath);
  if (soiaConfigContents === undefined) {
    console.log(makeRed(`Cannot find ${soiaConfigPath}`));
    process.exit(1);
  }

  let soiaConfig: SoiaConfig;
  {
    // `yaml.parse` fail with a helpful error message, no need to add context.
    const parseResult = SoiaConfig.safeParse(yaml.parse(soiaConfigContents));
    if (parseResult.success) {
      soiaConfig = parseResult.data;
    } else {
      console.log(makeRed("Invalid soia config"));
      console.log(`  Path: ${soiaConfigPath}`);
      const validationError = fromZodError(parseResult.error);
      console.log(validationError.toString());
      process.exit(1);
    }
  }

  if (fmt && fmt !== "fix" && fmt !== "check") {
    console.log(
      makeRed(
        `Formatter mode must be one of ['fix', 'check']; actual: '${fmt}'`,
      ),
    );
    process.exit(1);
  }

  if (fmt && watch) {
    console.log(makeRed("Formatter cannot be used with watch mode"));
    process.exit(1);
  }

  const generatorBundles: GeneratorBundle[] = await Promise.all(
    soiaConfig.generators.map(makeGeneratorBundle),
  );
  // Sort for consistency.
  generatorBundles.sort((a, b) => {
    const aId = a.generator.id;
    const bId = b.generator.id;
    return aId.localeCompare(bId, "en-US");
  });
  // Look for duplicates.
  for (let i = 0; i < generatorBundles.length - 1; ++i) {
    const { id } = generatorBundles[i]!.generator;
    if (id === generatorBundles[i + 1]!.generator.id) {
      console.log(makeRed(`Duplicate generator: ${id}`));
      process.exit(1);
    }
  }

  const srcDir = paths.join(root!, soiaConfig.srcDir || ".");

  if (fmt) {
    // Check or fix the formatting to the .soia files in the source directory.
    await format(srcDir, fmt as "fix" | "check");
  } else {
    // Run the soia code generators in watch mode or once.
    const soiagenDir = paths.join(root!, "soiagen");
    const soiagenDirs: SoiagenDir[] = [
      {
        path: soiagenDir,
        fileRegex: new RegExp(""),
      },
    ];
    for (const mirroredSoiagenDir of soiaConfig.mirroredSoiagenDirs || []) {
      soiagenDirs.push({
        path: paths.join(root!, mirroredSoiagenDir.path),
        fileRegex: new RegExp(mirroredSoiagenDir.fileRegex ?? ""),
      });
    }
    checkNoOverlappingSoiagenDirs(soiagenDirs);
    const watchModeMainLoop = new WatchModeMainLoop(
      srcDir,
      soiagenDirs,
      generatorBundles,
      !!watch,
    );
    if (watch) {
      await watchModeMainLoop.start();
    } else {
      const success: boolean = await watchModeMainLoop.generate();
      process.exit(success ? 0 : 1);
    }
  }
}

main();
