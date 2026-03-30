import pandas as pd
from analytics.metrics import compute_trade_metrics

def test_metrics():
    trades=pd.DataFrame({'pnl':[100,-50,75],'return':[0.02,-0.01,0.015],'hold_bars':[5,3,7]})
    eq=pd.DataFrame({'date':pd.date_range('2024-01-01',periods=3),'equity':[100100,100050,100125]})
    m=compute_trade_metrics(trades,eq,100000)
    assert m['totalTrades']==3
    assert m['winRate']>0
