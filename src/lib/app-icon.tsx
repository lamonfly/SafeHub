import { ImageResponse } from "next/og";

// SafeHub app icon: white "S" on the M3 primary color. One drawing for the
// favicon, the Apple touch icon and the PWA icons.
export function renderAppIcon(size: number, { maskable = false } = {}) {
  // Maskable icons get cropped to a circle or squircle: keep the letter in
  // the middle 60% and fill the whole square.
  const radius = maskable ? 0 : size * 0.22;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#6750a4",
          borderRadius: radius,
          color: "#ffffff",
          fontSize: size * (maskable ? 0.45 : 0.62),
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        S
      </div>
    ),
    { width: size, height: size },
  );
}
