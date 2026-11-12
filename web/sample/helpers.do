* Helpers for analysis.do: a small program that compares the average wage of two groups.
* Define a program once, then call it by name. analysis.do loads this file with `do helpers.do`.

capture program drop wagegap
program define wagegap
    args groupvar
    quietly summarize wage if `groupvar' == 1
    local with = r(mean)
    quietly summarize wage if `groupvar' == 0
    local without = r(mean)
    display "average wage, `groupvar' = 1: " %6.2f `with'
    display "average wage, `groupvar' = 0: " %6.2f `without'
    display "difference: " %6.2f `with' - `without'
end
