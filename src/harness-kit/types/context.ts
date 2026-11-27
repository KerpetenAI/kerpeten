import type { ContextBase } from "../ContextBase.ts";

export type ContextSpec<S> = { readonly [K in keyof S]: string | number };

export type ContextClass<S extends ContextSpec<S>> = abstract new (...args: never[]) => ContextBase<S, never>;

export type SpecMatch<V, S> = [V] extends [S] ? ([S] extends [V] ? unknown : never) : never;
