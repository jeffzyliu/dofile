* macros, loops, capture, scalars, programs, stored results
use panel, clear
local covs x1 x2
global dep y
regress $dep `covs'
display "CHECK mac_b_x1=" %20.12g _b[x1]
local total = 0
forvalues i = 1/10 {
    local total = `total' + `i'
}
display "CHECK forv_total=" %20.12g `total'
foreach v of varlist x1 x2 z {
    quietly summarize `v'
    scalar m_`v' = r(mean)
}
display "CHECK scalar_mz=" %20.12g m_z
capture confirm variable nosuchvar
display "CHECK capture_rc=" %20.12g _rc
program define addone, rclass
    args val
    return scalar out = `val' + 1
end
addone 41
display "CHECK prog_out=" %20.12g r(out)
quietly regress y x1
matrix b = e(b)
display "CHECK mat_b11=" %20.12g b[1,1]
local n : word count `covs'
display "CHECK wordcount=" %20.12g `n'
#delimit ;
quietly summarize y
  if x1 > 0 ;
#delimit cr
display "CHECK delim_N=" %20.12g r(N)
estimates store m1
quietly regress y x1 x2
estimates store m2
estimates table m1 m2, se
