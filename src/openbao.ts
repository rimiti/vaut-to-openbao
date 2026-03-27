import { AxiosInstance } from "axios";
import { KVVersion, MountInfo, SecretEntry } from "./types";

export async function ensureMount(
  client: AxiosInstance,
  mount: MountInfo,
  kvVersion: KVVersion
): Promise<void> {
  // Check if mount already exists
  try {
    const response = await client.get("/v1/sys/mounts");
    const data = response.data.data ?? response.data;
    const existingMount = data[`${mount.path}/`];

    if (existingMount) {
      return; // Already exists, nothing to do
    }
  } catch {
    // Ignore, we'll try to create it
  }

  // Create the KV mount
  await client.post(`/v1/sys/mounts/${mount.path}`, {
    type: "kv",
    description: mount.description,
    options: { version: String(kvVersion) },
  });
}

export async function writeSecret(
  client: AxiosInstance,
  entry: SecretEntry,
  data: Record<string, unknown>,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  const writePath =
    entry.kvVersion === 2
      ? `/v1/${entry.mountPath}/data/${entry.secretPath}`
      : `/v1/${entry.mountPath}/${entry.secretPath}`;

  const payload =
    entry.kvVersion === 2 ? { data } : data;

  await client.post(writePath, payload);
}
