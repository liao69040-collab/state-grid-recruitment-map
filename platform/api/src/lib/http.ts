import type { FastifyReply } from 'fastify';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, max-age=0');
  reply.header('Pragma', 'no-cache');
}

export function paginationFromQuery(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(query.limit ?? 50);
  const rawOffset = Number(query.offset ?? 0);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { limit, offset };
}
