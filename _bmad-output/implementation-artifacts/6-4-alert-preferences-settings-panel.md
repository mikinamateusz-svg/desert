# Story 6.4: Alert Preferences & Settings Panel

Status: ready-for-dev

## Story

As a **driver**,
I want a single place to configure all my price alerts and notification settings,
So that I get only the alerts that are relevant to me without being overwhelmed.

## Acceptance Criteria

**AC1 — Sectioned panel:**
Given a driver opens notification settings
When they view the alert preferences panel
Then they see clearly separated sections: Price Drop Alerts, Price Rise Alerts, and Monthly Summary

**AC2 — Price drop settings:**
Given a driver configures Price Drop Alerts
When they edit the settings
Then they can: toggle the alert on/off, choose mode (cheaper than now / target price), set a target price (PLN/L) if target mode is selected, choose fuel type(s) to monitor (PB 95 / PB 98 / Diesel / Premium Diesel / LPG), and set their preferred radius (5 km / 10 km / 25 km)

**AC3 — Price rise settings:**
Given a driver configures Price Rise Alerts
When they edit the settings
Then they can independently toggle community-confirmed rise alerts (Story 6.2) and predictive rise alerts (Story 6.3) on or off
And they can set their preferred radius (shared with drop alert radius setting)

**AC4 — Monthly summary toggle:**
Given a driver configures Monthly Summary
When they edit the settings
Then they can toggle the monthly savings summary notification on or off

**AC5 — Selective suppression:**
Given a driver disables a specific alert type
When that alert would otherwise trigger
Then it is silently suppressed — all other alert types continue unaffected

**AC6 — Permission-denied state:**
Given a driver has not granted OS notification permission
When they open the alert preferences panel
Then all controls are shown as disabled with a clear explanation and a button that deep-links to device notification settings — no broken state

**AC7 — Persistence:**
Given a driver saves their preferences
When they return to the panel later
Then all settings are persisted exactly as configured — no resets on app update or re-login

## Tasks / Subtasks

- [ ] T1: Schema migration — new Phase 2 columns on `NotificationPreference` (AC2, AC3, AC5, AC7)
  - [ ] T1a: Add migration file `packages/db/prisma/migrations/` with `ALTER TABLE "NotificationPreference" ADD COLUMN ...`
  - [ ] T1b: Update `packages/db/prisma/schema.prisma` — add 7 new columns (see Dev Notes)

- [ ] T2: API — extend DTO and service (AC2, AC3, AC4, AC5, AC7)
  - [ ] T2a: Extend `UpdateNotificationPreferencesDto` in `apps/api/src/notifications/dto/update-notification-preferences.dto.ts` with 7 new optional fields + validators
  - [ ] T2b: Extend `SELECT_WITHOUT_TOKEN` in `apps/api/src/notifications/notifications.service.ts` to include the 7 new columns
  - [ ] T2c: Extend `updatePreferences()` upsert `create` and `update` blocks to handle the 7 new fields
  - [ ] T2d: Update `getPreferences()` upsert `create` block defaults for the 7 new fields

- [ ] T3: Mobile — extend API client types (AC2, AC3, AC4, AC7)
  - [ ] T3a: Extend `NotificationPreferences` interface in `apps/mobile/src/api/notifications.ts` with 7 new fields
  - [ ] T3b: Extend `UpdateNotificationPreferencesPayload` interface with 7 new optional fields

- [ ] T4: Mobile — replace granted-state UI in `alerts.tsx` (AC1–AC6)
  - [ ] T4a: Wrap granted content in `ScrollView`
  - [ ] T4b: Build `SectionCard` helper component (inline in same file) — titled card container matching existing `toggleCard` visual language
  - [ ] T4c: Build Price Drop section — enabled toggle, mode selector (row of 2 pill buttons), conditional target price text input, fuel type chips (multi-select row), radius selector (row of 3 pill buttons)
  - [ ] T4d: Build Price Rise section — two labelled toggle rows (community / predictive) each with a sub-label description, radius reference note (reads shared `alert_radius_km`)
  - [ ] T4e: Build Monthly Summary section — single labelled toggle row (uses Phase 1 `monthly_summary` column)
  - [ ] T4f: Extend `handleToggle` to support all 7 new boolean fields alongside legacy 3; add `handleUpdate` for non-boolean fields (mode, target price, fuel types, radius)
  - [ ] T4g: Add target price validation: must be numeric, 1.00–20.00 range — show inline error, do not persist invalid input

