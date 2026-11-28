import { defineCollection } from "astro:content";
import { i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";
import { readmeLoader, repositoryDocsLoader } from "./source/docs-loader.ts";

export const collections = {
  docs: defineCollection({ loader: repositoryDocsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  readme: defineCollection({
    loader: readmeLoader(),
    schema: z.object({
      status: z.string().optional(),
      commands: z.array(z.string()).min(1),
      sampleCaption: z.string(),
      sampleOutput: z.string(),
    }),
  }),
};
