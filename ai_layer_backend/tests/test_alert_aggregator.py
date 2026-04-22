from app.services.alert_aggregator import AlertAggregator


class FakeRedis:
    def __init__(self):
        self.store = {}
        self.expiry = {}

    def incr(self, key):
        self.store[key] = int(self.store.get(key, 0)) + 1
        return self.store[key]

    def expire(self, key, seconds):
        self.expiry[key] = seconds


def test_alert_aggregation_counts_and_window(monkeypatch):
    agg = AlertAggregator()
    fake = FakeRedis()
    monkeypatch.setattr(agg, "_client", lambda: fake)

    agg.record_alert(alert_type="threshold_exceeded", metric="queue_depth", severity="warning", service="python")
    agg.record_alert(alert_type="threshold_exceeded", metric="queue_depth", severity="warning", service="python")
    assert len(fake.store) == 1
    key = next(iter(fake.store))
    assert fake.store[key] == 2
    assert fake.expiry[key] > 0
