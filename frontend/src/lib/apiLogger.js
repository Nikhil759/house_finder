export function logStart(endpoint, params) {
  console.log(`[NestIQ:API:START]`, endpoint, params || '');
}

export function logSuccess(endpoint, count, durationMs) {
  console.log(`[NestIQ:API:SUCCESS]`, endpoint, `${count} results`, `${Math.round(durationMs)}ms`);
}

export function logError(endpoint, errorInfo, durationMs, requestId) {
  console.error(`[NestIQ:API:ERROR]`, endpoint, errorInfo, `${Math.round(durationMs)}ms`, requestId ? `rid:${requestId}` : '');
}
