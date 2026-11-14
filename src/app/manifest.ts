import type { MetadataRoute } from "next";

// Makes SafeHub installable on phones ("Add to Home screen"): own window,
// no browser bars.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SafeHub",
    short_name: "SafeHub",
    description: "Home server dashboard and monitor",
    start_url: "/",
    display: "standalone",
    background_color: "#fef7ff",
    theme_color: "#6750a4",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
