* wages by age and schooling (synthetic data)
clear
set seed 2026
set obs 500
gen age = 22 + floor(40*runiform())
gen educ = 10 + floor(9*runiform())
gen wage = 4 + .12*age + .9*educ + 3*rnormal()
label variable wage "Hourly wage"
label variable educ "Years of schooling"
save data/wages, replace
foreach v in age educ {
    local controls `controls' `v'
}
regress wage `controls'
scatter wage educ
graph export output/scatter.png, replace width(1200)
summarize wage if sex == 1
