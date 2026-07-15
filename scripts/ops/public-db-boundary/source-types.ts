export interface EntrypointScan {
  entrypoint: string;
  readonly visited: Set<string>;
}

export interface SourceFileEvidence {
  readonly absolutePath: string;
  readonly physicalRelativePath: string;
  readonly relativePath: string;
  readonly source: string;
}
