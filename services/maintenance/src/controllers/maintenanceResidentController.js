import {
  confirmMaintenanceResolution
} from '../services/maintenanceWorkflowService.js';

export async function confirmResolution(req, res, next) {
  try {
    const request = await confirmMaintenanceResolution(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'MAINTENANCE_CONFIRMED',
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
