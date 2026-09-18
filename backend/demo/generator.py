"""
Demo mode.

Generates realistic simulated data so contributors can develop/screenshot
the UI without a real homelab (spec section 28). Activated only via
`demo_mode: true` in config.yml -- never mixed silently with real
collector output. The API layer checks this flag once at startup and
routes entirely to either the real collector pipeline or this module.
"""
from __future__ import annotations

import math
import random
import time

from backend.models.core import (
    Action,
    ActionKind,
    BackupStatus,
    FailureDetail,
    FleetSummary,
    HostAction,
    HostActionKind,
    HostInfo,
    LogLine,
    Metric,
    MetricType,
    NetworkTarget,
    NetworkTraffic,
    ScheduledJob,
    Service,
    Status,
)
from backend.providers.base import ContainerConfig, ImageState

_start = time.time()


def _wave_at(t: float, period_s: float, amplitude: float, offset: float, phase: float = 0.0) -> float:
    """The underlying signal, evaluated at an arbitrary point on the
    timeline (seconds since `_start`) rather than always "now" -- lets
    demo_history() backfill a plausible-looking past for a range that's
    longer than this process has actually been running, by simply
    evaluating the same wave at negative t."""
    return offset + amplitude * math.sin((t / period_s) * 2 * math.pi + phase)


def _wave(period_s: float, amplitude: float, offset: float, phase: float = 0.0) -> float:
    return _wave_at(time.time() - _start, period_s, amplitude, offset, phase)


def _with_spikes(value: float, low: float, high: float, spike_chance: float = 0.05, spike_mult: float = 1.6) -> float:
    """Occasional spikes on top of the smooth wave signal -- real hosts
    don't move in pure sine curves, and a chart that never spikes reads as
    obviously fake. Rare and clamped, same as every other simulated value
    here: plausible, not random noise."""
    if random.random() < spike_chance:
        value *= spike_mult
    return round(max(low, min(high, value)), 1)


def demo_hosts() -> list[HostInfo]:
    """Every configured host, collected identically -- the local machine
    plus a remote one with a full agent and a remote one monitored via
    reachability only, so the multi-host UI is exercised in demo mode
    the same way it would be for a real setup (spec section 28)."""
    # Occasional larger spikes here (on top of the normal wave jitter)
    # are deliberate, not just cosmetic realism -- they're what lets the
    # alerting system's thresholds (default 90%/90%/70°C) actually fire
    # hands-off in demo mode instead of sitting comfortably under them
    # forever (spec: "have the mock metrics occasionally cross a
    # threshold so the full alert lifecycle... can be tested end to
    # end").
    cpu = _with_spikes(max(2.0, _wave(90, 18, 22) + random.uniform(-3, 3)), 2.0, 98.0, spike_chance=0.04, spike_mult=3.0)
    mem = _with_spikes(max(5.0, _wave(240, 10, 42) + random.uniform(-2, 2)), 5.0, 96.0, spike_chance=0.04, spike_mult=2.2)
    temp = _with_spikes(max(30.0, _wave(150, 6, 47) + random.uniform(-1, 1)), 30.0, 85.0, spike_chance=0.04, spike_mult=1.5)
    local = HostInfo(
        id="ziri-mini",
        name="ziri-mini",
        address="192.168.1.11",
        status=Status.ONLINE,
        model="Lenovo M720q",
        icon="server",
        uptime_seconds=int(6 * 86400 + 14 * 3600 + 27 * 60),
        cpu_percent=round(cpu, 1),
        cpu_cores=4,
        cpu_freq_mhz=2800,
        mem_percent=round(mem, 1),
        mem_used_bytes=int(6.8 * 1024**3),
        mem_total_bytes=int(16 * 1024**3),
        disk_percent=37.0,
        disk_used_bytes=int(118 * 1024**3),
        disk_total_bytes=int(320 * 1024**3),
        temperature_c=round(temp, 1),
        is_local=True,
    )

    nas_cpu = _with_spikes(max(2.0, _wave(120, 12, 15) + random.uniform(-2, 2)), 2.0, 98.0, spike_chance=0.04, spike_mult=3.5)
    nas_mem = _with_spikes(max(5.0, _wave(200, 8, 55) + random.uniform(-2, 2)), 5.0, 96.0, spike_chance=0.04, spike_mult=1.8)
    nas = HostInfo(
        id="nas",
        name="nas",
        address="192.168.1.20",
        status=Status.ONLINE,
        model="Synology DS920+",
        icon="hard-drive",
        uptime_seconds=int(41 * 86400 + 3 * 3600),
        cpu_percent=round(nas_cpu, 1),
        cpu_cores=4,
        cpu_freq_mhz=2000,
        mem_percent=round(nas_mem, 1),
        mem_used_bytes=int(2.2 * 1024**3),
        mem_total_bytes=int(4 * 1024**3),
        disk_percent=62.0,
        disk_used_bytes=int(7.4 * 1024**4),
        disk_total_bytes=int(12 * 1024**4),
        temperature_c=None,
        is_local=False,
    )

    # No agent_url configured -- monitored via reachability only, same as
    # a real host without an agent. Metric fields stay None so the
    # frontend renders them "unavailable" rather than fabricating values.
    raspberry_pi = HostInfo(
        id="raspberry-pi",
        name="Raspberry Pi",
        address="192.168.1.50",
        status=Status.ONLINE,
        model=None,
        icon="cpu",
        is_local=False,
    )

    return [local, nas, raspberry_pi]


