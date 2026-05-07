const jwt = require('jsonwebtoken');

const { findUserById } = require('../services/userStore');

const JWT_SECRET = process.env.JWT_SECRET || 'receiptiq-dev-secret';

function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: 'Authentication is required.' });
    }

    const payload = jwt.verify(match[1], JWT_SECRET);
    const user = await findUserById(payload.sub);

    if (!user) {
      return res.status(401).json({ error: 'Your session is no longer valid.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Authentication failed. Please sign in again.' });
  }
}

module.exports = {
  requireAuth,
  signUserToken
};
