import { errorResponses, json, registry } from '../../openapi/registry.ts';
import { AuthUser, LoginBody, SignupBody } from './auth.schemas.ts';

registry.registerPath({
  method: 'post',
  path: '/auth/signup',
  tags: ['auth'],
  summary: 'Create a borrower account and start a session',
  request: { body: json(SignupBody) },
  responses: { 201: { description: 'Created', ...json(AuthUser) }, ...errorResponses(400, 409) },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Start a session',
  request: { body: json(LoginBody) },
  responses: { 200: { description: 'OK', ...json(AuthUser) }, ...errorResponses(400, 401) },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'End the session',
  responses: { 204: { description: 'Logged out' } },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  summary: 'Current user',
  responses: { 200: { description: 'OK', ...json(AuthUser) }, ...errorResponses(401) },
});
