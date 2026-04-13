# Privacy Policy — Litro

*This is a convenience translation. The Polish version at https://litro.pl/polityka-prywatnosci is the legally binding text.*

*Last updated: [DATE]*

---

## 1. Who we are

The controller of your personal data is **Mateusz Mikina**, residing in Poland (hereinafter: "Controller", "we").

Data Protection Officer (DPO): **privacy@litro.pl**

Litro is a mobile app and web service for comparing fuel prices at stations in Poland, based on community data (user submissions) and artificial intelligence (automatic price reading from price board photos).

---

## 2. What data we collect

| Category | Data | When collected |
|---|---|---|
| **Account data** | email address, display name, password (encrypted) | registration |
| **Social login** | Google or Apple identifier (not your password to those services) | login via Google/Apple |
| **GPS location** | geographic coordinates (latitude, longitude) | using the map, submitting a price photo |
| **Price board photos** | photographs of fuel price boards at stations | voluntary price submission |
| **Device data** | operating system, device model, push notification token (Expo) | installation and use of the app |
| **Activity data** | fuel type preferences, submission history, notification settings | use of the app |

### What we do NOT collect
- We do not collect biometric data.
- We do not collect payment data or credit card information.
- We do not profile users for advertising purposes.
- We do not sell personal data to third parties.

---

## 3. Purposes and legal basis for processing

| Purpose | Legal basis (GDPR) | Data |
|---|---|---|
| **Service delivery** — displaying station map, fuel prices, account management | Art. 6(1)(b) — contract performance | account, location, submissions |
| **OCR photo processing** — automatic price reading from price board photos | Art. 6(1)(a) — consent (voluntary photo submission) | photos, GPS (temporarily) |
| **Push notifications** — price change alerts | Art. 6(1)(a) — consent | push token, preferences |
| **Security and data integrity** — abuse detection, submission moderation | Art. 6(1)(f) — legitimate interest | account data, submissions, trust score |
| **Aggregated analytics** — regional fuel price statistics (no personal data) | Art. 6(1)(f) — legitimate interest | aggregated and anonymised data |
| **Legal obligations** — responses to authority requests | Art. 6(1)(c) — legal obligation | account data |

---

## 4. Photos and OCR processing

Price board photos are processed by artificial intelligence solely to read fuel prices. The system does not recognise people, vehicles, or licence plates. GPS coordinates are deleted from the database after station matching. Photos are stored on a server in the EU region for 30 days for audit purposes, then automatically deleted.

---

## 5. Community data (price submissions)

By submitting a price report, you grant us a free licence to use the extracted prices within the Litro service. Prices are displayed anonymously — other users cannot see who submitted a given price.

Your submissions are stored in our database. After account deletion, your personal data (email, name) is removed, and price submissions remain in the system in pseudonymised form for statistical purposes.

---

## 6. Who we share data with

We do not sell your personal data. We share data only with the following categories of recipients:

| Recipient | Purpose | Data | Location |
|---|---|---|---|
| **Anthropic (Claude AI)** | OCR photo processing | price board photos | USA (SCC) |
| **Cloudflare R2** | photo storage | photos | EU |
| **Railway** | API server hosting | account data, submissions | USA (SCC) |
| **Vercel** | website hosting | session data, IP | USA (SCC) |
| **Neon** | database | all data in the database | EU |
| **Upstash** | Redis cache | price cache, session tokens | EU |
| **Expo (Meta)** | push notifications | push tokens | USA (SCC) |
| **Google / Apple** | social login | account identifier | USA (SCC) |

**SCC** = Standard Contractual Clauses pursuant to the European Commission decision, ensuring an adequate level of data protection for transfers outside the EEA.

---

## 7. Data transfers outside the EEA

Some of our service providers are based in the USA. In each such case, we apply Standard Contractual Clauses (SCC) approved by the European Commission as a data transfer safeguard. This applies to: Railway (hosting), Vercel (web hosting), Anthropic (OCR), Expo (push notifications), Google and Apple (login).

Where possible, we choose EU regions for data storage (Neon — database, Upstash — Redis, Cloudflare R2 — photos).

---

## 8. How long we retain data

| Data | Retention period |
|---|---|
| **Account data** | until account deletion, then anonymised |
| **Price submissions** | indefinitely (anonymised after account deletion) |
| **Price board photos** | 30 days from submission, then automatically deleted |
| **GPS coordinates from submissions** | deleted immediately after station matching |
| **Push token** | until token deregistration or account deletion |
| **Notification preferences** | until changed or account deletion |
| **Consent history** | indefinitely (GDPR documentation obligation) |

---

## 9. Your rights

Under GDPR, you have the following rights:

| Right | Description | How to exercise |
|---|---|---|
| **Access** (Art. 15) | You can find out what data we process about you | Data export in the app |
| **Rectification** (Art. 16) | You can correct inaccurate data | Profile editing in the app or contact: privacy@litro.pl |
| **Erasure** (Art. 17) | You can request deletion of your data | Account deletion in the app |
| **Restriction** (Art. 18) | You can request restriction of processing | Contact: privacy@litro.pl |
| **Portability** (Art. 20) | You can download your data in electronic format | Data export in the app |
| **Objection** (Art. 21) | You can object to processing based on legitimate interest | Contact: privacy@litro.pl |
| **Withdraw consent** | You can withdraw consent at any time (without affecting the lawfulness of processing carried out before withdrawal) | Settings in the app |

### Complaint to the supervisory authority

You have the right to lodge a complaint with the President of the Personal Data Protection Office (UODO):

Urząd Ochrony Danych Osobowych
ul. Stawki 2, 00-193 Warszawa
www.uodo.gov.pl

---

## 10. Cookies and local data

The litro.pl website uses only essential cookies (session, site operation). We do not use advertising or analytics cookies.

The mobile app does not use cookies. It stores user preferences, session token, and offline submission queue locally on the device.

---

## 11. Data security

We apply appropriate technical and organisational measures to protect your personal data against unauthorised access, loss, or destruction. These include encryption of data transmission (HTTPS/TLS), cryptographic password protection (bcrypt), role-based access control (RBAC), and automated abuse detection mechanisms.

---

## 12. Children

Litro is intended for persons aged **16 or over**. We do not knowingly collect personal data from persons under 16 years of age. If we learn that we have collected data from a person under 16, we will delete it without delay.

---

## 13. Policy changes

We will inform you in advance of material changes to this policy. The current version is always available at: https://litro.pl/polityka-prywatnosci

---

## 14. Contact

For matters related to personal data protection: **privacy@litro.pl**
