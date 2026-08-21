function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

module.exports = { requireAuth };
