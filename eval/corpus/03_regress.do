* OLS family on CPS: regress, robust, weights, predict, test
use cps, clear
generate double lwage = ln(wage_hr)
generate double exper = age - yrsed - 6
generate double exper2 = exper^2
regress lwage yrsed exper exper2
display "CHECK ols_b_yrsed=" %20.12g _b[yrsed]
display "CHECK ols_se_yrsed=" %20.12g _se[yrsed]
display "CHECK ols_b_cons=" %20.12g _b[_cons]
display "CHECK ols_N=" %20.12g e(N)
display "CHECK ols_r2=" %20.12g e(r2)
test exper exper2
display "CHECK ols_F_exper=" %20.12g r(F)
predict double yhat
predict double res, residuals
quietly summarize yhat
display "CHECK mean_yhat=" %20.12g r(mean)
regress lwage yrsed exper exper2, robust
display "CHECK rob_se_yrsed=" %20.12g _se[yrsed]
regress lwage yrsed exper exper2 [aweight = fnlwgt]
display "CHECK aw_b_yrsed=" %20.12g _b[yrsed]
regress lwage yrsed exper exper2 if age >= 25 & age <= 55
display "CHECK sub_b_yrsed=" %20.12g _b[yrsed]
