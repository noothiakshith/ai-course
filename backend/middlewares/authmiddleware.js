import jwt from 'jsonwebtoken';

function authenticateToken(req, res, next) {
  const authCookie = req.cookies['authcookie'];

  if (!authCookie) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(authCookie, process.env.ACCESS_TOKEN_SECRET || 'defaultsecret', (err, user) => {
    if (err) {
      console.error('Token verification failed:', err);
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }

    req.user = user; // Attach user to request
    next();
  });
}

export default authenticateToken;
