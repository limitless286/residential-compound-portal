import {
  getBookingPolicy,
  replaceBookingPolicy
} from '../services/bookingPolicyService.js';

export async function getBookingPolicyRecord(req, res) {
  const data = await getBookingPolicy(req.auth.user);
  res.status(200).json({ data, requestId: req.requestId });
}

export async function replaceBookingPolicyRecord(req, res) {
  const data = await replaceBookingPolicy(req.auth.user, req.body, req.requestId);
  res.status(200).json({ data, requestId: req.requestId });
}
