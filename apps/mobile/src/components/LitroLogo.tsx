import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle, Path, Line } from 'react-native-svg';

interface Props {
  /** Height of the logo in dp. Text + gauge scale proportionally. Default 40. */
  size?: number;
  /** Use light (white) colours — for dark backgrounds. Default false. */
  light?: boolean;
}

/**
 * Litro brand wordmark — Concept B (gauge).
 *
 * Renders as: native Text "litr" + SVG gauge circle (replacing "o").
 * Uses the system bold font so no custom font asset is required.
 *
 * The gauge arc runs green → amber → red (150° → 30° clockwise over the top)
 * with the needle pointing into the green zone (low-price = good).
 */
export function LitroLogo({ size = 40, light = false }: Props) {
  const ink        = light ? '#ffffff' : '#1a1a1a';
  const gaugeBg    = light ? '#222222' : '#f4f4f4';
  const gaugeTrack = light ? '#2a2a2a' : '#e0e0e0';

  // Gauge geometry: radius ≈ x-height / 2  (x-height ≈ 60 % of font-size)
  const r      = size * 0.28;
  const trackW = r * 0.28;

  const toRad = (d: number) => (d * Math.PI) / 180;

  // Arc: 150° → 30° clockwise over the top (same as HTML spec)
  const cx = r + trackW + 1;   // padding so stroke isn't clipped
  const cy = r + trackW + 1;
  const svgSide = (r + trackW + 1) * 2;

  const ax1 = cx + r * Math.cos(toRad(150));
  const ay1 = cy + r * Math.sin(toRad(150));
  const ax2 = cx + r * Math.cos(toRad(30));
  const ay2 = cy + r * Math.sin(toRad(30));
  const arcD = `M ${ax1.toFixed(2)} ${ay1.toFixed(2)} A ${r} ${r} 0 1 1 ${ax2.toFixed(2)} ${ay2.toFixed(2)}`;

  // Needle pointing to the green zone (~210°)
  const needleLen = r * 0.72;
  const nx = cx + needleLen * Math.cos(toRad(210));
  const ny = cy + needleLen * Math.sin(toRad(210));

  return (
    <View
      accessible
      accessibilityLabel="Litro"
      style={{ flexDirection: 'row', alignItems: 'center' }}
    >
      {/* "litr" — system heavy/black weight */}
      <Text
        style={{
          fontSize: size,
          fontWeight: '900',
          color: ink,
          letterSpacing: -size * 0.02,
          lineHeight: size * 1.1,
          includeFontPadding: false,
        }}
      >
        litr
      </Text>

      {/* gauge "o" */}
      <Svg
        width={svgSide}
        height={svgSide}
        viewBox={`0 0 ${svgSide} ${svgSide}`}
        style={{ marginLeft: 1 }}
      >
        <Defs>
          <LinearGradient id="litroGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%"   stopColor="#22c55e" />
            <Stop offset="48%"  stopColor="#f59e0b" />
            <Stop offset="100%" stopColor="#ef4444" />
          </LinearGradient>
        </Defs>

        {/* Gauge background circle */}
        <Circle
          cx={cx} cy={cy} r={r}
          fill={gaugeBg}
          stroke={gaugeTrack}
          strokeWidth={1}
        />

        {/* Track (background arc) */}
        <Path
          d={arcD}
          fill="none"
          stroke={gaugeTrack}
          strokeWidth={trackW}
          strokeLinecap="round"
        />

        {/* Coloured arc */}
        <Path
          d={arcD}
          fill="none"
          stroke="url(#litroGrad)"
          strokeWidth={trackW}
          strokeLinecap="round"
        />

        {/* Needle */}
        <Line
          x1={cx.toFixed(2)} y1={cy.toFixed(2)}
          x2={nx.toFixed(2)} y2={ny.toFixed(2)}
          stroke={ink}
          strokeWidth={trackW * 0.55}
          strokeLinecap="round"
        />

        {/* Pivot dot */}
        <Circle cx={cx} cy={cy} r={trackW * 0.75} fill={ink} />
      </Svg>
    </View>
  );
}
