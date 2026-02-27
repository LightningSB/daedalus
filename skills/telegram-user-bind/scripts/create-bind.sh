#!/usr/bin/env bash
set -euo pipefail

# telegram-user-bind helper
# Default user: 345351719 (override with --user)

API_BASE_DEFAULT="https://api.daedalus.wheelbase.io/api"
DEFAULT_USER_ID="345351719"

ACTION="create"
USER_ID="$DEFAULT_USER_ID"
TITLE=""
KIND="ssh-host"
HOST_ID=""
CONTAINER_ID=""
TMUX_SESSION="main"
RAW_COMMAND=""
BIND_ID=""
API_BASE="${DAEDALUS_API_BASE:-$API_BASE_DEFAULT}"
AUTH_HEADER="${DAEDALUS_AUTH_HEADER:-}"

usage() {
  cat <<EOF
Usage:
  $0 create [options]
  $0 list [--user <telegramUserId>] [--api-base <url>] [--auth-header "Header: value"]
  $0 delete --bind-id <bindId> [--user <telegramUserId>] [--api-base <url>] [--auth-header "Header: value"]

Actions:
  create (default)   Create a tmux bind
  list               List existing binds
  delete             Delete one bind

Create options:
  --title <text>                 Bind title (required)
  --kind <ssh-host|ssh-host-docker|ssh-raw>
  --host-id <id>                 Required for ssh-host and ssh-host-docker
  --container-id <id>            Required for ssh-host-docker
  --tmux-session <name>          Default: main
  --raw-command <command>        Required for ssh-raw

Common options:
  --user <telegramUserId>        Default: 345351719
  --api-base <url>               Default: https://api.daedalus.wheelbase.io/api
  --auth-header "Header: value" Optional auth header sent to API
  -h, --help                     Show help

Examples:
  $0 create --title "Main Shell" --kind ssh-host --host-id host-123 --tmux-session main
  $0 create --title "App Container" --kind ssh-host-docker --host-id host-123 --container-id ctn-1 --tmux-session app
  $0 create --title "Raw Bind" --kind ssh-raw --raw-command "ssh sb@34.186.124.156" --tmux-session raw
  $0 list
  $0 delete --bind-id bind-abc123
EOF
}

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//"/\\"}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

send_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local curl_args=( -sS -X "$method" "$API_BASE$path" -H "Content-Type: application/json" )
  if [[ -n "$AUTH_HEADER" ]]; then
    curl_args+=( -H "$AUTH_HEADER" )
  fi
  if [[ -n "$body" ]]; then
    curl_args+=( -d "$body" )
  fi

  curl "${curl_args[@]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    create|list|delete)
      ACTION="$1"
      shift
      ;;
    --user)
      USER_ID="$2"; shift 2 ;;
    --title)
      TITLE="$2"; shift 2 ;;
    --kind)
      KIND="$2"; shift 2 ;;
    --host-id)
      HOST_ID="$2"; shift 2 ;;
    --container-id)
      CONTAINER_ID="$2"; shift 2 ;;
    --tmux-session)
      TMUX_SESSION="$2"; shift 2 ;;
    --raw-command)
      RAW_COMMAND="$2"; shift 2 ;;
    --bind-id)
      BIND_ID="$2"; shift 2 ;;
    --api-base)
      API_BASE="$2"; shift 2 ;;
    --auth-header)
      AUTH_HEADER="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$USER_ID" =~ ^[0-9]+$ ]]; then
  echo "Error: --user must be numeric telegram user id" >&2
  exit 1
fi

case "$ACTION" in
  list)
    send_request GET "/users/$USER_ID/tmux/binds" | (command -v jq >/dev/null 2>&1 && jq . || cat)
    ;;

  delete)
    if [[ -z "$BIND_ID" ]]; then
      echo "Error: delete requires --bind-id" >&2
      exit 1
    fi
    send_request DELETE "/users/$USER_ID/tmux/binds/$BIND_ID" | (command -v jq >/dev/null 2>&1 && jq . || cat)
    ;;

  create)
    if [[ -z "$TITLE" ]]; then
      echo "Error: create requires --title" >&2
      exit 1
    fi

    local_target=""
    case "$KIND" in
      ssh-host)
        if [[ -z "$HOST_ID" ]]; then
          echo "Error: --host-id is required for ssh-host" >&2
          exit 1
        fi
        local_target="{\"kind\":\"ssh-host\",\"hostId\":\"$(json_escape "$HOST_ID")\",\"tmuxSession\":\"$(json_escape "$TMUX_SESSION")\"}"
        ;;

      ssh-host-docker)
        if [[ -z "$HOST_ID" || -z "$CONTAINER_ID" ]]; then
          echo "Error: --host-id and --container-id are required for ssh-host-docker" >&2
          exit 1
        fi
        local_target="{\"kind\":\"ssh-host-docker\",\"hostId\":\"$(json_escape "$HOST_ID")\",\"containerId\":\"$(json_escape "$CONTAINER_ID")\",\"tmuxSession\":\"$(json_escape "$TMUX_SESSION")\"}"
        ;;

      ssh-raw)
        if [[ -z "$RAW_COMMAND" ]]; then
          echo "Error: --raw-command is required for ssh-raw" >&2
          exit 1
        fi
        local_target="{\"kind\":\"ssh-raw\",\"rawCommand\":\"$(json_escape "$RAW_COMMAND")\",\"tmuxSession\":\"$(json_escape "$TMUX_SESSION")\"}"
        ;;

      *)
        echo "Error: invalid --kind '$KIND'" >&2
        exit 1
        ;;
    esac

    payload="{\"title\":\"$(json_escape "$TITLE")\",\"target\":$local_target}"
    send_request POST "/users/$USER_ID/tmux/binds" "$payload" | (command -v jq >/dev/null 2>&1 && jq . || cat)
    ;;

  *)
    echo "Error: unknown action '$ACTION'" >&2
    exit 1
    ;;
esac
