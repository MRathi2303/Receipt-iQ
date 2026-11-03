const express = require('express');
const bcrypt = require('bcryptjs');

const { createUser, findUserByEmail, sanitizeUser } = require('../services/userStore');
const { signUserToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const createdUser = await createUser({ name, email, passwordHash });
    const token = signUserToken(createdUser);

    res.status(201).json({
      token,
      user: createdUser
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email || '');

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValid = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const safeUser = sanitizeUser(user);
    const token = signUserToken(safeUser);

    res.json({
      token,
      user: safeUser
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
