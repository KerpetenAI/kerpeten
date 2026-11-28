import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { Inject } from "@asenajs/ioc";
import { Capability, CapabilityBase } from "@kerpetensh/harness-kit";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { readJson } from "../../files/files-utils.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import { authFilePath } from "./chatgpt-utils.ts";
import { authRecordSchema } from "./schemas/chatgpt-schema.ts";
import type { AuthRecord } from "./types/chatgpt.ts";

@Capability({
  name: "chatgpt-auth-file",
  description:
    "Reads and writes the ChatGPT sign-in in auth.json under the user's config directory, outside any repository; the directory and the file are readable by the owner only.",
})
export class ChatGptAuthFile extends CapabilityBase {
  private static readonly MAX_BYTES = 262_144;

  private static readonly DIR_MODE = 0o700;

  private static readonly FILE_MODE = 0o600;

  private static readonly OPEN_TO_OTHERS = 0o077;

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  private foundPath: string | undefined;

  /**
   * The path of `auth.json`, worked out from the environment on first use, so that building the file reads neither the
   * environment nor the file system. Throws a `ChatGptAuthError` when the path lies inside a git work tree.
   */
  public get path(): string {
    this.foundPath ??= authFilePath(this.env);

    return this.foundPath;
  }

  public read(): AuthRecord | undefined {
    const { path } = this;
    let mode: number;

    try {
      mode = statSync(path).mode;
    } catch {
      return undefined;
    }

    if ((mode & ChatGptAuthFile.OPEN_TO_OTHERS) !== 0) {
      throw new ChatGptAuthError(`${path} can be read by other users; run \`chmod 600 ${path}\``);
    }

    const file = readJson(path, ChatGptAuthFile.MAX_BYTES);

    if (!file.ok) throw new ChatGptAuthError(`${file.error}; ${this.startOver()}`);

    const parsed = authRecordSchema.safeParse(file.value);

    if (!parsed.success) {
      throw new ChatGptAuthError(`${this.path} is not a valid sign-in file; ${this.startOver()}`);
    }

    return parsed.data;
  }

  /** Writes the record atomically: a new owner-only file in the same directory, then a rename over the old one. */
  public write(record: AuthRecord): void {
    const dir = dirname(this.path);

    mkdirSync(dir, { recursive: true, mode: ChatGptAuthFile.DIR_MODE });

    chmodSync(dir, ChatGptAuthFile.DIR_MODE);

    const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const fd = openSync(temp, "wx", ChatGptAuthFile.FILE_MODE);

    try {
      writeSync(fd, `${JSON.stringify(authRecordSchema.parse(record), null, 2)}\n`);

      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(temp, { force: true });

      throw error;
    }

    closeSync(fd);
    chmodSync(temp, ChatGptAuthFile.FILE_MODE);
    renameSync(temp, this.path);
  }

  /** Removes the tokens and keeps the registration, as the sign-out guide asks. */
  public clearTokens(record: AuthRecord): AuthRecord {
    const { tokens: _tokens, ...rest } = record;

    this.write(rest);

    return rest;
  }

  private startOver(): string {
    return `remove ${this.path} and run \`kerpeten auth login\` again`;
  }
}
