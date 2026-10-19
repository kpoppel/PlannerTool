const DAY = 86400000;

function calendarTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter a complete calendar date.');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error('Enter a valid calendar date.');
  }
  return time;
}

export function generatorDefaults() {
  const start = new Date().toISOString().slice(0, 10);
  return { mode: 'count', start, end: new Date(calendarTime(start) + 41 * DAY).toISOString().slice(0, 10),
    length: 2, unit: 'weeks', count: 3, prefix: 'Iteration', firstNumber: 1 };
}

export function validateIteration(value) {
  if (!value.name.trim()) throw new Error('Enter an iteration name.');
  const start = calendarTime(value.startDate);
  const finish = calendarTime(value.finishDate);
  if (finish < start) throw new Error('End date must be on or after the start date.');
  return { ...value, name: value.name.trim() };
}

export function generateIterations(settings) {
  const start = calendarTime(settings.start);
  if (!['days', 'weeks'].includes(settings.unit)) throw new Error('Choose days or weeks.');
  const days = settings.length * (settings.unit === 'weeks' ? 7 : 1);
  if (!Number.isInteger(settings.length) || days < 1 || days > 366) {
    throw new Error('Iteration length must be 1 to 366 calendar days.');
  }
  if (!Number.isInteger(settings.firstNumber) || settings.firstNumber < 1 || settings.firstNumber > 99999 || !settings.prefix.trim()) {
    throw new Error('Enter a name prefix and positive starting number.');
  }
  let count;
  let finish;
  if (settings.mode === 'until') {
    finish = calendarTime(settings.end);
    if (finish < start) throw new Error('End date must be on or after the start date.');
    count = Math.ceil(((finish - start) / DAY + 1) / days);
  } else if (settings.mode === 'count') {
    count = settings.count;
    finish = start + (count * days - 1) * DAY;
  } else throw new Error('Choose a generation mode.');
  if (!Number.isInteger(count) || count < 1 || count > 520) throw new Error('Generate between 1 and 520 iterations.');
  if (finish > Date.parse('9999-12-31T00:00:00Z')) throw new Error('Generated dates must end before year 10000.');
  return Array.from({ length: count }, (unused, index) => {
    const rowStart = start + index * days * DAY;
    return { path: `generated-${settings.firstNumber + index}`, name: `${settings.prefix.trim()} ${settings.firstNumber + index}`,
      startDate: new Date(rowStart).toISOString().slice(0, 10),
      finishDate: new Date(Math.min(finish, rowStart + (days - 1) * DAY)).toISOString().slice(0, 10) };
  });
}

export function durationDays(value) {
  return (calendarTime(value.finishDate) - calendarTime(value.startDate)) / DAY + 1;
}