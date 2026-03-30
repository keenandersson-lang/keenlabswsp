import pandas as pd
from signals.signal_engine import generate_signals

def test_signal_engine_runs():
    dates=pd.date_range('2024-01-01',periods=260)
    close=pd.Series(range(1,261),dtype=float)
    df=pd.DataFrame({'date':dates,'open':close,'high':close+1,'low':close-1,'close':close,'volume':[1000]*260,'symbol':['AAA']*260})
    bmk=pd.DataFrame({'date':dates,'open':close,'high':close+1,'low':close-1,'close':close*0.9,'volume':[1000]*260,'symbol':['SPY']*260})
    cfg={
      'stock_ma':{'ma_short':50,'ma_long':150,'slope_lookback':10},
      'mansfield':{'lookback':20,'mode':'positive_or_recent_cross','cross_window':10},
      'resistance':{'pivot_left':3,'pivot_right':3,'lookback_window':120,'tolerance':0.05,'min_touches':3,'breakout_buffer':0.0},
      'clean_breakout':{'min_body_ratio':0.0,'max_upper_wick_ratio':1.0},
      'volume':{'lookback':5,'min_multiplier':0.0},
    }
    out=generate_signals(df,bmk,cfg)
    assert isinstance(out,pd.DataFrame)
