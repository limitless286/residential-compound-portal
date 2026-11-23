import {
  lookupNotificationRecipient
} from '../services/notificationRecipientService.js';

export async function notificationRecipientLookup(req, res, next) {
  try {
    const data = await lookupNotificationRecipient(
      req.auth.user,
      req.body,
      req.query
    );

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
