/**
 * 通用动态 WHERE 构建器。
 * 消除 evolution-model.ts 和 knowledge-library-model.ts 中的 buildWhere 重复。
 */

interface FilterClause {
  value: unknown;
  column: string;
  allowNull?: boolean;
}

export function buildDynamicWhere(
  clauses: FilterClause[],
  prefix = "",
): { where: string; clauses: string[]; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  for (const clause of clauses) {
    if (clause.value === undefined) continue;
    if (clause.value === null) {
      if (clause.allowNull) {
        parts.push(`${prefix}${clause.column} IS NULL`);
      }
      continue;
    }
    parts.push(`${prefix}${clause.column} = ?`);
    params.push(clause.value);
  }

  return {
    where: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    clauses: parts,
    params,
  };
}
