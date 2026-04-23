import json

import pytest

from app.services.node_client import node_client


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"ok": True}


@pytest.mark.asyncio
async def test_submit_section_result_includes_workspace_and_domain(monkeypatch):
    captured = {}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, content=None, headers=None):
            captured["url"] = url
            captured["content"] = content
            captured["headers"] = headers
            return _FakeResponse()

    monkeypatch.setattr("app.services.node_client.httpx.AsyncClient", lambda *args, **kwargs: _FakeClient())

    await node_client.submit_section_result(
        job_id="job-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        domain_id="tenant-1",
        section_id="sec-1",
    )

    body = json.loads(captured["content"])
    assert body["workspace_id"] == "ws-1"
    assert body["domain_id"] == "tenant-1"


@pytest.mark.asyncio
async def test_submit_adverse_finding_includes_workspace_and_domain(monkeypatch):
    captured = {}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, content=None, headers=None):
            captured["url"] = url
            captured["content"] = content
            captured["headers"] = headers
            return _FakeResponse()

    monkeypatch.setattr("app.services.node_client.httpx.AsyncClient", lambda *args, **kwargs: _FakeClient())

    await node_client.submit_adverse_finding(
        job_id="job-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        domain_id="tenant-1",
        entity_name="entity",
        finding_type="regulatory",
        severity="high",
        title="Title",
        description="Description",
    )

    body = json.loads(captured["content"])
    assert body["workspace_id"] == "ws-1"
    assert body["domain_id"] == "tenant-1"
