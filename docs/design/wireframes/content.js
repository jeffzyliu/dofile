// Shared placeholder content for the wireframes: elements with data-fill="name" get the block below.
// The log is dofile's own output on synthetic data (docs/design/specimen).
const G = '<span class="gutter">', E = '</span>';
const blocks = {
  toolbar: `
    <span class="mark" title="links to the landing page">dofile</span>
    <span class="btn primary">Run</span><span class="btn">Run selection</span><span class="btn">Break</span>
    <span class="btn">Save</span>
    <span class="spacer"></span>
    <span class="btn ghost">⋯ Reset · Clear log · Download all · Keyboard shortcuts · About dofile</span>`,
  files: `
    <ul class="files">
      <li class="on">analysis.do •</li>
      <li>clean.do</li>
      <li class="dir">▾ data/</li>
      <li>&nbsp;&nbsp;wages.dta</li>
      <li>&nbsp;&nbsp;raw.csv</li>
      <li class="dir">▾ output/</li>
      <li class="new">&nbsp;&nbsp;scatter.png</li>
      <li class="new">&nbsp;&nbsp;analysis.log</li>
    </ul>
    <div class="drop">Drop files, folders or a .zip<br><u>Upload</u> · <u>New .do file</u></div>
    <div style="margin-top:8px;color:#6b6b6b;font-size:12px">⋯ Download all · Restore the sample · Delete all files</div>`,
  editortabs: `<span class="tab on">analysis.do •</span><span class="tab">clean.do<span class="x">×</span></span>
    <span class="spacer"></span><span class="status">unsaved</span>`,
  editor: `<pre>${G}1${E}* wages by age and schooling (synthetic data)
${G}2${E}use data/wages, clear
${G}3${E}foreach v in age educ {
${G}4${E}    local controls \`controls' \`v'
${G}5${E}}
<span class="sel">${G}6${E}regress wage \`controls'</span>
<span class="sel">${G}7${E}scatter wage educ</span>
<span class="err-mark">${G}8${E}summarize wage if sex == 1</span>
${G}9${E}<span class="u">reghdfe</span> wage \`controls', absorb(firm)</pre>`,
  log: `<pre><span class="echo">. regress wage \`controls'</span>

      Source |       SS           df       MS      Number of obs   =       500
-------------+----------------------------------   F(2, 497)       =    172.07
       Model |  3046.98519         2  1523.49259   Prob &gt; F        =    0.0000
    Residual |  4400.35521       497  8.85383342   R-squared       =    0.4091
-------------+----------------------------------   Adj R-squared   =    0.4068
       Total |  7447.34039       499  14.9245298   Root MSE        =    2.9755

------------------------------------------------------------------------------
        wage |      Coef.   Std. Err.      t    P&gt;|t|     [95% Conf. Interval]
-------------+----------------------------------------------------------------
         age |   .1111234   .0115734     9.60   0.000     .0883846    .1338622
        educ |   .8594138   .0515739    16.66   0.000     .7580842    .9607435
       _cons |   4.857541   .9089541     5.34   0.000     3.071675    6.643408
------------------------------------------------------------------------------

<span class="echo">. scatter wage educ</span>
<u>[graph 2]</u>

<span class="echo">. summarize wage if sex == 1</span>
<span class="errline">sex not found
r(111);</span>   <u>line 8 ↗</u>  <u>next error ↓</u></pre>`,
  loghead: `<span class="title">Log</span><span class="spacer"></span><span class="status">⌕ Find · Download log</span>`,
  cmdline: `<span class="prompt">.</span><span class="field">type a command (↑ ↓ history)</span><span class="btn">Run</span>`,
  graph: `<div class="graph" style="height:calc(100% - 46px)">graph 2 of 2: scatter wage educ</div>
    <div class="thumbs"><span>1</span><span class="on">2</span><span style="border:none;background:none;width:auto">Export PNG · Open full size</span></div>`,
  data: `<div class="kv"><span>file</span><span>data/wages.dta</span><span>observations</span><span>500</span>
    <span>variables</span><span>3</span><span>size · memory</span><span>12 KB · engine 610 MB</span></div>
    <div class="filter">filter variables…</div>
    <table class="t"><tr><th>name</th><th>label</th><th>type</th><th>format</th></tr>
    <tr><td>age</td><td></td><td>float</td><td>%9.0g</td></tr>
    <tr><td>educ</td><td></td><td>float</td><td>%9.0g</td></tr>
    <tr><td>wage</td><td>Hourly wage</td><td>float</td><td>%9.0g</td></tr></table>
    <div style="margin-top:6px;color:#6b6b6b">click a name: insert it · <u>Browse rows</u></div>`,
  results: `<table class="t"><tr><th colspan="2">e() · regress</th></tr>
    <tr><td>N</td><td>500</td></tr><tr><td>r2</td><td>.4091</td></tr><tr><td>F</td><td>172.07</td></tr>
    <tr><td>b, V</td><td><u>1×3</u>, <u>3×3</u></td></tr>
    <tr><th colspan="2">r()</th></tr><tr><td>table</td><td><u>9×3</u></td></tr>
    <tr><th colspan="2">locals · globals</th></tr>
    <tr><td>controls</td><td>age educ</td></tr><tr><td>$project</td><td>wages</td></tr></table>`,
  help: `<b>regress</b> — Linear regression<br><span style="color:#6b6b6b">Syntax · Description · Options · Examples · Also see</span>
    <pre style="margin-top:6px">regress depvar [indepvars] [if] [in] [weight] [, options]</pre>`,
  statusbar: `<span><b>ready</b></span><span>last run: rc 111 · 0.42 s</span><span>memory 610 MB</span>
    <span>files kept in this browser</span><span class="spacer"></span><span>Break: stops between commands</span>`,
};
for (const el of document.querySelectorAll("[data-fill]")) el.insertAdjacentHTML("beforeend", blocks[el.dataset.fill]);
