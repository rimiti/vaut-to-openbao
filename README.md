# vault-to-openbao

Migration script for copying secrets from HashiCorp Vault to OpenBao, designed to run against a Kubernetes cluster.

## Prerequisites

- Node.js >= 18
- Network access to both instances (Vault and OpenBao)
- Root token, or a token with read/list rights on Vault and write rights on OpenBao

## Installation

```bash
yarn
```

## Configuration

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable          | Description                                          | Default                  |
| ----------------- | ---------------------------------------------------- | ------------------------ |
| `VAULT_ADDR`      | URL of the source Vault instance                     | —                        |
| `VAULT_TOKEN`     | Vault authentication token                           | —                        |
| `OPENBAO_ADDR`    | URL of the destination OpenBao instance              | —                        |
| `OPENBAO_TOKEN`   | OpenBao authentication token                         | —                        |
| `DRY_RUN`         | If `true`, simulates the migration without writing   | `false`                  |
| `SKIP_TLS_VERIFY` | If `true`, disables TLS certificate verification     | `false`                  |
| `SKIP_MOUNTS`     | Comma-separated list of mounts to skip               | `sys,identity,cubbyhole` |
| `CONCURRENCY`     | Number of secrets migrated in parallel               | `5`                      |

## Usage

### Dry-run (recommended first)

Simulates the full migration without writing anything to OpenBao:

```bash
DRY_RUN=true npm run migrate
```

### Real migration

```bash
npm run migrate
```

### Build then run

```bash
npm run build
npm start
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

| Version | Vault read                    | OpenBao write                 |
| ------- | ----------------------------- | ----------------------------- |
| KV v1   | `GET /v1/<mount>/<path>`      | `POST /v1/<mount>/<path>`     |
| KV v2   | `GET /v1/<mount>/data/<path>` | `POST /v1/<mount>/data/<path>`|

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

The process exits with code `1` if at least one secret failed to migrate.

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
