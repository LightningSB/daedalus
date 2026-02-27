import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { ComposeCliService, ComposeProject, TaskEvent } from "../types/docker";

interface DockerComposeLsItem {
  Name: string;
  Status: string;
  ConfigFiles: string;
}

export async function listComposeProjects(): Promise<ComposeProject[]> {
  try {
    const proc = Bun.spawn(
      ["docker", "compose", "ls", "--format", "json", "--all"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);

    let items: DockerComposeLsItem[] = [];
    try {
      items = JSON.parse(stdout) ?? [];
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
          const content = readFileSync(configFile, "utf-8");
          const compose = parseYaml(content) as Record<string, unknown>;
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
                  labels["com.daedalus.description"] ??
                  labels["description"] ??
                  undefined,
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

export async function runComposeTask(
  projectName: string,
  configFile: string,
  service: string,
  args: string[],
  onEvent: (event: TaskEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const cmd = [
    "docker",
    "compose",
    "--project-name",
    projectName,
    "--file",
    configFile,
    "--profile",
    "cli",
    "run",
    "--rm",
    service,
    ...args,
  ];

  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (signal) {
    signal.addEventListener("abort", () => {
      try {
        proc.kill();
      } catch {
        // ignore kill errors
      }
    });
  }

  const decoder = new TextDecoder();

  async function drainStream(
    stream: ReadableStream<Uint8Array>,
    type: "stdout" | "stderr",
  ) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onEvent({ type, data: decoder.decode(value, { stream: true }) });
      }
    } catch {
      // stream ended
    } finally {
      reader.releaseLock();
    }
  }

  await Promise.all([
    drainStream(proc.stdout, "stdout"),
    drainStream(proc.stderr, "stderr"),
    proc.exited,
  ]);

  const exitCode = await proc.exited;
  onEvent({ type: "exit", code: exitCode });
  return exitCode;
}
