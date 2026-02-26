import { parse as parseShell } from "shell-quote";

export type LocalForward = {
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
};

export type RemoteForward = {
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
};

export type DynamicForward = {
  bindHost: string;
  bindPort: number;
};

export type ParsedSshCommand = {
  username?: string;
  host?: string;
  port?: number;
  identityFile?: string;
  localForwards: LocalForward[];
  remoteForwards: RemoteForward[];
  dynamicForwards: DynamicForward[];
};

function parsePort(value: string, field: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return port;
}

function parseForwardParts(spec: string, kind: "L" | "R"): LocalForward | RemoteForward {
  const parts = spec.split(":");
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(`Invalid -${kind} spec: ${spec}`);
  }

  const withBind = parts.length === 4;
  const bindHost = withBind ? parts[0] : "127.0.0.1";
  const bindPort = parsePort(parts[withBind ? 1 : 0], `-${kind} bind port`);
  const targetHost = parts[withBind ? 2 : 1];
  const targetPort = parsePort(parts[withBind ? 3 : 2], `-${kind} target port`);

  return {
    bindHost,
    bindPort,
    targetHost,
    targetPort,
  };
}

function parseDynamicSpec(spec: string): DynamicForward {
  const parts = spec.split(":");
  if (parts.length !== 1 && parts.length !== 2) {
    throw new Error(`Invalid -D spec: ${spec}`);
  }

  const bindHost = parts.length === 2 ? parts[0] : "127.0.0.1";
  const bindPort = parsePort(parts[parts.length - 1], "-D port");

  return {
    bindHost,
    bindPort,
  };
}

function toToken(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Unsupported shell token");
  }
  return input;
}

export function parseSshCommand(command?: string): ParsedSshCommand {
  const out: ParsedSshCommand = {
    localForwards: [],
    remoteForwards: [],
    dynamicForwards: [],
  };

  if (!command || !command.trim()) {
    return out;
  }

  const tokens = parseShell(command).map(toToken);
  let i = 0;

  if (tokens[0] === "ssh") {
    i += 1;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === "-i" || token === "-p" || token === "-L" || token === "-R" || token === "-D") {
      const value = tokens[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}`);
      }

      if (token === "-i") {
        out.identityFile = value;
      } else if (token === "-p") {
        out.port = parsePort(value, "port");
      } else if (token === "-L") {
        out.localForwards.push(parseForwardParts(value, "L") as LocalForward);
      } else if (token === "-R") {
        out.remoteForwards.push(parseForwardParts(value, "R") as RemoteForward);
      } else if (token === "-D") {
        out.dynamicForwards.push(parseDynamicSpec(value));
      }

      i += 2;
      continue;
    }

    if (token.startsWith("-p") && token.length > 2) {
      out.port = parsePort(token.slice(2), "port");
      i += 1;
      continue;
    }

    if (token.startsWith("-i") && token.length > 2) {
      out.identityFile = token.slice(2);
      i += 1;
      continue;
    }

    if (token.startsWith("-L") && token.length > 2) {
      out.localForwards.push(parseForwardParts(token.slice(2), "L") as LocalForward);
      i += 1;
      continue;
    }

    if (token.startsWith("-R") && token.length > 2) {
      out.remoteForwards.push(parseForwardParts(token.slice(2), "R") as RemoteForward);
      i += 1;
      continue;
    }

    if (token.startsWith("-D") && token.length > 2) {
      out.dynamicForwards.push(parseDynamicSpec(token.slice(2)));
      i += 1;
      continue;
    }

    if (!token.startsWith("-") && token.includes("@")) {
      const [username, host] = token.split("@");
      out.username = username;
      out.host = host;
      i += 1;
      continue;
    }

    if (!token.startsWith("-") && !out.host) {
      out.host = token;
      i += 1;
      continue;
    }

    i += 1;
  }

  return out;
}
