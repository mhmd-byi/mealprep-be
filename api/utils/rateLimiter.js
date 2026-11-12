const createRateLimiter = ({ max, windowMs }) => {
  const hits = new Map();

  const prune = (now) => {
    for (const [key, times] of hits) {
      const recent = times.filter((time) => now - time < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  };

  return {
    allow(key, now = Date.now()) {
      if (hits.size > 5000) prune(now);
      const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    }
  };
};

const clientIp = (req) => {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
};

module.exports = { createRateLimiter, clientIp };
