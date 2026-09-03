const Holiday = require('../models/holidayModel');
const { parseCalendarDate, addCalendarDays, diffInCalendarDays } = require('../utils/dateUtils');

const MAX_HOLIDAY_RANGE_DAYS = 90;

const addHoliday = async (req, res) => {
    try {
        const { startDate, endDate, date, description } = req.body;

        if (!description) {
            return res.status(400).json({ message: 'Description is required' });
        }

        // Accepts either a single day (date) or a range (startDate + endDate) —
        // a range with no endDate is treated as a single-day holiday.
        const rangeStart = parseCalendarDate(startDate || date);
        const rangeEnd = parseCalendarDate(endDate || startDate || date);

        if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) {
            return res.status(400).json({ message: 'A valid date (or startDate/endDate) is required' });
        }
        if (rangeEnd < rangeStart) {
            return res.status(400).json({ message: 'endDate must be on or after startDate' });
        }

        const spanDays = diffInCalendarDays(rangeEnd, rangeStart) + 1;
        if (spanDays > MAX_HOLIDAY_RANGE_DAYS) {
            return res.status(400).json({ message: `Date range too large (max ${MAX_HOLIDAY_RANGE_DAYS} days)` });
        }

        const holidayDocs = [];
        for (let i = 0; i < spanDays; i++) {
            holidayDocs.push({ date: addCalendarDays(rangeStart, i), description });
        }
        const response = await Holiday.insertMany(holidayDocs);

        res.status(200).json({
            message: spanDays > 1
                ? `${spanDays} holiday days added successfully`
                : 'Holiday added successfully',
            holidays: response
        });
    } catch (e) {
        console.error('Error adding holiday:', e);
        res.status(401).json({ message: 'Error adding holiday' });
    }
};

const getAllHolidays = async (req, res) => {
    try {
        const response = await Holiday.find({});
        res.status(200).json({
            holidays: response
        });
    } catch (e) {
        res.status(401).json({ message: 'Error fetching holidays' });
    }
};

const deleteHoliday = async (req, res) => {
    try {
        const { holidayId } = req.params;
        await Holiday.findByIdAndDelete(holidayId);
        res.status(200).json({ message: 'Holiday deleted successfully' });
    } catch (e) {
        res.status(401).json({ message: 'Error deleting holiday' });
    }
};

module.exports = { addHoliday, getAllHolidays, deleteHoliday };
