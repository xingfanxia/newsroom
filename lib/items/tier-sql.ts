import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { HIGHLIGHT_ITEM_TIERS, VISIBLE_ITEM_TIERS } from "@/lib/types";

function tierSqlList(tiers: readonly string[]): SQL {
  return sql.join(tiers.map((tier) => sql`${tier}`), sql`, `);
}

function highlightTierSqlList(): SQL {
  return tierSqlList(HIGHLIGHT_ITEM_TIERS);
}

function visibleTierSqlList(): SQL {
  return tierSqlList(VISIBLE_ITEM_TIERS);
}

export function highlightTierInSql(tierExpression: SQLWrapper): SQL {
  return sql`${tierExpression} IN (${highlightTierSqlList()})`;
}

export function visibleTierInSql(tierExpression: SQLWrapper): SQL {
  return sql`${tierExpression} IN (${visibleTierSqlList()})`;
}
