import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export class Repository {
  public static readonly URL = "https://github.com/KerpetenSH/kerpeten";

  public static readonly BRANCH = "master";

  public readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public pathOf(absolute: string): string | undefined {
    const path = relative(this.root, resolve(absolute));

    if (path === "" || path.startsWith("..")) return undefined;

    return path.split(sep).join("/");
  }

  public absolute(path: string): string {
    return join(this.root, path);
  }

  public exists(path: string): boolean {
    return existsSync(this.absolute(path));
  }

  public isDirectory(path: string): boolean {
    return statSync(this.absolute(path)).isDirectory();
  }

  public read(path: string): string {
    return readFileSync(this.absolute(path), "utf8");
  }

  public list(directory: string): string[] {
    return readdirSync(this.absolute(directory))
      .sort()
      .map((name) => `${directory}/${name}`);
  }

  public viewUrl(path: string): string {
    const kind = this.isDirectory(path) ? "tree" : "blob";

    return `${Repository.URL}/${kind}/${Repository.BRANCH}/${path}`;
  }

  public editUrl(path: string): string {
    return `${Repository.URL}/edit/${Repository.BRANCH}/${path}`;
  }

  public pathOfViewUrl(url: string): string | undefined {
    for (const kind of ["blob", "tree"]) {
      const prefix = `${Repository.URL}/${kind}/${Repository.BRANCH}/`;

      if (url.startsWith(prefix)) return url.slice(prefix.length);
    }

    return undefined;
  }
}
