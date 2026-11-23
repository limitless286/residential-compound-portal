import {
  submitMaintenanceRequest
} from '../services/maintenanceService.js';

export async function createRequest(req, res, next) {
  try {
    const result = await submitMaintenanceRequest(
      req.auth?.user,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'MAINTENANCE_REQUEST_CREATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      maintenanceRequestId: result.request.id,
      requestId: req.requestId
    }));

    res.status(201).json({
      data: {
        ...result,
        warnings: result.possibleDuplicates.length > 0
          ? [{
              code: 'POSSIBLE_DUPLICATE',
              message: 'You already have active requests at this location in the same category.'
            }]
          : []
      },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
