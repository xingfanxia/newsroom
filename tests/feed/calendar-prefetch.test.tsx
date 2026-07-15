import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { CalendarGrid } from "@/components/feed/calendar-grid";

type Props = {
  children?: ReactNode;
  className?: string;
  prefetch?: boolean | null;
};

function collectCalendarLinks(node: ReactNode, found: Props[] = []): Props[] {
  if (Array.isArray(node)) {
    for (const child of node) collectCalendarLinks(child, found);
    return found;
  }
  if (!isValidElement<Props>(node)) return found;
  if (
    node.props.className === "calendar-cell" ||
    node.props.className === "clear"
  ) {
    found.push(node.props);
  }
  collectCalendarLinks(node.props.children, found);
  return found;
}

describe("CalendarGrid prefetch pressure", () => {
  test("every navigable calendar date disables automatic prefetch", () => {
    const tree = CalendarGrid({
      days: [{ date: "2026-07-01", count: 1 }],
      active: "2026-07-01",
      basePath: "/en",
      locale: "en",
      monthsBack: 2,
    });
    const links = collectCalendarLinks(tree);
    const dateLinks = links.filter(
      (props) => props.className === "calendar-cell",
    );

    expect(dateLinks.length).toBeGreaterThan(20);
    expect(links.some((props) => props.className === "clear")).toBe(true);
    expect(links.every((props) => props.prefetch === false)).toBe(true);
  });
});
