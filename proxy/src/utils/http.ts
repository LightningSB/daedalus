export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const body = await request.text();
  if (!body) {
    return {} as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

export function getVaultToken(request: Request): string | null {
  const explicit = request.headers.get("x-vault-token");
  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function parsePath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}
