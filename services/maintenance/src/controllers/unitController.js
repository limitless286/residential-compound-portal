import {
  createUnit,
  listUnits
} from '../services/unitService.js';

export async function createUnitRecord(req, res, next) {
  try {
    const unit = await createUnit(req.auth.user, req.body);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'UNIT_CREATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      unitId: unit.id,
      buildingId: unit.buildingId,
      requestId: req.requestId
    }));

    res.status(201).json({
      data: { unit },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}

export async function listUnitRecords(req, res, next) {
  try {
    const data = await listUnits(req.auth.user, req.query);

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
