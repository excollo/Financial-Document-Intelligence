import pytest

from app.workers.job_context import JobContext


@pytest.mark.asyncio
async def test_job_context_propagates_workspace_and_domain_to_section_updates(monkeypatch):
    calls = []

    async def _fake_submit_section_result(**kwargs):
        calls.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(
        "app.workers.job_context.node_client.submit_section_result",
        _fake_submit_section_result,
    )

    ctx = JobContext(
        job_id="job-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        domain_id="tenant-1",
    )
    await ctx.submit_section_result(section_id="sec-1")

    assert calls[0]["workspace_id"] == "ws-1"
    assert calls[0]["domain_id"] == "tenant-1"


@pytest.mark.asyncio
async def test_job_context_propagates_workspace_and_domain_to_adverse_findings(monkeypatch):
    calls = []

    async def _fake_submit_adverse_finding(**kwargs):
        calls.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(
        "app.workers.job_context.node_client.submit_adverse_finding",
        _fake_submit_adverse_finding,
    )

    ctx = JobContext(
        job_id="job-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        domain_id="tenant-1",
    )
    await ctx.submit_adverse_finding(
        entity_name="entity",
        finding_type="regulatory",
        severity="high",
        title="Title",
        description="Description",
    )

    assert calls[0]["workspace_id"] == "ws-1"
    assert calls[0]["domain_id"] == "tenant-1"