- [ ] T5: i18n — all 3 locales (pl, en, uk) (AC1–AC6)
  - [ ] T5a: Add `notifications.sections.*` keys (priceDrop, priceRise, monthlySummary) in all 3 locales
  - [ ] T5b: Add `notifications.priceDropEnabled`, `notifications.mode`, `notifications.modeCheaperThanNow`, `notifications.modeTargetPrice`, `notifications.targetPricePln`, `notifications.targetPricePlaceholder`, `notifications.invalidTargetPrice` in all 3 locales
  - [ ] T5c: Add `notifications.fuelTypes`, `notifications.fuelPb95`, `notifications.fuelPb98`, `notifications.fuelOn`, `notifications.fuelOnPremium`, `notifications.fuelLpg` in all 3 locales
  - [ ] T5d: Add `notifications.alertRadius`, `notifications.radiusOption` (template or 3 discrete keys) in all 3 locales
  - [ ] T5e: Add `notifications.riseCommunity`, `notifications.riseCommunityDesc`, `notifications.risePredictive`, `notifications.risePredictiveDesc` in all 3 locales

- [ ] T6: Tests
  - [ ] T6a: `notifications.service.spec.ts` — `updatePreferences`: updates each new field independently; non-provided fields not overwritten; target price stored as Decimal; fuel types stored as array; invalid mode value rejected by DTO validator
  - [ ] T6b: Full regression suite — all existing tests still pass

## Dev Notes

### Phase 1 / Phase 2 column coexistence

Phase 1 columns (`price_drops`, `sharp_rise`, `monthly_summary`) **remain unchanged** — existing Phase 1 alert pipelines still read them. Phase 2 alert pipelines (Stories 6.1, 6.2, 6.3) will read the new Phase 2 columns added in this story. The UI manages them independently:
- Price Drop section controls `price_drop_enabled` (Phase 2); Phase 1 `price_drops` is no longer surfaced in the UI but is preserved for backward compatibility until Phase 1 pipeline is retired
- Price Rise section controls `rise_community_enabled` + `rise_predictive_enabled` (Phase 2); Phase 1 `sharp_rise` is similarly retired from the UI
- Monthly Summary section controls Phase 1 `monthly_summary` directly (no Phase 2 replacement needed — the setting is unchanged)

### Schema changes

Add to `model NotificationPreference` in `packages/db/prisma/schema.prisma`:

```prisma
// Phase 2 alert preferences
price_drop_enabled       Boolean  @default(false)
price_drop_mode          String   @default("cheaper_than_now")
price_drop_target_pln    Decimal? @db.Decimal(5, 2)
price_drop_fuel_types    String[] @default([])
alert_radius_km          Int      @default(10)
rise_community_enabled   Boolean  @default(false)
rise_predictive_enabled  Boolean  @default(false)
```

Valid values:
- `price_drop_mode`: `"cheaper_than_now"` | `"target_price"`
- `price_drop_fuel_types` elements: `"PB_95"` | `"PB_98"` | `"ON"` | `"ON_PREMIUM"` | `"LPG"`
- `alert_radius_km`: `5` | `10` | `25`

### DTO extension

