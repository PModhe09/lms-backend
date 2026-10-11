import type { Request, Response } from 'express';
import { parse } from '../../lib/parse.ts';
import { parseObjectId } from '../shared/http.ts';
import { ApplyBody, ProfileBody } from './borrower.schemas.ts';
import type { BorrowerService } from './borrower.service.ts';

export class BorrowerController {
  constructor(private readonly borrowers: BorrowerService) {}

  getProfile = async (req: Request, res: Response) => {
    res.json(await this.borrowers.getProfile(req.user!.id));
  };

  submitProfile = async (req: Request, res: Response) => {
    res.json(await this.borrowers.submitProfile(req.user!.id, parse(ProfileBody, req.body)));
  };

  uploadSlip = async (req: Request, res: Response) => {
    res.json(await this.borrowers.uploadSlip(req.user!.id, req.file));
  };

  apply = async (req: Request, res: Response) => {
    res.status(201).json(await this.borrowers.apply(req.user!.id, parse(ApplyBody, req.body)));
  };

  listLoans = async (req: Request, res: Response) => {
    res.json(await this.borrowers.listLoans(req.user!.id));
  };

  getLoan = async (req: Request, res: Response) => {
    res.json(await this.borrowers.getLoan(req.user!.id, parseObjectId(req.params.id)));
  };
}
