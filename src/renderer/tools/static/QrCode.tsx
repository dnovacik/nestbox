import QRCode from 'qrcode';
import { useMemo } from 'react';

/** A QR code as SVG rects (no data URLs or innerHTML, so the CSP stays strict). */
export function QrCode({ value, size = 152, label }: { value: string; size?: number; label: string }) {
  const modules = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }).modules, [value]);
  const n = modules.size;
  const quiet = 2;
  const rects: React.ReactElement[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (modules.get(row, col)) rects.push(<rect key={`${row}:${col}`} x={col + quiet} y={row + quiet} width={1} height={1} />);
    }
  }
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`} shapeRendering="crispEdges" className="rounded bg-fg fill-app">
      {rects}
    </svg>
  );
}
