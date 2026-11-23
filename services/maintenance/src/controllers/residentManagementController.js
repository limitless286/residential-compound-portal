import {
  listResidents,
  changeResidentStatus
} from '../services/residentManagementService.js';

export async function listResidentRecords(req, res, next) {
  try {
    const data = await listResidents(req.auth.user, req.query);

    res.status(200).json({
      data,
      requestId: req.requestId
    });
  } catch (error) {
    next(error);
  }
}

export async function changeResidentStatusRecord(req, res, next) {
  try {
    const resident = await changeResidentStatus(
      req.auth.user,
      req.params.id,
      req.body
    );

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'maintenance',
      action: 'RESIDENT_STATUS_CHANGED',
      outcome: 'SUCCESS',
      userId: req.auth.user.id,
      residentId: resident.id,
      accountStatus: resident.status,
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
