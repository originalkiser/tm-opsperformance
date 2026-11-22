import { requiredChecklistPhotos } from '../utils/checklistRules'
// Pure preview: never starts a submission, reads evidence or performs an upload.
export default function ChecklistTemplatePreview({ name, definition, label = 'Complete checklist preview', managementAudit = false }) {
  return <section aria-label={label} className="border rounded-xl p-4 bg-white dark:bg-tm-dark-card space-y-3">
    <h3 className="font-brand font-bold text-xl">{name}</h3>
    <p>Preview only. All conditional follow-ups are shown with their trigger. No operational checklist or evidence is created.</p>
    {definition.map((item, index) => <div key={item.id} className="space-y-2 border-b dark:border-tm-dark-border py-3">
      {(index === 0 || definition[index - 1].section !== item.section) && <h4 className="font-bold text-lg">{item.section}</h4>}
      <p className="font-semibold">{item.number ?? index + 1}. {item.text}{item.critical && <span className="text-red-700 dark:text-red-300"> · Critical</span>}</p>
      {item.instruction && <p>{item.instruction}</p>}
      {item.condition && <p className="text-sm">Shown when “{definition.find(parent => parent.id === item.condition.item_id)?.text}” is answered “{item.condition.value}”.</p>}
      {item.type === 'text' ? <textarea aria-label={`Preview response ${index + 1}`} disabled className="w-full rounded border bg-transparent p-2" placeholder="Written response" /> : <p>{[...item.options, ...(item.na_allowed ? [managementAudit ? 'N/A (optional explanation)' : 'N/A (explanation required)'] : [])].join(' / ')}</p>}
      <p className="text-sm">Required photos: {requiredChecklistPhotos(item)}{item.photo_on_failure && ' (at least one on failure)'}.{item.signature_required && ' Required handwritten signature.'}{item.explanation_required && ' Written explanation required.'}</p>
    </div>)}
    <p className="font-semibold">{managementAudit ? 'N/A explanations are optional.' : 'Every N/A response requires a brief reason.'} Required photo counts and signatures still apply. N/A does not trigger failure-only photos or follow-ups; unconditional required photos and signatures cannot be skipped. Full name and final handwritten signature required.</p>
  </section>
}
