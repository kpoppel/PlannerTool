export const parseDate = (str) => {
  if (!str) return null;
  if (str instanceof Date) return new Date(str);
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const formatDate = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const addMonths = (date, n) => {
  const src = new Date(date);
  const day = src.getDate();
  const d = new Date(src.getFullYear(), src.getMonth(), 1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
};

export const dateRangeInclusiveMonths = (start, end) => {
  const arr = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  const limit = new Date(end.getFullYear(), end.getMonth(), 1);
  while (d <= limit) {
    arr.push(new Date(d.getFullYear(), d.getMonth(), 1));
    d.setMonth(d.getMonth() + 1);
  }
  return arr;
};

export const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};
