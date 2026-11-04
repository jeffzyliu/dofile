# Independent reference values for CHECK lines, computed with pandas/statsmodels/linearmodels.
# Usage: python -I reference.py DATA_DIR OUT_JSON
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from linearmodels.iv import IV2SLS
from linearmodels.panel import PanelOLS

D = Path(sys.argv[1])
R = {}
cps = pd.read_stata(D / "cps.dta", convert_categoricals=False)
cpsc = pd.read_stata(D / "cps.dta")
panel = pd.read_stata(D / "panel.dta")
grpinfo = pd.read_stata(D / "grpinfo.dta")

# 01 basics
a = cps.age.dropna().astype("float64")
R["mean_age"] = a.mean(); R["sd_age"] = a.std(); R["N_age"] = len(a)
R["p50_wage"] = None  # Stata's centile rule differs from numpy; checked loosely below
w = cps.wage_hr.dropna().astype("float64").sort_values().to_numpy()
# Stata summarize,detail p50: average of the two middle values when N is even
n = len(w); R["p50_wage"] = (w[n // 2 - 1] + w[n // 2]) / 2 if n % 2 == 0 else w[n // 2]
R["n_over30"] = int((cps.age > 30).sum())  # missing age is +inf in Stata; CPS age has no missing

# 02 generate (Stata: float source vars promoted to double exactly)
c = cps.astype({k: "float64" for k in cps.select_dtypes("float32").columns})
lw = np.log(c.wage_hr)
exper = c.age - c.yrsed - 6
exper = exper.where(~(exper < 0), 0)
R["sum_exper"] = exper.sum()
R["mage_r1"] = c.groupby("region").age.transform("mean")[c.region == 1].mean()
R["max_hhsize"] = c.groupby("hhid").hhid.transform("size").max()
R["mean_college"] = (c.yrsed[c.yrsed.notna()] >= 16).mean()
R["n_female"] = int((cpsc.sex.astype(str).str[:1] == "F").sum())

# 03 regress
df = pd.DataFrame(dict(lwage=lw, yrsed=c.yrsed, exper=c.age - c.yrsed - 6, fnlwgt=c.fnlwgt, age=c.age,
                       region=c.region, sex=c.sex)).replace([np.inf, -np.inf], np.nan)
df["exper2"] = df.exper ** 2
f = "lwage ~ yrsed + exper + exper2"
ols = smf.ols(f, df).fit()
R["ols_b_yrsed"] = ols.params.yrsed; R["ols_se_yrsed"] = ols.bse.yrsed; R["ols_b_cons"] = ols.params.Intercept
R["ols_N"] = int(ols.nobs); R["ols_r2"] = ols.rsquared
R["ols_F_exper"] = float(ols.f_test("exper = 0, exper2 = 0").fvalue)
R["mean_yhat"] = ols.predict(df.dropna(subset=["yrsed", "exper", "exper2"])).mean()  # Stata predicts out of sample too
R["rob_se_yrsed"] = smf.ols(f, df).fit(cov_type="HC1").bse.yrsed
dd = df.dropna(subset=["lwage", "yrsed", "exper", "fnlwgt"])
R["aw_b_yrsed"] = smf.wls(f, dd, weights=dd.fnlwgt / dd.fnlwgt.mean()).fit().params.yrsed
R["sub_b_yrsed"] = smf.ols(f, df[(df.age >= 25) & (df.age <= 55)]).fit().params.yrsed

# 04 factor variables (base = lowest level, as in Stata)
fv = smf.ols("lwage ~ yrsed + C(region)", df).fit()
R["fv_b_r2"] = fv.params["C(region)[T.2]"]; R["fv_b_r4"] = fv.params["C(region)[T.4]"]
fi = smf.ols("lwage ~ yrsed * C(sex)", df).fit()
R["fv_b_int"] = fi.params["yrsed:C(sex)[T.2]"]

# 05 cluster + IV
p = panel.astype({k: "float64" for k in ["x1", "x2", "z", "xen", "y"]})
cl = smf.ols("y ~ x1 + x2 + xen", p).fit(cov_type="cluster", cov_kwds={"groups": p.grp})  # Stata's G/(G-1)*(N-1)/(N-K)
R["cl_se_x1"] = cl.bse.x1; R["cl_b_xen"] = cl.params.xen
iv = IV2SLS.from_formula("y ~ 1 + x1 + x2 + [xen ~ z]", p).fit(cov_type="unadjusted", debiased=False)
R["iv_b_xen"] = iv.params.xen; R["iv_se_xen"] = iv.std_errors.xen  # ivregress default: no small-sample df
R["ivr_se_xen"] = IV2SLS.from_formula("y ~ 1 + x1 + x2 + [xen ~ z]", p).fit(cov_type="robust", debiased=False).std_errors.xen

# 06 nonlinear
X = sm.add_constant(p[["x1", "x2"]])
lg = sm.Logit(p.d, X).fit(disp=0)
R["logit_b_x1"] = lg.params.x1; R["logit_se_x1"] = lg.bse.x1; R["logit_ll"] = lg.llf
R["probit_b_x1"] = sm.Probit(p.d, X).fit(disp=0).params.x1
R["pois_b_x1"] = sm.Poisson(p.cnt, X).fit(disp=0).params.x1

# 07 panel FE
pp = p.set_index(["id", "year"])
fe = PanelOLS.from_formula("y ~ x1 + x2 + xen + EntityEffects", pp).fit(cov_type="unadjusted")
R["fe_b_x1"] = fe.params.x1; R["fe_se_x1"] = fe.std_errors.x1
R["areg_b_x1"] = fe.params.x1
# xtreg,fe vce(cluster id): G/(G-1)*(N-1)/(N-K) with K excluding absorbed FE
dm = p.copy()
for v in ["y", "x1", "x2", "xen"]:
    dm[v] = p[v] - p.groupby("id")[v].transform("mean") + p[v].mean()
m = smf.ols("y ~ x1 + x2 + xen", dm).fit()
Xd = sm.add_constant(dm[["x1", "x2", "xen"]]).to_numpy(); e = m.resid.to_numpy()
XtXi = np.linalg.inv(Xd.T @ Xd); G = p.id.nunique(); N = len(p); K = 4
meat = sum(np.outer(s, s) for s in (pd.DataFrame(Xd * e[:, None]).groupby(p.id.to_numpy()).sum().to_numpy()))
V = XtXi @ meat @ XtXi * G / (G - 1) * (N - 1) / (N - K)
R["fecl_se_x1"] = float(np.sqrt(V[1, 1]))
R["n_lag"] = N - p.id.nunique()
tw = PanelOLS.from_formula("y ~ x1 + x2 + xen + EntityEffects + TimeEffects", pp).fit()
R["hdfe_b_x1"] = tw.params.x1

# 08 data management
mg = p.merge(grpinfo, on="grp")
R["mean_gvar"] = mg.gvar.mean()
col = p.groupby("grp").y.mean()
R["collapse_N"] = len(col); R["collapse_mean_my"] = col.mean(); R["restored_N"] = len(p)
R["wide_N"] = p.id.nunique(); R["wide_mean"] = p.x1[p.year == 2017].mean(); R["long_N"] = len(p)
R["append_N"] = 2 * len(p); R["dedup_N"] = len(p); R["top_x1"] = p.x1.max()

# 09 programming
R["mac_b_x1"] = smf.ols("y ~ x1 + x2", p).fit().params.x1
R["forv_total"] = 55; R["scalar_mz"] = p.z.mean(); R["capture_rc"] = 111; R["prog_out"] = 42
R["mat_b11"] = smf.ols("y ~ x1", p).fit().params.x1; R["wordcount"] = 2; R["delim_N"] = int((p.x1 > 0).sum())

# 10 errors: Stata return codes
R.update(err_var_rc=111, err_exists_rc=110, err_type_rc=109, err_noreg_rc=0, err_cmd_rc=199)

Path(sys.argv[2]).write_text(json.dumps({k: (float(v) if v is not None else None) for k, v in R.items()}, indent=1))
print(len(R), "reference values")
