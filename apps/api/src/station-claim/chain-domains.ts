/**
 * Email-domain → chain-brand whitelist for the auto-approve "domain match"
 * path of Story 7.1.
 *
 * Used at claim submission: if the applicant's email ends in one of these
 * domains AND the station's `brand` field equals the mapped chain name,
 * the claim auto-approves and STATION_MANAGER role is granted immediately.
 *
 * What this catches: chain HQ employees and CODO (Company Owned Dealer
 * Operated) station managers using their corporate emails. ~15% of all
 * claims realistically — the bulk of chain stations are DOFO (Dealer
 * Owned Franchise Operated) franchisees with personal/own-business
 * emails, who go through the manual queue regardless.
 *
 * Brand strings must match `Station.brand` exactly. The station classifier
 * (Story 2.14) populates that column with canonical names — see
 * apps/api/src/station/station-classification.service.ts for the source
 * of truth.
 *
 * To add a chain: confirm the email domain belongs ONLY to that chain (no
 * shared parent groups), confirm the brand string matches the classifier's
 * output, and ideally test with a known employee email. Mistakes here can
 * grant STATION_MANAGER role to the wrong person.
 */
export interface ChainDomainEntry {
  /** Email domain in lowercase, no @ prefix. */
  domain: string;
  /** Must match `Station.brand` exactly (case-sensitive). */
  brand: string;
}

export const CHAIN_DOMAIN_WHITELIST: readonly ChainDomainEntry[] = [
  // ORLEN — Polska's largest network, 25% DOFO franchisees still need
  // manual review. This catches HQ staff + CODO managers.
  { domain: 'orlen.pl', brand: 'ORLEN' },
  { domain: 'orlenpolska.pl', brand: 'ORLEN' },
  // Lotos was acquired by ORLEN in 2022; some stations still rebrand,
  // some retain Lotos branding. Keep both domains for the transition.
  { domain: 'lotos.pl', brand: 'Lotos' },

  // BP Polska — global oil major; .pl entity issues local emails.
  { domain: 'bp.com', brand: 'BP' },
  { domain: 'bp.pl', brand: 'BP' },

  // Shell Polska
  { domain: 'shell.com', brand: 'Shell' },
  { domain: 'shell.pl', brand: 'Shell' },

  // Circle K — 31% franchised in PL. circlekeurope.com is the European
  // arm; Polish ops sit under it.
  { domain: 'circlek.com', brand: 'Circle K' },
  { domain: 'circlekeurope.com', brand: 'Circle K' },

  // Moya — Anwim S.A. is the operator; ~70% franchise share. Domain
  // match catches the small minority of HQ + CODO staff.
  { domain: 'anwim.pl', brand: 'Moya' },
  { domain: 'moyastacja.pl', brand: 'Moya' },

  // Amic — note: parent / domain set may shift; verify before next
  // update. Listed conservatively for now.
  { domain: 'amic.pl', brand: 'Amic' },
];

/**
 * Look up the chain a given email domain belongs to. Returns null when
 * the domain isn't in the whitelist (= goes to manual queue).
 *
 * Email handling: case-insensitive, anything after the LAST `@` is the
 * domain. We deliberately don't handle plus-addressing or other RFC
 * exotica — chain employees will have plain corporate emails.
 *
 * P4 (CR fix): require a non-empty local part. `'@orlen.pl'` would
 * otherwise resolve to ORLEN, which combined with a future bug that
 * sets `user.email` to just a domain string would silently grant
 * STATION_MANAGER role.
 */
export function lookupChainByEmail(email: string): ChainDomainEntry | null {
  const lastAt = email.lastIndexOf('@');
  // > 0 (not >= 0) — local part must have at least one character.
  if (lastAt <= 0) return null;
  const domain = email.slice(lastAt + 1).toLowerCase().trim();
  if (!domain) return null;
  return CHAIN_DOMAIN_WHITELIST.find((e) => e.domain === domain) ?? null;
}
