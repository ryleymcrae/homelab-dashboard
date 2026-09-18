#!/usr/bin/env bash
#
# Installs the dashboard backend as a native systemd service, for users
# who don't want to run it in Docker. The frontend is still just static
# files -- serve them with any web server (nginx config in deploy/nginx.conf
# is a reasonable default) or run `npm run build` and point a server at
# frontend/dist.
#
# Usage: sudo ./deploy/systemd/install.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./deploy/systemd/install.sh)" >&2
  exit 1
fi

INSTALL_DIR=/opt/homelab-dashboard
CONFIG_DIR=/etc/homelab-dashboard
DATA_DIR=/data

id -u homelab-dashboard &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin homelab-dashboard

# Without this, `journalctl -u <unit>` (the systemd adapter's log viewer --
# backend/adapters/systemd_adapter.py) fails for every unit with "No
# journal files were opened due to insufficient permissions", since a
# plain unprivileged user can only read its own logs.
usermod -aG systemd-journal homelab-dashboard

# Without this, the Docker adapter can't reach /var/run/docker.sock
# (root:docker 0660 by default) -- every `type: docker` service degrades
# to Status.UNKNOWN with "docker_unavailable". Only matters if you
# actually configure docker services; harmless otherwise.
if getent group docker &>/dev/null; then
  usermod -aG docker homelab-dashboard
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR"
cp -r backend "$INSTALL_DIR/"

if [[ ! -f "$CONFIG_DIR/config.yml" ]]; then
  cp config.example.yml "$CONFIG_DIR/config.yml"
  echo "Wrote default config to $CONFIG_DIR/config.yml -- edit it before starting."
fi

python3 -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/backend/requirements.txt"

chown -R homelab-dashboard:homelab-dashboard "$INSTALL_DIR" "$DATA_DIR" "$CONFIG_DIR"

cp deploy/systemd/homelab-dashboard.service /etc/systemd/system/homelab-dashboard.service
systemctl daemon-reload
systemctl enable --now homelab-dashboard.service

echo "Installed. Check status with: systemctl status homelab-dashboard"
echo "Edit $CONFIG_DIR/config.yml then: systemctl restart homelab-dashboard"
