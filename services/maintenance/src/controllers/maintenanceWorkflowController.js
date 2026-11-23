import {
  performAdminMaintenanceAction
} from '../services/maintenanceWorkflowService.js';

export function adminMaintenanceAction(action) {
  return async (req, res, next) => {
    try {
      const request = await performAdminMaintenanceAction(
        req.auth.user,
        req.params.id,
        action,
        req.body
      );

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'maintenance',
        action: `MAINTENANCE_${action.toUpperCase()}`,
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
  };
}
