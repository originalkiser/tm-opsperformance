# Team Member Sales scoring

Reports and Insights share one leaderboard from Daily Log cumulative deltas and approved historical employee mappings. Employee/site identities remain separate across sites. Imported POS reconciliation does not feed rankings.

Every employee with complete, valid required data and positive opportunities qualifies, regardless of sales volume or opportunity count. There is no percentile cutoff or minimum volume. Zero sales with positive opportunities gives 0% conversion, 0% P-Mix, and zero points, with an official rank.

Points = Sales Count + displayed Conversion % + displayed P-Mix %. Percentages retain one decimal; scores remain uncapped. Simple opportunities are washes minus member washes; Detailed adds memberships sold. Ratios use aggregated employee totals. Equal point totals share competition ranks (1, 1, 3).

Missing or invalid required counts, unresolved correction/duplicate attribution, an unknown opportunity formula, or zero/negative opportunities leave the employee unranked without a score. Known metrics remain visible, and the row’s Data issue explains why. Nonpositive opportunities never produce a conversion percentage. P-Mix remains zero for known zero sales.

Cumulative checkpoint calculations, unnamed checkpoints, employee attribution, approved mappings, complete-read guards, site authorization, Daily Logs, employee records, and all import workflows are preserved. Sorting and By Site layout do not recalculate ranks. CSV, Excel, and PDF use the same data/status specification.

This is a frontend-only policy change. No migration, schema, permission, or production data changes are required.
