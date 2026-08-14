const NUMERIC_FIELDS = new Set(["kills", "deaths", "assists", "kda", "damage", "gold", "cs", "queue_id"]);

export function leagueMatchRuleValue(match, field) {
  if (field === "kda") return (Number(match.kills || 0) + Number(match.assists || 0)) / Math.max(1, Number(match.deaths || 0));
  return match?.[field];
}

export function matchesLeagueRule(match, rule) {
  if (!rule?.field || rule.value === "") return true;
  const actual = leagueMatchRuleValue(match, rule.field);
  if (NUMERIC_FIELDS.has(rule.field)) {
    const left = Number(actual || 0), right = Number(rule.value);
    if (!Number.isFinite(right)) return true;
    if (rule.operator === "gte") return left >= right;
    if (rule.operator === "lte") return left <= right;
    if (rule.operator === "neq") return left !== right;
    return left === right;
  }
  const left = String(actual || "").toLowerCase(), right = String(rule.value).toLowerCase();
  if (rule.operator === "neq") return left !== right;
  if (rule.operator === "contains") return left.includes(right);
  return left === right;
}

export function matchesLeagueRules(match, rules = [], logic = "and") {
  if (!rules.length) return true;
  return logic === "or" ? rules.some((rule) => matchesLeagueRule(match, rule)) : rules.every((rule) => matchesLeagueRule(match, rule));
}
