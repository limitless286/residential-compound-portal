export function requireRole(...allowedRoles) {
  if (
    allowedRoles.length === 0 ||
    allowedRoles.some((role) => !['ADMIN', 'RESIDENT'].includes(role))
  ) {
    throw new Error('Invalid role middleware configuration.');
  }

  return (req, res, next) => {
    if (!req.auth?.user) {
      throw Object.assign(new Error('Authentication is required.'), {
        status: 401,
        code: 'UNAUTHORIZED'
      });
    }

    if (!allowedRoles.includes(req.auth.user.role)) {
      throw Object.assign(new Error('You do not have permission.'), {
        status: 403,
        code: 'FORBIDDEN'
      });
    }

    next();
  };
}
