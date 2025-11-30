export function parseDate(str){ const [y,m,d] = str.split('-').map(Number); return new Date(y, m-1, d); }
export function formatDate(dt){
	const y = dt.getFullYear();
	const m = String(dt.getMonth()+1).padStart(2,'0');
	const d = String(dt.getDate()).padStart(2,'0');
	return `${y}-${m}-${d}`;
}
export function addMonths(date, n){ const d = new Date(date); d.setMonth(d.getMonth()+n); return d; }
export function dateRangeInclusiveMonths(start, end){ const arr=[]; let d = new Date(start); d.setDate(1); const limit = new Date(end); limit.setDate(1); while(d<=limit){ arr.push(new Date(d)); d.setMonth(d.getMonth()+1); } return arr; }
export function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