```ts
// update-notification-preferences.dto.ts (additions)
import { IsArray, IsDecimal, IsIn, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

@IsOptional()
@IsBoolean()
price_drop_enabled?: boolean;

@IsOptional()
@IsIn(['cheaper_than_now', 'target_price'])
price_drop_mode?: string;

@IsOptional()
@ValidateIf((o) => o.price_drop_target_pln !== null)
@IsDecimal({ decimal_digits: '0,2', force_decimal: false })
@Transform(({ value }) => value)  // keep as string for class-validator; Prisma accepts string for Decimal
price_drop_target_pln?: string | null;

@IsOptional()
@IsArray()
@IsIn(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'], { each: true })
price_drop_fuel_types?: string[];

@IsOptional()
@IsInt()
@IsIn([5, 10, 25])
alert_radius_km?: number;

@IsOptional()
@IsBoolean()
rise_community_enabled?: boolean;

@IsOptional()
@IsBoolean()
rise_predictive_enabled?: boolean;
```

### Service extension

Extend `SELECT_WITHOUT_TOKEN`:
```ts
const SELECT_WITHOUT_TOKEN = {
  id: true,
  user_id: true,
  price_drops: true,
  sharp_rise: true,
  monthly_summary: true,
  price_drop_enabled: true,
  price_drop_mode: true,
  price_drop_target_pln: true,
  price_drop_fuel_types: true,
  alert_radius_km: true,
  rise_community_enabled: true,
  rise_predictive_enabled: true,
  created_at: true,
  updated_at: true,
} as const;
```

Extend `updatePreferences()` — add to `update` block:
```ts
...(dto.price_drop_enabled !== undefined && { price_drop_enabled: dto.price_drop_enabled }),
...(dto.price_drop_mode !== undefined && { price_drop_mode: dto.price_drop_mode }),
...(dto.price_drop_target_pln !== undefined && { price_drop_target_pln: dto.price_drop_target_pln }),
...(dto.price_drop_fuel_types !== undefined && { price_drop_fuel_types: dto.price_drop_fuel_types }),
...(dto.alert_radius_km !== undefined && { alert_radius_km: dto.alert_radius_km }),
...(dto.rise_community_enabled !== undefined && { rise_community_enabled: dto.rise_community_enabled }),
...(dto.rise_predictive_enabled !== undefined && { rise_predictive_enabled: dto.rise_predictive_enabled }),
```

The `create` block in `updatePreferences` uses Prisma defaults — no explicit values needed for optional Phase 2 fields (they default via schema).

### Mobile API client extension

```ts
// apps/mobile/src/api/notifications.ts

export interface NotificationPreferences {
  id: string;
  user_id: string;
  // Phase 1 (legacy — monthly_summary still active)
  price_drops: boolean;
  sharp_rise: boolean;
  monthly_summary: boolean;
  // Phase 2
  price_drop_enabled: boolean;
  price_drop_mode: 'cheaper_than_now' | 'target_price';
  price_drop_target_pln: string | null;  // Decimal serialised as string by Prisma
  price_drop_fuel_types: string[];
  alert_radius_km: number;
  rise_community_enabled: boolean;
  rise_predictive_enabled: boolean;
}

export interface UpdateNotificationPreferencesPayload {
  expo_push_token?: string | null;
  // Phase 1 (monthly_summary still surfaced in UI)
  price_drops?: boolean;
  sharp_rise?: boolean;
  monthly_summary?: boolean;
  // Phase 2
  price_drop_enabled?: boolean;
  price_drop_mode?: 'cheaper_than_now' | 'target_price';
  price_drop_target_pln?: string | null;
  price_drop_fuel_types?: string[];
  alert_radius_km?: number;
  rise_community_enabled?: boolean;
  rise_predictive_enabled?: boolean;
}
```

### UI structure (`alerts.tsx` — granted state replacement)

The non-granted states (loading, unauthenticated, undetermined, denied, re-prompt) are **preserved exactly as-is**. Only the granted state's render output changes.

Replace the single `<View style={styles.toggleCard}>` block with:

