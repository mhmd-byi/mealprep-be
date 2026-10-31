const {
  listNotes,
  getNotesOverview,
  searchNoteCustomers,
  createNote,
  updateNote,
  setNoteDone,
  deleteNote
} = require('../controllers/noteController');
const {
  getNoteCategories,
  createNoteCategory,
  updateNoteCategory,
  deleteNoteCategory
} = require('../controllers/noteCategoryController');

const noteRoutes = function(app) {
  app.route('/notes').get(listNotes).post(createNote);
  app.route('/notes/overview').get(getNotesOverview);
  app.route('/notes/customers').get(searchNoteCustomers);
  app.route('/notes/:noteId').put(updateNote).delete(deleteNote);
  app.route('/notes/:noteId/done').patch(setNoteDone);

  app.route('/note-categories').get(getNoteCategories).post(createNoteCategory);
  app.route('/note-categories/:categoryId').put(updateNoteCategory).delete(deleteNoteCategory);
};

module.exports = {
  noteRoutes
};
