export function introspect(req, res) {
  const user = req.auth.user;

  res.setHeader('Cache-Control', 'no-store');

  res.status(200).json({
    data: {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      unitId: user.unitId,
      buildingId: user.buildingId,
      status: 'ACTIVE'
    },
    requestId: req.requestId
  });
}
