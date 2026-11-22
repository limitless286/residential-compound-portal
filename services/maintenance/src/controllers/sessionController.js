import { logoutSession } from '../services/sessionService.js';

export function me(req, res) {
  res.status(200).json({
    data: req.auth.user,
    requestId: req.requestId
  });
}

export async function logout(req, res) {
  await logoutSession(req.auth.tokenHash);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'maintenance',
    action: 'LOGOUT',
    outcome: 'SUCCESS',
    userId: req.auth.user.id,
    requestId: req.requestId
  }));

  res.status(204).end();
}