def default_container_config(service_id: str) -> ContainerConfig | None:
    """The config a configurable service starts out with -- seeds
    backend/demo/runtime.py's mutable state the first time it's touched.
    Only services with has_config=True in demo_services() have one."""
    if service_id == "plex":
        return ContainerConfig(
            env={"TZ": "America/Los_Angeles", "PLEX_CLAIM": "", "ADVERTISE_IP": "http://192.168.1.11:32400/"},
            cpu_limit="2",
            mem_limit="2g",
            restart_policy="unless-stopped",
        )
    return None


def default_image_state(service_id: str) -> ImageState | None:
    """The image version state a configurable service starts out with --
    seeds backend/demo/runtime.py's mutable state the first time it's
    touched, same pattern as default_container_config."""
    if service_id == "plex":
        return ImageState(
            current="plexinc/pms-docker:1.40.3.8555",
            available="plexinc/pms-docker:1.41.0.8994",
            previous=None,
        )
    return None


def demo_services() -> list[Service]:
    return [
        Service(
            id="plex", name="Plex", type="docker", status=Status.ONLINE, icon="film", host="ziri-mini",
            banner="/banners/plex-demo.svg",
            metrics=[
                Metric("uptime", "Uptime", 6 * 86400 + 2 * 3600, MetricType.DURATION),
                Metric("cpu", "CPU Usage", _with_spikes(_wave(70, 3, 5), 0.5, 45), MetricType.PERCENT, unit="%"),
                Metric("memory", "Memory", "612 MB / 2 GB", MetricType.RATIO),
                Metric("restarts", "Restarts", 1, MetricType.COUNT, secondary=True),
                Metric("ports", "Ports", "32400 tcp", MetricType.TEXT),
                # "image"/"update_available" are added dynamically by
                # backend/providers/demo.py's overlay -- current version
                # changes when update/rollback actions run, which a
                # static list here couldn't represent.
            ],
            actions=[
                Action(ActionKind.START, "Start"),
                Action(ActionKind.STOP, "Stop", destructive=True, confirm_title="Stop Plex?"),
                Action(ActionKind.RESTART, "Restart", confirm_title="Restart Plex?",
                       confirm_body="This will stop and start the service. Active streams may be interrupted."),
            ],
            has_logs=True,
            has_config=True,
        ),
        Service(
            id="home-assistant", name="Home Assistant", type="http", status=Status.ONLINE, icon="home", host="ziri-mini",
            metrics=[Metric("latency", "Response", 24, MetricType.LATENCY_MS, unit="ms", secondary=True)],
        ),
        Service(
            id="dragonwilds", name="Dragonwilds", type="tcp", status=Status.ONLINE, icon="flame", host="ziri-mini",
            banner="/banners/dragonwilds-demo.svg",
            metrics=[
                Metric("players", "Players", "2 / 8", MetricType.RATIO, secondary=True),
                Metric("uptime", "Uptime", int(17 * 3600 + 42 * 60), MetricType.DURATION),
                Metric("world_day", "World Day", 128, MetricType.COUNT),
                Metric("version", "Version", "1.2.3", MetricType.TEXT),
                Metric("restarts", "Restarts", 0, MetricType.COUNT, secondary=True),
            ],
            actions=[
                Action(ActionKind.START, "Start"),
                Action(ActionKind.STOP, "Stop", destructive=True, confirm_title="Stop Dragonwilds?"),
                Action(ActionKind.RESTART, "Restart", confirm_title="Restart Dragonwilds?",
                       confirm_body="This will stop and start the server. Current players will be disconnected."),
            ],
        ),
        Service(
            id="terraria", name="Terraria", type="tcp", status=Status.ONLINE, icon="tree", host="ziri-mini",
            metrics=[
                Metric("players", "Players", "1 / 8", MetricType.RATIO, secondary=True),
                Metric("uptime", "Uptime", int(3 * 86400 + 6 * 3600), MetricType.DURATION),
            ],
            actions=[Action(ActionKind.RESTART, "Restart", confirm_title="Restart Terraria?")],
        ),
        Service(
            id="enshrouded", name="Enshrouded", type="tcp", status=Status.WARNING, icon="mountain", host="ziri-mini",
            metrics=[Metric("players", "Players", "0 / 16", MetricType.RATIO, secondary=True)],
            actions=[Action(ActionKind.RESTART, "Restart", confirm_title="Restart Enshrouded?")],
            failure=FailureDetail(reason="degraded", message="No players connected in over 24 hours"),
        ),
        Service(
            id="ssh", name="SSH", type="tcp", status=Status.ONLINE, icon="terminal", host="ziri-mini",
            metrics=[Metric("latency", "Response", 22, MetricType.LATENCY_MS, unit="ms", secondary=True)],
        ),
    ]


