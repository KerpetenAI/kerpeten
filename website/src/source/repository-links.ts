import { fileURLToPath } from "node:url";
import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";
import type { Repository } from "./Repository.ts";
import { RepositoryLinks } from "./RepositoryLinks.ts";

type MdastPlugin = NonNullable<SatteriProcessorOptions["mdastPlugins"]>[number];

export function repositoryLinks(repository: Repository): MdastPlugin {
  const links = new RepositoryLinks(repository);

  return ({ fileURL }) => {
    const source = fileURL === undefined ? undefined : repository.pathOf(fileURLToPath(fileURL));

    if (source === undefined) return undefined;

    return {
      name: "kerpeten-repository-links",
      link(node, context) {
        const url = links.resolve(source, node.url);

        if (url !== node.url) context.setField(node, "url", url);
      },
      definition(node, context) {
        const url = links.resolve(source, node.url);

        if (url !== node.url) context.setField(node, "url", url);
      },
    };
  };
}
