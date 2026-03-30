from portfolio.execution import apply_slippage, commission

def test_execution_helpers():
    assert apply_slippage(100,10,'buy')>100
    assert apply_slippage(100,10,'sell')<100
    assert commission(10,0.005,1.0)==1.0
