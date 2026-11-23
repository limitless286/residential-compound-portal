import {
  reopenResidentRequest
} from '../services/maintenanceReopenService.js';

export async function reopenRequest(req, res, next) {
  try {
    const request = await reopenResidentRequest(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'MAINTENANCE_REOPENED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      maintenanceRequestId: request.id,
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