```tsx
<ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
  {saveError && (
    <View style={styles.saveErrorBanner}>
      <Text style={styles.saveErrorText}>{saveError}</Text>
    </View>
  )}

  {/* Section 1: Price Drop Alerts */}
  <SectionCard title={t('notifications.sections.priceDrop')}>
    <ToggleRow
      label={t('notifications.priceDropEnabled')}
      value={prefs?.price_drop_enabled ?? false}
      onChange={(v) => void handleUpdate({ price_drop_enabled: v })}
    />
    {prefs?.price_drop_enabled && (
      <>
        <Divider />
        {/* Mode selector */}
        <LabelRow label={t('notifications.mode')}>
          <PillGroup
            options={[
              { value: 'cheaper_than_now', label: t('notifications.modeCheaperThanNow') },
              { value: 'target_price', label: t('notifications.modeTargetPrice') },
            ]}
            selected={prefs.price_drop_mode}
            onSelect={(v) => void handleUpdate({ price_drop_mode: v as 'cheaper_than_now' | 'target_price' })}
          />
        </LabelRow>
        {/* Target price (conditional) */}
        {prefs?.price_drop_mode === 'target_price' && (
          <>
            <Divider />
            <LabelRow label={t('notifications.targetPricePln')}>
              <TextInput
                keyboardType="decimal-pad"
                value={targetPriceInput}
                onChangeText={setTargetPriceInput}
                onBlur={() => void handleTargetPriceBlur()}
                placeholder={t('notifications.targetPricePlaceholder')}
                style={styles.priceInput}
              />
            </LabelRow>
            {targetPriceError && (
              <Text style={styles.fieldError}>{t('notifications.invalidTargetPrice')}</Text>
            )}
          </>
        )}
        <Divider />
        {/* Fuel types */}
        <LabelRow label={t('notifications.fuelTypes')}>
          <FuelTypeChips
            selected={prefs.price_drop_fuel_types}
            onToggle={(type) => void handleFuelTypeToggle(type)}
            labels={{
              PB_95: t('notifications.fuelPb95'),
              PB_98: t('notifications.fuelPb98'),
              ON: t('notifications.fuelOn'),
              ON_PREMIUM: t('notifications.fuelOnPremium'),
              LPG: t('notifications.fuelLpg'),
            }}
          />
        </LabelRow>
        <Divider />
        {/* Radius */}
        <LabelRow label={t('notifications.alertRadius')}>
          <PillGroup
            options={[
              { value: 5, label: '5 km' },
              { value: 10, label: '10 km' },
              { value: 25, label: '25 km' },
            ]}
            selected={prefs.alert_radius_km}
            onSelect={(v) => void handleUpdate({ alert_radius_km: v as number })}
          />
        </LabelRow>
      </>
    )}
  </SectionCard>

  {/* Section 2: Price Rise Alerts */}
  <SectionCard title={t('notifications.sections.priceRise')}>
    <ToggleRow
      label={t('notifications.riseCommunity')}
      subLabel={t('notifications.riseCommunityDesc')}
      value={prefs?.rise_community_enabled ?? false}
      onChange={(v) => void handleUpdate({ rise_community_enabled: v })}
    />
    <Divider />
    <ToggleRow
      label={t('notifications.risePredictive')}
      subLabel={t('notifications.risePredictiveDesc')}
      value={prefs?.rise_predictive_enabled ?? false}
      onChange={(v) => void handleUpdate({ rise_predictive_enabled: v })}
    />
  </SectionCard>

  {/* Section 3: Monthly Summary */}
  <SectionCard title={t('notifications.sections.monthlySummary')}>
    <ToggleRow
      label={t('notifications.monthlySummary')}
      value={prefs?.monthly_summary ?? true}
      onChange={(v) => void handleUpdate({ monthly_summary: v })}
    />
  </SectionCard>
</ScrollView>
```

All sub-components (`SectionCard`, `ToggleRow`, `PillGroup`, `FuelTypeChips`, `LabelRow`, `Divider`) are **local to `alerts.tsx`** — do not extract to separate files.

### `handleUpdate` pattern

