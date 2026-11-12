* A first look at wages, age and schooling.
* The data are synthetic (made up, not
* real people).
* Run the file, or select lines and
* press Run selection.

use data/wages, clear
describe
summarize wage age educ

* people and average wage in each region
tabulate region
tabstat wage, by(region) statistics(mean sd n)

* a regression: what goes with higher pay?
regress wage age educ female

* a loop: repeat a line for each variable
foreach v in age educ {
    quietly correlate wage `v'
    display "wage and `v': correlation " %5.3f r(rho)
}

* our own program, kept in a second file
do helpers.do
wagegap female

* a graph
scatter wage educ
