import { z } from 'zod';
import { RuleSetDto } from '../bre/bre.schemas.ts';
import { LoanDto } from '../loans/loan.dto.ts';
import { errorResponses, json, registry } from '../../openapi/registry.ts';
import {
  ApplyBody,
  ConfirmSlipBody,
  LoanWithPaymentsDto,
  ProfileBody,
  ProfileDto,
  UploadOptionsDto,
} from './borrower.schemas.ts';

const tags = ['borrower'];
const id = { params: z.object({ id: z.string() }) };

registry.registerPath({
  method: 'get',
  path: '/bre/rules',
  tags,
  summary: 'Current eligibility rule set, for client-side hints',
  responses: { 200: { description: 'OK', ...json(RuleSetDto) }, ...errorResponses(401, 403) },
});
registry.registerPath({
  method: 'get',
  path: '/borrower/profile',
  tags,
  summary: 'Own profile, onboarding stage, slip and latest BRE result',
  responses: { 200: { description: 'OK', ...json(ProfileDto) }, ...errorResponses(401, 403) },
});
registry.registerPath({
  method: 'put',
  path: '/borrower/profile',
  tags,
  summary: 'Submit personal details; the server runs the BRE',
  request: { body: json(ProfileBody) },
  responses: {
    200: { description: 'Eligible', ...json(ProfileDto) },
    ...errorResponses(400, 401, 403, 409, 422),
  },
});
registry.registerPath({
  method: 'post',
  path: '/borrower/salary-slip',
  tags,
  summary: 'Upload salary slip (PDF/JPG/PNG, ≤ 5 MB) as multipart field "file"',
  request: {
    body: {
      content: {
        'multipart/form-data': { schema: z.object({ file: z.string().meta({ format: 'binary' }) }) },
      },
    },
  },
  responses: { 200: { description: 'Stored', ...json(ProfileDto) }, ...errorResponses(401, 403, 409, 422) },
});
registry.registerPath({
  method: 'get',
  path: '/borrower/loans',
  tags,
  summary: 'Own loans, newest first',
  responses: { 200: { description: 'OK', ...json(z.array(LoanDto)) }, ...errorResponses(401, 403) },
});
registry.registerPath({
  method: 'post',
  path: '/borrower/loans',
  tags,
  summary: 'Apply. Server computes interest and total.',
  request: { body: json(ApplyBody) },
  responses: { 201: { description: 'Applied', ...json(LoanDto) }, ...errorResponses(400, 401, 403, 409) },
});
registry.registerPath({
  method: 'get',
  path: '/borrower/loans/{id}',
  tags,
  summary: 'Own loan with payments (404 if not yours)',
  request: id,
  responses: { 200: { description: 'OK', ...json(LoanWithPaymentsDto) }, ...errorResponses(401, 403, 404) },
});

registry.registerPath({
  method: 'get',
  path: '/borrower/salary-slip/upload-options',
  tags,
  summary: "How to upload: 'direct' (browser → storage via presigned URL) or 'server' (multipart to the API)",
  responses: { 200: { description: 'OK', ...json(UploadOptionsDto) }, ...errorResponses(401, 403) },
});
registry.registerPath({
  method: 'post',
  path: '/borrower/salary-slip/presign',
  tags,
  summary:
    'Storage SDK handshake: returns a 5-minute presigned PUT for one pathname under the caller’s folder',
  request: { body: json(z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) })) },
  responses: {
    200: { description: 'Presigned upload', ...json(z.record(z.string(), z.unknown())) },
    ...errorResponses(401, 403, 409, 422),
  },
});
registry.registerPath({
  method: 'post',
  path: '/borrower/salary-slip/confirm',
  tags,
  summary: 'After a direct upload: server checks size and magic bytes of the stored file, then records it',
  request: { body: json(ConfirmSlipBody) },
  responses: {
    200: { description: 'Stored', ...json(ProfileDto) },
    ...errorResponses(401, 403, 404, 409, 422),
  },
});
