---
name: telegram-user-bind
description: Create and manage tmux bind records scoped to Telegram user 345351719 by default (overrideable).
---

# telegram-user-bind

Create user-scoped tmux bind records for Daedalus so they appear in the sidebar and open tmux sessions.

## Default target user
- Default Telegram user id: `345351719`
- Override by passing a different `userId` in your request.

## API endpoints used
- `GET /api/users/:userId/tmux/binds`
- `POST /api/users/:userId/tmux/binds`
- `DELETE /api/users/:userId/tmux/binds/:bindId`

## Bind payload schema

```json
{
  "title": "Infra tmux",
  "target": {
    "kind": "ssh-host",
    "hostId": "host-uuid",
    "tmuxSession": "infra"
  }
}
```

Target variants:

```ts
{ kind: 'ssh-host', hostId: string, tmuxSession: string }
{ kind: 'ssh-host-docker', hostId: string, containerId: string, tmuxSession: string }
{ kind: 'ssh-raw', rawCommand: string, tmuxSession: string }
```

## Usage workflow

1) Choose target user id (default `345351719`)
2) Create bind via POST (or script)
3) Return `bind` and `viewerUrl`
4) Optionally list binds to verify
5) Optionally delete outdated binds

## Helper script

Use the bundled helper script:

`skills/telegram-user-bind/scripts/create-bind.sh`

Quick examples:

```bash
# Create bind (default user 345351719)
bash skills/telegram-user-bind/scripts/create-bind.sh create \
  --title "Main Shell" \
  --kind ssh-host \
  --host-id host-123 \
  --tmux-session main

# List binds
bash skills/telegram-user-bind/scripts/create-bind.sh list

# Delete bind
bash skills/telegram-user-bind/scripts/create-bind.sh delete --bind-id bind-abc123
```

Optional environment overrides:
- `DAEDALUS_API_BASE` (default: `https://api.daedalus.wheelbase.io/api`)
- `DAEDALUS_AUTH_HEADER` (e.g. `"Authorization: Bearer <token>"`)

## Example requests

### Create bind (default user)

```bash
curl -X POST "https://api.daedalus.wheelbase.io/api/users/345351719/tmux/binds" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Main Shell",
    "target": {
      "kind": "ssh-host",
      "hostId": "my-host-id",
      "tmuxSession": "main"
    }
  }'
```

### List binds

```bash
curl "https://api.daedalus.wheelbase.io/api/users/345351719/tmux/binds"
```

### Delete bind

```bash
curl -X DELETE "https://api.daedalus.wheelbase.io/api/users/345351719/tmux/binds/<bindId>"
```

## Safety checks
- Validate `userId` is numeric string.
- Validate `title` is non-empty.
- Validate `target.kind` and required fields per kind.
- Never mix users across requests.
- Prefer server-side Telegram initData verification for production.

## Notes
- This skill is intentionally user-scoped by default for Simon’s workflow.
- Keep user id configurable for future multi-user support.
