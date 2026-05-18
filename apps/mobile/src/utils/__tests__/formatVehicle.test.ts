import {
  formatVehicleBrandModel,
  formatVehicleDisplayName,
  formatVehicleSubtitle,
} from '../formatVehicle';

describe('formatVehicleBrandModel', () => {
  it('strips make prefix and chassis code (Saab 9-3)', () => {
    expect(formatVehicleBrandModel('Saab', 'Saab_9-3_II_YS3F')).toBe('Saab 9-3');
  });

  it('preserves multi-word model names (BMW 3 Series)', () => {
    expect(formatVehicleBrandModel('BMW', 'BMW_3_Series_E90')).toBe('BMW 3 Series');
  });

  it('handles hyphenated makes (Mercedes-Benz)', () => {
    expect(formatVehicleBrandModel('Mercedes-Benz', 'Mercedes-Benz_C-Class_W205')).toBe(
      'Mercedes-Benz C-Class',
    );
  });

  it('strips Mk-style generation markers (VW Golf Mk7)', () => {
    expect(formatVehicleBrandModel('Volkswagen', 'Volkswagen_Golf_Mk7')).toBe('Volkswagen Golf');
  });

  it('strips numeric chassis codes (Toyota Corolla E170)', () => {
    expect(formatVehicleBrandModel('Toyota', 'Toyota_Corolla_E170')).toBe('Toyota Corolla');
  });

  it('works when model does not duplicate make at the front', () => {
    expect(formatVehicleBrandModel('Saab', '9-3_II_YS3F')).toBe('Saab 9-3');
  });

  it('falls back to underscore replacement when everything is stripped', () => {
    // pathological: only make + chassis, nothing meaningful in between
    expect(formatVehicleBrandModel('Foo', 'Foo_W205')).toBe('Foo W205');
  });

  it('handles empty make gracefully', () => {
    expect(formatVehicleBrandModel('', 'Saab_9-3')).toBe('Saab 9-3');
  });

  it('does not strip parts that only happen to be uppercase but contain lowercase letters', () => {
    // "Series" should be kept (BMW 3 Series example)
    expect(formatVehicleBrandModel('BMW', 'BMW_3_Series')).toBe('BMW 3 Series');
  });

  it('strips short uppercase codes (YS3F-style)', () => {
    expect(formatVehicleBrandModel('Saab', 'Saab_900_YS3D')).toBe('Saab 900');
  });
});

describe('formatVehicleDisplayName', () => {
  it('prefers nickname when set', () => {
    expect(
      formatVehicleDisplayName({
        make: 'Saab',
        model: 'Saab_9-3_II_YS3F',
        nickname: 'Niebieski',
      }),
    ).toBe('Niebieski');
  });

  it('falls back to brand+model when nickname is null', () => {
    expect(
      formatVehicleDisplayName({
        make: 'Saab',
        model: 'Saab_9-3_II_YS3F',
        nickname: null,
      }),
    ).toBe('Saab 9-3');
  });

  it('falls back to brand+model when nickname is whitespace-only', () => {
    expect(
      formatVehicleDisplayName({
        make: 'Saab',
        model: 'Saab_9-3_II_YS3F',
        nickname: '   ',
      }),
    ).toBe('Saab 9-3');
  });

  it('falls back to brand+model when nickname is undefined', () => {
    expect(
      formatVehicleDisplayName({
        make: 'Saab',
        model: 'Saab_9-3_II_YS3F',
      }),
    ).toBe('Saab 9-3');
  });
});

describe('formatVehicleSubtitle', () => {
  it('joins year + engine_variant with a middle dot', () => {
    expect(
      formatVehicleSubtitle({
        make: 'Saab',
        model: 'Saab_9-3',
        year: 2008,
        engine_variant: '1.9 TiD 120',
      }),
    ).toBe('2008 · 1.9 TiD 120');
  });

  it('returns just the year when engine_variant is missing', () => {
    expect(
      formatVehicleSubtitle({
        make: 'Saab',
        model: 'Saab_9-3',
        year: 2008,
        engine_variant: null,
      }),
    ).toBe('2008');
  });

  it('returns just the engine variant when year is missing', () => {
    expect(
      formatVehicleSubtitle({
        make: 'Saab',
        model: 'Saab_9-3',
        engine_variant: '1.9 TiD 120',
      }),
    ).toBe('1.9 TiD 120');
  });

  it('returns empty string when both are missing', () => {
    expect(
      formatVehicleSubtitle({
        make: 'Saab',
        model: 'Saab_9-3',
      }),
    ).toBe('');
  });
});
