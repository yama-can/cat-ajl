// Run this script in AJL Standings page, then copy the output to input.txt and run `node main.js` to generate the report.

console.log(Array.from(document.querySelector("table").rows).map((row) => Array.from(row.querySelectorAll("td"))).map(tds => tds[1] && tds[4] ? `${tds[1].textContent}: ${tds[4].textContent}` : "").filter(Boolean).join('\n'))
