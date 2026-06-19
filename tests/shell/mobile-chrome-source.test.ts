import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const mobileChrome = readSource("components/shell/mobile-chrome.tsx");
const navData = readSource("lib/shell/nav-data.ts");

describe("mobile chrome nav source wiring", () => {
  test("bottom tabs reuse the shared nav data contract", () => {
    expect(navData).toContain("export const NAV_MOBILE_TABS");
    expect(navData).toContain('mobileTabFromPrimaryNav("hot")');
    expect(navData).toContain('mobileTabFromPrimaryNav("xmonitor")');
    expect(navData).toContain('mobileTabFromPrimaryNav("saved")');
    expect(mobileChrome).toContain("NAV_MOBILE_TABS");
    expect(mobileChrome).toContain("navHrefForLocale");
    expect(mobileChrome).not.toContain("const TABS");
    expect(mobileChrome).not.toContain("const hrefFor");
    expect(mobileChrome).not.toContain('href: "/x-monitor"');
    expect(mobileChrome).not.toContain('cn: "监控"');
  });
});
