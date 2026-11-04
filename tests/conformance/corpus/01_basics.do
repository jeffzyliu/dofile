* Tutorial-level: load, describe, summarize, tabulate
use cps, clear
describe
summarize age yrsed wage_hr
display "CHECK mean_age=" %20.12g r(mean)
summarize age
display "CHECK mean_age=" %20.12g r(mean)
display "CHECK sd_age=" %20.12g r(sd)
display "CHECK N_age=" %20.12g r(N)
summarize wage_hr, detail
display "CHECK p50_wage=" %20.12g r(p50)
tabulate region
tabulate sex region
count if age > 30
display "CHECK n_over30=" %20.12g r(N)
list hhid age sex in 1/5
mean age yrsed
