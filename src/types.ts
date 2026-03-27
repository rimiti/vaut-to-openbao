export interface Config {
  vault: {
    addr: string;
    token: string;
  };
  openbao: {
    addr: string;
    token: string;
  };
  dryRun: boolean;
  skipTlsVerify: boolean;
  skipMounts: string[];
  skipPolicies: string[];
  skipAuthMethods: string[];
  concurrency: number;
}

export interface MountInfo {
  path: string;
  type: string;
  description: string;
  options?: Record<string, string>;
}

export type KVVersion = 1 | 2;

export interface SecretEntry {
  mountPath: string;
  secretPath: string;
  kvVersion: KVVersion;
}

export interface AuthMount {
  path: string;
  type: string;
  description: string;
}

export interface MigrationStats {
  // Policies
  totalPolicies: number;
  migratedPolicies: number;
  failedPolicies: number;
  // Auth methods
  totalAuthMethods: number;
  migratedAuthMethods: number;
  failedAuthMethods: number;
  // Identity — entities
  totalEntities: number;
  migratedEntities: number;
  failedEntities: number;
  // Identity — groups
  totalGroups: number;
  migratedGroups: number;
  failedGroups: number;
  // Leases (inventory only, not migrated)
  totalLeases: number;
  // KV secrets
  totalMounts: number;
  skippedMounts: number;
  totalSecrets: number;
  migratedSecrets: number;
  failedSecrets: number;
  // All errors
  errors: Array<{ path: string; error: string }>;
}
