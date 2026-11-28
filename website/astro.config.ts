import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import { DOC_ORDER, NPM_URL } from "./src/navigation.ts";
import { Repository } from "./src/source/Repository.ts";
import { repositoryLinks } from "./src/source/repository-links.ts";

const repository = new Repository(fileURLToPath(new URL("../", import.meta.url)));

export default defineConfig({
  site: "https://kerpeten.sh",
  markdown: {
    processor: satteri({ mdastPlugins: [repositoryLinks(repository)] }),
  },
  integrations: [
    starlight({
      title: "Kerpeten",
      description: "A code review CLI: a reviewer model finds defects in a change, a judge model checks each finding.",
      logo: { src: "./public/favicon.svg", alt: "" },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: Repository.URL },
        { icon: "npm", label: "npm", href: NPM_URL },
      ],
      sidebar: [...DOC_ORDER],
      customCss: [
        "@fontsource-variable/martian-mono/wdth.css",
        "@fontsource-variable/instrument-sans/index.css",
        "./src/styles/tokens.css",
        "./src/styles/docs.css",
      ],
      disable404Route: true,
      markdown: { processedDirs: [".."] },
      plugins: [starlightLinksValidator()],
    }),
  ],
});
