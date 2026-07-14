import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths";
import {
  extractInterceptionRouteInformation,
  isInterceptionRouteAppPath,
} from "next/dist/shared/lib/router/utils/interception-routes";

export interface RequestPathInfo {
  readonly intercepting: boolean;
  readonly pathname: string;
}

export function requestPathInfoFor(appPath: string): RequestPathInfo {
  const normalizedPath = normalizeAppPath(appPath);
  if (!isInterceptionRouteAppPath(normalizedPath)) {
    return { intercepting: false, pathname: normalizedPath };
  }
  return {
    intercepting: true,
    pathname:
      extractInterceptionRouteInformation(normalizedPath).interceptedRoute,
  };
}

export function requestPathnameFor(appPath: string): string {
  return requestPathInfoFor(appPath).pathname;
}
