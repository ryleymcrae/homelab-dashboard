import asyncio

import pytest

from backend.actions.executor import ActionValidationError, execute_service_action
from backend.adapters.tcp_adapter import TcpAdapter


def test_unsupported_action_rejected():
    adapter = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1)
    with pytest.raises(ActionValidationError):
        asyncio.run(execute_service_action(adapter, "restart"))


def test_action_validation_message_lists_supported_actions():
    adapter = TcpAdapter("t1", "Test TCP", host="127.0.0.1", port=1)
    with pytest.raises(ActionValidationError) as excinfo:
        asyncio.run(execute_service_action(adapter, "start"))
    assert "not a supported action" in str(excinfo.value)