def demo_network_targets() -> list[NetworkTarget]:
    targets = [
        NetworkTarget(id="internet", name="Internet", kind="internet", address=None, status=Status.ONLINE, icon="globe", latency_ms=12),
        NetworkTarget(id="gateway", name="Gateway", kind="gateway", address="192.168.1.1", status=Status.ONLINE, icon="router"),
    ]
    # Non-local hosts are reused on the Network page too, exactly like the
    # real (non-demo) snapshot does -- see api/main.py:_network_snapshot.
    for h in demo_hosts():
        if h.is_local or not h.address:
            continue
        targets.append(
            NetworkTarget(
                id=f"host-{h.address}", name=h.name, kind="host", address=h.address,
                status=h.status, icon=h.icon, latency_ms=3,
            )
        )
    targets.append(
        NetworkTarget(id="device-192.168.1.60", name="ESP32", kind="device", address="192.168.1.60", status=Status.ONLINE, icon="microchip")
    )
    return targets


def demo_network_traffic() -> NetworkTraffic:
    down = max(5.0, _wave(40, 35, 50) + random.uniform(-5, 5))
    up = max(1.0, _wave(60, 8, 12) + random.uniform(-2, 2))
    return NetworkTraffic(
        download_mbps=round(down, 1),
        upload_mbps=round(up, 1),
        total_downloaded_bytes=int(12.4 * 1024**3),
        total_uploaded_bytes=int(2.1 * 1024**3),
        period_label="since boot",
    )


