import type { ClientSession, UpdateQuery } from 'mongoose';
import type { LoanStatus } from '../../domain/loan/status.ts';
import { LoanModel, type Loan, type LoanDocument } from '../../infra/models/loan.model.ts';
import { PaymentModel, type PaymentDocument } from '../../infra/models/payment.model.ts';
import type { Page, PageQuery } from '../shared/http.ts';

const BORROWER_FIELDS = 'email borrowerProfile onboardingStage breResult';

export class LoanRepository {
  async create(data: Record<string, unknown>, session: ClientSession): Promise<LoanDocument> {
    const [loan] = await LoanModel.create([data], { session });
    return loan!;
  }

  findById(id: string, session?: ClientSession): Promise<LoanDocument | null> {
    return LoanModel.findById(id)
      .session(session ?? null)
      .exec();
  }

  findByIdWithBorrower(id: string): Promise<LoanDocument | null> {
    return LoanModel.findById(id).populate('borrowerId', BORROWER_FIELDS).exec();
  }

  /** Ownership check in the query itself: someone else's loan is simply not found. */
  findOwned(id: string, borrowerId: string): Promise<LoanDocument | null> {
    return LoanModel.findOne({ _id: id, borrowerId }).exec();
  }

  listForBorrower(borrowerId: string): Promise<LoanDocument[]> {
    return LoanModel.find({ borrowerId }).sort({ createdAt: -1 }).exec();
  }

  async listByStatus(status: LoanStatus, { page, limit }: PageQuery): Promise<Page<LoanDocument>> {
    const [items, total] = await Promise.all([
      LoanModel.find({ status })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('borrowerId', BORROWER_FIELDS)
        .exec(),
      LoanModel.countDocuments({ status }).exec(),
    ]);
    return { items, page, limit, total };
  }

  /**
   * Optimistic concurrency: the update only applies if the loan is still in `expected` state
   * (and, when given, still has the expected paid amount). Returns null if someone else got there first.
   */
  updateIfState(
    id: string,
    expected: { status: LoanStatus; amountPaidPaise?: number },
    update: UpdateQuery<Loan>,
    session?: ClientSession,
  ): Promise<LoanDocument | null> {
    return LoanModel.findOneAndUpdate({ _id: id, ...expected }, update, { new: true, session }).exec();
  }

  async createPayment(data: Record<string, unknown>, session: ClientSession): Promise<PaymentDocument> {
    const [payment] = await PaymentModel.create([data], { session });
    return payment!;
  }

  listPayments(loanId: string): Promise<PaymentDocument[]> {
    return PaymentModel.find({ loanId }).sort({ paidAt: 1, createdAt: 1 }).exec();
  }
}
