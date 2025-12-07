import { z } from "zod";

export const GeneratorConfig = z
  .object({
    mod: z.string(),
    config: z.any(),
    skiroutDir: z
      .union([
        z
          .string()
          .regex(/^.*\/skirout$/)
          .optional(),
        z.array(z.string().regex(/^.*\/skirout$/)),
      ])
      .optional(),
  })
  .strict();

export type GeneratorConfig = z.infer<typeof GeneratorConfig>;

export const SkirConfig = z
  .object({
    generators: z.array(GeneratorConfig),
    srcDir: z.string().optional(),
  })
  .strict();

export type SkirConfig = z.infer<typeof SkirConfig>;
