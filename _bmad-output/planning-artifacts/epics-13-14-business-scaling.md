---
# Epics 13 & 14 — Business Scaling: JDG and Sp. z o.o.
# Part of the same epic breakdown as epics.md and epics-11-12-launch-prep.md
---

## Epic 13: Scale to JDG *(Trigger: product shows traction)*

Litro is formalised as a sole trader business (JDG registered in CEIDG), legal documents are updated with the NIP, app store developer identity reflects the business, and basic operations (accounting, VAT decision, invoicing) are in place.

**Trigger:** Register JDG when the product shows meaningful traction — active users, revenue, or the need to issue invoices for any paid feature or B2B contract.

---

### Story 13.1: JDG Registration

As an **operator**,
I want a JDG registered in CEIDG,
So that Litro operates as a legal business entity with a NIP, enabling invoicing, formal contracts, and eventual store account upgrade.

**Why:** JDG is the simplest Polish business form — free to register, no minimum capital, takes 1 business day via CEIDG online. Gives NIP, REGON, and legal standing to issue invoices. Required before any B2B revenue (data licensing, advertising, fleet subscriptions).

**Acceptance Criteria:**

**Given** the decision to formalise is made
**When** CEIDG registration is completed at biznes.gov.pl
**Then** JDG is registered with PKD codes covering software/app development and data services
**And** NIP is confirmed (existing personal NIP carries over automatically)
**And** REGON is issued
**And** ZUS registration is completed with the chosen contribution scheme (standard ZUS, maly ZUS plus, or IP Box if applicable)
**And** a business bank account is opened separate from the personal account

**Given** JDG is registered
**When** the VAT question is decided with an accountant
**Then** decision is documented: VAT-exempt (zwolnienie podmiotowe, valid up to 200k PLN/year) or VAT payer
**And** if VAT-registered: OSS (One-Stop Shop) scheme registration for cross-border EU digital services to consumers is completed

---

### Story 13.2: Bookkeeping and Invoicing Setup

As an **operator**,
I want basic bookkeeping and invoicing in place,
So that the business meets its tax obligations and can issue invoices for paid features or B2B contracts.

**Why:** JDG requires KPiR (Ksiega Przychodow i Rozchodow). Apple and Google pay out revenue via commission statements; any B2B deal (data licensing, advertising) requires a proper VAT invoice. Infrastructure costs must be booked as business expenses.

**Acceptance Criteria:**

**Given** JDG is registered
**When** bookkeeping is set up
**Then** an accountant or accounting software (inFakt, wFirma, Fakturownia) is configured for KPiR
**And** app store revenue (Apple, Google Play payouts) is correctly categorised as business income
**And** monthly ZUS contributions are scheduled as recurring payments from the business account

**Given** a paid feature or B2B contract is signed
**When** an invoice is issued
**Then** it contains all required Polish VAT invoice fields: seller NIP, buyer NIP, issue date, sale date, service description, net amount, VAT rate/amount, gross amount
**And** invoices are archived for 5 years as required by Polish tax law

---

### Story 13.3: Legal Document and App Store Updates for JDG

As an **operator**,
I want the privacy policy, terms of service, and app store accounts updated to reflect the JDG identity,
So that legal documents accurately identify the data controller and the business name appears in store listings.

**Why:** GDPR requires accurate data controller identification in the privacy policy. Updating store listings from personal name to JDG trading name separates personal and business identity and signals professionalism.

**Acceptance Criteria:**

**Given** JDG is registered
**When** legal documents are updated
**Then** privacy policy and terms include: JDG trading name, NIP, REGON, and registered business address (virtual office address is acceptable)
**And** documents are published at the same stable URLs with a new version number — no URL changes
**And** users are notified of the updated terms per the change procedure in Story 11.2

**Given** documents are updated
**When** app store developer information is updated
**Then** Apple Developer seller information is updated with JDG NIP and business address
**And** Google Play developer account name and contact details are updated to reflect the JDG
**And** a conscious decision is made on whether to upgrade Apple Developer to Organisation (requires D-U-N-S acquisition, worth doing if the JDG trading name on the listing matters for brand at this stage)

---

### Story 13.4: Infrastructure Billing Migration to JDG

As an **operator**,
I want infrastructure billing transferred to the JDG,
So that infrastructure costs are deductible business expenses correctly billed to the NIP.

**Why:** Personal and business finances must be separated once a JDG is operating. Infrastructure costs (Railway, Vercel, Neon, etc.) are tax-deductible only if billed to the NIP — billing to a personal card cannot be expensed.

**Acceptance Criteria:**

**Given** JDG is registered with a business bank account
**When** infrastructure billing is updated
**Then** Railway, Vercel, Neon, Upstash, Cloudflare billing is switched to the business bank card
**And** invoices from providers are addressed to the JDG NIP
**And** all service accounts are linked to a business email address rather than a personal one
**And** credentials are documented in a business password manager

---

## Epic 14: Scale to Sp. z o.o. *(Trigger: hiring, investment, or significant B2B revenue)*

