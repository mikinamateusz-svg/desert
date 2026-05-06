import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { type User, UserRole } from '@prisma/client';

/**
 * Story 3.14 — per-user throttle for flag-wrong with admin bypass.
 *
 * The default `ThrottlerGuard` keys on client IP, which is wrong for our
 * use case in two ways:
 *  - Drivers behind a carrier CGNAT or shared NAT would share the 5/hr
 *    budget (P-7).
 *  - Admins doing field-test moderation need to flag many submissions in
 *    a short period (AC10 — admin bypass, P-8).
 *
 * This guard overrides:
 *  - `getTracker` to use `req.currentUser.id` (attached by JwtAuthGuard)
 *    so each user has their own bucket; falls back to IP for the
 *    impossible-but-defensive case where currentUser is somehow missing.
 *  - `shouldSkip` to return true when the actor is an ADMIN, bypassing
 *    the throttle entirely.
 *
 * Used via `@UseGuards(FlagWrongThrottlerGuard)` on the flag-wrong
 * endpoint to override the global ThrottlerGuard for this one route only.
 */
@Injectable()
export class FlagWrongThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const fastifyReq = req as unknown as FastifyRequest & { currentUser?: User };
    const user = fastifyReq.currentUser;
    if (user?.id) return `user:${user.id}`;
    // Fall through to IP — should not happen because JwtAuthGuard runs first
    // and attaches currentUser, but defensive in case guard ordering changes.
    return fastifyReq.ip ?? 'anonymous';
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const user = (req as FastifyRequest & { currentUser?: User }).currentUser;
    return user?.role === UserRole.ADMIN;
  }
}
