import { mondayOf } from '../../src/utils/checklistRules.js'
import { addChecklistDays } from '../../src/utils/checklistCompliance.js'
// Explicit inactive-policy server response for pre-existing UI tests.
export function legacyWeeklyPeriods({p_date}) {
 const period=mondayOf(p_date)
 return [{period_date:period,period_end:addChecklistDays(period,6),previous:false,weekly_timing:null,checklists:{}}]
}