```ts
const handleUpdate = useCallback(
  async (patch: Partial<UpdateNotificationPreferencesPayload>) => {
    if (!accessToken || !prefs) return;
    const snapshot = prefs;
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaveError(null);
    try {
      await apiUpdateNotificationPreferences(accessToken, patch);
    } catch {
      setPrefs(snapshot);
      setSaveError(t('notifications.errorSaving'));
    }
  },
  [accessToken, prefs, t],
);
```

Remove the old `handleToggle` — replace all calls with `handleUpdate`.

### Target price input state

Target price has its own local state because it needs validation before persisting:

```ts
const [targetPriceInput, setTargetPriceInput] = useState<string>(prefs?.price_drop_target_pln ?? '');
const [targetPriceError, setTargetPriceError] = useState(false);

const handleTargetPriceBlur = useCallback(async () => {
  const num = parseFloat(targetPriceInput.replace(',', '.'));
  if (isNaN(num) || num < 1.0 || num > 20.0) {
    setTargetPriceError(true);
    return;
  }
  setTargetPriceError(false);
  await handleUpdate({ price_drop_target_pln: num.toFixed(2) });
}, [targetPriceInput, handleUpdate]);
```

Sync `targetPriceInput` from `prefs` on initial load:
```ts
useEffect(() => {
  if (prefs?.price_drop_target_pln != null) {
    setTargetPriceInput(prefs.price_drop_target_pln);
  }
}, [prefs?.price_drop_target_pln]);
```

### Fuel type multi-select toggle

```ts
const handleFuelTypeToggle = useCallback(
  async (type: string) => {
    if (!prefs) return;
    const current = prefs.price_drop_fuel_types;
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    await handleUpdate({ price_drop_fuel_types: updated });
  },
  [prefs, handleUpdate],
);
```

### i18n strings

Add to all 3 locales in `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` under the existing `notifications` key:

```ts
// --- Add to notifications object ---

sections: {
  priceDrop: 'Price Drop Alerts' | 'Alerty: spadek cen' | 'Сповіщення: падіння цін'
  priceRise: 'Price Rise Alerts' | 'Alerty: wzrost cen' | 'Сповіщення: зростання цін'
  monthlySummary: 'Monthly Summary' | 'Miesięczne podsumowanie' | 'Щомісячне зведення'
},

priceDropEnabled:
  en: 'Price drop alerts'
  pl: 'Alerty o spadkach cen'
  uk: 'Сповіщення про падіння цін'

mode:
  en: 'Alert mode'
  pl: 'Tryb alertu'
  uk: 'Режим сповіщення'

modeCheaperThanNow:
  en: 'Cheaper than now'
  pl: 'Taniej niż teraz'
  uk: 'Дешевше ніж зараз'

modeTargetPrice:
  en: 'Target price'
  pl: 'Cena docelowa'
  uk: 'Цільова ціна'

targetPricePln:
  en: 'Target price (PLN/L)'
  pl: 'Cena docelowa (PLN/L)'
  uk: 'Цільова ціна (PLN/L)'

targetPricePlaceholder:
  en: 'e.g. 6.50'
  pl: 'np. 6,50'
  uk: 'напр. 6,50'

invalidTargetPrice:
  en: 'Enter a price between 1.00 and 20.00'
  pl: 'Podaj cenę między 1,00 a 20,00'
  uk: 'Введіть ціну від 1,00 до 20,00'

fuelTypes:
  en: 'Fuel types'
  pl: 'Rodzaje paliwa'
  uk: 'Типи палива'

fuelPb95:   en: 'Pb 95'       pl: 'Pb 95'         uk: 'Pb 95'
fuelPb98:   en: 'Pb 98'       pl: 'Pb 98'         uk: 'Pb 98'
fuelOn:     en: 'Diesel'      pl: 'ON'             uk: 'ДП'
fuelOnPremium: en: 'Premium Diesel'  pl: 'ON Premium'  uk: 'ДП Преміум'
fuelLpg:    en: 'LPG'         pl: 'LPG'            uk: 'LPG'

alertRadius:
  en: 'Alert radius'
  pl: 'Zasięg alertów'
  uk: 'Радіус сповіщень'

riseCommunity:
  en: 'Community-confirmed rises'
  pl: 'Potwierdzone wzrosty cen'
  uk: 'Підтверджені зростання цін'

riseCommunityDesc:
  en: 'Triggered when multiple drivers report a price rise at the same station'
  pl: 'Kiedy wielu kierowców zgłosi wzrost cen w tej samej stacji'
  uk: 'Коли кілька водіїв повідомляють про зростання цін на одній станції'

risePredictive:
  en: 'Predictive rise alerts'
  pl: 'Alerty predykcyjne'
  uk: 'Прогностичні сповіщення'

risePredictiveDesc:
  en: 'Triggered when wholesale price signals suggest a rise is coming'
  pl: 'Kiedy sygnały hurtowe sugerują nadchodzący wzrost cen'
  uk: 'Коли оптові сигнали вказують на майбутнє зростання'
```

