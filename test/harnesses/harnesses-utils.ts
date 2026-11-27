import { type Class, IocApplication } from "@asenajs/ioc";
import { Prompts } from "../../src/harnesses/Prompts.ts";
import { Logger } from "../../src/log/Logger.ts";
import { quietLogger } from "../harness-kit/harness-kit-utils.ts";
import { CapturingLogger } from "./CapturingLogger.ts";
import type { CapturedLine } from "./types/harnesses.ts";

export const log = Logger.silent();

export function capturingLogger(): { readonly log: Logger; readonly lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];

  return { log: new CapturingLogger(lines), lines };
}

/**
 * A started container of the project's prompts and the given components, and the component asked for. Without the
 * harness registry the harnesses are not bound, so each builds its own tools.
 */
export async function component<T>(target: Class<T>, components: readonly Class[]): Promise<T> {
  const app = await IocApplication.create({
    components: [Prompts, ...components],
    logger: quietLogger(),
  });

  await app.start();

  return app.resolve(target);
}
