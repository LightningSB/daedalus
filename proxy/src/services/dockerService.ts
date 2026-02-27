import Dockerode from "dockerode";
import type { DockerContainerInfo, DockerContainerSummary, DockerExecWsData, DockerFileEntry, DockerFilePreview, WsSessionData } from "../types/docker";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

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
    names: c.Names.map((n) => n.replace(/^\//, "")),
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

export async function attachExecWebSocket(
  wsData: DockerExecWsData,
  ws: Bun.ServerWebSocket<WsSessionData>,
): Promise<void> {
  const { containerId, execSessionId } = wsData;

  try {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ["/bin/sh", "-c", "(bash 2>/dev/null) || sh"],
    });

    const stream = await (exec.start as (opts: Record<string, unknown>) => Promise<NodeJS.ReadWriteStream>)({
      hijack: true,
      stdin: true,
    });

    execSessions.set(execSessionId, { stream, exec });

    stream.on("data", (chunk: Buffer) => {
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
      try {
        ws.send(JSON.stringify({ type: "closed" }));
        ws.close();
      } catch {
        // ignore
      }
    });

    stream.on("error", (err: Error) => {
      execSessions.delete(execSessionId);
      try {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        ws.close();
      } catch {
        // ignore
      }
    });

    ws.send(JSON.stringify({ type: "ready" }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Exec failed";
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
