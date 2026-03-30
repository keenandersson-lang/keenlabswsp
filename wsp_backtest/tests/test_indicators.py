import pandas as pd
from indicators.moving_averages import sma, slope

def test_sma_and_slope():
    s=pd.Series([1,2,3,4,5],dtype=float)
    ma=sma(s,3)
    assert round(ma.iloc[-1],6)==4
    sl=slope(ma,1)
    assert sl.iloc[-1]>0
