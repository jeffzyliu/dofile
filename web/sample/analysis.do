* A first look at wages, age and schooling.
* The data in data/wages.dta are synthetic: made up by a script with a fixed seed, not records of real people.
* Run the whole file, or select a few lines and press Run selection.

use data/wages, clear
describe
summarize wage age educ

* how many people in each region, and the average wage in each
tabulate region
tabstat wage, by(region) statistics(mean sd n)

* a regression: what goes with a higher wage?
regress wage age educ female

* a loop: the same line for several variables
foreach v in age educ {
    quietly correlate wage `v'
    display "wage and `v': correlation " %5.3f r(rho)
}

* a program of our own, kept in a second file
do helpers.do
wagegap female

* a graph
scatter wage educ
