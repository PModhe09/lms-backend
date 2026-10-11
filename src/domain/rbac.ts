import { Role } from './enums.ts';

/** Code checks permissions, never role names. A role is a named bundle of permissions. See docs/design/05-rbac.md. */
export const Permission = {
  BORROWER_PORTAL: 'BORROWER_PORTAL',
  LEADS_READ: 'LEADS_READ',
  SANCTION_READ: 'SANCTION_READ',
  SANCTION_DECIDE: 'SANCTION_DECIDE',
  DISBURSEMENT_READ: 'DISBURSEMENT_READ',
  DISBURSEMENT_EXECUTE: 'DISBURSEMENT_EXECUTE',
  COLLECTION_READ: 'COLLECTION_READ',
  COLLECTION_RECORD: 'COLLECTION_RECORD',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const OPS: readonly Permission[] = [
  Permission.LEADS_READ,
  Permission.SANCTION_READ,
  Permission.SANCTION_DECIDE,
  Permission.DISBURSEMENT_READ,
  Permission.DISBURSEMENT_EXECUTE,
  Permission.COLLECTION_READ,
  Permission.COLLECTION_RECORD,
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.ADMIN]: OPS,
  [Role.SALES]: [Permission.LEADS_READ],
  [Role.SANCTION]: [Permission.SANCTION_READ, Permission.SANCTION_DECIDE],
  [Role.DISBURSEMENT]: [Permission.DISBURSEMENT_READ, Permission.DISBURSEMENT_EXECUTE],
  [Role.COLLECTION]: [Permission.COLLECTION_READ, Permission.COLLECTION_RECORD],
  [Role.BORROWER]: [Permission.BORROWER_PORTAL],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
