# Daily Cash Reconciliation visibility

Prepared locally from `ba97cbf79ecd8245b9322fe113470ea455a5aa74`. No database migration is required.

| Item | Store / Manager | Authenticated Admin |
| --- | --- | --- |
| Total Cash Onsite (Before Deposit) | Required employee entry | Existing entry/review behavior |
| Calculated Cash Revenue | Visible | Visible |
| Admin Cash on Hand | Hidden before and after submission | Visible |
| Expected Total Cash on Site | Hidden before and after submission | Visible |
| Cash Available for Deposit | Hidden until the saved entry has its first cash-submission timestamp; visible thereafter | Visible |
| Cash Variance | Hidden until the saved entry has its first cash-submission timestamp; visible thereafter | Existing preview/reporting behavior |

Cash Available for Deposit equals physical cash count minus Cash on Hand, so the count and displayed deposit allow Cash on Hand to be inferred. The final approved requirement hides Deposit and Variance until the initial count is saved, then displays both unchanged. A post-submission variance also permits inference using the count and calculated revenue. These are UI visibility rules, not a new data-security boundary.

Use existing role/site checks in both Site Entry and Admin correction forms. Keep all cash arithmetic, discrepancy rules, required-entry validation, save behavior, audit history and historical records unchanged. Reuse existing Light/Dark classes and collapse unused grid columns when fields are hidden.

Focused validation: 22 UI/calculation/completion/history checks passed, including Store/Manager before/after submission, unsaved typed counts, Admin visibility, shortage/overage, required cash entry, Deposit visibility and existing Light/Dark classes. Both production-base builds passed with existing warnings only. No hosted execution or production changes were performed. Release requires separate merge/deployment authorization.
