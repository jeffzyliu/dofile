* binary and count models
use panel, clear
logit d x1 x2
display "CHECK logit_b_x1=" %20.12g _b[x1]
display "CHECK logit_se_x1=" %20.12g _se[x1]
display "CHECK logit_ll=" %20.12g e(ll)
probit d x1 x2
display "CHECK probit_b_x1=" %20.12g _b[x1]
poisson cnt x1 x2
display "CHECK pois_b_x1=" %20.12g _b[x1]
margins, dydx(x1)
