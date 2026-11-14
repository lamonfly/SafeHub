import { renderAppIcon } from "@/lib/app-icon";

// PWA icons for the manifest: /pwa-icon/192, /pwa-icon/512, /pwa-icon/maskable-512.
const icons: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
};

export async function GET(_request: Request, { params }: RouteContext<"/pwa-icon/[name]">) {
  const icon = icons[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  return renderAppIcon(icon.size, { maskable: icon.maskable });
}
