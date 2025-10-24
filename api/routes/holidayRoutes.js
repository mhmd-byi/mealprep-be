const { addHoliday, getAllHolidays } = require("../controllers/holidayController");

const holidayRoutes = function (app) {
    app.route('/holiday/add-holiday').post(addHoliday);
    app.route('/holiday/get-holidays').get(getAllHolidays);
}

module.exports = {holidayRoutes};