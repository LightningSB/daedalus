import Dockerode from "dockerode";
import { readFile } from "node:fs/promises";
import type { DockerContainerInfo, DockerContainerSummary, DockerExecWsData, DockerFileEntry, DockerFilePreview, TmuxSession, TmuxStatus, WsSessionData } from "../types/docker";

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";
const docker = new Dockerode({ socketPath: DOCKER_SOCKET_PATH });

// Active exec sessions: execSessionId → { stream, exec }
const execSessions = new Map<
  string,
  { stream: NodeJS.ReadWriteStream; exec: Dockerode.Exec }
>();

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function listContainers(
  all = false,
): Promise<DockerContainerSummary[]> {
  const containers = await docker.listContainers({ all });
  return containers.map((c) => ({
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

export async function inspectContainer(
  id: string,
): Promise<DockerContainerInfo> {
  const container = docker.getContainer(id);
  const info = await container.inspect();
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
      ipAddress: (info.NetworkSettings as Record<string, unknown>)["IPAddress"] as string ?? "",
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

// Derive the container ID solely from /proc paths.  Does NOT read env vars
// or call the Docker API — those concerns live in getSelfContainer().
async function resolveContainerIdFromRuntime(): Promise<string | null> {
  // Primary: look for the actual Docker container ID in mountinfo.
  // Docker bind-mounts /var/lib/docker/containers/<full-id>/resolv.conf (and
  // /etc/hosts, /etc/hostname) into every container.  This path reliably
  // contains the 64-char container ID, unlike the overlay2 upperdir which is
  // also a 64-char hex but is a *layer* ID, not a container ID.
  try {
    const mountinfo = await readFile("/proc/self/mountinfo", "utf8");
    const containerMatch = mountinfo.match(/\/var\/lib\/docker\/containers\/([a-f0-9]{64})\//i);
    if (containerMatch?.[1]) return containerMatch[1];

    // cgroup v1: container ID appears directly in cgroup paths like
    // /docker/<id> or /kubepods/.../pod<id>/<id>.
    const cgroupMatch = mountinfo.match(/\/docker\/([a-f0-9]{64})\b/i);
    if (cgroupMatch?.[1]) return cgroupMatch[1];
  } catch {
    // ignore missing proc files
  }

  // Fallback: cgroup files (works on cgroup v1, not v2)
  for (const file of ["/proc/self/cgroup", "/proc/1/cgroup"]) {
    try {
      const raw = await readFile(file, "utf8");
      const match = raw.match(/\/docker\/([a-f0-9]{64})\b/i);
      if (match?.[1]) return match[1];
    } catch {
      // ignore missing proc files
    }
  }

  return null;
}

// Cache the self-container result to avoid repeated expensive lookups and
// noisy error logs on every request.
let selfContainerCache: { containerId: string; name: string } | null = null;
let lastSelfContainerError: Error | null = null;
let lastSelfContainerAttempt = 0;
const SELF_CONTAINER_RETRY_MS = 10000;

export async function getSelfContainer(): Promise<{ containerId: string; name: string }> {
  // Return cached success immediately.
  if (selfContainerCache) return selfContainerCache;

  // If we recently failed, don't hammer the Docker API/filesystem;
  // return the last error until the cooldown expires.
  const now = Date.now();
  if (now - lastSelfContainerAttempt < SELF_CONTAINER_RETRY_MS) {
    throw lastSelfContainerError ?? new Error("Could not resolve self container (cooldown)");
  }

  lastSelfContainerAttempt = now;

  // SELF_CONTAINER_ID is an explicit operator override — trust it immediately
  // without any Docker API calls.  This is the recommended path when
  // auto-discovery is unreliable (cgroup v2, nested containers, etc.).
  const envId = process.env.SELF_CONTAINER_ID?.trim();
  if (envId) {
    selfContainerCache = { containerId: envId, name: envId.slice(0, 12) };
    return selfContainerCache;
  }

  // Fast-fail: if the Docker socket is not reachable there is no point
  // running the entire hostname/proc lookup waterfall — every Docker API call
  // would fail anyway.  Surface a clear, actionable error immediately.
  if (!(await isDockerAvailable())) {
    lastSelfContainerError = new Error(
      `Docker socket is not accessible (${DOCKER_SOCKET_PATH}). ` +
      "Mount /var/run/docker.sock into the proxy container, or set DOCKER_SOCKET_PATH env var. " +
      "Set SELF_CONTAINER_ID env var to the proxy container's full Docker container ID to enable local-tmux attach.",
    );
    throw lastSelfContainerError;
  }

  // Use both the env HOSTNAME and the OS hostname() syscall (they should be
  // identical inside Docker, but os.hostname() can't be overridden by env).
  const { hostname: osHostname } = await import("node:os");
  const envHostname = process.env.HOSTNAME?.trim();
  const hostname = envHostname || osHostname();

  if (hostname) {
    // Attempt direct inspect (Docker resolves 12-char short IDs).
    try {
      const info = await docker.getContainer(hostname).inspect();
      selfContainerCache = { containerId: info.Id, name: info.Name.replace(/^\//, "") };
      return selfContainerCache;
    } catch {
      // fallthrough to list lookup
    }

    try {
      const containers = await docker.listContainers({ all: true });
      const match = containers.find((c) =>
        (c.Id?.startsWith(hostname) ?? false) || (c.Names ?? []).some((n) => n.replace(/^\//, "") === hostname),
      );
      if (match?.Id) {
        selfContainerCache = {
          containerId: match.Id,
          name: (match.Names?.[0] ?? hostname).replace(/^\//, ""),
        };
        return selfContainerCache;
      }
    } catch {
      // fallthrough
    }
  }

  // Use the runtime container ID derived from /proc paths.  The improved
  // extractor reads the Docker-specific path patterns so it returns the real
  // container ID rather than an overlay2 layer ID.
  const runtimeContainerId = await resolveContainerIdFromRuntime();
  if (runtimeContainerId) {
    try {
      const info = await docker.getContainer(runtimeContainerId).inspect();
      selfContainerCache = { containerId: info.Id, name: info.Name.replace(/^\//, "") };
      return selfContainerCache;
    } catch {
      // fallthrough to list-based fuzzy match
    }

    try {
      const containers = await docker.listContainers({ all: true });
      const rid = runtimeContainerId.toLowerCase();
      const match = containers.find((c) => {
        const id = (c.Id ?? "").toLowerCase();
        if (!id) return false;
        return id.startsWith(rid) || rid.startsWith(id);
      });
      if (match?.Id) {
        selfContainerCache = {
          containerId: match.Id,
          name: (match.Names?.[0] ?? match.Id.slice(0, 12)).replace(/^\//, ""),
        };
        return selfContainerCache;
      }
    } catch {
      // fallthrough
    }
  }

  lastSelfContainerError = new Error(
    `Could not resolve current container id (hostname=${hostname ?? "n/a"}, runtimeId=${runtimeContainerId ?? "n/a"}). ` +
    `Set SELF_CONTAINER_ID env var to the full Docker container ID to override.`,
  );
  throw lastSelfContainerError;
}

/** Run a one-shot command in a container and return stdout. */
async function execOneshot(containerId: string, cmd: string[]): Promise<string> {
  const proc = Bun.spawn(["docker", "exec", containerId, ...cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return stdout;
}

/** Parse `ls -la` output into file entries. */
function parseLsLa(output: string, dirPath: string): DockerFileEntry[] {
  const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("total "));
  const entries: DockerFileEntry[] = [];

  for (const line of lines) {
    // Format: <perms> <links> <owner> <group> <size> <month> <day> <time/year> <name>
    const match = line.match(
      /^([\w-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/,
    );
    if (!match) continue;

    const [, perms, sizeStr, nameRaw] = match;
    const typeChar = perms[0];

    // Skip . and .. entries
    if (nameRaw === "." || nameRaw === "..") continue;

    const type: DockerFileEntry["type"] =
      typeChar === "d"
        ? "dir"
        : typeChar === "l"
          ? "symlink"
          : typeChar === "-"
            ? "file"
            : "other";

    const size = parseInt(sizeStr, 10);

    // Handle symlinks: "linkname -> target" → use just "linkname"
    const name = nameRaw.includes(" -> ") ? nameRaw.split(" -> ")[0] : nameRaw;

    const parentPath = dirPath.endsWith("/") && dirPath !== "/" ? dirPath.slice(0, -1) : dirPath;
    const filePath = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;

    entries.push({
      name,
      path: filePath,
      type,
      size: isNaN(size) ? 0 : size,
      permissions: perms,
    });
  }

  return entries;
}

export async function listContainerFiles(
  containerId: string,
  path: string,
): Promise<DockerFileEntry[]> {
  // Sanitize path to prevent injection
  const safePath = path.replace(/['"\\;`$]/g, "");
  const output = await execOneshot(containerId, [
    "sh",
    "-c",
    `ls -la "${safePath}" 2>&1`,
  ]);
  return parseLsLa(output, safePath);
}

export async function previewContainerFile(
  containerId: string,
  path: string,
  limit = 65536,
): Promise<DockerFilePreview> {
  // Sanitize path to prevent injection
  const safePath = path.replace(/['"\\;`$]/g, "");
  const proc = Bun.spawn(
    ["docker", "exec", containerId, "sh", "-c", `cat "${safePath}"`],
    { stdout: "pipe", stderr: "pipe" },
  );

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const reader = proc.stdout.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (remaining <= 0) {
        truncated = true;
        proc.kill();
        break;
      }
      const slice = value.slice(0, remaining);
      chunks.push(slice);
      total += slice.length;
      if (total >= limit) {
        truncated = true;
        proc.kill();
        break;
      }
    }
  } catch {
    // stream ended
  } finally {
    reader.releaseLock();
  }

  await proc.exited;

  const allBytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    allBytes.set(chunk, offset);
    offset += chunk.length;
  }

  // Binary detection: check for null bytes
  let isBinary = false;
  for (const b of allBytes) {
    if (b === 0) {
      isBinary = true;
      break;
    }
  }

  return {
    path: safePath,
    size: total,
    offset: 0,
    limit,
    bytesRead: total,
    truncated,
    kind: isBinary ? "binary" : "text",
    encoding: isBinary ? undefined : "utf-8",
    data: isBinary ? undefined : new TextDecoder("utf-8").decode(allBytes),
  };
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

export async function getTmuxSessions(containerId: string): Promise<TmuxStatus> {
  try {
    const proc = Bun.spawn(
      [
        "docker",
        "exec",
        containerId,
        "tmux",
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_windows}\t#{session_attached}",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return parseTmuxOutput(stdout, stderr, exitCode);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { available: false, status: "error", sessions: [], error: msg };
  }
}

export async function attachExecWebSocket(
  wsData: DockerExecWsData,
  ws: Bun.ServerWebSocket<WsSessionData>,
  onLog?: (message: string, meta?: Record<string, unknown>, level?: "debug" | "info" | "warn" | "error") => void,
): Promise<void> {
  const { containerId, execSessionId, startupTmuxSession } = wsData;

  try {
    const container = docker.getContainer(containerId);

    const shellCmd = startupTmuxSession
      ? (() => {
          const safeSession = startupTmuxSession.replace(/[^a-zA-Z0-9_.:-]/g, "");
          return `export TERM=${"${TERM:-xterm-256color}"}; exec tmux new -A -s ${safeSession}`;
        })()
      : "export TERM=${TERM:-xterm-256color}; if command -v bash >/dev/null 2>&1; then exec bash -il; else exec sh -i; fi";

    onLog?.("exec_create_start", { startupTmuxSession: startupTmuxSession ?? null, shellCmd });

    const exec = await container.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ["TERM=xterm-256color", "COLORTERM=truecolor"],
      Cmd: ["/bin/sh", "-lc", shellCmd],
    });

    onLog?.("exec_created");

    const stream = await (exec.start as (opts: Record<string, unknown>) => Promise<NodeJS.ReadWriteStream>)({
      hijack: true,
      stdin: true,
    });

    onLog?.("exec_started");

    execSessions.set(execSessionId, { stream, exec });

    // Send ready before piping data to avoid clearing an already-rendered prompt on the client.
    ws.send(JSON.stringify({ type: "ready" }));
    onLog?.("ready_sent");

    let chunkCount = 0;
    let totalBytes = 0;

    stream.on("data", (chunk: Buffer) => {
      chunkCount += 1;
      totalBytes += chunk.length;
      if (chunkCount === 1) {
        onLog?.("first_output_chunk", { bytes: chunk.length });
      }
      try {
        ws.send(
          JSON.stringify({
            type: "output",
            data: Buffer.from(chunk).toString("base64"),
          }),
        );
      } catch {
        // ws might have closed
      }
    });

    stream.on("end", () => {
      execSessions.delete(execSessionId);
      onLog?.("stream_end", { chunkCount, totalBytes }, "warn");
      try {
        ws.send(JSON.stringify({ type: "closed" }));
        ws.close();
      } catch {
        // ignore
      }
    });

    stream.on("error", (err: Error) => {
      execSessions.delete(execSessionId);
      onLog?.("stream_error", { error: err.message, chunkCount, totalBytes }, "error");
      try {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.close();
      } catch {
        // ignore
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Exec failed";
    onLog?.("attach_exception", { error: msg }, "error");
    ws.send(JSON.stringify({ type: "error", message: msg }));
    ws.close();
  }
}

export function sendExecInput(execSessionId: string, data: string): void {
  const session = execSessions.get(execSessionId);
  if (!session) return;
  try {
    session.stream.write(data);
  } catch {
    // ignore write errors
  }
}

export function resizeExecTerminal(
  execSessionId: string,
  cols: number,
  rows: number,
): void {
  const session = execSessions.get(execSessionId);
  if (!session) return;
  try {
    void (session.exec.resize as (opts: { h: number; w: number }) => Promise<void>)({ h: rows, w: cols });
  } catch {
    // ignore resize errors
  }
}

export function detachExecWebSocket(execSessionId: string): void {
  const session = execSessions.get(execSessionId);
  if (session) {
    try {
      (session.stream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy?.();
    } catch {
      // ignore
    }
    execSessions.delete(execSessionId);
  }
}
