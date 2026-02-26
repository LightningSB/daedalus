# Daedalus SSH Workbench

Daedalus is now focused on a secure, mobile-friendly SSH terminal experience.

## Architecture

- **Frontend (React + Vite + xterm.js)**
  - Multi-session terminal tabs
  - xterm-256color terminal with fit/search/weblinks/webgl addons
  - Mobile control bar (`Ctrl`, `Esc`, arrows, `PgUp/PgDn`, `Home/End`, `Ctrl+C`, `Ctrl+D`, paste)
  - Vault UI (init/unlock/lock) and recovery phrase download

- **Backend (Bun + TypeScript)**
  - `bun serve` API in `proxy/src/index.ts`
  - SSH session orchestration via `ssh2`
  - WebSocket stream bridge for interactive TUI apps (vim/tmux/codex)
  - Full SSH command parsing (`-i`, `-p`, `-L`, `-R`, `-D`)
  - Tunnels are constrained to **internal loopback (`127.0.0.1`)**

- **Persistence (MinIO)**
  - Saved hosts per user
  - Known-host fingerprints (TOFU + pinning)
  - Encrypted vault payloads
  - Metadata-only SSH audit logs (connect/disconnect)

## Data model (MinIO)

Per user (`users/{tgUserId}`):

- `ssh-hosts.json`
- `known-hosts.json`
- `vault.json`

Audit logs:

- `audit/YYYY-MM-DD.jsonl`

## Security model

- Host allowlist via `SSH_ALLOWED_HOSTS` (default `34.186.124.156`)
- TOFU host key verification with strict mismatch rejection
- Vault uses encrypted wrappers (passphrase + recovery phrase)
- Vault unlock token TTL: 30 minutes inactivity
- Passwords/keys are encrypted-at-rest in MinIO
