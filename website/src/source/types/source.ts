export interface TitledText {
  readonly title: string;
  readonly body: string;
}

export interface SectionedText {
  readonly preamble: string;
  readonly sections: ReadonlyMap<string, string>;
}

export interface DocPage {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly source: string;
}

export interface LandingFacts {
  readonly status: string | undefined;
  readonly commands: readonly string[];
  readonly sampleCaption: string;
  readonly sampleOutput: string;
}
