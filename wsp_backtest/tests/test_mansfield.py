import pandas as pd
from indicators.mansfield import mansfield, mansfield_pass

def test_mansfield_basic():
    s=pd.Series([10,11,12,13,14,15,16,17,18,19],dtype=float)
    b=pd.Series([10]*10,dtype=float)
    m=mansfield(s,b,lookback=3)
    assert m.iloc[-1]>0

def test_mansfield_cross_mode():
    ms=pd.Series([-0.1,-0.05,0.01])
    out=mansfield_pass(ms,mode='positive_or_recent_cross',cross_window=2)
    assert bool(out.iloc[-1]) is True
