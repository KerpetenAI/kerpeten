import type { CapabilityUse } from "./types/capability.ts";

/** The `@Use` fields of the classes, kept per class. Fields of a base class come first. */
export class CapabilityUses {
  private static readonly BY_CLASS = new WeakMap<object, readonly CapabilityUse[]>();

  public static onClass(owner: object, use: CapabilityUse): void {
    CapabilityUses.BY_CLASS.set(owner, [...(CapabilityUses.BY_CLASS.get(owner) ?? []), use]);
  }

  public static of(target: object): readonly CapabilityUse[] {
    const uses: CapabilityUse[] = [];

    for (let link: unknown = target; typeof link === "function"; link = Object.getPrototypeOf(link)) {
      uses.unshift(...(CapabilityUses.BY_CLASS.get(link) ?? []));
    }

    return uses;
  }
}
