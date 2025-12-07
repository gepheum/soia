import { z } from "zod";

export const GeneratorConfig = z
  .object({
    mod: z.string(),
    config: z.any(),
    soiagenDir: z
      .union([
        z
          .string()
          .regex(/^.*\/soiagen$/)
          .optional(),
        z.array(z.string().regex(/^.*\/soiagen$/)),
      ])
      .optional(),
  })
  .strict();

export type GeneratorConfig = z.infer<typeof GeneratorConfig>;

export const SoiaConfig = z
  .object({
    generators: z.array(GeneratorConfig),
    srcDir: z.string().optional(),
  })
  .strict();

export type SoiaConfig = z.infer<typeof SoiaConfig>;
