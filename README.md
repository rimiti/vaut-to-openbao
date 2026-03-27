# @rimiti/vault-to-openbao

Migrate secrets from HashiCorp Vault to OpenBao, designed to run against a Kubernetes cluster.

## Prerequisites

- Node.js >= 18
- Network access to both instances (Vault and OpenBao)
- Root token, or a token with read/list rights on Vault and write rights on OpenBao

## Installation

### Global (CLI usage)

```bash
npm install -g @rimiti/vault-to-openbao
```

### Local (programmatic usage)

```bash
yarn add @rimiti/vault-to-openbao
```

## CLI

### Configuration

All options can be passed as CLI flags or environment variables. CLI flags take precedence.

| Flag                | Env var           | Description                                        | Default                  |
| ------------------- | ----------------- | -------------------------------------------------- | ------------------------ |
| `--vault-addr`      | `VAULT_ADDR`      | URL of the source Vault instance                   | —                        |
| `--vault-token`     | `VAULT_TOKEN`     | Vault authentication token                         | —                        |
| `--openbao-addr`    | `OPENBAO_ADDR`    | URL of the destination OpenBao instance            | —                        |
| `--openbao-token`   | `OPENBAO_TOKEN`   | OpenBao authentication token                       | —                        |
| `--dry-run`         | `DRY_RUN=true`    | Simulate migration without writing                 | `false`                  |
| `--skip-tls-verify` | `SKIP_TLS_VERIFY=true` | Disable TLS certificate verification          | `false`                  |
| `--skip-mounts`     | `SKIP_MOUNTS`     | Comma-separated list of mounts to skip             | `sys,identity,cubbyhole` |
| `--concurrency`     | `CONCURRENCY`     | Number of secrets migrated in parallel             | `5`                      |
| `-V, --version`     |                   | Display version                                    |                          |
| `-h, --help`        |                   | Display help                                       |                          |

### Usage

Dry-run first (recommended):

```bash
vault-to-openbao \
  --vault-addr https://vault.example.com \
  --vault-token hvs.xxxx \
  --openbao-addr https://openbao.example.com \
  --openbao-token s.xxxx \
  --dry-run
```

Real migration:

```bash
vault-to-openbao \
  --vault-addr https://vault.example.com \
  --vault-token hvs.xxxx \
  --openbao-addr https://openbao.example.com \
  --openbao-token s.xxxx
```

Using a `.env` file instead of flags:

```bash
cp .env.example .env
# edit .env, then:
vault-to-openbao
```

## Programmatic API

```ts
import { migrate } from "@rimiti/vault-to-openbao";

const stats = await migrate({
  vault: {
    addr: "https://vault.example.com",
    token: "hvs.xxxx",
  },
  openbao: {
    addr: "https://openbao.example.com",
    token: "s.xxxx",
  },
  dryRun: false,
  skipTlsVerify: false,
  skipMounts: ["sys", "identity", "cubbyhole"],
  concurrency: 5,
});

console.log(`Migrated ${stats.migratedSecrets} / ${stats.totalSecrets} secrets`);
```

### `migrate(config)` return value

```ts
interface MigrationStats {
  totalMounts: number;
  skippedMounts: number;
  totalSecrets: number;
  migratedSecrets: number;
  failedSecrets: number;
  errors: Array<{ path: string; error: string }>;
}
```

## How it works

The migration runs in three steps:

```
Step 1/3 — Discovering KV mounts
  → Queries /v1/sys/mounts on Vault
  → Filters mounts of type KV (v1 and v2)
  → Excludes system mounts (sys, identity, cubbyhole)

Step 2/3 — Enumerating secrets
  → Recursively walks each mount using the LIST operation
  → Creates any missing mounts in OpenBao

Step 3/3 — Migrating secrets
  → Reads each secret from Vault
  → Writes it to OpenBao (in parallel batches)
```

### KV version handling

| Version | Vault read                    | OpenBao write                  |
| ------- | ----------------------------- | ------------------------------ |
| KV v1   | `GET /v1/<mount>/<path>`      | `POST /v1/<mount>/<path>`      |
| KV v2   | `GET /v1/<mount>/data/<path>` | `POST /v1/<mount>/data/<path>` |

The version is detected automatically from the mount options (`options.version`).

## Output

```
============================================================
Vault → OpenBao Migration
============================================================
2026-03-27T10:00:00.000Z INFO  Source:      https://vault.example.com
2026-03-27T10:00:00.000Z INFO  Destination: https://openbao.example.com
...
2026-03-27T10:00:01.000Z OK    Migrated: secret/app/database
2026-03-27T10:00:01.000Z OK    Migrated: secret/app/api-keys
...
============================================================
Migration Summary
============================================================
  Mounts discovered : 3
  Mounts skipped    : 0
  Secrets found     : 42
  Secrets migrated  : 42
  Secrets failed    : 0
```

The CLI exits with code `1` if at least one secret failed to migrate.

## Required permissions

### Vault (source) — minimal policy

```hcl
path "sys/mounts" {
  capabilities = ["read"]
}

path "<mount>/metadata/*" {
  capabilities = ["list"]
}

path "<mount>/data/*" {
  capabilities = ["read"]
}

# KV v1
path "<mount>/*" {
  capabilities = ["read", "list"]
}
```

### OpenBao (destination) — minimal policy

```hcl
path "sys/mounts" {
  capabilities = ["read"]
}

path "sys/mounts/<mount>" {
  capabilities = ["create", "update"]
}

path "<mount>/data/*" {
  capabilities = ["create", "update"]
}

# KV v1
path "<mount>/*" {
  capabilities = ["create", "update"]
}
```
