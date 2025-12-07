import * as fs from "fs";
import * as paths from "path";

export function initializeProject(rootDir: string): void {
  const skirYmlPath = paths.join(rootDir, "skir.yml");

  // Check if skir.yml already exists
  if (fs.existsSync(skirYmlPath)) {
    console.log(
      "A skir.yml file already exists in this directory. Skipping project initialization.",
    );
    return;
  }

  // Create skir.yml file
  fs.writeFileSync(skirYmlPath, SKIR_YML_CONTENT, "utf-8");

  // Check if skir-src directory exists
  const skirSrcDir = paths.join(rootDir, "skir-src");
  if (!fs.existsSync(skirSrcDir)) {
    // Create skir-src directory
    fs.mkdirSync(skirSrcDir, { recursive: true });

    // Create hello_world.skir file
    const helloWorldPath = paths.join(skirSrcDir, "hello_world.skir");
    fs.writeFileSync(helloWorldPath, HELLO_WORLD_SKIR_CONTENT, "utf-8");
  }

  console.log(`Done. Please edit: ${skirYmlPath}`);
}

const SKIR_YML_CONTENT = `srcDir: skir-src
`;

const HELLO_WORLD_SKIR_CONTENT = `struct Point {
  x: int32;
  y: int32;
}
`;
