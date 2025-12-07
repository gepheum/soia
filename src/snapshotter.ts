import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkBackwardCompatibility } from "./compatibility_checker.js";
import {
  formatError,
  makeRed,
  renderBreakingChanges,
  renderErrors,
} from "./error_renderer.js";
import { collectModules } from "./module_collector.js";
import { ModuleSet } from "./module_set.js";

export async function takeSnapshot(args: {
  rootDir: string;
  srcDir: string;
  check: boolean;
}): Promise<void> {
  const newModuleSet = await collectModules(args.srcDir);
  if (newModuleSet.errors.length) {
    renderErrors(newModuleSet.errors);
    process.exit(1);
  }
  const snapshotPath = join(args.rootDir, "skir-snapshot.json");
  const oldModuleSet = await readLastSnapshot(join(args.rootDir, snapshotPath));
  if (!(oldModuleSet instanceof ModuleSet)) {
    console.error(makeRed(`Corrupted snapshot file: ${snapshotPath}`));
    console.error(`Error: ${oldModuleSet.error.toString()}`);
    console.log(
      "If the snapshot file cannot be restored to a valid state, delete it and run again. " +
        "Breaking changes from recent commits will not be detected, but a valid snapshot will be created for future comparisons.",
    );
    process.exit(1);
  }
  const breakingChanges = checkBackwardCompatibility({
    before: oldModuleSet,
    after: newModuleSet,
  });
  if (breakingChanges.length) {
    renderBreakingChanges(breakingChanges, {
      before: oldModuleSet,
      after: newModuleSet,
    });
    process.exit(1);
  }
  const now = new Date();
  const newSnapshot = makeSnapshot(newModuleSet, now);
  if (sameModules(newSnapshot, makeSnapshot(oldModuleSet, now))) {
    console.log("No changes detected since last snapshot.");
    return;
  }
  if (args.check) {
    console.error(
      makeRed(
        `Modules have changed since the last snapshot. ` +
          `Run the command without --check to take a new snapshot.`,
      ),
    );
    process.exit(1);
  }
  await writeFile(snapshotPath, JSON.stringify(newSnapshot, null, 2), "utf-8");
  console.log("Snapshot taken. No breaking changes detected.");
}

async function readLastSnapshot(snapshotPath: string): Promise<
  | ModuleSet
  | {
      kind: "corrupted";
      error: any;
    }
> {
  let snapshot: Snapshot;
  try {
    const textContent = await readFile(snapshotPath, "utf-8");
    snapshot = JSON.parse(textContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        kind: "corrupted",
        error: error,
      };
    }
    const isNotFoundError =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    if (isNotFoundError) {
      return ModuleSet.fromMap(new Map<string, string>());
    } else {
      // Rethrow I/O error
      throw error;
    }
  }
  const pathToSourceCode = new Map<string, string>();
  try {
    for (const [path, sourceCode] of Object.entries(snapshot.modules)) {
      // + "" to ensure string type
      pathToSourceCode.set(path + "", sourceCode + "");
    }
  } catch (error) {
    return {
      kind: "corrupted",
      error: error,
    };
  }
  const moduleSet = ModuleSet.fromMap(pathToSourceCode);
  if (moduleSet.errors.length) {
    const firstError = formatError(moduleSet.errors[0]!);
    return {
      kind: "corrupted",
      error: new Error(`errors in modules; first error: ${firstError}`),
    };
  }
  return moduleSet;
}

function makeSnapshot(moduleSet: ModuleSet, now: Date): Snapshot {
  const modules: { [path: string]: string } = {};
  for (const module of moduleSet.resolvedModules) {
    modules[module.path] = module.sourceCode;
  }
  return {
    readMe: "DO NOT EDIT. To update, run: npx skir snapshot",
    lastChange: now.toISOString(),
    modules,
  };
}

function sameModules(a: Snapshot, b: Snapshot): boolean {
  return (
    Object.keys(a.modules).length === Object.keys(b.modules).length &&
    Object.entries(a.modules).every(([path, sourceCode]) => {
      return sourceCode === b.modules[path];
    })
  );
}

interface Snapshot {
  readMe: string;
  lastChange: string;
  modules: { [path: string]: string };
}
