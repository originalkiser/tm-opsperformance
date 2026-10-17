# Admin/Store production migration plan

The application supports two roles: active, non-deleted Admin and Store. Admin retains administration. Store reporting is company-wide; operational entry uses primary plus explicit additional manager_locations assignments. Additional assignments grant no administrative rights. Dashboard reporting filters never determine entry scope.

Existing legacy roles must remain unchanged until explicit per-account decisions are approved. Include inactive/deleted profiles in inventory. Store conversion can remove management privileges and Admin conversion grants global administration, so neither is automatic. Preserve primary/additional assignments and role/status snapshots privately.

Development role and reporting migrations passed isolated security validation and authenticated browser checks. Their development baseline guards/policy names make the development role installer unsuitable for production. No production role migration is included or approved. Obtain live production metadata first, then author/review an exact role migration and recovery script with legacy/drift guards, profile/assignment preservation, active-state checks and immutable audit protections.

See [production release preflight](release/pr16-production-preflight.md) for the consolidated read-only query, ordered release gates and recovery plan. Production remains NO-GO pending those gates. No fixture or development baseline installation belongs in production.
