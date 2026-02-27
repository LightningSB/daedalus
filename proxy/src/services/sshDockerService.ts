import { parse as parseYaml } from "yaml";
import type { SshService } from "./sshService";
import type {
  ComposeCliService,
  ComposeProject,
  DockerContainerInfo,
  DockerContainerSummary,
  DockerFileEntry,
  DockerFilePreview,
  TaskEvent,
  TmuxSession,
  TmuxStatus,
} from "../types/docker";

// ---------------------------------------------------------------------------
// Docker Engine API v1.53 raw response types
// ---------------------------------------------------------------------------

interface EngineContainer {
  Id: string;
  Names: string[];
  Image: string;
  Status: string;
  State: string;
  Created: number;
  Ports: Array<{ IP?: string; PrivatePort: number; PublicPort?: number; Type: string }>;
  Labels: Record<string, string>;
}

interface EngineContainerDetail {
  Id: string;
  Name: string;
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    Pid: number;
    StartedAt: string;
    FinishedAt: string;
  };
  Config: {
    Hostname: string;
    Image: string;
    Cmd: string[] | null;
    Env: string[] | null;
    Labels: Record<string, string>;
    WorkingDir: string;
  };
  NetworkSettings: {
    IPAddress: string;
    Ports: Record<string, unknown>;
  };
  Mounts: Array<{ Type: string; Source: string; Destination: string; Mode: string }>;
}

interface DockerComposeLsItem {
  Name: string;
  Status: string;
  ConfigFiles: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCKER_API_VERSION = "v1.53";
const CURL_TIMEOUT_S = 10;

function curlDocker(path: string, querystring = ""): string {
  const qs = querystring ? `?${querystring}` : "";
  return `curl -sf --max-time ${CURL_TIMEOUT_S} --unix-socket /var/run/docker.sock "http://localhost/${DOCKER_API_VERSION}${path}${qs}"`;
}

/** Sanitize a container id/name to prevent shell injection. */
function safeContainerId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "");
}

/** Sanitize a file path for use in a shell command. */
function safeFilePath(p: string): string {
  return p.replace(/['"\\;`$]/g, "");
}

function parseTmuxOutput(stdout: string, stderr: string, code: number): TmuxStatus {
  const combined = (stdout + stderr).toLowerCase();

  if (
    code === 127 ||
    combined.includes("command not found") ||
    combined.includes("executable file not found") ||
    combined.includes("no such file")
  ) {
    return { available: false, status: "not-installed", sessions: [] };
  }

  if (
    code !== 0 &&
    (combined.includes("no server running") ||
      combined.includes("no sessions") ||
      combined.includes("error connecting"))
  ) {
    return { available: true, status: "no-server", sessions: [] };
  }

  if (code !== 0) {
    return {
      available: true,
      status: "error",
      sessions: [],
      error: (stdout + stderr).trim().slice(0, 300),
    };
  }

  const sessions: TmuxSession[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    sessions.push({
      name: (parts[0] ?? "").trim(),
      windows: parseInt((parts[1] ?? "0").trim(), 10) || 0,
      attached: (parts[2] ?? "0").trim() === "1",
      raw: line,
    });
  }

  return { available: true, status: "ok", sessions };
}

function parseLsLa(output: string, dirPath: string): DockerFileEntry[] {
  const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("total "));
  const entries: DockerFileEntry[] = [];

  for (const line of lines) {
    const match = line.match(
      /^([\w-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/,
    );
    if (!match) continue;

    const [, perms, sizeStr, nameRaw] = match;
    const typeChar = perms[0];

    if (nameRaw === "." || nameRaw === "..") continue;

    const type: DockerFileEntry["type"] =
      typeChar === "d" ? "dir" : typeChar === "l" ? "symlink" : typeChar === "-" ? "file" : "other";

    const size = parseInt(sizeStr, 10);
    const name = nameRaw.includes(" -> ") ? nameRaw.split(" -> ")[0] : nameRaw;
    const parentPath = dirPath.endsWith("/") && dirPath !== "/" ? dirPath.slice(0, -1) : dirPath;
    const filePath = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;

    entries.push({ name, path: filePath, type, size: isNaN(size) ? 0 : size, permissions: perms });
  }

  return entries;
}

/** Heuristic: check if a string appears to be text (not binary). */
function isProbablyTextString(s: string): boolean {
  if (!s.length) return true;
  const sample = s.slice(0, 2048);
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 7) || (code > 14 && code < 32 && code !== 27)) {
      suspicious++;
    }
  }
  return suspicious / sample.length < 0.15;
}

