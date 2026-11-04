* merge, append, reshape, collapse, preserve/restore, sort
use panel, clear
merge m:1 grp using grpinfo
tabulate _merge
quietly summarize gvar
display "CHECK mean_gvar=" %20.12g r(mean)
drop _merge
preserve
collapse (mean) my=y (sum) scnt=cnt (count) n=y, by(grp)
display "CHECK collapse_N=" %20.12g _N
quietly summarize my
display "CHECK collapse_mean_my=" %20.12g r(mean)
restore
display "CHECK restored_N=" %20.12g _N
keep id year x1
reshape wide x1, i(id) j(year)
display "CHECK wide_N=" %20.12g _N
quietly summarize x12017
display "CHECK wide_mean=" %20.12g r(mean)
reshape long x1, i(id) j(year)
display "CHECK long_N=" %20.12g _N
tempfile part
save `part'
append using `part'
display "CHECK append_N=" %20.12g _N
duplicates drop
display "CHECK dedup_N=" %20.12g _N
gsort -x1
display "CHECK top_x1=" %20.12g x1[1]
