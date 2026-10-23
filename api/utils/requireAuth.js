const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// Verifies the bearer token and returns the logged-in user (any role). Sends
// the response and returns null when unauthorized/invalid. Unlike
// requireAdmin, this does not check role — callers that need to tell a
// customer acting on their own data apart from an admin acting on someone
// else's should compare the returned user's _id/role themselves.
const requireAuth = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided or token is malformed' });
    return null;
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    res.status(401).json({ message: 'Invalid Token' });
    return null;
  }
  const user = await User.findById(decoded.sub);
  if (!user) {
    res.status(401).json({ message: 'User not found' });
    return null;
  }
  return user;
};

module.exports = { requireAuth };
