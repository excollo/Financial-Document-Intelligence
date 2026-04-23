from app.services import queue_telemetry


class FakeRedis:
    def __init__(self):
        self.lists = {"heavy_jobs": [1, 2], "light_jobs": [1]}
        self.zsets = {}

    def zadd(self, key, mapping):
        self.zsets.setdefault(key, {})
        self.zsets[key].update(mapping)

    def zrem(self, key, member):
        if key in self.zsets:
            self.zsets[key].pop(member, None)

    def llen(self, key):
        return len(self.lists.get(key, []))

    def zrange(self, key, start, end, withscores=False):
        values = self.zsets.get(key, {})
        ordered = sorted(values.items(), key=lambda kv: kv[1])
        if not ordered:
            return []
        if withscores:
            return [ordered[0]]
        return [ordered[0][0]]

    def zremrangebyscore(self, key, min_score, max_score):
        values = self.zsets.get(key, {})
        removable = [member for member, score in values.items() if min_score <= score <= max_score]
        for member in removable:
            values.pop(member, None)
        return len(removable)


def test_queue_telemetry_mark_and_snapshot(monkeypatch):
    fake = FakeRedis()
    svc = queue_telemetry.QueueTelemetryService()
    monkeypatch.setattr(svc, "_client", lambda: fake)

    svc.mark_enqueued("heavy_jobs", "job-1")
    snap = svc.snapshot("heavy_jobs")
    assert snap["queue_name"] == "heavy_jobs"
    assert snap["queue_depth"] == 2
    assert snap["queue_age_seconds"] >= 0

    svc.mark_dequeued("heavy_jobs", "job-1")
    assert "job-1" not in fake.zsets.get("celery:queue:enqueued_at:heavy_jobs", {})


def test_queue_telemetry_worker_start_removes_light_queue_age_entry(monkeypatch):
    fake = FakeRedis()
    svc = queue_telemetry.QueueTelemetryService()
    monkeypatch.setattr(svc, "_client", lambda: fake)

    svc.mark_enqueued("light_jobs", "job-2")
    assert "job-2" in fake.zsets.get("celery:queue:enqueued_at:light_jobs", {})

    # Worker start path should dequeue from age tracking.
    svc.mark_dequeued("light_jobs", "job-2")
    assert "job-2" not in fake.zsets.get("celery:queue:enqueued_at:light_jobs", {})


def test_queue_telemetry_failure_path_removes_entry_for_each_task_family(monkeypatch):
    fake = FakeRedis()
    svc = queue_telemetry.QueueTelemetryService()
    monkeypatch.setattr(svc, "_client", lambda: fake)

    # process_document -> heavy_jobs
    svc.mark_enqueued("heavy_jobs", "doc-job-1")
    svc.mark_dequeued("heavy_jobs", "doc-job-1")
    assert "doc-job-1" not in fake.zsets.get("celery:queue:enqueued_at:heavy_jobs", {})

    # generate_summary / generate_comparison / process_news_article -> light_jobs
    for job_id in ("summary-job-1", "comparison-job-1", "news-job-1"):
        svc.mark_enqueued("light_jobs", job_id)
        svc.mark_dequeued("light_jobs", job_id)
        assert job_id not in fake.zsets.get("celery:queue:enqueued_at:light_jobs", {})


def test_queue_telemetry_stale_entry_expires_without_dequeue(monkeypatch):
    fake = FakeRedis()
    svc = queue_telemetry.QueueTelemetryService()
    monkeypatch.setattr(svc, "_client", lambda: fake)
    monkeypatch.setattr(queue_telemetry, "ENTRY_TTL_SECONDS", 1)

    now = [1_700_000_000.0]
    monkeypatch.setattr(queue_telemetry.time, "time", lambda: now[0])

    svc.mark_enqueued("heavy_jobs", "stale-job")
    assert "stale-job" in fake.zsets.get("celery:queue:enqueued_at:heavy_jobs", {})

    now[0] += 2.0
    svc.snapshot("heavy_jobs")
    assert "stale-job" not in fake.zsets.get("celery:queue:enqueued_at:heavy_jobs", {})
