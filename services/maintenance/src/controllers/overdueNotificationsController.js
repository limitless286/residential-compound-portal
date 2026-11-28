import { database } from '../config/database.js';
import { listOverdueNotifications } from '../repositories/overdueMonitorRepository.js';
import { getOverdueNotifications } from '../services/overdueNotificationsService.js';

export async function overdueNotifications(req, res, next) {
  try {
    const data = await getOverdueNotifications(req.auth.user, req.query, {
      listNotifications: options => listOverdueNotifications(database, options)
    });
    res.status(200).json({ data, requestId: req.requestId });
  } catch (error) {
    if (error.status === 503) res.setHeader('Retry-After', '1');
    next(error);
  }
}
