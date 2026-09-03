const { DateTime } = require('luxon');

// Single source of truth for the business timezone. Every "current time" or
// "what day is it" question in this app must go through this file — never
// through the server process's own local timezone (new Date().getHours(),
// .setHours(), Date.now() interpreted as local, etc.), which depends on
// whatever timezone the *hosting machine* happens to be configured with and
// silently changes behavior when the app is redeployed somewhere else.
const IST_ZONE = 'Asia/Kolkata';

// The current moment, explicitly anchored to IST regardless of the server's
// own OS/process timezone. Use this for "is it before 10:30 AM" type checks.
const nowIST = () => DateTime.now().setZone(IST_ZONE);

// Minutes since IST midnight for the current moment — for cutoff comparisons
// like "lunch closes at 10:30 AM" (630) / "dinner closes at 4:00 PM" (960).
const currentISTMinutesSinceMidnight = () => {
  const ist = nowIST();
  return ist.hour * 60 + ist.minute;
};

// Every calendar-day-only field in this app (Subscription.subscriptionStartDate,
// MealCancellation.startDate/endDate, MealDietaryPreference.date, MealDelivery.date
// comparisons, etc.) has always been stored as UTC midnight of that calendar day —
// i.e. exactly what `new Date("YYYY-MM-DD")` produces. That convention already
// matches every existing record in the database, so this migration keeps it
// unchanged (no data migration needed) and only replaces the fragile, ad hoc
// re-normalization logic that read those values back inconsistently.

// Today's IST calendar date, expressed as a JS Date at UTC midnight — the same
// convention as every stored calendar-day field above, so it can be compared
// against them directly.
const todayCalendarDateUTC = () => {
  const ist = nowIST();
  return DateTime.fromObject(
    { year: ist.year, month: ist.month, day: ist.day },
    { zone: 'utc' }
  ).toJSDate();
};

// Parses a "YYYY-MM-DD" string, a Date, or anything else `new Date()` accepts
// into that same UTC-midnight calendar-day convention — strips any stray
// time-of-day component so callers never need their own .setHours(0,0,0,0).
const parseCalendarDate = (input) => {
  let dt;
  if (input instanceof Date) {
    dt = DateTime.fromJSDate(input, { zone: 'utc' });
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    dt = DateTime.fromISO(input, { zone: 'utc' });
  } else {
    dt = DateTime.fromJSDate(new Date(input), { zone: 'utc' });
  }
  return DateTime.fromObject({ year: dt.year, month: dt.month, day: dt.day }, { zone: 'utc' }).toJSDate();
};

// Whole-day difference (laterDate - earlierDate), both expected in the
// UTC-midnight calendar-day convention above.
const diffInCalendarDays = (laterDate, earlierDate) => {
  const a = DateTime.fromJSDate(laterDate, { zone: 'utc' });
  const b = DateTime.fromJSDate(earlierDate, { zone: 'utc' });
  return Math.round(a.diff(b, 'days').days);
};

const addCalendarDays = (date, days) => {
  return DateTime.fromJSDate(date, { zone: 'utc' }).plus({ days }).toJSDate();
};

// "YYYY-MM-DD" key for a stored calendar-date value (e.g. for Map/Set lookups).
const calendarDateKey = (date) => DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('yyyy-MM-dd');

// Day of week for a calendar-date value: 0 = Sunday .. 6 = Saturday (matches
// JS Date#getDay(), since callers already branch on that convention).
const calendarDayOfWeek = (date) => {
  const luxonWeekday = DateTime.fromJSDate(date, { zone: 'utc' }).weekday; // 1 = Monday .. 7 = Sunday
  return luxonWeekday % 7; // 7 (Sunday) -> 0, 1..6 unchanged
};

// Start/end of an IST calendar day, as real UTC instants — for range-querying
// fields that store an actual timestamp (not a calendar-day-only value), e.g.
// "everything that happened on IST calendar day X". Accepts a "YYYY-MM-DD"
// string or a Date (only the calendar day it names is used).
const istDayBoundsUTC = (input) => {
  const dateKey = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? input
    : calendarDateKey(parseCalendarDate(input));
  const istDay = DateTime.fromISO(dateKey, { zone: IST_ZONE });
  return {
    start: istDay.startOf('day').toJSDate(),
    end: istDay.endOf('day').toJSDate(),
  };
};

// Start/end-of-day bounds (in the UTC-midnight calendar-day convention) for a
// calendar-day-only field — a defensive range match that still finds a stored
// value even if it ever picked up a stray time-of-day component, without
// depending on the server's local timezone the way `.setHours(23,59,59,999)`
// on a raw Date does.
const calendarDateRangeUTC = (input) => {
  const start = parseCalendarDate(input);
  const end = new Date(addCalendarDays(start, 1).getTime() - 1);
  return { start, end };
};

module.exports = {
  IST_ZONE,
  nowIST,
  currentISTMinutesSinceMidnight,
  todayCalendarDateUTC,
  parseCalendarDate,
  diffInCalendarDays,
  addCalendarDays,
  calendarDateKey,
  calendarDayOfWeek,
  istDayBoundsUTC,
  calendarDateRangeUTC,
};
