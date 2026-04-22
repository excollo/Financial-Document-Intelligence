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
