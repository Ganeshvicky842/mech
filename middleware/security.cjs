module.exports = function applySecurityHeaders(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const forwardedProto = request.headers['x-forwarded-proto']?.split(',')[0].trim();
  if (request.socket.encrypted || forwardedProto === 'https') {
    response.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
};