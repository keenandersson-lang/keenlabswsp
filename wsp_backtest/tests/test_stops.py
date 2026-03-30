import pandas as pd
from portfolio.stops import initial_stop

def test_initial_stop_fallback():
    df=pd.DataFrame({'open':[10,11,12,13,14],'high':[11,12,13,14,15],'low':[9,10,11,12,13],'close':[10,11,12,13,14]})
    stop=initial_stop(df,4,0.06,30,0.0025)
    assert stop<14
