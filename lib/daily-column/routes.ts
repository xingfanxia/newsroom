import { DAILY_COLUMN_LOCALE } from "@/lib/types";

const DAILY_COLUMN_BASE_ROUTE = `/${DAILY_COLUMN_LOCALE}`;
export const DAILY_COLUMN_INDEX_ROUTE = `${DAILY_COLUMN_BASE_ROUTE}/daily`;

export function dailyColumnIssueRoute(date: string): string {
  return `${DAILY_COLUMN_INDEX_ROUTE}/${date}`;
}

export function dailyColumnItemRoute(id: string | number): string {
  return `${DAILY_COLUMN_BASE_ROUTE}/items/${id}`;
}
