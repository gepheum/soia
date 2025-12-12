#!/usr/bin/env node
import * as fs from "fs/promises";
import { glob } from "glob";
import * as paths from "path";
import Watcher from "watcher";
import * as yaml from "yaml";
import { fromZodError } from "zod-validation-error";
import { parseCommandLine } from "./command_line_parser.js";
import { GeneratorConfig, SkirConfig } from "./config.js";
import {
  makeGray,
  makeGreen,
  makeRed,
  renderErrors,
} from "./error_renderer.js";
import { formatModule } from "./formatter.js";
import { REAL_FILE_SYSTEM } from "./io.js";
import { collectModules } from "./module_collector.js";
import { ModuleSet } from "./module_set.js";
import { initializeProject } from "./project_initializer.js";
import { takeSnapshot } from "./snapshotter.js";
import { tokenizeModule } from "./tokenizer.js";
import type { CodeGenerator } from "./types.js";

interface GeneratorBundle<Config = unknown> {
  generator: CodeGenerator<Config>;
  config: Config;
  /// Absolute paths to the skirout directories.
  skiroutDirs: string[];
}

async function makeGeneratorBundle(
  config: GeneratorConfig,
  root: string,
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
    console.error(makeRed(`Invalid config for ${id} generator`));
    const validationError = fromZodError(parsedConfig.error);
    console.error(validationError.toString());
    process.exit(1);
  }
  let skiroutDirs: string[];
  if (config.skiroutDir === undefined) {
    skiroutDirs = ["skirout"];
  } else if (typeof config.skiroutDir === "string") {
    skiroutDirs = [config.skiroutDir];
  } else {
    skiroutDirs = config.skiroutDir;
  }
  skiroutDirs = skiroutDirs.map((d) => paths.join(root, d));
  return {
    generator,
    config: parsedConfig.data,
    skiroutDirs: skiroutDirs,
  };
}

interface WriteBatch {
  /** Key: path to a generated file relative to the skirout dir. */
  readonly pathToFile: ReadonlyMap<string, CodeGenerator.OutputFile>;
  readonly writeTime: Date;
}

class WatchModeMainLoop {
  private readonly skiroutDirs = new Set<string>();

  constructor(
    private readonly srcDir: string,
    private readonly generatorBundles: readonly GeneratorBundle[],
    private readonly watchModeOn: boolean,
  ) {
    for (const generatorBundle of generatorBundles) {
      for (const skiroutDir of generatorBundle.skiroutDirs) {
        this.skiroutDirs.add(skiroutDir);
      }
    }
    checkNoOverlappingSkiroutDirs([...this.skiroutDirs]);
  }

