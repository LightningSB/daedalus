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
  appOrigin: string;
  telegram: {
    botToken?: string;
  };
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
  const useSSL = process.env.MINIO_USE_SSL === "true";
  const defaultMinioPort = useSSL ? 443 : 9000;

  return {
    port: Number(process.env.PORT ?? 8080),
    minio: {
      endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
      port: Number(process.env.MINIO_PORT ?? defaultMinioPort),
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
      bucket: process.env.MINIO_BUCKET ?? "daedalus",
    },
    sshAllowedHosts: parseAllowedHosts(process.env.SSH_ALLOWED_HOSTS),
    vaultIdleTimeoutMs: 30 * 60 * 1000,
    appOrigin: process.env.APP_ORIGIN ?? "https://daedalus.wheelbase.io",
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
  };
}
