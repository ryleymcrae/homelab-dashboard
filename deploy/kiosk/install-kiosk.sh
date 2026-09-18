#!/usr/bin/env bash
#
# Configures a Raspberry Pi (Raspberry Pi OS, Debian-based, with a desktop
# environment) as a dedicated kiosk display for the dashboard. Intended
# for a 7" 800x480 touchscreen, but works at any resolution.
#
# This does NOT install the dashboard backend itself -- point it at any
# reachable dashboard URL, local or remote. Run the dashboard on the same
# Pi, another Pi, a NAS, or a server elsewhere on your LAN.
#
# Usage:
#   ./deploy/kiosk/install-kiosk.sh http://192.168.1.11:8080
#
set -euo pipefail

DASHBOARD_URL="${1:-}"
if [[ -z "$DASHBOARD_URL" ]]; then
  echo "Usage: $0 <dashboard-url>" >&2
  echo "Example: $0 http://192.168.1.11:8080" >&2
  exit 1
fi

echo "==> Installing Chromium and kiosk dependencies"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  chromium-browser \
  unclutter \
  xdotool

AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/homelab-dashboard-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Homelab Dashboard Kiosk
Exec=$HOME/homelab-dashboard-kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

cat > "$HOME/homelab-dashboard-kiosk.sh" <<EOF
#!/usr/bin/env bash
# Hides the cursor after 1s of inactivity.
unclutter -idle 1 -root &

# Disables screen blanking/DPMS so the kiosk display never goes dark
# unless configured to via the dashboard's own Settings > Display page.
xset s off
xset s noblank
xset -dpms

# Auto-restarts Chromium if it crashes (spec section 26).
while true; do
  chromium-browser \\
    --kiosk \\
    --noerrdialogs \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-pinch \\
    --overscroll-history-navigation=0 \\
    --app="$DASHBOARD_URL" \\
    --start-fullscreen
  sleep 2
done
EOF
chmod +x "$HOME/homelab-dashboard-kiosk.sh"

echo "==> Kiosk autostart installed for URL: $DASHBOARD_URL"
echo "==> Reboot the Pi to launch the kiosk, or run: $HOME/homelab-dashboard-kiosk.sh"
echo "==> See docs/kiosk.md for touchscreen calibration and screen rotation notes."
