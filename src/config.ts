import { z } from "zod";

export const GeneratorConfig = z
  .object({
    mod: z.string(),
    config: z.any(),
  })
  .strict();

export type GeneratorConfig = z.infer<typeof GeneratorConfig>;

export const SoiaConfig = z
  .object({
    generators: z.array(GeneratorConfig),
    srcDir: z.string().optional(),
    mirroredSoiagenDirs: z
      .array(
        z
          .object({
            path: z.string().regex(/^.*\/soiagen$/),
            fileRegex: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type SoiaConfig = z.infer<typeof SoiaConfig>;
