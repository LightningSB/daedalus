export type AppConfig = {
  port: number;
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  sshAllowedHosts: Set<string>;
  vaultIdleTimeoutMs: number;
};

const DEFAULT_ALLOWED_HOSTS = ["34.186.124.156"];

function parseAllowedHosts(raw: string | undefined): Set<string> {
  const hosts = (raw ?? DEFAULT_ALLOWED_HOSTS.join(","))
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return new Set(hosts.length ? hosts : DEFAULT_ALLOWED_HOSTS);
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    minio: {
      endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
      bucket: process.env.MINIO_BUCKET ?? "daedalus",
    },
    sshAllowedHosts: parseAllowedHosts(process.env.SSH_ALLOWED_HOSTS),
    vaultIdleTimeoutMs: 30 * 60 * 1000,
  };
}
