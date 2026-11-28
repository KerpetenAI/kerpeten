import { posix } from "node:path";
import { DocPages } from "./DocPages.ts";
import type { Repository } from "./Repository.ts";

export class RepositoryLinks {
  private static readonly SCHEME = /^[a-z][a-z0-9+.-]*:/i;

  private readonly repository: Repository;

  public constructor(repository: Repository) {
    this.repository = repository;
  }

  public resolve(source: string, url: string): string {
    const viewed = this.repository.pathOfViewUrl(url);

    if (viewed !== undefined) return this.target(source, url, viewed);

    if (url === "" || url.startsWith("#") || url.startsWith("/") || RepositoryLinks.SCHEME.test(url)) return url;

    return this.target(source, url, posix.join(posix.dirname(source), url));
  }

  private target(source: string, url: string, reference: string): string {
    const cut = reference.indexOf("#");
    const path = posix.normalize(cut < 0 ? reference : reference.slice(0, cut)).replace(/\/$/, "");
    const hash = cut < 0 ? "" : reference.slice(cut);

    if (path.startsWith("..") || !this.repository.exists(path)) {
      throw new Error(`${source}: the link "${url}" points to "${path}", which is not in the repository`);
    }

    const page = DocPages.idOf(path);

    return page === undefined ? `${this.repository.viewUrl(path)}${hash}` : `/${page}/${hash}`;
  }
}
