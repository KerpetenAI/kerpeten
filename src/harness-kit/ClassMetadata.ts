import { UnmarkedClassError } from "./UnmarkedClassError.ts";

export class ClassMetadata<T> {
  private readonly specs = new WeakMap<object, T>();
  private readonly decorator: string;

  public constructor(decorator: string) {
    this.decorator = decorator;
  }

  public set(target: object, spec: T): void {
    this.specs.set(target, spec);
  }

  public get(target: object): T {
    const spec = this.specs.get(target);

    if (spec === undefined) throw this.unmarked();

    return spec;
  }

  /** The spec of the class or of its nearest marked base class. */
  public nearest(target: object): T {
    const spec = this.find(target);

    if (spec === undefined) throw this.unmarked();

    return spec;
  }

  public find(target: object): T | undefined {
    for (let link: unknown = target; typeof link === "function"; link = Object.getPrototypeOf(link)) {
      const spec = this.specs.get(link);

      if (spec !== undefined) return spec;
    }

    return undefined;
  }

  private unmarked(): UnmarkedClassError {
    return new UnmarkedClassError(`the class is not marked with @${this.decorator}`);
  }
}
