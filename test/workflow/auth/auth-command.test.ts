import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../../src/app/KerpetenApp.ts";
import { ExitCode, Run, RunScope } from "../../../src/harness-kit/index.ts";
import { tempHome } from "../../capability/chatgpt/chatgpt-utils.ts";

const dirs: string[] = [];

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the auth command workflow", () => {
  test("auth status in a directory that is no git repository builds no run component and prints the sign-in", async () => {
    const home = tempHome(dirs);
    const cwd = tempHome(dirs);
    const builds = spyOn(RunScope, "build");
    const flows = spyOn(Run.prototype, "startFlow");
    const out: string[] = [];
    const err: string[] = [];

    expect(existsSync(join(cwd, ".git"))).toBe(false);

    const code = await KerpetenApp.run(
      { io: { out: (line) => out.push(line), err: (line) => err.push(line) }, env: { HOME: home }, cwd },
      ["auth", "status"],
    );

    expect({ code, out, err }).toEqual({
      code: ExitCode.OK,
      out: [`file: ${home}/.config/kerpeten/auth.json`, "ChatGPT: not signed in; run `kerpeten auth login`"],
      err: [],
    });

    expect(flows).toHaveBeenCalledTimes(1);
    expect(flows).toHaveBeenCalledWith([]);
    expect(builds).not.toHaveBeenCalled();
  });
});
