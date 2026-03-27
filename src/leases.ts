import { AxiosInstance } from "axios";
import { log } from "./logger";
import { MigrationStats } from "./types";
import { safeList } from "./utils";

/**
 * Leases represent runtime state (active credentials, tokens) issued by Vault.
 * They cannot be transferred to OpenBao — credentials would need to be re-issued
 * by OpenBao once the backend secrets engines are operational.
 * This step performs an inventory only, so operators know what was active.
 */

async function listLeasesRecursive(
  client: AxiosInstance,
  prefix: string
): Promise<string[]> {
  const keys = await safeList(client, `/v1/sys/leases/lookup/${prefix}`);
  const leases: string[] = [];

  for (const key of keys) {
    if (key.endsWith("/")) {
      const children = await listLeasesRecursive(client, `${prefix}${key}`);
      leases.push(...children);
    } else {
      leases.push(`${prefix}${key}`);
    }
  }

  return leases;
}

export async function inventoryLeases(
  vaultClient: AxiosInstance,
  stats: MigrationStats
): Promise<void> {
  log.warn("Leases represent active runtime credentials and cannot be migrated.");
  log.warn("This step is an inventory only. Re-issue credentials via OpenBao after migration.");

  let leases: string[];
  try {
    leases = await listLeasesRecursive(vaultClient, "");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Could not list leases (may require sudo capability): ${message}`);
    return;
  }

  stats.totalLeases = leases.length;

  if (leases.length === 0) {
    log.info("No active leases found.");
    return;
  }

  // Group by top-level prefix for a concise summary
  const byPrefix = new Map<string, number>();
  for (const lease of leases) {
    const prefix = lease.split("/")[0] ?? lease;
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }

  log.info(`Found ${leases.length} active lease(s):`);
  for (const [prefix, count] of byPrefix.entries()) {
    log.info(`  ${prefix}/ — ${count} lease(s)`);
  }
}
