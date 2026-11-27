import { ClassMetadata } from "./ClassMetadata.ts";
import type { ContextClass, ContextSpec, SpecMatch } from "./types/context.ts";

const SPECS = new ClassMetadata<unknown>("Context");

export function Context<V extends ContextSpec<V>>(spec: V) {
  return <S extends ContextSpec<S>>(target: ContextClass<S> & SpecMatch<V, S>): void => {
    SPECS.set(target, spec);
  };
}

export function contextSpec<S extends ContextSpec<S>>(target: ContextClass<S>): S {
  return SPECS.get(target) as S;
}
