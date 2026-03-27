import { AxiosInstance } from "axios";
import { log } from "./logger";
import { MigrationStats } from "./types";
import { safeGet, safeList } from "./utils";

type IdMap = Map<string, string>;

// ---------------------------------------------------------------------------
// Accessor mapping  (Vault mount accessor → OpenBao mount accessor)
// ---------------------------------------------------------------------------

export async function buildAccessorMapping(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance
): Promise<IdMap> {
  const [vaultRes, openbaoRes] = await Promise.all([
    vaultClient.get("/v1/sys/auth"),
    openbaoClient.get("/v1/sys/auth"),
  ]);

  const vaultMounts = vaultRes.data.data ?? vaultRes.data;
  const openbaoMounts = openbaoRes.data.data ?? openbaoRes.data;
  const mapping = new Map<string, string>();

  for (const [path, info] of Object.entries(vaultMounts)) {
    const vaultAccessor = (info as { accessor: string }).accessor;
    const openbaoMount = openbaoMounts[path] as { accessor: string } | undefined;
    if (openbaoMount?.accessor) {
      mapping.set(vaultAccessor, openbaoMount.accessor);
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

async function migrateEntities(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  dryRun: boolean,
  stats: MigrationStats
): Promise<IdMap> {
  const idMap: IdMap = new Map();
  const names = await safeList(vaultClient, "/v1/identity/entity/name");

  stats.totalEntities = names.length;
  log.info(`  Entities: ${names.length} found`);

  for (const name of names) {
    try {
      const entity = await safeGet(vaultClient, `/v1/identity/entity/name/${name}`);
      if (!entity) continue;

      const vaultId = entity.id as string;

      if (!dryRun) {
        const res = await openbaoClient.post("/v1/identity/entity", {
          name: entity.name,
          metadata: entity.metadata,
          policies: entity.policies,
          disabled: entity.disabled,
        });
        const openbaoId = res.data.data?.id as string | undefined;
        if (openbaoId) idMap.set(vaultId, openbaoId);
      } else {
        idMap.set(vaultId, vaultId);
      }

      stats.migratedEntities++;
      log.success(`  ${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} entity: ${name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failedEntities++;
      stats.errors.push({ path: `identity/entity/${name}`, error: message });
      log.error(`  Failed entity: ${name} — ${message}`);
    }
  }

  return idMap;
}

// ---------------------------------------------------------------------------
// Entity aliases
// ---------------------------------------------------------------------------

async function migrateEntityAliases(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  entityIdMap: IdMap,
  accessorMap: IdMap,
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  const ids = await safeList(vaultClient, "/v1/identity/entity-alias/id");
  if (ids.length === 0) return;

  log.info(`  Entity aliases: ${ids.length} found`);

  for (const id of ids) {
    try {
      const alias = await safeGet(vaultClient, `/v1/identity/entity-alias/id/${id}`);
      if (!alias) continue;

      const newCanonicalId = entityIdMap.get(alias.canonical_id as string);
      const newMountAccessor = accessorMap.get(alias.mount_accessor as string);

      if (!newCanonicalId) {
        log.warn(`  Skipping entity alias "${alias.name}": parent entity not in mapping`);
        continue;
      }
      if (!newMountAccessor) {
        log.warn(`  Skipping entity alias "${alias.name}": auth mount accessor not in mapping`);
        continue;
      }

      if (!dryRun) {
        await openbaoClient.post("/v1/identity/entity-alias", {
          name: alias.name,
          canonical_id: newCanonicalId,
          mount_accessor: newMountAccessor,
          metadata: alias.metadata,
        });
      }

      log.success(`  ${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} entity alias: ${String(alias.name)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ path: `identity/entity-alias/${id}`, error: message });
      log.error(`  Failed entity alias: ${id} — ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Groups (two-pass: create → then update members)
// ---------------------------------------------------------------------------

async function migrateGroups(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  entityIdMap: IdMap,
  accessorMap: IdMap,
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  const groupIdMap: IdMap = new Map();
  const names = await safeList(vaultClient, "/v1/identity/group/name");

  stats.totalGroups = names.length;
  log.info(`  Groups: ${names.length} found`);

  // --- Pass 1: create groups without member references ---
  type GroupData = {
    id: string;
    name: string;
    type: string;
    metadata: Record<string, string>;
    policies: string[];
    member_entity_ids: string[];
    member_group_ids: string[];
  };

  const groupDataList: GroupData[] = [];

  for (const name of names) {
    try {
      const group = await safeGet(vaultClient, `/v1/identity/group/name/${name}`);
      if (!group) continue;

      const g = group as GroupData;
      groupDataList.push(g);

      if (!dryRun) {
        const res = await openbaoClient.post("/v1/identity/group", {
          name: g.name,
          type: g.type,
          metadata: g.metadata,
          policies: g.policies,
        });
        const openbaoId = res.data.data?.id as string | undefined;
        if (openbaoId) groupIdMap.set(g.id, openbaoId);
      } else {
        groupIdMap.set(g.id, g.id);
      }

      stats.migratedGroups++;
      log.success(`  ${dryRun ? "[DRY-RUN] Would migrate" : "Migrated"} group: ${name} (${g.type})`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failedGroups++;
      stats.errors.push({ path: `identity/group/${name}`, error: message });
      log.error(`  Failed group: ${name} — ${message}`);
    }
  }

  if (dryRun) return;

  // --- Pass 2: update internal groups with resolved member IDs ---
  for (const g of groupDataList.filter((g) => g.type === "internal")) {
    const newGroupId = groupIdMap.get(g.id);
    if (!newGroupId) continue;

    const newEntityIds = (g.member_entity_ids ?? [])
      .map((id) => entityIdMap.get(id))
      .filter((id): id is string => id !== undefined);

    const newGroupIds = (g.member_group_ids ?? [])
      .map((id) => groupIdMap.get(id))
      .filter((id): id is string => id !== undefined);

    if (newEntityIds.length === 0 && newGroupIds.length === 0) continue;

    try {
      await openbaoClient.post(`/v1/identity/group/id/${newGroupId}`, {
        member_entity_ids: newEntityIds,
        member_group_ids: newGroupIds,
      });
      log.info(`  Updated members for group: ${g.name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ path: `identity/group/${g.name}/members`, error: message });
      log.error(`  Failed updating members for group: ${g.name} — ${message}`);
    }
  }

  // --- Group aliases (for external groups) ---
  const aliasIds = await safeList(vaultClient, "/v1/identity/group-alias/id");
  if (aliasIds.length === 0) return;

  log.info(`  Group aliases: ${aliasIds.length} found`);

  for (const id of aliasIds) {
    try {
      const alias = await safeGet(vaultClient, `/v1/identity/group-alias/id/${id}`);
      if (!alias) continue;

      const newCanonicalId = groupIdMap.get(alias.canonical_id as string);
      const newMountAccessor = accessorMap.get(alias.mount_accessor as string);

      if (!newCanonicalId) {
        log.warn(`  Skipping group alias "${alias.name}": parent group not in mapping`);
        continue;
      }
      if (!newMountAccessor) {
        log.warn(`  Skipping group alias "${alias.name}": auth mount accessor not in mapping`);
        continue;
      }

      await openbaoClient.post("/v1/identity/group-alias", {
        name: alias.name,
        canonical_id: newCanonicalId,
        mount_accessor: newMountAccessor,
        metadata: alias.metadata,
      });

      log.success(`  Migrated group alias: ${String(alias.name)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ path: `identity/group-alias/${id}`, error: message });
      log.error(`  Failed group alias: ${id} — ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function migrateIdentity(
  vaultClient: AxiosInstance,
  openbaoClient: AxiosInstance,
  dryRun: boolean,
  stats: MigrationStats
): Promise<void> {
  const accessorMap = await buildAccessorMapping(vaultClient, openbaoClient);
  log.info(`  Accessor mapping: ${accessorMap.size} auth mount(s) matched`);

  const entityIdMap = await migrateEntities(vaultClient, openbaoClient, dryRun, stats);
  await migrateEntityAliases(vaultClient, openbaoClient, entityIdMap, accessorMap, dryRun, stats);
  await migrateGroups(vaultClient, openbaoClient, entityIdMap, accessorMap, dryRun, stats);
}
