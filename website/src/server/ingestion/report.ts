import type { IngestionResult } from './engine';

/** A concise, human-readable run summary for the local command. Never includes raw payloads. */
export function formatIngestionResult(result: IngestionResult): string {
  const lines = [
    `Ingestion run ${result.runId}`,
    `  source:            ${result.sourceId}`,
    `  status:            ${result.status}`,
    `  discovered:        ${result.discovered}`,
    `  products created:  ${result.productsCreated}  (always pending review)`,
    `  offers created:    ${result.offersCreated}`,
    `  offers updated:    ${result.offersUpdated}`,
    `  offers unchanged:  ${result.offersUnchanged}  (still re-verified: last_checked_at refreshed)`,
    `  skipped:           ${result.skipped}  (duplicate ${result.duplicates}, invalid ${result.invalid}, unmapped ${result.unmapped}, conflict ${result.conflicts})`,
    `  failed:            ${result.failed}`,
  ];
  if (result.issues.length > 0) {
    lines.push('  issues:');
    for (const issue of result.issues) {
      const where = issue.index === undefined ? '' : ` #${issue.index}`;
      const ref = issue.ref ? ` [${issue.ref}]` : '';
      lines.push(`    - ${issue.code}${where}${ref}: ${issue.message}`);
    }
  }
  return lines.join('\n');
}
