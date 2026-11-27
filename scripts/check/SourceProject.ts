import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { API } from "typescript/unstable/async";
import type { FileVisitor, PathFilter } from "./types/check.ts";

export class SourceProject {
  private static readonly SOURCE = /\.ts$/;

  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async each(accept: PathFilter, visit: FileVisitor): Promise<number> {
    const api = new API({ cwd: this.root });

    try {
      const snapshot = await api.updateSnapshot({ openProject: `${this.root}/tsconfig.json` });
      const project = snapshot.getProjects()[0];

      if (project === undefined) throw new Error("tsconfig.json did not open a project");

      const files = (await project.program.getSourceFileNames()).filter(
        (file) =>
          file.startsWith(`${this.root}/`) &&
          !file.includes("/node_modules/") &&
          SourceProject.SOURCE.test(file) &&
          accept(relative(this.root, file)),
      );

      if (files.length === 0) throw new Error("the project has no source files");

      for (const file of files) {
        const source = await project.program.getSourceFile(file);

        if (source === undefined) throw new Error(`${file} is not in the program`);

        if (source.text !== readFileSync(file, "utf8")) throw new Error(`${file} changed while it was checked`);

        visit({ file, path: relative(this.root, file), source });
      }

      return files.length;
    } finally {
      await api.close();
    }
  }
}