  async start(): Promise<void> {
    await this.generate();
    const watcher = new Watcher(this.srcDir, {
      renameDetection: true,
      recursive: true,
      persistent: true,
    });
    watcher.on("all", (_, targetPath, targetPathNext) => {
      if (
        targetPath.endsWith(".skir") ||
        (targetPathNext && targetPathNext.endsWith(".skir"))
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
    const callback = (): void => {
      try {
        this.generate();
      } catch (e) {
        const message =
          e && typeof e === "object" && "message" in e ? e.message : e;
        console.error(message);
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
          const date = new Date().toLocaleTimeString("en-US");
          const successMessage = `Generation succeeded at ${date}`;
          console.log(makeGreen(successMessage));
          console.log("\nWaiting for changes in files matching:");
          const glob = paths.resolve(paths.join(this.srcDir, "/**/*.skir"));
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
    const { skiroutDirs } = this;
    const preExistingAbsolutePaths = new Set<string>();
    for (const skiroutDir of skiroutDirs) {
      await fs.mkdir(skiroutDir, { recursive: true });

      // Collect all the files in all the skirout dirs.
      (
        await glob(paths.join(skiroutDir, "**/*"), { withFileTypes: true })
      ).forEach((p) => preExistingAbsolutePaths.add(p.fullpath()));
    }

    const pathToFile = new Map<string, CodeGenerator.OutputFile>();
    const pathToGenerator = new Map<string, GeneratorBundle>();
    for (const generator of this.generatorBundles) {
      const files = generator.generator.generateCode({
        modules: moduleSet.resolvedModules,
        recordMap: moduleSet.recordMap,
        config: generator.config,
      }).files;
      for (const file of files) {
        const { path } = file;
        if (pathToFile.has(path)) {
          throw new Error(`Multiple generators produce ${path}`);
        }
        pathToFile.set(path, file);
        pathToGenerator.set(path, generator);
        for (const skiroutDir of generator.skiroutDirs) {
          // Remove this path and all its parents from the set of paths to remove
          // at the end of the generation.
          for (
            let pathToKeep = path;
            pathToKeep !== ".";
            pathToKeep = paths.dirname(pathToKeep)
          ) {
            preExistingAbsolutePaths.delete(
              paths.resolve(paths.join(skiroutDir, pathToKeep)),
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
        const generator = pathToGenerator.get(p)!;
        for (const skiroutDir of generator.skiroutDirs) {
          const fsPath = paths.join(skiroutDir, p);
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isDirectory();
  } catch (e) {
    return false;
  }
}

function checkNoOverlappingSkiroutDirs(skiroutDirs: readonly string[]): void {
  for (let i = 0; i < skiroutDirs.length; ++i) {
    for (let j = i + 1; j < skiroutDirs.length; ++j) {
      const dirA = paths.normalize(skiroutDirs[i]!);
      const dirB = paths.normalize(skiroutDirs[j]!);

      if (
        dirA.startsWith(dirB + paths.sep) ||
        dirB.startsWith(dirA + paths.sep)
      ) {
        throw new Error(`Overlapping skirout directories: ${dirA} and ${dirB}`);
      }
    }
  }
}

interface ModuleFormatResult {
  formattedCode: string;
  alreadyFormatted: boolean;
}

async function format(root: string, mode: "fix" | "check"): Promise<void> {
  const skirFiles = await glob(paths.join(root, "**/*.skir"), {
    withFileTypes: true,
  });
  const pathToFormatResult = new Map<string, ModuleFormatResult>();
  for await (const skirFile of skirFiles) {
    if (!skirFile.isFile) {
      continue;
    }
    const unformattedCode = REAL_FILE_SYSTEM.readTextFile(skirFile.fullpath());
    if (unformattedCode === undefined) {
      throw new Error(`Cannot read ${skirFile.fullpath()}`);
    }
    const tokens = tokenizeModule(unformattedCode, "");
    if (tokens.errors.length) {
      renderErrors(tokens.errors);
      process.exit(1);
    }
    const formattedCode = formatModule(tokens.result).newSourceCode;
    pathToFormatResult.set(skirFile.fullpath(), {
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
        } not formatted; run with 'format fix' to format ${
          numFilesNotFormatted > 1 ? "them" : "it"
        }`,
      ),
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseCommandLine(process.argv.slice(2));

  const root = args.root || ".";

  if (!(await isDirectory(root!))) {
    console.error(makeRed(`Not a directory: ${root}`));
    process.exit(1);
  }

  switch (args.kind) {
    case "init": {
      initializeProject(root!);
      return;
    }
    case "help":
    case "error": {
      return;
    }
  }

  // Use an absolute path to make error messages more helpful.
  const skirConfigPath = paths.resolve(paths.join(root!, "skir.yml"));
  const skirConfigContents = REAL_FILE_SYSTEM.readTextFile(skirConfigPath);
  if (skirConfigContents === undefined) {
    console.error(makeRed(`Cannot find ${skirConfigPath}`));
    process.exit(1);
  }

  let skirConfig: SkirConfig;
  {
    // `yaml.parse` fail with a helpful error message, no need to add context.
    const parseResult = SkirConfig.safeParse(yaml.parse(skirConfigContents));
    if (parseResult.success) {
      skirConfig = parseResult.data;
    } else {
      console.error(makeRed("Invalid skir config"));
      console.error(`  Path: ${skirConfigPath}`);
      const validationError = fromZodError(parseResult.error);
      console.error(validationError.toString());
      process.exit(1);
    }
  }

  const srcDir = paths.join(root!, skirConfig.srcDir || ".");

  switch (args.kind) {
    case "format": {
      // Check or fix the formatting to the .skir files in the source directory.
      await format(srcDir, args.check ? "check" : "fix");
      break;
    }
    case "gen": {
      // Run the skir code generators in watch mode or once.
      const generatorBundles: GeneratorBundle[] = await Promise.all(
        skirConfig.generators.map((config) =>
          makeGeneratorBundle(config, root!),
        ),
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
          console.error(makeRed(`Duplicate generator: ${id}`));
          process.exit(1);
        }
      }
      const watch = !!args.watch;
      const watchModeMainLoop = new WatchModeMainLoop(
        srcDir,
        generatorBundles,
        watch,
      );
      if (watch) {
        await watchModeMainLoop.start();
      } else {
        const success: boolean = await watchModeMainLoop.generate();
        process.exit(success ? 0 : 1);
      }
      break;
    }
    case "snapshot": {
      takeSnapshot({
        rootDir: root!,
        srcDir: srcDir,
        check: !!args.check,
      });
      break;
    }
    default: {
      const _: never = args;
      throw new TypeError(_);
    }
  }
}

main();
