import type { FlowHook, FlowStartType, HookOwner } from "./types/run.ts";

/** The `@OnFlowStart` methods of the classes, kept per class, and the call of those of one type on an instance. */
export class FlowHooks {
  private static readonly BY_CLASS = new WeakMap<object, readonly FlowHook[]>();

  public static onClass(owner: HookOwner, hook: FlowHook): void {
    const own = FlowHooks.BY_CLASS.get(owner) ?? [];

    if (own.some((known) => known.method === hook.method)) {
      throw new Error(`@OnFlowStart marks ${owner.name}.${String(hook.method)} twice`);
    }

    FlowHooks.BY_CLASS.set(owner, [...own, hook]);
  }

  /** The hooks of the class and of its base classes, those of the base classes first; a method counts once. */
  public static of(target: object): readonly FlowHook[] {
    const chain: object[] = [];

    for (let link: unknown = target; typeof link === "function"; link = Object.getPrototypeOf(link)) {
      chain.unshift(link);
    }

    const hooks: FlowHook[] = [];

    for (const link of chain) {
      for (const hook of FlowHooks.BY_CLASS.get(link) ?? []) {
        if (!hooks.some((known) => known.method === hook.method)) hooks.push(hook);
      }
    }

    return hooks;
  }

  /** Whether the class or one of its base classes has a method marked with `@OnFlowStart`. */
  public static marks(target: object): boolean {
    return FlowHooks.of(target).length > 0;
  }

  /**
   * Calls the hooks of `type` on `instance`, one after another, each awaited. A hook is looked up by its name when it
   * is called, so a test that replaces the method on the prototype replaces the hook.
   */
  public static async call(instance: object, type: FlowStartType): Promise<void> {
    for (const hook of FlowHooks.of(instance.constructor)) {
      if (hook.type !== type) continue;

      const method: unknown = (instance as Readonly<Record<string | symbol, unknown>>)[hook.method];

      if (typeof method !== "function") {
        throw new Error(
          `${instance.constructor.name}.${String(hook.method)} is marked with @OnFlowStart but is no method`,
        );
      }

      await method.call(instance);
    }
  }
}
