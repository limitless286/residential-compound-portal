import {
  getFeePolicy,
  updateFeePolicy
} from '../services/feePolicyService.js';

export async function readFeePolicy(req, res) {
  const data = await getFeePolicy();
  res.status(200).json({ data, requestId: req.requestId });
}

export async function replaceFeePolicy(req, res) {
  const data = await updateFeePolicy({
    body: req.body,
    user: req.auth.user,
    requestId: req.requestId
  });

  res.status(200).json({ data, requestId: req.requestId });
}
