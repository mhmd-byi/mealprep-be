const Holiday = require('../models/holidayModel');

const addHoliday = async (req, res) => { 
    try {
        const holiday = new Holiday(req.body);
        const response = await holiday.save();
        res.status(200).json({
            message: 'Holiday added successfully',
            holiday: response
        });
    } catch (e) {
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

module.exports = { addHoliday, getAllHolidays };