Litro is incorporated as a sp. z o.o., all infrastructure and IP are transferred to the company, Apple Developer is re-enrolled as an Organisation, and the business is structured for investment, employment, and enterprise contracts.

**Trigger:** Incorporate when the business justifies it — hiring the first employee, raising investment, signing significant B2B contracts that require limited liability, or when personal liability exposure becomes a real concern.

---

### Story 14.1: Sp. z o.o. Incorporation

As an **operator**,
I want a sp. z o.o. incorporated,
So that Litro has limited liability, a proper corporate structure for investment and employment, and a KRS number for enterprise contracts.

**Why:** Sp. z o.o. separates personal assets from business liability and is the standard vehicle for investment (equity, VC) and employment. Minimum capital is 5,000 PLN. Incorporation takes 1-5 business days via S24 online portal or 1-2 weeks via notary. Many enterprise clients and investors require a KRS-registered entity for contracts.

**Acceptance Criteria:**

**Given** the decision to incorporate is made
**When** incorporation is completed via S24 (rejestracja.ms.gov.pl) or notary
**Then** company is registered in KRS with: company name, registered address, share capital (minimum 5,000 PLN), shareholder structure, and management board (zarzad)
**And** KRS number, NIP, and REGON are issued
**And** D-U-N-S number is requested for the new legal entity at dnb.com via Apple developer path (up to 7 business days — start immediately, needed for Story 14.2)
**And** a company bank account is opened
**And** an accountant is engaged for pelna ksiegowosc (full double-entry bookkeeping — mandatory for sp. z o.o.)

**Given** company is incorporated
**When** ZUS and VAT obligations are assessed with the accountant
**Then** ZUS registration for management board member(s) is completed
**And** VAT registration decision is made (likely VAT payer at company scale)
**And** OSS registration for EU cross-border digital services to consumers is confirmed or established

---

### Story 14.2: IP and Domain Transfer to Company

As an **operator**,
I want the Litro brand, domain, and all intellectual property transferred to the sp. z o.o.,
So that the company — not the individual — owns all commercial assets.

**Why:** A VC or acquirer will not accept a structure where key IP sits with a founder personally. Trademark, domain, and codebase ownership must sit with the company from the moment external capital or a serious acquirer is involved.

**Acceptance Criteria:**

**Given** company is incorporated and D-U-N-S is available
**When** IP transfer is executed with a lawyer
**Then** the domain registrant is changed from personal to company
**And** any trademark applications (Litro word mark / logo mark) filed by the individual or JDG are formally assigned to the company and the assignment is filed with UPRP
**And** a codebase ownership agreement is signed acknowledging all prior work is assigned to the company
**And** Apple Developer is re-enrolled as an Organisation account using the company D-U-N-S
**And** the existing app (with all ratings and reviews) is transferred to the Organisation account via Apple account transfer process
**And** Google Play developer account identity is updated to the company name

---

### Story 14.3: Full Infrastructure Migration to Company

As an **operator**,
I want all infrastructure and third-party accounts migrated to the company,
So that the sp. z o.o. legally owns and operates the product — a hard requirement for investment due diligence.

**Why:** This is the full execution of the migration deferred in Story 12.2. All infrastructure must be under the company for liability, audit, and investor due diligence. A company is not investable if its servers are on a personal account.

**Acceptance Criteria:**

**Given** company is incorporated with a business bank account and company email domain
**When** migration is executed
**Then** all items from Story 12.2 are completed: GitHub organisation, Vercel team, Railway workspace, Neon organisation, Upstash team, Cloudflare R2 billing — all under company accounts and billed to the company NIP
**And** all access credentials are migrated to a company password manager separate from any personal use
**And** personal developer accounts are clearly separated or retired

**Given** migration is complete
**When** the first investor or enterprise client requests due diligence materials
**Then** they can verify that all infrastructure, IP, and accounts are owned by the sp. z o.o. with no personal entanglements — a clean corporate structure

---

### Story 14.4: Legal Document Update for Company

As an **operator**,
I want all legal documents updated to reflect the sp. z o.o. as the new data controller,
So that GDPR compliance and consumer law obligations sit correctly with the company.

**Why:** A change of data controller is a material GDPR event requiring user notification under Art. 14. The regulamin must be updated with the KRS number and correct company details. Failure to notify is an enforcement risk.

**Acceptance Criteria:**

**Given** the company is the new data controller
**When** legal documents are updated
**Then** privacy policy reflects: company legal name, KRS number, NIP, registered address, and the new data controller identity
**And** GDPR Art. 14 notice of the controller change is sent to all existing users via in-app notification or email
**And** terms of service are updated with company identity
**And** documents are published at the same stable URLs with a new version number
**And** users are prompted to re-accept per the consent versioning mechanism from Story 11.3

**Given** documents are updated
**When** app store listings are reviewed
**Then** developer name on both Apple App Store and Google Play reflects the company name
**And** privacy policy and support URLs remain live and unchanged
