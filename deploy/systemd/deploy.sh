#!/usr/bin/env bash
#
# Redeploys the current working tree to a systemd install done via
# ./deploy/systemd/install.sh -- the update counterpart to that script.
# Backs up the running backend/frontend first, syncs the new code in,
# reinstalls Python deps only if requirements.txt actually changed,
# restarts the service, and waits for /api/health to come back.
#
# Run as your normal user (not root) from the repo root -- it calls
# `sudo` itself for the steps that need it, and `npm run build` should
# run as you, not root, or it leaves root-owned files in frontend/.
#
# Usage:
#   ./deploy/systemd/deploy.sh                 # test, build, deploy, restart
#   ./deploy/systemd/deploy.sh --skip-tests     # skip the pytest/tsc/vitest gate
#   ./deploy/systemd/deploy.sh --dry-run        # print what would happen, change nothing
#   ./deploy/systemd/deploy.sh rollback         # restore the most recent backup
#   ./deploy/systemd/deploy.sh rollback <stamp> # restore a specific backup (see ls BACKUP_ROOT)
#
# Override any of these to match your setup (defaults match what
# install.sh creates):
INSTALL_DIR="${INSTALL_DIR:-/opt/homelab-dashboard}"
FRONTEND_INSTALL_DIR="${FRONTEND_INSTALL_DIR:-/opt/homelab-dashboard-frontend}"
SERVICE_NAME="${SERVICE_NAME:-homelab-dashboard}"
SERVICE_USER="${SERVICE_USER:-homelab-dashboard}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/homelab-dashboard-backups}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/api/health}"

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # repo root, regardless of where this is invoked from

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root -- it calls sudo itself where needed" >&2
  echo "(running 'npm run build' as root leaves root-owned files in frontend/)." >&2
  exit 1
fi

if [[ ! -d backend ]] || [[ ! -d frontend ]]; then
  echo "Run this from the repo root (or leave it where it is in deploy/systemd/)." >&2
  exit 1
fi

DRY_RUN=0
SKIP_TESTS=0
ACTION="deploy"
ROLLBACK_STAMP=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    rollback) ACTION="rollback" ;;
    *)
      if [[ "$ACTION" == "rollback" && -z "$ROLLBACK_STAMP" ]]; then
        ROLLBACK_STAMP="$arg"
      else
        echo "Unrecognized argument: $arg" >&2
        exit 1
      fi
      ;;
  esac
done

run() {
  echo "+ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

wait_for_health() {
  echo "==> Waiting for $HEALTH_URL ..."
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "    (dry run -- skipping)"
    return 0
  fi
  for _ in $(seq 1 30); do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
      echo "==> Backend is healthy."
      return 0
    fi
    sleep 1
  done
  echo "!! Backend did not become healthy within 30s -- check: sudo journalctl -u $SERVICE_NAME -n 50" >&2
  return 1
}

# ----------------------------------------------------------------------
# Rollback
# ----------------------------------------------------------------------
if [[ "$ACTION" == "rollback" ]]; then
  if [[ -z "$ROLLBACK_STAMP" ]]; then
    ROLLBACK_STAMP=$(sudo ls -1 "$BACKUP_ROOT" 2>/dev/null | sort | tail -1)
    if [[ -z "$ROLLBACK_STAMP" ]]; then
      echo "No backups found under $BACKUP_ROOT." >&2
      exit 1
    fi
    echo "==> No timestamp given -- using the most recent backup: $ROLLBACK_STAMP"
  fi
  BACKUP_DIR="$BACKUP_ROOT/$ROLLBACK_STAMP"
  if ! sudo test -d "$BACKUP_DIR"; then
    echo "No backup at $BACKUP_DIR" >&2
    echo "Available backups:" >&2
    sudo ls -1 "$BACKUP_ROOT" 2>/dev/null >&2 || true
    exit 1
  fi

  echo "==> Rolling back to $BACKUP_DIR"
  run sudo rm -rf "$INSTALL_DIR/backend"
  run sudo cp -a "$BACKUP_DIR/backend" "$INSTALL_DIR/backend"
  run sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/backend"

  run sudo find "$FRONTEND_INSTALL_DIR" -mindepth 1 -delete
  run sudo cp -a "$BACKUP_DIR/frontend/." "$FRONTEND_INSTALL_DIR/"
  run sudo chown -R root:root "$FRONTEND_INSTALL_DIR"

  run sudo systemctl restart "$SERVICE_NAME"
  wait_for_health
  echo "==> Rolled back to $ROLLBACK_STAMP."
  exit 0
fi

# ----------------------------------------------------------------------
# Deploy
# ----------------------------------------------------------------------

if [[ $SKIP_TESTS -eq 0 ]]; then
  echo "==> Running backend tests"
  run bash -c 'source .venv/bin/activate 2>/dev/null || true; python -m pytest backend/tests -q'

  echo "==> Typechecking + testing frontend"
  run bash -c 'cd frontend && npx tsc -b && npx vitest run'
else
  echo "==> Skipping tests (--skip-tests)"
fi

echo "==> Building frontend"
run bash -c 'cd frontend && npm run build'

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
echo "==> Backing up current deployment to $BACKUP_DIR"
run sudo mkdir -p "$BACKUP_DIR"
run sudo cp -a "$INSTALL_DIR/backend" "$BACKUP_DIR/backend"
run sudo cp -a "$FRONTEND_INSTALL_DIR" "$BACKUP_DIR/frontend"

echo "==> Checking for backend dependency changes"
if ! sudo diff -q backend/requirements.txt "$INSTALL_DIR/backend/requirements.txt" >/dev/null 2>&1; then
  echo "    requirements.txt changed -- reinstalling into the venv"
  # Via a world-readable temp copy: the service user usually can't read a
  # repo under someone's home directory (e.g. /home/you is 0700).
  REQS=$(mktemp)
  cp backend/requirements.txt "$REQS"
  chmod 644 "$REQS"
  run sudo -u "$SERVICE_USER" "$INSTALL_DIR/.venv/bin/pip" install -r "$REQS"
  rm -f "$REQS"
else
  echo "    unchanged -- skipping pip install"
fi

echo "==> Deploying backend to $INSTALL_DIR/backend"
run sudo cp -a backend/. "$INSTALL_DIR/backend/"
run sudo find "$INSTALL_DIR/backend" -name "__pycache__" -type d -exec rm -rf {} +
run sudo find "$INSTALL_DIR/backend" -name ".pytest_cache" -type d -exec rm -rf {} +
run sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/backend"

echo "==> Deploying frontend to $FRONTEND_INSTALL_DIR"
run sudo find "$FRONTEND_INSTALL_DIR" -mindepth 1 -delete
run sudo cp -a frontend/dist/. "$FRONTEND_INSTALL_DIR/"
run sudo chown -R root:root "$FRONTEND_INSTALL_DIR"

echo "==> Restarting $SERVICE_NAME"
run sudo systemctl restart "$SERVICE_NAME"
wait_for_health

echo "==> Done. Backup of the previous deployment: $BACKUP_DIR"
echo "    Roll back with: $0 rollback $STAMP"
