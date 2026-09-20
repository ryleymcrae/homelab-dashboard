# Kiosk mode

Turns a Raspberry Pi with a touchscreen into a dedicated dashboard
display. Entirely optional — the frontend is a normal web app that runs
in any browser.

## Quick setup

On the Pi (Raspberry Pi OS with a desktop environment):

```bash
git clone https://github.com/ryleymcrae/homelab-dashboard/ homelab-dashboard
cd homelab-dashboard
./deploy/kiosk/install-kiosk.sh http://<dashboard-host>:8080
sudo reboot
```

The Pi will boot directly into a fullscreen, chrome-less browser pointed
at your dashboard, with the cursor hidden after a second of inactivity
and screen blanking disabled. If the browser crashes, it restarts
automatically.

## Headless / no-desktop-environment setup

If you're running Raspberry Pi OS Lite (no desktop), use the `cage`
compositor instead:

```bash
sudo apt-get install cage chromium-browser
sudo cp deploy/kiosk/homelab-dashboard-kiosk.service /etc/systemd/system/
sudo systemctl edit homelab-dashboard-kiosk.service   # set DASHBOARD_URL and User=
sudo systemctl enable --now homelab-dashboard-kiosk.service
```

## Recommended hardware

A 7" 800×480 touchscreen is the canonical target resolution for this
project's default theme — every page is designed to fit without
scrolling at that size. 480×320 and 1024×600 are also supported with
simplified layouts; see `docs/configuration.md` and the responsive
notes in `docs/architecture.md`.

## Touchscreen calibration

Most official Raspberry Pi touchscreens work out of the box. If touch
input is offset or rotated, use `DISPLAY=:0 xinput_calibrator` (install
via `apt-get install xinput-calibrator`) or add a rotation transform to
your X config — this is standard Raspberry Pi OS touchscreen setup and
not specific to this project.

## Screen rotation

Add to `/boot/firmware/config.txt` (or `/boot/config.txt` on older
images):

```
display_hdmi_rotate=1   # 90 degrees; 0/1/2/3 for 0/90/180/270
```

## Changing the dashboard URL later

Edit `~/homelab-dashboard-kiosk.sh` (desktop-environment setup) or the
`DASHBOARD_URL` environment variable in the systemd unit (headless
setup), then restart the kiosk process.
