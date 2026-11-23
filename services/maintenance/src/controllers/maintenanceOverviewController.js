import {
  readMaintenanceOverview
} from '../services/maintenanceOverviewService.js';

export async function maintenanceOverview(req, res, next) {
  try {
    const data = await readMaintenanceOverview(
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
