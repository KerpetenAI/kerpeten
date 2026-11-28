import { getCollection } from "astro:content";
import { DOC_ORDER } from "./navigation.ts";

export interface DocLink {
  readonly href: string;
  readonly title: string;
}

export async function docLink(id: string): Promise<DocLink> {
  const entry = (await getCollection("docs")).find((candidate) => candidate.id === id);

  if (entry === undefined) throw new Error(`a page links to "/${id}/", but there is no such docs page`);

  return { href: `/${id}/`, title: entry.data.title };
}

export async function docLinks(): Promise<DocLink[]> {
  return Promise.all(DOC_ORDER.map((id) => docLink(id)));
}
