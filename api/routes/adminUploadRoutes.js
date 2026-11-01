const { uploadAdminImage } = require('../controllers/adminUploadController');

const adminUploadRoutes = function(app) {
  app.route('/admin/upload-image').post(uploadAdminImage);
};

module.exports = { adminUploadRoutes };
