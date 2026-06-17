import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { HIGHLIGHT_ITEM_TIERS } from "@/lib/types";

function highlightTierSqlList(): SQL {
  return sql.join(
    HIGHLIGHT_ITEM_TIERS.map((tier) => sql`${tier}`),
    sql`, `,
  );
}

export function highlightTierInSql(tierExpression: SQLWrapper): SQL {
  return sql`${tierExpression} IN (${highlightTierSqlList()})`;
}
