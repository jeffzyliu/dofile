# Deterministic synthetic data for the engine evaluation (written as Stata 118 .dta).
import sys, shutil
from pathlib import Path
import numpy as np
import pandas as pd

out = Path(sys.argv[1])
out.mkdir(exist_ok=True)
rng = np.random.default_rng(20261103)
N, T, G = 200, 5, 20
ids = np.repeat(np.arange(1, N + 1), T)
year = np.tile(np.arange(2015, 2015 + T), N)
grp = (ids - 1) % G + 1
alpha = np.repeat(rng.normal(0, 1, N), T)
x1 = rng.normal(0, 1, N * T) + 0.5 * alpha
x2 = rng.normal(0, 1, N * T)
z = rng.normal(0, 1, N * T)
u = rng.normal(0, 1, N * T)
xen = 0.6 * z + 0.5 * u + rng.normal(0, 1, N * T)
gshock = rng.normal(0, 0.5, G)[grp - 1]
y = 1 + 2 * x1 - 0.5 * x2 + 1.5 * xen + alpha + gshock + u
d = (rng.random(N * T) < 1 / (1 + np.exp(-(-0.3 + 0.8 * x1 - 0.4 * x2)))).astype("int8")
cnt = rng.poisson(np.exp(0.2 + 0.3 * x1 + 0.1 * x2)).astype("int16")
panel = pd.DataFrame(dict(id=ids.astype("int16"), year=year.astype("int16"), grp=grp.astype("int8"),
                          x1=x1, x2=x2, z=z, xen=xen, y=y, d=d, cnt=cnt))
panel.to_stata(out / "panel.dta", write_index=False, version=118)
pd.DataFrame(dict(grp=np.arange(1, G + 1, dtype="int8"),
                  gvar=np.round(rng.normal(10, 2, G), 6))).to_stata(out / "grpinfo.dta", write_index=False, version=118)
shutil.copy("/Users/cassandra/dev/openstata-new/openstata-engine/stata-functionality/testing/data/cpsmar08_10pct.dta",
            out / "cps.dta")
print("ok", panel.shape)