def demo_host_detail_metrics(host_id: str) -> list[Metric]:
    """Matches the shape backend/collectors/system.py:get_local_host_detail_metrics
    produces for a real host, so the detail UI exercises the exact same
    rendering path in demo mode (spec section 28). Deliberately uneven
    across hosts -- a NAS has different sensors than a Pi has different
    sensors than a mini PC -- so the UI is exercised against the same
    "not every host reports everything" reality real hardware has.
    Everything here is simulated (spec: never mix demo and real data);
    swapping in real SMART/fan/power collectors later is a LiveProvider
    change, not a UI change, since these are all just generic Metrics."""
    core_count = 4 if host_id == "nas" else 8
    metrics = [
        Metric(
            f"cpu_core_{i}",
            f"Core {i}",
            round(max(1.0, min(99.0, _wave(45 + i * 7, 20, 30 + i * 5, phase=i))), 1),
            MetricType.PERCENT,
            unit="%",
        )
        for i in range(core_count)
    ]
    metrics.append(Metric("swap", "Swap", round(max(0.0, _wave(300, 4, 6)), 1), MetricType.PERCENT, unit="%"))

    load1 = round(max(0.0, _wave(90, 1.2, 1.4) / (core_count / 4)), 2)
    metrics.append(Metric("load_1", "Load Average (1m)", load1, MetricType.COUNT))
    metrics.append(Metric("load_5", "Load Average (5m)", round(load1 * 0.9, 2), MetricType.COUNT))
    metrics.append(Metric("load_15", "Load Average (15m)", round(load1 * 0.75, 2), MetricType.COUNT))

    metrics.append(Metric("disk_/", "/", 37.0, MetricType.PERCENT, unit="%"))
    if host_id == "nas":
        metrics.append(Metric("disk_/volume1", "/volume1", 62.0, MetricType.PERCENT, unit="%"))
    metrics.append(
        Metric("disk_read_rate", "Disk Read", int(max(0, _wave(20, 4_000_000, 3_000_000))), MetricType.BYTES, unit="/s")
    )
    metrics.append(
        Metric("disk_write_rate", "Disk Write", int(max(0, _wave(30, 1_500_000, 900_000))), MetricType.BYTES, unit="/s")
    )
    metrics.append(Metric("disk_read_iops", "Disk Read IOPS", int(max(0, _wave(25, 180, 140))), MetricType.COUNT, unit="IOPS"))
    metrics.append(Metric("disk_write_iops", "Disk Write IOPS", int(max(0, _wave(35, 90, 70))), MetricType.COUNT, unit="IOPS"))

    interfaces = {"ziri-mini": ["eth0"], "nas": ["eth0"], "raspberry-pi": ["wlan0"]}.get(host_id, ["eth0"])
    for i, iface in enumerate(interfaces):
        metrics.append(
            Metric(f"net_iface_{iface}_down", f"{iface} ↓", int(max(0, _wave(40 + i, 3_000_000, 2_500_000))), MetricType.BYTES, unit="/s")
        )
        metrics.append(
            Metric(f"net_iface_{iface}_up", f"{iface} ↑", int(max(0, _wave(60 + i, 600_000, 400_000))), MetricType.BYTES, unit="/s")
        )

    # SMART: only where a real drive (and thus a real SMART report) would
    # exist -- omitted for the Pi's SD card, which has no SMART interface.
    if host_id == "ziri-mini":
        metrics.append(Metric("smart_nvme0n1_health", "nvme0n1 Health", "PASSED", MetricType.TEXT))
        metrics.append(Metric("smart_nvme0n1_temp", "nvme0n1 Temp", round(max(28.0, _wave(200, 6, 41)), 1), MetricType.TEMPERATURE_C))
    elif host_id == "nas":
        metrics.append(Metric("smart_sda_health", "sda Health", "PASSED", MetricType.TEXT))
        metrics.append(Metric("smart_sda_temp", "sda Temp", round(max(28.0, _wave(240, 4, 34)), 1), MetricType.TEMPERATURE_C))
        # A second drive shown mid-warning -- exercises the "something's
        # not perfect" rendering path, not just the all-green happy path.
        metrics.append(Metric("smart_sdb_health", "sdb Health", "WARNING", MetricType.TEXT))
        metrics.append(Metric("smart_sdb_temp", "sdb Temp", round(max(35.0, _wave(180, 3, 47)), 1), MetricType.TEMPERATURE_C))

    # Fan RPM / power draw: only where the hardware plausibly has the
    # sensor at all -- a Pi has neither.
    if host_id == "ziri-mini":
        metrics.append(Metric("fan_rpm", "Fan Speed", int(max(0, _wave(20, 400, 1800))), MetricType.COUNT, unit="RPM"))
        metrics.append(Metric("power_draw", "Power Draw", round(max(8.0, _wave(30, 6, 24)), 1), MetricType.COUNT, unit="W"))
    elif host_id == "nas":
        metrics.append(Metric("fan_rpm", "Fan Speed", int(max(0, _wave(25, 200, 1100))), MetricType.COUNT, unit="RPM"))
        metrics.append(Metric("power_draw", "Power Draw", round(max(15.0, _wave(35, 5, 32)), 1), MetricType.COUNT, unit="W"))

    return metrics


