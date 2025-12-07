import { glob } from "glob";
import * as paths from "path";
import { REAL_FILE_SYSTEM } from "./io.js";
import { ModuleSet } from "./module_set.js";

export async function collectModules(srcDir: string): Promise<ModuleSet> {
  const modules = ModuleSet.create(REAL_FILE_SYSTEM, srcDir);
  const soiaFiles = await glob(paths.join(srcDir, "**/*.soia"), {
    stat: true,
    withFileTypes: true,
  });
  for await (const soiaFile of soiaFiles) {
    if (!soiaFile.isFile) {
      continue;
    }
    const relativePath = paths
      .relative(srcDir, soiaFile.fullpath())
      .replace(/\\/g, "/");
    modules.parseAndResolve(relativePath);
  }
  return modules;
}
