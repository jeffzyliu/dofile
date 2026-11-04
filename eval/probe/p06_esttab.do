use panel, clear
quietly regress y x1
estimates store a
esttab a