_LOG_MESSAGE_POOLS = {
    "plex": [
        "Starting Plex Media Server.",
        "Library scan complete: 1,204 items.",
        "Transcoder session started for client 'Living Room TV'.",
        "Transcoder session ended.",
        "Checking for updates... none available.",
        "New device connected: 'Kitchen Fire TV'.",
        "Metadata refresh completed for 'Movies'.",
        "Playback error: unsupported codec, falling back to software transcode.",
        "Scheduled library maintenance starting.",
        "Scheduled library maintenance complete.",
    ],
}
_DEFAULT_LOG_MESSAGES = [
    "Heartbeat OK.",
    "Health check passed.",
    "Processed request in 12ms.",
    "Connection accepted from 192.168.1.42.",
    "Cache hit ratio: 94%.",
]


def demo_logs(service_id: str) -> list[LogLine]:
    """Canned log lines for the demo-mode "View Logs" panel -- just enough
    to exercise the UI, not a simulation of any real log format. Used as
    the seed a service's log buffer starts from -- see
    backend/demo/runtime.py:tail_logs, which is what actually makes the
    log viewer's "follow" mode show new lines over time."""
    now = int(time.time())
    lines = _LOG_MESSAGE_POOLS.get(service_id, ["No log output available for this service in demo mode."])
    result = []
    for i, text in enumerate(lines):
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - (len(lines) - i) * 60))
        result.append(LogLine(text=text, ts=ts))
    return result


