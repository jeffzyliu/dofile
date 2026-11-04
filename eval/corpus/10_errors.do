* error messages: each wrapped so the file continues; last one is uncaught
use panel, clear
capture noisily summarize nosuchvar
display "CHECK err_var_rc=" %20.12g _rc
capture noisily generate x1 = 5
display "CHECK err_exists_rc=" %20.12g _rc
capture noisily replace x1 = "text"
display "CHECK err_type_rc=" %20.12g _rc
capture noisily regress y
display "CHECK err_noreg_rc=" %20.12g _rc
capture noisily notacommand foo
display "CHECK err_cmd_rc=" %20.12g _rc
regress y x1 x9
