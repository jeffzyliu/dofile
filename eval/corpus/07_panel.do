* panel fixed effects
use panel, clear
xtset id year
xtreg y x1 x2 xen, fe
display "CHECK fe_b_x1=" %20.12g _b[x1]
display "CHECK fe_se_x1=" %20.12g _se[x1]
areg y x1 x2 xen, absorb(id)
display "CHECK areg_b_x1=" %20.12g _b[x1]
xtreg y x1 x2 xen, fe vce(cluster id)
display "CHECK fecl_se_x1=" %20.12g _se[x1]
generate double lag_y = L.y
quietly summarize lag_y
display "CHECK n_lag=" %20.12g r(N)
capture noisily reghdfe y x1 x2 xen, absorb(id year) vce(cluster grp)
display "CHECK hdfe_b_x1=" %20.12g _b[x1]
