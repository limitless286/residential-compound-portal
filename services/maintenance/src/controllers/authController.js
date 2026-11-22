import { loginUser } from '../services/authService.js';

export async function login(req, res) {
  const data = await loginUser(req.body);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'maintenance',
    action: 'LOGIN',
    outcome: 'SUCCESS',
    userId: data.user.id,
    requestId: req.requestId
  }));

  res.status(200).json({
    data,
    requestId: req.requestId
  });
}
