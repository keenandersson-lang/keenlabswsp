import pandas as pd
from indicators.pivots import pivot_highs
from indicators.resistance import detect_resistance_zone

def test_resistance_detection():
    df=pd.DataFrame({
      'date':pd.date_range('2024-01-01',periods=15),
      'high':[10,11,12,11,10,12,11,10,12,11,10,12,11,10,9]
    })
    piv=pivot_highs(df['high'],1,1)
    zone=detect_resistance_zone(df,piv,lookback_window=20,tolerance=0.02,min_touches=3)
    assert zone is not None
    assert zone.touch_count>=3
