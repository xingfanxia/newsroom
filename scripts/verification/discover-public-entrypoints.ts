import { join } from "node:path";
import { PUBLIC_SERVING_ENTRYPOINTS } from "@/lib/public-content/entrypoints";
import {
  discoverSourceEntrypoints,
  discoverSourceRouteModules,
} from "./public-entrypoint-discovery/source-discovery";
import { readAppPathsManifest } from "./public-entrypoint-discovery/manifest";
import { validateEntrypointInventory } from "./public-entrypoint-discovery/inventory-validation";

export {
  discoverSourceEntrypoints,
  discoverSourceRouteModules,
} from "./public-entrypoint-discovery/source-discovery";
export { readAppPathsManifest } from "./public-entrypoint-discovery/manifest";
export { validateEntrypointInventory } from "./public-entrypoint-discovery/inventory-validation";
export type {
  AppPathsManifest,
  DiscoveredSourceEntrypoint,
  DiscoveredSourceRouteModule,
  EntrypointInventoryValidation,
} from "./public-entrypoint-discovery/types";

if (import.meta.main) {
  const rootDir = process.cwd();
  const sourceEntrypoints = discoverSourceEntrypoints(rootDir);
  const builtAppPaths = readAppPathsManifest(
    join(rootDir, ".next/server/app-paths-manifest.json"),
  );
  const result = validateEntrypointInventory({
    builtAppPaths,
    inventory: PUBLIC_SERVING_ENTRYPOINTS,
    sourceEntrypoints,
    sourceRouteModules: discoverSourceRouteModules(rootDir),
  });
  result.assertComplete();
  console.log(
    JSON.stringify(
      {
        built: result.builtEntrypoints.length,
        classified: PUBLIC_SERVING_ENTRYPOINTS.length,
        source: result.sourceEntrypoints.length,
      },
      null,
      2,
    ),
  );
}
