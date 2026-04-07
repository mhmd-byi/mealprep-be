const { addHoliday, getAllHolidays, deleteHoliday } = require("../controllers/holidayController");

const holidayRoutes = function (app) {
    app.route('/holiday/add-holiday').post(addHoliday);
    app.route('/holiday/get-holidays').get(getAllHolidays);
    app.route('/holiday/delete-holiday/:holidayId').delete(deleteHoliday)
}

module.exports = {holidayRoutes};