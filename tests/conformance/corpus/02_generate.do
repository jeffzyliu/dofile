* generate / replace with if, egen with by, _n/_N, string ops, labels
use cps, clear
generate double lwage = ln(wage_hr)
generate double exper = age - yrsed - 6
replace exper = 0 if exper < 0
generate double exper2 = exper^2
quietly summarize exper
display "CHECK sum_exper=" %20.12g r(sum)
bysort region: egen double mage = mean(age)
quietly summarize mage if region == 1
display "CHECK mage_r1=" %20.12g r(mean)
bysort hhid: generate hhsize = _N
quietly summarize hhsize
display "CHECK max_hhsize=" %20.12g r(max)
generate byte college = yrsed >= 16 if !missing(yrsed)
quietly summarize college
display "CHECK mean_college=" %20.12g r(mean)
decode sex, generate(sexstr)
generate sexinit = substr(sexstr, 1, 1)
count if sexinit == "F"
display "CHECK n_female=" %20.12g r(N)
label variable lwage "Log hourly wage"
label define yn 0 "No" 1 "Yes"
label values college yn
tabulate college
recode yrsed (0/11 = 1) (12 = 2) (13/15 = 3) (16/max = 4), generate(edcat)
tabulate edcat
