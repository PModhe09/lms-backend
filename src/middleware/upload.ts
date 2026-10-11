import type { RequestHandler } from 'express';
import multer from 'multer';
import { BusinessRuleError, ValidationError } from '../domain/errors.ts';

export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

const slipUpload = multer({
  storage: multer.memoryStorage(), // never touches the API's disk
  limits: { fileSize: MAX_SLIP_BYTES, files: 1, fields: 5 },
}).single('file');

/** Parses one `file` field into memory, capped at 5 MB. Larger uploads are cut off and rejected with 422. */
export const uploadSlip: RequestHandler = (req, res, next) => {
  slipUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new BusinessRuleError('INVALID_FILE', 'File is larger than 5 MB'));
      }
      return next(new ValidationError(undefined, `Upload rejected: ${err.message}`));
    }
    if (err) return next(err);
    next();
  });
};
