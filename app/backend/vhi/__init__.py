import pandas as _pd

# pandas 3 stores text columns as a string dtype whose missing value is NaN (truthy), where pandas 2 used None.
# The services read SQL/parquet text columns and test them with `x or default`, so keep the pandas 2 behaviour.
if hasattr(_pd.options, "future") and hasattr(_pd.options.future, "infer_string"):
    _pd.options.future.infer_string = False
