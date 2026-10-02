"""Runtime service protocol contracts."""


def test_reloadable_protocol_is_runtime_checkable():
    from planner_lib.services.interfaces import Reloadable

    class HasReload:
        def reload(self):
            pass

    class NoReload:
        pass

    assert isinstance(HasReload(), Reloadable)
    assert not isinstance(NoReload(), Reloadable)



def test_invalidatable_protocol_is_runtime_checkable():
    from planner_lib.services.interfaces import Invalidatable

    class HasInvalidate:
        def invalidate_cache(self):
            pass

    class NoInvalidate:
        pass

    assert isinstance(HasInvalidate(), Invalidatable)
    assert not isinstance(NoInvalidate(), Invalidatable)