def random_log_line(service_id: str) -> LogLine:
    """One new plausible line for `tail_logs` to append while a log viewer
    is following -- content lives here (what generator.py owns
    throughout this module); *whether/when* to call this lives in
    runtime.py, same split as every other simulated value."""
    pool = _LOG_MESSAGE_POOLS.get(service_id, _DEFAULT_LOG_MESSAGES)
    return LogLine(text=random.choice(pool), ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


_HISTORY_SERIES = {
    # series -> (period_s, amplitude, offset, clamp_min, clamp_max)
    # Same shape as the corresponding live wave call, so a chart looks
    # continuous whether a point came from the live broadcast loop or
    # from this backfill.
    "host.ziri-mini.cpu": (90, 18, 22, 0, 100),
    "host.ziri-mini.mem": (240, 10, 42, 0, 100),
    "host.nas.cpu": (120, 12, 15, 0, 100),
    "host.nas.mem": (200, 8, 55, 0, 100),
    "network.download_mbps": (40, 35, 50, 0, 500),
    "network.upload_mbps": (60, 8, 12, 0, 100),
}
_DEFAULT_HISTORY_PARAMS = (100, 15, 30, 0, 100)


def demo_history(series: str, since_seconds: int) -> list[tuple[int, float]]:
    """Synthetic backfill so a freshly started demo instance shows a fully
    populated chart at every selectable range (1h..30d) instead of a
    mostly-empty one until the process has actually been running that
    long -- a real fresh install would have the same gap, but demo mode's
    whole point is to look like a homelab that's been running for weeks.
    Uses the same wave shape as the live value for the same series (see
    _wave/_wave_at), just evaluated at historical points on the timeline
    instead of "now", so backfilled history and freshly-arriving live
    points line up continuously rather than jumping at the seam."""
    period_s, amplitude, offset, lo, hi = _HISTORY_SERIES.get(series, _DEFAULT_HISTORY_PARAMS)
    now = time.time()
    now_since_start = now - _start
    target_points = 180
    step = max(30, since_seconds // target_points)
    points: list[tuple[int, float]] = []
    delta = -since_seconds
    while delta <= 0:
        value = _wave_at(now_since_start + delta, period_s, amplitude, offset)
        value = _with_spikes(value, lo, hi, spike_chance=0.03)
        points.append((int(now + delta), value))
        delta += step
    return points


def demo_fleet_summary(services: list[Service] | None = None) -> FleetSummary:
    """Aggregate totals across every demo host/service -- see
    backend/providers/demo.py. Power draw only sums hosts that report a
    power_draw detail metric (ziri-mini, nas) -- omitted rather than
    fabricated for hosts like the Pi, which has no such sensor, matching
    the same "never fabricate" rule the rest of this module follows.

    Takes `services` as a parameter (rather than always calling
    demo_services() itself) so DemoProvider can pass in the
    runtime-overlaid list -- containers_running should reflect a
    simulated stop/restart, not just the static default."""
    hosts = demo_hosts()
    if services is None:
        services = demo_services()
    containers = [s for s in services if s.type == "docker"]

    power_draw = 0.0
    have_power = False
    for h in hosts:
        for m in demo_host_detail_metrics(h.id):
            if m.key == "power_draw":
                power_draw += float(m.value)
                have_power = True

    return FleetSummary(
        total_hosts=len(hosts),
        online_hosts=sum(1 for h in hosts if h.status == Status.ONLINE),
        total_cores=sum(h.cpu_cores or 0 for h in hosts) or None,
        total_mem_bytes=sum(h.mem_total_bytes or 0 for h in hosts) or None,
        used_mem_bytes=sum(h.mem_used_bytes or 0 for h in hosts) or None,
        total_disk_bytes=sum(h.disk_total_bytes or 0 for h in hosts) or None,
        used_disk_bytes=sum(h.disk_used_bytes or 0 for h in hosts) or None,
        total_power_draw_w=round(power_draw, 1) if have_power else None,
        containers_running=sum(1 for s in containers if s.status == Status.ONLINE),
        containers_total=len(containers),
    )


def default_host_actions(host_id: str) -> list[HostAction]:
    """The whitelisted host actions a demo host starts out exposing --
    not every host gets the same set, same "not every host/service has
    the same controls" rule as everywhere else (spec section 18).
    `raspberry-pi` is reachability-only in this demo (no agent, per
    demo_hosts()) -- there's nothing to execute anything through, so it
    gets none, exactly like its metric fields stay unavailable rather
    than fabricated."""
    host = next((h for h in demo_hosts() if h.id == host_id), None)
    if host is None or host_id == "raspberry-pi":
        return []

    name = host.name
    actions = [
        HostAction(
            HostActionKind.RUN_BACKUP,
            "Run Backup Now",
            confirm_title=f"Run backup for {name}?",
            confirm_body="Starts an out-of-schedule backup run.",
        ),
        HostAction(
            HostActionKind.CLEAR_PACKAGE_CACHE,
            "Clear Package Cache",
            confirm_title=f"Clear package cache on {name}?",
            confirm_body="Frees disk space used by cached package files. Nothing running is affected.",
        ),
    ]
    if host_id == "ziri-mini":
        actions.append(
            HostAction(
                HostActionKind.DOCKER_PRUNE,
                "Docker Prune",
                confirm_title=f"Prune Docker on {name}?",
                confirm_body="Removes stopped containers, unused networks, and dangling images. "
                "Running containers and their volumes are untouched.",
            )
        )
        actions.append(
            HostAction(
                HostActionKind.RESTART_DOCKER,
                "Restart Docker Daemon",
                destructive=True,
                confirm_title=f"Restart Docker on {name}?",
                confirm_body=f"This briefly stops every container running on {name} while the Docker daemon restarts.",
                require_typed_confirmation=name,
            )
        )
    actions.append(
        HostAction(
            HostActionKind.REBOOT,
            "Reboot",
            destructive=True,
            confirm_title=f"Reboot {name}?",
            confirm_body=f"This restarts the entire host. Every service running on {name} will be unavailable "
            "until it comes back up.",
            require_typed_confirmation=name,
        )
    )
    return actions


def default_scheduled_jobs(host_id: str) -> list[ScheduledJob]:
    """Seeded with a plausible recent last_run/upcoming next_run, same
    reasoning as demo_hosts() seeding a multi-day uptime -- a fresh demo
    process should look like a homelab that's been running for a while,
    not one that was just switched on."""
    now = time.time()

    def iso(offset_seconds: float) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + offset_seconds))

    if host_id == "ziri-mini":
        return [
            ScheduledJob(
                "nightly-backup", "Nightly Backup", "Daily at 02:00",
                last_run=iso(-8 * 3600), last_status="success", next_run=iso(16 * 3600),
                action_kind=HostActionKind.RUN_BACKUP.value,
            ),
            ScheduledJob(
                "weekly-docker-cleanup", "Weekly Docker Cleanup", "Sundays at 03:00",
                last_run=iso(-2 * 86400), last_status="success", next_run=iso(5 * 86400),
                action_kind=HostActionKind.DOCKER_PRUNE.value,
            ),
        ]
    if host_id == "nas":
        return [
            ScheduledJob(
                "nightly-backup", "Nightly Backup", "Daily at 01:30",
                last_run=iso(-9 * 3600), last_status="success", next_run=iso(15 * 3600),
                action_kind=HostActionKind.RUN_BACKUP.value,
            ),
        ]
    return []


