import {
  lookupActiveUnits
} from '../services/internalIdentityService.js';

export async function activeUnitLookup(req, res, next) {
  try {
    const data = await lookupActiveUnits(req.auth.user, req.query);

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
