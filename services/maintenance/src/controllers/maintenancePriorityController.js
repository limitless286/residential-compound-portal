import {
  changeMaintenancePriority
} from '../services/maintenancePriorityService.js';

export async function changePriority(req, res, next) {
  try {
    const request = await changeMaintenancePriority(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'MAINTENANCE_PRIORITY_CHANGED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      maintenanceRequestId: request.id,
      priority: request.priority,
      requestId: req.requestId
    }));

    res.status(200).json({
      data: { request },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
