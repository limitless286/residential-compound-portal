import { editUnit } from '../services/unitEditService.js';

export async function editUnitRecord(req, res, next) {
  try {
    const unit = await editUnit(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'UNIT_UPDATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      unitId: unit.id,
      changedFields: Object.keys(req.body),
      requestId: req.requestId
    }));

    res.status(200).json({
      data: { unit },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
