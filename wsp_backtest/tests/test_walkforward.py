from analytics.walkforward import build_windows

def test_walkforward_windows():
    wins=build_windows('2020-01-01','2025-12-31',3,1,1)
    assert len(wins)>=2
