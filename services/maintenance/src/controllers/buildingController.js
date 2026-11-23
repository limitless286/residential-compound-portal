import {
  createBuilding,
  listBuildings
} from '../services/buildingService.js';

export async function createBuildingRecord(req, res, next) {
  try {
    const building = await createBuilding(req.auth.user, req.body);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'BUILDING_CREATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      buildingId: building.id,
      requestId: req.requestId
    }));

    res.status(201).json({
      data: { building },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}

export async function listBuildingRecords(req, res, next) {
  try {
    const data = await listBuildings(req.auth.user, req.query);

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
