import { createResident } from '../services/residentService.js';

export async function createResidentRecord(req, res, next) {
  try {
    const resident = await createResident(req.auth.user, req.body);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'RESIDENT_CREATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      residentId: resident.id,
      unitId: resident.unitId,
      requestId: req.requestId
    }));

    res.status(201).json({
      data: { resident },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