### Fuel type defaulting (deferred)

The spec says "fuel type defaults to their most-used fuel type from fill-up history if available". Epic 5 (Fuel Log) is not yet built, so fill-up history does not exist. **Do not implement defaulting** — `price_drop_fuel_types` starts as an empty array `[]`, and the UI shows all fuel type chips as unselected. Defaulting will be added in a follow-up story after Epic 5 ships.

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — 7 new columns on `NotificationPreference`)
- `packages/db/prisma/migrations/<timestamp>_add_phase2_alert_preferences/migration.sql` (new)
- `apps/api/src/notifications/dto/update-notification-preferences.dto.ts` (modified — 7 new fields)
- `apps/api/src/notifications/notifications.service.ts` (modified — extended SELECT + update/create logic)
- `apps/api/src/notifications/notifications.service.spec.ts` (modified — new tests)
- `apps/mobile/src/api/notifications.ts` (modified — extended interfaces)
- `apps/mobile/app/(app)/alerts.tsx` (modified — replace granted-state with rich panel)
- `apps/mobile/src/i18n/locales/en.ts` (modified — new notification keys)
- `apps/mobile/src/i18n/locales/pl.ts` (modified — new notification keys)
- `apps/mobile/src/i18n/locales/uk.ts` (modified — new notification keys)

### References

- `NotificationPreference` model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L142)
- Current notifications service: [apps/api/src/notifications/notifications.service.ts](apps/api/src/notifications/notifications.service.ts)
- Current DTO: [apps/api/src/notifications/dto/update-notification-preferences.dto.ts](apps/api/src/notifications/dto/update-notification-preferences.dto.ts)
- Current alerts screen: [apps/mobile/app/(app)/alerts.tsx](apps/mobile/app/(app)/alerts.tsx)
- Story 1.7 implementation (baseline): [_bmad-output/implementation-artifacts/1-7-notification-preferences.md](_bmad-output/implementation-artifacts/1-7-notification-preferences.md)
- Story 6.1 (price drop alert delivery — reads `price_drop_enabled`, `price_drop_mode`, etc.)
- Story 6.2 (community rise delivery — reads `rise_community_enabled`)
- Story 6.3 (predictive rise delivery — reads `rise_predictive_enabled`)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.4 (line ~2608)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — 7 new columns on NotificationPreference)
- `packages/db/prisma/migrations/<timestamp>_add_phase2_alert_preferences/migration.sql` (new)
- `apps/api/src/notifications/dto/update-notification-preferences.dto.ts` (modified)
- `apps/api/src/notifications/notifications.service.ts` (modified)
- `apps/api/src/notifications/notifications.service.spec.ts` (modified)
- `apps/mobile/src/api/notifications.ts` (modified)
- `apps/mobile/app/(app)/alerts.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/6-4-alert-preferences-settings-panel.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
