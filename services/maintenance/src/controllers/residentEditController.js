import { editResident } from '../services/residentEditService.js';

export async function editResidentRecord(req, res, next) {
  try {
    const resident = await editResident(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'RESIDENT_UPDATED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      residentId: resident.id,
      changedFields: Object.keys(req.body),
      requestId: req.requestId
    }));

    res.status(200).json({
      data: { resident },
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}
