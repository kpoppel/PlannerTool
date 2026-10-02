"""Cache invalidation fan-out, capability and error-reporting contracts."""


def test_coordinator_fans_out_to_all_invalidatables():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class FakeCache:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    c1, c2 = FakeCache(), FakeCache()
    coord = CacheCoordinator()
    coord.register(c1, "cache_one")
    coord.register(c2, "cache_two")

    result = coord.invalidate_all()

    assert c1.invalidated
    assert c2.invalidated
    assert result["ok"] is True
    assert set(result["invalidated"]) == {"cache_one", "cache_two"}
    assert result["errors"] == []



def test_coordinator_skips_non_invalidatables():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class NotACache:
        pass

    coord = CacheCoordinator()
    coord.register(NotACache(), "not_a_cache")
    # Should not raise and the service should not appear in the list
    result = coord.invalidate_all()
    assert result["invalidated"] == []



def test_coordinator_reports_errors_but_continues():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class BrokenCache:
        def invalidate_cache(self):
            raise RuntimeError("disk full")

    class GoodCache:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    broken = BrokenCache()
    good = GoodCache()
    coord = CacheCoordinator()
    coord.register(broken, "broken")
    coord.register(good, "good")

    result = coord.invalidate_all()

    # Good cache still runs even though broken raised
    assert good.invalidated
    assert result["ok"] is False
    assert len(result["errors"]) == 1
    assert "broken" in result["errors"][0]
    assert "good" in result["invalidated"]

