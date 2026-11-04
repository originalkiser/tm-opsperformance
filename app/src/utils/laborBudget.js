// A non-null percentage selects the budgeting method; stored zero hours are
// required database placeholders and must never be displayed as an allowance.
export function laborBudget(target) {
  if (target?.full_service_labor_percentage != null) return {
    method: 'percentage', percentage: Number(target.full_service_labor_percentage),
    hours: null, hoursWithManager: null,
  }
  return { method: 'hours', percentage: null,
    hours: target?.labor_hours_non_salary ?? null,
    hoursWithManager: target?.labor_hours_with_salary ?? null }
}
