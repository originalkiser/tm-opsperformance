import { managementAuditScoreText } from '../utils/managementAudits.js'
import { isChecklistItemActive, validateChecklist } from '../utils/checklistRules'
import { checklistPrintPeriod, printTimestamp } from '../utils/checklistPrint'

// An isolated same-origin print document: no app navigation, editable inputs,
// credentials, Storage paths, public URLs, or live template lookup.
export const checklistPrintStyles = `
@page { size: auto; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: white; font: 11pt/1.4 Arial, sans-serif; }
h1 { font-size: 20pt; margin: 0 0 6pt; } h2 { font-size: 15pt; margin: 14pt 0 6pt; break-after: avoid; }
p { margin: 4pt 0; } header { border-bottom: 2px solid #333; padding-bottom: 10pt; }
.item { padding: 8pt 0; border-bottom: 1px solid #aaa; }
.question, .response { break-inside: avoid; } .question { break-after: avoid; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.issue { font-weight: bold; border-left: 3px solid #111; padding-left: 6pt; }
figure { margin: 8pt 0; break-inside: avoid; page-break-inside: avoid; }
img { display: block; max-width: 100%; width: auto; height: auto; max-height: 175mm; object-fit: contain; }
.signature img { max-height: 40mm; max-width: 140mm; }
figcaption, .meta { font-size: 9pt; } footer { margin-top: 12pt; font-size: 9pt; }
@media screen { body { padding: 20px; max-width: 850px; margin: auto; } }
`
export default function ChecklistPrintDocument({ record, images, locationLabel, locationName }) {
  const { row, evidence } = record, snapshot = row.template_snapshot
  const score = managementAuditScoreText(row)
  const issues = validateChecklist(snapshot.definition, row.answers, evidence, row.manager_name || '', row.template_key.includes('audit') || row.template_key === 'monthly_site_assessment')
  const photos = files => files.map(file => <figure key={file.id} className={file.kind === 'signature' ? 'signature' : ''}>
    <img src={images.get(file.id)} alt={file.kind === 'signature' ? 'Recorded handwritten signature' : `Inspection photo for ${snapshot.definition.find(i => i.id === file.item_id)?.text || 'checklist'}`} />
    <figcaption>{file.kind === 'signature' ? 'Recorded signature' : 'Inspection photo'} · {printTimestamp(file.created_at, snapshot.timezone)}{file.item_id && ` · ${snapshot.definition.find(i => i.id === file.item_id)?.section || ''}: ${snapshot.definition.find(i => i.id === file.item_id)?.text || ''}`}</figcaption>
  </figure>)
  return <main>
    <style>{checklistPrintStyles}</style>
    <header><h1>{snapshot.name}</h1><p><strong>Store: {locationLabel || 'Not recorded'}{locationName && locationName !== locationLabel ? ` · ${locationName}` : ''}</strong></p>
      {score && <p><strong>{score}</strong></p>}
      <p>Reporting period: {checklistPrintPeriod(row)}</p>
      <p>Completed: {printTimestamp(row.submitted_at, snapshot.timezone)}</p>
      <p>Recorded employee / auditor: {row.manager_name || 'Not recorded'}</p>
      <p className="meta">Official submitted revision {row.revision} · Saved template version {snapshot.version ?? 'Not recorded'} · Times: {snapshot.timezone || 'UTC'}</p>
      {row.updated_at && row.updated_at !== row.submitted_at && <p className="meta">Official revision recorded: {printTimestamp(row.updated_at, snapshot.timezone)}</p>}
      {row.actor_kind === 'guest' && <p className="meta">Store QR submission; recorded name is self-reported.</p>}
    </header>
    {snapshot.definition.map((item, index) => {
      const answer = row.answers[item.id] || {}, active = isChecklistItemActive(item, row.answers)
      const failed = active && (item.failure_values?.includes(answer.value) || (score && item.options?.includes('Failed') && answer.value === 'Failed'))
      return <section className="item" key={item.id}>
        {(index === 0 || snapshot.definition[index - 1].section !== item.section) && <h2>{item.section}</h2>}
        <div className="question"><p><strong>{item.number ?? index - snapshot.definition.findIndex(previous => previous.section === item.section) + 1}. {item.text}</strong>{item.critical && ' · CRITICAL'}{item.required === false && ' · Optional'}</p>
          {item.instruction && <p className="text">{item.instruction}</p>}
          {item.condition && <p className="meta">Conditional follow-up to {snapshot.definition.find(p => p.id === item.condition.item_id)?.text || item.condition.item_id} when answered “{item.condition.value}”.{!active && ' Not required for the saved parent response.'}</p>}
        </div>
        <div className="response"><p className="text"><strong>Response:</strong> {answer.value?.trim() || (!active ? 'Not applicable — follow-up not triggered' : item.required === false ? 'Not provided (optional)' : 'INCOMPLETE — no saved response')}</p>
        {failed && <p className="issue">FAILED INSPECTION ITEM</p>}
        {issues[item.id] && <p className="issue">INCOMPLETE: {issues[item.id]}</p>}
        {answer.explanation && <p className="text"><strong>Comments / explanation:</strong> {answer.explanation}</p>}
          {photos(evidence.filter(f => f.item_id === item.id && f.kind === 'signature'))}
        </div>
        {photos(evidence.filter(f => f.item_id === item.id && f.kind !== 'signature'))}
      </section>
    })}
    <section><h2>Final signature</h2>{issues._name && <p className="issue">INCOMPLETE: Recorded name missing.</p>}{issues._signature && <p className="issue">INCOMPLETE: Final signature missing.</p>}
      {photos(evidence.filter(f => f.item_id == null))}
    </section>
    <footer>Completed checklist copy for authorized internal review. Printed answers and evidence are from the official saved submission.</footer>
  </main>
}
