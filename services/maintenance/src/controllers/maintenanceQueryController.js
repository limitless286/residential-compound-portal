import {
  getMaintenanceRequests,
  getMaintenanceRequest
} from '../services/maintenanceQueryService.js';

export async function listRequests(req, res, next) {
  try {
    const data = await getMaintenanceRequests(
      req.auth.user,
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

export async function getRequest(req, res, next) {
  try {
    const data = await getMaintenanceRequest(
      req.auth.user,
      req.params.id
    );

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
