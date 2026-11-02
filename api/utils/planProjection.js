const {
  todayCalendarDateUTC,
  addCalendarDays,
  calendarDateKey,
  calendarDayOfWeek,
  parseCalendarDate
} = require('./dateUtils');
const Holiday = require('../models/holidayModel');

const SIMULATION_SAFETY_CAP_DAYS = 3650;

const projectExhaustionDate = (remaining, holidayDateKeys) => {
  let date = todayCalendarDateUTC();
  let daysLeft = remaining;
  for (let i = 0; i < SIMULATION_SAFETY_CAP_DAYS; i++) {
    const isSunday = calendarDayOfWeek(date) === 0;
    const isHoliday = holidayDateKeys.has(calendarDateKey(date));
    if (!isSunday && !isHoliday) {
      daysLeft -= 1;
      if (daysLeft === 0) return date;
    }
    date = addCalendarDays(date, 1);
  }
  return date;
};

const loadHolidayKeys = async (daysAhead = 60) => {
  const today = todayCalendarDateUTC();
  const horizonEnd = addCalendarDays(today, daysAhead);
  const upcoming = await Holiday.find({ date: { $gte: today, $lte: horizonEnd } });
  return new Set(upcoming.map((holiday) => calendarDateKey(parseCalendarDate(holiday.date))));
};

module.exports = { projectExhaustionDate, loadHolidayKeys };