// ---------------------------------------------------------------------------
// SshDockerService
// ---------------------------------------------------------------------------

export class SshDockerService {
  constructor(private readonly sshService: SshService) {}

  async health(userId: string, sessionId: string): Promise<boolean> {
    try {
      const { stdout, code } = await this.sshService.execCommand(
        userId,
        sessionId,
        curlDocker("/_ping"),
        8000,
      );
      return code === 0 && stdout.trim() === "OK";
    } catch {
      return false;
    }
  }

  async listContainers(
    userId: string,
    sessionId: string,
    all = false,
  ): Promise<DockerContainerSummary[]> {
    const qs = all ? "all=1" : "";
    const { stdout, code } = await this.sshService.execCommand(
      userId,
      sessionId,
      curlDocker("/containers/json", qs),
      12000,
    );

    if (code !== 0) {
      throw new Error(`Docker list containers failed (exit ${code})`);
    }

    let raw: EngineContainer[];
    try {
      raw = JSON.parse(stdout) as EngineContainer[];
    } catch {
      throw new Error("Failed to parse Docker containers response");
    }

    return raw.map((c) => ({
      id: c.Id,
      shortId: c.Id.slice(0, 12),
      names: (c.Names ?? []).map((n) => n.replace(/^\//, "")),
      image: c.Image,
      status: c.Status,
      state: c.State,
      created: c.Created,
      ports: (c.Ports ?? []).map((p) => ({
        ip: p.IP,
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      labels: c.Labels ?? {},
    }));
  }

  async inspectContainer(
    userId: string,
    sessionId: string,
    containerId: string,
  ): Promise<DockerContainerInfo> {
    const safeId = safeContainerId(containerId);
    const { stdout, code } = await this.sshService.execCommand(
      userId,
      sessionId,
      curlDocker(`/containers/${safeId}/json`),
      12000,
    );

    if (code !== 0) {
      throw new Error(`Container inspect failed (exit ${code})`);
    }

    let info: EngineContainerDetail;
    try {
      info = JSON.parse(stdout) as EngineContainerDetail;
    } catch {
      throw new Error("Failed to parse container inspect response");
    }

    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ""),
      image: info.Config.Image,
      state: {
        status: info.State.Status,
        running: info.State.Running,
        paused: info.State.Paused,
        restarting: info.State.Restarting,
        pid: info.State.Pid,
        startedAt: info.State.StartedAt,
        finishedAt: info.State.FinishedAt,
      },
      config: {
        hostname: info.Config.Hostname,
        image: info.Config.Image,
        cmd: info.Config.Cmd ?? [],
        env: info.Config.Env ?? [],
        labels: info.Config.Labels ?? {},
        workingDir: info.Config.WorkingDir ?? "/",
      },
      networkSettings: {
        ipAddress: info.NetworkSettings.IPAddress ?? "",
        ports: (info.NetworkSettings.Ports as Record<string, unknown>) ?? {},
      },
      mounts: (info.Mounts ?? []).map((m) => ({
        type: m.Type ?? "",
        source: m.Source ?? "",
        destination: m.Destination ?? "",
        mode: m.Mode ?? "",
      })),
    };
  }

  async getContainerTmux(
    userId: string,
    sessionId: string,
    containerId: string,
  ): Promise<TmuxStatus> {
    try {
      const safeId = safeContainerId(containerId);
      // Append exit code to output so we can parse it without a separate call
      const cmd = `docker exec ${safeId} tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}' 2>&1; printf '\\nexitcode:%d' $?`;
      const { stdout } = await this.sshService.execCommand(userId, sessionId, cmd, 8000);

      const exitMatch = stdout.match(/\nexitcode:(\d+)\s*$/);
      const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : -1;
      const actualOutput = stdout.replace(/\nexitcode:\d+\s*$/, "");

      return parseTmuxOutput(actualOutput, "", exitCode);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { available: false, status: "error", sessions: [], error: msg };
    }
  }

  async listContainerFiles(
    userId: string,
    sessionId: string,
    containerId: string,
    path: string,
  ): Promise<DockerFileEntry[]> {
    const safeId = safeContainerId(containerId);
    const safePath = safeFilePath(path);
    const cmd = `docker exec ${safeId} sh -c 'ls -la "${safePath}" 2>&1'`;
    const { stdout } = await this.sshService.execCommand(userId, sessionId, cmd, 12000);
    return parseLsLa(stdout, safePath);
  }

  async previewContainerFile(
    userId: string,
    sessionId: string,
    containerId: string,
    path: string,
    limit = 65536,
  ): Promise<DockerFilePreview> {
    const safeId = safeContainerId(containerId);
    const safePath = safeFilePath(path);
    const byteLimit = Math.min(limit, 256 * 1024);
    const cmd = `docker exec ${safeId} sh -c 'head -c ${byteLimit} "${safePath}"'`;
    const { stdout, code } = await this.sshService.execCommand(userId, sessionId, cmd, 15000);

    if (code !== 0 && stdout.length === 0) {
      throw new Error(`Failed to preview file (exit ${code})`);
    }

    const isText = isProbablyTextString(stdout);

    return {
      path: safePath,
      size: stdout.length,
      offset: 0,
      limit: byteLimit,
      bytesRead: stdout.length,
      truncated: stdout.length >= byteLimit,
      kind: isText ? "text" : "binary",
      encoding: isText ? "utf-8" : undefined,
      data: isText ? stdout : undefined,
    };
  }

  async listComposeProjects(userId: string, sessionId: string): Promise<ComposeProject[]> {
    try {
      const { stdout, code } = await this.sshService.execCommand(
        userId,
        sessionId,
        "docker compose ls --format json --all 2>/dev/null",
        12000,
      );

      if (code !== 0) return [];

      let items: DockerComposeLsItem[];
      try {
        items = (JSON.parse(stdout) as DockerComposeLsItem[]) ?? [];
      } catch {
        return [];
      }

      if (!Array.isArray(items)) return [];

      const projects: ComposeProject[] = [];

      for (const item of items) {
        const configFiles = (item.ConfigFiles ?? "")
          .split(",")
          .map((f: string) => f.trim())
          .filter(Boolean);

        const cliServices: ComposeCliService[] = [];

        for (const configFile of configFiles) {
          try {
            // Read compose file content via SSH
            const escapedFile = configFile.replace(/"/g, '\\"');
            const { stdout: fileContent, code: catCode } = await this.sshService.execCommand(
              userId,
              sessionId,
              `cat "${escapedFile}" 2>/dev/null`,
              8000,
            );

            if (catCode !== 0) continue;

            const compose = parseYaml(fileContent) as Record<string, unknown>;
            const services = (compose?.services ?? {}) as Record<string, unknown>;

            for (const [name, service] of Object.entries(services)) {
              const svc = (service ?? {}) as Record<string, unknown>;
              const profiles: string[] = Array.isArray(svc.profiles)
                ? (svc.profiles as string[])
                : [];

              if (profiles.includes("cli")) {
                const labels = (svc.labels ?? {}) as Record<string, string>;
                const rawCmd = svc.command;
                const command =
                  rawCmd === undefined
                    ? undefined
                    : Array.isArray(rawCmd)
                      ? (rawCmd as string[]).join(" ")
                      : String(rawCmd);

                cliServices.push({
                  name,
                  image: typeof svc.image === "string" ? svc.image : undefined,
                  description:
                    labels["com.daedalus.description"] ?? labels["description"] ?? undefined,
                  profiles,
                  command,
                });
              }
            }
          } catch {
            // skip unreadable/unparseable compose files
          }
        }

        projects.push({
          name: item.Name,
          status: item.Status,
          configFiles,
          services: cliServices,
        });
      }

      return projects;
    } catch {
      return [];
    }
  }

  async runComposeTask(
    userId: string,
    sessionId: string,
    projectName: string,
    configFile: string,
    service: string,
    args: string[],
    onEvent: (event: TaskEvent) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    // Shell-escape each argument using single-quote wrapping
    const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

    const cmd = [
      "docker",
      "compose",
      "--project-name",
      shellQuote(projectName),
      "--file",
      shellQuote(configFile),
      "--profile",
      "cli",
      "run",
      "--rm",
      shellQuote(service),
      ...args.map(shellQuote),
    ].join(" ");

    try {
      const exitCode = await this.sshService.execStream(
        userId,
        sessionId,
        cmd,
        (data) => onEvent({ type: "stdout", data }),
        (data) => onEvent({ type: "stderr", data }),
        signal,
      );
      onEvent({ type: "exit", code: exitCode });
      return exitCode;
    } catch (error) {
      if (error instanceof Error && error.message !== "Aborted") {
        onEvent({ type: "error", message: error.message });
      }
      onEvent({ type: "exit", code: -1 });
      return -1;
    }
  }
}
