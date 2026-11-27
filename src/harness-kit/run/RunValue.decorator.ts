import { RunScope } from "./RunScope.ts";

/**
 * Gives a field of a run component the value of its run under `key`; the values are the inputs of the workflows
 * started in the run, and those the run was opened with. The field becomes a getter that reads the run that built the
 * component, also in its constructor, its `@OnStart` method and its `@OnFlowStart` methods. A singleton, which no run
 * builds, reads the run of the scope it is read in. A run without that value throws when the field is read.
 *
 * How to write the field: `@RunValue("repo") private readonly repo!: string;` The field is `readonly`, has no
 * initializer and is declared with `!`; its type is the type of the value, which the compiler does not check.
 */
export function RunValue(key: string) {
  return (target: object, field: string | symbol): void => {
    const name = String(field);

    Object.defineProperty(target, name, {
      get(this: object): unknown {
        return RunScope.value(this, name, key);
      },
      enumerable: true,
      configurable: false,
    });
  };
}
