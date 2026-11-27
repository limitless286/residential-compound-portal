import {
  createFacility,
  editFacility,
  listFacilities,
  replaceFacilityOpeningHours
} from '../services/facilityService.js';

export async function listFacilityRecords(req, res) {
  const data = await listFacilities(req.auth.user);
  res.status(200).json({ data, requestId: req.requestId });
}

export async function createFacilityRecord(req, res) {
  const data = await createFacility(req.auth.user, req.body, req.requestId);
  res.status(201).json({ data, requestId: req.requestId });
}

export async function editFacilityRecord(req, res) {
  const data = await editFacility(req.auth.user, req.params.id, req.body, req.requestId);
  res.status(200).json({ data, requestId: req.requestId });
}

export async function replaceOpeningHoursRecord(req, res) {
  const data = await replaceFacilityOpeningHours(
    req.auth.user,
    req.params.id,
    req.body,
    req.requestId
  );
  res.status(200).json({ data, requestId: req.requestId });
}
