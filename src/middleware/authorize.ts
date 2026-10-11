import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../domain/errors.ts';
import { hasPermission, type Permission } from '../domain/rbac.ts';

/** 403 unless the caller's role holds every listed permission. Must run after `authenticate`. */
export const authorize =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthenticatedError();
    const { role } = req.user;
    if (!permissions.every((p) => hasPermission(role, p))) throw new ForbiddenError();
    next();
  };

/** 403 unless the caller's role holds at least one of the listed permissions. */
export const authorizeAny =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthenticatedError();
    const { role } = req.user;
    if (!permissions.some((p) => hasPermission(role, p))) throw new ForbiddenError();
    next();
  };
