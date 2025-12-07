import { glob } from "glob";
import * as paths from "path";
import { REAL_FILE_SYSTEM } from "./io.js";
import { ModuleSet } from "./module_set.js";

export async function collectModules(srcDir: string): Promise<ModuleSet> {
  const modules = ModuleSet.create(REAL_FILE_SYSTEM, srcDir);
  const skirFiles = await glob(paths.join(srcDir, "**/*.skir"), {
    stat: true,
    withFileTypes: true,
  });
  for await (const skirFile of skirFiles) {
    if (!skirFile.isFile) {
      continue;
    }
    const relativePath = paths
      .relative(srcDir, skirFile.fullpath())
      .replace(/\\/g, "/");
    modules.parseAndResolve(relativePath);
  }
  return modules;
}
