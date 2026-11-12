const contact = require('../controllers/contactMessageController');

const contactMessageRoutes = function (app) {
  app.route('/public/contact-messages').post(contact.submitContactMessage);

  app.route('/admin/contact-messages').get(contact.listContactMessages);
  app.route('/admin/contact-messages/summary').get(contact.getContactSummary);
  app.route('/admin/contact-messages/:messageId').patch(contact.updateContactMessage).delete(contact.deleteContactMessage);
};

module.exports = { contactMessageRoutes };
