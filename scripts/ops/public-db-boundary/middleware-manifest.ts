import { normalize, relative } from "node:path";
import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { toPosix } from "./conventions";
import { createArtifactValidator, type ArtifactValidator } from "./middleware-artifacts";
import { validateDefinition, validateInstrumentation } from "./middleware-definitions";
import {
  readMiddlewareManifest,
  type MiddlewareManifest,
} from "./middleware-manifest-schema";

export interface MiddlewareManifestEvidence {
  readonly edgeFunctionAppPaths: ReadonlySet<string>;
  readonly edgeInstrumentationEvidence: boolean;
  readonly edgeMiddlewareEvidence: boolean;
}

function checkGlobalMiddleware(
  context: BuildBoundaryContext,
  manifest: MiddlewareManifest,
  validateArtifact: ArtifactValidator,
  file: string,
  entrypoint: string,
): boolean {
  let exact = false;
  for (const [page, definition] of Object.entries(manifest.middleware)) {
    const evidence = validateDefinition(context, validateArtifact, file, entrypoint, "middleware", page, definition);
    const binding =
      page === "/" &&
      evidence.entrypoint === "server/middleware.js" &&
      evidence.files.includes("server/middleware.js") &&
      evidence.valid;
    if (binding) exact = true;
    else if (evidence.valid) {
      addBuildViolation(context, entrypoint, file, "malformed-manifest", `Global middleware ${page} does not bind server/middleware.js`);
    }
  }
  return exact;
}

function expectedFunctionArtifact(
  context: BuildBoundaryContext,
  page: string,
): string | null {
  const buildModule = context.appBuildModules.get(page);
  return buildModule
    ? `server/${toPosix(normalize(buildModule.replaceAll("\\", "/")))}`
    : null;
}

function checkEdgeFunctions(
  context: BuildBoundaryContext,
  manifest: MiddlewareManifest,
  validateArtifact: ArtifactValidator,
  file: string,
  entrypoint: string,
): ReadonlySet<string> {
  const selectedFunctions = new Set<string>();
  for (const [page, definition] of Object.entries(manifest.functions)) {
    const evidence = validateDefinition(context, validateArtifact, file, entrypoint, "functions", page, definition);
    const expected = expectedFunctionArtifact(context, page);
    const exact =
      expected !== null &&
      evidence.entrypoint === expected &&
      evidence.files.includes(expected) &&
      evidence.valid;
    if (exact && context.selectedAppPaths.has(page)) selectedFunctions.add(page);
    else if (!exact && evidence.valid) {
      addBuildViolation(context, page, file, "malformed-manifest", `Edge function ${page} does not bind its app build module`);
    }
  }
  return selectedFunctions;
}

export function checkMiddlewareManifest(
  context: BuildBoundaryContext,
  entrypoint: string,
): MiddlewareManifestEvidence {
  const empty = {
    edgeFunctionAppPaths: new Set<string>(),
    edgeInstrumentationEvidence: false,
    edgeMiddlewareEvidence: false,
  };
  const loaded = readMiddlewareManifest(context, entrypoint);
  if (!loaded) return empty;
  const file = toPosix(relative(context.rootDir, loaded.path));
  const validateArtifact = createArtifactValidator(context);
  return {
    edgeFunctionAppPaths: checkEdgeFunctions(context, loaded.manifest, validateArtifact, file, entrypoint),
    edgeInstrumentationEvidence: validateInstrumentation(context, validateArtifact, file, entrypoint, loaded.manifest.instrumentation),
    edgeMiddlewareEvidence: checkGlobalMiddleware(context, loaded.manifest, validateArtifact, file, entrypoint),
  };
}
