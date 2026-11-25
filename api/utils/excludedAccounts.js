const User = require('../models/userModel');

// Known test/internal customer accounts (regular 'user'-role signups used to
// try out the real customer flow, not admin logins) that must never appear
// anywhere in the admin panel — not counted, not listed, not selectable. The
// Notifications module is the one exception: the test customer can be picked
// and receives notifications so push delivery can be tried end to end.
const TEST_CUSTOMER_EMAILS = ['ermoinzafar+test@byi.com'];

// IDs of every account (admin role + the test emails above) that should be
// invisible throughout the admin panel. Callers that already have a User
// document in hand can skip the query and just check isExcludedUser(user)
// instead.
const getExcludedUserIds = async () => {
  const users = await User.find(
    { $or: [{ role: 'admin' }, { email: { $in: TEST_CUSTOMER_EMAILS } }] },
    '_id'
  ).lean();
  return users.map((u) => u._id);
};

const isExcludedUser = (user) =>
  !user || user.role !== 'user' || TEST_CUSTOMER_EMAILS.includes(user.email);

module.exports = { TEST_CUSTOMER_EMAILS, getExcludedUserIds, isExcludedUser };
