import { Context, ContextBase, contextSpec } from "../../src/harness-kit/index.ts";
import type { GreetingSpec } from "./types/context.ts";

@Context({ MAX_NAME_CHARS: 5, NO_NAME: "(no name)" })
export class GreetingContext extends ContextBase<GreetingSpec, string> {
  public static shown(name: string): string {
    const spec = contextSpec(GreetingContext);

    return name === "" ? spec.NO_NAME : name.slice(0, spec.MAX_NAME_CHARS);
  }

  protected sections(name: string, notes: string[]): readonly string[] {
    if (name.length > this.spec.MAX_NAME_CHARS) notes.push("name cut");

    return ["Name:", this.dataBlock("name", GreetingContext.shown(name))];
  }
}
