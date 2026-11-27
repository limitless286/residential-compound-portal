// One JSON line per action. Pass only safe identifiers and codes.
// Never log passwords, tokens, service keys or connection strings.
export function logAction({
  requestId,
  action,
  outcome,
  level = 'log',
  ...details
}) {
  const write = ['log', 'info', 'warn', 'error'].includes(level)
    ? console[level]
    : console.log;

  write(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'community',
    action,
    outcome,
    requestId,
    ...details
  }));
}
