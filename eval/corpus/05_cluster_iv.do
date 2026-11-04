* clustered SEs and 2SLS on synthetic panel
use panel, clear
regress y x1 x2 xen, vce(cluster grp)
display "CHECK cl_se_x1=" %20.12g _se[x1]
display "CHECK cl_b_xen=" %20.12g _b[xen]
ivregress 2sls y x1 x2 (xen = z)
display "CHECK iv_b_xen=" %20.12g _b[xen]
display "CHECK iv_se_xen=" %20.12g _se[xen]
ivregress 2sls y x1 x2 (xen = z), vce(robust)
display "CHECK ivr_se_xen=" %20.12g _se[xen]
