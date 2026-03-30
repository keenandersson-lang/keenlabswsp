import pandas as pd
from pathlib import Path
from analytics.artifact_export import export_bundle

def test_export_bundle(tmp_path: Path):
    bundle=export_bundle(tmp_path,{'run_id':'r1','strategy_version':'v1','start_date':'2020-01-01','end_date':'2020-12-31','universe_name':'U','benchmark_symbol':'SPY'}, {'totalTrades':1,'averageHoldTime':5}, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame())
    assert (tmp_path/'summary_metrics.json').exists()
    assert bundle['run']['runId']=='r1'
