import type { Request, Response } from 'express';
import type { OnboardingStage } from '../../domain/enums.ts';
import { LoanStatus } from '../../domain/loan/status.ts';
import { parse } from '../../lib/parse.ts';
import { PageQuery, parseObjectId } from '../shared/http.ts';
import { LeadsQuery, RecordPaymentBody, RejectBody } from './ops.schemas.ts';
import type { OpsService } from './ops.service.ts';

export class OpsController {
  constructor(private readonly ops: OpsService) {}

  queue = (status: LoanStatus) => async (req: Request, res: Response) => {
    res.json(await this.ops.queue(status, parse(PageQuery, req.query)));
  };

  leads = async (req: Request, res: Response) => {
    const { stage, ...page } = parse(LeadsQuery, req.query);
    res.json(await this.ops.leads(stage as OnboardingStage | undefined, page));
  };

  detail = async (req: Request, res: Response) => {
    res.json(await this.ops.detail(parseObjectId(req.params.id)));
  };

  slipUrl = async (req: Request, res: Response) => {
    res.json(await this.ops.slipUrl(parseObjectId(req.params.id)));
  };

  approve = async (req: Request, res: Response) => {
    res.json(await this.ops.approve(parseObjectId(req.params.id), req.user!));
  };

  reject = async (req: Request, res: Response) => {
    const { reason } = parse(RejectBody, req.body);
    res.json(await this.ops.reject(parseObjectId(req.params.id), req.user!, reason));
  };

  disburse = async (req: Request, res: Response) => {
    res.json(await this.ops.disburse(parseObjectId(req.params.id), req.user!));
  };

  payments = async (req: Request, res: Response) => {
    res.json(await this.ops.payments(parseObjectId(req.params.id)));
  };

  recordPayment = async (req: Request, res: Response) => {
    const result = await this.ops.recordPayment(
      parseObjectId(req.params.id),
      req.user!,
      parse(RecordPaymentBody, req.body),
    );
    res.status(201).json(result);
  };
}
