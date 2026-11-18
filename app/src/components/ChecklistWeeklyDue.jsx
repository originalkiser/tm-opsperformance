import { weeklyDueText, weeklyPhases } from '../utils/checklistWeekly'
export default function ChecklistWeeklyDue({ timing, timezone }) {
  if (!timing) return null
  return <span className="block text-sm"><span>{weeklyDueText(timing,timezone)}</span><span className="block font-semibold">{weeklyPhases[timing.phase]}</span></span>
}
