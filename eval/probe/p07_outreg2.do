use panel, clear
regress y x1
outreg2 using res.txt, replace
