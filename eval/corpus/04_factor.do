* factor variables and interactions
use cps, clear
generate double lwage = ln(wage_hr)
regress lwage yrsed i.region
display "CHECK fv_b_r2=" %20.12g _b[2.region]
display "CHECK fv_b_r4=" %20.12g _b[4.region]
regress lwage c.yrsed##i.sex
display "CHECK fv_b_int=" %20.12g _b[c.yrsed#2.sex]
testparm i.region
