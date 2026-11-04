use panel, clear
tabstat y x1 x2, by(grp) statistics(mean sd n)
