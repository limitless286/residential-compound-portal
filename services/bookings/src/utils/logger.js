// One JSON line per action. Pass only safe identifiers and codes.
// Never log passwords, tokens, API keys or connection strings.
export function logAction({
  requestId,
  action,
  outcome,
  level = 'log',
  ...details
}) {
  console[level](JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'bookings',
    action,
    outcome,
    requestId,
    ...details
  }));
}
