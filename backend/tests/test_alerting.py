"""
Alert evaluation and the AlertStore it writes to. Provider-agnostic by
design (backend/alerting/evaluator.py) -- these tests build HostInfo/
Service objects directly rather than going through a provider, since the
evaluator doesn't (and shouldn't) care where they came from.
"""
import pytest

from backend.alerting.evaluator import AlertEvaluator, merge_thresholds
from backend.config.schema import AlertingConfig, ThresholdConfig
from backend.models.core import Action, ActionKind, HostAction, HostActionKind, HostInfo, Service, Status
from backend.persistence.alerts import AlertStore


@pytest.fixture
def store(tmp_path):
    return AlertStore(tmp_path / "alerts.sqlite3")


@pytest.fixture
def evaluator(store):
    return AlertEvaluator(store)


def make_host(**kwargs) -> HostInfo:
    defaults = dict(id="h1", name="h1", address="192.168.1.1", status=Status.ONLINE)
    defaults.update(kwargs)
    return HostInfo(**defaults)


def make_service(**kwargs) -> Service:
    defaults = dict(id="s1", name="s1", type="docker", status=Status.ONLINE)
    defaults.update(kwargs)
    return Service(**defaults)


# -- instant thresholds (cpu/mem/disk/temp) ---------------------------------

def test_cpu_above_threshold_triggers_a_warning(evaluator, store):
    triggered = evaluator.evaluate([make_host(cpu_percent=95.0)], [], AlertingConfig())
    assert len(triggered) == 1
    assert triggered[0].severity.value == "warning"
    assert triggered[0].metric == "cpu_percent"
    assert len(store.list(status="active")) == 1


def test_cpu_at_or_below_threshold_does_not_trigger(evaluator):
    triggered = evaluator.evaluate([make_host(cpu_percent=90.0)], [], AlertingConfig())
    assert triggered == []


def test_cpu_dropping_back_down_resolves_the_alert(evaluator, store):
    evaluator.evaluate([make_host(cpu_percent=95.0)], [], AlertingConfig())
    evaluator.evaluate([make_host(cpu_percent=10.0)], [], AlertingConfig())
    assert store.list(status="active") == []
    assert len(store.list(status="resolved")) == 1


def test_repeated_high_reading_does_not_renotify(evaluator):
    config = AlertingConfig()
    first = evaluator.evaluate([make_host(cpu_percent=95.0)], [], config)
    second = evaluator.evaluate([make_host(cpu_percent=96.0)], [], config)
    assert len(first) == 1
    assert second == []  # still the same incident, not a new one


def test_disabled_threshold_never_triggers(evaluator):
    config = AlertingConfig(defaults=ThresholdConfig(cpu_percent=None))
    triggered = evaluator.evaluate([make_host(cpu_percent=99.0)], [], config)
    assert triggered == []


def test_missing_sensor_value_never_triggers(evaluator):
    # temperature_c=None (no sensor) must never be treated as "0 <= threshold"
    # or, worse, compared as if it were a number.
    triggered = evaluator.evaluate([make_host(temperature_c=None)], [], AlertingConfig())
    assert triggered == []


def test_host_override_applies_a_different_threshold(evaluator):
    config = AlertingConfig(host_overrides={"h1": ThresholdConfig(cpu_percent=50.0)})
    triggered = evaluator.evaluate([make_host(cpu_percent=60.0)], [], config)
    assert len(triggered) == 1  # 60 > the overridden 50, even though it's under the global 90


def test_disabled_alerting_never_triggers_anything(evaluator):
    config = AlertingConfig(enabled=False)
    triggered = evaluator.evaluate([make_host(cpu_percent=99.9)], [], config)
    assert triggered == []


# -- threshold merging -------------------------------------------------------

def testmerge_thresholds_none_override_returns_default_unchanged():
    default = ThresholdConfig()
    assert merge_thresholds(default, None) is default


def testmerge_thresholds_only_overrides_explicitly_set_fields():
    default = ThresholdConfig(cpu_percent=95.0)  # a customized global default
    override = ThresholdConfig(offline_minutes=10.0)  # only sets one field
    merged = merge_thresholds(default, override)
    assert merged.cpu_percent == 95.0  # inherited, not clobbered by ThresholdConfig's class default of 90
    assert merged.offline_minutes == 10.0


# -- duration-based conditions (service down / host unreachable) -----------

def test_service_down_does_not_trigger_before_the_debounce_window(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    triggered = evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    assert triggered == []
    t[0] += 60  # one minute later, still under the 5-minute default
    triggered = evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    assert triggered == []


def test_service_down_triggers_critical_after_the_debounce_window(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    t[0] += 6 * 60
    triggered = evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    assert len(triggered) == 1
    assert triggered[0].severity.value == "critical"
    assert triggered[0].metric == "service_down"


def test_service_recovering_resets_the_debounce_timer(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    evaluator.evaluate([], [make_service(status=Status.ONLINE)], AlertingConfig())  # recovers
    t[0] += 6 * 60
    # Goes down again "now" -- shouldn't immediately fire using the stale timer.
    triggered = evaluator.evaluate([], [make_service(status=Status.OFFLINE)], AlertingConfig())
    assert triggered == []


def test_service_warning_status_is_not_treated_as_down(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    t[0] += 6 * 60
    triggered = evaluator.evaluate([], [make_service(status=Status.WARNING)], AlertingConfig())
    assert triggered == []  # degraded-but-running is a different concern (FailureBanner), not this alert


def test_service_down_suggests_restart_when_the_action_exists(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    service = make_service(status=Status.OFFLINE, actions=[Action(ActionKind.RESTART, "Restart")])
    evaluator.evaluate([], [service], AlertingConfig())
    t[0] += 6 * 60
    triggered = evaluator.evaluate([], [service], AlertingConfig())
    assert triggered[0].suggested_action == "restart"


def test_service_down_suggests_nothing_when_no_restart_action(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    service = make_service(status=Status.OFFLINE, actions=[])
    evaluator.evaluate([], [service], AlertingConfig())
    t[0] += 6 * 60
    triggered = evaluator.evaluate([], [service], AlertingConfig())
    assert triggered[0].suggested_action is None


def test_host_unreachable_suggests_reboot_when_the_action_exists(evaluator, monkeypatch):
    t = [1_000.0]
    monkeypatch.setattr("backend.alerting.evaluator.time.time", lambda: t[0])
    host = make_host(status=Status.OFFLINE, actions=[HostAction(HostActionKind.REBOOT, "Reboot")])
    evaluator.evaluate([host], [], AlertingConfig())
    t[0] += 6 * 60
    triggered = evaluator.evaluate([host], [], AlertingConfig())
    assert len(triggered) == 1
    assert triggered[0].metric == "host_unreachable"
    assert triggered[0].suggested_action == "reboot"
