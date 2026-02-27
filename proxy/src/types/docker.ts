// Shared Docker types for proxy API

export interface DockerContainerSummary {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  created: number;
  ports: Array<{
    ip?: string;
    privatePort: number;
    publicPort?: number;
    type: string;
  }>;
  labels: Record<string, string>;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  state: {
    status: string;
    running: boolean;
    paused: boolean;
    restarting: boolean;
    pid: number;
    startedAt: string;
    finishedAt: string;
  };
  config: {
    hostname: string;
    image: string;
    cmd: string[];
    env: string[];
    labels: Record<string, string>;
    workingDir: string;
  };
  networkSettings: {
    ipAddress: string;
    ports: Record<string, unknown>;
  };
  mounts: Array<{
    type: string;
    source: string;
    destination: string;
    mode: string;
  }>;
}

export interface DockerFileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  permissions?: string;
}

export interface DockerFilePreview {
  path: string;
  size: number;
  offset: number;
  limit: number;
  bytesRead: number;
  truncated: boolean;
  kind: "text" | "binary";
  encoding?: "utf-8";
  data?: string;
}

export interface ComposeCliService {
  name: string;
  image?: string;
  description?: string;
  profiles: string[];
  command?: string;
}

export interface ComposeProject {
  name: string;
  status: string;
  configFiles: string[];
  services: ComposeCliService[];
}

export interface TaskEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data?: string;
  code?: number;
  message?: string;
}

// Tmux session info
export interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
  raw: string;
}

export type TmuxStatusKind = "not-installed" | "no-server" | "ok" | "error";

export interface TmuxStatus {
  available: boolean;
  status: TmuxStatusKind;
  sessions: TmuxSession[];
  error?: string;
}

// WebSocket data discriminated union for Bun.serve
export type SshWsData = {
  kind: "ssh";
  userId: string;
  sessionId: string;
};

export type DockerExecWsData = {
  kind: "docker-exec";
  containerId: string;
  execSessionId: string;
  startupTmuxSession?: string;
};

export type SshDockerExecWsData = {
  kind: "ssh-docker-exec";
  userId: string;
  sessionId: string;
  containerId: string;
  execSessionId: string;
};

export type UserEventsWsData = {
  kind: 'user-events';
  userId: string;
};

export type WsSessionData = SshWsData | DockerExecWsData | SshDockerExecWsData | UserEventsWsData;
