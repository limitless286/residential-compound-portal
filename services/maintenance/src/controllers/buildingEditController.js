import { editBuilding } from '../services/buildingEditService.js';

export async function editBuildingRecord(req, res, next) {
  try {
    const building = await editBuilding(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'BUILDING_UPDATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      buildingId: building.id,
      changedFields: Object.keys(req.body),
      requestId: req.requestId
    }));

    res.status(200).json({
      data: { building },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
