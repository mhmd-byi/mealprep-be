const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// Verifies the bearer token and requires an admin role. Sends the response
// and returns null when unauthorized; returns the user document otherwise.
const requireAdmin = async (req, res) => {
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
  if (!user || user.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return null;
  }
  return user;
};

module.exports = { requireAdmin };
