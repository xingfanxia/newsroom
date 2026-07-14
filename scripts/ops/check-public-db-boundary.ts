export { checkBuiltPublicDbBoundary } from "./public-db-boundary/build-boundary";
export { runPublicDbBoundaryCli } from "./public-db-boundary/cli";
export { DB_OWNING_LOADER_SOURCES } from "./public-db-boundary/rules";
export { checkSourcePublicDbBoundary } from "./public-db-boundary/source-boundary";
export type {
  PublicDbBoundaryReport,
  PublicDbBoundaryRule,
  PublicDbBoundaryViolation,
} from "./public-db-boundary/types";

import { runPublicDbBoundaryCli } from "./public-db-boundary/cli";

if (import.meta.main) runPublicDbBoundaryCli();