# How often each scheduled job runs, in seconds -- used to advance
# next_run when a run completes (backend/demo/runtime.py). Keyed by job
# id since that's stable; schedule_label above is just the display text.
JOB_PERIOD_SECONDS = {
    "nightly-backup": 86400,
    "weekly-docker-cleanup": 7 * 86400,
}


def default_backup_status(host_id: str) -> BackupStatus | None:
    """None means "no backup tracking configured for this host" --
    raspberry-pi (reachability-only, no agent) gets None, same as
    get_scheduled_jobs returning an empty list for it."""
    now = time.time()
    if host_id == "ziri-mini":
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 8 * 3600))
        return BackupStatus(last_backup_at=ts, last_attempt_at=ts, last_status="success", size_bytes=int(4.2 * 1024**3))
    if host_id == "nas":
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 9 * 3600))
        return BackupStatus(last_backup_at=ts, last_attempt_at=ts, last_status="success", size_bytes=int(38 * 1024**3))
    return None


def demo_offline_host() -> HostInfo:
    return HostInfo(
        id="demo-host-offline",
        name="ziri-mini",
        address="192.168.1.11",
        status=Status.OFFLINE,
        failure=FailureDetail(
            reason="host_unreachable",
            message="Cannot reach 192.168.1.11",
            last_seen="15:42:17",
            context={"ping": "failed", "gateway": "online", "internet": "online"},
        ),
    )
